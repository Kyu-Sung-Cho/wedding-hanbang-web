import { describe, expect, it } from "vitest";
import { ITEMS } from "./bank";
import { buildResult } from "./model";
import type { Answer, Answers, Domain, Rating } from "./types";

const rated = (value: Rating): Answer => ({ status: "rated", value });
const all = (answer: Answer): Answers => Object.fromEntries(ITEMS.map(item => [item.id, { ...answer }]));
const cjol = (): Answers => Object.fromEntries(ITEMS.map(item => [item.id, rated(["C", "J", "O", "L"].includes(item.facet) ? 5 : 1)]));
const insight = (answers: Answers, domain: Domain) => buildResult(answers).insights.filter(entry => entry.includes(buildResult(answers).domains.find(profile => profile.domain === domain)!.title)).join("\n");

describe("원답으로 읽는 장면별 준비 포인트", () => {
  it("distinguishes the same CJOL's listening and contact organizing with alone rest", () => {
    const a = cjol();
    const b = { ...a, "likert.support.contact.L.v1": rated(1), "likert.support.contact.A.v1": rated(5), "likert.support.contact.alone-rest.v1": rated(5) };
    expect(buildResult(a).code).toBe("CJOL");
    expect(buildResult(b).code).toBe("CJOL");
    expect(insight(a, "support")).not.toBe(insight(b, "support"));
    expect(insight(b, "support")).toContain("업체 연락으로 지친 직후");
    expect(insight(b, "support")).toContain("업체 답변 메모 정리 5(매우 그렇다)");
    expect(insight(b, "support")).toContain("혼자 쉬도록 기다리기 5(매우 그렇다)");
    expect(insight(b, "support")).not.toMatch(/회피|거절|상처|애착|궁합/);
  });
  it("detects rest-only differences when code, L/A ratings and representative votes stay identical", () => {
    const a = cjol();
    const b = { ...a, "likert.support.contact.alone-rest.v1": rated(5) };
    expect(buildResult(a).code).toBe(buildResult(b).code);
    expect(buildResult(a).domains[3].votes).toEqual(buildResult(b).domains[3].votes);
    expect(insight(b, "support")).toContain("장면마다 답이 달랐어요");
    expect(insight(b, "support")).toContain("업체 연락으로 지친 직후");
    expect(insight(b, "support")).toContain("혼자 쉬도록 기다리기 5");
  });
  it("distinguishes equal codes and equal money ratios with different venue and meal responses", () => {
    const a = { ...cjol(), "likert.money.meal.C.v1": rated(1), "likert.money.meal.E.v1": rated(5) };
    const b = { ...cjol(), "likert.money.venue.C.v1": rated(1), "likert.money.venue.E.v1": rated(5) };
    expect(buildResult(a).code).toBe(buildResult(b).code);
    expect(buildResult(a).domains[0].facets.map(facet => facet.ratio)).toEqual(buildResult(b).domains[0].facets.map(facet => facet.ratio));
    expect(insight(a, "money")).not.toBe(insight(b, "money"));
    expect(insight(a, "money")).toContain("식사에 더 쓸 예산");
    expect(insight(b, "money")).toContain("예식장에 더 쓸 예산");
  });
  it("preserves independent both-high ratings without converting their sum to 100 or forcing a character", () => {
    const answers = all(rated(5));
    const result = buildResult(answers);
    expect(result.code).toBeNull();
    expect(result.domains[0].facets.map(facet => facet.ratio.percent)).toEqual([100, 100]);
    expect(insight(answers, "money")).toContain("기본 구성 보강 5(매우 그렇다)");
    expect(insight(answers, "money")).toContain("원하는 경험 추가 5(매우 그렇다)");
    expect(insight(answers, "money")).toContain("떠올린 이유가 같았나요");
  });
  it.each([1, 2] as const)("reads all-%i as low answers without inventing no needs", value => {
    const answers = all(rated(value));
    expect(insight(answers, "support")).toContain("답한 문장은 모두 1·2");
    expect(buildResult(answers).requests).toEqual([]);
    expect(insight(answers, "support")).not.toMatch(/도움이 필요 없|혼자 해낼|비용을 아끼|관계/);
  });
  it("asks what midpoint means without treating it as unknown or negative", () => {
    const answers = all(rated(3));
    expect(insight(answers, "money")).toContain("‘보통이다’에는 어떤 뜻");
    expect(buildResult(answers).ratedCount).toBe(30);
    expect(buildResult(answers).statusCounts.unknown).toBe(0);
    expect(buildResult(answers).requests).toEqual([]);
  });
  it("preserves all unavailable statuses and absent answers without calculating 0% or positive wishes", () => {
    const answers: Answers = {
      [ITEMS[0].id]: { status: "unknown" },
      [ITEMS[1].id]: { status: "not_applicable" },
      [ITEMS[2].id]: { status: "skipped" },
    };
    const text = insight(answers, "money");
    expect(text).toContain("모름 1개 · 비해당 1개 · 건너뜀 1개 · 미응답 3개");
    expect(text).toContain("1~5로 남긴 답이 없어");
    expect(buildResult(answers).domains[0].facets.map(facet => facet.ratio.percent)).toEqual([null, null]);
    expect(text).not.toContain("0%");
  });
  it("does not compare a partial pair with a complete pair or infer its missing opposite", () => {
    const answers: Answers = {
      "likert.money.venue.C.v1": rated(5), "likert.money.venue.E.v1": { status: "unknown" },
      "likert.money.photo.C.v1": rated(1), "likert.money.photo.E.v1": rated(5),
    };
    const text = insight(answers, "money");
    expect(text).toContain("기본 구성 보강 5(매우 그렇다)");
    expect(text).toContain("원하는 경험 추가 아직 모르겠어요");
    expect(text).toContain("모든 문장에 1~5로 답하지 않은 장면 2개");
    expect(text).not.toContain("장면마다 답이 달랐어요");
  });
  it("shows a later known partial answer instead of selecting an earlier entirely unanswered scene", () => {
    const answers: Answers = { "likert.money.photo.C.v1": rated(5) };
    const text = insight(answers, "money");
    expect(text).toContain("사진에 더 쓸 예산");
    expect(text).toContain("기본 구성 보강 5(매우 그렇다)");
    expect(text).toContain("원하는 경험 추가 미응답");
    expect(text).not.toContain("장면마다 답이 달랐어요");
  });
  it("keeps T acceptance separate from the person who performs the work", () => {
    const answers = all(rated(1));
    for (const item of ITEMS.filter(item => item.facet === "T")) answers[item.id] = rated(5);
    const text = insight(answers, "process");
    expect(text).toContain("합의한 기준 안에서 한 사람이 초기 후보를 추려 공유하는 방식 수용 5");
    expect(text).toContain("누가 초기 후보를 추릴지는 별도로");
    expect(text).not.toMatch(/맡기|위임|능력|신뢰|참여가 낮/);
  });
  it("preserves raw input, eight insight rows and short requests across all endorsed scenes", () => {
    const answers = cjol();
    const before = JSON.stringify(answers);
    const result = buildResult(answers);
    expect(JSON.stringify(answers)).toBe(before);
    expect(result.insights).toHaveLength(8);
    for (const reading of result.sceneReadings) {
      expect(reading.partnerRequest).not.toBeNull();
      expect(reading.partnerRequest!.split(/[.?]/).filter(sentence => sentence.trim())).toHaveLength(2);
      expect(reading.partnerRequest).toContain(reading.title);
    }
  });
});
