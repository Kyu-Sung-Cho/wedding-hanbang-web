import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertFixedEightPaidExtractionPlanApprovalMatches,
  assertPaidExtractionAttemptRequestAuthorized,
  assertPaidExtractionAttemptReservationAuthorized,
  assertPaidExtractionPlannedRequestHashes,
  createFixedEightPaidExtractionPlanApproval,
  fixedEightPaidExtractionPlanPath,
  MAX_FIXED_EIGHT_APPROVED_COST_USD,
  PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
  PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
  readFixedEightPaidExtractionPlanApproval,
  validateFixedEightPaidExtractionPlanApproval,
  writeFixedEightPaidExtractionPlanApproval,
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
