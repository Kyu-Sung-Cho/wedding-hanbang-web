import type { ToolExecutionResult } from "@/types/database.types";
import { readPlaceSearchFacts } from "@hanbang/shared/place-search-presentation";

export const EPHEMERAL_PLACE_SEARCH_TOOL = "search_nearby_places";
const PRIVATE_SCHEDULE_MUTATION_TOOLS = new Set([
  "cancel_schedule_event",
  "restore_schedule_event",
]);
const PRIVATE_BOOKING_CANCELLATION_TOOL = "cancel_booking";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicScheduleEvent(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const event: Record<string, unknown> = {};
  for (const key of ["date", "time", "title", "status"] as const) {
    if (typeof value[key] === "string") event[key] = value[key];
  }
  if (isRecord(value.cancellation)) {
    const cancellation: Record<string, unknown> = {};
    if (typeof value.cancellation.cancelledAt === "string") {
      cancellation.cancelledAt = value.cancellation.cancelledAt;
    }
    if (typeof value.cancellation.reason === "string") {
      cancellation.reason = value.cancellation.reason;
    }
    if (Object.keys(cancellation).length > 0) event.cancellation = cancellation;
  }
  return Object.keys(event).length > 0 ? event : null;
}

function privacySafeScheduleToolOutput(
  result: ToolExecutionResult,
): Record<string, unknown> {
  const event = publicScheduleEvent(result.toolOutput.event);
  const previousEvent = publicScheduleEvent(result.toolOutput.previous_event);
  return {
    applied: result.success,
    ...(event ? { event } : {}),
    ...(previousEvent ? { previous_event: previousEvent } : {}),
    ...(!result.success && typeof result.toolOutput.error === "string"
      ? { error: result.toolOutput.error }
      : {}),
  };
}

function privacySafeScheduleToolInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const safeInput: Record<string, unknown> = {};
  for (const key of ["expected_title", "expected_date", "reason"] as const) {
    if (typeof input[key] === "string") safeInput[key] = input[key];
  }
  return safeInput;
}

function privacySafePersistedScheduleResult(
  result: ToolExecutionResult,
): ToolExecutionResult {
  return {
    ...result,
    toolInput: privacySafeScheduleToolInput(result.toolInput),
    toolOutput: privacySafeScheduleToolOutput(result),
  };
}

function privacySafeBookingCancellationOutput(
  result: ToolExecutionResult,
): Record<string, unknown> {
  const output = result.toolOutput;
  const safeOutput: Record<string, unknown> = { applied: result.success };
  for (const key of [
    "vendorName",
    "productName",
    "date",
    "time",
    "status",
    "vendorCancellationStatus",
    "amountBasis",
    "refundStatus",
    "projectionStatus",
    "projectionErrorCode",
    "error",
  ] as const) {
    if (typeof output[key] === "string") safeOutput[key] = output[key];
  }
  for (const key of [
    "quotedAmount",
    "actualAmount",
    "quoteCorrectionAmount",
    "projectionAttemptCount",
    "syncedNewSpent",
  ] as const) {
    if (typeof output[key] === "number" && Number.isFinite(output[key])) {
      safeOutput[key] = output[key];
    } else if (output[key] === null) {
      safeOutput[key] = null;
    }
  }
  for (const key of [
    "idempotent",
    "internalCancellationRecorded",
    "scheduleCancelled",
    "completedSchedulePreserved",
    "recordedSpendPreserved",
    "quoteContributionCorrected",
    "scheduleRemoved",
    "budgetReverted",
    "projectionRetryable",
    "fullyApplied",
  ] as const) {
    if (typeof output[key] === "boolean") safeOutput[key] = output[key];
  }
  if (isRecord(output.cancellation)) {
    const cancellation: Record<string, unknown> = {};
    if (typeof output.cancellation.cancelledAt === "string") {
      cancellation.cancelledAt = output.cancellation.cancelledAt;
    }
    if (typeof output.cancellation.reason === "string") {
      cancellation.reason = output.cancellation.reason;
    }
    if (Object.keys(cancellation).length > 0) {
      safeOutput.cancellation = cancellation;
    }
  }
  return safeOutput;
}

function privacySafePersistedBookingCancellationResult(
  result: ToolExecutionResult,
): ToolExecutionResult {
  return {
    ...result,
    toolInput: {},
    toolOutput: privacySafeBookingCancellationOutput(result),
  };
}

/** Browser-visible streaming data excludes actor/profile UUIDs and internal mutation IDs. */
export function getClientSafeToolResult(
  result: ToolExecutionResult,
): ToolExecutionResult {
  if (PRIVATE_SCHEDULE_MUTATION_TOOLS.has(result.toolName)) {
    return privacySafePersistedScheduleResult(result);
  }
  if (result.toolName === PRIVATE_BOOKING_CANCELLATION_TOOL) {
    return privacySafePersistedBookingCancellationResult(result);
  }
  return result;
}

export function getClientSafeToolInput(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return PRIVATE_SCHEDULE_MUTATION_TOOLS.has(toolName)
    ? privacySafeScheduleToolInput(input)
    : toolName === PRIVATE_BOOKING_CANCELLATION_TOOL
      ? {}
      : input;
}

/**
 * 자리표시 카드인지. 저장된 장소 검색 결과에는 제공자 텍스트가 없고 이 표가 붙는다.
 */
export function isPlaceSearchPlaceholder(result: ToolExecutionResult): boolean {
  return result.toolName === EPHEMERAL_PLACE_SEARCH_TOOL
    && result.toolOutput.displayOnlyPlaceholder === true;
}

/**
 * 저장할 장소 검색 결과. 제공자 텍스트는 **한 글자도** 넘기지 않는다. (2026-09-03)
 *
 * 새로고침하면 장소 카드가 통째로 사라지던 문제 때문에 만들었다 — 예전에는 이
 * 도구의 결과를 통째로 뺐고, 그래서 다시 열면 아모라의 글만 남았다. 이제
 * **우리가 만든 값만**(질의·조회 시각·개수) 남겨 카드 자리에 자리표시 카드를 그린다.
 * 업체명·주소·설명·URL·사진은 예전과 똑같이 저장하지 않는다.
 *
 * 남길 것이 없는 경우(실패·웨딩업체 차단·0곳)는 예전처럼 통째로 뺀다.
 * 저장된 값에 다시 적용해도 같은 값이 나온다(자리표시 → 자리표시).
 */
function placeSearchPlaceholderResult(
  result: ToolExecutionResult,
): ToolExecutionResult | null {
  if (!result.success) return null;
  const output = result.toolOutput;
  const query = typeof output.query === "string" ? output.query.trim() : "";
  if (!query) return null;
  const places = Array.isArray(output.places) ? output.places : [];
  const resultCount =
    typeof output.resultCount === "number" && Number.isFinite(output.resultCount)
      ? output.resultCount
      : places.length;
  if (resultCount <= 0) return null;
  return {
    toolName: result.toolName,
    toolInput: {},
    toolOutput: {
      places: [],
      query,
      resultCount,
      ...readPlaceSearchFacts(output),
      ...(typeof output.searchedAt === "string" && output.searchedAt
        ? { searchedAt: output.searchedAt }
        : {}),
      displayOnlyPlaceholder: true,
    },
    success: true,
    displayMessage: "",
  };
}

/** NAVER Search content is display-only and must never enter chat storage. */
export function getPersistableToolResults(
  results: ToolExecutionResult[]
): ToolExecutionResult[] {
  return results
    .flatMap((result) => {
      // 개인 조회 건수와 모델 초안은 별도 최소 metadata만 사용한다. 도구 이력으로 재전송하지 않는다.
      if (result.toolName === "get_personal_actions" || result.toolName === "prepare_personal_action") return [];
      if (result.toolName === EPHEMERAL_PLACE_SEARCH_TOOL) {
        const placeholder = placeSearchPlaceholderResult(result);
        return placeholder ? [placeholder] : [];
      }
      return [result];
    })
    .map((result) => {
      if (PRIVATE_SCHEDULE_MUTATION_TOOLS.has(result.toolName)) {
        return privacySafePersistedScheduleResult(result);
      }
      if (result.toolName === PRIVATE_BOOKING_CANCELLATION_TOOL) {
        return privacySafePersistedBookingCancellationResult(result);
      }
      return result;
    });
}

/**
 * Search output is untrusted third-party content rendered directly by clients.
 * The model receives only a fixed status marker, never provider content.
 *
 * 2026-09-03 — 여기에 **우리가 만든 값**만 셋 더한다. 그 전까지 모델은 자기 검색
 * 결과를 한 글자도 못 봐서 "몇 곳 찾았어?" 에 화면을 보라고 되돌렸고, 결과가 0곳인데
 * "카드에서 확인해 주세요" 라고 말했다.
 *
 * - `resultCount` : 우리가 센 카드 개수 (0곳과 5곳을 구분하게)
 * - `effectiveQuery` : 서버가 실제로 네이버에 보낸 질의 (모델이 준 말 + 우리 보정)
 * - `searchedAt` : 우리 시계의 조회 시각
 *
 * 업체명·주소·설명·URL 같은 **제공자 텍스트는 계속 넣지 않는다** — 인젝션 경계는
 * 그대로다. 그래서 위 세 칸은 `toolOutput` 에서 형이 맞을 때만 옮겨 담는다.
 */
export function getModelSafeToolOutput(result: ToolExecutionResult): Record<string, unknown> {
  if (PRIVATE_SCHEDULE_MUTATION_TOOLS.has(result.toolName)) {
    return privacySafeScheduleToolOutput(result);
  }
  if (result.toolName === PRIVATE_BOOKING_CANCELLATION_TOOL) {
    return privacySafeBookingCancellationOutput(result);
  }
  if (result.toolName !== EPHEMERAL_PLACE_SEARCH_TOOL) return result.toolOutput;
  const output = result.toolOutput;
  const places = Array.isArray(output.places) ? output.places : [];
  // 2026-09-03: 카드는 `places` 로 그린다. 모델이 듣는 개수도 **같은 배열**에서 센다 —
  // 둘이 갈리면 사용자는 카드 5장을 보면서 "후보가 확인되지 않았어요" 를 함께 읽는다.
  // (스테이징에서 그 조합을 한 번 봤다. 출처는 변형 증명이 서빙 중인 트리를 잠깐 고친
  // 측정 오염이었지만, 실행기가 따로 실어 보내는 개수를 믿는 계약 자체가 구멍이었다.)
  const resultCount = places.length;
  return {
    success: result.success,
    status: result.success ? "rendered_in_client" : "unavailable",
    resultCount,
    ...readPlaceSearchFacts(output),
    ...(typeof output.effectiveQuery === "string" && output.effectiveQuery
      ? { effectiveQuery: output.effectiveQuery }
      : {}),
    ...(typeof output.searchedAt === "string" && output.searchedAt
      ? { searchedAt: output.searchedAt }
      : {}),
  };
}

export function hasEphemeralPlaceSearchResult(results: ToolExecutionResult[]): boolean {
  return results.some((result) => result.toolName === EPHEMERAL_PLACE_SEARCH_TOOL);
}
