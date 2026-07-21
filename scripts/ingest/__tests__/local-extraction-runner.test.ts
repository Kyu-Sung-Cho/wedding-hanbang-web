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
import { acquireExtractionLock } from "../extraction-lock.js";
import { readJsonFile, sha256File, sha256Text, writeJsonFile } from "../io.js";
import {
  extractManifestLocally,
  selectLocalExtractionUnits,
  verifyCurrentLocalExtractionCacheForUnit,
} from "../local-extraction-runner.js";
import type { IngestManifest, ManifestUnit, SourceExtension } from "../types.js";

const execFileAsync = promisify(execFile);
const tsxImport = pathToFileURL(
  createRequire(path.join(process.cwd(), "package.json")).resolve("tsx"),
).href;

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
    scanner_parser_version: "fixture-scanner-v1",
    root_dir: rootDir,
    state_dir: stateDir,
    scanned_at: new Date(0).toISOString(),
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
        converter_version: "fixture-converter-v1",
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
