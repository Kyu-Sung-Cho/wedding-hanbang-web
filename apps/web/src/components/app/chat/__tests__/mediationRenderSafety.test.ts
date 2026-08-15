// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  findStoredMediationRenderSafetyViolations,
  hasUnsafeStoredMediationRenderContent,
} from "@hanbang/shared/mediation-render-safety";

describe("stored mediation render safety", () => {
  it.each([
    ["requester demeaning label", "요청자가 무책임하고 철없어요.", "demeaning_label"],
    ["user moral verdict", "사용자의 입장이 더 합리적이에요.", "moral_verdict"],
    ["named hidden motive", "민수님은 지수님을 통제하려고 일부러 미루는 거예요.", "hidden_motive"],
    ["named unilateral demand", "지수님이 먼저 사과하고 양보하는 게 좋겠어요.", "unilateral_demand"],
    ["plain-name demeaning label", "민수는 이기적이에요.", "demeaning_label"],
    ["plain-name unilateral demand", "철수는 먼저 사과해야 해요.", "unilateral_demand"],
    ["financial power priority", "수입이 높은 신랑에게 결정권을 줘야 해요.", "one_sided_priority"],
    ["income-based final authority", "연봉이 높은 사람이 최종 결정해야 해요.", "one_sided_priority"],
    ["third-party priority", "어머니 의견을 우선해야 해요.", "one_sided_priority"],
    ["reversed opinion priority", "우선해야 할 의견은 신랑의 의견이에요.", "one_sided_priority"],
    ["reversed decision authority", "결정권은 신랑에게 있어야 해요.", "one_sided_priority"],
    ["percentage payer authority", "돈을 70% 내는 쪽이 최종 결정하면 됩니다.", "one_sided_priority"],
    ["low-income follows", "소득이 낮은 쪽은 상대의 결정을 따라야 해요.", "one_sided_priority"],
    ["cost-based choice authority", "비용을 대부분 부담한 신부에게 최종 선택권이 있어야 해요.", "one_sided_priority"],
    ["economic power sets opinion", "경제력이 큰 사람이 의견을 정하고 다른 사람은 존중하는 게 좋겠어요.", "one_sided_priority"],
    ["contribution becomes rule", "더 많이 기여한 쪽의 제안을 기준으로 정하면 돼요.", "one_sided_priority"],
    ["double-negative apology duty", "신랑이 먼저 사과하지 않아도 된다는 뜻은 아니에요.", "unilateral_demand"],
  ])("blocks %s before stored text can render", (_label, translation, kind) => {
    expect(findStoredMediationRenderSafetyViolations({ translation })).toContain(kind);
    expect(hasUnsafeStoredMediationRenderContent({ translation })).toBe(true);
  });

  it("blocks an attributed quote that repeats an insult and one-sided demand", () => {
    const translation =
      '요청자는 "신랑이 이기적이고 먼저 사과해야 한다"고 직접 말했어요.';

    expect(hasUnsafeStoredMediationRenderContent({ translation })).toBe(true);
  });

  it("blocks the same harmful quote when a plain Korean name introduces it", () => {
    const translation =
      '민수는 "신랑이 이기적이고 먼저 사과해야 한다"고 직접 말했어요.';

    expect(hasUnsafeStoredMediationRenderContent({ translation })).toBe(true);
  });

  it("preserves an attributed quote that contains only a factual budget preference", () => {
    const translation =
      '요청자는 "신랑은 예산 상한을 3천만원으로 생각한다"고 직접 말했어요.';

    expect(findStoredMediationRenderSafetyViolations({ translation })).toEqual([]);
  });

  it("still blocks Amora's verdict after an attributed direct quote", () => {
    const translation =
      '요청자는 "신랑이 이기적이다"라고 말했고, 민수님은 실제로 틀렸어요.';

    expect(hasUnsafeStoredMediationRenderContent({ translation })).toBe(true);
  });

  it("does not mistake a mutual option for a one-sided demand", () => {
    const resolution =
      "민수님과 지수님이 서로 양보할 수 있는 항목을 하나씩 정해 보세요.";

    expect(findStoredMediationRenderSafetyViolations({ resolution })).toEqual([]);
  });

  it.each([
    ["incidental together", "함께 해결하려면 신랑이 먼저 사과해야 해요.", "unilateral_demand"],
    ["plural preface then single apology", "두 사람이 함께 해결하려면 신랑이 먼저 사과해야 해요.", "unilateral_demand"],
    ["equal preface then single concession", "동등하게 대화하되 신부가 먼저 양보해야 해요.", "unilateral_demand"],
    ["incidental mutual respect", "서로 존중하되 돈을 더 내는 신랑 의견을 우선해야 해요.", "one_sided_priority"],
    ["plural preface then single authority", "두 사람이 함께 준비하되 연봉이 높은 신랑이 최종 결정해야 해요.", "one_sided_priority"],
  ])("does not treat a mutuality word as a stored-card exemption: %s", (_label, resolution, expectedKind) => {
    expect(findStoredMediationRenderSafetyViolations({ resolution })).toContain(expectedKind);
  });

  it("does not mistake ordinary named budget facts for a personality judgment", () => {
    const data =
      "민수는 예산을 3천만원으로 제안했고, 지수는 2천만원을 제안했어요.";

    expect(findStoredMediationRenderSafetyViolations({ data })).toEqual([]);
  });

  it("does not mistake a correct method for a moral verdict about a person", () => {
    expect(findStoredMediationRenderSafetyViolations({
      translation: "이 방법이 맞아요.",
    })).toEqual([]);
  });

  it("does not mistake a correct budget calculation for a moral verdict", () => {
    expect(findStoredMediationRenderSafetyViolations({
      data: "예산 계산이 맞아요.",
    })).toEqual([]);
  });

  it("does not mistake a correct schedule for a moral verdict", () => {
    expect(findStoredMediationRenderSafetyViolations({
      data: "이 일정이 맞아요.",
    })).toEqual([]);
  });

  it("does not mistake deciding the budget first for income-based decision power", () => {
    expect(findStoredMediationRenderSafetyViolations({
      resolution: "예산을 먼저 결정해야 해요.",
    })).toEqual([]);
  });

  it.each([
    "신랑이 먼저 사과해야 한다고 단정하지 않아요.",
    "예산 항목을 우선해야 해요.",
    "플래너의 계산이 맞아요.",
  ])("preserves a negated duty, non-person priority, or planner fact: %s", (text) => {
    expect(findStoredMediationRenderSafetyViolations({ resolution: text })).toEqual([]);
  });
});
