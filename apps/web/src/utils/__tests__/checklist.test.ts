import { describe, it, expect } from "vitest";
import {
  mergeChecklist,
  calculateStatus,
  getChecklistCounts,
  summarizePlanningChecklist,
} from "../checklist";
import type { ChecklistItem } from "@/types/database.types";

const makeItems = (ids: string[], doneStates: boolean[]): ChecklistItem[] =>
  ids.map((id, i) => ({ id, label: `Task ${id}`, done: doneStates[i] }));

const template: ChecklistItem[] = makeItems(["a", "b", "c", "d"], [false, false, false, false]);

describe("mergeChecklist", () => {
  describe("no saved item-level data", () => {
    it("returns all false when status is not_started", () => {
      const result = mergeChecklist(template, undefined, "not_started");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("returns all false when saved is empty array", () => {
      const result = mergeChecklist(template, [], "not_started");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("does not invent completed items from a category-level completed status", () => {
      const result = mergeChecklist(template, undefined, "completed");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("does not invent completed items from a category-level in-progress status", () => {
      const result = mergeChecklist(template, undefined, "in_progress");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("returns all false when no status provided", () => {
      const result = mergeChecklist(template, undefined);
      expect(result.every((i) => !i.done)).toBe(true);
    });
  });

  describe("with saved data", () => {
    it("merges saved done values into template items", () => {
      const saved = makeItems(["a", "c"], [true, true]);
      const result = mergeChecklist(template, saved);
      expect(result.find((i) => i.id === "a")?.done).toBe(true);
      expect(result.find((i) => i.id === "b")?.done).toBe(false);
      expect(result.find((i) => i.id === "c")?.done).toBe(true);
      expect(result.find((i) => i.id === "d")?.done).toBe(false);
    });

    it("preserves template order regardless of saved order", () => {
      const saved = [
        { id: "d", label: "D", done: true },
        { id: "a", label: "A", done: true },
      ];
      const result = mergeChecklist(template, saved);
      expect(result.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("defaults to false for items not in saved", () => {
      const saved = makeItems(["a"], [true]);
      const result = mergeChecklist(template, saved);
      expect(result.find((i) => i.id === "b")?.done).toBe(false);
    });

    it("ignores status when saved data is provided", () => {
      const saved = makeItems(["a"], [false]);
      const result = mergeChecklist(template, saved, "completed");
      // Saved data takes precedence — not all items should be done
      expect(result.find((i) => i.id === "a")?.done).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty template", () => {
      expect(mergeChecklist([], undefined)).toEqual([]);
      expect(mergeChecklist([], [])).toEqual([]);
    });

    it("preserves saved items not present in template", () => {
      const saved = makeItems(["z", "a"], [true, true]);
      const result = mergeChecklist(template, saved);
      expect(result.map((item) => item.id)).toEqual(["a", "b", "c", "d", "z"]);
      expect(result.at(-1)).toMatchObject({ id: "z", done: true });
    });

    it("deduplicates repeated saved-only ids", () => {
      const saved = [...makeItems(["z", "z"], [true, false]), ...makeItems(["a"], [true])];
      const result = mergeChecklist(template, saved);
      expect(result.filter((item) => item.id === "z")).toHaveLength(1);
      expect(result.find((item) => item.id === "z")?.done).toBe(true);
    });
  });
});

describe("summarizePlanningChecklist", () => {
  const templates = [
    { key: "small", items: makeItems(["a"], [false]) },
    { key: "large", items: makeItems(["b", "c", "d"], [false, false, false]) },
  ];

  it("excludes not_applicable categories from the denominator", () => {
    expect(
      summarizePlanningChecklist(templates, {
        small: { status: "not_applicable", checklist: makeItems(["a"], [false]) },
        large: { status: "in_progress", checklist: makeItems(["b", "c", "d"], [true, false, false]) },
      }),
    ).toMatchObject({ done: 1, total: 3, percent: 33, skippedCategories: 1 });
  });

  it("uses item-weighted progress instead of category averages", () => {
    expect(
      summarizePlanningChecklist(templates, {
        small: { status: "completed", checklist: makeItems(["a"], [true]) },
        large: { status: "not_started", checklist: makeItems(["b", "c", "d"], [false, false, false]) },
      }).percent,
    ).toBe(25);
  });

  it("returns a stable zero when every category is skipped", () => {
    const result = summarizePlanningChecklist(templates, {
      small: { status: "not_applicable" },
      large: { status: "not_applicable" },
    });
    expect(result).toMatchObject({ done: 0, total: 0, percent: 0, skippedCategories: 2 });
  });

  it("keeps completed legacy progress stable until a v2 category is started", () => {
    const versionedTemplates = [
      { key: "legacy", introducedInVersion: 1 as const, items: makeItems(["a", "b"], [false, false]) },
      { key: "new", introducedInVersion: 2 as const, items: makeItems(["c", "d"], [false, false]) },
    ];

    expect(
      summarizePlanningChecklist(versionedTemplates, {
        legacy: { status: "completed", checklist: makeItems(["a", "b"], [true, true]) },
      }),
    ).toMatchObject({
      done: 2,
      total: 2,
      percent: 100,
      availableNewCategories: 1,
      applicableCategories: 1,
    });
  });

  it("adds only the v2 category whose progress key has been created", () => {
    const versionedTemplates = [
      { key: "legacy", introducedInVersion: 1 as const, items: makeItems(["a", "b"], [false, false]) },
      { key: "new", introducedInVersion: 2 as const, items: makeItems(["c", "d"], [false, false]) },
      { key: "later", introducedInVersion: 2 as const, items: makeItems(["e"], [false]) },
    ];

    expect(
      summarizePlanningChecklist(versionedTemplates, {
        legacy: { status: "completed", checklist: makeItems(["a", "b"], [true, true]) },
        new: { status: "in_progress", checklist: makeItems(["c", "d"], [true, false]) },
      }),
    ).toMatchObject({
      done: 3,
      total: 4,
      percent: 75,
      availableNewCategories: 1,
      applicableCategories: 2,
    });
  });

  it("treats an explicitly skipped v2 category as handled without adding its items", () => {
    const versionedTemplates = [
      { key: "legacy", introducedInVersion: 1 as const, items: makeItems(["a"], [false]) },
      { key: "new", introducedInVersion: 2 as const, items: makeItems(["b", "c"], [false, false]) },
    ];

    expect(
      summarizePlanningChecklist(versionedTemplates, {
        legacy: { status: "completed", checklist: makeItems(["a"], [true]) },
        new: { status: "not_applicable" },
      }),
    ).toMatchObject({
      done: 1,
      total: 1,
      percent: 100,
      skippedCategories: 1,
      availableNewCategories: 0,
    });
  });
});

describe("calculateStatus", () => {
  it("returns not_started when no items are done", () => {
    expect(calculateStatus(makeItems(["a", "b"], [false, false]))).toBe("not_started");
  });

  it("returns completed when all items are done", () => {
    expect(calculateStatus(makeItems(["a", "b"], [true, true]))).toBe("completed");
  });

  it("returns in_progress when some items are done", () => {
    expect(calculateStatus(makeItems(["a", "b"], [true, false]))).toBe("in_progress");
  });

  it("returns in_progress for exactly half done", () => {
    expect(calculateStatus(makeItems(["a", "b", "c", "d"], [true, true, false, false]))).toBe("in_progress");
  });

  it("returns not_started for empty checklist", () => {
    expect(calculateStatus([])).toBe("not_started");
  });

  it("returns completed for single-item checklist when done", () => {
    expect(calculateStatus(makeItems(["a"], [true]))).toBe("completed");
  });
});

describe("getChecklistCounts", () => {
  it("returns correct done and total counts", () => {
    const items = makeItems(["a", "b", "c"], [true, false, true]);
    expect(getChecklistCounts(items)).toEqual({ done: 2, total: 3 });
  });

  it("returns 0,0 for undefined input", () => {
    expect(getChecklistCounts(undefined)).toEqual({ done: 0, total: 0 });
  });

  it("returns 0,0 for empty array", () => {
    expect(getChecklistCounts([])).toEqual({ done: 0, total: 0 });
  });

  it("returns correct count when all done", () => {
    const items = makeItems(["a", "b"], [true, true]);
    expect(getChecklistCounts(items)).toEqual({ done: 2, total: 2 });
  });

  it("returns correct count when none done", () => {
    const items = makeItems(["a", "b", "c"], [false, false, false]);
    expect(getChecklistCounts(items)).toEqual({ done: 0, total: 3 });
  });
});
