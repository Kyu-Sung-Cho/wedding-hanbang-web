import { describe, expect, it } from "vitest";
import { resolveAmoraWeddingContext } from "@/lib/ai/amoraWeddingContext";

describe("resolveAmoraWeddingContext", () => {
  it("uses only the canonical journey for an authenticated user", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: {
        wedding_date: "2027-05-03",
        total_budget: 40_000_000,
        venue: "DB 웨딩홀",
        progress: {},
      },
      clientContext: {
        weddingDate: "2030-01-01",
        budget: 1,
        venue: "CLIENT INJECTION",
        progress: { __events: "not-an-array" },
      },
      allowClientContext: false,
    });

    expect(result).toMatchObject({
      weddingDate: "2027-05-03",
      budget: 40_000_000,
      venue: "DB 웨딩홀",
      scheduleEvents: [],
    });
    expect(JSON.stringify(result)).not.toContain("CLIENT INJECTION");
  });

  it("does not fall back to client state when the canonical journey is absent", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: null,
      clientContext: {
        weddingDate: "2030-01-01",
        budget: 999_999_999,
        venue: "UNTRUSTED VENUE",
        progress: { studio: { status: "completed" } },
      },
      allowClientContext: false,
    });

    expect(result).toEqual({
      weddingDate: null,
      budget: 0,
      venue: null,
      progress: {},
      scheduleEvents: [],
      preferences: null,
    });
  });

  it("accepts a bounded demo context and drops malformed events and preferences", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: null,
      allowClientContext: true,
      clientContext: {
        weddingDate: "2027-02-29",
        budget: Number.POSITIVE_INFINITY,
        venue: `  ${"홀".repeat(250)}  `,
        progress: {
          __events: [
            { date: "2027-05-03", title: "드레스 피팅", memo: "준비", categoryKey: "dress" },
            { date: "not-a-date", title: "DROP" },
            { date: "2027-06-01", title: 123 },
          ],
          __preferences: {
            weddingStyle: "minimal",
            priorities: ["venue", 123, "dress"],
            budgetTendency: "balanced",
            guestCount: "100to200",
          },
          constructor: { polluted: true },
        },
      },
    });

    expect(result.weddingDate).toBeNull();
    expect(result.budget).toBe(0);
    expect(result.venue).toHaveLength(200);
    expect(result.scheduleEvents).toEqual([
      { date: "2027-05-03", title: "드레스 피팅", memo: "준비", categoryKey: "dress" },
    ]);
    expect(result.preferences).toEqual({
      weddingStyle: "minimal",
      priorities: ["venue", "dress"],
      budgetAttitude: "balanced",
      guestCount: "100to200",
    });
    expect(Object.prototype.hasOwnProperty.call(result.progress, "constructor")).toBe(false);
  });

  it("bounds nested progress values before they reach prompts or tools", () => {
    const progress = Object.fromEntries(
      Array.from({ length: 130 }, (_, index) => [
        `category_${index}`,
        { status: "completed", memo: "x".repeat(2_000) },
      ]),
    );
    const result = resolveAmoraWeddingContext({
      canonicalJourney: { progress },
      clientContext: null,
      allowClientContext: false,
    });

    expect(Object.keys(result.progress)).toHaveLength(100);
    expect((result.progress.category_0 as { memo: string }).memo).toHaveLength(1_000);
  });
});
