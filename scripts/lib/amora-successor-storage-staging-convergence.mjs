import { createHash } from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/u;
const APPROVED_STAGING_PROJECT_REF = "rgxdizztidbgwnsbadml";
const APPROVED_PRODUCTION_PROJECT_REF = "slrtobkksjmxgzatjyqb";
const APPROVED_DISCOVERY_GIT_COMMIT =
  "e540cc69da7cbfd919f101d0b4edd2c7d15e92be";
const MAX_DISCOVERY_RECEIPT_BYTES = 64 * 1024;
const MAX_MANAGEMENT_RESPONSE_BYTES = 512 * 1024;
const MUTATION_AUTHORIZATION = Object.freeze({
  status: "unproven",
  authorized: false,
  reason: "WRITE_ENDPOINT_PRINCIPAL_UNDOCUMENTED",
});

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

const ACTIONS = Object.freeze([
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
  Object.freeze({
    id: "create_policy:chat-image-strict-insert",
    kind: "create_policy",
    semanticKey: "chat-image-strict-insert",
  }),
]);

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
  runtimePlatform = process.platform,
) {
  if (runtimePlatform === "win32") {
    fail(
      "HOSTED_MUTATION_PLATFORM_UNSUPPORTED",
      "Storage convergence mutation requires POSIX durable intent handling",
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
  helperSourceSha256: HELPER_SOURCE_SHA256,
});
