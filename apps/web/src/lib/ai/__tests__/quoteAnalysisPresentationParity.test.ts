import { describe, expect, it } from "vitest";
import {
  QUOTE_ANALYSIS_REOPEN_FALLBACK,
  getQuoteAnalysisExpectedItemIds,
  getQuoteAnalysisMessagePresentation,
} from "@hanbang/shared/quote-analysis-presentation";
import { getQuoteCheckItems } from "@/lib/amora/quoteCheck";
import {
  buildCanonicalQuoteAnalysisMessage,
  parseCanonicalQuoteAnalysisSelection,
} from "@/lib/ai/quoteAnalysisSelection";

const ids = getQuoteCheckItems("studio", "seoul").map((item) => item.id);
const valid = buildCanonicalQuoteAnalysisMessage({
  category: "studio",
  region: "seoul",
  quotePriceManwon: 300,
  vendorName: "테스트 스튜디오",
  includedItemIds: ids.slice(0, 2),
  notNeededItemIds: ids.slice(2, 3),
  unknownItemIds: ids.slice(3),
});
const validLines = valid.split("\n");
const validPayload = JSON.parse(validLines[2]) as {
  states: { included: string[]; notNeeded: string[]; unknown: string[] };
};

function withPayload(payload: unknown): string {
  return `${validLines[0]}\n[quote_analysis_v2]\n${JSON.stringify(payload)}\n[/quote_analysis_v2]`;
}

const invalidCorpus = [
  `[quote_analysis] 견적 300만원 (테스트 스튜디오) 항목 상태:\n포함: 야외 촬영\n이용 안 함: 없음\n확인 필요: 없음`,
  `안내\n[quote_analysis_v2]\n{raw-secret}\n[/quote_analysis_v2]`,
  withPayload({
    ...validPayload,
    states: { ...validPayload.states, included: [...validPayload.states.included, "forged_item"] },
  }),
  withPayload({
    ...validPayload,
    states: { ...validPayload.states, unknown: validPayload.states.unknown.slice(1) },
  }),
  withPayload({
    ...validPayload,
    states: {
      ...validPayload.states,
      notNeeded: [...validPayload.states.notNeeded, validPayload.states.included[0]],
    },
  }),
];

describe("shared quote analysis presentation parity", () => {
  it.each(["studio", "dress", "makeup", "sdm_package"] as const)(
    "keeps the shared %s full-partition registry equal to the web checklist source",
    (category) => {
      expect(getQuoteAnalysisExpectedItemIds(category)).toEqual(
        getQuoteCheckItems(category, "seoul").map((item) => item.id),
      );
    },
  );

  it.each(["studio", "dress", "makeup", "sdm_package"] as const)(
    "accepts the canonical web-built %s v2 message in the shared presentation validator",
    (category) => {
      const categoryIds = getQuoteCheckItems(category, "seoul").map((item) => item.id);
      const message = buildCanonicalQuoteAnalysisMessage({
        category,
        region: "seoul",
        quotePriceManwon: 300,
        vendorName: "테스트 업체",
        includedItemIds: categoryIds.slice(0, 1),
        notNeededItemIds: categoryIds.slice(1, 2),
        unknownItemIds: categoryIds.slice(2),
      });
      expect(getQuoteAnalysisMessagePresentation(message)).toEqual({
        kind: "valid_v2",
        text: message.split("\n")[0],
      });
    },
  );

  it("shows only the exact valid v2 human header", () => {
    const presentation = getQuoteAnalysisMessagePresentation(valid);
    expect(presentation).toEqual({ kind: "valid_v2", text: validLines[0] });
    expect(parseCanonicalQuoteAnalysisSelection(valid).status).toBe("valid");
    expect(presentation.text).not.toContain("quote_analysis_v2");
    expect(presentation.text).not.toContain("vendorName");
  });

  it.each(invalidCorpus)(
    "maps legacy, malformed, forged, partial, and duplicate contexts to one fixed fallback",
    (message) => {
      expect(parseCanonicalQuoteAnalysisSelection(message).status).toBe("invalid");
      expect(getQuoteAnalysisMessagePresentation(message)).toEqual({
        kind: "fallback",
        text: QUOTE_ANALYSIS_REOPEN_FALLBACK,
      });
      expect(QUOTE_ANALYSIS_REOPEN_FALLBACK).not.toMatch(/raw-secret|forged_item|야외 촬영/u);
    },
  );

  it("keeps ordinary chat text unchanged", () => {
    expect(getQuoteAnalysisMessagePresentation("일반 대화예요")).toEqual({
      kind: "plain",
      text: "일반 대화예요",
    });
  });
});
