import { describe, expect, it } from "vitest";
import { AMORA_PERSONALIZATION_FIELD_NAMES, isAmoraPersonalizationChanges } from "@/lib/amora/personalization";
import { CURRENT_WEDDING_CODE_SCENE_CONFIG as config } from "@/lib/weddingCode/scene/config";
import { buildWeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";
import { buildWeddingCodeV06GapMap, type WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { buildWeddingCodeAmoraProposals, buildWeddingCodeCoupleCombination } from "../amoraBridge";

const profileOf = (answers: WeddingCodeV06Answers) => buildWeddingCodeSelfProfile(answers, config);
const allA = Object.fromEntries(config.questions.map((q) => [q.key, "A"])) as WeddingCodeV06Answers;
const allB = Object.fromEntries(config.questions.map((q) => [q.key, "B"])) as WeddingCodeV06Answers;

describe("아모라 도움 방식 직접 확인", () => {
  it("비워둔 축에서는 답을 만들어 제안하지 않는다", () => {
    expect(buildWeddingCodeAmoraProposals(profileOf({}))).toEqual([]);
    expect(buildWeddingCodeAmoraProposals(profileOf({ D4: "B" })).map(p => p.field)).toEqual(["supportOrder"]);
  });
  it("응답 방향이 반대여도 선택지는 동일하고 미리 고른 값은 없다", () => {
    expect(buildWeddingCodeAmoraProposals(profileOf(allA))).toEqual(buildWeddingCodeAmoraProposals(profileOf(allB)));
    for (const proposal of buildWeddingCodeAmoraProposals(profileOf(allA))) {
      expect(proposal).not.toHaveProperty("value");
      expect(proposal).not.toHaveProperty("confidence");
      expect(proposal.basis).toContain("지금 원하는 도움은 다를 수 있어요");
    }
  });
  it("모든 직접 선택은 기존 API가 받는 해당 필드의 값이다", () => {
    for (const proposal of buildWeddingCodeAmoraProposals(profileOf(allA))) {
      expect(AMORA_PERSONALIZATION_FIELD_NAMES).toContain(proposal.field);
      expect(proposal.options.length).toBeGreaterThan(1);
      for (const option of proposal.options) {
        expect(isAmoraPersonalizationChanges({ [proposal.field]: option.value })).toBe(true);
        expect(option.label).toBeTruthy();
        expect(option.effect).toBeTruthy();
      }
    }
  });
  it("지원 질문은 내가 받고 싶은 도움을 직접 묻는다", () => {
    const support = buildWeddingCodeAmoraProposals(profileOf({ D4: "B" }))[0];
    expect(support.question).toContain("내가 힘들다고 말하면");
    expect(support.options.map(o => o.value)).toEqual(["listen_first", "action_first", "ask_each_time"]);
  });
});

describe("두 사람의 실제 선택 비교", () => {
  const pair = (first: WeddingCodeV06Answers, second: WeddingCodeV06Answers) =>
    buildWeddingCodeCoupleCombination(profileOf(first), profileOf(second), buildWeddingCodeV06GapMap(first, second, config));
  it("같은 답이 나온 실제 공통 장면 수를 표시한다", () => {
    const result = pair(allA, allA);
    expect(result).toHaveLength(4);
    expect(result.every(p => p.state === "same_answers" && p.compared === 5 && p.identical === 5)).toBe(true);
    expect(result.map(p => p.directive).join(" ")).not.toMatch(/어긋나지|대화가 빨라|기준이 같|필요한 것이 같/);
  });
  it("다른 선택은 계정별 설정이나 관계 예측으로 바꾸지 않는다", () => {
    for (const item of pair(allA, allB)) {
      expect(item.state).toBe("different");
      expect(item.compared).toBe(5);
      expect(item.identical).toBe(0);
      for (const key of AMORA_PERSONALIZATION_FIELD_NAMES) expect(Object.keys(item)).not.toContain(key);
    }
  });
});
