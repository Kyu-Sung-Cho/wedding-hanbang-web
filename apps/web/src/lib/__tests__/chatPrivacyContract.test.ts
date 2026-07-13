import { describe, expect, it } from "vitest";
import {
  chatVisibilityForMobileTarget,
  isMessageAllowedInAiContext,
  isMessageVisibleForMobileTarget,
} from "@hanbang/shared";

describe("mobile Amora privacy contract", () => {
  const sharedAi = { visibility: "shared", metadata: null } as const;
  const sharedPartner = { visibility: "shared", metadata: { target: "partner" } } as const;
  const bridePrivate = { visibility: "bride_private", metadata: null } as const;
  const groomPrivate = { visibility: "groom_private", metadata: null } as const;

  it("never renders a private message in the shared or partner tabs", () => {
    expect(isMessageVisibleForMobileTarget(bridePrivate, "ai_shared", "bride")).toBe(false);
    expect(isMessageVisibleForMobileTarget(bridePrivate, "partner", "bride")).toBe(false);
    expect(isMessageVisibleForMobileTarget(sharedAi, "ai_shared", "bride")).toBe(true);
    expect(isMessageVisibleForMobileTarget(sharedPartner, "partner", "bride")).toBe(true);
  });

  it("shows only the signed-in role's private messages in the private tab", () => {
    expect(isMessageVisibleForMobileTarget(bridePrivate, "ai_private", "bride")).toBe(true);
    expect(isMessageVisibleForMobileTarget(groomPrivate, "ai_private", "bride")).toBe(false);
    expect(chatVisibilityForMobileTarget("ai_private", "groom")).toBe("groom_private");
  });

  it("keeps shared AI context free of private messages", () => {
    expect(isMessageAllowedInAiContext(sharedAi, "shared")).toBe(true);
    expect(isMessageAllowedInAiContext(bridePrivate, "shared")).toBe(false);
    expect(isMessageAllowedInAiContext(sharedAi, "bride_private")).toBe(true);
    expect(isMessageAllowedInAiContext(bridePrivate, "bride_private")).toBe(true);
    expect(isMessageAllowedInAiContext(groomPrivate, "bride_private")).toBe(false);
  });
});
