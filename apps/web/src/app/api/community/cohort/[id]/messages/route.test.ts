import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const ROOM_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true as const })),
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: vi.fn(() => "cohort-message-key"),
}));

import { POST } from "./route";

function authenticatedClient() {
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: { id: "membership-1" } })),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);

  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: { user_id: USER_ID, nickname: "couple", avatar_url: null, rank: "sprout" },
    })),
  };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from: vi.fn((table: string) =>
      table === "cohort_members" ? membershipQuery : profileQuery,
    ),
  };
}

function request(
  body: BodyInit,
  idempotencyKey: string | null = REQUEST_ID,
) {
  const headers = new Headers({
    origin: "https://hanbang.ai",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
  });
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new NextRequest(`https://hanbang.ai/api/community/cohort/${ROOM_ID}/messages`, {
    method: "POST",
    headers,
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  } as ConstructorParameters<typeof NextRequest>[1] & { duplex?: "half" });
}

function rpcResult(replayed = false) {
  return {
    id: MESSAGE_ID,
    room_id: ROOM_ID,
    author_id: USER_ID,
    client_request_id: REQUEST_ID,
    content: "retry-safe message",
    thread_topic: "chat",
    reply_to: null,
    created_at: "2026-08-02T10:00:00.000Z",
    replayed,
  };
}

describe("POST /api/community/cohort/[id]/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({ data: rpcResult(false), error: null })),
    });
  });

  it("binds one client request UUID to the atomic message RPC", async () => {
    const service = mocks.createAdminClient();
    mocks.createAdminClient.mockReturnValue(service);

    const response = await POST(request(JSON.stringify({
      content: "retry-safe message",
      thread_topic: "chat",
    })), { params: Promise.resolve({ id: ROOM_ID }) });

    expect(response.status).toBe(201);
    expect(service.rpc).toHaveBeenCalledWith("community_create_cohort_message", {
      p_user_id: USER_ID,
      p_room_id: ROOM_ID,
      p_client_request_id: REQUEST_ID,
      p_content: "retry-safe message",
      p_thread_topic: "chat",
      p_reply_to: null,
    });
    await expect(response.json()).resolves.toMatchObject({
      message: { id: MESSAGE_ID, author_id: USER_ID },
      replayed: false,
    });
  });

  it("returns an idempotent replay as success without claiming a second create", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({ data: rpcResult(true), error: null })),
    });

    const response = await POST(request(JSON.stringify({
      content: "retry-safe message",
      thread_topic: "chat",
    })), { params: Promise.resolve({ id: ROOM_ID }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ replayed: true });
  });

  it("requires a valid key before auth or database work", async () => {
    const response = await POST(
      request(JSON.stringify({ content: "retry-safe message" }), null),
      { params: Promise.resolve({ id: ROOM_ID }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("enforces the body limit without trusting content-length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(8 * 1024 + 1)));
        controller.close();
      },
    });
    const oversized = request(stream);
    expect(oversized.headers.get("content-length")).toBeNull();

    const response = await POST(oversized, {
      params: Promise.resolve({ id: ROOM_ID }),
    });

    expect(response.status).toBe(413);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("maps request-key payload drift to a recoverable conflict", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "22023", message: "private provider detail" },
      })),
    });

    const response = await POST(request(JSON.stringify({
      content: "retry-safe message",
      thread_topic: "chat",
    })), { params: Promise.resolve({ id: ROOM_ID }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(JSON.stringify(body)).not.toContain("private provider detail");
  });
});
