import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { createOwnerCoupleSessionFence } from "../lib/ownerCoupleSessionFence.mjs";

const OWNER_A = "10000000-0000-4000-8000-000000000001";
const OWNER_B = "10000000-0000-4000-8000-000000000002";
const COUPLE_A = "50000000-0000-4000-8000-000000000001";
const COUPLE_B = "50000000-0000-4000-8000-000000000002";

test("a late booking response from account A cannot commit after switching to B", async () => {
  const fence = createOwnerCoupleSessionFence();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const tokenA = fence.capture();
  assert.ok(tokenA);

  let releaseResponse;
  const delayedResponse = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  let committed = false;
  const operation = delayedResponse.then(() => {
    if (fence.isCurrent(tokenA)) committed = true;
  });

  fence.setOwner(OWNER_B);
  fence.setIdentity(OWNER_B, COUPLE_B);
  releaseResponse();
  await operation;

  assert.equal(committed, false);
});

test("a same-owner couple switch invalidates every captured booking identity", () => {
  const fence = createOwnerCoupleSessionFence();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const coupleAToken = fence.capture();
  assert.ok(coupleAToken);

  assert.equal(fence.setIdentity(OWNER_A, COUPLE_B), true);
  assert.equal(fence.isCurrent(coupleAToken), false);
  assert.deepEqual(fence.capture(), {
    generation: coupleAToken.generation + 1,
    ownerId: OWNER_A,
    coupleId: COUPLE_B,
  });
});

test("the booking screen invalidates loads and clears account-bound UI on auth changes", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../app/bookings/index.tsx"),
    "utf8",
  );

  assert.match(source, /createOwnerCoupleSessionFence/);
  assert.match(source, /onAuthStateChange/);
  assert.match(source, /clearIdentityBoundState/);
  assert.match(source, /isLoadCommitCurrent/);
  assert.match(source, /apiFetchForExpectedUser/);
  assert.match(
    source,
    /const coupleChanged = sessionFenceRef\.setIdentity\([\s\S]*?if \(coupleChanged\) clearIdentityBoundState\(ownerId\)/,
  );
  assert.match(source, /sessionFenceRef\.isCurrent\(expectedIdentity\)/);
  assert.match(source, /identity=\{sessionFenceRef\.capture\(\)\}/);
  assert.match(
    source,
    /parseBookingOutcomeResponse\(payload, booking\.id\)/,
  );
  assert.match(source, /value\.booking\.id !== expectedBookingId/);
  assert.match(
    source,
    /function handleOutcomeSaved\([\s\S]*?loadSequenceRef\.current \+= 1;[\s\S]*?setBookings/,
  );
  assert.match(
    source,
    /parseVendorInquiryHandoffResponse\(payload, expectedBookingId\)[\s\S]*?isIdentityCurrent\(expectedIdentity\)/,
  );
  assert.match(
    source,
    /parseVendorInquiryHandoffResponse\(payload, expectedBookingId\)[\s\S]*?isIdentityCurrent\(expectedIdentity\)/,
  );
  assert.match(
    source,
    /buildVendorInquiryMutationBody\([\s\S]{0,120}inquiry\?\.handoff \?\? null,[\s\S]{0,80}action,[\s\S]{0,80}values/,
  );
  assert.match(source, /inquiryMutationLockRef\.current = mutationToken/);
  assert.match(source, /body: JSON\.stringify\(mutationBody\)/);
  assert.match(
    source,
    /response\.status === 409[\s\S]*?VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT[\s\S]*?loadInquiryContext\(expectedBookingId\)/,
  );
  assert.match(
    source,
    /async function openPreparedInquiry\(\)[\s\S]*?canUseInquiryNativeEgress\(\)[\s\S]*?canUseInquiryNativeEgress\(\)[\s\S]*?Share\.share/,
  );
  assert.match(
    source,
    /async function openContactPath\(\)[\s\S]*?canUseInquiryNativeEgress\(\)[\s\S]*?canUseInquiryNativeEgress\(\)[\s\S]*?Linking\.openURL/,
  );
  assert.match(
    source,
    /async function canUseInquiryNativeEgress[\s\S]*?supabase\.auth\.getSession\(\)[\s\S]*?expectedOwnerId[\s\S]*?isIdentityCurrent\(expectedIdentity\)[\s\S]*?setInquiry\(null\)[\s\S]*?onClose\(\)/,
  );
});
