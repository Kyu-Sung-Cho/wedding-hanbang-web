import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPdfLayoutTextEvidence,
  type PdfPositionedTextItem,
} from "../convert.js";
import { extractDisclosureFromLocalEvidence } from "../local-extract.js";
import { decodeEvidenceQuote } from "../merge-evidence.js";
import { findCoverageGaps } from "../validate.js";

const SOURCE_FILE_ID = "f".repeat(64);

function row(y: number, items: Array<[text: string, x: number]>): PdfPositionedTextItem[] {
  return items.map(([text, x]) => ({
    text,
    x,
    y,
    width: Math.max(5, [...text].length * 5),
    height: 9,
  }));
}

function extract(text: string, canonicalName: string) {
  return extractDisclosureFromLocalEvidence({
    canonicalName,
    regionCode: "test-region",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });
}

function evidenceFragments(sourceQuote: string): string[] {
  const decoded = decodeEvidenceQuote(sourceQuote);
  if (decoded.kind === "single") return [decoded.quote];
  if (decoded.kind === "merged") return decoded.fragments.map(({ quote }) => quote);
  return [];
}

test("an explicit cross-item PDF meal range is structured with both exact locators", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["□", 57], ["라부쏠라", 78]]),
      ...row(760, [["① 가격 (VAT 포함)", 57]]),
      ...row(740, [["구분", 84], ["세부", 168], ["내용", 195], ["제공", 272], ["금액", 299], ["(VAT", 321], ["포함)", 351], ["비고", 451]]),
      ...row(720, [["식대", 84], ["성인", 143], ["기준", 170], ["1", 198], ["인", 204], ["식사", 221], ["83,000", 269], ["원", 304], ["~", 320], ["88,000", 334], ["원", 370]]),
    ],
  }]).combinedText;

  const extraction = extract(text, "라부쏠라");
  const option = extraction.halls.flatMap(({ options }) => options).find((candidate) => (
    candidate.price_min_krw === 83_000 && candidate.price_max_krw === 88_000
  ));

  assert.ok(option);
  const fragments = evidenceFragments(option.source_quote);
  assert.ok(fragments.some((fragment) => fragment.includes("pdf:page:1:row:4:item:7:money:1")));
  assert.ok(fragments.some((fragment) => fragment.includes("pdf:page:1:row:4:item:10:money:1")));
  assert.deepEqual(findCoverageGaps(text, extraction, { includeAuditLedger: false }), []);
});

test("a row-spanning PDF hall identity owns exact meal rows above and below its text anchor", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(800, [["□ 여수마리나웨딩홀", 70]]),
      ...row(780, [["예식홀명", 70], ["식비", 200], ["대관료, 장식비", 380]]),
      ...row(760, [["* 대관: 마리나 패키지이용시 무료", 310]]),
      ...row(740, [["기본 150명", 160], [": 51,000", 205]]),
      ...row(720, [["추가 1명당", 160], [": 51,000", 205]]),
      ...row(700, [["* 외부패키지 이용시 대관료", 310]]),
      ...row(680, [["오페라홀", 70]]),
      ...row(660, [["1,800,000원 (원판포함가격)", 310]]),
      ...row(640, [["200명 이상", 160], [": 50,000원", 205]]),
      ...row(620, [["추가 1명당", 160], [": 50,000원", 205]]),
      ...row(600, [["선택품목 가격", 300]]),
    ],
  }]).combinedText;

  const extraction = extract(text, "여수마리나웨딩홀");
  const opera = extraction.halls.find(({ hall_name }) => hall_name === "오페라홀");

  assert.ok(opera);
  const baseMeal = opera.options.find((option) => (
    option.price_min_krw === 51_000 && option.raw_text.includes("기본 150명")
  ));
  assert.ok(baseMeal);
  assert.ok(evidenceFragments(baseMeal.source_quote).some((fragment) => (
    fragment.includes("pdf:page:1:row:4:item:2:money:1")
  )));
  assert.equal(
    extraction.halls
      .filter(({ hall_name }) => hall_name !== "오페라홀")
      .flatMap(({ options }) => options)
      .some(({ price_min_krw }) => price_min_krw === 51_000),
    false,
  );
});

test("an exact A-hall row in a PDF option table owns its adjacent officiant price", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(800, [["모나밸리 웨딩홀", 70]]),
      ...row(780, [["예식홀명", 70], ["식비", 210], ["대관료, 장식비", 390]]),
      ...row(760, [["기본 200명 69,000원", 170], ["대관 5,500,000원", 390]]),
      ...row(740, [["아레나홀", 70]]),
      ...row(720, [["선택품목 가격", 300]]),
      ...row(700, [["예식홀명", 70]]),
      ...row(680, [["폐백", 130], ["식음료 추가", 175], ["장식 추가", 235], ["기타옵션", 460]]),
      ...row(660, [["A홀", 80], ["식대비", 175], ["플라워추가시", 235]]),
      ...row(640, [["-", 140], ["-", 300], ["본식사회자 원", 425], ["350,000", 485]]),
      ...row(620, [["B홀", 80], ["포함", 175], ["1,000,000원", 235]]),
      ...row(600, [["계약해지에 따른 위약금 및 환급", 70]]),
    ],
  }]).combinedText;

  const extraction = extract(text, "모나밸리 웨딩홀");
  const hallA = extraction.halls.find(({ hall_name }) => hall_name?.replace(/\s+/gu, "") === "A홀");
  const officiant = hallA?.options.find(({ price_min_krw }) => price_min_krw === 350_000);

  assert.ok(officiant);
  assert.match(officiant.name, /본식사회자/u);
  assert.ok(evidenceFragments(officiant.source_quote).some((fragment) => (
    fragment.includes("pdf:page:1:row:9:item:4:money:1")
  )));
});

test("a price before two equally plausible PDF hall identities remains unstructured", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["예식홀명", 70], ["식비", 200]]),
      ...row(760, [["기본", 160], ["51,000원", 205]]),
      ...row(740, [["A홀", 70]]),
      ...row(720, [["B홀", 70]]),
      ...row(700, [["계약해지", 70]]),
    ],
  }]).combinedText;

  const extraction = extract(text, "모호한웨딩홀");
  assert.equal(
    extraction.halls.flatMap(({ options }) => options).some(({ price_min_krw }) => price_min_krw === 51_000),
    false,
  );
  assert.ok(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length <= 1);
});
