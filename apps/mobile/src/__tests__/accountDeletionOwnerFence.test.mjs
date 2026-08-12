import assert from "node:assert/strict";
import test from "node:test";
import { canFinishOwnerBoundDeletion } from "../lib/accountDeletionOwnerFence.mjs";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

test("allows confirmed A and completed deletion after A auth is already gone", () => {
  assert.equal(canFinishOwnerBoundDeletion({
    expectedOwnerId: USER_A,
    sessionOwnerId: USER_A,
    authenticatedOwnerId: USER_A,
    screenOwnerId: USER_A,
  }), true);
  assert.equal(canFinishOwnerBoundDeletion({
    expectedOwnerId: USER_A,
    sessionOwnerId: null,
    authenticatedOwnerId: null,
    screenOwnerId: null,
  }), true);
});

test("never lets an A completion purge or sign out any observed B owner", () => {
  for (const owners of [
    { sessionOwnerId: USER_B, authenticatedOwnerId: USER_B, screenOwnerId: USER_B },
    { sessionOwnerId: USER_B, authenticatedOwnerId: null, screenOwnerId: null },
    { sessionOwnerId: null, authenticatedOwnerId: USER_B, screenOwnerId: null },
    { sessionOwnerId: null, authenticatedOwnerId: null, screenOwnerId: USER_B },
  ]) {
    assert.equal(canFinishOwnerBoundDeletion({
      expectedOwnerId: USER_A,
      ...owners,
    }), false);
  }
});
