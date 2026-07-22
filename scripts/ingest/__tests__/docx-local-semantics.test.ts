import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  certifyLocalDocxSharedMoneyGroups,
  extractDisclosureFromLocalEvidence,
} from "../local-extract.js";
import { sourceFileId } from "../provenance.js";
import type { ManifestUnit } from "../types.js";
import { deriveValidatedPayloadForUnit, findCoverageGaps } from "../validate.js";

const SOURCE_FILE_ID = "d".repeat(64);
const DOCX_META_VERSION = 2;

type VerticalMerge = "restart" | "continue" | null;

function columnNumber(column: string): number {
  let result = 0;
  for (const character of column) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

function meta(
  locator: string,
  options: {
    span?: string | null;
    verticalMerge?: VerticalMerge;
    empty?: boolean;
  } = {},
): string {
  const match = /^table:(\d+)!([A-Z]+)(\d+)$/u.exec(locator);
  assert.ok(match);
  const payload = {
    version: DOCX_META_VERSION,
    locator,
    table: Number(match[1]),
    row: Number(match[3]),
    column: columnNumber(match[2]!),
    span: options.span ?? null,
    vertical_merge: options.verticalMerge ?? null,
    empty: options.empty ?? false,
  };
  return `[DOCX_CELL_META] ${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function cell(locator: string, value: string, metadata?: Parameters<typeof meta>[1]): string[] {
  return [
    `${locator}: ${value}`,
    ...(metadata ? [meta(locator, metadata)] : []),
  ];
}

function emptyMergeCell(locator: string, verticalMerge: Exclude<VerticalMerge, null>): string {
  return meta(locator, { verticalMerge, empty: true });
}

test("canonical DOCX vMerge assigns six studio rows and shared option intervals without gaps", () => {
  const text = [
    ...cell("table:1!A1", "구분", { verticalMerge: "restart" }),
    ...cell("table:1!B1", "업체명", { verticalMerge: "restart" }),
    ...cell("table:1!C1", "구성", { verticalMerge: "restart" }),
    ...cell("table:1!D1", "선택 품목", { span: "D1:E1" }),
    emptyMergeCell("table:1!A2", "continue"),
    emptyMergeCell("table:1!B2", "continue"),
    emptyMergeCell("table:1!C2", "continue"),
    ...cell("table:1!D2", "야간 및 야외 촬영"),
    ...cell("table:1!E2", "기타 옵션"),
    ...cell("table:1!A3", "스튜디오", { verticalMerge: "restart" }),
    ...cell("table:1!B3", "별빛사진관"),
    ...cell("table:1!C3", "99만원"),
    ...cell("table:1!D3", "11만원~22만원", { verticalMerge: "restart" }),
    ...cell("table:1!E3", "헬퍼 25만원~", { verticalMerge: "restart" }),
    emptyMergeCell("table:1!A4", "continue"),
    ...cell("table:1!B4", "햇살사진관"),
    ...cell("table:1!C4", "110만원"),
    emptyMergeCell("table:1!D4", "continue"),
    emptyMergeCell("table:1!E4", "continue"),
    emptyMergeCell("table:1!A5", "continue"),
    ...cell("table:1!B5", "구름사진관", { verticalMerge: "restart" }),
    ...cell("table:1!C5", "121만원", { verticalMerge: "restart" }),
    emptyMergeCell("table:1!D5", "continue"),
    emptyMergeCell("table:1!E5", "continue"),
    emptyMergeCell("table:1!A6", "continue"),
    emptyMergeCell("table:1!B6", "continue"),
    emptyMergeCell("table:1!C6", "continue"),
    emptyMergeCell("table:1!D6", "continue"),
    ...cell("table:1!E6", "앨범 추가 3만3천원~", { verticalMerge: "restart" }),
    emptyMergeCell("table:1!A7", "continue"),
    ...cell("table:1!B7", "노을사진관"),
    ...cell("table:1!C7", "122만원"),
    emptyMergeCell("table:1!D7", "continue"),
    emptyMergeCell("table:1!E7", "continue"),
    emptyMergeCell("table:1!A8", "continue"),
    ...cell("table:1!B8", "바람사진관", { verticalMerge: "restart" }),
    ...cell("table:1!C8", "123만원", { verticalMerge: "restart" }),
    emptyMergeCell("table:1!D8", "continue"),
    emptyMergeCell("table:1!E8", "continue"),
    emptyMergeCell("table:1!A9", "continue"),
    emptyMergeCell("table:1!B9", "continue"),
    emptyMergeCell("table:1!C9", "continue"),
    emptyMergeCell("table:1!D9", "continue"),
    ...cell("table:1!E9", "액자 업그레이드"),
    emptyMergeCell("table:1!A10", "continue"),
    ...cell("table:1!B10", "숲사진관"),
    ...cell("table:1!C10", "132만원"),
    emptyMergeCell("table:1!D10", "continue"),
    ...cell("table:1!A11", "드레스"),
    ...cell("table:1!B11", "달빛드레스"),
    ...cell("table:1!C11", "165만원"),
    ...cell("table:1!D11", "헬퍼 25만원~", { span: "D11:E11" }),
    ...cell("table:1!A12", "메이크업"),
    ...cell("table:1!B12", "봄날메이크업"),
    ...cell("table:1!C12", "44만원+77만원"),
    ...cell("table:1!D12", "원장 10만원~, 얼리 22만원, 피스 5만5천원", { span: "D12:E12" }),
  ].join("\n");

  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "합성웨딩",
    regionCode: "gyeonggi",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.equal(extraction.money_occurrences.length, 17);
  assert.deepEqual(
    extraction.partner_vendors.map(({ category }) => category),
    ["studio", "studio", "studio", "studio", "studio", "studio", "dress", "makeup"],
  );
  const studios = extraction.partner_vendors.filter(({ category }) => category === "studio");
  assert.equal(studios.length, 6);
  assert.ok(studios.every(({ options }) => options.some((option) => (
    option.price_min_krw === 110_000 && option.price_max_krw === 220_000
  ))));
  assert.match(studios[4]!.source_quote, /table:1!A3/u);
  assert.equal(findCoverageGaps(text, extraction).length, 0);
  assert.deepEqual(
    certifyLocalDocxSharedMoneyGroups({
      data: extraction,
      sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
    }).map(({ authority, source_locator, amount_krw, member_occurrence_keys }) => ({
      authority,
      source_locator,
      amount_krw,
      members: member_occurrence_keys.length,
    })),
    [
      { authority: "vertical_merge_interval", source_locator: "table:1!D3", amount_krw: 110_000, members: 6 },
      { authority: "vertical_merge_interval", source_locator: "table:1!D3", amount_krw: 220_000, members: 6 },
      { authority: "vertical_merge_interval", source_locator: "table:1!E3", amount_krw: 250_000, members: 3 },
      { authority: "vertical_merge_interval", source_locator: "table:1!E6", amount_krw: 33_000, members: 3 },
    ],
  );
});

test("canonical DOCX exact 사업자명 cells safely fan out comma-separated identities only", () => {
  const studioNamesA = Array.from({ length: 13 }, (_, index) => `사진업체${index + 1}`).join(",");
  const studioNamesB = ["노을사진", "구름사진", "바다사진"].join(", ");
  const text = [
    ...cell("table:1!A1", "사업자명", { verticalMerge: "restart" }),
    ...cell("table:1!B1", "기본가격", { verticalMerge: "restart" }),
    ...cell("table:1!C1", "주요 선택 품목", { span: "C1:E1" }),
    emptyMergeCell("table:1!A2", "continue"),
    emptyMergeCell("table:1!B2", "continue"),
    ...cell("table:1!C2", "담당 지정"),
    ...cell("table:1!D2", "야외 촬영"),
    ...cell("table:1!E2", "기타 옵션"),
    ...cell("table:1!A3", studioNamesA),
    ...cell("table:1!B3", "100만원"),
    ...cell("table:1!C3", "10만원~20만원"),
    ...cell("table:1!E3", "스튜디오 원본 권한"),
    ...cell("table:1!A4", studioNamesB),
    ...cell("table:1!B4", "120만원"),
    ...cell("table:1!C4", "10만원~20만원"),
    ...cell("table:1!E4", "스튜디오 원본 권한"),
    ...cell("table:1!A5", "별사진"),
    ...cell("table:1!B5", "150만원"),
    ...cell("table:1!C5", "10만원~20만원"),
    ...cell("table:1!E5", "스튜디오 원본 권한"),
    ...cell("table:2!A1", "사업자명"),
    ...cell("table:2!B1", "기본가격"),
    ...cell("table:2!C1", "드레스 선택"),
    ...cell("table:2!A2", "달빛드레스"),
    ...cell("table:2!B2", "100만원"),
    ...cell("table:2!C2", "헬퍼 15만원, 디자인 50만원~100만원"),
    ...cell("table:3!A1", "사업자명"),
    ...cell("table:3!B1", "기본가격"),
    ...cell("table:3!C1", "메이크업 선택"),
    ...cell("table:3!A2", "봄날메이크업"),
    ...cell("table:3!B2", "50만원~80만원, 혼주 5만원~15만원"),
    ...cell("table:3!C2", "원장 지정 30만원"),
  ].join("\n");

  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "합성호텔",
    regionCode: "jeolla",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.equal(extraction.money_occurrences.length, 18);
  assert.equal(extraction.partner_vendors.length, 19);
  assert.deepEqual(
    Object.fromEntries(["studio", "dress", "makeup"].map((category) => [
      category,
      extraction.partner_vendors.filter((vendor) => vendor.category === category).length,
    ])),
    { studio: 17, dress: 1, makeup: 1 },
  );
  const firstGroup = extraction.partner_vendors.filter(({ vendor_name }) => (
    /^사진업체(?:[1-9]|1[0-3])$/u.test(vendor_name)
  ));
  assert.equal(firstGroup.length, 13);
  assert.equal(new Set(firstGroup.map(({ source_quote }) => source_quote)).size, 1);
  assert.ok(firstGroup.every(({ options }) => options.some(({ price_min_krw, price_max_krw }) => (
    price_min_krw === 100_000 && price_max_krw === 200_000
  ))));
  assert.equal(findCoverageGaps(text, extraction).length, 0);
  assert.deepEqual(
    certifyLocalDocxSharedMoneyGroups({
      data: extraction,
      sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
    }).map(({ authority, source_locator, amount_krw, member_occurrence_keys }) => ({
      authority,
      source_locator,
      amount_krw,
      members: member_occurrence_keys.length,
    })),
    [
      { authority: "business_identity_fan_out", source_locator: "table:1!B3", amount_krw: 1_000_000, members: 13 },
      { authority: "business_identity_fan_out", source_locator: "table:1!C3", amount_krw: 100_000, members: 13 },
      { authority: "business_identity_fan_out", source_locator: "table:1!C3", amount_krw: 200_000, members: 13 },
      { authority: "business_identity_fan_out", source_locator: "table:1!B4", amount_krw: 1_200_000, members: 3 },
      { authority: "business_identity_fan_out", source_locator: "table:1!C4", amount_krw: 100_000, members: 3 },
      { authority: "business_identity_fan_out", source_locator: "table:1!C4", amount_krw: 200_000, members: 3 },
    ],
  );
});

test("DOCX identity fan-out rejects legal entities, parentheses, and descriptive comma prose", () => {
  const unsafeIdentities = [
    "주식회사 햇살, 웨딩사업부",
    "달빛(본점, 별관)",
    "구름사진, 계약 취소 시 위약금 적용",
  ];
  const text = [
    ...cell("table:1!A1", "사업자명", { verticalMerge: "restart" }),
    ...cell("table:1!B1", "기본가격", { verticalMerge: "restart" }),
    emptyMergeCell("table:1!A2", "continue"),
    emptyMergeCell("table:1!B2", "continue"),
    ...unsafeIdentities.flatMap((name, index) => [
      ...cell(`table:1!A${index + 3}`, name),
      ...cell(`table:1!B${index + 3}`, `${index + 1}00만원`),
      ...cell(`table:1!C${index + 3}`, "스튜디오 촬영"),
    ]),
  ].join("\n");

  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "분리금지테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  const extractedNames = extraction.partner_vendors.map(({ vendor_name }) => vendor_name);
  assert.deepEqual(extractedNames, unsafeIdentities.slice(0, 2));
  assert.ok(!extractedNames.some((name) => [
    "주식회사 햇살",
    "웨딩사업부",
    "달빛(본점",
    "별관)",
    "구름사진",
    "계약 취소 시 위약금 적용",
  ].includes(name)));
});

test("canonical DOCX hall tables join by an exact key after only removing trailing 단독홀", async (t) => {
  const text = [
    ...cell("table:1!A1", "예식홀명"),
    ...cell("table:1!B1", "최소보증인원"),
    ...cell("table:1!C1", "식비"),
    ...cell("table:1!D1", "대관료, 장식비"),
    ...cell("table:1!A2", "합성호텔<br>그랜드볼룸홀(단독홀)"),
    ...cell("table:1!B2", "150명"),
    ...cell("table:1!C2", "53,000원"),
    ...cell("table:1!D2", "대관료 2,500,000원<br>장식비 없음"),
    ...cell("table:2!A1", "예식홀명", { verticalMerge: "restart" }),
    ...cell("table:2!B1", "선택 품목", { span: "B1:I1" }),
    emptyMergeCell("table:2!A2", "continue"),
    ...cell("table:2!B2", "객실"),
    ...cell("table:2!C2", "음향"),
    ...cell("table:2!D2", "조명"),
    ...cell("table:2!E2", "플라워 샤워"),
    ...cell("table:2!F2", "연출"),
    ...cell("table:2!G2", "폐백"),
    ...cell("table:2!H2", "원판 촬영"),
    ...cell("table:2!I2", "사회 및 헬퍼"),
    ...cell("table:2!A3", "합성호텔<br>그랜드볼룸홀"),
    ...cell("table:2!B3", "객실 10만원"),
    ...cell("table:2!E3", "플라워 샤워 30만원"),
    ...cell("table:2!H3", "원판 촬영 50만원"),
    ...cell("table:2!I3", "사회 30만원~40만원, 헬퍼 15만원"),
  ].join("\n");

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-docx-hall-semantics-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const source: ManifestUnit["source_files"][number] = {
    path: "raw/합성호텔_예식장.docx",
    absolute_path: path.join(temporaryRoot, "합성호텔_예식장.docx"),
    ext: "docx",
    sha256: "e".repeat(64),
    bytes: 1,
  };
  const sourceId = sourceFileId(source);
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "합성호텔_예식장",
    regionCode: "jeolla",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: sourceId, text }],
  });

  assert.equal(extraction.money_occurrences.length, 8);
  assert.equal(extraction.halls.length, 1);
  const hall = extraction.halls[0]!;
  assert.equal(hall.guarantee_min, 150);
  assert.equal(hall.meal_price_min_krw, 53_000);
  assert.equal(hall.venue_fee_min_krw, 2_500_000);
  assert.match(hall.decoration_note ?? "", /장식비 없음/u);
  assert.equal(hall.options.length, 5);
  assert.match(hall.source_quote, /table:1!A2/u);
  assert.ok(hall.options.every(({ source_quote }) => /table:2!/u.test(source_quote)));
  assert.equal(findCoverageGaps(text, extraction).length, 0);

  const artifactDirectory = path.join(temporaryRoot, "converted");
  const artifactPath = path.join(artifactDirectory, "1-doc.txt");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(artifactPath, text, "utf8");
  const unit: ManifestUnit = {
    unit_id: "f".repeat(64),
    display_name: "합성호텔_예식장.docx",
    parsed: {
      region_code: "jeolla",
      raw_name: "합성호텔_예식장",
      normalized_name: "합성호텔_예식장",
      corporate_name: null,
      kind_hint: "hall",
    },
    source_files: [source],
    source_fingerprint: "1".repeat(64),
    stage: "extracted",
    notices: [],
    conversion: {
      converter_version: "docx-semantics-test",
      source_fingerprint: "1".repeat(64),
      text_artifacts: [artifactPath],
      image_artifacts: [],
      text_characters: text.length,
      cell_count: 24,
      artifact_fingerprint: "2".repeat(64),
      converted_at: new Date(0).toISOString(),
    },
  };
  const validated = await deriveValidatedPayloadForUnit(
    unit,
    { data: extraction },
    { mode: "local_deterministic" },
  );
  assert.equal(validated.data.halls?.length, 1);
  assert.equal(validated.data.halls?.[0]?.venue_fee_min_krw, 2_500_000);
  assert.equal(validated.data.halls?.[0]?.decoration_note, "장식비 없음");
  assert.equal(validated.data.halls?.[0]?.options.length, 5);
  assert.equal(validated.coverageGaps.length, 0);
  assert.equal(validated.issues.some(({ code }) => (
    code === "local_hall_venue_fee_quarantined"
    || code === "local_ungrounded_option_quarantined"
  )), false, JSON.stringify(validated.issues));
});

test("malformed or unknown DOCX metadata fails closed while preserving the money audit", () => {
  const valid = meta("table:1!A1", { verticalMerge: "restart" });
  const decoded = JSON.parse(Buffer.from(valid.split(" ")[1]!, "base64url").toString("utf8"));
  const unknownVersion = `[DOCX_CELL_META] ${Buffer.from(JSON.stringify({
    ...decoded,
    version: 999,
  }), "utf8").toString("base64url")}`;
  const text = [
    "table:1!A1: 사업자명",
    unknownVersion,
    "table:1!B1: 기본가격",
    "table:1!A2: 격리업체",
    "table:1!B2: 123만원",
  ].join("\n");

  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "메타격리테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.equal(extraction.partner_vendors.length, 0);
  assert.equal(extraction.money_occurrences.length, 1);
  assert.match(extraction.extraction_notes, /local_docx_metadata_quarantine/u);
  assert.deepEqual(findCoverageGaps(text, extraction).map(({ krw }) => krw), [1_230_000]);
  assert.deepEqual(certifyLocalDocxSharedMoneyGroups({
    data: extraction,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  }), []);
});

test("DOCX body paragraphs can become policy sections without duplicating table money", () => {
  const text = [
    "docx:body:p1: 계약 취소 및 환불 규정",
    "docx:body:p2: 예식 30일 전 취소 시 계약금의 10%를 공제합니다.",
    ...cell("table:1!A1", "사업자명", { verticalMerge: "restart" }),
    ...cell("table:1!B1", "기본가격", { verticalMerge: "restart" }),
    emptyMergeCell("table:1!A2", "continue"),
    emptyMergeCell("table:1!B2", "continue"),
    ...cell("table:1!A3", "햇살사진"),
    ...cell("table:1!B3", "100만원"),
    ...cell("table:1!C3", "스튜디오 촬영"),
  ].join("\n");

  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "본문정책테스트",
    regionCode: "seoul_etc",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });

  assert.equal(extraction.money_occurrences.length, 1);
  assert.ok(extraction.sections.some(({ content_verbatim, source_quote }) => (
    content_verbatim.includes("환불 규정")
    && source_quote.includes("docx:body:p1")
  )));
  assert.equal(findCoverageGaps(text, extraction).length, 0);
});
