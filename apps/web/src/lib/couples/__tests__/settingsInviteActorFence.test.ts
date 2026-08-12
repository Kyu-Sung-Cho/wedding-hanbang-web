import { resolveCoupleConnectionState } from "@hanbang/shared";
import { describe, expect, it, vi } from "vitest";
import {
  copyOwnerBoundInviteCode,
  selectOwnerBoundCoupleConnection,
} from "../settingsInviteActorFence";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const connectionA = resolveCoupleConnectionState({
  inviteCode: "WH-SECRET",
  isFullyLinked: false,
  isMembershipSealed: false,
});

describe("settings invite actor fence", () => {
  it("does not render A's invite after the settings owner becomes B or unresolved", () => {
    expect(selectOwnerBoundCoupleConnection(connectionA, USER_A, USER_B).inviteCode)
      .toBeNull();
    expect(selectOwnerBoundCoupleConnection(connectionA, USER_A, null).inviteCode)
      .toBeNull();
    expect(selectOwnerBoundCoupleConnection(connectionA, USER_A, USER_A).inviteCode)
      .toBe("WH-SECRET");
  });

  it("does not write A's invite when auth changes before clipboard access", async () => {
    let currentOwnerId: string | null = USER_A;
    const writeText = vi.fn(async () => undefined);

    await expect(copyOwnerBoundInviteCode({
      connectionOwnerId: USER_A,
      inviteCode: "WH-SECRET",
      readCurrentSettingsOwner: () => currentOwnerId,
      readAuthenticatedOwner: async () => {
        currentOwnerId = USER_B;
        return USER_A;
      },
      writeText,
      purgeOwnerBoundSecret: vi.fn(),
    })).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("clears A's copied invite and purges its owner-bound state when auth changes during clipboard access", async () => {
    let currentOwnerId: string | null = USER_A;
    let clipboard = "";
    const purgeOwnerBoundSecret = vi.fn();
    const readAuthenticatedOwner = vi.fn(async () => currentOwnerId);
    const writeText = vi.fn(async (value: string) => {
      clipboard = value;
      if (value === "WH-SECRET") currentOwnerId = USER_B;
    });

    await expect(copyOwnerBoundInviteCode({
      connectionOwnerId: USER_A,
      inviteCode: "WH-SECRET",
      readCurrentSettingsOwner: () => currentOwnerId,
      readAuthenticatedOwner,
      writeText,
      purgeOwnerBoundSecret,
    })).resolves.toBe(false);

    expect(readAuthenticatedOwner).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenNthCalledWith(1, "WH-SECRET");
    expect(writeText).toHaveBeenNthCalledWith(2, "");
    expect(clipboard).toBe("");
    expect(purgeOwnerBoundSecret).toHaveBeenCalledOnce();
  });

  it("writes only a code whose settings, auth, and tag still agree", async () => {
    const writeText = vi.fn(async () => undefined);
    const readAuthenticatedOwner = vi.fn(async () => USER_A);

    await expect(copyOwnerBoundInviteCode({
      connectionOwnerId: USER_A,
      inviteCode: "WH-SECRET",
      readCurrentSettingsOwner: () => USER_A,
      readAuthenticatedOwner,
      writeText,
      purgeOwnerBoundSecret: vi.fn(),
    })).resolves.toBe(true);
    expect(readAuthenticatedOwner).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenCalledWith("WH-SECRET");
  });
});
