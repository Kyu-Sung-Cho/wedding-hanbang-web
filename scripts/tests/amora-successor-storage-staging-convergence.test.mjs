import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { connect } from "node:net";
import {
  access,
  appendFile,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  AmoraSuccessorStorageStagingConvergenceError,
  STORAGE_STAGING_CONVERGENCE_APPLY_SQL,
  STORAGE_STAGING_CONVERGENCE_COMPENSATE_SQL,
  STORAGE_STAGING_CONVERGENCE_PLAN_SQL,
  assertAmoraSuccessorStorageStagingConvergenceMutationPlatform,
  classifyAmoraSuccessorStorageStagingConvergenceOutcome,
  createAmoraSuccessorStorageBucketApiFileJournal,
  createAmoraSuccessorStorageBucketApiOperationIdentity,
  createAmoraSuccessorStorageBucketApiRecoveryAuthorization,
  createAmoraSuccessorStorageBucketApiSnapshotInspector,
  createAmoraSuccessorStorageBucketApiTransport,
  createAmoraSuccessorStorageStagingConvergenceReceipt,
  getAmoraSuccessorStorageBucketApiExecutionHostSha256,
  getAmoraSuccessorStorageBucketApiOperationRootSha256,
  inspectAmoraSuccessorStorageStagingConvergencePlan,
  normalizeAmoraSuccessorStorageStagingConvergenceSnapshot,
  planAmoraSuccessorStorageBucketApiConvergence,
  planAmoraSuccessorStorageStagingConvergence,
  runAmoraSuccessorStorageStagingConvergencePlan,
  validateAmoraSuccessorStorageStagingConvergencePlanConfig,
} from "../lib/amora-successor-storage-staging-convergence.mjs";

const HOST_PLATFORM = process.platform;
const linuxMutationTest = HOST_PLATFORM === "linux" ? test : test.skip;

const STAGING_REF = "rgxdizztidbgwnsbadml";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const TEST_SERVICE_ROLE_KEY = `sb_secret_${"t".repeat(32)}`;
const COMMIT = "a".repeat(40);
const TEST_OPERATION_ROOT = await mkdtemp(join(tmpdir(), "amora-storage-bucket-api-root-"));
const OPEN_TEST_RECEIPT_RESERVATIONS = new Set();
test.afterEach(async () => {
  for (const reservation of OPEN_TEST_RECEIPT_RESERVATIONS) {
    await reservation.close?.();
  }
  OPEN_TEST_RECEIPT_RESERVATIONS.clear();
});
const DISCOVERY_COMMIT = "e540cc69da7cbfd919f101d0b4edd2c7d15e92be";
const DISCOVERY_RECEIPT_SHA256 =
  "060adcb82756106ef7fc7e1b897a266f1d2225e5f5b9611b74d3add68d6963be";
const CHAT_POLICY_SHA256 =
  "64bbc946e4c70b9629b21e9a151e5faa95c228acb80dfa4f26778f472b246e19";
const DISCLOSURE_POLICY_SHA256 =
  "ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f";
const DISCLOSURE_INSERT_POLICY_SHA256 =
  "24edd073465ecb17ec3baee29c679abda37160c55eb8bda58ecd20e0c7e625de";
const DISCLOSURE_UPDATE_POLICY_SHA256 =
  "2443f1653a213dde8c5e3edec0c42258c90ac94464397cd644ce6c2d1ddc60ac";
const PRODUCTION_STORAGE_FENCE_SOURCE_SHA256 =
  "806818646e13253b2cd985f40adf1b3f42e8f8855b922ea9dd95e68a875bcd25";
const ACCOUNT_DELETION_STORAGE_FENCE_SOURCE_SHA256 =
  "8b2d9ea440a242435bd64770e880e15d8c55404ad8a0acf0d7d23fd2a3c498d5";
const CURRENT_COUPLE_PATH_SOURCE_SHA256 =
  "a64b9c787ada0c813a1df888d22bc7f9369ff30d81adff5a70574fd5125b3912";

const CREATE_BUCKET_IDS = Object.freeze([
  "chat-image",
  "cohort-images",
  "community-images",
  "community-media-staging",
  "community-videos",
  "guestbook-images",
  "guestbook-uploads",
  "invitation-photos",
  "user_photos",
  "vendor-licenses",
]);

const EXPECTED_BUCKET_API_ACTION_IDS = Object.freeze([
  ...CREATE_BUCKET_IDS.map((bucketId) => `create_bucket:${bucketId}`),
  "update_bucket:vendor-images",
]);

const EXPECTED_ACTION_IDS = Object.freeze([
  ...EXPECTED_BUCKET_API_ACTION_IDS,
  "create_policy:chat-image-strict-insert",
]);

const DISCLOSURE_POLICIES = Object.freeze([
  {
    name: "disclosure_evidence_client_select_fence",
    permissive: "RESTRICTIVE",
    roles: ["anon", "authenticated"],
    command: "SELECT",
    expressionSha256: DISCLOSURE_POLICY_SHA256,
  },
  {
    name: "disclosure_evidence_client_insert_fence",
    permissive: "RESTRICTIVE",
    roles: ["anon", "authenticated"],
    command: "INSERT",
    expressionSha256: DISCLOSURE_INSERT_POLICY_SHA256,
  },
  {
    name: "disclosure_evidence_client_update_fence",
    permissive: "RESTRICTIVE",
    roles: ["anon", "authenticated"],
    command: "UPDATE",
    expressionSha256: DISCLOSURE_UPDATE_POLICY_SHA256,
  },
  {
    name: "disclosure_evidence_client_delete_fence",
    permissive: "RESTRICTIVE",
    roles: ["anon", "authenticated"],
    command: "DELETE",
    expressionSha256: DISCLOSURE_POLICY_SHA256,
  },
]);

const CHAT_POLICY = Object.freeze({
  name: "chat-image own uploader folder write pf46ue_0",
  permissive: "PERMISSIVE",
  roles: ["authenticated"],
  command: "INSERT",
  expressionSha256: CHAT_POLICY_SHA256,
});

function clone(value) {
  return structuredClone(value);
}

function bucket({
  id,
  isPublic,
  fileSizeLimit,
  allowedMimeTypes,
  objectCount,
  objectInventorySha256,
  oversizeObjectCount = 0,
  disallowedMimeObjectCount = 0,
  missingMetadataObjectCount = 0,
}) {
  return {
    id,
    name: id,
    public: isPublic,
    fileSizeLimit,
    allowedMimeTypes,
    objectCount,
    objectInventorySha256,
    oversizeObjectCount,
    disallowedMimeObjectCount,
    missingMetadataObjectCount,
  };
}

function baselineSnapshot() {
  return {
    observedAt: "2026-08-19T03:00:00.000Z",
    relationOwner: "supabase_storage_admin",
    relationRlsEnabled: true,
    relationForceRls: false,
    buckets: [
      bucket({
        id: "disclosure-preview",
        isPublic: false,
        fileSizeLimit: 2 * 1024 * 1024,
        allowedMimeTypes: ["text/plain"],
        objectCount: 20,
        objectInventorySha256: "1".repeat(64),
      }),
      bucket({
        id: "disclosure-raw",
        isPublic: false,
        fileSizeLimit: 50 * 1024 * 1024,
        allowedMimeTypes: [
          "application/haansofthwp",
          "application/json",
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/x-hwp",
          "image/png",
        ],
        objectCount: 900,
        objectInventorySha256: "2".repeat(64),
      }),
      bucket({
        id: "vendor-images",
        isPublic: true,
        fileSizeLimit: null,
        allowedMimeTypes: null,
        objectCount: 3,
        objectInventorySha256: "3".repeat(64),
      }),
    ],
    policies: clone(DISCLOSURE_POLICIES),
    helperContracts: {
      productionStorageWritesAllowed: {
        contractVerified: true,
        sourceSha256: PRODUCTION_STORAGE_FENCE_SOURCE_SHA256,
      },
      accountDeletionStorageWritesAllowed: {
        contractVerified: true,
        sourceSha256: ACCOUNT_DELETION_STORAGE_FENCE_SOURCE_SHA256,
      },
      isCurrentCouplePathMember: {
        contractVerified: true,
        sourceSha256: CURRENT_COUPLE_PATH_SOURCE_SHA256,
      },
    },
    readOnlyPrincipalCanSetStorageAdmin: true,
    fence: {
      triggerNames: [],
      eventTriggerNames: [],
      guardFunctionExists: false,
      attachFunctionExists: false,
      productionStorageWritesAllowed: true,
    },
    totalObjectCount: 923,
    objectInventorySha256: "4".repeat(64),
  };
}

function targetSnapshot() {
  const snapshot = baselineSnapshot();
  const desiredNewBuckets = [
    bucket({ id: "chat-image", isPublic: false, fileSizeLimit: null, allowedMimeTypes: null, objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "cohort-images", isPublic: true, fileSizeLimit: null, allowedMimeTypes: null, objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "community-images", isPublic: true, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"], objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "community-media-staging", isPublic: false, fileSizeLimit: 6 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"], objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "community-videos", isPublic: true, fileSizeLimit: 50 * 1024 * 1024, allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"], objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "guestbook-images", isPublic: false, fileSizeLimit: null, allowedMimeTypes: null, objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "guestbook-uploads", isPublic: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "invitation-photos", isPublic: true, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"], objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "user_photos", isPublic: true, fileSizeLimit: null, allowedMimeTypes: null, objectCount: 0, objectInventorySha256: "0".repeat(64) }),
    bucket({ id: "vendor-licenses", isPublic: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"], objectCount: 0, objectInventorySha256: "0".repeat(64) }),
  ];
  snapshot.buckets = [
    ...snapshot.buckets.map((entry) => entry.id === "vendor-images"
      ? { ...entry, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] }
      : entry),
    ...desiredNewBuckets,
  ];
  snapshot.policies.push(clone(CHAT_POLICY));
  return snapshot;
}

function bucketApiS1Snapshot() {
  const snapshot = targetSnapshot();
  snapshot.policies = clone(DISCLOSURE_POLICIES);
  return snapshot;
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function bucketApiCanonicalSnapshotFingerprint(snapshot) {
  const normalized = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(snapshot);
  return sha256Text(canonicalJson({
    relationOwner: normalized.relationOwner,
    relationRlsEnabled: normalized.relationRlsEnabled,
    relationForceRls: normalized.relationForceRls,
    buckets: normalized.buckets,
    policies: normalized.policies,
    helperContracts: normalized.helperContracts,
    fence: normalized.fence,
    totalObjectCount: normalized.totalObjectCount,
    objectInventorySha256: normalized.objectInventorySha256,
  }));
}

async function mintBucketRecoveryAuthorization(fixture, {
  contractOverrides = {},
  expiresInMs = 20 * 60 * 1000,
  now = new Date(),
  operationIdentity = fixture.operationIdentity,
} = {}) {
  const records = await fixture.journal.read();
  const latestAuthorization = [...records].reverse().find(
    (record) => record.phase === "recovery_authorized",
  );
  const contract = {
    contractVersion: 1,
    kind: "amora-successor-storage-bucket-api-recovery-v1",
    scope: "staging-storage-bucket-api-s0-to-s1-only",
    status: "approved_for_storage_bucket_api_recovery",
    approved: true,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    authorizedModes: ["recover-buckets"],
    approvalEvidence: "f".repeat(64),
    approvedAt: new Date(now.valueOf() - 1_000).toISOString(),
    expiresAt: new Date(now.valueOf() + expiresInMs).toISOString(),
    approvedGitCommit: COMMIT,
    approvedPlanSha256: fixture.plan.planSha256,
    targetBucketContractSha256: fixture.plan.targetBucketContractSha256,
    operationId: operationIdentity.operationId,
    operationRootSha256: operationIdentity.operationRootSha256,
    executionHostSha256: operationIdentity.executionHostSha256,
    originalApprovalSha256: operationIdentity.approvalSha256,
    predecessorAuthorizationSha256:
      latestAuthorization?.recoveryApprovalSha256 ?? null,
    journalRecordCount: records.length,
    journalChainSha256: sha256Text(canonicalJson(records)),
    revokedAt: null,
    mutationAuthorization: {
      authorized: true,
      reason: "USER_RECOVERY_APPROVAL_RECORDED",
    },
    notice: "Explicit staging-only forward recovery approval.",
    ...contractOverrides,
  };
  const approvalContractRaw = `${JSON.stringify(contract, null, 2)}\n`;
  return {
    approvalContractRaw,
    recoveryApprovalSha256: sha256Text(approvalContractRaw),
    authorization: createAmoraSuccessorStorageBucketApiRecoveryAuthorization({
      approvalContractRaw,
      operationIdentity,
      plan: fixture.plan,
      now,
    }),
    contract,
  };
}

function validDiscoveryReceipt() {
  return {
    receiptVersion: 1,
    kind: "amora-successor-storage-catalog-discovery",
    status: "captured_read_only",
    scope: "staging-storage-catalog-discovery-only",
    projectRef: STAGING_REF,
    gitCommit: DISCOVERY_COMMIT,
    capturedAt: "2026-08-19T02:00:01.000Z",
    effects: {
      managementReadOnlyRequests: 1,
      authMutations: 0,
      storageMutations: 0,
      productionMutations: 0,
    },
    containsSecrets: false,
    containsRawExpressions: false,
    containsFunctionSource: false,
    containsObjectPaths: false,
    inventory: {
      observedAt: "2026-08-19T02:00:00.000Z",
      relationOwner: "supabase_storage_admin",
      relationRlsEnabled: true,
      relationForceRls: false,
      buckets: [],
      policies: [],
      helperFunctions: [],
      fence: {
        triggerNames: [],
        eventTriggerNames: [],
        guardFunctionExists: false,
        attachFunctionExists: false,
        productionStorageWritesAllowed: true,
      },
      totalObjectCount: 923,
      objectInventorySha256: "4".repeat(64),
    },
  };
}

function convergenceConfigForReceipt(receipt) {
  const discoveryReceiptRaw = JSON.stringify(receipt);
  return {
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    approvedProjectRef: STAGING_REF,
    managementToken: "management-token-that-must-never-be-returned",
    discoveryReceiptRaw,
    discoveryReceiptSha256: sha256Text(discoveryReceiptRaw),
    convergenceToolGitCommit: COMMIT,
  };
}

function planningManagementRow(snapshot = baselineSnapshot()) {
  return {
    observed_at: snapshot.observedAt,
    relation_owner: snapshot.relationOwner,
    relation_rls_enabled: snapshot.relationRlsEnabled,
    relation_force_rls: snapshot.relationForceRls,
    buckets: snapshot.buckets,
    policies: snapshot.policies,
    helper_contracts: snapshot.helperContracts,
    fence: snapshot.fence,
    total_object_count: snapshot.totalObjectCount,
    object_inventory_sha256: snapshot.objectInventorySha256,
    read_only_principal_can_set_storage_admin:
      snapshot.readOnlyPrincipalCanSetStorageAdmin,
  };
}

function assertConvergenceError(code) {
  return (error) => error instanceof AmoraSuccessorStorageStagingConvergenceError
    && error.code === code;
}

function activeBucketOperationIdentity(plan, operationId, {
  operationRoot = TEST_OPERATION_ROOT,
  expiresInMs = 20 * 60 * 1000,
  onApprovalContractRaw,
} = {}) {
  const issuedAt = Date.now();
  const approvalContractRaw = `${JSON.stringify({
    contractVersion: 1,
    kind: "amora-successor-storage-bucket-api-staging-v1",
    scope: "staging-storage-bucket-api-s0-to-s1-only",
    status: "approved_for_storage_bucket_api_staging_mutation",
    approved: true,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    authorizedModes: ["apply-buckets", "recover-buckets"],
    approvalEvidence: "e".repeat(64),
    approvedAt: new Date(issuedAt - 60_000).toISOString(),
    expiresAt: new Date(issuedAt + expiresInMs).toISOString(),
    approvedGitCommit: COMMIT,
    approvedPlanSha256: plan.planSha256,
    targetBucketContractSha256: plan.targetBucketContractSha256,
    operationId,
    operationRootSha256:
      getAmoraSuccessorStorageBucketApiOperationRootSha256(operationRoot),
    executionHostSha256:
      getAmoraSuccessorStorageBucketApiExecutionHostSha256(),
    revokedAt: null,
    mutationAuthorization: {
      authorized: true,
      reason: "USER_MUTATION_APPROVAL_RECORDED",
    },
    notice: "Explicit staging-only S0 to S1 bucket mutation approval.",
  }, null, 2)}\n`;
  onApprovalContractRaw?.(approvalContractRaw);
  return createAmoraSuccessorStorageBucketApiOperationIdentity({
    approvalContractRaw,
    planSha256: plan.planSha256,
    toolGitCommit: COMMIT,
    operationId,
    operationRoot,
    now: new Date(issuedAt),
  });
}

function bucketFileJournalIdentity(plan, operationId, operationRoot) {
  const issuedAt = Date.now();
  return {
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    toolGitCommit: COMMIT,
    approvalSha256: "a".repeat(64),
    approvedAt: new Date(issuedAt - 60_000).toISOString(),
    expiresAt: new Date(issuedAt + 20 * 60_000).toISOString(),
    authorizedModes: ["apply-buckets", "recover-buckets"],
    scope: "staging-storage-bucket-api-s0-to-s1-only",
    executionHostSha256: getAmoraSuccessorStorageBucketApiExecutionHostSha256(),
    operationRootSha256:
      getAmoraSuccessorStorageBucketApiOperationRootSha256(operationRoot),
    planSha256: plan.planSha256,
    actionManifestSha256: plan.targetBucketContractSha256,
    operationId,
  };
}

test("bucket API state classification recognizes only exact S0 and S1 while policy or partial drift is U", async () => {
  const {
    classifyAmoraSuccessorStorageBucketApiConvergenceOutcome,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  assert.equal(
    typeof classifyAmoraSuccessorStorageBucketApiConvergenceOutcome,
    "function",
    "the bucket API classifier must be a public interface",
  );
  const partial = baselineSnapshot();
  partial.buckets.push(clone(
    bucketApiS1Snapshot().buckets.find((entry) => entry.id === "chat-image"),
  ));

  assert.deepEqual([
    classifyAmoraSuccessorStorageBucketApiConvergenceOutcome(baselineSnapshot()),
    classifyAmoraSuccessorStorageBucketApiConvergenceOutcome(bucketApiS1Snapshot()),
    classifyAmoraSuccessorStorageBucketApiConvergenceOutcome(partial),
    classifyAmoraSuccessorStorageBucketApiConvergenceOutcome(targetSnapshot()),
  ], ["S0", "S1", "U", "U"]);
});

test("bucket API planning exposes the exact ordered 11-action S0 to S1 path and the policy-pending S1 status", async () => {
  const {
    planAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  assert.equal(
    typeof planAmoraSuccessorStorageBucketApiConvergence,
    "function",
    "the bucket API planner must be a public interface",
  );
  const s0Plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const s1Plan = planAmoraSuccessorStorageBucketApiConvergence(
    bucketApiS1Snapshot(),
  );

  assert.deepEqual({
    s0Classification: s0Plan.classification,
    s0ActionCount: s0Plan.actions.length,
    s0ActionIds: s0Plan.actions.map((action) => action.id),
    s1Status: s1Plan.status,
    s1Classification: s1Plan.classification,
    s1ActionCount: s1Plan.actions.length,
    targetHashIsBound: /^[a-f0-9]{64}$/u.test(s0Plan.targetBucketContractSha256)
      && s1Plan.targetBucketContractSha256 === s0Plan.targetBucketContractSha256,
  }, {
    s0Classification: "S0",
    s0ActionCount: 11,
    s0ActionIds: EXPECTED_BUCKET_API_ACTION_IDS,
    s1Status: "bucket_configuration_converged_policy_pending",
    s1Classification: "S1",
    s1ActionCount: 0,
    targetHashIsBound: true,
  });
});

linuxMutationTest("bucket API transport is staging-pinned and exposes only the four non-destructive bucket methods", async () => {
  const {
    createAmoraSuccessorStorageBucketApiTransport,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  assert.equal(typeof createAmoraSuccessorStorageBucketApiTransport, "function");
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  assert.throws(() => createAmoraSuccessorStorageBucketApiTransport({
    projectRef: PRODUCTION_REF,
    productionProjectRef: PRODUCTION_REF,
    serviceRoleKey: TEST_SERVICE_ROLE_KEY,
    fetchImpl,
  }), assertConvergenceError("PRODUCTION_TARGET_FORBIDDEN"));
  assert.equal(fetchCount, 0);

  const transport = createAmoraSuccessorStorageBucketApiTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    serviceRoleKey: TEST_SERVICE_ROLE_KEY,
    fetchImpl,
  });
  assert.deepEqual(Object.keys(transport).sort(), [
    "createBucket", "getBucket", "listBuckets", "updateVendorImages",
  ]);
  for (const forbidden of [
    "deleteBucket", "emptyBucket", "getObject", "removeObject", "createPolicy",
  ]) {
    assert.equal(forbidden in transport, false, forbidden);
  }
});

linuxMutationTest("bucket API transport sends only sorted inventory reads and exact allowlisted create or vendor update bodies", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture();
  await fixture.transport.listBuckets();
  await runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  });

  const calls = fixture.transportCalls;
  const listUrl = new URL(calls[0].url);
  assert.equal(listUrl.origin, `https://${STAGING_REF}.supabase.co`);
  assert.equal(listUrl.pathname, "/storage/v1/bucket");
  assert.deepEqual(Object.fromEntries(listUrl.searchParams), {
    limit: "100", offset: "0", sortColumn: "id", sortOrder: "asc",
  });
  assert.deepEqual(calls.slice(0, 1).map(({ method, redirect, hasSignal }) => ({
    method, redirect, hasSignal,
  })), [
    { method: "GET", redirect: "error", hasSignal: true },
  ]);
  const mutationCalls = calls.filter((call) => ["POST", "PUT"].includes(call.method));
  assert.equal(mutationCalls.length, 11);
  assert.deepEqual(mutationCalls[0].body, {
    id: "chat-image",
    name: "chat-image",
    public: false,
    file_size_limit: null,
    allowed_mime_types: null,
  });
  assert.deepEqual(mutationCalls.at(-1).body, {
    id: "vendor-images",
    name: "vendor-images",
    public: true,
    file_size_limit: 5 * 1024 * 1024,
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
  });
  assert.equal(calls.every((call) => call.headerNames.includes("Authorization")), true);
  assert.equal(calls.every((call) => call.headerNames.includes("apikey")), true);
});

linuxMutationTest("bucket API transport redacts rejected responses, preserves ambiguous writes, and bounds streamed bodies", async () => {
  const {
    createAmoraSuccessorStorageBucketApiTransport,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  let fetchCount = 0;
  const transport = createAmoraSuccessorStorageBucketApiTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    serviceRoleKey: TEST_SERVICE_ROLE_KEY,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(new Uint8Array(64 * 1024 + 1), { status: 200 });
    },
  });
  await assert.rejects(
    transport.createBucket("chat-image"),
    assertConvergenceError("STORAGE_BUCKET_API_MUTATION_CAPABILITY_INVALID"),
  );
  await assert.rejects(
    transport.updateVendorImages(),
    assertConvergenceError("STORAGE_BUCKET_API_MUTATION_CAPABILITY_INVALID"),
  );
  assert.equal(fetchCount, 0, "unbound write calls must stop before credentials reach fetch");
  await assert.rejects(
    transport.listBuckets(),
    assertConvergenceError("STORAGE_BUCKET_API_RESPONSE_TOO_LARGE"),
  );
  assert.equal(fetchCount, 1);
});

async function createBucketApiRunnerFixture({
  firstWriteOutcome = "accepted",
  operationId = "33333333-3333-4333-8333-333333333333",
  expiresInMs = 20 * 60 * 1000,
  currentSnapshot = baselineSnapshot(),
  reserveReceipt = true,
  withTransport = true,
} = {}) {
  let current = clone(currentSnapshot);
  const target = bucketApiS1Snapshot();
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const operationRoot = await mkdtemp(join(tmpdir(), "amora-bucket-runner-"));
  let originalApprovalContractRaw = null;
  const operationIdentity = activeBucketOperationIdentity(
    plan,
    operationId,
    {
      operationRoot,
      expiresInMs,
      onApprovalContractRaw: (raw) => { originalApprovalContractRaw = raw; },
    },
  );
  const events = [];
  const mutationCounts = new Map();
  const mutationBehaviors = new Map([[CREATE_BUCKET_IDS[0], firstWriteOutcome]]);
  const mutationDelays = new Map();
  const postReadBehaviors = new Map();
  const inspectionDelays = new Map();
  const inspectionObservedAtByStage = new Map();
  const mutations = [];
  const reads = [];
  const transportCalls = [];
  let activeInspectionContext = null;
  let snapshotMutator = null;
  let inspectorResponseMode = "fresh";
  let replayedInspectorRow = null;
  const journal = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot,
    identity: {
      ...operationIdentity,
      planSha256: plan.planSha256,
      actionManifestSha256: plan.targetBucketContractSha256,
    },
    onEvent: (event) => events.push(event),
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const transport = withTransport ? createAmoraSuccessorStorageBucketApiTransport({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    serviceRoleKey: TEST_SERVICE_ROLE_KEY,
    fetchImpl: async (url, init) => {
      const parsed = new URL(String(url));
      transportCalls.push({
        url: String(url),
        method: init.method,
        redirect: init.redirect,
        body: init.body === undefined ? undefined : JSON.parse(init.body),
        hasSignal: init.signal instanceof AbortSignal,
        headerNames: Object.keys(init.headers).sort(),
      });
      if (init.method === "GET" && parsed.pathname === "/storage/v1/bucket") {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const bucketId = init.method === "POST"
        ? JSON.parse(init.body).id
        : decodeURIComponent(parsed.pathname.split("/").at(-1));
      if (init.method === "GET") {
        events.push(`read:${bucketId}`);
        reads.push(bucketId);
        const postReadBehavior = postReadBehaviors.get(bucketId);
        if (postReadBehavior === "absent") {
          return new Response(JSON.stringify({ statusCode: "404", code: "NoSuchBucket" }), {
            status: 400,
          });
        }
        if (postReadBehavior === "unknown") {
          return new Response(JSON.stringify({ statusCode: "500", code: "InternalError" }), {
            status: 500,
          });
        }
        const found = current.buckets.find((entry) => entry.id === bucketId);
        if (!found) {
          return new Response(JSON.stringify({ statusCode: "404", code: "NoSuchBucket" }), {
            status: 400,
          });
        }
        return new Response(JSON.stringify({
          id: found.id,
          name: found.name,
          public: found.public,
          file_size_limit: found.fileSizeLimit,
          allowed_mime_types: found.allowedMimeTypes,
        }), { status: 200 });
      }
      const actionId = init.method === "POST" ? bucketId : "vendor-images";
      events.push(init.method === "POST"
        ? `mutate:create:${bucketId}`
        : "mutate:update:vendor-images");
      mutations.push(actionId);
      mutationCounts.set(actionId, (mutationCounts.get(actionId) ?? 0) + 1);
      const desired = clone(target.buckets.find((entry) => entry.id === actionId));
      const behavior = mutationBehaviors.get(actionId) ?? "accepted";
      const commits = ![
        "rejected",
        "rejected_malformed",
        "rejected_oversize",
        "unknown_without_commit",
      ].includes(behavior);
      if (commits) {
        current.buckets = current.buckets.filter((entry) => entry.id !== actionId);
        current.buckets.push(desired);
        current.buckets.sort((left, right) => left.id.localeCompare(right.id, "en"));
      }
      const delay = mutationDelays.get(actionId) ?? 0;
      if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      if (["unknown", "unknown_without_commit"].includes(behavior)) {
        throw new Error("simulated response loss");
      }
      if (behavior.includes("malformed")) {
        return new Response("{", { status: 500 });
      }
      if (behavior.includes("oversize")) {
        return new Response(new Uint8Array(64 * 1024 + 1), { status: 500 });
      }
      if (behavior === "rejected" || behavior === "rejected_after_commit") {
        return new Response(JSON.stringify({
          statusCode: "409",
          code: "BucketAlreadyExists",
          message: "redacted concurrent response",
        }), { status: 400 });
      }
      return new Response(JSON.stringify(init.method === "POST"
        ? { name: bucketId }
        : { message: "Successfully updated" }), { status: 200 });
    },
  }) : null;
  const inspectSnapshot = createAmoraSuccessorStorageBucketApiSnapshotInspector({
    config: convergenceConfigForReceipt(validDiscoveryReceipt()),
    onInspect: (context) => {
      activeInspectionContext = clone(context);
      events.push(`snapshot:${context.stage}`);
    },
    fetchImpl: async (_url, init) => {
      const inspectionDelay = inspectionDelays.get(activeInspectionContext?.stage) ?? 0;
      if (inspectionDelay > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, inspectionDelay));
      }
      const request = JSON.parse(init.body);
      const snapshot = clone(current);
      await snapshotMutator?.(snapshot, activeInspectionContext);
      let row = planningManagementRow(snapshot);
      row.observed_at = new Date().toISOString();
      row.freshness_nonce = request.parameters[0];
      if (inspectorResponseMode === "missing_nonce") delete row.freshness_nonce;
      if (inspectorResponseMode === "wrong_nonce") row.freshness_nonce = "wrong-nonce";
      if (inspectorResponseMode === "old") {
        row.observed_at = new Date(Date.now() - 60_000).toISOString();
      }
      if (inspectorResponseMode === "replay") {
        if (replayedInspectorRow === null) replayedInspectorRow = clone(row);
        else row = clone(replayedInspectorRow);
      }
      inspectionObservedAtByStage.set(activeInspectionContext?.stage, row.observed_at);
      return new Response(JSON.stringify([row]), { status: 201 });
    },
  });
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const receiptReservation = reserveReceipt
    && typeof convergenceModule.createAmoraSuccessorStorageBucketApiReceiptReservation
      === "function"
    ? await convergenceModule.createAmoraSuccessorStorageBucketApiReceiptReservation({
      repoRoot: join(import.meta.dirname, "..", ".."),
      operationRoot,
      operationIdentity,
      plan,
      ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
    })
    : null;
  if (receiptReservation) OPEN_TEST_RECEIPT_RESERVATIONS.add(receiptReservation);
  return {
    operationIdentity,
    originalApprovalContractRaw,
    initialSnapshot: baselineSnapshot(),
    plan,
    journal,
    transport,
    events,
    mutationCounts,
    mutations,
    reads,
    transportCalls,
    inspectionObservedAtByStage,
    inspectSnapshot,
    receiptReservation,
    operationRoot,
    journalPath: join(operationRoot, `${operationId}.journal.jsonl`),
    setMutationBehavior(bucketId, behavior) { mutationBehaviors.set(bucketId, behavior); },
    setMutationDelay(bucketId, delay) { mutationDelays.set(bucketId, delay); },
    setPostReadBehavior(bucketId, behavior) { postReadBehaviors.set(bucketId, behavior); },
    setInspectionDelay(stage, delay) { inspectionDelays.set(stage, delay); },
    setSnapshotMutator(mutator) { snapshotMutator = mutator; },
    setInspectorResponseMode(mode) {
      inspectorResponseMode = mode;
      replayedInspectorRow = null;
    },
    setCurrent(next) {
      current = clone(next);
    },
  };
}

linuxMutationTest("bucket runner journals each of 11 actions before mutation, reads it back, and returns only S1 policy-pending", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  assert.equal(typeof runAmoraSuccessorStorageBucketApiConvergence, "function");
  const fixture = await createBucketApiRunnerFixture({ firstWriteOutcome: "unknown" });
  const receipt = await runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:10:00.000Z"),
    runtimePlatform: "linux",
  });

  assert.deepEqual({
    status: receipt.status,
    actionCount: receipt.actionCount,
    policyMutationPending: receipt.policyMutationPending,
    effects: receipt.effects,
    identity: Object.fromEntries(Object.keys(fixture.operationIdentity).map(
      (key) => [key, receipt[key]],
    )),
  }, {
    status: "bucket_configuration_converged_policy_pending",
    actionCount: 11,
    policyMutationPending: true,
    effects: {
      authorizedDurableIntentCount: 11,
      acceptedObservedOutcomeCount: 10,
      unknownObservedOutcomeCount: 1,
      policyMutations: 0,
      objectMutations: 0,
      productionMutations: 0,
    },
    identity: fixture.operationIdentity,
  });
  assert.deepEqual(fixture.events.slice(0, 3), [
    "lease:acquired",
    "snapshot:preflight",
    "journal:prepared:none",
  ]);
  for (const [actionIndex, actionId] of EXPECTED_BUCKET_API_ACTION_IDS.entries()) {
    const prefix = fixture.events.indexOf(`snapshot:apply-prefix-${actionIndex}`);
    const intent = fixture.events.indexOf(`journal:intent:${actionId}`);
    const mutationPrefix = actionId.startsWith("create_bucket:")
      ? `mutate:create:${actionId.slice("create_bucket:".length)}`
      : "mutate:update:vendor-images";
    const mutation = fixture.events.indexOf(mutationPrefix);
    const read = fixture.events.indexOf(`read:${actionId.split(":").at(-1)}`);
    const observed = fixture.events.indexOf(`journal:observed:${actionId}`);
    assert.ok(
      prefix >= 0 && prefix < intent && intent < mutation && mutation < read && read < observed,
      actionId,
    );
  }
  assert.deepEqual(fixture.events.slice(-2), ["journal:verified_s1:none", "lease:released"]);
  assert.equal([...fixture.mutationCounts.values()].every((count) => count === 1), true);
});

linuxMutationTest("bucket runner rejects an unbound operation identity before snapshot, journal, or mutation", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture();
  await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: {
      ...fixture.operationIdentity,
      approvalSha256: "not-a-sha",
    },
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:10:00.000Z"),
    runtimePlatform: "linux",
  }), assertConvergenceError("STORAGE_BUCKET_API_OPERATION_IDENTITY_INVALID"));
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.mutationCounts.size, 0);
});

linuxMutationTest("bucket runner rejects method-shaped forged dependencies before any journal or remote side effect", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture();
  const variants = [
    { journal: { ...fixture.journal } },
    { transport: { ...fixture.transport } },
    {
      inspectSnapshot: async (context) => fixture.inspectSnapshot(context),
    },
  ];
  for (const variant of variants) {
    await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
      initialSnapshot: fixture.initialSnapshot,
      plan: fixture.plan,
      operationIdentity: fixture.operationIdentity,
      journal: fixture.journal,
      transport: fixture.transport,
      inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
      ...variant,
    }), assertConvergenceError("STORAGE_BUCKET_API_RUNNER_CAPABILITY_INVALID"));
  }
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.mutationCounts.size, 0);
  assert.equal(await pathExists(fixture.journalPath), false);
});

linuxMutationTest("bucket runner revalidates the exact durable prefix before every next action intent", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture();
  const blockedActionIndex = 4;
  fixture.setSnapshotMutator((snapshot, context) => {
    if (context.stage === `apply-prefix-${blockedActionIndex}`) {
      snapshot.buckets.push(bucket({
        id: "unexpected-concurrent-bucket",
        isPublic: false,
        fileSizeLimit: null,
        allowedMimeTypes: null,
        objectCount: 0,
        objectInventorySha256: "0".repeat(64),
      }));
    }
  });
  await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_PREFLIGHT_FAILED"));
  assert.equal(fixture.mutations.length, blockedActionIndex);
  assert.equal(
    fixture.events.includes(`journal:intent:${EXPECTED_BUCKET_API_ACTION_IDS[blockedActionIndex]}`),
    false,
  );
  assert.equal(
    fixture.events.includes(`snapshot:apply-prefix-${blockedActionIndex}`),
    true,
  );
});

linuxMutationTest("bucket operation identity is minted only from one active exact approval and journal binding rejects substitution", async () => {
  const convergenceModule = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  assert.equal(
    typeof convergenceModule.createAmoraSuccessorStorageBucketApiOperationIdentity,
    "function",
  );
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const issuedAt = Date.now();
  const operationId = "66666666-6666-4666-8666-666666666666";
  const activeApproval = {
    contractVersion: 1,
    kind: "amora-successor-storage-bucket-api-staging-v1",
    scope: "staging-storage-bucket-api-s0-to-s1-only",
    status: "approved_for_storage_bucket_api_staging_mutation",
    approved: true,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    authorizedModes: ["apply-buckets", "recover-buckets"],
    approvalEvidence: "e".repeat(64),
    approvedAt: new Date(issuedAt - 60_000).toISOString(),
    expiresAt: new Date(issuedAt + 20 * 60_000).toISOString(),
    approvedGitCommit: COMMIT,
    approvedPlanSha256: plan.planSha256,
    targetBucketContractSha256: plan.targetBucketContractSha256,
    operationId,
    operationRootSha256:
      convergenceModule.getAmoraSuccessorStorageBucketApiOperationRootSha256(TEST_OPERATION_ROOT),
    executionHostSha256:
      convergenceModule.getAmoraSuccessorStorageBucketApiExecutionHostSha256(),
    revokedAt: null,
    mutationAuthorization: {
      authorized: true,
      reason: "USER_MUTATION_APPROVAL_RECORDED",
    },
    notice: "Explicit staging-only S0 to S1 bucket mutation approval.",
  };
  const approvalContractRaw = `${JSON.stringify(activeApproval, null, 2)}\n`;
  const identity = convergenceModule.createAmoraSuccessorStorageBucketApiOperationIdentity({
    approvalContractRaw,
    planSha256: plan.planSha256,
    toolGitCommit: COMMIT,
    operationId,
    operationRoot: TEST_OPERATION_ROOT,
    now: new Date(issuedAt),
  });
  assert.equal(identity.approvalSha256, sha256Text(approvalContractRaw));
  assert.throws(() => convergenceModule.createAmoraSuccessorStorageBucketApiOperationIdentity({
    approvalContractRaw,
    planSha256: plan.planSha256,
    toolGitCommit: COMMIT,
    operationId: "77777777-7777-4777-8777-777777777777",
    operationRoot: TEST_OPERATION_ROOT,
    now: new Date(issuedAt),
  }), assertConvergenceError("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID"));
  assert.throws(() => convergenceModule.createAmoraSuccessorStorageBucketApiOperationIdentity({
    approvalContractRaw,
    planSha256: plan.planSha256,
    toolGitCommit: COMMIT,
    operationId,
    operationRoot: join(TEST_OPERATION_ROOT, "different-root"),
    now: new Date(issuedAt),
  }), assertConvergenceError("STORAGE_BUCKET_API_OPERATION_ROOT_UNVERIFIED"));

  const inactiveRaw = await readFile(join(
    import.meta.dirname,
    "..",
    "..",
    "supabase",
    "release-contracts",
    "amora-successor-storage-bucket-api-staging-v1.json",
  ), "utf8");
  assert.throws(() => convergenceModule.createAmoraSuccessorStorageBucketApiOperationIdentity({
    approvalContractRaw: inactiveRaw,
    planSha256: plan.planSha256,
    toolGitCommit: COMMIT,
    operationId,
    operationRoot: TEST_OPERATION_ROOT,
    now: new Date(issuedAt),
  }), assertConvergenceError("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID"));

  const fixture = await createBucketApiRunnerFixture();
  const substituted = activeBucketOperationIdentity(
    fixture.plan,
    "77777777-7777-4777-8777-777777777777",
  );
  await assert.rejects(convergenceModule.runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: substituted,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:10:00.000Z"),
    runtimePlatform: "linux",
  }), assertConvergenceError("STORAGE_BUCKET_API_RUNNER_CAPABILITY_INVALID"));
  assert.deepEqual(fixture.events, []);
});

linuxMutationTest("bucket runner never blind-retries an absent ambiguous write and leaves the durable intent recoverable", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture({ firstWriteOutcome: "unknown" });
  fixture.setPostReadBehavior(CREATE_BUCKET_IDS[0], "absent");
  await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:10:00.000Z"),
    runtimePlatform: "linux",
  }), assertConvergenceError("STORAGE_BUCKET_API_RECOVERY_REQUIRED"));
  assert.equal(fixture.mutationCounts.get(CREATE_BUCKET_IDS[0]), 1);
  assert.deepEqual(fixture.events.slice(-2), [
    `read:${CREATE_BUCKET_IDS[0]}`,
    "lease:released",
  ]);
});

linuxMutationTest("bucket runner treats a fresh rejected duplicate as concurrent mutation even when post-read looks exact", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture();
  fixture.setMutationBehavior(CREATE_BUCKET_IDS[0], "rejected_after_commit");
  await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:10:00.000Z"),
    runtimePlatform: "linux",
  }), assertConvergenceError("STORAGE_BUCKET_API_CONCURRENT_MUTATION_DETECTED"));
  assert.equal(fixture.mutationCounts.get(CREATE_BUCKET_IDS[0]), 1);
});

linuxMutationTest("bucket runner withholds its S1 receipt when final policy or object invariants drift", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  for (const mutateFinal of [
    (snapshot) => snapshot.policies.push(clone(CHAT_POLICY)),
    (snapshot) => { snapshot.totalObjectCount += 1; snapshot.objectInventorySha256 = "f".repeat(64); },
  ]) {
    const fixture = await createBucketApiRunnerFixture();
    fixture.setSnapshotMutator((snapshot, context) => {
      if (context.stage === "final") mutateFinal(snapshot);
    });
    await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
      initialSnapshot: fixture.initialSnapshot,
      plan: fixture.plan,
      operationIdentity: fixture.operationIdentity,
      journal: fixture.journal,
      transport: fixture.transport,
      inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
      now: () => new Date("2026-08-19T05:10:00.000Z"),
      runtimePlatform: "linux",
    }), assertConvergenceError("STORAGE_BUCKET_API_POSTCONDITION_FAILED"));
    assert.equal(fixture.events.includes("journal:verified_s1:none"), false);
  }
});

linuxMutationTest("bucket runner revalidates the exact S0 snapshot before its journal or first mutation", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture();
  fixture.setSnapshotMutator((snapshot) => snapshot.policies.push(clone(CHAT_POLICY)));
  await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:10:00.000Z"),
    runtimePlatform: "linux",
  }), assertConvergenceError("STORAGE_BUCKET_API_PREFLIGHT_FAILED"));
  assert.deepEqual(fixture.events, ["lease:acquired", "snapshot:preflight", "lease:released"]);
  assert.equal(fixture.mutationCounts.size, 0);
});

linuxMutationTest("branded snapshot inspector rejects nonce mismatch, old evidence, or replay before mutation", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  for (const responseMode of ["wrong_nonce", "old", "replay"]) {
    const fixture = await createBucketApiRunnerFixture();
    fixture.setInspectorResponseMode(responseMode);
    await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
      initialSnapshot: fixture.initialSnapshot,
      plan: fixture.plan,
      operationIdentity: fixture.operationIdentity,
      journal: fixture.journal,
      transport: fixture.transport,
      inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    }), assertConvergenceError("STORAGE_BUCKET_API_PREFLIGHT_FAILED"));
    assert.equal(fixture.mutationCounts.size, 0);
  }
});

linuxMutationTest("bucket approval expiry is rechecked from the real clock before runner side effects", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture({
    operationId: "99999999-9999-4999-8999-999999999999",
    expiresInMs: 10,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_MUTATION_APPROVAL_EXPIRED"));
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.mutationCounts.size, 0);
});

linuxMutationTest("bucket approval expiry is rechecked before every remote mutation", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture({
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    expiresInMs: 120,
  });
  fixture.setMutationDelay(CREATE_BUCKET_IDS[0], 150);
  await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_MUTATION_APPROVAL_EXPIRED"));
  assert.equal(
    [...fixture.mutationCounts.values()].reduce((sum, count) => sum + count, 0),
    1,
  );
  assert.equal(fixture.events.at(-1), "lease:released");
});

test("bucket file journal creates one durable chain, appends without O_CREAT, and never recreates a deleted intent", async () => {
  const {
    createAmoraSuccessorStorageBucketApiFileJournal,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  assert.equal(typeof createAmoraSuccessorStorageBucketApiFileJournal, "function");
  const ioRoot = await mkdtemp(join(tmpdir(), "amora-bucket-journal-"));
  const operationId = "11111111-1111-4111-8111-111111111111";
  const journalPath = join(ioRoot, `${operationId}.journal.jsonl`);
  const parentSyncs = [];
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const journal = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: ioRoot,
    identity: bucketFileJournalIdentity(
      plan,
      operationId,
      ioRoot,
    ),
    ...(HOST_PLATFORM === "win32" ? {
      syncParentDirectoryImpl: async (path) => { parentSyncs.push(path); },
    } : {}),
  });
  const prepared = {
    journalVersion: 1,
    kind: "amora-successor-storage-bucket-api-journal-record",
    phase: "prepared",
    actionId: null,
    actionIndex: 0,
    attempt: 0,
    planSha256: plan.planSha256,
    at: "2026-08-19T05:20:00.000Z",
    observedOutcome: null,
  };
  const intent = {
    ...prepared,
    phase: "intent",
    actionId: EXPECTED_BUCKET_API_ACTION_IDS[0],
    attempt: 1,
    at: "2026-08-19T05:20:01.000Z",
  };
  const operationLease = await journal.acquireOperationLease();
  await journal.append(prepared);
  await journal.append(intent);
  const records = await journal.read();
  assert.deepEqual(records.map((entry) => entry.phase), ["prepared", "intent"]);
  if (HOST_PLATFORM === "win32") {
    assert.equal(parentSyncs.length, 1, "only journal creation needs parent fsync");
  }
  assert.equal(
    await pathExists(`${journalPath}.lease`),
    false,
    "the operation lease must be OS-owned so a crashed process cannot strand a lock file",
  );

  await unlink(journalPath);
  await assert.rejects(
    journal.append({ ...intent, attempt: 2, at: "2026-08-19T05:20:02.000Z" }),
    assertConvergenceError("STORAGE_BUCKET_API_JOURNAL_MISSING"),
  );
  assert.equal(await pathExists(journalPath), false, "append must never recreate a missing journal");
  await journal.releaseOperationLease(operationLease);
});

test("bucket file journal rejects mixed runs before append and repairs only a torn final record", async () => {
  const {
    createAmoraSuccessorStorageBucketApiFileJournal,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const ioRoot = await mkdtemp(join(tmpdir(), "amora-bucket-chain-"));
  const operationId = "22222222-2222-4222-8222-222222222222";
  const journalPath = join(ioRoot, `${operationId}.journal.jsonl`);
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const journal = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: ioRoot,
    identity: bucketFileJournalIdentity(
      plan,
      operationId,
      ioRoot,
    ),
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const prepared = {
    journalVersion: 1,
    kind: "amora-successor-storage-bucket-api-journal-record",
    phase: "prepared",
    actionId: null,
    actionIndex: 0,
    attempt: 0,
    planSha256: plan.planSha256,
    at: "2026-08-19T05:20:00.000Z",
    observedOutcome: null,
  };
  const operationLease = await journal.acquireOperationLease();
  await journal.append(prepared);
  const original = await readFile(journalPath, "utf8");
  await assert.rejects(journal.append({
    ...prepared,
    phase: "intent",
    actionId: EXPECTED_BUCKET_API_ACTION_IDS[0],
    attempt: 1,
    planSha256: "f".repeat(64),
  }), assertConvergenceError("STORAGE_BUCKET_API_JOURNAL_INVALID"));
  assert.equal(await readFile(journalPath, "utf8"), original);

  await appendFile(journalPath, '{"torn":', "utf8");
  const recovered = await journal.read();
  assert.deepEqual(recovered.map((entry) => entry.phase), ["prepared"]);
  assert.equal(await readFile(journalPath, "utf8"), original);
  await journal.releaseOperationLease(operationLease);
});

test("bucket file journal grants one project-wide OS lease across different operation roots", async () => {
  const {
    createAmoraSuccessorStorageBucketApiFileJournal,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const ioRoot = await mkdtemp(join(tmpdir(), "amora-bucket-lease-"));
  const otherRoot = await mkdtemp(join(tmpdir(), "amora-bucket-lease-other-"));
  const operationId = "88888888-8888-4888-8888-888888888888";
  const otherOperationId = "89898989-8989-4989-8989-898989898989";
  const journalPath = join(ioRoot, `${operationId}.journal.jsonl`);
  const otherJournalPath = join(otherRoot, `${otherOperationId}.journal.jsonl`);
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const firstIdentity = bucketFileJournalIdentity(
    plan,
    operationId,
    ioRoot,
  );
  const secondIdentity = bucketFileJournalIdentity(
    plan,
    otherOperationId,
    otherRoot,
  );
  const first = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: ioRoot,
    identity: firstIdentity,
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const second = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: otherRoot,
    identity: secondIdentity,
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const lease = await first.acquireOperationLease();
  await first.assertOperationLease(lease);
  await assert.rejects(
    second.acquireOperationLease(),
    assertConvergenceError("STORAGE_BUCKET_API_OPERATION_LEASE_HELD"),
  );
  await first.releaseOperationLease(lease);
  assert.equal(await pathExists(`${journalPath}.lease`), false);
  assert.equal(await pathExists(`${otherJournalPath}.lease`), false);
  const successor = await second.acquireOperationLease();
  await second.assertOperationLease(successor);
  await second.releaseOperationLease(successor);
});

function bucketRecoveryRecord(plan, phase, {
  actionIndex = 0,
  attempt = phase === "prepared" ? 0 : 1,
  observedOutcome = phase === "observed" ? "unknown" : null,
} = {}) {
  const action = ["intent", "observed"].includes(phase)
    ? EXPECTED_BUCKET_API_ACTION_IDS[actionIndex]
    : null;
  return {
    journalVersion: 1,
    kind: "amora-successor-storage-bucket-api-journal-record",
    phase,
    actionId: action,
    actionIndex: phase === "verified_s1" ? EXPECTED_BUCKET_API_ACTION_IDS.length : actionIndex,
    attempt,
    planSha256: plan.planSha256,
    at: `2026-08-19T05:3${actionIndex}:00.000Z`,
    observedOutcome,
  };
}

async function createBucketRecoveryFixture({
  firstAlreadyCommitted,
  expiresInMs = 20 * 60 * 1000,
  reserveReceipt = true,
} = {}) {
  const initialSnapshot = baselineSnapshot();
  const target = bucketApiS1Snapshot();
  let current = clone(initialSnapshot);
  if (firstAlreadyCommitted) {
    current.buckets.push(clone(target.buckets.find(
      (entry) => entry.id === CREATE_BUCKET_IDS[0],
    )));
  }
  const fixture = await createBucketApiRunnerFixture({
    operationId: "44444444-4444-4444-8444-444444444444",
    currentSnapshot: current,
    expiresInMs,
    reserveReceipt,
  });
  const operationLease = await fixture.journal.acquireOperationLease();
  await fixture.journal.append(bucketRecoveryRecord(fixture.plan, "prepared"));
  await fixture.journal.append(bucketRecoveryRecord(
    fixture.plan,
    "intent",
    { actionIndex: 0 },
  ));
  await fixture.journal.releaseOperationLease(operationLease);
  fixture.events.length = 0;
  return {
    ...fixture,
    baselineSnapshot: initialSnapshot,
  };
}

linuxMutationTest("bucket recovery adopts an exact committed intent by read-after-write and never duplicates its create", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  assert.equal(typeof recoverAmoraSuccessorStorageBucketApiConvergence, "function");
  const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: true });
  const receipt = await recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:40:00.000Z"),
    runtimePlatform: "linux",
  });
  assert.equal(receipt.status, "bucket_configuration_converged_policy_pending");
  assert.equal(fixture.reads[0], CREATE_BUCKET_IDS[0]);
  assert.equal(fixture.mutations.includes(CREATE_BUCKET_IDS[0]), false);
  assert.equal(fixture.mutations.length, 10);
  const records = await fixture.journal.read();
  assert.equal(records[2].phase, "observed");
  assert.equal(records[2].observedOutcome, "unknown");
});

linuxMutationTest("bucket recovery retries an absent pending intent only after a second durable intent record", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: false });
  await recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:40:00.000Z"),
    runtimePlatform: "linux",
  });
  const records = await fixture.journal.read();
  assert.deepEqual(records.slice(2, 4).map((entry) => ({
    phase: entry.phase,
    actionId: entry.actionId,
    attempt: entry.attempt,
  })), [
    { phase: "intent", actionId: EXPECTED_BUCKET_API_ACTION_IDS[0], attempt: 2 },
    { phase: "observed", actionId: EXPECTED_BUCKET_API_ACTION_IDS[0], attempt: 2 },
  ]);
  assert.equal(fixture.mutations.filter((id) => id === CREATE_BUCKET_IDS[0]).length, 1);
});

linuxMutationTest("bucket recovery rejects whole-catalog drift before reconciling or issuing any mutation", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  for (const drift of [
    (snapshot) => snapshot.policies.push(clone(CHAT_POLICY)),
    (snapshot) => {
      snapshot.totalObjectCount += 1;
      snapshot.objectInventorySha256 = "f".repeat(64);
    },
    (snapshot) => {
      snapshot.helperContracts.productionStorageWritesAllowed.contractVerified = false;
    },
  ]) {
    const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: false });
    fixture.setSnapshotMutator((snapshot) => drift(snapshot));
    await assert.rejects(recoverAmoraSuccessorStorageBucketApiConvergence({
      baselineSnapshot: fixture.baselineSnapshot,
      plan: fixture.plan,
      operationIdentity: fixture.operationIdentity,
      journal: fixture.journal,
      transport: fixture.transport,
      inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
      now: () => new Date("2026-08-19T05:40:00.000Z"),
      runtimePlatform: "linux",
    }), assertConvergenceError("STORAGE_BUCKET_API_RECOVERY_PREFLIGHT_FAILED"));
    assert.deepEqual(fixture.mutations, []);
    assert.equal((await fixture.journal.read()).length, 2);
  }
});

linuxMutationTest("bucket recovery requires a fresh request nonce before reconciliation or mutation", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: false });
  fixture.setInspectorResponseMode("wrong_nonce");
  await assert.rejects(recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_RECOVERY_PREFLIGHT_FAILED"));
  assert.deepEqual(fixture.mutations, []);
  assert.equal((await fixture.journal.read()).length, 2);
});

linuxMutationTest("bucket recovery never adopts a rejected mutation even when post-read is exact", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: false });
  fixture.setMutationBehavior(CREATE_BUCKET_IDS[0], "rejected_after_commit");
  await assert.rejects(recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:40:00.000Z"),
    runtimePlatform: "linux",
  }), assertConvergenceError("STORAGE_BUCKET_API_CONCURRENT_MUTATION_DETECTED"));
  assert.equal(fixture.mutations.length, 1);
});

linuxMutationTest("bucket recovery seals one deterministic terminal receipt that verified-journal replay reproduces byte-for-byte", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: true });
  const first = await recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:40:00.000Z"),
    runtimePlatform: "linux",
  });
  const terminal = (await fixture.journal.read()).at(-1);
  assert.equal(terminal.phase, "verified_s1");
  assert.equal(terminal.receiptSha256, first.receiptSha256);

  const replay = await recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T06:40:00.000Z"),
    runtimePlatform: "linux",
  });
  assert.deepEqual(replay, first);
});

linuxMutationTest("a finalized bucket receipt remains an exact bounded audit record after its journal is removed", async () => {
  const {
    finalizeAmoraSuccessorStorageBucketApiConvergence,
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: true });
  const receipt = await recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    now: () => new Date("2026-08-19T05:40:00.000Z"),
  });
  const expectedActionSummary = EXPECTED_BUCKET_API_ACTION_IDS.map(
    (actionId, actionIndex) => ({
      actionId,
      intentCount: 1,
      observedOutcome: actionIndex === 0 ? "unknown" : "accepted",
    }),
  );
  const expectedFinalSnapshotEvidence = {
    observedAt: fixture.inspectionObservedAtByStage.get("recovery-final"),
    canonicalFingerprintSha256:
      bucketApiCanonicalSnapshotFingerprint(bucketApiS1Snapshot()),
  };

  assert.equal(fixture.mutations.length, 10);
  assert.deepEqual(receipt.authorizedDurableIntentSummary, expectedActionSummary);
  assert.deepEqual(receipt.finalSnapshotEvidence, expectedFinalSnapshotEvidence);
  assert.deepEqual(receipt.effects, {
    authorizedDurableIntentCount: 11,
    acceptedObservedOutcomeCount: 10,
    unknownObservedOutcomeCount: 1,
    policyMutations: 0,
    objectMutations: 0,
    productionMutations: 0,
  });
  assert.equal("authorizedStorageMutationAttempts" in receipt.effects, false);
  assert.equal("ambiguousStorageMutationAttempts" in receipt.effects, false);

  await finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt,
    journal: fixture.journal,
    receiptReservation: fixture.receiptReservation,
  });
  assert.equal(await pathExists(fixture.journalPath), false);
  const receiptPath = join(
    fixture.operationRoot,
    `${fixture.operationIdentity.operationId}.receipt.json`,
  );
  const persistedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.deepEqual(persistedReceipt, receipt);
  assert.deepEqual(
    persistedReceipt.authorizedDurableIntentSummary,
    expectedActionSummary,
  );
  assert.deepEqual(persistedReceipt.finalSnapshotEvidence, expectedFinalSnapshotEvidence);

  const serialized = JSON.stringify(persistedReceipt);
  assert.equal(serialized.includes(TEST_SERVICE_ROLE_KEY), false);
  assert.equal(serialized.includes(fixture.operationRoot), false);
  assert.doesNotMatch(serialized, /\/storage\/v1\//u);
  assert.doesNotMatch(serialized, /Authorization|apikey|redacted concurrent response/u);
  assert.doesNotMatch(
    serialized,
    /"(?:body|bucketId|headers|objectId|objectPath|requestId|responseId|userId)"\s*:/u,
  );
});

linuxMutationTest("an expired original approval recovers only through an exact durable recovery-only authorization chain", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketRecoveryFixture({
    firstAlreadyCommitted: false,
    expiresInMs: 50,
  });
  const originalRecords = await fixture.journal.read();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
  const recovery = await mintBucketRecoveryAuthorization(fixture);

  const receipt = await recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    recoveryAuthorization: recovery.authorization,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  });
  const records = await fixture.journal.read();
  const recoveryRecord = records.find((record) => record.phase === "recovery_authorized");
  const receiptJournal = records.slice(0, -1);
  const authorizationRecords = receiptJournal.filter(
    (record) => record.phase === "recovery_authorized",
  );

  assert.deepEqual({
    authorizedModes: recovery.contract.authorizedModes,
    originalApprovalSha256: receipt.approvalSha256,
    recoveryApprovalSha256: receipt.recoveryApprovalSha256,
    durableRecoveryApprovalSha256: recoveryRecord.recoveryApprovalSha256,
    predecessorAuthorizationSha256: recoveryRecord.predecessorAuthorizationSha256,
    authorizedJournalRecordCount: recoveryRecord.authorizedJournalRecordCount,
    authorizedJournalChainSha256: recoveryRecord.authorizedJournalChainSha256,
    authorizationTransitionCount: receipt.authorizationTransitionCount,
    authorizationChainSha256: receipt.authorizationChainSha256,
    journalChainSha256: receipt.journalChainSha256,
  }, {
    authorizedModes: ["recover-buckets"],
    originalApprovalSha256: fixture.operationIdentity.approvalSha256,
    recoveryApprovalSha256: recovery.recoveryApprovalSha256,
    durableRecoveryApprovalSha256: recovery.recoveryApprovalSha256,
    predecessorAuthorizationSha256: null,
    authorizedJournalRecordCount: originalRecords.length,
    authorizedJournalChainSha256: sha256Text(canonicalJson(originalRecords)),
    authorizationTransitionCount: 1,
    authorizationChainSha256: sha256Text(canonicalJson(authorizationRecords)),
    journalChainSha256: sha256Text(canonicalJson(receiptJournal)),
  });
  assert.ok(
    records.indexOf(recoveryRecord) < records.findIndex(
      (record) => record.phase === "intent" && record.attempt === 2,
    ),
    "the superseding approval must be durable before any recovery retry intent",
  );
});

linuxMutationTest("wrong predecessor, journal tail, operation, plan, host, or expired recovery approval has zero mutation authority", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const cases = [
    ["predecessor", { predecessorAuthorizationSha256: "a".repeat(64) }],
    ["journal count", { journalRecordCount: 1 }],
    ["journal chain", { journalChainSha256: "b".repeat(64) }],
    ["operation", { operationId: "99999999-9999-4999-8999-999999999999" }],
    ["plan", { approvedPlanSha256: "c".repeat(64) }],
    ["host", { executionHostSha256: "d".repeat(64) }],
  ];
  for (const [name, contractOverrides] of cases) {
    const fixture = await createBucketRecoveryFixture({
      firstAlreadyCommitted: false,
      expiresInMs: 40,
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
    const before = await fixture.journal.read();
    let recoveryAuthorization;
    try {
      recoveryAuthorization = (await mintBucketRecoveryAuthorization(
        fixture,
        { contractOverrides },
      )).authorization;
      await recoverAmoraSuccessorStorageBucketApiConvergence({
        baselineSnapshot: fixture.baselineSnapshot,
        plan: fixture.plan,
        operationIdentity: fixture.operationIdentity,
        recoveryAuthorization,
        journal: fixture.journal,
        transport: fixture.transport,
        inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
      });
      assert.fail(`${name} recovery authorization was accepted`);
    } catch (error) {
      assert.ok(
        [
          "STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID",
          "STORAGE_BUCKET_API_RECOVERY_APPROVAL_REQUIRED",
        ].includes(error?.code),
        `${name}: ${error?.code}`,
      );
    }
    assert.deepEqual(fixture.mutations, [], name);
    assert.deepEqual(await fixture.journal.read(), before, `${name} changed durable authority`);
  }

  const expiredFixture = await createBucketRecoveryFixture({
    firstAlreadyCommitted: false,
    expiresInMs: 40,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
  const before = await expiredFixture.journal.read();
  const expired = await mintBucketRecoveryAuthorization(
    expiredFixture,
    { expiresInMs: 30 },
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 45));
  await assert.rejects(recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: expiredFixture.baselineSnapshot,
    plan: expiredFixture.plan,
    operationIdentity: expiredFixture.operationIdentity,
    recoveryAuthorization: expired.authorization,
    journal: expiredFixture.journal,
    transport: expiredFixture.transport,
    inspectSnapshot: expiredFixture.inspectSnapshot,
    receiptReservation: expiredFixture.receiptReservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_RECOVERY_APPROVAL_EXPIRED"));
  assert.deepEqual(expiredFixture.mutations, []);
  assert.deepEqual(
    await expiredFixture.journal.read(),
    before,
    "an expired recovery approval must not become durable authority",
  );
});

linuxMutationTest("recovery approval expiry is rechecked immediately before both recovery write sites", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  for (const [name, firstAlreadyCommitted, delayedStage] of [
    ["retry pending intent", false, "recovery-preflight"],
    ["continue after adopted intent", true, "recovery-prefix"],
  ]) {
    const fixture = await createBucketRecoveryFixture({
      firstAlreadyCommitted,
      expiresInMs: 40,
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
    const recovery = await mintBucketRecoveryAuthorization(
      fixture,
      { expiresInMs: 120 },
    );
    fixture.setInspectionDelay(delayedStage, 150);
    await assert.rejects(recoverAmoraSuccessorStorageBucketApiConvergence({
      baselineSnapshot: fixture.baselineSnapshot,
      plan: fixture.plan,
      operationIdentity: fixture.operationIdentity,
      recoveryAuthorization: recovery.authorization,
      journal: fixture.journal,
      transport: fixture.transport,
      inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    }), assertConvergenceError("STORAGE_BUCKET_API_RECOVERY_APPROVAL_EXPIRED"), name);
    assert.deepEqual(fixture.mutations, [], name);
  }
});

linuxMutationTest("recovery never retries when a fresh prefix saw i+1 committed but the exact post-read says absent", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: true });
  fixture.setPostReadBehavior(CREATE_BUCKET_IDS[0], "absent");
  await assert.rejects(recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_MANUAL_RECOVERY_REQUIRED"));
  assert.deepEqual(fixture.mutations, []);
  assert.equal((await fixture.journal.read()).filter(
    (record) => record.phase === "intent" && record.attempt === 2,
  ).length, 0);
});

linuxMutationTest("malformed or oversized non-2xx recovery responses stop after one exact post-read without blind retry", async () => {
  const {
    recoverAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  for (const [behavior, expectedCode] of [
    ["rejected_malformed", "STORAGE_BUCKET_API_MUTATION_REJECTED"],
    ["rejected_oversize", "STORAGE_BUCKET_API_MUTATION_REJECTED"],
    ["rejected_malformed_after_commit", "STORAGE_BUCKET_API_CONCURRENT_MUTATION_DETECTED"],
    ["rejected_oversize_after_commit", "STORAGE_BUCKET_API_CONCURRENT_MUTATION_DETECTED"],
  ]) {
    const fixture = await createBucketRecoveryFixture({ firstAlreadyCommitted: false });
    fixture.setMutationBehavior(CREATE_BUCKET_IDS[0], behavior);
    await assert.rejects(recoverAmoraSuccessorStorageBucketApiConvergence({
      baselineSnapshot: fixture.baselineSnapshot,
      plan: fixture.plan,
      operationIdentity: fixture.operationIdentity,
      journal: fixture.journal,
      transport: fixture.transport,
      inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
    }), assertConvergenceError(expectedCode), behavior);
    assert.equal(
      fixture.mutations.filter((bucketId) => bucketId === CREATE_BUCKET_IDS[0]).length,
      1,
      behavior,
    );
  }
});

linuxMutationTest("an expired original contract can be restored only as recovery provenance in a new process", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  assert.equal(
    typeof convergenceModule.restoreAmoraSuccessorStorageBucketApiOperationIdentityForRecovery,
    "function",
    "recovery after a process restart needs a public exact-contract provenance restore",
  );
  const fixture = await createBucketRecoveryFixture({
    firstAlreadyCommitted: false,
    expiresInMs: 40,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
  const restored = convergenceModule
    .restoreAmoraSuccessorStorageBucketApiOperationIdentityForRecovery({
      approvalContractRaw: fixture.originalApprovalContractRaw,
      planSha256: fixture.plan.planSha256,
      toolGitCommit: COMMIT,
      operationId: fixture.operationIdentity.operationId,
      operationRoot: fixture.operationRoot,
      now: new Date(),
    });
  assert.deepEqual(restored, fixture.operationIdentity);
  assert.throws(() => convergenceModule
    .restoreAmoraSuccessorStorageBucketApiOperationIdentityForRecovery({
      approvalContractRaw: "{".concat("x".repeat(16 * 1024), "}"),
      planSha256: fixture.plan.planSha256,
      toolGitCommit: COMMIT,
      operationId: fixture.operationIdentity.operationId,
      operationRoot: fixture.operationRoot,
      now: new Date(),
    }), assertConvergenceError("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID"));
  assert.deepEqual(fixture.mutations, []);

  await assert.rejects(convergenceModule.runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: restored,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_MUTATION_APPROVAL_EXPIRED"));
  assert.deepEqual(fixture.mutations, []);

  const recovery = await mintBucketRecoveryAuthorization(
    fixture,
    { operationIdentity: restored },
  );
  const receipt = await convergenceModule.recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: fixture.baselineSnapshot,
    plan: fixture.plan,
    operationIdentity: restored,
    recoveryAuthorization: recovery.authorization,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  });
  assert.equal(receipt.recoveryApprovalSha256, recovery.recoveryApprovalSha256);

  const original = JSON.parse(fixture.originalApprovalContractRaw);
  for (const [name, mutate] of [
    ["operation", (contract) => { contract.operationId = "99999999-9999-4999-8999-999999999999"; }],
    ["plan", (contract) => { contract.approvedPlanSha256 = "a".repeat(64); }],
    ["root", (contract) => { contract.operationRootSha256 = "b".repeat(64); }],
    ["host", (contract) => { contract.executionHostSha256 = "c".repeat(64); }],
  ]) {
    const drifted = clone(original);
    mutate(drifted);
    assert.throws(() => convergenceModule
      .restoreAmoraSuccessorStorageBucketApiOperationIdentityForRecovery({
        approvalContractRaw: `${JSON.stringify(drifted, null, 2)}\n`,
        planSha256: fixture.plan.planSha256,
        toolGitCommit: COMMIT,
        operationId: fixture.operationIdentity.operationId,
        operationRoot: fixture.operationRoot,
        now: new Date(),
      }), assertConvergenceError("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID"), name);
  }
});

test("a connected localhost client cannot hang release of the project-wide OS lease", async () => {
  const ioRoot = await mkdtemp(join(tmpdir(), "amora-bucket-lease-client-"));
  const operationId = "78787878-7878-4878-8878-787878787878";
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const journal = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: ioRoot,
    identity: bucketFileJournalIdentity(plan, operationId, ioRoot),
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const leaseKey = sha256Text(canonicalJson({
    projectRef: STAGING_REF,
    scope: "staging-storage-bucket-api-s0-to-s1-only",
  }));
  const leasePort = 40_000 + (Number.parseInt(leaseKey.slice(0, 8), 16) % 20_000);
  const lease = await journal.acquireOperationLease();
  const socket = connect({ host: "127.0.0.1", port: leasePort });
  try {
    await new Promise((resolveConnect, rejectConnect) => {
      socket.once("connect", resolveConnect);
      socket.once("error", rejectConnect);
    });
    await Promise.race([
      journal.releaseOperationLease(lease),
      new Promise((_, rejectTimeout) => {
        const timer = setTimeout(
          () => rejectTimeout(new Error("lease release hung on localhost client")),
          750,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    socket.destroy();
  }
  const successor = await journal.acquireOperationLease();
  await journal.releaseOperationLease(successor);
});

linuxMutationTest("finalization accepts only the official branded external receipt reservation and writer", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  assert.equal(
    typeof convergenceModule.createAmoraSuccessorStorageBucketApiReceiptReservation,
    "function",
    "bucket completion needs one official receipt reservation capability",
  );
  for (const variant of ["generic callback", "spread", "method shaped"]) {
    const fixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
    const reservation = await convergenceModule
      .createAmoraSuccessorStorageBucketApiReceiptReservation({
        repoRoot: join(import.meta.dirname, "..", ".."),
        operationRoot: fixture.operationRoot,
        operationIdentity: fixture.operationIdentity,
        plan: fixture.plan,
        ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
      });
    const receipt = await convergenceModule.runAmoraSuccessorStorageBucketApiConvergence({
      initialSnapshot: fixture.initialSnapshot,
      plan: fixture.plan,
      operationIdentity: fixture.operationIdentity,
      journal: fixture.journal,
      transport: fixture.transport,
      inspectSnapshot: fixture.inspectSnapshot,
      receiptReservation: reservation,
    });
    const beforeJournal = await readFile(fixture.journalPath, "utf8");
    const receiptPath = join(
      fixture.operationRoot,
      `${fixture.operationIdentity.operationId}.receipt.json`,
    );
    const beforeReceipt = await readFile(receiptPath, "utf8");
    let genericWrites = 0;
    const forged = variant === "spread" ? { ...reservation }
      : variant === "method shaped" ? {
        writeReceipt: (...args) => reservation.writeReceipt(...args),
      }
        : null;
    await assert.rejects(
      convergenceModule.finalizeAmoraSuccessorStorageBucketApiConvergence({
        receipt,
        journal: fixture.journal,
        ...(variant === "generic callback" ? {
          writeReceipt: async () => { genericWrites += 1; },
        } : { receiptReservation: forged }),
      }),
      assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID"),
      variant,
    );
    assert.equal(genericWrites, 0, variant);
    assert.equal(await readFile(fixture.journalPath, "utf8"), beforeJournal, variant);
    assert.equal(await readFile(receiptPath, "utf8"), beforeReceipt, variant);
    await convergenceModule.finalizeAmoraSuccessorStorageBucketApiConvergence({
      receipt,
      journal: fixture.journal,
      receiptReservation: reservation,
    });
  }
});

linuxMutationTest("receipt reservation is wx, 0600, external, identity-bound, and required before the first remote observation", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const createReservation =
    convergenceModule.createAmoraSuccessorStorageBucketApiReceiptReservation;
  assert.equal(typeof createReservation, "function");
  const repoRoot = join(import.meta.dirname, "..", "..");

  for (const variant of ["missing", "method shaped"]) {
    const fixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
    const forged = variant === "method shaped" ? { writeReceipt: async () => {} } : null;
    await assert.rejects(convergenceModule.runAmoraSuccessorStorageBucketApiConvergence({
      initialSnapshot: fixture.initialSnapshot,
      plan: fixture.plan,
      operationIdentity: fixture.operationIdentity,
      journal: fixture.journal,
      transport: fixture.transport,
      inspectSnapshot: fixture.inspectSnapshot,
      receiptReservation: forged,
    }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID"), variant);
    assert.deepEqual(fixture.events, [], variant);
    assert.deepEqual(fixture.mutations, [], variant);
  }

  const fixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
  const receiptPath = join(
    fixture.operationRoot,
    `${fixture.operationIdentity.operationId}.receipt.json`,
  );
  const reservation = await createReservation({
    repoRoot,
    operationRoot: fixture.operationRoot,
    operationIdentity: fixture.operationIdentity,
    plan: fixture.plan,
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const reservedMetadata = await stat(receiptPath);
  assert.equal(reservedMetadata.isFile(), true);
  assert.equal(reservedMetadata.size, 0);
  if (HOST_PLATFORM !== "win32") assert.equal(reservedMetadata.mode & 0o777, 0o600);
  assert.deepEqual(fixture.events, []);
  assert.equal(typeof reservation.writeReceipt, "function");

  const occupiedFixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
  const occupiedPath = join(
    occupiedFixture.operationRoot,
    `${occupiedFixture.operationIdentity.operationId}.receipt.json`,
  );
  await writeFile(occupiedPath, "existing", { encoding: "utf8", mode: 0o600 });
  await assert.rejects(createReservation({
    repoRoot,
    operationRoot: occupiedFixture.operationRoot,
    operationIdentity: occupiedFixture.operationIdentity,
    plan: occupiedFixture.plan,
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_RESERVATION_FAILED"));
  assert.equal(await readFile(occupiedPath, "utf8"), "existing");
  assert.deepEqual(occupiedFixture.events, []);

  if (HOST_PLATFORM !== "win32") {
    const symlinkFixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
    const symlinkPath = join(
      symlinkFixture.operationRoot,
      `${symlinkFixture.operationIdentity.operationId}.receipt.json`,
    );
    const symlinkTarget = join(symlinkFixture.operationRoot, "receipt-target.json");
    await writeFile(symlinkTarget, "target", { encoding: "utf8", mode: 0o600 });
    await symlink(symlinkTarget, symlinkPath);
    await assert.rejects(createReservation({
      repoRoot,
      operationRoot: symlinkFixture.operationRoot,
      operationIdentity: symlinkFixture.operationIdentity,
      plan: symlinkFixture.plan,
      ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
    }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_RESERVATION_FAILED"));
    assert.equal(await readFile(symlinkTarget, "utf8"), "target");

    const unwritableFixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
    await chmod(unwritableFixture.operationRoot, 0o500);
    try {
      await assert.rejects(createReservation({
        repoRoot,
        operationRoot: unwritableFixture.operationRoot,
        operationIdentity: unwritableFixture.operationIdentity,
        plan: unwritableFixture.plan,
        ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
      }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_RESERVATION_FAILED"));
      assert.deepEqual(unwritableFixture.events, []);
    } finally {
      await chmod(unwritableFixture.operationRoot, 0o700);
    }
  }

  const insideRoot = await mkdtemp(join(repoRoot, ".amora-receipt-inside-"));
  try {
    if (HOST_PLATFORM !== "win32") await chmod(insideRoot, 0o700);
    const insidePlan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
    const insideIdentity = activeBucketOperationIdentity(
      insidePlan,
      "67676767-6767-4767-8767-676767676767",
      { operationRoot: insideRoot },
    );
    await assert.rejects(createReservation({
      repoRoot,
      operationRoot: insideRoot,
      operationIdentity: insideIdentity,
      plan: insidePlan,
      ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
    }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_RESERVATION_FAILED"));
  } finally {
    await rmdir(insideRoot);
  }
  const receipt = await convergenceModule.runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: reservation,
  });
  await convergenceModule.finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt,
    journal: fixture.journal,
    receiptReservation: reservation,
  });
});

linuxMutationTest("a replaced receipt reservation or operation-root inode stops a bucket run before observation, fetch, or journal append", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  for (const variant of ["unlinked receipt", "replaced receipt", "replaced root"]) {
    const fixture = await createBucketApiRunnerFixture();
    const receiptPath = join(
      fixture.operationRoot,
      `${fixture.operationIdentity.operationId}.receipt.json`,
    );
    const movedRoot = `${fixture.operationRoot}-approved-inode`;
    let rootWasMoved = false;
    try {
      await fixture.receiptReservation.close();
      if (variant === "replaced root") {
        await rename(fixture.operationRoot, movedRoot);
        rootWasMoved = true;
        await mkdir(fixture.operationRoot, { mode: 0o700 });
        if (HOST_PLATFORM !== "win32") await chmod(fixture.operationRoot, 0o700);
      } else {
        await unlink(receiptPath);
        if (variant === "replaced receipt") {
          await writeFile(receiptPath, "", { encoding: "utf8", mode: 0o600 });
          if (HOST_PLATFORM !== "win32") await chmod(receiptPath, 0o600);
        }
      }

      await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
        initialSnapshot: fixture.initialSnapshot,
        plan: fixture.plan,
        operationIdentity: fixture.operationIdentity,
        journal: fixture.journal,
        transport: fixture.transport,
        inspectSnapshot: fixture.inspectSnapshot,
        receiptReservation: fixture.receiptReservation,
      }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID"), variant);
      assert.deepEqual(fixture.events, [], `${variant}: no inspector or journal event`);
      assert.deepEqual(fixture.transportCalls, [], `${variant}: no Storage API fetch`);
      assert.equal(
        await pathExists(fixture.journalPath),
        false,
        `${variant}: no journal file`,
      );
      if (rootWasMoved) {
        assert.equal(
          await pathExists(join(
            movedRoot,
            `${fixture.operationIdentity.operationId}.journal.jsonl`,
          )),
          false,
          `${variant}: no journal append on the approved inode`,
        );
      }
    } finally {
      if (rootWasMoved) {
        await rmdir(fixture.operationRoot).catch(() => {});
        await rename(movedRoot, fixture.operationRoot).catch(() => {});
      }
    }
  }
});

linuxMutationTest("receipt path, inode, or root drift between actions prevents the next network write", async () => {
  const {
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  for (const variant of ["missing path", "replacement inode", "replacement root"]) {
    const fixture = await createBucketApiRunnerFixture();
    const receiptPath = join(
      fixture.operationRoot,
      `${fixture.operationIdentity.operationId}.receipt.json`,
    );
    const movedRoot = `${fixture.operationRoot}-action-zero-inode`;
    let rootWasMoved = false;
    let driftInjected = false;
    fixture.setSnapshotMutator(async (_snapshot, context) => {
      if (driftInjected || context.stage !== "apply-prefix-1") return;
      driftInjected = true;
      await fixture.receiptReservation.close();
      if (variant === "replacement root") {
        await rename(fixture.operationRoot, movedRoot);
        rootWasMoved = true;
        await mkdir(fixture.operationRoot, { mode: 0o700 });
        if (HOST_PLATFORM !== "win32") await chmod(fixture.operationRoot, 0o700);
        return;
      }
      await unlink(receiptPath);
      if (variant === "replacement inode") {
        await writeFile(receiptPath, "", { encoding: "utf8", mode: 0o600 });
        if (HOST_PLATFORM !== "win32") await chmod(receiptPath, 0o600);
      }
    });
    try {
      await assert.rejects(runAmoraSuccessorStorageBucketApiConvergence({
        initialSnapshot: fixture.initialSnapshot,
        plan: fixture.plan,
        operationIdentity: fixture.operationIdentity,
        journal: fixture.journal,
        transport: fixture.transport,
        inspectSnapshot: fixture.inspectSnapshot,
        receiptReservation: fixture.receiptReservation,
      }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID"), variant);
      assert.equal(driftInjected, true, variant);
      assert.deepEqual(fixture.mutations, [CREATE_BUCKET_IDS[0]], variant);
      assert.equal(
        fixture.transportCalls.filter(({ method }) => ["POST", "PUT"].includes(method)).length,
        1,
        `${variant}: the second Storage API write must not start`,
      );
      assert.equal(
        fixture.events.includes(`mutate:create:${CREATE_BUCKET_IDS[1]}`),
        false,
        `${variant}: the second action must remain unwritten`,
      );
    } finally {
      if (rootWasMoved) {
        await rmdir(fixture.operationRoot).catch(() => {});
        await rename(movedRoot, fixture.operationRoot).catch(() => {});
      }
    }
  }
});

test("an approved operation-root inode replacement invalidates the public receipt capability", async () => {
  const {
    createAmoraSuccessorStorageBucketApiReceiptReservation,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const operationRoot = await mkdtemp(join(tmpdir(), "amora-receipt-root-freshness-"));
  if (HOST_PLATFORM !== "win32") await chmod(operationRoot, 0o700);
  const movedRoot = `${operationRoot}-approved-inode`;
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const operationIdentity = activeBucketOperationIdentity(
    plan,
    "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2",
    { operationRoot },
  );
  const reservation = await createAmoraSuccessorStorageBucketApiReceiptReservation({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot,
    operationIdentity,
    plan,
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  let rootWasMoved = false;
  try {
    await reservation.close();
    await rename(operationRoot, movedRoot);
    rootWasMoved = true;
    await mkdir(operationRoot, { mode: 0o700 });
    if (HOST_PLATFORM !== "win32") await chmod(operationRoot, 0o700);
    await assert.rejects(
      reservation.abortEmpty(),
      assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID"),
    );
  } finally {
    await reservation.close().catch(() => {});
    if (rootWasMoved) {
      await rmdir(operationRoot).catch(() => {});
      await rename(movedRoot, operationRoot).catch(() => {});
    }
  }
});

test("receipt and journal factories reject a fake caller repo root before creating checkout-internal artifacts", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const actualRepoRoot = join(import.meta.dirname, "..", "..");
  const fakeRepoRoot = await mkdtemp(join(tmpdir(), "amora-fake-caller-repo-"));
  const operationRoot = await mkdtemp(join(actualRepoRoot, ".amora-internal-operation-"));
  if (HOST_PLATFORM !== "win32") await chmod(operationRoot, 0o700);
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const operationIdentity = activeBucketOperationIdentity(
    plan,
    "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1",
    { operationRoot },
  );
  const receiptPath = join(
    operationRoot,
    `${operationIdentity.operationId}.receipt.json`,
  );
  const journalPath = join(
    operationRoot,
    `${operationIdentity.operationId}.journal.jsonl`,
  );
  let unexpectedReservation = null;
  try {
    await assert.rejects(async () => {
      unexpectedReservation = await convergenceModule
        .createAmoraSuccessorStorageBucketApiReceiptReservation({
          repoRoot: fakeRepoRoot,
          operationRoot,
          operationIdentity,
          plan,
          ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
        });
    }, assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_RESERVATION_FAILED"));
    assert.throws(() => convergenceModule.createAmoraSuccessorStorageBucketApiFileJournal({
      repoRoot: fakeRepoRoot,
      operationRoot,
      identity: {
        ...operationIdentity,
        actionManifestSha256: plan.targetBucketContractSha256,
      },
      ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
    }), assertConvergenceError("STORAGE_BUCKET_API_JOURNAL_PATH_INVALID"));
    assert.equal(await pathExists(receiptPath), false);
    assert.equal(await pathExists(journalPath), false);
  } finally {
    await unexpectedReservation?.close?.().catch(() => {});
    if (await pathExists(receiptPath)) await unlink(receiptPath);
    if (await pathExists(journalPath)) await unlink(journalPath);
    await rmdir(operationRoot).catch(() => {});
    await rmdir(fakeRepoRoot).catch(() => {});
  }
});

linuxMutationTest("receipt writing pins one inode and exact bytes, then crash-after-write replay is idempotent", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const fixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
  const reservation = await convergenceModule
    .createAmoraSuccessorStorageBucketApiReceiptReservation({
      repoRoot: join(import.meta.dirname, "..", ".."),
      operationRoot: fixture.operationRoot,
      operationIdentity: fixture.operationIdentity,
      plan: fixture.plan,
      ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
    });
  const receiptPath = join(
    fixture.operationRoot,
    `${fixture.operationIdentity.operationId}.receipt.json`,
  );
  const reserved = await stat(receiptPath);
  const receipt = await convergenceModule.runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: reservation,
  });
  await reservation.writeReceipt(receipt);
  const exactBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  const written = await stat(receiptPath);
  assert.equal(written.dev, reserved.dev);
  assert.equal(written.ino, reserved.ino);
  assert.equal(written.size, Buffer.byteLength(exactBytes, "utf8"));
  assert.ok(written.size > 0 && written.size < 32 * 1024);
  if (HOST_PLATFORM !== "win32") assert.equal(written.mode & 0o777, 0o600);
  assert.equal(await readFile(receiptPath, "utf8"), exactBytes);

  await reservation.writeReceipt(receipt);
  const replayed = await convergenceModule.finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt,
    journal: fixture.journal,
    receiptReservation: reservation,
  });
  const afterReplay = await stat(receiptPath);
  assert.equal(afterReplay.dev, reserved.dev);
  assert.equal(afterReplay.ino, reserved.ino);
  assert.equal(await readFile(receiptPath, "utf8"), exactBytes);
  assert.equal(replayed.receiptSha256, receipt.receiptSha256);
  assert.equal(await pathExists(fixture.journalPath), false);

  const source = await readFile(join(
    import.meta.dirname,
    "..",
    "lib",
    "amora-successor-storage-staging-convergence.mjs",
  ), "utf8");
  const factoryStart = source.indexOf(
    "async function openAmoraSuccessorStorageBucketApiReceiptReservation",
  );
  const factoryBody = source.slice(factoryStart, source.indexOf("\n}\n", factoryStart) + 3);
  assert.match(factoryBody, /\.sync\s*\(\s*\)/u, "receipt file must be fsynced");
  assert.match(factoryBody, /open\s*\(\s*dirname\(/u, "POSIX parent must be opened for fsync");
});

linuxMutationTest("a new process restores an exact empty receipt reservation and durable journal for recovery", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const repoRoot = join(import.meta.dirname, "..", "..");
  const operationRoot = await mkdtemp(join(tmpdir(), "amora-receipt-child-restart-"));
  const operationId = "32323232-3232-4232-8232-323232323232";
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  let approvalContractRaw = null;
  const operationIdentity = activeBucketOperationIdentity(plan, operationId, {
    operationRoot,
    onApprovalContractRaw: (raw) => { approvalContractRaw = raw; },
  });
  const libUrl = pathToFileURL(join(
    import.meta.dirname,
    "..",
    "lib",
    "amora-successor-storage-staging-convergence.mjs",
  )).href;
  const childSource = `
const module = await import(process.env.AMORA_TEST_LIB_URL);
const plan = JSON.parse(Buffer.from(process.env.AMORA_TEST_PLAN_B64, "base64").toString("utf8"));
const approvalContractRaw = Buffer.from(
  process.env.AMORA_TEST_APPROVAL_B64,
  "base64",
).toString("utf8");
const operationIdentity = module.createAmoraSuccessorStorageBucketApiOperationIdentity({
  approvalContractRaw,
  planSha256: plan.planSha256,
  toolGitCommit: ${JSON.stringify(COMMIT)},
  operationId: process.env.AMORA_TEST_OPERATION_ID,
  operationRoot: process.env.AMORA_TEST_OPERATION_ROOT,
  now: new Date(),
});
await module.createAmoraSuccessorStorageBucketApiReceiptReservation({
  repoRoot: process.env.AMORA_TEST_REPO_ROOT,
  operationRoot: process.env.AMORA_TEST_OPERATION_ROOT,
  operationIdentity,
  plan,
  ...(${JSON.stringify(HOST_PLATFORM)} === "win32"
    ? { syncParentDirectoryImpl: async () => {} }
    : {}),
});
const journal = module.createAmoraSuccessorStorageBucketApiFileJournal({
  repoRoot: process.env.AMORA_TEST_REPO_ROOT,
  operationRoot: process.env.AMORA_TEST_OPERATION_ROOT,
  identity: {
    ...operationIdentity,
    actionManifestSha256: plan.targetBucketContractSha256,
  },
  ...(${JSON.stringify(HOST_PLATFORM)} === "win32"
    ? { syncParentDirectoryImpl: async () => {} }
    : {}),
});
const lease = await journal.acquireOperationLease();
await journal.append({
  journalVersion: 1,
  kind: "amora-successor-storage-bucket-api-journal-record",
  phase: "prepared",
  actionId: null,
  actionIndex: 0,
  attempt: 0,
  planSha256: plan.planSha256,
  at: new Date().toISOString(),
  observedOutcome: null,
});
await journal.append({
  journalVersion: 1,
  kind: "amora-successor-storage-bucket-api-journal-record",
  phase: "intent",
  actionId: plan.actions[0].id,
  actionIndex: 0,
  attempt: 1,
  planSha256: plan.planSha256,
  at: new Date().toISOString(),
  observedOutcome: null,
});
await journal.releaseOperationLease(lease);
process.stdout.write("child-crash-state-ready");
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    encoding: "utf8",
    env: {
      ...process.env,
      AMORA_TEST_LIB_URL: libUrl,
      AMORA_TEST_PLAN_B64: Buffer.from(JSON.stringify(plan), "utf8").toString("base64"),
      AMORA_TEST_APPROVAL_B64:
        Buffer.from(approvalContractRaw, "utf8").toString("base64"),
      AMORA_TEST_OPERATION_ID: operationId,
      AMORA_TEST_OPERATION_ROOT: operationRoot,
      AMORA_TEST_REPO_ROOT: repoRoot,
    },
  });
  assert.deepEqual({ status: child.status, stdout: child.stdout, stderr: child.stderr }, {
    status: 0,
    stdout: "child-crash-state-ready",
    stderr: "",
  });
  assert.equal(
    typeof convergenceModule
      .restoreAmoraSuccessorStorageBucketApiReceiptReservationForRecovery,
    "function",
  );
  const receiptPath = join(
    operationRoot,
    `${operationId}.receipt.json`,
  );
  assert.equal((await stat(receiptPath)).size, 0);
  const fixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
  const restartedJournal = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot,
    operationRoot,
    identity: {
      ...operationIdentity,
      actionManifestSha256: plan.targetBucketContractSha256,
    },
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const restoredReservation = await convergenceModule
    .restoreAmoraSuccessorStorageBucketApiReceiptReservationForRecovery({
      repoRoot,
      operationRoot,
      operationIdentity,
      plan,
      ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
    });
  const receipt = await convergenceModule.recoverAmoraSuccessorStorageBucketApiConvergence({
    baselineSnapshot: baselineSnapshot(),
    plan,
    operationIdentity,
    journal: restartedJournal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: restoredReservation,
  });
  await convergenceModule.finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt,
    journal: restartedJournal,
    receiptReservation: restoredReservation,
  });
  assert.equal(receipt.status, "bucket_configuration_converged_policy_pending");
  assert.equal(
    await pathExists(join(operationRoot, `${operationId}.journal.jsonl`)),
    false,
  );
  assert.equal(await readFile(receiptPath, "utf8"), `${JSON.stringify(receipt, null, 2)}\n`);
});

linuxMutationTest("a new process reopens an exact full receipt for idempotent finalizer replay", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const fixture = await createBucketApiRunnerFixture();
  const receipt = await convergenceModule.runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: fixture.receiptReservation,
  });
  await fixture.receiptReservation.writeReceipt(receipt);
  const durableJournalBytes = await readFile(fixture.journalPath, "utf8");
  await convergenceModule.finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt,
    journal: fixture.journal,
    receiptReservation: fixture.receiptReservation,
  });
  await writeFile(fixture.journalPath, durableJournalBytes, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  if (HOST_PLATFORM !== "win32") await chmod(fixture.journalPath, 0o600);
  const restartedJournal = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: fixture.operationRoot,
    identity: {
      ...fixture.operationIdentity,
      actionManifestSha256: fixture.plan.targetBucketContractSha256,
    },
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const restoredReservation = await convergenceModule
    .restoreAmoraSuccessorStorageBucketApiReceiptReservationForRecovery({
      repoRoot: join(import.meta.dirname, "..", ".."),
      operationRoot: fixture.operationRoot,
      operationIdentity: fixture.operationIdentity,
      plan: fixture.plan,
      ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
    });
  const replay = await convergenceModule.finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt,
    journal: restartedJournal,
    receiptReservation: restoredReservation,
  });
  assert.deepEqual(replay, receipt);
  assert.equal(await pathExists(fixture.journalPath), false);
  assert.equal(
    await readFile(join(
      fixture.operationRoot,
      `${fixture.operationIdentity.operationId}.receipt.json`,
    ), "utf8"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
});

linuxMutationTest("receipt recovery rejects wrong bytes, bounds, symlink, mode, root, operation, or plan with zero effects", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const variants = ["wrong bytes", "oversize", "operation", "plan"];
  if (HOST_PLATFORM !== "win32") variants.push("symlink", "mode");
  for (const variant of variants) {
    const fixture = await createBucketRecoveryFixture({
      firstAlreadyCommitted: false,
      reserveReceipt: false,
    });
    const receiptPath = join(
      fixture.operationRoot,
      `${fixture.operationIdentity.operationId}.receipt.json`,
    );
    if (variant === "symlink") {
      const target = join(fixture.operationRoot, "wrong-receipt-target.json");
      await writeFile(target, "", { encoding: "utf8", mode: 0o600 });
      await symlink(target, receiptPath);
    } else {
      const bytes = variant === "wrong bytes" ? "not-a-receipt"
        : variant === "oversize" ? "x".repeat(32 * 1024 + 1)
          : "";
      await writeFile(receiptPath, bytes, { encoding: "utf8", mode: 0o600 });
      if (HOST_PLATFORM !== "win32") {
        await chmod(receiptPath, variant === "mode" ? 0o644 : 0o600);
      }
    }
    const journalBefore = await readFile(fixture.journalPath, "utf8");
    const receiptBefore = await readFile(receiptPath, "utf8");
    const wrongIdentity = variant === "operation"
      ? activeBucketOperationIdentity(
        fixture.plan,
        "34343434-3434-4434-8434-343434343434",
        { operationRoot: fixture.operationRoot },
      )
      : fixture.operationIdentity;
    const wrongPlan = variant === "plan"
      ? { ...fixture.plan, planSha256: "b".repeat(64) }
      : fixture.plan;
    await assert.rejects(convergenceModule
      .restoreAmoraSuccessorStorageBucketApiReceiptReservationForRecovery({
        repoRoot: join(import.meta.dirname, "..", ".."),
        operationRoot: fixture.operationRoot,
        operationIdentity: wrongIdentity,
        plan: wrongPlan,
        ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
      }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_RECOVERY_INVALID"), variant);
    assert.equal(await readFile(fixture.journalPath, "utf8"), journalBefore, variant);
    assert.equal(await readFile(receiptPath, "utf8"), receiptBefore, variant);
    assert.deepEqual(fixture.mutations, [], variant);
  }

  const rootFixture = await createBucketRecoveryFixture({
    firstAlreadyCommitted: false,
    reserveReceipt: false,
  });
  const originalRoot = `${rootFixture.operationRoot}-original`;
  const receiptPath = join(
    rootFixture.operationRoot,
    `${rootFixture.operationIdentity.operationId}.receipt.json`,
  );
  await writeFile(receiptPath, "", { encoding: "utf8", mode: 0o600 });
  const journalBefore = await readFile(rootFixture.journalPath, "utf8");
  await rename(rootFixture.operationRoot, originalRoot);
  await mkdir(rootFixture.operationRoot, { mode: 0o700 });
  await assert.rejects(convergenceModule
    .restoreAmoraSuccessorStorageBucketApiReceiptReservationForRecovery({
      repoRoot: join(import.meta.dirname, "..", ".."),
      operationRoot: rootFixture.operationRoot,
      operationIdentity: rootFixture.operationIdentity,
      plan: rootFixture.plan,
      ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
    }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_RECOVERY_INVALID"));
  assert.equal(
    await readFile(join(
      originalRoot,
      `${rootFixture.operationIdentity.operationId}.journal.jsonl`,
    ), "utf8"),
    journalBefore,
  );
  assert.deepEqual(rootFixture.mutations, []);
});

linuxMutationTest("only an unchanged empty same-process reservation can abort before a prepared journal", async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const fixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
  const parentSyncs = [];
  const reservation = await convergenceModule
    .createAmoraSuccessorStorageBucketApiReceiptReservation({
      repoRoot: join(import.meta.dirname, "..", ".."),
      operationRoot: fixture.operationRoot,
      operationIdentity: fixture.operationIdentity,
      plan: fixture.plan,
      ...(HOST_PLATFORM === "win32" ? {
        syncParentDirectoryImpl: async () => { parentSyncs.push("sync"); },
      } : {}),
    });
  assert.equal(typeof reservation.abortEmpty, "function");
  fixture.setInspectorResponseMode("wrong_nonce");
  await assert.rejects(convergenceModule.runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: reservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_PREFLIGHT_FAILED"));
  const receiptPath = join(
    fixture.operationRoot,
    `${fixture.operationIdentity.operationId}.receipt.json`,
  );
  assert.equal((await stat(receiptPath)).size, 0);
  await reservation.abortEmpty();
  assert.equal(await pathExists(receiptPath), false);
  assert.equal(await pathExists(fixture.journalPath), false);
  if (HOST_PLATFORM === "win32") assert.deepEqual(parentSyncs, ["sync", "sync"]);

  for (const variant of ["nonempty", "changed inode"]) {
    const changedFixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
    const changedReservation = await convergenceModule
      .createAmoraSuccessorStorageBucketApiReceiptReservation({
        repoRoot: join(import.meta.dirname, "..", ".."),
        operationRoot: changedFixture.operationRoot,
        operationIdentity: changedFixture.operationIdentity,
        plan: changedFixture.plan,
        ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
      });
    const changedPath = join(
      changedFixture.operationRoot,
      `${changedFixture.operationIdentity.operationId}.receipt.json`,
    );
    let originalPath = changedPath;
    if (variant === "nonempty") {
      await writeFile(changedPath, "changed", "utf8");
    } else {
      originalPath = `${changedPath}.original`;
      await rename(changedPath, originalPath);
      await writeFile(changedPath, "", { encoding: "utf8", mode: 0o600 });
    }
    const before = await readFile(changedPath, "utf8");
    await assert.rejects(
      changedReservation.abortEmpty(),
      assertConvergenceError(variant === "nonempty"
        ? "STORAGE_BUCKET_API_RECEIPT_ABORT_REJECTED"
        : "STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID"),
      variant,
    );
    assert.equal(await readFile(changedPath, "utf8"), before, variant);
    assert.equal(await pathExists(originalPath), true, variant);
    assert.deepEqual(changedFixture.mutations, [], variant);
    if (variant === "nonempty") {
      await writeFile(changedPath, "", "utf8");
    } else {
      await unlink(changedPath);
      await rename(originalPath, changedPath);
    }
    await changedReservation.abortEmpty();
  }
});

test("receipt setup parent-sync failure removes only its newly created empty inode", {
  skip: HOST_PLATFORM !== "win32",
}, async () => {
  const convergenceModule = await import(
    "../lib/amora-successor-storage-staging-convergence.mjs"
  );
  const repoRoot = join(import.meta.dirname, "..", "..");
  const operationRoot = await mkdtemp(join(tmpdir(), "amora-receipt-sync-failure-"));
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const operationId = "79797979-7979-4797-8797-797979797979";
  const operationIdentity = activeBucketOperationIdentity(plan, operationId, {
    operationRoot,
  });
  const receiptPath = join(
    operationRoot,
    `${operationId}.receipt.json`,
  );
  const journalPath = join(operationRoot, `${operationId}.journal.jsonl`);
  await assert.rejects(convergenceModule
    .createAmoraSuccessorStorageBucketApiReceiptReservation({
      repoRoot,
      operationRoot,
      operationIdentity,
      plan,
      syncParentDirectoryImpl: async () => { throw new Error("parent sync failed"); },
    }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_RESERVATION_FAILED"));
  assert.equal(await pathExists(receiptPath), false);
  assert.equal(await pathExists(journalPath), false);
});

linuxMutationTest("receipt reservation failure and abort paths are file-descriptor-warning-free", () => {
  const child = spawnSync(process.execPath, [
    "--test",
    "--test-name-pattern=only an unchanged empty same-process reservation",
    join(import.meta.dirname, "amora-successor-storage-staging-convergence.test.mjs"),
  ], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.doesNotMatch(
    child.stderr,
    /Closing file descriptor|DEP0137|FileHandle object on garbage collection/u,
  );
});

test("renaming and recreating an operation root after journal mint hard-stops create, read, append, and remove", async () => {
  const repoRoot = join(import.meta.dirname, "..", "..");
  const plan = planAmoraSuccessorStorageBucketApiConvergence(baselineSnapshot());
  const preparedFor = (at) => ({
    journalVersion: 1,
    kind: "amora-successor-storage-bucket-api-journal-record",
    phase: "prepared",
    actionId: null,
    actionIndex: 0,
    attempt: 0,
    planSha256: plan.planSha256,
    at,
    observedOutcome: null,
  });

  const createRoot = await mkdtemp(join(tmpdir(), "amora-root-swap-create-"));
  const createBackup = `${createRoot}-original`;
  const createOperationId = "56565656-5656-4656-8656-565656565656";
  const createJournal = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot,
    operationRoot: createRoot,
    identity: bucketFileJournalIdentity(plan, createOperationId, createRoot),
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  await rename(createRoot, createBackup);
  await mkdir(createRoot, { mode: 0o700 });
  const createLease = await createJournal.acquireOperationLease();
  try {
    await assert.rejects(
      createJournal.append(preparedFor("2026-08-19T05:20:00.000Z")),
      assertConvergenceError("STORAGE_BUCKET_API_OPERATION_ROOT_CHANGED"),
    );
    assert.equal(
      await pathExists(join(createRoot, `${createOperationId}.journal.jsonl`)),
      false,
    );
    assert.equal(
      await pathExists(join(createBackup, `${createOperationId}.journal.jsonl`)),
      false,
    );
  } finally {
    await createJournal.releaseOperationLease(createLease);
  }

  const ioRoot = await mkdtemp(join(tmpdir(), "amora-root-swap-existing-"));
  const backupRoot = `${ioRoot}-original`;
  const operationId = "45454545-4545-4545-8545-454545454545";
  const journalPath = join(ioRoot, `${operationId}.journal.jsonl`);
  const journal = createAmoraSuccessorStorageBucketApiFileJournal({
    repoRoot,
    operationRoot: ioRoot,
    identity: bucketFileJournalIdentity(plan, operationId, ioRoot),
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const initialLease = await journal.acquireOperationLease();
  await journal.append(preparedFor("2026-08-19T05:21:00.000Z"));
  await journal.releaseOperationLease(initialLease);
  const beforeBytes = await readFile(journalPath, "utf8");
  const beforeMetadata = await stat(journalPath);
  await rename(ioRoot, backupRoot);
  await mkdir(ioRoot, { mode: 0o700 });
  const lease = await journal.acquireOperationLease();
  try {
    const intent = bucketRecoveryRecord(plan, "intent", { actionIndex: 0 });
    for (const [name, action] of [
      ["read", () => journal.read()],
      ["append", () => journal.append(intent)],
      ["remove", () => journal.remove()],
    ]) {
      await assert.rejects(
        action(),
        assertConvergenceError("STORAGE_BUCKET_API_OPERATION_ROOT_CHANGED"),
        name,
      );
      const originalPath = join(backupRoot, `${operationId}.journal.jsonl`);
      const unchanged = await stat(originalPath);
      assert.equal(await readFile(originalPath, "utf8"), beforeBytes, name);
      assert.equal(unchanged.dev, beforeMetadata.dev, name);
      assert.equal(unchanged.ino, beforeMetadata.ino, name);
      assert.equal(await pathExists(join(ioRoot, `${operationId}.journal.jsonl`)), false, name);
    }
  } finally {
    await journal.releaseOperationLease(lease);
  }
});

test("the finalizer rejects an audit-shaped receipt that no verified runner or recovery issued", async () => {
  const {
    finalizeAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture({ withTransport: false });
  const lease = await fixture.journal.acquireOperationLease();
  const startedAt = Date.parse("2026-08-19T05:30:00.000Z");
  const record = ({ phase, actionIndex, sequence, observedOutcome = null }) => ({
    journalVersion: 1,
    kind: "amora-successor-storage-bucket-api-journal-record",
    phase,
    actionId: ["intent", "observed"].includes(phase)
      ? EXPECTED_BUCKET_API_ACTION_IDS[actionIndex]
      : null,
    actionIndex,
    attempt: phase === "prepared" ? 0 : 1,
    planSha256: fixture.plan.planSha256,
    at: new Date(startedAt + sequence * 1_000).toISOString(),
    observedOutcome,
  });
  await fixture.journal.append(record({
    phase: "prepared",
    actionIndex: 0,
    sequence: 0,
  }));
  for (const actionIndex of EXPECTED_BUCKET_API_ACTION_IDS.keys()) {
    await fixture.journal.append(record({
      phase: "intent",
      actionIndex,
      sequence: 1 + actionIndex * 2,
    }));
    await fixture.journal.append(record({
      phase: "observed",
      actionIndex,
      sequence: 2 + actionIndex * 2,
      observedOutcome: actionIndex === 0 ? "unknown" : "accepted",
    }));
  }
  await fixture.journal.releaseOperationLease(lease);

  const preterminalRecords = await fixture.journal.read();
  const capturedAt = "2026-08-19T05:40:00.000Z";
  const receiptCore = {
    receiptVersion: 1,
    kind: "amora-successor-storage-bucket-api-convergence",
    status: "bucket_configuration_converged_policy_pending",
    scope: "staging-storage-bucket-api-s0-to-s1-only",
    ...fixture.operationIdentity,
    capturedAt,
    actionCount: EXPECTED_BUCKET_API_ACTION_IDS.length,
    actionIds: [...EXPECTED_BUCKET_API_ACTION_IDS],
    authorizedDurableIntentSummary: EXPECTED_BUCKET_API_ACTION_IDS.map(
      (actionId, actionIndex) => ({
        actionId,
        intentCount: 1,
        observedOutcome: actionIndex === 0 ? "unknown" : "accepted",
      }),
    ),
    authorizationChainSha256: sha256Text(canonicalJson([])),
    authorizationTransitionCount: 0,
    recoveryApprovalSha256: null,
    journalChainSha256: sha256Text(canonicalJson(preterminalRecords)),
    planSha256: fixture.plan.planSha256,
    baselineObjectCount: fixture.plan.baselineObjectCount,
    baselineObjectInventorySha256: fixture.plan.baselineObjectInventorySha256,
    vendorSafety: fixture.plan.vendorSafety,
    finalSnapshotEvidence: {
      observedAt: "2026-08-19T05:39:59.000Z",
      canonicalFingerprintSha256:
        bucketApiCanonicalSnapshotFingerprint(bucketApiS1Snapshot()),
    },
    policyMutationPending: true,
    targetBucketContractSha256: fixture.plan.targetBucketContractSha256,
    effects: {
      authorizedDurableIntentCount: 11,
      acceptedObservedOutcomeCount: 10,
      unknownObservedOutcomeCount: 1,
      policyMutations: 0,
      objectMutations: 0,
      productionMutations: 0,
    },
  };
  const receipt = {
    ...receiptCore,
    receiptSha256: sha256Text(canonicalJson(receiptCore)),
  };
  const terminalLease = await fixture.journal.acquireOperationLease();
  await fixture.journal.append({
    journalVersion: 1,
    kind: "amora-successor-storage-bucket-api-journal-record",
    phase: "verified_s1",
    actionId: null,
    actionIndex: EXPECTED_BUCKET_API_ACTION_IDS.length,
    attempt: 1,
    planSha256: fixture.plan.planSha256,
    at: capturedAt,
    observedOutcome: null,
    receiptSha256: receipt.receiptSha256,
  });
  await fixture.journal.releaseOperationLease(terminalLease);

  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(TEST_SERVICE_ROLE_KEY), false);
  assert.equal(serialized.includes(fixture.operationRoot), false);
  assert.doesNotMatch(serialized, /\/storage\/v1\//u);
  assert.doesNotMatch(
    serialized,
    /"(?:body|bucketId|headers|objectId|objectPath|requestId|responseId|userId)"\s*:/u,
  );
  const receiptPath = join(
    fixture.operationRoot,
    `${fixture.operationIdentity.operationId}.receipt.json`,
  );
  await assert.rejects(
    finalizeAmoraSuccessorStorageBucketApiConvergence({
      receipt,
      journal: fixture.journal,
      receiptReservation: fixture.receiptReservation,
    }),
    assertConvergenceError("STORAGE_BUCKET_API_FINALIZER_INVALID"),
  );
  assert.equal(await pathExists(fixture.journalPath), true);
  assert.equal((await stat(receiptPath)).size, 0);
  await fixture.receiptReservation.close();
});

linuxMutationTest("bucket completion persists its exact receipt before removing the verified recovery journal", async () => {
  const {
    createAmoraSuccessorStorageBucketApiReceiptReservation,
    finalizeAmoraSuccessorStorageBucketApiConvergence,
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  assert.equal(typeof finalizeAmoraSuccessorStorageBucketApiConvergence, "function");
  const failedFixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
  const failedReservation = await createAmoraSuccessorStorageBucketApiReceiptReservation({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: failedFixture.operationRoot,
    operationIdentity: failedFixture.operationIdentity,
    plan: failedFixture.plan,
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const failedReceipt = await runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: failedFixture.initialSnapshot,
    plan: failedFixture.plan,
    operationIdentity: failedFixture.operationIdentity,
    journal: failedFixture.journal,
    transport: failedFixture.transport,
    inspectSnapshot: failedFixture.inspectSnapshot,
    receiptReservation: failedReservation,
  });
  const failedReceiptPath = join(
    failedFixture.operationRoot,
    `${failedFixture.operationIdentity.operationId}.receipt.json`,
  );
  const movedReceiptPath = `${failedReceiptPath}.moved`;
  await rename(failedReceiptPath, movedReceiptPath);
  await writeFile(failedReceiptPath, "replacement", { encoding: "utf8", mode: 0o600 });
  await assert.rejects(finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt: failedReceipt,
    journal: failedFixture.journal,
    receiptReservation: failedReservation,
  }), assertConvergenceError("STORAGE_BUCKET_API_RECEIPT_WRITE_FAILED"));
  assert.equal(await pathExists(failedFixture.journalPath), true);
  assert.equal(await readFile(movedReceiptPath, "utf8"), "");
  assert.equal(await readFile(failedReceiptPath, "utf8"), "replacement");
  await unlink(failedReceiptPath);
  await rename(movedReceiptPath, failedReceiptPath);
  await finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt: failedReceipt,
    journal: failedFixture.journal,
    receiptReservation: failedReservation,
  });

  const fixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
  const reservation = await createAmoraSuccessorStorageBucketApiReceiptReservation({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: fixture.operationRoot,
    operationIdentity: fixture.operationIdentity,
    plan: fixture.plan,
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const receipt = await runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: reservation,
  });
  const finalized = await finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt,
    journal: fixture.journal,
    receiptReservation: reservation,
  });
  assert.equal(finalized.receiptSha256, receipt.receiptSha256);
  assert.equal(await pathExists(fixture.journalPath), false);
});

linuxMutationTest("bucket finalizer rejects self-hashed partial, extra, or journal-unbound receipts without persistence", async () => {
  const {
    createAmoraSuccessorStorageBucketApiReceiptReservation,
    finalizeAmoraSuccessorStorageBucketApiConvergence,
    runAmoraSuccessorStorageBucketApiConvergence,
  } = await import("../lib/amora-successor-storage-staging-convergence.mjs");
  const fixture = await createBucketApiRunnerFixture({ reserveReceipt: false });
  const reservation = await createAmoraSuccessorStorageBucketApiReceiptReservation({
    repoRoot: join(import.meta.dirname, "..", ".."),
    operationRoot: fixture.operationRoot,
    operationIdentity: fixture.operationIdentity,
    plan: fixture.plan,
    ...(HOST_PLATFORM === "win32" ? { syncParentDirectoryImpl: async () => {} } : {}),
  });
  const receipt = await runAmoraSuccessorStorageBucketApiConvergence({
    initialSnapshot: fixture.initialSnapshot,
    plan: fixture.plan,
    operationIdentity: fixture.operationIdentity,
    journal: fixture.journal,
    transport: fixture.transport,
    inspectSnapshot: fixture.inspectSnapshot,
    receiptReservation: reservation,
  });
  const forgedCores = [
    [(() => {
      const core = clone(receipt);
      delete core.receiptSha256;
      delete core.planSha256;
      core.forgedField = true;
      return core;
    })(), "STORAGE_BUCKET_API_FINALIZER_INVALID"],
    [(() => {
      const core = clone(receipt);
      delete core.receiptSha256;
      core.operationId = "55555555-5555-4555-8555-555555555555";
      return core;
    })(), "STORAGE_BUCKET_API_FINALIZER_INVALID"],
  ];
  for (const [core, expectedCode] of forgedCores) {
    const forged = { ...core, receiptSha256: sha256Text(canonicalJson(core)) };
    await assert.rejects(finalizeAmoraSuccessorStorageBucketApiConvergence({
      receipt: forged,
      journal: fixture.journal,
      receiptReservation: reservation,
    }), assertConvergenceError(expectedCode));
    assert.equal(await pathExists(fixture.journalPath), true);
  }
  await finalizeAmoraSuccessorStorageBucketApiConvergence({
    receipt,
    journal: fixture.journal,
    receiptReservation: reservation,
  });
});

test("the exact hosted 3-bucket/4-policy baseline produces a deterministic 12-action convergence plan", () => {
  const input = baselineSnapshot();
  const plan = planAmoraSuccessorStorageStagingConvergence(input);
  const reordered = clone(input);
  reordered.buckets.reverse();
  reordered.policies.reverse();
  for (const policy of reordered.policies) policy.roles.reverse();
  const reorderedPlan = planAmoraSuccessorStorageStagingConvergence(reordered);

  assert.equal(plan.status, "planned");
  assert.equal(plan.classification, "baseline");
  assert.equal(plan.actionCount, 12);
  assert.deepEqual(plan.actions.map((action) => action.id), EXPECTED_ACTION_IDS);
  assert.match(plan.planSha256, /^[a-f0-9]{64}$/u);
  assert.equal(reorderedPlan.planSha256, plan.planSha256);
  assert.deepEqual(reorderedPlan.actions, plan.actions);

  const changedObjects = baselineSnapshot();
  changedObjects.buckets.find((entry) => entry.id === "vendor-images").objectCount = 4;
  changedObjects.buckets.find((entry) => entry.id === "vendor-images")
    .objectInventorySha256 = "7".repeat(64);
  changedObjects.totalObjectCount = 924;
  changedObjects.objectInventorySha256 = "8".repeat(64);
  assert.notEqual(
    planAmoraSuccessorStorageStagingConvergence(changedObjects).planSha256,
    plan.planSha256,
    "the plan hash must bind the fresh object aggregates",
  );
});

test("the exact 13-bucket/5-policy target is an idempotent no-op", () => {
  const plan = planAmoraSuccessorStorageStagingConvergence(targetSnapshot());

  assert.deepEqual({
    status: plan.status,
    classification: plan.classification,
    actionCount: plan.actionCount,
    actionIds: plan.actions.map((action) => action.id),
  }, {
    status: "already_converged",
    classification: "target",
    actionCount: 0,
    actionIds: [],
  });
  assert.match(plan.planSha256, /^[a-f0-9]{64}$/u);
});

test("unknown catalog drift, helper drift, and unsafe vendor objects fail closed", () => {
  const cases = [
    ["unknown bucket", (snapshot) => snapshot.buckets.push(bucket({ id: "unknown-live-bucket", isPublic: false, fileSizeLimit: null, allowedMimeTypes: null, objectCount: 0, objectInventorySha256: "5".repeat(64) })), "CONVERGENCE_STATE_AMBIGUOUS"],
    ["unknown policy", (snapshot) => snapshot.policies.push({ name: "unexpected_storage_reader", permissive: "PERMISSIVE", roles: ["anon"], command: "SELECT", expressionSha256: "6".repeat(64) }), "CONVERGENCE_STATE_AMBIGUOUS"],
    ["relation owner", (snapshot) => { snapshot.relationOwner = "postgres"; }, "CONVERGENCE_STATE_AMBIGUOUS"],
    ["RLS disabled", (snapshot) => { snapshot.relationRlsEnabled = false; }, "CONVERGENCE_STATE_AMBIGUOUS"],
    ["FORCE RLS enabled", (snapshot) => { snapshot.relationForceRls = true; }, "CONVERGENCE_STATE_AMBIGUOUS"],
    ["temporary fence returned", (snapshot) => { snapshot.fence.triggerNames = ["trg_production_write_fence_20260717"]; snapshot.fence.productionStorageWritesAllowed = false; }, "CONVERGENCE_STATE_AMBIGUOUS"],
    ["helper source/config/ACL contract", (snapshot) => { snapshot.helperContracts.accountDeletionStorageWritesAllowed.contractVerified = false; }, "HELPER_CONTRACT_DRIFT"],
    ["helper source digest", (snapshot) => { snapshot.helperContracts.isCurrentCouplePathMember.sourceSha256 = "9".repeat(64); }, "HELPER_CONTRACT_DRIFT"],
    ["hosted storage-admin capability", (snapshot) => { snapshot.readOnlyPrincipalCanSetStorageAdmin = false; }, "HOSTED_STORAGE_ADMIN_CAPABILITY_MISSING"],
    ["vendor object over limit", (snapshot) => { snapshot.buckets.find((entry) => entry.id === "vendor-images").oversizeObjectCount = 1; }, "VENDOR_OBJECTS_UNSAFE"],
    ["vendor disallowed MIME", (snapshot) => { snapshot.buckets.find((entry) => entry.id === "vendor-images").disallowedMimeObjectCount = 1; }, "VENDOR_OBJECTS_UNSAFE"],
    ["vendor unknown metadata", (snapshot) => { snapshot.buckets.find((entry) => entry.id === "vendor-images").missingMetadataObjectCount = 1; }, "VENDOR_OBJECTS_UNSAFE"],
  ];

  for (const [name, mutate, code] of cases) {
    const snapshot = baselineSnapshot();
    mutate(snapshot);
    assert.throws(() => planAmoraSuccessorStorageStagingConvergence(snapshot), assertConvergenceError(code), name);
  }
});

test("baseline, target, and every other hosted outcome are classified without guessing", () => {
  const ambiguous = baselineSnapshot();
  ambiguous.buckets.find((entry) => entry.id === "vendor-images").fileSizeLimit = 1;
  const helperDrift = baselineSnapshot();
  helperDrift.helperContracts.isCurrentCouplePathMember.contractVerified = false;

  assert.deepEqual([
    classifyAmoraSuccessorStorageStagingConvergenceOutcome(baselineSnapshot()),
    classifyAmoraSuccessorStorageStagingConvergenceOutcome(targetSnapshot()),
    classifyAmoraSuccessorStorageStagingConvergenceOutcome(ambiguous),
    classifyAmoraSuccessorStorageStagingConvergenceOutcome(helperDrift),
  ], ["baseline", "target", "ambiguous", "ambiguous"]);
});

test("the planning query is read-only and binds per-bucket object safety plus all three helper contracts", () => {
  const requiredFragments = [
    "bucket_object_count", "bucket_object_inventory_sha256", "oversize_object_count",
    "disallowed_mime_object_count", "missing_metadata_object_count", "total_object_count",
    "object_inventory_sha256", "read_only_principal_can_set_storage_admin",
    "production_storage_writes_allowed",
    "account_deletion_storage_writes_allowed", "is_current_couple_path_member",
    PRODUCTION_STORAGE_FENCE_SOURCE_SHA256, ACCOUNT_DELETION_STORAGE_FENCE_SOURCE_SHA256,
    CURRENT_COUPLE_PATH_SOURCE_SHA256, "pg_catalog.aclexplode", "proconfig", "proowner", "prolang",
  ];
  for (const fragment of requiredFragments) {
    assert.ok(STORAGE_STAGING_CONVERGENCE_PLAN_SQL.includes(fragment), `missing plan-query contract: ${fragment}`);
  }
  assert.doesNotMatch(
    STORAGE_STAGING_CONVERGENCE_PLAN_SQL,
    /\b(?:INSERT\s+INTO|UPDATE\s+storage\.|DELETE\s+FROM|CREATE\s+(?:POLICY|TABLE|FUNCTION)|DROP\s+|ALTER\s+)\b/iu,
  );
});

test("the static apply SQL is one locked exact-baseline-to-exact-target transaction with only 12 allowlisted actions", () => {
  assert.match(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /^BEGIN;/u);
  assert.match(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /COMMIT;\s*$/u);
  assert.match(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /pg_catalog\.pg_advisory_xact_lock\s*\(/iu);
  assert.match(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /STORAGE_CONVERGENCE_BASELINE_(?:INVALID|DRIFT)/u);
  assert.match(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /STORAGE_CONVERGENCE_TARGET_(?:INVALID|DRIFT)/u);
  for (const bucketId of CREATE_BUCKET_IDS) {
    assert.ok(STORAGE_STAGING_CONVERGENCE_APPLY_SQL.includes(`'${bucketId}'`), bucketId);
  }
  assert.match(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /UPDATE\s+storage\.buckets[\s\S]*WHERE\s+id\s*=\s*'vendor-images'/iu);
  assert.match(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /CREATE\s+POLICY\s+"chat-image own uploader folder write pf46ue_0"[\s\S]*FOR\s+INSERT\s+TO\s+authenticated/iu);
  assert.equal((STORAGE_STAGING_CONVERGENCE_APPLY_SQL.match(/\bCREATE\s+POLICY\b/giu) ?? []).length, 1);
  assert.doesNotMatch(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /\b(?:DROP\s+POLICY|DELETE\s+FROM\s+storage\.objects|UPDATE\s+storage\.objects|TRUNCATE|emptyBucket)\b/iu);
  assert.doesNotMatch(STORAGE_STAGING_CONVERGENCE_APPLY_SQL, /CREATE\s+POLICY[\s\S]*?FOR\s+(?:SELECT|UPDATE|DELETE)\b/iu);
});

test("Windows denies every hosted mutation mode before a caller can create side effects", () => {
  assert.throws(
    () => assertAmoraSuccessorStorageStagingConvergenceMutationPlatform("win32"),
    assertConvergenceError("HOSTED_MUTATION_PLATFORM_UNSUPPORTED"),
  );
  assert.doesNotThrow(() => assertAmoraSuccessorStorageStagingConvergenceMutationPlatform("linux"));
  assert.throws(
    () => assertAmoraSuccessorStorageStagingConvergenceMutationPlatform("darwin"),
    assertConvergenceError("HOSTED_MUTATION_PLATFORM_UNSUPPORTED"),
  );
});

test("hosted bucket mutation entry points use the real process platform and expose no caller override", async () => {
  const source = await readFile(join(
    import.meta.dirname,
    "..",
    "lib",
    "amora-successor-storage-staging-convergence.mjs",
  ), "utf8");
  for (const exportName of [
    "runAmoraSuccessorStorageBucketApiConvergence",
    "recoverAmoraSuccessorStorageBucketApiConvergence",
    "createAmoraSuccessorStorageBucketApiTransport",
  ]) {
    const start = source.indexOf(`export ${exportName.startsWith("run") || exportName.startsWith("recover") ? "async " : ""}function ${exportName}`);
    assert.ok(start >= 0, exportName);
    const boundary = source.indexOf("\n}\n", start);
    const body = source.slice(start, boundary + 3);
    assert.match(body, /assertAmoraSuccessorStorageStagingConvergenceMutationPlatform\(/u);
    assert.doesNotMatch(body.slice(0, body.indexOf("}) {") + 4), /runtimePlatform/u);
  }

  for (const artifactFactory of [
    "createAmoraSuccessorStorageBucketApiFileJournal",
    "createAmoraSuccessorStorageBucketApiReceiptReservation",
    "restoreAmoraSuccessorStorageBucketApiReceiptReservationForRecovery",
  ]) {
    const start = source.indexOf(`export ${artifactFactory.includes("Receipt") ? "async " : ""}function ${artifactFactory}`);
    assert.ok(start >= 0, artifactFactory);
    const boundary = source.indexOf("\n}\n", start);
    assert.doesNotMatch(
      source.slice(start, boundary + 3),
      /assertAmoraSuccessorStorageStagingConvergenceMutationPlatform\(/u,
      artifactFactory,
    );
  }
  assert.match(
    source,
    /process\.report\.getReport\(\)\.header\.platform/u,
    "native mutation gating must not trust a mutable process.platform property",
  );

  if (HOST_PLATFORM === "win32") {
    const libUrl = pathToFileURL(join(
      import.meta.dirname,
      "..",
      "lib",
      "amora-successor-storage-staging-convergence.mjs",
    )).href;
    const childSource = `
const nativePlatform = process.report.getReport().header.platform;
Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
const module = await import(${JSON.stringify(libUrl)});
const effects = { fetches: 0, inspectorCalls: 0, journalCalls: 0 };
const dependency = new Proxy({}, {
  get() { effects.journalCalls += 1; return async () => {}; },
});
const codes = {};
for (const [name, call] of [
  ["run", () => module.runAmoraSuccessorStorageBucketApiConvergence({
    journal: dependency,
    inspectSnapshot: async () => { effects.inspectorCalls += 1; },
  })],
  ["recover", () => module.recoverAmoraSuccessorStorageBucketApiConvergence({
    journal: dependency,
    inspectSnapshot: async () => { effects.inspectorCalls += 1; },
  })],
  ["transport", async () => module.createAmoraSuccessorStorageBucketApiTransport({
    projectRef: ${JSON.stringify(STAGING_REF)},
    productionProjectRef: ${JSON.stringify(PRODUCTION_REF)},
    serviceRoleKey: "x".repeat(40),
    fetchImpl: async () => { effects.fetches += 1; return new Response(); },
  })],
]) {
  try { await call(); codes[name] = "accepted"; }
  catch (error) { codes[name] = error?.code ?? error?.name ?? "missing"; }
}
process.stdout.write(JSON.stringify({
  nativePlatform,
  spoofedPlatform: process.platform,
  codes,
  effects,
}));
`;
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      childSource,
    ], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      nativePlatform: "win32",
      spoofedPlatform: "linux",
      codes: {
        run: "HOSTED_MUTATION_PLATFORM_UNSUPPORTED",
        recover: "HOSTED_MUTATION_PLATFORM_UNSUPPORTED",
        transport: "HOSTED_MUTATION_PLATFORM_UNSUPPORTED",
      },
      effects: { fetches: 0, inspectorCalls: 0, journalCalls: 0 },
    });
  }
});

test("a convergence receipt contains only bounded hashes, aggregate counts, and action identifiers", () => {
  const plan = planAmoraSuccessorStorageStagingConvergence(baselineSnapshot());
  const receipt = createAmoraSuccessorStorageStagingConvergenceReceipt({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    discoveryGitCommit: DISCOVERY_COMMIT,
    convergenceToolGitCommit: COMMIT,
    discoveryReceiptSha256: DISCOVERY_RECEIPT_SHA256,
    observedAt: "2026-08-19T03:00:00.000Z",
    plan,
  });
  const serialized = JSON.stringify(receipt);

  assert.equal(receipt.status, "planned_read_only");
  assert.equal(receipt.projectRef, STAGING_REF);
  assert.equal(receipt.discoveryGitCommit, DISCOVERY_COMMIT);
  assert.equal(receipt.convergenceToolGitCommit, COMMIT);
  assert.equal(receipt.actionCount, 12);
  assert.deepEqual(receipt.actionIds, EXPECTED_ACTION_IDS);
  assert.equal(receipt.planSha256, plan.planSha256);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(receipt.effects, {
    managementReadOnlyRequests: 1,
    databaseMutations: 0,
    storageMutations: 0,
    authMutations: 0,
    productionMutations: 0,
  });
  assert.deepEqual(receipt.evidence, {
    containsSecrets: false,
    containsRawSql: false,
    containsRawPolicyExpressions: false,
    containsFunctionSource: false,
    containsObjectPaths: false,
  });
  for (const forbidden of ["managementToken", "accessToken", "rawSql", "objectPaths", "WITH CHECK", "CREATE POLICY"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.ok(Buffer.byteLength(serialized, "utf8") < 32 * 1024);
});

test("discovery receipt schema drift is rejected before any Management fetch", async () => {
  const cases = [
    ["database mutation", (receipt) => { receipt.effects.databaseMutations = 1; }],
    ["unknown secret effect", (receipt) => {
      receipt.effects.managementToken = "secret-that-must-never-be-accepted";
    }],
    ["inventory object paths", (receipt) => {
      receipt.inventory.objectPaths = ["private/object-name.png"];
    }],
    ["invalid capture time", (receipt) => { receipt.capturedAt = "not-a-date"; }],
    ["unknown top-level key", (receipt) => { receipt.unexpected = true; }],
  ];
  const observed = [];
  for (const [name, mutate] of cases) {
    const receipt = validDiscoveryReceipt();
    mutate(receipt);
    const config = convergenceConfigForReceipt(receipt);
    let validationCode = "accepted";
    try {
      validateAmoraSuccessorStorageStagingConvergencePlanConfig(config);
    } catch (error) {
      validationCode = error?.code;
    }
    let fetchCount = 0;
    let runCode = "accepted";
    try {
      await runAmoraSuccessorStorageStagingConvergencePlan({
        config,
        fetchImpl: async () => {
          fetchCount += 1;
          return new Response(JSON.stringify([planningManagementRow()]), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        },
      });
    } catch (error) {
      runCode = error?.code;
    }
    observed.push({ name, validationCode, runCode, fetchCount });
  }

  assert.deepEqual(observed, cases.map(([name]) => ({
    name,
    validationCode: "DISCOVERY_RECEIPT_INVALID",
    runCode: "DISCOVERY_RECEIPT_INVALID",
    fetchCount: 0,
  })));
});

test("direct library planning rejects fake Production or approved refs before fetch", async () => {
  const cases = [
    [
      "fake Production ref",
      { productionProjectRef: "abcdefghijklmnopqrst" },
      "PRODUCTION_PROJECT_PIN_MISMATCH",
    ],
    [
      "fake approved staging ref",
      { approvedProjectRef: "abcdefghijklmnopqrst" },
      "STAGING_PROJECT_PIN_MISMATCH",
    ],
  ];
  const observed = [];
  for (const [name, overrides, expectedCode] of cases) {
    const config = {
      ...convergenceConfigForReceipt(validDiscoveryReceipt()),
      ...overrides,
    };
    let validationCode = "accepted";
    try {
      validateAmoraSuccessorStorageStagingConvergencePlanConfig(config);
    } catch (error) {
      validationCode = error?.code;
    }
    let fetchCount = 0;
    let runCode = "accepted";
    try {
      await inspectAmoraSuccessorStorageStagingConvergencePlan({
        config,
        fetchImpl: async () => {
          fetchCount += 1;
          throw new Error("fetch must not run");
        },
      });
    } catch (error) {
      runCode = error?.code;
    }
    observed.push({ name, validationCode, runCode, fetchCount, expectedCode });
  }
  assert.deepEqual(observed, cases.map(([name, , expectedCode]) => ({
    name,
    validationCode: expectedCode,
    runCode: expectedCode,
    fetchCount: 0,
    expectedCode,
  })));
});

test("Management response bounds reject declared or streamed overflow without whole-body buffering", async () => {
  const config = convergenceConfigForReceipt(validDiscoveryReceipt());
  let declaredTextCalls = 0;
  let declaredCode = "accepted";
  try {
    await inspectAmoraSuccessorStorageStagingConvergencePlan({
      config,
      fetchImpl: async () => ({
        status: 201,
        headers: new Headers({ "content-length": String(512 * 1024 + 1) }),
        body: null,
        async text() {
          declaredTextCalls += 1;
          return "[]";
        },
      }),
    });
  } catch (error) {
    declaredCode = error?.code;
  }

  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let bytesPulled = 0;
  let cancelled = false;
  let streamedTextCalls = 0;
  const body = new ReadableStream({
    pull(controller) {
      bytesPulled += chunk.byteLength;
      controller.enqueue(chunk);
      if (bytesPulled >= 640 * 1024) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  let streamedCode = "accepted";
  try {
    await inspectAmoraSuccessorStorageStagingConvergencePlan({
      config,
      fetchImpl: async () => ({
        status: 201,
        headers: new Headers(),
        body,
        async text() {
          streamedTextCalls += 1;
          return "x".repeat(512 * 1024 + 1);
        },
      }),
    });
  } catch (error) {
    streamedCode = error?.code;
  }
  assert.deepEqual({
    declaredCode,
    declaredTextCalls,
    streamedCode,
    streamedTextCalls,
    cancelled,
    readAtLeastLimit: bytesPulled >= 512 * 1024,
    boundedPull: bytesPulled <= 576 * 1024,
  }, {
    declaredCode: "STORAGE_CONVERGENCE_PLAN_UNAVAILABLE",
    declaredTextCalls: 0,
    streamedCode: "STORAGE_CONVERGENCE_PLAN_UNAVAILABLE",
    streamedTextCalls: 0,
    cancelled: true,
    readAtLeastLimit: true,
    boundedPull: true,
  });
});

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createCliRepositoryFixture({ trackTestFile = true } = {}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "amora-convergence-cli-repo-"));
  const scriptsRoot = join(repoRoot, "scripts");
  const libRoot = join(scriptsRoot, "lib");
  const testsRoot = join(scriptsRoot, "tests");
  const contractRoot = join(repoRoot, "supabase", "release-contracts");
  await Promise.all([
    mkdir(libRoot, { recursive: true }),
    mkdir(testsRoot, { recursive: true }),
    mkdir(contractRoot, { recursive: true }),
  ]);
  const canonicalScriptsRoot = join(import.meta.dirname, "..");
  const cliPath = join(scriptsRoot, "amora-successor-storage-staging-convergence.mjs");
  const convergenceLibPath = join(
    libRoot,
    "amora-successor-storage-staging-convergence.mjs",
  );
  const probeLibPath = join(libRoot, "amora-successor-storage-staging-probe.mjs");
  const destinationVerifierPath = join(libRoot, "supabase-service-destination.mjs");
  const testPath = join(
    testsRoot,
    "amora-successor-storage-staging-convergence.test.mjs",
  );
  await Promise.all([
    copyFile(
      join(canonicalScriptsRoot, "amora-successor-storage-staging-convergence.mjs"),
      cliPath,
    ),
    copyFile(
      join(canonicalScriptsRoot, "lib", "amora-successor-storage-staging-convergence.mjs"),
      convergenceLibPath,
    ),
    copyFile(
      join(canonicalScriptsRoot, "lib", "amora-successor-storage-staging-probe.mjs"),
      probeLibPath,
    ),
    copyFile(
      join(canonicalScriptsRoot, "lib", "supabase-service-destination.mjs"),
      destinationVerifierPath,
    ),
    copyFile(
      join(
        canonicalScriptsRoot,
        "..",
        "supabase",
        "release-contracts",
        "amora-successor-storage-bucket-api-staging-v1.json",
      ),
      join(contractRoot, "amora-successor-storage-bucket-api-staging-v1.json"),
    ),
    writeFile(
      join(
        contractRoot,
        "vendor-disclosure-hosted-staging-v2-20260718.json",
      ),
      `${JSON.stringify({
        approved: true,
        status: "approved_for_hosted_rls_probe",
        projectRef: STAGING_REF,
      })}\n`,
      "utf8",
    ),
  ]);
  if (trackTestFile) {
    await copyFile(import.meta.filename, testPath);
  }
  const git = (args) => execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  git(["init", "-b", "main"]);
  git(["add", "--all"]);
  git(["-c", "user.name=Amora Test", "-c", "user.email=amora@test.invalid", "commit", "-m", "test fixture"]);
  git(["remote", "add", "origin", "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(["branch", "--set-upstream-to=origin/main", "main"]);
  if (!trackTestFile) {
    await copyFile(import.meta.filename, testPath);
  }
  return {
    repoRoot,
    cliPath,
    expectedCommit: git(["rev-parse", "HEAD"]).trim(),
  };
}

async function spawnCliPlan({ fixture, receiptOut }) {
  const ioRoot = await mkdtemp(join(tmpdir(), "amora-convergence-cli-io-"));
  const discoveryReceiptRaw = JSON.stringify(validDiscoveryReceipt());
  const discoveryReceiptPath = join(ioRoot, "discovery.json");
  const responsePath = join(ioRoot, "management-response.json");
  const preloadPath = join(ioRoot, "fetch-preload.mjs");
  const fetchSentinel = join(ioRoot, "fetch-called.txt");
  await Promise.all([
    writeFile(discoveryReceiptPath, discoveryReceiptRaw, "utf8"),
    writeFile(
      responsePath,
      JSON.stringify([planningManagementRow()]),
      "utf8",
    ),
    writeFile(preloadPath, `
      import { appendFileSync, readFileSync } from "node:fs";
      globalThis.fetch = async () => {
        appendFileSync(process.env.AMORA_TEST_FETCH_SENTINEL, "fetch\\n");
        return new Response(
          readFileSync(process.env.AMORA_TEST_RESPONSE_PATH, "utf8"),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      };
    `, "utf8"),
  ]);
  const result = spawnSync(process.execPath, [fixture.cliPath, "--plan"], {
    cwd: fixture.repoRoot,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
      AMORA_STAGING_STORAGE_CONVERGENCE_EXPECTED_COMMIT:
        fixture.expectedCommit,
      AMORA_STAGING_STORAGE_DISCOVERY_RECEIPT_IN: discoveryReceiptPath,
      AMORA_STAGING_STORAGE_DISCOVERY_RECEIPT_SHA256:
        sha256Text(discoveryReceiptRaw),
      AMORA_STAGING_STORAGE_CONVERGENCE_PLAN_RECEIPT_OUT: receiptOut,
      AMORA_STAGING_PROJECT_REF: STAGING_REF,
      SUPABASE_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
      SUPABASE_ACCESS_TOKEN:
        "management-token-that-must-never-cross-the-test-boundary",
      AMORA_TEST_FETCH_SENTINEL: fetchSentinel,
      AMORA_TEST_RESPONSE_PATH: responsePath,
    },
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    fetched: await pathExists(fetchSentinel),
  };
}

test("CLI mutation modes stop before environment or network access", () => {
  const cliPath = join(
    import.meta.dirname,
    "..",
    "amora-successor-storage-staging-convergence.mjs",
  );
  const observed = ["--apply", "--recover", "--compensate"].map((flag) => {
    const result = spawnSync(process.execPath, [cliPath, flag], {
      cwd: join(import.meta.dirname, "..", ".."),
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    return {
      flag,
      status: result.status,
      stderr: result.stderr.trim(),
      stdout: result.stdout,
    };
  });
  assert.deepEqual(observed, ["--apply", "--recover", "--compensate"].map(
    (flag) => ({
      flag,
      status: 1,
      stderr: "STORAGE_CONVERGENCE_MUTATION_APPROVAL_MISSING",
      stdout: "",
    }),
  ));
});

test("the inactive repository bucket contract closes every bucket mutation mode before required env or network", async () => {
  const repoRoot = join(import.meta.dirname, "..", "..");
  const contract = JSON.parse(await readFile(join(
    repoRoot,
    "supabase",
    "release-contracts",
    "amora-successor-storage-bucket-api-staging-v1.json",
  ), "utf8"));
  assert.deepEqual({
    contractVersion: contract.contractVersion,
    kind: contract.kind,
    scope: contract.scope,
    status: contract.status,
    approved: contract.approved,
    projectRef: contract.projectRef,
    productionProjectRef: contract.productionProjectRef,
    authorizedModes: contract.authorizedModes,
    approvalPins: [
      contract.approvedAt,
      contract.expiresAt,
      contract.approvedGitCommit,
      contract.approvedPlanSha256,
    ],
    targetBucketContractSha256: contract.targetBucketContractSha256,
    mutationAuthorization: contract.mutationAuthorization,
    explicitNonAuthorization: /does not authorize any hosted mutation/iu
      .test(contract.notice),
  }, {
    contractVersion: 1,
    kind: "amora-successor-storage-bucket-api-staging-v1",
    scope: "staging-storage-bucket-api-s0-to-s1-only",
    status: "inactive_not_authorized",
    approved: false,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    authorizedModes: [],
    approvalPins: [null, null, null, null],
    targetBucketContractSha256:
      "dc029b4b56e4788c66a1d934403b9dcb1ab961d665fd0bd2c40bc4ae9aea1bc6",
    mutationAuthorization: {
      authorized: false,
      reason: "USER_MUTATION_APPROVAL_NOT_RECORDED",
    },
    explicitNonAuthorization: true,
  });

  const ioRoot = await mkdtemp(join(tmpdir(), "amora-bucket-contract-closed-"));
  const fetchSentinel = join(ioRoot, "fetch-called.txt");
  const preloadPath = join(ioRoot, "fetch-preload.mjs");
  await writeFile(preloadPath, `
    import { appendFileSync } from "node:fs";
    globalThis.fetch = async () => {
      appendFileSync(process.env.AMORA_TEST_FETCH_SENTINEL, "fetch\\n");
      throw new Error("network forbidden");
    };
  `, "utf8");
  const cliPath = join(
    import.meta.dirname,
    "..",
    "amora-successor-storage-staging-convergence.mjs",
  );
  const flags = ["--apply-buckets", "--recover-buckets", "--compensate-buckets"];
  const observed = flags.map((flag) => {
    const result = spawnSync(process.execPath, [cliPath, flag], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
        AMORA_TEST_FETCH_SENTINEL: fetchSentinel,
      },
    });
    return {
      flag,
      status: result.status,
      stderr: result.stderr.trim(),
      stdout: result.stdout,
    };
  });
  assert.deepEqual(observed, flags.map((flag) => ({
    flag,
    status: 1,
    stderr: "STORAGE_BUCKET_API_MUTATION_APPROVAL_MISSING",
    stdout: "",
  })));
  assert.equal(await pathExists(fetchSentinel), false);
});

test("CLI source binds all three executable files to tracked HEAD blobs and bounds discovery bytes before reading", async () => {
  const source = await readFile(join(
    import.meta.dirname,
    "..",
    "amora-successor-storage-staging-convergence.mjs",
  ), "utf8");
  const pinnedPaths = [
    "scripts/amora-successor-storage-staging-convergence.mjs",
    "scripts/lib/amora-successor-storage-staging-convergence.mjs",
    "scripts/tests/amora-successor-storage-staging-convergence.test.mjs",
  ];
  assert.deepEqual({
    allPinnedPathsPresent: pinnedPaths.every((path) => source.includes(path)),
    trackedBlobInspectionPresent:
      /(?:ls-files|cat-file|show\s+HEAD:|hash-object)/u.test(source),
    sixtyFourKiBLimitPresent: /64\s*\*\s*1024/u.test(source),
    receiptStatGatePresent:
      /(?:lstat|\.stat)\s*\(/u.test(source),
    boundedReceiptReadPresent: /\.read\s*\(/u.test(source),
    directUnboundedReceiptReadAbsent:
      !/readFile\s*\(\s*discoveryReceiptPath\s*,\s*["']utf8["']\s*\)/u
        .test(source),
  }, {
    allPinnedPathsPresent: true,
    trackedBlobInspectionPresent: true,
    sixtyFourKiBLimitPresent: true,
    receiptStatGatePresent: true,
    boundedReceiptReadPresent: true,
    directUnboundedReceiptReadAbsent: true,
  });
});

test("an untracked convergence test blob is rejected before the CLI fetch boundary", async () => {
  const fixture = await createCliRepositoryFixture({ trackTestFile: false });
  const receiptRoot = await mkdtemp(join(tmpdir(), "amora-untracked-receipt-"));
  const result = await spawnCliPlan({
    fixture,
    receiptOut: join(receiptRoot, "plan.json"),
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /CONVERGENCE_TOOL_(?:NOT_TRACKED|BLOB_MISMATCH)/u,
  );
  assert.equal(result.fetched, false);
});

test("CLI plan performs one read-only fetch and writes the exact reserved receipt", async () => {
  const fixture = await createCliRepositoryFixture();
  const outputRoot = await mkdtemp(join(tmpdir(), "amora-plan-receipt-success-"));
  const receiptOut = join(outputRoot, "plan.json");
  const result = await spawnCliPlan({ fixture, receiptOut });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.fetched, true);

  const stdout = JSON.parse(result.stdout);
  const receipt = JSON.parse(await readFile(receiptOut, "utf8"));
  assert.deepEqual({
    stdoutStatus: stdout.status,
    receiptStatus: receipt.status,
    actionCount: receipt.actionCount,
    actionIds: receipt.actionIds,
    stdoutPlanSha256: stdout.planSha256,
    receiptPlanSha256: receipt.planSha256,
    stdoutReceiptSha256: stdout.receiptSha256,
    receiptReceiptSha256: receipt.receiptSha256,
    effects: receipt.effects,
  }, {
    stdoutStatus: "planned_read_only",
    receiptStatus: "planned_read_only",
    actionCount: 12,
    actionIds: EXPECTED_ACTION_IDS,
    stdoutPlanSha256: receipt.planSha256,
    receiptPlanSha256: receipt.planSha256,
    stdoutReceiptSha256: receipt.receiptSha256,
    receiptReceiptSha256: receipt.receiptSha256,
    effects: {
      managementReadOnlyRequests: 1,
      databaseMutations: 0,
      authMutations: 0,
      storageMutations: 0,
      productionMutations: 0,
    },
  });
  assert.match(receipt.planSha256, /^[a-f0-9]{64}$/u);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/u);
});

test("receipt targets are reserved before fetch and durable writing pins one inode plus file and POSIX parent sync", async () => {
  const fixture = await createCliRepositoryFixture();
  const outputRoot = await mkdtemp(join(tmpdir(), "amora-receipt-targets-"));
  const existing = join(outputRoot, "existing.json");
  await writeFile(existing, "must-not-be-overwritten\n", "utf8");
  const realParent = join(outputRoot, "real-parent");
  const linkedParent = join(outputRoot, "linked-parent");
  await mkdir(realParent);
  await symlink(realParent, linkedParent, "junction");
  const cases = [
    ["existing", existing],
    ["inside repository", join(fixture.repoRoot, "inside-plan.json")],
    ["linked parent", join(linkedParent, "linked-plan.json")],
  ];
  const observed = [];
  for (const [name, receiptOut] of cases) {
    const result = await spawnCliPlan({ fixture, receiptOut });
    observed.push({ name, status: result.status, fetched: result.fetched });
  }
  const source = await readFile(fixture.cliPath, "utf8");
  const reserveIndex = source.search(/reserve[A-Za-z]*PlanReceipt/u);
  const remoteRunIndex = source.indexOf(
    "runAmoraSuccessorStorageStagingConvergencePlan",
    source.indexOf("async function main"),
  );
  assert.deepEqual({
    targets: observed,
    durability: {
      reservedBeforeRemote:
        reserveIndex >= 0 && reserveIndex < remoteRunIndex,
      sameHandleStat: /handle\.stat\s*\(/u.test(source),
      inodePinned: /\bdev\b/u.test(source) && /\bino\b/u.test(source),
      fileAndParentSynced: (source.match(/\.sync\s*\(/gu) ?? []).length >= 2,
      parentDirectoryAddressed: /dirname\s*\(/u.test(source),
    },
  }, {
    targets: cases.map(([name]) => ({
      name,
      status: 1,
      fetched: false,
    })),
    durability: {
      reservedBeforeRemote: true,
      sameHandleStat: true,
      inodePinned: true,
      fileAndParentSynced: true,
      parentDirectoryAddressed: true,
    },
  });
});

test("an already-converged target emits a zero-action receipt and arbitrary action plans are rejected", () => {
  const targetPlan = planAmoraSuccessorStorageStagingConvergence(targetSnapshot());
  const receipt = createAmoraSuccessorStorageStagingConvergenceReceipt({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    discoveryGitCommit: DISCOVERY_COMMIT,
    convergenceToolGitCommit: COMMIT,
    discoveryReceiptSha256: DISCOVERY_RECEIPT_SHA256,
    observedAt: "2026-08-19T03:00:00.000Z",
    plan: targetPlan,
  });

  assert.deepEqual({
    status: receipt.status,
    actionCount: receipt.actionCount,
    actionIds: receipt.actionIds,
    planSha256: receipt.planSha256,
    receiptSha256IsTyped: /^[a-f0-9]{64}$/u.test(receipt.receiptSha256),
  }, {
    status: "already_converged_read_only",
    actionCount: 0,
    actionIds: [],
    planSha256: targetPlan.planSha256,
    receiptSha256IsTyped: true,
  });

  const forgedPlan = clone(planAmoraSuccessorStorageStagingConvergence(baselineSnapshot()));
  forgedPlan.actions[0] = { id: "create_bucket:attacker", kind: "create_bucket", bucketId: "attacker" };
  assert.throws(
    () => createAmoraSuccessorStorageStagingConvergenceReceipt({
      projectRef: STAGING_REF,
      productionProjectRef: PRODUCTION_REF,
      discoveryGitCommit: DISCOVERY_COMMIT,
      convergenceToolGitCommit: COMMIT,
      discoveryReceiptSha256: DISCOVERY_RECEIPT_SHA256,
      observedAt: "2026-08-19T03:00:00.000Z",
      plan: forgedPlan,
    }),
    assertConvergenceError("STORAGE_CONVERGENCE_RECEIPT_INVALID"),
  );
});

async function loadPglite() {
  const pgliteEntry = join(import.meta.dirname, "..", "..", "apps", "web", "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  const pgcryptoEntry = join(import.meta.dirname, "..", "..", "apps", "web", "node_modules", "@electric-sql", "pglite", "dist", "contrib", "pgcrypto.js");
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import(pathToFileURL(pgliteEntry).href),
    import(pathToFileURL(pgcryptoEntry).href),
  ]);
  return { PGlite, pgcrypto };
}

function sqlSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} source slice`);
  return source.slice(start, end);
}

async function canonicalHelperSetupSql() {
  const accountMigration = (await readFile(join(import.meta.dirname, "..", "..", "supabase", "migrations", "20260716113000_account_deletion_storage_saga.sql"), "utf8")).replaceAll("\r\n", "\n");
  const membershipMigration = (await readFile(join(import.meta.dirname, "..", "..", "supabase", "migrations", "20260716114000_current_couple_membership_privacy_fence.sql"), "utf8")).replaceAll("\r\n", "\n");
  const accountHelper = sqlSlice(accountMigration, "CREATE OR REPLACE FUNCTION public.account_deletion_storage_writes_allowed()", "-- Permanent bridge");
  const productionHelper = sqlSlice(accountMigration, "CREATE OR REPLACE FUNCTION public.production_storage_writes_allowed()", "CREATE OR REPLACE FUNCTION public.begin_account_deletion_job(");
  const membershipHelper = sqlSlice(membershipMigration, "CREATE OR REPLACE FUNCTION public.is_current_couple_path_member(", "-- Enforce the bilateral invariant");
  return `${accountHelper}\n${productionHelper}\n${membershipHelper}`;
}

async function createStorageFixture({ includeFoldername = true } = {}) {
  const { PGlite, pgcrypto } = await loadPglite();
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE supabase_storage_admin NOLOGIN;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE public.account_deletion_jobs (user_id uuid NOT NULL, status text NOT NULL);
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, couple_id uuid, role text);
    CREATE TABLE public.couples (id uuid PRIMARY KEY, bride_id uuid, groom_id uuid);
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid, bucket_id text NOT NULL, name text NOT NULL, metadata jsonb);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES
      ('disclosure-preview', 'disclosure-preview', false, 2 * 1024 * 1024, ARRAY['text/plain']::text[]),
      ('disclosure-raw', 'disclosure-raw', false, 50 * 1024 * 1024,
        ARRAY['application/haansofthwp','application/json','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-hwp','image/png']::text[]),
      ('vendor-images', 'vendor-images', true, NULL, NULL);
    CREATE POLICY disclosure_evidence_client_select_fence ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
      USING (bucket_id <> ALL (ARRAY['disclosure-raw', 'disclosure-preview']::text[]));
    CREATE POLICY disclosure_evidence_client_insert_fence ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated
      WITH CHECK (bucket_id <> ALL (ARRAY['disclosure-raw', 'disclosure-preview']::text[]));
    CREATE POLICY disclosure_evidence_client_update_fence ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
      USING (bucket_id <> ALL (ARRAY['disclosure-raw', 'disclosure-preview']::text[]))
      WITH CHECK (bucket_id <> ALL (ARRAY['disclosure-raw', 'disclosure-preview']::text[]));
    CREATE POLICY disclosure_evidence_client_delete_fence ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated
      USING (bucket_id <> ALL (ARRAY['disclosure-raw', 'disclosure-preview']::text[]));
  `);
  if (includeFoldername) {
    await db.exec(`
      CREATE FUNCTION storage.foldername(path text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE WHEN pg_catalog.strpos(path, '/') = 0 THEN ARRAY[]::text[]
          ELSE pg_catalog.string_to_array(pg_catalog.regexp_replace(path, '/[^/]*$', ''), '/') END
      $$;
    `);
  }
  await db.exec(await canonicalHelperSetupSql());
  await db.exec(`
    ALTER SCHEMA storage OWNER TO supabase_storage_admin;
    ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
    ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
    GRANT USAGE ON SCHEMA auth, public TO supabase_storage_admin;
  `);
  return db;
}

async function storageCatalog(db) {
  const result = await db.query(`
    SELECT
      (SELECT count(*)::integer FROM storage.buckets) AS bucket_count,
      (SELECT count(*)::integer FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND tablename = 'objects') AS policy_count,
      (SELECT file_size_limit FROM storage.buckets WHERE id = 'vendor-images') AS vendor_limit,
      (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'vendor-images') AS vendor_mime_types
  `);
  return result.rows[0];
}

async function storageSafetyState(db) {
  const [buckets, policies, relation, objects] = await Promise.all([
    db.query(`
      SELECT id, name, public, file_size_limit, allowed_mime_types
      FROM storage.buckets ORDER BY id
    `),
    db.query(`
      SELECT policyname, permissive, roles, cmd,
        pg_catalog.encode(extensions.digest(
          COALESCE(qual, '') || E'\\n' || COALESCE(with_check, ''),
          'sha256'
        ), 'hex') AS expression_sha256
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
      ORDER BY policyname, cmd
    `),
    db.query(`
      SELECT pg_catalog.pg_get_userbyid(relation.relowner) AS owner,
        relation.relrowsecurity AS rls_enabled,
        relation.relforcerowsecurity AS force_rls
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'storage' AND relation.relname = 'objects'
    `),
    db.query(`
      SELECT count(*)::integer AS object_count,
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE(
          pg_catalog.string_agg(
            pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
              pg_catalog.to_jsonb(object_row)::text, 'UTF8'
            ), 'sha256'), 'hex'),
            '' ORDER BY object_row.bucket_id, object_row.name, object_row.id
          ), ''
        ), 'UTF8'), 'sha256'), 'hex') AS object_inventory_sha256
      FROM storage.objects AS object_row
    `),
  ]);
  return {
    buckets: buckets.rows,
    policies: policies.rows,
    relation: relation.rows[0],
    objects: objects.rows[0],
  };
}

async function executeSqlAndCaptureNoEffect(db, sql) {
  const before = await storageSafetyState(db);
  let rejected = false;
  try {
    await db.exec(sql);
  } catch {
    rejected = true;
    await db.exec("ROLLBACK;");
  }
  const after = await storageSafetyState(db);
  return {
    rejected,
    noEffect: isDeepStrictEqual(after, before),
    beforeBucketCount: before.buckets.length,
    afterBucketCount: after.buckets.length,
    beforePolicyCount: before.policies.length,
    afterPolicyCount: after.policies.length,
    beforeObjectCount: before.objects.object_count,
    afterObjectCount: after.objects.object_count,
  };
}

async function runApplyDriftCase(name, mutate) {
  const db = await createStorageFixture();
  try {
    await mutate(db);
    return {
      name,
      ...await executeSqlAndCaptureNoEffect(
        db,
        STORAGE_STAGING_CONVERGENCE_APPLY_SQL,
      ),
    };
  } finally {
    await db.close();
  }
}

async function runCompensationDriftCase(name, mutate) {
  const db = await createStorageFixture();
  try {
    await db.exec(STORAGE_STAGING_CONVERGENCE_APPLY_SQL);
    await mutate(db);
    return {
      name,
      ...await executeSqlAndCaptureNoEffect(
        db,
        STORAGE_STAGING_CONVERGENCE_COMPENSATE_SQL,
      ),
    };
  } finally {
    await db.close();
  }
}

test("the read-only plan SQL returns a usable typed baseline and exposes helper ACL or source drift", async () => {
  const db = await createStorageFixture();
  const queryPlan = async () => {
    const result = await db.query(STORAGE_STAGING_CONVERGENCE_PLAN_SQL);
    assert.equal(result.rows.length, 1);
    return result.rows[0];
  };

  try {
    const row = await queryPlan();
    assert.equal(typeof row.observed_at, "string");
    assert.equal(Number.isFinite(Date.parse(row.observed_at)), true);
    assert.deepEqual({
      relationOwner: row.relation_owner,
      relationRlsEnabled: row.relation_rls_enabled,
      relationForceRls: row.relation_force_rls,
      readOnlyPrincipalCanSetStorageAdmin:
        row.read_only_principal_can_set_storage_admin,
      totalObjectCount: row.total_object_count,
      objectInventorySha256IsTyped: /^[a-f0-9]{64}$/u.test(
        row.object_inventory_sha256,
      ),
      productionStorageWritesAllowed:
        row.fence.productionStorageWritesAllowed,
    }, {
      relationOwner: "supabase_storage_admin",
      relationRlsEnabled: true,
      relationForceRls: false,
      readOnlyPrincipalCanSetStorageAdmin: true,
      totalObjectCount: 0,
      objectInventorySha256IsTyped: true,
      productionStorageWritesAllowed: true,
    });
    assert.equal(Array.isArray(row.buckets), true);
    assert.equal(row.buckets.length, 3);
    for (const observedBucket of row.buckets) {
      assert.equal(typeof observedBucket.id, "string");
      assert.equal(typeof observedBucket.objectCount, "number");
      assert.equal(observedBucket.objectCount, 0);
      assert.equal(typeof observedBucket.oversizeObjectCount, "number");
      assert.equal(typeof observedBucket.disallowedMimeObjectCount, "number");
      assert.equal(typeof observedBucket.missingMetadataObjectCount, "number");
      assert.match(observedBucket.objectInventorySha256, /^[a-f0-9]{64}$/u);
    }
    assert.equal(Array.isArray(row.policies), true);
    assert.equal(row.policies.length, 4);
    assert.deepEqual(row.helper_contracts, {
      productionStorageWritesAllowed: {
        contractVerified: true,
        sourceSha256: PRODUCTION_STORAGE_FENCE_SOURCE_SHA256,
      },
      accountDeletionStorageWritesAllowed: {
        contractVerified: true,
        sourceSha256: ACCOUNT_DELETION_STORAGE_FENCE_SOURCE_SHA256,
      },
      isCurrentCouplePathMember: {
        contractVerified: true,
        sourceSha256: CURRENT_COUPLE_PATH_SOURCE_SHA256,
      },
    });

    await db.exec(`
      GRANT EXECUTE ON FUNCTION public.account_deletion_storage_writes_allowed()
        TO anon;
    `);
    const aclDrift = await queryPlan();
    assert.equal(
      aclDrift.helper_contracts.accountDeletionStorageWritesAllowed
        .contractVerified,
      false,
    );

    await db.exec(`
      REVOKE EXECUTE ON FUNCTION public.account_deletion_storage_writes_allowed()
        FROM anon;
      CREATE OR REPLACE FUNCTION public.production_storage_writes_allowed()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = ''
      AS $drifted_storage_fence$ SELECT false $drifted_storage_fence$;
    `);
    const sourceDrift = await queryPlan();
    assert.equal(
      sourceDrift.helper_contracts.productionStorageWritesAllowed
        .contractVerified,
      false,
    );
  } finally {
    await db.close();
  }
});

test("malformed vendor size metadata is CASE-safe and deterministically blocks PLAN and APPLY without catalog effects", async () => {
  const db = await createStorageFixture();
  try {
    await db.exec(`
      INSERT INTO storage.objects (id, bucket_id, name, metadata)
      VALUES (
        '40000000-0000-4000-8000-000000000001',
        'vendor-images',
        'malformed-size.png',
        '{"size": "not-a-number", "mimetype": "image/png"}'::jsonb
      );
    `);
    let planQueryCode = "accepted";
    let plannerCode = "not_run";
    try {
      const result = await db.query(STORAGE_STAGING_CONVERGENCE_PLAN_SQL);
      const row = result.rows[0];
      const snapshot = {
        observedAt: row.observed_at,
        relationOwner: row.relation_owner,
        relationRlsEnabled: row.relation_rls_enabled,
        relationForceRls: row.relation_force_rls,
        buckets: row.buckets,
        policies: row.policies,
        helperContracts: row.helper_contracts,
        fence: row.fence,
        totalObjectCount: row.total_object_count,
        objectInventorySha256: row.object_inventory_sha256,
        readOnlyPrincipalCanSetStorageAdmin:
          row.read_only_principal_can_set_storage_admin,
      };
      try {
        planAmoraSuccessorStorageStagingConvergence(snapshot);
        plannerCode = "accepted";
      } catch (error) {
        plannerCode = error?.code;
      }
    } catch (error) {
      planQueryCode = error?.code;
    }

    const beforeApply = await storageSafetyState(db);
    let applyCode = "accepted";
    try {
      await db.exec(STORAGE_STAGING_CONVERGENCE_APPLY_SQL);
    } catch (error) {
      applyCode = String(error?.message ?? "").includes(
        "STORAGE_CONVERGENCE_VENDOR_OBJECTS_UNSAFE",
      )
        ? "STORAGE_CONVERGENCE_VENDOR_OBJECTS_UNSAFE"
        : error?.code;
      await db.exec("ROLLBACK;");
    }
    const afterApply = await storageSafetyState(db);
    const caseSafeCast = (sql) => /CASE[\s\S]{0,600}metadata\s*->>\s*'size'[\s\S]{0,600}::numeric/iu.test(sql);

    assert.deepEqual({
      planQueryCode,
      plannerCode,
      applyCode,
      applyNoEffect: isDeepStrictEqual(afterApply, beforeApply),
      planCastCaseSafe: caseSafeCast(STORAGE_STAGING_CONVERGENCE_PLAN_SQL),
      applyCastCaseSafe: caseSafeCast(STORAGE_STAGING_CONVERGENCE_APPLY_SQL),
    }, {
      planQueryCode: "accepted",
      plannerCode: "VENDOR_OBJECTS_UNSAFE",
      applyCode: "STORAGE_CONVERGENCE_VENDOR_OBJECTS_UNSAFE",
      applyNoEffect: true,
      planCastCaseSafe: true,
      applyCastCaseSafe: true,
    });
  } finally {
    await db.close();
  }
});

test("bucket name drift is rejected by planner, apply, and compensation with full rollback", async () => {
  const plannerSnapshot = baselineSnapshot();
  plannerSnapshot.buckets.find((entry) => entry.id === "disclosure-preview").name =
    "drifted-disclosure-preview";
  let plannerCode = "accepted";
  try {
    planAmoraSuccessorStorageStagingConvergence(plannerSnapshot);
  } catch (error) {
    plannerCode = error?.code;
  }
  const applyResult = await runApplyDriftCase("bucket name drift", async (db) => {
    await db.exec(`
      UPDATE storage.buckets SET name = 'drifted-disclosure-preview'
      WHERE id = 'disclosure-preview';
    `);
  });
  const compensationResult = await runCompensationDriftCase(
    "bucket name drift",
    async (db) => {
      await db.exec(`
        UPDATE storage.buckets SET name = 'drifted-disclosure-preview'
        WHERE id = 'disclosure-preview';
      `);
    },
  );

  assert.deepEqual({
    plannerRejected: plannerCode !== "accepted",
    applyResult,
    compensationResult,
  }, {
    plannerRejected: true,
    applyResult: {
      name: "bucket name drift",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 3,
      afterBucketCount: 3,
      beforePolicyCount: 4,
      afterPolicyCount: 4,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
    compensationResult: {
      name: "bucket name drift",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 13,
      afterBucketCount: 13,
      beforePolicyCount: 5,
      afterPolicyCount: 5,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
  });
});

test("an exact target is a zero-action no-op without Storage-admin capability while a baseline remains blocked", () => {
  const exactTarget = targetSnapshot();
  exactTarget.readOnlyPrincipalCanSetStorageAdmin = false;
  let targetOutcome;
  try {
    const targetPlan = planAmoraSuccessorStorageStagingConvergence(exactTarget);
    targetOutcome = {
      status: targetPlan.status,
      classification: targetPlan.classification,
      actionCount: targetPlan.actionCount,
      actionIds: targetPlan.actions.map((action) => action.id),
    };
  } catch (error) {
    targetOutcome = error?.code;
  }
  const baseline = baselineSnapshot();
  baseline.readOnlyPrincipalCanSetStorageAdmin = false;
  let baselineOutcome = "accepted";
  try {
    planAmoraSuccessorStorageStagingConvergence(baseline);
  } catch (error) {
    baselineOutcome = error?.code;
  }

  assert.deepEqual({
    targetOutcome,
    baselineOutcome,
  }, {
    targetOutcome: {
      status: "already_converged",
      classification: "target",
      actionCount: 0,
      actionIds: [],
    },
    baselineOutcome: "HOSTED_STORAGE_ADMIN_CAPABILITY_MISSING",
  });
});

test("role capability is a version-correct read-only preflight and never mutation authorization", () => {
  const mutationAuthorization = {
    status: "unproven",
    authorized: false,
    reason: "WRITE_ENDPOINT_PRINCIPAL_UNDOCUMENTED",
  };
  const baselinePlan = planAmoraSuccessorStorageStagingConvergence(
    baselineSnapshot(),
  );
  const baselineReceipt = createAmoraSuccessorStorageStagingConvergenceReceipt({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    discoveryGitCommit: DISCOVERY_COMMIT,
    convergenceToolGitCommit: COMMIT,
    discoveryReceiptSha256: DISCOVERY_RECEIPT_SHA256,
    observedAt: "2026-08-19T03:00:00.000Z",
    plan: baselinePlan,
  });
  const tamperedPlan = clone(baselinePlan);
  tamperedPlan.mutationAuthorization = {
    status: "authorized",
    authorized: true,
    reason: "UNSAFE_TEST_TAMPER",
  };
  let tamperedPlanResult = "accepted";
  try {
    createAmoraSuccessorStorageStagingConvergenceReceipt({
      projectRef: STAGING_REF,
      productionProjectRef: PRODUCTION_REF,
      discoveryGitCommit: DISCOVERY_COMMIT,
      convergenceToolGitCommit: COMMIT,
      discoveryReceiptSha256: DISCOVERY_RECEIPT_SHA256,
      observedAt: "2026-08-19T03:00:00.000Z",
      plan: tamperedPlan,
    });
  } catch (error) {
    tamperedPlanResult = error?.code;
  }
  const targetWithoutCapability = targetSnapshot();
  targetWithoutCapability.readOnlyPrincipalCanSetStorageAdmin = false;
  let targetOutcome;
  try {
    const plan = planAmoraSuccessorStorageStagingConvergence(
      targetWithoutCapability,
    );
    targetOutcome = {
      status: plan.status,
      actionCount: plan.actionCount,
      mutationAuthorization: plan.mutationAuthorization,
    };
  } catch (error) {
    targetOutcome = error?.code;
  }
  const baselineWithoutCapability = baselineSnapshot();
  baselineWithoutCapability.readOnlyPrincipalCanSetStorageAdmin = false;
  let baselineOutcome = "accepted";
  try {
    planAmoraSuccessorStorageStagingConvergence(
      baselineWithoutCapability,
    );
  } catch (error) {
    baselineOutcome = error?.code;
  }
  const sql = STORAGE_STAGING_CONVERGENCE_PLAN_SQL;

  assert.deepEqual({
    usageModeAbsent:
      !/pg_has_role\s*\([\s\S]{0,180}'USAGE'/iu.test(sql),
    serverVersionGuardPresent:
      /server_version_num[\s\S]{0,180}(?:>=|<)\s*160000/iu.test(sql),
    postgres16SetModePresent:
      /server_version_num[\s\S]{0,300}160000[\s\S]{0,300}'SET'/iu.test(sql),
    legacyMemberFallbackPresent:
      /server_version_num[\s\S]{0,500}'MEMBER'/iu.test(sql),
    baselineMutationAuthorization: baselinePlan.mutationAuthorization,
    receiptMutationAuthorization: baselineReceipt.mutationAuthorization,
    tamperedPlanResult,
    targetOutcome,
    baselineOutcome,
    staticSqlEffectsRemainZero: baselineReceipt.effects,
  }, {
    usageModeAbsent: true,
    serverVersionGuardPresent: true,
    postgres16SetModePresent: true,
    legacyMemberFallbackPresent: true,
    baselineMutationAuthorization: mutationAuthorization,
    receiptMutationAuthorization: mutationAuthorization,
    tamperedPlanResult: "STORAGE_CONVERGENCE_RECEIPT_INVALID",
    targetOutcome: {
      status: "already_converged",
      actionCount: 0,
      mutationAuthorization,
    },
    baselineOutcome: "HOSTED_STORAGE_ADMIN_CAPABILITY_MISSING",
    staticSqlEffectsRemainZero: {
      managementReadOnlyRequests: 1,
      databaseMutations: 0,
      authMutations: 0,
      storageMutations: 0,
      productionMutations: 0,
    },
  });
});

test("atomic apply rejects raw policy, helper, relation, RLS, FORCE, or fence drift with zero catalog effects", async () => {
  const results = [];
  results.push(await runApplyDriftCase("disclosure policy mode drift", async (db) => {
    await db.exec(`
      DROP POLICY disclosure_evidence_client_select_fence ON storage.objects;
      CREATE POLICY disclosure_evidence_client_select_fence
        ON storage.objects AS PERMISSIVE FOR SELECT TO anon, authenticated
        USING (bucket_id <> ALL (
          ARRAY['disclosure-raw', 'disclosure-preview']::text[]
        ));
    `);
  }));
  results.push(await runApplyDriftCase("extra policy", async (db) => {
    await db.exec(`
      CREATE POLICY unexpected_storage_reader
        ON storage.objects AS PERMISSIVE FOR SELECT TO anon USING (true);
    `);
  }));
  results.push(await runApplyDriftCase("helper ACL and source drift", async (db) => {
    await db.exec(`
      GRANT EXECUTE
        ON FUNCTION public.account_deletion_storage_writes_allowed()
        TO anon;
      CREATE OR REPLACE FUNCTION public.production_storage_writes_allowed()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = ''
      AS $drifted_apply_storage_fence$
        SELECT false
      $drifted_apply_storage_fence$;
    `);
  }));
  results.push(await runApplyDriftCase("owner, RLS, FORCE, and open-fence drift", async (db) => {
    await db.exec(`
      CREATE ROLE alternate_storage_owner NOLOGIN;
      GRANT alternate_storage_owner TO supabase_storage_admin;
      ALTER TABLE storage.objects OWNER TO alternate_storage_owner;
      ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;
      ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.production_write_fence_guard_20260717()
      RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    `);
  }));

  assert.deepEqual(results, [
    {
      name: "disclosure policy mode drift",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 3,
      afterBucketCount: 3,
      beforePolicyCount: 4,
      afterPolicyCount: 4,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
    {
      name: "extra policy",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 3,
      afterBucketCount: 3,
      beforePolicyCount: 5,
      afterPolicyCount: 5,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
    {
      name: "helper ACL and source drift",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 3,
      afterBucketCount: 3,
      beforePolicyCount: 4,
      afterPolicyCount: 4,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
    {
      name: "owner, RLS, FORCE, and open-fence drift",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 3,
      afterBucketCount: 3,
      beforePolicyCount: 4,
      afterPolicyCount: 4,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
  ]);
});

test("atomic apply requires one vendor update and preserves the exact object inventory with all ten new buckets empty", async () => {
  const results = [];
  results.push(await runApplyDriftCase("vendor update affected zero rows", async (db) => {
    await db.exec(`
      CREATE FUNCTION public.force_vendor_target_before_explicit_update()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $force_vendor_target$
      BEGIN
        IF NEW.id = 'chat-image' THEN
          UPDATE storage.buckets
          SET file_size_limit = 5242880,
              allowed_mime_types =
                ARRAY['image/jpeg','image/png','image/webp']::text[]
          WHERE id = 'vendor-images';
        END IF;
        RETURN NEW;
      END;
      $force_vendor_target$;
      CREATE TRIGGER force_vendor_target_before_explicit_update
      AFTER INSERT ON storage.buckets
      FOR EACH ROW EXECUTE FUNCTION
        public.force_vendor_target_before_explicit_update();
    `);
  }));
  results.push(await runApplyDriftCase("object inventory changed during apply", async (db) => {
    await db.exec(`
      CREATE FUNCTION public.inject_object_during_bucket_creation()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $inject_storage_object$
      BEGIN
        IF NEW.id = 'chat-image' THEN
          INSERT INTO storage.objects (id, bucket_id, name, metadata)
          VALUES (
            '30000000-0000-4000-8000-000000000001',
            'chat-image',
            'transaction-side-effect.png',
            '{"size": 1, "mimetype": "image/png"}'::jsonb
          );
        END IF;
        RETURN NEW;
      END;
      $inject_storage_object$;
      CREATE TRIGGER inject_object_during_bucket_creation
      AFTER INSERT ON storage.buckets
      FOR EACH ROW EXECUTE FUNCTION
        public.inject_object_during_bucket_creation();
    `);
  }));

  assert.deepEqual(results, [
    {
      name: "vendor update affected zero rows",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 3,
      afterBucketCount: 3,
      beforePolicyCount: 4,
      afterPolicyCount: 4,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
    {
      name: "object inventory changed during apply",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 3,
      afterBucketCount: 3,
      beforePolicyCount: 4,
      afterPolicyCount: 4,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
  ]);
});

test("atomic compensation accepts only the exact target and rolls wrong policy, bucket, helper, relation, or fence state back", async () => {
  const results = [];
  results.push(await runCompensationDriftCase("wrong chat policy body", async (db) => {
    await db.exec(`
      DROP POLICY "chat-image own uploader folder write pf46ue_0"
        ON storage.objects;
      CREATE POLICY "chat-image own uploader folder write pf46ue_0"
        ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'chat-image');
    `);
  }));
  results.push(await runCompensationDriftCase("disclosure policy role drift", async (db) => {
    await db.exec(`
      DROP POLICY disclosure_evidence_client_select_fence ON storage.objects;
      CREATE POLICY disclosure_evidence_client_select_fence
        ON storage.objects AS RESTRICTIVE FOR SELECT TO anon
        USING (bucket_id <> ALL (
          ARRAY['disclosure-raw', 'disclosure-preview']::text[]
        ));
    `);
  }));
  results.push(await runCompensationDriftCase("target bucket config drift", async (db) => {
    await db.exec(`
      UPDATE storage.buckets SET file_size_limit = 1
      WHERE id = 'disclosure-preview';
    `);
  }));
  results.push(await runCompensationDriftCase("helper, relation, and open-fence drift", async (db) => {
    await db.exec(`
      GRANT EXECUTE
        ON FUNCTION public.account_deletion_storage_writes_allowed()
        TO anon;
      ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.production_write_fence_guard_20260717()
      RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    `);
  }));

  assert.deepEqual(results, [
    {
      name: "wrong chat policy body",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 13,
      afterBucketCount: 13,
      beforePolicyCount: 5,
      afterPolicyCount: 5,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
    {
      name: "disclosure policy role drift",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 13,
      afterBucketCount: 13,
      beforePolicyCount: 5,
      afterPolicyCount: 5,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
    {
      name: "target bucket config drift",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 13,
      afterBucketCount: 13,
      beforePolicyCount: 5,
      afterPolicyCount: 5,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
    {
      name: "helper, relation, and open-fence drift",
      rejected: true,
      noEffect: true,
      beforeBucketCount: 13,
      afterBucketCount: 13,
      beforePolicyCount: 5,
      afterPolicyCount: 5,
      beforeObjectCount: 0,
      afterObjectCount: 0,
    },
  ]);
});

test("PGlite proves the atomic apply reaches exact 13/5 and a policy-creation failure rolls every bucket change back", async () => {
  const happyDb = await createStorageFixture();
  try {
    await happyDb.exec(STORAGE_STAGING_CONVERGENCE_APPLY_SQL);
    assert.deepEqual(await storageCatalog(happyDb), {
      bucket_count: 13,
      policy_count: 5,
      vendor_limit: 5 * 1024 * 1024,
      vendor_mime_types: ["image/jpeg", "image/png", "image/webp"],
    });
    const policyDigest = await happyDb.query(`
      SELECT pg_catalog.encode(extensions.digest(COALESCE(qual, '') || E'\\n' || COALESCE(with_check, ''), 'sha256'), 'hex') AS digest
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE'
        AND roles = ARRAY['authenticated']::name[] AND cmd = 'INSERT'
    `);
    assert.deepEqual(policyDigest.rows, [{ digest: CHAT_POLICY_SHA256 }]);
  } finally {
    await happyDb.close();
  }

  const rollbackDb = await createStorageFixture({ includeFoldername: false });
  try {
    await assert.rejects(rollbackDb.exec(STORAGE_STAGING_CONVERGENCE_APPLY_SQL));
    await rollbackDb.exec("ROLLBACK;");
    assert.deepEqual(await storageCatalog(rollbackDb), {
      bucket_count: 3,
      policy_count: 4,
      vendor_limit: null,
      vendor_mime_types: null,
    });
  } finally {
    await rollbackDb.close();
  }
});

test("PGlite compensation restores only an exact target whose ten created buckets remain empty", async () => {
  const emptyDb = await createStorageFixture();
  try {
    await emptyDb.exec(STORAGE_STAGING_CONVERGENCE_APPLY_SQL);
    await emptyDb.exec(STORAGE_STAGING_CONVERGENCE_COMPENSATE_SQL);
    assert.deepEqual(await storageCatalog(emptyDb), {
      bucket_count: 3,
      policy_count: 4,
      vendor_limit: null,
      vendor_mime_types: null,
    });
  } finally {
    await emptyDb.close();
  }

  const occupiedDb = await createStorageFixture();
  try {
    await occupiedDb.exec(STORAGE_STAGING_CONVERGENCE_APPLY_SQL);
    await occupiedDb.exec(`
      INSERT INTO storage.objects (id, bucket_id, name, metadata)
      VALUES ('10000000-0000-4000-8000-000000000001', 'chat-image',
        'must-never-be-deleted-by-compensation.png', '{"size": 1, "mimetype": "image/png"}'::jsonb);
    `);
    await assert.rejects(
      occupiedDb.exec(STORAGE_STAGING_CONVERGENCE_COMPENSATE_SQL),
      /STORAGE_CONVERGENCE_COMPENSATION_BUCKET_NOT_EMPTY/u,
    );
    await occupiedDb.exec("ROLLBACK;");
    const objectResult = await occupiedDb.query("SELECT count(*)::integer AS object_count FROM storage.objects");
    assert.deepEqual(await storageCatalog(occupiedDb), {
      bucket_count: 13,
      policy_count: 5,
      vendor_limit: 5 * 1024 * 1024,
      vendor_mime_types: ["image/jpeg", "image/png", "image/webp"],
    });
    assert.deepEqual(objectResult.rows, [{ object_count: 1 }]);
  } finally {
    await occupiedDb.close();
  }
});
