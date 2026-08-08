// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PollWithOptions } from "@/types/community.types";

const mocks = vi.hoisted(() => ({
  submitPollVoteIntent: vi.fn(),
}));

vi.mock("@/lib/community/pollVoteIntent", () => ({
  submitPollVoteIntent: mocks.submitPollVoteIntent,
}));

import PollDisplay from "./PollDisplay";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const OPTION_ID = "40000000-0000-4000-8000-000000000001";
const basePoll: PollWithOptions = {
  id: "30000000-0000-4000-8000-000000000001",
  post_id: "20000000-0000-4000-8000-000000000001",
  version: 7,
  question: "가장 중요한 기준은?",
  allow_multiple: false,
  is_anonymous: true,
  hide_results_until_voted: false,
  closes_at: null,
  total_voters: 0,
  total_votes: 0,
  created_at: "2026-08-04T00:00:00.000Z",
  options: [
    {
      id: OPTION_ID,
      poll_id: "30000000-0000-4000-8000-000000000001",
      position: 0,
      label: "예산",
      image_url: null,
      vote_count: 0,
    },
  ],
  user_voted_option_ids: [],
};

describe("PollDisplay set-intent integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderAndClick(poll: PollWithOptions) {
    mocks.submitPollVoteIntent.mockResolvedValue(
      new Response(JSON.stringify({ poll }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await act(async () => {
      root.render(
        <PollDisplay
          poll={poll}
          isAuthenticated
          onLoginRequired={vi.fn()}
        />,
      );
    });
    const optionButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("예산"),
    );
    expect(optionButton).toBeDefined();
    await act(async () => optionButton!.click());
  }

  it("sends selected=true with the rendered poll version for a new choice", async () => {
    await renderAndClick(basePoll);

    expect(mocks.submitPollVoteIntent).toHaveBeenCalledWith({
      pollId: basePoll.id,
      optionId: OPTION_ID,
      selected: true,
      pollVersion: 7,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });
  });

  it("sends selected=false instead of toggling a previously selected option on the server", async () => {
    await renderAndClick({
      ...basePoll,
      total_voters: 1,
      total_votes: 1,
      options: [{ ...basePoll.options[0]!, vote_count: 1 }],
      user_voted_option_ids: [OPTION_ID],
    });

    expect(mocks.submitPollVoteIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        optionId: OPTION_ID,
        selected: false,
        pollVersion: 7,
      }),
    );
  });

  it("keeps server-hidden counts private instead of rendering them as zero", async () => {
    const hiddenPoll: PollWithOptions = {
      ...basePoll,
      hide_results_until_voted: true,
      results_hidden: true,
      total_voters: null,
      total_votes: null,
      options: [{ ...basePoll.options[0]!, vote_count: null }],
    };

    await act(async () => {
      root.render(
        <PollDisplay
          poll={hiddenPoll}
          isAuthenticated
          onLoginRequired={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("참여 후 인원 공개");
    expect(container.textContent).toContain("투표하면 결과가 공개돼요");
    expect(container.textContent).not.toContain("0표");
    expect(container.textContent).not.toContain("0%");
  });
});
