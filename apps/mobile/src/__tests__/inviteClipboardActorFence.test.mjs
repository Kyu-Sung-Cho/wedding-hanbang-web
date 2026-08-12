import assert from "node:assert/strict";
import { test } from "node:test";

import { copyOwnerBoundInviteSecret } from "../lib/inviteClipboardActorFence.mjs";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

test("mobile clears A's copied invite and purges its state when auth becomes B during clipboard access", async () => {
  let currentOwnerId = USER_A;
  let clipboard = "";
  let purgeCount = 0;
  let canonicalReadCount = 0;
  const writes = [];

  const didCopy = await copyOwnerBoundInviteSecret({
    expectedOwnerId: USER_A,
    secretOwnerId: USER_A,
    secret: "WH-SECRET",
    readScreenOwner: () => currentOwnerId,
    readAuthenticatedOwner: async () => {
      canonicalReadCount += 1;
      return currentOwnerId;
    },
    writeText: async (value) => {
      writes.push(value);
      clipboard = value;
      if (value === "WH-SECRET") currentOwnerId = USER_B;
    },
    purgeOwnerBoundSecret: () => {
      purgeCount += 1;
    },
  });

  assert.equal(didCopy, false);
  assert.equal(canonicalReadCount, 2);
  assert.deepEqual(writes, ["WH-SECRET", ""]);
  assert.equal(clipboard, "");
  assert.equal(purgeCount, 1);
});

test("mobile copies once when the screen, secret tag, and canonical owner remain A", async () => {
  const writes = [];
  let canonicalReadCount = 0;

  const didCopy = await copyOwnerBoundInviteSecret({
    expectedOwnerId: USER_A,
    secretOwnerId: USER_A,
    secret: "WH-SECRET",
    readScreenOwner: () => USER_A,
    readAuthenticatedOwner: async () => {
      canonicalReadCount += 1;
      return USER_A;
    },
    writeText: async (value) => writes.push(value),
    purgeOwnerBoundSecret: () => assert.fail("current A state must not be purged"),
  });

  assert.equal(didCopy, true);
  assert.equal(canonicalReadCount, 2);
  assert.deepEqual(writes, ["WH-SECRET"]);
});
