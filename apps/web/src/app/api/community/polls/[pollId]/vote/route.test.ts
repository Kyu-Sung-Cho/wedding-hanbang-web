import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMMUNITY_POLL_OPTION_SERVER_SELECT,
  COMMUNITY_POLL_SERVER_SELECT,
} from "@/lib/community/pollVisibility";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(() => "community:poll:vote:test"),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { GET, POST } from "./route";

const POLL_ID = "10000000-0000-4000-8000-000000000001";
const POST_ID = "20000000-0000-4000-8000-000000000002";
const OPTION_ID = "30000000-0000-4000-8000-000000000003";
const VIEWER_ID = "40000000-0000-4000-8000-000000000004";

interface ServiceOptions {
  pollExists?: boolean;
  post?: {
    visibility: "public" | "members" | "draft";
    author_id: string;
    under_review: boolean;
  } | null;
  rpcResult?: { ok: boolean; error?: string; action?: string };
}

function service(userVoted: boolean, options: ServiceOptions = {}) {
  const pollMaybeSingle = vi.fn().mockResolvedValue({
    data: options.pollExists === false
      ? null
      : {
          id: POLL_ID,
          post_id: POST_ID,
          question: "투표 결과",
          allow_multiple: false,
          is_anonymous: true,
          hide_results_until_voted: true,
          closes_at: "2999-01-01T00:00:00.000Z",
          total_voters: 9,
          total_votes: 9,
          created_at: "2026-08-01T00:00:00.000Z",
        },
    error: null,
  });
  const pollEq = vi.fn(() => ({ maybeSingle: pollMaybeSingle }));
  const pollSelect = vi.fn(() => ({ eq: pollEq }));

  const optionOrder = vi.fn().mockResolvedValue({
    data: [{
      id: OPTION_ID,
      poll_id: POLL_ID,
      position: 0,
      label: "A",
      image_url: null,
      vote_count: 9,
    }],
    error: null,
  });
  const optionEq = vi.fn(() => ({ order: optionOrder }));
  const optionSelect = vi.fn(() => ({ eq: optionEq }));

  const voteEqUser = vi.fn().mockResolvedValue({
    data: userVoted ? [{ option_id: OPTION_ID }] : [],
    error: null,
  });
  const voteEqPoll = vi.fn(() => ({ eq: voteEqUser }));
  const voteSelect = vi.fn(() => ({ eq: voteEqPoll }));

  const postMaybeSingle = vi.fn().mockResolvedValue({
    data: options.post === undefined
      ? { visibility: "public", author_id: "author", under_review: false }
      : options.post,
    error: null,
  });
  const postEq = vi.fn(() => ({ maybeSingle: postMaybeSingle }));
  const postSelect = vi.fn(() => ({ eq: postEq }));

  const from = vi.fn((table: string) => {
    if (table === "community_polls") return { select: pollSelect };
    if (table === "community_poll_options") return { select: optionSelect };
    if (table === "community_poll_votes") return { select: voteSelect };
    if (table === "community_posts") return { select: postSelect };
    throw new Error(`unexpected table: ${table}`);
  });
  const rpc = vi.fn().mockResolvedValue({
    data: options.rpcResult ?? { ok: true, action: "switched" },
    error: null,
  });

  return { client: { from, rpc }, pollSelect, optionSelect, rpc };
}

function setViewer(userId: string | null) {
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  });
}

async function getPoll() {
  return GET(
    new NextRequest(`https://hanbang.ai/api/community/polls/${POLL_ID}/vote`),
    { params: Promise.resolve({ pollId: POLL_ID }) },
  );
}

async function postVote(optionId: string) {
  return POST(
    new NextRequest(`https://hanbang.ai/api/community/polls/${POLL_ID}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ option_id: optionId }),
    }),
    { params: Promise.resolve({ pollId: POLL_ID }) },
  );
}

describe("GET /api/community/polls/[pollId]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("redacts hidden counts from an anonymous viewer", async () => {
    setViewer(null);
    const mocked = service(false);
    mocks.createAdminClient.mockReturnValue(mocked.client);

    const response = await getPoll();
    const { poll } = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(mocked.pollSelect).toHaveBeenCalledWith(COMMUNITY_POLL_SERVER_SELECT);
    expect(mocked.optionSelect).toHaveBeenCalledWith(COMMUNITY_POLL_OPTION_SERVER_SELECT);
    expect(poll.total_voters).toBe(0);
    expect(poll.total_votes).toBe(0);
    expect(poll.options[0].vote_count).toBe(0);
  });

  it("rejects a malformed UUID before authentication or service-role access", async () => {
    const response = await GET(
      new NextRequest("https://hanbang.ai/api/community/polls/not-a-uuid/vote"),
      { params: Promise.resolve({ pollId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("releases counts to the authenticated viewer after their vote", async () => {
    setViewer(VIEWER_ID);
    const mocked = service(true);
    mocks.createAdminClient.mockReturnValue(mocked.client);

    const response = await getPoll();
    const { poll } = await response.json();

    expect(response.status).toBe(200);
    expect(poll.user_voted_option_ids).toEqual([OPTION_ID]);
    expect(poll.total_voters).toBe(9);
    expect(poll.total_votes).toBe(9);
    expect(poll.options[0].vote_count).toBe(9);
  });
});

describe("POST /api/community/polls/[pollId]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("rejects a malformed option UUID before service-role access", async () => {
    setViewer(VIEWER_ID);

    const response = await postVote("not-a-uuid");

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("uses the same 404 response for a missing poll and an inaccessible parent post", async () => {
    setViewer(VIEWER_ID);
    mocks.createAdminClient.mockReturnValueOnce(
      service(false, { pollExists: false }).client,
    );
    const missing = await postVote(OPTION_ID);
    const missingBody = await missing.json();

    mocks.createAdminClient.mockReturnValueOnce(
      service(false, {
        post: {
          visibility: "draft",
          author_id: "50000000-0000-4000-8000-000000000005",
          under_review: false,
        },
      }).client,
    );
    const inaccessible = await postVote(OPTION_ID);

    expect(missing.status).toBe(404);
    expect(inaccessible.status).toBe(404);
    expect(await inaccessible.json()).toEqual(missingBody);
  });

  it.each([
    ["poll_not_found", 404],
    ["forbidden", 403],
    ["poll_closed", 410],
    ["option_invalid", 400],
  ] as const)("keeps the %s RPC status mapping", async (error, status) => {
    setViewer(VIEWER_ID);
    const mocked = service(false, {
      rpcResult: { ok: false, error },
    });
    mocks.createAdminClient.mockReturnValue(mocked.client);

    const response = await postVote(OPTION_ID);

    expect(response.status).toBe(status);
    expect(mocked.rpc).toHaveBeenCalledWith("community_cast_poll_vote", {
      p_poll_id: POLL_ID,
      p_option_id: OPTION_ID,
      p_user_id: VIEWER_ID,
    });
  });
});
