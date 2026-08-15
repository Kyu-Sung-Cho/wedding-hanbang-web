import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  getAmoraCoupleCriterionView,
  loadOwnerAmoraCoupleCriterion,
} from "../lib/amoraCoupleCriterion.mjs";

const BRIDE = "11111111-1111-4111-8111-111111111111";
const GROOM = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";

const response = {
  version: 1,
  coupleId: COUPLE,
  linked: true,
  current: null,
  proposal: {
    id: PROPOSAL,
    value: "우리 둘이 감당할 수 있는 범위 먼저 보기",
    revision: 1,
    proposerUserId: BRIDE,
    brideUserId: BRIDE,
    groomUserId: GROOM,
    acceptedUserIds: [BRIDE],
    createdAt: "2026-08-14T11:00:00.000Z",
    updatedAt: "2026-08-14T11:00:00.000Z",
  },
};

test("the proposer waits while the exact partner sees one reviewed sentence to confirm", () => {
  assert.deepEqual(getAmoraCoupleCriterionView(response, BRIDE), {
    status: "waiting_partner",
    currentValue: null,
    proposalValue: response.proposal.value,
    canPropose: false,
    canAccept: false,
    canCancel: true,
  });
  assert.deepEqual(getAmoraCoupleCriterionView(response, GROOM), {
    status: "review_required",
    currentValue: null,
    proposalValue: response.proposal.value,
    canPropose: false,
    canAccept: true,
    canCancel: false,
  });
});

test("the loader rejects a valid-looking response from a stale couple context", async () => {
  const calls = [];
  assert.deepEqual(await loadOwnerAmoraCoupleCriterion(
    BRIDE,
    COUPLE,
    async (expectedUserId, path, options) => {
      calls.push({ expectedUserId, path, options });
      return { ok: true, async json() { return response; } };
    },
  ), { loaded: true, value: response });
  assert.deepEqual(calls, [{
    expectedUserId: BRIDE,
    path: "/api/amora/couple-criterion",
    options: { method: "GET", headers: { Accept: "application/json" } },
  }]);
  assert.deepEqual(await loadOwnerAmoraCoupleCriterion(
    BRIDE,
    "55555555-5555-4555-8555-555555555555",
    async () => ({ ok: true, async json() { return response; } }),
  ), { loaded: false, value: null });
});

test("the settings surface reviews a shareable sentence before either partner action", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/settings/amora-style.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /내 기준 원문은 자동으로 공유되지 않아요/u);
  assert.match(source, /우리 기준으로 제안하기/u);
  assert.match(source, /파트너 확인 대기/u);
  assert.match(source, /이 기준 함께 쓰기/u);
  assert.match(source, /currentVerifiedCoupleContext/u);
  assert.match(source, /parseAmoraCoupleCriterionResponse/u);
  assert.match(source, /buildAmoraCoupleCriterionProposeRequest/u);
  assert.match(source, /buildAmoraCoupleCriterionAcceptRequest/u);
  assert.match(source, /buildAmoraCoupleCriterionCancelRequest/u);
});
