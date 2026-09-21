import test from "node:test";
import assert from "node:assert/strict";
import { mutateSyntheticMemoryWithConfirmation, verifySyntheticResetConfirmation } from "../../apps/web/scripts/lib/synthetic-privacy-confirmation.mjs";

const BRIDE = "00000000-0000-4000-8000-000000000001";
const GROOM = "00000000-0000-4000-8000-000000000002";
const COUPLE = "10000000-0000-4000-8000-000000000001";

function syntheticUser(id, readEpoch) {
  return { id, client: {
    auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
    rpc: async (name, args) => {
      assert.equal(name, "get_own_amora_privacy_epoch");
      assert.deepEqual(args, { p_couple_id: COUPLE, p_visibility: "shared" });
      return { data: String(readEpoch()), error: null };
    },
  } };
}

test("hosted shared consent binds each actor to the freshly read privacy epoch", async () => {
  let epoch = 7;
  const accepted = [];
  const admin = { rpc: async (name, args) => {
    assert.equal(name, "mutate_amora_memory_with_confirmation");
    assert.deepEqual(args, {
      p_couple_id: COUPLE, p_visibility: "shared", p_user_id: accepted.length ? GROOM : BRIDE,
      p_expected_privacy_epoch: epoch, p_action: "toggle", p_consented: true,
    });
    accepted.push(args);
    epoch++;
    return { data: { enabled: accepted.length === 2, consented_count: accepted.length, required_count: 2 }, error: null };
  } };
  const first = await mutateSyntheticMemoryWithConfirmation({ admin, user: syntheticUser(BRIDE, () => epoch), coupleId: COUPLE, visibility: "shared", action: "toggle", consented: true });
  const second = await mutateSyntheticMemoryWithConfirmation({ admin, user: syntheticUser(GROOM, () => epoch), coupleId: COUPLE, visibility: "shared", action: "toggle", consented: true });
  assert.deepEqual(first.data, { enabled: false, consented_count: 1, required_count: 2 });
  assert.deepEqual(second.data, { enabled: true, consented_count: 2, required_count: 2 });
});

test("hosted memory refuses an unverified actor or unusable epoch before any service mutation", async () => {
  let writes = 0;
  const admin = { rpc: async () => { writes++; return { data: {}, error: null }; } };
  const wrongActor = syntheticUser(BRIDE, () => 7);
  wrongActor.client.auth.getUser = async () => ({ data: { user: { id: GROOM } }, error: null });
  await assert.rejects(mutateSyntheticMemoryWithConfirmation({ admin, user: wrongActor, coupleId: COUPLE, visibility: "shared", action: "toggle", consented: true }), /SYNTHETIC_PRIVACY_OWNER_MISMATCH/);
  for (const value of [null, false, "", "1.5", "9007199254740992", 0]) {
    const user = syntheticUser(BRIDE, () => 7);
    user.client.rpc = async () => ({ data: value, error: null });
    await assert.rejects(mutateSyntheticMemoryWithConfirmation({ admin, user, coupleId: COUPLE, visibility: "shared", action: "toggle", consented: true }), /SYNTHETIC_PRIVACY_TARGET_UNAVAILABLE/);
  }
  assert.equal(writes, 0);
});

test("hosted reset succeeds only for the captured user tuple and checks stale, missing and service rejection", async () => {
  const tuple = { p_expected_user_id: BRIDE, p_expected_couple_id: COUPLE, p_expected_privacy_epoch: 7 };
  let reads = 0;
  let successfulResets = 0;
  let stale = 0;
  let missing = 0;
  let service = 0;
  const user = syntheticUser(BRIDE, () => 7);
  user.client.rpc = async (name, args) => {
    if (name === "get_own_amora_privacy_epoch") {
      reads++;
      assert.deepEqual(args, { p_couple_id: COUPLE, p_visibility: "shared" });
      return { data: 7, error: null };
    }
    assert.equal(name, "reset_current_couple_membership");
    if (!args) { missing++; return { data: null, error: { code: "22023" } }; }
    assert.deepEqual(args, tuple);
    if (successfulResets) { stale++; return { data: null, error: { code: "40001" } }; }
    successfulResets++;
    return { data: { success: true, previous_couple_id: COUPLE }, error: null };
  };
  const admin = { rpc: async (name, args) => {
    service++;
    assert.equal(name, "reset_current_couple_membership");
    assert.deepEqual(args, tuple);
    return { data: null, error: { code: "42501" } };
  } };
  assert.deepEqual(await verifySyntheticResetConfirmation({ admin, user, coupleId: COUPLE }), { success: true, previous_couple_id: COUPLE });
  assert.deepEqual({ reads, successfulResets, stale, missing, service }, { reads: 1, successfulResets: 1, stale: 1, missing: 1, service: 1 });
});

test("hosted scope clear sends its exact fresh target and null consent without automatic retry after stale rejection", async () => {
  let writes = 0;
  const denied = { data: null, error: { code: "40001" } };
  const admin = { rpc: async (name, args) => {
    writes++;
    assert.equal(name, "mutate_amora_memory_with_confirmation");
    assert.deepEqual(args, { p_couple_id: COUPLE, p_visibility: "shared", p_user_id: BRIDE, p_expected_privacy_epoch: 9, p_action: "clear_scope", p_consented: null });
    return denied;
  } };
  assert.equal(await mutateSyntheticMemoryWithConfirmation({ admin, user: syntheticUser(BRIDE, () => 9), coupleId: COUPLE, visibility: "shared", action: "clear_scope" }), denied);
  assert.equal(writes, 1);
});

test("hosted reset verification fails if a forbidden call succeeds or returns an unrelated error", async () => {
  for (const brokenStage of ["missing", "service", "receipt", "stale", "unrelated-error"]) {
    let resets = 0;
    const user = syntheticUser(BRIDE, () => 7);
    const read = user.client.rpc;
    user.client.rpc = async (name, args) => {
      if (name === "get_own_amora_privacy_epoch") return read(name, args);
      if (!args) return brokenStage === "missing" ? { data: { success: true }, error: null } : { data: null, error: { code: "22023" } };
      resets++;
      if (resets === 1) return { data: { success: true, previous_couple_id: brokenStage === "receipt" ? GROOM : COUPLE }, error: null };
      if (brokenStage === "stale") return { data: { success: true }, error: null };
      return { data: null, error: { code: brokenStage === "unrelated-error" ? "57014" : "40001" } };
    };
    const admin = { rpc: async () => brokenStage === "service" ? { data: {}, error: null } : { data: null, error: { code: "42501" } } };
    await assert.rejects(verifySyntheticResetConfirmation({ admin, user, coupleId: COUPLE }), /SYNTHETIC_RESET_(MISSING_TARGET_NOT_REJECTED|SERVICE_NOT_REJECTED|POSTCONDITION_FAILED|STALE_TARGET_NOT_REJECTED)/);
  }
});
