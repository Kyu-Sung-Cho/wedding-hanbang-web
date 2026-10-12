import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientFromRequestSpy, createAdminClientSpy } = vi.hoisted(() => ({
  createClientFromRequestSpy: vi.fn(),
  createAdminClientSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: createClientFromRequestSpy,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createAdminClientSpy,
}));

import { POST } from "../route";

type QueryResult = { data?: unknown; error?: unknown; count?: number | null };

class FakeQuery {
  constructor(
    private readonly result: QueryResult | (() => QueryResult),
    private readonly onInsert?: (payload: unknown) => void,
    private readonly onEq?: (column: string, value: unknown) => void,
    private readonly onNot?: (column: string, operator: string, value: unknown) => void,
    private readonly onGte?: (column: string, value: string) => void
  ) {}

  select() { return this; }
  eq(column: string, value: unknown) {
    this.onEq?.(column, value);
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    this.onNot?.(column, operator, value);
    return this;
  }
  gte(column: string, value: string) {
    this.onGte?.(column, value);
    return this;
  }
  insert(payload: unknown) {
    this.onInsert?.(payload);
    return this;
  }
  single() { return Promise.resolve(typeof this.result === "function" ? this.result() : this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.single().then(onfulfilled, onrejected);
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
  let feedbackQueryCount = 0;
  const admin = {
    from: vi.fn((table: string) => {
      if (table !== "chat_feedback") {
        throw new Error(`admin must not read table: ${table}`);
      }
      feedbackQueryCount += 1;
      return feedbackQueryCount === 1
        ? new FakeQuery({ count: 0 })
        : new FakeQuery(
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
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ messageId, rating: "bad", correction }),
  });
}

function feedbackRequestFromBody(body: unknown) {
  return new Request("http://localhost/api/chat/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

function streamedFeedbackRequest(body: ReadableStream<Uint8Array>, extraHeaders: Record<string, string> = {}) {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", ...extraHeaders },
    body,
    duplex: "half",
  };
  return new Request("http://localhost/api/chat/feedback", init);
}

describe("POST /api/chat/feedback", () => {
  beforeEach(() => {
    createClientFromRequestSpy.mockReset();
    createAdminClientSpy.mockReset();
  });

  it("cancels an oversized chunked body before reading its tail or touching feedback records", async () => {
    const requestClient = mockRequestClient({ data: null, error: null });
    let pullCount = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) controller.enqueue(new Uint8Array(131_155));
        else throw new Error("OVERSIZED_FEEDBACK_TAIL_MUST_NOT_BE_READ");
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: stream,
      duplex: "half",
    };

    const response = await POST(new Request("http://localhost/api/chat/feedback", init));

    expect(response.status).toBe(413);
    expect(pullCount).toBe(1);
    expect(cancelled).toBe(true);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, "1", "16384"])("counts actual UTF-8 bytes despite Content-Length %s", async (contentLength) => {
    const requestClient = mockRequestClient({ data: null, error: null });
    const bytes = new TextEncoder().encode(JSON.stringify({ messageId: MESSAGE_A, rating: "bad", correction: "가".repeat(44_000) }));
    let readBytes = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (readBytes >= 20_480) throw new Error("FEEDBACK_TAIL_MUST_NOT_BE_READ");
        const next = readBytes + 4_096;
        controller.enqueue(bytes.slice(readBytes, next));
        readBytes = next;
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });

    const response = await POST(streamedFeedbackRequest(stream, contentLength === undefined ? {} : { "Content-Length": contentLength }));

    expect(response.status).toBe(413);
    expect(readBytes).toBe(20_480);
    expect(cancelled).toBe(true);
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before authentication", async () => {
    const request = feedbackRequest(MESSAGE_A, "확인");
    request.headers.set("Content-Length", "16385");

    expect((await POST(request)).status).toBe(413);
    expect(createClientFromRequestSpy).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("preserves a maximum-length Unicode correction even when JSON escapes every character", async () => {
    mockRequestClient({ data: { sender_type: "ai", visibility: "shared", content: "공유 답변" }, error: null });
    const inserts: unknown[] = [];
    mockAdminClient(inserts);
    const json = `{"messageId":"${MESSAGE_A}","rating":"bad","correction":"${"\\uac00".repeat(2_000)}","category":"correction"}`;

    const response = await POST(new Request("http://localhost/api/chat/feedback", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: json,
    }));

    expect(response.status).toBe(200);
    expect(inserts).toEqual([expect.objectContaining({ correction: "가".repeat(2_000) })]);
  });

  it("preserves Unicode characters split across request chunks", async () => {
    mockRequestClient({ data: { sender_type: "ai", visibility: "shared", content: "공유 답변" }, error: null });
    const inserts: unknown[] = [];
    mockAdminClient(inserts);
    const bytes = new TextEncoder().encode(JSON.stringify({ messageId: MESSAGE_A, rating: "bad", correction: "가😀설명" }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });

    expect((await POST(streamedFeedbackRequest(stream))).status).toBe(200);
    expect(inserts).toEqual([expect.objectContaining({ correction: "가😀설명" })]);
  });

  it.each(["invalid UTF-8", "stream read failure"])("returns bounded generic recovery for %s without database access", async (failure) => {
    const requestClient = mockRequestClient({ data: null, error: null });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (failure === "stream read failure") controller.error(new Error("PRIVATE_FEEDBACK_READ_DIAGNOSTIC"));
        else { controller.enqueue(new Uint8Array([0xc3, 0x28])); controller.close(); }
      },
    });

    const response = await POST(streamedFeedbackRequest(stream));

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_FEEDBACK_READ_DIAGNOSTIC");
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated body without reading it", async () => {
    createClientFromRequestSpy.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    let read = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { read = true; throw new Error("UNAUTHENTICATED_BODY_MUST_NOT_BE_READ"); } }, { highWaterMark: 0 });

    expect((await POST(streamedFeedbackRequest(stream))).status).toBe(401);
    expect(read).toBe(false);
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("preserves the mutation-origin rejection before reading a request body", async () => {
    let read = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { read = true; throw new Error("UNTRUSTED_BODY_MUST_NOT_BE_READ"); } }, { highWaterMark: 0 });

    expect((await POST(streamedFeedbackRequest(stream, { Origin: "https://evil.invalid" }))).status).toBe(403);
    expect(read).toBe(false);
    expect(createClientFromRequestSpy).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it.each([[19, 200], [20, 429]])(
    "counts %i manual feedback rows separately from automatic null-message signals",
    async (manualCount, expectedStatus) => {
      mockRequestClient({ data: { sender_type: "ai", visibility: "shared", content: "공유 답변" }, error: null });
      const inserts: unknown[] = [];
      const now = Date.now();
      const recent = new Date(now - 60_000).toISOString();
      const old = new Date(now - 2 * 60 * 60_000).toISOString();
      const rows = [
        ...Array.from({ length: manualCount }, () => ({ user_id: "user-a", message_id: MESSAGE_A as string | null, created_at: recent })),
        ...Array.from({ length: 25 }, () => ({ user_id: "user-a", message_id: null, created_at: recent })),
        ...Array.from({ length: 25 }, () => ({ user_id: "other-user", message_id: MESSAGE_A, created_at: recent })),
        ...Array.from({ length: 25 }, () => ({ user_id: "user-a", message_id: MESSAGE_A, created_at: old })),
      ];
      let caller: unknown;
      let since = "";
      let excludeAutomatic = false;
      let queries = 0;
      const rateQuery = new FakeQuery(
        () => ({ count: rows.filter(row => row.user_id === caller && row.created_at >= since && (!excludeAutomatic || row.message_id !== null)).length }),
        undefined,
        (column, value) => { if (column === "user_id") caller = value; },
        (column, operator, value) => { if (column === "message_id" && operator === "is" && value === null) excludeAutomatic = true; },
        (column, value) => { if (column === "created_at") since = value; }
      );
      createAdminClientSpy.mockReturnValue({
        from(table: string) {
          expect(table).toBe("chat_feedback");
          queries++;
          return queries === 1 ? rateQuery : new FakeQuery({ data: { id: "new-manual" }, error: null }, payload => inserts.push(payload));
        },
      });

      const response = await POST(feedbackRequest(MESSAGE_A, "이 설명을 확인해 주세요"));

      expect(response.status).toBe(expectedStatus);
      expect(excludeAutomatic).toBe(true);
      expect(inserts).toHaveLength(expectedStatus === 200 ? 1 : 0);
    }
  );

  it.each([
    ["database count error", { count: null, error: { message: "PRIVATE_COUNT_DIAGNOSTIC" } }],
    ["count error despite a numeric result", { count: 0, error: { message: "PRIVATE_COUNT_DIAGNOSTIC" } }],
    ["null count", { count: null, error: null }],
    ["missing count", { error: null }],
    ["non-finite count", { count: Number.NaN, error: null }],
    ["negative count", { count: -1, error: null }],
    ["fractional count", { count: 0.5, error: null }],
  ])("fails closed with retry guidance for %s before message access or writing feedback", async (_label, countResult) => {
    const requestClient = mockRequestClient({ data: { sender_type: "ai", visibility: "shared", content: "공유 답변" }, error: null });
    const inserts: unknown[] = [];
    let queryCount = 0;
    const admin = {
      from: vi.fn(() => {
        queryCount += 1;
        return queryCount === 1
          ? new FakeQuery(countResult)
          : new FakeQuery({ data: { id: "must-not-insert" }, error: null }, payload => inserts.push(payload));
      }),
    };
    createAdminClientSpy.mockReturnValue(admin);

    const response = await POST(feedbackRequest(MESSAGE_A, "사용자가 승인한 피드백"));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    const body = await response.json();
    expect(body.error).toContain("다시");
    expect(JSON.stringify(body)).not.toContain("PRIVATE_COUNT_DIAGNOSTIC");
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(inserts).toEqual([]);
  });

  it("returns retry guidance when the rate-count query throws without touching message data", async () => {
    const requestClient = mockRequestClient({ data: null, error: null });
    const admin = {
      from: vi.fn(() => new FakeQuery(() => { throw new Error("PRIVATE_COUNT_EXCEPTION"); })),
    };
    createAdminClientSpy.mockReturnValue(admin);

    const response = await POST(feedbackRequest(MESSAGE_A, "다시 확인해 주세요"));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_COUNT_EXCEPTION");
    expect(requestClient.from).not.toHaveBeenCalled();
    expect(admin.from).toHaveBeenCalledTimes(1);
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
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: "{not-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
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
