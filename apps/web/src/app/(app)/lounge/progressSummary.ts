import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { ProgressItem } from "@/types/database.types";
import { getChecklistCounts, mergeChecklist, resolveStatus } from "@/utils/checklist";

type Status = ProgressItem["status"];

/**
 * 라운지가 쓰는 진행률 계산.
 *
 * 페이지에서 꺼내 둔 이유는 하나다 — **두 화면이 같은 숫자를 내는지 테스트할 수 있어야
 * 해서다.** 2026-08-20까지 이 화면은 "해당 없음"으로 끈 분야를 분모에 넣고 체크리스트
 * 화면은 뺐다. 같은 계정에서 진행률이 다르게 보였는데, 원인은 `getStatus`가
 * not_applicable을 못 돌려줘서 그 아래 분기가 통째로 죽은 코드였던 것이다.
 */
export function getStatus(progress: Record<string, ProgressItem>, key: string): Status {
  const saved = progress[key];
  const status = saved?.status;
  // "해당 없음"도 그대로 돌려준다. 예전엔 이 화이트리스트에서 빠져 있어서 아래
  // `getProgressSummary`의 not_applicable 분기가 **도달할 수 없는 죽은 코드**였다.
  // 그래서 체크리스트 화면은 끈 분야를 분모에서 빼는데 이 화면은 넣어, 같은 계정에서
  // 진행률이 서로 다르게 나왔다.
  // 저장값을 그대로 쓰지 않는다. `:69`가 완료된 분야를 할 일 목록에서 빼는데, 템플릿에
  // 항목이 늘면 저장값이 낡아 **새 항목이 통째로 숨는다.** 항목 기록이 있을 때만 파생하고
  // 없으면 저장된 선언을 그대로 둔다 — 판단 근거는 `resolvePlanningChecklistStatus` 참고.
  // 위 화이트리스트와 같은 검증을 리졸버가 안에서 한다.
  const template = CATEGORY_CHECKLISTS.find((category) => category.key === key);
  if (!template) {
    return (
      status === "completed"
      || status === "in_progress"
      || status === "not_started"
      || status === "not_applicable"
    ) ? status : "not_started";
  }
  return resolveStatus(template.items, saved, template.defaultStatus);
}

export function getChecklistProgress(progress: Record<string, ProgressItem>, key: string) {
  const template = CATEGORY_CHECKLISTS.find((category) => category.key === key);
  const saved = progress[key]?.checklist;
  const status = getStatus(progress, key);
  if (!template) return { done: status === "completed" ? 1 : 0, total: 1 };
  const merged = mergeChecklist(template.items, saved, status);
  return getChecklistCounts(merged);
}

export function getProgressSummary(progress: Record<string, ProgressItem>) {
  return CATEGORY_CHECKLISTS.reduce(
    (acc, category) => {
      const status = getStatus(progress, category.key);
      // "해당 없음"으로 끈 항목은 진행률 분모에서 빠진다 —
      // 함·폐백·예단을 생략한 커플이 영원히 미완료로 남지 않게.
      if (status === "not_applicable") {
        acc.not_applicable += 1;
        return acc;
      }
      const counts = getChecklistProgress(progress, category.key);
      acc[status] += 1;
      acc.done += counts.done;
      acc.total += counts.total;
      return acc;
    },
    { completed: 0, in_progress: 0, not_started: 0, not_applicable: 0, done: 0, total: 0 }
  );
}

/**
 * 「놓치기 쉬운 항목」에 그릴 분야.
 *
 * `excludeKeys`는 **같은 화면 위쪽 주차 카드가 이미 그린 분야**다. 빼지 않으면 같은
 * 분야가 한 화면에 두 번, 문구까지 같게 나온다(`기본 확인 시점까지 N일`). 실제로
 * 그랬다. 빼는 것은 `slice` **앞**이어야 한다 — 뒤에서 빼면 목록이 6개보다 줄어든다.
 */
export function getActiveCategories(
  progress: Record<string, ProgressItem>,
  dday: number | null,
  excludeKeys: ReadonlySet<string> = new Set(),
) {
  return CATEGORY_CHECKLISTS.map((category) => {
    const counts = getChecklistProgress(progress, category.key);
    const status = getStatus(progress, category.key);
    const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
    const daysUntilDeadline = dday === null ? null : dday - category.ddayDeadline;
    return { category, counts, status, percent, daysUntilDeadline };
  })
    // 끝낸 분야와 "해당 없음"으로 끈 분야는 할 일 목록에서 뺀다. 끈 분야를 남겨 두면
    // 함·폐백을 생략한 커플에게 영원히 지워지지 않는 할 일이 보인다.
    .filter((item) => item.status !== "completed" && item.status !== "not_applicable")
    .filter((item) => !excludeKeys.has(item.category.key))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "in_progress" ? -1 : b.status === "in_progress" ? 1 : 0;
      const aDeadline = a.daysUntilDeadline ?? 9999;
      const bDeadline = b.daysUntilDeadline ?? 9999;
      return aDeadline - bDeadline;
    })
    .slice(0, 6);
}
