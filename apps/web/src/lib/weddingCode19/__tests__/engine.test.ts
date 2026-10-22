import { describe, expect, it } from "vitest";
import {
  CHARACTER_PROFILES_19,
  WEDDING_CODE_19_QUESTIONS,
  type WeddingCode19Answers,
} from "../data";
import {
  buildPersonalReport19,
  buildWeddingCode19AmoraPersonalization,
  buildWeddingCode19AmoraPrefill,
  computeAxisPercentages,
  scoreWeddingCode19,
} from "../engine";

describe("WeddingCode 19 Engine Upgrade Verification", () => {
  it("computeAxisPercentages(1, 0) applies baseline smoothing and does NOT return 100% : 0%", () => {
    const { leftPercent: left1, rightPercent: right1 } = computeAxisPercentages(1, 0);
    expect(left1).not.toBe(100);
    expect(right1).not.toBe(0);
    expect(left1).toBe(63);
    expect(right1).toBe(37);

    const { leftPercent: left3, rightPercent: right3 } = computeAxisPercentages(3, 0);
    expect(left3).toBe(75);
    expect(right3).toBe(25);

    const { leftPercent: left6, rightPercent: right6 } = computeAxisPercentages(6, 0);
    expect(left6).toBe(89);
    expect(right6).toBe(11);
  });

  it("answering 1 on non-spend items (Q2, Q6, Q11, Q12) never pollutes saveSimplify12, relativeSaveSuggestions, partnerTranslations, or amoraPrefillText", () => {
    const answers: WeddingCode19Answers = {
      Q1: 3,
      Q2: 1, // 소규모 프라이빗 (대형 하객 선호 = 비지출)
      Q3: 3,
      Q4: 3,
      Q5: 4,
      Q6: 1, // 하객 교통·주차 (비지출)
      Q7: 4,
      Q8: 3,
      Q9: 3,
      Q10: 3,
      Q11: 1, // 사전 계획표 (비지출)
      Q12: 1, // 발품 비교 (비지출)
      Q13: "B",
      Q14: "B",
      Q15: "A",
      Q16: "A",
      Q17: "A",
      Q18: "A",
      Q19: "A",
    };

    const report = buildPersonalReport19({
      ...answers,
      Q1: 4,
      Q3: 4,
      Q4: 4,
      Q5: 4,
      Q7: 4,
      Q8: 4,
      Q9: 4,
      Q10: 4,
      Q13: "B",
    });
    const saveIds = report.basket.saveSimplify12.map((item) => item.questionId);
    const relativeSaveIds = report.basket.relativeSaveSuggestions.map(
      (item) => item.questionId,
    );

    for (const nonSpendId of ["Q2", "Q6", "Q11", "Q12"] as const) {
      expect(saveIds).not.toContain(nonSpendId);
      expect(relativeSaveIds).not.toContain(nonSpendId);
    }

    const pReport = buildPersonalReport19({
      ...answers,
      Q1: 4,
      Q3: 4,
      Q4: 4,
      Q5: 4,
      Q7: 4,
      Q8: 4,
      Q9: 4,
      Q10: 4,
      Q6: 5,
      Q13: "B",
    });
    const tr0 = `${pReport.hiddenPsychology.partnerTranslations[0].whenISay} ${pReport.hiddenPsychology.partnerTranslations[0].whatIReallyMean}`;
    const tr2 = `${pReport.hiddenPsychology.partnerTranslations[2].whenISay} ${pReport.hiddenPsychology.partnerTranslations[2].whatIReallyMean}`;
    const prefill = buildWeddingCode19AmoraPrefill(pReport);

    for (const text of [
      pReport.hiddenPsychology.unconsciousInsight,
      tr0,
      tr2,
      prefill,
    ]) {
      expect(text).not.toContain("소규모·프라이빗 예식");
      expect(text).not.toContain("하객 교통·주차 편의");
      expect(text).not.toContain("사전 계획표·예산안 수립");
      expect(text).not.toContain("다수 업체 비교·꼼꼼한 검토");
    }
    expect(tr2).toContain("불필요한 겉치레나 보여주기식 옵션");
  });

  it("answering all 1s or all 3s results in subPersona.archetypeKey === 'future_strategist', NOT 'visual_artist'", () => {
    const allOnes: WeddingCode19Answers = {
      Q1: 1,
      Q2: 1,
      Q3: 1,
      Q4: 1,
      Q5: 1,
      Q6: 1,
      Q7: 1,
      Q8: 1,
      Q9: 1,
      Q10: 1,
      Q11: 1,
      Q12: 1,
      Q13: "B",
      Q14: "B",
      Q15: "B",
      Q16: "B",
      Q17: "B",
      Q18: "B",
      Q19: "B",
    };
    const allThrees: WeddingCode19Answers = {
      Q1: 3,
      Q2: 3,
      Q3: 3,
      Q4: 3,
      Q5: 3,
      Q6: 3,
      Q7: 3,
      Q8: 3,
      Q9: 3,
      Q10: 3,
      Q11: 3,
      Q12: 3,
      Q13: "C",
      Q14: "C",
      Q15: "C",
      Q16: "C",
      Q17: "C",
      Q18: "C",
      Q19: "C",
    };

    const reportOnes = buildPersonalReport19(allOnes);
    const reportThrees = buildPersonalReport19(allThrees);

    expect(reportOnes.subPersona.archetypeKey).toBe("future_strategist");
    expect(reportOnes.subPersona.archetypeKey).not.toBe("visual_artist");
    expect(reportThrees.subPersona.archetypeKey).toBe("future_strategist");
    expect(reportThrees.subPersona.archetypeKey).not.toBe("visual_artist");
  });

  it("no subPersona.subTitle contains duplicate modifiers or broken grammar when combined with characterName", () => {
    expect(WEDDING_CODE_19_QUESTIONS).toHaveLength(19);
    const archetypeInputs: WeddingCode19Answers[] = [
      { Q5: 5, Q8: 5, Q9: 5, Q13: "A" },
      { Q6: 5, Q7: 5 },
      { Q2: 5, Q4: 5 },
      { Q1: 5, Q3: 5 },
      { Q10: 5, Q16: "A" },
      { Q11: 5, Q12: 5, Q14: "A" },
      { Q13: "B", Q5: 1, Q8: 1, Q9: 1 },
      { Q14: "B", Q19: "B", Q11: 1, Q12: 1 },
    ];

    for (const ans of archetypeInputs) {
      const report = buildPersonalReport19(ans);
      const { subTitle } = report.subPersona;
      expect(subTitle).not.toContain("로망을 수놓는");
      expect(subTitle).not.toContain("다정한");
      expect(subTitle).not.toContain("품격 있는");
      for (const profile of Object.values(CHARACTER_PROFILES_19)) {
        expect(subTitle).toContain(profile.characterName === report.character.characterName ? report.character.characterName : "");
      }
    }
  });

  it("Q13 weight is 2 so Q5=5, Q8=5, Q9=5 (+6 D) beats Q13=B (+2 P)", () => {
    const scored = scoreWeddingCode19({
      Q5: 5,
      Q8: 5,
      Q9: 5,
      Q13: "B",
    });
    expect(scored.axes.axis2.leftScore).toBe(6);
    expect(scored.axes.axis2.rightScore).toBe(2);
    expect(scored.axes.axis2.winner).toBe("D");
  });

  it("buildWeddingCode19AmoraPersonalization maps Q11/Q14 -> decisionStart, Q15 -> workMode, Q16 -> familyOrder, Q19 -> supportOrder accurately", () => {
    expect(
      buildWeddingCode19AmoraPersonalization({
        Q11: 5,
        Q14: "A",
        Q15: "A",
        Q16: "A",
        Q19: "A",
      }),
    ).toEqual({
      decisionStart: "compare_first",
      answerDetail: "detailed",
      workMode: "together",
      familyOrder: "family_input_first",
      supportOrder: "listen_first",
      toneStyle: "warm",
    });

    expect(
      buildWeddingCode19AmoraPersonalization({
        Q11: 2,
        Q14: "B",
        Q15: "B",
        Q16: "B",
        Q19: "B",
      }),
    ).toEqual({
      decisionStart: "recommend_first",
      answerDetail: "brief",
      workMode: "owner_led",
      familyOrder: "couple_first",
      supportOrder: "action_first",
      toneStyle: "calm_clear",
    });
  });
});
