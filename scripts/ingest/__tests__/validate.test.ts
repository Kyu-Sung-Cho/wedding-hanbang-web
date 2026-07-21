import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { canonicalJsonSha256ExcludingField } from "../artifact-integrity.js";
import { convertManifest } from "../convert.js";
import { extractManifestForTests as extractManifest, type ExtractionProvider } from "../extract.js";
import { loadValidated } from "../load.js";
import { scanSources } from "../scan.js";
import { encodeMergedEvidenceQuote } from "../merge-evidence.js";
import type { DisclosureExtraction } from "../schemas.js";
import type { ManifestUnit } from "../types.js";
import {
  findCoverageGaps,
  indexXlsxCellEvidence,
  matchSingleXlsxEvidenceQuote,
  normalizeEvidenceText,
  parseKoreanMoneyAmounts,
  scanSourceMoneyOccurrences,
  validateExtractionForUnit,
  validateManifest,
} from "../validate.js";
import {
  indexXlsxAuxiliaryEvidence,
  matchSingleXlsxAuxiliaryEvidenceQuote,
  parseXlsxAuxiliaryEvidencePayload,
} from "../xlsx-aux-evidence.js";

async function writeDummyDocx(filePath: string, text: string): Promise<void> {
  const docx = new JSZip();
  docx.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  docx.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  docx.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  await writeFile(filePath, await docx.generateAsync({ type: "nodebuffer" }));
}

function extraction(businessName: string): DisclosureExtraction {
  return {
    doc_kind: "agency_disclosure",
    business_name: businessName,
    region_hint: "광주",
    agency_packages: [{
      package_name: "더미 패키지",
      category_scope: ["studio", "dress", "makeup"],
      price_min_krw: 33_000,
      price_max_krw: 33_000,
      vat_note: null,
      price_note: null,
      options: [],
      source_quote: "더미 패키지 3.3만원",
      confidence: 0.9,
      needs_review: false,
    }],
    partner_vendors: [],
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
    extraction_notes: "generated fixture",
  };
}

test("validation accepts an exact XLSX locator with a contiguous fragment from its one source cell", () => {
  const sourceText = [
    "## 시트: 가격표",
    "가격표!A2: 더미 패키지",
    "가격표!B2: 앞 문구 더미 패키지 스튜디오 드레스 메이크업 기본가격 3.3만원 뒤 문구",
  ].join("\n");
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.xlsx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.xlsx",
      absolute_path: "C:/generated/generated.xlsx",
      ext: "xlsx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.agency_packages[0].source_quote = "가격표!B2: 더미 패키지 스튜디오 드레스 메이크업 기본가격 3.3만원";

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    xlsxCells: indexXlsxCellEvidence(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some((issue) => issue.severity === "error"), false, JSON.stringify(issues));
});

test("single-cell evidence matching rejects ranges, multi-cell composites, and disjoint cell fragments", () => {
  const cells = indexXlsxCellEvidence([
    "가격표!A2: 실제 패키지",
    "가격표!B2: 앞 문구 기본가격 3.3만원 뒤 문구",
  ].join("\n"));

  assert.equal(matchSingleXlsxEvidenceQuote("가격표!B2: 기본가격 3.3만원", cells).kind, "match");
  assert.equal(matchSingleXlsxEvidenceQuote("가격표!A2:B2: 실제 패키지 3.3만원", cells).kind, "reject");
  assert.equal(
    matchSingleXlsxEvidenceQuote("가격표!A2: 실제 패키지; 가격표!B2: 기본가격 3.3만원", cells).kind,
    "reject",
  );
  assert.equal(matchSingleXlsxEvidenceQuote("가격표!B2: 앞 문구 뒤 문구", cells).kind, "reject");
});

test("XLSX auxiliary evidence is exact, request-scoped, and never indexed as a worksheet cell", () => {
  const drawing = "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1: [ 총비용 = 예식비 + 식대총액 ]";
  const formula = "XLSX_FORMULA [sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20;part=xl/worksheets/sheet5.xml#cell-B20]: expression=SUM(C12,C14,C16) | cached_value_locator=[sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20] | evaluation=not_executed";
  const text = ["계약서!B20: 4,160,000", drawing, formula].join("\n");
  const auxiliary = indexXlsxAuxiliaryEvidence(text);

  assert.deepEqual(Object.keys(indexXlsxCellEvidence(text)), ["계약서!B20"]);
  assert.equal(matchSingleXlsxAuxiliaryEvidenceQuote(drawing, auxiliary).kind, "match");
  assert.equal(
    matchSingleXlsxAuxiliaryEvidenceQuote(
      "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1: 총비용 = 예식비 + 식대총액",
      auxiliary,
    ).kind,
    "reject",
  );
  assert.equal(matchSingleXlsxAuxiliaryEvidenceQuote(formula, auxiliary).kind, "match");
  assert.equal(
    parseXlsxAuxiliaryEvidencePayload(formula),
    "expression=SUM(C12,C14,C16) | cached_value_locator=[sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20] | evaluation=not_executed",
  );
  assert.deepEqual(
    matchSingleXlsxAuxiliaryEvidenceQuote(
      formula.replace("sheet5.xml", "sheet99.xml"),
      auxiliary,
    ),
    {
      kind: "reject",
      locator: "XLSX_FORMULA [sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20;part=xl/worksheets/sheet99.xml#cell-B20]",
      violation: "not_in_request",
    },
  );
  assert.equal(
    matchSingleXlsxAuxiliaryEvidenceQuote(
      `${drawing}; ${formula}`,
      auxiliary,
    ).kind,
    "reject",
  );
});

test("exact XLSX drawing and formula evidence ground pricing-basis sections end to end", () => {
  const drawing = "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1: [ 총비용 = 예식비 + 식대총액 ]";
  const formula = "XLSX_FORMULA [sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20;part=xl/worksheets/sheet5.xml#cell-B20]: expression=SUM(C12,C14,C16) | cached_value_locator=[sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20] | evaluation=not_executed";
  const packageLine = "가격표!B2: 더미 패키지 스튜디오 드레스 메이크업 기본가격 3.3만원";
  const sourceText = [packageLine, drawing, formula].join("\n");
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.xlsx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.xlsx",
      absolute_path: "C:/generated/generated.xlsx",
      ext: "xlsx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.agency_packages[0].source_quote = packageLine;
  data.sections = [
    {
      section_type: "pricing_basis",
      title: "총비용",
      content_verbatim: "[ 총비용 = 예식비 + 식대총액 ]",
      summary: "총비용 산정 기준",
      source_quote: drawing,
      source_file_ids: [],
      confidence: 0.99,
      needs_review: false,
    },
    {
      section_type: "pricing_basis",
      title: "SUM(C12,C14,C16)",
      content_verbatim: "SUM(C12,C14,C16)",
      summary: "원문 수식",
      source_quote: formula,
      source_file_ids: [],
      confidence: 0.99,
      needs_review: false,
    },
  ];
  const evidence = {
    normalizedText: normalizeEvidenceText(sourceText),
    xlsxCells: indexXlsxCellEvidence(sourceText),
    xlsxAuxiliary: indexXlsxAuxiliaryEvidence(sourceText),
    hasImages: false,
  };

  const accepted = validateExtractionForUnit(unit, structuredClone(data), evidence);
  assert.equal(
    accepted.some((issue) => issue.severity === "error" && issue.path.startsWith("sections[")),
    false,
    JSON.stringify(accepted),
  );

  const forged = structuredClone(data);
  forged.sections![0].source_quote = drawing.replace("text-box-1", "text-box-2");
  forged.sections![1].source_quote = formula.replace("sheet5.xml", "sheet99.xml");
  const forgedIssues = validateExtractionForUnit(unit, forged, evidence);
  assert.equal(
    forgedIssues.filter((issue) =>
      issue.severity === "error" && issue.code === "source_quote_not_found_in_text"
    ).length,
    2,
    JSON.stringify(forgedIssues),
  );

  const unlabeled = structuredClone(data);
  unlabeled.sections![0].source_quote = "총비용 = 예식비 + 식대총액";
  const unlabeledIssues = validateExtractionForUnit(unit, unlabeled, evidence);
  assert.equal(unlabeledIssues.some((issue) =>
    issue.severity === "error"
    && issue.code === "source_quote_not_found_in_text"
    && issue.path === "sections[0]"
  ), true, JSON.stringify(unlabeledIssues));
});

test("drawing money is scanned once at its auxiliary locator and formula annotations add no duplicate", () => {
  const drawing = "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1: 라온제나 대관료 500만원";
  const formula = "XLSX_FORMULA [sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20;part=xl/worksheets/sheet5.xml#cell-B20]: expression=SUM(C12,C14,C16) | cached_value_locator=[sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20] | evaluation=not_executed";
  const sourceText = ["계약서!B20: 4,160,000원", drawing, formula].join("\n");
  const occurrences = scanSourceMoneyOccurrences(sourceText);

  assert.deepEqual(occurrences.map(({ krw, source_locator }) => ({ krw, source_locator })), [
    { krw: 4_160_000, source_locator: "계약서!B20" },
    { krw: 5_000_000, source_locator: "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1" },
  ]);
});

test("validate writes provenance-bound pending artifacts and only suggests likely duplicates", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-validate-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(광주)_샘플정우웨딩.docx"), "더미 패키지 스튜디오 드레스 메이크업 3.3만원");
  await writeDummyDocx(
    path.join(regionDir, "(광주)_광주샘플정우웨딩.docx"),
    "광주 지점 안내 | 더미 패키지 스튜디오 드레스 메이크업 3.3만원",
  );
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const names = new Map(scanned.units.map((unit) => [unit.unit_id, unit.parsed.raw_name]));
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const data = extraction(names.get(request.unitId) ?? "더미");
      const sourceQuote = /^(line:\d+:\s*.*더미 패키지 스튜디오 드레스 메이크업 3\.3만원)$/mu
        .exec(request.text)?.[1];
      assert.ok(sourceQuote);
      data.agency_packages[0].source_quote = sourceQuote;
      return { data, inputTokens: 10, outputTokens: 10 };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });

  const validated = await validateManifest({ stateDir });

  assert.equal(
    validated.units.every((unit) => unit.stage === "validated"),
    true,
    JSON.stringify(validated.units.map((unit) => ({ stage: unit.stage, notices: unit.notices }))),
  );
  assert.equal(validated.units.every((unit) => unit.validation?.review_status === "pending"), true);
  const artifact = JSON.parse(await readFile(validated.units[0].validation?.artifact_path ?? "", "utf8"));
  assert.equal(artifact.schema_version, 2);
  assert.equal(validated.units[0].validation?.content_sha256, artifact.content_sha256);
  assert.equal(
    validated.units[0].validation?.extraction_content_sha256,
    validated.units[0].extraction?.content_sha256,
  );
  assert.equal(artifact.source_files[0].sha256, validated.units[0].source_files[0].sha256);
  assert.match(
    artifact.data.agency_packages[0].source_quote,
    /^line:1: .*더미 패키지 스튜디오 드레스 메이크업 3\.3만원$/u,
  );
  const candidates = JSON.parse(
    await readFile(path.join(stateDir, "validated", "dedupe_candidates.json"), "utf8"),
  );
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].decision, "human_review_required");
  assert.ok(candidates.candidates[0].similarity >= 0.7);
  const dryRun = await loadValidated({ stateDir, snapshot: "2026Q3" });
  assert.equal(dryRun.plan.dedupe_candidates.length, 1);
  assert.equal(dryRun.plan.dedupe_candidates[0].entity_kind, "agency");
});

test("duplicate source notices force every staged row to remain in manual review", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-validate-duplicate-source-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "광주");
  await mkdir(regionDir, { recursive: true });
  const firstPath = path.join(regionDir, "(광주)_중복원본가.docx");
  const secondPath = path.join(regionDir, "(광주)_중복원본나.docx");
  await writeDummyDocx(firstPath, "더미 패키지 스튜디오 드레스 메이크업 3.3만원");
  await writeFile(secondPath, await readFile(firstPath));

  const scanned = await scanSources({ rootDir, stateDir });
  assert.equal(scanned.units.length, 2);
  assert.equal(scanned.units.every((unit) =>
    unit.notices.some((notice) => notice.startsWith("duplicate_source_content:"))
  ), true);
  await convertManifest({ stateDir });
  const names = new Map(scanned.units.map((unit) => [unit.unit_id, unit.parsed.raw_name]));
  await extractManifest({ stateDir }, {
    provider: {
      extract: async (request) => {
        const data = extraction(names.get(request.unitId) ?? "더미");
        const sourceQuote = /^(line:\d+:\s*.*더미 패키지 스튜디오 드레스 메이크업 3\.3만원)$/mu
          .exec(request.text)?.[1];
        assert.ok(sourceQuote);
        data.agency_packages[0].source_quote = sourceQuote;
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
    env: {},
  });

  const validated = await validateManifest({ stateDir });
  assert.equal(validated.units.every((unit) => unit.stage === "validated"), true);
  for (const unit of validated.units) {
    const artifact = JSON.parse(await readFile(unit.validation?.artifact_path ?? "", "utf8"));
    assert.equal(artifact.issues.some((issue: { code?: string; severity?: string }) =>
      issue.code === "duplicate_source_content" && issue.severity === "warning"
    ), true, JSON.stringify(artifact.issues));
  }

  const dryRun = await loadValidated({ stateDir, snapshot: "2026Q3" });
  assert.equal(dryRun.plan.agency_packages.length, 2);
  assert.equal(dryRun.plan.agency_packages.every((row) => row.needs_review), true);
  assert.equal(dryRun.plan.agency_packages.every((row) =>
    row.validation_issue_codes.includes("duplicate_source_content")
  ), true);
});

test("local evidence sanitization forces every staged row to remain in manual review", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-validate-local-guard-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(
    path.join(regionDir, "(광주)_근거보호.docx"),
    "더미 패키지 스튜디오 드레스 메이크업 3.3만원",
  );
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  await extractManifest({ stateDir }, {
    provider: {
      extract: async (request) => {
        const data = extraction(scanned.units[0].parsed.raw_name);
        const sourceQuote = /^(line:\d+:\s*.*더미 패키지 스튜디오 드레스 메이크업 3\.3만원)$/mu
          .exec(request.text)?.[1];
        assert.ok(sourceQuote);
        data.agency_packages[0].source_quote = sourceQuote;
        data.extraction_notes = "[local_evidence_guard] removed unsupported policy record";
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
    env: {},
  });

  const validated = await validateManifest({ stateDir });
  assert.equal(validated.units[0].stage, "validated");
  const artifact = JSON.parse(
    await readFile(validated.units[0].validation?.artifact_path ?? "", "utf8"),
  );
  assert.equal(artifact.issues.some((issue: { code?: string; severity?: string }) =>
    issue.code === "local_evidence_guard" && issue.severity === "warning"
  ), true, JSON.stringify(artifact.issues));

  const dryRun = await loadValidated({ stateDir, snapshot: "2026Q3" });
  assert.equal(dryRun.plan.agency_packages.length, 1);
  assert.equal(dryRun.plan.agency_packages[0].needs_review, true);
  assert.equal(
    dryRun.plan.agency_packages[0].validation_issue_codes.includes("local_evidence_guard"),
    true,
  );
});

test("validate retries an error-stage unit only through its verified extraction provenance", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-validate-error-retry-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(
    path.join(regionDir, "(광주)_오류복구.docx"),
    "더미 패키지 스튜디오 드레스 메이크업 3.3만원",
  );
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  await extractManifest({ stateDir }, {
    provider: {
      extract: async () => {
        const data = extraction(scanned.units[0].parsed.raw_name);
        data.agency_packages[0].source_quote =
          "line:1: 더미 패키지 스튜디오 드레스 메이크업 3.3만원";
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
    env: {},
  });
  const manifestPath = path.join(stateDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.units[0].stage = "error";
  delete manifest.units[0].validation;
  manifest.units[0].notices.push(
    "validate failed: extraction artifact provenance mismatch (extract_cache_invalid:finalization_mismatch)",
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const validated = await validateManifest({ stateDir });

  assert.equal(validated.units[0].stage, "validated", JSON.stringify(validated.units[0].notices));
  assert.ok(validated.units[0].validation);
  assert.equal(
    validated.units[0].notices.some((notice) => notice.startsWith("validate failed:")),
    false,
  );

  const extractionArtifactPath = validated.units[0].extraction?.artifact_path;
  assert.ok(extractionArtifactPath);
  const forgedArtifact = JSON.parse(await readFile(extractionArtifactPath, "utf8"));
  forgedArtifact.data.business_name = "self-rehashed forged error-stage result";
  forgedArtifact.content_sha256 = canonicalJsonSha256ExcludingField(
    forgedArtifact,
    "content_sha256",
  );
  await writeFile(
    extractionArtifactPath,
    `${JSON.stringify(forgedArtifact, null, 2)}\n`,
    "utf8",
  );
  const forgedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  forgedManifest.units[0].stage = "error";
  delete forgedManifest.units[0].validation;
  forgedManifest.units[0].extraction.content_sha256 = forgedArtifact.content_sha256;
  forgedManifest.units[0].notices.push("validate failed: retry forged cache fixture");
  await writeFile(manifestPath, `${JSON.stringify(forgedManifest, null, 2)}\n`, "utf8");

  const rejected = await validateManifest({ stateDir });

  assert.equal(rejected.units[0].stage, "error");
  assert.equal(rejected.units[0].validation, undefined);
  assert.match(rejected.units[0].notices.join("\n"), /finalization_mismatch/u);
});

test("validate blocks a content-tampered extraction artifact", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-validate-extract-tamper-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "extract-tamper.docx"), "더미 패키지 3.3만원");
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const extracted = await extractManifest({ stateDir }, {
    provider: {
      extract: async () => {
        const data = extraction(scanned.units[0].parsed.raw_name);
        data.agency_packages[0].source_quote = "line:1: 더미 패키지 3.3만원";
        return { data, inputTokens: 10, outputTokens: 10 };
      },
    },
    env: {},
  });
  const extractionPath = extracted.units[0].extraction?.artifact_path ?? "";
  const artifact = JSON.parse(await readFile(extractionPath, "utf8"));
  artifact.data.business_name = "tampered";
  await writeFile(extractionPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const validated = await validateManifest({ stateDir });

  assert.equal(validated.units[0].stage, "error");
  assert.equal(validated.units[0].validation, undefined);
  assert.match(validated.units[0].notices.join("\n"), /provenance mismatch/u);
});

test("validate repairs a content-tampered cache artifact instead of trusting its stored fingerprint", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-validate-cache-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(
    path.join(regionDir, "(광주)_캐시복구웨딩.docx"),
    "더미 패키지 스튜디오 드레스 메이크업 3.3만원",
  );
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const provider: ExtractionProvider = {
    extract: async () => {
      const data = extraction(scanned.units[0].parsed.raw_name);
      data.agency_packages[0].source_quote = "line:1: 더미 패키지 스튜디오 드레스 메이크업 3.3만원";
      return { data, inputTokens: 10, outputTokens: 10 };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const first = await validateManifest({ stateDir });
  const artifactPath = first.units[0].validation?.artifact_path;
  assert.ok(artifactPath);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const expectedFingerprint = artifact.fingerprint;
  artifact.data.business_name = "변조된 업체명";
  artifact.issues = [];
  // Simulate a damaged cache that kept the trusted-looking metadata field.
  artifact.fingerprint = expectedFingerprint;
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const repairedManifest = await validateManifest({ stateDir });
  const repaired = JSON.parse(await readFile(artifactPath, "utf8"));

  assert.equal(
    repairedManifest.units[0].stage,
    "validated",
    JSON.stringify(repairedManifest.units[0].notices),
  );
  assert.equal(repaired.fingerprint, expectedFingerprint);
  assert.equal(repaired.data.business_name, scanned.units[0].parsed.raw_name);
  assert.notDeepEqual(repaired.issues, []);
});

test("Korean money parsing keeps decimal 만원 units exact", () => {
  assert.deepEqual(parseKoreanMoneyAmounts("기본 3.3만원 / 상위 124만원"), [33_000, 1_240_000]);
});

test("money parsing recognizes explicit KRW codes and won symbols", () => {
  assert.deepEqual(
    parseKoreanMoneyAmounts("기본가 KRW 100000 / 추가 ₩250,000 / 변경 300000 KRW"),
    [100_000, 250_000, 300_000],
  );
});

test("currency markers preserve Korean units instead of treating them as bare won", () => {
  assert.deepEqual(
    parseKoreanMoneyAmounts("기본 KRW 10만원 / 패키지 ₩1,000만원 / 피팅 KRW 5만5천원"),
    [100_000, 10_000_000, 55_000],
  );
});

test("currency-marker ranges apply a shared Korean unit to both endpoints", () => {
  assert.deepEqual(
    parseKoreanMoneyAmounts("대관 KRW 10~20만원 / 식대 ₩1.5~2억원"),
    [100_000, 200_000, 150_000_000, 200_000_000],
  );
});

test("coverage self-check preserves Korean units attached to KRW and won symbols", () => {
  const data = extraction("통화 단위 업체");
  data.agency_packages = [];
  assert.deepEqual(
    findCoverageGaps("기본 KRW 10만원\n패키지 ₩1,000만원", data)
      .map((gap) => gap.krw),
    [100_000, 10_000_000],
  );
});

test("coverage self-check counts explicit KRW and won-symbol ranges", () => {
  const data = extraction("통화 표기 업체");
  data.agency_packages = [];
  assert.deepEqual(
    findCoverageGaps("기본 KRW 100000~200000\n옵션 ₩300,000-₩400,000", data)
      .map((gap) => gap.krw),
    [100_000, 200_000, 300_000, 400_000],
  );
});

test("Korean money parsing expands shared range units and accepts omitted won suffixes", () => {
  assert.deepEqual(parseKoreanMoneyAmounts("range 100~120만원 / upper 124만"), [1_000_000, 1_200_000, 1_240_000]);
});

test("Korean money parsing keeps zero in a labeled shared-unit range", () => {
  assert.deepEqual(parseKoreanMoneyAmounts("국내 0 ~ 최고 120만원"), [0, 1_200_000]);
});

test("Korean money parsing treats compound units as one amount", () => {
  assert.deepEqual(parseKoreanMoneyAmounts("피팅비 5만5천원 / 정정 1억2천만원"), [55_000, 120_000_000]);
});

test("Korean money parsing rejects Korean count units that only start like money", () => {
  assert.deepEqual(
    parseKoreanMoneyAmounts("누적 1만명 / 하객 2천명 / 답례품 3만개 / 이용료 4만원"),
    [40_000],
  );
});

test("coverage self-check finds source money omitted from every extracted KRW field", () => {
  const data = extraction("generated");
  data.agency_packages[0].price_min_krw = 1_240_000;
  data.agency_packages[0].price_max_krw = 1_240_000;
  data.agency_packages[0].source_quote = "기본 124만원";

  const gaps = findCoverageGaps(
    "기본 124만원\n추가 옵션 33,000원\n전화 02-1234-5678\n사업자등록번호 123-45-67890",
    data,
  );

  assert.deepEqual(gaps, [{
    raw: "33,000원",
    krw: 33_000,
    line_context: "추가 옵션 33,000원",
    source_locator: "line:2",
  }]);
});

test("coverage self-check understands header-declared 만원 cells in compressed tables", () => {
  const data = extraction("generated");
  data.agency_packages[0].price_min_krw = 1_240_000;
  data.agency_packages[0].price_max_krw = 1_240_000;
  data.agency_packages[0].source_quote = "기본 | 124";

  const gaps = findCoverageGaps(
    "금액 단위: 만원\n상품 | 기본가 | 옵션가\n기본 | 124 | 3.3",
    data,
  );

  assert.deepEqual(gaps, [{
    raw: "3.3",
    krw: 33_000,
    line_context: "기본 | 124 | 3.3",
    source_locator: "line:3",
  }]);
});

test("coverage self-check finds inline option prices under a declared unit without treating quantities as money", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps(
    "금액 단위: 만원\n스튜디오!E6: 촬영의상추가 1벌당11~33 / 앨범 1페이지당3.3",
    data,
  );

  assert.deepEqual(gaps.map((gap) => gap.krw), [110_000, 330_000, 33_000]);
});

test("coverage self-check counts repeated equal amounts by source occurrence", () => {
  const data = extraction("generated");
  data.agency_packages[0].price_min_krw = 1_000_000;
  data.agency_packages[0].price_max_krw = 1_000_000;
  data.agency_packages[0].source_quote = "A 패키지 100만원";

  const gaps = findCoverageGaps(
    "A 패키지 100만원\nB 패키지 100만원",
    data,
  );

  assert.deepEqual(gaps, [{
    raw: "100만원",
    krw: 1_000_000,
    line_context: "B 패키지 100만원",
    source_locator: "line:2",
  }]);
});

test("coverage self-check does not let repeated citations cover a different line", () => {
  const data = extraction("generated");
  const duplicate = structuredClone(data.agency_packages[0]);
  data.agency_packages[0].price_min_krw = 1_000_000;
  data.agency_packages[0].price_max_krw = 1_000_000;
  data.agency_packages[0].source_quote = "line:1: A 패키지 100만원";
  duplicate.price_min_krw = 1_000_000;
  duplicate.price_max_krw = 1_000_000;
  duplicate.source_quote = "line:1: A 패키지 100만원";
  data.agency_packages.push(duplicate);

  assert.deepEqual(findCoverageGaps(
    "A 패키지 100만원\nB 패키지 100만원",
    data,
  ).map((gap) => gap.source_locator), ["line:2"]);
});

test("coverage self-check uses a complete assignment for ambiguous legacy quotes", () => {
  const data = extraction("generated");
  const specific = structuredClone(data.agency_packages[0]);
  data.agency_packages[0].price_min_krw = 1_000_000;
  data.agency_packages[0].price_max_krw = 1_000_000;
  data.agency_packages[0].source_quote = "공통표현 100만원";
  specific.price_min_krw = 1_000_000;
  specific.price_max_krw = 1_000_000;
  specific.source_quote = "첫번째상품 공통표현 100만원";
  data.agency_packages.push(specific);

  assert.deepEqual(findCoverageGaps(
    "첫번째상품 공통표현 100만원\n공통표현 100만원",
    data,
  ), []);
});

test("coverage self-check can ignore the deterministic audit ledger and require structured capture", () => {
  const data = extraction("generated");
  data.agency_packages = [];
  data.money_occurrences = [{
    amount_krw: 1_000_000,
    raw_text: "100만원",
    source_quote: "가격표 100만원",
    source_file_ids: ["a".repeat(64)],
    kind: "price",
    needs_review: false,
  }];
  const source = "가격표 100만원";

  assert.equal(findCoverageGaps(source, data).length, 1);
  assert.deepEqual(findCoverageGaps(source, data, { includeAuditLedger: true }), []);
  data.agency_packages = [extraction("generated").agency_packages[0]];
  data.agency_packages[0].source_quote = source;
  data.agency_packages[0].price_min_krw = 1_000_000;
  data.agency_packages[0].price_max_krw = 1_000_000;
  assert.deepEqual(findCoverageGaps(source, data), []);
});

test("coverage self-check does not double count canonical XLSX cells and rendered table rows", () => {
  const data = extraction("generated");
  data.agency_packages[0].price_min_krw = 1_000_000;
  data.agency_packages[0].price_max_krw = 1_000_000;
  data.agency_packages[0].source_quote = "가격표!B2: 100";

  const gaps = findCoverageGaps(
    [
      "## 시트: 가격표",
      "가격표!A1: 금액 단위: 만원",
      "가격표!B2: 100",
      "| 셀 | 값 |",
      "| --- | --- |",
      "| A1 | 금액 단위: 만원 |",
      "| B2 | 100 |",
    ].join("\n"),
    data,
  );

  assert.deepEqual(gaps, []);
});

test("coverage self-check excludes percentages and quantities from declared-unit cells", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps(
    [
      "## 시트: 가격표",
      "가격표!A1: 금액 단위: 만원",
      "가격표!A2: 취소 위약금 10% / 앨범 2권 / 촬영 3시간 / 성수기 4~6월·9월~10월",
    ].join("\n"),
    data,
  );

  assert.deepEqual(gaps, []);
});

test("coverage self-check rejects explicit Korean count units inside a declared-money sheet", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps(
    [
      "## 시트: 가격표",
      "가격표!A1: 금액 단위: 만원",
      "가격표!A2: 하객 수: 1만명 / 초대: 2천명 / 답례품: 3만개 / 이용료: 4만원",
    ].join("\n"),
    data,
  );

  assert.deepEqual(gaps.map((gap) => gap.krw), [40_000]);
});

test("coverage self-check keeps real prices but rejects clock times, clause numbers, counts, and digits embedded in names", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps(
    [
      "## 시트: 스튜디오",
      "스튜디오!A1: 가격(단위: 만원, VAT 포함)",
      "스튜디오!C4: 주요선택품목가격",
      "스튜디오!D31: 옥상씬:11(10:00~15:00지정타임만가능)",
      "스튜디오!E40: 선수정본:1컷16,500",
      "스튜디오!A58: ② 계약해지에 따른 위약금 및 환급에 관한 산정기준",
      "스튜디오!A59: 제7조 환불규정<br>1. 상담비용 55,000원 차감<br>2. 서비스 개시 후 환불 불가",
      "스튜디오!A60: 조이187",
      "병합 범위 C4:E4 · 좌상단 C4",
    ].join("\n"),
    data,
  );

  assert.deepEqual(
    gaps.map(({ krw, source_locator }) => ({ krw, source_locator })),
    [
      { krw: 110_000, source_locator: "스튜디오!D31" },
      { krw: 16_500, source_locator: "스튜디오!E40" },
      { krw: 55_000, source_locator: "스튜디오!A59" },
    ],
  );
});

test("coverage self-check treats compound Korean money as one occurrence and keeps explicit prices beside contact words", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps(
    [
      "## 시트: 드레스",
      "드레스!A1: 금액 단위: 만원",
      "드레스!K11: 피팅비 5만5천원 / 재피팅비 11만원 / 전화예약 후 취소",
      "드레스!K12: 사용료 16.5만원+보증금(현금/계좌입금)11만원",
      "드레스!K13: 추가금 0원~최고 120만원",
      "드레스!K14: 원문 오탈자 후보 5.5천원",
    ].join("\n"),
    data,
  );

  assert.deepEqual(
    gaps.map(({ raw, krw, source_locator }) => ({ raw, krw, source_locator })),
    [
      { raw: "5만5천원", krw: 55_000, source_locator: "드레스!K11" },
      { raw: "11만원", krw: 110_000, source_locator: "드레스!K11" },
      { raw: "16.5만원", krw: 165_000, source_locator: "드레스!K12" },
      { raw: "11만원", krw: 110_000, source_locator: "드레스!K12" },
      { raw: "0원", krw: 0, source_locator: "드레스!K13" },
      { raw: "120만원", krw: 1_200_000, source_locator: "드레스!K13" },
      { raw: "5.5천원", krw: 5_500, source_locator: "드레스!K14" },
    ],
  );
});

test("coverage self-check rejects identifiers and counts in a declared-price workbook without dropping adjacent prices", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps(
    [
      "## 시트: 가격표",
      "가격표!A1: 금액 단위: 만원",
      "가격표!C1: 주요선택품목가격",
      "가격표!C2: 조이187 / 택1 / 1스팟 / 상담비 5",
      "병합 범위 C1:C1 · 좌상단 C1",
    ].join("\n"),
    data,
  );

  assert.deepEqual(gaps.map((gap) => gap.krw), [50_000]);
});

test("coverage self-check applies a declared XLSX unit to price columns and price-like inline options only", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps(
    [
      "## 시트: 가격표",
      "가격표!A1: 금액 단위: 만원",
      "가격표!C1: 주요선택품목가격",
      "가격표!D1: 기본가격",
      "가격표!D2: 124",
      "가격표!E2: 22",
      "가격표!F2: 촬영영상추가 1벌당11~33 / 앨범 1페이지당3.3",
      "가격표!G2: 2",
      "병합 범위 C1:E1 · 좌상단 C1",
      "| D2 | 124 |",
      "| E2 | 22 |",
      "| F2 | 촬영영상추가 1벌당11~33 / 앨범 1페이지당3.3 |",
      "| G2 | 2 |",
    ].join("\n"),
    data,
  );

  assert.deepEqual(
    gaps.map((gap) => gap.krw),
    [1_240_000, 220_000, 110_000, 330_000, 33_000],
  );
});

test("coverage self-check keeps comma-grouped bare values in a declared unit unless quantity context makes won explicit", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps(
    [
      "## 시트: 가격표",
      "가격표!A1: 금액 단위: 만원",
      "가격표!B1: 기본가격",
      "가격표!B2: 1,200",
      "가격표!B3: 선수정본:1컷16,500",
      "병합 범위 B1:B1 · 좌상단 B1",
    ].join("\n"),
    data,
  );

  assert.deepEqual(gaps.map((gap) => gap.krw), [12_000_000, 16_500]);
});

test("coverage self-check applies the nearest preceding unit declaration when a sheet has multiple tables", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps([
    "## 시트: 가격표",
    "가격표!A1: 금액 단위: 만원",
    "가격표!B1: 기본가격",
    "가격표!B2: 100",
    "가격표!A10: 금액 단위: 원",
    "가격표!B10: 기본가격",
    "가격표!B11: 500000",
  ].join("\n"), data);

  assert.deepEqual(gaps.map((gap) => gap.krw), [1_000_000, 500_000]);
});

test("coverage self-check applies parenthetical units to their own XLSX price columns", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps([
    "## 시트: 가격표",
    "가격표!B1: 가격(만원)",
    "가격표!C1: 식대(천원)",
    "가격표!D1: 보증 인원",
    "가격표!B2: 120",
    "가격표!C2: 75",
    "가격표!D2: 200",
  ].join("\n"), data);

  assert.deepEqual(
    gaps.map(({ krw, source_locator }) => ({ krw, source_locator })),
    [
      { krw: 1_200_000, source_locator: "가격표!B2" },
      { krw: 75_000, source_locator: "가격표!C2" },
    ],
  );
});

test("coverage self-check keeps adjacent XLSX column unit declarations independent", () => {
  const data = extraction("generated");
  data.agency_packages = [];

  const gaps = findCoverageGaps([
    "## 시트: 가격표",
    "가격표!B1: 단위: 만원",
    "가격표!C1: 단위: 천원",
    "가격표!B2: 기본가격",
    "가격표!C2: 식대",
    "가격표!B3: 120",
    "가격표!C3: 75",
  ].join("\n"), data);

  assert.deepEqual(
    gaps.map(({ krw, source_locator }) => ({ krw, source_locator })),
    [
      { krw: 1_200_000, source_locator: "가격표!B3" },
      { krw: 75_000, source_locator: "가격표!C3" },
    ],
  );
});

test("coverage source context is centered on money in very long cells", () => {
  const data = extraction("generated");
  data.agency_packages = [];
  const prefix = "계약 설명 ".repeat(180);

  const gaps = findCoverageGaps(`긴약관 100만원\n${prefix}위약금 55,000원`, data);

  assert.equal(gaps.length, 2);
  assert.match(gaps[1].line_context, /55,000원/u);
  assert.ok(gaps[1].line_context.length <= 1_000);
});

test("every non-null extracted bound must be supported by the source quote", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.docx",
      absolute_path: "C:/generated/generated.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.agency_packages[0].price_min_krw = 1_000_000;
  data.agency_packages[0].price_max_krw = 1_200_000;
  data.agency_packages[0].source_quote = "minimum 100만원";

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(issues.some((issue) => issue.code === "price_source_quote_mismatch"), true);
});

test("text-backed source quotes must occur in the converted evidence", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.docx",
      absolute_path: "C:/generated/generated.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.agency_packages[0].source_quote = "지어낸 패키지 3.3만원";

  const textIssues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText("원문 패키지 3.3만원"),
    hasImages: false,
  });
  assert.equal(
    textIssues.some((issue) =>
      issue.severity === "error" && issue.code === "source_quote_not_found_in_text"
    ),
    true,
  );

  const visionIssues = validateExtractionForUnit(unit, data, {
    normalizedText: "",
    hasImages: true,
  });
  assert.equal(
    visionIssues.some((issue) =>
      issue.severity === "warning" && issue.code === "source_quote_requires_visual_review"
    ),
    true,
  );
});

test("quote validation follows the record request modality instead of any image on the source", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "mixed-evidence.xlsx",
    parsed: {
      region_code: "gangnam",
      raw_name: "mixed evidence",
      normalized_name: "mixed evidence",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gangnam/mixed-evidence.xlsx",
      absolute_path: "C:/generated/mixed-evidence.xlsx",
      ext: "xlsx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("mixed evidence");
  data.agency_packages[0].source_quote = "invented text row 3.3만원";
  const sourceId = createHash("sha256")
    .update(`${unit.source_files[0].path}\0${unit.source_files[0].sha256}`, "utf8")
    .digest("hex");
  const commonEvidence = {
    normalizedText: normalizeEvidenceText("actual text row 3.3만원"),
    hasImages: true,
    bySourceFileId: {
      [sourceId]: {
        normalizedText: normalizeEvidenceText("actual text row 3.3만원"),
        hasImages: true,
      },
    },
  };

  const textBacked = validateExtractionForUnit(unit, structuredClone(data), {
    ...commonEvidence,
    recordModalities: { "agency_packages[0]": "text" },
  });
  assert.equal(textBacked.some((issue) =>
    issue.severity === "error" && issue.code === "source_quote_not_found_in_referenced_source"
  ), true);
  assert.equal(textBacked.some((issue) => issue.code === "source_quote_requires_visual_review"), false);

  const imageBacked = validateExtractionForUnit(unit, structuredClone(data), {
    ...commonEvidence,
    recordModalities: { "agency_packages[0]": "image" },
  });
  assert.equal(imageBacked.some((issue) =>
    issue.severity === "warning" && issue.code === "source_quote_requires_visual_review"
  ), true);
});

test("multi-source units require valid row-level provenance before staging", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated-folder",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [
      {
        path: "agency/gwangju/generated/prices.docx",
        absolute_path: "C:/generated/prices.docx",
        ext: "docx",
        sha256: "b".repeat(64),
        bytes: 100,
      },
      {
        path: "agency/gwangju/generated/options.pdf",
        absolute_path: "C:/generated/options.pdf",
        ext: "pdf",
        sha256: "d".repeat(64),
        bytes: 200,
      },
    ],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };

  const missing = extraction("generated");
  const issues = validateExtractionForUnit(unit, missing);

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "missing_source_file_provenance"
  ), true);

  const sourceId = (source: ManifestUnit["source_files"][number]) => createHash("sha256")
    .update(`${source.path}\0${source.sha256}`, "utf8")
    .digest("hex");
  const firstId = sourceId(unit.source_files[0]);
  const secondId = sourceId(unit.source_files[1]);
  const attributed = extraction("generated");
  Object.assign(attributed.agency_packages[0], { source_file_ids: [firstId] });
  const attributedIssues = validateExtractionForUnit(unit, attributed, {
    normalizedText: normalizeEvidenceText("other file contains 더미 패키지 3.3만원"),
    hasImages: false,
    bySourceFileId: {
      [firstId]: { normalizedText: normalizeEvidenceText("first file has no quoted price"), hasImages: false },
      [secondId]: { normalizedText: normalizeEvidenceText("더미 패키지 3.3만원"), hasImages: false },
    },
  } as Parameters<typeof validateExtractionForUnit>[2]);
  assert.equal(attributedIssues.some((issue) =>
    issue.severity === "error"
    && issue.code === "source_quote_not_found_in_referenced_source"
  ), true);

  Object.assign(attributed.agency_packages[0], { source_file_ids: ["f".repeat(64)] });
  const unknownIssues = validateExtractionForUnit(unit, attributed);
  assert.equal(unknownIssues.some((issue) =>
    issue.severity === "error"
    && issue.code === "unknown_source_file_provenance"
  ), true);
});

test("merged hall evidence validates every quote fragment against its declared source", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "merged-hall-folder",
    parsed: {
      region_code: "gangnam",
      raw_name: "merged hall",
      normalized_name: "merged hall",
      corporate_name: null,
      kind_hint: "hall",
    },
    source_files: [
      {
        path: "hall/gangnam/merged/meal.xlsx",
        absolute_path: "C:/generated/meal.xlsx",
        ext: "xlsx",
        sha256: "b".repeat(64),
        bytes: 100,
      },
      {
        path: "hall/gangnam/merged/venue.xlsx",
        absolute_path: "C:/generated/venue.xlsx",
        ext: "xlsx",
        sha256: "d".repeat(64),
        bytes: 100,
      },
    ],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceId = (source: ManifestUnit["source_files"][number]) => createHash("sha256")
    .update(`${source.path}\0${source.sha256}`, "utf8")
    .digest("hex");
  const mealSourceId = sourceId(unit.source_files[0]);
  const venueSourceId = sourceId(unit.source_files[1]);
  const mergedQuote = `__HANBANG_MERGED_EVIDENCE_V1__${JSON.stringify({
    fragments: [
      { source_file_id: mealSourceId, quote: "그랜드 홀 식대 7.5만~9만원" },
      { source_file_id: venueSourceId, quote: "그랜드홀 대관료 300만원" },
    ],
  })}`;
  const data = extraction("merged hall");
  data.doc_kind = "hall_disclosure";
  data.agency_packages = [];
  data.halls = [{
    hall_name: "그랜드 홀",
    guarantee_min: null,
    meal_price_min_krw: 75_000,
    meal_price_max_krw: 90_000,
    venue_fee_min_krw: 3_000_000,
    venue_fee_max_krw: 3_000_000,
    venue_fee_note: null,
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [],
    source_quote: mergedQuote,
    source_file_ids: [mealSourceId, venueSourceId],
    confidence: 0.9,
    needs_review: false,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText("OCR text unavailable\n그랜드홀 대관료 300만원"),
    hasImages: true,
    bySourceFileId: {
      [mealSourceId]: {
        normalizedText: normalizeEvidenceText("OCR text unavailable"),
        hasImages: true,
      },
      [venueSourceId]: {
        normalizedText: normalizeEvidenceText("그랜드홀 대관료 300만원"),
        hasImages: false,
      },
    },
    recordSourceModalities: {
      "halls[0]": {
        [mealSourceId]: "image",
        [venueSourceId]: "text",
      },
    },
  });

  assert.equal(issues.some((issue) => issue.severity === "error"), false);
  assert.equal(issues.some((issue) =>
    issue.code === "merged_source_quote_fragment_requires_visual_review"
  ), true);

  const incorrectlyTextBacked = validateExtractionForUnit(unit, structuredClone(data), {
    normalizedText: normalizeEvidenceText("OCR text unavailable\n그랜드홀 대관료 300만원"),
    hasImages: true,
    bySourceFileId: {
      [mealSourceId]: { normalizedText: normalizeEvidenceText("OCR text unavailable"), hasImages: true },
      [venueSourceId]: { normalizedText: normalizeEvidenceText("그랜드홀 대관료 300만원"), hasImages: false },
    },
    recordSourceModalities: {
      "halls[0]": {
        [mealSourceId]: "text",
        [venueSourceId]: "text",
      },
    },
  });
  assert.equal(incorrectlyTextBacked.some((issue) =>
    issue.severity === "error"
    && issue.code === "merged_source_quote_fragment_not_found_in_referenced_source"
  ), true);
});

test("merged evidence fails closed when quote fragments are assigned to the wrong sources", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "mixed-provenance-folder",
    parsed: {
      region_code: "gwangju",
      raw_name: "mixed provenance",
      normalized_name: "mixed provenance",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [
      {
        path: "agency/gwangju/mixed/base.xlsx",
        absolute_path: "C:/generated/base.xlsx",
        ext: "xlsx",
        sha256: "b".repeat(64),
        bytes: 100,
      },
      {
        path: "agency/gwangju/mixed/option.xlsx",
        absolute_path: "C:/generated/option.xlsx",
        ext: "xlsx",
        sha256: "d".repeat(64),
        bytes: 100,
      },
    ],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceId = (source: ManifestUnit["source_files"][number]) => createHash("sha256")
    .update(`${source.path}\0${source.sha256}`, "utf8")
    .digest("hex");
  const baseSourceId = sourceId(unit.source_files[0]);
  const optionSourceId = sourceId(unit.source_files[1]);
  const data = extraction("mixed provenance");
  data.agency_packages[0].source_quote = `__HANBANG_MERGED_EVIDENCE_V1__${JSON.stringify({
    fragments: [
      { source_file_id: optionSourceId, quote: "기본 파일 더미 패키지 3.3만원" },
      { source_file_id: baseSourceId, quote: "옵션 파일 추가 설명 3.3만원" },
    ],
  })}`;
  Object.assign(data.agency_packages[0], {
    source_file_ids: [baseSourceId, optionSourceId],
  });

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText("기본 파일 더미 패키지 3.3만원\n옵션 파일 추가 설명 3.3만원"),
    hasImages: false,
    bySourceFileId: {
      [baseSourceId]: {
        normalizedText: normalizeEvidenceText("기본 파일 더미 패키지 3.3만원"),
        hasImages: false,
      },
      [optionSourceId]: {
        normalizedText: normalizeEvidenceText("옵션 파일 추가 설명 3.3만원"),
        hasImages: false,
      },
    },
  });

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "merged_source_quote_fragment_not_found_in_referenced_source"
  ), true);

  data.agency_packages[0].source_quote = `__HANBANG_MERGED_EVIDENCE_V1__${JSON.stringify({
    fragments: [
      { source_file_id: baseSourceId, quote: "기본 파일 더미 패키지 3.3만원" },
      { source_file_id: baseSourceId, quote: "기본 파일의 다른 3.3만원" },
    ],
  })}`;
  const mismatchedSetIssues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText("기본 파일 더미 패키지 3.3만원\n기본 파일의 다른 3.3만원"),
    hasImages: false,
    bySourceFileId: {
      [baseSourceId]: {
        normalizedText: normalizeEvidenceText("기본 파일 더미 패키지 3.3만원\n기본 파일의 다른 3.3만원"),
        hasImages: false,
      },
      [optionSourceId]: {
        normalizedText: normalizeEvidenceText("옵션 파일 추가 설명 3.3만원"),
        hasImages: false,
      },
    },
  });
  assert.equal(mismatchedSetIssues.some((issue) =>
    issue.severity === "error"
    && issue.code === "merged_source_quote_provenance_mismatch"
  ), true);
});

test("unknown document kinds, kind-payload conflicts, and empty price extractions are blocking", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.pdf",
    parsed: {
      region_code: "seoul_etc",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "hall",
    },
    source_files: [{
      path: "hall/seoul/generated.pdf",
      absolute_path: "C:/generated/generated.pdf",
      ext: "pdf",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const unknown = extraction("generated");
  unknown.doc_kind = "unknown";
  unknown.agency_packages = [];
  const unknownIssues = validateExtractionForUnit(unit, unknown);
  assert.equal(unknownIssues.some((issue) => issue.severity === "error" && issue.code === "unknown_document_kind"), true);
  assert.equal(unknownIssues.some((issue) => issue.severity === "error" && issue.code === "no_price_records"), true);

  const conflict = extraction("generated");
  conflict.doc_kind = "hall_disclosure";
  const conflictIssues = validateExtractionForUnit(unit, conflict);
  assert.equal(conflictIssues.some((issue) => issue.severity === "error" && issue.code === "document_payload_conflict"), true);
  const kindConflict = extraction("generated");
  kindConflict.doc_kind = "agency_disclosure";
  const kindConflictIssues = validateExtractionForUnit(unit, kindConflict);
  assert.equal(kindConflictIssues.some((issue) => issue.severity === "error" && issue.code === "document_kind_conflict"), true);
});

test("public price fields containing phone numbers or email addresses are blocked", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.docx",
      absolute_path: "C:/generated/generated.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const phone = extraction("generated");
  phone.agency_packages[0].price_note = "문의 010-1234-5678";
  const email = extraction("generated");
  email.agency_packages[0].source_quote = "더미 패키지 3.3만원 help@example.com";

  for (const data of [phone, email]) {
    const issues = validateExtractionForUnit(unit, data);
    assert.equal(issues.some((issue) =>
      issue.severity === "error" && issue.code === "public_field_contains_contact_data"
    ), true);
  }
});

test("contact screening scans merged quote payloads but never its SHA provenance envelope", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.xlsx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.xlsx",
      absolute_path: "C:/generated/generated.xlsx",
      ext: "xlsx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  const merged = (payload: string): string => encodeMergedEvidenceQuote([{
    source_file_id: "0101234567890123456789012345678901234567890123456789012345678901",
    quote: "가격표!A2: 더미 패키지 스튜디오 드레스 메이크업",
  }, {
    source_file_id: "0101234567890123456789012345678901234567890123456789012345678901",
    quote: `가격표!B2: ${payload}`,
  }], 1_000)!;

  data.agency_packages[0]!.source_quote = merged("기본가격 3.3만원");
  assert.equal(validateExtractionForUnit(unit, structuredClone(data)).some(({ code }) =>
    code === "public_field_contains_contact_data"
  ), false);

  data.agency_packages[0]!.source_quote = merged("기본가격 3.3만원 문의 010-1234-5678");
  assert.equal(validateExtractionForUnit(unit, data).some(({ code }) =>
    code === "public_field_contains_contact_data"
  ), true);
});

test("mixed documents cannot bypass their scan-derived root kind", () => {
  const agencyUnit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "agency-folder",
    parsed: {
      region_code: "seoul_etc",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/seoul/generated/prices.pdf",
      absolute_path: "C:/generated/prices.pdf",
      ext: "pdf",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const agencyRootWithHallPayload = extraction("generated");
  agencyRootWithHallPayload.doc_kind = "mixed";
  agencyRootWithHallPayload.agency_packages = [];
  agencyRootWithHallPayload.hall.venue_fee_krw = 2_000_000;
  agencyRootWithHallPayload.hall.venue_fee_source_quote = "venue fee 2000000";

  const agencyIssues = validateExtractionForUnit(agencyUnit, agencyRootWithHallPayload);
  assert.equal(
    agencyIssues.some((issue) => issue.severity === "error" && issue.code === "document_kind_conflict"),
    true,
  );

  const hallUnit: ManifestUnit = {
    ...agencyUnit,
    display_name: "hall.pdf",
    parsed: { ...agencyUnit.parsed, kind_hint: "hall" },
    source_files: [{
      ...agencyUnit.source_files[0],
      path: "hall/seoul/generated.pdf",
    }],
  };
  const hallRootWithAgencyPayload = extraction("generated");
  hallRootWithAgencyPayload.doc_kind = "mixed";
  const agencyPayloadIssues = validateExtractionForUnit(hallUnit, hallRootWithAgencyPayload);
  assert.equal(
    agencyPayloadIssues.some((issue) => issue.severity === "error" && issue.code === "document_kind_conflict"),
    true,
  );

  const hallRootWithPartnerPayload = extraction("generated");
  hallRootWithPartnerPayload.doc_kind = "mixed";
  hallRootWithPartnerPayload.agency_packages = [];
  hallRootWithPartnerPayload.partner_vendors = [{
    category: "studio",
    vendor_name: "partner",
    old_names: [],
    price_min_krw: 100_000,
    price_max_krw: 100_000,
    base_spec: null,
    price_note: null,
    options: [],
    source_quote: "partner 100000",
    confidence: 0.9,
    needs_review: false,
  }];
  const partnerPayloadIssues = validateExtractionForUnit(hallUnit, hallRootWithPartnerPayload);
  assert.equal(
    partnerPayloadIssues.some((issue) => issue.severity === "error" && issue.code === "document_kind_conflict"),
    true,
  );
});

test("AI business names cannot replace the scan-derived canonical identity", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "(광주)_샘플웨딩.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "샘플웨딩",
      normalized_name: "샘플웨딩",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/광주/(광주)_샘플웨딩.docx",
      absolute_path: "C:/generated/sample.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("전혀 다른업체");

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(issues.some((issue) => issue.severity === "error" && issue.code === "business_name_conflict"), true);
});

test("conflicting prices for the same agency package are blocked instead of choosing one row", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.docx",
    parsed: {
      region_code: "jeju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/제주/generated.docx",
      absolute_path: "C:/generated/generated.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.agency_packages.push({
    ...structuredClone(data.agency_packages[0]),
    price_min_krw: 44_000,
    price_max_krw: 44_000,
    source_quote: "기본 패키지 4.4만원",
  });

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(issues.some((issue) => issue.severity === "error" && issue.code === "conflicting_agency_package_prices"), true);
});

test("hall aggregate prices are errors when their source quote is absent", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "더미홀.pdf",
    parsed: {
      region_code: "seoul_etc",
      raw_name: "더미홀",
      normalized_name: "더미홀",
      corporate_name: null,
      kind_hint: "hall",
    },
    source_files: [{
      path: "예식장/서울/더미홀.pdf",
      absolute_path: "C:/generated/더미홀.pdf",
      ext: "pdf",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("더미홀");
  data.doc_kind = "hall_disclosure";
  data.agency_packages = [];
  data.hall.venue_fee_krw = 1_000_000;
  data.hall.venue_fee_source_quote = null;

  const issues = validateExtractionForUnit(unit, data);

  assert.equal(
    issues.some((issue) => issue.severity === "error" && issue.code === "missing_source_quote"),
    true,
  );
});

test("an exact but unrelated quote cannot authenticate fabricated section semantics", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "section-grounding.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/section-grounding.docx",
      absolute_path: "C:/generated/section-grounding.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceText = "line:1: 일반 안내 더미 패키지 스튜디오 드레스 메이크업 3.3만원";
  const data = extraction("generated");
  data.agency_packages[0].source_quote = sourceText;
  data.sections = [{
    section_type: "pricing_basis",
    title: "가격 산정 기준",
    content_verbatim: "모든 상품 가격은 VAT 포함입니다.",
    summary: "모델이 생성한 요약",
    source_quote: sourceText,
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "authoritative_field_not_grounded_in_source_quote"
    && issue.path === "sections[0].title"
  ), true);
  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "authoritative_field_not_grounded_in_source_quote"
    && issue.path === "sections[0].content_verbatim"
  ), true);
  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "semantic_type_not_grounded_in_source_quote"
    && issue.path === "sections[0].section_type"
  ), true);
});

test("exact cancellation wording grounds a deterministic contract-terms section", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "contract-terms.xlsx",
    parsed: {
      region_code: "seoul",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/seoul/contract-terms.xlsx",
      absolute_path: "C:/generated/contract-terms.xlsx",
      ext: "xlsx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceText = "안내!A2: 계약 취소 시 적용되는 조건";
  const data = extraction("generated");
  data.sections = [{
    section_type: "contract_terms",
    title: "계약 취소 시 적용되는 조건",
    content_verbatim: "계약 취소 시 적용되는 조건",
    summary: "계약 취소 시 적용되는 조건",
    source_quote: sourceText,
    source_file_ids: [],
    confidence: 0.5,
    needs_review: true,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    xlsxCells: indexXlsxCellEvidence(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some(({ code, path }) =>
    code === "semantic_type_not_grounded_in_source_quote"
    && path === "sections[0].section_type"
  ), false, JSON.stringify(issues));
});

test("an exact vendor price quote cannot authenticate fabricated policy text or type", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "policy-grounding.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/policy-grounding.docx",
      absolute_path: "C:/generated/policy-grounding.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceText = "line:1: 로즈스튜디오 스튜디오 기본가 100만원";
  const data = extraction("generated");
  data.doc_kind = "mixed";
  data.partner_vendors = [{
    vendor_name: "로즈스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    policies: [{
      policy_type: "refund",
      raw_text: "계약 취소 시 전액 환불합니다.",
      source_quote: sourceText,
      source_file_ids: [],
    }],
    source_quote: sourceText,
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "authoritative_field_not_grounded_in_source_quote"
    && issue.path === "partner_vendors[0].policies[0].raw_text"
  ), true);
  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "semantic_type_not_grounded_in_source_quote"
    && issue.path === "partner_vendors[0].policies[0].policy_type"
  ), true);
});

test("an exact quote for another option cannot authenticate option name or raw semantics", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "option-grounding.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/option-grounding.docx",
      absolute_path: "C:/generated/option-grounding.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const packageQuote = "line:1: 더미 패키지 스튜디오 드레스 메이크업 3.3만원";
  const unrelatedOptionQuote = "line:2: 추가 앨범 5만원";
  const sourceText = `${packageQuote}\n${unrelatedOptionQuote}`;
  const data = extraction("generated");
  data.agency_packages[0].source_quote = packageQuote;
  data.agency_packages[0].options = [{
    name: "야외 촬영",
    price_min_krw: 50_000,
    price_max_krw: 50_000,
    unit: "1회",
    condition: "우천 시만 제공",
    raw_text: "야외 촬영 1회 5만원, 우천 시만 제공",
    source_quote: unrelatedOptionQuote,
    source_file_ids: [],
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    lineEvidence: {
      "line:1": [normalizeEvidenceText(packageQuote.replace(/^line:1:\s*/u, ""))],
      "line:2": [normalizeEvidenceText(unrelatedOptionQuote.replace(/^line:2:\s*/u, ""))],
    },
    hasImages: false,
  });

  for (const field of ["name", "raw_text", "unit", "condition"] as const) {
    assert.equal(issues.some((issue) =>
      issue.severity === "error"
      && issue.code === "authoritative_field_not_grounded_in_source_quote"
      && issue.path === `agency_packages[0].options[0].${field}`
    ), true, field);
  }
});

test("an exact vendor quote cannot authenticate a category absent from its bounded evidence", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "category-grounding.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/category-grounding.docx",
      absolute_path: "C:/generated/category-grounding.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceText = "line:1: 로즈스튜디오 스튜디오 기본가 100만원";
  const data = extraction("generated");
  data.doc_kind = "partner_price_list";
  data.agency_packages = [];
  data.partner_vendors = [{
    vendor_name: "로즈스튜디오",
    old_names: [],
    category: "dress",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    policies: [],
    source_quote: sourceText,
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "semantic_type_not_grounded_in_source_quote"
    && issue.path === "partner_vendors[0].category"
  ), true);
  assert.equal(data.partner_vendors[0].needs_review, true);
});

test("global validation does not treat an album page count as an explicit studio label", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "studio-category.xlsx",
    parsed: {
      region_code: "seoul",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/seoul/studio-category.xlsx",
      absolute_path: "C:/generated/studio-category.xlsx",
      ext: "xlsx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceText = "가격표!A5: 로즈<br>가격표!B5: 앨범 50페이지<br>가격표!C5: 100만원";
  const data = extraction("generated");
  data.doc_kind = "partner_price_list";
  data.agency_packages = [];
  data.partner_vendors = [{
    vendor_name: "로즈",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: "앨범 50페이지",
    price_note: null,
    options: [],
    policies: [],
    source_quote: sourceText,
    source_file_ids: [],
    confidence: 0.5,
    needs_review: true,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    xlsxCells: indexXlsxCellEvidence(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some(({ code, path }) =>
    code === "semantic_type_not_grounded_in_source_quote"
    && path === "partner_vendors[0].category"
  ), true, JSON.stringify(issues));
});

test("agency category and notes must be explicit inside the package quote", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "package-grounding.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/package-grounding.docx",
      absolute_path: "C:/generated/package-grounding.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceText = "line:1: 더미 패키지 스튜디오 3.3만원";
  const data = extraction("generated");
  Object.assign(data.agency_packages[0], {
    category_scope: ["studio", "dress"],
    vat_note: "VAT 포함",
    price_note: "주말 추가금 없음",
    source_quote: sourceText,
  });

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "semantic_type_not_grounded_in_source_quote"
    && issue.path === "agency_packages[0].category_scope[1]"
  ), true);
  for (const field of ["vat_note", "price_note"] as const) {
    assert.equal(issues.some((issue) =>
      issue.severity === "error"
      && issue.code === "authoritative_field_not_grounded_in_source_quote"
      && issue.path === `agency_packages[0].${field}`
    ), true, field);
  }
  assert.equal(data.agency_packages[0].needs_review, true);
});

test("section content longer than the quote capacity is quarantined for manual review", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "long-section.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/long-section.docx",
      absolute_path: "C:/generated/long-section.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const quotedContent = `가격 기준 ${"가".repeat(1_800)}`;
  const sourceQuote = `line:1: ${quotedContent}`;
  const data = extraction("generated");
  data.agency_packages[0].source_quote = "line:2: 더미 패키지 스튜디오 드레스 메이크업 3.3만원";
  data.sections = [{
    section_type: "pricing_basis",
    title: "가격 기준",
    content_verbatim: `${quotedContent}${"나".repeat(300)}`,
    summary: "가격 기준 안내",
    source_quote: sourceQuote,
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];
  const sourceText = `${sourceQuote}\n${data.agency_packages[0].source_quote}`;

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "authoritative_field_exceeds_source_quote_capacity"
    && issue.path === "sections[0].content_verbatim"
  ), true);
  assert.equal(data.sections[0].needs_review, true);
});

test("a money occurrence raw_text cannot borrow an unrelated exact quote with the same amount", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "money-grounding.png",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/money-grounding.png",
      absolute_path: "C:/generated/money-grounding.png",
      ext: "png",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const packageQuote = "line:1: 더미 패키지 스튜디오 드레스 메이크업 3.3만원";
  const unrelatedQuote = "line:2: 로즈스튜디오 기본가 100만원";
  const data = extraction("generated");
  data.agency_packages[0].source_quote = packageQuote;
  data.money_occurrences = [{
    amount_krw: 1_000_000,
    raw_text: "계약 취소 위약금 100만원",
    source_quote: unrelatedQuote,
    source_file_ids: [],
    kind: "policy",
    needs_review: false,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(`${packageQuote}\n${unrelatedQuote}`),
    lineEvidence: {
      "line:1": ["더미 패키지 스튜디오 드레스 메이크업 3.3만원"],
      "line:2": ["로즈스튜디오 기본가 100만원"],
    },
    hasImages: false,
  });

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "authoritative_field_not_grounded_in_source_quote"
    && issue.path === "money_occurrences[0].raw_text"
  ), true);
  assert.equal(data.money_occurrences[0].needs_review, true);
});

test("legacy hall item names and raw text must be inside their own bounded quote", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "hall-item-grounding.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated hall",
      normalized_name: "generated hall",
      corporate_name: null,
      kind_hint: "hall",
    },
    source_files: [{
      path: "hall/gwangju/hall-item-grounding.docx",
      absolute_path: "C:/generated/hall-item-grounding.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const sourceQuote = "line:1: 생화 장식 100만원";
  const data = extraction("generated hall");
  data.doc_kind = "hall_disclosure";
  data.agency_packages = [];
  data.hall.items = [{
    name: "대관료",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    raw_text: "대관료 100만원",
    source_quote: sourceQuote,
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceQuote),
    lineEvidence: { "line:1": ["생화 장식 100만원"] },
    hasImages: false,
  });

  for (const field of ["name", "raw_text"] as const) {
    assert.equal(issues.some((issue) =>
      issue.severity === "error"
      && issue.code === "authoritative_field_not_grounded_in_source_quote"
      && issue.path === `hall.items[0].${field}`
    ), true, field);
  }
  assert.equal(data.hall.items[0].needs_review, true);
});

test("generated section summary remains explicitly non-authoritative", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "summary-grounding.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/summary-grounding.docx",
      absolute_path: "C:/generated/summary-grounding.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const packageQuote = "line:1: 더미 패키지 스튜디오 드레스 메이크업 3.3만원";
  const sectionQuote = "line:2: 가격 기준 원문 내용";
  const data = extraction("generated");
  data.agency_packages[0].source_quote = packageQuote;
  data.sections = [{
    section_type: "pricing_basis",
    title: "가격 기준",
    content_verbatim: "가격 기준 원문 내용",
    summary: "읽기 쉽게 생성한 요약이며 원문 인용이 아닙니다.",
    source_quote: sectionQuote,
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(`${packageQuote}\n${sectionQuote}`),
    lineEvidence: {
      "line:1": ["더미 패키지 스튜디오 드레스 메이크업 3.3만원"],
      "line:2": ["가격 기준 원문 내용"],
    },
    hasImages: false,
  });

  assert.equal(issues.some((issue) => issue.path === "sections[0].summary"), false);
  assert.equal(issues.some((issue) =>
    issue.path.startsWith("sections[0]") && issue.severity === "error"
  ), false, JSON.stringify(issues));
  assert.equal(data.sections[0].needs_review, false);
});

test("other sections require exact text but no invented lexical type label", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "generated.xlsx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/generated.xlsx",
      absolute_path: "C:/generated/generated.xlsx",
      ext: "xlsx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const data = extraction("generated");
  data.sections = [{
    section_type: "other",
    title: "방문 전 안내",
    content_verbatim: "방문 전 안내",
    summary: "방문 전 안내",
    source_quote: "안내!A2: 방문 전 안내",
    source_file_ids: [],
    confidence: 0.5,
    needs_review: true,
  }];
  const sourceText = "안내!A2: 방문 전 안내";
  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    xlsxCells: indexXlsxCellEvidence(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some(({ code, path }) =>
    code === "semantic_type_not_grounded_in_source_quote"
    && path === "sections[0].section_type"
  ), false, JSON.stringify(issues));
});

test("policy raw text longer than its quote capacity is quarantined", () => {
  const unit: ManifestUnit = {
    unit_id: "a".repeat(64),
    display_name: "long-policy.docx",
    parsed: {
      region_code: "gwangju",
      raw_name: "generated",
      normalized_name: "generated",
      corporate_name: null,
      kind_hint: "agency",
    },
    source_files: [{
      path: "agency/gwangju/long-policy.docx",
      absolute_path: "C:/generated/long-policy.docx",
      ext: "docx",
      sha256: "b".repeat(64),
      bytes: 100,
    }],
    source_fingerprint: "c".repeat(64),
    stage: "extracted",
    notices: [],
  };
  const policyExcerpt = `로즈스튜디오 환불 ${"가".repeat(1_750)}`;
  const policyQuote = `line:1: ${policyExcerpt}`;
  const data = extraction("generated");
  data.doc_kind = "mixed";
  data.partner_vendors = [{
    vendor_name: "로즈스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: null,
    price_note: null,
    options: [],
    policies: [{
      policy_type: "refund",
      raw_text: `${policyExcerpt}${"나".repeat(400)}`,
      source_quote: policyQuote,
      source_file_ids: [],
    }],
    source_quote: "line:2: 로즈스튜디오 스튜디오 기본가 100만원",
    source_file_ids: [],
    confidence: 0.99,
    needs_review: false,
  }];
  data.agency_packages[0].source_quote = "line:3: 더미 패키지 스튜디오 드레스 메이크업 3.3만원";
  const sourceText = [
    policyQuote,
    data.partner_vendors[0].source_quote,
    data.agency_packages[0].source_quote,
  ].join("\n");

  const issues = validateExtractionForUnit(unit, data, {
    normalizedText: normalizeEvidenceText(sourceText),
    hasImages: false,
  });

  assert.equal(issues.some((issue) =>
    issue.severity === "error"
    && issue.code === "authoritative_field_exceeds_source_quote_capacity"
    && issue.path === "partner_vendors[0].policies[0].raw_text"
  ), true);
  assert.equal(data.partner_vendors[0].needs_review, true);
});
