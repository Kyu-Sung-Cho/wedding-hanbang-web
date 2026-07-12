import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V05_QUESTIONS,
  type WeddingCodeV05AxisSide,
  type WeddingCodeV05OptionValue,
} from "@/constants/weddingCodeV05";
import { buildWeddingCodeV05IndividualReport } from "../report";
import { scoreWeddingCodeV05, type WeddingCodeV05Answers } from "../score";

const BANNED_PUBLIC_WORDS = [
  "궁합",
  "적합도",
  "결혼 성공",
  "성공률",
  "이혼",
  "갈등 위험",
  "희귀",
  "신뢰도",
  "정확도",
  "핵심 축",
  "감정 싸움이 줄",
  "후회가 줄",
];

function answerForSide(
  question: (typeof WEDDING_CODE_V05_QUESTIONS)[number],
  side: WeddingCodeV05AxisSide
): WeddingCodeV05OptionValue {
  return question.options.find((option) => option.side === side)!.value;
}

function answersWithPattern(leftChoicesPerAxis: number): WeddingCodeV05Answers {
  const seen = new Map<string, number>();
  return Object.fromEntries(
    WEDDING_CODE_V05_QUESTIONS.map((question) => {
      const index = seen.get(question.axis) ?? 0;
      seen.set(question.axis, index + 1);
      const side = index < leftChoicesPerAxis ? "left" : "right";
      return [question.key, answerForSide(question, side)];
    })
  ) as WeddingCodeV05Answers;
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}

describe("WeddingCode candidate.10 individual report", () => {
  it("네 축 모두 선택 횟수를 그대로 보여주고 사람의 고정 특성으로 확대하지 않는다", () => {
    const report = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(3)));

    expect(report.axisReports).toHaveLength(4);
    for (const axis of report.axisReports) {
      expect(axis.leftCount).toBe(3);
      expect(axis.rightCount).toBe(1);
      expect(axis.summaryKo).toContain("4개 장면 중 3개");
      expect(axis.summaryKo).not.toContain("편이에요");
    }
    expect(report.subtitleKo).toContain("고른 횟수 그대로");
    expect(report.disclaimerKo).toContain("베타");
    expect(report.disclaimerKo).toContain("진단하거나 예측하지");
  });

  it("2:2 결과를 억지로 한쪽 유형에 넣지 않고 공유 요약에도 상황 의존성을 남긴다", () => {
    const report = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(2)));

    expect(report.axisReports.every((axis) => axis.responsePattern === "mixed")).toBe(true);
    expect(report.shareSummaryKo).toBe(
      "조건·장면 2:2 · 같이·분담 2:2 · 둘·주변 2:2 · 마음·할 일 2:2"
    );
    expect(report.shareSummaryKo.split(" · ")).toHaveLength(4);
  });

  it("공유 요약은 네 시작점만 담고 개별 비용·가족 갈등 응답을 노출하지 않는다", () => {
    const report = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(4)));

    expect(report.shareSummaryKo).toBe(
      "조건 먼저 4/4 · 같이 맞춤 4/4 · 둘의 기준 먼저 4/4 · 마음 먼저 4/4"
    );
    expect(report.sharePromptKo).toContain("너는");
    expect(report.shareNoteKo).toContain("16개 가상 장면");
    expect(report.shareNoteKo).toContain("진단이 아니");
    expect(report.shareSummaryKo).not.toMatch(/원|만원|부모|가족|업체|취소/);
  });

  it("공유에서도 3:1과 4:0을 같은 유형 라벨로 뭉개지 않고 실제 횟수를 남긴다", () => {
    const leaning = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(3)));
    const consistent = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(4)));

    expect(leaning.shareSummaryKo).toContain("3/4");
    expect(consistent.shareSummaryKo).toContain("4/4");
    expect(leaning.shareSummaryKo).not.toBe(consistent.shareSummaryKo);
  });

  it("안전한 예약 확인 카드는 위험 성향 점수 없이 모든 결과에 똑같이 제공한다", () => {
    const leftReport = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(4)));
    const rightReport = buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(0)));

    expect(leftReport.actionCards).toEqual(rightReport.actionCards);
    expect(leftReport.actionCards.map((card) => card.id)).toContain("contract_check");
    expect(flattenText(leftReport.actionCards)).toContain("총금액, 추가 비용, 취소 조건");
  });

  it("대화 카드는 응답 강도나 배열의 첫 축을 자동 우선하지 않는다", () => {
    const reports = [0, 2, 3, 4].map((leftCount) =>
      buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(leftCount)))
    );

    for (const report of reports) expect(report.talkStarters).toEqual(reports[0].talkStarters);
    expect(flattenText(reports[0].talkStarters)).toContain("각자 고르고");
    expect(flattenText(reports[0].talkStarters)).not.toContain("가장 자주");
  });

  it("금지된 진단·정밀도·인과 표현을 공개 결과에 쓰지 않는다", () => {
    for (const leftCount of [0, 2, 3, 4]) {
      const text = flattenText(
        buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(leftCount)))
      );
      for (const word of BANNED_PUBLIC_WORDS) expect(text).not.toContain(word);
      expect(text).not.toContain("%");
    }
  });
});
