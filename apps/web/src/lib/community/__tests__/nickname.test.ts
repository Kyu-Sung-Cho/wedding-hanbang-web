import { describe, expect, it } from "vitest";
import {
  getCommunityNicknameFallback,
  getCommunityNicknameKey,
  getSafeDefaultCommunityNickname,
  validateCommunityNickname,
} from "../nickname";

describe("community nickname validation", () => {
  it("normalizes nickname whitespace and full-width characters", () => {
    const result = validateCommunityNickname("  Ｔｅｓｔ　User  ");

    expect(result).toEqual({
      ok: true,
      nickname: "Test User",
      key: "testuser",
    });
  });

  it("builds duplicate keys without case or whitespace sensitivity", () => {
    expect(getCommunityNicknameKey("Test User")).toBe("testuser");
    expect(getCommunityNicknameKey(" testuser ")).toBe("testuser");
  });

  it("rejects reserved official-looking nicknames", () => {
    const result = validateCommunityNickname("웨딩한방 운영자");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("공식 계정");
    }
  });

  it("rejects inappropriate nicknames", () => {
    const result = validateCommunityNickname("시발");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("부적절한");
    }
  });

  it("uses a stable fallback when a profile name is not valid as a nickname", () => {
    expect(getSafeDefaultCommunityNickname("관리자", "12345678-aaaa-bbbb-cccc-123456789012"))
      .toBe(getCommunityNicknameFallback("12345678-aaaa-bbbb-cccc-123456789012"));
  });
});
