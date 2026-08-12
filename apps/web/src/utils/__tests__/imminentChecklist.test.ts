import { afterEach, describe, expect, it, vi } from "vitest";

import { getImminentCategories } from "../imminentChecklist";
import type { ProgressItem } from "@/types/database.types";

afterEach(() => vi.useRealTimers());

describe("getImminentCategories full-journey timing", () => {
  it("does not activate unsaved v2 categories before the wedding", () => {
    vi.setSystemTime(new Date("2026-08-01T03:00:00.000Z"));
    const result = getImminentCategories({}, new Date("2026-08-20T00:00:00"));

    expect(result.some((item) => item.key === "aftercare")).toBe(false);
    expect(result.some((item) => item.key === "ceremony")).toBe(false);
    expect(result.some((item) => item.key === "venue")).toBe(true);
  });

  it("shows only an activated aftercare category on and after the wedding", () => {
    vi.setSystemTime(new Date("2026-08-21T03:00:00.000Z"));
    const progress = {
      aftercare: { category: "aftercare", status: "not_started" },
      venue: { category: "venue", status: "in_progress" },
    } as unknown as Record<string, ProgressItem>;
    const result = getImminentCategories(progress, new Date("2026-08-20T00:00:00"));

    expect(result.map((item) => item.key)).toEqual(["aftercare"]);
  });

  it("keeps day-of ceremony operations visible on D-day", () => {
    vi.setSystemTime(new Date("2026-08-20T03:00:00.000Z"));
    const progress = {
      ceremony: { category: "ceremony", status: "not_started" },
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
      home_admin: { category: "home_admin", status: "not_started" },
      health_admin: { category: "health_admin", status: "not_started" },
      aftercare: { category: "aftercare", status: "not_started" },
    } as unknown as Record<string, ProgressItem>;
    const result = getImminentCategories(progress, new Date("2026-08-20T00:00:00"));

    expect(result.map((item) => item.key).sort()).toEqual([
      "aftercare",
      "health_admin",
      "home_admin",
    ]);
  });
});
