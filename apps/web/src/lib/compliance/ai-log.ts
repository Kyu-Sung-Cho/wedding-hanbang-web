// =============================================
// AI Interaction Log — Bucket C 로깅 헬퍼
// =============================================
// 목적: 모든 Claude API 호출을 ai_interactions_log에 기록
// 특징:
//   - Service role로 INSERT (유저 권한 무관)
//   - try/catch로 감싸 예외 절대 propagate 안 함
//   - fire-and-forget: `void logAIInteraction(...)`로 호출 시 await 불필요
//   - 가격표 내장 → cost_usd 자동 계산
// 컴플라이언스:
//   - user_input / ai_output 원문 그대로 저장 (민감정보 포함 가능)
//   - DB COMMENT로 개인정보보호법 + AI 기본법 compliance 표기됨
// =============================================

import { createAdminClient } from "@/lib/supabase/admin";
import type { InteractionType, SpecialistType } from "@/types/moat.types";

// -------------------------------------------
// 모델별 가격표 ($ / 1M tokens)
// -------------------------------------------
// 출처: Anthropic 공식 가격 (확인일: 2026-06-17)
// https://platform.claude.com/docs/en/about-claude/pricing
// cache_write = 표준 input × 1.25 (캐시 생성 시 25% premium)
// cache_read  = 표준 input × 0.10 (캐시 hit 시 90% 할인)
const MODEL_COSTS: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
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
  // 모델명 부분 매칭 (버전 suffix 허용)
  const key = Object.keys(MODEL_COSTS).find((k) => model.startsWith(k)) ?? null;
  if (!key) return null;
  const rate = MODEL_COSTS[key];
  // tokensIn 은 Anthropic 기준 '캐시 안 된 input' 만 포함 (cache_creation/cache_read 와 분리).
  // 셋 다 별도 가격으로 합산.
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
    const baseMetadata = params.metadata ?? {};
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
      user_input: params.userInput ?? null,
      ai_output: params.aiOutput ?? null,
      tool_name: params.toolName ?? null,
      tool_input: params.toolInput ?? null,
      tool_output: params.toolOutput ?? null,
      latency_ms: params.latencyMs ?? null,
      success: params.success ?? true,
      error_message: params.errorMessage ?? null,
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
