import { describe, it, expect } from "vitest";
import { mergeChecklist, calculateStatus, getChecklistCounts } from "../checklist";
import type { ChecklistItem } from "@/types/database.types";

const makeItems = (ids: string[], doneStates: boolean[]): ChecklistItem[] =>
  ids.map((id, i) => ({ id, label: `Task ${id}`, done: doneStates[i] }));

const template: ChecklistItem[] = makeItems(["a", "b", "c", "d"], [false, false, false, false]);

describe("mergeChecklist", () => {
  describe("no saved data — status-based initialization", () => {
    it("returns all false when status is not_started", () => {
      const result = mergeChecklist(template, undefined, "not_started");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("returns all false when saved is empty array", () => {
      const result = mergeChecklist(template, [], "not_started");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("returns all true when status is completed", () => {
      const result = mergeChecklist(template, undefined, "completed");
      expect(result.every((i) => i.done)).toBe(true);
    });

    it("marks first half done when status is in_progress", () => {
      const result = mergeChecklist(template, undefined, "in_progress");
      const doneCount = result.filter((i) => i.done).length;
      expect(doneCount).toBe(Math.ceil(template.length / 2));
    });

    it("in_progress with odd-length template marks ceil(n/2) done", () => {
      const odd = makeItems(["a", "b", "c"], [false, false, false]);
      const result = mergeChecklist(odd, undefined, "in_progress");
      expect(result.filter((i) => i.done).length).toBe(2); // ceil(3/2)=2
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

    it("ignores saved items not present in template", () => {
      const saved = makeItems(["z", "a"], [true, true]);
      const result = mergeChecklist(template, saved);
      expect(result.length).toBe(template.length);
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
