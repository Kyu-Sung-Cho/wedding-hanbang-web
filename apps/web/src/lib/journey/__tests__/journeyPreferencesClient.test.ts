import { describe, expect, it, vi } from "vitest";
import { patchJourneyPreferences } from "../journeyPreferencesClient";

describe("patchJourneyPreferences", () => {
  it("sends a narrow preference patch and returns authoritative progress", async () => {
    const progress = {
      venue: { category: "venue", status: "not_started" },
      __preferences: { weddingStyle: "minimal", priorities: ["venue"] },
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress,
      preferences: progress.__preferences,
    }), { status: 200 }));

    await expect(patchJourneyPreferences({ priorities: ["venue"] }, fetcher)).resolves.toEqual({
      progress,
      preferences: progress.__preferences,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/journey/preferences", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ priorities: ["venue"] }),
    }));
  });

  it.each([
    null,
    {},
    { progress: {}, preferences: { weddingStyle: "minimal" } },
    { progress: { __preferences: { weddingStyle: "classic" } }, preferences: { weddingStyle: "minimal" } },
  ])("fails closed for malformed or unconfirmed success: %o", async (body) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(patchJourneyPreferences({ weddingStyle: "minimal" }, fetcher)).rejects.toThrow("확인");
  });
});
