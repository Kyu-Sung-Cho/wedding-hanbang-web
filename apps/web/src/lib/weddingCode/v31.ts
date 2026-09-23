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

export type V31Evidence = { id: string; text: string; answer: string };
export type V31Insight = { id: string; title: string; body: string; evidence: V31Evidence[]; nextStep: string };
export type V31Profile = {
  ratedCount: number;
  respondedCount: number;
  hasContent: boolean;
  priorityLabels: string[];
  avoidanceLabels: string[];
  priorityGuides: V31Insight[];
  spendingLabels: string[];
  insights: V31Insight[];
  tastes: { key: V31TasteKey; title: string; labels: string[] }[];
  topics: { key: V31Topic; title: string; responses: V31Evidence[] }[];
  unresolved: V31Evidence[];
};
export type V31PairItem = {
  id: string;
  title: string;
  first: string;
  second: string;
  kind: "shared_wish" | "shared_avoidance" | "shared_distance" | "middle" | "open_preference" | "different" | "unavailable";
  followUp: string;
  isPriority: boolean;
  sharedLabels?: string[];
};

const STATUS_LABELS = {
  undecided: "아직 모르겠어요",
  not_applicable: "이번 계획에는 없어요",
  skipped: "지금 답하지 않을게요",
  no_preference: "어느 쪽도 괜찮아요",
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
      .map((option) => ({ value: `avoid.${option.value}`, label: `피하기: ${option.label}` })),
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
export function v31ChoiceLabels(choice: V31Choice | undefined, options: readonly V31Option[]): string[] {
  if (!choice) return ["아직 보지 않은 질문이에요"];
  if (choice.status === "no_preference") {
    if (options.length === WEDDING_CODE_V31_AVOIDANCES.length && options.every((option) => WEDDING_CODE_V31_AVOIDANCES.some((avoidance) => avoidance.value === option.value))) return ["따로 피하고 싶은 것은 없어요"];
    if (options.length === WEDDING_CODE_V31_SPENDING.length && options.every((option) => WEDDING_CODE_V31_SPENDING.some((spending) => spending.value === option.value))) return ["더 쓰고 싶은 곳은 지금 없어요"];
    if (options.every((option) => PRIORITY_IDS.includes(option.value))) return ["특히 지킬 것을 따로 고르지 않을게요"];
  }
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
export function decodeV31(code: string | null | undefined): V31Draft | null {
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
  return validDraft(draft) && hasV31Content(draft) ? draft : null;
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
const SINGLE_READINGS: Record<V31QuestionId, { title: string; body: string; nextStep: string }> = {
  V1: { title: "꽃 장식이 있는 장면을 떠올리고 있어요", body: "꽃이 풍성한 공간에서 식을 올리고 싶다고 답했어요. 좋아하는 꽃의 종류나 장식의 양까지 정한 것은 아니에요.", nextStep: "마음에 드는 공간 사진에서 꽃을 꼭 두고 싶은 곳을 짚어보세요. 기본 장식과 추가 장식의 비용도 나눠 확인해 보세요." },
  G1: { title: "초대할 때 가까운 관계를 먼저 생각해요", body: "평소 가깝게 지내는 사람 위주로 초대하고 싶다고 답했어요. 가까운 사람이 몇 명인지는 사람마다 다르니, 작은 결혼식을 원한다는 뜻으로 읽지는 않아요.", nextStep: "꼭 함께하고 싶은 사람부터 적어보세요. 두 사람의 명단을 합친 뒤 원하는 장소에 들어갈 수 있는지 확인해 보세요." },
  G2: { title: "자주 못 만났던 사람도 함께했으면 해요", body: "자주 만나지 못했던 지인도 초대하고 싶다고 답했어요. 만나는 횟수와 관계의 가까움은 다를 수 있어요.", nextStep: "생각나는 사람을 적고, 어떤 방식으로 소식을 전할지 정해 보세요." },
  G3: { title: "하객이 오는 길을 먼저 살펴보고 싶어요", body: "장소를 고를 때 하객의 이동 시간을 먼저 보고 싶다고 답했어요. 이동 시간 외에 어떤 조건도 필요한지는 따로 확인하면 좋아요.", nextStep: "하객이 주로 오는 지역에서 후보 장소까지 걸리는 시간을 비교해 보세요. 대중교통, 주차, 이동에 도움이 필요한 사람도 함께 살펴보세요." },
  R3: { title: "그날은 평소보다 눈에 띄는 옷을 원해요", body: "예식에는 평소와 다르게 눈에 띄는 옷을 입고 싶다고 답했어요. 화려한 장식을 원한다는 뜻으로 한정하지 않아요.", nextStep: "원하는 옷 사진에서 색, 모양, 소재 중 어떤 점이 좋은지 짚어보세요." },
  R4: { title: "예식 옷은 움직임부터 확인하고 싶어요", body: "옷을 고를 때 움직이기 편한지를 먼저 살펴보고 싶다고 답했어요.", nextStep: "입어볼 때 앉기, 걷기, 팔 들기를 해보세요. 당일 옷을 입고 있어야 할 시간도 함께 생각해 보세요." },
  B1: { title: "처음 정한 전체 예산을 지키고 싶어요", body: "새로 마음에 드는 것이 생겨도 처음 정한 전체 예산 안에서 준비하고 싶다고 답했어요. 이 질문에서는 실제 예산 금액을 묻지 않았어요.", nextStep: "둘이 쓸 수 있는 전체 금액을 먼저 확인하고, 견적에 포함된 비용과 나중에 붙는 비용을 합쳐 비교해 보세요." },
  B2: { title: "더 원하는 곳에는 다른 비용을 줄여 쓰고 싶어요", body: "꼭 하고 싶은 항목에는 다른 항목의 비용을 줄여서라도 더 쓰고 싶다고 답했어요. 전체 예산을 늘리겠다는 뜻은 아니에요.", nextStep: "더 쓰고 싶은 곳과 줄여도 되는 곳을 하나씩 고르고, 실제 견적에서 옮길 수 있는 금액을 확인해 보세요." },
  B3: { title: "새로 원하는 것이 생기면 예산도 다시 의논하고 싶어요", body: "하고 싶은 것이 늘어나면 전체 예산을 늘릴지도 의논하고 싶다고 답했어요. 예산을 늘리는 데 미리 동의한 것은 아니에요.", nextStep: "어떤 경우에 예산을 다시 이야기할지 정해 보세요. 늘리는 금액과 부담할 방법은 그때 따로 확인해야 해요." },
  B4: { title: "처음부터 항목별 금액을 나눠두고 싶어요", body: "준비를 시작할 때 각 항목에 쓸 금액을 미리 정하고 싶다고 답했어요.", nextStep: "장소, 식사, 촬영, 옷처럼 준비할 항목을 적고 각각의 한도를 정해 보세요. 견적을 받은 뒤 다시 볼 시점도 정해 두면 좋아요." },
  D1: { title: "마음을 정하기 전에 다른 후보도 보고 싶어요", body: "마음에 드는 후보가 있어도 최종 선택 전에는 더 비교해 보고 싶다고 답했어요.", nextStep: "비교할 조건과 살펴볼 후보 수를 먼저 정해 보세요. 각 후보의 같은 항목을 놓고 비교하면 차이를 보기 쉬워요." },
  D2: { title: "정한 조건에 맞으면 선택하고 싶어요", body: "미리 정해 둔 조건에 맞는 후보가 있으면 그때 선택하고 싶다고 답했어요.", nextStep: "꼭 맞아야 하는 조건과 달라도 괜찮은 조건을 나눠 적어보세요. 결정 전에 확인할 계약 내용은 따로 챙겨보세요." },
  D3: { title: "장소는 직접 보고 고르고 싶어요", body: "예식장을 둘러본 다음 선택하고 싶다고 답했어요. 실제로 방문할 수 있는지는 일정과 장소에 따라 달라요.", nextStep: "방문할 수 있는 날짜를 확인하고, 예식 공간·대기 공간·식사 공간에서 보고 싶은 점을 적어가세요." },
  T1: { title: "알아보는 시간도 둘이 함께 보내고 싶어요", body: "업체를 찾을 때 시간을 맞춰 같이 알아보고 싶다고 답했어요.", nextStep: "이번 주에 함께 볼 항목 하나와 시간을 정해 보세요. 각자 먼저 알아올 내용이 있는지도 나눠보세요." },
  T2: { title: "일부 세부 선택은 맡은 사람이 정해도 괜찮아요", body: "계약이나 추가 결제가 없는 세부 선택은 담당자가 정해도 괜찮다고 답했어요. 모든 결정권을 맡긴다는 뜻은 아니에요.", nextStep: "혼자 정해도 되는 일의 예를 하나씩 들고, 함께 확인해야 할 선택은 따로 적어보세요." },
  T3: { title: "따로 맡은 일도 중간에 소식을 나누고 싶어요", body: "각자 맡은 일이 어디까지 진행됐는지 중간에 알려주면 좋겠다고 답했어요.", nextStep: "매번 알려줄지, 정한 시간에 모아서 이야기할지 맞춰보세요. 서로에게 편한 방법을 확인하는 게 먼저예요." },
  T4: { title: "시작 전에 누가 맡을지 정하고 싶어요", body: "일을 시작하기 전에 담당을 정해 두고 싶다고 답했어요.", nextStep: "다음에 할 일마다 담당과 마칠 시점을 정해 보세요. 맡은 일이 버거워지면 다시 나누기로 약속해도 좋아요." },
  F1: { title: "가족의 바람은 초반에 들어보고 싶어요", body: "준비를 많이 진행하기 전에 가족이 바라는 점을 들어보고 싶다고 답했어요. 들은 의견을 모두 따르겠다는 뜻은 아니에요.", nextStep: "가족에게 먼저 여쭤볼 내용을 정리해 보세요. 아직 결정하지 않은 것과 이미 둘이 정한 것을 나눠 말하면 좋아요." },
  F2: { title: "의견이 달라도 마지막 선택은 둘이 하고 싶어요", body: "가족과 생각이 다를 때도 최종 선택은 두 사람이 하고 싶다고 답했어요.", nextStep: "가족에게 의견을 구할 내용과 둘이 결정할 내용을 나눠보세요. 다른 의견을 들었을 때 어떻게 설명할지도 함께 생각해 보세요." },
  F3: { title: "가족에게 묻기 전에 둘의 생각부터 맞추고 싶어요", body: "가족과 상의하기 전에 두 사람의 생각을 먼저 정리하고 싶다고 답했어요.", nextStep: "서로 원하는 것과 아직 정하지 못한 것을 적어보세요. 둘이 같은 말로 설명할 수 있는지 확인해 보세요." },
  F4: { title: "각자 자기 가족에게 먼저 이야기하면 좋겠어요", body: "가족과 상의할 일은 각자 자기 쪽 가족에게 먼저 말하면 좋겠다고 답했어요.", nextStep: "먼저 대화할 사람과 전할 내용을 정하고, 둘이 함께 이야기할 필요가 있는 경우도 나눠보세요." },
  H1: { title: "힘들다고 말할 때는 이야기를 먼저 들어주길 바라요", body: "해결책을 말하기 전에 내 이야기를 들어주면 좋겠다고 답했어요. 해결책이 필요 없다는 뜻은 아니에요.", nextStep: "지금은 들어주면 좋은지, 함께 해결해 주면 좋은지를 말해 보세요. 상대가 필요로 하는 반응도 물어보세요." },
  H2: { title: "일이 몰리면 일부를 나눠 맡아주길 바라요", body: "할 일이 많을 때 상대가 일부를 맡아주면 좋겠다고 답했어요. 상대가 도울 시간과 여유가 있다는 뜻은 아니에요.", nextStep: "지금 넘길 수 있는 일 하나를 골라 부탁해 보세요. 상대가 맡을 수 있는 범위와 마칠 시점을 함께 확인해 보세요." },
  H3: { title: "막힐 때는 다음 한 가지를 같이 정하고 싶어요", body: "무엇부터 해야 할지 모르겠을 때 상대와 다음에 할 일을 하나씩 정하고 싶다고 답했어요.", nextStep: "지금 막힌 일을 말하고, 바로 할 수 있는 한 가지부터 같이 골라보세요. 누가 맡을지는 그다음에 정해도 괜찮아요." },
  H4: { title: "의견이 부딪히면 잠깐 쉬고 다시 말하고 싶어요", body: "의견이 부딪힌 직후에는 잠시 쉬었다 이야기하고 싶다고 답했어요. 대화를 끝내고 싶다는 뜻은 아니에요.", nextStep: "쉬고 싶다는 말과 다시 이야기할 시점을 함께 정해 두세요. 쉬는 시간이 상대에게 어떻게 느껴지는지도 들어보세요." },
};
const AVOIDANCE_NEXT_STEPS: Record<string, string> = {
  heavy_decoration: "좋아하는 장식 사진과 부담스러운 사진을 나란히 놓고, 장식의 양과 위치를 짚어보세요.",
  crowded_space: "예상 인원이 들어왔을 때의 좌석 간격과 이동 동선을 확인해 보세요. 하객 수만으로 붐비는 정도를 정하지는 않아요.",
  long_photography: "촬영에 쓸 수 있는 시간을 정하고, 꼭 남길 장면부터 촬영 담당자와 이야기해 보세요.",
  stage_participation: "하객이 자리에서 함께하는 순서와 무대에 올라오는 순서를 나눠 보고, 원하지 않는 방식은 진행자에게 미리 알려 주세요.",
  loud_music: "실제 공간에서 음악 크기를 확인하고, 조절을 부탁할 사람과 방법을 정해 보세요.",
};
function directTasteInsight(draft: V31Draft, key: V31TasteKey): V31Insight | null {
  const taste = WEDDING_CODE_V31_TASTES.find((item) => item.key === key)!;
  const choice = draft.tastes[key];
  if (choice?.status !== "answered") return null;
  const labels = v31ChoiceLabels(choice, taste.options).join(" · ");
  let nextStep = TASTE_FOLLOW_UP[key];
  if (key === "venue" && choice.values.some((value) => value === "outdoor" || value === "both_spaces")) nextStep = "마음에 드는 야외 공간과 비가 오거나 날씨가 더울 때 사용할 공간을 함께 확인해 보세요.";
  if (key === "photo" && choice.values.includes("both_styles")) nextStep = "자연스럽게 남길 순간과 미리 준비할 장면을 각각 골라보세요. 어느 쪽에 시간을 더 쓸지는 따로 정해도 괜찮아요.";
  return { id: `direct-${key}`, title: `내가 원하는 ${taste.title}`, body: `앞에서 ‘${labels}’ 보기를 골랐어요. 실제 후보를 볼 때 이 답을 출발점으로 써 보세요.`, evidence: [tasteEvidence(draft, key)], nextStep };
}
function priorityGuides(draft: V31Draft): V31Insight[] {
  if (draft.priorities?.status !== "answered") return [];
  return draft.priorities.values.flatMap((id): V31Insight[] => {
    const question = WEDDING_CODE_V31_QUESTIONS.find((item) => item.id === id);
    const confirmation: V31Evidence = { id: "priorities", text: "이번 결혼식에서 특히 지키고 싶은 것", answer: getV31PriorityOptions(draft).find((option) => option.value === id)?.label ?? "" };
    if (question) return [{ id: `priority-${id}`, ...SINGLE_READINGS[question.id], evidence: [evidence(draft, question.id), confirmation] }];
    const taste = WEDDING_CODE_V31_TASTES.find((item) => `taste.${item.key}` === id);
    if (taste) {
      const insight = directTasteInsight(draft, taste.key);
      return insight ? [{ ...insight, id: `priority-${id}`, evidence: [...insight.evidence, confirmation] }] : [];
    }
    const avoid = WEDDING_CODE_V31_AVOIDANCES.find((option) => `avoid.${option.value}` === id);
    return avoid ? [{ id: `priority-${id}`, title: `피하고 싶은 것: ${avoid.label}`, body: "피하고 싶은 것 중에서도 특히 지키고 싶은 기준으로 골랐어요. 어디까지 괜찮은지는 실제 후보를 보며 정해 보세요.", evidence: [avoidanceEvidence(draft), confirmation], nextStep: AVOIDANCE_NEXT_STEPS[avoid.value] }] : [];
  });
}
const COMBINATIONS: readonly { id: string; items: readonly V31QuestionId[]; title: string; body: string; nextStep: string }[] = [
  { id: "attire-comfort", items: ["R3", "R4"], title: "눈에 띄는 옷도 편하게 입고 싶어요", body: "평소보다 눈에 띄는 옷을 원하면서, 움직이기 편한지도 먼저 보고 싶어 해요.", nextStep: "마음에 드는 옷을 입고 앉거나 걸어보며 편한지 확인해 보세요." },
  { id: "budget-reallocate", items: ["B1", "B2"], title: "예산 안에서 원하는 항목에 더 쓰고 싶어요", body: "전체 예산은 지키면서, 꼭 하고 싶은 항목에는 다른 비용을 줄여 더 쓰고 싶어 해요.", nextStep: "더 쓰고 싶은 한 항목과 줄여도 되는 한 항목을 직접 정해 보세요." },
  { id: "budget-revisit", items: ["B1", "B3"], title: "예산을 다시 이야기할 경우도 정해 두면 좋겠어요", body: "정한 총액을 지키고 싶지만, 새로 원하는 것이 생기면 예산을 늘릴지도 의논하고 싶다고 답했어요.", nextStep: "어떤 경우에만 총액을 다시 의논할지 함께 정해 보세요. 예산을 늘리는 데 동의했다는 뜻은 아니에요." },
  { id: "decision-conditions", items: ["D1", "D2"], title: "비교를 마칠 기준을 정해 보면 좋겠어요", body: "다른 후보도 보고 싶고, 정한 조건에 맞으면 선택하고 싶다고 답했어요.", nextStep: "어디까지 비교할지, 어떤 조건이면 선택할지 직접 정해 보세요." },
  { id: "delegate-update", items: ["T2", "T3"], title: "세부 선택은 맡기고, 진행 상황은 나누고 싶어요", body: "계약이나 추가 결제가 없는 세부 결정은 맡겨도 괜찮지만, 진행 상황은 함께 알고 싶어 해요.", nextStep: "중간에 알려줄 시점과 반드시 함께 결정할 범위를 나눠보세요." },
  { id: "family-listen-decide", items: ["F1", "F2"], title: "가족의 바람을 듣고, 선택은 둘이 하고 싶어요", body: "가족의 바람은 먼저 듣고, 마지막 선택은 둘이 하고 싶어 해요.", nextStep: "가족과 상의할 내용과 둘이 최종 선택할 내용을 나눠보세요." },
  { id: "support-listen-help", items: ["H1", "H2"], title: "이야기도 들어주고, 일도 나눠주길 바라요", body: "힘들 때는 이야기를 먼저 들어주고, 몰린 일도 나눠주길 바라요.", nextStep: "이야기만 들어주면 되는 때와 일을 나눠주면 좋은 때를 구분해 말해 보세요. 상대가 해줄 수 있는지도 함께 확인해 보세요." },
];

function buildInsights(draft: V31Draft): V31Insight[] {
  const high = (id: V31QuestionId) => isRating(draft.answers[id]) && Number(draft.answers[id]) >= 4;
  const insights: V31Insight[] = COMBINATIONS.filter((rule) => rule.items.every(high)).map((rule) => ({
    id: rule.id, title: rule.title, body: rule.body, nextStep: rule.nextStep, evidence: rule.items.map((id) => evidence(draft, id)),
  }));
  if (high("B1") && draft.spending?.status === "answered") {
    const labels = v31ChoiceLabels(draft.spending, WEDDING_CODE_V31_SPENDING).join(" · ");
    insights.push({
      id: "budget-explicit-spending", title: "전체 예산 안에서 더 쓰고 싶은 곳이 있어요",
      body: `총액은 지키되, ${labels}에 다른 비용을 줄여서라도 더 쓰고 싶다고 직접 골랐어요. 이 질문에서는 실제 금액을 묻지 않았어요.`,
      evidence: [evidence(draft, "B1"), { id: "spending", text: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳", answer: labels }],
      nextStep: "더 쓸 항목과 줄여도 되는 항목의 견적을 같은 총액 안에서 비교해 보세요.",
    });
  }
  const covered = new Set(insights.flatMap((insight) => insight.evidence.map((item) => item.id)));
  for (const question of WEDDING_CODE_V31_QUESTIONS) {
    if (high(question.id) && !covered.has(question.id)) insights.push({ id: `single-${question.id}`, ...SINGLE_READINGS[question.id], evidence: [evidence(draft, question.id)] });
  }
  for (const taste of WEDDING_CODE_V31_TASTES) {
    const insight = directTasteInsight(draft, taste.key);
    if (insight) insights.push(insight);
  }
  if (draft.avoidances?.status === "answered") {
    for (const option of WEDDING_CODE_V31_AVOIDANCES.filter((item) => draft.avoidances?.status === "answered" && draft.avoidances.values.includes(item.value))) {
      insights.push({ id: `avoid-${option.value}`, title: `피하고 싶은 것: ${option.label}`, body: "결혼식에서 피하고 싶은 조건으로 직접 골랐어요. 어떤 정도나 방식이 부담스러운지 실제 예시로 확인해 보세요.", evidence: [avoidanceEvidence(draft)], nextStep: AVOIDANCE_NEXT_STEPS[option.value] });
    }
    if (high("V1") && draft.avoidances.values.includes("heavy_decoration")) insights.push({
      id: "flower-amount", title: "좋아하는 꽃 장식의 정도를 정해 보면 좋겠어요", body: "풍성한 꽃은 원하면서, 꽃과 장식이 빼곡한 공간은 피하고 싶다고 답했어요. 원하는 양이나 장식할 위치가 있을 수 있어요.", evidence: [evidence(draft, "V1"), avoidanceEvidence(draft)], nextStep: "마음에 드는 사진과 부담스러운 사진을 나란히 놓고 꽃의 양과 위치를 짚어보세요. 둘 다 맞는 답으로 남겨두어도 괜찮아요.",
    });
    if (draft.tastes.ceremony?.status === "answered" && draft.tastes.ceremony.values.includes("participatory") && draft.avoidances.values.includes("stage_participation")) insights.push({
      id: "participation-format", title: "하객이 함께하는 방식은 따로 정하면 돼요", body: "하객이 참여하는 순서는 원하면서, 하객을 무대로 부르는 순서는 피하고 싶다고 답했어요. 자리에서 함께하는 방식도 있어요.", evidence: [tasteEvidence(draft, "ceremony"), avoidanceEvidence(draft)], nextStep: "원하는 참여 방식과 피할 방식을 나눠 진행자에게 알려 주세요. 참여 여부를 하객이 선택할 수 있는지도 확인해 보세요.",
    });
  }
  return insights;
}
export function buildV31Profile(input: V31Draft): V31Profile {
  const draft = normalizeV31Draft(input);
  const topics = WEDDING_CODE_V31_TOPICS.map((topic) => ({ key: topic.key, title: topic.title, responses: WEDDING_CODE_V31_QUESTIONS.filter((question) => question.topic === topic.key).map((question) => evidence(draft, question.id)) }));
  const unresolved = WEDDING_CODE_V31_QUESTIONS.filter((question) => !isRating(draft.answers[question.id])).map((question) => evidence(draft, question.id));
  for (const taste of WEDDING_CODE_V31_TASTES) {
    if (draft.tastes[taste.key]?.status !== "answered" && draft.tastes[taste.key]?.status !== "no_preference") unresolved.push(tasteEvidence(draft, taste.key));
  }
  if (draft.avoidances?.status !== "answered" && draft.avoidances?.status !== "no_preference") unresolved.push(avoidanceEvidence(draft));
  if (draft.priorities?.status !== "answered" && draft.priorities?.status !== "no_preference") unresolved.push({ id: "priorities", text: "이번 결혼식에서 특히 지키고 싶은 것", answer: v31ChoiceLabels(draft.priorities, getV31PriorityOptions(draft)).join(" · ") });
  if (draft.spending?.status !== "answered" && draft.spending?.status !== "no_preference") unresolved.push({ id: "spending", text: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳", answer: v31ChoiceLabels(draft.spending, WEDDING_CODE_V31_SPENDING).join(" · ") });
  return {
    ratedCount: WEDDING_CODE_V31_QUESTIONS.filter((question) => isRating(draft.answers[question.id])).length,
    respondedCount: WEDDING_CODE_V31_QUESTIONS.filter((question) => draft.answers[question.id] !== undefined).length + WEDDING_CODE_V31_TASTES.filter((taste) => draft.tastes[taste.key] !== undefined).length + Number(draft.avoidances !== undefined) + Number(draft.priorities !== undefined) + Number(draft.spending !== undefined),
    hasContent: hasV31Content(draft),
    priorityLabels: draft.priorities?.status === "answered" ? v31ChoiceLabels(draft.priorities, getV31PriorityOptions(draft)) : [],
    avoidanceLabels: v31ChoiceLabels(draft.avoidances, WEDDING_CODE_V31_AVOIDANCES),
    priorityGuides: priorityGuides(draft),
    spendingLabels: v31ChoiceLabels(draft.spending, WEDDING_CODE_V31_SPENDING),
    insights: buildInsights(draft),
    tastes: WEDDING_CODE_V31_TASTES.map((taste) => ({ key: taste.key, title: taste.title, labels: v31ChoiceLabels(draft.tastes[taste.key], taste.options) })),
    topics,
    unresolved,
  };
}

function ratingPairKind(first: V31Response | undefined, second: V31Response | undefined): V31PairItem["kind"] {
  if (!isRating(first) || !isRating(second)) return "unavailable";
  if (first >= 4 && second >= 4) return "shared_wish";
  if (first <= 2 && second <= 2) return "shared_distance";
  if (Math.abs(first - second) >= 2) return "different";
  return "middle";
}
function choicePairKind(first: V31Choice | undefined, second: V31Choice | undefined, context: "taste" | "spending" | "avoidances" | "priorities" = "taste"): V31PairItem["kind"] {
  const explicit = (choice: V31Choice | undefined) => choice?.status === "answered" || choice?.status === "no_preference";
  if (!explicit(first) || !explicit(second)) return "unavailable";
  if (first?.status === "no_preference" && second?.status === "no_preference") return context === "taste" ? "open_preference" : "middle";
  if (first?.status === "no_preference" || second?.status === "no_preference") return context === "taste" ? "open_preference" : "different";
  if (first?.status !== "answered" || second?.status !== "answered") return "unavailable";
  return first.values.length === second.values.length && first.values.every((value) => second.values.includes(value)) ? context === "avoidances" ? "shared_avoidance" : "shared_wish" : "different";
}
function sharedChoiceLabels(first: V31Choice | undefined, second: V31Choice | undefined, options: readonly V31Option[], tasteKey?: V31TasteKey): string[] {
  if (first?.status !== "answered" || second?.status !== "answered") return [];
  if (tasteKey === "photo") {
    const expand = (values: string[]) => values.flatMap((value) => value === "both_styles" ? ["candid", "directed"] : [value]);
    const firstValues = expand(first.values);
    const secondValues = expand(second.values);
    return options.filter((option) => firstValues.includes(option.value) && secondValues.includes(option.value)).map((option) => option.label);
  }
  return options.filter((option) => first.values.includes(option.value) && second.values.includes(option.value)).map((option) => option.label);
}
const TASTE_FOLLOW_UP: Record<V31TasteKey, string> = {
  venue: "서로 원하는 공간의 후보와 꼭 필요한 조건을 함께 골라보세요. 둘의 중간이 정답일 필요는 없어요.",
  photo: "각자 남기고 싶은 장면을 골라보고, 함께 담을 수 있는지 살펴보세요.",
  attire: "각자 입고 싶은 옷을 고르고, 함께 맞추고 싶은 부분만 의논해 보세요.",
  meal: "원하는 식사 방식의 후보와 하객에게 필요한 조건을 함께 살펴보세요.",
  guests: "이 답은 바라는 규모예요. 실제 초대할 사람과 장소의 수용 인원은 따로 확인해 보세요.",
  ceremony: "각자 넣고 싶은 순서를 고르고, 전체 길이와 진행 방법을 함께 정해 보세요.",
};
const NEUTRAL_FOLLOW_UP: Record<V31QuestionId, string> = {
  V1: "공간의 장식은 어느 정도면 좋을까요? 각자 마음에 드는 공간 사진을 보며 이야기해 보세요.",
  G1: "초대할 사람을 어떤 기준으로 정하고 싶은지 각자 이야기해 보세요.",
  G2: "자주 만나지 못했던 지인을 초대할지는 어떤 기준으로 정하면 좋을까요?",
  G3: "장소를 고를 때 이동 시간과 다른 조건을 어떻게 함께 볼지 이야기해 보세요.",
  R3: "예식에 입고 싶은 옷 사진을 각자 골라보고, 마음에 드는 부분을 이야기해 보세요.",
  R4: "옷을 고를 때 가장 먼저 확인하고 싶은 것은 무엇인지 각자 이야기해 보세요.",
  B1: "전체 예산을 유지하고 싶은 경우와 다시 의논하고 싶은 경우를 각각 이야기해 보세요.",
  B2: "항목 사이의 비용을 옮기고 싶은지, 옮긴다면 어떤 조건이면 괜찮을지 이야기해 보세요.",
  B3: "어떤 상황에서 전체 예산을 다시 의논할 수 있을지 각자 생각을 나눠보세요.",
  B4: "항목별 금액을 언제 정하고 어느 정도까지 정해 둘지 이야기해 보세요.",
  D1: "후보를 더 비교하고 싶은 경우와 비교를 끝내고 싶은 경우를 각자 이야기해 보세요.",
  D2: "어떤 조건이 맞으면 선택할 수 있을지, 더 확인할 것이 있는지 이야기해 보세요.",
  D3: "예식장을 고르기 전에 무엇을 어떤 방식으로 확인하고 싶은지 이야기해 보세요.",
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
function questionFollowUp(question: V31Question, kind: V31PairItem["kind"]): string {
  if (kind === "unavailable") return "아직 모르거나 계획에 없거나 답하지 않은 내용은 차이로 보지 않아요. 이 이야기가 지금 필요한지부터 확인해 보세요.";
  if (kind === "shared_distance") return `이 문장에는 두 사람 모두 가깝지 않다고 답했어요. ${NEUTRAL_FOLLOW_UP[question.id]}`;
  const followUp = kind === "shared_wish" ? question.followUp : NEUTRAL_FOLLOW_UP[question.id];
  return question.topic === "support" ? `${followUp} 서로 해줄 수 있는 방식과 여유도 이야기해 보세요.` : followUp;
}
function choiceFollowUp(kind: V31PairItem["kind"], followUp: string): string {
  if (kind === "unavailable") return "원하는 보기를 고르지 않은 답은 의견 차이로 보지 않아요. 어떤 상태로 답했는지 보고, 지금 이야기하고 싶은 내용인지부터 확인해 보세요.";
  if (kind === "middle") return "두 사람 모두 특정 보기를 고르지는 않았어요. 실제 후보나 준비 상황이 생기면 다시 이야기해 보세요.";
  if (kind === "open_preference") return "‘어느 쪽도 괜찮아요’는 아직 모른다는 답과 달라요. 구체적으로 고른 답이 있다면 그 후보부터 함께 살펴볼 수 있어요. 같은 취향으로 합의한 것은 아니에요.";
  return followUp;
}
export function compareV31(firstInput: V31Draft, secondInput: V31Draft): V31PairItem[] {
  const first = normalizeV31Draft(firstInput);
  const second = normalizeV31Draft(secondInput);
  const priorities = new Set([...(first.priorities?.status === "answered" ? first.priorities.values : []), ...(second.priorities?.status === "answered" ? second.priorities.values : [])]);
  const items: V31PairItem[] = WEDDING_CODE_V31_QUESTIONS.map((question) => {
    const kind = ratingPairKind(first.answers[question.id], second.answers[question.id]);
    return {
      id: question.id, title: question.statement,
      first: v31ResponseLabel(first.answers[question.id]), second: v31ResponseLabel(second.answers[question.id]),
      kind, followUp: questionFollowUp(question, kind), isPriority: priorities.has(question.id),
    };
  });
  for (const taste of WEDDING_CODE_V31_TASTES) {
    const kind = choicePairKind(first.tastes[taste.key], second.tastes[taste.key]);
    items.push({
      id: `taste.${taste.key}`, title: taste.question,
      first: v31ChoiceLabels(first.tastes[taste.key], taste.options).join(" · "), second: v31ChoiceLabels(second.tastes[taste.key], taste.options).join(" · "),
      kind, followUp: choiceFollowUp(kind, TASTE_FOLLOW_UP[taste.key]), isPriority: priorities.has(`taste.${taste.key}`),
      sharedLabels: sharedChoiceLabels(first.tastes[taste.key], second.tastes[taste.key], taste.options, taste.key),
    });
  }
  const firstPriorityLabels = v31ChoiceLabels(first.priorities, getV31PriorityOptions(first));
  const secondPriorityLabels = v31ChoiceLabels(second.priorities, getV31PriorityOptions(second));
  const priorityKind = choicePairKind(first.priorities, second.priorities, "priorities");
  const selectedTastePriorities = first.priorities?.status === "answered" ? first.priorities.values.filter((value) => value.startsWith("taste.")) : [];
  const samePriorityTastes = selectedTastePriorities.every((id) => {
    const key = TASTE_KEYS.find((taste) => `taste.${taste}` === id);
    return key !== undefined && choicePairKind(first.tastes[key], second.tastes[key]) === "shared_wish";
  });
  const resolvedPriorityKind = priorityKind === "shared_wish" && !samePriorityTastes ? "different" : priorityKind;
  const spendingKind = choicePairKind(first.spending, second.spending, "spending");
  const avoidanceKind = choicePairKind(first.avoidances, second.avoidances, "avoidances");
  items.push({
    id: "avoidances", title: "결혼식에서 피하고 싶은 것",
    first: v31ChoiceLabels(first.avoidances, WEDDING_CODE_V31_AVOIDANCES).join(" · "), second: v31ChoiceLabels(second.avoidances, WEDDING_CODE_V31_AVOIDANCES).join(" · "),
    kind: avoidanceKind, isPriority: [...priorities].some((id) => id.startsWith("avoid.")),
    sharedLabels: sharedChoiceLabels(first.avoidances, second.avoidances, WEDDING_CODE_V31_AVOIDANCES),
    followUp: avoidanceKind === "middle" ? "두 사람 모두 지금은 따로 피하고 싶은 것이 없다고 답했어요. 실제 공간이나 순서를 보다가 불편한 점이 생기면 이야기해 보세요." : choiceFollowUp(avoidanceKind, "각자 피하고 싶은 상황과 괜찮은 정도를 실제 예시로 이야기해 보세요. 한 사람이 고르지 않았다고 해서 상대가 피하고 싶은 방식을 원한다는 뜻은 아니에요."),
  });
  items.push({
    id: "priorities", title: "이번 결혼식에서 특히 지키고 싶은 것",
    first: firstPriorityLabels.join(" · "), second: secondPriorityLabels.join(" · "),
    kind: resolvedPriorityKind, isPriority: false,
    followUp: choiceFollowUp(resolvedPriorityKind, "각자 고른 기준을 왜 지키고 싶은지 이야기해 보세요. 고른 순서가 중요도 순위는 아니에요."),
  }, {
    id: "spending", title: "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳",
    first: v31ChoiceLabels(first.spending, WEDDING_CODE_V31_SPENDING).join(" · "), second: v31ChoiceLabels(second.spending, WEDDING_CODE_V31_SPENDING).join(" · "),
    kind: spendingKind, isPriority: false,
    sharedLabels: sharedChoiceLabels(first.spending, second.spending, WEDDING_CODE_V31_SPENDING),
    followUp: spendingKind === "middle" ? "두 사람 모두 지금은 더 쓰고 싶은 곳이 없다고 답했어요. 실제 견적을 보고 생각이 바뀌면 다시 이야기해 보세요." : choiceFollowUp(spendingKind, "어디에 더 쓰고 싶은지 현재의 바람을 비교한 답이에요. ‘지금은 없음’이 상대의 희망에 반대한다는 뜻은 아니에요. 옮겨 쓸 항목과 실제 금액은 따로 의논해 보세요. 전체 예산을 늘리기로 합의한 것도 아니에요."),
  });
  return items.sort((a, b) => Number(b.isPriority && b.kind === "different") - Number(a.isPriority && a.kind === "different"));
}
