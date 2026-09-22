import {
  WEDDING_CODE_V30_OPTIONS,
  WEDDING_CODE_V30_QUESTIONS,
  WEDDING_CODE_V30_SPENDING,
  WEDDING_CODE_V30_TASTES,
  WEDDING_CODE_V30_TOPICS,
  WEDDING_CODE_V30_VERSION,
  type V30Choice,
  type V30Draft,
  type V30Option,
  type V30Question,
  type V30QuestionId,
  type V30Rating,
  type V30Response,
  type V30TasteKey,
  type V30Topic,
} from "@/constants/weddingCodeV30";

export type V30Evidence = { id: string; text: string; answer: string };
export type V30Insight = { id: string; title: string; body: string; evidence: V30Evidence[]; nextStep: string };
export type V30Profile = {
  ratedCount: number;
  respondedCount: number;
  hasContent: boolean;
  priorityLabels: string[];
  spendingLabels: string[];
  insights: V30Insight[];
  tastes: { key: V30TasteKey; title: string; labels: string[] }[];
  topics: { key: V30Topic; title: string; responses: V30Evidence[] }[];
  unresolved: V30Evidence[];
};
export type V30PairItem = {
  id: string;
  title: string;
  first: string;
  second: string;
  kind: "shared_wish" | "shared_distance" | "middle" | "different" | "unavailable";
  followUp: string;
  isPriority: boolean;
};

const STATUS_LABELS = {
  undecided: "아직 모르겠어요",
  not_applicable: "이번 계획에는 없어요",
  skipped: "지금 답하지 않을게요",
  no_preference: "어느 쪽도 괜찮아요",
  no_match: "맞는 보기가 없어요",
} as const;
const QUESTION_IDS = WEDDING_CODE_V30_QUESTIONS.map((question) => question.id);
const TASTE_KEYS = WEDDING_CODE_V30_TASTES.map((taste) => taste.key);
const PRIORITY_IDS = [...QUESTION_IDS, ...TASTE_KEYS.map((key) => `taste.${key}`)];
const MAX_CODE_LENGTH = 256;
const CHOICE_STATUS_CODES = { undecided: "u", not_applicable: "n", skipped: "s", no_preference: "p", no_match: "m" } as const;

function isRating(value: unknown): value is V30Rating {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}
function isResponse(value: unknown): value is V30Response {
  return isRating(value) || value === "undecided" || value === "not_applicable" || value === "skipped";
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function validChoice(value: unknown, options: readonly V30Option[], max: number): value is V30Choice | undefined {
  if (value === undefined) return true;
  if (!isObject(value) || typeof value.status !== "string") return false;
  if (value.status !== "answered") return Object.hasOwn(CHOICE_STATUS_CODES, value.status) && onlyKeys(value, ["status"]);
  return onlyKeys(value, ["status", "values"]) && Array.isArray(value.values) && value.values.length > 0 && value.values.length <= max
    && new Set(value.values).size === value.values.length && value.values.every((item) => typeof item === "string" && options.some((option) => option.value === item));
}
function validDraft(value: unknown): value is V30Draft {
  if (!isObject(value) || !onlyKeys(value, ["version", "answers", "tastes", "priorities", "spending"]) || value.version !== WEDDING_CODE_V30_VERSION) return false;
  if (!isObject(value.answers) || !onlyKeys(value.answers, QUESTION_IDS) || !Object.values(value.answers).every(isResponse)) return false;
  if (!isObject(value.tastes) || !onlyKeys(value.tastes, TASTE_KEYS)) return false;
  if (!WEDDING_CODE_V30_TASTES.every((taste) => validChoice((value.tastes as Record<string, unknown>)[taste.key], taste.options, taste.max))) return false;
  if (!validChoice(value.spending, WEDDING_CODE_V30_SPENDING, 2)) return false;
  const candidate = value as V30Draft;
  return validChoice(value.priorities, getV30PriorityOptions(candidate), 3);
}
function cloneChoice(choice: V30Choice | undefined): V30Choice | undefined {
  return choice?.status === "answered" ? { status: "answered", values: [...choice.values] } : choice ? { ...choice } : undefined;
}

export function createV30Draft(): V30Draft {
  return { version: WEDDING_CODE_V30_VERSION, answers: {}, tastes: {} };
}
export function getV30PriorityOptions(draft: V30Draft): V30Option[] {
  return [
    ...WEDDING_CODE_V30_QUESTIONS.filter((question) => isRating(draft.answers[question.id]) && Number(draft.answers[question.id]) >= 4)
      .map((question) => ({ value: question.id, label: question.shortLabel })),
    ...WEDDING_CODE_V30_TASTES.filter((taste) => draft.tastes[taste.key]?.status === "answered")
      .map((taste) => ({ value: `taste.${taste.key}`, label: `${taste.title}: ${v30ChoiceLabels(draft.tastes[taste.key], taste.options).join(" · ")}` })),
  ];
}
export function normalizeV30Draft(draft: V30Draft): V30Draft {
  const normalized: V30Draft = { version: draft.version, answers: { ...draft.answers }, tastes: {} };
  for (const taste of WEDDING_CODE_V30_TASTES) {
    const choice = cloneChoice(draft.tastes[taste.key]);
    if (choice) normalized.tastes[taste.key] = choice;
  }
  const spending = cloneChoice(draft.spending);
  if (spending) normalized.spending = spending;
  if (draft.priorities?.status === "answered") {
    const eligible = getV30PriorityOptions(normalized).map((option) => option.value);
    const values = draft.priorities.values.filter((value) => eligible.includes(value));
    if (values.length) normalized.priorities = { status: "answered", values };
  } else if (draft.priorities) normalized.priorities = { ...draft.priorities };
  return normalized;
}
export function v30ResponseLabel(value: V30Response | undefined): string {
  if (isRating(value)) return WEDDING_CODE_V30_OPTIONS[value - 1].label;
  return value ? STATUS_LABELS[value] : "아직 보지 않은 문장이에요";
}
export function v30ChoiceLabels(choice: V30Choice | undefined, options: readonly V30Option[]): string[] {
  if (!choice) return ["아직 보지 않은 질문이에요"];
  if (choice.status === "no_preference") {
    if (options.length === WEDDING_CODE_V30_SPENDING.length && options.every((option) => WEDDING_CODE_V30_SPENDING.some((spending) => spending.value === option.value))) return ["지금은 더 쓰고 싶은 곳이 없어요"];
    if (options.every((option) => PRIORITY_IDS.includes(option.value))) return ["지금은 따로 고른 기준이 없어요"];
  }
  if (choice.status !== "answered") return [STATUS_LABELS[choice.status]];
  return choice.values.map((value) => options.find((option) => option.value === value)?.label ?? "알 수 없는 선택이에요");
}
export function hasV30Content(draft: V30Draft): boolean {
  return WEDDING_CODE_V30_QUESTIONS.some((question) => isRating(draft.answers[question.id]))
    || WEDDING_CODE_V30_TASTES.some((taste) => {
      const choice = draft.tastes[taste.key];
      return choice?.status === "no_preference" || (choice?.status === "answered" && choice.values.length > 0);
    }) || (draft.spending?.status === "answered" && draft.spending.values.length > 0);
}

function encodeChoice(choice: V30Choice | undefined, values: readonly string[]): string {
  if (!choice) return "-";
  if (choice.status !== "answered") return CHOICE_STATUS_CODES[choice.status];
  return `c${choice.values.map((value) => values.indexOf(value).toString(36).padStart(2, "0")).join("")}`;
}
function decodeChoice(code: string, values: readonly string[], max: number): V30Choice | undefined | null {
  if (code === "-") return undefined;
  for (const status of Object.keys(CHOICE_STATUS_CODES) as (keyof typeof CHOICE_STATUS_CODES)[]) {
    if (CHOICE_STATUS_CODES[status] === code) return { status };
  }
  if (!/^c(?:[0-9a-z]{2})+$/.test(code)) return null;
  const indexes = (code.slice(1).match(/.{2}/g) ?? []).map((chars) => parseInt(chars, 36));
  if (indexes.length > max || new Set(indexes).size !== indexes.length || indexes.some((index) => index >= values.length)) return null;
  return { status: "answered", values: indexes.map((index) => values[index]) };
}
/** 고정된 순서의 짧은 값만 쓰고, 메모나 임의의 문자열은 공유값에 넣지 않는다. */
export function encodeV30(draft: V30Draft): string {
  if (!validDraft(draft)) throw new Error("웨딩코드 응답 형식이 올바르지 않아요.");
  const answers = WEDDING_CODE_V30_QUESTIONS.map((question) => {
    const value = draft.answers[question.id];
    return isRating(value) ? String(value) : value ? CHOICE_STATUS_CODES[value] : "-";
  }).join("");
  const tastes = WEDDING_CODE_V30_TASTES.map((taste) => encodeChoice(draft.tastes[taste.key], taste.options.map((option) => option.value))).join(".");
  const code = ["3", answers, tastes, encodeChoice(draft.priorities, PRIORITY_IDS), encodeChoice(draft.spending, WEDDING_CODE_V30_SPENDING.map((option) => option.value))].join("_");
  if (code.length > MAX_CODE_LENGTH) throw new Error("공유할 응답이 너무 길어요.");
  return code;
}
export function decodeV30(code: string | null | undefined): V30Draft | null {
  if (typeof code !== "string" || code.length > MAX_CODE_LENGTH || !/^[0-9a-z_.-]+$/.test(code)) return null;
  const parts = code.split("_");
  if (parts.length !== 5 || parts[0] !== "3" || parts[1].length !== 32 || !/^[1-5uns-]+$/.test(parts[1])) return null;
  const tasteCodes = parts[2].split(".");
  if (tasteCodes.length !== WEDDING_CODE_V30_TASTES.length) return null;
  const draft = createV30Draft();
  const statusByChar = { u: "undecided", n: "not_applicable", s: "skipped" } as const;
  for (let index = 0; index < QUESTION_IDS.length; index++) {
    const char = parts[1][index];
    if (char === "-") continue;
    draft.answers[QUESTION_IDS[index]] = /[1-5]/.test(char) ? Number(char) as V30Rating : statusByChar[char as keyof typeof statusByChar];
  }
  for (let index = 0; index < WEDDING_CODE_V30_TASTES.length; index++) {
    const taste = WEDDING_CODE_V30_TASTES[index];
    const choice = decodeChoice(tasteCodes[index], taste.options.map((option) => option.value), taste.max);
    if (choice === null) return null;
    if (choice) draft.tastes[taste.key] = choice;
  }
  const priorities = decodeChoice(parts[3], PRIORITY_IDS, 3);
  const spending = decodeChoice(parts[4], WEDDING_CODE_V30_SPENDING.map((option) => option.value), 2);
  if (priorities === null || spending === null) return null;
  if (priorities) draft.priorities = priorities;
  if (spending) draft.spending = spending;
  return validDraft(draft) && hasV30Content(draft) ? draft : null;
}
export function buildV30ShareUrl({ origin, first, second }: { origin: string; first: V30Draft; second?: V30Draft | null }): string | null {
  if (!validDraft(first) || !hasV30Content(first) || (second != null && (!validDraft(second) || !hasV30Content(second)))) return null;
  let base: URL;
  try { base = new URL(origin); } catch { return null; }
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
  const params = new URLSearchParams({ v: WEDDING_CODE_V30_VERSION, a: encodeV30(first) });
  if (second) params.set("b", encodeV30(second));
  return `${base.origin}/wedding-code#${params.toString()}`;
}

function evidence(draft: V30Draft, id: V30QuestionId): V30Evidence {
  const question = WEDDING_CODE_V30_QUESTIONS.find((item) => item.id === id)!;
  return { id, text: question.statement, answer: v30ResponseLabel(draft.answers[id]) };
}
function tasteEvidence(draft: V30Draft, key: V30TasteKey): V30Evidence {
  const taste = WEDDING_CODE_V30_TASTES.find((item) => item.key === key)!;
  return { id: `taste.${key}`, text: taste.question, answer: v30ChoiceLabels(draft.tastes[key], taste.options).join(" · ") };
}
const COMBINATIONS: readonly { id: string; items: readonly V30QuestionId[]; title: string; body: string; nextStep: string }[] = [
  { id: "story-short", items: ["V3", "V4"], title: "짧은 예식에도 둘의 이야기는 담고 싶어요", body: "둘의 이야기는 넣고 싶고, 전체 순서는 간결했으면 해요.", nextStep: "꼭 넣고 싶은 이야기 한 가지와 빼도 되는 순서를 골라보세요." },
  { id: "photo-both", items: ["R1", "R2"], title: "사진은 두 가지 모습을 남기고 싶어요", body: "자연스러운 순간도, 미리 준비한 사진도 남기고 싶어 해요.", nextStep: "꼭 남길 장면과 자유롭게 담아주면 좋을 시간을 나눠서 요청해 보세요." },
  { id: "attire-comfort", items: ["R3", "R4"], title: "눈에 띄는 옷도 편하게 입고 싶어요", body: "평소보다 눈에 띄는 옷을 원하면서, 움직이기 편한지도 먼저 보고 싶어 해요.", nextStep: "마음에 드는 옷을 입고 앉거나 걸어보며 편한지 확인해 보세요." },
  { id: "budget-reallocate", items: ["B1", "B2"], title: "총액 안에서 원하는 곳에 더 나누고 싶어요", body: "전체 예산은 지키면서, 꼭 하고 싶은 곳에 비용을 더 나누고 싶어 해요.", nextStep: "더 쓰고 싶은 한 항목과 줄여도 되는 한 항목을 직접 정해 보세요." },
  { id: "budget-revisit", items: ["B1", "B3"], title: "예산을 다시 이야기할 경우도 정해 두면 좋겠어요", body: "정한 총액을 지키고 싶지만, 새로 원하는 것이 생기면 증액 여부도 의논하고 싶다고 답했어요.", nextStep: "어떤 경우에만 총액을 다시 의논할지 함께 정해 보세요. 증액에 동의했다는 뜻은 아니에요." },
  { id: "decision-conditions", items: ["D1", "D2"], title: "비교를 마칠 기준을 정해 보면 좋겠어요", body: "다른 후보도 보고 싶고, 정한 조건에 맞으면 선택하고 싶다고 답했어요.", nextStep: "어디까지 비교할지, 어떤 조건이면 선택할지 직접 정해 보세요." },
  { id: "delegate-update", items: ["T2", "T3"], title: "세부 선택은 맡기고, 진행 상황은 나누고 싶어요", body: "계약이나 추가 결제가 없는 세부 결정은 맡겨도 괜찮지만, 진행 상황은 함께 알고 싶어 해요.", nextStep: "중간에 알려줄 시점과 반드시 함께 결정할 범위를 나눠보세요." },
  { id: "family-listen-decide", items: ["F1", "F2"], title: "가족의 바람을 듣고, 선택은 둘이 하고 싶어요", body: "가족의 바람은 먼저 듣고, 마지막 선택은 둘이 하고 싶어 해요.", nextStep: "가족과 상의할 내용과 둘이 최종 선택할 내용을 나눠보세요." },
  { id: "support-listen-help", items: ["H1", "H2"], title: "이야기도 들어주고, 일도 나눠주길 바라요", body: "힘들 때는 이야기를 먼저 들어주고, 몰린 일도 나눠주길 바라요.", nextStep: "이야기만 들어주면 되는 때와 일을 나눠주면 좋은 때를 구분해 말해 보세요. 상대가 해줄 수 있는지도 함께 확인해 보세요." },
];

function buildInsights(draft: V30Draft): V30Insight[] {
  const high = (id: V30QuestionId) => isRating(draft.answers[id]) && Number(draft.answers[id]) >= 4;
  const insights: V30Insight[] = COMBINATIONS.filter((rule) => rule.items.every(high)).map((rule) => ({
    id: rule.id, title: rule.title, body: rule.body, nextStep: rule.nextStep, evidence: rule.items.map((id) => evidence(draft, id)),
  }));
  if (high("B1") && draft.spending?.status === "answered") {
    const labels = v30ChoiceLabels(draft.spending, WEDDING_CODE_V30_SPENDING).join(" · ");
    insights.push({
      id: "budget-explicit-spending", title: "총액을 지키며 더 배분하고 싶은 곳이 있어요",
      body: `총액은 지키되, ${labels}에 더 배분하고 싶다고 직접 골랐어요. 이 질문에서는 실제 금액을 묻지 않았어요.`,
      evidence: [evidence(draft, "B1"), { id: "spending", text: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳", answer: labels }],
      nextStep: "더 쓸 항목과 줄여도 되는 항목의 견적을 같은 총액 안에서 비교해 보세요.",
    });
  }
  const checks: { id: V30QuestionId; key: V30TasteKey; value: string }[] = [
    { id: "V2", key: "venue", value: "outdoor" }, { id: "G4", key: "meal", value: "buffet" },
    { id: "R1", key: "photo", value: "candid" }, { id: "R2", key: "photo", value: "directed" },
    { id: "V3", key: "ceremony", value: "our_story" }, { id: "V4", key: "ceremony", value: "short" },
  ];
  for (const check of checks) {
    const rating = draft.answers[check.id];
    const choice = draft.tastes[check.key];
    if (isRating(rating) && rating <= 2 && choice?.status === "answered" && choice.values.includes(check.value)) {
      insights.push({
        id: `check-${check.id}-${check.key}`, title: "이 두 답은 함께 확인해 보면 좋겠어요",
        body: "앞 문장에는 가깝지 않다고 답했고, 뒤에서는 관련 보기를 골랐어요. 서로 다른 장면을 떠올렸을 수도 있어요. 두 답을 그대로 남겨 두었어요.",
        evidence: [evidence(draft, check.id), tasteEvidence(draft, check.key)],
        nextStep: "지금 생각과 다른 답이 있으면 고쳐 주세요. 둘 다 맞는 답이라면 그대로 두어도 괜찮아요.",
      });
    }
  }
  return insights;
}
export function buildV30Profile(input: V30Draft): V30Profile {
  const draft = normalizeV30Draft(input);
  const topics = WEDDING_CODE_V30_TOPICS.map((topic) => ({ key: topic.key, title: topic.title, responses: WEDDING_CODE_V30_QUESTIONS.filter((question) => question.topic === topic.key).map((question) => evidence(draft, question.id)) }));
  const unresolved = WEDDING_CODE_V30_QUESTIONS.filter((question) => !isRating(draft.answers[question.id])).map((question) => evidence(draft, question.id));
  for (const taste of WEDDING_CODE_V30_TASTES) {
    if (draft.tastes[taste.key]?.status !== "answered" && draft.tastes[taste.key]?.status !== "no_preference") unresolved.push(tasteEvidence(draft, taste.key));
  }
  if (draft.priorities?.status !== "answered") unresolved.push({ id: "priorities", text: "이번 결혼식에서 특히 지키고 싶은 것", answer: v30ChoiceLabels(draft.priorities, getV30PriorityOptions(draft)).join(" · ") });
  if (draft.spending?.status !== "answered" && draft.spending?.status !== "no_preference") unresolved.push({ id: "spending", text: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳", answer: v30ChoiceLabels(draft.spending, WEDDING_CODE_V30_SPENDING).join(" · ") });
  return {
    ratedCount: WEDDING_CODE_V30_QUESTIONS.filter((question) => isRating(draft.answers[question.id])).length,
    respondedCount: WEDDING_CODE_V30_QUESTIONS.filter((question) => draft.answers[question.id] !== undefined).length + WEDDING_CODE_V30_TASTES.filter((taste) => draft.tastes[taste.key] !== undefined).length + Number(draft.priorities !== undefined) + Number(draft.spending !== undefined),
    hasContent: hasV30Content(draft),
    priorityLabels: draft.priorities?.status === "answered" ? v30ChoiceLabels(draft.priorities, getV30PriorityOptions(draft)) : [],
    spendingLabels: v30ChoiceLabels(draft.spending, WEDDING_CODE_V30_SPENDING),
    insights: buildInsights(draft),
    tastes: WEDDING_CODE_V30_TASTES.map((taste) => ({ key: taste.key, title: taste.title, labels: v30ChoiceLabels(draft.tastes[taste.key], taste.options) })),
    topics,
    unresolved,
  };
}

function ratingPairKind(first: V30Response | undefined, second: V30Response | undefined): V30PairItem["kind"] {
  if (!isRating(first) || !isRating(second)) return "unavailable";
  if (first >= 4 && second >= 4) return "shared_wish";
  if (first <= 2 && second <= 2) return "shared_distance";
  if (Math.abs(first - second) >= 2) return "different";
  return "middle";
}
function choicePairKind(first: V30Choice | undefined, second: V30Choice | undefined): V30PairItem["kind"] {
  if (first?.status === "no_preference" && second?.status === "no_preference") return "middle";
  if (first?.status !== "answered" || second?.status !== "answered") return "unavailable";
  return first.values.length === second.values.length && first.values.every((value) => second.values.includes(value)) ? "shared_wish" : "different";
}
const TASTE_FOLLOW_UP: Record<V30TasteKey, string> = {
  venue: "서로 원하는 공간의 후보와 꼭 필요한 조건을 함께 골라보세요. 둘의 중간이 정답일 필요는 없어요.",
  photo: "각자 남기고 싶은 장면을 골라보고, 함께 담을 수 있는지 살펴보세요.",
  attire: "각자 입고 싶은 옷을 고르고, 함께 맞추고 싶은 부분만 의논해 보세요.",
  meal: "원하는 식사 방식의 후보와 하객에게 필요한 조건을 함께 살펴보세요.",
  guests: "이 답은 바라는 규모예요. 실제 초대할 사람과 장소의 수용 인원은 따로 확인해 보세요.",
  ceremony: "각자 넣고 싶은 순서를 고르고, 전체 길이와 진행 방법을 함께 정해 보세요.",
};
const NEUTRAL_FOLLOW_UP: Record<V30QuestionId, string> = {
  V1: "공간의 장식은 어느 정도면 좋을까요? 각자 마음에 드는 공간 사진을 보며 이야기해 보세요.",
  V2: "식을 올릴 공간은 어디면 좋을까요? 실내와 야외 후보에서 원하는 조건을 각각 이야기해 보세요.",
  V3: "예식에 둘의 이야기를 넣고 싶은지부터 이야기해 보세요. 넣는다면 어떤 방식이면 좋을까요?",
  V4: "꼭 필요한 순서와 원하는 예식 길이는 무엇인지 각각 이야기해 보세요.",
  G1: "초대할 사람을 어떤 기준으로 정하고 싶은지 각자 이야기해 보세요.",
  G2: "자주 만나지 못했던 지인을 초대할지는 어떤 기준으로 정하면 좋을까요?",
  G3: "장소를 고를 때 이동 시간과 다른 조건을 어떻게 함께 볼지 이야기해 보세요.",
  G4: "식사 방식별로 어떤 점이 좋거나 불편할지 각자 이야기해 보세요.",
  R1: "사진에 어떤 순간이 남으면 좋을지 각자 예시를 골라보세요.",
  R2: "미리 포즈를 정하는 촬영은 어느 정도면 좋을지 각자 이야기해 보세요.",
  R3: "예식에 입고 싶은 옷 사진을 각자 골라보고, 마음에 드는 부분을 이야기해 보세요.",
  R4: "옷을 고를 때 가장 먼저 확인하고 싶은 것은 무엇인지 각자 이야기해 보세요.",
  B1: "전체 예산을 유지하고 싶은 경우와 다시 의논하고 싶은 경우를 각각 이야기해 보세요.",
  B2: "항목 사이의 비용을 옮기고 싶은지, 옮긴다면 어떤 조건이면 괜찮을지 이야기해 보세요.",
  B3: "어떤 상황에서 전체 예산을 다시 의논할 수 있을지 각자 생각을 나눠보세요.",
  B4: "항목별 금액을 언제 정하고 어느 정도까지 정해 둘지 이야기해 보세요.",
  D1: "후보를 더 비교하고 싶은 경우와 비교를 끝내고 싶은 경우를 각자 이야기해 보세요.",
  D2: "어떤 조건이 맞으면 선택할 수 있을지, 더 확인할 것이 있는지 이야기해 보세요.",
  D3: "예식장을 고르기 전에 무엇을 어떤 방식으로 확인하고 싶은지 이야기해 보세요.",
  D4: "예약 전 새 후보가 생기면 언제 다시 비교할지 함께 기준을 정해 보세요.",
  T1: "같은 시간에 함께 찾아볼 일과 각자 알아볼 일을 어떻게 나누면 편할까요?",
  T2: "맡아서 정해도 되는 세부 내용과 함께 선택할 내용을 각각 이야기해 보세요.",
  T3: "진행 상황을 어느 시점에 어떤 방식으로 나누면 편할지 이야기해 보세요.",
  T4: "담당을 언제 정하고, 하던 일이 어려워지면 어떻게 다시 나눌지 이야기해 보세요.",
  F1: "가족의 의견은 언제, 어떤 내용부터 들어보면 좋을지 이야기해 보세요.",
  F2: "가족과 상의할 내용과 마지막에 결정할 사람을 어떻게 정할지 이야기해 보세요.",
  F3: "둘이 생각을 맞추는 일과 가족에게 의견을 묻는 일의 순서를 이야기해 보세요.",
  F4: "가족과 상의할 때 누가 대화를 시작하고 누가 함께하면 좋을지 이야기해 보세요.",
  H1: "준비가 힘들다고 말할 때 어떤 반응이 먼저 필요할지 각각 이야기해 보세요.",
  H2: "할 일이 몰릴 때 받고 싶은 도움과 직접 마무리하고 싶은 일을 이야기해 보세요.",
  H3: "무엇부터 할지 막힐 때 어떤 도움이 필요한지 각각 이야기해 보세요.",
  H4: "의견이 부딪힌 뒤 언제, 어떻게 다시 이야기하면 편할지 정해 보세요.",
};
function questionFollowUp(question: V30Question, kind: V30PairItem["kind"]): string {
  if (kind === "unavailable") return "아직 모르거나 계획에 없거나 답하지 않은 내용은 차이로 보지 않아요. 이 이야기가 지금 필요한지부터 확인해 보세요.";
  if (kind === "shared_distance") return `이 문장에는 두 사람 모두 가깝지 않다고 답했어요. ${NEUTRAL_FOLLOW_UP[question.id]}`;
  const followUp = kind === "shared_wish" ? question.followUp : NEUTRAL_FOLLOW_UP[question.id];
  return question.topic === "support" ? `${followUp} 서로 해줄 수 있는 방식과 여유도 이야기해 보세요.` : followUp;
}
function choiceFollowUp(kind: V30PairItem["kind"], followUp: string): string {
  if (kind === "unavailable") return "원하는 보기를 고르지 않은 답은 의견 차이로 보지 않아요. 어떤 상태로 답했는지 보고, 지금 이야기하고 싶은 내용인지부터 확인해 보세요.";
  if (kind === "middle") return "두 사람 모두 특정 보기를 고르지는 않았어요. 실제 후보나 준비 상황이 생기면 다시 이야기해 보세요.";
  return followUp;
}
export function compareV30(firstInput: V30Draft, secondInput: V30Draft): V30PairItem[] {
  const first = normalizeV30Draft(firstInput);
  const second = normalizeV30Draft(secondInput);
  const priorities = new Set([...(first.priorities?.status === "answered" ? first.priorities.values : []), ...(second.priorities?.status === "answered" ? second.priorities.values : [])]);
  const items: V30PairItem[] = WEDDING_CODE_V30_QUESTIONS.map((question) => {
    const kind = ratingPairKind(first.answers[question.id], second.answers[question.id]);
    return {
      id: question.id, title: question.statement,
      first: v30ResponseLabel(first.answers[question.id]), second: v30ResponseLabel(second.answers[question.id]),
      kind, followUp: questionFollowUp(question, kind), isPriority: priorities.has(question.id),
    };
  });
  for (const taste of WEDDING_CODE_V30_TASTES) {
    const kind = choicePairKind(first.tastes[taste.key], second.tastes[taste.key]);
    items.push({
      id: `taste.${taste.key}`, title: taste.question,
      first: v30ChoiceLabels(first.tastes[taste.key], taste.options).join(" · "), second: v30ChoiceLabels(second.tastes[taste.key], taste.options).join(" · "),
      kind, followUp: choiceFollowUp(kind, TASTE_FOLLOW_UP[taste.key]), isPriority: priorities.has(`taste.${taste.key}`),
    });
  }
  const firstPriorityLabels = v30ChoiceLabels(first.priorities, getV30PriorityOptions(first));
  const secondPriorityLabels = v30ChoiceLabels(second.priorities, getV30PriorityOptions(second));
  const priorityKind = choicePairKind(first.priorities, second.priorities);
  const selectedTastePriorities = first.priorities?.status === "answered" ? first.priorities.values.filter((value) => value.startsWith("taste.")) : [];
  const samePriorityTastes = selectedTastePriorities.every((id) => {
    const key = TASTE_KEYS.find((taste) => `taste.${taste}` === id);
    return key !== undefined && choicePairKind(first.tastes[key], second.tastes[key]) === "shared_wish";
  });
  const resolvedPriorityKind = priorityKind === "shared_wish" && !samePriorityTastes ? "different" : priorityKind;
  const spendingKind = choicePairKind(first.spending, second.spending);
  items.push({
    id: "priorities", title: "이번 결혼식에서 특히 지키고 싶은 것",
    first: firstPriorityLabels.join(" · "), second: secondPriorityLabels.join(" · "),
    kind: resolvedPriorityKind, isPriority: false,
    followUp: choiceFollowUp(resolvedPriorityKind, "각자 고른 기준을 왜 지키고 싶은지 이야기해 보세요. 고른 순서가 중요도 순위는 아니에요."),
  }, {
    id: "spending", title: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳",
    first: v30ChoiceLabels(first.spending, WEDDING_CODE_V30_SPENDING).join(" · "), second: v30ChoiceLabels(second.spending, WEDDING_CODE_V30_SPENDING).join(" · "),
    kind: spendingKind, isPriority: false,
    followUp: choiceFollowUp(spendingKind, "원하는 항목과 줄여도 되는 항목을 함께 확인해 보세요. 실제 금액이나 총액 증가에 동의한 것은 아니에요."),
  });
  return items.sort((a, b) => Number(b.isPriority && b.kind === "different") - Number(a.isPriority && a.kind === "different"));
}
