import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalJsonSha256,
  canonicalJsonSha256ExcludingField,
  restoreVendorDisclosureEvidenceBundle,
  verifyVendorDisclosureEvidenceBundle,
} from "./verify-restore.js";
import {
  approvedVisualTextBlockHash,
  loadVisualTranscriptionSidecar,
  visualTranscriptionEvidenceId,
} from "../../visual-transcription-sidecar.js";

const BUNDLE_DIR = path.resolve("scripts", "ingest", "evidence", "vendor-disclosure-v2");

interface BundleArtifactForTest {
  role: string;
  relative_path: string;
  sha256: string;
  bytes: number;
  materialize: boolean;
}

interface BundleManifestForTest extends Record<string, unknown> {
  content_sha256: string;
  artifacts: BundleArtifactForTest[];
}

interface SanitizedSourceManifestForTest {
  units: Array<{
    unit_id: string;
    source_fingerprint: string;
    source_files: Array<{
      path: string;
      ext: string;
      sha256: string;
      bytes: number;
    }>;
  }>;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeFixture(t: test.TestContext) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-evidence-bundle-"));
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const bundleDir = path.join(temporaryRoot, "bundle");
  const stateDir = path.join(temporaryRoot, "state");
  await Promise.all([
    cp(BUNDLE_DIR, bundleDir, { recursive: true }),
    mkdir(stateDir, { recursive: true }),
  ]);

  const sourceManifest = await readJson<SanitizedSourceManifestForTest>(
    path.join(bundleDir, "artifacts", "source-object-manifest.json"),
  );
  const currentScanManifestPath = path.join(temporaryRoot, "current-scan-manifest.json");
  const currentScanManifest = {
    schema_version: 1,
    scanner_parser_version: "clean-clone-different-parser-version",
    root_dir: path.join(temporaryRoot, "different-computer", "source"),
    state_dir: path.join(temporaryRoot, "different-computer", "state"),
    scanned_at: "2030-01-01T00:00:00.000Z",
    units: sourceManifest.units.map((unit) => ({
      unit_id: unit.unit_id,
      source_fingerprint: unit.source_fingerprint,
      display_name: "ignored-by-binding",
      source_files: unit.source_files.map((source) => ({
        ...source,
        absolute_path: path.join(temporaryRoot, "different-computer", "source", source.path),
      })),
    })),
  };
  await writeJson(currentScanManifestPath, currentScanManifest);
  const sentinelPath = path.join(stateDir, "existing-state-sentinel.txt");
  await writeFile(sentinelPath, "must remain byte-identical", "utf8");
  const bundleManifest = await readJson<BundleManifestForTest>(
    path.join(bundleDir, "bundle-manifest.json"),
  );
  return {
    bundleDir,
    expectedBundleContentSha256: bundleManifest.content_sha256,
    currentScanManifest,
    currentScanManifestPath,
    sentinelPath,
    stateDir,
    temporaryRoot,
  };
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return (await listFiles(child)).map((relative) => path.join(entry.name, relative));
    }
    return [entry.name];
  }));
  return nested.flat().sort();
}

async function resignManifest(bundleDir: string): Promise<BundleManifestForTest> {
  const manifestPath = path.join(bundleDir, "bundle-manifest.json");
  const manifest = await readJson<BundleManifestForTest>(manifestPath);
  manifest.content_sha256 = canonicalJsonSha256ExcludingField(manifest, "content_sha256");
  await writeJson(manifestPath, manifest);
  return manifest;
}

async function mutateReportAndResign(
  bundleDir: string,
  mutate: (report: Record<string, unknown>) => void,
): Promise<string> {
  const manifestPath = path.join(bundleDir, "bundle-manifest.json");
  const manifest = await readJson<BundleManifestForTest>(manifestPath);
  const entry = manifest.artifacts.find(({ role }) => role === "fixed_eight_build_report");
  assert.ok(entry);
  const artifactPath = path.join(bundleDir, entry.relative_path);
  const report = await readJson<Record<string, unknown>>(artifactPath);
  mutate(report);
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(artifactPath, bytes);
  entry.sha256 = sha256(bytes);
  entry.bytes = bytes.length;
  manifest.artifact_total_bytes = manifest.artifacts.reduce(
    (sum, artifact) => sum + artifact.bytes,
    0,
  );
  manifest.content_sha256 = canonicalJsonSha256ExcludingField(manifest, "content_sha256");
  await writeJson(manifestPath, manifest);
  return manifest.content_sha256;
}

async function assertStateUnchanged(stateDir: string, sentinelPath: string): Promise<void> {
  assert.deepEqual(await listFiles(stateDir), ["existing-state-sentinel.txt"]);
  assert.equal(await readFile(sentinelPath, "utf8"), "must remain byte-identical");
}

type MutableJson = Record<string, any>;

const EILEEN_UNIT_ID = "467af65b41d314bbce9fddd38bff84961d33700d5e7da17f04e337afaa212ead";
const EILEEN_SOURCE_FINGERPRINT = "96285bc7453df209db2c0a776f56631164cd5beceb2d60d5c6dab1464c48aa91";
const MAY_UNIT_ID = "9bd413d45460d6f9e754a39d57592b25c1dc5adec8ea86bba0e432c83dce16a7";
const MAY_SOURCE_FINGERPRINT = "4de8ed3d0d6500421e8412845bb0c121ed0fd97c0734d844a99928a281bc6ef0";

function sha256Text(value: string): string {
  return sha256(Buffer.from(value, "utf8"));
}

function sidecarCounts(sidecar: MutableJson): Record<string, number> {
  return {
    source_file_count: sidecar.source_files.length,
    evidence_count: sidecar.evidence.length,
    record_evidence_count: sidecar.record_evidence.length,
    coverage_gap_count: sidecar.coverage_gaps.length,
    agency_package_count: sidecar.fragment.agency_packages.length,
    partner_vendor_count: sidecar.fragment.partner_vendors.length,
    hall_count: sidecar.fragment.halls.length,
    section_count: sidecar.fragment.sections.length,
    money_occurrence_count: sidecar.fragment.money_occurrences.length,
  };
}

async function makeCleanCloneLoaderFixture(t: test.TestContext) {
  const fixture = await makeFixture(t);
  const rawRoot = path.join(fixture.temporaryRoot, "raw-source-objects");
  await mkdir(rawRoot, { recursive: true });
  const sourceManifestPath = path.join(
    fixture.bundleDir,
    "artifacts",
    "source-object-manifest.json",
  );
  const sourceManifest = await readJson<MutableJson>(sourceManifestPath);
  const retainedUnits = sourceManifest.units.filter((unit: MutableJson) =>
    unit.unit_id === EILEEN_UNIT_ID || unit.unit_id === MAY_UNIT_ID
  );
  assert.equal(retainedUnits.length, 2);
  const sourceByUnit = new Map<string, MutableJson>();
  for (const unit of retainedUnits) {
    const original = unit.source_files[0] as MutableJson;
    const bytes = Buffer.from(
      unit.unit_id === MAY_UNIT_ID
        ? "synthetic clean-clone May visual source"
        : "synthetic clean-clone Eileen source",
      "utf8",
    );
    const absolutePath = path.join(rawRoot, ...String(original.path).split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
    const source = {
      path: original.path,
      ext: original.ext,
      sha256: sha256(bytes),
      bytes: bytes.length,
      absolute_path: absolutePath,
    };
    unit.source_files = [{
      path: source.path,
      ext: source.ext,
      sha256: source.sha256,
      bytes: source.bytes,
    }];
    sourceByUnit.set(unit.unit_id, source);
  }
  sourceManifest.units = retainedUnits;
  sourceManifest.unit_count = retainedUnits.length;
  sourceManifest.source_object_count = retainedUnits.length;
  sourceManifest.ordered_binding_sha256 = canonicalJsonSha256(retainedUnits);
  sourceManifest.content_sha256 = canonicalJsonSha256ExcludingField(
    sourceManifest,
    "content_sha256",
  );
  await writeJson(sourceManifestPath, sourceManifest);

  const groundTruthPath = path.join(
    fixture.bundleDir,
    "artifacts",
    "manual-pilot-source-money-ground-truth.json",
  );
  const groundTruth = await readJson<MutableJson>(groundTruthPath);
  groundTruth.units = groundTruth.units.filter((unit: MutableJson) => sourceByUnit.has(unit.unit_id));
  const groundTruthOccurrenceCount = groundTruth.units.reduce(
    (sum: number, unit: MutableJson) => sum + unit.candidates.length,
    0,
  );
  await writeJson(groundTruthPath, groundTruth);

  const sourceOverlayPath = path.join(
    fixture.bundleDir,
    "artifacts",
    "fixed-eight-ground-truth-overlay-v2.json",
  );
  const sourceOverlay = await readJson<MutableJson>(sourceOverlayPath);
  sourceOverlay.units = sourceOverlay.units.filter((unit: MutableJson) => sourceByUnit.has(unit.unit_id));
  await writeJson(sourceOverlayPath, sourceOverlay);
  const sourceOverlayBytes = await readFile(sourceOverlayPath);
  const sourceOverlaySha256 = sha256(sourceOverlayBytes);

  const canonicalOverlayPath = path.join(
    fixture.bundleDir,
    "artifacts",
    "fixed-eight-ground-truth-overlay-v3-canonical-visual.json",
  );
  const canonicalOverlay = await readJson<MutableJson>(canonicalOverlayPath);
  canonicalOverlay.source_overlay_sha256 = sourceOverlaySha256;
  canonicalOverlay.overlay.units = canonicalOverlay.overlay.units.filter(
    (unit: MutableJson) => sourceByUnit.has(unit.unit_id),
  );
  canonicalOverlay.content_sha256 = canonicalJsonSha256ExcludingField(
    canonicalOverlay,
    "content_sha256",
  );
  await writeJson(canonicalOverlayPath, canonicalOverlay);

  const maySource = sourceByUnit.get(MAY_UNIT_ID)!;
  const convertedRoot = path.join(
    fixture.stateDir,
    ".converted",
    MAY_UNIT_ID,
    MAY_SOURCE_FINGERPRINT,
  );
  const textArtifactPath = path.join(convertedRoot, "ocr-review", "001-ocr-review.txt");
  const textArtifactBytes = Buffer.from("synthetic review text", "utf8");
  await mkdir(path.dirname(textArtifactPath), { recursive: true });
  await writeFile(textArtifactPath, textArtifactBytes);
  const fingerprintRecords = [
    `${path.resolve(textArtifactPath)}\0${sha256(textArtifactBytes)}`,
    `${path.resolve(maySource.absolute_path)}\0${maySource.sha256}`,
  ].sort((left, right) => left.localeCompare(right, "en"));
  const mayConversionFingerprint = sha256Text(fingerprintRecords.join("\n"));

  const sidecarPaths = new Map<string, string>([
    [EILEEN_UNIT_ID, path.join(fixture.bundleDir, "artifacts", "eileen-visual-transcription-sidecar.json")],
    [MAY_UNIT_ID, path.join(fixture.bundleDir, "artifacts", "may-visual-transcription-sidecar.json")],
  ]);
  for (const [unitId, sidecarPath] of sidecarPaths) {
    const sidecar = await readJson<MutableJson>(sidecarPath);
    const source = sourceByUnit.get(unitId)!;
    sidecar.source_files = [{
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
    }];
    sidecar.reviewer.confirmation.source_ground_truth_sha256 = sourceOverlaySha256;
    sidecar.reviewer.confirmation.locator_migration.derived_overlay_content_sha256 =
      canonicalOverlay.content_sha256;
    if (unitId === MAY_UNIT_ID) {
      sidecar.conversion_artifact_fingerprint = mayConversionFingerprint;
      const evidence = sidecar.evidence[0] as MutableJson;
      const oldEvidenceId = evidence.evidence_id as string;
      const oldSourceFileId = evidence.source_file_id as string;
      const oldSourceSha256 = evidence.source_sha256 as string;
      const sourceFileId = sha256Text(`${source.path}\0${source.sha256}`);
      const newEvidenceId = visualTranscriptionEvidenceId({
        source_file_id: sourceFileId,
        image_sha256: source.sha256,
        page: 1,
      });
      Object.assign(evidence, {
        evidence_id: newEvidenceId,
        source_file_id: sourceFileId,
        source_sha256: source.sha256,
        source_bytes: source.bytes,
        image_sha256: source.sha256,
        image_bytes: source.bytes,
      });
      const replaceBoundDigest = (value: unknown, bindingKey?: string): unknown => {
        if (bindingKey === "evidence_id" && value === oldEvidenceId) return newEvidenceId;
        if (bindingKey === "source_file_id" && value === oldSourceFileId) return sourceFileId;
        if (bindingKey === "source_sha256" && value === oldSourceSha256) return source.sha256;
        if (Array.isArray(value)) {
          if (bindingKey === "evidence_ids") {
            return value.map((entry) => entry === oldEvidenceId ? newEvidenceId : entry);
          }
          if (bindingKey === "source_file_ids") {
            return value.map((entry) => entry === oldSourceFileId ? sourceFileId : entry);
          }
          return value.map((entry) => replaceBoundDigest(entry));
        }
        if (value && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) {
            (value as MutableJson)[key] = replaceBoundDigest(child, key);
          }
        }
        return value;
      };
      replaceBoundDigest(sidecar);
      for (const block of sidecar.reviewer.approved_text_blocks as MutableJson[]) {
        block.block_sha256 = approvedVisualTextBlockHash({
          id: block.id,
          source_locator: block.source_locator,
          normalized_content: block.normalized_content,
          evidence_id: block.evidence_id,
          source_sha256: block.source_sha256,
        });
      }
    }
    sidecar.content_sha256 = canonicalJsonSha256ExcludingField(sidecar, "content_sha256");
    await writeJson(sidecarPath, sidecar);
  }

  const scanUnits = retainedUnits.map((unit: MutableJson) => {
    const source = sourceByUnit.get(unit.unit_id)!;
    const base = {
      unit_id: unit.unit_id,
      source_fingerprint: unit.source_fingerprint,
      display_name: path.basename(source.path),
      parsed: {
        region_code: "fixture",
        raw_name: "Fixture",
        normalized_name: "fixture",
        corporate_name: null,
        kind_hint: "agency",
      },
      source_files: [source],
      stage: unit.unit_id === MAY_UNIT_ID ? "converted" : "scanned",
      notices: [],
    } as MutableJson;
    if (unit.unit_id === MAY_UNIT_ID) {
      base.conversion = {
        converter_version: "clean-clone-fixture",
        source_fingerprint: unit.source_fingerprint,
        text_artifacts: [textArtifactPath],
        image_artifacts: [maySource.absolute_path],
        text_characters: textArtifactBytes.length,
        cell_count: 0,
        artifact_fingerprint: mayConversionFingerprint,
        converted_at: "2030-01-01T00:00:00.000Z",
      };
    }
    return base;
  });
  const loaderManifest = {
    schema_version: 1,
    scanner_parser_version: "clean-clone-fixture",
    root_dir: rawRoot,
    state_dir: fixture.stateDir,
    scanned_at: "2030-01-01T00:00:00.000Z",
    units: scanUnits,
  } as any;
  await writeJson(fixture.currentScanManifestPath, loaderManifest);

  const bundleManifestPath = path.join(fixture.bundleDir, "bundle-manifest.json");
  const bundleManifest = await readJson<MutableJson>(bundleManifestPath);
  bundleManifest.source_overlay_sha256 = sourceOverlaySha256;
  bundleManifest.ground_truth_occurrence_count = groundTruthOccurrenceCount;
  bundleManifest.source_inventory = {
    relative_path: "artifacts/source-object-manifest.json",
    content_sha256: sourceManifest.content_sha256,
    ordered_binding_sha256: sourceManifest.ordered_binding_sha256,
    unit_count: retainedUnits.length,
    source_object_count: retainedUnits.length,
  };
  for (const descriptor of bundleManifest.artifacts as MutableJson[]) {
    const artifactPath = path.join(fixture.bundleDir, ...String(descriptor.relative_path).split("/"));
    const bytes = await readFile(artifactPath);
    const json = JSON.parse(bytes.toString("utf8")) as MutableJson;
    descriptor.sha256 = sha256(bytes);
    descriptor.bytes = bytes.length;
    if (descriptor.role === "source_object_manifest") {
      descriptor.content_sha256 = sourceManifest.content_sha256;
      descriptor.counts = {
        unit_count: 2,
        source_object_count: 2,
        xlsx_count: 0,
        hwp_count: 0,
        png_count: 1,
        pdf_count: 1,
        docx_count: 0,
      };
    } else if (descriptor.role === "manual_pilot_source_money_ground_truth") {
      descriptor.counts = {
        unit_count: groundTruth.units.length,
        occurrence_count: groundTruthOccurrenceCount,
      };
    } else if (descriptor.role === "source_visual_overlay_v2") {
      descriptor.counts = {
        unit_count: sourceOverlay.units.length,
        readable_occurrence_count: sourceOverlay.units.reduce(
          (sum: number, unit: MutableJson) => sum + unit.readable_occurrences.length,
          0,
        ),
        unreadable_cell_count: sourceOverlay.units.reduce(
          (sum: number, unit: MutableJson) => sum + unit.unreadable_cells.length,
          0,
        ),
      };
    } else if (descriptor.role === "canonical_visual_overlay_v3") {
      descriptor.content_sha256 = canonicalOverlay.content_sha256;
      descriptor.counts.unit_count = canonicalOverlay.overlay.units.length;
    } else if (descriptor.role.endsWith("_visual_transcription_sidecar")) {
      descriptor.content_sha256 = json.content_sha256;
      descriptor.counts = sidecarCounts(json);
    }
  }
  bundleManifest.sidecars = (bundleManifest.artifacts as MutableJson[])
    .filter((descriptor) => descriptor.role.endsWith("_visual_transcription_sidecar"))
    .map((descriptor) => ({
      role: descriptor.role,
      unit_id: descriptor.unit_id,
      source_fingerprint: descriptor.source_fingerprint,
      content_sha256: descriptor.content_sha256,
      file_sha256: descriptor.sha256,
      bytes: descriptor.bytes,
    }));
  bundleManifest.artifact_total_bytes = (bundleManifest.artifacts as MutableJson[])
    .reduce((sum, descriptor) => sum + descriptor.bytes, 0);
  bundleManifest.content_sha256 = canonicalJsonSha256ExcludingField(
    bundleManifest,
    "content_sha256",
  );
  await writeJson(bundleManifestPath, bundleManifest);
  return {
    ...fixture,
    expectedBundleContentSha256: bundleManifest.content_sha256 as string,
    loaderManifest,
  };
}

test("restores a clean-clone fixture and the real sidecar loader consumes its byte-identical aliases", async (t) => {
  const fixture = await makeCleanCloneLoaderFixture(t);
  const verified = await verifyVendorDisclosureEvidenceBundle({
    bundleDir: fixture.bundleDir,
    currentScanManifestPath: fixture.currentScanManifestPath,
    expectedBundleContentSha256: fixture.expectedBundleContentSha256,
  });
  assert.equal(verified.sourceUnitCount, 2);
  assert.equal(verified.sourceObjectCount, 2);

  const restored = await restoreVendorDisclosureEvidenceBundle({
    bundleDir: fixture.bundleDir,
    currentScanManifestPath: fixture.currentScanManifestPath,
    expectedBundleContentSha256: fixture.expectedBundleContentSha256,
    stateDir: fixture.stateDir,
  });

  assert.equal(await readFile(fixture.sentinelPath, "utf8"), "must remain byte-identical");
  assert.equal(restored.materializedArtifacts.length, 4);
  assert.deepEqual(
    restored.materializedArtifacts.map(({ role }) => role).sort(),
    [
      "canonical_visual_overlay_v3",
      "eileen_visual_transcription_sidecar",
      "may_visual_transcription_sidecar",
      "source_visual_overlay_v2",
    ],
  );
  for (const artifact of restored.materializedArtifacts) {
    assert.equal(path.basename(artifact.path), `${artifact.sha256}.json`);
    assert.equal((await stat(artifact.path)).size, artifact.bytes);
    assert.equal(sha256(await readFile(artifact.path)), artifact.sha256);
    assert.equal(sha256(await readFile(artifact.aliasPath)), artifact.sha256);
    assert.ok(path.relative(fixture.stateDir, artifact.path).startsWith("vendor-disclosure-evidence"));
    assert.ok(path.relative(fixture.stateDir, artifact.aliasPath).length > 0);
    assert.equal((await stat(artifact.path)).mode & 0o222, 0);
    assert.equal((await stat(artifact.aliasPath)).mode & 0o222, 0);
  }
  const restoredFiles = (await listFiles(restored.targetDirectory))
    .filter((file) => file.endsWith(".json"));
  assert.equal(restoredFiles.length, 4);

  const loaded = await loadVisualTranscriptionSidecar({
    stateDir: fixture.stateDir,
    manifest: fixture.loaderManifest,
    unitId: MAY_UNIT_ID,
  });
  assert.ok(loaded);
  const restoredMay = restored.materializedArtifacts.find(
    ({ role }) => role === "may_visual_transcription_sidecar",
  );
  assert.ok(restoredMay);
  assert.equal(loaded.content_sha256, JSON.parse(
    await readFile(restoredMay.aliasPath, "utf8"),
  ).content_sha256);

  const repeated = await restoreVendorDisclosureEvidenceBundle({
    bundleDir: fixture.bundleDir,
    currentScanManifestPath: fixture.currentScanManifestPath,
    expectedBundleContentSha256: fixture.expectedBundleContentSha256,
    stateDir: fixture.stateDir,
  });
  assert.equal(repeated.targetDirectory, restored.targetDirectory);
  assert.deepEqual(repeated.materializedArtifacts, restored.materializedArtifacts);
  assert.equal(
    (await readdir(path.dirname(restored.targetDirectory))).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("production evidence verifies all 249 units and 253 actual raw source objects when present", async (t) => {
  const currentScanManifestPath = path.resolve(
    "scripts",
    "ingest",
    ".state",
    "reprocess-20260719-poppler5",
    "manifest.json",
  );
  try {
    await stat(currentScanManifestPath);
  } catch {
    t.skip("local raw-source scan is intentionally not committed");
    return;
  }
  const bundleManifest = await readJson<BundleManifestForTest>(
    path.join(BUNDLE_DIR, "bundle-manifest.json"),
  );
  const verified = await verifyVendorDisclosureEvidenceBundle({
    bundleDir: BUNDLE_DIR,
    currentScanManifestPath,
    expectedBundleContentSha256: bundleManifest.content_sha256,
  });
  assert.equal(verified.sourceUnitCount, 249);
  assert.equal(verified.sourceObjectCount, 253);
  assert.equal(verified.groundTruthOccurrenceCount, 2_342);
});

test("has no network, database, SDK, or non-Node runtime dependency and never auto-runs", async () => {
  const moduleSource = await readFile(path.join(BUNDLE_DIR, "verify-restore.ts"), "utf8");
  const importedModules = [...moduleSource.matchAll(/from\s+"([^"]+)"/gu)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(importedModules, ["node:crypto", "node:fs", "node:fs/promises", "node:path"]);
  assert.doesNotMatch(moduleSource, /\bfetch\s*\(/u);
  assert.doesNotMatch(moduleSource, /\b(?:createClient|OpenAI)\s*\(/u);
  assert.doesNotMatch(moduleSource, /\b(?:main|run)\s*\(\s*\)\s*(?:;|\.catch)/u);
  assert.match(moduleSource, /timingSafeEqual/u);
});

test("requires a caller-supplied signed-release bundle hash and rejects a mismatch", async (t) => {
  const fixture = await makeFixture(t);
  await assert.rejects(
    verifyVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
    } as Parameters<typeof verifyVendorDisclosureEvidenceBundle>[0]),
    /expectedBundleContentSha256 is required/u,
  );
  await assert.rejects(
    verifyVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: "0".repeat(64),
    }),
    /signed-release bundle content SHA-256 mismatch/u,
  );
});

test("rejects metadata-only source bindings when the 253 raw source objects are absent", async (t) => {
  const fixture = await makeFixture(t);
  await assert.rejects(
    verifyVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: fixture.expectedBundleContentSha256,
    }),
    /current scan raw root|raw source/u,
  );
});

test("rejects changed raw bytes after metadata binding and writes no evidence state", async (t) => {
  const fixture = await makeCleanCloneLoaderFixture(t);
  const mayUnit = fixture.loaderManifest.units.find((unit: MutableJson) => unit.unit_id === MAY_UNIT_ID)!;
  await writeFile(mayUnit.source_files[0].absolute_path, "tampered raw source", "utf8");
  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: fixture.expectedBundleContentSha256,
      stateDir: fixture.stateDir,
    }),
    /raw source SHA-256\/bytes mismatch/u,
  );
  await assert.rejects(
    stat(path.join(fixture.stateDir, "vendor-disclosure-evidence")),
    /ENOENT/u,
  );
});

test("never overwrites a loader alias whose existing bytes differ", async (t) => {
  const fixture = await makeCleanCloneLoaderFixture(t);
  const aliasPath = path.join(
    fixture.stateDir,
    "fixed-eight-ground-truth-overlay-v3-canonical-visual.json",
  );
  await writeFile(aliasPath, "pre-existing different bytes", "utf8");
  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: fixture.expectedBundleContentSha256,
      stateDir: fixture.stateDir,
    }),
    /different bytes; overwrite is forbidden/u,
  );
  assert.equal(await readFile(aliasPath, "utf8"), "pre-existing different bytes");
  await assert.rejects(
    stat(path.join(fixture.stateDir, "vendor-disclosure-evidence")),
    /ENOENT/u,
  );
});

test("fails closed and preserves a stale same-hash temp directory", async (t) => {
  const fixture = await makeCleanCloneLoaderFixture(t);
  const stalePath = path.join(
    fixture.stateDir,
    "vendor-disclosure-evidence",
    "sha256",
    `.${fixture.expectedBundleContentSha256}.stale.tmp`,
  );
  await mkdir(stalePath, { recursive: true });
  await writeFile(path.join(stalePath, "owner.txt"), "unknown concurrent owner", "utf8");
  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: fixture.expectedBundleContentSha256,
      stateDir: fixture.stateDir,
    }),
    /stale same-hash restore temporary path exists/u,
  );
  assert.equal(await readFile(path.join(stalePath, "owner.txt"), "utf8"), "unknown concurrent owner");
  await assert.rejects(
    stat(path.join(path.dirname(stalePath), fixture.expectedBundleContentSha256)),
    /ENOENT/u,
  );
});

test("rejects a byte-tampered artifact before writing anything to state", async (t) => {
  const fixture = await makeFixture(t);
  const manifest = await readJson<BundleManifestForTest>(
    path.join(fixture.bundleDir, "bundle-manifest.json"),
  );
  const overlay = manifest.artifacts.find(({ role }) => role === "canonical_visual_overlay_v3");
  assert.ok(overlay);
  await writeFile(path.join(fixture.bundleDir, overlay.relative_path), "{}\n", "utf8");

  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: fixture.expectedBundleContentSha256,
      stateDir: fixture.stateDir,
    }),
    /artifact (?:byte size|SHA-256) mismatch/u,
  );
  await assertStateUnchanged(fixture.stateDir, fixture.sentinelPath);
});

test("rejects a re-signed traversal path before reading or writing outside the bundle", async (t) => {
  const fixture = await makeFixture(t);
  const manifestPath = path.join(fixture.bundleDir, "bundle-manifest.json");
  const manifest = await readJson<BundleManifestForTest>(manifestPath);
  manifest.artifacts[0]!.relative_path = "../escape.json";
  await writeJson(manifestPath, manifest);
  const resigned = await resignManifest(fixture.bundleDir);

  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: resigned.content_sha256,
      stateDir: fixture.stateDir,
    }),
    /safe bundle-relative path|forbidden relative path traversal/u,
  );
  await assertStateUnchanged(fixture.stateDir, fixture.sentinelPath);
});

test("rejects a re-signed artifact containing a secret-shaped key", async (t) => {
  const fixture = await makeFixture(t);
  const resignedSha256 = await mutateReportAndResign(fixture.bundleDir, (report) => {
    report.api_key = "sk-example-must-never-enter-evidence";
  });

  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: resignedSha256,
      stateDir: fixture.stateDir,
    }),
    /forbidden secret-shaped key/u,
  );
  await assertStateUnchanged(fixture.stateDir, fixture.sentinelPath);
});

test("rejects a re-signed artifact containing an absolute path", async (t) => {
  const fixture = await makeFixture(t);
  const resignedSha256 = await mutateReportAndResign(fixture.bundleDir, (report) => {
    report.leaked_path = "C:\\Users\\someone\\private\\source.xlsx";
  });

  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: resignedSha256,
      stateDir: fixture.stateDir,
    }),
    /forbidden absolute path/u,
  );
  await assertStateUnchanged(fixture.stateDir, fixture.sentinelPath);
});

test("rejects absolute paths hidden after equals, colon, and semicolon delimiters", async (t) => {
  for (const [label, delimiter] of [["equals", "="], ["colon", ":"], ["semicolon", ";"]] as const) {
    await t.test(label, async (subtest) => {
      const fixture = await makeFixture(subtest);
      const resignedSha256 = await mutateReportAndResign(fixture.bundleDir, (report) => {
        report.leaked_path = `prefix${delimiter}C:\\Users\\someone\\source.xlsx`;
      });
      await assert.rejects(
        restoreVendorDisclosureEvidenceBundle({
          bundleDir: fixture.bundleDir,
          currentScanManifestPath: fixture.currentScanManifestPath,
          expectedBundleContentSha256: resignedSha256,
          stateDir: fixture.stateDir,
        }),
        /forbidden absolute path/u,
      );
      await assertStateUnchanged(fixture.stateDir, fixture.sentinelPath);
    });
  }
});

test("rejects embedded relative traversal in path-valued evidence", async (t) => {
  const fixture = await makeFixture(t);
  const resignedSha256 = await mutateReportAndResign(fixture.bundleDir, (report) => {
    report.leaked_path = "label=../outside.json";
  });
  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: resignedSha256,
      stateDir: fixture.stateDir,
    }),
    /forbidden relative path traversal/u,
  );
  await assertStateUnchanged(fixture.stateDir, fixture.sentinelPath);
});

test("rejects a reordered current scan manifest because its ordered binding hash changed", async (t) => {
  const fixture = await makeFixture(t);
  fixture.currentScanManifest.units.reverse();
  await writeJson(fixture.currentScanManifestPath, fixture.currentScanManifest);

  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: fixture.expectedBundleContentSha256,
      stateDir: fixture.stateDir,
    }),
    /current scan manifest binding hash mismatch/u,
  );
  await assertStateUnchanged(fixture.stateDir, fixture.sentinelPath);
});

test("rejects a source bytes mismatch before writing the batch", async (t) => {
  const fixture = await makeFixture(t);
  fixture.currentScanManifest.units[0]!.source_files[0]!.bytes += 1;
  await writeJson(fixture.currentScanManifestPath, fixture.currentScanManifest);

  await assert.rejects(
    restoreVendorDisclosureEvidenceBundle({
      bundleDir: fixture.bundleDir,
      currentScanManifestPath: fixture.currentScanManifestPath,
      expectedBundleContentSha256: fixture.expectedBundleContentSha256,
      stateDir: fixture.stateDir,
    }),
    /current scan manifest binding hash mismatch/u,
  );
  await assertStateUnchanged(fixture.stateDir, fixture.sentinelPath);
});
