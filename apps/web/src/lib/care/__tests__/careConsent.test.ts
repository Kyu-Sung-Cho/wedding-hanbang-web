import { describe, expect, it } from "vitest";
import { hasUnanimousCareConsent } from "@/lib/care/careConsent";

describe("shared proactive-care consent", () => {
  const consented = (id: string) => ({
    id,
    care_notifications_enabled: true,
    care_notifications_consented_at: "2026-07-16T00:00:00.000Z",
  });

  it("allows a one-member couple after that member explicitly opts in", () => {
    expect(hasUnanimousCareConsent(["bride"], [consented("bride")])).toBe(true);
  });

  it("requires every linked partner for a shared proactive message", () => {
    expect(hasUnanimousCareConsent(["bride", "groom"], [consented("bride")])).toBe(false);
    expect(hasUnanimousCareConsent(
      ["bride", "groom"],
      [consented("bride"), consented("groom")],
    )).toBe(true);
  });

  it("treats a historical true without a consent timestamp as not consented", () => {
    expect(hasUnanimousCareConsent(["bride"], [{
      id: "bride",
      care_notifications_enabled: true,
      care_notifications_consented_at: null,
    }])).toBe(false);
  });

  it("fails closed when there is no linked member", () => {
    expect(hasUnanimousCareConsent([], [])).toBe(false);
  });
});
