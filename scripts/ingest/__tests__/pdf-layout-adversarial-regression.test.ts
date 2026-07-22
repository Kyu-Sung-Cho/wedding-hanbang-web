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
import { decodeEvidenceQuote } from "../merge-evidence.js";
import { projectCanonicalPdfLayoutMoney } from "../pdf-layout-evidence.js";
import { sourceFileId } from "../provenance.js";
import type { ManifestUnit } from "../types.js";
import { deriveValidatedPayloadForUnit, scanSourceMoneyOccurrences } from "../validate.js";

function row(y: number, items: Array<[text: string, x: number]>): PdfPositionedTextItem[] {
  return items.map(([text, x]) => ({ text, x, y, width: 70, height: 9 }));
}

test("PDF price certification blocks an entire identifier/contact row before projecting money", () => {
  const forbiddenContexts = [
    "계좌 123-456",
    "예금주 홍길동",
    "사업자번호 123-45-67890",
    "법인번호 123456-1234567",
    "대표번호 안내",
    "업체 문의",
    "TEL 02-1234-5678",
    "FAX 02-9876-5432",
    "PHONE 010-1234-5678",
  ];
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["***** 선택사항 *****", 180]]),
      ...row(760, [["품목", 70], ["금액", 310], ["비고", 470]]),
      ...forbiddenContexts.flatMap((context, index) => row(
        740 - index * 20,
        [[context, 70], [`${index + 1},000,000`, 310], ["식별정보 행", 470]],
      )),
    ],
  }]).combinedText;

  assert.deepEqual(projectCanonicalPdfLayoutMoney(text), []);
});

test("PDF price tables stop before cancellation, termination, refund, and deduction structures", () => {
  const boundaryLabels = ["취소 규정", "정책 안내", "해지 규정", "환불 규정", "공제 기준"];
  for (const boundaryLabel of boundaryLabels) {
    const text = buildPdfLayoutTextEvidence([{
      page: 1,
      items: [
        ...row(780, [["***** 선택사항 *****", 180]]),
        ...row(760, [["품목", 70], ["금액", 310], ["비고", 470]]),
        ...row(740, [["정상 선택품목", 70], ["300,000", 310], ["추가 옵션", 470]]),
        ...row(720, [[boundaryLabel, 70], ["500,000", 310], ["정책 금액", 470]]),
        ...row(700, [["계약 후 7일", 70], ["700,000", 310], ["정책 후속 행", 470]]),
      ],
    }]).combinedText;

    assert.deepEqual(
      projectCanonicalPdfLayoutMoney(text).map(({ krw, line_context }) => ({ krw, line_context })),
      [{ krw: 300_000, line_context: "정상 선택품목\t300,000\t추가 옵션" }],
      boundaryLabel,
    );
  }
});

test("PDF certification fails closed when one header cluster mixes price and non-price semantics", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["***** 선택사항 *****", 180]]),
      ...row(760, [["품목", 70], ["금액", 300], ["사업자번호", 312], ["비고", 470]]),
      ...row(740, [["모호한 행", 70], ["3,000,000", 306], ["가격인지 식별번호인지 불명", 470]]),
    ],
  }]).combinedText;

  assert.deepEqual(projectCanonicalPdfLayoutMoney(text), []);
});

test("mixed comma-won and manwon tokens receive one start-ordered injective money ordinal", () => {
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["***** 선택사항 *****", 180]]),
      ...row(760, [["품목", 70], ["금액", 310], ["비고", 520]]),
      { text: "가격 범위", x: 70, y: 740, width: 70, height: 9 },
      { text: "1,200,000원 / 50만원 / 30만원", x: 245, y: 740, width: 180, height: 9 },
    ],
  }]).combinedText;

  assert.deepEqual(projectCanonicalPdfLayoutMoney(text).map(({ krw, source_locator }) => ({
    krw,
    source_locator,
  })), [
    { krw: 1_200_000, source_locator: "pdf:page:1:row:3:item:2:money:1" },
    { krw: 500_000, source_locator: "pdf:page:1:row:3:item:2:money:2" },
    { krw: 300_000, source_locator: "pdf:page:1:row:3:item:2:money:3" },
  ]);
});

test("only an explicit same-item PDF range becomes one min/max and retains both exact locators", () => {
  const sourceFileId = "c".repeat(64);
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["가상 컨벤션 웨딩홀", 70]]),
      ...row(760, [["***** 선택사항 *****", 180]]),
      ...row(740, [["품목", 70], ["금액", 310], ["비고", 520]]),
      { text: "스냅", x: 70, y: 720, width: 70, height: 9 },
      { text: "300,000원 ~ 700,000원", x: 250, y: 720, width: 170, height: 9 },
    ],
  }]).combinedText;
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "가상 컨벤션 웨딩홀",
    regionCode: "test",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId, text }],
  });

  assert.equal(extraction.halls.length, 1);
  assert.deepEqual(extraction.halls[0]!.options.map((option) => ({
    minimum: option.price_min_krw,
    maximum: option.price_max_krw,
  })), [{ minimum: 300_000, maximum: 700_000 }]);
  const decoded = decodeEvidenceQuote(extraction.halls[0]!.options[0]!.source_quote);
  const fragments = decoded.kind === "merged" ? decoded.fragments : [];
  assert.ok(fragments.some(({ quote }) => quote.startsWith(
    "pdf:page:1:row:4:item:2:money:1 [krw=300000]",
  )), JSON.stringify(decoded));
  assert.ok(fragments.some(({ quote }) => quote.startsWith(
    "pdf:page:1:row:4:item:2:money:2 [krw=700000]",
  )), JSON.stringify(decoded));
});

test("PDF agency vendor intervals start at real business rows and never promote option-role labels", () => {
  const optionRoles = [
    "앨범 추가",
    "액자",
    "원본",
    "업그레이드",
    "야외",
    "출장",
    "피팅",
    "헬퍼",
  ];
  const text = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(800, [["1. 스튜디오 선택 품목", 70]]),
      ...row(780, [["사업자명", 100], ["기본가격", 235], ["기타 옵션", 430]]),
      ...row(760, [[optionRoles[0]!, 100], ["110,000원", 248]]),
      ...row(740, [["가상 스튜디오", 100], ["1,200,000원", 248]]),
      ...optionRoles.slice(1).flatMap((label, index) => row(
        720 - index * 20,
        [[label, 100], [`${index + 2}20,000원`, 248]],
      )),
      ...row(560, [["2. 드레스 선택 품목", 70]]),
      ...row(540, [["사업자명", 100], ["기본가격", 235], ["기타 옵션", 430]]),
      ...row(520, [["가상 드레스", 100], ["800,000원", 248]]),
      ...row(480, [["3. 메이크업 선택 품목", 70]]),
      ...row(460, [["사업자명", 100], ["기본가격", 235], ["기타 옵션", 430]]),
      ...row(440, [["가상 메이크업", 100], ["500,000원", 248]]),
    ],
  }]).combinedText;
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "가상 웨딩",
    regionCode: "test",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: "d".repeat(64), text }],
  });

  assert.deepEqual(extraction.partner_vendors.map(({ vendor_name, category }) => [
    vendor_name,
    category,
  ]), [
    ["가상 스튜디오", "studio"],
    ["가상 드레스", "dress"],
    ["가상 메이크업", "makeup"],
  ]);
  assert.ok(optionRoles.every((label) => (
    extraction.partner_vendors.every(({ vendor_name }) => vendor_name !== label)
  )));
  assert.match(extraction.extraction_notes, /\[local_structured_money_quarantine\]/u);
});

test("PDF hall options never borrow or relabel a hall identity from another source", () => {
  const identitySourceId = "e".repeat(64);
  const priceSourceId = "f".repeat(64);
  const identityText = buildPdfLayoutTextEvidence([{
    page: 1,
    items: row(780, [["가상 컨벤션 웨딩홀", 70]]),
  }]).combinedText;
  const priceText = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(780, [["***** 선택사항 *****", 180]]),
      ...row(760, [["품목", 70], ["금액", 310], ["비고", 470]]),
      ...row(740, [["스냅", 70], ["300,000원", 310]]),
    ],
  }]).combinedText;
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "가상 컨벤션 웨딩홀",
    regionCode: "test",
    kindHint: "hall",
    hasImages: false,
    sources: [
      { sourceFileId: identitySourceId, text: identityText },
      { sourceFileId: priceSourceId, text: priceText },
    ],
  });

  assert.equal(extraction.halls.length, 1);
  assert.deepEqual(extraction.halls[0]!.source_file_ids, [identitySourceId]);
  assert.deepEqual(extraction.halls[0]!.options, []);
  assert.match(extraction.extraction_notes, /\[local_structured_money_quarantine\]/u);
});

test("local validation retains and source-scopes exact PDF occurrence indexes across artifacts", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-pdf-source-index-"));
  try {
    const sourceText = (hallName: string, amount: string): string => (
      buildPdfLayoutTextEvidence([{
        page: 1,
        items: [
          ...row(780, [[hallName, 70]]),
          ...row(760, [["***** 선택사항 *****", 180]]),
          ...row(740, [["품목", 70], ["금액", 310], ["비고", 470]]),
          ...row(720, [["스냅", 70], [amount, 310]]),
        ],
      }]).combinedText
    );
    const firstText = sourceText("가상 별빛 웨딩홀", "300,000");
    const secondText = sourceText("가상 달빛 웨딩홀", "700,000");
    const sources: ManifestUnit["source_files"] = [
      {
        path: "synthetic/hall/first.pdf",
        absolute_path: path.join(temporaryRoot, "first.pdf"),
        ext: "pdf",
        sha256: "1".repeat(64),
        bytes: Buffer.byteLength(firstText, "utf8"),
      },
      {
        path: "synthetic/hall/second.pdf",
        absolute_path: path.join(temporaryRoot, "second.pdf"),
        ext: "pdf",
        sha256: "2".repeat(64),
        bytes: Buffer.byteLength(secondText, "utf8"),
      },
    ];
    const artifactDirectory = path.join(temporaryRoot, "converted");
    const artifacts = [
      path.join(artifactDirectory, "1-pdf.txt"),
      path.join(artifactDirectory, "2-pdf.txt"),
    ];
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifacts[0]!, firstText, "utf8");
    await writeFile(artifacts[1]!, secondText, "utf8");
    const extraction = extractDisclosureFromLocalEvidence({
      canonicalName: "가상 컨벤션",
      regionCode: "test",
      kindHint: "hall",
      hasImages: false,
      sources: [
        { sourceFileId: sourceFileId(sources[0]!), text: firstText },
        { sourceFileId: sourceFileId(sources[1]!), text: secondText },
      ],
    });
    const unit: ManifestUnit = {
      unit_id: "3".repeat(64),
      display_name: "synthetic-two-pdf-unit",
      parsed: {
        region_code: "test",
        raw_name: "가상 컨벤션",
        normalized_name: "가상컨벤션",
        corporate_name: null,
        kind_hint: "hall",
      },
      source_files: sources,
      source_fingerprint: "4".repeat(64),
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: "pdf-source-index-test",
        source_fingerprint: "4".repeat(64),
        text_artifacts: artifacts,
        image_artifacts: [],
        text_characters: firstText.length + secondText.length,
        cell_count: 0,
        artifact_fingerprint: "5".repeat(64),
        converted_at: new Date(0).toISOString(),
      },
    };

    const validated = await deriveValidatedPayloadForUnit(
      unit,
      { data: extraction },
      { mode: "local_deterministic" },
    );
    assert.equal(validated.coverageGaps.length, 0, JSON.stringify(validated.coverageGaps));
    assert.equal(
      validated.issues.some(({ severity }) => severity === "error"),
      false,
      JSON.stringify(validated.issues),
    );
    assert.deepEqual(validated.data.halls?.map((hall) => [
      hall.hall_name,
      hall.options.map(({ price_min_krw }) => price_min_krw),
    ]), [
      ["가상 별빛 웨딩홀", [300_000]],
      ["가상 달빛 웨딩홀", [700_000]],
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("duplicated canonical PDF metadata never creates a projected occurrence", () => {
  const valid = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      ...row(760, [["***** 선택사항 *****", 180]]),
      ...row(740, [["품목", 70], ["금액", 310], ["비고", 470]]),
      ...row(720, [["스냅", 70], ["300,000", 310]]),
    ],
  }]).combinedText;
  const suffix = valid.slice(valid.indexOf("[PDF_LAYOUT_EVIDENCE_V1_BEGIN]"));
  const duplicated = `${valid}\n${suffix}`;

  assert.deepEqual(projectCanonicalPdfLayoutMoney(duplicated), []);
  assert.deepEqual(scanSourceMoneyOccurrences(duplicated), []);
});
