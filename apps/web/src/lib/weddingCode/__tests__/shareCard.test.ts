import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V05_QUESTIONS,
  type WeddingCodeV05AxisSide,
} from "@/constants/weddingCodeV05";
import { buildWeddingCodeV05IndividualReport } from "../report";
import { scoreWeddingCodeV05, type WeddingCodeV05Answers } from "../score";
import {
  approxMeasure,
  wrapText,
  layoutQuote,
  computeQuoteTop,
  CARD_W,
  CARD_H,
  CARD_PAD,
  QUOTE_MARK_SPACE,
} from "../shareCard";

const MAX_WIDTH = CARD_W - CARD_PAD * 2;

function answersWithPattern(leftChoicesPerAxis: number): WeddingCodeV05Answers {
  const seen = new Map<string, number>();
  return Object.fromEntries(
    WEDDING_CODE_V05_QUESTIONS.map((question) => {
      const index = seen.get(question.axis) ?? 0;
      seen.set(question.axis, index + 1);
      const side: WeddingCodeV05AxisSide = index < leftChoicesPerAxis ? "left" : "right";
      return [question.key, question.options.find((option) => option.side === side)!.value];
    })
  ) as WeddingCodeV05Answers;
}

const CURRENT_SHARE_QUOTES = [0, 2, 3, 4].map((leftCount) =>
  buildWeddingCodeV05IndividualReport(scoreWeddingCodeV05(answersWithPattern(leftCount))).shareSummaryKo
);

describe("웨딩코드 현재 결과 공유 카드 레이아웃", () => {
  it("현행 4개 대표 결과 문장이 폭과 6줄 한계를 넘지 않는다", () => {
    for (const quote of CURRENT_SHARE_QUOTES) {
      const layout = layoutQuote(quote, MAX_WIDTH, approxMeasure);
      expect(layout.lines.length, quote).toBeLessThanOrEqual(6);
      for (const line of layout.lines) {
        expect(approxMeasure(line, layout.fontSize), line).toBeLessThanOrEqual(MAX_WIDTH);
      }
    }
  });

  it("현재 공유 카드 안내와 URL이 4줄 안에 들어간다", () => {
    const text = "너는 결혼 준비에서 무엇부터 시작해?\nhanbang.ai/wedding-code";
    const lines = wrapText(text, MAX_WIDTH, 38, approxMeasure);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines.join(" ")).toContain("hanbang.ai/wedding-code");
  });

  it("인용 블록이 상황 줄과 하단 안내를 침범하지 않는다", () => {
    const scenarioBottom = 228;
    for (const quote of CURRENT_SHARE_QUOTES) {
      const layout = layoutQuote(quote, MAX_WIDTH, approxMeasure);
      const blockHeight = layout.lines.length * Math.round(layout.fontSize * 1.42);
      const top = computeQuoteTop({ blockHeight, scenarioBottom, hasFact: true });
      expect(top).toBeGreaterThanOrEqual(scenarioBottom + QUOTE_MARK_SPACE + 40);
      expect(top + blockHeight).toBeLessThanOrEqual(CARD_H - 540);
    }
  });

  it("비정상 초장문과 공백 없는 단어도 폭을 넘지 않는다", () => {
    const long = "아주 ".repeat(60) + "긴 문장입니다";
    const layout = layoutQuote(long, MAX_WIDTH, approxMeasure);
    for (const line of layout.lines) {
      expect(approxMeasure(line, layout.fontSize)).toBeLessThanOrEqual(MAX_WIDTH);
    }

    const word = "가".repeat(40);
    const lines = wrapText(word, MAX_WIDTH, 84, approxMeasure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(approxMeasure(line, 84)).toBeLessThanOrEqual(MAX_WIDTH);
  });
});
