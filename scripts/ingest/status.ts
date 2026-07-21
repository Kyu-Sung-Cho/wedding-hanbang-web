import path from "node:path";

import { CONVERTER_VERSION, isCurrentConversionFailureNotice } from "./convert.js";
import {
  currentExtractionFingerprint,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
} from "./extraction-contract.js";
import { sha256File, sha256Text } from "./io.js";
import { loadManifest } from "./manifest.js";
import { readAiLedgerState } from "./ledger.js";
import {
  currentLocalExtractionFingerprint,
  LOCAL_DETERMINISTIC_ENGINE_HASH,
  LOCAL_DETERMINISTIC_ENGINE_VERSION,
  LOCAL_DETERMINISTIC_MODEL,
  LOCAL_DETERMINISTIC_PROVIDER_MODE,
} from "./local-extraction-contract.js";
import { DUPLICATE_SOURCE_NOTICE_PREFIX, SCANNER_PARSER_VERSION } from "./scan.js";
import type { IngestManifest, ManifestUnit, UnitStage } from "./types.js";
import { VALIDATOR_VERSION } from "./validate.js";

export interface StatusOptions {
  stateDir: string;
}

export interface IngestStatus {
  total_units: number;
  durable_by_stage: Record<UnitStage, number>;
  current_by_stage: Record<UnitStage, number>;
  stale_by_stage: Record<UnitStage, number>;
  durable_manual_source_files: number;
  durable_failed_units: number;
  historical_pending_review_units: number;
  current_pending_review_units: number;
  current_strict_load_eligible_units: number;
  historical_extraction_input_tokens: number;
  historical_extraction_output_tokens: number;
  durable_ledger_estimated_cost_usd: number;
  durable_local_extracted_units: number;
  current_local_extracted_units: number;
  durable_local_validated_units: number;
  current_local_validated_units: number;
  current_local_review_load_eligible_units: number;
  historical_local_extraction_input_tokens: number;
  historical_local_extraction_output_tokens: number;
  durable_local_extraction_cost_usd: 0;
  historical_validation_issues: number;
  current_validation_issues: number;
  failed_unit_details: Array<{
    unit_id: string;
    error_codes: string[];
  }>;
}

const STAGE_ORDER: UnitStage[] = [
  "scanned",
  "converted",
  "needs_manual_conversion",
  "extracted",
  "validated",
  "loaded",
  "error",
];

function emptyStageCounts(): Record<UnitStage, number> {
  return {
    scanned: 0,
    converted: 0,
    needs_manual_conversion: 0,
    extracted: 0,
    validated: 0,
    loaded: 0,
    error: 0,
  };
}

async function hasCurrentConversion(
  manifest: IngestManifest,
  unit: ManifestUnit,
): Promise<boolean> {
  const conversion = unit.conversion;
  if (
    manifest.scanner_parser_version !== SCANNER_PARSER_VERSION
    || conversion === undefined
    || conversion.converter_version !== CONVERTER_VERSION
    || conversion.source_fingerprint !== unit.source_fingerprint
  ) {
    return false;
  }
  try {
    const records = await Promise.all(
      [...conversion.text_artifacts, ...conversion.image_artifacts]
        .sort((left, right) => left.localeCompare(right, "en"))
        .map(async (artifactPath) => {
          const digest = await sha256File(artifactPath);
          return `${path.resolve(artifactPath)}\0${digest.sha256}`;
        }),
    );
    return sha256Text(records.join("\n")) === conversion.artifact_fingerprint;
  } catch {
    // Missing or unreadable artifacts are stale evidence. Do not surface the
    // filesystem error because status output is intentionally content-safe.
    return false;
  }
}

function hasCurrentExtraction(
  unit: ManifestUnit,
  currentConversion: boolean,
): boolean {
  const conversion = unit.conversion;
  const extraction = unit.extraction;
  if (!conversion || !extraction || !currentConversion) return false;
  const expectedFingerprint = currentExtractionFingerprint({
    scannerParserVersion: SCANNER_PARSER_VERSION,
    converterVersion: CONVERTER_VERSION,
    model: extraction.model,
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: conversion.artifact_fingerprint,
  });
  return extraction.fingerprint === expectedFingerprint
    && extraction.source_fingerprint === unit.source_fingerprint
    && extraction.artifact_fingerprint === conversion.artifact_fingerprint
    && extraction.prompt_version === EXTRACTION_PROMPT_VERSION
    && extraction.prompt_hash === EXTRACTION_PROMPT_HASH
    && extraction.processing_version === EXTRACTION_PROCESSING_VERSION
    && extraction.scanner_parser_version === SCANNER_PARSER_VERSION
    && extraction.converter_version === CONVERTER_VERSION
    && extraction.content_sha256 !== undefined;
}

function hasCurrentLocalExtractionMetadata(
  manifest: IngestManifest,
  unit: ManifestUnit,
  currentConversion: boolean,
): boolean {
  const conversion = unit.conversion;
  const extraction = unit.local_extraction;
  if (!conversion || !extraction || !currentConversion) return false;
  const expectedFingerprint = currentLocalExtractionFingerprint({
    scannerParserVersion: manifest.scanner_parser_version,
    converterVersion: conversion.converter_version ?? "v1-legacy",
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: conversion.artifact_fingerprint,
  });
  const metadataIsCurrent = extraction.provider_mode === LOCAL_DETERMINISTIC_PROVIDER_MODE
    && extraction.model === LOCAL_DETERMINISTIC_MODEL
    && extraction.fingerprint === expectedFingerprint
    && extraction.source_fingerprint === unit.source_fingerprint
    && extraction.artifact_fingerprint === conversion.artifact_fingerprint
    && extraction.scanner_parser_version === manifest.scanner_parser_version
    && extraction.converter_version === (conversion.converter_version ?? "v1-legacy")
    && extraction.engine_version === LOCAL_DETERMINISTIC_ENGINE_VERSION
    && extraction.engine_hash === LOCAL_DETERMINISTIC_ENGINE_HASH
    && extraction.attempts === 0
    && extraction.input_tokens === 0
    && extraction.output_tokens === 0
    && extraction.estimated_cost_usd === 0
    && extraction.review_status === "pending"
    && extraction.needs_review === true
    && extraction.bulk_approval_eligible === false;
  return metadataIsCurrent;
}

async function verifyCurrentLocalExtraction(
  manifest: IngestManifest,
  unit: ManifestUnit,
  metadataIsCurrent: boolean,
  stateDir: string,
): Promise<boolean> {
  if (!metadataIsCurrent || !unit.local_extraction) return false;
  try {
    const { verifyCurrentLocalExtractionCacheForUnit } = await import(
      "./local-extraction-runner.js"
    );
    const artifact = await verifyCurrentLocalExtractionCacheForUnit(
      unit,
      manifest,
      stateDir,
    );
    return artifact.content_sha256 === unit.local_extraction.content_sha256
      && artifact.review_status === "pending"
      && artifact.needs_review === true
      && artifact.bulk_approval_eligible === false
      && artifact.attempts === 0
      && artifact.input_tokens === 0
      && artifact.output_tokens === 0
      && artifact.estimated_cost_usd === 0;
  } catch {
    return false;
  }
}

function hasCurrentPaidValidation(
  unit: ManifestUnit,
  currentExtraction: boolean,
): boolean {
  const extraction = unit.extraction;
  const validation = unit.validation;
  return extraction !== undefined
    && validation !== undefined
    && validation.provider_mode !== "local_deterministic"
    && currentExtraction
    && validation.validator_version === VALIDATOR_VERSION
    && validation.content_sha256 !== undefined
    && validation.extraction_content_sha256 !== undefined
    && validation.extraction_content_sha256 === extraction.content_sha256;
}

async function currentLocalValidationIdentity(
  manifest: IngestManifest,
  unit: ManifestUnit,
  currentLocalExtractionMetadata: boolean,
  stateDir: string,
): Promise<{ current: boolean; reviewLoadEligible: boolean }> {
  const metadata = unit.validation;
  if (
    !currentLocalExtractionMetadata
    || !metadata
    || metadata.provider_mode !== LOCAL_DETERMINISTIC_PROVIDER_MODE
    || metadata.validator_version !== VALIDATOR_VERSION
    || metadata.model !== LOCAL_DETERMINISTIC_MODEL
    || metadata.engine_version !== LOCAL_DETERMINISTIC_ENGINE_VERSION
    || metadata.engine_hash !== LOCAL_DETERMINISTIC_ENGINE_HASH
    || metadata.review_status !== "pending"
    || metadata.needs_review !== true
    || metadata.bulk_approval_eligible !== false
    || metadata.extraction_content_sha256 !== unit.local_extraction?.content_sha256
  ) {
    return { current: false, reviewLoadEligible: false };
  }
  try {
    const { verifyCurrentLocalValidatedArtifactForUnit } = await import("./validate.js");
    const artifact = await verifyCurrentLocalValidatedArtifactForUnit(
      unit,
      manifest,
      stateDir,
    );
    return {
      current: true,
      reviewLoadEligible: artifact.review_status === "pending"
        && artifact.needs_review === true
        && artifact.bulk_approval_eligible === false
        && !artifact.issues.some((issue) => issue.severity === "error"),
    };
  } catch {
    return { current: false, reviewLoadEligible: false };
  }
}

function sourceStemKey(sourcePath: string): string {
  const portable = sourcePath.replace(/\\/gu, "/");
  return `${path.posix.dirname(portable)}/${path.posix.basename(
    portable,
    path.posix.extname(portable),
  )}`.normalize("NFKC").toLocaleLowerCase("ko-KR");
}

function hasCurrentManualConversionDecision(
  manifest: IngestManifest,
  unit: ManifestUnit,
  currentConversion: boolean,
): boolean {
  if (manifest.scanner_parser_version !== SCANNER_PARSER_VERSION) return false;
  if (currentConversion) return true;
  const replacementPdfStems = new Set(
    unit.source_files
      .filter((source) => source.ext === "pdf")
      .map((source) => sourceStemKey(source.path)),
  );
  return unit.source_files
    .filter((source) => source.ext === "hwp")
    .some((source) => !replacementPdfStems.has(sourceStemKey(source.path)));
}

function hasCurrentScannerError(manifest: IngestManifest, unit: ManifestUnit): boolean {
  if (manifest.scanner_parser_version !== SCANNER_PARSER_VERSION) return false;
  return unit.notices.some((notice) =>
    notice.startsWith(DUPLICATE_SOURCE_NOTICE_PREFIX)
    || notice.startsWith("unknown_region:"),
  );
}

function hasCurrentConversionError(manifest: IngestManifest, unit: ManifestUnit): boolean {
  return manifest.scanner_parser_version === SCANNER_PARSER_VERSION
    && unit.notices.some((notice) =>
      isCurrentConversionFailureNotice(notice, unit.source_fingerprint),
    );
}

function recordedStageUsesCurrentIdentities(
  manifest: IngestManifest,
  unit: ManifestUnit,
  identities: {
    conversion: boolean;
    extraction: boolean;
    validation: boolean;
  },
): boolean {
  if (manifest.scanner_parser_version !== SCANNER_PARSER_VERSION) return false;
  switch (unit.stage) {
    case "scanned":
      return true;
    case "error":
      // A scanner error is recreated by every current scan, and a validation
      // error carries the full conversion/extraction/validator identity chain.
      // Other downstream failures do not persist an attempt version, so
      // treating them as current would overstate evidence after code changes.
      return hasCurrentScannerError(manifest, unit)
        || hasCurrentConversionError(manifest, unit)
        || identities.validation;
    case "needs_manual_conversion":
      return hasCurrentManualConversionDecision(manifest, unit, identities.conversion);
    case "converted":
      return identities.conversion;
    case "extracted":
      return identities.extraction;
    case "validated":
      return identities.validation;
    case "loaded":
      // The manifest currently has no load-plan/writer receipt identity. A
      // current validation alone cannot prove that an old schema/writer load
      // is current after loader code changes, so never overstate loaded state.
      return false;
  }
}

function isCurrentStrictLoadEligible(
  unit: ManifestUnit,
  currentValidation: boolean,
): boolean {
  return unit.stage === "validated"
    && currentValidation
    && unit.validation?.review_status === "pending";
}

function contentSafeFailureCodes(notices: string[]): string[] {
  const codes = new Set<string>();
  for (const notice of notices) {
    const normalized = notice.toLowerCase();
    if (normalized.startsWith("extract ") || normalized.startsWith("extract_")) {
      codes.add("extract_failed");
    } else if (normalized.startsWith("convert ") || normalized.startsWith("convert_")) {
      codes.add("convert_failed");
    } else if (normalized.startsWith("validate ") || normalized.startsWith("validate_")) {
      codes.add("validate_failed");
    } else if (normalized.startsWith("load ") || normalized.startsWith("load_")) {
      codes.add("load_failed");
    } else if (normalized.startsWith("duplicate_source_content:")) {
      codes.add("duplicate_source_content");
    }
  }
  if (codes.size === 0) codes.add("pipeline_failed");
  return [...codes].sort();
}

export function formatIngestStatus(status: IngestStatus): string {
  const stageWidth = Math.max("Stage".length, ...STAGE_ORDER.map((stage) => stage.length));
  const lines = [
    `${"Stage".padEnd(stageWidth)}  Durable  Current  Stale`,
    `${"-".repeat(stageWidth)}  -------  -------  -----`,
    ...STAGE_ORDER.map((stage) => [
      stage.padEnd(stageWidth),
      String(status.durable_by_stage[stage]).padStart(7),
      String(status.current_by_stage[stage]).padStart(7),
      String(status.stale_by_stage[stage]).padStart(5),
    ].join("  ")),
    "",
    `Total units: ${status.total_units}`,
    `Durable manual source files: ${status.durable_manual_source_files}`,
    `Durable failed units: ${status.durable_failed_units}`,
    `Historical pending review units: ${status.historical_pending_review_units}`,
    `Current pending review units: ${status.current_pending_review_units}`,
    `Current strict-load identity eligible units: ${status.current_strict_load_eligible_units}`,
    `Historical validation issues: ${status.historical_validation_issues}`,
    `Current validation issues: ${status.current_validation_issues}`,
    `Historical extraction tokens: ${status.historical_extraction_input_tokens} input / ${status.historical_extraction_output_tokens} output`,
    `Durable AI ledger estimated cost (USD): ${status.durable_ledger_estimated_cost_usd.toFixed(6)}`,
    `Durable local deterministic extraction units: ${status.durable_local_extracted_units}`,
    `Current local deterministic extraction units: ${status.current_local_extracted_units}`,
    `Durable local review-only validated units: ${status.durable_local_validated_units}`,
    `Current local review-only validated units: ${status.current_local_validated_units}`,
    `Current local pending-load eligible units: ${status.current_local_review_load_eligible_units}`,
    `Local deterministic extraction tokens: ${status.historical_local_extraction_input_tokens} input / ${status.historical_local_extraction_output_tokens} output`,
    `Local deterministic extraction cost (USD): ${status.durable_local_extraction_cost_usd.toFixed(6)}`,
  ];
  if (status.failed_unit_details.length > 0) {
    lines.push(
      "",
      "Failed unit details (content-safe):",
      ...status.failed_unit_details.map(
        (detail) => `${detail.unit_id}: ${detail.error_codes.join(", ")}`,
      ),
    );
  }
  return lines.join("\n");
}

export async function getIngestStatus(options: StatusOptions): Promise<IngestStatus> {
  const manifest = await loadManifest(options.stateDir);
  const ledgerState = await readAiLedgerState(options.stateDir);
  const ledger = ledgerState.entries;
  const durableByStage = emptyStageCounts();
  const currentByStage = emptyStageCounts();
  const staleByStage = emptyStageCounts();
  const currentIdentities = await Promise.all(manifest.units.map(async (unit) => {
    const conversion = await hasCurrentConversion(manifest, unit);
    const paidExtraction = hasCurrentExtraction(unit, conversion);
    const localExtractionMetadata = hasCurrentLocalExtractionMetadata(
      manifest,
      unit,
      conversion,
    );
    const paidValidation = hasCurrentPaidValidation(unit, paidExtraction);
    const localValidation = await currentLocalValidationIdentity(
      manifest,
      unit,
      localExtractionMetadata,
      options.stateDir,
    );
    // The local validation verifier already re-verifies the extraction
    // contract. Only replay the extraction separately when no current local
    // validation can provide that proof.
    const localExtraction = localValidation.current || await verifyCurrentLocalExtraction(
      manifest,
      unit,
      localExtractionMetadata,
      options.stateDir,
    );
    const extraction = paidExtraction || localExtraction;
    const validation = paidValidation || localValidation.current;
    return {
      conversion,
      extraction,
      paidExtraction,
      localExtraction,
      paidValidation,
      localValidation: localValidation.current,
      localReviewLoadEligible: localValidation.reviewLoadEligible,
      validation,
    };
  }));
  for (const [index, unit] of manifest.units.entries()) {
    durableByStage[unit.stage] += 1;
    if (recordedStageUsesCurrentIdentities(manifest, unit, currentIdentities[index])) {
      currentByStage[unit.stage] += 1;
    }
    else staleByStage[unit.stage] += 1;
  }
  const currentValidatedUnits = manifest.units.filter((unit, index) =>
    unit.stage === "validated" && currentIdentities[index].validation
  );

  const manifestInputTokens = manifest.units
    .reduce((sum, unit) => sum + (unit.extraction?.input_tokens ?? 0), 0);
  const manifestOutputTokens = manifest.units
    .reduce((sum, unit) => sum + (unit.extraction?.output_tokens ?? 0), 0);
  const ledgerInputTokens = ledger.reduce((sum, entry) => sum + entry.input_tokens, 0);
  const ledgerOutputTokens = ledger.reduce((sum, entry) => sum + entry.output_tokens, 0);

  return {
    total_units: manifest.units.length,
    durable_by_stage: durableByStage,
    current_by_stage: currentByStage,
    stale_by_stage: staleByStage,
    durable_manual_source_files: manifest.units
      .filter((unit) => unit.stage === "needs_manual_conversion")
      .flatMap((unit) => unit.source_files)
      .filter((source) => source.ext === "hwp" || source.ext === "pdf")
      .length,
    durable_failed_units: durableByStage.error,
    historical_pending_review_units: manifest.units
      .filter((unit) => unit.validation?.review_status === "pending")
      .length,
    current_pending_review_units: currentValidatedUnits
      .filter((unit) => unit.validation?.review_status === "pending")
      .length,
    current_strict_load_eligible_units: manifest.units
      .filter((unit, index) => isCurrentStrictLoadEligible(unit, currentIdentities[index].paidValidation))
      .length,
    // The append-only ledger survives a manifest rescan. Prefer it when it
    // exists so historical paid attempts do not disappear from status; the
    // manifest fallback keeps legacy/test states without a ledger observable.
    historical_extraction_input_tokens: ledger.length > 0
      ? ledgerInputTokens
      : manifestInputTokens,
    historical_extraction_output_tokens: ledger.length > 0
      ? ledgerOutputTokens
      : manifestOutputTokens,
    // Use the same conservative historical-v2 accounting that binds paid
    // plans and execution-domain authority. Summing the raw row field would
    // understate legacy cache-write exposure and make two status surfaces
    // disagree for the same immutable ledger bytes.
    durable_ledger_estimated_cost_usd: ledgerState.snapshot.cumulative_cost_usd,
    durable_local_extracted_units: manifest.units
      .filter((unit) => unit.local_extraction !== undefined)
      .length,
    current_local_extracted_units: manifest.units
      .filter((_unit, index) => currentIdentities[index].localExtraction)
      .length,
    durable_local_validated_units: manifest.units
      .filter((unit) => unit.validation?.provider_mode === LOCAL_DETERMINISTIC_PROVIDER_MODE)
      .length,
    current_local_validated_units: manifest.units
      .filter((unit, index) =>
        unit.stage === "validated" && currentIdentities[index].localValidation
      )
      .length,
    current_local_review_load_eligible_units: manifest.units
      .filter((unit, index) =>
        unit.stage === "validated" && currentIdentities[index].localReviewLoadEligible
      )
      .length,
    historical_local_extraction_input_tokens: manifest.units
      .reduce((sum, unit) => sum + (unit.local_extraction?.input_tokens ?? 0), 0),
    historical_local_extraction_output_tokens: manifest.units
      .reduce((sum, unit) => sum + (unit.local_extraction?.output_tokens ?? 0), 0),
    durable_local_extraction_cost_usd: 0,
    historical_validation_issues: manifest.units
      .reduce((sum, unit) => sum + (unit.validation?.issue_count ?? 0), 0),
    current_validation_issues: currentValidatedUnits
      .reduce((sum, unit) => sum + (unit.validation?.issue_count ?? 0), 0),
    failed_unit_details: manifest.units
      .filter((unit) => unit.stage === "error")
      .map((unit) => ({
        unit_id: unit.unit_id,
        error_codes: contentSafeFailureCodes(unit.notices),
      })),
  };
}
