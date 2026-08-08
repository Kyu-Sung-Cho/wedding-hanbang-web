// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  canReadCommunityPost: vi.fn(() => true),
  checkCommunityWriteAccess: vi.fn(async (): Promise<
    | { allowed: true }
    | {
        allowed: false;
        status: number;
        code: string;
        message: string;
      }
  > => ({ allowed: true })),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "poll-rate-key"),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/community/publicPostRules", () => ({
  canReadCommunityPost: mocks.canReadCommunityPost,
}));
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET, POST } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const AUTHOR_ID = "10000000-0000-4000-8000-000000000002";
const POST_ID = "20000000-0000-4000-8000-000000000001";
const POLL_ID = "30000000-0000-4000-8000-000000000001";
const OPTION_ID = "40000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "50000000-0000-4000-8000-000000000001";

function request(
  body: unknown,
  options: { idempotencyKey?: string | null; trusted?: boolean } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.trusted !== false) {
    headers.set("origin", "http://localhost");
    headers.set("sec-fetch-site", "same-origin");
  } else {
    headers.set("origin", "https://attacker.example");
    headers.set("sec-fetch-site", "cross-site");
  }
  const idempotencyKey = options.idempotencyKey === undefined
    ? IDEMPOTENCY_KEY
    : options.idempotencyKey;
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(`http://localhost/api/community/polls/${POLL_ID}/vote`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function result<T>(data: T, error: unknown = null) {
  return { data, error };
}

function harness(options: {
  user?: { id: string } | null;
  replayData?: unknown;
  replayError?: { message: string } | null;
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  blocked?: boolean;
  blockError?: { message: string } | null;
  underReview?: boolean;
} = {}) {
  const user = options.user === undefined ? { id: USER_ID } : options.user;
  const poll = {
    ok: true,
    id: POLL_ID,
    post_id: POST_ID,
    version: 4,
    question: "가장 중요한 기준은?",
    allow_multiple: false,
    is_anonymous: true,
    hide_results_until_voted: false,
    closes_at: null,
    total_voters: 3,
    total_votes: 3,
    created_at: "2026-08-04T00:00:00.000Z",
    results_hidden: false,
    user_voted_option_ids: [],
    options: [] as Array<Record<string, unknown>>,
  };
  const option = {
    id: OPTION_ID,
    poll_id: POLL_ID,
    position: 0,
    label: "예산",
    image_url: null,
    vote_count: 3,
  };
  poll.options = [option];
  const serviceRpc = vi.fn(async (name: string) => {
    if (name === "community_viewer_can_see") {
      return result(!(options.blocked ?? false), options.blockError ?? null);
    }
    if (name === "community_get_poll_actor_projection") {
      return result(poll);
    }
    if (name === "community_replay_poll_vote_command_service") {
      return result(options.replayData ?? null, options.replayError ?? null);
    }
    if (name === "community_set_poll_vote") {
      return result(
        options.rpcData ?? {
          ok: true,
          action: "selected",
          poll,
        },
        options.rpcError ?? null,
      );
    }
    throw new Error(`Unexpected service RPC: ${name}`);
  });
  const viewerRpc = vi.fn((name: string) => {
    throw new Error(`Unexpected viewer RPC: ${name}`);
  });
  const from = vi.fn((table: string) => {
    throw new Error(`Poll reads must not use the service table boundary: ${table}`);
  });
  const authenticatedClient = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(async () => result(
          table === "community_polls"
            ? { post_id: POST_ID }
            : table === "community_posts"
              ? {
                  id: POST_ID,
                  author_id: AUTHOR_ID,
                  visibility: "public",
                  under_review: options.underReview ?? false,
                }
              : null,
        )),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      if (table !== "community_polls" && table !== "community_posts") {
        throw new Error(`Unexpected viewer table: ${table}`);
      }
      return query;
    }),
    rpc: viewerRpc,
  };
  const serviceClient = { from, rpc: serviceRpc };
  mocks.createClientFromRequest.mockResolvedValue(authenticatedClient);
  mocks.createAdminClient.mockReturnValue(serviceClient);
  return { authenticatedClient, from, poll, serviceRpc, viewerRpc };
}

describe("community poll vote route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canReadCommunityPost.mockReturnValue(true);
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("returns a private stable 404 before exposing a blocked author's poll", async () => {
    const { from, serviceRpc, viewerRpc } = harness({ blocked: true });

    const response = await GET(
      new Request(`http://localhost/api/community/polls/${POLL_ID}/vote`) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.poll).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
    expect(viewerRpc).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledWith("community_viewer_can_see", {
      p_viewer_user_id: USER_ID,
      p_other_user_id: AUTHOR_ID,
    });
    expect(serviceRpc).not.toHaveBeenCalledWith(
      "community_get_poll_actor_projection",
      expect.anything(),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("withholds an under-review parent before loading poll options", async () => {
    const { from, serviceRpc, viewerRpc } = harness({ underReview: true });

    const response = await GET(
      new Request(`http://localhost/api/community/polls/${POLL_ID}/vote`) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(viewerRpc).not.toHaveBeenCalled();
    expect(serviceRpc).not.toHaveBeenCalledWith(
      "community_get_poll_actor_projection",
      expect.anything(),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("returns an allowed signed-in poll only after the final viewer-scoped read", async () => {
    const { authenticatedClient, from, serviceRpc } = harness({ blocked: false });

    const response = await GET(
      new Request(`http://localhost/api/community/polls/${POLL_ID}/vote`) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.poll).toMatchObject({ id: POLL_ID, post_id: POST_ID });
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(authenticatedClient.from).toHaveBeenCalledWith("community_posts");
    expect(serviceRpc).toHaveBeenCalledWith(
      "community_get_poll_actor_projection",
      { p_actor_id: USER_ID, p_poll_id: POLL_ID },
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("passes an explicit selected=true intent, version, actor, and stable key to the service RPC", async () => {
    const { authenticatedClient, serviceRpc } = harness();

    const response = await POST(
      request({ option_id: OPTION_ID, selected: true, poll_version: 4 }) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      "poll-rate-key",
      { maxRequests: 30, windowMs: 60_000 },
    );
    expect(mocks.checkCommunityWriteAccess).toHaveBeenCalledWith(
      authenticatedClient,
      USER_ID,
    );
    expect(serviceRpc).toHaveBeenCalledWith("community_set_poll_vote", {
      p_user_id: USER_ID,
      p_poll_id: POLL_ID,
      p_option_id: OPTION_ID,
      p_selected: true,
      p_expected_poll_version: 4,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      poll: { id: POLL_ID, version: 4 },
      action: "selected",
    });
    expect(responseBody).not.toHaveProperty("replayed");
  });

  it("allows an explicit selected=false intent without the positive-write access gate", async () => {
    const { poll, serviceRpc } = harness({
      rpcData: null,
    });
    serviceRpc.mockImplementation(async (name: string) => {
      if (name === "community_replay_poll_vote_command_service") return result(null);
      if (name === "community_set_poll_vote") {
        return result({ ok: true, action: "unchanged", poll });
      }
      if (name === "community_viewer_can_see") return result(true);
      throw new Error(`Unexpected service RPC: ${name}`);
    });

    const response = await POST(
      request({ option_id: OPTION_ID, selected: false, poll_version: 4 }) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledWith(
      "community_set_poll_vote",
      expect.objectContaining({ p_selected: false }),
    );
    await expect(response.json()).resolves.toEqual({
      poll,
      action: "unchanged",
    });
  });

  it("returns an exact stored receipt before rate, visibility, block, and write gates", async () => {
    const { authenticatedClient, serviceRpc } = harness({
      replayData: {},
      underReview: true,
      blocked: true,
    });
    const frozenPoll = {
      id: POLL_ID,
      post_id: POST_ID,
      version: 4,
      total_votes: 3,
      total_voters: 3,
      options: [],
    };
    serviceRpc.mockImplementation(async (name: string) => {
      if (name === "community_replay_poll_vote_command_service") {
        return result({ ok: true, action: "selected", poll: frozenPoll });
      }
      throw new Error(`Replay must terminate before ${name}`);
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }) as never,
    );
    mocks.checkCommunityWriteAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      code: "COMMUNITY_SUSPENDED",
      message: "suspended",
    });

    const response = await POST(
      request({ option_id: OPTION_ID, selected: true, poll_version: 4 }) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      poll: frozenPoll,
      action: "selected",
    });
    expect(authenticatedClient.from).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledTimes(1);
    expect(serviceRpc).toHaveBeenCalledWith(
      "community_replay_poll_vote_command_service",
      {
        p_actor_id: USER_ID,
        p_poll_id: POLL_ID,
        p_option_id: OPTION_ID,
        p_selected: true,
        p_expected_poll_version: 4,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    );
  });

  it("fails closed on a corrupt stored receipt before mutable gates", async () => {
    const { authenticatedClient, serviceRpc } = harness({
      replayData: { ok: true, action: "selected" },
    });

    const response = await POST(
      request({ option_id: OPTION_ID, selected: true, poll_version: 4 }) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_POLL_RECEIPT_UNAVAILABLE",
    });
    expect(authenticatedClient.from).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(serviceRpc).not.toHaveBeenCalledWith(
      "community_set_poll_vote",
      expect.anything(),
    );
  });

  it.each([
    [
      "missing idempotency key",
      { option_id: OPTION_ID, selected: true, poll_version: 4 },
      null,
    ],
    [
      "missing selected boolean",
      { option_id: OPTION_ID, poll_version: 4 },
      IDEMPOTENCY_KEY,
    ],
    [
      "missing poll version",
      { option_id: OPTION_ID, selected: true },
      IDEMPOTENCY_KEY,
    ],
    [
      "invalid option id",
      { option_id: "not-a-uuid", selected: true, poll_version: 4 },
      IDEMPOTENCY_KEY,
    ],
  ])("rejects a %s before reaching the RPC", async (_label, body, idempotencyKey) => {
    const { serviceRpc } = harness();

    const response = await POST(
      request(body, { idempotencyKey }) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );

    expect(response.status).toBe(400);
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("maps a stale poll receipt to a retriable-by-refresh 409", async () => {
    harness({
      rpcData: {
        ok: false,
        error: "poll_stale",
        current_version: 5,
      },
    });

    const response = await POST(
      request({ option_id: OPTION_ID, selected: true, poll_version: 4 }) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_POLL_STALE",
      current_version: 5,
    });
  });

  it("maps idempotency payload reuse to 409 instead of hiding it as a 500", async () => {
    harness({
      rpcData: null,
      rpcError: { message: "poll vote idempotency key reused with different payload" },
    });

    const response = await POST(
      request({ option_id: OPTION_ID, selected: true, poll_version: 4 }) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_POLL_IDEMPOTENCY_CONFLICT",
    });
  });

  it("keeps trusted-request and authentication fences ahead of mutation work", async () => {
    const { serviceRpc } = harness({ user: null });
    const unauthenticated = await POST(
      request({ option_id: OPTION_ID, selected: true, poll_version: 4 }) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );
    expect(unauthenticated.status).toBe(401);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(serviceRpc).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const crossSite = await POST(
      request(
        { option_id: OPTION_ID, selected: true, poll_version: 4 },
        { trusted: false },
      ) as never,
      { params: Promise.resolve({ pollId: POLL_ID }) },
    );
    expect(crossSite.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });
});
