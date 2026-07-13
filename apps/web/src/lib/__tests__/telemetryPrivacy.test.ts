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

  it("redacts identifiers embedded in URL paths, including UUIDv7", () => {
    expect(stripUrlQueryAndHash(
      "https://hanbang.ai/profile/018f3f78-7a5b-7cc8-9a10-123456789abc/person@example.com?token=secret",
    )).toBe("https://hanbang.ai/profile/[redacted-id]/[redacted-email]");
    expect(stripUrlQueryAndHash(
      "https://hanbang.ai/profile/person%40example.com?token=secret",
    )).toBe("https://hanbang.ai/profile/[redacted-email]");
    expect(stripUrlQueryAndHash("/profile/person%40example.com#details"))
      .toBe("/profile/[redacted-email]");
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

  it("redacts email addresses and UUID-shaped identifiers from diagnostic text", () => {
    expect(redactTelemetryText(
      "user person@example.com id 123e4567-e89b-42d3-a456-426614174000",
    )).toBe("user [redacted-email] id [redacted-id]");
    expect(redactTelemetryText("GET /profile/person%40example.com failed"))
      .toBe("GET /profile/[redacted-email] failed");
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

  it("scrubs encoded identifiers from Sentry diagnostic fields", () => {
    const event = sanitizeSentryEvent({
      message: "GET /profile/person%40example.com failed",
      exception: { values: [{ value: "owner person%40example.com" }] },
      breadcrumbs: [{ message: "visited /profile/person%40example.com" }],
    });

    expect(event.message).toBe("GET /profile/[redacted-email] failed");
    expect(event.exception.values[0].value).toBe("owner [redacted-email]");
    expect(event.breadcrumbs?.[0]?.message).toBe("visited /profile/[redacted-email]");
  });

  it("scrubs local variables captured in every Sentry stacktrace shape", () => {
    const variables = {
      email: "person@example.com",
      user_id: "123e4567-e89b-42d3-a456-426614174000",
      note: "contact person@example.com",
      url: "https://hanbang.ai/result?ct=secret",
    };
    const event = sanitizeSentryEvent({
      exception: { values: [{ stacktrace: { frames: [{
        abs_path: "https://hanbang.ai/app.js?token=secret",
        vars: { ...variables },
      }] } }] },
      stacktrace: { frames: [{ vars: { ...variables } }] },
      threads: { values: [{ stacktrace: { frames: [{ vars: { ...variables } }] } }] },
    });
    const expected = {
      note: "contact [redacted-email]",
      url: "https://hanbang.ai/result",
    };

    expect(event.exception.values[0].stacktrace?.frames?.[0]?.vars).toEqual(expected);
    expect(event.exception.values[0].stacktrace?.frames?.[0]?.abs_path)
      .toBe("https://hanbang.ai/app.js");
    expect(event.stacktrace.frames?.[0]?.vars).toEqual(expected);
    expect(event.threads.values?.[0]?.stacktrace?.frames?.[0]?.vars).toEqual(expected);
  });
});
