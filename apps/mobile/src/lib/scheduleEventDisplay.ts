/**
 * 일정 화면이 **표시용으로** 일정을 읽을 때 쓰는 작은 도우미.
 *
 * 여기 있는 것은 전부 읽는 쪽이다. 저장값을 바꾸지 않는다 — 이름으로 저장된 옛 분야 값을
 * 키로 바꾸는 것도 화면 상태에서만 한다(2026-09-18 파운더 결정: 운영 DB는 고치지 않는다).
 */
import { scheduleEventCategoryKeyFromStored } from "@hanbang/shared/constants";
import { todayYmdInKst } from "@hanbang/shared/utils";

/**
 * 분야 값을 키로 읽은 **사본**을 돌려준다. 원본은 그대로다.
 *
 * 앱은 2026-09-18까지 분야를 한국어 이름(`"결혼식장"`, `"기타"`)으로 저장했다. 표시용으로
 * 읽을 때 키로 바꿔 두면 목록은 이름표로, 수정 화면은 선택지로 같은 값을 찾는다.
 */
export function withScheduleCategoryKey<T extends { categoryKey?: string }>(event: T): T {
  const key = scheduleEventCategoryKeyFromStored(event.categoryKey);
  if (key !== undefined) return { ...event, categoryKey: key };
  // 빈 분야는 분야가 없는 것과 같다. 표시용 사본에서만 뺀다.
  const copy: T = { ...event };
  delete copy.categoryKey;
  return copy;
}

/**
 * 시각(ISO 문자열)의 **한국 날짜**를 `YYYY-MM-DD`로 준다. 읽을 수 없으면 `null`.
 *
 * `cancelledAt.slice(0, 10)` 은 UTC 날짜라서 한국 새벽 0~9시에 취소한 일정이 전날 취소로
 * 보였다. 한국은 서머타임이 없어 +9시간 고정 계산(`todayYmdInKst`)이 언제나 맞다.
 */
export function kstDateOfInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  return todayYmdInKst(instant);
}
