import { describe, expect, it, vi } from "vitest";
import { getCommunityPollActorProjection } from "@/lib/community/pollProjection";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const POLL_ID = "20000000-0000-4000-8000-000000000001";

function projection(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    id: POLL_ID,
    post_id: "30000000-0000-4000-8000-000000000001",
    version: 4,
    question: "어떤 선택이 더 중요한가요?",
    allow_multiple: false,
    is_anonymous: true,
    hide_results_until_voted: true,
    closes_at: null,
    total_voters: null,
    total_votes: null,
    created_at: "2026-08-04T00:00:00.000Z",
    results_hidden: true,
    user_voted_option_ids: [],
    options: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        poll_id: POLL_ID,
        position: 0,
        label: "예산",
        image_url: null,
        vote_count: null,
      },
    ],
    ...overrides,
  };
}

describe("community poll actor projection", () => {
  it("loads hidden counters only through the service projection RPC", async () => {
    const rpc = vi.fn(async () => ({ data: projection(), error: null }));

    const poll = await getCommunityPollActorProjection(
      { rpc } as never,
      ACTOR_ID,
      POLL_ID,
    );

    expect(rpc).toHaveBeenCalledWith("community_get_poll_actor_projection", {
      p_actor_id: ACTOR_ID,
      p_poll_id: POLL_ID,
    });
    expect(poll).toMatchObject({
      id: POLL_ID,
      results_hidden: true,
      total_voters: null,
      options: [{ vote_count: null }],
    });
  });

  it("returns null for the projection's stable not-found result", async () => {
    const rpc = vi.fn(async () => ({
      data: { ok: false, error: "not_found" },
      error: null,
    }));

    await expect(
      getCommunityPollActorProjection({ rpc } as never, null, POLL_ID),
    ).resolves.toBeNull();
  });

  it.each([
    ["RPC error", null, { message: "schema unavailable" }],
    ["malformed projection", { ok: true, id: POLL_ID }, null],
  ])("fails closed for a %s", async (_label, data, error) => {
    const rpc = vi.fn(async () => ({ data, error }));

    await expect(
      getCommunityPollActorProjection({ rpc } as never, ACTOR_ID, POLL_ID),
    ).rejects.toThrow("COMMUNITY_POLL_PROJECTION_UNAVAILABLE");
  });
});
