import { ITEMS } from "./bank";
import { CHARACTERS, getCharacter } from "./characters";
import {
  DOMAIN_DEFINITIONS,
  EXPRESSION_VERSION,
  LETTER_DEFINITIONS,
  MEASUREMENT_VERSION,
  SCALE,
  type Answer,
  type Answers,
  type Character,
  type Domain,
  type DomainDefinition,
  type Facet,
  type Item,
  type Letter,
  type Rating,
} from "./types";

export interface ItemResponse {
  item: Item;
  answer: Answer | null;
}

export interface FacetProfile {
  facet: Facet;
  label: string;
  items: ItemResponse[];
  endorsedCount: number;
  ratedCount: number;
  ratio: { numerator: number; denominator: number; percent: number | null };
}

export interface PairedSceneProfile {
  sceneId: string;
  title: string;
  context: string;
  left: ItemResponse | null;
  right: ItemResponse | null;
  winner: Letter | null;
  bothHigh: boolean;
  bothLow: boolean;
  tie: boolean;
  middle: boolean;
  missing: boolean;
  summary: string;
}

export interface DomainProfile {
  domain: Domain;
  title: string;
  letters: readonly [Letter, Letter];
  primary: Letter | null;
  alternatives: Letter[];
  votes: { left: number; right: number };
  scenes: PairedSceneProfile[];
  facets: FacetProfile[];
  labels: string[];
  summary: string;
  observations: string[];
  counts: {
    complete: number;
    missing: number;
    bothHigh: number;
    bothLow: number;
    tie: number;
    middle: number;
  };
}

export interface SupportResponseCounts {
  rated: number;
  endorsed: number;
  low: number;
  middle: number;
  unknown: number;
  notApplicable: number;
  skipped: number;
  unanswered: number;
}

export interface SupportSceneProfile {
  sceneId: string;
  title: string;
  context: string;
  entries: ItemResponse[];
  endorsed: Facet[];
  topEndorsed: Facet[];
  complete: boolean;
  responseCounts: SupportResponseCounts;
  request: string | null;
}

export interface PartnerRequest {
  sceneId: string;
  title: string;
  request: string;
  facets: Facet[];
  note: string;
}

export interface PersonalResult {
  measurementVersion: string;
  expressionVersion: string;
  totalCount: number;
  answeredCount: number;
  ratedCount: number;
  statusCounts: { unknown: number; notApplicable: number; skipped: number; unanswered: number };
  partialCode: string;
  code: string | null;
  character: Character | null;
  candidateCharacters: Character[];
  domains: DomainProfile[];
  supportScenes: SupportSceneProfile[];
  insights: string[];
  requests: PartnerRequest[];
}

export interface ItemComparison {
  item: Item;
  first: Answer | null;
  second: Answer | null;
  relation: "same" | "both_agree" | "both_disagree" | "different_direction" | "middle" | "unavailable";
  strength: "same" | "first_more" | "second_more" | null;
  summary: string;
  prompt: string;
}

export interface ConversationPrompt {
  itemId: string;
  sceneId: string;
  sceneTitle: string;
  relation: ItemComparison["relation"];
  first: Answer | null;
  second: Answer | null;
  text: string;
}

export interface CoupleResult {
  first: PersonalResult;
  second: PersonalResult;
  items: ItemComparison[];
  conversations: ConversationPrompt[];
}

type RatedAnswer = Extract<Answer, { status: "rated" }>;

const TEAM_SHORTLISTING_ACCEPTANCE = "함께 정한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용";

// These are response-label and editorial display rules, not empirical cutoffs.
// A scene contributes one vote only when the higher direct answer is 4 or 5.
// The ordinal values themselves are never subtracted, averaged, or reverse-scored.
function normalizeAnswer(raw: unknown): Answer | null {
  if (raw === null || typeof raw !== "object" || !("status" in raw)) return null;
  if (raw.status === "rated" && "value" in raw) {
    const value = raw.value;
    if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
      return { status: "rated", value };
    }
    return null;
  }
  if (raw.status === "unknown" || raw.status === "not_applicable" || raw.status === "skipped") {
    return { status: raw.status };
  }
  return null;
}

function isRated(answer: Answer | null | undefined): answer is RatedAnswer {
  return answer?.status === "rated";
}

function isEndorsed(value: Rating): boolean {
  return value === 4 || value === 5;
}

function facetLabel(facet: Facet): string {
  if (facet === "together_rest") return "함께 잠깐 쉬기";
  if (facet === "alone_rest") return "혼자 쉬도록 기다리기";
  return LETTER_DEFINITIONS[facet].name;
}

function answerLabel(answer: Answer | null): string {
  if (isRated(answer)) return `${answer.value} · ${SCALE.find((entry) => entry.value === answer.value)?.label ?? ""}`;
  if (answer?.status === "unknown") return "잘 모르겠어요";
  if (answer?.status === "not_applicable") return "해당하지 않아요";
  if (answer?.status === "skipped") return "건너뛰었어요";
  return "아직 답하지 않았어요";
}

function responseFor(item: Item, answers: Answers): ItemResponse {
  return { item, answer: normalizeAnswer(answers[item.id]) };
}

function groupByScene(items: readonly Item[]): Item[][] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const group = groups.get(item.sceneId);
    if (group) group.push(item);
    else groups.set(item.sceneId, [item]);
  }
  return [...groups.values()];
}

function buildPairedScene(items: Item[], definition: DomainDefinition, answers: Answers): PairedSceneProfile | null {
  const anchor = items[0];
  if (!anchor) return null;
  const leftItem = items.find((item) => item.facet === definition.letters[0]);
  const rightItem = items.find((item) => item.facet === definition.letters[1]);
  const left = leftItem ? responseFor(leftItem, answers) : null;
  const right = rightItem ? responseFor(rightItem, answers) : null;
  const a = left?.answer;
  const b = right?.answer;
  const complete = isRated(a) && isRated(b);
  const bothHigh = complete && isEndorsed(a.value) && isEndorsed(b.value);
  const bothLow = complete && a.value <= 2 && b.value <= 2;
  const tie = complete && a.value === b.value;
  const middle = (isRated(a) && a.value === 3) || (isRated(b) && b.value === 3);
  let winner: Letter | null = null;
  if (complete) {
    if (a.value > b.value && isEndorsed(a.value)) winner = definition.letters[0];
    if (b.value > a.value && isEndorsed(b.value)) winner = definition.letters[1];
  }
  const raw = `${facetLabel(definition.letters[0])}: ${answerLabel(a ?? null)} / ${facetLabel(definition.letters[1])}: ${answerLabel(b ?? null)}`;
  let meaning = "두 응답의 비교는 확인 중이에요.";
  if (complete) {
    if (bothHigh) meaning = "두 문장에 둘 다 동의했어요.";
    else if (bothLow) meaning = "두 문장 모두 동의가 낮았어요.";
    else if (middle) meaning = "보통이라는 중간 응답을 함께 남겼어요.";
    else meaning = "각 문장의 동의 방향을 따로 볼 수 있어요.";
    if (winner) meaning += ` ${facetLabel(winner)} 쪽의 직접 응답이 더 높았어요.`;
    else if (tie) meaning += " 두 직접 응답은 같아요.";
  }
  if (definition.id === "process") meaning += ` T 문장이 가리키는 내용은 ${TEAM_SHORTLISTING_ACCEPTANCE}이에요.`;
  return {
    sceneId: anchor.sceneId,
    title: anchor.sceneTitle,
    context: anchor.context,
    left,
    right,
    winner,
    bothHigh,
    bothLow,
    tie,
    middle,
    missing: !complete,
    summary: `${anchor.sceneTitle} — ${raw}. ${meaning}`,
  };
}

function buildDomain(definition: DomainDefinition, answers: Answers): DomainProfile {
  const items = ITEMS.filter((item) => item.domain === definition.id);
  const pairedItems = items.filter((item) => definition.letters.some((letter) => letter === item.facet));
  const scenes = groupByScene(pairedItems).flatMap((group) => {
    const scene = buildPairedScene(group, definition, answers);
    return scene ? [scene] : [];
  });
  const votes = {
    left: scenes.filter((scene) => scene.winner === definition.letters[0]).length,
    right: scenes.filter((scene) => scene.winner === definition.letters[1]).length,
  };
  const primary = votes.left > votes.right ? definition.letters[0] : votes.right > votes.left ? definition.letters[1] : null;
  const positiveLeft = scenes.some((scene) => !scene.missing && isRated(scene.left?.answer) && isEndorsed(scene.left.answer.value));
  const positiveRight = scenes.some((scene) => !scene.missing && isRated(scene.right?.answer) && isEndorsed(scene.right.answer.value));
  const alternatives = primary === null && positiveLeft && positiveRight ? [...definition.letters] : [];
  const facets: Facet[] = [...definition.letters];
  if (definition.id === "support") facets.push("together_rest", "alone_rest");
  const facetProfiles = facets.map((facet): FacetProfile => {
    const entries = items.filter((item) => item.facet === facet).map((item) => responseFor(item, answers));
    const endorsedCount = entries.filter((entry) => isRated(entry.answer) && isEndorsed(entry.answer.value)).length;
    const ratedCount = entries.filter((entry) => isRated(entry.answer)).length;
    return {
      facet,
      label: facetLabel(facet),
      items: entries,
      endorsedCount,
      ratedCount,
      // 각 문장의 동의 비율은 독립적이며, 대표 글자를 정하는 장면 표와 다르다.
      ratio: { numerator: endorsedCount, denominator: ratedCount, percent: ratedCount === 0 ? null : endorsedCount * 100 / ratedCount },
    };
  });
  const counts = {
    complete: scenes.filter((scene) => !scene.missing).length,
    missing: scenes.filter((scene) => scene.missing).length,
    bothHigh: scenes.filter((scene) => scene.bothHigh).length,
    bothLow: scenes.filter((scene) => scene.bothLow).length,
    tie: scenes.filter((scene) => scene.tie).length,
    middle: scenes.filter((scene) => scene.middle).length,
  };
  const labels: string[] = [];
  if (alternatives.length === 2) labels.push("대표 표 동수");
  if (counts.bothHigh > 0) labels.push("두 마음 함께");
  if (votes.left > 0 && votes.right > 0) labels.push("장면 따라");
  if (counts.missing > 0 || (primary === null && alternatives.length === 0)) labels.push("확인 중");
  const voteDescription = `${facetLabel(definition.letters[0])} 대표 표 ${votes.left}개 · ${facetLabel(definition.letters[1])} 대표 표 ${votes.right}개`;
  const coverage = `두 문장을 모두 1~5로 답한 장면 ${counts.complete}/${scenes.length}개 · 비교하지 않은 장면 ${counts.missing}개.`;
  const responseSummary = primary
    ? `비교할 수 있었던 장면에서 ${facetLabel(primary)} 쪽의 대표 표가 더 많았어요. ${voteDescription}.`
    : alternatives.length > 0
      ? `대표 표는 동수이고 양쪽의 긍정 응답을 함께 남겼어요. 장면마다 같은 마음이라는 뜻은 아니에요. ${voteDescription}.`
      : "대표 글자는 확인 중이에요. 각 문장의 원답은 그대로 남겼어요.";
  const summary = definition.id === "process"
    ? `${responseSummary} ${coverage} T 문장의 범위는 ${TEAM_SHORTLISTING_ACCEPTANCE}이에요.`
    : `${responseSummary} ${coverage}`;
  return {
    domain: definition.id,
    title: definition.name,
    letters: definition.letters,
    primary,
    alternatives,
    votes,
    scenes,
    facets: facetProfiles,
    labels,
    summary,
    observations: scenes.map((scene) => scene.summary),
    counts,
  };
}

function supportRequest(facets: Facet[], sceneId: string): string | null {
  if (facets.length === 0) return null;
  const taskDescriptions: Record<string, string> = {
    "likert.support.tour.v1": "홀 투어 메모를 정리해주는 것",
    "likert.support.compare.v1": "후보 비교표를 정리해주는 것",
    "likert.support.contact.v1": "업체 답변 메모를 정리해주는 것",
  };
  const descriptions: Record<Facet, string> = {
    C: "기본 항목을 보강하는 것",
    E: "원하는 경험을 추가하는 것",
    J: "직접 자료를 보는 것",
    T: "함께 정한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식을 받아들이는 것",
    O: "가족 취향을 확인하는 것",
    U: "우리 선호를 정리하는 것",
    L: "내 이야기를 들어주는 것",
    A: taskDescriptions[sceneId] ?? "내 자료를 정리해주는 것",
    together_rest: "함께 잠깐 쉬는 것",
    alone_rest: "혼자 쉬도록 기다려주는 것",
  };
  return `${facets.map((facet) => descriptions[facet]).join(", ")}에 동의했어. 지금은 이 중 어떤 도움을 받을지, 서로 가능한 방식을 함께 정하고 싶어.`;
}

function supportResponseCounts(entries: ItemResponse[]): SupportResponseCounts {
  const counts: SupportResponseCounts = { rated: 0, endorsed: 0, low: 0, middle: 0, unknown: 0, notApplicable: 0, skipped: 0, unanswered: 0 };
  for (const { answer } of entries) {
    if (isRated(answer)) {
      counts.rated += 1;
      if (isEndorsed(answer.value)) counts.endorsed += 1;
      else if (answer.value === 3) counts.middle += 1;
      else counts.low += 1;
    } else if (answer?.status === "unknown") counts.unknown += 1;
    else if (answer?.status === "not_applicable") counts.notApplicable += 1;
    else if (answer?.status === "skipped") counts.skipped += 1;
    else counts.unanswered += 1;
  }
  return counts;
}

function buildSupportScenes(answers: Answers): SupportSceneProfile[] {
  return groupByScene(ITEMS.filter((item) => item.domain === "support")).flatMap((group) => {
    const anchor = group[0];
    if (!anchor) return [];
    const entries = group.map((item) => responseFor(item, answers));
    const endorsedEntries = entries.filter((entry) => isRated(entry.answer) && isEndorsed(entry.answer.value));
    const endorsed = endorsedEntries.map((entry) => entry.item.facet);
    const hasFive = endorsedEntries.some((entry) => isRated(entry.answer) && entry.answer.value === 5);
    const topEndorsed = endorsedEntries.filter((entry) => isRated(entry.answer) && entry.answer.value === (hasFive ? 5 : 4)).map((entry) => entry.item.facet);
    return [{
      sceneId: anchor.sceneId,
      title: anchor.sceneTitle,
      context: anchor.context,
      entries,
      endorsed,
      topEndorsed,
      complete: entries.every((entry) => isRated(entry.answer)),
      responseCounts: supportResponseCounts(entries),
      request: supportRequest(endorsed, anchor.sceneId),
    }];
  });
}

function domainInsights(profile: DomainProfile): string[] {
  const endorsed = profile.facets.filter((facet) => facet.endorsedCount > 0).map((facet) => `${facet.label} ${facet.endorsedCount}장면`).join(" · ");
  const facts = endorsed ? `동의한 원답: ${endorsed}. ` : "각 문장의 중간·낮은 동의와 응답 상태를 함께 보세요. ";
  const advice: Record<Domain, readonly [string, string]> = {
    money: ["동의한 항목을 실제 견적에 표시하고, 기본 보강과 추가 경험에 배분할 금액을 함께 정해요.", "실제로 쓸 금액과 예산 한도는 별도로 확인해요."],
    process: [`직접 자료를 보고 싶은 정도와 ${TEAM_SHORTLISTING_ACCEPTANCE} 응답을 각각 확인해요.`, "이번 장면의 비교 기준과 공유 방법을 확인하고, 누가 초기 후보를 추릴지는 두 사람이 별도로 정해요."],
    family: ["가족에게 확인할 내용과 우리 둘의 선호를 정리할 내용을 초안 준비 메모에 남겨요.", "의견을 확인하는 시점, 실제 실행 순서와 최종 결정은 각각 상의해요."],
    support: ["동의한 도움과 쉬는 방식을 구체적인 말로 전달해요.", "지금 받고 싶은 도움, 서로 가능한 방식과 실행 순서를 대화로 정해요."],
  };
  return [`활용 · ${profile.title}: ${facts}${advice[profile.domain][0]}`, `함께 확인 · ${profile.title}: ${advice[profile.domain][1]}`];
}

export function buildResult(answers: Answers): PersonalResult {
  const entries = ITEMS.map((item) => responseFor(item, answers));
  const domains = DOMAIN_DEFINITIONS.map((definition) => buildDomain(definition, answers));
  const partialCode = domains.map((domain) => domain.primary ?? "?").join("");
  const completeCode = domains.every((domain) => domain.primary !== null) ? partialCode : null;
  const character = completeCode ? getCharacter(completeCode) ?? null : null;
  const candidateCharacters = CHARACTERS.filter((candidate) => domains.every((domain, index) => {
    const allowed = domain.primary ? [domain.primary] : domain.alternatives.length > 0 ? domain.alternatives : [...domain.letters];
    return allowed.some((letter) => letter === candidate.code[index]);
  }));
  const supportScenes = buildSupportScenes(answers);
  return {
    measurementVersion: MEASUREMENT_VERSION,
    expressionVersion: EXPRESSION_VERSION,
    totalCount: ITEMS.length,
    answeredCount: entries.filter((entry) => entry.answer !== null).length,
    ratedCount: entries.filter((entry) => isRated(entry.answer)).length,
    statusCounts: {
      unknown: entries.filter((entry) => entry.answer?.status === "unknown").length,
      notApplicable: entries.filter((entry) => entry.answer?.status === "not_applicable").length,
      skipped: entries.filter((entry) => entry.answer?.status === "skipped").length,
      unanswered: entries.filter((entry) => entry.answer === null).length,
    },
    partialCode,
    code: character ? completeCode : null,
    character,
    candidateCharacters,
    domains,
    supportScenes,
    insights: domains.flatMap(domainInsights),
    requests: supportScenes.flatMap((scene) => scene.request === null ? [] : [{
      sceneId: scene.sceneId,
      title: scene.title,
      request: scene.request,
      facets: [...scene.endorsed],
      note: "문항의 상황과 지금의 조건을 확인해 사용할 요청 초안이에요. 동의한 도움의 표시 순서가 실행 순서는 아니에요.",
    }]),
  };
}

function comparisonPrompt(item: Item, prompt: string): string {
  if (item.domain !== "process") return prompt;
  return `${prompt} 직접 비교하고 싶은 정도와 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식을 받아들이는 정도를 각각 확인하고, 누가 초기 후보를 추릴지는 두 사람이 별도로 정해볼까요?`;
}

function compareItem(item: Item, firstAnswers: Answers, secondAnswers: Answers): ItemComparison {
  const first = normalizeAnswer(firstAnswers[item.id]);
  const second = normalizeAnswer(secondAnswers[item.id]);
  const raw = `첫 번째: ${answerLabel(first)} / 두 번째: ${answerLabel(second)}`;
  if (!isRated(first) || !isRated(second)) {
    return { item, first, second, relation: "unavailable", strength: null, summary: `${raw}. 수치 응답의 비교는 확인 중이에요.`, prompt: comparisonPrompt(item, "이 문장이 현재 각자에게 해당하는 상황인지, 아직 확인하지 않은 내용은 무엇인지 이야기해볼까요?") };
  }
  const strength = first.value === second.value ? "same" : first.value > second.value ? "first_more" : "second_more";
  let relation: ItemComparison["relation"];
  let meaning: string;
  let prompt: string;
  if (first.value === second.value) {
    relation = "same";
    meaning = "같은 문장에 같은 칸으로 답했어요.";
    prompt = "같은 응답을 고른 이유와 이번 상황에서 원하는 행동도 같은지 확인해볼까요?";
  } else if (isEndorsed(first.value) && isEndorsed(second.value)) {
    relation = "both_agree";
    meaning = "둘 다 동의했고, 동의 표현의 강도는 달랐어요.";
    prompt = "둘 다 동의한 이 내용을 이번 준비에 어떻게 함께 반영할지 정해볼까요?";
  } else if (first.value <= 2 && second.value <= 2) {
    relation = "both_disagree";
    meaning = "둘 다 동의가 낮았고, 선택한 칸은 달랐어요.";
    prompt = "두 사람이 이 문장에 동의하지 않은 이유와 원하는 다른 방법을 각각 이야기해볼까요?";
  } else if ((isEndorsed(first.value) && second.value <= 2) || (isEndorsed(second.value) && first.value <= 2)) {
    relation = "different_direction";
    meaning = "이 문장에 대한 동의 방향이 달랐어요.";
    prompt = "동의한 이유와 동의하지 않은 이유를 듣고, 이 상황에서 서로 필요한 조건을 정해볼까요?";
  } else {
    relation = "middle";
    meaning = "한 사람의 보통이라는 중간 응답과 다른 사람의 응답을 함께 남겼어요.";
    prompt = "보통이라고 답한 뜻과 상대가 고른 응답의 이유를 각각 확인해볼까요?";
  }
  return { item, first, second, relation, strength, summary: `${raw}. ${meaning}`, prompt: comparisonPrompt(item, prompt) };
}

export function buildComparison(first: Answers, second: Answers): CoupleResult {
  const items = ITEMS.map((item) => compareItem(item, first, second));
  return {
    first: buildResult(first),
    second: buildResult(second),
    items,
    conversations: items.map((item) => ({
      itemId: item.item.id,
      sceneId: item.item.sceneId,
      sceneTitle: item.item.sceneTitle,
      relation: item.relation,
      first: item.first,
      second: item.second,
      text: item.prompt,
    })),
  };
}
