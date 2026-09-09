import { describe, expect, it } from "vitest";
import { CURRENT_WEDDING_CODE_SCENE_CONFIG as config } from "@/lib/weddingCode/scene/config";
import { buildWeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";
import { buildWeddingCodeV06GapMap, type WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { buildWeddingCodeAmoraProposals, buildWeddingCodeCoupleCombination } from "../amoraBridge";

const profile = (answers: WeddingCodeV06Answers) => buildWeddingCodeSelfProfile(answers, config);
const pair = (first: WeddingCodeV06Answers, second: WeddingCodeV06Answers) =>
  buildWeddingCodeCoupleCombination(profile(first), profile(second), buildWeddingCodeV06GapMap(first, second, config));

describe("실제 선택과 해석의 경계", () => {
  it("동률인 두 집계라도 두 장면의 답이 모두 반대면 다르다고 표시한다", () => {
    const result = pair({ C1: "A", C2: "B" }, { C1: "C", C2: "A" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ state: "different", compared: 2, identical: 0 });
    expect(result[0].directive).not.toMatch(/같아요|어긋나지 않/);
  });

  it("각자 같은 쪽 답을 골라도 함께 답한 장면이 없으면 비교하지 않는다", () => {
    expect(pair({ A1: "A" }, { A2: "A" })).toEqual([]);
  });

  it("같은 축 안에 묶인 서로 다른 문장도 같은 답이라고 합치지 않는다", () => {
    expect(pair({ B1: "C" }, { B1: "D" })[0]).toMatchObject({
      state: "different", compared: 1, identical: 0,
    });
  });

  it("같은 답은 실제로 함께 답한 수만큼만 말한다", () => {
    expect(pair({ A1: "A", A2: "A" }, { A1: "A" })[0]).toMatchObject({
      state: "same_answers", compared: 1, identical: 1,
    });
  });

  it.each([
    { D1: "A", D2: "B", D3: "A", D4: "B", D5: "B" },
    { B5: "A" },
    { D4: "D" },
  ] satisfies WeddingCodeV06Answers[])("경험·상대에게 한 행동을 내 아모라 설정으로 미리 고르지 않는다: %j", (answers) => {
    const proposals = buildWeddingCodeAmoraProposals(profile(answers));
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(proposal).not.toHaveProperty("value");
      expect(proposal).not.toHaveProperty("confidence", "direct");
      expect(proposal).toHaveProperty("options");
    }
  });
});
