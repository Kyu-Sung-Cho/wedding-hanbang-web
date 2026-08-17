import assert from "node:assert/strict";
import test from "node:test";

import {
  PreparationTopicCatchUpRecordError,
  loadPreparationTopicCatchUpRecords,
} from "../lib/preparationTopicCatchUpRecords.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";

test("catch-up records use one bounded identity-fenced read and expose overflow as partial", async () => {
  const rows = Array.from({ length: 61 }, (_, index) => ({ index }));
  const calls = [];
  const result = await loadPreparationTopicCatchUpRecords({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
    readDecisionRows: async (request) => {
      calls.push(request);
      return rows;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].ownerId, OWNER_ID);
  assert.equal(calls[0].coupleId, COUPLE_ID);
  assert.equal(calls[0].limit, 61);
  assert.equal(calls[0].signal instanceof globalThis.AbortSignal, true);
  assert.deepEqual(result, {
    catchUpDecisionReceipts: rows.slice(0, 60),
    partial: true,
  });
});

test("invalid identity or non-array response fails closed", async () => {
  let reads = 0;
  await assert.rejects(
    loadPreparationTopicCatchUpRecords({
      ownerId: "not-a-uuid",
      coupleId: COUPLE_ID,
      isCurrent: () => true,
      readDecisionRows: async () => { reads += 1; return []; },
    }),
    (error) => error instanceof PreparationTopicCatchUpRecordError
      && error.code === "invalid_request",
  );
  assert.equal(reads, 0);

  await assert.rejects(
    loadPreparationTopicCatchUpRecords({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      isCurrent: () => true,
      readDecisionRows: async () => null,
    }),
    (error) => error?.code === "invalid_response",
  );
});

test("the current identity fence is checked immediately before and after the read", async () => {
  for (const failedCheck of [1, 2]) {
    let checks = 0;
    let reads = 0;
    await assert.rejects(
      loadPreparationTopicCatchUpRecords({
        ownerId: OWNER_ID,
        coupleId: COUPLE_ID,
        isCurrent: () => {
          checks += 1;
          return checks !== failedCheck;
        },
        readDecisionRows: async () => { reads += 1; return []; },
      }),
      (error) => error?.code === "stale_context",
    );
    assert.equal(reads, failedCheck === 1 ? 0 : 1);
  }
});

test("the optional read times out without blocking the preparation screen", async () => {
  let receivedSignal = null;
  await assert.rejects(
    loadPreparationTopicCatchUpRecords({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      timeoutMs: 10,
      isCurrent: () => true,
      readDecisionRows: async ({ signal }) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
    }),
    (error) => error?.code === "timeout",
  );
  assert.equal(receivedSignal?.aborted, true);
});
