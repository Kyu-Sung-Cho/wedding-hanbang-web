import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_STRUCTURED_LINKAGE_SOURCE_CHARACTERS,
  MAX_STRUCTURED_LINKAGE_SOURCE_LINES,
  isStructuredRecordSourceLinkageCode,
  validateStructuredRecordSourceLinkage,
} from "../record-source-linkage.js";
import { encodeMergedEvidenceQuote } from "../merge-evidence.js";
import type { DisclosureExtraction } from "../schemas.js";

function emptyExtraction(): DisclosureExtraction {
  return {
    doc_kind: "partner_price_list",
    business_name: "테스트 업체",
    region_hint: "서울",
    agency_packages: [],
    partner_vendors: [],
    halls: [],
    hall: {
      venue_fee_krw: null,
      meal_price_min_krw: null,
      meal_price_max_krw: null,
      venue_fee_source_quote: null,
      meal_price_source_quote: null,
      items: [],
      confidence: 0,
      needs_review: true,
    },
    extraction_notes: "test fixture",
  };
}

function mergedEvidence(
  fragments: Array<{ source_file_id: string; quote: string }>,
): string {
  const encoded = encodeMergedEvidenceQuote(fragments, 2_000);
  assert.notEqual(encoded, null);
  return encoded ?? "";
}

test("a B1 vendor cannot borrow a B10 row merely because its name is a prefix", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "업체 B1",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: "가격표!C10: 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A1: 업체 B1",
    "가격표!B1: 스튜디오",
    "가격표!C1: 90만원",
    "가격표!A10: 업체 B10",
    "가격표!B10: 스튜디오",
    "가격표!C10: 100만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some((error) =>
    error.path === "partner_vendors[0].source_quote"
    && error.code === "vendor_identity_not_linked"
  ), true, JSON.stringify(errors));
});

test("a partner price is rejected when the source row names a different category", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "라온",
    old_names: [],
    category: "dress",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: "가격표!C2: 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 라온",
    "가격표!B2: 스튜디오",
    "가격표!C2: 100만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some((error) =>
    error.path === "partner_vendors[0].source_quote"
    && error.code === "vendor_category_not_linked"
  ), true, JSON.stringify(errors));
});

test("a partner policy cannot borrow another vendor's policy row", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "라온스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: null,
    price_max_krw: null,
    base_spec: null,
    price_note: null,
    options: [],
    policies: [{
      policy_type: "penalty",
      raw_text: "위약금 계약금 환불 불가",
      source_quote: "line:1: 다른스튜디오 위약금 계약금 환불 불가",
      source_file_ids: [],
    }],
    source_quote: "line:1: 다른스튜디오 위약금 계약금 환불 불가",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });

  const errors = validateStructuredRecordSourceLinkage(
    data,
    "다른스튜디오 위약금 계약금 환불 불가",
  );

  assert.equal(errors.some((error) =>
    error.path === "partner_vendors[0].policies[0].source_quote"
    && error.code === "vendor_identity_not_linked"
  ), true, JSON.stringify(errors));
});

test("a partner policy requires exact policy text and a conservative type label", () => {
  const makeData = (): DisclosureExtraction => {
    const data = emptyExtraction();
    data.partner_vendors.push({
      vendor_name: "라온스튜디오",
      old_names: [],
      category: "studio",
      price_min_krw: null,
      price_max_krw: null,
      base_spec: null,
      price_note: null,
      options: [],
      policies: [{
        policy_type: "penalty",
        raw_text: "위약금 계약금 환불 불가",
        source_quote: "line:1: 라온스튜디오 위약금 계약금 환불 불가",
        source_file_ids: [],
      }],
      source_quote: "line:1: 라온스튜디오 위약금 계약금 환불 불가",
      source_file_ids: [],
      confidence: 0.99,
      needs_review: false,
    });
    return data;
  };
  const sourceText = "라온스튜디오 위약금 계약금 환불 불가";
  assert.deepEqual(validateStructuredRecordSourceLinkage(makeData(), sourceText), []);

  const fabricatedText = makeData();
  const fabricatedPolicy = fabricatedText.partner_vendors.at(0)?.policies?.at(0);
  assert.ok(fabricatedPolicy);
  fabricatedPolicy.raw_text = "위약금 전액 면제";
  assert.equal(validateStructuredRecordSourceLinkage(fabricatedText, sourceText).some(
    ({ code }) => code === "vendor_policy_text_not_linked",
  ), true);

  const wrongType = makeData();
  const wronglyTypedPolicy = wrongType.partner_vendors.at(0)?.policies?.at(0);
  assert.ok(wronglyTypedPolicy);
  wronglyTypedPolicy.policy_type = "change";
  assert.equal(validateStructuredRecordSourceLinkage(wrongType, sourceText).some(
    ({ code }) => code === "vendor_policy_type_not_linked",
  ), true);
});

test("a priced record without an exact XLSX or line locator fails closed", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "라온",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: "라온 스튜디오 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });

  const errors = validateStructuredRecordSourceLinkage(data, "라온 스튜디오 100만원");

  assert.deepEqual(errors.map(({ path, code }) => ({ path, code })), [{
    path: "partner_vendors[0].source_quote",
    code: "source_locator_invalid",
  }]);
});

test("XLSX drawing linkage requires the exact auxiliary locator and payload", () => {
  const locator = "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1";
  const payload = "베이직 A 스튜디오 100만원";
  const sourceText = `${locator}: ${payload}`;
  const makeData = (sourceQuote: string): DisclosureExtraction => {
    const data = emptyExtraction();
    data.agency_packages.push({
      package_name: "베이직 A",
      category_scope: ["studio"],
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      vat_note: null,
      price_note: null,
      options: [],
      source_quote: sourceQuote,
      source_file_ids: [],
      confidence: 0.99,
      needs_review: false,
    });
    return data;
  };

  assert.deepEqual(validateStructuredRecordSourceLinkage(
    makeData(sourceText),
    sourceText,
  ), []);
  assert.deepEqual(validateStructuredRecordSourceLinkage(
    makeData(`${locator}: 베이직 A 스튜디오`),
    sourceText,
  ).map(({ code }) => code), ["source_quote_payload_mismatch"]);
  assert.deepEqual(validateStructuredRecordSourceLinkage(
    makeData("XLSX_DRAWING xl/drawings/drawing1.xml#text-box-2: 베이직 A 스튜디오 100만원"),
    sourceText,
  ).map(({ code }) => code), ["source_locator_invalid"]);
  assert.deepEqual(validateStructuredRecordSourceLinkage(
    makeData("line:1: 베이직 A 스튜디오 100만원"),
    sourceText,
  ).map(({ code }) => code), ["source_locator_invalid"]);
});

test("a model-proposed old name alone cannot authenticate a different vendor", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "새 이름",
    old_names: ["라온.스튜디오"],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: "line:2: 라온-스튜디오 | 스튜디오 | 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "제휴업체 가격표",
    "라온-스튜디오 | 스튜디오 | 100만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);
  assert.equal(errors.some(({ code }) => code === "vendor_identity_not_linked"), true);
});

test("an explicit source rename relationship containing both identities is accepted", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "라온웨딩",
    old_names: ["라온스튜디오"],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: "line:2: 라온웨딩 (구 상호: 라온스튜디오) | 스튜디오 | 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "제휴업체 가격표",
    "라온웨딩 (구 상호: 라온스튜디오) | 스튜디오 | 100만원",
  ].join("\n");

  assert.deepEqual(validateStructuredRecordSourceLinkage(data, sourceText), []);
});

test("an agency package price cannot be attached to another package row", () => {
  const data = emptyExtraction();
  data.doc_kind = "agency_disclosure";
  data.agency_packages.push({
    package_name: "베이직 A",
    category_scope: ["studio", "dress", "makeup"],
    price_min_krw: 1_500_000,
    price_max_krw: 1_500_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "상품!B3: 150만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 상품",
    "상품!A3: 프리미엄 B",
    "상품!B3: 150만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some((error) =>
    error.path === "agency_packages[0].source_quote"
    && error.code === "package_identity_not_linked"
  ), true, JSON.stringify(errors));
});

test("a blank XLSX column separates independent side-by-side tables", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "패키지 A",
    category_scope: ["studio"],
    price_min_krw: 2_000_000,
    price_max_krw: 2_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "가격표!E2: 200만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 패키지 A",
    "가격표!B2: 스튜디오",
    "가격표!D2: 패키지 B 스튜디오",
    "가격표!E2: 200만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some(({ code }) => code === "package_identity_not_linked"), true);
});

test("a contiguous XLSX identity, category, and price row remains valid", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "패키지 A",
    category_scope: ["studio"],
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "가격표!C2: 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 패키지 A",
    "가격표!B2: 스튜디오",
    "가격표!C2: 100만원",
  ].join("\n");

  assert.deepEqual(validateStructuredRecordSourceLinkage(data, sourceText), []);
});

test("adjacent XLSX tables without a blank column fail closed as ambiguous", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "패키지 A",
    category_scope: ["studio"],
    price_min_krw: 2_000_000,
    price_max_krw: 2_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "가격표!D2: 200만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 패키지 A",
    "가격표!B2: 스튜디오 100만원",
    "가격표!C2: 패키지 B",
    "가격표!D2: 스튜디오 200만원",
  ].join("\n");

  // The converter emits neither borders nor table ids. With every column
  // occupied, the guard must not invent the B/C table boundary. This remains
  // blocked even when the model omitted package B from its extraction output.
  const errors = validateStructuredRecordSourceLinkage(data, sourceText);
  assert.equal(errors.some(({ code }) => code === "source_record_scope_ambiguous"), true);
});

test("a priced agency category scope must be explicit in the bounded evidence", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "패키지 A",
    category_scope: ["studio"],
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "가격표!C2: 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 패키지 A",
    "가격표!B2: 드레스",
    "가격표!C2: 100만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);
  assert.equal(errors.some(({ code }) => code === "package_category_not_linked"), true);
});

test("a hall price cannot be attached to another hall row", () => {
  const data = emptyExtraction();
  data.doc_kind = "hall_disclosure";
  data.halls = [{
    hall_name: "그랜드 홀",
    guarantee_min: 200,
    meal_price_min_krw: 80_000,
    meal_price_max_krw: 80_000,
    venue_fee_min_krw: null,
    venue_fee_max_krw: null,
    venue_fee_note: null,
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [],
    source_quote: "홀가격!C4: 8만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];
  const sourceText = [
    "## 시트: 홀가격",
    "홀가격!A4: 오션 홀",
    "홀가격!B4: 식대",
    "홀가격!C4: 8만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some((error) =>
    error.path === "halls[0].source_quote"
    && error.code === "hall_identity_not_linked"
  ), true, JSON.stringify(errors));
});

test("a priced XLSX row inherits vendor identity and category from vertical merge anchors", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "라온",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: "가격표!C3: 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 라온",
    "가격표!B2: 스튜디오",
    "가격표!C3: 100만원",
    "",
    "병합 범위 A2:A3 · 좌상단 A2",
    "병합 범위 B2:B3 · 좌상단 B2",
  ].join("\n");

  assert.deepEqual(validateStructuredRecordSourceLinkage(data, sourceText), []);
});

test("a priced option is linked against its parent package identity", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "베이직 A",
    category_scope: ["studio"],
    price_min_krw: null,
    price_max_krw: null,
    vat_note: null,
    price_note: null,
    options: [{
      name: "원본 추가",
      price_min_krw: 100_000,
      price_max_krw: 100_000,
      unit: "1건",
      condition: null,
      raw_text: "원본 추가 10만원",
      source_quote: "상품!C7: 원본 추가 10만원",
      source_file_ids: [],
    }],
    source_quote: "상품!A6: 베이직 A",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 상품",
    "상품!A7: 프리미엄 B",
    "상품!C7: 원본 추가 10만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some((error) =>
    error.path === "agency_packages[0].options[0].source_quote"
    && error.code === "package_identity_not_linked"
  ), true, JSON.stringify(errors));
});

test("a priced option is linked against its parent vendor identity and category", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "라온",
    old_names: [],
    category: "studio",
    price_min_krw: null,
    price_max_krw: null,
    base_spec: null,
    price_note: null,
    options: [{
      name: "원본 추가",
      price_min_krw: 100_000,
      price_max_krw: 100_000,
      unit: "1건",
      condition: null,
      raw_text: "원본 추가 10만원",
      source_quote: "가격표!C9: 원본 추가 10만원",
      source_file_ids: [],
    }],
    source_quote: "가격표!A8: 라온",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A9: 다른 업체",
    "가격표!B9: 스튜디오",
    "가격표!C9: 원본 추가 10만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some((error) =>
    error.path === "partner_vendors[0].options[0].source_quote"
    && error.code === "vendor_identity_not_linked"
  ), true, JSON.stringify(errors));
});

test("XLSX linkage canonicalizes trailing worksheet whitespace before the locator bang", () => {
  const data = emptyExtraction();
  data.doc_kind = "hall_disclosure";
  const sourceFileId = "a".repeat(64);
  data.halls = [{
    hall_name: "그랜드 볼룸",
    guarantee_min: null,
    meal_price_min_krw: null,
    meal_price_max_krw: null,
    venue_fee_min_krw: 20_000_000,
    venue_fee_max_krw: 20_000_000,
    venue_fee_note: null,
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [],
    source_quote: mergedEvidence([{
      source_file_id: sourceFileId,
      quote: "시그니엘 부산!A5: 그랜드 볼룸",
    }, {
      source_file_id: sourceFileId,
      quote: "시그니엘 부산!B5: 대관료 20,000,000원",
    }]),
    source_file_ids: [sourceFileId],
    confidence: 0.45,
    needs_review: true,
  }];
  const sourceText = [
    "## 시트: 시그니엘 부산 ",
    "시그니엘 부산 !A5: 그랜드 볼룸",
    "시그니엘 부산 !B5: 대관료 20,000,000원",
  ].join("\n");

  assert.deepEqual(validateStructuredRecordSourceLinkage(data, sourceText), []);
});

test("a priced option is linked against its parent hall identity", () => {
  const data = emptyExtraction();
  data.halls = [{
    hall_name: "그랜드 홀",
    guarantee_min: null,
    meal_price_min_krw: null,
    meal_price_max_krw: null,
    venue_fee_min_krw: null,
    venue_fee_max_krw: null,
    venue_fee_note: null,
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [{
      name: "빔 프로젝터",
      price_min_krw: 100_000,
      price_max_krw: 100_000,
      unit: "1회",
      condition: null,
      raw_text: "빔 프로젝터 10만원",
      source_quote: "홀가격!C12: 빔 프로젝터 10만원",
      source_file_ids: [],
    }],
    source_quote: "홀가격!A11: 그랜드 홀",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];
  const sourceText = [
    "## 시트: 홀가격",
    "홀가격!A12: 오션 홀",
    "홀가격!C12: 빔 프로젝터 10만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some((error) =>
    error.path === "halls[0].options[0].source_quote"
    && error.code === "hall_identity_not_linked"
  ), true, JSON.stringify(errors));
});

test("a duplicate XLSX locator across combined sources fails closed as ambiguous", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "베이직 A",
    category_scope: ["studio"],
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "가격표!B2: 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 베이직 A 스튜디오",
    "가격표!B2: 100만원",
    "## 시트: 가격표",
    "가격표!A2: 베이직 A 스튜디오",
    "가격표!B2: 100만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.deepEqual(errors.map(({ path, code }) => ({ path, code })), [{
    path: "agency_packages[0].source_quote",
    code: "source_locator_ambiguous",
  }]);
});

test("an exact locator cannot carry a fabricated source-quote payload", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "베이직 A",
    category_scope: ["studio"],
    price_min_krw: 1_500_000,
    price_max_krw: 1_500_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "가격표!B2: 베이직 A 150만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 베이직 A",
    "가격표!B2: 100만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.deepEqual(errors.map(({ path, code }) => ({ path, code })), [{
    path: "agency_packages[0].source_quote",
    code: "source_quote_payload_mismatch",
  }]);
});

test("the B1 cell locator never resolves to the B10 cell", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "베이직 A",
    category_scope: ["studio"],
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "가격표!B1: 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A10: 베이직 A",
    "가격표!B10: 100만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.deepEqual(errors.map(({ path, code }) => ({ path, code })), [{
    path: "agency_packages[0].source_quote",
    code: "source_locator_invalid",
  }]);
});

test("source evidence indexing has a deterministic character bound", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "베이직 A",
    category_scope: ["studio"],
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "line:1: 베이직 A 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });

  const errors = validateStructuredRecordSourceLinkage(
    data,
    "x".repeat(MAX_STRUCTURED_LINKAGE_SOURCE_CHARACTERS + 1),
  );

  assert.deepEqual(errors.map(({ path, code }) => ({ path, code })), [{
    path: "$",
    code: "source_evidence_limit_exceeded",
  }]);
});

test("source evidence indexing has a deterministic line-count bound", () => {
  const errors = validateStructuredRecordSourceLinkage(
    emptyExtraction(),
    "\n".repeat(MAX_STRUCTURED_LINKAGE_SOURCE_LINES),
  );

  assert.deepEqual(errors.map(({ path, code }) => ({ path, code })), [{
    path: "$",
    code: "source_evidence_limit_exceeded",
  }]);
});

test("merged non-XLSX evidence joins exact globally-numbered line fragments for one record", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "라온",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: mergedEvidence([
      { source_file_id: "a".repeat(64), quote: "line:3: 라온" },
      { source_file_id: "a".repeat(64), quote: "line:4: 스튜디오" },
      { source_file_id: "a".repeat(64), quote: "line:5: 100만원" },
    ]),
    source_file_ids: ["a".repeat(64)],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "첫 번째 변환 문서",
    "제휴업체",
    "라온",
    "스튜디오",
    "100만원",
  ].join("\n");

  assert.deepEqual(validateStructuredRecordSourceLinkage(data, sourceText), []);
});

test("merged line evidence cannot join a remote price from another record", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "Package A",
    category_scope: ["studio"],
    price_min_krw: 2_000_000,
    price_max_krw: 2_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: mergedEvidence([
      { source_file_id: "a".repeat(64), quote: "line:1: Package A studio" },
      { source_file_id: "a".repeat(64), quote: "line:4: KRW 2000000" },
    ]),
    source_file_ids: ["a".repeat(64)],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "Package A studio",
    "KRW 1000000",
    "Package B studio",
    "KRW 2000000",
  ].join("\n");

  assert.deepEqual(
    validateStructuredRecordSourceLinkage(data, sourceText).map(({ code }) => code),
    ["source_record_scope_ambiguous"],
  );
});

test("merged evidence cannot cross source-file ids even at adjacent global lines", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "Package A",
    category_scope: ["studio"],
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: mergedEvidence([
      { source_file_id: "a".repeat(64), quote: "line:1: Package A studio" },
      { source_file_id: "b".repeat(64), quote: "line:2: KRW 1000000" },
    ]),
    source_file_ids: ["a".repeat(64), "b".repeat(64)],
    confidence: 0.99,
    needs_review: false,
  });

  assert.deepEqual(
    validateStructuredRecordSourceLinkage(
      data,
      "Package A studio\nKRW 1000000",
    ).map(({ code }) => code),
    ["source_record_scope_ambiguous"],
  );
});

test("every fragment in merged evidence must independently match its exact source location", () => {
  const data = emptyExtraction();
  data.partner_vendors.push({
    vendor_name: "라온",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: mergedEvidence([
      { source_file_id: "a".repeat(64), quote: "line:1: 라온 스튜디오" },
      { source_file_id: "b".repeat(64), quote: "line:2: 999만원" },
    ]),
    source_file_ids: ["a".repeat(64), "b".repeat(64)],
    confidence: 0.99,
    needs_review: false,
  });

  const errors = validateStructuredRecordSourceLinkage(
    data,
    "라온 스튜디오\n100만원",
  );

  assert.deepEqual(errors.map(({ path, code }) => ({ path, code })), [{
    path: "partner_vendors[0].source_quote",
    code: "source_quote_payload_mismatch",
  }]);
});

test("merged line locators resolve against their declared source-local line numbers", () => {
  const sourceFileId = "a".repeat(64);
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "Package A",
    category_scope: ["studio"],
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: mergedEvidence([
      { source_file_id: sourceFileId, quote: "line:1: Package A studio" },
      { source_file_id: sourceFileId, quote: "line:2: KRW 1000000" },
    ]),
    source_file_ids: [sourceFileId],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceLocalText = "Package A studio\nKRW 1000000";
  const globalText = `unrelated contract\nunrelated penalty\n${sourceLocalText}`;

  assert.equal(
    validateStructuredRecordSourceLinkage(data, globalText).some(
      ({ code }) => code === "source_quote_payload_mismatch",
    ),
    true,
  );
  assert.deepEqual(
    validateStructuredRecordSourceLinkage(
      data,
      globalText,
      new Map([[sourceFileId, sourceLocalText]]),
    ),
    [],
  );
});

test("the exported code predicate gives score a drift-safe linkage classification", () => {
  assert.equal(isStructuredRecordSourceLinkageCode("vendor_identity_not_linked"), true);
  assert.equal(isStructuredRecordSourceLinkageCode("source_locator_ambiguous"), true);
  assert.equal(isStructuredRecordSourceLinkageCode("source_record_scope_ambiguous"), true);
  assert.equal(isStructuredRecordSourceLinkageCode("vendor_policy_text_not_linked"), true);
  assert.equal(isStructuredRecordSourceLinkageCode("unrelated_validation_issue"), false);
  assert.equal(isStructuredRecordSourceLinkageCode(null), false);
});

test("a duplicate address with a distinct payload stays inside its matching sheet section", () => {
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 베이직 A 스튜디오",
    "가격표!B2: 100만원",
    "## 시트: 가격표",
    "가격표!A2: 프리미엄 B 스튜디오",
    "가격표!B2: 200만원",
  ].join("\n");
  const makePackage = (packageName: string): DisclosureExtraction => {
    const data = emptyExtraction();
    data.agency_packages.push({
      package_name: packageName,
      category_scope: ["studio"],
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      vat_note: null,
      price_note: null,
      options: [],
      source_quote: "가격표!B2: 100만원",
      source_file_ids: [],
      confidence: 0.99,
      needs_review: false,
    });
    return data;
  };

  assert.deepEqual(
    validateStructuredRecordSourceLinkage(makePackage("베이직 A"), sourceText),
    [],
  );
  const swapped = validateStructuredRecordSourceLinkage(
    makePackage("프리미엄 B"),
    sourceText,
  );
  assert.equal(swapped.some(({ code }) => code === "package_identity_not_linked"), true);
});

test("legacy hall prices are linked to the disclosed business identity", () => {
  const data = emptyExtraction();
  data.doc_kind = "hall_disclosure";
  data.business_name = "그랜드 웨딩";
  data.hall.venue_fee_krw = 3_000_000;
  data.hall.venue_fee_source_quote = "홀가격!C5: 300만원";
  const sourceText = [
    "## 시트: 홀가격",
    "홀가격!A5: 오션 웨딩",
    "홀가격!B5: 대관료",
    "홀가격!C5: 300만원",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.equal(errors.some((error) =>
    error.path === "hall.venue_fee_source_quote"
    && error.code === "hall_identity_not_linked"
  ), true, JSON.stringify(errors));
});

test("a cell range disguised as source-quote payload is not an exact XLSX locator", () => {
  const data = emptyExtraction();
  data.agency_packages.push({
    package_name: "베이직 A",
    category_scope: ["studio"],
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: "가격표!A1:B2: 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  });
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A1: B2: 100만원",
    "가격표!C1: 베이직 A",
  ].join("\n");

  const errors = validateStructuredRecordSourceLinkage(data, sourceText);

  assert.deepEqual(errors.map(({ path, code }) => ({ path, code })), [{
    path: "agency_packages[0].source_quote",
    code: "source_locator_invalid",
  }]);
});
