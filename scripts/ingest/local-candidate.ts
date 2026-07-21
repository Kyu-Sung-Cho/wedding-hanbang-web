import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  canonicalJsonSha256ExcludingField,
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import {
  CURRENT_EXTRACTION_FINALIZATION_CONTRACT,
  LEGACY_TRANSITIONAL_EXTRACTION_FINALIZATION_CONTRACT,
} from "./extraction-contract.js";
import {
  verifyCurrentExtractionCacheForUnit,
} from "./extract.js";
import { acquireExtractionLock } from "./extraction-lock.js";
import { canonicalSha256 } from "./gate-integrity.js";
import { readJsonFile, syncDirectoryMetadata } from "./io.js";
import {
  LOCAL_DETERMINISTIC_ENGINE_HASH,
  LOCAL_DETERMINISTIC_ENGINE_VERSION,
  LOCAL_DETERMINISTIC_MODEL,
  LOCAL_DETERMINISTIC_PROVIDER_MODE,
} from "./local-extraction-contract.js";
import { deriveVerifiedLocalReviewCandidateForUnit } from "./local-extraction-runner.js";
import { loadManifest } from "./manifest.js";
import { DisclosureExtractionSchema } from "./schemas.js";
import {
  CoverageGapSchema,
  deriveValidatedPayloadForUnit,
  VALIDATOR_VERSION,
} from "./validate.js";
import type { DisclosureExtraction } from "./schemas.js";
import type { IngestManifest, ManifestUnit } from "./types.js";
import type { ValidationIssue } from "./validate.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const SourceFileSchema = z.object({
  path: z.string().min(1),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative(),
}).strict();
const ConversionArtifactSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  kind: z.enum(["text", "image"]),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative(),
}).strict();
const PaidExtractionProvenanceSchema = z.object({
  provider_mode: z.literal("production_paid"),
  paid_plan_sha256: Sha256Schema,
  fingerprint: Sha256Schema,
  content_sha256: Sha256Schema,
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  prompt_version: z.string().min(1),
  prompt_hash: Sha256Schema,
  processing_version: Sha256Schema,
  verified_finalization_contract: z.enum([
    CURRENT_EXTRACTION_FINALIZATION_CONTRACT,
    LEGACY_TRANSITIONAL_EXTRACTION_FINALIZATION_CONTRACT,
  ]),
}).strict();
const LocalEngineSchema = z.object({
  provider_mode: z.literal(LOCAL_DETERMINISTIC_PROVIDER_MODE),
  model: z.literal(LOCAL_DETERMINISTIC_MODEL),
  engine_version: z.literal(LOCAL_DETERMINISTIC_ENGINE_VERSION),
  engine_hash: z.literal(LOCAL_DETERMINISTIC_ENGINE_HASH),
  validator_version: z.literal(VALIDATOR_VERSION),
}).strict();
const ValidationSummarySchema = z.object({
  issue_count: z.number().int().nonnegative(),
  hard_error_count: z.number().int().nonnegative(),
  warning_count: z.number().int().nonnegative(),
  hard_error_codes: z.array(z.string().min(1)),
  coverage_gap_count: z.number().int().nonnegative(),
}).strict();
const RowCountsSchema = z.object({
  vendors: z.number().int().nonnegative(),
  halls: z.number().int().nonnegative(),
  packages: z.number().int().nonnegative(),
  sections: z.number().int().nonnegative(),
  policies: z.number().int().nonnegative(),
  options: z.number().int().nonnegative(),
  money_occurrences: z.number().int().nonnegative(),
  structured_amount_fields: z.number().int().nonnegative(),
}).strict();
const OverlapSchema = z.object({
  paid: z.number().int().nonnegative(),
  local: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  missing_from_local: z.number().int().nonnegative(),
  extra_in_local: z.number().int().nonnegative(),
}).strict();
const FieldDifferenceSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["added", "removed", "changed"]),
  paid_value_sha256: Sha256Schema.nullable(),
  local_value_sha256: Sha256Schema.nullable(),
  paid_preview: z.string().max(240).nullable(),
  local_preview: z.string().max(240).nullable(),
}).strict();
const SemanticDifferenceCountsSchema = z.object({
  identity_and_linkage: z.number().int().nonnegative(),
  pricing: z.number().int().nonnegative(),
  other_domain: z.number().int().nonnegative(),
}).strict();
const FieldDiffSummarySchema = z.object({
  doc_kind: z.object({
    paid: DisclosureExtractionSchema.shape.doc_kind,
    local: DisclosureExtractionSchema.shape.doc_kind,
    matches: z.boolean(),
  }).strict(),
  row_counts: z.object({
    paid: RowCountsSchema,
    local: RowCountsSchema,
  }).strict(),
  identity_overlap: z.object({
    vendors: OverlapSchema,
    halls: OverlapSchema,
    packages: OverlapSchema,
  }).strict(),
  structured_amount_overlap: OverlapSchema,
  field_differences: z.array(FieldDifferenceSchema).max(100_000),
  exact_representation_match: z.boolean(),
  semantic_field_differences: z.array(FieldDifferenceSchema).max(100_000),
  semantic_representation_match: z.boolean(),
  trust_metadata_difference_count: z.number().int().nonnegative(),
  semantic_difference_counts: SemanticDifferenceCountsSchema,
}).strict();
export type PaidLocalCandidateDiffSummary = z.infer<typeof FieldDiffSummarySchema>;
const ValidationIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
}).strict();

const ProvenanceShape = {
  provider_mode: z.literal(LOCAL_DETERMINISTIC_PROVIDER_MODE),
  model: z.literal(LOCAL_DETERMINISTIC_MODEL),
  unit_id: Sha256Schema,
  source_files: z.array(SourceFileSchema).min(1),
  source_fingerprint: Sha256Schema,
  conversion_fingerprint: Sha256Schema,
  conversion_artifacts: z.array(ConversionArtifactSchema).min(1),
  scanner_parser_version: z.string().min(1),
  converter_version: z.string().min(1),
  paid_extraction: PaidExtractionProvenanceSchema,
  local_engine: LocalEngineSchema,
};

export const LocalCandidateArtifactSchema = z.object({
  schema_version: z.literal(2),
  artifact_kind: z.literal("local_deterministic_candidate"),
  content_sha256: Sha256Schema,
  fingerprint: Sha256Schema,
  ...ProvenanceShape,
  data: DisclosureExtractionSchema,
  validation_summary: ValidationSummarySchema,
  validation_issues: z.array(ValidationIssueSchema),
  coverage_gaps: z.array(CoverageGapSchema).max(5_000),
  field_diff_summary: FieldDiffSummarySchema,
  hard_hold_reasons: z.array(z.string().min(1)).min(1),
  attempts: z.literal(0),
  input_tokens: z.literal(0),
  output_tokens: z.literal(0),
  estimated_cost_usd: z.literal(0),
  review_status: z.literal("pending"),
  needs_review: z.literal(true),
  bulk_approval_eligible: z.literal(false),
  adoption_status: z.literal("blocked_human_review_required"),
}).strict();

export const LocalCandidateReceiptSchema = z.object({
  schema_version: z.literal(2),
  artifact_kind: z.literal("local_candidate_validation_receipt"),
  content_sha256: Sha256Schema,
  fingerprint: Sha256Schema,
  ...ProvenanceShape,
  candidate_fingerprint: Sha256Schema,
  candidate_content_sha256: Sha256Schema,
  validation_summary: ValidationSummarySchema,
  validation_issues: z.array(ValidationIssueSchema),
  coverage_gaps: z.array(CoverageGapSchema).max(5_000),
  field_diff_summary: FieldDiffSummarySchema,
  hard_hold_reasons: z.array(z.string().min(1)).min(1),
  attempts: z.literal(0),
  input_tokens: z.literal(0),
  output_tokens: z.literal(0),
  estimated_cost_usd: z.literal(0),
  review_status: z.literal("pending"),
  needs_review: z.literal(true),
  bulk_approval_eligible: z.literal(false),
  adoption_status: z.literal("blocked_human_review_required"),
}).strict();

export type LocalCandidateArtifact = z.infer<typeof LocalCandidateArtifactSchema>;
export type LocalCandidateReceipt = z.infer<typeof LocalCandidateReceiptSchema>;

export interface LocalCandidateOptions {
  stateDir: string;
  limit?: number;
  unitIds?: string[];
}

export interface LocalCandidateRunResult {
  selected_units: number;
  processed_units: number;
  cache_hits: number;
  failed_units: number;
  input_tokens: 0;
  output_tokens: 0;
  cost_usd: 0;
  candidates: Array<{
    unit_id: string;
    artifact_path: string;
    receipt_path: string;
    cache_hit: boolean;
    hard_hold_reasons: string[];
  }>;
  failures: Array<{ unit_id: string; error: string }>;
}

export interface VerifiedCurrentLocalCandidate {
  candidate: LocalCandidateArtifact;
  receipt: LocalCandidateReceipt;
  artifact_path: string;
  receipt_path: string;
}

type StrictDisclosure = ReturnType<typeof DisclosureExtractionSchema.parse>;

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function normalizeIdentity(value: string | null): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function disclosureIdentities(data: DisclosureExtraction): {
  vendors: string[];
  halls: string[];
  packages: string[];
} {
  return {
    vendors: data.partner_vendors.map((row) => normalizeIdentity(row.vendor_name)).filter(Boolean),
    halls: (data.halls ?? []).map((row) => normalizeIdentity(row.hall_name)).filter(Boolean),
    packages: data.agency_packages.map((row) => normalizeIdentity(row.package_name)).filter(Boolean),
  };
}

function structuredAmounts(data: DisclosureExtraction): number[] {
  const result: number[] = [];
  const add = (value: number | null | undefined): void => {
    if (value !== null && value !== undefined) result.push(value);
  };
  for (const row of data.agency_packages) {
    add(row.price_min_krw);
    add(row.price_max_krw);
    for (const option of row.options) {
      add(option.price_min_krw);
      add(option.price_max_krw);
    }
  }
  for (const row of data.partner_vendors) {
    add(row.price_min_krw);
    add(row.price_max_krw);
    for (const option of row.options) {
      add(option.price_min_krw);
      add(option.price_max_krw);
    }
  }
  for (const row of data.halls ?? []) {
    add(row.meal_price_min_krw);
    add(row.meal_price_max_krw);
    add(row.venue_fee_min_krw);
    add(row.venue_fee_max_krw);
    add(row.decoration_fee_min_krw);
    add(row.decoration_fee_max_krw);
    for (const option of row.options) {
      add(option.price_min_krw);
      add(option.price_max_krw);
    }
  }
  add(data.hall.venue_fee_krw);
  add(data.hall.meal_price_min_krw);
  add(data.hall.meal_price_max_krw);
  for (const item of data.hall.items) {
    add(item.price_min_krw);
    add(item.price_max_krw);
  }
  return result;
}

function rowCounts(data: DisclosureExtraction): z.infer<typeof RowCountsSchema> {
  return {
    vendors: data.partner_vendors.length,
    halls: (data.halls ?? []).length,
    packages: data.agency_packages.length,
    sections: (data.sections ?? []).length,
    policies: data.partner_vendors.reduce((sum, row) => sum + (row.policies?.length ?? 0), 0),
    options: data.partner_vendors.reduce((sum, row) => sum + row.options.length, 0)
      + data.agency_packages.reduce((sum, row) => sum + row.options.length, 0)
      + (data.halls ?? []).reduce((sum, row) => sum + row.options.length, 0)
      + data.hall.items.length,
    money_occurrences: (data.money_occurrences ?? []).length,
    structured_amount_fields: structuredAmounts(data).length,
  };
}

function overlap(paid: readonly (string | number)[], local: readonly (string | number)[]) {
  const available = new Map<string | number, number>();
  for (const value of local) available.set(value, (available.get(value) ?? 0) + 1);
  let matched = 0;
  for (const value of paid) {
    const count = available.get(value) ?? 0;
    if (count <= 0) continue;
    matched += 1;
    available.set(value, count - 1);
  }
  return {
    paid: paid.length,
    local: local.length,
    matched,
    missing_from_local: paid.length - matched,
    extra_in_local: local.length - matched,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointerSegment(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function valuePreview(value: unknown): string {
  const serialized = JSON.stringify(value);
  const printable = serialized === undefined ? String(value) : serialized;
  return printable.length <= 240 ? printable : `${printable.slice(0, 239)}…`;
}

const TRUST_METADATA_FIELDS = new Set([
  "confidence",
  "needs_review",
  "extraction_notes",
]);

const IDENTITY_AND_LINKAGE_FIELDS = new Set([
  "doc_kind",
  "business_name",
  "region_hint",
  "vendor_name",
  "old_names",
  "category",
  "hall_name",
  "package_name",
  "category_scope",
]);

const PRICING_FIELDS = new Set([
  "price_min_krw",
  "price_max_krw",
  "venue_fee_krw",
  "meal_price_min_krw",
  "meal_price_max_krw",
  "venue_fee_min_krw",
  "venue_fee_max_krw",
  "decoration_fee_min_krw",
  "decoration_fee_max_krw",
  "guarantee_min",
  "amount_krw",
]);

function withoutTrustMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => withoutTrustMetadata(entry));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !TRUST_METADATA_FIELDS.has(key))
      .map(([key, entry]) => [key, withoutTrustMetadata(entry)]),
  );
}

function pointerSegments(pointer: string): string[] {
  return pointer.split("/").slice(1).map((segment) =>
    segment.replace(/~1/gu, "/").replace(/~0/gu, "~")
  );
}

function semanticDifferenceCounts(
  differences: readonly z.infer<typeof FieldDifferenceSchema>[],
): z.infer<typeof SemanticDifferenceCountsSchema> {
  const counts = { identity_and_linkage: 0, pricing: 0, other_domain: 0 };
  for (const difference of differences) {
    const segments = pointerSegments(difference.path);
    const field = segments.at(-1) ?? "";
    if (
      PRICING_FIELDS.has(field)
      || segments.includes("options")
      || segments.includes("items")
    ) {
      counts.pricing += 1;
    } else if (
      IDENTITY_AND_LINKAGE_FIELDS.has(field)
      || (segments.some((segment) =>
        segment === "partner_vendors" || segment === "halls" || segment === "agency_packages"
      ) && /^\d+$/u.test(field))
    ) {
      counts.identity_and_linkage += 1;
    } else {
      counts.other_domain += 1;
    }
  }
  return counts;
}

function fieldDifferences(
  paid: unknown,
  local: unknown,
): z.infer<typeof FieldDifferenceSchema>[] {
  const differences: z.infer<typeof FieldDifferenceSchema>[] = [];
  const visit = (
    paidValue: unknown,
    localValue: unknown,
    pathValue: string,
    paidPresent: boolean,
    localPresent: boolean,
  ): void => {
    if (paidPresent && localPresent && isDeepStrictEqual(paidValue, localValue)) return;
    if (paidPresent && localPresent && Array.isArray(paidValue) && Array.isArray(localValue)) {
      const maximum = Math.max(paidValue.length, localValue.length);
      for (let index = 0; index < maximum; index += 1) {
        visit(
          paidValue[index],
          localValue[index],
          `${pathValue}/${index}`,
          index < paidValue.length,
          index < localValue.length,
        );
      }
      return;
    }
    if (paidPresent && localPresent && isRecord(paidValue) && isRecord(localValue)) {
      const keys = [...new Set([...Object.keys(paidValue), ...Object.keys(localValue)])]
        .sort((left, right) => left.localeCompare(right, "en"));
      for (const key of keys) {
        visit(
          paidValue[key],
          localValue[key],
          `${pathValue}/${pointerSegment(key)}`,
          Object.hasOwn(paidValue, key),
          Object.hasOwn(localValue, key),
        );
      }
      return;
    }
    differences.push({
      path: pathValue || "/",
      kind: !paidPresent ? "added" : !localPresent ? "removed" : "changed",
      paid_value_sha256: paidPresent ? canonicalSha256({ value: paidValue }) : null,
      local_value_sha256: localPresent ? canonicalSha256({ value: localValue }) : null,
      paid_preview: paidPresent ? valuePreview(paidValue) : null,
      local_preview: localPresent ? valuePreview(localValue) : null,
    });
  };
  visit(paid, local, "", true, true);
  return differences;
}

export function summarizePaidLocalCandidateDiff(
  paid: StrictDisclosure,
  local: StrictDisclosure,
): PaidLocalCandidateDiffSummary {
  const paidIdentities = disclosureIdentities(paid);
  const localIdentities = disclosureIdentities(local);
  const identityOverlap = {
    vendors: overlap(paidIdentities.vendors, localIdentities.vendors),
    halls: overlap(paidIdentities.halls, localIdentities.halls),
    packages: overlap(paidIdentities.packages, localIdentities.packages),
  };
  const amountOverlap = overlap(structuredAmounts(paid), structuredAmounts(local));
  const paidRows = rowCounts(paid);
  const localRows = rowCounts(local);
  const differences = fieldDifferences(paid, local);
  const semanticDifferences = fieldDifferences(
    withoutTrustMetadata(paid),
    withoutTrustMetadata(local),
  );
  return FieldDiffSummarySchema.parse({
    doc_kind: {
      paid: paid.doc_kind,
      local: local.doc_kind,
      matches: paid.doc_kind === local.doc_kind,
    },
    row_counts: { paid: paidRows, local: localRows },
    identity_overlap: identityOverlap,
    structured_amount_overlap: amountOverlap,
    field_differences: differences,
    exact_representation_match: differences.length === 0,
    semantic_field_differences: semanticDifferences,
    semantic_representation_match: semanticDifferences.length === 0,
    trust_metadata_difference_count: differences.filter((difference) => {
      const field = pointerSegments(difference.path).at(-1) ?? "";
      return TRUST_METADATA_FIELDS.has(field);
    }).length,
    semantic_difference_counts: semanticDifferenceCounts(semanticDifferences),
  });
}

function validationSummary(
  issues: ValidationIssue[],
  coverageGapCount: number,
): z.infer<typeof ValidationSummarySchema> {
  const hardErrors = issues.filter((issue) => issue.severity === "error");
  return {
    issue_count: issues.length,
    hard_error_count: hardErrors.length,
    warning_count: issues.length - hardErrors.length,
    hard_error_codes: [...new Set(hardErrors.map((issue) => issue.code))].sort(),
    coverage_gap_count: coverageGapCount,
  };
}

function hardHoldReasons(
  unit: ManifestUnit,
  summary: z.infer<typeof ValidationSummarySchema>,
  diff: z.infer<typeof FieldDiffSummarySchema>,
): string[] {
  const reasons = ["human_review_required"];
  for (const extension of [...new Set(unit.source_files.map((source) => source.ext))].sort()) {
    if (extension !== "xlsx") reasons.push(`non_xlsx_format:${extension}`);
  }
  if ((unit.conversion?.image_artifacts.length ?? 0) > 0) {
    reasons.push("image_evidence_unread");
  }
  if (summary.hard_error_count > 0) reasons.push("local_validation_hard_errors");
  if (summary.coverage_gap_count > 0) reasons.push("local_coverage_gaps");
  if (!diff.semantic_representation_match) reasons.push("paid_local_semantic_diff");
  return reasons;
}

async function expectedLocalCandidateBundle(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
): Promise<{
  candidate: LocalCandidateArtifact;
  receipt: LocalCandidateReceipt;
}> {
  const conversion = unit.conversion;
  if (!conversion || unit.extraction?.provider_mode !== "production_paid") {
    throw new Error(`local_candidate_requires_production_paid_extraction:${unit.unit_id}`);
  }
  const paid = await verifyCurrentExtractionCacheForUnit(unit, manifest, stateDir);
  if (paid.provider_mode !== "production_paid" || paid.paid_plan_sha256 === null) {
    throw new Error("local_candidate_paid_provenance_not_production");
  }
  const local = await deriveVerifiedLocalReviewCandidateForUnit(unit, manifest);
  const validated = await deriveValidatedPayloadForUnit(
    unit,
    { data: local.data },
    { mode: "local_deterministic" },
  );
  const summary = validationSummary(validated.issues, validated.coverageGaps.length);
  const diff = summarizePaidLocalCandidateDiff(paid.data, local.data);
  const holds = hardHoldReasons(unit, summary, diff);
  const provenance = {
    provider_mode: LOCAL_DETERMINISTIC_PROVIDER_MODE,
    model: LOCAL_DETERMINISTIC_MODEL,
    unit_id: unit.unit_id,
    source_files: unit.source_files.map((source) => ({
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
    })),
    source_fingerprint: unit.source_fingerprint,
    conversion_fingerprint: conversion.artifact_fingerprint,
    conversion_artifacts: local.conversionArtifacts.map((artifact, ordinal) => ({
      ordinal,
      kind: artifact.kind,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    })),
    scanner_parser_version: manifest.scanner_parser_version,
    converter_version: conversion.converter_version ?? "v1-legacy",
    paid_extraction: {
      provider_mode: "production_paid" as const,
      paid_plan_sha256: paid.paid_plan_sha256,
      fingerprint: paid.fingerprint,
      content_sha256: paid.content_sha256,
      model: paid.model,
      prompt_version: paid.prompt_version,
      prompt_hash: paid.prompt_hash,
      processing_version: paid.processing_version,
      verified_finalization_contract: paid.verified_finalization_contract,
    },
    local_engine: {
      provider_mode: LOCAL_DETERMINISTIC_PROVIDER_MODE,
      model: LOCAL_DETERMINISTIC_MODEL,
      engine_version: LOCAL_DETERMINISTIC_ENGINE_VERSION,
      engine_hash: LOCAL_DETERMINISTIC_ENGINE_HASH,
      validator_version: VALIDATOR_VERSION,
    },
  };
  const fingerprint = canonicalSha256({
    schema_version: 2,
    artifact_kind: "local_deterministic_candidate",
    ...provenance,
  });
  const candidate = LocalCandidateArtifactSchema.parse(withContentHash({
    schema_version: 2 as const,
    artifact_kind: "local_deterministic_candidate" as const,
    fingerprint,
    ...provenance,
    data: local.data,
    validation_summary: summary,
    validation_issues: validated.issues,
    coverage_gaps: validated.coverageGaps,
    field_diff_summary: diff,
    hard_hold_reasons: holds,
    attempts: 0 as const,
    input_tokens: 0 as const,
    output_tokens: 0 as const,
    estimated_cost_usd: 0 as const,
    review_status: "pending" as const,
    needs_review: true as const,
    bulk_approval_eligible: false as const,
    adoption_status: "blocked_human_review_required" as const,
  }));
  const receiptFingerprint = canonicalSha256({
    schema_version: 2,
    artifact_kind: "local_candidate_validation_receipt",
    candidate_fingerprint: candidate.fingerprint,
    candidate_content_sha256: candidate.content_sha256,
    validator_version: VALIDATOR_VERSION,
    validation_issues: validated.issues,
    coverage_gaps: validated.coverageGaps,
    field_diff_summary: diff,
    hard_hold_reasons: holds,
  });
  const receipt = LocalCandidateReceiptSchema.parse(withContentHash({
    schema_version: 2 as const,
    artifact_kind: "local_candidate_validation_receipt" as const,
    fingerprint: receiptFingerprint,
    ...provenance,
    candidate_fingerprint: candidate.fingerprint,
    candidate_content_sha256: candidate.content_sha256,
    validation_summary: summary,
    validation_issues: validated.issues,
    coverage_gaps: validated.coverageGaps,
    field_diff_summary: diff,
    hard_hold_reasons: holds,
    attempts: 0 as const,
    input_tokens: 0 as const,
    output_tokens: 0 as const,
    estimated_cost_usd: 0 as const,
    review_status: "pending" as const,
    needs_review: true as const,
    bulk_approval_eligible: false as const,
    adoption_status: "blocked_human_review_required" as const,
  }));
  return { candidate, receipt };
}

/**
 * Reads, content-verifies, and deterministically replays the current local
 * review candidate and its receipt. It never creates or adopts a sidecar.
 */
export async function verifyCurrentLocalCandidateForUnit(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
): Promise<VerifiedCurrentLocalCandidate> {
  const expected = await expectedLocalCandidateBundle(unit, manifest, stateDir);
  const artifactRelativePath = path.join(
    ".cache",
    "extract-local-candidates",
    `${expected.candidate.content_sha256}.json`,
  );
  const receiptRelativePath = path.join(
    ".cache",
    "extract-local-candidate-receipts",
    `${expected.receipt.content_sha256}.json`,
  );
  const artifactPath = path.join(path.resolve(stateDir), artifactRelativePath);
  const receiptPath = path.join(path.resolve(stateDir), receiptRelativePath);
  const candidate = await readSidecar(
    stateDir,
    artifactPath,
    artifactRelativePath,
    LocalCandidateArtifactSchema,
    expected.candidate,
    "local_candidate_artifact_invalid",
  );
  if (!candidate) throw new Error("local_candidate_artifact_missing");
  const receipt = await readSidecar(
    stateDir,
    receiptPath,
    receiptRelativePath,
    LocalCandidateReceiptSchema,
    expected.receipt,
    "local_candidate_receipt_invalid",
  );
  if (!receipt) throw new Error("local_candidate_receipt_missing");
  return {
    candidate,
    receipt,
    artifact_path: artifactPath,
    receipt_path: receiptPath,
  };
}

function selectCandidateUnits(
  manifest: IngestManifest,
  options: Pick<LocalCandidateOptions, "limit" | "unitIds">,
): ManifestUnit[] {
  const eligible = manifest.units.filter((unit) =>
    unit.conversion && unit.extraction?.provider_mode === "production_paid"
  );
  if (options.unitIds) {
    const byId = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
    const unknown = options.unitIds.find((unitId) => !byId.has(unitId));
    if (unknown) throw new Error(`unknown_unit_id:${unknown}`);
    const selected = options.unitIds.map((unitId) => byId.get(unitId)!);
    const blocked = selected.find((unit) =>
      !unit.conversion || unit.extraction?.provider_mode !== "production_paid"
    );
    if (blocked) {
      throw new Error(`local_candidate_requires_production_paid_extraction:${blocked.unit_id}`);
    }
    return selected;
  }
  const ordered = [...eligible].sort((left, right) => left.unit_id.localeCompare(right.unit_id, "en"));
  return options.limit === undefined ? ordered : ordered.slice(0, options.limit);
}

async function readSidecar<T>(
  stateDir: string,
  artifactPath: string,
  expectedRelativePath: string,
  schema: z.ZodType<T>,
  expected: T,
  mismatchCode: string,
): Promise<T | null> {
  try {
    await verifyDeterministicStateArtifactPath({ stateDir, artifactPath, expectedRelativePath });
    const raw = await readJsonFile(artifactPath);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error(`${mismatchCode}:schema`);
    verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
    if (!isDeepStrictEqual(parsed.data, expected)) throw new Error(`${mismatchCode}:replay`);
    return parsed.data;
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

function withContentHash<T extends Record<string, unknown>>(value: T): T & { content_sha256: string } {
  const result = { ...value, content_sha256: "0".repeat(64) };
  result.content_sha256 = canonicalJsonSha256ExcludingField(result, "content_sha256");
  return result;
}

async function writeContentAddressedSidecarNoOverwrite(
  artifactPath: string,
  value: unknown,
): Promise<void> {
  const directory = path.dirname(artifactPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(artifactPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, artifactPath);
    await syncDirectoryMetadata(directory);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

/**
 * Generates immutable review sidecars only. It never writes the manifest,
 * active extraction/validation metadata, paid caches, ledger, staging, or DB.
 */
export async function extractLocalCandidates(
  options: LocalCandidateOptions,
): Promise<LocalCandidateRunResult> {
  const releaseLock = await acquireExtractionLock(options.stateDir);
  try {
    const manifest = await loadManifest(options.stateDir);
    const selected = selectCandidateUnits(manifest, options);
    const result: LocalCandidateRunResult = {
      selected_units: selected.length,
      processed_units: 0,
      cache_hits: 0,
      failed_units: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      candidates: [],
      failures: [],
    };
    for (const unit of selected) {
      try {
        const { candidate, receipt } = await expectedLocalCandidateBundle(
          unit,
          manifest,
          options.stateDir,
        );
        const holds = candidate.hard_hold_reasons;
        const artifactRelativePath = path.join(
          ".cache",
          "extract-local-candidates",
          `${candidate.content_sha256}.json`,
        );
        const receiptRelativePath = path.join(
          ".cache",
          "extract-local-candidate-receipts",
          `${receipt.content_sha256}.json`,
        );
        const artifactPath = path.join(path.resolve(options.stateDir), artifactRelativePath);
        const receiptPath = path.join(path.resolve(options.stateDir), receiptRelativePath);
        const cachedCandidate = await readSidecar(
          options.stateDir,
          artifactPath,
          artifactRelativePath,
          LocalCandidateArtifactSchema,
          candidate,
          "local_candidate_cache_invalid",
        );
        const cachedReceipt = await readSidecar(
          options.stateDir,
          receiptPath,
          receiptRelativePath,
          LocalCandidateReceiptSchema,
          receipt,
          "local_candidate_receipt_invalid",
        );
        if (!cachedCandidate) {
          await prepareDeterministicStateArtifactWritePath({
            stateDir: options.stateDir,
            artifactPath,
            expectedRelativePath: artifactRelativePath,
          });
          await writeContentAddressedSidecarNoOverwrite(artifactPath, candidate);
        }
        if (!cachedReceipt) {
          await prepareDeterministicStateArtifactWritePath({
            stateDir: options.stateDir,
            artifactPath: receiptPath,
            expectedRelativePath: receiptRelativePath,
          });
          await writeContentAddressedSidecarNoOverwrite(receiptPath, receipt);
        }
        const cacheHit = Boolean(cachedCandidate && cachedReceipt);
        result.processed_units += 1;
        if (cacheHit) result.cache_hits += 1;
        result.candidates.push({
          unit_id: unit.unit_id,
          artifact_path: artifactPath,
          receipt_path: receiptPath,
          cache_hit: cacheHit,
          hard_hold_reasons: holds,
        });
      } catch (error) {
        result.failed_units += 1;
        result.failures.push({
          unit_id: unit.unit_id,
          error: error instanceof Error ? error.message : "unknown_local_candidate_error",
        });
      }
    }
    return result;
  } finally {
    await releaseLock();
  }
}
