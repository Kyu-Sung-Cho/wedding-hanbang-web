import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BATCH_SAFETY_JOURNAL_OPERATIONAL,
  beginStorageUploadAttempt,
  createBlockedBatchPlanDraft,
  createBlockedBatchResultDraft,
  createStagingFinalizeIntent,
  createStagingStorageRollbackReceipt,
  createStorageIntentJournal,
  createStorageObjectJournal,
  createStorageUploadClaimJournal,
  createStorageUploadReconcileReceipt,
  createStorageRollbackJournal,
  createPendingBatchExecutionEvidence,
  createPendingBatchUniverseEvidence,
  evaluateNeedsReviewSpike,
  inspectCompletedStateAwareBatches,
  readStorageIntentJournals,
  readStagingRunDescriptor,
  runStateAwareBatches,
  readStagingFinalizeIntent,
  readStagingStorageRollbackReceipt,
  validateBatchEvidence,
  validateBatchPlanDraft,
  validateBatchResultDraft,
  writeStorageRollbackJournal,
  writeStorageIntentJournal,
  writeStorageObjectJournal,
  writeStorageUploadClaimJournal,
  writeStorageUploadReconcileReceipt,
  writeStagingRunDescriptor,
  writeStagingFinalizeIntent,
  writeStagingStorageRollbackReceipt,
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
    stagingRunSha256: digest("staging-run"),
    fullPlanSha256: digest("full-plan"),
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
    remoteBatchReceiptSha256: digest(`receipt:${plan.plan_sha256}`),
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

test("a pending evidence object deterministically produces an operational first 25-unit plan", () => {
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(60);
  const plan = firstPlan(receipt, universeEvidence);

  assert.equal(BATCH_SAFETY_JOURNAL_OPERATIONAL, true);
  assert.equal(plan.payload.operational_status, "state_aware_runner");
  assert.equal(plan.payload.batch_index, 1);
  assert.equal(plan.payload.final_tail, false);
  assert.deepEqual(plan.payload.units, sourceUniverse(60).slice(0, 25));
  assert.equal(plan.payload.universe_evidence_sha256, universeEvidence.evidence_sha256);
  assert.deepEqual(validateBatchPlanDraft(plan, { ...receipt, universeEvidence }), plan);
});

test("the staging universe may include the validated pilot units so all 241 units can be loaded", () => {
  const unitId = FIXED_EIGHT_ORDERED_UNIT_IDS[0]!;
  const evidence = createPendingBatchUniverseEvidence({
    capturedAt: "2026-07-20T00:30:00.000Z",
    stagingRunSha256: digest("pilot-staging-run"),
    fullPlanSha256: digest("pilot-full-plan"),
    manifestSha256: digest("manifest-with-pilot"),
    sourceUniverse: [{
      unit_id: unitId,
      source_fingerprint: digest(`source:${unitId}`),
      conversion_fingerprint: digest(`conversion:${unitId}`),
    }],
  });

  assert.deepEqual(
    evidence.payload.scope === "universe" ? evidence.payload.source_universe.map((unit) => unit.unit_id) : [],
    [unitId],
  );
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
  forgedReceipt.payload.authorization_sha256 = digest("other-receipt");
  forgedReceipt.plan_sha256 = canonicalSha256(forgedReceipt.payload);
  assert.throws(
    () => validateBatchPlanDraft(forgedReceipt, { ...receipt, universeEvidence }),
    /does not match its receipt or universe evidence/u,
  );

  const otherUniverse = createPendingBatchUniverseEvidence({
    capturedAt: "2026-07-20T00:31:00.000Z",
    stagingRunSha256: digest("other-staging-run"),
    fullPlanSha256: digest("other-full-plan"),
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

test("batch writers durably reuse exact plans/results and reject an altered resume journal", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-batch-journal-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const receipt = validReceiptContext();
  const universeEvidence = pendingUniverseEvidence(25);
  const plan = firstPlan(receipt, universeEvidence);
  const executionEvidence = pendingExecutionEvidence(universeEvidence, plan);
  const result = resultFor(receipt, universeEvidence, plan, executionEvidence);

  const planPath = await writeBatchPlanDraft(
    stateDir,
    plan,
    { ...receipt, universeEvidence },
  );
  const resultPath = await writeBatchResultDraft(
    stateDir,
    result,
    {
      ...receipt,
      universeEvidence,
      plan,
      executionEvidence,
    },
  );
  await access(planPath);
  await access(resultPath);
  assert.equal(
    await writeBatchPlanDraft(stateDir, plan, { ...receipt, universeEvidence }),
    planPath,
  );
  assert.equal(
    await writeBatchResultDraft(stateDir, result, {
      ...receipt,
      universeEvidence,
      plan,
      executionEvidence,
    }),
    resultPath,
  );
  assert.deepEqual(JSON.parse(await readFile(planPath, "utf8")), plan);
  assert.deepEqual(JSON.parse(await readFile(resultPath, "utf8")), result);

  await writeFile(planPath, `${JSON.stringify({ ...plan, plan_sha256: digest("tampered") })}\n`, "utf8");
  await assert.rejects(
    writeBatchPlanDraft(stateDir, plan, { ...receipt, universeEvidence }),
    /existing batch journal content differs|plan SHA-256/u,
  );

  await assert.rejects(
    writeBatchPlanDraft(stateDir, plan, {
      ...receipt,
      scoreReportContent: `${receipt.scoreReportContent} `,
      universeEvidence,
    }),
    /score report content SHA-256 or byte length/u,
  );
});

test("the storage rollback journal records only newly-created objects as rollback targets", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-journal-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const runSha256 = digest("run");
  const batchSha256 = digest("batch");
  const journal = createStorageRollbackJournal({
    runSha256,
    batchSha256,
    batchIndex: 1,
    objects: [{
      bucket: "disclosure-raw",
      object_key: `${digest("raw")}.pdf`,
      sha256: digest("raw"),
      bytes: 100,
      created: true,
    }, {
      bucket: "disclosure-preview",
      object_key: `${digest("preview")}.txt`,
      sha256: digest("preview"),
      bytes: 50,
      created: false,
    }],
  });

  assert.deepEqual(journal.payload.rollback_objects, [journal.payload.objects[0]]);
  const journalPath = await writeStorageRollbackJournal(stateDir, journal);
  assert.deepEqual(JSON.parse(await readFile(journalPath, "utf8")), journal);
  assert.equal(await writeStorageRollbackJournal(stateDir, journal), journalPath);

  const replayAfterSuccessfulUpload = createStorageRollbackJournal({
    runSha256,
    batchSha256,
    batchIndex: 1,
    objects: journal.payload.objects.map((object) => ({ ...object, created: false })),
  });
  assert.equal(
    await writeStorageRollbackJournal(stateDir, replayAfterSuccessfulUpload),
    journalPath,
  );
  assert.deepEqual(JSON.parse(await readFile(journalPath, "utf8")), journal);

  const recreatedPreviouslyExisting = createStorageRollbackJournal({
    runSha256,
    batchSha256,
    batchIndex: 1,
    objects: journal.payload.objects.map((object, index) => ({
      ...object,
      created: index === 1,
    })),
  });
  assert.equal(
    await writeStorageRollbackJournal(stateDir, recreatedPreviouslyExisting),
    journalPath,
  );
  assert.deepEqual(JSON.parse(await readFile(journalPath, "utf8")), journal);

  const forged = structuredClone(journal);
  forged.payload.objects[1]!.bytes += 1;
  forged.journal_sha256 = canonicalSha256(forged.payload);
  await assert.rejects(
    writeStorageRollbackJournal(stateDir, forged),
    /existing batch journal content differs/u,
  );
});

test("the storage intent journal is durable before ownership of any object is known", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-intent-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const runSha256 = digest("intent-run");
  const batchSha256 = digest("intent-batch");
  const journal = createStorageIntentJournal({
    runSha256,
    batchSha256,
    batchIndex: 1,
    objects: [{
      bucket: "disclosure-raw",
      object_key: `${digest("intent-raw")}.pdf`,
      sha256: digest("intent-raw"),
      bytes: 100,
    }],
  });

  const journalPath = await writeStorageIntentJournal(stateDir, journal);
  assert.deepEqual(JSON.parse(await readFile(journalPath, "utf8")), journal);
  assert.equal(await writeStorageIntentJournal(stateDir, journal), journalPath);

  const changed = createStorageIntentJournal({
    runSha256,
    batchSha256,
    batchIndex: 1,
    objects: [{
      bucket: "disclosure-raw",
      object_key: `${digest("other-raw")}.pdf`,
      sha256: digest("other-raw"),
      bytes: 100,
    }],
  });
  await assert.rejects(
    writeStorageIntentJournal(stateDir, changed),
    /existing batch journal content differs/u,
  );

  assert.deepEqual(await readStorageIntentJournals(stateDir, runSha256), [journal]);
});

test("each remotely verified Storage object has an immutable per-object ownership journal", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-object-journal-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const runSha256 = digest("object-run");
  const batchSha256 = digest("object-batch");
  const objectSha256 = digest("object-content");
  const journal = createStorageObjectJournal({
    runSha256,
    batchSha256,
    batchIndex: 1,
    objectIndex: 1,
    claim: {
      bucket: "disclosure-raw",
      object_key: `${objectSha256}.pdf`,
      sha256: objectSha256,
      bytes: 123,
      claim_token: "11111111-1111-4111-8111-111111111111",
      claim_epoch: 1,
      claimant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      claim_action: "upload",
      claim_expires_at: "2026-07-20T06:10:00.000Z",
    },
    uploadAttempt: 1,
    object: {
      bucket: "disclosure-raw",
      object_key: `${objectSha256}.pdf`,
      sha256: objectSha256,
      bytes: 123,
      created: true,
    },
  });

  const journalPath = await writeStorageObjectJournal(stateDir, journal);
  assert.deepEqual(JSON.parse(await readFile(journalPath, "utf8")), journal);
  assert.equal(await writeStorageObjectJournal(stateDir, journal), journalPath);
  const forged = structuredClone(journal);
  forged.payload.object.created = false;
  forged.journal_sha256 = canonicalSha256(forged.payload);
  await assert.rejects(
    writeStorageObjectJournal(stateDir, forged),
    /existing batch journal content differs/u,
  );
});

test("an interrupted upload stays fail-closed past lease expiry and one manual receipt authorizes one retry", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-upload-crash-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const runSha256 = digest("upload-crash-run");
  const batchSha256 = digest("upload-crash-batch");
  const objectSha256 = digest("upload-crash-object");
  const claim = {
    bucket: "disclosure-raw" as const,
    object_key: `${objectSha256}.pdf`,
    sha256: objectSha256,
    bytes: 42,
    claim_token: "55555555-5555-4555-8555-555555555555",
    claim_epoch: 7,
    claimant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    claim_action: "upload" as const,
    // Deliberately expired: expiry must never silently authorize retry/abort.
    claim_expires_at: "2026-07-20T06:10:00.000Z",
  };
  const base = {
    runSha256,
    batchSha256,
    batchIndex: 1,
    objectIndex: 1,
    claim,
  };

  const first = await beginStorageUploadAttempt(stateDir, {
    ...base,
    startedAt: "2026-07-20T06:00:00.000Z",
    freshClaim: true,
  });
  assert.deepEqual(
    { uploadAttempt: first.uploadAttempt, shouldUpload: first.shouldUpload },
    { uploadAttempt: 1, shouldUpload: true },
  );
  await assert.rejects(
    beginStorageUploadAttempt(stateDir, {
      ...base,
      startedAt: "2026-07-20T07:00:00.000Z",
      freshClaim: false,
    }),
    /storage_upload_manual_reconciliation_required.*attempt=1/u,
  );

  const receipt = createStorageUploadReconcileReceipt({
    ...base,
    previousUploadAttempt: 1,
    confirmedNoInflightAt: "2026-07-20T07:01:00.000Z",
    reason: "operator confirmed the prior HTTP request is no longer in flight",
  });
  await writeStorageUploadReconcileReceipt(stateDir, receipt);
  const second = await beginStorageUploadAttempt(stateDir, {
    ...base,
    startedAt: "2026-07-20T07:02:00.000Z",
    freshClaim: false,
  });
  assert.deepEqual(
    { uploadAttempt: second.uploadAttempt, shouldUpload: second.shouldUpload },
    { uploadAttempt: 2, shouldUpload: true },
  );
  await assert.rejects(
    beginStorageUploadAttempt(stateDir, {
      ...base,
      startedAt: "2026-07-20T08:00:00.000Z",
      freshClaim: false,
    }),
    /storage_upload_manual_reconciliation_required.*attempt=2/u,
    "the attempt-2 receipt cannot be reused to authorize attempt 3",
  );

  await writeStorageObjectJournal(stateDir, createStorageObjectJournal({
    ...base,
    uploadAttempt: 2,
    object: {
      bucket: claim.bucket,
      object_key: claim.object_key,
      sha256: claim.sha256,
      bytes: claim.bytes,
      created: true,
    },
  }));
  const observedResume = await beginStorageUploadAttempt(stateDir, {
    ...base,
    startedAt: "2026-07-20T08:01:00.000Z",
    freshClaim: false,
  });
  assert.deepEqual(observedResume, {
    uploadAttempt: 2,
    shouldUpload: false,
    journalPath: null,
  });
});

test("a copied durable claimant cannot automatically open a second HTTP uploader", async (t) => {
  const stateA = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-claimant-a-"));
  const stateB = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-claimant-b-"));
  t.after(async () => Promise.all([
    rm(stateA, { recursive: true, force: true }),
    rm(stateB, { recursive: true, force: true }),
  ]));
  const runSha256 = digest("copied-claim-run");
  const batchSha256 = digest("copied-claim-batch");
  const objectSha256 = digest("copied-claim-object");
  const claim = {
    bucket: "disclosure-raw" as const,
    object_key: `${objectSha256}.pdf`,
    sha256: objectSha256,
    bytes: 42,
    claim_token: "aaaaaaaa-1111-4111-8111-111111111111",
    claim_epoch: 1,
    claimant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    claim_action: "upload" as const,
    claim_expires_at: "2026-07-20T06:10:00.000Z",
  };
  const journal = createStorageUploadClaimJournal({
    runSha256,
    batchSha256,
    batchIndex: 1,
    objectIndex: 1,
    claim,
  });
  await Promise.all([
    writeStorageUploadClaimJournal(stateA, journal),
    writeStorageUploadClaimJournal(stateB, journal),
  ]);

  let uploaderEntries = 0;
  for (const stateDir of [stateA, stateB]) {
    await assert.rejects(
      beginStorageUploadAttempt(stateDir, {
        runSha256,
        batchSha256,
        batchIndex: 1,
        objectIndex: 1,
        claim,
        startedAt: "2026-07-20T07:00:00.000Z",
        freshClaim: false,
      }).then((result) => {
        if (result.shouldUpload) uploaderEntries += 1;
      }),
      /storage_upload_manual_reconciliation_required.*attempt=0/u,
    );
  }
  assert.equal(uploaderEntries, 0);

  await writeStorageUploadReconcileReceipt(stateA, createStorageUploadReconcileReceipt({
    runSha256,
    batchSha256,
    batchIndex: 1,
    objectIndex: 1,
    claim,
    previousUploadAttempt: 0,
    confirmedNoInflightAt: "2026-07-20T07:01:00.000Z",
    reason: "operator confirmed the recalled claim never entered HTTP upload",
  }));
  const authorized = await beginStorageUploadAttempt(stateA, {
    runSha256,
    batchSha256,
    batchIndex: 1,
    objectIndex: 1,
    claim,
    startedAt: "2026-07-20T07:02:00.000Z",
    freshClaim: false,
  });
  assert.deepEqual(
    { uploadAttempt: authorized.uploadAttempt, shouldUpload: authorized.shouldUpload },
    { uploadAttempt: 1, shouldUpload: true },
  );
  await assert.rejects(
    beginStorageUploadAttempt(stateA, {
      runSha256,
      batchSha256,
      batchIndex: 1,
      objectIndex: 1,
      claim,
      startedAt: "2026-07-20T07:03:00.000Z",
      freshClaim: false,
    }),
    /storage_upload_manual_reconciliation_required.*attempt=1/u,
    "the attempt-1 receipt cannot authorize another upload",
  );
});

test("the state-aware runner applies exact 25-unit slices and reuses the same immutable resume chain", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-state-aware-runner-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const receipt = validReceiptContext();
  const calls: number[] = [];
  const remoteReceiptChecks: number[] = [];
  const executeBatch = async (plan: BatchPlanDraft) => {
    calls.push(plan.payload.batch_index);
    return {
      stagingSnapshotSha256: digest(`snapshot:${plan.plan_sha256}`),
      remoteBatchReceiptSha256: digest(`receipt:${plan.plan_sha256}`),
      executionLedgerSha256: digest(`ledger:${plan.plan_sha256}`),
      unitResults: completedRows(plan, 0),
    };
  };
  const input = {
    stateDir,
    startedAt: "2026-07-20T06:00:00.000Z",
    stagingRunSha256: digest("runner-staging-run"),
    fullPlanSha256: digest("runner-full-plan"),
    manifestSha256: digest("runner-manifest"),
    sourceUniverse: sourceUniverse(26),
    ...receipt,
    executeBatch,
    verifyPersistedBatchReceipt: async (plan: BatchPlanDraft, remoteReceiptSha256: string) => {
      remoteReceiptChecks.push(plan.payload.batch_index);
      assert.equal(remoteReceiptSha256, digest(`receipt:${plan.plan_sha256}`));
    },
  };

  const first = await runStateAwareBatches(input);
  const second = await runStateAwareBatches(input);
  const inspected = await inspectCompletedStateAwareBatches({
    stateDir,
    startedAt: input.startedAt,
    stagingRunSha256: input.stagingRunSha256,
    fullPlanSha256: input.fullPlanSha256,
    manifestSha256: input.manifestSha256,
    sourceUniverse: input.sourceUniverse,
    ...receipt,
    verifyPersistedBatchReceipt: input.verifyPersistedBatchReceipt,
  });

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(remoteReceiptChecks, [1, 2, 1, 2]);
  assert.deepEqual(first.plans.map((plan) => plan.payload.units.length), [25, 1]);
  assert.deepEqual(first.results.map((result) => result.payload.status), ["pass", "pass"]);
  assert.deepEqual(
    second.results.map((result) => result.result_sha256),
    first.results.map((result) => result.result_sha256),
  );
  await Promise.all(first.planPaths.map((planPath) => access(planPath)));
  await access(first.universeEvidencePath);
  await Promise.all(first.executionEvidencePaths.map((evidencePath) => access(evidencePath)));
  await Promise.all(first.resultPaths.map((resultPath) => access(resultPath)));
  assert.equal(second.universeEvidencePath, first.universeEvidencePath);
  assert.deepEqual(second.executionEvidencePaths, first.executionEvidencePaths);
  assert.deepEqual(
    inspected.results.map((result) => result.result_sha256),
    first.results.map((result) => result.result_sha256),
  );

  await assert.rejects(
    runStateAwareBatches({ ...input, startedAt: "2026-07-20T06:01:00.000Z" }),
    /existing batch journal content differs/u,
  );

  const changedPlan = await runStateAwareBatches({
    ...input,
    stagingRunSha256: digest("runner-staging-run-v2"),
    fullPlanSha256: digest("runner-full-plan-v2"),
  });
  assert.deepEqual(calls, [1, 2, 1, 2]);
  assert.notEqual(changedPlan.universeEvidencePath, first.universeEvidencePath);
});

test("the run descriptor is content-addressed, durable, and cannot change target or batch hashes on resume", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-run-descriptor-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const payload = {
    schema_version: 2 as const,
    kind: "vendor_disclosure_staging_run" as const,
    started_at: "2026-07-20T06:00:00.000Z",
    target_project_ref: "staging-ref",
    snapshot: "2026Q3",
    full_plan_sha256: digest("full-plan"),
    dedupe_candidates_sha256: digest("dedupe"),
    authorization_kind: "local_validated_pending_only" as const,
    authorization_sha256: digest("pending-authorization"),
    local_pending_only_unit_ids: [digest("local-unit")],
    batch_sha256s: [digest("batch-1")],
  };
  const descriptor = { ...payload, run_sha256: canonicalSha256(payload) };
  const runPath = await writeStagingRunDescriptor(stateDir, descriptor);
  assert.deepEqual(JSON.parse(await readFile(runPath, "utf8")), descriptor);
  assert.equal(await writeStagingRunDescriptor(stateDir, descriptor), runPath);

  const changedPayload = { ...payload, target_project_ref: "other-staging-ref" };
  const forged = { ...changedPayload, run_sha256: canonicalSha256(changedPayload) };
  await assert.rejects(
    writeStagingRunDescriptor(stateDir, forged),
    /run SHA-256|existing batch journal content differs/u,
  );

  const wrongRequestedPlanSha256 = digest("wrong-requested-full-plan");
  const wrongDirectory = path.join(
    stateDir,
    "batch-journal",
    "runs",
    wrongRequestedPlanSha256,
  );
  await mkdir(wrongDirectory, { recursive: true });
  await writeFile(path.join(wrongDirectory, "run.json"), JSON.stringify(descriptor));
  await assert.rejects(
    readStagingRunDescriptor(stateDir, wrongRequestedPlanSha256),
    /full plan|path.*payload|requested/iu,
  );
});

test("a finalize intent is immutable and blocks phase-one replay after finalization starts", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-finalize-intent-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const intent = createStagingFinalizeIntent({
    targetProjectRef: "staging-ref",
    runSha256: digest("finalize-run"),
    fullPlanSha256: digest("finalize-full-plan"),
    authorizationSha256: digest("finalize-authorization"),
    dedupeCandidatesSha256: digest("finalize-dedupe"),
    completedBatchSha256s: [digest("finalize-batch-1"), digest("finalize-batch-2")],
  });

  const intentPath = await writeStagingFinalizeIntent(stateDir, intent);
  assert.deepEqual(JSON.parse(await readFile(intentPath, "utf8")), intent);
  assert.deepEqual(
    await readStagingFinalizeIntent(stateDir, intent.payload.full_plan_sha256),
    intent,
  );
  assert.equal(await writeStagingFinalizeIntent(stateDir, intent), intentPath);

  const wrongRequestedPlanSha256 = digest("wrong-finalize-intent-plan");
  const wrongDirectory = path.join(
    stateDir,
    "batch-journal",
    "runs",
    wrongRequestedPlanSha256,
  );
  await mkdir(wrongDirectory, { recursive: true });
  await writeFile(path.join(wrongDirectory, "finalize-intent.json"), JSON.stringify(intent));
  await assert.rejects(
    readStagingFinalizeIntent(stateDir, wrongRequestedPlanSha256),
    /full plan|path.*payload|requested/iu,
  );

  const changed = createStagingFinalizeIntent({
    targetProjectRef: intent.payload.target_project_ref,
    runSha256: intent.payload.run_sha256,
    fullPlanSha256: intent.payload.full_plan_sha256,
    authorizationSha256: intent.payload.authorization_sha256,
    dedupeCandidatesSha256: intent.payload.dedupe_candidates_sha256,
    completedBatchSha256s: [digest("different-finalize-batch")],
  });
  await assert.rejects(
    writeStagingFinalizeIntent(stateDir, changed),
    /existing batch journal content differs/u,
  );
});

test("a Storage rollback receipt durably binds the exact resumable completion set", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-storage-rollback-receipt-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const firstSha256 = "1".repeat(64);
  const secondSha256 = "2".repeat(64);
  const receipt = createStagingStorageRollbackReceipt({
    targetProjectRef: "staging-ref",
    runSha256: digest("rollback-receipt-run"),
    fullPlanSha256: digest("rollback-receipt-plan"),
    reason: "operator-confirmed rollback",
    storageRollbackReceiptSha256: digest("database-issued-rollback-receipt"),
    storageRollbackObjects: [
      { bucket: "disclosure-preview", object_key: `${secondSha256}.txt`, sha256: secondSha256, bytes: 2 },
      { bucket: "disclosure-raw", object_key: `${firstSha256}.pdf`, sha256: firstSha256, bytes: 1 },
    ],
  });
  assert.deepEqual(receipt.payload.storage_rollback_objects.map((object) => object.bucket), [
    "disclosure-preview",
    "disclosure-raw",
  ].sort((left, right) => `${left}\0`.localeCompare(`${right}\0`)));

  const receiptPath = await writeStagingStorageRollbackReceipt(stateDir, receipt);
  assert.deepEqual(
    await readStagingStorageRollbackReceipt(stateDir, receipt.payload.full_plan_sha256),
    receipt,
  );
  assert.equal(await writeStagingStorageRollbackReceipt(stateDir, receipt), receiptPath);

  const changed = createStagingStorageRollbackReceipt({
    targetProjectRef: receipt.payload.target_project_ref,
    runSha256: receipt.payload.run_sha256,
    fullPlanSha256: receipt.payload.full_plan_sha256,
    reason: receipt.payload.reason,
    storageRollbackReceiptSha256: receipt.payload.storage_rollback_receipt_sha256,
    storageRollbackObjects: receipt.payload.storage_rollback_objects.slice(0, 1),
  });
  await assert.rejects(
    writeStagingStorageRollbackReceipt(stateDir, changed),
    /existing batch journal content differs/u,
  );
});
