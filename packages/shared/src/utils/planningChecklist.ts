import type { ChecklistItemDue } from "./checklistItemDue";

export type PlanningChecklistStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "not_applicable";

export interface PlanningChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** 템플릿이 소유하는 한 줄 안내. 저장 전에 `stripPlanningChecklistNotes`로 떼어 낸다. */
  note?: string;
  /** 템플릿이 소유하는 항목별 기본 확인 시점. 저장 전에 `stripPlanningChecklistNotes`로 떼어 낸다. */
  due?: ChecklistItemDue;
}

export interface PlanningChecklistProgress {
  status?: PlanningChecklistStatus;
  checklist?: PlanningChecklistItem[];
}

export interface PlanningChecklistTemplateLike {
  key: string;
  items: PlanningChecklistItem[];
}

/**
 * 템플릿의 안정적인 순서를 유지하면서 이전 버전·직접 추가 항목도 잃지 않는다.
 * 알 수 없는 저장 항목은 마지막에 붙여 round-trip 저장 시에도 보존한다.
 */
export function mergePlanningChecklist<T extends PlanningChecklistItem>(
  template: readonly T[],
  saved: readonly T[] | undefined,
): T[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return template.map((item) => ({ ...item, done: false }));
  }

  const savedById = new Map<string, T>();
  for (const item of saved) {
    if (!savedById.has(item.id)) savedById.set(item.id, item);
  }
  const templateIds = new Set(template.map((item) => item.id));
  const merged = template.map((item) => {
    const savedItem = savedById.get(item.id);
    return {
      ...(savedItem ?? {}),
      ...item,
      done: savedItem?.done ?? false,
    } as T;
  });

  const appendedIds = new Set<string>();
  for (const item of saved) {
    if (!templateIds.has(item.id) && !appendedIds.has(item.id)) {
      merged.push({ ...item });
      appendedIds.add(item.id);
    }
  }
  return merged;
}

/**
 * 저장 직전에 `note`를 떼어 낸다. `mergePlanningChecklist`의 반대편이다.
 *
 * `note`는 제품 문구지 사용자 데이터가 아니다. 그대로 저장하면 사용자 행마다 문구가
 * 복제되고, 나중에 문구를 고쳐도 저장된 값은 옛 문장인 채로 남는다. 읽을 때 템플릿이
 * 덮으므로 화면은 맞지만 DB에는 계속 어긋난 사본이 쌓인다. 저장에 필요한 건 `id`와
 * `done`뿐이라, 이 필드가 없던 때와 똑같은 모양으로 되돌려 보낸다.
 *
 * 항목별 기본 확인 시점(`due`)도 같은 이유로 뗀다. 게다가 DB는 항목을 `{id, label, done}`
 * 세 키로만 받아서, 하나라도 더 실리면 쓰기가 거절된다. 이름은 호출부가 여럿이라 그대로 둔다.
 */
export function stripPlanningChecklistNotes<T extends PlanningChecklistItem>(
  checklist: readonly T[],
): T[] {
  return checklist.map((item) => {
    if (item.note === undefined && item.due === undefined) return { ...item };
    const { note: _note, due: _due, ...rest } = item;
    return rest as T;
  });
}

export function calculatePlanningChecklistStatus(
  checklist: readonly PlanningChecklistItem[],
): Exclude<PlanningChecklistStatus, "not_applicable"> {
  if (checklist.length === 0 || checklist.every((item) => !item.done)) {
    return "not_started";
  }
  if (checklist.every((item) => item.done)) return "completed";
  return "in_progress";
}

export function getPlanningChecklistCounts(
  checklist: readonly PlanningChecklistItem[] | undefined,
): { done: number; total: number } {
  if (!checklist || checklist.length === 0) return { done: 0, total: 0 };
  return {
    done: checklist.filter((item) => item.done).length,
    total: checklist.length,
  };
}

/**
 * 화면에 그릴 분야 상태를 정한다. **저장된 status 를 그대로 믿지 않는다.**
 *
 * `progress.status` 는 두 가지가 한 칸에 섞여 있다.
 *
 * 1. **항목에서 파생한 캐시.** 체크를 토글할 때마다 `calculatePlanningChecklistStatus`
 *    결과가 저장된다(모달·일정 화면·아모라 쓰기·모바일, 여섯 곳 전부).
 * 2. **분야 단위 선언.** 온보딩에서 "이건 이미 했어요"를 고르면 항목 없이 status 만
 *    저장되고(`buildOnboardingProgress`), 대시보드의 세 버튼 피커와 아모라의
 *    `update_task_status` 도 항목을 건드리지 않고 status 만 바꾼다. 서버 검증도
 *    이 모양을 허용한다 — `checklist` 키가 없으면 통과시킨다.
 *
 * 1번은 **템플릿에 항목이 늘면 낡는다.** 열한 개를 다 끝내 `completed` 로 저장된 분야에
 * 열두 번째 항목이 생기면, 화면은 개수는 병합본에서 세고(11/12) 상태는 저장값을 써서
 * `11/12개 완료 · 완료` 가 된다. 더 나쁜 것은 라운지 '지금 할 일'과 마감 알림이
 * 저장값이 `completed` 라는 이유로 그 분야를 통째로 숨기는 것이다 — 새 항목이 보이지
 * 않으니 열지 않고, 열지 않으니 저장값이 갱신될 계기도 없다.
 *
 * 그래서 **항목 기록이 있을 때만** 파생한다. 두 종류를 가르는 표지는 저장된 `checklist`
 * 배열의 유무다.
 *
 * - `not_applicable` 은 사용자가 "안 해요"로 고른 값이고 파생이 만들 수 없는 값이라
 *   (`calculatePlanningChecklistStatus` 의 반환형이 이 값을 제외한다) 언제나 보존한다.
 *   이걸 덮으면 함·폐백을 생략한 커플에게 지워지지 않는 할 일이 생긴다.
 * - 항목 기록이 없으면 **파생할 근거가 없다.** 온보딩에서 분야 단위로 "했어요"라고 말한
 *   사람에게 0/12 "시작 전"을 보여주는 것은 낡은 "완료"보다 나쁘다.
 *
 * 이 함수는 **읽는 쪽만** 고친다. 낡은 값을 만드는 쓰기 경로와 DB에 남은 낡은 행은
 * 그대로다 — 증상을 없애지 원인을 없애지 않는다.
 */
/**
 * 이 분야의 상태가 **항목에서 나온 것이 아니라 분야 단위로 선언된 것**인가.
 *
 * 온보딩에서 "준비 단계" 한 줄을 고르면 여러 분야가 한꺼번에 완료로 채워진다
 * (`preparationStage.ts`의 `suggested`). 대시보드의 세 버튼 피커와 아모라의
 * `update_task_status` 도 항목을 건드리지 않고 상태만 바꾼다. 그런 행은 저장된
 * `checklist` 배열이 없다.
 *
 * 그때 화면이 개수와 상태를 나란히 쓰면 **`0/9개 완료 · 완료`** 가 된다. 파운더가
 * 2026-08-22에 "체크를 다 안 했는데 완료라고 뜬다"고 제보한 것이 이것이다. 고장이
 * 아니라 "항목별로는 안 셌지만 이 분야는 끝났다고 표시함"인데, 화면이 그 말을 못 한다.
 *
 * 그래서 화면이 구분해서 말할 수 있게 이 판정을 내준다. 상태를 바꾸지는 않는다 —
 * 선언을 파생으로 덮으면 온보딩에서 "이미 했어요"라고 한 분야가 전부 "시작 전"으로
 * 뒤집힌다.
 */
export function isPlanningChecklistStatusDeclared(
  saved: PlanningChecklistProgress | undefined,
): boolean {
  const stored = saved?.status;
  if (stored !== "in_progress" && stored !== "completed") return false;
  return !Array.isArray(saved?.checklist) || saved.checklist.length === 0;
}

export function resolvePlanningChecklistStatus(
  templateItems: readonly PlanningChecklistItem[],
  saved: PlanningChecklistProgress | undefined,
): PlanningChecklistStatus {
  // 저장된 값을 그대로 믿지 않는다. DB에 옛 형식이나 알 수 없는 값이 남아 있을 수 있어
  // 호출부마다 화이트리스트를 두던 것을 여기로 모았다. 호출부가 `{ status, checklist }`
  // 리터럴을 만들지 않아도 되게 하려는 뜻도 있다 — 그 모양은 저장 경로를 훑는
  // `checklistWritePaths` 검사가 쓰기로 오인한다.
  const stored = saved?.status;
  const status: PlanningChecklistStatus | undefined =
    stored === "not_started" || stored === "in_progress"
    || stored === "completed" || stored === "not_applicable"
      ? stored
      : undefined;

  if (status === "not_applicable") return "not_applicable";
  if (!Array.isArray(saved?.checklist) || saved.checklist.length === 0) {
    return status ?? "not_started";
  }
  return calculatePlanningChecklistStatus(
    mergePlanningChecklist(templateItems, saved.checklist),
  );
}

/** 웹·모바일·아모라가 공유하는 단일 진행률 계약. */
export function summarizePlanningChecklist(
  templates: readonly PlanningChecklistTemplateLike[],
  progress: Readonly<Record<string, PlanningChecklistProgress | undefined>>,
): {
  done: number;
  total: number;
  percent: number;
  skippedCategories: number;
  completedCategories: number;
  applicableCategories: number;
} {
  let done = 0;
  let total = 0;
  let skippedCategories = 0;
  let completedCategories = 0;
  let applicableCategories = 0;

  for (const template of templates) {
    const saved = progress[template.key];
    if (saved?.status === "not_applicable") {
      skippedCategories += 1;
      continue;
    }

    applicableCategories += 1;
    const merged = mergePlanningChecklist(template.items, saved?.checklist);
    const counts = getPlanningChecklistCounts(merged);
    done += counts.done;
    total += counts.total;
    if (counts.total > 0 && counts.done === counts.total) completedCategories += 1;
  }

  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    skippedCategories,
    completedCategories,
    applicableCategories,
  };
}
