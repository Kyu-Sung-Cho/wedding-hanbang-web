import { createHash, randomUUID } from "node:crypto";
import { constants, readFileSync, realpathSync, statSync } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAmoraSuccessorStorageExternalOutputPath,
} from "./amora-successor-storage-staging-probe.mjs";
import { verifySupabaseServiceDestination } from "./supabase-service-destination.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GENERIC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const FILESYSTEM_PLATFORM = process.report.getReport().header.platform;
const CANONICAL_REPO_ROOT = realpathSync(resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
));
const APPROVED_STAGING_PROJECT_REF = "rgxdizztidbgwnsbadml";
const APPROVED_PRODUCTION_PROJECT_REF = "slrtobkksjmxgzatjyqb";
const APPROVED_DISCOVERY_GIT_COMMIT =
  "e540cc69da7cbfd919f101d0b4edd2c7d15e92be";
const MAX_DISCOVERY_RECEIPT_BYTES = 64 * 1024;
const MAX_MANAGEMENT_RESPONSE_BYTES = 512 * 1024;
const MAX_STORAGE_API_RESPONSE_BYTES = 64 * 1024;
const MUTATION_AUTHORIZATION = Object.freeze({
  status: "unproven",
  authorized: false,
  reason: "WRITE_ENDPOINT_PRINCIPAL_UNDOCUMENTED",
});
const BUCKET_API_OPERATION_IDENTITIES = new WeakSet();
const BUCKET_API_RECOVERY_ONLY_OPERATION_IDENTITIES = new WeakSet();
const BUCKET_API_MUTATION_CAPABILITIES = new WeakMap();
const BUCKET_API_RECOVERY_AUTHORIZATIONS = new WeakMap();
const BUCKET_API_JOURNAL_CAPABILITIES = new WeakMap();
const BUCKET_API_TRANSPORT_CAPABILITIES = new WeakMap();
const BUCKET_API_INSPECTOR_CAPABILITIES = new WeakMap();
const BUCKET_API_RECEIPT_WRITER_CAPABILITIES = new WeakMap();
const BUCKET_API_COMPLETION_RECEIPT_CAPABILITIES = new WeakMap();
const BUCKET_API_OPERATION_SCOPE = "staging-storage-bucket-api-s0-to-s1-only";

const CHAT_POLICY_EXPRESSION_SHA256 =
  "64bbc946e4c70b9629b21e9a151e5faa95c228acb80dfa4f26778f472b246e19";
const DISCLOSURE_POLICY_EXPRESSION_SHA256 =
  "ff185265a9865290b5ba9ff77472377fa8d0b707e7bfef65c1ee40f759d1389f";
const DISCLOSURE_INSERT_POLICY_EXPRESSION_SHA256 =
  "24edd073465ecb17ec3baee29c679abda37160c55eb8bda58ecd20e0c7e625de";
const DISCLOSURE_UPDATE_POLICY_EXPRESSION_SHA256 =
  "2443f1653a213dde8c5e3edec0c42258c90ac94464397cd644ce6c2d1ddc60ac";

const HELPER_SOURCE_SHA256 = Object.freeze({
  productionStorageWritesAllowed:
    "806818646e13253b2cd985f40adf1b3f42e8f8855b922ea9dd95e68a875bcd25",
  accountDeletionStorageWritesAllowed:
    "8b2d9ea440a242435bd64770e880e15d8c55404ad8a0acf0d7d23fd2a3c498d5",
  isCurrentCouplePathMember:
    "a64b9c787ada0c813a1df888d22bc7f9369ff30d81adff5a70574fd5125b3912",
});

const STRICT_CHAT_POLICY_NAME =
  "chat-image own uploader folder write pf46ue_0";

const TARGET_BUCKETS = Object.freeze([
  bucket("chat-image", false, null, null),
  bucket("cohort-images", true, null, null),
  bucket("community-images", true, 10 * 1024 * 1024,
    ["image/jpeg", "image/png", "image/gif", "image/webp"]),
  bucket("community-videos", true, 50 * 1024 * 1024,
    ["video/mp4", "video/quicktime", "video/webm"]),
  bucket("community-media-staging", false, 6 * 1024 * 1024,
    ["image/jpeg", "image/png", "image/gif", "image/webp"]),
  bucket("guestbook-images", false, null, null),
  bucket("guestbook-uploads", false, 5 * 1024 * 1024,
    ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  bucket("invitation-photos", true, 10 * 1024 * 1024,
    ["image/jpeg", "image/png", "image/webp", "image/heic"]),
  bucket("user_photos", true, null, null),
  bucket("vendor-images", true, 5 * 1024 * 1024,
    ["image/jpeg", "image/png", "image/webp"]),
  bucket("vendor-licenses", false, 10 * 1024 * 1024,
    ["image/jpeg", "image/png", "application/pdf"]),
  bucket("disclosure-raw", false, 50 * 1024 * 1024, [
    "application/haansofthwp",
    "application/json",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/x-hwp",
    "image/png",
  ]),
  bucket("disclosure-preview", false, 2 * 1024 * 1024, ["text/plain"]),
].sort(compareById));

const BASELINE_BUCKETS = Object.freeze([
  bucket("disclosure-preview", false, 2 * 1024 * 1024, ["text/plain"]),
  bucket("disclosure-raw", false, 50 * 1024 * 1024, [
    "application/haansofthwp",
    "application/json",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/x-hwp",
    "image/png",
  ]),
  bucket("vendor-images", true, null, null),
].sort(compareById));

const MISSING_BUCKETS = Object.freeze(
  TARGET_BUCKETS.filter((candidate) => !BASELINE_BUCKETS.some(
    (existing) => existing.id === candidate.id,
  )),
);

const BASELINE_POLICIES = Object.freeze([
  policy("disclosure_evidence_client_delete_fence", "RESTRICTIVE",
    ["anon", "authenticated"], "DELETE", DISCLOSURE_POLICY_EXPRESSION_SHA256),
  policy("disclosure_evidence_client_insert_fence", "RESTRICTIVE",
    ["anon", "authenticated"], "INSERT", DISCLOSURE_INSERT_POLICY_EXPRESSION_SHA256),
  policy("disclosure_evidence_client_select_fence", "RESTRICTIVE",
    ["anon", "authenticated"], "SELECT", DISCLOSURE_POLICY_EXPRESSION_SHA256),
  policy("disclosure_evidence_client_update_fence", "RESTRICTIVE",
    ["anon", "authenticated"], "UPDATE", DISCLOSURE_UPDATE_POLICY_EXPRESSION_SHA256),
].sort(comparePolicies));

const TARGET_POLICIES = Object.freeze([
  ...BASELINE_POLICIES,
  policy(STRICT_CHAT_POLICY_NAME, "PERMISSIVE", ["authenticated"], "INSERT",
    CHAT_POLICY_EXPRESSION_SHA256),
].sort(comparePolicies));

const BUCKET_API_ACTIONS = Object.freeze([
  ...MISSING_BUCKETS.map((entry) => Object.freeze({
    id: `create_bucket:${entry.id}`,
    kind: "create_bucket",
    bucketId: entry.id,
  })),
  Object.freeze({
    id: "update_bucket:vendor-images",
    kind: "update_bucket_configuration",
    bucketId: "vendor-images",
  }),
]);

const ACTIONS = Object.freeze([
  ...BUCKET_API_ACTIONS,
  Object.freeze({
    id: "create_policy:chat-image-strict-insert",
    kind: "create_policy",
    semanticKey: "chat-image-strict-insert",
  }),
]);

const BUCKET_API_TARGET_CONTRACT_SHA256 = sha256(canonicalJson({
  buckets: TARGET_BUCKETS,
  actions: BUCKET_API_ACTIONS,
}));

export class AmoraSuccessorStorageStagingConvergenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AmoraSuccessorStorageStagingConvergenceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AmoraSuccessorStorageStagingConvergenceError(code, message);
}

function bucket(id, isPublic, fileSizeLimit, allowedMimeTypes) {
  return Object.freeze({
    id,
    name: id,
    public: isPublic,
    fileSizeLimit,
    allowedMimeTypes: allowedMimeTypes === null
      ? null
      : Object.freeze([...allowedMimeTypes]),
  });
}

function policy(name, permissive, roles, command, expressionSha256) {
  return Object.freeze({
    name,
    permissive,
    roles: Object.freeze([...roles].sort()),
    command,
    expressionSha256,
  });
}

function compareById(left, right) {
  return left.id.localeCompare(right.id, "en");
}

function comparePolicies(left, right) {
  return [left.name, left.command, left.permissive, left.expressionSha256]
    .join("\n")
    .localeCompare(
      [right.name, right.command, right.permissive, right.expressionSha256].join("\n"),
      "en",
    );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function exactArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizeBucket(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || typeof input.id !== "string" || input.id.length === 0
      || input.name !== input.id || typeof input.public !== "boolean"
      || (input.fileSizeLimit !== null
        && (!Number.isSafeInteger(input.fileSizeLimit) || input.fileSizeLimit < 0))
      || (input.allowedMimeTypes !== null && !Array.isArray(input.allowedMimeTypes))
      || !Number.isSafeInteger(input.objectCount) || input.objectCount < 0
      || !Number.isSafeInteger(input.oversizeObjectCount)
      || input.oversizeObjectCount < 0
      || !Number.isSafeInteger(input.disallowedMimeObjectCount)
      || input.disallowedMimeObjectCount < 0
      || !Number.isSafeInteger(input.missingMetadataObjectCount)
      || input.missingMetadataObjectCount < 0
      || !SHA256.test(input.objectInventorySha256 ?? "")) {
    fail("STORAGE_CONVERGENCE_SNAPSHOT_INVALID", "Storage bucket snapshot was invalid");
  }
  const allowedMimeTypes = input.allowedMimeTypes === null
    ? null
    : input.allowedMimeTypes.map(String);
  return Object.freeze({
    id: input.id,
    name: input.name,
    public: input.public,
    fileSizeLimit: input.fileSizeLimit,
    allowedMimeTypes,
    objectCount: input.objectCount,
    oversizeObjectCount: input.oversizeObjectCount,
    disallowedMimeObjectCount: input.disallowedMimeObjectCount,
    missingMetadataObjectCount: input.missingMetadataObjectCount,
    objectInventorySha256: input.objectInventorySha256,
  });
}

function normalizePolicy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || typeof input.name !== "string" || input.name.length === 0
      || !["PERMISSIVE", "RESTRICTIVE"].includes(input.permissive)
      || !Array.isArray(input.roles)
      || !["SELECT", "INSERT", "UPDATE", "DELETE"].includes(input.command)
      || !SHA256.test(input.expressionSha256 ?? "")) {
    fail("STORAGE_CONVERGENCE_SNAPSHOT_INVALID", "Storage policy snapshot was invalid");
  }
  return Object.freeze({
    name: input.name,
    permissive: input.permissive,
    roles: Object.freeze(input.roles.map(String).sort()),
    command: input.command,
    expressionSha256: input.expressionSha256,
  });
}

export function normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || typeof input.relationOwner !== "string"
      || typeof input.relationRlsEnabled !== "boolean"
      || typeof input.relationForceRls !== "boolean"
      || !Array.isArray(input.buckets) || !Array.isArray(input.policies)
      || !input.helperContracts || typeof input.helperContracts !== "object"
      || !input.fence || typeof input.fence !== "object"
      || !Array.isArray(input.fence.triggerNames)
      || !Array.isArray(input.fence.eventTriggerNames)
      || typeof input.fence.guardFunctionExists !== "boolean"
      || typeof input.fence.attachFunctionExists !== "boolean"
      || typeof input.fence.productionStorageWritesAllowed !== "boolean"
      || !Number.isSafeInteger(input.totalObjectCount) || input.totalObjectCount < 0
      || !SHA256.test(input.objectInventorySha256 ?? "")
      || typeof input.readOnlyPrincipalCanSetStorageAdmin !== "boolean"
      || !Number.isFinite(Date.parse(input.observedAt ?? ""))) {
    fail("STORAGE_CONVERGENCE_SNAPSHOT_INVALID", "Storage convergence snapshot was invalid");
  }
  if (input.relationOwner !== "supabase_storage_admin"
      || input.relationRlsEnabled !== true || input.relationForceRls !== false
      || input.fence.triggerNames.length !== 0
      || input.fence.eventTriggerNames.length !== 0
      || input.fence.guardFunctionExists !== false
      || input.fence.attachFunctionExists !== false
      || input.fence.productionStorageWritesAllowed !== true) {
    fail("CONVERGENCE_STATE_AMBIGUOUS", "Storage relation or write-fence state drifted");
  }
  const helperContracts = {};
  for (const [key, expectedSourceSha256] of Object.entries(HELPER_SOURCE_SHA256)) {
    const helper = input.helperContracts[key];
    if (!helper || helper.contractVerified !== true
        || helper.sourceSha256 !== expectedSourceSha256) {
      fail("HELPER_CONTRACT_DRIFT", `Storage helper contract drifted: ${key}`);
    }
    helperContracts[key] = Object.freeze({
      contractVerified: true,
      sourceSha256: helper.sourceSha256,
    });
  }
  return Object.freeze({
    observedAt: new Date(Date.parse(input.observedAt)).toISOString(),
    relationOwner: input.relationOwner,
    relationRlsEnabled: input.relationRlsEnabled,
    relationForceRls: input.relationForceRls,
    buckets: Object.freeze(input.buckets.map(normalizeBucket).sort(compareById)),
    policies: Object.freeze(input.policies.map(normalizePolicy).sort(comparePolicies)),
    helperContracts: Object.freeze(helperContracts),
    fence: Object.freeze({
      triggerNames: Object.freeze([]),
      eventTriggerNames: Object.freeze([]),
      guardFunctionExists: false,
      attachFunctionExists: false,
      productionStorageWritesAllowed: true,
    }),
    totalObjectCount: input.totalObjectCount,
    objectInventorySha256: input.objectInventorySha256,
    readOnlyPrincipalCanSetStorageAdmin: input.readOnlyPrincipalCanSetStorageAdmin,
  });
}

function bucketConfigMatches(actual, expected) {
  return actual.id === expected.id
    && actual.name === expected.name
    && actual.public === expected.public
    && actual.fileSizeLimit === expected.fileSizeLimit
    && (expected.allowedMimeTypes === null
      ? actual.allowedMimeTypes === null
      : exactArray(actual.allowedMimeTypes, expected.allowedMimeTypes));
}

function bucketSetMatches(actual, expected) {
  return actual.length === expected.length
    && actual.every((entry, index) => bucketConfigMatches(entry, expected[index]));
}

function policySetMatches(actual, expected, { semanticChatName = false } = {}) {
  if (actual.length !== expected.length) return false;
  const normalizedActual = actual.map((entry) => {
    if (semanticChatName && entry.permissive === "PERMISSIVE"
        && exactArray(entry.roles, ["authenticated"])
        && entry.command === "INSERT"
        && entry.expressionSha256 === CHAT_POLICY_EXPRESSION_SHA256) {
      return { ...entry, name: STRICT_CHAT_POLICY_NAME };
    }
    return entry;
  }).sort(comparePolicies);
  return normalizedActual.every((entry, index) => {
    const target = expected[index];
    return entry.name === target.name
      && entry.permissive === target.permissive
      && exactArray(entry.roles, target.roles)
      && entry.command === target.command
      && entry.expressionSha256 === target.expressionSha256;
  });
}

function vendorSafety(snapshot) {
  const vendor = snapshot.buckets.find((entry) => entry.id === "vendor-images");
  if (!vendor) return null;
  return Object.freeze({
    objectCount: vendor.objectCount,
    objectInventorySha256: vendor.objectInventorySha256,
    oversizeObjectCount: vendor.oversizeObjectCount,
    disallowedMimeObjectCount: vendor.disallowedMimeObjectCount,
    missingMetadataObjectCount: vendor.missingMetadataObjectCount,
  });
}

function classifyBucketApiSnapshot(snapshot) {
  const policiesAreBaseline = policySetMatches(snapshot.policies, BASELINE_POLICIES);
  if (policiesAreBaseline && bucketSetMatches(snapshot.buckets, BASELINE_BUCKETS)) {
    return "S0";
  }
  if (policiesAreBaseline && bucketSetMatches(snapshot.buckets, TARGET_BUCKETS)) {
    const createdBucketsAreEmpty = snapshot.buckets
      .filter((entry) => MISSING_BUCKETS.some((target) => target.id === entry.id))
      .every((entry) => entry.objectCount === 0);
    return createdBucketsAreEmpty ? "S1" : "U";
  }
  return "U";
}

export function classifyAmoraSuccessorStorageBucketApiConvergenceOutcome(input) {
  try {
    return classifyBucketApiSnapshot(
      normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(input),
    );
  } catch {
    return "U";
  }
}

export function planAmoraSuccessorStorageBucketApiConvergence(input) {
  const snapshot = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(input);
  const classification = classifyBucketApiSnapshot(snapshot);
  if (classification === "U") {
    fail(
      "STORAGE_BUCKET_API_CONVERGENCE_STATE_AMBIGUOUS",
      "Storage catalog was neither exact bucket baseline nor exact policy-pending target",
    );
  }
  const vendor = vendorSafety(snapshot);
  if (!vendor) {
    fail("STORAGE_BUCKET_API_CONVERGENCE_STATE_AMBIGUOUS", "Storage vendor bucket was absent");
  }
  if (vendor.oversizeObjectCount !== 0
      || vendor.disallowedMimeObjectCount !== 0
      || vendor.missingMetadataObjectCount !== 0) {
    fail(
      "VENDOR_OBJECTS_UNSAFE",
      "Existing vendor objects are not proven compatible with the target restriction",
    );
  }
  const plan = {
    status: classification === "S1"
      ? "bucket_configuration_converged_policy_pending"
      : "bucket_configuration_convergence_planned",
    classification,
    actions: classification === "S1" ? Object.freeze([]) : BUCKET_API_ACTIONS,
    actionCount: classification === "S1" ? 0 : BUCKET_API_ACTIONS.length,
    baselineObjectCount: snapshot.totalObjectCount,
    baselineObjectInventorySha256: snapshot.objectInventorySha256,
    vendorSafety: vendor,
    policyMutationPending: true,
    targetBucketContractSha256: BUCKET_API_TARGET_CONTRACT_SHA256,
  };
  return Object.freeze({
    ...plan,
    planSha256: sha256(canonicalJson(plan)),
  });
}

async function assertBucketApiRunnerDependencies({
  plan,
  operationIdentity,
  journal,
  transport,
  inspectSnapshot,
  receiptReservation,
  now,
}) {
  if (!plan || typeof plan !== "object"
      || !journal || typeof journal.append !== "function" || typeof journal.read !== "function"
      || typeof journal.assertOperationIdentity !== "function"
      || typeof journal.assertRecoveryAuthorization !== "function"
      || typeof journal.acquireOperationLease !== "function"
      || typeof journal.assertOperationLease !== "function"
      || typeof journal.releaseOperationLease !== "function"
      || !transport || typeof transport.createBucket !== "function"
      || typeof transport.updateVendorImages !== "function"
      || typeof transport.getBucket !== "function"
      || typeof inspectSnapshot !== "function" || typeof now !== "function") {
    fail("STORAGE_BUCKET_API_RUNNER_INVALID", "Storage bucket runner dependencies were invalid");
  }
  if (!receiptReservation || typeof receiptReservation.writeReceipt !== "function") {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Bucket receipt reservation was unavailable");
  }
  const journalBinding = BUCKET_API_JOURNAL_CAPABILITIES.get(journal);
  const transportBinding = BUCKET_API_TRANSPORT_CAPABILITIES.get(transport);
  const inspectorBinding = BUCKET_API_INSPECTOR_CAPABILITIES.get(inspectSnapshot);
  const receiptBinding = BUCKET_API_RECEIPT_WRITER_CAPABILITIES.get(receiptReservation);
  if (!receiptBinding) {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Bucket receipt reservation was untrusted");
  }
  if (!journalBinding || !transportBinding || !inspectorBinding
      || journalBinding.planSha256 !== plan.planSha256
      || journalBinding.operationId !== operationIdentity.operationId
      || journalBinding.approvalSha256 !== operationIdentity.approvalSha256
      || journalBinding.executionHostSha256 !== operationIdentity.executionHostSha256
      || journalBinding.operationRootSha256 !== operationIdentity.operationRootSha256
      || journalBinding.scope !== operationIdentity.scope
      || journalBinding.projectRef !== APPROVED_STAGING_PROJECT_REF
      || journalBinding.productionProjectRef !== APPROVED_PRODUCTION_PROJECT_REF
      || transportBinding.projectRef !== APPROVED_STAGING_PROJECT_REF
      || inspectorBinding.projectRef !== APPROVED_STAGING_PROJECT_REF
      || canonicalJson(receiptBinding.operationIdentity) !== canonicalJson(operationIdentity)
      || receiptBinding.planSha256 !== plan.planSha256
      || receiptBinding.operationRootSha256 !== operationIdentity.operationRootSha256
      || transportBinding.productionProjectRef !== APPROVED_PRODUCTION_PROJECT_REF
      || inspectorBinding.productionProjectRef !== APPROVED_PRODUCTION_PROJECT_REF) {
    fail("STORAGE_BUCKET_API_RUNNER_CAPABILITY_INVALID", "Bucket runner dependency was untrusted");
  }
  await assertBucketApiReceiptReservationReady(receiptReservation);
}

function bucketApiJournalRecord({
  phase,
  actionId = null,
  actionIndex,
  attempt,
  planSha256,
  at,
  observedOutcome = null,
  receiptSha256,
  finalSnapshotObservedAt,
  finalSnapshotFingerprintSha256,
}) {
  const record = {
    journalVersion: 1,
    kind: "amora-successor-storage-bucket-api-journal-record",
    phase,
    actionId,
    actionIndex,
    attempt,
    planSha256,
    at,
    observedOutcome,
  };
  if (phase === "verified_s1") {
    record.receiptSha256 = receiptSha256;
    record.finalSnapshotObservedAt = finalSnapshotObservedAt;
    record.finalSnapshotFingerprintSha256 = finalSnapshotFingerprintSha256;
  }
  return Object.freeze(record);
}

function publicBucketApiJournalRecord(record) {
  const publicRecord = { ...record };
  delete publicRecord.identityMarker;
  return publicRecord;
}

function bucketApiRecoveryAuthorizationRecord(binding, plan, records, at) {
  const operational = [...records].reverse().find(
    (record) => record.phase !== "recovery_authorized",
  );
  return Object.freeze({
    journalVersion: 1,
    kind: "amora-successor-storage-bucket-api-journal-record",
    phase: "recovery_authorized",
    actionId: null,
    actionIndex: operational?.actionIndex ?? 0,
    attempt: 0,
    planSha256: plan.planSha256,
    at,
    observedOutcome: null,
    recoveryApprovalSha256: binding.recoveryApprovalSha256,
    predecessorAuthorizationSha256: binding.predecessorAuthorizationSha256,
    authorizedJournalRecordCount: records.length,
    authorizedJournalChainSha256: bucketApiJournalChainSha256(records),
  });
}

function exactBucketApiPostRead(read, target) {
  return read?.outcome === "found" && read.bucket
    && bucketConfigMatches(read.bucket, target);
}

function assertBucketApiRecoveryMutationResult(mutation, read, target) {
  if (mutation?.outcome === "rejected") {
    if (exactBucketApiPostRead(read, target)) {
      fail(
        "STORAGE_BUCKET_API_CONCURRENT_MUTATION_DETECTED",
        "A rejected recovery mutation matched an unowned concurrent result",
      );
    }
    fail("STORAGE_BUCKET_API_MUTATION_REJECTED", "Storage bucket recovery mutation was rejected");
  }
  if (!mutation || !["accepted", "unknown"].includes(mutation.outcome)) {
    fail("STORAGE_BUCKET_API_MUTATION_RESULT_INVALID", "Storage bucket recovery result was invalid");
  }
  if (!exactBucketApiPostRead(read, target)) {
    fail("STORAGE_BUCKET_API_MANUAL_RECOVERY_REQUIRED", "Bucket recovery did not reach exact state");
  }
  return mutation.outcome;
}

function bucketApiSnapshotFingerprint(snapshot) {
  return sha256(canonicalJson({
    relationOwner: snapshot.relationOwner,
    relationRlsEnabled: snapshot.relationRlsEnabled,
    relationForceRls: snapshot.relationForceRls,
    buckets: snapshot.buckets,
    policies: snapshot.policies,
    helperContracts: snapshot.helperContracts,
    fence: snapshot.fence,
    totalObjectCount: snapshot.totalObjectCount,
    objectInventorySha256: snapshot.objectInventorySha256,
  }));
}

async function inspectFreshBucketApiSnapshot({
  inspectSnapshot,
  context,
  freshnessState,
}) {
  if (!BUCKET_API_INSPECTOR_CAPABILITIES.has(inspectSnapshot)) {
    fail("STORAGE_BUCKET_API_SNAPSHOT_STALE", "Storage bucket inspector was not trusted");
  }
  const snapshot = await inspectSnapshot(context);
  const observedAt = Date.parse(snapshot?.observedAt ?? "");
  if (!Number.isFinite(observedAt)
      || (freshnessState.lastObservedAt !== null
        && observedAt < freshnessState.lastObservedAt)) {
    fail("STORAGE_BUCKET_API_SNAPSHOT_STALE", "Storage bucket snapshot was not request-fresh");
  }
  freshnessState.lastObservedAt = observedAt;
  return snapshot;
}

function validateBucketApiOperationIdentity(identity) {
  const expectedKeys = [
    "approvedAt",
    "approvalSha256",
    "authorizedModes",
    "executionHostSha256",
    "expiresAt",
    "operationId",
    "operationRootSha256",
    "planSha256",
    "productionProjectRef",
    "projectRef",
    "scope",
    "toolGitCommit",
  ];
  if (!hasExactKeys(identity, expectedKeys)
      || identity.projectRef !== APPROVED_STAGING_PROJECT_REF
      || identity.productionProjectRef !== APPROVED_PRODUCTION_PROJECT_REF
      || identity.scope !== BUCKET_API_OPERATION_SCOPE
      || !exactArray(identity.authorizedModes, ["apply-buckets", "recover-buckets"])
      || !/^[a-f0-9]{40}$/u.test(identity.toolGitCommit ?? "")
      || !SHA256.test(identity.approvalSha256 ?? "")
      || !SHA256.test(identity.executionHostSha256 ?? "")
      || !SHA256.test(identity.operationRootSha256 ?? "")
      || !SHA256.test(identity.planSha256 ?? "")
      || !canonicalIsoString(identity.approvedAt)
      || !canonicalIsoString(identity.expiresAt)
      || !UUID.test(identity.operationId ?? "")) {
    fail(
      "STORAGE_BUCKET_API_OPERATION_IDENTITY_INVALID",
      "Storage bucket operation identity was invalid",
    );
  }
  return Object.freeze({ ...identity });
}

export function getAmoraSuccessorStorageBucketApiExecutionHostSha256() {
  let kernelIdentity = null;
  if (FILESYSTEM_PLATFORM === "linux") {
    try {
      const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const machineId = readFileSync("/etc/machine-id", "utf8").trim();
      const networkNamespace = statSync("/proc/self/ns/net");
      if (!GENERIC_UUID.test(bootId) || !/^[a-f0-9]{32}$/u.test(machineId)
          || !Number.isSafeInteger(networkNamespace.dev)
          || !Number.isSafeInteger(networkNamespace.ino)
          || typeof process.getuid !== "function") {
        fail("STORAGE_BUCKET_API_EXECUTION_HOST_UNVERIFIED", "Linux host evidence was invalid");
      }
      kernelIdentity = Object.freeze({
        bootIdSha256: sha256(bootId),
        machineIdSha256: sha256(machineId),
        networkNamespaceDevice: networkNamespace.dev,
        networkNamespaceInode: networkNamespace.ino,
        uid: process.getuid(),
      });
    } catch (error) {
      if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
      fail("STORAGE_BUCKET_API_EXECUTION_HOST_UNVERIFIED", "Linux host evidence was unavailable");
    }
  }
  return sha256(canonicalJson({
    architecture: process.arch,
    hostname: hostname().trim().toLowerCase(),
    kernelIdentity,
    platform: FILESYSTEM_PLATFORM,
  }));
}

export function getAmoraSuccessorStorageBucketApiOperationRootSha256(operationRoot) {
  if (typeof operationRoot !== "string" || operationRoot.trim() === ""
      || resolve(operationRoot) !== operationRoot) {
    fail("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID", "Bucket operation root was not absolute");
  }
  let canonicalPath;
  let metadata;
  try {
    canonicalPath = realpathSync(operationRoot);
    metadata = statSync(canonicalPath);
  } catch {
    fail("STORAGE_BUCKET_API_OPERATION_ROOT_UNVERIFIED", "Bucket operation root was unavailable");
  }
  if (canonicalPath !== operationRoot || !metadata.isDirectory()
      || (FILESYSTEM_PLATFORM !== "win32" && (metadata.mode & 0o777) !== 0o700)
      || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    fail("STORAGE_BUCKET_API_OPERATION_ROOT_UNVERIFIED", "Bucket operation root was not canonical");
  }
  return sha256(canonicalJson({
    canonicalPath,
    device: metadata.dev,
    inode: metadata.ino,
    uid: metadata.uid,
  }));
}

export function createAmoraSuccessorStorageBucketApiOperationIdentity({
  approvalContractRaw,
  planSha256,
  toolGitCommit,
  operationId,
  operationRoot,
  now = new Date(),
}) {
  if (typeof approvalContractRaw !== "string"
      || Buffer.byteLength(approvalContractRaw, "utf8") < 2
      || Buffer.byteLength(approvalContractRaw, "utf8") > 16 * 1024
      || !SHA256.test(planSha256 ?? "")
      || !/^[a-f0-9]{40}$/u.test(toolGitCommit ?? "")
      || !UUID.test(operationId ?? "")
      || typeof operationRoot !== "string"
      || !(now instanceof Date) || !Number.isFinite(now.valueOf())) {
    fail("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID", "Bucket approval input was invalid");
  }
  let contract;
  try {
    contract = JSON.parse(approvalContractRaw);
  } catch {
    fail("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID", "Bucket approval was not JSON");
  }
  const contractKeys = [
    "approvalEvidence", "approved", "approvedAt", "approvedGitCommit",
    "approvedPlanSha256", "authorizedModes", "contractVersion", "expiresAt", "kind",
    "executionHostSha256", "mutationAuthorization", "notice", "operationId",
    "operationRootSha256", "productionProjectRef", "projectRef", "revokedAt", "scope",
    "status", "targetBucketContractSha256",
  ];
  const approvedAt = Date.parse(contract?.approvedAt ?? "");
  const expiresAt = Date.parse(contract?.expiresAt ?? "");
  if (!hasExactKeys(contract, contractKeys)
      || contract.contractVersion !== 1
      || contract.kind !== "amora-successor-storage-bucket-api-staging-v1"
      || contract.scope !== BUCKET_API_OPERATION_SCOPE
      || contract.status !== "approved_for_storage_bucket_api_staging_mutation"
      || contract.approved !== true
      || contract.projectRef !== APPROVED_STAGING_PROJECT_REF
      || contract.productionProjectRef !== APPROVED_PRODUCTION_PROJECT_REF
      || !exactArray(contract.authorizedModes, ["apply-buckets", "recover-buckets"])
      || !SHA256.test(contract.approvalEvidence ?? "")
      || !canonicalIsoString(contract.approvedAt)
      || !canonicalIsoString(contract.expiresAt)
      || !Number.isFinite(approvedAt) || !Number.isFinite(expiresAt)
      || expiresAt <= approvedAt || expiresAt - approvedAt > 30 * 60 * 1000
      || now.valueOf() < approvedAt || now.valueOf() >= expiresAt
      || contract.approvedGitCommit !== toolGitCommit
      || contract.approvedPlanSha256 !== planSha256
      || contract.targetBucketContractSha256 !== BUCKET_API_TARGET_CONTRACT_SHA256
      || contract.operationId !== operationId
      || contract.operationRootSha256
        !== getAmoraSuccessorStorageBucketApiOperationRootSha256(operationRoot)
      || contract.executionHostSha256
        !== getAmoraSuccessorStorageBucketApiExecutionHostSha256()
      || contract.revokedAt !== null
      || !hasExactKeys(contract.mutationAuthorization, ["authorized", "reason"])
      || contract.mutationAuthorization.authorized !== true
      || contract.mutationAuthorization.reason !== "USER_MUTATION_APPROVAL_RECORDED"
      || contract.notice !== "Explicit staging-only S0 to S1 bucket mutation approval.") {
    fail("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID", "Bucket approval was not exact and active");
  }
  const identity = validateBucketApiOperationIdentity({
    approvedAt: contract.approvedAt,
    approvalSha256: sha256(approvalContractRaw),
    authorizedModes: Object.freeze([...contract.authorizedModes]),
    executionHostSha256: contract.executionHostSha256,
    expiresAt: contract.expiresAt,
    operationId,
    operationRootSha256: contract.operationRootSha256,
    planSha256,
    productionProjectRef: contract.productionProjectRef,
    projectRef: contract.projectRef,
    scope: contract.scope,
    toolGitCommit,
  });
  BUCKET_API_OPERATION_IDENTITIES.add(identity);
  return identity;
}

export function restoreAmoraSuccessorStorageBucketApiOperationIdentityForRecovery({
  approvalContractRaw,
  planSha256,
  toolGitCommit,
  operationId,
  operationRoot,
  now = new Date(),
}) {
  if (typeof approvalContractRaw !== "string"
      || Buffer.byteLength(approvalContractRaw, "utf8") < 2
      || Buffer.byteLength(approvalContractRaw, "utf8") > 16 * 1024
      || !(now instanceof Date) || !Number.isFinite(now.valueOf())) {
    fail("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID", "Bucket recovery provenance was invalid");
  }
  let contract;
  try {
    contract = JSON.parse(approvalContractRaw);
  } catch {
    fail("STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID", "Bucket approval was not JSON");
  }
  const approvedAt = Date.parse(contract?.approvedAt ?? "");
  const expiresAt = Date.parse(contract?.expiresAt ?? "");
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt)
      || now.valueOf() < expiresAt) {
    fail(
      "STORAGE_BUCKET_API_MUTATION_APPROVAL_INVALID",
      "Only an expired exact bucket approval can be restored for recovery",
    );
  }
  const identity = createAmoraSuccessorStorageBucketApiOperationIdentity({
    approvalContractRaw,
    planSha256,
    toolGitCommit,
    operationId,
    operationRoot,
    now: new Date(approvedAt),
  });
  BUCKET_API_RECOVERY_ONLY_OPERATION_IDENTITIES.add(identity);
  return identity;
}

function bucketApiJournalChainSha256(records) {
  return sha256(canonicalJson(records));
}

export function createAmoraSuccessorStorageBucketApiRecoveryAuthorization({
  approvalContractRaw,
  operationIdentity,
  plan,
  now = new Date(),
}) {
  assertBucketApiOperationIdentityProvenance(operationIdentity);
  if (typeof approvalContractRaw !== "string"
      || Buffer.byteLength(approvalContractRaw, "utf8") < 2
      || Buffer.byteLength(approvalContractRaw, "utf8") > 16 * 1024
      || !plan || plan.planSha256 !== operationIdentity.planSha256
      || plan.targetBucketContractSha256 !== BUCKET_API_TARGET_CONTRACT_SHA256
      || !(now instanceof Date) || !Number.isFinite(now.valueOf())) {
    fail(
      "STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID",
      "Storage bucket recovery approval input was invalid",
    );
  }
  let contract;
  try {
    contract = JSON.parse(approvalContractRaw);
  } catch {
    fail("STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID", "Recovery approval was not JSON");
  }
  const contractKeys = [
    "approvalEvidence", "approved", "approvedAt", "approvedGitCommit",
    "approvedPlanSha256", "authorizedModes", "contractVersion", "executionHostSha256",
    "expiresAt", "journalChainSha256", "journalRecordCount", "kind",
    "mutationAuthorization", "notice", "operationId", "operationRootSha256",
    "originalApprovalSha256", "predecessorAuthorizationSha256", "productionProjectRef",
    "projectRef", "revokedAt", "scope", "status", "targetBucketContractSha256",
  ];
  const approvedAt = Date.parse(contract?.approvedAt ?? "");
  const expiresAt = Date.parse(contract?.expiresAt ?? "");
  if (!hasExactKeys(contract, contractKeys)
      || contract.contractVersion !== 1
      || contract.kind !== "amora-successor-storage-bucket-api-recovery-v1"
      || contract.status !== "approved_for_storage_bucket_api_recovery"
      || contract.approved !== true
      || contract.scope !== BUCKET_API_OPERATION_SCOPE
      || contract.projectRef !== operationIdentity.projectRef
      || contract.productionProjectRef !== operationIdentity.productionProjectRef
      || !exactArray(contract.authorizedModes, ["recover-buckets"])
      || contract.originalApprovalSha256 !== operationIdentity.approvalSha256
      || contract.operationId !== operationIdentity.operationId
      || contract.approvedPlanSha256 !== plan.planSha256
      || contract.targetBucketContractSha256 !== BUCKET_API_TARGET_CONTRACT_SHA256
      || contract.approvedGitCommit !== operationIdentity.toolGitCommit
      || contract.operationRootSha256 !== operationIdentity.operationRootSha256
      || contract.executionHostSha256 !== operationIdentity.executionHostSha256
      || contract.executionHostSha256
        !== getAmoraSuccessorStorageBucketApiExecutionHostSha256()
      || !SHA256.test(contract.approvalEvidence ?? "")
      || !Number.isSafeInteger(contract.journalRecordCount)
      || contract.journalRecordCount < 1 || contract.journalRecordCount > 64
      || !SHA256.test(contract.journalChainSha256 ?? "")
      || (contract.predecessorAuthorizationSha256 !== null
        && !SHA256.test(contract.predecessorAuthorizationSha256 ?? ""))
      || !canonicalIsoString(contract.approvedAt)
      || !canonicalIsoString(contract.expiresAt)
      || !Number.isFinite(approvedAt) || !Number.isFinite(expiresAt)
      || expiresAt <= approvedAt || expiresAt - approvedAt > 30 * 60 * 1000
      || now.valueOf() < approvedAt || now.valueOf() >= expiresAt
      || contract.revokedAt !== null
      || !hasExactKeys(contract.mutationAuthorization, ["authorized", "reason"])
      || contract.mutationAuthorization.authorized !== true
      || contract.mutationAuthorization.reason !== "USER_RECOVERY_APPROVAL_RECORDED"
      || contract.notice !== "Explicit staging-only forward recovery approval.") {
    fail(
      "STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID",
      "Storage bucket recovery approval was not exact and active",
    );
  }
  const authorization = Object.freeze({});
  BUCKET_API_RECOVERY_AUTHORIZATIONS.set(authorization, Object.freeze({
    approvedAt: contract.approvedAt,
    expiresAt: contract.expiresAt,
    journalChainSha256: contract.journalChainSha256,
    journalRecordCount: contract.journalRecordCount,
    operationIdentity,
    planSha256: plan.planSha256,
    predecessorAuthorizationSha256: contract.predecessorAuthorizationSha256,
    recoveryApprovalSha256: sha256(approvalContractRaw),
  }));
  return authorization;
}

function assertBucketApiOperationIdentityProvenance(identity) {
  if (!BUCKET_API_OPERATION_IDENTITIES.has(identity)) {
    fail(
      "STORAGE_BUCKET_API_OPERATION_IDENTITY_INVALID",
      "Storage bucket operation identity was not minted from active approval",
    );
  }
  return identity;
}

function bucketApiOperationIdentityIsActive(identity, currentTime = Date.now()) {
  assertBucketApiOperationIdentityProvenance(identity);
  return !BUCKET_API_RECOVERY_ONLY_OPERATION_IDENTITIES.has(identity)
    && currentTime >= Date.parse(identity.approvedAt)
    && currentTime < Date.parse(identity.expiresAt);
}

function assertBucketApiAuthorizedOperationIdentity(identity) {
  assertBucketApiOperationIdentityProvenance(identity);
  const currentTime = Date.now();
  if (!bucketApiOperationIdentityIsActive(identity, currentTime)) {
    fail(
      "STORAGE_BUCKET_API_MUTATION_APPROVAL_EXPIRED",
      "Storage bucket mutation approval is no longer active",
    );
  }
  return identity;
}

function createBucketApiMutationCapability(
  operationIdentity,
  journal,
  operationLease,
  receiptReservation,
  recoveryAuthorization = null,
) {
  const capability = Object.freeze({});
  BUCKET_API_MUTATION_CAPABILITIES.set(capability, Object.freeze({
    journal,
    operationIdentity,
    operationLease,
    receiptReservation,
    recoveryAuthorization,
  }));
  return capability;
}

async function assertBucketApiRecoveryAuthorization(
  recoveryAuthorization,
  operationIdentity,
  journal,
  operationLease,
) {
  const binding = BUCKET_API_RECOVERY_AUTHORIZATIONS.get(recoveryAuthorization);
  const currentTime = Date.now();
  if (!binding || binding.operationIdentity !== operationIdentity
      || binding.planSha256 !== operationIdentity.planSha256
      || currentTime < Date.parse(binding.approvedAt)
      || currentTime >= Date.parse(binding.expiresAt)) {
    fail(
      "STORAGE_BUCKET_API_RECOVERY_APPROVAL_EXPIRED",
      "Storage bucket recovery authorization was unavailable or expired",
    );
  }
  await journal.assertOperationIdentity(operationIdentity);
  await journal.assertOperationLease(operationLease);
  await journal.assertRecoveryAuthorization(binding.recoveryApprovalSha256);
  return binding;
}

async function assertBucketApiMutationCapability(
  capability,
  { projectRef, productionProjectRef },
) {
  assertAmoraSuccessorStorageStagingConvergenceMutationPlatform();
  const binding = BUCKET_API_MUTATION_CAPABILITIES.get(capability);
  if (!binding) {
    fail(
      "STORAGE_BUCKET_API_MUTATION_CAPABILITY_INVALID",
      "Storage bucket write lacked a runner-bound capability",
    );
  }
  const identity = binding.recoveryAuthorization === null
    ? assertBucketApiAuthorizedOperationIdentity(binding.operationIdentity)
    : assertBucketApiOperationIdentityProvenance(binding.operationIdentity);
  if (identity.projectRef !== projectRef
      || identity.productionProjectRef !== productionProjectRef
      || identity.scope !== BUCKET_API_OPERATION_SCOPE) {
    fail("STORAGE_BUCKET_API_MUTATION_CAPABILITY_INVALID", "Storage capability target drifted");
  }
  await binding.journal.assertOperationIdentity(identity);
  await binding.journal.assertOperationLease(binding.operationLease);
  await assertBucketApiReceiptReservationReady(binding.receiptReservation, { requireEmpty: true });
  if (binding.recoveryAuthorization !== null) {
    await assertBucketApiRecoveryAuthorization(
      binding.recoveryAuthorization,
      identity,
      binding.journal,
      binding.operationLease,
    );
  }
}

export async function runAmoraSuccessorStorageBucketApiConvergence({
  initialSnapshot,
  plan,
  operationIdentity: rawOperationIdentity,
  journal,
  transport,
  inspectSnapshot,
  receiptReservation,
  now = () => new Date(),
}) {
  assertAmoraSuccessorStorageStagingConvergenceMutationPlatform();
  const operationIdentity = assertBucketApiAuthorizedOperationIdentity(rawOperationIdentity);
  await assertBucketApiRunnerDependencies({
    plan,
    operationIdentity,
    journal,
    transport,
    inspectSnapshot,
    receiptReservation,
    now,
  });
  await journal.assertOperationIdentity(operationIdentity);
  const operationLease = await journal.acquireOperationLease();
  try {
    await journal.assertOperationLease(operationLease);
  const freshnessState = { lastObservedAt: null };
  const baseline = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(initialSnapshot);
  const expectedPlan = planAmoraSuccessorStorageBucketApiConvergence(baseline);
  if (expectedPlan.classification !== "S0"
      || canonicalJson(plan) !== canonicalJson(expectedPlan)) {
    fail("STORAGE_BUCKET_API_PLAN_MISMATCH", "Storage bucket runner plan was not the exact S0 plan");
  }
  let freshBaseline;
  try {
    freshBaseline = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(
      await inspectFreshBucketApiSnapshot({
        inspectSnapshot,
        context: { stage: "preflight", planSha256: plan.planSha256 },
        freshnessState,
      }),
    );
  } catch {
    fail("STORAGE_BUCKET_API_PREFLIGHT_FAILED", "Storage bucket preflight snapshot was invalid");
  }
  if (classifyBucketApiSnapshot(freshBaseline) !== "S0"
      || bucketApiSnapshotFingerprint(freshBaseline)
        !== bucketApiSnapshotFingerprint(baseline)) {
    fail("STORAGE_BUCKET_API_PREFLIGHT_FAILED", "Storage bucket preflight drifted from its plan");
  }
  const startedAt = now();
  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.valueOf())) {
    fail("STORAGE_BUCKET_API_RUNNER_INVALID", "Storage bucket runner clock was invalid");
  }
  await journal.append(bucketApiJournalRecord({
    phase: "prepared",
    actionIndex: 0,
    attempt: 0,
    planSha256: plan.planSha256,
    at: startedAt.toISOString(),
  }));

  for (const [actionIndex, action] of BUCKET_API_ACTIONS.entries()) {
    const target = TARGET_BUCKETS.find((entry) => entry.id === action.bucketId);
    await inspectBucketApiApplyPrefix({
      inspectSnapshot,
      baseline,
      plan,
      actionIndex,
      freshnessState,
    });
    await journal.append(bucketApiJournalRecord({
      phase: "intent",
      actionId: action.id,
      actionIndex,
      attempt: 1,
      planSha256: plan.planSha256,
      at: now().toISOString(),
    }));
    assertBucketApiAuthorizedOperationIdentity(operationIdentity);
    await journal.assertOperationLease(operationLease);
    const mutationCapability = createBucketApiMutationCapability(
      operationIdentity,
      journal,
      operationLease,
      receiptReservation,
    );
    const mutation = action.kind === "create_bucket"
      ? await transport.createBucket(action.bucketId, mutationCapability)
      : await transport.updateVendorImages(mutationCapability);
    const read = await transport.getBucket(action.bucketId);
    if (mutation?.outcome === "rejected") {
      if (exactBucketApiPostRead(read, target)) {
        fail(
          "STORAGE_BUCKET_API_CONCURRENT_MUTATION_DETECTED",
          "A fresh rejected bucket mutation matched an unowned concurrent result",
        );
      }
      fail("STORAGE_BUCKET_API_MUTATION_REJECTED", "Storage bucket mutation was rejected");
    }
    if (!exactBucketApiPostRead(read, target)) {
      if (read?.outcome === "absent" || read?.outcome === "unknown") {
        fail(
          "STORAGE_BUCKET_API_RECOVERY_REQUIRED",
          "Storage bucket mutation outcome requires journal-bound forward recovery",
        );
      }
      fail("STORAGE_BUCKET_API_POST_READ_DRIFT", "Storage bucket post-read drifted");
    }
    if (!mutation || !["accepted", "unknown"].includes(mutation.outcome)) {
      fail("STORAGE_BUCKET_API_MUTATION_RESULT_INVALID", "Storage bucket result was invalid");
    }
    await journal.append(bucketApiJournalRecord({
      phase: "observed",
      actionId: action.id,
      actionIndex,
      attempt: 1,
      planSha256: plan.planSha256,
      at: now().toISOString(),
      observedOutcome: mutation.outcome,
    }));
  }

  let finalSnapshot;
  try {
    finalSnapshot = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(
      await inspectFreshBucketApiSnapshot({
        inspectSnapshot,
        context: { stage: "final", planSha256: plan.planSha256 },
        freshnessState,
      }),
    );
  } catch {
    fail("STORAGE_BUCKET_API_POSTCONDITION_FAILED", "Storage bucket final snapshot was invalid");
  }
  const finalVendor = vendorSafety(finalSnapshot);
  if (classifyBucketApiSnapshot(finalSnapshot) !== "S1"
      || finalSnapshot.totalObjectCount !== plan.baselineObjectCount
      || finalSnapshot.objectInventorySha256 !== plan.baselineObjectInventorySha256
      || !finalVendor
      || finalVendor.objectCount !== plan.vendorSafety.objectCount
      || finalVendor.objectInventorySha256 !== plan.vendorSafety.objectInventorySha256
      || finalVendor.oversizeObjectCount !== 0
      || finalVendor.disallowedMimeObjectCount !== 0
      || finalVendor.missingMetadataObjectCount !== 0) {
    fail(
      "STORAGE_BUCKET_API_POSTCONDITION_FAILED",
      "Storage bucket final policy, object, or configuration invariant drifted",
    );
  }
  const finalSnapshotEvidence = createBucketApiFinalSnapshotEvidence(finalSnapshot);
  const completedAt = now().toISOString();
  const operationRecords = validateInjectedBucketApiJournalChain(await journal.read(), plan);
  const receipt = createBucketApiCompletionReceipt(
    plan,
    operationIdentity,
    operationRecords,
    completedAt,
    finalSnapshotEvidence,
  );
  await journal.append(bucketApiJournalRecord({
    phase: "verified_s1",
    actionIndex: BUCKET_API_ACTIONS.length,
    attempt: 1,
    planSha256: plan.planSha256,
    at: completedAt,
    receiptSha256: receipt.receiptSha256,
    finalSnapshotObservedAt: finalSnapshotEvidence.observedAt,
    finalSnapshotFingerprintSha256:
      finalSnapshotEvidence.canonicalFingerprintSha256,
  }));
  return receipt;
  } finally {
    try {
      await journal.releaseOperationLease(operationLease);
    } finally {
      await receiptReservation.close();
    }
  }
}

function validateBucketApiJournalIdentity(identity) {
  const expectedKeys = [
    "actionManifestSha256",
    "approvedAt",
    "approvalSha256",
    "authorizedModes",
    "executionHostSha256",
    "expiresAt",
    "operationId",
    "operationRootSha256",
    "planSha256",
    "productionProjectRef",
    "projectRef",
    "scope",
    "toolGitCommit",
  ];
  if (!hasExactKeys(identity, expectedKeys)
      || identity.projectRef !== APPROVED_STAGING_PROJECT_REF
      || identity.productionProjectRef !== APPROVED_PRODUCTION_PROJECT_REF
      || identity.scope !== BUCKET_API_OPERATION_SCOPE
      || !exactArray(identity.authorizedModes, ["apply-buckets", "recover-buckets"])
      || !/^[a-f0-9]{40}$/u.test(identity.toolGitCommit ?? "")
      || !SHA256.test(identity.approvalSha256 ?? "")
      || !SHA256.test(identity.executionHostSha256 ?? "")
      || !SHA256.test(identity.operationRootSha256 ?? "")
      || identity.executionHostSha256
        !== getAmoraSuccessorStorageBucketApiExecutionHostSha256()
      || !canonicalIsoString(identity.approvedAt)
      || !canonicalIsoString(identity.expiresAt)
      || !SHA256.test(identity.planSha256 ?? "")
      || identity.actionManifestSha256 !== BUCKET_API_TARGET_CONTRACT_SHA256
      || !UUID.test(identity.operationId ?? "")) {
    fail("STORAGE_BUCKET_API_JOURNAL_IDENTITY_INVALID", "Storage bucket journal identity was invalid");
  }
  return Object.freeze({ ...identity });
}

function validateBucketApiJournalRecord(record, identityMarker, identity) {
  const expectedKeys = [
    "actionId", "actionIndex", "at", "attempt", "identityMarker", "journalVersion",
    "kind", "observedOutcome", "phase", "planSha256",
  ];
  if (record?.phase === "verified_s1") {
    expectedKeys.push("receiptSha256");
    if (record.finalSnapshotObservedAt !== undefined
        || record.finalSnapshotFingerprintSha256 !== undefined) {
      expectedKeys.push("finalSnapshotFingerprintSha256", "finalSnapshotObservedAt");
    }
  }
  if (record?.phase === "recovery_authorized") {
    expectedKeys.push(
      "authorizedJournalChainSha256",
      "authorizedJournalRecordCount",
      "predecessorAuthorizationSha256",
      "recoveryApprovalSha256",
    );
  }
  if (!hasExactKeys(record, expectedKeys)
      || record.identityMarker !== identityMarker
      || record.journalVersion !== 1
      || record.kind !== "amora-successor-storage-bucket-api-journal-record"
      || !["prepared", "intent", "observed", "recovery_authorized", "verified_s1"]
        .includes(record.phase)
      || !Number.isSafeInteger(record.actionIndex) || record.actionIndex < 0
      || record.actionIndex > BUCKET_API_ACTIONS.length
      || !Number.isSafeInteger(record.attempt) || record.attempt < 0 || record.attempt > 3
      || record.planSha256 !== identity.planSha256
      || !canonicalIsoString(record.at)
      || (record.actionId !== null && typeof record.actionId !== "string")
      || (record.observedOutcome !== null
        && !["accepted", "unknown"].includes(record.observedOutcome))) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal record was invalid");
  }
  if (record.phase === "prepared"
      && (record.actionId !== null || record.actionIndex !== 0
        || record.attempt !== 0 || record.observedOutcome !== null)) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal start was invalid");
  }
  if (["intent", "observed"].includes(record.phase)) {
    const action = BUCKET_API_ACTIONS[record.actionIndex];
    if (!action || record.actionId !== action.id || record.attempt < 1
        || (record.phase === "intent" && record.observedOutcome !== null)
        || (record.phase === "observed" && record.observedOutcome === null)) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal action was invalid");
    }
  }
  if (record.phase === "verified_s1"
      && (record.actionId !== null || record.actionIndex !== BUCKET_API_ACTIONS.length
        || record.observedOutcome !== null || record.attempt !== 1
        || !SHA256.test(record.receiptSha256 ?? "")
        || ((record.finalSnapshotObservedAt !== undefined
          || record.finalSnapshotFingerprintSha256 !== undefined)
          && (!canonicalIsoString(record.finalSnapshotObservedAt)
            || !SHA256.test(record.finalSnapshotFingerprintSha256 ?? ""))))) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal final state was invalid");
  }
  if (record.phase === "recovery_authorized"
      && (record.actionId !== null || record.attempt !== 0 || record.observedOutcome !== null
        || !SHA256.test(record.recoveryApprovalSha256 ?? "")
        || (record.predecessorAuthorizationSha256 !== null
          && !SHA256.test(record.predecessorAuthorizationSha256 ?? ""))
        || !Number.isSafeInteger(record.authorizedJournalRecordCount)
        || record.authorizedJournalRecordCount < 1
        || !SHA256.test(record.authorizedJournalChainSha256 ?? ""))) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket recovery authorization was invalid");
  }
  return Object.freeze({ ...record });
}

function assertBucketApiJournalTransition(previous, current, index, history = []) {
  if (index === 0) {
    if (current.phase !== "prepared") {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal lacked a prepared start");
    }
    return;
  }
  if (current.phase === "recovery_authorized") {
    const lastAuthorization = [...history].reverse().find(
      (record) => record.phase === "recovery_authorized",
    );
    if (!previous || previous.phase === "verified_s1"
        || current.predecessorAuthorizationSha256
          !== (lastAuthorization?.recoveryApprovalSha256 ?? null)
        || current.authorizedJournalRecordCount !== history.length
        || current.authorizedJournalChainSha256 !== bucketApiJournalChainSha256(
          history.map(publicBucketApiJournalRecord),
        )) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Recovery authorization chain drifted");
    }
    return;
  }
  if (previous.phase === "recovery_authorized") {
    const previousOperational = [...history].reverse().find(
      (record) => record.phase !== "recovery_authorized",
    );
    if (!previousOperational) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Recovery authorization lacked an operation");
    }
    return assertBucketApiJournalTransition(previousOperational, current, index, history);
  }
  if (previous.phase === "prepared") {
    if (current.phase !== "intent" || current.actionIndex !== 0 || current.attempt !== 1) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal skipped its first intent");
    }
    return;
  }
  if (previous.phase === "intent") {
    const observed = current.phase === "observed"
      && current.actionIndex === previous.actionIndex
      && current.actionId === previous.actionId
      && current.attempt === previous.attempt;
    const recoveredIntent = current.phase === "intent"
      && current.actionIndex === previous.actionIndex
      && current.actionId === previous.actionId
      && current.attempt === previous.attempt + 1;
    if (!observed && !recoveredIntent) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal intent was not reconciled");
    }
    return;
  }
  if (previous.phase === "observed") {
    const nextIntent = current.phase === "intent"
      && previous.actionIndex < BUCKET_API_ACTIONS.length - 1
      && current.actionIndex === previous.actionIndex + 1
      && current.attempt === 1;
    const verified = current.phase === "verified_s1"
      && previous.actionIndex === BUCKET_API_ACTIONS.length - 1;
    if (!nextIntent && !verified) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal action order drifted");
    }
    return;
  }
  fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal continued after verification");
}

async function assertBucketApiJournalHandle(path, handle) {
  let handleStat;
  let pathStat;
  try {
    [handleStat, pathStat] = await Promise.all([handle.stat(), lstat(path)]);
  } catch {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal path changed");
  }
  if (!handleStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
      || handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal inode changed");
  }
}

function assertCanonicalBucketApiRepoRoot(repoRoot, errorCode) {
  let canonical;
  try {
    canonical = realpathSync(resolve(repoRoot));
  } catch {
    fail(errorCode, "Storage bucket repository root was unavailable");
  }
  if (canonical !== CANONICAL_REPO_ROOT) {
    fail(errorCode, "Storage bucket repository root was not the executing checkout");
  }
  return canonical;
}

function assertBucketApiOperationRootUnchanged(operationRoot, expectedSha256) {
  let currentSha256;
  try {
    currentSha256 = getAmoraSuccessorStorageBucketApiOperationRootSha256(operationRoot);
  } catch {
    fail("STORAGE_BUCKET_API_OPERATION_ROOT_CHANGED", "Bucket operation root changed");
  }
  if (currentSha256 !== expectedSha256) {
    fail("STORAGE_BUCKET_API_OPERATION_ROOT_CHANGED", "Bucket operation root changed");
  }
}

async function assertBucketApiReceiptHandle(path, handle) {
  let handleStat;
  let pathStat;
  try {
    [handleStat, pathStat] = await Promise.all([handle.stat(), lstat(path)]);
  } catch {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Storage bucket receipt path changed");
  }
  if (!handleStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
      || handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino
      || (FILESYSTEM_PLATFORM !== "win32" && (handleStat.mode & 0o777) !== 0o600)) {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Storage bucket receipt inode changed");
  }
  return handleStat;
}

async function openAmoraSuccessorStorageBucketApiReceiptReservation({
  repoRoot,
  operationRoot,
  operationIdentity: rawOperationIdentity,
  plan,
  syncParentDirectoryImpl,
  restoreExisting,
}) {
  const setupErrorCode = restoreExisting
    ? "STORAGE_BUCKET_API_RECEIPT_RECOVERY_INVALID"
    : "STORAGE_BUCKET_API_RECEIPT_RESERVATION_FAILED";
  const operationIdentity = assertBucketApiOperationIdentityProvenance(rawOperationIdentity);
  if (!plan || plan.planSha256 !== operationIdentity.planSha256
      || plan.targetBucketContractSha256 !== BUCKET_API_TARGET_CONTRACT_SHA256
      || typeof operationRoot !== "string") {
    fail(setupErrorCode, "Bucket receipt identity was invalid");
  }
  const canonicalRepoRoot = assertCanonicalBucketApiRepoRoot(
    repoRoot,
    setupErrorCode,
  );
  try {
    assertBucketApiOperationRootUnchanged(operationRoot, operationIdentity.operationRootSha256);
  } catch {
    fail(setupErrorCode, "Bucket receipt operation root changed");
  }
  let targetPath;
  try {
    targetPath = assertAmoraSuccessorStorageExternalOutputPath({
      repoRoot: canonicalRepoRoot,
      targetPath: resolve(operationRoot, `${operationIdentity.operationId}.receipt.json`),
    });
  } catch {
    fail(setupErrorCode, "Bucket receipt path was not external");
  }
  if (dirname(targetPath) !== operationRoot) {
    fail(setupErrorCode, "Bucket receipt root was not approval-bound");
  }
  let handle;
  let reservedMetadata;
  let createdByThisCall = false;
  const syncParent = syncParentDirectoryImpl ?? (async function syncReceiptParent() {
    let directoryHandle;
    try {
      directoryHandle = await open(dirname(targetPath), "r");
      await directoryHandle.sync();
    } catch {
      fail(setupErrorCode, "Receipt parent was not synchronized");
    } finally {
      await directoryHandle?.close();
    }
  });
  if (typeof syncParent !== "function"
      || (syncParentDirectoryImpl !== undefined && FILESYSTEM_PLATFORM !== "win32")) {
    fail(setupErrorCode, "Receipt sync boundary was invalid");
  }
  try {
    handle = await open(targetPath, restoreExisting ? "r+" : "wx+", 0o600);
    createdByThisCall = !restoreExisting;
    reservedMetadata = await handle.stat();
    if (!restoreExisting) await handle.chmod(0o600);
    reservedMetadata = await assertBucketApiReceiptHandle(targetPath, handle);
    if (!restoreExisting) {
      await handle.sync();
      await syncParent();
    }
    if (restoreExisting) {
      if (reservedMetadata.size < 0 || reservedMetadata.size > 32 * 1024) {
        fail(setupErrorCode, "Existing bucket receipt size was invalid");
      }
      if (reservedMetadata.size > 0) {
        const buffer = Buffer.alloc(reservedMetadata.size);
        const { bytesRead } = await handle.read(buffer, 0, reservedMetadata.size, 0);
        let existingReceipt;
        try {
          existingReceipt = JSON.parse(buffer.toString("utf8"));
          validateBucketApiCompletionReceipt(existingReceipt);
        } catch {
          fail(setupErrorCode, "Existing bucket receipt was invalid");
        }
        if (bytesRead !== reservedMetadata.size
            || existingReceipt.operationId !== operationIdentity.operationId
            || existingReceipt.approvalSha256 !== operationIdentity.approvalSha256
            || existingReceipt.planSha256 !== plan.planSha256) {
          fail(setupErrorCode, "Existing bucket receipt was not operation-bound");
        }
      }
    }
  } catch (error) {
    await handle?.close().catch(() => {});
    if (createdByThisCall) {
      try {
        const current = await lstat(targetPath);
        if (current.isFile() && !current.isSymbolicLink()
            && (!reservedMetadata || (current.dev === reservedMetadata.dev
              && current.ino === reservedMetadata.ino))) {
          await unlink(targetPath);
          await syncParent().catch(() => {});
        }
      } catch {
        // Preserve the primary reservation failure; never remove an unverified path.
      }
    }
    if (error instanceof AmoraSuccessorStorageStagingConvergenceError) {
      if (error.code === setupErrorCode) throw error;
      fail(setupErrorCode, "Bucket receipt could not be opened safely");
    }
    fail(setupErrorCode, "Bucket receipt could not be reserved");
  }
  const state = {
    handle,
    operationIdentity,
    operationRoot,
    operationRootSha256: operationIdentity.operationRootSha256,
    planSha256: plan.planSha256,
    reservedDevice: reservedMetadata.dev,
    reservedInode: reservedMetadata.ino,
    targetPath,
    writtenSha256: null,
  };
  async function ensureOpen() {
    if (state.handle) return state.handle;
    let reopened;
    try {
      assertBucketApiOperationRootUnchanged(operationRoot, operationIdentity.operationRootSha256);
      reopened = await open(targetPath, "r+");
      const metadata = await assertBucketApiReceiptHandle(targetPath, reopened);
      if (metadata.dev !== state.reservedDevice || metadata.ino !== state.reservedInode) {
        fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Bucket receipt reservation changed");
      }
      state.handle = reopened;
      return state.handle;
    } catch (error) {
      await reopened?.close().catch(() => {});
      if (error instanceof AmoraSuccessorStorageStagingConvergenceError
          && error.code === "STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID") throw error;
      fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Bucket receipt reservation was unavailable");
    }
  }
  state.ensureOpen = ensureOpen;
  const reservation = Object.freeze({
    async abortEmpty() {
      const activeHandle = await ensureOpen();
      const metadata = await assertBucketApiReceiptHandle(targetPath, activeHandle);
      if (metadata.size !== 0) {
        fail("STORAGE_BUCKET_API_RECEIPT_ABORT_REJECTED", "A nonempty bucket receipt cannot be aborted");
      }
      const journalPath = resolve(operationRoot, `${operationIdentity.operationId}.journal.jsonl`);
      try {
        await lstat(journalPath);
        fail("STORAGE_BUCKET_API_RECEIPT_ABORT_REJECTED", "A journaled bucket receipt cannot be aborted");
      } catch (error) {
        if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
        if (error?.code !== "ENOENT") {
          fail("STORAGE_BUCKET_API_RECEIPT_ABORT_REJECTED", "Bucket journal state was unavailable");
        }
      }
      await activeHandle.close();
      state.handle = null;
      const current = await lstat(targetPath);
      if (!current.isFile() || current.isSymbolicLink()
          || current.dev !== state.reservedDevice || current.ino !== state.reservedInode) {
        fail("STORAGE_BUCKET_API_RECEIPT_ABORT_REJECTED", "Bucket receipt inode changed");
      }
      await unlink(targetPath);
      await syncParent();
    },
    async close() {
      if (!state.handle) return;
      await state.handle.close();
      state.handle = null;
    },
    async writeReceipt(receipt) {
      const activeHandle = await ensureOpen();
      validateBucketApiCompletionReceipt(receipt);
      if (receipt.operationId !== operationIdentity.operationId
          || receipt.approvalSha256 !== operationIdentity.approvalSha256
          || receipt.operationRootSha256 !== operationIdentity.operationRootSha256
          || receipt.planSha256 !== plan.planSha256) {
        fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Bucket receipt was not reservation-bound");
      }
      assertBucketApiOperationRootUnchanged(operationRoot, operationIdentity.operationRootSha256);
      const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
      const byteLength = Buffer.byteLength(serialized, "utf8");
      if (byteLength < 2 || byteLength > 32 * 1024) {
        fail("STORAGE_BUCKET_API_RECEIPT_WRITE_FAILED", "Bucket receipt exceeded its bounded size");
      }
      const metadata = await assertBucketApiReceiptHandle(targetPath, activeHandle);
      if (metadata.size === 0) {
        await activeHandle.writeFile(serialized, "utf8");
        await activeHandle.sync();
        await assertBucketApiReceiptHandle(targetPath, activeHandle);
        await syncParent();
        state.writtenSha256 = sha256(serialized);
      } else {
        if (metadata.size !== byteLength) {
          fail("STORAGE_BUCKET_API_RECEIPT_WRITE_FAILED", "Existing bucket receipt bytes drifted");
        }
        const buffer = Buffer.alloc(byteLength);
        const { bytesRead } = await activeHandle.read(buffer, 0, byteLength, 0);
        if (bytesRead !== byteLength || buffer.toString("utf8") !== serialized) {
          fail("STORAGE_BUCKET_API_RECEIPT_WRITE_FAILED", "Existing bucket receipt bytes drifted");
        }
        state.writtenSha256 = sha256(serialized);
      }
      return receipt;
    },
  });
  BUCKET_API_RECEIPT_WRITER_CAPABILITIES.set(reservation, state);
  return reservation;
}

export async function createAmoraSuccessorStorageBucketApiReceiptReservation(input) {
  return openAmoraSuccessorStorageBucketApiReceiptReservation({
    ...input,
    restoreExisting: false,
  });
}

export async function restoreAmoraSuccessorStorageBucketApiReceiptReservationForRecovery(input) {
  return openAmoraSuccessorStorageBucketApiReceiptReservation({
    ...input,
    restoreExisting: true,
  });
}

async function assertBucketApiReceiptReservationReady(
  receiptReservation,
  { requireEmpty = false } = {},
) {
  const state = BUCKET_API_RECEIPT_WRITER_CAPABILITIES.get(receiptReservation);
  if (!state || typeof state.ensureOpen !== "function") {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Bucket receipt reservation was untrusted");
  }
  try {
    assertBucketApiOperationRootUnchanged(state.operationRoot, state.operationRootSha256);
  } catch {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Bucket receipt operation root changed");
  }
  const handle = await state.ensureOpen();
  const metadata = await assertBucketApiReceiptHandle(state.targetPath, handle);
  if (metadata.dev !== state.reservedDevice || metadata.ino !== state.reservedInode
      || metadata.size < 0 || metadata.size > 32 * 1024
      || (requireEmpty && metadata.size !== 0)) {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Bucket receipt reservation was not ready");
  }
  if (metadata.size > 0) {
    const buffer = Buffer.alloc(metadata.size);
    const { bytesRead } = await handle.read(buffer, 0, metadata.size, 0);
    let receipt;
    try {
      receipt = JSON.parse(buffer.toString("utf8"));
      validateBucketApiCompletionReceipt(receipt);
    } catch {
      fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Existing bucket receipt was invalid");
    }
    if (bytesRead !== metadata.size
        || receipt.operationId !== state.operationIdentity.operationId
        || receipt.approvalSha256 !== state.operationIdentity.approvalSha256
        || receipt.planSha256 !== state.planSha256) {
      fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Existing bucket receipt was unbound");
    }
  }
  return state;
}

export function createAmoraSuccessorStorageBucketApiFileJournal({
  repoRoot,
  operationRoot,
  identity: rawIdentity,
  syncParentDirectoryImpl,
  onEvent,
}) {
  const identity = validateBucketApiJournalIdentity(rawIdentity);
  if (typeof repoRoot !== "string" || typeof operationRoot !== "string") {
    fail("STORAGE_BUCKET_API_JOURNAL_PATH_INVALID", "Storage bucket journal paths were invalid");
  }
  const canonicalRepoRoot = assertCanonicalBucketApiRepoRoot(
    repoRoot,
    "STORAGE_BUCKET_API_JOURNAL_PATH_INVALID",
  );
  if (identity.operationRootSha256
      !== getAmoraSuccessorStorageBucketApiOperationRootSha256(operationRoot)) {
    fail("STORAGE_BUCKET_API_JOURNAL_PATH_INVALID", "Bucket journal root was not approval-bound");
  }
  const targetPath = assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: canonicalRepoRoot,
    targetPath: resolve(operationRoot, `${identity.operationId}.journal.jsonl`),
  });
  if (dirname(targetPath) !== operationRoot) {
    fail("STORAGE_BUCKET_API_JOURNAL_PATH_INVALID", "Bucket journal root was not approval-bound");
  }
  const syncParent = syncParentDirectoryImpl ?? (async (path) => {
    let directoryHandle;
    try {
      directoryHandle = await open(dirname(path), "r");
      await directoryHandle.sync();
    } catch {
      fail("STORAGE_BUCKET_API_JOURNAL_DURABILITY_FAILED", "Journal parent was not synchronized");
    } finally {
      await directoryHandle?.close();
    }
  });
  if (typeof syncParent !== "function"
      || (syncParentDirectoryImpl !== undefined && FILESYSTEM_PLATFORM !== "win32")) {
    fail("STORAGE_BUCKET_API_JOURNAL_PATH_INVALID", "Journal sync boundary was invalid");
  }
  if (onEvent !== undefined && typeof onEvent !== "function") {
    fail("STORAGE_BUCKET_API_JOURNAL_PATH_INVALID", "Journal event observer was invalid");
  }
  const identityMarker = sha256(canonicalJson(identity));
  const leaseKey = sha256(canonicalJson({
    projectRef: identity.projectRef,
    scope: "staging-storage-bucket-api-s0-to-s1-only",
  }));
  const leasePort = 40_000 + (Number.parseInt(leaseKey.slice(0, 8), 16) % 20_000);
  let activeLease = null;
  const maxBytes = 128 * 1024;
  const maxRecords = 64;

  function serialize(record) {
    const withIdentity = validateBucketApiJournalRecord({
      ...record,
      identityMarker,
    }, identityMarker, identity);
    return `${JSON.stringify(withIdentity)}\n`;
  }

  function parseCompleteChain(text) {
    const lines = text.trimEnd().split("\n");
    if (lines.length < 1 || lines.length > maxRecords) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal record count drifted");
    }
    const records = [];
    for (const [index, line] of lines.entries()) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal was not JSON Lines");
      }
      const record = validateBucketApiJournalRecord(parsed, identityMarker, identity);
      assertBucketApiJournalTransition(records.at(-1), record, index, records);
      records.push(record);
    }
    return records;
  }

  async function acquireOperationLease() {
    if (activeLease) {
      fail("STORAGE_BUCKET_API_OPERATION_LEASE_HELD", "This journal already owns a lease");
    }
    const server = createServer();
    const sockets = new Set();
    let leaseFailed = false;
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.destroy();
    });
    server.on("error", () => {
      leaseFailed = true;
    });
    try {
      await new Promise((resolveLease, rejectLease) => {
        server.once("error", rejectLease);
        server.listen({ host: "127.0.0.1", port: leasePort, exclusive: true }, () => {
          server.removeListener("error", rejectLease);
          resolveLease();
        });
      });
      server.unref();
      const token = Object.freeze({});
      activeLease = { leaseFailed: () => leaseFailed, server, sockets, token };
      onEvent?.("lease:acquired");
      return token;
    } catch (error) {
      if (server.listening) {
        await new Promise((resolveClose) => server.close(resolveClose));
      }
      if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
      if (error?.code === "EADDRINUSE") {
        fail("STORAGE_BUCKET_API_OPERATION_LEASE_HELD", "Another recovery owner holds the lease");
      }
      fail("STORAGE_BUCKET_API_OPERATION_LEASE_FAILED", "Bucket operation lease could not be acquired");
    }
  }

  async function assertOperationLease(token) {
    if (!activeLease || token !== activeLease.token) {
      fail("STORAGE_BUCKET_API_OPERATION_LEASE_LOST", "Bucket operation lease token was invalid");
    }
    if (!activeLease.server.listening || activeLease.leaseFailed()) {
      fail("STORAGE_BUCKET_API_OPERATION_LEASE_LOST", "Bucket operation lease was no longer owned");
    }
  }

  async function releaseOperationLease(token) {
    await assertOperationLease(token);
    const server = activeLease.server;
    try {
      for (const socket of activeLease.sockets) socket.destroy();
      server.closeAllConnections?.();
      await new Promise((resolveClose, rejectClose) => {
        const timeout = setTimeout(
          () => rejectClose(new Error("lease close timed out")),
          2_000,
        );
        timeout.unref?.();
        server.close((error) => {
          clearTimeout(timeout);
          if (error) rejectClose(error);
          else resolveClose();
        });
      });
      activeLease = null;
      onEvent?.("lease:released");
    } catch {
      fail("STORAGE_BUCKET_API_OPERATION_LEASE_RELEASE_FAILED", "Bucket operation lease was not released");
    }
  }

  async function append(record) {
    if (!activeLease) {
      fail("STORAGE_BUCKET_API_OPERATION_LEASE_REQUIRED", "Bucket journal append requires its lease");
    }
    await assertOperationLease(activeLease.token);
    assertBucketApiOperationRootUnchanged(operationRoot, identity.operationRootSha256);
    onEvent?.(`journal:${record.phase}:${record.actionId ?? "none"}`);
    const serialized = serialize(record);
    if (Buffer.byteLength(serialized, "utf8") > 4096) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket journal record was oversized");
    }
    if (record.phase === "prepared") {
      let handle;
      try {
        handle = await open(targetPath, "wx", 0o600);
        await assertBucketApiJournalHandle(targetPath, handle);
        await handle.chmod(0o600);
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
        await assertBucketApiJournalHandle(targetPath, handle);
        await handle.close();
        handle = undefined;
        await syncParent(targetPath);
        return;
      } catch (error) {
        await handle?.close().catch(() => {});
        if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
        if (error?.code === "EEXIST") {
          fail("STORAGE_BUCKET_API_JOURNAL_EXISTS", "An incomplete bucket journal already exists");
        }
        fail("STORAGE_BUCKET_API_JOURNAL_WRITE_FAILED", "Bucket journal could not be created");
      }
    }
    let handle;
    try {
      handle = await open(targetPath, constants.O_RDWR | constants.O_APPEND, 0o600);
      await assertBucketApiJournalHandle(targetPath, handle);
      const metadata = await handle.stat();
      if (metadata.size < 1 || metadata.size > maxBytes
          || (FILESYSTEM_PLATFORM !== "win32" && (metadata.mode & 0o777) !== 0o600)) {
        fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Bucket journal metadata was invalid");
      }
      const text = await handle.readFile({ encoding: "utf8" });
      if (!text.endsWith("\n")) {
        fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Bucket journal had an incomplete append");
      }
      const records = parseCompleteChain(text);
      const next = validateBucketApiJournalRecord({ ...record, identityMarker }, identityMarker, identity);
      assertBucketApiJournalTransition(records.at(-1), next, records.length, records);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await assertBucketApiJournalHandle(targetPath, handle);
    } catch (error) {
      if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
      if (error?.code === "ENOENT") {
        fail("STORAGE_BUCKET_API_JOURNAL_MISSING", "Bucket journal disappeared before append");
      }
      fail("STORAGE_BUCKET_API_JOURNAL_WRITE_FAILED", "Bucket journal could not be advanced");
    } finally {
      await handle?.close();
    }
  }

  async function read() {
    assertBucketApiOperationRootUnchanged(operationRoot, identity.operationRootSha256);
    let handle;
    try {
      handle = await open(targetPath, "r+");
      await assertBucketApiJournalHandle(targetPath, handle);
      const metadata = await handle.stat();
      if (metadata.size < 1 || metadata.size > maxBytes) {
        fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Bucket journal size was invalid");
      }
      let text = await handle.readFile({ encoding: "utf8" });
      let completeText = text;
      let torn = false;
      if (!text.endsWith("\n")) {
        const boundary = text.lastIndexOf("\n");
        if (boundary < 0) {
          fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Bucket journal had no complete record");
        }
        completeText = text.slice(0, boundary + 1);
        torn = true;
      }
      const records = parseCompleteChain(completeText);
      if (torn) {
        if (!activeLease) {
          fail(
            "STORAGE_BUCKET_API_JOURNAL_INCOMPLETE",
            "Only the active operation owner may repair a torn journal append",
          );
        }
        await assertOperationLease(activeLease.token);
        await assertBucketApiJournalHandle(targetPath, handle);
        await handle.truncate(Buffer.byteLength(completeText, "utf8"));
        await handle.sync();
        await assertBucketApiJournalHandle(targetPath, handle);
      }
      return Object.freeze(records.map((record) => {
        const publicRecord = { ...record };
        delete publicRecord.identityMarker;
        return Object.freeze(publicRecord);
      }));
    } catch (error) {
      if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
      if (error?.code === "ENOENT") {
        fail("STORAGE_BUCKET_API_JOURNAL_MISSING", "Bucket journal was absent");
      }
      fail("STORAGE_BUCKET_API_JOURNAL_READ_FAILED", "Bucket journal could not be read");
    } finally {
      await handle?.close();
    }
  }

  async function remove() {
    if (!activeLease) {
      fail("STORAGE_BUCKET_API_OPERATION_LEASE_REQUIRED", "Bucket journal removal requires its lease");
    }
    await assertOperationLease(activeLease.token);
    assertBucketApiOperationRootUnchanged(operationRoot, identity.operationRootSha256);
    const records = await read();
    if (records.at(-1)?.phase !== "verified_s1") {
      fail("STORAGE_BUCKET_API_JOURNAL_INCOMPLETE", "Incomplete bucket journal cannot be removed");
    }
    try {
      await unlink(targetPath);
      await syncParent(targetPath);
    } catch {
      fail("STORAGE_BUCKET_API_JOURNAL_REMOVE_FAILED", "Bucket journal could not be removed");
    }
  }

  async function assertOperationIdentity(candidate) {
    const validated = validateBucketApiOperationIdentity(candidate);
    const expected = {
      approvedAt: identity.approvedAt,
      approvalSha256: identity.approvalSha256,
      authorizedModes: identity.authorizedModes,
      executionHostSha256: identity.executionHostSha256,
      expiresAt: identity.expiresAt,
      operationId: identity.operationId,
      operationRootSha256: identity.operationRootSha256,
      planSha256: identity.planSha256,
      productionProjectRef: identity.productionProjectRef,
      projectRef: identity.projectRef,
      scope: identity.scope,
      toolGitCommit: identity.toolGitCommit,
    };
    if (canonicalJson(validated) !== canonicalJson(expected)) {
      fail("STORAGE_BUCKET_API_JOURNAL_IDENTITY_INVALID", "Bucket journal identity did not match");
    }
  }

  async function assertRecoveryAuthorization(recoveryApprovalSha256) {
    if (!activeLease || !SHA256.test(recoveryApprovalSha256 ?? "")) {
      fail(
        "STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID",
        "Recovery authorization was not lease-bound",
      );
    }
    await assertOperationLease(activeLease.token);
    const records = await read();
    const latest = [...records].reverse().find(
      (record) => record.phase === "recovery_authorized",
    );
    if (latest?.recoveryApprovalSha256 !== recoveryApprovalSha256) {
      fail(
        "STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID",
        "Recovery authorization was no longer the journal tail authority",
      );
    }
  }

  const journal = Object.freeze({
    acquireOperationLease,
    append,
    assertOperationIdentity,
    assertOperationLease,
    assertRecoveryAuthorization,
    read,
    releaseOperationLease,
    remove,
  });
  BUCKET_API_JOURNAL_CAPABILITIES.set(journal, Object.freeze({
    approvalSha256: identity.approvalSha256,
    executionHostSha256: identity.executionHostSha256,
    operationId: identity.operationId,
    operationRootSha256: identity.operationRootSha256,
    planSha256: identity.planSha256,
    productionProjectRef: identity.productionProjectRef,
    projectRef: identity.projectRef,
    scope: identity.scope,
  }));
  return journal;
}

function validateInjectedBucketApiJournalRecord(record, plan) {
  const expectedKeys = [
    "actionId", "actionIndex", "at", "attempt", "journalVersion", "kind",
    "observedOutcome", "phase", "planSha256",
  ];
  if (record?.phase === "verified_s1") {
    expectedKeys.push("receiptSha256");
    if (record.finalSnapshotObservedAt !== undefined
        || record.finalSnapshotFingerprintSha256 !== undefined) {
      expectedKeys.push("finalSnapshotFingerprintSha256", "finalSnapshotObservedAt");
    }
  }
  if (record?.phase === "recovery_authorized") {
    expectedKeys.push(
      "authorizedJournalChainSha256",
      "authorizedJournalRecordCount",
      "predecessorAuthorizationSha256",
      "recoveryApprovalSha256",
    );
  }
  if (!hasExactKeys(record, expectedKeys)
      || record.journalVersion !== 1
      || record.kind !== "amora-successor-storage-bucket-api-journal-record"
      || !["prepared", "intent", "observed", "recovery_authorized", "verified_s1"]
        .includes(record.phase)
      || record.planSha256 !== plan.planSha256
      || !canonicalIsoString(record.at)
      || !Number.isSafeInteger(record.actionIndex)
      || !Number.isSafeInteger(record.attempt)) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Injected bucket journal record was invalid");
  }
  const expectedAction = BUCKET_API_ACTIONS[record.actionIndex];
  if (["intent", "observed"].includes(record.phase)
      && (!expectedAction || record.actionId !== expectedAction.id
        || record.attempt < 1 || record.attempt > 3
        || (record.phase === "intent" && record.observedOutcome !== null)
        || (record.phase === "observed"
          && !["accepted", "unknown"].includes(record.observedOutcome)))) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Injected bucket journal action was invalid");
  }
  if (record.phase === "prepared"
      && (record.actionId !== null || record.actionIndex !== 0
        || record.attempt !== 0 || record.observedOutcome !== null)) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Injected bucket journal start was invalid");
  }
  if (record.phase === "verified_s1"
      && (record.actionId !== null || record.actionIndex !== BUCKET_API_ACTIONS.length
        || record.attempt !== 1 || record.observedOutcome !== null
        || !SHA256.test(record.receiptSha256 ?? "")
        || ((record.finalSnapshotObservedAt !== undefined
          || record.finalSnapshotFingerprintSha256 !== undefined)
          && (!canonicalIsoString(record.finalSnapshotObservedAt)
            || !SHA256.test(record.finalSnapshotFingerprintSha256 ?? ""))))) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Injected bucket journal final state was invalid");
  }
  if (record.phase === "recovery_authorized"
      && (record.actionId !== null || record.attempt !== 0 || record.observedOutcome !== null
        || !SHA256.test(record.recoveryApprovalSha256 ?? "")
        || (record.predecessorAuthorizationSha256 !== null
          && !SHA256.test(record.predecessorAuthorizationSha256 ?? ""))
        || !Number.isSafeInteger(record.authorizedJournalRecordCount)
        || record.authorizedJournalRecordCount < 1
        || !SHA256.test(record.authorizedJournalChainSha256 ?? ""))) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Injected recovery authorization was invalid");
  }
  return Object.freeze({ ...record });
}

function validateInjectedBucketApiJournalChain(rawRecords, plan) {
  if (!Array.isArray(rawRecords) || rawRecords.length < 1 || rawRecords.length > 64) {
    fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Storage bucket recovery chain was invalid");
  }
  const records = [];
  for (const [index, rawRecord] of rawRecords.entries()) {
    const record = validateInjectedBucketApiJournalRecord(rawRecord, plan);
    assertBucketApiJournalTransition(records.at(-1), record, index, records);
    records.push(record);
  }
  return records;
}

function summarizeBucketApiDurableIntents(journalRecords) {
  const summary = BUCKET_API_ACTIONS.map((action) => {
    const intents = journalRecords.filter(
      (record) => record.phase === "intent" && record.actionId === action.id,
    );
    const observations = journalRecords.filter(
      (record) => record.phase === "observed" && record.actionId === action.id,
    );
    if (intents.length < 1 || intents.length > 3 || observations.length !== 1) {
      fail(
        "STORAGE_BUCKET_API_FINALIZER_INVALID",
        "Storage bucket action evidence was incomplete",
      );
    }
    return Object.freeze({
      actionId: action.id,
      intentCount: intents.length,
      observedOutcome: observations[0].observedOutcome,
    });
  });
  return Object.freeze(summary);
}

function createBucketApiFinalSnapshotEvidence(snapshot) {
  return Object.freeze({
    observedAt: snapshot.observedAt,
    canonicalFingerprintSha256: bucketApiSnapshotFingerprint(snapshot),
  });
}

function bucketApiReceiptEffects(actionSummary) {
  return Object.freeze({
    authorizedDurableIntentCount: actionSummary.reduce(
      (total, action) => total + action.intentCount,
      0,
    ),
    acceptedObservedOutcomeCount: actionSummary.filter(
      (action) => action.observedOutcome === "accepted",
    ).length,
    unknownObservedOutcomeCount: actionSummary.filter(
      (action) => action.observedOutcome === "unknown",
    ).length,
    policyMutations: 0,
    objectMutations: 0,
    productionMutations: 0,
  });
}

function createBucketApiCompletionReceipt(
  plan,
  operationIdentity,
  journalRecords,
  capturedAt,
  finalSnapshotEvidence,
) {
  const authorizationRecords = journalRecords.filter(
    (record) => record.phase === "recovery_authorized",
  );
  const authorizedDurableIntentSummary = summarizeBucketApiDurableIntents(journalRecords);
  const receipt = {
    receiptVersion: 1,
    kind: "amora-successor-storage-bucket-api-convergence",
    status: "bucket_configuration_converged_policy_pending",
    scope: "staging-storage-bucket-api-s0-to-s1-only",
    ...operationIdentity,
    capturedAt,
    actionCount: BUCKET_API_ACTIONS.length,
    actionIds: Object.freeze(BUCKET_API_ACTIONS.map((action) => action.id)),
    authorizedDurableIntentSummary,
    authorizationChainSha256: sha256(canonicalJson(authorizationRecords)),
    authorizationTransitionCount: authorizationRecords.length,
    recoveryApprovalSha256:
      authorizationRecords.at(-1)?.recoveryApprovalSha256 ?? null,
    journalChainSha256: bucketApiJournalChainSha256(journalRecords),
    planSha256: plan.planSha256,
    baselineObjectCount: plan.baselineObjectCount,
    baselineObjectInventorySha256: plan.baselineObjectInventorySha256,
    vendorSafety: plan.vendorSafety,
    finalSnapshotEvidence,
    policyMutationPending: true,
    targetBucketContractSha256: plan.targetBucketContractSha256,
    effects: bucketApiReceiptEffects(authorizedDurableIntentSummary),
  };
  const completedReceipt = Object.freeze({
    ...receipt,
    receiptSha256: sha256(canonicalJson(receipt)),
  });
  validateBucketApiCompletionReceipt(completedReceipt);
  BUCKET_API_COMPLETION_RECEIPT_CAPABILITIES.set(completedReceipt, Object.freeze({
    approvalSha256: operationIdentity.approvalSha256,
    finalSnapshotFingerprintSha256:
      finalSnapshotEvidence.canonicalFingerprintSha256,
    journalChainSha256: completedReceipt.journalChainSha256,
    operationId: operationIdentity.operationId,
    planSha256: plan.planSha256,
    receiptSha256: completedReceipt.receiptSha256,
  }));
  return completedReceipt;
}

function validateBucketApiCompletionReceipt(receipt) {
  const expectedKeys = [
    "actionCount", "actionIds", "approvedAt", "approvalSha256", "authorizedModes",
    "authorizedDurableIntentSummary",
    "authorizationChainSha256", "authorizationTransitionCount",
    "baselineObjectCount", "baselineObjectInventorySha256", "capturedAt", "effects",
    "executionHostSha256", "expiresAt", "finalSnapshotEvidence", "kind", "operationId",
    "operationRootSha256",
    "journalChainSha256", "planSha256", "policyMutationPending", "productionProjectRef", "projectRef",
    "recoveryApprovalSha256",
    "receiptSha256", "receiptVersion", "scope", "status", "targetBucketContractSha256",
    "toolGitCommit", "vendorSafety",
  ];
  const vendorKeys = [
    "disallowedMimeObjectCount", "missingMetadataObjectCount", "objectCount",
    "objectInventorySha256", "oversizeObjectCount",
  ];
  const effectKeys = [
    "acceptedObservedOutcomeCount", "authorizedDurableIntentCount", "objectMutations",
    "policyMutations", "productionMutations", "unknownObservedOutcomeCount",
  ];
  const actionSummaryKeys = ["actionId", "intentCount", "observedOutcome"];
  const finalSnapshotEvidenceKeys = ["canonicalFingerprintSha256", "observedAt"];
  if (!hasExactKeys(receipt, expectedKeys)
      || receipt.receiptVersion !== 1
      || receipt.kind !== "amora-successor-storage-bucket-api-convergence"
      || receipt.status !== "bucket_configuration_converged_policy_pending"
      || receipt.scope !== "staging-storage-bucket-api-s0-to-s1-only"
      || !canonicalIsoString(receipt.capturedAt)
      || receipt.actionCount !== BUCKET_API_ACTIONS.length
      || !exactArray(receipt.actionIds, BUCKET_API_ACTIONS.map((action) => action.id))
      || !Array.isArray(receipt.authorizedDurableIntentSummary)
      || receipt.authorizedDurableIntentSummary.length !== BUCKET_API_ACTIONS.length
      || receipt.authorizedDurableIntentSummary.some((entry, index) => (
        !hasExactKeys(entry, actionSummaryKeys)
        || entry.actionId !== BUCKET_API_ACTIONS[index].id
        || !Number.isSafeInteger(entry.intentCount)
        || entry.intentCount < 1 || entry.intentCount > 3
        || !["accepted", "unknown"].includes(entry.observedOutcome)
      ))
      || !SHA256.test(receipt.authorizationChainSha256 ?? "")
      || !Number.isSafeInteger(receipt.authorizationTransitionCount)
      || receipt.authorizationTransitionCount < 0 || receipt.authorizationTransitionCount > 32
      || (receipt.recoveryApprovalSha256 !== null
        && !SHA256.test(receipt.recoveryApprovalSha256 ?? ""))
      || (receipt.authorizationTransitionCount === 0) !== (receipt.recoveryApprovalSha256 === null)
      || !SHA256.test(receipt.journalChainSha256 ?? "")
      || !SHA256.test(receipt.planSha256 ?? "")
      || !Number.isSafeInteger(receipt.baselineObjectCount) || receipt.baselineObjectCount < 0
      || !SHA256.test(receipt.baselineObjectInventorySha256 ?? "")
      || !hasExactKeys(receipt.finalSnapshotEvidence, finalSnapshotEvidenceKeys)
      || !canonicalIsoString(receipt.finalSnapshotEvidence.observedAt)
      || !SHA256.test(receipt.finalSnapshotEvidence.canonicalFingerprintSha256 ?? "")
      || receipt.policyMutationPending !== true
      || receipt.targetBucketContractSha256 !== BUCKET_API_TARGET_CONTRACT_SHA256
      || !hasExactKeys(receipt.vendorSafety, vendorKeys)
      || !Number.isSafeInteger(receipt.vendorSafety.objectCount)
      || receipt.vendorSafety.objectCount < 0
      || !SHA256.test(receipt.vendorSafety.objectInventorySha256 ?? "")
      || receipt.vendorSafety.oversizeObjectCount !== 0
      || receipt.vendorSafety.disallowedMimeObjectCount !== 0
      || receipt.vendorSafety.missingMetadataObjectCount !== 0
      || !hasExactKeys(receipt.effects, effectKeys)
      || !Number.isSafeInteger(receipt.effects.authorizedDurableIntentCount)
      || receipt.effects.authorizedDurableIntentCount < BUCKET_API_ACTIONS.length
      || receipt.effects.authorizedDurableIntentCount > BUCKET_API_ACTIONS.length * 3
      || !Number.isSafeInteger(receipt.effects.acceptedObservedOutcomeCount)
      || receipt.effects.acceptedObservedOutcomeCount < 0
      || !Number.isSafeInteger(receipt.effects.unknownObservedOutcomeCount)
      || receipt.effects.unknownObservedOutcomeCount < 0
      || receipt.effects.acceptedObservedOutcomeCount
        + receipt.effects.unknownObservedOutcomeCount !== BUCKET_API_ACTIONS.length
      || canonicalJson(receipt.effects)
        !== canonicalJson(bucketApiReceiptEffects(receipt.authorizedDurableIntentSummary))
      || receipt.effects.policyMutations !== 0
      || receipt.effects.objectMutations !== 0
      || receipt.effects.productionMutations !== 0
      || !SHA256.test(receipt.receiptSha256 ?? "")) {
    fail("STORAGE_BUCKET_API_FINALIZER_INVALID", "Storage bucket receipt schema was invalid");
  }
  try {
    validateBucketApiOperationIdentity({
      approvedAt: receipt.approvedAt,
      approvalSha256: receipt.approvalSha256,
      authorizedModes: receipt.authorizedModes,
      executionHostSha256: receipt.executionHostSha256,
      expiresAt: receipt.expiresAt,
      operationId: receipt.operationId,
      operationRootSha256: receipt.operationRootSha256,
      planSha256: receipt.planSha256,
      productionProjectRef: receipt.productionProjectRef,
      projectRef: receipt.projectRef,
      scope: receipt.scope,
      toolGitCommit: receipt.toolGitCommit,
    });
  } catch {
    fail("STORAGE_BUCKET_API_FINALIZER_INVALID", "Storage bucket receipt identity was invalid");
  }
  const { receiptSha256, ...core } = receipt;
  if (receiptSha256 !== sha256(canonicalJson(core))
      || /(?:serviceRoleKey|managementToken|authorizationHeader|apikey|objectPaths|rawBody)/iu
        .test(canonicalJson(receipt))) {
    fail("STORAGE_BUCKET_API_FINALIZER_INVALID", "Storage bucket receipt integrity was invalid");
  }
  return receipt;
}

function assertBucketApiFinalSnapshot(input, plan) {
  let snapshot;
  try {
    snapshot = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(input);
  } catch {
    fail("STORAGE_BUCKET_API_POSTCONDITION_FAILED", "Storage bucket final snapshot was invalid");
  }
  const vendor = vendorSafety(snapshot);
  if (classifyBucketApiSnapshot(snapshot) !== "S1"
      || snapshot.totalObjectCount !== plan.baselineObjectCount
      || snapshot.objectInventorySha256 !== plan.baselineObjectInventorySha256
      || !vendor
      || vendor.objectCount !== plan.vendorSafety.objectCount
      || vendor.objectInventorySha256 !== plan.vendorSafety.objectInventorySha256
      || vendor.oversizeObjectCount !== 0
      || vendor.disallowedMimeObjectCount !== 0
      || vendor.missingMetadataObjectCount !== 0) {
    fail(
      "STORAGE_BUCKET_API_POSTCONDITION_FAILED",
      "Storage bucket final policy, object, or configuration invariant drifted",
    );
  }
  return snapshot;
}

function bucketApiPrefixBuckets(completedActionCount) {
  const entries = BASELINE_BUCKETS.map((entry) => ({ ...entry }));
  for (const action of BUCKET_API_ACTIONS.slice(0, completedActionCount)) {
    const target = TARGET_BUCKETS.find((entry) => entry.id === action.bucketId);
    const existingIndex = entries.findIndex((entry) => entry.id === action.bucketId);
    if (existingIndex >= 0) entries[existingIndex] = { ...target };
    else entries.push({ ...target });
  }
  return entries.sort(compareById);
}

function assertBucketApiRecoveryPrefixSnapshot(input, baseline, plan, allowedPrefixCounts) {
  let snapshot;
  try {
    snapshot = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(input);
  } catch {
    fail("STORAGE_BUCKET_API_RECOVERY_PREFLIGHT_FAILED", "Recovery catalog snapshot was invalid");
  }
  const staticStateMatches = snapshot.relationOwner === baseline.relationOwner
    && snapshot.relationRlsEnabled === baseline.relationRlsEnabled
    && snapshot.relationForceRls === baseline.relationForceRls
    && canonicalJson(snapshot.helperContracts) === canonicalJson(baseline.helperContracts)
    && canonicalJson(snapshot.fence) === canonicalJson(baseline.fence)
    && snapshot.readOnlyPrincipalCanSetStorageAdmin
      === baseline.readOnlyPrincipalCanSetStorageAdmin
    && policySetMatches(snapshot.policies, BASELINE_POLICIES)
    && snapshot.totalObjectCount === plan.baselineObjectCount
    && snapshot.objectInventorySha256 === plan.baselineObjectInventorySha256;
  const matchedPrefixCounts = allowedPrefixCounts.filter((count) => (
    Number.isSafeInteger(count) && count >= 0 && count <= BUCKET_API_ACTIONS.length
      && bucketSetMatches(snapshot.buckets, bucketApiPrefixBuckets(count))
  ));
  const createdBucketsAreEmpty = snapshot.buckets
    .filter((entry) => MISSING_BUCKETS.some((target) => target.id === entry.id))
    .every((entry) => entry.objectCount === 0
      && entry.oversizeObjectCount === 0
      && entry.disallowedMimeObjectCount === 0
      && entry.missingMetadataObjectCount === 0);
  const vendor = vendorSafety(snapshot);
  if (!staticStateMatches || matchedPrefixCounts.length !== 1 || !createdBucketsAreEmpty || !vendor
      || canonicalJson(vendor) !== canonicalJson(plan.vendorSafety)) {
    fail(
      "STORAGE_BUCKET_API_RECOVERY_PREFLIGHT_FAILED",
      "Recovery catalog drifted from its exact durable prefix",
    );
  }
  return Object.freeze({
    matchedPrefixCount: matchedPrefixCounts[0],
    snapshot,
  });
}

async function inspectBucketApiApplyPrefix({
  inspectSnapshot,
  baseline,
  plan,
  actionIndex,
  freshnessState,
}) {
  try {
    const snapshot = await inspectFreshBucketApiSnapshot({
      inspectSnapshot,
      context: {
        stage: `apply-prefix-${actionIndex}`,
        planSha256: plan.planSha256,
        allowedPrefixCounts: [actionIndex],
      },
      freshnessState,
    });
    return assertBucketApiRecoveryPrefixSnapshot(
      snapshot,
      baseline,
      plan,
      [actionIndex],
    );
  } catch {
    fail(
      "STORAGE_BUCKET_API_PREFLIGHT_FAILED",
      "Storage bucket catalog drifted before an allowlisted mutation",
    );
  }
}

async function inspectBucketApiRecoveryPrefix({
  inspectSnapshot,
  baseline,
  plan,
  stage,
  allowedPrefixCounts,
  freshnessState,
}) {
  let rawSnapshot;
  try {
    rawSnapshot = await inspectFreshBucketApiSnapshot({
      inspectSnapshot,
      context: {
        stage,
        planSha256: plan.planSha256,
        allowedPrefixCounts,
      },
      freshnessState,
    });
  } catch {
    fail("STORAGE_BUCKET_API_RECOVERY_PREFLIGHT_FAILED", "Recovery snapshot read failed");
  }
  return assertBucketApiRecoveryPrefixSnapshot(
    rawSnapshot,
    baseline,
    plan,
    allowedPrefixCounts,
  );
}

async function establishBucketApiRecoveryAuthority({
  operationIdentity,
  recoveryAuthorization,
  journal,
  operationLease,
  plan,
  records,
  now,
}) {
  const latestAuthorization = [...records].reverse().find(
    (record) => record.phase === "recovery_authorized",
  );
  if (!latestAuthorization && bucketApiOperationIdentityIsActive(operationIdentity)) {
    if (recoveryAuthorization !== null) {
      fail(
        "STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID",
        "A superseding recovery approval cannot replace an active original approval",
      );
    }
    return null;
  }
  const binding = BUCKET_API_RECOVERY_AUTHORIZATIONS.get(recoveryAuthorization);
  if (!binding || binding.operationIdentity !== operationIdentity
      || binding.planSha256 !== plan.planSha256) {
    fail(
      "STORAGE_BUCKET_API_RECOVERY_APPROVAL_REQUIRED",
      "Expired bucket operations require an exact recovery-only approval",
    );
  }
  const currentTime = Date.now();
  if (currentTime < Date.parse(binding.approvedAt)
      || currentTime >= Date.parse(binding.expiresAt)) {
    fail(
      "STORAGE_BUCKET_API_RECOVERY_APPROVAL_EXPIRED",
      "Storage bucket recovery authorization was unavailable or expired",
    );
  }
  if (latestAuthorization?.recoveryApprovalSha256 === binding.recoveryApprovalSha256) {
    if (latestAuthorization.predecessorAuthorizationSha256
          !== binding.predecessorAuthorizationSha256
        || latestAuthorization.authorizedJournalRecordCount !== binding.journalRecordCount
        || latestAuthorization.authorizedJournalChainSha256 !== binding.journalChainSha256) {
      fail(
        "STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID",
        "Durable recovery authorization drifted from its approval",
      );
    }
  } else {
    const currentChainSha256 = bucketApiJournalChainSha256(records);
    if (binding.journalRecordCount !== records.length
        || binding.journalChainSha256 !== currentChainSha256
        || binding.predecessorAuthorizationSha256
          !== (latestAuthorization?.recoveryApprovalSha256 ?? null)) {
      fail(
        "STORAGE_BUCKET_API_RECOVERY_APPROVAL_INVALID",
        "Recovery approval did not bind the current durable journal tail",
      );
    }
    const authorizedAt = now();
    if (!(authorizedAt instanceof Date) || !Number.isFinite(authorizedAt.valueOf())) {
      fail("STORAGE_BUCKET_API_RUNNER_INVALID", "Storage bucket recovery clock was invalid");
    }
    await journal.append(bucketApiRecoveryAuthorizationRecord(
      binding,
      plan,
      records,
      authorizedAt.toISOString(),
    ));
  }
  await assertBucketApiRecoveryAuthorization(
    recoveryAuthorization,
    operationIdentity,
    journal,
    operationLease,
  );
  return recoveryAuthorization;
}

export async function recoverAmoraSuccessorStorageBucketApiConvergence({
  baselineSnapshot,
  plan,
  operationIdentity: rawOperationIdentity,
  recoveryAuthorization = null,
  journal,
  transport,
  inspectSnapshot,
  receiptReservation,
  now = () => new Date(),
}) {
  assertAmoraSuccessorStorageStagingConvergenceMutationPlatform();
  const operationIdentity = assertBucketApiOperationIdentityProvenance(rawOperationIdentity);
  if (!journal || typeof journal.read !== "function" || typeof journal.append !== "function") {
    fail("STORAGE_BUCKET_API_RUNNER_INVALID", "Storage bucket recovery journal was invalid");
  }
  await assertBucketApiRunnerDependencies({
    plan,
    operationIdentity,
    journal,
    transport,
    inspectSnapshot,
    receiptReservation,
    now,
  });
  await journal.assertOperationIdentity(operationIdentity);
  const operationLease = await journal.acquireOperationLease();
  try {
    await journal.assertOperationLease(operationLease);
  const freshnessState = { lastObservedAt: null };
  const baseline = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(baselineSnapshot);
  const expectedPlan = planAmoraSuccessorStorageBucketApiConvergence(baseline);
  if (expectedPlan.classification !== "S0"
      || canonicalJson(plan) !== canonicalJson(expectedPlan)) {
    fail("STORAGE_BUCKET_API_PLAN_MISMATCH", "Storage bucket recovery plan was not exact");
  }
  let records = validateInjectedBucketApiJournalChain(await journal.read(), plan);
  let nextActionIndex;
  const last = [...records].reverse().find(
    (record) => record.phase !== "recovery_authorized",
  );
  if (last.phase === "verified_s1") {
    const replaySnapshot = assertBucketApiFinalSnapshot(await inspectFreshBucketApiSnapshot({
      inspectSnapshot,
      context: { stage: "recovery-final", planSha256: plan.planSha256 },
      freshnessState,
    }), plan);
    const finalSnapshotEvidence = last.finalSnapshotObservedAt === undefined
      ? createBucketApiFinalSnapshotEvidence(replaySnapshot)
      : Object.freeze({
        observedAt: last.finalSnapshotObservedAt,
        canonicalFingerprintSha256: last.finalSnapshotFingerprintSha256,
      });
    if (bucketApiSnapshotFingerprint(replaySnapshot)
        !== finalSnapshotEvidence.canonicalFingerprintSha256) {
      fail("STORAGE_BUCKET_API_POSTCONDITION_FAILED", "Terminal snapshot evidence drifted");
    }
    const receipt = createBucketApiCompletionReceipt(
      plan,
      operationIdentity,
      records.slice(0, -1),
      last.at,
      finalSnapshotEvidence,
    );
    if (receipt.receiptSha256 !== last.receiptSha256) {
      fail("STORAGE_BUCKET_API_JOURNAL_INVALID", "Terminal receipt hash drifted from journal");
    }
    return receipt;
  }
  const activeRecoveryAuthorization = await establishBucketApiRecoveryAuthority({
    operationIdentity,
    recoveryAuthorization,
    journal,
    operationLease,
    plan,
    records,
    now,
  });
  records = validateInjectedBucketApiJournalChain(await journal.read(), plan);
  const initialCompletedCount = last.phase === "observed" ? last.actionIndex + 1
    : last.phase === "intent" ? last.actionIndex
      : 0;
  const recoveryPreflight = await inspectBucketApiRecoveryPrefix({
    inspectSnapshot,
    baseline,
    plan,
    stage: "recovery-preflight",
    allowedPrefixCounts: last.phase === "intent"
      ? [initialCompletedCount, initialCompletedCount + 1]
      : [initialCompletedCount],
    freshnessState,
  });
  if (last.phase === "prepared") {
    nextActionIndex = 0;
  } else if (last.phase === "observed") {
    nextActionIndex = last.actionIndex + 1;
  } else {
    const action = BUCKET_API_ACTIONS[last.actionIndex];
    const target = TARGET_BUCKETS.find((entry) => entry.id === action.bucketId);
    const current = await transport.getBucket(action.bucketId);
    if (exactBucketApiPostRead(current, target)) {
      await journal.append(bucketApiJournalRecord({
        phase: "observed",
        actionId: action.id,
        actionIndex: last.actionIndex,
        attempt: last.attempt,
        planSha256: plan.planSha256,
        at: now().toISOString(),
        observedOutcome: "unknown",
      }));
      nextActionIndex = last.actionIndex + 1;
    } else if (current?.outcome === "absent"
        || (action.kind === "update_bucket_configuration"
          && current?.outcome === "found"
          && bucketConfigMatches(current.bucket, BASELINE_BUCKETS.find(
            (entry) => entry.id === "vendor-images",
          )))) {
      if (recoveryPreflight.matchedPrefixCount !== initialCompletedCount) {
        fail(
          "STORAGE_BUCKET_API_MANUAL_RECOVERY_REQUIRED",
          "Recovery state regressed after a committed durable prefix was observed",
        );
      }
      if (last.attempt >= 3) {
        fail("STORAGE_BUCKET_API_MANUAL_RECOVERY_REQUIRED", "Bucket recovery attempts were exhausted");
      }
      const attempt = last.attempt + 1;
      await journal.append(bucketApiJournalRecord({
        phase: "intent",
        actionId: action.id,
        actionIndex: last.actionIndex,
        attempt,
        planSha256: plan.planSha256,
        at: now().toISOString(),
      }));
      await journal.assertOperationLease(operationLease);
      const mutationCapability = createBucketApiMutationCapability(
        operationIdentity,
        journal,
        operationLease,
        receiptReservation,
        activeRecoveryAuthorization,
      );
      const mutation = action.kind === "create_bucket"
        ? await transport.createBucket(action.bucketId, mutationCapability)
        : await transport.updateVendorImages(mutationCapability);
      const postRead = await transport.getBucket(action.bucketId);
      const observedOutcome = assertBucketApiRecoveryMutationResult(mutation, postRead, target);
      await journal.append(bucketApiJournalRecord({
        phase: "observed",
        actionId: action.id,
        actionIndex: last.actionIndex,
        attempt,
        planSha256: plan.planSha256,
        at: now().toISOString(),
        observedOutcome,
      }));
      nextActionIndex = last.actionIndex + 1;
    } else {
      fail("STORAGE_BUCKET_API_MANUAL_RECOVERY_REQUIRED", "Bucket recovery state was ambiguous");
    }
  }

  for (let actionIndex = nextActionIndex; actionIndex < BUCKET_API_ACTIONS.length; actionIndex += 1) {
    const action = BUCKET_API_ACTIONS[actionIndex];
    const target = TARGET_BUCKETS.find((entry) => entry.id === action.bucketId);
    await inspectBucketApiRecoveryPrefix({
      inspectSnapshot,
      baseline,
      plan,
      stage: "recovery-prefix",
      allowedPrefixCounts: [actionIndex],
      freshnessState,
    });
    await journal.append(bucketApiJournalRecord({
      phase: "intent",
      actionId: action.id,
      actionIndex,
      attempt: 1,
      planSha256: plan.planSha256,
      at: now().toISOString(),
    }));
    await journal.assertOperationLease(operationLease);
    const mutationCapability = createBucketApiMutationCapability(
      operationIdentity,
      journal,
      operationLease,
      receiptReservation,
      activeRecoveryAuthorization,
    );
    const mutation = action.kind === "create_bucket"
      ? await transport.createBucket(action.bucketId, mutationCapability)
      : await transport.updateVendorImages(mutationCapability);
    const read = await transport.getBucket(action.bucketId);
    const observedOutcome = assertBucketApiRecoveryMutationResult(mutation, read, target);
    await journal.append(bucketApiJournalRecord({
      phase: "observed",
      actionId: action.id,
      actionIndex,
      attempt: 1,
      planSha256: plan.planSha256,
      at: now().toISOString(),
      observedOutcome,
    }));
  }
  const finalSnapshot = assertBucketApiFinalSnapshot(await inspectFreshBucketApiSnapshot({
    inspectSnapshot,
    context: { stage: "recovery-final", planSha256: plan.planSha256 },
    freshnessState,
  }), plan);
  const finalSnapshotEvidence = createBucketApiFinalSnapshotEvidence(finalSnapshot);
  const completedAt = now().toISOString();
  const finalRecords = validateInjectedBucketApiJournalChain(await journal.read(), plan);
  const receipt = createBucketApiCompletionReceipt(
    plan,
    operationIdentity,
    finalRecords,
    completedAt,
    finalSnapshotEvidence,
  );
  await journal.append(bucketApiJournalRecord({
    phase: "verified_s1",
    actionIndex: BUCKET_API_ACTIONS.length,
    attempt: 1,
    planSha256: plan.planSha256,
    at: completedAt,
    receiptSha256: receipt.receiptSha256,
    finalSnapshotObservedAt: finalSnapshotEvidence.observedAt,
    finalSnapshotFingerprintSha256:
      finalSnapshotEvidence.canonicalFingerprintSha256,
  }));
  return receipt;
  } finally {
    try {
      await journal.releaseOperationLease(operationLease);
    } finally {
      await receiptReservation.close();
    }
  }
}

export async function finalizeAmoraSuccessorStorageBucketApiConvergence({
  receipt,
  journal,
  receiptReservation,
}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || !receiptReservation || typeof receiptReservation.writeReceipt !== "function"
      || !journal || typeof journal.assertOperationIdentity !== "function"
      || typeof journal.acquireOperationLease !== "function"
      || typeof journal.assertOperationLease !== "function"
      || typeof journal.releaseOperationLease !== "function"
      || typeof journal.read !== "function" || typeof journal.remove !== "function") {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Storage bucket finalizer input was invalid");
  }
  validateBucketApiCompletionReceipt(receipt);
  const completionBinding = BUCKET_API_COMPLETION_RECEIPT_CAPABILITIES.get(receipt);
  if (!completionBinding
      || completionBinding.operationId !== receipt.operationId
      || completionBinding.approvalSha256 !== receipt.approvalSha256
      || completionBinding.planSha256 !== receipt.planSha256
      || completionBinding.journalChainSha256 !== receipt.journalChainSha256
      || completionBinding.finalSnapshotFingerprintSha256
        !== receipt.finalSnapshotEvidence.canonicalFingerprintSha256
      || completionBinding.receiptSha256 !== receipt.receiptSha256) {
    fail(
      "STORAGE_BUCKET_API_FINALIZER_INVALID",
      "Storage bucket receipt was not issued by the verified runner or recovery path",
    );
  }
  const receiptBinding = BUCKET_API_RECEIPT_WRITER_CAPABILITIES.get(receiptReservation);
  if (!receiptBinding
      || receiptBinding.operationIdentity.operationId !== receipt.operationId
      || receiptBinding.operationIdentity.approvalSha256 !== receipt.approvalSha256
      || receiptBinding.operationRootSha256 !== receipt.operationRootSha256
      || receiptBinding.planSha256 !== receipt.planSha256) {
    fail("STORAGE_BUCKET_API_RECEIPT_CAPABILITY_INVALID", "Storage bucket receipt capability was untrusted");
  }
  try {
    await assertBucketApiReceiptReservationReady(receiptReservation);
  } catch {
    fail("STORAGE_BUCKET_API_RECEIPT_WRITE_FAILED", "Storage bucket receipt reservation changed");
  }
  const operationLease = await journal.acquireOperationLease();
  try {
    await journal.assertOperationLease(operationLease);
  try {
    await journal.assertOperationIdentity({
      approvedAt: receipt.approvedAt,
      approvalSha256: receipt.approvalSha256,
      authorizedModes: receipt.authorizedModes,
      executionHostSha256: receipt.executionHostSha256,
      expiresAt: receipt.expiresAt,
      operationId: receipt.operationId,
      operationRootSha256: receipt.operationRootSha256,
      planSha256: receipt.planSha256,
      productionProjectRef: receipt.productionProjectRef,
      projectRef: receipt.projectRef,
      scope: receipt.scope,
      toolGitCommit: receipt.toolGitCommit,
    });
  } catch {
    fail("STORAGE_BUCKET_API_FINALIZER_INVALID", "Storage bucket receipt identity was unbound");
  }
  let records;
  try {
    records = validateInjectedBucketApiJournalChain(
      await journal.read(),
      { planSha256: receipt.planSha256 },
    );
  } catch {
    fail("STORAGE_BUCKET_API_FINALIZER_INVALID", "Storage bucket journal could not bind receipt");
  }
  const terminal = records.at(-1);
  const preterminalRecords = records.slice(0, -1);
  const authorizationRecords = preterminalRecords.filter(
    (record) => record.phase === "recovery_authorized",
  );
  let expectedActionSummary;
  try {
    expectedActionSummary = summarizeBucketApiDurableIntents(preterminalRecords);
  } catch {
    fail("STORAGE_BUCKET_API_FINALIZER_INVALID", "Storage bucket action evidence was invalid");
  }
  const expectedEffects = bucketApiReceiptEffects(expectedActionSummary);
  if (terminal.phase !== "verified_s1"
      || terminal.receiptSha256 !== receipt.receiptSha256
      || terminal.at !== receipt.capturedAt
      || (terminal.finalSnapshotObservedAt !== undefined
        && (terminal.finalSnapshotObservedAt !== receipt.finalSnapshotEvidence.observedAt
          || terminal.finalSnapshotFingerprintSha256
            !== receipt.finalSnapshotEvidence.canonicalFingerprintSha256))
      || receipt.journalChainSha256 !== bucketApiJournalChainSha256(preterminalRecords)
      || canonicalJson(receipt.authorizedDurableIntentSummary)
        !== canonicalJson(expectedActionSummary)
      || canonicalJson(receipt.effects) !== canonicalJson(expectedEffects)
      || receipt.authorizationTransitionCount !== authorizationRecords.length
      || receipt.authorizationChainSha256 !== sha256(canonicalJson(authorizationRecords))
      || receipt.recoveryApprovalSha256
        !== (authorizationRecords.at(-1)?.recoveryApprovalSha256 ?? null)) {
    fail("STORAGE_BUCKET_API_FINALIZER_INVALID", "Storage bucket receipt was not terminally sealed");
  }
  try {
    await receiptReservation.writeReceipt(receipt);
  } catch {
    fail("STORAGE_BUCKET_API_RECEIPT_WRITE_FAILED", "Storage bucket receipt was not durable");
  }
  try {
    await journal.remove();
  } catch (error) {
    if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
    fail("STORAGE_BUCKET_API_JOURNAL_REMOVE_FAILED", "Verified bucket journal was not removed");
  }
  try {
    await receiptReservation.close();
  } catch {
    fail("STORAGE_BUCKET_API_RECEIPT_WRITE_FAILED", "Storage bucket receipt handle was not closed");
  }
  return receipt;
  } finally {
    await journal.releaseOperationLease(operationLease);
  }
}

export function planAmoraSuccessorStorageStagingConvergence(input) {
  const snapshot = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(input);
  const baseline = bucketSetMatches(snapshot.buckets, BASELINE_BUCKETS)
    && policySetMatches(snapshot.policies, BASELINE_POLICIES);
  const target = bucketSetMatches(snapshot.buckets, TARGET_BUCKETS)
    && policySetMatches(snapshot.policies, TARGET_POLICIES, { semanticChatName: true });
  if (!baseline && !target) {
    fail("CONVERGENCE_STATE_AMBIGUOUS", "Storage catalog was neither exact baseline nor target");
  }
  if (baseline && !snapshot.readOnlyPrincipalCanSetStorageAdmin) {
    fail(
      "HOSTED_STORAGE_ADMIN_CAPABILITY_MISSING",
      "Management session cannot prove the atomic Storage policy role boundary",
    );
  }
  const vendor = vendorSafety(snapshot);
  if (!vendor) {
    fail("CONVERGENCE_STATE_AMBIGUOUS", "Storage vendor bucket was absent");
  }
  if (baseline && (vendor.oversizeObjectCount !== 0
      || vendor.disallowedMimeObjectCount !== 0
      || vendor.missingMetadataObjectCount !== 0)) {
    fail(
      "VENDOR_OBJECTS_UNSAFE",
      "Existing vendor objects are not proven compatible with the target restriction",
    );
  }
  const plan = {
    status: target ? "already_converged" : "planned",
    classification: target ? "target" : "baseline",
    actions: target ? Object.freeze([]) : ACTIONS,
    actionCount: target ? 0 : ACTIONS.length,
    baselineObjectCount: snapshot.totalObjectCount,
    baselineObjectInventorySha256: snapshot.objectInventorySha256,
    vendorSafety: vendor,
    mutationAuthorization: MUTATION_AUTHORIZATION,
  };
  return Object.freeze({
    ...plan,
    planSha256: sha256(canonicalJson(plan)),
  });
}

export function classifyAmoraSuccessorStorageStagingConvergenceOutcome(input) {
  try {
    const snapshot = normalizeAmoraSuccessorStorageStagingConvergenceSnapshot(input);
    if (bucketSetMatches(snapshot.buckets, BASELINE_BUCKETS)
        && policySetMatches(snapshot.policies, BASELINE_POLICIES)) {
      return "baseline";
    }
    if (bucketSetMatches(snapshot.buckets, TARGET_BUCKETS)
        && policySetMatches(snapshot.policies, TARGET_POLICIES, { semanticChatName: true })) {
      return "target";
    }
  } catch {
    return "ambiguous";
  }
  return "ambiguous";
}

export function assertAmoraSuccessorStorageStagingConvergenceMutationPlatform(
  runtimePlatform = FILESYSTEM_PLATFORM,
) {
  const explicitTestProbe = arguments.length > 0;
  if (runtimePlatform !== "linux"
      || (!explicitTestProbe && process.platform !== FILESYSTEM_PLATFORM)) {
    fail(
      "HOSTED_MUTATION_PLATFORM_UNSUPPORTED",
      "Storage convergence mutation requires the audited Linux host boundary",
    );
  }
}

export function createAmoraSuccessorStorageStagingConvergenceReceipt(input) {
  const plan = input?.plan;
  const projectRef = String(input?.projectRef ?? "");
  const discoveryGitCommit = String(input?.discoveryGitCommit ?? "");
  const convergenceToolGitCommit = String(input?.convergenceToolGitCommit ?? "");
  const discoveryReceiptSha256 = String(input?.discoveryReceiptSha256 ?? "");
  const capturedAt = new Date(input?.observedAt ?? Number.NaN);
  const expectedActions = plan?.status === "already_converged"
    ? []
    : ACTIONS;
  const planPayload = plan && {
    status: plan.status,
    classification: plan.classification,
    actions: plan.actions,
    actionCount: plan.actionCount,
    baselineObjectCount: plan.baselineObjectCount,
    baselineObjectInventorySha256: plan.baselineObjectInventorySha256,
    vendorSafety: plan.vendorSafety,
    mutationAuthorization: plan.mutationAuthorization,
  };
  if (projectRef !== APPROVED_STAGING_PROJECT_REF
      || String(input?.productionProjectRef ?? "")
        !== APPROVED_PRODUCTION_PROJECT_REF
      || discoveryGitCommit !== APPROVED_DISCOVERY_GIT_COMMIT
      || !/^[a-f0-9]{40}$/u.test(convergenceToolGitCommit)
      || !SHA256.test(discoveryReceiptSha256)
      || !Number.isFinite(capturedAt.valueOf())
      || !plan
      || !((plan.status === "planned" && plan.classification === "baseline")
        || (plan.status === "already_converged" && plan.classification === "target"))
      || !Array.isArray(plan.actions)
      || canonicalJson(plan.mutationAuthorization)
        !== canonicalJson(MUTATION_AUTHORIZATION)
      || plan.actionCount !== expectedActions.length
      || plan.actions.length !== expectedActions.length
      || !plan.actions.every((action, index) => (
        canonicalJson(action) === canonicalJson(expectedActions[index])
      ))
      || plan.planSha256 !== sha256(canonicalJson(planPayload))) {
    fail("STORAGE_CONVERGENCE_RECEIPT_INVALID", "Storage convergence receipt identity was invalid");
  }
  const receipt = {
    receiptVersion: 1,
    kind: "amora-successor-storage-staging-convergence-plan",
    status: plan.status === "planned"
      ? "planned_read_only"
      : "already_converged_read_only",
    scope: "staging-storage-catalog-convergence-plan-only",
    projectRef,
    discoveryGitCommit,
    convergenceToolGitCommit,
    discoveryReceiptSha256,
    capturedAt: capturedAt.toISOString(),
    actionCount: plan.actionCount,
    actionIds: Object.freeze(plan.actions.map((action) => action.id)),
    planSha256: plan.planSha256,
    baselineObjectCount: plan.baselineObjectCount,
    baselineObjectInventorySha256: plan.baselineObjectInventorySha256,
    vendorSafety: plan.vendorSafety,
    mutationAuthorization: MUTATION_AUTHORIZATION,
    applySqlSha256: sha256(STORAGE_STAGING_CONVERGENCE_APPLY_SQL),
    compensateSqlSha256: sha256(STORAGE_STAGING_CONVERGENCE_COMPENSATE_SQL),
    effects: Object.freeze({
      managementReadOnlyRequests: 1,
      databaseMutations: 0,
      authMutations: 0,
      storageMutations: 0,
      productionMutations: 0,
    }),
    evidence: Object.freeze({
      containsSecrets: false,
      containsRawSql: false,
      containsRawPolicyExpressions: false,
      containsFunctionSource: false,
      containsObjectPaths: false,
    }),
  };
  return Object.freeze({
    ...receipt,
    receiptSha256: sha256(canonicalJson(receipt)),
  });
}

const EXPECTED_BUCKET_VALUES_SQL = TARGET_BUCKETS.map((entry) => {
  const mime = entry.allowedMimeTypes === null
    ? "NULL::text[]"
    : `ARRAY[${entry.allowedMimeTypes.map((value) => `'${value}'`).join(",")}]::text[]`;
  return `('${entry.id}'::text, '${entry.name}'::text, ${entry.public}, ${entry.fileSizeLimit === null
    ? "NULL::bigint"
    : `${entry.fileSizeLimit}::bigint`}, ${mime})`;
}).join(",\n    ");

const BASELINE_BUCKET_VALUES_SQL = BASELINE_BUCKETS.map((entry) => {
  const mime = entry.allowedMimeTypes === null
    ? "NULL::text[]"
    : `ARRAY[${entry.allowedMimeTypes.map((value) => `'${value}'`).join(",")}]::text[]`;
  return `('${entry.id}'::text, '${entry.name}'::text, ${entry.public}, ${entry.fileSizeLimit === null
    ? "NULL::bigint"
    : `${entry.fileSizeLimit}::bigint`}, ${mime})`;
}).join(",\n    ");

const TARGET_BUCKET_INSERT_SQL = MISSING_BUCKETS.map((entry) => {
  const mime = entry.allowedMimeTypes === null
    ? "NULL::text[]"
    : `ARRAY[${entry.allowedMimeTypes.map((value) => `'${value}'`).join(",")}]::text[]`;
  return `('${entry.id}', '${entry.id}', ${entry.public}, ${entry.fileSizeLimit === null
    ? "NULL"
    : entry.fileSizeLimit}, ${mime})`;
}).join(",\n  ");

export const STORAGE_STAGING_CONVERGENCE_PLAN_SQL = `
WITH bucket_rows AS (
  SELECT bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
    bucket.allowed_mime_types, count(object.id)::integer AS bucket_object_count,
    count(*) FILTER (
      WHERE bucket.id = 'vendor-images'
        AND object.id IS NOT NULL
        AND CASE
          WHEN COALESCE(object.metadata ->> 'size' ~ '^[0-9]{1,20}$', false)
            THEN (object.metadata ->> 'size')::numeric > 5242880
          ELSE false
        END
    )::integer AS oversize_object_count,
    count(*) FILTER (
      WHERE bucket.id = 'vendor-images'
        AND object.id IS NOT NULL
        AND object.metadata ->> 'mimetype' IS NOT NULL
        AND lower(object.metadata ->> 'mimetype') NOT IN (
          'image/jpeg','image/png','image/webp'
        )
    )::integer AS disallowed_mime_object_count,
    count(*) FILTER (
      WHERE bucket.id = 'vendor-images'
        AND object.id IS NOT NULL
        AND (
          pg_catalog.jsonb_typeof(object.metadata) IS DISTINCT FROM 'object'
          OR object.metadata ->> 'size' IS NULL
          OR object.metadata ->> 'size' !~ '^[0-9]{1,20}$'
          OR object.metadata ->> 'mimetype' IS NULL
        )
    )::integer AS missing_metadata_object_count,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE(
      pg_catalog.string_agg(
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(pg_catalog.to_jsonb(object)::text, 'UTF8'), 'sha256'
        ), 'hex'), '' ORDER BY object.name, object.id
      ), ''
    ), 'UTF8'), 'sha256'), 'hex') AS bucket_object_inventory_sha256
  FROM storage.buckets AS bucket
  LEFT JOIN storage.objects AS object ON object.bucket_id = bucket.id
  GROUP BY bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
    bucket.allowed_mime_types
), policy_rows AS (
  SELECT policy.policyname AS name, policy.permissive::text AS permissive,
    ARRAY(SELECT role_name::text FROM pg_catalog.unnest(policy.roles) role_name
      ORDER BY role_name::text) AS roles,
    policy.cmd::text AS command,
    pg_catalog.encode(extensions.digest(
      COALESCE(policy.qual, '') || E'\\n' || COALESCE(policy.with_check, ''),
      'sha256'
    ), 'hex') AS expression_sha256
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
), object_rows AS (
  SELECT object.bucket_id, object.name, COALESCE(object.id::text, '') AS object_id,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(pg_catalog.to_jsonb(object)::text, 'UTF8'), 'sha256'
    ), 'hex') AS row_sha256
  FROM storage.objects AS object
), expected_helpers(
  contract_key, signature, expected_language, expected_volatility,
  expected_arguments, expected_config, expected_execute_roles, expected_source_sha256
) AS (
  VALUES
    ('productionStorageWritesAllowed'::text,
      'public.production_storage_writes_allowed()', 'sql', 's', ''::text,
      ARRAY['search_path=""']::text[], ARRAY['authenticated','postgres']::text[],
      '${HELPER_SOURCE_SHA256.productionStorageWritesAllowed}'),
    ('accountDeletionStorageWritesAllowed',
      'public.account_deletion_storage_writes_allowed()', 'plpgsql', 'v', '',
      ARRAY['search_path=""','lock_timeout=5s','statement_timeout=10s']::text[],
      ARRAY['authenticated','postgres']::text[],
      '${HELPER_SOURCE_SHA256.accountDeletionStorageWritesAllowed}'),
    ('isCurrentCouplePathMember',
      'public.is_current_couple_path_member(text)', 'sql', 's', '25',
      ARRAY['search_path=pg_catalog, public','statement_timeout=5s']::text[],
      ARRAY['authenticated','postgres','service_role']::text[],
      '${HELPER_SOURCE_SHA256.isCurrentCouplePathMember}')
), helper_rows AS (
  SELECT expected.*,
    function_record.oid,
    function_record.prokind,
    language_record.lanname,
    function_record.prorettype,
    function_record.proretset,
    function_record.pronargs,
    function_record.proargtypes::text AS actual_arguments,
    function_record.prosecdef,
    function_record.provolatile,
    function_record.proparallel,
    function_record.proleakproof,
    function_record.proisstrict,
    pg_catalog.pg_get_userbyid(function_record.proowner) AS proowner,
    function_record.proconfig,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(function_record.prosrc, 'UTF8'), 'sha256'
    ), 'hex') AS source_sha256,
    ARRAY(
      SELECT DISTINCT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(acl.grantee) END::text
      FROM pg_catalog.aclexplode(COALESCE(
        function_record.proacl,
        pg_catalog.acldefault('f', function_record.proowner)
      )) AS acl
      WHERE acl.privilege_type = 'EXECUTE' AND NOT acl.is_grantable
      ORDER BY 1
    ) AS execute_roles,
    EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
        function_record.proacl,
        pg_catalog.acldefault('f', function_record.proowner)
      )) AS acl
      WHERE acl.privilege_type <> 'EXECUTE' OR acl.is_grantable
    ) AS unexpected_acl
  FROM expected_helpers AS expected
  LEFT JOIN pg_catalog.pg_proc AS function_record
    ON function_record.oid = pg_catalog.to_regprocedure(expected.signature)
  LEFT JOIN pg_catalog.pg_language AS language_record
    ON language_record.oid = function_record.prolang
), helper_contract_rows AS (
  SELECT contract_key, expected_source_sha256 AS source_sha256,
    oid IS NOT NULL
      AND prokind = 'f'
      AND lanname = expected_language
      AND prorettype = 'pg_catalog.bool'::pg_catalog.regtype
      AND NOT proretset
      AND pronargs = CASE WHEN expected_arguments = '' THEN 0 ELSE 1 END
      AND actual_arguments = expected_arguments
      AND prosecdef
      AND provolatile = expected_volatility
      AND proparallel = 'u'
      AND NOT proleakproof
      AND NOT proisstrict
      AND proowner = 'postgres'
      AND proconfig IS NOT DISTINCT FROM expected_config
      AND execute_roles IS NOT DISTINCT FROM expected_execute_roles
      AND NOT unexpected_acl
      AND source_sha256 = expected_source_sha256
      AS contract_verified
  FROM helper_rows
)
SELECT
  pg_catalog.statement_timestamp()::text AS observed_at,
  pg_catalog.pg_get_userbyid(relation.relowner) AS relation_owner,
  relation.relrowsecurity AS relation_rls_enabled,
  relation.relforcerowsecurity AS relation_force_rls,
  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', bucket_rows.id,
    'name', bucket_rows.name,
    'public', bucket_rows.public,
    'fileSizeLimit', bucket_rows.file_size_limit,
    'allowedMimeTypes', bucket_rows.allowed_mime_types,
    'objectCount', bucket_rows.bucket_object_count,
    'oversizeObjectCount', bucket_rows.oversize_object_count,
    'disallowedMimeObjectCount', bucket_rows.disallowed_mime_object_count,
    'missingMetadataObjectCount', bucket_rows.missing_metadata_object_count,
    'objectInventorySha256', bucket_rows.bucket_object_inventory_sha256
  ) ORDER BY bucket_rows.id) FROM bucket_rows), '[]'::jsonb) AS buckets,
  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', policy_rows.name,
    'permissive', policy_rows.permissive,
    'roles', policy_rows.roles,
    'command', policy_rows.command,
    'expressionSha256', policy_rows.expression_sha256
  ) ORDER BY policy_rows.name) FROM policy_rows), '[]'::jsonb) AS policies,
  COALESCE((SELECT pg_catalog.jsonb_object_agg(
    helper_contract_rows.contract_key,
    pg_catalog.jsonb_build_object(
      'contractVerified', helper_contract_rows.contract_verified,
      'sourceSha256', helper_contract_rows.source_sha256
    )
  ) FROM helper_contract_rows), '{}'::jsonb) AS helper_contracts,
  pg_catalog.jsonb_build_object(
    'triggerNames', ARRAY(
      SELECT trigger_record.tgname::text
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE NOT trigger_record.tgisinternal
        AND trigger_record.tgname LIKE 'trg_production_write_fence%'
      ORDER BY trigger_record.tgname::text
    ),
    'eventTriggerNames', ARRAY(
      SELECT event_trigger_record.evtname::text
      FROM pg_catalog.pg_event_trigger AS event_trigger_record
      WHERE event_trigger_record.evtname LIKE 'evt_production_write_fence%'
      ORDER BY event_trigger_record.evtname::text
    ),
    'guardFunctionExists',
      pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()')
        IS NOT NULL,
    'attachFunctionExists',
      pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()')
        IS NOT NULL,
    'productionStorageWritesAllowed', NOT (
      EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgname = 'trg_production_write_fence_20260717' AND NOT t.tgisinternal)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger e
        WHERE e.evtname = 'evt_production_write_fence_20260717')
      OR pg_catalog.to_regprocedure('public.production_write_fence_guard_20260717()')
        IS NOT NULL
      OR pg_catalog.to_regprocedure('public.production_write_fence_attach_20260717()')
        IS NOT NULL
    )
  ) AS fence,
  (SELECT count(*)::integer FROM storage.objects) AS total_object_count,
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE((
    SELECT pg_catalog.string_agg(row_sha256, '' ORDER BY bucket_id, name, object_id)
    FROM object_rows
  ), ''), 'UTF8'), 'sha256'), 'hex') AS object_inventory_sha256,
  CASE
    WHEN pg_catalog.current_setting('server_version_num')::integer >= 160000
      THEN pg_catalog.pg_has_role(session_user, 'supabase_storage_admin', 'SET')
    ELSE pg_catalog.pg_has_role(session_user, 'supabase_storage_admin', 'MEMBER')
  END AS read_only_principal_can_set_storage_admin
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'storage' AND relation.relname = 'objects'
`.trim();

const STORAGE_STAGING_CONVERGENCE_FRESH_PLAN_SQL = `
SELECT snapshot.*, $1::text AS freshness_nonce
FROM (${STORAGE_STAGING_CONVERGENCE_PLAN_SQL}) AS snapshot
`.trim();

const BASELINE_POLICIES_JSON_SQL = `'${JSON.stringify(BASELINE_POLICIES)}'::jsonb`;
const TARGET_POLICIES_JSON_SQL = `'${JSON.stringify(TARGET_POLICIES)}'::jsonb`;
const HELPER_CONTRACTS_JSON_SQL = `'${JSON.stringify(Object.fromEntries(
  Object.entries(HELPER_SOURCE_SHA256).map(([key, sourceSha256]) => [
    key,
    { contractVerified: true, sourceSha256 },
  ]),
))}'::jsonb`;
const OPEN_FENCE_JSON_SQL = `'${JSON.stringify({
  triggerNames: [],
  eventTriggerNames: [],
  guardFunctionExists: false,
  attachFunctionExists: false,
  productionStorageWritesAllowed: true,
})}'::jsonb`;

const STORAGE_CONVERGENCE_LOCK_SQL = `
SET LOCAL ROLE supabase_storage_admin;
LOCK TABLE storage.buckets, storage.objects IN SHARE ROW EXCLUSIVE MODE;
RESET ROLE;
`.trim();

export const STORAGE_STAGING_CONVERGENCE_APPLY_SQL = `
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('amora:storage:staging-convergence:v1', 0)
);
${STORAGE_CONVERGENCE_LOCK_SQL}
DO $amora_storage_convergence_precondition$
DECLARE
  v_snapshot record;
BEGIN
  SELECT * INTO STRICT v_snapshot
  FROM (${STORAGE_STAGING_CONVERGENCE_PLAN_SQL}) AS snapshot;
  -- STORAGE_CONVERGENCE_BASELINE_DRIFT is the single fail-closed prestate class.
  IF EXISTS (
    WITH expected(id, name, is_public, file_size_limit, allowed_mime_types) AS (
      VALUES
        ${BASELINE_BUCKET_VALUES_SQL}
    ), actual AS (
      SELECT id, name, public AS is_public, file_size_limit, allowed_mime_types
      FROM storage.buckets
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_BASELINE_BUCKET_DRIFT';
  END IF;
  IF v_snapshot.relation_owner IS DISTINCT FROM 'supabase_storage_admin'
     OR v_snapshot.relation_rls_enabled IS NOT TRUE
     OR v_snapshot.relation_force_rls IS NOT FALSE
     OR v_snapshot.read_only_principal_can_set_storage_admin IS NOT TRUE
     OR v_snapshot.policies IS DISTINCT FROM ${BASELINE_POLICIES_JSON_SQL}
     OR v_snapshot.helper_contracts IS DISTINCT FROM ${HELPER_CONTRACTS_JSON_SQL}
     OR v_snapshot.fence IS DISTINCT FROM ${OPEN_FENCE_JSON_SQL} THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_BASELINE_CONTRACT_DRIFT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'vendor-images'
      AND (
        pg_catalog.jsonb_typeof(metadata) IS DISTINCT FROM 'object'
        OR metadata ->> 'size' IS NULL
        OR CASE
          WHEN COALESCE(metadata ->> 'size' ~ '^[0-9]{1,20}$', false)
            THEN (metadata ->> 'size')::numeric > 5242880
          ELSE true
        END
        OR lower(COALESCE(metadata ->> 'mimetype', '')) NOT IN (
          'image/jpeg','image/png','image/webp'
        )
      )
  ) THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_VENDOR_OBJECTS_UNSAFE';
  END IF;
  PERFORM pg_catalog.set_config(
    'amora.storage_convergence_object_count',
    v_snapshot.total_object_count::text,
    true
  );
  PERFORM pg_catalog.set_config(
    'amora.storage_convergence_object_sha256',
    v_snapshot.object_inventory_sha256,
    true
  );
END;
$amora_storage_convergence_precondition$;
SET LOCAL ROLE supabase_storage_admin;
DO $amora_storage_convergence_bucket_mutation$
DECLARE
  v_row_count bigint;
BEGIN
  INSERT INTO storage.buckets (
    id, name, public, file_size_limit, allowed_mime_types
  ) VALUES
    ${TARGET_BUCKET_INSERT_SQL};
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> ${MISSING_BUCKETS.length} THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_BUCKET_INSERT_COUNT_INVALID';
  END IF;

  UPDATE storage.buckets
  SET file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
  WHERE id = 'vendor-images' AND name = 'vendor-images' AND public = true
    AND file_size_limit IS NULL AND allowed_mime_types IS NULL;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_VENDOR_UPDATE_COUNT_INVALID';
  END IF;
END;
$amora_storage_convergence_bucket_mutation$;
CREATE POLICY "${STRICT_CHAT_POLICY_NAME}"
  ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-image'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND public.is_current_couple_path_member((storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND split_part(name, '/', 3) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpeg|jpg|png|gif|webp)$'
    AND public.account_deletion_storage_writes_allowed()
    AND (SELECT public.production_storage_writes_allowed())
  );
RESET ROLE;
DO $amora_storage_convergence_postcondition$
DECLARE
  v_snapshot record;
BEGIN
  SELECT * INTO STRICT v_snapshot
  FROM (${STORAGE_STAGING_CONVERGENCE_PLAN_SQL}) AS snapshot;
  -- STORAGE_CONVERGENCE_TARGET_DRIFT is the single fail-closed poststate class.
  IF EXISTS (
    WITH expected(id, name, is_public, file_size_limit, allowed_mime_types) AS (
      VALUES
        ${EXPECTED_BUCKET_VALUES_SQL}
    ), actual AS (
      SELECT id, name, public AS is_public, file_size_limit, allowed_mime_types
      FROM storage.buckets
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
     OR v_snapshot.relation_owner IS DISTINCT FROM 'supabase_storage_admin'
     OR v_snapshot.relation_rls_enabled IS NOT TRUE
     OR v_snapshot.relation_force_rls IS NOT FALSE
      OR v_snapshot.read_only_principal_can_set_storage_admin IS NOT TRUE
     OR v_snapshot.policies IS DISTINCT FROM ${TARGET_POLICIES_JSON_SQL}
     OR v_snapshot.helper_contracts IS DISTINCT FROM ${HELPER_CONTRACTS_JSON_SQL}
     OR v_snapshot.fence IS DISTINCT FROM ${OPEN_FENCE_JSON_SQL}
     OR v_snapshot.total_object_count::text IS DISTINCT FROM
       pg_catalog.current_setting('amora.storage_convergence_object_count', true)
     OR v_snapshot.object_inventory_sha256 IS DISTINCT FROM
       pg_catalog.current_setting('amora.storage_convergence_object_sha256', true)
     OR EXISTS (
       SELECT 1 FROM storage.objects
       WHERE bucket_id IN (${MISSING_BUCKETS.map((entry) => `'${entry.id}'`).join(",")})
     ) THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_POSTCONDITION_FAILED';
  END IF;
END;
$amora_storage_convergence_postcondition$;
COMMIT;
`.trim();

export const STORAGE_STAGING_CONVERGENCE_COMPENSATE_SQL = `
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('amora:storage:staging-convergence:v1', 0)
);
${STORAGE_CONVERGENCE_LOCK_SQL}
DO $amora_storage_compensation_precondition$
DECLARE
  v_snapshot record;
BEGIN
  SELECT * INTO STRICT v_snapshot
  FROM (${STORAGE_STAGING_CONVERGENCE_PLAN_SQL}) AS snapshot;
  IF EXISTS (
    WITH expected(id, name, is_public, file_size_limit, allowed_mime_types) AS (
      VALUES
        ${EXPECTED_BUCKET_VALUES_SQL}
    ), actual AS (
      SELECT id, name, public AS is_public, file_size_limit, allowed_mime_types
      FROM storage.buckets
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
     OR v_snapshot.relation_owner IS DISTINCT FROM 'supabase_storage_admin'
     OR v_snapshot.relation_rls_enabled IS NOT TRUE
     OR v_snapshot.relation_force_rls IS NOT FALSE
      OR v_snapshot.read_only_principal_can_set_storage_admin IS NOT TRUE
     OR v_snapshot.policies IS DISTINCT FROM ${TARGET_POLICIES_JSON_SQL}
     OR v_snapshot.helper_contracts IS DISTINCT FROM ${HELPER_CONTRACTS_JSON_SQL}
     OR v_snapshot.fence IS DISTINCT FROM ${OPEN_FENCE_JSON_SQL} THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_COMPENSATION_TARGET_DRIFT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id IN (${MISSING_BUCKETS.map((entry) => `'${entry.id}'`).join(",")})
  ) THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_COMPENSATION_BUCKET_NOT_EMPTY';
  END IF;
  PERFORM pg_catalog.set_config(
    'amora.storage_convergence_object_count',
    v_snapshot.total_object_count::text,
    true
  );
  PERFORM pg_catalog.set_config(
    'amora.storage_convergence_object_sha256',
    v_snapshot.object_inventory_sha256,
    true
  );
END;
$amora_storage_compensation_precondition$;
SET LOCAL ROLE supabase_storage_admin;
DROP POLICY "${STRICT_CHAT_POLICY_NAME}" ON storage.objects;
DO $amora_storage_compensation_bucket_mutation$
DECLARE
  v_row_count bigint;
BEGIN
  DELETE FROM storage.buckets
  WHERE id IN (${MISSING_BUCKETS.map((entry) => `'${entry.id}'`).join(",")});
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> ${MISSING_BUCKETS.length} THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_COMPENSATION_DELETE_COUNT_INVALID';
  END IF;

  UPDATE storage.buckets
  SET file_size_limit = NULL, allowed_mime_types = NULL
  WHERE id = 'vendor-images' AND name = 'vendor-images' AND public = true
    AND file_size_limit = 5242880
    AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[];
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_COMPENSATION_VENDOR_COUNT_INVALID';
  END IF;
END;
$amora_storage_compensation_bucket_mutation$;
RESET ROLE;
DO $amora_storage_compensation_postcondition$
DECLARE
  v_snapshot record;
BEGIN
  SELECT * INTO STRICT v_snapshot
  FROM (${STORAGE_STAGING_CONVERGENCE_PLAN_SQL}) AS snapshot;
  IF EXISTS (
    WITH expected(id, name, is_public, file_size_limit, allowed_mime_types) AS (
      VALUES
        ${BASELINE_BUCKET_VALUES_SQL}
    ), actual AS (
      SELECT id, name, public AS is_public, file_size_limit, allowed_mime_types
      FROM storage.buckets
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
     OR v_snapshot.relation_owner IS DISTINCT FROM 'supabase_storage_admin'
     OR v_snapshot.relation_rls_enabled IS NOT TRUE
     OR v_snapshot.relation_force_rls IS NOT FALSE
      OR v_snapshot.read_only_principal_can_set_storage_admin IS NOT TRUE
     OR v_snapshot.policies IS DISTINCT FROM ${BASELINE_POLICIES_JSON_SQL}
     OR v_snapshot.helper_contracts IS DISTINCT FROM ${HELPER_CONTRACTS_JSON_SQL}
     OR v_snapshot.fence IS DISTINCT FROM ${OPEN_FENCE_JSON_SQL}
     OR v_snapshot.total_object_count::text IS DISTINCT FROM
       pg_catalog.current_setting('amora.storage_convergence_object_count', true)
     OR v_snapshot.object_inventory_sha256 IS DISTINCT FROM
       pg_catalog.current_setting('amora.storage_convergence_object_sha256', true) THEN
    RAISE EXCEPTION 'STORAGE_CONVERGENCE_COMPENSATION_POSTCONDITION_FAILED';
  END IF;
END;
$amora_storage_compensation_postcondition$;
COMMIT;
`.trim();

function parseBoundedJsonValue(value, field) {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 256 * 1024) {
    fail("STORAGE_CONVERGENCE_PLAN_RESULT_INVALID", `Storage plan ${field} was invalid`);
  }
  try {
    return JSON.parse(value);
  } catch {
    fail("STORAGE_CONVERGENCE_PLAN_RESULT_INVALID", `Storage plan ${field} was not JSON`);
  }
}

function storageBucketApiPayload(entry) {
  return Object.freeze({
    id: entry.id,
    name: entry.name,
    public: entry.public,
    file_size_limit: entry.fileSizeLimit,
    allowed_mime_types: entry.allowedMimeTypes === null
      ? null
      : Object.freeze([...entry.allowedMimeTypes]),
  });
}

function normalizeStorageApiBucket(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("STORAGE_BUCKET_API_RESPONSE_INVALID", "Storage bucket response was invalid");
  }
  const id = String(input.id ?? "");
  const name = String(input.name ?? "");
  const isPublic = input.public;
  const fileSizeLimit = input.file_size_limit ?? input.fileSizeLimit ?? null;
  const allowedMimeTypes = input.allowed_mime_types ?? input.allowedMimeTypes ?? null;
  if (!TARGET_BUCKETS.some((entry) => entry.id === id)
      || name !== id || typeof isPublic !== "boolean"
      || (fileSizeLimit !== null
        && (!Number.isSafeInteger(fileSizeLimit) || fileSizeLimit < 0))
      || (allowedMimeTypes !== null
        && (!Array.isArray(allowedMimeTypes)
          || allowedMimeTypes.some((entry) => typeof entry !== "string"
            || entry.length < 1 || entry.length > 255)))) {
    fail("STORAGE_BUCKET_API_RESPONSE_INVALID", "Storage bucket response was invalid");
  }
  return Object.freeze({
    id,
    name,
    public: isPublic,
    fileSizeLimit,
    allowedMimeTypes: allowedMimeTypes === null
      ? null
      : Object.freeze([...allowedMimeTypes]),
  });
}

async function boundedStorageApiResponseJson(response) {
  const declaredLength = response?.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined
      && (!/^[0-9]+$/u.test(declaredLength)
        || Number(declaredLength) > MAX_STORAGE_API_RESPONSE_BYTES)) {
    fail(
      "STORAGE_BUCKET_API_RESPONSE_TOO_LARGE",
      "Storage API response exceeded the bounded size",
    );
  }
  if (!response?.body || typeof response.body.getReader !== "function") {
    if (response?.status === 204) return null;
    fail("STORAGE_BUCKET_API_RESPONSE_INVALID", "Storage API response stream was unavailable");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_STORAGE_API_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        fail(
          "STORAGE_BUCKET_API_RESPONSE_TOO_LARGE",
          "Storage API response exceeded the bounded size",
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");
  if (raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    fail("STORAGE_BUCKET_API_RESPONSE_INVALID", "Storage API response was not JSON");
  }
}

function safeStorageStatusCode(value) {
  const normalized = String(value ?? "");
  return /^[0-9]{3}$/u.test(normalized) ? normalized : null;
}

function safeStorageErrorCode(value) {
  const normalized = String(value ?? "");
  return /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(normalized) ? normalized : null;
}

function safeStorageMutationResult(response) {
  if (response.networkUnavailable) {
    return Object.freeze({
      outcome: "unknown",
      httpStatus: null,
      storageStatusCode: null,
      errorCode: "STORAGE_REQUEST_UNAVAILABLE",
    });
  }
  if (response.bodyUnavailable) {
    return Object.freeze({
      outcome: response.ok === false ? "rejected" : "unknown",
      httpStatus: response.httpStatus,
      storageStatusCode: null,
      errorCode: "STORAGE_RESPONSE_UNAVAILABLE",
    });
  }
  const body = response.body && typeof response.body === "object"
    && !Array.isArray(response.body) ? response.body : {};
  return Object.freeze({
    outcome: response.ok ? "accepted" : "rejected",
    httpStatus: response.httpStatus,
    storageStatusCode: safeStorageStatusCode(body.statusCode),
    errorCode: safeStorageErrorCode(body.code),
  });
}

export function createAmoraSuccessorStorageBucketApiTransport({
  projectRef,
  productionProjectRef,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
}) {
  assertAmoraSuccessorStorageStagingConvergenceMutationPlatform();
  const stagingRef = String(projectRef ?? "").trim();
  const productionRef = String(productionProjectRef ?? "").trim();
  if (!/^[a-z0-9]{20}$/u.test(stagingRef)
      || !/^[a-z0-9]{20}$/u.test(productionRef)) {
    fail("STORAGE_BUCKET_API_CONFIG_INVALID", "Storage API project refs were invalid");
  }
  if (stagingRef === productionRef || stagingRef === APPROVED_PRODUCTION_PROJECT_REF) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "Storage bucket API convergence is staging-only");
  }
  if (stagingRef !== APPROVED_STAGING_PROJECT_REF) {
    fail("STAGING_PROJECT_PIN_MISMATCH", "Storage bucket API target was not approved");
  }
  if (productionRef !== APPROVED_PRODUCTION_PROJECT_REF) {
    fail("PRODUCTION_PROJECT_PIN_MISMATCH", "Storage bucket API Production deny ref drifted");
  }
  if (typeof serviceRoleKey !== "string" || serviceRoleKey.length < 20
      || /[\r\n]/u.test(serviceRoleKey) || typeof fetchImpl !== "function") {
    fail("STORAGE_BUCKET_API_CONFIG_INVALID", "Storage bucket API credentials were invalid");
  }
  const origin = `https://${stagingRef}.supabase.co`;
  const productionOrigin = `https://${productionRef}.supabase.co`;
  try {
    verifySupabaseServiceDestination({
      url: origin,
      expectedUrl: origin,
      expectedProjectRef: stagingRef,
      productionProjectRef: productionRef,
      serviceRoleKey,
      access: "operator-write",
    });
  } catch {
    fail(
      "STORAGE_BUCKET_API_CONFIG_INVALID",
      "Storage bucket API service destination could not be authenticated",
    );
  }
  const readableBucketIds = new Set([
    ...MISSING_BUCKETS.map((entry) => entry.id),
    "vendor-images",
  ]);
  const creatableBuckets = new Map(MISSING_BUCKETS.map((entry) => [entry.id, entry]));

  async function request(path, { method = "GET", body } = {}) {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.origin === productionOrigin
        || url.protocol !== "https:" || url.username || url.password) {
      fail("STORAGE_BUCKET_API_HOST_FORBIDDEN", "Storage request escaped the staging host");
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return Object.freeze({ networkUnavailable: true });
    }
    let parsed;
    try {
      parsed = await boundedStorageApiResponseJson(response);
    } catch (error) {
      if (method === "POST" || method === "PUT") {
        return Object.freeze({
          ok: response.ok,
          httpStatus: response.status,
          bodyUnavailable: true,
        });
      }
      throw error;
    }
    return Object.freeze({
      ok: response.ok,
      httpStatus: response.status,
      body: parsed,
    });
  }

  async function listBuckets() {
    const buckets = [];
    const seen = new Set();
    for (let offset = 0; offset <= 200; offset += 100) {
      const query = new URLSearchParams({
        limit: "100",
        offset: String(offset),
        sortColumn: "id",
        sortOrder: "asc",
      });
      const result = await request(`/storage/v1/bucket?${query.toString()}`);
      if (result.networkUnavailable || !result.ok || !Array.isArray(result.body)) {
        fail("STORAGE_BUCKET_API_INVENTORY_UNAVAILABLE", "Storage bucket inventory failed");
      }
      for (const entry of result.body) {
        const normalized = normalizeStorageApiBucket(entry);
        if (seen.has(normalized.id)) {
          fail("STORAGE_BUCKET_API_RESPONSE_INVALID", "Storage bucket inventory was duplicated");
        }
        seen.add(normalized.id);
        buckets.push(normalized);
      }
      if (result.body.length < 100) {
        return Object.freeze(buckets.sort(compareById));
      }
    }
    fail("STORAGE_BUCKET_API_RESPONSE_INVALID", "Storage bucket inventory exceeded its bound");
  }

  async function getBucket(bucketId) {
    if (!readableBucketIds.has(bucketId)) {
      fail("STORAGE_BUCKET_API_ACTION_FORBIDDEN", "Storage bucket read was not allowlisted");
    }
    const result = await request(`/storage/v1/bucket/${encodeURIComponent(bucketId)}`);
    if (result.networkUnavailable) {
      return Object.freeze({ outcome: "unknown", bucket: null });
    }
    if (!result.ok) {
      const statusCode = safeStorageStatusCode(result.body?.statusCode);
      return Object.freeze({
        outcome: statusCode === "404" ? "absent" : "unknown",
        bucket: null,
      });
    }
    return Object.freeze({
      outcome: "found",
      bucket: normalizeStorageApiBucket(result.body),
    });
  }

  async function createBucket(bucketId, mutationCapability) {
    await assertBucketApiMutationCapability(mutationCapability, {
      projectRef: stagingRef,
      productionProjectRef: productionRef,
    });
    const target = creatableBuckets.get(bucketId);
    if (!target) {
      fail("STORAGE_BUCKET_API_ACTION_FORBIDDEN", "Storage bucket create was not allowlisted");
    }
    const result = await request("/storage/v1/bucket", {
      method: "POST",
      body: storageBucketApiPayload(target),
    });
    const safe = safeStorageMutationResult(result);
    if (safe.outcome === "accepted"
        && (result.body?.name !== target.id || Object.keys(result.body).length !== 1)) {
      return Object.freeze({
        outcome: "unknown",
        httpStatus: result.httpStatus,
        storageStatusCode: null,
        errorCode: "STORAGE_RESPONSE_INVALID",
      });
    }
    return safe;
  }

  async function updateVendorImages(mutationCapability) {
    await assertBucketApiMutationCapability(mutationCapability, {
      projectRef: stagingRef,
      productionProjectRef: productionRef,
    });
    const target = TARGET_BUCKETS.find((entry) => entry.id === "vendor-images");
    const result = await request("/storage/v1/bucket/vendor-images", {
      method: "PUT",
      body: storageBucketApiPayload(target),
    });
    return safeStorageMutationResult(result);
  }

  const transport = Object.freeze({
    listBuckets,
    getBucket,
    createBucket,
    updateVendorImages,
  });
  BUCKET_API_TRANSPORT_CAPABILITIES.set(transport, Object.freeze({
    productionProjectRef: productionRef,
    projectRef: stagingRef,
  }));
  return transport;
}

function snapshotFromPlanningRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    fail("STORAGE_CONVERGENCE_PLAN_RESULT_INVALID", "Storage plan returned no typed row");
  }
  return normalizeAmoraSuccessorStorageStagingConvergenceSnapshot({
    observedAt: row.observed_at,
    relationOwner: row.relation_owner,
    relationRlsEnabled: row.relation_rls_enabled,
    relationForceRls: row.relation_force_rls,
    buckets: parseBoundedJsonValue(row.buckets, "buckets"),
    policies: parseBoundedJsonValue(row.policies, "policies"),
    helperContracts: parseBoundedJsonValue(row.helper_contracts, "helper contracts"),
    fence: parseBoundedJsonValue(row.fence, "fence"),
    totalObjectCount: row.total_object_count,
    objectInventorySha256: row.object_inventory_sha256,
    readOnlyPrincipalCanSetStorageAdmin:
      row.read_only_principal_can_set_storage_admin,
  });
}

function validateRef(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^[a-z0-9]{20}$/u.test(normalized)) {
    fail("STORAGE_CONVERGENCE_CONFIG_INVALID", `${field} was not an exact project ref`);
  }
  return normalized;
}

function validateCommit(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^[a-f0-9]{40}$/u.test(normalized)) {
    fail("STORAGE_CONVERGENCE_CONFIG_INVALID", `${field} was not a full commit SHA`);
  }
  return normalized;
}

function hasExactKeys(value, expectedKeys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && exactArray(Object.keys(value).sort(), [...expectedKeys].sort());
}

function canonicalIsoString(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function exactStringArray(value, { maxItems = 256 } = {}) {
  return Array.isArray(value) && value.length <= maxItems
    && value.every((entry) => typeof entry === "string" && entry.length <= 1024);
}

function discoveryInventorySchemaIsExact(inventory) {
  if (!hasExactKeys(inventory, [
    "observedAt", "relationOwner", "relationRlsEnabled", "relationForceRls",
    "buckets", "policies", "helperFunctions", "fence", "totalObjectCount",
    "objectInventorySha256",
  ])
      || !canonicalIsoString(inventory.observedAt)
      || typeof inventory.relationOwner !== "string"
      || inventory.relationOwner.length > 255
      || typeof inventory.relationRlsEnabled !== "boolean"
      || typeof inventory.relationForceRls !== "boolean"
      || !Array.isArray(inventory.buckets) || inventory.buckets.length > 256
      || !Array.isArray(inventory.policies) || inventory.policies.length > 512
      || !Array.isArray(inventory.helperFunctions)
      || inventory.helperFunctions.length > 128
      || !hasExactKeys(inventory.fence, [
        "triggerNames", "eventTriggerNames", "guardFunctionExists",
        "attachFunctionExists", "productionStorageWritesAllowed",
      ])
      || !exactStringArray(inventory.fence.triggerNames)
      || !exactStringArray(inventory.fence.eventTriggerNames)
      || typeof inventory.fence.guardFunctionExists !== "boolean"
      || typeof inventory.fence.attachFunctionExists !== "boolean"
      || typeof inventory.fence.productionStorageWritesAllowed !== "boolean"
      || !Number.isSafeInteger(inventory.totalObjectCount)
      || inventory.totalObjectCount < 0
      || !SHA256.test(inventory.objectInventorySha256 ?? "")) {
    return false;
  }
  const bucketsExact = inventory.buckets.every((entry) => (
    hasExactKeys(entry, [
      "id", "name", "public", "fileSizeLimit", "allowedMimeTypes",
    ])
      && typeof entry.id === "string" && entry.id.length <= 255
      && typeof entry.name === "string" && entry.name.length <= 255
      && typeof entry.public === "boolean"
      && (entry.fileSizeLimit === null
        || (Number.isSafeInteger(entry.fileSizeLimit) && entry.fileSizeLimit >= 0))
      && (entry.allowedMimeTypes === null
        || exactStringArray(entry.allowedMimeTypes, { maxItems: 64 }))
  ));
  const policiesExact = inventory.policies.every((entry) => (
    hasExactKeys(entry, [
      "name", "permissive", "roles", "command", "usingExpressionSha256",
      "withCheckExpressionSha256", "expressionSha256",
    ])
      && typeof entry.name === "string" && entry.name.length <= 255
      && ["PERMISSIVE", "RESTRICTIVE"].includes(entry.permissive)
      && exactStringArray(entry.roles, { maxItems: 64 })
      && ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"].includes(entry.command)
      && SHA256.test(entry.usingExpressionSha256 ?? "")
      && SHA256.test(entry.withCheckExpressionSha256 ?? "")
      && SHA256.test(entry.expressionSha256 ?? "")
  ));
  const helpersExact = inventory.helperFunctions.every((entry) => (
    hasExactKeys(entry, [
      "schema", "name", "identityArguments", "owner", "securityDefiner",
      "volatility", "configSha256", "searchPathEmpty", "executeRoles",
      "sourceSha256",
    ])
      && [entry.schema, entry.name, entry.identityArguments, entry.owner]
        .every((value) => typeof value === "string" && value.length <= 1024)
      && typeof entry.securityDefiner === "boolean"
      && ["IMMUTABLE", "STABLE", "VOLATILE"].includes(entry.volatility)
      && SHA256.test(entry.configSha256 ?? "")
      && typeof entry.searchPathEmpty === "boolean"
      && exactStringArray(entry.executeRoles, { maxItems: 64 })
      && SHA256.test(entry.sourceSha256 ?? "")
  ));
  return bucketsExact && policiesExact && helpersExact;
}

function discoveryReceiptSchemaIsExact(receipt, projectRef) {
  return hasExactKeys(receipt, [
    "receiptVersion", "kind", "status", "scope", "projectRef", "gitCommit",
    "capturedAt", "effects", "containsSecrets", "containsRawExpressions",
    "containsFunctionSource", "containsObjectPaths", "inventory",
  ])
    && receipt.receiptVersion === 1
    && receipt.kind === "amora-successor-storage-catalog-discovery"
    && receipt.status === "captured_read_only"
    && receipt.scope === "staging-storage-catalog-discovery-only"
    && receipt.projectRef === projectRef
    && receipt.gitCommit === APPROVED_DISCOVERY_GIT_COMMIT
    && canonicalIsoString(receipt.capturedAt)
    && hasExactKeys(receipt.effects, [
      "managementReadOnlyRequests", "authMutations", "storageMutations",
      "productionMutations",
    ])
    && receipt.effects.managementReadOnlyRequests === 1
    && receipt.effects.authMutations === 0
    && receipt.effects.storageMutations === 0
    && receipt.effects.productionMutations === 0
    && receipt.containsSecrets === false
    && receipt.containsRawExpressions === false
    && receipt.containsFunctionSource === false
    && receipt.containsObjectPaths === false
    && discoveryInventorySchemaIsExact(receipt.inventory);
}

export function validateAmoraSuccessorStorageStagingConvergencePlanConfig(input) {
  const projectRef = validateRef(input?.projectRef, "staging project");
  const productionProjectRef = validateRef(input?.productionProjectRef, "Production project");
  const approvedProjectRef = validateRef(input?.approvedProjectRef, "approved staging project");
  if (projectRef === productionProjectRef
      || projectRef === APPROVED_PRODUCTION_PROJECT_REF) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "Storage convergence planning is staging-only");
  }
  if (productionProjectRef !== APPROVED_PRODUCTION_PROJECT_REF) {
    fail(
      "PRODUCTION_PROJECT_PIN_MISMATCH",
      "Storage convergence Production deny reference was not repository-pinned",
    );
  }
  if (projectRef !== APPROVED_STAGING_PROJECT_REF
      || approvedProjectRef !== APPROVED_STAGING_PROJECT_REF) {
    fail("STAGING_PROJECT_PIN_MISMATCH", "Storage convergence target was not approved");
  }
  const managementToken = String(input?.managementToken ?? "");
  if (managementToken.length < 20 || /[\r\n]/u.test(managementToken)) {
    fail("STORAGE_CONVERGENCE_CONFIG_INVALID", "Management token was invalid");
  }
  const discoveryReceiptRaw = String(input?.discoveryReceiptRaw ?? "");
  const discoveryReceiptSha256 = String(input?.discoveryReceiptSha256 ?? "");
  if (Buffer.byteLength(discoveryReceiptRaw, "utf8") < 2
      || Buffer.byteLength(discoveryReceiptRaw, "utf8") > MAX_DISCOVERY_RECEIPT_BYTES
      || !SHA256.test(discoveryReceiptSha256)
      || sha256(discoveryReceiptRaw) !== discoveryReceiptSha256) {
    fail("DISCOVERY_RECEIPT_INVALID", "Storage discovery receipt bytes were not exact");
  }
  let discoveryReceipt;
  try {
    discoveryReceipt = JSON.parse(discoveryReceiptRaw);
  } catch {
    fail("DISCOVERY_RECEIPT_INVALID", "Storage discovery receipt was not JSON");
  }
  if (!discoveryReceiptSchemaIsExact(discoveryReceipt, projectRef)) {
    fail("DISCOVERY_RECEIPT_INVALID", "Storage discovery receipt contract drifted");
  }
  const discoveryGitCommit = validateCommit(
    discoveryReceipt.gitCommit,
    "discovery commit",
  );
  const convergenceToolGitCommit = validateCommit(
    input?.convergenceToolGitCommit,
    "convergence tool commit",
  );
  return Object.freeze({
    projectRef,
    productionProjectRef,
    approvedProjectRef,
    managementToken,
    discoveryReceiptRaw,
    discoveryReceiptSha256,
    discoveryGitCommit,
    convergenceToolGitCommit,
  });
}

async function boundedResponseJson(response, code) {
  const declaredLength = response?.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    if (!/^[0-9]+$/u.test(declaredLength)
        || Number(declaredLength) > MAX_MANAGEMENT_RESPONSE_BYTES) {
      fail(code, "Storage convergence response exceeded the bounded size");
    }
  }
  let raw;
  try {
    if (response?.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          totalBytes += chunk.byteLength;
          // With no trusted Content-Length, keep one-byte headroom so the
          // stream can be cancelled before an additional queued chunk is read.
          if (totalBytes >= MAX_MANAGEMENT_RESPONSE_BYTES) {
            void reader.cancel();
            fail(code, "Storage convergence response exceeded the bounded size");
          }
          chunks.push(chunk);
        }
      } finally {
        reader.releaseLock?.();
      }
      raw = Buffer.concat(chunks, totalBytes).toString("utf8");
    } else {
      raw = await response.text();
    }
  } catch {
    fail(code, "Storage convergence response could not be read");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_MANAGEMENT_RESPONSE_BYTES) {
    fail(code, "Storage convergence response exceeded the bounded size");
  }
  try {
    return raw === "" ? null : JSON.parse(raw);
  } catch {
    fail(code, "Storage convergence response was not JSON");
  }
}

export async function inspectAmoraSuccessorStorageStagingConvergencePlan({
  config,
  fetchImpl = globalThis.fetch,
}) {
  const validated = validateAmoraSuccessorStorageStagingConvergencePlanConfig(config);
  if (typeof fetchImpl !== "function") {
    fail("STORAGE_CONVERGENCE_CONFIG_INVALID", "Storage convergence fetch boundary was invalid");
  }
  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${validated.projectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validated.managementToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: STORAGE_STAGING_CONVERGENCE_PLAN_SQL,
          parameters: [],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    fail("STORAGE_CONVERGENCE_PLAN_UNAVAILABLE", "Storage convergence read failed");
  }
  const body = await boundedResponseJson(response, "STORAGE_CONVERGENCE_PLAN_UNAVAILABLE");
  if (response.status !== 201 || !Array.isArray(body) || body.length !== 1) {
    fail("STORAGE_CONVERGENCE_PLAN_UNAVAILABLE", "Storage convergence read was rejected");
  }
  return snapshotFromPlanningRow(body[0]);
}

export function createAmoraSuccessorStorageBucketApiSnapshotInspector({
  config,
  fetchImpl = globalThis.fetch,
  onInspect,
}) {
  const validated = validateAmoraSuccessorStorageStagingConvergencePlanConfig(config);
  if (typeof fetchImpl !== "function") {
    fail("STORAGE_CONVERGENCE_CONFIG_INVALID", "Storage inspector fetch boundary was invalid");
  }
  if (onInspect !== undefined && typeof onInspect !== "function") {
    fail("STORAGE_CONVERGENCE_CONFIG_INVALID", "Storage inspector observer was invalid");
  }
  let lastObservedAt = null;
  const inspector = async (context) => {
    if (!context || typeof context !== "object" || Array.isArray(context)
        || typeof context.stage !== "string" || context.stage.length > 64
        || !SHA256.test(context.planSha256 ?? "")) {
      fail("STORAGE_BUCKET_API_SNAPSHOT_STALE", "Storage inspector context was invalid");
    }
    const freshnessNonce = randomUUID();
    onInspect?.(context);
    const startedAt = Date.now();
    let response;
    try {
      response = await fetchImpl(
        `https://api.supabase.com/v1/projects/${validated.projectRef}/database/query/read-only`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${validated.managementToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: STORAGE_STAGING_CONVERGENCE_FRESH_PLAN_SQL,
            parameters: [freshnessNonce],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      fail("STORAGE_BUCKET_API_SNAPSHOT_STALE", "Storage inspector read failed");
    }
    const finishedAt = Date.now();
    const body = await boundedResponseJson(response, "STORAGE_BUCKET_API_SNAPSHOT_STALE");
    const row = Array.isArray(body) && body.length === 1 ? body[0] : null;
    const observedAt = Date.parse(row?.observed_at ?? "");
    const allowedClockSkewMs = 5_000;
    if (response.status !== 201 || row?.freshness_nonce !== freshnessNonce
        || !Number.isFinite(observedAt)
        || observedAt < startedAt - allowedClockSkewMs
        || observedAt > finishedAt + allowedClockSkewMs
        || (lastObservedAt !== null && observedAt < lastObservedAt)) {
      fail("STORAGE_BUCKET_API_SNAPSHOT_STALE", "Storage inspector response was not request-fresh");
    }
    lastObservedAt = observedAt;
    return Object.freeze({
      ...snapshotFromPlanningRow(row),
      freshnessNonce,
    });
  };
  BUCKET_API_INSPECTOR_CAPABILITIES.set(inspector, Object.freeze({
    productionProjectRef: validated.productionProjectRef,
    projectRef: validated.projectRef,
  }));
  return inspector;
}

export async function runAmoraSuccessorStorageStagingConvergencePlan({
  config,
  fetchImpl = globalThis.fetch,
  writeReceipt,
}) {
  const validated = validateAmoraSuccessorStorageStagingConvergencePlanConfig(config);
  if (writeReceipt !== undefined && typeof writeReceipt !== "function") {
    fail("STORAGE_CONVERGENCE_CONFIG_INVALID", "Storage convergence writer was invalid");
  }
  const snapshot = await inspectAmoraSuccessorStorageStagingConvergencePlan({
    config: validated,
    fetchImpl,
  });
  const plan = planAmoraSuccessorStorageStagingConvergence(snapshot);
  const receipt = createAmoraSuccessorStorageStagingConvergenceReceipt({
    projectRef: validated.projectRef,
    productionProjectRef: validated.productionProjectRef,
    discoveryGitCommit: validated.discoveryGitCommit,
    convergenceToolGitCommit: validated.convergenceToolGitCommit,
    discoveryReceiptSha256: validated.discoveryReceiptSha256,
    observedAt: snapshot.observedAt,
    plan,
  });
  if (writeReceipt) await writeReceipt(receipt);
  return receipt;
}

export const AMORA_STORAGE_STAGING_CONVERGENCE_TARGET = Object.freeze({
  buckets: TARGET_BUCKETS,
  policies: TARGET_POLICIES,
  baselineBuckets: BASELINE_BUCKETS,
  baselinePolicies: BASELINE_POLICIES,
  actions: ACTIONS,
  bucketApiActions: BUCKET_API_ACTIONS,
  bucketApiTargetContractSha256: BUCKET_API_TARGET_CONTRACT_SHA256,
  helperSourceSha256: HELPER_SOURCE_SHA256,
});
