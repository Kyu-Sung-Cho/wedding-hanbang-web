import { describe, expect, it } from "vitest";
import { normalizeEmailForRateLimit } from "../turnstile";

describe("normalizeEmailForRateLimit — 이메일 폭탄 우회 방어", () => {
  it("기본: trim + lowercase", () => {
    expect(normalizeEmailForRateLimit("  Victim@Example.COM ")).toBe("victim@example.com");
  });

  it("Gmail plus 별칭을 하나로 합친다 (victim+1, victim+spam → victim)", () => {
    const base = normalizeEmailForRateLimit("victim@gmail.com");
    expect(normalizeEmailForRateLimit("victim+1@gmail.com")).toBe(base);
    expect(normalizeEmailForRateLimit("victim+anything@gmail.com")).toBe(base);
  });

  it("Gmail dot 변형을 합친다 (v.i.c.t.i.m → victim)", () => {
    expect(normalizeEmailForRateLimit("v.i.c.t.i.m@gmail.com")).toBe("victim@gmail.com");
    expect(normalizeEmailForRateLimit("vic.tim@googlemail.com")).toBe("victim@gmail.com");
  });

  it("Gmail dot+plus 조합도 하나로 (v.ictim+9 → victim)", () => {
    expect(normalizeEmailForRateLimit("v.ictim+9@gmail.com")).toBe("victim@gmail.com");
  });

  it("비-Gmail 도메인: plus 별칭만 제거, 점은 보존(도메인마다 의미가 다름)", () => {
    expect(normalizeEmailForRateLimit("user+tag@company.com")).toBe("user@company.com");
    expect(normalizeEmailForRateLimit("first.last@company.com")).toBe("first.last@company.com");
  });

  it("같은 피해자의 모든 Gmail 변형이 단일 rate-limit 키로 수렴한다", () => {
    const variants = [
      "victim@gmail.com",
      "victim+1@gmail.com",
      "v.i.c.t.i.m@gmail.com",
      "Victim+999@Gmail.com",
      "vict.im@googlemail.com",
    ];
    const keys = new Set(variants.map(normalizeEmailForRateLimit));
    expect(keys.size).toBe(1);
  });

  it("@ 없는 입력은 그대로 소문자화만", () => {
    expect(normalizeEmailForRateLimit("notanemail")).toBe("notanemail");
  });
});
