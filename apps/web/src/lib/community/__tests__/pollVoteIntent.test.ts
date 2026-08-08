import { describe, expect, it, vi } from "vitest";
import { submitPollVoteIntent } from "@/lib/community/pollVoteIntent";

const INTENT = {
  pollId: "30000000-0000-4000-8000-000000000001",
  optionId: "40000000-0000-4000-8000-000000000001",
  selected: false,
  pollVersion: 7,
  idempotencyKey: "60000000-0000-4000-8000-000000000001",
} as const;

describe("submitPollVoteIntent", () => {
  it("reuses the exact idempotency key and set-intent body after a transport failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network disconnected"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const response = await submitPollVoteIntent(INTENT, { fetcher });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const calls = fetcher.mock.calls.map(([url, init]) => ({
      url,
      headers: new Headers(init?.headers),
      body: init?.body,
    }));
    expect(calls).toEqual([
      {
        url: `/api/community/polls/${INTENT.pollId}/vote`,
        headers: expect.any(Headers),
        body: JSON.stringify({
          option_id: INTENT.optionId,
          selected: false,
          poll_version: 7,
        }),
      },
      {
        url: `/api/community/polls/${INTENT.pollId}/vote`,
        headers: expect.any(Headers),
        body: JSON.stringify({
          option_id: INTENT.optionId,
          selected: false,
          poll_version: 7,
        }),
      },
    ]);
    for (const call of calls) {
      expect(call.headers.get("idempotency-key")).toBe(INTENT.idempotencyKey);
      expect(call.headers.get("content-type")).toBe("application/json");
    }
  });

  it("does not retry a stale-definition response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: "COMMUNITY_POLL_STALE" }), {
        status: 409,
      }),
    );

    const response = await submitPollVoteIntent(INTENT, { fetcher });

    expect(response.status).toBe(409);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
