// =============================================
// AI Interaction Log — Bucket C 로깅 헬퍼
// =============================================
// 목적: 모든 AI API 호출의 비용·상태 메타데이터를 ai_interactions_log에 기록
// 특징:
//   - Service role로 INSERT (유저 권한 무관)
//   - try/catch로 감싸 예외 절대 propagate 안 함
//   - fire-and-forget: `void logAIInteraction(...)`로 호출 시 await 불필요
//   - 버전 관리되는 단일 가격표 → cost_usd 자동 계산
// 컴플라이언스:
//   - 대화/도구 원문은 canonical 도메인 행에만 두고 비용 로그에는 복제하지 않음
//   - 중단된 공급자 요청은 0원이 아닌 usage_status=unknown으로 구분
// =============================================

import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { InteractionType, SpecialistType } from "@/types/moat.types";
import { log } from "@/utils/log";
import modelPricingCatalog from "../../../../../config/amora-model-pricing.json";

// -------------------------------------------
// 모델별 가격표 ($ / 1M tokens)
// -------------------------------------------
// OpenAI 공식 모델·가격 확인일: 2026-07-16
// https://developers.openai.com/api/docs/pricing
interface TokenRates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface ModelCost extends TokenRates {
  provider: "openai" | "anthropic";
  longContext?: TokenRates & { inputTokenThresholdExclusive: number };
}

const MODEL_COSTS = modelPricingCatalog.models as Record<string, ModelCost>;

export function calcCostUsd(
  model: string | null | undefined,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
  cacheCreationTokens?: number | null,
  cacheReadTokens?: number | null
): number | null {
  if (
    !model
    || tokensIn == null
    || tokensOut == null
    || !Number.isFinite(tokensIn)
    || !Number.isFinite(tokensOut)
    || tokensIn < 0
    || tokensOut < 0
  ) return null;
  const key = Object.keys(MODEL_COSTS)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => model.startsWith(candidate)) ?? null;
  if (!key) return null;
  const modelCost = MODEL_COSTS[key];
  const rate = modelCost.longContext
    && tokensIn > modelCost.longContext.inputTokenThresholdExclusive
    ? modelCost.longContext
    : modelCost;

  if (modelCost.provider === "openai") {
    // OpenAI input_tokens는 cache read/write를 포함하므로 구간을 분리한다.
    const cachedTokens = Math.min(Math.max(cacheReadTokens ?? 0, 0), tokensIn);
    const writtenTokens = Math.min(
      Math.max(cacheCreationTokens ?? 0, 0),
      Math.max(tokensIn - cachedTokens, 0)
    );
    const uncachedTokens = Math.max(tokensIn - cachedTokens - writtenTokens, 0);
    return (
      uncachedTokens * rate.input +
      writtenTokens * rate.cacheWrite +
      cachedTokens * rate.cacheRead +
      tokensOut * rate.output
    ) / 1_000_000;
  }

  // 과거 Anthropic usage는 uncached/cache-write/cache-read가 분리되어 있다.
  return (
    tokensIn * rate.input +
    tokensOut * rate.output +
    Math.max(cacheCreationTokens ?? 0, 0) * rate.cacheWrite +
    Math.max(cacheReadTokens ?? 0, 0) * rate.cacheRead
  ) / 1_000_000;
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
  /** 미리 계산된 cost — 없으면 공유 가격 카탈로그 기반으로 자동 계산 */
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
  "provider_call_index",
  "provider_call_phase",
  "provider_request_id",
  "provider_request_stage",
  "provider_response_id",
  "question_scope",
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
const SAFE_QUESTION_SCOPES = new Set([
  "W0_wedding_core",
  "W1_wedding_adjacent",
  "W2_high_risk_adjacent",
  "W3_social_care",
  "W4_out_of_scope",
  "W5_safety_override",
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
    if (key === "question_scope") {
      if (typeof value === "string" && SAFE_QUESTION_SCOPES.has(value)) {
        safe[key] = value;
      }
      continue;
    }
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
 * AI 호출 기록. 저장 성공 여부를 반환하되 실패를 사용자 요청에 전파하지 않는다.
 * 실패는 운영 오류 수집기로 보내므로 비용 원장 누락을 관측할 수 있다.
 * fire-and-forget 패턴:
 *   void logAIInteraction({ ... });  // main flow 안 막음
 */
export async function logAIInteraction(
  params: AIInteractionLogInput
): Promise<boolean> {
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
      // **왜 실패했는지를 제목에 담는다.**
      //
      // 2026-09-02 운영: 이 경보가 Sentry 에 32건 쌓여 있는데 원인을 알 수 없었다.
      // 개인정보 때문에 DB 오류 문구를 뺐는데, 그 결과 "실패했다"만 남고
      // "왜"가 사라졌다. 알림이 있으나 마나였다.
      //
      // Postgres 오류 **코드**는 개인정보가 아니다(`23503` 외래키, `23514` CHECK,
      // `42703` 없는 컬럼 …). 반면 `message`·`details` 는 위반한 값을 그대로
      // 인용하므로(`Key (couple_id)=(…) is not present`) 담지 않는다.
      log.error(
        `[ai-log] INSERT failed (${pgErrorCode(error)}); provider ledger row may be missing`,
        new Error("ai_interactions_log_insert_failed"),
      );
      return false;
    }
    return true;
  } catch {
    log.error(
      "[ai-log] exception; provider ledger row may be missing",
      new Error("ai_interactions_log_exception"),
    );
    return false;
  }
}


/**
 * **응답을 보낸 뒤에 원장을 쓴다 — 단, 플랫폼이 함수를 얼리지 않게 하고서.**
 *
 * 2026-09-02 원인 조사: `void logAIInteraction(...)` 로 부르면 삽입 요청이 아직
 * 날아가는 중에 라우트가 응답을 돌려준다. Vercel 은 응답이 끝나면 함수를
 * 얼리거나 끝내므로, 그 fetch 는 응답을 받지 못하고 끊긴다.
 *
 * 이것이 관측된 숫자와 맞는 유일한 설명이다 — Sentry 경보 32건인데 실제로
 * 원장이 빠진 턴은 507건 중 **1건**뿐이었다. 요청은 대개 DB 에 닿아 저장까지
 * 끝났고, 우리만 결과를 못 받은 것이다. DB 쪽 원인은 전부 배제했다:
 * `interaction_type`·`specialist_type` 은 TS 타입이 DB CHECK 목록의 부분집합이고,
 * 영수증 CHECK 는 이 삽입기가 `amora_request_key` 를 쓰지 않아 무효이며,
 * NOT NULL 컬럼엔 기본값이 있고, 외래키 대상은 30일간 결손 0건이었다.
 *
 * `after` 는 응답이 끝난 뒤 콜백을 돌리되 **플랫폼에 아직 끝나지 않았다고
 * 알린다**(내부적으로 `waitUntil`). 사용자 응답은 여전히 기다리지 않는다.
 *
 * 크론·스크립트처럼 요청 수명주기 밖에서 부르면 `after` 가 던지므로, 그때는
 * 원래대로 그냥 부른다 — 그 경로엔 얼어붙을 응답 자체가 없다.
 */
let reportedAfterUnavailable = false;

export function logAIInteractionAfterResponse(params: AIInteractionLogInput): void {
  // **콜백이 아니라 이미 시작한 프로미스를 넘긴다. 이 순서가 전부다.**
  //
  // `after(() => ...)` 로 콜백을 넘기면 Next 는 그것을 큐에 넣고 응답이 닫힐 때
  // (`res.on("close")`) 깨운다. 그런데 사용자가 스트림 도중 탭을 닫으면 res 가
  // **먼저** 닫히고, 이미 닫힌 res 에 등록한 리스너는 영원히 안 불린다.
  // `after` 는 그때 던지지도 않는다 — 던지는 조건은 요청 문맥 없음과 waitUntil
  // 없음 둘뿐이다. 그래서 콜백은 실행 0회, 예외 0회, 경보 0회로 조용히 사라진다.
  // 실패 턴 원장이 가장 필요한 순간(중단된 대화)에 가장 확실히 없어진다.
  //
  // 프로미스를 넘기면 Next 가 isThenable 갈래로 받아 onClose 큐를 아예 안 탄다.
  // 게다가 쓰기는 이 줄에서 벌써 시작됐으므로, `after` 를 못 쓰는 환경에서도
  // 옛 `void` 와 최소한 같다. 정상 종료·중단 양쪽에서 기록되는 것을 Next
  // 16.2.11 실물로 재현해 확인했다(2026-09-02).
  const pending = logAIInteraction(params);
  try {
    after(pending);
  } catch {
    // 여기서 다시 부르면 원장에 같은 행이 두 번 들어간다 — 쓰기는 위에서
    // 이미 시작됐다. 알리기만 한다. 프로세스당 한 번이면 Sentry 가 묶어 센다.
    if (!reportedAfterUnavailable) {
      reportedAfterUnavailable = true;
      log.error(
        "[ai-log] after() unavailable; ledger write can be cut off by the response",
        new Error("ai_log_after_unavailable"),
      );
    }
  }
  void pending;
}

/**
 * Postgres 오류 코드만 꺼낸다. 코드는 다섯 자리 영숫자이고 값을 담지 않는다.
 * 모양이 다르면 아무것도 돌려주지 않는다 — 모르는 것을 지어내지 않는다.
 */
function pgErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Za-z]{5}$/.test(code)
    ? `code=${code}`
    : "code=unknown";
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
