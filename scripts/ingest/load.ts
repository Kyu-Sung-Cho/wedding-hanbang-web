import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import {
  beginStorageUploadAttempt,
  createStorageUploadReconcileReceipt,
  createStorageIntentJournal,
  createStorageUploadClaimJournal,
  createStorageRollbackJournal,
  createStorageObjectJournal,
  createStagingStorageRollbackReceipt,
  createStagingFinalizeIntent,
  inspectCompletedStateAwareBatches,
  readStagingFinalizeIntent,
  readStagingRunDescriptor,
  readStagingStorageRollbackReceipt,
  readStorageIntentJournals,
  readStorageObjectJournals,
  readStorageUploadClaimJournals,
  readStorageUploadReconcileReceipts,
  readStorageUploadStartedJournals,
  runStateAwareBatches,
  writeStagingRunDescriptor,
  writeStorageIntentJournal,
  writeStorageUploadClaimJournal,
  writeStorageUploadReconcileReceipt,
  writeStorageRollbackJournal,
  writeStorageObjectJournal,
  writeStagingStorageRollbackReceipt,
  writeStagingFinalizeIntent,
  batchAuthorizationBinding,
} from "./batch-safety-journal.js";
import type {
  BatchAuthorizationContext,
  PilotReceiptContext,
  StateAwareBatchRunResult,
  BeginStorageUploadAttemptResult,
  StorageUploadClaim,
} from "./batch-safety-journal.js";
import {
  assertDisclosureStagingProjectRef,
  assertRepositoryProductionProjectRef,
} from "./destination.js";
import { CONVERTER_VERSION } from "./convert.js";
import { canonicalJson, canonicalSha256 } from "./gate-integrity.js";
import { isPathWithin, readJsonFile, sha256File, sha256Text } from "./io.js";
import { readAiLedger, type AiLedgerEntry } from "./ledger.js";
import { loadManifest } from "./manifest.js";
import { buildPartnerVendorRecords } from "./partner-dedupe.js";
import { sourceFileId } from "./provenance.js";
import { normalizeVendorName, SCANNER_PARSER_VERSION } from "./scan.js";
import {
  DisclosureSemanticStagingSchema,
  type DisclosureExtraction,
  type DisclosureSemanticStaging,
} from "./schemas.js";
import {
  currentExtractionFingerprint,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
} from "./extraction-contract.js";
import type { IngestManifest } from "./types.js";
import {
  deriveValidatedPayloadForUnit,
  DedupeCandidatesSchema,
  StrictValidatedArtifactSchema,
  VALIDATOR_VERSION,
  validatedArtifactFingerprint,
  verifyValidationInputsUnchanged,
} from "./validate.js";

export interface RawStorageObject {
  source_path: string;
  absolute_path: string;
  sha256: string;
  ext: string;
  bytes: number;
  storage_path: string;
}

export interface PreviewStorageObject {
  source_label: string;
  source_object_key: string;
  absolute_path: string;
  sha256: string;
  bytes: number;
  storage_path: string;
}

export interface StagingUnit {
  unit_id: string;
  kind_hint: "agency" | "hall";
  region_code: string;
  normalized_name: string;
  raw_name: string;
  corporate_name: string | null;
  source_file: string;
  source_object_keys: string[];
  source_preview_keys: string[];
  source_records: StagingSourceRecord[];
  source_fingerprint: string;
  conversion_fingerprint: string;
  extraction_fingerprint: string;
  validation_fingerprint: string;
  validation_issue_codes: string[];
  data: DisclosureExtraction;
}

export interface StagingSourceRecord {
  source_file_id: string;
  source_file: string;
  source_object_key: string;
  source_preview_key: string | null;
}

export type StagingPriceOption = Omit<
  DisclosureExtraction["agency_packages"][number]["options"][number],
  "source_file_ids"
> & {
  source_file_ids: string[];
  source_file: string;
  source_object_keys: string[];
};

export interface StagingAgencyPackage {
  unit_id: string;
  agency_name: string;
  agency_normalized_name: string;
  agency_corporate_name: string | null;
  region_code: string;
  package_name: string;
  category_scope: Array<"studio" | "dress" | "makeup">;
  price_min_krw: number | null;
  price_max_krw: number | null;
  vat_note: string | null;
  price_note: string | null;
  options: StagingPriceOption[];
  review_status: "pending";
  needs_review: boolean;
  validation_issue_codes: string[];
  source_file: string;
  source_object_keys: string[];
  source_preview_keys: string[];
  source_quote: string;
  confidence: number;
}

export interface StagingOfficialPrice {
  unit_id: string;
  partner_record_ref?: string;
  vendor_name: string;
  alias_proposals: string[];
  source_agency: {
    name: string;
    normalized_name: string;
    corporate_name: string | null;
    region_code: string;
    source_file: string;
  } | null;
  category: "studio" | "dress" | "makeup" | "hall" | "other";
  region_code: string;
  item_name: string;
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  vat_note: string | null;
  price_note: string | null;
  options: StagingPriceOption[];
  review_status: "pending";
  needs_review: boolean;
  validation_issue_codes: string[];
  source_file: string;
  source_object_keys: string[];
  source_preview_keys: string[];
  source_quote: string;
  confidence: number;
  source_record_key: string;
}

export interface StagingLoadPlan {
  schema_version: 2;
  snapshot: string;
  snapshot_source: "kca_tprice";
  units: StagingUnit[];
  skipped_units: StagingSkippedUnit[];
  raw_objects: RawStorageObject[];
  preview_objects: PreviewStorageObject[];
  agency_packages: StagingAgencyPackage[];
  official_prices: StagingOfficialPrice[];
  disclosure_semantics: DisclosureSemanticStaging[];
  dedupe_candidates: StagingDedupeCandidate[];
  ai_ledger: AiLedgerEntry[];
  warnings: string[];
}

export interface StagingSkippedUnit {
  unit_id: string;
  display_name: string;
  stage: string;
  reason: string;
}

export interface StagingDedupeCandidate {
  entity_kind: "vendor" | "agency";
  left_unit_id: string;
  right_unit_id: string;
  left_record_ref?: string;
  right_record_ref?: string;
  similarity: number;
  reason: string;
  status: "pending";
}

export interface StagingWriterResult {
  loadedUnitIds: string[];
  skippedUnitIds: string[];
  loggedLedgerIds: string[];
  atomicBatchReceiptSha256?: string;
}

export interface StagingStorageMutation {
  bucket: "disclosure-raw" | "disclosure-preview";
  object_key: string;
  sha256: string;
  bytes: number;
  created: boolean;
}

export type StagingStorageIntent = Omit<StagingStorageMutation, "created">;

export interface StagingStorageOutcome extends StagingStorageIntent {
  state:
    | "intent"
    | "confirmed_created"
    | "confirmed_preexisting"
    | "confirmed_inherited"
    | "delete_authorized"
    | "deleted"
    | "retained_shared"
    | "ambiguous";
}

export interface StagingBatchWriteContext {
  target_project_ref: string;
  run_sha256: string;
  full_plan_sha256: string;
  batch_plan_sha256: string;
  batch_sha256: string;
  batch_index: number;
  batch_count: number;
  unit_ids: string[];
  authorization_kind: "paid_pilot_gate" | "local_validated_pending_only";
  authorization_sha256: string;
  local_pending_only_unit_ids: string[];
  storage_claimant_id: string;
  record_storage_intent: (objects: readonly StagingStorageIntent[]) => Promise<string>;
  read_storage_claim: (
    object: StagingStorageIntent,
    objectIndex: number,
  ) => Promise<StorageUploadClaim | null>;
  record_storage_claim: (
    claim: StorageUploadClaim,
    objectIndex: number,
  ) => Promise<string>;
  record_storage_upload_started: (
    claim: StorageUploadClaim,
    objectIndex: number,
    freshClaim: boolean,
  ) => Promise<BeginStorageUploadAttemptResult>;
  record_storage_object: (
    object: StagingStorageMutation,
    objectIndex: number,
    claim: StorageUploadClaim,
    uploadAttempt: number,
  ) => Promise<string>;
  record_storage_journal: (objects: readonly StagingStorageMutation[]) => Promise<string>;
}

export type StagingBatchReceiptContext = Omit<
  StagingBatchWriteContext,
  "storage_claimant_id" | "record_storage_intent" | "read_storage_claim"
    | "record_storage_claim" | "record_storage_upload_started"
    | "record_storage_object" | "record_storage_journal"
>;

export interface StagingDedupeFinalizeContext {
  target_project_ref: string;
  run_sha256: string;
  full_plan_sha256: string;
  dedupe_candidates_sha256: string;
  completed_batch_sha256s: string[];
}

export interface StagingAbortContext {
  target_project_ref: string;
  run_sha256: string;
  full_plan_sha256: string;
  reason: string;
  locally_created_storage_objects: StagingStorageMutation[];
}

export interface StagingAbortResult {
  runFound: boolean;
  deletedPackageCount: number;
  deletedPriceCount: number;
  deletedSemanticCount: number;
  deletedVendorCount: number;
  deletedAgencyCount: number;
  deletedTimeslotCount: number;
  deletedLedgerCount: number;
  retainedIdentityCount: number;
  retainedLedgerCount: number;
  storageRollbackObjects: StagingStorageIntent[];
  storageObjectOutcomes: StagingStorageOutcome[];
  storageRollbackReceiptSha256: string | null;
  ambiguousStorageObjectCount: number;
  retainedStorageObjectCount: number;
  alreadyMissingStorageObjectCount: number;
  manualStorageDeletionRequiredCount: number;
  alreadyAborted: boolean;
  completedStorageObjectCount: number;
}

export interface StagingStorageRollbackCompletionContext {
  target_project_ref: string;
  run_sha256: string;
  full_plan_sha256: string;
  storage_rollback_receipt_sha256: string;
  storage_rollback_objects: StagingStorageIntent[];
}

export interface StagingStorageRollbackCompletionResult {
  completedObjectCount: number;
  alreadyCompleted: boolean;
}

export interface StagingInvalidationContext {
  target_project_ref: string;
  run_sha256: string;
  full_plan_sha256: string;
  reason: string;
}

export interface StagingInvalidationResult {
  invalidated: boolean;
  alreadyInvalidated: boolean;
  invalidationReceiptSha256: string;
}

export interface AuthorizeStagingStorageUploadRetryInput {
  stateDir: string;
  fullPlanSha256: string;
  targetProjectRef: string;
  batchIndex: number;
  objectIndex: number;
  confirmedNoInflightAt: string;
  reason: string;
  confirmation: "no_inflight_upload_confirmed";
}

export interface AuthorizeStagingStorageUploadRetryResult {
  runSha256: string;
  batchIndex: number;
  objectIndex: number;
  claimEpoch: number;
  previousUploadAttempt: number;
  nextUploadAttempt: number;
  receiptSha256: string;
  receiptPath: string;
}

export class StagingRollbackIncompleteError extends Error {
  readonly result: StagingAbortResult;

  constructor(result: StagingAbortResult) {
    super(
      `staging rollback requires manual reconciliation for ${result.ambiguousStorageObjectCount} ambiguous and ${result.manualStorageDeletionRequiredCount} deletion-authorized Storage object(s)`,
    );
    this.name = "StagingRollbackIncompleteError";
    this.result = result;
  }
}

export class StagingStorageIntentsUnsettledError extends Error {
  readonly unsettledIntentCount: number | null;

  constructor(unsettledIntentCount: number | null) {
    const count = unsettledIntentCount === null ? "unknown" : String(unsettledIntentCount);
    super(
      `staging abort is blocked by ${count} unsettled Storage upload intent(s); resume the exact staging load so every intent is remotely verified and recorded before abort`,
    );
    this.name = "StagingStorageIntentsUnsettledError";
    this.unsettledIntentCount = unsettledIntentCount;
  }
}

export interface StagingWriter {
  stage(plan: StagingLoadPlan, context?: StagingBatchWriteContext): Promise<StagingWriterResult>;
  verifyBatchReceipt?: (
    context: StagingBatchReceiptContext,
    expectedReceiptSha256: string,
  ) => Promise<StagingWriterResult>;
  finalizeDedupe?: (
    plan: StagingLoadPlan,
    context: StagingDedupeFinalizeContext,
  ) => Promise<void>;
  abortRun?: (context: StagingAbortContext) => Promise<StagingAbortResult>;
  completeStorageRollback?: (
    context: StagingStorageRollbackCompletionContext,
  ) => Promise<StagingStorageRollbackCompletionResult>;
  invalidateRun?: (context: StagingInvalidationContext) => Promise<StagingInvalidationResult>;
}

export interface LoadOptions {
  stateDir: string;
  snapshot: string;
  apply?: boolean;
  confirmProjectRef?: string;
  expectedFullPlanSha256?: string;
  expectedAuthorizationSha256?: string;
  expectedRunSha256?: string;
}

export interface LoadDependencies {
  writer?: StagingWriter;
  env?: NodeJS.ProcessEnv;
  batchAuthorization?: PilotReceiptContext;
  pendingOnlyAuthorization?: LocalPendingOnlyAuthorization;
  startedAt?: string;
}

export interface StagingEnvironment {
  url: string;
  key: string;
  projectRef: string;
  bucket: string;
  previewBucket: string;
}

export interface LoadResult {
  mode: "dry-run" | "loaded-batches-verified";
  plan: StagingLoadPlan;
  manifest: IngestManifest;
  writer_result: StagingWriterResult | null;
  batch_run?: StateAwareBatchRunResult;
}

function deterministicTextCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceFileBundle(paths: string[]): string {
  const canonical = [...new Set(paths)];
  return canonical.length === 1 ? canonical[0] : JSON.stringify(canonical);
}

export function stagingProvenanceForSourceIds(
  unit: StagingUnit,
  sourceIds: string[] | undefined,
): Pick<StagingAgencyPackage, "source_file" | "source_object_keys" | "source_preview_keys"> & {
  source_file_ids: string[];
} {
  const uniqueSourceIds = sourceIds ? new Set(sourceIds) : new Set<string>();
  const selected = unit.source_records.filter((record) => uniqueSourceIds.has(record.source_file_id));
  if (
    !sourceIds
    || sourceIds.length === 0
    || uniqueSourceIds.size !== sourceIds.length
    || selected.length !== uniqueSourceIds.size
  ) {
    throw new Error(`행 단위 source_file_ids가 unit 원본과 일치하지 않습니다: ${unit.raw_name}`);
  }
  return {
    source_file_ids: selected.map((record) => record.source_file_id),
    source_file: sourceFileBundle(selected.map((record) => record.source_file)),
    source_object_keys: selected.map((record) => record.source_object_key),
    source_preview_keys: selected
      .map((record) => record.source_preview_key)
      .filter((key): key is string => key !== null),
  };
}

function stagingRowProvenanceForSourceIds(
  unit: StagingUnit,
  sourceIds: string[] | undefined,
): Pick<StagingAgencyPackage, "source_file" | "source_object_keys" | "source_preview_keys"> {
  const { source_file_ids: _sourceFileIds, ...provenance } = stagingProvenanceForSourceIds(unit, sourceIds);
  return provenance;
}

export function stagingOption(unit: StagingUnit, option: DisclosureExtraction["agency_packages"][number]["options"][number]): StagingPriceOption {
  const provenance = stagingProvenanceForSourceIds(unit, option.source_file_ids);
  const { source_file_ids: _sourceFileIds, ...safeOption } = option;
  return {
    ...safeOption,
    source_file_ids: provenance.source_file_ids,
    source_file: provenance.source_file,
    source_object_keys: provenance.source_object_keys,
  };
}

const MAX_PREVIEW_OBJECT_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_UNIT_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW_OBJECTS_PER_UNIT = 16;

async function conversionArtifactFingerprint(filePaths: string[]): Promise<string> {
  const records = await Promise.all(
    [...filePaths].sort((left, right) => left.localeCompare(right, "en")).map(async (filePath) => {
      const digest = await sha256File(filePath);
      return `${path.resolve(filePath)}\0${digest.sha256}`;
    }),
  );
  return sha256Text(records.join("\n"));
}

function portableSourceLabel(sourcePath: string): string {
  return path.posix.basename(sourcePath.replaceAll("\\", "/"));
}

async function sourceForConvertedImage(
  unit: IngestManifest["units"][number],
  unitArtifactRoot: string,
  imageArtifactPath: string,
): Promise<IngestManifest["units"][number]["source_files"][number]> {
  const realImagePath = await realpath(imageArtifactPath);
  for (const source of unit.source_files) {
    if (await realpath(source.absolute_path) === realImagePath) return source;
  }

  if (!isPathWithin(unitArtifactRoot, realImagePath)) {
    throw new Error(`OCR preview image provenance is outside the conversion directory: ${unit.display_name}`);
  }
  const firstSegment = path.relative(unitArtifactRoot, realImagePath).split(path.sep)[0] ?? "";
  const sourcePrefix = /^(\d+)-(?:media|docx-media|pdf-pages)$/u.exec(firstSegment);
  const sourceIndex = sourcePrefix ? Number.parseInt(sourcePrefix[1]!, 10) - 1 : -1;
  // convertManifest numbers artifacts after removing HWP provenance-only
  // sources. Resolve the same positional domain here so a same-stem HWP/PDF
  // pair still maps `1-pdf-pages` back to the replacement PDF.
  const source = unit.source_files.filter(({ ext }) => ext !== "hwp")[sourceIndex];
  if (!source) {
    throw new Error(`OCR preview image/source mapping is not deterministic: ${unit.display_name}`);
  }
  return source;
}

export async function buildUnitPreviewObjects(
  stateDir: string,
  unit: IngestManifest["units"][number],
): Promise<PreviewStorageObject[]> {
  const conversion = unit.conversion;
  // A deliberately authorized local review-only replay may coexist with the
  // historical paid metadata it supersedes. The validation provider is the
  // authoritative chain selector; preferring stale paid metadata here makes
  // preview provenance disagree with the artifact that was just replayed.
  const extraction = unit.validation?.provider_mode === "local_deterministic"
    && unit.local_extraction?.paid_review_only_override === true
    ? unit.local_extraction
    : unit.extraction ?? unit.local_extraction;
  if (!conversion || !extraction) {
    throw new Error(`conversion provenance가 없습니다: ${unit.display_name}`);
  }
  if (
    conversion.source_fingerprint !== unit.source_fingerprint
    || extraction.source_fingerprint !== unit.source_fingerprint
    || extraction.artifact_fingerprint !== conversion.artifact_fingerprint
  ) {
    throw new Error(`conversion provenance가 일치하지 않습니다: ${unit.display_name}`);
  }
  const allArtifactPaths = [...conversion.text_artifacts, ...conversion.image_artifacts];
  if (await conversionArtifactFingerprint(allArtifactPaths) !== conversion.artifact_fingerprint) {
    throw new Error(`conversion artifact hash가 일치하지 않습니다: ${unit.display_name}`);
  }

  const unitArtifactRoot = path.join(
    path.resolve(stateDir),
    ".converted",
    unit.unit_id,
    unit.source_fingerprint,
  );
  const realUnitArtifactRoot = await realpath(unitArtifactRoot);
  // Conversion artifact prefixes are positional within the convertible source
  // list. HWP files remain immutable raw provenance, but they do not consume a
  // conversion index when a same-stem PDF replacement is present.
  const expectedArtifacts = unit.source_files
    .filter(({ ext }) => ext !== "hwp")
    .flatMap((source, index) => {
      if (source.ext === "xlsx") return [{ source, name: `${index + 1}-sheets.txt` }];
      if (source.ext === "docx") return [{ source, name: `${index + 1}-doc.txt` }];
      if (source.ext === "pdf") return [{ source, name: `${index + 1}-pdf.txt` }];
      return [];
    });
  if (conversion.ocr_review) {
    const seenPages = new Set<number>();
    for (const artifact of conversion.ocr_review.artifacts) {
      if (seenPages.has(artifact.page)) {
        throw new Error(`OCR preview page is duplicated: ${unit.display_name}`);
      }
      seenPages.add(artifact.page);
      const imageArtifactPath = conversion.image_artifacts[artifact.page - 1];
      if (!imageArtifactPath) {
        throw new Error(`OCR preview page/image mapping is incomplete: ${unit.display_name}`);
      }
      const imageDigest = await sha256File(imageArtifactPath);
      if (imageDigest.sha256 !== artifact.source_image_sha256) {
        throw new Error(`OCR preview image hash does not match conversion metadata: ${unit.display_name}`);
      }
      expectedArtifacts.push({
        source: await sourceForConvertedImage(unit, realUnitArtifactRoot, imageArtifactPath),
        name: path.basename(artifact.artifact_path),
      });
    }
  }
  if (new Set(expectedArtifacts.map(({ name }) => name)).size !== expectedArtifacts.length) {
    throw new Error(`preview artifact source mapping is ambiguous: ${unit.display_name}`);
  }
  const actualByName = new Map<string, string>();
  for (const artifactPath of conversion.text_artifacts) {
    const resolved = await realpath(artifactPath);
    if (!isPathWithin(realUnitArtifactRoot, resolved)) {
      throw new Error(`preview artifact path가 변환 디렉터리를 벗어났습니다: ${unit.display_name}`);
    }
    const name = path.basename(resolved);
    if (actualByName.has(name)) throw new Error(`preview artifact가 중복되었습니다: ${unit.display_name}`);
    actualByName.set(name, resolved);
  }
  if (
    expectedArtifacts.length !== actualByName.size
    || expectedArtifacts.some(({ name }) => !actualByName.has(name))
  ) {
    throw new Error(`preview artifact/source 매핑이 일치하지 않습니다: ${unit.display_name}`);
  }
  if (expectedArtifacts.length > MAX_PREVIEW_OBJECTS_PER_UNIT) {
    throw new Error(`preview artifact 개수가 제한을 초과했습니다: ${unit.display_name}`);
  }

  let totalBytes = 0;
  const objects: PreviewStorageObject[] = [];
  for (const { source, name } of expectedArtifacts) {
    const absolutePath = actualByName.get(name);
    if (!absolutePath) throw new Error(`preview artifact가 없습니다: ${unit.display_name}`);
    const digest = await sha256File(absolutePath);
    totalBytes += digest.bytes;
    if (digest.bytes > MAX_PREVIEW_OBJECT_BYTES || totalBytes > MAX_PREVIEW_UNIT_BYTES) {
      throw new Error(`preview artifact 크기가 제한을 초과했습니다: ${unit.display_name}`);
    }
    objects.push({
      source_label: portableSourceLabel(source.path),
      source_object_key: `${source.sha256}.${source.ext}`,
      absolute_path: absolutePath,
      sha256: digest.sha256,
      bytes: digest.bytes,
      storage_path: `${digest.sha256}.txt`,
    });
  }
  return objects;
}

export interface StagingBatchPlan {
  batch_index: number;
  batch_count: number;
  unit_ids: string[];
  plan: StagingLoadPlan;
  batch_plan_sha256: string;
  batch_sha256: string;
}

export interface StagingRunDescriptor {
  schema_version: 2;
  kind: "vendor_disclosure_staging_run";
  started_at: string;
  target_project_ref: string;
  snapshot: string;
  full_plan_sha256: string;
  dedupe_candidates_sha256: string;
  authorization_kind: "paid_pilot_gate" | "local_validated_pending_only";
  authorization_sha256: string;
  local_pending_only_unit_ids: string[];
  batch_sha256s: string[];
  run_sha256: string;
}

export interface LocalPendingOnlyApplyConfirmation {
  expectedFullPlanSha256: string;
  expectedAuthorizationSha256: string;
  expectedRunSha256: string;
}

export interface LocalPendingOnlyApplyPreparation {
  started_at: string;
  target_project_ref: string;
  manifest_sha256: string;
  full_plan_sha256: string;
  batch_sha256s: string[];
  authorization: LocalPendingOnlyAuthorization;
  descriptor: StagingRunDescriptor;
}

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const LocalPendingOnlyAuthorizationPayloadSchema = z.object({
  created_at: z.string().datetime(),
  target_project_ref: z.string().regex(/^[a-z0-9][a-z0-9-]{3,80}$/u),
  manifest_sha256: Sha256Schema,
  full_plan_sha256: Sha256Schema,
  snapshot: z.string().regex(/^20\d{2}Q[1-4]$/u),
  ordered_batch_sha256s: z.array(Sha256Schema).min(1).max(1_000),
  units: z.array(z.object({
    unit_id: Sha256Schema,
    source_fingerprint: Sha256Schema,
    conversion_fingerprint: Sha256Schema,
    extraction_fingerprint: Sha256Schema,
    extraction_content_sha256: Sha256Schema,
    validation_fingerprint: Sha256Schema,
  }).strict()).min(1).max(1_000),
  provider_mode: z.literal("local_deterministic"),
  provider_calls: z.literal(false),
  input_tokens: z.literal(0),
  output_tokens: z.literal(0),
  cost_usd: z.literal(0),
  production_target: z.literal(false),
  review_status: z.literal("pending"),
  needs_review: z.literal(true),
  bulk_approval_eligible: z.literal(false),
  approval_allowed: z.literal(false),
  publish_allowed: z.literal(false),
}).strict().superRefine((value, context) => {
  const ids = value.units.map((unit) => unit.unit_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "local pending-only authorization has duplicate unit IDs" });
  }
});

const LocalPendingOnlyAuthorizationSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_local_pending_only_authorization"),
  payload: LocalPendingOnlyAuthorizationPayloadSchema,
  authorization_sha256: Sha256Schema,
}).strict();

export type LocalPendingOnlyAuthorization = z.output<typeof LocalPendingOnlyAuthorizationSchema>;

export interface CreateLocalPendingOnlyAuthorizationInput {
  createdAt: string;
  targetProjectRef: string;
  manifestSha256: string;
  fullPlanSha256: string;
  snapshot: string;
  orderedBatchSha256s: readonly string[];
  localUnitIds: readonly string[];
  sourceFingerprints: readonly string[];
  conversionFingerprints: readonly string[];
  extractionFingerprints: readonly string[];
  extractionContentSha256s: readonly string[];
  validationFingerprints: readonly string[];
}

export function validateLocalPendingOnlyAuthorization(
  value: unknown,
): LocalPendingOnlyAuthorization {
  const authorization = LocalPendingOnlyAuthorizationSchema.parse(value);
  if (canonicalSha256(authorization.payload) !== authorization.authorization_sha256) {
    throw new Error("local pending-only authorization SHA-256 does not match its payload");
  }
  return authorization;
}

export function createLocalPendingOnlyAuthorization(
  input: CreateLocalPendingOnlyAuthorizationInput,
): LocalPendingOnlyAuthorization {
  const claimLengths = [
    input.sourceFingerprints.length,
    input.conversionFingerprints.length,
    input.extractionFingerprints.length,
    input.extractionContentSha256s.length,
    input.validationFingerprints.length,
  ];
  if (claimLengths.some((length) => length !== input.localUnitIds.length)) {
    throw new Error("local pending-only authorization unit artifact claim counts differ");
  }
  assertDisclosureStagingProjectRef(input.targetProjectRef);
  const payload = LocalPendingOnlyAuthorizationPayloadSchema.parse({
    created_at: new Date(input.createdAt).toISOString(),
    target_project_ref: input.targetProjectRef,
    manifest_sha256: input.manifestSha256,
    full_plan_sha256: input.fullPlanSha256,
    snapshot: input.snapshot,
    ordered_batch_sha256s: input.orderedBatchSha256s,
    units: input.localUnitIds.map((unitId, index) => ({
      unit_id: unitId,
      source_fingerprint: input.sourceFingerprints[index],
      conversion_fingerprint: input.conversionFingerprints[index],
      extraction_fingerprint: input.extractionFingerprints[index],
      extraction_content_sha256: input.extractionContentSha256s[index],
      validation_fingerprint: input.validationFingerprints[index],
    })),
    provider_mode: "local_deterministic",
    provider_calls: false,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    production_target: false,
    review_status: "pending",
    needs_review: true,
    bulk_approval_eligible: false,
    approval_allowed: false,
    publish_allowed: false,
  });
  return validateLocalPendingOnlyAuthorization({
    schema_version: 1,
    kind: "vendor_ingest_local_pending_only_authorization",
    payload,
    authorization_sha256: canonicalSha256(payload),
  });
}

function localPendingOnlyUnitIds(plan: StagingLoadPlan): string[] {
  const planned = new Set(plan.units.map((unit) => unit.unit_id));
  const ids = plan.warnings
    .filter((warning) => warning.startsWith("local_deterministic_review_only:"))
    .map((warning) => warning.slice("local_deterministic_review_only:".length));
  if (new Set(ids).size !== ids.length || ids.some((unitId) => !planned.has(unitId))) {
    throw new Error("local pending-only unit markers are duplicate or outside the full plan");
  }
  return plan.units.map((unit) => unit.unit_id).filter((unitId) => ids.includes(unitId));
}

function portableStagingPlan(plan: StagingLoadPlan): unknown {
  return {
    ...plan,
    raw_objects: plan.raw_objects.map(({ absolute_path: _absolutePath, ...raw }) => raw),
    preview_objects: plan.preview_objects.map(({ absolute_path: _absolutePath, ...preview }) => preview),
  };
}

export function stagingLoadPlanSha256(plan: StagingLoadPlan): string {
  return sha256Text(canonicalJson(portableStagingPlan(plan)));
}

function stagingPlanForUnitIds(plan: StagingLoadPlan, unitIds: readonly string[]): StagingLoadPlan {
  if (unitIds.length < 1 || unitIds.length > 25) {
    throw new Error("a logical staging batch must contain between 1 and 25 units");
  }
  const selected = new Set(unitIds);
  if (selected.size !== unitIds.length) throw new Error("a staging batch cannot contain duplicate unit IDs");
  const units = plan.units.filter((unit) => selected.has(unit.unit_id));
  if (
    units.length !== unitIds.length
    || units.some((unit, index) => unit.unit_id !== unitIds[index])
  ) {
    throw new Error("a staging batch must preserve the exact full-plan unit order");
  }
  const rawObjectKeys = new Set(units.flatMap((unit) => unit.source_object_keys));
  const previewObjectKeys = new Set(units.flatMap((unit) => unit.source_preview_keys));
  const warnings = plan.warnings.filter((warning) => unitIds.some((unitId) => warning.includes(unitId)));
  return {
    ...plan,
    units,
    skipped_units: [],
    raw_objects: plan.raw_objects.filter((raw) => rawObjectKeys.has(raw.storage_path)),
    preview_objects: plan.preview_objects.filter((preview) => previewObjectKeys.has(preview.storage_path)),
    agency_packages: plan.agency_packages.filter((row) => selected.has(row.unit_id)),
    official_prices: plan.official_prices.filter((row) => selected.has(row.unit_id)),
    disclosure_semantics: plan.disclosure_semantics.filter((row) => selected.has(row.unit_id)),
    // Dedupe candidates can cross a 25-unit boundary. They are persisted only
    // by the run finalizer after every exact batch has committed.
    dedupe_candidates: [],
    ai_ledger: plan.ai_ledger.filter((entry) => selected.has(entry.unit_id)),
    warnings,
  };
}

export function buildStagingBatches(plan: StagingLoadPlan): StagingBatchPlan[] {
  if (plan.units.length === 0) return [];
  const allUnitIds = plan.units.map((unit) => unit.unit_id);
  if (new Set(allUnitIds).size !== allUnitIds.length) {
    throw new Error("the staging load plan contains duplicate unit IDs");
  }
  const batchCount = Math.ceil(allUnitIds.length / 25);
  const batches: StagingBatchPlan[] = [];
  for (let offset = 0; offset < allUnitIds.length; offset += 25) {
    const unitIds = allUnitIds.slice(offset, offset + 25);
    const batchIndex = batches.length + 1;
    const batchPlan = stagingPlanForUnitIds(plan, unitIds);
    const batchPlanSha256 = stagingLoadPlanSha256(batchPlan);
    const batchSha256 = sha256Text(canonicalJson({
      schema_version: 1,
      batch_index: batchIndex,
      batch_count: batchCount,
      full_plan_sha256: stagingLoadPlanSha256(plan),
      unit_ids: unitIds,
      batch_plan_sha256: batchPlanSha256,
    }));
    batches.push({
      batch_index: batchIndex,
      batch_count: batchCount,
      unit_ids: unitIds,
      plan: batchPlan,
      batch_plan_sha256: batchPlanSha256,
      batch_sha256: batchSha256,
    });
  }
  return batches;
}

export function createStagingRunDescriptor(
  plan: StagingLoadPlan,
  targetProjectRef: string,
  startedAt: string,
  batchAuthorization: BatchAuthorizationContext,
  pendingOnlyAuthorization: LocalPendingOnlyAuthorization | null,
): StagingRunDescriptor {
  assertDisclosureStagingProjectRef(targetProjectRef);
  const normalizedStartedAt = new Date(startedAt).toISOString();
  const fullPlanSha256 = stagingLoadPlanSha256(plan);
  const localUnitIds = localPendingOnlyUnitIds(plan);
  const authorization = pendingOnlyAuthorization === null
    ? null
    : validateLocalPendingOnlyAuthorization(pendingOnlyAuthorization);
  const authorizationBinding = batchAuthorizationBinding(batchAuthorization);
  if (localUnitIds.length === 0) {
    if (authorization !== null) {
      throw new Error("a local pending-only authorization cannot be attached to a plan without local units");
    }
    if (authorizationBinding.kind !== "paid_pilot_gate") {
      throw new Error("a non-local plan requires the paid pilot gate authorization kind");
    }
  } else if (
    authorization === null
    || authorization.payload.target_project_ref !== targetProjectRef
    || authorization.payload.full_plan_sha256 !== fullPlanSha256
    || !isDeepStrictEqual(
      authorization.payload.units.map((unit) => unit.unit_id),
      localUnitIds,
    )
    || authorizationBinding.kind !== "local_validated_pending_only"
    || authorizationBinding.sha256 !== authorization.authorization_sha256
  ) {
    throw new Error("the separate local pending-only authorization does not match the staging plan");
  }
  const payload = {
    schema_version: 2 as const,
    kind: "vendor_disclosure_staging_run" as const,
    started_at: normalizedStartedAt,
    target_project_ref: targetProjectRef,
    snapshot: plan.snapshot,
    full_plan_sha256: fullPlanSha256,
    dedupe_candidates_sha256: sha256Text(canonicalJson(plan.dedupe_candidates)),
    authorization_kind: authorizationBinding.kind,
    authorization_sha256: authorizationBinding.sha256,
    local_pending_only_unit_ids: localUnitIds,
    batch_sha256s: buildStagingBatches(plan).map((batch) => batch.batch_sha256),
  };
  return {
    ...payload,
    run_sha256: sha256Text(canonicalJson(payload)),
  };
}

export async function resolveStagingRunDescriptor(input: {
  stateDir: string;
  plan: StagingLoadPlan;
  targetProjectRef: string;
  requestedStartedAt?: string;
  batchAuthorization: BatchAuthorizationContext;
  pendingOnlyAuthorization: LocalPendingOnlyAuthorization | null;
}): Promise<StagingRunDescriptor> {
  const fullPlanSha256 = stagingLoadPlanSha256(input.plan);
  const persisted = await readStagingRunDescriptor(input.stateDir, fullPlanSha256);
  if (persisted) {
    const expected = createStagingRunDescriptor(
      input.plan,
      input.targetProjectRef,
      persisted.started_at,
      input.batchAuthorization,
      input.pendingOnlyAuthorization,
    );
    if (!isDeepStrictEqual(persisted, expected)) {
      throw new Error("persisted staging run identity does not match the current full plan and authorization");
    }
    return persisted;
  }
  if (!input.requestedStartedAt) {
    throw new Error("a new staging run requires one explicit stable startedAt timestamp");
  }
  const created = createStagingRunDescriptor(
    input.plan,
    input.targetProjectRef,
    input.requestedStartedAt,
    input.batchAuthorization,
    input.pendingOnlyAuthorization,
  );
  await writeStagingRunDescriptor(input.stateDir, created);
  return created;
}

type DisclosureSemanticWithoutContentFingerprint = Omit<
  DisclosureSemanticStaging,
  "content_fingerprint"
>;

export function buildDisclosureSemanticContentFingerprint(
  row: DisclosureSemanticWithoutContentFingerprint | DisclosureSemanticStaging,
): string {
  const { content_fingerprint: _contentFingerprint, ...content } = row as DisclosureSemanticStaging;
  return sha256Text(canonicalJson(content));
}

export function buildDisclosureSemanticSourceRecordKey(input: {
  schema_version: 2;
  source_fingerprint: string;
  record_kind: DisclosureSemanticStaging["record_kind"];
  semantic_type: DisclosureSemanticStaging["semantic_type"];
  subject_kind: DisclosureSemanticStaging["subject_kind"];
  subject_normalized_name: string;
  partner_record_ref: string | null;
  title: string | null;
  source_file_ids: string[];
  source_quote: string;
  // Accepted as part of a semantic row, but deliberately excluded from the
  // locator key. Content drift at one locator must collide and be detected by
  // content_fingerprint instead of silently creating a second logical row.
  content_verbatim: string;
}): string {
  if (
    input.source_file_ids.length === 0
    || new Set(input.source_file_ids).size !== input.source_file_ids.length
    || input.source_file_ids.some((sourceId) => !/^[a-f0-9]{64}$/u.test(sourceId))
  ) {
    throw new Error("disclosure semantic source ids must be a non-empty canonical SHA-256 subset");
  }
  if (input.partner_record_ref !== null && !/^[a-f0-9]{64}$/u.test(input.partner_record_ref)) {
    throw new Error("disclosure semantic partner record ref must be a SHA-256 digest or null");
  }
  return sha256Text(canonicalJson({
    schema_version: input.schema_version,
    source_fingerprint: input.source_fingerprint,
    record_kind: input.record_kind,
    semantic_type: input.semantic_type,
    subject_kind: input.subject_kind,
    subject_normalized_name: input.subject_normalized_name,
    partner_record_ref: input.partner_record_ref,
    title: input.title,
    source_file_ids: input.source_file_ids,
    source_quote: input.source_quote,
  }));
}

export function stagingDisclosureSemantics(unit: StagingUnit): DisclosureSemanticStaging[] {
  const rows: DisclosureSemanticStaging[] = [];
  const append = (candidate: Omit<
    DisclosureSemanticWithoutContentFingerprint,
    "source_record_key"
  >): void => {
    const sourceRecordKey = buildDisclosureSemanticSourceRecordKey(candidate);
    const rowWithoutContentFingerprint: DisclosureSemanticWithoutContentFingerprint = {
      ...candidate,
      source_record_key: sourceRecordKey,
    };
    rows.push(DisclosureSemanticStagingSchema.parse({
      ...rowWithoutContentFingerprint,
      content_fingerprint: buildDisclosureSemanticContentFingerprint(rowWithoutContentFingerprint),
    }));
  };

  const partnerRecords = buildPartnerVendorRecords(
    unit.unit_id,
    unit.region_code,
    unit.data.partner_vendors,
  );
  for (const [vendorIndex, vendor] of unit.data.partner_vendors.entries()) {
    const partnerRecord = partnerRecords[vendorIndex];
    if (!partnerRecord) throw new Error("partner vendor semantic row reference could not be resolved");
    const normalizedVendorName = normalizeVendorName(vendor.vendor_name);
    if (!normalizedVendorName) throw new Error("disclosure semantic vendor subject must not be empty");
    for (const policy of vendor.policies ?? []) {
      const provenance = stagingProvenanceForSourceIds(unit, policy.source_file_ids);
      append({
        schema_version: 2,
        unit_id: unit.unit_id,
        record_kind: "vendor_policy",
        semantic_type: policy.policy_type,
        subject_kind: "vendor",
        subject_name: vendor.vendor_name,
        subject_normalized_name: normalizedVendorName,
        partner_record_ref: partnerRecord.record_ref,
        source_agency: unit.kind_hint === "agency" ? {
          name: unit.raw_name,
          normalized_name: unit.normalized_name,
          corporate_name: unit.corporate_name,
          region_code: unit.region_code,
          source_file: provenance.source_file,
        } : null,
        partner_link_status: partnerRecord.stageable || partnerVendorHasSourceIdentity(vendor)
          ? "price_row_staged"
          : "policy_only_pending_identity",
        vendor_category: vendor.category,
        region_code: unit.region_code,
        title: null,
        content_verbatim: policy.raw_text,
        summary: null,
        review_status: "pending",
        needs_review: vendor.needs_review
          || vendor.confidence < 0.8
          || unit.validation_issue_codes.length > 0,
        validation_issue_codes: unit.validation_issue_codes,
        ...provenance,
        source_quote: policy.source_quote,
        source_fingerprint: unit.source_fingerprint,
        validation_fingerprint: unit.validation_fingerprint,
        confidence: vendor.confidence,
      });
    }
  }

  for (const section of unit.data.sections ?? []) {
    const provenance = stagingProvenanceForSourceIds(unit, section.source_file_ids);
    append({
      schema_version: 2,
      unit_id: unit.unit_id,
      record_kind: "document_section",
      semantic_type: section.section_type,
      subject_kind: unit.kind_hint === "agency" ? "agency" : "vendor",
      subject_name: unit.raw_name,
      subject_normalized_name: unit.normalized_name,
      partner_record_ref: null,
      source_agency: null,
      partner_link_status: "not_applicable",
      vendor_category: null,
      region_code: unit.region_code,
      title: section.title,
      content_verbatim: section.content_verbatim,
      summary: section.summary,
      review_status: "pending",
      needs_review: section.needs_review
        || section.confidence < 0.8
        || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: section.source_quote,
      source_fingerprint: unit.source_fingerprint,
      validation_fingerprint: unit.validation_fingerprint,
      confidence: section.confidence,
    });
  }
  return rows;
}

type OfficialPriceRowKind = "partner" | "hall_venue_fee" | "hall_meal_price" | "hall_item";

function normalizedLogicalIdentity(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`official price ${label} must be a string`);
  }
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ");
  if (!normalized) throw new Error(`official price ${label} must not be empty`);
  return normalized;
}

function officialPriceLogicalIdentity(
  rowKind: OfficialPriceRowKind,
  payload: unknown,
  occurrence: number,
): Record<string, unknown> {
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
    throw new Error("official price logical occurrence must be a non-negative integer");
  }
  const record = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  if (rowKind === "partner") {
    return {
      category: normalizedLogicalIdentity(record.category, "category"),
      vendor_name: normalizedLogicalIdentity(
        record.normalized_vendor_name ?? record.vendor_name,
        "vendor identity",
      ),
      occurrence,
    };
  }
  if (rowKind === "hall_item") {
    return {
      item_name: normalizedLogicalIdentity(record.name ?? record.item_name, "hall item identity"),
      occurrence,
    };
  }
  return { occurrence };
}

export function buildOfficialPriceContentFingerprint(payload: unknown): string {
  return sha256Text(canonicalJson(payload));
}

export function buildOfficialPriceSourceRecordKey(
  sourceFingerprint: string,
  rowKind: OfficialPriceRowKind,
  payload: unknown,
  occurrence = 0,
): string {
  return sha256Text([
    sourceFingerprint,
    rowKind,
    canonicalJson(officialPriceLogicalIdentity(rowKind, payload, occurrence)),
  ].join("\0"));
}

function logicalOccurrence<T>(
  items: T[],
  index: number,
  rowKind: "partner" | "hall_item",
): number {
  const target = canonicalJson(officialPriceLogicalIdentity(rowKind, items[index], 0));
  let occurrence = 0;
  for (let candidateIndex = 0; candidateIndex < index; candidateIndex += 1) {
    if (canonicalJson(officialPriceLogicalIdentity(rowKind, items[candidateIndex], 0)) === target) {
      occurrence += 1;
    }
  }
  return occurrence;
}

function legacyHallPriceRows(unit: StagingUnit): StagingOfficialPrice[] {
  const rows: StagingOfficialPrice[] = [];
  const hall = unit.data.hall;
  const vendorName = unit.raw_name;
  if (hall.venue_fee_krw !== null && hall.venue_fee_source_quote) {
    const provenance = stagingRowProvenanceForSourceIds(unit, hall.venue_fee_source_file_ids);
    rows.push({
      unit_id: unit.unit_id,
      vendor_name: vendorName,
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: unit.region_code,
      item_name: "대관료",
      base_spec: null,
      price_min_krw: hall.venue_fee_krw,
      price_max_krw: hall.venue_fee_krw,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: hall.needs_review || hall.confidence < 0.8 || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: hall.venue_fee_source_quote,
      confidence: hall.confidence,
      source_record_key: buildOfficialPriceSourceRecordKey(
        unit.source_fingerprint,
        "hall_venue_fee",
        {
          price_min_krw: hall.venue_fee_krw,
          price_max_krw: hall.venue_fee_krw,
          source_quote: hall.venue_fee_source_quote,
          confidence: hall.confidence,
          needs_review: hall.needs_review,
        },
      ),
    });
  }
  if ((hall.meal_price_min_krw !== null || hall.meal_price_max_krw !== null) && hall.meal_price_source_quote) {
    const provenance = stagingRowProvenanceForSourceIds(unit, hall.meal_price_source_file_ids);
    rows.push({
      unit_id: unit.unit_id,
      vendor_name: vendorName,
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: unit.region_code,
      item_name: "식대",
      base_spec: null,
      price_min_krw: hall.meal_price_min_krw,
      price_max_krw: hall.meal_price_max_krw,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: hall.needs_review || hall.confidence < 0.8 || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: hall.meal_price_source_quote,
      confidence: hall.confidence,
      source_record_key: buildOfficialPriceSourceRecordKey(
        unit.source_fingerprint,
        "hall_meal_price",
        {
          price_min_krw: hall.meal_price_min_krw,
          price_max_krw: hall.meal_price_max_krw,
          source_quote: hall.meal_price_source_quote,
          confidence: hall.confidence,
          needs_review: hall.needs_review,
        },
      ),
    });
  }
  for (const [itemIndex, item] of hall.items.entries()) {
    if (item.price_min_krw === null && item.price_max_krw === null) continue;
    const provenance = stagingRowProvenanceForSourceIds(unit, item.source_file_ids);
    rows.push({
      unit_id: unit.unit_id,
      vendor_name: vendorName,
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: unit.region_code,
      item_name: item.name,
      base_spec: item.raw_text,
      price_min_krw: item.price_min_krw,
      price_max_krw: item.price_max_krw,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: item.needs_review || item.confidence < 0.8 || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: item.source_quote,
      confidence: item.confidence,
      source_record_key: buildOfficialPriceSourceRecordKey(
        unit.source_fingerprint,
        "hall_item",
        item,
        logicalOccurrence(hall.items, itemIndex, "hall_item"),
      ),
    });
  }
  return rows;
}

type CanonicalHall = NonNullable<DisclosureExtraction["halls"]>[number];

function canonicalHallBaseSpec(hall: CanonicalHall): string | null {
  return hall.guarantee_min === null
    ? null
    : `최소 보증 인원 ${hall.guarantee_min.toLocaleString("ko-KR")}명`;
}

function canonicalHallPriceRows(unit: StagingUnit): StagingOfficialPrice[] {
  const rows: StagingOfficialPrice[] = [];
  const logicalOccurrences = new Map<string, number>();
  const append = (
    hall: CanonicalHall,
    itemName: string,
    priceMinKrw: number | null,
    priceMaxKrw: number | null,
    priceNote: string | null,
    options: StagingPriceOption[],
  ): void => {
    const provenance = stagingRowProvenanceForSourceIds(unit, hall.source_file_ids);
    const identityOnly = !hasStructuredPrice(priceMinKrw, priceMaxKrw, options);
    const normalizedItemName = normalizedLogicalIdentity(itemName, "hall item identity");
    const occurrence = logicalOccurrences.get(normalizedItemName) ?? 0;
    logicalOccurrences.set(normalizedItemName, occurrence + 1);
    rows.push({
      unit_id: unit.unit_id,
      vendor_name: unit.raw_name,
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: unit.region_code,
      item_name: itemName,
      base_spec: canonicalHallBaseSpec(hall),
      price_min_krw: priceMinKrw,
      price_max_krw: priceMaxKrw,
      vat_note: null,
      price_note: priceNote,
      options,
      review_status: "pending",
      needs_review: identityOnly
        || hall.needs_review
        || hall.confidence < 0.8
        || unit.validation_issue_codes.length > 0,
      validation_issue_codes: stagingPriceIssueCodes(unit.validation_issue_codes, identityOnly),
      ...provenance,
      source_quote: hall.source_quote,
      confidence: hall.confidence,
      source_record_key: buildOfficialPriceSourceRecordKey(
        unit.source_fingerprint,
        "hall_item",
        { name: itemName },
        occurrence,
      ),
    });
  };

  for (const hall of unit.data.halls ?? []) {
    const hallIdentity = hall.hall_name?.trim() || unit.raw_name;
    const rowCountBeforeHall = rows.length;
    if (hall.venue_fee_min_krw !== null || hall.venue_fee_max_krw !== null) {
      append(
        hall,
        `${hallIdentity} 대관료`,
        hall.venue_fee_min_krw,
        hall.venue_fee_max_krw,
        hall.venue_fee_note,
        [],
      );
    }
    if (hall.meal_price_min_krw !== null || hall.meal_price_max_krw !== null) {
      append(
        hall,
        `${hallIdentity} 식대`,
        hall.meal_price_min_krw,
        hall.meal_price_max_krw,
        null,
        [],
      );
    }
    if (hall.decoration_fee_min_krw !== null || hall.decoration_fee_max_krw !== null) {
      append(
        hall,
        `${hallIdentity} 장식비`,
        hall.decoration_fee_min_krw,
        hall.decoration_fee_max_krw,
        hall.decoration_note,
        [],
      );
    }
    if (optionsContainPrice(hall.options)) {
      append(
        hall,
        `${hallIdentity} 옵션`,
        null,
        null,
        null,
        hall.options.map((option) => stagingOption(unit, option)),
      );
    }
    if (rows.length === rowCountBeforeHall) {
      append(
        hall,
        `${hallIdentity} 기본 정보`,
        null,
        null,
        null,
        [],
      );
    }
  }
  return rows;
}

function hallFactKind(itemName: string): string {
  const normalized = normalizeVendorName(itemName);
  if (normalized.endsWith("대관료")) return "venue_fee";
  if (normalized.endsWith("식대")) return "meal_price";
  if (normalized.endsWith("장식비") || normalized.endsWith("장식료")) return "decoration_fee";
  return `item:${normalized}`;
}

function hallFactLocator(
  sourceObjectKeys: string[],
  sourceQuote: string,
  factKind: string,
): string {
  return canonicalJson({ source_object_keys: sourceObjectKeys, source_quote: sourceQuote, fact_kind: factKind });
}

function hallFactPrice(min: number | null, max: number | null): string {
  return canonicalJson({ price_min_krw: min, price_max_krw: max });
}

export function hallPriceRows(unit: StagingUnit): StagingOfficialPrice[] {
  const canonicalRows = canonicalHallPriceRows(unit);
  if (canonicalRows.length === 0) return legacyHallPriceRows(unit);

  const canonicalFacts = new Map<string, string>();
  for (const row of canonicalRows) {
    canonicalFacts.set(
      hallFactLocator(row.source_object_keys, row.source_quote, hallFactKind(row.item_name)),
      hallFactPrice(row.price_min_krw, row.price_max_krw),
    );
    for (const option of row.options) {
      canonicalFacts.set(
        hallFactLocator(option.source_object_keys, option.source_quote, hallFactKind(option.name)),
        hallFactPrice(option.price_min_krw, option.price_max_krw),
      );
    }
  }

  const merged = [...canonicalRows];
  for (const legacyRow of legacyHallPriceRows(unit)) {
    const locator = hallFactLocator(
      legacyRow.source_object_keys,
      legacyRow.source_quote,
      hallFactKind(legacyRow.item_name),
    );
    const canonicalPrice = canonicalFacts.get(locator);
    if (canonicalPrice === undefined) {
      merged.push(legacyRow);
      continue;
    }
    if (canonicalPrice !== hallFactPrice(legacyRow.price_min_krw, legacyRow.price_max_krw)) {
      throw new Error("canonical and legacy hall payloads disagree for the same source-backed price fact");
    }
  }
  return merged;
}

function optionsContainPrice(options: DisclosureExtraction["agency_packages"][number]["options"]): boolean {
  return options.some((option) => option.price_min_krw !== null || option.price_max_krw !== null);
}

const IDENTITY_ONLY_NO_PRICE_ISSUE_CODE = "identity_only_no_price";

function hasStructuredPrice(
  priceMinKrw: number | null,
  priceMaxKrw: number | null,
  options: DisclosureExtraction["agency_packages"][number]["options"],
): boolean {
  return priceMinKrw !== null || priceMaxKrw !== null || optionsContainPrice(options);
}

function stagingPriceIssueCodes(codes: string[], identityOnly: boolean): string[] {
  return identityOnly
    ? [...new Set([...codes, IDENTITY_ONLY_NO_PRICE_ISSUE_CODE])].sort(deterministicTextCompare)
    : codes;
}

function partnerVendorHasSourceIdentity(
  item: DisclosureExtraction["partner_vendors"][number],
): boolean {
  return item.source_quote.trim().length > 0 && (item.source_file_ids?.length ?? 0) > 0;
}

function partnerVendorHasStructuredPrice(
  item: DisclosureExtraction["partner_vendors"][number],
): boolean {
  return hasStructuredPrice(item.price_min_krw, item.price_max_krw, item.options);
}

function stageableAgencyPackages(data: DisclosureExtraction): DisclosureExtraction["agency_packages"] {
  return data.agency_packages.filter((item) =>
    item.price_min_krw !== null || item.price_max_krw !== null || optionsContainPrice(item.options)
  );
}

function stageablePartnerVendors(data: DisclosureExtraction): DisclosureExtraction["partner_vendors"] {
  return data.partner_vendors.filter((item) =>
    partnerVendorHasStructuredPrice(item) || partnerVendorHasSourceIdentity(item)
  );
}

const FOUR_TAB_VENDOR_CATEGORIES = new Set(["studio", "dress", "makeup", "hall"]);

/**
 * A staged partner identity must have a consumer-visible destination. Keeping
 * an `other` row in the database while the four-tab explorer silently drops it
 * would make a successful ingest report materially false. Unknown taxonomy is
 * therefore an explicit review blocker, never a hidden catalog row.
 */
export function assertFourTabPartnerVendorCompatibility(data: DisclosureExtraction): void {
  const unsupported = stageablePartnerVendors(data).filter((item) => (
    !FOUR_TAB_VENDOR_CATEGORIES.has(item.category)
  ));
  if (unsupported.length === 0) return;
  const identities = unsupported
    .map((item) => `${item.vendor_name} (${item.category})`)
    .sort(deterministicTextCompare)
    .join(", ");
  throw new Error(
    `stageable partner vendor has no four-tab explorer category: ${identities}`,
  );
}

function partnerStagingOccurrence(
  data: DisclosureExtraction,
  item: DisclosureExtraction["partner_vendors"][number],
): number {
  const staged = stageablePartnerVendors(data);
  const priced = staged.filter(partnerVendorHasStructuredPrice);
  if (partnerVendorHasStructuredPrice(item)) {
    const index = priced.indexOf(item);
    if (index < 0) throw new Error("priced partner vendor is missing from the staging identity set");
    return logicalOccurrence(priced, index, "partner");
  }

  const identityOnly = staged.filter((candidate) => !partnerVendorHasStructuredPrice(candidate));
  const index = identityOnly.indexOf(item);
  if (index < 0) throw new Error("identity-only partner vendor is missing from the staging identity set");
  const identity = canonicalJson(officialPriceLogicalIdentity("partner", item, 0));
  const pricedIdentityCount = priced.filter((candidate) =>
    canonicalJson(officialPriceLogicalIdentity("partner", candidate, 0)) === identity
  ).length;
  return pricedIdentityCount + logicalOccurrence(identityOnly, index, "partner");
}

function hasHallPayload(data: DisclosureExtraction): boolean {
  return (data.halls?.length ?? 0) > 0
    || data.hall.venue_fee_krw !== null
    || data.hall.meal_price_min_krw !== null
    || data.hall.meal_price_max_krw !== null
    || data.hall.items.length > 0;
}

function hasDisclosureSemantics(data: DisclosureExtraction): boolean {
  return (data.sections?.length ?? 0) > 0
    || data.partner_vendors.some((vendor) => (vendor.policies?.length ?? 0) > 0);
}

function documentPayloadIsCompatible(data: DisclosureExtraction): boolean {
  const agency = data.agency_packages.length > 0;
  const partner = data.partner_vendors.length > 0;
  const hall = hasHallPayload(data);
  if (data.doc_kind === "agency_disclosure") return !partner && !hall;
  if (data.doc_kind === "partner_price_list") return !agency && !hall;
  if (data.doc_kind === "hall_disclosure") return !agency && !partner;
  return data.doc_kind === "mixed";
}

function hasConflictingAgencyPackageRows(data: DisclosureExtraction): boolean {
  const identities = new Map<string, Set<string>>();
  for (const item of data.agency_packages) {
    const key = item.package_name.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
    const variants = identities.get(key) ?? new Set<string>();
    variants.add(JSON.stringify({
      category_scope: item.category_scope,
      price_min_krw: item.price_min_krw,
      price_max_krw: item.price_max_krw,
      vat_note: item.vat_note,
      price_note: item.price_note,
      options: item.options,
      source_quote: item.source_quote,
    }));
    identities.set(key, variants);
  }
  return [...identities.values()].some((variants) => variants.size > 1);
}

function stageableRowCount(unit: StagingUnit): number {
  const data = unit.data;
  const agency = data.doc_kind === "agency_disclosure" || data.doc_kind === "mixed"
    ? stageableAgencyPackages(data).length
    : 0;
  const partner = data.doc_kind === "partner_price_list" || data.doc_kind === "mixed"
    ? stageablePartnerVendors(data).length
    : 0;
  const hall = data.doc_kind === "hall_disclosure" || data.doc_kind === "mixed"
    ? hallPriceRows(unit).length
    : 0;
  return agency + partner + hall;
}

async function readStrictValidatedArtifactForLoad(
  stateDir: string,
  manifest: IngestManifest,
  unit: IngestManifest["units"][number],
): Promise<ReturnType<typeof StrictValidatedArtifactSchema.parse>> {
  const extractionMetadata = unit.extraction;
  const validationMetadata = unit.validation;
  const conversion = unit.conversion;
  if (!extractionMetadata || !validationMetadata || !conversion) {
    throw new Error(`strict staging provenance is incomplete: ${unit.display_name}`);
  }
  await verifyValidationInputsUnchanged(unit, manifest);
  const converterVersion = conversion.converter_version ?? "v1-legacy";
  if (
    manifest.scanner_parser_version !== SCANNER_PARSER_VERSION
    || converterVersion !== CONVERTER_VERSION
  ) {
    throw new Error(`strict staging input versions are stale: ${unit.display_name}`);
  }
  const expectedExtractionFingerprint = currentExtractionFingerprint({
    scannerParserVersion: manifest.scanner_parser_version,
    converterVersion,
    model: extractionMetadata.model,
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: conversion.artifact_fingerprint,
  });
  if (
    extractionMetadata.fingerprint !== expectedExtractionFingerprint
    || extractionMetadata.prompt_version !== EXTRACTION_PROMPT_VERSION
    || extractionMetadata.prompt_hash !== EXTRACTION_PROMPT_HASH
    || extractionMetadata.processing_version !== EXTRACTION_PROCESSING_VERSION
    || extractionMetadata.scanner_parser_version !== manifest.scanner_parser_version
    || extractionMetadata.converter_version !== converterVersion
    || !extractionMetadata.content_sha256
  ) {
    throw new Error(`strict extraction metadata is stale: ${unit.display_name}`);
  }
  const { verifyCurrentExtractionCacheForUnit } = await import("./extract.js");
  const extraction = await verifyCurrentExtractionCacheForUnit(unit, manifest, stateDir);
  if (
    extraction.content_sha256 !== extractionMetadata.content_sha256
    || extraction.unit_id !== unit.unit_id
    || extraction.fingerprint !== expectedExtractionFingerprint
    || extraction.source_fingerprint !== unit.source_fingerprint
    || extraction.artifact_fingerprint !== conversion.artifact_fingerprint
    || extraction.prompt_version !== EXTRACTION_PROMPT_VERSION
    || extraction.prompt_hash !== EXTRACTION_PROMPT_HASH
    || extraction.processing_version !== EXTRACTION_PROCESSING_VERSION
    || extraction.scanner_parser_version !== manifest.scanner_parser_version
    || extraction.converter_version !== converterVersion
    || extraction.model !== extractionMetadata.model
  ) {
    throw new Error(`strict extraction artifact provenance is invalid: ${unit.display_name}`);
  }

  await verifyDeterministicStateArtifactPath({
    stateDir,
    artifactPath: validationMetadata.artifact_path,
    expectedRelativePath: path.join("validated", `${unit.unit_id}.json`),
  });
  const validationRaw = await readJsonFile(validationMetadata.artifact_path);
  const validationParsed = StrictValidatedArtifactSchema.safeParse(validationRaw);
  if (!validationParsed.success) {
    throw new Error(`strict validation artifact schema is invalid: ${unit.display_name}`);
  }
  verifyJsonContentHash(validationRaw as Record<string, unknown>, "content_sha256");
  const validation = validationParsed.data;
  const expectedSourceFiles = unit.source_files.map((source) => ({
    path: source.path,
    sha256: source.sha256,
    bytes: source.bytes,
  }));
  const recomputedValidationFingerprint = validatedArtifactFingerprint(
    validation.extraction_fingerprint,
    validation.data,
    validation.issues,
    validation.coverage_gaps,
  );
  const provenanceFailures = [
    validation.validator_version !== VALIDATOR_VERSION ? "validator_version" : null,
    validationMetadata.validator_version !== VALIDATOR_VERSION ? "manifest_validator_version" : null,
    validation.content_sha256 !== validationMetadata.content_sha256 ? "content_sha256" : null,
    validation.extraction_content_sha256 !== extraction.content_sha256
      ? "extraction_content_sha256"
      : null,
    validation.extraction_content_sha256 !== validationMetadata.extraction_content_sha256
      ? "manifest_extraction_content_sha256"
      : null,
    validation.fingerprint !== validationMetadata.fingerprint ? "fingerprint" : null,
    validation.fingerprint !== recomputedValidationFingerprint ? "recomputed_fingerprint" : null,
    validation.unit_id !== unit.unit_id ? "unit_id" : null,
    validation.source_fingerprint !== unit.source_fingerprint ? "source_fingerprint" : null,
    validation.extraction_fingerprint !== extraction.fingerprint ? "extraction_fingerprint" : null,
    validation.prompt_version !== EXTRACTION_PROMPT_VERSION ? "prompt_version" : null,
    validation.prompt_hash !== EXTRACTION_PROMPT_HASH ? "prompt_hash" : null,
    validation.model !== extraction.model ? "model" : null,
    validation.review_status !== "pending" ? "review_status" : null,
    validationMetadata.review_status !== validation.review_status ? "manifest_review_status" : null,
    validationMetadata.issue_count !== validation.issues.length ? "manifest_issue_count" : null,
    validationMetadata.validated_at !== validation.validated_at ? "manifest_validated_at" : null,
    validation.issues.some((issue) => issue.severity === "error") ? "blocking_issue" : null,
    JSON.stringify(validation.source_files) !== JSON.stringify(expectedSourceFiles) ? "source_files" : null,
  ].filter((failure): failure is string => failure !== null);
  if (provenanceFailures.length > 0) {
    throw new Error(
      `strict validation artifact provenance is invalid (${provenanceFailures.join(",")}): ${unit.display_name}`,
    );
  }
  const replayed = await deriveValidatedPayloadForUnit(unit, extraction);
  const replayFailures = [
    !isDeepStrictEqual(validation.data, replayed.data) ? "data_replay" : null,
    !isDeepStrictEqual(validation.issues, replayed.issues) ? "issues_replay" : null,
    !isDeepStrictEqual(validation.coverage_gaps, replayed.coverageGaps)
      ? "coverage_gaps_replay"
      : null,
  ].filter((failure): failure is string => failure !== null);
  if (replayFailures.length > 0) {
    throw new Error(
      `strict validation artifact replay is invalid (${replayFailures.join(",")}): ${unit.display_name}`,
    );
  }
  return validation;
}

async function readValidatedArtifactForLoad(
  stateDir: string,
  manifest: IngestManifest,
  unit: IngestManifest["units"][number],
) {
  if (unit.validation?.provider_mode !== "local_deterministic") {
    return readStrictValidatedArtifactForLoad(stateDir, manifest, unit);
  }
  try {
    const { verifyCurrentLocalValidatedArtifactForUnit } = await import("./validate.js");
    const validation = await verifyCurrentLocalValidatedArtifactForUnit(
      unit,
      manifest,
      stateDir,
    );
    if (
      validation.review_status !== "pending"
      || validation.needs_review !== true
      || validation.bulk_approval_eligible !== false
      || validation.issues.some((issue) => issue.severity === "error")
    ) {
      throw new Error("review_only_contract_mismatch");
    }
    return validation;
  } catch {
    throw new Error(
      `local validation artifact is not eligible for pending-only staging: ${unit.unit_id}`,
    );
  }
}

async function buildLoadPlan(stateDir: string, snapshot: string): Promise<{ plan: StagingLoadPlan; manifest: IngestManifest }> {
  if (!/^20\d{2}Q[1-4]$/.test(snapshot)) throw new Error("snapshot은 2026Q3 형식이어야 합니다.");
  const manifest = await loadManifest(stateDir);
  const units: StagingUnit[] = [];
  const skippedUnits: StagingSkippedUnit[] = [];
  const rawObjects = new Map<string, RawStorageObject>();
  const previewObjects: PreviewStorageObject[] = [];
  const warnings = new Set<string>();

  for (const unit of manifest.units) {
    if (!unit.validation || !["validated", "loaded"].includes(unit.stage)) {
      skippedUnits.push({
        unit_id: unit.unit_id,
        display_name: unit.display_name,
        stage: unit.stage,
        reason: unit.stage === "needs_manual_conversion"
          ? "manual_conversion_required"
          : unit.stage === "error"
            ? "validation_or_scan_error"
            : "not_validated",
      });
      continue;
    }
    const validatedArtifact = await readValidatedArtifactForLoad(stateDir, manifest, unit);
    const extractionMetadata = unit.validation.provider_mode === "local_deterministic"
      ? unit.local_extraction
      : unit.extraction;
    if (!unit.conversion || !extractionMetadata) {
      throw new Error(`validated unit is missing immutable conversion/extraction lineage: ${unit.unit_id}`);
    }
    if (unit.validation.provider_mode === "local_deterministic") {
      warnings.add(`local_deterministic_review_only:${unit.unit_id}`);
    }
    // scan writes canonical source order. Load must not reorder an existing
    // manifest because conversion artifacts encode this exact positional order.
    const orderedSourceFiles = [...unit.source_files];
    const sourceFile = sourceFileBundle(orderedSourceFiles.map((source) => source.path));
    const sourceObjectKeys = orderedSourceFiles.map((source) => `${source.sha256}.${source.ext}`);
    const unitPreviewObjects = await buildUnitPreviewObjects(stateDir, unit);
    const sourcePreviewKeys = unitPreviewObjects.map((preview) => preview.storage_path);
    const previewBySourceObjectKey = new Map(unitPreviewObjects.map((preview) => [
      preview.source_object_key,
      preview.storage_path,
    ]));
    const sourceRecords: StagingSourceRecord[] = orderedSourceFiles.map((source) => {
      const sourceObjectKey = `${source.sha256}.${source.ext}`;
      return {
        source_file_id: sourceFileId(source),
        source_file: source.path,
        source_object_key: sourceObjectKey,
        source_preview_key: previewBySourceObjectKey.get(sourceObjectKey) ?? null,
      };
    });
    const stagingUnit: StagingUnit = {
      unit_id: unit.unit_id,
      kind_hint: unit.parsed.kind_hint,
      region_code: unit.parsed.region_code,
      normalized_name: unit.parsed.normalized_name,
      raw_name: unit.parsed.raw_name,
      corporate_name: unit.parsed.corporate_name,
      source_file: sourceFile,
      source_object_keys: sourceObjectKeys,
      source_preview_keys: sourcePreviewKeys,
      source_records: sourceRecords,
      source_fingerprint: unit.source_fingerprint,
      conversion_fingerprint: unit.conversion.artifact_fingerprint,
      extraction_fingerprint: extractionMetadata.fingerprint,
      validation_fingerprint: unit.validation.fingerprint,
      validation_issue_codes: [...new Set([
        ...validatedArtifact.issues.map((issue) => issue.code),
        ...(unit.validation.provider_mode === "local_deterministic"
          ? ["local_deterministic_review_only"]
          : []),
      ])]
        .sort(deterministicTextCompare),
      data: validatedArtifact.data,
    };
    const blockingArtifactIssue = validatedArtifact.issues.some((issue) => issue.severity === "error");
    const skipReason = unit.parsed.region_code === "unknown"
      ? "unknown_region"
      : blockingArtifactIssue
        ? "blocking_validation_issue"
        : !documentPayloadIsCompatible(stagingUnit.data)
          ? "document_payload_conflict"
          : hasConflictingAgencyPackageRows(stagingUnit.data)
            ? "conflicting_agency_package_rows"
            : stageableRowCount(stagingUnit) === 0 && !hasDisclosureSemantics(stagingUnit.data)
              ? stagingUnit.data.doc_kind === "unknown"
                ? "unknown_document_kind"
                : "no_stageable_price_rows"
              : null;
    if (skipReason) {
      skippedUnits.push({
        unit_id: unit.unit_id,
        display_name: unit.display_name,
        stage: unit.stage,
        reason: skipReason,
      });
      continue;
    }
    units.push(stagingUnit);
    previewObjects.push(...unitPreviewObjects);
    for (const source of unit.source_files) {
      const currentSource = await sha256File(source.absolute_path);
      if (currentSource.sha256 !== source.sha256 || currentSource.bytes !== source.bytes) {
        throw new Error(`raw source changed after scan: ${source.path}`);
      }
      if (source.bytes > 50 * 1024 * 1024) {
        throw new Error(`Storage 50MB 제한을 넘는 원본입니다: ${source.path}`);
      }
      rawObjects.set(`${source.sha256}.${source.ext}`, {
        source_path: source.path,
        absolute_path: source.absolute_path,
        sha256: source.sha256,
        ext: source.ext,
        bytes: source.bytes,
        storage_path: `${source.sha256}.${source.ext}`,
      });
    }
  }

  const agencyPackages: StagingAgencyPackage[] = units.flatMap((unit) =>
    unit.data.doc_kind === "agency_disclosure" || unit.data.doc_kind === "mixed"
      ? stageableAgencyPackages(unit.data).map((item) => {
        const provenance = stagingRowProvenanceForSourceIds(unit, item.source_file_ids);
        return ({
    unit_id: unit.unit_id,
    agency_name: unit.raw_name,
    agency_normalized_name: unit.normalized_name,
    agency_corporate_name: unit.corporate_name,
    region_code: unit.region_code,
    package_name: item.package_name,
    category_scope: item.category_scope,
    price_min_krw: item.price_min_krw,
    price_max_krw: item.price_max_krw,
    vat_note: item.vat_note,
    price_note: item.price_note,
    options: item.options.map((option) => stagingOption(unit, option)),
    review_status: "pending",
    needs_review: item.needs_review || item.confidence < 0.8 || unit.validation_issue_codes.length > 0,
    validation_issue_codes: unit.validation_issue_codes,
    ...provenance,
    source_quote: item.source_quote,
    confidence: item.confidence,
  });
      })
      : []);
  for (const unit of units) assertFourTabPartnerVendorCompatibility(unit.data);
  const partnerPrices: StagingOfficialPrice[] = units.flatMap((unit) => {
    if (unit.data.doc_kind !== "partner_price_list" && unit.data.doc_kind !== "mixed") return [];
    const allPartnerRecords = buildPartnerVendorRecords(
      unit.unit_id,
      unit.region_code,
      unit.data.partner_vendors,
    );
    return stageablePartnerVendors(unit.data).map((item) => {
        const provenance = stagingRowProvenanceForSourceIds(unit, item.source_file_ids);
        const sourceItemIndex = unit.data.partner_vendors.indexOf(item);
        const partnerRecord = allPartnerRecords[sourceItemIndex];
        if (!partnerRecord) throw new Error("partner vendor row reference could not be resolved");
        const identityOnly = !partnerVendorHasStructuredPrice(item);
        return ({
    unit_id: unit.unit_id,
    partner_record_ref: partnerRecord.record_ref,
    vendor_name: item.vendor_name,
    alias_proposals: item.old_names,
    source_agency: unit.kind_hint === "agency" ? {
      name: unit.raw_name,
      normalized_name: unit.normalized_name,
      corporate_name: unit.corporate_name,
      region_code: unit.region_code,
      source_file: provenance.source_file,
    } : null,
    category: item.category,
    region_code: unit.region_code,
    item_name: item.vendor_name,
    base_spec: item.base_spec,
    price_min_krw: item.price_min_krw,
    price_max_krw: item.price_max_krw,
    vat_note: null,
    price_note: item.price_note,
    options: item.options.map((option) => stagingOption(unit, option)),
    review_status: "pending",
    needs_review: identityOnly
      || item.needs_review
      || item.confidence < 0.8
      || unit.validation_issue_codes.length > 0,
    validation_issue_codes: stagingPriceIssueCodes(unit.validation_issue_codes, identityOnly),
    ...provenance,
    source_quote: item.source_quote,
    confidence: item.confidence,
    source_record_key: buildOfficialPriceSourceRecordKey(
      unit.source_fingerprint,
      "partner",
      item,
      partnerStagingOccurrence(unit.data, item),
    ),
  });
      });
  });
  const hallPrices = units.flatMap((unit) =>
    unit.data.doc_kind === "hall_disclosure" || unit.data.doc_kind === "mixed"
      ? hallPriceRows(unit)
      : []);
  const disclosureSemantics = units.flatMap(stagingDisclosureSemantics);
  const unitsWithPrimaryVendor = new Set(hallPrices.map((row) => row.unit_id));
  const unitsWithPrimaryAgency = new Set([
    ...agencyPackages.map((row) => row.unit_id),
    ...partnerPrices.filter((row) => row.source_agency !== null).map((row) => row.unit_id),
  ]);
  let dedupeCandidates: StagingDedupeCandidate[] = [];
  try {
    const parsed = DedupeCandidatesSchema.safeParse(
      await readJsonFile(path.join(path.resolve(stateDir), "validated", "dedupe_candidates.json")),
    );
    if (!parsed.success) throw new Error("dedupe_candidates.json 형식이 올바르지 않습니다.");
    dedupeCandidates = parsed.data.candidates.flatMap((candidate) => {
      if (candidate.entity_kind === "vendor") {
        if (!candidate.left_record_ref || !candidate.right_record_ref) {
          throw new Error("partner vendor dedupe candidate is missing stable row refs");
        }
        const stagedPartnerRefs = new Set(partnerPrices.map((row) => row.partner_record_ref));
        if (!stagedPartnerRefs.has(candidate.left_record_ref) || !stagedPartnerRefs.has(candidate.right_record_ref)) {
          throw new Error("partner vendor dedupe candidate references a row that is not stageable");
        }
        return [{
          entity_kind: "vendor" as const,
          left_unit_id: candidate.left_unit_id,
          right_unit_id: candidate.right_unit_id,
          left_record_ref: candidate.left_record_ref,
          right_record_ref: candidate.right_record_ref,
          similarity: candidate.similarity,
          reason: `같은 지역·카테고리의 제휴업체 정규화 상호 trigram 유사도 ${candidate.similarity.toFixed(4)}`,
          status: "pending" as const,
        }];
      }
      const vendorPair = unitsWithPrimaryVendor.has(candidate.left_unit_id)
        && unitsWithPrimaryVendor.has(candidate.right_unit_id);
      const agencyPair = unitsWithPrimaryAgency.has(candidate.left_unit_id)
        && unitsWithPrimaryAgency.has(candidate.right_unit_id);
      if (vendorPair === agencyPair) return [];
      return [{
        entity_kind: vendorPair ? "vendor" as const : "agency" as const,
        left_unit_id: candidate.left_unit_id,
        right_unit_id: candidate.right_unit_id,
        similarity: candidate.similarity,
        reason: `같은 지역의 정규화 상호 trigram 유사도 ${candidate.similarity.toFixed(4)}`,
        status: "pending",
      }];
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return {
    manifest,
    plan: {
      schema_version: 2,
      snapshot,
      snapshot_source: "kca_tprice",
      units,
      skipped_units: skippedUnits,
      raw_objects: [...rawObjects.values()],
      preview_objects: previewObjects,
      agency_packages: agencyPackages,
      official_prices: [...partnerPrices, ...hallPrices],
      disclosure_semantics: disclosureSemantics,
      dedupe_candidates: dedupeCandidates,
      ai_ledger: await readAiLedger(stateDir),
      warnings: [...warnings],
    },
  };
}

export function assertStagingEnvironmentDestination(environment: StagingEnvironment): void {
  assertDisclosureStagingProjectRef(environment.projectRef);
  if (environment.bucket !== "disclosure-raw" || environment.previewBucket !== "disclosure-preview") {
    throw new Error("disclosure staging writer requires the private disclosure-raw and disclosure-preview buckets");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(environment.url);
  } catch {
    throw new Error("disclosure staging URL is invalid");
  }
  if (
    parsedUrl.protocol !== "https:"
    || parsedUrl.port !== ""
    || parsedUrl.username !== ""
    || parsedUrl.password !== ""
    || parsedUrl.pathname !== "/"
    || parsedUrl.search !== ""
    || parsedUrl.hash !== ""
    || parsedUrl.hostname !== `${environment.projectRef}.supabase.co`
  ) {
    throw new Error("disclosure staging URL host must exactly match the declared staging project ref");
  }
  if (/anon/i.test(environment.key) || environment.key.startsWith("sb_publishable_")) {
    throw new Error("disclosure staging writer requires a service-role secret key");
  }
  if (environment.key.split(".").length === 3) {
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(environment.key.split(".")[1]!, "base64url").toString("utf8"));
    } catch {
      throw new Error("disclosure staging service-role JWT is invalid");
    }
    if (typeof payload !== "object" || payload === null || !("role" in payload) || payload.role !== "service_role") {
      throw new Error("disclosure staging writer requires a service_role JWT");
    }
  } else if (!environment.key.startsWith("sb_secret_")) {
    throw new Error("disclosure staging writer requires an sb_secret_ or legacy service_role key");
  }
}

export function stagingEnvironment(env: NodeJS.ProcessEnv, confirmation: string | undefined): StagingEnvironment {
  if (env.INGEST_LOAD_ENABLED !== "true") throw new Error("apply에는 INGEST_LOAD_ENABLED=true가 필요합니다.");
  if (env.INGEST_TARGET_ENV !== "staging") throw new Error("INGEST_TARGET_ENV=staging만 허용합니다.");
  const projectRef = env.SUPABASE_PROJECT_REF?.trim();
  const expectedRef = env.INGEST_STAGING_PROJECT_REF?.trim();
  const productionRef = env.SUPABASE_PRODUCTION_PROJECT_REF?.trim();
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = env.INGEST_STORAGE_BUCKET?.trim();
  const previewBucket = env.INGEST_PREVIEW_STORAGE_BUCKET?.trim() || "disclosure-preview";
  if (!productionRef) throw new Error("SUPABASE_PRODUCTION_PROJECT_REF is required for the production exclusion fence.");
  assertRepositoryProductionProjectRef(productionRef);
  if (!projectRef || !expectedRef || !url || !key || !bucket) {
    throw new Error("SUPABASE_PROJECT_REF, INGEST_STAGING_PROJECT_REF, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_STORAGE_BUCKET이 모두 필요합니다.");
  }
  if ([projectRef, expectedRef, confirmation].some((value) => value === productionRef)) {
    throw new Error("production project ref is forbidden for disclosure ingest apply");
  }
  for (const ref of [projectRef, expectedRef, confirmation]) {
    if (ref) assertDisclosureStagingProjectRef(ref);
  }
  if (projectRef !== expectedRef || confirmation !== expectedRef) {
    throw new Error("staging project ref와 --confirm-project-ref가 정확히 일치해야 합니다.");
  }
  if (bucket !== "disclosure-raw") throw new Error("INGEST_STORAGE_BUCKET은 disclosure-raw여야 합니다.");
  if (previewBucket !== "disclosure-preview") {
    throw new Error("INGEST_PREVIEW_STORAGE_BUCKET은 disclosure-preview여야 합니다.");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL이 유효한 URL이 아닙니다.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL은 https 프로토콜만 허용합니다.");
  }
  if (parsedUrl.port !== "") {
    throw new Error("SUPABASE_URL은 HTTPS 기본 포트만 허용합니다.");
  }
  if (parsedUrl.username !== "" || parsedUrl.password !== "") {
    throw new Error("SUPABASE_URL에 사용자 credentials를 포함할 수 없습니다.");
  }
  if (parsedUrl.pathname !== "/") {
    throw new Error("SUPABASE_URL base URL에는 path 경로를 포함할 수 없습니다.");
  }
  if (parsedUrl.search !== "") {
    throw new Error("SUPABASE_URL base URL에는 query 쿼리를 포함할 수 없습니다.");
  }
  if (parsedUrl.hash !== "") {
    throw new Error("SUPABASE_URL base URL에는 hash fragment를 포함할 수 없습니다.");
  }
  if (parsedUrl.hostname !== `${projectRef}.supabase.co`) throw new Error("SUPABASE_URL host가 staging project ref와 일치하지 않습니다.");
  if (/anon/i.test(key) || key.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY에 anon/publishable 키를 사용할 수 없습니다.");
  }
  if (key.split(".").length === 3) {
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("legacy SUPABASE_SERVICE_ROLE_KEY JWT payload를 검증할 수 없습니다.");
    }
    if (typeof payload !== "object" || payload === null || !("role" in payload) || payload.role !== "service_role") {
      throw new Error("legacy SUPABASE_SERVICE_ROLE_KEY의 role이 service_role이 아닙니다.");
    }
  } else if (!key.startsWith("sb_secret_")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY는 legacy service_role JWT 또는 sb_secret_ 키여야 합니다.");
  }
  const environment = { url, key, projectRef, bucket, previewBucket };
  assertStagingEnvironmentDestination(environment);
  return environment;
}

export interface ApplyStagingPlanInBatchesInput {
  stateDir: string;
  startedAt?: string;
  environment: StagingEnvironment;
  manifest: IngestManifest;
  plan: StagingLoadPlan;
  writer: StagingWriter;
  batchAuthorization?: PilotReceiptContext;
  pendingOnlyAuthorization?: LocalPendingOnlyAuthorization;
}

export interface ApplyStagingPlanInBatchesResult {
  descriptor: StagingRunDescriptor;
  batchRun: StateAwareBatchRunResult;
  writerResults: StagingWriterResult[];
  writerResult: StagingWriterResult;
}

function batchRowMetrics(plan: StagingLoadPlan, unitId: string): {
  staged_record_count: number;
  needs_review_count: number;
} {
  const rows = [
    ...plan.agency_packages.filter((row) => row.unit_id === unitId),
    ...plan.official_prices.filter((row) => row.unit_id === unitId),
    ...plan.disclosure_semantics.filter((row) => row.unit_id === unitId),
  ];
  return {
    staged_record_count: rows.length,
    needs_review_count: rows.filter((row) => row.needs_review).length,
  };
}

export function assertCompleteApplyUniverse(
  plan: StagingLoadPlan,
  manifest: IngestManifest,
): void {
  const manualHwpUnits = manifest.units.filter((unit) =>
    unit.stage === "needs_manual_conversion"
    && unit.source_files.length > 0
    && unit.source_files.every((source) => source.ext === "hwp")
  );
  if (manualHwpUnits.length !== 8) {
    throw new Error(`full-plan universe requires exactly 8 manifest HWP manual units; found ${manualHwpUnits.length}`);
  }
  const manualIds = manualHwpUnits.map((unit) => unit.unit_id);
  const manualSet = new Set(manualIds);
  const expectedStagedIds = manifest.units
    .filter((unit) => !manualSet.has(unit.unit_id))
    .map((unit) => unit.unit_id);
  const actualStagedIds = plan.units.map((unit) => unit.unit_id);
  if (!isDeepStrictEqual(actualStagedIds, expectedStagedIds)) {
    throw new Error("full-plan universe must stage every manifest unit except the exact eight manual HWP units");
  }
  const skippedIds = plan.skipped_units.map((unit) => unit.unit_id);
  if (
    !isDeepStrictEqual(skippedIds, manualIds)
    || plan.skipped_units.some((unit) =>
      unit.stage !== "needs_manual_conversion"
      || unit.reason !== "manual_conversion_required"
    )
  ) {
    throw new Error("validated or non-HWP units cannot be skipped during apply");
  }
  const manifestById = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
  for (const unit of plan.units) {
    const manifestUnit = manifestById.get(unit.unit_id);
    if (
      !manifestUnit
      || !["validated", "loaded"].includes(manifestUnit.stage)
      || !manifestUnit.conversion
      || !manifestUnit.validation
    ) {
      throw new Error(`full-plan universe contains a non-current validated unit: ${unit.unit_id}`);
    }
  }
}

function assertPendingOnlyAuthorizationForApply(input: {
  plan: StagingLoadPlan;
  manifest: IngestManifest;
  targetProjectRef: string;
  authorization: LocalPendingOnlyAuthorization | undefined;
  paidAuthorization: PilotReceiptContext | undefined;
}): {
  pendingOnlyAuthorization: LocalPendingOnlyAuthorization | null;
  batchAuthorization: BatchAuthorizationContext;
} {
  const localIds = localPendingOnlyUnitIds(input.plan);
  if (localIds.length === 0) {
    if (input.authorization) {
      throw new Error("local pending-only authorization supplied without local deterministic units");
    }
    if (!input.paidAuthorization) {
      throw new Error("strict paid staging requires its separate paid pilot authorization");
    }
    return {
      pendingOnlyAuthorization: null,
      batchAuthorization: input.paidAuthorization,
    };
  }
  if (localIds.length !== input.plan.units.length) {
    throw new Error("mixed paid and local units are not eligible for the local pending-only authorization route");
  }
  if (input.paidAuthorization) {
    throw new Error("paid pilot authorization and local pending-only authorization are not interchangeable");
  }
  const authorization = validateLocalPendingOnlyAuthorization(input.authorization);
  const manifestSha256 = canonicalSha256(input.manifest);
  const manifestById = new Map(input.manifest.units.map((unit) => [unit.unit_id, unit]));
  const expectedUnits = localIds.map((unitId) => {
    const unit = manifestById.get(unitId);
    const extraction = unit?.local_extraction;
    const extractionContentSha256 = unit?.validation?.extraction_content_sha256
      ?? extraction?.content_sha256;
    if (
      unit?.validation?.provider_mode !== "local_deterministic"
      || !unit.conversion
      || !extraction
      || !extractionContentSha256
    ) {
      throw new Error(`local pending-only authorization points to a non-local validation: ${unitId}`);
    }
    return {
      unit_id: unitId,
      source_fingerprint: unit.source_fingerprint,
      conversion_fingerprint: unit.conversion.artifact_fingerprint,
      extraction_fingerprint: extraction.fingerprint,
      extraction_content_sha256: extractionContentSha256,
      validation_fingerprint: unit.validation.fingerprint,
    };
  });
  if (
    authorization.payload.target_project_ref !== input.targetProjectRef
    || authorization.payload.manifest_sha256 !== manifestSha256
    || authorization.payload.full_plan_sha256 !== stagingLoadPlanSha256(input.plan)
    || authorization.payload.snapshot !== input.plan.snapshot
    || !isDeepStrictEqual(
      authorization.payload.ordered_batch_sha256s,
      buildStagingBatches(input.plan).map((batch) => batch.batch_sha256),
    )
    || !isDeepStrictEqual(authorization.payload.units, expectedUnits)
  ) {
    throw new Error("local pending-only authorization is stale or belongs to another plan/manifest/target");
  }
  const localSet = new Set(localIds);
  const localRows = [
    ...input.plan.agency_packages,
    ...input.plan.official_prices,
    ...input.plan.disclosure_semantics,
  ].filter((row) => localSet.has(row.unit_id));
  if (
    localRows.length === 0
    || localRows.some((row) =>
      row.review_status !== "pending"
      || row.needs_review !== true
      || !row.validation_issue_codes.includes("local_deterministic_review_only")
    )
  ) {
    throw new Error("local deterministic rows must remain pending, needs-review, and never bulk-approval eligible");
  }
  return {
    pendingOnlyAuthorization: authorization,
    batchAuthorization: {
      authorizationKind: "local_validated_pending_only",
      authorizationSha256: authorization.authorization_sha256,
    },
  };
}

function canonicalExplicitStartedAt(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error("pending-only apply startedAt must be an explicit ISO timestamp");
  }
  const canonical = new Date(milliseconds).toISOString();
  if (canonical !== value) {
    throw new Error(`pending-only apply startedAt must use canonical ISO form: ${canonical}`);
  }
  return canonical;
}

export function createLocalPendingOnlyApplyPreparation(input: {
  plan: StagingLoadPlan;
  manifest: IngestManifest;
  targetProjectRef: string;
  startedAt: string;
}): LocalPendingOnlyApplyPreparation {
  assertDisclosureStagingProjectRef(input.targetProjectRef);
  assertCompleteApplyUniverse(input.plan, input.manifest);
  const startedAt = canonicalExplicitStartedAt(input.startedAt);
  const localUnitIds = localPendingOnlyUnitIds(input.plan);
  if (localUnitIds.length !== input.plan.units.length) {
    throw new Error("confirmed local pending-only apply requires every staged unit to be local deterministic");
  }
  const manifestById = new Map(input.manifest.units.map((unit) => [unit.unit_id, unit]));
  const unitClaims = localUnitIds.map((unitId) => {
    const unit = manifestById.get(unitId);
    const extraction = unit?.local_extraction;
    const extractionContentSha256 = unit?.validation?.extraction_content_sha256
      ?? extraction?.content_sha256;
    if (
      unit?.validation?.provider_mode !== "local_deterministic"
      || !unit.conversion
      || !extraction
      || !extractionContentSha256
    ) {
      throw new Error(`pending-only apply cannot authorize a non-local validation: ${unitId}`);
    }
    return {
      sourceFingerprint: unit.source_fingerprint,
      conversionFingerprint: unit.conversion.artifact_fingerprint,
      extractionFingerprint: extraction.fingerprint,
      extractionContentSha256,
      validationFingerprint: unit.validation.fingerprint,
    };
  });
  const batches = buildStagingBatches(input.plan);
  if (batches.length === 0) throw new Error("there are no validated staging units to authorize");
  const manifestSha256 = canonicalSha256(input.manifest);
  const fullPlanSha256 = stagingLoadPlanSha256(input.plan);
  const authorization = createLocalPendingOnlyAuthorization({
    createdAt: startedAt,
    targetProjectRef: input.targetProjectRef,
    manifestSha256,
    fullPlanSha256,
    snapshot: input.plan.snapshot,
    orderedBatchSha256s: batches.map((batch) => batch.batch_sha256),
    localUnitIds,
    sourceFingerprints: unitClaims.map((claim) => claim.sourceFingerprint),
    conversionFingerprints: unitClaims.map((claim) => claim.conversionFingerprint),
    extractionFingerprints: unitClaims.map((claim) => claim.extractionFingerprint),
    extractionContentSha256s: unitClaims.map((claim) => claim.extractionContentSha256),
    validationFingerprints: unitClaims.map((claim) => claim.validationFingerprint),
  });
  const authorizationContext = assertPendingOnlyAuthorizationForApply({
    plan: input.plan,
    manifest: input.manifest,
    targetProjectRef: input.targetProjectRef,
    authorization,
    paidAuthorization: undefined,
  });
  const descriptor = createStagingRunDescriptor(
    input.plan,
    input.targetProjectRef,
    startedAt,
    authorizationContext.batchAuthorization,
    authorization,
  );
  return {
    started_at: startedAt,
    target_project_ref: input.targetProjectRef,
    manifest_sha256: manifestSha256,
    full_plan_sha256: fullPlanSha256,
    batch_sha256s: batches.map((batch) => batch.batch_sha256),
    authorization,
    descriptor,
  };
}

export function assertLocalPendingOnlyApplyConfirmation(
  preparation: LocalPendingOnlyApplyPreparation,
  confirmation: LocalPendingOnlyApplyConfirmation,
): void {
  const expectedFullPlanSha256 = Sha256Schema.parse(confirmation.expectedFullPlanSha256);
  const expectedAuthorizationSha256 = Sha256Schema.parse(confirmation.expectedAuthorizationSha256);
  const expectedRunSha256 = Sha256Schema.parse(confirmation.expectedRunSha256);
  if (expectedFullPlanSha256 !== preparation.full_plan_sha256) {
    throw new Error("confirmed full plan SHA-256 does not match the current validated plan");
  }
  if (expectedAuthorizationSha256 !== preparation.authorization.authorization_sha256) {
    throw new Error("confirmed authorization SHA-256 does not match the current manifest, target, or startedAt");
  }
  if (expectedRunSha256 !== preparation.descriptor.run_sha256) {
    throw new Error("confirmed run SHA-256 does not match the immutable staging run descriptor");
  }
}

function stagingSourceUniverse(
  plan: StagingLoadPlan,
  manifest: IngestManifest,
): Array<{ unit_id: string; source_fingerprint: string; conversion_fingerprint: string }> {
  const manifestByUnit = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
  return plan.units.map((unit) => {
    const manifestUnit = manifestByUnit.get(unit.unit_id);
    if (
      !manifestUnit
      || !manifestUnit.conversion
      || !manifestUnit.validation
      || !["validated", "loaded"].includes(manifestUnit.stage)
      || manifestUnit.source_fingerprint !== unit.source_fingerprint
      || manifestUnit.validation.fingerprint !== unit.validation_fingerprint
    ) {
      throw new Error(`staging unit is no longer the current validated manifest payload: ${unit.unit_id}`);
    }
    return {
      unit_id: unit.unit_id,
      source_fingerprint: manifestUnit.source_fingerprint,
      conversion_fingerprint: manifestUnit.conversion.artifact_fingerprint,
    };
  });
}

function stagingFinalizeIntentForDescriptor(descriptor: StagingRunDescriptor) {
  return createStagingFinalizeIntent({
    targetProjectRef: descriptor.target_project_ref,
    runSha256: descriptor.run_sha256,
    fullPlanSha256: descriptor.full_plan_sha256,
    authorizationSha256: descriptor.authorization_sha256,
    dedupeCandidatesSha256: descriptor.dedupe_candidates_sha256,
    completedBatchSha256s: descriptor.batch_sha256s,
  });
}

export async function applyStagingPlanInBatches(
  input: ApplyStagingPlanInBatchesInput,
): Promise<ApplyStagingPlanInBatchesResult> {
  assertDisclosureStagingProjectRef(input.environment.projectRef);
  assertCompleteApplyUniverse(input.plan, input.manifest);
  const authorization = assertPendingOnlyAuthorizationForApply({
    plan: input.plan,
    manifest: input.manifest,
    targetProjectRef: input.environment.projectRef,
    authorization: input.pendingOnlyAuthorization,
    paidAuthorization: input.batchAuthorization,
  });
  const descriptor = await resolveStagingRunDescriptor({
    stateDir: input.stateDir,
    plan: input.plan,
    targetProjectRef: input.environment.projectRef,
    requestedStartedAt: input.startedAt,
    batchAuthorization: authorization.batchAuthorization,
    pendingOnlyAuthorization: authorization.pendingOnlyAuthorization,
  });
  // This identity is caller-bound for claims created during this live
  // invocation. A resumed claim takes its claimant from the immutable local
  // claim journal; the database never re-exposes an active token.
  const storageClaimantId = randomUUID();
  const finalizeIntent = await readStagingFinalizeIntent(
    input.stateDir,
    descriptor.full_plan_sha256,
  );
  if (finalizeIntent) {
    if (!isDeepStrictEqual(finalizeIntent, stagingFinalizeIntentForDescriptor(descriptor))) {
      throw new Error("staging finalize intent does not belong to the immutable run descriptor");
    }
    throw new Error("staging run finalization was already requested; apply cannot present it as active");
  }
  const batches = buildStagingBatches(input.plan);
  if (batches.length === 0) throw new Error("there are no validated staging units to apply");
  if (!input.writer.verifyBatchReceipt) {
    throw new Error("the configured staging writer cannot remotely verify persisted batch receipts");
  }
  const manifestByUnit = new Map(input.manifest.units.map((unit) => [unit.unit_id, unit]));
  const sourceUniverse = stagingSourceUniverse(input.plan, input.manifest);
  const writerResults: StagingWriterResult[] = [];
  const batchRun = await runStateAwareBatches({
    stateDir: input.stateDir,
    startedAt: descriptor.started_at,
    stagingRunSha256: descriptor.run_sha256,
    fullPlanSha256: descriptor.full_plan_sha256,
    manifestSha256: canonicalSha256(input.manifest),
    sourceUniverse,
    ...authorization.batchAuthorization,
    executeBatch: async (safetyPlan) => {
      const batch = batches[safetyPlan.payload.batch_index - 1];
      if (
        !batch
        || !isDeepStrictEqual(
          safetyPlan.payload.units.map((unit) => unit.unit_id),
          batch.unit_ids,
        )
      ) {
        throw new Error("state-aware safety plan does not match the staging batch slice");
      }
      const result = await input.writer.stage(batch.plan, {
        target_project_ref: input.environment.projectRef,
        run_sha256: descriptor.run_sha256,
        full_plan_sha256: descriptor.full_plan_sha256,
        batch_plan_sha256: batch.batch_plan_sha256,
        batch_sha256: batch.batch_sha256,
        batch_index: batch.batch_index,
        batch_count: batch.batch_count,
        unit_ids: batch.unit_ids,
        authorization_kind: descriptor.authorization_kind,
        authorization_sha256: descriptor.authorization_sha256,
        local_pending_only_unit_ids: descriptor.local_pending_only_unit_ids,
        storage_claimant_id: storageClaimantId,
        record_storage_intent: async (objects) => {
          const journal = createStorageIntentJournal({
            runSha256: descriptor.run_sha256,
            batchSha256: batch.batch_sha256,
            batchIndex: batch.batch_index,
            objects,
          });
          return writeStorageIntentJournal(input.stateDir, journal);
        },
        read_storage_claim: async (object, objectIndex) => {
          const journals = (await readStorageUploadClaimJournals(
            input.stateDir,
            descriptor.run_sha256,
          )).filter((journal) =>
            journal.payload.batch_index === batch.batch_index
            && journal.payload.object_index === objectIndex
            && journal.payload.batch_sha256 === batch.batch_sha256
          );
          if (journals.length === 0) return null;
          const matching = journals.filter((journal) =>
            journal.payload.claim.bucket === object.bucket
            && journal.payload.claim.object_key === object.object_key
            && journal.payload.claim.sha256 === object.sha256
            && journal.payload.claim.bytes === object.bytes
          );
          if (matching.length !== journals.length) {
            throw new Error("durable Storage claim journal conflicts with the prepared object identity");
          }
          return matching
            .sort((left, right) => left.payload.claim.claim_epoch - right.payload.claim.claim_epoch)
            .at(-1)!.payload.claim;
        },
        record_storage_claim: async (claim, objectIndex) => {
          const journal = createStorageUploadClaimJournal({
            runSha256: descriptor.run_sha256,
            batchSha256: batch.batch_sha256,
            batchIndex: batch.batch_index,
            objectIndex,
            claim,
          });
          return writeStorageUploadClaimJournal(input.stateDir, journal);
        },
        record_storage_upload_started: async (claim, objectIndex, freshClaim) => {
          return beginStorageUploadAttempt(input.stateDir, {
            runSha256: descriptor.run_sha256,
            batchSha256: batch.batch_sha256,
            batchIndex: batch.batch_index,
            objectIndex,
            claim,
            startedAt: new Date().toISOString(),
            freshClaim,
          });
        },
        record_storage_journal: async (objects) => {
          const journal = createStorageRollbackJournal({
            runSha256: descriptor.run_sha256,
            batchSha256: batch.batch_sha256,
            batchIndex: batch.batch_index,
            objects,
          });
          return writeStorageRollbackJournal(input.stateDir, journal);
        },
        record_storage_object: async (object, objectIndex, claim, uploadAttempt) => {
          const journal = createStorageObjectJournal({
            runSha256: descriptor.run_sha256,
            batchSha256: batch.batch_sha256,
            batchIndex: batch.batch_index,
            objectIndex,
            claim,
            uploadAttempt,
            object,
          });
          return writeStorageObjectJournal(input.stateDir, journal);
        },
      });
      if (
        !isDeepStrictEqual(result.loadedUnitIds, batch.unit_ids)
        || !isDeepStrictEqual(
          result.loggedLedgerIds,
          batch.plan.ai_ledger.map((entry) => entry.ledger_id),
        )
        || !result.atomicBatchReceiptSha256
      ) {
        throw new Error("atomic writer receipt does not match the exact staging batch");
      }
      writerResults.push(result);
      return {
        stagingSnapshotSha256: canonicalSha256({
          target_project_ref: input.environment.projectRef,
          snapshot: input.plan.snapshot,
          run_sha256: descriptor.run_sha256,
          batch_sha256: batch.batch_sha256,
          atomic_batch_receipt_sha256: result.atomicBatchReceiptSha256,
        }),
        remoteBatchReceiptSha256: result.atomicBatchReceiptSha256,
        executionLedgerSha256: canonicalSha256(batch.plan.ai_ledger),
        unitResults: batch.unit_ids.map((unitId) => {
          const manifestUnit = manifestByUnit.get(unitId);
          const extraction = manifestUnit?.validation?.provider_mode === "local_deterministic"
            ? manifestUnit.local_extraction
            : manifestUnit?.extraction ?? manifestUnit?.local_extraction;
          const extractionContentSha256 = manifestUnit?.validation?.extraction_content_sha256
            ?? extraction?.content_sha256;
          if (
            !manifestUnit?.validation
            || !extraction
            || !extractionContentSha256
          ) {
            throw new Error(`staging batch lacks immutable extraction/validation identity: ${unitId}`);
          }
          const metrics = batchRowMetrics(batch.plan, unitId);
          return {
            unit_id: unitId,
            outcome: "completed" as const,
            extraction_fingerprint: extraction.fingerprint,
            extraction_content_sha256: extractionContentSha256,
            validation_fingerprint: manifestUnit.validation.fingerprint,
            ...metrics,
            staging_review_status: "pending" as const,
          };
        }),
      };
    },
    verifyPersistedBatchReceipt: async (safetyPlan, remoteBatchReceiptSha256) => {
      const batch = batches[safetyPlan.payload.batch_index - 1];
      if (
        !batch
        || !isDeepStrictEqual(
          safetyPlan.payload.units.map((unit) => unit.unit_id),
          batch.unit_ids,
        )
      ) {
        throw new Error("persisted batch receipt belongs to a different deterministic batch slice");
      }
      const verified = await input.writer.verifyBatchReceipt!({
        target_project_ref: input.environment.projectRef,
        run_sha256: descriptor.run_sha256,
        full_plan_sha256: descriptor.full_plan_sha256,
        batch_plan_sha256: batch.batch_plan_sha256,
        batch_sha256: batch.batch_sha256,
        batch_index: batch.batch_index,
        batch_count: batch.batch_count,
        unit_ids: batch.unit_ids,
        authorization_kind: descriptor.authorization_kind,
        authorization_sha256: descriptor.authorization_sha256,
        local_pending_only_unit_ids: descriptor.local_pending_only_unit_ids,
      }, remoteBatchReceiptSha256);
      if (
        verified.atomicBatchReceiptSha256 !== remoteBatchReceiptSha256
        || !isDeepStrictEqual(verified.loadedUnitIds, batch.unit_ids)
        || !isDeepStrictEqual(
          verified.loggedLedgerIds,
          batch.plan.ai_ledger.map((entry) => entry.ledger_id),
        )
      ) {
        throw new Error("remote batch receipt verification returned a different immutable receipt");
      }
    },
  });
  if (batchRun.stoppedStatus !== null) {
    throw new Error(`state-aware staging run stopped after safety gate: ${batchRun.stoppedStatus}`);
  }
  const completedUnitIds = batchRun.results.flatMap((result) =>
    result.payload.unit_results
      .filter((unit) => unit.outcome === "completed")
      .map((unit) => unit.unit_id)
  );
  const completedUnitSet = new Set(completedUnitIds);
  const writerResult: StagingWriterResult = {
    loadedUnitIds: completedUnitIds,
    skippedUnitIds: input.plan.skipped_units.map((unit) => unit.unit_id),
    loggedLedgerIds: input.plan.ai_ledger
      .filter((entry) => completedUnitSet.has(entry.unit_id))
      .map((entry) => entry.ledger_id),
  };
  return { descriptor, batchRun, writerResults, writerResult };
}

export interface ApplyConfirmedLocalPendingOnlyPlanInput {
  stateDir: string;
  startedAt: string;
  environment: StagingEnvironment;
  manifest: IngestManifest;
  plan: StagingLoadPlan;
  writer: StagingWriter;
  confirmation: LocalPendingOnlyApplyConfirmation;
}

export async function applyConfirmedLocalPendingOnlyPlan(
  input: ApplyConfirmedLocalPendingOnlyPlanInput,
): Promise<ApplyStagingPlanInBatchesResult> {
  assertStagingEnvironmentDestination(input.environment);
  const preparation = createLocalPendingOnlyApplyPreparation({
    plan: input.plan,
    manifest: input.manifest,
    targetProjectRef: input.environment.projectRef,
    startedAt: input.startedAt,
  });
  assertLocalPendingOnlyApplyConfirmation(preparation, input.confirmation);
  return applyStagingPlanInBatches({
    stateDir: input.stateDir,
    startedAt: preparation.started_at,
    environment: input.environment,
    manifest: input.manifest,
    plan: input.plan,
    writer: input.writer,
    pendingOnlyAuthorization: preparation.authorization,
  });
}

export interface FinalizeConfirmedLocalPendingOnlyPlanResult {
  descriptor: StagingRunDescriptor;
  batchRun: StateAwareBatchRunResult;
}

export async function finalizeConfirmedLocalPendingOnlyPlan(
  input: ApplyConfirmedLocalPendingOnlyPlanInput,
): Promise<FinalizeConfirmedLocalPendingOnlyPlanResult> {
  assertStagingEnvironmentDestination(input.environment);
  const preparation = createLocalPendingOnlyApplyPreparation({
    plan: input.plan,
    manifest: input.manifest,
    targetProjectRef: input.environment.projectRef,
    startedAt: input.startedAt,
  });
  assertLocalPendingOnlyApplyConfirmation(preparation, input.confirmation);
  const descriptor = await readStagingRunDescriptor(input.stateDir, preparation.full_plan_sha256);
  if (!descriptor) {
    throw new Error("staging run descriptor is missing; the pending-only load is incomplete");
  }
  if (!isDeepStrictEqual(descriptor, preparation.descriptor)) {
    throw new Error("staging run descriptor does not match the confirmed immutable load");
  }
  if (!input.writer.verifyBatchReceipt) {
    throw new Error("the configured staging writer cannot remotely verify persisted batch receipts");
  }
  if (!input.writer.finalizeDedupe) {
    throw new Error("the configured staging writer has no atomic cross-batch dedupe finalizer");
  }
  const batches = buildStagingBatches(input.plan);
  const sourceUniverse = stagingSourceUniverse(input.plan, input.manifest);
  const batchRun = await inspectCompletedStateAwareBatches({
    stateDir: input.stateDir,
    startedAt: descriptor.started_at,
    stagingRunSha256: descriptor.run_sha256,
    fullPlanSha256: descriptor.full_plan_sha256,
    manifestSha256: preparation.manifest_sha256,
    sourceUniverse,
    authorizationKind: "local_validated_pending_only",
    authorizationSha256: preparation.authorization.authorization_sha256,
    verifyPersistedBatchReceipt: async (safetyPlan, remoteBatchReceiptSha256) => {
      const batch = batches[safetyPlan.payload.batch_index - 1];
      if (
        !batch
        || !isDeepStrictEqual(
          safetyPlan.payload.units.map((unit) => unit.unit_id),
          batch.unit_ids,
        )
      ) {
        throw new Error("persisted batch receipt belongs to a different deterministic batch slice");
      }
      const verified = await input.writer.verifyBatchReceipt!({
        target_project_ref: input.environment.projectRef,
        run_sha256: descriptor.run_sha256,
        full_plan_sha256: descriptor.full_plan_sha256,
        batch_plan_sha256: batch.batch_plan_sha256,
        batch_sha256: batch.batch_sha256,
        batch_index: batch.batch_index,
        batch_count: batch.batch_count,
        unit_ids: batch.unit_ids,
        authorization_kind: descriptor.authorization_kind,
        authorization_sha256: descriptor.authorization_sha256,
        local_pending_only_unit_ids: descriptor.local_pending_only_unit_ids,
      }, remoteBatchReceiptSha256);
      if (
        verified.atomicBatchReceiptSha256 !== remoteBatchReceiptSha256
        || !isDeepStrictEqual(verified.loadedUnitIds, batch.unit_ids)
        || !isDeepStrictEqual(
          verified.loggedLedgerIds,
          batch.plan.ai_ledger.map((entry) => entry.ledger_id),
        )
      ) {
        throw new Error("remote batch receipt verification returned a different immutable receipt");
      }
    },
  });
  await writeStagingFinalizeIntent(
    input.stateDir,
    stagingFinalizeIntentForDescriptor(descriptor),
  );
  await input.writer.finalizeDedupe(input.plan, {
    target_project_ref: input.environment.projectRef,
    run_sha256: descriptor.run_sha256,
    full_plan_sha256: descriptor.full_plan_sha256,
    dedupe_candidates_sha256: descriptor.dedupe_candidates_sha256,
    completed_batch_sha256s: batches.map((batch) => batch.batch_sha256),
  });
  return { descriptor, batchRun };
}

export async function authorizeStagingStorageUploadRetry(
  input: AuthorizeStagingStorageUploadRetryInput,
): Promise<AuthorizeStagingStorageUploadRetryResult> {
  Sha256Schema.parse(input.fullPlanSha256);
  assertDisclosureStagingProjectRef(input.targetProjectRef);
  if (!Number.isSafeInteger(input.batchIndex) || input.batchIndex < 1) {
    throw new Error("storage upload reconciliation requires a positive batch index");
  }
  if (!Number.isSafeInteger(input.objectIndex) || input.objectIndex < 1) {
    throw new Error("storage upload reconciliation requires a positive object index");
  }
  if (input.confirmation !== "no_inflight_upload_confirmed") {
    throw new Error("storage upload reconciliation requires explicit no-inflight confirmation");
  }
  if (input.reason.trim().length < 1 || input.reason.length > 500) {
    throw new Error("storage upload reconciliation reason must contain between 1 and 500 characters");
  }
  const confirmedAt = new Date(input.confirmedNoInflightAt);
  if (!Number.isFinite(confirmedAt.getTime())) {
    throw new Error("storage upload reconciliation confirmation timestamp is invalid");
  }

  const descriptor = await readStagingRunDescriptor(input.stateDir, input.fullPlanSha256);
  if (!descriptor) throw new Error("no immutable staging run descriptor exists for this full plan");
  if (descriptor.target_project_ref !== input.targetProjectRef) {
    throw new Error("the immutable staging run descriptor belongs to another project");
  }
  const expectedBatchSha256 = descriptor.batch_sha256s[input.batchIndex - 1];
  if (!expectedBatchSha256) {
    throw new Error("storage upload reconciliation batch is outside the immutable run descriptor");
  }

  const claimJournals = (await readStorageUploadClaimJournals(input.stateDir, descriptor.run_sha256))
    .filter((journal) =>
      journal.payload.batch_index === input.batchIndex
      && journal.payload.object_index === input.objectIndex
      && journal.payload.batch_sha256 === expectedBatchSha256
    )
    .sort((left, right) => left.payload.claim.claim_epoch - right.payload.claim.claim_epoch);
  const latestClaimJournal = claimJournals.at(-1);
  if (!latestClaimJournal) {
    throw new Error("no durable upload claim exists for the requested batch object");
  }
  const claim = latestClaimJournal.payload.claim;
  if (claim.claim_action !== "upload") {
    throw new Error("verify/reuse claims never authorize an HTTP upload retry");
  }

  const starts = (await readStorageUploadStartedJournals(input.stateDir, descriptor.run_sha256))
    .filter((journal) =>
      journal.payload.batch_index === input.batchIndex
      && journal.payload.object_index === input.objectIndex
      && journal.payload.batch_sha256 === expectedBatchSha256
      && isDeepStrictEqual(journal.payload.claim, claim)
    )
    .sort((left, right) => left.payload.upload_attempt - right.payload.upload_attempt);
  const latestStart = starts.at(-1);
  if (latestStart && confirmedAt.getTime() < Date.parse(latestStart.payload.started_at)) {
    throw new Error("no-inflight confirmation must be made after the latest upload attempt started");
  }

  const observations = await readStorageObjectJournals(input.stateDir, descriptor.run_sha256);
  if (observations.some((journal) =>
    journal.payload.batch_index === input.batchIndex
    && journal.payload.object_index === input.objectIndex
    && journal.payload.upload_attempt === latestStart?.payload.upload_attempt
    && isDeepStrictEqual(journal.payload.claim, claim)
  )) {
    throw new Error("the latest upload attempt already has a durable object observation; resume without re-uploading");
  }

  const previousUploadAttempt = latestStart?.payload.upload_attempt ?? 0;
  const nextUploadAttempt = previousUploadAttempt + 1;
  const existingReceipts = (await readStorageUploadReconcileReceipts(
    input.stateDir,
    descriptor.run_sha256,
  )).filter((receipt) =>
    receipt.payload.batch_index === input.batchIndex
    && receipt.payload.object_index === input.objectIndex
    && receipt.payload.next_upload_attempt === nextUploadAttempt
    && isDeepStrictEqual(receipt.payload.claim, claim)
  );
  if (existingReceipts.length > 1) {
    throw new Error("multiple reconciliation receipts authorize the same upload attempt");
  }

  const receipt = createStorageUploadReconcileReceipt({
    runSha256: descriptor.run_sha256,
    batchSha256: expectedBatchSha256,
    batchIndex: input.batchIndex,
    objectIndex: input.objectIndex,
    claim,
    previousUploadAttempt,
    confirmedNoInflightAt: confirmedAt.toISOString(),
    reason: input.reason,
  });
  const receiptPath = await writeStorageUploadReconcileReceipt(input.stateDir, receipt);
  return {
    runSha256: descriptor.run_sha256,
    batchIndex: input.batchIndex,
    objectIndex: input.objectIndex,
    claimEpoch: claim.claim_epoch,
    previousUploadAttempt,
    nextUploadAttempt,
    receiptSha256: receipt.receipt_sha256,
    receiptPath,
  };
}

export async function abortStagingRun(input: {
  stateDir: string;
  fullPlanSha256: string;
  environment: StagingEnvironment;
  reason: string;
  writer?: StagingWriter;
}): Promise<StagingAbortResult> {
  Sha256Schema.parse(input.fullPlanSha256);
  assertStagingEnvironmentDestination(input.environment);
  if (input.reason.trim().length < 1 || input.reason.length > 500) {
    throw new Error("a staging abort reason must contain between 1 and 500 characters");
  }
  const descriptor = await readStagingRunDescriptor(input.stateDir, input.fullPlanSha256);
  if (!descriptor) throw new Error("no immutable staging run descriptor exists for this full plan");
  if (descriptor.target_project_ref !== input.environment.projectRef) {
    throw new Error("the immutable staging run descriptor belongs to another project");
  }
  const intentJournals = await readStorageIntentJournals(input.stateDir, descriptor.run_sha256);
  const journals = await readStorageObjectJournals(input.stateDir, descriptor.run_sha256);
  const intendedByBatchIdentity = new Map<string, StagingStorageIntent>();
  for (const journal of intentJournals) {
    if (
      journal.payload.batch_index < 1
      || journal.payload.batch_index > descriptor.batch_sha256s.length
      || descriptor.batch_sha256s[journal.payload.batch_index - 1]
        !== journal.payload.batch_sha256
    ) {
      throw new Error("a Storage intent journal does not belong to the immutable staging batch chain");
    }
    for (const object of journal.payload.objects) {
      const identity = `${journal.payload.batch_index}\0${object.bucket}\0${object.object_key}`;
      if (intendedByBatchIdentity.has(identity)) {
        throw new Error("Storage intent journals contain a duplicate batch/object identity");
      }
      intendedByBatchIdentity.set(identity, object);
    }
  }
  const objectsByIdentity = new Map<string, StagingStorageMutation>();
  for (const journal of journals) {
    if (
      journal.payload.batch_index < 1
      || journal.payload.batch_index > descriptor.batch_sha256s.length
      || descriptor.batch_sha256s[journal.payload.batch_index - 1]
        !== journal.payload.batch_sha256
    ) {
      throw new Error("a Storage ownership journal does not belong to the immutable staging batch chain");
    }
    const object = journal.payload.object;
    const batchIdentity = `${journal.payload.batch_index}\0${object.bucket}\0${object.object_key}`;
    const intended = intendedByBatchIdentity.get(batchIdentity);
    if (!intended || !isDeepStrictEqual(intended, {
      bucket: object.bucket,
      object_key: object.object_key,
      sha256: object.sha256,
      bytes: object.bytes,
    })) {
      throw new Error("a Storage ownership journal has no exact durable upload intent");
    }
    const identity = `${object.bucket}\0${object.object_key}`;
    const existing = objectsByIdentity.get(identity);
    if (existing && !isDeepStrictEqual(existing, object)) {
      throw new Error("Storage ownership journals disagree for one content-addressed object");
    }
    objectsByIdentity.set(identity, object);
  }
  // Do not block prepared-but-unclaimed intents locally. No HTTP request can
  // exist before the database claim, so the abort RPC may safely reconcile
  // them while holding the run/object locks. Any active claim remains blocked
  // by the database claim fence, including after its diagnostic expiry.
  const locallyCreatedStorageObjects = [...objectsByIdentity.values()]
    .filter((object) => object.created)
    .sort((left, right) =>
      `${left.bucket}\0${left.object_key}`.localeCompare(`${right.bucket}\0${right.object_key}`)
    );
  const writer = input.writer ?? (await import("./supabase-writer.js"))
    .createSupabaseStagingWriter(input.environment);
  if (!writer.abortRun) {
    throw new Error("the configured staging writer has no atomic abort/Storage rollback implementation");
  }
  const persistRollbackReceipt = async (result: StagingAbortResult): Promise<void> => {
    if (!result.runFound) return;
    if (!result.storageRollbackReceiptSha256) {
      throw new Error("the aborted staging run did not return its immutable Storage rollback receipt");
    }
    await writeStagingStorageRollbackReceipt(
      input.stateDir,
      createStagingStorageRollbackReceipt({
        targetProjectRef: input.environment.projectRef,
        runSha256: descriptor.run_sha256,
        fullPlanSha256: descriptor.full_plan_sha256,
        reason: input.reason.trim(),
        storageRollbackReceiptSha256: result.storageRollbackReceiptSha256,
        storageRollbackObjects: result.storageRollbackObjects,
      }),
    );
  };
  let result: StagingAbortResult;
  try {
    result = await writer.abortRun({
      target_project_ref: input.environment.projectRef,
      run_sha256: descriptor.run_sha256,
      full_plan_sha256: descriptor.full_plan_sha256,
      reason: input.reason.trim(),
      locally_created_storage_objects: locallyCreatedStorageObjects,
    });
  } catch (error) {
    if (error instanceof StagingRollbackIncompleteError) {
      await persistRollbackReceipt(error.result);
    }
    throw error;
  }
  await persistRollbackReceipt(result);
  if (
    result.ambiguousStorageObjectCount > 0
    || result.manualStorageDeletionRequiredCount > 0
  ) {
    throw new StagingRollbackIncompleteError(result);
  }
  return result;
}

export async function completeStagingStorageRollback(input: {
  stateDir: string;
  fullPlanSha256: string;
  environment: StagingEnvironment;
  writer?: StagingWriter;
}): Promise<StagingStorageRollbackCompletionResult> {
  Sha256Schema.parse(input.fullPlanSha256);
  assertStagingEnvironmentDestination(input.environment);
  const descriptor = await readStagingRunDescriptor(input.stateDir, input.fullPlanSha256);
  if (!descriptor) throw new Error("no immutable staging run descriptor exists for this full plan");
  const receipt = await readStagingStorageRollbackReceipt(input.stateDir, input.fullPlanSha256);
  if (!receipt) {
    throw new Error("no immutable Storage rollback receipt exists; run abort-staging-run first");
  }
  if (
    descriptor.target_project_ref !== input.environment.projectRef
    || receipt.payload.target_project_ref !== input.environment.projectRef
    || receipt.payload.run_sha256 !== descriptor.run_sha256
    || receipt.payload.full_plan_sha256 !== descriptor.full_plan_sha256
  ) {
    throw new Error("the Storage rollback receipt does not belong to this project and staging run");
  }
  const writer = input.writer ?? (await import("./supabase-writer.js"))
    .createSupabaseStagingWriter(input.environment);
  if (!writer.completeStorageRollback) {
    throw new Error("the configured staging writer cannot complete an authorized Storage rollback");
  }
  return writer.completeStorageRollback({
    target_project_ref: input.environment.projectRef,
    run_sha256: descriptor.run_sha256,
    full_plan_sha256: descriptor.full_plan_sha256,
    storage_rollback_receipt_sha256: receipt.payload.storage_rollback_receipt_sha256,
    storage_rollback_objects: receipt.payload.storage_rollback_objects,
  });
}

export async function invalidateStagingRun(input: {
  stateDir: string;
  fullPlanSha256: string;
  environment: StagingEnvironment;
  reason: string;
  writer?: StagingWriter;
}): Promise<StagingInvalidationResult> {
  Sha256Schema.parse(input.fullPlanSha256);
  assertStagingEnvironmentDestination(input.environment);
  if (input.reason.trim().length < 1 || input.reason.length > 500) {
    throw new Error("a staging invalidation reason must contain between 1 and 500 characters");
  }
  const descriptor = await readStagingRunDescriptor(input.stateDir, input.fullPlanSha256);
  if (!descriptor) throw new Error("no immutable staging run descriptor exists for this full plan");
  if (descriptor.target_project_ref !== input.environment.projectRef) {
    throw new Error("the immutable staging run descriptor belongs to another project");
  }
  const writer = input.writer ?? (await import("./supabase-writer.js"))
    .createSupabaseStagingWriter(input.environment);
  if (!writer.invalidateRun) {
    throw new Error("the configured staging writer has no atomic completed-run invalidation implementation");
  }
  return writer.invalidateRun({
    target_project_ref: input.environment.projectRef,
    run_sha256: descriptor.run_sha256,
    full_plan_sha256: descriptor.full_plan_sha256,
    reason: input.reason.trim(),
  });
}

function requiredLocalPendingOnlyApplyConfirmation(
  options: LoadOptions,
  startedAt: string | undefined,
): { startedAt: string; confirmation: LocalPendingOnlyApplyConfirmation } {
  if (
    !startedAt
    || !options.expectedFullPlanSha256
    || !options.expectedAuthorizationSha256
    || !options.expectedRunSha256
  ) {
    throw new Error(
      "local pending-only apply requires explicit startedAt, full plan SHA-256, authorization SHA-256, and run SHA-256 confirmations",
    );
  }
  return {
    startedAt,
    confirmation: {
      expectedFullPlanSha256: options.expectedFullPlanSha256,
      expectedAuthorizationSha256: options.expectedAuthorizationSha256,
      expectedRunSha256: options.expectedRunSha256,
    },
  };
}

export async function prepareValidatedLocalPendingOnlyApply(input: {
  stateDir: string;
  snapshot: string;
  targetProjectRef: string;
  startedAt: string;
}): Promise<{
  plan: StagingLoadPlan;
  manifest: IngestManifest;
  preparation: LocalPendingOnlyApplyPreparation;
}> {
  assertDisclosureStagingProjectRef(input.targetProjectRef);
  const { plan, manifest } = await buildLoadPlan(input.stateDir, input.snapshot);
  return {
    plan,
    manifest,
    preparation: createLocalPendingOnlyApplyPreparation({
      plan,
      manifest,
      targetProjectRef: input.targetProjectRef,
      startedAt: input.startedAt,
    }),
  };
}

export async function finalizeValidatedStagingRun(
  options: LoadOptions,
  dependencies: Pick<LoadDependencies, "writer" | "env" | "startedAt"> = {},
): Promise<FinalizeConfirmedLocalPendingOnlyPlanResult> {
  const explicit = requiredLocalPendingOnlyApplyConfirmation(options, dependencies.startedAt);
  const environment = stagingEnvironment(dependencies.env ?? process.env, options.confirmProjectRef);
  const { plan, manifest } = await buildLoadPlan(options.stateDir, options.snapshot);
  const writer = dependencies.writer ?? (await import("./supabase-writer.js"))
    .createSupabaseStagingWriter(environment);
  return finalizeConfirmedLocalPendingOnlyPlan({
    stateDir: options.stateDir,
    startedAt: explicit.startedAt,
    environment,
    manifest,
    plan,
    writer,
    confirmation: explicit.confirmation,
  });
}

export async function loadValidated(
  options: LoadOptions,
  dependencies: LoadDependencies = {},
): Promise<LoadResult> {
  const derivesLocalAuthorization = Boolean(
    options.apply
    && !dependencies.batchAuthorization
    && !dependencies.pendingOnlyAuthorization,
  );
  const explicit = derivesLocalAuthorization
    ? requiredLocalPendingOnlyApplyConfirmation(options, dependencies.startedAt)
    : null;
  const environment = options.apply
    ? stagingEnvironment(dependencies.env ?? process.env, options.confirmProjectRef)
    : null;
  const { plan, manifest } = await buildLoadPlan(options.stateDir, options.snapshot);
  if (options.apply) {
    if (!environment) {
      throw new Error("load apply requires an explicit staging destination fence");
    }
    const writer = dependencies.writer ?? (await import("./supabase-writer.js"))
      .createSupabaseStagingWriter(environment);
    const applied = explicit
      ? await applyConfirmedLocalPendingOnlyPlan({
        stateDir: options.stateDir,
        startedAt: explicit.startedAt,
        environment,
        manifest,
        plan,
        writer,
        confirmation: explicit.confirmation,
      })
      : await applyStagingPlanInBatches({
        stateDir: options.stateDir,
        startedAt: dependencies.startedAt,
        environment,
        manifest,
        plan,
        writer,
        batchAuthorization: dependencies.batchAuthorization,
        pendingOnlyAuthorization: dependencies.pendingOnlyAuthorization,
      });
    return {
      mode: "loaded-batches-verified",
      plan,
      manifest,
      writer_result: applied.writerResult,
      batch_run: applied.batchRun,
    };
  }
  return { mode: "dry-run", plan, manifest, writer_result: null };
}
