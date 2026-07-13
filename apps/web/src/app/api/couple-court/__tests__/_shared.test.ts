import { describe, expect, it } from "vitest";
import {
  cleanCourtText,
  CourtApiError,
  isCoupleCourtAiEnabled,
  isCoupleCourtEnabled,
  isCoupleCourtPublicEnabled,
  readCourtJson,
  requireSafeJsonMutation,
} from "../_shared";

describe("couple court release flags", () => {
  it("fails closed for every production capability without explicit flags", () => {
    const environment = { NODE_ENV: "production" as const };
    expect(isCoupleCourtEnabled(environment)).toBe(false);
    expect(isCoupleCourtAiEnabled(environment)).toBe(false);
    expect(isCoupleCourtPublicEnabled(environment)).toBe(false);
  });

  it("keeps AI and public independently gated behind the private feature", () => {
    const environment = {
      NODE_ENV: "production" as const,
      COUPLE_COURT_ENABLED: "true",
      COUPLE_COURT_AI_ENABLED: "true",
      COUPLE_COURT_PUBLIC_ENABLED: "false",
    };
    expect(isCoupleCourtEnabled(environment)).toBe(true);
    expect(isCoupleCourtAiEnabled(environment)).toBe(true);
    expect(isCoupleCourtPublicEnabled(environment)).toBe(false);
  });

  it("keeps private local flows available while AI still needs an explicit provider or mock flag", () => {
    expect(isCoupleCourtEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(isCoupleCourtEnabled({ NODE_ENV: "test", COUPLE_COURT_ENABLED: "false" })).toBe(false);
    expect(isCoupleCourtAiEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isCoupleCourtAiEnabled({
      NODE_ENV: "test",
      COUPLE_COURT_MOCK_ENABLED: "true",
    })).toBe(true);
  });
});

describe("couple court mutation boundary", () => {
  it("rejects an oversized authored field instead of truncating its safety-relevant tail", () => {
    const authored = `${"가".repeat(20)} 마지막 안전 설명`;
    expect(() => cleanCourtText(authored, 20, "진술")).toThrowError(CourtApiError);
    try {
      cleanCourtText(authored, 20, "진술");
    } catch (error) {
      expect(error).toMatchObject({ code: "COURT_FIELD_TOO_LONG", status: 400 });
    }
  });

  it("sanitizes but preserves a field that is within the declared limit", () => {
    expect(cleanCourtText("  합의할 내용을 적어요  ", 30, "진술")).toBe("합의할 내용을 적어요");
  });

  it("blocks a cross-site cookie mutation", () => {
    const request = new Request("https://hanbang.ai/api/couple-court/cases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: "{}",
    });
    expect(() => requireSafeJsonMutation(request)).toThrowError(CourtApiError);
  });

  it("allows a bearer-authenticated native mutation without browser origin headers", () => {
    const request = new Request("https://hanbang.ai/api/couple-court/cases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: "{}",
    });
    expect(() => requireSafeJsonMutation(request)).not.toThrow();
  });

  it("enforces the actual UTF-8 body size when content-length is absent", async () => {
    const request = new Request("https://hanbang.ai/api/couple-court/cases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://hanbang.ai",
      },
      body: JSON.stringify({ text: "가".repeat(50) }),
    });
    await expect(readCourtJson(request, 32)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    });
  });
});
