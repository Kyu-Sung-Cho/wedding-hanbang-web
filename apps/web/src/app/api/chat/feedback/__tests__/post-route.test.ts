import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientFromRequestSpy, createAdminClientSpy, checkRateLimitPersistentSpy } = vi.hoisted(() => ({
  createClientFromRequestSpy: vi.fn(),
  createAdminClientSpy: vi.fn(),
  checkRateLimitPersistentSpy: vi.fn<() => Promise<Response | null>>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: createClientFromRequestSpy,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createAdminClientSpy,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: checkRateLimitPersistentSpy,
  rateLimitKey: (scope: string, _request: Request, userId?: string) =>
    `${scope}:${userId ?? "guest"}`,
}));

import { POST } from "../route";

type QueryResult = { data?: unknown; error?: unknown; count?: number | null };

class FakeQuery {
  constructor(
    private readonly result: QueryResult,
    private readonly onInsert?: (payload: unknown) => void,
    private readonly onEq?: (column: string, value: unknown) => void
  ) {}

  select() { return this; }
  eq(column: string, value: unknown) {
    this.onEq?.(column, value);
    return this;
  }
  gte() { return this; }
  insert(payload: unknown) {
    this.onInsert?.(payload);
    return this;
  }
  single() { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const MESSAGE_A = "11111111-1111-4111-8111-111111111111";
const LEAKED_MESSAGE = "22222222-2222-4222-8222-222222222222";
const PARTNER_PRIVATE_MESSAGE = "33333333-3333-4333-8333-333333333333";

function mockRequestClient(messageResult: QueryResult, coupleId: string | null = "couple-a") {
  const messageFilters: Array<[string, unknown]> = [];
  const requestClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-a" } },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return new FakeQuery({ data: { couple_id: coupleId }, error: null });
      }
      if (table === "chat_messages") {
        return new FakeQuery(
          messageResult,
          undefined,
          (column, value) => { messageFilters.push([column, value]); }
        );
      }
      throw new Error(`unexpected request-scoped table: ${table}`);
    }),
  };
  createClientFromRequestSpy.mockResolvedValue(requestClient);
  return Object.assign(requestClient, { messageFilters });
}

function mockAdminClient(inserts: unknown[]) {
  const admin = {
    from: vi.fn((table: string) => {
      if (table !== "chat_feedback") {
        throw new Error(`admin must not read table: ${table}`);
      }
      return new FakeQuery(
        { data: { id: "feedback-a" }, error: null },
        (payload) => { inserts.push(payload); }
      );
    }),
  };
  createAdminClientSpy.mockReturnValue(admin);
  return admin;
}

function feedbackRequest(messageId: string, correction: string) {
  return new Request("http://localhost/api/chat/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, rating: "bad", correction }),
  });
}

function feedbackRequestFromBody(body: unknown) {
  return new Request("http://localhost/api/chat/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function oversizedChunkedFeedbackRequest(maxBytes: number) {
  let pullCount = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      if (pullCount === 1) controller.enqueue(new Uint8Array(maxBytes));
      else if (pullCount === 2) controller.enqueue(new Uint8Array([1]));
      else controller.enqueue(new Uint8Array(1_000_000));
    },
  }, { highWaterMark: 0 });

  return new Request("http://localhost/api/chat/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("POST /api/chat/feedback", () => {
  beforeEach(() => {
    createClientFromRequestSpy.mockReset();
    createAdminClientSpy.mockReset();
    checkRateLimitPersistentSpy.mockReset();
    checkRateLimitPersistentSpy.mockResolvedValue(null);
  });

  it("rejects a non-UUID message ID before creating an admin client", async () => {
    mockRequestClient({ data: null, error: null });

    const response = await POST(feedbackRequest(
      "not-a-uuid",
      "MALFORMED_ID_CANARY_0ef3c1"
    ));

    expect(response.status).toBe(400);
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before privileged database access", async () => {
    const requestClient = mockRequestClient({ data: null, error: null });
    const request = new Request("http://localhost/api/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("rejects an oversized chunked body without Content-Length before privileged database access", async () => {
    const requestClient = mockRequestClient({ data: null, error: null });
    const request = oversizedChunkedFeedbackRequest(8 * 1024);
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("honors the shared atomic limiter before reading profile or message data", async () => {
    const requestClient = mockRequestClient({ data: null, error: null });
    checkRateLimitPersistentSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
    );

    const response = await POST(feedbackRequest(MESSAGE_A, "limited"));

    expect(response.status).toBe(429);
    expect(checkRateLimitPersistentSpy).toHaveBeenCalledWith(
      "chat:feedback:user-a",
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
    );
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["null body", null],
    ["array body", []],
    ["non-string correction", { messageId: MESSAGE_A, rating: "bad", correction: 7 }],
    ["oversized correction", { messageId: MESSAGE_A, rating: "bad", correction: "x".repeat(2_001) }],
    ["non-string category", { messageId: MESSAGE_A, rating: "bad", category: {} }],
    ["unknown category", { messageId: MESSAGE_A, rating: "bad", category: "private free text" }],
    ["unknown field", { messageId: MESSAGE_A, rating: "bad", unexpected: "value" }],
  ])("rejects %s before any privileged database access", async (_label, body) => {
    const requestClient = mockRequestClient({ data: null, error: null });

    const response = await POST(feedbackRequestFromBody(body));

    expect(response.status).toBe(400);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("rejects a leaked message ID that request-scoped RLS cannot read", async () => {
    const inserts: unknown[] = [];
    mockRequestClient({ data: null, error: { code: "PGRST116" } });
    mockAdminClient(inserts);

    const response = await POST(feedbackRequest(
      LEAKED_MESSAGE,
      "CROSS_COUPLE_POST_CANARY_f21c9a"
    ));

    expect(response.status).toBe(404);
    expect(inserts).toEqual([]);
  });

  it("rejects a partner-private message hidden by request-scoped RLS", async () => {
    const inserts: unknown[] = [];
    mockRequestClient({ data: null, error: { code: "PGRST116" } });
    mockAdminClient(inserts);

    const response = await POST(feedbackRequest(
      PARTNER_PRIVATE_MESSAGE,
      "PARTNER_PRIVATE_POST_CANARY_5b12d8"
    ));

    expect(response.status).toBe(404);
    expect(inserts).toEqual([]);
  });

  it("rejects a user without a couple before reading a message", async () => {
    const inserts: unknown[] = [];
    const requestClient = mockRequestClient({ data: null, error: null }, null);
    mockAdminClient(inserts);

    const response = await POST(feedbackRequest(MESSAGE_A, "no couple"));

    expect(response.status).toBe(403);
    expect(requestClient.from).toHaveBeenCalledTimes(1);
    expect(requestClient.messageFilters).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("rejects feedback attached to a user-authored message", async () => {
    const inserts: unknown[] = [];
    mockRequestClient({
      data: { content: "user text", sender_type: "bride", visibility: "shared" },
      error: null,
    });
    mockAdminClient(inserts);

    const response = await POST(feedbackRequest(MESSAGE_A, "not an AI response"));

    expect(response.status).toBe(404);
    expect(inserts).toEqual([]);
  });

  it.each(["bride_private", "groom_private"])(
    "does not copy requester-readable %s conversation text into chat_feedback",
    async (visibility) => {
      const inserts: unknown[] = [];
      mockRequestClient({
        data: {
          content: "PRIVATE_AI_RESPONSE_CANARY_6aecc3",
          sender_type: "ai",
          visibility,
        },
        error: null,
      });
      mockAdminClient(inserts);

      const response = await POST(feedbackRequest(
        MESSAGE_A,
        "PRIVATE_CORRECTION_CANARY_b4f8b2"
      ));

      expect(response.status).toBe(403);
      expect(inserts).toEqual([]);
    }
  );

  it("preserves explicit feedback for an accessible AI message", async () => {
    const inserts: unknown[] = [];
    const requestClient = mockRequestClient({
      data: { content: "assistant answer", sender_type: "ai", visibility: "shared" },
      error: null,
    });
    mockAdminClient(inserts);

    const response = await POST(feedbackRequest(MESSAGE_A, "my explicit correction"));

    expect(response.status).toBe(200);
    expect(inserts).toEqual([expect.objectContaining({
      user_id: "user-a",
      couple_id: "couple-a",
      message_id: MESSAGE_A,
      correction: "my explicit correction",
      message_content: "assistant answer",
    })]);
    expect(requestClient.messageFilters).toEqual([
      ["id", MESSAGE_A],
      ["couple_id", "couple-a"],
    ]);
  });
});
