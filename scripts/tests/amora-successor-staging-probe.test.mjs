import assert from "node:assert/strict";
import test from "node:test";

import {
  AmoraSuccessorStagingProbeError,
  loadSupabaseProjectApiKeys,
  readHostedMigrationLedger,
  runNeutralPreparationSpaceScenario,
  validateAmoraSuccessorStagingProbeConfig,
} from "../lib/amora-successor-staging-probe.mjs";

const STAGING_REF = "rgxdizztidbgwnsbadml";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";

test("the Amora successor probe refuses the Production project before any hosted work", () => {
  assert.throws(
    () => validateAmoraSuccessorStagingProbeConfig({
      projectRef: PRODUCTION_REF,
      productionProjectRef: PRODUCTION_REF,
      approvedProjectRef: STAGING_REF,
      managementToken: "management-token-that-is-long-enough",
      expectedCommit: "a".repeat(40),
      receiptOut: "C:\\probe-evidence\\amora-staging.json",
    }),
    (error) => error instanceof AmoraSuccessorStagingProbeError
      && error.code === "PRODUCTION_TARGET_FORBIDDEN",
  );
});

test("two synthetic users get one neutral preparation space with private pre-join membership and exact replay", async () => {
  const users = [
    { id: "10000000-0000-4000-8000-000000000001", accessToken: "token-a" },
    { id: "10000000-0000-4000-8000-000000000002", accessToken: "token-b" },
  ];
  const coupleId = "20000000-0000-4000-8000-000000000001";
  const inviteCode = "WH-ABCDEF123456";
  const membership = new Map(users.map(({ id }) => [id, null]));
  const cleanupCalls = [];
  let createCount = 0;

  const transport = {
    async createSyntheticUser() {
      return users[createCount++];
    },
    async createNeutralPreparationSpace(user) {
      if (membership.get(user.id) === coupleId) {
        return {
          success: true,
          created: false,
          idempotent: true,
          couple_id: coupleId,
          invite_code: inviteCode,
          member_model_version: 2,
        };
      }
      membership.set(user.id, coupleId);
      return {
        success: true,
        created: true,
        idempotent: false,
        couple_id: coupleId,
        invite_code: inviteCode,
        member_model_version: 2,
      };
    },
    async readProfile(viewer, targetId) {
      if (viewer.id === targetId) {
        return [{ id: targetId, couple_id: membership.get(targetId), role: targetId === users[0].id ? "bride" : "groom" }];
      }
      return membership.get(viewer.id) === coupleId && membership.get(targetId) === coupleId
        ? [{ id: targetId, couple_id: coupleId, role: targetId === users[0].id ? "bride" : "groom" }]
        : [];
    },
    async readCouple(viewer) {
      return membership.get(viewer.id) === coupleId
        ? [{ id: coupleId, member_model_version: 2 }]
        : [];
    },
    async callServerJoinAsAuthenticated() {
      return { denied: true };
    },
    async joinNeutralPreparationSpaceServer(actorUserId) {
      membership.set(actorUserId, coupleId);
      return {
        success: true,
        joined: true,
        idempotent: false,
        couple_id: coupleId,
        member_model_version: 2,
      };
    },
    async resetMembership(user) {
      membership.set(user.id, null);
      return { success: true, previous_couple_id: coupleId };
    },
    async deleteSyntheticUser(userId) {
      cleanupCalls.push(userId);
    },
    async readResidue() {
      return { profiles: 0, couples: 0 };
    },
  };

  const result = await runNeutralPreparationSpaceScenario({ transport });

  assert.deepEqual(result.checks, {
    ownerCreate: true,
    ownerReplay: true,
    preJoinProfileIsolation: true,
    preJoinCoupleIsolation: true,
    authenticatedServerJoinDenied: true,
    serverJoin: true,
    postJoinMutualProfileRead: true,
    postJoinCoupleRead: true,
    cleanup: true,
  });
  assert.equal(result.syntheticUserCount, 2);
  assert.deepEqual(result.residue, { profiles: 0, couples: 0 });
  assert.deepEqual(cleanupCalls.sort(), users.map(({ id }) => id).sort());
  assert.equal(JSON.stringify(result).includes(users[0].id), false);
  assert.equal(JSON.stringify(result).includes(users[1].id), false);
  assert.equal(JSON.stringify(result).includes(inviteCode), false);
});

test("the staging transport obtains both legacy API roles without exposing unrelated keys", async () => {
  const requests = [];
  const keys = await loadSupabaseProjectApiKeys({
    projectRef: STAGING_REF,
    managementToken: "management-token-that-is-long-enough",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify([
        { name: "anon", api_key: "anon-key-value" },
        { name: "service_role", api_key: "service-role-key-value" },
        { name: "publishable", api_key: "unused-publishable-key" },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.deepEqual(keys, {
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.supabase.com/v1/projects/${STAGING_REF}/api-keys`);
  assert.equal(requests[0].init.headers.Authorization, "Bearer management-token-that-is-long-enough");
  assert.equal(JSON.stringify(keys).includes("unused-publishable-key"), false);
});

test("the hosted probe binds its receipt to the exact applied migration ledger", async () => {
  const ledger = await readHostedMigrationLedger({
    projectRef: STAGING_REF,
    managementToken: "management-token-that-is-long-enough",
    expectedCount: 218,
    expectedHead: "20260816190000",
    fetchImpl: async () => new Response(JSON.stringify([{
      migration_count: 218,
      migration_head: "20260816190000",
    }]), { status: 201, headers: { "content-type": "application/json" } }),
  });

  assert.deepEqual(ledger, { count: 218, head: "20260816190000" });
});
