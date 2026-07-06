import { describe, expect, it } from "vitest";
import { approxMeasure, wrapText, layoutQuote } from "../shareCard";
import { WC_QUOTE_TEXTS, WC_FACTS, pickTalkCard, WC_TALK_DEFAULT, WC_CARD_DEFS } from "@/constants/weddingCodeResult";
import { WC_QUESTIONS } from "@/constants/weddingCodeForm";

// 카드 캔버스 규격 (shareCard.ts와 동일)
const CARD_W = 1080;
const PAD = 96;
const MAX_WIDTH = CARD_W - PAD * 2;

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
