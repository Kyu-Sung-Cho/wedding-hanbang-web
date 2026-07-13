import { createHash } from "node:crypto";
import {
  createOpenAIStructuredResponseWithAudit,
  type AuditedOpenAIResponse,
} from "@/lib/ai/auditedOpenAI";
import { getAmoraModelConfig, hasOpenAIConfig } from "@/lib/ai/modelConfig";
import {
  COURT_VERDICT_MAX_OUTPUT_TOKENS,
  COURT_VERDICT_MODEL_ROLE,
  COURT_VERDICT_PROMPT_VERSION,
  COURT_VERDICT_SCHEMA_VERSION,
  COURT_VERDICT_STRUCTURED_OUTPUT_NAME,
  getCourtVerdictStructuredOutputName,
} from "@/lib/coupleCourt/config";
import { computeCourtInputHash, normalizeCourtStatements } from "@/lib/coupleCourt/hash";
import {
  buildCourtSafeShareCard,
  redactCourtText,
  sanitizePrivateCourtVerdict,
} from "@/lib/coupleCourt/privacy";
import { COUPLE_COURT_JUDGE_SYSTEM_PROMPT } from "@/lib/coupleCourt/prompts/coupleCourtJudge.ko";
import { assessCourtSafety } from "@/lib/coupleCourt/safety";
import { COURT_IMMEDIATE_SAFETY_MESSAGE } from "@/lib/coupleCourt/support";
import { logAIInteraction } from "@/lib/compliance/ai-log";
import {
  COURT_VERDICT_PROVIDER_JSON_SCHEMA,
  validateCourtVerdict,
} from "@/lib/coupleCourt/schema";
import {
  isCourtCategory,
  isCourtMode,
  isCourtTone,
  isCourtVerdictStatus,
  type CourtCategory,
  type CourtMode,
  type CourtStatementInput,
  type CourtTone,
  type CourtVerdict,
} from "@/lib/coupleCourt/types";

export interface GenerateCourtVerdictInput {
  caseId: string;
  userId: string;
  coupleId?: string | null;
  mode: CourtMode;
  category: CourtCategory;
  tone: CourtTone;
  preflightSafetyLevel?: "normal" | "sensitive";
  statements: readonly CourtStatementInput[];
  /** Database-reserved key reused for every retry of this logical verdict. */
  providerRequestKey?: string;
  /** Canonical digest reserved in the cost ledger before the provider call. */
  providerRequestHash?: string;
  /** Server-derived exact denylist; never returned to the client or audit log. */
  knownEntities?: readonly string[];
  /** Stable case tenant (couple, or original creator before pairing). */
  safetyIdentifierScope?: string;
  /** Durable result fence, invoked after strict validation and before audit. */
  onValidated?: (
    verdict: CourtVerdict,
    response: Pick<AuditedOpenAIResponse, "model" | "usage">,
  ) => Promise<void>;
  signal?: AbortSignal;
}

export interface GenerateCourtVerdictResult {
  verdict: CourtVerdict;
  model: string;
  usage?: AuditedOpenAIResponse["usage"];
}

interface CourtVerdictAuditIdentity {
  userId: string | null;
  coupleId: string | null;
  mode: CourtMode;
  category: CourtCategory;
  tone: CourtTone;
  preflightSafetyLevel: "normal" | "sensitive";
  inputHash: string;
  /** Version that produced this exact paid response, not the running release. */
  promptVersion: string;
  /** Version that produced this exact paid response, not the running release. */
  schemaVersion: string;
}

function courtVerdictAudit(identity: CourtVerdictAuditIdentity) {
  return {
    interactionType: "couple_court_verdict" as const,
    userId: identity.userId,
    coupleId: identity.coupleId,
    userInput: null,
    aiOutput: null,
    metadata: {
      source: "couple_court_judge",
      mode: identity.mode,
      category: identity.category,
      tone: identity.tone,
      prompt_version: identity.promptVersion,
      schema_version: identity.schemaVersion,
      safety_level: identity.preflightSafetyLevel,
      input_hash: identity.inputHash,
    },
  };
}

/**
 * Completes the same exactly-once success audit after a durable staged result
 * is reclaimed. `logAIInteraction` verifies any duplicate key against this
 * complete semantic identity before treating it as reused.
 */
export async function logRecoveredCourtVerdictAudit(options: CourtVerdictAuditIdentity & {
  model: string;
  providerRequestKey: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheWriteInputTokens: number | null;
    cachedInputTokens: number | null;
  };
}): Promise<void> {
  const structuredOutputName = getCourtVerdictStructuredOutputName(options.schemaVersion);
  if (
    !/^[A-Za-z0-9._-]{1,64}$/.test(options.promptVersion)
    || !structuredOutputName
  ) {
    throw new Error("Unsupported Couple Court verdict audit identity");
  }
  const audit = courtVerdictAudit(options);
  await logAIInteraction({
    ...audit,
    required: true,
    idempotencyKey: options.providerRequestKey,
    latencyMs: 0,
    success: true,
    errorMessage: null,
    model: options.model,
    tokensInput: options.usage.inputTokens,
    tokensOutput: options.usage.outputTokens,
    cacheWriteTokens: options.usage.cacheWriteInputTokens,
    cacheReadTokens: options.usage.cachedInputTokens,
    // Recovery must not consult the running deployment's model environment.
    // These fields are the immutable v1 audit identity also enforced by the
    // database finalizer; a malformed future config cannot strand an already
    // paid and durably staged result.
    metadata: {
      ...audit.metadata,
      ai_provider: "openai",
      quota_class: "provider_call",
      model_role: COURT_VERDICT_MODEL_ROLE,
      reasoning_effort: "none",
      audit_wrapper: "createOpenAIStructuredResponseWithAudit",
      structured_output: true,
      schema_name: structuredOutputName,
    },
  });
}

export class CourtJudgeError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "ai_disabled"
    | "provider_unconfigured"
    | "mock_forbidden") {
    super(`[couple-court] verdict generation unavailable: ${code}`);
    this.name = "CourtJudgeError";
  }
}

function assertValidInput(input: GenerateCourtVerdictInput): void {
  if (
    !input.caseId.trim()
    || !input.userId.trim()
    || !isCourtMode(input.mode)
    || !isCourtCategory(input.category)
    || !isCourtTone(input.tone)
  ) {
    throw new CourtJudgeError("invalid_input");
  }

  const expectedRoles = input.mode === "solo"
    ? ["applicant"]
    : ["applicant", "partner"];
  const roles = input.statements.map((statement) => statement.role).sort();
  if (
    roles.length !== expectedRoles.length
    || roles.some((role, index) => role !== [...expectedRoles].sort()[index])
  ) {
    throw new CourtJudgeError("invalid_input");
  }

  const normalized = normalizeCourtStatements(input.statements);
  const totalLength = normalized.reduce((total, statement) => total
    + statement.facts.length
    + statement.feelings.length
    + statement.expectations.length
    + statement.priorAgreement.length
    + statement.attempts.length
    + statement.desiredOutcome.length
    + statement.changeCommitment.length
    + statement.evidenceSummaries.reduce((sum, item) => sum + item.length, 0), 0);
  if (
    totalLength < 20
    || totalLength > 12_000
    || normalized.some((statement) =>
      statement.facts.length < 10
      || statement.facts.length > 2_000
      || statement.feelings.length > 1_000
      || statement.expectations.length > 1_000
      || statement.priorAgreement.length > 1_000
      || statement.attempts.length > 1_000
      || statement.desiredOutcome.length > 1_000
      || statement.changeCommitment.length > 1_000
      || statement.evidenceSummaries.length > 5
      || statement.evidenceSummaries.some((item) => item.length > 500))
  ) {
    throw new CourtJudgeError("invalid_input");
  }
}

function safetyRedirectVerdict(input: GenerateCourtVerdictInput): CourtVerdict {
  const detectedSafety = assessCourtSafety(input.statements);
  const safety = input.preflightSafetyLevel === "sensitive"
    && detectedSafety.level === "normal"
    ? { ...detectedSafety, level: "sensitive" as const }
    : detectedSafety;
  const supportMessage = safety.resourceMessage
    ?? COURT_IMMEDIATE_SAFETY_MESSAGE;
  return validateCourtVerdict({
    schemaVersion: COURT_VERDICT_SCHEMA_VERSION,
    safety: {
      level: "high_risk",
      riskTypes: safety.categories,
      disablePlayfulVerdict: true,
      publicEligible: false,
      supportMessage,
    },
    caseMeta: {
      generatedTitle: "안전을 먼저 확인해야 하는 사건",
      category: input.category,
      provisional: input.mode === "solo",
    },
    caseSummary: "일반적인 책임 판정보다 현재의 안전을 먼저 확인해야 하는 내용이 감지됐습니다.",
    sharedFacts: [],
    differentViews: [],
    applicantNeeds: "안전한 장소와 신뢰할 수 있는 사람 또는 긴급기관의 도움",
    partnerNeeds: null,
    coreConflict: "커플 중재로 다루기 전에 즉각적인 안전 확인과 외부 지원이 필요합니다.",
    responsibility: null,
    verdict: {
      status: "safety_redirect",
      headline: "지금은 판결보다 안전이 먼저예요",
      reasons: ["위협·폭력 또는 자해·타해 가능성을 시사하는 표현이 감지됐습니다."],
      judgeOneLiner: null,
    },
    conversationScript: {
      opening: "지금은 상대를 설득하려 하지 말고 먼저 안전한 곳으로 이동해 주세요.",
      applicantLine: supportMessage,
      respondentLine: null,
    },
    missions: [],
    checkIn: {
      dueInDays: 1,
      question: "지금 안전한 장소에 있고 도움을 요청할 수 있나요?",
    },
    confidence: "low",
    limitations: ["이 기능은 긴급 신고, 의료 지원 또는 전문 상담을 대신하지 않습니다."],
    publicCard: null,
  }, {
    mode: input.mode,
    category: input.category,
    tone: input.tone,
    preflightSafetyLevel: "high_risk",
  });
}

function developmentMockVerdict(
  input: GenerateCourtVerdictInput,
  preflightLevel: "normal" | "sensitive",
): CourtVerdict {
  const sensitive = preflightLevel === "sensitive";
  return validateCourtVerdict({
    schemaVersion: COURT_VERDICT_SCHEMA_VERSION,
    safety: {
      level: preflightLevel,
      riskTypes: [],
      disablePlayfulVerdict: sensitive,
      publicEligible: !sensitive,
      supportMessage: sensitive ? "서로 안전하다고 느끼는 환경에서 대화를 이어가 주세요." : null,
    },
    caseMeta: {
      generatedTitle: "서로의 기준을 다시 맞추는 사건",
      category: input.category,
      provisional: input.mode === "solo",
    },
    caseSummary: "같은 결혼 준비 과제를 두고 기대한 속도와 상의 방식이 달랐던 상황입니다.",
    sharedFacts: ["결혼 준비와 관련해 두 사람이 다시 정해야 할 항목이 있습니다."],
    differentViews: [{
      applicant: "내 의견이 충분히 반영되지 않았다고 느꼈습니다.",
      respondent: input.mode === "couple" ? "결정 기준이나 마감에 대한 이해가 달랐습니다." : null,
    }],
    applicantNeeds: "결정 전에 의견을 확인하는 과정",
    partnerNeeds: input.mode === "couple" ? "현실적인 선택 기준과 명확한 마감" : null,
    coreConflict: "결정 내용보다 상의 시점과 역할에 대한 기대가 달랐습니다.",
    responsibility: {
      displayMode: "qualitative",
      applicant: null,
      respondent: null,
      shared: null,
      explanation: "누가 더 잘못했는지보다 다음 결정 절차를 합의하는 편이 유용합니다.",
    },
    verdict: {
      status: "settlement_recommended",
      headline: "오늘 정할 한 가지부터 합의해요",
      reasons: ["각자의 우선순위와 답변 기한을 구체적으로 말할 필요가 있습니다."],
      judgeOneLiner: input.tone === "spicy" && !sensitive
        ? "‘아무거나’에도 마감과 예산은 필요합니다."
        : null,
    },
    conversationScript: {
      opening: "누가 맞는지보다 오늘 정할 기준 하나부터 이야기해 볼까?",
      applicantLine: "나는 결정 전에 내 의견을 한 번 확인해 주면 좋겠어.",
      respondentLine: input.mode === "couple" ? "나는 마감과 선택 기준을 먼저 알면 답하기 쉬워." : null,
    },
    missions: [{
      title: "15분 합의 시간 잡기",
      description: "한 가지 쟁점의 예산, 담당자, 마감을 함께 적어 보세요.",
      owner: input.mode === "couple" ? "both" : "applicant",
      dueInMinutes: 1440,
      completionCheck: "두 사람이 같은 합의 문장을 확인했는지 체크해요.",
      funTag: null,
      relatedFeature: "task",
    }],
    checkIn: { dueInDays: 3, question: "정한 합의가 실제 준비를 앞으로 움직였나요?" },
    confidence: input.mode === "solo" ? "low" : "medium",
    limitations: [input.mode === "solo"
      ? "한쪽 진술만 바탕으로 한 임시 정리입니다."
      : "두 사람의 진술 외 사실을 독립적으로 확인하지 않았습니다."],
    publicCard: sensitive ? null : {
      safeTitle: "결정 기준을 다시 맞춘 사건",
      oneLine: "결정 내용보다 상의 시점과 역할을 먼저 합의하기로 했어요.",
      resultLabel: "절차 합의 권고",
      hashtags: ["결혼준비", "역할분담"],
    },
  }, {
    mode: input.mode,
    category: input.category,
    tone: input.tone,
    preflightSafetyLevel: preflightLevel,
  });
}

function providerInput(input: GenerateCourtVerdictInput) {
  const privacyOptions = { knownEntities: input.knownEntities ?? [] };
  return normalizeCourtStatements(input.statements).map((statement) => ({
    ...statement,
    facts: redactCourtText(statement.facts, privacyOptions).text,
    feelings: redactCourtText(statement.feelings, privacyOptions).text,
    expectations: redactCourtText(statement.expectations, privacyOptions).text,
    priorAgreement: redactCourtText(statement.priorAgreement, privacyOptions).text,
    attempts: redactCourtText(statement.attempts, privacyOptions).text,
    desiredOutcome: redactCourtText(statement.desiredOutcome, privacyOptions).text,
    changeCommitment: redactCourtText(statement.changeCommitment, privacyOptions).text,
    evidenceSummaries: statement.evidenceSummaries.map((item) => redactCourtText(item, privacyOptions).text),
  }));
}

/**
 * Discards model-authored share copy before it can affect validation, storage,
 * export, or public review. The replacement is derived only from server-known
 * enums and therefore cannot echo a name, venue, exact date, or amount.
 */
function withDeterministicShareCard(
  value: unknown,
  input: GenerateCourtVerdictInput,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  const safety = root.safety && typeof root.safety === "object" && !Array.isArray(root.safety)
    ? root.safety as Record<string, unknown>
    : {};
  const verdict = root.verdict && typeof root.verdict === "object" && !Array.isArray(root.verdict)
    ? root.verdict as Record<string, unknown>
    : {};
  const status = verdict.status;
  return {
    ...root,
    publicCard: safety.level === "normal" && isCourtVerdictStatus(status)
      ? buildCourtSafeShareCard({
          category: input.category,
          mode: input.mode,
          provisional: input.mode === "solo",
          verdictStatus: status,
        })
      : null,
  };
}

function effectivePreflightSafety(
  input: GenerateCourtVerdictInput,
): "normal" | "sensitive" | "high_risk" {
  const detected = assessCourtSafety(input.statements).level;
  if (detected === "high_risk") return "high_risk";
  return detected === "sensitive" || input.preflightSafetyLevel === "sensitive"
    ? "sensitive"
    : "normal";
}

function boundedProviderInput(
  input: GenerateCourtVerdictInput,
  preflightSafetyLevel: "normal" | "sensitive",
): string {
  return JSON.stringify({
    schemaVersion: COURT_VERDICT_SCHEMA_VERSION,
    promptVersion: COURT_VERDICT_PROMPT_VERSION,
    mode: input.mode,
    category: input.category,
    tone: input.tone,
    preflightSafetyLevel,
    statements: providerInput(input),
  });
}

/**
 * Digest of every semantic field that can change the paid Responses request.
 * Only the digest is stored; private statement text never enters the ledger.
 */
export function computeCourtProviderRequestHash(
  input: GenerateCourtVerdictInput,
): string {
  assertValidInput(input);
  const preflightSafetyLevel = effectivePreflightSafety(input);
  if (preflightSafetyLevel === "high_risk") {
    throw new CourtJudgeError("invalid_input");
  }
  const modelConfig = getAmoraModelConfig(COURT_VERDICT_MODEL_ROLE);
  const descriptor = {
    model: modelConfig.model,
    reasoningEffort: modelConfig.reasoningEffort,
    verbosity: modelConfig.verbosity,
    instructions: COUPLE_COURT_JUDGE_SYSTEM_PROMPT,
    input: `[UNTRUSTED_COURT_CASE_JSON]\n${boundedProviderInput(input, preflightSafetyLevel)}\n[/UNTRUSTED_COURT_CASE_JSON]`,
    maxOutputTokens: COURT_VERDICT_MAX_OUTPUT_TOKENS,
    responseFormatName: COURT_VERDICT_STRUCTURED_OUTPUT_NAME,
    responseSchema: COURT_VERDICT_PROVIDER_JSON_SCHEMA,
    safetyScope: input.safetyIdentifierScope ?? input.caseId,
    serviceTier: "default",
    promptCacheMode: "explicit",
    store: false,
  };
  return createHash("sha256").update(JSON.stringify(descriptor), "utf8").digest("hex");
}

export function computeCourtProviderRequestKey(options: {
  verdictId: string;
  inputHash: string;
  requestHash: string;
}): string {
  return createHash("sha256")
    .update(`couple-court-v1:${options.verdictId}:${options.inputHash}:${options.requestHash}`, "utf8")
    .digest("hex");
}

export async function generateCourtVerdict(
  input: GenerateCourtVerdictInput,
): Promise<GenerateCourtVerdictResult> {
  assertValidInput(input);
  if (process.env.NODE_ENV === "production" && process.env.COUPLE_COURT_MOCK_ENABLED === "true") {
    throw new CourtJudgeError("mock_forbidden");
  }
  const preflightSafetyLevel = effectivePreflightSafety(input);
  if (preflightSafetyLevel === "high_risk") {
    return {
      verdict: safetyRedirectVerdict(input),
      model: "deterministic-court-safety-v1",
    };
  }

  if (process.env.NODE_ENV !== "production" && process.env.COUPLE_COURT_MOCK_ENABLED === "true") {
    return {
      verdict: developmentMockVerdict(input, preflightSafetyLevel),
      model: "couple-court-development-mock-v1",
    };
  }
  if (
    process.env.NODE_ENV === "production"
    && (!input.providerRequestKey || !input.providerRequestHash)
  ) {
    // Production paid calls are legal only after the database reservation and
    // cost fence have issued both canonical digests.
    throw new CourtJudgeError("invalid_input");
  }
  if (process.env.COUPLE_COURT_AI_ENABLED !== "true") {
    throw new CourtJudgeError("ai_disabled");
  }
  if (!hasOpenAIConfig(COURT_VERDICT_MODEL_ROLE)) {
    throw new CourtJudgeError("provider_unconfigured");
  }

  const model = getAmoraModelConfig(COURT_VERDICT_MODEL_ROLE).model;
  const inputHash = computeCourtInputHash({
    mode: input.mode,
    category: input.category,
    tone: input.tone,
    preflightSafetyLevel,
    statements: input.statements,
    model,
  });
  const boundedInput = boundedProviderInput(input, preflightSafetyLevel);
  const providerRequestHash = computeCourtProviderRequestHash(input);
  if (input.providerRequestHash && input.providerRequestHash !== providerRequestHash) {
    throw new CourtJudgeError("invalid_input");
  }

  const response = await createOpenAIStructuredResponseWithAudit({
    modelRole: COURT_VERDICT_MODEL_ROLE,
    instructions: COUPLE_COURT_JUDGE_SYSTEM_PROMPT,
    input: `[UNTRUSTED_COURT_CASE_JSON]\n${boundedInput}\n[/UNTRUSTED_COURT_CASE_JSON]`,
    maxOutputTokens: COURT_VERDICT_MAX_OUTPUT_TOKENS,
    audit: courtVerdictAudit({
      userId: input.userId,
      coupleId: input.coupleId ?? null,
      mode: input.mode,
      category: input.category,
      tone: input.tone,
      preflightSafetyLevel,
      inputHash,
      promptVersion: COURT_VERDICT_PROMPT_VERSION,
      schemaVersion: COURT_VERDICT_SCHEMA_VERSION,
    }),
    responseFormat: {
      name: COURT_VERDICT_STRUCTURED_OUTPUT_NAME,
      description: "A bounded, safety-aware Korean couple mediation verdict.",
      schema: COURT_VERDICT_PROVIDER_JSON_SCHEMA,
    },
    safetyIdentifierScope: input.safetyIdentifierScope ?? input.caseId,
    validate: (value) => {
      const validated = validateCourtVerdict(withDeterministicShareCard(value, input), {
        mode: input.mode,
        category: input.category,
        tone: input.tone,
        preflightSafetyLevel,
      });
      return validateCourtVerdict(
        withDeterministicShareCard(
          sanitizePrivateCourtVerdict(validated, input.knownEntities ?? []),
          input,
        ),
        {
          mode: input.mode,
          category: input.category,
          tone: input.tone,
          preflightSafetyLevel,
        },
      );
    },
    idempotencyKey: input.providerRequestKey,
    successAuditIdempotencyKey: input.providerRequestKey,
    onValidated: input.onValidated,
    signal: input.signal,
  });

  return {
    verdict: response.data,
    model: response.model,
    usage: response.usage,
  };
}
