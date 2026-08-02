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

  it("does not send a legacy booking id from schedule memos into the model context", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: {
        progress: {
          __events: [{
            date: "2027-05-03",
            title: "드레스 피팅",
            memo: "예약 자동 등록 · booking 018f4dc8 · 15,000원",
          }],
        },
      },
      clientContext: null,
      allowClientContext: false,
    });

    expect(result.scheduleEvents[0]?.memo).toBe("예약 자동 등록 · 15,000원");
    expect(JSON.stringify(result.scheduleEvents)).not.toContain("018f4dc8");
  });

  it("does not expose cancelled schedules to the model as active wedding context", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: {
        progress: {
          __events: [
            {
              id: "018f4dc8-3f4b-7d29-a271-0e27a7ea4cb7",
              date: "2027-05-03",
              title: "취소한 드레스 피팅",
              status: "cancelled",
              cancellation: {
                cancelledAt: "2026-08-02T03:00:00.000Z",
                cancelledByProfileId: "018f4dc8-3f4b-7d29-a271-0e27a7ea4cb8",
              },
            },
            {
              id: "018f4dc8-3f4b-7d29-a271-0e27a7ea4cb9",
              date: "2027-05-10",
              title: "진행할 드레스 피팅",
              status: "planned",
            },
          ],
        },
      },
      clientContext: null,
      allowClientContext: false,
    });

    expect(result.scheduleEvents).toEqual([
      { date: "2027-05-10", title: "진행할 드레스 피팅" },
    ]);
    expect(JSON.stringify(result.scheduleEvents)).not.toContain("취소한 드레스 피팅");
  });

  it("uses the same 10억원 product ceiling as every wedding budget write path", () => {
    expect(resolveAmoraWeddingContext({
      canonicalJourney: { total_budget: 1_000_000_000, progress: {} },
      clientContext: null,
      allowClientContext: false,
    }).budget).toBe(1_000_000_000);

    expect(resolveAmoraWeddingContext({
      canonicalJourney: { total_budget: 1_000_000_001, progress: {} },
      clientContext: null,
      allowClientContext: false,
    }).budget).toBe(0);
  });
});
