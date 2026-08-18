import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONVERTER_VERSION, convertManifest } from "../convert.js";
import {
  currentExtractionFingerprint,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
} from "../extraction-contract.js";
import { sha256File, sha256Text } from "../io.js";
import { createLedgerId } from "../ledger.js";
import { extractManifestLocally } from "../local-extraction-runner.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { SCANNER_PARSER_VERSION, scanSources } from "../scan.js";
import { formatIngestStatus, getIngestStatus } from "../status.js";
import { validateManifest, VALIDATOR_VERSION } from "../validate.js";

async function createConvertedStatusFixture(
  rootDir: string,
  stateDir: string,
  artifactText = "preserved disclosure evidence",
) {
  const regionDir = path.join(rootDir, "agency", "jeju");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "sample-vendor.docx"), "generated source fixture");
  const manifest = await scanSources({
    rootDir,
    stateDir,
    agencyDir: "agency",
    hallDir: "hall",
  });
  const unit = manifest.units[0];
  const artifactPath = path.join(
    stateDir,
    ".converted",
    unit.unit_id,
    unit.source_fingerprint,
    "1-doc.txt",
  );
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, artifactText);
  const digest = await sha256File(artifactPath);
  unit.conversion = {
    converter_version: CONVERTER_VERSION,
    source_fingerprint: unit.source_fingerprint,
    text_artifacts: [artifactPath],
    image_artifacts: [],
    text_characters: artifactText.length,
    cell_count: 0,
    artifact_fingerprint: sha256Text(`${path.resolve(artifactPath)}\0${digest.sha256}`),
    converted_at: new Date().toISOString(),
  };
  unit.stage = "converted";
  await saveManifest(manifest);
  return { artifactPath };
}

test("status treats a converted unit with a missing artifact as stale", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-missing-artifact-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const { artifactPath } = await createConvertedStatusFixture(rootDir, stateDir);

  const intactStatus = await getIngestStatus({ stateDir });
  assert.equal(intactStatus.current_by_stage.converted, 1);
  assert.equal(intactStatus.stale_by_stage.converted, 0);

  await rm(artifactPath);
  const missingStatus = await getIngestStatus({ stateDir });
  assert.equal(missingStatus.durable_by_stage.converted, 1);
  assert.equal(missingStatus.current_by_stage.converted, 0);
  assert.equal(missingStatus.stale_by_stage.converted, 1);
  assert.doesNotMatch(formatIngestStatus(missingStatus), /sample-vendor|artifact|\.converted/u);
});

test("status treats a converted unit with tampered artifact content as stale", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-tampered-artifact-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const { artifactPath } = await createConvertedStatusFixture(rootDir, stateDir);

  await writeFile(artifactPath, "tampered private vendor disclosure content");
  const status = await getIngestStatus({ stateDir });

  assert.equal(status.durable_by_stage.converted, 1);
  assert.equal(status.current_by_stage.converted, 0);
  assert.equal(status.stale_by_stage.converted, 1);
  assert.doesNotMatch(
    formatIngestStatus(status),
    /tampered private vendor disclosure content|sample-vendor|\.converted/u,
  );
});

test("status counts current local deterministic extraction separately with zero usage and cost", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-local-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  await createConvertedStatusFixture(rootDir, stateDir);
  const extraction = await extractManifestLocally({ stateDir });
  assert.equal(extraction.processed_units, 1);

  const status = await getIngestStatus({ stateDir });

  assert.equal(status.current_by_stage.extracted, 1);
  assert.equal(status.stale_by_stage.extracted, 0);
  assert.equal(status.durable_local_extracted_units, 1);
  assert.equal(status.current_local_extracted_units, 1);
  assert.equal(status.historical_local_extraction_input_tokens, 0);
  assert.equal(status.historical_local_extraction_output_tokens, 0);
  assert.equal(status.durable_local_extraction_cost_usd, 0);
  assert.equal(status.historical_extraction_input_tokens, 0);
  assert.equal(status.historical_extraction_output_tokens, 0);
  assert.equal(status.durable_ledger_estimated_cost_usd, 0);
  assert.match(
    formatIngestStatus(status),
    /Current local deterministic extraction units:\s+1[\s\S]*Local deterministic extraction tokens:\s+0 input \/ 0 output[\s\S]*Local deterministic extraction cost \(USD\):\s+0\.000000/u,
  );
});

test("status does not treat stale local engine metadata as current", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-local-stale-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  await createConvertedStatusFixture(rootDir, stateDir);
  await extractManifestLocally({ stateDir });
  const manifest = await loadManifest(stateDir);
  assert.ok(manifest.units[0].local_extraction);
  manifest.units[0].local_extraction.engine_version = "stale-local-engine";
  await saveManifest(manifest);

  const status = await getIngestStatus({ stateDir });

  assert.equal(status.durable_by_stage.extracted, 1);
  assert.equal(status.current_by_stage.extracted, 0);
  assert.equal(status.stale_by_stage.extracted, 1);
  assert.equal(status.durable_local_extracted_units, 1);
  assert.equal(status.current_local_extracted_units, 0);
  assert.equal(status.durable_local_extraction_cost_usd, 0);
});

test("status treats a missing local extraction artifact as stale", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-local-missing-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  await createConvertedStatusFixture(rootDir, stateDir);
  const extraction = await extractManifestLocally({ stateDir });
  const artifactPath = extraction.manifest.units[0]?.local_extraction?.artifact_path;
  assert.ok(artifactPath);
  await rm(artifactPath);

  const status = await getIngestStatus({ stateDir });

  assert.equal(status.durable_by_stage.extracted, 1);
  assert.equal(status.current_by_stage.extracted, 0);
  assert.equal(status.stale_by_stage.extracted, 1);
  assert.equal(status.current_local_extracted_units, 0);
});

test("status verifies and reports local review-only validation separately from strict paid load", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-local-validation-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  await createConvertedStatusFixture(rootDir, stateDir, [
    "## 시트: 스튜디오",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!A4: 해피스튜디오",
    "스튜디오!B4: 스튜디오 기본 120만원",
  ].join("\n"));
  await extractManifestLocally({ stateDir });
  const validated = await validateManifest({ stateDir });
  assert.equal(validated.units[0]?.stage, "validated");

  const current = await getIngestStatus({ stateDir });

  assert.equal(current.current_by_stage.validated, 1);
  assert.equal(current.durable_local_validated_units, 1);
  assert.equal(current.current_local_validated_units, 1);
  assert.equal(current.current_local_review_load_eligible_units, 1);
  assert.equal(current.current_strict_load_eligible_units, 0);
  assert.equal(current.current_pending_review_units, 1);
  assert.match(
    formatIngestStatus(current),
    /Current local review-only validated units:\s+1[\s\S]*Current local pending-load eligible units:\s+1/u,
  );

  await rm(validated.units[0]!.validation!.artifact_path);
  const missing = await getIngestStatus({ stateDir });
  assert.equal(missing.current_by_stage.validated, 0);
  assert.equal(missing.current_local_validated_units, 0);
  assert.equal(missing.current_local_review_load_eligible_units, 0);
  assert.equal(missing.current_pending_review_units, 0);
});

test("status reports manual work separately from completed stages", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "충청");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(충청)_수동더미.hwp"), "generated hwp fixture");
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const status = await getIngestStatus({ stateDir });

  assert.equal(status.total_units, 1);
  assert.equal(status.durable_by_stage.needs_manual_conversion, 1);
  assert.equal(status.current_by_stage.needs_manual_conversion, 1);
  assert.equal(status.stale_by_stage.needs_manual_conversion, 0);
  assert.equal(status.durable_manual_source_files, 1);
  assert.equal(status.durable_failed_units, 0);
  const table = formatIngestStatus(status);
  assert.match(table, /Stage\s+Durable\s+Current\s+Stale/u);
  assert.match(table, /needs_manual_conversion\s+1\s+1\s+0/u);
  assert.match(table, /Total units:\s+1/u);
  assert.match(table, /Durable AI ledger estimated cost \(USD\):\s+0\.000000/u);
  assert.doesNotMatch(table, /\.hwp|수동웨딩/u);
});

test("status uses the paid-ledger conservative cumulative cost for legacy rows", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-ledger-cost-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_원장상태.docx"), "generated fixture");
  await scanSources({ rootDir, stateDir });
  const runId = "00000000-0000-4000-8000-000000000001";
  const fingerprint = "b".repeat(64);
  const ledgerEntry = {
    schema_version: 2,
    ledger_id: createLedgerId(runId, fingerprint, 0, 1),
    run_id: runId,
    unit_id: "a".repeat(64),
    fingerprint,
    prompt_version: "legacy-status-fixture",
    model: "gpt-5.6-luna",
    batch_index: 0,
    attempt: 1,
    request_id: null,
    input_tokens: 100,
    output_tokens: 0,
    estimated_cost_usd: 0.0001,
    latency_ms: 1,
    success: true,
    error_category: null,
    attempted_at: "2026-07-20T00:00:00.000Z",
  } as const;
  const ledgerDirectory = path.join(stateDir, ".cache");
  await mkdir(ledgerDirectory, { recursive: true });
  await writeFile(
    path.join(ledgerDirectory, "ai-ledger.ndjson"),
    `${JSON.stringify(ledgerEntry)}\n`,
    "utf8",
  );

  const status = await getIngestStatus({ stateDir });

  assert.equal(status.durable_ledger_estimated_cost_usd, 0.000125);
  assert.equal(status.historical_extraction_input_tokens, 100);
});

test("status never counts a stale prompt or processing version as current or strict-load eligible", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-stale-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "chungcheong");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(충청)_상태표시테스트.docx"), "generated fixture");
  await scanSources({
    rootDir,
    stateDir,
    agencyDir: "결혼준비대행서비스",
    hallDir: "예식장",
  });

  const manifest = await loadManifest(stateDir);
  const unit = manifest.units[0];
  const artifactFingerprint = sha256Text("");
  const extractionContentSha256 = "b".repeat(64);
  unit.conversion = {
    converter_version: CONVERTER_VERSION,
    source_fingerprint: unit.source_fingerprint,
    text_artifacts: [],
    image_artifacts: [],
    text_characters: 0,
    cell_count: 0,
    artifact_fingerprint: artifactFingerprint,
    converted_at: new Date().toISOString(),
  };
  const fingerprint = currentExtractionFingerprint({
    scannerParserVersion: SCANNER_PARSER_VERSION,
    converterVersion: CONVERTER_VERSION,
    model: "gpt-5.6-luna",
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint,
  });
  unit.extraction = {
    fingerprint,
    content_sha256: extractionContentSha256,
    source_fingerprint: unit.source_fingerprint,
    artifact_fingerprint: artifactFingerprint,
    prompt_version: `${EXTRACTION_PROMPT_VERSION}-stale`,
    prompt_hash: EXTRACTION_PROMPT_HASH,
    processing_version: EXTRACTION_PROCESSING_VERSION,
    scanner_parser_version: SCANNER_PARSER_VERSION,
    converter_version: CONVERTER_VERSION,
    model: "gpt-5.6-luna",
    artifact_path: path.join(stateDir, ".cache", "extract", `${fingerprint}.json`),
    cache_hit: true,
    attempts: 1,
    input_tokens: 123,
    output_tokens: 45,
    extracted_at: new Date().toISOString(),
  };
  unit.validation = {
    fingerprint: "c".repeat(64),
    content_sha256: "d".repeat(64),
    extraction_content_sha256: extractionContentSha256,
    validator_version: VALIDATOR_VERSION,
    artifact_path: path.join(stateDir, "validated", `${unit.unit_id}.json`),
    review_status: "pending",
    issue_count: 2,
    validated_at: new Date().toISOString(),
  };
  unit.stage = "validated";
  await saveManifest(manifest);

  const status = await getIngestStatus({ stateDir });

  assert.equal(status.durable_by_stage.validated, 1);
  assert.equal(status.current_by_stage.validated, 0);
  assert.equal(status.stale_by_stage.validated, 1);
  assert.equal(status.current_strict_load_eligible_units, 0);
  assert.equal(status.historical_pending_review_units, 1);
  assert.equal(status.current_pending_review_units, 0);
  assert.equal(status.historical_extraction_input_tokens, 123);
  assert.equal(status.historical_extraction_output_tokens, 45);
  assert.doesNotMatch(
    formatIngestStatus(status),
    /상태표시테스트|hanbang-ingest-status-stale|\.cache[\\/]extract/u,
  );

  unit.extraction.prompt_version = EXTRACTION_PROMPT_VERSION;
  unit.extraction.processing_version = "e".repeat(64);
  await saveManifest(manifest);
  const staleProcessingStatus = await getIngestStatus({ stateDir });
  assert.equal(staleProcessingStatus.current_by_stage.validated, 0);
  assert.equal(staleProcessingStatus.stale_by_stage.validated, 1);
  assert.equal(staleProcessingStatus.current_strict_load_eligible_units, 0);

  unit.extraction.processing_version = EXTRACTION_PROCESSING_VERSION;
  manifest.scanner_parser_version = "stale-scanner-version";
  await saveManifest(manifest);
  const staleScannerStatus = await getIngestStatus({ stateDir });
  assert.equal(staleScannerStatus.current_by_stage.validated, 0);
  assert.equal(staleScannerStatus.current_strict_load_eligible_units, 0);

  manifest.scanner_parser_version = SCANNER_PARSER_VERSION;
  unit.conversion.converter_version = "stale-converter-version";
  await saveManifest(manifest);
  const staleConverterStatus = await getIngestStatus({ stateDir });
  assert.equal(staleConverterStatus.current_by_stage.validated, 0);
  assert.equal(staleConverterStatus.current_strict_load_eligible_units, 0);

  unit.conversion.converter_version = CONVERTER_VERSION;
  unit.validation.validator_version = "stale-validator-version";
  await saveManifest(manifest);
  const staleValidatorStatus = await getIngestStatus({ stateDir });
  assert.equal(staleValidatorStatus.current_by_stage.validated, 0);
  assert.equal(staleValidatorStatus.current_strict_load_eligible_units, 0);

  unit.validation.validator_version = VALIDATOR_VERSION;
  await saveManifest(manifest);
  const currentStatus = await getIngestStatus({ stateDir });
  assert.equal(currentStatus.current_by_stage.validated, 1);
  assert.equal(currentStatus.stale_by_stage.validated, 0);
  assert.equal(currentStatus.current_strict_load_eligible_units, 1);
  assert.equal(currentStatus.current_pending_review_units, 1);
  assert.equal(currentStatus.current_validation_issues, 2);

  unit.stage = "loaded";
  await saveManifest(manifest);
  const unversionedLoadedStatus = await getIngestStatus({ stateDir });
  assert.equal(unversionedLoadedStatus.durable_by_stage.loaded, 1);
  assert.equal(unversionedLoadedStatus.current_by_stage.loaded, 0);
  assert.equal(unversionedLoadedStatus.stale_by_stage.loaded, 1);
  assert.equal(unversionedLoadedStatus.current_strict_load_eligible_units, 0);
  assert.equal(unversionedLoadedStatus.current_pending_review_units, 0);

  unit.stage = "error";
  await saveManifest(manifest);
  const currentValidationErrorStatus = await getIngestStatus({ stateDir });
  assert.equal(currentValidationErrorStatus.current_by_stage.error, 1);
  assert.equal(currentValidationErrorStatus.stale_by_stage.error, 0);
});

test("status identifies failed units with content-safe codes only", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-error-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_샘플실패업체.docx"), "generated fixture");
  await scanSources({ rootDir, stateDir });
  const manifest = await loadManifest(stateDir);
  manifest.units[0].stage = "error";
  manifest.units[0].notices.push(
    "extract 실패: C:\\private\\실제업체명.xlsx OPENAI_API_KEY=secret generated failure",
  );
  await saveManifest(manifest);

  const status = await getIngestStatus({ stateDir });
  assert.equal(status.current_by_stage.error, 0);
  assert.equal(status.stale_by_stage.error, 1);
  assert.deepEqual(status.failed_unit_details, [{
    unit_id: manifest.units[0].unit_id,
    error_codes: ["extract_failed"],
  }]);
  const table = formatIngestStatus(status);
  assert.match(table, new RegExp(manifest.units[0].unit_id, "u"));
  assert.match(table, /extract_failed/u);
  assert.doesNotMatch(table, /실제업체명|OPENAI_API_KEY|private/u);

  manifest.units[0].notices = [
    `duplicate_source_content: hidden paths across unit_ids=${manifest.units[0].unit_id}`,
  ];
  await saveManifest(manifest);
  const duplicateStatus = await getIngestStatus({ stateDir });
  assert.equal(duplicateStatus.current_by_stage.error, 1);
  assert.equal(duplicateStatus.stale_by_stage.error, 0);
  assert.deepEqual(duplicateStatus.failed_unit_details[0]?.error_codes, [
    "duplicate_source_content",
  ]);
  assert.doesNotMatch(formatIngestStatus(duplicateStatus), /hidden paths/u);
});

test("status counts unsupported source files without leaking vendor names or paths", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-skipped-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const regionDir = path.join(rootDir, "agency", "jeju");
  const uncoveredVendorDir = path.join(regionDir, "실제대행사이름");
  await mkdir(uncoveredVendorDir, { recursive: true });
  await writeFile(path.join(regionDir, "sample-vendor.docx"), "generated source fixture");
  await writeFile(path.join(regionDir, "sample-vendor.csv"), "업체명,위약금\n샘플,전액");
  await writeFile(path.join(uncoveredVendorDir, "제휴업체.csv"), "업체명,가격\n샘플,1000");
  await writeFile(path.join(uncoveredVendorDir, "가격표.jpg"), "dummy-jpeg");

  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  const status = await getIngestStatus({ stateDir });
  assert.equal(status.skipped_source_files, 3);
  assert.equal(
    status.skipped_uncovered_source_files,
    2,
    "the vendor folder with no convertible file must be counted as uncovered",
  );
  assert.deepEqual(status.skipped_source_files_by_extension, { csv: 2, jpg: 1 });

  const table = formatIngestStatus(status);
  assert.match(table, /Unsupported source files: 3/u);
  assert.match(table, /csv=2/u);
  assert.doesNotMatch(table, /실제대행사이름|제휴업체|가격표/u);
});
