import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  profile: {
    couple_id: "22222222-2222-4222-8222-222222222222",
  } as { couple_id: string | null } | null,
  rpc: vi.fn(),
  authError: null as { message: string } | null,
}));

function queryResult(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => ({ data, error }));
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mocks.user }, error: mocks.authError })),
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") return queryResult(mocks.profile);
      return queryResult(null);
    }),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

vi.mock("@/utils/rateLimit", () => ({
  rateLimitKey: vi.fn(() => "shared-action:test"),
  checkRateLimit: vi.fn(() => null),
}));

import { DELETE, GET, POST, PUT } from "../route";

const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const context = { params: Promise.resolve({ actionId: ACTION_ID }) };
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const boundBody = () => JSON.stringify({ messageId: MESSAGE_ID, expectedActorId: ACTOR_ID });

describe("Amora shared-action approval route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockReset();
    mocks.user = { id: "11111111-1111-4111-8111-111111111111" };
    mocks.profile = { couple_id: "22222222-2222-4222-8222-222222222222" };
    mocks.authError = null;
  });

  it("rejects a stale cookie-only confirmation without assigning it to the newly logged-in partner", async () => {
    mocks.user = { id: "55555555-5555-4555-8555-555555555555" };
    mocks.rpc.mockResolvedValueOnce({ data: { approvalMode: "couple", accepted: true, acceptedCount: 1,
      requiredCount: 2, partnerLinked: true, ready: false }, error: null });
    const response = await POST(new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
      method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ messageId: MESSAGE_ID }),
    }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_SHARED_ACTION_ACTOR_CHANGED", reason: "actor_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "DELETE"] as const)("requires the originating actor even for a verified legacy Bearer mutation: %s", async method => {
    const handler = { POST, PUT, DELETE }[method];
    mocks.rpc.mockResolvedValue({ data: { approvalMode: "couple", accepted: true, acceptedCount: 1,
      requiredCount: 2, partnerLinked: true, ready: false, applicationGranted: true, retryAfterMs: 0 }, error: null });
    const response = await handler(new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
      method,
      headers: { "content-type": "application/json", authorization: "Bearer synthetic-token" },
      body: JSON.stringify({ messageId: MESSAGE_ID }),
    }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_SHARED_ACTION_ACTOR_CHANGED", reason: "actor_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "DELETE"] as const)("rejects malformed or wrong actors before any %s RPC for cookies and Bearer", async method => {
    for (const authorization of [null, "Bearer synthetic-token"]) {
      for (const expectedActorId of [null, "", "bad", 17, {}, "55555555-5555-4555-8555-555555555555"]) {
        mocks.rpc.mockClear();
        const response = await { POST, PUT, DELETE }[method](new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
          method, headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...(authorization ? { authorization } : {}) },
          body: JSON.stringify({ messageId: MESSAGE_ID, expectedActorId }),
        }), context);
        expect(response.status).toBe(409);
        expect(mocks.rpc).not.toHaveBeenCalled();
      }
    }
  });

  it.each(["POST", "PUT", "DELETE"] as const)("accepts only a matching verified Bearer actor for %s", async method => {
    mocks.rpc.mockResolvedValue({ data: { approvalMode: "couple", accepted: true, acceptedCount: 1,
      requiredCount: 2, partnerLinked: true, ready: false, applicationGranted: true, retryAfterMs: 0 }, error: null });
    const response = await { POST, PUT, DELETE }[method](new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
      method, headers: { "content-type": "application/json", authorization: "Bearer synthetic-token" }, body: boundBody(),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ p_user_id: ACTOR_ID }));
  });

  it("does not attribute an A-screen request to the current same-couple B actor", async () => {
    mocks.user = { id: "55555555-5555-4555-8555-555555555555" };
    const response = await PUT(new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
      method: "PUT", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: boundBody(),
    }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ reason: "actor_changed" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects actor-bound stale status reads and only retains verified legacy Bearer reads", async () => {
    for (const authorization of [null, "Bearer synthetic-token"]) {
      for (const suffix of ["&expectedActorId=bad", "&expectedActorId=55555555-5555-4555-8555-555555555555",
        `&expectedActorId=${ACTOR_ID}&expectedActorId=${ACTOR_ID}`]) {
        const response = await GET(new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}?messageId=${MESSAGE_ID}${suffix}`,
          { headers: authorization ? { authorization } : {} }), context);
        expect(response.status).toBe(409);
        expect(mocks.rpc).not.toHaveBeenCalled();
      }
    }
    const url = `http://localhost/api/amora/shared-actions/${ACTION_ID}?messageId=${MESSAGE_ID}`;
    expect((await GET(new Request(url), context)).status).toBe(409);
    mocks.rpc.mockResolvedValue({ data: { approvalMode: "couple", accepted: false, acceptedCount: 0,
      requiredCount: 2, partnerLinked: true, ready: false }, error: null });
    expect((await GET(new Request(url, { headers: { authorization: "Bearer synthetic-token" } }), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not permit any Bearer compatibility when auth verification errors or returns an invalid actor", async () => {
    for (const invalidUser of [null, { id: "bad" }, { id: ACTOR_ID }]) {
      mocks.user = invalidUser;
      mocks.authError = invalidUser?.id === ACTOR_ID ? { message: "synthetic auth rejection" } : null;
      const headers = { authorization: "Bearer synthetic-token", "content-type": "application/json" };
      const url = `http://localhost/api/amora/shared-actions/${ACTION_ID}`;
      expect((await GET(new Request(`${url}?messageId=${MESSAGE_ID}`, { headers }), context)).status).toBe(401);
      expect((await PUT(new Request(url, { method: "PUT", headers, body: boundBody() }), context)).status).toBe(401);
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed explicit credentials instead of falling back to a valid cookie actor", async () => {
    const response = await PUT(new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
      method: "PUT", headers: { authorization: "Bearer", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: boundBody(),
    }), context);
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns the durable exact-proposal status without caching it", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        approvalMode: "couple",
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      },
      error: null,
    });

    const response = await GET(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}?messageId=${MESSAGE_ID}&expectedActorId=${ACTOR_ID}`),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      approvalMode: "couple",
      acceptedCount: 1,
      requiredCount: 2,
      ready: false,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("get_amora_shared_action_status", {
      p_action_id: ACTION_ID,
      p_couple_id: mocks.profile?.couple_id,
      p_source_message_id: MESSAGE_ID,
      p_user_id: mocks.user?.id,
    });
  });

  it("records one member's acceptance but never applies the mutation in this route", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        approvalMode: "couple",
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      },
      error: null,
    });

    const response = await POST(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: boundBody(),
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      acceptedCount: 1,
      requiredCount: 2,
      ready: false,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("accept_amora_shared_action", {
      p_action_id: ACTION_ID,
      p_couple_id: mocks.profile?.couple_id,
      p_source_message_id: MESSAGE_ID,
      p_user_id: mocks.user?.id,
    });
  });

  it("rejects unauthenticated, unlinked, malformed and over-posted requests", async () => {
    mocks.user = null;
    const unauthenticated = await GET(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}?messageId=${MESSAGE_ID}`),
      context,
    );
    expect(unauthenticated.status).toBe(401);

    mocks.user = { id: "11111111-1111-4111-8111-111111111111" };
    mocks.profile = { couple_id: null };
    const unlinked = await GET(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}?messageId=${MESSAGE_ID}`),
      context,
    );
    expect(unlinked.status).toBe(403);

    mocks.profile = { couple_id: "22222222-2222-4222-8222-222222222222" };
    const malformed = await GET(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}?messageId=wrong`),
      context,
    );
    expect(malformed.status).toBe(400);

    const overPosted = await POST(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ messageId: MESSAGE_ID, userId: mocks.user.id }),
      }),
      context,
    );
    expect(overPosted.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the proposal is stale, expired or no longer roster-bound", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "AMORA_SHARED_ACTION_PROPOSAL_CHANGED" },
    });

    const response = await POST(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: boundBody(),
      }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_SHARED_ACTION_PROPOSAL_CHANGED",
    });
  });

  it("rejects a cookie-authenticated cross-site acceptance before authentication or RPC", async () => {
    const response = await POST(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ messageId: MESSAGE_ID }),
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body even without a Content-Length header", async () => {
    const request = new Request(
      `http://localhost/api/amora/shared-actions/${ACTION_ID}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          messageId: MESSAGE_ID,
          padding: "x".repeat(3_000),
        }),
      },
    );
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request, context);

    expect(response.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("withdraws only the current member's still-pending confirmation", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        approvalMode: "couple",
        accepted: false,
        acceptedCount: 0,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      },
      error: null,
    });

    const response = await DELETE(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: boundBody(),
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      acceptedCount: 0,
      ready: false,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "revoke_amora_shared_action_acceptance",
      {
        p_action_id: ACTION_ID,
        p_couple_id: mocks.profile?.couple_id,
        p_source_message_id: MESSAGE_ID,
        p_user_id: mocks.user?.id,
      },
    );
  });

  it("grants only the database-selected application starter", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        applicationGranted: true,
        retryAfterMs: 0,
      },
      error: null,
    });

    const response = await PUT(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: boundBody(),
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applicationGranted: true,
      retryAfterMs: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_shared_action_application",
      {
        p_action_id: ACTION_ID,
        p_couple_id: mocks.profile?.couple_id,
        p_source_message_id: MESSAGE_ID,
        p_user_id: mocks.user?.id,
      },
    );
  });

  it("returns a bounded retry delay when another client owns the lease", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        applicationGranted: false,
        retryAfterMs: 42_000,
      },
      error: null,
    });

    const response = await PUT(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: boundBody(),
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applicationGranted: false,
      retryAfterMs: 42_000,
    });
  });

  it("does not rewrite consent history after the change was already applied", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "AMORA_SHARED_ACTION_ALREADY_APPLIED" },
    });

    const response = await DELETE(
      new Request(`http://localhost/api/amora/shared-actions/${ACTION_ID}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: boundBody(),
      }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_SHARED_ACTION_ALREADY_APPLIED",
    });
  });
});
