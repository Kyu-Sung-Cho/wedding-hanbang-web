import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONVERTER_VERSION, convertManifest } from "../convert.js";
import { sha256File, sha256Text, writeJsonFile } from "../io.js";
import { buildUnitPreviewObjects, loadValidated } from "../load.js";
import { extractManifestLocally } from "../local-extraction-runner.js";
import { scanSources, SCANNER_PARSER_VERSION } from "../scan.js";
import type { IngestManifest } from "../types.js";
import { validateManifest } from "../validate.js";

async function localLoadFixture(): Promise<{ rootDir: string; stateDir: string }> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-load-"));
  const rootDir = path.join(temporaryRoot, "raw");
  const stateDir = path.join(temporaryRoot, "state");
  const rawPath = path.join(rootDir, "agency", "seoul", "sample.xlsx");
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, "immutable source", "utf8");
  const sourceDigest = await sha256File(rawPath);
  const sourceFingerprint = sha256Text("local-load-source");
  const unitId = sha256Text("local-load-unit");
  const convertedPath = path.join(
    stateDir,
    ".converted",
    unitId,
    sourceFingerprint,
    "1-sheets.txt",
  );
  await mkdir(path.dirname(convertedPath), { recursive: true });
  const convertedText = [
    "## 시트: 스튜디오",
    "스튜디오!A3: 사업자명",
    "스튜디오!B3: 기본가격",
    "스튜디오!A4: 해피스튜디오",
    "스튜디오!B4: 스튜디오 기본 120만원",
  ].join("\n");
  await writeFile(convertedPath, convertedText, "utf8");
  const convertedDigest = await sha256File(convertedPath);
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
  return { rootDir, stateDir };
}

test("load accepts verified local validation only as pending manual-review staging data", async (t) => {
  const fixture = await localLoadFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const validationArtifact = validated.units[0]?.validation?.artifact_path
    ? await readFile(validated.units[0].validation.artifact_path, "utf8")
    : "missing validation artifact";
  assert.equal(validated.units[0]?.stage, "validated", validationArtifact);

  const result = await loadValidated({ stateDir: fixture.stateDir, snapshot: "2026Q3" });

  assert.equal(result.mode, "dry-run");
  assert.equal(result.plan.units.length, 1);
  assert.equal(result.plan.official_prices.length, 1);
  assert.equal(result.plan.official_prices[0]?.review_status, "pending");
  assert.equal(result.plan.official_prices[0]?.needs_review, true);
  assert.ok((result.plan.official_prices[0]?.confidence ?? 1) <= 0.5);
  assert.deepEqual(result.plan.ai_ledger, []);
  assert.ok(result.plan.warnings.includes(
    `local_deterministic_review_only:${validated.units[0]!.unit_id}`,
  ));
  assert.doesNotMatch(JSON.stringify(result.plan), /"review_status":"approved"|published/u);
});

test("load uses an explicitly overridden local validation chain instead of stale paid provenance", async (t) => {
  const fixture = await localLoadFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  const extracted = await extractManifestLocally({ stateDir: fixture.stateDir });
  const unit = extracted.manifest.units[0]!;
  assert.ok(unit.local_extraction);
  unit.local_extraction.paid_review_only_override = true;
  unit.extraction = {
    provider_mode: "production_paid",
    paid_plan_sha256: "a".repeat(64),
    fingerprint: "b".repeat(64),
    content_sha256: "c".repeat(64),
    source_fingerprint: "d".repeat(64),
    artifact_fingerprint: "e".repeat(64),
    prompt_version: "legacy-paid",
    prompt_hash: "f".repeat(64),
    processing_version: "1".repeat(64),
    scanner_parser_version: extracted.manifest.scanner_parser_version,
    converter_version: unit.conversion!.converter_version,
    model: "gpt-5.6-luna",
    artifact_path: path.join(fixture.stateDir, ".cache", "extract", `${"b".repeat(64)}.json`),
    cache_hit: true,
    attempts: 1,
    input_tokens: 10,
    output_tokens: 5,
    extracted_at: new Date(0).toISOString(),
  };
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), extracted.manifest);

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  assert.equal(validated.units[0]?.stage, "validated");
  assert.equal(validated.units[0]?.validation?.provider_mode, "local_deterministic");

  const result = await loadValidated({ stateDir: fixture.stateDir, snapshot: "2026Q3" });
  assert.equal(result.plan.units.length, 1);
  assert.equal(result.plan.official_prices[0]?.review_status, "pending");
  assert.ok(result.plan.warnings.includes(
    `local_deterministic_review_only:${unit.unit_id}`,
  ));
});

test("load fails closed if local validation is no longer review-only", async (t) => {
  const fixture = await localLoadFixture();
  t.after(() => rm(path.dirname(fixture.rootDir), { recursive: true, force: true }));
  await extractManifestLocally({ stateDir: fixture.stateDir });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const artifactPath = validated.units[0]?.validation?.artifact_path;
  assert.ok(artifactPath);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
  artifact.bulk_approval_eligible = true;
  await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, "utf8");

  await assert.rejects(
    loadValidated({ stateDir: fixture.stateDir, snapshot: "2026Q3" }),
    /local validation artifact/u,
  );
});

test("load maps Windows OCR review previews back to the immutable PNG source", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-local-ocr-load-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const rootDir = path.join(temporaryRoot, "raw");
  const stateDir = path.join(temporaryRoot, "state");
  const rawPath = path.join(
    rootDir,
    "결혼준비대행서비스",
    "강원도",
    "(강원도)_메이브라이드.png",
  );
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ));
  await scanSources({ rootDir, stateDir });
  const converted = await convertManifest({ stateDir, windowsOcrReviewOnly: true }, {
    windowsOcrRunner: async () => ({
      schema_version: 1,
      engine_name: "Windows.Media.Ocr",
      engine_version: "10.0.test",
      language: "ko-KR",
      lines: [{ line: 1, text: "메이브라이드 기본 패키지 1,600,000원" }],
    }),
  });
  const extracted = await extractManifestLocally({ stateDir });
  const unit = extracted.manifest.units[0] ?? converted.units[0];
  assert.ok(unit);
  const previews = await buildUnitPreviewObjects(stateDir, unit);
  assert.equal(previews.length, 1);
  assert.equal(previews[0]?.source_label, "(강원도)_메이브라이드.png");
  assert.equal(
    previews[0]?.source_object_key,
    `${unit.source_files[0]?.sha256}.png`,
  );
});
