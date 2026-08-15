import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeActionReceiptHomeHandoff,
  resolveActionReceiptHomeHandoff,
  stageActionReceiptHomeHandoff,
} from "../lib/actionReceiptHomeHandoff.mjs";

const HANDOFF_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "20000000-0000-4000-8000-000000000002";
const COUPLE_ID = "30000000-0000-4000-8000-000000000003";
const ACTION_ID = "act_first_use_1";

const OPEN_ACTION_ROW = {
  id: ACTION_ID,
  couple_id: COUPLE_ID,
  title: "예식장 후보 기준 한 줄 적기",
  description: "두 사람이 먼저 비교할 기준을 한 줄로 남겨요.",
  due_date: null,
  category_key: null,
  priority: "medium",
  source: "chat",
  status: "open",
  follow_up_revision: 1,
  created_at: "2026-08-15T01:00:00.000Z",
};

test("a transient canonical action read keeps the one-shot handoff for an exact retry", async () => {
  stageActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: ACTION_ID,
    nowMs: 1_000,
  });

  const retry = await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: OWNER_ID,
    expectedCoupleId: COUPLE_ID,
    nowMs: 1_001,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async () => ({ ok: false }),
  });
  assert.deepEqual(retry, { state: "retry" });

  const focused = await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: OWNER_ID,
    expectedCoupleId: COUPLE_ID,
    nowMs: 1_002,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async ({ actionId, coupleId }) => {
      assert.equal(actionId, ACTION_ID);
      assert.equal(coupleId, COUPLE_ID);
      return { ok: true, value: OPEN_ACTION_ROW };
    },
  });
  assert.equal(focused.state, "focused");
  assert.equal(focused.action?.id, ACTION_ID);

  assert.deepEqual(await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: OWNER_ID,
    expectedCoupleId: COUPLE_ID,
    nowMs: 1_003,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async () => ({ ok: true, value: OPEN_ACTION_ROW }),
  }), { state: "rejected" });
});

test("a superseded dashboard read cannot burn the handoff before the current load focuses it", async () => {
  stageActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: ACTION_ID,
    nowMs: 1_000,
  });

  assert.deepEqual(await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: OWNER_ID,
    expectedCoupleId: COUPLE_ID,
    nowMs: 1_001,
    isResolutionCurrent: () => false,
    readCurrentOpenAction: async () => ({ ok: true, value: OPEN_ACTION_ROW }),
  }), { state: "retry" });

  const current = await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: OWNER_ID,
    expectedCoupleId: COUPLE_ID,
    nowMs: 1_002,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async () => ({ ok: true, value: OPEN_ACTION_ROW }),
  });
  assert.equal(current.state, "focused");
  assert.equal(current.action?.id, ACTION_ID);
});

test("identity mismatch and a closed canonical action burn the handoff without leaking or replaying", async () => {
  stageActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: ACTION_ID,
    nowMs: 1_000,
  });
  let crossOwnerReadCount = 0;
  assert.deepEqual(await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: "40000000-0000-4000-8000-000000000004",
    expectedCoupleId: COUPLE_ID,
    nowMs: 1_001,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async () => {
      crossOwnerReadCount += 1;
      return { ok: true, value: OPEN_ACTION_ROW };
    },
  }), { state: "rejected" });
  assert.equal(crossOwnerReadCount, 0);
  assert.deepEqual(await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: OWNER_ID,
    expectedCoupleId: COUPLE_ID,
    nowMs: 1_002,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async () => ({ ok: true, value: OPEN_ACTION_ROW }),
  }), { state: "rejected" });

  stageActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: ACTION_ID,
    nowMs: 2_000,
  });
  assert.deepEqual(await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: OWNER_ID,
    expectedCoupleId: COUPLE_ID,
    nowMs: 2_001,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async () => ({
      ok: true,
      value: { ...OPEN_ACTION_ROW, status: "done" },
    }),
  }), { state: "rejected" });
  assert.deepEqual(await resolveActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    expectedOwnerUserId: OWNER_ID,
    expectedCoupleId: COUPLE_ID,
    nowMs: 2_002,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async () => ({ ok: true, value: OPEN_ACTION_ROW }),
  }), { state: "rejected" });
});

test("a saved-action home handoff is one-shot and bound to the exact owner and couple", () => {
  assert.equal(stageActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: ACTION_ID,
    nowMs: 1_000,
  }), HANDOFF_ID);

  assert.deepEqual(consumeActionReceiptHomeHandoff(
    HANDOFF_ID,
    OWNER_ID,
    COUPLE_ID,
    1_001,
  ), { actionId: ACTION_ID });
  assert.equal(consumeActionReceiptHomeHandoff(
    HANDOFF_ID,
    OWNER_ID,
    COUPLE_ID,
    1_002,
  ), null);
});

test("a mismatched or expired receipt handoff cannot focus another account's home", () => {
  stageActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: ACTION_ID,
    nowMs: 1_000,
  });
  assert.equal(consumeActionReceiptHomeHandoff(
    HANDOFF_ID,
    "40000000-0000-4000-8000-000000000004",
    COUPLE_ID,
    1_001,
  ), null);
  assert.equal(consumeActionReceiptHomeHandoff(
    HANDOFF_ID,
    OWNER_ID,
    COUPLE_ID,
    1_002,
  ), null, "a failed cross-owner consume burns the handoff");

  stageActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: ACTION_ID,
    nowMs: 1_000,
  });
  assert.equal(consumeActionReceiptHomeHandoff(
    HANDOFF_ID,
    OWNER_ID,
    COUPLE_ID,
    11 * 60 * 1000,
  ), null);
});

test("malformed identifiers never create a home focus handoff", () => {
  assert.equal(stageActionReceiptHomeHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: "other/action?id=1",
  }), null);
  assert.equal(stageActionReceiptHomeHandoff({
    handoffId: "not-a-uuid",
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    actionId: ACTION_ID,
  }), null);
});
