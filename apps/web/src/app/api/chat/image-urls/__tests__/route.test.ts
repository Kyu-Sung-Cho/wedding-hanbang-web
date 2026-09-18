import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientFromRequestSpy, createServiceClientSpy, persistentLimitSpy } = vi.hoisted(() => ({
  createClientFromRequestSpy: vi.fn(),
  createServiceClientSpy: vi.fn(),
  persistentLimitSpy: vi.fn(async () => null),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: createClientFromRequestSpy,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createServiceClientSpy,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: persistentLimitSpy,
  rateLimitKey: vi.fn(() => "chat:image-urls:test-user"),
}));

import { POST } from "../route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PARTNER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const SHARED_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const PRIVATE_MESSAGE_ID = "66666666-6666-4666-8666-666666666666";

type MessageResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
};

class MessageQuery {
  readonly filters: Array<[string, unknown]> = [];

  constructor(private readonly result: MessageResult) {}

  select() { return this; }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  maybeSingle() { return Promise.resolve(this.result); }
}

function requestFor(body: unknown) {
  return new Request("http://localhost/api/chat/image-urls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function mockVisibleMessage(result: MessageResult) {
  const query = new MessageQuery(result);
  const requestClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
    },
    from: vi.fn((table: string) => {
      if (table !== "chat_messages") throw new Error(`unexpected table: ${table}`);
      return query;
    }),
  };
  createClientFromRequestSpy.mockResolvedValue(requestClient);
  return { query, requestClient };
}

function mockSigner() {
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.invalid/${path}` })),
    error: null,
  }));
  createServiceClientSpy.mockReturnValue({
    storage: {
      from: vi.fn((bucket: string) => {
        if (bucket !== "chat-image") throw new Error(`unexpected bucket: ${bucket}`);
        return { createSignedUrls };
      }),
    },
  });
  return createSignedUrls;
}

describe("POST /api/chat/image-urls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"a".repeat(40)}`;
    persistentLimitSpy.mockResolvedValue(null);
  });

  it("rejects an oversized body before authentication or signing", async () => {
    const response = await POST(new Request("http://localhost/api/chat/image-urls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "4096",
        Origin: "http://localhost",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ messageId: SHARED_MESSAGE_ID }),
    }));

    expect(response.status).toBe(413);
    expect(createClientFromRequestSpy).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it("signs only attachment paths stored on a shared message visible through request RLS", async () => {
    const path = `${COUPLE_ID}/${USER_ID}/55555555-5555-4555-8555-555555555555.png`;
    const { query } = mockVisibleMessage({
      data: {
        id: SHARED_MESSAGE_ID,
        couple_id: COUPLE_ID,
        sender_id: USER_ID,
        visibility: "shared",
        metadata: { imagePaths: [path] },
      },
      error: null,
    });
    const createSignedUrls = mockSigner();

    const response = await POST(requestFor({ messageId: SHARED_MESSAGE_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(query.filters).toEqual([["id", SHARED_MESSAGE_ID]]);
    expect(createSignedUrls).toHaveBeenCalledWith([path], 60 * 60);
    expect(body.urls).toEqual([{ path, signedUrl: `https://signed.invalid/${path}` }]);
  });

  it("signs an own-private message when request RLS exposes it", async () => {
    const path = `${COUPLE_ID}/${USER_ID}/77777777-7777-4777-8777-777777777777.webp`;
    mockVisibleMessage({
      data: {
        id: PRIVATE_MESSAGE_ID,
        couple_id: COUPLE_ID,
        sender_id: USER_ID,
        visibility: "bride_private",
        metadata: { imagePaths: [path] },
      },
      error: null,
    });
    const createSignedUrls = mockSigner();

    const response = await POST(requestFor({ messageId: PRIVATE_MESSAGE_ID }));

    expect(response.status).toBe(200);
    expect(createSignedUrls).toHaveBeenCalledWith([path], 60 * 60);
  });

  it("does not sign a partner-private message hidden by request RLS", async () => {
    mockVisibleMessage({ data: null, error: null });
    const createSignedUrls = mockSigner();

    const response = await POST(requestFor({ messageId: PRIVATE_MESSAGE_ID }));

    expect(response.status).toBe(404);
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it("rejects encoded path traversal even when it appears in visible message metadata", async () => {
    const encodedTraversal = `${COUPLE_ID}/${USER_ID}/%2e%2e%2f${PARTNER_ID}%2fsecret.png`;
    mockVisibleMessage({
      data: {
        id: SHARED_MESSAGE_ID,
        couple_id: COUPLE_ID,
        sender_id: USER_ID,
        visibility: "shared",
        metadata: { imagePaths: [encodedTraversal] },
      },
      error: null,
    });
    const createSignedUrls = mockSigner();

    const response = await POST(requestFor({ messageId: SHARED_MESSAGE_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ urls: [] });
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it("keeps legacy couple/file attachments readable only through their visible message", async () => {
    const legacyPath = `${COUPLE_ID}/1700000000000-a1b2c.png`;
    const legacyUrlPath = `${COUPLE_ID}/1700000000001-d3e4f.webp`;
    mockVisibleMessage({
      data: {
        id: SHARED_MESSAGE_ID,
        couple_id: COUPLE_ID,
        sender_id: USER_ID,
        visibility: "shared",
        metadata: {
          imagePaths: [legacyPath],
          imageUrls: [
            `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/chat-image/${legacyUrlPath}`,
          ],
        },
      },
      error: null,
    });
    const createSignedUrls = mockSigner();

    const response = await POST(requestFor({ messageId: SHARED_MESSAGE_ID }));

    expect(response.status).toBe(200);
    expect(createSignedUrls).toHaveBeenCalledWith([legacyPath, legacyUrlPath], 60 * 60);
  });

  it("rejects arbitrary client paths instead of treating them as an allowlist", async () => {
    const { requestClient } = mockVisibleMessage({ data: null, error: null });
    const createSignedUrls = mockSigner();

    const response = await POST(requestFor({
      messageId: SHARED_MESSAGE_ID,
      paths: [`${COUPLE_ID}/${PARTNER_ID}/secret.png`],
    }));

    expect(response.status).toBe(400);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  // 앱(2026-09-18, wave 2 · 2.5a)은 Origin·Sec-Fetch-Site 없이 Bearer 만 싣고 부른다.
  it("accepts a Bearer-only native request and still reads the message through request-scoped RLS", async () => {
    const path = `${COUPLE_ID}/${PARTNER_ID}/99999999-9999-4999-8999-999999999999.jpg`;
    const { query, requestClient } = mockVisibleMessage({
      data: {
        id: SHARED_MESSAGE_ID,
        couple_id: COUPLE_ID,
        sender_id: PARTNER_ID,
        visibility: "shared",
        metadata: { imagePaths: [path] },
      },
      error: null,
    });
    const createSignedUrls = mockSigner();
    const request = new Request("http://localhost/api/chat/image-urls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer header.payload.signature",
      },
      body: JSON.stringify({ messageId: SHARED_MESSAGE_ID }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createClientFromRequestSpy).toHaveBeenCalledTimes(1);
    expect(createClientFromRequestSpy.mock.calls[0][0].headers.get("authorization")).toBe("Bearer header.payload.signature");
    expect(requestClient.from).toHaveBeenCalledWith("chat_messages");
    expect(query.filters).toEqual([["id", SHARED_MESSAGE_ID]]);
    expect(createSignedUrls).toHaveBeenCalledWith([path], 60 * 60);
    expect(body.urls).toEqual([{ path, signedUrl: `https://signed.invalid/${path}` }]);
  });

  it.each([
    ["Bearer", {}],
    ["Bearer two tokens", {}],
    ["Basic dXNlcjpwYXNz", {}],
    // 같은 출처 표시가 있어도 형식이 틀린 자격증명은 쿠키로 넘어가지 않고 막힌다.
    ["Bearer  header.payload.signature", { Origin: "http://localhost", "Sec-Fetch-Site": "same-origin" }],
    ["Token header.payload.signature", { Origin: "http://localhost", "Sec-Fetch-Site": "same-origin" }],
  ])("rejects a malformed Authorization header %j with 403 before authentication or signing", async (authorization, extraHeaders) => {
    const { requestClient } = mockVisibleMessage({ data: null, error: null });
    const createSignedUrls = mockSigner();
    const response = await POST(new Request("http://localhost/api/chat/image-urls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
        ...extraHeaders,
      },
      body: JSON.stringify({ messageId: SHARED_MESSAGE_ID }),
    }));

    expect(response.status).toBe(403);
    expect(createClientFromRequestSpy).not.toHaveBeenCalled();
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it("does not sign a new-layout path owned by someone other than the message sender", async () => {
    const partnerPath = `${COUPLE_ID}/${PARTNER_ID}/88888888-8888-4888-8888-888888888888.png`;
    mockVisibleMessage({
      data: {
        id: SHARED_MESSAGE_ID,
        couple_id: COUPLE_ID,
        sender_id: USER_ID,
        visibility: "shared",
        metadata: { imagePaths: [partnerPath] },
      },
      error: null,
    });
    const createSignedUrls = mockSigner();

    const response = await POST(requestFor({ messageId: SHARED_MESSAGE_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ urls: [] });
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
