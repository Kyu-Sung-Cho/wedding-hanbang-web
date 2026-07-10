import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WeddingCodeV05QuestionKey } from "@/constants/weddingCodeV05";
import { WEDDING_CODE_V05_QUESTIONS } from "@/constants/weddingCodeV05";
import { buildWeddingCodeV05CoupleReport, buildWeddingCodeV05IndividualReport } from "../report";
import { scoreWeddingCodeV05 } from "../score";

const BANNED_PUBLIC_WORDS = [
  "궁합",
  "적합도",
  "결혼 성공",
  "성공률",
  "이혼",
  "갈등 위험",
  "상위",
  "희귀",
  "충동형",
  "빠른계약형",
  "호구",
  "팔랑귀",
];

const CONFUSING_PUBLIC_COPY_WORDS = ["후보", "줄여온다", "줄일 것", "그대로 할 것", "점수 차이", "꼭"];

function allA() {
  return Object.fromEntries(WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "A"])) as Record<
    WeddingCodeV05QuestionKey,
    "A"
  >;
}

function allD() {
  return Object.fromEntries(WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "D"])) as Record<
    WeddingCodeV05QuestionKey,
    "D"
  >;
}

function answersFromSequence(sequence: string) {
  return Object.fromEntries(
    WEDDING_CODE_V05_QUESTIONS.map((question, index) => [question.key, sequence[index]])
  ) as Record<WeddingCodeV05QuestionKey, "A" | "B" | "C" | "D">;
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}

describe("WeddingCode v0.5 result copy", () => {
  it("문항과 결과 카피는 헷갈린다고 지적된 표현을 다시 쓰지 않는다", () => {
    const questionText = flattenText(WEDDING_CODE_V05_QUESTIONS);
    const reportSource = readFileSync(join(process.cwd(), "src/lib/weddingCode/report.ts"), "utf8");

    for (const word of CONFUSING_PUBLIC_COPY_WORDS) {
      expect(questionText).not.toContain(word);
      expect(reportSource).not.toContain(word);
    }
  });

  it("개인 결과는 금지어 없이 4개 공개 축과 행동 카드를 만든다", () => {
    const report = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(allA()));
    const text = flattenText(report);

    expect(report.axisReports).toHaveLength(4);
    expect(report.talkStarters.length).toBeGreaterThanOrEqual(1);
    expect(report.actionCards.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("현재 답변");
    for (const word of BANNED_PUBLIC_WORDS) {
      expect(text).not.toContain(word);
    }
  });

  it("DPR/GN은 공개 유형명이 아니라 행동 카드로만 나타난다", () => {
    const report = buildWeddingCodeV05IndividualReport(
      scoreWeddingCodeV05({
        A1: "D",
        A2: "C",
        A4: "C",
        B4: "D",
        D4: "A",
      })
    );
    const text = flattenText(report);

    expect(report.axisReports.map((axis) => axis.summaryKo).join(" ")).not.toContain("계약형");
    expect(text).not.toContain("정보압축");
    expect(text).not.toContain("도움이 필요한 사람");
    expect(report.actionCards.some((card) => card.id === "contract_check")).toBe(true);
    expect(report.actionCards.some((card) => card.id === "quote_guidance")).toBe(true);
  });

  it("커플 리포트는 준비 방식 겹침도만 말하고 궁합/적합도 표현을 쓰지 않는다", () => {
    const firstAnswers = allA();
    const secondAnswers = allD();
    const report = buildWeddingCodeV05CoupleReport(scoreWeddingCodeV05(firstAnswers), scoreWeddingCodeV05(secondAnswers), {
      firstAnswers,
      secondAnswers,
    });
    const text = flattenText(report);

    expect(report.titleKo).toContain("준비 방식 겹침도");
    expect(report.overlapScore).not.toBeNull();
    expect(report.easyPoints.length).toBeGreaterThan(0);
    expect(report.talkFirst).not.toBeNull();
    expect(report.scenarioCards).toHaveLength(5);
    expect(report.scenarioCards[0].relation).toBe("different");
    expect(report.scenarioCards.map((card) => card.id)).toContain("venue_budget_gap");
    expect(text).toContain("식장에 예약해야 하는 최소 인원");
    expect(JSON.stringify(report)).not.toContain("\"A1\"");
    expect(report.solutionCards).toHaveLength(4);
    expect(report.solutionCards.map((card) => card.categoryKo)).toContain("사진·드레스·메이크업 선택");
    expect(text).toContain("쓸 수 있는 돈과 마음에 드는 느낌");
    for (const word of BANNED_PUBLIC_WORDS) {
      expect(text).not.toContain(word);
    }
  });

  it("응답이 부족한 커플 비교는 퍼센트 대신 부족하다고 말한다", () => {
    const report = buildWeddingCodeV05CoupleReport(scoreWeddingCodeV05({ A1: "A" }), scoreWeddingCodeV05({ A1: "B" }));

    expect(report.overlapScore).toBeNull();
    expect(report.scenarioCards).toHaveLength(0);
    expect(report.solutionCards).toHaveLength(0);
    expect(report.overlapLabelKo).toContain("부족");
    expect(report.disclaimerKo).toContain("좋고 나쁨");
    expect(flattenText(report)).not.toContain("궁합");
  });

  it("역할 분담 카피는 무엇을 나눠 보는지 구체적인 예를 든다", () => {
    const b3 = WEDDING_CODE_V05_QUESTIONS.find((question) => question.key === "B3");
    const option = b3?.options.find((candidate) => candidate.value === "A");
    const report = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05({
      B1: "B",
      B2: "C",
      B3: "A",
      B4: "B",
      D2: "D",
      D3: "C",
    }));
    const preparationMode = report.axisReports.find((axis) => axis.key === "preparationMode");

    expect(option?.label).toBe("가격·위치·사진처럼 각자 잘 보는 항목을 나눠 맡는다");
    expect(preparationMode?.summaryKo).toContain("가격·위치·사진처럼");
  });

  it("모든 축이 높게 겹치면 쉬운 지점을 먼저 맞출 부분으로 중복 경고하지 않는다", () => {
    const sameAnswers = allA();
    const report = buildWeddingCodeV05CoupleReport(
      scoreWeddingCodeV05(sameAnswers),
      scoreWeddingCodeV05(sameAnswers),
      { firstAnswers: sameAnswers, secondAnswers: sameAnswers }
    );

    expect(report.easyPoints.length).toBeGreaterThan(0);
    expect(report.easyPoints.every((axis) => axis.overlapScore >= 75)).toBe(true);
    expect(report.talkFirst).toBeNull();
    expect(report.guideKo).not.toContain("점수");
  });

  it("모든 축의 겹침이 낮으면 상대적 상위 축을 쉬운 지점이라고 부르지 않는다", () => {
    const firstAnswers = answersFromSequence("CACBDDCACCBBBBBB");
    const secondAnswers = answersFromSequence("DBDABCDBDBACCDBC");
    const report = buildWeddingCodeV05CoupleReport(
      scoreWeddingCodeV05(firstAnswers),
      scoreWeddingCodeV05(secondAnswers)
    );

    expect(report.solutionCards.every((card) => card.overlapScore < 75)).toBe(true);
    expect(report.easyPoints).toEqual([]);
    expect(report.talkFirst).not.toBeNull();
  });
});
