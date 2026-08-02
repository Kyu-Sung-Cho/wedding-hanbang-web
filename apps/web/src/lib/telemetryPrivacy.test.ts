import { describe, expect, it } from "vitest";

import {
  sanitizeSentryTelemetryBreadcrumb,
  sanitizeSentryTelemetryEvent,
  sanitizeSentryTelemetryTransaction,
  sanitizeTelemetryObject,
  sanitizeTelemetryUrl,
} from "./telemetryPrivacy";

describe("telemetry URL privacy", () => {
  it("drops every query and fragment from standalone telemetry URLs", () => {
    expect(sanitizeTelemetryUrl(
      "https://hanbang.ai/community/post/write?title=private&body=secret#draft",
    )).toBe("https://hanbang.ai/community/post/write");
    expect(sanitizeTelemetryUrl("/search?q=private-query#result")).toBe("/search");
  });

  it("removes auth secrets from request, breadcrumb, and transaction URLs", () => {
    const accessToken = "access-secret-marker";
    const refreshToken = "refresh-secret-marker";
    const authorizationCode = "oauth-code-marker";
    const authorizationHeader = "Bearer authorization-secret-marker";
    const event = {
      request: {
        url: `https://hanbang.ai/reset-password?code=${authorizationCode}#access_token=${accessToken}&refresh_token=${refreshToken}&type=recovery`,
        query_string: `code=${authorizationCode}`,
        headers: {
          Authorization: authorizationHeader,
          Referer: `https://hanbang.ai/reset-password#access_token=${accessToken}`,
        },
      },
      breadcrumbs: [
        {
          category: "navigation",
          data: {
            from: `https://hanbang.ai/#refresh_token=${refreshToken}`,
            to: `https://hanbang.ai/reset-password?code=${authorizationCode}`,
          },
        },
      ],
      transaction: `/reset-password?code=${authorizationCode}`,
      contexts: {
        auth: {
          accessToken,
          authorizationCode,
          refreshToken,
        },
      },
    };

    sanitizeTelemetryObject(event);
    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(refreshToken);
    expect(serialized).not.toContain(authorizationCode);
    expect(serialized).not.toContain(authorizationHeader);
    expect(serialized).toContain("FILTERED");
  });

  it("removes provider callback descriptions from string and structured query data", () => {
    const privateDescription = "private-provider-description-marker";
    const event = {
      request: {
        query_string: `error=oauth_error&error_code=provider_error&error_description=${privateDescription}`,
      },
      contexts: {
        callback: {
          query: {
            error: "oauth_error",
            error_description: privateDescription,
            error_uri: `https://provider.example/error?detail=${privateDescription}`,
          },
        },
      },
    };

    sanitizeTelemetryObject(event);

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(privateDescription);
    expect(event.request.query_string).toBe("FILTERED");
    expect(event.contexts.callback.query).toBe("FILTERED");
  });

  it("drops all standalone URL parameters, including WeddingCode answers", () => {
    const sanitized = sanitizeTelemetryUrl(
      "https://hanbang.ai/wedding-code?a=answer-a&b=answer-b&ct=couple-token&view=result",
    );

    expect(sanitized).not.toContain("answer-a");
    expect(sanitized).not.toContain("answer-b");
    expect(sanitized).not.toContain("couple-token");
    expect(sanitized).toBe("https://hanbang.ai/wedding-code");
    expect(sanitizeTelemetryUrl("https://hanbang.ai/example?a=ordinary-value"))
      .toBe("https://hanbang.ai/example");
  });

  it("redacts encoded callback parameters and structured WeddingCode query values", () => {
    const encoded = sanitizeTelemetryUrl(
      "callback=https%3A%2F%2Fhanbang.ai%2Freset-password%3Fcode%3Dencoded-code-marker%26state%3Dencoded-state-marker",
    );
    const event = {
      request: {
        url: "https://hanbang.ai/wedding-code?view=result",
        query_string: {
          a: "structured-answer-a",
          b: "structured-answer-b",
          ct: "structured-couple-token",
          view: "result",
        },
      },
    };

    sanitizeTelemetryObject(event);

    expect(encoded).not.toContain("encoded-code-marker");
    expect(encoded).not.toContain("encoded-state-marker");
    expect(event.request.query_string).toBe("FILTERED");
  });

  it("removes ordinary PII and arbitrary payload containers recursively", () => {
    const event = {
      message: "Failure for bride@example.com and 010-1234-5678",
      user: { id: "user-123", email: "bride@example.com" },
      request: {
        url: "https://hanbang.ai/profile?email=bride@example.com",
        data: { name: "실명", account: "110-123-456789" },
      },
      breadcrumbs: [{ data: { phone: "010-1234-5678" } }],
      extra: { privateConversation: "결혼식 계좌와 주소" },
      exception: {
        value: "Bearer abcdefghijklmnopqrstuvwxyz123456",
      },
    };

    sanitizeTelemetryObject(event);
    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain("bride@example.com");
    expect(serialized).not.toContain("010-1234-5678");
    expect(serialized).not.toContain("user-123");
    expect(serialized).not.toContain("실명");
    expect(serialized).not.toContain("결혼식 계좌와 주소");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(serialized).toContain("FILTERED");
  });

  it("drops arbitrary free text from Sentry errors and breadcrumbs", () => {
    const privateMarker = "our venue is a private family home";
    const event = {
      message: privateMarker,
      logentry: { message: privateMarker, params: [privateMarker] },
      exception: {
        values: [{
          type: "PostgrestError",
          value: privateMarker,
          stacktrace: { frames: [{ filename: "route.ts", lineno: 10 }] },
        }],
      },
    };
    const breadcrumb = {
      category: "console",
      message: privateMarker,
      data: { payload: privateMarker },
    };

    sanitizeSentryTelemetryEvent(event);
    sanitizeSentryTelemetryBreadcrumb(breadcrumb);

    expect(JSON.stringify({ event, breadcrumb })).not.toContain(privateMarker);
    expect(event.exception.values[0].type).toBe("PostgrestError");
    expect(event.exception.values[0].stacktrace.frames[0].filename).toBe("route.ts");
    expect(event.exception.values[0].value).toBe("FILTERED");
    expect(breadcrumb.message).toBe("FILTERED");
  });

  it("drops arbitrary span text and pseudonymous identifiers from transactions", () => {
    const privateMarker = "private venue contract clause";
    const userId = "10000000-0000-4000-8000-000000000001";
    const transaction = {
      transaction: `/couples/${userId}/chat?q=${privateMarker}`,
      spans: [{
        description: `SELECT * FROM messages WHERE content = '${privateMarker}'`,
        data: { userId, body: privateMarker },
      }],
    };

    sanitizeSentryTelemetryTransaction(transaction);

    const serialized = JSON.stringify(transaction);
    expect(serialized).not.toContain(privateMarker);
    expect(serialized).not.toContain(userId);
    expect(transaction.spans[0].description).toBe("FILTERED");
    expect(transaction.spans[0].data).toBe("FILTERED");
  });
});
