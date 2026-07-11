import { describe, expect, it } from "vitest";
import { getSpecialistPromptAddon, routeSpecialist } from "../stage-router";

describe("routeSpecialist contract intent", () => {
  it.each([
    "이 계약서 검토해줘",
    "환불 받을 수 있어?",
    "이 조항이 불리한지 봐줘",
    "업체 계약을 취소하면 위약금이 있어?",
    "이 조건으로 계약해도 괜찮을까?",
  ])("routes explicit contract review to the specialist: %s", (message) => {
    expect(routeSpecialist(message, "preparation_1")).toBe("contract_reviewer");
  });

  it.each([
    "계약했어",
    "스드메 계약 완료했어",
    "계약 일정은 다음 주야",
    "추가금이 얼마야",
    "일정을 취소하고 싶어",
  ])("does not escalate a status or ordinary planning phrase: %s", (message) => {
    expect(routeSpecialist(message, "preparation_1")).not.toBe("contract_reviewer");
  });

  it("limits legal guidance to supplied evidence and external verification", () => {
    const addon = getSpecialistPromptAddon("contract_reviewer");

    expect(addon).toContain("사용자가 제공한");
    expect(addon).toContain("공식 근거");
    expect(addon).toContain("법적 효력");
    expect(addon).toContain("1372");
    expect(addon).not.toContain("조항을 숙지");
    expect(addon).not.toContain("구체 수치로 안내");
  });
});
