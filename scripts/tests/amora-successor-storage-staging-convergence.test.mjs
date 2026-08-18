import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
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
  createAmoraSuccessorStorageStagingConvergenceReceipt,
  inspectAmoraSuccessorStorageStagingConvergencePlan,
  planAmoraSuccessorStorageStagingConvergence,
  runAmoraSuccessorStorageStagingConvergencePlan,
  validateAmoraSuccessorStorageStagingConvergencePlanConfig,
} from "../lib/amora-successor-storage-staging-convergence.mjs";

const STAGING_REF = "rgxdizztidbgwnsbadml";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const COMMIT = "a".repeat(40);
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

const EXPECTED_ACTION_IDS = Object.freeze([
  ...CREATE_BUCKET_IDS.map((bucketId) => `create_bucket:${bucketId}`),
  "update_bucket:vendor-images",
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

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
  assert.doesNotThrow(() => assertAmoraSuccessorStorageStagingConvergenceMutationPlatform("darwin"));
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
