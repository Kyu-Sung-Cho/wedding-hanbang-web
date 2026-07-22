import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractDisclosureFromLocalEvidence } from "../local-extract.js";
import { encodeMergedEvidenceQuote } from "../merge-evidence.js";
import { sourceFileId } from "../provenance.js";
import type { DisclosureExtraction } from "../schemas.js";
import type { ManifestUnit } from "../types.js";
import { deriveValidatedPayloadForUnit, findCoverageGaps } from "../validate.js";

const UNIT_ID = "a".repeat(64);

async function localHallUnit(
  temporaryRoot: string,
  relativePath: string,
  rawName: string,
  text: string,
): Promise<{ unit: ManifestUnit; sourceId: string }> {
  const source: ManifestUnit["source_files"][number] = {
    path: relativePath,
    absolute_path: path.join(temporaryRoot, path.basename(relativePath)),
    ext: "xlsx",
    sha256: "b".repeat(64),
    bytes: 1,
  };
  const sourceId = sourceFileId(source);
  const conversionRoot = path.join(temporaryRoot, ".converted", UNIT_ID, sourceId);
  const textPath = path.join(conversionRoot, "1-sheets.txt");
  await mkdir(conversionRoot, { recursive: true });
  await writeFile(textPath, text, "utf8");
  return {
    sourceId,
    unit: {
      unit_id: UNIT_ID,
      display_name: path.basename(relativePath),
      parsed: {
        region_code: "seoul_gangnam3",
        raw_name: rawName,
        normalized_name: rawName,
        corporate_name: null,
        kind_hint: "hall",
      },
      source_files: [source],
      source_fingerprint: "c".repeat(64),
      stage: "extracted",
      notices: [],
      conversion: {
        converter_version: "hall-topology-fixture",
        source_fingerprint: "c".repeat(64),
        text_artifacts: [textPath],
        image_artifacts: [],
        text_characters: text.length,
        cell_count: text.split(/\r?\n/u).filter((line) => /![A-Z]+\d+:/u.test(line)).length,
        artifact_fingerprint: "d".repeat(64),
        converted_at: new Date(0).toISOString(),
      },
    },
  };
}

function optionByName(
  data: DisclosureExtraction,
  hallIndex: number,
  name: string,
) {
  return data.halls?.[hallIndex]?.options.find((option) => option.name === name);
}

test("Floating Island row topology separates venue/decor and preserves equal in-cell options", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-floating-topology-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: ㈜플로팅아일랜드",
    "Sheet1!A2: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 식비",
    "Sheet1!D3: 대관료, 장식비",
    "Sheet1!F3: 선택품목 가격",
    "Sheet1!F4: 폐백",
    "Sheet1!G4: 식음료 추가",
    "Sheet1!H4: 장식 추가",
    "Sheet1!M4: 기타 옵션",
    "Sheet1!A5: 컨벤션홀",
    "Sheet1!B5: 기본300명",
    "Sheet1!C5: 99,000원~132,000원",
    "Sheet1!D5: 대관",
    "Sheet1!E5: 5,500,000원",
    "Sheet1!F5: 440,000원",
    "Sheet1!G5: 7,700원~8,800원",
    "Sheet1!H5: 2,200,000원",
    "Sheet1!M5: 현수막 770,000원<br>깃발 770,000원",
    "Sheet1!B6: 추가 1명당",
    "Sheet1!C6: 99,000원~132,000원",
    "Sheet1!D6: 장식비(연출포함)",
    "Sheet1!E6: 11,000,000원",
    "Sheet1!A7: 야외예식장(기타)",
    "Sheet1!B7: - (인원 제한 없음)",
    "Sheet1!D7: 대관",
    "Sheet1!E7: 3,300,000원",
    "Sheet1!B8: 1명당",
    "Sheet1!C8: 99,000원~132,000원",
    "Sheet1!D8: 장식비(연출포함)",
    "Sheet1!E8: 10,450,000원",
    "Sheet1!A10: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
    "Sheet1!A11: 결혼식 진행일로부터 150일 이내 취소 시 계약서상 총 결제금액의 10%<br>결혼식 진행일로부터 120일 이내 취소 시 계약서상 총 결제금액의 20%",
    "Sheet1!A12: 결혼식 진행일로부터 90일 이내 취소 시 계약서상 총 결제금액의 30%",
    "병합 범위 A3:A4 · 좌상단 A3",
    "병합 범위 B3:C4 · 좌상단 B3",
    "병합 범위 D3:E4 · 좌상단 D3",
    "병합 범위 F3:M3 · 좌상단 F3",
    "병합 범위 A5:A6 · 좌상단 A5",
    "병합 범위 A7:A8 · 좌상단 A7",
  ].join("\n");
  const { unit, sourceId } = await localHallUnit(
    temporaryRoot,
    "hall/seoul/floating.xlsx",
    "플로팅아일랜드",
    text,
  );
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "플로팅아일랜드",
    regionCode: "seoul_gangnam3",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: sourceId, text }],
  });

  assert.equal(
    extraction.halls?.[0]?.decoration_fee_min_krw,
    11_000_000,
    JSON.stringify(extraction.halls, null, 2),
  );
  assert.deepEqual(extraction.halls?.map((hall) => ({
    name: hall.hall_name,
    meal: [hall.meal_price_min_krw, hall.meal_price_max_krw],
    venue: [hall.venue_fee_min_krw, hall.venue_fee_max_krw],
    decoration: [hall.decoration_fee_min_krw, hall.decoration_fee_max_krw],
  })), [{
    name: "컨벤션홀",
    meal: [99_000, 132_000],
    venue: [5_500_000, 5_500_000],
    decoration: [11_000_000, 11_000_000],
  }, {
    name: "야외예식장(기타)",
    meal: [99_000, 132_000],
    venue: [3_300_000, 3_300_000],
    decoration: [10_450_000, 10_450_000],
  }]);
  assert.deepEqual(
    ["추가 1명당", "장식 추가", "현수막", "깃발"].map((name) => {
      const option = optionByName(extraction, 0, name);
      return [name, option?.price_min_krw, option?.price_max_krw];
    }),
    [
      ["추가 1명당", 99_000, 132_000],
      ["장식 추가", 2_200_000, 2_200_000],
      ["현수막", 770_000, 770_000],
      ["깃발", 770_000, 770_000],
    ],
  );
  assert.ok(extraction.sections?.some((section) => (
    section.content_verbatim.includes("10%") && section.content_verbatim.includes("20%")
  )));
  assert.ok(extraction.sections?.some((section) => section.content_verbatim.includes("30%")));

  const validated = await deriveValidatedPayloadForUnit(
    unit,
    { data: extraction },
    { mode: "local_deterministic" },
  );
  assert.equal(validated.data.halls?.[0]?.venue_fee_min_krw, 5_500_000);
  assert.equal(validated.data.halls?.[0]?.decoration_fee_min_krw, 11_000_000);
  assert.equal(validated.data.halls?.[1]?.venue_fee_min_krw, 3_300_000);
  assert.equal(validated.data.halls?.[1]?.decoration_fee_min_krw, 10_450_000);
  assert.equal(validated.issues.some(({ code }) => (
    code === "local_hall_venue_fee_quarantined"
    || code === "local_hall_decoration_fee_quarantined"
  )), false, JSON.stringify(validated.issues));
  assert.deepEqual(validated.coverageGaps, []);
});

test("Noble policy tiers survive and combined fees remain exact non-legacy options", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-noble-topology-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A1: 노블발렌티 대치점",
    "Sheet1!A2: ① 가격(VAT 포함)",
    "Sheet1!A3: 예식홀명",
    "Sheet1!B3: 식비",
    "Sheet1!C3: 대관료, 장식비",
    "Sheet1!E3: 선택품목 가격",
    "Sheet1!J4: 영상 촬영",
    "Sheet1!K4: 사진 촬영",
    "Sheet1!L4: 기타 옵션",
    "Sheet1!A5: 노블발렌티 대치점",
    "Sheet1!B5: 75,000원 ~ 99,000원",
    "Sheet1!C5: 정가: 13,000,000원",
    "Sheet1!D5: 5,800,000원 ~ 12,100,000원",
    "Sheet1!J5: 본식 DVD<br>770,000원~1,100,000원",
    "Sheet1!K5: 본식 사진<br>990,000원~1,430,000원",
    "Sheet1!L5: 혼주 헤어메이크업<br>90,000원~250,000원",
    "Sheet1!A7: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
    "Sheet1!A8: 고객 사유로 예식일 180일 이전 취소 시 계약금의 10% 취소 수수료",
    "Sheet1!A9: 고객 사유로 예식일 180일 이내 계약을 해지한 경우 위약금 발생",
    "Sheet1!A10: 예식 179일부터 90일 이전 취소 시 예식 총 금액의 5% 배상",
    "Sheet1!A11: 예식 89일부터 60일 이전 취소 시 예식 총 금액의 10% 배상",
    "Sheet1!A12: 예식 59일부터 30일 이전 취소 시 예식 총 금액의 20% 배상",
    "Sheet1!A13: 예식 29일부터 10일 이전 취소 시 예식 총 금액의 40% 배상",
    "Sheet1!A14: 예식 9일부터 1일 이전 취소 시 예식 총 금액의 50% 배상",
    "Sheet1!A15: 예식 당일 취소 시 예식 총 금액의 70% 배상",
    "병합 범위 A3:A4 · 좌상단 A3",
    "병합 범위 B3:B4 · 좌상단 B3",
    "병합 범위 C3:D4 · 좌상단 C3",
    "병합 범위 E3:L3 · 좌상단 E3",
  ].join("\n");
  const { unit, sourceId } = await localHallUnit(
    temporaryRoot,
    "hall/seoul/noble.xlsx",
    "노블발렌티 대치점",
    text,
  );
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "노블발렌티 대치점",
    regionCode: "seoul_gangnam3",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: sourceId, text }],
  });
  const policyText = (extraction.sections ?? []).map((section) => section.content_verbatim).join("\n");
  for (const tier of ["5%", "10%", "20%", "40%", "50%", "70%"] as const) {
    assert.match(policyText, new RegExp(tier, "u"));
  }
  assert.equal(extraction.halls?.[0]?.venue_fee_min_krw, null);
  assert.equal(extraction.halls?.[0]?.decoration_fee_min_krw, null);
  assert.deepEqual(
    extraction.halls?.[0]?.options
      .filter((option) => option.name === "대관료, 장식비")
      .map((option) => [option.price_min_krw, option.price_max_krw]),
    [[13_000_000, 13_000_000], [5_800_000, 12_100_000]],
  );

  const validated = await deriveValidatedPayloadForUnit(
    unit,
    { data: extraction },
    { mode: "local_deterministic" },
  );
  assert.deepEqual(validated.coverageGaps, []);
  assert.equal(validated.data.halls?.[0]?.venue_fee_min_krw, null);
  assert.equal(validated.data.halls?.[0]?.decoration_fee_min_krw, null);
  assert.ok(validated.data.sections?.some((section) => (
    section.section_type === "pricing_basis"
    && section.source_quote.includes("Sheet1!A2")
  )));
  assert.ok(validated.data.sections?.some((section) => section.content_verbatim.includes("5%")));
});

test("a money-bearing misc section is review evidence, not structured hall coverage", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-hall-section-coverage-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A3: 예식홀명",
    "Sheet1!A5: 단독홀",
    "Sheet1!D5: 대관",
    "Sheet1!E5: 3,300,000원",
    "Sheet1!A6: 주차는 2시간 무료",
  ].join("\n");
  const { unit, sourceId } = await localHallUnit(
    temporaryRoot,
    "hall/seoul/review-ledger.xlsx",
    "검수예식장",
    text,
  );
  const data = extractDisclosureFromLocalEvidence({
    canonicalName: "검수예식장",
    regionCode: "seoul_gangnam3",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: sourceId, text }],
  });
  const hall = data.halls?.[0];
  assert.ok(hall);
  hall.venue_fee_min_krw = null;
  hall.venue_fee_max_krw = null;
  hall.source_quote = `Sheet1!A5: 단독홀`;
  data.sections = [{
    section_type: "pricing_basis",
    title: "미연결 대관 가격",
    content_verbatim: "대관 3,300,000원",
    summary: "대관 3,300,000원",
    source_quote: encodeMergedEvidenceQuote([{
      source_file_id: sourceId,
      quote: "Sheet1!D5: 대관",
    }, {
      source_file_id: sourceId,
      quote: "Sheet1!E5: 3,300,000원",
    }], 2_000)!,
    source_file_ids: [sourceId],
    confidence: 0.35,
    needs_review: true,
  }, {
    section_type: "other",
    title: "주차 안내",
    content_verbatim: "주차는 2시간 무료",
    summary: "주차는 2시간 무료",
    source_quote: "Sheet1!A6: 주차는 2시간 무료",
    source_file_ids: [sourceId],
    confidence: 0.4,
    needs_review: true,
  }];

  const validated = await deriveValidatedPayloadForUnit(
    unit,
    { data },
    { mode: "local_deterministic" },
  );
  assert.ok(validated.coverageGaps.some(({ krw }) => krw === 3_300_000));
  assert.ok(validated.data.sections?.some((section) => section.title === "미연결 대관 가격"));
  assert.ok(validated.data.sections?.some((section) => section.title === "주차 안내"));
});

test("대관 및 장식 headers produce one exact combined option rather than a legacy fee", () => {
  const text = [
    "## 시트: Sheet1",
    "Sheet1!A3: 예식홀명",
    "Sheet1!D3: 대관 및 장식",
    "Sheet1!A5: 티웨딩홀",
    "Sheet1!D5: 3,300,000원~4,400,000원",
  ].join("\n");
  const extraction = extractDisclosureFromLocalEvidence({
    canonicalName: "티웨딩",
    regionCode: "seoul_gangnam3",
    kindHint: "hall",
    hasImages: false,
    sources: [{ sourceFileId: "e".repeat(64), text }],
  });
  const hall = extraction.halls?.[0];
  assert.ok(hall);
  assert.deepEqual([
    hall.venue_fee_min_krw,
    hall.venue_fee_max_krw,
    hall.decoration_fee_min_krw,
    hall.decoration_fee_max_krw,
  ], [null, null, null, null]);
  assert.deepEqual(hall.options.map((option) => ({
    name: option.name,
    minimum: option.price_min_krw,
    maximum: option.price_max_krw,
  })), [{
    name: "대관 및 장식",
    minimum: 3_300_000,
    maximum: 4_400_000,
  }]);
  assert.deepEqual(findCoverageGaps(text, extraction, { includeAuditLedger: false }), []);
});
