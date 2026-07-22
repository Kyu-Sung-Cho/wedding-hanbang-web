import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPdfLayoutTextEvidence,
  type PdfPositionedTextItem,
} from "../convert.js";
import { extractDisclosureFromLocalEvidence } from "../local-extract.js";
import { projectCanonicalPdfLayoutMoney } from "../pdf-layout-evidence.js";
import { findCoverageGaps, scanSourceMoneyOccurrences } from "../validate.js";

function row(y: number, items: Array<[text: string, x: number]>): PdfPositionedTextItem[] {
  return items.map(([text, x]) => ({ text, x, y, width: 70, height: 9 }));
}

test("canonical PDF price columns recover bare money by exact row and item without scanning quantities", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(720, [["선택품목", 70], ["금액", 310], ["비고", 470]]),
      ...row(700, [["액자 추가", 70], ["300,000", 310], ["200명 이상 · 20% 할인", 470]]),
    ],
  }]).combinedText;

  assert.deepEqual(scanSourceMoneyOccurrences(text).map(({ krw, source_locator }) => ({
    krw,
    source_locator,
  })), [{
    krw: 300_000,
    source_locator: "pdf:page:1:row:2:item:2:money:1",
  }]);
});

test("canonical PDF option columns require an adjacent aligned won token for split money", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(760, [["선택품목 가격", 260]]),
      ...row(740, [["예식홀명", 70], ["폐백", 310], ["비고", 470]]),
      ...row(720, [["가상 홀", 70], ["350,000", 310]]),
      ...row(710, [["원", 310]]),
      ...row(660, [["설명", 70], ["550,000", 310]]),
      ...row(620, [["단위 아님", 310]]),
    ],
  }]).combinedText;

  assert.deepEqual(scanSourceMoneyOccurrences(text).map(({ krw, source_locator }) => ({
    krw,
    source_locator,
  })), [{
    krw: 350_000,
    source_locator: "pdf:page:1:row:3:item:2:money:1",
  }]);
});

test("canonical PDF price bands join horizontally split numeric and currency items", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(740, [["사업자명", 70], ["기본가격", 180], ["비고", 470]]),
      ...row(720, [["가상 드레스", 70], ["(1,000,000 )", 180], ["원", 250], ["200명 이상", 470]]),
    ],
  }]).combinedText;

  assert.deepEqual(scanSourceMoneyOccurrences(text).map(({ krw, source_locator }) => ({
    krw,
    source_locator,
  })), [{
    krw: 1_000_000,
    source_locator: "pdf:page:1:row:2:item:2:money:1",
  }]);
});

test("canonical PDF price columns reject account and contact identifiers", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(740, [["항목", 70], ["금액", 310], ["비고", 470]]),
      ...row(720, [["계좌번호", 70], ["123,456,789", 310], ["입금 전 확인", 470]]),
      ...row(700, [["연락처", 70], ["010,123,456", 310], ["담당자", 470]]),
    ],
  }]).combinedText;

  assert.deepEqual(scanSourceMoneyOccurrences(text), []);
});

test("canonical PDF price columns fail closed for duplicate semantic headers", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(740, [["항목", 70], ["금액", 240], ["금액", 240]]),
      ...row(720, [["모호한 행", 70], ["300,000", 240]]),
    ],
  }]).combinedText;

  assert.deepEqual(scanSourceMoneyOccurrences(text), []);
});

test("canonical PDF grids recover unitless money only inside an exact split 금액 column", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(760, [["***** 선택사항 *****", 180]]),
      ...row(740, [["품", 60], ["목", 78], ["구", 170], ["성", 188], ["금", 270], ["액", 288], ["비", 350], ["고", 368]]),
      ...row(720, [["액자추가", 60], ["20R 사이즈", 170], ["300,000", 270]]),
      ...row(700, [["청첩장", 60], ["20% 할인 (200매 이상)", 170]]),
    ],
  }]).combinedText;

  assert.deepEqual(projectCanonicalPdfLayoutMoney(text).map((candidate) => ({
    krw: candidate.krw,
    locator: candidate.source_locator,
    condition: candidate.condition,
  })), [{
    krw: 300_000,
    locator: "pdf:page:1:row:3:item:3:money:1",
    condition: "액자추가\t20R 사이즈\t300,000",
  }]);
});

test("canonical PDF grids bind an exact split 만원 unit inside a composite 기본가격 header", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(760, [["주요 선택품목 가격", 300]]),
      ...row(740, [["사업자명   기본가격", 70], ["담당자 지정", 280], ["기타 옵션", 440]]),
      ...row(720, [["가상 업체", 70], ["본식 80", 145], ["만원", 180]]),
    ],
  }]).combinedText;

  assert.deepEqual(projectCanonicalPdfLayoutMoney(text).map((candidate) => ({
    raw: candidate.raw,
    krw: candidate.krw,
    locator: candidate.source_locator,
  })), [{
    raw: "80",
    krw: 800_000,
    locator: "pdf:page:1:row:3:item:2:money:1",
  }]);
});

test("canonical PDF policy rows preserve split 만원 occurrences without treating the week count as money", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(760, [["계약해지에 따른 위약금 및 환급에 관한 산정기준", 70]]),
      ...row(740, [
        ["촬영날 기준으로 주일전 취소시 위약금 만원 발생 연기시 만원", 90],
        ["1", 165],
        ["50", 260],
        ["40", 312],
      ]),
    ],
  }]).combinedText;

  assert.deepEqual(projectCanonicalPdfLayoutMoney(text).map((candidate) => ({
    raw: candidate.raw,
    krw: candidate.krw,
    locator: candidate.source_locator,
  })), [{
    raw: "50",
    krw: 500_000,
    locator: "pdf:page:1:row:2:item:3:money:1",
  }, {
    raw: "40",
    krw: 400_000,
    locator: "pdf:page:1:row:2:item:4:money:1",
  }]);
});

test("certified three-category PDF tables bind every occurrence to its exact vendor row", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["가상 웨딩 가격표", 70]]),
      ...row(760, [["1. 스튜디오 선택 품목", 70]]),
      ...row(740, [["구분", 120], ["기본가격", 235], ["야외", 313], ["/", 331], ["야간", 338], ["기타 옵션", 430]]),
      ...row(720, [["가상 스튜디오", 100], ["20페이지", 207], ["1,870,000", 248], ["원", 289]]),
      ...row(700, [["앨범 추가", 370], ["33,000", 491], ["원", 520]]),
      ...row(680, [["/300,000", 314]]),
      ...row(640, [["2. 드레스 선택 품목", 70]]),
      ...row(620, [["구분", 120], ["기본가격", 235], ["기타 옵션", 430]]),
      ...row(600, [["가상 드레스", 100], ["본식", 208], ["600,000", 248], ["원", 289]]),
      ...row(560, [["3. 메이크업 선택 품목", 70]]),
      ...row(540, [["구분", 120], ["기본가격", 235], ["기타 옵션", 430]]),
      ...row(520, [["가상 메이크업", 100], ["330,000", 248], ["원", 289]]),
    ],
  }]).combinedText;
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "가상 웨딩",
    regionCode: "test",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: "a".repeat(64), text }],
  });

  assert.deepEqual(extraction.partner_vendors.map(({ vendor_name, category }) => [
    vendor_name,
    category,
  ]), [
    ["가상 스튜디오", "studio"],
    ["가상 드레스", "dress"],
    ["가상 메이크업", "makeup"],
  ]);
  assert.equal(
    extraction.partner_vendors.reduce((sum, vendor) => sum + vendor.options.length, 0),
    5,
  );
  assert.deepEqual(findCoverageGaps(text, extraction, { includeAuditLedger: false }), []);
});

test("certified PDF hall grid additions remain separate exact options", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["가상 컨벤션 웨딩홀", 70]]),
      ...row(760, [["***** 선택사항 *****", 180]]),
      ...row(740, [["품", 70], ["목", 88], ["금", 310], ["액", 328]]),
      ...row(720, [["스냅", 70], ["300,000", 310]]),
      ...row(700, [["영상", 70], ["700,000", 310]]),
    ],
  }]).combinedText;
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "가상 컨벤션 웨딩홀",
    regionCode: "test",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: "b".repeat(64), text }],
  });

  assert.equal(extraction.halls.length, 1);
  assert.deepEqual(extraction.halls[0]!.options.map(({ price_min_krw }) => price_min_krw), [
    300_000,
    700_000,
  ]);
  assert.deepEqual(findCoverageGaps(text, extraction, { includeAuditLedger: false }), []);
});
