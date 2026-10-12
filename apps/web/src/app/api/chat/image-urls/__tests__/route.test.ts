import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientFromRequestSpy, createServiceClientSpy, persistentLimitSpy } = vi.hoisted(() => ({
  createClientFromRequestSpy: vi.fn(),
  createServiceClientSpy: vi.fn(),
  persistentLimitSpy: vi.fn(async (): Promise<Response | null> => null),
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

function streamedRequest(body: ReadableStream<Uint8Array>, extraHeaders: Record<string, string> = {}) {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", ...extraHeaders },
    body,
    duplex: "half",
  };
  return new Request("http://localhost/api/chat/image-urls", init);
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

  it("cancels an oversized chunked body before reading its tail or looking up attachments", async () => {
    const { requestClient } = mockVisibleMessage({ data: null, error: null });
    let pullCount = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) controller.enqueue(new Uint8Array(131_137));
        else throw new Error("OVERSIZED_IMAGE_URL_TAIL_MUST_NOT_BE_READ");
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: stream,
      duplex: "half",
    };

    const response = await POST(new Request("http://localhost/api/chat/image-urls", init));

    expect(response.status).toBe(413);
    expect(pullCount).toBe(1);
    expect(cancelled).toBe(true);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, "1", "2048"])("counts actual bytes despite Content-Length %s", async (contentLength) => {
    const { requestClient } = mockVisibleMessage({ data: null, error: null });
    let pullCount = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount <= 2) controller.enqueue(new Uint8Array(1_024));
        else if (pullCount === 3) controller.enqueue(new Uint8Array([1]));
        else throw new Error("IMAGE_URL_TAIL_MUST_NOT_BE_READ");
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });

    const response = await POST(streamedRequest(stream, contentLength === undefined ? {} : { "Content-Length": contentLength }));

    expect(response.status).toBe(413);
    expect(pullCount).toBe(3);
    expect(cancelled).toBe(true);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it.each([[2_048, 404], [2_049, 413]])("keeps the exact %i-byte boundary", async (byteLength, expectedStatus) => {
    const { requestClient } = mockVisibleMessage({ data: null, error: null });
    const json = JSON.stringify({ messageId: SHARED_MESSAGE_ID });
    const body = json + " ".repeat(byteLength - new TextEncoder().encode(json).byteLength);

    const response = await POST(new Request("http://localhost/api/chat/image-urls", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body,
    }));

    expect(response.status).toBe(expectedStatus);
    expect(requestClient.from).toHaveBeenCalledTimes(expectedStatus === 404 ? 1 : 0);
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it("preserves valid escaped JSON split across single-byte chunks", async () => {
    const { query } = mockVisibleMessage({
      data: { id: SHARED_MESSAGE_ID, couple_id: COUPLE_ID, sender_id: USER_ID, visibility: "shared", metadata: {} },
      error: null,
    });
    const json = `{"messageId":"${SHARED_MESSAGE_ID.replaceAll("4", "\\u0034")}"}`;
    const bytes = new TextEncoder().encode(json);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });

    const response = await POST(streamedRequest(stream));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ urls: [] });
    expect(query.filters).toEqual([["id", SHARED_MESSAGE_ID]]);
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it.each(["invalid UTF-8", "stream read failure"])("returns a generic recovery for %s before reading attachment records", async (failure) => {
    const { requestClient } = mockVisibleMessage({ data: null, error: null });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (failure === "stream read failure") controller.error(new Error("PRIVATE_IMAGE_READ_DIAGNOSTIC"));
        else { controller.enqueue(new Uint8Array([0xc3, 0x28])); controller.close(); }
      },
    });

    const response = await POST(streamedRequest(stream));

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_IMAGE_READ_DIAGNOSTIC");
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request without reading the body or running the limiter", async () => {
    createClientFromRequestSpy.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    let read = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { read = true; throw new Error("UNAUTHENTICATED_BODY_MUST_NOT_BE_READ"); } }, { highWaterMark: 0 });

    expect((await POST(streamedRequest(stream))).status).toBe(401);
    expect(read).toBe(false);
    expect(persistentLimitSpy).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it("preserves the persistent rate limit before reading a body or looking up attachments", async () => {
    const { requestClient } = mockVisibleMessage({ data: null, error: null });
    persistentLimitSpy.mockResolvedValue(new Response(JSON.stringify({ error: "요청이 너무 많습니다." }), { status: 429 }));
    let read = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { read = true; throw new Error("RATE_LIMITED_BODY_MUST_NOT_BE_READ"); } }, { highWaterMark: 0 });

    expect((await POST(streamedRequest(stream))).status).toBe(429);
    expect(read).toBe(false);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createServiceClientSpy).not.toHaveBeenCalled();
  });

  it("rejects a cross-site origin before authentication or reading its body", async () => {
    let read = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { read = true; throw new Error("UNTRUSTED_BODY_MUST_NOT_BE_READ"); } }, { highWaterMark: 0 });

    expect((await POST(streamedRequest(stream, { Origin: "https://evil.invalid" }))).status).toBe(403);
    expect(read).toBe(false);
    expect(createClientFromRequestSpy).not.toHaveBeenCalled();
    expect(persistentLimitSpy).not.toHaveBeenCalled();
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
