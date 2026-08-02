import { describe, expect, it } from "vitest";

import {
  areCommunityPollResultsVisible,
  protectCommunityPollResults,
} from "../pollVisibility";
import type { PollWithOptions } from "@/types/community.types";

const NOW = new Date("2026-08-02T00:00:00.000Z");

function poll(overrides: Partial<PollWithOptions> = {}): PollWithOptions {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    post_id: "20000000-0000-4000-8000-000000000002",
    question: "어느 쪽이 좋나요?",
    allow_multiple: false,
    is_anonymous: true,
    hide_results_until_voted: true,
    closes_at: "2026-08-03T00:00:00.000Z",
    total_voters: 7,
    total_votes: 7,
    created_at: "2026-08-01T00:00:00.000Z",
    options: [
      {
        id: "30000000-0000-4000-8000-000000000003",
        poll_id: "10000000-0000-4000-8000-000000000001",
        position: 0,
        label: "A",
        image_url: null,
        vote_count: 7,
      },
    ],
    user_voted_option_ids: [],
    ...overrides,
  };
}

describe("community poll result visibility", () => {
  it("redacts totals and option counts for anonymous and non-voting authenticated viewers", () => {
    const hidden = protectCommunityPollResults(poll(), NOW);

    expect(hidden.total_voters).toBe(0);
    expect(hidden.total_votes).toBe(0);
    expect(hidden.options[0].vote_count).toBe(0);
    expect(hidden.question).toBe("어느 쪽이 좋나요?");
  });

  it("shows results to a viewer only after that viewer has voted", () => {
    const voted = poll({
      user_voted_option_ids: ["30000000-0000-4000-8000-000000000003"],
    });

    expect(protectCommunityPollResults(voted, NOW)).toBe(voted);
  });

  it("shows results when hiding is disabled or the poll is closed", () => {
    expect(areCommunityPollResultsVisible(
      poll({ hide_results_until_voted: false }),
      false,
      NOW,
    )).toBe(true);
    expect(areCommunityPollResultsVisible(
      poll({ closes_at: "2026-08-01T00:00:00.000Z" }),
      false,
      NOW,
    )).toBe(true);
  });

  it("fails closed for an invalid close timestamp", () => {
    expect(areCommunityPollResultsVisible(
      poll({ closes_at: "invalid" }),
      false,
      NOW,
    )).toBe(false);
  });
});
