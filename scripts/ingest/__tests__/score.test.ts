import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ArtifactIntegrityError,
  canonicalJsonSha256ExcludingField,
} from "../artifact-integrity.js";
import { CONVERTER_VERSION } from "../convert.js";
import { extractManifestForTests } from "../extract.js";
import { readJsonFile, sha256File, sha256Text, writeJsonFile } from "../io.js";
import { extractManifestLocally } from "../local-extraction-runner.js";
import { encodeMergedEvidenceQuote, MERGED_EVIDENCE_PREFIX } from "../merge-evidence.js";
import {
  businessNameMatchesCanonicalOrCertifiedVisualAlias,
  certifyHumanConfirmedVisualScoreEvidence,
  collapseCertifiedLocalDocxSharedMoney,
  collapseCertifiedHumanVisualParentRanges,
  evaluateBatchGate,
  findOccurrenceMatches,
  scoreExtractionAgainstGroundTruth,
  strictArtifactBlocker,
} from "../score.js";
import { normalizeVendorName, SCANNER_PARSER_VERSION } from "../scan.js";
import { DisclosureExtractionSchema, StrictExtractionArtifactSchema } from "../schemas.js";
import type { DisclosureExtraction } from "../schemas.js";
import type { IngestManifest, ManifestUnit } from "../types.js";
import type { LoadedVisualTranscriptionSidecar } from "../visual-transcription-sidecar.js";
import {
  deriveValidatedPayloadForUnit,
  scanSourceMoneyOccurrences,
  VALIDATOR_VERSION,
  validateManifest,
  validatedArtifactFingerprint,
} from "../validate.js";
import type { CoverageGap } from "../validate.js";

const UNIT_ID = "a".repeat(64);
const SOURCE_PATH = "agency/sample/샘플대행사A.xlsx";
const SOURCE_SHA256 = "b".repeat(64);
const SOURCE_ID = sha256Text(`${SOURCE_PATH}\0${SOURCE_SHA256}`);
const FINGERPRINT = "c".repeat(64);

test("occurrence matching finds a complete deterministic assignment instead of greedy false failures", () => {
  const matches = findOccurrenceMatches(
    [
      { path: "a", krw: 1_000_000, source_quote: "공통표현 100만원", source_file_ids: [] },
      { path: "b", krw: 1_000_000, source_quote: "첫번째상품 100만원", source_file_ids: [] },
    ],
    [
      {
        raw: "100만원",
        krw: 1_000_000,
        line_context: "공통표현 첫번째상품 100만원",
        source_locator: "page:1/first",
        origin: "manual_image",
      },
      {
        raw: "100만원",
        krw: 1_000_000,
        line_context: "공통표현 두번째항목 100만원",
        source_locator: "page:1/second",
        origin: "manual_image",
      },
    ],
  );
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => match.ground_truth_index).sort(), [0, 1]);
});

test("manual image occurrences never match by amount alone", () => {
  assert.deepEqual(findOccurrenceMatches(
    [{ path: "a", krw: 1_000_000, source_quote: "unrelated 100만원", source_file_ids: [] }],
    [{
      raw: "100만원",
      krw: 1_000_000,
      line_context: "상품 A 100만원",
      source_locator: "image:1/product-a",
      origin: "manual_image",
    }],
  ), []);
});

test("manual image occurrences match Windows OCR evidence only on the same page and one-to-one", () => {
  const matches = findOccurrenceMatches(
    [
      {
        path: "a",
        krw: 1_000_000,
        source_quote: "line:31: ocr:page:1:line:15: first price 1000000",
        source_file_ids: ["1".repeat(64)],
      },
      {
        path: "b",
        krw: 1_000_000,
        source_quote: "line:32: ocr:page:1:line:16: second price 1000000",
        source_file_ids: ["1".repeat(64)],
      },
    ],
    [
      {
        raw: "1000000",
        krw: 1_000_000,
        line_context: "manual image price A 1000000",
        source_locator: "page:1/price-a",
        origin: "manual_image",
      },
      {
        raw: "1000000",
        krw: 1_000_000,
        line_context: "manual image price B 1000000",
        source_locator: "page:1/price-b",
        origin: "manual_image",
      },
    ],
  );

  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => match.extracted_index).sort(), [0, 1]);
  assert.deepEqual(matches.map((match) => match.ground_truth_index).sort(), [0, 1]);
  assert.ok(matches.every((match) => match.match_quality === "image_value_only"));
});

test("manual image OCR fallback rejects a different page and non-OCR evidence", () => {
  const groundTruth = [{
    raw: "1000000",
    krw: 1_000_000,
    line_context: "manual image price 1000000",
    source_locator: "page:1/price-a",
    origin: "manual_image" as const,
  }];

  assert.deepEqual(findOccurrenceMatches(
    [{
      path: "wrong-page",
      krw: 1_000_000,
      source_quote: "line:31: ocr:page:2:line:15: price 1000000",
      source_file_ids: ["1".repeat(64)],
    }],
    groundTruth,
  ), []);
  assert.deepEqual(findOccurrenceMatches(
    [{
      path: "not-ocr",
      krw: 1_000_000,
      source_quote: "line:31: price 1000000",
      source_file_ids: ["1".repeat(64)],
    }],
    groundTruth,
  ), []);
  assert.deepEqual(findOccurrenceMatches(
    [{
      path: "wrong-value",
      krw: 2_000_000,
      source_quote: "line:31: ocr:page:1:line:15: price 2000000",
      source_file_ids: ["1".repeat(64)],
    }],
    groundTruth,
  ), []);
  assert.deepEqual(findOccurrenceMatches(
    [{
      path: "embedded-marker",
      krw: 1_000_000,
      source_quote: "line:31: note ocr:page:1:line:15: price 1000000",
      source_file_ids: ["1".repeat(64)],
    }],
    groundTruth,
  ), []);
  assert.deepEqual(findOccurrenceMatches(
    [{
      path: "inventory-origin",
      krw: 1_000_000,
      source_quote: "line:31: ocr:page:1:line:15: price 1000000",
      source_file_ids: ["1".repeat(64)],
    }],
    [{ ...groundTruth[0]!, origin: "inventory" }],
  ), []);
});

test("line locators are compared numerically without prefix collisions", () => {
  assert.deepEqual(findOccurrenceMatches(
    [{ path: "a", krw: 1_000_000, source_quote: "line:51: 상품 100만원", source_file_ids: [] }],
    [{
      raw: "100만원",
      krw: 1_000_000,
      line_context: "상품 100만원",
      source_locator: "line:5",
      origin: "inventory",
    }],
  ), []);
});

test("XLSX cell locators do not collide on address prefixes", () => {
  assert.deepEqual(findOccurrenceMatches(
    [{ path: "a", krw: 1_000_000, source_quote: "가격표!B10: 100만원", source_file_ids: [] }],
    [{
      raw: "100만원",
      krw: 1_000_000,
      line_context: "가격표!B1: 100만원",
      source_locator: "가격표!B1",
      origin: "inventory",
    }],
  ), []);
});

test("XLSX drawing money matches only the exact auxiliary locator", () => {
  const exactQuote = "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1: 라온제나 대관료 500만원";
  const groundTruth = [{
    raw: "500만원",
    krw: 5_000_000,
    line_context: "라온제나 대관료 500만원",
    source_locator: "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1",
    origin: "inventory" as const,
  }];

  assert.deepEqual(findOccurrenceMatches(
    [{ path: "a", krw: 5_000_000, source_quote: exactQuote, source_file_ids: [] }],
    groundTruth,
  ), [{ extracted_index: 0, ground_truth_index: 0, match_quality: "locator" }]);
  assert.deepEqual(findOccurrenceMatches(
    [{
      path: "a",
      krw: 5_000_000,
      source_quote: exactQuote.replace("text-box-1", "text-box-2"),
      source_file_ids: [],
    }],
    groundTruth,
  ), []);
  assert.deepEqual(findOccurrenceMatches(
    [{
      path: "a",
      krw: 5_000_000,
      source_quote: "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1: 대관료 500만원",
      source_file_ids: [],
    }],
    groundTruth,
  ), []);
});

test("merged evidence matches each fragment independently and chooses the exact locator", () => {
  const mergedQuote = encodeMergedEvidenceQuote([
    {
      source_file_id: "1".repeat(64),
      quote: "가격표!B2: 공통 설명 123만원",
    },
    {
      source_file_id: "2".repeat(64),
      quote: "가격표!B3: 샘플 추가 123만원",
    },
  ], 2_000);
  assert.ok(mergedQuote);

  assert.deepEqual(findOccurrenceMatches(
    [{ path: "a", krw: 1_230_000, source_quote: mergedQuote, source_file_ids: [
      "1".repeat(64),
      "2".repeat(64),
    ] }],
    [{
      raw: "123만원",
      krw: 1_230_000,
      line_context: "가격표!B3: 샘플 추가 123만원",
      source_locator: "가격표!B3",
      origin: "inventory",
    }],
  ), [{ extracted_index: 0, ground_truth_index: 0, match_quality: "locator" }]);
});

test("a malformed merged evidence envelope fails closed instead of matching embedded text", () => {
  const malformed = `${MERGED_EVIDENCE_PREFIX}{\"fragments\":[{\"quote\":\"가격표!B3: 샘플 추가 123만원\"}]}`;
  assert.deepEqual(findOccurrenceMatches(
    [{ path: "a", krw: 1_230_000, source_quote: malformed, source_file_ids: [] }],
    [{
      raw: "123만원",
      krw: 1_230_000,
      line_context: malformed,
      source_locator: "page:1/sample",
      origin: "inventory",
    }],
  ), []);
});

test("an explicitly non-blocking image unit cannot hold seven passing pilot units", () => {
  const blocking = Array.from({ length: 7 }, (_, index) => `blocking-${index}`);
  const may = "may-image-unit";
  const result = evaluateBatchGate(
    [...blocking, may],
    [
      ...blocking.map((unit_id) => ({ unit_id, status: "pass" })),
      { unit_id: may, status: "fail" },
    ],
    [may],
  );
  assert.equal(result.eligible, true);
  assert.equal(result.blocking_passed_units, 7);
  assert.deepEqual(result.non_blocking_unit_ids, [may]);
});

test("manual linkage review blocks a blocking unit from 25-unit eligibility but not the May unit", () => {
  const blocking = Array.from({ length: 7 }, (_, index) => `blocking-${index}`);
  const may = "may-image-unit";
  const blockingReview = evaluateBatchGate(
    [...blocking, may],
    [
      ...blocking.map((unit_id, index) => ({
        unit_id,
        status: "pass",
        price_gate: { manual_linkage_reviews: index === 0 ? [{ code: "visual_review" }] : [] },
      })),
      { unit_id: may, status: "fail", price_gate: { manual_linkage_reviews: [] } },
    ],
    [may],
  );
  assert.equal(blockingReview.eligible, false);
  assert.equal(blockingReview.blocking_passed_units, 6);
  assert.equal(blockingReview.blocking_failed_units, 1);

  const mayReview = evaluateBatchGate(
    [...blocking, may],
    [
      ...blocking.map((unit_id) => ({
        unit_id,
        status: "pass",
        price_gate: { manual_linkage_reviews: [] },
      })),
      { unit_id: may, status: "fail", price_gate: { manual_linkage_reviews: [{ code: "visual_review" }] } },
    ],
    [may],
  );
  assert.equal(mayReview.eligible, true);
});

test("strict artifact blocker preserves an integrity code wrapped by verifier errors", () => {
  const integrityError = new ArtifactIntegrityError(
    "artifact_content_hash_mismatch",
    "generated integrity failure",
  );
  const wrapped = new Error("outer verifier failure", {
    cause: new Error("inner verifier failure", { cause: integrityError }),
  });

  assert.equal(
    strictArtifactBlocker("extraction_artifact", wrapped).blocker,
    "extraction_artifact:artifact_content_hash_mismatch",
  );
});

const BASE_PACKAGE_QUOTE = "가격표!B2: 샘플 기본 패키지 스튜디오 123만원";
const DEFAULT_OPTION_QUOTE = "가격표!B3: 샘플 추가 123만원";

function quotePayload(value: string): string {
  return value.replace(/^.*?![A-Z]{1,4}\d+(?::[A-Z]{1,4}\d+)?:\s*/iu, "");
}

function dummyExtraction(secondQuote = DEFAULT_OPTION_QUOTE): DisclosureExtraction {
  return {
    doc_kind: "agency_disclosure",
    business_name: "샘플대행사A",
    region_hint: "gyeonggi",
    agency_packages: [{
      package_name: "샘플 기본 패키지",
      category_scope: ["studio"],
      price_min_krw: 1_230_000,
      price_max_krw: 1_230_000,
      vat_note: null,
      price_note: null,
      options: [{
        name: "샘플 추가",
        price_min_krw: 1_230_000,
        price_max_krw: 1_230_000,
        unit: null,
        condition: null,
        raw_text: quotePayload(secondQuote),
        source_quote: secondQuote,
        source_file_ids: [SOURCE_ID],
      }],
      source_quote: BASE_PACKAGE_QUOTE,
      source_file_ids: [SOURCE_ID],
      confidence: 1,
      needs_review: false,
    }],
    partner_vendors: [],
    halls: [],
    sections: [],
    money_occurrences: [
      {
        amount_krw: 1_230_000,
        raw_text: "123만원",
        source_quote: BASE_PACKAGE_QUOTE,
        source_file_ids: [SOURCE_ID],
        kind: "price",
        needs_review: false,
      },
      {
        amount_krw: 1_230_000,
        raw_text: "123만원",
        source_quote: secondQuote,
        source_file_ids: [SOURCE_ID],
        kind: "price",
        needs_review: false,
      },
    ],
    hall: {
      venue_fee_krw: null,
      meal_price_min_krw: null,
      meal_price_max_krw: null,
      venue_fee_source_quote: null,
      meal_price_source_quote: null,
      venue_fee_source_file_ids: [],
      meal_price_source_file_ids: [],
      items: [],
      confidence: 1,
      needs_review: false,
    },
    extraction_notes: "",
  };
}

async function buildFixture(secondQuote?: string): Promise<{
  stateDir: string;
  groundTruthPath: string;
  groundTruthSha256: string;
}> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-score-"));
  const extractionPath = path.join(stateDir, "extracted", `${UNIT_ID}.json`);
  const groundTruthPath = path.join(stateDir, "manual-inventory.json");
  const sourcePath = SOURCE_PATH;
  const now = new Date().toISOString();
  const manifest: IngestManifest = {
    schema_version: 1,
    scanner_parser_version: "test-v1",
    root_dir: path.join(stateDir, "raw"),
    state_dir: stateDir,
    scanned_at: now,
    units: [{
      unit_id: UNIT_ID,
      display_name: "샘플대행사A.xlsx",
      parsed: {
        region_code: "gyeonggi",
        raw_name: "샘플대행사A",
        normalized_name: "샘플대행사a",
        corporate_name: null,
        kind_hint: "agency",
      },
      source_files: [{
        path: sourcePath,
        absolute_path: path.join(stateDir, "raw", ...sourcePath.split("/")),
        ext: "xlsx",
        sha256: SOURCE_SHA256,
        bytes: 100,
      }],
      source_fingerprint: FINGERPRINT,
      stage: "extracted",
      notices: [],
      extraction: {
        fingerprint: FINGERPRINT,
        source_fingerprint: FINGERPRINT,
        artifact_fingerprint: FINGERPRINT,
        prompt_version: "test-v1",
        model: "gpt-5.6-luna",
        artifact_path: extractionPath,
        cache_hit: false,
        attempts: 1,
        input_tokens: 10,
        output_tokens: 10,
        extracted_at: now,
      },
    }],
  };
  await writeJsonFile(path.join(stateDir, "manifest.json"), manifest);
  await writeJsonFile(extractionPath, {
    schema_version: 1,
    fingerprint: FINGERPRINT,
    source_fingerprint: FINGERPRINT,
    artifact_fingerprint: FINGERPRINT,
    prompt_version: "test-v1",
    model: "gpt-5.6-luna",
    data: dummyExtraction(secondQuote),
    attempts: 1,
    input_tokens: 10,
    output_tokens: 10,
    created_at: now,
  });
  await writeJsonFile(groundTruthPath, {
    generated_at: now,
    units: [{
      unit_id: UNIT_ID,
      display_name: "샘플대행사A.xlsx",
      source_paths: [sourcePath],
      candidate_count: 2,
      candidates: [
        {
          raw: "123만원",
          krw: 1_230_000,
          line_context: BASE_PACKAGE_QUOTE,
          source_locator: "가격표!B2",
        },
        {
          raw: "123만원",
          krw: 1_230_000,
          line_context: DEFAULT_OPTION_QUOTE,
          source_locator: "가격표!B3",
        },
      ],
    }],
  });
  return {
    stateDir,
    groundTruthPath,
    groundTruthSha256: (await sha256File(groundTruthPath)).sha256,
  };
}

async function attachValidatedCoverage(
  stateDir: string,
  coverageGaps: CoverageGap[],
): Promise<void> {
  const manifestPath = path.join(stateDir, "manifest.json");
  let manifest = await readJsonFile(manifestPath) as IngestManifest;
  let unit = manifest.units[0];
  if (!unit?.extraction) throw new Error("fixture extraction metadata missing");
  const extraction = await readJsonFile(unit.extraction.artifact_path) as {
    data: DisclosureExtraction;
  };
  const issues = coverageGaps.length > 0
    ? [{
        severity: "warning" as const,
        code: "coverage_gap",
        path: "coverage_gaps",
        message: `원문 금액 후보 ${coverageGaps.length}건 누락`,
      }]
    : [];
  const fingerprint = validatedArtifactFingerprint(
    unit.extraction.fingerprint,
    extraction.data,
    issues,
    coverageGaps,
  );
  const artifactPath = path.join(stateDir, "validated", `${unit.unit_id}.json`);
  const now = new Date().toISOString();
  await writeJsonFile(artifactPath, {
    schema_version: 1,
    validator_version: VALIDATOR_VERSION,
    fingerprint,
    unit_id: unit.unit_id,
    source_files: unit.source_files.map((source) => ({
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
    })),
    source_fingerprint: unit.source_fingerprint,
    extraction_fingerprint: unit.extraction.fingerprint,
    data: extraction.data,
    issues,
    coverage_gaps: coverageGaps,
    review_status: "pending",
    validated_at: now,
  });
  unit.stage = "validated";
  unit.validation = {
    fingerprint,
    artifact_path: artifactPath,
    review_status: "pending",
    issue_count: issues.length,
    validated_at: now,
  };
  await writeJsonFile(manifestPath, manifest);
}

function withCanonicalContentHash<T extends Record<string, unknown>>(
  payload: T,
): T & { content_sha256: string } {
  const artifact = {
    ...payload,
    content_sha256: "0".repeat(64),
  };
  artifact.content_sha256 = canonicalJsonSha256ExcludingField(artifact, "content_sha256");
  return artifact;
}

async function attachStrictArtifacts(
  stateDir: string,
  coverageGaps: CoverageGap[] = [],
  transformExtractionData?: (data: DisclosureExtraction) => void,
): Promise<{ extractionPath: string; validatedPath: string }> {
  const manifestPath = path.join(stateDir, "manifest.json");
  let manifest = await readJsonFile(manifestPath) as IngestManifest;
  let unit = manifest.units[0];
  if (!unit?.extraction) throw new Error("fixture extraction metadata missing");
  const legacyExtraction = await readJsonFile(unit.extraction.artifact_path) as {
    data: DisclosureExtraction;
    attempts: number;
    input_tokens: number;
    output_tokens: number;
    created_at: string;
  };
  const source = unit.source_files[0]!;
  const sourceText = [...new Set([
    "## 시트: 가격표",
    ...legacyExtraction.data.agency_packages.flatMap((item) => [
      `가격표!A2: ${item.package_name}`,
      "가격표!C2: studio",
      `가격표!A3: ${item.package_name}`,
      "가격표!C3: studio",
      item.source_quote,
      ...item.options.map((option) => option.source_quote),
    ]),
    ...(legacyExtraction.data.sections ?? []).map((section) => section.source_quote),
    ...legacyExtraction.data.partner_vendors.flatMap((vendor) =>
      (vendor.policies ?? []).map((policy) => policy.source_quote)
    ),
    ...(legacyExtraction.data.money_occurrences ?? []).map((item) => item.source_quote),
  ].filter((value): value is string => Boolean(value)))].join("\n");
  await mkdir(path.dirname(source.absolute_path), { recursive: true });
  await writeFile(source.absolute_path, sourceText, "utf8");
  const sourceDigest = await sha256File(source.absolute_path);
  source.sha256 = sourceDigest.sha256;
  source.bytes = sourceDigest.bytes;
  unit.source_fingerprint = sha256Text(`${source.path}\0${source.sha256}`);
  const currentSourceId = sha256Text(`${source.path}\0${source.sha256}`);
  const strictData = DisclosureExtractionSchema.parse(structuredClone(legacyExtraction.data));
  const replaceSourceIds = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) replaceSourceIds(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.source_file_ids) && record.source_file_ids.length > 0) {
      record.source_file_ids = [currentSourceId];
    }
    for (const child of Object.values(record)) replaceSourceIds(child);
  };
  replaceSourceIds(strictData);
  transformExtractionData?.(strictData);
  const previewPath = path.join(stateDir, ".converted", unit.unit_id, "1-source", "content.md");
  await mkdir(path.dirname(previewPath), { recursive: true });
  await writeFile(previewPath, sourceText, "utf8");
  const previewDigest = await sha256File(previewPath);
  const converterVersion = CONVERTER_VERSION;
  const artifactFingerprint = sha256Text(`${path.resolve(previewPath)}\0${previewDigest.sha256}`);
  manifest.scanner_parser_version = SCANNER_PARSER_VERSION;
  unit.conversion = {
    converter_version: converterVersion,
    source_fingerprint: unit.source_fingerprint,
    text_artifacts: [previewPath],
    image_artifacts: [],
    text_characters: sourceText.length,
    cell_count: 0,
    artifact_fingerprint: artifactFingerprint,
    converted_at: legacyExtraction.created_at,
  };
  unit.stage = "converted";
  delete unit.extraction;
  delete unit.validation;
  await writeJsonFile(manifestPath, manifest);
  await extractManifestForTests(
    { stateDir },
    {
      env: {},
      provider: {
        extract: async () => ({
          data: strictData,
          inputTokens: legacyExtraction.input_tokens,
          outputTokens: legacyExtraction.output_tokens,
        }),
      },
    },
  );
  manifest = await readJsonFile(manifestPath) as IngestManifest;
  unit = manifest.units[0];
  if (!unit?.extraction) throw new Error("strict fixture extraction failed");
  const extractionPath = unit.extraction.artifact_path;
  const strictExtraction = StrictExtractionArtifactSchema.parse(
    await readJsonFile(extractionPath),
  );

  const replayed = await deriveValidatedPayloadForUnit(unit, strictExtraction);
  const normalizedCoverageGaps = coverageGaps.map((gap) => ({
    raw: gap.raw,
    krw: gap.krw,
    line_context: gap.line_context,
    source_locator: gap.source_locator,
  }));
  const issues = normalizedCoverageGaps.length > 0
    ? [{
        severity: "warning" as const,
        code: "coverage_gap",
        path: "coverage_gaps",
        message: `원문 금액 후보 ${normalizedCoverageGaps.length}건 누락`,
    }]
    : replayed.issues;
  const effectiveCoverageGaps = normalizedCoverageGaps.length > 0
    ? normalizedCoverageGaps
    : replayed.coverageGaps;
  const validatedData = replayed.data;
  const fingerprint = validatedArtifactFingerprint(
    unit.extraction.fingerprint,
    validatedData,
    issues,
    effectiveCoverageGaps,
  );
  const now = new Date().toISOString();
  const strictValidation = withCanonicalContentHash({
    schema_version: 2,
    validator_version: VALIDATOR_VERSION,
    fingerprint,
    unit_id: unit.unit_id,
    source_files: unit.source_files.map((source) => ({
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
    })),
    source_fingerprint: unit.source_fingerprint,
    extraction_fingerprint: unit.extraction.fingerprint,
    extraction_content_sha256: strictExtraction.content_sha256,
    prompt_version: strictExtraction.prompt_version,
    prompt_hash: strictExtraction.prompt_hash,
    model: strictExtraction.model,
    data: validatedData,
    issues,
    coverage_gaps: effectiveCoverageGaps,
    review_status: "pending",
    validated_at: now,
  });
  const validatedPath = path.join(stateDir, "validated", `${unit.unit_id}.json`);
  await writeJsonFile(validatedPath, strictValidation);
  unit.stage = "validated";
  unit.validation = {
    fingerprint,
    content_sha256: strictValidation.content_sha256,
    extraction_content_sha256: strictExtraction.content_sha256,
    validator_version: VALIDATOR_VERSION,
    artifact_path: validatedPath,
    review_status: "pending",
    issue_count: issues.length,
    validated_at: now,
  };
  await writeJsonFile(manifestPath, manifest);
  return { extractionPath, validatedPath };
}

test("strict pilot scoring accepts only content-bound deterministic extraction and validation artifacts", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  await attachStrictArtifacts(fixture.stateDir);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  assert.equal(
    (report.gate as Record<string, unknown>).status,
    "pass",
    JSON.stringify(report.units),
  );
  assert.equal((report.gate as Record<string, unknown>).validated_artifacts_required, true);
  assert.equal(
    (report.gate as Record<string, unknown>).verification_mode,
    "strict_validated_artifacts",
  );
  assert.deepEqual(report.verification, {
    mode: "strict_validated_artifacts",
    validated_artifacts_required: true,
    deterministic_artifact_paths_required: true,
    artifact_content_hashes_required: true,
    paid_plan_sha256: null,
  });
});

test("strict pilot scoring uses validator-enriched provenance from the verified staging payload", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const { extractionPath, validatedPath } = await attachStrictArtifacts(
    fixture.stateDir,
    [],
    (data) => {
      data.agency_packages[0]!.source_file_ids = [];
    },
  );
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  const unit = manifest.units[0]!;
  const extraction = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  };
  assert.deepEqual(extraction.data.agency_packages[0]!.source_file_ids, []);

  const validation = await readJsonFile(validatedPath) as {
    data: DisclosureExtraction;
  };
  const expectedSourceId = sha256Text(
    `${unit.source_files[0]!.path}\0${unit.source_files[0]!.sha256}`,
  );
  assert.deepEqual(validation.data.agency_packages[0]!.source_file_ids, [expectedSourceId]);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "pass");
  const unitReport = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unitReport.status, "pass");
  assert.deepEqual((unitReport.price_gate as Record<string, unknown>).linking_errors, []);
});

test("strict pilot scoring rejects self-consistent artifacts from a stale extraction contract", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const { extractionPath, validatedPath } = await attachStrictArtifacts(fixture.stateDir);
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  const unit = manifest.units[0]!;
  const extraction = await readJsonFile(extractionPath) as Record<string, unknown> & {
    content_sha256: string;
    prompt_version: string;
    prompt_hash: string;
    processing_version: string;
  };
  extraction.prompt_version = "stale-prompt-v1";
  extraction.prompt_hash = "1".repeat(64);
  extraction.processing_version = "2".repeat(64);
  extraction.content_sha256 = canonicalJsonSha256ExcludingField(extraction, "content_sha256");
  await writeJsonFile(extractionPath, extraction);
  unit.extraction!.prompt_version = extraction.prompt_version;
  unit.extraction!.prompt_hash = extraction.prompt_hash;
  unit.extraction!.processing_version = extraction.processing_version;
  unit.extraction!.content_sha256 = extraction.content_sha256;

  const validation = await readJsonFile(validatedPath) as Record<string, unknown> & {
    content_sha256: string;
    extraction_content_sha256: string;
    prompt_version: string;
    prompt_hash: string;
  };
  validation.extraction_content_sha256 = extraction.content_sha256;
  validation.prompt_version = extraction.prompt_version;
  validation.prompt_hash = extraction.prompt_hash;
  validation.content_sha256 = canonicalJsonSha256ExcludingField(validation, "content_sha256");
  await writeJsonFile(validatedPath, validation);
  unit.validation!.extraction_content_sha256 = extraction.content_sha256;
  unit.validation!.content_sha256 = validation.content_sha256;
  await writeJsonFile(manifestPath, manifest);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unitReport = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unitReport.status, "blocked");
  assert.deepEqual(unitReport.blockers, ["extraction_artifact:current_contract_mismatch"]);
});

test("strict pilot scoring recomputes the current extraction fingerprint instead of trusting manifest agreement", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const { extractionPath, validatedPath } = await attachStrictArtifacts(fixture.stateDir);
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  const unit = manifest.units[0]!;
  const forgedFingerprint = "f".repeat(64);
  const extraction = await readJsonFile(extractionPath) as Record<string, unknown> & {
    content_sha256: string;
    fingerprint: string;
  };
  extraction.fingerprint = forgedFingerprint;
  extraction.content_sha256 = canonicalJsonSha256ExcludingField(extraction, "content_sha256");
  const forgedExtractionPath = path.join(
    fixture.stateDir,
    ".cache",
    "extract",
    `${forgedFingerprint}.json`,
  );
  await writeJsonFile(forgedExtractionPath, extraction);
  unit.extraction!.fingerprint = forgedFingerprint;
  unit.extraction!.artifact_path = forgedExtractionPath;
  unit.extraction!.content_sha256 = extraction.content_sha256;

  const validation = await readJsonFile(validatedPath) as Record<string, unknown> & {
    content_sha256: string;
    extraction_content_sha256: string;
    extraction_fingerprint: string;
    fingerprint: string;
    data: DisclosureExtraction;
    issues: Parameters<typeof validatedArtifactFingerprint>[2];
    coverage_gaps: CoverageGap[];
  };
  validation.extraction_fingerprint = forgedFingerprint;
  validation.extraction_content_sha256 = extraction.content_sha256;
  validation.fingerprint = validatedArtifactFingerprint(
    forgedFingerprint,
    validation.data,
    validation.issues,
    validation.coverage_gaps,
  );
  validation.content_sha256 = canonicalJsonSha256ExcludingField(validation, "content_sha256");
  await writeJsonFile(validatedPath, validation);
  unit.validation!.fingerprint = validation.fingerprint;
  unit.validation!.content_sha256 = validation.content_sha256;
  unit.validation!.extraction_content_sha256 = extraction.content_sha256;
  await writeJsonFile(manifestPath, manifest);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unitReport = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unitReport.status, "blocked");
  assert.deepEqual(unitReport.blockers, ["extraction_artifact:current_fingerprint_mismatch"]);
});

test("strict pilot scoring rejects a forged validation issue that deterministic replay cannot reproduce", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const { validatedPath } = await attachStrictArtifacts(fixture.stateDir);
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  const unit = manifest.units[0]!;
  const validation = await readJsonFile(validatedPath) as Record<string, unknown> & {
    content_sha256: string;
    extraction_fingerprint: string;
    fingerprint: string;
    data: DisclosureExtraction;
    issues: Parameters<typeof validatedArtifactFingerprint>[2];
    coverage_gaps: CoverageGap[];
  };
  validation.issues.push({
    severity: "error",
    code: "forged-stage-regression",
    path: "data",
    message: "A blocking validator issue must never be scored as a passing unit.",
  });
  validation.fingerprint = validatedArtifactFingerprint(
    validation.extraction_fingerprint,
    validation.data,
    validation.issues,
    validation.coverage_gaps,
  );
  validation.content_sha256 = canonicalJsonSha256ExcludingField(validation, "content_sha256");
  await writeJsonFile(validatedPath, validation);
  unit.stage = "validated";
  unit.validation!.fingerprint = validation.fingerprint;
  unit.validation!.content_sha256 = validation.content_sha256;
  unit.validation!.issue_count = validation.issues.length;
  await writeJsonFile(manifestPath, manifest);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unitReport = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unitReport.status, "blocked");
  assert.deepEqual(unitReport.blockers, ["validated_artifact:issues_replay_mismatch"]);
  assert.equal(Object.hasOwn(unitReport, "price_gate"), false);
});

test("strict pilot scoring reports deterministic validator errors as a failed unit eligible for prompt repair", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  await attachStrictArtifacts(fixture.stateDir, [], (data) => {
    data.doc_kind = "unknown";
  });
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  manifest.units[0]!.stage = "error";
  await writeJsonFile(manifestPath, manifest);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unitReport = (report.units as Array<Record<string, unknown>>)[0]!;
  const priceGate = unitReport.price_gate as Record<string, unknown>;
  const validationIssues = priceGate.blocking_validation_issues as Array<{ code: string }>;
  assert.equal(unitReport.status, "fail");
  assert.equal((report.gate as Record<string, unknown>).status, "fail");
  assert.equal(validationIssues.some((issue) => issue.code === "unknown_document_kind"), true);
});

test("strict pilot scoring blocks extracted-only units before considering price coverage", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "blocked");
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.deepEqual(unit.blockers, ["unit_stage_not_validated:extracted"]);
  assert.equal(Object.hasOwn(unit, "price_gate"), false);
});

test("strict pilot scoring blocks a validated artifact whose bytes changed after hashing", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const { validatedPath } = await attachStrictArtifacts(fixture.stateDir);
  const artifact = await readJsonFile(validatedPath) as Record<string, unknown> & {
    data: DisclosureExtraction;
  };
  artifact.data.extraction_notes = "tampered after validation";
  await writeJsonFile(validatedPath, artifact);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "blocked");
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.deepEqual(unit.blockers, ["validated_artifact:artifact_content_hash_mismatch"]);
  assert.equal(Object.hasOwn(unit, "validator_coverage_gaps"), false);
  assert.equal(Object.hasOwn(unit, "price_gate"), false);
});

test("strict pilot scoring blocks an extraction artifact whose bytes changed after hashing", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const { extractionPath } = await attachStrictArtifacts(fixture.stateDir);
  const artifact = await readJsonFile(extractionPath) as Record<string, unknown> & {
    data: DisclosureExtraction;
  };
  artifact.data.extraction_notes = "tampered after extraction";
  await writeJsonFile(extractionPath, artifact);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "blocked");
  assert.deepEqual(unit.blockers, ["extraction_artifact:artifact_content_hash_mismatch"]);
});

test("strict pilot scoring blocks a self-rehashed coverage gap not reproduced from source", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  await attachStrictArtifacts(fixture.stateDir, [{
    source_locator: "가격표!B2",
    raw: "123만원",
    krw: 1_230_000,
    line_context: "가격표!B2: 123만원",
  }]);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "blocked", JSON.stringify(unit));
  assert.deepEqual(unit.blockers, ["validated_artifact:issues_replay_mismatch"]);
});

test("strict pilot scoring blocks a non-deterministic validated artifact path", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const { validatedPath } = await attachStrictArtifacts(fixture.stateDir);
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  const wrongPath = path.join(fixture.stateDir, "validated", "renamed.json");
  await writeJsonFile(wrongPath, await readJsonFile(validatedPath));
  manifest.units[0]!.validation!.artifact_path = wrongPath;
  await writeJsonFile(manifestPath, manifest);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "blocked");
  assert.deepEqual(unit.blockers, ["validated_artifact:artifact_path_not_deterministic"]);
});

test("strict pilot scoring blocks a self-rehashed validation with source files not in the manifest", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const { validatedPath } = await attachStrictArtifacts(fixture.stateDir);
  const artifact = await readJsonFile(validatedPath) as Record<string, unknown> & {
    source_files: Array<{ path: string; sha256: string; bytes: number }>;
    content_sha256: string;
  };
  artifact.source_files[0] = { ...artifact.source_files[0]!, path: "agency/other.xlsx" };
  artifact.content_sha256 = canonicalJsonSha256ExcludingField(artifact, "content_sha256");
  await writeJsonFile(validatedPath, artifact);
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  manifest.units[0]!.validation!.content_sha256 = artifact.content_sha256;
  await writeJsonFile(manifestPath, manifest);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "blocked");
  assert.deepEqual(unit.blockers, ["validated_artifact:source_files_mismatch"]);
});

test("strict pilot scoring rejects a legacy extraction even at the deterministic cache path", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  await attachValidatedCoverage(fixture.stateDir, []);
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath) as IngestManifest;
  const unit = manifest.units[0]!;
  const legacy = await readJsonFile(unit.extraction!.artifact_path);
  const deterministicPath = path.join(
    fixture.stateDir,
    ".cache",
    "extract",
    `${unit.extraction!.fingerprint}.json`,
  );
  await writeJsonFile(deterministicPath, legacy);
  unit.conversion = {
    converter_version: "test-converter-v1",
    source_fingerprint: unit.source_fingerprint,
    text_artifacts: [],
    image_artifacts: [],
    text_characters: 0,
    cell_count: 0,
    artifact_fingerprint: unit.extraction!.artifact_fingerprint,
    converted_at: unit.extraction!.extracted_at,
  };
  unit.extraction!.artifact_path = deterministicPath;
  await writeJsonFile(manifestPath, manifest);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    requireValidatedArtifacts: true,
  });

  const unitReport = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unitReport.status, "blocked");
  assert.deepEqual(unitReport.blockers, ["extraction_artifact:artifact_content_hash_missing"]);
});

test("overlay path and expected hash are an immutable option pair", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const overlayPath = path.join(fixture.stateDir, "overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    units: [],
  });

  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      overlayPath,
    }),
    /overlayPath path and expected SHA-256 must be provided together/u,
  );
  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      expectedOverlaySha256: "0".repeat(64),
    }),
    /overlayPath path and expected SHA-256 must be provided together/u,
  );
});

function visualOverlayFixture(sourceLocator: string) {
  return {
    schema_version: 1 as const,
    created_at: "2026-07-20T00:00:00.000Z",
    units: [{
      unit_id: UNIT_ID,
      readable_occurrences: [],
      unreadable_cells: [{
        source_locator: sourceLocator,
        visible_amounts_krw: [],
        estimated_content: "unreadable price cell",
        reason: "human transcription required",
      }],
      expectations: {
        doc_kinds: ["agency_disclosure" as const],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  };
}

test("score verifies and unwraps the canonical derived visual overlay", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const sourcePath = path.join(fixture.stateDir, "source-overlay.json");
  const overlayPath = path.join(fixture.stateDir, "derived-overlay.json");
  const source = visualOverlayFixture("page:1/unreadable-price");
  await writeJsonFile(sourcePath, source);
  const sourceSha256 = (await sha256File(sourcePath)).sha256;
  const wrapper = withCanonicalContentHash({
    schema_version: 1 as const,
    artifact_kind: "derived_visual_ground_truth_overlay" as const,
    source_overlay_relative_path: "source-overlay.json",
    source_overlay_sha256: sourceSha256,
    locator_migration: {
      contract_version: "page-to-image-v1" as const,
      transformed_locator_count: 1,
      transformed_unit_count: 1,
    },
    overlay: visualOverlayFixture("image:1/unreadable-price"),
  });
  await writeJsonFile(overlayPath, wrapper);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
  });

  const truth = report.ground_truth as Record<string, unknown>;
  assert.equal(truth.unreadable_cells, 1);
  const unit = (report.units as Array<{ unreadable_cells: Array<{ source_locator: string }> }>)[0]!;
  assert.equal(unit.unreadable_cells[0]?.source_locator, "image:1/unreadable-price");
});

test("derived visual overlay fails closed on self-hash, source binding, and replay drift", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const sourcePath = path.join(fixture.stateDir, "source-overlay.json");
  const overlayPath = path.join(fixture.stateDir, "derived-overlay.json");
  const source = visualOverlayFixture("page:1/unreadable-price");
  await writeJsonFile(sourcePath, source);
  const sourceSha256 = (await sha256File(sourcePath)).sha256;
  const validWrapper = () => withCanonicalContentHash({
    schema_version: 1 as const,
    artifact_kind: "derived_visual_ground_truth_overlay" as const,
    source_overlay_relative_path: "source-overlay.json",
    source_overlay_sha256: sourceSha256,
    locator_migration: {
      contract_version: "page-to-image-v1" as const,
      transformed_locator_count: 1,
      transformed_unit_count: 1,
    },
    overlay: visualOverlayFixture("image:1/unreadable-price"),
  });
  const score = async () => scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
  });

  const selfHashDrift = validWrapper();
  selfHashDrift.overlay.units[0]!.unreadable_cells[0]!.reason = "tampered";
  await writeJsonFile(overlayPath, selfHashDrift);
  await assert.rejects(score(), /artifact content hash does not match/u);

  const sourceBindingDrift = validWrapper();
  sourceBindingDrift.source_overlay_sha256 = "0".repeat(64);
  sourceBindingDrift.content_sha256 = canonicalJsonSha256ExcludingField(
    sourceBindingDrift,
    "content_sha256",
  );
  await writeJsonFile(overlayPath, sourceBindingDrift);
  await assert.rejects(score(), /ground_truth_derived_overlay_source_sha256_mismatch/u);

  const replayDrift = validWrapper();
  replayDrift.overlay.units[0]!.unreadable_cells[0]!.source_locator = "image:2/unreadable-price";
  replayDrift.content_sha256 = canonicalJsonSha256ExcludingField(replayDrift, "content_sha256");
  await writeJsonFile(overlayPath, replayDrift);
  await assert.rejects(score(), /ground_truth_derived_overlay_mechanical_mismatch/u);

  const incomplete = validWrapper() as Record<string, unknown> & { content_sha256: string };
  delete incomplete.locator_migration;
  incomplete.content_sha256 = canonicalJsonSha256ExcludingField(incomplete, "content_sha256");
  await writeJsonFile(overlayPath, incomplete);
  await assert.rejects(score(), /locator_migration/u);
});

test("score matches duplicate amounts by occurrence locator and passes all three gates", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const gate = report.gate as Record<string, unknown>;
  assert.equal(gate.status, "pass");
  assert.equal(gate.eligible_for_25_unit_batch, true);
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "pass");
  assert.deepEqual(unit.counts, {
    extracted_occurrences: 2,
    base_ground_truth_occurrences: 2,
    effective_ground_truth_occurrences: 2,
    human_required_occurrences: 0,
    readable_ground_truth_occurrences: 2,
    matched_occurrences: 2,
    locator_matches: 2,
    quote_context_matches: 0,
    image_value_only_matches: 0,
  });
});

test("score fails when a validator coverage gap is a verified ground-truth price", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as { data: DisclosureExtraction } & Record<string, unknown>;
  artifact.data.agency_packages[0].options = [];
  await writeJsonFile(extractionPath, artifact);
  await attachValidatedCoverage(fixture.stateDir, [{
    raw: "123만원",
    krw: 1_230_000,
    line_context: "가격표!B3: 123만원",
    source_locator: "가격표!B3",
  }]);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "fail");
  const priceGate = unit.price_gate as Record<string, unknown>;
  assert.equal((priceGate.actual_coverage_gaps as unknown[]).length, 1);
});

test("score reports but excludes a validator scanner gap absent from verified ground truth", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  await attachValidatedCoverage(fixture.stateDir, [{
    raw: "777만원",
    krw: 7_770_000,
    line_context: "가격표!Z99: 식별자 777만원",
    source_locator: "가격표!Z99",
  }]);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "pass");
  const priceGate = unit.price_gate as Record<string, unknown>;
  assert.equal((priceGate.actual_coverage_gaps as unknown[]).length, 0);
  assert.equal((priceGate.coverage_gaps_excluded_as_not_ground_truth as unknown[]).length, 1);
});

test("score rejects a structured price fabricated outside the deterministic audit ledger", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as { data: DisclosureExtraction } & Record<string, unknown>;
  artifact.data.agency_packages[0].price_min_krw = 9_990_000;
  artifact.data.agency_packages[0].price_max_krw = 9_990_000;
  artifact.data.agency_packages[0].source_quote = "가격표!B9: 999만원";
  await writeJsonFile(extractionPath, artifact);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "fail");
  const gate = unit.price_gate as Record<string, unknown>;
  assert.equal((gate.unsupported_structured_amounts as unknown[]).length, 1);
});

test("a structured value copied from a known unreadable cell is classified as unsafe", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0]!.extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as { data: DisclosureExtraction } & Record<string, unknown>;
  const agencyPackage = artifact.data.agency_packages[0]!;
  agencyPackage.needs_review = true;
  agencyPackage.options.push({
    name: "기본 추가",
    price_min_krw: 33_000,
    price_max_krw: 33_000,
    unit: null,
    condition: "단위 판독 불가",
    raw_text: "기본 추가 3.3",
    source_quote: "기본 추가 3.3",
    source_file_ids: [SOURCE_ID],
  });
  await writeJsonFile(extractionPath, artifact);

  const overlayPath = path.join(fixture.stateDir, "unreadable-overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: "2026-07-20T00:00:00.000Z",
    units: [{
      unit_id: UNIT_ID,
      readable_occurrences: [],
      unreadable_cells: [{
        source_locator: "image:1/리허설촬영구성/메이크업추가/기본추가",
        visible_amounts_krw: [33_000],
        estimated_content: "메이크업 기본 추가로 보이는 '3.3' 표기",
        reason: "통화 단위를 확정할 수 없음",
      }],
      expectations: {
        doc_kinds: ["agency_disclosure"],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0]!;
  const priceGate = unit.price_gate as Record<string, unknown>;
  const unreadableHandling = unit.unreadable_handling as {
    known_cell_dispositions: Array<{ needs_review: boolean; amounts_remain_unstructured: boolean }>;
  };
  assert.equal((priceGate.unsafe_unreadable_extractions as unknown[]).length, 1);
  assert.deepEqual(unreadableHandling.known_cell_dispositions, [{
    source_locator: "image:1/리허설촬영구성/메이크업추가/기본추가",
    visible_amounts_krw: [33_000],
    needs_review: true,
    amounts_remain_unstructured: false,
  }]);
  assert.equal(unit.status, "fail");
});

test("one source occurrence cannot authorize duplicate structured prices", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as { data: DisclosureExtraction } & Record<string, unknown>;
  artifact.data.agency_packages.push({
    ...artifact.data.agency_packages[0],
    package_name: "duplicate package",
    source_quote: "가격표!B2: 123만원",
    options: [],
  });
  await writeJsonFile(extractionPath, artifact);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "fail");
  const gate = unit.price_gate as Record<string, unknown>;
  assert.equal((gate.unsupported_structured_amounts as unknown[]).length, 1);
});

test("score collapses only every exact member of a pre-certified DOCX shared group", () => {
  const structured = [0, 1, 2].map((index) => ({
    path: `partner_vendors[${index}].options[0]`,
    krw: 110_000,
    source_quote: "table:1!D3: 11만원",
    source_file_ids: ["1".repeat(64)],
  }));
  const exact = collapseCertifiedLocalDocxSharedMoney(structured, [{
    authority: "vertical_merge_interval",
    source_file_id: "1".repeat(64),
    source_locator: "table:1!D3",
    amount_krw: 110_000,
    raw_text: "11만원",
    member_occurrence_keys: structured.map(({ path, krw }) => `${path}\0${krw}`),
  }]);
  assert.equal(exact.occurrences.length, 1);
  assert.equal(exact.applied_groups.length, 1);

  const partial = collapseCertifiedLocalDocxSharedMoney(structured, [{
    authority: "vertical_merge_interval",
    source_file_id: "1".repeat(64),
    source_locator: "table:1!D3",
    amount_krw: 110_000,
    raw_text: "11만원",
    member_occurrence_keys: [
      `${structured[0]!.path}\0${structured[0]!.krw}`,
      `partner_vendors[99].options[0]\0${110_000}`,
    ],
  }]);
  assert.equal(partial.occurrences.length, 3);
  assert.equal(partial.applied_groups.length, 0);
});

test("human-confirmed visual evidence certifies only exact parent range summaries and identity aliases", () => {
  const contentSha256 = "7".repeat(64);
  const visualBinding = {
    schema_version: 1 as const,
    content_sha256: contentSha256,
    reviewer_kind: "human_confirmed" as const,
    reviewer_sha256: "1".repeat(64),
    evidence_sha256: "2".repeat(64),
    record_evidence_sha256: "3".repeat(64),
    coverage_gaps_sha256: "4".repeat(64),
    fragment_sha256: "5".repeat(64),
    validation_issue_codes: ["visual_transcription_human_confirmed_pending_admin_review" as const],
    review_status: "pending" as const,
    needs_review: true as const,
    bulk_approval_eligible: false as const,
  };
  const unit = {
    parsed: {
      raw_name: "에일린꾸뛰르",
      normalized_name: normalizeVendorName("에일린꾸뛰르"),
      corporate_name: null,
    },
    source_files: [{ path: "agency/seoul/(강남)_에일린꾸뛰르_결혼준비대행서비스.png" }],
    local_extraction: { visual_transcription: visualBinding },
    validation: { visual_transcription: visualBinding },
  } as unknown as ManifestUnit;
  const parent = {
    price_min_krw: 600_000,
    price_max_krw: 2_100_000,
    source_quote: "AILEEN COUTURE",
    source_file_ids: ["8".repeat(64)],
    options: [
      {
        price_min_krw: 600_000,
        price_max_krw: 600_000,
        source_quote: "entry 600,000",
        source_file_ids: ["8".repeat(64)],
      },
      {
        price_min_krw: 2_100_000,
        price_max_krw: 2_100_000,
        source_quote: "premium 2,100,000",
        source_file_ids: ["8".repeat(64)],
      },
    ],
  };
  const data = {
    doc_kind: "agency_disclosure",
    business_name: "AILEEN COUTURE",
    region_hint: "서울 강남",
    agency_packages: [structuredClone(parent)],
    partner_vendors: [],
    halls: [],
    sections: [],
    money_occurrences: [
      { amount_krw: 600_000, source_quote: "entry 600,000" },
      { amount_krw: 2_100_000, source_quote: "premium 2,100,000" },
    ],
  } as unknown as DisclosureExtraction;
  const sidecar = {
    content_sha256: contentSha256,
    reviewer: {
      kind: "human_confirmed",
      approved_text_blocks: [{ id: "identity", normalized_content: "AILEEN COUTURE" }],
      record_field_bindings: [
        { field_path: "business_name", approved_text_block_id: "identity", binding_kind: "exact" },
        { field_path: "agency_packages[0].source_quote", approved_text_block_id: "identity", binding_kind: "exact" },
        { field_path: "money_occurrences[0].source_quote", approved_text_block_id: "money-0", binding_kind: "exact" },
        { field_path: "money_occurrences[1].source_quote", approved_text_block_id: "money-1", binding_kind: "exact" },
      ],
    },
    fragment: {
      doc_kind: "agency_disclosure",
      business_name: "AILEEN COUTURE",
      region_hint: "서울 강남",
      agency_packages: [structuredClone(parent)],
      partner_vendors: [],
      halls: [],
      sections: [],
      money_occurrences: [
        { amount_krw: 600_000, source_quote: "entry 600,000" },
        { amount_krw: 2_100_000, source_quote: "premium 2,100,000" },
      ],
    },
    record_evidence: [
      {
        record_path: "agency_packages[0]",
        source_locators: ["image:1/entry", "image:1/premium"],
      },
      { record_path: "agency_packages[0].options[0]", source_locators: ["image:1/entry"] },
      { record_path: "agency_packages[0].options[1]", source_locators: ["image:1/premium"] },
      { record_path: "money_occurrences[0]", source_locators: ["image:1/entry"] },
      { record_path: "money_occurrences[1]", source_locators: ["image:1/premium"] },
    ],
  } as unknown as LoadedVisualTranscriptionSidecar;

  const certification = certifyHumanConfirmedVisualScoreEvidence(unit, data, sidecar);
  assert.ok(certification);
  assert.equal(certification.business_name_alias, "AILEEN COUTURE");
  assert.deepEqual(certification.parent_ranges.map(({ krw }) => krw), [600_000, 2_100_000]);
  const structured = [
    { path: "agency_packages[0]", krw: 600_000, source_quote: "identity", source_file_ids: [] },
    { path: "agency_packages[0]", krw: 2_100_000, source_quote: "identity", source_file_ids: [] },
    { path: "agency_packages[0].options[0]", krw: 600_000, source_quote: "entry", source_file_ids: [] },
    { path: "agency_packages[0].options[1]", krw: 2_100_000, source_quote: "premium", source_file_ids: [] },
  ];
  assert.deepEqual(
    collapseCertifiedHumanVisualParentRanges(structured, certification).map(({ path: recordPath }) => recordPath),
    ["agency_packages[0].options[0]", "agency_packages[0].options[1]"],
  );
  assert.equal(
    businessNameMatchesCanonicalOrCertifiedVisualAlias(unit, "AILEEN COUTURE"),
    false,
  );
  assert.equal(
    businessNameMatchesCanonicalOrCertifiedVisualAlias(
      unit,
      "AILEEN COUTURE",
      certification.business_name_alias,
    ),
    true,
  );

  const unbound = structuredClone(sidecar) as LoadedVisualTranscriptionSidecar;
  const moneyBinding = unbound.reviewer.kind === "human_confirmed"
    ? unbound.reviewer.record_field_bindings.find(({ field_path }) =>
      field_path === "money_occurrences[0].source_quote"
    )
    : null;
  assert.ok(moneyBinding);
  moneyBinding.binding_kind = "extractive";
  const narrowed = certifyHumanConfirmedVisualScoreEvidence(unit, data, unbound);
  assert.ok(narrowed);
  assert.deepEqual(narrowed.parent_ranges.map(({ krw }) => krw), [2_100_000]);
});

test("strict local score accepts only converter-certified DOCX business-header fan-out", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-docx-shared-score-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const stateDir = path.join(temporaryRoot, "state");
  const rawRoot = path.join(temporaryRoot, "raw");
  const rawPath = path.join(rawRoot, "agency", "seoul", "shared.docx");
  const unitId = "9".repeat(64);
  const sourceFingerprint = sha256Text("docx-shared-score-source");
  const convertedPath = path.join(
    stateDir,
    ".converted",
    unitId,
    sourceFingerprint,
    "1-doc.txt",
  );
  const metadata = (
    locator: string,
    vertical_merge: "restart" | "continue",
    empty: boolean,
  ): string => {
    const match = /^table:(\d+)!([A-Z]+)(\d+)$/u.exec(locator);
    assert.ok(match);
    const column = [...match[2]!].reduce(
      (total, character) => total * 26 + character.charCodeAt(0) - 64,
      0,
    );
    return `[DOCX_CELL_META] ${Buffer.from(JSON.stringify({
      version: 2,
      locator,
      table: Number(match[1]),
      row: Number(match[3]),
      column,
      span: null,
      vertical_merge,
      empty,
    }), "utf8").toString("base64url")}`;
  };
  const convertedText = [
    "table:1!A1: 사업자명",
    metadata("table:1!A1", "restart", false),
    "table:1!B1: 기본가격",
    metadata("table:1!B1", "restart", false),
    metadata("table:1!A2", "continue", true),
    metadata("table:1!B2", "continue", true),
    "table:1!A3: 햇살사진, 달빛사진",
    "table:1!B3: 스튜디오 기본 100만원",
  ].join("\n");
  await mkdir(path.dirname(rawPath), { recursive: true });
  await mkdir(path.dirname(convertedPath), { recursive: true });
  await writeFile(rawPath, "immutable DOCX fixture", "utf8");
  await writeFile(convertedPath, convertedText, "utf8");
  const sourceDigest = await sha256File(rawPath);
  const convertedDigest = await sha256File(convertedPath);
  const sourcePath = "agency/seoul/shared.docx";
  const manifest: IngestManifest = {
    schema_version: 1,
    scanner_parser_version: SCANNER_PARSER_VERSION,
    root_dir: rawRoot,
    state_dir: stateDir,
    scanned_at: new Date(0).toISOString(),
    units: [{
      unit_id: unitId,
      display_name: "shared.docx",
      parsed: {
        region_code: "gyeonggi",
        raw_name: "공유웨딩",
        normalized_name: "공유웨딩",
        corporate_name: null,
        kind_hint: "agency",
      },
      source_files: [{
        path: sourcePath,
        absolute_path: rawPath,
        ext: "docx",
        sha256: sourceDigest.sha256,
        bytes: sourceDigest.bytes,
      }],
      source_fingerprint: sourceFingerprint,
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: CONVERTER_VERSION,
        source_fingerprint: sourceFingerprint,
        text_artifacts: [convertedPath],
        image_artifacts: [],
        text_characters: convertedText.length,
        cell_count: 4,
        artifact_fingerprint: sha256Text(
          `${path.resolve(convertedPath)}\0${convertedDigest.sha256}`,
        ),
        converted_at: new Date(0).toISOString(),
      },
    }],
  };
  await writeJsonFile(path.join(stateDir, "manifest.json"), manifest);
  await extractManifestLocally({ stateDir });
  await validateManifest({ stateDir });

  const candidates = scanSourceMoneyOccurrences(convertedText);
  assert.equal(candidates.length, 1);
  const groundTruthPath = path.join(stateDir, "docx-shared-ground-truth.json");
  await writeJsonFile(groundTruthPath, {
    generated_at: new Date(0).toISOString(),
    units: [{
      unit_id: unitId,
      display_name: "shared.docx",
      source_paths: [sourcePath],
      candidate_count: candidates.length,
      candidates,
    }],
  });
  const report = await scoreExtractionAgainstGroundTruth({
    stateDir,
    unitIds: [unitId],
    groundTruthPath,
    expectedGroundTruthSha256: (await sha256File(groundTruthPath)).sha256,
    expectedOccurrenceCount: 1,
    candidateSource: "local",
    requireValidatedArtifacts: true,
  });
  const unit = (report.units as Array<Record<string, unknown>>)[0]!;
  const gate = unit.price_gate as Record<string, unknown>;
  const shared = gate.certified_local_docx_shared_money as {
    groups: unknown[];
    collapsed_occurrences: number;
  };
  assert.equal(unit.status, "pass", JSON.stringify(unit));
  assert.equal((gate.unsupported_structured_amounts as unknown[]).length, 0);
  assert.equal((gate.actual_coverage_gaps as unknown[]).length, 0);
  assert.equal(shared.groups.length, 1);
  assert.equal(shared.collapsed_occurrences, 1);
});

test("score does not let one located amount cover a second ground-truth occurrence", async (t) => {
  const fixture = await buildFixture("가격표!B2: 123만원");
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "fail");
  const gate = unit.price_gate as Record<string, unknown>;
  assert.equal((gate.hallucinated_amounts as unknown[]).length, 1);
  assert.equal((gate.missing_readable_amounts as unknown[]).length, 1);
});

test("score accepts an XLSX cell when the quote cites a containing sheet range", async (t) => {
  const fixture = await buildFixture("가격표!A3:C3: 123만원");
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const gate = report.gate as Record<string, unknown>;
  assert.equal(gate.status, "pass");
});

test("score accepts an XLSX cell-only quote when the sheet name is omitted", async (t) => {
  const fixture = await buildFixture("B3: 123만원");
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const gate = report.gate as Record<string, unknown>;
  assert.equal(gate.status, "pass");
});

test("semantic capture keeps exact sections that only carry a low-confidence review warning", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0]!.extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.sections = [{
    section_type: "refund_policy",
    title: "refund terms",
    content_verbatim: "refund terms",
    summary: "Refund terms require a person to review confidence.",
    source_quote: "가격표!A4: refund terms",
    source_file_ids: [SOURCE_ID],
    confidence: 0.7,
    needs_review: true,
  }];
  await writeJsonFile(extractionPath, artifact);
  const { validatedPath } = await attachStrictArtifacts(fixture.stateDir);
  const validation = await readJsonFile(validatedPath) as {
    issues: Array<{ code: string; path: string }>;
  };
  assert.ok(validation.issues.some((issue) =>
    issue.code === "low_confidence" && issue.path === "sections[0]"
  ));
  const overlayPath = path.join(fixture.stateDir, "review-only-semantic-overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: "2026-07-20T00:00:00.000Z",
    units: [{
      unit_id: UNIT_ID,
      readable_occurrences: [],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["agency_disclosure"],
        policies: true,
        pricing_basis: false,
        sections: true,
        halls_min: 0,
      },
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
    requireValidatedArtifacts: true,
  });

  const unit = (report.units as Array<{
    semantic_capture: {
      status: string;
      observed: { sections: number; document_policy_sections: number; rejected_paths: string[] };
    };
  }>)[0]!;
  assert.equal(unit.semantic_capture.status, "captured", JSON.stringify(unit));
  assert.equal(unit.semantic_capture.observed.sections, 1);
  assert.equal(unit.semantic_capture.observed.document_policy_sections, 1);
  assert.deepEqual(unit.semantic_capture.observed.rejected_paths, []);
});

test("semantic policy coverage accepts document-common refund and penalty sections", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.sections = [{
    section_type: "refund_policy",
    title: "환불 규정",
    content_verbatim: "계약 취소 시 환불 기준",
    summary: "계약 취소 환불 기준입니다.",
    source_quote: "가격표!A4: 환불 규정 계약 취소 시 환불 기준",
    source_file_ids: [SOURCE_ID],
    confidence: 1,
    needs_review: false,
  }];
  await writeJsonFile(extractionPath, artifact);
  await attachStrictArtifacts(fixture.stateDir);
  const overlayPath = path.join(fixture.stateDir, "overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    units: [{
      unit_id: UNIT_ID,
      readable_occurrences: [],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["agency_disclosure"],
        policies: true,
        pricing_basis: false,
        sections: true,
        halls_min: 0,
      },
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
    requireValidatedArtifacts: true,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  const semantic = unit.semantic_capture as Record<string, unknown>;
  assert.equal(semantic.status, "captured");
});

test("semantic capture accepts exact XLSX drawing and formula pricing-basis evidence", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  const drawing = "XLSX_DRAWING xl/drawings/drawing1.xml#text-box-1: [ 총비용 = 예식비 + 식대총액 ]";
  const formula = "XLSX_FORMULA [sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20;part=xl/worksheets/sheet5.xml#cell-B20]: expression=SUM(C12,C14,C16) | cached_value_locator=[sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20] | evaluation=not_executed";
  artifact.data.sections = [
    {
      section_type: "pricing_basis",
      title: "총비용",
      content_verbatim: "[ 총비용 = 예식비 + 식대총액 ]",
      summary: "총비용 산정 기준",
      source_quote: drawing,
      source_file_ids: [SOURCE_ID],
      confidence: 1,
      needs_review: false,
    },
    {
      section_type: "pricing_basis",
      title: "SUM(C12,C14,C16)",
      content_verbatim: "SUM(C12,C14,C16)",
      summary: "수식 원문",
      source_quote: formula,
      source_file_ids: [SOURCE_ID],
      confidence: 1,
      needs_review: false,
    },
  ];
  await writeJsonFile(extractionPath, artifact);
  await attachStrictArtifacts(fixture.stateDir);
  const overlayPath = path.join(fixture.stateDir, "xlsx-aux-semantic-overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: "2026-07-20T00:00:00.000Z",
    units: [{
      unit_id: UNIT_ID,
      readable_occurrences: [],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["agency_disclosure"],
        policies: false,
        pricing_basis: true,
        sections: true,
        halls_min: 0,
      },
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
    requireValidatedArtifacts: true,
  });

  const unit = (report.units as Array<{
    status: string;
    semantic_capture: { status: string; misses: string[] };
  }>)[0]!;
  assert.equal(unit.semantic_capture.status, "captured", JSON.stringify(unit));
  assert.equal(unit.status, "pass", JSON.stringify(unit));
});

test("semantic capture rejects fabricated content and a policy type unsupported by its quote", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0]!.extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.sections = [
    {
      section_type: "refund_policy",
      title: "환불 규정으로 잘못 분류",
      content_verbatim: "드레스 피팅 안내",
      summary: "환불 정책이라고 주장하지만 근거는 피팅 안내입니다.",
      source_quote: "가격표!A4: 드레스 피팅 안내",
      source_file_ids: [SOURCE_ID],
      confidence: 1,
      needs_review: false,
    },
    {
      section_type: "refund_policy",
      title: "원문에 없는 환불 규정",
      content_verbatim: "계약 취소 시 전액 환불",
      summary: "근거와 다른 내용을 만들었습니다.",
      source_quote: "가격표!A5: 촬영 일정 안내",
      source_file_ids: [SOURCE_ID],
      confidence: 1,
      needs_review: false,
    },
  ];
  await writeJsonFile(extractionPath, artifact);
  await attachStrictArtifacts(fixture.stateDir);
  const overlayPath = path.join(fixture.stateDir, "semantic-fail-overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: "2026-07-20T00:00:00.000Z",
    units: [{
      unit_id: UNIT_ID,
      readable_occurrences: [],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["agency_disclosure"],
        policies: true,
        pricing_basis: false,
        sections: true,
        halls_min: 0,
      },
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
    requireValidatedArtifacts: true,
  });

  const semantic = (report.units as Array<{
    semantic_capture: {
      status: string;
      misses: string[];
      observed: {
        policies: number;
        sections: number;
        rejected_paths: string[];
      };
    };
  }>)[0]!.semantic_capture;
  assert.equal(semantic.status, "missing");
  assert.deepEqual(semantic.misses, ["policies", "sections"]);
  assert.equal(semantic.observed.policies, 0);
  assert.equal(semantic.observed.sections, 0);
  assert.deepEqual(semantic.observed.rejected_paths, ["sections[0]", "sections[1]"]);
});

test("an expected semantic omission fails the unit and batch while leaving the zero-price gate truthful", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  await attachStrictArtifacts(fixture.stateDir);
  const overlayPath = path.join(fixture.stateDir, "semantic-omission-overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: "2026-07-20T00:00:00.000Z",
    units: [{
      unit_id: UNIT_ID,
      readable_occurrences: [],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["agency_disclosure"],
        policies: true,
        pricing_basis: true,
        sections: true,
        halls_min: 1,
      },
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
    requireValidatedArtifacts: true,
  });

  const unit = (report.units as Array<{
    status: string;
    price_gate: { passed: boolean };
    semantic_gate: {
      required: boolean;
      passed: boolean;
      expected_status: string;
      actual_status: string;
    };
    semantic_capture: { status: string; misses: string[] };
  }>)[0]!;
  assert.equal(unit.price_gate.passed, true);
  assert.equal(unit.semantic_capture.status, "missing");
  assert.deepEqual(unit.semantic_capture.misses, ["policies", "pricing_basis", "sections", "halls"]);
  assert.deepEqual(unit.semantic_gate, {
    required: true,
    passed: false,
    expected_status: "captured",
    actual_status: "missing",
  });
  assert.equal(unit.status, "fail");
  const gate = report.gate as {
    eligible_for_25_unit_batch: boolean;
    blocking_failed_units: number;
    semantic_criteria: { required_for_expected_units: boolean; required_status: string };
  };
  assert.equal(gate.eligible_for_25_unit_batch, false);
  assert.equal(gate.blocking_failed_units, 1);
  assert.deepEqual(gate.semantic_criteria, {
    required_for_expected_units: true,
    required_status: "captured",
  });
});

test("score treats an occurrence attributed to an unknown source file as a linking error", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.money_occurrences![0].source_file_ids = ["d".repeat(64)];
  await writeJsonFile(extractionPath, artifact);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "fail");
  const gate = unit.price_gate as Record<string, unknown>;
  assert.deepEqual(
    (gate.linking_errors as Array<Record<string, unknown>>).map((error) => error.code),
    ["source_file_id_mismatch"],
  );
});

test("score requires an explicit canonical region association", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.region_hint = null;
  await writeJsonFile(extractionPath, artifact);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal(unit.status, "fail");
  const gate = unit.price_gate as Record<string, unknown>;
  assert.deepEqual(
    (gate.linking_errors as Array<Record<string, unknown>>).map((error) => error.code),
    ["region_missing"],
  );
});

test("score rejects a partner category that contradicts its source sheet", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.partner_vendors = [{
    vendor_name: "실제 업체",
    old_names: [],
    category: "dress",
    price_min_krw: null,
    price_max_krw: null,
    base_spec: null,
    price_note: null,
    options: [],
    policies: [],
    source_quote: "스튜디오!A5: 실제 업체",
    source_file_ids: [SOURCE_ID],
    confidence: 1,
    needs_review: false,
  }];
  await writeJsonFile(extractionPath, artifact);

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0];
  const gate = unit.price_gate as Record<string, unknown>;
  assert.deepEqual(
    (gate.linking_errors as Array<Record<string, unknown>>).map((error) => error.code),
    ["partner_category_source_mismatch"],
  );
});

test("score fails closed before reading results when ground-truth hash drifts", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));

  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: "0".repeat(64),
      expectedOccurrenceCount: 2,
    }),
    /ground truth SHA-256 불일치/u,
  );
});

test("verified adjudication excludes one exact non-money occurrence and reports immutable counts", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const inventory = await readJsonFile(fixture.groundTruthPath) as {
    units: Array<{
      candidate_count: number;
      candidates: Array<Record<string, unknown>>;
    }>;
  } & Record<string, unknown>;
  inventory.units[0].candidates.push({
    raw: "10:00",
    krw: 100_000,
    line_context: "상담 가능 시간 10:00~15:00",
    source_locator: "안내!B4",
  });
  inventory.units[0].candidate_count = 3;
  await writeJsonFile(fixture.groundTruthPath, inventory);
  const baseSha256 = (await sha256File(fixture.groundTruthPath)).sha256;
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: baseSha256,
    decisions: [{
      decision_id: "exclude-clock-fragment",
      action: "exclude_non_money",
      verification: "verified",
      references: [{
        unit_id: UNIT_ID,
        source_locator: "안내!B4",
        raw: "10:00",
        ordinal: 1,
      }],
      reason: "시각 표기를 가격 후보로 잘못 분류함",
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: baseSha256,
    expectedOccurrenceCount: 3,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "pass");
  const truth = report.ground_truth as Record<string, unknown>;
  assert.equal(truth.base_inventory_occurrences, 3);
  assert.equal(truth.effective_readable_occurrences, 2);
  const adjudication = truth.adjudication as Record<string, unknown>;
  assert.equal(adjudication.verified_decisions, 1);
  assert.equal(adjudication.human_required_decisions, 0);
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.deepEqual(unit.counts, {
    extracted_occurrences: 2,
    base_ground_truth_occurrences: 3,
    effective_ground_truth_occurrences: 2,
    human_required_occurrences: 0,
    readable_ground_truth_occurrences: 2,
    matched_occurrences: 2,
    locator_matches: 2,
    quote_context_matches: 0,
    image_value_only_matches: 0,
  });
});

test("verified replace_amount swaps one exact occurrence without mutating the base inventory", async (t) => {
  const fixture = await buildFixture("가격표!B3: 124만원");
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.money_occurrences![1] = {
    ...artifact.data.money_occurrences![1],
    amount_krw: 1_240_000,
    raw_text: "124만원",
    source_quote: "가격표!B3: 124만원",
  };
  await writeJsonFile(extractionPath, artifact);
  artifact.data.agency_packages[0].options[0] = {
    ...artifact.data.agency_packages[0].options[0],
    price_min_krw: 1_240_000,
    price_max_krw: 1_240_000,
    source_quote: artifact.data.money_occurrences![1].source_quote,
  };
  await writeJsonFile(extractionPath, artifact);
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [{
      decision_id: "replace-normalized-amount",
      action: "replace_amount",
      verification: "verified",
      references: [{
        unit_id: UNIT_ID,
        source_locator: "가격표!B3",
        raw: "123만원",
        ordinal: 1,
      }],
      result: {
        unit_id: UNIT_ID,
        raw: "124만원",
        krw: 1_240_000,
        line_context: "가격표!B3: 124만원",
        source_locator: "가격표!B3",
        ordinal: 1,
      },
      reason: "원본 판독 재검토 결과 124만원임",
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "pass");
  const immutableBase = await readJsonFile(fixture.groundTruthPath) as {
    units: Array<{ candidates: Array<{ krw: number }> }>;
  };
  assert.equal(immutableBase.units[0].candidates[1].krw, 1_230_000);
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal((unit.counts as Record<string, unknown>).base_ground_truth_occurrences, 2);
  assert.equal((unit.counts as Record<string, unknown>).effective_ground_truth_occurrences, 2);
});

test("verified merge_components replaces multiple exact source fragments with one occurrence", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.money_occurrences = [{
    amount_krw: 2_460_000,
    raw_text: "123만원+123만원",
    source_quote: "가격표!B2:B3: 123만원+123만원",
    source_file_ids: [SOURCE_ID],
    kind: "price",
    needs_review: false,
  }];
  artifact.data.agency_packages[0] = {
    ...artifact.data.agency_packages[0],
    price_min_krw: 2_460_000,
    price_max_krw: 2_460_000,
    source_quote: artifact.data.money_occurrences[0].source_quote,
    options: [],
  };
  await writeJsonFile(extractionPath, artifact);
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [{
      decision_id: "merge-price-components",
      action: "merge_components",
      verification: "verified",
      references: [
        { unit_id: UNIT_ID, source_locator: "가격표!B2", raw: "123만원", ordinal: 1 },
        { unit_id: UNIT_ID, source_locator: "가격표!B3", raw: "123만원", ordinal: 1 },
      ],
      result: {
        unit_id: UNIT_ID,
        raw: "123만원+123만원",
        krw: 2_460_000,
        line_context: "가격표!B2:B3: 123만원+123만원",
        source_locator: "가격표!B2:B3",
        ordinal: 1,
      },
      reason: "두 셀은 한 상품의 합성 총액을 구성함",
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "pass");
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal((unit.counts as Record<string, unknown>).base_ground_truth_occurrences, 2);
  assert.equal((unit.counts as Record<string, unknown>).effective_ground_truth_occurrences, 1);
});

test("verified add_missing adds a stable result occurrence without a base reference", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.money_occurrences!.push({
    amount_krw: 500_000,
    raw_text: "50만원",
    source_quote: "가격표!C4: 50만원",
    source_file_ids: [SOURCE_ID],
    kind: "price",
    needs_review: false,
  });
  await writeJsonFile(extractionPath, artifact);
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [{
      decision_id: "add-missed-price",
      action: "add_missing",
      verification: "verified",
      references: [],
      result: {
        unit_id: UNIT_ID,
        raw: "50만원",
        krw: 500_000,
        line_context: "가격표!C4: 50만원",
        source_locator: "가격표!C4",
        ordinal: 1,
      },
      reason: "원문 전수 대조에서 누락을 확인함",
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "pass");
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal((unit.counts as Record<string, unknown>).base_ground_truth_occurrences, 2);
  assert.equal((unit.counts as Record<string, unknown>).effective_ground_truth_occurrences, 3);
});

test("human-required source anomaly is quarantined from the exact gate and remains visible", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.money_occurrences = artifact.data.money_occurrences!.slice(0, 1);
  artifact.data.agency_packages[0].options = [];
  await writeJsonFile(extractionPath, artifact);
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [{
      decision_id: "quarantine-unreadable-cell",
      action: "quarantine_source_anomaly",
      verification: "human_required",
      references: [{
        unit_id: UNIT_ID,
        source_locator: "가격표!B3",
        raw: "123만원",
        ordinal: 1,
      }],
      reason: "셀 이미지가 깨져 사람이 원본을 확인해야 함",
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "pass");
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal((unit.counts as Record<string, unknown>).effective_ground_truth_occurrences, 1);
  assert.equal((unit.counts as Record<string, unknown>).human_required_occurrences, 1);
  assert.deepEqual(unit.adjudication_summary, {
    verified_decisions: 0,
    human_required_decisions: 1,
    excluded_base_occurrences: 1,
    added_effective_occurrences: 0,
    quarantined_occurrences: 1,
    human_required_occurrences: 1,
  });
  assert.deepEqual(
    (unit.human_required_adjudication as Array<Record<string, unknown>>).map((item) => ({
      action: item.action,
      reason: item.reason,
    })),
    [{
      action: "quarantine_source_anomaly",
      reason: "셀 이미지가 깨져 사람이 원본을 확인해야 함",
    }],
  );
});

test("a human-required quarantined occurrence may stay in the audit ledger but cannot authorize a structured price", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0]!.extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  const quarantinedOption = artifact.data.agency_packages[0]!.options[0]!;
  artifact.data.agency_packages[0]!.options = [];
  await writeJsonFile(extractionPath, artifact);
  const inventory = await readJsonFile(fixture.groundTruthPath) as {
    units: Array<{ candidates: Array<{ raw: string; source_locator: string }> }>;
  };
  const quarantined = inventory.units[0]!.candidates[1]!;
  const adjudicationPath = path.join(fixture.stateDir, "audit-only-adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [{
      decision_id: "quarantine-audit-only-source-occurrence",
      action: "quarantine_source_anomaly",
      verification: "human_required",
      references: [{
        unit_id: UNIT_ID,
        source_locator: quarantined.source_locator,
        raw: quarantined.raw,
        ordinal: 1,
      }],
      reason: "The source scanner must retain this amount while a person adjudicates it.",
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });

  const unit = (report.units as Array<Record<string, unknown>>)[0]!;
  const priceGate = unit.price_gate as Record<string, unknown>;
  assert.equal((priceGate.hallucinated_amounts as unknown[]).length, 0, JSON.stringify(unit));
  assert.equal((priceGate.unsupported_structured_amounts as unknown[]).length, 0);
  assert.equal(unit.status, "pass", JSON.stringify(unit));
  assert.equal((unit.human_required_adjudication as unknown[]).length, 1);

  artifact.data.agency_packages[0]!.options = [quarantinedOption];
  await writeJsonFile(extractionPath, artifact);
  const unsafeStructuredReport = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });
  const unsafeUnit = (unsafeStructuredReport.units as Array<Record<string, unknown>>)[0]!;
  const unsafePriceGate = unsafeUnit.price_gate as Record<string, unknown>;
  assert.equal((unsafePriceGate.hallucinated_amounts as unknown[]).length, 0);
  assert.equal((unsafePriceGate.unsupported_structured_amounts as unknown[]).length, 1);
  assert.equal(unsafeUnit.status, "fail", JSON.stringify(unsafeUnit));
});

test("semantic_expansion_only verifies its source reference but does not change the price gate", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [{
      decision_id: "record-policy-semantic-expansion",
      action: "semantic_expansion_only",
      verification: "verified",
      references: [{
        unit_id: UNIT_ID,
        source_locator: "가격표!B2",
        raw: "123만원",
        ordinal: 1,
      }],
      reason: "이 발생의 주변 문맥은 환불 규정 의미 채점에만 사용함",
    }],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "pass");
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal((unit.counts as Record<string, unknown>).base_ground_truth_occurrences, 2);
  assert.equal((unit.counts as Record<string, unknown>).effective_ground_truth_occurrences, 2);
  const truth = report.ground_truth as Record<string, unknown>;
  const adjudication = truth.adjudication as Record<string, unknown>;
  assert.equal(
    (adjudication.decisions_by_action as Record<string, number>).semantic_expansion_only,
    1,
  );
});

test("adjudication path and expected hash are an immutable option pair", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [],
  });

  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      adjudicationPath,
    }),
    /adjudicationPath and expectedAdjudicationSha256 must be provided together/u,
  );
  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      expectedAdjudicationSha256: "0".repeat(64),
    }),
    /adjudicationPath and expectedAdjudicationSha256 must be provided together/u,
  );
});

test("adjudication is rejected when its declared base hash does not match verified ground truth", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: "0".repeat(64),
    decisions: [],
  });

  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      adjudicationPath,
      expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
    }),
    /adjudication base SHA-256 mismatch/u,
  );
});

test("adjudication fails closed when an exact occurrence reference resolves to zero candidates", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [{
      decision_id: "bad-reference",
      action: "exclude_non_money",
      verification: "verified",
      references: [{
        unit_id: UNIT_ID,
        source_locator: "가격표!B404",
        raw: "123만원",
        ordinal: 1,
      }],
      reason: "존재하지 않는 위치를 가리키는 잘못된 정정",
    }],
  });

  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      adjudicationPath,
      expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
    }),
    /adjudication reference not found/u,
  );
});

test("adjudication fails closed when decision IDs are duplicated", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  const reference = {
    unit_id: UNIT_ID,
    source_locator: "가격표!B2",
    raw: "123만원",
    ordinal: 1,
  };
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [
      {
        decision_id: "duplicate-id",
        action: "semantic_expansion_only",
        verification: "verified",
        references: [reference],
        reason: "첫 번째 결정",
      },
      {
        decision_id: "duplicate-id",
        action: "semantic_expansion_only",
        verification: "verified",
        references: [{ ...reference, source_locator: "가격표!B3" }],
        reason: "두 번째 결정",
      },
    ],
  });

  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      adjudicationPath,
      expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
    }),
    /decision_id values must be unique/u,
  );
});

test("adjudication fails closed when one occurrence is referenced by multiple decisions", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  const reference = {
    unit_id: UNIT_ID,
    source_locator: "가격표!B2",
    raw: "123만원",
    ordinal: 1,
  };
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [
      {
        decision_id: "semantic-first",
        action: "semantic_expansion_only",
        verification: "verified",
        references: [reference],
        reason: "의미 확장",
      },
      {
        decision_id: "exclude-second",
        action: "exclude_non_money",
        verification: "verified",
        references: [reference],
        reason: "동일 발생을 다시 제외하려는 충돌",
      },
    ],
  });

  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      adjudicationPath,
      expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
    }),
    /occurrence referenced more than once/u,
  );
});

test("human-required replace and add results stay outside the exact price gate", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const manifest = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const extractionPath = manifest.units[0].extraction?.artifact_path ?? "";
  const artifact = await readJsonFile(extractionPath) as {
    data: DisclosureExtraction;
  } & Record<string, unknown>;
  artifact.data.money_occurrences = artifact.data.money_occurrences!.slice(0, 1);
  artifact.data.money_occurrences.push({
    amount_krw: 500_000,
    raw_text: "판독 후보 50만원",
    source_quote: "가격표!C4: 판독 후보 50만원",
    source_file_ids: [SOURCE_ID],
    kind: "price",
    needs_review: true,
  });
  artifact.data.agency_packages[0].options = [];
  await writeJsonFile(extractionPath, artifact);
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [
      {
        decision_id: "replace-needs-human",
        action: "replace_amount",
        verification: "human_required",
        references: [{
          unit_id: UNIT_ID,
          source_locator: "가격표!B3",
          raw: "123만원",
          ordinal: 1,
        }],
        result: {
          unit_id: UNIT_ID,
          raw: "판독 후보 124만원",
          krw: 1_240_000,
          line_context: "가격표!B3: 판독 후보 124만원",
          source_locator: "가격표!B3",
          ordinal: 1,
        },
        reason: "원본 셀 재확인 필요",
      },
      {
        decision_id: "add-needs-human",
        action: "add_missing",
        verification: "human_required",
        references: [],
        result: {
          unit_id: UNIT_ID,
          raw: "판독 후보 50만원",
          krw: 500_000,
          line_context: "가격표!C4: 판독 후보 50만원",
          source_locator: "가격표!C4",
          ordinal: 1,
        },
        reason: "추가 금액인지 사람이 확인해야 함",
      },
    ],
  });

  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [UNIT_ID],
    groundTruthPath: fixture.groundTruthPath,
    expectedGroundTruthSha256: fixture.groundTruthSha256,
    expectedOccurrenceCount: 2,
    adjudicationPath,
    expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
  });

  assert.equal((report.gate as Record<string, unknown>).status, "pass");
  const unit = (report.units as Array<Record<string, unknown>>)[0];
  assert.equal((unit.counts as Record<string, unknown>).effective_ground_truth_occurrences, 1);
  assert.equal((unit.counts as Record<string, unknown>).human_required_occurrences, 2);
  assert.equal((unit.human_required_adjudication as unknown[]).length, 2);
  assert.deepEqual(unit.adjudication_summary, {
    verified_decisions: 0,
    human_required_decisions: 2,
    excluded_base_occurrences: 1,
    added_effective_occurrences: 0,
    quarantined_occurrences: 2,
    human_required_occurrences: 2,
  });
  const gate = unit.price_gate as Record<string, unknown>;
  assert.equal((gate.hallucinated_amounts as unknown[]).length, 0);
  assert.equal((gate.missing_readable_amounts as unknown[]).length, 0);
});

test("human-required result still requires a valid stable ordinal", async (t) => {
  const fixture = await buildFixture();
  t.after(async () => rm(fixture.stateDir, { recursive: true, force: true }));
  const adjudicationPath = path.join(fixture.stateDir, "adjudication.json");
  await writeJsonFile(adjudicationPath, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    base_ground_truth_sha256: fixture.groundTruthSha256,
    decisions: [{
      decision_id: "unstable-human-result",
      action: "add_missing",
      verification: "human_required",
      references: [],
      result: {
        unit_id: UNIT_ID,
        raw: "판독 후보 50만원",
        krw: 500_000,
        line_context: "가격표!C4: 판독 후보 50만원",
        source_locator: "가격표!C4",
        ordinal: 2,
      },
      reason: "잘못된 ordinal을 가진 사람 확인 후보",
    }],
  });

  await assert.rejects(
    scoreExtractionAgainstGroundTruth({
      stateDir: fixture.stateDir,
      unitIds: [UNIT_ID],
      groundTruthPath: fixture.groundTruthPath,
      expectedGroundTruthSha256: fixture.groundTruthSha256,
      expectedOccurrenceCount: 2,
      adjudicationPath,
      expectedAdjudicationSha256: (await sha256File(adjudicationPath)).sha256,
    }),
    /adjudication result ordinal mismatch/u,
  );
});
