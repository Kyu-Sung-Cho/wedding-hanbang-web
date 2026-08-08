import assert from "node:assert/strict";
import test from "node:test";

import {
  appendCommunityDecisionMutationIndex,
  buildCommunityDecisionOwnerPurgeKeys,
  purgeCommunityDecisionOwnerKeys,
  resolveCommunityDecisionMutationIndexCopies,
} from "../lib/communityDecisionPendingIndex.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const QUESTION_ONE = "33333333-3333-4333-8333-333333333333";
const QUESTION_TWO = "44444444-4444-4444-8444-444444444444";

function indexRaw(ownerId, questionIds) {
  return JSON.stringify({ version: 1, ownerId, questionIds });
}

test("owner mutation index keeps multiple question commands isolated", () => {
  const resolved = resolveCommunityDecisionMutationIndexCopies(
    indexRaw(OWNER, [QUESTION_ONE, QUESTION_TWO]),
    indexRaw(OWNER, [QUESTION_TWO, QUESTION_ONE]),
    OWNER,
  );
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.index.questionIds, [QUESTION_ONE, QUESTION_TWO]);

  const ownerKeys = buildCommunityDecisionOwnerPurgeKeys(OWNER, resolved.index);
  assert.equal(ownerKeys.length, 6);
  assert.equal(new Set(ownerKeys).size, ownerKeys.length);
  assert.ok(ownerKeys.every((key) => !key.includes(OTHER_OWNER.replaceAll("-", ""))));
  assert.ok(ownerKeys.some((key) => key.endsWith(QUESTION_ONE.replaceAll("-", ""))));
  assert.ok(ownerKeys.some((key) => key.endsWith(QUESTION_TWO.replaceAll("-", ""))));

  const other = resolveCommunityDecisionMutationIndexCopies(null, null, OTHER_OWNER);
  assert.equal(other.ok, true);
  assert.deepEqual(other.index.questionIds, []);
  assert.notDeepEqual(
    buildCommunityDecisionOwnerPurgeKeys(OTHER_OWNER, other.index),
    ownerKeys,
  );
});

test("one valid encrypted index copy repairs one corrupted copy", () => {
  const recovered = resolveCommunityDecisionMutationIndexCopies(
    "{corrupt",
    indexRaw(OWNER, [QUESTION_ONE, QUESTION_TWO]),
    OWNER,
  );
  assert.deepEqual(recovered, {
    ok: true,
    index: {
      version: 1,
      ownerId: OWNER,
      questionIds: [QUESTION_ONE, QUESTION_TWO],
    },
    needsRepair: true,
  });
});

test("two unusable index copies fail closed instead of claiming purge success", () => {
  assert.deepEqual(
    resolveCommunityDecisionMutationIndexCopies(
      "{corrupt",
      indexRaw(OTHER_OWNER, [QUESTION_ONE]),
      OWNER,
    ),
    { ok: false, reason: "corrupt" },
  );
  assert.throws(
    () => buildCommunityDecisionOwnerPurgeKeys(OWNER, {
      version: 1,
      ownerId: OTHER_OWNER,
      questionIds: [QUESTION_ONE],
    }),
    /COMMUNITY_DECISION_MUTATION_INDEX_INVALID/u,
  );
});

test("the 65th pending mutation fails before it can evict an indexed payload", () => {
  const questionIds = Array.from({ length: 64 }, (_, index) => (
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  ));
  const fullIndex = {
    version: 1,
    ownerId: OWNER,
    questionIds,
  };
  const sixtyFifth = "00000000-0000-4000-8000-000000000065";
  assert.throws(
    () => appendCommunityDecisionMutationIndex(fullIndex, sixtyFifth),
    /COMMUNITY_DECISION_MUTATION_INDEX_LIMIT_REACHED/u,
  );
  assert.equal(fullIndex.questionIds.length, 64);
  assert.equal(fullIndex.questionIds.includes(sixtyFifth), false);
});

test("partial purge retains both indexes for retry, then removes every owner key", async () => {
  const questionIds = Array.from({ length: 64 }, (_, index) => (
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  ));
  const index = { version: 1, ownerId: OWNER, questionIds };
  const ownerKeys = buildCommunityDecisionOwnerPurgeKeys(OWNER, index);
  const otherKeys = buildCommunityDecisionOwnerPurgeKeys(OTHER_OWNER, {
    version: 1,
    ownerId: OTHER_OWNER,
    questionIds: [QUESTION_ONE],
  });
  const values = new Set([...ownerKeys, ...otherKeys]);
  const failedPayloadKey = ownerKeys.at(-1);
  let failOnce = true;
  const deleteKey = async (key) => {
    if (key === failedPayloadKey && failOnce) {
      failOnce = false;
      throw new Error("device keychain unavailable");
    }
    values.delete(key);
  };

  await assert.rejects(
    purgeCommunityDecisionOwnerKeys(OWNER, index, deleteKey),
    /COMMUNITY_DECISION_OWNER_PURGE_UNCONFIRMED/u,
  );
  assert.equal(values.has(ownerKeys[2]), true, "primary index must survive");
  assert.equal(values.has(ownerKeys[3]), true, "backup index must survive");
  assert.equal(values.has(failedPayloadKey), true);

  await purgeCommunityDecisionOwnerKeys(OWNER, index, deleteKey);
  assert.equal(ownerKeys.some((key) => values.has(key)), false);
  assert.equal(otherKeys.every((key) => values.has(key)), true);
});
