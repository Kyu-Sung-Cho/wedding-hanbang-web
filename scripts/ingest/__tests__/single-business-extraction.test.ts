import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractDisclosureFromLocalEvidence } from "../local-extract.js";
import { sourceFileId } from "../provenance.js";
import type { ManifestUnit } from "../types.js";
import { deriveValidatedPayloadForUnit, findCoverageGaps } from "../validate.js";

const SOURCE_FILE_ID = "f".repeat(64);

function extractAgency(canonicalName: string, text: string) {
  return extractDisclosureFromLocalEvidence({
    canonicalName,
    regionCode: "chungbuk",
    kindHint: "agency",
    hasImages: false,
    sources: [{ sourceFileId: SOURCE_FILE_ID, text }],
  });
}

test("an OCR_REVIEW_ONLY source stays audit-only even when its text looks structurally complete", () => {
  const text = [
    "[OCR_REVIEW_ONLY]",
    "ocr:page:1:line:1: 드레스 가격표",
    "ocr:page:1:line:2: 사업자명",
    "ocr:page:1:line:3: AILEEN COUTURE",
    "ocr:page:1:line:4: 촬영 드레스 4,000,000원",
  ].join("\n");
  const extraction = extractAgency("OCR 검수 업체", text);

  assert.deepEqual(extraction.partner_vendors, []);
  assert.deepEqual(extraction.agency_packages, []);
  assert.deepEqual(extraction.halls, []);
  assert.equal(extraction.hall.meal_price_min_krw, null);
  assert.equal(extraction.sections.some((section) => /4,000,000원/u.test(section.content_verbatim)), false);
  assert.ok(extraction.money_occurrences.some(({ amount_krw }) => amount_krw === 4_000_000));
  assert.ok(findCoverageGaps(text, extraction, { includeAuditLedger: false }).some(
    ({ krw }) => krw === 4_000_000,
  ));
  assert.match(extraction.extraction_notes, /local_ocr_review_source_quarantine/u);
});

test("a 사업장명 self-business table keeps one dress identity and separates base price from options", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: 󰊱 바비블랑브라이드",
    "Sheet1!A2: ① 가격(VAT 포함)",
    "Sheet1!A3: 사업장명",
    "Sheet1!B3: 기본가격",
    "Sheet1!C3: 드레스도우미 (헬퍼)",
    "Sheet1!D3: 주요 선택품목가격",
    "Sheet1!D4: 디자인 추가금",
    "Sheet1!G4: 기타옵션",
    "Sheet1!A5: 바비블랑<br>브라이드",
    "Sheet1!B5: 본식 드레스<br>1,000,000원~1,500,000원<br>+피팅 1회",
    "Sheet1!C5: 본식 1회당 120,000원",
    "Sheet1!D5: 1,000,000원~2,500,000원",
    "Sheet1!G5: 본식 드레스 재피팅시 150,000원",
    "Sheet1!A6: 추가항목",
    "Sheet1!C6: 2부의상 피팅비 30,000원",
    "Sheet1!G6: 행사 드레스 200,000원~500,000원",
    "병합 범위 A3:A4 · 좌상단 A3",
    "병합 범위 B3:B4 · 좌상단 B3",
    "병합 범위 C3:C4 · 좌상단 C3",
    "병합 범위 D3:G3 · 좌상단 D3",
  ].join("\n");
  const extraction = extractAgency("바비블랑브라이드", text);

  assert.equal(extraction.partner_vendors.length, 1);
  const vendor = extraction.partner_vendors[0]!;
  assert.equal(vendor.vendor_name, "바비블랑 브라이드");
  assert.equal(vendor.category, "dress");
  assert.deepEqual([vendor.price_min_krw, vendor.price_max_krw], [1_000_000, 1_500_000]);
  assert.equal(vendor.options.some(({ price_min_krw }) => price_min_krw === 1_000_000), true);
  assert.equal(vendor.options.some(({ name }) => name === "기본가격"), false);
  assert.ok(vendor.options.some(({ price_min_krw }) => price_min_krw === 30_000));
  assert.ok(vendor.options.some(({ price_min_krw, price_max_krw }) => (
    price_min_krw === 200_000 && price_max_krw === 500_000
  )));
  assert.equal(extraction.partner_vendors.some(({ vendor_name }) => vendor_name === "추가항목"), false);
});

test("explicit package anchors stay four records, keep multiple subprices unaggregated, and coexist with a direct dress offer", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: 󰊱 BBB웨딩(㈜더메이트)",
    "Sheet1!A2: ① 가격",
    "Sheet1!A3: 사업자명",
    "Sheet1!B3: 구성",
    "Sheet1!C3: 가격",
    "Sheet1!D3: 기타 옵션",
    "Sheet1!A4: 패키지 A",
    "Sheet1!B4: 스튜디오 촬영",
    "Sheet1!C4: 2,000,000원",
    "Sheet1!A7: 패키지 B",
    "Sheet1!B7: 스튜디오 촬영<br>본식 드레스, 메이크업",
    "Sheet1!C7: 2,500,000원",
    "Sheet1!A12: 패키지 C",
    "Sheet1!B12: 스튜디오 촬영<br>본식 드레스, 메이크업",
    "Sheet1!C12: 2,600,000원",
    "Sheet1!A15: 패키지 D",
    "Sheet1!B15: 스튜디오 (웨딩촬영)",
    "Sheet1!C15: 1,650,000원",
    "Sheet1!B23: 본식 드레스 대여",
    "Sheet1!C23: 1,320,000원~3,300,000원",
    "Sheet1!D23: 헤어, 메이크업",
    "Sheet1!E23: 330,000원",
    "Sheet1!A26: 촬영 드레스 대여",
    "Sheet1!B26: 1벌",
    "Sheet1!C26: 300,000원",
    "Sheet1!B27: 2벌",
    "Sheet1!C27: 550,000원",
    "Sheet1!B28: 3벌",
    "Sheet1!C28: 750,000원",
    "병합 범위 A4:A6 · 좌상단 A4",
    "병합 범위 A7:A11 · 좌상단 A7",
    "병합 범위 A12:A14 · 좌상단 A12",
    "병합 범위 A15:A25 · 좌상단 A15",
    "병합 범위 A26:A28 · 좌상단 A26",
  ].join("\n");
  const extraction = extractAgency("BBB웨딩", text);

  assert.deepEqual(
    extraction.agency_packages.map(({ package_name }) => package_name),
    ["패키지 A", "패키지 B", "패키지 C", "패키지 D"],
  );
  const packageD = extraction.agency_packages[3]!;
  assert.deepEqual([packageD.price_min_krw, packageD.price_max_krw], [null, null]);
  assert.ok(packageD.options.some(({ price_min_krw }) => price_min_krw === 1_650_000));
  assert.ok(packageD.options.some(({ price_min_krw, price_max_krw }) => (
    price_min_krw === 1_320_000 && price_max_krw === 3_300_000
  )));
  assert.ok(packageD.options.some(({ price_min_krw }) => price_min_krw === 330_000));
  const directDress = extraction.partner_vendors.find(({ category }) => category === "dress");
  assert.ok(directDress);
  assert.match(directDress.vendor_name, /^BBB웨딩/u);
  assert.deepEqual(
    directDress.options.map(({ price_min_krw }) => price_min_krw),
    [300_000, 550_000, 750_000],
  );
});

test("explicit package categories come only from the composition column and validate with adjacent options", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-package-columns-"));
  try {
    const text = [
      "## 시트: 표1",
      "표1!A1: □ 새봄컨설팅",
      "표1!A2: ① 가격",
      "표1!A3: 사업자명",
      "표1!B3: 구성",
      "표1!C3: 가격",
      "표1!D3: 기타 옵션",
      "표1!A4: 패키지 X",
      "표1!B4: 스튜디오 촬영",
      "표1!C4: 2,140,000원",
      "표1!D4: 원본 제공",
      "표1!E4: 310,000원",
      "표1!D5: 촬영 헬퍼 비용",
      "표1!E5: 140,000원",
      "표1!A7: 패키지 Y",
      "표1!B7: 스튜디오 촬영",
      "표1!C7: 1,730,000원",
      "표1!D7: 원본 제공",
      "표1!E7: 310,000원",
      "표1!D8: 유색 드레스 업그레이드",
      "표1!E8: 210,000원",
      "표1!D9: 헤어, 메이크업",
      "표1!E9: 320,000원",
      "표1!B10: 본식 드레스 대여",
      "표1!C10: 1,210,000원~2,910,000원",
      "표1!D10: 부케",
      "표1!E10: 130,000원~260,000원",
      "표1!A12: 촬영 드레스 대여",
      "표1!B12: 1벌",
      "표1!C12: 290,000원",
      "표1!D12: 보증금<br>(반납 후 전액 환불)",
      "표1!E12: 90,000원",
      "표1!B13: 2벌",
      "표1!C13: 540,000원",
      "표1!B14: 3벌",
      "표1!C14: 740,000원",
      "병합 범위 A4:A5 · 좌상단 A4",
      "병합 범위 B4:B5 · 좌상단 B4",
      "병합 범위 C4:C5 · 좌상단 C4",
      "병합 범위 A7:A10 · 좌상단 A7",
      "병합 범위 B7:B9 · 좌상단 B7",
      "병합 범위 C7:C9 · 좌상단 C7",
      "병합 범위 A12:A14 · 좌상단 A12",
      "병합 범위 D12:D14 · 좌상단 D12",
      "병합 범위 E12:E14 · 좌상단 E12",
      "병합 범위 D3:E3 · 좌상단 D3",
    ].join("\n");
    const source: ManifestUnit["source_files"][number] = {
      path: "synthetic/package-columns.xlsx",
      absolute_path: path.join(temporaryRoot, "package-columns.xlsx"),
      ext: "xlsx",
      sha256: "a".repeat(64),
      bytes: Buffer.byteLength(text, "utf8"),
    };
    const sourceId = sourceFileId(source);
    const extraction = extractDisclosureFromLocalEvidence({
      canonicalName: "새봄컨설팅",
      regionCode: "test-region",
      kindHint: "agency",
      hasImages: false,
      sources: [{ sourceFileId: sourceId, text }],
    });

    assert.deepEqual(extraction.agency_packages.map((item) => ({
      name: item.package_name,
      categories: item.category_scope,
      optionAmounts: item.options.flatMap((option) => [
        option.price_min_krw,
        option.price_max_krw,
      ]).filter((amount, index, amounts) => amount !== null && amounts.indexOf(amount) === index),
    })), [{
      name: "패키지 X",
      categories: ["studio"],
      optionAmounts: [2_140_000, 310_000, 140_000],
    }, {
      name: "패키지 Y",
      categories: ["studio", "dress"],
      optionAmounts: [1_730_000, 310_000, 210_000, 320_000, 1_210_000, 2_910_000, 130_000, 260_000],
    }]);
    const directDress = extraction.partner_vendors.find(({ category }) => category === "dress");
    assert.ok(directDress);
    assert.deepEqual(
      directDress.options.map(({ price_min_krw }) => price_min_krw),
      [290_000, 90_000, 540_000, 740_000],
    );
    assert.ok(extraction.sections.some(({ section_type, content_verbatim }) => (
      section_type === "refund_policy" && content_verbatim.includes("보증금")
    )));

    const artifactDirectory = path.join(temporaryRoot, "converted");
    const artifactPath = path.join(artifactDirectory, "1-sheets.txt");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, text, "utf8");
    const unit: ManifestUnit = {
      unit_id: "b".repeat(64),
      display_name: "synthetic-package-columns.xlsx",
      parsed: {
        region_code: "test-region",
        raw_name: "새봄컨설팅",
        normalized_name: "새봄컨설팅",
        corporate_name: null,
        kind_hint: "agency",
      },
      source_files: [source],
      source_fingerprint: "c".repeat(64),
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: "package-column-semantics-test",
        source_fingerprint: "c".repeat(64),
        text_artifacts: [artifactPath],
        image_artifacts: [],
        text_characters: text.length,
        cell_count: 34,
        artifact_fingerprint: "d".repeat(64),
        converted_at: new Date(0).toISOString(),
      },
    };
    const validated = await deriveValidatedPayloadForUnit(
      unit,
      { data: extraction },
      { mode: "local_deterministic" },
    );
    assert.equal(validated.coverageGaps.length, 0);
    assert.deepEqual(
      validated.issues.filter(({ severity }) => severity === "error"),
      [],
    );
    assert.deepEqual(
      validated.data.agency_packages.map(({ options }) => options.length),
      extraction.agency_packages.map(({ options }) => options.length),
    );
    assert.ok(validated.data.partner_vendors.some(({ category, options }) => (
      category === "dress" && options.some(({ price_min_krw }) => price_min_krw === 90_000)
    )));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("a package option in the basic-price column never becomes its own package", () => {
  const text = [
    "## 시트: 표준양식",
    "표준양식!A1: 󰊱 바오드레브",
    "표준양식!A36: 바오드레브 (스드메 토탈샵) // 본식만 진행시 - 드레스 + 메이크업 포함 가격",
    "표준양식!A38: 사업자명",
    "표준양식!B38: 기본가격",
    "표준양식!A40: 바오드레브 - 손윤희 원주점",
    "표준양식!B40: 본식 (드레스1벌, 턱시도1벌, 헤어메이크업, 부케 포함)",
    "표준양식!C40: 1,910,000원",
    "표준양식!B52: * 피팅 3회",
    "표준양식!C52: 50,000원",
    "표준양식!B53: 본식 (드레스 1벌만 대여시)",
    "표준양식!C53: 880,000원",
    "병합 범위 A38:A39 · 좌상단 A38",
    "병합 범위 B38:C39 · 좌상단 B38",
    "병합 범위 A40:A56 · 좌상단 A40",
    "병합 범위 B40:B51 · 좌상단 B40",
    "병합 범위 C40:C51 · 좌상단 C40",
    "병합 범위 B53:B56 · 좌상단 B53",
    "병합 범위 C53:C56 · 좌상단 C53",
  ].join("\n");
  const extraction = extractAgency("바오드레브", text);

  assert.equal(extraction.agency_packages.length, 2);
  assert.deepEqual(
    extraction.agency_packages.map(({ package_name }) => package_name),
    [
      "본식 (드레스1벌, 턱시도1벌, 헤어메이크업, 부케 포함)",
      "본식 (드레스 1벌만 대여시)",
    ],
  );
  assert.ok(extraction.agency_packages[0]?.options.some((option) => (
    option.name === "* 피팅 3회" && option.price_min_krw === 50_000
  )));
});

test("sheet identity fencing isolates another business and maps source-backed traditional attire to dress without structuring dot-typo money", () => {
  const cheongjuText = [
    "## 시트: Sheet1",
    "Sheet1!A1: 플로렌스웨딩",
    "Sheet1!A5: 본식 드레스(대여)",
    "Sheet1!B5: 기본 800.000원",
    "## 시트: Sheet2",
    "Sheet2!A1: 󰊱 청주상의원",
    "Sheet2!A2: ① 가격(VAT 포함)",
    "Sheet2!A3: 기본가격",
    "Sheet2!A4: 대여(1벌기준)",
    "Sheet2!B4: 명주실크 550,000원",
    "Sheet2!B5: 본견실크 440,000원",
  ].join("\n");
  const cheongju = extractAgency("청주상의원", cheongjuText);
  assert.deepEqual(cheongju.partner_vendors.map(({ vendor_name, category }) => ({
    vendor_name,
    category,
  })), [{ vendor_name: "청주상의원", category: "dress" }]);
  assert.equal(cheongju.partner_vendors.some(({ vendor_name }) => /플로렌스/u.test(vendor_name)), false);
  assert.match(cheongju.extraction_notes, /cross_business_sheet_identity:Sheet1/u);
  assert.ok(findCoverageGaps(cheongjuText, cheongju, { includeAuditLedger: false }).some(
    ({ raw }) => raw === "800.000원",
  ));

  const florenceText = [
    "## 시트: Sheet1",
    "Sheet1!A1: 플로렌스웨딩",
    "Sheet1!A3: 1.가격(V.A,T 포함)",
    "Sheet1!A5: 본식 드레스(대여)",
    "Sheet1!B5: 기본 800.000원~1.330.0000원",
    "Sheet1!A8: 드레스 투어 피팅비용",
    "Sheet1!B8: 55.000원",
    "Sheet1!A10: 신부메이크업",
    "Sheet1!B10: 330.0000원",
    "Sheet1!A11: 혼주 여자메이크업",
    "Sheet1!B11: 165.000원",
    "## 시트: Sheet2",
    "Sheet2!A1: 󰊱 플로렌스 웨딩",
    "Sheet2!A2: ① 가격(VAT 포함)",
    "Sheet2!A3: 기본가격",
    "Sheet2!A4: 대여(1벌기준)",
    "Sheet2!B4: 명주실크 550,000원",
  ].join("\n");
  const florence = extractAgency("플로렌스웨딩", florenceText);
  assert.deepEqual(
    florence.partner_vendors.map(({ category }) => category),
    ["dress", "makeup"],
  );
  for (const vendor of florence.partner_vendors) {
    assert.deepEqual([vendor.price_min_krw, vendor.price_max_krw, vendor.options], [null, null, []]);
  }
  const structuredAmounts = florence.partner_vendors.flatMap((vendor) => (
    vendor.options.flatMap((option) => [option.price_min_krw, option.price_max_krw])
  ));
  assert.equal(structuredAmounts.includes(800_000), false);
  assert.equal(structuredAmounts.includes(330), false);
  assert.ok(findCoverageGaps(florenceText, florence, { includeAuditLedger: false }).some(
    ({ raw }) => raw === "330.0000원",
  ));
});
