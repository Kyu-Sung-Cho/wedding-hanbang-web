import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertNoOrphanedPaidCallIntents,
  beginPaidCallIntent,
  listPendingPaidCallIntents,
  persistCheckpointThenSettlePaidCallIntents,
  reconcileFailedPaidCallIntent,
  settlePaidCallIntent,
} from "../paid-call-journal.js";
import { appendAiLedgerEntry, createLedgerId, estimateExtractionCostUsd } from "../ledger.js";

function input() {
  return {
    runId: "11111111-1111-4111-8111-111111111111",
    unitId: "a".repeat(64),
    extractionFingerprint: "b".repeat(64),
    batchIndex: 2,
    attempt: 1,
    requestHash: "c".repeat(64),
    paidPlanSha256: "d".repeat(64),
    model: "gpt-5.6-luna" as const,
    reservedCostUsd: 0.125,
    createdAt: "2026-07-20T00:00:00.000Z",
  };
}

test("paid-call intent is durable before settlement and blocks a restart", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-intent-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const intent = await beginPaidCallIntent(stateDir, input());
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), [intent]);
  await assert.rejects(
    assertNoOrphanedPaidCallIntents(stateDir),
    new RegExp(intent.intent_id, "u"),
  );

  await settlePaidCallIntent(stateDir, intent);
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), []);
  await assert.doesNotReject(assertNoOrphanedPaidCallIntents(stateDir));
});

test("paid-call intent cannot be duplicated or settled after tampering", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-intent-tamper-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const intent = await beginPaidCallIntent(stateDir, input());
  await assert.rejects(beginPaidCallIntent(stateDir, input()), /already_pending/u);
  const intentPath = path.join(
    stateDir,
    ".cache",
    "paid-call-intents",
    `${intent.intent_id}.json`,
  );
  const raw = JSON.parse(await readFile(intentPath, "utf8"));
  raw.reserved_cost_usd = 999;
  await writeFile(intentPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  await assert.rejects(
    settlePaidCallIntent(stateDir, intent),
    /content SHA-256 mismatch|content.*hash|integrity/iu,
  );
  await assert.rejects(assertNoOrphanedPaidCallIntents(stateDir));
});

test("concurrent begin publishes exactly one deterministic paid-call intent", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-intent-race-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const results = await Promise.allSettled(
    Array.from({ length: 24 }, () => beginPaidCallIntent(stateDir, input())),
  );
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof beginPaidCallIntent>>> =>
      result.status === "fulfilled",
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 23);
  for (const result of rejected) {
    assert.match(String(result.reason), /paid_call_intent_already_pending/u);
  }
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), [fulfilled[0].value]);
  assert.deepEqual(
    (await readdir(path.join(stateDir, ".cache", "paid-call-intents"))).filter(
      (name) => name.endsWith(".tmp"),
    ),
    [],
  );
});

test("all retry intents remain pending until checkpoint persistence succeeds", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-intent-checkpoint-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const first = await beginPaidCallIntent(stateDir, input());
  const second = await beginPaidCallIntent(stateDir, {
    ...input(),
    attempt: 2,
    requestHash: "e".repeat(64),
  });
  await assert.rejects(
    persistCheckpointThenSettlePaidCallIntents(stateDir, [first, second], async () => {
      throw new Error("generated checkpoint fsync failure");
    }),
    /checkpoint fsync failure/u,
  );
  assert.deepEqual(
    (await listPendingPaidCallIntents(stateDir)).map((intent) => intent.intent_id).sort(),
    [first.intent_id, second.intent_id].sort(),
  );
  let persisted = false;
  await persistCheckpointThenSettlePaidCallIntents(stateDir, [first, second], async () => {
    persisted = true;
  });
  assert.equal(persisted, true);
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), []);
});

test("an exact durable failed production ledger row safely reconciles its local intent", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-intent-failed-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const intent = await beginPaidCallIntent(stateDir, input());
  const inputTokens = 10;
  const outputTokens = 5;
  await appendAiLedgerEntry(stateDir, {
    schema_version: 3,
    provider_mode: "production_paid",
    paid_plan_sha256: intent.paid_plan_sha256,
    ledger_id: createLedgerId(
      intent.run_id,
      intent.extraction_fingerprint,
      intent.batch_index,
      intent.attempt,
    ),
    run_id: intent.run_id,
    unit_id: intent.unit_id,
    fingerprint: intent.extraction_fingerprint,
    prompt_version: "test",
    model: intent.model,
    batch_index: intent.batch_index,
    attempt: intent.attempt,
    request_hash: intent.request_hash,
    request_id: "req_failed_intent",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    estimated_cost_usd: estimateExtractionCostUsd(intent.model, inputTokens, outputTokens, {
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    }),
    reserved_cost_usd: intent.reserved_cost_usd,
    charge_basis: "usage_reported",
    latency_ms: 1,
    success: false,
    error_category: "invalid_response",
    attempted_at: "2026-07-20T00:00:01.000Z",
  });

  await reconcileFailedPaidCallIntent(stateDir, intent);
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), []);
});

test("failed-intent reconciliation never deletes an intent without its exact ledger proof", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-intent-no-ledger-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const intent = await beginPaidCallIntent(stateDir, input());

  await assert.rejects(
    reconcileFailedPaidCallIntent(stateDir, intent),
    /requires_one_exact_failed_ledger_row/u,
  );
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), [intent]);
});

test("failed-intent reconciliation cannot remove an intent backed by a successful ledger row", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-paid-intent-success-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const intent = await beginPaidCallIntent(stateDir, input());
  const inputTokens = 10;
  const outputTokens = 5;
  await appendAiLedgerEntry(stateDir, {
    schema_version: 3,
    provider_mode: "production_paid",
    paid_plan_sha256: intent.paid_plan_sha256,
    ledger_id: createLedgerId(
      intent.run_id,
      intent.extraction_fingerprint,
      intent.batch_index,
      intent.attempt,
    ),
    run_id: intent.run_id,
    unit_id: intent.unit_id,
    fingerprint: intent.extraction_fingerprint,
    prompt_version: "test",
    model: intent.model,
    batch_index: intent.batch_index,
    attempt: intent.attempt,
    request_hash: intent.request_hash,
    request_id: "req_success_intent",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    estimated_cost_usd: estimateExtractionCostUsd(intent.model, inputTokens, outputTokens, {
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    }),
    reserved_cost_usd: intent.reserved_cost_usd,
    charge_basis: "usage_reported",
    latency_ms: 1,
    success: true,
    error_category: null,
    attempted_at: "2026-07-20T00:00:01.000Z",
  });

  await assert.rejects(
    reconcileFailedPaidCallIntent(stateDir, intent),
    /requires_one_exact_failed_ledger_row/u,
  );
  assert.deepEqual(await listPendingPaidCallIntents(stateDir), [intent]);
});
