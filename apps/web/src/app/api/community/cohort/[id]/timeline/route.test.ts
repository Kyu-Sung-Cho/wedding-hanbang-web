// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:test-user`,
}));

import { GET, POST } from "./route";

const ROOM_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ id: ROOM_ID }) };

function memberQuery(active = true) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({
    data: active ? { id: "membership-1" } : null,
    error: null,
  }));
  return chain;
}

function requestClient(active = true) {
  const membership = memberQuery(active);
  return {
    membership,
    client: {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
      from: vi.fn((table: string) => {
        if (table === "cohort_members") return membership;
        throw new Error(`unexpected request-scoped table ${table}`);
      }),
    },
  };
}

function adminInsert() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({
    data: {
      id: "30000000-0000-4000-8000-000000000003",
      room_id: ROOM_ID,
      user_id: USER_ID,
      event_type: "progress_update",
      description: "준비 완료",
      metadata: null,
      created_at: "2026-08-02T00:00:00.000Z",
    },
    error: null,
  }));
  return chain;
}

function postRequest(body: unknown, origin = "https://hanbang.ai") {
  return new Request(`https://hanbang.ai/api/community/cohort/${ROOM_ID}/timeline`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": origin === "https://hanbang.ai" ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
}

describe("cohort timeline security boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("rejects cross-site mutations before authentication or database access", async () => {
    const response = await POST(
      postRequest({ event_type: "progress_update" }, "https://attacker.example"),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unknown event types before the service-role insert", async () => {
    const scoped = requestClient();
    mocks.createClientFromRequest.mockResolvedValue(scoped.client);

    const response = await POST(postRequest({ event_type: "admin_override" }), context);

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("checks active membership, then performs a bounded service-role insert", async () => {
    const scoped = requestClient();
    const insert = adminInsert();
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      expect(name).toBe("community_create_cohort_timeline_event_for_actor");
      expect(args).toEqual({
        p_actor_id: USER_ID,
        p_room_id: ROOM_ID,
        p_event_type: "progress_update",
        p_description: expect.any(String),
      });
      return insert;
    });
    mocks.createClientFromRequest.mockResolvedValue(scoped.client);
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(postRequest({
      event_type: "progress_update",
      description: `  준비 완료\0${"x".repeat(600)}  `,
    }), context);

    expect(response.status).toBe(201);
    const inserted = rpc.mock.calls[0]?.[1] as { p_description: string };
    expect(inserted.p_description).toHaveLength(500);
    expect(inserted.p_description.startsWith("준비 완료")).toBe(true);
    expect(inserted.p_description).not.toContain("\0");
    expect(insert.select).toHaveBeenCalledWith(
      "id, room_id, user_id, event_type, description, metadata, created_at",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect((scoped.membership.maybeSingle as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createAdminClient.mock.invocationCallOrder[0]);
  });

  it("rate-limits list requests before the membership and timeline queries", async () => {
    const scoped = requestClient();
    mocks.createClientFromRequest.mockResolvedValue(scoped.client);
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );

    const response = await GET(
      new Request(`https://hanbang.ai/api/community/cohort/${ROOM_ID}/timeline`) as Parameters<typeof GET>[0],
      context,
    );

    expect(response.status).toBe(429);
    expect(scoped.membership.maybeSingle).not.toHaveBeenCalled();
  });
});
