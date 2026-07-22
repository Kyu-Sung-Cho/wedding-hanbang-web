import assert from "node:assert/strict";
import test from "node:test";

import { extractDisclosureFromLocalEvidence } from "../local-extract.js";
import { prepareStructuredEvidenceText } from "../provenance.js";
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

test("an option selected from a row descriptor cites that exact descriptor cell", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "행복웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A2: ① 가격(VAT 포함)_스튜디오",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "병합 범위 B3:C3 · 좌상단 B3",
        "스튜디오!A4: 햇살컴퍼니",
        "스튜디오!B4: 원본 포함 20P 앨범",
        "스튜디오!C4: 165만원",
      ].join("\n"),
    }],
  });

  const option = extraction.partner_vendors[0]?.options[0];
  assert.equal(option?.name, "원본 포함 20P 앨범");
  assert.match(option?.source_quote ?? "", /스튜디오!B4: 원본 포함 20P 앨범/u);
  assert.match(option?.source_quote ?? "", /스튜디오!C4: 165만원/u);
});

test("local extraction preserves an exact XLSX price and VAT header as pricing-basis evidence", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "가격기준테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A1: ① 가격(단위: 만원, VAT 포함)",
        "스튜디오!A2: 모든 가격은 부가세 포함 금액입니다.",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!A4: 햇살컴퍼니",
        "스튜디오!B4: 125",
      ].join("\n"),
    }],
  });

  const pricingBasis = extraction.sections.filter(({ section_type }) => (
    section_type === "pricing_basis"
  ));
  assert.deepEqual(
    pricingBasis.map(({ content_verbatim }) => content_verbatim),
    [
      "① 가격(단위: 만원, VAT 포함)",
      "모든 가격은 부가세 포함 금액입니다.",
    ],
  );
  assert.deepEqual(
    pricingBasis.map(({ source_quote }) => source_quote),
    [
      "스튜디오!A1: ① 가격(단위: 만원, VAT 포함)",
      "스튜디오!A2: 모든 가격은 부가세 포함 금액입니다.",
    ],
  );
});

test("ambiguous source amounts stay in the audit ledger but never become structured prices", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "원문이상격리테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A1: 금액 단위: 만원",
        "스튜디오!A2: 가격은 VAT 포함",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 정상 가격",
        "스튜디오!C3: 단위 충돌 가격",
        "스튜디오!D3: 비정상 쉼표 가격",
        "스튜디오!E3: 점 구분 모호 가격",
        "스튜디오!F3: 비정상 소액 가격",
        "스튜디오!A4: 햇살컴퍼니",
        "스튜디오!B4: 120",
        "스튜디오!C4: 5,500",
        "스튜디오!D4: 382,5만원",
        "스튜디오!E4: 330.000원",
        "스튜디오!F4: 120원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.partner_vendors[0]?.options.map(({ price_min_krw }) => price_min_krw),
    [1_200_000],
  );
  assert.deepEqual(
    extraction.money_occurrences.map(({ raw_text }) => raw_text),
    ["120", "5,500", "382,5만원", "330.000원", "120원"],
  );
  assert.ok(extraction.money_occurrences.every(({ needs_review }) => needs_review));
  assert.match(extraction.extraction_notes, /\[local_structured_money_quarantine\] 4개/u);
});

test("explicit won-denominated hall options below ten thousand remain structured", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!F3: 선택품목 가격",
    "Sheet1!G4: 식음료 추가",
    "Sheet1!A5: 컨벤션홀",
    "Sheet1!G5: 7,700원~8,800원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "소액명시원테스트",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(
    extraction.halls?.[0]?.options.map((option) => ({
      name: option.name,
      minimum: option.price_min_krw,
      maximum: option.price_max_krw,
    })),
    [{ name: "식음료 추가", minimum: 7_700, maximum: 8_800 }],
  );
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("hall meal variants separated by a slash remain exact options instead of one legacy range", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 식비",
    "Sheet1!A5: 그랜드홀",
    "Sheet1!B5: 성인 88,000원/아동 44,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "식대변형테스트",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  const hall = extraction.halls?.[0];
  assert.equal(hall?.meal_price_min_krw, null);
  assert.equal(hall?.meal_price_max_krw, null);
  assert.deepEqual(hall?.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
    maximum: option.price_max_krw,
    raw: option.raw_text,
  })), [
    { name: "성인", minimum: 88_000, maximum: 88_000, raw: "성인 88,000원" },
    { name: "아동", minimum: 44_000, maximum: 44_000, raw: "아동 44,000원" },
  ]);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("hall bullet fragments preserve separate options and only pair an explicit range", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!G3: 기타 옵션",
    "Sheet1!A5: 그랜드홀",
    "Sheet1!G5: ● 주례 200,000원 ● 사회 300,000원 ● 생화 500,000원~700,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "불릿옵션테스트",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  const options = extraction.halls?.[0]?.options ?? [];
  assert.deepEqual(options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
    maximum: option.price_max_krw,
  })), [
    { name: "주례", minimum: 200_000, maximum: 200_000 },
    { name: "사회", minimum: 300_000, maximum: 300_000 },
    { name: "생화", minimum: 500_000, maximum: 700_000 },
  ]);
  assert.match(options[0]?.source_quote ?? "", /Sheet1!G5: ● 주례 200,000원/u);
  assert.match(options[1]?.source_quote ?? "", /Sheet1!G5: ● 사회 300,000원/u);
  assert.match(options[2]?.source_quote ?? "", /Sheet1!G5: ● 생화 500,000원~700,000원/u);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("season and year meal variants do not overwrite a certified legacy meal price", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 식비",
    "Sheet1!A5: 그랜드홀",
    "Sheet1!B5: 기본 95,000원<br>비수기 75,000원~80,000원 / 성수기 85,000원~90,000원<br>2026년 92,000원 / 2027년 97,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "식대시즌연도테스트",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  const hall = extraction.halls?.[0];
  assert.equal(hall?.meal_price_min_krw, 95_000);
  assert.equal(hall?.meal_price_max_krw, 95_000);
  assert.deepEqual(hall?.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
    maximum: option.price_max_krw,
  })), [
    { name: "비수기", minimum: 75_000, maximum: 80_000 },
    { name: "성수기", minimum: 85_000, maximum: 90_000 },
    { name: "2026년", minimum: 92_000, maximum: 92_000 },
    { name: "2027년", minimum: 97_000, maximum: 97_000 },
  ]);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("an exact minimum-guarantee phrase is bound to its certified hall row group", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 식비",
    "Sheet1!A5: 그랜드홀",
    "Sheet1!B5: 최소 보증인원 180명",
    "Sheet1!C5: 성인 식대 88,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "최소보증인원테스트",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  const hall = extraction.halls?.[0];
  assert.equal(hall?.guarantee_min, 180);
  assert.match(hall?.source_quote ?? "", /Sheet1!B5: 최소 보증인원 180명/u);
});

test("the other certified guarantee phrases preserve their exact guest counts", () => {
  for (const { phrase, expected } of [
    { phrase: "기본 150명", expected: 150 },
    { phrase: "보증인원 200명부터", expected: 200 },
  ]) {
    const text = [
      "## 시트: Sheet1",
      "Sheet1!A1: ① 가격(VAT 포함)",
      "Sheet1!A3: 예식홀명",
      "Sheet1!B3: 식비",
      "Sheet1!A5: 그랜드홀",
      `Sheet1!B5: ${phrase}`,
      "Sheet1!C5: 성인 식대 88,000원",
    ].join("\n");
    const extraction = extractDisclosureFromLocalEvidence({
      canonicalName: "보증인원문구테스트",
      regionCode: "seoul_etc",
      kindHint: "hall",
      hasImages: false,
      sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
    });

    assert.equal(extraction.halls?.[0]?.guarantee_min, expected, phrase);
  }
});

test("years ages times and qualified headcounts cannot become a hall guarantee", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 식비",
    "Sheet1!A5: 그랜드홀",
    "Sheet1!B5: 기본 4명 연주",
    "Sheet1!C5: 2027년",
    "Sheet1!D5: 만 8세",
    "Sheet1!E5: 이용시간 3시간",
    "Sheet1!F5: 성인 식대 88,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "보증인원음성테스트",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.equal(extraction.halls?.[0]?.guarantee_min, null);
});

test("a source containing OCR_REVIEW_ONLY keeps even its plain projection audit-only", () => {
  const text = [
    "□ 달빛웨딩홀",
    "① 가격(VAT포함)",
    "식대 성인 기준 1인 식사 83,000원 ~ 88,000원",
    "대관 및 기본 디렉팅",
    "3시간 단독 대관",
    "6,600,000원 ~",
    "8,800,000원",
    "기본 생화 장식",
    "3,300,000원 ~",
    "5,500,000원",
    "본식 원판 촬영 660,000원 선택 가능",
    "[OCR_REVIEW_ONLY]",
    "ocr:page:1:line:1: 83,000원 ~ 88,000원",
    "ocr:page:1:line:2: 6,600,000원",
    "ocr:page:1:line:3: 8,800,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "달빛웨딩홀",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: true,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.halls, []);
  assert.deepEqual(extraction.partner_vendors, []);
  assert.deepEqual(extraction.agency_packages, []);
  assert.equal(extraction.sections.some(({ content_verbatim }) => /83,000원/u.test(content_verbatim)), false);
  assert.ok(extraction.money_occurrences.some(({ amount_krw }) => amount_krw === 83_000));
  assert.ok(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length > 0);
  assert.match(extraction.extraction_notes, /local_ocr_review_source_quarantine/u);
});

test("local extraction turns a DOCX-style line list into exact partner, option, and policy evidence", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "문서형대행사",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "제휴 업체 가격표",
        "",
        "스튜디오",
        "",
        "별빛컴퍼니",
        "",
        "스튜디오",
        "",
        "기본 촬영 99만원",
        "",
        "드레스",
        "",
        "라일락꾸뛰르",
        "",
        "드레스",
        "",
        "본식 165만원",
        "",
        "계약 해지에 따른 위약금 및 환급에 관한 산정기준",
        "계약 취소 시 위약금 10만원",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.doc_kind, "partner_price_list");
  assert.deepEqual(
    extraction.partner_vendors.map(({ vendor_name, category, options }) => ({
      vendor_name,
      category,
      prices: options.map(({ price_min_krw }) => price_min_krw),
    })),
    [
      { vendor_name: "별빛컴퍼니", category: "studio", prices: [990_000] },
      { vendor_name: "라일락꾸뛰르", category: "dress", prices: [1_650_000] },
    ],
  );
  assert.match(extraction.partner_vendors[0]!.source_quote, /line:5: 별빛컴퍼니/u);
  assert.match(extraction.partner_vendors[0]!.source_quote, /line:7: 스튜디오/u);
  assert.match(extraction.partner_vendors[0]!.options[0]!.source_quote, /line:9: 기본 촬영 99만원/u);
  assert.ok(extraction.sections.some((section) => (
    section.content_verbatim === "계약 해지에 따른 위약금 및 환급에 관한 산정기준"
    && section.source_quote === "line:19: 계약 해지에 따른 위약금 및 환급에 관한 산정기준"
  )));
  assert.ok(extraction.sections.some((section) => (
    section.content_verbatim === "계약 취소 시 위약금 10만원"
    && section.source_quote === "line:20: 계약 취소 시 위약금 10만원"
  )));
});

test("DOCX category anchors keep the real vendor across long specs and suppress spec-name duplicates", () => {
  const text = [
    "스튜디오",
    "별빛사진",
    "스튜디오",
    "20P 1권, 20R 액자 1개",
    "99만원",
    "드레스",
    "라일락드레스",
    "촬영 4벌",
    "본식 1벌",
    "피팅비 포함",
    "165만원",
    "헬퍼비",
    "(25만원~예식지역에 따라 상이)",
    "메이크업",
    "다정메이크업",
    "1회 44만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "문서형긴구성대행사",
    regionCode: "gyeonggi",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map(({ vendor_name, category }) => ({ vendor_name, category })),
    [
      { vendor_name: "별빛사진", category: "studio" },
      { vendor_name: "라일락드레스", category: "dress" },
      { vendor_name: "다정메이크업", category: "makeup" },
    ],
  );
  assert.equal(
    extraction.partner_vendors.some(({ vendor_name }) => vendor_name.includes("20P 1권")),
    false,
  );
  const dressOptions = extraction.partner_vendors.find(({ category }) => category === "dress")!.options;
  assert.deepEqual(
    dressOptions.map(({ price_min_krw, price_max_krw }) => ({ price_min_krw, price_max_krw })),
    [
      { price_min_krw: 1_650_000, price_max_krw: 1_650_000 },
      { price_min_krw: 250_000, price_max_krw: null },
    ],
  );
  assert.match(dressOptions[1]!.condition ?? "", /예식지역에 따라 상이/u);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("DOCX-style duplicate amounts remain occurrence-complete in structured coverage", () => {
  const text = [
    "스튜디오",
    "별빛컴퍼니",
    "스튜디오",
    "원본 추가 10만원 / 앨범 추가 10만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "중복금액문서테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(
    extraction.partner_vendors[0]?.options.map(({ price_min_krw }) => price_min_krw),
    [100_000, 100_000],
  );
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("repeated equal XLSX amounts retain their exact cell-local occurrence and label", () => {
  const text = [
    "## 시트: 스튜디오",
    "스튜디오!A1: 스튜디오 가격",
    "스튜디오!A3: 사업자명",
    "스튜디오!F3: 기타 옵션",
    "스튜디오!A4: 별빛스튜디오",
    "스튜디오!F4: 의상 추가 11만원<br>촬영시간 추가 11만원<br>들러리 촬영 11만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "반복옵션근거테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
  })), [
    { name: "의상 추가", minimum: 110_000 },
    { name: "촬영시간 추가", minimum: 110_000 },
    { name: "들러리 촬영", minimum: 110_000 },
  ]);
  assert.match(extraction.partner_vendors[0]!.options[0]!.source_quote, /스튜디오!F4: 의상 추가 11만원/u);
  assert.match(extraction.partner_vendors[0]!.options[1]!.source_quote, /스튜디오!F4: 촬영시간 추가 11만원/u);
  assert.match(extraction.partner_vendors[0]!.options[2]!.source_quote, /스튜디오!F4: 들러리 촬영 11만원/u);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("repeated equal amounts in one clause keep the nearest exact label", () => {
  const text = [
    "## 시트: 드레스",
    "드레스!A1: 드레스 가격",
    "드레스!A3: 사업자명",
    "드레스!B3: 기본가격",
    "드레스!A4: 별빛드레스",
    "드레스!B4: 촬영+본식 303만원 (지정시 303만원,2부서비스)",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "동일금액절근거테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
  })), [
    { name: "촬영+본식", minimum: 3_030_000 },
    { name: "지정시", minimum: 3_030_000 },
  ]);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("comma-separated options keep one exact source clause per amount", () => {
  const text = [
    "## 시트: 메이크업",
    "메이크업!A1: 메이크업 가격",
    "메이크업!A3: 사업자명",
    "메이크업!D3: 헤어피스",
    "메이크업!A4: 별빛메이크업",
    "메이크업!D4: 실사용료 11만원, 보증금 10만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "쉼표옵션근거테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
    rawText: option.raw_text,
  })), [
    { name: "실사용료", minimum: 110_000, rawText: "실사용료 11만원" },
    { name: "보증금", minimum: 100_000, rawText: "보증금 10만원" },
  ]);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("review-only OCR never promotes an explicit category or Latin brand", () => {
  const text = [
    "[OCR_REVIEW_ONLY]",
    "ocr:page:1:line:1: 드레스 구성 및 금액 안내",
    "ocr:page:1:line:2: 촬영만 3벌 기준",
    "ocr:page:1:line:3: 400만원~",
    "ocr:page:1:line:4: AILEEN COUTURE",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "OCR단일업체테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: true,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors, []);
  assert.deepEqual(extraction.agency_packages, []);
  assert.equal(extraction.doc_kind, "agency_disclosure");
  assert.equal(extraction.sections.some(({ section_type }) => section_type === "pricing_basis"), false);
  assert.ok(extraction.money_occurrences.some(({ amount_krw }) => amount_krw === 4_000_000));
  assert.ok(findCoverageGaps(text, extraction, { includeAuditLedger: false }).some(
    ({ krw }) => krw === 4_000_000,
  ));
  assert.match(extraction.extraction_notes, /local_ocr_review_source_quarantine/u);
});

test("an unowned contract amount becomes exact pricing-basis evidence only with a price header", () => {
  const text = [
    "## 시트: 스튜디오",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!A4: 별빛컴퍼니",
    "스튜디오!B4: 120만원",
    "## 시트: 계약서",
    "계약서!A2: 항목",
    "계약서!B2: 금액",
    "계약서!A3: 스튜디오 계약금",
    "계약서!B3: 1,210,000원",
    "## 시트: 기타",
    "기타!A1: 설명",
    "기타!B1: 참고 777,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "계약금액근거테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map(({ vendor_name, options }) => ({
      vendor_name,
      prices: options.map(({ price_min_krw }) => price_min_krw),
    })),
    [{ vendor_name: "별빛컴퍼니", prices: [1_200_000] }],
  );
  const contractBasis = extraction.sections.find((section) => (
    section.section_type === "pricing_basis"
    && section.content_verbatim === "1,210,000원"
  ));
  assert.ok(contractBasis);
  assert.match(contractBasis.source_quote, /계약서!B2: 금액/u);
  assert.match(contractBasis.source_quote, /계약서!B3: 1,210,000원/u);
  assert.equal(extraction.sections.some(({ source_quote }) => (
    source_quote.includes("기타!B1: 참고 777,000원")
  )), false);
  assert.deepEqual(
    findCoverageGaps(text, extraction, { includeAuditLedger: false }).map(({ krw }) => krw),
    [777_000],
  );
});

test("an exact payment-role label safely grounds an unowned contract amount", () => {
  const text = [
    "## 시트: 계약서",
    "계약서!A24: 계약금",
    "계약서!B24: 500,000원",
    "계약서!A25: 중도금",
    "계약서!B25: 1,000,000원",
    "계약서!A26: 잔금",
    "계약서!B26: 2,000,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "지급금액근거테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(
    extraction.sections
      .filter(({ section_type }) => section_type === "pricing_basis")
      .map(({ title, content_verbatim }) => ({ title, content_verbatim })),
    [
      { title: "계약금", content_verbatim: "500,000원" },
      { title: "중도금", content_verbatim: "1,000,000원" },
      { title: "잔금", content_verbatim: "2,000,000원" },
    ],
  );
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
  assert.equal(extraction.partner_vendors.length, 0);
});

test("an unowned bare contract amount carries its exact declared unit into pricing evidence", () => {
  const text = [
    "## 시트: 계약서",
    "계약서!A1: 금액 단위: 만원",
    "계약서!B2: 금액",
    "계약서!A3: 스튜디오",
    "계약서!B3: 121",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "계약단위근거테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  const pricingBasis = extraction.sections.find((section) => (
    section.section_type === "pricing_basis"
    && section.content_verbatim === "121"
  ));
  assert.ok(pricingBasis);
  assert.match(pricingBasis.source_quote, /계약서!A1: 금액 단위: 만원/u);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("a contract table uses its row category and preserves labeled inline extras", () => {
  const text = [
    "## 시트: 계약서",
    "계약서!A2: 품목",
    "계약서!B2: 업체명",
    "계약서!A3: 리허설 스튜디오",
    "계약서!B3: 별빛스튜디오",
    "계약서!C3: ₩1,210,000",
    "계약서!A4: 웨딩드레스",
    "계약서!B4: 하늘드레스",
    "계약서!C4: ₩1,850,000",
    "계약서!A5: 헤어메이크업",
    "계약서!B5: 온유메이크업",
    "계약서!C5: ₩1,100,000",
    "계약서!A7: 비고",
    "계약서!B7: 피팅비 5만5천원 / 업그레이드 추가비 110만원 / 헬퍼비 25만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "계약표테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map((vendor) => ({
      name: vendor.vendor_name,
      category: vendor.category,
      options: vendor.options.map((option) => ({
        name: option.name,
        price: option.price_min_krw,
      })),
    })),
    [
      {
        name: "별빛스튜디오",
        category: "studio",
        options: [{ name: "리허설 스튜디오", price: 1_210_000 }],
      },
      {
        name: "하늘드레스",
        category: "dress",
        options: [{ name: "웨딩드레스", price: 1_850_000 }],
      },
      {
        name: "온유메이크업",
        category: "makeup",
        options: [{ name: "헤어메이크업", price: 1_100_000 }],
      },
    ],
  );
  assert.ok(extraction.sections.some((section) => (
    section.section_type === "other"
    && section.content_verbatim.includes("헬퍼비 25만원")
  )));
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
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

test("two named ranges in one generic option cell remain two options", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "범위옵션테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기타 옵션",
        "스튜디오!A4: 햇살스튜디오",
        "스튜디오!B4: 원본 추가 100,000원~200,000원 / 앨범 추가 300,000원~400,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
    maximum: option.price_max_krw,
  })), [
    { name: "원본 추가", minimum: 100_000, maximum: 200_000 },
    { name: "앨범 추가", minimum: 300_000, maximum: 400_000 },
  ]);
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
        "홀가격!D3: 대관료",
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

test("local extraction retains a hall price on an authoritative metadata-looking line", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "페이지예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "예식홀명",
        "그랜드홀",
        "page: 1 대관료 3,300,000원",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.halls[0]?.hall_name, "그랜드홀");
  assert.equal(extraction.halls[0]?.venue_fee_min_krw, 3_300_000);
  assert.deepEqual(
    extraction.money_occurrences.map(({ amount_krw }) => amount_krw),
    [3_300_000],
  );
});

test("local extraction retains a declared-unit hall price beside a redacted contact", () => {
  const prepared = prepareStructuredEvidenceText([
    "## 시트: 홀가격",
    "홀가격!A1: 금액 단위: 만원",
    "홀가격!A3: 예식홀명",
    "홀가격!D3: 대관료",
    "홀가격!A5: 그랜드홀",
    "홀가격!D5: 기본가격 330 / 연락처 02-1234-5678",
  ].join("\n"));
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "연락처예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: prepared.text }],
  });

  assert.equal(extraction.halls[0]?.hall_name, "그랜드홀");
  assert.equal(extraction.halls[0]?.venue_fee_min_krw, 3_300_000);
  assert.deepEqual(
    extraction.money_occurrences.map(({ amount_krw }) => amount_krw),
    [3_300_000],
  );
});

test("ambiguous hall fees stay null while named add-ons and ranges remain exact options", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "의미격리예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 홀가격",
        "홀가격!A3: 예식홀명",
        "홀가격!D3: 대관료, 장식비",
        "홀가격!F4: 기타 옵션",
        "홀가격!H4: 장식 추가",
        "홀가격!J4: 기타 옵션",
        "홀가격!A5: 별빛홀",
        "홀가격!D5: 20,000,000원",
        "홀가격!E5: 대관료 없음<br>장식비 13,000,000원 ~<br>상한 제한없음",
        "홀가격!F5: 900,000원",
        "홀가격!H5: 신부대기실 1,500,000원~2,000,000원<br>포토테이블 800,000원",
        "홀가격!I5: 전문 사회자",
        "홀가격!J5: 300,000원~500,000원",
      ].join("\n"),
    }],
  });

  const hall = extraction.halls[0]!;
  assert.deepEqual({
    venue: [hall.venue_fee_min_krw, hall.venue_fee_max_krw],
    decoration: [hall.decoration_fee_min_krw, hall.decoration_fee_max_krw],
  }, {
    venue: [null, null],
    decoration: [13_000_000, null],
  });
  assert.equal(hall.venue_fee_note, "대관료 없음");
  assert.equal(hall.decoration_note, "상한 제한없음");
  assert.deepEqual(hall.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
    maximum: option.price_max_krw,
  })), [
    { name: "대관료, 장식비", minimum: 20_000_000, maximum: 20_000_000 },
    { name: "신부대기실", minimum: 1_500_000, maximum: 2_000_000 },
    { name: "포토테이블", minimum: 800_000, maximum: 800_000 },
    { name: "전문 사회자", minimum: 300_000, maximum: 500_000 },
  ]);
  assert.equal(hall.options.some(({ name }) => name === "장식 추가" || name === "기타 옵션"), false);
  assert.match(extraction.extraction_notes, /\[local_semantic_binding_quarantine\]/u);
  assert.match(hall.source_quote, /대관료 없음<br>장식비 13,000,000원/u);
});

test("workbook hall names survive without prices while template placeholders do not", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "홀명보존예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 홀가격",
        "홀가격!A3: 예식홀명",
        "홀가격!A5: Grand Ballroom",
        "홀가격!A7: ASEM Ballroom",
        "홀가격!A9: B홀",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls.map((hall) => ({
    name: hall.hall_name,
    meal: hall.meal_price_min_krw,
    venue: hall.venue_fee_min_krw,
    options: hall.options,
  })), [
    { name: "Grand Ballroom", meal: null, venue: null, options: [] },
    { name: "ASEM Ballroom", meal: null, venue: null, options: [] },
  ]);
});

test("one plain-text hall identity survives even when the disclosure has no price", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "홀명전용예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: ["예식홀명", "오키드룸"].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls.map((hall) => ({
    name: hall.hall_name,
    meal: hall.meal_price_min_krw,
    venue: hall.venue_fee_min_krw,
    decoration: hall.decoration_fee_min_krw,
  })), [{ name: "오키드룸", meal: null, venue: null, decoration: null }]);
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

test("a money-bearing policy boundary remains exact when a later sibling clause exists", () => {
  const sourceText = [
    "## 시트: 스튜디오",
    "스튜디오!A2: ① 가격(VAT 포함)",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!A4: 별빛스튜디오",
    "스튜디오!B4: 1,200,000원",
    "스튜디오!A58: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
    "스튜디오!A59: [취소·위약규정]<br>서비스 개시 전 대면 상담비용 55,000원 차감 후 환불",
    "스튜디오!A60: [세부업체별 위약규정]<br>추후 보충예정",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "정책금액경계테스트",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text: sourceText }],
  });

  const boundary = extraction.sections.find((section) => (
    section.source_quote.includes("스튜디오!A59:")
  ));
  assert.ok(boundary);
  assert.equal(boundary.section_type, "penalty");
  assert.match(boundary.content_verbatim, /55,000원/u);
  assert.match(boundary.source_quote, /55,000원/u);
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

test("a generic worksheet with an exact total-shop heading stays an agency package", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "토탈샵테스트",
    regionCode: "gangwon",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 표준양식",
        "표준양식!A4: 토탈샵테스트 (스드메 토탈샵) // 촬영 + 본식",
        "표준양식!A6: 사업자명",
        "표준양식!B6: 기본가격",
        "표준양식!A8: 토탈샵 패키지",
        "표준양식!B8: 드레스와 헤어 메이크업 포함",
        "표준양식!C8: 272만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.partner_vendors, []);
  assert.equal(extraction.agency_packages[0]?.package_name, "토탈샵 패키지");
  assert.deepEqual(
    extraction.agency_packages[0]?.category_scope,
    ["studio", "dress", "makeup"],
  );
  assert.match(extraction.agency_packages[0]!.source_quote, /스드메/u);
});

test("one merged total-shop anchor splits repeated basic-price rows into exact package variants", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "토탈샵변형테스트",
    regionCode: "gangwon",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 표준양식",
        "표준양식!A4: 토탈샵변형테스트 (스드메 토탈샵) // 촬영",
        "표준양식!A6: 사업자명",
        "표준양식!B6: 기본가격",
        "표준양식!D7: 야간씬 추가",
        "표준양식!A8: 별빛 토탈샵",
        "표준양식!B8: 10P<br>드레스 2벌",
        "표준양식!C8: 1,240,000원",
        "표준양식!D8: 150,000원",
        "표준양식!B17: 20P<br>드레스 3벌",
        "표준양식!C17: 1,570,000원",
        "표준양식!D17: 250,000원",
        "병합 범위 A8:A25 · 좌상단 A8",
        "병합 범위 B6:C7 · 좌상단 B6",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.agency_packages.map((item) => ({
    name: item.package_name,
    note: item.price_note,
    prices: item.options.map((option) => option.price_min_krw),
  })), [{
    name: "10P",
    note: "10P",
    prices: [1_240_000, 150_000],
  }, {
    name: "20P",
    note: "20P",
    prices: [1_570_000, 250_000],
  }]);
  assert.match(extraction.agency_packages[0]!.source_quote, /표준양식!B8/u);
  assert.match(extraction.agency_packages[1]!.source_quote, /표준양식!B17/u);
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
  assert.match(extraction.partner_vendors[0]!.source_quote, /Sheet1!A3: 사업자명/u);
  assert.match(extraction.partner_vendors[0]!.options[0]!.source_quote, /Sheet1!A3: 사업자명/u);
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

test("OCR review provenance metadata never becomes a hall price or public option", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "호텔테스트",
    regionCode: "daejeon",
    kindHint: "hall",
    hasImages: true,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "□ 호텔테스트",
        "① 가격(단위:원, VAT 포함)",
        "대관료 3,300,000원",
        "[OCR_REVIEW_ONLY]",
        "contract_version: v1-windows-media-ocr-ko-KR-review-only",
        "source_image_sha256: 55596ba85f81220290383142759b4e8ad8c8b8a548b74206104c9b31510847e2",
        "page: 1",
        "engine_version: windows-10.0.26200.0|powershell-5.1.26100.8875",
        "engine_hash: 867e91564507da1ba44209c413884736839a7137a0bb219f7b64b9e46a9eb55a",
        "ocr:page:1:line:1: 대관료 3,300,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls, []);
  assert.equal(extraction.sections.some(({ content_verbatim }) => (
    content_verbatim.includes("대관료 3,300,000원")
  )), false);
  assert.deepEqual(
    extraction.money_occurrences.map(({ amount_krw }) => amount_krw),
    [3_300_000, 3_300_000],
  );
  assert.match(extraction.extraction_notes, /local_ocr_review_source_quarantine/u);
  assert.equal(extraction.sections.some(({ content_verbatim }) => (
    /(?:sha256|engine_|contract_version)/u.test(content_verbatim)
  )), false);
});

test("generic three-table order wins over incidental option labels", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "순서검증",
    regionCode: "gwangju",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A4: 사업자명",
        "Sheet1!E5: 코디헬퍼",
        "Sheet1!A6: 첫사진관",
        "Sheet1!B6: 120만원",
        "Sheet1!A14: 사업자명",
        "Sheet1!H15: 드레스추가대여",
        "Sheet1!A16: 둘째드레스",
        "Sheet1!B16: 180만원",
        "Sheet1!A24: 사업자명",
        "Sheet1!D25: 웨딩메이크업 기타옵션",
        "Sheet1!A26: 셋째메이크업",
        "Sheet1!B26: 90만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map(({ category }) => category),
    ["studio", "dress", "makeup"],
  );
});

test("ambiguous combined hall columns retain only source-backed venue identity", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "압축표호텔",
    regionCode: "seoul_gangnam3",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "□ 압축표호텔",
        "① 가격(단위:원, VAT 포함)",
        "예식홀명 식비 대관료, 장식비",
        "기본 100명 180,000원 대관 3,300,000원 장식 18,300,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls.map((hall) => ({
    name: hall.hall_name,
    venue: hall.venue_fee_min_krw,
    decoration: hall.decoration_fee_min_krw,
    options: hall.options,
  })), [{
    name: "압축표호텔",
    venue: null,
    decoration: null,
    options: [],
  }]);
  assert.ok(extraction.sections.some(({ content_verbatim, section_type }) => (
    section_type === "other"
    && content_verbatim.includes("180,000원")
    && content_verbatim.includes("18,300,000원")
  )));
});

test("a collapsed two-range row keeps meal but quarantines a combined venue-decoration range", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "압축범위예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "예식홀명 식 비 대관료, 장식비",
        "정원 홀",
        "65,000원~75,000원4,000,000원~6,000,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.halls.map((hall) => ({
      name: hall.hall_name,
      meal: [hall.meal_price_min_krw, hall.meal_price_max_krw],
      venue: [hall.venue_fee_min_krw, hall.venue_fee_max_krw],
      decoration: [hall.decoration_fee_min_krw, hall.decoration_fee_max_krw],
    })),
    [{
      name: "정원 홀",
      meal: [65_000, 75_000],
      venue: [null, null],
      decoration: [null, null],
    }],
  );
  assert.ok(extraction.sections.some(({ content_verbatim }) => (
    content_verbatim.includes("4,000,000원~6,000,000원")
  )));
  assert.match(extraction.extraction_notes, /\[local_structured_money_quarantine\]/u);
});

test("a projected DOCX table may bind one bare meal cell only inside its declared first table", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "표투영예식장",
    regionCode: "jeolla",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "예식홀명",
        "최소보증인원",
        "식비",
        "대관료, 장식비",
        "별빛홀(단독홀)",
        "120명",
        "55,000원",
        "대관료 2,400,000원",
        "장식비 없음",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.halls.map((hall) => ({
      name: hall.hall_name,
      guarantee: hall.guarantee_min,
      meal: hall.meal_price_min_krw,
      venue: hall.venue_fee_min_krw,
    })),
    [{ name: "별빛홀", guarantee: 120, meal: 55_000, venue: 2_400_000 }],
  );
});

test("multiple distinct plain-text halls retain identity while prices remain quarantined", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "복수홀예식장",
    regionCode: "seoul_gangnam3",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "예식홀명 식비 대관료, 장식비",
        "달홀",
        "기본 200명 90,000원 대관료 8,000,000원",
        "별홀",
        "기본 100명 80,000원 대관료 4,000,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls.map((hall) => ({
    name: hall.hall_name,
    meal: hall.meal_price_min_krw,
    venue: hall.venue_fee_min_krw,
    decoration: hall.decoration_fee_min_krw,
    options: hall.options,
  })), [
    { name: "달홀", meal: null, venue: null, decoration: null, options: [] },
    { name: "별홀", meal: null, venue: null, decoration: null, options: [] },
  ]);
  assert.ok(extraction.sections.some(({ content_verbatim }) => (
    content_verbatim.includes("8,000,000원")
  )));
});

test("plain-text sub-ten-thousand amounts stay in review evidence, not public hall fields", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "소액격리예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "예식홀명 식비 대관료",
        "햇빛홀",
        "음료 8,800원",
        "대관료 3,000,000원",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.halls[0]?.venue_fee_min_krw, 3_000_000);
  assert.equal(extraction.halls[0]?.options.some(({ price_min_krw }) => price_min_krw === 8_800), false);
  assert.ok(extraction.sections.some(({ content_verbatim }) => content_verbatim.includes("8,800원")));
});

test("section titles are cleanly truncated without cutting converter HTML tags", () => {
  const longPolicy = `${"계약 취소 위약금 안내 ".repeat(20)}<br>150일 전 환불 가능`;
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "장문제목",
    regionCode: "jeolla",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        `Sheet1!A9: ${longPolicy}`,
      ].join("\n"),
    }],
  });
  const section = extraction.sections[0]!;

  assert.equal(section.title.includes("<"), false);
  assert.ok(normalizeEvidenceText(section.source_quote).includes(section.title));
});

test("combined venue-decoration headers stay out of legacy aggregates but retain exact combined options", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "결합열예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A3: 예식홀명",
        "Sheet1!D3: 대관<br>/<br>장식비",
        "Sheet1!A5: 별빛홀",
        "Sheet1!D5: 대관정가 9,800,000원",
        "Sheet1!E5: 장식비 5,500,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls.map((hall) => ({
    name: hall.hall_name,
    venue: [hall.venue_fee_min_krw, hall.venue_fee_max_krw],
    decoration: [hall.decoration_fee_min_krw, hall.decoration_fee_max_krw],
    options: hall.options.map((option) => ({
      name: option.name,
      minimum: option.price_min_krw,
      maximum: option.price_max_krw,
    })),
  })), [{
    name: "별빛홀",
    venue: [null, null],
    decoration: [null, null],
    options: [{
      name: "대관 / 장식비",
      minimum: 9_800_000,
      maximum: 9_800_000,
    }, {
      name: "대관 / 장식비",
      minimum: 5_500_000,
      maximum: 5_500_000,
    }],
  }]);
});

test("hall option ranges are emitted once and preserve open bounds", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "범위홀예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A3: 예식홀명",
        "Sheet1!F3: 선택품목 가격",
        "Sheet1!F4: 기타 옵션",
        "Sheet1!A5: 별빛홀",
        "Sheet1!F5: 현장 중계 220,000원~330,000원<br>음료 추가 20,000원~<br>LED gate 사용료 ~440,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls[0]?.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
    maximum: option.price_max_krw,
  })), [
    { name: "현장 중계", minimum: 220_000, maximum: 330_000 },
    { name: "음료 추가", minimum: 20_000, maximum: null },
    { name: "LED gate 사용료", minimum: null, maximum: 440_000 },
  ]);
});

test("raw gender and count variants retain their row-local option context", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "변형문맥예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A3: 예식홀명",
        "Sheet1!F3: 선택품목 가격",
        "Sheet1!A5: 별빛홀",
        "Sheet1!F5: 혼주헤어&메이크업<br>여 200,000원/남 70,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls[0]?.options.map((option) => ({
    name: option.name,
    condition: option.condition,
    minimum: option.price_min_krw,
  })), [
    { name: "여", condition: "혼주헤어&메이크업", minimum: 200_000 },
    { name: "남", condition: "혼주헤어&메이크업", minimum: 70_000 },
  ]);
  assert.match(
    extraction.halls[0]?.options[0]?.source_quote ?? "",
    /Sheet1!F5: 혼주헤어&메이크업/u,
  );

  const verboseGenderExtraction = extractDisclosureFromLocalEvidence({
    canonicalName: "긴성별표기예식장",
    regionCode: "seoul_etc",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A3: 예식홀명",
        "Sheet1!F3: 선택품목 가격",
        "Sheet1!A5: 달빛홀",
        "Sheet1!F5: 혼주헤어&메이크업<br>여자 200,000원/남자 70,000원",
      ].join("\n"),
    }],
  });
  assert.deepEqual(verboseGenderExtraction.halls[0]?.options.map((option) => ({
    name: option.name,
    condition: option.condition,
  })), [
    { name: "여자", condition: "혼주헤어&메이크업" },
    { name: "남자", condition: "혼주헤어&메이크업" },
  ]);

  const agencyExtraction = extractDisclosureFromLocalEvidence({
    canonicalName: "변형문맥대행사",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A1: 스튜디오 가격",
        "스튜디오!A3: 사업자명",
        "스튜디오!A4: 별빛스튜디오",
        "스튜디오!F4: 드레스 추가 피팅비",
        "스튜디오!G4: 1벌 20,000원/3벌 50,000원",
      ].join("\n"),
    }],
  });
  assert.deepEqual(agencyExtraction.partner_vendors[0]?.options.map((option) => ({
    name: option.name,
    condition: option.condition,
    minimum: option.price_min_krw,
  })), [
    { name: "1벌", condition: "드레스 추가 피팅비", minimum: 20_000 },
    { name: "3벌", condition: "드레스 추가 피팅비", minimum: 50_000 },
  ]);
});

test("a trailing discount label outranks unrelated prose in the same vendor row", () => {
  const text = [
    "## 시트: 본식 스냅",
    "본식 스냅!A1: 본식 스냅 가격",
    "본식 스냅!A3: 사업자명",
    "본식 스냅!G3: 기타 옵션",
    "본식 스냅!A4: 별빛포토",
    "본식 스냅!E4: 촬영 기본 구성과 진행 순서를 설명하는 긴 안내 문구",
    "본식 스냅!G4: 10만원 할인",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "후행라벨근거테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
  })), [{ name: "할인", minimum: 100_000 }]);
  assert.match(extraction.partner_vendors[0]!.options[0]!.source_quote, /본식 스냅!G4: 10만원 할인/u);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("hall-like service phrases never become hall identities", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "편안한예식장",
    regionCode: "gyeonggi",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "□ 편안한예식장",
        "① 가격(VAT 포함)",
        "현장 중계 (홀 내부 스크린 중계용)",
        "웨딩홀 LED gate 사용료",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls.map(({ hall_name }) => hall_name), ["편안한예식장"]);
});

test("a source document title provides a review-only venue identity when no hall row exists", () => {
  const workbook = extractDisclosureFromLocalEvidence({
    canonicalName: "푸른호텔",
    regionCode: "gyeonggi",
    kindHint: "hall",
    hasImages: true,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 예식장",
        "예식장!A1: 󰊱 푸른호텔",
        "예식장!A2: ① 가격(VAT 포함)",
        "예식장!A20: 계약 취소 위약금 안내",
      ].join("\n"),
    }],
  });
  const pdf = extractDisclosureFromLocalEvidence({
    canonicalName: "라부쏠라",
    regionCode: "gwangju",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: ["□ 라부쏠라", "① 가격(VAT 포함)", "상세 가격은 별도 안내"].join("\n"),
    }],
  });

  assert.deepEqual(workbook.halls.map((hall) => ({
    name: hall.hall_name,
    price: hall.venue_fee_min_krw,
    quote: normalizeEvidenceText(hall.source_quote),
  })), [{ name: "푸른호텔", price: null, quote: "예식장!A1: 󰊱 푸른호텔" }]);
  assert.deepEqual(pdf.halls.map((hall) => ({
    name: hall.hall_name,
    price: hall.venue_fee_min_krw,
    quote: normalizeEvidenceText(hall.source_quote),
  })), [{ name: "라부쏠라", price: null, quote: "line:1: □ 라부쏠라" }]);
});

test("filename metadata alone never invents a hall identity", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "파일명에만있는웨딩홀",
    regionCode: "gyeonggi",
    kindHint: "hall",
    hasImages: true,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: "※ 위약금 산정기준은 소비자 귀책사유 시에만 적용",
    }],
  });

  assert.deepEqual(extraction.halls, []);
});

test("adult and child meal variants remain exact options instead of a collapsed aggregate", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "식대분리예식장",
    regionCode: "chungcheong",
    kindHint: "hall",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A3: 예식홀",
        "Sheet1!C3: 식비",
        "Sheet1!A5: 라페니체",
        "Sheet1!C5: 성인 49,000원 / 소인 24,500원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.halls.map((hall) => ({
    name: hall.hall_name,
    meal: [hall.meal_price_min_krw, hall.meal_price_max_krw],
    options: hall.options.map((option) => ({
      name: option.name,
      minimum: option.price_min_krw,
      maximum: option.price_max_krw,
    })),
  })), [{
    name: "라페니체",
    meal: [null, null],
    options: [
      { name: "성인", minimum: 49_000, maximum: 49_000 },
      { name: "소인", minimum: 24_500, maximum: 24_500 },
    ],
  }]);
  assert.doesNotMatch(extraction.extraction_notes, /\[local_semantic_binding_quarantine\]/u);
});

test("a canonical comma-grouped bare price needs an exact unit and price-semantic column", () => {
  const text = [
    "## 시트: 스튜디오",
    "스튜디오!A1: 󰊱 안전웨딩",
    "스튜디오!A2: ① 가격(단위: 원, VAT 포함)",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "병합 범위 B3:C3 · 좌상단 B3",
    "스튜디오!A5: 별빛스튜디오",
    "스튜디오!B5: 20페이지 앨범",
    "스튜디오!C5: 1,330,000",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "안전웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options.map((option) => ({
    price: option.price_min_krw,
    name: option.name,
  })), [{ price: 1_330_000, name: "20페이지 앨범" }]);
  assert.match(extraction.partner_vendors[0]!.options[0]!.source_quote, /단위: 원/u);
  assert.match(extraction.partner_vendors[0]!.options[0]!.source_quote, /기본가격/u);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("declared units never promote bare contact quantity or malformed numeric tokens", () => {
  const text = [
    "## 시트: 스튜디오",
    "스튜디오!A1: 금액 단위: 원",
    "스튜디오!A2: 사업자명",
    "스튜디오!B2: 기본가격",
    "병합 범위 B2:C2 · 좌상단 B2",
    "스튜디오!A3: 안전스튜디오",
    "스튜디오!B3: 보증 인원",
    "스튜디오!C3: 1,000",
    "스튜디오!B4: 연락처",
    "스튜디오!C4: 010,123,456",
    "스튜디오!B5: 계좌",
    "스튜디오!C5: 123,456,789",
    "스튜디오!B6: 본식 가격",
    "스튜디오!C6: 1,33,000",
    "스튜디오!B7: 촬영 가격",
    "스튜디오!C7: 1.330.000",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "숫자격리웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options, []);
  assert.match(extraction.extraction_notes, /local_structured_money_quarantine/u);
});

test("an exact nearby category heading wins over a misleading sheet name", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "카테고리우선웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A1: 카테고리우선웨딩",
        "스튜디오!A2: 드레스 가격 안내",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!A4: 달빛드레스",
        "스튜디오!B4: 본식 180만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.partner_vendors.map(({ vendor_name, category }) => ({
    vendor_name,
    category,
  })), [{ vendor_name: "달빛드레스", category: "dress" }]);
});

test("the exact generic title 예식장업 is never treated as a cross-business identity", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "통합웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A1: 통합웨딩",
        "스튜디오!A2: 스튜디오 가격",
        "스튜디오!A3: 사업자명",
        "스튜디오!B3: 기본가격",
        "스튜디오!A4: 별빛스튜디오",
        "스튜디오!B4: 촬영 120만원",
        "## 시트: 드레스",
        "드레스!A1: 예식장업",
        "드레스!A2: 드레스 가격",
        "드레스!A3: 사업자명",
        "드레스!B3: 기본가격",
        "드레스!A4: 달빛드레스",
        "드레스!B4: 본식 180만원",
        "## 시트: 메이크업",
        "메이크업!A1: 예식장업",
        "메이크업!A2: 메이크업 가격",
        "메이크업!A3: 사업자명",
        "메이크업!B3: 기본가격",
        "메이크업!A4: 온유메이크업",
        "메이크업!B4: 본식 90만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(
    extraction.partner_vendors.map(({ category }) => category),
    ["studio", "dress", "makeup"],
  );
  assert.doesNotMatch(extraction.extraction_notes, /cross_business_sheet_identity/u);
});

test("a service terms heading is not a business identity and its exact policy money remains covered", () => {
  const text = [
    "## 시트: 가격표",
    "가격표!A1: 세인트웨딩",
    "가격표!A2: 스튜디오 가격",
    "가격표!A3: 사업자명",
    "가격표!B3: 기본가격",
    "가격표!A4: 별빛스튜디오",
    "가격표!B4: 촬영 120만원",
    "## 시트: 약관",
    "약관!A1: 웨딩 서비스 이용 약관",
    "약관!A2: 계약 취소 및 환불 규정",
    "약관!A3: 계약 후 7일 이내 상담 실비 33,000원 공제 후 환불",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "세인트웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.doesNotMatch(extraction.extraction_notes, /cross_business_sheet_identity:약관/u);
  assert.ok(extraction.sections.some(({ content_verbatim }) => (
    content_verbatim.includes("33,000원")
  )));
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("regional identity affixes are allowed but business words are never reordered", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "더시그너스웨딩",
    regionCode: "gwangju",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 기준",
        "기준!A1: 더시그너스웨딩",
        "기준!A2: 스튜디오 가격",
        "기준!A3: 사업자명",
        "기준!B3: 기본가격",
        "기준!A4: 별빛스튜디오",
        "기준!B4: 촬영 120만원",
        "## 시트: 지역표기",
        "지역표기!A1: 광주 더시그너스웨딩",
        "지역표기!A2: 드레스 가격",
        "지역표기!A3: 사업자명",
        "지역표기!B3: 기본가격",
        "지역표기!A4: 달빛드레스",
        "지역표기!B4: 본식 180만원",
        "## 시트: 순서바꿈",
        "순서바꿈!A1: 웨딩 더시그너스",
        "순서바꿈!A2: 메이크업 가격",
        "순서바꿈!A3: 사업자명",
        "순서바꿈!B3: 기본가격",
        "순서바꿈!A4: 온유메이크업",
        "순서바꿈!B4: 본식 90만원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.partner_vendors.map(({ category }) => category), ["studio", "dress"]);
  assert.match(extraction.extraction_notes, /cross_business_sheet_identity:순서바꿈/u);
  assert.doesNotMatch(extraction.extraction_notes, /cross_business_sheet_identity:지역표기/u);
});

test("source-backed traditional attire terms map to the public dress taxonomy", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "청주상의원",
    regionCode: "chungcheong",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: Sheet1",
        "Sheet1!A1: 󰊱 청주상의원",
        "Sheet1!A2: ① 가격(VAT 포함)",
        "Sheet1!A3: 기본가격",
        "Sheet1!A4: 우리옷 대여(1벌기준)",
        "Sheet1!B4: 명주실크 550,000원",
      ].join("\n"),
    }],
  });

  assert.deepEqual(extraction.partner_vendors.map(({ vendor_name, category }) => ({
    vendor_name,
    category,
  })), [{ vendor_name: "청주상의원", category: "dress" }]);
});

test("an explicit subminimum won add-on is retained only under exact price semantics", () => {
  const text = [
    "## 시트: 스튜디오",
    "스튜디오!A1: 금액 단위: 만원",
    "스튜디오!A2: 스튜디오 가격",
    "스튜디오!A3: 사업자명",
    "스튜디오!F3: 기타 옵션",
    "병합 범위 F3:G3 · 좌상단 F3",
    "스튜디오!A4: 별빛스튜디오",
    "스튜디오!F4: 앨범페이지 추가",
    "스튜디오!G4: 5500원",
    "스튜디오!F5: 선수정본 추가",
    "스튜디오!G5: 5.5천원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "소액근거웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options.map((option) => ({
    name: option.name,
    price: option.price_min_krw,
  })), [
    { name: "앨범페이지 추가", price: 5_500 },
    { name: "선수정본 추가", price: 5_500 },
  ]);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("equal slash-separated prices use the exact same-position compound header labels", () => {
  const text = [
    "## 시트: 스튜디오",
    "스튜디오!A2: 스튜디오 가격",
    "스튜디오!A3: 사업자명",
    "스튜디오!E3: 야외/야간",
    "스튜디오!A4: 별빛스튜디오",
    "스튜디오!E4: 11만원 / 11만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "복합헤더웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.deepEqual(extraction.partner_vendors[0]?.options.map((option) => ({
    name: option.name,
    price: option.price_min_krw,
  })), [
    { name: "야외", price: 110_000 },
    { name: "야간", price: 110_000 },
  ]);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("compound headers never fan out when label and price arity differ", () => {
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "복합헤더격리웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{
      sourceFileId: SOURCE_FILE_ID,
      text: [
        "## 시트: 스튜디오",
        "스튜디오!A2: 스튜디오 가격",
        "스튜디오!A3: 사업자명",
        "스튜디오!E3: 야외/야간/로드씬",
        "스튜디오!A4: 별빛스튜디오",
        "스튜디오!E4: 11만원 / 22만원",
      ].join("\n"),
    }],
  });

  assert.equal(extraction.partner_vendors[0]?.options.some(({ name }) => (
    ["야외", "야간", "로드씬"].includes(name)
  )), false);
});

test("repeated equal amounts in distinct labeled clauses retain their exact preceding condition", () => {
  const text = [
    "## 시트: 드레스",
    "드레스!A2: 드레스 가격",
    "드레스!A3: 사업자명",
    "드레스!B3: 기본가격",
    "드레스!A4: 달빛드레스",
    "드레스!B4: 본식만 1벌 183만원 / 이벤트금액 160만원<br>촬영만 3벌 183만원 / 이벤트금액 160만원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "반복금액웨딩",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });
  const repeated = extraction.partner_vendors[0]?.options.filter((option) => (
    option.name === "이벤트금액" && option.price_min_krw === 1_600_000
  ));

  assert.deepEqual(repeated?.map(({ condition }) => condition), ["본식만 1벌", "촬영만 3벌"]);
  assert.equal(findCoverageGaps(text, extraction, { includeAuditLedger: false }).length, 0);
});

test("declared-unit conflicts and comma-grouped bare anomalies stay ledger-only with explicit gaps", () => {
  const text = [
    "## 시트: 스튜디오",
    "스튜디오!A2: ① 가격(단위: 만원, VAT 포함)",
    "스튜디오!A4: 사업체명",
    "스튜디오!B4: 기본가격",
    "스튜디오!E5: 기타옵션 (의상추가 드레스기준)",
    "스튜디오!A6: 정상업체",
    "스튜디오!E6: 촬영의상추가시:1벌당11~22<br>앨범페이지추가:1페이지당3.3",
    "스튜디오!A30: 셀럽비비",
    "스튜디오!E30: 선수정본:5컷5.5천원 <br>촬영의상추가시:1벌당11~22<br>앨범페이지추가:1페이지당3.3",
    "스튜디오!A40: 탱자스튜디오",
    "스튜디오!E40: 선수정본:1컷16,500<br>촬영의상추가시:22~ <br>앨범페이지추가:1페이지당 3.3",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "다이렉트컴즈",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  const anomalous = extraction.partner_vendors.flatMap((vendor) => (
    vendor.options.filter((option) => (
      option.source_quote.includes("스튜디오!E30") && option.price_min_krw === 5_500
    ) || (
      option.source_quote.includes("스튜디오!E40") && option.price_min_krw === 16_500
    ))
  ));
  assert.deepEqual(anomalous, []);
  assert.ok(extraction.money_occurrences.some(({ amount_krw, source_quote }) => (
    amount_krw === 5_500 && source_quote.includes("스튜디오!E30")
  )));
  assert.ok(extraction.money_occurrences.some(({ amount_krw, source_quote }) => (
    amount_krw === 16_500 && source_quote.includes("스튜디오!E40")
  )));
  assert.deepEqual(
    findCoverageGaps(text, extraction)
      .filter(({ source_locator }) => ["스튜디오!E30", "스튜디오!E40"].includes(source_locator))
      .map(({ source_locator, krw }) => ({ source_locator, krw })),
    [
      { source_locator: "스튜디오!E30", krw: 5_500 },
      { source_locator: "스튜디오!E40", krw: 16_500 },
    ],
  );
  assert.ok(extraction.partner_vendors.some((vendor) => vendor.options.some((option) => (
    option.price_min_krw === 110_000 || option.price_min_krw === 220_000
  ))));
});

test("a merged vendor span keeps exact 기타옵션 continuation cancellation fees as row-labeled options", () => {
  const text = [
    "## 시트: 드레스",
    "드레스!A2: ① 가격(VAT 포함)_드레스",
    "드레스!A3: 드레스 사업자명",
    "드레스!I4: 기타 옵션",
    "드레스!A5: 르네아뜰리에",
    "드레스!I5: 재가봉비",
    "드레스!J5: 5.5만원",
    "드레스!I9: 당일일정취소",
    "드레스!J9: 11만원",
    "병합 범위 I4:J4 · 좌상단 I4",
    "병합 범위 A5:A10 · 좌상단 A5",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "케이트웨딩플랜",
    regionCode: "seoul_gangnam3",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  const vendor = extraction.partner_vendors.find(({ vendor_name }) => vendor_name === "르네아뜰리에");
  assert.ok(vendor);
  const cancellation = vendor.options.find((option) => option.source_quote.includes("드레스!J9"));
  assert.deepEqual(cancellation && {
    name: cancellation.name,
    minimum: cancellation.price_min_krw,
    maximum: cancellation.price_max_krw,
  }, {
    name: "당일일정취소",
    minimum: 110_000,
    maximum: 110_000,
  });
  assert.equal(findCoverageGaps(text, extraction).some(({ source_locator }) => (
    source_locator === "드레스!J9"
  )), false);
});
