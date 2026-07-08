import { describe, expect, it } from "vitest";
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

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}

describe("WeddingCode v0.5 result copy", () => {
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
    const report = buildWeddingCodeV05CoupleReport(scoreWeddingCodeV05(allA()), scoreWeddingCodeV05(allD()));
    const text = flattenText(report);

    expect(report.titleKo).toContain("준비 방식 겹침도");
    expect(report.overlapScore).not.toBeNull();
    expect(report.easyPoints.length).toBeGreaterThan(0);
    expect(report.talkFirst).not.toBeNull();
    expect(report.solutionCards).toHaveLength(4);
    expect(report.solutionCards.map((card) => card.categoryKo)).toContain("드레스·스튜디오 선택");
    expect(text).toContain("예산선과 마음에 드는 장면");
    for (const word of BANNED_PUBLIC_WORDS) {
      expect(text).not.toContain(word);
    }
  });

  it("응답이 부족한 커플 비교는 퍼센트 대신 부족하다고 말한다", () => {
    const report = buildWeddingCodeV05CoupleReport(scoreWeddingCodeV05({ A1: "A" }), scoreWeddingCodeV05({ A1: "B" }));

    expect(report.overlapScore).toBeNull();
    expect(report.solutionCards).toHaveLength(0);
    expect(report.overlapLabelKo).toContain("부족");
    expect(report.disclaimerKo).toContain("결혼 결과");
    expect(flattenText(report)).not.toContain("궁합");
  });
});
