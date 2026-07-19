import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  SuccessorReleaseContractError,
  validateSuccessorReleaseContract,
} from "./lib/supabase-successor-release-contract.mjs";

const SUCCESSOR_MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/vendor-disclosure-v2-20260718.json";
const HOSTED_STAGING_CONTRACT_RELATIVE_PATH =
  "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json";
const PROJECT_REF = /^[a-z0-9]{20}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const COLUMN_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MANAGEMENT_RESPONSE_BYTES = 256 * 1024;
const BASE_COLUMN_PROBE_CONCURRENCY = 8;

export const VENDOR_DISCLOSURE_BASE_TABLES = Object.freeze([
  "vendors",
  "vendor_enrichment_private",
  "vendor_dedupe_candidates",
  "agency_dedupe_candidates",
  "agencies",
  "price_snapshots",
  "official_prices",
  "official_price_options",
  "official_agency_packages",
  "events",
  "tags",
  "vendor_tags",
  "vendor_alias_proposals",
  "official_review_events",
  "price_upload_confirmations",
  "price_upload_confirmation_events",
  "vendor_demand_daily",
]);

export const OWNED_APPLICATION_TABLES = Object.freeze([
  "vendor_favorites",
  "wishlists",
  "combos",
  "price_alerts",
]);

export const PUBLIC_DISCLOSURE_VIEWS = Object.freeze([
  {
    name: "v_public_vendors",
    idColumn: "id",
    fixtureKey: "publicVendorId",
    nonPublicFixtureKey: "nonPublicVendorId",
    allowedColumns: [
      "id", "slug", "name", "category", "region_code", "aliases",
      "official_url", "instagram_url", "naver_place_url", "attributes", "tags",
    ],
  },
  {
    name: "v_public_prices",
    idColumn: "official_price_id",
    fixtureKey: "publicPriceId",
    nonPublicFixtureKey: "nonPublicPriceId",
    allowedColumns: [
      "official_price_id", "vendor_id", "vendor_slug", "vendor_name", "category",
      "region_code", "aliases", "agency_id", "agency_slug", "agency_name",
      "item_name", "price_min_krw", "price_max_krw", "price_note", "base_spec",
      "vat_note", "period_label", "source", "source_label", "published_at",
      "is_current",
    ],
  },
  {
    name: "v_public_price_options",
    idColumn: "id",
    fixtureKey: "publicOptionId",
    nonPublicFixtureKey: "nonPublicOptionId",
    allowedColumns: [
      "id", "official_price_id", "vendor_id", "agency_id", "name",
      "price_min_krw", "price_max_krw", "unit", "condition", "raw_text",
      "is_effectively_mandatory", "sort_order",
    ],
  },
  {
    name: "v_public_agency_packages",
    idColumn: "id",
    fixtureKey: "publicAgencyPackageId",
    nonPublicFixtureKey: "nonPublicAgencyPackageId",
    allowedColumns: [
      "id", "snapshot_id", "period_label", "source", "source_label",
      "published_at", "agency_id", "agency_name", "region_code", "package_name",
      "category_scope", "price_min_krw", "price_max_krw", "vat_note", "price_note",
      "options", "created_at", "updated_at", "agency_slug",
      "agency_display_name", "snapshot_published", "is_current",
    ],
  },
]);

export class ProbeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProbeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProbeFailure(code, message);
}

function canonicalSha256(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function required(env, key) {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail("CONFIG_MISSING", `Missing required hosted-staging probe input: ${key}`);
  }
  return value.trim();
}

function requiredSecret(env, key) {
  const value = env[key];
  if (typeof value !== "string" || value.length < 8 || /[\r\n]/.test(value)) {
    fail("CONFIG_SECRET_INVALID", `Hosted-staging probe secret is invalid: ${key}`);
  }
  return value;
}

function requiredManagementToken(env) {
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (typeof token !== "string"
      || token.length < 20
      || token.length > 4096
      || /[\r\n]/.test(token)) {
    fail(
      "MANAGEMENT_TOKEN_INVALID",
      "A valid Supabase Management API access token is required",
    );
  }
  return token;
}

function requiredUuid(env, key) {
  const value = required(env, key).toLowerCase();
  if (!UUID.test(value)) {
    fail("CONFIG_UUID_INVALID", `Hosted-staging fixture UUID is invalid: ${key}`);
  }
  return value;
}

function requiredEmail(env, key) {
  const value = required(env, key).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    fail("CONFIG_EMAIL_INVALID", `Hosted-staging fixture email is invalid: ${key}`);
  }
  return value;
}

export function validateProbeEnvironment(env, hostedStagingBinding) {
  const stagingProjectRef = required(env, "SUPABASE_STAGING_PROJECT_REF");
  const productionProjectRef = required(env, "SUPABASE_PRODUCTION_PROJECT_REF");
  if (!PROJECT_REF.test(stagingProjectRef)
      || !PROJECT_REF.test(productionProjectRef)) {
    fail("PROJECT_REF_INVALID", "Supabase project refs must be exact 20-character refs");
  }
  if (stagingProjectRef === productionProjectRef) {
    fail(
      "PRODUCTION_TARGET_FORBIDDEN",
      "The hosted RLS probe is staging-only and refuses the production project",
    );
  }
  if (!hostedStagingBinding
      || hostedStagingBinding.projectRef !== stagingProjectRef
      || !SHA256.test(hostedStagingBinding.contractSha256 ?? "")
      || !SHA256.test(hostedStagingBinding.approvalEvidenceSha256 ?? "")
      || !hasExactKeys(
        hostedStagingBinding.publicViewDefinitionSha256,
        PUBLIC_DISCLOSURE_VIEWS.map(({ name }) => name),
      )
      || Object.values(hostedStagingBinding.publicViewDefinitionSha256)
        .some((value) => !SHA256.test(value))) {
    fail(
      "STAGING_PROJECT_PIN_MISMATCH",
      "The environment staging ref does not match the approved repository contract",
    );
  }

  let supabaseUrl;
  try {
    supabaseUrl = new URL(required(env, "NEXT_PUBLIC_SUPABASE_URL"));
  } catch {
    fail("STAGING_URL_INVALID", "Hosted-staging Supabase URL is invalid");
  }
  if (supabaseUrl.protocol !== "https:"
      || supabaseUrl.hostname !== `${stagingProjectRef}.supabase.co`
      || supabaseUrl.port !== ""
      || supabaseUrl.username !== ""
      || supabaseUrl.password !== ""
      || !["", "/"].includes(supabaseUrl.pathname)
      || supabaseUrl.search !== ""
      || supabaseUrl.hash !== "") {
    fail(
      "STAGING_URL_MISMATCH",
      "Supabase URL must be the exact HTTPS origin for SUPABASE_STAGING_PROJECT_REF",
    );
  }

  const expectedCommit = required(env, "RLS_PROBE_EXPECTED_COMMIT");
  const expectedMigrationSetSha256 = required(
    env,
    "RLS_PROBE_EXPECTED_SUCCESSOR_MIGRATION_SET_SHA256",
  );
  if (!GIT_COMMIT.test(expectedCommit)) {
    fail("COMMIT_INVALID", "RLS_PROBE_EXPECTED_COMMIT must be a full lowercase commit SHA");
  }
  if (!SHA256.test(expectedMigrationSetSha256)) {
    fail(
      "MIGRATION_SET_HASH_INVALID",
      "RLS_PROBE_EXPECTED_SUCCESSOR_MIGRATION_SET_SHA256 must be lowercase SHA-256",
    );
  }

  const userA = {
    email: requiredEmail(env, "RLS_PROBE_USER_A_EMAIL"),
    password: requiredSecret(env, "RLS_PROBE_USER_A_PASSWORD"),
    id: requiredUuid(env, "RLS_PROBE_USER_A_ID"),
    vendorId: requiredUuid(env, "RLS_PROBE_USER_A_VENDOR_ID"),
    comboId: requiredUuid(env, "RLS_PROBE_USER_A_COMBO_ID"),
  };
  const userB = {
    email: requiredEmail(env, "RLS_PROBE_USER_B_EMAIL"),
    password: requiredSecret(env, "RLS_PROBE_USER_B_PASSWORD"),
    id: requiredUuid(env, "RLS_PROBE_USER_B_ID"),
    vendorId: requiredUuid(env, "RLS_PROBE_USER_B_VENDOR_ID"),
    comboId: requiredUuid(env, "RLS_PROBE_USER_B_COMBO_ID"),
  };
  if (userA.email === userB.email
      || userA.id === userB.id
      || userA.vendorId === userB.vendorId
      || userA.comboId === userB.comboId) {
    fail(
      "FIXTURE_IDENTITY_COLLISION",
      "The two hosted-staging fixture users and combo rows must be distinct",
    );
  }

  const receiptOut = required(env, "RLS_PROBE_RECEIPT_OUT");
  if (!isAbsolute(receiptOut)) {
    fail("RECEIPT_PATH_INVALID", "RLS_PROBE_RECEIPT_OUT must be an absolute path");
  }

  return {
    supabaseOrigin: supabaseUrl.origin,
    anonKey: requiredSecret(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseAccessToken: requiredManagementToken(env),
    stagingProjectRef,
    stagingContractSha256: hostedStagingBinding.contractSha256,
    stagingApprovalEvidenceSha256:
      hostedStagingBinding.approvalEvidenceSha256,
    publicViewDefinitionSha256:
      hostedStagingBinding.publicViewDefinitionSha256,
    productionProjectRef,
    expectedCommit,
    expectedMigrationSetSha256,
    receiptOut: resolve(receiptOut),
    publicVendorId: requiredUuid(env, "RLS_PROBE_PUBLIC_VENDOR_ID"),
    publicPriceId: requiredUuid(env, "RLS_PROBE_PUBLIC_PRICE_ID"),
    publicOptionId: requiredUuid(env, "RLS_PROBE_PUBLIC_OPTION_ID"),
    publicAgencyPackageId: requiredUuid(
      env,
      "RLS_PROBE_PUBLIC_AGENCY_PACKAGE_ID",
    ),
    nonPublicVendorId: requiredUuid(env, "RLS_PROBE_NONPUBLIC_VENDOR_ID"),
    nonPublicPriceId: requiredUuid(env, "RLS_PROBE_NONPUBLIC_PRICE_ID"),
    nonPublicOptionId: requiredUuid(env, "RLS_PROBE_NONPUBLIC_OPTION_ID"),
    nonPublicAgencyPackageId: requiredUuid(
      env,
      "RLS_PROBE_NONPUBLIC_AGENCY_PACKAGE_ID",
    ),
    users: [userA, userB],
  };
}

function readRegularFile(path, label) {
  const metadata = existsSync(path) ? lstatSync(path) : null;
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    fail("RELEASE_FILE_INVALID", `${label} must be a non-symlink regular file`);
  }
  return readFileSync(path, "utf8");
}

function hasExactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...expected].sort());
}

export function loadApprovedHostedStagingBinding({
  repoRoot,
  productionProjectRef,
}) {
  const root = resolve(repoRoot);
  const contractPath = resolve(root, HOSTED_STAGING_CONTRACT_RELATIVE_PATH);
  if (!inside(root, contractPath)) {
    fail("STAGING_PROJECT_PIN_INVALID", "Hosted-staging contract escapes the repository");
  }
  const contractText = readRegularFile(contractPath, "hosted-staging project contract");
  let contract;
  try {
    contract = JSON.parse(contractText);
  } catch {
    fail("STAGING_PROJECT_PIN_INVALID", "Hosted-staging project contract is not valid JSON");
  }
  if (!hasExactKeys(contract, [
    "contractVersion",
    "kind",
    "release",
    "productionProjectRef",
    "status",
    "approved",
    "projectRef",
    "approvalEvidence",
    "publicViewDefinitionSha256",
  ])
      || contract.contractVersion !== 1
      || contract.kind !== "vendor-disclosure-hosted-staging-v2"
      || contract.release !== "vendor-disclosure-v2-20260718"
      || contract.productionProjectRef !== productionProjectRef) {
    fail("STAGING_PROJECT_PIN_INVALID", "Hosted-staging project contract is invalid");
  }
  if (contract.approved !== true
      || contract.status !== "approved_for_hosted_rls_probe"
      || !PROJECT_REF.test(contract.projectRef ?? "")
      || contract.projectRef === productionProjectRef
      || typeof contract.approvalEvidence !== "string"
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,255}$/.test(contract.approvalEvidence)
      || !hasExactKeys(
        contract.publicViewDefinitionSha256,
        PUBLIC_DISCLOSURE_VIEWS.map(({ name }) => name),
      )
      || Object.values(contract.publicViewDefinitionSha256)
        .some((value) => !SHA256.test(value))) {
    fail(
      "STAGING_PROJECT_PIN_MISSING",
      "No dedicated hosted-staging project is approved in the repository contract",
    );
  }
  return {
    projectRef: contract.projectRef,
    contractSha256: canonicalSha256(contractText),
    approvalEvidenceSha256: canonicalSha256(`${contract.approvalEvidence}\n`),
    publicViewDefinitionSha256: contract.publicViewDefinitionSha256,
  };
}

export function loadSuccessorReleaseBinding({
  repoRoot,
  productionProjectRef,
  expectedMigrationSetSha256,
}) {
  const root = resolve(repoRoot);
  const manifestPath = resolve(root, SUCCESSOR_MANIFEST_RELATIVE_PATH);
  const manifestText = readRegularFile(manifestPath, "successor release manifest");
  let validated;
  try {
    validated = validateSuccessorReleaseContract({ repoRoot: root });
  } catch (error) {
    if (error instanceof SuccessorReleaseContractError) {
      fail(
        "RELEASE_BINDING_INVALID",
        `Common successor release contract rejected the probe binding: ${error.code}`,
      );
    }
    throw error;
  }
  const { manifest } = validated;
  if (manifest.projectRef !== productionProjectRef) {
    fail("RELEASE_BINDING_INVALID", "Successor production project ref is invalid");
  }

  const migrationPins = manifest.expandMigrations
    .map((entry) => `${entry.file}:${entry.sha256}`);
  const migrationVersions = manifest.expandMigrations
    .map((entry) => entry.file.slice(0, 14));
  const migrationSetSha256 = canonicalSha256(`${migrationPins.join("\n")}\n`);
  if (migrationSetSha256 !== expectedMigrationSetSha256) {
    fail(
      "MIGRATION_SET_MISMATCH",
      "Hosted-staging probe expectation does not match the pinned successor migration set",
    );
  }

  return {
    release: manifest.release,
    releaseStatus: manifest.status,
    releaseTargetProjectRef: manifest.projectRef,
    successorManifestSha256: canonicalSha256(manifestText),
    successorMigrationSetSha256: migrationSetSha256,
    successorMigrationHead: manifest.expandMigrations.at(-1).file.slice(0, 14),
    successorMigrationCount: validated.migrationCount,
    successorMigrationVersions: migrationVersions,
    requiredRemoteHead: validated.predecessorHead,
    migrationFloor: manifest.migrationFloor,
  };
}

function gitEnvironmentWithoutOverrides(processEnv) {
  return Object.fromEntries(
    Object.entries(processEnv).filter(
      ([key]) => !key.toUpperCase().startsWith("GIT_"),
    ),
  );
}

function gitBindingSha256(state) {
  return canonicalSha256(`${JSON.stringify({
    worktree: state.worktree,
    gitDir: state.gitDir,
    commonGitDir: state.commonGitDir,
    headPath: state.headPath,
    headFileSha256: state.headFileSha256,
    headRef: state.headRef,
    commit: state.commit,
  })}\n`);
}

function assertTrackedIndexFlagsSafe(taggedEntries) {
  for (const entry of taggedEntries.split("\0")) {
    if (entry === "") continue;
    if (entry.length < 3 || entry[1] !== " ") {
      fail(
        "GIT_INDEX_FLAGS_UNVERIFIABLE",
        "Unable to verify tracked Git index flags for the hosted-staging probe",
      );
    }
    const tag = entry[0];
    if (tag === "S" || /^[a-z]$/.test(tag)) {
      fail(
        "GIT_INDEX_FLAGS_UNSAFE",
        "Tracked files must not use skip-worktree or assume-unchanged for hosted-staging receipts",
      );
    }
  }
}

export function readGitState(repoRoot, processEnv = process.env) {
  try {
    const root = realpathSync(resolve(repoRoot));
    const options = {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: gitEnvironmentWithoutOverrides(processEnv),
    };
    const run = (args) => execFileSync(
      "git",
      ["--no-optional-locks", "-C", root, ...args],
      options,
    ).trim();
    const worktree = realpathSync(run(["rev-parse", "--show-toplevel"]));
    if (worktree !== root || run(["rev-parse", "--show-prefix"]) !== "") {
      fail(
        "GIT_WORKTREE_MISMATCH",
        "Git resolved a worktree other than the exact hosted-probe repository root",
      );
    }
    const gitDir = realpathSync(run([
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
    ]));
    const commonGitDir = realpathSync(run([
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]));
    const headPath = resolve(root, run(["rev-parse", "--git-path", "HEAD"]));
    const headMetadata = lstatSync(headPath);
    if (!headMetadata.isFile() || headMetadata.isSymbolicLink()) {
      fail("GIT_HEAD_INVALID", "Git HEAD must be a non-symlink regular file");
    }
    assertTrackedIndexFlagsSafe(execFileSync(
      "git",
      [
        "--no-optional-locks",
        "-C",
        root,
        "ls-files",
        "-v",
        "-z",
      ],
      options,
    ));
    const state = {
      worktree,
      gitDir,
      commonGitDir,
      headPath: realpathSync(headPath),
      headFileSha256: canonicalSha256(readFileSync(headPath, "utf8")),
      headRef: run(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: run(["rev-parse", "--verify", "HEAD^{commit}"]),
      porcelain: execFileSync(
        "git",
        [
          "--no-optional-locks",
          "-C",
          root,
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
        ],
        options,
      ).trim(),
    };
    return { ...state, repositoryBindingSha256: gitBindingSha256(state) };
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    fail("GIT_STATE_UNAVAILABLE", "Unable to bind the hosted-staging probe to Git state");
  }
}

function validateGitBinding(gitState, expectedCommit) {
  if (!GIT_COMMIT.test(gitState?.commit ?? "")
      || gitState.commit !== expectedCommit
      || !SHA256.test(gitState?.repositoryBindingSha256 ?? "")) {
    fail("GIT_COMMIT_MISMATCH", "Probe checkout does not match RLS_PROBE_EXPECTED_COMMIT");
  }
  if (gitState.porcelain !== "") {
    fail("GIT_TREE_DIRTY", "Hosted-staging receipts require an exact clean commit checkout");
  }
}

function validateGitStateUnchanged(before, after) {
  if (before.repositoryBindingSha256 !== after.repositoryBindingSha256
      || before.commit !== after.commit
      || before.headFileSha256 !== after.headFileSha256
      || before.headRef !== after.headRef) {
    fail(
      "GIT_STATE_CHANGED",
      "Git repository binding changed while hosted-staging evidence was collected",
    );
  }
}

function requestSignal() {
  return typeof AbortSignal?.timeout === "function"
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

async function safeFetch(fetchImpl, url, init, label) {
  try {
    return await fetchImpl(url, { ...init, signal: requestSignal() });
  } catch {
    fail("NETWORK_REQUEST_FAILED", `Hosted-staging request failed: ${label}`);
  }
}

async function runBounded(items, worker, concurrency) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

async function readArrayResponse(response, label) {
  if (!response.ok) {
    fail("READ_FAILED", `Hosted-staging read failed: ${label}; status=${response.status}`);
  }
  let rows;
  try {
    rows = await response.json();
  } catch {
    fail("RESPONSE_INVALID", `Hosted-staging read returned invalid JSON: ${label}`);
  }
  if (!Array.isArray(rows)) {
    fail("RESPONSE_INVALID", `Hosted-staging read returned a non-array payload: ${label}`);
  }
  return rows;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildHostedStagingInventorySql({ config, release }) {
  const requestedBaseTables = VENDOR_DISCLOSURE_BASE_TABLES
    .map((table) => `(${sqlLiteral(table)})`)
    .join(",\n    ");
  const requestedOwnedTables = OWNED_APPLICATION_TABLES
    .map((table) => `(${sqlLiteral(table)})`)
    .join(",\n    ");
  const requestedPublicViews = PUBLIC_DISCLOSURE_VIEWS
    .map(({ name }) => `(${sqlLiteral(name)})`)
    .join(",\n    ");
  return `WITH requested_base_tables(table_name) AS (
  VALUES
    ${requestedBaseTables}
), requested_owned_tables(table_name) AS (
  VALUES
    ${requestedOwnedTables}
), requested_public_views(view_name) AS (
  VALUES
    ${requestedPublicViews}
), base_columns AS (
  SELECT
    requested.table_name,
    attribute.attname AS column_name
  FROM requested_base_tables AS requested
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = pg_catalog.to_regclass(
      pg_catalog.format('public.%I', requested.table_name)
    )
    AND relation.relkind IN ('r', 'p')
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
), owned_columns AS (
  SELECT
    requested.table_name,
    attribute.attname AS column_name
  FROM requested_owned_tables AS requested
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = pg_catalog.to_regclass(
      pg_catalog.format('public.%I', requested.table_name)
    )
    AND relation.relkind IN ('r', 'p')
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
), public_view_inventory AS (
  SELECT
    requested.view_name,
    COALESCE((
      SELECT json_agg(attribute.attname ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = relation.oid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ), '[]'::json) AS columns,
    COALESCE(to_json(relation.reloptions), '[]'::json) AS reloptions,
    CASE WHEN relation.relkind = 'v'
      THEN pg_catalog.pg_get_viewdef(relation.oid, true)
      ELSE NULL
    END AS definition
  FROM requested_public_views AS requested
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
    AND relation.relname = requested.view_name
)
SELECT
  (
    SELECT max(migration.version::text)
    FROM supabase_migrations.schema_migrations AS migration
    WHERE migration.version::text ~ '^[0-9]{14}$'
  ) AS ledger_head,
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations AS migration
    WHERE migration.version IS NULL
      OR migration.version::text !~ '^[0-9]{14}$'
  ) AS invalid_ledger_version_count,
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations AS migration
    WHERE migration.version::text = ${sqlLiteral(release.requiredRemoteHead)}
  ) AS required_remote_head_count,
  COALESCE((
    SELECT json_agg(migration.version::text ORDER BY migration.version::text)
    FROM supabase_migrations.schema_migrations AS migration
    WHERE migration.version::text >= ${sqlLiteral(release.migrationFloor)}
  ), '[]'::json) AS successor_versions,
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'table_name', column_row.table_name,
        'column_name', column_row.column_name
      ) ORDER BY column_row.table_name, column_row.column_name
    )
    FROM base_columns AS column_row
  ), '[]'::json) AS base_columns,
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'table_name', column_row.table_name,
        'column_name', column_row.column_name
      ) ORDER BY column_row.table_name, column_row.column_name
    )
    FROM owned_columns AS column_row
  ), '[]'::json) AS owned_columns,
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'view_name', view_row.view_name,
        'columns', view_row.columns,
        'reloptions', view_row.reloptions,
        'definition', view_row.definition
      ) ORDER BY view_row.view_name
    )
    FROM public_view_inventory AS view_row
  ), '[]'::json) AS public_view_inventory,
  json_build_object(
    'v_public_vendors', EXISTS (
      SELECT 1
      FROM public.vendors AS vendor
      JOIN public.v_public_vendors AS public_vendor ON public_vendor.id = vendor.id
      WHERE vendor.id = ${sqlLiteral(config.publicVendorId)}::uuid
        AND vendor.status = 'approved'
        AND vendor.merged_into_vendor_id IS NULL
        AND NULLIF(btrim(vendor.slug), '') IS NOT NULL
        AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'
    ),
    'v_public_prices', EXISTS (
      SELECT 1
      FROM public.official_prices AS price
      JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
      JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
      LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
      JOIN public.v_public_prices AS public_price
        ON public_price.official_price_id = price.id
      WHERE price.id = ${sqlLiteral(config.publicPriceId)}::uuid
        AND snapshot.published IS TRUE
        AND snapshot.is_current IS TRUE
        AND price.review_status = 'approved'
        AND price.needs_review IS FALSE
        AND price.category IN ('studio', 'dress', 'makeup', 'hall', 'other')
        AND cardinality(price.source_object_keys) > 0
        AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
        AND price.confidence IS NOT NULL
        AND vendor.status = 'approved'
        AND vendor.merged_into_vendor_id IS NULL
        AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'
        AND (agency.id IS NULL OR (
          agency.is_active IS TRUE
          AND agency.merged_into_agency_id IS NULL
        ))
    ),
    'v_public_price_options', EXISTS (
      SELECT 1
      FROM public.official_price_options AS option_row
      JOIN public.official_prices AS price ON price.id = option_row.official_price_id
      JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
      JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
      LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
      JOIN public.v_public_price_options AS public_option
        ON public_option.id = option_row.id
      WHERE option_row.id = ${sqlLiteral(config.publicOptionId)}::uuid
        AND snapshot.published IS TRUE
        AND snapshot.is_current IS TRUE
        AND price.review_status = 'approved'
        AND price.needs_review IS FALSE
        AND price.category IN ('studio', 'dress', 'makeup', 'hall', 'other')
        AND cardinality(price.source_object_keys) > 0
        AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
        AND price.confidence IS NOT NULL
        AND cardinality(option_row.source_object_keys) > 0
        AND NULLIF(btrim(option_row.source_quote), '') IS NOT NULL
        AND NULLIF(btrim(option_row.raw_text), '') IS NOT NULL
        AND option_row.confidence IS NOT NULL
        AND vendor.status = 'approved'
        AND vendor.merged_into_vendor_id IS NULL
        AND vendor.slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'
        AND (agency.id IS NULL OR (
          agency.is_active IS TRUE
          AND agency.merged_into_agency_id IS NULL
        ))
    ),
    'v_public_agency_packages', EXISTS (
      SELECT 1
      FROM public.official_agency_packages AS package_row
      JOIN public.price_snapshots AS snapshot ON snapshot.id = package_row.snapshot_id
      JOIN public.agencies AS agency ON agency.id = package_row.agency_id
      JOIN public.v_public_agency_packages AS public_package
        ON public_package.id = package_row.id
      WHERE package_row.id = ${sqlLiteral(config.publicAgencyPackageId)}::uuid
        AND snapshot.published IS TRUE
        AND snapshot.is_current IS TRUE
        AND package_row.review_status = 'approved'
        AND package_row.needs_review IS FALSE
        AND cardinality(package_row.source_object_keys) > 0
        AND NULLIF(btrim(package_row.source_quote), '') IS NOT NULL
        AND package_row.confidence IS NOT NULL
        AND agency.is_active IS TRUE
        AND agency.merged_into_agency_id IS NULL
    )
  ) AS positive_fixtures_verified,
  json_build_object(
    'v_public_vendors', (
      SELECT count(*)::integer
      FROM public.v_public_vendors AS public_vendor
      LEFT JOIN public.vendors AS vendor ON vendor.id = public_vendor.id
      WHERE vendor.id IS NULL
        OR vendor.status IS DISTINCT FROM 'approved'
        OR vendor.merged_into_vendor_id IS NOT NULL
        OR NULLIF(btrim(vendor.slug), '') IS NULL
        OR vendor.slug !~ '^[a-z0-9][a-z0-9-]{0,119}$'
    ),
    'v_public_prices', (
      SELECT count(*)::integer
      FROM public.v_public_prices AS public_price
      LEFT JOIN public.official_prices AS price
        ON price.id = public_price.official_price_id
      LEFT JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
      LEFT JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
      LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
      WHERE price.id IS NULL
        OR snapshot.published IS NOT TRUE
        OR price.review_status IS DISTINCT FROM 'approved'
        OR price.needs_review IS NOT FALSE
        OR price.category IS NULL
        OR price.category NOT IN ('studio', 'dress', 'makeup', 'hall', 'other')
        OR COALESCE(cardinality(price.source_object_keys), 0) = 0
        OR NULLIF(btrim(price.source_quote), '') IS NULL
        OR price.confidence IS NULL
        OR vendor.id IS NULL
        OR vendor.status IS DISTINCT FROM 'approved'
        OR vendor.merged_into_vendor_id IS NOT NULL
        OR NULLIF(btrim(vendor.slug), '') IS NULL
        OR vendor.slug !~ '^[a-z0-9][a-z0-9-]{0,119}$'
        OR (price.agency_id IS NOT NULL AND (
          agency.id IS NULL
          OR agency.is_active IS NOT TRUE
          OR agency.merged_into_agency_id IS NOT NULL
        ))
    ),
    'v_public_price_options', (
      SELECT count(*)::integer
      FROM public.v_public_price_options AS public_option
      LEFT JOIN public.official_price_options AS option_row
        ON option_row.id = public_option.id
      LEFT JOIN public.official_prices AS price
        ON price.id = option_row.official_price_id
      LEFT JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
      LEFT JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
      LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
      WHERE option_row.id IS NULL
        OR snapshot.published IS NOT TRUE
        OR price.review_status IS DISTINCT FROM 'approved'
        OR price.needs_review IS NOT FALSE
        OR price.category IS NULL
        OR price.category NOT IN ('studio', 'dress', 'makeup', 'hall', 'other')
        OR COALESCE(cardinality(price.source_object_keys), 0) = 0
        OR NULLIF(btrim(price.source_quote), '') IS NULL
        OR price.confidence IS NULL
        OR COALESCE(cardinality(option_row.source_object_keys), 0) = 0
        OR NULLIF(btrim(option_row.source_quote), '') IS NULL
        OR NULLIF(btrim(option_row.raw_text), '') IS NULL
        OR option_row.confidence IS NULL
        OR vendor.id IS NULL
        OR vendor.status IS DISTINCT FROM 'approved'
        OR vendor.merged_into_vendor_id IS NOT NULL
        OR NULLIF(btrim(vendor.slug), '') IS NULL
        OR vendor.slug !~ '^[a-z0-9][a-z0-9-]{0,119}$'
        OR (price.agency_id IS NOT NULL AND (
          agency.id IS NULL
          OR agency.is_active IS NOT TRUE
          OR agency.merged_into_agency_id IS NOT NULL
        ))
    ),
    'v_public_agency_packages', (
      SELECT count(*)::integer
      FROM public.v_public_agency_packages AS public_package
      LEFT JOIN public.official_agency_packages AS package_row
        ON package_row.id = public_package.id
      LEFT JOIN public.price_snapshots AS snapshot
        ON snapshot.id = package_row.snapshot_id
      LEFT JOIN public.agencies AS agency ON agency.id = package_row.agency_id
      WHERE package_row.id IS NULL
        OR snapshot.published IS NOT TRUE
        OR package_row.review_status IS DISTINCT FROM 'approved'
        OR package_row.needs_review IS NOT FALSE
        OR COALESCE(cardinality(package_row.source_object_keys), 0) = 0
        OR NULLIF(btrim(package_row.source_quote), '') IS NULL
        OR package_row.confidence IS NULL
        OR agency.id IS NULL
        OR agency.is_active IS NOT TRUE
        OR agency.merged_into_agency_id IS NOT NULL
    )
  ) AS public_view_invariant_violation_counts,
  json_build_object(
    'v_public_vendors', (
      EXISTS (
        SELECT 1 FROM public.vendors AS vendor
        WHERE vendor.id = ${sqlLiteral(config.nonPublicVendorId)}::uuid
          AND vendor.status IN ('pending', 'rejected', 'draft')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.v_public_vendors AS public_vendor
        WHERE public_vendor.id = ${sqlLiteral(config.nonPublicVendorId)}::uuid
      )
    ),
    'v_public_prices', (
      EXISTS (
        SELECT 1
        FROM public.official_prices AS price
        JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
        WHERE price.id = ${sqlLiteral(config.nonPublicPriceId)}::uuid
          AND (
            price.review_status IN ('pending', 'rejected')
            OR price.needs_review IS TRUE
            OR snapshot.published IS NOT TRUE
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.v_public_prices AS public_price
        WHERE public_price.official_price_id = ${sqlLiteral(config.nonPublicPriceId)}::uuid
      )
    ),
    'v_public_price_options', (
      EXISTS (
        SELECT 1
        FROM public.official_price_options AS option_row
        JOIN public.official_prices AS price
          ON price.id = option_row.official_price_id
        JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
        WHERE option_row.id = ${sqlLiteral(config.nonPublicOptionId)}::uuid
          AND (
            price.review_status IN ('pending', 'rejected')
            OR price.needs_review IS TRUE
            OR snapshot.published IS NOT TRUE
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.v_public_price_options AS public_option
        WHERE public_option.id = ${sqlLiteral(config.nonPublicOptionId)}::uuid
      )
    ),
    'v_public_agency_packages', (
      EXISTS (
        SELECT 1
        FROM public.official_agency_packages AS package_row
        JOIN public.price_snapshots AS snapshot
          ON snapshot.id = package_row.snapshot_id
        WHERE package_row.id = ${sqlLiteral(config.nonPublicAgencyPackageId)}::uuid
          AND (
            package_row.review_status IN ('pending', 'rejected')
            OR package_row.needs_review IS TRUE
            OR snapshot.published IS NOT TRUE
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.v_public_agency_packages AS public_package
        WHERE public_package.id = ${sqlLiteral(config.nonPublicAgencyPackageId)}::uuid
      )
    )
  ) AS nonpublic_fixtures_verified`.trim();
}

async function readBoundedJsonResponse(response, code) {
  let text;
  try {
    text = await response.text();
  } catch {
    fail(code, "Hosted-staging Management API response could not be read");
  }
  if (Buffer.byteLength(text, "utf8") < 2
      || Buffer.byteLength(text, "utf8") > MAX_MANAGEMENT_RESPONSE_BYTES) {
    fail(code, "Hosted-staging Management API response size is invalid");
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(code, "Hosted-staging Management API response is not valid JSON");
  }
}

async function readHostedStagingInventory({ fetchImpl, config, release }) {
  const sql = buildHostedStagingInventorySql({ config, release });
  const response = await safeFetch(
    fetchImpl,
    `https://api.supabase.com/v1/projects/${config.stagingProjectRef}/database/query/read-only`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.supabaseAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql, parameters: [] }),
      redirect: "error",
    },
    "hosted-staging migration ledger and schema inventory",
  );
  const payload = await readBoundedJsonResponse(
    response,
    "REMOTE_LEDGER_UNVERIFIABLE",
  );
  if (response.status !== 201
      || !Array.isArray(payload)
      || payload.length !== 1
      || !hasExactKeys(payload[0], [
        "ledger_head",
        "invalid_ledger_version_count",
        "required_remote_head_count",
        "successor_versions",
        "base_columns",
        "owned_columns",
        "public_view_inventory",
        "positive_fixtures_verified",
        "public_view_invariant_violation_counts",
        "nonpublic_fixtures_verified",
      ])) {
    fail(
      "REMOTE_LEDGER_UNVERIFIABLE",
      "Hosted-staging migration ledger response is incomplete",
    );
  }
  const row = payload[0];
  if (row.ledger_head !== release.successorMigrationHead
      || row.invalid_ledger_version_count !== 0
      || row.required_remote_head_count !== 1
      || JSON.stringify(row.successor_versions)
        !== JSON.stringify(release.successorMigrationVersions)) {
    fail(
      "REMOTE_MIGRATION_LEDGER_MISMATCH",
      "Hosted-staging applied migrations do not exactly match the successor manifest",
    );
  }
  if (!hasExactKeys(
    row.nonpublic_fixtures_verified,
    PUBLIC_DISCLOSURE_VIEWS.map(({ name }) => name),
  ) || Object.values(row.nonpublic_fixtures_verified).some((value) => value !== true)) {
    fail(
      "NONPUBLIC_FIXTURE_UNVERIFIABLE",
      "Hosted-staging non-public fixtures are absent or not in a rejected/pending/unpublished state",
    );
  }
  const publicViewNames = PUBLIC_DISCLOSURE_VIEWS.map(({ name }) => name);
  if (!hasExactKeys(row.positive_fixtures_verified, publicViewNames)
      || Object.values(row.positive_fixtures_verified).some((value) => value !== true)) {
    fail(
      "PUBLIC_POSITIVE_FIXTURE_INVALID",
      "Public positive fixtures do not have exact approved, evidenced, current base state",
    );
  }
  if (!hasExactKeys(row.public_view_invariant_violation_counts, publicViewNames)
      || Object.values(row.public_view_invariant_violation_counts)
        .some((value) => value !== 0)) {
    fail(
      "PUBLIC_VIEW_INVARIANT_VIOLATION",
      "A live public view exposes a row outside the approved evidence invariants",
    );
  }
  if (!Array.isArray(row.base_columns) || row.base_columns.length === 0) {
    fail("BASE_COLUMN_INVENTORY_INVALID", "Hosted-staging base-column inventory is empty");
  }
  const seen = new Set();
  const columns = row.base_columns.map((entry) => {
    if (!hasExactKeys(entry, ["table_name", "column_name"])
        || !VENDOR_DISCLOSURE_BASE_TABLES.includes(entry.table_name)
        || !COLUMN_IDENTIFIER.test(entry.column_name ?? "")) {
      fail("BASE_COLUMN_INVENTORY_INVALID", "Hosted-staging base-column inventory is invalid");
    }
    const key = `${entry.table_name}.${entry.column_name}`;
    if (seen.has(key)) {
      fail("BASE_COLUMN_INVENTORY_INVALID", "Hosted-staging base-column inventory is duplicated");
    }
    seen.add(key);
    return { table: entry.table_name, column: entry.column_name };
  });
  for (const table of VENDOR_DISCLOSURE_BASE_TABLES) {
    if (!columns.some((entry) => entry.table === table)) {
      fail("BASE_COLUMN_INVENTORY_INVALID", `Hosted-staging base table is absent: ${table}`);
    }
  }
  if (!Array.isArray(row.owned_columns) || row.owned_columns.length === 0) {
    fail("OWNED_COLUMN_INVENTORY_INVALID", "Hosted-staging owned-column inventory is empty");
  }
  const ownedSeen = new Set();
  const ownedColumns = row.owned_columns.map((entry) => {
    if (!hasExactKeys(entry, ["table_name", "column_name"])
        || !OWNED_APPLICATION_TABLES.includes(entry.table_name)
        || !COLUMN_IDENTIFIER.test(entry.column_name ?? "")) {
      fail("OWNED_COLUMN_INVENTORY_INVALID", "Hosted-staging owned-column inventory is invalid");
    }
    const key = `${entry.table_name}.${entry.column_name}`;
    if (ownedSeen.has(key)) {
      fail("OWNED_COLUMN_INVENTORY_INVALID", "Hosted-staging owned-column inventory is duplicated");
    }
    ownedSeen.add(key);
    return { table: entry.table_name, column: entry.column_name };
  });
  for (const table of OWNED_APPLICATION_TABLES) {
    if (!ownedColumns.some((entry) => entry.table === table)) {
      fail("OWNED_COLUMN_INVENTORY_INVALID", `Hosted-staging owned table is absent: ${table}`);
    }
  }
  if (!Array.isArray(row.public_view_inventory)
      || row.public_view_inventory.length !== PUBLIC_DISCLOSURE_VIEWS.length) {
    fail("PUBLIC_VIEW_CONTRACT_INVALID", "Hosted-staging public-view inventory is incomplete");
  }
  const publicViewContract = [];
  for (const expected of PUBLIC_DISCLOSURE_VIEWS) {
    const actual = row.public_view_inventory.find(
      (entry) => entry?.view_name === expected.name,
    );
    const definitionSha256 = typeof actual?.definition === "string"
      ? canonicalSha256(`${actual.definition}\n`)
      : null;
    if (!hasExactKeys(actual, ["view_name", "columns", "reloptions", "definition"])
        || JSON.stringify(actual.columns) !== JSON.stringify(expected.allowedColumns)
        || !Array.isArray(actual.reloptions)
        || JSON.stringify([...actual.reloptions].sort())
          !== JSON.stringify(["security_barrier=true", "security_invoker=false"].sort())
        || typeof actual.definition !== "string"
        || actual.definition.length < 20
        || actual.definition.length > 128 * 1024
        || definitionSha256 !== config.publicViewDefinitionSha256[expected.name]) {
      fail(
        "PUBLIC_VIEW_CONTRACT_INVALID",
        `Hosted-staging public-view definition, security mode, or columns drifted: ${expected.name}`,
      );
    }
    publicViewContract.push({
      name: expected.name,
      columns: actual.columns,
      reloptions: [...actual.reloptions].sort(),
      definitionSha256,
    });
  }
  const sortedContract = columns
    .map(({ table, column }) => `${table}.${column}`)
    .sort()
    .join("\n");
  const sortedOwnedContract = ownedColumns
    .map(({ table, column }) => `${table}.${column}`)
    .sort()
    .join("\n");
  return {
    columns,
    columnInventorySha256: canonicalSha256(`${sortedContract}\n`),
    ownedColumns,
    ownedColumnInventorySha256: canonicalSha256(`${sortedOwnedContract}\n`),
    publicViewContractSha256: canonicalSha256(
      `${JSON.stringify(publicViewContract)}\n`,
    ),
    managementQuerySha256: canonicalSha256(`${sql}\n`),
    ledgerHead: row.ledger_head,
    successorVersionSetSha256: canonicalSha256(
      `${row.successor_versions.join("\n")}\n`,
    ),
  };
}

function restUrl(origin, relation, params) {
  return `${origin}/rest/v1/${relation}?${new URLSearchParams(params)}`;
}

function headersFor(anonKey, bearer) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${bearer}`,
  };
}

async function signInFixtureUser({ fetchImpl, config, user, label }) {
  const response = await safeFetch(
    fetchImpl,
    `${config.supabaseOrigin}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
    `${label} authentication`,
  );
  if (!response.ok) {
    fail("AUTHENTICATION_FAILED", `Hosted-staging fixture authentication failed: ${label}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("AUTHENTICATION_RESPONSE_INVALID", `Fixture authentication response is invalid: ${label}`);
  }
  if (typeof payload?.access_token !== "string"
      || payload.access_token.length < 16
      || payload?.user?.id?.toLowerCase() !== user.id) {
    fail("AUTHENTICATION_IDENTITY_MISMATCH", `Fixture identity did not match: ${label}`);
  }
  return payload.access_token;
}

async function assertBaseTableDenied({
  fetchImpl,
  config,
  bearer,
  actor,
  table,
  column,
}) {
  const response = await safeFetch(
    fetchImpl,
    restUrl(config.supabaseOrigin, table, { select: column, limit: "1" }),
    { headers: headersFor(config.anonKey, bearer) },
    `${actor} ${table}.${column} base-column deny`,
  );
  if (response.ok) {
    fail(
      "BASE_TABLE_EXPOSED",
      `Hosted-staging RLS failed: ${actor} can query base column ${table}.${column}`,
    );
  }
  if (![401, 403].includes(response.status)) {
    fail(
      "BASE_TABLE_DENY_UNEXPECTED",
      `Base-column deny returned an unexpected status: ${actor} ${table}.${column} status=${response.status}`,
    );
  }
}

async function assertPublicFixtureReadable({
  fetchImpl,
  config,
  bearer,
  actor,
  view,
}) {
  const expectedId = config[view.fixtureKey];
  const rows = await readArrayResponse(
    await safeFetch(
      fetchImpl,
      restUrl(config.supabaseOrigin, view.name, {
        select: view.idColumn,
        [view.idColumn]: `eq.${expectedId}`,
        limit: "2",
      }),
      { headers: headersFor(config.anonKey, bearer) },
      `${actor} ${view.name} public fixture`,
    ),
    `${actor} ${view.name} public fixture`,
  );
  if (rows.length !== 1 || rows[0]?.[view.idColumn]?.toLowerCase() !== expectedId) {
    fail(
      "PUBLIC_FIXTURE_MISSING",
      `Expected public fixture is not readable: ${actor} ${view.name}`,
    );
  }
}

async function assertNonPublicFixtureHidden({
  fetchImpl,
  config,
  bearer,
  actor,
  view,
}) {
  const excludedId = config[view.nonPublicFixtureKey];
  const rows = await readArrayResponse(
    await safeFetch(
      fetchImpl,
      restUrl(config.supabaseOrigin, view.name, {
        select: view.idColumn,
        [view.idColumn]: `eq.${excludedId}`,
        limit: "2",
      }),
      { headers: headersFor(config.anonKey, bearer) },
      `${actor} ${view.name} non-public fixture`,
    ),
    `${actor} ${view.name} non-public fixture`,
  );
  if (rows.length !== 0) {
    fail(
      "NONPUBLIC_FIXTURE_EXPOSED",
      `Rejected, pending, or unpublished fixture is public: ${actor} ${view.name}`,
    );
  }
}

function ownedFixture(table, user) {
  if (table === "combos") {
    return {
      params: { select: "id,user_id", id: `eq.${user.comboId}`, limit: "2" },
      matches: (row) => row?.id?.toLowerCase() === user.comboId
        && row?.user_id?.toLowerCase() === user.id,
    };
  }
  return {
    params: {
      select: "user_id,vendor_id",
      user_id: `eq.${user.id}`,
      vendor_id: `eq.${user.vendorId}`,
      limit: "2",
    },
    matches: (row) => row?.user_id?.toLowerCase() === user.id
      && row?.vendor_id?.toLowerCase() === user.vendorId,
  };
}

async function readOwnedFixture({
  fetchImpl,
  config,
  bearer,
  observerLabel,
  subject,
  table,
}) {
  const fixture = ownedFixture(table, subject);
  return readArrayResponse(
    await safeFetch(
      fetchImpl,
      restUrl(config.supabaseOrigin, table, fixture.params),
      { headers: headersFor(config.anonKey, bearer) },
      `${observerLabel} ${table} fixture read`,
    ),
    `${observerLabel} ${table} fixture read`,
  );
}

async function assertTwoUserIsolation({ fetchImpl, config, sessions }) {
  const ownedTables = OWNED_APPLICATION_TABLES;
  for (let observerIndex = 0; observerIndex < sessions.length; observerIndex += 1) {
    const observer = sessions[observerIndex];
    const subject = sessions[1 - observerIndex];
    for (const table of ownedTables) {
      const ownFixture = ownedFixture(table, observer.user);
      const ownRows = await readOwnedFixture({
        fetchImpl,
        config,
        bearer: observer.accessToken,
        observerLabel: observer.label,
        subject: observer.user,
        table,
      });
      if (ownRows.length !== 1 || !ownFixture.matches(ownRows[0])) {
        fail("OWN_FIXTURE_MISSING", `Own fixture is not readable: ${observer.label} ${table}`);
      }
      const crossRows = await readOwnedFixture({
        fetchImpl,
        config,
        bearer: observer.accessToken,
        observerLabel: observer.label,
        subject: subject.user,
        table,
      });
      if (crossRows.length !== 0) {
        fail(
          "CROSS_USER_ROW_EXPOSED",
          `Two-user isolation failed: ${observer.label} can read another user's ${table}`,
        );
      }
    }
  }
}

async function assertOwnedTablesDeniedToAnon({ fetchImpl, config, inventory }) {
  for (const { table, column } of inventory.ownedColumns) {
    const response = await safeFetch(
      fetchImpl,
      restUrl(config.supabaseOrigin, table, { select: column, limit: "1" }),
      { headers: headersFor(config.anonKey, config.anonKey) },
      `anonymous ${table}.${column} deny`,
    );
    if (response.ok) {
      fail(
        "ANON_OWNED_TABLE_EXPOSED",
        `Hosted-staging RLS failed: anonymous can query ${table}.${column}`,
      );
    }
    if (![401, 403].includes(response.status)) {
      fail(
        "ANON_OWNED_TABLE_DENY_UNEXPECTED",
        `Anonymous ${table}.${column} deny returned status=${response.status}`,
      );
    }
  }
}

function deterministicProbeUuid(config, label) {
  const hex = canonicalSha256(
    `${config.users.map(({ id }) => id).join(":")}:${label}\n`,
  ).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function policyProbeRows(table, config) {
  const [userA, userB] = config.users;
  if (table === "combos") {
    return {
      owner: {
        id: deterministicProbeUuid(config, "combos-owner"),
        user_id: userA.id,
        name: "Hosted RLS owner probe",
        selections: {},
      },
      cross: {
        id: deterministicProbeUuid(config, "combos-cross"),
        user_id: userB.id,
        name: "Hosted RLS cross-user probe",
        selections: {},
      },
    };
  }
  return {
    owner: { user_id: userA.id, vendor_id: userB.vendorId },
    cross: { user_id: userB.id, vendor_id: userA.vendorId },
  };
}

function policyRowParams(table, row) {
  if (table === "combos") {
    return { id: `eq.${row.id}` };
  }
  return {
    user_id: `eq.${row.user_id}`,
    vendor_id: `eq.${row.vendor_id}`,
  };
}

function policyRowSelect(table) {
  return table === "combos" ? "id,user_id" : "user_id,vendor_id";
}

function policyRowMatches(table, actual, expected) {
  if (table === "combos") {
    return actual?.id?.toLowerCase() === expected.id
      && actual?.user_id?.toLowerCase() === expected.user_id;
  }
  return actual?.user_id?.toLowerCase() === expected.user_id
    && actual?.vendor_id?.toLowerCase() === expected.vendor_id;
}

function policyUpdateBody(table, variant) {
  if (table === "combos") {
    return { name: `Hosted RLS ${variant} update probe` };
  }
  return {
    created_at: variant === "owner"
      ? "2001-01-01T00:00:00.000Z"
      : "2002-02-02T00:00:00.000Z",
  };
}

function policyHeaders(config, bearer, includeBody = false) {
  return {
    ...headersFor(config.anonKey, bearer),
    ...(includeBody ? { "Content-Type": "application/json" } : {}),
    Prefer: "return=representation",
  };
}

async function policyRequest({
  fetchImpl,
  config,
  bearer,
  table,
  method,
  row,
  body,
  label,
}) {
  const params = method === "POST" ? {} : policyRowParams(table, row);
  return safeFetch(
    fetchImpl,
    restUrl(config.supabaseOrigin, table, params),
    {
      method,
      headers: policyHeaders(config, bearer, body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    label,
  );
}

async function readExactPolicyRow({
  fetchImpl,
  config,
  session,
  table,
  row,
  label,
}) {
  return readArrayResponse(
    await safeFetch(
      fetchImpl,
      restUrl(config.supabaseOrigin, table, {
        select: policyRowSelect(table),
        ...policyRowParams(table, row),
        limit: "2",
      }),
      { headers: headersFor(config.anonKey, session.accessToken) },
      label,
    ),
    label,
  );
}

function assertDeniedResponse(response, code, message) {
  if (![401, 403].includes(response.status)) {
    fail(code, `${message}; status=${response.status}`);
  }
}

function policyMutationValueMatches(key, actual, expected) {
  if (key.endsWith("_at")
      && typeof actual === "string"
      && typeof expected === "string") {
    const actualTime = Date.parse(actual);
    const expectedTime = Date.parse(expected);
    return Number.isFinite(actualTime)
      && Number.isFinite(expectedTime)
      && actualTime === expectedTime;
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function assertRepresentedPolicyRow(
  response,
  table,
  row,
  code,
  label,
  expectedMutation = null,
) {
  const rows = await readArrayResponse(response, label);
  const mutationMatches = expectedMutation === null
    || Object.entries(expectedMutation).every(([key, value]) =>
      policyMutationValueMatches(key, rows[0]?.[key], value));
  if (rows.length !== 1
      || !policyRowMatches(table, rows[0], row)
      || !mutationMatches) {
    fail(code, `Policy probe did not return the exact row: ${label}`);
  }
}

async function assertCrossPolicyAffectedNoRows(response, code, label) {
  const rows = await readArrayResponse(response, label);
  if (rows.length !== 0) {
    fail(code, `Cross-user policy probe affected a row: ${label}`);
  }
}

async function cleanupPolicyProbeRow({
  fetchImpl,
  config,
  session,
  table,
  row,
}) {
  let deleteFailed = false;
  try {
    const response = await policyRequest({
      fetchImpl,
      config,
      bearer: session.accessToken,
      table,
      method: "DELETE",
      row,
      label: `${session.label} ${table} policy cleanup`,
    });
    if (!response.ok) {
      deleteFailed = true;
    } else {
      await readArrayResponse(response, `${session.label} ${table} policy cleanup`);
    }
  } catch {
    deleteFailed = true;
  }

  let verificationFailed = false;
  try {
    const remaining = await readExactPolicyRow({
      fetchImpl,
      config,
      session,
      table,
      row,
      label: `${session.label} ${table} cleanup verification`,
    });
    verificationFailed = remaining.length !== 0;
  } catch {
    verificationFailed = true;
  }

  if (deleteFailed || verificationFailed) {
    fail(
      "POLICY_PROBE_CLEANUP_FAILED",
      `Policy probe cleanup or zero-row verification failed: ${session.label} ${table}`,
    );
  }
}

async function assertOwnedMutationPolicies({ fetchImpl, config, sessions }) {
  const [userA, userB] = sessions;
  for (const table of OWNED_APPLICATION_TABLES) {
    const rows = policyProbeRows(table, config);
    const preOwner = await readExactPolicyRow({
      fetchImpl,
      config,
      session: userA,
      table,
      row: rows.owner,
      label: `${table} owner mutation precondition`,
    });
    const preCross = await readExactPolicyRow({
      fetchImpl,
      config,
      session: userB,
      table,
      row: rows.cross,
      label: `${table} cross mutation precondition`,
    });
    if (preOwner.length !== 0 || preCross.length !== 0) {
      fail(
        "POLICY_PROBE_FIXTURE_NOT_CLEAN",
        `Deterministic policy probe row already exists: ${table}`,
      );
    }

    let primaryFailure = null;
    try {
      const ownerInsert = await policyRequest({
        fetchImpl,
        config,
        bearer: userA.accessToken,
        table,
        method: "POST",
        row: rows.owner,
        body: rows.owner,
        label: `${table} owner INSERT`,
      });
      if (table === "combos") {
        assertDeniedResponse(
          ownerInsert,
          "OWNER_COMBO_DIRECT_INSERT_EXPOSED",
          "Combo owner INSERT must use the server-only save boundary",
        );
      } else {
        if (ownerInsert.status !== 201) {
          fail("OWNER_POLICY_INSERT_FAILED", `Owner INSERT failed: ${table}`);
        }
        await assertRepresentedPolicyRow(
          ownerInsert,
          table,
          rows.owner,
          "OWNER_POLICY_INSERT_FAILED",
          `${table} owner INSERT`,
        );
      }

      for (const [method, row, body] of [
        ["POST", rows.cross, rows.cross],
        ["PATCH", rows.owner, policyUpdateBody(table, "anonymous")],
        ["DELETE", rows.owner, undefined],
      ]) {
        const response = await policyRequest({
          fetchImpl,
          config,
          bearer: config.anonKey,
          table,
          method,
          row,
          body,
          label: `${table} anonymous ${method}`,
        });
        assertDeniedResponse(
          response,
          "ANON_OWNED_TABLE_EXPOSED",
          `Anonymous ${method} is not denied on ${table}`,
        );
      }

      const crossInsert = await policyRequest({
        fetchImpl,
        config,
        bearer: userA.accessToken,
        table,
        method: "POST",
        row: rows.cross,
        body: rows.cross,
        label: `${table} cross-user INSERT`,
      });
      assertDeniedResponse(
        crossInsert,
        "CROSS_USER_POLICY_INSERT_EXPOSED",
        `Cross-user INSERT is not denied on ${table}`,
      );

      const crossUpdate = await policyRequest({
        fetchImpl,
        config,
        bearer: userB.accessToken,
        table,
        method: "PATCH",
        row: rows.owner,
        body: policyUpdateBody(table, "cross-user"),
        label: `${table} cross-user UPDATE`,
      });
      if (["vendor_favorites", "wishlists", "combos"].includes(table)) {
        assertDeniedResponse(
          crossUpdate,
          "CROSS_USER_POLICY_UPDATE_EXPOSED",
          "Direct UPDATE must remain revoked for wishlist and combo boundaries",
        );
      } else {
        await assertCrossPolicyAffectedNoRows(
          crossUpdate,
          "CROSS_USER_POLICY_UPDATE_EXPOSED",
          `${table} cross-user UPDATE`,
        );
      }

      const crossDelete = await policyRequest({
        fetchImpl,
        config,
        bearer: userB.accessToken,
        table,
        method: "DELETE",
        row: rows.owner,
        label: `${table} cross-user DELETE`,
      });
      await assertCrossPolicyAffectedNoRows(
        crossDelete,
        "CROSS_USER_POLICY_DELETE_EXPOSED",
        `${table} cross-user DELETE`,
      );

      const ownerUpdate = await policyRequest({
        fetchImpl,
        config,
        bearer: userA.accessToken,
        table,
        method: "PATCH",
        row: rows.owner,
        body: policyUpdateBody(table, "owner"),
        label: `${table} owner UPDATE`,
      });
      if (["vendor_favorites", "wishlists", "combos"].includes(table)) {
        assertDeniedResponse(
          ownerUpdate,
          "OWNER_POLICY_UPDATE_CONTRACT_BROKEN",
          "Wishlist and combo owner UPDATE must remain revoked",
        );
      } else {
        const expectedMutation = policyUpdateBody(table, "owner");
        await assertRepresentedPolicyRow(
          ownerUpdate,
          table,
          rows.owner,
          "OWNER_POLICY_UPDATE_FAILED",
          `${table} owner UPDATE`,
          expectedMutation,
        );
      }

      const ownerDelete = await policyRequest({
        fetchImpl,
        config,
        bearer: userA.accessToken,
        table,
        method: "DELETE",
        row: rows.owner,
        label: `${table} owner DELETE`,
      });
      if (table === "combos") {
        await assertCrossPolicyAffectedNoRows(
          ownerDelete,
          "OWNER_POLICY_DELETE_FAILED",
          `${table} owner DELETE transport`,
        );
      } else {
        await assertRepresentedPolicyRow(
          ownerDelete,
          table,
          rows.owner,
          "OWNER_POLICY_DELETE_FAILED",
          `${table} owner DELETE`,
        );
      }
    } catch (error) {
      primaryFailure = error;
    }

    const cleanupResults = await Promise.allSettled([
      cleanupPolicyProbeRow({
        fetchImpl,
        config,
        session: userA,
        table,
        row: rows.owner,
      }),
      cleanupPolicyProbeRow({
        fetchImpl,
        config,
        session: userB,
        table,
        row: rows.cross,
      }),
    ]);
    if (cleanupResults.some(({ status }) => status === "rejected")) {
      fail(
        "POLICY_PROBE_CLEANUP_FAILED",
        `One or more policy probe rows could not be proven absent after cleanup: ${table}`,
      );
    }
    if (primaryFailure) throw primaryFailure;
  }
  return {
    ownerInsertsAllowed: 3,
    ownerDirectComboInsertsDenied: 1,
    ownerUpdatesAllowed: 1,
    ownerUpdateDeniedByContract: 3,
    ownerDeletesAllowed: 3,
    ownerComboDeleteTransportAllowed: 1,
    crossUserInsertsDenied: 4,
    crossUserUpdatesAffectedRows: 0,
    crossUserDeletesAffectedRows: 0,
    policyProbeRowsRetained: 0,
  };
}

function buildReceipt({
  config,
  release,
  inventory,
  policyProbe,
  commit,
  repositoryBindingSha256,
  checkedAt,
}) {
  const fixtureSubjectsSha256 = canonicalSha256(
    `${config.users.map((user) => user.id).sort().join("\n")}\n`,
  );
  return {
    receiptVersion: 2,
    kind: "vendor-disclosure-hosted-staging-rls",
    scope: "hosted_staging_only",
    productionReadiness: false,
    deploymentAuthorization: false,
    projectRef: config.stagingProjectRef,
    hostedStagingContractSha256: config.stagingContractSha256,
    hostedStagingApprovalEvidenceSha256:
      config.stagingApprovalEvidenceSha256,
    releaseTargetProjectRef: release.releaseTargetProjectRef,
    release: release.release,
    releaseStatus: release.releaseStatus,
    gitCommit: commit,
    gitTreeClean: true,
    gitRepositoryBindingSha256: repositoryBindingSha256,
    successorManifestSha256: release.successorManifestSha256,
    successorMigrationSetSha256: release.successorMigrationSetSha256,
    successorMigrationHead: release.successorMigrationHead,
    successorMigrationCount: release.successorMigrationCount,
    hostedStagingMigrationLedgerHead: inventory.ledgerHead,
    hostedStagingSuccessorVersionSetSha256:
      inventory.successorVersionSetSha256,
    hostedStagingManagementQuerySha256: inventory.managementQuerySha256,
    baseColumnInventorySha256: inventory.columnInventorySha256,
    ownedColumnInventorySha256: inventory.ownedColumnInventorySha256,
    publicViewContractSha256: inventory.publicViewContractSha256,
    fixtureSubjectsSha256,
    checkedAt,
    checks: {
      anonymousBaseColumnsDenied: inventory.columns.length,
      authenticatedBaseColumnsDenied: inventory.columns.length,
      anonymousPublicFixturesRead: PUBLIC_DISCLOSURE_VIEWS.length,
      authenticatedPublicFixturesRead: PUBLIC_DISCLOSURE_VIEWS.length,
      anonymousNonPublicFixturesVisible: 0,
      authenticatedNonPublicFixturesVisible: 0,
      hostedStagingLedgerMatchesSuccessorManifest: true,
      nonPublicFixturesVerifiedInBaseTables: PUBLIC_DISCLOSURE_VIEWS.length,
      publicViewInvariantViolations: 0,
      positivePublicBaseFixturesVerified: PUBLIC_DISCLOSURE_VIEWS.length,
      ownPrivateFixturesRead: OWNED_APPLICATION_TABLES.length * 2,
      crossUserPrivateRowsVisible: 0,
      ownedTables: OWNED_APPLICATION_TABLES,
      anonymousOwnedColumnsDenied: inventory.ownedColumns.length,
      anonymousOwnedTableOperationsDenied:
        OWNED_APPLICATION_TABLES.length * 4,
      ownerPolicyInsertsAllowed: policyProbe.ownerInsertsAllowed,
      ownerDirectComboInsertsDenied:
        policyProbe.ownerDirectComboInsertsDenied,
      ownerPolicyUpdatesAllowed: policyProbe.ownerUpdatesAllowed,
      ownerPolicyUpdateDeniedByContract:
        policyProbe.ownerUpdateDeniedByContract,
      ownerPolicyDeletesAllowed: policyProbe.ownerDeletesAllowed,
      ownerComboDeleteTransportAllowed:
        policyProbe.ownerComboDeleteTransportAllowed,
      crossUserPolicyInsertsDenied: policyProbe.crossUserInsertsDenied,
      crossUserPolicyUpdatesAffectedRows:
        policyProbe.crossUserUpdatesAffectedRows,
      crossUserPolicyDeletesAffectedRows:
        policyProbe.crossUserDeletesAffectedRows,
      policyProbeRowsRetained: policyProbe.policyProbeRowsRetained,
      managementApiRequestsReadOnly: true,
      applicationDataWritesLimitedToPolicyProbes: true,
    },
  };
}

export function writeProbeReceipt({ repoRoot, receiptPath, receipt }) {
  const root = realpathSync(resolve(repoRoot));
  const parent = dirname(receiptPath);
  const parentMetadata = existsSync(parent) ? lstatSync(parent) : null;
  if (!parentMetadata?.isDirectory() || parentMetadata.isSymbolicLink()) {
    fail("RECEIPT_PARENT_INVALID", "Receipt parent must be an existing non-symlink directory");
  }
  const realParent = realpathSync(parent);
  const outputPath = resolve(realParent, basename(receiptPath));
  if (inside(root, outputPath) || existsSync(outputPath)) {
    fail(
      "RECEIPT_DESTINATION_UNSAFE",
      "Receipt must be new and stored outside the Git repository",
    );
  }
  try {
    writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    fail("RECEIPT_WRITE_FAILED", "Unable to write the hosted-staging RLS receipt");
  }
  return outputPath;
}

export async function executeHostedStagingRlsProbe({
  env,
  repoRoot,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  persistReceipt = true,
}) {
  if (typeof fetchImpl !== "function") {
    fail("FETCH_UNAVAILABLE", "A Fetch-compatible implementation is required");
  }
  const productionProjectRef = required(env, "SUPABASE_PRODUCTION_PROJECT_REF");
  if (!PROJECT_REF.test(productionProjectRef)) {
    fail("PROJECT_REF_INVALID", "Supabase project refs must be exact 20-character refs");
  }
  const hostedStagingBinding = loadApprovedHostedStagingBinding({
    repoRoot,
    productionProjectRef,
  });
  const config = validateProbeEnvironment(env, hostedStagingBinding);
  const observedGitState = readGitState(repoRoot);
  validateGitBinding(observedGitState, config.expectedCommit);
  const release = loadSuccessorReleaseBinding({
    repoRoot,
    productionProjectRef: config.productionProjectRef,
    expectedMigrationSetSha256: config.expectedMigrationSetSha256,
  });
  const preExternalGitState = readGitState(repoRoot);
  validateGitBinding(preExternalGitState, config.expectedCommit);
  validateGitStateUnchanged(observedGitState, preExternalGitState);
  const inventory = await readHostedStagingInventory({
    fetchImpl,
    config,
    release,
  });
  const postInventoryGitState = readGitState(repoRoot);
  validateGitBinding(postInventoryGitState, config.expectedCommit);
  validateGitStateUnchanged(preExternalGitState, postInventoryGitState);

  const sessions = [];
  for (let index = 0; index < config.users.length; index += 1) {
    const user = config.users[index];
    const label = `fixture-user-${index + 1}`;
    sessions.push({
      label,
      user,
      accessToken: await signInFixtureUser({ fetchImpl, config, user, label }),
    });
  }

  const baseColumnProbes = inventory.columns.flatMap(({ table, column }) => [
    {
      bearer: config.anonKey,
      actor: "anonymous",
      table,
      column,
    },
    {
      bearer: sessions[0].accessToken,
      actor: "authenticated",
      table,
      column,
    },
  ]);
  await runBounded(
    baseColumnProbes,
    (probe) => assertBaseTableDenied({
      fetchImpl,
      config,
      ...probe,
    }),
    BASE_COLUMN_PROBE_CONCURRENCY,
  );

  await Promise.all(PUBLIC_DISCLOSURE_VIEWS.flatMap((view) => [
    assertPublicFixtureReadable({
      fetchImpl,
      config,
      bearer: config.anonKey,
      actor: "anonymous",
      view,
    }),
    assertPublicFixtureReadable({
      fetchImpl,
      config,
      bearer: sessions[0].accessToken,
      actor: "authenticated",
      view,
    }),
    assertNonPublicFixtureHidden({
      fetchImpl,
      config,
      bearer: config.anonKey,
      actor: "anonymous",
      view,
    }),
    assertNonPublicFixtureHidden({
      fetchImpl,
      config,
      bearer: sessions[0].accessToken,
      actor: "authenticated",
      view,
    }),
  ]));

  await assertOwnedTablesDeniedToAnon({ fetchImpl, config, inventory });
  await assertTwoUserIsolation({ fetchImpl, config, sessions });
  const preMutationGitState = readGitState(repoRoot);
  validateGitBinding(preMutationGitState, config.expectedCommit);
  validateGitStateUnchanged(postInventoryGitState, preMutationGitState);
  const policyProbe = await assertOwnedMutationPolicies({
    fetchImpl,
    config,
    sessions,
  });

  const checkedAt = now().toISOString();
  const finalGitState = readGitState(repoRoot);
  validateGitBinding(finalGitState, config.expectedCommit);
  validateGitStateUnchanged(preMutationGitState, finalGitState);

  const receipt = buildReceipt({
    config,
    release,
    inventory,
    policyProbe,
    commit: finalGitState.commit,
    repositoryBindingSha256: finalGitState.repositoryBindingSha256,
    checkedAt,
  });
  const receiptPath = persistReceipt
    ? writeProbeReceipt({ repoRoot, receiptPath: config.receiptOut, receipt })
    : null;
  const receiptSha256 = canonicalSha256(`${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, receiptPath, receiptSha256 };
}

function readEnvFile(filePath) {
  const path = resolve(filePath);
  const text = readRegularFile(path, "SUPABASE_ENV_FILE");
  if (Buffer.byteLength(text, "utf8") > 64 * 1024) {
    fail("ENV_FILE_TOO_LARGE", "SUPABASE_ENV_FILE exceeds 64 KiB");
  }
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) fail("ENV_FILE_INVALID", "SUPABASE_ENV_FILE contains an invalid line");
    const key = line.slice(0, index).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || Object.hasOwn(env, key)) {
      fail("ENV_FILE_INVALID", "SUPABASE_ENV_FILE contains an invalid or duplicate key");
    }
    env[key] = line
      .slice(index + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

function cliEnvironment(processEnv) {
  const envFile = processEnv.SUPABASE_ENV_FILE;
  const fileEnv = envFile ? readEnvFile(envFile) : {};
  return { ...fileEnv, ...processEnv };
}

async function main() {
  const repoRoot = process.cwd();
  const result = await executeHostedStagingRlsProbe({
    env: cliEnvironment(process.env),
    repoRoot,
  });
  console.log(JSON.stringify({
    passed: true,
    scope: result.receipt.scope,
    projectRef: result.receipt.projectRef,
    release: result.receipt.release,
    gitCommit: result.receipt.gitCommit,
    successorMigrationSetSha256: result.receipt.successorMigrationSetSha256,
    receiptPath: result.receiptPath,
    receiptSha256: result.receiptSha256,
  }));
}

const isCli = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  try {
    await main();
  } catch (error) {
    if (error instanceof ProbeFailure) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      console.error("UNEXPECTED_PROBE_FAILURE: Hosted-staging RLS probe failed unexpectedly");
    }
    process.exitCode = 1;
  }
}
