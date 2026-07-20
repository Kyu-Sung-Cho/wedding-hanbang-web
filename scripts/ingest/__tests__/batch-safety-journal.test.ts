import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BATCH_SAFETY_JOURNAL_BLOCKER,
  BATCH_SAFETY_JOURNAL_OPERATIONAL,
  createBlockedBatchPlanDraft,
  createBlockedBatchResultDraft,
  createPendingBatchExecutionEvidence,
  createPendingBatchUniverseEvidence,
  evaluateNeedsReviewSpike,
  validateBatchEvidence,
  validateBatchPlanDraft,
  validateBatchResultDraft,
  writeBatchPlanDraft,
  writeBatchResultDraft,
} from "../batch-safety-journal.js";
import type {
  BatchEvidence,
  BatchPlanDraft,
  BatchPredecessorEvidence,
  BatchResultDraft,
  CreateBatchUnitResultInput,
  PilotReceiptContext,
} from "../batch-safety-journal.js";
import { canonicalSha256 } from "../gate-integrity.js";
import {
  FIXED_EIGHT_BLOCKING_UNIT_IDS,
  FIXED_EIGHT_GROUND_TRUTH_BINDING,
  FIXED_EIGHT_MAY_UNREADABLE_CELL_BINDINGS,
  FIXED_EIGHT_NON_BLOCKING_UNIT_IDS,
  FIXED_EIGHT_ORDERED_UNIT_IDS,
  createFixedEightPassReceipt,
} from "../pilot-pass-receipt.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

function validReceiptContext(): PilotReceiptContext {
  const paidPlanSha256 = digest("paid-plan");
  const units = FIXED_EIGHT_ORDERED_UNIT_IDS.map((unitId) => ({
    unit_id: unitId,
    paid_plan_sha256: paidPlanSha256,
    source_fingerprint: digest(`source:${unitId}`),
    conversion_fingerprint: digest(`conversion:${unitId}`),
    extraction_fingerprint: digest(`extraction:${unitId}`),
    extraction_content_sha256: digest(`extraction-content:${unitId}`),
    validation_fingerprint: digest(`validation:${unitId}`),
    validation_content_sha256: digest(`validation-content:${unitId}`),
    model: "gpt-5.6-luna" as const,
    prompt_version: "prompt-v1",
    prompt_hash: digest("prompt-v1"),
    processing_version: digest("processing-v1"),
    scanner_parser_version: "scanner-v1",
    converter_version: "converter-v1",
    request_hashes: [digest(`request:${unitId}:0`)],
  }));
  const priceGate = (passed: boolean) => ({
    passed,
    hallucinated_amounts: [],
    missing_readable_amounts: [],
    unsupported_structured_amounts: [],
    linking_errors: [],
    manual_linkage_reviews: [],
    blocking_validation_issues: [],
    unsafe_unreadable_extractions: [],
    actual_coverage_gaps: passed ? [] : [{ reason: "non-blocking image coverage review" }],
  });
  const scoreReportContent = `${JSON.stringify({
    schema_version: 1,
    verification: {
      mode: "strict_validated_artifacts",
      validated_artifacts_required: true,
      paid_plan_sha256: paidPlanSha256,
    },
    ground_truth: {
      sha256: FIXED_EIGHT_GROUND_TRUTH_BINDING.base_sha256,
      inventory_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.base_occurrences,
      base_readable_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.base_readable_occurrences,
      effective_readable_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.effective_readable_occurrences,
      overlay_sha256: FIXED_EIGHT_GROUND_TRUTH_BINDING.overlay_sha256,
      overlay_readable_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.overlay_readable_occurrences,
      unreadable_cells: FIXED_EIGHT_GROUND_TRUTH_BINDING.unreadable_cells,
      adjudication: {
        sha256: FIXED_EIGHT_GROUND_TRUTH_BINDING.adjudication_sha256,
        human_required_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.human_required_occurrences,
      },
    },
    gate: {
      status: "pass",
      verification_mode: "strict_validated_artifacts",
      validated_artifacts_required: true,
      eligible_for_25_unit_batch: true,
      blocking_unit_ids: FIXED_EIGHT_BLOCKING_UNIT_IDS,
      non_blocking_unit_ids: FIXED_EIGHT_NON_BLOCKING_UNIT_IDS,
      blocking_passed_units: 7,
      blocking_failed_units: 0,
      blocking_blocked_units: 0,
      criteria: {
        hallucinated_amounts: 0,
        missing_readable_amounts: 0,
        unsupported_structured_amounts: 0,
        linking_errors: 0,
        manual_linkage_reviews: 0,
        blocking_validation_issues: 0,
        actual_coverage_gaps: 0,
        unreadable_amounts_must_remain_unstructured: true,
      },
      semantic_criteria: {
        required_for_expected_units: true,
        required_status: "captured",
      },
    },
    units: FIXED_EIGHT_ORDERED_UNIT_IDS.map((unitId, index) => {
      const { unit_id: _unitId, ...provenance } = units[index]!;
      return {
        unit_id: unitId,
        prompt_version: "prompt-v1",
        model: "gpt-5.6-luna",
        provenance,
        status: index === 7 ? "fail" : "pass",
        price_gate: priceGate(index !== 7),
        semantic_gate: {
          required: true,
          passed: index !== 7,
          expected_status: "captured",
          actual_status: index === 7 ? "missing" : "captured",
        },
        semantic_capture: {
          status: index === 7 ? "missing" : "captured",
          misses: index === 7 ? ["pricing_basis"] : [],
        },
        unreadable_cells: index === 7
          ? FIXED_EIGHT_MAY_UNREADABLE_CELL_BINDINGS.map((binding) => ({
            source_locator: binding.source_locator,
            visible_amounts_krw: [...binding.visible_amounts_krw],
          }))
          : [],
        unreadable_handling: {
          any_needs_review: index === 7,
          known_cell_dispositions: index === 7
            ? FIXED_EIGHT_MAY_UNREADABLE_CELL_BINDINGS.map((binding) => ({
              source_locator: binding.source_locator,
              visible_amounts_krw: [...binding.visible_amounts_krw],
              needs_review: true,
              amounts_remain_unstructured: true,
            }))
            : [],
          all_known_cells_safely_disposed: true,
        },
      };
    }),
  })}\n`;
  return {
    scoreReportContent,
    pilotReceipt: createFixedEightPassReceipt({
      issuedAt: "2026-07-20T00:00:00.000Z",
      orderedUnitIds: FIXED_EIGHT_ORDERED_UNIT_IDS,
      nonBlockingUnitIds: FIXED_EIGHT_NON_BLOCKING_UNIT_IDS,
      units,
      groundTruth: { ...FIXED_EIGHT_GROUND_TRUTH_BINDING },
      scoreReportContent,
    }),
  };
}

function sourceUniverse(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    unit_id: digest(`batch-unit:${index}`),
    source_fingerprint: digest(`batch-source:${index}`),
    conversion_fingerprint: digest(`batch-conversion:${index}`),
  }));
}

function pendingUniverseEvidence(count: number): BatchEvidence {
  return createPendingBatchUniverseEvidence({
    capturedAt: "2026-07-20T00:30:00.000Z",
    manifestSha256: digest("manifest"),
    sourceUniverse: sourceUniverse(count),
  });
}

function completedRows(plan: BatchPlanDraft, needsReview = 1): CreateBatchUnitResultInput[] {
  return plan.payload.units.map((unit) => ({
    unit_id: unit.unit_id,
    outcome: "completed",
    extraction_fingerprint: digest(`extraction:${unit.unit_id}`),
    extraction_content_sha256: digest(`extraction-content:${unit.unit_id}`),
    validation_fingerprint: digest(`validation:${unit.unit_id}`),
    staged_record_count: 10,
    needs_review_count: needsReview,
    staging_review_status: "pending",
  }));
}

function pendingExecutionEvidence(
  universeEvidence: BatchEvidence,
  plan: BatchPlanDraft,
  unitResults: readonly CreateBatchUnitResultInput[] = completedRows(plan),
): BatchEvidence {
  return createPendingBatchExecutionEvidence({
    capturedAt: "2026-07-20T01:30:00.000Z",
    universeEvidence,
    plan,
    stagingSnapshotSha256: digest(`staging:${plan.plan_sha256}`),
    executionLedgerSha256: digest(`ledger:${plan.plan_sha256}`),
    unitResults,
  });
}

function firstPlan(
  receipt: PilotReceiptContext,
  universeEvidence: BatchEvidence,
): BatchPlanDraft {
  return createBlockedBatchPlanDraft({
    createdAt: "2026-07-20T01:00:00.000Z",
    ...receipt,
    universeEvidence,
  });
}

function resultFor(
  receipt: PilotReceiptContext,
  universeEvidence: BatchEvidence,
  plan: BatchPlanDraft,
  executionEvidence: BatchEvidence,
  predecessor?: BatchPredecessorEvidence,
): BatchResultDraft {
  return createBlockedBatchResultDraft({
    completedAt: "2026-07-20T02:00:00.000Z",
    ...receipt,
    universeEvidence,
    plan,
    executionEvidence,
    predecessor,
  });
}

test("a pending evidence object deterministically produces a blocked first 25-unit plan draft", () => {
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(60);
  const plan = firstPlan(receipt, universeEvidence);

  assert.equal(BATCH_SAFETY_JOURNAL_OPERATIONAL, false);
  assert.equal(plan.payload.operational_status, "blocked_pending_state_aware_runner");
  assert.equal(plan.payload.batch_index, 1);
  assert.equal(plan.payload.final_tail, false);
  assert.deepEqual(plan.payload.units, sourceUniverse(60).slice(0, 25));
  assert.equal(plan.payload.universe_evidence_sha256, universeEvidence.evidence_sha256);
  assert.deepEqual(validateBatchPlanDraft(plan, { ...receipt, universeEvidence }), plan);
});

test("a validated result and its evidence are both required for the adjacent next plan", () => {
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(60);
  const plan1 = firstPlan(receipt, universeEvidence);
  const execution1 = pendingExecutionEvidence(universeEvidence, plan1);
  const result1 = resultFor(receipt, universeEvidence, plan1, execution1);
  const predecessor = { plan: plan1, result: result1, executionEvidence: execution1 };
  const plan2 = createBlockedBatchPlanDraft({
    createdAt: "2026-07-20T03:00:00.000Z",
    ...receipt,
    universeEvidence,
    predecessor,
  });

  assert.equal(result1.payload.status, "pass");
  assert.equal(result1.payload.review_metrics.staged_record_count, 250);
  assert.equal(plan2.payload.batch_index, 2);
  assert.equal(plan2.payload.previous_result_sha256, result1.result_sha256);
  assert.deepEqual(plan2.payload.units, sourceUniverse(60).slice(25, 50));

  assert.throws(
    () => validateBatchPlanDraft(plan2, { ...receipt, universeEvidence }),
    /first batch plan must have index 1 and no predecessor/u,
  );
});

test("the third plan is an exact 10-unit final tail and an exact 25 never claims tail status", () => {
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(60);
  const plan1 = firstPlan(receipt, universeEvidence);
  const execution1 = pendingExecutionEvidence(universeEvidence, plan1);
  const result1 = resultFor(receipt, universeEvidence, plan1, execution1);
  const predecessor1 = { plan: plan1, result: result1, executionEvidence: execution1 };
  const plan2 = createBlockedBatchPlanDraft({
    createdAt: "2026-07-20T03:00:00.000Z",
    ...receipt,
    universeEvidence,
    predecessor: predecessor1,
  });
  const execution2 = pendingExecutionEvidence(universeEvidence, plan2);
  const result2 = resultFor(receipt, universeEvidence, plan2, execution2, predecessor1);
  const predecessor2 = {
    plan: plan2,
    result: result2,
    executionEvidence: execution2,
    predecessor: predecessor1,
  };
  const plan3 = createBlockedBatchPlanDraft({
    createdAt: "2026-07-20T04:00:00.000Z",
    ...receipt,
    universeEvidence,
    predecessor: predecessor2,
  });

  assert.equal(plan3.payload.final_tail, true);
  assert.equal(plan3.payload.remaining_before_count, 10);
  assert.equal(plan3.payload.remaining_after_count, 0);
  assert.deepEqual(plan3.payload.units, sourceUniverse(60).slice(50));

  const exactEvidence = pendingUniverseEvidence(25);
  assert.equal(firstPlan(receipt, exactEvidence).payload.final_tail, false);
});

test("needs-review comparison is exact, including equality, zero baselines, and zero denominators", () => {
  assert.equal(
    evaluateNeedsReviewSpike({ needs_review_count: 10, staged_record_count: 100 }).decision,
    "baseline",
  );
  assert.equal(
    evaluateNeedsReviewSpike(
      { needs_review_count: 19, staged_record_count: 100 },
      { needs_review_count: 10, staged_record_count: 100 },
    ).decision,
    "continue",
  );
  const doubled = evaluateNeedsReviewSpike(
    { needs_review_count: 20, staged_record_count: 100 },
    { needs_review_count: 10, staged_record_count: 100 },
  );
  assert.equal(doubled.decision, "stop");
  assert.equal(doubled.current_cross_product, doubled.doubled_previous_cross_product);
  assert.equal(
    evaluateNeedsReviewSpike(
      { needs_review_count: 1, staged_record_count: 100 },
      { needs_review_count: 0, staged_record_count: 100 },
    ).reason,
    "zero_baseline_increase",
  );
  assert.equal(
    evaluateNeedsReviewSpike(
      { needs_review_count: 0, staged_record_count: 0 },
      { needs_review_count: 0, staged_record_count: 100 },
    ).reason,
    "invalid_denominator",
  );
});

test("incomplete and doubled-review evidence cannot authorize another plan", () => {
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(60);
  const plan1 = firstPlan(receipt, universeEvidence);
  const partialExecution = pendingExecutionEvidence(
    universeEvidence,
    plan1,
    completedRows(plan1).slice(0, 1),
  );
  const incomplete = resultFor(receipt, universeEvidence, plan1, partialExecution);
  assert.equal(incomplete.payload.status, "incomplete");
  assert.throws(
    () => createBlockedBatchPlanDraft({
      createdAt: "2026-07-20T03:00:00.000Z",
      ...receipt,
      universeEvidence,
      predecessor: { plan: plan1, result: incomplete, executionEvidence: partialExecution },
    }),
    /not eligible to continue: incomplete/u,
  );

  const execution1 = pendingExecutionEvidence(universeEvidence, plan1);
  const result1 = resultFor(receipt, universeEvidence, plan1, execution1);
  const predecessor1 = { plan: plan1, result: result1, executionEvidence: execution1 };
  const plan2 = createBlockedBatchPlanDraft({
    createdAt: "2026-07-20T03:00:00.000Z",
    ...receipt,
    universeEvidence,
    predecessor: predecessor1,
  });
  const spikeExecution = pendingExecutionEvidence(universeEvidence, plan2, completedRows(plan2, 2));
  const spike = resultFor(receipt, universeEvidence, plan2, spikeExecution, predecessor1);
  assert.equal(spike.payload.status, "review_spike");
  assert.throws(
    () => createBlockedBatchPlanDraft({
      createdAt: "2026-07-20T05:00:00.000Z",
      ...receipt,
      universeEvidence,
      predecessor: {
        plan: plan2,
        result: spike,
        executionEvidence: spikeExecution,
        predecessor: predecessor1,
      },
    }),
    /not eligible to continue: review_spike/u,
  );
});

test("recomputed hashes cannot detach a plan from receipt, universe, predecessor, or adjacency evidence", () => {
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(60);
  const plan1 = firstPlan(receipt, universeEvidence);
  const forgedReceipt = structuredClone(plan1);
  forgedReceipt.payload.pilot_receipt_sha256 = digest("other-receipt");
  forgedReceipt.plan_sha256 = canonicalSha256(forgedReceipt.payload);
  assert.throws(
    () => validateBatchPlanDraft(forgedReceipt, { ...receipt, universeEvidence }),
    /does not match its receipt or universe evidence/u,
  );

  const otherUniverse = createPendingBatchUniverseEvidence({
    capturedAt: "2026-07-20T00:31:00.000Z",
    manifestSha256: digest("other-manifest"),
    sourceUniverse: sourceUniverse(60),
  });
  const forgedUniverse = structuredClone(plan1);
  forgedUniverse.payload.universe_evidence_sha256 = otherUniverse.evidence_sha256;
  forgedUniverse.plan_sha256 = canonicalSha256(forgedUniverse.payload);
  assert.throws(
    () => validateBatchPlanDraft(forgedUniverse, { ...receipt, universeEvidence }),
    /does not match its receipt or universe evidence/u,
  );

  const forgedAdjacency = structuredClone(plan1);
  forgedAdjacency.payload.batch_index = 2;
  forgedAdjacency.plan_sha256 = canonicalSha256(forgedAdjacency.payload);
  assert.throws(
    () => validateBatchPlanDraft(forgedAdjacency, { ...receipt, universeEvidence }),
    /first batch plan must have index 1/u,
  );
});

test("result validation requires its exact plan, receipt, execution evidence, and predecessor chain", () => {
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(60);
  const plan1 = firstPlan(receipt, universeEvidence);
  const execution1 = pendingExecutionEvidence(universeEvidence, plan1);
  const result1 = resultFor(receipt, universeEvidence, plan1, execution1);
  const context = { ...receipt, universeEvidence, plan: plan1, executionEvidence: execution1 };

  const forged = structuredClone(result1);
  forged.payload.plan_sha256 = digest("other-plan");
  forged.result_sha256 = canonicalSha256(forged.payload);
  assert.throws(
    () => validateBatchResultDraft(forged, context),
    /does not match its exact plan/u,
  );

  const forgedStatus = structuredClone(result1);
  forgedStatus.payload.status = "incomplete";
  forgedStatus.payload.cumulative_completed_unit_ids = [];
  forgedStatus.result_sha256 = canonicalSha256(forgedStatus.payload);
  assert.throws(
    () => validateBatchResultDraft(forgedStatus, context),
    /status, ratios, or cumulative IDs/u,
  );

  const plan2 = createBlockedBatchPlanDraft({
    createdAt: "2026-07-20T03:00:00.000Z",
    ...receipt,
    universeEvidence,
    predecessor: { plan: plan1, result: result1, executionEvidence: execution1 },
  });
  const execution2 = pendingExecutionEvidence(universeEvidence, plan2);
  const result2 = resultFor(
    receipt,
    universeEvidence,
    plan2,
    execution2,
    { plan: plan1, result: result1, executionEvidence: execution1 },
  );
  assert.throws(
    () => validateBatchResultDraft(result2, {
      ...receipt,
      universeEvidence,
      plan: plan2,
      executionEvidence: execution2,
    }),
    /first batch plan must have index 1/u,
  );
});

test("batch evidence hashes, row order, pending review state, and artifact-content hashes fail closed", () => {
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(25);
  const tamperedEvidence = structuredClone(universeEvidence);
  if (tamperedEvidence.payload.scope !== "universe") assert.fail("fixture scope");
  tamperedEvidence.payload.manifest_sha256 = digest("tampered-manifest");
  assert.throws(() => validateBatchEvidence(tamperedEvidence), /evidence SHA-256/u);

  const plan = firstPlan(receipt, universeEvidence);
  const reordered = completedRows(plan);
  [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
  assert.throws(
    () => pendingExecutionEvidence(universeEvidence, plan, reordered),
    /preserve the exact plan order/u,
  );

  const missingContentHash = completedRows(plan);
  missingContentHash[0]!.extraction_content_sha256 = null;
  assert.throws(
    () => pendingExecutionEvidence(universeEvidence, plan, missingContentHash),
    /extraction content SHA-256/u,
  );

  const approved = completedRows(plan) as unknown as Array<Record<string, unknown>>;
  approved[0]!.staging_review_status = "approved";
  assert.throws(
    () => pendingExecutionEvidence(universeEvidence, plan, approved as never),
    /Invalid input/u,
  );
});

test("batch writers validate exact evidence and then refuse publication until the state-aware runner exists", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-blocked-batch-journal-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(25);
  const plan = firstPlan(receipt, universeEvidence);
  const executionEvidence = pendingExecutionEvidence(universeEvidence, plan);
  const result = resultFor(receipt, universeEvidence, plan, executionEvidence);

  await assert.rejects(
    writeBatchPlanDraft(stateDir, plan, { ...receipt, universeEvidence }),
    new RegExp(BATCH_SAFETY_JOURNAL_BLOCKER, "u"),
  );
  await assert.rejects(
    writeBatchResultDraft(stateDir, result, {
      ...receipt,
      universeEvidence,
      plan,
      executionEvidence,
    }),
    new RegExp(BATCH_SAFETY_JOURNAL_BLOCKER, "u"),
  );
  await assert.rejects(access(path.join(stateDir, "batch-journal")), /ENOENT/u);

  await assert.rejects(
    writeBatchPlanDraft(stateDir, plan, {
      ...receipt,
      scoreReportContent: `${receipt.scoreReportContent} `,
      universeEvidence,
    }),
    /score report content SHA-256 or byte length/u,
  );
});
