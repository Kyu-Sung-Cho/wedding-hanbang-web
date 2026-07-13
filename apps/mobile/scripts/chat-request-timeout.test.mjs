import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as wait } from "node:timers/promises";

import {
  MobileChatCancelledError,
  MobileChatTimeoutError,
  withMobileChatTimeout,
} from "../src/lib/chatRequestTimeout.ts";

test("successful operations clear the deadline timer", async () => {
  let operationSignal;

  const result = await withMobileChatTimeout(async (signal) => {
    operationSignal = signal;
    return "ok";
  }, 15);

  assert.equal(result, "ok");
  await wait(30);
  assert.equal(operationSignal.aborted, false);
});

test("the deadline aborts work and reports a timeout without aborting the caller signal", async () => {
  const caller = new globalThis.AbortController();
  let operationSignal;

  await assert.rejects(
    withMobileChatTimeout(
      async (signal) => {
        operationSignal = signal;
        return new Promise(() => {});
      },
      { timeoutMs: 10, signal: caller.signal }
    ),
    (error) => error instanceof MobileChatTimeoutError
      && error.code === "request_timeout"
      && error.retryable === true
  );

  assert.equal(operationSignal.aborted, true);
  assert.equal(caller.signal.aborted, false);
});

test("caller cancellation wins before the deadline and has its own retryable code", async () => {
  const caller = new globalThis.AbortController();
  let operationSignal;
  const pending = withMobileChatTimeout(
    async (signal) => {
      operationSignal = signal;
      return new Promise(() => {});
    },
    { timeoutMs: 80, signal: caller.signal }
  );

  caller.abort();

  await assert.rejects(
    pending,
    (error) => error instanceof MobileChatCancelledError
      && error.code === "request_cancelled"
      && error.retryable === true
  );
  assert.equal(operationSignal?.aborted ?? true, true);

  // A stale deadline must not replace the already delivered cancellation.
  await wait(100);
});

test("an already-aborted caller signal prevents the operation from starting", async () => {
  const caller = new globalThis.AbortController();
  caller.abort();
  let starts = 0;

  await assert.rejects(
    withMobileChatTimeout(
      async () => {
        starts += 1;
        return "unexpected";
      },
      { timeoutMs: 50, signal: caller.signal }
    ),
    MobileChatCancelledError
  );

  assert.equal(starts, 0);
});

test("external abort listeners are removed after success and cancellation", async () => {
  async function observeListenerCleanup(cancel) {
    const caller = new globalThis.AbortController();
    const signal = caller.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    const originalRemove = signal.removeEventListener.bind(signal);
    let added = 0;
    let removed = 0;

    Object.defineProperties(signal, {
      addEventListener: {
        configurable: true,
        value(...args) {
          added += 1;
          return originalAdd(...args);
        },
      },
      removeEventListener: {
        configurable: true,
        value(...args) {
          removed += 1;
          return originalRemove(...args);
        },
      },
    });

    const request = withMobileChatTimeout(
      cancel ? async () => new Promise(() => {}) : async () => "ok",
      { timeoutMs: 100, signal }
    );
    if (cancel) caller.abort();

    if (cancel) await assert.rejects(request, MobileChatCancelledError);
    else assert.equal(await request, "ok");

    assert.equal(added, 1);
    assert.equal(removed, 1);
  }

  await observeListenerCleanup(false);
  await observeListenerCleanup(true);
});

test("invalid deadlines fail before running the operation", async () => {
  let starts = 0;
  await assert.rejects(
    withMobileChatTimeout(async () => {
      starts += 1;
      return "unexpected";
    }, 0),
    RangeError
  );
  assert.equal(starts, 0);
});
