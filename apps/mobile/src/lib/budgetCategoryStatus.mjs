/**
 * 예산 화면의 항목 상태와 "안 해요" 항목을 행으로 둘지.
 *
 * 예전 모바일 예산 화면은 `completed`·`in_progress`가 아닌 것을 전부 "예정"으로 불렀다.
 * 그래서 온보딩·체크리스트에서 "안 해요"로 고른 항목도 예산에서는 "예정"으로 보였고,
 * 상태 색은 한국어 문자열("완료"·"진행중")을 비교해서 정했다. 이름이 바뀌면 색이 조용히 빠진다.
 *
 * 이제 상태는 **키**로 읽고, 이름은 화면이 공유 사전
 * `PREPARATION_PROGRESS_STATUS_LABELS`(아직·준비 중·완료·안 해요)에서 붙인다. 웹 예산
 * 화면(`BudgetContent.tsx`)과 같은 규칙이다. 이 파일은 `node --test`가 그대로 읽도록 의존성이 없다.
 */

const STATUSES = new Set(["not_started", "in_progress", "completed", "not_applicable"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 저장된 상태를 네 키 중 하나로. 모르는 값·빈 값은 "아직"(`not_started`)이다. */
export function readBudgetCategoryStatus(item) {
  const status = isRecord(item) ? item.status : undefined;
  return typeof status === "string" && STATUSES.has(status) ? status : "not_started";
}

/**
 * "안 해요"로 고른 항목에 예산·기록 지출·예전 금액이 하나도 없으면 예산 행으로 두지 않는다.
 * 금액이 하나라도 있으면 합계에 들어가므로 행과 "안 해요" 표시를 그대로 보여준다.
 * 웹 `isSkippedBudgetCategoryWithoutMoney`와 같은 판정이다.
 */
export function isSkippedBudgetCategoryWithoutMoney(item) {
  if (!isRecord(item) || item.status !== "not_applicable") return false;
  return !["budget", "spent", "cost"].some((field) => {
    const value = item[field];
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  });
}
