// 타입 검사(`tsc --noEmit`)로만 도는 확인이다. 실행 코드는 없다.
//
// 도움 방식 값이 넓은 `string` 으로 풀려도 웹 타입 검사는 조용히 통과한다 — 2026-09-18 에
// `.d.mts` 의 필드 타입을 일부러 `string` 으로 넓혀 웹 `tsc` 를 돌려 봤더니 0 오류였다
// (`prompts.ts` 의 `{ ... }[helpPreference.decisionStart]` 는 객체 리터럴을 바로 인덱싱해서
// string 키도 받아 준다). 그래서 리터럴 유니온과 readonly 튜플을 여기서 직접 붙잡는다.
import type {
  AMORA_ANSWER_DETAIL_VALUES,
  AMORA_DECISION_START_VALUES,
  AMORA_FAMILY_ORDER_VALUES,
  AMORA_PERSONALIZATION_FIELD_NAMES,
  AMORA_SUPPORT_ORDER_VALUES,
  AMORA_TONE_STYLE_VALUES,
  AMORA_WORK_MODE_VALUES,
  AmoraAnswerDetail,
  AmoraDecisionStart,
  AmoraFamilyOrder,
  AmoraPersonalizationFieldName,
  AmoraSupportOrder,
  AmoraToneStyle,
  AmoraWorkMode,
} from "../amoraPersonalization.mjs";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type AmoraPersonalizationTypeChecks = [
  Expect<Equal<AmoraDecisionStart, "recommend_first" | "compare_first" | "ask_each_time">>,
  Expect<Equal<AmoraAnswerDetail, "brief" | "detailed" | "adaptive">>,
  Expect<Equal<AmoraSupportOrder, "listen_first" | "action_first" | "ask_each_time">>,
  Expect<Equal<AmoraWorkMode, "together" | "owner_led" | "hybrid" | "ask_each_time">>,
  Expect<Equal<AmoraFamilyOrder, "couple_first" | "family_input_first" | "case_by_case" | "ask_each_time">>,
  Expect<Equal<AmoraToneStyle, "adaptive" | "warm" | "calm_clear" | "friendly_honest">>,
  Expect<Equal<typeof AMORA_DECISION_START_VALUES, readonly ["recommend_first", "compare_first", "ask_each_time"]>>,
  Expect<Equal<typeof AMORA_ANSWER_DETAIL_VALUES, readonly ["brief", "detailed", "adaptive"]>>,
  Expect<Equal<typeof AMORA_SUPPORT_ORDER_VALUES, readonly ["listen_first", "action_first", "ask_each_time"]>>,
  Expect<Equal<typeof AMORA_WORK_MODE_VALUES, readonly ["together", "owner_led", "hybrid", "ask_each_time"]>>,
  Expect<Equal<typeof AMORA_FAMILY_ORDER_VALUES, readonly ["couple_first", "family_input_first", "case_by_case", "ask_each_time"]>>,
  Expect<Equal<typeof AMORA_TONE_STYLE_VALUES, readonly ["adaptive", "warm", "calm_clear", "friendly_honest"]>>,
  Expect<Equal<(typeof AMORA_PERSONALIZATION_FIELD_NAMES)[number], AmoraPersonalizationFieldName>>,
];
