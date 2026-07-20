import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  claimPaidExecutionAttemptForTests,
  getPaidExecutionDomainStatusForTests,
  initializePaidExecutionDomainForTests,
  loadPaidExecutionDomainForPlanningForTests,
  verifyPaidExecutionDomainForPlanForTests,
} from "../paid-execution-domain.js";
import { appendAiLedgerEntry, createLedgerId, estimateExtractionCostUsd } from "../ledger.js";
import {
  createFixedEightPaidExtractionPlanApproval,
  writeFixedEightPaidExtractionPlanApproval,
} from "../paid-extraction-plan.js";
import { providerBoundReservation } from "../paid-extraction-budget.js";
import { FIXED_EIGHT_ORDERED_UNIT_IDS } from "../pilot-pass-receipt.js";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function createDomainTestPlan(
  stateDir: string,
  domain: Awaited<ReturnType<typeof initializePaidExecutionDomainForTests>>,
  options: { authorizedCostCeilingUsd?: number; domainCommittedCostNanoUsd?: number } = {},
): Promise<ReturnType<typeof createFixedEightPaidExtractionPlanApproval>> {
  const reservation = providerBoundReservation("gpt-5.6-luna");
  const plan = createFixedEightPaidExtractionPlanApproval({
    executionDomain: domain.binding,
    model: "gpt-5.6-luna",
    scannerParserVersion: "domain-test-scanner",
    authorizedCostCeilingUsd: options.authorizedCostCeilingUsd ?? 20,
    domainCommittedCostNanoUsd: options.domainCommittedCostNanoUsd
      ?? domain.cumulative_committed_cost_nano_usd,
    priorDurableLedger: domain.current_ledger,
    units: FIXED_EIGHT_ORDERED_UNIT_IDS.map((unitId, unitIndex) => {
      const requestHashes = Array.from({ length: 4 }, (_, batchIndex) =>
        digest(`domain:${unitIndex}:initial:${batchIndex}`));
      return {
        unitId,
        extractionFingerprint: digest(`domain:${unitIndex}:extraction`),
        sourceFingerprint: digest(`domain:${unitIndex}:source`),
        artifactFingerprint: digest(`domain:${unitIndex}:artifact`),
        converterVersion: "domain-test-converter",
        requestHashes,
        authorizedRequestReservationsByBatch: requestHashes.map((requestHash, batchIndex) => [
          {
            requestHash,
            maximumInputTokens: reservation.maximumInputTokens,
            maximumOutputTokens: reservation.maximumOutputTokens,
          },
          {
            requestHash: digest(`domain:${unitIndex}:retry:${batchIndex}`),
            maximumInputTokens: reservation.maximumInputTokens,
            maximumOutputTokens: reservation.maximumOutputTokens,
          },
        ]),
        plannedRequestEstimates: requestHashes.map((requestHash) => ({
          requestHash,
          estimatedInputTokens: 1_000,
          estimatedOutputTokens: 500,
        })),
        estimatedInputTokens: requestHashes.length * 1_000,
        estimatedOutputTokens: requestHashes.length * 500,
        maximumInputTokens: requestHashes.length * reservation.maximumInputTokens * 4,
        maximumOutputTokens: requestHashes.length * reservation.maximumOutputTokens * 4,
      };
    }),
  });
  await writeFixedEightPaidExtractionPlanApproval(stateDir, plan);
  return plan;
}

function planAttempt(
  plan: Awaited<ReturnType<typeof createDomainTestPlan>>,
  options: {
    runId: string;
    batchIndex: number;
    createdAt: string;
    unitIndex?: number;
    attempt?: number;
    retryVariant?: boolean;
  },
) {
  const unit = plan.payload.units[options.unitIndex ?? 0]!;
  const reservation = unit.authorized_request_reservations_by_batch[options.batchIndex]![
    options.retryVariant ? 1 : 0
  ]!;
  return {
    runId: options.runId,
    unitId: unit.unit_id,
    extractionFingerprint: unit.extraction_fingerprint,
    batchIndex: options.batchIndex,
    attempt: options.attempt ?? 1,
    requestHash: reservation.request_hash,
    paidPlanSha256: plan.plan_sha256,
    model: plan.payload.model,
    maximumInputTokens: reservation.maximum_input_tokens,
    maximumOutputTokens: reservation.maximum_output_tokens,
    reservedCostUsd: reservation.maximum_cost_usd,
    runtimeAbsoluteCostLimitUsd: 20,
    createdAt: options.createdAt,
  };
}

test("one local authority binds paid planning to the canonical state directory", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateA = path.join(sandbox, "state-a");
  const stateB = path.join(sandbox, "state-b");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateA, { recursive: true }),
    mkdir(stateB, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);

  const initialized = await initializePaidExecutionDomainForTests(stateA, {
    authorityRoot,
  });
  assert.match(initialized.binding.domain_id, /^[0-9a-f-]{36}$/u);
  assert.equal(initialized.binding.authoritative_state_dir_realpath, await import("node:fs/promises").then(({ realpath }) => realpath(stateA)));
  assert.deepEqual(
    (await verifyPaidExecutionDomainForPlanForTests(stateA, initialized.binding, { authorityRoot })).binding,
    initialized.binding,
  );
  await assert.rejects(
    verifyPaidExecutionDomainForPlanForTests(stateB, initialized.binding, { authorityRoot }),
    /authoritative_state_directory_mismatch/u,
  );
});

test("deleting an initialized domain cannot silently create a replacement identity", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-delete-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  await Promise.all([
    rm(authorityRoot, { recursive: true }),
    rm(`${authorityRoot}.initialized.json`),
  ]);

  await assert.rejects(
    loadPaidExecutionDomainForPlanningForTests(stateDir, { authorityRoot }),
    /missing/u,
  );
  await assert.rejects(
    initializePaidExecutionDomainForTests(stateDir, { authorityRoot }),
    /reinitialization_blocked_by_state_binding/u,
  );
});

test("a global claim remains blocked when a ledger row exists without its exact checkpoint", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-claim-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const plan = await createDomainTestPlan(stateDir, domain);
  const attempt = planAttempt(plan, {
    runId: "11111111-1111-4111-8111-111111111111",
    batchIndex: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  const claim = await claimPaidExecutionAttemptForTests(
    stateDir,
    domain.binding,
    attempt,
    { authorityRoot },
  );
  assert.match(claim.claim_id, /^[a-f0-9]{64}$/u);
  await assert.rejects(
    verifyPaidExecutionDomainForPlanForTests(stateDir, domain.binding, { authorityRoot }),
    /manual_reconciliation/u,
  );

  const inputTokens = 10;
  const outputTokens = 5;
  await appendAiLedgerEntry(stateDir, {
    schema_version: 3,
    provider_mode: "production_paid",
    paid_plan_sha256: attempt.paidPlanSha256,
    ledger_id: createLedgerId(
      attempt.runId,
      attempt.extractionFingerprint,
      attempt.batchIndex,
      attempt.attempt,
    ),
    run_id: attempt.runId,
    unit_id: attempt.unitId,
    fingerprint: attempt.extractionFingerprint,
    prompt_version: "test",
    model: attempt.model,
    batch_index: attempt.batchIndex,
    attempt: attempt.attempt,
    request_hash: attempt.requestHash,
    request_id: "req_test",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    estimated_cost_usd: estimateExtractionCostUsd(attempt.model, inputTokens, outputTokens, {
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    }),
    reserved_cost_usd: attempt.reservedCostUsd,
    charge_basis: "usage_reported",
    latency_ms: 1,
    success: true,
    error_category: null,
    attempted_at: "2026-07-20T00:00:01.000Z",
  });
  await assert.rejects(
    verifyPaidExecutionDomainForPlanForTests(stateDir, domain.binding, { authorityRoot }),
    /manual_reconciliation/u,
  );
  await assert.rejects(
    claimPaidExecutionAttemptForTests(stateDir, domain.binding, attempt, { authorityRoot }),
    /manual_reconciliation/u,
  );
});

test("concurrent processes can publish only one copy of the same global claim", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-race-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const plan = await createDomainTestPlan(stateDir, domain);
  const attempt = planAttempt(plan, {
    runId: "22222222-2222-4222-8222-222222222222",
    batchIndex: 3,
    createdAt: "2026-07-20T00:00:00.000Z",
  });

  const results = await Promise.allSettled(Array.from(
    { length: 24 },
    () => claimPaidExecutionAttemptForTests(stateDir, domain.binding, attempt, { authorityRoot }),
  ));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failures = results.filter((result) => result.status === "rejected");
  assert.equal(failures.length, 23);
  for (const failure of failures) {
    assert.match(String(failure.reason), /manual_reconciliation/u);
  }
});

test("distinct concurrent claims cannot reserve beyond one low absolute budget", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-budget-race-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const plan = await createDomainTestPlan(stateDir, domain, { authorizedCostCeilingUsd: 3 });
  const first = planAttempt(plan, {
    runId: "31111111-1111-4111-8111-111111111111",
    batchIndex: 0,
    unitIndex: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  const second = planAttempt(plan, {
    runId: "32222222-2222-4222-8222-222222222222",
    batchIndex: 0,
    unitIndex: 1,
    createdAt: "2026-07-20T00:00:00.000Z",
  });

  const results = await Promise.allSettled([
    claimPaidExecutionAttemptForTests(stateDir, domain.binding, first, { authorityRoot }),
    claimPaidExecutionAttemptForTests(stateDir, domain.binding, second, { authorityRoot }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await readdir(path.join(authorityRoot, "claims"))).length, 1);
});

test("claim rejects a lower forged reservation and a retry without its exact prior failure", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-forged-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const plan = await createDomainTestPlan(stateDir, domain);
  const initial = planAttempt(plan, {
    runId: "41111111-1111-4111-8111-111111111111",
    batchIndex: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  await assert.rejects(
    claimPaidExecutionAttemptForTests(
      stateDir,
      domain.binding,
      { ...initial, reservedCostUsd: 0 },
      { authorityRoot },
    ),
    /reservation_does_not_exactly_match/u,
  );
  const retry = planAttempt(plan, {
    runId: initial.runId,
    batchIndex: 0,
    attempt: 2,
    retryVariant: true,
    createdAt: "2026-07-20T00:00:01.000Z",
  });
  await assert.rejects(
    claimPaidExecutionAttemptForTests(stateDir, domain.binding, retry, { authorityRoot }),
    /previous_attempt_claim/u,
  );
  assert.equal((await readdir(path.join(authorityRoot, "claims"))).length, 0);
});

test("a pre-existing budget lock is never auto-recovered", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-budget-lock-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const plan = await createDomainTestPlan(stateDir, domain);
  const attempt = planAttempt(plan, {
    runId: "51111111-1111-4111-8111-111111111111",
    batchIndex: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  await writeFile(path.join(authorityRoot, "budget-claim.lock"), "crash\n", "utf8");
  await assert.rejects(
    loadPaidExecutionDomainForPlanningForTests(stateDir, { authorityRoot }),
    /budget_lock_requires_manual_reconciliation/u,
  );
  await assert.rejects(
    verifyPaidExecutionDomainForPlanForTests(stateDir, domain.binding, { authorityRoot }),
    /budget_lock_requires_manual_reconciliation/u,
  );
  await assert.rejects(
    getPaidExecutionDomainStatusForTests(stateDir, { authorityRoot }),
    /budget_lock_requires_manual_reconciliation/u,
  );
  await assert.rejects(
    claimPaidExecutionAttemptForTests(stateDir, domain.binding, attempt, { authorityRoot }),
    /budget_lock_requires_manual_reconciliation/u,
  );
  assert.equal(await readFile(path.join(authorityRoot, "budget-claim.lock"), "utf8"), "crash\n");
});

test("usage above the provider-bound reservation and a forged future baseline fail closed", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-overage-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const futurePlan = await createDomainTestPlan(stateDir, domain, {
    authorizedCostCeilingUsd: 10,
    domainCommittedCostNanoUsd: 10_000_000_000,
  });
  const futureAttempt = planAttempt(futurePlan, {
    runId: "61111111-1111-4111-8111-111111111111",
    batchIndex: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  await assert.rejects(
    claimPaidExecutionAttemptForTests(stateDir, domain.binding, futureAttempt, { authorityRoot }),
    /baseline_is_in_the_future/u,
  );

  const plan = await createDomainTestPlan(stateDir, domain);
  const attempt = planAttempt(plan, {
    runId: "62222222-2222-4222-8222-222222222222",
    batchIndex: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  await claimPaidExecutionAttemptForTests(stateDir, domain.binding, attempt, { authorityRoot });
  const inputTokens = 1_400_000;
  const outputTokens = 16_000;
  await appendAiLedgerEntry(stateDir, {
    schema_version: 3,
    provider_mode: "production_paid",
    paid_plan_sha256: attempt.paidPlanSha256,
    ledger_id: createLedgerId(attempt.runId, attempt.extractionFingerprint, 0, 1),
    run_id: attempt.runId,
    unit_id: attempt.unitId,
    fingerprint: attempt.extractionFingerprint,
    prompt_version: "test",
    model: attempt.model,
    batch_index: 0,
    attempt: 1,
    request_hash: attempt.requestHash,
    request_id: "req_overage",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    estimated_cost_usd: estimateExtractionCostUsd(attempt.model, inputTokens, outputTokens, {
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    }),
    reserved_cost_usd: attempt.reservedCostUsd,
    charge_basis: "usage_reported",
    latency_ms: 1,
    success: true,
    error_category: null,
    attempted_at: "2026-07-20T00:00:01.000Z",
  });
  await assert.rejects(
    loadPaidExecutionDomainForPlanningForTests(stateDir, { authorityRoot }),
    /usage_exceeded_reservation/u,
  );
});

test("corrupt, truncated, or missing authority manifests fail closed", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-corrupt-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const manifestPath = path.join(authorityRoot, "domain.json");
  const original = await readFile(manifestPath);

  const corrupt = JSON.parse(original.toString("utf8"));
  corrupt.domain_id = "99999999-9999-4999-8999-999999999999";
  await writeFile(manifestPath, `${JSON.stringify(corrupt, null, 2)}\n`, "utf8");
  await assert.rejects(
    verifyPaidExecutionDomainForPlanForTests(stateDir, domain.binding, { authorityRoot }),
    /hash|content/iu,
  );
  await writeFile(manifestPath, "", "utf8");
  await assert.rejects(
    verifyPaidExecutionDomainForPlanForTests(stateDir, domain.binding, { authorityRoot }),
    /truncated/u,
  );
  await rm(manifestPath);
  await assert.rejects(
    verifyPaidExecutionDomainForPlanForTests(stateDir, domain.binding, { authorityRoot }),
    /manifest_missing/u,
  );
});

test("a symlink or junction cannot redirect the global claim store", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-junction-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const outside = path.join(sandbox, "outside");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(outside, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  const claimsDirectory = path.join(authorityRoot, "claims");
  await rm(claimsDirectory, { recursive: true });
  await symlink(outside, claimsDirectory, process.platform === "win32" ? "junction" : "dir");

  await assert.rejects(
    verifyPaidExecutionDomainForPlanForTests(stateDir, domain.binding, { authorityRoot }),
    /claim_store_missing_or_invalid/u,
  );
});

test("actual-state-like schema v1 checkpoints do not poison a fresh paid authority", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-legacy-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  await Promise.all([
    mkdir(checkpointDirectory, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const legacyFingerprint = "e".repeat(64);
  await writeFile(path.join(checkpointDirectory, `${legacyFingerprint}.json`), `${JSON.stringify({
    schema_version: 1,
    checkpoint_fingerprint: legacyFingerprint,
    unit_id: "a".repeat(64),
    batch_index: 11,
    prompt_version: "v7.3-small-row-chunks-complete-occurrence",
    prompt_hash: "b".repeat(64),
    model: "gpt-5.6-luna",
    canonical_identity: {
      canonical_name: "legacy vendor",
      region_code: "seoul_gangnam3",
      kind_hint: "agency",
    },
    artifact_fingerprint: "c".repeat(64),
    request_hash: "d".repeat(64),
    result_hash: "f".repeat(64),
    data: { historical: true },
  }, null, 2)}\n`, "utf8");

  const domain = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  await assert.doesNotReject(
    verifyPaidExecutionDomainForPlanForTests(stateDir, domain.binding, { authorityRoot }),
  );
  assert.equal(JSON.parse(await readFile(
    path.join(checkpointDirectory, `${legacyFingerprint}.json`),
    "utf8",
  )).schema_version, 1);
});

test("checkpoint preflight failure leaves no newly initialized authority or anchor", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-preflight-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  await Promise.all([
    mkdir(checkpointDirectory, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  await writeFile(path.join(checkpointDirectory, "unexpected.json"), "{}\n", "utf8");

  await assert.rejects(
    initializePaidExecutionDomainForTests(stateDir, { authorityRoot }),
    /unknown_entry/u,
  );
  await assert.rejects(readFile(path.join(authorityRoot, "domain.json")), /ENOENT/u);
  await assert.rejects(readFile(`${authorityRoot}.initialized.json`), /ENOENT/u);
  await assert.rejects(
    readFile(path.join(stateDir, ".cache", "paid-execution-domain-binding.json")),
    /ENOENT/u,
  );
});

test("deleting every local marker permits explicit reinitialization and is not a central guarantee", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-domain-local-limit-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const stateDir = path.join(sandbox, "state");
  const authorityRoot = path.join(sandbox, "home", ".wedding-hanbang-paid-execution-v1");
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(path.dirname(authorityRoot), { recursive: true }),
  ]);
  const first = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  await Promise.all([
    rm(authorityRoot, { recursive: true }),
    rm(`${authorityRoot}.initialized.json`),
    rm(path.join(stateDir, ".cache", "paid-execution-domain-binding.json")),
  ]);

  const second = await initializePaidExecutionDomainForTests(stateDir, { authorityRoot });
  assert.notEqual(second.binding.domain_id, first.binding.domain_id);
  assert.equal(second.local_authority_only, true);
});
