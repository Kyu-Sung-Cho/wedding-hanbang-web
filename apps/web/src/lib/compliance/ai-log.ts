// =============================================
// AI Interaction Log — Bucket C 로깅 헬퍼
// =============================================
// 목적: 모든 AI API 호출을 ai_interactions_log에 기록
// 특징:
//   - Service role로 INSERT (유저 권한 무관)
//   - try/catch로 감싸 예외 절대 propagate 안 함
//   - fire-and-forget: `void logAIInteraction(...)`로 호출 시 await 불필요
//   - 가격표 내장 → cost_usd 자동 계산
// 컴플라이언스:
//   - 현재 LLM 호출 래퍼는 user_input / ai_output 원문을 복제하지 않고 null로 기록
//   - 과거 행과 결정적 가격 데이터 로그의 잔존 원문은 retention migration으로 정리
// =============================================

import { createAdminClient } from "@/lib/supabase/admin";
import type { InteractionType, SpecialistType } from "@/types/moat.types";

// -------------------------------------------
// 모델별 가격표 ($ / 1M tokens)
// -------------------------------------------
// OpenAI 공개 가격 확인일: 2026-07-10
// https://developers.openai.com/api/docs/models
// 현재 런타임에서 선택 가능한 모델은 Luna/Terra뿐이다. 그 밖의 OpenAI·Claude
// 가격은 공급자 전환 전 과거 감사 행을 재계산하기 위한 호환 데이터다.
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
  "gpt-5.6-sol": {
    in: 5 / 1_000_000, out: 30 / 1_000_000,
    cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000,
    longContext: {
      threshold: 272_000,
      in: 10 / 1_000_000, out: 45 / 1_000_000,
      cacheWrite: 12.5 / 1_000_000, cacheRead: 1 / 1_000_000,
    },
  },
  "gpt-5.5": {
    in: 5 / 1_000_000, out: 30 / 1_000_000,
    cacheWrite: 0, cacheRead: 0.5 / 1_000_000,
    longContext: {
      threshold: 272_000,
      in: 10 / 1_000_000, out: 45 / 1_000_000,
      cacheWrite: 0, cacheRead: 1 / 1_000_000,
    },
  },
  "gpt-5.4-mini": {
    in: 0.75 / 1_000_000, out: 4.5 / 1_000_000,
    cacheWrite: 0, cacheRead: 0.075 / 1_000_000,
  },
  "gpt-5.4-nano": {
    in: 0.2 / 1_000_000, out: 1.25 / 1_000_000,
    cacheWrite: 0, cacheRead: 0.02 / 1_000_000,
  },
  "gpt-5.4": {
    in: 2.5 / 1_000_000, out: 15 / 1_000_000,
    cacheWrite: 0, cacheRead: 0.25 / 1_000_000,
    longContext: {
      threshold: 272_000,
      in: 5 / 1_000_000, out: 22.5 / 1_000_000,
      cacheWrite: 0, cacheRead: 0.5 / 1_000_000,
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
  cacheWriteTokens?: number | null,
  cacheReadTokens?: number | null
): number | null {
  if (!model || tokensIn == null || tokensOut == null) return null;
  // gpt-5.4보다 gpt-5.4-mini를 먼저 매칭하도록 긴 키를 우선한다.
  const key = Object.keys(MODEL_COSTS)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => model.startsWith(candidate)) ?? null;
  const modelCost = key ? MODEL_COSTS[key] : null;
  if (!modelCost) return null;
  const rate = modelCost.longContext && tokensIn > modelCost.longContext.threshold
    ? modelCost.longContext
    : modelCost;

  const isOpenAI = model.startsWith("gpt-");
  if (isOpenAI) {
    // OpenAI input_tokens에는 cache read/write 토큰이 포함되므로 세 구간을 분리한다.
    const cachedTokens = Math.min(Math.max(cacheReadTokens ?? 0, 0), tokensIn);
    const writtenTokens = Math.min(
      Math.max(cacheWriteTokens ?? 0, 0),
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

  // 과거 Anthropic 로그는 uncached/cache-write/cache-read가 각각 분리되어 있다.
  return (
    tokensIn * rate.in +
    tokensOut * rate.out +
    (cacheWriteTokens ?? 0) * rate.cacheWrite +
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
  /** 캐시에 새로 기록된 input 토큰. OpenAI 5.6 및 레거시 Anthropic 로그에 사용. */
  cacheWriteTokens?: number | null;
  /** 캐시 hit input 토큰. OpenAI에서는 tokensInput에 포함된 부분집합이다. */
  cacheReadTokens?: number | null;
  /** 미리 계산된 cost — 없으면 내부에서 MODEL_COSTS 기반 자동 계산 */
  costUsd?: number | null;
  metadata?: Record<string, unknown> | null;
  /** Stable SHA-256 key for a required audit event that may be retried. */
  idempotencyKey?: string | null;
  /** true면 감사 장부 실패를 호출자에게 전파해 성공처럼 진행하지 않는다. */
  required?: boolean;
}

const getAdminClient = createAdminClient;

const SAFE_AI_ERROR_CODE_PREFIXES = [
  "provider_request_failed",
  "provider_request_aborted",
  "openai_response_error",
  "openai_input_token_limit",
  "empty_response",
  "chat_request_failed",
  "cost_guard_",
  "tool_claim_",
  "request_aborted",
  "ai_interaction_failed",
] as const;

export function sanitizeAIErrorCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const base = value.split(":", 1)[0];
  return SAFE_AI_ERROR_CODE_PREFIXES.some((prefix) => base.startsWith(prefix))
    ? base.slice(0, 120)
    : "ai_interaction_failed";
}

function canonicalAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalAuditValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalAuditValue(item)]),
    );
  }
  return value;
}

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
    const idempotencyKey = params.idempotencyKey ?? null;
    if (idempotencyKey !== null && !/^[a-f0-9]{64}$/.test(idempotencyKey)) {
      throw new Error("AI_LOG_IDEMPOTENCY_KEY_INVALID");
    }

    const cost =
      params.costUsd !== undefined
        ? params.costUsd
        : calcCostUsd(
        params.model,
        params.tokensInput,
        params.tokensOutput,
        params.cacheWriteTokens,
        params.cacheReadTokens
        );

    // cache 토큰은 metadata 에 동봉 (schema 변경 없이 추적 가능)
    const baseMetadata = params.metadata ?? {};
    const metadataWithCache =
      params.cacheWriteTokens || params.cacheReadTokens
        ? {
            ...baseMetadata,
            cache_write_input_tokens: params.cacheWriteTokens ?? 0,
            cache_read_input_tokens: params.cacheReadTokens ?? 0,
          }
        : baseMetadata;

    const insertRow = {
      user_id: params.userId ?? null,
      couple_id: params.coupleId ?? null,
      session_id: params.sessionId ?? null,
      message_id: params.messageId ?? null,
      interaction_type: params.interactionType,
      specialist_type: params.specialistType ?? null,
      user_input: params.userInput ?? null,
      ai_output: params.aiOutput ?? null,
      tool_name: params.toolName ?? null,
      tool_input: params.toolInput ?? null,
      tool_output: params.toolOutput ?? null,
      latency_ms: params.latencyMs ?? null,
      success: params.success ?? true,
      error_message: sanitizeAIErrorCode(params.errorMessage),
      model: params.model ?? null,
      tokens_input: params.tokensInput ?? null,
      tokens_output: params.tokensOutput ?? null,
      cost_usd: cost,
      metadata: metadataWithCache,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    };
    const { error } = await admin.from("ai_interactions_log").insert(insertRow);

    if (error) {
      // If the original insert committed but its response was lost, a retry
      // sees the unique key. Reuse is safe only for the exact same semantic
      // audit event; a conflicting row remains a hard required-audit failure.
      if (idempotencyKey) {
        const { data: existing, error: lookupError } = await admin
          .from("ai_interactions_log")
          .select([
            "user_id",
            "couple_id",
            "session_id",
            "message_id",
            "interaction_type",
            "specialist_type",
            "user_input",
            "ai_output",
            "tool_name",
            "tool_input",
            "tool_output",
            "success",
            "error_message",
            "model",
            "tokens_input",
            "tokens_output",
            "metadata",
          ].join(","))
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        const expectedComparable = {
          user_id: insertRow.user_id,
          couple_id: insertRow.couple_id,
          session_id: insertRow.session_id,
          message_id: insertRow.message_id,
          interaction_type: insertRow.interaction_type,
          specialist_type: insertRow.specialist_type,
          user_input: insertRow.user_input,
          ai_output: insertRow.ai_output,
          tool_name: insertRow.tool_name,
          tool_input: insertRow.tool_input,
          tool_output: insertRow.tool_output,
          success: insertRow.success,
          error_message: insertRow.error_message,
          model: insertRow.model,
          tokens_input: insertRow.tokens_input,
          tokens_output: insertRow.tokens_output,
          metadata: insertRow.metadata,
        };
        if (
          !lookupError
          && existing
          && JSON.stringify(canonicalAuditValue(existing))
            === JSON.stringify(canonicalAuditValue(expectedComparable))
        ) {
          return;
        }
        console.error("AI_LOG_IDEMPOTENCY_CONFLICT", lookupError ?? error);
      }
      console.error("AI_LOG_INSERT_FAILED", error);
      if (params.required) {
        throw new Error("AI_LOG_REQUIRED_INSERT_FAILED");
      }
    }
  } catch (err) {
    console.error("AI_LOG_UNEXPECTED_FAILURE", err);
    if (params.required) throw err;
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
