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
    // 2026-08-21에 21개가 됐다. 예절 편은 있는데 실행 쪽에 대응물이 없던 두 편을 채웠다 —
    // 「첫인사 예절」과 「혼인신고와 법적 절차」다. 잠금 변경이 같은 이유로 세 편을 더 이었다 —
    // 「양가 호칭 총정리」·「이바지·답례품 예절」·「집들이 예절」. 숫자를 박아 두는 이유는
    // 분야가 늘 때 이 검사를 반드시 지나가게 해서, 편을 안 이은 채로 분야만 생기는 일을
    // 막기 위해서다.
    expect(categoryKeys).toHaveLength(24);
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
