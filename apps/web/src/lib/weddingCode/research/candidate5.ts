/**
 * WeddingCode Candidate 5 research-only schema.
 *
 * This module is deliberately disconnected from public routes, APIs, DB writes,
 * Candidate 4 scoring/reporting, and browser storage. It may only support a
 * zero-network static prototype and automated contract checks until every human
 * gate in docs/wedding-code/56_candidate5_research_spec_2026-07-17.md passes.
 */

export const CANDIDATE5_RESEARCH_EXACT_VERSION = "wedding-code-candidate5-research.2" as const;
export const CANDIDATE5_RESEARCH_CONSENT_VERSION = "unapproved-draft" as const;

export const CANDIDATE5_AXES = ["DI", "PI", "CI", "SO"] as const;
export type Candidate5Axis = (typeof CANDIDATE5_AXES)[number];

export const CANDIDATE5_DIRECTIONS = [-2, -1, 1, 2] as const;
export type Candidate5Direction = (typeof CANDIDATE5_DIRECTIONS)[number];

export type Candidate5Form = "A" | "B";
export type Candidate5ScenarioEvidenceGrade = "S0" | "S1" | "S2";
export type Candidate5MeasurementEvidenceGrade = "M0";
export type Candidate5EvidenceSource =
  | "E-MARKET"
  | "E-DECISION"
  | "E-COLLAB"
  | "E-SUPPORT"
  | "E-STAKEHOLDER"
  | "E-PRODUCT";

export type Candidate5ResearchOption = Readonly<{
  direction: Candidate5Direction;
  text: string;
}>;

export type Candidate5ResearchItem = Readonly<{
  id: string;
  axis: Candidate5Axis;
  applicability: "universal" | "conditional-stakeholder";
  prompt: string;
  options: readonly Candidate5ResearchOption[];
  evidence: Readonly<{
    scenarioGrade: Candidate5ScenarioEvidenceGrade;
    measurementGrade: Candidate5MeasurementEvidenceGrade;
    sources: readonly Candidate5EvidenceSource[];
  }>;
}>;

export const CANDIDATE5_RESEARCH_ITEMS = [
  {
    id: "C5-DI1",
    axis: "DI",
    applicability: "universal",
    prompt:
      "축하할 장소나 진행 방식을 두 가지로 좁혔어요. 조건과 원하는 장면을 어떤 순서로 살피면 편한가요?",
    options: [
      { direction: -2, text: "이동·비용·진행 조건을 정리한 다음 원하는 장면을 살핀다." },
      { direction: -1, text: "조건을 먼저 살피고, 곧바로 원하는 장면과 함께 비교한다." },
      { direction: 1, text: "원하는 장면을 먼저 살피고, 곧바로 조건과 함께 비교한다." },
      { direction: 2, text: "원하는 장면을 정리한 다음 이동·비용·진행 조건을 살핀다." },
    ],
    evidence: { scenarioGrade: "S2", measurementGrade: "M0", sources: ["E-MARKET", "E-DECISION"] },
  },
  {
    id: "C5-DI2",
    axis: "DI",
    applicability: "universal",
    prompt: "사진, 영상, 글처럼 그날을 남길 방법을 하나 고른다면 어떤 순서로 살피면 편한가요?",
    options: [
      { direction: -2, text: "사용·보관 방식을 정리한 다음 남기고 싶은 기억을 살핀다." },
      {
        direction: -1,
        text: "사용·보관 방식을 먼저 살피고, 곧바로 남기고 싶은 기억과 함께 비교한다.",
      },
      {
        direction: 1,
        text: "남기고 싶은 기억을 먼저 살피고, 곧바로 사용·보관 방식과 함께 비교한다.",
      },
      { direction: 2, text: "남기고 싶은 기억을 정리한 다음 사용·보관 방식을 살핀다." },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-DECISION", "E-PRODUCT"] },
  },
  {
    id: "C5-DI3",
    axis: "DI",
    applicability: "universal",
    prompt: "장소나 준비를 도와줄 두 후보가 모두 기본 조건에 맞아요. 어떤 순서로 비교하면 편한가요?",
    options: [
      { direction: -2, text: "일정·소통·진행 방식을 정리한 다음 결과의 느낌을 살핀다." },
      { direction: -1, text: "진행 방식을 먼저 살피고, 곧바로 결과의 느낌과 함께 비교한다." },
      { direction: 1, text: "결과의 느낌을 먼저 살피고, 곧바로 진행 방식과 함께 비교한다." },
      { direction: 2, text: "결과의 느낌을 정리한 다음 일정·소통·진행 방식을 살핀다." },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-MARKET", "E-DECISION"] },
  },
  {
    id: "C5-DI4",
    axis: "DI",
    applicability: "universal",
    prompt:
      "필수 준비를 빼고 둘이 쓸 수 있는 시간이나 예산이 조금 남았어요. 보탤 곳을 어떤 순서로 살피면 편한가요?",
    options: [
      { direction: -2, text: "필요한 시간·비용·활용 방법을 정리한 다음 원하는 경험을 살핀다." },
      {
        direction: -1,
        text: "시간·비용·활용 방법을 먼저 살피고, 곧바로 원하는 경험과 함께 비교한다.",
      },
      {
        direction: 1,
        text: "원하는 경험을 먼저 살피고, 곧바로 시간·비용·활용 방법과 함께 비교한다.",
      },
      { direction: 2, text: "원하는 경험을 정리한 다음 필요한 시간·비용·활용 방법을 살핀다." },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-DECISION", "E-PRODUCT"] },
  },
  {
    id: "C5-PI1",
    axis: "PI",
    applicability: "universal",
    prompt: "업체나 장소 후보를 처음 찾을 때 어떤 방식이 더 편한가요?",
    options: [
      { direction: -2, text: "후보를 찾는 단계와 줄이는 단계를 둘이 함께 한다." },
      { direction: -1, text: "각자 후보를 찾고, 줄이는 단계는 둘이 함께 한다." },
      { direction: 1, text: "한 사람이 후보를 찾고 줄인 뒤, 마지막 비교는 둘이 함께 한다." },
      {
        direction: 2,
        text: "한 사람이 후보 찾기와 비교 정리를 맡고, 둘이 최종 선택을 확인한다.",
      },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-COLLAB", "E-PRODUCT"] },
  },
  {
    id: "C5-PI2",
    axis: "PI",
    applicability: "universal",
    prompt: "가격, 일정, 사진처럼 볼 정보가 많아요. 어떻게 나누면 편한가요?",
    options: [
      { direction: -2, text: "같은 정보를 둘이 함께 보며 정리한다." },
      { direction: -1, text: "각자 같은 정보를 살핀 뒤, 중요한 부분은 둘이 함께 비교한다." },
      { direction: 1, text: "정보를 나눠 살핀 뒤, 각자 요약을 공유하고 둘이 함께 비교한다." },
      { direction: 2, text: "정보를 나눠 맡고, 약속한 때 각자 정리한 결과를 합친다." },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-COLLAB", "E-PRODUCT"] },
  },
  {
    id: "C5-PI3",
    axis: "PI",
    applicability: "universal",
    prompt: "한 사람이 괜찮은 장소나 도움 후보를 먼저 찾았어요. 다음 과정은 어떻게 하면 편한가요?",
    options: [
      { direction: -2, text: "둘이 처음 자료부터 함께 보며 후보를 판단한다." },
      { direction: -1, text: "찾은 자료를 공유하고 중요한 점을 둘이 함께 정리한다." },
      { direction: 1, text: "찾은 사람이 요약하고, 상대와 확인할 질문을 함께 정리한다." },
      { direction: 2, text: "찾은 사람이 후보와 이유를 정리하고, 둘이 최종 선택을 확인한다." },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-COLLAB"] },
  },
  {
    id: "C5-PI4",
    axis: "PI",
    applicability: "universal",
    prompt: "작은 준비 일이 한꺼번에 많아졌어요. 어떤 방식으로 처리하면 편한가요?",
    options: [
      { direction: -2, text: "같은 목록을 보며 둘이 함께 처리한다." },
      { direction: -1, text: "담당을 나누고 각 항목을 마칠 때 서로 확인한다." },
      { direction: 1, text: "담당을 나누고 정해 둔 중간 점검 때 서로 확인한다." },
      { direction: 2, text: "담당을 나누고 약속한 마감 때 각자 결과를 합친다." },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-COLLAB", "E-PRODUCT"] },
  },
  {
    id: "C5-CI1",
    axis: "CI",
    applicability: "conditional-stakeholder",
    prompt:
      "결혼을 알리거나 축하하는 방식의 첫 초안을 만들 때, 두 종류의 의견을 어떤 순서로 모으면 편한가요?",
    options: [
      {
        direction: -2,
        text: "둘의 생각을 초안으로 정리한 다음 의견을 받기로 한 사람들의 생각을 모은다.",
      },
      { direction: -1, text: "둘의 생각을 먼저 적고, 곧바로 다른 의견과 함께 정리한다." },
      {
        direction: 1,
        text: "의견을 받기로 한 사람들의 생각을 먼저 적고, 곧바로 둘의 생각과 함께 정리한다.",
      },
      { direction: 2, text: "다른 의견을 초안으로 정리한 다음 둘의 생각을 모은다." },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-STAKEHOLDER", "E-PRODUCT"] },
  },
  {
    id: "C5-CI2",
    axis: "CI",
    applicability: "conditional-stakeholder",
    prompt:
      "모임·식사·온라인 축하처럼 모두 가능한 방식이 두 개예요. 경험에 관한 의견을 어떤 순서로 모으면 편한가요?",
    options: [
      { direction: -2, text: "둘이 선호하는 경험을 정리한 다음 함께할 사람들의 선호를 모은다." },
      {
        direction: -1,
        text: "둘의 선호를 먼저 적고, 곧바로 함께할 사람들의 선호와 같이 정리한다.",
      },
      {
        direction: 1,
        text: "함께할 사람들의 선호를 먼저 적고, 곧바로 둘의 선호와 같이 정리한다.",
      },
      { direction: 2, text: "함께할 사람들의 선호를 정리한 다음 둘이 선호하는 경험을 모은다." },
    ],
    evidence: { scenarioGrade: "S0", measurementGrade: "M0", sources: ["E-STAKEHOLDER", "E-PRODUCT"] },
  },
  {
    id: "C5-CI3",
    axis: "CI",
    applicability: "conditional-stakeholder",
    prompt:
      "행사, 식사, 온라인 인사 중 어떤 방식을 택했든 진행 순서를 만들 때 의견을 어떻게 모으면 편한가요?",
    options: [
      { direction: -2, text: "둘의 진행 순서를 초안으로 만든 다음 다른 제안을 모은다." },
      { direction: -1, text: "둘의 진행 순서를 먼저 적고, 곧바로 다른 제안과 함께 정리한다." },
      {
        direction: 1,
        text: "의견을 받기로 한 사람들의 제안을 먼저 적고, 곧바로 둘의 진행 순서와 함께 정리한다.",
      },
      { direction: 2, text: "다른 제안을 초안으로 정리한 다음 둘의 진행 순서를 모은다." },
    ],
    evidence: { scenarioGrade: "S0", measurementGrade: "M0", sources: ["E-STAKEHOLDER", "E-PRODUCT"] },
  },
  {
    id: "C5-CI4",
    axis: "CI",
    applicability: "conditional-stakeholder",
    prompt:
      "참여 가능성과 접근성 조건을 충족한 시간대가 여러 개예요. 선호를 어떤 순서로 모으면 편한가요?",
    options: [
      { direction: -2, text: "둘의 선호 시간대를 정리한 다음 함께할 사람들의 선호를 모은다." },
      {
        direction: -1,
        text: "둘의 선호를 먼저 적고, 곧바로 함께할 사람들의 선호와 같이 정리한다.",
      },
      {
        direction: 1,
        text: "함께할 사람들의 선호를 먼저 적고, 곧바로 둘의 선호와 같이 정리한다.",
      },
      { direction: 2, text: "함께할 사람들의 선호 시간대를 정리한 다음 둘의 선호를 모은다." },
    ],
    evidence: { scenarioGrade: "S0", measurementGrade: "M0", sources: ["E-STAKEHOLDER", "E-PRODUCT"] },
  },
  {
    id: "C5-SO1",
    axis: "SO",
    applicability: "universal",
    prompt: "기대했던 선택지와 달라 속상해요. 상대와 어떤 순서로 이야기하면 편한가요?",
    options: [
      { direction: -2, text: "속상한 마음을 이야기한 다음 다음 행동을 정한다." },
      { direction: -1, text: "속상한 마음을 먼저 확인하고, 곧바로 다음 행동도 함께 정한다." },
      { direction: 1, text: "다음 행동을 먼저 정하고, 곧바로 속상한 마음도 함께 확인한다." },
      { direction: 2, text: "다음 행동을 정리한 다음 속상한 마음을 이야기한다." },
    ],
    evidence: { scenarioGrade: "S2", measurementGrade: "M0", sources: ["E-SUPPORT", "E-PRODUCT"] },
  },
  {
    id: "C5-SO2",
    axis: "SO",
    applicability: "universal",
    prompt: "둘 다 준비 이야기에 지쳤어요. 대화를 다시 시작하는 순서는?",
    options: [
      { direction: -2, text: "무엇이 지쳤는지 이야기한 다음 다음 할 일 하나를 정한다." },
      { direction: -1, text: "지친 마음을 먼저 확인하고, 곧바로 다음 할 일도 함께 정한다." },
      { direction: 1, text: "다음 할 일 하나를 먼저 정하고, 곧바로 지친 마음도 함께 확인한다." },
      { direction: 2, text: "다음 할 일을 정리한 다음 무엇이 지쳤는지 이야기한다." },
    ],
    evidence: { scenarioGrade: "S2", measurementGrade: "M0", sources: ["E-SUPPORT"] },
  },
  {
    id: "C5-SO3",
    axis: "SO",
    applicability: "universal",
    prompt: "둘의 준비 계획이 예상보다 늦어져 둘 다 당황했어요. 어떤 순서의 대화가 편한가요?",
    options: [
      { direction: -2, text: "서로의 당황한 마음을 이야기한 다음 회복 계획을 정한다." },
      { direction: -1, text: "당황한 마음을 먼저 확인하고, 곧바로 회복 계획도 함께 정한다." },
      { direction: 1, text: "회복 계획을 먼저 정하고, 곧바로 당황한 마음도 함께 확인한다." },
      { direction: 2, text: "회복 계획을 정리한 다음 서로의 당황한 마음을 이야기한다." },
    ],
    evidence: { scenarioGrade: "S1", measurementGrade: "M0", sources: ["E-SUPPORT", "E-PRODUCT"] },
  },
  {
    id: "C5-SO4",
    axis: "SO",
    applicability: "universal",
    prompt: "해야 할 일이 많아 막막해졌어요. 상대가 어떤 순서로 도와주면 편한가요?",
    options: [
      { direction: -2, text: "막막한 마음을 이야기한 다음 할 일 하나를 정한다." },
      { direction: -1, text: "막막한 마음을 먼저 확인하고, 곧바로 할 일 하나도 함께 정한다." },
      { direction: 1, text: "할 일 하나를 먼저 정하고, 곧바로 막막한 마음도 함께 확인한다." },
      { direction: 2, text: "할 일 하나를 정리한 다음 막막한 마음을 이야기한다." },
    ],
    evidence: { scenarioGrade: "S2", measurementGrade: "M0", sources: ["E-SUPPORT", "E-PRODUCT"] },
  },
] as const satisfies readonly Candidate5ResearchItem[];

export type Candidate5ItemId = (typeof CANDIDATE5_RESEARCH_ITEMS)[number]["id"];

export type Candidate5DisplayResponse =
  | Readonly<{ kind: "direction"; displayIndex: 0 | 1 | 2 | 3 }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "skipped" }>;

export type Candidate5NormalizedResponse =
  | Readonly<{ kind: "direction"; direction: Candidate5Direction }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "skipped" }>;

export type Candidate5CiApplicability = "applicable" | "not_applicable" | "unanswered";

export type Candidate5ResearchSubmission = Readonly<{
  exactVersion: typeof CANDIDATE5_RESEARCH_EXACT_VERSION;
  consentVersion: string;
  form: Candidate5Form;
  randomResearchId: string;
  ciApplicability: Candidate5CiApplicability;
  responses: Partial<Record<Candidate5ItemId, Candidate5NormalizedResponse>>;
}>;

function getItem(itemId: Candidate5ItemId) {
  const item = CANDIDATE5_RESEARCH_ITEMS.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error(`Unknown Candidate 5 item: ${itemId}`);
  }
  return item;
}

function rotateDirections(offset: number): Candidate5Direction[] {
  return CANDIDATE5_DIRECTIONS.map(
    (_, index) => CANDIDATE5_DIRECTIONS[(index + offset) % CANDIDATE5_DIRECTIONS.length]
  );
}

/**
 * Within every axis and form, each canonical direction appears once in every
 * visual position. Form B reverses the same item's Form A order.
 */
export function getCandidate5DirectionOrder(
  form: Candidate5Form,
  itemId: Candidate5ItemId
): readonly Candidate5Direction[] {
  const item = getItem(itemId);
  const axisItems = CANDIDATE5_RESEARCH_ITEMS.filter((candidate) => candidate.axis === item.axis);
  const ordinal = axisItems.findIndex((candidate) => candidate.id === itemId);
  const formAOrder = rotateDirections(ordinal);
  return form === "A" ? formAOrder : [...formAOrder].reverse();
}

export function getCandidate5PresentedOptions(form: Candidate5Form, itemId: Candidate5ItemId) {
  const item = getItem(itemId);
  const byDirection = new Map(item.options.map((option) => [option.direction, option]));
  return getCandidate5DirectionOrder(form, itemId).map((direction) => {
    const option = byDirection.get(direction);
    if (!option) {
      throw new Error(`Candidate 5 item ${itemId} is missing direction ${direction}`);
    }
    return option;
  });
}

export function normalizeCandidate5Response(
  form: Candidate5Form,
  itemId: Candidate5ItemId,
  response: Candidate5DisplayResponse
): Candidate5NormalizedResponse {
  if (response.kind !== "direction") {
    return response;
  }

  return {
    kind: "direction",
    direction: getCandidate5DirectionOrder(form, itemId)[response.displayIndex],
  };
}

export function assignCandidate5Form(randomResearchId: string): Candidate5Form {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(randomResearchId)) {
    throw new Error("Candidate 5 form assignment requires an opaque random research ID");
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < randomResearchId.length; index += 1) {
    hash ^= randomResearchId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 2 === 0 ? "A" : "B";
}

export function isCandidate5AxisAnalyzable(
  responses: Candidate5ResearchSubmission["responses"],
  axis: Candidate5Axis,
  ciApplicability: Candidate5CiApplicability
): boolean {
  if (axis === "CI" && ciApplicability !== "applicable") return false;
  const validDirections = CANDIDATE5_RESEARCH_ITEMS.filter((item) => item.axis === axis).filter(
    (item) => responses[item.id]?.kind === "direction"
  ).length;
  return validDirections >= 3;
}

export const CANDIDATE5_NEUTRAL_TOPICS = [
  {
    id: "compare-first",
    prompt: "다음 결정을 볼 때 무엇부터 확인하면 둘 다 편할까요?",
  },
  {
    id: "split-one-task",
    prompt: "이번 주 일 하나를 같이 볼 부분과 맡을 부분으로 어떻게 나눌까요?",
  },
  {
    id: "restart-talk",
    prompt: "준비 대화를 다시 열 때 마음 확인과 할 일 중 무엇부터 시작할까요?",
  },
] as const;

export type Candidate5NeutralTopicId = (typeof CANDIDATE5_NEUTRAL_TOPICS)[number]["id"];

export type Candidate5CoupleShareState =
  | "topic-required"
  | "sender-consent-required"
  | "recipient-consent-pending"
  | "ready-neutral-topic-only"
  | "closed-version-mismatch"
  | "closed-revoked"
  | "closed-deleted"
  | "closed-expired";

export type Candidate5CoupleShareInput = Readonly<{
  selectedTopicId: Candidate5NeutralTopicId | null;
  senderConsent: boolean;
  recipientConsent: boolean;
  senderVersion: string;
  recipientVersion: string | null;
  revoked: boolean;
  deleted: boolean;
  expired: boolean;
}>;

/**
 * This policy has no answer, direction, score, axis, money, family, or vendor
 * input by design. A topic is never inferred from research responses.
 */
export function resolveCandidate5CoupleShareState(
  input: Candidate5CoupleShareInput
): Candidate5CoupleShareState {
  if (input.deleted) return "closed-deleted";
  if (input.revoked) return "closed-revoked";
  if (input.expired) return "closed-expired";
  if (
    input.senderVersion !== CANDIDATE5_RESEARCH_EXACT_VERSION ||
    (input.recipientVersion !== null && input.recipientVersion !== input.senderVersion)
  ) {
    return "closed-version-mismatch";
  }
  if (!input.selectedTopicId) return "topic-required";
  if (!input.senderConsent) return "sender-consent-required";
  if (!input.recipientConsent || input.recipientVersion === null) return "recipient-consent-pending";
  return "ready-neutral-topic-only";
}

export const CANDIDATE5_DELETION_CONTRACT = {
  tokenEntropyBits: 256,
  rawTokenServerStorageAllowed: false,
  rawTokenBrowserStorageAllowed: false,
  storedVerifier: "server-secret-keyed-hmac",
  tombstoneContainsAnswers: false,
  restoreRequiresTombstoneReplayBeforeNetwork: true,
} as const;
