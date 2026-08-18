import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import * as storageProbe from "../lib/amora-successor-storage-staging-probe.mjs";

import {
  AmoraSuccessorStorageStagingProbeError,
  createSupabaseStorageStagingTransport,
  inspectAmoraSuccessorStorageInventory,
  STORAGE_STAGING_INVENTORY_SQL,
  validateAmoraSuccessorStorageStagingProbeConfig,
} from "../lib/amora-successor-storage-staging-probe.mjs";

function runAmoraSuccessorStorageStagingProbe(input) {
  return storageProbe.runAmoraSuccessorStorageStagingProbe({
    ...input,
    runtimePlatform: "linux",
  });
}

function recoverAmoraSuccessorStorageStagingProbe(input) {
  return storageProbe.recoverAmoraSuccessorStorageStagingProbe({
    ...input,
    runtimePlatform: "linux",
  });
}

const STAGING_REF = "rgxdizztidbgwnsbadml";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const COMMIT = "a".repeat(40);
const CHAT_POLICY_SHA256 = "64bbc946e4c70b9629b21e9a151e5faa95c228acb80dfa4f26778f472b246e19";
const DISCLOSURE_POLICY_SHA256 = "ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f";
const DISCLOSURE_INSERT_POLICY_SHA256 =
  "24edd073465ecb17ec3baee29c679abda37160c55eb8bda58ecd20e0c7e625de";
const DISCLOSURE_UPDATE_POLICY_SHA256 = "2443f1653a213dde8c5e3edec0c42258c90ac94464397cd644ce6c2d1ddc60ac";
const POLICY_CONTRACT_SHA256 = "df6c4ca89d9edff53a93042a018708cfc145faeebeb7951524bb8bfb7bb7cac7";
const PRODUCTION_STORAGE_FENCE_SOURCE_SHA256 =
  "806818646e13253b2cd985f40adf1b3f42e8f8855b922ea9dd95e68a875bcd25";
const BUCKET_SHA256 = "b".repeat(64);
const BASELINE_OBJECT_SHA256 = "c".repeat(64);
const FINAL_OBJECT_SHA256 = "d".repeat(64);
const RUN_NONCE = "0123456789abcdef0123456789abcdef";
const USER_ID = "10000000-0000-4000-8000-000000000101";
const COUPLE_ID = "20000000-0000-4000-8000-000000000101";

const DISCOVERY_HELPER_SOURCE_SHA256 = "e".repeat(64);
const DISCOVERY_OBJECT_SHA256 = "f".repeat(64);
const DISCOVERY_HELPER_CONFIG_SHA256 = "7".repeat(64);

function discoveryConfigInput(overrides = {}) {
  return {
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    approvedProjectRef: STAGING_REF,
    managementToken: "discovery-management-token-that-must-never-be-returned",
    expectedCommit: COMMIT,
    ...overrides,
  };
}

function discoveryRow(overrides = {}) {
  return {
    observed_at: "2026-08-19T02:00:00.000Z",
    relation_owner: "supabase_storage_admin",
    relation_rls_enabled: true,
    relation_force_rls: false,
    buckets: [
      {
        id: "live-private-bucket",
        name: "live-private-bucket",
        public: false,
        file_size_limit: null,
        allowed_mime_types: null,
      },
      {
        id: "live-public-bucket",
        name: "live-public-bucket",
        public: true,
        file_size_limit: 4096,
        allowed_mime_types: ["image/webp", "image/png"],
      },
    ],
    policies: [
      {
        name: "live_select_policy",
        permissive: "RESTRICTIVE",
        roles: ["authenticated", "anon"],
        command: "SELECT",
        using_expression_sha256: "1".repeat(64),
        with_check_expression_sha256: "2".repeat(64),
        expression_sha256: "3".repeat(64),
        using_expression: "bucket_id = 'must-not-leave-management-boundary'",
      },
      {
        name: "live_insert_policy",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using_expression_sha256: "4".repeat(64),
        with_check_expression_sha256: "5".repeat(64),
        expression_sha256: "6".repeat(64),
        with_check_expression: "private predicate must not be returned",
      },
    ],
    helper_functions: [
      {
        schema: "public",
        name: "production_storage_writes_allowed",
        identity_arguments: "",
        owner: "postgres",
        security_definer: true,
        volatility: "STABLE",
        config_sha256: DISCOVERY_HELPER_CONFIG_SHA256,
        search_path_empty: false,
        config: [
          "search_path=\"\"",
          "app.private_token=helper-secret-that-must-not-be-returned",
        ],
        execute_roles: ["authenticated"],
        source_sha256: DISCOVERY_HELPER_SOURCE_SHA256,
        source: "BEGIN RETURN secret_value; END",
      },
    ],
    fence_trigger_names: [],
    fence_event_trigger_names: [],
    fence_guard_function_exists: false,
    fence_attach_function_exists: false,
    production_storage_writes_allowed: true,
    total_object_count: 49,
    object_inventory_sha256: DISCOVERY_OBJECT_SHA256,
    object_paths: ["private-couple/object-that-must-not-be-returned.png"],
    management_token: "row-secret-that-must-not-be-returned",
    ...overrides,
  };
}

function normalizedDiscoveryInventory() {
  return {
    observedAt: "2026-08-19T02:00:00.000Z",
    relationOwner: "supabase_storage_admin",
    relationRlsEnabled: true,
    relationForceRls: false,
    buckets: [
      {
        id: "live-private-bucket",
        name: "live-private-bucket",
        public: false,
        fileSizeLimit: null,
        allowedMimeTypes: null,
      },
      {
        id: "live-public-bucket",
        name: "live-public-bucket",
        public: true,
        fileSizeLimit: 4096,
        allowedMimeTypes: ["image/webp", "image/png"],
      },
    ],
    policies: [
      {
        name: "live_insert_policy",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        usingExpressionSha256: "4".repeat(64),
        withCheckExpressionSha256: "5".repeat(64),
        expressionSha256: "6".repeat(64),
      },
      {
        name: "live_select_policy",
        permissive: "RESTRICTIVE",
        roles: ["anon", "authenticated"],
        command: "SELECT",
        usingExpressionSha256: "1".repeat(64),
        withCheckExpressionSha256: "2".repeat(64),
        expressionSha256: "3".repeat(64),
      },
    ],
    helperFunctions: [
      {
        schema: "public",
        name: "production_storage_writes_allowed",
        identityArguments: "",
        owner: "postgres",
        securityDefiner: true,
        volatility: "STABLE",
        configSha256: DISCOVERY_HELPER_CONFIG_SHA256,
        searchPathEmpty: false,
        executeRoles: ["authenticated"],
        sourceSha256: DISCOVERY_HELPER_SOURCE_SHA256,
      },
    ],
    fence: {
      triggerNames: [],
      eventTriggerNames: [],
      guardFunctionExists: false,
      attachFunctionExists: false,
      productionStorageWritesAllowed: true,
    },
    totalObjectCount: 49,
    objectInventorySha256: DISCOVERY_OBJECT_SHA256,
  };
}

function inventoryRow(overrides = {}) {
  return {
    observed_at: "2026-08-19T01:00:00.000Z",
    relation_owner: "supabase_storage_admin",
    relation_rls_enabled: true,
    relation_force_rls: false,
    storage_bucket_count: 13,
    retired_guestbook_private_bucket_count: 2,
    bucket_contract_verified: true,
    bucket_contract_sha256: BUCKET_SHA256,
    storage_policy_count: 5,
    storage_insert_policy_count: 2,
    storage_policy_contract_verified: true,
    storage_policy_contract_sha256: POLICY_CONTRACT_SHA256,
    production_storage_fence_function_verified: true,
    production_storage_writes_allowed: true,
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
    storageBucketCount: 13,
    retiredGuestbookPrivateBucketCount: 2,
    bucketContractSha256: BUCKET_SHA256,
    storagePolicyCount: 5,
    storageInsertPolicyCount: 2,
    storagePolicyContractSha256: POLICY_CONTRACT_SHA256,
    productionStorageFenceFunctionVerified: true,
    productionStorageWritesAllowed: true,
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
  const recoveryJournalOut = join(receiptRoot, "storage-staging-probe.recovery.jsonl");
  return validateAmoraSuccessorStorageStagingProbeConfig({
    repoRoot,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    approvedProjectRef: STAGING_REF,
    managementToken: "management-token-that-is-long-enough",
    expectedCommit: COMMIT,
    receiptOut,
    recoveryJournalOut,
  });
}

function initialRecoveryJournalRecord(config, runNonce, startedAt) {
  return {
    journalVersion: 1,
    kind: "amora-successor-storage-staging-recovery",
    status: "incomplete",
    projectRef: config.projectRef,
    gitCommit: config.expectedCommit,
    runNonce,
    identityMarker: createHash("sha256").update([
      "amora-successor-storage-staging-recovery-v1",
      config.projectRef,
      config.expectedCommit,
      runNonce,
    ].join("\n"), "utf8").digest("hex"),
    startedAt,
    userId: null,
    coupleId: null,
    candidates: [],
  };
}

function happyTransport(events, {
  candidatePaths = [],
  differentPathDenied = true,
  unsignedAllowed = null,
  chatBoundary = {
    ownInsertSucceeded: true,
    anonInsertDenied: true,
    wrongCoupleDenied: true,
    wrongUploaderDenied: true,
    malformedPathDenied: true,
    readDenied: true,
    updateDenied: true,
    deleteDenied: true,
  },
  deleteUserResult = { deleted: true },
} = {}) {
  const recordCandidate = (kind, bucketId, objectPath) => {
    assert.ok(objectPath.includes(RUN_NONCE) || kind.startsWith("chat-"));
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
      assert.ok(objectPath.includes(RUN_NONCE) || bucketId === "chat-image");
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
      assert.ok(objectPath.includes(RUN_NONCE) || bucketId === "chat-image");
      recordCandidate(`unsigned-${actor}`, bucketId, objectPath);
      events.push(`unsigned:${actor}:${bucketId}`);
      return {
        denied: unsignedAllowed?.actor !== actor
          || unsignedAllowed?.bucketId !== bucketId,
      };
    },
    async verifyChatBoundary({
      user,
      bucketId,
      ownObjectPath,
      anonObjectPath,
      wrongCoupleObjectPath,
      wrongUploaderObjectPath,
      malformedObjectPath,
    }) {
      assert.equal(user.id, USER_ID);
      assert.equal(user.coupleId, COUPLE_ID);
      assert.equal(bucketId, "chat-image");
      assert.match(ownObjectPath, new RegExp(`^${COUPLE_ID}/${USER_ID}/`, "u"));
      for (const [kind, objectPath] of [
        ["chat-own", ownObjectPath],
        ["chat-anon", anonObjectPath],
        ["chat-wrong-couple", wrongCoupleObjectPath],
        ["chat-wrong-uploader", wrongUploaderObjectPath],
        ["chat-malformed", malformedObjectPath],
      ]) {
        recordCandidate(kind, bucketId, objectPath);
      }
      events.push("verifyChatBoundary");
      return chatBoundary;
    },
    async deleteExactObject({ bucketId, objectPath }) {
      assert.ok([
        "community-media-staging",
        "community-images",
        "community-videos",
        "chat-image",
      ].includes(bucketId));
      assert.ok(objectPath.includes(RUN_NONCE) || bucketId === "chat-image");
      events.push(`cleanup:${bucketId}:${objectPath}`);
      return { deleted: true, absent: true };
    },
    async deleteSyntheticUser(userId) {
      assert.equal(userId, USER_ID);
      events.push("deleteUser");
      return deleteUserResult;
    },
    async recoverSyntheticUser({ userId, coupleId, identityLabel }) {
      assert.equal(userId, USER_ID);
      assert.equal(coupleId, COUPLE_ID);
      assert.equal(identityLabel, `amora-storage-${RUN_NONCE}`);
      events.push("recoverUser");
      return { deleted: true };
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
    ["journal inside repo", { ...base, recoveryJournalOut: join(repoRoot, "recovery.jsonl") }, "RECEIPT_INSIDE_REPOSITORY"],
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

test("receipt, recovery-journal, and discovery-receipt parents cannot link back inside the repository", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "amora-storage-link-repo-"));
  const insideArtifactRoot = join(repoRoot, "artifact-target");
  await mkdir(insideArtifactRoot);
  const outsideRoot = await mkdtemp(join(tmpdir(), "amora-storage-link-outside-"));
  const outsideLookingParent = join(outsideRoot, "outside-looking-parent");
  await symlink(
    insideArtifactRoot,
    outsideLookingParent,
    process.platform === "win32" ? "junction" : "dir",
  );

  const linkedReceipt = join(outsideLookingParent, "probe-receipt.json");
  const linkedJournal = join(outsideLookingParent, "probe-recovery.jsonl");
  const linkedDiscoveryReceipt = join(outsideLookingParent, "discovery-receipt.json");
  const actualJournal = join(insideArtifactRoot, "probe-recovery.jsonl");
  const journalSentinel = "must-not-be-opened-or-truncated\n";
  await writeFile(actualJournal, journalSentinel, { encoding: "utf8", mode: 0o600 });

  const probeBase = {
    repoRoot,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    approvedProjectRef: STAGING_REF,
    managementToken: "management-token-that-is-long-enough",
    expectedCommit: COMMIT,
  };
  const attempts = [
    [
      "probe receipt",
      () => validateAmoraSuccessorStorageStagingProbeConfig({
        ...probeBase,
        receiptOut: linkedReceipt,
        recoveryJournalOut: join(outsideRoot, "safe-recovery.jsonl"),
      }),
    ],
    [
      "probe recovery journal",
      () => validateAmoraSuccessorStorageStagingProbeConfig({
        ...probeBase,
        receiptOut: join(outsideRoot, "safe-receipt.json"),
        recoveryJournalOut: linkedJournal,
      }),
    ],
    [
      "discovery receipt",
      () => storageProbe.validateAmoraSuccessorStorageDiscoveryConfig({
        ...discoveryConfigInput(),
        repoRoot,
        receiptOut: linkedDiscoveryReceipt,
      }),
    ],
  ];
  const observed = attempts.map(([name, attempt]) => {
    try {
      attempt();
      return { name, code: "accepted" };
    } catch (error) {
      return { name, code: error?.code };
    }
  });

  assert.deepEqual(observed, attempts.map(([name]) => ({
    name,
    code: "RECEIPT_INSIDE_REPOSITORY",
  })));
  await assert.rejects(access(join(insideArtifactRoot, "probe-receipt.json")), {
    code: "ENOENT",
  });
  await assert.rejects(access(join(insideArtifactRoot, "discovery-receipt.json")), {
    code: "ENOENT",
  });
  assert.equal(await readFile(actualJournal, "utf8"), journalSentinel);
});

test("read-only discovery rejects invalid, same, Production, or unapproved targets before fetch", async () => {
  assert.equal(
    typeof storageProbe.validateAmoraSuccessorStorageDiscoveryConfig,
    "function",
    "the discovery config validator must be a public library boundary",
  );
  assert.equal(
    typeof storageProbe.runAmoraSuccessorStorageDiscovery,
    "function",
    "the discovery runner must be a public library boundary",
  );

  const valid = storageProbe.validateAmoraSuccessorStorageDiscoveryConfig(
    discoveryConfigInput(),
  );
  assert.equal(valid.projectRef, STAGING_REF);
  assert.equal(valid.productionProjectRef, PRODUCTION_REF);
  assert.equal(valid.approvedProjectRef, STAGING_REF);

  for (const [name, input, code] of [
    [
      "invalid ref",
      discoveryConfigInput({ projectRef: "evil.example.invalid" }),
      "PROJECT_REF_INVALID",
    ],
    [
      "same ref",
      discoveryConfigInput({ productionProjectRef: STAGING_REF }),
      "PRODUCTION_TARGET_FORBIDDEN",
    ],
    [
      "Production",
      discoveryConfigInput({
        projectRef: PRODUCTION_REF,
        approvedProjectRef: PRODUCTION_REF,
      }),
      "PRODUCTION_TARGET_FORBIDDEN",
    ],
    [
      "approval drift",
      discoveryConfigInput({ approvedProjectRef: "abcdefghijklmnopqrst" }),
      "STAGING_PROJECT_PIN_MISMATCH",
    ],
  ]) {
    let fetchCount = 0;
    await assert.rejects(
      storageProbe.runAmoraSuccessorStorageDiscovery({
        config: input,
        fetchImpl: async () => {
          fetchCount += 1;
          return Response.json([discoveryRow()]);
        },
      }),
      (error) => error instanceof AmoraSuccessorStorageStagingProbeError
        && error.code === code,
      name,
    );
    assert.equal(fetchCount, 0, `${name} must fail before Management fetch`);
  }
});

test("read-only discovery captures arbitrary live bucket, policy, helper, and fence catalog state in one bounded Management request", async () => {
  assert.equal(typeof storageProbe.STORAGE_STAGING_DISCOVERY_SQL, "string");
  assert.equal(
    typeof storageProbe.inspectAmoraSuccessorStorageDiscovery,
    "function",
  );
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /storage\.buckets/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /pg_catalog\.pg_policies/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /file_size_limit/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /allowed_mime_types/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /using_expression_sha256/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /with_check_expression_sha256/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /expression_sha256/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /source_sha256/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /config_sha256/iu);
  assert.match(storageProbe.STORAGE_STAGING_DISCOVERY_SQL, /search_path_empty/iu);

  const config = storageProbe.validateAmoraSuccessorStorageDiscoveryConfig(
    discoveryConfigInput(),
  );
  const requests = [];
  const result = await storageProbe.inspectAmoraSuccessorStorageDiscovery({
    config,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify([discoveryRow()]), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(result, normalizedDiscoveryInventory());
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://api.supabase.com/v1/projects/${STAGING_REF}/database/query/read-only`,
  );
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.redirect, "error");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    query: storageProbe.STORAGE_STAGING_DISCOVERY_SQL,
    parameters: [],
  });

  assert.equal(result.buckets.length, 2, "discovery must not require the 13-bucket candidate");
  assert.equal(result.policies.length, 2, "discovery must not require the 5-policy candidate");
  assert.deepEqual(result.policies[1].roles, ["anon", "authenticated"]);
});

test("policy-expression and helper-source digests preserve disclosure bucket literal case", async () => {
  const pgliteEntry = join(
    import.meta.dirname,
    "..",
    "..",
    "apps",
    "web",
    "node_modules",
    "@electric-sql",
    "pglite",
    "dist",
    "index.js",
  );
  const pgcryptoEntry = join(
    import.meta.dirname,
    "..",
    "..",
    "apps",
    "web",
    "node_modules",
    "@electric-sql",
    "pglite",
    "dist",
    "contrib",
    "pgcrypto.js",
  );
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import(pathToFileURL(pgliteEntry).href),
    import(pathToFileURL(pgcryptoEntry).href),
  ]);
  const db = await PGlite.create({ extensions: { pgcrypto } });
  let row;
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto SCHEMA extensions;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean NOT NULL,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      CREATE TABLE storage.objects (
        id uuid,
        bucket_id text NOT NULL,
        name text NOT NULL
      );
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY canonical_disclosure_literal
        ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
        USING (bucket_id = 'disclosure-raw');
      CREATE POLICY uppercase_disclosure_literal
        ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
        USING (bucket_id = 'DISCLOSURE-RAW');
      CREATE POLICY leading_space_disclosure_literal
        ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
        USING (bucket_id = ' disclosure-raw');
      CREATE FUNCTION public.production_storage_writes_allowed()
      RETURNS boolean LANGUAGE sql STABLE
      AS $function$ SELECT 'disclosure-raw'::text = 'disclosure-raw'::text $function$;
      CREATE FUNCTION public.production_write_fence_guard_20260717()
      RETURNS boolean LANGUAGE sql STABLE
      AS $function$ SELECT 'DISCLOSURE-RAW'::text = 'disclosure-raw'::text $function$;
      CREATE FUNCTION public.production_write_fence_attach_20260717()
      RETURNS boolean LANGUAGE sql STABLE
      AS $function$ SELECT ' disclosure-raw'::text = 'disclosure-raw'::text $function$;
      INSERT INTO storage.buckets
      VALUES ('disclosure-raw', 'disclosure-raw', false, NULL, NULL);
    `);
    const queryResult = await db.query(storageProbe.STORAGE_STAGING_DISCOVERY_SQL);
    assert.equal(queryResult.rows.length, 1);
    [row] = queryResult.rows;
  } finally {
    await db.close();
  }

  const policyHashes = Object.fromEntries(row.policies.map((policy) => [
    policy.name,
    policy.expression_sha256,
  ]));
  const helperHashes = Object.fromEntries(row.helper_functions.map((helper) => [
    helper.name,
    helper.source_sha256,
  ]));
  const sqlSection = (sql, start, end) => {
    const startIndex = sql.indexOf(start);
    const endIndex = sql.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} section`);
    return sql.slice(startIndex, endIndex);
  };
  const inventoryPolicySql = sqlSection(
    STORAGE_STAGING_INVENTORY_SQL,
    "raw_policies AS (",
    "actual_policies AS (",
  );
  const inventoryHelperSql = sqlSection(
    STORAGE_STAGING_INVENTORY_SQL,
    "production_fence_function AS (",
    "production_fence_state AS (",
  );
  const discoveryPolicySql = sqlSection(
    storageProbe.STORAGE_STAGING_DISCOVERY_SQL,
    "policy_rows AS (",
    "policy_catalog AS (",
  );
  const discoveryHelperSql = sqlSection(
    storageProbe.STORAGE_STAGING_DISCOVERY_SQL,
    "helper_rows AS (",
    "helper_catalog AS (",
  );
  const casePreservingHashes = [
    CHAT_POLICY_SHA256,
    DISCLOSURE_POLICY_SHA256,
    DISCLOSURE_INSERT_POLICY_SHA256,
    DISCLOSURE_UPDATE_POLICY_SHA256,
    POLICY_CONTRACT_SHA256,
  ];
  const legacyCaseFoldingHashes = [
    "7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482",
    "15eea7f9945644e3c8c25abe9a975ab56b7a2a27c9704914dd9de969d1f5fbe6",
    "f6282e8c24f17f082bd63f26fd06f1294b87165ebf42722e30ba6ff0c9bf1a6e",
    "267ed8378e382a607170ca40a2a790d87e7b38bce5a47fe9ae026ef71217165b",
    "2d68394af998108f9f35441e53d3ec1dfcde0f5f450e736aa78bd55efae50316",
    "662a2a7d2b14a5ae18aca73dc17f965f2e7629237a6e63554b8853c9ac52aba5",
    "958cbe9d68e5baa04b11208571fb586b2353cea202dddd7fe71b1ddea4958210",
    "a7fbd35ba5c259d24602530b400e20e0d9d944c08989dd9feac63f17d849882e",
    "08d5cb5ed95323bfa223fa422558389ab84e4697a7fa36ef806edba9671a017e",
    "11b996b3232e54a6af6a0631abcefeebae3c0d70f0603208bf4712ca621e27ab",
  ];

  assert.deepEqual({
    uppercasePolicyLiteralHasDifferentHash:
      policyHashes.canonical_disclosure_literal
        !== policyHashes.uppercase_disclosure_literal,
    leadingSpacePolicyLiteralHasDifferentHash:
      policyHashes.canonical_disclosure_literal
        !== policyHashes.leading_space_disclosure_literal,
    uppercaseFunctionLiteralHasDifferentHash:
      helperHashes.production_storage_writes_allowed
        !== helperHashes.production_write_fence_guard_20260717,
    leadingSpaceFunctionLiteralHasDifferentHash:
      helperHashes.production_storage_writes_allowed
        !== helperHashes.production_write_fence_attach_20260717,
    inventoryPolicyLoweringAbsent: !/\blower\s*\(/iu.test(inventoryPolicySql),
    inventoryFunctionLoweringAbsent: !/\blower\s*\(/iu.test(inventoryHelperSql),
    discoveryPolicyLoweringAbsent: !/\blower\s*\(/iu.test(discoveryPolicySql),
    discoveryFunctionLoweringAbsent: !/\blower\s*\(/iu.test(discoveryHelperSql),
    inventoryPolicyWhitespaceStrippingAbsent:
      !/\b(?:pg_catalog\.)?regexp_replace\s*\(/iu.test(inventoryPolicySql),
    inventoryFunctionWhitespaceStrippingAbsent:
      !/\b(?:pg_catalog\.)?regexp_replace\s*\(/iu.test(inventoryHelperSql),
    discoveryPolicyWhitespaceStrippingAbsent:
      !/\b(?:pg_catalog\.)?regexp_replace\s*\(/iu.test(discoveryPolicySql),
    inventoryHasCasePreservingHashes: casePreservingHashes.every(
      (digest) => STORAGE_STAGING_INVENTORY_SQL.includes(digest),
    ),
    inventoryHasCasePreservingFunctionHash:
      STORAGE_STAGING_INVENTORY_SQL.includes(PRODUCTION_STORAGE_FENCE_SOURCE_SHA256),
    legacyCaseFoldingHashesAbsent: legacyCaseFoldingHashes.every(
      (digest) => !STORAGE_STAGING_INVENTORY_SQL.includes(digest),
    ),
  }, {
    uppercasePolicyLiteralHasDifferentHash: true,
    leadingSpacePolicyLiteralHasDifferentHash: true,
    uppercaseFunctionLiteralHasDifferentHash: true,
    leadingSpaceFunctionLiteralHasDifferentHash: true,
    inventoryPolicyLoweringAbsent: true,
    inventoryFunctionLoweringAbsent: true,
    discoveryPolicyLoweringAbsent: true,
    discoveryFunctionLoweringAbsent: true,
    inventoryPolicyWhitespaceStrippingAbsent: true,
    inventoryFunctionWhitespaceStrippingAbsent: true,
    discoveryPolicyWhitespaceStrippingAbsent: true,
    inventoryHasCasePreservingHashes: true,
    inventoryHasCasePreservingFunctionHash: true,
    legacyCaseFoldingHashesAbsent: true,
  });
});

test("read-only discovery enforces a strict single-row, bounded, typed catalog result", async () => {
  const config = storageProbe.validateAmoraSuccessorStorageDiscoveryConfig(
    discoveryConfigInput(),
  );
  const oversizedBucket = {
    id: "bounded-bucket",
    name: "bounded-bucket",
    public: false,
    file_size_limit: null,
    allowed_mime_types: null,
  };
  const oversizedPolicy = {
    name: "bounded_policy",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using_expression_sha256: "1".repeat(64),
    with_check_expression_sha256: "2".repeat(64),
    expression_sha256: "3".repeat(64),
  };
  const oversizedHelper = {
    schema: "public",
    name: "bounded_helper",
    identity_arguments: "",
    owner: "postgres",
    security_definer: false,
    volatility: "STABLE",
    config: [],
    config_sha256: "7".repeat(64),
    search_path_empty: true,
    execute_roles: [],
    source_sha256: "4".repeat(64),
  };
  const cases = [
    ["zero rows", []],
    ["multiple rows", [discoveryRow(), discoveryRow()]],
    ["wrong scalar type", [discoveryRow({ total_object_count: "49" })]],
    [
      "bucket cap",
      [discoveryRow({ buckets: Array.from({ length: 10_001 }, () => oversizedBucket) })],
    ],
    [
      "policy cap",
      [discoveryRow({ policies: Array.from({ length: 10_001 }, () => oversizedPolicy) })],
    ],
    [
      "helper cap",
      [discoveryRow({
        helper_functions: Array.from({ length: 10_001 }, () => oversizedHelper),
      })],
    ],
  ];

  for (const [name, body] of cases) {
    let fetchCount = 0;
    await assert.rejects(
      storageProbe.inspectAmoraSuccessorStorageDiscovery({
        config,
        fetchImpl: async () => {
          fetchCount += 1;
          return new Response(JSON.stringify(body), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        },
      }),
      (error) => error instanceof AmoraSuccessorStorageStagingProbeError
        && error.code.startsWith("STORAGE_DISCOVERY_"),
      name,
    );
    assert.equal(fetchCount, 1, name);
  }
});

test("read-only discovery returns and optionally writes only a secret-free captured_read_only receipt after success", async () => {
  const config = storageProbe.validateAmoraSuccessorStorageDiscoveryConfig(
    discoveryConfigInput(),
  );
  const writes = [];
  let fetchCount = 0;
  const result = await storageProbe.runAmoraSuccessorStorageDiscovery({
    config,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify([discoveryRow()]), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
    writeReceipt: async (receipt) => {
      writes.push(structuredClone(receipt));
    },
    now: () => new Date("2026-08-19T02:00:01.000Z"),
  });

  assert.equal(fetchCount, 1);
  assert.equal(result.status, "captured_read_only");
  assert.deepEqual(result.effects, {
    managementReadOnlyRequests: 1,
    authMutations: 0,
    storageMutations: 0,
    productionMutations: 0,
  });
  assert.deepEqual(result.inventory, normalizedDiscoveryInventory());
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], result);
  const allowedTopLevel = new Set([
    "receiptVersion",
    "kind",
    "status",
    "scope",
    "projectRef",
    "gitCommit",
    "capturedAt",
    "effects",
    "containsSecrets",
    "containsRawExpressions",
    "containsFunctionSource",
    "containsObjectPaths",
    "inventory",
  ]);
  assert.ok(Object.keys(result).every((key) => allowedTopLevel.has(key)));

  const serialized = JSON.stringify({ result, receipt: writes[0] });
  for (const forbidden of [
    discoveryConfigInput().managementToken,
    "row-secret-that-must-not-be-returned",
    "bucket_id = 'must-not-leave-management-boundary'",
    "private predicate must not be returned",
    "BEGIN RETURN secret_value; END",
    "helper-secret-that-must-not-be-returned",
    "private-couple/object-that-must-not-be-returned.png",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }

  let failedWriteCount = 0;
  await assert.rejects(
    storageProbe.runAmoraSuccessorStorageDiscovery({
      config,
      fetchImpl: async () => new Response("[]", { status: 201 }),
      writeReceipt: async () => {
        failedWriteCount += 1;
      },
      now: () => new Date("2026-08-19T02:00:02.000Z"),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code.startsWith("STORAGE_DISCOVERY_"),
  );
  assert.equal(failedWriteCount, 0);
});

test("the inventory-only CLI rejects unsafe targets and mode conflicts before ledger or API-key loading", () => {
  const cli = join(import.meta.dirname, "..", "amora-successor-storage-staging-probe.mjs");
  const baseEnv = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    AMORA_STAGING_PROJECT_REF: PRODUCTION_REF,
    SUPABASE_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
    SUPABASE_ACCESS_TOKEN: "discovery-management-token-that-is-long-enough",
    AMORA_STAGING_STORAGE_DISCOVERY_EXPECTED_COMMIT: COMMIT,
    AMORA_STAGING_STORAGE_PROBE_RECOVER: "0",
  };
  const production = spawnSync(process.execPath, [cli, "--inventory-only"], {
    cwd: join(import.meta.dirname, "..", ".."),
    env: baseEnv,
    encoding: "utf8",
  });
  assert.equal(production.status, 1);
  assert.equal(production.stderr.trim(), "PRODUCTION_TARGET_FORBIDDEN");

  const conflict = spawnSync(process.execPath, [cli, "--inventory-only"], {
    cwd: join(import.meta.dirname, "..", ".."),
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      AMORA_STAGING_STORAGE_PROBE_RECOVER: "1",
    },
    encoding: "utf8",
  });
  assert.equal(conflict.status, 1);
  assert.equal(conflict.stderr.trim(), "DISCOVERY_MODE_CONFLICT");

  const unknown = spawnSync(process.execPath, [cli, "--unknown"], {
    cwd: join(import.meta.dirname, "..", ".."),
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
    },
    encoding: "utf8",
  });
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stderr.trim(), "CLI_ARGUMENT_INVALID");
});

test("hosted mutation and recovery reject Windows before reads or side effects while inventory-only remains available", async () => {
  const config = await probeConfig();
  const events = [];
  const transport = {
    async createSyntheticUser() {
      events.push("createUser");
      return { id: USER_ID, coupleId: COUPLE_ID };
    },
    async deleteExactObject() {
      events.push("deleteObject");
      return { deleted: true, absent: true };
    },
    async recoverSyntheticUser() {
      events.push("recoverUser");
      return { deleted: true };
    },
  };
  const inspectInventory = async () => {
    events.push("inspectInventory");
    return normalizedInventory();
  };

  for (const attempt of [
    () => storageProbe.runAmoraSuccessorStorageStagingProbe({
      config,
      transport,
      inspectInventory,
      runNonce: RUN_NONCE,
      runtimePlatform: "win32",
    }),
    () => storageProbe.recoverAmoraSuccessorStorageStagingProbe({
      config,
      transport,
      inspectInventory,
      runtimePlatform: "win32",
    }),
  ]) {
    await assert.rejects(
      attempt(),
      (error) => error instanceof AmoraSuccessorStorageStagingProbeError
        && error.code === "HOSTED_MUTATION_PLATFORM_UNSUPPORTED",
    );
  }
  assert.deepEqual(events, []);

  const cli = join(import.meta.dirname, "..", "amora-successor-storage-staging-probe.mjs");
  const cliSource = await readFile(cli, "utf8");
  const inventoryBranch = cliSource.indexOf('if (mode === "inventory-only")');
  const mutationPlatformGate = cliSource.indexOf(
    "assertAmoraSuccessorStorageHostedMutationPlatform",
    inventoryBranch + 1,
  );
  const ledgerRead = cliSource.indexOf("readHostedMigrationLedger", mutationPlatformGate);
  assert.ok(inventoryBranch >= 0);
  assert.ok(mutationPlatformGate > inventoryBranch);
  assert.ok(ledgerRead > mutationPlatformGate);

  if (process.platform === "win32") {
    const rejected = spawnSync(process.execPath, [cli], {
      cwd: join(import.meta.dirname, "..", ".."),
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
      },
      encoding: "utf8",
    });
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stderr.trim(), "HOSTED_MUTATION_PLATFORM_UNSUPPORTED");
  }
});

test("the public inventory SQL pins the hosted owner, RLS shape, thirteen cumulative buckets, and the exact five-policy multiset", () => {
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
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /ANY\s*\(\s*\$4::text\[\]\s*\)/iu);
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
    "disclosure-raw",
    "disclosure-preview",
  ]) {
    assert.match(STORAGE_STAGING_INVENTORY_SQL, new RegExp(bucketId, "u"), bucketId);
  }
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /guestbook-images[^\n]+false/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /guestbook-uploads[^\n]+false/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, new RegExp(CHAT_POLICY_SHA256, "u"));
  assert.match(STORAGE_STAGING_INVENTORY_SQL, new RegExp(DISCLOSURE_POLICY_SHA256, "u"));
  assert.match(
    STORAGE_STAGING_INVENTORY_SQL,
    new RegExp(DISCLOSURE_INSERT_POLICY_SHA256, "u"),
  );
  assert.match(STORAGE_STAGING_INVENTORY_SQL, new RegExp(DISCLOSURE_UPDATE_POLICY_SHA256, "u"));
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /disclosure_evidence_client_select_fence/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /disclosure_evidence_client_insert_fence/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /disclosure_evidence_client_update_fence/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /disclosure_evidence_client_delete_fence/iu);
  assert.match(STORAGE_STAGING_INVENTORY_SQL, /EXCEPT ALL/iu);
  assert.doesNotMatch(STORAGE_STAGING_INVENTORY_SQL, /regexp_replace/iu);
  assert.match(
    STORAGE_STAGING_INVENTORY_SQL,
    new RegExp(PRODUCTION_STORAGE_FENCE_SOURCE_SHA256, "u"),
  );
  assert.doesNotMatch(
    STORAGE_STAGING_INVENTORY_SQL,
    /public\.production_storage_writes_allowed\s*\(\s*\)\s+AS production_storage_writes_allowed/iu,
  );
});

test("the production Storage fence helper contract pins the exact SQL scalar signature, execution flags, and ACL multiset", () => {
  const start = STORAGE_STAGING_INVENTORY_SQL.indexOf("production_fence_function AS (");
  const end = STORAGE_STAGING_INVENTORY_SQL.indexOf(
    "production_fence_state AS (",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const helperContractSql = STORAGE_STAGING_INVENTORY_SQL.slice(start, end);
  const exceptAllCount = helperContractSql.match(/\bEXCEPT\s+ALL\b/giu)?.length ?? 0;

  assert.deepEqual({
    languageCatalogInspected: /pg_catalog\.pg_language/iu.test(helperContractSql),
    sqlLanguageRequired:
      /lanname\s*=\s*'sql'|'sql'\s*=\s*[a-zA-Z0-9_.]*lanname/iu.test(
        helperContractSql,
      ),
    booleanReturnRequired:
      /prorettype\s*=\s*'pg_catalog\.bool'\s*::\s*(?:pg_catalog\.)?regtype/iu.test(
        helperContractSql,
      ),
    setReturningForbidden: /NOT\s+function_record\.proretset/iu.test(
      helperContractSql,
    ),
    zeroArgumentsRequired: /pronargs\s*=\s*0/iu.test(helperContractSql),
    emptyArgumentVectorRequired:
      /proargtypes\s*=\s*''\s*::\s*(?:pg_catalog\.)?oidvector/iu.test(
        helperContractSql,
      ),
    parallelUnsafeRequired: /proparallel\s*=\s*'u'/iu.test(helperContractSql),
    leakproofForbidden: /NOT\s+function_record\.proleakproof/iu.test(
      helperContractSql,
    ),
    strictForbidden: /NOT\s+function_record\.proisstrict/iu.test(
      helperContractSql,
    ),
    executeAclCatalogInspected:
      /pg_catalog\.aclexplode/iu.test(helperContractSql),
    aclGrantabilityInspected: /acl_entry\.is_grantable/iu.test(
      helperContractSql,
    ),
    postgresOwnerExecuteNonGrantableExpected:
      /\('postgres'::text,\s*'postgres'::text,\s*'EXECUTE'::text,\s*false\)/iu.test(
        helperContractSql,
      ),
    authenticatedExecuteNonGrantableExpected:
      /\('postgres'::text,\s*'authenticated'::text,\s*'EXECUTE'::text,\s*false\)/iu.test(
        helperContractSql,
      ),
    exactAclComparedInBothDirections: exceptAllCount === 2,
  }, {
    languageCatalogInspected: true,
    sqlLanguageRequired: true,
    booleanReturnRequired: true,
    setReturningForbidden: true,
    zeroArgumentsRequired: true,
    emptyArgumentVectorRequired: true,
    parallelUnsafeRequired: true,
    leakproofForbidden: true,
    strictForbidden: true,
    executeAclCatalogInspected: true,
    aclGrantabilityInspected: true,
    postgresOwnerExecuteNonGrantableExpected: true,
    authenticatedExecuteNonGrantableExpected: true,
    exactAclComparedInBothDirections: true,
  });
});

test("the migration-backed helper passes exactly and language, return, or extra EXECUTE ACL drift fails closed", async () => {
  const pgliteEntry = join(
    import.meta.dirname,
    "..",
    "..",
    "apps",
    "web",
    "node_modules",
    "@electric-sql",
    "pglite",
    "dist",
    "index.js",
  );
  const pgcryptoEntry = join(
    import.meta.dirname,
    "..",
    "..",
    "apps",
    "web",
    "node_modules",
    "@electric-sql",
    "pglite",
    "dist",
    "contrib",
    "pgcrypto.js",
  );
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import(pathToFileURL(pgliteEntry).href),
    import(pathToFileURL(pgcryptoEntry).href),
  ]);
  const migrationSql = (await readFile(join(
    import.meta.dirname,
    "..",
    "..",
    "supabase",
    "migrations",
    "20260716113000_account_deletion_storage_saga.sql",
  ), "utf8")).replaceAll("\r\n", "\n");
  const functionDeclaration =
    "CREATE OR REPLACE FUNCTION public.production_storage_writes_allowed()";
  const bodyMarker = "$production_storage_write_fence$";
  const declarationStart = migrationSql.indexOf(functionDeclaration);
  const bodyStart = migrationSql.indexOf(bodyMarker, declarationStart);
  const bodyEnd = migrationSql.indexOf(bodyMarker, bodyStart + bodyMarker.length);
  assert.ok(declarationStart >= 0 && bodyStart > declarationStart && bodyEnd > bodyStart);
  const canonicalFunctionSource = migrationSql.slice(
    bodyStart + bodyMarker.length,
    bodyEnd,
  );
  assert.equal(
    createHash("sha256").update(canonicalFunctionSource).digest("hex"),
    PRODUCTION_STORAGE_FENCE_SOURCE_SHA256,
  );

  const start = STORAGE_STAGING_INVENTORY_SQL.indexOf("production_fence_function AS (");
  const end = STORAGE_STAGING_INVENTORY_SQL.indexOf(
    "production_fence_state AS (",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const helperCte = STORAGE_STAGING_INVENTORY_SQL
    .slice(start, end)
    .trim()
    .replace(/,$/u, "");
  const helperQuery = `WITH ${helperCte}
SELECT production_storage_fence_function_verified
FROM production_fence_function`;
  const helperQueryForSource = (sourceDigest) => `WITH ${helperCte.replace(
    PRODUCTION_STORAGE_FENCE_SOURCE_SHA256,
    sourceDigest,
  )}
SELECT production_storage_fence_function_verified
FROM production_fence_function`;
  const db = await PGlite.create({ extensions: { pgcrypto } });

  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE ROLE extra_storage_executor NOLOGIN;
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto SCHEMA extensions;
      CREATE FUNCTION public.production_storage_writes_allowed()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = ''
      AS $canonical_storage_fence$${canonicalFunctionSource}$canonical_storage_fence$;
      REVOKE ALL ON FUNCTION public.production_storage_writes_allowed()
        FROM PUBLIC, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.production_storage_writes_allowed()
        TO authenticated;
    `);

    const exactAcl = await db.query(helperQuery);
    assert.equal(
      exactAcl.rows[0].production_storage_fence_function_verified,
      true,
      "the canonical owner + authenticated ACL must satisfy the helper contract",
    );

    await db.exec(`
      GRANT EXECUTE ON FUNCTION public.production_storage_writes_allowed()
        TO extra_storage_executor;
    `);
    const extraAcl = await db.query(helperQuery);
    assert.equal(
      extraAcl.rows[0].production_storage_fence_function_verified,
      false,
      "an unallowlisted EXECUTE grantee must fail closed",
    );

    await db.exec(`
      REVOKE EXECUTE ON FUNCTION public.production_storage_writes_allowed()
        FROM extra_storage_executor;
      CREATE OR REPLACE FUNCTION public.production_storage_writes_allowed()
      RETURNS boolean
      LANGUAGE plpgsql
      STABLE
      SECURITY DEFINER
      SET search_path = ''
      AS $language_drift$
      BEGIN
        RETURN true;
      END
      $language_drift$;
    `);
    const languageDriftDigest = await db.query(`
      SELECT pg_catalog.encode(extensions.digest(prosrc, 'sha256'), 'hex') AS digest
      FROM pg_catalog.pg_proc
      WHERE oid = pg_catalog.to_regprocedure('public.production_storage_writes_allowed()')
    `);
    const languageDrift = await db.query(
      helperQueryForSource(languageDriftDigest.rows[0].digest),
    );
    assert.equal(
      languageDrift.rows[0].production_storage_fence_function_verified,
      false,
      "a PL/pgSQL replacement with every source hash expectation aligned must fail closed",
    );

    await db.exec(`
      DROP FUNCTION public.production_storage_writes_allowed();
      CREATE FUNCTION public.production_storage_writes_allowed()
      RETURNS integer
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = ''
      AS $return_drift$ SELECT 1 $return_drift$;
      REVOKE ALL ON FUNCTION public.production_storage_writes_allowed()
        FROM PUBLIC, anon, authenticated, service_role, extra_storage_executor;
      GRANT EXECUTE ON FUNCTION public.production_storage_writes_allowed()
        TO authenticated;
    `);
    const returnDriftDigest = await db.query(`
      SELECT pg_catalog.encode(extensions.digest(prosrc, 'sha256'), 'hex') AS digest
      FROM pg_catalog.pg_proc
      WHERE oid = pg_catalog.to_regprocedure('public.production_storage_writes_allowed()')
    `);
    const returnDrift = await db.query(
      helperQueryForSource(returnDriftDigest.rows[0].digest),
    );
    assert.equal(
      returnDrift.rows[0].production_storage_fence_function_verified,
      false,
      "a non-boolean replacement with every source hash expectation aligned must fail closed",
    );
  } finally {
    await db.close();
  }
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
    parameters: [RUN_NONCE, null, null, []],
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
  assert.equal(exactRequests.length, 1);
  assert.equal(exactRequests[0].query, STORAGE_STAGING_INVENTORY_SQL);
  assert.deepEqual(exactRequests[0].parameters.slice(0, 3), [
    RUN_NONCE,
    USER_ID,
    COUPLE_ID,
  ]);
  const exactObjectTargets = exactRequests[0].parameters[3];
  assert.equal(exactObjectTargets.length, 13);
  assert.ok(exactObjectTargets.every((value) => typeof value === "string" && value.includes("\n")));
  assert.ok(exactObjectTargets.some((value) => value.startsWith(
    `chat-image\ne0000000-0000-4000-8000-000000000001/${USER_ID}/`,
  )));
  assert.ok(exactObjectTargets.some((value) => value.startsWith(
    `chat-image\n${COUPLE_ID}/f0000000-0000-4000-8000-000000000001/`,
  )));

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
    ["storage_policy_count", 4],
    ["storage_insert_policy_count", 1],
    ["storage_policy_contract_verified", false],
    ["storage_policy_contract_sha256", "e".repeat(64)],
    ["production_storage_fence_function_verified", false],
    ["production_storage_writes_allowed", false],
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

test("the hosted transport never reports a 5xx outage as an RLS or path denial", async () => {
  const ownObjectPath = `${COUPLE_ID}/${USER_ID}/10000000-0000-4000-8000-000000000201.png`;
  let chatRequestCount = 0;
  const chatTransport = createSupabaseStorageStagingTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async () => {
      chatRequestCount += 1;
      if (chatRequestCount === 1) {
        return new Response(JSON.stringify({ path: ownObjectPath }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "temporary server failure" }), { status: 500 });
    },
  });
  const user = {
    id: USER_ID,
    coupleId: COUPLE_ID,
    accessToken: "synthetic-auth-token-value",
  };
  const chat = await chatTransport.verifyChatBoundary({
    user,
    bucketId: "chat-image",
    ownObjectPath,
    anonObjectPath: `${COUPLE_ID}/${USER_ID}/10000000-0000-4000-8000-000000000202.png`,
    wrongCoupleObjectPath:
      `e0000000-0000-4000-8000-000000000001/${USER_ID}/10000000-0000-4000-8000-000000000203.png`,
    wrongUploaderObjectPath:
      `${COUPLE_ID}/f0000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000204.png`,
    malformedObjectPath:
      `${COUPLE_ID}/${USER_ID}/extra/10000000-0000-4000-8000-000000000205.png`,
  });
  assert.equal(chat.ownInsertSucceeded, true);
  for (const field of [
    "anonInsertDenied",
    "wrongCoupleDenied",
    "wrongUploaderDenied",
    "malformedPathDenied",
    "readDenied",
    "updateDenied",
    "deleteDenied",
  ]) {
    assert.equal(chat[field], false, field);
  }

  const outageTransport = createSupabaseStorageStagingTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async () => new Response(
      JSON.stringify({ error: "temporary server failure" }),
      { status: 503 },
    ),
  });
  const signedObjectPath = `${USER_ID}/${RUN_NONCE}-signed.png`;
  const differentSigned = await outageTransport.attemptSignedUploadAtDifferentPath({
    signedUpload: {
      bucketId: "community-media-staging",
      objectPath: signedObjectPath,
      token: "signed-token-value",
    },
    objectPath: signedObjectPath,
    differentObjectPath: `${USER_ID}/${RUN_NONCE}-signed-different.png`,
  });
  assert.equal(differentSigned.denied, false);
  const unsigned = await outageTransport.attemptUnsignedMutation({
    actor: "authenticated",
    user,
    bucketId: "community-images",
    objectPath: `${USER_ID}/${RUN_NONCE}-unsigned.png`,
  });
  assert.equal(unsigned.denied, false);
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

test("the hosted transport recovers only the exact journal user after revalidating its deterministic identity", async () => {
  const requests = [];
  const identityLabel = `amora-storage-${RUN_NONCE}`;
  const email = `${identityLabel}-abcdef123456@hanbang-test.invalid`;
  const transport = createSupabaseStorageStagingTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path: `${parsed.pathname}${parsed.search}`, method: init.method, body });
      if (parsed.pathname === `/auth/v1/admin/users/${USER_ID}` && init.method === "GET") {
        return Response.json({
          id: USER_ID,
          email,
          user_metadata: { name: identityLabel },
        });
      }
      if (parsed.pathname === `/auth/v1/admin/users/${USER_ID}` && init.method === "PUT") {
        assert.equal(typeof body.password, "string");
        assert.ok(body.password.length >= 24);
        return Response.json({ id: USER_ID });
      }
      if (parsed.pathname === "/auth/v1/token" && init.method === "POST") {
        assert.equal(body.email, email);
        assert.equal(typeof body.password, "string");
        return Response.json({
          access_token: "ephemeral-recovery-session-token",
          user: { id: USER_ID },
        });
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

  const result = await transport.recoverSyntheticUser({
    userId: USER_ID,
    coupleId: COUPLE_ID,
    identityLabel,
  });

  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`), [
    `GET /auth/v1/admin/users/${USER_ID}`,
    `PUT /auth/v1/admin/users/${USER_ID}`,
    "POST /auth/v1/token?grant_type=password",
    "POST /rest/v1/rpc/reset_current_couple_membership",
    `DELETE /auth/v1/admin/users/${USER_ID}`,
  ]);
});

test("the hosted transport discovers at most one exact deterministic recovery identity with bounded reads", async () => {
  const requests = [];
  const identityLabel = `amora-storage-${RUN_NONCE}`;
  const transport = createSupabaseStorageStagingTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      requests.push({ parsed, init });
      if (parsed.pathname === "/auth/v1/admin/users") {
        assert.equal(parsed.searchParams.get("page"), "1");
        assert.equal(parsed.searchParams.get("per_page"), "1000");
        return Response.json({
          users: [
            {
              id: USER_ID,
              email: `${identityLabel}-abcdef123456@hanbang-test.invalid`,
              user_metadata: { name: identityLabel },
            },
            {
              id: "30000000-0000-4000-8000-000000000101",
              email: "unrelated@hanbang-test.invalid",
              user_metadata: { name: "unrelated" },
            },
          ],
        });
      }
      if (parsed.pathname === "/rest/v1/profiles") {
        assert.equal(parsed.searchParams.get("select"), "id,couple_id");
        assert.equal(parsed.searchParams.get("id"), `eq.${USER_ID}`);
        assert.equal(parsed.searchParams.get("limit"), "2");
        return Response.json([{ id: USER_ID, couple_id: COUPLE_ID }]);
      }
      return Response.json({ error: "unexpected_request" }, { status: 500 });
    },
  });

  const result = await transport.discoverSyntheticRecoveryTarget({ identityLabel });

  assert.deepEqual(result, { userId: USER_ID, coupleId: COUPLE_ID });
  assert.deepEqual(requests.map(({ init }) => init.method), ["GET", "GET"]);
});

test("recovery discovery retains an exact pre-couple synthetic user instead of losing the first mutation window", async () => {
  const identityLabel = `amora-storage-${RUN_NONCE}`;
  const transport = createSupabaseStorageStagingTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/auth/v1/admin/users") {
        return Response.json({ users: [{
          id: USER_ID,
          email: `${identityLabel}-abcdef123456@hanbang-test.invalid`,
          user_metadata: { name: identityLabel },
        }] });
      }
      if (parsed.pathname === "/rest/v1/profiles") {
        return Response.json([{ id: USER_ID, couple_id: null }]);
      }
      return Response.json({ error: "unexpected_request" }, { status: 500 });
    },
  });

  assert.deepEqual(
    await transport.discoverSyntheticRecoveryTarget({ identityLabel }),
    { userId: USER_ID, coupleId: null },
  );
});

test("an operational staging run proves exact signed upload, cumulative RLS boundaries, canonical chat upload, and zero-residue cleanup without claiming Production or drain", async () => {
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
    chatOwnInsertSucceeded: true,
    chatAnonInsertDenied: true,
    chatWrongCoupleDenied: true,
    chatWrongUploaderDenied: true,
    chatMalformedPathDenied: true,
    chatReadDenied: true,
    chatUpdateDenied: true,
    chatDeleteDenied: true,
    productionStorageOperationalState: true,
    exactObjectCleanup: true,
    finalContractStable: true,
    exactNonceResidueZero: true,
  });
  assert.deepEqual(inventoryPhases, ["baseline", "final"]);
  assert.equal(result.inventory.bucketContractSha256, BUCKET_SHA256);
  assert.equal(result.inventory.storagePolicyContractSha256, POLICY_CONTRACT_SHA256);
  assert.equal(result.productionVerified, false);
  assert.equal(result.productionMutations, 0);
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
  assert.ok(exactCandidates.size >= 12);
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
  assert.equal(persisted.productionVerified, false);
  assert.equal(persisted.productionMutations, 0);
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

test("an exclusive 0600 recovery journal exists before the first mutation and is removed only after exact zero residue", async () => {
  const config = await probeConfig();
  const events = [];
  const transport = happyTransport(events);
  const createSyntheticUser = transport.createSyntheticUser;
  transport.createSyntheticUser = async (...args) => {
    const journalText = await readFile(config.recoveryJournalOut, "utf8");
    const journal = JSON.parse(journalText.trim().split("\n").at(-1));
    assert.equal(journal.status, "incomplete");
    assert.equal(journal.projectRef, STAGING_REF);
    assert.equal(journal.gitCommit, COMMIT);
    assert.equal(journal.runNonce, RUN_NONCE);
    assert.match(journal.identityMarker, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(journal).includes("token"), false);
    assert.equal(JSON.stringify(journal).includes("password"), false);
    assert.equal(JSON.stringify(journal).includes("signedUrl"), false);
    if (process.platform !== "win32") {
      assert.equal((await stat(config.recoveryJournalOut)).mode & 0o777, 0o600);
    }
    return createSyntheticUser(...args);
  };

  await runAmoraSuccessorStorageStagingProbe({
    config,
    runNonce: RUN_NONCE,
    transport,
    inspectInventory: async () => normalizedInventory(),
    now: () => new Date("2026-08-19T01:00:02.000Z"),
  });

  await assert.rejects(access(config.recoveryJournalOut), { code: "ENOENT" });
});

test("an existing receipt blocks a new run before hosted reads or mutations but does not block recovery", async () => {
  const config = await probeConfig();
  const sentinel = "existing-receipt-must-remain-byte-identical\n";
  await writeFile(config.receiptOut, sentinel, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const events = [];
  let hostedReadCount = 0;
  const error = await runAmoraSuccessorStorageStagingProbe({
    config,
    runNonce: RUN_NONCE,
    transport: happyTransport(events),
    inspectInventory: async () => {
      hostedReadCount += 1;
      return normalizedInventory();
    },
    now: () => new Date("2026-08-19T03:20:00.000Z"),
  }).then(() => null, (caught) => caught);

  const recoveryConfig = await probeConfig();
  await writeFile(recoveryConfig.receiptOut, sentinel, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const recoveryRecord = initialRecoveryJournalRecord(
    recoveryConfig,
    RUN_NONCE,
    "2026-08-19T03:21:00.000Z",
  );
  await writeFile(
    recoveryConfig.recoveryJournalOut,
    `${JSON.stringify(recoveryRecord)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  const recoveryEvents = [];
  const recovery = await recoverAmoraSuccessorStorageStagingProbe({
    config: recoveryConfig,
    transport: {
      async discoverSyntheticRecoveryTarget() {
        recoveryEvents.push("discover");
        return { absent: true };
      },
      async deleteExactObject() {
        recoveryEvents.push("deleteObject");
        return { deleted: true, absent: true };
      },
      async recoverSyntheticUser() {
        recoveryEvents.push("recoverUser");
        return { deleted: true };
      },
    },
    inspectInventory: async () => {
      recoveryEvents.push("inspectInventory");
      return normalizedInventory();
    },
  });

  assert.deepEqual({
    receiptConflictRejected: ["RECEIPT_WRITE_FAILED", "RECEIPT_EXISTS"]
      .includes(error?.code),
    hostedReadCount,
    hostedMutationEvents: events,
    sentinelAfterNewRun: await readFile(config.receiptOut, "utf8"),
    recoveryStatus: recovery.status,
    recoveryEvents,
    sentinelAfterRecovery: await readFile(recoveryConfig.receiptOut, "utf8"),
  }, {
    receiptConflictRejected: true,
    hostedReadCount: 0,
    hostedMutationEvents: [],
    sentinelAfterNewRun: sentinel,
    recoveryStatus: "recovery_verified",
    recoveryEvents: ["discover", "inspectInventory"],
    sentinelAfterRecovery: sentinel,
  });
});

test("a deleted initial journal cannot be recreated as a full-only chain or advance to signed upload", async () => {
  const config = await probeConfig();
  const events = [];
  const scenarioMutationsAfterCreateUser = [];
  const transport = happyTransport(events);
  const createSyntheticUser = transport.createSyntheticUser;
  transport.createSyntheticUser = async (...args) => {
    const initialText = await readFile(config.recoveryJournalOut, "utf8");
    const initial = JSON.parse(initialText.trim());
    assert.equal(initial.userId, null);
    assert.equal(initial.coupleId, null);
    assert.deepEqual(initial.candidates, []);
    const user = await createSyntheticUser(...args);
    await unlink(config.recoveryJournalOut);
    return user;
  };
  transport.createSignedUpload = async () => {
    scenarioMutationsAfterCreateUser.push("createSignedUpload");
    throw new Error("signed upload must not follow a lost recovery chain");
  };

  const error = await runAmoraSuccessorStorageStagingProbe({
    config,
    runNonce: RUN_NONCE,
    transport,
    inspectInventory: async () => normalizedInventory(),
    now: () => new Date("2026-08-19T03:10:00.000Z"),
  }).then(() => null, (caught) => caught);
  let journalState;
  try {
    const text = await readFile(config.recoveryJournalOut, "utf8");
    const records = text.trimEnd().split("\n").map((record) => JSON.parse(record));
    journalState = {
      exists: true,
      recordCount: records.length,
      firstUserId: records[0]?.userId,
    };
  } catch (caught) {
    journalState = {
      exists: false,
      errorCode: caught?.code,
    };
  }

  assert.deepEqual({
    errorCode: error?.code,
    createUserCount: events.filter((event) => event.startsWith("createUser:")).length,
    scenarioMutationsAfterCreateUser,
    journalState,
  }, {
    errorCode: "RECOVERY_JOURNAL_WRITE_FAILED",
    createUserCount: 1,
    scenarioMutationsAfterCreateUser: [],
    journalState: {
      exists: false,
      errorCode: "ENOENT",
    },
  });
});

test("append validates the initial journal chain before replacing it with a different valid run", async () => {
  const config = await probeConfig();
  const events = [];
  const scenarioMutationsAfterCreateUser = [];
  const replacement = initialRecoveryJournalRecord(
    config,
    "abcdef0123456789abcdef0123456789",
    "2026-08-19T03:11:00.000Z",
  );
  const replacementText = `${JSON.stringify(replacement)}\n`;
  const transport = happyTransport(events);
  const createSyntheticUser = transport.createSyntheticUser;
  transport.createSyntheticUser = async (...args) => {
    const user = await createSyntheticUser(...args);
    await writeFile(config.recoveryJournalOut, replacementText, {
      encoding: "utf8",
      mode: 0o600,
    });
    return user;
  };
  transport.createSignedUpload = async () => {
    scenarioMutationsAfterCreateUser.push("createSignedUpload");
    throw new Error("signed upload must not follow a replaced recovery chain");
  };

  const error = await runAmoraSuccessorStorageStagingProbe({
    config,
    runNonce: RUN_NONCE,
    transport,
    inspectInventory: async () => normalizedInventory(),
    now: () => new Date("2026-08-19T03:10:00.000Z"),
  }).then(() => null, (caught) => caught);
  const journalAfter = await readFile(config.recoveryJournalOut, "utf8");

  assert.deepEqual({
    errorCode: error?.code,
    createUserCount: events.filter((event) => event.startsWith("createUser:")).length,
    scenarioMutationsAfterCreateUser,
    journalAfter,
  }, {
    errorCode: "RECOVERY_JOURNAL_INVALID",
    createUserCount: 1,
    scenarioMutationsAfterCreateUser: [],
    journalAfter: replacementText,
  });
});

test("journal and receipt durability fsyncs POSIX parent directories in lifecycle order while Windows mutations are separately blocked", async () => {
  const libraryPath = join(
    import.meta.dirname,
    "..",
    "lib",
    "amora-successor-storage-staging-probe.mjs",
  );
  const source = await readFile(libraryPath, "utf8");
  const section = (start, end) => {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} source section`);
    return source.slice(startIndex, endIndex);
  };
  const helperMatch = source.match(
    /async function ((?:f?sync|sync)ParentDirectory)\s*\(/u,
  );
  const helperName = helperMatch?.[1] ?? "missingParentDirectorySyncHelper";
  const helperSource = helperMatch
    ? source.slice(helperMatch.index, helperMatch.index + 1_500)
    : "";
  const createJournalSource = section(
    "async function createRecoveryJournal",
    "async function appendRecoveryJournal",
  );
  const persistReceiptSource = section(
    "async function persistReceipt",
    "function recoveryIdentityMarker",
  );
  const removeJournalSource = section(
    "async function removeRecoveryJournal",
    "function assertRecoveryJournalValueSafe",
  );
  const runProbeSource = section(
    "export async function runAmoraSuccessorStorageStagingProbe",
    "export function storageProbeReceiptSha256",
  );
  const callPattern = (argument) => new RegExp(
    `await\\s+${helperName}\\s*\\(\\s*${argument}\\s*\\)`,
    "u",
  );
  const createParentSyncIndex = createJournalSource.search(
    callPattern("recoveryJournalOut"),
  );
  const persistParentSyncIndex = persistReceiptSource.search(
    callPattern("receiptOut"),
  );
  const removeParentSyncIndex = removeJournalSource.search(
    callPattern("recoveryJournalOut"),
  );

  assert.deepEqual({
    parentDirectorySyncHelperDeclared: helperMatch !== null,
    windowsBypassDeclared:
      /process\.platform/iu.test(helperSource) && /win32/iu.test(helperSource),
    posixDirectoryOpenedReadOnly:
      /await\s+open\s*\([^)]*(?:["']r["']|O_RDONLY)/iu.test(helperSource),
    directoryHandleSynced: /await\s+[a-zA-Z_$][\w$]*\.sync\s*\(\s*\)/u.test(
      helperSource,
    ),
    directoryHandleClosed: /await\s+[a-zA-Z_$][\w$]*\??\.close\s*\(\s*\)/u.test(
      helperSource,
    ),
    journalParentSyncedAfterJournalFileSync:
      createParentSyncIndex > createJournalSource.indexOf("await handle.sync()"),
    journalCreateCompletesBeforeFirstRemoteMutation:
      runProbeSource.indexOf("await createRecoveryJournal")
        < runProbeSource.indexOf("await transport.createSyntheticUser"),
    receiptParentSyncedAfterReceiptFileSync:
      persistParentSyncIndex > persistReceiptSource.indexOf("await handle.sync()"),
    receiptPersistsBeforeJournalUnlink:
      runProbeSource.lastIndexOf("await persistReceipt")
        < runProbeSource.lastIndexOf("await removeRecoveryJournal"),
    journalParentSyncedAfterUnlink:
      removeParentSyncIndex > removeJournalSource.indexOf("await unlink"),
  }, {
    parentDirectorySyncHelperDeclared: true,
    windowsBypassDeclared: true,
    posixDirectoryOpenedReadOnly: true,
    directoryHandleSynced: true,
    directoryHandleClosed: true,
    journalParentSyncedAfterJournalFileSync: true,
    journalCreateCompletesBeforeFirstRemoteMutation: true,
    receiptParentSyncedAfterReceiptFileSync: true,
    receiptPersistsBeforeJournalUnlink: true,
    journalParentSyncedAfterUnlink: true,
  });
});

test("an existing incomplete recovery journal blocks a new run before any mutation", async () => {
  const config = await probeConfig();
  await writeFile(config.recoveryJournalOut, "incomplete\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const events = [];

  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport(events),
      inspectInventory: async () => normalizedInventory(),
      now: () => new Date("2026-08-19T01:00:02.000Z"),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "RECOVERY_JOURNAL_EXISTS",
  );

  assert.deepEqual(events, []);
  assert.equal(await readFile(config.recoveryJournalOut, "utf8"), "incomplete\n");
});

test("a failed run keeps a bounded secret-free journal with exact recovery IDs and candidate paths", async () => {
  const config = await probeConfig();
  const events = [];

  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport(events, { differentPathDenied: false }),
      inspectInventory: async () => normalizedInventory(),
      now: () => new Date("2026-08-19T01:00:02.000Z"),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "SIGNED_UPLOAD_PATH_REUSE_ALLOWED",
  );

  const journalText = await readFile(config.recoveryJournalOut, "utf8");
  assert.ok(Buffer.byteLength(journalText, "utf8") < 64 * 1024);
  const journal = JSON.parse(journalText.trim().split("\n").at(-1));
  assert.equal(journal.status, "incomplete");
  assert.equal(journal.userId, USER_ID);
  assert.equal(journal.coupleId, COUPLE_ID);
  assert.ok(journal.candidates.length >= 12);
  assert.ok(journal.candidates.every(({ bucketId, objectPath }) =>
    typeof bucketId === "string" && typeof objectPath === "string"));
  for (const forbidden of [
    "accessToken",
    "password",
    "signedUrl",
    "signed-upload-token-that-must-not-enter-the-receipt",
    "?token=secret",
  ]) {
    assert.equal(journalText.includes(forbidden), false, forbidden);
  }
});

test("explicit recovery is bounded to journal targets and removes the journal only after exact zero residue", async () => {
  const config = await probeConfig();
  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport([], { differentPathDenied: false }),
      inspectInventory: async () => normalizedInventory(),
      now: () => new Date("2026-08-19T01:00:02.000Z"),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "SIGNED_UPLOAD_PATH_REUSE_ALLOWED",
  );
  const journalText = await readFile(config.recoveryJournalOut, "utf8");
  const journal = JSON.parse(journalText.trim().split("\n").at(-1));
  const exactTargets = new Set(journal.candidates.map(
    ({ bucketId, objectPath }) => `${bucketId}:${objectPath}`,
  ));
  const recoveryEvents = [];

  const result = await recoverAmoraSuccessorStorageStagingProbe({
    config,
    transport: happyTransport(recoveryEvents),
    inspectInventory: async ({ phase, runNonce, userId, coupleId }) => {
      assert.equal(phase, "recovery-final");
      assert.equal(runNonce, RUN_NONCE);
      assert.equal(userId, USER_ID);
      assert.equal(coupleId, COUPLE_ID);
      return normalizedInventory();
    },
    now: () => new Date("2026-08-19T01:00:03.000Z"),
  });

  assert.equal(result.status, "recovery_verified");
  assert.equal(result.identityMarker, journal.identityMarker);
  assert.equal(result.productionMutations, 0);
  assert.deepEqual(
    new Set(recoveryEvents
      .filter((event) => event.startsWith("cleanup:"))
      .map((event) => event.slice("cleanup:".length))),
    exactTargets,
  );
  assert.equal(recoveryEvents.filter((event) => event === "recoverUser").length, 1);
  assert.equal(recoveryEvents.some((event) => event.startsWith("createUser:")), false);
  await assert.rejects(access(config.recoveryJournalOut), { code: "ENOENT" });
});

test("explicit recovery resolves the deterministic identity after interruption in the first mutation window", async () => {
  const config = await probeConfig();
  const interruptedEvents = [];
  const interruptedTransport = happyTransport(interruptedEvents);
  interruptedTransport.createSyntheticUser = async (label) => {
    assert.equal(label, `amora-storage-${RUN_NONCE}`);
    interruptedEvents.push("createUserInterrupted");
    throw new Error("process interrupted after remote create");
  };
  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: interruptedTransport,
      inspectInventory: async () => normalizedInventory(),
      now: () => new Date("2026-08-19T01:00:02.000Z"),
    }),
    /process interrupted/iu,
  );
  const initial = JSON.parse((await readFile(config.recoveryJournalOut, "utf8")).trim());
  assert.equal(initial.userId, null);
  assert.equal(initial.coupleId, null);
  assert.deepEqual(initial.candidates, []);

  const recoveryEvents = [];
  const recoveryTransport = happyTransport(recoveryEvents);
  recoveryTransport.discoverSyntheticRecoveryTarget = async ({ identityLabel }) => {
    assert.equal(identityLabel, `amora-storage-${RUN_NONCE}`);
    recoveryEvents.push("discoverUser");
    return { userId: USER_ID, coupleId: COUPLE_ID };
  };
  const result = await recoverAmoraSuccessorStorageStagingProbe({
    config,
    transport: recoveryTransport,
    inspectInventory: async ({ userId, coupleId }) => {
      assert.equal(userId, USER_ID);
      assert.equal(coupleId, COUPLE_ID);
      return normalizedInventory();
    },
  });

  assert.equal(result.status, "recovery_verified");
  assert.ok(recoveryEvents.includes("discoverUser"));
  assert.ok(recoveryEvents.includes("recoverUser"));
  assert.ok(recoveryEvents.filter((event) => event.startsWith("cleanup:")).length >= 12);
  await assert.rejects(access(config.recoveryJournalOut), { code: "ENOENT" });
});

test("explicit recovery rejects an allowed-bucket journal path that is not exactly derived from the pinned run", async () => {
  const config = await probeConfig();
  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport([], { differentPathDenied: false }),
      inspectInventory: async () => normalizedInventory(),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "SIGNED_UPLOAD_PATH_REUSE_ALLOWED",
  );
  const journalText = await readFile(config.recoveryJournalOut, "utf8");
  const latest = JSON.parse(journalText.trimEnd().split("\n").at(-1));
  const tampered = {
    ...latest,
    candidates: latest.candidates.map((candidate, index) => index === 0
      ? {
        ...candidate,
        objectPath: `${USER_ID}/${RUN_NONCE}-not-an-exact-probe-path.png`,
      }
      : candidate),
  };
  await writeFile(
    config.recoveryJournalOut,
    `${JSON.stringify(tampered)}\n`,
    { encoding: "utf8", flag: "a" },
  );
  const events = [];
  await assert.rejects(
    recoverAmoraSuccessorStorageStagingProbe({
      config,
      transport: happyTransport(events),
      inspectInventory: async () => normalizedInventory(),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "RECOVERY_JOURNAL_INVALID",
  );
  assert.equal(events.some((event) => event.startsWith("cleanup:")), false);
});

test("recovery rejects a JSONL journal that mixes two individually valid runs before discovery or cleanup", async () => {
  const firstConfig = await probeConfig();
  const secondRunNonce = "fedcba9876543210fedcba9876543210";
  const firstRecord = initialRecoveryJournalRecord(
    firstConfig,
    RUN_NONCE,
    "2026-08-19T03:00:00.000Z",
  );
  const secondRecord = initialRecoveryJournalRecord(
    firstConfig,
    secondRunNonce,
    "2026-08-19T03:01:00.000Z",
  );
  assert.notEqual(firstRecord.runNonce, secondRecord.runNonce);
  assert.notEqual(firstRecord.startedAt, secondRecord.startedAt);
  assert.notEqual(firstRecord.identityMarker, secondRecord.identityMarker);
  const mixedJournal = `${JSON.stringify(firstRecord)}\n${JSON.stringify(secondRecord)}\n`;
  await writeFile(firstConfig.recoveryJournalOut, mixedJournal, {
    encoding: "utf8",
    mode: 0o600,
  });

  const events = [];
  const recoveryTransport = {
    async discoverSyntheticRecoveryTarget() {
      events.push("discover");
      return { absent: true };
    },
    async deleteExactObject() {
      events.push("deleteObject");
      return { deleted: true, absent: true };
    },
    async recoverSyntheticUser() {
      events.push("recoverUser");
      return { deleted: true };
    },
  };
  const error = await recoverAmoraSuccessorStorageStagingProbe({
    config: firstConfig,
    transport: recoveryTransport,
    inspectInventory: async () => {
      events.push("inspectInventory");
      return normalizedInventory();
    },
  }).then(() => null, (caught) => caught);
  let journalAfter;
  try {
    journalAfter = await readFile(firstConfig.recoveryJournalOut, "utf8");
  } catch (caught) {
    journalAfter = `<missing:${caught?.code ?? "unknown"}>`;
  }

  assert.deepEqual({
    errorCode: error?.code,
    events,
    journalAfter,
  }, {
    errorCode: "RECOVERY_JOURNAL_INVALID",
    events: [],
    journalAfter: mixedJournal,
  });
});

test("explicit recovery ignores a torn trailing append and uses the last fsynced complete record", async () => {
  const config = await probeConfig();
  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport([], { differentPathDenied: false }),
      inspectInventory: async () => normalizedInventory(),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "SIGNED_UPLOAD_PATH_REUSE_ALLOWED",
  );
  await writeFile(
    config.recoveryJournalOut,
    '{"journalVersion":1,"kind":"torn',
    { encoding: "utf8", flag: "a" },
  );
  const result = await recoverAmoraSuccessorStorageStagingProbe({
    config,
    transport: happyTransport([]),
    inspectInventory: async () => normalizedInventory(),
  });
  assert.equal(result.status, "recovery_verified");
  await assert.rejects(access(config.recoveryJournalOut), { code: "ENOENT" });
});

test("recovery validates a foreign torn file before making any local repair", async () => {
  const config = await probeConfig();
  const foreignContent = 'not-an-amora-journal\n{"journalVersion":1,"torn":';
  await writeFile(config.recoveryJournalOut, foreignContent, {
    encoding: "utf8",
    mode: 0o600,
  });
  await assert.rejects(
    recoverAmoraSuccessorStorageStagingProbe({
      config,
      transport: happyTransport([]),
      inspectInventory: async () => normalizedInventory(),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "RECOVERY_JOURNAL_INVALID",
  );
  assert.equal(await readFile(config.recoveryJournalOut, "utf8"), foreignContent);
});

test("a recovery failure keeps the journal for an explicit retry", async () => {
  const config = await probeConfig();
  await assert.rejects(
    runAmoraSuccessorStorageStagingProbe({
      config,
      runNonce: RUN_NONCE,
      transport: happyTransport([], { differentPathDenied: false }),
      inspectInventory: async () => normalizedInventory(),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "SIGNED_UPLOAD_PATH_REUSE_ALLOWED",
  );
  const journalBefore = await readFile(config.recoveryJournalOut, "utf8");
  const recoveryTransport = happyTransport([]);
  recoveryTransport.recoverSyntheticUser = async () => ({ deleted: false });

  await assert.rejects(
    recoverAmoraSuccessorStorageStagingProbe({
      config,
      transport: recoveryTransport,
      inspectInventory: async () => normalizedInventory(),
    }),
    (error) => error instanceof AmoraSuccessorStorageStagingProbeError
      && error.code === "STORAGE_PROBE_RECOVERY_FAILED",
  );

  assert.equal(await readFile(config.recoveryJournalOut, "utf8"), journalBefore);
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
