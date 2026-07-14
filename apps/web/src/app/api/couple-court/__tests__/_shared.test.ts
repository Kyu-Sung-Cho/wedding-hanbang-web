import { describe, expect, it } from "vitest";
import {
  cleanCourtText,
  courtErrorResponse,
  CourtApiError,
  encodeCourtCursor,
  isCoupleCourtAiEnabled,
  isCoupleCourtEnabled,
  isCoupleCourtPublicEnabled,
  readCourtJson,
  readCourtCursor,
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

describe("couple court keyset cursors", () => {
  const cursor = {
    at: "2026-07-14T01:02:03.123456+00:00",
    id: "00000000-0000-4000-8000-000000000001",
  };

  it("round-trips the exact database timestamp without losing microseconds", () => {
    const encoded = encodeCourtCursor("comments", cursor);
    const request = new Request(`https://hanbang.ai/api/couple-court/public/post/comments?cursor=${encoded}`);
    expect(readCourtCursor(request, "comments")).toEqual(cursor);
  });

  it("rejects a cursor from a different list contract", () => {
    const encoded = encodeCourtCursor("cases", cursor);
    const request = new Request(`https://hanbang.ai/api/couple-court/public/post/comments?cursor=${encoded}`);
    expect(() => readCourtCursor(request, "comments")).toThrowError(CourtApiError);
  });

  it("rejects malformed and oversized cursor input", () => {
    const malformed = new Request("https://hanbang.ai/api/couple-court/cases?cursor=not_json");
    expect(() => readCourtCursor(malformed, "cases")).toThrowError(CourtApiError);
    const oversized = new Request(`https://hanbang.ai/api/couple-court/cases?cursor=${"a".repeat(385)}`);
    expect(() => readCourtCursor(oversized, "cases")).toThrowError(CourtApiError);
  });

  it("rejects calendar dates and timezone offsets that only look ISO-shaped", () => {
    for (const at of [
      "2026-02-31T01:02:03.123456+00:00",
      "2026-07-14T24:00:00+00:00",
      "2026-07-14T01:02:03+14:30",
    ]) {
      const encoded = encodeCourtCursor("cases", { ...cursor, at });
      const request = new Request(`https://hanbang.ai/api/couple-court/cases?cursor=${encoded}`);
      expect(() => readCourtCursor(request, "cases")).toThrowError(CourtApiError);
    }
  });
});

describe("couple court mutation boundary", () => {
  it("prevents feature and authorization errors from being cached", async () => {
    const response = courtErrorResponse(
      new CourtApiError(404, "COUPLE_COURT_DISABLED", "준비 중이에요."),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
    await expect(response.json()).resolves.toMatchObject({
      code: "COUPLE_COURT_DISABLED",
    });
  });

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

  it("treats the bearer authentication scheme case-insensitively", () => {
    const request = new Request("https://hanbang.ai/api/couple-court/cases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "bEaReR test-token",
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

  it("cancels a chunked body as soon as its byte limit is exceeded", async () => {
    let chunksRead = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead += 1;
        controller.enqueue(new TextEncoder().encode("1234567890"));
        if (chunksRead >= 20) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://hanbang.ai/api/couple-court/cases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://hanbang.ai",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readCourtJson(request, 25)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    });
    expect(cancelled).toBe(true);
    expect(chunksRead).toBeLessThan(20);
  });
});
