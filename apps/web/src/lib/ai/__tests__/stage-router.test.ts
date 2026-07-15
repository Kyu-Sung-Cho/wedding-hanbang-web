import { describe, expect, it } from "vitest";
import { determineStage, getSpecialistPromptAddon, routeSpecialist } from "../stage-router";

describe("determineStage KST calendar boundaries", () => {
  it("treats the whole same KST calendar day as the ceremony day", () => {
    expect(determineStage("2026-07-11", new Date("2026-07-10T15:00:01.000Z"))).toBe(
      "ceremony_3"
    );
    expect(determineStage("2026-07-11", new Date("2026-07-11T14:59:59.000Z"))).toBe(
      "ceremony_3"
    );
  });

  it("moves to settlement only after KST midnight", () => {
    expect(determineStage("2026-07-11", new Date("2026-07-11T15:00:00.000Z"))).toBe(
      "settlement_4"
    );
  });

  it("keeps exact 30 and 180 day thresholds stable", () => {
    const now = new Date("2026-07-10T15:00:00.000Z");
    expect(determineStage("2026-08-10", now)).toBe("execution_2");
    expect(determineStage("2027-01-07", now)).toBe("preparation_1");
    expect(determineStage("2027-01-08", now)).toBe("planning_0");
  });

  it("rejects impossible date-only values", () => {
    expect(determineStage("2026-02-30", new Date("2026-02-01T00:00:00.000Z"))).toBe(
      "planning_0"
    );
  });
});

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

  it.each([
    "sangkyeonrye_advisor",
    "ceremony_coordinator",
    "settlement_companion",
    "general",
  ] as const)("keeps optional customs optional for %s", (specialist) => {
    const addon = getSpecialistPromptAddon(specialist);

    expect(addon).toContain("선택 사항");
    expect(addon).toContain("적용 여부");
    expect(addon).toContain("성별 역할");
    expect(addon).not.toContain("리허설 필수");
    expect(addon).not.toContain("시가댁·친정 예절");
  });
});
