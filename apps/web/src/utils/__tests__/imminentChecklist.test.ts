import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCompletedImminentCategories,
  getImminentCategories,
} from "../imminentChecklist";
import type { ProgressItem } from "@/types/database.types";

afterEach(() => vi.useRealTimers());

describe("getImminentCategories full-journey timing", () => {
  it("does not call any unreviewed category imminent before the wedding", () => {
    vi.setSystemTime(new Date("2026-08-01T03:00:00.000Z"));
    const result = getImminentCategories({}, new Date("2026-08-20T00:00:00"));

    expect(result.some((item) => item.key === "aftercare")).toBe(false);
    expect(result.some((item) => item.key === "ceremony")).toBe(false);
    expect(result.some((item) => item.key === "venue")).toBe(false);
  });

  it("keeps a reviewed legacy status-only completion in work needing confirmation", () => {
    vi.setSystemTime(new Date("2026-08-01T03:00:00.000Z"));
    const progress = {
      venue: { category: "venue", status: "completed" },
    } as unknown as Record<string, ProgressItem>;

    const imminent = getImminentCategories(
      progress,
      new Date("2026-08-20T00:00:00"),
    );
    const completed = getCompletedImminentCategories(
      progress,
      new Date("2026-08-20T00:00:00"),
    );

    expect(imminent).toEqual([
      expect.objectContaining({ key: "venue", status: "not_started", doneCount: 0 }),
    ]);
    expect(completed.some((item) => item.key === "venue")).toBe(false);
  });

  it("shows only an activated aftercare category on and after the wedding", () => {
    vi.setSystemTime(new Date("2026-08-21T03:00:00.000Z"));
    const progress = {
      aftercare: {
        category: "aftercare",
        status: "not_started",
        checklistReviewedAt: "2026-08-01T00:00:00.000Z",
      },
      venue: { category: "venue", status: "in_progress" },
    } as unknown as Record<string, ProgressItem>;
    const result = getImminentCategories(progress, new Date("2026-08-20T00:00:00"));

    expect(result.map((item) => item.key)).toEqual(["aftercare"]);
  });

  it("keeps day-of ceremony operations visible on D-day", () => {
    vi.setSystemTime(new Date("2026-08-20T03:00:00.000Z"));
    const progress = {
      ceremony: {
        category: "ceremony",
        status: "not_started",
        checklistReviewedAt: "2026-08-01T00:00:00.000Z",
      },
      aftercare: { category: "aftercare", status: "not_started" },
    } as unknown as Record<string, ProgressItem>;
    const result = getImminentCategories(progress, new Date("2026-08-20T00:00:00"));

    const keys = result.map((item) => item.key);
    expect(keys).toContain("ceremony");
    expect(keys).not.toContain("aftercare");
  });

  it("includes activated D+30 home and administration categories after the wedding", () => {
    vi.setSystemTime(new Date("2026-08-21T03:00:00.000Z"));
    const progress = {
      home_admin: { category: "home_admin", status: "not_started", checklistReviewedAt: "2026-08-01T00:00:00.000Z" },
      health_admin: { category: "health_admin", status: "not_started", checklistReviewedAt: "2026-08-01T00:00:00.000Z" },
      aftercare: { category: "aftercare", status: "not_started", checklistReviewedAt: "2026-08-01T00:00:00.000Z" },
    } as unknown as Record<string, ProgressItem>;
    const result = getImminentCategories(progress, new Date("2026-08-20T00:00:00"));

    expect(result.map((item) => item.key).sort()).toEqual([
      "aftercare",
      "health_admin",
      "home_admin",
    ]);
  });
});
