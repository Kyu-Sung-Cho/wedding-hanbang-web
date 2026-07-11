import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_REQUEST_BODY_BYTES,
  assertChatContentLength,
  parseClientChatContext,
  parseInlineAttachment,
  readBoundedJsonBody,
  resolveChatContext,
} from "@/lib/ai/chatRequest";

describe("bounded chat request body", () => {
  it("parses a small JSON object", async () => {
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "안녕" }] }),
    });

    await expect(readBoundedJsonBody(request)).resolves.toMatchObject({
      messages: [{ role: "user", content: "안녕" }],
    });
  });

  it("rejects an oversized declared Content-Length before reading", () => {
    const headers = new Headers({
      "content-length": String(MAX_CHAT_REQUEST_BODY_BYTES + 1),
    });

    expect(() => assertChatContentLength(headers)).toThrow(
      expect.objectContaining({ status: 413 })
    );
  });

  it("rejects a chunked body that crosses the actual byte limit", async () => {
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ value: "0123456789" }),
    });

    await expect(readBoundedJsonBody(request, { maxBytes: 8 })).rejects.toMatchObject({
      status: 413,
    });
  });
});

describe("client chat context boundary", () => {
  it("strictly rejects oversized identity/context fields and invalid roles", () => {
    expect(() => parseClientChatContext({ senderName: "가".repeat(81) })).toThrow(
      expect.objectContaining({ status: 413 })
    );
    expect(() => parseClientChatContext({ senderRole: "admin" })).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(() => parseClientChatContext({
      weddingContext: { weddingDate: null, budget: 0, venue: "식장".repeat(101), progress: {} },
    })).toThrow(expect.objectContaining({ status: 413 }));
  });

  it("rejects deeply nested or oversized progress supplied by the client", () => {
    const nested = { level: {} } as { level: unknown };
    let cursor = nested;
    for (let depth = 0; depth < 12; depth++) {
      const next = { level: {} };
      cursor.level = next;
      cursor = next;
    }

    expect(() => parseClientChatContext({
      weddingContext: { weddingDate: null, budget: 0, venue: null, progress: nested },
    })).toThrow(expect.objectContaining({ status: 413 }));
  });

  it("ignores forged client identity and wedding context outside signed demo mode", () => {
    const client = parseClientChatContext({
      senderName: "공격자 이름",
      senderRole: "groom",
      weddingContext: {
        weddingDate: "2099-01-01",
        budget: 99_000_000_000,
        venue: "공격자 예식장",
        progress: { forged: { status: "completed" } },
      },
    });

    const resolved = resolveChatContext({
      isDemo: false,
      client,
      profile: { name: "DB 신부", role: "bride" },
      journey: {
        wedding_date: "2027-05-03",
        total_budget: 30_000_000,
        venue: "DB 예식장",
        progress: { venue: { status: "in_progress" } },
      },
    });

    expect(resolved).toEqual({
      senderName: "DB 신부",
      senderRole: "bride",
      weddingContext: {
        weddingDate: "2027-05-03",
        budget: 30_000_000,
        venue: "DB 예식장",
        progress: { venue: { status: "in_progress" } },
      },
    });
  });

  it("allows bounded client context only for signed demo mode", () => {
    const client = parseClientChatContext({
      senderName: "데모 신랑",
      senderRole: "groom",
      weddingContext: {
        weddingDate: "2028-06-01",
        budget: 45_000_000,
        venue: "데모 예식장",
        progress: {},
      },
    });

    expect(resolveChatContext({
      isDemo: true,
      client,
      profile: { name: "DB 사용자", role: "bride" },
      journey: null,
    })).toMatchObject({
      senderName: "데모 신랑",
      senderRole: "groom",
      weddingContext: { venue: "데모 예식장", budget: 45_000_000 },
    });
  });
});

describe("inline-only chat attachments", () => {
  it("rejects URL attachments and missing media types", () => {
    expect(() => parseInlineAttachment({
      url: "https://example.com/quote.pdf",
      mediaType: "application/pdf",
    })).toThrow(expect.objectContaining({ status: 400 }));

    expect(() => parseInlineAttachment({ base64: "YWJj" })).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it("accepts a bounded inline attachment", () => {
    expect(parseInlineAttachment({
      base64: "YWJj",
      mediaType: "image/png",
      fileName: "quote.png",
    })).toEqual({
      base64: "YWJj",
      mediaType: "image/png",
      fileName: "quote.png",
    });
  });
});
