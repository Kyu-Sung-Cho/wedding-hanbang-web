import { describe, expect, it } from "vitest";

import { calculateJourneyProgressPercent, getJourneyProgressCounts } from "@hanbang/shared";

describe("calculateJourneyProgressPercent", () => {
  it("counts canonical checklist items instead of category metadata", () => {
    expect(calculateJourneyProgressPercent({
      venue: {
        category: "venue",
        status: "in_progress",
        checklist: [
          { id: "tour", done: true },
          { id: "contract", done: false },
        ],
        updated_at: "2026-07-13T00:00:00Z",
      },
    })).toBe(50);
  });

  it("excludes categories the couple marked as not applicable", () => {
    expect(calculateJourneyProgressPercent({
      venue: {
        status: "completed",
        checklist: [{ id: "contract", done: true }],
      },
      pyebaek: {
        status: "not_applicable",
        checklist: [{ id: "prepare", done: false }],
      },
    })).toBe(100);
  });

  it("does not treat untouched optional templates as required work", () => {
    const progress = {
      pyebaek: {
        status: "not_started",
        checklist: [
          { id: "decide", done: false },
          { id: "prepare", done: false },
        ],
      },
      venue: {
        status: "in_progress",
        checklist: [
          { id: "tour", done: true },
          { id: "contract", done: false },
        ],
      },
    };

    expect(getJourneyProgressCounts(progress)).toEqual({ done: 1, total: 2, categoryCount: 1 });
    expect(calculateJourneyProgressPercent(progress)).toBe(50);
  });

  it("counts an explicit category status even before a checklist is materialized", () => {
    expect(getJourneyProgressCounts({
      venue: { status: "completed" },
      studio: { status: "in_progress" },
    })).toEqual({ done: 1, total: 2, categoryCount: 2 });
  });
});
