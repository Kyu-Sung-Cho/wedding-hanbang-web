import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  createPlanningFoundationDraftHandoffRecord,
  createPlanningFoundationDraftHandoffRuntime,
  parsePlanningFoundationDraftHandoffRecord,
} from "../lib/planningFoundationDraftHandoff.mjs";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";

function createAdapters(store) {
  return {
    digestSha256: async (value) => createHash("sha256").update(value).digest("hex"),
    readSecure: async (key) => store.get(key) ?? null,
    writeSecure: async (key, value) => { store.set(key, value); },
    deleteSecure: async (key) => { store.delete(key); },
  };
}

test("an owner-bound planning stage survives a process restart without storing identity or draft text", async () => {
  const store = new Map();
  const firstProcess = createPlanningFoundationDraftHandoffRuntime(createAdapters(store), {
    now: () => 1_000,
    ttlMs: 60_000,
  });
  await firstProcess.stage({
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    stage: "starting",
  });

  const raw = [...store.values()][0];
  assert.equal(typeof raw, "string");
  assert.doesNotMatch(raw, new RegExp(`${OWNER_ID}|${COUPLE_ID}|결혼 준비`, "u"));

  const restarted = createPlanningFoundationDraftHandoffRuntime(createAdapters(store), {
    now: () => 2_000,
    ttlMs: 60_000,
  });
  assert.equal(await restarted.read({ ownerUserId: OWNER_ID, coupleId: COUPLE_ID }), "starting");
  assert.equal(await restarted.read({
    ownerUserId: "33333333-3333-4333-8333-333333333333",
    coupleId: COUPLE_ID,
  }), null);
});

test("expired, malformed, and unsupported records fail closed and are removed", async () => {
  const valid = createPlanningFoundationDraftHandoffRecord({
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    stage: "unknown",
    nowMs: 10_000,
    ttlMs: 1_000,
  });
  assert.equal(parsePlanningFoundationDraftHandoffRecord(valid, {
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    nowMs: 10_500,
  }), "unknown");
  assert.equal(parsePlanningFoundationDraftHandoffRecord(valid, {
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    nowMs: 11_000,
  }), null);
  assert.equal(parsePlanningFoundationDraftHandoffRecord(
    JSON.stringify({ version: 1, stage: "completed", createdAtMs: 1, expiresAtMs: 2 }),
    { ownerUserId: OWNER_ID, coupleId: COUPLE_ID, nowMs: 1 },
  ), null);

  const store = new Map([["unused", "bad"]]);
  const adapters = createAdapters(store);
  const runtime = createPlanningFoundationDraftHandoffRuntime(adapters, { now: () => 20_000 });
  await runtime.stage({ ownerUserId: OWNER_ID, coupleId: COUPLE_ID, stage: "already_preparing" });
  const [key] = [...store.keys()].filter((candidate) => candidate !== "unused");
  store.set(key, "not-json");
  assert.equal(await runtime.read({ ownerUserId: OWNER_ID, coupleId: COUPLE_ID }), null);
  assert.equal(store.has(key), false);
});

test("clear removes only the exact owner and storage failures never report a durable handoff", async () => {
  const store = new Map();
  const runtime = createPlanningFoundationDraftHandoffRuntime(createAdapters(store), { now: () => 1_000 });
  await runtime.stage({ ownerUserId: OWNER_ID, coupleId: COUPLE_ID, stage: "later" });
  await runtime.clear({ ownerUserId: OWNER_ID, coupleId: COUPLE_ID });
  assert.equal(await runtime.read({ ownerUserId: OWNER_ID, coupleId: COUPLE_ID }), null);

  const failing = createPlanningFoundationDraftHandoffRuntime({
    ...createAdapters(new Map()),
    writeSecure: async () => { throw new Error("locked"); },
  }, { now: () => 1_000, timeoutMs: 20 });
  await assert.rejects(
    failing.stage({ ownerUserId: OWNER_ID, coupleId: COUPLE_ID, stage: "starting" }),
    /PLANNING_FOUNDATION_DRAFT_WRITE_FAILED/,
  );
});

test("the Expo adapter uses device-only SecureStore", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/planningFoundationDraftHandoff.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY/u);
  assert.match(source, /Crypto\.digestStringAsync/u);
  assert.doesNotMatch(source, /AsyncStorage/u);
});
