import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const PROJECT_REF = /^[a-z0-9]{20}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const RUN_NONCE = /^[a-f0-9]{32}$/u;
const POLICY_EXPRESSION_SHA256 =
  "7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482";
const PRODUCTION_STORAGE_FENCE_SOURCE_SHA256 =
  "2d68394af998108f9f35441e53d3ec1dfcde0f5f450e736aa78bd55efae50316";
const MAX_RESPONSE_BYTES = 256 * 1024;

const UNSIGNED_BUCKETS = Object.freeze([
  "community-media-staging",
  "community-images",
  "community-videos",
]);
const ALL_PROBE_BUCKETS = new Set([...UNSIGNED_BUCKETS, "chat-image"]);
const ACTORS = Object.freeze(["anon", "authenticated"]);

export const STORAGE_STAGING_INVENTORY_SQL = `
WITH expected_buckets(id, is_public, file_size_limit, allowed_mime_types) AS (
  VALUES
    ('chat-image'::text, false, NULL::bigint, NULL::text[]),
    ('cohort-images', true, NULL::bigint, NULL::text[]),
    ('community-images', true, 10 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[]),
    ('community-videos', true, 50 * 1024 * 1024,
      ARRAY['video/mp4','video/quicktime','video/webm']::text[]),
    ('community-media-staging', false, 6 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/gif','image/webp']::text[]),
    ('guestbook-images', false, NULL::bigint, NULL::text[]),
    ('guestbook-uploads', false, 5 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]),
    ('invitation-photos', true, 10 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/webp','image/heic']::text[]),
    ('user_photos', true, NULL::bigint, NULL::text[]),
    ('vendor-images', true, 5 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','image/webp']::text[]),
    ('vendor-licenses', false, 10 * 1024 * 1024,
      ARRAY['image/jpeg','image/png','application/pdf']::text[])
), relation_contract AS (
  SELECT
    pg_catalog.pg_get_userbyid(c.relowner) AS relation_owner,
    c.relrowsecurity AS relation_rls_enabled,
    c.relforcerowsecurity AS relation_force_rls
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND pg_catalog.pg_get_userbyid(c.relowner) = 'supabase_storage_admin'
), actual_buckets AS (
  SELECT id, name, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
), bucket_contract AS (
  SELECT
    (SELECT count(*)::integer FROM actual_buckets) AS storage_bucket_count,
    (SELECT count(*)::integer FROM actual_buckets
      WHERE id IN ('guestbook-images', 'guestbook-uploads') AND public = false)
      AS retired_guestbook_private_bucket_count,
    NOT EXISTS (
      (SELECT id, id AS name, is_public AS public, file_size_limit, allowed_mime_types
         FROM expected_buckets
       EXCEPT ALL
       SELECT id, name, public, file_size_limit, allowed_mime_types
         FROM actual_buckets)
      UNION ALL
      (SELECT id, name, public, file_size_limit, allowed_mime_types
         FROM actual_buckets
       EXCEPT ALL
       SELECT id, id AS name, is_public AS public, file_size_limit, allowed_mime_types
         FROM expected_buckets)
    ) AS bucket_contract_verified,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE((
      SELECT pg_catalog.string_agg(
        bucket.id || E'\\n' || bucket.name || E'\\n' || bucket.public::text || E'\\n'
          || COALESCE(bucket.file_size_limit::text, '<null>') || E'\\n'
          || COALESCE(bucket.allowed_mime_types::text, '<null>'),
        E'\\n---\\n' ORDER BY bucket.id
      )
      FROM actual_buckets AS bucket
    ), ''), 'UTF8'), 'sha256'), 'hex') AS bucket_contract_sha256
), actual_policies AS (
  SELECT
    policy.permissive::text AS permissive,
    policy.roles,
    policy.cmd::text AS cmd,
    pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
      COALESCE(policy.qual, '') || E'\\n' || COALESCE(policy.with_check, ''),
      E'\\s+', '', 'g'
    )), 'sha256'), 'hex') AS expression_sha256
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
), policy_contract AS (
  SELECT
    count(*)::integer AS storage_policy_count,
    count(*) FILTER (WHERE cmd = 'INSERT')::integer AS storage_insert_policy_count,
    count(*) = 1 AND count(*) FILTER (
      WHERE permissive = 'PERMISSIVE'
        AND roles = ARRAY['authenticated']::name[]
        AND cmd = 'INSERT'
        AND expression_sha256 = '${POLICY_EXPRESSION_SHA256}'
    ) = 1 AS storage_policy_contract_verified,
    max(expression_sha256) AS storage_policy_expression_sha256
  FROM actual_policies
), production_fence_function AS (
  SELECT
    count(*) = 1
      AND pg_catalog.bool_and(
        function_record.prokind = 'f'
        AND function_record.prosecdef
        AND function_record.provolatile = 's'
        AND pg_catalog.pg_get_userbyid(function_record.proowner) = 'postgres'
        AND function_record.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
        AND pg_catalog.has_function_privilege(
          'authenticated', function_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege('anon', function_record.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(
          'service_role', function_record.oid, 'EXECUTE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(COALESCE(
            function_record.proacl,
            pg_catalog.acldefault('f', function_record.proowner)
          )) AS acl_entry
          WHERE acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'
        )
        AND pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
          function_record.prosrc, E'\\s+', '', 'g'
        )), 'sha256'), 'hex') = '${PRODUCTION_STORAGE_FENCE_SOURCE_SHA256}'
      ) AS production_storage_fence_function_verified
  FROM pg_catalog.pg_proc AS function_record
  WHERE function_record.oid = pg_catalog.to_regprocedure(
    'public.production_storage_writes_allowed()'
  )
), production_fence_state AS (
  SELECT NOT (
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgname = 'trg_production_write_fence_20260717'
        AND NOT trigger_record.tgisinternal
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_event_trigger AS event_trigger_record
      WHERE event_trigger_record.evtname = 'evt_production_write_fence_20260717'
    )
    OR pg_catalog.to_regprocedure(
      'public.production_write_fence_guard_20260717()'
    ) IS NOT NULL
    OR pg_catalog.to_regprocedure(
      'public.production_write_fence_attach_20260717()'
    ) IS NOT NULL
  ) AS production_storage_writes_allowed
), object_rows AS (
  SELECT
    object.bucket_id,
    object.name,
    COALESCE(object.id::text, '') AS object_id,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(pg_catalog.to_jsonb(object)::text, 'UTF8'),
      'sha256'
    ), 'hex') AS row_sha256
  FROM storage.objects AS object
), object_inventory AS (
  SELECT
    count(*)::integer AS total_object_count,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(COALESCE(
      pg_catalog.string_agg(row_sha256, '' ORDER BY bucket_id, name, object_id),
      ''
    ), 'UTF8'), 'sha256'), 'hex') AS object_inventory_sha256
  FROM object_rows
), probe_ids AS (
  SELECT $2::uuid AS user_id, $3::uuid AS couple_id
), nonce_users AS (
  SELECT account.id
  FROM auth.users AS account
  WHERE pg_catalog.strpos(COALESCE(account.email, ''), $1::text) > 0
     OR pg_catalog.strpos(COALESCE(account.raw_user_meta_data::text, ''), $1::text) > 0
), probe_users AS (
  SELECT id FROM nonce_users
  UNION
  SELECT account.id
  FROM auth.users AS account
  CROSS JOIN probe_ids
  WHERE probe_ids.user_id IS NOT NULL
    AND account.id = probe_ids.user_id
), nonce_residue AS (
  SELECT
    (SELECT count(*)::integer FROM probe_users) AS exact_nonce_auth_user_count,
    (SELECT count(*)::integer FROM public.profiles AS profile
      WHERE profile.id = (SELECT user_id FROM probe_ids)
         OR profile.id IN (SELECT id FROM probe_users)) AS exact_nonce_profile_count,
    (SELECT count(*)::integer FROM public.couples AS couple
      WHERE couple.id = (SELECT couple_id FROM probe_ids)
         OR couple.bride_id = (SELECT user_id FROM probe_ids)
         OR couple.groom_id = (SELECT user_id FROM probe_ids)
         OR couple.bride_id IN (SELECT id FROM probe_users)
         OR couple.groom_id IN (SELECT id FROM probe_users)) AS exact_nonce_couple_count,
    (SELECT count(*)::integer FROM storage.objects AS object
      WHERE pg_catalog.strpos(object.name, $1::text) > 0)
      AS exact_nonce_storage_object_count
)
SELECT
  pg_catalog.statement_timestamp()::text AS observed_at,
  relation_contract.relation_owner,
  relation_contract.relation_rls_enabled,
  relation_contract.relation_force_rls,
  bucket_contract.storage_bucket_count,
  bucket_contract.retired_guestbook_private_bucket_count,
  bucket_contract.bucket_contract_verified,
  bucket_contract.bucket_contract_sha256,
  policy_contract.storage_policy_count,
  policy_contract.storage_insert_policy_count,
  policy_contract.storage_policy_contract_verified,
  policy_contract.storage_policy_expression_sha256,
  production_fence_function.production_storage_fence_function_verified,
  production_fence_state.production_storage_writes_allowed,
  object_inventory.total_object_count,
  object_inventory.object_inventory_sha256,
  nonce_residue.exact_nonce_auth_user_count,
  nonce_residue.exact_nonce_profile_count,
  nonce_residue.exact_nonce_couple_count,
  nonce_residue.exact_nonce_storage_object_count
FROM relation_contract
CROSS JOIN bucket_contract
CROSS JOIN policy_contract
CROSS JOIN production_fence_function
CROSS JOIN production_fence_state
CROSS JOIN object_inventory
CROSS JOIN nonce_residue
`.trim();

export class AmoraSuccessorStorageStagingProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AmoraSuccessorStorageStagingProbeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AmoraSuccessorStorageStagingProbeError(code, message);
}

function isInside(parent, child) {
  const fromParent = relative(parent, child);
  return fromParent === "" || (!fromParent.startsWith(`..${sep}`)
    && fromParent !== ".." && !isAbsolute(fromParent));
}

function parseHostedUrl(value, code) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    fail(code, "Storage staging URL must be a canonical hosted Supabase origin");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port
      || url.pathname !== "/" || url.search || url.hash
      || !/^[a-z0-9]{20}\.supabase\.co$/u.test(url.hostname)) {
    fail(code, "Storage staging URL must be a canonical hosted Supabase origin");
  }
  return url;
}

export function validateAmoraSuccessorStorageStagingProbeConfig(input) {
  const projectRef = String(input?.projectRef ?? "").trim();
  const productionProjectRef = String(input?.productionProjectRef ?? "").trim();
  const approvedProjectRef = String(input?.approvedProjectRef ?? projectRef).trim();
  if (![projectRef, productionProjectRef, approvedProjectRef].every((value) => PROJECT_REF.test(value))) {
    fail("PROJECT_REF_INVALID", "Storage staging project refs must be exact 20-character refs");
  }
  if (projectRef === productionProjectRef) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "Storage upload cleanup probes are staging-only");
  }
  if (projectRef !== approvedProjectRef) {
    fail("STAGING_PROJECT_PIN_MISMATCH", "Storage probe target is not the approved staging project");
  }

  const projectUrl = parseHostedUrl(
    input?.projectUrl ?? input?.expectedUrl ?? `https://${projectRef}.supabase.co`,
    "STAGING_URL_INVALID",
  );
  const productionUrl = parseHostedUrl(
    input?.productionUrl ?? `https://${productionProjectRef}.supabase.co`,
    "PRODUCTION_URL_INVALID",
  );
  if (projectUrl.hostname !== `${projectRef}.supabase.co`
      || productionUrl.hostname !== `${productionProjectRef}.supabase.co`
      || projectUrl.origin === productionUrl.origin) {
    fail("PROJECT_HOST_MISMATCH", "Storage probe hosts do not match the pinned project refs");
  }

  const managementToken = String(input?.managementToken ?? "");
  const expectedCommit = String(input?.expectedCommit ?? "").trim();
  const repoRootRaw = String(input?.repoRoot ?? "");
  const receiptRaw = String(input?.receiptOut ?? "").trim();
  if (managementToken.length < 20 || /[\r\n]/u.test(managementToken)) {
    fail("MANAGEMENT_TOKEN_INVALID", "Storage inventory requires a bounded Management API token");
  }
  if (!COMMIT.test(expectedCommit)) {
    fail("COMMIT_INVALID", "Storage probe must bind a full lowercase commit SHA");
  }
  if (!isAbsolute(repoRootRaw) || !isAbsolute(receiptRaw)) {
    fail("RECEIPT_PATH_INVALID", "Repository and Storage receipt paths must be absolute");
  }
  const repoRoot = resolve(repoRootRaw);
  const receiptOut = resolve(receiptRaw);
  if (isInside(repoRoot, receiptOut)) {
    fail("RECEIPT_INSIDE_REPOSITORY", "Storage staging receipts must stay outside the repository");
  }

  return Object.freeze({
    repoRoot,
    projectRef,
    productionProjectRef,
    approvedProjectRef,
    projectUrl: projectUrl.origin,
    productionUrl: productionUrl.origin,
    managementToken,
    expectedCommit,
    receiptOut,
    expectedMigrationCount: input?.expectedMigrationCount,
    expectedMigrationHead: input?.expectedMigrationHead,
    gitOrigin: input?.gitOrigin,
  });
}

async function boundedBody(response, code) {
  let text;
  try {
    text = await response.text();
  } catch {
    fail(code, "Storage staging response could not be read");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    fail(code, "Storage staging response exceeded the bounded size");
  }
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    fail(code, "Storage staging response was not valid JSON");
  }
}

function normalizeInventoryRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    fail("STORAGE_INVENTORY_RESULT_INVALID", "Hosted Storage inventory returned no single canonical row");
  }
  const counters = [
    row.total_object_count,
    row.exact_nonce_auth_user_count,
    row.exact_nonce_profile_count,
    row.exact_nonce_couple_count,
    row.exact_nonce_storage_object_count,
  ];
  const contractMatches = row.relation_owner === "supabase_storage_admin"
    && row.relation_rls_enabled === true
    && row.relation_force_rls === false
    && row.storage_bucket_count === 11
    && row.retired_guestbook_private_bucket_count === 2
    && row.bucket_contract_verified === true
    && SHA256.test(row.bucket_contract_sha256 ?? "")
    && row.storage_policy_count === 1
    && row.storage_insert_policy_count === 1
    && row.storage_policy_contract_verified === true
    && row.storage_policy_expression_sha256 === POLICY_EXPRESSION_SHA256
    && row.production_storage_fence_function_verified === true
    && row.production_storage_writes_allowed === false
    && counters.every((value) => Number.isSafeInteger(value) && value >= 0)
    && SHA256.test(row.object_inventory_sha256 ?? "")
    && Number.isFinite(Date.parse(row.observed_at ?? ""))
    && row.exact_nonce_auth_user_count === 0
    && row.exact_nonce_profile_count === 0
    && row.exact_nonce_couple_count === 0
    && row.exact_nonce_storage_object_count === 0;
  if (!contractMatches) {
    fail("STORAGE_INVENTORY_CONTRACT_DRIFT", "Hosted Storage inventory drifted from the cumulative contract");
  }
  return Object.freeze({
    observedAt: new Date(Date.parse(row.observed_at)).toISOString(),
    relationOwner: row.relation_owner,
    relationRlsEnabled: row.relation_rls_enabled,
    relationForceRls: row.relation_force_rls,
    storageBucketCount: row.storage_bucket_count,
    retiredGuestbookPrivateBucketCount: row.retired_guestbook_private_bucket_count,
    bucketContractSha256: row.bucket_contract_sha256,
    storagePolicyCount: row.storage_policy_count,
    storageInsertPolicyCount: row.storage_insert_policy_count,
    storagePolicyExpressionSha256: row.storage_policy_expression_sha256,
    productionStorageFenceFunctionVerified:
      row.production_storage_fence_function_verified,
    productionStorageWritesAllowed: row.production_storage_writes_allowed,
    totalObjectCount: row.total_object_count,
    objectInventorySha256: row.object_inventory_sha256,
    exactNonceAuthUserCount: row.exact_nonce_auth_user_count,
    exactNonceProfileCount: row.exact_nonce_profile_count,
    exactNonceCoupleCount: row.exact_nonce_couple_count,
    exactNonceStorageObjectCount: row.exact_nonce_storage_object_count,
  });
}

export async function inspectAmoraSuccessorStorageInventory({
  projectRef,
  productionProjectRef,
  managementToken,
  runNonce,
  userId = null,
  coupleId = null,
  fetchImpl = globalThis.fetch,
}) {
  if (!PROJECT_REF.test(projectRef ?? "") || !PROJECT_REF.test(productionProjectRef ?? "")) {
    fail("PROJECT_REF_INVALID", "Storage inventory project refs were invalid");
  }
  if (projectRef === productionProjectRef) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "Storage inventory is staging-only");
  }
  if (typeof managementToken !== "string" || managementToken.length < 20
      || /[\r\n]/u.test(managementToken)
      || !RUN_NONCE.test(runNonce ?? "") || typeof fetchImpl !== "function") {
    fail("STORAGE_INVENTORY_ARGUMENT_INVALID", "Storage inventory inputs were invalid");
  }
  const hasExactIds = userId !== null || coupleId !== null;
  if (hasExactIds && (!UUID.test(userId ?? "") || !UUID.test(coupleId ?? ""))) {
    fail("STORAGE_INVENTORY_ARGUMENT_INVALID", "Exact synthetic residue IDs were invalid");
  }

  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: STORAGE_STAGING_INVENTORY_SQL,
          parameters: [runNonce, userId, coupleId],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    fail("STORAGE_INVENTORY_UNAVAILABLE", "Hosted Storage inventory request failed");
  }
  const body = await boundedBody(response, "STORAGE_INVENTORY_UNAVAILABLE");
  if (response.status !== 201) {
    fail("STORAGE_INVENTORY_UNAVAILABLE", "Hosted Storage inventory request was rejected");
  }
  if (!Array.isArray(body) || body.length !== 1) {
    fail("STORAGE_INVENTORY_RESULT_INVALID", "Hosted Storage inventory returned no single canonical row");
  }
  return normalizeInventoryRow(body[0]);
}

function encodeObjectPath(path) {
  if (typeof path !== "string" || path.length < 3 || path.length > 512
      || path.startsWith("/") || path.endsWith("/") || path.includes("\\")
      || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail("STORAGE_OBJECT_PATH_INVALID", "Storage probe object path was invalid");
  }
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function assertBucket(bucketId) {
  if (!ALL_PROBE_BUCKETS.has(bucketId)) {
    fail("STORAGE_BUCKET_INVALID", "Storage probe bucket was outside the bounded contract");
  }
}

function contentForBucket(bucketId) {
  if (bucketId === "community-videos") {
    return {
      bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 109, 112, 52, 50]),
      contentType: "video/mp4",
    };
  }
  return {
    bytes: Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      "base64",
    )),
    contentType: "image/png",
  };
}

function responseReturnedPath(body, objectPath) {
  if (Array.isArray(body)) {
    return body.some((entry) => entry?.name === objectPath
      || entry?.path === objectPath || entry?.fullPath?.endsWith(`/${objectPath}`));
  }
  return body?.path === objectPath || body?.fullPath?.endsWith(`/${objectPath}`)
    || body?.Key?.endsWith(`/${objectPath}`);
}

export function createSupabaseStorageStagingTransport({
  projectRef,
  productionProjectRef,
  anonKey,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
}) {
  if (!PROJECT_REF.test(projectRef ?? "") || !PROJECT_REF.test(productionProjectRef ?? "")
      || projectRef === productionProjectRef
      || typeof anonKey !== "string" || anonKey.length < 8 || /[\r\n]/u.test(anonKey)
      || typeof serviceRoleKey !== "string" || serviceRoleKey.length < 8
      || /[\r\n]/u.test(serviceRoleKey) || typeof fetchImpl !== "function") {
    fail("STORAGE_TRANSPORT_CONFIG_INVALID", "Storage staging transport configuration was invalid");
  }
  const origin = `https://${projectRef}.supabase.co`;
  const productionOrigin = `https://${productionProjectRef}.supabase.co`;
  const fixtures = new Map();

  async function request(path, {
    method = "GET",
    apiKey,
    bearer,
    body,
    contentType = "application/json",
    extraHeaders = {},
    code = "STORAGE_REQUEST_FAILED",
  } = {}) {
    let url;
    try {
      url = new URL(path, origin);
    } catch {
      fail("STORAGE_REQUEST_HOST_FORBIDDEN", "Storage request URL was invalid");
    }
    if (url.origin !== origin || url.origin === productionOrigin
        || url.username || url.password || url.protocol !== "https:") {
      fail("STORAGE_REQUEST_HOST_FORBIDDEN", "Storage request escaped the staging host");
    }
    const headers = {
      apikey: apiKey,
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
      ...extraHeaders,
    };
    let encodedBody = body;
    if (body !== undefined && !(body instanceof Uint8Array)) {
      headers["Content-Type"] = contentType;
      encodedBody = JSON.stringify(body);
    } else if (body instanceof Uint8Array) {
      headers["Content-Type"] = contentType;
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: encodedBody,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      fail(code, "Staging Storage request was unavailable");
    }
    const responseBody = method === "HEAD" ? null : await boundedBody(response, code);
    return Object.freeze({ status: response.status, ok: response.ok, body: responseBody });
  }

  const adminRequest = (path, options = {}) => request(path, {
    apiKey: serviceRoleKey,
    bearer: serviceRoleKey,
    ...options,
  });
  const userRequest = (user, path, options = {}) => {
    if (!UUID.test(user?.id ?? "") || typeof user?.accessToken !== "string"
        || user.accessToken.length < 8 || /[\r\n]/u.test(user.accessToken)) {
      fail("SYNTHETIC_USER_SESSION_INVALID", "Synthetic authenticated session was unavailable");
    }
    return request(path, { apiKey: anonKey, bearer: user.accessToken, ...options });
  };
  const anonRequest = (path, options = {}) => request(path, {
    apiKey: anonKey,
    bearer: anonKey,
    ...options,
  });

  function signedUrlFor({ bucketId, objectPath, token }) {
    assertBucket(bucketId);
    if (typeof token !== "string" || token.length < 3 || /[\r\n]/u.test(token)) {
      fail("SIGNED_UPLOAD_TOKEN_INVALID", "Signed upload token was invalid");
    }
    const url = new URL(
      `/storage/v1/object/upload/sign/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
      origin,
    );
    url.searchParams.set("token", token);
    return url;
  }

  function validateReturnedSignedUrl(value, bucketId, objectPath) {
    let url;
    try {
      const raw = String(value ?? "");
      url = raw.startsWith("/")
        ? new URL(raw.startsWith("/storage/v1/") ? raw : `/storage/v1${raw}`, origin)
        : new URL(raw, origin);
    } catch {
      fail("SIGNED_UPLOAD_URL_INVALID", "Signed upload URL was invalid");
    }
    if (url.origin !== origin || url.origin === productionOrigin || url.username || url.password
        || url.hash || [...url.searchParams.keys()].some((key) => key !== "token")
        || [...url.searchParams.keys()].length !== 1) {
      fail("SIGNED_UPLOAD_HOST_FORBIDDEN", "Signed upload URL escaped the staging project");
    }
    const expectedPath = signedUrlFor({
      bucketId,
      objectPath,
      token: url.searchParams.get("token") ?? "missing",
    }).pathname;
    if (url.pathname !== expectedPath || !url.searchParams.get("token")) {
      fail("SIGNED_UPLOAD_URL_INVALID", "Signed upload URL did not bind the exact object path");
    }
    return url;
  }

  async function removeObject(bucketId, objectPath) {
    const response = await adminRequest(`/storage/v1/object/${encodeURIComponent(bucketId)}`, {
      method: "DELETE",
      body: { prefixes: [objectPath] },
      code: "STORAGE_OBJECT_CLEANUP_FAILED",
    });
    return response.ok && responseReturnedPath(response.body, objectPath);
  }

  async function objectAbsent(bucketId, objectPath) {
    const response = await adminRequest(
      `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
      { method: "HEAD", code: "STORAGE_OBJECT_EXISTENCE_CHECK_FAILED" },
    );
    return response.status === 400 || response.status === 404;
  }

  return Object.freeze({
    async createSyntheticUser(label) {
      if (typeof label !== "string" || label.length < 16 || label.length > 160
          || /[\r\n]/u.test(label)) {
        fail("SYNTHETIC_USER_LABEL_INVALID", "Synthetic Storage label was invalid");
      }
      const email = `${label}-${randomBytes(6).toString("hex")}@hanbang-test.invalid`;
      const password = `${randomBytes(24).toString("base64url")}!Aa1`;
      const created = await adminRequest("/auth/v1/admin/users", {
        method: "POST",
        body: {
          email,
          password,
          email_confirm: true,
          user_metadata: { name: label },
        },
        code: "SYNTHETIC_USER_CREATE_FAILED",
      });
      const id = created.body?.id ?? created.body?.user?.id;
      if (!created.ok || !UUID.test(id ?? "")) {
        fail("SYNTHETIC_USER_CREATE_FAILED", "Synthetic Storage user could not be created");
      }
      try {
        const session = await anonRequest("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: { email, password },
          code: "SYNTHETIC_USER_LOGIN_FAILED",
        });
        const accessToken = session.body?.access_token;
        if (!session.ok || session.body?.user?.id !== id
            || typeof accessToken !== "string" || accessToken.length < 16) {
          fail("SYNTHETIC_USER_LOGIN_FAILED", "Synthetic Storage user could not authenticate");
        }
        const user = { id, accessToken };
        const preparation = await userRequest(
          user,
          "/rest/v1/rpc/create_neutral_preparation_space_for_current_user",
          { method: "POST", body: {}, code: "SYNTHETIC_COUPLE_CREATE_FAILED" },
        );
        const coupleId = preparation.body?.couple_id;
        if (!preparation.ok || preparation.body?.success !== true || !UUID.test(coupleId ?? "")) {
          fail("SYNTHETIC_COUPLE_CREATE_FAILED", "Synthetic neutral preparation space was invalid");
        }
        fixtures.set(id, { coupleId, accessToken });
        return Object.freeze({ id, coupleId, accessToken });
      } catch (error) {
        try {
          await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
            method: "DELETE",
            code: "SYNTHETIC_USER_CLEANUP_FAILED",
          });
        } catch {
          // The final Management inventory remains the authoritative residue check.
        }
        throw error;
      }
    },

    async createSignedUpload({ user, bucketId, objectPath }) {
      if (!UUID.test(user?.id ?? "")) {
        fail("SYNTHETIC_USER_INVALID", "Synthetic Storage user was invalid");
      }
      if (bucketId !== "community-media-staging") {
        fail("STORAGE_BUCKET_INVALID", "Signed upload creation must target the staging bucket");
      }
      const response = await adminRequest(
        `/storage/v1/object/upload/sign/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
        {
          method: "POST",
          body: {},
          extraHeaders: { "x-upsert": "false" },
          code: "SIGNED_UPLOAD_CREATE_FAILED",
        },
      );
      if (!response.ok) {
        fail("SIGNED_UPLOAD_CREATE_FAILED", "Exact staging signed upload could not be created");
      }
      const returnedUrl = response.body?.signedUrl ?? response.body?.url;
      const signedUrl = validateReturnedSignedUrl(returnedUrl, bucketId, objectPath);
      const token = response.body?.token ?? signedUrl.searchParams.get("token");
      if (typeof token !== "string" || token.length < 3
          || token !== signedUrl.searchParams.get("token")) {
        fail("SIGNED_UPLOAD_TOKEN_INVALID", "Signed upload token was invalid");
      }
      return Object.freeze({ bucketId, objectPath, token, signedUrl: signedUrl.toString() });
    },

    async uploadSignedObject({ signedUpload, bucketId, objectPath, contentType, bytes }) {
      const signedUrl = validateReturnedSignedUrl(signedUpload?.signedUrl, bucketId, objectPath);
      if (signedUpload?.bucketId !== bucketId || signedUpload?.objectPath !== objectPath
          || signedUpload?.token !== signedUrl.searchParams.get("token")
          || typeof contentType !== "string" || !(bytes instanceof Uint8Array)) {
        fail("SIGNED_UPLOAD_ARGUMENT_INVALID", "Signed upload arguments were invalid");
      }
      const response = await anonRequest(signedUrl.toString(), {
        method: "PUT",
        body: bytes,
        contentType,
        extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
        code: "SIGNED_UPLOAD_FAILED",
      });
      return Object.freeze({ uploaded: response.ok });
    },

    async attemptSignedUploadAtDifferentPath({ signedUpload, objectPath, differentObjectPath }) {
      if (signedUpload?.objectPath !== objectPath || objectPath === differentObjectPath) {
        fail("SIGNED_UPLOAD_ARGUMENT_INVALID", "Signed path-binding arguments were invalid");
      }
      const content = contentForBucket(signedUpload.bucketId);
      const differentUrl = signedUrlFor({
        bucketId: signedUpload.bucketId,
        objectPath: differentObjectPath,
        token: signedUpload.token,
      });
      const response = await anonRequest(differentUrl.toString(), {
        method: "PUT",
        body: content.bytes,
        contentType: content.contentType,
        extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
        code: "SIGNED_UPLOAD_DIFFERENT_PATH_CHECK_FAILED",
      });
      return Object.freeze({ denied: !response.ok });
    },

    async attemptUnsignedMutation({ actor, user, bucketId, objectPath }) {
      if (!ACTORS.includes(actor)) {
        fail("STORAGE_MUTATION_ACTOR_INVALID", "Unsigned Storage actor was invalid");
      }
      assertBucket(bucketId);
      const content = contentForBucket(bucketId);
      const call = actor === "authenticated"
        ? (path, options) => userRequest(user, path, options)
        : anonRequest;
      const exactPath = `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`;
      const upload = await call(exactPath, {
        method: "POST",
        body: content.bytes,
        contentType: content.contentType,
        extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
        code: "UNSIGNED_STORAGE_CHECK_FAILED",
      });
      const update = await call(exactPath, {
        method: "PUT",
        body: content.bytes,
        contentType: content.contentType,
        extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
        code: "UNSIGNED_STORAGE_CHECK_FAILED",
      });
      const removal = await call(`/storage/v1/object/${encodeURIComponent(bucketId)}`, {
        method: "DELETE",
        body: { prefixes: [objectPath] },
        code: "UNSIGNED_STORAGE_CHECK_FAILED",
      });
      const allowed = upload.ok
        || update.ok
        || (removal.ok && responseReturnedPath(removal.body, objectPath));
      return Object.freeze({ denied: !allowed });
    },

    async attemptChatDirectInsert({ user, bucketId, objectPath }) {
      if (bucketId !== "chat-image") {
        fail("STORAGE_BUCKET_INVALID", "Chat direct insert must target chat-image");
      }
      const content = contentForBucket(bucketId);
      const response = await userRequest(
        user,
        `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
        {
          method: "POST",
          body: content.bytes,
          contentType: content.contentType,
          extraHeaders: { "cache-control": "max-age=0", "x-upsert": "false" },
          code: "CHAT_DIRECT_INSERT_CHECK_FAILED",
        },
      );
      return Object.freeze({ denied: !response.ok });
    },

    async deleteExactObject({ bucketId, objectPath }) {
      assertBucket(bucketId);
      const deleted = await removeObject(bucketId, objectPath);
      const absent = await objectAbsent(bucketId, objectPath);
      return Object.freeze({ deleted, absent });
    },

    async deleteSyntheticUser(userId) {
      if (!UUID.test(userId ?? "")) {
        fail("SYNTHETIC_USER_INVALID", "Synthetic Storage user ID was invalid");
      }
      const fixture = fixtures.get(userId);
      if (!UUID.test(fixture?.coupleId ?? "")
          || typeof fixture?.accessToken !== "string" || fixture.accessToken.length < 8) {
        fail("SYNTHETIC_USER_SESSION_INVALID", "Synthetic cleanup session was unavailable");
      }
      const reset = await userRequest(
        { id: userId, accessToken: fixture.accessToken },
        "/rest/v1/rpc/reset_current_couple_membership",
        { method: "POST", body: {}, code: "SYNTHETIC_USER_CLEANUP_FAILED" },
      );
      if (!reset.ok || reset.body?.success !== true
          || reset.body?.previous_couple_id !== fixture.coupleId) {
        return Object.freeze({ deleted: false });
      }
      const account = await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        code: "SYNTHETIC_USER_CLEANUP_FAILED",
      });
      if (account.ok) fixtures.delete(userId);
      return Object.freeze({ deleted: account.ok });
    },
  });
}

function assertNormalizedInventory(inventory) {
  if (!inventory || typeof inventory !== "object"
      || inventory.relationOwner !== "supabase_storage_admin"
      || inventory.relationRlsEnabled !== true
      || inventory.relationForceRls !== false
      || inventory.storageBucketCount !== 11
      || inventory.retiredGuestbookPrivateBucketCount !== 2
      || !SHA256.test(inventory.bucketContractSha256 ?? "")
      || inventory.storagePolicyCount !== 1
      || inventory.storageInsertPolicyCount !== 1
      || inventory.storagePolicyExpressionSha256 !== POLICY_EXPRESSION_SHA256
      || inventory.productionStorageFenceFunctionVerified !== true
      || inventory.productionStorageWritesAllowed !== false
      || !Number.isSafeInteger(inventory.totalObjectCount) || inventory.totalObjectCount < 0
      || !SHA256.test(inventory.objectInventorySha256 ?? "")
      || !Number.isFinite(Date.parse(inventory.observedAt ?? ""))
      || ![
        inventory.exactNonceAuthUserCount,
        inventory.exactNonceProfileCount,
        inventory.exactNonceCoupleCount,
        inventory.exactNonceStorageObjectCount,
      ].every((value) => value === 0)) {
    fail("STORAGE_INVENTORY_CONTRACT_DRIFT", "Injected Storage inventory was not canonical");
  }
  return inventory;
}

function stableSemantics(baseline, finalInventory) {
  return baseline.bucketContractSha256 === finalInventory.bucketContractSha256
    && baseline.storagePolicyExpressionSha256 === finalInventory.storagePolicyExpressionSha256
    && baseline.storageBucketCount === finalInventory.storageBucketCount
    && baseline.retiredGuestbookPrivateBucketCount
      === finalInventory.retiredGuestbookPrivateBucketCount
    && baseline.storagePolicyCount === finalInventory.storagePolicyCount
    && baseline.storageInsertPolicyCount === finalInventory.storageInsertPolicyCount
    && baseline.productionStorageFenceFunctionVerified
      === finalInventory.productionStorageFenceFunctionVerified
    && baseline.productionStorageWritesAllowed
      === finalInventory.productionStorageWritesAllowed;
}

function probePaths(user, runNonce) {
  const unsigned = UNSIGNED_BUCKETS.flatMap((bucketId) => ACTORS.map((actor) => ({
    kind: `unsigned-${actor}`,
    actor,
    bucketId,
    objectPath: `${user.id}/${runNonce}-unsigned-${actor}-${bucketId}.${
      bucketId === "community-videos" ? "mp4" : "png"
    }`,
  })));
  return Object.freeze({
    signed: Object.freeze({
      kind: "signed-original",
      bucketId: "community-media-staging",
      objectPath: `${user.id}/${runNonce}-signed.png`,
    }),
    differentSigned: Object.freeze({
      kind: "signed-different-path",
      bucketId: "community-media-staging",
      objectPath: `${user.id}/${runNonce}-signed-different.png`,
    }),
    unsigned: Object.freeze(unsigned),
    chat: Object.freeze({
      kind: "chat-direct",
      bucketId: "chat-image",
      objectPath: `${user.coupleId}/${user.id}/${runNonce}.png`,
    }),
  });
}

async function persistReceipt(receiptOut, receipt) {
  try {
    await mkdir(dirname(receiptOut), { recursive: true });
    await writeFile(receiptOut, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    fail("RECEIPT_WRITE_FAILED", "Storage staging receipt could not be written exclusively");
  }
}

export async function runAmoraSuccessorStorageStagingProbe({
  config,
  transport,
  inspectInventory,
  writeReceipt,
  runNonce = randomBytes(16).toString("hex"),
  now = () => new Date(),
}) {
  if (!config || typeof transport !== "object" || typeof inspectInventory !== "function"
      || (writeReceipt !== undefined && typeof writeReceipt !== "function")
      || !RUN_NONCE.test(runNonce) || typeof now !== "function") {
    fail("PROBE_ARGUMENT_INVALID", "Storage staging probe dependencies were invalid");
  }
  const startedDate = now();
  if (!(startedDate instanceof Date) || !Number.isFinite(startedDate.valueOf())) {
    fail("PROBE_CLOCK_INVALID", "Storage staging probe clock was invalid");
  }
  const baseline = assertNormalizedInventory(await inspectInventory({
    phase: "baseline",
    runNonce,
    userId: null,
    coupleId: null,
  }));

  let user = null;
  let paths = null;
  let scenarioError = null;
  let cleanupError = null;
  let finalInventory = null;
  const checks = {
    baselineContract: true,
    signedExactPathUpload: false,
    signedDifferentPathDenied: false,
    anonUnsignedDenied: false,
    authenticatedUnsignedDenied: false,
    chatDirectInsertDenied: false,
    productionStorageFenceNotLifted: baseline.productionStorageWritesAllowed === false,
    exactObjectCleanup: false,
    finalContractStable: false,
    exactNonceResidueZero: false,
  };

  try {
    user = await transport.createSyntheticUser(`amora-storage-${runNonce}`);
    if (!UUID.test(user?.id ?? "") || !UUID.test(user?.coupleId ?? "")
        || typeof user?.accessToken !== "string" || user.accessToken.length < 8) {
      fail("SYNTHETIC_USER_INVALID", "Synthetic Storage fixture was invalid");
    }
    paths = probePaths(user, runNonce);
    const signedUpload = await transport.createSignedUpload({
      user,
      bucketId: paths.signed.bucketId,
      objectPath: paths.signed.objectPath,
    });
    if (signedUpload?.bucketId !== paths.signed.bucketId
        || signedUpload?.objectPath !== paths.signed.objectPath
        || typeof signedUpload?.token !== "string" || signedUpload.token.length < 3
        || typeof signedUpload?.signedUrl !== "string") {
      fail("SIGNED_UPLOAD_TOKEN_INVALID", "Signed upload response was not canonical");
    }
    const content = contentForBucket(paths.signed.bucketId);
    const uploaded = await transport.uploadSignedObject({
      signedUpload,
      bucketId: paths.signed.bucketId,
      objectPath: paths.signed.objectPath,
      contentType: content.contentType,
      bytes: content.bytes,
    });
    checks.signedExactPathUpload = uploaded?.uploaded === true;
    if (!checks.signedExactPathUpload) {
      fail("SIGNED_UPLOAD_FAILED", "Exact signed staging upload failed");
    }

    const differentPath = await transport.attemptSignedUploadAtDifferentPath({
      signedUpload,
      objectPath: paths.signed.objectPath,
      differentObjectPath: paths.differentSigned.objectPath,
    });
    checks.signedDifferentPathDenied = differentPath?.denied === true;
    if (!checks.signedDifferentPathDenied) {
      fail("SIGNED_UPLOAD_PATH_REUSE_ALLOWED", "Signed upload token accepted a different object path");
    }

    const actorChecks = { anon: [], authenticated: [] };
    for (const candidate of paths.unsigned) {
      const result = await transport.attemptUnsignedMutation({
        actor: candidate.actor,
        user,
        bucketId: candidate.bucketId,
        objectPath: candidate.objectPath,
      });
      actorChecks[candidate.actor].push(result?.denied === true);
      if (result?.denied !== true) {
        fail("UNSIGNED_STORAGE_MUTATION_ALLOWED", "An unsigned staging or final-bucket mutation was allowed");
      }
    }
    checks.anonUnsignedDenied = actorChecks.anon.length === UNSIGNED_BUCKETS.length
      && actorChecks.anon.every(Boolean);
    checks.authenticatedUnsignedDenied = actorChecks.authenticated.length === UNSIGNED_BUCKETS.length
      && actorChecks.authenticated.every(Boolean);

    const chatResult = await transport.attemptChatDirectInsert({
      user,
      bucketId: paths.chat.bucketId,
      objectPath: paths.chat.objectPath,
    });
    checks.chatDirectInsertDenied = chatResult?.denied === true;
    if (!checks.chatDirectInsertDenied) {
      fail("CHAT_DIRECT_INSERT_ALLOWED", "Direct chat-image insertion was allowed without a fence lift");
    }
  } catch (error) {
    scenarioError = error;
  } finally {
    const cleanupFailures = [];
    if (paths) {
      const candidates = [
        paths.signed,
        paths.differentSigned,
        ...paths.unsigned,
        paths.chat,
      ];
      const uniqueCandidates = [...new Map(candidates.map((candidate) => [
        `${candidate.bucketId}\n${candidate.objectPath}`,
        candidate,
      ])).values()];
      for (const candidate of uniqueCandidates) {
        try {
          const cleaned = await transport.deleteExactObject({
            bucketId: candidate.bucketId,
            objectPath: candidate.objectPath,
          });
          if (cleaned?.absent !== true) cleanupFailures.push("object");
        } catch {
          cleanupFailures.push("object");
        }
      }
      checks.exactObjectCleanup = cleanupFailures.length === 0;
    }
    if (user) {
      try {
        const deleted = await transport.deleteSyntheticUser(user.id);
        if (deleted?.deleted !== true) cleanupFailures.push("user");
      } catch {
        cleanupFailures.push("user");
      }
    }
    try {
      finalInventory = assertNormalizedInventory(await inspectInventory({
        phase: "final",
        runNonce,
        userId: user?.id ?? null,
        coupleId: user?.coupleId ?? null,
      }));
      checks.finalContractStable = stableSemantics(baseline, finalInventory);
      checks.exactNonceResidueZero = [
        finalInventory.exactNonceAuthUserCount,
        finalInventory.exactNonceProfileCount,
        finalInventory.exactNonceCoupleCount,
        finalInventory.exactNonceStorageObjectCount,
      ].every((value) => value === 0);
      if (!checks.finalContractStable) cleanupFailures.push("semantics");
      if (!checks.exactNonceResidueZero) cleanupFailures.push("residue");
    } catch (error) {
      cleanupFailures.push("inventory");
      cleanupError = error;
    }
    if (cleanupFailures.length > 0 && cleanupError === null) {
      cleanupError = new AmoraSuccessorStorageStagingProbeError(
        "STORAGE_PROBE_CLEANUP_FAILED",
        "Storage staging probe cleanup or final contract verification failed",
      );
    }
  }

  if (cleanupError) throw cleanupError;
  if (scenarioError) throw scenarioError;
  const completedDate = now();
  if (!(completedDate instanceof Date) || !Number.isFinite(completedDate.valueOf())) {
    fail("PROBE_CLOCK_INVALID", "Storage staging probe clock was invalid");
  }
  const receipt = Object.freeze({
    receiptVersion: 1,
    kind: "amora-successor-storage-staging-upload-cleanup",
    status: "upload_cleanup_verified",
    scope: "staging-storage-exact-upload-and-cleanup-only",
    projectRef: config.projectRef,
    gitCommit: config.expectedCommit,
    migrationLedger: Object.freeze({
      count: config.expectedMigrationCount,
      head: config.expectedMigrationHead,
    }),
    startedAt: startedDate.toISOString(),
    completedAt: completedDate.toISOString(),
    signedUploadTokenExpired: false,
    drainVerified: false,
    tokenPersisted: false,
    containsSecrets: false,
    containsObjectPaths: false,
    checks: Object.freeze({ ...checks }),
    residue: Object.freeze({
      authUsers: finalInventory.exactNonceAuthUserCount,
      profiles: finalInventory.exactNonceProfileCount,
      couples: finalInventory.exactNonceCoupleCount,
      storageObjects: finalInventory.exactNonceStorageObjectCount,
    }),
    inventory: Object.freeze({
      bucketContractSha256: baseline.bucketContractSha256,
      storagePolicyExpressionSha256: baseline.storagePolicyExpressionSha256,
      baselineObjectInventorySha256: baseline.objectInventorySha256,
      finalObjectInventorySha256: finalInventory.objectInventorySha256,
      globalObjectInventoryChanged:
        baseline.objectInventorySha256 !== finalInventory.objectInventorySha256,
    }),
  });
  if (writeReceipt) {
    await writeReceipt(receipt);
  } else {
    await persistReceipt(config.receiptOut, receipt);
  }
  return receipt;
}

export function storageProbeReceiptSha256(receipt) {
  return createHash("sha256")
    .update(`${JSON.stringify(receipt, null, 2)}\n`, "utf8")
    .digest("hex");
}
