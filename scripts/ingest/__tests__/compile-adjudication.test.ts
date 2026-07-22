import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCanonicalDocxLocatorMigrationAdditions,
  compileAdjudication,
} from "../compile-adjudication.js";
import { CONVERTER_VERSION } from "../convert.js";
import { sha256File, sha256Text, writeJsonFile } from "../io.js";
import { SCANNER_PARSER_VERSION } from "../scan.js";

const SHA = "a".repeat(64);

function docxCellMetadata(locator: string): string {
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
    vertical_merge: null,
    empty: false,
  }), "utf8").toString("base64url")}`;
}

test("adjudication compilation is append-only and hash-bound", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "adjudication-compile-"));
  const basePath = path.join(stateDir, "base.json");
  const additionsPath = path.join(stateDir, "additions.json");
  const outputPath = path.join(stateDir, "compiled.json");
  await writeJsonFile(basePath, {
    schema_version: 1,
    created_at: "2026-07-20T00:00:00.000Z",
    base_ground_truth_sha256: SHA,
    decisions: [],
  });
  await writeJsonFile(additionsPath, {
    schema_version: 1,
    base_adjudication_sha256: (await sha256File(basePath)).sha256,
    base_ground_truth_sha256: SHA,
    created_at: "2026-07-21T00:00:00.000Z",
    decisions: [{
      decision_id: "source-audit-addition",
      action: "add_missing",
      verification: "verified",
      references: [],
      result: {
        unit_id: "b".repeat(64),
        raw: "10만원",
        krw: 100_000,
        line_context: "Sheet!A1: 10만원",
        source_locator: "Sheet!A1",
        ordinal: 1,
      },
      reason: "exact source audit",
      reviewed_by: "reviewer",
      reviewed_at: "2026-07-21T00:00:00.000Z",
    }],
  });
  const result = await compileAdjudication({ stateDir, basePath, additionsPath, outputPath });
  assert.equal(result.decisions, 1);
  assert.match(result.sha256, /^[a-f0-9]{64}$/u);
  await assert.rejects(
    compileAdjudication({ stateDir, basePath, additionsPath, outputPath: basePath }),
    /new immutable artifact/u,
  );
});

test("canonical DOCX locator migration is source-bound and preserves every occurrence", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "adjudication-docx2-migration-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const rawRoot = path.join(stateDir, "raw");
  const rawPath = path.join(rawRoot, "agency", "region", "sample.docx");
  const convertedPath = path.join(stateDir, ".converted", "sample", "1-doc.txt");
  await mkdir(path.dirname(rawPath), { recursive: true });
  await mkdir(path.dirname(convertedPath), { recursive: true });
  await writeFile(rawPath, "immutable synthetic DOCX source", "utf8");
  const convertedText = [
    "table:1!A1: 기본 구성 100만원",
    docxCellMetadata("table:1!A1"),
    "table:1!A2: 선택 추가 20만원",
    docxCellMetadata("table:1!A2"),
  ].join("\n");
  await writeFile(convertedPath, convertedText, "utf8");
  const rawDigest = await sha256File(rawPath);
  const convertedDigest = await sha256File(convertedPath);
  const unitId = "b".repeat(64);
  const sourceFingerprint = sha256Text("synthetic-docx-source-fingerprint");
  const sourcePath = "agency/region/sample.docx";
  await writeJsonFile(path.join(stateDir, "manifest.json"), {
    schema_version: 1,
    scanner_parser_version: SCANNER_PARSER_VERSION,
    root_dir: rawRoot,
    state_dir: stateDir,
    scanned_at: new Date(0).toISOString(),
    units: [{
      unit_id: unitId,
      display_name: "sample.docx",
      parsed: {
        region_code: "gyeonggi",
        raw_name: "샘플웨딩",
        normalized_name: "샘플웨딩",
        corporate_name: null,
        kind_hint: "agency",
      },
      source_files: [{
        path: sourcePath,
        absolute_path: rawPath,
        ext: "docx",
        sha256: rawDigest.sha256,
        bytes: rawDigest.bytes,
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
        cell_count: 2,
        artifact_fingerprint: sha256Text(
          `${path.resolve(convertedPath)}\0${convertedDigest.sha256}`,
        ),
        converted_at: new Date(0).toISOString(),
      },
    }],
  });

  const groundTruthPath = path.join(stateDir, "ground-truth.json");
  await writeJsonFile(groundTruthPath, {
    generated_at: new Date(0).toISOString(),
    units: [{
      unit_id: unitId,
      display_name: "sample.docx",
      source_paths: [sourcePath],
      candidate_count: 2,
      candidates: [
        { raw: "100만원", krw: 1_000_000, line_context: "기본 구성 100만원", source_locator: "line:10" },
        { raw: "20만원", krw: 200_000, line_context: "선택 추가 20만원", source_locator: "line:20" },
      ],
    }],
  });
  const basePath = path.join(stateDir, "base.json");
  await writeJsonFile(basePath, {
    schema_version: 1,
    created_at: new Date(0).toISOString(),
    base_ground_truth_sha256: (await sha256File(groundTruthPath)).sha256,
    decisions: [],
  });
  const planPath = path.join(stateDir, "migration-plan.json");
  await writeJsonFile(planPath, {
    schema_version: 1,
    created_at: "2026-07-22T00:00:00.000Z",
    base_adjudication_sha256: (await sha256File(basePath)).sha256,
    base_ground_truth_sha256: (await sha256File(groundTruthPath)).sha256,
    units: [{ unit_id: unitId, source_fingerprint: sourceFingerprint }],
  });
  const outputPath = path.join(stateDir, "additions.json");
  const result = await buildCanonicalDocxLocatorMigrationAdditions({
    stateDir,
    manifestPath: path.join(stateDir, "manifest.json"),
    groundTruthPath,
    baseAdjudicationPath: basePath,
    planPath,
    outputPath,
  });
  assert.equal(result.units, 1);
  assert.equal(result.decisions, 2);
  const additions = JSON.parse(await readFile(outputPath, "utf8")) as {
    decisions: Array<{
      action: string;
      verification: string;
      references: Array<{ source_locator: string }>;
      result: { source_locator: string; krw: number };
    }>;
  };
  assert.deepEqual(
    additions.decisions.map((decision) => ({
      action: decision.action,
      verification: decision.verification,
      from: decision.references[0]?.source_locator,
      to: decision.result.source_locator,
      krw: decision.result.krw,
    })),
    [
      { action: "replace_amount", verification: "verified", from: "line:10", to: "table:1!A1", krw: 1_000_000 },
      { action: "replace_amount", verification: "verified", from: "line:20", to: "table:1!A2", krw: 200_000 },
    ],
  );

  await assert.rejects(
    buildCanonicalDocxLocatorMigrationAdditions({
      stateDir,
      manifestPath: path.join(stateDir, "manifest.json"),
      groundTruthPath,
      baseAdjudicationPath: basePath,
      planPath,
      outputPath,
    }),
    /new immutable artifact/u,
  );

  const wrongFingerprintPlanPath = path.join(stateDir, "wrong-fingerprint-plan.json");
  await writeJsonFile(wrongFingerprintPlanPath, {
    schema_version: 1,
    created_at: "2026-07-22T00:00:00.000Z",
    base_adjudication_sha256: (await sha256File(basePath)).sha256,
    base_ground_truth_sha256: (await sha256File(groundTruthPath)).sha256,
    units: [{ unit_id: unitId, source_fingerprint: "c".repeat(64) }],
  });
  await assert.rejects(
    buildCanonicalDocxLocatorMigrationAdditions({
      stateDir,
      manifestPath: path.join(stateDir, "manifest.json"),
      groundTruthPath,
      baseAdjudicationPath: basePath,
      planPath: wrongFingerprintPlanPath,
      outputPath: path.join(stateDir, "wrong-fingerprint-additions.json"),
    }),
    /source fingerprint mismatch/u,
  );

  const manifestPath = path.join(stateDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    units: Array<{ conversion: { artifact_fingerprint: string; text_characters: number } }>;
  };
  const metadataFreeText = "table:1!A1: 기본 구성 100만원\ntable:1!A2: 선택 추가 20만원";
  await writeFile(convertedPath, metadataFreeText, "utf8");
  const metadataFreeDigest = await sha256File(convertedPath);
  manifest.units[0]!.conversion.artifact_fingerprint = sha256Text(
    `${path.resolve(convertedPath)}\0${metadataFreeDigest.sha256}`,
  );
  manifest.units[0]!.conversion.text_characters = metadataFreeText.length;
  await writeJsonFile(manifestPath, manifest);
  await assert.rejects(
    buildCanonicalDocxLocatorMigrationAdditions({
      stateDir,
      manifestPath,
      groundTruthPath,
      baseAdjudicationPath: basePath,
      planPath,
      outputPath: path.join(stateDir, "metadata-free-additions.json"),
    }),
    /metadata is missing or invalid/u,
  );
});
