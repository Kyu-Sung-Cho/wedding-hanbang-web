import { describe, expect, it } from "vitest";
import {
  redactTelemetryText,
  sanitizeSentryEvent,
  sanitizeTelemetryRecord,
  stripUrlQueryAndHash,
} from "@/lib/telemetryPrivacy";

describe("telemetry privacy", () => {
  it("strips query strings and fragments from absolute and relative URLs", () => {
    expect(stripUrlQueryAndHash("https://hanbang.ai/wedding-code?ct=secret#result"))
      .toBe("https://hanbang.ai/wedding-code");
    expect(stripUrlQueryAndHash("/wedding-code/result?ct=secret"))
      .toBe("/wedding-code/result");
  });

  it("removes sensitive properties and sanitizes all URL-like properties", () => {
    expect(sanitizeTelemetryRecord({
      $current_url: "https://hanbang.ai/wedding-code?ct=secret",
      $referrer: "https://example.com/?token=secret",
      ct: "secret",
      access_token: "secret",
      stage: "result",
    })).toEqual({
      $current_url: "https://hanbang.ai/wedding-code",
      $referrer: "https://example.com/",
      stage: "result",
    });
  });

  it("redacts bearer values and token query fragments in diagnostic text", () => {
    expect(redactTelemetryText("GET /x?ct=secret Authorization: Bearer abc.def"))
      .toBe("GET /x?ct=[redacted] Authorization: Bearer [redacted]");
  });

  it("scrubs Sentry requests, breadcrumbs, user data, and headers", () => {
    const event = sanitizeSentryEvent({
      request: {
        url: "https://hanbang.ai/wedding-code?ct=secret",
        query_string: "ct=secret",
        headers: { authorization: "Bearer secret", cookie: "session=secret", accept: "json" },
        data: { token: "secret", safe: "ok" },
      },
      user: { id: "user-id", email: "person@example.com" },
      breadcrumbs: [{ data: { url: "https://hanbang.ai/result?ct=secret" } }],
    });
    expect(event.request).toEqual({
      url: "https://hanbang.ai/wedding-code",
      headers: { accept: "json" },
      data: { safe: "ok" },
    });
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs?.[0]?.data).toEqual({ url: "https://hanbang.ai/result" });
  });

  it("recursively scrubs objects inside arrays", () => {
    expect(sanitizeTelemetryRecord({
      items: [
        { token: "secret", url: "https://hanbang.ai/x?ct=secret", note: "Bearer abc" },
      ],
    })).toEqual({
      items: [{ url: "https://hanbang.ai/x", note: "Bearer [redacted]" }],
    });
  });

  it("scrubs root messages, transactions, and exception values", () => {
    const event = sanitizeSentryEvent({
      message: "failed https://hanbang.ai/x?ct=secret",
      transaction: "/wedding-code?ct=secret",
      exception: { values: [{ value: "Bearer abc at /result?token=secret" }] },
    });
    expect(event.message).toBe("failed https://hanbang.ai/x");
    expect(event.transaction).toBe("/wedding-code");
    expect(event.exception.values[0].value).toBe("Bearer [redacted] at /result");
  });
});
