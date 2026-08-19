import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { MAPPED_MANNERS_CATEGORY_KEYS } from "@/lib/manners/categoryMap";
import { guideLinkForCategory } from "../guideLink";

/**
 * 2026-08-19 이전에는 준비 카테고리 19개 중 10개만 예절 안내로 이어졌고, 나머지 9개는
 * 모달 하단이 "아모라에게 물어보기"로 떨어졌다 — 상견례·예물·예단·함·한복·폐백·
 * 신혼여행·혼수·신혼집이 그 9개다. 레거시 25파트를 되살려 그 공백을 메웠다.
 */
describe("guideLinkForCategory", () => {
  const categoryKeys = CATEGORY_CHECKLISTS.map((category) => category.key);

  it("covers every checklist category", () => {
    const uncovered = categoryKeys.filter((key) => guideLinkForCategory(key) === null);
    expect(uncovered, `안내가 없는 카테고리: ${uncovered.join(", ")}`).toEqual([]);
    expect(categoryKeys).toHaveLength(19);
  });

  it("prefers the sourced manners guide wherever one exists", () => {
    for (const key of MAPPED_MANNERS_CATEGORY_KEYS) {
      const link = guideLinkForCategory(key);
      expect(link?.kind, `${key}는 출처 있는 manners를 써야 한다`).toBe("manners");
      expect(link?.href.startsWith("/manners/")).toBe(true);
    }
  });

  it("falls back to the legacy corpus only for categories manners does not cover", () => {
    const legacyOnly = categoryKeys.filter((key) => guideLinkForCategory(key)?.kind === "legacy");

    expect(legacyOnly.sort()).toEqual(
      ["ham", "hanbok", "honeymoon", "houseware", "housing", "meeting", "pyebaek", "ring", "yedan"].sort(),
    );
    for (const key of legacyOnly) {
      expect(guideLinkForCategory(key)?.href).toMatch(/^\/etiquette\?part=\d+$/);
    }
  });

  it("returns null for unknown keys instead of inventing a link", () => {
    expect(guideLinkForCategory(null)).toBeNull();
    expect(guideLinkForCategory(undefined)).toBeNull();
    expect(guideLinkForCategory("nope")).toBeNull();
  });

  it("never points at a part number that does not exist", () => {
    for (const key of categoryKeys) {
      const link = guideLinkForCategory(key);
      if (link?.kind !== "legacy") continue;
      expect(link.title.length).toBeGreaterThan(0);
      expect(link.subtitle.length).toBeGreaterThan(0);
    }
  });
});
