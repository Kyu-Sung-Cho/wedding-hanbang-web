import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";

const INDUSTRY_JARGON =
  /상견례|예식장|스튜디오|본식|스냅|피팅|혼주|헬퍼|얼리스타트|부토니에|폐백|함진아비|포트폴리오|리허설|원본|보정본|드레스샵|드레스 투어/;
const UNSUPPORTED_ABSOLUTE =
  /최소\s*\d|3곳 이상|10%|반드시|필수|일반적|대부분|보통 .*합니다/;

describe("초보자용 준비 항목 문구", () => {
  it("일정·예산에서 같은 쉬운 카테고리 이름을 사용한다", () => {
    for (const category of CATEGORY_CHECKLISTS) {
      expect(category.label).toBe(
        PLANNING_CATEGORY_LABELS[
          category.key as keyof typeof PLANNING_CATEGORY_LABELS
        ],
      );
    }
  });

  it("기본 체크리스트가 설명 없는 업계 용어나 근거 없는 절대 조언을 쓰지 않는다", () => {
    for (const category of CATEGORY_CHECKLISTS) {
      const copy = [
        category.label,
        category.tip,
        ...category.items.map((item) => item.label),
      ].join("\n");

      expect(copy, category.key).not.toMatch(INDUSTRY_JARGON);
      expect(copy, category.key).not.toMatch(UNSUPPORTED_ABSOLUTE);
    }
  });
});
