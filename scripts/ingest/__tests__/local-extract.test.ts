import assert from "node:assert/strict";
import test from "node:test";

import { extractDisclosureFromLocalEvidence } from "../local-extract.js";
import { findCoverageGaps, normalizeEvidenceText } from "../validate.js";

const SOURCE_FILE_ID = "1".repeat(64);

test("local extraction links an agency vendor, category, and price to exact XLSX cells", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "테스트웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 가격표",
        "가격표!A1: 테스트웨딩",
        "가격표!A2: 스튜디오 가격",
        "가격표!A3: 사업자명",
        "가격표!B3: 기본 촬영 가격",
        "가격표!A4: 햇살컴퍼니",
        "가격표!B4: 125만원",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.doc_kind, "partner_price_list");
  assert.equal(extraction.business_name, "테스트웨딩");
  assert.equal(extraction.region_hint, "seoul_gangnam3");
  assert.equal(extraction.partner_vendors.length, 1);
  assert.equal(extraction.partner_vendors[0]?.vendor_name, "햇살컴퍼니");
  assert.equal(extraction.partner_vendors[0]?.category, "studio");
  assert.equal(extraction.partner_vendors[0]?.needs_review, true);
  assert.match(extraction.partner_vendors[0]!.source_quote, /스튜디오/u);
  assert.match(extraction.partner_vendors[0]!.source_quote, /햇살컴퍼니/u);
  assert.deepEqual(
    extraction.partner_vendors[0]?.options.map((option) => option.price_min_krw),
    [1_250_000],
  );
  assert.equal(extraction.partner_vendors[0]?.options[0]?.name, "기본 촬영 가격");
  assert.match(extraction.partner_vendors[0]!.options[0]!.source_quote, /기본 촬영 가격/u);
  assert.match(extraction.partner_vendors[0]!.options[0]!.source_quote, /125만원/u);
  assert.equal(extraction.money_occurrences.length, 1);
  assert.equal(extraction.money_occurrences[0]?.source_quote, "가격표!B4: 125만원");
  assert.match(extraction.extraction_notes, /^\[local_evidence_guard\]/u);
});

test("category evidence never borrows the first vendor identity for later vendor rows", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "카테고리근거테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!A4: 첫번째스튜디오",
        "스튜디오!B4: 120만원",
        "스튜디오!A5: 두번째스튜디오",
        "스튜디오!B5: 140만원",
      ].join("\n"),
    }],
  });

  const second = extraction.partner_vendors.find(({ vendor_name }) => (
    vendor_name === "두번째스튜디오"
  ));
  assert.ok(second);
  assert.doesNotMatch(second.source_quote, /첫번째스튜디오/u);
  assert.doesNotMatch(second.options[0]!.source_quote, /첫번째스튜디오/u);
});

test("bare XLSX prices retain the exact unit, header, category, identity, and value cells", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "테스트웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 가격표",
        "가격표!A1: 금액 단위: 만원",
        "가격표!A2: 스튜디오 가격",
        "가격표!A3: 사업자명",
        "가격표!B3: 기본 촬영 가격",
        "가격표!A4: 햇살컴퍼니",
        "가격표!B4: 125",
      ].join("\n"),
    }],
  });

  const option = extraction.partner_vendors[0]?.options[0];
  assert.equal(option?.price_min_krw, 1_250_000);
  assert.match(option!.source_quote, /금액 단위: 만원/u);
  assert.match(option!.source_quote, /스튜디오 가격/u);
  assert.match(option!.source_quote, /햇살컴퍼니/u);
  assert.match(option!.source_quote, /기본 촬영 가격/u);
  assert.match(option!.source_quote, /가격표!B4: 125/u);
});

test("a shorter money token is quoted from its own cell segment, not a larger price", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "테스트웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!A4: 햇살컴퍼니",
        "스튜디오!B4: 패키지 250,000원~350,000원<br>추가 50,000원",
      ].join("\n"),
    }],
  });

  const option = extraction.partner_vendors[0]?.options.find(({ price_min_krw }) =>
    price_min_krw === 50_000
  );
  assert.ok(option);
  assert.match(option.source_quote, /추가 50,000원/u);
  assert.doesNotMatch(option.source_quote, /패키지 250,000원/u);
});

test("a later vendor never borrows the previous vendor price as its column header", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "테스트웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A2: 가격(단위: 만원)",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!A5: 첫번째스튜디오",
        "스튜디오!B5: 220~550",
        "스튜디오!A12: 두번째스튜디오",
        "스튜디오!B12: 220~330",
      ].join("\n"),
    }],
  });

  const second = extraction.partner_vendors[1]?.options[0];
  assert.equal(second?.name, "기본가격");
  assert.match(second!.source_quote, /스튜디오!B3: 기본가격/u);
  assert.doesNotMatch(second!.source_quote, /스튜디오!B5: 220~550/u);
});

test("local extraction keeps hall-level meal, venue, guarantee, and option prices separate", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "햇살예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 홀가격",
        "홀가격!A3: 예식홀명",
        "홀가격!B3: 식비",
        "홀가격!D3: 대관료, 장식비",
        "홀가격!F4: 폐백",
        "홀가격!A5: 햇살홀",
        "홀가격!B5: 기본 250명",
        "홀가격!C5: A메뉴 65,000원",
        "홀가격!E5: 대관 4,050,000원",
        "홀가격!F5: 폐백음식 216,000원",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.doc_kind, "hall_disclosure");
  assert.equal(extraction.halls.length, 1);
  assert.equal(extraction.halls[0]?.hall_name, "햇살홀");
  assert.equal(extraction.halls[0]?.guarantee_min, 250);
  assert.equal(extraction.halls[0]?.meal_price_min_krw, 65_000);
  assert.equal(extraction.halls[0]?.venue_fee_min_krw, 4_050_000);
  assert.deepEqual(
    extraction.halls[0]?.options.map((option) => option.price_min_krw),
    [216_000],
  );
  assert.equal(extraction.money_occurrences.length, 3);
});

test("hall aggregates keep field evidence while intermediate menu prices remain covered", () => {
  const text = [
    "## 시트: 홀가격",
    "홀가격!A3: 예식홀명",
    "홀가격!B3: 식비",
    "홀가격!A5: 햇살홀",
    "홀가격!B5: 기본 250명",
    "홀가격!C5: A메뉴 65,000원<br>B메뉴 75,000원<br>C메뉴 100,000원<br>답례품 55,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "햇살예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(
    [
      extraction.halls[0]?.meal_price_min_krw,
      extraction.halls[0]?.meal_price_max_krw,
    ],
    [55_000, 100_000],
  );
  assert.deepEqual(
    extraction.halls[0]?.options.map((option) => option.price_min_krw),
    [65_000, 75_000],
  );
  assert.match(extraction.halls[0]!.source_quote, /55,000원/u);
  assert.match(extraction.halls[0]!.source_quote, /100,000원/u);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("local extraction records policy money as a review-only section without a coverage gap", () => {
  const text = [
    "## 시트: 가격표",
    "가격표!A1: 테스트웨딩",
    "가격표!A2: 드레스 가격",
    "가격표!A3: 사업자명",
    "가격표!B3: 기본가격",
    "가격표!A4: 햇살드레스",
    "가격표!B4: 본식 150만원",
    "가격표!A10: 계약해지에 따른 위약금 및 환불규정",
    "가격표!A11: 고객 사정으로 취소하면 위약금 20만원을 부담합니다.",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "테스트웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.equal(extraction.sections.length, 1);
  assert.equal(extraction.sections[0]?.section_type, "penalty");
  assert.equal(extraction.sections[0]?.needs_review, true);
  assert.equal(extraction.money_occurrences.length, 2);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("one exact document section covers repeated equal-value money occurrences", () => {
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 스튜디오 가격",
    "가격표!A3: 사업자명",
    "가격표!B3: 기본가격",
    "가격표!A4: 섹션스튜디오",
    "가격표!B4: 1,200,000원",
    "가격표!A10: 계약해지에 따른 위약금 및 환불규정",
    "가격표!A11: 변경 위약금 20만원 / 취소 위약금 200,000원 / 당일 위약금 20만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "반복섹션테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  assert.ok(extraction.sections.some((section) =>
    section.source_quote.includes("가격표!A11:")
  ));
  assert.deepEqual(
    findCoverageGaps(sourceText, extraction, { includeAuditLedger: false }),
    [],
  );
});

test("local extraction never mixes identical sheet locators across source files", () => {
  const secondSourceFileId = "2".repeat(64);
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "복수파일웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [
      {
        sourceFileId: SOURCE_FILE_ID,
        text: [
          "## 시트: 가격표",
          "가격표!A2: 스튜디오 가격",
          "가격표!A3: 사업자명",
          "가격표!B3: 기본가격",
          "가격표!A4: 첫번째스튜디오",
          "가격표!B4: 100만원",
        ].join("\n"),
      },
      {
        sourceFileId: secondSourceFileId,
        text: [
          "## 시트: 가격표",
          "가격표!A2: 드레스 가격",
          "가격표!A3: 사업자명",
          "가격표!B3: 기본가격",
          "가격표!A4: 두번째드레스",
          "가격표!B4: 200만원",
        ].join("\n"),
      },
    ],
  });

  assert.deepEqual(
    extraction.partner_vendors.map((vendor) => ({
      name: vendor.vendor_name,
      category: vendor.category,
      source: vendor.source_file_ids[0],
      price: vendor.options[0]?.price_min_krw,
    })),
    [
      { name: "첫번째스튜디오", category: "studio", source: SOURCE_FILE_ID, price: 1_000_000 },
      { name: "두번째드레스", category: "dress", source: secondSourceFileId, price: 2_000_000 },
    ],
  );
});

test("local extraction uses the business-name column and merged row span instead of option labels", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "병합표웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 가격표",
        "가격표!A2: 스튜디오 가격",
        "가격표!A3: 사업자명",
        "가격표!B3: 상품",
        "가격표!C3: 기본가격",
        "가격표!A4: 한빛스튜디오",
        "가격표!B4: 촬영",
        "가격표!C4: 기본 100만원",
        "가격표!B5: 메이크업실 추가",
        "가격표!C5: 추가 10만원",
        "가격표!B6: 앨범페이지 추가",
        "가격표!C6: 추가 5만원",
        "병합 범위 A4:A6 · 좌상단 A4",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.partner_vendors.length, 1);
  assert.equal(extraction.partner_vendors[0]?.vendor_name, "한빛스튜디오");
  assert.equal(extraction.partner_vendors[0]?.category, "studio");
  assert.deepEqual(
    extraction.partner_vendors[0]?.options.map((option) => option.price_min_krw),
    [1_000_000, 100_000, 50_000],
  );
});

test("local extraction accepts audited business header variants", () => {
  for (const header of ["사업체명", "사용자명", "드레스 사업자명"]) {
    const extraction = extractDisclosureFromLocalEvidence({
      canonicalName: "헤더테스트",
      regionCode: "seoul_gangnam3",
      kindHint: "agency",
      hasImages: false,
      sources: [{
        sourceFileId: SOURCE_FILE_ID,
        text: [
          "## 시트: 드레스",
          "드레스!A2: 드레스 가격",
          `드레스!A3: ${header}`,
          "드레스!B3: 기본가격",
          "드레스!A4: 라일락드레스",
          "드레스!B4: 기본 180만원",
        ].join("\n"),
      }],
    });

    assert.deepEqual(
      extraction.partner_vendors.map((vendor) => vendor.vendor_name),
      ["라일락드레스"],
      header,
    );
  }
});

test("a per-vendor penalty column does not truncate the price table", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "위약금열테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A2: ① 가격(단위: 원, VAT 포함)",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!G4: 위약금",
        "스튜디오!A5: 새봄스튜디오",
        "스튜디오!B5: 기본 120만원",
        "스튜디오!G5: 취소 시 위약금 20만원",
        "스튜디오!A6: 여름스튜디오",
        "스튜디오!B6: 기본 140만원",
        "스튜디오!G6: 취소 시 위약금 30만원",
        "스튜디오!A8: 위약금 및 환불 규정",
        "스튜디오!A10: 사업자명",
        "스튜디오!B10: 위약금",
        "스튜디오!A11: 새봄스튜디오",
        "스튜디오!B11: 계약금의 10%",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map((vendor) => ({
      name: vendor.vendor_name,
      prices: vendor.options.map((option) => option.price_min_krw),
      policies: vendor.policies.map((policy) => policy.raw_text),
    })),
    [
      {
        name: "새봄스튜디오",
        prices: [1_200_000],
        policies: ["취소 시 위약금 20만원", "계약금의 10%"],
      },
      { name: "여름스튜디오", prices: [1_400_000], policies: ["취소 시 위약금 30만원"] },
    ],
  );
});

test("one exact policy quote covers every repeated money occurrence without changing price ranges", () => {
  const sourceText = [
    "## 시트: 스튜디오",
    "스튜디오!A2: ① 가격(단위: 원, VAT 포함)",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!G3: 위약금",
    "스튜디오!A4: 반복스튜디오",
    "스튜디오!B4: 1,200,000원",
    "스튜디오!G4: 일정 변경 200,000원 / 예약 취소 20만원 / 당일 취소 200,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "반복정책테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  assert.deepEqual(
    extraction.partner_vendors[0]?.options.map((option) => option.price_min_krw),
    [1_200_000],
  );
  assert.equal(extraction.partner_vendors[0]?.policies.length, 1);
  assert.deepEqual(
    findCoverageGaps(sourceText, extraction, { includeAuditLedger: false }),
    [],
  );
});

test("a bare-money policy quote carries its exact same-sheet unit declaration", () => {
  const sourceText = [
    "## 시트: 스튜디오",
    "스튜디오!A2: ① 가격(단위: 원, VAT 포함)",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!H3: 위약금 규정",
    "스튜디오!A5: 아키",
    "스튜디오!B5: 1,200,000원",
    "스튜디오!H5: 촬영30일~16일 이내 330,000<br>촬영당일~15일이내 880,000",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "단위정책테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  const policy = extraction.partner_vendors[0]?.policies[0];
  assert.ok(policy);
  assert.match(policy.source_quote, /스튜디오!A2: ① 가격\(단위: 원, VAT 포함\)/u);
  assert.match(policy.source_quote, /스튜디오!H5: 촬영30일~16일 이내 330,000/u);
  assert.deepEqual(
    findCoverageGaps(sourceText, extraction, { includeAuditLedger: false }),
    [],
  );
});

test("an explicit vendor policy table attaches only exact same-sheet vendor policies", () => {
  const sourceText = [
    "## 시트: 드레스",
    "드레스!A2: ① 가격(VAT 포함)",
    "드레스!A3: 사업자명",
    "드레스!B3: 기본가격",
    "드레스!A4: 정확드레스",
    "드레스!B4: 1,500,000원",
    "드레스!A5: 다른드레스",
    "드레스!B5: 1,800,000원",
    "드레스!A8: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
    "드레스!A10: 사업자명",
    "드레스!B10: 취소 시 위약금 기준",
    "드레스!A11: 정확드레스",
    "드레스!B11: 투어 당일 취소 110,000원",
    "드레스!A12: 다른드레스",
    "드레스!B12: 가봉 후 취소 330,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "별도정책표테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map((vendor) => ({
      name: vendor.vendor_name,
      policies: vendor.policies.map((policy) => policy.raw_text),
    })),
    [
      { name: "정확드레스", policies: ["투어 당일 취소 110,000원"] },
      { name: "다른드레스", policies: ["가봉 후 취소 330,000원"] },
    ],
  );
  assert.match(
    extraction.partner_vendors[0]!.policies[0]!.source_quote,
    /드레스!B10: 취소 시 위약금 기준/u,
  );
  assert.match(
    extraction.partner_vendors[0]!.policies[0]!.source_quote,
    /드레스!A11: 정확드레스/u,
  );
  assert.deepEqual(
    findCoverageGaps(sourceText, extraction, { includeAuditLedger: false }),
    [],
  );
});

test("a separate policy table never fuzzy-matches or publishes placeholder vendors", () => {
  const sourceText = [
    "## 시트: 드레스",
    "드레스!A2: ① 가격(VAT 포함)",
    "드레스!A3: 사업자명",
    "드레스!B3: 기본가격",
    "드레스!A4: 정확드레스",
    "드레스!B4: 1,500,000원",
    "드레스!A8: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
    "드레스!A10: 사업자명",
    "드레스!B10: 취소 시 위약금 기준",
    "드레스!A11: 정확드레스서울",
    "드레스!B11: 투어 당일 취소 110,000원",
    "드레스!A12: S",
    "드레스!B12: 가봉 후 취소 220,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "정책표안전테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map((vendor) => ({
      name: vendor.vendor_name,
      policies: vendor.policies,
    })),
    [{ name: "정확드레스", policies: [] }],
  );
  assert.ok(extraction.sections.some((section) =>
    section.content_verbatim === "투어 당일 취소 110,000원"
  ));
  assert.ok(extraction.sections.some((section) =>
    section.content_verbatim === "가봉 후 취소 220,000원"
  ));
  assert.deepEqual(
    findCoverageGaps(sourceText, extraction, { includeAuditLedger: false }),
    [],
  );
});

test("an explicit cancellation-terms heading preserves each descendant money clause", () => {
  const sourceText = [
    "## 시트: 스튜디오",
    "스튜디오!A2: ① 가격(VAT 포함)",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!A4: 약관스튜디오",
    "스튜디오!B4: 1,200,000원",
    "## 시트: 약관",
    "약관!A52: 제 10조 (계약 취소 및 환불 규정)",
    "약관!A54: 2. 서비스 개시 전 환불:",
    "약관!A55: - 계약 후 7일 이내: 상담 실비 33,000원 공제 후 나머지 전액 환불합니다.",
    "약관!A56: - 계약 후 7일 경과: 총 상품 금액의 10%를 위약금으로 공제 후 환불합니다.",
    "약관!A60: 제 11조 (분쟁 해결)",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "약관문맥테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  const moneyClause = extraction.sections.find((section) =>
    section.source_quote.includes("약관!A55:")
  );
  assert.ok(moneyClause);
  assert.equal(moneyClause.section_type, "refund_policy");
  assert.match(moneyClause.source_quote, /약관!A52: 제 10조 \(계약 취소 및 환불 규정\)/u);
  assert.match(moneyClause.source_quote, /약관!A55: - 계약 후 7일 이내/u);
  assert.deepEqual(
    findCoverageGaps(sourceText, extraction, { includeAuditLedger: false }),
    [],
  );
});

test("an explicit payment-terms heading binds its deposit amount but stops at the next clause", () => {
  const sourceText = [
    "## 시트: 스튜디오",
    "스튜디오!A2: ① 가격(VAT 포함)",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!A4: 지불스튜디오",
    "스튜디오!B4: 1,200,000원",
    "## 시트: 약관",
    "약관!A34: 5. 지불약정",
    "약관!A35: 1) 계약금은 50만원이며 지정 계좌로 입금합니다.",
    "약관!A36: 2) 중도금 70% 및 잔금 30%는 지정일까지 입금합니다.",
    "약관!A40: 6. 개인정보 처리",
    "약관!A41: 별도 보상금 90만원 안내",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "지불문맥테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  const deposit = extraction.sections.find((section) =>
    section.source_quote.includes("약관!A35:")
  );
  assert.ok(deposit);
  assert.equal(deposit.section_type, "reservation");
  assert.match(deposit.source_quote, /약관!A34: 5\. 지불약정/u);
  assert.equal(
    extraction.sections.some((section) => section.source_quote.includes("약관!A41:")),
    false,
  );
  assert.deepEqual(
    findCoverageGaps(sourceText, extraction, { includeAuditLedger: false })
      .map(({ krw }) => krw),
    [900_000],
  );
});

test("a named vendor with non-numeric pricing is retained for review", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "문의형테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 메이크업",
        "메이크업!A3: 사업자명",
        "메이크업!B3: 기본가격",
        "메이크업!A4: 달빛메이크업",
        "메이크업!B4: 가격 별도 문의",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.partner_vendors.length, 1);
  assert.equal(extraction.partner_vendors[0]?.vendor_name, "달빛메이크업");
  assert.deepEqual(extraction.partner_vendors[0]?.options, []);
  assert.equal(extraction.partner_vendors[0]?.needs_review, true);
});

test("wedding snapshot tables map to studio while contract tables stay unlinked", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "범위테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 본식 스냅",
        "본식 스냅!A3: 사업자명",
        "본식 스냅!B3: 가격",
        "본식 스냅!A4: 사진업체",
        "본식 스냅!B4: 90만원",
        "## 시트: 계약서",
        "계약서!B11: 사업자명",
        "계약서!C11: 계약금",
        "계약서!B12: 계약상대방",
        "계약서!C12: 30만원",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.partner_vendors.length, 1);
  assert.equal(extraction.partner_vendors[0]?.vendor_name, "사진업체");
  assert.equal(extraction.partner_vendors[0]?.category, "studio");
  assert.equal(extraction.partner_vendors[0]?.options[0]?.price_min_krw, 900_000);
  assert.match(extraction.extraction_notes, /\[local_unlinked_money\] 1개/u);
});

test("per-vendor policy evidence prefers the policy column header over snapshot category text", () => {
  const sourceText = [
    "## 시트: 본식 스냅",
    "본식 스냅!A3: 사업자명",
    "본식 스냅!B3: 상품명",
    "본식 스냅!H3: 위약금",
    "본식 스냅!A5: 21그램",
    "본식 스냅!B5: 본식 스냅-베이직",
    "본식 스냅!C5: 90만원",
    "본식 스냅!H5: 계약 해지 시 계약금 환불 불가",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "정책열테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  const policy = extraction.partner_vendors[0]?.policies[0];
  assert.equal(policy?.policy_type, "penalty");
  assert.match(policy!.source_quote, /본식 스냅!H3: 위약금/u);
});

test("total package rows stay agency packages and never become partner vendors", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "패키지테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 토탈",
        "토탈!A3: 사업자명",
        "토탈!B3: 패키지 가격",
        "토탈!A4: 실속 패키지",
        "토탈!B4: 스드메 기본 250만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.partner_vendors, []);
  assert.equal(extraction.agency_packages.length, 1);
  assert.equal(extraction.agency_packages[0]?.package_name, "실속 패키지");
  assert.deepEqual(extraction.agency_packages[0]?.category_scope, []);
  assert.deepEqual(
    extraction.agency_packages[0]?.options.map((option) => option.price_min_krw),
    [2_500_000],
  );
});

test("package category scope is emitted only when an exact cell says 스드메", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "패키지테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 패키지",
        "패키지!A2: 스드메 패키지 가격",
        "패키지!A3: 사업자명",
        "패키지!B3: 패키지 가격",
        "패키지!A4: 알뜰 패키지",
        "패키지!B4: 250만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.agency_packages[0]?.category_scope,
    ["studio", "dress", "makeup"],
  );
  assert.match(extraction.agency_packages[0]!.source_quote, /스드메/u);
});

test("explicit cancellation terms are classified as penalty even when refund is mentioned", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "정책테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A2: 스튜디오 가격",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!G3: 취소 규정",
        "스튜디오!A4: 햇살스튜디오",
        "스튜디오!B4: 120만원",
        "스튜디오!G4: 계약 취소 시 위약금 20만원, 계약금 환불 불가",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.partner_vendors[0]?.policies[0]?.policy_type, "penalty");
});

test("a cancellation clause mentioning a deposit is a contract term, not a reservation", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "계약조건테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 안내",
        "안내!A2: 촬영일 변경, 취소 시 총 금액(계약금+잔금)의 50%",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.sections[0]?.section_type, "contract_terms");
});

test("a literal trailing ampersand remains part of exact policy evidence", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "정책기호테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 드레스",
        "드레스!A3: 사업자명",
        "드레스!B3: 드레스 가격",
        "드레스!G3: 취소 규정",
        "드레스!A4: 별빛드레스",
        "드레스!B4: 180만원",
        "드레스!G4: 6일~전날 변경 혹은 취소시 &",
      ].join("\n"),
    }],
  });

  const policy = extraction.partner_vendors[0]?.policies[0];
  assert.equal(policy?.raw_text, "6일~전날 변경 혹은 취소시 &");
  assert.ok(normalizeEvidenceText(policy!.source_quote).includes(policy!.raw_text));
});

test("long HTML-separated policy cells are losslessly split into exact quoted chunks", () => {
  const longPolicy = Array.from(
    { length: 70 },
    (_, index) => `계약 취소 ${index + 1}일 전 위약금 30만원`,
  ).join("<br>");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "장문정책테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 드레스",
        "드레스!A3: 사업자명",
        "드레스!B3: 드레스 가격",
        "드레스!G3: 취소 규정",
        "드레스!A4: 별빛드레스",
        "드레스!B4: 180만원",
        `드레스!G4: ${longPolicy}`,
      ].join("\n"),
    }],
  });

  const policies = extraction.partner_vendors[0]?.policies ?? [];
  assert.ok(policies.length > 1);
  assert.equal(
    policies.map((policy) => policy.raw_text).join(" "),
    normalizeEvidenceText(longPolicy),
  );
  for (const policy of policies) {
    assert.ok(
      normalizeEvidenceText(policy.source_quote).includes(policy.raw_text),
      policy.raw_text,
    );
  }
});

test("a generic sheet with three audited tables uses the disclosed S-D-M order", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "통합표테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A3: 사업자명",
        "Sheet1!B3: 기본가격",
        "Sheet1!A5: 햇살스튜디오",
        "Sheet1!B5: 촬영 120만원",
        "Sheet1!A14: 사업자명",
        "Sheet1!B14: 기본가격",
        "Sheet1!A16: 라일락드레스",
        "Sheet1!B16: 본식 180만원",
        "Sheet1!A25: 사업자명",
        "Sheet1!B25: 기본가격",
        "Sheet1!A27: 달빛메이크업",
        "Sheet1!B27: 본식 90만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map((vendor) => [vendor.vendor_name, vendor.category]),
    [
      ["햇살스튜디오", "studio"],
      ["라일락드레스", "dress"],
      ["달빛메이크업", "makeup"],
    ],
  );
});

test("an instructional penalty notice does not hide the later price tables", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "안내문테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 드레스",
        "드레스!A10: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
        "드레스!A15: ※ 제휴사업자별 가격과 위약금 및 환급 산정기준을 표시해야 함.",
        "드레스!A16: ① 가격(단위: 만원)_드레스",
        "드레스!A30: 사업자명",
        "드레스!B30: 기본가격",
        "드레스!A32: 초록드레스",
        "드레스!B32: 본식 200만원",
        "드레스!A50: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
        "드레스!A51: 사업자명",
        "드레스!B51: 위약금",
        "드레스!A52: 초록드레스",
        "드레스!B52: 위약금 20만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map((vendor) => vendor.vendor_name),
    ["초록드레스"],
  );
});

test("a one-syllable Korean brand is valid while alphabet templates stay excluded", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "짧은상호테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 메이크업",
        "메이크업!A3: 사업자명",
        "메이크업!B3: 기본가격",
        "메이크업!A4: S",
        "메이크업!B4: 80만원",
        "메이크업!A5: 밈",
        "메이크업!B5: 90만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map((vendor) => vendor.vendor_name),
    ["밈"],
  );
});

test("hall annex price sheets attach to the matching indoor or outdoor hall", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 식비",
    "Sheet1!A5: 별빛회관 (실내예식)",
    "Sheet1!B5: 식사 6만원",
    "Sheet1!A7: 별빛회관 잔디광장 (야외예식)",
    "Sheet1!B7: 식사 7만원",
    "## 시트: 실내 Price List",
    "실내 Price List!A1: 실내 예식비용",
    "실내 Price List!A4: 추가 옵션",
    "실내 Price List!E4: 가격",
    "실내 Price List!A5: 음향",
    "실내 Price List!E5: 10만원",
    "## 시트: 야외 Price List",
    "야외 Price List!A1: 야외 예식비용",
    "야외 Price List!A4: 추가 옵션",
    "야외 Price List!E4: 가격",
    "야외 Price List!A5: 조명",
    "야외 Price List!E5: 20만원",
    "## 시트: 애프터리스트",
    "애프터리스트!A2: 야외 결혼식 웰컴 파티",
    "애프터리스트!A5: 음료",
    "애프터리스트!G5: 3만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "별빛회관",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(
    extraction.halls.map((hall) => ({
      name: hall.hall_name,
      annexPrices: hall.options.map((option) => option.price_min_krw),
    })),
    [
      { name: "별빛회관 (실내예식)", annexPrices: [100_000] },
      { name: "별빛회관 잔디광장 (야외예식)", annexPrices: [200_000, 30_000] },
    ],
  );
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("a later hall never treats the previous hall data row as its column header", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "두홀테스트",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A3: 예식홀명",
        "Sheet1!B3: 식비",
        "Sheet1!M4: 기타 옵션",
        "Sheet1!A5: 실내홀",
        "Sheet1!B5: 식사 6만원",
        "Sheet1!M5: 본식사회자 79만원",
        "Sheet1!A7: 야외홀",
        "Sheet1!B7: 식사 7만원",
        "Sheet1!M7: 본식사회자 89만원",
        "병합 범위 A3:A4 · 좌상단 A3",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.halls.map((hall) => ({
      meal: hall.meal_price_max_krw,
      options: hall.options.map((option) => option.price_min_krw),
    })),
    [
      { meal: 60_000, options: [790_000] },
      { meal: 70_000, options: [890_000] },
    ],
  );
});

test("numbered policy clauses are not emitted as one-to-four won prices", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "번호조항테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!H3: 위약금 및 변경 규정",
        "스튜디오!A5: 별빛스튜디오",
        "스튜디오!B5: 촬영 120만원",
        "스튜디오!H5: 1.촬영일 기준 60일 이내 - 상품가의 30%<br>2.촬영일 기준 45일 이내 - 상품가의 50%<br>3.촬영일 기준 30일 이내 - 상품가의 70%<br>4.촬영일 기준 15일 이내 - 상품가의 100%",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.money_occurrences.map((occurrence) => occurrence.amount_krw),
    [1_200_000],
  );
  assert.deepEqual(
    extraction.partner_vendors[0]?.policies.flatMap((policy) =>
      policy.raw_text.match(/^[1-4](?=\.)/u) ?? []
    ),
    ["1"],
  );
});
