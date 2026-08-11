import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { CHECKLIST_CATEGORY_GUIDES } from "@hanbang/shared/checklist-guides";

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
