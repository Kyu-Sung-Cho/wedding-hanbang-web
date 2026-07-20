import { z } from "zod";

import { canonicalSha256 } from "./gate-integrity.js";
import {
  FIXED_EIGHT_ORDERED_UNIT_IDS,
  validateFixedEightPassReceipt,
} from "./pilot-pass-receipt.js";
import type { FixedEightPassReceipt } from "./pilot-pass-receipt.js";

export const BATCH_SAFETY_JOURNAL_OPERATIONAL = false as const;
export const BATCH_SAFETY_JOURNAL_BLOCKER = "state_aware_batch_evidence_runner_not_implemented" as const;

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
  operational: z.literal(false),
  derivation_status: z.literal("pending_state_aware_runner"),
  manifest_sha256: Sha256Schema,
  source_universe: z.array(BatchCandidateSchema).min(1),
}).strict();

const ExecutionEvidencePayloadSchema = z.object({
  scope: z.literal("execution"),
  captured_at: z.string().datetime(),
  operational: z.literal(false),
  derivation_status: z.literal("pending_state_aware_runner"),
  universe_evidence_sha256: Sha256Schema,
  plan_sha256: Sha256Schema,
  staging_snapshot_sha256: Sha256Schema,
  execution_ledger_sha256: Sha256Schema,
  unit_results: z.array(BatchUnitResultSchema).max(25),
}).strict();

const BatchEvidencePayloadSchema = z.discriminatedUnion("scope", [
  UniverseEvidencePayloadSchema,
  ExecutionEvidencePayloadSchema,
]);

export const BatchEvidenceSchema = z.object({
  schema_version: z.literal(1),
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
  operational_status: z.literal("blocked_pending_state_aware_runner"),
  batch_index: z.number().int().positive(),
  pilot_receipt_sha256: Sha256Schema,
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
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_batch_plan_draft"),
  payload: BatchPlanPayloadSchema,
  plan_sha256: Sha256Schema,
}).strict();

const BatchResultPayloadSchema = z.object({
  completed_at: z.string().datetime(),
  operational_status: z.literal("blocked_pending_state_aware_runner"),
  batch_index: z.number().int().positive(),
  plan_sha256: Sha256Schema,
  pilot_receipt_sha256: Sha256Schema,
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
  schema_version: z.literal(1),
  kind: z.literal("vendor_ingest_batch_result_draft"),
  payload: BatchResultPayloadSchema,
  result_sha256: Sha256Schema,
}).strict();

export type BatchCandidate = z.infer<typeof BatchCandidateSchema>;
export type BatchUnitResult = z.output<typeof BatchUnitResultSchema>;
export type BatchEvidence = z.infer<typeof BatchEvidenceSchema>;
export type BatchPlanDraft = z.infer<typeof BatchPlanDraftSchema>;
export type BatchResultDraft = z.infer<typeof BatchResultDraftSchema>;

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

export interface BatchPredecessorEvidence {
  plan: BatchPlanDraft;
  result: BatchResultDraft;
  executionEvidence: BatchEvidence;
  predecessor?: BatchPredecessorEvidence;
}

export interface BatchPlanValidationEvidence extends PilotReceiptContext {
  universeEvidence: BatchEvidence;
  predecessor?: BatchPredecessorEvidence;
}

export interface BatchResultValidationEvidence extends BatchPlanValidationEvidence {
  plan: BatchPlanDraft;
  executionEvidence: BatchEvidence;
}

export interface CreatePendingBatchUniverseEvidenceInput {
  capturedAt: string;
  manifestSha256: string;
  sourceUniverse: readonly BatchCandidate[];
}

export interface CreatePendingBatchExecutionEvidenceInput {
  capturedAt: string;
  universeEvidence: BatchEvidence;
  plan: BatchPlanDraft;
  stagingSnapshotSha256: string;
  executionLedgerSha256: string;
  unitResults: readonly CreateBatchUnitResultInput[];
}

export interface CreateBlockedBatchPlanDraftInput extends BatchPlanValidationEvidence {
  createdAt: string;
}

export interface CreateBlockedBatchResultDraftInput extends BatchResultValidationEvidence {
  completedAt: string;
}

function parsedSourceUniverse(value: readonly BatchCandidate[]): BatchCandidate[] {
  const units = value.map((candidate) => BatchCandidateSchema.parse(candidate));
  if (units.length === 0) throw new Error("batch source universe cannot be empty");
  const ids = units.map((unit) => unit.unit_id);
  if (new Set(ids).size !== ids.length) throw new Error("batch source universe contains duplicate unit IDs");
  const pilotIds = new Set<string>(FIXED_EIGHT_ORDERED_UNIT_IDS);
  const includedPilot = ids.find((unitId) => pilotIds.has(unitId));
  if (includedPilot) throw new Error(`non-pilot batch source universe contains pilot unit: ${includedPilot}`);
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
    operational: false,
    derivation_status: "pending_state_aware_runner",
    manifest_sha256: input.manifestSha256,
    source_universe: parsedSourceUniverse(input.sourceUniverse),
  });
  return {
    schema_version: 1,
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
    operational: false,
    derivation_status: "pending_state_aware_runner",
    universe_evidence_sha256: universe.evidence_sha256,
    plan_sha256: plan.plan_sha256,
    staging_snapshot_sha256: input.stagingSnapshotSha256,
    execution_ledger_sha256: input.executionLedgerSha256,
    unit_results: results,
  });
  return {
    schema_version: 1,
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

function validatePredecessor(
  evidence: BatchPredecessorEvidence | undefined,
  context: PilotReceiptContext & { universeEvidence: BatchEvidence },
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
  const receipt = validateFixedEightPassReceipt(
    evidence.pilotReceipt,
    { scoreReportContent: evidence.scoreReportContent },
  );
  const universe = universeEvidence(evidence.universeEvidence);
  const sourceUniverse = parsedSourceUniverse(universe.payload.source_universe);
  const plan = parsePlanEnvelope(value);
  if (
    plan.payload.pilot_receipt_sha256 !== receipt.receipt_sha256
    || plan.payload.universe_evidence_sha256 !== universe.evidence_sha256
    || plan.payload.source_universe_sha256 !== canonicalSha256(sourceUniverse)
    || plan.payload.source_universe_count !== sourceUniverse.length
    || canonicalSha256(plan.payload.source_universe) !== canonicalSha256(sourceUniverse)
  ) {
    throw new Error("batch plan does not match its receipt or universe evidence");
  }
  const predecessor = validatePredecessor(evidence.predecessor, {
    pilotReceipt: receipt,
    scoreReportContent: evidence.scoreReportContent,
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
      || predecessor.payload.pilot_receipt_sha256 !== receipt.receipt_sha256
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
  const receipt = validateFixedEightPassReceipt(
    input.pilotReceipt,
    { scoreReportContent: input.scoreReportContent },
  );
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
    operational_status: "blocked_pending_state_aware_runner",
    batch_index: (predecessor?.payload.batch_index ?? 0) + 1,
    pilot_receipt_sha256: receipt.receipt_sha256,
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
    schema_version: 1,
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
  const receipt = validateFixedEightPassReceipt(
    evidence.pilotReceipt,
    { scoreReportContent: evidence.scoreReportContent },
  );
  const universe = universeEvidence(evidence.universeEvidence);
  const execution = executionEvidence(evidence.executionEvidence);
  const result = parseResultEnvelope(value);
  if (
    execution.payload.universe_evidence_sha256 !== universe.evidence_sha256
    || execution.payload.plan_sha256 !== plan.plan_sha256
    || result.payload.execution_evidence_sha256 !== execution.evidence_sha256
    || result.payload.universe_evidence_sha256 !== universe.evidence_sha256
    || result.payload.plan_sha256 !== plan.plan_sha256
    || result.payload.pilot_receipt_sha256 !== receipt.receipt_sha256
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
  const receipt = validateFixedEightPassReceipt(
    input.pilotReceipt,
    { scoreReportContent: input.scoreReportContent },
  );
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
    operational_status: "blocked_pending_state_aware_runner",
    batch_index: plan.payload.batch_index,
    plan_sha256: plan.plan_sha256,
    pilot_receipt_sha256: receipt.receipt_sha256,
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
    schema_version: 1,
    kind: "vendor_ingest_batch_result_draft",
    payload,
    result_sha256: canonicalSha256(payload),
  }, input);
}

export async function writeBatchPlanDraft(
  _stateDir: string,
  value: unknown,
  evidence: BatchPlanValidationEvidence,
): Promise<never> {
  validateBatchPlanDraft(value, evidence);
  throw new Error(BATCH_SAFETY_JOURNAL_BLOCKER);
}

export async function writeBatchResultDraft(
  _stateDir: string,
  value: unknown,
  evidence: BatchResultValidationEvidence,
): Promise<never> {
  validateBatchResultDraft(value, evidence);
  throw new Error(BATCH_SAFETY_JOURNAL_BLOCKER);
}
