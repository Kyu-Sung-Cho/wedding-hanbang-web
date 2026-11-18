import type { JourneyModel, JourneyRow } from "./types";

/**
 * 준비 순서 아홉 단계와 넣을 수 있는 두 갈래. 아티팩트 `Journey.dc.html` 의 순서와 문구 그대로다.
 *
 * 단계의 상태는 저장된 사실로만 정한다.
 *   - 조건 알려주기: 희망 달·지역·하객 수가 모두 있으면 끝.
 *   - 파트너와 함께하기: 상대가 합류했으면 끝.
 *   - 그 뒤 단계는 앞 단계가 끝나야 "지금"이 된다. 뺀 단계는 건너뛴다.
 * "파트너"는 이 제품에서 배우자 될 사람을 뜻한다(제품 계약).
 */

export type JourneyStageKey =
  | "conditions"
  | "partner"
  | "venue"
  | "families"
  | "styling"
  | "guests"
  | "ceremony"
  | "honeymoon"
  | "after";

export type JourneyAddOnKey = "rings" | "home";

export const JOURNEY_STAGES: readonly { key: JourneyStageKey; title: string; hint: string; optional: boolean }[] = [
  // 앞의 세 단계 설명은 아티팩트에 없다(예시 커플은 이미 끝낸 단계라 결과만 보인다).
  // 아직 끝내지 않은 커플에게 보일 문장이라 아티팩트의 다른 설명과 같은 말투로 새로 썼다.
  { key: "conditions", title: "조건 알려주기", hint: "시기와 지역, 하객 수를 알려 주세요", optional: false },
  { key: "partner", title: "파트너와 함께하기", hint: "초대 코드로 함께 준비할 수 있어요", optional: false },
  { key: "venue", title: "웨딩홀 상담과 계약", hint: "조건에 맞는 홀부터 비교해요", optional: false },
  { key: "families", title: "첫인사와 상견례", hint: "홀과 같이 진행해도 돼요", optional: true },
  { key: "styling", title: "촬영, 드레스, 메이크업", hint: "홀이 정해지면 일정을 맞춰요", optional: false },
  { key: "guests", title: "하객과 청첩장", hint: "보증 인원 마감과 이어져요", optional: false },
  { key: "ceremony", title: "본식 준비", hint: "예식일을 기준으로 잡아요", optional: false },
  { key: "honeymoon", title: "신혼여행", hint: "본식과 따로 준비해도 돼요", optional: true },
  { key: "after", title: "예식 이후", hint: "잔금과 사진 수령까지", optional: false },
];

export const JOURNEY_ADD_ONS: readonly { key: JourneyAddOnKey; title: string; button: string }[] = [
  { key: "rings", title: "반지와 예물", button: "반지와 예물 넣기" },
  { key: "home", title: "신혼집 준비", button: "신혼집 준비 넣기" },
];

/** 커플이 저장한 계획. `wedding_journeys.progress.__journeyPlan` 에 둔다. */
export type JourneyPlan = {
  off: readonly JourneyStageKey[];
  addOns: readonly JourneyAddOnKey[];
};

export const EMPTY_JOURNEY_PLAN: JourneyPlan = { off: [], addOns: [] };

export type JourneyFacts = {
  /** 조건 칸의 요약("2027년 5월, 서울, 200명"). 조건이 모자라면 null. */
  conditionsSummary: string | null;
  /** 합류한 상대 이름. 아직 혼자면 null. */
  partnerName: string | null;
  /** 웨딩홀 단계의 지금 모습(예: "지금 하고 있어요. 후보 3곳"). 홀을 정했으면 그 이름. */
  venueSummary: string | null;
  venueChosen: boolean;
};

function stageDone(key: JourneyStageKey, facts: JourneyFacts): boolean {
  if (key === "conditions") return facts.conditionsSummary !== null;
  if (key === "partner") return facts.partnerName !== null;
  if (key === "venue") return facts.venueChosen;
  return false;
}

function stageSub(key: JourneyStageKey, hint: string, facts: JourneyFacts, isNow: boolean): string {
  if (key === "conditions" && facts.conditionsSummary) return facts.conditionsSummary;
  if (key === "partner" && facts.partnerName) return `${facts.partnerName} 님이 합류했어요`;
  if (key === "venue" && (facts.venueChosen || isNow) && facts.venueSummary) return facts.venueSummary;
  return hint;
}

export function buildJourneyModel(facts: JourneyFacts, plan: JourneyPlan = EMPTY_JOURNEY_PLAN): JourneyModel {
  const off = new Set(plan.off);
  let nowAssigned = false;
  const rows: JourneyRow[] = JOURNEY_STAGES.map((stage, index) => {
    const isOff = stage.optional && off.has(stage.key);
    const done = !isOff && stageDone(stage.key, facts);
    let state: JourneyRow["state"] = done ? "done" : "next";
    if (!done && !isOff && !nowAssigned) {
      state = "now";
      nowAssigned = true;
    }
    return {
      key: stage.key,
      number: String(index + 1).padStart(2, "0"),
      title: stage.title,
      sub: stageSub(stage.key, stage.hint, facts, state === "now"),
      state,
      optional: stage.optional,
      off: isOff,
    };
  });
  const added = new Set(plan.addOns);
  return {
    rows,
    addOns: JOURNEY_ADD_ONS.map((addOn) => ({ key: addOn.key, button: addOn.button, added: added.has(addOn.key) })),
  };
}

export function isJourneyStageKey(value: unknown): value is JourneyStageKey {
  return typeof value === "string" && JOURNEY_STAGES.some((stage) => stage.key === value);
}

export function isJourneyAddOnKey(value: unknown): value is JourneyAddOnKey {
  return typeof value === "string" && JOURNEY_ADD_ONS.some((addOn) => addOn.key === value);
}

/** 저장된 값을 경계에서 검사한다. 모르는 값은 버리고, 뺄 수 없는 단계는 빼지 않는다. */
export function parseJourneyPlan(value: unknown): JourneyPlan {
  if (typeof value !== "object" || value === null) return EMPTY_JOURNEY_PLAN;
  const record = value as { off?: unknown; addOns?: unknown };
  const optionalKeys = new Set(JOURNEY_STAGES.filter((stage) => stage.optional).map((stage) => stage.key));
  const off = Array.isArray(record.off)
    ? Array.from(new Set(record.off.filter(isJourneyStageKey).filter((key) => optionalKeys.has(key))))
    : [];
  const addOns = Array.isArray(record.addOns) ? Array.from(new Set(record.addOns.filter(isJourneyAddOnKey))) : [];
  return { off, addOns };
}
