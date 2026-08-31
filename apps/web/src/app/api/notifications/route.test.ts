import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  hasSignedDemoSessionFromCookieHeader: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: mocks.hasSignedDemoSessionFromCookieHeader,
}));
vi.mock("@/utils/log", () => ({
  log: {
    error: mocks.logError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { GET, POST } from "./route";

const USER_ID = "40000000-0000-4000-8000-000000000001";
const NOTIFICATION_ID = "10000000-0000-4000-8000-000000000001";

function notificationListClient(
  unreadResult: { data: unknown; error: unknown },
  historyResult: { data: unknown; error: unknown } = {
    data: [],
    error: null,
  },
  activePlanResult: { data: unknown; error: unknown } = {
    data: [],
    error: null,
  },
) {
  function query(result: { data: unknown; error: unknown }) {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      not: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.is.mockReturnValue(builder);
    builder.not.mockReturnValue(builder);
    builder.in.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    builder.limit.mockResolvedValue(result);
    return builder;
  }

  const unread = query(unreadResult);
  const history = query(historyResult);
  const activePlan = query(activePlanResult);
  const from = vi.fn()
    .mockReturnValueOnce(unread)
    .mockReturnValueOnce(history)
    .mockReturnValueOnce(activePlan);

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
        }),
      },
      from,
    },
    unread,
    history,
    activePlan,
    from,
  };
}

function notificationReadClient(result: { error: unknown } = { error: null }) {
  const idFilter = vi.fn().mockResolvedValue(result);
  const terminal = {
    in: idFilter,
    then: (
      onFulfilled: (value: { error: unknown }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const unreadFilter = vi.fn().mockReturnValue(terminal);
  const recipientFilter = vi.fn().mockReturnValue({ is: unreadFilter });
  const update = vi.fn().mockReturnValue({ eq: recipientFilter });
  const from = vi.fn().mockReturnValue({ update });

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
        }),
      },
      from,
    },
    from,
    idFilter,
    recipientFilter,
    unreadFilter,
    update,
  };
}

function postRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://hanbang.ai/api/notifications", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSignedDemoSessionFromCookieHeader.mockReturnValue(false);
  });

  it("알림 조회가 통째로 실패하면 조용히 넘어가지 않고 보고한다", async () => {
    mocks.createClientFromRequest.mockRejectedValue(
      new Error("session service unavailable"),
    );

    const response = await GET(
      new Request("https://hanbang.ai/api/notifications"),
    );

    expect(response.status).toBe(503);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError.mock.calls[0][0]).toContain("notifications GET");
  });

  it("returns unread delivery before a bounded recent read history", async () => {
    const row = {
      id: NOTIFICATION_ID,
      event_kind: "change_applied",
      action_id: "action-1",
      tool_name: "update_budget",
      title: "예산이 변경됐어요",
      message: "공동 예산 변경이 반영됐어요.",
      href: "/budget",
      read_at: null,
      created_at: "2026-07-30T01:00:00.000Z",
    };
    const database = notificationListClient({ data: [row], error: null });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await GET(
      new Request("https://hanbang.ai/api/notifications", {
        headers: { authorization: "Bearer native-session-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(database.from).toHaveBeenCalledTimes(3);
    expect(database.from).toHaveBeenNthCalledWith(
      1,
      "couple_change_notifications",
    );
    expect(database.from).toHaveBeenNthCalledWith(
      2,
      "couple_change_notifications",
    );
    expect(database.from).toHaveBeenNthCalledWith(
      3,
      "couple_change_notifications",
    );
    expect(database.unread.eq).toHaveBeenCalledWith(
      "recipient_user_id",
      USER_ID,
    );
    expect(database.unread.is).toHaveBeenCalledWith("read_at", null);
    expect(database.unread.limit).toHaveBeenCalledWith(200);
    expect(database.history.eq).toHaveBeenCalledWith(
      "recipient_user_id",
      USER_ID,
    );
    expect(database.history.not).toHaveBeenCalledWith(
      "read_at",
      "is",
      null,
    );
    expect(database.history.limit).toHaveBeenCalledWith(50);
    expect(database.activePlan.eq).toHaveBeenCalledWith(
      "recipient_user_id",
      USER_ID,
    );
    expect(database.activePlan.eq).toHaveBeenCalledWith(
      "tool_name",
      "manual_plan_change",
    );
    expect(database.activePlan.in).toHaveBeenCalledWith(
      "event_kind",
      ["approval_pending", "approval_requested"],
    );
    expect(database.activePlan.limit).toHaveBeenCalledWith(20);
    await expect(response.json()).resolves.toEqual({
      ownerId: USER_ID,
      notifications: [row],
    });
  });

  it("keeps a read outgoing approval pending visible even when it is outside bounded history", async () => {
    const pending = {
      id: "10000000-0000-4000-8000-000000000002",
      event_kind: "approval_pending",
      action_id: "20000000-0000-4000-8000-000000000001",
      tool_name: "manual_plan_change",
      title: "파트너 확인을 기다리고 있어요",
      message: "총예산: 30000000원 → 40000000원",
      href: "/budget",
      read_at: "2026-07-30T02:00:00.000Z",
      created_at: "2026-07-30T01:00:00.000Z",
    };
    const database = notificationListClient(
      { data: [], error: null },
      { data: [], error: null },
      { data: [pending], error: null },
    );
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await GET(
      new Request("https://hanbang.ai/api/notifications"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ownerId: USER_ID,
      notifications: [pending],
    });
  });

  it("returns a safe empty list for a signed demo session without querying rows", async () => {
    const from = vi.fn();
    mocks.hasSignedDemoSessionFromCookieHeader.mockReturnValue(true);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from,
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/notifications", {
        headers: { cookie: "demo_session=signed" },
      }),
    );

    expect(response.status).toBe(200);
    expect(from).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ownerId: null,
      notifications: [],
    });
  });

  it("fails closed when the recipient-scoped query fails", async () => {
    const database = notificationListClient({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await GET(
      new Request("https://hanbang.ai/api/notifications"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("returns a non-cacheable recovery response when authentication lookup fails", async () => {
    mocks.createClientFromRequest.mockRejectedValue(
      new Error("session service unavailable"),
    );

    const response = await GET(
      new Request("https://hanbang.ai/api/notifications"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });
});

describe("POST /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSignedDemoSessionFromCookieHeader.mockReturnValue(false);
  });

  it("marks only the authenticated recipient's selected notification ids as read", async () => {
    const database = notificationReadClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({ ids: [NOTIFICATION_ID] }));

    expect(response.status).toBe(200);
    expect(database.from).toHaveBeenCalledWith("couple_change_notifications");
    expect(database.update).toHaveBeenCalledWith({
      read_at: expect.stringMatching(/^2026-|^20\d\d-/),
    });
    expect(database.recipientFilter).toHaveBeenCalledWith(
      "recipient_user_id",
      USER_ID,
    );
    expect(database.unreadFilter).toHaveBeenCalledWith("read_at", null);
    expect(database.idFilter).toHaveBeenCalledWith("id", [NOTIFICATION_ID]);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("marks every unread notification for only the authenticated recipient", async () => {
    const database = notificationReadClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({ all: true }));

    expect(response.status).toBe(200);
    expect(database.recipientFilter).toHaveBeenCalledWith(
      "recipient_user_id",
      USER_ID,
    );
    expect(database.unreadFilter).toHaveBeenCalledWith("read_at", null);
    expect(database.idFilter).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied identity and actor fields before any write", async () => {
    const database = notificationReadClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(
      postRequest({
        ids: [NOTIFICATION_ID],
        recipient_user_id: "50000000-0000-4000-8000-000000000001",
        actor_user_id: USER_ID,
      }),
    );

    expect(response.status).toBe(400);
    expect(database.from).not.toHaveBeenCalled();
  });

  it("rejects invalid, empty, and oversized id lists before any write", async () => {
    const database = notificationReadClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const requests = [
      POST(postRequest({ ids: [] })),
      POST(postRequest({ ids: ["not-a-uuid"] })),
      POST(
        postRequest({
          ids: Array.from(
            { length: 51 },
            (_, index) =>
              `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ),
        }),
      ),
    ];
    const responses = await Promise.all(requests);

    expect(responses.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(database.from).not.toHaveBeenCalled();
  });

  it("enforces the byte limit even without a content-length header", async () => {
    const database = notificationReadClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(
      postRequest({ ids: [NOTIFICATION_ID], padding: "x".repeat(5_000) }),
    );

    expect(response.status).toBe(413);
    expect(database.from).not.toHaveBeenCalled();
  });

  it("rejects cross-site cookie mutations before authentication", async () => {
    const response = await POST(
      postRequest(
        { ids: [NOTIFICATION_ID] },
        {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  // 이 두 경로는 예전에 `catch {}` 로 삼켜져 아무 흔적도 남지 않았다. 사용자만
  // 실패를 보고 우리는 몰랐다 — 그래서 보고가 나가는지를 못 박는다.
  it("읽음 저장이 실패하면 조용히 넘어가지 않고 보고한다", async () => {
    const database = notificationReadClient({
      error: { code: "42501", message: "permission denied" },
    });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({ ids: [NOTIFICATION_ID] }));

    expect(response.status).toBe(503);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError.mock.calls[0][0]).toContain("notifications POST");
  });

  it("읽음 처리 중 예외도 보고한다", async () => {
    mocks.createClientFromRequest.mockRejectedValue(
      new Error("session service unavailable"),
    );

    const response = await POST(postRequest({ ids: [NOTIFICATION_ID] }));

    expect(response.status).toBe(503);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError.mock.calls[0][0]).toContain("notifications POST");
  });

  it("does not confirm a read when the recipient-scoped write fails", async () => {
    const database = notificationReadClient({
      error: { code: "42501", message: "permission denied" },
    });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({ ids: [NOTIFICATION_ID] }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("returns a non-cacheable failure instead of leaking an authentication exception", async () => {
    mocks.createClientFromRequest.mockRejectedValue(
      new Error("session service unavailable"),
    );

    const response = await POST(postRequest({ ids: [NOTIFICATION_ID] }));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });
});
