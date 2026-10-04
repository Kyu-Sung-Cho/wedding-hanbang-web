import {
  WEDDING_CODE_V31_AVOIDANCES,
  WEDDING_CODE_V31_OPTIONS,
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_SPENDING,
  WEDDING_CODE_V31_TASTES,
  WEDDING_CODE_V31_TOPICS,
  WEDDING_CODE_V31_VERSION,
  type V31Choice,
  type V31Draft,
  type V31Option,
  type V31Question,
  type V31QuestionId,
  type V31Rating,
  type V31Response,
  type V31TasteKey,
  type V31Topic,
} from "@/constants/weddingCodeV31";
import { V31_CORE_RATING_IDS, V31_EXTRA_RATING_IDS, V31_LEGACY_ONLY_RATING_IDS } from "./v31Flow";

export type V31Evidence = { id: string; text: string; answer: string };
/**
 * 개인 결과의 설명 한 장. 제목이 고른 답을 짧게 옮기고, 원래 문장과 답은 evidence 로 따로 보여준다.
 * body 는 답을 되풀이하지 않고, 오해를 막는 경계(예: 예산을 다시 의논하자는 것과 늘리자고 동의한 것은 다르다)나
 * 두 답을 잇는 말이 있을 때만 쓴다.
 */
export type V31Insight = { id: string; title: string; body?: string; evidence: V31Evidence[]; nextStep: string; sourceInsightId?: string; coveredInsightIds?: string[] };
export type V31Profile = {
  ratedCount: number;
  respondedCount: number;
  hasContent: boolean;
  priorityLabels: string[];
  avoidanceLabels: string[];
  /** 직접 고른 피하고 싶은 것마다 다음 행동. 따로 설명 카드를 만들지 않고 '피하고 싶은 것' 영역에 붙인다. */
  avoidanceSteps: { value: string; label: string; nextStep: string }[];
  priorityGuides: V31Insight[];
  spendingLabels: string[];
  insights: V31Insight[];
  /** nextStep 은 구체적으로 고른 취향에만 있다. 따로 설명 카드를 만들지 않고 '내가 그리는 결혼식' 영역에 붙인다. */
  tastes: { key: V31TasteKey; title: string; labels: string[]; nextStep: string | null }[];
  topics: { key: V31Topic; title: string; responses: V31Evidence[] }[];
  unresolved: V31Evidence[];
};
/**
 * 두 사람 답을 뜻으로 가른다. 차이의 크기로 문제의 크기를 매기지 않는다.
 * - opposite: 한 사람은 4점 이상, 다른 사람은 2점 이하로 문장의 서로 반대편에 섰다.
 * - one_sided: 한 사람만 4점 이상이고 다른 사람은 3점(어느 쪽도 아니에요)이다.
 * - degree: 그 밖에 두 칸 이상 벌어진 답(1 대 3)이다.
 * - shared_request: 상대가 해 주길 바라는 도움(H1 이야기 들어주기, H2 일 나눠 맡아주기)에 둘 다 4점 이상.
 *   같은 바람이 아니라 서로에게 바라는 요구 두 개다. H3·H4 는 둘이 같은 방식을 원하는 문장이라 함께 동의(shared_wish)로 둔다.
 * - partial_overlap: 여러 개 고르는 질문에서 일부만 겹쳤다.
 * - open_preference: 한 사람 이상이 특정 보기를 고르지 않고 열어 뒀다(어느 것이든 괜찮아요·따로 없어요).
 */
export type V31PairItem = {
  id: string;
  title: string;
  first: string;
  second: string;
  kind: "shared_wish" | "shared_request" | "shared_avoidance" | "shared_distance" | "partial_overlap" | "middle"
    | "open_preference" | "one_sided" | "opposite" | "different" | "degree" | "unavailable";
  followUp: string;
  isPriority: boolean;
  sharedLabels?: string[];
  firstOnlyLabels?: string[];
  secondOnlyLabels?: string[];
};

const STATUS_LABELS = {
  undecided: "아직 모르겠어요",
  not_applicable: "해당하지 않아요",
  skipped: "지금 답하지 않을게요",
  no_preference: "어느 것이든 괜찮아요",
  no_match: "맞는 보기가 없어요",
} as const;
const QUESTION_IDS = WEDDING_CODE_V31_QUESTIONS.map((question) => question.id);
const TASTE_KEYS = WEDDING_CODE_V31_TASTES.map((taste) => taste.key);
const PRIORITY_IDS = [...QUESTION_IDS, ...TASTE_KEYS.map((key) => `taste.${key}`), ...WEDDING_CODE_V31_AVOIDANCES.map((option) => `avoid.${option.value}`)];
const MAX_CODE_LENGTH = 256;
const CHOICE_STATUS_CODES = { undecided: "u", not_applicable: "n", skipped: "s", no_preference: "p", no_match: "m" } as const;

function isRating(value: unknown): value is V31Rating {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}
function isResponse(value: unknown): value is V31Response {
  return isRating(value) || value === "undecided" || value === "not_applicable" || value === "skipped";
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function validChoice(value: unknown, options: readonly V31Option[], max: number): value is V31Choice | undefined {
  if (value === undefined) return true;
  if (!isObject(value) || typeof value.status !== "string") return false;
  if (value.status !== "answered") return Object.hasOwn(CHOICE_STATUS_CODES, value.status) && onlyKeys(value, ["status"]);
  return onlyKeys(value, ["status", "values"]) && Array.isArray(value.values) && value.values.length > 0 && value.values.length <= max
    && new Set(value.values).size === value.values.length && value.values.every((item) => typeof item === "string" && options.some((option) => option.value === item));
}
function validDraft(value: unknown): value is V31Draft {
  if (!isObject(value) || !onlyKeys(value, ["version", "answers", "tastes", "avoidances", "priorities", "spending"]) || value.version !== WEDDING_CODE_V31_VERSION) return false;
  if (!isObject(value.answers) || !onlyKeys(value.answers, QUESTION_IDS) || !Object.values(value.answers).every(isResponse)) return false;
  if (!isObject(value.tastes) || !onlyKeys(value.tastes, TASTE_KEYS)) return false;
  if (!WEDDING_CODE_V31_TASTES.every((taste) => validChoice((value.tastes as Record<string, unknown>)[taste.key], taste.options, taste.max))) return false;
  if (!validChoice(value.spending, WEDDING_CODE_V31_SPENDING, 2)) return false;
  if (!validChoice(value.avoidances, WEDDING_CODE_V31_AVOIDANCES, WEDDING_CODE_V31_AVOIDANCES.length)) return false;
  const candidate = value as V31Draft;
  return validChoice(value.priorities, getV31PriorityOptions(candidate), 3);
}
function cloneChoice(choice: V31Choice | undefined): V31Choice | undefined {
  return choice?.status === "answered" ? { status: "answered", values: [...choice.values] } : choice ? { ...choice } : undefined;
}

export function createV31Draft(): V31Draft {
  return { version: WEDDING_CODE_V31_VERSION, answers: {}, tastes: {} };
}
export function getV31PriorityOptions(draft: V31Draft): V31Option[] {
  return [
    ...WEDDING_CODE_V31_QUESTIONS.filter((question) => isRating(draft.answers[question.id]) && Number(draft.answers[question.id]) >= 4)
      .map((question) => ({ value: question.id, label: question.shortLabel })),
    ...WEDDING_CODE_V31_TASTES.filter((taste) => draft.tastes[taste.key]?.status === "answered")
      .map((taste) => ({ value: `taste.${taste.key}`, label: `${taste.title}: ${v31ChoiceLabels(draft.tastes[taste.key], taste.options).join(" · ")}` })),
    ...WEDDING_CODE_V31_AVOIDANCES.filter((option) => draft.avoidances?.status === "answered" && draft.avoidances.values.includes(option.value))
      .map((option) => ({ value: `avoid.${option.value}`, label: `피하고 싶은 것: ${option.label}` })),
  ];
}
export function normalizeV31Draft(draft: V31Draft): V31Draft {
  const normalized: V31Draft = { version: draft.version, answers: { ...draft.answers }, tastes: {} };
  for (const taste of WEDDING_CODE_V31_TASTES) {
    const choice = cloneChoice(draft.tastes[taste.key]);
    if (choice) normalized.tastes[taste.key] = choice;
  }
  const spending = cloneChoice(draft.spending);
  if (spending) normalized.spending = spending;
  const avoidances = cloneChoice(draft.avoidances);
  if (avoidances) normalized.avoidances = avoidances;
  if (draft.priorities?.status === "answered") {
    const eligible = getV31PriorityOptions(normalized).map((option) => option.value);
    const values = draft.priorities.values.filter((value) => eligible.includes(value));
    if (values.length) normalized.priorities = { status: "answered", values };
  } else if (draft.priorities) normalized.priorities = { ...draft.priorities };
  return normalized;
}
export function v31ResponseLabel(value: V31Response | undefined): string {
  if (isRating(value)) return WEDDING_CODE_V31_OPTIONS[value - 1].label;
  return value ? STATUS_LABELS[value] : "아직 보지 않은 문장이에요";
}
/**
 * 우선순위 화면의 ‘따로 없음’ 버튼 이름. 결과·비교·답 목록도 사용자가 실제로 누른 이 이름을 그대로 인용한다
 * (입력 보기와 표시 문구가 따로 놀면 누르지 않은 문구가 그 사람의 답처럼 나온다).
 */
export const V31_PRIORITY_NO_PREFERENCE_LABEL = "꼭 지키고 싶은 건 따로 없어요";
/** 우선순위 화면의 ‘아직 모름’ 버튼 이름. */
export const V31_PRIORITY_UNDECIDED_LABEL = "꼭 지키고 싶은 건 아직 정하지 못했어요";
/**
 * 우선순위를 고르지 않고 넘어간 답. 우선순위 화면에는 ‘지금 답하지 않을게요’ 보기가 없어(넘어가기 버튼이 같은 답을
 * 남긴다) 그 버튼 이름을 인용할 수 없으므로, 한 일을 과거형으로 적는다.
 */
export const V31_PRIORITY_SKIPPED_LABEL = "고르지 않고 넘어갔어요";
export function v31ChoiceLabels(choice: V31Choice | undefined, options: readonly V31Option[]): string[] {
  if (!choice) return ["아직 보지 않은 질문이에요"];
  // 우선순위 보기는 문항·취향·피하고 싶은 것의 자리 값만 쓴다. 고를 보기가 없을 때(빈 목록)도 우선순위로 읽는다.
  const priorityContext = options.every((option) => PRIORITY_IDS.includes(option.value));
  if (choice.status === "no_preference") {
    if (options.length === WEDDING_CODE_V31_AVOIDANCES.length && options.every((option) => WEDDING_CODE_V31_AVOIDANCES.some((avoidance) => avoidance.value === option.value))) return ["따로 피하고 싶은 것은 없어요"];
    if (options.length === WEDDING_CODE_V31_SPENDING.length && options.every((option) => WEDDING_CODE_V31_SPENDING.some((spending) => spending.value === option.value))) return ["더 쓰고 싶은 곳은 지금 없어요"];
    if (priorityContext) return [V31_PRIORITY_NO_PREFERENCE_LABEL];
  }
  if (priorityContext && choice.status === "skipped") return [V31_PRIORITY_SKIPPED_LABEL];
  if (priorityContext && choice.status === "undecided") return [V31_PRIORITY_UNDECIDED_LABEL];
  if (choice.status !== "answered") return [STATUS_LABELS[choice.status]];
  return choice.values.map((value) => options.find((option) => option.value === value)?.label ?? "알 수 없는 선택이에요");
}
export function hasV31Content(draft: V31Draft): boolean {
  return WEDDING_CODE_V31_QUESTIONS.some((question) => isRating(draft.answers[question.id]))
    || WEDDING_CODE_V31_TASTES.some((taste) => {
      const choice = draft.tastes[taste.key];
      return choice?.status === "no_preference" || (choice?.status === "answered" && choice.values.length > 0);
    }) || draft.spending?.status === "no_preference" || (draft.spending?.status === "answered" && draft.spending.values.length > 0)
    || draft.avoidances?.status === "no_preference" || (draft.avoidances?.status === "answered" && draft.avoidances.values.length > 0);
}

function encodeChoice(choice: V31Choice | undefined, values: readonly string[]): string {
  if (!choice) return "-";
  if (choice.status !== "answered") return CHOICE_STATUS_CODES[choice.status];
  return `c${choice.values.map((value) => values.indexOf(value).toString(36).padStart(2, "0")).join("")}`;
}
function decodeChoice(code: string, values: readonly string[], max: number): V31Choice | undefined | null {
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
export function encodeV31(draft: V31Draft): string {
  if (!validDraft(draft)) throw new Error("웨딩코드 응답 형식이 올바르지 않아요.");
  const answers = WEDDING_CODE_V31_QUESTIONS.map((question) => {
    const value = draft.answers[question.id];
    return isRating(value) ? String(value) : value ? CHOICE_STATUS_CODES[value] : "-";
  }).join("");
  const tastes = WEDDING_CODE_V31_TASTES.map((taste) => encodeChoice(draft.tastes[taste.key], taste.options.map((option) => option.value))).join(".");
  const code = ["31", answers, tastes, encodeChoice(draft.avoidances, WEDDING_CODE_V31_AVOIDANCES.map((option) => option.value)), encodeChoice(draft.priorities, PRIORITY_IDS), encodeChoice(draft.spending, WEDDING_CODE_V31_SPENDING.map((option) => option.value))].join("_");
  if (code.length > MAX_CODE_LENGTH) throw new Error("공유할 응답이 너무 길어요.");
  return code;
}
function parseV31Code(code: string | null | undefined): V31Draft | null {
  if (typeof code !== "string" || code.length > MAX_CODE_LENGTH || !/^[0-9a-z_.-]+$/.test(code)) return null;
  const parts = code.split("_");
  if (parts.length !== 6 || parts[0] !== "31" || parts[1].length !== WEDDING_CODE_V31_QUESTIONS.length || !/^[1-5uns-]+$/.test(parts[1])) return null;
  const tasteCodes = parts[2].split(".");
  if (tasteCodes.length !== WEDDING_CODE_V31_TASTES.length) return null;
  const draft = createV31Draft();
  const statusByChar = { u: "undecided", n: "not_applicable", s: "skipped" } as const;
  for (let index = 0; index < QUESTION_IDS.length; index++) {
    const char = parts[1][index];
    if (char === "-") continue;
    draft.answers[QUESTION_IDS[index]] = /[1-5]/.test(char) ? Number(char) as V31Rating : statusByChar[char as keyof typeof statusByChar];
  }
  for (let index = 0; index < WEDDING_CODE_V31_TASTES.length; index++) {
    const taste = WEDDING_CODE_V31_TASTES[index];
    const choice = decodeChoice(tasteCodes[index], taste.options.map((option) => option.value), taste.max);
    if (choice === null) return null;
    if (choice) draft.tastes[taste.key] = choice;
  }
  const avoidances = decodeChoice(parts[3], WEDDING_CODE_V31_AVOIDANCES.map((option) => option.value), WEDDING_CODE_V31_AVOIDANCES.length);
  const priorities = decodeChoice(parts[4], PRIORITY_IDS, 3);
  const spending = decodeChoice(parts[5], WEDDING_CODE_V31_SPENDING.map((option) => option.value), 2);
  if (avoidances === null || priorities === null || spending === null) return null;
  if (avoidances) draft.avoidances = avoidances;
  if (priorities) draft.priorities = priorities;
  if (spending) draft.spending = spending;
  return validDraft(draft) ? draft : null;
}
export function decodeV31(code: string | null | undefined): V31Draft | null {
  const draft = parseV31Code(code);
  return draft && hasV31Content(draft) ? draft : null;
}
/** 진행 복원은 모름·건너뜀만 있는 답도 보존한다. 공유 가능 여부는 별도로 검증한다. */
export function decodeV31Progress(code: string | null | undefined): V31Draft | null {
  return parseV31Code(code);
}
export function buildV31ShareUrl({ origin, first, second }: { origin: string; first: V31Draft; second?: V31Draft | null }): string | null {
  if (!validDraft(first) || !hasV31Content(first) || (second != null && (!validDraft(second) || !hasV31Content(second)))) return null;
  let base: URL;
  try { base = new URL(origin); } catch { return null; }
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
  const params = new URLSearchParams({ v: WEDDING_CODE_V31_VERSION, a: encodeV31(first) });
  if (second) params.set("b", encodeV31(second));
  return `${base.origin}/wedding-code#${params.toString()}`;
}

function evidence(draft: V31Draft, id: V31QuestionId): V31Evidence {
  const question = WEDDING_CODE_V31_QUESTIONS.find((item) => item.id === id)!;
  return { id, text: question.statement, answer: v31ResponseLabel(draft.answers[id]) };
}
function tasteEvidence(draft: V31Draft, key: V31TasteKey): V31Evidence {
  const taste = WEDDING_CODE_V31_TASTES.find((item) => item.key === key)!;
  return { id: `taste.${key}`, text: taste.question, answer: v31ChoiceLabels(draft.tastes[key], taste.options).join(" · ") };
}
function avoidanceEvidence(draft: V31Draft): V31Evidence {
  return { id: "avoidances", text: "결혼식에서 피하고 싶은 것", answer: v31ChoiceLabels(draft.avoidances, WEDDING_CODE_V31_AVOIDANCES).join(" · ") };
}
/**
 * 예산을 다시 의논하자는 답을 늘리자는 동의로 읽지 않게 하는 경계. B3 설명과 B1·B3 조합에서 한 번씩만 쓴다(둘은 한 화면에
 * 같이 나오지 않는다). 판정 고지(「~아니에요」)는 결과 머리글에서 한 번만 하므로 여기서는 할 일로 적는다.
 */
const BUDGET_REVISIT_BOUNDARY = "실제로 늘릴지는 이야기해 본 뒤 둘이 결정해요.";
/**
 * 높게 답한 문장 하나에 붙는 설명. 제목이 고른 답을 짧게 옮기고 원래 문장과 답은 근거로 따로 보여주므로,
 * body 에 「~라고 답했어요」를 다시 쓰지 않는다. body 는 답을 넘겨짚기 쉬운 곳에만 한 문장으로 둔다.
 */
const SINGLE_READINGS: Record<V31QuestionId, { title: string; body?: string; nextStep: string }> = {
  V1: { title: "꽃 장식이 풍성한 공간에서 식을 올리고 싶어요", nextStep: "마음에 드는 공간 사진에서 꽃이 어느 정도면 좋은지, 꼭 두고 싶은 곳은 어디인지 짚어 보세요. 기본 장식과 추가 장식의 비용도 나눠 확인해 보세요." },
  G1: { title: "초대 명단은 가깝게 지내는 사람 위주였으면 좋겠어요", nextStep: "꼭 함께하고 싶은 사람부터 적어 보세요. 두 사람의 명단에 가족이 초대하고 싶은 분까지 합친 뒤, 원하는 장소에 들어갈 수 있는지 확인해 보세요." },
  G2: { title: "자주 못 만났던 사람도 함께했으면 해요", nextStep: "생각나는 사람을 적고, 어떤 방식으로 소식을 전할지 정해 보세요." },
  G3: { title: "하객이 오가기 편한 곳을 우선하고 싶어요", nextStep: "하객이 주로 오는 지역에서 후보 장소까지 걸리는 시간을 비교해 보세요. 대중교통, 주차, 이동에 도움이 필요한 사람도 함께 살펴보세요." },
  R3: { title: "그날은 하객들 사이에서도 눈에 띄는 옷을 원해요", nextStep: "원하는 옷 사진에서 색, 모양, 소재 중 어떤 점이 좋은지 짚어 보세요." },
  R4: { title: "예식 옷은 움직임부터 확인하고 싶어요", nextStep: "입어볼 때 앉기, 걷기, 팔 들기를 해 보세요. 당일 옷을 입고 있어야 할 시간도 함께 생각해 보세요." },
  B1: { title: "처음 정한 전체 예산을 지키고 싶어요", nextStep: "둘이 쓸 수 있는 전체 금액을 먼저 확인하고, 견적에 포함된 비용과 나중에 붙는 비용을 합쳐 비교해 보세요." },
  B2: { title: "다른 비용을 줄여서라도 더 원하는 곳에 쓰고 싶어요", nextStep: "더 쓰고 싶은 곳과 줄여도 되는 곳을 하나씩 고르고, 실제 견적에서 옮길 수 있는 금액을 확인해 보세요." },
  B3: { title: "새로 원하는 것이 생기면 예산도 다시 의논하고 싶어요", body: BUDGET_REVISIT_BOUNDARY, nextStep: "어떤 경우에 예산을 다시 이야기할지 정해 보세요. 늘릴지, 늘린다면 얼마를 어떻게 마련할지는 그때 함께 확인해요." },
  B4: { title: "처음부터 항목별 금액을 나눠두고 싶어요", nextStep: "장소, 식사, 촬영, 옷처럼 준비할 항목을 적고 각각의 한도를 정해 보세요. 견적을 받은 뒤 다시 볼 시점도 정해 두면 좋아요." },
  D1: { title: "마음을 정하기 전에 다른 후보도 보고 싶어요", nextStep: "비교할 조건과 살펴볼 후보 수를 먼저 정해 보세요. 각 후보의 같은 항목을 놓고 비교하면 차이를 보기 쉬워요." },
  D2: { title: "정한 조건에 맞으면 선택하고 싶어요", nextStep: "꼭 맞아야 하는 조건과 달라도 괜찮은 조건을 나눠 적어 보세요. 결정 전에 확인할 계약 내용은 따로 챙겨 보세요." },
  D3: { title: "장소는 직접 보고 고르고 싶어요", nextStep: "방문할 수 있는 날짜를 확인하고, 식을 올릴 곳과 대기실, 식사할 곳에서 보고 싶은 점을 적어 가세요." },
  T1: { title: "업체를 알아볼 때는 시간을 맞춰 둘이 같이 찾아보고 싶어요", nextStep: "함께 볼 항목 하나와 시간을 정해 보세요. 각자 먼저 알아올 내용이 있는지도 나눠 보세요." },
  T2: { title: "일부 세부 선택은 맡은 사람이 정해도 괜찮아요", nextStep: "혼자 정해도 되는 일의 예를 하나씩 들고, 함께 확인해야 할 선택은 따로 적어 보세요." },
  T3: { title: "따로 맡은 일도 어디까지 했는지 서로 알려주면 좋겠어요", nextStep: "매번 알려줄지, 정한 시간에 모아서 이야기할지 맞춰 보세요. 서로에게 편한 방법을 확인하는 게 먼저예요." },
  T4: { title: "시작 전에 누가 맡을지 정하고 싶어요", nextStep: "다음에 할 일마다 담당과 마칠 시점을 정해 보세요. 맡은 일이 버거워지면 다시 나누기로 약속해도 좋아요." },
  F1: { title: "가족의 바람은 초반에 들어보고 싶어요", nextStep: "가족에게 먼저 여쭤볼 내용을 정리해 보세요. 아직 결정하지 않은 것과 이미 둘이 정한 것을 나눠 말하면 좋아요." },
  F2: { title: "의견이 달라도 마지막 선택은 둘이 하고 싶어요", nextStep: "가족에게 의견을 구할 내용과 둘이 결정할 내용을 나눠 보세요. 다른 의견을 들었을 때 어떻게 설명할지도 함께 생각해 보세요." },
  F3: { title: "가족에게 묻기 전에 둘의 생각부터 맞추고 싶어요", nextStep: "서로 원하는 것과 아직 정하지 못한 것을 적어 보세요. 둘이 같은 말로 설명할 수 있는지 확인해 보세요." },
  F4: { title: "각자 자기 쪽 가족에게 먼저 이야기하면 좋겠어요", nextStep: "각자 누구에게 무엇을 먼저 말할지 정하고, 둘이 같이 말해야 할 일은 따로 적어 두세요." },
  H1: { title: "힘들다고 말할 때는 이야기를 먼저 들어주길 바라요", nextStep: "지금은 들어주면 좋은지, 함께 해결해 주면 좋은지를 말해 보세요. 상대가 필요로 하는 반응도 물어보세요." },
  H2: { title: "일이 몰리면 일부를 나눠 맡아주길 바라요", nextStep: "지금 넘길 수 있는 일 하나를 골라 부탁해 보세요. 상대가 맡을 수 있는 범위와 마칠 시점을 함께 확인해 보세요." },
  H3: { title: "막힐 때는 다음 한 가지를 같이 정하고 싶어요", nextStep: "지금 막힌 일을 말하고, 바로 할 수 있는 한 가지부터 같이 골라 보세요. 누가 맡을지는 그다음에 정해도 괜찮아요." },
  H4: { title: "의견이 부딪히면 잠깐 쉬고 다시 말하고 싶어요", nextStep: "쉬고 싶다는 말과 다시 이야기할 시점을 함께 정해 두세요. 쉬는 시간이 상대에게 어떻게 느껴지는지도 들어 보세요." },
};
/**
 * 피하고 싶은 것은 설명 카드를 따로 만들지 않는다. 같은 화면의 '피하고 싶은 것' 영역이 고른 보기를 이미 보여주므로,
 * 다음 행동만 그 영역의 해당 줄에 붙인다. 우선순위로 고른 것만 같은 문장으로 안내 카드를 만든다.
 */
const AVOIDANCE_COPY: Record<string, { title: string; nextStep: string }> = {
  heavy_decoration: { title: "꽃과 장식이 아주 많은 공간은 피하고 싶어요", nextStep: "좋아하는 장식 사진과 부담스러운 사진을 나란히 놓고, 장식의 양과 위치를 짚어 보세요." },
  crowded_space: { title: "사람이 아주 많이 모인 공간은 피하고 싶어요", nextStep: "예상 인원이 들어왔을 때 좌석 간격과 이동 동선이 넉넉한지 확인해 보세요." },
  long_photography: { title: "시간이 많이 드는 사진 촬영은 피하고 싶어요", nextStep: "촬영에 쓸 수 있는 시간을 정하고, 꼭 남길 장면부터 촬영 담당자와 이야기해 보세요." },
  stage_participation: { title: "하객을 무대로 부르는 순서는 피하고 싶어요", nextStep: "하객이 자리에서 함께하는 순서와 무대에 올라오는 순서를 나눠 보고, 원하지 않는 방식은 사회자에게 미리 알려 주세요." },
  loud_music: { title: "큰 음악 소리는 피하고 싶어요", nextStep: "실제 공간에서 음악 크기를 확인하고, 조절을 부탁할 사람과 방법을 정해 보세요." },
};
function avoidanceNextStep(draft: V31Draft, value: string): string {
  // 하객 없이 둘만 하는 예식에서는 하객 순서를 진행자에게 알리라는 안내가 맞지 않는다.
  if (value === "stage_participation" && wantsNoGuests(draft)) return "하객 없이 둘만 하는 예식도 골랐어요. 이 항목은 지금 계획에는 해당하지 않을 수 있어요. 다른 날의 행사나 나중에 바뀔 수 있는 상황을 떠올렸다면 이야기해 보세요.";
  return AVOIDANCE_COPY[value].nextStep;
}
/**
 * 취향도 설명 카드를 따로 만들지 않고 '내가 그리는 결혼식'의 그 줄에 다음 행동으로 붙인다.
 * 커플 비교 문장(TASTE_FOLLOW_UP)과 달리 한 사람에게 말한다. 구체적으로 고른 취향에만 붙인다.
 */
const TASTE_NEXT_STEPS: Record<V31TasteKey, string> = {
  venue: "후보 공간을 볼 때 꼭 필요한 조건을 먼저 적어 가세요.",
  photo: "꼭 남기고 싶은 장면을 몇 개 골라 두세요.",
  attire: "마음에 드는 옷 사진을 모아 두세요.",
  meal: "함께 식사할 분들 중 알레르기나 먹지 못하는 음식, 어르신 식사처럼 챙길 조건이 있는지 확인해 보세요.",
  guests: "실제로 초대할 사람(가족이 초대할 분 포함)과 장소에 들어갈 인원은 따로 확인해 보세요.",
  ceremony: "넣고 싶은 순서를 고른 뒤 전체 길이를 정해 보세요.",
};
function tasteNextStep(draft: V31Draft, key: V31TasteKey): string | null {
  const choice = draft.tastes[key];
  if (choice?.status !== "answered") return null;
  if (key === "venue" && choice.values.some((value) => value === "outdoor" || value === "both_spaces")) return "비가 오거나 더운 날 쓸 공간도 함께 확인해 보세요.";
  if (key === "photo" && choice.values.includes("both_styles")) return "자연스럽게 남길 순간과 미리 준비할 장면을 각각 골라 두세요.";
  if (key === "guests" && wantsNoGuests(draft)) return "후보 장소에서 둘만의 예식이 가능한지 확인하고, 남기고 싶은 순간과 진행 순서를 이야기해 보세요.";
  // ‘꼭 필요한 순서만 짧게’ 하나만 골랐다면 순서를 더 넣는 쪽으로 안내하지 않는다.
  if (key === "ceremony" && choice.values.length === 1 && choice.values[0] === "short") return "꼭 넣을 순서를 두세 가지만 먼저 정하고, 식 전체가 몇 분이면 좋을지 둘이 이야기해 보세요.";
  return TASTE_NEXT_STEPS[key];
}
/** 취향을 우선순위로 골랐을 때만 쓰는 안내 카드. 일반 설명 목록에는 넣지 않는다(취향 영역과 같은 말을 되풀이한다). */
function directTasteInsight(draft: V31Draft, key: V31TasteKey): V31Insight | null {
  const taste = WEDDING_CODE_V31_TASTES.find((item) => item.key === key)!;
  const nextStep = tasteNextStep(draft, key);
  if (!nextStep) return null;
  // 상대 결과 탭에서도 같은 카드가 나오므로 제목에 ‘내가’를 넣지 않는다.
  return { id: `direct-${key}`, title: `${taste.title} 취향`, evidence: [tasteEvidence(draft, key)], nextStep };
}
function wantsNoGuests(draft: V31Draft): boolean {
  return draft.tastes.guests?.status === "answered" && draft.tastes.guests.values.includes("no_guests");
}
function singleInsight(draft: V31Draft, question: V31Question): V31Insight {
  const insight = { id: `single-${question.id}`, ...SINGLE_READINGS[question.id], evidence: [evidence(draft, question.id)] };
  if (!wantsNoGuests(draft) || question.topic !== "guests") return insight;
  return { ...insight, evidence: [...insight.evidence, tasteEvidence(draft, "guests")], nextStep: "하객 없이 둘만 하는 예식도 골랐어요. 이 문장과 하객 규모에 답할 때 서로 다른 상황을 떠올렸는지 이야기해 보세요. 두 답 모두 그대로 둬도 괜찮아요." };
}
/** 피하고 싶은 것을 우선순위로 골랐을 때만 쓰는 안내 카드. */
function avoidanceInsight(draft: V31Draft, option: V31Option): V31Insight {
  const noGuestParticipation = wantsNoGuests(draft) && option.value === "stage_participation";
  return { id: `avoid-${option.value}`, title: AVOIDANCE_COPY[option.value].title,
    evidence: noGuestParticipation ? [avoidanceEvidence(draft), tasteEvidence(draft, "guests")] : [avoidanceEvidence(draft)],
    nextStep: avoidanceNextStep(draft, option.value),
  };
}
function priorityGuides(draft: V31Draft, insights: V31Insight[]): V31Insight[] {
  if (draft.priorities?.status !== "answered") return [];
  const selected = draft.priorities.values;
  // 상황을 확인하는 보조 근거와, 조합이 실제로 설명하는 선택을 구분한다.
  const relatedIds = (insight: V31Insight): readonly string[] => COMBINATIONS.find(rule => rule.id === insight.id)?.items
    ?? (insight.id === "budget-explicit-spending" ? ["B1", "spending"]
      : insight.id === "flower-amount" ? ["V1", "avoid.heavy_decoration"]
        : insight.id === "participation-format" ? ["taste.ceremony", "avoid.stage_participation"]
          : insight.id === "guests-participation" ? ["taste.ceremony", "taste.guests"] : []);
  const simpleInsightId = (id: string): string | null => id.startsWith("taste.") ? id.replace("taste.", "direct-")
    : id.startsWith("avoid.") ? id.replace("avoid.", "avoid-") : QUESTION_IDS.includes(id as V31QuestionId) ? `single-${id}` : null;
  const combinations = insights.filter(insight => !/^(single-|direct-|avoid-)/.test(insight.id) && relatedIds(insight).some(id => selected.includes(id)));
  const emitted = new Set<string>();
  return draft.priorities.values.flatMap((id): V31Insight[] => {
    const related = combinations.filter(insight => relatedIds(insight).includes(id));
    if (related.length) return related.flatMap(insight => {
      if (emitted.has(insight.id)) return [];
      emitted.add(insight.id);
      const labels = getV31PriorityOptions(draft).filter(option => selected.includes(option.value) && relatedIds(insight).includes(option.value)).map(option => option.label);
      return [{ ...insight, id: `priority-${insight.id}`, sourceInsightId: insight.id,
        coveredInsightIds: [insight.id, ...relatedIds(insight).flatMap(value => { const simpleId = simpleInsightId(value); return simpleId ? [simpleId] : []; })],
        evidence: [...insight.evidence, { id: "priorities", text: "이 설명과 이어진, 꼭 지키고 싶은 것으로 고른 것", answer: labels.join(" · ") }],
      }];
    });
    const question = WEDDING_CODE_V31_QUESTIONS.find((item) => item.id === id);
    const confirmation: V31Evidence = { id: "priorities", text: "이번 결혼 준비에서 꼭 지키고 싶은 것", answer: getV31PriorityOptions(draft).find((option) => option.value === id)?.label ?? "" };
    if (question) { const insight = singleInsight(draft, question); return [{ ...insight, id: `priority-${id}`, sourceInsightId: insight.id, evidence: [...insight.evidence, confirmation] }]; }
    const taste = WEDDING_CODE_V31_TASTES.find((item) => `taste.${item.key}` === id);
    if (taste) {
      const insight = directTasteInsight(draft, taste.key);
      return insight ? [{ ...insight, id: `priority-${id}`, sourceInsightId: insight.id, evidence: [...insight.evidence, confirmation] }] : [];
    }
    const avoid = WEDDING_CODE_V31_AVOIDANCES.find((option) => `avoid.${option.value}` === id);
    if (!avoid) return [];
    const insight = avoidanceInsight(draft, avoid);
    return [{ ...insight, id: `priority-${id}`, sourceInsightId: insight.id, evidence: [...insight.evidence, confirmation] }];
  });
}
/** 두 문장 모두 높게 답했을 때만 만드는 설명. 제목이 두 답을 잇고, body 는 경계가 필요한 조합에만 둔다. */
const COMBINATIONS: readonly { id: string; items: readonly V31QuestionId[]; title: string; body?: string; nextStep: string }[] = [
  { id: "attire-comfort", items: ["R3", "R4"], title: "눈에 띄는 옷도 편하게 입고 싶어요", nextStep: "마음에 드는 옷을 입고 앉거나 걸어보며 편한지 확인해 보세요." },
  { id: "budget-reallocate", items: ["B1", "B2"], title: "예산 안에서 원하는 항목에 더 쓰고 싶어요", nextStep: "더 쓰고 싶은 한 항목과 줄여도 되는 한 항목을 직접 정해 보세요." },
  { id: "budget-revisit", items: ["B1", "B3"], title: "전체 예산은 지키고 싶고, 다시 의논할 길도 열어 두고 싶어요", body: BUDGET_REVISIT_BOUNDARY, nextStep: "어떤 경우에 전체 예산을 다시 의논할지 함께 정해 보세요." },
  { id: "decision-conditions", items: ["D1", "D2"], title: "다른 후보도 더 보고 싶고, 조건에 맞으면 그때 고르고 싶어요", nextStep: "어디까지 비교할지, 어떤 조건이면 선택할지 직접 정해 보세요." },
  { id: "delegate-update", items: ["T2", "T3"], title: "세부 선택을 맡겨도, 진행 상황은 알고 싶어요", nextStep: "중간에 알려 줄 때를 정하고, 꼭 함께 정할 일의 범위도 정해 보세요." },
  { id: "family-listen-decide", items: ["F1", "F2"], title: "가족의 바람을 듣고, 선택은 둘이 하고 싶어요", nextStep: "가족과 상의할 내용과 둘이 최종 선택할 내용을 나눠 보세요." },
  { id: "support-listen-help", items: ["H1", "H2"], title: "이야기를 먼저 들어주고, 내 일의 일부도 맡아주길 바라요", nextStep: "이야기를 먼저 들어주면 좋은 때와, 내 일의 일부도 맡아주면 좋은 때를 말해 보세요. 상대가 맡을 수 있는 범위도 함께 확인해 보세요." },
];

function buildInsights(draft: V31Draft): V31Insight[] {
  const high = (id: V31QuestionId) => isRating(draft.answers[id]) && Number(draft.answers[id]) >= 4;
  const insights: V31Insight[] = COMBINATIONS.filter((rule) => rule.items.every(high)).map((rule) => ({
    id: rule.id, title: rule.title, ...(rule.body ? { body: rule.body } : {}), nextStep: rule.nextStep, evidence: rule.items.map((id) => evidence(draft, id)),
  }));
  if (high("B1") && draft.spending?.status === "answered") {
    const labels = v31ChoiceLabels(draft.spending, WEDDING_CODE_V31_SPENDING);
    // 금액으로 읽지 않게 하는 경계는 다음 행동(같은 총액 안에서 비교)과 같은 화면의 ‘더 쓰고 싶은 곳’ 영역
    // (전체 예산을 늘릴지는 따로 정해요)이 이미 말한다. 본문에서 「~않았어요」를 한 번 더 쓰지 않는다.
    insights.push({
      id: "budget-explicit-spending", title: "전체 예산 안에서 더 쓰고 싶은 곳이 있어요",
      evidence: [evidence(draft, "B1"), { id: "spending", text: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳", answer: labels.join(" · ") }],
      nextStep: "더 쓸 항목과 줄여도 되는 항목의 견적을 같은 전체 예산 안에서 비교해 보세요.",
    });
  }
  // 취향 하나, 피하고 싶은 것 하나만으로는 설명 카드를 만들지 않는다(같은 화면의 취향·피하고 싶은 것 영역과 같은 말이다).
  // 두 답을 잇는 교차 안내만 카드로 두고, 단일 문장 설명보다 먼저 만들어 그 문장(V1)을 다시 설명하지 않게 한다.
  const participatory = draft.tastes.ceremony?.status === "answered" && draft.tastes.ceremony.values.includes("participatory");
  const avoidsStage = draft.avoidances?.status === "answered" && draft.avoidances.values.includes("stage_participation");
  if (draft.avoidances?.status === "answered") {
    if (high("V1") && draft.avoidances.values.includes("heavy_decoration")) insights.push({
      id: "flower-amount", title: "꽃 장식은 풍성하게 원하면서, 장식이 아주 많은 공간은 피하고 싶어요", body: "꽃을 둘 곳과 비워 둘 곳을 나누면 두 답을 함께 살릴 수 있어요.", evidence: [evidence(draft, "V1"), avoidanceEvidence(draft)],
      nextStep: "꽃을 꼭 두고 싶은 자리 한두 곳을 먼저 정해 보세요. 기본 장식에 들어가는 꽃의 양도 함께 확인해 보세요.",
    });
    if (participatory && avoidsStage) insights.push({
      id: "participation-format", title: "하객이 함께하는 방식과 무대 참여는 따로 정해 볼 수 있어요", body: "무대로 부르지 않고 자리에서 함께하는 방식도 있어요.",
      evidence: [tasteEvidence(draft, "ceremony"), avoidanceEvidence(draft), ...(wantsNoGuests(draft) ? [tasteEvidence(draft, "guests")] : [])],
      nextStep: wantsNoGuests(draft) ? "하객 없이 둘만 하는 예식도 골랐어요. 하객 참여 순서는 예식이 아닌 다른 날을 떠올린 건지, 나중에 바뀔 수도 있다고 생각한 건지 이야기해 보세요. 두 답 모두 그대로 둬도 괜찮아요." : "사회자와 순서를 정할 때 참여 여부를 하객이 선택할 수 있는지도 확인해 보세요.",
    });
  }
  // 둘만 하는 예식과 하객 참여 순서를 함께 골랐다. 무대 참여를 피하는 답도 있으면 participation-format 이 같은 이야기를 한다.
  if (wantsNoGuests(draft) && participatory && !avoidsStage) insights.push({
    id: "guests-participation", title: "둘만의 예식에서 참여 순서는 어떻게 할까요?",
    evidence: [tasteEvidence(draft, "ceremony"), tasteEvidence(draft, "guests")],
    nextStep: "하객 없이 둘만 하는 예식과 하객이 참여하는 순서를 함께 골랐어요. 서로 다른 날이나 상황을 떠올린 건지 이야기해 보세요. 두 답 모두 그대로 둬도 괜찮아요.",
  });
  const covered = new Set(insights.flatMap((insight) => insight.evidence.map((item) => item.id)));
  for (const question of WEDDING_CODE_V31_QUESTIONS) {
    if (high(question.id) && !covered.has(question.id)) insights.push(singleInsight(draft, question));
  }
  return insights;
}
/**
 * 개인 결과 설명의 정렬 원칙.
 * 결과 화면은 설명 바로 위에 네 글자 요약을 두고, 그 요약은 여덟 문장(주제마다 두 문장)의 답을 칸과 함께 이미 보여준다.
 * 그 여덟 문장만 근거로 삼은 설명은 요약을 한 번 더 말하는 셈이라 뒤로 보내 접는다(summaryOnly).
 * 요약에 없는 답(다른 문장, 취향, 피하고 싶은 것, 더 쓰고 싶은 곳)이 하나라도 섞인 설명을 앞에 둔다(fresh).
 * 각 묶음 안에서는 만든 순서를 그대로 두고, 중요도나 점수로 순서를 매기지 않는다.
 */
export function splitV31InsightsBySummary(insights: readonly V31Insight[], summaryIds: readonly string[]): { fresh: V31Insight[]; summaryOnly: V31Insight[] } {
  const onlySummary = (insight: V31Insight) => insight.evidence.length > 0 && insight.evidence.every((item) => summaryIds.includes(item.id));
  return { fresh: insights.filter((insight) => !onlySummary(insight)), summaryOnly: insights.filter(onlySummary) };
}
export function buildV31Profile(input: V31Draft): V31Profile {
  const draft = normalizeV31Draft(input);
  const insights = buildInsights(draft);
  const topics = WEDDING_CODE_V31_TOPICS.map((topic) => ({ key: topic.key, title: topic.title, responses: WEDDING_CODE_V31_QUESTIONS.filter((question) => question.topic === topic.key).map((question) => evidence(draft, question.id)) }));
  const unresolved = WEDDING_CODE_V31_QUESTIONS.filter((question) => !isRating(draft.answers[question.id])).map((question) => evidence(draft, question.id));
  for (const taste of WEDDING_CODE_V31_TASTES) {
    if (draft.tastes[taste.key]?.status !== "answered" && draft.tastes[taste.key]?.status !== "no_preference") unresolved.push(tasteEvidence(draft, taste.key));
  }
  if (draft.avoidances?.status !== "answered" && draft.avoidances?.status !== "no_preference") unresolved.push(avoidanceEvidence(draft));
  if (draft.priorities?.status !== "answered" && draft.priorities?.status !== "no_preference") unresolved.push({ id: "priorities", text: "이번 결혼 준비에서 꼭 지키고 싶은 것", answer: v31ChoiceLabels(draft.priorities, getV31PriorityOptions(draft)).join(" · ") });
  if (draft.spending?.status !== "answered" && draft.spending?.status !== "no_preference") unresolved.push({ id: "spending", text: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳", answer: v31ChoiceLabels(draft.spending, WEDDING_CODE_V31_SPENDING).join(" · ") });
  const avoided = draft.avoidances?.status === "answered" ? draft.avoidances.values : [];
  return {
    ratedCount: WEDDING_CODE_V31_QUESTIONS.filter((question) => isRating(draft.answers[question.id])).length,
    respondedCount: WEDDING_CODE_V31_QUESTIONS.filter((question) => draft.answers[question.id] !== undefined).length + WEDDING_CODE_V31_TASTES.filter((taste) => draft.tastes[taste.key] !== undefined).length + Number(draft.avoidances !== undefined) + Number(draft.priorities !== undefined) + Number(draft.spending !== undefined),
    hasContent: hasV31Content(draft),
    priorityLabels: draft.priorities?.status === "answered" ? v31ChoiceLabels(draft.priorities, getV31PriorityOptions(draft)) : [],
    avoidanceLabels: v31ChoiceLabels(draft.avoidances, WEDDING_CODE_V31_AVOIDANCES),
    avoidanceSteps: avoided.flatMap((value) => {
      const option = WEDDING_CODE_V31_AVOIDANCES.find((item) => item.value === value);
      return option ? [{ value: option.value, label: option.label, nextStep: avoidanceNextStep(draft, option.value) }] : [];
    }),
    priorityGuides: priorityGuides(draft, insights),
    spendingLabels: v31ChoiceLabels(draft.spending, WEDDING_CODE_V31_SPENDING),
    insights,
    tastes: WEDDING_CODE_V31_TASTES.map((taste) => ({ key: taste.key, title: taste.title, labels: v31ChoiceLabels(draft.tastes[taste.key], taste.options), nextStep: tasteNextStep(draft, taste.key) })),
    topics,
    unresolved,
  };
}

/**
 * 상대가 해 주길 바라는 도움 문장. 둘 다 높으면 같은 바람이 아니라 서로에게 바라는 요구 두 개라, 둘이 한꺼번에 힘들 때
 * 누가 먼저 해줄지가 이야기거리가 된다. H3(다음 할 일 같이 정하기)·H4(잠깐 쉬고 다시 이야기하기)는 둘이 같은 방식을
 * 원하는 문장이라 둘 다 높으면 함께 동의한 내용이다.
 */
const REQUEST_IDS: ReadonlySet<V31QuestionId> = new Set<V31QuestionId>(["H1", "H2"]);
function ratingPairKind(first: V31Response | undefined, second: V31Response | undefined, id: V31QuestionId): V31PairItem["kind"] {
  if (!isRating(first) || !isRating(second)) return "unavailable";
  const high = (value: V31Rating) => value >= 4;
  const low = (value: V31Rating) => value <= 2;
  if (high(first) && high(second)) return REQUEST_IDS.has(id) ? "shared_request" : "shared_wish";
  if (low(first) && low(second)) return "shared_distance";
  if ((high(first) && low(second)) || (low(first) && high(second))) return "opposite";
  // 3 대 4, 3 대 5 처럼 한 사람만 '그런 편' 이상이면 중간 응답으로 접지 않는다.
  if (high(first) || high(second)) return "one_sided";
  return Math.abs(first - second) >= 2 ? "degree" : "middle";
}
/**
 * 두 보기를 함께 쓰겠다는 보기는 두 보기를 함께 고른 것으로 펼쳐 겹침을 센다.
 * 사진의 '둘 다 남기고 싶어요'와 장소의 '실내와 야외를 함께 쓰는 곳'이 그렇다. 저장 값과 링크 코드는 그대로고 비교만 바뀐다.
 */
const BOTH_CHOICE_EXPANSION: Partial<Record<V31TasteKey, Readonly<Record<string, readonly string[]>>>> = {
  photo: { both_styles: ["candid", "directed"] },
  venue: { both_spaces: ["indoor", "outdoor"] },
};
function choiceValues(choice: V31Choice | undefined, tasteKey?: V31TasteKey): string[] {
  if (choice?.status !== "answered") return [];
  const expansion = tasteKey ? BOTH_CHOICE_EXPANSION[tasteKey] : undefined;
  if (!expansion) return choice.values;
  return [...new Set(choice.values.flatMap((value) => expansion[value] ?? [value]))];
}
function choicePairKind(first: V31Choice | undefined, second: V31Choice | undefined, context: "taste" | "spending" | "avoidances" | "priorities" = "taste", tasteKey?: V31TasteKey): V31PairItem["kind"] {
  const explicit = (choice: V31Choice | undefined) => choice?.status === "answered" || choice?.status === "no_preference";
  if (!explicit(first) || !explicit(second)) return "unavailable";
  if (first?.status === "no_preference" && second?.status === "no_preference") return context === "taste" ? "open_preference" : "middle";
  // 한 사람만 '어느 것이든 괜찮아요'·'따로 없어요'면 반대 의견이 아니라 열어 둔 답이다. 취향·회피·지출·우선순위를 같게 다룬다.
  if (first?.status === "no_preference" || second?.status === "no_preference") return "open_preference";
  if (first?.status !== "answered" || second?.status !== "answered") return "unavailable";
  const firstValues = choiceValues(first, tasteKey);
  const secondValues = choiceValues(second, tasteKey);
  if (firstValues.length === secondValues.length && firstValues.every((value) => secondValues.includes(value))) return context === "avoidances" ? "shared_avoidance" : "shared_wish";
  // 우선순위는 같은 항목을 골라도 그 안의 취향이 다를 수 있어 보기 단위 겹침으로 나누지 않는다.
  if (context !== "priorities" && firstValues.some((value) => secondValues.includes(value))) return "partial_overlap";
  return "different";
}
function choiceOverlap(first: V31Choice | undefined, second: V31Choice | undefined, options: readonly V31Option[], tasteKey?: V31TasteKey): Pick<V31PairItem, "sharedLabels" | "firstOnlyLabels" | "secondOnlyLabels"> {
  const firstValues = choiceValues(first, tasteKey);
  const secondValues = choiceValues(second, tasteKey);
  const labels = (keep: (value: string) => boolean) => options.filter((option) => keep(option.value)).map((option) => option.label);
  if (first?.status !== "answered" || second?.status !== "answered") return { sharedLabels: [], firstOnlyLabels: [], secondOnlyLabels: [] };
  return {
    sharedLabels: labels((value) => firstValues.includes(value) && secondValues.includes(value)),
    firstOnlyLabels: labels((value) => firstValues.includes(value) && !secondValues.includes(value)),
    secondOnlyLabels: labels((value) => !firstValues.includes(value) && secondValues.includes(value)),
  };
}
const TASTE_FOLLOW_UP: Record<V31TasteKey, string> = {
  venue: "각자 원하는 공간의 후보와 꼭 필요한 조건을 말해 보고, 함께 골라 보세요.",
  photo: "각자 남기고 싶은 장면을 골라 보고, 함께 담을 수 있는지 살펴보세요.",
  attire: "각자 입고 싶은 옷을 고르고, 함께 맞추고 싶은 부분만 의논해 보세요.",
  meal: "원하는 식사 방식의 후보를 살펴보고, 알레르기나 먹지 못하는 음식이 있는 분이 있는지도 확인해 보세요.",
  guests: "이 답은 바라는 규모예요. 각자 꼭 부르고 싶은 사람을 먼저 적고 가족이 초대할 분까지 합쳐 센 뒤, 장소의 수용 인원과 맞춰 보세요.",
  ceremony: "각자 넣고 싶은 순서를 고르고, 전체 길이와 진행 방법을 함께 정해 보세요.",
};
const NEUTRAL_FOLLOW_UP: Record<V31QuestionId, string> = {
  V1: "공간의 장식은 어느 정도면 좋을까요? 각자 마음에 드는 공간 사진을 보며 이야기해 보세요.",
  G1: "초대할 사람은 어떤 기준으로 정하고 싶은가요? 각자 떠오르는 사람부터 말해 보세요.",
  G2: "자주 만나지 못했던 지인을 초대할지는 어떤 기준으로 정하면 좋을까요?",
  G3: "장소를 고를 때 이동 시간과 다른 조건을 어떻게 함께 볼까요?",
  R3: "예식에 입고 싶은 옷 사진을 각자 골라 보고, 마음에 드는 부분을 이야기해 보세요.",
  R4: "옷을 고를 때 가장 먼저 확인하고 싶은 것은 무엇인가요? 각자 말해 보세요.",
  B1: "전체 예산을 그대로 지키고 싶은 때와 다시 의논하고 싶은 때는 각각 언제인가요?",
  B2: "항목 사이에 비용을 옮기고 싶은가요? 옮긴다면 어떤 조건이면 괜찮을까요?",
  B3: "어떤 상황이면 전체 예산을 다시 의논할 수 있을까요? 각자 생각을 나눠 보세요.",
  B4: "항목별 금액은 언제, 어느 정도까지 정해 둘까요?",
  D1: "후보를 더 비교하고 싶은 때와 비교를 끝내고 싶은 때는 각각 언제인가요?",
  D2: "어떤 조건이 맞으면 선택할 수 있을까요? 더 확인할 것도 있나요?",
  D3: "예식 장소를 고르기 전에 무엇을 어떤 방식으로 확인하고 싶은지 이야기해 보세요.",
  T1: "같은 시간에 함께 찾아볼 일과 각자 알아볼 일을 어떻게 나누면 편할까요?",
  T2: "맡아서 정해도 되는 세부 내용과 함께 선택할 내용을 각각 이야기해 보세요.",
  T3: "진행 상황을 어느 시점에 어떤 방식으로 나누면 편할지 이야기해 보세요.",
  T4: "담당을 언제 정하고, 하던 일이 어려워지면 어떻게 다시 나눌지 이야기해 보세요.",
  F1: "가족의 의견은 언제, 어떤 내용부터 들어 보면 좋을까요?",
  F2: "가족과 상의할 내용과 마지막에 결정할 사람을 어떻게 정할지 이야기해 보세요.",
  F3: "둘이 생각을 맞추는 일과 가족에게 의견을 묻는 일의 순서를 이야기해 보세요.",
  F4: "가족과 상의할 때 누가 대화를 시작하고 누가 함께하면 좋을지 이야기해 보세요.",
  H1: "준비가 힘들다고 말할 때 어떤 반응이 먼저 필요할지 각각 이야기해 보세요.",
  H2: "할 일이 몰릴 때 받고 싶은 도움과 직접 마무리하고 싶은 일을 이야기해 보세요.",
  H3: "무엇부터 할지 막힐 때 어떤 도움이 필요한지 각각 이야기해 보세요.",
  H4: "의견이 부딪힌 뒤 언제, 어떻게 다시 이야기하면 편할지 정해 보세요.",
};
/** 둘 다 바라는 도움은 서로에게 바라는 요구라, 둘이 한꺼번에 힘들 때 누가 먼저 해줄지를 묻는다. */
const SHARED_REQUEST_FOLLOW_UP: Partial<Record<V31QuestionId, string>> = {
  H1: "둘이 한꺼번에 지쳤을 때는 누가 먼저 이야기를 들어줄 수 있을까요? 들어줄 여유가 없는 날은 어떻게 알릴지도 정해 보세요.",
  H2: "둘 다 일이 몰렸을 때는 누가 먼저 일을 나눠 받을 수 있을까요? 지금 넘길 수 있는 일부터 하나씩 적어 보세요.",
};
function questionFollowUp(question: V31Question, kind: V31PairItem["kind"]): string {
  if (kind === "unavailable") return "아직 모르거나 해당하지 않거나 답하지 않은 내용은 차이로 보지 않아요. 이 이야기가 지금 필요한지부터 확인해 보세요.";
  if (kind === "shared_distance") return `이 문장에는 두 사람 모두 ‘그렇지 않은 편이에요’나 ‘전혀 그렇지 않아요’로 답했어요. ${NEUTRAL_FOLLOW_UP[question.id]}`;
  if (kind === "shared_request") return SHARED_REQUEST_FOLLOW_UP[question.id] ?? `${question.followUp} 둘 다 바라는 것이라 누가 먼저 해줄 수 있을지도 이야기해 보세요.`;
  const followUp = kind === "shared_wish" ? question.followUp : NEUTRAL_FOLLOW_UP[question.id];
  // 둘이 같은 방식을 원한다고 답한 도움(H3·H4 함께 동의)에는 서로 해줄 여유를 묻지 않는다.
  return question.topic === "support" && kind !== "shared_wish" ? `${followUp} 서로 어떻게, 얼마나 맞춰 줄 수 있는지도 말해 보세요.` : followUp;
}
function choiceFollowUp(kind: V31PairItem["kind"], followUp: string, context?: "priorities"): string {
  // 우선순위 화면에는 ‘해당하지 않아요’·‘지금 답하지 않을게요’·‘맞는 보기가 없어요’ 버튼이 없다. 누르지 않은 버튼 이름을 인용하지 않고 그 화면의 이름을 쓴다.
  if (kind === "unavailable" && context === "priorities") return `‘${V31_PRIORITY_UNDECIDED_LABEL}’와 ‘${V31_PRIORITY_SKIPPED_LABEL}’는 서로 다른 답이에요. 말하고 싶은 사람은 보기에 없던 생각을 들려주면 돼요. 비교할 답이 없을 뿐, 의견이 다르다고 보지는 않아요.`;
  if (kind === "unavailable") return "‘아직 모르겠어요’, ‘해당하지 않아요’, ‘지금 답하지 않을게요’, ‘맞는 보기가 없어요’는 서로 다른 답이에요. 말하고 싶은 사람은 보기에 없던 생각을 들려주면 돼요. 비교할 답이 없을 뿐, 의견이 다르다고 보지는 않아요.";
  if (kind === "middle") return "두 사람 모두 꼭 지키고 싶은 것을 따로 고르지 않았어요. 실제 후보를 보다가 놓치기 싫은 게 생기면 그때 이야기해 보세요.";
  // 열린 답을 합의나 모름으로 읽지 않게 하는 것은 문장이 아니라 배치가 맡는다(‘열어 두고 있는 답’ 묶음, 모름은 따로 접는 묶음).
  if (kind === "open_preference") return "구체적으로 고른 것이 있다면 그것부터 함께 살펴보세요.";
  return followUp;
}
const SPENDING_FOLLOW_UP = {
  // 둘 다 더 쓸 곳을 골랐을 때는 '지금은 없음' 이야기를 꺼내지 않는다.
  answered: "더 쓰고 싶은 곳마다 대신 줄일 수 있는 곳과 실제 금액을 함께 정해 보세요. 전체 예산을 늘릴지는 따로 정해요.",
  // 한쪽만 '지금 없음'이면 차이 묶음이 아니라 열린 답 묶음에 둔다. 반대 의견으로 읽지 않게 하는 것은 그 배치가 맡는다.
  open: "고른 사람은 어떤 점이 좋아서 더 쓰고 싶은지, 다른 사람은 그 부분을 어떻게 보는지 서로 들어 보고, 대신 줄일 곳과 실제 금액을 함께 정해 보세요. 전체 예산을 늘릴지는 따로 정해요.",
  middle: "두 사람 모두 지금은 더 쓰고 싶은 곳이 없다고 답했어요. 실제 견적을 보고 생각이 바뀌면 다시 이야기해 보세요.",
} as const;
const AVOIDANCE_FOLLOW_UP: Partial<Record<V31PairItem["kind"], string>> = {
  middle: "두 사람 모두 지금은 따로 피하고 싶은 것이 없다고 답했어요. 실제 공간이나 순서를 보다가 불편한 점이 생기면 이야기해 보세요.",
  open_preference: "한 사람은 따로 피하고 싶은 것이 없다고 했어요. 고른 사람은 어떤 장면이 부담스러운지, 없다고 한 사람은 어떻게 보는지 서로 들어 보세요.",
  shared_avoidance: "실제 공간이나 순서를 볼 때 각자 어떤 점이 가장 신경 쓰이는지, 어떻게 하면 편할지 이야기해 보세요.",
  partial_overlap: "둘 다 고른 것은 후보를 볼 때 먼저 확인하고, 한 사람만 고른 것은 어떤 장면이 부담스러운지와 어떻게 하면 편할지 들어 보세요.",
  // 판정 고지는 결과 머리글에서 한 번만 한다. 고르지 않은 쪽을 그 방식을 원하는 사람으로 읽지 않게, 물어볼 일로 적는다.
  different: "각자 어떤 장면이 부담스러운지와 어떻게 하면 편할지 이야기해 보세요. 고르지 않은 쪽에게는 그 방식이 괜찮은지 따로 물어보세요.",
};
export function compareV31(firstInput: V31Draft, secondInput: V31Draft): V31PairItem[] {
  const first = normalizeV31Draft(firstInput);
  const second = normalizeV31Draft(secondInput);
  const priorities = new Set([...(first.priorities?.status === "answered" ? first.priorities.values : []), ...(second.priorities?.status === "answered" ? second.priorities.values : [])]);
  // 결과 화면은 묶음마다 ‘질문 순서대로’ 둔다고 말한다. 저장 자리 순서가 아니라 화면에서 묻는 순서로 만든다:
  // 기본 문장 → 선택 문장 → (예전 흐름에만 있던 두 문장), 그 뒤 취향 → 피하고 싶은 것 → 더 쓰고 싶은 곳 → 우선순위.
  const ratingOrder: readonly V31QuestionId[] = [...V31_CORE_RATING_IDS, ...V31_EXTRA_RATING_IDS, ...V31_LEGACY_ONLY_RATING_IDS];
  const questions = ratingOrder.map((id) => WEDDING_CODE_V31_QUESTIONS.find((question) => question.id === id)!);
  // 하객 없이 둘만 하는 예식이라는 안내는 하객 주제의 첫 문장 카드에만 붙인다(하객 문장마다 같은 안내가 글자 그대로 되풀이되지 않게).
  let noGuestNoteGiven = false;
  const items: V31PairItem[] = questions.map((question) => {
    const kind = ratingPairKind(first.answers[question.id], second.answers[question.id], question.id);
    const noGuestNote = !noGuestNoteGiven && question.topic === "guests" && kind !== "unavailable" && (wantsNoGuests(first) || wantsNoGuests(second));
    if (noGuestNote) noGuestNoteGiven = true;
    return {
      id: question.id, title: question.statement,
      first: v31ResponseLabel(first.answers[question.id]), second: v31ResponseLabel(second.answers[question.id]),
      kind, followUp: noGuestNote
        ? "하객 없이 둘만 하는 예식이라는 답도 있어요. 이 문장과 하객 규모에 답할 때 각각 어떤 상황을 떠올렸는지 먼저 이야기해 보세요."
        : questionFollowUp(question, kind), isPriority: priorities.has(question.id),
    };
  });
  for (const taste of WEDDING_CODE_V31_TASTES) {
    const kind = choicePairKind(first.tastes[taste.key], second.tastes[taste.key], "taste", taste.key);
    const followUp = taste.key === "guests" && (wantsNoGuests(first) || wantsNoGuests(second))
      ? wantsNoGuests(first) && wantsNoGuests(second)
        ? "둘만 하는 예식에서 남기고 싶은 순간과 진행 순서를 이야기해 보세요. 후보 장소에서 둘만의 예식이 가능한지도 확인해 보세요."
        : "한 사람은 하객 없이 둘만 하는 예식을 골랐어요. 각자 떠올린 예식의 모습을 이야기하고, 초대 여부와 규모부터 맞춰 보세요."
      : taste.key === "ceremony" && [first, second].some(person => wantsNoGuests(person) && person.tastes.ceremony?.status === "answered" && person.tastes.ceremony.values.includes("participatory"))
        ? "하객 없이 둘만 하는 예식과 하객 참여 순서를 함께 고른 답이 있어요. 서로 다른 날이나 상황을 떠올린 것인지 먼저 이야기해 보세요. 두 답 모두 그대로 둬도 괜찮아요."
        : TASTE_FOLLOW_UP[taste.key];
    items.push({
      id: `taste.${taste.key}`, title: taste.question,
      first: v31ChoiceLabels(first.tastes[taste.key], taste.options).join(" · "), second: v31ChoiceLabels(second.tastes[taste.key], taste.options).join(" · "),
      kind, followUp: choiceFollowUp(kind, followUp), isPriority: priorities.has(`taste.${taste.key}`),
      ...choiceOverlap(first.tastes[taste.key], second.tastes[taste.key], taste.options, taste.key),
    });
  }
  const firstPriorityLabels = v31ChoiceLabels(first.priorities, getV31PriorityOptions(first));
  const secondPriorityLabels = v31ChoiceLabels(second.priorities, getV31PriorityOptions(second));
  const priorityKind = choicePairKind(first.priorities, second.priorities, "priorities");
  const selectedTastePriorities = first.priorities?.status === "answered" ? first.priorities.values.filter((value) => value.startsWith("taste.")) : [];
  const samePriorityTastes = selectedTastePriorities.every((id) => {
    const key = TASTE_KEYS.find((taste) => `taste.${taste}` === id);
    return key !== undefined && choicePairKind(first.tastes[key], second.tastes[key], "taste", key) === "shared_wish";
  });
  const resolvedPriorityKind = priorityKind === "shared_wish" && !samePriorityTastes ? "different" : priorityKind;
  const spendingKind = choicePairKind(first.spending, second.spending, "spending");
  const avoidanceKind = choicePairKind(first.avoidances, second.avoidances, "avoidances");
  items.push({
    id: "avoidances", title: "결혼식에서 피하고 싶은 것",
    first: v31ChoiceLabels(first.avoidances, WEDDING_CODE_V31_AVOIDANCES).join(" · "), second: v31ChoiceLabels(second.avoidances, WEDDING_CODE_V31_AVOIDANCES).join(" · "),
    kind: avoidanceKind, isPriority: [...priorities].some((id) => id.startsWith("avoid.")),
    ...choiceOverlap(first.avoidances, second.avoidances, WEDDING_CODE_V31_AVOIDANCES),
    followUp: AVOIDANCE_FOLLOW_UP[avoidanceKind] ?? choiceFollowUp(avoidanceKind, AVOIDANCE_FOLLOW_UP.different!),
  });
  // 기본 흐름은 더 쓰고 싶은 곳을 묻고 나서 마지막에 우선순위를 묻는다. 화면 순서와 같게 지출을 먼저 둔다.
  items.push({
    id: "spending", title: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳",
    first: v31ChoiceLabels(first.spending, WEDDING_CODE_V31_SPENDING).join(" · "), second: v31ChoiceLabels(second.spending, WEDDING_CODE_V31_SPENDING).join(" · "),
    kind: spendingKind, isPriority: false,
    ...choiceOverlap(first.spending, second.spending, WEDDING_CODE_V31_SPENDING),
    // '지금은 없음' 문장은 한쪽이 없음으로 답했을 때만 쓴다.
    followUp: spendingKind === "middle" ? SPENDING_FOLLOW_UP.middle
      : spendingKind === "open_preference" ? SPENDING_FOLLOW_UP.open
        : choiceFollowUp(spendingKind, SPENDING_FOLLOW_UP.answered),
  }, {
    id: "priorities", title: "이번 결혼 준비에서 꼭 지키고 싶은 것",
    first: firstPriorityLabels.join(" · "), second: secondPriorityLabels.join(" · "),
    kind: resolvedPriorityKind, isPriority: false,
    followUp: resolvedPriorityKind === "open_preference"
      ? "한 사람은 꼭 지키고 싶은 게 따로 없다고 했어요. 고른 사람은 그 기준을 지키고 싶은 마음을, 없다고 한 사람은 어떻게 생각하는지 서로 들어 보세요."
      : choiceFollowUp(resolvedPriorityKind, "각자 고른 기준을 왜 지키고 싶은지 이야기해 보세요. 적힌 순서는 고른 순서예요.", "priorities"),
  });
  // 종류 안에서는 한 사람이라도 우선순위로 고른 항목을 먼저, 나머지는 질문 순서대로 둔다(안정 정렬).
  return items.sort((a, b) => Number(b.isPriority) - Number(a.isPriority));
}
