import { describe, expect, it } from "vitest";
import {
  COUPLE_INVITE_CODE_LENGTH,
  isCoupleInviteCode,
  manwonInputToWon,
  normalizeCoupleInviteCode,
  wonToManwonInput,
} from "@hanbang/shared";

describe("onboarding contract shared by web and mobile", () => {
  it("accepts only the current 15-character invite-code format", () => {
    expect(COUPLE_INVITE_CODE_LENGTH).toBe(15);
    expect(isCoupleInviteCode("WH-A1B2C3D4E5F6")).toBe(true);
    expect(isCoupleInviteCode("WH-A1B2C3")).toBe(false);
  });

  it("normalizes pasted invite codes without letting them exceed the server format", () => {
    expect(normalizeCoupleInviteCode(" wh-a1b2 c3d4-e5f6! ")).toBe("WH-A1B2C3D4E5F6");
    expect(normalizeCoupleInviteCode("wh-a1b2c3d4e5f6-extra")).toBe("WH-A1B2C3D4E5F6");
  });

  it("converts the mobile 만원 input to the server's won unit", () => {
    expect(manwonInputToWon("3000")).toBe(30_000_000);
    expect(manwonInputToWon("3,000")).toBe(30_000_000);
    expect(manwonInputToWon("not-a-number")).toBe(0);
    expect(wonToManwonInput(30_000_000)).toBe("3000");
    expect(manwonInputToWon(wonToManwonInput(30_000_000))).toBe(30_000_000);
  });
});
