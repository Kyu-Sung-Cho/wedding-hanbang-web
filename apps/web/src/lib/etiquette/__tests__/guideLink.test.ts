import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { guideLinkForCategory } from "../guideLink";

/**
 * 2026-08-19 아침까지 준비 카테고리 19개 중 10개만 예절 안내로 이어졌고, 나머지 9개는
 * 모달 하단이 "아모라에게 물어보기"로 떨어졌다 — 상견례·예물·예단·함·한복·폐백·
 * 신혼여행·혼수·신혼집이 그 9개다. 같은 날 레거시 25편을 `/manners` 스키마로 이관해
 * 전부 채웠다. 이 테스트가 그 커버리지를 고정한다.
 */
describe("guideLinkForCategory", () => {
  const categoryKeys = CATEGORY_CHECKLISTS.map((category) => category.key);

  it("covers every checklist category", () => {
    const uncovered = categoryKeys.filter((key) => guideLinkForCategory(key) === null);
    expect(uncovered, `안내가 없는 카테고리: ${uncovered.join(", ")}`).toEqual([]);
    expect(categoryKeys).toHaveLength(19);
  });

  it("fills the nine categories that used to have no guide", () => {
    const previouslyEmpty = [
      "meeting",
      "ring",
      "yedan",
      "ham",
      "hanbok",
      "pyebaek",
      "honeymoon",
      "houseware",
      "housing",
    ];
    for (const key of previouslyEmpty) {
      const link = guideLinkForCategory(key);
      expect(link, `${key}에 안내가 없다`).not.toBeNull();
      expect(link!.href).toMatch(/^\/manners\/[a-z-]+$/);
    }
  });

  it("only points at parts that actually exist", () => {
    const slugs = new Set(MANNERS_PARTS.map((part) => part.slug));
    for (const key of categoryKeys) {
      const link = guideLinkForCategory(key);
      if (!link) continue;
      const slug = link.href.replace("/manners/", "");
      expect(slugs.has(slug), `${key} → 없는 파트 ${slug}`).toBe(true);
    }
  });

  it("returns null for unknown keys instead of inventing a link", () => {
    expect(guideLinkForCategory(null)).toBeNull();
    expect(guideLinkForCategory(undefined)).toBeNull();
    expect(guideLinkForCategory("nope")).toBeNull();
  });
});
