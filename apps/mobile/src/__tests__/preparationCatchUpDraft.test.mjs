import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  createPreparationCatchUpDraftRuntime,
  parsePreparationCatchUpDraftRecord,
} from "../lib/preparationCatchUpDraft.mjs";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const ITEMS = [{ topicKey: "venue", state: "completed", scope: "owner_private" }];

function adapters(store) {
  return {
    digestSha256: async (value) => createHash("sha256").update(value).digest("hex"),
    readSecure: async (key) => store.get(key) ?? null,
    writeSecure: async (key, value) => { store.set(key, value); },
    deleteSecure: async (key) => { store.delete(key); },
  };
}

test("an owner-bound locked request survives restart with the same id and no stored identity", async () => {
  const store = new Map();
  const first = createPreparationCatchUpDraftRuntime(adapters(store), {
    now: () => 1_000,
    ttlMs: 60_000,
  });
  await first.stage({
    ownerUserId: OWNER_ID,
    phase: "preview",
    requestId: REQUEST_ID,
    requestLocked: true,
    items: ITEMS,
  });

  const raw = [...store.values()][0];
  assert.doesNotMatch(raw, new RegExp(`${OWNER_ID}|${OTHER_OWNER_ID}`, "u"));

  const restarted = createPreparationCatchUpDraftRuntime(adapters(store), {
    now: () => 2_000,
    ttlMs: 60_000,
  });
  assert.deepEqual(await restarted.read({ ownerUserId: OWNER_ID }), {
    phase: "preview",
    requestId: REQUEST_ID,
    requestLocked: true,
    items: ITEMS,
  });
  assert.equal(await restarted.read({ ownerUserId: OTHER_OWNER_ID }), null);
});

test("edit drafts omit request identity while malformed and expired records fail closed", async () => {
  const store = new Map();
  const runtime = createPreparationCatchUpDraftRuntime(adapters(store), {
    now: () => 10_000,
    ttlMs: 1_000,
  });
  await runtime.stage({
    ownerUserId: OWNER_ID,
    phase: "edit",
    requestId: null,
    requestLocked: false,
    items: ITEMS,
  });
  const raw = [...store.values()][0];
  assert.deepEqual(parsePreparationCatchUpDraftRecord(raw, {
    ownerUserId: OWNER_ID,
    nowMs: 10_500,
  }), {
    phase: "edit",
    requestId: null,
    requestLocked: false,
    items: ITEMS,
  });
  assert.equal(parsePreparationCatchUpDraftRecord(raw, {
    ownerUserId: OWNER_ID,
    nowMs: 11_000,
  }), null);
  assert.equal(parsePreparationCatchUpDraftRecord(JSON.stringify({
    version: 1,
    phase: "preview",
    requestId: null,
    requestLocked: true,
    items: ITEMS,
    createdAtMs: 1,
    expiresAtMs: 2,
  }), { ownerUserId: OWNER_ID, nowMs: 1 }), null);
});

test("clear is owner-scoped and a failed secure write never reports a durable draft", async () => {
  const store = new Map();
  const runtime = createPreparationCatchUpDraftRuntime(adapters(store), { now: () => 1_000 });
  await runtime.stage({
    ownerUserId: OWNER_ID,
    phase: "edit",
    requestId: null,
    requestLocked: false,
    items: ITEMS,
  });
  assert.equal(await runtime.clear({ ownerUserId: OWNER_ID }), true);
  assert.equal(await runtime.read({ ownerUserId: OWNER_ID }), null);

  const failing = createPreparationCatchUpDraftRuntime({
    ...adapters(new Map()),
    writeSecure: async () => { throw new Error("locked"); },
  }, { now: () => 1_000, timeoutMs: 20 });
  await assert.rejects(failing.stage({
    ownerUserId: OWNER_ID,
    phase: "edit",
    requestId: null,
    requestLocked: false,
    items: ITEMS,
  }), /PREPARATION_CATCH_UP_DRAFT_WRITE_FAILED/u);
});

test("the Expo adapter uses device-only SecureStore", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/preparationCatchUpDraft.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY/u);
  assert.match(source, /Crypto\.digestStringAsync/u);
  assert.doesNotMatch(source, /AsyncStorage/u);
});
