import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  loadOwnedVendorWithServiceRole: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/vendors/serverOwnership", () => ({
  loadOwnedVendorWithServiceRole: mocks.loadOwnedVendorWithServiceRole,
}));
vi.mock("@/lib/utils/vendorMapper", () => ({
  messageRowToMessage: (row: unknown) => row,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string, _request: Request, userId?: string) =>
    `${scope}:${userId ?? "guest"}`,
}));

import { GET, PATCH, POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const VENDOR_ID = "10000000-0000-4000-8000-000000000001";

function authenticatedClient(from = vi.fn()) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
    },
    from,
  };
}

function mutationRequest(
  method: "PATCH" | "POST",
  body: unknown,
  headers: HeadersInit = {},
) {
  return new Request("https://hanbang.ai/api/messages", {
    method,
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function markReadAdminClient(result: {
  data: unknown;
  error: { message: string } | null;
} = { data: 1, error: null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  const from = vi.fn();
  return {
    client: { from, rpc },
    from,
    rpc,
  };
}

function messageRpcAdminClient(result: { data: unknown; error: { message: string } | null }) {
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn().mockReturnValue({ single });
  const from = vi.fn();
  return { client: { from, rpc }, from, rpc, single };
}

describe("GET /api/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("is side-effect free even when an authenticated image request loads a thread URL", async () => {
    const row = {
      id: "20000000-0000-4000-8000-000000000001",
      vendor_id: VENDOR_ID,
      customer_id: USER_ID,
      server_provenance_version: 1,
      sender_type: "vendor",
      content: "unread",
      is_read: false,
      booking_id: null,
      created_at: "2026-08-02T00:00:00.000Z",
    };
    const customerEq = vi.fn().mockResolvedValue({ data: [row], error: null });
    const order = vi.fn().mockReturnValue({ eq: customerEq });
    const vendorEq = vi.fn().mockReturnValue({ order });
    const provenanceEq = vi.fn().mockReturnValue({ eq: vendorEq });
    const select = vi.fn().mockReturnValue({ eq: provenanceEq });
    const from = vi.fn().mockReturnValue({ select });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const response = await GET(new Request(
      `https://hanbang.ai/api/messages?vendorId=${VENDOR_ID}`,
      { headers: { "sec-fetch-dest": "image", "sec-fetch-site": "same-origin" } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(provenanceEq).toHaveBeenCalledWith("server_provenance_version", 1);
    expect(vendorEq).toHaveBeenCalledWith("vendor_id", VENDOR_ID);
    expect(customerEq).toHaveBeenCalledWith("customer_id", USER_ID);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ messages: [row] });
  });

  it("rejects a vendor-context thread read when approved ownership is absent", async () => {
    const customerEq = vi.fn();
    const order = vi.fn().mockReturnValue({ eq: customerEq });
    const vendorEq = vi.fn().mockReturnValue({ order });
    const provenanceEq = vi.fn().mockReturnValue({ eq: vendorEq });
    const select = vi.fn().mockReturnValue({ eq: provenanceEq });
    const from = vi.fn().mockReturnValue({ select });
    const admin = { from: vi.fn() };
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.loadOwnedVendorWithServiceRole.mockResolvedValue(null);

    const response = await GET(new Request(
      `https://hanbang.ai/api/messages?vendorId=${VENDOR_ID}&customerId=${CUSTOMER_ID}`,
    ));

    expect(response.status).toBe(403);
    expect(provenanceEq).toHaveBeenCalledWith("server_provenance_version", 1);
    expect(vendorEq).toHaveBeenCalledWith("vendor_id", VENDOR_ID);
    expect(mocks.loadOwnedVendorWithServiceRole).toHaveBeenCalledWith(
      admin,
      USER_ID,
      VENDOR_ID,
    );
    expect(customerEq).not.toHaveBeenCalled();
  });
});

describe("message mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("rejects cross-site PATCH and POST before authentication or service access", async () => {
    const headers = {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    };
    const [patchResponse, postResponse] = await Promise.all([
      PATCH(mutationRequest("PATCH", { vendorId: VENDOR_ID }, headers)),
      POST(mutationRequest("POST", { vendorId: VENDOR_ID, content: "spam" }, headers)),
    ]);

    expect(patchResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("marks only the authenticated customer's unread vendor messages", async () => {
    const admin = markReadAdminClient();
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await PATCH(mutationRequest("PATCH", { vendorId: VENDOR_ID }));

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("mark_vendor_messages_read_service_v1", {
      p_actor_id: USER_ID,
      p_vendor_id: VENDOR_ID,
      p_customer_id: null,
    });
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.loadOwnedVendorWithServiceRole).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ markedRead: true });
  });

  it("maps an atomic vendor ownership rejection without leaking RPC details", async () => {
    const rawError = `vendor_message_mark_read_forbidden customer=${CUSTOMER_ID}`;
    const admin = markReadAdminClient({
      data: null,
      error: { message: rawError },
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await PATCH(mutationRequest("PATCH", {
      vendorId: VENDOR_ID,
      customerId: CUSTOMER_ID,
    }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "권한이 없습니다." });
    expect(JSON.stringify(body)).not.toContain(CUSTOMER_ID);
    expect(admin.rpc).toHaveBeenCalledWith("mark_vendor_messages_read_service_v1", {
      p_actor_id: USER_ID,
      p_vendor_id: VENDOR_ID,
      p_customer_id: CUSTOMER_ID,
    });
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.loadOwnedVendorWithServiceRole).not.toHaveBeenCalled();
  });

  it("delegates an owner acknowledgment and its direction filters to the atomic RPC", async () => {
    const admin = markReadAdminClient({ data: 2, error: null });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await PATCH(mutationRequest("PATCH", {
      vendorId: VENDOR_ID,
      customerId: CUSTOMER_ID,
    }));

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("mark_vendor_messages_read_service_v1", {
      p_actor_id: USER_ID,
      p_vendor_id: VENDOR_ID,
      p_customer_id: CUSTOMER_ID,
    });
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.loadOwnedVendorWithServiceRole).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ markedRead: true });
  });

  it("accepts a zero mark count as a successful idempotent acknowledgment", async () => {
    const admin = markReadAdminClient({ data: 0, error: null });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await PATCH(mutationRequest("PATCH", { vendorId: VENDOR_ID }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ markedRead: true });
  });

  it("maps mark-read input rejection to a bounded client error", async () => {
    const admin = markReadAdminClient({
      data: null,
      error: {
        message: `invalid_vendor_message_mark_read_input actor=${CUSTOMER_ID}`,
      },
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await PATCH(mutationRequest("PATCH", { vendorId: VENDOR_ID }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "대화 식별자가 올바르지 않습니다." });
    expect(JSON.stringify(body)).not.toContain(CUSTOMER_ID);
  });

  it("fails closed when the mark-read RPC returns a malformed count", async () => {
    const admin = markReadAdminClient({ data: "1", error: null });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await PATCH(mutationRequest("PATCH", { vendorId: VENDOR_ID }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "읽음 처리에 실패했습니다." });
    consoleError.mockRestore();
  });

  it("fails closed on an unknown mark-read RPC error without returning diagnostics", async () => {
    const admin = markReadAdminClient({
      data: null,
      error: { message: "private database diagnostic" },
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await PATCH(mutationRequest("PATCH", { vendorId: VENDOR_ID }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "읽음 처리에 실패했습니다." });
    expect(JSON.stringify(body)).not.toContain("private database diagnostic");
    consoleError.mockRestore();
  });

  it("fails a message send closed before body parsing or service access when the shared limiter is unavailable", async () => {
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    );

    const response = await POST(mutationRequest("POST", {
      vendorId: VENDOR_ID,
      content: "rate limited",
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `messages:send:${USER_ID}`,
      { maxRequests: 30, windowMs: 60 * 1000 },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("sends through the atomic relationship RPC without a direct service-role insert", async () => {
    const row = {
      id: "20000000-0000-4000-8000-000000000001",
      vendor_id: VENDOR_ID,
      customer_id: USER_ID,
      server_provenance_version: 1,
      sender_type: "customer",
      content: "문의합니다",
      is_read: false,
      booking_id: null,
      created_at: "2026-08-02T00:00:00.000Z",
    };
    const admin = messageRpcAdminClient({ data: row, error: null });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await POST(mutationRequest("POST", {
      vendorId: VENDOR_ID,
      content: "  문의합니다  ",
    }));

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("send_vendor_message_service_v1", {
      p_actor_id: USER_ID,
      p_vendor_id: VENDOR_ID,
      p_customer_id: null,
      p_content: "문의합니다",
    });
    expect(admin.single).toHaveBeenCalledOnce();
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.loadOwnedVendorWithServiceRole).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ message: row });
  });

  it.each([
    ["vendor_message_relationship_required", 403, "해당 대화를 시작할 권한이 없습니다."],
    ["vendor_message_customer_override_forbidden", 403, "해당 대화를 시작할 권한이 없습니다."],
    ["vendor_message_vendor_unavailable", 404, "업체를 찾을 수 없거나 이용할 수 없습니다."],
  ])("maps an expected authorization rejection without exposing raw database details: %s", async (
    reason,
    expectedStatus,
    expectedMessage,
  ) => {
    const rawDatabaseMessage = `${reason}: customer=${CUSTOMER_ID} internal_table=vendor_messages`;
    const admin = messageRpcAdminClient({
      data: null,
      error: { message: rawDatabaseMessage },
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await POST(mutationRequest("POST", {
      vendorId: VENDOR_ID,
      customerId: CUSTOMER_ID,
      content: "target",
    }));

    expect(response.status).toBe(expectedStatus);
    const body = await response.json();
    expect(body).toEqual({ error: expectedMessage });
    expect(JSON.stringify(body)).not.toContain(CUSTOMER_ID);
    expect(JSON.stringify(body)).not.toContain("vendor_messages");
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("fails closed on an unknown RPC error without returning its raw message", async () => {
    const admin = messageRpcAdminClient({
      data: null,
      error: { message: "database host and private diagnostic" },
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(mutationRequest("POST", {
      vendorId: VENDOR_ID,
      content: "hello",
    }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "메시지 전송에 실패했습니다." });
    expect(JSON.stringify(body)).not.toContain("private diagnostic");
    consoleError.mockRestore();
  });

  it("fails closed when the RPC returns a malformed row", async () => {
    const admin = messageRpcAdminClient({
      data: { id: "not-a-uuid", content: "partial" },
      error: null,
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue(admin.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(mutationRequest("POST", {
      vendorId: VENDOR_ID,
      content: "hello",
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "메시지 전송에 실패했습니다." });
    consoleError.mockRestore();
  });
});
