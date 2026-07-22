import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPdfLayoutTextEvidence,
  type PdfPositionedTextItem,
} from "../convert.js";
import { extractDisclosureFromLocalEvidence } from "../local-extract.js";
import {
  decodeEvidenceQuote,
  encodeMergedEvidenceQuote,
  MERGED_EVIDENCE_PREFIX,
} from "../merge-evidence.js";
import { sourceFileId } from "../provenance.js";
import type { ManifestUnit } from "../types.js";
import {
  deriveValidatedPayloadForUnit,
  findCoverageGaps,
  payloadContainsExactMoneyRaw,
  scanSourceMoneyOccurrences,
} from "../validate.js";

const SOURCE_FILE_ID = "a".repeat(64);

function row(y: number, items: Array<[text: string, x: number]>): PdfPositionedTextItem[] {
  return items.map(([text, x]) => ({ text, x, y, width: 80, height: 9 }));
}

interface SharedHallLayoutOptions {
  mealHeader?: string;
  alignedHallAmount?: boolean;
  remarksBandHall?: boolean;
  irregularOptionRow?: boolean;
}

function safeSharedHallLayout(options: SharedHallLayoutOptions = {}): string {
  const items = [
    ...row(780, [["가상 컨벤션 가격 정보", 180]]),
    ...row(740, [["1. 대관료 & 식대", 90]]),
    ...row(720, [["대관 및 장식", 200], [options.mealHeader ?? "식대", 354], ["비고", 457]]),
    ...row(700, [["최소 180명(7세~대인)", 318]]),
    ...row(680, options.alignedHallAmount
      ? [["별빛홀", 100], ["3,700,000원", 174]]
      : [["별빛홀", 100]]),
    ...row(660, [["달빛홀", 103], ["일정에 따라 혜택 상이", 439]]),
    ...row(640, [["햇살홀", 103]]),
    ...(options.remarksBandHall ? row(630, [["유령홀", 439]]) : []),
    ...row(620, [["3,100,000원 ~ 4,900,000원", 174], ["55,000원 ~ 65,000원", 322]]),
    ...row(580, [["2. 추가 선택사항 품목", 90]]),
    ...row(560, [["예식 사진", 130], ["610,000원 ~", 238], ["리허설 촬영", 324], ["1,600,000원 ~", 440]]),
    ...row(540, [["예식 영상", 139], ["410,000원 ~", 238], ["드레스&헤어.메이크업", 313], ["1,700,000원 ~", 440]]),
    ...row(520, [["부케 구성", 130], ["210,000원 ~", 238], ["컨시어즈&플라워샤워", 314], ["510,000원 ~", 443]]),
    ...(options.irregularOptionRow
      ? row(510, [["불규칙 선택", 130], ["330,000원 ~", 238], ["설명만 있음", 324]])
      : []),
    ...row(480, [["3. 환불 기준", 90]]),
    ...row(460, [["취소 일정", 138], ["기준 규정", 310], ["비고", 457]]),
    ...row(440, [["80% 환불", 306]]),
    ...row(430, [["계약 체결일 기준 7일 이내", 109]]),
    ...row(420, [["[ 제공 선물과 상담비 공제 ]", 245]]),
    ...row(400, [["예식 149일 전 ~ 90일 이내", 108], ["총 비용의 20% 위약금", 285]]),
    ...row(390, [["총 비용의 기준", 441]]),
    ...row(380, [["예식 89일 전 ~ 50일 이내", 110], ["총 비용의 30% 위약금", 285]]),
    ...row(375, [["대관료, 식대", 445]]),
    ...row(370, [["기타 부대비용", 443]]),
    ...row(360, [["예식 49일 전 ~ 15일 이내", 110], ["총 비용의 60% 위약금", 285]]),
    ...row(350, [["포함", 458]]),
    ...row(340, [["예식 14일 전 ~ 3일 이내", 113], ["총 비용의 70% 위약금", 285]]),
    ...row(320, [["예식 2일 전 ~ 예식 당일", 112], ["총 비용의 80% 위약금", 285]]),
    ...row(300, [["* 소비자 분쟁해결 기준에 해당하는 권고사항 인지 하였으나 웨딩홀 규정 사항 안내 후 동의하에 계약 진행", 122]]),
  ];
  return buildPdfLayoutTextEvidence([{ page: 1, items }]).combinedText;
}

interface StandardSingleHallLayoutOptions {
  driftFoodHeader?: boolean;
  duplicateFoodHeader?: boolean;
  extraOptionMoney?: boolean;
  foodPriceEqualsDecoration?: boolean;
  missingFoodHeader?: boolean;
  omitVenue?: boolean;
  wrongDecorationColumn?: boolean;
}

function safeStandardSingleHallLayout(
  options: StandardSingleHallLayoutOptions = {},
): string {
  const foodHeader = options.missingFoodHeader
    ? "음료"
    : "식음료";
  const decorationHeader = options.duplicateFoodHeader
    ? "식음료"
    : "장식";
  const foodHeaderX = options.driftFoodHeader ? 148 : 183;
  const decorationPriceX = options.wrongDecorationColumn ? 177 : 230;
  const foodPrice = options.foodPriceEqualsDecoration ? "310,000" : "320,000";
  const items = [
    ...row(780, [["1 가상 웨딩홀", 58]]),
    ...row(740, [["1 가격 (VAT 포함)", 62]]),
    ...row(700, [["예식홀명", 65], ["식비", 212], ["대관료", 412]]),
    ...row(680, [["기본", 167], ["160", 197], ["명", 217], ["57,000", 235], ["원", 271]]),
    ...row(670, options.omitVenue
      ? [["가상", 62], ["홀", 104]]
      : [["가상", 62], ["홀", 104], ["대관", 384], ["2,300,000", 414], ["원", 466]]),
    ...row(660, [["추가", 167], ["1", 198], ["명당", 205], ["57,000", 235], ["원", 270]]),
    ...row(640, [["선택품목 가격", 292]]),
    ...row(620, [["예식홀명", 65]]),
    ...row(610, [[foodHeader, foodHeaderX], [decorationHeader, 240], ["연출", 293], ["행사", 346], ["영상", 398], ["사진", 451]]),
    ...row(600, [["폐백", 135], ["기타옵션", 491]]),
    ...row(590, [["추가", 188], ["추가", 240], ["추가", 293], ["진행", 346], ["촬영", 398], ["촬영", 451]]),
    ...row(580, [["장소제공", 127]]),
    ...row(570, [["(", 136], ["음식", 139], ["무제한", 184]]),
    ...row(560, [
      ["가상", 62],
      ["홀", 104],
      ["310,000", decorationPriceX],
      ["원", 265],
      ["제휴업체", 285],
      ["제휴업체", 338],
      ["제휴업체", 390],
      ["제휴업체", 443],
      ["제휴업체", 495],
    ]),
    ...row(550, [["제휴업체", 127], [foodPrice, 177], ["원", 213]]),
    ...(options.extraOptionMoney
      ? row(545, [["추가 선택", 285], ["330,000", 338], ["원", 374]])
      : []),
    ...row(540, [["이용", 136], [")", 156]]),
    ...row(480, [["2 계약해지에 따른 위약금 및 환급에 관한 산정기준", 64]]),
    ...row(440, [[": 환불 기준은 공정거래위원회 소비자분쟁 해결기준에 따름", 76]]),
  ];
  return buildPdfLayoutTextEvidence([{ page: 1, items }]).combinedText;
}

function extract(text: string, sourceId = SOURCE_FILE_ID) {
  return extractDisclosureFromLocalEvidence({
    canonicalName: "가상 컨벤션",
    regionCode: "test-region",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: sourceId, text }],
  });
}

function decodedLineFragments(sourceQuote: string): Array<{ line: number; quote: string }> {
  const decoded = decodeEvidenceQuote(sourceQuote);
  const quotes = decoded.kind === "single"
    ? [decoded.quote]
    : decoded.kind === "merged"
      ? decoded.fragments.map(({ quote }) => quote)
      : [];
  return quotes.flatMap((quote) => {
    const match = /^line:([1-9][0-9]*):/u.exec(quote);
    return match ? [{ line: Number.parseInt(match[1]!, 10), quote }] : [];
  });
}

function isFullyCertifiedStandardSingleHall(
  extraction: ReturnType<typeof extract>,
): boolean {
  const hall = extraction.halls.find(({ hall_name }) => hall_name === "가상 홀");
  return hall?.guarantee_min === 160
    && hall.meal_price_min_krw === 57_000
    && hall.meal_price_max_krw === 57_000
    && hall.venue_fee_min_krw === 2_300_000
    && hall.venue_fee_max_krw === 2_300_000
    && hall.options.some(({ name, price_min_krw }) => (
      name === "장식" && price_min_krw === 310_000
    ))
    && hall.options.some(({ name, price_min_krw }) => (
      name === "식음료" && [310_000, 320_000].includes(price_min_krw ?? -1)
    ));
}

test("normalized money-token matching permits converter whitespace only", () => {
  assert.equal(
    payloadContainsExactMoneyRaw("선택 가격 310,000 원", "310,000\t원"),
    true,
  );
  assert.equal(
    payloadContainsExactMoneyRaw("선택 가격 1,310,000 원", "310,000\t원"),
    false,
    "a raw token embedded in a larger amount must not match",
  );
  assert.equal(
    payloadContainsExactMoneyRaw("선택 가격 310,000.5 원", "310,000"),
    false,
    "a raw token followed by a numeric continuation must not match",
  );
});

test("canonical PDF layout coordinates never become declared-won money occurrences", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(731.625, [["가격 정보 (단위: 원)", 120]]),
      ...row(700.125, [["대관료 3,300,000원", 120]]),
    ],
  }]).combinedText;

  assert.deepEqual(
    scanSourceMoneyOccurrences(text).map(({ krw, raw }) => ({ krw, raw })),
    [{ krw: 3_300_000, raw: "3,300,000원" }],
  );
});

test("lookalike PDF layout markers cannot bypass source-money coverage", () => {
  const cases = [
    ["[PDF_LAYOUT_EVIDENCE_FAKE] 대관료 3,300,000원", 3_300_000, "3,300,000원"],
    [[
      "[PDF_LAYOUT_EVIDENCE_V1_BEGIN]",
      "[PDF_LAYOUT_EVIDENCE_V1 page=1 row=1 y=700.125] invalid! 생화장식 4,400,000원",
      "[PDF_LAYOUT_EVIDENCE_V1_END]",
    ].join("\n"), 4_400_000, "4,400,000원"],
  ] as const;
  for (const [text, krw, raw] of cases) {
    assert.ok(
      scanSourceMoneyOccurrences(text).some((occurrence) => (
        occurrence.krw === krw && occurrence.raw === raw
      )),
    );
  }
});

test("multiple PDF artifacts quarantine only their own exact bounded layout suffixes", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-pdf-multi-envelope-"));
  try {
    const first = buildPdfLayoutTextEvidence([{
      page: 1,
      items: [
        ...row(731.625, [["가격 정보 (단위: 원)", 120]]),
        ...row(700.125, [["대관료 3,300,000원", 120]]),
      ],
    }]).combinedText;
    const second = buildPdfLayoutTextEvidence([{
      page: 1,
      items: [
        ...row(690.875, [["가격 정보 (단위: 원)", 120]]),
        ...row(650.375, [["생화장식 4,400,000원", 120]]),
      ],
    }]).combinedText;
    const sources: ManifestUnit["source_files"] = [first, second].map((text, index) => ({
      path: `synthetic/hall/${index + 1}.pdf`,
      absolute_path: path.join(temporaryRoot, `${index + 1}.pdf`),
      ext: "pdf",
      sha256: String.fromCharCode(98 + index).repeat(64),
      bytes: Buffer.byteLength(text, "utf8"),
    }));
    const extraction = extractDisclosureFromLocalEvidence({
      canonicalName: "가상 컨벤션",
      regionCode: "test-region",
      kindHint: "hall",
      hasImages: false,
      sources: [first, second].map((text, index) => ({
        sourceFileId: sourceFileId(sources[index]!),
        text,
      })),
    });
    const artifactDirectory = path.join(temporaryRoot, "converted");
    const artifactPaths = [
      path.join(artifactDirectory, "1-pdf.txt"),
      path.join(artifactDirectory, "2-pdf.txt"),
    ];
    await mkdir(artifactDirectory, { recursive: true });
    await Promise.all(artifactPaths.map((artifactPath, index) => (
      writeFile(artifactPath, [first, second][index]!, "utf8")
    )));
    const unit: ManifestUnit = {
      unit_id: "d".repeat(64),
      display_name: "synthetic-multi-pdf",
      parsed: {
        region_code: "test-region",
        raw_name: "가상 컨벤션",
        normalized_name: "가상컨벤션",
        corporate_name: null,
        kind_hint: "hall",
      },
      source_files: sources,
      source_fingerprint: "e".repeat(64),
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: "pdf-multi-envelope-test",
        source_fingerprint: "e".repeat(64),
        text_artifacts: artifactPaths,
        image_artifacts: [],
        text_characters: first.length + second.length,
        cell_count: 0,
        artifact_fingerprint: "f".repeat(64),
        converted_at: new Date(0).toISOString(),
      },
    };

    const validated = await deriveValidatedPayloadForUnit(
      unit,
      { data: extraction },
      { mode: "local_deterministic" },
    );
    assert.deepEqual(
      validated.data.money_occurrences?.map(({ amount_krw }) => amount_krw),
      [3_300_000, 4_400_000],
    );
    assert.deepEqual(
      validated.coverageGaps.map(({ krw }) => krw),
      [3_300_000, 4_400_000],
    );
    assert.equal(validated.issues.some(({ severity }) => severity === "error"), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("canonical PDF layout safely shares one footer and adjacent options across three halls", () => {
  const text = safeSharedHallLayout();
  const extraction = extract(text);

  assert.deepEqual(extraction.halls.map(({ hall_name }) => hall_name), [
    "별빛홀",
    "달빛홀",
    "햇살홀",
  ]);
  for (const hall of extraction.halls) {
    assert.equal(hall.guarantee_min, 180);
    assert.equal(hall.meal_price_min_krw, 55_000);
    assert.equal(hall.meal_price_max_krw, 65_000);
    assert.equal(hall.venue_fee_min_krw, null);
    assert.equal(hall.decoration_fee_min_krw, null);
    assert.deepEqual(hall.options.map((option) => [
      option.name,
      option.price_min_krw,
      option.price_max_krw,
    ]), [
      ["대관 및 장식", 3_100_000, 4_900_000],
      ["예식 사진", 610_000, null],
      ["리허설 촬영", 1_600_000, null],
      ["예식 영상", 410_000, null],
      ["드레스&헤어.메이크업", 1_700_000, null],
      ["부케 구성", 210_000, null],
      ["컨시어즈&플라워샤워", 510_000, null],
    ]);
  }
  assert.equal(extraction.sections.filter(({ section_type }) => (
    section_type === "refund_policy" || section_type === "penalty"
  )).length, 6);
  assert.equal(extraction.sections.filter(({ section_type, content_verbatim }) => (
    section_type === "pricing_basis"
    && content_verbatim === "총 비용의 기준 대관료, 식대 기타 부대비용 포함"
  )).length, 1);
  assert.equal(extraction.sections.filter(({ section_type, content_verbatim }) => (
      section_type === "notice"
      && content_verbatim === "* 소비자 분쟁해결 기준에 해당하는 권고사항 인지 하였으나 웨딩홀 규정 사항 안내 후 동의하에 계약 진행"
  )).length, 1);
  assert.deepEqual(findCoverageGaps(text, extraction, { includeAuditLedger: false }), []);
});

test("validated PDF layout retains every strictly grounded shared hall option", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-pdf-layout-validation-"));
  try {
    const text = safeSharedHallLayout();
    const source: ManifestUnit["source_files"][number] = {
      path: "synthetic/hall/shared-layout.pdf",
      absolute_path: path.join(temporaryRoot, "shared-layout.pdf"),
      ext: "pdf",
      sha256: "b".repeat(64),
      bytes: Buffer.byteLength(text, "utf8"),
    };
    const sourceId = sourceFileId(source);
    const extraction = extract(text, sourceId);
    const artifactDirectory = path.join(temporaryRoot, "converted");
    const artifactPath = path.join(artifactDirectory, "1-pdf.txt");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, text, "utf8");
    const businessName = extraction.business_name!;
    const unit: ManifestUnit = {
      unit_id: "c".repeat(64),
      display_name: "synthetic-shared-layout.pdf",
      parsed: {
        region_code: "test-region",
        raw_name: businessName,
        normalized_name: businessName,
        corporate_name: null,
        kind_hint: "hall",
      },
      source_files: [source],
      source_fingerprint: "d".repeat(64),
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: "pdf-layout-semantics-test",
        source_fingerprint: "d".repeat(64),
        text_artifacts: [artifactPath],
        image_artifacts: [],
        text_characters: text.length,
        cell_count: 0,
        artifact_fingerprint: "e".repeat(64),
        converted_at: new Date(0).toISOString(),
      },
    };

    const validated = await deriveValidatedPayloadForUnit(
      unit,
      { data: extraction },
      { mode: "local_deterministic" },
    );
    assert.deepEqual(
      validated.data.halls?.map((hall) => hall.hall_name),
      extraction.halls.map((hall) => hall.hall_name),
    );
    assert.ok(validated.data.halls?.every((hall) => (
      hall.guarantee_min === 180
      && hall.meal_price_min_krw === 55_000
      && hall.meal_price_max_krw === 65_000
      && hall.venue_fee_min_krw === null
      && hall.decoration_fee_min_krw === null
      && hall.options.length === 7
    )));
    assert.deepEqual(
      validated.data.halls?.[0]?.options.map((option) => [
        option.name,
        option.price_min_krw,
        option.price_max_krw,
      ]),
      extraction.halls[0]?.options.map((option) => [
        option.name,
        option.price_min_krw,
        option.price_max_krw,
      ]),
    );
    assert.equal(validated.coverageGaps.length, 0);
    assert.equal(validated.issues.some(({ code }) => (
      code === "local_ungrounded_option_quarantined"
    )), false, JSON.stringify(validated.issues));
    assert.equal(
      validated.issues.some(({ severity }) => severity === "error"),
      false,
      JSON.stringify(validated.issues),
    );
    assert.equal(validated.data.sections?.some((section) => (
      section.section_type === "refund_policy"
      && section.content_verbatim === "80% 환불 계약 체결일 기준 7일 이내 [ 제공 선물과 상담비 공제 ]"
    )), true);
    assert.equal(validated.data.sections?.some((section) => (
      section.section_type === "pricing_basis"
      && section.content_verbatim === "총 비용의 기준 대관료, 식대 기타 부대비용 포함"
    )), true);

    const spoofedPaid = await deriveValidatedPayloadForUnit(
      unit,
      { data: structuredClone(extraction) },
    );
    assert.equal(spoofedPaid.issues.some(({ severity, code, path: issuePath }) => (
      severity === "error"
      && code === "authoritative_field_not_grounded_in_source_quote"
      && issuePath === "sections[0].content_verbatim"
    )), true, `payload notes cannot enable the trusted local composite contract: ${JSON.stringify(spoofedPaid.issues)}`);

    const reordered = structuredClone(extraction);
    const refundSection = reordered.sections?.find(({ section_type }) => (
      section_type === "refund_policy"
    ));
    assert.ok(refundSection);
    const decoded = decodeEvidenceQuote(refundSection.source_quote);
    assert.equal(decoded.kind, "merged");
    if (decoded.kind !== "merged") throw new Error("refund quote must be merged");
    const reversedQuote = encodeMergedEvidenceQuote([...decoded.fragments].reverse(), 2_000);
    assert.ok(reversedQuote);
    refundSection.source_quote = reversedQuote;
    const rejected = await deriveValidatedPayloadForUnit(
      unit,
      { data: reordered },
      { mode: "local_deterministic" },
    );
    assert.equal(rejected.issues.some(({ severity, code, path: issuePath }) => (
      severity === "error"
      && code === "authoritative_field_not_grounded_in_source_quote"
      && issuePath === "sections[0].content_verbatim"
    )), true);

    const unboundedFragment = structuredClone(extraction);
    const unboundedRefund = unboundedFragment.sections?.find(({ section_type }) => (
      section_type === "refund_policy"
    ));
    assert.ok(unboundedRefund);
    const unboundedDecoded = decodeEvidenceQuote(unboundedRefund.source_quote);
    assert.equal(unboundedDecoded.kind, "merged");
    if (unboundedDecoded.kind !== "merged") throw new Error("refund quote must be merged");
    unboundedRefund.source_quote = encodeMergedEvidenceQuote([
      { ...unboundedDecoded.fragments[0]!, quote: "80% 환불" },
      ...unboundedDecoded.fragments.slice(1),
    ], 2_000)!;
    const unboundedRejected = await deriveValidatedPayloadForUnit(
      unit,
      { data: unboundedFragment },
      { mode: "local_deterministic" },
    );
    assert.equal(unboundedRejected.issues.some(({ severity, code, path: issuePath }) => (
      severity === "error"
      && code === "authoritative_field_not_grounded_in_source_quote"
      && issuePath === "sections[0].content_verbatim"
    )), true, "an unbounded fragment cannot join the ordered line contract");

    const duplicatedFragment = structuredClone(extraction);
    const duplicatedRefund = duplicatedFragment.sections?.find(({ section_type }) => (
      section_type === "refund_policy"
    ));
    assert.ok(duplicatedRefund);
    const duplicatedDecoded = decodeEvidenceQuote(duplicatedRefund.source_quote);
    assert.equal(duplicatedDecoded.kind, "merged");
    if (duplicatedDecoded.kind !== "merged") throw new Error("refund quote must be merged");
    duplicatedRefund.source_quote = `${MERGED_EVIDENCE_PREFIX}${JSON.stringify({
      fragments: [duplicatedDecoded.fragments[0], duplicatedDecoded.fragments[0]],
    })}`;
    const duplicateRejected = await deriveValidatedPayloadForUnit(
      unit,
      { data: duplicatedFragment },
      { mode: "local_deterministic" },
    );
    assert.equal(duplicateRejected.issues.some(({ severity, code }) => (
      severity === "error" && code === "merged_source_quote_invalid"
    )), true, "duplicate merged fragments remain invalid");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("standard single-hall PDF table binds every amount to its exact row and option column", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-pdf-single-hall-"));
  try {
    // Equal option prices deliberately exercise occurrence-level grounding:
    // the two 310,000원 rows must remain distinguishable by exact locator.
    const text = safeStandardSingleHallLayout({ foodPriceEqualsDecoration: true });
    const source: ManifestUnit["source_files"][number] = {
      path: "synthetic/hall/standard-single.pdf",
      absolute_path: path.join(temporaryRoot, "standard-single.pdf"),
      ext: "pdf",
      sha256: "7".repeat(64),
      bytes: Buffer.byteLength(text, "utf8"),
    };
    const sourceId = sourceFileId(source);
    const extraction = extractDisclosureFromLocalEvidence({
      canonicalName: "가상 웨딩홀",
      regionCode: "test-region",
      kindHint: "hall",
      hasImages: false,
      sources: [{ sourceFileId: sourceId, text }],
    });

    assert.equal(extraction.halls.length, 1);
    assert.equal(extraction.halls[0]?.hall_name, "가상 홀");
    assert.equal(extraction.halls[0]?.guarantee_min, 160);
    assert.equal(extraction.halls[0]?.meal_price_min_krw, 57_000);
    assert.equal(extraction.halls[0]?.meal_price_max_krw, 57_000);
    assert.equal(extraction.halls[0]?.venue_fee_min_krw, 2_300_000);
    assert.equal(extraction.halls[0]?.venue_fee_max_krw, 2_300_000);
    assert.deepEqual(extraction.halls[0]?.options.map((option) => [
      option.name,
      option.price_min_krw,
      option.price_max_krw,
      option.condition,
    ]), [
      ["장식", 310_000, 310_000, null],
      ["식음료", 310_000, 310_000, "무제한"],
    ]);
    const decoration = extraction.halls[0]!.options.find(({ name }) => name === "장식");
    const food = extraction.halls[0]!.options.find(({ name }) => name === "식음료");
    assert.ok(decoration);
    assert.ok(food);
    const decorationFragments = decodedLineFragments(decoration.source_quote);
    const foodFragments = decodedLineFragments(food.source_quote);
    assert.deepEqual(decorationFragments.map(({ line }) => line), [5, 9, 14]);
    assert.deepEqual(foodFragments.map(({ line }) => line), [5, 9, 13, 15]);
    assert.equal(decorationFragments.flatMap(({ quote }) => (
      scanSourceMoneyOccurrences(quote).filter(({ krw }) => krw === 310_000)
    )).length, 1);
    assert.equal(foodFragments.flatMap(({ quote }) => (
      scanSourceMoneyOccurrences(quote).filter(({ krw }) => krw === 310_000)
    )).length, 1);
    assert.deepEqual(
      findCoverageGaps(text, extraction, { includeAuditLedger: false }),
      [],
      JSON.stringify(extraction.halls[0]?.options),
    );

    const artifactDirectory = path.join(temporaryRoot, "converted");
    const artifactPath = path.join(artifactDirectory, "1-pdf.txt");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, text, "utf8");
    const unit: ManifestUnit = {
      unit_id: "8".repeat(64),
      display_name: "synthetic-standard-single.pdf",
      parsed: {
        region_code: "test-region",
        raw_name: "가상 웨딩홀",
        normalized_name: "가상웨딩홀",
        corporate_name: null,
        kind_hint: "hall",
      },
      source_files: [source],
      source_fingerprint: "9".repeat(64),
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: "pdf-standard-single-test",
        source_fingerprint: "9".repeat(64),
        text_artifacts: [artifactPath],
        image_artifacts: [],
        text_characters: text.length,
        cell_count: 0,
        artifact_fingerprint: "0".repeat(64),
        converted_at: new Date(0).toISOString(),
      },
    };
    const validated = await deriveValidatedPayloadForUnit(
      unit,
      { data: extraction },
      { mode: "local_deterministic" },
    );
    assert.deepEqual(
      validated.coverageGaps,
      [],
      JSON.stringify({ issues: validated.issues, halls: validated.data.halls }),
    );
    assert.equal(
      validated.issues.some(({ severity }) => severity === "error"),
      false,
      JSON.stringify(validated.issues),
    );

    const replaceFoodPriceFragment = (
      data: typeof extraction,
      replacement: (quote: string) => string,
    ): typeof extraction => {
      const mutated = structuredClone(data);
      const option = mutated.halls[0]?.options.find(({ name }) => name === "식음료");
      assert.ok(option);
      const decoded = decodeEvidenceQuote(option.source_quote);
      assert.equal(decoded.kind, "merged");
      if (decoded.kind !== "merged") throw new Error("food option quote must be merged");
      option.source_quote = encodeMergedEvidenceQuote(decoded.fragments.map((fragment) => ({
        ...fragment,
        quote: /^line:15:/u.test(fragment.quote)
          ? replacement(fragment.quote)
          : fragment.quote,
      })), 2_000)!;
      return mutated;
    };
    const assertFoodQuarantined = async (
      mutated: typeof extraction,
      label: string,
    ): Promise<void> => {
      const replayed = await deriveValidatedPayloadForUnit(
        unit,
        { data: mutated },
        { mode: "local_deterministic" },
      );
      assert.equal(replayed.data.halls?.[0]?.options.some(({ name }) => name === "식음료"), false, label);
      assert.equal(replayed.issues.some(({ code }) => (
        code === "local_ungrounded_option_quarantined"
      )), true, `${label}: expected local option quarantine`);
    };

    await assertFoodQuarantined(
      replaceFoodPriceFragment(extraction, (quote) => quote.replace(/^line:15:/u, "line:14:")),
      "the same amount at a different locator",
    );
    const differentKrw = structuredClone(extraction);
    const differentKrwFood = differentKrw.halls[0]?.options.find(({ name }) => name === "식음료");
    assert.ok(differentKrwFood);
    differentKrwFood.price_min_krw = 311_000;
    differentKrwFood.price_max_krw = 311_000;
    await assertFoodQuarantined(differentKrw, "a different structured KRW value");
    await assertFoodQuarantined(
      replaceFoodPriceFragment(extraction, (quote) => (
        quote.replace(/^line:15:\s*/u, "line:15: 허위 문구 ")
      )),
      "a same-KRW payload absent from exact source evidence",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("standard single-hall PDF certification fails closed on malformed table topology", () => {
  const malformedLayouts: Array<[string, StandardSingleHallLayoutOptions]> = [
    ["option header column drift", { driftFoodHeader: true }],
    ["missing option header", { missingFoodHeader: true }],
    ["duplicate option header", { duplicateFoodHeader: true }],
    ["option amount in the wrong column", { wrongDecorationColumn: true }],
    ["extra unclaimed money", { extraOptionMoney: true }],
    ["missing venue row amount", { omitVenue: true }],
  ];

  for (const [label, options] of malformedLayouts) {
    const text = safeStandardSingleHallLayout(options);
    const extraction = extract(text);
    assert.equal(
      isFullyCertifiedStandardSingleHall(extraction),
      false,
      `${label} must not receive the strict standard-table projection`,
    );
  }
});

test("malformed, non-strict, and wrapper-mismatched PDF layout metadata fail closed", () => {
  const valid = safeSharedHallLayout();
  const evidencePattern = /^(\[PDF_LAYOUT_EVIDENCE_V1 page=1 row=1 y=[^\]]+\] )([A-Za-z0-9_-]+)$/mu;
  const match = evidencePattern.exec(valid);
  assert.ok(match);

  const malformedBase64 = valid.replace(evidencePattern, `${match[1]}${match[2]!.slice(0, -1)}!`);
  const decoded = JSON.parse(Buffer.from(match[2]!, "base64url").toString("utf8"));
  const extraKeyPayload = Buffer.from(JSON.stringify({ ...decoded, unexpected: true }), "utf8")
    .toString("base64url");
  const nonStrictSchema = valid.replace(evidencePattern, `${match[1]}${extraKeyPayload}`);
  const wrapperMismatch = valid.replace(
    evidencePattern,
    `${match[1]!.replace("row=1", "row=2")}${match[2]}`,
  );

  for (const text of [malformedBase64, nonStrictSchema, wrapperMismatch]) {
    const extraction = extract(text);
    assert.deepEqual(extraction.halls, []);
    assert.match(extraction.extraction_notes ?? "", /local_pdf_layout_metadata_quarantine/u);
    assert.equal(extraction.money_occurrences.length, 10);
  }
});

test("typed-column mismatch and a hall-aligned amount never broadcast shared prices", () => {
  for (const text of [
    safeSharedHallLayout({ mealHeader: "식사" }),
    safeSharedHallLayout({ alignedHallAmount: true }),
  ]) {
    const extraction = extract(text);
    assert.ok(extraction.halls.length < 3 || extraction.halls.every((hall) => (
      hall.guarantee_min === null
      && hall.meal_price_min_krw === null
      && hall.meal_price_max_krw === null
      && hall.options.length === 0
    )));
    assert.equal(extraction.halls.some((hall) => hall.options.some((option) => (
      option.name === "대관 및 장식"
    ))), false);
  }
});

test("remarks-band hall text is ignored and an irregular option row rejects the broadcast", () => {
  const remarksOnly = extract(safeSharedHallLayout({ remarksBandHall: true }));
  assert.deepEqual(remarksOnly.halls.map(({ hall_name }) => hall_name), [
    "별빛홀",
    "달빛홀",
    "햇살홀",
  ]);

  const irregular = extract(safeSharedHallLayout({ irregularOptionRow: true }));
  assert.equal(irregular.halls.some((hall) => hall.options.length > 0), false);
  assert.equal(irregular.halls.some((hall) => hall.guarantee_min !== null), false);
});
