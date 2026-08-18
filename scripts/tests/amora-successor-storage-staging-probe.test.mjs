import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AmoraSuccessorStorageStagingProbeError,
  createSupabaseStorageStagingTransport,
  inspectAmoraSuccessorStorageInventory,
  runAmoraSuccessorStorageStagingProbe,
  STORAGE_STAGING_INVENTORY_SQL,
  validateAmoraSuccessorStorageStagingProbeConfig,
} from "../lib/amora-successor-storage-staging-probe.mjs";

const STAGING_REF = "rgxdizztidbgwnsbadml";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const COMMIT = "a".repeat(40);
const POLICY_SHA256 = "7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482";
const BUCKET_SHA256 = "b".repeat(64);
const BASELINE_OBJECT_SHA256 = "c".repeat(64);
const FINAL_OBJECT_SHA256 = "d".repeat(64);
const RUN_NONCE = "0123456789abcdef0123456789abcdef";
const USER_ID = "10000000-0000-4000-8000-000000000101";
const COUPLE_ID = "20000000-0000-4000-8000-000000000101";

function inventoryRow(overrides = {}) {
  return {
    observed_at: "2026-08-19T01:00:00.000Z",
    relation_owner: "supabase_storage_admin",
    relation_rls_enabled: true,
    relation_force_rls: false,
    storage_bucket_count: 11,
    retired_guestbook_private_bucket_count: 2,
    bucket_contract_verified: true,
    bucket_contract_sha256: BUCKET_SHA256,
    storage_policy_count: 1,
    storage_insert_policy_count: 1,
    storage_policy_contract_verified: true,
    storage_policy_expression_sha256: POLICY_SHA256,
    production_storage_fence_function_verified: true,
    production_storage_writes_allowed: false,
    total_object_count: 49,
    object_inventory_sha256: BASELINE_OBJECT_SHA256,
    exact_nonce_auth_user_count: 0,
    exact_nonce_profile_count: 0,
    exact_nonce_couple_count: 0,
    exact_nonce_storage_object_count: 0,
    ...overrides,
  };
}

function normalizedInventory(overrides = {}) {
  return {
    observedAt: "2026-08-19T01:00:00.000Z",
    relationOwner: "supabase_storage_admin",
    relationRlsEnabled: true,
    relationForceRls: false,
    storageBucketCount: 11,
    retiredGuestbookPrivateBucketCount: 2,
    bucketContractSha256: BUCKET_SHA256,
    storagePolicyCount: 1,
    storageInsertPolicyCount: 1,
    storagePolicyExpressionSha256: POLICY_SHA256,
    productionStorageFenceFunctionVerified: true,
    productionStorageWritesAllowed: false,
    totalObjectCount: 49,
    objectInventorySha256: BASELINE_OBJECT_SHA256,
    exactNonceAuthUserCount: 0,
    exactNonceProfileCount: 0,
    exactNonceCoupleCount: 0,
    exactNonceStorageObjectCount: 0,
    ...overrides,
  };
}

async function probeConfig() {
  const repoRoot = await mkdtemp(join(tmpdir(), "amora-storage-probe-repo-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "amora-storage-probe-receipt-"));
  const receiptOut = join(receiptRoot, "storage-staging-probe.json");
  return validateAmoraSuccessorStorageStagingProbeConfig({
    repoRoot,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    approvedProjectRef: STAGING_REF,
    managementToken: "management-token-that-is-long-enough",
    expectedCommit: COMMIT,
    receiptOut,
  });
}

function happyTransport(events, {
  candidatePaths = [],
  differentPathDenied = true,
  unsignedAllowed = null,
  chatDirectInsertDenied = true,
  deleteUserResult = { deleted: true },
} = {}) {
  const recordCandidate = (kind, bucketId, objectPath) => {
    assert.match(objectPath, new RegExp(RUN_NONCE, "u"));
    candidatePaths.push({ kind, bucketId, objectPath });
  };
  return {
    async createSyntheticUser(label) {
      assert.match(label, new RegExp(RUN_NONCE, "u"));
      events.push(`createUser:${label}`);
      return {
        id: USER_ID,
        coupleId: COUPLE_ID,
        accessToken: "synthetic-auth-token-that-must-not-enter-the-receipt",
      };
    },
    async createSignedUpload({ user, bucketId, objectPath }) {
      assert.equal(user.id, USER_ID);
      assert.equal(bucketId, "community-media-staging");
      assert.match(objectPath, new RegExp(RUN_NONCE, "u"));
      recordCandidate("signed-original", bucketId, objectPath);
      events.push("createSignedUpload");
      return {
        bucketId,
        objectPath,
        token: "signed-upload-token-that-must-not-enter-the-receipt",
        signedUrl: `https://${STAGING_REF}.supabase.co/storage/v1/object/upload/sign/${bucketId}/${objectPath}?token=secret`,
      };
    },
    async uploadSignedObject({ signedUpload, bucketId, objectPath, contentType, bytes }) {
      assert.equal(signedUpload.objectPath, objectPath);
      assert.equal(bucketId, "community-media-staging");
      assert.equal(contentType, "image/png");
      assert.ok(bytes instanceof Uint8Array);
      events.push("uploadSignedObject");
      return { uploaded: true };
    },
    async attemptSignedUploadAtDifferentPath({ signedUpload, objectPath, differentObjectPath }) {
      assert.notEqual(differentObjectPath, objectPath);
      assert.equal(signedUpload.objectPath, objectPath);
      recordCandidate("signed-different-path", signedUpload.bucketId, differentObjectPath);
      events.push("attemptSignedDifferentPath");
      return { denied: differentPathDenied };
    },
    async attemptUnsignedMutation({ actor, bucketId, objectPath }) {
      assert.ok(["anon", "authenticated"].includes(actor));
      assert.ok([
        "community-media-staging",
        "community-images",
        "community-videos",
      ].includes(bucketId));
      assert.match(objectPath, new RegExp(RUN_NONCE, "u"));
      recordCandidate(`unsigned-${actor}`, bucketId, objectPath);
      events.push(`unsigned:${actor}:${bucketId}`);
      return {
        denied: unsignedAllowed?.actor !== actor
          || unsignedAllowed?.bucketId !== bucketId,
      };
    },
    async attemptChatDirectInsert({ user, bucketId, objectPath }) {
      assert.equal(user.id, USER_ID);
      assert.equal(user.coupleId, COUPLE_ID);
      assert.equal(bucketId, "chat-image");
      assert.match(objectPath, new RegExp(`^${COUPLE_ID}/${USER_ID}/`, "u"));
      assert.match(objectPath, new RegExp(RUN_NONCE, "u"));
      recordCandidate("chat-direct", bucketId, objectPath);
      events.push("chatDirectInsert");
      return { denied: chatDirectInsertDenied };
    },
    async deleteExactObject({ bucketId, objectPath }) {
      assert.ok([
        "community-media-staging",
        "community-images",
        "community-videos",
        "chat-image",
      ].includes(bucketId));
      assert.match(objectPath, new RegExp(RUN_NONCE, "u"));
      events.push(`cleanup:${bucketId}:${objectPath}`);
      return { deleted: true, absent: true };
    },
    async deleteSyntheticUser(userId) {
      assert.equal(userId, USER_ID);
      events.push("deleteUser");
      return deleteUserResult;
    },
  };
}

test("the storage probe rejects Production, approval drift, same refs, and receipts inside the repository", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "amora-storage-config-repo-"));
  const base = {
    repoRoot,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    approvedProjectRef: STAGING_REF,
    managementToken: "management-token-that-is-long-enough",
    expectedCommit: COMMIT,
    receiptOut: join(tmpdir(), "amora-storage-config-receipt.json"),
  };

  for (const [name, input, code] of [
    ["Production", { ...base, projectRef: PRODUCTION_REF, approvedProjectRef: PRODUCTION_REF }, "PRODUCTION_TARGET_FORBIDDEN"],
    ["same ref", { ...base, productionProjectRef: STAGING_REF }, "PRODUCTION_TARGET_FORBIDDEN"],
    ["approval drift", { ...base, approvedProjectRef: "abcdefghijklmnopqrst" }, "STAGING_PROJECT_PIN_MISMATCH"],
    ["receipt inside repo", { ...base, receiptOut: join(repoRoot, "receipt.json") }, "RECEIPT_INSIDE_REPOSITORY"],
    ["fetch host injection", { ...base, projectRef: "evil.example.invalid" }, "PROJECT_REF_INVALID"],
  ]) {
    assert.throws(
      () => validateAmoraSuccessorStorageStagingProbeConfig(input),
      (error) => error instanceof AmoraSuccessorStorageStagingProbeError
        && error.code === code,
      name,
    );
  }
});

test("the public inventory SQL pins the hosted owner, RLS shape, eleven exact buckets, two private guestbook buckets, and one policy SHA", () => {
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /supabase_storage_admin/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /relrowsecurity/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /relforcerowsecurity/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /file_size_limit/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /allowed_mime_types/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /auth\.users/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /public\.profiles/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /public\.couples/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /storage\.objects/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /\$2::uuid/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /\$3::uuid/iu);
  for (const bucketId of [
    "chat-image",
    "cohort-images",
    "community-images",
    "community-videos",
    "guestbook-images",
    "guestbook-uploads",
    "invitation-photos",
    "user_photos",
    "vendor-images",
    "vendor-licenses",
    "community-media-staging",
  ]) {
    assert.match(STORAGE_STAGING_INVENTORY_SQL, new RegExp(bucketId, "u"), bucketId);
  }
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /guestbook-images[^\n]+false/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /guestbook-uploads[^\n]+false/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, new RegExp(POLICY_SHA256, "u"));
  assert.match(
    STORAGE_STAGING_INVENTORY_SQL,
    /2d68394af998108f9f35441e53d3ec1dfcde0f5f450e736aa78bd55efae50316/iu,
  );
  assert.doesNotMatch(
    STORAGE_STAGING_INVENTORY_SQL,
    /public\.production_storage_writes_allowed\s*\(\s*\)\s+AS production_storage_writes_allowed/iu,
  );
});

test("the read-only inventory call uses only the fixed Management host, a bounded request, and a strict result shape", async () => {
  const requests = [];
  const result = await inspectAmoraSuccessorStorageInventory({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    managementToken: "management-token-that-is-long-enough",
    runNonce: RUN_NONCE,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify([inventoryRow()]), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(result, normalizedInventory());
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://api.supabase.com/v1/projects/${STAGING_REF}/database/query/read-only`,
  );
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.redirect, "error");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    query: STORAGE_STAGING_INVENTORY_SQL,
    parameters: [RUN_NONCE, null, null],
  });

  const exactRequests = [];
  await inspectAmoraSuccessorStorageInventory({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    managementToken: "management-token-that-is-long-enough",
    runNonce: RUN_NONCE,
    userId: USER_ID,
    coupleId: COUPLE_ID,
    fetchImpl: async (_url, init) => {
      exactRequests.push(JSON.parse(init.body));
      return new Response(JSON.stringify([inventoryRow()]), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(exactRequests, [{
    query: STORAGE_STAGING_INVENTORY_SQL,
    parameters: [RUN_NONCE, USER_ID, COUPLE_ID],
  }]);

  await assert.rejects(
    inspectAmoraSuccessorStorageInventory({
      projectRef: STAGING_REF,
      productionProjectRef: PRODUCTION_REF,
      managementToken: "management-token-that-is-long-enough",
      runNonce: RUN_NONCE,
      fetchImpl: async () => new Response("[]", { status: 201 }),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "STORAGE_INVENTORY_RESULT_INVALID",
  );
  await assert.rejects(
    inspectAmoraSuccessorStorageInventory({
      projectRef: STAGING_REF,
      productionProjectRef: PRODUCTION_REF,
      managementToken: "management-token-that-is-long-enough",
      runNonce: RUN_NONCE,
      fetchImpl: async () => { throw new Error("timeout"); },
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "STORAGE_INVENTORY_UNAVAILABLE",
  );
});

test("inventory inspection fails closed on every owner, RLS, bucket, policy, fence, or nonce-residue drift", async () => {
  const driftCases = [
    ["relation_owner", "postgres"],
    ["relation_rls_enabled", false],
    ["relation_force_rls", true],
    ["storage_bucket_count", 12],
    ["retired_guestbook_private_bucket_count", 1],
    ["bucket_contract_verified", false],
    ["bucket_contract_sha256", "not-a-digest"],
    ["storage_policy_count", 5],
    ["storage_insert_policy_count", 0],
    ["storage_policy_contract_verified", false],
    ["storage_policy_expression_sha256", "e".repeat(64)],
    ["production_storage_fence_function_verified", false],
    ["production_storage_writes_allowed", true],
    ["exact_nonce_auth_user_count", 1],
    ["exact_nonce_profile_count", 1],
    ["exact_nonce_couple_count", 1],
    ["exact_nonce_storage_object_count", 1],
  ];

  for (const [field, value] of driftCases) {
    await assert.rejects(
      inspectAmoraSuccessorStorageInventory({
        projectRef: STAGING_REF,
        productionProjectRef: PRODUCTION_REF,
        managementToken: "management-token-that-is-long-enough",
        runNonce: RUN_NONCE,
        fetchImpl: async () => new Response(
          JSON.stringify([inventoryRow({ [field]: value })]),
          { status: 201 },
        ),
      }),
      (error) => error instanceof AmoraSuccessorStorageStagingProbeError
        && error.code === "STORAGE_INVENTORY_CONTRACT_DRIFT",
      field,
    );
  }
});

test("the hosted transport refuses an off-project signed-upload URL before it can fetch that host", async () => {
  const requests = [];
  const transport = createSupabaseStorageStagingTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({
        token: "signed-token",
        url: "https://attacker.invalid/storage/v1/upload/sign/community-media-staging/object.png?token=signed-token",
      }), { status: 200 });
    },
  });

  await assert.rejects(
    transport.createSignedUpload({
      user: { id: USER_ID, accessToken: "actor-token" },
      bucketId: "community-media-staging",
      objectPath: `${USER_ID}/${RUN_NONCE}/probe.png`,
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "SIGNED_UPLOAD_HOST_FORBIDDEN",
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0], new RegExp(`^https://${STAGING_REF}\\.supabase\\.co/`, "u"));
});

test("the hosted transport atomically resets synthetic membership before deleting the Auth user", async () => {
  const requests = [];
  const transport = createSupabaseStorageStagingTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      requests.push({ path: `${parsed.pathname}${parsed.search}`, init });
      if (parsed.pathname === "/auth/v1/admin/users" && init.method === "POST") {
        return Response.json({ id: USER_ID });
      }
      if (parsed.pathname === "/auth/v1/token" && init.method === "POST") {
        return Response.json({
          access_token: "authenticated-synthetic-user-token",
          user: { id: USER_ID },
        });
      }
      if (parsed.pathname === "/rest/v1/rpc/create_neutral_preparation_space_for_current_user") {
        return Response.json({ success: true, couple_id: COUPLE_ID });
      }
      if (parsed.pathname === "/rest/v1/rpc/reset_current_couple_membership") {
        return Response.json({ success: true, previous_couple_id: COUPLE_ID });
      }
      if (parsed.pathname === `/auth/v1/admin/users/${USER_ID}` && init.method === "DELETE") {
        return Response.json({});
      }
      return Response.json({ error: "unexpected_request" }, { status: 500 });
    },
  });

  const user = await transport.createSyntheticUser(`amora-storage-${RUN_NONCE}`);
  const deleted = await transport.deleteSyntheticUser(user.id);

  assert.deepEqual(deleted, { deleted: true });
  assert.deepEqual(
    requests.map(({ path }) => path),
    [
      "/auth/v1/admin/users",
      "/auth/v1/token?grant_type=password",
      "/rest/v1/rpc/create_neutral_preparation_space_for_current_user",
      "/rest/v1/rpc/reset_current_couple_membership",
      `/auth/v1/admin/users/${USER_ID}`,
    ],
  );
  assert.equal(requests.some(({ path }) => path.startsWith("/rest/v1/couples")), false);
  assert.equal(requests.some(({ path }) => path.startsWith("/rest/v1/profiles")), false);
});

test("a staging run proves exact signed upload, wrong-path and unsigned denial, chat fence closure, and zero-residue cleanup without claiming drain", async () => {
  const config = await probeConfig();
  const events = [];
  const candidatePaths = [];
  const inventoryPhases = [];
  const baseline = normalizedInventory();
  const final = normalizedInventory({
    observedAt: "2026-08-19T01:00:01.000Z",
    totalObjectCount: 50,
    objectInventorySha256: FINAL_OBJECT_SHA256,
  });

  const result = await runAmoraSuccessorStorageStagingProbe({
    config,
    runNonce: RUN_NONCE,
    transport: happyTransport(events, { candidatePaths }),
    inspectInventory: async ({ phase, runNonce, userId, coupleId }) => {
      assert.equal(runNonce, RUN_NONCE);
      assert.equal(userId, phase === "baseline" ? null : USER_ID);
      assert.equal(coupleId, phase === "baseline" ? null : COUPLE_ID);
      inventoryPhases.push(phase);
      return phase === "baseline" ? baseline : final;
    },
    now: () => new Date("2026-08-19T01:00:02.000Z"),
  });

  assert.equal(result.status, "upload_cleanup_verified");
  assert.equal(result.signedUploadTokenExpired, false);
  assert.equal(result.drainVerified, false);
  assert.deepEqual(result.checks, {
    baselineContract: true,
    signedExactPathUpload: true,
    signedDifferentPathDenied: true,
    anonUnsignedDenied: true,
    authenticatedUnsignedDenied: true,
    chatDirectInsertDenied: true,
    productionStorageFenceNotLifted: true,
    exactObjectCleanup: true,
    finalContractStable: true,
    exactNonceResidueZero: true,
  });
  assert.deepEqual(inventoryPhases, ["baseline", "final"]);
  assert.equal(result.inventory.bucketContractSha256, BUCKET_SHA256);
  assert.equal(result.inventory.storagePolicyExpressionSha256, POLICY_SHA256);
  assert.equal(result.inventory.baselineObjectInventorySha256, BASELINE_OBJECT_SHA256);
  assert.equal(result.inventory.finalObjectInventorySha256, FINAL_OBJECT_SHA256);
  assert.equal(result.inventory.globalObjectInventoryChanged, true);
  assert.deepEqual(result.residue, {
    authUsers: 0,
    profiles: 0,
    couples: 0,
    storageObjects: 0,
  });

  assert.deepEqual(events.filter((event) => event.startsWith("unsigned:")), [
    "unsigned:anon:community-media-staging",
    "unsigned:authenticated:community-media-staging",
    "unsigned:anon:community-images",
    "unsigned:authenticated:community-images",
    "unsigned:anon:community-videos",
    "unsigned:authenticated:community-videos",
  ]);
  const cleanupEvents = events.filter((event) => event.startsWith("cleanup:"));
  const exactCandidates = new Set(candidatePaths.map(
    ({ bucketId, objectPath }) => `${bucketId}:${objectPath}`,
  ));
  assert.ok(exactCandidates.size >= 9);
  assert.deepEqual(
    new Set(cleanupEvents.map((event) => event.slice("cleanup:".length))),
    exactCandidates,
  );
  assert.ok(events.indexOf(cleanupEvents[0]) > events.indexOf("uploadSignedObject"));
  assert.ok(events.indexOf("deleteUser") > events.indexOf(cleanupEvents.at(-1)));

  const persisted = JSON.parse(await readFile(config.receiptOut, "utf8"));
  assert.equal(persisted.status, "upload_cleanup_verified");
  assert.equal(persisted.signedUploadTokenExpired, false);
  assert.equal(persisted.drainVerified, false);
  assert.deepEqual(persisted.residue, {
    authUsers: 0,
    profiles: 0,
    couples: 0,
    storageObjects: 0,
  });
  const serialized = JSON.stringify({ result, persisted });
  for (const secret of [
    USER_ID,
    COUPLE_ID,
    RUN_NONCE,
    "synthetic-auth-token-that-must-not-enter-the-receipt",
    "signed-upload-token-that-must-not-enter-the-receipt",
    "?token=secret",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.doesNotMatch(serialized, /storage_signed_upload_drain_verified/iu);
});

test("cleanup and final residue inspection still run when a signed token is accepted for a different path", async () => {
  const config = await probeConfig();
  const events = [];
  const candidatePaths = [];
  const inventoryPhases = [];

  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport(events, {
        candidatePaths,
        differentPathDenied: false,
      }),
      inspectInventory: async ({ phase }) => {
        inventoryPhases.push(phase);
        return normalizedInventory({
          observedAt: phase === "baseline"
            ? "2026-08-19T01:00:00.000Z"
            : "2026-08-19T01:00:01.000Z",
        });
      },
      now: () => new Date("2026-08-19T01:00:02.000Z"),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "SIGNED_UPLOAD_PATH_REUSE_ALLOWED",
  );

  assert.deepEqual(
    new Set(candidatePaths.map(({ kind }) => kind)),
    new Set(["signed-original", "signed-different-path"]),
  );
  for (const { bucketId, objectPath } of candidatePaths) {
    assert.ok(events.includes(`cleanup:${bucketId}:${objectPath}`));
  }
  assert.ok(events.includes("deleteUser"));
  assert.ok(events.indexOf("deleteUser") > Math.max(...candidatePaths.map(
    ({ bucketId, objectPath }) => events.indexOf(`cleanup:${bucketId}:${objectPath}`),
  )));
  assert.deepEqual(inventoryPhases, ["baseline", "final"]);
});

test("every attempted nonce path is service-cleaned when an unsigned negative canary unexpectedly succeeds", async () => {
  const config = await probeConfig();
  const events = [];
  const candidatePaths = [];

  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport(events, {
        candidatePaths,
        unsignedAllowed: { actor: "authenticated", bucketId: "community-images" },
      }),
      inspectInventory: async () => normalizedInventory(),
      now: () => new Date("2026-08-19T01:00:02.000Z"),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "UNSIGNED_STORAGE_MUTATION_ALLOWED",
  );

  assert.ok(candidatePaths.some(({ kind, bucketId }) =>
    kind === "unsigned-authenticated" && bucketId === "community-images"));
  for (const { bucketId, objectPath } of candidatePaths) {
    assert.ok(events.includes(`cleanup:${bucketId}:${objectPath}`));
  }
  assert.ok(events.includes("deleteUser"));
});

test("a missing synthetic-user cleanup acknowledgement fails closed after final inventory", async () => {
  const config = await probeConfig();
  const events = [];

  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport(events, { deleteUserResult: {} }),
      inspectInventory: async () => normalizedInventory(),
      now: () => new Date("2026-08-19T01:00:02.000Z"),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "STORAGE_PROBE_CLEANUP_FAILED",
  );

  assert.ok(events.includes("deleteUser"));
});
