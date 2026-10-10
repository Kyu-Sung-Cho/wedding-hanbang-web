import { beforeEach, describe, expect, it, vi } from "vitest";
import { ITEMS21, VERSIONS, createEmptyAnswers } from "./bank";
import type { ItemId } from "./types";
import { buildPreferences21AmoraDraft } from "./amora";

describe("21문항 아모라 미전송 초안 계약", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });
  it("only drafts selected own nonfamily preferences with exact source and response", () => {
    const answers = { ...createEmptyAnswers(), Q01: 5, Q05: 4, Q13: 5, Q17: 5 };
    const draft = buildPreferences21AmoraDraft(answers, ["Q05", "Q17"]);
    expect(draft).not.toBeNull();
    expect(draft?.itemIds).toEqual(["Q05", "Q17"]);
    expect(draft?.text).toContain(ITEMS21[4].statement);
    expect(draft?.text).toContain("내 답: 대체로 맞아요");
    expect(draft?.text).toContain("내 답: 아주 잘 맞아요");
    for (const version of Object.values(VERSIONS)) expect(draft?.text).toContain(version);
    expect(draft?.text).not.toContain(ITEMS21[0].statement);
    expect(draft?.text).not.toMatch(/Q13|Q14|Q15|Q16|가족/u);
    expect(draft?.notice).toContain("아직 아모라에 보내지 않은 초안");
    expect(draft?.text).toContain("바꾸기 전에는 따로 확인");
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
  it("does not infer selections, accept family, duplicates, nonnumeric or too many items", () => {
    const answers = { ...createEmptyAnswers(), Q01: 5, Q02: 5, Q03: 5, Q04: 5, Q05: 5, Q06: 5, Q13: 5, Q17: "unknown", Q18: "not-applicable", Q19: "skipped" };
    const selections: ItemId[][] = [[], ["Q13"], ["Q01", "Q01"], ["Q17"], ["Q18"], ["Q19"], ["Q20"], ["Q01", "Q02", "Q03", "Q04", "Q05", "Q06"]];
    for (const selection of selections) expect(buildPreferences21AmoraDraft(answers, selection)).toBeNull();
    expect(buildPreferences21AmoraDraft(Array(30).fill(5), ["Q01"])).toBeNull();
  });
  it("does not mutate profile, decisions, storage or call a network client", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const answers = { ...createEmptyAnswers(), Q11: 5 };
    const before = JSON.stringify(answers);
    const draft = buildPreferences21AmoraDraft(answers, ["Q11"]);
    expect(draft).not.toBeNull();
    expect(JSON.stringify(answers)).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(Object.isFrozen(draft?.itemIds)).toBe(true);
  });
});
