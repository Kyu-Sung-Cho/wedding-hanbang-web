import { describe, expect, it, vi } from "vitest";

import { publishQuoteForSharing } from "./quotePublication";

const QUOTE_ID = "10000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("publishQuoteForSharing", () => {
  it("publishes the owner quote and returns only the validated server path", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      id: QUOTE_ID,
      published: true,
      publicPath: `/quote/${QUOTE_ID}`,
    }));

    await expect(publishQuoteForSharing(QUOTE_ID, fetcher)).resolves.toBe(
      `/quote/${QUOTE_ID}`,
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/amora/quote-check/${QUOTE_ID}/publish`,
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("rejects an invalid id before sending a request", async () => {
    const fetcher = vi.fn();

    await expect(publishQuoteForSharing("not-a-uuid", fetcher)).rejects.toThrow(
      "QUOTE_PUBLICATION_FAILED",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["non-success response", jsonResponse({ error: "no" }, 503)],
    ["different quote id", jsonResponse({
      id: "20000000-0000-4000-8000-000000000002",
      published: true,
      publicPath: `/quote/${QUOTE_ID}`,
    })],
    ["external path", jsonResponse({
      id: QUOTE_ID,
      published: true,
      publicPath: "https://attacker.example/quote",
    })],
    ["unpublished response", jsonResponse({
      id: QUOTE_ID,
      published: false,
      publicPath: null,
    })],
  ])("fails closed for a %s", async (_label, response) => {
    const fetcher = vi.fn().mockResolvedValue(response);

    await expect(publishQuoteForSharing(QUOTE_ID, fetcher)).rejects.toThrow(
      "QUOTE_PUBLICATION_FAILED",
    );
  });
});
