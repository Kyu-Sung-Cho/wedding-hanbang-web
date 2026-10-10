import { describe, expect, it } from "vitest";
import { ITEMS21, VERSIONS, createEmptyAnswers } from "./bank";
import { comparePreferences21Responses } from "./compare";

function input(answers: unknown, versions: unknown = VERSIONS) { return { versions, answers }; }

describe("21문항 실제 답 비교 계약", () => {
  it("compares each shared numeric question without collapsing identical totals into one result", () => {
    const own = { ...createEmptyAnswers(), Q05: 5, Q06: 1, Q11: 4 };
    const partner = { ...createEmptyAnswers(), Q05: 1, Q06: 5, Q11: 4 };
    const result = comparePreferences21Responses(input(own), input(partner));
    if (result.status !== "ready") throw new Error("Expected comparison");
    expect(result).toMatchObject({ numericCompared: 3, sameNumeric: 1, differentNumeric: 2 });
    expect(result.rows.find((row) => row.itemId === "Q05")).toMatchObject({ ownResponse: 5, partnerResponse: 1, state: "different-answers" });
    expect(result.rows.find((row) => row.itemId === "Q06")).toMatchObject({ ownResponse: 1, partnerResponse: 5, state: "different-answers" });
    expect(result.rows.find((row) => row.itemId === "Q11")).toMatchObject({ ownResponse: 4, partnerResponse: 4, state: "same-answer" });
    expect(JSON.stringify(result)).not.toMatch(/score|percentage|궁합 점수|양보해야|당신은/u);
    expect(result.notice).toContain("합의한 사실은 아직 아니에요");
  });
  it("keeps unknown, nonapplicable, skipped and unanswered different and does not compare them numerically", () => {
    const own = { ...createEmptyAnswers(), Q01: "unknown", Q02: "not-applicable", Q03: "skipped", Q05: 5 };
    const partner = { ...createEmptyAnswers(), Q01: "unknown", Q02: 1, Q03: null, Q04: "skipped", Q05: 3 };
    const result = comparePreferences21Responses(input(own), input(partner));
    if (result.status !== "ready") throw new Error("Expected comparison");
    expect(result.numericCompared).toBe(1);
    expect(result.rows.slice(0, 4).every((row) => row.state === "needs-answer")).toBe(true);
    expect(result.rows[0]).toMatchObject({ ownLabel: "아직 모르겠어요", partnerLabel: "아직 모르겠어요" });
    expect(result.rows[1].ownLabel).toBe("나에게 해당하지 않아요");
    expect(result.rows[2]).toMatchObject({ ownLabel: "지금 답하지 않을게요", partnerLabel: "아직 답하지 않았어요" });
  });
  it("uses the exact question and situation and invites a two-person decision", () => {
    const result = comparePreferences21Responses(input({ ...createEmptyAnswers(), Q18: 5 }), input({ ...createEmptyAnswers(), Q18: 1 }));
    if (result.status !== "ready") throw new Error("Expected comparison");
    expect(result.rows).toHaveLength(21);
    const row = result.rows.find((item) => item.itemId === "Q18");
    expect(row?.statement).toBe(ITEMS21[17].statement);
    expect(row?.context).toContain("바로 처리해야 할 일은 없고");
    expect(row?.question.length).toBeGreaterThan(0);
    expect(row?.action.length).toBeGreaterThan(0);
  });
  it("does not give final authority to one person when invitation-choice answers differ", () => {
    for (const [first, second] of [[5, 1], [1, 5]]) {
      const result = comparePreferences21Responses(input({ ...createEmptyAnswers(), Q08: first }), input({ ...createEmptyAnswers(), Q08: second }));
      if (result.status !== "ready") throw new Error("Expected comparison");
      const row = result.rows.find((item) => item.itemId === "Q08");
      expect(row?.question).toContain("각자");
      expect(row?.action).toContain("둘 다 편한 방식을 확인");
      expect(row?.action).not.toMatch(/네가 해도|맡겨|양보/u);
    }
  });
  it.each(["questionnaireVersion", "interpretationVersion", "displayVersion"])("blocks a mixed %s", (key) => {
    expect(comparePreferences21Responses(input(createEmptyAnswers()), input(createEmptyAnswers(), { ...VERSIONS, [key]: "old" })).status).toBe("version-mismatch");
  });
  it.each([null, [], {}, { versions: VERSIONS, answers: Array(30).fill(5) }, input({ ...createEmptyAnswers(), Q01: 0 }), input({ ...createEmptyAnswers(), Q22: 5 }), { ...input(createEmptyAnswers()), score: 100 }])("fails closed for invalid input %j", (value) => {
    expect(comparePreferences21Responses(input(createEmptyAnswers()), value).status).toBe("invalid");
  });
  it("returns identical content for the same actual answers", () => {
    const own = input({ ...createEmptyAnswers(), Q20: 5, Q21: 5 });
    expect(comparePreferences21Responses(own, own)).toEqual(comparePreferences21Responses(own, own));
  });
});
