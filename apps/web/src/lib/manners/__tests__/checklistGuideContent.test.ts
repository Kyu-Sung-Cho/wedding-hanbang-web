import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { CHECKLIST_CATEGORY_GUIDES } from "@hanbang/shared/checklist-guides";

const LEGACY_CATEGORY_KEYS = [
  "meeting", "venue", "studio", "dress", "makeup", "ring", "hanbok", "yedan",
  "honeymoon", "houseware", "housing", "invitation", "snap", "shoes", "bouquet",
  "gift", "mc", "ham", "pyebaek",
] as const;

const LEGACY_ITEM_IDS = new Set(
  LEGACY_CATEGORY_KEYS.flatMap((categoryKey) => {
    const countByCategory: Record<(typeof LEGACY_CATEGORY_KEYS)[number], number> = {
      meeting: 6, venue: 8, studio: 8, dress: 8, makeup: 8, ring: 8, hanbok: 7,
      yedan: 6, honeymoon: 8, houseware: 7, housing: 7, invitation: 7, snap: 7,
      shoes: 6, bouquet: 6, gift: 7, mc: 6, ham: 6, pyebaek: 6,
    };
    return Array.from(
      { length: countByCategory[categoryKey] },
      (_, index) => `${categoryKey}_${String(index + 1).padStart(2, "0")}`,
    );
  }),
);

const JOURNEY_STAGES = new Set([
  "foundation", "contracts", "home", "vendors", "guests", "ceremony", "aftercare", "optional",
]);

describe("rich checklist guide content contract", () => {
  it("covers every canonical checklist category exactly once", () => {
    const categoryKeys = CATEGORY_CHECKLISTS.map((category) => category.key).sort();
    const guideKeys = Object.keys(CHECKLIST_CATEGORY_GUIDES).sort();
    expect(guideKeys).toEqual(categoryKeys);
    expect(guideKeys).not.toContain("reserve");
  });

  it("provides useful decisions, tips, cautions, and executable dialogue everywhere", () => {
    for (const [key, guide] of Object.entries(CHECKLIST_CATEGORY_GUIDES)) {
      expect(guide.categoryKey, key).toBe(key);
      expect(guide.introduction.length, key).toBeGreaterThan(40);
      expect(guide.completion.length, key).toBeGreaterThan(20);
      expect(guide.alignFirst.length, key).toBeGreaterThanOrEqual(3);
      expect(guide.tips.length, key).toBeGreaterThanOrEqual(3);
      expect(guide.cautions.length, key).toBeGreaterThanOrEqual(3);
      expect(guide.conversations.length, key).toBeGreaterThanOrEqual(2);
      for (const conversation of guide.conversations) {
        expect(conversation.say.length, `${key}:${conversation.title}`).toBeGreaterThan(25);
        expect(conversation.note.length, `${key}:${conversation.title}`).toBeGreaterThan(10);
      }
    }
  });

  it("preserves the legacy 19 categories and all 132 stable item ids", () => {
    const categoriesByKey = new Map(
      CATEGORY_CHECKLISTS.map((category) => [category.key, category]),
    );
    const allIds = CATEGORY_CHECKLISTS.flatMap((category) =>
      category.items.map((item) => item.id),
    );

    for (const key of LEGACY_CATEGORY_KEYS) expect(categoriesByKey.has(key), key).toBe(true);
    expect(LEGACY_ITEM_IDS.size).toBe(132);
    for (const id of LEGACY_ITEM_IDS) expect(allIds, id).toContain(id);
  });

  it("keeps category and item identities unique with complete journey metadata", () => {
    const categoryKeys = CATEGORY_CHECKLISTS.map((category) => category.key);
    const itemIds = CATEGORY_CHECKLISTS.flatMap((category) =>
      category.items.map((item) => item.id),
    );

    expect(new Set(categoryKeys).size).toBe(categoryKeys.length);
    expect(new Set(itemIds).size).toBe(itemIds.length);
    expect(CATEGORY_CHECKLISTS).toHaveLength(27);
    expect(itemIds).toHaveLength(218);
    for (const category of CATEGORY_CHECKLISTS) {
      expect(JOURNEY_STAGES.has(category.journeyStage), category.key).toBe(true);
      expect(typeof category.budgetTracked, category.key).toBe("boolean");
      expect(category.items.length, category.key).toBeGreaterThanOrEqual(6);
      expect(category.introducedInVersion, category.key).toBe(
        LEGACY_CATEGORY_KEYS.includes(
          category.key as (typeof LEGACY_CATEGORY_KEYS)[number],
        )
          ? 1
          : 2,
      );
    }
    const aftercare = CATEGORY_CHECKLISTS.find((category) => category.key === "aftercare");
    expect(aftercare).toMatchObject({ ddayStart: 0, ddayDeadline: -30 });
  });

  it("keeps every new journey pack actionable without replacing stored legacy work", () => {
    const newKeys = [
      "foundation", "contracts", "guests", "ceremony",
      "home_admin", "health_admin", "aftercare", "special_cases",
    ] as const;

    for (const key of newKeys) {
      const category = CATEGORY_CHECKLISTS.find((candidate) => candidate.key === key);
      expect(category, key).toBeDefined();
      expect(category?.items.length, key).toBeGreaterThanOrEqual(8);
      expect(category?.items.length, key).toBeLessThanOrEqual(14);
      expect(category).toMatchObject({ budgetTracked: false, introducedInVersion: 2 });
    }
  });

  it("attaches recently reviewed official sources to legal, housing, and health guides", () => {
    const sourceRequired = ["contracts", "home_admin", "health_admin", "special_cases"] as const;
    const officialHost = /(?:easylaw\.go\.kr|efamily\.scourt\.go\.kr|gov\.kr|kdca\.go\.kr)$/;

    for (const key of sourceRequired) {
      const sources = CHECKLIST_CATEGORY_GUIDES[key].sources ?? [];
      expect(sources.length, key).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.url, `${key}:${source.label}`).toMatch(/^https:\/\//);
        expect(new URL(source.url).hostname, `${key}:${source.label}`).toMatch(officialHost);
        expect(source.checkedAt, `${key}:${source.label}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(source.scope.length, `${key}:${source.label}`).toBeGreaterThan(15);
      }
    }
  });

  it("does not revive fixed gender roles or unsupported price rules", () => {
    const text = JSON.stringify(CHECKLIST_CATEGORY_GUIDES);
    expect(text).not.toMatch(/신랑측|신부측|남자가 해야|여자가 해야|며느리의 의무|사위의 의무/);
    expect(text).not.toMatch(/\d[\d,.]*\s*(?:원|만원|억원|%)/);
  });

  it("ships the long-form copy through a web-only subpath instead of the mobile constants barrel", () => {
    const sharedRoot = resolve(process.cwd(), "../../packages/shared");
    const constantsBarrel = readFileSync(resolve(sharedRoot, "src/constants/index.ts"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(resolve(sharedRoot, "package.json"), "utf8"),
    ) as { exports?: Record<string, string> };
    const pageSource = readFileSync(
      resolve(process.cwd(), "src/components/app/checklist/ChecklistCategoryView.tsx"),
      "utf8",
    );

    expect(constantsBarrel).not.toContain("checklistGuides");
    expect(packageJson.exports?.["./checklist-guides"]).toBe(
      "./src/constants/checklistGuides.ts",
    );
    expect(pageSource).toContain('from "@hanbang/shared/checklist-guides"');
  });
});
