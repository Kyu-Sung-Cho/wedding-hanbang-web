import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MANIFEST_PATH = "supabase/release-manifests/amora-engine-v2-20260716.json";
const PREDECESSOR_STORAGE_FREEZE_OPERATION_ID =
  "storage-global-write-freeze-20260716108000";
const MAX_JSON_BYTES = 64 * 1024;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const SAFE_RECEIPT = /^[a-z0-9][a-z0-9_.-]{2,80}\.json$/;
const LOWER_SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;

// This query returns no object identifiers. It hashes each complete storage.objects
// row, hashes the ordered row-hash stream again, and reports the database clock.
// The Management API executes it as supabase_read_only_user.
export const STORAGE_INVENTORY_READ_ONLY_SQL = `
WITH object_rows AS (
  SELECT
    o.bucket_id,
    o.name AS object_name,
    COALESCE(o.id::text, '') AS object_id,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(pg_catalog.to_jsonb(o)::text, 'UTF8')
      ),
      'hex'
    ) AS row_sha256
  FROM storage.objects AS o
),
inventory AS (
  SELECT
    count(*)::bigint AS object_count,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          COALESCE(
            pg_catalog.string_agg(
              row_sha256,
              '' ORDER BY bucket_id, object_name, object_id
            ),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    ) AS object_inventory_sha256
  FROM object_rows
),
mutation_policies AS (
  SELECT count(*)::bigint AS policy_count
  FROM pg_catalog.pg_policy AS p
  JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND p.polcmd IN ('a', 'w', 'd', '*')
),
public_relations AS (
  SELECT c.oid
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
),
exact_fence_triggers AS (
  SELECT count(*)::bigint AS trigger_count
  FROM pg_catalog.pg_trigger AS t
  JOIN public_relations AS r ON r.oid = t.tgrelid
  WHERE t.tgname = 'trg_production_write_fence_20260717'
    AND NOT t.tgisinternal
    AND t.tgenabled = 'O'
    AND t.tgtype = 62
    AND t.tgfoid = pg_catalog.to_regprocedure(
      'public.production_write_fence_guard_20260717()'
    )
),
exact_guard_function AS (
  SELECT count(*)::bigint AS function_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'production_write_fence_guard_20260717'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    AND NOT p.prosecdef
    AND p.proconfig IS NOT DISTINCT FROM
      ARRAY['search_path=pg_catalog, auth']::text[]
    AND pg_catalog.md5(p.prosrc) = 'e9dc644c0ad98b742bde0e3c83c26f93'
),
exact_attach_function AS (
  SELECT count(*)::bigint AS function_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'production_write_fence_attach_20260717'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    AND NOT p.prosecdef
    AND p.proconfig IS NOT DISTINCT FROM
      ARRAY['search_path=pg_catalog, public']::text[]
    AND pg_catalog.md5(p.prosrc) = '9053c6d394854777b878bd219203b06a'
    AND NOT pg_catalog.has_function_privilege(
      'anon', p.oid, 'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated', p.oid, 'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'service_role', p.oid, 'EXECUTE'
    )
),
exact_live_schema_contract_function AS (
  SELECT count(*)::bigint AS function_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND p.proname = 'production_live_schema_contract_20260717'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    AND p.prokind = 'f'
    AND NOT p.prosecdef
    AND p.provolatile = 's'
    AND p.proparallel = 'u'
    AND NOT p.proisstrict
    AND NOT p.proleakproof
    AND l.lanname = 'sql'
    AND pg_catalog.pg_get_function_result(p.oid) = 'text'
    AND p.proconfig IS NOT DISTINCT FROM
      ARRAY['search_path=pg_catalog']::text[]
    AND pg_catalog.md5(p.prosrc) = '96ee93c897faa81bae68c8c65e29610b'
    AND NOT pg_catalog.has_function_privilege(
      'anon', p.oid, 'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated', p.oid, 'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'service_role', p.oid, 'EXECUTE'
    )
),
exact_event_triggers AS (
  SELECT
    count(*) FILTER (
      WHERE e.evtname = 'evt_production_write_fence_20260717'
        AND e.evtevent = 'ddl_command_end'
        AND e.evtenabled = 'O'
        AND e.evttags IS NULL
        AND pg_catalog.pg_get_userbyid(e.evtowner) = 'postgres'
    )::bigint AS exact_end_count,
    count(*) FILTER (
      WHERE e.evtname = 'evt_production_write_fence_ddl_lock_20260717'
        AND e.evtevent = 'ddl_command_start'
        AND e.evtenabled = 'O'
        AND e.evttags IS NULL
        AND pg_catalog.pg_get_userbyid(e.evtowner) = 'postgres'
    )::bigint AS exact_start_count,
    count(*)::bigint AS total_attach_event_trigger_count
  FROM pg_catalog.pg_event_trigger AS e
  WHERE e.evtfoid = pg_catalog.to_regprocedure(
      'public.production_write_fence_attach_20260717()'
    )
)
SELECT
  pg_catalog.statement_timestamp()::text AS observed_at,
  CASE
    WHEN inventory.object_count BETWEEN 0 AND 1000000000
      THEN inventory.object_count::integer
    ELSE NULL
  END AS total_object_count,
  upper(inventory.object_inventory_sha256) AS object_inventory_sha256,
  CASE
    WHEN mutation_policies.policy_count BETWEEN 0 AND 1000000000
      THEN mutation_policies.policy_count::integer
    ELSE NULL
  END AS mutation_policy_count,
  CASE
    WHEN (SELECT count(*) FROM public_relations) BETWEEN 1 AND 1000000
      THEN (SELECT count(*) FROM public_relations)::integer
    ELSE NULL
  END AS public_table_count,
  CASE
    WHEN exact_fence_triggers.trigger_count BETWEEN 0 AND 1000000
      THEN exact_fence_triggers.trigger_count::integer
    ELSE NULL
  END AS production_write_fence_trigger_count,
  exact_guard_function.function_count::integer AS production_write_fence_guard_function_count,
  exact_attach_function.function_count::integer AS production_write_fence_attach_function_count,
  exact_live_schema_contract_function.function_count::integer
    AS production_live_schema_contract_function_count,
  CASE
    WHEN exact_event_triggers.exact_end_count = 1
      AND exact_event_triggers.exact_start_count = 1
      AND exact_event_triggers.total_attach_event_trigger_count = 2
      THEN 2
    ELSE -1
  END::integer AS production_write_fence_event_trigger_count
FROM inventory
CROSS JOIN mutation_policies
CROSS JOIN exact_fence_triggers
CROSS JOIN exact_guard_function
CROSS JOIN exact_attach_function
CROSS JOIN exact_live_schema_contract_function
CROSS JOIN exact_event_triggers
`.trim();

export class StorageDrainEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "StorageDrainEvidenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new StorageDrainEvidenceError(code);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function hasExactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

async function boundedResponseJson(response, code) {
  let text;
  try {
    text = await response.text();
  } catch {
    fail(code);
  }
  if (text.length < 2 || text.length > MAX_JSON_BYTES) fail(code);
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
}

function validateSiteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("STORAGE_DRAIN_SITE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password
      || (url.pathname !== "/" && url.pathname !== "")
      || url.search || url.hash) {
    fail("STORAGE_DRAIN_SITE_URL_INVALID");
  }
  return url;
}

async function readBoundedJson(path, code) {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()
      || metadata.size < 2 || metadata.size > MAX_JSON_BYTES) {
    fail(code);
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(code);
  }
}

async function rawFileSha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
}

function stagePaths(receiptDirectory, finalFileName) {
  const stem = finalFileName.slice(0, -".json".length);
  return {
    start: join(receiptDirectory, `${stem}.start.json`),
    first: join(receiptDirectory, `${stem}.snapshot-1.json`),
    final: join(receiptDirectory, finalFileName),
  };
}

export function getStorageDrainReceiptPaths(receiptDirectory, finalFileName) {
  if (!isAbsolute(receiptDirectory) || !SAFE_RECEIPT.test(finalFileName ?? "")) {
    fail("STORAGE_DRAIN_ARGUMENT_INVALID");
  }
  return stagePaths(resolve(receiptDirectory), finalFileName);
}

function validateManifest(manifest) {
  const evidence = manifest?.manualControlEvidence;
  const storageFreezeOperations = Array.isArray(manifest?.manualPlatformOperations)
    ? manifest.manualPlatformOperations.filter((entry) =>
      entry?.id === PREDECESSOR_STORAGE_FREEZE_OPERATION_ID
      || (entry?.phase === "pre-backup"
        && /^vendor-disclosure-successor-storage-(?:write-)?freeze-[a-z0-9-]+$/u
          .test(entry?.id ?? "")))
    : [];
  const operation = storageFreezeOperations.length === 1
    ? storageFreezeOperations[0]
    : null;
  if (!PROJECT_REF.test(manifest?.projectRef ?? "")
      || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(manifest?.release ?? "")
      || !SAFE_RECEIPT.test(evidence?.storageDrainReceiptFileName ?? "")
      || evidence?.maximumAgeMinutes !== 30
      || evidence?.signedUploadTokenTtlMinutes !== 120
      || evidence?.signedUploadGraceMinutes !== 10
      || evidence?.storageStabilityWindowMinutes !== 5
      || operation?.phase !== "pre-backup"
      || !/^[a-z][a-z0-9-]{2,63}$/.test(operation?.verificationCheckId ?? "")
      || !LOWER_SHA256.test(operation?.sha256 ?? "")) {
    fail("STORAGE_DRAIN_MANIFEST_INVALID");
  }
  return { evidence, operation };
}

function validateOperation(value, expected) {
  return hasExactKeys(value, [
    "applyArtifactSha256",
    "operationId",
    "verificationCheckId",
  ])
    && value.operationId === expected.id
    && value.verificationCheckId === expected.verificationCheckId
    && value.applyArtifactSha256 === expected.sha256;
}

function validateObservation(row, now) {
  if (!hasExactKeys(row, [
    "mutation_policy_count",
    "object_inventory_sha256",
    "observed_at",
    "production_write_fence_attach_function_count",
    "production_write_fence_event_trigger_count",
    "production_write_fence_guard_function_count",
    "production_live_schema_contract_function_count",
    "production_write_fence_trigger_count",
    "public_table_count",
    "total_object_count",
  ])) {
    fail("STORAGE_DRAIN_QUERY_RESULT_INVALID");
  }
  const observedAtMs = Date.parse(row.observed_at ?? "");
  const nowMs = now().getTime();
  if (!Number.isFinite(observedAtMs)
      || observedAtMs > nowMs + 5 * 60_000
      || nowMs - observedAtMs > 5 * 60_000
      || !Number.isSafeInteger(row.total_object_count)
      || row.total_object_count < 0
      || row.total_object_count > 1_000_000_000
      || !UPPER_SHA256.test(row.object_inventory_sha256 ?? "")
      || row.mutation_policy_count !== 0
      || !Number.isSafeInteger(row.public_table_count)
      || row.public_table_count < 1
      || row.public_table_count > 1_000_000
      || row.production_write_fence_trigger_count !== row.public_table_count
      || row.production_write_fence_guard_function_count !== 1
      || row.production_write_fence_attach_function_count !== 1
      || row.production_live_schema_contract_function_count !== 1
      || row.production_write_fence_event_trigger_count !== 2) {
    fail("STORAGE_DRAIN_QUERY_RESULT_INVALID");
  }
  return {
    observedAt: new Date(observedAtMs).toISOString(),
    totalObjectCount: row.total_object_count,
    objectInventorySha256: row.object_inventory_sha256,
    mutationPolicyCount: row.mutation_policy_count,
    databaseWriteFence: {
      publicTableCount: row.public_table_count,
      triggerCount: row.production_write_fence_trigger_count,
      guardFunctionCount: row.production_write_fence_guard_function_count,
      attachFunctionCount: row.production_write_fence_attach_function_count,
      liveSchemaContractFunctionCount:
        row.production_live_schema_contract_function_count,
      eventTriggerCount: row.production_write_fence_event_trigger_count,
    },
  };
}

async function queryObservation({ projectRef, token, fetchImpl, now }) {
  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: STORAGE_INVENTORY_READ_ONLY_SQL, parameters: [] }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    fail("STORAGE_DRAIN_QUERY_FAILED");
  }
  const body = await boundedResponseJson(response, "STORAGE_DRAIN_QUERY_FAILED");
  if (response.status !== 201 || !Array.isArray(body) || body.length !== 1) {
    fail("STORAGE_DRAIN_QUERY_FAILED");
  }
  return validateObservation(body[0], now);
}

async function queryGlobalControls({ projectRef, token, productionUrl, expectedCommit, fetchImpl }) {
  let authResponse;
  let webResponse;
  try {
    [authResponse, webResponse] = await Promise.all([
      fetchImpl(
        `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      ),
      fetchImpl(
        new URL("/api/release/write-fence-probe", productionUrl),
        {
          method: "POST",
          headers: { Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      ),
    ]);
  } catch {
    fail("STORAGE_DRAIN_GLOBAL_CONTROLS_NOT_VERIFIED");
  }
  const [authConfig, webBody] = await Promise.all([
    boundedResponseJson(authResponse, "STORAGE_DRAIN_GLOBAL_CONTROLS_NOT_VERIFIED"),
    boundedResponseJson(webResponse, "STORAGE_DRAIN_GLOBAL_CONTROLS_NOT_VERIFIED"),
  ]);
  if (authResponse.status !== 200
      || authConfig.disable_signup !== true
      || webResponse.status !== 503
      || webBody.error !== "production_write_fence_enabled"
      || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(
        webResponse.headers.get("cache-control") ?? "",
      )
      || webResponse.headers.get("x-hanbang-deployment-commit") !== expectedCommit) {
    fail("STORAGE_DRAIN_GLOBAL_CONTROLS_NOT_VERIFIED");
  }
  return {
    vercelProductionWriteFenceEnabled: true,
    vercelDeploymentCommit: expectedCommit,
    supabaseAuthSignupDisabled: true,
  };
}

function validateControls(value, expectedCommit) {
  return hasExactKeys(value, [
    "supabaseAuthSignupDisabled",
    "vercelDeploymentCommit",
    "vercelProductionWriteFenceEnabled",
  ])
    && value.supabaseAuthSignupDisabled === true
    && value.vercelDeploymentCommit === expectedCommit
    && value.vercelProductionWriteFenceEnabled === true;
}

function validateDatabaseWriteFence(value) {
  return hasExactKeys(value, [
    "attachFunctionCount",
    "eventTriggerCount",
    "guardFunctionCount",
    "liveSchemaContractFunctionCount",
    "publicTableCount",
    "triggerCount",
  ])
    && Number.isSafeInteger(value.publicTableCount)
    && value.publicTableCount >= 1
    && value.publicTableCount <= 1_000_000
    && value.triggerCount === value.publicTableCount
    && value.guardFunctionCount === 1
    && value.attachFunctionCount === 1
    && value.liveSchemaContractFunctionCount === 1
    && value.eventTriggerCount === 2;
}

function validateStartReceipt(receipt, { manifest, expectedCommit, operation }) {
  return hasExactKeys(receipt, [
    "containsSensitiveValues",
    "databaseWriteFence",
    "controls",
    "mutationPolicyCount",
    "objectInventorySha256",
    "observedAt",
    "operation",
    "projectRef",
    "receiptVersion",
    "release",
    "releaseCommit",
    "stage",
    "totalObjectCount",
  ])
    && receipt.receiptVersion === 1
    && receipt.stage === "freeze-start"
    && receipt.release === manifest.release
    && receipt.projectRef === manifest.projectRef
    && receipt.releaseCommit === expectedCommit
    && receipt.containsSensitiveValues === false
    && validateControls(receipt.controls, expectedCommit)
    && validateDatabaseWriteFence(receipt.databaseWriteFence)
    && receipt.mutationPolicyCount === 0
    && Number.isSafeInteger(receipt.totalObjectCount)
    && receipt.totalObjectCount >= 0
    && receipt.totalObjectCount <= 1_000_000_000
    && UPPER_SHA256.test(receipt.objectInventorySha256 ?? "")
    && Number.isFinite(Date.parse(receipt.observedAt ?? ""))
    && validateOperation(receipt.operation, operation);
}

function validateFirstReceipt(receipt, context, startSha256) {
  return hasExactKeys(receipt, [
    "containsSensitiveValues",
    "databaseWriteFence",
    "mutationPolicyCount",
    "objectInventorySha256",
    "observedAt",
    "operation",
    "projectRef",
    "receiptVersion",
    "release",
    "releaseCommit",
    "stage",
    "startReceiptSha256",
    "totalObjectCount",
  ])
    && receipt.receiptVersion === 1
    && receipt.stage === "stable-snapshot-1"
    && receipt.release === context.manifest.release
    && receipt.projectRef === context.manifest.projectRef
    && receipt.releaseCommit === context.expectedCommit
    && receipt.startReceiptSha256 === startSha256
    && receipt.containsSensitiveValues === false
    && validateDatabaseWriteFence(receipt.databaseWriteFence)
    && receipt.mutationPolicyCount === 0
    && Number.isSafeInteger(receipt.totalObjectCount)
    && receipt.totalObjectCount >= 0
    && receipt.totalObjectCount <= 1_000_000_000
    && UPPER_SHA256.test(receipt.objectInventorySha256 ?? "")
    && Number.isFinite(Date.parse(receipt.observedAt ?? ""))
    && validateOperation(receipt.operation, context.operation);
}

function validateFinalReceipt(receipt, context, startReceipt, firstReceipt, hashes) {
  const { manifest, expectedCommit, operation, evidence } = context;
  return hasExactKeys(receipt, [
    "containsSensitiveValues",
    "firstSnapshotReceiptSha256",
    "firstStableSnapshotAt",
    "freezeVerifiedAt",
    "mutationPolicyCount",
    "objectInventorySha256",
    "operation",
    "projectRef",
    "receiptVersion",
    "release",
    "releaseCommit",
    "secondStableSnapshotAt",
    "signedUploadGraceMinutes",
    "signedUploadTokenTtlMinutes",
    "stage",
    "startReceiptSha256",
    "storageStabilityWindowMinutes",
    "totalObjectCount",
  ])
    && receipt.receiptVersion === 1
    && receipt.stage === "verified"
    && receipt.release === manifest.release
    && receipt.projectRef === manifest.projectRef
    && receipt.releaseCommit === expectedCommit
    && receipt.startReceiptSha256 === hashes.start
    && receipt.firstSnapshotReceiptSha256 === hashes.first
    && receipt.freezeVerifiedAt === startReceipt.observedAt
    && receipt.firstStableSnapshotAt === firstReceipt.observedAt
    && receipt.signedUploadTokenTtlMinutes === evidence.signedUploadTokenTtlMinutes
    && receipt.signedUploadGraceMinutes === evidence.signedUploadGraceMinutes
    && receipt.storageStabilityWindowMinutes === evidence.storageStabilityWindowMinutes
    && receipt.totalObjectCount === firstReceipt.totalObjectCount
    && receipt.objectInventorySha256 === firstReceipt.objectInventorySha256
    && receipt.mutationPolicyCount === 0
    && receipt.containsSensitiveValues === false
    && Number.isFinite(Date.parse(receipt.secondStableSnapshotAt ?? ""))
    && validateOperation(receipt.operation, operation);
}

export async function validateCompletedStorageDrainEvidence({
  repoRoot,
  receiptDirectory,
  manifest,
  expectedCommit,
  now = () => new Date(),
  backupSourceCapturedAt,
  backupCreatedAt,
  enforceFreshness = true,
}) {
  const absoluteRepoRoot = resolve(repoRoot);
  const directoryMetadata = isAbsolute(receiptDirectory)
    ? await lstat(receiptDirectory).catch(() => null)
    : null;
  const canonicalDirectory = directoryMetadata?.isDirectory() && !directoryMetadata.isSymbolicLink()
    ? await realpath(receiptDirectory).catch(() => null)
    : null;
  if (!canonicalDirectory
      || inside(absoluteRepoRoot, canonicalDirectory)
      || !COMMIT.test(expectedCommit ?? "")) {
    fail("STORAGE_DRAIN_EVIDENCE_INVALID");
  }
  const { evidence, operation } = validateManifest(manifest);
  const paths = stagePaths(canonicalDirectory, evidence.storageDrainReceiptFileName);
  const [startReceipt, firstReceipt, finalReceipt] = await Promise.all([
    readBoundedJson(paths.start, "STORAGE_DRAIN_EVIDENCE_INVALID"),
    readBoundedJson(paths.first, "STORAGE_DRAIN_EVIDENCE_INVALID"),
    readBoundedJson(paths.final, "STORAGE_DRAIN_EVIDENCE_INVALID"),
  ]);
  const hashes = {
    start: await rawFileSha256(paths.start),
    first: await rawFileSha256(paths.first),
    final: await rawFileSha256(paths.final),
  };
  const context = { manifest, expectedCommit, operation, evidence };
  if (!validateStartReceipt(startReceipt, context)
      || !validateFirstReceipt(firstReceipt, context, hashes.start)
      || !validateFinalReceipt(finalReceipt, context, startReceipt, firstReceipt, hashes)) {
    fail("STORAGE_DRAIN_EVIDENCE_INVALID");
  }
  const freezeMs = Date.parse(startReceipt.observedAt);
  const firstMs = Date.parse(firstReceipt.observedAt);
  const secondMs = Date.parse(finalReceipt.secondStableSnapshotAt);
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number.NaN;
  const minimumDrainMs = (
    evidence.signedUploadTokenTtlMinutes + evidence.signedUploadGraceMinutes
  ) * 60_000;
  const minimumStabilityMs = evidence.storageStabilityWindowMinutes * 60_000;
  const maximumAgeMs = evidence.maximumAgeMinutes * 60_000;
  if (!Number.isFinite(nowMs)
      || firstMs - freezeMs < minimumDrainMs
      || secondMs - firstMs < minimumStabilityMs
      || secondMs > nowMs + 5 * 60_000
      || (enforceFreshness && nowMs - secondMs > maximumAgeMs)) {
    fail("STORAGE_DRAIN_EVIDENCE_INVALID");
  }
  if (backupSourceCapturedAt !== undefined || backupCreatedAt !== undefined) {
    const sourceMs = Date.parse(backupSourceCapturedAt ?? "");
    const createdMs = Date.parse(backupCreatedAt ?? "");
    if (!Number.isFinite(sourceMs)
        || !Number.isFinite(createdMs)
        || sourceMs < secondMs
        || createdMs < sourceMs) {
      fail("STORAGE_DRAIN_BACKUP_ORDER_INVALID");
    }
  }
  return {
    sha256: hashes.final,
    startReceiptSha256: hashes.start,
    freezeVerifiedAt: startReceipt.observedAt,
    controls: startReceipt.controls,
    databaseWriteFence: startReceipt.databaseWriteFence,
    firstStableSnapshotAt: firstReceipt.observedAt,
    secondStableSnapshotAt: finalReceipt.secondStableSnapshotAt,
    totalObjectCount: finalReceipt.totalObjectCount,
    objectInventorySha256: finalReceipt.objectInventorySha256,
    mutationPolicyCount: finalReceipt.mutationPolicyCount,
  };
}

async function writeExclusiveJson(path, value) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    const [handleStat, pathStat] = await Promise.all([handle.stat(), lstat(path)]);
    if (!handleStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
        || handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino
        || (process.platform !== "win32" && (handleStat.mode & 0o077) !== 0)) {
      fail("STORAGE_DRAIN_OUTPUT_FAILED");
    }
    await handle.close();
    handle = null;
    if (process.platform !== "win32") {
      const parent = await open(dirname(path), "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
  } catch {
    await handle?.close().catch(() => {});
    await unlink(path).catch(() => {});
    fail("STORAGE_DRAIN_OUTPUT_FAILED");
  }
}

export async function captureStorageSignedUploadDrainEvidence({
  repoRoot,
  expectedCommit,
  receiptDirectory,
  stage,
  siteUrl,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  releaseManifest,
}) {
  const absoluteRepoRoot = resolve(repoRoot);
  if (!COMMIT.test(expectedCommit ?? "")
      || !isAbsolute(receiptDirectory)
      || !["start", "first", "final"].includes(stage)
      || typeof fetchImpl !== "function"
      || (stage === "start" && typeof siteUrl !== "string")) {
    fail("STORAGE_DRAIN_ARGUMENT_INVALID");
  }
  const directoryMetadata = await lstat(receiptDirectory).catch(() => null);
  const canonicalDirectory = directoryMetadata?.isDirectory() && !directoryMetadata.isSymbolicLink()
    ? await realpath(receiptDirectory).catch(() => null)
    : null;
  if (!canonicalDirectory || inside(absoluteRepoRoot, canonicalDirectory)) {
    fail("STORAGE_DRAIN_ARGUMENT_INVALID");
  }
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (typeof token !== "string" || token.length < 20) {
    fail("STORAGE_DRAIN_AUTH_TOKEN_REQUIRED");
  }
  const manifest = releaseManifest ?? await readBoundedJson(
    resolve(absoluteRepoRoot, MANIFEST_PATH),
    "STORAGE_DRAIN_MANIFEST_INVALID",
  );
  const { evidence, operation } = validateManifest(manifest);
  const paths = stagePaths(canonicalDirectory, evidence.storageDrainReceiptFileName);
  const operationBinding = {
    operationId: operation.id,
    verificationCheckId: operation.verificationCheckId,
    applyArtifactSha256: operation.sha256,
  };
  const context = { manifest, expectedCommit, operation };

  if (stage === "start") {
    const productionUrl = validateSiteUrl(siteUrl);
    const [observation, controls] = await Promise.all([
      queryObservation({
        projectRef: manifest.projectRef,
        token,
        fetchImpl,
        now,
      }),
      queryGlobalControls({
        projectRef: manifest.projectRef,
        token,
        productionUrl,
        expectedCommit,
        fetchImpl,
      }),
    ]);
    const receipt = {
      receiptVersion: 1,
      stage: "freeze-start",
      release: manifest.release,
      projectRef: manifest.projectRef,
      releaseCommit: expectedCommit,
      operation: operationBinding,
      ...observation,
      controls,
      containsSensitiveValues: false,
    };
    await writeExclusiveJson(paths.start, receipt);
    return { status: "waiting_signed_upload_expiry", nextStage: "first", ...receipt };
  }

  const startReceipt = await readBoundedJson(paths.start, "STORAGE_DRAIN_START_INVALID");
  const startSha256 = await rawFileSha256(paths.start);
  if (!validateStartReceipt(startReceipt, context)) {
    fail("STORAGE_DRAIN_START_INVALID");
  }

  if (stage === "first") {
    const observation = await queryObservation({
      projectRef: manifest.projectRef,
      token,
      fetchImpl,
      now,
    });
    const minimumDrainMs = (
      evidence.signedUploadTokenTtlMinutes + evidence.signedUploadGraceMinutes
    ) * 60_000;
    if (Date.parse(observation.observedAt) - Date.parse(startReceipt.observedAt) < minimumDrainMs) {
      fail("STORAGE_DRAIN_WAIT_INCOMPLETE");
    }
    const receipt = {
      receiptVersion: 1,
      stage: "stable-snapshot-1",
      release: manifest.release,
      projectRef: manifest.projectRef,
      releaseCommit: expectedCommit,
      operation: operationBinding,
      startReceiptSha256: startSha256,
      ...observation,
      containsSensitiveValues: false,
    };
    await writeExclusiveJson(paths.first, receipt);
    return { status: "waiting_inventory_stability", nextStage: "final", ...receipt };
  }

  const firstReceipt = await readBoundedJson(paths.first, "STORAGE_DRAIN_FIRST_INVALID");
  const firstSha256 = await rawFileSha256(paths.first);
  if (!validateFirstReceipt(firstReceipt, context, startSha256)) {
    fail("STORAGE_DRAIN_FIRST_INVALID");
  }
  const observation = await queryObservation({
    projectRef: manifest.projectRef,
    token,
    fetchImpl,
    now,
  });
  const stabilityMs = evidence.storageStabilityWindowMinutes * 60_000;
  if (Date.parse(observation.observedAt) - Date.parse(firstReceipt.observedAt) < stabilityMs) {
    fail("STORAGE_DRAIN_STABILITY_WAIT_INCOMPLETE");
  }
  if (observation.totalObjectCount !== firstReceipt.totalObjectCount
      || observation.objectInventorySha256 !== firstReceipt.objectInventorySha256) {
    fail("STORAGE_DRAIN_INVENTORY_CHANGED");
  }
  const finalReceipt = {
    receiptVersion: 1,
    stage: "verified",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    operation: operationBinding,
    startReceiptSha256: startSha256,
    firstSnapshotReceiptSha256: firstSha256,
    freezeVerifiedAt: startReceipt.observedAt,
    firstStableSnapshotAt: firstReceipt.observedAt,
    secondStableSnapshotAt: observation.observedAt,
    signedUploadTokenTtlMinutes: evidence.signedUploadTokenTtlMinutes,
    signedUploadGraceMinutes: evidence.signedUploadGraceMinutes,
    storageStabilityWindowMinutes: evidence.storageStabilityWindowMinutes,
    totalObjectCount: observation.totalObjectCount,
    objectInventorySha256: observation.objectInventorySha256,
    mutationPolicyCount: observation.mutationPolicyCount,
    containsSensitiveValues: false,
  };
  await writeExclusiveJson(paths.final, finalReceipt);
  return { status: "storage_signed_upload_drain_verified", ...finalReceipt };
}
