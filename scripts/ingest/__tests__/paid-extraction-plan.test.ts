import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPaidExtractionBatchPlanApprovalMatches,
  assertFixedEightPaidExtractionPlanApprovalMatches,
  assertPaidExtractionAttemptRequestAuthorized,
  assertPaidExtractionAttemptReservationAuthorized,
  assertPaidExtractionPlannedRequestHashes,
  createPaidExtractionBatchPlanApproval,
  createFixedEightPaidExtractionPlanApproval,
  fixedEightPaidExtractionPlanPath,
  MAX_FIXED_EIGHT_APPROVED_COST_USD,
  PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
  PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
  readFixedEightPaidExtractionPlanApproval,
  readPaidExtractionPlanApproval,
  validatePaidExtractionBatchPlanApproval,
  validateFixedEightPaidExtractionPlanApproval,
  writeFixedEightPaidExtractionPlanApproval,
  writePaidExtractionBatchPlanApproval,
  type CreatePaidExtractionPlanApprovalInput,
} from "../paid-extraction-plan.js";
import { canonicalSha256 } from "../gate-integrity.js";
import { estimateExtractionCostUsd } from "../ledger.js";
import { nanoUsdToUsd, providerBoundReservation } from "../paid-extraction-budget.js";
import { FIXED_EIGHT_ORDERED_UNIT_IDS } from "../pilot-pass-receipt.js";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validInput(): CreatePaidExtractionPlanApprovalInput {
  return {
    executionDomain: {
      domain_id: "11111111-1111-4111-8111-111111111111",
      authority_root_realpath: path.resolve(os.tmpdir(), "authority"),
      authoritative_state_dir_realpath: path.resolve(os.tmpdir(), "state"),
      genesis_ledger: {
        relative_path: ".cache/ai-ledger.ndjson",
        content_sha256: hash(""),
        byte_count: 0,
        row_count: 0,
        cumulative_cost_usd: 0,
      },
    },
    model: "gpt-5.6-luna",
    scannerParserVersion: "scanner-v-test",
    authorizedCostCeilingUsd: MAX_FIXED_EIGHT_APPROVED_COST_USD,
    domainCommittedCostNanoUsd: 0,
    priorDurableLedger: {
      relative_path: ".cache/ai-ledger.ndjson",
      content_sha256: hash(""),
      byte_count: 0,
      row_count: 0,
      cumulative_cost_usd: 0,
    },
    units: FIXED_EIGHT_ORDERED_UNIT_IDS.map((unitId, index) => {
      const requestHashes = [hash(`request:${index}:0`), hash(`request:${index}:1`)];
      const authorizedRequestReservationsByBatch = requestHashes.map((requestHash, batchIndex) => [
        {
          requestHash,
          maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
          maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
        },
      ]);
      const plannedRequestEstimates = requestHashes.map((requestHash, batchIndex) => ({
        requestHash,
        estimatedInputTokens: 5_000 + index + batchIndex,
        estimatedOutputTokens: 1_000 + index + batchIndex,
      }));
      return {
        unitId,
        extractionFingerprint: hash(`extraction:${index}`),
        sourceFingerprint: hash(`source:${index}`),
        artifactFingerprint: hash(`artifact:${index}`),
        converterVersion: "converter-v-test",
        requestHashes,
        authorizedRequestReservationsByBatch,
        plannedRequestEstimates,
        estimatedInputTokens: plannedRequestEstimates.reduce(
          (sum, request) => sum + request.estimatedInputTokens,
          0,
        ),
        estimatedOutputTokens: plannedRequestEstimates.reduce(
          (sum, request) => sum + request.estimatedOutputTokens,
          0,
        ),
        maximumInputTokens: authorizedRequestReservationsByBatch.reduce(
          (sum, requests) => sum + (requests[0]!.maximumInputTokens * 4),
          0,
        ),
        maximumOutputTokens: authorizedRequestReservationsByBatch.length
          * PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP
          * 4,
      };
    }),
  };
}

function selectedBatchInput(unitCount: number): CreatePaidExtractionPlanApprovalInput {
  const input = validInput();
  const template = input.units[0]!;
  input.authorizedCostCeilingUsd = 20;
  input.units = Array.from({ length: unitCount }, (_, index) => {
    const requestHashes = template.requestHashes.map((_, requestIndex) =>
      hash(`selected:${index}:request:${requestIndex}`));
    const unit = structuredClone(template);
    unit.unitId = hash(`selected:${index}:unit`);
    unit.extractionFingerprint = hash(`selected:${index}:extraction`);
    unit.sourceFingerprint = hash(`selected:${index}:source`);
    unit.artifactFingerprint = hash(`selected:${index}:artifact`);
    unit.requestHashes = requestHashes;
    unit.authorizedRequestReservationsByBatch = requestHashes.map((requestHash) => [{
      requestHash,
      maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
      maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
    }]);
    unit.plannedRequestEstimates = requestHashes.map((requestHash, requestIndex) => ({
      requestHash,
      estimatedInputTokens: 100 + index + requestIndex,
      estimatedOutputTokens: 50 + index + requestIndex,
    }));
    unit.estimatedInputTokens = unit.plannedRequestEstimates.reduce(
      (sum, request) => sum + request.estimatedInputTokens,
      0,
    );
    unit.estimatedOutputTokens = unit.plannedRequestEstimates.reduce(
      (sum, request) => sum + request.estimatedOutputTokens,
      0,
    );
    return unit;
  });
  return input;
}

test("fixed-eight paid approval deterministically binds source, model, requests, and token-derived cost", () => {
  const input = validInput();
  const first = createFixedEightPaidExtractionPlanApproval(input);
  const second = createFixedEightPaidExtractionPlanApproval(structuredClone(input));

  assert.deepEqual(second, first);
  assert.equal(first.schema_version, 4);
  assert.equal(first.payload.execution_domain.domain_id, input.executionDomain.domain_id);
  assert.equal(first.plan_sha256, canonicalSha256(first.payload));
  assert.deepEqual(first.payload.ordered_unit_ids, FIXED_EIGHT_ORDERED_UNIT_IDS);
  assert.deepEqual(
    first.payload.units.map((unit) => unit.unit_id),
    FIXED_EIGHT_ORDERED_UNIT_IDS,
  );
  assert.equal(first.payload.cost.input_usd_per_million, 1.25);
  assert.equal(first.payload.cost.output_usd_per_million, 6);
  assert.equal(first.payload.cost.request_count, 16);
  assert.deepEqual(
    first.payload.units[0].authorized_request_hashes_by_batch,
    first.payload.units[0].request_hashes.map((requestHash) => [requestHash]),
  );
  assert.equal(first.payload.cost.completion_not_guaranteed, true);
  assert.equal(first.payload.cost.approval_policy, "sequential_runtime_fence_v1");
  assert.ok(first.payload.cost.estimated_cost_usd < first.payload.cost.authorized_ceiling_usd);
  assert.doesNotMatch(JSON.stringify(first), /OPENAI_API_KEY|source_path/iu);
});

test("caller-selected paid batch approval binds the exact ordered 1..25 unit selection", () => {
  const input = validInput();
  input.units = [input.units[3]!, input.units[1]!, input.units[6]!];

  const approval = createPaidExtractionBatchPlanApproval(input);

  assert.equal(approval.schema_version, 5);
  assert.equal(approval.kind, "paid_extraction_batch_plan_approval");
  assert.deepEqual(
    approval.payload.ordered_unit_ids,
    input.units.map((unit) => unit.unitId),
  );
  assert.deepEqual(
    approval.payload.units.map((unit) => unit.unit_id),
    input.units.map((unit) => unit.unitId),
  );
  assert.equal(approval.plan_sha256, canonicalSha256({
    schema_version: approval.schema_version,
    kind: approval.kind,
    payload: approval.payload,
  }));
});

test("caller-selected paid batch accepts 25 units and rejects empty, oversized, or reordered payloads", () => {
  const approval = createPaidExtractionBatchPlanApproval(selectedBatchInput(25));
  assert.equal(approval.payload.units.length, 25);

  assert.throws(
    () => createPaidExtractionBatchPlanApproval(selectedBatchInput(0)),
    /too_small|at least 1|Array must contain/iu,
  );
  assert.throws(
    () => createPaidExtractionBatchPlanApproval(selectedBatchInput(26)),
    /too_big|at most 25|Array must contain/iu,
  );

  const reordered = structuredClone(approval);
  [reordered.payload.ordered_unit_ids[0], reordered.payload.ordered_unit_ids[1]] = [
    reordered.payload.ordered_unit_ids[1]!,
    reordered.payload.ordered_unit_ids[0]!,
  ];
  reordered.plan_sha256 = canonicalSha256(reordered.payload);
  assert.throws(
    () => validatePaidExtractionBatchPlanApproval(reordered),
    /caller-selected order/u,
  );
});

test("caller-selected paid batch supports a bounded 256 request chunks per unit", () => {
  const input = selectedBatchInput(1);
  const unit = input.units[0]!;
  const requestHashes = Array.from({ length: 256 }, (_, index) =>
    hash(`large-unit:request:${index}`));
  unit.requestHashes = requestHashes;
  unit.authorizedRequestReservationsByBatch = requestHashes.map((requestHash) => [{
    requestHash,
    maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
    maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
  }]);
  unit.plannedRequestEstimates = requestHashes.map((requestHash) => ({
    requestHash,
    estimatedInputTokens: 1,
    estimatedOutputTokens: 1,
  }));
  unit.estimatedInputTokens = requestHashes.length;
  unit.estimatedOutputTokens = requestHashes.length;
  unit.maximumInputTokens = requestHashes.length
    * PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND
    * 4;
  unit.maximumOutputTokens = requestHashes.length
    * PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP
    * 4;

  assert.equal(
    createPaidExtractionBatchPlanApproval(input).payload.units[0]!.request_count,
    256,
  );

  unit.requestHashes.push(hash("large-unit:request:256"));
  unit.authorizedRequestReservationsByBatch.push([{
    requestHash: unit.requestHashes[256]!,
    maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
    maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
  }]);
  unit.plannedRequestEstimates.push({
    requestHash: unit.requestHashes[256]!,
    estimatedInputTokens: 1,
    estimatedOutputTokens: 1,
  });
  unit.estimatedInputTokens += 1;
  unit.estimatedOutputTokens += 1;
  unit.maximumInputTokens += PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND * 4;
  unit.maximumOutputTokens += PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP * 4;
  assert.throws(
    () => createPaidExtractionBatchPlanApproval(input),
    /too_big|at most 256|Array must contain/iu,
  );
});

test("approval creation rejects selection drift, estimates above the ceiling, and a single unaffordable attempt", () => {
  const reordered = validInput();
  [reordered.units[0], reordered.units[1]] = [reordered.units[1], reordered.units[0]];
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(reordered),
    /exact fixed-eight order/u,
  );

  const overBudget = validInput();
  overBudget.authorizedCostCeilingUsd = 0.000001;
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(overBudget),
    /estimated cost exceeds the authorized ceiling/u,
  );

  const maximumOnlyOverBudget = validInput();
  maximumOnlyOverBudget.authorizedCostCeilingUsd = 1;
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(maximumOnlyOverBudget),
    /maximum single-attempt reservation exceeds the authorized ceiling/u,
  );
});

test("the paid plan binds every Luna attempt to the documented long-context reserve", () => {
  const approved = createFixedEightPaidExtractionPlanApproval(validInput());
  assert.equal(approved.payload.cost.maximum_single_attempt_cost_usd, 2.769);
  assert.equal(approved.payload.cost.completion_not_guaranteed, true);

  const oneTokenOver = validInput();
  oneTokenOver.units[0].authorizedRequestReservationsByBatch[0]![0]!
    .maximumInputTokens += 1;
  oneTokenOver.units[0].maximumInputTokens += 4;
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(oneTokenOver),
    /provider context-window input bound/u,
  );
});

test("aggregate worst-case cost is informational when expected cost and every next attempt fit", () => {
  const input = validInput();
  const approval = createFixedEightPaidExtractionPlanApproval(input);
  assert.ok(approval.payload.cost.estimated_cost_usd < input.authorizedCostCeilingUsd);
  assert.ok(approval.payload.cost.maximum_single_attempt_cost_usd < input.authorizedCostCeilingUsd);
  assert.ok(approval.payload.cost.maximum_cost_usd > input.authorizedCostCeilingUsd);
  assert.equal(approval.payload.cost.completion_not_guaranteed, true);
});

test("a one nano-USD short ceiling fails while the exact conservative reservation passes", () => {
  const reservation = providerBoundReservation("gpt-5.6-luna");
  const oneNanoShort = validInput();
  oneNanoShort.authorizedCostCeilingUsd = nanoUsdToUsd(
    reservation.maximumCostNanoUsd - 1,
  );
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(oneNanoShort),
    /maximum single-attempt reservation exceeds the authorized ceiling/u,
  );

  const exact = validInput();
  exact.authorizedCostCeilingUsd = nanoUsdToUsd(reservation.maximumCostNanoUsd);
  const approval = createFixedEightPaidExtractionPlanApproval(exact);
  assert.equal(
    approval.payload.cost.maximum_single_attempt_cost_nano_usd,
    reservation.maximumCostNanoUsd,
  );
  assert.equal(
    approval.payload.cost.absolute_domain_limit_nano_usd,
    reservation.maximumCostNanoUsd,
  );
});

test("approval validation rejects self-rehashed stale contracts and forged cost totals", () => {
  const approval = createFixedEightPaidExtractionPlanApproval(validInput());
  const stale = structuredClone(approval);
  stale.payload.prompt_version = "stale-prompt";
  stale.plan_sha256 = canonicalSha256(stale.payload);
  assert.throws(
    () => validateFixedEightPaidExtractionPlanApproval(stale),
    /stale extraction contract/u,
  );

  const forgedCost = structuredClone(approval);
  forgedCost.payload.cost.estimated_cost_usd = 0;
  forgedCost.plan_sha256 = canonicalSha256(forgedCost.payload);
  assert.throws(
    () => validateFixedEightPaidExtractionPlanApproval(forgedCost),
    /exactly derived/u,
  );

  const unauthorizedInitial = structuredClone(approval);
  unauthorizedInitial.payload.units[0].authorized_request_hashes_by_batch[0] = [
    hash("not-the-initial-request"),
  ];
  unauthorizedInitial.plan_sha256 = canonicalSha256(unauthorizedInitial.payload);
  assert.throws(
    () => validateFixedEightPaidExtractionPlanApproval(unauthorizedInitial),
    /initial planned request hash/u,
  );
});

test("exact-match verification detects source, request, model, and ceiling drift after approval", () => {
  const input = validInput();
  const approval = createFixedEightPaidExtractionPlanApproval(input);

  const changedSource = structuredClone(input);
  changedSource.units[0].sourceFingerprint = hash("changed-source");
  assert.throws(
    () => assertFixedEightPaidExtractionPlanApprovalMatches(approval, changedSource, approval.plan_sha256),
    /no longer matches/u,
  );

  const changedRequest = structuredClone(input);
  changedRequest.units[0].requestHashes[0] = hash("changed-request");
  assert.throws(
    () => assertFixedEightPaidExtractionPlanApprovalMatches(approval, changedRequest, approval.plan_sha256),
    /no longer matches|initial planned request hash/u,
  );

  const changedModel = structuredClone(input);
  changedModel.model = "gpt-5.6-terra";
  assert.throws(
    () => assertFixedEightPaidExtractionPlanApprovalMatches(approval, changedModel, approval.plan_sha256),
    /no longer matches/u,
  );

  const lowerCeiling = structuredClone(input);
  lowerCeiling.authorizedCostCeilingUsd = (
    approval.payload.cost.maximum_single_attempt_cost_usd + input.authorizedCostCeilingUsd
  ) / 2;
  assert.throws(
    () => assertFixedEightPaidExtractionPlanApprovalMatches(approval, lowerCeiling, approval.plan_sha256),
    /no longer matches/u,
  );

  const changedLedgerSnapshot = structuredClone(input);
  changedLedgerSnapshot.priorDurableLedger.content_sha256 = hash("changed-ledger");
  assert.throws(
    () => assertFixedEightPaidExtractionPlanApprovalMatches(
      approval,
      changedLedgerSnapshot,
      approval.plan_sha256,
    ),
    /no longer matches|exactly match/u,
  );
});

test("planned and attempted request hashes fail closed outside the exact per-batch allow-list", () => {
  const input = validInput();
  input.units[0].authorizedRequestReservationsByBatch = input.units[0].requestHashes.map(
    (requestHash, index) => index === 0
      ? [
          { requestHash, maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND, maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP },
          { requestHash: hash("static-retry:0"), maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND, maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP },
        ]
      : [{ requestHash, maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND, maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP }],
  );
  input.units[0].maximumInputTokens = input.units[0].authorizedRequestReservationsByBatch.reduce(
    (sum, batch) => sum + (Math.max(...batch.map((request) => request.maximumInputTokens)) * 4),
    0,
  );
  const approval = createFixedEightPaidExtractionPlanApproval(input);
  const unit = assertPaidExtractionPlannedRequestHashes(
    approval,
    FIXED_EIGHT_ORDERED_UNIT_IDS[0],
    input.units[0].requestHashes,
  );
  assert.equal(unit.unit_id, FIXED_EIGHT_ORDERED_UNIT_IDS[0]);
  assert.doesNotThrow(() => assertPaidExtractionAttemptRequestAuthorized(
    approval,
    unit.unit_id,
    0,
    hash("static-retry:0"),
  ));
  const staticRetry = approval.payload.units[0]
    .authorized_request_reservations_by_batch[0]![1]!;
  assert.doesNotThrow(() => assertPaidExtractionAttemptReservationAuthorized(
    approval,
    unit.unit_id,
    0,
    staticRetry.request_hash,
    {
      maximumInputTokens: staticRetry.maximum_input_tokens,
      maximumOutputTokens: staticRetry.maximum_output_tokens,
      maximumCostUsd: staticRetry.maximum_cost_usd,
    },
  ));
  assert.throws(
    () => assertPaidExtractionAttemptReservationAuthorized(
      approval,
      unit.unit_id,
      0,
      staticRetry.request_hash,
      {
        maximumInputTokens: staticRetry.maximum_input_tokens + 1,
        maximumOutputTokens: staticRetry.maximum_output_tokens,
        maximumCostUsd: estimateExtractionCostUsd(
          "gpt-5.6-luna",
          staticRetry.maximum_input_tokens + 1,
          staticRetry.maximum_output_tokens,
        ),
      },
    ),
    /reservation_does_not_exactly_match_authorized_maximum/u,
  );
  assert.throws(
    () => assertPaidExtractionAttemptReservationAuthorized(
      approval,
      unit.unit_id,
      0,
      staticRetry.request_hash,
      {
        maximumInputTokens: 0,
        maximumOutputTokens: 0,
        maximumCostUsd: 0,
      },
    ),
    /reservation_does_not_exactly_match_authorized_maximum/u,
  );
  assert.throws(
    () => assertPaidExtractionAttemptRequestAuthorized(
      approval,
      unit.unit_id,
      0,
      hash("response-dependent-retry"),
    ),
    /not_authorized/u,
  );
  assert.throws(
    () => assertPaidExtractionPlannedRequestHashes(
      approval,
      unit.unit_id,
      [hash("replaced-initial"), ...input.units[0].requestHashes.slice(1)],
    ),
    /planned_batch_request_hash_mismatch/u,
  );
});

test("request and reservation authorization helpers accept a generic batch plan", () => {
  const input = selectedBatchInput(2);
  const approval = createPaidExtractionBatchPlanApproval(input);
  const unit = approval.payload.units[1]!;
  const reservation = unit.authorized_request_reservations_by_batch[0]![0]!;

  assert.equal(
    assertPaidExtractionPlannedRequestHashes(
      approval,
      unit.unit_id,
      unit.request_hashes,
    ).unit_id,
    unit.unit_id,
  );
  assert.doesNotThrow(() => assertPaidExtractionAttemptRequestAuthorized(
    approval,
    unit.unit_id,
    0,
    reservation.request_hash,
  ));
  assert.doesNotThrow(() => assertPaidExtractionAttemptReservationAuthorized(
    approval,
    unit.unit_id,
    0,
    reservation.request_hash,
    {
      maximumInputTokens: reservation.maximum_input_tokens,
      maximumOutputTokens: reservation.maximum_output_tokens,
      maximumCostUsd: reservation.maximum_cost_usd,
    },
  ));
});

test("approval publication is content-addressed, exact-hash read-only, and idempotent only for exact bytes", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-plan-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const approval = createFixedEightPaidExtractionPlanApproval(validInput());

  const outputPath = await writeFixedEightPaidExtractionPlanApproval(stateDir, approval);
  assert.equal(outputPath, fixedEightPaidExtractionPlanPath(stateDir, approval.plan_sha256));
  assert.deepEqual(
    await readFixedEightPaidExtractionPlanApproval(stateDir, approval.plan_sha256),
    approval,
  );
  assert.equal(
    await writeFixedEightPaidExtractionPlanApproval(stateDir, approval),
    outputPath,
  );
  await assert.rejects(
    readFixedEightPaidExtractionPlanApproval(stateDir, hash("not-approved")),
  );

  const raw = JSON.parse(await readFile(outputPath, "utf8"));
  raw.payload.units[0].artifact_fingerprint = hash("tampered-artifact");
  await writeFile(outputPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  await assert.rejects(
    readFixedEightPaidExtractionPlanApproval(stateDir, approval.plan_sha256),
    /SHA-256/u,
  );
});

test("generic batch publication is content-addressed and the shared reader preserves fixed-eight compatibility", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-batch-plan-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const input = selectedBatchInput(3);
  const approval = createPaidExtractionBatchPlanApproval(input);

  await writePaidExtractionBatchPlanApproval(stateDir, approval);
  assert.deepEqual(
    await readPaidExtractionPlanApproval(stateDir, approval.plan_sha256),
    approval,
  );
  assert.deepEqual(
    assertPaidExtractionBatchPlanApprovalMatches(approval, input, approval.plan_sha256),
    approval,
  );

  const fixed = createFixedEightPaidExtractionPlanApproval(validInput());
  await writeFixedEightPaidExtractionPlanApproval(stateDir, fixed);
  assert.deepEqual(
    await readPaidExtractionPlanApproval(stateDir, fixed.plan_sha256),
    fixed,
  );
});

test("generic and historical envelopes cannot collide when their payloads are otherwise identical", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-plan-domain-separation-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const input = validInput();
  const fixed = createFixedEightPaidExtractionPlanApproval(input);
  const generic = createPaidExtractionBatchPlanApproval(input);

  assert.notEqual(generic.plan_sha256, fixed.plan_sha256);
  await writeFixedEightPaidExtractionPlanApproval(stateDir, fixed);
  await writePaidExtractionBatchPlanApproval(stateDir, generic);
  assert.deepEqual(
    await readPaidExtractionPlanApproval(stateDir, generic.plan_sha256),
    generic,
  );
});

test("idempotent publication rejects a semantically valid existing artifact with different bytes", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-plan-bytes-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const approval = createFixedEightPaidExtractionPlanApproval(validInput());
  const outputPath = await writeFixedEightPaidExtractionPlanApproval(stateDir, approval);

  await writeFile(outputPath, JSON.stringify(approval), "utf8");
  assert.deepEqual(
    await readFixedEightPaidExtractionPlanApproval(stateDir, approval.plan_sha256),
    approval,
  );
  await assert.rejects(
    writeFixedEightPaidExtractionPlanApproval(stateDir, approval),
    /existing paid extraction plan bytes do not match/u,
  );
});
