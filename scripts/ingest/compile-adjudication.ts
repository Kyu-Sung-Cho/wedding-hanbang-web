import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { z } from "zod";

import { isPathWithin, readJsonFile, sha256File, writeJsonFile } from "./io.js";
import {
  certifiedCanonicalDocxCellLocators,
  type LocalTextEvidence,
} from "./local-extract.js";
import { loadManifest } from "./manifest.js";
import { resolveArtifactSourceProvenance, sourceFileId } from "./provenance.js";
import { GroundTruthAdjudicationSchema } from "./score.js";
import {
  normalizeEvidenceText,
  scanSourceMoneyOccurrences,
  verifyValidationInputsUnchanged,
} from "./validate.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const AdjudicationAdditionsSchema = z.object({
  schema_version: z.literal(1),
  base_adjudication_sha256: Sha256Schema,
  base_ground_truth_sha256: Sha256Schema,
  created_at: z.string().datetime(),
  decisions: GroundTruthAdjudicationSchema.shape.decisions,
}).strict();

const LocatorMigrationOccurrenceSchema = z.object({
  raw: z.string().min(1).max(200),
  krw: z.number().int().nonnegative(),
  line_context: z.string().min(1).max(1_000),
  source_locator: z.string().min(1).max(300),
}).strict();

const LocatorMigrationGroundTruthSchema = z.object({
  generated_at: z.string().datetime(),
  units: z.array(z.object({
    unit_id: z.string().regex(/^[a-f0-9]{64}$/u),
    display_name: z.string().min(1),
    source_paths: z.array(z.string().min(1)).min(1),
    candidate_count: z.number().int().nonnegative(),
    candidates: z.array(LocatorMigrationOccurrenceSchema),
  }).passthrough()).min(1),
}).passthrough();

export const CanonicalDocxLocatorMigrationPlanSchema = z.object({
  schema_version: z.literal(1),
  created_at: z.string().datetime(),
  base_adjudication_sha256: Sha256Schema,
  base_ground_truth_sha256: Sha256Schema,
  units: z.array(z.object({
    unit_id: z.string().regex(/^[a-f0-9]{64}$/u),
    source_fingerprint: Sha256Schema,
  }).strict()).min(1),
}).strict();

function normalizedMigrationContext(value: string): string {
  return normalizeEvidenceText(
    value
      .replace(/^(?:line:\d+|table:[1-9][0-9]*![A-Z]+[1-9][0-9]*):\s*/iu, "")
      .replace(/<br\s*\/?>/giu, " "),
  );
}

function normalizedMigrationRaw(value: string): string {
  return normalizeEvidenceText(value);
}

function krwMultiset(values: ReadonlyArray<{ krw: number }>): string {
  return values.map(({ krw }) => krw).sort((left, right) => left - right).join(",");
}

function lineLocatorNumber(locator: string): number | null {
  const match = /^line:([1-9][0-9]*)$/u.exec(locator);
  return match ? Number(match[1]) : null;
}

function canonicalLocatorOrder(locator: string): [number, number, number] | null {
  const match = /^table:([1-9][0-9]*)!([A-Z]+)([1-9][0-9]*)$/u.exec(locator);
  if (!match) return null;
  const column = [...match[2]!].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
  return [Number(match[1]), Number(match[3]), column];
}

function nondecreasing<T>(values: readonly T[], compare: (left: T, right: T) => number): boolean {
  return values.every((value, index) => index === 0 || compare(values[index - 1]!, value) <= 0);
}

function occurrenceOrdinal(
  occurrences: ReadonlyArray<{ source_locator: string; raw: string }>,
  index: number,
): number {
  const selected = occurrences[index]!;
  return occurrences.slice(0, index + 1).filter((occurrence) =>
    occurrence.source_locator === selected.source_locator && occurrence.raw === selected.raw
  ).length;
}

/**
 * Builds append-only adjudication additions that replace obsolete flattened
 * DOCX line locators with converter-authenticated DOCX v2 table locators.
 * It intentionally supports only a complete, order-preserving 1:1 migration;
 * shared structured prices remain governed by the separate certified vMerge
 * scoring contract and are never fanned out here.
 */
export async function buildCanonicalDocxLocatorMigrationAdditions(input: {
  stateDir: string;
  manifestPath: string;
  groundTruthPath: string;
  baseAdjudicationPath: string;
  planPath: string;
  outputPath: string;
}): Promise<{ outputPath: string; sha256: string; units: number; decisions: number }> {
  const stateDir = path.resolve(input.stateDir);
  const manifestPath = path.resolve(input.manifestPath);
  const groundTruthPath = path.resolve(input.groundTruthPath);
  const baseAdjudicationPath = path.resolve(input.baseAdjudicationPath);
  const planPath = path.resolve(input.planPath);
  const outputPath = path.resolve(input.outputPath);
  for (const candidate of [manifestPath, groundTruthPath, baseAdjudicationPath, planPath, outputPath]) {
    if (!isPathWithin(stateDir, candidate)) {
      throw new Error("canonical DOCX locator migration artifacts must remain inside ignored ingest state");
    }
  }
  if (manifestPath !== path.join(stateDir, "manifest.json")) {
    throw new Error("canonical DOCX locator migration requires the active state manifest");
  }
  let outputExists = true;
  try {
    await access(outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    outputExists = false;
  }
  if (outputExists) {
    throw new Error("canonical DOCX locator migration output must be a new immutable artifact");
  }

  const [manifest, groundTruthRaw, groundTruthDigest, baseRaw, baseDigest, planRaw] = await Promise.all([
    loadManifest(stateDir),
    readJsonFile(groundTruthPath),
    sha256File(groundTruthPath),
    readJsonFile(baseAdjudicationPath),
    sha256File(baseAdjudicationPath),
    readJsonFile(planPath),
  ]);
  const groundTruth = LocatorMigrationGroundTruthSchema.parse(groundTruthRaw);
  const base = GroundTruthAdjudicationSchema.parse(baseRaw);
  const plan = CanonicalDocxLocatorMigrationPlanSchema.parse(planRaw);
  if (
    plan.base_ground_truth_sha256 !== groundTruthDigest.sha256
    || base.base_ground_truth_sha256 !== groundTruthDigest.sha256
  ) {
    throw new Error("canonical DOCX locator migration ground-truth SHA-256 mismatch");
  }
  if (plan.base_adjudication_sha256 !== baseDigest.sha256) {
    throw new Error("canonical DOCX locator migration base adjudication SHA-256 mismatch");
  }
  if (new Set(plan.units.map(({ unit_id }) => unit_id)).size !== plan.units.length) {
    throw new Error("canonical DOCX locator migration plan unit IDs must be unique");
  }

  const decisions: z.infer<typeof GroundTruthAdjudicationSchema>["decisions"] = [];
  for (const requested of plan.units) {
    const unit = manifest.units.find(({ unit_id }) => unit_id === requested.unit_id);
    const inventoryUnit = groundTruth.units.find(({ unit_id }) => unit_id === requested.unit_id);
    if (!unit || !inventoryUnit) {
      throw new Error(`canonical DOCX locator migration unit missing: ${requested.unit_id}`);
    }
    if (unit.source_fingerprint !== requested.source_fingerprint) {
      throw new Error(`canonical DOCX locator migration source fingerprint mismatch: ${requested.unit_id}`);
    }
    if (
      unit.source_files.length !== 1
      || unit.source_files[0]!.ext !== "docx"
      || inventoryUnit.source_paths.length !== 1
      || inventoryUnit.source_paths[0] !== unit.source_files[0]!.path
    ) {
      throw new Error(`canonical DOCX locator migration requires one exact DOCX source: ${requested.unit_id}`);
    }
    if (inventoryUnit.candidate_count !== inventoryUnit.candidates.length) {
      throw new Error(`canonical DOCX locator migration inventory count mismatch: ${requested.unit_id}`);
    }
    await verifyValidationInputsUnchanged(unit, manifest);
    const conversion = unit.conversion;
    if (!conversion || conversion.text_artifacts.length !== 1) {
      throw new Error(`canonical DOCX locator migration requires one canonical text artifact: ${requested.unit_id}`);
    }
    const artifactPath = conversion.text_artifacts[0]!;
    if (!isPathWithin(stateDir, artifactPath)) {
      throw new Error(`canonical DOCX locator migration artifact escapes state: ${requested.unit_id}`);
    }
    const provenance = resolveArtifactSourceProvenance(unit, artifactPath);
    if (
      !provenance.authoritative
      || provenance.ocr_review
      || provenance.sources.length !== 1
      || sourceFileId(provenance.sources[0]!) !== sourceFileId(unit.source_files[0]!)
    ) {
      throw new Error(`canonical DOCX locator migration source provenance is ambiguous: ${requested.unit_id}`);
    }
    const source: LocalTextEvidence = {
      sourceFileId: sourceFileId(unit.source_files[0]!),
      text: await readFile(artifactPath, "utf8"),
    };
    const certifiedLocators = certifiedCanonicalDocxCellLocators(source);
    if (!certifiedLocators) {
      throw new Error(`canonical DOCX v2 metadata is missing or invalid: ${requested.unit_id}`);
    }
    const canonical = scanSourceMoneyOccurrences(source.text);
    const legacy = inventoryUnit.candidates;
    if (
      canonical.length !== legacy.length
      || krwMultiset(canonical) !== krwMultiset(legacy)
    ) {
      throw new Error(`canonical DOCX locator migration KRW multiset mismatch: ${requested.unit_id}`);
    }
    const legacyLines = legacy.map(({ source_locator }) => lineLocatorNumber(source_locator));
    if (
      legacyLines.some((value) => value === null)
      || !nondecreasing(legacyLines as number[], (left, right) => left - right)
    ) {
      throw new Error(`canonical DOCX locator migration legacy locations are ambiguous: ${requested.unit_id}`);
    }
    const canonicalOrders = canonical.map(({ source_locator }) => canonicalLocatorOrder(source_locator));
    if (
      canonicalOrders.some((value) => value === null)
      || !canonical.every(({ source_locator }) => certifiedLocators.has(source_locator))
      || !nondecreasing(canonicalOrders as Array<[number, number, number]>, (left, right) =>
        left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
      )
    ) {
      throw new Error(`canonical DOCX locator migration target locations are missing or ambiguous: ${requested.unit_id}`);
    }

    for (const [index, prior] of legacy.entries()) {
      const current = canonical[index]!;
      const priorContext = normalizedMigrationContext(prior.line_context);
      const currentContext = normalizedMigrationContext(current.line_context);
      if (
        prior.krw !== current.krw
        || normalizedMigrationRaw(prior.raw) !== normalizedMigrationRaw(current.raw)
        || !priorContext
        || !currentContext
        || !(currentContext.includes(priorContext) || priorContext.includes(currentContext))
      ) {
        throw new Error(`canonical DOCX locator migration context mismatch at ${requested.unit_id}:${index + 1}`);
      }
      decisions.push({
        decision_id: `docx2-locator-${requested.unit_id}-${index + 1}`,
        action: "replace_amount",
        verification: "verified",
        references: [{
          unit_id: requested.unit_id,
          source_locator: prior.source_locator,
          raw: prior.raw,
          ordinal: occurrenceOrdinal(legacy, index),
        }],
        result: {
          unit_id: requested.unit_id,
          raw: current.raw,
          krw: current.krw,
          line_context: current.line_context,
          source_locator: current.source_locator,
          ordinal: occurrenceOrdinal(canonical, index),
        },
        reason: `converter-authenticated DOCX v2 locator migration; source_fingerprint=${requested.source_fingerprint}`,
        reviewed_by: "canonical-docx-locator-migration-v1",
        reviewed_at: plan.created_at,
      });
    }
  }

  const additions = AdjudicationAdditionsSchema.parse({
    schema_version: 1,
    base_adjudication_sha256: plan.base_adjudication_sha256,
    base_ground_truth_sha256: plan.base_ground_truth_sha256,
    created_at: plan.created_at,
    decisions,
  });
  await writeJsonFile(outputPath, additions);
  return {
    outputPath,
    sha256: (await sha256File(outputPath)).sha256,
    units: plan.units.length,
    decisions: decisions.length,
  };
}

export async function compileAdjudication(input: {
  stateDir: string;
  basePath: string;
  additionsPath: string;
  outputPath: string;
}): Promise<{ outputPath: string; sha256: string; decisions: number }> {
  const stateDir = path.resolve(input.stateDir);
  const basePath = path.resolve(input.basePath);
  const additionsPath = path.resolve(input.additionsPath);
  const outputPath = path.resolve(input.outputPath);
  for (const candidate of [basePath, additionsPath, outputPath]) {
    if (!isPathWithin(stateDir, candidate)) {
      throw new Error("adjudication artifacts must remain inside the ignored ingest state directory");
    }
  }
  if (outputPath === basePath || outputPath === additionsPath) {
    throw new Error("compiled adjudication output must be a new immutable artifact");
  }

  const [baseRaw, additionsRaw, baseDigest] = await Promise.all([
    readJsonFile(basePath),
    readJsonFile(additionsPath),
    sha256File(basePath),
  ]);
  const base = GroundTruthAdjudicationSchema.parse(baseRaw);
  const additions = AdjudicationAdditionsSchema.parse(additionsRaw);
  if (additions.base_adjudication_sha256 !== baseDigest.sha256) {
    throw new Error("base adjudication SHA-256 mismatch");
  }
  if (additions.base_ground_truth_sha256 !== base.base_ground_truth_sha256) {
    throw new Error("base ground-truth SHA-256 mismatch");
  }
  const decisions = [...base.decisions, ...additions.decisions];
  const decisionIds = decisions.map((decision) => decision.decision_id);
  if (new Set(decisionIds).size !== decisionIds.length) {
    throw new Error("compiled adjudication decision IDs must be unique");
  }
  const compiled = GroundTruthAdjudicationSchema.parse({
    schema_version: 1,
    created_at: additions.created_at,
    base_ground_truth_sha256: base.base_ground_truth_sha256,
    decisions,
  });
  await writeJsonFile(outputPath, compiled);
  const outputDigest = await sha256File(outputPath);
  return { outputPath, sha256: outputDigest.sha256, decisions: decisions.length };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "build-canonical-docx-locator-additions") {
    const [
      _command,
      stateDir,
      manifestPath,
      groundTruthPath,
      baseAdjudicationPath,
      planPath,
      outputPath,
    ] = args;
    if (
      !stateDir
      || !manifestPath
      || !groundTruthPath
      || !baseAdjudicationPath
      || !planPath
      || !outputPath
    ) {
      throw new Error(
        "usage: compile-adjudication build-canonical-docx-locator-additions <state-dir> <manifest.json> <ground-truth.json> <base-adjudication.json> <plan.json> <output-additions.json>",
      );
    }
    const result = await buildCanonicalDocxLocatorMigrationAdditions({
      stateDir,
      manifestPath,
      groundTruthPath,
      baseAdjudicationPath,
      planPath,
      outputPath,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const [stateDir, basePath, additionsPath, outputPath] = args;
  if (!stateDir || !basePath || !additionsPath || !outputPath) {
    throw new Error("usage: compile-adjudication <state-dir> <base.json> <additions.json> <output.json>");
  }
  const result = await compileAdjudication({ stateDir, basePath, additionsPath, outputPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && /^compile-adjudication\.(?:[cm]?js|ts)$/u.test(path.basename(process.argv[1]))) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
