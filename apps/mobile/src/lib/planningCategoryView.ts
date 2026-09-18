/**
 * 체크리스트 화면이 분야 하나를 **읽는** 규칙. 저장하지 않는다.
 *
 * ## 왜 따로 두나
 *
 * 분야 상태(`progress[key].status`)에는 두 가지가 섞여 있다(`resolvePlanningChecklistStatus`
 * 주석). 체크를 토글할 때 저장되는 **항목 파생값**과, 온보딩·라운지·아모라가 항목을 건드리지
 * 않고 남기는 **분야 단위 선언**이다. 웹 체크리스트와 앱 라운지는 공유 규칙으로 둘을 가렸는데
 * 앱 체크리스트 화면만 항목을 다시 세서 상태를 만들었다. 그래서 다른 곳에서 "완료"라고 한
 * 분야가 이 화면에서만 `0/9 완료 · 아직` 으로 보였다.
 *
 * 규칙은 공유 코드(`@hanbang/shared/utils`)에 있고, 여기서는 앱이 저장값을 그 규칙에 넣을
 * 모양으로 바꾸는 일과, 웹 카드와 같은 말을 만드는 일만 한다.
 */
import {
  isPlanningChecklistStatusDeclared,
  mergePlanningChecklist,
  resolvePlanningChecklistStatus,
  type PlanningChecklistItem,
  type PlanningChecklistStatus,
} from "@hanbang/shared/utils";
import { PREPARATION_PROGRESS_STATUS_LABELS } from "@hanbang/shared/constants";

export interface PlanningCategoryView<T extends PlanningChecklistItem> {
  /** 템플릿 순서로 병합한 항목. 템플릿에 없는 저장 항목은 뒤에 붙는다. */
  items: T[];
  /** 화면에 그릴 상태. 항목 기록이 있으면 파생하고, 없으면 저장된 선언을 둔다. */
  status: PlanningChecklistStatus;
  /** 항목을 세지 않고 분야 단위로 "준비 중·완료"라고 표시한 것인가. */
  declared: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlanningChecklistStatus(value: unknown): value is PlanningChecklistStatus {
  return value === "not_started"
    || value === "in_progress"
    || value === "completed"
    || value === "not_applicable";
}

const LEGACY_ITEM_LABEL = "이전 준비 항목";

/**
 * 저장된 항목 기록을 `{ id, label, done }` 으로 읽는다.
 *
 * - `checklist` 배열이 있으면 그것을 읽는다. id 가 문자열이 아닌 줄은 버린다.
 * - 배열이 없으면 **옛 플랫 모양**(`{ meeting_01: true }`)의 불리언만 항목으로 읽는다.
 *   예산 금액 같은 다른 칸은 항목이 아니다. 운영 데이터에 이 모양이 남았는지 확인하지 못해
 *   지우지 않았다(라운지와 같은 판단).
 */
function readSavedChecklist<T extends PlanningChecklistItem>(
  templateItems: readonly T[],
  saved: Record<string, unknown> | undefined,
): PlanningChecklistItem[] {
  if (!saved) return [];
  const labelOf = (id: string) =>
    templateItems.find((item) => item.id === id)?.label ?? LEGACY_ITEM_LABEL;
  if (Array.isArray(saved.checklist)) {
    return saved.checklist.filter(isRecord).flatMap((item) => (
      typeof item.id === "string" && item.id.length > 0
        ? [{
            id: item.id,
            label: typeof item.label === "string" ? item.label : labelOf(item.id),
            done: item.done === true,
          }]
        : []
    ));
  }
  return Object.entries(saved)
    .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
    .map(([id, done]) => ({ id, label: labelOf(id), done }));
}

/**
 * 분야 하나를 화면에 그릴 모양으로 읽는다. 저장값이 무엇이든 던지지 않는다.
 */
export function readPlanningCategoryView<T extends PlanningChecklistItem>(
  templateItems: readonly T[],
  saved: unknown,
): PlanningCategoryView<T> {
  const record = isRecord(saved) ? saved : undefined;
  const checklist = readSavedChecklist(templateItems, record);
  const storedStatus = isPlanningChecklistStatus(record?.status) ? record.status : undefined;
  // 공유 규칙에 넣는 값. 저장된 옛 플랫 모양도 항목 기록으로 넘겨야 파생이 된다.
  const progress = { status: storedStatus, checklist };
  return {
    // 템플릿이 가진 note·due 같은 안내는 병합본에 그대로 실린다. 저장 항목은 id·label·done 뿐이다.
    items: mergePlanningChecklist(templateItems, checklist as T[]),
    status: resolvePlanningChecklistStatus(templateItems, progress),
    declared: isPlanningChecklistStatusDeclared(progress),
  };
}

/** 받침으로 고르는 '으로/로'. ㄹ 받침은 '로'다(웹 `lib/korean/particles.ts` 와 같은 규칙). */
function directionParticle(word: string): string {
  const last = [...word.trim()].pop();
  if (!last) return "로";
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "로";
  const finalConsonant = code % 28;
  return finalConsonant === 0 || finalConsonant === 8 ? "로" : "으로";
}

/**
 * 선언만 있는 분야의 말. 웹 체크리스트 카드와 같다 — 「완료로 표시함」「준비 중으로 표시함」.
 * 상태 이름은 공용 사전에서만 읽는다.
 */
export function declaredStatusNote(status: PlanningChecklistStatus): string {
  const label = PREPARATION_PROGRESS_STATUS_LABELS[status];
  return `${label}${directionParticle(label)} 표시함`;
}

/**
 * 체크리스트 머리 요약의 두 줄. 웹(`ChecklistContent.tsx`)과 같은 말이다.
 * 제외한 분야가 없으면 둘째 줄은 없다.
 */
export function planningChecklistSummaryLines(summary: {
  done: number;
  total: number;
  skippedCategories: number;
}): { counts: string; skipped: string | null } {
  const remaining = Math.max(0, summary.total - summary.done);
  return {
    counts: `${summary.done}개 완료 · ${remaining}개 남음`,
    skipped: summary.skippedCategories > 0
      ? `${summary.skippedCategories}개 분야는 진행률에서 제외했어요`
      : null,
  };
}
