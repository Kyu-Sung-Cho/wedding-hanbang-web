import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import JSZip from "jszip";
import sharp from "sharp";
import * as XLSX from "xlsx";

import { canonicalJsonSha256ExcludingField } from "../artifact-integrity.js";
import { convertManifest } from "../convert.js";
import {
  extractFixedEightWithScriptedProviderForTests,
  planExtractionForTests,
} from "../extract.js";
import {
  extractLocalCandidates,
  LocalCandidateArtifactSchema,
  LocalCandidateReceiptSchema,
  summarizePaidLocalCandidateDiff,
} from "../local-candidate.js";
import { readJsonFile, sha256File, writeJsonFile } from "../io.js";
import { initializePaidExecutionDomainForTests } from "../paid-execution-domain.js";
import { FIXED_EIGHT_ORDERED_UNIT_IDS } from "../pilot-pass-receipt.js";
import { scanSources } from "../scan.js";
import { DisclosureExtractionSchema, IngestManifestSchema } from "../schemas.js";
import { scoreExtractionAgainstGroundTruth } from "../score.js";
import type { IngestManifest, ManifestUnit } from "../types.js";

const execFileAsync = promisify(execFile);
const tsxImport = pathToFileURL(
  createRequire(path.join(process.cwd(), "package.json")).resolve("tsx"),
).href;

interface PaidFixture {
  temporaryRoot: string;
  cliRoot: string;
  rootDir: string;
  stateDir: string;
  authorityRoot: string;
  manifest: IngestManifest;
  xlsxUnit: ManifestUnit;
  docxUnit: ManifestUnit;
  pngUnit: ManifestUnit;
}

function paidResponse(name: string) {
  return DisclosureExtractionSchema.parse({
    doc_kind: "agency_disclosure",
    business_name: name,
    region_hint: "seoul",
    agency_packages: [],
    partner_vendors: [],
    halls: [],
    sections: [],
    money_occurrences: [],
    hall: {
      venue_fee_krw: null,
      meal_price_min_krw: null,
      meal_price_max_krw: null,
      venue_fee_source_quote: null,
      meal_price_source_quote: null,
      venue_fee_source_file_ids: [],
      meal_price_source_file_ids: [],
      items: [],
      confidence: 0,
      needs_review: true,
    },
    extraction_notes: "scripted production-paid fixture",
  });
}

test("semantic candidate comparison excludes review trust metadata while preserving exact differences", () => {
  const paid = paidResponse("Semantic Fixture");
  const local = structuredClone(paid);
  local.hall.confidence = 0.99;
  local.hall.needs_review = false;
  local.extraction_notes = "local deterministic review note";

  const summary = summarizePaidLocalCandidateDiff(paid, local);

  assert.equal(summary.exact_representation_match, false);
  assert.equal(summary.field_differences.length, 3);
  assert.equal(summary.semantic_representation_match, true);
  assert.deepEqual(summary.semantic_field_differences, []);
  assert.equal(summary.trust_metadata_difference_count, 3);
  assert.deepEqual(summary.semantic_difference_counts, {
    identity_and_linkage: 0,
    pricing: 0,
    other_domain: 0,
  });
});

test("semantic candidate comparison separates vendor linkage and price differences", () => {
  const paid = paidResponse("Semantic Fixture");
  paid.partner_vendors.push({
    vendor_name: "Fixture Studio",
    old_names: [],
    category: "studio",
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    base_spec: null,
    price_note: null,
    options: [],
    policies: [],
    source_quote: "Fixture Studio 120만원",
    source_file_ids: [],
    confidence: 0.8,
    needs_review: true,
  });
  const local = structuredClone(paid);
  local.partner_vendors[0]!.category = "dress";
  local.partner_vendors[0]!.price_min_krw = 1_300_000;
  local.partner_vendors[0]!.confidence = 0.95;

  const summary = summarizePaidLocalCandidateDiff(paid, local);

  assert.equal(summary.exact_representation_match, false);
  assert.equal(summary.semantic_representation_match, false);
  assert.deepEqual(
    summary.semantic_field_differences.map((difference) => difference.path),
    ["/partner_vendors/0/category", "/partner_vendors/0/price_min_krw"],
  );
  assert.equal(summary.trust_metadata_difference_count, 1);
  assert.deepEqual(summary.semantic_difference_counts, {
    identity_and_linkage: 1,
    pricing: 1,
    other_domain: 0,
  });
});

async function writeWorkbook(filePath: string, index: number): Promise<void> {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["사업자명", "기본가격"],
    [`Fixture Studio ${index}`, "기본 120만원"],
  ]), "스튜디오");
  XLSX.writeFile(workbook, filePath);
}

async function writeDocx(filePath: string): Promise<void> {
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
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>기본 패키지 290만원</w:t></w:r></w:p></w:body></w:document>',
  );
  await writeFile(filePath, await docx.generateAsync({ type: "nodebuffer" }));
}

async function createPaidFixture(): Promise<PaidFixture> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-candidate-"));
  const cliRoot = path.join(temporaryRoot, "cli");
  const rootDir = path.join(temporaryRoot, "raw");
  const stateDir = path.join(cliRoot, "scripts", "ingest", ".state", "fixture");
  const authorityRoot = path.join(temporaryRoot, "authority");
  const regionDir = path.join(rootDir, "agency", "강남");
  await mkdir(regionDir, { recursive: true });
  for (let index = 0; index < 6; index += 1) {
    await writeWorkbook(path.join(regionDir, `candidate-${index}.xlsx`), index);
  }
  await writeDocx(path.join(regionDir, "candidate-6.docx"));
  await sharp({
    create: { width: 16, height: 16, channels: 3, background: "white" },
  }).png().toFile(path.join(regionDir, "candidate-7.png"));

  const scanned = await scanSources({
    rootDir,
    stateDir,
    agencyDir: "agency",
    hallDir: "hall",
  });
  scanned.units.sort((left, right) => left.display_name.localeCompare(right.display_name, "en"));
  scanned.units.forEach((unit, index) => {
    unit.unit_id = FIXED_EIGHT_ORDERED_UNIT_IDS[index] as string;
  });
  await writeJsonFile(path.join(stateDir, "manifest.json"), scanned);
  const converted = await convertManifest({ stateDir });
  await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const options = {
    stateDir,
    unitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    enforcePilotAuthorization: true,
  };
  const plan = await planExtractionForTests(options, {}, { authorityRoot });
  assert.match(plan.approval_plan_sha256 ?? "", /^[a-f0-9]{64}$/u);
  const completed = await extractFixedEightWithScriptedProviderForTests(
    { ...options, approvedPlanSha256: plan.approval_plan_sha256 as string },
    {
      responsesByCanonicalName: Object.fromEntries(converted.units.map((unit) => [
        unit.parsed.raw_name,
        paidResponse(unit.parsed.raw_name),
      ])),
      inputTokens: 7,
      outputTokens: 3,
      requestIdPrefix: "local-candidate-fixture",
    },
    { env: {}, paidExecutionDomainAuthorityRoot: authorityRoot },
  );
  const manifest = completed.manifest;
  const xlsxUnit = manifest.units.find((unit) => unit.source_files[0]?.ext === "xlsx")!;
  const docxUnit = manifest.units.find((unit) => unit.source_files[0]?.ext === "docx")!;
  const pngUnit = manifest.units.find((unit) => unit.source_files[0]?.ext === "png")!;
  assert.ok(xlsxUnit?.extraction?.provider_mode === "production_paid");
  assert.ok(docxUnit?.extraction?.provider_mode === "production_paid");
  assert.ok(pngUnit?.extraction?.provider_mode === "production_paid");

  const validationPath = path.join(stateDir, "validated", `${xlsxUnit.unit_id}.json`);
  await writeJsonFile(validationPath, { sentinel: "must remain immutable" });
  xlsxUnit.stage = "validated";
  xlsxUnit.validation = {
    fingerprint: "a".repeat(64),
    content_sha256: "b".repeat(64),
    extraction_content_sha256: xlsxUnit.extraction.content_sha256,
    validator_version: "fixture-validator",
    artifact_path: validationPath,
    review_status: "pending",
    issue_count: 0,
    validated_at: new Date(0).toISOString(),
  };
  await writeJsonFile(path.join(stateDir, "manifest.json"), manifest);
  return {
    temporaryRoot,
    cliRoot,
    rootDir,
    stateDir,
    authorityRoot,
    manifest,
    xlsxUnit,
    docxUnit,
    pngUnit,
  };
}

test("local candidate generation writes review-only sidecars without changing active paid state", async (t) => {
  const fixture = await createPaidFixture();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const ledgerPath = path.join(fixture.stateDir, ".cache", "ai-ledger.ndjson");
  const validationPath = fixture.xlsxUnit.validation!.artifact_path;
  const paidCachePath = fixture.xlsxUnit.extraction!.artifact_path;
  const before = {
    manifest: await readFile(manifestPath, "utf8"),
    ledger: await readFile(ledgerPath, "utf8"),
    ledgerSha256: (await sha256File(ledgerPath)).sha256,
    validation: await readFile(validationPath, "utf8"),
    paidCache: await readFile(paidCachePath, "utf8"),
  };

  const result = await extractLocalCandidates({
    stateDir: fixture.stateDir,
    unitIds: [fixture.xlsxUnit.unit_id],
  });

  assert.equal(result.selected_units, 1);
  assert.equal(result.processed_units, 1);
  assert.equal(result.failed_units, 0);
  assert.equal(result.cache_hits, 0);
  assert.equal(result.cost_usd, 0);
  assert.equal(result.input_tokens, 0);
  assert.equal(result.output_tokens, 0);
  assert.equal(await readFile(manifestPath, "utf8"), before.manifest);
  assert.equal(await readFile(ledgerPath, "utf8"), before.ledger);
  assert.equal(await readFile(validationPath, "utf8"), before.validation);
  assert.equal(await readFile(paidCachePath, "utf8"), before.paidCache);

  const candidate = LocalCandidateArtifactSchema.parse(
    await readJsonFile(result.candidates[0]!.artifact_path),
  );
  const receipt = LocalCandidateReceiptSchema.parse(
    await readJsonFile(result.candidates[0]!.receipt_path),
  );
  assert.match(result.candidates[0]!.artifact_path, /\.cache[\\/]extract-local-candidates[\\/][a-f0-9]{64}\.json$/u);
  assert.match(result.candidates[0]!.receipt_path, /\.cache[\\/]extract-local-candidate-receipts[\\/][a-f0-9]{64}\.json$/u);
  assert.equal(candidate.schema_version, 2);
  assert.equal(receipt.schema_version, 2);
  assert.equal(candidate.provider_mode, "local_deterministic");
  assert.equal(candidate.model, "local-deterministic-v1");
  assert.equal(candidate.paid_extraction.provider_mode, "production_paid");
  assert.equal(candidate.paid_extraction.content_sha256, fixture.xlsxUnit.extraction!.content_sha256);
  assert.match(candidate.paid_extraction.verified_finalization_contract, /^v\d+/u);
  assert.equal(candidate.review_status, "pending");
  assert.equal(candidate.needs_review, true);
  assert.equal(candidate.bulk_approval_eligible, false);
  assert.equal(candidate.adoption_status, "blocked_human_review_required");
  assert.equal(candidate.estimated_cost_usd, 0);
  assert.equal(candidate.input_tokens, 0);
  assert.equal(candidate.output_tokens, 0);
  assert.deepEqual(candidate.validation_summary, receipt.validation_summary);
  assert.deepEqual(candidate.validation_issues, receipt.validation_issues);
  assert.deepEqual(candidate.coverage_gaps, receipt.coverage_gaps);
  assert.deepEqual(candidate.field_diff_summary, receipt.field_diff_summary);
  assert.ok(candidate.field_diff_summary.field_differences.length > 0);
  assert.ok(candidate.field_diff_summary.semantic_field_differences.length > 0);
  assert.ok(candidate.field_diff_summary.field_differences.every((entry) =>
    entry.path.startsWith("/")
    && (entry.paid_value_sha256 !== null || entry.local_value_sha256 !== null)
  ));
  assert.ok(receipt.hard_hold_reasons.includes("human_review_required"));
  assert.ok(receipt.hard_hold_reasons.includes("paid_local_semantic_diff"));
  assert.equal(receipt.hard_hold_reasons.includes("paid_local_representation_diff"), false);
  assert.match(candidate.content_sha256, /^[a-f0-9]{64}$/u);
  assert.match(receipt.content_sha256, /^[a-f0-9]{64}$/u);
  assert.equal((await sha256File(ledgerPath)).sha256, before.ledgerSha256);
});

test("local candidate replay is deterministic and reuses both content-addressed sidecars", async (t) => {
  const fixture = await createPaidFixture();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const options = { stateDir: fixture.stateDir, unitIds: [fixture.xlsxUnit.unit_id] };

  const first = await extractLocalCandidates(options);
  const artifactBefore = await readFile(first.candidates[0]!.artifact_path, "utf8");
  const receiptBefore = await readFile(first.candidates[0]!.receipt_path, "utf8");
  const second = await extractLocalCandidates(options);

  assert.equal(first.cache_hits, 0);
  assert.equal(second.cache_hits, 1);
  assert.equal(second.processed_units, 1);
  assert.equal(second.candidates[0]!.artifact_path, first.candidates[0]!.artifact_path);
  assert.equal(second.candidates[0]!.receipt_path, first.candidates[0]!.receipt_path);
  assert.equal(await readFile(second.candidates[0]!.artifact_path, "utf8"), artifactBefore);
  assert.equal(await readFile(second.candidates[0]!.receipt_path, "utf8"), receiptBefore);
  assert.equal(
    (await readdir(path.join(fixture.stateDir, ".cache", "extract-local-candidates"))).length,
    1,
  );
  assert.equal(
    (await readdir(path.join(fixture.stateDir, ".cache", "extract-local-candidate-receipts"))).length,
    1,
  );
});

test("ground-truth scoring falls back to an exact current schema-v2 local candidate", async (t) => {
  const fixture = await createPaidFixture();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const result = await extractLocalCandidates({
    stateDir: fixture.stateDir,
    unitIds: [fixture.xlsxUnit.unit_id],
  });
  const candidatePath = result.candidates[0]!.artifact_path;
  const candidate = LocalCandidateArtifactSchema.parse(await readJsonFile(candidatePath));
  const occurrence = candidate.data.money_occurrences[0];
  assert.ok(occurrence, "fixture must produce a candidate money occurrence");
  const groundTruthPath = path.join(fixture.stateDir, "candidate-ground-truth.json");
  await writeJsonFile(groundTruthPath, {
    generated_at: new Date(0).toISOString(),
    units: [{
      unit_id: fixture.xlsxUnit.unit_id,
      display_name: fixture.xlsxUnit.display_name,
      source_paths: fixture.xlsxUnit.source_files.map((source) => source.path),
      candidate_count: 1,
      candidates: [{
        raw: String(occurrence.amount_krw),
        krw: occurrence.amount_krw,
        line_context: occurrence.source_quote,
        source_locator: "manual:1",
      }],
    }],
  });
  const scoreOptions = {
    stateDir: fixture.stateDir,
    unitIds: [fixture.xlsxUnit.unit_id],
    groundTruthPath,
    expectedGroundTruthSha256: (await sha256File(groundTruthPath)).sha256,
    expectedOccurrenceCount: 1,
    requireValidatedArtifacts: true,
    candidateSource: "local" as const,
  };

  const report = await scoreExtractionAgainstGroundTruth(scoreOptions);
  const unitReport = (report.units as Array<Record<string, unknown>>)[0]!;
  assert.notEqual(unitReport.status, "blocked", JSON.stringify(unitReport));
  assert.equal(unitReport.model, "local-deterministic-v1");
  assert.equal(
    (unitReport.provenance as Record<string, unknown>).candidate_source,
    "local_candidate_sidecar",
  );
  assert.equal((report.gate as Record<string, unknown>).eligible_for_25_unit_batch, false);

  const { stdout } = await execFileAsync(process.execPath, [
    "--import",
    tsxImport,
    path.join(process.cwd(), "scripts", "ingest", "index.ts"),
    "score",
    "--state-dir",
    fixture.stateDir,
    "--candidate-source",
    "local",
    "--units",
    fixture.xlsxUnit.unit_id,
    "--ground-truth",
    groundTruthPath,
    "--ground-truth-sha256",
    scoreOptions.expectedGroundTruthSha256,
    "--expected-occurrences",
    "1",
  ], { cwd: fixture.cliRoot });
  const cliOutput = JSON.parse(stdout) as {
    report: { verification: { mode: string; paid_plan_sha256: string | null } };
  };
  assert.equal(cliOutput.report.verification.mode, "strict_local_review_artifacts");
  assert.equal(cliOutput.report.verification.paid_plan_sha256, null);

  const forged = await readJsonFile(candidatePath) as Record<string, unknown> & {
    local_engine: Record<string, unknown>;
  };
  forged.local_engine.engine_version = "stale-local-engine";
  forged.content_sha256 = canonicalJsonSha256ExcludingField(forged, "content_sha256");
  await writeJsonFile(candidatePath, forged);
  const blocked = await scoreExtractionAgainstGroundTruth(scoreOptions);
  const blockedUnit = (blocked.units as Array<Record<string, unknown>>)[0]!;
  assert.equal(blockedUnit.status, "blocked");
  assert.match(String((blockedUnit.blockers as string[])[0]), /^local_candidate_artifact:/u);
});

test("a changed source blocks candidate replay without mutating active metadata", async (t) => {
  const fixture = await createPaidFixture();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const options = { stateDir: fixture.stateDir, unitIds: [fixture.xlsxUnit.unit_id] };
  const first = await extractLocalCandidates(options);
  assert.equal(first.processed_units, 1);
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifestBefore = await readFile(manifestPath, "utf8");
  const candidateBefore = await readFile(first.candidates[0]!.artifact_path, "utf8");

  await writeFile(fixture.xlsxUnit.source_files[0]!.absolute_path, "changed source bytes", "utf8");
  const blocked = await extractLocalCandidates(options);

  assert.equal(blocked.processed_units, 0);
  assert.equal(blocked.failed_units, 1);
  assert.deepEqual(blocked.candidates, []);
  assert.match(blocked.failures[0]!.error, /source|provenance|changed|hash|변경/iu);
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
  assert.equal(await readFile(first.candidates[0]!.artifact_path, "utf8"), candidateBefore);
});

test("changed converted evidence blocks an existing candidate cache", async (t) => {
  const fixture = await createPaidFixture();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const options = { stateDir: fixture.stateDir, unitIds: [fixture.xlsxUnit.unit_id] };
  const first = await extractLocalCandidates(options);
  assert.equal(first.processed_units, 1);
  const candidateBefore = await readFile(first.candidates[0]!.artifact_path, "utf8");

  await writeFile(fixture.xlsxUnit.conversion!.text_artifacts[0]!, "changed conversion", "utf8");
  const blocked = await extractLocalCandidates(options);

  assert.equal(blocked.processed_units, 0);
  assert.equal(blocked.failed_units, 1);
  assert.match(blocked.failures[0]!.error, /artifact|conversion|changed|hash|변경/iu);
  assert.equal(await readFile(first.candidates[0]!.artifact_path, "utf8"), candidateBefore);
});

test("a self-rehashed forged paid cache is rejected by full finalization replay", async (t) => {
  const fixture = await createPaidFixture();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const paidCachePath = fixture.xlsxUnit.extraction!.artifact_path;
  const raw = await readJsonFile(paidCachePath);
  assert.ok(typeof raw === "object" && raw !== null && !Array.isArray(raw));
  const paidArtifact = raw as Record<string, unknown>;
  assert.ok(typeof paidArtifact.data === "object" && paidArtifact.data !== null);
  (paidArtifact.data as Record<string, unknown>).business_name = "self-rehashed forged paid data";
  paidArtifact.content_sha256 = canonicalJsonSha256ExcludingField(
    paidArtifact,
    "content_sha256",
  );
  await writeJsonFile(paidCachePath, paidArtifact);
  const attackedManifest = IngestManifestSchema.parse(await readJsonFile(manifestPath));
  const attackedUnit = attackedManifest.units.find(
    (unit) => unit.unit_id === fixture.xlsxUnit.unit_id,
  )!;
  attackedUnit.extraction!.content_sha256 = paidArtifact.content_sha256 as string;
  await writeJsonFile(manifestPath, attackedManifest);
  const manifestBefore = await readFile(manifestPath, "utf8");
  const paidCacheBefore = await readFile(paidCachePath, "utf8");

  const blocked = await extractLocalCandidates({
    stateDir: fixture.stateDir,
    unitIds: [fixture.xlsxUnit.unit_id],
  });

  assert.equal(blocked.processed_units, 0);
  assert.equal(blocked.failed_units, 1);
  assert.deepEqual(blocked.candidates, []);
  assert.match(blocked.failures[0]!.error, /finalization|replay|cache_invalid/iu);
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
  assert.equal(await readFile(paidCachePath, "utf8"), paidCacheBefore);
});

test("non-XLSX and unread image evidence remain explicit hard holds", async (t) => {
  const fixture = await createPaidFixture();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const result = await extractLocalCandidates({
    stateDir: fixture.stateDir,
    unitIds: [fixture.docxUnit.unit_id, fixture.pngUnit.unit_id],
  });

  assert.equal(result.processed_units, 2);
  assert.equal(result.failed_units, 0);
  const docx = result.candidates.find((candidate) => candidate.unit_id === fixture.docxUnit.unit_id)!;
  const png = result.candidates.find((candidate) => candidate.unit_id === fixture.pngUnit.unit_id)!;
  assert.ok(docx.hard_hold_reasons.includes("human_review_required"));
  assert.ok(docx.hard_hold_reasons.includes("non_xlsx_format:docx"));
  assert.ok(png.hard_hold_reasons.includes("human_review_required"));
  assert.ok(png.hard_hold_reasons.includes("non_xlsx_format:png"));
  assert.ok(png.hard_hold_reasons.includes("image_evidence_unread"));
  const docxArtifact = LocalCandidateArtifactSchema.parse(await readJsonFile(docx.artifact_path));
  const pngReceipt = LocalCandidateReceiptSchema.parse(await readJsonFile(png.receipt_path));
  assert.equal(docxArtifact.adoption_status, "blocked_human_review_required");
  assert.equal(pngReceipt.adoption_status, "blocked_human_review_required");
  assert.equal(docxArtifact.bulk_approval_eligible, false);
  assert.equal(pngReceipt.bulk_approval_eligible, false);
});

test("the explicit extract local-candidates CLI cannot fall through to active extraction", async (t) => {
  const fixture = await createPaidFixture();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifestBefore = await readFile(manifestPath, "utf8");

  const { stdout } = await execFileAsync(process.execPath, [
    "--import",
    tsxImport,
    path.join(process.cwd(), "scripts", "ingest", "index.ts"),
    "extract",
    "local-candidates",
    "--state-dir",
    fixture.stateDir,
    "--units",
    fixture.xlsxUnit.unit_id,
  ], { cwd: fixture.cliRoot });
  const output = JSON.parse(stdout) as {
    command: string;
    operation: string;
    mode: string;
    cost_usd: number;
    processed_units: number;
    failed_units: number;
  };

  assert.equal(output.command, "extract");
  assert.equal(output.operation, "local-candidates");
  assert.equal(output.mode, "local_deterministic");
  assert.equal(output.cost_usd, 0);
  assert.equal(output.processed_units, 1);
  assert.equal(output.failed_units, 0);
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);

  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import",
      tsxImport,
      path.join(process.cwd(), "scripts", "ingest", "index.ts"),
      "extract",
      "local-candidate-typo",
      "--state-dir",
      fixture.stateDir,
    ], { cwd: fixture.cliRoot }),
    /unknown_extract_operation:local-candidate-typo/u,
  );
});
