import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonSha256ExcludingField } from "../artifact-integrity.js";
import { CONVERTER_VERSION } from "../convert.js";
import { SOURCE_MONEY_SCANNER_VERSION } from "../extraction-contract.js";
import { acquireExtractionLock } from "../extraction-lock.js";
import { readJsonFile, sha256File, sha256Text, writeJsonFile } from "../io.js";
import {
  LOCAL_DETERMINISTIC_ENGINE_HASH,
  LOCAL_DETERMINISTIC_ENGINE_VERSION,
  LOCAL_DETERMINISTIC_MODEL,
} from "../local-extraction-contract.js";
import {
  extractManifestLocally,
  selectLocalExtractionUnits,
  verifyCurrentLocalExtractionCacheForUnit,
} from "../local-extraction-runner.js";
import { SCANNER_PARSER_VERSION } from "../scan.js";
import {
  validateManifest,
  verifyCurrentLocalValidatedArtifactForUnit,
} from "../validate.js";
import type { IngestManifest, ManifestUnit, SourceExtension } from "../types.js";
import {
  visualTranscriptionEvidenceId,
  visualTranscriptionSidecarPath,
} from "../visual-transcription-sidecar.js";

const execFileAsync = promisify(execFile);
const tsxImport = pathToFileURL(
  createRequire(path.join(process.cwd(), "package.json")).resolve("tsx"),
).href;

test("local extraction cache identity is bound to the source-money scanner contract", () => {
  assert.match(LOCAL_DETERMINISTIC_ENGINE_VERSION, /^v[1-9]\d+-/u);
  assert.equal(
    LOCAL_DETERMINISTIC_ENGINE_HASH,
    sha256Text([
      LOCAL_DETERMINISTIC_MODEL,
      LOCAL_DETERMINISTIC_ENGINE_VERSION,
      SOURCE_MONEY_SCANNER_VERSION,
      "no-network",
      "no-provider",
      "pending-only",
    ].join("\0")),
  );
});

async function localFixture(stateDirOverride?: string): Promise<{
  rootDir: string;
  stateDir: string;
  rawPath: string;
  convertedPath: string;
  manifest: IngestManifest;
}> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-extract-"));
  const rootDir = path.join(temporaryRoot, "raw");
  const stateDir = stateDirOverride ?? path.join(temporaryRoot, "state");
  const rawPath = path.join(rootDir, "agency", "seoul", "sample.xlsx");
  const sourceFingerprint = sha256Text("fixture-source-fingerprint");
  const unitId = sha256Text("fixture-unit");
  const convertedPath = path.join(
    stateDir,
    ".converted",
    unitId,
    sourceFingerprint,
    "content.txt",
  );
  await mkdir(path.dirname(rawPath), { recursive: true });
  await mkdir(path.dirname(convertedPath), { recursive: true });
  await writeFile(rawPath, "immutable source", "utf8");
  await writeFile(convertedPath, [
    "## 시트: 스튜디오",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!A4: 해피스튜디오",
    "스튜디오!B4: 기본 120만원",
  ].join("\n"), "utf8");
  const sourceDigest = await sha256File(rawPath);
  const convertedDigest = await sha256File(convertedPath);
  const artifactFingerprint = sha256Text(
    `${path.resolve(convertedPath)}\0${convertedDigest.sha256}`,
  );
  const manifest: IngestManifest = {
    schema_version: 1,
    scanner_parser_version: SCANNER_PARSER_VERSION,
    root_dir: rootDir,
    state_dir: stateDir,
    scanned_at: new Date(0).toISOString(),
    skipped_sources: [],
    units: [{
      unit_id: unitId,
      display_name: "sample.xlsx",
      parsed: {
        region_code: "seoul",
        raw_name: "샘플웨딩",
        normalized_name: "샘플웨딩",
        corporate_name: null,
        kind_hint: "agency",
      },
      source_files: [{
        path: "agency/seoul/sample.xlsx",
        absolute_path: rawPath,
        ext: "xlsx",
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
        text_characters: (await readFile(convertedPath, "utf8")).length,
        cell_count: 4,
        artifact_fingerprint: artifactFingerprint,
        converted_at: new Date(0).toISOString(),
      },
    }],
  };
  await writeJsonFile(path.join(stateDir, "manifest.json"), manifest);
  return { rootDir, stateDir, rawPath, convertedPath, manifest };
}

async function ocrReviewFixture(sharedImageContent = true): Promise<{
  rootDir: string;
  stateDir: string;
  ocrPath: string;
  firstRawPath: string;
  firstImagePath: string;
  manifest: IngestManifest;
}> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-ocr-provenance-"));
  const rootDir = path.join(temporaryRoot, "raw");
  const stateDir = path.join(temporaryRoot, "state");
  const unitId = sha256Text("ambiguous-shared-ocr-unit");
  const sourceFingerprint = sha256Text("ambiguous-shared-ocr-source-fingerprint");
  const conversionRoot = path.join(stateDir, ".converted", unitId, sourceFingerprint);
  const firstRawPath = path.join(rootDir, "hall", "seoul", "terms.pdf");
  const secondRawPath = path.join(rootDir, "hall", "seoul", "prices.pdf");
  const firstTextPath = path.join(conversionRoot, "1-pdf.txt");
  const secondTextPath = path.join(conversionRoot, "2-pdf.txt");
  const firstImagePath = path.join(conversionRoot, "1-pdf-pages", "page-1.png");
  const secondImagePath = path.join(conversionRoot, "2-pdf-pages", "page-1.png");
  const ocrPath = path.join(conversionRoot, "ocr-review", "001-ocr-review.txt");
  await Promise.all([
    mkdir(path.dirname(firstRawPath), { recursive: true }),
    mkdir(path.dirname(firstTextPath), { recursive: true }),
    mkdir(path.dirname(firstImagePath), { recursive: true }),
    mkdir(path.dirname(secondImagePath), { recursive: true }),
    mkdir(path.dirname(ocrPath), { recursive: true }),
  ]);
  await writeFile(firstRawPath, "immutable terms source", "utf8");
  await writeFile(secondRawPath, "immutable price source", "utf8");
  await writeFile(firstTextPath, "이용 약관", "utf8");
  await writeFile(secondTextPath, "호텔 예식 가격표", "utf8");
  await writeFile(firstImagePath, "same-raster-content", "utf8");
  await writeFile(
    secondImagePath,
    sharedImageContent ? "same-raster-content" : "different-raster-content",
    "utf8",
  );
  const sharedImageDigest = await sha256File(firstImagePath);
  const ocrText = [
    "[OCR_REVIEW_ONLY]",
    "contract_version: fixture",
    `source_image_sha256: ${sharedImageDigest.sha256}`,
    "page: 1",
    "engine_name: Windows.Media.Ocr",
    "ocr:page:1:line:1: 공유 OCR 대관료 3,300,000원",
  ].join("\n");
  await writeFile(ocrPath, ocrText, "utf8");

  const firstRawDigest = await sha256File(firstRawPath);
  const secondRawDigest = await sha256File(secondRawPath);
  const allArtifacts = [
    firstTextPath,
    secondTextPath,
    firstImagePath,
    secondImagePath,
    ocrPath,
  ].sort((left, right) => left.localeCompare(right, "en"));
  const artifactFingerprint = sha256Text((await Promise.all(allArtifacts.map(async (artifactPath) => {
    const digest = await sha256File(artifactPath);
    return `${path.resolve(artifactPath)}\0${digest.sha256}`;
  }))).join("\n"));
  const manifest: IngestManifest = {
    schema_version: 1,
    scanner_parser_version: SCANNER_PARSER_VERSION,
    root_dir: rootDir,
    state_dir: stateDir,
    scanned_at: new Date(0).toISOString(),
    skipped_sources: [],
    units: [{
      unit_id: unitId,
      display_name: "shared-ocr",
      parsed: {
        region_code: "seoul",
        raw_name: "공유 OCR",
        normalized_name: "공유 OCR",
        corporate_name: null,
        kind_hint: "hall",
      },
      source_files: [{
        path: "hall/seoul/terms.pdf",
        absolute_path: firstRawPath,
        ext: "pdf",
        sha256: firstRawDigest.sha256,
        bytes: firstRawDigest.bytes,
      }, {
        path: "hall/seoul/prices.pdf",
        absolute_path: secondRawPath,
        ext: "pdf",
        sha256: secondRawDigest.sha256,
        bytes: secondRawDigest.bytes,
      }],
      source_fingerprint: sourceFingerprint,
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: CONVERTER_VERSION,
        source_fingerprint: sourceFingerprint,
        text_artifacts: [firstTextPath, secondTextPath, ocrPath],
        image_artifacts: [firstImagePath, secondImagePath],
        text_characters: "이용 약관호텔 예식 가격표".length + ocrText.length,
        cell_count: 0,
        artifact_fingerprint: artifactFingerprint,
        converted_at: new Date(0).toISOString(),
        ocr_review: {
          contract_version: "fixture",
          contract_hash: "a".repeat(64),
          language: "ko-KR",
          review_only: true,
          authoritative: false,
          bulk_approval_eligible: false,
          artifacts: [{
            artifact_path: ocrPath,
            source_image_sha256: sharedImageDigest.sha256,
            page: 1,
            engine_name: "Windows.Media.Ocr",
            engine_version: "fixture",
            engine_hash: "b".repeat(64),
            line_count: 1,
          }],
        },
      },
    }],
  };
  await writeJsonFile(path.join(stateDir, "manifest.json"), manifest);
  return { rootDir, stateDir, ocrPath, firstRawPath, firstImagePath, manifest };
}

async function writeUnconfirmedVisualSidecar(
  fixture: Awaited<ReturnType<typeof ocrReviewFixture>>,
  recordedAt: string,
): Promise<{ sidecarPath: string; contentSha256: string }> {
  const unit = fixture.manifest.units[0]!;
  const source = unit.source_files[0]!;
  const imageDigest = await sha256File(fixture.firstImagePath);
  const sourceFileId = sha256Text(`${source.path}\0${source.sha256}`);
  const evidenceId = visualTranscriptionEvidenceId({
    source_file_id: sourceFileId,
    image_sha256: imageDigest.sha256,
    page: 1,
  });
  const sidecar = {
    schema_version: 1 as const,
    artifact_kind: "visual_transcription_sidecar" as const,
    content_sha256: "0".repeat(64),
    unit_id: unit.unit_id,
    source_fingerprint: unit.source_fingerprint,
    conversion_artifact_fingerprint: unit.conversion!.artifact_fingerprint,
    source_files: unit.source_files.map((candidate) => ({
      path: candidate.path,
      sha256: candidate.sha256,
      bytes: candidate.bytes,
    })),
    reviewer: {
      kind: "codex_assisted_unconfirmed" as const,
      recorded_at: recordedAt,
    },
    review_status: "pending" as const,
    needs_review: true as const,
    bulk_approval_eligible: false as const,
    evidence: [{
      evidence_id: evidenceId,
      evidence_kind: "visual_transcription" as const,
      source_file_id: sourceFileId,
      source_sha256: source.sha256,
      source_bytes: source.bytes,
      image_artifact_index: 0,
      image_sha256: imageDigest.sha256,
      image_bytes: imageDigest.bytes,
      page: 1,
    }],
    record_evidence: [],
    coverage_gaps: [],
    fragment: {
      doc_kind: "unknown" as const,
      agency_packages: [],
      partner_vendors: [],
      halls: [],
      sections: [],
      money_occurrences: [],
    },
    created_at: recordedAt,
  };
  sidecar.content_sha256 = canonicalJsonSha256ExcludingField(sidecar, "content_sha256");
  const sidecarPath = visualTranscriptionSidecarPath(fixture.stateDir, unit);
  await writeJsonFile(sidecarPath, sidecar);
  return { sidecarPath, contentSha256: sidecar.content_sha256 };
}

function selectableUnit(
  id: string,
  ext: SourceExtension,
  kindHint: "agency" | "hall",
  textCharacters = 1_000,
): ManifestUnit {
  return {
    unit_id: id.repeat(64),
    display_name: `${id}.${ext}`,
    parsed: {
      region_code: "seoul",
      raw_name: id,
      normalized_name: id,
      corporate_name: null,
      kind_hint: kindHint,
    },
    source_files: [{
      path: `${kindHint}/${id}.${ext}`,
      absolute_path: `C:/${kindHint}/${id}.${ext}`,
      ext,
      sha256: id.repeat(64),
      bytes: 1,
    }],
    source_fingerprint: id.repeat(64),
    stage: "converted",
    notices: [],
    conversion: {
      converter_version: "fixture",
      source_fingerprint: id.repeat(64),
      text_artifacts: [`C:/${id}.txt`],
      image_artifacts: ext === "png" ? [`C:/${id}.png`] : [],
      text_characters: textCharacters,
      cell_count: 1,
      artifact_fingerprint: id.repeat(64),
      converted_at: new Date(0).toISOString(),
    },
  };
}

test("local limit selection is format-stratified and fixed unit selection preserves order", () => {
  const manifest = {
    units: [
      selectableUnit("f", "xlsx", "agency"),
      selectableUnit("e", "xlsx", "hall"),
      selectableUnit("d", "pdf", "agency"),
      selectableUnit("c", "docx", "agency"),
      selectableUnit("b", "png", "agency", 0),
      selectableUnit("a", "xlsx", "agency"),
    ],
  } as IngestManifest;

  assert.deepEqual(
    selectLocalExtractionUnits(manifest, { limit: 5 }).map((unit) => unit.unit_id),
    ["b", "c", "d", "e", "a"].map((id) => id.repeat(64)),
  );
  assert.deepEqual(
    selectLocalExtractionUnits(manifest, {
      unitIds: ["f".repeat(64), "b".repeat(64)],
    }).map((unit) => unit.unit_id),
    ["f".repeat(64), "b".repeat(64)],
  );
  assert.throws(
    () => selectLocalExtractionUnits(manifest, { unitIds: ["9".repeat(64)] }),
    /unknown_unit_id/u,
  );
});

test("local selection refreshes a validated unit only when its engine is stale", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  const unit = extracted.manifest.units[0]!;
  unit.stage = "validated";

  assert.deepEqual(selectLocalExtractionUnits(extracted.manifest, {}), []);

  unit.local_extraction!.engine_version = "stale-local-engine";
  unit.local_extraction!.engine_hash = "f".repeat(64);
  assert.deepEqual(
    selectLocalExtractionUnits(extracted.manifest, {}).map((row) => row.unit_id),
    [unit.unit_id],
  );
});

test("explicit units refreshes a validated unit when a verified visual sidecar is added", async (t) => {
  const fixture = await ocrReviewFixture(false);
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const unit = validated.units[0]!;
  assert.equal(unit.stage, "validated");
  assert.equal(unit.local_extraction?.visual_transcription, undefined);
  const previousFingerprint = unit.local_extraction!.fingerprint;

  const sidecar = await writeUnconfirmedVisualSidecar(
    fixture,
    "2026-07-22T00:00:00.000Z",
  );
  const defaultRun = await extractManifestLocally({ stateDir: fixture.stateDir });
  assert.equal(defaultRun.selected_units, 0);
  assert.equal(defaultRun.manifest.units[0]?.stage, "validated");
  const refreshed = await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [unit.unit_id],
  });

  assert.equal(refreshed.selected_units, 1);
  assert.equal(refreshed.processed_units, 1);
  assert.equal(refreshed.failed_units, 0);
  assert.equal(refreshed.manifest.units[0]?.stage, "extracted");
  assert.equal(
    refreshed.manifest.units[0]?.local_extraction?.visual_transcription?.content_sha256,
    sidecar.contentSha256,
  );
  assert.notEqual(refreshed.manifest.units[0]?.local_extraction?.fingerprint, previousFingerprint);
  assert.equal(refreshed.manifest.units[0]?.validation, undefined);
});

test("explicit units refreshes a validated unit when the verified visual binding changes", async (t) => {
  const fixture = await ocrReviewFixture(false);
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const initialSidecar = await writeUnconfirmedVisualSidecar(
    fixture,
    "2026-07-22T00:00:00.000Z",
  );
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const unit = validated.units[0]!;
  assert.equal(unit.stage, "validated");
  assert.equal(
    unit.local_extraction?.visual_transcription?.content_sha256,
    initialSidecar.contentSha256,
  );
  const previousFingerprint = unit.local_extraction!.fingerprint;

  const changedSidecar = await writeUnconfirmedVisualSidecar(
    fixture,
    "2026-07-22T00:01:00.000Z",
  );
  const refreshed = await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [unit.unit_id],
  });

  assert.equal(refreshed.selected_units, 1);
  assert.equal(refreshed.processed_units, 1);
  assert.equal(refreshed.failed_units, 0);
  assert.notEqual(changedSidecar.contentSha256, initialSidecar.contentSha256);
  assert.equal(
    refreshed.manifest.units[0]?.local_extraction?.visual_transcription?.content_sha256,
    changedSidecar.contentSha256,
  );
  assert.notEqual(refreshed.manifest.units[0]?.local_extraction?.fingerprint, previousFingerprint);
  assert.equal(refreshed.manifest.units[0]?.validation, undefined);
});

test("explicit units refreshes a validated unit when its visual sidecar is removed", async (t) => {
  const fixture = await ocrReviewFixture(false);
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const sidecar = await writeUnconfirmedVisualSidecar(
    fixture,
    "2026-07-22T00:00:00.000Z",
  );
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const unit = validated.units[0]!;
  assert.equal(unit.stage, "validated");
  assert.equal(
    unit.local_extraction?.visual_transcription?.content_sha256,
    sidecar.contentSha256,
  );
  const previousFingerprint = unit.local_extraction!.fingerprint;

  await rm(sidecar.sidecarPath);
  const refreshed = await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [unit.unit_id],
  });

  assert.equal(refreshed.selected_units, 1);
  assert.equal(refreshed.processed_units, 1);
  assert.equal(refreshed.failed_units, 0);
  assert.equal(refreshed.manifest.units[0]?.local_extraction?.visual_transcription, undefined);
  assert.notEqual(refreshed.manifest.units[0]?.local_extraction?.fingerprint, previousFingerprint);
  assert.equal(refreshed.manifest.units[0]?.validation, undefined);
});

test("explicit stale refresh rejects an invalid visual sidecar content hash", async (t) => {
  const fixture = await ocrReviewFixture(false);
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const sidecar = await writeUnconfirmedVisualSidecar(
    fixture,
    "2026-07-22T00:00:00.000Z",
  );
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const unit = validated.units[0]!;
  assert.equal(unit.stage, "validated");

  const tampered = await readJsonFile(sidecar.sidecarPath) as Record<string, unknown>;
  tampered.created_at = "2026-07-22T00:02:00.000Z";
  await writeJsonFile(sidecar.sidecarPath, tampered);
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifestBefore = await readFile(manifestPath, "utf8");

  await assert.rejects(
    extractManifestLocally({
      stateDir: fixture.stateDir,
      unitIds: [unit.unit_id],
    }),
    /artifact content hash does not match/u,
  );
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
});

test("explicit stale refresh rejects a visual sidecar whose raw source changed", async (t) => {
  const fixture = await ocrReviewFixture(false);
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await writeUnconfirmedVisualSidecar(
    fixture,
    "2026-07-22T00:00:00.000Z",
  );
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const unit = validated.units[0]!;
  assert.equal(unit.stage, "validated");

  await writeFile(fixture.firstRawPath, "changed after visual confirmation", "utf8");
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifestBefore = await readFile(manifestPath, "utf8");

  await assert.rejects(
    extractManifestLocally({
      stateDir: fixture.stateDir,
      unitIds: [unit.unit_id],
    }),
    /local_source_changed:/u,
  );
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
});

test("local runner refuses a concurrent extraction without changing the manifest", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const manifestPath = path.join(fixture.stateDir, "manifest.json");
  const manifestBefore = await readFile(manifestPath, "utf8");
  const releaseLock = await acquireExtractionLock(fixture.stateDir);
  try {
    await assert.rejects(
      extractManifestLocally({ stateDir: fixture.stateDir }),
      /extract_lock_active/u,
    );
  } finally {
    await releaseLock();
  }
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
});

test("a successful local refresh removes obsolete validation failure notices", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  const unit = extracted.manifest.units[0]!;
  unit.stage = "validated";
  unit.local_extraction!.engine_version = "stale-local-engine";
  unit.local_extraction!.engine_hash = "f".repeat(64);
  unit.notices.push(
    "validate failed: local extraction artifact provenance mismatch (obsolete)",
  );
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), extracted.manifest);

  const refreshed = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(refreshed.processed_units, 1);
  assert.equal(refreshed.manifest.units[0]?.stage, "extracted");
  assert.equal(
    refreshed.manifest.units[0]?.notices.some((notice) => notice.startsWith("validate failed:")),
    false,
  );
});

test("local runner stays zero-cost and creates only review-pending deterministic artifacts", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const ledgerPath = path.join(fixture.stateDir, ".cache", "ai-ledger.ndjson");
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, "sentinel-ledger-row\n", "utf8");
  const ledgerBefore = await readFile(ledgerPath, "utf8");

  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousEnabled = process.env.INGEST_OPENAI_ENABLED;
  process.env.OPENAI_API_KEY = "must-not-be-used";
  process.env.INGEST_OPENAI_ENABLED = "true";
  try {
    const result = await extractManifestLocally({ stateDir: fixture.stateDir });
    assert.equal(result.processed_units, 1);
    assert.equal(result.cache_hits, 0);
  } finally {
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
    if (previousEnabled === undefined) delete process.env.INGEST_OPENAI_ENABLED;
    else process.env.INGEST_OPENAI_ENABLED = previousEnabled;
  }

  assert.equal(await readFile(ledgerPath, "utf8"), ledgerBefore);
  const persisted = await readJsonFile(path.join(fixture.stateDir, "manifest.json")) as IngestManifest;
  const metadata = persisted.units[0]?.local_extraction;
  assert.equal(metadata?.provider_mode, "local_deterministic");
  assert.equal(metadata?.model, "local-deterministic-v1");
  assert.equal(metadata?.attempts, 0);
  assert.equal(metadata?.input_tokens, 0);
  assert.equal(metadata?.output_tokens, 0);
  assert.equal(metadata?.needs_review, true);
  assert.equal(metadata?.bulk_approval_eligible, false);
  assert.equal(persisted.units[0]?.stage, "extracted");

  const artifact = await readJsonFile(metadata!.artifact_path) as Record<string, unknown>;
  assert.equal(artifact.provider_mode, "local_deterministic");
  assert.equal(artifact.model, "local-deterministic-v1");
  assert.equal(artifact.attempts, 0);
  assert.equal(artifact.input_tokens, 0);
  assert.equal(artifact.output_tokens, 0);
  assert.equal(artifact.estimated_cost_usd, 0);
  assert.equal(artifact.review_status, "pending");
  assert.equal(artifact.needs_review, true);
  assert.equal(artifact.bulk_approval_eligible, false);
  const data = artifact.data as {
    extraction_notes: string;
    partner_vendors: Array<{ needs_review: boolean; confidence: number }>;
  };
  assert.match(data.extraction_notes, /^\[local_evidence_guard\]/u);
  assert.ok(data.partner_vendors.length > 0);
  assert.ok(data.partner_vendors.every((vendor) => vendor.needs_review && vendor.confidence <= 0.5));
});

test("local validation retries an error-stage artifact through verified local provenance", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const firstValidation = await validateManifest({ stateDir: fixture.stateDir });
  assert.equal(firstValidation.units[0]?.stage, "validated");
  assert.ok(firstValidation.units[0]?.validation);

  firstValidation.units[0]!.stage = "error";
  firstValidation.units[0]!.notices.push("pipeline_failed: stale validator fixture");
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), firstValidation);

  const retried = await validateManifest({ stateDir: fixture.stateDir });
  assert.equal(retried.units[0]?.stage, "validated", retried.units[0]?.notices.join(" | "));
  assert.ok(retried.units[0]?.validation);
  await verifyCurrentLocalValidatedArtifactForUnit(
    retried.units[0]!,
    retried,
    fixture.stateDir,
  );
});

test("ambiguous shared OCR stays in review artifacts but cannot feed extraction or validation", async (t) => {
  const fixture = await ocrReviewFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));

  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  assert.equal(extracted.processed_units, 1);
  const extractedUnit = extracted.manifest.units[0]!;
  assert.ok(extractedUnit.notices.includes(
    "local evidence review: ocr_shared_artifact_not_source_mapped:1",
  ));
  const extractionArtifact = await readJsonFile(
    extractedUnit.local_extraction!.artifact_path,
  ) as {
    conversion_artifacts: Array<{ path: string }>;
    data: {
      extraction_notes: string;
      money_occurrences: Array<{ krw: number }>;
    };
  };
  assert.ok(extractionArtifact.conversion_artifacts.some((artifact) =>
    path.resolve(artifact.path) === path.resolve(fixture.ocrPath)
  ));
  assert.match(
    extractionArtifact.data.extraction_notes,
    /\[provenance_review\] ocr_shared_artifact_not_source_mapped:1/u,
  );
  assert.equal(
    extractionArtifact.data.money_occurrences.some((occurrence) => occurrence.krw === 3_300_000),
    false,
  );

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const validationArtifact = await readJsonFile(
    validated.units[0]!.validation!.artifact_path,
  ) as {
    issues: Array<{ code: string }>;
    coverage_gaps: Array<{ krw: number }>;
  };
  assert.ok(validationArtifact.issues.some((issue) =>
    issue.code === "ocr_provenance_ambiguous_review_only"
  ));
  assert.equal(
    validationArtifact.coverage_gaps.some((gap) => gap.krw === 3_300_000),
    false,
  );
});

test("source-mapped OCR review artifacts remain private review aids, never automatic money evidence", async (t) => {
  const fixture = await ocrReviewFixture(false);
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));

  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  const extractedUnit = extracted.manifest.units[0]!;
  assert.ok(extractedUnit.notices.includes(
    "local evidence review: ocr_review_artifact_excluded:1",
  ));
  const extractionArtifact = await readJsonFile(
    extractedUnit.local_extraction!.artifact_path,
  ) as {
    conversion_artifacts: Array<{ path: string }>;
    data: { money_occurrences: Array<{ krw: number }> };
  };
  assert.ok(extractionArtifact.conversion_artifacts.some((artifact) =>
    path.resolve(artifact.path) === path.resolve(fixture.ocrPath)
  ));
  assert.equal(
    extractionArtifact.data.money_occurrences.some((occurrence) => occurrence.krw === 3_300_000),
    false,
  );

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  assert.equal(validated.units[0]?.stage, "validated");
  const validationArtifact = await readJsonFile(
    validated.units[0]!.validation!.artifact_path,
  ) as {
    issues: Array<{ code: string }>;
    coverage_gaps: Array<{ krw: number }>;
  };
  assert.ok(validationArtifact.issues.some((issue) =>
    issue.code === "ocr_evidence_review_only"
  ));
  assert.equal(
    validationArtifact.coverage_gaps.some((gap) => gap.krw === 3_300_000),
    false,
  );
});

test("local runner refuses a source file changed after scan", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await writeFile(fixture.rawPath, "changed after scan", "utf8");

  const result = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(result.processed_units, 0);
  assert.equal(result.failed_units, 1);
  const unit = result.manifest.units[0]!;
  assert.equal(unit.stage, "error");
  assert.equal(unit.extraction, undefined);
  assert.ok(unit.notices.some((notice) => notice.includes("local_source_changed:")));
});

test("local runner refuses a converted artifact changed after conversion", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await writeFile(fixture.convertedPath, "tampered conversion", "utf8");

  const result = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(result.processed_units, 0);
  assert.equal(result.failed_units, 1);
  assert.ok(result.manifest.units[0]?.notices.some(
    (notice) => notice.includes("local_conversion_artifact_changed"),
  ));
});

test("local runner refuses a conversion artifact borrowed from another unit directory", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const unit = fixture.manifest.units[0]!;
  const foreignPath = path.join(
    fixture.stateDir,
    ".converted",
    sha256Text("foreign-unit"),
    sha256Text("foreign-source"),
    "content.txt",
  );
  await mkdir(path.dirname(foreignPath), { recursive: true });
  await writeFile(foreignPath, await readFile(fixture.convertedPath));
  const foreignDigest = await sha256File(foreignPath);
  unit.conversion!.text_artifacts = [foreignPath];
  unit.conversion!.artifact_fingerprint = sha256Text(
    `${path.resolve(foreignPath)}\0${foreignDigest.sha256}`,
  );
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);

  const result = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(result.processed_units, 0);
  assert.equal(result.failed_units, 1);
  assert.ok(result.manifest.units[0]?.notices.some(
    (notice) => notice.includes("local_conversion_artifact_path_escape"),
  ));
});

test("local runner reuses its verified local cache without rewriting it", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const first = await extractManifestLocally({ stateDir: fixture.stateDir });
  const artifactPath = first.manifest.units[0]!.local_extraction!.artifact_path;
  const artifactBefore = await readFile(artifactPath, "utf8");
  const verified = await verifyCurrentLocalExtractionCacheForUnit(
    first.manifest.units[0]!,
    first.manifest,
    fixture.stateDir,
  );
  assert.equal(verified.bulk_approval_eligible, false);

  const second = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(second.processed_units, 1);
  assert.equal(second.cache_hits, 1);
  assert.equal(second.manifest.units[0]?.local_extraction?.cache_hit, true);
  assert.equal(await readFile(artifactPath, "utf8"), artifactBefore);
});

test("local runner rejects a cached artifact forged as approved", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const first = await extractManifestLocally({ stateDir: fixture.stateDir });
  const artifactPath = first.manifest.units[0]!.local_extraction!.artifact_path;
  const artifact = await readJsonFile(artifactPath) as Record<string, unknown>;
  artifact.review_status = "approved";
  await writeJsonFile(artifactPath, artifact);

  const second = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(second.processed_units, 0);
  assert.equal(second.failed_units, 1);
  assert.equal(second.manifest.units[0]?.stage, "error");
  assert.equal(second.manifest.units[0]?.local_extraction, undefined);
  assert.ok(second.manifest.units[0]?.notices.some(
    (notice) => notice.includes("local_extraction_cache_schema_invalid"),
  ));
});

test("local runner detects schema-valid cached data tampering by content hash", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const first = await extractManifestLocally({ stateDir: fixture.stateDir });
  const artifactPath = first.manifest.units[0]!.local_extraction!.artifact_path;
  const artifact = await readJsonFile(artifactPath) as {
    data: { business_name: string | null };
  } & Record<string, unknown>;
  artifact.data.business_name = "조작된 업체명";
  await writeJsonFile(artifactPath, artifact);

  const second = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(second.processed_units, 0);
  assert.equal(second.failed_units, 1);
  assert.ok(second.manifest.units[0]?.notices.some(
    (notice) => notice.includes("artifact content hash does not match"),
  ));
});

test("local runner rejects a self-rehashed cache with forged source provenance", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const first = await extractManifestLocally({ stateDir: fixture.stateDir });
  const artifactPath = first.manifest.units[0]!.local_extraction!.artifact_path;
  const artifact = await readJsonFile(artifactPath) as {
    content_sha256: string;
    source_files: Array<{ path: string }>;
  } & Record<string, unknown>;
  artifact.source_files[0]!.path = "agency/seoul/forged.xlsx";
  artifact.content_sha256 = canonicalJsonSha256ExcludingField(artifact, "content_sha256");
  await writeJsonFile(artifactPath, artifact);

  const second = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(second.processed_units, 0);
  assert.equal(second.failed_units, 1);
  assert.ok(second.manifest.units[0]?.notices.some(
    (notice) => notice.includes("local_extraction_cache_provenance_mismatch"),
  ));
});

test("local runner rejects self-rehashed data that differs from deterministic replay", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const first = await extractManifestLocally({ stateDir: fixture.stateDir });
  const artifactPath = first.manifest.units[0]!.local_extraction!.artifact_path;
  const artifact = await readJsonFile(artifactPath) as {
    content_sha256: string;
    data: { business_name: string | null };
  } & Record<string, unknown>;
  artifact.data.business_name = "자가 해시까지 바꾼 업체명";
  artifact.content_sha256 = canonicalJsonSha256ExcludingField(artifact, "content_sha256");
  await writeJsonFile(artifactPath, artifact);

  const second = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(second.processed_units, 0);
  assert.equal(second.failed_units, 1);
  assert.ok(second.manifest.units[0]?.notices.some(
    (notice) => notice.includes("local_extraction_cache_replay_mismatch"),
  ));
});

test("default local selection never replaces an existing paid extraction", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const unit = fixture.manifest.units[0]!;
  unit.stage = "extracted";
  unit.extraction = {
    provider_mode: "production_paid",
    paid_plan_sha256: "a".repeat(64),
    fingerprint: "b".repeat(64),
    content_sha256: "c".repeat(64),
    source_fingerprint: unit.source_fingerprint,
    artifact_fingerprint: unit.conversion!.artifact_fingerprint,
    prompt_version: "v6",
    prompt_hash: "d".repeat(64),
    processing_version: "e".repeat(64),
    scanner_parser_version: fixture.manifest.scanner_parser_version,
    converter_version: unit.conversion!.converter_version,
    model: "gpt-5.6-luna",
    artifact_path: path.join(fixture.stateDir, ".cache", "extract", `${"b".repeat(64)}.json`),
    cache_hit: true,
    attempts: 1,
    input_tokens: 123,
    output_tokens: 45,
    extracted_at: new Date(0).toISOString(),
  };
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
  const metadataBefore = structuredClone(unit.extraction);

  const result = await extractManifestLocally({ stateDir: fixture.stateDir });

  assert.equal(result.selected_units, 0);
  assert.deepEqual(result.manifest.units[0]?.extraction, metadataBefore);
  assert.equal(result.manifest.units[0]?.stage, "extracted");
});

test("an explicit paid review-only override preserves paid provenance and writes a pending local artifact", async (t) => {
  const fixture = await localFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const unit = fixture.manifest.units[0]!;
  unit.stage = "extracted";
  unit.extraction = {
    provider_mode: "production_paid",
    paid_plan_sha256: "a".repeat(64),
    fingerprint: "b".repeat(64),
    content_sha256: "c".repeat(64),
    source_fingerprint: unit.source_fingerprint,
    artifact_fingerprint: unit.conversion!.artifact_fingerprint,
    prompt_version: "v6",
    prompt_hash: "d".repeat(64),
    processing_version: "e".repeat(64),
    scanner_parser_version: fixture.manifest.scanner_parser_version,
    converter_version: unit.conversion!.converter_version,
    model: "gpt-5.6-luna",
    artifact_path: path.join(fixture.stateDir, ".cache", "extract", `${"b".repeat(64)}.json`),
    cache_hit: true,
    attempts: 1,
    input_tokens: 123,
    output_tokens: 45,
    extracted_at: new Date(0).toISOString(),
  };
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
  const paidMetadataBefore = structuredClone(unit.extraction);

  const result = await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [unit.unit_id],
    allowPaidReviewOnly: true,
  });

  assert.equal(result.selected_units, 1);
  assert.equal(result.processed_units, 1);
  assert.equal(result.failed_units, 0);
  assert.deepEqual(result.manifest.units[0]?.extraction, paidMetadataBefore);
  assert.equal(result.manifest.units[0]?.local_extraction?.provider_mode, "local_deterministic");
  assert.equal(result.manifest.units[0]?.local_extraction?.paid_review_only_override, true);
  assert.equal(result.manifest.units[0]?.stage, "extracted");
  const localArtifact = await readJsonFile(result.manifest.units[0]!.local_extraction!.artifact_path) as {
    review_status: string;
    needs_review: boolean;
    bulk_approval_eligible: boolean;
  };
  assert.deepEqual(localArtifact, {
    ...localArtifact,
    review_status: "pending",
    needs_review: true,
    bulk_approval_eligible: false,
  });

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const validatedUnit = validated.units[0]!;
  assert.ok(["validated", "error"].includes(validatedUnit.stage));
  assert.ok(validatedUnit.local_extraction);
  assert.ok(validatedUnit.validation, validatedUnit.notices.join(" | "));
  assert.equal(validatedUnit.local_extraction.paid_review_only_override, true);
  const validationArtifact = await verifyCurrentLocalValidatedArtifactForUnit(
    validatedUnit,
    validated,
    fixture.stateDir,
  );
  assert.equal(validationArtifact.review_status, "pending");
  assert.equal(validationArtifact.bulk_approval_eligible, false);
});

test("the default extract CLI uses the local runner even with paid environment residue", async (t) => {
  const cliWorkingRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-cli-cwd-"));
  const networkTripwirePath = path.join(cliWorkingRoot, "network-tripwire.mjs");
  await writeFile(
    networkTripwirePath,
    [
      "globalThis.fetch = async () => {",
      "  throw new Error('ingest_test_network_forbidden:fetch');",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  const stateDir = path.join(
    cliWorkingRoot,
    "scripts",
    "ingest",
    ".state",
    "fixture",
  );
  const fixture = await localFixture(stateDir);
  t.after(async () => {
    await rm(path.dirname(fixture.rootDir), { recursive: true, force: true });
    await rm(cliWorkingRoot, { recursive: true, force: true });
  });

  const { stdout } = await execFileAsync(process.execPath, [
    "--import",
    pathToFileURL(networkTripwirePath).href,
    "--import",
    tsxImport,
    path.join(process.cwd(), "scripts", "ingest", "index.ts"),
    "extract",
    "--state-dir",
    stateDir,
  ], {
    cwd: cliWorkingRoot,
    env: {
      ...process.env,
      OPENAI_API_KEY: "must-not-be-used",
      INGEST_OPENAI_ENABLED: "true",
    },
  });

  const output = JSON.parse(stdout) as {
    mode: string;
    model: string;
    cost_usd: number;
    processed_units: number;
  };
  assert.equal(output.mode, "local_deterministic");
  assert.equal(output.model, "local-deterministic-v1");
  assert.equal(output.cost_usd, 0);
  assert.equal(output.processed_units, 1);
});

test("the extract CLI rejects every legacy paid OpenAI flag spelling", async (t) => {
  const cliWorkingRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-cli-paid-cwd-"));
  t.after(() => rm(cliWorkingRoot, { recursive: true, force: true }));
  const stateDir = path.join(
    cliWorkingRoot,
    "scripts",
    "ingest",
    ".state",
    "local-cli-paid-disabled",
  );
  const legacyFlagArguments = [
    ["--plan"],
    ["--plan=true"],
    ["--paid-openai"],
    ["--paid-openai=true"],
    ["--approved-plan-sha256", "a".repeat(64)],
    [`--approved-plan-sha256=${"a".repeat(64)}`],
  ];

  for (const legacyArguments of legacyFlagArguments) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        "--import",
        tsxImport,
        path.join(process.cwd(), "scripts", "ingest", "index.ts"),
        "extract",
        "--state-dir",
        stateDir,
        ...legacyArguments,
      ], { cwd: cliWorkingRoot }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok("stderr" in error);
        assert.match(
          String(error.stderr),
          /paid_openai_cli_disabled/u,
          `legacy arguments were not rejected: ${legacyArguments.join(" ")}`,
        );
        return true;
      },
    );
  }
});
