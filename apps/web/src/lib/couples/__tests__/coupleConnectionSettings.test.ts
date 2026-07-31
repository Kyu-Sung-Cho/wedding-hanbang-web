import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveCoupleConnectionState } from "@hanbang/shared";

describe("couple connection presentation", () => {
  it("never exposes a retained code or invite action for a sealed single-member couple", () => {
    expect(resolveCoupleConnectionState({
      inviteCode: "WH-RETAINED",
      isFullyLinked: false,
      isMembershipSealed: true,
    })).toEqual({
      phase: "sealed_single",
      inviteCode: null,
      canInvite: false,
    });
  });

  it("shows an invite only for an explicitly unsealed, valid API response", () => {
    expect(resolveCoupleConnectionState({
      inviteCode: "WH-ABC123",
      isFullyLinked: false,
      isMembershipSealed: false,
    })).toEqual({
      phase: "awaiting_partner",
      inviteCode: "WH-ABC123",
      canInvite: true,
    });
    expect(resolveCoupleConnectionState({
      inviteCode: "bad-code",
      isFullyLinked: false,
      isMembershipSealed: false,
    })).toEqual({
      phase: "unavailable",
      inviteCode: null,
      canInvite: false,
    });
  });

  it("prefers confirmed partner presence and a stored roster seal over stale API fields", () => {
    expect(resolveCoupleConnectionState(
      { isFullyLinked: false, isMembershipSealed: true },
      { partnerPresent: true, membershipSealedAt: "2026-07-16T00:00:00Z" },
    ).phase).toBe("linked");
    expect(resolveCoupleConnectionState(
      {
        inviteCode: "WH-STALE1",
        isFullyLinked: false,
        isMembershipSealed: false,
      },
      { membershipSealedAt: "2026-07-16T00:00:00Z" },
    )).toEqual({
      phase: "sealed_single",
      inviteCode: null,
      canInvite: false,
    });
  });

  it("fails closed when the API payload is missing or contradictory", () => {
    expect(resolveCoupleConnectionState(null)).toEqual({
      phase: "unavailable",
      inviteCode: null,
      canInvite: false,
    });
    expect(resolveCoupleConnectionState({
      inviteCode: "WH-ABC123",
      isFullyLinked: "false",
      isMembershipSealed: false,
    })).toEqual({
      phase: "unavailable",
      inviteCode: null,
      canInvite: false,
    });
    expect(resolveCoupleConnectionState(
      {
        inviteCode: "WH-ABC123",
        isFullyLinked: false,
        isMembershipSealed: false,
      },
      { membershipSealedAt: "" },
    )).toEqual({
      phase: "unavailable",
      inviteCode: null,
      canInvite: false,
    });
  });
});

describe("web sealed-single settings contract", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
    "utf8",
  );

  it("uses the normalized connection phase instead of the old linked boolean", () => {
    expect(source).toContain("resolveCoupleConnectionState");
    expect(source).toContain('phase === "sealed_single"');
    expect(source).toContain('phase === "awaiting_partner"');
  });

  it("explains that reinviting is blocked and offers restart and support paths", () => {
    expect(source).toContain("새 멤버를 이 커플에 초대할 수 없어요");
    expect(source).toContain("새 커플로 다시 시작");
    expect(source).toContain("mailto:${CONTACT.email}");
    expect(source).not.toContain("https://hanbang.ai/support");
  });
});
