// =============================================
// Amora Couple Profile Memory
// =============================================
// Quietly compiles durable couple-specific preferences after useful chat turns.
// This does not train the global model. It updates a per-couple profile row that
// is injected into future prompts, with shared/private visibility isolation.
// =============================================

import { createAdminClient } from "@/lib/supabase/admin";
import { createOpenAIStructuredResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import {
  AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
  blockLegacyAuxiliaryProviderGeneration,
} from "@/lib/ai/amoraRequestPolicy";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

export type AmoraProfileVisibility = "shared" | "bride_private" | "groom_private";

export interface AmoraProfileEvidence {
  insight: string;
  source?: string;
  confidence?: number;
  at?: string;
}

export interface AmoraCoupleProfile {
  id: string;
  coupleId: string;
  visibility: AmoraProfileVisibility;
  personaSummary: string | null;
  budgetPosture: string | null;
  decisionStyle: string | null;
  tasteProfile: string | null;
  communicationStyle: string | null;
  conflictPattern: string | null;
  sensitiveTopics: string[];
  recommendationRules: string[];
  openQuestions: string[];
  confidenceScore: number;
  evidence: AmoraProfileEvidence[];
  version: number;
  lastCompiledAt: string | null;
  updatedAt: string | null;
}

export interface AmoraProfileBundle {
  shared: AmoraCoupleProfile | null;
  private: AmoraCoupleProfile | null;
}

interface DbAmoraCoupleProfile {
  id: string;
  couple_id: string;
  visibility: AmoraProfileVisibility;
  persona_summary: string | null;
  budget_posture: string | null;
  decision_style: string | null;
  taste_profile: string | null;
  communication_style: string | null;
  conflict_pattern: string | null;
  sensitive_topics: string[] | null;
  recommendation_rules: string[] | null;
  open_questions: string[] | null;
  confidence_score: number | string | null;
  evidence: unknown;
  version: number | null;
  last_compiled_at: string | null;
  updated_at: string | null;
}

interface MessageInput {
  role: "user" | "assistant";
  content: string | unknown;
  id?: string;
}

interface MaybeUpdateAmoraProfileInput {
  coupleId: string;
  userId?: string | null;
  visibility: AmoraProfileVisibility;
  messages: MessageInput[];
  lastUserText: string;
  aiResponseText: string;
  currentProfile?: AmoraCoupleProfile | null;
  stageTag?: string | null;
  isDemo?: boolean;
}

const MAX_MESSAGE_CHARS = 900;
const MAX_INPUT_CHARS = 8_000;
const MAX_CURRENT_PROFILE_CHARS = 20_000;
const MAX_TEXT_FIELD_CHARS = 500;
const MAX_LIST_ITEMS = 8;
const MAX_LIST_ITEM_CHARS = 140;
const MAX_EVIDENCE_ITEMS = 6;

type AmoraProfileMemoryMode = "off" | "conservative" | "full";

function getAmoraProfileMemoryMode(): AmoraProfileMemoryMode {
  const raw = (
    process.env.AMORA_PROFILE_MEMORY_MODE ??
    process.env.AMORA_PROFILE_MEMORY_ENABLED ??
    "conservative"
  ).toLowerCase();

  if (raw === "false" || raw === "0" || raw === "off") return "off";
  if (raw === "full") return "full";
  return "conservative";
}

function isAmoraProfileMemoryEnabled(): boolean {
  return getAmoraProfileMemoryMode() !== "off";
}

function canStoreSensitiveProfileFields(): boolean {
  return getAmoraProfileMemoryMode() === "full";
}

const SIGNAL_WORDS = [
  "좋아", "싫어", "원해", "선호", "스타일", "취향", "중요", "걱정", "불안", "고민",
  "예산", "비싸", "저렴", "가성비", "프리미엄", "부모", "엄마", "아빠", "시어",
  "신랑", "신부", "하객", "계약", "예약", "결정", "변경", "취소", "상담",
];

const PROFILE_SIGNAL_PATTERNS = [
  /저희|우리|저는|제가|나는|예산|취향|선호|싫어|좋아|중요|고민|걱정|불안/,
  /부모|엄마|아빠|시댁|친정|신랑|신부|상대|둘이|하객|지역|날짜|결혼식/,
  /웨딩홀|스드메|스튜디오|드레스|메이크업|본식|스냅|계약|예약|결정/,
  /비싸|저렴|가성비|프리미엄|추가금|보증인원|식대|대관료/,
];

const GENERIC_REQUEST_PATTERNS = [
  /알려줘|정리해줘|설명해줘|체크해줘|분석해줘|추천해줘/,
  /뭐부터|어떻게 해야|괜찮아|맞아|틀렸|확인/,
];

const SKIP_MARKERS = [
  "[INITIAL_GREETING]",
  "[MEDIATION_REQUEST]",
  "[quote_analysis]",
];

function mapRow(row: DbAmoraCoupleProfile): AmoraCoupleProfile {
  const evidence = Array.isArray(row.evidence)
    ? row.evidence
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => ({
          insight: typeof item.insight === "string" ? item.insight : "",
          source: typeof item.source === "string" ? item.source : undefined,
          confidence: typeof item.confidence === "number" ? item.confidence : undefined,
          at: typeof item.at === "string" ? item.at : undefined,
        }))
        .filter((item) => item.insight.length > 0)
        .slice(0, MAX_EVIDENCE_ITEMS)
    : [];

  return {
    id: row.id,
    coupleId: row.couple_id,
    visibility: row.visibility,
    personaSummary: row.persona_summary,
    budgetPosture: row.budget_posture,
    decisionStyle: row.decision_style,
    tasteProfile: row.taste_profile,
    communicationStyle: row.communication_style,
    conflictPattern: row.conflict_pattern,
    sensitiveTopics: row.sensitive_topics ?? [],
    recommendationRules: row.recommendation_rules ?? [],
    openQuestions: row.open_questions ?? [],
    confidenceScore: Number(row.confidence_score ?? 0.5),
    evidence,
    version: row.version ?? 1,
    lastCompiledAt: row.last_compiled_at,
    updatedAt: row.updated_at,
  };
}

function applyProfileMemoryMode(profile: AmoraCoupleProfile): AmoraCoupleProfile {
  if (canStoreSensitiveProfileFields()) return profile;
  return {
    ...profile,
    conflictPattern: null,
    sensitiveTopics: [],
  };
}

export async function loadAmoraProfiles(
  coupleId: string,
  visibility: AmoraProfileVisibility
): Promise<AmoraProfileBundle> {
  if (!isAmoraProfileMemoryEnabled()) return { shared: null, private: null };

  try {
    const admin = createAdminClient();
    const visibilities = visibility === "shared" ? ["shared"] : ["shared", visibility];
    const { data, error } = await admin
      .from("amora_couple_profiles")
      .select(
        "id, couple_id, visibility, persona_summary, budget_posture, decision_style, taste_profile, communication_style, conflict_pattern, sensitive_topics, recommendation_rules, open_questions, confidence_score, evidence, version, last_compiled_at, updated_at"
      )
      .eq("couple_id", coupleId)
      .in("visibility", visibilities);

    if (error) {
      console.warn("[amora-profile] load skipped", safeErrorDiagnostic(error));
      return { shared: null, private: null };
    }

    const rows = ((data ?? []) as DbAmoraCoupleProfile[]).map(mapRow).map(applyProfileMemoryMode);
    return {
      shared: rows.find((row) => row.visibility === "shared") ?? null,
      private: visibility === "shared"
        ? null
        : rows.find((row) => row.visibility === visibility) ?? null,
    };
  } catch (err) {
    console.warn("[amora-profile] load failed", safeErrorDiagnostic(err));
    return { shared: null, private: null };
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text?: string } =>
        typeof block === "object" && block !== null && "type" in block
      )
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join(" ");
  }
  return "";
}

function formatMessagesForProfile(messages: MessageInput[]): string {
  const lines: string[] = [];
  for (const message of messages.slice(-6)) {
    const text = stringifyContent(message.content).trim();
    if (!text) continue;
    const role = message.role === "assistant" ? "아모라" : "사용자";
    const truncated = text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}...` : text;
    lines.push(`${role}: ${truncated}`);
  }
  const joined = lines.join("\n");
  return joined.length > MAX_INPUT_CHARS ? joined.slice(-MAX_INPUT_CHARS) : joined;
}

function shouldAttemptProfileUpdate(input: MaybeUpdateAmoraProfileInput): boolean {
  if (input.isDemo) return false;
  const userText = input.lastUserText.trim();
  const aiText = input.aiResponseText.trim();
  if (!userText || !aiText) return false;
  if (SKIP_MARKERS.some((marker) => userText.includes(marker))) return false;
  const hasProfileSignal =
    PROFILE_SIGNAL_PATTERNS.some((pattern) => pattern.test(userText)) ||
    SIGNAL_WORDS.some((word) => userText.includes(word));
  if (!hasProfileSignal) return false;

  const looksGenericOnly =
    GENERIC_REQUEST_PATTERNS.some((pattern) => pattern.test(userText)) &&
    !/(저희|우리|저는|제가|나는|예산|취향|선호|고민|걱정|불안|부모|신랑|신부|하객|지역|날짜)/.test(userText);
  if (looksGenericOnly) return false;

  return userText.length >= 8;
}

function profileForPrompt(profile: AmoraCoupleProfile | null | undefined): Record<string, unknown> | null {
  if (!profile) return null;
  return {
    persona_summary: sanitizeText(profile.personaSummary, null),
    budget_posture: sanitizeText(profile.budgetPosture, null),
    decision_style: sanitizeText(profile.decisionStyle, null),
    taste_profile: sanitizeText(profile.tasteProfile, null),
    communication_style: sanitizeText(profile.communicationStyle, null),
    conflict_pattern: sanitizeText(profile.conflictPattern, null),
    sensitive_topics: sanitizeList(profile.sensitiveTopics, []),
    recommendation_rules: sanitizeList(profile.recommendationRules, []),
    open_questions: sanitizeList(profile.openQuestions, []),
    confidence_score: sanitizeConfidence(profile.confidenceScore, 0.5),
    evidence: sanitizeEvidence(profile.evidence, []),
    version: profile.version,
  };
}

function compactJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return json.length <= MAX_CURRENT_PROFILE_CHARS
    ? json
    : JSON.stringify({ omitted_due_to_size: true });
}

function sanitizeText(value: unknown, fallback: string | null): string | null {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.length > MAX_TEXT_FIELD_CHARS ? trimmed.slice(0, MAX_TEXT_FIELD_CHARS) : trimmed;
}

function sanitizeList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.slice(0, MAX_LIST_ITEM_CHARS));
  return Array.from(new Set(list)).slice(0, MAX_LIST_ITEMS);
}

function sanitizeConfidence(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, Math.round(numeric * 100) / 100));
}

function sanitizeEvidence(value: unknown, fallback: AmoraProfileEvidence[]): AmoraProfileEvidence[] {
  if (!Array.isArray(value)) return fallback.slice(0, MAX_EVIDENCE_ITEMS);
  const evidence = value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      insight: typeof item.insight === "string" ? item.insight.trim().slice(0, MAX_LIST_ITEM_CHARS) : "",
      source: typeof item.source === "string" ? item.source.trim().slice(0, 60) : undefined,
      confidence: typeof item.confidence === "number" ? sanitizeConfidence(item.confidence, 0.5) : undefined,
      at: typeof item.at === "string" ? item.at.trim().slice(0, 40) : undefined,
    }))
    .filter((item) => item.insight.length > 0);
  return evidence.slice(0, MAX_EVIDENCE_ITEMS);
}

interface AmoraProfileUpdateResponse {
  shouldUpdate: boolean;
  profile: Record<string, unknown> | null;
}

const nullableProfileText = (maxLength: number): Record<string, unknown> => ({
  anyOf: [
    { type: "string", maxLength },
    { type: "null" },
  ],
});

const PROFILE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["should_update", "profile"],
  properties: {
    should_update: { type: "boolean" },
    profile: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: [
            "persona_summary",
            "budget_posture",
            "decision_style",
            "taste_profile",
            "communication_style",
            "conflict_pattern",
            "sensitive_topics",
            "recommendation_rules",
            "open_questions",
            "confidence_score",
            "evidence",
          ],
          properties: {
            persona_summary: nullableProfileText(MAX_TEXT_FIELD_CHARS),
            budget_posture: nullableProfileText(MAX_TEXT_FIELD_CHARS),
            decision_style: nullableProfileText(MAX_TEXT_FIELD_CHARS),
            taste_profile: nullableProfileText(MAX_TEXT_FIELD_CHARS),
            communication_style: nullableProfileText(MAX_TEXT_FIELD_CHARS),
            conflict_pattern: nullableProfileText(MAX_TEXT_FIELD_CHARS),
            sensitive_topics: {
              type: "array",
              maxItems: MAX_LIST_ITEMS,
              items: { type: "string", maxLength: MAX_LIST_ITEM_CHARS },
            },
            recommendation_rules: {
              type: "array",
              maxItems: MAX_LIST_ITEMS,
              items: { type: "string", maxLength: MAX_LIST_ITEM_CHARS },
            },
            open_questions: {
              type: "array",
              maxItems: MAX_LIST_ITEMS,
              items: { type: "string", maxLength: MAX_LIST_ITEM_CHARS },
            },
            confidence_score: { type: "number", minimum: 0, maximum: 1 },
            evidence: {
              type: "array",
              maxItems: MAX_EVIDENCE_ITEMS,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["insight", "source", "confidence", "at"],
                properties: {
                  insight: { type: "string", minLength: 1, maxLength: MAX_LIST_ITEM_CHARS },
                  source: nullableProfileText(60),
                  confidence: {
                    anyOf: [
                      { type: "number", minimum: 0, maximum: 1 },
                      { type: "null" },
                    ],
                  },
                  at: nullableProfileText(40),
                },
              },
            },
          },
        },
        { type: "null" },
      ],
    },
  },
};

function isBoundedNullableText(value: unknown, maxLength: number): boolean {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function isBoundedStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_LIST_ITEMS &&
    value.every((item) => typeof item === "string" && item.length <= MAX_LIST_ITEM_CHARS)
  );
}

export function validateAmoraProfileUpdate(value: unknown): AmoraProfileUpdateResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid profile response");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.should_update !== "boolean") throw new Error("invalid should_update");
  if (record.profile === null) {
    if (record.should_update) throw new Error("profile required when update is true");
    return { shouldUpdate: false, profile: null };
  }
  if (!record.profile || typeof record.profile !== "object" || Array.isArray(record.profile)) {
    throw new Error("invalid profile payload");
  }
  if (!record.should_update) throw new Error("profile must be null when update is false");

  const profile = record.profile as Record<string, unknown>;
  for (const key of [
    "persona_summary",
    "budget_posture",
    "decision_style",
    "taste_profile",
    "communication_style",
    "conflict_pattern",
  ]) {
    if (!isBoundedNullableText(profile[key], MAX_TEXT_FIELD_CHARS)) {
      throw new Error(`invalid profile field: ${key}`);
    }
  }
  for (const key of ["sensitive_topics", "recommendation_rules", "open_questions"]) {
    if (!isBoundedStringList(profile[key])) throw new Error(`invalid profile list: ${key}`);
  }
  if (
    typeof profile.confidence_score !== "number" ||
    !Number.isFinite(profile.confidence_score) ||
    profile.confidence_score < 0 ||
    profile.confidence_score > 1
  ) {
    throw new Error("invalid profile confidence");
  }
  if (!Array.isArray(profile.evidence) || profile.evidence.length > MAX_EVIDENCE_ITEMS) {
    throw new Error("invalid profile evidence");
  }
  for (const item of profile.evidence) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("invalid profile evidence item");
    }
    const evidence = item as Record<string, unknown>;
    if (
      typeof evidence.insight !== "string" ||
      evidence.insight.trim().length === 0 ||
      evidence.insight.length > MAX_LIST_ITEM_CHARS ||
      !isBoundedNullableText(evidence.source, 60) ||
      !isBoundedNullableText(evidence.at, 40) ||
      (evidence.confidence !== null &&
        (typeof evidence.confidence !== "number" ||
          !Number.isFinite(evidence.confidence) ||
          evidence.confidence < 0 ||
          evidence.confidence > 1))
    ) {
      throw new Error("invalid profile evidence item");
    }
  }

  return { shouldUpdate: true, profile };
}

const PROFILE_SYSTEM_PROMPT = `당신은 웨딩한방 AI 플래너 아모라의 "커플 개인화 프로필 편집기"입니다.

목표:
- 전역 모델을 학습시키지 않고, 이 커플에게만 적용할 장기 프로필을 갱신합니다.
- 한 턴짜리 잡담이 아니라 오래 유지해도 되는 취향, 의사결정 방식, 예산 태도, 말투 선호, 민감한 주제만 반영합니다.
- 무료 이용자의 질문 횟수를 아끼기 위해 "다시 물어볼 질문"을 남발하지 말고, 확실한 정보는 조용히 실행 규칙으로 저장합니다.

규칙:
- 절대 지어내지 마세요. 증거가 약하면 confidence_score를 낮추거나 open_questions에만 남깁니다.
- 사용자가 방금 정정한 내용은 기존 프로필보다 우선합니다.
- 공유 visibility에는 두 사람이 함께 봐도 되는 정보만 저장합니다.
- bride_private/groom_private visibility에는 해당 사용자의 개인 상담에서만 쓸 정보를 저장합니다. 파트너에게 들은 것처럼 말하지 않게 표현하세요.
- 민감한 가족/갈등/돈 이야기는 "단정"보다 "주의해서 다룰 신호"로 저장하세요.
- 출력은 JSON만. 설명, 코드블록, Markdown 금지.

출력 형식:
{
  "should_update": true,
  "profile": {
    "persona_summary": "이 커플을 한 문단으로 요약",
    "budget_posture": "예산 태도와 비용 판단 기준",
    "decision_style": "결정을 내리는 방식",
    "taste_profile": "취향과 피하고 싶은 스타일",
    "communication_style": "아모라가 답할 때 맞춰야 할 말투/길이/방식",
    "conflict_pattern": "반복되는 갈등 또는 조율 패턴",
    "sensitive_topics": ["주의할 민감 주제"],
    "recommendation_rules": ["다음 답변에서 바로 적용할 실무 규칙"],
    "open_questions": ["정말 필요할 때만 확인할 미해결 질문"],
    "confidence_score": 0.0,
    "evidence": [{"insight":"근거 요약","source":"recent_chat","confidence":0.0,"at":null}]
  }
}

업데이트할 장기 정보가 없으면:
{"should_update": false, "profile": null}`;

/**
 * Legacy rollback-only writer. Production V2 callers intentionally remain at
 * zero; personalization is projected from validated decision_nodes instead.
 * Do not reconnect this model-written profile upsert to chat or memory APIs.
 */
export async function maybeUpdateAmoraProfile(input: MaybeUpdateAmoraProfileInput): Promise<void> {
  try {
    if (!isAmoraProfileMemoryEnabled()) return;
    if (!shouldAttemptProfileUpdate(input)) return;

    const conversation = formatMessagesForProfile(input.messages);
    if (!conversation) return;

    const currentProfile = input.currentProfile ?? null;
    const currentProfileJson = compactJson(profileForPrompt(currentProfile));
    const visibilityLabel = input.visibility === "shared"
      ? "shared: 두 사람이 함께 보는 아모라 대화에만 사용"
      : `${input.visibility}: 해당 사용자 개인 상담에만 사용`;

    const response = await createOpenAIStructuredResponseWithAudit({
      modelRole: "fast",
      maxInputTokens: AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
      maxOutputTokens: 750,
      beforeGeneration: blockLegacyAuxiliaryProviderGeneration,
      instructions: PROFILE_SYSTEM_PROMPT,
      input:
        `[업데이트 대상 visibility]\n${visibilityLabel}\n\n` +
        `[현재 프로필]\n${currentProfileJson}\n\n` +
        `[최근 대화]\n${conversation}`,
      responseFormat: {
        name: "amora_couple_profile_update",
        description: "커플별 장기 개인화 프로필 갱신 결과",
        schema: PROFILE_RESPONSE_SCHEMA,
      },
      validate: validateAmoraProfileUpdate,
      audit: {
        userId: input.userId ?? null,
        coupleId: input.coupleId,
        interactionType: "amora_director",
        userInput: null,
        metadata: {
          endpoint: "chat/amora-profile",
          visibility: input.visibility,
          stage_tag: input.stageTag,
        },
      },
    });

    const parsed = response.data;
    if (!parsed?.shouldUpdate || !parsed.profile) return;

    const profile = parsed.profile;
    const canStoreSensitive = canStoreSensitiveProfileFields();
    const confidenceScore = sanitizeConfidence(profile.confidence_score, currentProfile?.confidenceScore ?? 0.5);
    const evidence = sanitizeEvidence(profile.evidence, currentProfile?.evidence ?? []);
    if (confidenceScore < 0.55 || evidence.length === 0) return;

    const payload = {
      couple_id: input.coupleId,
      visibility: input.visibility,
      persona_summary: sanitizeText(profile.persona_summary, currentProfile?.personaSummary ?? null),
      budget_posture: sanitizeText(profile.budget_posture, currentProfile?.budgetPosture ?? null),
      decision_style: sanitizeText(profile.decision_style, currentProfile?.decisionStyle ?? null),
      taste_profile: sanitizeText(profile.taste_profile, currentProfile?.tasteProfile ?? null),
      communication_style: sanitizeText(profile.communication_style, currentProfile?.communicationStyle ?? null),
      conflict_pattern: canStoreSensitive
        ? sanitizeText(profile.conflict_pattern, currentProfile?.conflictPattern ?? null)
        : currentProfile?.conflictPattern ?? null,
      sensitive_topics: canStoreSensitive
        ? sanitizeList(profile.sensitive_topics, currentProfile?.sensitiveTopics ?? [])
        : currentProfile?.sensitiveTopics ?? [],
      recommendation_rules: sanitizeList(profile.recommendation_rules, currentProfile?.recommendationRules ?? []),
      open_questions: sanitizeList(profile.open_questions, currentProfile?.openQuestions ?? []),
      confidence_score: confidenceScore,
      evidence,
      version: (currentProfile?.version ?? 0) + 1,
      last_compiled_at: new Date().toISOString(),
    };

    const hasUsefulProfileContent =
      [
        payload.persona_summary,
        payload.budget_posture,
        payload.decision_style,
        payload.taste_profile,
        payload.communication_style,
        payload.conflict_pattern,
      ].some((value) => typeof value === "string" && value.trim().length > 0) ||
      payload.recommendation_rules.length > 0 ||
      payload.open_questions.length > 0;
    if (!hasUsefulProfileContent) return;

    const admin = createAdminClient();
    const { error } = await admin
      .from("amora_couple_profiles")
      .upsert(payload, { onConflict: "couple_id,visibility" });

    if (error) {
      console.warn("[amora-profile] upsert skipped", safeErrorDiagnostic(error));
      return;
    }

  } catch (err) {
    console.warn("[amora-profile] update failed", safeErrorDiagnostic(err));
  }
}
