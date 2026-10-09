import { describe, expect, it } from "vitest";
import { ITEMS } from "./bank";
import { CHARACTERS, getCharacter } from "./characters";
import { buildComparison, buildResult, type PersonalResult } from "./model";
import { DOMAIN_DEFINITIONS, type Answer, type Answers, type Domain, type Facet, type Rating } from "./types";

const rated = (value: Rating): Answer => ({ status: "rated", value });

function facetAnswers(facet: Facet, values: readonly Rating[]): Answers {
  const answers: Answers = {};
  ITEMS.filter((item) => item.facet === facet).forEach((item, index) => {
    const value = values[index];
    if (value !== undefined) answers[item.id] = rated(value);
  });
  return answers;
}

function domainResult(answers: Answers, domain: Domain) {
  const profile = buildResult(answers).domains.find((entry) => entry.domain === domain);
  if (!profile) throw new Error(`Missing domain ${domain}`);
  return profile;
}

function characterAnswers(code: string): Answers {
  const answers: Answers = {};
  DOMAIN_DEFINITIONS.forEach((domain, index) => {
    const primary = domain.letters.find((letter) => letter === code[index]);
    if (!primary) throw new Error(`Invalid test code ${code}`);
    for (const item of ITEMS.filter((entry) => entry.domain === domain.id)) {
      answers[item.id] = rated(item.facet === primary ? 5 : item.facet === "together_rest" || item.facet === "alone_rest" ? 2 : 4);
    }
  });
  return answers;
}

function independentQaCounterexample(): Answers {
  return {
    ...facetAnswers("C", [5, 5, 5]), ...facetAnswers("E", [1, 1, 1]),
    ...facetAnswers("J", [4, 4, 4]), ...facetAnswers("T", [5, 5, 5]),
    ...facetAnswers("O", [5, 5, 5]), ...facetAnswers("U", [1, 1, 1]),
    ...facetAnswers("L", [5, 5, 5]), ...facetAnswers("A", [1, 1, 1]),
    ...facetAnswers("together_rest", [3, 3, 3]), ...facetAnswers("alone_rest", [3, 3, 3]),
  };
}

function processReading(result: PersonalResult): string {
  const profile = result.domains.find((entry) => entry.domain === "process");
  if (!profile) throw new Error("Missing process profile");
  return [
    profile.summary,
    ...profile.observations,
    ...result.insights.filter((entry) => entry.includes(profile.title)),
    result.character?.tagline ?? "",
    ...result.requests.map((entry) => entry.request),
  ].join("\n");
}

const roleExpansion = /맡기|맡겨|위임|관여.{0,10}낮|참여.{0,10}낮|신뢰|믿음|Trust the criteria/;

describe("Likert ordinal response summaries", () => {
  it("preserves ordered raw ratings and does not mutate the supplied answers", () => {
    const answers = { ...facetAnswers("C", [1, 3, 5]), ...facetAnswers("E", [2, 4, 4]) };
    const before = JSON.stringify(answers);
    const result = buildResult(answers);
    expect(result.domains[0].facets[0].items.map((entry) => entry.answer)).toEqual([rated(1), rated(3), rated(5)]);
    expect(JSON.stringify(answers)).toBe(before);
  });

  it("distinguishes absent/null, unknown and rated midpoint answers", () => {
    const entries = ITEMS.filter((item) => item.facet === "C");
    const answers: Answers = {};
    Object.defineProperty(answers, entries[0].id, { value: null, enumerable: true });
    answers[entries[1].id] = { status: "unknown" };
    answers[entries[2].id] = rated(3);
    const result = buildResult(answers);
    expect(result.domains[0].facets[0].items.map((entry) => entry.answer)).toEqual([null, { status: "unknown" }, rated(3)]);
    expect(result.ratedCount).toBe(1);
    expect(result.statusCounts.unknown).toBe(1);
    expect(result.statusCounts.unanswered).toBe(ITEMS.length - 2);
  });

  it("keeps non-applicable and skipped answers outside directional votes", () => {
    const answers: Answers = { ...facetAnswers("E", [5, 5, 5]) };
    const entries = ITEMS.filter((item) => item.facet === "C");
    answers[entries[0].id] = { status: "not_applicable" };
    answers[entries[1].id] = { status: "skipped" };
    answers[entries[2].id] = { status: "unknown" };
    const result = buildResult(answers);
    expect(result.domains[0].primary).toBeNull();
    expect(result.domains[0].votes).toEqual({ left: 0, right: 0 });
    expect(result.statusCounts).toMatchObject({ unknown: 1, notApplicable: 1, skipped: 1 });
  });

  it("does not convert a higher low response 2 versus 1 into a positive vote", () => {
    const profile = domainResult({ ...facetAnswers("C", [2, 2, 2]), ...facetAnswers("E", [1, 1, 1]) }, "money");
    expect(profile.primary).toBeNull();
    expect(profile.alternatives).toEqual([]);
    expect(profile.counts.bothLow).toBe(3);
  });

  it("does not convert a midpoint 3 versus 1 into a positive vote", () => {
    const profile = domainResult({ ...facetAnswers("J", [3, 3, 3]), ...facetAnswers("T", [1, 1, 1]) }, "process");
    expect(profile.primary).toBeNull();
    expect(profile.votes).toEqual({ left: 0, right: 0 });
    expect(profile.counts.middle).toBe(3);
  });

  it("preserves both endorsed needs even when one receives the representative letter", () => {
    const profile = domainResult({ ...facetAnswers("C", [5, 5, 5]), ...facetAnswers("E", [4, 4, 4]) }, "money");
    expect(profile.primary).toBe("C");
    expect(profile.counts.bothHigh).toBe(3);
    expect(profile.facets.map((entry) => entry.endorsedCount)).toEqual([3, 3]);
    expect(profile.labels).toContain("두 마음 함께");
    expect(profile.observations.some((entry) => entry.includes("둘 다"))).toBe(true);
  });

  it("keeps equally low responses as a profile without assigning the opposite letter", () => {
    const profile = domainResult({ ...facetAnswers("O", [1, 2, 1]), ...facetAnswers("U", [1, 2, 1]) }, "family");
    expect(profile.primary).toBeNull();
    expect(profile.alternatives).toEqual([]);
    expect(profile.counts.bothLow).toBe(3);
  });

  it("offers both adjacent letters for equally endorsed perspectives", () => {
    const profile = domainResult({ ...facetAnswers("J", [4, 5, 4]), ...facetAnswers("T", [4, 5, 4]) }, "process");
    expect(profile.primary).toBeNull();
    expect(profile.alternatives).toEqual(["J", "T"]);
    expect(profile.labels).toContain("대표 표 동수");
    const result = buildResult({ ...characterAnswers("CJOL"), ...facetAnswers("J", [4, 5, 4]), ...facetAnswers("T", [4, 5, 4]) });
    expect(result.partialCode).toBe("C?OL");
    expect(result.candidateCharacters.map((entry) => entry.code)).toEqual(["CJOL", "CTOL"]);
  });

  it("does not manufacture a character from midpoint-only answers", () => {
    const answers: Answers = {};
    for (const item of ITEMS) answers[item.id] = rated(3);
    const result = buildResult(answers);
    expect(result.code).toBeNull();
    expect(result.character).toBeNull();
    expect(result.partialCode).toBe("????");
    expect(result.domains.every((entry) => entry.alternatives.length === 0)).toBe(true);
  });

  it("uses more positive ordinal scene votes while preserving an opposing scene", () => {
    const profile = domainResult({ ...facetAnswers("J", [5, 5, 4]), ...facetAnswers("T", [4, 4, 5]) }, "process");
    expect(profile.primary).toBe("J");
    expect(profile.votes).toEqual({ left: 2, right: 1 });
    expect(profile.labels).toContain("장면 따라");
    expect(profile.scenes.map((entry) => entry.winner)).toEqual(["J", "J", "T"]);
    const tied = domainResult({ ...facetAnswers("J", [5, 4, 3]), ...facetAnswers("T", [4, 5, 3]) }, "process");
    expect(tied.primary).toBeNull();
    expect(tied.alternatives).toEqual(["J", "T"]);
    expect(tied.labels).toContain("장면 따라");
  });

  it("allows a provisional observed scene without requiring all three scenes", () => {
    const profile = domainResult({ ...facetAnswers("J", [5]), ...facetAnswers("T", [4]) }, "process");
    expect(profile.primary).toBe("J");
    expect(profile.counts.complete).toBe(1);
    expect(profile.labels).toContain("확인 중");
  });

  it("does not infer a paired preference from an endorsement and an unknown counterpart", () => {
    const answers = facetAnswers("O", [5, 5, 5]);
    for (const item of ITEMS.filter((entry) => entry.facet === "U")) answers[item.id] = { status: "unknown" };
    const profile = domainResult(answers, "family");
    expect(profile.primary).toBeNull();
    expect(profile.alternatives).toEqual([]);
    expect(profile.facets[0].endorsedCount).toBe(3);
  });

  it("never derives our-preferences endorsement from low early-family-input answers", () => {
    const profile = domainResult(facetAnswers("O", [2, 3, 2]), "family");
    expect(profile.primary).toBeNull();
    expect(profile.facets.find((entry) => entry.facet === "U")?.endorsedCount).toBe(0);
    expect(profile.scenes.every((entry) => entry.winner === null)).toBe(true);
  });

  it("gives different personal guides to synthetic people with the same character", () => {
    const first = { ...characterAnswers("CJOL"), ...facetAnswers("together_rest", [4, 4, 4]), ...facetAnswers("alone_rest", [2, 2, 3]) };
    const second = { ...characterAnswers("CJOL"), ...facetAnswers("together_rest", [2, 2, 3]), ...facetAnswers("alone_rest", [4, 4, 4]) };
    const a = buildResult(first);
    const b = buildResult(second);
    expect(a.code).toBe("CJOL");
    expect(b.character).toEqual(a.character);
    expect(a.requests[1].request).not.toBe(b.requests[1].request);
    expect(a.supportScenes[1].endorsed).toContain("together_rest");
    expect(b.supportScenes[1].endorsed).toContain("alone_rest");
  });

  it("preserves every endorsed support mode and does not assign an execution order", () => {
    const answers = { ...facetAnswers("L", [5, 5, 5]), ...facetAnswers("A", [4, 4, 4]), ...facetAnswers("together_rest", [4, 4, 4]), ...facetAnswers("alone_rest", [4, 4, 4]) };
    const result = buildResult(answers);
    expect(result.supportScenes[0].endorsed).toEqual(["L", "A", "together_rest", "alone_rest"]);
    expect(result.supportScenes[0].topEndorsed).toEqual(["L"]);
    expect(result.requests[0].facets).toEqual(result.supportScenes[0].endorsed);
    expect(result.requests[0].request).not.toContain("먼저");
    expect(result.requests[0].request).toContain("홀 투어 메모");
    expect(result.requests[1].request).toContain("후보 비교표");
    expect(result.requests[2].request).toContain("업체 답변 메모");
  });

  it("compares the exact same item and separates agreement direction from strength", () => {
    const item = ITEMS[0];
    const bothAgree = buildComparison({ [item.id]: rated(5) }, { [item.id]: rated(4) }).items[0];
    expect(bothAgree.item.id).toBe(item.id);
    expect(bothAgree.relation).toBe("both_agree");
    expect(bothAgree.strength).toBe("first_more");
    const different = buildComparison({ [item.id]: rated(4) }, { [item.id]: rated(2) }).items[0];
    expect(different.relation).toBe("different_direction");
  });

  it("keeps unknown comparisons unavailable rather than imputing a neutral score", () => {
    const item = ITEMS[0];
    const result = buildComparison({ [item.id]: { status: "unknown" } }, { [item.id]: rated(3) });
    expect(result.items[0].relation).toBe("unavailable");
    expect(result.items[0].strength).toBeNull();
    expect(result.items[0].first).toEqual({ status: "unknown" });
    expect(result.items[0].second).toEqual(rated(3));
  });

  it.each([[4, 4], [5, 5], [4, 5], [5, 4]] as const)("L%s/%s 응답은 서로 경청할 순서와 지금 가능한 범위를 묻는다", (firstValue, secondValue) => {
    const item = ITEMS.find(entry => entry.facet === "L");
    if (!item) throw new Error("Missing listening item");
    const first = rated(firstValue);
    const second = rated(secondValue);
    const result = buildComparison({ [item.id]: first }, { [item.id]: second });
    const comparison = result.items.find(entry => entry.item.id === item.id);
    const conversation = result.conversations.find(entry => entry.itemId === item.id);
    expect(comparison).toMatchObject({ first, second });
    expect(conversation?.text).toContain("둘 다 경청 도움을 원했어요");
    expect(conversation?.text).toContain("누가 먼저 이야기하고");
    expect(conversation?.text).toContain("지금 서로 들어줄 수 있는 범위");
    expect(conversation?.text).not.toMatch(/들어줄 수 있어요|관계 만족|사이가 좋|갈등이 없/);
  });

  it("낮은 동의·중립·미확인 상태로 두 사람의 경청 욕구를 만들어내지 않는다", () => {
    const item = ITEMS.find(entry => entry.facet === "L");
    if (!item) throw new Error("Missing listening item");
    const answers: (Answer | undefined)[] = [rated(1), rated(2), rated(3),
      { status: "unknown" }, { status: "not_applicable" }, { status: "skipped" }, undefined];
    for (const answer of answers) {
      const own: Answers = answer ? { [item.id]: answer } : {};
      for (const other of [own, { [item.id]: rated(5) }]) {
        const result = buildComparison(own, other);
        const conversation = result.conversations.find(entry => entry.itemId === item.id);
        expect(conversation?.text).not.toContain("둘 다 경청 도움을 원했어요");
        expect(conversation?.first).toEqual(answer ?? null);
      }
    }
  });

  it("resolves all sixteen codes through the static catalog without a fallback", () => {
    expect(CHARACTERS).toHaveLength(16);
    for (const character of CHARACTERS) {
      const result = buildResult(characterAnswers(character.code));
      expect(result.code).toBe(character.code);
      expect(result.character).toEqual(character);
      expect(result.candidateCharacters).toEqual([character]);
    }
    expect(getCharacter("INVALID")).toBeUndefined();
  });

  it("rejects invalid runtime rating values instead of allowing them to vote", () => {
    const answers: Answers = facetAnswers("E", [4, 4, 4]);
    Object.defineProperty(answers, ITEMS.find((item) => item.facet === "C")?.id ?? "missing", { value: { status: "rated", value: 9 }, enumerable: true });
    const result = buildResult(answers);
    expect(result.domains[0].counts.complete).toBe(0);
    expect(result.domains[0].primary).toBeNull();
  });

  it("ignores non-bank keys and keeps unknown results deterministic without choosing an animal", () => {
    const result = buildResult({ obsolete_item: rated(5) });
    expect(result.answeredCount).toBe(0);
    expect(result.code).toBeNull();
    expect(result.character).toBeNull();
    expect(result).toEqual(buildResult({}));
  });

  it("preserves the independent QA J4/T5 CTOL counterexample as acceptance with both needs endorsed", () => {
    const result = buildResult(independentQaCounterexample());
    const profile = result.domains.find((entry) => entry.domain === "process");
    expect(result.code).toBe("CTOL");
    expect(profile?.primary).toBe("T");
    expect(profile?.votes).toEqual({ left: 0, right: 3 });
    expect(profile?.counts.bothHigh).toBe(3);
    expect(profile?.facets.map((entry) => entry.endorsedCount)).toEqual([3, 3]);
    expect(profile?.scenes.map((entry) => entry.left?.answer)).toEqual([rated(4), rated(4), rated(4)]);
    expect(profile?.scenes.map((entry) => entry.right?.answer)).toEqual([rated(5), rated(5), rated(5)]);
    expect(profile?.summary).toContain("함께 정한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용");
    expect(profile?.observations.every((entry) => entry.includes("둘 다 동의"))).toBe(true);
    expect(result.insights.some((entry) => entry.includes("초기 후보") && entry.includes("공유") && entry.includes("수용"))).toBe(true);
    expect(result.insights.some((entry) => entry.includes("누가") && entry.includes("별도로"))).toBe(true);
    expect(processReading(result)).not.toMatch(roleExpansion);
  });

  it("leaves the unmeasured shortlisting actor open for both compatible external scenarios", () => {
    // These background facts are not answer fields and are never passed into the API.
    const scenarios = ["이번에는 본인이 초기 후보를 추려 공유한다", "이번에는 상대가 초기 후보를 추려 공유한다"];
    const observations = scenarios.map((scenario) => ({ scenario, result: buildResult(independentQaCounterexample()) }));
    expect(observations[0].scenario).not.toBe(observations[1].scenario);
    expect(observations[0].result).toEqual(observations[1].result);
    for (const observation of observations) {
      expect(observation.result.code).toBe("CTOL");
      expect(processReading(observation.result)).toContain("한 사람이 초기 후보를 추려 공유하는 방식의 수용");
      expect(processReading(observation.result)).not.toMatch(roleExpansion);
      expect(observation.result).not.toHaveProperty("actor");
      expect(observation.result).not.toHaveProperty("performer");
    }
  });

  it("keeps all eight T character readings within shortlisting acceptance without assigning a role", () => {
    const characters = CHARACTERS.filter((character) => character.code[1] === "T");
    expect(characters).toHaveLength(8);
    for (const character of characters) {
      const result = buildResult(characterAnswers(character.code));
      const profile = result.domains.find((entry) => entry.domain === "process");
      expect(result.code).toBe(character.code);
      expect(profile?.votes).toEqual({ left: 0, right: 3 });
      expect(profile?.counts.bothHigh).toBe(3);
      expect(profile?.summary).toContain("한 사람이 초기 후보를 추려 공유하는 방식의 수용");
      expect(processReading(result)).not.toMatch(roleExpansion);
      expect(result.character?.tagline).toContain("한 사람이");
      expect(result.character?.tagline).toContain("공유");
    }
  });

  it("keeps J4/T5 couple prompts within shortlisting acceptance even when the selected item is J", () => {
    const answers = independentQaCounterexample();
    const result = buildComparison(answers, answers);
    const processItems = result.items.filter((entry) => entry.item.domain === "process");
    const firstJ = processItems.find((entry) => entry.item.facet === "J");
    expect(processItems).toHaveLength(6);
    expect(firstJ?.first).toEqual(rated(4));
    expect(firstJ?.second).toEqual(rated(4));
    expect(firstJ?.relation).toBe("same");
    expect(firstJ?.strength).toBe("same");
    for (const entry of processItems) {
      expect(entry.prompt).toContain("합의한 기준");
      expect(entry.prompt).toContain("초기 후보");
      expect(entry.prompt).toContain("받아들이는 정도");
      expect(entry.prompt).toContain("누가");
      expect(entry.prompt).toContain("별도로");
      expect(entry.prompt).not.toMatch(roleExpansion);
      expect(result.conversations.find((conversation) => conversation.itemId === entry.item.id)?.text).toBe(entry.prompt);
    }
    expect(result.first.code).toBe("CTOL");
    expect(result.first.domains.find((entry) => entry.domain === "process")?.votes).toEqual({ left: 0, right: 3 });
  });

  it("includes unresolved process conversations while preserving their unmeasured answers", () => {
    const items = ITEMS.filter((item) => item.domain === "process");
    const first: Answers = {};
    const second: Answers = {};
    items.forEach((item, index) => {
      if (index % 4 === 0) first[item.id] = { status: "unknown" };
      if (index % 4 === 1) first[item.id] = { status: "not_applicable" };
      if (index % 4 === 2) first[item.id] = { status: "skipped" };
      second[item.id] = rated(4);
    });
    const result = buildComparison(first, second);
    for (const entry of result.items.filter((item) => item.item.domain === "process")) {
      expect(entry.relation).toBe("unavailable");
      expect(entry.strength).toBeNull();
      expect(entry.first).toEqual(first[entry.item.id] ?? null);
      expect(entry.second).toEqual(rated(4));
      expect(entry.prompt).toContain("합의한 기준");
      expect(entry.prompt).toContain("초기 후보");
      expect(entry.prompt).toContain("받아들이는 정도");
      expect(entry.prompt).toContain("누가");
      expect(entry.prompt).toContain("별도로");
      expect(entry.prompt).not.toMatch(roleExpansion);
    }
    expect(result.conversations).toHaveLength(ITEMS.length);
    for (const entry of result.items.filter((item) => item.item.domain === "process")) {
      const conversation = result.conversations.find((candidate) => candidate.itemId === entry.item.id);
      expect(conversation).toMatchObject({
        sceneId: entry.item.sceneId,
        relation: "unavailable",
        first: entry.first,
        second: entry.second,
        text: entry.prompt,
      });
    }
  });
});

describe("Likert report evidence boundaries", () => {
  it("links every scene reading to its unchanged original questions and answers", () => {
    const answers: Answers = Object.fromEntries(ITEMS.map(item => [item.id, rated(4)]));
    const before = JSON.stringify(answers);
    const result = buildResult(answers);
    expect(result.sceneReadings).toHaveLength(12);
    expect(result.sceneReadings.flatMap(reading => reading.entries).map(entry => entry.item.id)).toEqual(ITEMS.map(item => item.id));
    for (const reading of result.sceneReadings) {
      expect(reading.entries.every(entry => entry.item.sceneId === reading.sceneId && entry.answer?.status === "rated" && entry.answer.value === 4)).toBe(true);
      expect(reading.observation).toContain("4 · 그렇다");
      expect(reading.possibleReading).not.toBeNull();
      expect(reading.selfCheck).not.toBe("");
      expect(reading.partnerRequest).toContain(reading.title);
    }
    expect(JSON.stringify(answers)).toBe(before);
  });

  it("keeps requests unset for neutral, low and unavailable scene responses", () => {
    for (const answer of [rated(1), rated(2), rated(3), { status: "unknown" }, { status: "not_applicable" }, { status: "skipped" }] satisfies Answer[]) {
      const answers: Answers = Object.fromEntries(ITEMS.map(item => [item.id, answer]));
      for (const reading of buildResult(answers).sceneReadings) expect(reading.partnerRequest).toBeNull();
    }
    for (const reading of buildResult({}).sceneReadings) {
      expect(reading.possibleReading).toBeNull();
      expect(reading.partnerRequest).toBeNull();
      expect(reading.observation).toContain("아직 답하지 않았어요");
    }
  });

  it("produces different scene readings for the strict same-CJOL listening and organizing counterexample", () => {
    const first: Answers = Object.fromEntries(ITEMS.map(item => [item.id, rated(["C", "J", "O", "L"].includes(item.facet) ? 5 : 1)]));
    const second: Answers = { ...first,
      "likert.support.contact.L.v1": rated(1),
      "likert.support.contact.A.v1": rated(5),
      "likert.support.contact.alone-rest.v1": rated(5),
    };
    const result = buildComparison(first, second);
    expect(result.first.code).toBe("CJOL");
    expect(result.second.code).toBe("CJOL");
    expect(result.first.character?.name).toBe("세심한 수달");
    expect(result.second.character?.name).toBe("세심한 수달");
    const support = result.sceneReadings.filter(reading => reading.first.domain === "support");
    expect(support).toHaveLength(3);
    for (const reading of support) {
      expect(reading.first.partnerRequest).toContain("내 이야기 경청");
      expect(reading.first.partnerRequest).not.toMatch(/메모 정리|잠시 혼자/);
    }
    for (const reading of support.slice(0, 2)) expect(reading.second.partnerRequest).toContain("내 이야기 경청");
    const contact = support[2];
    expect(contact.observation).toContain("다른 칸 3개");
    expect(contact.second.observation).toContain("내 이야기 경청: 1 · 전혀 그렇지 않다");
    expect(contact.second.partnerRequest).toContain("업체 답변 메모 정리");
    expect(contact.second.partnerRequest).toContain("잠시 혼자 쉴 시간");
    expect(contact.second.partnerRequest).not.toContain("내 이야기 경청");
    expect(contact.second.possibleReading).not.toMatch(/회피|거절|관계|거리 두|감정|고민|위로/);
    expect(contact.second.entries.map(entry => entry.answer)).toEqual([rated(1), rated(5), rated(1), rated(5)]);
  });

  it("makes money requests scene-specific even when the code is unchanged", () => {
    const first: Answers = Object.fromEntries(ITEMS.map(item => [item.id, rated(["C", "J", "O", "L"].includes(item.facet) ? 5 : 1)]));
    const second: Answers = { ...first, "likert.money.venue.C.v1": rated(1), "likert.money.venue.E.v1": rated(5) };
    const result = buildComparison(first, second);
    expect(result.first.code).toBe(result.second.code);
    const venue = result.sceneReadings.find(reading => reading.sceneId === "likert.money.venue.v1");
    expect(venue?.first.partnerRequest).toContain("좌석 편의 보강");
    expect(venue?.first.partnerRequest).not.toContain("조명");
    expect(venue?.second.partnerRequest).toContain("원했던 조명 연출 추가");
    expect(venue?.second.partnerRequest).not.toContain("좌석");
    expect(venue?.first.selfCheck).toContain("실제 추가 비용");
  });

  it("keeps T acceptance and L listening within the actual item meaning in scene readings", () => {
    const result = buildResult(independentQaCounterexample());
    for (const reading of result.sceneReadings.filter(reading => reading.domain === "process")) {
      expect(reading.possibleReading).toContain("분담 수용");
      expect(reading.partnerRequest).toContain("받아들일 수 있어");
      expect(reading.partnerRequest).toContain("누가 후보를 추릴지는 따로");
      expect([reading.possibleReading, reading.selfCheck, reading.partnerRequest].join(" ")).not.toMatch(roleExpansion);
    }
    for (const reading of result.sceneReadings.filter(reading => reading.domain === "support")) {
      expect(reading.partnerRequest).toContain("내 이야기 경청");
      expect([reading.possibleReading, reading.selfCheck, reading.partnerRequest].join(" ")).not.toMatch(/감정|고민|위로|해결/);
    }
  });

  it("creates no support request from absent, unknown, non-applicable or skipped answers", () => {
    const cases = [
      { answer: undefined, count: "unanswered" },
      { answer: { status: "unknown" }, count: "unknown" },
      { answer: { status: "not_applicable" }, count: "notApplicable" },
      { answer: { status: "skipped" }, count: "skipped" },
    ] as const;
    for (const scenario of cases) {
      const answers: Answers = {};
      if (scenario.answer) for (const item of ITEMS) answers[item.id] = scenario.answer;
      const result = buildResult(answers);
      expect(result.requests).toEqual([]);
      for (const scene of result.supportScenes) {
        expect(scene.request).toBeNull();
        expect(scene.endorsed).toEqual([]);
        expect(scene.responseCounts).toMatchObject({ rated: 0, endorsed: 0, low: 0, middle: 0, [scenario.count]: 4 });
      }
    }
  });

  it("distinguishes all low from all midpoint support answers without generating a request", () => {
    for (const value of [1, 2, 3] as const) {
      const answers: Answers = {};
      for (const item of ITEMS) answers[item.id] = rated(value);
      const result = buildResult(answers);
      expect(result.requests).toEqual([]);
      for (const scene of result.supportScenes) {
        expect(scene.request).toBeNull();
        expect(scene.responseCounts).toEqual({
          rated: 4, endorsed: 0, low: value < 3 ? 4 : 0, middle: value === 3 ? 4 : 0,
          unknown: 0, notApplicable: 0, skipped: 0, unanswered: 0,
        });
      }
    }
  });

  it("grounds a partial support request in its endorsed item and preserves the other states", () => {
    const tour = ITEMS.filter((item) => item.sceneId === "likert.support.tour.v1");
    const answers: Answers = {};
    for (const item of tour) {
      answers[item.id] = item.facet === "L" ? rated(4)
        : item.facet === "A" ? rated(2)
          : item.facet === "together_rest" ? rated(3) : { status: "unknown" };
    }
    const result = buildResult(answers);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({ sceneId: "likert.support.tour.v1", facets: ["L"] });
    expect(result.requests[0].request).toContain("내 이야기를 들어주는 것");
    expect(result.requests[0].request).not.toMatch(/메모|함께 잠깐 쉬|혼자 쉬/);
    expect(result.supportScenes[0].responseCounts).toEqual({
      rated: 3, endorsed: 1, low: 1, middle: 1, unknown: 1, notApplicable: 0, skipped: 0, unanswered: 0,
    });
    expect(result.supportScenes[1].request).toBeNull();
    expect(result.supportScenes[2].request).toBeNull();
  });

  it("shows independent endorsement ratios even when both facets are 100 percent", () => {
    const profile = domainResult({ ...facetAnswers("C", [5, 5, 5]), ...facetAnswers("E", [4, 4, 4]) }, "money");
    expect(profile.primary).toBe("C");
    expect(profile.votes).toEqual({ left: 3, right: 0 });
    expect(profile.facets.map((facet) => facet.ratio)).toEqual([
      { numerator: 3, denominator: 3, percent: 100 },
      { numerator: 3, denominator: 3, percent: 100 },
    ]);
    expect(profile.counts.bothHigh).toBe(3);
  });

  it("uses each facet's rated denominator and leaves zero-denominator percentages unset", () => {
    const answers: Answers = { ...facetAnswers("C", [5, 2]), ...facetAnswers("E", [4, 5, 5]) };
    const thirdC = ITEMS.filter((item) => item.facet === "C")[2];
    answers[thirdC.id] = { status: "unknown" };
    const money = domainResult(answers, "money");
    expect(money.facets[0].ratio).toEqual({ numerator: 1, denominator: 2, percent: 50 });
    expect(money.facets[1].ratio).toEqual({ numerator: 3, denominator: 3, percent: 100 });
    for (const facet of domainResult(answers, "support").facets) {
      expect(facet.ratio).toEqual({ numerator: 0, denominator: 0, percent: null });
    }
    const thirds = domainResult({ ...facetAnswers("C", [4, 3, 2]), ...facetAnswers("E", [1, 1, 1]) }, "money");
    expect(thirds.facets[0].ratio.percent).toBeCloseTo(100 / 3);
    expect(thirds.facets[1].ratio).toEqual({ numerator: 0, denominator: 3, percent: 0 });
  });

  it("names equal representative votes without claiming the same wishes in each scene", () => {
    const profile = domainResult({ ...facetAnswers("C", [5, 1, 3]), ...facetAnswers("E", [1, 5, 3]) }, "money");
    expect(profile.primary).toBeNull();
    expect(profile.votes).toEqual({ left: 1, right: 1 });
    expect(profile.counts.bothHigh).toBe(0);
    expect(profile.labels).toContain("대표 표 동수");
    expect(profile.labels).toContain("장면 따라");
    expect(profile.labels).not.toContain("양쪽 비슷");
    expect(profile.labels).not.toContain("두 마음 함께");
    expect(profile.scenes.map((scene) => scene.winner)).toEqual(["C", "E", null]);
  });

  it("states the observed scene coverage while keeping the existing one-scene letter rule", () => {
    const profile = domainResult({ ...facetAnswers("J", [5]), ...facetAnswers("T", [4]) }, "process");
    expect(profile.primary).toBe("J");
    expect(profile.votes).toEqual({ left: 1, right: 0 });
    expect(profile.counts.complete).toBe(1);
    expect(profile.counts.missing).toBe(2);
    expect(profile.summary).toContain("1/3");
    expect(profile.summary).toContain("비교하지 않은 장면 2개");
    expect(profile.labels).toContain("확인 중");
  });

  it("preserves different support wishes and conversations for two people with the same CJOL code", () => {
    const first = characterAnswers("CJOL");
    const second = {
      ...characterAnswers("CJOL"),
      ...facetAnswers("L", [5, 5, 4]), ...facetAnswers("A", [4, 4, 5]),
      ...facetAnswers("alone_rest", [2, 2, 5]),
    };
    const result = buildComparison(first, second);
    expect(result.first.code).toBe("CJOL");
    expect(result.second.code).toBe("CJOL");
    expect(result.first.supportScenes[2].topEndorsed).toEqual(["L"]);
    expect(result.second.supportScenes[2].topEndorsed).toEqual(["A", "alone_rest"]);
    expect(result.first.requests[2].request).not.toBe(result.second.requests[2].request);
    const rest = ITEMS.find((item) => item.id === "likert.support.contact.alone-rest.v1");
    if (!rest) throw new Error("Missing support rest counterexample");
    expect(result.conversations.find((entry) => entry.itemId === rest.id)).toMatchObject({
      sceneId: rest.sceneId, relation: "different_direction", first: rated(2), second: rated(5),
    });
    expect(result.items.find((entry) => entry.item.id === rest.id)?.item.text).toBe(rest.text);
  });
});
