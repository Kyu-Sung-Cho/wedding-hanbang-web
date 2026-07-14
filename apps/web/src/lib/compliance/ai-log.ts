// =============================================
// AI Interaction Log — Bucket C 로깅 헬퍼
// =============================================
// 목적: 모든 AI API 호출의 비용·상태 메타데이터를 ai_interactions_log에 기록
// 특징:
//   - Service role로 INSERT (유저 권한 무관)
//   - try/catch로 감싸 예외 절대 propagate 안 함
//   - fire-and-forget: `void logAIInteraction(...)`로 호출 시 await 불필요
//   - 가격표 내장 → cost_usd 자동 계산
// 컴플라이언스:
//   - 대화/도구 원문은 canonical 도메인 행에만 두고 비용 로그에는 복제하지 않음
//   - 중단된 공급자 요청은 0원이 아닌 usage_status=unknown으로 구분
// =============================================

import { createAdminClient } from "@/lib/supabase/admin";
import type { InteractionType, SpecialistType } from "@/types/moat.types";

// -------------------------------------------
// 모델별 가격표 ($ / 1M tokens)
// -------------------------------------------
// OpenAI 공식 가격 확인일: 2026-07-14
// https://developers.openai.com/api/docs/pricing
interface TokenRates {
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
}

interface ModelCost extends TokenRates {
  longContext?: TokenRates & { threshold: number };
}

const MODEL_COSTS: Record<string, ModelCost> = {
  "gpt-5.6-terra": {
    in: 2.5 / 1_000_000, out: 15 / 1_000_000,
    cacheWrite: 3.125 / 1_000_000, cacheRead: 0.25 / 1_000_000,
    longContext: {
      threshold: 272_000,
      in: 5 / 1_000_000, out: 22.5 / 1_000_000,
      cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000,
    },
  },
  "gpt-5.6-luna": {
    in: 1 / 1_000_000, out: 6 / 1_000_000,
    cacheWrite: 1.25 / 1_000_000, cacheRead: 0.1 / 1_000_000,
    longContext: {
      threshold: 272_000,
      in: 2 / 1_000_000, out: 9 / 1_000_000,
      cacheWrite: 2.5 / 1_000_000, cacheRead: 0.2 / 1_000_000,
    },
  },
  "claude-fable-5": {
    in: 10 / 1_000_000, out: 50 / 1_000_000,
    cacheWrite: 12.5 / 1_000_000, cacheRead: 1.0 / 1_000_000,
  },
  "claude-mythos-5": {
    in: 10 / 1_000_000, out: 50 / 1_000_000,
    cacheWrite: 12.5 / 1_000_000, cacheRead: 1.0 / 1_000_000,
  },
  "claude-opus-4-8": {
    in: 5 / 1_000_000, out: 25 / 1_000_000,
    cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000,
  },
  "claude-opus-4-7": {
    in: 5 / 1_000_000, out: 25 / 1_000_000,
    cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000,
  },
  "claude-opus-4-6": {
    in: 5 / 1_000_000, out: 25 / 1_000_000,
    cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000,
  },
  "claude-opus-4-5": {
    in: 5 / 1_000_000, out: 25 / 1_000_000,
    cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000,
  },
  "claude-opus-4-1": {
    in: 15 / 1_000_000, out: 75 / 1_000_000,
    cacheWrite: 18.75 / 1_000_000, cacheRead: 1.5 / 1_000_000,
  },
  "claude-opus-4": {
    in: 15 / 1_000_000, out: 75 / 1_000_000,
    cacheWrite: 18.75 / 1_000_000, cacheRead: 1.5 / 1_000_000,
  },
  "claude-sonnet-4-6": {
    in: 3 / 1_000_000, out: 15 / 1_000_000,
    cacheWrite: 3.75 / 1_000_000, cacheRead: 0.30 / 1_000_000,
  },
  "claude-sonnet-4-5": {
    in: 3 / 1_000_000, out: 15 / 1_000_000,
    cacheWrite: 3.75 / 1_000_000, cacheRead: 0.30 / 1_000_000,
  },
  "claude-haiku-4-5-20251001": {
    in: 1 / 1_000_000, out: 5 / 1_000_000,
    cacheWrite: 1.25 / 1_000_000, cacheRead: 0.10 / 1_000_000,
  },
  "claude-haiku-4-5": {
    in: 1 / 1_000_000, out: 5 / 1_000_000,
    cacheWrite: 1.25 / 1_000_000, cacheRead: 0.10 / 1_000_000,
  },
  "claude-haiku-3-5": {
    in: 0.8 / 1_000_000, out: 4 / 1_000_000,
    cacheWrite: 1.0 / 1_000_000, cacheRead: 0.08 / 1_000_000,
  },
  // 기존 호환 모델 (scripts/generate에서 쓰는 구 버전)
  "claude-sonnet-4-20250514": {
    in: 3 / 1_000_000, out: 15 / 1_000_000,
    cacheWrite: 3.75 / 1_000_000, cacheRead: 0.30 / 1_000_000,
  },
};

export function calcCostUsd(
  model: string | null | undefined,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
  cacheCreationTokens?: number | null,
  cacheReadTokens?: number | null
): number | null {
  if (!model || tokensIn == null || tokensOut == null) return null;
  const key = Object.keys(MODEL_COSTS)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => model.startsWith(candidate)) ?? null;
  if (!key) return null;
  const modelCost = MODEL_COSTS[key];
  const rate = modelCost.longContext && tokensIn > modelCost.longContext.threshold
    ? modelCost.longContext
    : modelCost;

  if (model.startsWith("gpt-")) {
    // OpenAI input_tokens는 cache read/write를 포함하므로 구간을 분리한다.
    const cachedTokens = Math.min(Math.max(cacheReadTokens ?? 0, 0), tokensIn);
    const writtenTokens = Math.min(
      Math.max(cacheCreationTokens ?? 0, 0),
      Math.max(tokensIn - cachedTokens, 0)
    );
    const uncachedTokens = Math.max(tokensIn - cachedTokens - writtenTokens, 0);
    return (
      uncachedTokens * rate.in +
      writtenTokens * rate.cacheWrite +
      cachedTokens * rate.cacheRead +
      tokensOut * rate.out
    );
  }

  // 과거 Anthropic usage는 uncached/cache-write/cache-read가 분리되어 있다.
  return (
    tokensIn * rate.in +
    tokensOut * rate.out +
    (cacheCreationTokens ?? 0) * rate.cacheWrite +
    (cacheReadTokens ?? 0) * rate.cacheRead
  );
}

// -------------------------------------------
// 로깅 입력 스키마
// -------------------------------------------
export interface AIInteractionLogInput {
  userId?: string | null;
  coupleId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  interactionType: InteractionType;
  specialistType?: SpecialistType | null;
  userInput?: string | null;
  aiOutput?: string | null;
  toolName?: string | null;
  toolInput?: Record<string, unknown> | null;
  toolOutput?: Record<string, unknown> | null;
  latencyMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
  model?: string | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  /** Prompt caching: 캐시 생성 시 사용된 input 토큰 (cache_write, 25% premium) */
  cacheCreationTokens?: number | null;
  /** Prompt caching: 캐시 hit 시 사용된 input 토큰 (cache_read, 90% 할인) */
  cacheReadTokens?: number | null;
  /** 미리 계산된 cost — 없으면 내부에서 MODEL_COSTS 기반 자동 계산 */
  costUsd?: number | null;
  metadata?: Record<string, unknown> | null;
}

const SENSITIVE_LOG_VALUE_PATTERN = /(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{20,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

function safeStoredError(value: string | null | undefined): string | null {
  if (!value) return null;
  if (SENSITIVE_LOG_VALUE_PATTERN.test(value)) return "redacted_error";
  return /^[A-Za-z0-9_.:-]{1,240}$/.test(value) ? value : "redacted_error";
}

const SAFE_AI_LOG_METADATA_KEYS = new Set([
  "ai_provider",
  "audit_wrapper",
  "comment_position",
  "correction_count",
  "covered_range",
  "endpoint",
  "exceeded_max_rounds",
  "extracted_by",
  "extraction_type",
  "input_count_request_id",
  "message_count",
  "model_role",
  "post_author_id",
  "post_category",
  "post_id",
  "provider_error_category",
  "provider_error_code",
  "provider_attempted",
  "provider_request_id",
  "provider_response_id",
  "reasoning_effort",
  "region",
  "routing_reason",
  "schema_name",
  "score",
  "source",
  "source_policy",
  "stage_tag",
  "structured_output",
  "tool_rounds",
  "tools_used",
  "unknown_paid_attempt",
  "usage_status",
  "vendor_category",
  "visibility",
]);

function safeMetadataValue(value: unknown): unknown | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    return value.length <= 240 && !SENSITIVE_LOG_VALUE_PATTERN.test(value)
      ? value
      : undefined;
  }
  if (Array.isArray(value) && value.length <= 25) {
    const safeItems = value.map(safeMetadataValue);
    return safeItems.every((item) => item !== undefined) ? safeItems : undefined;
  }
  // 중첩 객체는 원문 payload를 숨길 수 있으므로 비용 로그에서 허용하지 않는다.
  return undefined;
}

function sanitizeLogMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!metadata) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_AI_LOG_METADATA_KEYS.has(key)) continue;
    const sanitized = safeMetadataValue(value);
    if (sanitized !== undefined) safe[key] = sanitized;
  }
  return safe;
}

const getAdminClient = createAdminClient;

// -------------------------------------------
// 공개 헬퍼: logAIInteraction
// -------------------------------------------
/**
 * AI 호출 기록. 예외는 내부에서 삼키고 콘솔에만 남김.
 * fire-and-forget 패턴:
 *   void logAIInteraction({ ... });  // main flow 안 막음
 */
export async function logAIInteraction(
  params: AIInteractionLogInput
): Promise<void> {
  try {
    const admin = getAdminClient();

    const cost =
      params.costUsd ??
      calcCostUsd(
        params.model,
        params.tokensInput,
        params.tokensOutput,
        params.cacheCreationTokens,
        params.cacheReadTokens
      );

    // cache 토큰은 metadata 에 동봉 (schema 변경 없이 추적 가능)
    const baseMetadata = {
      ...sanitizeLogMetadata(params.metadata),
      content_logging: "disabled",
      ...(params.userInput ? { user_input_chars: params.userInput.length } : {}),
      ...(params.aiOutput ? { ai_output_chars: params.aiOutput.length } : {}),
    };
    const metadataWithCache =
      params.cacheCreationTokens || params.cacheReadTokens
        ? {
            ...baseMetadata,
            cache_creation_input_tokens: params.cacheCreationTokens ?? 0,
            cache_read_input_tokens: params.cacheReadTokens ?? 0,
          }
        : baseMetadata;

    const { error } = await admin.from("ai_interactions_log").insert({
      user_id: params.userId ?? null,
      couple_id: params.coupleId ?? null,
      session_id: params.sessionId ?? null,
      message_id: params.messageId ?? null,
      interaction_type: params.interactionType,
      specialist_type: params.specialistType ?? null,
      user_input: null,
      ai_output: null,
      tool_name: params.toolName ?? null,
      tool_input: null,
      tool_output: null,
      latency_ms: params.latencyMs ?? null,
      success: params.success ?? true,
      error_message: safeStoredError(params.errorMessage),
      model: params.model ?? null,
      tokens_input: params.tokensInput ?? null,
      tokens_output: params.tokensOutput ?? null,
      cost_usd: cost,
      metadata: metadataWithCache,
    });

    if (error) {
      console.error("[ai-log] INSERT 실패 (무시됨):", error.message);
    }
  } catch (err) {
    console.error("[ai-log] 예외 (무시됨):", err);
  }
}

// -------------------------------------------
// 편의 함수: 시작 시간 캡처
// -------------------------------------------
/**
 * 사용 예시:
 *   const startedAt = startLatencyClock();
 *   ... AI 호출 ...
 *   void logAIInteraction({ latencyMs: elapsedMs(startedAt), ... });
 */
export function startLatencyClock(): number {
  return Date.now();
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}
