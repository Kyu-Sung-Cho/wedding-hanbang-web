import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertFixedEightPaidExtractionPlanApprovalMatches,
  assertPaidExtractionAttemptRequestAuthorized,
  assertPaidExtractionPlannedRequestHashes,
  createFixedEightPaidExtractionPlanApproval,
  fixedEightPaidExtractionPlanPath,
  MAX_FIXED_EIGHT_APPROVED_COST_USD,
  readFixedEightPaidExtractionPlanApproval,
  validateFixedEightPaidExtractionPlanApproval,
  writeFixedEightPaidExtractionPlanApproval,
  type CreatePaidExtractionPlanApprovalInput,
} from "../paid-extraction-plan.js";
import { canonicalSha256 } from "../gate-integrity.js";
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
    priorDurableLedger: {
      relative_path: ".cache/ai-ledger.ndjson",
      content_sha256: hash(""),
      byte_count: 0,
      row_count: 0,
      cumulative_cost_usd: 0,
    },
    units: FIXED_EIGHT_ORDERED_UNIT_IDS.map((unitId, index) => ({
      unitId,
      sourceFingerprint: hash(`source:${index}`),
      artifactFingerprint: hash(`artifact:${index}`),
      converterVersion: "converter-v-test",
      requestHashes: [hash(`request:${index}:0`), hash(`request:${index}:1`)],
      estimatedInputTokens: 10_000 + index,
      estimatedOutputTokens: 2_000 + index,
      maximumInputTokens: 50_000 + index,
      maximumOutputTokens: 32_000 + index,
    })),
  };
}

test("fixed-eight paid approval deterministically binds source, model, requests, and token-derived cost", () => {
  const input = validInput();
  const first = createFixedEightPaidExtractionPlanApproval(input);
  const second = createFixedEightPaidExtractionPlanApproval(structuredClone(input));

  assert.deepEqual(second, first);
  assert.equal(first.schema_version, 3);
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
  assert.ok(first.payload.cost.estimated_cost_usd < first.payload.cost.authorized_ceiling_usd);
  assert.doesNotMatch(JSON.stringify(first), /OPENAI_API_KEY|source_path/iu);
});

test("approval creation rejects selection drift and estimates above the approved ceiling", () => {
  const reordered = validInput();
  [reordered.units[0], reordered.units[1]] = [reordered.units[1], reordered.units[0]];
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(reordered),
    /exact fixed-eight order/u,
  );

  const overBudget = validInput();
  for (const unit of overBudget.units) {
    unit.estimatedInputTokens = 3_000_000;
    unit.maximumInputTokens = 3_000_000;
  }
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(overBudget),
    /estimated cost exceeds the authorized ceiling/u,
  );

  const maximumOnlyOverBudget = validInput();
  maximumOnlyOverBudget.authorizedCostCeilingUsd = 1;
  for (const unit of maximumOnlyOverBudget.units) {
    unit.maximumInputTokens = 200_000;
  }
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(maximumOnlyOverBudget),
    /maximum cost exceeds the authorized ceiling/u,
  );

  const unsafeAggregate = validInput();
  for (const unit of unsafeAggregate.units) {
    unit.maximumInputTokens = Number.MAX_SAFE_INTEGER;
  }
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(unsafeAggregate),
    /aggregate request and token totals must remain safe integers/u,
  );
});

test("the paid plan blocks a >1024-token cache-write upper bound before crossing $20", () => {
  const exactlyAtLimit = validInput();
  for (const unit of exactlyAtLimit.units) {
    unit.estimatedInputTokens = 0;
    unit.estimatedOutputTokens = 0;
    unit.maximumInputTokens = 0;
    unit.maximumOutputTokens = 0;
  }
  exactlyAtLimit.units[0].maximumInputTokens = 16_000_000;
  const approved = createFixedEightPaidExtractionPlanApproval(exactlyAtLimit);
  assert.equal(approved.payload.cost.maximum_cost_usd, 20);

  const oneTokenOver = structuredClone(exactlyAtLimit);
  oneTokenOver.units[0].maximumInputTokens += 1;
  assert.throws(
    () => createFixedEightPaidExtractionPlanApproval(oneTokenOver),
    /maximum cost exceeds the authorized ceiling/u,
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
    /no longer matches/u,
  );

  const changedModel = structuredClone(input);
  changedModel.model = "gpt-5.6-terra";
  assert.throws(
    () => assertFixedEightPaidExtractionPlanApprovalMatches(approval, changedModel, approval.plan_sha256),
    /no longer matches/u,
  );

  const lowerCeiling = structuredClone(input);
  lowerCeiling.authorizedCostCeilingUsd = (
    approval.payload.cost.maximum_cost_usd + input.authorizedCostCeilingUsd
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
  input.units[0].authorizedRequestHashesByBatch = input.units[0].requestHashes.map(
    (requestHash, index) => index === 0
      ? [requestHash, hash("static-retry:0")]
      : [requestHash],
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
