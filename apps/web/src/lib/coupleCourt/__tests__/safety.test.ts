import { describe, expect, it } from "vitest";
import { assessCourtSafety } from "@/lib/coupleCourt/safety";
import { COURT_SAFETY_RESOURCES } from "@/lib/coupleCourt/support";
import type { CourtSafetyRiskType } from "@/lib/coupleCourt/types";

describe("assessCourtSafety", () => {
  it.each<[CourtSafetyRiskType, string]>([
    ["self_harm", "요즘 계속 죽고 싶다고 생각해요."],
    ["violence", "상대가 저를 때렸어요."],
    ["threat", "사진을 퍼뜨리겠다고 협박했어요."],
    ["confinement", "문을 잠그고 방에 가뒀어요."],
    ["stalking", "싫다는데 집 앞에서 매일 기다렸어요."],
    ["coercive_control", "친구를 못 만나게 하고 휴대폰을 검사해요."],
    ["sexual_coercion", "싫다는데 성관계를 강요했어요."],
    ["financial_control", "월급 통장을 빼앗고 생활비를 끊었어요."],
    ["harm_to_others", "가족을 해치려고 한다고 말했어요."],
  ])("detects %s before a provider call", (category, text) => {
    const result = assessCourtSafety(text);
    expect(result.level).toBe("high_risk");
    expect(result.categories).toContain(category);
    expect(result.resourceMessage).toMatch(/112|119/);
    expect(JSON.stringify(result)).not.toContain(text);
  });

  it("does not treat ordinary wedding hyperbole and budget language as imminent harm", () => {
    const result = assessCourtSafety(
      "일정 때문에 죽겠어요. 웨딩홀 계약금이 묶였고 가격이 폭탄처럼 느껴져요.",
    );
    expect(result).toEqual({ level: "normal", categories: [] });
  });

  it.each([
    "남자친구가 저를 때려요.",
    "요즘 계속 맞고 있어요.",
    "상대방이 손찌검을 했어요.",
  ])("catches common present-tense violence wording: %s", (text) => {
    expect(assessCourtSafety(text).level).toBe("high_risk");
    expect(assessCourtSafety(text).categories).toContain("violence");
  });

  it.each([
    "죽여버린다고 협박했어요.",
    "가족을 해치겠다고 말했어요.",
  ])("catches common explicit threat wording: %s", (text) => {
    expect(assessCourtSafety(text).level).toBe("high_risk");
  });

  it.each([
    "파혼하면 죽어버리겠다고 협박해요.",
    "결혼 안 하면 자기가 죽을 거래요.",
    "헤어지면 자해하겠대요.",
    "결혼을 안 하면 죽을게라고 해요.",
    "결혼 안 해주면 죽겠대요.",
    "헤어지면 죽겠다고 협박했어요.",
    "파혼하면 목숨을 끊겠대요.",
    "떠나면 자해할 거야라고 말했어요.",
  ])("treats conditional self-harm threats as self-harm and coercive control: %s", (text) => {
    const result = assessCourtSafety(text);
    expect(result.level).toBe("high_risk");
    expect(result.categories).toEqual(expect.arrayContaining(["self_harm", "coercive_control"]));
  });

  it("treats a murder-suicide phrase as danger to self and others", () => {
    const result = assessCourtSafety("상대가 같이 죽자고 반복해서 말해요.");
    expect(result.level).toBe("high_risk");
    expect(result.categories).toEqual(expect.arrayContaining(["self_harm", "harm_to_others"]));
  });

  it("marks explicit verbal abuse as sensitive without inventing a high-risk category", () => {
    expect(assessCourtSafety("상대가 반복해서 욕설을 했어요.")).toEqual({
      level: "sensitive",
      categories: [],
    });
  });

  it("keeps reviewed Korean emergency and crisis resources in one registry", () => {
    expect(COURT_SAFETY_RESOURCES.map((resource) => resource.phone)).toEqual([
      "112",
      "119",
      "109",
      "1366",
    ]);
    expect(COURT_SAFETY_RESOURCES.every((resource) => resource.href === `tel:${resource.phone}`)).toBe(true);
  });
});
