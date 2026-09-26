import {
  WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES,
  type V31Choice, type V31Draft, type V31QuestionId, type V31Response, type V31TasteKey,
} from "@/constants/weddingCodeV31";

export type V31Flow = "core" | "extra" | "full";
export type V31StepId = V31QuestionId | `taste.${V31TasteKey}` | "avoidances" | "priorities" | "spending";

export const V31_CORE_RATING_IDS = ["G1", "G3", "R4", "B1", "B3", "D1", "T1", "T2", "T3", "F1", "F2", "F4", "H1", "H2", "H4"] as const satisfies readonly V31QuestionId[];
export const V31_EXTRA_RATING_IDS = ["V1", "G2", "R3", "B4", "D3", "T4", "F3", "H3"] as const satisfies readonly V31QuestionId[];
export const V31_LEGACY_ONLY_RATING_IDS = ["B2", "D2"] as const satisfies readonly V31QuestionId[];
export const V31_AVOIDANCE_INDEX = WEDDING_CODE_V31_QUESTIONS.length + WEDDING_CODE_V31_TASTES.length;
export const V31_PRIORITY_INDEX = V31_AVOIDANCE_INDEX + 1;
export const V31_SPENDING_INDEX = V31_PRIORITY_INDEX + 1;

// 응답 코드의 기존 자리는 고정하고, 화면에 보여주는 순서만 별도로 고른다.
export const V31_ALL_STEP_IDS: readonly V31StepId[] = Object.freeze([
  ...WEDDING_CODE_V31_QUESTIONS.map(question => question.id),
  ...WEDDING_CODE_V31_TASTES.map(taste => `taste.${taste.key}` as const),
  "avoidances", "priorities", "spending",
]);
export const V31_CORE_INDEXES: readonly number[] = Object.freeze([
  ...V31_CORE_RATING_IDS.map(id => V31_ALL_STEP_IDS.indexOf(id)),
  ...WEDDING_CODE_V31_TASTES.map((_, index) => WEDDING_CODE_V31_QUESTIONS.length + index),
  V31_AVOIDANCE_INDEX, V31_SPENDING_INDEX,
]);
// 우선순위는 선택 흐름에서 빼고 기본 흐름 끝에서 한 번만 묻는다.
export const V31_EXTRA_INDEXES: readonly number[] = Object.freeze(V31_EXTRA_RATING_IDS.map(id => V31_ALL_STEP_IDS.indexOf(id)));
export const V31_LEGACY_ONLY_INDEXES: readonly number[] = Object.freeze(V31_LEGACY_ONLY_RATING_IDS.map(id => V31_ALL_STEP_IDS.indexOf(id)));
export const V31_FULL_INDEXES: readonly number[] = Object.freeze(V31_ALL_STEP_IDS.map((_, index) => index));
/**
 * 기본 흐름의 화면 순서. 완료 판정(isV31CoreComplete, 서버 함께 보기 계약)은 V31_CORE_INDEXES 23개만 보고,
 * 화면은 그 뒤에 우선순위를 한 번 더 묻는다. 우선순위는 건너뛰어도 결과를 볼 수 있다.
 */
export const V31_CORE_SCREEN_INDEXES: readonly number[] = Object.freeze([...V31_CORE_INDEXES, V31_PRIORITY_INDEX]);

export function isV31Flow(value: unknown): value is V31Flow {
  return value === "core" || value === "extra" || value === "full";
}
/** 결과를 보기 위해 답이 있어야 하는 자리. 화면 이동 순서는 getV31ScreenIndexes를 쓴다. */
export function getV31FlowIndexes(flow: V31Flow): readonly number[] {
  return flow === "core" ? V31_CORE_INDEXES : flow === "extra" ? V31_EXTRA_INDEXES : V31_FULL_INDEXES;
}
/** 화면에 보여주는 순서. 기본 흐름만 끝에 우선순위가 붙는다. */
export function getV31ScreenIndexes(flow: V31Flow): readonly number[] {
  return flow === "core" ? V31_CORE_SCREEN_INDEXES : getV31FlowIndexes(flow);
}
export function getV31IndexForId(id: string): number {
  return V31_ALL_STEP_IDS.findIndex(step => step === id);
}
export function getV31ResponseAt(draft: V31Draft, index: number): V31Response | V31Choice | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= V31_ALL_STEP_IDS.length) return undefined;
  const question = WEDDING_CODE_V31_QUESTIONS[index];
  if (question) return draft.answers[question.id];
  const taste = WEDDING_CODE_V31_TASTES[index - WEDDING_CODE_V31_QUESTIONS.length];
  if (taste) return draft.tastes[taste.key];
  return index === V31_AVOIDANCE_INDEX ? draft.avoidances : index === V31_PRIORITY_INDEX ? draft.priorities : draft.spending;
}
export function getV31MissingIndex(draft: V31Draft, flow: V31Flow): number | null {
  return getV31FlowIndexes(flow).find(index => getV31ResponseAt(draft, index) === undefined) ?? null;
}
export function isV31CoreComplete(draft: V31Draft): boolean {
  return getV31MissingIndex(draft, "core") === null;
}
export function isV31FullComplete(draft: V31Draft): boolean {
  return getV31MissingIndex(draft, "full") === null;
}
export function getV31NextIndex(flow: V31Flow, index: number): number | null {
  const steps = getV31ScreenIndexes(flow);
  const position = steps.indexOf(index);
  return position < 0 ? null : steps[position + 1] ?? null;
}
export function getV31PreviousIndex(flow: V31Flow, index: number): number | null {
  const steps = getV31ScreenIndexes(flow);
  const position = steps.indexOf(index);
  return position <= 0 ? null : steps[position - 1];
}
