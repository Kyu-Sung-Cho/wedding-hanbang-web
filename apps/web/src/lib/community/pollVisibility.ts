import type { PollWithOptions } from "@/types/community.types";

/**
 * These projections include counters and are safe only on the trusted server.
 * Every public response must pass through the redaction helpers below.
 */
export const COMMUNITY_POLL_SERVER_SELECT =
  "id, post_id, question, allow_multiple, is_anonymous, hide_results_until_voted, closes_at, total_voters, total_votes, created_at" as const;

export const COMMUNITY_POLL_OPTION_SERVER_SELECT =
  "id, poll_id, position, label, image_url, vote_count" as const;

type PollVisibilityRow = {
  hide_results_until_voted: boolean;
  closes_at: string | null;
};

export function areCommunityPollResultsVisible(
  poll: PollVisibilityRow,
  hasVoted: boolean,
  now = new Date(),
): boolean {
  if (!poll.hide_results_until_voted || hasVoted) return true;
  if (!poll.closes_at) return false;

  const closesAt = Date.parse(poll.closes_at);
  return Number.isFinite(closesAt) && closesAt <= now.getTime();
}

export function protectCommunityPollResults(
  poll: PollWithOptions,
  now = new Date(),
): PollWithOptions {
  const canSeeResults = areCommunityPollResultsVisible(
    poll,
    poll.user_voted_option_ids.length > 0,
    now,
  );
  if (canSeeResults) return poll;

  return {
    ...poll,
    total_voters: 0,
    total_votes: 0,
    options: poll.options.map((option) => ({
      ...option,
      vote_count: 0,
    })),
  };
}
