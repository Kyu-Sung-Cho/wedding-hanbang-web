import assert from "node:assert/strict";
import test from "node:test";

import { createScheduleSessionFence } from "../lib/scheduleSessionFence.mjs";

const OWNER_A = "10000000-0000-4000-8000-000000000001";
const OWNER_B = "10000000-0000-4000-8000-000000000002";
const COUPLE_A = "50000000-0000-4000-8000-000000000001";
const COUPLE_B = "50000000-0000-4000-8000-000000000002";

test("an A operation cannot commit after an authenticated A-to-B transition", async () => {
  const fence = createScheduleSessionFence();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const tokenA = fence.capture();
  assert.ok(tokenA);

  let resolveA;
  const responseA = new Promise((resolve) => {
    resolveA = resolve;
  });
  let committed = false;
  const operationA = responseA.then(() => {
    if (fence.isCurrent(tokenA)) committed = true;
  });

  assert.equal(fence.setOwner(OWNER_B), true);
  fence.setIdentity(OWNER_B, COUPLE_B);
  resolveA();
  await operationA;

  assert.equal(committed, false);
  assert.deepEqual(fence.capture(), {
    generation: 3,
    ownerId: OWNER_B,
    coupleId: COUPLE_B,
  });
});

test("same-owner refreshes preserve the current couple generation", () => {
  const fence = createScheduleSessionFence();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const token = fence.capture();

  assert.equal(fence.setOwner(OWNER_A), false);
  assert.equal(fence.isCurrent(token), true);
  assert.equal(fence.setIdentity(OWNER_A, COUPLE_A), false);
  assert.equal(fence.isCurrent(token), true);
});

test("sign-out invalidates captures and leaves no capturable identity", () => {
  const fence = createScheduleSessionFence();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const token = fence.capture();

  assert.equal(fence.setOwner(null), true);
  assert.equal(fence.isCurrent(token), false);
  assert.equal(fence.capture(), null);
});
