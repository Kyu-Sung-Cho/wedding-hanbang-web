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
      expect(result.message).toContain("공식·전문 계정");
    }
  });

  it.each([
    "한국소비자원 상담센터",
    "웨딩 전문 변호사",
    "공인 웨딩플래너",
    "플래너 김한방",
    "OpenAI Wedding",
    "웨딩 마스터",
  ])("rejects unverified authority-looking nickname %s", (nickname) => {
    const result = validateCommunityNickname(nickname);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("공식·전문 계정");
    }
  });

  it("rejects inappropriate nicknames", () => {
    const result = validateCommunityNickname("시발");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("부적절한");
    }
  });

  it("uses a fresh unlinkable pseudonym and never copies an account name", () => {
    const userId = "12345678-aaaa-bbbb-cccc-123456789012";
    const first = getSafeDefaultCommunityNickname("김웨딩", userId);
    const second = getSafeDefaultCommunityNickname("김웨딩", userId);
    const direct = getCommunityNicknameFallback(userId);

    for (const nickname of [first, second, direct]) {
      expect(nickname).toMatch(/^웨딩친구-[a-f0-9]{15}$/);
      expect(nickname).not.toContain("김웨딩");
      expect(nickname).not.toContain("12345678");
      expect(validateCommunityNickname(nickname).ok).toBe(true);
    }
    expect(new Set([first, second, direct]).size).toBe(3);
  });
});
