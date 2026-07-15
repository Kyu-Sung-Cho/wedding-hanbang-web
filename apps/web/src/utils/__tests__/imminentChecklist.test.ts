import { describe, expect, it } from "vitest";
import {
  getCompletedImminentCategories,
  getImminentCategories,
} from "../imminentChecklist";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";

describe("getImminentCategories", () => {
  it("does not turn untouched checklist templates into imminent work", () => {
    expect(getImminentCategories({})).toEqual([]);
  });

  it("returns only an explicitly started category without a saved schedule", () => {
    const progress: Record<string, ProgressItem> = {
      venue: { status: "in_progress" },
      studio: { status: "not_started" },
    };

    expect(getImminentCategories(progress).map((category) => category.key)).toEqual([
      "venue",
    ]);
  });

  it("removes a started category once the user schedules it", () => {
    const progress: Record<string, ProgressItem> = {
      venue: { status: "in_progress" },
    };
    const events: ScheduleEvent[] = [
      {
        id: "evt_venue",
        date: "2026-08-01",
        title: "예식장 방문",
        categoryKey: "venue",
        createdAt: "2026-07-13T00:00:00.000Z",
        updatedAt: "2026-07-13T00:00:00.000Z",
      },
    ];

    expect(getImminentCategories(progress, events)).toEqual([]);
  });

  it("keeps completed records separate from schedule suggestions", () => {
    const progress: Record<string, ProgressItem> = {
      venue: { status: "completed" },
    };

    expect(getImminentCategories(progress)).toEqual([]);
    expect(
      getCompletedImminentCategories(progress).map((category) => category.key),
    ).toEqual(["venue"]);
  });
});
