import { describe, expect, it } from "vitest";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG as config,
  WEDDING_CODE_V08_SCENE_CONFIG as v08,
} from "@/lib/weddingCode/scene/config";
import { buildWeddingCodeSelfProfile, describeSelfAxisReading, describeSelfAxisAbsence } from "@/lib/weddingCode/scene/selfProfile";
import { buildWeddingCodeLetters } from "../letters";
import { buildWeddingCodeV06GapMap, type WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { buildWeddingCodeAmoraProposals, buildWeddingCodeCoupleCombination } from "../amoraBridge";

const profile = (answers: WeddingCodeV06Answers) => buildWeddingCodeSelfProfile(answers, config);
const pair = (first: WeddingCodeV06Answers, second: WeddingCodeV06Answers) =>
  buildWeddingCodeCoupleCombination(profile(first), profile(second), buildWeddingCodeV06GapMap(first, second, config));
/**
 * 아래 앞의 세 테스트는 v0.8 B5-A(「둘 다 못 받아서 답이 며칠씩 밀렸다」)의 해석 경계다.
 * v0.9 에서 B5-A 문장이 바뀌었지만 v0.8 링크는 그 판 문항으로 계속 열리므로 판을 고정해 지킨다.
 */
const v08Profile = (answers: WeddingCodeV06Answers) => buildWeddingCodeSelfProfile(answers, v08);
const v08Pair = (first: WeddingCodeV06Answers, second: WeddingCodeV06Answers) =>
  buildWeddingCodeCoupleCombination(v08Profile(first), v08Profile(second), buildWeddingCodeV06GapMap(first, second, v08));

describe("실제 선택과 해석의 경계", () => {
  it("B5의 응답 지연만으로 함께 검토한 행동을 인증하지 않고 기존 T 집계와 인용을 보존한다", () => {
    const result = v08Profile({ B5: "A" });
    const reading = result.axes.find(axis => axis.axis === "preparationMode")!;
    const letters = buildWeddingCodeLetters(result);
    expect(letters.code).toBe("·T··");
    expect(letters.complete).toBe(false);
    expect(reading).toMatchObject({ answered: 1, leftCount: 1, rightCount: 0 });
    expect(reading.evidence).toEqual([{ scene: v08.questions.find(question => question.key === "B5")!.scene, label: "둘 다 못 받아서 답이 며칠씩 밀렸다" }]);
    // T 뜻은 「같이 처리했다」가 아니라 「한 사람에게 맡기지 않은 답」이다 — 둘 다 못 받은 답에도 참이다.
    expect(letters.slots[1].meaning).toBe("한 사람이 도맡지 않는 답을 더 많이 골랐어요");
    expect(reading.title).toBe("이번엔 ‘둘이 같이’ 쪽 답이 더 많았어요");
    // 셈 뒤에 「겪은 일·바랐던 일·내가 한 일이 섞여 있다」는 확인 안내가 붙는다.
    expect(describeSelfAxisReading(reading)).toBe(
      "답한 1장면은 T(둘이 같이) 쪽이었어요. 이 주제의 답에는 겪은 일, 바랐던 일, 내가 한 일이 섞여 있어요. 숫자만 보지 말고 고른 답도 같이 봐 주세요.",
    );
    expect(reading.qualifiers).toEqual(["둘 다 연락을 못 받아 밀린 거라, 같이 알아본 것과는 달라요."]);
    expect([letters.slots[1].meaning, reading.title].join(" ")).not.toMatch(/둘이 같이 보는 답|함께 보는 쪽 답을 더|같이 처리/);
  });

  it("B5 지연과 맡긴 답이 동점이어도 실제 함께 검토한 것으로 요약하지 않는다", () => {
    const result = v08Profile({ B5: "A", B1: "C" });
    const reading = result.axes[1];
    expect(reading.title).not.toContain("함께 보기와 맡기기");
    expect(reading.title).toContain("같은 수");
    expect(result.repeated.find(item => item.construct === "coPreparation")?.phrase).toBe("둘이 같이");
    expect(reading.qualifiers).toContain("둘 다 연락을 못 받아 밀린 거라, 같이 알아본 것과는 달라요.");
    expect(reading.missingPhrases).toEqual([]);
    const comparison = v08Pair({ B5: "A", B1: "C" }, { B5: "B", B1: "A" });
    expect(comparison[0].firstTitle).toBe(reading.title);
    expect(JSON.stringify(comparison)).not.toContain("함께 보기와 맡기기");
  });

  it("현재 판(v0.9 이후) B5의 답을 미룬 경험도 함께 정한 것으로 인증하지 않는다", () => {
    const result = profile({ B5: "A" });
    const reading = result.axes[1];
    expect(buildWeddingCodeLetters(result).code).toBe("·T··");
    expect(reading.evidence[0].label).toBe("둘이 얘기해 봐야 한다며 답을 내일로 미뤘다");
    expect(reading.qualifiers).toEqual(["답을 내일로 미룬 건 상대와 얘기하고 싶어서였을 수도, 바로 정하기 어려워서였을 수도 있어요."]);
    expect(describeSelfAxisReading(reading)).toContain("숫자만 보지 말고 고른 답도 같이 봐 주세요");
  });

  it("연락 지연을 고르지 않은 T 답에는 지연 경험 경고를 붙이지 않는다", () => {
    for (const answers of [{ B1: "A" }, { B5: "C" }] satisfies WeddingCodeV06Answers[]) {
      for (const result of [profile(answers), v08Profile(answers)]) {
        expect(buildWeddingCodeLetters(result).code).toBe("·T··");
        expect(result.axes[1].qualifiers).toEqual([]);
        expect(result.axes[1].watchOut).not.toContain("연락을 받지 못한 경험");
        expect(buildWeddingCodeAmoraProposals(result)[0]).not.toHaveProperty("value");
      }
    }
  });

  it("표시 인용 두 개 뒤에 있는 지연 답도 실제로 골랐다면 한정 안내를 남긴다", () => {
    const result = v08Profile({ B1: "A", B2: "B", B3: "C", B4: "A", B5: "A" });
    expect(result.axes[1].evidence.map(quote => quote.label)).not.toContain("둘 다 못 받아서 답이 며칠씩 밀렸다");
    expect(result.axes[1].qualifiers).toContain("둘 다 연락을 못 받아 밀린 거라, 같이 알아본 것과는 달라요.");
    expect(buildWeddingCodeLetters(result).code).toBe("·T··");
    expect(result.axes[1]).toMatchObject({ leftCount: 5, rightCount: 0 });
  });

  it("반대쪽만 고른 응답의 부재 설명도 공동 검토를 원하는지 단정하지 않는다", () => {
    const result = profile({ B5: "B" });
    expect(result.axes[1].missingPhrases).toEqual(["둘이 같이"]);
    expect(describeSelfAxisAbsence(result.axes[1])).toBe(
      "“둘이 같이” 쪽 답은 한 번도 고르지 않았어요.",
    );
    expect(describeSelfAxisAbsence(result.axes[1])).not.toContain("먼저 보는");
    expect(buildWeddingCodeAmoraProposals(result)[0]).not.toHaveProperty("value");
  });

  it.each([
    [{ B5: "B" }, "·O··", 0, 1],
    [{ B5: "C" }, "·T··", 1, 0],
    [{ B5: "D" }, "·O··", 0, 1],
    [{ B1: "A", B2: "A", B3: "C", B4: "B", B5: "A" }, "·t··", 3, 2],
    [{ B1: "C", B5: "A" }, "····", 1, 1],
  ] as const)("다른 연락 방식·혼합·동점의 코드와 양쪽 집계를 유지한다: %j", (answers, code, leftCount, rightCount) => {
    const result = profile(answers);
    expect(buildWeddingCodeLetters(result).code).toBe(code);
    expect(result.axes[1]).toMatchObject({ leftCount, rightCount, answered: leftCount + rightCount });
  });

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
