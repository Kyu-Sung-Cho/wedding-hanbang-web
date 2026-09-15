/**
 * 체크리스트 항목마다의 기본 확인 시점과 "지났다"는 판정.
 *
 * ## 왜 항목 단위인가
 *
 * 분야에는 `ddayDeadline` 하나만 있었다. 그런데 한 분야 안에 이른 일과 늦은 일이 섞여 있다.
 * 사진 촬영 분야의 기본 확인 시점은 결혼식 150일 전인데 "받을 사진 고르기"와 "완성된 앨범
 * 받기"가 같은 분야에 들어 있고, 드레스 분야(120일 전)에는 "결혼식 전 최종으로 입어 보기"와
 * "빌린 옷 돌려주기"가, 헤어·메이크업 분야(60일 전)에는 결혼식 날 확인이 들어 있다.
 * 분야 기준으로만 세면 **제때 준비하는 커플도** 그 늦은 항목을 아직 안 했다는 이유로
 * 결혼식 날까지 "기본 확인 시점에서 N일 지남"을 보게 된다.
 *
 * 그래서 늦게 하는 항목에 `due`를 적고, 지남·임박 판정은 **아직 안 끝낸 항목 중 자기 시점이
 * 가장 이른 것**으로 한다. 웹(`apps/web/src/utils/imminentChecklist.ts`)과 모바일이 같은
 * 규칙을 쓰도록 여기 한 곳에 둔다.
 *
 * ## 날짜 표기
 *
 * `dday`와 `due`는 모두 **결혼식까지 남은 날 수**다. 결혼식 날이 0, 그 뒤는 음수다.
 * 분야의 `ddayDeadline`과 같은 축이라 서로 바로 비교된다.
 *
 * 이 파일은 의존성이 없어야 한다 — `node --test`가 소스를 그대로 옮겨 실행한다.
 */

/**
 * 반납·수령·입주처럼 **계약이나 약속으로 정한 날**에 하는 일.
 *
 * 앱은 그 날짜를 모른다. 숫자를 지어 넣으면 계약과 다른 날에 "지남"을 말하게 되므로
 * 지남·임박 계산에서 뺀다. 항목은 목록과 진행률에 그대로 남는다.
 */
export const CHECKLIST_AGREED_DATE = "agreed_date" as const;

/**
 * 항목의 기본 확인 시점.
 * - 숫자: 결혼식 N일 전(0은 결혼식 날, 음수는 결혼식 뒤).
 * - `"agreed_date"`: 계약·약속으로 정한 날에 하는 일. 지남 계산에서 뺀다.
 */
export type ChecklistItemDue = number | typeof CHECKLIST_AGREED_DATE;

/** 분야 템플릿에서 이 판정이 읽는 부분만. `CategoryChecklistTemplate`이 그대로 들어온다. */
export interface ChecklistDueTemplateLike {
  ddayDeadline: number;
  items: readonly { id: string; due?: ChecklistItemDue }[];
}

/** 진행 기록에서 이 판정이 읽는 부분만. 병합한 체크리스트 항목이 그대로 들어온다. */
export interface ChecklistDueItemLike {
  id: string;
  done: boolean;
}

/**
 * 항목 하나의 기본 확인 시점(결혼식까지 남은 날 수). 계약·약속으로 정한 날에 하는 항목은 `null`.
 *
 * 시점은 **템플릿에서** 읽는다. 저장된 항목에는 `due`가 실리지 않고(저장 전에 떼어 낸다),
 * 템플릿에 없는 항목(예전 버전·직접 추가한 항목)은 분야의 `ddayDeadline`을 따른다.
 */
export function getChecklistItemDueDday(
  template: ChecklistDueTemplateLike,
  itemId: string,
): number | null {
  const templateItem = template.items.find((item) => item.id === itemId);
  const due = templateItem?.due;
  if (due === CHECKLIST_AGREED_DATE) return null;
  if (typeof due === "number" && Number.isFinite(due)) return due;
  return template.ddayDeadline;
}

/**
 * 이 항목의 기본 확인 시점이 **이미 지났고** 아직 끝내지 않았는가.
 *
 * @param dday 오늘 기준 결혼식까지 남은 날 수(결혼식 날 0, 지난 뒤 음수).
 * 기본 확인 시점 당일(`dday === due`)은 아직 지나지 않은 것으로 본다.
 */
export function isChecklistItemOverdue(
  template: ChecklistDueTemplateLike,
  item: ChecklistDueItemLike,
  dday: number,
): boolean {
  if (item.done) return false;
  const due = getChecklistItemDueDday(template, item.id);
  return due !== null && dday < due;
}

/**
 * 분야의 **지금 기준** 기본 확인 시점 — 아직 끝내지 않은 항목 중 시점이 가장 이른 것.
 *
 * 결혼식까지 남은 날 수로 돌려주므로 값이 **클수록 이르다**. 남은 일이 없거나 남은 일이 전부
 * 계약·약속으로 정한 날에 하는 일이면 `null`이다.
 *
 * 항목 기록이 없거나 빈 배열이면 템플릿 항목을 전부 안 끝낸 것으로 본다
 * (`mergePlanningChecklist`가 같은 규칙으로 병합한다). 그래서 아무것도 체크하지 않은 분야는
 * 이 값이 분야의 `ddayDeadline`과 같다 — 분야 기본 시점은 가장 이른 항목 시점이기 때문이다.
 *
 * 사용: `const due = getChecklistCategoryDueDday(template, mergedItems);`
 * `const daysUntilDeadline = dday === null || due === null ? null : dday - due;`
 */
export function getChecklistCategoryDueDday(
  template: ChecklistDueTemplateLike,
  checklist: readonly ChecklistDueItemLike[] | undefined,
): number | null {
  const items: readonly ChecklistDueItemLike[] =
    Array.isArray(checklist) && checklist.length > 0
      ? checklist
      : template.items.map((item) => ({ id: item.id, done: false }));

  let earliest: number | null = null;
  for (const item of items) {
    if (item.done) continue;
    const due = getChecklistItemDueDday(template, item.id);
    if (due === null) continue;
    if (earliest === null || due > earliest) earliest = due;
  }
  return earliest;
}
