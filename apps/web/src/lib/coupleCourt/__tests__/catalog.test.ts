import { describe, expect, it } from "vitest";
import {
  COURT_CATEGORY_CATALOG,
  COURT_EXAMPLE_CASES,
} from "@/lib/coupleCourt/catalog";
import {
  COURT_CATEGORIES,
  COUPLE_COURT_EVENT_NAMES,
  isCourtCategory,
  isCourtMode,
  isCourtTone,
} from "@/lib/coupleCourt/types";

describe("couple-court catalog", () => {
  it("defines exactly twelve unique categories with neutral question prompts", () => {
    expect(COURT_CATEGORIES).toHaveLength(12);
    expect(new Set(COURT_CATEGORIES).size).toBe(12);
    expect(COURT_CATEGORY_CATALOG.map((entry) => entry.id)).toEqual(COURT_CATEGORIES);
    for (const category of COURT_CATEGORY_CATALOG) {
      expect(category.label.length).toBeGreaterThan(2);
      expect(category.questionPrompts.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("labels every Korean fixture as an example without fake engagement", () => {
    expect(COURT_EXAMPLE_CASES).toHaveLength(12);
    for (const example of COURT_EXAMPLE_CASES) {
      expect(example.isExample).toBe(true);
      expect(example.badge).toBe("예시");
      expect(example.title).toMatch(/[가-힣]/);
      expect(example).not.toHaveProperty("votes");
      expect(example).not.toHaveProperty("views");
      expect(example).not.toHaveProperty("resolvedRate");
    }
  });

  it("uses the couple_court event namespace and strict enum guards", () => {
    expect(COUPLE_COURT_EVENT_NAMES.every((name) => name.startsWith("couple_court_"))).toBe(true);
    expect(isCourtMode("couple")).toBe(true);
    expect(isCourtMode("shared")).toBe(false);
    expect(isCourtTone("spicy")).toBe(true);
    expect(isCourtTone("harsh")).toBe(false);
    expect(isCourtCategory("budget")).toBe(true);
    expect(isCourtCategory("other")).toBe(true);
    expect(isCourtCategory("married_life")).toBe(false);
  });
});
