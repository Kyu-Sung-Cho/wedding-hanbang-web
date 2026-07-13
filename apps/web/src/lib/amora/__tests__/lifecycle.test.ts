import { describe, expect, it } from "vitest";
import { buildAmoraLifecyclePlan } from "../lifecycle";

describe("Amora lifecycle KST calendar boundaries", () => {
  it("keeps the entire Korean wedding date in wedding-day stage", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-07-11",
      now: new Date("2026-07-11T14:59:59.000Z"),
      totalBudget: 50_000_000,
      progress: {},
    });

    expect(plan.dday).toBe(0);
    expect(plan.stage).toBe("wedding_day");
  });

  it("moves to aftercare at the next KST midnight", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-07-11",
      now: new Date("2026-07-11T15:00:00.000Z"),
      totalBudget: 50_000_000,
      progress: {},
    });

    expect(plan.dday).toBe(-1);
    expect(plan.stage).toBe("aftercare");
  });

  it("treats an impossible date as missing instead of rolling it over", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-02-30",
      now: new Date("2026-02-01T00:00:00.000Z"),
      progress: {},
    });

    expect(plan.dday).toBeNull();
    expect(plan.stage).toBe("setup");
    expect(plan.guardrails.some((item) => item.id === "missing_wedding_date")).toBe(true);
  });

  it("avoids a broken Korean object particle in category guidance", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-10-15",
      now: new Date("2026-07-11T00:00:00.000Z"),
      totalBudget: 25_000_000,
      progress: {},
    });

    const categoryTitles = plan.guardrails
      .filter((item) => item.id.startsWith("category_"))
      .map((item) => item.title);

    expect(categoryTitles.length).toBeGreaterThan(0);
    expect(categoryTitles.every((title) => title.includes(", 놓치지 않게 볼게요"))).toBe(true);
    expect(categoryTitles.join(" ")).not.toContain("을 놓치지 않게 볼게요");
  });
});
