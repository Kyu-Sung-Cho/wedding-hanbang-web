import { randomUUID } from "node:crypto";
import { link, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
} from "./artifact-integrity.js";
import { canonicalSha256 } from "./gate-integrity.js";
import { syncDirectoryMetadata } from "./io.js";
import {
  validateFixedEightPassReceipt,
} from "./pilot-pass-receipt.js";
import type { FixedEightPassReceipt } from "./pilot-pass-receipt.js";

export const BATCH_SAFETY_JOURNAL_OPERATIONAL = true as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const BatchCandidateSchema = z.object({
  unit_id: Sha256Schema,
  source_fingerprint: Sha256Schema,
  conversion_fingerprint: Sha256Schema,
}).strict();

const BatchUnitResultSchema = z.object({
  unit_id: Sha256Schema,
  outcome: z.enum(["completed", "failed"]),
  extraction_fingerprint: Sha256Schema.nullable(),
  extraction_content_sha256: Sha256Schema.nullable(),
  validation_fingerprint: Sha256Schema.nullable(),
  staged_record_count: z.number().int().nonnegative(),
  needs_review_count: z.number().int().nonnegative(),
  staging_review_status: z.literal("pending"),
  error_code: z.string().min(1).max(200).nullable(),
}).strict().superRefine((value, context) => {
  if (value.needs_review_count > value.staged_record_count) {
    context.addIssue({ code: "custom", message: "needs_review_count cannot exceed staged_record_count" });
  }
  const completedHashes = [
    value.extraction_fingerprint,
    value.extraction_content_sha256,
    value.validation_fingerprint,
  ];
  if (value.outcome === "completed" && completedHashes.some((hash) => hash === null)) {
    context.addIssue({
      code: "custom",
      message: "completed units require extraction fingerprint, extraction content SHA-256, and validation fingerprint",
    });
  }
  if (value.outcome === "failed" && completedHashes.some((hash) => hash !== null)) {
    context.addIssue({ code: "custom", message: "failed units cannot claim completed artifact hashes" });
  }
});

const UniverseEvidencePayloadSchema = z.object({
  scope: z.literal("universe"),
  captured_at: z.string().datetime(),
  operational: z.literal(true),
  derivation_status: z.literal("state_aware_runner"),
  staging_run_sha256: Sha256Schema,
  full_plan_sha256: Sha256Schema,
  manifest_sha256: Sha256Schema,
  source_universe: z.array(BatchCandidateSchema).min(1),
}).strict();

const ExecutionEvidencePayloadSchema = z.object({
  scope: z.literal("execution"),
  captured_at: z.string().datetime(),
  operational: z.literal(true),
  derivation_status: z.literal("state_aware_runner"),
  universe_evidence_sha256: Sha256Schema,
  plan_sha256: Sha256Schema,
  staging_snapshot_sha256: Sha256Schema,
  remote_batch_receipt_sha256: Sha256Schema,
  execution_ledger_sha256: Sha256Schema,
  unit_results: z.array(BatchUnitResultSchema).max(25),
}).strict();

const BatchEvidencePayloadSchema = z.discriminatedUnion("scope", [
  UniverseEvidencePayloadSchema,
  ExecutionEvidencePayloadSchema,
]);

export const BatchEvidenceSchema = z.object({
  schema_version: z.literal(2),
  kind: z.literal("vendor_ingest_batch_evidence"),
  payload: BatchEvidencePayloadSchema,
  evidence_sha256: Sha256Schema,
}).strict();

const ReviewMetricsSchema = z.object({
  staged_record_count: z.number().int().nonnegative(),
  needs_review_count: z.number().int().nonnegative(),
}).strict();

const ReviewEvaluationSchema = z.object({
  decision: z.enum(["baseline", "continue", "stop"]),
  reason: z.enum([
    "first_batch_baseline",
    "below_double",
    "at_least_double",
    "zero_baseline_increase",
    "invalid_denominator",
  ]),
  current_cross_product: z.string().regex(/^\d+$/u).nullable(),
  doubled_previous_cross_product: z.string().regex(/^\d+$/u).nullable(),
}).strict();

const BatchPlanPayloadSchema = z.object({
  created_at: z.string().datetime(),
  operational_status: z.literal("state_aware_runner"),
  batch_index: z.number().int().positive(),
  authorization_kind: z.enum(["paid_pilot_gate", "local_validated_pending_only"]),
  authorization_sha256: Sha256Schema,
  universe_evidence_sha256: Sha256Schema,
  source_universe_sha256: Sha256Schema,
  source_universe_count: z.number().int().positive(),
  source_universe: z.array(BatchCandidateSchema).min(1),
  previous_result_sha256: Sha256Schema.nullable(),
  completed_before_count: z.number().int().nonnegative(),
  remaining_before_count: z.number().int().positive(),
  remaining_after_count: z.number().int().nonnegative(),
  final_tail: z.boolean(),
  units: z.array(BatchCandidateSchema).min(1).max(25),
}).strict();

export const BatchPlanDraftSchema = z.object({
  schema_version: z.literal(2),
  kind: z.literal("vendor_ingest_batch_plan_draft"),
  payload: BatchPlanPayloadSchema,
  plan_sha256: Sha256Schema,
}).strict();

const BatchResultPayloadSchema = z.object({
  completed_at: z.string().datetime(),
  operational_status: z.literal("state_aware_runner"),
  batch_index: z.number().int().positive(),
  plan_sha256: Sha256Schema,
  authorization_kind: z.enum(["paid_pilot_gate", "local_validated_pending_only"]),
  authorization_sha256: Sha256Schema,
  universe_evidence_sha256: Sha256Schema,
  execution_evidence_sha256: Sha256Schema,
  source_universe_sha256: Sha256Schema,
  previous_result_sha256: Sha256Schema.nullable(),
  previous_review_metrics: ReviewMetricsSchema.nullable(),
  completed_before_unit_ids: z.array(Sha256Schema),
  planned_unit_ids: z.array(Sha256Schema).min(1).max(25),
  status: z.enum(["pass", "failed", "incomplete", "review_spike"]),
  unit_results: z.array(BatchUnitResultSchema).max(25),
  cumulative_completed_unit_ids: z.array(Sha256Schema),
  review_metrics: ReviewMetricsSchema,
  review_evaluation: ReviewEvaluationSchema,
}).strict();

export const BatchResultDraftSchema = z.object({
  schema_version: z.literal(2),
  kind: z.literal("vendor_ingest_batch_result_draft"),
  payload: BatchResultPayloadSchema,
  result_sha256: Sha256Schema,
}).strict();

const StorageJournalObjectSchema = z.object({
  bucket: z.enum(["disclosure-raw", "disclosure-preview"]),
  object_key: z.string().regex(/^[a-f0-9]{64}\.(?:xlsx|docx|hwp|pdf|png|txt)$/u),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  created: z.boolean(),
}).strict().superRefine((value, context) => {
  if (!value.object_key.startsWith(`${value.sha256}.`)) {
    context.addIssue({ code: "custom", message: "storage journal object key must be content-addressed by its SHA-256" });
  }
  if (value.bucket === "disclosure-preview" && !value.object_key.endsWith(".txt")) {
    context.addIssue({ code: "custom", message: "preview storage journal entries must use .txt keys" });
  }
  if (value.bucket === "disclosure-raw" && value.object_key.endsWith(".txt")) {
    context.addIssue({ code: "custom", message: "raw storage journal entries cannot use preview keys" });
  }
});

const StorageIntentObjectSchema = z.object({
  bucket: z.enum(["disclosure-raw", "disclosure-preview"]),
  object_key: z.string().regex(/^[a-f0-9]{64}\.(?:xlsx|docx|hwp|pdf|png|txt)$/u),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value, context) => {
  if (!value.object_key.startsWith(`${value.sha256}.`)) {
    context.addIssue({ code: "custom", message: "storage intent object key must be content-addressed by its SHA-256" });
  }
  if (value.bucket === "disclosure-preview" && !value.object_key.endsWith(".txt")) {
    context.addIssue({ code: "custom", message: "preview storage intent entries must use .txt keys" });
  }
  if (value.bucket === "disclosure-raw" && value.object_key.endsWith(".txt")) {
    context.addIssue({ code: "custom", message: "raw storage intent entries cannot use preview keys" });
  }
});

const StorageUploadClaimSchema = z.object({
  bucket: z.enum(["disclosure-raw", "disclosure-preview"]),
  object_key: z.string().regex(/^[a-f0-9]{64}\.(?:xlsx|docx|hwp|pdf|png|txt)$/u),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  claim_token: z.string().uuid(),
  claim_epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  claimant_id: z.string().uuid(),
  claim_action: z.enum(["upload", "verify"]),
  claim_expires_at: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (!value.object_key.startsWith(`${value.sha256}.`)) {
    context.addIssue({ code: "custom", message: "storage upload claim key must be content-addressed" });
  }
});

const StorageIntentJournalPayloadSchema = z.object({
  run_sha256: Sha256Schema,
  batch_sha256: Sha256Schema,
  batch_index: z.number().int().positive(),
  objects: z.array(StorageIntentObjectSchema).max(1_000),
}).strict().superRefine((value, context) => {
  const identities = value.objects.map((object) => `${object.bucket}\0${object.object_key}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "storage intent journal contains duplicate object identities" });
  }
});

export const StorageIntentJournalSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_storage_intent_journal"),
  payload: StorageIntentJournalPayloadSchema,
  journal_sha256: Sha256Schema,
}).strict();

const StorageRollbackJournalPayloadSchema = z.object({
  run_sha256: Sha256Schema,
  batch_sha256: Sha256Schema,
  batch_index: z.number().int().positive(),
  objects: z.array(StorageJournalObjectSchema).max(1_000),
  rollback_objects: z.array(StorageJournalObjectSchema).max(1_000),
}).strict().superRefine((value, context) => {
  const identities = value.objects.map((object) => `${object.bucket}\0${object.object_key}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "storage rollback journal contains duplicate object identities" });
  }
  const expected = value.objects.filter((object) => object.created);
  if (!isDeepStrictEqual(value.rollback_objects, expected)) {
    context.addIssue({ code: "custom", message: "rollback objects must be the exact created-object subset" });
  }
});

export const StorageRollbackJournalSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_storage_rollback_journal"),
  payload: StorageRollbackJournalPayloadSchema,
  journal_sha256: Sha256Schema,
}).strict();

const StorageObjectJournalPayloadSchema = z.object({
  run_sha256: Sha256Schema,
  batch_sha256: Sha256Schema,
  batch_index: z.number().int().positive(),
  object_index: z.number().int().positive().max(2_000),
  claim: StorageUploadClaimSchema,
  upload_attempt: z.number().int().nonnegative().max(1_000),
  object: StorageJournalObjectSchema,
}).strict().superRefine((value, context) => {
  const objectIdentity = `${value.object.bucket}\0${value.object.object_key}\0${value.object.sha256}\0${value.object.bytes}`;
  const claimIdentity = `${value.claim.bucket}\0${value.claim.object_key}\0${value.claim.sha256}\0${value.claim.bytes}`;
  if (objectIdentity !== claimIdentity) {
    context.addIssue({ code: "custom", message: "storage object observation must match its exact claim" });
  }
  if ((value.claim.claim_action === "upload") !== (value.upload_attempt > 0)) {
    context.addIssue({ code: "custom", message: "only upload claims may carry a positive upload attempt" });
  }
});

export const StorageObjectJournalSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_storage_object_journal"),
  payload: StorageObjectJournalPayloadSchema,
  journal_sha256: Sha256Schema,
}).strict();

const StorageUploadClaimJournalPayloadSchema = z.object({
  run_sha256: Sha256Schema,
  batch_sha256: Sha256Schema,
  batch_index: z.number().int().positive(),
  object_index: z.number().int().positive().max(2_000),
  claim: StorageUploadClaimSchema,
}).strict();

export const StorageUploadClaimJournalSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_storage_upload_claim_journal"),
  payload: StorageUploadClaimJournalPayloadSchema,
  journal_sha256: Sha256Schema,
}).strict();

const StorageUploadStartedJournalPayloadSchema = z.object({
  run_sha256: Sha256Schema,
  batch_sha256: Sha256Schema,
  batch_index: z.number().int().positive(),
  object_index: z.number().int().positive().max(2_000),
  upload_attempt: z.number().int().positive().max(1_000),
  claim: StorageUploadClaimSchema.refine((claim) => claim.claim_action === "upload", {
    message: "an upload start requires an upload claim",
  }),
  started_at: z.string().datetime(),
}).strict();

export const StorageUploadStartedJournalSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_storage_upload_started_journal"),
  payload: StorageUploadStartedJournalPayloadSchema,
  journal_sha256: Sha256Schema,
}).strict();

const StorageUploadReconcileReceiptPayloadSchema = z.object({
  run_sha256: Sha256Schema,
  batch_sha256: Sha256Schema,
  batch_index: z.number().int().positive(),
  object_index: z.number().int().positive().max(2_000),
  claim: StorageUploadClaimSchema.refine((claim) => claim.claim_action === "upload", {
    message: "upload reconciliation requires an upload claim",
  }),
  previous_upload_attempt: z.number().int().nonnegative().max(999),
  next_upload_attempt: z.number().int().min(1).max(1_000),
  confirmed_no_inflight_at: z.string().datetime(),
  reason: z.string().trim().min(1).max(500),
  confirmation: z.literal("no_inflight_upload_confirmed"),
}).strict().superRefine((value, context) => {
  if (value.next_upload_attempt !== value.previous_upload_attempt + 1) {
    context.addIssue({ code: "custom", message: "reconciliation must authorize exactly one next upload attempt" });
  }
});

export const StorageUploadReconcileReceiptSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_storage_upload_reconcile_receipt"),
  payload: StorageUploadReconcileReceiptPayloadSchema,
  receipt_sha256: Sha256Schema,
}).strict();

const StagingStorageRollbackReceiptPayloadSchema = z.object({
  target_project_ref: z.string().regex(/^[a-z0-9][a-z0-9-]{3,80}$/u),
  run_sha256: Sha256Schema,
  full_plan_sha256: Sha256Schema,
  reason: z.string().trim().min(1).max(500),
  storage_rollback_receipt_sha256: Sha256Schema,
  storage_rollback_objects: z.array(StorageIntentObjectSchema).max(32_000),
}).strict().superRefine((value, context) => {
  const identities = value.storage_rollback_objects.map((object) =>
    `${object.bucket}\0${object.object_key}`
  );
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "rollback receipt contains duplicate Storage identities" });
  }
  const sorted = [...identities].sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(identities, sorted)) {
    context.addIssue({ code: "custom", message: "rollback receipt Storage identities must be canonical" });
  }
});

export const StagingStorageRollbackReceiptSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_disclosure_storage_rollback_receipt"),
  payload: StagingStorageRollbackReceiptPayloadSchema,
  artifact_sha256: Sha256Schema,
}).strict();

export const StagingRunDescriptorSchema = z.object({
  schema_version: z.literal(2),
  kind: z.literal("vendor_disclosure_staging_run"),
  started_at: z.string().datetime(),
  target_project_ref: z.string().regex(/^[a-z0-9][a-z0-9-]{3,80}$/u),
  snapshot: z.string().regex(/^20\d{2}Q[1-4]$/u),
  full_plan_sha256: Sha256Schema,
  dedupe_candidates_sha256: Sha256Schema,
  authorization_kind: z.enum(["paid_pilot_gate", "local_validated_pending_only"]),
  authorization_sha256: Sha256Schema,
  local_pending_only_unit_ids: z.array(Sha256Schema).max(1_000),
  batch_sha256s: z.array(Sha256Schema).min(1),
  run_sha256: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (new Set(value.local_pending_only_unit_ids).size !== value.local_pending_only_unit_ids.length) {
    context.addIssue({ code: "custom", message: "local pending-only unit IDs must be unique" });
  }
  if ((value.local_pending_only_unit_ids.length > 0) !== (value.authorization_kind === "local_validated_pending_only")) {
    context.addIssue({
      code: "custom",
      message: "local pending-only units require exactly one separate pending-only authorization",
    });
  }
});

const StagingFinalizeIntentPayloadSchema = z.object({
  target_project_ref: z.string().regex(/^[a-z0-9][a-z0-9-]{3,80}$/u),
  run_sha256: Sha256Schema,
  full_plan_sha256: Sha256Schema,
  authorization_sha256: Sha256Schema,
  dedupe_candidates_sha256: Sha256Schema,
  completed_batch_sha256s: z.array(Sha256Schema).min(1).max(1_000),
}).strict().superRefine((value, context) => {
  if (new Set(value.completed_batch_sha256s).size !== value.completed_batch_sha256s.length) {
    context.addIssue({ code: "custom", message: "finalize intent batch SHA-256s must be unique" });
  }
});

const StagingFinalizeIntentSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("vendor_disclosure_staging_finalize_intent"),
  payload: StagingFinalizeIntentPayloadSchema,
  intent_sha256: Sha256Schema,
}).strict();

export type BatchCandidate = z.infer<typeof BatchCandidateSchema>;
export type BatchUnitResult = z.output<typeof BatchUnitResultSchema>;
export type BatchEvidence = z.infer<typeof BatchEvidenceSchema>;
export type BatchPlanDraft = z.infer<typeof BatchPlanDraftSchema>;
export type BatchResultDraft = z.infer<typeof BatchResultDraftSchema>;
export type StorageJournalObject = z.output<typeof StorageJournalObjectSchema>;
export type StorageIntentObject = z.output<typeof StorageIntentObjectSchema>;
export type StorageUploadClaim = z.output<typeof StorageUploadClaimSchema>;
export type StorageIntentJournal = z.output<typeof StorageIntentJournalSchema>;
export type StorageRollbackJournal = z.output<typeof StorageRollbackJournalSchema>;
export type StorageObjectJournal = z.output<typeof StorageObjectJournalSchema>;
export type StorageUploadClaimJournal = z.output<typeof StorageUploadClaimJournalSchema>;
export type StorageUploadStartedJournal = z.output<typeof StorageUploadStartedJournalSchema>;
export type StorageUploadReconcileReceipt = z.output<typeof StorageUploadReconcileReceiptSchema>;
export type StagingStorageRollbackReceipt = z.output<typeof StagingStorageRollbackReceiptSchema>;
export type StagingRunJournalDescriptor = z.output<typeof StagingRunDescriptorSchema>;
export type StagingFinalizeIntent = z.output<typeof StagingFinalizeIntentSchema>;

export interface CreateStorageRollbackJournalInput {
  runSha256: string;
  batchSha256: string;
  batchIndex: number;
  objects: readonly StorageJournalObject[];
}

export interface CreateStorageIntentJournalInput {
  runSha256: string;
  batchSha256: string;
  batchIndex: number;
  objects: readonly StorageIntentObject[];
}

export interface CreateStorageObjectJournalInput {
  runSha256: string;
  batchSha256: string;
  batchIndex: number;
  objectIndex: number;
  claim: StorageUploadClaim;
  uploadAttempt: number;
  object: StorageJournalObject;
}

export interface CreateStorageUploadClaimJournalInput {
  runSha256: string;
  batchSha256: string;
  batchIndex: number;
  objectIndex: number;
  claim: StorageUploadClaim;
}

export interface CreateStorageUploadStartedJournalInput extends CreateStorageUploadClaimJournalInput {
  uploadAttempt: number;
  startedAt: string;
}

export interface CreateStorageUploadReconcileReceiptInput extends CreateStorageUploadClaimJournalInput {
  previousUploadAttempt: number;
  confirmedNoInflightAt: string;
  reason: string;
}

export interface BeginStorageUploadAttemptInput extends CreateStorageUploadClaimJournalInput {
  startedAt: string;
  freshClaim: boolean;
}

export interface BeginStorageUploadAttemptResult {
  uploadAttempt: number;
  shouldUpload: boolean;
  journalPath: string | null;
}

export function validateStorageUploadClaim(value: unknown): StorageUploadClaim {
  return StorageUploadClaimSchema.parse(value);
}

export interface CreateStagingStorageRollbackReceiptInput {
  targetProjectRef: string;
  runSha256: string;
  fullPlanSha256: string;
  reason: string;
  storageRollbackReceiptSha256: string;
  storageRollbackObjects: readonly StorageIntentObject[];
}

export interface ExecuteStateAwareBatchResult {
  stagingSnapshotSha256: string;
  remoteBatchReceiptSha256: string;
  executionLedgerSha256: string;
  unitResults: readonly CreateBatchUnitResultInput[];
}

export type RunStateAwareBatchesInput = BatchAuthorizationContext & {
  stateDir: string;
  startedAt: string;
  stagingRunSha256: string;
  fullPlanSha256: string;
  manifestSha256: string;
  sourceUniverse: readonly BatchCandidate[];
  executeBatch: (plan: BatchPlanDraft) => Promise<ExecuteStateAwareBatchResult>;
  verifyPersistedBatchReceipt?: (
    plan: BatchPlanDraft,
    remoteBatchReceiptSha256: string,
  ) => Promise<void>;
};

export type InspectCompletedStateAwareBatchesInput = BatchAuthorizationContext & {
  stateDir: string;
  startedAt: string;
  stagingRunSha256: string;
  fullPlanSha256: string;
  manifestSha256: string;
  sourceUniverse: readonly BatchCandidate[];
  verifyPersistedBatchReceipt: (
    plan: BatchPlanDraft,
    remoteBatchReceiptSha256: string,
  ) => Promise<void>;
};

export interface StateAwareBatchRunResult {
  universeEvidence: BatchEvidence;
  universeEvidencePath: string;
  plans: BatchPlanDraft[];
  executionEvidence: BatchEvidence[];
  executionEvidencePaths: string[];
  results: BatchResultDraft[];
  planPaths: string[];
  resultPaths: string[];
  stoppedStatus: BatchResultDraft["payload"]["status"] | null;
}

export interface CreateBatchUnitResultInput {
  unit_id: string;
  outcome: "completed" | "failed";
  extraction_fingerprint: string | null;
  extraction_content_sha256: string | null;
  validation_fingerprint: string | null;
  staged_record_count: number;
  needs_review_count: number;
  staging_review_status: "pending";
  error_code?: string | null;
}

export interface PilotReceiptContext {
  pilotReceipt: FixedEightPassReceipt;
  scoreReportContent: string;
}

export interface LocalPendingOnlyBatchAuthorizationContext {
  authorizationKind: "local_validated_pending_only";
  authorizationSha256: string;
}

export type BatchAuthorizationContext =
  | PilotReceiptContext
  | LocalPendingOnlyBatchAuthorizationContext;

export interface BatchPredecessorEvidence {
  plan: BatchPlanDraft;
  result: BatchResultDraft;
  executionEvidence: BatchEvidence;
  predecessor?: BatchPredecessorEvidence;
}

export type BatchPlanValidationEvidence = BatchAuthorizationContext & {
  universeEvidence: BatchEvidence;
  predecessor?: BatchPredecessorEvidence;
};

export type BatchResultValidationEvidence = BatchPlanValidationEvidence & {
  plan: BatchPlanDraft;
  executionEvidence: BatchEvidence;
};

export interface CreatePendingBatchUniverseEvidenceInput {
  capturedAt: string;
  stagingRunSha256: string;
  fullPlanSha256: string;
  manifestSha256: string;
  sourceUniverse: readonly BatchCandidate[];
}

export interface CreatePendingBatchExecutionEvidenceInput {
  capturedAt: string;
  universeEvidence: BatchEvidence;
  plan: BatchPlanDraft;
  stagingSnapshotSha256: string;
  remoteBatchReceiptSha256: string;
  executionLedgerSha256: string;
  unitResults: readonly CreateBatchUnitResultInput[];
}

export type CreateBlockedBatchPlanDraftInput = BatchPlanValidationEvidence & {
  createdAt: string;
};

export type CreateBlockedBatchResultDraftInput = BatchResultValidationEvidence & {
  completedAt: string;
};

function parsedSourceUniverse(value: readonly BatchCandidate[]): BatchCandidate[] {
  const units = value.map((candidate) => BatchCandidateSchema.parse(candidate));
  if (units.length === 0) throw new Error("batch source universe cannot be empty");
  const ids = units.map((unit) => unit.unit_id);
  if (new Set(ids).size !== ids.length) throw new Error("batch source universe contains duplicate unit IDs");
  return units;
}

function parsedUnitResults(value: readonly CreateBatchUnitResultInput[]): BatchUnitResult[] {
  return value.map((result) => BatchUnitResultSchema.parse({
    ...result,
    error_code: result.error_code ?? null,
  }));
}

function assertOrderedSubset(actual: readonly string[], expected: readonly string[], label: string): void {
  if (new Set(actual).size !== actual.length) throw new Error(`${label} contains duplicate unit IDs`);
  const indexes = new Map(expected.map((unitId, index) => [unitId, index]));
  let lastIndex = -1;
  for (const unitId of actual) {
    const index = indexes.get(unitId);
    if (index === undefined || index <= lastIndex) {
      throw new Error(`${label} must preserve the exact plan order`);
    }
    lastIndex = index;
  }
}

function parsePlanEnvelope(value: unknown): BatchPlanDraft {
  const plan = BatchPlanDraftSchema.parse(value);
  if (canonicalSha256(plan.payload) !== plan.plan_sha256) {
    throw new Error("batch plan SHA-256 does not match its payload");
  }
  return plan;
}

function parseResultEnvelope(value: unknown): BatchResultDraft {
  const result = BatchResultDraftSchema.parse(value);
  if (canonicalSha256(result.payload) !== result.result_sha256) {
    throw new Error("batch result SHA-256 does not match its payload");
  }
  return result;
}

export function validateBatchEvidence(value: unknown): BatchEvidence {
  const evidence = BatchEvidenceSchema.parse(value);
  if (canonicalSha256(evidence.payload) !== evidence.evidence_sha256) {
    throw new Error("batch evidence SHA-256 does not match its payload");
  }
  if (evidence.payload.scope === "universe") {
    parsedSourceUniverse(evidence.payload.source_universe);
  }
  return evidence;
}

function universeEvidence(value: unknown): BatchEvidence & {
  payload: z.infer<typeof UniverseEvidencePayloadSchema>;
} {
  const evidence = validateBatchEvidence(value);
  if (evidence.payload.scope !== "universe") throw new Error("universe batch evidence is required");
  return evidence as BatchEvidence & { payload: z.infer<typeof UniverseEvidencePayloadSchema> };
}

function executionEvidence(value: unknown): BatchEvidence & {
  payload: z.infer<typeof ExecutionEvidencePayloadSchema>;
} {
  const evidence = validateBatchEvidence(value);
  if (evidence.payload.scope !== "execution") throw new Error("execution batch evidence is required");
  return evidence as BatchEvidence & { payload: z.infer<typeof ExecutionEvidencePayloadSchema> };
}

export function createPendingBatchUniverseEvidence(
  input: CreatePendingBatchUniverseEvidenceInput,
): BatchEvidence {
  const payload = UniverseEvidencePayloadSchema.parse({
    scope: "universe",
    captured_at: input.capturedAt,
    operational: true,
    derivation_status: "state_aware_runner",
    staging_run_sha256: input.stagingRunSha256,
    full_plan_sha256: input.fullPlanSha256,
    manifest_sha256: input.manifestSha256,
    source_universe: parsedSourceUniverse(input.sourceUniverse),
  });
  return {
    schema_version: 2,
    kind: "vendor_ingest_batch_evidence",
    payload,
    evidence_sha256: canonicalSha256(payload),
  };
}

export function createPendingBatchExecutionEvidence(
  input: CreatePendingBatchExecutionEvidenceInput,
): BatchEvidence {
  const universe = universeEvidence(input.universeEvidence);
  const plan = parsePlanEnvelope(input.plan);
  if (plan.payload.universe_evidence_sha256 !== universe.evidence_sha256) {
    throw new Error("execution evidence plan belongs to a different universe evidence object");
  }
  const results = parsedUnitResults(input.unitResults);
  assertOrderedSubset(
    results.map((result) => result.unit_id),
    plan.payload.units.map((unit) => unit.unit_id),
    "execution evidence unit results",
  );
  const payload = ExecutionEvidencePayloadSchema.parse({
    scope: "execution",
    captured_at: input.capturedAt,
    operational: true,
    derivation_status: "state_aware_runner",
    universe_evidence_sha256: universe.evidence_sha256,
    plan_sha256: plan.plan_sha256,
    staging_snapshot_sha256: input.stagingSnapshotSha256,
    remote_batch_receipt_sha256: input.remoteBatchReceiptSha256,
    execution_ledger_sha256: input.executionLedgerSha256,
    unit_results: results,
  });
  return {
    schema_version: 2,
    kind: "vendor_ingest_batch_evidence",
    payload,
    evidence_sha256: canonicalSha256(payload),
  };
}

export function evaluateNeedsReviewSpike(
  current: z.infer<typeof ReviewMetricsSchema>,
  previous?: z.infer<typeof ReviewMetricsSchema>,
): z.infer<typeof ReviewEvaluationSchema> {
  const currentMetrics = ReviewMetricsSchema.parse(current);
  const previousMetrics = previous === undefined ? undefined : ReviewMetricsSchema.parse(previous);
  if (currentMetrics.staged_record_count === 0 || previousMetrics?.staged_record_count === 0) {
    return {
      decision: "stop",
      reason: "invalid_denominator",
      current_cross_product: null,
      doubled_previous_cross_product: null,
    };
  }
  if (!previousMetrics) {
    return {
      decision: "baseline",
      reason: "first_batch_baseline",
      current_cross_product: null,
      doubled_previous_cross_product: null,
    };
  }
  if (previousMetrics.needs_review_count === 0) {
    return currentMetrics.needs_review_count > 0
      ? {
        decision: "stop",
        reason: "zero_baseline_increase",
        current_cross_product: null,
        doubled_previous_cross_product: null,
      }
      : {
        decision: "continue",
        reason: "below_double",
        current_cross_product: "0",
        doubled_previous_cross_product: "0",
      };
  }
  const currentCrossProduct = BigInt(currentMetrics.needs_review_count)
    * BigInt(previousMetrics.staged_record_count);
  const doubledPreviousCrossProduct = 2n
    * BigInt(previousMetrics.needs_review_count)
    * BigInt(currentMetrics.staged_record_count);
  const stop = currentCrossProduct >= doubledPreviousCrossProduct;
  return {
    decision: stop ? "stop" : "continue",
    reason: stop ? "at_least_double" : "below_double",
    current_cross_product: currentCrossProduct.toString(),
    doubled_previous_cross_product: doubledPreviousCrossProduct.toString(),
  };
}

export function batchAuthorizationBinding(
  context: BatchAuthorizationContext,
): { kind: "paid_pilot_gate" | "local_validated_pending_only"; sha256: string } {
  if ("pilotReceipt" in context) {
    const receipt = validateFixedEightPassReceipt(
      context.pilotReceipt,
      { scoreReportContent: context.scoreReportContent },
    );
    return { kind: "paid_pilot_gate", sha256: receipt.receipt_sha256 };
  }
  if (
    context.authorizationKind !== "local_validated_pending_only"
    || !/^[a-f0-9]{64}$/u.test(context.authorizationSha256)
  ) {
    throw new Error("invalid local pending-only batch authorization");
  }
  return { kind: context.authorizationKind, sha256: context.authorizationSha256 };
}

function validatePredecessor(
  evidence: BatchPredecessorEvidence | undefined,
  context: BatchAuthorizationContext & { universeEvidence: BatchEvidence },
): BatchResultDraft | undefined {
  if (!evidence) return undefined;
  return validateBatchResultDraft(evidence.result, {
    ...context,
    plan: evidence.plan,
    executionEvidence: evidence.executionEvidence,
    predecessor: evidence.predecessor,
  });
}

export function validateBatchPlanDraft(
  value: unknown,
  evidence: BatchPlanValidationEvidence,
): BatchPlanDraft {
  const authorization = batchAuthorizationBinding(evidence);
  const universe = universeEvidence(evidence.universeEvidence);
  const sourceUniverse = parsedSourceUniverse(universe.payload.source_universe);
  const plan = parsePlanEnvelope(value);
  if (
    plan.payload.authorization_kind !== authorization.kind
    || plan.payload.authorization_sha256 !== authorization.sha256
    || plan.payload.universe_evidence_sha256 !== universe.evidence_sha256
    || plan.payload.source_universe_sha256 !== canonicalSha256(sourceUniverse)
    || plan.payload.source_universe_count !== sourceUniverse.length
    || canonicalSha256(plan.payload.source_universe) !== canonicalSha256(sourceUniverse)
  ) {
    throw new Error("batch plan does not match its receipt or universe evidence");
  }
  const predecessor = validatePredecessor(evidence.predecessor, {
    ...evidence,
    universeEvidence: universe,
  });
  let completedBefore: string[] = [];
  if (!predecessor) {
    if (plan.payload.batch_index !== 1 || plan.payload.previous_result_sha256 !== null) {
      throw new Error("first batch plan must have index 1 and no predecessor result");
    }
  } else {
    if (predecessor.payload.status !== "pass") {
      throw new Error(`previous batch result is not eligible to continue: ${predecessor.payload.status}`);
    }
    if (
      plan.payload.previous_result_sha256 !== predecessor.result_sha256
      || plan.payload.batch_index !== predecessor.payload.batch_index + 1
      || predecessor.payload.authorization_kind !== authorization.kind
      || predecessor.payload.authorization_sha256 !== authorization.sha256
      || predecessor.payload.universe_evidence_sha256 !== universe.evidence_sha256
      || predecessor.payload.source_universe_sha256 !== canonicalSha256(sourceUniverse)
    ) {
      throw new Error("batch plan predecessor is not adjacent or belongs to different evidence");
    }
    completedBefore = predecessor.payload.cumulative_completed_unit_ids;
  }
  const expectedPrefix = sourceUniverse.slice(0, completedBefore.length).map((unit) => unit.unit_id);
  if (canonicalSha256(completedBefore) !== canonicalSha256(expectedPrefix)) {
    throw new Error("previous completed units are not the exact source-universe prefix");
  }
  const remaining = sourceUniverse.slice(completedBefore.length);
  if (remaining.length === 0) throw new Error("no eligible units remain for this batch plan");
  const expectedUnits = remaining.slice(0, 25);
  if (
    plan.payload.completed_before_count !== completedBefore.length
    || plan.payload.remaining_before_count !== remaining.length
    || plan.payload.remaining_after_count !== remaining.length - expectedUnits.length
    || plan.payload.final_tail !== (remaining.length < 25)
    || canonicalSha256(plan.payload.units) !== canonicalSha256(expectedUnits)
  ) {
    throw new Error("batch plan is not the exact deterministic source-universe slice");
  }
  return plan;
}

export function createBlockedBatchPlanDraft(
  input: CreateBlockedBatchPlanDraftInput,
): BatchPlanDraft {
  const authorization = batchAuthorizationBinding(input);
  const universe = universeEvidence(input.universeEvidence);
  const sourceUniverse = parsedSourceUniverse(universe.payload.source_universe);
  const predecessor = validatePredecessor(input.predecessor, input);
  if (predecessor && predecessor.payload.status !== "pass") {
    throw new Error(`previous batch result is not eligible to continue: ${predecessor.payload.status}`);
  }
  const completedBefore = predecessor?.payload.cumulative_completed_unit_ids ?? [];
  const remaining = sourceUniverse.slice(completedBefore.length);
  if (remaining.length === 0) throw new Error("no eligible units remain for another batch plan");
  const selected = remaining.slice(0, 25);
  const payload = BatchPlanPayloadSchema.parse({
    created_at: input.createdAt,
    operational_status: "state_aware_runner",
    batch_index: (predecessor?.payload.batch_index ?? 0) + 1,
    authorization_kind: authorization.kind,
    authorization_sha256: authorization.sha256,
    universe_evidence_sha256: universe.evidence_sha256,
    source_universe_sha256: canonicalSha256(sourceUniverse),
    source_universe_count: sourceUniverse.length,
    source_universe: sourceUniverse,
    previous_result_sha256: predecessor?.result_sha256 ?? null,
    completed_before_count: completedBefore.length,
    remaining_before_count: remaining.length,
    remaining_after_count: remaining.length - selected.length,
    final_tail: remaining.length < 25,
    units: selected,
  });
  return validateBatchPlanDraft({
    schema_version: 2,
    kind: "vendor_ingest_batch_plan_draft",
    payload,
    plan_sha256: canonicalSha256(payload),
  }, input);
}

function derivedResultStatus(
  unitResults: readonly BatchUnitResult[],
  plannedUnitIds: readonly string[],
  reviewDecision: z.infer<typeof ReviewEvaluationSchema>["decision"],
): z.infer<typeof BatchResultPayloadSchema>["status"] {
  const unitIds = unitResults.map((unit) => unit.unit_id);
  const completeSet = unitIds.length === plannedUnitIds.length
    && unitIds.every((unitId, index) => unitId === plannedUnitIds[index]);
  if (!completeSet) return "incomplete";
  if (unitResults.some((unit) => unit.outcome === "failed")) return "failed";
  return reviewDecision === "stop" ? "review_spike" : "pass";
}

export function validateBatchResultDraft(
  value: unknown,
  evidence: BatchResultValidationEvidence,
): BatchResultDraft {
  const plan = validateBatchPlanDraft(evidence.plan, evidence);
  const authorization = batchAuthorizationBinding(evidence);
  const universe = universeEvidence(evidence.universeEvidence);
  const execution = executionEvidence(evidence.executionEvidence);
  const result = parseResultEnvelope(value);
  if (
    execution.payload.universe_evidence_sha256 !== universe.evidence_sha256
    || execution.payload.plan_sha256 !== plan.plan_sha256
    || result.payload.execution_evidence_sha256 !== execution.evidence_sha256
    || result.payload.universe_evidence_sha256 !== universe.evidence_sha256
    || result.payload.plan_sha256 !== plan.plan_sha256
    || result.payload.authorization_kind !== authorization.kind
    || result.payload.authorization_sha256 !== authorization.sha256
    || result.payload.source_universe_sha256 !== plan.payload.source_universe_sha256
    || result.payload.batch_index !== plan.payload.batch_index
  ) {
    throw new Error("batch result does not match its exact plan, receipt, universe, or execution evidence");
  }
  const predecessor = validatePredecessor(evidence.predecessor, evidence);
  const expectedPreviousHash = predecessor?.result_sha256 ?? null;
  const expectedPreviousMetrics = predecessor?.payload.review_metrics ?? null;
  const expectedCompletedBefore = predecessor?.payload.cumulative_completed_unit_ids ?? [];
  if (
    result.payload.previous_result_sha256 !== expectedPreviousHash
    || canonicalSha256(result.payload.previous_review_metrics) !== canonicalSha256(expectedPreviousMetrics)
    || canonicalSha256(result.payload.completed_before_unit_ids) !== canonicalSha256(expectedCompletedBefore)
    || plan.payload.previous_result_sha256 !== expectedPreviousHash
  ) {
    throw new Error("batch result predecessor, adjacency, or completed prefix evidence does not match");
  }
  const unitResults = execution.payload.unit_results;
  const plannedUnitIds = plan.payload.units.map((unit) => unit.unit_id);
  assertOrderedSubset(unitResults.map((unit) => unit.unit_id), plannedUnitIds, "batch result units");
  if (
    canonicalSha256(result.payload.unit_results) !== canonicalSha256(unitResults)
    || canonicalSha256(result.payload.planned_unit_ids) !== canonicalSha256(plannedUnitIds)
  ) {
    throw new Error("batch result rows do not match immutable execution evidence or plan");
  }
  const reviewMetrics = {
    staged_record_count: unitResults.reduce((sum, unit) => sum + unit.staged_record_count, 0),
    needs_review_count: unitResults.reduce((sum, unit) => sum + unit.needs_review_count, 0),
  };
  const reviewEvaluation = evaluateNeedsReviewSpike(
    reviewMetrics,
    expectedPreviousMetrics ?? undefined,
  );
  const expectedStatus = derivedResultStatus(unitResults, plannedUnitIds, reviewEvaluation.decision);
  const expectedCumulative = [
    ...expectedCompletedBefore,
    ...unitResults.filter((unit) => unit.outcome === "completed").map((unit) => unit.unit_id),
  ];
  if (
    canonicalSha256(result.payload.review_metrics) !== canonicalSha256(reviewMetrics)
    || canonicalSha256(result.payload.review_evaluation) !== canonicalSha256(reviewEvaluation)
    || result.payload.status !== expectedStatus
    || canonicalSha256(result.payload.cumulative_completed_unit_ids) !== canonicalSha256(expectedCumulative)
  ) {
    throw new Error("batch result status, ratios, or cumulative IDs do not match derived evidence");
  }
  return result;
}

export function createBlockedBatchResultDraft(
  input: CreateBlockedBatchResultDraftInput,
): BatchResultDraft {
  const plan = validateBatchPlanDraft(input.plan, input);
  const authorization = batchAuthorizationBinding(input);
  const universe = universeEvidence(input.universeEvidence);
  const execution = executionEvidence(input.executionEvidence);
  if (
    execution.payload.universe_evidence_sha256 !== universe.evidence_sha256
    || execution.payload.plan_sha256 !== plan.plan_sha256
  ) {
    throw new Error("execution evidence does not belong to the exact plan and universe evidence");
  }
  const predecessor = validatePredecessor(input.predecessor, input);
  const previousMetrics = predecessor?.payload.review_metrics;
  const completedBefore = predecessor?.payload.cumulative_completed_unit_ids ?? [];
  const unitResults = execution.payload.unit_results;
  const plannedUnitIds = plan.payload.units.map((unit) => unit.unit_id);
  const reviewMetrics = {
    staged_record_count: unitResults.reduce((sum, unit) => sum + unit.staged_record_count, 0),
    needs_review_count: unitResults.reduce((sum, unit) => sum + unit.needs_review_count, 0),
  };
  const reviewEvaluation = evaluateNeedsReviewSpike(reviewMetrics, previousMetrics);
  const status = derivedResultStatus(unitResults, plannedUnitIds, reviewEvaluation.decision);
  const cumulativeCompletedUnitIds = [
    ...completedBefore,
    ...unitResults.filter((unit) => unit.outcome === "completed").map((unit) => unit.unit_id),
  ];
  const payload = BatchResultPayloadSchema.parse({
    completed_at: input.completedAt,
    operational_status: "state_aware_runner",
    batch_index: plan.payload.batch_index,
    plan_sha256: plan.plan_sha256,
    authorization_kind: authorization.kind,
    authorization_sha256: authorization.sha256,
    universe_evidence_sha256: universe.evidence_sha256,
    execution_evidence_sha256: execution.evidence_sha256,
    source_universe_sha256: plan.payload.source_universe_sha256,
    previous_result_sha256: predecessor?.result_sha256 ?? null,
    previous_review_metrics: previousMetrics ?? null,
    completed_before_unit_ids: completedBefore,
    planned_unit_ids: plannedUnitIds,
    status,
    unit_results: unitResults,
    cumulative_completed_unit_ids: cumulativeCompletedUnitIds,
    review_metrics: reviewMetrics,
    review_evaluation: reviewEvaluation,
  });
  return validateBatchResultDraft({
    schema_version: 2,
    kind: "vendor_ingest_batch_result_draft",
    payload,
    result_sha256: canonicalSha256(payload),
  }, input);
}

export async function writeBatchPlanDraft(
  stateDir: string,
  value: unknown,
  evidence: BatchPlanValidationEvidence,
): Promise<string> {
  const plan = validateBatchPlanDraft(value, evidence);
  const universe = universeEvidence(evidence.universeEvidence);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      "runs",
      universe.payload.full_plan_sha256,
      `batch-${String(plan.payload.batch_index).padStart(4, "0")}-plan.json`,
    ),
    plan,
  );
}

export function validateStagingRunDescriptor(value: unknown): StagingRunJournalDescriptor {
  const descriptor = StagingRunDescriptorSchema.parse(value);
  const { run_sha256: _runSha256, ...payload } = descriptor;
  if (canonicalSha256(payload) !== descriptor.run_sha256) {
    throw new Error("staging run SHA-256 does not match its immutable descriptor");
  }
  return descriptor;
}

export async function writeStagingRunDescriptor(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const descriptor = validateStagingRunDescriptor(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join("batch-journal", "runs", descriptor.full_plan_sha256, "run.json"),
    descriptor,
  );
}

export async function readStagingRunDescriptor(
  stateDir: string,
  fullPlanSha256: string,
): Promise<StagingRunJournalDescriptor | null> {
  Sha256Schema.parse(fullPlanSha256);
  const descriptor = await readOptionalBatchJournalArtifact(
    stateDir,
    path.join("batch-journal", "runs", fullPlanSha256, "run.json"),
    validateStagingRunDescriptor,
  );
  if (descriptor && descriptor.full_plan_sha256 !== fullPlanSha256) {
    throw new Error("staging run descriptor full plan does not match its requested journal path");
  }
  return descriptor;
}

export function createStagingStorageRollbackReceipt(
  input: CreateStagingStorageRollbackReceiptInput,
): StagingStorageRollbackReceipt {
  const storageRollbackObjects = input.storageRollbackObjects
    .map((object) => StorageIntentObjectSchema.parse(object))
    .sort((left, right) =>
      `${left.bucket}\0${left.object_key}`.localeCompare(`${right.bucket}\0${right.object_key}`)
    );
  const payload = StagingStorageRollbackReceiptPayloadSchema.parse({
    target_project_ref: input.targetProjectRef,
    run_sha256: input.runSha256,
    full_plan_sha256: input.fullPlanSha256,
    reason: input.reason.trim(),
    storage_rollback_receipt_sha256: input.storageRollbackReceiptSha256,
    storage_rollback_objects: storageRollbackObjects,
  });
  return StagingStorageRollbackReceiptSchema.parse({
    schema_version: 1,
    kind: "vendor_disclosure_storage_rollback_receipt",
    payload,
    artifact_sha256: canonicalSha256(payload),
  });
}

export function validateStagingStorageRollbackReceipt(
  value: unknown,
): StagingStorageRollbackReceipt {
  const receipt = StagingStorageRollbackReceiptSchema.parse(value);
  if (canonicalSha256(receipt.payload) !== receipt.artifact_sha256) {
    throw new Error("staging Storage rollback receipt SHA-256 does not match its payload");
  }
  return receipt;
}

export async function writeStagingStorageRollbackReceipt(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const receipt = validateStagingStorageRollbackReceipt(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      "runs",
      receipt.payload.full_plan_sha256,
      "storage-rollback-receipt.json",
    ),
    receipt,
  );
}

export async function readStagingStorageRollbackReceipt(
  stateDir: string,
  fullPlanSha256: string,
): Promise<StagingStorageRollbackReceipt | null> {
  Sha256Schema.parse(fullPlanSha256);
  const receipt = await readOptionalBatchJournalArtifact(
    stateDir,
    path.join("batch-journal", "runs", fullPlanSha256, "storage-rollback-receipt.json"),
    validateStagingStorageRollbackReceipt,
  );
  if (receipt && receipt.payload.full_plan_sha256 !== fullPlanSha256) {
    throw new Error("staging Storage rollback receipt belongs to another full plan");
  }
  return receipt;
}

export function createStagingFinalizeIntent(input: {
  targetProjectRef: string;
  runSha256: string;
  fullPlanSha256: string;
  authorizationSha256: string;
  dedupeCandidatesSha256: string;
  completedBatchSha256s: readonly string[];
}): StagingFinalizeIntent {
  const payload = StagingFinalizeIntentPayloadSchema.parse({
    target_project_ref: input.targetProjectRef,
    run_sha256: input.runSha256,
    full_plan_sha256: input.fullPlanSha256,
    authorization_sha256: input.authorizationSha256,
    dedupe_candidates_sha256: input.dedupeCandidatesSha256,
    completed_batch_sha256s: input.completedBatchSha256s,
  });
  return StagingFinalizeIntentSchema.parse({
    schema_version: 1,
    kind: "vendor_disclosure_staging_finalize_intent",
    payload,
    intent_sha256: canonicalSha256(payload),
  });
}

export function validateStagingFinalizeIntent(value: unknown): StagingFinalizeIntent {
  const intent = StagingFinalizeIntentSchema.parse(value);
  if (canonicalSha256(intent.payload) !== intent.intent_sha256) {
    throw new Error("staging finalize intent SHA-256 does not match its immutable payload");
  }
  return intent;
}

export async function writeStagingFinalizeIntent(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const intent = validateStagingFinalizeIntent(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      "runs",
      intent.payload.full_plan_sha256,
      "finalize-intent.json",
    ),
    intent,
  );
}

export async function readStagingFinalizeIntent(
  stateDir: string,
  fullPlanSha256: string,
): Promise<StagingFinalizeIntent | null> {
  Sha256Schema.parse(fullPlanSha256);
  const intent = await readOptionalBatchJournalArtifact(
    stateDir,
    path.join("batch-journal", "runs", fullPlanSha256, "finalize-intent.json"),
    validateStagingFinalizeIntent,
  );
  if (intent && intent.payload.full_plan_sha256 !== fullPlanSha256) {
    throw new Error("staging finalize intent full plan does not match its requested journal path");
  }
  return intent;
}

export async function writeBatchUniverseEvidence(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const universe = universeEvidence(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join("batch-journal", "runs", universe.payload.full_plan_sha256, "universe.json"),
    universe,
  );
}

function validateExecutionForPlan(
  value: unknown,
  universeValue: BatchEvidence,
  planValue: BatchPlanDraft,
): BatchEvidence {
  const universe = universeEvidence(universeValue);
  const plan = parsePlanEnvelope(planValue);
  const execution = executionEvidence(value);
  if (
    execution.payload.universe_evidence_sha256 !== universe.evidence_sha256
    || execution.payload.plan_sha256 !== plan.plan_sha256
    || plan.payload.universe_evidence_sha256 !== universe.evidence_sha256
  ) {
    throw new Error("execution evidence does not belong to the exact persisted universe and batch plan");
  }
  return execution;
}

export async function writeBatchExecutionEvidence(
  stateDir: string,
  value: unknown,
  evidence: { universeEvidence: BatchEvidence; plan: BatchPlanDraft },
): Promise<string> {
  const execution = validateExecutionForPlan(value, evidence.universeEvidence, evidence.plan);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      "runs",
      universeEvidence(evidence.universeEvidence).payload.full_plan_sha256,
      `batch-${String(evidence.plan.payload.batch_index).padStart(4, "0")}-execution.json`,
    ),
    execution,
  );
}

export async function writeBatchResultDraft(
  stateDir: string,
  value: unknown,
  evidence: BatchResultValidationEvidence,
): Promise<string> {
  const result = validateBatchResultDraft(value, evidence);
  const universe = universeEvidence(evidence.universeEvidence);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      "runs",
      universe.payload.full_plan_sha256,
      `batch-${String(result.payload.batch_index).padStart(4, "0")}-result.json`,
    ),
    result,
  );
}

function deterministicRunTimestamp(startedAt: string, batchIndex: number, phase: number): string {
  const base = Date.parse(startedAt);
  if (!Number.isFinite(base)) throw new Error("state-aware batch run startedAt must be an ISO timestamp");
  return new Date(base + (((batchIndex - 1) * 3 + phase) * 1_000)).toISOString();
}

async function readOptionalBatchJournalArtifact<T>(
  stateDir: string,
  relativePath: string,
  validate: (value: unknown) => T,
): Promise<T | null> {
  const artifactPath = path.join(path.resolve(stateDir), relativePath);
  try {
    const verifiedPath = await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath,
      expectedRelativePath: relativePath,
    });
    return validate(JSON.parse(await readFile(verifiedPath, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function runStateAwareBatches(
  input: RunStateAwareBatchesInput,
): Promise<StateAwareBatchRunResult> {
  const startedAt = new Date(input.startedAt).toISOString();
  const authorizationContext: BatchAuthorizationContext = "pilotReceipt" in input
    ? { pilotReceipt: input.pilotReceipt, scoreReportContent: input.scoreReportContent }
    : {
      authorizationKind: input.authorizationKind,
      authorizationSha256: input.authorizationSha256,
    };
  const universe = createPendingBatchUniverseEvidence({
    capturedAt: startedAt,
    stagingRunSha256: input.stagingRunSha256,
    fullPlanSha256: input.fullPlanSha256,
    manifestSha256: input.manifestSha256,
    sourceUniverse: input.sourceUniverse,
  });
  const universeEvidencePath = await writeBatchUniverseEvidence(input.stateDir, universe);
  const plans: BatchPlanDraft[] = [];
  const executions: BatchEvidence[] = [];
  const results: BatchResultDraft[] = [];
  const planPaths: string[] = [];
  const executionEvidencePaths: string[] = [];
  const resultPaths: string[] = [];
  let predecessor: BatchPredecessorEvidence | undefined;
  let stoppedStatus: BatchResultDraft["payload"]["status"] | null = null;

  while ((predecessor?.result.payload.cumulative_completed_unit_ids.length ?? 0) < input.sourceUniverse.length) {
    const batchIndex = (predecessor?.result.payload.batch_index ?? 0) + 1;
    const plan = createBlockedBatchPlanDraft({
      createdAt: deterministicRunTimestamp(startedAt, batchIndex, 0),
      ...authorizationContext,
      universeEvidence: universe,
      predecessor,
    });
    const planPath = await writeBatchPlanDraft(input.stateDir, plan, {
      ...authorizationContext,
      universeEvidence: universe,
      predecessor,
    });
    const executionRelativePath = path.join(
      "batch-journal",
      "runs",
      input.fullPlanSha256,
      `batch-${String(batchIndex).padStart(4, "0")}-execution.json`,
    );
    let execution = await readOptionalBatchJournalArtifact(
      input.stateDir,
      executionRelativePath,
      (value) => validateExecutionForPlan(value, universe, plan),
    );
    if (execution) {
      if (!input.verifyPersistedBatchReceipt) {
        throw new Error("remote batch receipt verification is required before reusing local execution evidence");
      }
      await input.verifyPersistedBatchReceipt(
        plan,
        execution.payload.scope === "execution"
          ? execution.payload.remote_batch_receipt_sha256
          : "",
      );
    } else {
      const executionResult = await input.executeBatch(plan);
      execution = createPendingBatchExecutionEvidence({
        capturedAt: deterministicRunTimestamp(startedAt, batchIndex, 1),
        universeEvidence: universe,
        plan,
        stagingSnapshotSha256: executionResult.stagingSnapshotSha256,
        remoteBatchReceiptSha256: executionResult.remoteBatchReceiptSha256,
        executionLedgerSha256: executionResult.executionLedgerSha256,
        unitResults: executionResult.unitResults,
      });
    }
    const executionPath = await writeBatchExecutionEvidence(input.stateDir, execution, {
      universeEvidence: universe,
      plan,
    });
    const result = createBlockedBatchResultDraft({
      completedAt: deterministicRunTimestamp(startedAt, batchIndex, 2),
      ...authorizationContext,
      universeEvidence: universe,
      plan,
      executionEvidence: execution,
      predecessor,
    });
    const resultPath = await writeBatchResultDraft(input.stateDir, result, {
      ...authorizationContext,
      universeEvidence: universe,
      plan,
      executionEvidence: execution,
      predecessor,
    });
    plans.push(plan);
    executions.push(execution);
    results.push(result);
    planPaths.push(planPath);
    executionEvidencePaths.push(executionPath);
    resultPaths.push(resultPath);
    if (result.payload.status !== "pass") {
      stoppedStatus = result.payload.status;
      break;
    }
    predecessor = { plan, result, executionEvidence: execution, predecessor };
  }
  return {
    universeEvidence: universe,
    universeEvidencePath,
    plans,
    executionEvidence: executions,
    executionEvidencePaths,
    results,
    planPaths,
    resultPaths,
    stoppedStatus,
  };
}

/**
 * Replays only immutable local evidence and remote receipt checks. Unlike the
 * apply runner, this function has no callback capable of creating a missing
 * batch, so a finalize command cannot accidentally continue an incomplete load.
 */
export async function inspectCompletedStateAwareBatches(
  input: InspectCompletedStateAwareBatchesInput,
): Promise<StateAwareBatchRunResult> {
  const startedAt = new Date(input.startedAt).toISOString();
  const authorizationContext: BatchAuthorizationContext = "pilotReceipt" in input
    ? { pilotReceipt: input.pilotReceipt, scoreReportContent: input.scoreReportContent }
    : {
      authorizationKind: input.authorizationKind,
      authorizationSha256: input.authorizationSha256,
    };
  const expectedUniverse = createPendingBatchUniverseEvidence({
    capturedAt: startedAt,
    stagingRunSha256: input.stagingRunSha256,
    fullPlanSha256: input.fullPlanSha256,
    manifestSha256: input.manifestSha256,
    sourceUniverse: input.sourceUniverse,
  });
  const universeRelativePath = path.join(
    "batch-journal",
    "runs",
    input.fullPlanSha256,
    "universe.json",
  );
  const universe = await readOptionalBatchJournalArtifact(
    input.stateDir,
    universeRelativePath,
    universeEvidence,
  );
  if (!universe || !isDeepStrictEqual(universe, expectedUniverse)) {
    throw new Error("staging batch journal is incomplete or belongs to another immutable universe");
  }

  const plans: BatchPlanDraft[] = [];
  const executions: BatchEvidence[] = [];
  const results: BatchResultDraft[] = [];
  const planPaths: string[] = [];
  const executionEvidencePaths: string[] = [];
  const resultPaths: string[] = [];
  let predecessor: BatchPredecessorEvidence | undefined;

  while ((predecessor?.result.payload.cumulative_completed_unit_ids.length ?? 0) < input.sourceUniverse.length) {
    const batchIndex = (predecessor?.result.payload.batch_index ?? 0) + 1;
    const expectedPlan = createBlockedBatchPlanDraft({
      createdAt: deterministicRunTimestamp(startedAt, batchIndex, 0),
      ...authorizationContext,
      universeEvidence: universe,
      predecessor,
    });
    const planRelativePath = path.join(
      "batch-journal",
      "runs",
      input.fullPlanSha256,
      `batch-${String(batchIndex).padStart(4, "0")}-plan.json`,
    );
    const plan = await readOptionalBatchJournalArtifact(
      input.stateDir,
      planRelativePath,
      (value) => validateBatchPlanDraft(value, {
        ...authorizationContext,
        universeEvidence: universe,
        predecessor,
      }),
    );
    if (!plan || !isDeepStrictEqual(plan, expectedPlan)) {
      throw new Error(`staging batch journal is incomplete at batch ${batchIndex} plan`);
    }

    const executionRelativePath = path.join(
      "batch-journal",
      "runs",
      input.fullPlanSha256,
      `batch-${String(batchIndex).padStart(4, "0")}-execution.json`,
    );
    const execution = await readOptionalBatchJournalArtifact(
      input.stateDir,
      executionRelativePath,
      (value) => validateExecutionForPlan(value, universe, plan),
    );
    if (!execution || execution.payload.scope !== "execution") {
      throw new Error(`staging batch journal is incomplete at batch ${batchIndex} execution`);
    }
    await input.verifyPersistedBatchReceipt(
      plan,
      execution.payload.remote_batch_receipt_sha256,
    );

    const expectedResult = createBlockedBatchResultDraft({
      completedAt: deterministicRunTimestamp(startedAt, batchIndex, 2),
      ...authorizationContext,
      universeEvidence: universe,
      plan,
      executionEvidence: execution,
      predecessor,
    });
    const resultRelativePath = path.join(
      "batch-journal",
      "runs",
      input.fullPlanSha256,
      `batch-${String(batchIndex).padStart(4, "0")}-result.json`,
    );
    const result = await readOptionalBatchJournalArtifact(
      input.stateDir,
      resultRelativePath,
      (value) => validateBatchResultDraft(value, {
        ...authorizationContext,
        universeEvidence: universe,
        plan,
        executionEvidence: execution,
        predecessor,
      }),
    );
    if (!result || !isDeepStrictEqual(result, expectedResult)) {
      throw new Error(`staging batch journal is incomplete at batch ${batchIndex} result`);
    }
    if (result.payload.status !== "pass") {
      throw new Error(`staging batch journal is not finalizable: ${result.payload.status}`);
    }

    plans.push(plan);
    executions.push(execution);
    results.push(result);
    planPaths.push(path.join(path.resolve(input.stateDir), planRelativePath));
    executionEvidencePaths.push(path.join(path.resolve(input.stateDir), executionRelativePath));
    resultPaths.push(path.join(path.resolve(input.stateDir), resultRelativePath));
    predecessor = { plan, result, executionEvidence: execution, predecessor };
  }

  const completedIds = results.at(-1)?.payload.cumulative_completed_unit_ids ?? [];
  if (!isDeepStrictEqual(completedIds, input.sourceUniverse.map((unit) => unit.unit_id))) {
    throw new Error("staging batch journal does not complete the exact immutable source universe");
  }
  return {
    universeEvidence: universe,
    universeEvidencePath: path.join(path.resolve(input.stateDir), universeRelativePath),
    plans,
    executionEvidence: executions,
    executionEvidencePaths,
    results,
    planPaths,
    resultPaths,
    stoppedStatus: null,
  };
}

export function createStorageRollbackJournal(
  input: CreateStorageRollbackJournalInput,
): StorageRollbackJournal {
  const objects = input.objects.map((object) => StorageJournalObjectSchema.parse(object));
  const payload = StorageRollbackJournalPayloadSchema.parse({
    run_sha256: input.runSha256,
    batch_sha256: input.batchSha256,
    batch_index: input.batchIndex,
    objects,
    rollback_objects: objects.filter((object) => object.created),
  });
  return StorageRollbackJournalSchema.parse({
    schema_version: 1,
    kind: "vendor_ingest_storage_rollback_journal",
    payload,
    journal_sha256: canonicalSha256(payload),
  });
}

export function createStorageIntentJournal(
  input: CreateStorageIntentJournalInput,
): StorageIntentJournal {
  const objects = input.objects.map((object) => StorageIntentObjectSchema.parse(object));
  const payload = StorageIntentJournalPayloadSchema.parse({
    run_sha256: input.runSha256,
    batch_sha256: input.batchSha256,
    batch_index: input.batchIndex,
    objects,
  });
  return StorageIntentJournalSchema.parse({
    schema_version: 1,
    kind: "vendor_ingest_storage_intent_journal",
    payload,
    journal_sha256: canonicalSha256(payload),
  });
}

export function createStorageObjectJournal(
  input: CreateStorageObjectJournalInput,
): StorageObjectJournal {
  const payload = StorageObjectJournalPayloadSchema.parse({
    run_sha256: input.runSha256,
    batch_sha256: input.batchSha256,
    batch_index: input.batchIndex,
    object_index: input.objectIndex,
    claim: input.claim,
    upload_attempt: input.uploadAttempt,
    object: input.object,
  });
  return StorageObjectJournalSchema.parse({
    schema_version: 1,
    kind: "vendor_ingest_storage_object_journal",
    payload,
    journal_sha256: canonicalSha256(payload),
  });
}

export function validateStorageObjectJournal(value: unknown): StorageObjectJournal {
  const journal = StorageObjectJournalSchema.parse(value);
  if (canonicalSha256(journal.payload) !== journal.journal_sha256) {
    throw new Error("storage object journal SHA-256 does not match its payload");
  }
  return journal;
}

export async function writeStorageObjectJournal(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const journal = validateStorageObjectJournal(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      journal.payload.run_sha256,
      `batch-${String(journal.payload.batch_index).padStart(4, "0")}-storage-object-${String(journal.payload.object_index).padStart(4, "0")}-epoch-${String(journal.payload.claim.claim_epoch).padStart(4, "0")}.json`,
    ),
    journal,
  );
}

export async function readStorageObjectJournals(
  stateDir: string,
  runSha256: string,
): Promise<StorageObjectJournal[]> {
  Sha256Schema.parse(runSha256);
  const relativeDirectory = path.join("batch-journal", runSha256);
  const absoluteDirectory = path.join(path.resolve(stateDir), relativeDirectory);
  let names: string[];
  try {
    names = await readdir(absoluteDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const matching = names
    .filter((name) => /^batch-\d{4}-storage-object-\d{4}-epoch-\d{4,}\.json$/u.test(name))
    .sort();
  const journals: StorageObjectJournal[] = [];
  for (const name of matching) {
    const relativePath = path.join(relativeDirectory, name);
    const journal = await readOptionalBatchJournalArtifact(
      stateDir,
      relativePath,
      validateStorageObjectJournal,
    );
    if (!journal || journal.payload.run_sha256 !== runSha256) {
      throw new Error("storage object journal belongs to another run");
    }
    journals.push(journal);
  }
  const identities = journals.map((journal) =>
    `${journal.payload.batch_index}\0${journal.payload.object_index}\0${journal.payload.claim.claim_epoch}`
  );
  if (new Set(identities).size !== identities.length) {
    throw new Error("storage object journals contain duplicate batch/object/claim epochs");
  }
  return journals;
}

export function createStorageUploadClaimJournal(
  input: CreateStorageUploadClaimJournalInput,
): StorageUploadClaimJournal {
  const payload = StorageUploadClaimJournalPayloadSchema.parse({
    run_sha256: input.runSha256,
    batch_sha256: input.batchSha256,
    batch_index: input.batchIndex,
    object_index: input.objectIndex,
    claim: input.claim,
  });
  return StorageUploadClaimJournalSchema.parse({
    schema_version: 1,
    kind: "vendor_ingest_storage_upload_claim_journal",
    payload,
    journal_sha256: canonicalSha256(payload),
  });
}

export function validateStorageUploadClaimJournal(value: unknown): StorageUploadClaimJournal {
  const journal = StorageUploadClaimJournalSchema.parse(value);
  if (canonicalSha256(journal.payload) !== journal.journal_sha256) {
    throw new Error("storage upload claim journal SHA-256 does not match its payload");
  }
  return journal;
}

export async function writeStorageUploadClaimJournal(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const journal = validateStorageUploadClaimJournal(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      journal.payload.run_sha256,
      `batch-${String(journal.payload.batch_index).padStart(4, "0")}-storage-claim-${String(journal.payload.object_index).padStart(4, "0")}-epoch-${String(journal.payload.claim.claim_epoch).padStart(4, "0")}.json`,
    ),
    journal,
  );
}

export async function readStorageUploadClaimJournals(
  stateDir: string,
  runSha256: string,
): Promise<StorageUploadClaimJournal[]> {
  Sha256Schema.parse(runSha256);
  const relativeDirectory = path.join("batch-journal", runSha256);
  const absoluteDirectory = path.join(path.resolve(stateDir), relativeDirectory);
  let names: string[];
  try {
    names = await readdir(absoluteDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const matching = names
    .filter((name) => /^batch-\d{4}-storage-claim-\d{4}-epoch-\d{4,}\.json$/u.test(name))
    .sort();
  const journals: StorageUploadClaimJournal[] = [];
  for (const name of matching) {
    const journal = await readOptionalBatchJournalArtifact(
      stateDir,
      path.join(relativeDirectory, name),
      validateStorageUploadClaimJournal,
    );
    if (!journal || journal.payload.run_sha256 !== runSha256) {
      throw new Error("storage upload claim journal belongs to another run");
    }
    journals.push(journal);
  }
  return journals;
}

export function createStorageUploadStartedJournal(
  input: CreateStorageUploadStartedJournalInput,
): StorageUploadStartedJournal {
  const payload = StorageUploadStartedJournalPayloadSchema.parse({
    run_sha256: input.runSha256,
    batch_sha256: input.batchSha256,
    batch_index: input.batchIndex,
    object_index: input.objectIndex,
    upload_attempt: input.uploadAttempt,
    claim: input.claim,
    started_at: input.startedAt,
  });
  return StorageUploadStartedJournalSchema.parse({
    schema_version: 1,
    kind: "vendor_ingest_storage_upload_started_journal",
    payload,
    journal_sha256: canonicalSha256(payload),
  });
}

export function validateStorageUploadStartedJournal(value: unknown): StorageUploadStartedJournal {
  const journal = StorageUploadStartedJournalSchema.parse(value);
  if (canonicalSha256(journal.payload) !== journal.journal_sha256) {
    throw new Error("storage upload start journal SHA-256 does not match its payload");
  }
  return journal;
}

export async function writeStorageUploadStartedJournal(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const journal = validateStorageUploadStartedJournal(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      journal.payload.run_sha256,
      `batch-${String(journal.payload.batch_index).padStart(4, "0")}-storage-upload-${String(journal.payload.object_index).padStart(4, "0")}-epoch-${String(journal.payload.claim.claim_epoch).padStart(4, "0")}-attempt-${String(journal.payload.upload_attempt).padStart(4, "0")}.json`,
    ),
    journal,
  );
}

export async function readStorageUploadStartedJournals(
  stateDir: string,
  runSha256: string,
): Promise<StorageUploadStartedJournal[]> {
  Sha256Schema.parse(runSha256);
  const relativeDirectory = path.join("batch-journal", runSha256);
  const absoluteDirectory = path.join(path.resolve(stateDir), relativeDirectory);
  let names: string[];
  try {
    names = await readdir(absoluteDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const matching = names
    .filter((name) => /^batch-\d{4}-storage-upload-\d{4}-epoch-\d{4,}-attempt-\d{4}\.json$/u.test(name))
    .sort();
  const journals: StorageUploadStartedJournal[] = [];
  for (const name of matching) {
    const journal = await readOptionalBatchJournalArtifact(
      stateDir,
      path.join(relativeDirectory, name),
      validateStorageUploadStartedJournal,
    );
    if (!journal || journal.payload.run_sha256 !== runSha256) {
      throw new Error("storage upload start journal belongs to another run");
    }
    journals.push(journal);
  }
  return journals;
}

export function createStorageUploadReconcileReceipt(
  input: CreateStorageUploadReconcileReceiptInput,
): StorageUploadReconcileReceipt {
  const payload = StorageUploadReconcileReceiptPayloadSchema.parse({
    run_sha256: input.runSha256,
    batch_sha256: input.batchSha256,
    batch_index: input.batchIndex,
    object_index: input.objectIndex,
    claim: input.claim,
    previous_upload_attempt: input.previousUploadAttempt,
    next_upload_attempt: input.previousUploadAttempt + 1,
    confirmed_no_inflight_at: input.confirmedNoInflightAt,
    reason: input.reason,
    confirmation: "no_inflight_upload_confirmed",
  });
  return StorageUploadReconcileReceiptSchema.parse({
    schema_version: 1,
    kind: "vendor_ingest_storage_upload_reconcile_receipt",
    payload,
    receipt_sha256: canonicalSha256(payload),
  });
}

export function validateStorageUploadReconcileReceipt(value: unknown): StorageUploadReconcileReceipt {
  const receipt = StorageUploadReconcileReceiptSchema.parse(value);
  if (canonicalSha256(receipt.payload) !== receipt.receipt_sha256) {
    throw new Error("storage upload reconciliation receipt SHA-256 does not match its payload");
  }
  return receipt;
}

export async function writeStorageUploadReconcileReceipt(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const receipt = validateStorageUploadReconcileReceipt(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      receipt.payload.run_sha256,
      `batch-${String(receipt.payload.batch_index).padStart(4, "0")}-storage-reconcile-${String(receipt.payload.object_index).padStart(4, "0")}-epoch-${String(receipt.payload.claim.claim_epoch).padStart(4, "0")}-attempt-${String(receipt.payload.next_upload_attempt).padStart(4, "0")}.json`,
    ),
    receipt,
  );
}

export async function readStorageUploadReconcileReceipts(
  stateDir: string,
  runSha256: string,
): Promise<StorageUploadReconcileReceipt[]> {
  Sha256Schema.parse(runSha256);
  const relativeDirectory = path.join("batch-journal", runSha256);
  const absoluteDirectory = path.join(path.resolve(stateDir), relativeDirectory);
  let names: string[];
  try {
    names = await readdir(absoluteDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const matching = names
    .filter((name) => /^batch-\d{4}-storage-reconcile-\d{4}-epoch-\d{4,}-attempt-\d{4}\.json$/u.test(name))
    .sort();
  const receipts: StorageUploadReconcileReceipt[] = [];
  for (const name of matching) {
    const receipt = await readOptionalBatchJournalArtifact(
      stateDir,
      path.join(relativeDirectory, name),
      validateStorageUploadReconcileReceipt,
    );
    if (!receipt || receipt.payload.run_sha256 !== runSha256) {
      throw new Error("storage upload reconciliation receipt belongs to another run");
    }
    receipts.push(receipt);
  }
  return receipts;
}

export async function beginStorageUploadAttempt(
  stateDir: string,
  input: BeginStorageUploadAttemptInput,
): Promise<BeginStorageUploadAttemptResult> {
  const claim = StorageUploadClaimSchema.parse(input.claim);
  if (claim.claim_action !== "upload") {
    throw new Error("only an exact upload claim may begin an HTTP upload attempt");
  }
  const starts = (await readStorageUploadStartedJournals(stateDir, input.runSha256))
    .filter((journal) =>
      journal.payload.batch_index === input.batchIndex
      && journal.payload.object_index === input.objectIndex
      && isDeepStrictEqual(journal.payload.claim, claim)
    )
    .sort((left, right) => left.payload.upload_attempt - right.payload.upload_attempt);
  if (starts.length === 0) {
    if (!input.freshClaim) {
      const receipts = (await readStorageUploadReconcileReceipts(stateDir, input.runSha256))
        .filter((receipt) =>
          receipt.payload.batch_index === input.batchIndex
          && receipt.payload.object_index === input.objectIndex
          && receipt.payload.previous_upload_attempt === 0
          && receipt.payload.next_upload_attempt === 1
          && isDeepStrictEqual(receipt.payload.claim, claim)
        );
      if (receipts.length !== 1) {
        throw new Error(
          `storage_upload_manual_reconciliation_required:batch=${input.batchIndex}:object=${input.objectIndex}:epoch=${claim.claim_epoch}:attempt=0`,
        );
      }
    }
    const started = createStorageUploadStartedJournal({
      ...input,
      uploadAttempt: 1,
    });
    return {
      uploadAttempt: 1,
      shouldUpload: true,
      journalPath: await writeStorageUploadStartedJournal(stateDir, started),
    };
  }
  const latest = starts.at(-1)!;
  const observations = await readStorageObjectJournals(stateDir, input.runSha256);
  if (observations.some((journal) =>
    journal.payload.batch_index === input.batchIndex
    && journal.payload.object_index === input.objectIndex
    && journal.payload.upload_attempt === latest.payload.upload_attempt
    && isDeepStrictEqual(journal.payload.claim, claim)
  )) {
    return {
      uploadAttempt: latest.payload.upload_attempt,
      shouldUpload: false,
      journalPath: null,
    };
  }
  const nextAttempt = latest.payload.upload_attempt + 1;
  const receipts = (await readStorageUploadReconcileReceipts(stateDir, input.runSha256))
    .filter((receipt) =>
      receipt.payload.batch_index === input.batchIndex
      && receipt.payload.object_index === input.objectIndex
      && receipt.payload.next_upload_attempt === nextAttempt
      && isDeepStrictEqual(receipt.payload.claim, claim)
    );
  if (receipts.length !== 1) {
    throw new Error(
      `storage_upload_manual_reconciliation_required:batch=${input.batchIndex}:object=${input.objectIndex}:epoch=${claim.claim_epoch}:attempt=${latest.payload.upload_attempt}`,
    );
  }
  const started = createStorageUploadStartedJournal({
    ...input,
    uploadAttempt: nextAttempt,
  });
  return {
    uploadAttempt: nextAttempt,
    shouldUpload: true,
    journalPath: await writeStorageUploadStartedJournal(stateDir, started),
  };
}

export function validateStorageIntentJournal(value: unknown): StorageIntentJournal {
  const journal = StorageIntentJournalSchema.parse(value);
  if (canonicalSha256(journal.payload) !== journal.journal_sha256) {
    throw new Error("storage intent journal SHA-256 does not match its payload");
  }
  return journal;
}

export async function writeStorageIntentJournal(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const journal = validateStorageIntentJournal(value);
  return writeImmutableBatchJournalArtifact(
    stateDir,
    path.join(
      "batch-journal",
      journal.payload.run_sha256,
      `batch-${String(journal.payload.batch_index).padStart(4, "0")}-storage-intent.json`,
    ),
    journal,
  );
}

export async function readStorageIntentJournals(
  stateDir: string,
  runSha256: string,
): Promise<StorageIntentJournal[]> {
  Sha256Schema.parse(runSha256);
  const relativeDirectory = path.join("batch-journal", runSha256);
  const absoluteDirectory = path.join(path.resolve(stateDir), relativeDirectory);
  let names: string[];
  try {
    names = await readdir(absoluteDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const matching = names
    .filter((name) => /^batch-\d{4}-storage-intent\.json$/u.test(name))
    .sort();
  const journals: StorageIntentJournal[] = [];
  for (const name of matching) {
    const relativePath = path.join(relativeDirectory, name);
    const journal = await readOptionalBatchJournalArtifact(
      stateDir,
      relativePath,
      validateStorageIntentJournal,
    );
    if (!journal || journal.payload.run_sha256 !== runSha256) {
      throw new Error("storage intent journal belongs to another run");
    }
    journals.push(journal);
  }
  const batchIndexes = journals.map((journal) => journal.payload.batch_index);
  if (new Set(batchIndexes).size !== batchIndexes.length) {
    throw new Error("storage intent journals contain duplicate batch indexes");
  }
  return journals;
}

export function validateStorageRollbackJournal(value: unknown): StorageRollbackJournal {
  const journal = StorageRollbackJournalSchema.parse(value);
  if (canonicalSha256(journal.payload) !== journal.journal_sha256) {
    throw new Error("storage rollback journal SHA-256 does not match its payload");
  }
  return journal;
}

export async function writeStorageRollbackJournal(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const journal = validateStorageRollbackJournal(value);
  const relativePath = path.join(
    "batch-journal",
    journal.payload.run_sha256,
    `batch-${String(journal.payload.batch_index).padStart(4, "0")}-storage.json`,
  );
  const artifactPath = path.join(path.resolve(stateDir), relativePath);
  try {
    const verifiedPath = await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath,
      expectedRelativePath: relativePath,
    });
    const existing = validateStorageRollbackJournal(
      JSON.parse(await readFile(verifiedPath, "utf8")),
    );
    const sameEnvelope = existing.payload.run_sha256 === journal.payload.run_sha256
      && existing.payload.batch_sha256 === journal.payload.batch_sha256
      && existing.payload.batch_index === journal.payload.batch_index
      && existing.payload.objects.length === journal.payload.objects.length;
    const compatibleObjects = sameEnvelope && existing.payload.objects.every((stored, index) => {
      const replayed = journal.payload.objects[index];
      // The first durable ownership observation remains authoritative. On a
      // retry an object can legitimately flip either way if it was removed
      // outside this run. Preserve the first journal and never broaden its
      // rollback set merely because a later attempt recreated an object.
      return replayed !== undefined
        && stored.bucket === replayed.bucket
        && stored.object_key === replayed.object_key
        && stored.sha256 === replayed.sha256
        && stored.bytes === replayed.bytes;
    });
    if (!compatibleObjects) {
      throw new Error("existing batch journal content differs from the immutable resume artifact");
    }
    return verifiedPath;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  return writeImmutableBatchJournalArtifact(stateDir, relativePath, journal);
}

async function writeImmutableBatchJournalArtifact(
  stateDir: string,
  relativePath: string,
  value: unknown,
): Promise<string> {
  const artifactPath = path.join(path.resolve(stateDir), relativePath);
  await prepareDeterministicStateArtifactWritePath({
    stateDir,
    artifactPath,
    expectedRelativePath: relativePath,
  });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const temporaryPath = path.join(
    path.dirname(artifactPath),
    `.${path.basename(artifactPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, artifactPath);
    await syncDirectoryMetadata(path.dirname(artifactPath));
    return artifactPath;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(artifactPath, "utf8"));
  } catch {
    throw new Error("existing batch journal content is unreadable");
  }
  if (!isDeepStrictEqual(existing, value)) {
    throw new Error("existing batch journal content differs from the immutable resume artifact");
  }
  return artifactPath;
}
