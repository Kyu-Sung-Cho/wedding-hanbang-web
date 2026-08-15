import assert from "node:assert/strict";
import test from "node:test";

import { loadOwnerAmoraActionOutcomeFeedback } from "../lib/amoraActionFeedback.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const COUPLE = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-08-15T09:00:00.000Z");

function readyEnvelope(overrides = {}) {
  return {
    version: 1,
    state: "ready",
    recipientUserId: OWNER,
    coupleId: COUPLE,
    feedback: {
      outcomeId: "33333333-3333-4333-8333-333333333333",
      actionId: "act_family_schedule",
      actionTitle: "가족 일정 확인하기",
      sourceRevision: 4,
      actionRevision: 4,
      actionStatus: "open",
      outcome: "blocked",
      blockerCode: "partner_check",
      recordedAt: "2026-08-15T08:00:00.000Z",
      validUntil: "2026-08-16T08:00:00.000Z",
      ...overrides,
    },
  };
}

test("home loads only current-owner current-couple action feedback", async () => {
  const calls = [];
  const feedback = await loadOwnerAmoraActionOutcomeFeedback(
    OWNER,
    COUPLE,
    async (expectedUserId, path, options) => {
      calls.push({ expectedUserId, path, options });
      return {
        ok: true,
        async json() { return readyEnvelope(); },
      };
    },
    NOW,
  );

  assert.deepEqual(calls, [{
    expectedUserId: OWNER,
    path: "/api/amora/action-feedback",
    options: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  }]);
  assert.equal(feedback?.actionId, "act_family_schedule");
  assert.equal(feedback?.outcome, "blocked");
});

test("none, stale, foreign, malformed, and failed feedback all fail closed", async () => {
  const load = (payload, ok = true) => loadOwnerAmoraActionOutcomeFeedback(
    OWNER,
    COUPLE,
    async () => ({ ok, async json() { return payload; } }),
    NOW,
  );

  assert.equal(await load({
    version: 1,
    state: "none",
    recipientUserId: OWNER,
    coupleId: COUPLE,
  }), null);
  assert.equal(await load(readyEnvelope({ validUntil: "2026-08-15T09:00:00.000Z" })), null);
  assert.equal(await load({ ...readyEnvelope(), recipientUserId: "44444444-4444-4444-8444-444444444444" }), null);
  assert.equal(await load({ ...readyEnvelope(), coupleId: "55555555-5555-4555-8555-555555555555" }), null);
  assert.equal(await load({ ...readyEnvelope(), unexpected: true }), null);
  assert.equal(await load({ error: "unavailable" }, false), null);
  assert.equal(await loadOwnerAmoraActionOutcomeFeedback("bad-owner", COUPLE, async () => {
    throw new Error("must not call");
  }, NOW), null);
});
