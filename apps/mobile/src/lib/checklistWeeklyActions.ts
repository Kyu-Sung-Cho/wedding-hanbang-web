/**
 * 체크리스트 화면의 「이번 주 확인 제안」 — 어떤 분야를 먼저 보여주고, 기본 확인 시점을 어떻게 말하는가.
 *
 * ## 왜 따로 뺐나
 *
 * 이 계산은 `app/schedule/index.tsx` 안에 있었고 분야의 `ddayDeadline` 하나로 남은 날을 셌다.
 * 한 분야 안에 이른 일과 늦은 일이 섞여 있어서, 제때 준비하는 커플도 늦게 하는 항목 하나
 * (결혼식 직전 최종으로 입어 보기, 빌린 옷 돌려주기, 결혼식 날 헤어·메이크업 확인)만 남으면
 * 결혼식 날까지 "기본 확인 시점에서 20일 지났어요"를 봤다.
 *
 * 웹(`apps/web/src/utils/imminentChecklist.ts`)은 공유 헬퍼 `getChecklistCategoryDueDday`로
 * **아직 안 끝낸 항목 중 가장 이른 시점**을 센다. 여기도 같은 헬퍼를 불러 두 앱이 같은 커플에게
 * 같은 날을 말하게 한다. 화면 밖으로 뺀 이유는 이 규칙을 `node --test`로 확인하기 위해서다.
 */
import {
  getChecklistCategoryDueDday,
  getChecklistItemDueDday,
  type ChecklistItemDue,
} from "@hanbang/shared/utils";

export type ActionUrgency = "overdue" | "urgent" | "soon" | "active";

export interface WeeklyAction {
  categoryKey: string;
  categoryLabel: string;
  nextItemLabel: string;
  urgency: ActionUrgency;
  deadlineLabel: string;
  daysUntilDeadline: number | null;
  percent: number;
}

export interface WeeklyActionTemplate {
  key: string;
  label: string;
  ddayStart: number;
  ddayDeadline: number;
  items: readonly { id: string; due?: ChecklistItemDue }[];
}

export interface WeeklyActionCategoryState {
  /** 템플릿과 병합한 항목(`mergePlanningChecklist` 결과). */
  items: readonly { id: string; label: string; done: boolean }[];
  skipped: boolean;
  percent: number;
}

const URGENCY_RANK: Record<ActionUrgency, number> = {
  overdue: 0,
  urgent: 1,
  soon: 2,
  active: 3,
};

export function weeklyActionDeadlineLabel(daysUntilDeadline: number | null): string {
  if (daysUntilDeadline === null) return "결혼식 날짜를 넣으면 기본 확인 순서를 정리해요";
  if (daysUntilDeadline < 0) return `기본 확인 시점에서 ${Math.abs(daysUntilDeadline)}일 지났어요`;
  if (daysUntilDeadline === 0) return "오늘이 기본 확인 시점이에요";
  return `기본 확인 시점까지 ${daysUntilDeadline}일`;
}

/**
 * @param dday 결혼식까지 남은 날 수(결혼식 날 0, 지나면 음수). 날짜가 없으면 `null`.
 * @param stateFor 분야 키로 지금 상태를 돌려준다. 기록이 없으면 `undefined`.
 */
export function buildWeeklyChecklistActions(
  templates: readonly WeeklyActionTemplate[],
  stateFor: (key: string) => WeeklyActionCategoryState | undefined,
  dday: number | null,
  limit = 3,
): WeeklyAction[] {
  if (dday !== null && dday < 0) return [];

  const candidates = templates.flatMap((template): WeeklyAction[] => {
    const state = stateFor(template.key);
    const percent = state?.percent ?? 0;
    if (state?.skipped || percent >= 100) return [];
    if (dday !== null && dday > template.ddayStart) return [];

    const items = state?.items ?? [];
    const due = getChecklistCategoryDueDday(template, items);
    // 남은 일이 전부 계약·약속으로 정한 날에 하는 일이면 앱이 그 날을 모른다. 웹 임박 알림도 뺀다.
    if (dday !== null && due === null) return [];

    const remaining = items.filter((item) => !item.done);
    // 문구의 「다음 할 일」도 그 시점을 가진 항목으로 고른다. 날짜가 없으면 목록 순서대로.
    const nextItem = (due === null
      ? undefined
      : remaining.find((item) => getChecklistItemDueDday(template, item.id) === due))
      ?? remaining[0];

    const daysUntilDeadline = dday === null || due === null ? null : dday - due;

    let urgency: ActionUrgency = "active";
    if (daysUntilDeadline !== null) {
      if (daysUntilDeadline < 0) urgency = "overdue";
      else if (daysUntilDeadline <= 7) urgency = "urgent";
      else if (daysUntilDeadline <= 30) urgency = "soon";
    }

    return [{
      categoryKey: template.key,
      categoryLabel: template.label,
      nextItemLabel: nextItem?.label ?? `${template.label} 체크리스트 점검`,
      urgency,
      deadlineLabel: weeklyActionDeadlineLabel(daysUntilDeadline),
      daysUntilDeadline,
      percent,
    }];
  });

  return candidates
    .sort((a, b) => {
      const urgencyDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      if (a.daysUntilDeadline !== null && b.daysUntilDeadline !== null) {
        return a.daysUntilDeadline - b.daysUntilDeadline;
      }
      return a.percent - b.percent;
    })
    .slice(0, limit);
}
