import {
  DEFAULT_AMORA_MODEL_BY_ROLE,
  getAmoraModelConfig,
  hasOpenAIConfig,
} from "@/lib/ai/modelConfig";
import {
  COURT_VERDICT_PROMPT_VERSION,
  COURT_VERDICT_SCHEMA_VERSION,
} from "@/lib/coupleCourt/config";
import { computeCourtInputHash } from "@/lib/coupleCourt/hash";
import {
  computeCourtProviderRequestHash,
  computeCourtProviderRequestKey,
  generateCourtVerdict,
  logRecoveredCourtVerdictAudit,
} from "@/lib/coupleCourt/judge";
import { validateCourtVerdict } from "@/lib/coupleCourt/schema";
import { assessCourtSafety } from "@/lib/coupleCourt/safety";
import { COURT_IMMEDIATE_SAFETY_MESSAGE } from "@/lib/coupleCourt/support";
import {
  claimCourtVerdictForUser,
  completeCourtVerdictForUser,
  escalateCourtCaseSafetyFromAiPreflight,
  failCourtVerdictForUser,
  finalizeCourtProviderAudit,
  getCourtCaseQuotaContextForUser,
  getCourtCaseForUser,
  getCourtParticipantNamesForPrivacy,
  getCourtStatementsForJudgment,
  getCourtUserContext,
  markCourtVerdictProviderStartedForUser,
  reserveCourtVerdictProviderCallForUser,
  settleCourtHighRiskProviderResultForUser,
  settleCourtUnstagedProviderResult,
  stageCourtVerdictProviderResultForUser,
} from "@/lib/coupleCourt/repository";
import {
  isCourtCategory,
  isCourtMode,
  isCourtTone,
  type CourtCategory,
  type CourtMode,
  type CourtParticipantRole,
  type CourtSafetyRiskType,
  type CourtStatementInput,
  type CourtTone,
} from "@/lib/coupleCourt/types";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  isCoupleCourtAiEnabled,
  noStoreJson,
  readCourtJson,
  requireCoupleCourtEnabled,
  requireCourtUser,
} from "../../../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

type UnknownRow = Record<string, unknown>;
type ProviderUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_write_input_tokens: number;
  cached_input_tokens: number;
};

interface UnstagedProviderAudit {
  userId: string;
  coupleId: string | null;
  mode: CourtMode;
  category: CourtCategory;
  tone: CourtTone;
  preflightSafetyLevel: "normal" | "sensitive";
  inputHash: string;
  promptVersion: string;
  schemaVersion: string;
  model: string;
  providerRequestKey: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheWriteInputTokens: number | null;
    cachedInputTokens: number | null;
  };
  rawUsage: ProviderUsage | undefined;
}

function stringValue(row: UnknownRow, key: string): string {
  return typeof row[key] === "string" ? row[key] : "";
}

function statementsForJudge(current: Awaited<ReturnType<typeof getCourtStatementsForJudgment>>): CourtStatementInput[] {
  const roleByParticipant = new Map<string, CourtParticipantRole>();
  for (const participant of current.participants as UnknownRow[]) {
    const id = stringValue(participant, "id");
    const role = stringValue(participant, "role");
    if (id && (role === "applicant" || role === "partner")) roleByParticipant.set(id, role);
  }
  return current.statements.map((row) => {
    const role = roleByParticipant.get(stringValue(row, "participant_id"));
    if (!role) {
      throw new CourtApiError(409, "COURT_STATEMENTS_INCOMPLETE", "제출된 진술의 역할을 확인하지 못했어요.");
    }
    return {
      role,
      facts: stringValue(row, "facts"),
      feelings: stringValue(row, "feelings"),
      expectations: stringValue(row, "expectations"),
      attempts: stringValue(row, "attempts"),
      desiredOutcome: stringValue(row, "desired_agreement"),
    };
  });
}

function safeJudgeErrorCode(error: unknown): string {
  if (error instanceof CourtApiError) return error.code.toLowerCase().slice(0, 80);
  if (error instanceof Error && error.name === "AbortError") return "provider_request_aborted";
  if (error instanceof Error && error.name === "OpenAIStructuredOutputError") return "structured_output_invalid";
  if (error instanceof Error && error.name === "CourtJudgeError") return "court_judge_unavailable";
  return "court_verdict_generation_failed";
}

export async function POST(request: Request, context: RouteContext) {
  let claimed: { verdictId: string; userId: string; leaseToken: string } | null = null;
  let providerResultStaged = false;
  let providerUnstagedSettled = false;
  // TypeScript cannot see assignments performed by the nested provider
  // callback when control later reaches the outer catch. A mutable ref keeps
  // that paid-response evidence both runtime-safe and correctly typed.
  const providerUnstagedAuditRef: { current: UnstagedProviderAudit | null } = {
    current: null,
  };
  let providerStarted = false;
  let providerHighRiskDetected = false;
  let providerHighRiskSettled = false;
  let providerHighRiskAuditFinalized = false;
  let providerHighRiskMessage: string | null = null;
  let providerHighRiskCategories: CourtSafetyRiskType[] = [];
  let providerHighRiskAuditModel: string | null = null;
  let activeInputHash: string | null = null;
  let activeProviderRequestKey: string | null = null;
  let providerHighRiskUsage: {
    input_tokens: number;
    output_tokens: number;
    cache_write_input_tokens: number;
    cached_input_tokens: number;
  } | undefined;
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:judge", request, user.id),
      { maxRequests: 10, windowMs: 24 * 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    await readCourtJson(request, 1024);
    const { caseId } = await context.params;
    if (!isUuid(caseId)) {
      throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
    }

    const current = await getCourtCaseForUser(caseId, user.id);
    const mode = current.case.mode;
    const category = current.case.category;
    const tone = current.case.tone;
    if (!isCourtMode(mode) || !isCourtCategory(category) || !isCourtTone(tone)) {
      throw new CourtApiError(409, "COURT_CASE_INVALID", "사건 분류를 확인하지 못했어요.");
    }
    if (
      current.case.workflow_status !== "statements_complete"
      && current.case.workflow_status !== "judging"
    ) {
      if (current.verdict) return noStoreJson({ status: "ready" });
      throw new CourtApiError(409, "COURT_STATEMENTS_INCOMPLETE", "필요한 진술을 모두 제출한 뒤 판결을 요청해 주세요.");
    }

    const statements = statementsForJudge(
      await getCourtStatementsForJudgment(caseId, user.id),
    );
    const knownEntities = await getCourtParticipantNamesForPrivacy(caseId, user.id);
    const expectedCount = mode === "solo" ? 1 : 2;
    if (statements.length !== expectedCount) {
      throw new CourtApiError(409, "COURT_STATEMENTS_INCOMPLETE", "필요한 진술을 모두 제출한 뒤 판결을 요청해 주세요.");
    }
    const safety = assessCourtSafety(statements);
    if (safety.level === "high_risk" || current.case.safety_level === "high_risk") {
      if (safety.level === "high_risk") {
        await escalateCourtCaseSafetyFromAiPreflight({
          caseId,
          userId: user.id,
          categories: safety.categories,
        });
      }
      throw new CourtApiError(
        409,
        "COURT_SAFETY_REDIRECT",
        safety.resourceMessage
          ?? COURT_IMMEDIATE_SAFETY_MESSAGE,
      );
    }
    const preflightSafetyLevel = current.case.safety_level === "sensitive"
      || safety.level === "sensitive"
      ? "sensitive" as const
      : "normal" as const;

    const mockConfigured = process.env.COUPLE_COURT_MOCK_ENABLED === "true";
    const mockEnabled = process.env.NODE_ENV !== "production" && mockConfigured;
    const mockForbidden = process.env.NODE_ENV === "production" && mockConfigured;
    const aiEnabled = isCoupleCourtAiEnabled();
    const providerConfigured = mockEnabled || hasOpenAIConfig("primary");
    // A disabled provider may still have a paid, staged result that must be
    // finalized. The RPC permits replay/recovery while fencing off every new
    // provider lease and cost boundary.
    const allowNewClaim = aiEnabled && providerConfigured && !mockForbidden;
    const model = mockEnabled
      ? "couple-court-development-mock-v1"
      : providerConfigured
        ? getAmoraModelConfig("primary").model
        : DEFAULT_AMORA_MODEL_BY_ROLE.primary;
    const inputHash = computeCourtInputHash({
      mode,
      category,
      tone,
      preflightSafetyLevel,
      statements,
      model,
    });
    activeInputHash = inputHash;
    const claim = await claimCourtVerdictForUser({
      caseId,
      userId: user.id,
      inputHash,
      promptVersion: COURT_VERDICT_PROMPT_VERSION,
      schemaVersion: COURT_VERDICT_SCHEMA_VERSION,
      model,
      // OpenAI has a 90s client timeout; leave bounded room for validation,
      // audit persistence and the fenced completion transaction.
      leaseSeconds: 180,
      allowNewClaim,
    });
    if (claim.claimStatus === "replay") {
      return noStoreJson({ status: "ready" });
    }
    if (claim.claimStatus === "in_progress") {
      return noStoreJson({ status: "judging" }, {
        status: 202,
        headers: { "Retry-After": "2" },
      });
    }
    if (
      claim.claimStatus === "unavailable"
      // Defense in depth: even if a future RPC regresses and returns an
      // executable lease during lookup-only mode, never cross the reservation
      // or paid-provider boundary.
      || (!allowNewClaim && claim.claimStatus === "execute")
    ) {
      if (mockForbidden) {
        throw new CourtApiError(
          503,
          "COURT_MOCK_FORBIDDEN",
          "운영 판결 설정을 확인하고 있어요. 잠시 후 다시 시도해 주세요.",
        );
      }
      if (!aiEnabled) {
        throw new CourtApiError(
          503,
          "COUPLE_COURT_AI_UNAVAILABLE",
          "지금은 한방 판결을 만들 수 없어요. 잠시 후 다시 시도해 주세요.",
        );
      }
      if (!providerConfigured) {
        throw new CourtApiError(
          503,
          "COURT_PROVIDER_UNCONFIGURED",
          "한방 판결 연결 설정을 확인하고 있어요. 잠시 후 다시 시도해 주세요.",
        );
      }
      throw new CourtApiError(
        503,
        "COURT_AI_UNAVAILABLE",
        "지금은 한방 판결을 만들 수 없어요. 잠시 후 다시 시도해 주세요.",
      );
    }
    if (!claim.verdictId || claim.generationVersion === null) {
      throw new CourtApiError(
        503,
        "COURT_VERDICT_CLAIM_INVALID",
        "판결 준비 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
    const activeVerdictId = claim.verdictId;
    if (!claim.leaseToken) {
      throw new CourtApiError(
        503,
        "COURT_VERDICT_LEASE_INVALID",
        "판결 준비 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
    const activeLeaseToken = claim.leaseToken;
    claimed = {
      verdictId: activeVerdictId,
      userId: user.id,
      leaseToken: activeLeaseToken,
    };

    if (claim.claimStatus === "staged") {
      providerResultStaged = true;
      if (
        !claim.result
        || !claim.model
        || !claim.auditModel
        || !claim.providerRequestKey
        || !claim.auditPreflightSafetyLevel
        || !claim.usage
        || !claim.inputHash
        || !claim.promptVersion
        || !claim.schemaVersion
      ) {
        throw new CourtApiError(
          503,
          "COURT_STAGED_RESULT_INVALID",
          "저장된 판결을 안전하게 마무리하지 못했어요. 잠시 후 다시 확인해 주세요.",
        );
      }
      const stagedVerdict = validateCourtVerdict(claim.result, {
        mode,
        category,
        tone,
        preflightSafetyLevel: claim.auditPreflightSafetyLevel,
      });
      if (JSON.stringify(stagedVerdict.missions) !== JSON.stringify(claim.missions)) {
        throw new CourtApiError(
          503,
          "COURT_STAGED_RESULT_INVALID",
          "저장된 판결을 안전하게 마무리하지 못했어요. 잠시 후 다시 확인해 주세요.",
        );
      }
      if (claim.providerAuditState === "pending") {
        await logRecoveredCourtVerdictAudit({
          userId: claim.auditUserId,
          coupleId: claim.auditCoupleId,
          mode,
          category,
          tone,
          preflightSafetyLevel: claim.auditPreflightSafetyLevel,
          inputHash: claim.inputHash,
          promptVersion: claim.promptVersion,
          schemaVersion: claim.schemaVersion,
          model: claim.auditModel,
          providerRequestKey: claim.providerRequestKey,
          usage: claim.usage,
        });
        await finalizeCourtProviderAudit({
          verdictId: activeVerdictId,
          requestKey: claim.providerRequestKey,
        });
      }
      await completeCourtVerdictForUser({
        verdictId: activeVerdictId,
        userId: user.id,
        leaseToken: claim.leaseToken,
        inputHash: claim.inputHash,
        result: stagedVerdict as unknown as UnknownRow,
        missions: claim.missions,
        model: claim.model,
      });
      claimed = null;
      providerResultStaged = false;
      return noStoreJson({ status: "ready" });
    }

    const {
      coupleId: caseCoupleId,
      safetyScopeId,
    } = await getCourtCaseQuotaContextForUser(caseId, user.id);
    const currentUserContext = await getCourtUserContext(user.id);
    const coupleId = caseCoupleId !== null
      && currentUserContext.coupleId === caseCoupleId
      ? caseCoupleId
      : null;
    let providerRequestKey: string | undefined;
    let providerRequestHash: string | undefined;
    if (!mockEnabled) {
      const providerInput = {
        caseId,
        userId: user.id,
        coupleId,
        mode,
        category,
        tone,
        preflightSafetyLevel,
        statements,
        knownEntities,
        safetyIdentifierScope: safetyScopeId,
      };
      providerRequestHash = computeCourtProviderRequestHash(providerInput);
      providerRequestKey = computeCourtProviderRequestKey({
        verdictId: activeVerdictId,
        inputHash,
        requestHash: providerRequestHash,
      });
      activeProviderRequestKey = providerRequestKey;
      const reservation = await reserveCourtVerdictProviderCallForUser({
        verdictId: activeVerdictId,
        userId: user.id,
        leaseToken: claim.leaseToken,
        inputHash,
        requestKey: providerRequestKey,
        requestHash: providerRequestHash,
        auditPreflightSafetyLevel: preflightSafetyLevel,
      });
      if (reservation.allowed !== true) {
        const resultUnknown = reservation.reason === "provider_result_unknown"
          || reservation.retry_disposition === "manual_reconciliation_required";
        throw new CourtApiError(
          resultUnknown ? 503 : 429,
          resultUnknown ? "COURT_PROVIDER_RESULT_UNKNOWN" : "COURT_AI_LIMIT_REACHED",
          resultUnknown
            ? "이전 요청의 처리 결과를 확인하고 있어요. 비용 중복을 막기 위해 자동 재요청하지 않습니다."
            : "오늘의 한방 판결 이용 한도에 도달했어요.",
        );
      }
    }

    // Recheck participation and state immediately before the provider boundary.
    const finalAccess = await getCourtCaseForUser(caseId, user.id);
    if (finalAccess.case.workflow_status !== "judging") {
      throw new CourtApiError(409, "COURT_STATE_CONFLICT", "사건 상태가 바뀌었어요. 새로고침해 주세요.");
    }
    if (!mockEnabled) {
      if (!providerRequestKey || !providerRequestHash) {
        throw new CourtApiError(503, "COURT_PROVIDER_RESERVATION_INVALID", "판결 비용 예약을 확인하지 못했어요.");
      }
      // This is the irreversible paid-call boundary. Once marked started, any
      // unknown result is terminal/manual and must never be retried
      // automatically, even with the same correlation header.
      await markCourtVerdictProviderStartedForUser({
        verdictId: activeVerdictId,
        userId: user.id,
        leaseToken: claim.leaseToken,
        inputHash,
        requestKey: providerRequestKey,
        requestHash: providerRequestHash,
      });
      providerStarted = true;
    }
    const generated = await generateCourtVerdict({
      caseId,
      userId: user.id,
      coupleId,
      mode,
      category,
      tone,
      preflightSafetyLevel,
      statements,
      knownEntities,
      safetyIdentifierScope: safetyScopeId,
      providerRequestKey,
      providerRequestHash,
      onValidated: mockEnabled
        ? undefined
        : async (verdict, response) => {
            // Capture the payload-free audit identity before either persistence
            // path. If the callback throws after the paid response arrives,
            // the catch path can recreate the exact keyed audit without ever
            // retaining verdict prose or missions.
            providerUnstagedAuditRef.current = {
              userId: user.id,
              coupleId,
              mode,
              category,
              tone,
              preflightSafetyLevel,
              inputHash,
              promptVersion: COURT_VERDICT_PROMPT_VERSION,
              schemaVersion: COURT_VERDICT_SCHEMA_VERSION,
              model: response.model,
              providerRequestKey: providerRequestKey!,
              usage: {
                inputTokens: response.usage?.input_tokens ?? null,
                outputTokens: response.usage?.output_tokens ?? null,
                cacheWriteInputTokens: response.usage?.cache_write_input_tokens ?? null,
                cachedInputTokens: response.usage?.cached_input_tokens ?? null,
              },
              rawUsage: response.usage,
            };
            if (verdict.safety.level === "high_risk") {
              providerHighRiskDetected = true;
              providerHighRiskMessage = verdict.safety.supportMessage
                ?? COURT_IMMEDIATE_SAFETY_MESSAGE;
              providerHighRiskCategories = verdict.safety.riskTypes;
              providerHighRiskAuditModel = response.model;
              providerHighRiskUsage = response.usage;
              await settleCourtHighRiskProviderResultForUser({
                verdictId: activeVerdictId,
                userId: user.id,
                leaseToken: activeLeaseToken,
                inputHash,
                requestKey: providerRequestKey!,
                categories: verdict.safety.riskTypes,
                auditModel: response.model,
                usage: response.usage,
              });
              providerHighRiskSettled = true;
              return;
            }
            try {
              await stageCourtVerdictProviderResultForUser({
                verdictId: activeVerdictId,
                userId: user.id,
                leaseToken: activeLeaseToken,
                inputHash,
                result: verdict as unknown as UnknownRow,
                missions: verdict.missions as unknown as UnknownRow[],
                model,
                auditModel: response.model,
                usage: response.usage,
              });
              providerResultStaged = true;
            } catch (stageError) {
              try {
                const settlement = await settleCourtUnstagedProviderResult({
                  verdictId: activeVerdictId,
                  leaseToken: activeLeaseToken,
                  inputHash,
                  requestKey: providerRequestKey!,
                  auditModel: response.model,
                  usage: response.usage,
                });
                if (settlement.provider_state === "result_staged") {
                  providerResultStaged = true;
                } else if (settlement.provider_state === "failed_invalid") {
                  providerUnstagedSettled = true;
                } else {
                  throw new Error("COUPLE_COURT_UNSTAGED_SETTLEMENT_INVALID");
                }
              } catch {
                // The route catch retries this payload-free settlement before
                // falling back to the existing manual unknown-result fence.
                console.error("COUPLE_COURT_UNSTAGED_PROVIDER_SETTLEMENT_FAILED");
              }
              throw stageError;
            }
          },
      // The paid request belongs to the server lease, not to the browser
      // connection. Navigation or a dropped mobile network must not abort a
      // started provider call and strand it as an unknown paid result.
      signal: mockEnabled ? undefined : AbortSignal.timeout(90_000),
    });
    if (generated.verdict.safety.level === "high_risk") {
      providerHighRiskDetected = true;
      providerHighRiskMessage = generated.verdict.safety.supportMessage
        ?? COURT_IMMEDIATE_SAFETY_MESSAGE;
      providerHighRiskCategories = generated.verdict.safety.riskTypes;
      if (!mockEnabled && providerRequestKey) {
        await finalizeCourtProviderAudit({
          verdictId: activeVerdictId,
          requestKey: providerRequestKey,
        });
        providerHighRiskAuditFinalized = true;
      }
      claimed = null;
      throw new CourtApiError(
        409,
        "COURT_SAFETY_REDIRECT",
        generated.verdict.safety.supportMessage
          ?? COURT_IMMEDIATE_SAFETY_MESSAGE,
      );
    }
    if (!mockEnabled && providerRequestKey) {
      await finalizeCourtProviderAudit({
        verdictId: activeVerdictId,
        requestKey: providerRequestKey,
      });
    }
    await completeCourtVerdictForUser({
      verdictId: activeVerdictId,
      userId: user.id,
      leaseToken: claim.leaseToken,
      inputHash,
      result: generated.verdict as unknown as UnknownRow,
      missions: generated.verdict.missions as unknown as UnknownRow[],
      // The fenced claim contract is bound to the resolved request model.
      // Provider aliases or response metadata must not mutate that identity.
      model,
    });
    claimed = null;
    return noStoreJson({ status: "ready" });
  } catch (error) {
    if (providerHighRiskDetected) {
      const highRiskClaim = claimed;
      const highRiskInputHash = activeInputHash;
      const highRiskRequestKey = activeProviderRequestKey;
      const highRiskAuditModel = providerHighRiskAuditModel;
      const canSettleHighRisk = Boolean(
        highRiskClaim
        && highRiskInputHash
        && highRiskRequestKey
        && highRiskAuditModel
        && providerHighRiskCategories.length > 0,
      );
      const settleHighRisk = async () => {
        if (
          !highRiskClaim
          || !highRiskInputHash
          || !highRiskRequestKey
          || !highRiskAuditModel
          || providerHighRiskCategories.length === 0
        ) return;
        await settleCourtHighRiskProviderResultForUser({
          verdictId: highRiskClaim.verdictId,
          userId: highRiskClaim.userId,
          leaseToken: highRiskClaim.leaseToken,
          inputHash: highRiskInputHash,
          requestKey: highRiskRequestKey,
          categories: providerHighRiskCategories,
          auditModel: highRiskAuditModel,
          usage: providerHighRiskUsage,
        });
        providerHighRiskSettled = true;
      };

      if (!providerHighRiskSettled && canSettleHighRisk) {
        try {
          await settleHighRisk();
        } catch {
          console.error("COUPLE_COURT_PROVIDER_HIGH_RISK_SETTLEMENT_RETRY_FAILED");
        }
      }
      if (!providerHighRiskSettled && highRiskClaim) {
        // Persist the terminal lease first, then immediately replay the
        // payload-free high-risk settlement. This closes the recoverable
        // failed_unknown race without issuing another provider request.
        try {
          await failCourtVerdictForUser({
            verdictId: highRiskClaim.verdictId,
            userId: highRiskClaim.userId,
            leaseToken: highRiskClaim.leaseToken,
            errorCode: "safety_escalation_failed",
          });
        } catch {
          console.error("COUPLE_COURT_PROVIDER_SAFETY_FAIL_MARK_FAILED");
        }
        if (canSettleHighRisk) {
          try {
            await settleHighRisk();
          } catch {
            console.error("COUPLE_COURT_PROVIDER_HIGH_RISK_POST_FAIL_SETTLEMENT_FAILED");
          }
        }
      }
      if (
        providerHighRiskSettled
        && !providerHighRiskAuditFinalized
        && highRiskClaim
        && highRiskRequestKey
      ) {
        try {
          const audit = providerUnstagedAuditRef.current;
          if (audit) {
            await logRecoveredCourtVerdictAudit({
              userId: audit.userId,
              coupleId: audit.coupleId,
              mode: audit.mode,
              category: audit.category,
              tone: audit.tone,
              preflightSafetyLevel: audit.preflightSafetyLevel,
              inputHash: audit.inputHash,
              promptVersion: audit.promptVersion,
              schemaVersion: audit.schemaVersion,
              model: audit.model,
              providerRequestKey: audit.providerRequestKey,
              usage: audit.usage,
            });
          }
          await finalizeCourtProviderAudit({
            verdictId: highRiskClaim.verdictId,
            requestKey: highRiskRequestKey,
          });
          providerHighRiskAuditFinalized = true;
        } catch {
          // A durable pending audit envelope remains claimable by the admin
          // recovery worker. Safety has already been escalated atomically.
          console.error("COUPLE_COURT_PROVIDER_HIGH_RISK_AUDIT_PENDING");
        }
      }
      claimed = null;
      return courtErrorResponse(new CourtApiError(
        409,
        "COURT_SAFETY_REDIRECT",
        providerHighRiskMessage ?? COURT_IMMEDIATE_SAFETY_MESSAGE,
      ));
    }
    if (
      claimed
      && !providerResultStaged
      && providerUnstagedAuditRef.current
      && activeInputHash
      && activeProviderRequestKey
    ) {
      const unstagedAudit = providerUnstagedAuditRef.current;
      if (!providerUnstagedSettled) {
        try {
          const settlement = await settleCourtUnstagedProviderResult({
            verdictId: claimed.verdictId,
            leaseToken: claimed.leaseToken,
            inputHash: activeInputHash,
            requestKey: activeProviderRequestKey,
            auditModel: unstagedAudit.model,
            usage: unstagedAudit.rawUsage,
          });
          if (settlement.provider_state === "result_staged") {
            providerResultStaged = true;
          } else if (settlement.provider_state === "failed_invalid") {
            providerUnstagedSettled = true;
          }
        } catch {
          console.error("COUPLE_COURT_UNSTAGED_PROVIDER_SETTLEMENT_RETRY_FAILED");
        }
      }
    }
    if (claimed && !providerResultStaged && !providerUnstagedSettled) {
      let failed = false;
      try {
        failed = await failCourtVerdictForUser({
          verdictId: claimed.verdictId,
          userId: claimed.userId,
          leaseToken: claimed.leaseToken,
          errorCode: safeJudgeErrorCode(error),
        });
        if (!failed) providerResultStaged = true;
      } catch {
        console.error("COUPLE_COURT_VERDICT_FAIL_MARK_FAILED");
      }

      // A validated provider response is known and billable. Once the generic
      // failure fence has persisted its terminal lease, replay the payload-free
      // settlement from failed_unknown so a transient stage outage cannot
      // leave the paid call permanently unaudited.
      const audit = providerUnstagedAuditRef.current;
      if (
        audit
        && activeInputHash
        && activeProviderRequestKey
        && !providerResultStaged
        && !providerUnstagedSettled
      ) {
        try {
          const settlement = await settleCourtUnstagedProviderResult({
            verdictId: claimed.verdictId,
            leaseToken: claimed.leaseToken,
            inputHash: activeInputHash,
            requestKey: activeProviderRequestKey,
            auditModel: audit.model,
            usage: audit.rawUsage,
          });
          if (settlement.provider_state === "result_staged") {
            providerResultStaged = true;
          } else if (settlement.provider_state === "failed_invalid") {
            providerUnstagedSettled = true;
          }
        } catch {
          console.error("COUPLE_COURT_UNSTAGED_PROVIDER_POST_FAIL_SETTLEMENT_FAILED");
        }
      }
    }
    if (
      claimed
      && providerUnstagedSettled
      && providerUnstagedAuditRef.current
      && activeProviderRequestKey
    ) {
      const unstagedAudit = providerUnstagedAuditRef.current;
      try {
        await logRecoveredCourtVerdictAudit({
            userId: unstagedAudit.userId,
            coupleId: unstagedAudit.coupleId,
            mode: unstagedAudit.mode,
            category: unstagedAudit.category,
            tone: unstagedAudit.tone,
            preflightSafetyLevel: unstagedAudit.preflightSafetyLevel,
            inputHash: unstagedAudit.inputHash,
            promptVersion: unstagedAudit.promptVersion,
            schemaVersion: unstagedAudit.schemaVersion,
            model: unstagedAudit.model,
            providerRequestKey: unstagedAudit.providerRequestKey,
            usage: unstagedAudit.usage,
        });
        await finalizeCourtProviderAudit({
          verdictId: claimed.verdictId,
          requestKey: activeProviderRequestKey,
        });
      } catch {
        // The payload-free envelope remains in the service-only audit queue.
        console.error("COUPLE_COURT_UNSTAGED_PROVIDER_AUDIT_PENDING");
      }

      try {
        const latest = await getCourtCaseForUser((await context.params).caseId, claimed.userId);
        if (latest.case.workflow_status === "archived") {
          claimed = null;
          return courtErrorResponse(new CourtApiError(
            409,
            "COURT_CASE_ARCHIVED",
            "사건이 보관되어 판결 마무리를 중단했어요.",
          ));
        }
        if (latest.case.safety_level === "high_risk") {
          claimed = null;
          return courtErrorResponse(new CourtApiError(
            409,
            "COURT_SAFETY_REDIRECT",
            COURT_IMMEDIATE_SAFETY_MESSAGE,
          ));
        }
      } catch (stateError) {
        if (stateError instanceof CourtApiError && stateError.status === 404) {
          claimed = null;
          return courtErrorResponse(stateError);
        }
      }

      claimed = null;
      return courtErrorResponse(new CourtApiError(
        503,
        "COURT_PROVIDER_RESULT_UNSTAGED",
        "판결 비용은 중복되지 않게 기록했지만 결과 저장을 마무리하지 못했어요. 운영 확인 전에는 자동으로 다시 요청하지 않습니다.",
      ));
    }
    if (providerResultStaged) {
      try {
        const stateUserId = claimed?.userId;
        if (stateUserId) {
          const latest = await getCourtCaseForUser((await context.params).caseId, stateUserId);
          if (latest.case.workflow_status === "archived") {
            return courtErrorResponse(new CourtApiError(
              409,
              "COURT_CASE_ARCHIVED",
              "사건이 보관되어 판결 마무리를 중단했어요.",
            ));
          }
          if (latest.case.safety_level === "high_risk") {
            return courtErrorResponse(new CourtApiError(
              409,
              "COURT_SAFETY_REDIRECT",
              COURT_IMMEDIATE_SAFETY_MESSAGE,
            ));
          }
        }
      } catch (stateError) {
        if (stateError instanceof CourtApiError && stateError.status === 404) {
          return courtErrorResponse(stateError);
        }
        return noStoreJson({
          code: "COURT_FINALIZATION_STATE_UNAVAILABLE",
          error: "판결 마무리 상태를 확인하고 있어요. 잠시 후 사건 화면에서 다시 확인해 주세요.",
        }, {
          status: 503,
          headers: { "Retry-After": "2" },
        });
      }
      return noStoreJson({
        code: "COURT_VERDICT_FINALIZATION_PENDING",
        error: "판결 결과는 안전하게 저장했고 마무리 중이에요. 잠시 후 다시 확인해 주세요.",
      }, {
        status: 503,
        headers: { "Retry-After": "2" },
      });
    }
    if (error instanceof Error && error.name === "CourtJudgeError") {
      return courtErrorResponse(new CourtApiError(
        503,
        "COURT_AI_UNAVAILABLE",
        "지금은 한방 판결을 만들 수 없어요. 잠시 후 다시 시도해 주세요.",
      ));
    }
    if (error instanceof Error && error.name === "OpenAIStructuredOutputError") {
      return courtErrorResponse(new CourtApiError(
        502,
        "COURT_VERDICT_FORMAT_INVALID",
        "판결 형식을 안전하게 확인하지 못했어요. 다시 시도해 주세요.",
      ));
    }
    if (providerStarted) {
      return courtErrorResponse(new CourtApiError(
        503,
        "COURT_PROVIDER_RESULT_UNKNOWN",
        "이전 판결 요청의 처리 결과를 운영팀이 확인하고 있어요. 비용 중복을 막기 위해 자동으로 다시 요청하지 않습니다.",
      ));
    }
    return courtErrorResponse(error);
  }
}
