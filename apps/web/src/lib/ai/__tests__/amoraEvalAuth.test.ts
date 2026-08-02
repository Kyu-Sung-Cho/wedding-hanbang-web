import { describe, expect, it } from "vitest";

import { createAmoraEvalToken, verifyAmoraEvalToken } from "@/lib/ai/amoraEvalAuth";

const SECRET = "release-eval-secret-that-is-at-least-32-chars";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";
const NOW = 1_784_067_600_000;

describe("Amora release-evaluation authentication", () => {
  it("accepts only a current signature bound to the same request id", () => {
    const token = createAmoraEvalToken(SECRET, REQUEST_ID, NOW);

    expect(verifyAmoraEvalToken(token, REQUEST_ID, { now: NOW, secret: SECRET })).toBe(true);
    expect(verifyAmoraEvalToken(token, `${REQUEST_ID.slice(0, -1)}8`, {
      now: NOW,
      secret: SECRET,
    })).toBe(false);
    expect(verifyAmoraEvalToken(token, REQUEST_ID, {
      now: NOW,
      secret: `${SECRET}-wrong`,
    })).toBe(false);
  });

  it("rejects expired, far-future, malformed, and weak-secret tokens", () => {
    const expired = createAmoraEvalToken(SECRET, REQUEST_ID, NOW - 5 * 60 * 1000 - 1);
    const future = createAmoraEvalToken(SECRET, REQUEST_ID, NOW + 30 * 1000 + 1);

    expect(verifyAmoraEvalToken(expired, REQUEST_ID, { now: NOW, secret: SECRET })).toBe(false);
    expect(verifyAmoraEvalToken(future, REQUEST_ID, { now: NOW, secret: SECRET })).toBe(false);
    expect(verifyAmoraEvalToken("v1.bad.signature", REQUEST_ID, {
      now: NOW,
      secret: SECRET,
    })).toBe(false);
    expect(verifyAmoraEvalToken("v1.1784067600000.signature", REQUEST_ID, {
      now: NOW,
      secret: "too-short",
    })).toBe(false);
  });

  it("fails closed for low-entropy, placeholder, and whitespace-bearing secrets", () => {
    for (const weakSecret of [
      "a".repeat(64),
      "replace-with-eval-secret-12345678901234567890",
      "release eval secret with spaces and enough variety 123!",
    ]) {
      expect(() => createAmoraEvalToken(weakSecret, REQUEST_ID, NOW)).toThrow(
        "AMORA_EVAL_SECRET_INVALID",
      );
      expect(verifyAmoraEvalToken(
        "v1.1784067600000.signature",
        REQUEST_ID,
        { now: NOW, secret: weakSecret },
      )).toBe(false);
    }
  });
});
