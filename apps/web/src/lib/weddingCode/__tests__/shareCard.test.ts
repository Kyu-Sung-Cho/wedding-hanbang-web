import { describe, expect, it } from "vitest";
import {
  approxMeasure, wrapText, layoutQuote, computeQuoteTop,
  CARD_W, CARD_H, CARD_PAD, QUOTE_MARK_SPACE,
} from "../shareCard";
import { WC_QUOTE_TEXTS, WC_FACTS, pickTalkCard, WC_TALK_DEFAULT, WC_CARD_DEFS } from "@/constants/weddingCodeResult";
import { WC_QUESTIONS } from "@/constants/weddingCodeForm";

const MAX_WIDTH = CARD_W - CARD_PAD * 2;

describe("공유 카드 레이아웃 — 후보 문장 16종 전수 (승인 반영사항 3)", () => {
  const allQuotes = Object.entries(WC_QUOTE_TEXTS).flatMap(([q, opts]) =>
    Object.entries(opts).map(([opt, text]) => ({ id: `${q}-${opt}`, text }))
  );

  it("후보 문장이 정확히 16종이다 (q01·q05·q13·q11 × A~D)", () => {
    expect(allQuotes).toHaveLength(16);
  });

  it("16종 전부 6줄 이내로 레이아웃된다 (오버플로 0)", () => {
    for (const { id, text } of allQuotes) {
      const layout = layoutQuote(text, MAX_WIDTH, approxMeasure);
      expect(layout.lines.length, `${id} 줄 수`).toBeLessThanOrEqual(6);
      for (const line of layout.lines) {
        expect(approxMeasure(line, layout.fontSize), `${id} 줄 폭: "${line}"`).toBeLessThanOrEqual(MAX_WIDTH);
      }
    }
  });

  it("수동 개행(\\n)이 그대로 보존된다 — 의미 단위가 쪼개지지 않음 (패치 2)", () => {
    for (const { id, text } of allQuotes) {
      const manual = text.split("\n");
      expect(manual.length, `${id} 수동 개행 존재`).toBeGreaterThan(1);
      const layout = layoutQuote(text, MAX_WIDTH, approxMeasure);
      expect(layout.lines, `${id} 수동 줄 보존`).toEqual(manual);
    }
  });

  it("세로 균형 — 인용 블록이 광학 중심(45%)에 오고 경계를 침범하지 않는다 (패치 1)", () => {
    const scenarioBottom = 228; // 상황줄 1줄 기준
    for (const { id, text } of allQuotes) {
      const layout = layoutQuote(text, MAX_WIDTH, approxMeasure);
      const blockHeight = layout.lines.length * Math.round(layout.fontSize * 1.42);
      for (const hasFact of [true, false]) {
        const top = computeQuoteTop({ blockHeight, scenarioBottom, hasFact });
        // 위 경계: 상황줄+인용부호 아래
        expect(top, `${id} 위 경계`).toBeGreaterThanOrEqual(scenarioBottom + QUOTE_MARK_SPACE + 40);
        // 아래 경계: 팩트/브랜드 블록 침범 금지
        const bottomBound = (hasFact ? CARD_H - 460 : CARD_H - 260) - 80;
        expect(top + blockHeight, `${id} 아래 경계`).toBeLessThanOrEqual(bottomBound);
        // 짧은 블록(2줄)은 중심이 45%±15% 안에
        if (layout.lines.length <= 3) {
          const center = top + blockHeight / 2;
          expect(Math.abs(center - CARD_H * 0.45), `${id} 광학 중심`).toBeLessThanOrEqual(CARD_H * 0.15);
        }
      }
    }
  });

  it("computeQuoteTop — 초대형 블록은 위 기준으로 클램프(내용 우선)", () => {
    const top = computeQuoteTop({ blockHeight: 1400, scenarioBottom: 228, hasFact: true });
    expect(top).toBe(228 + QUOTE_MARK_SPACE + 40);
  });

  it("팩트 문구 4종도 38px에서 4줄 이내", () => {
    for (const fact of Object.values(WC_FACTS)) {
      const lines = wrapText(fact.text, MAX_WIDTH, 38, approxMeasure);
      expect(lines.length, fact.id).toBeLessThanOrEqual(4);
    }
  });

  it("비정상 초장문도 자동 축소로 폭을 넘지 않는다 (안전장치)", () => {
    const long = "아주 ".repeat(60) + "긴 문장입니다";
    const layout = layoutQuote(long, MAX_WIDTH, approxMeasure);
    for (const line of layout.lines) {
      expect(approxMeasure(line, layout.fontSize)).toBeLessThanOrEqual(MAX_WIDTH);
    }
  });

  it("wrapText: 공백 없는 초장 단어는 글자 단위로 쪼갠다", () => {
    const word = "가".repeat(40);
    const lines = wrapText(word, MAX_WIDTH, 84, approxMeasure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(approxMeasure(line, 84)).toBeLessThanOrEqual(MAX_WIDTH);
    }
  });
});

describe("카드 배정 무결성 (§2-B)", () => {
  it("카드 대상 문항의 모든 선택지에 1인칭 문장이 존재한다", () => {
    const targets = new Set<string>();
    for (const def of WC_CARD_DEFS) {
      targets.add(def.questionKey);
      if (def.fallback) targets.add(def.fallback.questionKey);
    }
    for (const qKey of targets) {
      const q = WC_QUESTIONS.find((item) => item.key === qKey);
      expect(q, qKey).toBeDefined();
      for (const opt of q!.options) {
        expect(WC_QUOTE_TEXTS[qKey]?.[opt.value], `${qKey}-${opt.value}`).toBeTruthy();
      }
    }
  });
});

describe("오늘의 대화 카드 매핑 (§5 — deterministic)", () => {
  it("우선순위: q09가 A/B면 q11이 A/B여도 q09 규칙 적용", () => {
    const text = pickTalkCard({ q09: "A", q11: "A" });
    expect(text).toContain("신호 하나");
  });

  it("q09 해당 없으면 q11 → q07 → q03 순서", () => {
    expect(pickTalkCard({ q09: "C", q11: "B" })).toContain("24시간 룰");
    expect(pickTalkCard({ q09: "C", q11: "C", q07: "A" })).toContain("포기 못 할 1가지");
    expect(pickTalkCard({ q09: "C", q11: "C", q07: "C", q03: "D" })).toContain("오늘 저녁 질문");
  });

  it("어느 규칙에도 안 걸리면 default", () => {
    expect(pickTalkCard({ q09: "C", q11: "C", q07: "C", q03: "B" })).toBe(WC_TALK_DEFAULT);
    expect(pickTalkCard({})).toBe(WC_TALK_DEFAULT);
  });
});
