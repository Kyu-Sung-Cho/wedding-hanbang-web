import { describe, expect, it } from "vitest";
import {
  canChangeCareConsent,
  hasCareConsent,
  hasSameCareMemberRoster,
  hasUnanimousCareConsent,
  parseCareAvailability,
} from "@/lib/care/careConsent";

describe("shared proactive-care consent", () => {
  const consented = (id: string) => ({
    id,
    care_notifications_enabled: true,
    care_notifications_consented_at: "2026-07-16T00:00:00.000Z",
  });

  it("requires both the enabled flag and an explicit consent timestamp", () => {
    expect(hasCareConsent(consented("bride"))).toBe(true);
    expect(hasCareConsent({
      ...consented("bride"),
      care_notifications_consented_at: null,
    })).toBe(false);
    expect(hasCareConsent({
      ...consented("bride"),
      care_notifications_enabled: false,
    })).toBe(false);
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

  it("rejects a stale email recipient snapshot after a member leaves or is replaced", () => {
    expect(hasSameCareMemberRoster(["bride", "groom"], ["groom", "bride"])).toBe(true);
    expect(hasSameCareMemberRoster(["bride", "groom"], ["bride", "new-groom"])).toBe(false);
    expect(hasSameCareMemberRoster(["bride", "groom"], ["bride"])).toBe(false);
  });

  it("allows opt-out during an outbound pause but blocks a new opt-in", () => {
    const paused = parseCareAvailability({
      outboundEnabled: false,
      emailVerified: true,
    });

    expect(paused).toEqual({ outboundEnabled: false, proactiveChatEnabled: false, emailVerified: true });
    expect(canChangeCareConsent(false, paused)).toBe(false);
    expect(canChangeCareConsent(true, paused)).toBe(true);
    expect(canChangeCareConsent(false, null)).toBe(false);
    expect(canChangeCareConsent(false, {
      outboundEnabled: true,
      emailVerified: false,
    })).toBe(true);
  });

  it("인앱 선제 대화만 켜져 있어도 새 동의를 허용한다 (이메일 스위치와 독립)", () => {
    const inAppOnly = parseCareAvailability({
      outboundEnabled: false,
      proactiveChatEnabled: true,
      emailVerified: false,
    });

    expect(inAppOnly).toEqual({ outboundEnabled: false, proactiveChatEnabled: true, emailVerified: false });
    expect(canChangeCareConsent(false, inAppOnly)).toBe(true);
  });

  it("rejects malformed care availability instead of guessing delivery state", () => {
    expect(parseCareAvailability({
      outboundEnabled: "true",
      emailVerified: true,
    })).toBeNull();
    expect(parseCareAvailability(null)).toBeNull();
  });
});
