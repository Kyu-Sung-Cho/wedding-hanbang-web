import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  canonicalJsonSha256ExcludingField,
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import { acquireExtractionLock } from "./extraction-lock.js";
import {
  isPathWithin,
  readJsonFile,
  sha256File,
  sha256Text,
  writeJsonFile,
} from "./io.js";
import {
  currentLocalExtractionFingerprint,
  LOCAL_DETERMINISTIC_ENGINE_HASH,
  LOCAL_DETERMINISTIC_ENGINE_VERSION,
  LOCAL_DETERMINISTIC_MODEL,
  LOCAL_DETERMINISTIC_PROVIDER_MODE,
} from "./local-extraction-contract.js";
import {
  extractDisclosureFromLocalEvidence,
  LOCAL_EXTRACTION_GUARD,
  type LocalTextEvidence,
} from "./local-extract.js";
import { loadManifest, saveManifest } from "./manifest.js";
import {
  prepareStructuredEvidenceText,
  resolveArtifactSourceProvenance,
  sourceFileId,
  sourceFilesForArtifact,
} from "./provenance.js";
import {
  DisclosureExtractionSchema,
  LocalDeterministicExtractionArtifactSchema,
  type DisclosureExtraction,
  type LocalDeterministicExtractionArtifact,
  type VisualTranscriptionExtractionBinding,
} from "./schemas.js";
import type { IngestManifest, ManifestUnit, SourceFile } from "./types.js";
import {
  loadVisualTranscriptionSidecar,
  visualTranscriptionBoundLocalExtractionFingerprint,
  visualTranscriptionExtractionBinding,
} from "./visual-transcription-sidecar.js";

export interface LocalExtractOptions {
  stateDir: string;
  limit?: number;
  unitIds?: string[];
  allowPaidReviewOnly?: boolean;
}

export interface LocalExtractionRunResult {
  manifest: IngestManifest;
  selected_units: number;
  processed_units: number;
  cache_hits: number;
  failed_units: number;
}

const LOCAL_PROVENANCE_NOTICE_PREFIX = "local evidence review:";

interface VerifiedLocalInputs {
  textEvidence: LocalTextEvidence[];
  conversionArtifacts: LocalDeterministicExtractionArtifact["conversion_artifacts"];
  provenanceNotices: string[];
}

export interface VerifiedLocalReviewCandidate {
  data: ReturnType<typeof DisclosureExtractionSchema.parse>;
  conversionArtifacts: LocalDeterministicExtractionArtifact["conversion_artifacts"];
}

function sameResolvedPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function localStratum(unit: ManifestUnit): number {
  const extensions = new Set(unit.source_files.map((source) => source.ext));
  const imageHeavy = extensions.has("png")
    || (extensions.has("pdf")
      && (unit.conversion?.text_characters ?? 0) < 300
      && (unit.conversion?.image_artifacts.length ?? 0) > 0);
  if (imageHeavy) return 0;
  if (extensions.has("docx")) return 1;
  if (extensions.has("pdf")) return 2;
  if (extensions.has("xlsx") && unit.parsed.kind_hint === "hall") return 3;
  if (extensions.has("xlsx") && unit.parsed.kind_hint === "agency") return 4;
  return 5;
}

function isLocallyExtractable(unit: ManifestUnit, allowPaidReviewOnly = false): boolean {
  if (!unit.conversion || ["scanned", "needs_manual_conversion", "loaded"].includes(unit.stage)) {
    return false;
  }
  if (unit.extraction && !allowPaidReviewOnly) return false;
  if (unit.stage === "validated") {
    const local = unit.local_extraction;
    return Boolean(
      local
      && (
        local.provider_mode !== LOCAL_DETERMINISTIC_PROVIDER_MODE
        || local.model !== LOCAL_DETERMINISTIC_MODEL
        || local.engine_version !== LOCAL_DETERMINISTIC_ENGINE_VERSION
        || local.engine_hash !== LOCAL_DETERMINISTIC_ENGINE_HASH
      )
    );
  }
  return ["converted", "error", "extracted"].includes(unit.stage);
}

export function selectLocalExtractionUnits(
  manifest: IngestManifest,
  options: Pick<LocalExtractOptions, "limit" | "unitIds" | "allowPaidReviewOnly">,
): ManifestUnit[] {
  if (options.allowPaidReviewOnly && !options.unitIds) {
    throw new Error("allow_paid_review_only_requires_explicit_units");
  }
  const eligible = manifest.units.filter((unit) => (
    isLocallyExtractable(unit, options.allowPaidReviewOnly === true)
  ));
  if (options.unitIds) {
    const byId = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
    const unknown = options.unitIds.find((unitId) => !byId.has(unitId));
    if (unknown) throw new Error(`unknown_unit_id:${unknown}`);
    const selected = options.unitIds.map((unitId) => byId.get(unitId)!);
    const blocked = selected.find((unit) => (
      !isLocallyExtractable(unit, options.allowPaidReviewOnly === true)
    ));
    if (blocked) throw new Error(`local_unit_not_extractable:${blocked.unit_id}`);
    return selected;
  }
  const ordered = [...eligible].sort((left, right) =>
    localStratum(left) - localStratum(right)
    || left.unit_id.localeCompare(right.unit_id, "en")
  );
  if (!options.limit || options.limit >= ordered.length) return ordered;
  const buckets = Array.from({ length: 6 }, () => [] as ManifestUnit[]);
  for (const unit of ordered) buckets[localStratum(unit)]!.push(unit);
  const selected: ManifestUnit[] = [];
  while (selected.length < options.limit) {
    let madeProgress = false;
    for (const bucket of buckets) {
      const unit = bucket.shift();
      if (!unit) continue;
      selected.push(unit);
      madeProgress = true;
      if (selected.length === options.limit) break;
    }
    if (!madeProgress) break;
  }
  return selected;
}

async function hasVerifiedStaleVisualTranscriptionBinding(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
): Promise<boolean> {
  const local = unit.local_extraction;
  if (
    unit.stage !== "validated"
    || unit.extraction
    || !unit.conversion
    || !local
    || local.provider_mode !== LOCAL_DETERMINISTIC_PROVIDER_MODE
    || local.model !== LOCAL_DETERMINISTIC_MODEL
    || local.engine_version !== LOCAL_DETERMINISTIC_ENGINE_VERSION
    || local.engine_hash !== LOCAL_DETERMINISTIC_ENGINE_HASH
  ) {
    return false;
  }
  await verifyLocalInputs(unit, manifest);
  const sidecar = await loadVisualTranscriptionSidecar({
    stateDir,
    manifest,
    unitId: unit.unit_id,
  });
  const currentBinding = sidecar
    ? visualTranscriptionExtractionBinding(sidecar)
    : null;
  return !isDeepStrictEqual(
    local.visual_transcription ?? null,
    currentBinding,
  );
}

async function selectLocalExtractionUnitsForRun(
  manifest: IngestManifest,
  options: LocalExtractOptions,
): Promise<ManifestUnit[]> {
  if (!options.unitIds) return selectLocalExtractionUnits(manifest, options);
  const byId = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
  const unknown = options.unitIds.find((unitId) => !byId.has(unitId));
  if (unknown) throw new Error(`unknown_unit_id:${unknown}`);
  const selected = options.unitIds.map((unitId) => byId.get(unitId)!);
  for (const unit of selected) {
    if (isLocallyExtractable(unit, options.allowPaidReviewOnly === true)) continue;
    if (await hasVerifiedStaleVisualTranscriptionBinding(
      unit,
      manifest,
      options.stateDir,
    )) continue;
    throw new Error(`local_unit_not_extractable:${unit.unit_id}`);
  }
  return selected;
}

async function verifyLocalInputs(
  unit: ManifestUnit,
  manifest: IngestManifest,
): Promise<VerifiedLocalInputs> {
  const conversion = unit.conversion;
  if (!conversion || conversion.source_fingerprint !== unit.source_fingerprint) {
    throw new Error("local_conversion_source_fingerprint_mismatch");
  }
  const rootDir = path.resolve(manifest.root_dir);
  const rootRealPath = await realpath(rootDir);
  for (const source of unit.source_files) {
    const expectedPath = path.resolve(rootDir, source.path);
    if (!isPathWithin(rootDir, expectedPath) || path.resolve(source.absolute_path) !== expectedPath) {
      throw new Error(`local_source_path_mismatch:${source.path}`);
    }
    const sourceRealPath = await realpath(expectedPath);
    if (!isPathWithin(rootRealPath, sourceRealPath)) {
      throw new Error(`local_source_path_escape:${source.path}`);
    }
    const digest = await sha256File(sourceRealPath);
    if (digest.sha256 !== source.sha256 || digest.bytes !== source.bytes) {
      throw new Error(`local_source_changed:${source.path}`);
    }
  }

  const convertedRoot = path.join(path.resolve(manifest.state_dir), ".converted");
  const convertedRootRealPath = await realpath(convertedRoot);
  const unitConvertedRoot = path.join(
    convertedRoot,
    unit.unit_id,
    unit.source_fingerprint,
  );
  const expectedUnitConvertedRootRealPath = path.join(
    convertedRootRealPath,
    unit.unit_id,
    unit.source_fingerprint,
  );
  let verifiedUnitConvertedRootRealPath: string | null = null;
  const rawPngRealPaths = new Set(await Promise.all(
    unit.source_files
      .filter((source) => source.ext === "png")
      .map((source) => realpath(source.absolute_path)),
  ));
  const textEvidenceBySource = new Map<string, string[]>();
  const conversionArtifacts: LocalDeterministicExtractionArtifact["conversion_artifacts"] = [];
  const allArtifacts = [
    ...conversion.text_artifacts.map((artifactPath) => ({ artifactPath, kind: "text" as const })),
    ...conversion.image_artifacts.map((artifactPath) => ({ artifactPath, kind: "image" as const })),
  ].sort((left, right) => left.artifactPath.localeCompare(right.artifactPath, "en"));
  if (allArtifacts.length === 0) throw new Error("local_conversion_artifacts_missing");
  const fingerprintRecords: string[] = [];
  const verifiedArtifacts: Array<{
    artifactPath: string;
    artifactRealPath: string;
    kind: "text" | "image";
    sha256: string;
  }> = [];
  for (const artifact of allArtifacts) {
    const resolvedPath = path.resolve(artifact.artifactPath);
    const artifactRealPath = await realpath(resolvedPath);
    let convertedArtifact = false;
    if (isPathWithin(unitConvertedRoot, resolvedPath)) {
      verifiedUnitConvertedRootRealPath ??= await realpath(unitConvertedRoot);
      if (!sameResolvedPath(
        verifiedUnitConvertedRootRealPath,
        expectedUnitConvertedRootRealPath,
      )) {
        throw new Error(`local_conversion_unit_root_redirected:${artifact.artifactPath}`);
      }
      convertedArtifact = isPathWithin(
        verifiedUnitConvertedRootRealPath,
        artifactRealPath,
      );
    }
    if (!convertedArtifact && !(artifact.kind === "image" && rawPngRealPaths.has(artifactRealPath))) {
      throw new Error(`local_conversion_artifact_path_escape:${artifact.artifactPath}`);
    }
    const digest = await sha256File(artifactRealPath);
    fingerprintRecords.push(`${resolvedPath}\0${digest.sha256}`);
    conversionArtifacts.push({
      path: resolvedPath,
      sha256: digest.sha256,
      bytes: digest.bytes,
      kind: artifact.kind,
    });
    verifiedArtifacts.push({
      artifactPath: resolvedPath,
      artifactRealPath,
      kind: artifact.kind,
      sha256: digest.sha256,
    });
  }
  if (sha256Text(fingerprintRecords.join("\n")) !== conversion.artifact_fingerprint) {
    throw new Error("local_conversion_artifact_changed");
  }

  const sourceImageSourcesBySha256 = new Map<string, SourceFile[]>();
  for (const artifact of verifiedArtifacts) {
    if (artifact.kind !== "image") continue;
    const resolution = resolveArtifactSourceProvenance(unit, artifact.artifactPath);
    if (!resolution.authoritative || resolution.sources.length !== 1) continue;
    const current = sourceImageSourcesBySha256.get(artifact.sha256) ?? [];
    const source = resolution.sources[0]!;
    if (!current.some((candidate) => sourceFileId(candidate) === sourceFileId(source))) {
      current.push(source);
    }
    sourceImageSourcesBySha256.set(artifact.sha256, current);
  }

  const provenanceNotices: string[] = [];
  let ambiguousOcrArtifacts = 0;
  let excludedOcrReviewArtifacts = 0;
  let excludedContactLines = 0;
  let excludedOcrMetadataLines = 0;
  for (const artifact of verifiedArtifacts) {
    if (artifact.kind !== "text") continue;
    const resolution = resolveArtifactSourceProvenance(unit, artifact.artifactPath, {
      sourceImageSourcesBySha256,
    });
    // A raster digest may prove which source produced an OCR artifact, but it
    // never upgrades the converter's non-authoritative review-only evidence.
    if (resolution.ocr_review) {
      if (!resolution.authoritative || resolution.sources.length !== 1) {
        ambiguousOcrArtifacts += 1;
      } else {
        excludedOcrReviewArtifacts += 1;
      }
      continue;
    }
    const rawText = await readFile(artifact.artifactRealPath, "utf8");
    const prepared = prepareStructuredEvidenceText(rawText, {
      ocrReviewArtifact: resolution.ocr_review,
    });
    excludedContactLines += prepared.excluded_contact_lines;
    excludedOcrMetadataLines += prepared.excluded_ocr_metadata_lines;
    const sources = resolution.authoritative
      ? resolution.sources
      : sourceFilesForArtifact(unit, artifact.artifactPath);
    for (const source of sources) {
      const id = sourceFileId(source);
      textEvidenceBySource.set(id, [
        ...(textEvidenceBySource.get(id) ?? []),
        prepared.text,
      ]);
    }
  }
  if (ambiguousOcrArtifacts > 0) {
    provenanceNotices.push(
      `ocr_shared_artifact_not_source_mapped:${ambiguousOcrArtifacts}`,
    );
  }
  if (excludedOcrReviewArtifacts > 0) {
    provenanceNotices.push(`ocr_review_artifact_excluded:${excludedOcrReviewArtifacts}`);
  }
  if (excludedOcrMetadataLines > 0) {
    provenanceNotices.push(`ocr_metadata_lines_excluded:${excludedOcrMetadataLines}`);
  }
  if (excludedContactLines > 0) {
    provenanceNotices.push(`public_contact_lines_excluded:${excludedContactLines}`);
  }
  const textEvidence = [...textEvidenceBySource.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([id, texts]) => ({ sourceFileId: id, text: texts.join("\n") }));
  return { textEvidence, conversionArtifacts, provenanceNotices };
}

function forceReviewOnly(
  data: DisclosureExtraction,
  provenanceNotices: readonly string[] = [],
): ReturnType<typeof DisclosureExtractionSchema.parse> {
  const result = DisclosureExtractionSchema.parse(structuredClone(data));
  for (const row of result.agency_packages) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  for (const row of result.partner_vendors) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  for (const row of result.halls) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  for (const row of result.sections) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  for (const row of result.money_occurrences) row.needs_review = true;
  result.hall.needs_review = true;
  result.hall.confidence = Math.min(result.hall.confidence, 0.5);
  for (const row of result.hall.items) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  const reviewNotices = provenanceNotices.map((notice) => `[provenance_review] ${notice}`);
  result.extraction_notes = [
    LOCAL_EXTRACTION_GUARD,
    ...reviewNotices,
    result.extraction_notes.replace(`${LOCAL_EXTRACTION_GUARD}\n`, ""),
  ].filter(Boolean).join("\n").slice(0, 4_000);
  return result;
}

function deriveLocalReviewData(
  unit: ManifestUnit,
  inputs: VerifiedLocalInputs,
): ReturnType<typeof DisclosureExtractionSchema.parse> {
  return forceReviewOnly(extractDisclosureFromLocalEvidence({
    canonicalName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    hasImages: (unit.conversion?.image_artifacts.length ?? 0) > 0,
    sources: inputs.textEvidence,
  }), inputs.provenanceNotices);
}

function applyLocalProvenanceNotices(
  unit: ManifestUnit,
  notices: readonly string[],
): void {
  unit.notices = Array.from(new Set([
    ...unit.notices.filter((notice) =>
      !notice.startsWith(LOCAL_PROVENANCE_NOTICE_PREFIX)
    ),
    ...notices.map((notice) => `${LOCAL_PROVENANCE_NOTICE_PREFIX} ${notice}`),
  ]));
}

/**
 * Verifies immutable source/conversion evidence and derives the review-only
 * local payload without writing cache or manifest state.
 */
export async function deriveVerifiedLocalReviewCandidateForUnit(
  unit: ManifestUnit,
  manifest: IngestManifest,
): Promise<VerifiedLocalReviewCandidate> {
  const inputs = await verifyLocalInputs(unit, manifest);
  return {
    data: deriveLocalReviewData(unit, inputs),
    conversionArtifacts: inputs.conversionArtifacts,
  };
}

function localMetadata(
  artifact: LocalDeterministicExtractionArtifact,
  artifactPath: string,
  cacheHit: boolean,
  paidReviewOnlyOverride = false,
): NonNullable<ManifestUnit["local_extraction"]> {
  return {
    provider_mode: LOCAL_DETERMINISTIC_PROVIDER_MODE,
    fingerprint: artifact.fingerprint,
    content_sha256: artifact.content_sha256,
    source_fingerprint: artifact.source_fingerprint,
    artifact_fingerprint: artifact.artifact_fingerprint,
    scanner_parser_version: artifact.scanner_parser_version,
    converter_version: artifact.converter_version,
    model: LOCAL_DETERMINISTIC_MODEL,
    artifact_path: artifactPath,
    cache_hit: cacheHit,
    attempts: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
    engine_version: artifact.engine_version,
    engine_hash: artifact.engine_hash,
    review_status: "pending",
    needs_review: true,
    bulk_approval_eligible: false,
    ...(artifact.visual_transcription
      ? { visual_transcription: artifact.visual_transcription }
      : {}),
    ...(paidReviewOnlyOverride ? { paid_review_only_override: true as const } : {}),
    extracted_at: artifact.created_at,
  };
}

async function readLocalCache(
  stateDir: string,
  artifactPath: string,
  expected: {
    unit: ManifestUnit;
    manifest: IngestManifest;
    fingerprint: string;
    verifiedInputs: VerifiedLocalInputs;
    visualTranscription: VisualTranscriptionExtractionBinding | null;
  },
): Promise<LocalDeterministicExtractionArtifact | null> {
  try {
    await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath,
      expectedRelativePath: path.join(".cache", "extract-local", `${expected.fingerprint}.json`),
    });
    const raw = await readJsonFile(artifactPath);
    const parsed = LocalDeterministicExtractionArtifactSchema.safeParse(raw);
    if (!parsed.success) throw new Error("local_extraction_cache_schema_invalid");
    verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
    const artifact = parsed.data;
    const converterVersion = expected.unit.conversion?.converter_version ?? "v1-legacy";
    const expectedSourceFiles = expected.unit.source_files.map((source) => ({
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
    }));
    if (
      artifact.unit_id !== expected.unit.unit_id
      || artifact.fingerprint !== expected.fingerprint
      || artifact.source_fingerprint !== expected.unit.source_fingerprint
      || artifact.artifact_fingerprint !== expected.unit.conversion?.artifact_fingerprint
      || artifact.scanner_parser_version !== expected.manifest.scanner_parser_version
      || artifact.converter_version !== converterVersion
      || artifact.engine_version !== LOCAL_DETERMINISTIC_ENGINE_VERSION
      || artifact.engine_hash !== LOCAL_DETERMINISTIC_ENGINE_HASH
      || JSON.stringify(artifact.source_files) !== JSON.stringify(expectedSourceFiles)
      || JSON.stringify(artifact.conversion_artifacts)
        !== JSON.stringify(expected.verifiedInputs.conversionArtifacts)
      || !isDeepStrictEqual(
        artifact.visual_transcription ?? null,
        expected.visualTranscription,
      )
    ) {
      throw new Error("local_extraction_cache_provenance_mismatch");
    }
    if (!isDeepStrictEqual(artifact.data, deriveLocalReviewData(
      expected.unit,
      expected.verifiedInputs,
    ))) {
      throw new Error("local_extraction_cache_replay_mismatch");
    }
    return artifact;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function verifyCurrentLocalExtractionCacheForUnit(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
): Promise<LocalDeterministicExtractionArtifact> {
  const conversion = unit.conversion;
  const metadata = unit.local_extraction;
  if (
    !conversion
    || !metadata
    || metadata.provider_mode !== LOCAL_DETERMINISTIC_PROVIDER_MODE
    || metadata.model !== LOCAL_DETERMINISTIC_MODEL
  ) {
    throw new Error("local_extraction_cache_metadata_missing");
  }
  const verifiedInputs = await verifyLocalInputs(unit, manifest);
  const sidecar = await loadVisualTranscriptionSidecar({
    stateDir,
    manifest,
    unitId: unit.unit_id,
  });
  const visualTranscription = sidecar
    ? visualTranscriptionExtractionBinding(sidecar)
    : null;
  const baseFingerprint = currentLocalExtractionFingerprint({
    scannerParserVersion: manifest.scanner_parser_version,
    converterVersion: conversion.converter_version ?? "v1-legacy",
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: conversion.artifact_fingerprint,
  });
  const fingerprint = visualTranscriptionBoundLocalExtractionFingerprint(
    baseFingerprint,
    visualTranscription,
  );
  const artifactPath = path.join(path.resolve(stateDir), ".cache", "extract-local", `${fingerprint}.json`);
  if (
    path.resolve(metadata.artifact_path) !== artifactPath
    || metadata.fingerprint !== fingerprint
    || !isDeepStrictEqual(metadata.visual_transcription ?? null, visualTranscription)
  ) {
    throw new Error("local_extraction_cache_manifest_identity_mismatch");
  }
  const artifact = await readLocalCache(stateDir, artifactPath, {
    unit,
    manifest,
    fingerprint,
    verifiedInputs,
    visualTranscription,
  });
  if (!artifact || artifact.content_sha256 !== metadata.content_sha256) {
    throw new Error("local_extraction_cache_replay_failed");
  }
  return artifact;
}

async function extractManifestLocallyUnlocked(
  options: LocalExtractOptions,
): Promise<LocalExtractionRunResult> {
  const manifest = await loadManifest(options.stateDir);
  const selected = await selectLocalExtractionUnitsForRun(manifest, options);
  let processedUnits = 0;
  let cacheHits = 0;
  let failedUnits = 0;
  for (const unit of selected) {
    try {
      const conversion = unit.conversion;
      if (!conversion) throw new Error("local_conversion_missing");
      const inputs = await verifyLocalInputs(unit, manifest);
      const sidecar = await loadVisualTranscriptionSidecar({
        stateDir: options.stateDir,
        manifest,
        unitId: unit.unit_id,
      });
      const visualTranscription = sidecar
        ? visualTranscriptionExtractionBinding(sidecar)
        : null;
      const converterVersion = conversion.converter_version ?? "v1-legacy";
      const baseFingerprint = currentLocalExtractionFingerprint({
        scannerParserVersion: manifest.scanner_parser_version,
        converterVersion,
        rawName: unit.parsed.raw_name,
        regionCode: unit.parsed.region_code,
        kindHint: unit.parsed.kind_hint,
        sourceFingerprint: unit.source_fingerprint,
        artifactFingerprint: conversion.artifact_fingerprint,
      });
      const fingerprint = visualTranscriptionBoundLocalExtractionFingerprint(
        baseFingerprint,
        visualTranscription,
      );
      const artifactPath = path.join(
        path.resolve(options.stateDir),
        ".cache",
        "extract-local",
        `${fingerprint}.json`,
      );
      const cached = await readLocalCache(options.stateDir, artifactPath, {
        unit,
        manifest,
        fingerprint,
        verifiedInputs: inputs,
        visualTranscription,
      });
      if (cached) {
        unit.local_extraction = localMetadata(
          cached,
          artifactPath,
          true,
          options.allowPaidReviewOnly === true,
        );
        unit.stage = "extracted";
        delete unit.validation;
        unit.notices = unit.notices.filter((notice) =>
          !notice.startsWith("local extract failed:")
          && !notice.startsWith("validate failed:")
        );
        applyLocalProvenanceNotices(unit, inputs.provenanceNotices);
        cacheHits += 1;
        processedUnits += 1;
        await saveManifest(manifest);
        continue;
      }
      const data = deriveLocalReviewData(unit, inputs);
      const artifactCandidate = {
        schema_version: 1 as const,
        artifact_kind: "local_deterministic_extraction" as const,
        provider_mode: LOCAL_DETERMINISTIC_PROVIDER_MODE,
        model: LOCAL_DETERMINISTIC_MODEL,
        content_sha256: "0".repeat(64),
        unit_id: unit.unit_id,
        fingerprint,
        source_fingerprint: unit.source_fingerprint,
        artifact_fingerprint: conversion.artifact_fingerprint,
        scanner_parser_version: manifest.scanner_parser_version,
        converter_version: converterVersion,
        engine_version: LOCAL_DETERMINISTIC_ENGINE_VERSION,
        engine_hash: LOCAL_DETERMINISTIC_ENGINE_HASH,
        source_files: unit.source_files.map((source) => ({
          path: source.path,
          sha256: source.sha256,
          bytes: source.bytes,
        })),
        conversion_artifacts: inputs.conversionArtifacts,
        data,
        attempts: 0 as const,
        input_tokens: 0 as const,
        output_tokens: 0 as const,
        estimated_cost_usd: 0 as const,
        review_status: "pending" as const,
        needs_review: true as const,
        bulk_approval_eligible: false as const,
        ...(visualTranscription
          ? { visual_transcription: visualTranscription }
          : {}),
        created_at: new Date().toISOString(),
      };
      artifactCandidate.content_sha256 = canonicalJsonSha256ExcludingField(
        artifactCandidate,
        "content_sha256",
      );
      const artifact = LocalDeterministicExtractionArtifactSchema.parse(artifactCandidate);
      await prepareDeterministicStateArtifactWritePath({
        stateDir: options.stateDir,
        artifactPath,
        expectedRelativePath: path.join(".cache", "extract-local", `${fingerprint}.json`),
      });
      await writeJsonFile(artifactPath, artifact);
      unit.local_extraction = localMetadata(
        artifact,
        artifactPath,
        false,
        options.allowPaidReviewOnly === true,
      );
      unit.stage = "extracted";
      delete unit.validation;
      unit.notices = unit.notices.filter((notice) =>
        !notice.startsWith("local extract failed:")
        && !notice.startsWith("validate failed:")
      );
      applyLocalProvenanceNotices(unit, inputs.provenanceNotices);
      processedUnits += 1;
    } catch (error) {
      failedUnits += 1;
      unit.stage = "error";
      delete unit.local_extraction;
      delete unit.validation;
      const message = error instanceof Error ? error.message : "unknown_local_extraction_error";
      unit.notices = Array.from(new Set([
        ...unit.notices,
        `local extract failed: ${message}`,
      ]));
    }
    await saveManifest(manifest);
  }
  return {
    manifest,
    selected_units: selected.length,
    processed_units: processedUnits,
    cache_hits: cacheHits,
    failed_units: failedUnits,
  };
}

export async function extractManifestLocally(
  options: LocalExtractOptions,
): Promise<LocalExtractionRunResult> {
  const releaseLock = await acquireExtractionLock(options.stateDir);
  try {
    return await extractManifestLocallyUnlocked(options);
  } finally {
    await releaseLock();
  }
}
