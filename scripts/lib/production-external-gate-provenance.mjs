import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
  AMORA_POST_EXPAND_TABLES,
  AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
  AMORA_RELEASE_MIGRATION_VERSIONS,
  POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
} from "./amora-release-extended-contracts.mjs";
import { productionDatabaseSystemIdentifier } from "./production-database-identity.mjs";

const MAX_PROVIDER_RAW_BYTES = 512 * 1024;
const MAX_PROBE_RAW_BYTES = 128 * 1024;
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_VERCEL_SERVER_ERROR_EVIDENCE_BYTES = 256 * 1024;
const MAX_HOSTED_RESTORE_LOGICAL_PAYLOAD_BYTES = 32 * 1024 * 1024;
const CANARY_HTTP_LATENCY_BUDGET_MS = 10_000;
const CANARY_BROWSER_LATENCY_BUDGET_MS = 15_000;
const HOSTED_RESTORE_LOGICAL_DATA_SQL_RELATIVE_PATH =
  "scripts/sql/amora-db-logical-backup.sql";
export const HOSTED_RESTORE_LOGICAL_DATA_PROBE_SQL_SHA256 =
  "cfffa78c65306597f4d6ad39a303c7190b22d772a61d0715b4bf70cfbf2248e6";
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{16,64}$/;
const VERCEL_TEAM_ID = /^team_[A-Za-z0-9]{16,64}$/;
const VERCEL_PROJECT_ID = /^prj_[A-Za-z0-9]{16,64}$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;
const SECRET_FIELD_NAMES = new Set([
  "apikey",
  "authorization",
  "buildenv",
  "credential",
  "credentials",
  "env",
  "environment",
  "password",
  "secret",
  "secrets",
  "token",
]);
const SECRET_VALUE = /(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;
export const HOSTED_RESTORE_PROJECT_NAME_PATTERN =
  "^wedding-hanbang-restore-drill-\\d{8}(?:-[a-z0-9]{1,12})?$";
const DISPOSABLE_RESTORE_PROJECT_NAME = new RegExp(
  HOSTED_RESTORE_PROJECT_NAME_PATTERN,
);

export const PRODUCTION_CANARY_REQUIRED_CHECKS = Object.freeze([
  "authenticatedReadPassed",
  "browserConsoleClean",
  "databaseFenceStillVerified",
  "deployedCommitMatched",
  "deploymentReady",
  "latencyWithinBaseline",
  "loginLogoutPassed",
  "noUnexpected5xx",
  "publicReadPassed",
  "serverErrorsWithinBaseline",
  "signupStillDisabled",
  "storageHelperClosed",
  "webWriteFenceStillEnabled",
]);

export const PRODUCTION_CANARY_REQUIRED_CHECKS_SHA256 =
  externalGateSha256(JSON.stringify(PRODUCTION_CANARY_REQUIRED_CHECKS));

const CANARY_HTTP_PROBES = Object.freeze([
  Object.freeze({
    id: "public-home",
    method: "GET",
    path: "/wedding",
    expectedStatus: "success",
  }),
  Object.freeze({
    id: "write-fence",
    method: "POST",
    path: "/api/release/write-fence-probe",
    expectedStatus: 503,
  }),
  Object.freeze({
    id: "signup-fence",
    method: "POST",
    path: "/api/auth/signup",
    expectedStatus: 503,
  }),
  Object.freeze({
    id: "storage-fence",
    method: "POST",
    path: "/api/community/upload",
    expectedStatus: 503,
  }),
]);

export const PRODUCTION_CANARY_HTTP_PROBE_CONTRACT_SHA256 =
  externalGateSha256(JSON.stringify(CANARY_HTTP_PROBES));

export class ExternalGateProvenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExternalGateProvenanceError";
    this.code = code;
  }
}

function blocked(code, message) {
  throw new ExternalGateProvenanceError(code, message);
}

function exactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function externalGateSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPinnedSql(value) {
  if (typeof value !== "string" || /\r(?!\n)/.test(value)) return null;
  // Git stores this artifact as LF. Accept CRLF checkout transport only, then
  // execute the exact canonical bytes represented by the pinned hash.
  return value.replaceAll("\r\n", "\n");
}

function pinnedSqlSha256(value) {
  const canonical = canonicalPinnedSql(value);
  return canonical === null ? null : externalGateSha256(canonical);
}

function parseCanonicalInstant(value) {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value
    ? millis
    : null;
}

function canonicalHost(value, code = "TARGET_INVALID") {
  if (typeof value !== "string") blocked(code, "expected host is invalid");
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  const labels = normalized.split(".");
  if (normalized.length > 253
      || labels.length < 2
      || labels.some((label) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    blocked(code, "expected host is invalid");
  }
  return normalized;
}

function exactHttpsUrl(value, expectedHost, expectedPath, code) {
  let url;
  try {
    url = new URL(value);
  } catch {
    blocked(code, "observed URL is invalid");
  }
  if (url.protocol !== "https:"
      || canonicalHost(url.hostname, code) !== expectedHost
      || url.username
      || url.password
      || url.port
      || url.pathname !== expectedPath
      || url.search
      || url.hash) {
    blocked(code, "observed URL escaped the exact production path");
  }
  return url;
}

function readClock(now, code) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    blocked(code, "collector clock is invalid");
  }
  return value;
}

function assertNoSecretMaterial(value, code) {
  const visit = (candidate) => {
    if (typeof candidate === "string") {
      if (SECRET_VALUE.test(candidate)) blocked(code, "raw evidence appears to contain secret material");
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    for (const [key, nested] of Object.entries(candidate)) {
      const normalizedKey = key.replaceAll(/[-_]/g, "").toLowerCase();
      if (SECRET_FIELD_NAMES.has(normalizedKey)) {
        blocked(code, "raw evidence contains a forbidden secret-bearing field");
      }
      visit(nested);
    }
  };
  visit(value);
}

function validBearerSecret(value) {
  return typeof value === "string"
    && value.length >= 20
    && value.length <= 4_096
    && !/[\u0000-\u0020\u007f]/.test(value);
}

function validDatabasePassword(value) {
  return typeof value === "string"
    && value.length >= 16
    && value.length <= 4_096
    && !/[\u0000\r\n]/.test(value);
}

function parseBoundedJson(text, maximumBytes, code) {
  if (typeof text !== "string"
      || Buffer.byteLength(text, "utf8") < 2
      || Buffer.byteLength(text, "utf8") > maximumBytes) {
    blocked(code, "raw evidence size is invalid");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    blocked(code, "raw evidence is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    blocked(code, "raw evidence must be one JSON object");
  }
  assertNoSecretMaterial(value, code);
  return value;
}

function safeEvidenceFileName(value, code) {
  if (typeof value !== "string"
      || !SAFE_FILE_NAME.test(value)
      || basename(value) !== value) {
    blocked(code, "raw evidence filename is invalid");
  }
  return value;
}

function requiredChecksSha256(checks) {
  return externalGateSha256(JSON.stringify(checks));
}

function safeChecks(value, expected, code) {
  if (!exactKeys(value, expected)
      || expected.some((check) => value[check] !== true)) {
    blocked(code, "required check set is incomplete or failed");
  }
  return value;
}

function millisToInstant(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) {
    blocked(code, "provider timestamp is invalid");
  }
  return new Date(value).toISOString();
}

function normalizedVercelAliases(value, code) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    blocked(code, "Vercel aliases are invalid");
  }
  const aliases = value.map((entry) => canonicalHost(entry, code));
  if (new Set(aliases).size !== aliases.length) {
    blocked(code, "Vercel aliases are ambiguous");
  }
  return aliases;
}

export function validateVercelDeploymentRawEvidence(rawText, expected) {
  const code = "VERCEL_RAW_EVIDENCE_INVALID";
  const raw = parseBoundedJson(rawText, MAX_PROVIDER_RAW_BYTES, code);
  const productionHost = canonicalHost(expected.productionHost, code);
  const aliases = normalizedVercelAliases(raw.alias, code);
  const deploymentHost = canonicalHost(raw.url, code);
  const commit = raw.meta?.githubCommitSha;
  if (!VERCEL_TEAM_ID.test(expected.teamId ?? "")
      || !VERCEL_PROJECT_ID.test(expected.projectId ?? "")
      || !DEPLOYMENT_ID.test(expected.deploymentId ?? "")
      || !COMMIT.test(expected.releaseCommit ?? "")
      || raw.id !== expected.deploymentId
      || raw.teamId !== expected.teamId
      || raw.projectId !== expected.projectId
      || raw.target !== "production"
      || raw.readyState !== "READY"
      || commit !== expected.releaseCommit
      || !aliases.includes(productionHost)
      || deploymentHost === productionHost
      || !deploymentHost.endsWith(".vercel.app")) {
    blocked(code, "Vercel evidence does not bind the exact production deployment");
  }
  const deploymentCreatedAt = millisToInstant(raw.createdAt, code);
  const readyAt = millisToInstant(raw.ready, code);
  if (Date.parse(deploymentCreatedAt) > Date.parse(readyAt)) {
    blocked(code, "Vercel deployment timestamps are inconsistent");
  }
  return {
    raw,
    rawSha256: externalGateSha256(rawText),
    deploymentUrl: `https://${deploymentHost}`,
    deploymentCreatedAt,
    readyAt,
    productionHost,
  };
}

export function buildVercelDeploymentReceipt({
  rawText,
  rawEvidenceFileName,
  release,
  projectRef,
  releaseCommit,
  teamId,
  projectId,
  deploymentId,
  productionHost,
  verifiedAt,
}) {
  const evidence = validateVercelDeploymentRawEvidence(rawText, {
    releaseCommit,
    teamId,
    projectId,
    deploymentId,
    productionHost,
  });
  if (!PROJECT_REF.test(projectRef ?? "")
      || parseCanonicalInstant(verifiedAt) === null
      || Date.parse(verifiedAt) < Date.parse(evidence.readyAt)) {
    blocked("VERCEL_RECEIPT_INVALID", "Vercel receipt binding is invalid");
  }
  return {
    receiptVersion: 1,
    kind: "vercel-production-deployment",
    release,
    projectRef,
    releaseCommit,
    deploymentId,
    deploymentUrl: evidence.deploymentUrl,
    deploymentUrlSha256: externalGateSha256(evidence.deploymentUrl),
    deploymentCreatedAt: evidence.deploymentCreatedAt,
    readyAt: evidence.readyAt,
    verifiedAt,
    target: "production",
    readyState: "READY",
    source: "vercel-api",
    provenance: {
      collector: "vercel-deployments-api-v13",
      teamId,
      projectId,
      productionHost: evidence.productionHost,
      rawEvidenceFileName: safeEvidenceFileName(
        rawEvidenceFileName,
        "VERCEL_RECEIPT_INVALID",
      ),
      rawEvidenceSha256: evidence.rawSha256,
    },
    containsSecrets: false,
  };
}

export function validateVercelDeploymentReceiptProvenance({
  receipt,
  rawText,
  expected,
}) {
  const code = "VERCEL_RECEIPT_PROVENANCE_INVALID";
  const provenanceKeys = [
    "collector",
    "teamId",
    "projectId",
    "productionHost",
    "rawEvidenceFileName",
    "rawEvidenceSha256",
  ];
  if (!exactKeys(receipt?.provenance, provenanceKeys)
      || receipt.provenance.collector !== "vercel-deployments-api-v13"
      || receipt.provenance.teamId !== expected.teamId
      || receipt.provenance.projectId !== expected.projectId
      || receipt.provenance.productionHost
        !== canonicalHost(expected.productionHost, code)
      || !SHA256.test(receipt.provenance.rawEvidenceSha256 ?? "")
      || receipt.provenance.rawEvidenceSha256 !== externalGateSha256(rawText)) {
    blocked(code, "Vercel receipt provenance is incomplete or altered");
  }
  const raw = validateVercelDeploymentRawEvidence(rawText, {
    releaseCommit: expected.releaseCommit,
    teamId: expected.teamId,
    projectId: expected.projectId,
    deploymentId: receipt.deploymentId,
    productionHost: expected.productionHost,
  });
  if (receipt.deploymentUrl !== raw.deploymentUrl
      || receipt.deploymentCreatedAt !== raw.deploymentCreatedAt
      || receipt.readyAt !== raw.readyAt
      || receipt.deploymentUrlSha256 !== externalGateSha256(raw.deploymentUrl)) {
    blocked(code, "Vercel receipt differs from its raw API response");
  }
  return raw;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildHostedRestoreReadOnlyProbeSql({
  expectedTables = AMORA_POST_EXPAND_TABLES,
  expectedMigrationVersions = AMORA_RELEASE_MIGRATION_VERSIONS,
} = {}) {
  const tableArray = expectedTables.map(sqlLiteral).join(", ");
  const migrationArray = expectedMigrationVersions.map(sqlLiteral).join(", ");
  return `BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT json_build_object(
  'probeVersion', 1,
  'transactionReadOnly', current_setting('transaction_read_only') = 'on',
  'databaseName', current_database(),
  'databaseSystemIdentifier', (
    SELECT system_identifier::text FROM pg_catalog.pg_control_system()
  ),
  'targetTables', COALESCE((
    SELECT json_agg(c.relname ORDER BY c.relname)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname = ANY (ARRAY[${tableArray}]::text[])
  ), '[]'::json),
  'targetReleaseMigrationVersions', COALESCE((
    SELECT json_agg(m.version::text ORDER BY m.version::text)
    FROM supabase_migrations.schema_migrations m
    WHERE m.version::text = ANY (ARRAY[${migrationArray}]::text[])
  ), '[]'::json),
  'leaseTableCount', (
    SELECT count(*)::integer
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'production_release_lease_20260717'
      AND c.relkind IN ('r', 'p')
  ),
  'liveSchemaContractSha256', upper(
    public.production_live_schema_contract_20260717()
  ),
  'checkedAt', to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
ROLLBACK;`;
}

export const HOSTED_RESTORE_READ_ONLY_PROBE_SQL =
  buildHostedRestoreReadOnlyProbeSql();
export const HOSTED_RESTORE_READ_ONLY_PROBE_SQL_SHA256 =
  externalGateSha256(HOSTED_RESTORE_READ_ONLY_PROBE_SQL);

export function buildLogicalDataDigestContractFromPayload(payload) {
  const code = "HOSTED_RESTORE_LOGICAL_DATA_INVALID";
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || !payload.tables || typeof payload.tables !== "object"
      || Array.isArray(payload.tables)
      || !exactKeys(payload.tables, AMORA_POST_EXPAND_TABLES)) {
    blocked(code, "logical restore payload has a non-exact table set");
  }
  const contract = AMORA_POST_EXPAND_TABLES.map((name) => {
    const table = payload.tables[name];
    if (!table || typeof table !== "object" || Array.isArray(table)
        || !Number.isSafeInteger(table.row_count)
        || table.row_count < 0
        || table.row_count > 10_000_000
        || !Array.isArray(table.rows)
        || table.rows.length !== table.row_count
        || !SHA256.test(String(table.canonical_sha256 ?? "").toLowerCase())) {
      blocked(code, `logical restore payload metadata is invalid for ${name}`);
    }
    return {
      name,
      row_count: table.row_count,
      canonical_sha256: String(table.canonical_sha256).toUpperCase(),
    };
  });
  return {
    contract,
    sha256: externalGateSha256(JSON.stringify(contract)).toUpperCase(),
  };
}

function parseSensitiveBoundedJson(text, maximumBytes, code) {
  if (typeof text !== "string"
      || Buffer.byteLength(text, "utf8") < 2
      || Buffer.byteLength(text, "utf8") > maximumBytes) {
    blocked(code, "sensitive in-memory JSON size is invalid");
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("shape");
    }
    return value;
  } catch {
    blocked(code, "sensitive in-memory output is not one JSON object");
  }
}

function parseHostedRestoreLogicalPsqlOutput(stdout) {
  const code = "HOSTED_RESTORE_LOGICAL_DATA_PROBE_FAILED";
  if (typeof stdout !== "string"
      || Buffer.byteLength(stdout, "utf8") < 4
      || Buffer.byteLength(stdout, "utf8") > 64 * 1024 * 1024) {
    blocked(code, "logical data probe output size is invalid");
  }
  const trimmed = stdout.trim();
  const separator = trimmed.lastIndexOf("|");
  if (separator < 2) {
    blocked(code, "logical data probe output has an invalid psql row shape");
  }
  const payloadText = trimmed.slice(0, separator);
  const payloadBytesText = trimmed.slice(separator + 1);
  if (!/^[1-9][0-9]{0,8}$/.test(payloadBytesText)) {
    blocked(code, "logical data probe did not report a valid server-side size");
  }
  const payloadBytes = Number(payloadBytesText);
  if (!Number.isSafeInteger(payloadBytes)
      || payloadBytes > MAX_HOSTED_RESTORE_LOGICAL_PAYLOAD_BYTES) {
    blocked(code, "logical data probe exceeded the server-side size bound");
  }
  return parseSensitiveBoundedJson(
    payloadText,
    64 * 1024 * 1024,
    code,
  );
}

function parseHostedRestoreCoreProbeRaw(rawText, expected) {
  const code = "HOSTED_RESTORE_DB_CORE_PROBE_INVALID";
  const raw = parseBoundedJson(rawText.trim(), MAX_PROBE_RAW_BYTES, code);
  const keys = [
    "probeVersion",
    "transactionReadOnly",
    "databaseName",
    "databaseSystemIdentifier",
    "targetTables",
    "targetReleaseMigrationVersions",
    "leaseTableCount",
    "liveSchemaContractSha256",
    "checkedAt",
  ];
  if (!exactKeys(raw, keys)
      || raw.probeVersion !== 1
      || raw.transactionReadOnly !== true
      || raw.databaseName !== "postgres"
      || !/^\d{10,32}$/.test(raw.databaseSystemIdentifier ?? "")
      || raw.databaseSystemIdentifier === expected.sourceDatabaseSystemIdentifier
      || !exactArray(raw.targetTables, expected.expectedTables)
      || !exactArray(
        raw.targetReleaseMigrationVersions,
        expected.expectedMigrationVersions,
      )
      || raw.leaseTableCount !== 1
      || !UPPER_SHA256.test(raw.liveSchemaContractSha256 ?? "")
      || parseCanonicalInstant(raw.checkedAt) === null) {
    blocked(code, "hosted restore core DB probe failed");
  }
  return raw;
}

export async function collectHostedRestoreAuthHealth({
  fetchImpl = globalThis.fetch,
  targetProjectRef,
  now = () => new Date(),
}) {
  if (typeof fetchImpl !== "function"
      || !PROJECT_REF.test(targetProjectRef ?? "")) {
    blocked("HOSTED_RESTORE_AUTH_HEALTH_CONFIG_INVALID", "Auth health target is invalid");
  }
  const endpoint = `https://${targetProjectRef}.supabase.co/auth/v1/health`;
  let response;
  try {
    response = await fetchImpl(endpoint, { method: "GET", redirect: "error" });
  } catch {
    blocked("HOSTED_RESTORE_AUTH_HEALTH_FAILED", "Auth health request failed");
  }
  const body = await safeResponseText(
    response,
    64 * 1024,
    "HOSTED_RESTORE_AUTH_HEALTH_FAILED",
  );
  const observation = {
    runner: "supabase-auth-health-v1",
    targetProjectRef,
    endpoint,
    status: response.status,
    bodySha256: externalGateSha256(body),
    checkedAt: readClock(now, "HOSTED_RESTORE_AUTH_HEALTH_CLOCK_INVALID")
      .toISOString(),
  };
  validateHostedRestoreAuthHealth(observation, targetProjectRef);
  return observation;
}

function validateHostedRestoreAuthHealth(value, targetProjectRef) {
  const code = "HOSTED_RESTORE_AUTH_HEALTH_INVALID";
  const keys = [
    "runner",
    "targetProjectRef",
    "endpoint",
    "status",
    "bodySha256",
    "checkedAt",
  ];
  if (!exactKeys(value, keys)
      || value.runner !== "supabase-auth-health-v1"
      || value.targetProjectRef !== targetProjectRef
      || value.endpoint
        !== `https://${targetProjectRef}.supabase.co/auth/v1/health`
      || value.status !== 200
      || !SHA256.test(value.bodySha256 ?? "")
      || parseCanonicalInstant(value.checkedAt) === null) {
    blocked(code, "hosted restore Auth health evidence is invalid");
  }
  return value;
}

function deriveHostedRestoreChecks(raw, expected) {
  const schemaMatches = raw.liveSchemaContractSha256
    === expected.expectedLiveSchemaContractSha256;
  const dataMatches = raw.logicalDataContractSha256
    === expected.expectedLogicalDataContractSha256;
  const tablesExact = exactArray(raw.targetTables, expected.expectedTables);
  const migrationsExact = exactArray(
    raw.targetReleaseMigrationVersions,
    expected.expectedMigrationVersions,
  );
  const isolated = expected.sourceProjectRef !== expected.targetProjectRef
    && /^\d{10,32}$/.test(expected.sourceDatabaseSystemIdentifier ?? "")
    && raw.databaseSystemIdentifier !== expected.sourceDatabaseSystemIdentifier;
  const authHealthy = raw.authHealth.status === 200;
  return {
    authApiSmokeVerified: authHealthy,
    authUsersSchemaAndDataVerified: schemaMatches && dataMatches,
    checkConstraintsVerified: schemaMatches,
    columnDefaultsVerified: schemaMatches,
    destructiveRestoreDrillCompleted:
      isolated && schemaMatches && dataMatches,
    isolatedTargetConfirmed: isolated,
    logicalDataDigestsVerified: dataMatches,
    rowLevelSecurityPoliciesVerified: schemaMatches,
    rpcDefinitionsAndAclVerified: schemaMatches,
    storageMetadataRestoredVerified: schemaMatches && dataMatches,
    triggersVerified: schemaMatches,
    typedSchemaVerified: schemaMatches,
    exactReleaseMigrationLedgerVerified: migrationsExact,
    exactTableAllowlistVerified: tablesExact,
  };
}

function parseDatabaseProbeRaw(rawText, expected) {
  const code = "HOSTED_RESTORE_DB_PROBE_INVALID";
  const raw = parseBoundedJson(rawText.trim(), MAX_PROBE_RAW_BYTES, code);
  const keys = [
    "probeVersion",
    "transactionReadOnly",
    "databaseName",
    "databaseSystemIdentifier",
    "targetTables",
    "targetReleaseMigrationVersions",
    "leaseTableCount",
    "liveSchemaContractSha256",
    "logicalDataContract",
    "logicalDataContractSha256",
    "authHealth",
    "checks",
    "checkedAt",
  ];
  if (!exactKeys(raw, keys)
      || raw.probeVersion !== 1
      || raw.transactionReadOnly !== true
      || raw.databaseName !== "postgres"
      || !/^\d{10,32}$/.test(raw.databaseSystemIdentifier ?? "")
      || raw.databaseSystemIdentifier === expected.sourceDatabaseSystemIdentifier
      || !exactArray(raw.targetTables, expected.expectedTables)
      || !exactArray(
        raw.targetReleaseMigrationVersions,
        expected.expectedMigrationVersions,
      )
      || raw.leaseTableCount !== 1
      || !UPPER_SHA256.test(raw.liveSchemaContractSha256 ?? "")
      || raw.liveSchemaContractSha256
        !== expected.expectedLiveSchemaContractSha256
      || !Array.isArray(raw.logicalDataContract)
      || raw.logicalDataContract.length !== expected.expectedTables.length
      || raw.logicalDataContract.some((entry, index) =>
        !exactKeys(entry, ["name", "row_count", "canonical_sha256"])
        || entry.name !== expected.expectedTables[index]
        || !Number.isSafeInteger(entry.row_count)
        || entry.row_count < 0
        || !UPPER_SHA256.test(entry.canonical_sha256 ?? ""))
      || raw.logicalDataContractSha256
        !== externalGateSha256(JSON.stringify(raw.logicalDataContract)).toUpperCase()
      || raw.logicalDataContractSha256
        !== expected.expectedLogicalDataContractSha256
      || parseCanonicalInstant(raw.checkedAt) === null) {
    blocked(code, "hosted restore database probe is incomplete or not read-only");
  }
  validateHostedRestoreAuthHealth(raw.authHealth, expected.targetProjectRef);
  if (parseCanonicalInstant(raw.authHealth.checkedAt)
        > parseCanonicalInstant(raw.checkedAt)
      || parseCanonicalInstant(raw.checkedAt)
        - parseCanonicalInstant(raw.authHealth.checkedAt) > 5 * 60_000) {
    blocked(code, "hosted restore Auth health evidence is outside the DB probe window");
  }
  const derivedChecks = deriveHostedRestoreChecks(raw, expected);
  safeChecks(derivedChecks, POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS, code);
  if (!exactKeys(raw.checks, POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS)
      || POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS.some(
        (check) => raw.checks[check] !== derivedChecks[check],
      )) {
    blocked(code, "hosted restore checks were not derived from live evidence");
  }
  return {
    raw,
    rawSha256: externalGateSha256(rawText),
  };
}

function validateSupabaseProjectRaw(
  rawText,
  targetProjectRef,
  targetProjectName,
) {
  const code = "HOSTED_RESTORE_PROJECT_EVIDENCE_INVALID";
  const raw = parseBoundedJson(rawText, MAX_PROVIDER_RAW_BYTES, code);
  if (!PROJECT_REF.test(targetProjectRef ?? "")
      || !DISPOSABLE_RESTORE_PROJECT_NAME.test(targetProjectName ?? "")
      || raw.id !== targetProjectRef
      || raw.name !== targetProjectName
      || raw.status !== "ACTIVE_HEALTHY") {
    blocked(
      code,
      "Supabase project evidence does not identify the exact healthy disposable restore target",
    );
  }
  return { raw, rawSha256: externalGateSha256(rawText) };
}

export function validateHostedRestoreDatabaseUrl(databaseUrl, targetProjectRef) {
  const code = "HOSTED_RESTORE_DATABASE_TARGET_INVALID";
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    blocked(code, "hosted restore database URL is invalid");
  }
  let username;
  let password;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    blocked(code, "hosted restore database credentials are malformed");
  }
  const expectedHost = `db.${targetProjectRef}.supabase.co`;
  const sslMode = url.searchParams.get("sslmode");
  if (!PROJECT_REF.test(targetProjectRef ?? "")
      || !["postgres:", "postgresql:"].includes(url.protocol)
      || url.hostname.toLowerCase() !== expectedHost
      || url.port !== "5432"
      || username !== "postgres"
      || !validDatabasePassword(password)
      || url.pathname !== "/postgres"
      || url.hash
      || (sslMode !== "verify-full" && sslMode !== "require")
      || [...url.searchParams.keys()].some((key) => key !== "sslmode")) {
    blocked(code, "database URL is not the direct TLS target for the disposable project");
  }
  return {
    host: expectedHost,
    port: 5432,
    database: "postgres",
    username: "postgres",
    password,
    sslMode,
  };
}

export function buildHostedRestoreReceiptWithProvenance({
  baseReceipt,
  projectRawText,
  projectRawEvidenceFileName,
  databaseProbeRawText,
  databaseProbeRawEvidenceFileName,
  databaseHost,
  targetProjectName,
  databaseProbeSql = HOSTED_RESTORE_READ_ONLY_PROBE_SQL,
  expectedTables = AMORA_POST_EXPAND_TABLES,
  expectedMigrationVersions = AMORA_RELEASE_MIGRATION_VERSIONS,
  sourceDatabaseSystemIdentifier = productionDatabaseSystemIdentifier(
    baseReceipt?.sourceProjectRef,
  ),
  now = () => new Date(),
}) {
  if (!baseReceipt || typeof baseReceipt !== "object" || Array.isArray(baseReceipt)
      || baseReceipt.sourceProjectRef === baseReceipt.targetProjectRef
      || databaseHost !== `db.${baseReceipt.targetProjectRef}.supabase.co`) {
    blocked("HOSTED_RESTORE_RECEIPT_INVALID", "hosted restore base receipt is not isolated");
  }
  const project = validateSupabaseProjectRaw(
    projectRawText,
    baseReceipt.targetProjectRef,
    targetProjectName,
  );
  const probe = parseDatabaseProbeRaw(databaseProbeRawText, {
    expectedTables,
    expectedMigrationVersions,
    expectedLiveSchemaContractSha256:
      baseReceipt.sourceLiveSchemaContractSha256,
    expectedLogicalDataContractSha256:
      baseReceipt.sourceLogicalDataContractSha256,
    sourceDatabaseSystemIdentifier,
    sourceProjectRef: baseReceipt.sourceProjectRef,
    targetProjectRef: baseReceipt.targetProjectRef,
  });
  if (baseReceipt.targetTableContractSha256
        !== AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256
      || baseReceipt.targetReleaseMigrationContractSha256
        !== AMORA_RELEASE_MIGRATION_CONTRACT_SHA256
      || !exactArray(baseReceipt.targetTables, expectedTables)
      || !exactArray(
        baseReceipt.targetReleaseMigrationVersions,
        expectedMigrationVersions,
      )
      || !UPPER_SHA256.test(baseReceipt.sourceLiveSchemaContractSha256 ?? "")
      || baseReceipt.targetLiveSchemaContractSha256
        !== baseReceipt.sourceLiveSchemaContractSha256
      || !UPPER_SHA256.test(baseReceipt.sourceLogicalDataContractSha256 ?? "")
      || baseReceipt.targetLogicalDataContractSha256
        !== baseReceipt.sourceLogicalDataContractSha256
      || probe.raw.liveSchemaContractSha256
        !== baseReceipt.targetLiveSchemaContractSha256
      || probe.raw.logicalDataContractSha256
        !== baseReceipt.targetLogicalDataContractSha256
      || !exactKeys(
        baseReceipt.checks,
        POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
      )
      || POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS.some(
        (check) => baseReceipt.checks[check] !== probe.raw.checks[check],
      )
      || parseCanonicalInstant(baseReceipt.verifiedAt) === null
      || probe.raw.checkedAt !== baseReceipt.verifiedAt) {
    blocked("HOSTED_RESTORE_RECEIPT_INVALID", "hosted restore receipt differs from its live probe");
  }
  return {
    ...baseReceipt,
    provenance: {
      collector: "supabase-management-api-postgres-read-only-v1",
      disposableTargetConfirmed: true,
      targetProjectName,
      projectApiRawEvidenceFileName: safeEvidenceFileName(
        projectRawEvidenceFileName,
        "HOSTED_RESTORE_RECEIPT_INVALID",
      ),
      projectApiRawEvidenceSha256: project.rawSha256,
      databaseHost,
      databaseProbeRawEvidenceFileName: safeEvidenceFileName(
        databaseProbeRawEvidenceFileName,
        "HOSTED_RESTORE_RECEIPT_INVALID",
      ),
      databaseProbeRawEvidenceSha256: probe.rawSha256,
      databaseProbeSqlSha256: externalGateSha256(databaseProbeSql),
      logicalDataProbeSqlSha256:
        HOSTED_RESTORE_LOGICAL_DATA_PROBE_SQL_SHA256,
      liveSchemaContractSha256: probe.raw.liveSchemaContractSha256,
      logicalDataContractSha256: probe.raw.logicalDataContractSha256,
      transactionReadOnly: true,
    },
  };
}

export function validateHostedRestoreReceiptProvenance({
  receipt,
  projectRawText,
  databaseProbeRawText,
  expected,
}) {
  const code = "HOSTED_RESTORE_RECEIPT_PROVENANCE_INVALID";
  const keys = [
    "collector",
    "disposableTargetConfirmed",
    "targetProjectName",
    "projectApiRawEvidenceFileName",
    "projectApiRawEvidenceSha256",
    "databaseHost",
    "databaseProbeRawEvidenceFileName",
    "databaseProbeRawEvidenceSha256",
    "databaseProbeSqlSha256",
    "logicalDataProbeSqlSha256",
    "liveSchemaContractSha256",
    "logicalDataContractSha256",
    "transactionReadOnly",
  ];
  const provenance = receipt?.provenance;
  const sourceDatabaseSystemIdentifier =
    expected.sourceDatabaseSystemIdentifier
    ?? productionDatabaseSystemIdentifier(receipt?.sourceProjectRef);
  if (!exactKeys(provenance, keys)
      || provenance.collector
        !== "supabase-management-api-postgres-read-only-v1"
      || provenance.disposableTargetConfirmed !== true
      || !DISPOSABLE_RESTORE_PROJECT_NAME.test(
        provenance.targetProjectName ?? "",
      )
      || provenance.transactionReadOnly !== true
      || provenance.databaseHost !== `db.${receipt.targetProjectRef}.supabase.co`
      || provenance.databaseProbeSqlSha256
        !== externalGateSha256(HOSTED_RESTORE_READ_ONLY_PROBE_SQL)
      || provenance.logicalDataProbeSqlSha256
        !== HOSTED_RESTORE_LOGICAL_DATA_PROBE_SQL_SHA256
      || provenance.liveSchemaContractSha256
        !== receipt.targetLiveSchemaContractSha256
      || provenance.logicalDataContractSha256
        !== receipt.targetLogicalDataContractSha256
      || !SHA256.test(provenance.projectApiRawEvidenceSha256 ?? "")
      || !SHA256.test(provenance.databaseProbeRawEvidenceSha256 ?? "")
      || provenance.projectApiRawEvidenceSha256
        !== externalGateSha256(projectRawText)
      || provenance.databaseProbeRawEvidenceSha256
        !== externalGateSha256(databaseProbeRawText)) {
    blocked(code, "hosted restore provenance is incomplete or altered");
  }
  validateSupabaseProjectRaw(
    projectRawText,
    receipt.targetProjectRef,
    provenance.targetProjectName,
  );
  const probe = parseDatabaseProbeRaw(databaseProbeRawText, {
    expectedTables: expected.expectedTables,
    expectedMigrationVersions: expected.expectedMigrationVersions,
    expectedLiveSchemaContractSha256:
      receipt.sourceLiveSchemaContractSha256,
    expectedLogicalDataContractSha256:
      receipt.sourceLogicalDataContractSha256,
    sourceDatabaseSystemIdentifier,
    sourceProjectRef: receipt.sourceProjectRef,
    targetProjectRef: receipt.targetProjectRef,
  });
  if (receipt.sourceProjectRef === receipt.targetProjectRef
      || receipt.targetLiveSchemaContractSha256
        !== receipt.sourceLiveSchemaContractSha256
      || receipt.targetLogicalDataContractSha256
        !== receipt.sourceLogicalDataContractSha256
      || !exactKeys(
        receipt.checks,
        POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
      )
      || POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS.some(
        (check) => receipt.checks[check] !== probe.raw.checks[check],
      )
      || probe.raw.checkedAt !== receipt.verifiedAt) {
    blocked(code, "hosted restore target or probe timestamp is not bound");
  }
  return probe;
}

async function safeResponseText(response, maximumBytes, code) {
  if (!response
      || typeof response.text !== "function"
      || !Number.isSafeInteger(response.status)
      || response.status < 100
      || response.status > 599) {
    blocked(code, "HTTP response is malformed");
  }
  let text;
  try {
    text = await response.text();
  } catch {
    blocked(code, "HTTP response body could not be read");
  }
  if (typeof text !== "string") {
    blocked(code, "HTTP response body is malformed");
  }
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    blocked(code, "HTTP response exceeded the evidence size limit");
  }
  return text;
}

function selectedHeader(response, name) {
  const value = response.headers?.get?.(name);
  return typeof value === "string" ? value.trim() : "";
}

async function observeHttpProbe({
  fetchImpl,
  origin,
  expectedCommit,
  probe,
  phase,
  now,
}) {
  const startedAt = readClock(now, "CANARY_CLOCK_INVALID");
  let response;
  try {
    response = await fetchImpl(`${origin}${probe.path}`, {
      method: probe.method,
      redirect: "manual",
      headers: probe.method === "POST"
        ? { "content-type": "application/json" }
        : undefined,
      body: probe.method === "POST" ? "{}" : undefined,
    });
  } catch {
    blocked("CANARY_HTTP_OBSERVATION_FAILED", "production HTTP probe failed");
  }
  const bodyText = await safeResponseText(
    response,
    probe.id === "public-home" ? 2 * 1024 * 1024 : 16 * 1024,
    "CANARY_HTTP_OBSERVATION_FAILED",
  );
  const completedAt = readClock(now, "CANARY_CLOCK_INVALID");
  let finalUrl;
  try {
    finalUrl = new URL(response.url || `${origin}${probe.path}`);
  } catch {
    blocked("CANARY_HOST_MISMATCH", "production probe returned an invalid URL");
  }
  const expectedOrigin = new URL(origin);
  if (finalUrl.origin !== expectedOrigin.origin
      || finalUrl.pathname !== probe.path
      || finalUrl.search
      || finalUrl.hash
      || completedAt.getTime() < startedAt.getTime()) {
    blocked("CANARY_HOST_MISMATCH", "production probe escaped the expected origin");
  }
  const deploymentCommit = selectedHeader(
    response,
    "x-hanbang-deployment-commit",
  );
  let passed;
  let errorCode = null;
  if (probe.expectedStatus === "success") {
    passed = response.status >= 200 && response.status < 300;
  } else {
    try {
      errorCode = JSON.parse(bodyText).error ?? null;
    } catch {
      errorCode = null;
    }
    passed = response.status === probe.expectedStatus
      && errorCode === "production_write_fence_enabled"
      && deploymentCommit === expectedCommit
      && /(?:^|,)\s*no-store\s*(?:,|$)/i.test(
        selectedHeader(response, "cache-control"),
      );
  }
  if (!passed) {
    blocked("CANARY_HTTP_OBSERVATION_FAILED", "production HTTP fence observation failed");
  }
  return {
    id: `${phase}:${probe.id}`,
    phase,
    method: probe.method,
    path: probe.path,
    finalUrl: finalUrl.toString(),
    status: response.status,
    bodySha256: externalGateSha256(bodyText),
    errorCode,
    deploymentCommit: deploymentCommit || null,
    cacheControl: selectedHeader(response, "cache-control") || null,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    passed: true,
  };
}

export function buildProductionFenceReadOnlyProbeSql({ projectRef }) {
  if (!PROJECT_REF.test(projectRef ?? "")) {
    blocked("CANARY_DB_PROBE_CONFIG_INVALID", "production project ref is invalid");
  }
  return `BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT json_build_object(
  'probeVersion', 1,
  'transactionReadOnly', current_setting('transaction_read_only') = 'on',
  'databaseName', current_database(),
  'projectRef', ${sqlLiteral(projectRef)},
  'databaseSystemIdentifier', (
    SELECT system_identifier::text FROM pg_catalog.pg_control_system()
  ),
  'productionWriteFenceVerifiedCount', CASE WHEN
    (SELECT count(*)
     FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')) > 0
    AND (SELECT count(*)
         FROM pg_catalog.pg_trigger trigger_record
         JOIN pg_catalog.pg_class relation ON relation.oid = trigger_record.tgrelid
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relkind IN ('r', 'p')
           AND trigger_record.tgname = 'trg_production_write_fence_20260717'
           AND NOT trigger_record.tgisinternal
           AND trigger_record.tgenabled = 'O'
           AND trigger_record.tgtype = 62
           AND trigger_record.tgfoid =
             'public.production_write_fence_guard_20260717()'::regprocedure)
        = (SELECT count(*)
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = 'public'
             AND relation.relkind IN ('r', 'p'))
    AND to_regprocedure('public.production_write_fence_guard_20260717()') IS NOT NULL
    AND to_regprocedure('public.production_write_fence_attach_20260717()') IS NOT NULL
    AND (SELECT count(*) FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'production_write_fence_guard_20260717'
           AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
           AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
           AND NOT p.prosecdef
           AND p.proconfig IS NOT DISTINCT FROM
             ARRAY['search_path=pg_catalog, auth']::text[]
           AND pg_catalog.md5(p.prosrc) = 'e9dc644c0ad98b742bde0e3c83c26f93'
           AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) = 1
    AND (SELECT count(*) FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'production_write_fence_attach_20260717'
           AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
           AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
           AND NOT p.prosecdef
           AND p.proconfig IS NOT DISTINCT FROM
             ARRAY['search_path=pg_catalog, public']::text[]
           AND pg_catalog.md5(p.prosrc) = '9053c6d394854777b878bd219203b06a'
           AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) = 1
    AND (SELECT count(*) FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_catalog.pg_language l ON l.oid = p.prolang
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
           AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
           AND pg_catalog.md5(p.prosrc) = '96ee93c897faa81bae68c8c65e29610b'
           AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) = 1
    AND (SELECT count(*) FROM pg_catalog.pg_event_trigger
         WHERE evtfoid =
           'public.production_write_fence_attach_20260717()'::regprocedure) = 2
    AND (SELECT count(*) FROM pg_catalog.pg_event_trigger
         WHERE evtname = 'evt_production_write_fence_20260717'
           AND evtevent = 'ddl_command_end'
           AND evtenabled = 'O'
           AND evttags IS NULL
           AND pg_catalog.pg_get_userbyid(evtowner) = 'postgres'
           AND evtfoid =
             'public.production_write_fence_attach_20260717()'::regprocedure) = 1
    AND (SELECT count(*) FROM pg_catalog.pg_event_trigger
         WHERE evtname = 'evt_production_write_fence_ddl_lock_20260717'
           AND evtevent = 'ddl_command_start'
           AND evtenabled = 'O'
           AND evttags IS NULL
           AND pg_catalog.pg_get_userbyid(evtowner) = 'postgres'
           AND evtfoid =
             'public.production_write_fence_attach_20260717()'::regprocedure) = 1
  THEN 1 ELSE 0 END,
  'checkedAt', to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
ROLLBACK;`;
}

function validateBrowserCanaryObservation(value, expected) {
  const code = "CANARY_BROWSER_EVIDENCE_INVALID";
  const keys = [
    "evidenceVersion",
    "runner",
    "expectedHost",
    "pagePath",
    "finalUrl",
    "status",
    "consoleErrorHashes",
    "pageErrorHashes",
    "requestFailureHashes",
    "navigationDurationMs",
    "startedAt",
    "completedAt",
    "containsSecrets",
  ];
  const startedAt = parseCanonicalInstant(value?.startedAt);
  const completedAt = parseCanonicalInstant(value?.completedAt);
  const hashArrays = [
    value?.consoleErrorHashes,
    value?.pageErrorHashes,
    value?.requestFailureHashes,
  ];
  if (!exactKeys(value, keys)
      || value.evidenceVersion !== 1
      || value.runner !== "playwright-core-public-v1"
      || value.expectedHost !== expected.expectedHost
      || value.pagePath !== "/wedding"
      || value.status < 200
      || value.status >= 300
      || hashArrays.some((entries) =>
        !Array.isArray(entries)
        || entries.length > 100
        || entries.some((entry) => !SHA256.test(entry ?? "")))
      || !Number.isSafeInteger(value.navigationDurationMs)
      || value.navigationDurationMs < 0
      || value.navigationDurationMs > 120_000
      || startedAt === null
      || completedAt === null
      || completedAt < startedAt
      || completedAt - startedAt !== value.navigationDurationMs
      || value.containsSecrets !== false) {
    blocked(code, "browser evidence is malformed or did not load production");
  }
  exactHttpsUrl(value.finalUrl, expected.expectedHost, "/wedding", code);
  return value;
}

function validateAuthenticatedSessionObservation(value, expected) {
  const code = "CANARY_AUTH_EVIDENCE_INVALID";
  const keys = [
    "evidenceVersion",
    "runner",
    "projectRef",
    "userIdSha256",
    "loginStatus",
    "authenticatedReadStatus",
    "authenticatedReadRowCount",
    "logoutStatus",
    "refreshAfterLogoutStatus",
    "startedAt",
    "completedAt",
    "containsSecrets",
  ];
  const startedAt = parseCanonicalInstant(value?.startedAt);
  const completedAt = parseCanonicalInstant(value?.completedAt);
  if (!exactKeys(value, keys)
      || value.evidenceVersion !== 1
      || value.runner !== "supabase-auth-rest-v1"
      || value.projectRef !== expected.projectRef
      || !SHA256.test(value.userIdSha256 ?? "")
      || value.loginStatus !== 200
      || value.authenticatedReadStatus !== 200
      || value.authenticatedReadRowCount !== 1
      || ![200, 204].includes(value.logoutStatus)
      || ![400, 401].includes(value.refreshAfterLogoutStatus)
      || startedAt === null
      || completedAt === null
      || completedAt < startedAt
      || value.containsSecrets !== false) {
    blocked(code, "authenticated login/read/logout evidence is invalid");
  }
  return value;
}

function validateProductionFenceObservation(value, expected) {
  const code = "CANARY_DATABASE_FENCE_EVIDENCE_INVALID";
  const keys = [
    "probeVersion",
    "transactionReadOnly",
    "databaseName",
    "projectRef",
    "databaseSystemIdentifier",
    "productionWriteFenceVerifiedCount",
    "checkedAt",
    "probeSqlSha256",
  ];
  const expectedSqlSha256 = externalGateSha256(
    buildProductionFenceReadOnlyProbeSql({ projectRef: expected.projectRef }),
  );
  if (!exactKeys(value, keys)
      || value.probeVersion !== 1
      || value.transactionReadOnly !== true
      || value.databaseName !== "postgres"
      || value.projectRef !== expected.projectRef
      || value.databaseSystemIdentifier !== expected.databaseSystemIdentifier
      || value.productionWriteFenceVerifiedCount !== 1
      || parseCanonicalInstant(value.checkedAt) === null
      || value.probeSqlSha256 !== expectedSqlSha256) {
    blocked(code, "production database fence evidence is invalid");
  }
  return value;
}

function validateVercelServerErrorRawEvidence(rawText) {
  const code = "CANARY_VERCEL_SERVER_ERROR_EVIDENCE_INVALID";
  if (typeof rawText !== "string"
      || Buffer.byteLength(rawText, "utf8") < 2
      || Buffer.byteLength(rawText, "utf8")
        > MAX_VERCEL_SERVER_ERROR_EVIDENCE_BYTES) {
    blocked(code, "Vercel server-error evidence size is invalid");
  }
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    blocked(code, "Vercel server-error evidence is not JSON");
  }
  if (!Array.isArray(raw) || raw.length !== 0) {
    blocked(code, "Vercel reported one or more production 5xx events");
  }
  return { raw, rawSha256: externalGateSha256(rawText) };
}

function deriveCanaryChecks(raw, expected) {
  const publicObservations = raw.observations.filter(
    (observation) => observation.path === "/wedding",
  );
  const fenceObservations = raw.observations.filter(
    (observation) => observation.path === "/api/release/write-fence-probe",
  );
  const signupObservations = raw.observations.filter(
    (observation) => observation.path === "/api/auth/signup",
  );
  const storageObservations = raw.observations.filter(
    (observation) => observation.path === "/api/community/upload",
  );
  const exactFence = (observations) => observations.length === 2
    && observations.every((observation) =>
      observation.status === 503
      && observation.errorCode === "production_write_fence_enabled"
      && observation.deploymentCommit === expected.expectedCommit);
  const browserClean = raw.browser.consoleErrorHashes.length === 0
    && raw.browser.pageErrorHashes.length === 0
    && raw.browser.requestFailureHashes.length === 0;
  const latencyWithinBaseline = raw.browser.navigationDurationMs
      <= CANARY_BROWSER_LATENCY_BUDGET_MS
    && raw.observations.every((observation) =>
      observation.durationMs <= CANARY_HTTP_LATENCY_BUDGET_MS);
  const noUnexpected5xx = publicObservations.every(
    (observation) => observation.status < 500,
  ) && raw.vercelServerErrorRawEvidenceSha256
    === expected.vercelServerErrorRawEvidenceSha256;
  return {
    authenticatedReadPassed:
      raw.authenticatedSession.authenticatedReadStatus === 200
      && raw.authenticatedSession.authenticatedReadRowCount === 1,
    browserConsoleClean: browserClean,
    databaseFenceStillVerified:
      raw.databaseFence.productionWriteFenceVerifiedCount === 1
      && raw.databaseFence.transactionReadOnly === true,
    deployedCommitMatched: [
      ...fenceObservations,
      ...signupObservations,
      ...storageObservations,
    ].every((observation) =>
      observation.deploymentCommit === expected.expectedCommit),
    deploymentReady: expected.deploymentReady === true,
    latencyWithinBaseline,
    loginLogoutPassed:
      raw.authenticatedSession.loginStatus === 200
      && [200, 204].includes(raw.authenticatedSession.logoutStatus)
      && [400, 401].includes(
        raw.authenticatedSession.refreshAfterLogoutStatus,
      ),
    noUnexpected5xx,
    publicReadPassed: publicObservations.length === 2
      && publicObservations.every((observation) =>
        observation.status >= 200 && observation.status < 300),
    serverErrorsWithinBaseline: noUnexpected5xx,
    signupStillDisabled: exactFence(signupObservations),
    storageHelperClosed: exactFence(storageObservations),
    webWriteFenceStillEnabled: exactFence(fenceObservations),
  };
}

function validateCanaryRawEvidence(rawText, vercelServerErrorRawText, expected) {
  const code = "CANARY_RAW_EVIDENCE_INVALID";
  const raw = parseBoundedJson(rawText, MAX_PROBE_RAW_BYTES, code);
  const keys = [
    "evidenceVersion",
    "kind",
    "runner",
    "expectedHost",
    "expectedCommit",
    "requiredChecks",
    "requiredChecksSha256",
    "deploymentRawEvidenceSha256",
    "observationStartedAt",
    "verifiedAt",
    "observationWindowSeconds",
    "observations",
    "browser",
    "authenticatedSession",
    "databaseFence",
    "vercelServerErrorRawEvidenceSha256",
    "checks",
    "containsSecrets",
  ];
  const expectedHost = canonicalHost(expected.expectedHost, code);
  const expectedChecks = expected.requiredChecks;
  const expectedObservations = ["start", "finish"].flatMap((phase) =>
    CANARY_HTTP_PROBES.map((probe) => ({ phase, probe })));
  const observationKeys = [
    "id",
    "phase",
    "method",
    "path",
    "finalUrl",
    "status",
    "bodySha256",
    "errorCode",
    "deploymentCommit",
    "cacheControl",
    "startedAt",
    "completedAt",
    "durationMs",
    "passed",
  ];
  const vercelServerErrors = validateVercelServerErrorRawEvidence(
    vercelServerErrorRawText,
  );
  if (!exactKeys(raw, keys)
      || raw.evidenceVersion !== 1
      || raw.kind !== "production-canary-http-observations"
      || raw.runner !== "hanbang-production-canary-v1"
      || raw.expectedHost !== expectedHost
      || raw.expectedCommit !== expected.expectedCommit
      || !exactArray(raw.requiredChecks, expectedChecks)
      || raw.requiredChecksSha256 !== requiredChecksSha256(expectedChecks)
      || raw.deploymentRawEvidenceSha256
        !== expected.deploymentRawEvidenceSha256
      || !SHA256.test(raw.deploymentRawEvidenceSha256 ?? "")
      || parseCanonicalInstant(raw.observationStartedAt) === null
      || parseCanonicalInstant(raw.verifiedAt) === null
      || !Number.isSafeInteger(raw.observationWindowSeconds)
      || raw.observationWindowSeconds < 300
      || raw.observationWindowSeconds > 3_600
      || Date.parse(raw.verifiedAt) - Date.parse(raw.observationStartedAt)
        !== raw.observationWindowSeconds * 1_000
      || !Array.isArray(raw.observations)
      || raw.observations.length !== expectedObservations.length
      || raw.vercelServerErrorRawEvidenceSha256
        !== vercelServerErrors.rawSha256
      || raw.containsSecrets !== false) {
    blocked(code, "canary raw evidence is incomplete, mismatched or altered");
  }
  let previousCompletedAt = Date.parse(raw.observationStartedAt);
  for (const [index, observation] of raw.observations.entries()) {
    const expectedObservation = expectedObservations[index];
    const { phase, probe } = expectedObservation;
    const startedAt = parseCanonicalInstant(observation?.startedAt);
    const completedAt = parseCanonicalInstant(observation?.completedAt);
    if (!exactKeys(observation, observationKeys)
        || observation.id !== `${phase}:${probe.id}`
        || observation.phase !== phase
        || observation.method !== probe.method
        || observation.path !== probe.path
        || observation.passed !== true
        || !Number.isSafeInteger(observation.status)
        || observation.status < 100
        || observation.status > 599
        || !Number.isSafeInteger(observation.durationMs)
        || observation.durationMs < 0
        || observation.durationMs > 120_000
        || !SHA256.test(observation.bodySha256 ?? "")
        || startedAt === null
        || completedAt === null
        || completedAt < startedAt
        || completedAt - startedAt !== observation.durationMs
        || startedAt < previousCompletedAt
        || (observation.errorCode !== null
          && typeof observation.errorCode !== "string")
        || (observation.deploymentCommit !== null
          && typeof observation.deploymentCommit !== "string")
        || (observation.cacheControl !== null
          && typeof observation.cacheControl !== "string")) {
      blocked(code, "canary observation shape, identity or timing is invalid");
    }
    exactHttpsUrl(observation.finalUrl, expectedHost, probe.path, code);
    if (phase === "start" && completedAt > Date.parse(raw.verifiedAt)) {
      blocked(code, "start observation crossed the canary boundary");
    }
    if (phase === "finish" && startedAt < Date.parse(raw.verifiedAt)) {
      blocked(code, "finish observation occurred before the canary boundary");
    }
    if (probe.expectedStatus === "success") {
      if (observation.status < 200 || observation.status >= 300
          || observation.errorCode !== null) {
        blocked(code, "public canary observation failed");
      }
    } else if (observation.status !== 503
        || observation.errorCode !== "production_write_fence_enabled"
        || observation.deploymentCommit !== expected.expectedCommit
        || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(observation.cacheControl ?? "")) {
      blocked(code, "write-fence canary observation failed");
    }
    previousCompletedAt = completedAt;
  }
  validateBrowserCanaryObservation(raw.browser, { expectedHost });
  validateAuthenticatedSessionObservation(raw.authenticatedSession, {
    projectRef: expected.projectRef,
  });
  validateProductionFenceObservation(raw.databaseFence, {
    projectRef: expected.projectRef,
    databaseSystemIdentifier: expected.databaseSystemIdentifier,
  });
  const canaryStartedAt = Date.parse(raw.observationStartedAt);
  const lastObservationCompletedAt = parseCanonicalInstant(
    raw.observations.at(-1).completedAt,
  );
  if (parseCanonicalInstant(raw.browser.startedAt) < canaryStartedAt
      || parseCanonicalInstant(raw.browser.completedAt)
        > lastObservationCompletedAt
      || parseCanonicalInstant(raw.authenticatedSession.startedAt)
        < canaryStartedAt
      || parseCanonicalInstant(raw.authenticatedSession.completedAt)
        > lastObservationCompletedAt
      || parseCanonicalInstant(raw.databaseFence.checkedAt) < canaryStartedAt
      || parseCanonicalInstant(raw.databaseFence.checkedAt)
        > lastObservationCompletedAt) {
    blocked(code, "auxiliary canary evidence escaped the observation window");
  }
  const derivedChecks = deriveCanaryChecks(raw, {
    expectedCommit: expected.expectedCommit,
    deploymentReady: expected.deploymentReady,
    vercelServerErrorRawEvidenceSha256: vercelServerErrors.rawSha256,
  });
  safeChecks(derivedChecks, expectedChecks, code);
  if (!exactKeys(raw.checks, expectedChecks)
      || expectedChecks.some(
        (check) => raw.checks[check] !== derivedChecks[check],
      )) {
    blocked(code, "canary check map was not derived from raw observations");
  }
  return { raw, rawSha256: externalGateSha256(rawText) };
}

export async function runProductionCanaryHttpEvidence({
  fetchImpl = globalThis.fetch,
  expectedHost,
  expectedCommit,
  deploymentRawEvidenceSha256,
  projectRef,
  databaseSystemIdentifier,
  deploymentReady,
  browserRunner,
  authenticatedSessionRunner,
  databaseFenceRunner,
  vercelServerErrorRunner,
  requiredChecks = PRODUCTION_CANARY_REQUIRED_CHECKS,
  observationWindowSeconds = 300,
  now = () => new Date(),
  wait = (milliseconds) => new Promise((resolveWait) =>
    setTimeout(resolveWait, milliseconds)),
}) {
  const host = canonicalHost(expectedHost, "CANARY_TARGET_INVALID");
  if (typeof fetchImpl !== "function"
      || typeof now !== "function"
      || typeof wait !== "function"
      || typeof browserRunner !== "function"
      || typeof authenticatedSessionRunner !== "function"
      || typeof databaseFenceRunner !== "function"
      || typeof vercelServerErrorRunner !== "function"
      || !COMMIT.test(expectedCommit ?? "")
      || !SHA256.test(deploymentRawEvidenceSha256 ?? "")
      || !PROJECT_REF.test(projectRef ?? "")
      || !/^\d{10,32}$/.test(databaseSystemIdentifier ?? "")
      || deploymentReady !== true
      || !exactArray(requiredChecks, PRODUCTION_CANARY_REQUIRED_CHECKS)
      || !Number.isSafeInteger(observationWindowSeconds)
      || observationWindowSeconds < 300
      || observationWindowSeconds > 3_600) {
    blocked("CANARY_TARGET_INVALID", "canary target or contract is invalid");
  }
  const origin = `https://${host}`;
  const observationStartedAt = readClock(now, "CANARY_CLOCK_INVALID");
  const observations = [];
  for (const probe of CANARY_HTTP_PROBES) {
    observations.push(await observeHttpProbe({
      fetchImpl,
      origin,
      expectedCommit,
      probe,
      phase: "start",
      now,
    }));
  }
  const runnerContext = {
    origin,
    expectedHost: host,
    expectedCommit,
    projectRef,
    databaseSystemIdentifier,
    observationStartedAt: observationStartedAt.toISOString(),
    now,
  };
  const browser = await browserRunner(runnerContext);
  const authenticatedSession = await authenticatedSessionRunner(runnerContext);
  const databaseFence = await databaseFenceRunner(runnerContext);
  await wait(observationWindowSeconds * 1_000);
  const verifiedAt = new Date(
    observationStartedAt.getTime() + observationWindowSeconds * 1_000,
  );
  for (const probe of CANARY_HTTP_PROBES) {
    observations.push(await observeHttpProbe({
      fetchImpl,
      origin,
      expectedCommit,
      probe,
      phase: "finish",
      now,
    }));
  }
  const lastObservationCompletedAt = observations.at(-1).completedAt;
  const vercelServerErrorRawText = await vercelServerErrorRunner({
    ...runnerContext,
    verifiedAt: verifiedAt.toISOString(),
    observationCompletedAt: lastObservationCompletedAt,
  });
  const vercelServerErrors = validateVercelServerErrorRawEvidence(
    vercelServerErrorRawText,
  );
  const raw = {
    evidenceVersion: 1,
    kind: "production-canary-http-observations",
    runner: "hanbang-production-canary-v1",
    expectedHost: host,
    expectedCommit,
    requiredChecks: [...requiredChecks],
    requiredChecksSha256: requiredChecksSha256(requiredChecks),
    deploymentRawEvidenceSha256,
    observationStartedAt: observationStartedAt.toISOString(),
    verifiedAt: verifiedAt.toISOString(),
    observationWindowSeconds,
    observations,
    browser,
    authenticatedSession,
    databaseFence,
    vercelServerErrorRawEvidenceSha256: vercelServerErrors.rawSha256,
    checks: null,
    containsSecrets: false,
  };
  raw.checks = deriveCanaryChecks(raw, {
    expectedCommit,
    deploymentReady,
    vercelServerErrorRawEvidenceSha256: vercelServerErrors.rawSha256,
  });
  const rawText = `${JSON.stringify(raw, null, 2)}\n`;
  validateCanaryRawEvidence(rawText, vercelServerErrorRawText, {
    expectedHost: host,
    expectedCommit,
    deploymentRawEvidenceSha256,
    requiredChecks,
    projectRef,
    databaseSystemIdentifier,
    deploymentReady,
  });
  return {
    raw,
    rawText,
    rawSha256: externalGateSha256(rawText),
    vercelServerErrorRawText,
    vercelServerErrorRawSha256: vercelServerErrors.rawSha256,
  };
}

export function buildProductionCanaryReceiptWithProvenance({
  baseReceipt,
  rawText,
  rawEvidenceFileName,
  vercelServerErrorRawText,
  vercelServerErrorRawEvidenceFileName,
  expectedHost,
  expectedCommit,
  deploymentRawEvidenceSha256,
  databaseSystemIdentifier,
  requiredChecks = PRODUCTION_CANARY_REQUIRED_CHECKS,
  canaryMaximumAgeMinutes = 15,
}) {
  const evidence = validateCanaryRawEvidence(rawText, vercelServerErrorRawText, {
    expectedHost,
    expectedCommit,
    deploymentRawEvidenceSha256,
    requiredChecks,
    projectRef: baseReceipt.projectRef,
    databaseSystemIdentifier,
    deploymentReady: true,
  });
  const vercelServerErrors = validateVercelServerErrorRawEvidence(
    vercelServerErrorRawText,
  );
  const expectedExpiresAt = new Date(
    Date.parse(evidence.raw.verifiedAt) + canaryMaximumAgeMinutes * 60_000,
  ).toISOString();
  if (!Number.isSafeInteger(canaryMaximumAgeMinutes)
      || canaryMaximumAgeMinutes !== 15
      || baseReceipt.releaseCommit !== expectedCommit
      || baseReceipt.observationStartedAt !== evidence.raw.observationStartedAt
      || baseReceipt.verifiedAt !== evidence.raw.verifiedAt
      || baseReceipt.expiresAt !== expectedExpiresAt
      || baseReceipt.observationWindowSeconds
        !== evidence.raw.observationWindowSeconds
      || safeChecks(baseReceipt.checks, requiredChecks, "CANARY_RECEIPT_INVALID")
        !== baseReceipt.checks) {
    blocked("CANARY_RECEIPT_INVALID", "canary receipt differs from HTTP observations");
  }
  return {
    ...baseReceipt,
    provenance: {
      runner: "hanbang-production-canary-v1",
      expectedHost: canonicalHost(expectedHost, "CANARY_RECEIPT_INVALID"),
      expectedCommit,
      requiredChecksSha256: requiredChecksSha256(requiredChecks),
      deploymentRawEvidenceSha256,
      rawHttpObservationsFileName: safeEvidenceFileName(
        rawEvidenceFileName,
        "CANARY_RECEIPT_INVALID",
      ),
      rawHttpObservationsSha256: evidence.rawSha256,
      vercelServerErrorRawEvidenceFileName: safeEvidenceFileName(
        vercelServerErrorRawEvidenceFileName,
        "CANARY_RECEIPT_INVALID",
      ),
      vercelServerErrorRawEvidenceSha256: vercelServerErrors.rawSha256,
    },
  };
}

export function validateProductionCanaryReceiptProvenance({
  receipt,
  rawText,
  expected,
}) {
  const code = "CANARY_RECEIPT_PROVENANCE_INVALID";
  const keys = [
    "runner",
    "expectedHost",
    "expectedCommit",
    "requiredChecksSha256",
    "deploymentRawEvidenceSha256",
    "rawHttpObservationsFileName",
    "rawHttpObservationsSha256",
    "vercelServerErrorRawEvidenceFileName",
    "vercelServerErrorRawEvidenceSha256",
  ];
  const provenance = receipt?.provenance;
  if (!exactKeys(provenance, keys)
      || provenance.runner !== "hanbang-production-canary-v1"
      || provenance.expectedHost !== canonicalHost(expected.expectedHost, code)
      || provenance.expectedCommit !== expected.expectedCommit
      || provenance.requiredChecksSha256
        !== requiredChecksSha256(expected.requiredChecks)
      || provenance.deploymentRawEvidenceSha256
        !== expected.deploymentRawEvidenceSha256
      || provenance.rawHttpObservationsSha256
        !== externalGateSha256(rawText)
      || provenance.vercelServerErrorRawEvidenceSha256
        !== externalGateSha256(expected.vercelServerErrorRawText)) {
    blocked(code, "canary receipt provenance is incomplete or altered");
  }
  const evidence = validateCanaryRawEvidence(
    rawText,
    expected.vercelServerErrorRawText,
    {
    expectedHost: expected.expectedHost,
    expectedCommit: expected.expectedCommit,
    deploymentRawEvidenceSha256: expected.deploymentRawEvidenceSha256,
    requiredChecks: expected.requiredChecks,
      projectRef: receipt.projectRef,
      databaseSystemIdentifier: expected.databaseSystemIdentifier,
      deploymentReady: true,
    },
  );
  const expectedExpiresAt = new Date(
    Date.parse(evidence.raw.verifiedAt) + 15 * 60_000,
  ).toISOString();
  if (receipt.observationStartedAt !== evidence.raw.observationStartedAt
      || receipt.verifiedAt !== evidence.raw.verifiedAt
      || receipt.expiresAt !== expectedExpiresAt
      || receipt.observationWindowSeconds
        !== evidence.raw.observationWindowSeconds
      || safeChecks(receipt.checks, expected.requiredChecks, code)
        !== receipt.checks) {
    blocked(code, "canary receipt differs from raw HTTP observations");
  }
  return evidence;
}

async function ensureOutsideGitEvidencePath(path, repoRoot, code) {
  if (!isAbsolute(path)
      || inside(repoRoot, path)
      || !path.toLowerCase().endsWith(".json")) {
    blocked(code, "evidence path must be an absolute JSON path outside Git");
  }
  const parent = dirname(path);
  const parentMetadata = await lstat(parent).catch(() => null);
  const parentRealPath = await realpath(parent).catch(() => null);
  if (!parentMetadata?.isDirectory()
      || parentMetadata.isSymbolicLink()
      || !parentRealPath
      || inside(repoRoot, parentRealPath)) {
    blocked(code, "evidence parent must be an existing non-symlink directory outside Git");
  }
  if (await lstat(path).catch(() => null)) {
    blocked(code, "evidence output already exists");
  }
  return resolve(parentRealPath, basename(path));
}

async function writeExclusive(path, text, code) {
  const handle = await open(path, "wx", 0o600).catch(() => null);
  if (!handle) blocked(code, "evidence output could not be created exclusively");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeEvidenceFiles({ repoRoot, rawFiles, receiptPath, receipt }) {
  const allPaths = [...rawFiles.map((entry) => entry.path), receiptPath];
  const pathIdentities = allPaths.map((path) => {
    const resolved = resolve(path);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  });
  if (new Set(pathIdentities).size !== allPaths.length) {
    blocked("EVIDENCE_PATH_INVALID", "evidence paths must be distinct");
  }
  const canonicalPaths = [];
  for (const path of allPaths) {
    canonicalPaths.push(await ensureOutsideGitEvidencePath(
      path,
      repoRoot,
      "EVIDENCE_PATH_INVALID",
    ));
  }
  const created = [];
  try {
    for (const [index, raw] of rawFiles.entries()) {
      const path = canonicalPaths[index];
      await writeExclusive(path, raw.text, "EVIDENCE_WRITE_FAILED");
      created.push(path);
    }
    const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
    if (Buffer.byteLength(receiptText, "utf8") > MAX_RECEIPT_BYTES) {
      blocked("EVIDENCE_WRITE_FAILED", "receipt exceeded the size limit");
    }
    const canonicalReceiptPath = canonicalPaths.at(-1);
    await writeExclusive(
      canonicalReceiptPath,
      receiptText,
      "EVIDENCE_WRITE_FAILED",
    );
    created.push(canonicalReceiptPath);
  } catch (error) {
    for (const path of created) await rm(path, { force: true }).catch(() => {});
    throw error;
  }
  return receipt;
}

async function fetchJsonRaw({ fetchImpl, url, bearer, maximumBytes, code }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: { authorization: `Bearer ${bearer}` },
    });
  } catch {
    blocked(code, "provider API request failed");
  }
  if (response.status !== 200) blocked(code, "provider API returned a non-200 response");
  return await safeResponseText(response, maximumBytes, code);
}

export async function collectVercelDeploymentEvidence({
  repoRoot = process.cwd(),
  fetchImpl = globalThis.fetch,
  vercelToken,
  teamId,
  projectId,
  deploymentId,
  productionHost,
  release,
  projectRef,
  releaseCommit,
  rawEvidencePath,
  receiptPath,
  now = () => new Date(),
}) {
  if (!validBearerSecret(vercelToken)
      || typeof fetchImpl !== "function"
      || !VERCEL_TEAM_ID.test(teamId ?? "")
      || !VERCEL_PROJECT_ID.test(projectId ?? "")
      || !DEPLOYMENT_ID.test(deploymentId ?? "")
      || !PROJECT_REF.test(projectRef ?? "")
      || !COMMIT.test(releaseCommit ?? "")) {
    blocked("VERCEL_COLLECTOR_CONFIG_INVALID", "Vercel collector configuration is invalid");
  }
  canonicalHost(productionHost, "VERCEL_COLLECTOR_CONFIG_INVALID");
  const rawText = await fetchJsonRaw({
    fetchImpl,
    url: `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(teamId)}`,
    bearer: vercelToken,
    maximumBytes: MAX_PROVIDER_RAW_BYTES,
    code: "VERCEL_API_REQUEST_FAILED",
  });
  const receipt = buildVercelDeploymentReceipt({
    rawText,
    rawEvidenceFileName: basename(rawEvidencePath),
    release,
    projectRef,
    releaseCommit,
    teamId,
    projectId,
    deploymentId,
    productionHost,
    verifiedAt: now().toISOString(),
  });
  await writeEvidenceFiles({
    repoRoot,
    rawFiles: [{ path: rawEvidencePath, text: rawText }],
    receiptPath,
    receipt,
  });
  return receipt;
}

async function defaultRunPsql({
  psql,
  sql,
  connection,
  timeoutMs = 60_000,
  maximumStdoutBytes = MAX_PROBE_RAW_BYTES,
}) {
  if (!Number.isSafeInteger(maximumStdoutBytes)
      || maximumStdoutBytes < MAX_PROBE_RAW_BYTES
      || maximumStdoutBytes > 64 * 1024 * 1024) {
    blocked("PSQL_OUTPUT_LIMIT_INVALID", "psql output limit is invalid");
  }
  return await new Promise((resolveResult) => {
    const child = spawn(
      psql,
      [
        "--no-psqlrc",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--set=ON_ERROR_STOP=1",
        "--command",
        sql,
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PGHOST: connection.host,
          PGPORT: String(connection.port),
          PGDATABASE: connection.database,
          PGUSER: connection.username,
          PGPASSWORD: connection.password,
          PGSSLMODE: connection.sslMode,
          PGCONNECT_TIMEOUT: "10",
        },
      },
    );
    let stdout = "";
    let stderrBytes = 0;
    let outputTruncated = false;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout, "utf8") + chunk.length <= maximumStdoutBytes) {
        stdout += chunk.toString("utf8");
      } else {
        outputTruncated = true;
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolveResult({ status: null, stdout: "", stderrBytes, outputTruncated: true });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveResult({ status, stdout, stderrBytes, outputTruncated });
    });
  });
}

export async function runPlaywrightPublicCanaryObservation({
  origin,
  expectedHost,
  executablePath,
  now = () => new Date(),
  playwrightLoader = () => import("playwright-core"),
}) {
  if (typeof executablePath !== "string"
      || !isAbsolute(executablePath)
      || typeof playwrightLoader !== "function") {
    blocked(
      "CANARY_BROWSER_CONFIG_INVALID",
      "an explicit absolute browser executable is required",
    );
  }
  const startedAt = readClock(now, "CANARY_BROWSER_CLOCK_INVALID");
  let browser;
  try {
    const { chromium } = await playwrightLoader();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--disable-background-networking", "--no-first-run"],
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const consoleErrorHashes = [];
    const pageErrorHashes = [];
    const requestFailureHashes = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrorHashes.push(externalGateSha256(message.text()));
      }
    });
    page.on("pageerror", (error) => {
      pageErrorHashes.push(externalGateSha256(error?.message ?? String(error)));
    });
    page.on("requestfailed", (request) => {
      requestFailureHashes.push(externalGateSha256([
        request.method(),
        request.url(),
        request.failure()?.errorText ?? "unknown",
      ].join(":")));
    });
    const response = await page.goto(`${origin}/wedding`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    const completedAt = readClock(now, "CANARY_BROWSER_CLOCK_INVALID");
    const observation = {
      evidenceVersion: 1,
      runner: "playwright-core-public-v1",
      expectedHost,
      pagePath: "/wedding",
      finalUrl: page.url(),
      status: response?.status() ?? 0,
      consoleErrorHashes,
      pageErrorHashes,
      requestFailureHashes,
      navigationDurationMs: completedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      containsSecrets: false,
    };
    validateBrowserCanaryObservation(observation, { expectedHost });
    return observation;
  } catch (error) {
    if (error instanceof ExternalGateProvenanceError) throw error;
    blocked("CANARY_BROWSER_FAILED", "headless production browser canary failed");
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function readSensitiveJsonResponse(response, maximumBytes, code) {
  const text = await safeResponseText(response, maximumBytes, code);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") throw new Error("shape");
    return value;
  } catch {
    blocked(code, "sensitive API response was not valid JSON");
  }
}

export async function runSupabaseAuthenticatedSessionObservation({
  projectRef,
  supabaseAnonKey,
  testEmail,
  testPassword,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  if (!PROJECT_REF.test(projectRef ?? "")
      || !validBearerSecret(supabaseAnonKey)
      || typeof testEmail !== "string"
      || testEmail.length < 3
      || testEmail.length > 320
      || /[\u0000-\u0020\u007f]/.test(testEmail)
      || !validDatabasePassword(testPassword)
      || typeof fetchImpl !== "function") {
    blocked("CANARY_AUTH_CONFIG_INVALID", "authenticated canary configuration is invalid");
  }
  const startedAt = readClock(now, "CANARY_AUTH_CLOCK_INVALID");
  const authOrigin = `https://${projectRef}.supabase.co`;
  let accessToken;
  let refreshToken;
  let userId;
  let loginStatus;
  let authenticatedReadStatus;
  let authenticatedReadRowCount;
  let logoutStatus;
  let refreshAfterLogoutStatus;
  try {
    const loginResponse = await fetchImpl(
      `${authOrigin}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: supabaseAnonKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      },
    );
    loginStatus = loginResponse.status;
    const login = await readSensitiveJsonResponse(
      loginResponse,
      128 * 1024,
      "CANARY_AUTH_LOGIN_FAILED",
    );
    accessToken = login.access_token;
    refreshToken = login.refresh_token;
    userId = login.user?.id;
    if (loginStatus !== 200
        || !validBearerSecret(accessToken)
        || !validBearerSecret(refreshToken)
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
          userId ?? "",
        )) {
      blocked("CANARY_AUTH_LOGIN_FAILED", "test-account login did not return one valid session");
    }
    const readResponse = await fetchImpl(
      `${authOrigin}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
      {
        method: "GET",
        redirect: "error",
        headers: {
          apikey: supabaseAnonKey,
          authorization: `Bearer ${accessToken}`,
        },
      },
    );
    authenticatedReadStatus = readResponse.status;
    const rows = await readSensitiveJsonResponse(
      readResponse,
      16 * 1024,
      "CANARY_AUTH_READ_FAILED",
    );
    authenticatedReadRowCount = Array.isArray(rows)
      && rows.length === 1
      && rows[0]?.id === userId
      ? 1
      : 0;
    const logoutResponse = await fetchImpl(`${authOrigin}/auth/v1/logout`, {
      method: "POST",
      redirect: "error",
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    logoutStatus = logoutResponse.status;
    await safeResponseText(logoutResponse, 16 * 1024, "CANARY_AUTH_LOGOUT_FAILED");
    const refreshResponse = await fetchImpl(
      `${authOrigin}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: supabaseAnonKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );
    refreshAfterLogoutStatus = refreshResponse.status;
    await safeResponseText(
      refreshResponse,
      16 * 1024,
      "CANARY_AUTH_LOGOUT_FAILED",
    );
  } finally {
    accessToken = null;
    refreshToken = null;
  }
  const completedAt = readClock(now, "CANARY_AUTH_CLOCK_INVALID");
  const observation = {
    evidenceVersion: 1,
    runner: "supabase-auth-rest-v1",
    projectRef,
    userIdSha256: externalGateSha256(userId),
    loginStatus,
    authenticatedReadStatus,
    authenticatedReadRowCount,
    logoutStatus,
    refreshAfterLogoutStatus,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    containsSecrets: false,
  };
  validateAuthenticatedSessionObservation(observation, { projectRef });
  return observation;
}

export async function runProductionDatabaseFenceObservation({
  projectRef,
  databaseUrl,
  psql = "psql",
  runPsql = defaultRunPsql,
}) {
  const expectedSystemIdentifier = productionDatabaseSystemIdentifier(projectRef);
  if (!expectedSystemIdentifier || typeof runPsql !== "function") {
    blocked("CANARY_DB_PROBE_CONFIG_INVALID", "production DB identity is not pinned");
  }
  const connection = validateHostedRestoreDatabaseUrl(databaseUrl, projectRef);
  const sql = buildProductionFenceReadOnlyProbeSql({ projectRef });
  const result = await runPsql({ psql, sql, connection, timeoutMs: 60_000 });
  if (result?.status !== 0
      || result.outputTruncated
      || result.stderrBytes > 16 * 1024) {
    blocked("CANARY_DB_PROBE_FAILED", "production write-fence DB probe failed");
  }
  const raw = parseBoundedJson(
    result.stdout.trim(),
    MAX_PROBE_RAW_BYTES,
    "CANARY_DB_PROBE_FAILED",
  );
  const observation = {
    ...raw,
    probeSqlSha256: externalGateSha256(sql),
  };
  validateProductionFenceObservation(observation, {
    projectRef,
    databaseSystemIdentifier: expectedSystemIdentifier,
  });
  return observation;
}

export async function collectVercelServerErrorRawEvidence({
  fetchImpl = globalThis.fetch,
  vercelToken,
  teamId,
  projectId,
  deploymentId,
  observationStartedAt,
  observationCompletedAt,
}) {
  const since = parseCanonicalInstant(observationStartedAt);
  const until = parseCanonicalInstant(observationCompletedAt);
  if (!validBearerSecret(vercelToken)
      || typeof fetchImpl !== "function"
      || !VERCEL_TEAM_ID.test(teamId ?? "")
      || !VERCEL_PROJECT_ID.test(projectId ?? "")
      || !DEPLOYMENT_ID.test(deploymentId ?? "")
      || since === null
      || until === null
      || until < since
      || until - since > 3_900_000) {
    blocked("CANARY_VERCEL_LOG_CONFIG_INVALID", "Vercel 5xx log query is invalid");
  }
  const query = new URLSearchParams({
    direction: "forward",
    follow: "0",
    limit: "100",
    statusCode: "5xx",
    since: String(since),
    until: String(until),
    teamId,
  });
  const rawText = await fetchJsonRaw({
    fetchImpl,
    url: `https://api.vercel.com/v3/deployments/${encodeURIComponent(deploymentId)}/events?${query}`,
    bearer: vercelToken,
    maximumBytes: MAX_VERCEL_SERVER_ERROR_EVIDENCE_BYTES,
    code: "CANARY_VERCEL_LOG_REQUEST_FAILED",
  });
  validateVercelServerErrorRawEvidence(rawText);
  return rawText;
}

export async function collectHostedRestoreEvidence({
  repoRoot = process.cwd(),
  fetchImpl = globalThis.fetch,
  runPsql = defaultRunPsql,
  supabaseAccessToken,
  databaseUrl,
  psql = "psql",
  baseReceipt,
  targetProjectName,
  projectRawEvidencePath,
  databaseProbeRawEvidencePath,
  receiptPath,
  expectedTables = AMORA_POST_EXPAND_TABLES,
  expectedMigrationVersions = AMORA_RELEASE_MIGRATION_VERSIONS,
  now = () => new Date(),
}) {
  if (!validBearerSecret(supabaseAccessToken)
      || typeof fetchImpl !== "function"
      || typeof runPsql !== "function") {
    blocked("HOSTED_RESTORE_COLLECTOR_CONFIG_INVALID", "Supabase collector configuration is invalid");
  }
  const targetRef = baseReceipt?.targetProjectRef;
  const sourceDatabaseSystemIdentifier = productionDatabaseSystemIdentifier(
    baseReceipt?.sourceProjectRef,
  );
  if (!PROJECT_REF.test(targetRef ?? "")
      || targetRef === baseReceipt?.sourceProjectRef
      || !DISPOSABLE_RESTORE_PROJECT_NAME.test(targetProjectName ?? "")
      || !sourceDatabaseSystemIdentifier
      || !UPPER_SHA256.test(baseReceipt?.sourceLiveSchemaContractSha256 ?? "")
      || !UPPER_SHA256.test(baseReceipt?.sourceLogicalDataContractSha256 ?? "")) {
    blocked("HOSTED_RESTORE_COLLECTOR_CONFIG_INVALID", "restore target is not disposable and isolated");
  }
  const connection = validateHostedRestoreDatabaseUrl(databaseUrl, targetRef);
  const projectRawText = await fetchJsonRaw({
    fetchImpl,
    url: `https://api.supabase.com/v1/projects/${encodeURIComponent(targetRef)}`,
    bearer: supabaseAccessToken,
    maximumBytes: MAX_PROVIDER_RAW_BYTES,
    code: "SUPABASE_PROJECT_API_REQUEST_FAILED",
  });
  validateSupabaseProjectRaw(
    projectRawText,
    targetRef,
    targetProjectName,
  );
  const authHealth = await collectHostedRestoreAuthHealth({
    fetchImpl,
    targetProjectRef: targetRef,
    now,
  });
  const logicalDataSqlPath = resolve(
    repoRoot,
    HOSTED_RESTORE_LOGICAL_DATA_SQL_RELATIVE_PATH,
  );
  const logicalDataSqlRaw = await readFile(logicalDataSqlPath, "utf8")
    .catch(() => null);
  const logicalDataSql = canonicalPinnedSql(logicalDataSqlRaw);
  if (!logicalDataSql
      || pinnedSqlSha256(logicalDataSql)
        !== HOSTED_RESTORE_LOGICAL_DATA_PROBE_SQL_SHA256
      || !/^begin transaction read only;/i.test(logicalDataSql.trimStart())
      || !/(?:rollback|commit);\s*$/i.test(logicalDataSql)) {
    blocked(
      "HOSTED_RESTORE_LOGICAL_DATA_SQL_INVALID",
      "pinned read-only logical data probe is missing or altered",
    );
  }
  const logicalResult = await runPsql({
    psql,
    sql: logicalDataSql,
    connection,
    timeoutMs: 180_000,
    maximumStdoutBytes: 64 * 1024 * 1024,
  });
  if (logicalResult?.status !== 0
      || logicalResult.outputTruncated
      || logicalResult.stderrBytes > 16 * 1024) {
    blocked(
      "HOSTED_RESTORE_LOGICAL_DATA_PROBE_FAILED",
      "read-only logical data digest probe failed",
    );
  }
  const logicalPayload = parseHostedRestoreLogicalPsqlOutput(
    logicalResult.stdout,
  );
  const logicalData = buildLogicalDataDigestContractFromPayload(logicalPayload);
  if (logicalData.sha256 !== baseReceipt.sourceLogicalDataContractSha256) {
    blocked(
      "HOSTED_RESTORE_LOGICAL_DATA_MISMATCH",
      "hosted restore logical data differs from the freshly verified backup",
    );
  }
  const sql = buildHostedRestoreReadOnlyProbeSql({
    expectedTables,
    expectedMigrationVersions,
  });
  const result = await runPsql({ psql, sql, connection, timeoutMs: 60_000 });
  if (result?.status !== 0 || result.outputTruncated || result.stderrBytes > 16 * 1024) {
    blocked("HOSTED_RESTORE_DB_PROBE_FAILED", "read-only hosted restore probe failed");
  }
  const coreProbe = parseHostedRestoreCoreProbeRaw(result.stdout.trim(), {
    expectedTables,
    expectedMigrationVersions,
    sourceDatabaseSystemIdentifier,
  });
  if (coreProbe.liveSchemaContractSha256
      !== baseReceipt.sourceLiveSchemaContractSha256) {
    blocked(
      "HOSTED_RESTORE_LIVE_SCHEMA_MISMATCH",
      "hosted restore live schema differs from the freshly verified backup",
    );
  }
  const expectedProbe = {
    expectedTables,
    expectedMigrationVersions,
    expectedLiveSchemaContractSha256:
      baseReceipt.sourceLiveSchemaContractSha256,
    expectedLogicalDataContractSha256:
      baseReceipt.sourceLogicalDataContractSha256,
    sourceDatabaseSystemIdentifier,
    sourceProjectRef: baseReceipt.sourceProjectRef,
    targetProjectRef: targetRef,
  };
  const mergedProbe = {
    ...coreProbe,
    logicalDataContract: logicalData.contract,
    logicalDataContractSha256: logicalData.sha256,
    authHealth,
    checks: null,
  };
  mergedProbe.checks = deriveHostedRestoreChecks(mergedProbe, expectedProbe);
  const databaseProbeRawText = `${JSON.stringify(mergedProbe, null, 2)}\n`;
  const probe = parseDatabaseProbeRaw(databaseProbeRawText, {
    ...expectedProbe,
  });
  const receipt = buildHostedRestoreReceiptWithProvenance({
    baseReceipt: {
      ...baseReceipt,
      targetLiveSchemaContractSha256:
        probe.raw.liveSchemaContractSha256,
      targetLogicalDataContractSha256:
        probe.raw.logicalDataContractSha256,
      checks: probe.raw.checks,
      verifiedAt: probe.raw.checkedAt,
    },
    projectRawText,
    projectRawEvidenceFileName: basename(projectRawEvidencePath),
    databaseProbeRawText,
    databaseProbeRawEvidenceFileName: basename(databaseProbeRawEvidencePath),
    databaseHost: connection.host,
    targetProjectName,
    databaseProbeSql: sql,
    expectedTables,
    expectedMigrationVersions,
    sourceDatabaseSystemIdentifier,
  });
  await writeEvidenceFiles({
    repoRoot,
    rawFiles: [
      { path: projectRawEvidencePath, text: projectRawText },
      { path: databaseProbeRawEvidencePath, text: databaseProbeRawText },
    ],
    receiptPath,
    receipt,
  });
  return receipt;
}

export async function collectProductionCanaryEvidence({
  repoRoot = process.cwd(),
  rawEvidencePath,
  vercelServerErrorRawEvidencePath,
  receiptPath,
  baseReceipt,
  deploymentReceipt,
  expectedHost,
  expectedCommit,
  browserRunner,
  authenticatedSessionRunner,
  databaseFenceRunner,
  vercelServerErrorRunner,
  fetchImpl = globalThis.fetch,
  observationWindowSeconds = 300,
  canaryMaximumAgeMinutes = 15,
  now = () => new Date(),
  wait,
}) {
  const deploymentRawEvidenceSha256 =
    deploymentReceipt?.provenance?.rawEvidenceSha256;
  const databaseSystemIdentifier = productionDatabaseSystemIdentifier(
    baseReceipt?.projectRef,
  );
  if (deploymentReceipt?.releaseCommit !== expectedCommit
      || deploymentReceipt?.readyState !== "READY"
      || !SHA256.test(deploymentRawEvidenceSha256 ?? "")
      || !databaseSystemIdentifier) {
    blocked(
      "CANARY_COLLECTOR_CONFIG_INVALID",
      "canary collector requires the exact ready deployment and production database identity",
    );
  }
  const evidence = await runProductionCanaryHttpEvidence({
    fetchImpl,
    expectedHost,
    expectedCommit,
    deploymentRawEvidenceSha256,
    projectRef: baseReceipt.projectRef,
    databaseSystemIdentifier,
    deploymentReady: true,
    browserRunner,
    authenticatedSessionRunner,
    databaseFenceRunner,
    vercelServerErrorRunner,
    observationWindowSeconds,
    now,
    ...(wait ? { wait } : {}),
  });
  const receipt = buildProductionCanaryReceiptWithProvenance({
    baseReceipt: {
      ...baseReceipt,
      observationStartedAt: evidence.raw.observationStartedAt,
      verifiedAt: evidence.raw.verifiedAt,
      expiresAt: new Date(
        Date.parse(evidence.raw.verifiedAt)
          + canaryMaximumAgeMinutes * 60_000,
      ).toISOString(),
      observationWindowSeconds: evidence.raw.observationWindowSeconds,
      checks: evidence.raw.checks,
    },
    rawText: evidence.rawText,
    rawEvidenceFileName: basename(rawEvidencePath),
    vercelServerErrorRawText: evidence.vercelServerErrorRawText,
    vercelServerErrorRawEvidenceFileName: basename(
      vercelServerErrorRawEvidencePath,
    ),
    expectedHost,
    expectedCommit,
    deploymentRawEvidenceSha256,
    databaseSystemIdentifier,
    canaryMaximumAgeMinutes,
  });
  await writeEvidenceFiles({
    repoRoot,
    rawFiles: [
      { path: rawEvidencePath, text: evidence.rawText },
      {
        path: vercelServerErrorRawEvidencePath,
        text: evidence.vercelServerErrorRawText,
      },
    ],
    receiptPath,
    receipt,
  });
  return receipt;
}

export async function readSiblingRawEvidence({
  receiptPath,
  fileName,
  expectedSha256,
  maximumBytes,
  code,
}) {
  safeEvidenceFileName(fileName, code);
  if (!SHA256.test(expectedSha256 ?? "")) {
    blocked(code, "raw evidence hash binding is invalid");
  }
  const parentRealPath = await realpath(dirname(receiptPath)).catch(() => null);
  const path = resolve(dirname(receiptPath), fileName);
  const beforeMetadata = await lstat(path).catch(() => null);
  const beforeRealPath = await realpath(path).catch(() => null);
  if (!parentRealPath
      || !beforeMetadata?.isFile()
      || beforeMetadata.isSymbolicLink()
      || beforeMetadata.size < 2
      || beforeMetadata.size > maximumBytes
      || !beforeRealPath
      || resolve(dirname(beforeRealPath)).toLowerCase()
        !== resolve(parentRealPath).toLowerCase()) {
    blocked(code, "raw evidence file is missing, unsafe or hash-mismatched");
  }
  const handle = await open(beforeRealPath, "r").catch(() => null);
  if (!handle) blocked(code, "raw evidence file could not be opened safely");
  let openedMetadata;
  let buffer;
  try {
    openedMetadata = await handle.stat();
    buffer = await handle.readFile();
  } finally {
    await handle.close().catch(() => {});
  }
  const afterMetadata = await lstat(path).catch(() => null);
  const afterRealPath = await realpath(path).catch(() => null);
  const identityChanged = Number.isSafeInteger(beforeMetadata.ino)
    && beforeMetadata.ino !== 0
    && (beforeMetadata.ino !== openedMetadata.ino
      || beforeMetadata.dev !== openedMetadata.dev
      || beforeMetadata.ino !== afterMetadata?.ino
      || beforeMetadata.dev !== afterMetadata?.dev);
  if (!openedMetadata.isFile()
      || !afterMetadata?.isFile()
      || afterMetadata.isSymbolicLink()
      || afterRealPath !== beforeRealPath
      || identityChanged
      || buffer.length !== openedMetadata.size
      || buffer.length < 2
      || buffer.length > maximumBytes
      || externalGateSha256(buffer) !== expectedSha256) {
    blocked(code, "raw evidence file changed or hash-mismatched while being read");
  }
  return buffer.toString("utf8");
}

async function validateExternalDeploymentCanaryProvenanceCore({
  deploymentReceipt,
  deploymentReceiptPath,
  canaryReceipt,
  canaryReceiptPath,
  expected,
}) {
  const deploymentRawText = await readSiblingRawEvidence({
    receiptPath: deploymentReceiptPath,
    fileName: deploymentReceipt.provenance?.rawEvidenceFileName,
    expectedSha256: deploymentReceipt.provenance?.rawEvidenceSha256,
    maximumBytes: MAX_PROVIDER_RAW_BYTES,
    code: "VERCEL_RAW_EVIDENCE_FILE_INVALID",
  });
  const deployment = validateVercelDeploymentReceiptProvenance({
    receipt: deploymentReceipt,
    rawText: deploymentRawText,
    expected: {
      releaseCommit: expected.releaseCommit,
      teamId: expected.vercelTeamId,
      projectId: expected.vercelProjectId,
      productionHost: expected.productionHost,
    },
  });
  const canaryRawText = await readSiblingRawEvidence({
    receiptPath: canaryReceiptPath,
    fileName: canaryReceipt.provenance?.rawHttpObservationsFileName,
    expectedSha256: canaryReceipt.provenance?.rawHttpObservationsSha256,
    maximumBytes: MAX_PROBE_RAW_BYTES,
    code: "CANARY_RAW_EVIDENCE_FILE_INVALID",
  });
  const vercelServerErrorRawText = await readSiblingRawEvidence({
    receiptPath: canaryReceiptPath,
    fileName:
      canaryReceipt.provenance?.vercelServerErrorRawEvidenceFileName,
    expectedSha256:
      canaryReceipt.provenance?.vercelServerErrorRawEvidenceSha256,
    maximumBytes: MAX_VERCEL_SERVER_ERROR_EVIDENCE_BYTES,
    code: "CANARY_VERCEL_SERVER_ERROR_EVIDENCE_FILE_INVALID",
  });
  const pinnedDatabaseSystemIdentifier = productionDatabaseSystemIdentifier(
    canaryReceipt.projectRef,
  );
  const databaseSystemIdentifier =
    expected.databaseSystemIdentifier ?? pinnedDatabaseSystemIdentifier;
  if (!/^\d{10,32}$/.test(databaseSystemIdentifier ?? "")
      || (pinnedDatabaseSystemIdentifier
        && databaseSystemIdentifier !== pinnedDatabaseSystemIdentifier)) {
    blocked(
      "CANARY_DATABASE_IDENTITY_INVALID",
      "canary receipt does not identify the pinned production database",
    );
  }
  const canary = validateProductionCanaryReceiptProvenance({
    receipt: canaryReceipt,
    rawText: canaryRawText,
    expected: {
      expectedHost: expected.productionHost,
      expectedCommit: expected.releaseCommit,
      deploymentRawEvidenceSha256: deployment.rawSha256,
      requiredChecks: expected.requiredCanaryChecks,
      databaseSystemIdentifier,
      vercelServerErrorRawText,
    },
  });
  return {
    canary,
    deployment,
    summary: {
      deploymentRawEvidenceSha256: deployment.rawSha256,
      canaryRawHttpObservationsSha256: canary.rawSha256,
      canaryVercelServerErrorRawEvidenceSha256:
        externalGateSha256(vercelServerErrorRawText),
    },
  };
}

export async function validateExternalDeploymentCanaryProvenanceFiles(input) {
  const result = await validateExternalDeploymentCanaryProvenanceCore(input);
  return result.summary;
}

export async function validateExternalGateProvenanceFiles({
  deploymentReceipt,
  deploymentReceiptPath,
  hostedRestoreReceipt,
  hostedRestoreReceiptPath,
  canaryReceipt,
  canaryReceiptPath,
  expected,
}) {
  const core = await validateExternalDeploymentCanaryProvenanceCore({
    deploymentReceipt,
    deploymentReceiptPath,
    canaryReceipt,
    canaryReceiptPath,
    expected,
  });
  const projectRawText = await readSiblingRawEvidence({
    receiptPath: hostedRestoreReceiptPath,
    fileName: hostedRestoreReceipt.provenance?.projectApiRawEvidenceFileName,
    expectedSha256:
      hostedRestoreReceipt.provenance?.projectApiRawEvidenceSha256,
    maximumBytes: MAX_PROVIDER_RAW_BYTES,
    code: "HOSTED_RESTORE_PROJECT_EVIDENCE_FILE_INVALID",
  });
  const databaseProbeRawText = await readSiblingRawEvidence({
    receiptPath: hostedRestoreReceiptPath,
    fileName:
      hostedRestoreReceipt.provenance?.databaseProbeRawEvidenceFileName,
    expectedSha256:
      hostedRestoreReceipt.provenance?.databaseProbeRawEvidenceSha256,
    maximumBytes: MAX_PROBE_RAW_BYTES,
    code: "HOSTED_RESTORE_DB_PROBE_FILE_INVALID",
  });
  const hostedRestore = validateHostedRestoreReceiptProvenance({
    receipt: hostedRestoreReceipt,
    projectRawText,
    databaseProbeRawText,
    expected: {
      expectedTables: expected.expectedTables,
      expectedMigrationVersions: expected.expectedMigrationVersions,
      sourceDatabaseSystemIdentifier:
        core.canary.raw.databaseFence.databaseSystemIdentifier,
    },
  });
  return {
    deploymentRawEvidenceSha256:
      core.summary.deploymentRawEvidenceSha256,
    hostedRestoreProjectRawEvidenceSha256:
      hostedRestoreReceipt.provenance.projectApiRawEvidenceSha256,
    hostedRestoreDatabaseProbeRawEvidenceSha256: hostedRestore.rawSha256,
    canaryRawHttpObservationsSha256:
      core.summary.canaryRawHttpObservationsSha256,
    canaryVercelServerErrorRawEvidenceSha256:
      core.summary.canaryVercelServerErrorRawEvidenceSha256,
  };
}

export const productionExternalGateProvenanceTestHooks = Object.freeze({
  CANARY_HTTP_PROBES,
  MAX_PROBE_RAW_BYTES,
  MAX_PROVIDER_RAW_BYTES,
  pinnedSqlSha256,
  requiredChecksSha256,
  validateCanaryRawEvidence,
});
