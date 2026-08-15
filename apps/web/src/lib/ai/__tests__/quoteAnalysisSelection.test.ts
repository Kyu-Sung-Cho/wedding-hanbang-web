import { describe, expect, it } from "vitest";
import {
  bindCanonicalQuoteAnalysisInput,
  buildCanonicalQuoteAnalysisMessage,
  getVisibleQuoteAnalysisMessage,
  parseCanonicalQuoteAnalysisSelection,
} from "@/lib/ai/quoteAnalysisSelection";
import { getQuoteCheckItems } from "@/lib/amora/quoteCheck";
import { QUOTE_ANALYSIS_REOPEN_FALLBACK } from "@hanbang/shared/quote-analysis-presentation";

const studioIds = getQuoteCheckItems("studio", "seoul").map((item) => item.id);
const validMessage = buildCanonicalQuoteAnalysisMessage({
  category: "studio",
  region: "seoul",
  quotePriceManwon: 300,
  vendorName: "테스트 스튜디오",
  includedItemIds: studioIds.slice(0, 2),
  notNeededItemIds: studioIds.slice(2, 3),
  unknownItemIds: studioIds.slice(3),
});

describe("canonical quote analysis selection", () => {
  it("removes every provider-invented selection when the canonical user message has no tag", () => {
    const selection = parseCanonicalQuoteAnalysisSelection("이 견적 봐줘");

    expect(selection).toEqual({
      status: "absent",
      includedItems: [],
      notNeededItems: [],
      unknownItems: [],
      checklistConfirmed: false,
    });
    expect(bindCanonicalQuoteAnalysisInput({
      included_items: ["모델이 지어낸 포함 항목"],
      not_needed_items: ["모델이 지어낸 불필요 항목"],
      checklist_confirmed: true,
    }, selection)).toMatchObject({
      included_items: [],
      not_needed_items: [],
      checklist_confirmed: false,
    });
  });

  it("overwrites both arrays and confirmation with the exact valid user payload", () => {
    const selection = parseCanonicalQuoteAnalysisSelection(validMessage);

    expect(selection).toEqual({
      status: "valid",
      category: "studio",
      region: "seoul",
      includedItems: studioIds.slice(0, 2),
      notNeededItems: studioIds.slice(2, 3),
      unknownItems: studioIds.slice(3),
      checklistConfirmed: true,
      quotePriceManwon: 300,
      vendorName: "테스트 스튜디오",
    });
    expect(bindCanonicalQuoteAnalysisInput({
      included_items: ["provider included"],
      not_needed_items: ["provider excluded"],
      checklist_confirmed: false,
      quote_price: 999,
      vendor_name: "provider vendor",
      category: "dress",
      region: "busan",
    }, selection)).toMatchObject({
      included_items: studioIds.slice(0, 2),
      not_needed_items: studioIds.slice(2, 3),
      checklist_confirmed: true,
      quote_price: 300,
      vendor_name: "테스트 스튜디오",
      category: "studio",
      region: "seoul",
    });
  });

  it.each([
    `${validMessage}\n${validMessage}`,
    `[quote_analysis] 견적 300만원 (테스트) 항목 상태:\n포함: 없음\n이용 안 함: 없음\n확인 필요: 없음`,
    `[quote_analysis_v2]\n${"가".repeat(8_200)}\n[/quote_analysis_v2]`,
  ])("fails closed for duplicate, legacy, malformed, or oversized canonical input", (message) => {
    expect(parseCanonicalQuoteAnalysisSelection(message)).toEqual({
      status: "invalid",
      includedItems: [],
      notNeededItems: [],
      unknownItems: [],
      checklistConfirmed: false,
    });
  });

  it.each([
    {
      ...JSON.parse(validMessage.split("\n")[2]),
      category: "dress",
    },
    {
      ...JSON.parse(validMessage.split("\n")[2]),
      states: {
        included: [studioIds[0], "forged_item"],
        notNeeded: studioIds.slice(2, 3),
        unknown: studioIds.slice(3),
      },
    },
    {
      ...JSON.parse(validMessage.split("\n")[2]),
      states: {
        included: studioIds.slice(0, 2),
        notNeeded: studioIds.slice(2, 3),
        unknown: studioIds.slice(4),
      },
    },
    {
      ...JSON.parse(validMessage.split("\n")[2]),
      states: {
        included: studioIds.slice(0, 2),
        notNeeded: [studioIds[1], studioIds[2]],
        unknown: studioIds.slice(3),
      },
    },
  ])("rejects a forged, partial, duplicate, or header-mismatched v2 partition", (payload) => {
    const message = `${validMessage.split("\n")[0]}\n[quote_analysis_v2]\n${JSON.stringify(payload)}\n[/quote_analysis_v2]`;
    expect(parseCanonicalQuoteAnalysisSelection(message).status).toBe("invalid");
  });

  it("shows only the human header and never leaks a malformed machine block", () => {
    expect(getVisibleQuoteAnalysisMessage(validMessage)).toBe(validMessage.split("\n")[0]);
    expect(getVisibleQuoteAnalysisMessage("안내\n[quote_analysis_v2]\n{secret}\n[/quote_analysis_v2]"))
      .toBe(QUOTE_ANALYSIS_REOPEN_FALLBACK);
  });
});
