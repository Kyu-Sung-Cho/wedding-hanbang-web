import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendAiLedgerEntry,
  assertAiLedgerSnapshotIsExactPrefix,
  createLedgerId,
  estimateExtractionCostUsd,
  readAiLedger,
  readAiLedgerState,
  type NewAiLedgerEntry,
} from "../ledger.js";

test("input cost is cache-aware only for a complete consistent usage breakdown", () => {
  assert.equal(
    estimateExtractionCostUsd("gpt-5.6-luna", 1_000, 100, {
      cachedInputTokens: 200,
      cacheWriteInputTokens: 300,
    }),
    0.001495,
  );
  assert.equal(
    estimateExtractionCostUsd("gpt-5.6-luna", 1_000, 100),
    0.00185,
  );
  assert.equal(
    estimateExtractionCostUsd("gpt-5.6-luna", 1_000, 100, {
      cachedInputTokens: 900,
      cacheWriteInputTokens: 200,
    }),
    0.00185,
  );
});

function entry(runId: string, attempt: number): NewAiLedgerEntry {
  const fingerprint = "b".repeat(64);
  return {
    schema_version: 3,
    provider_mode: "production_paid",
    paid_plan_sha256: "d".repeat(64),
    ledger_id: createLedgerId(runId, fingerprint, 0, attempt),
    run_id: runId,
    unit_id: "a".repeat(64),
    fingerprint,
    prompt_version: "test-v1",
    model: "gpt-5.6-luna",
    batch_index: 0,
    attempt,
    request_hash: "c".repeat(64),
    request_id: null,
    input_tokens: 10,
    output_tokens: 5,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    estimated_cost_usd: 0.00004,
    reserved_cost_usd: 0.01,
    charge_basis: "usage_reported",
    latency_ms: 1,
    success: true,
    error_category: null,
    attempted_at: "2026-07-20T00:00:00.000Z",
  };
}

test("the durable AI cost ledger preserves every distinct append in order", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ai-ledger-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const first = entry("11111111-1111-4111-8111-111111111111", 1);
  const second = entry("11111111-1111-4111-8111-111111111111", 2);

  await appendAiLedgerEntry(stateDir, first);
  await appendAiLedgerEntry(stateDir, second);

  assert.deepEqual(await readAiLedger(stateDir), [first, second]);
});

test("historical v2 ledger rows remain readable but cannot be appended as new rows", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ai-ledger-legacy-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const current = entry("44444444-4444-4444-8444-444444444444", 1);
  const {
    provider_mode: _providerMode,
    paid_plan_sha256: _paidPlan,
    cached_input_tokens: _cachedInputTokens,
    cache_write_input_tokens: _cacheWriteInputTokens,
    ...legacyFields
  } = current;
  const legacy = { ...legacyFields, schema_version: 2 as const };
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(stateDir, ".cache"), { recursive: true }));
  await writeFile(
    path.join(stateDir, ".cache", "ai-ledger.ndjson"),
    `${JSON.stringify(legacy)}\n`,
    "utf8",
  );
  assert.deepEqual(await readAiLedger(stateDir), [legacy]);
  const reconciled = await readAiLedgerState(stateDir);
  assert.equal(
    reconciled.snapshot.cumulative_cost_usd,
    estimateExtractionCostUsd(legacy.model, legacy.input_tokens, legacy.output_tokens),
  );
  assert.throws(
    () => assertAiLedgerSnapshotIsExactPrefix({
      ...reconciled.snapshot,
      cumulative_cost_usd: legacy.estimated_cost_usd,
    }, reconciled),
    /snapshot_mismatch/u,
  );
  await assert.rejects(
    appendAiLedgerEntry(stateDir, legacy as never),
    /schema_version|Invalid input/u,
  );
});

test("an approved ledger snapshot remains an exact prefix but rejects truncation and hash drift", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ai-ledger-snapshot-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const first = entry("55555555-5555-4555-8555-555555555555", 1);
  const second = entry("55555555-5555-4555-8555-555555555555", 2);
  await appendAiLedgerEntry(stateDir, first);
  const approved = await readAiLedgerState(stateDir);
  await appendAiLedgerEntry(stateDir, second);
  const resumed = await readAiLedgerState(stateDir);
  assert.doesNotThrow(() => assertAiLedgerSnapshotIsExactPrefix(approved.snapshot, resumed));

  assert.throws(
    () => assertAiLedgerSnapshotIsExactPrefix({
      ...approved.snapshot,
      content_sha256: "f".repeat(64),
    }, resumed),
    /snapshot_mismatch/u,
  );
  await writeFile(
    path.join(stateDir, ".cache", "ai-ledger.ndjson"),
    "",
    "utf8",
  );
  const truncated = await readAiLedgerState(stateDir);
  assert.throws(
    () => assertAiLedgerSnapshotIsExactPrefix(approved.snapshot, truncated),
    /was_truncated/u,
  );
});

test("a duplicate ledger ID fails closed instead of lowering the cumulative cost by overwrite", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ai-ledger-duplicate-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const duplicate = entry("22222222-2222-4222-8222-222222222222", 1);

  await appendAiLedgerEntry(stateDir, duplicate);
  await appendAiLedgerEntry(stateDir, duplicate);

  await assert.rejects(readAiLedger(stateDir), /중복 ledger_id/u);
});

test("ledger append rejects forged identity, cost basis, and success state", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ai-ledger-forgery-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const valid = entry("33333333-3333-4333-8333-333333333333", 1);

  await assert.rejects(
    appendAiLedgerEntry(stateDir, { ...valid, ledger_id: "f".repeat(64) }),
    /ledger_id/u,
  );
  await assert.rejects(
    appendAiLedgerEntry(stateDir, { ...valid, estimated_cost_usd: 0 }),
    /토큰 수/u,
  );
  await assert.rejects(
    appendAiLedgerEntry(stateDir, {
      ...valid,
      estimated_cost_usd: valid.reserved_cost_usd!,
      charge_basis: "reservation_upper_bound",
    }),
    /reservation_upper_bound/u,
  );
  await assert.rejects(
    appendAiLedgerEntry(stateDir, { ...valid, success: false, error_category: null }),
    /서로 모순/u,
  );
  await assert.rejects(
    appendAiLedgerEntry(stateDir, {
      ...valid,
      cached_input_tokens: 9,
      cache_write_input_tokens: 2,
    }),
    /cannot exceed total input tokens/u,
  );
  await assert.rejects(
    appendAiLedgerEntry(stateDir, {
      ...valid,
      cached_input_tokens: null,
      cache_write_input_tokens: 0,
    }),
    /must either both be reported or both be null/u,
  );
});
