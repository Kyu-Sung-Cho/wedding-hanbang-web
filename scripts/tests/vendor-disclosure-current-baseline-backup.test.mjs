import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COMMON = join(REPO_ROOT, "scripts/vendor-disclosure-db-current-baseline-common.ps1");
const CAPTURE = join(REPO_ROOT, "scripts/vendor-disclosure-db-current-baseline.ps1");
const VERIFY = join(REPO_ROOT, "scripts/vendor-disclosure-db-current-baseline-verify.ps1");
const POST_EXPAND_COMMON = join(REPO_ROOT, "scripts/vendor-disclosure-db-backup-common.ps1");
const ROUNDTRIP = join(
  REPO_ROOT,
  "apps/web/scripts/vendor-disclosure-db-current-baseline-roundtrip.mjs",
);

const IMPLEMENTATION_PATHS = Object.freeze([
  "apps/web/package.json",
  "apps/web/scripts/vendor-disclosure-db-current-baseline-roundtrip.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/amora-db-backup-common.ps1",
  "scripts/provenance/amora-verifier-runtime.json",
  "scripts/vendor-disclosure-db-current-baseline-common.ps1",
  "scripts/vendor-disclosure-db-current-baseline.ps1",
  "scripts/vendor-disclosure-db-current-baseline-verify.ps1",
]);

const EXPECTED_TABLES = Object.freeze([
  "account_deletion_jobs",
  "account_deletion_media_manifest",
  "agencies",
  "agency_dedupe_candidates",
  "ai_interactions_log",
  "amora_actions",
  "amora_care_deliveries",
  "amora_care_jobs",
  "amora_care_scan_states",
  "amora_chat_request_claims",
  "amora_conflict_check_claims",
  "amora_couple_profiles",
  "amora_mediation_acceptances",
  "amora_memory_consents",
  "amora_memory_jobs",
  "amora_memory_settings",
  "amora_saved_notes",
  "amora_tool_executions",
  "amora_turn_counters",
  "amora_turn_requests",
  "booking_projection_jobs",
  "chat_feedback",
  "chat_messages",
  "chat_summaries",
  "combos",
  "community_upload_sessions",
  "couples",
  "decision_nodes",
  "disclosure_semantic_staging",
  "events",
  "official_agency_packages",
  "official_price_options",
  "official_prices",
  "official_review_events",
  "price_alerts",
  "price_snapshots",
  "price_upload_confirmation_events",
  "price_upload_confirmations",
  "profiles",
  "tags",
  "vendor_alias_proposals",
  "vendor_dedupe_candidates",
  "vendor_demand_daily",
  "vendor_disclosure_bulk_approval_audits",
  "vendor_disclosure_ingest_batches",
  "vendor_disclosure_ingest_dedupe_links",
  "vendor_disclosure_ingest_identity_links",
  "vendor_disclosure_ingest_owned_identities",
  "vendor_disclosure_ingest_owned_ledger_rows",
  "vendor_disclosure_ingest_owned_rows",
  "vendor_disclosure_ingest_record_bindings",
  "vendor_disclosure_ingest_runs",
  "vendor_disclosure_ingest_storage_links",
  "vendor_disclosure_ingest_unit_provider_lineage",
  "vendor_disclosure_paid_extraction_attestations",
  "vendor_enrichment_private",
  "vendor_reviews",
  "vendor_tags",
  "wedding_journeys",
  "wishlists",
]);

function createManifestFixture() {
  const digest = "a".repeat(64);
  const upperDigest = digest.toUpperCase();
  const version = "2.106.0";
  const platform = "windows-x64";
  const invocation = `node_modules/.pnpm/@supabase+cli-${platform}@${version}/node_modules/@supabase/cli-${platform}/bin/supabase.exe`;
  const cliFiles = [
    "node_modules/.bin/supabase.CMD",
    `node_modules/.pnpm/supabase@${version}/node_modules/supabase/package.json`,
    `node_modules/.pnpm/supabase@${version}/node_modules/supabase/dist/supabase.js`,
    `node_modules/.pnpm/@supabase+cli-${platform}@${version}/node_modules/@supabase/cli-${platform}/package.json`,
    invocation,
  ];
  const artifact = (name) => ({
    backup_set_id: "11111111-1111-4111-8111-111111111111",
    artifact: `${name}.hbam2`,
    key: `${name}.key.dpapi`,
    plaintext_sha256: upperDigest,
    encrypted_sha256: upperDigest,
    key_sha256: upperDigest,
    plaintext_bytes: 128,
    encrypted_bytes: 222,
  });
  return {
    status: "complete",
    format: "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser",
    format_version: 2,
    backup_type: "vendor-disclosure-successor-current-production-logical-snapshot",
    backup_set_id: "11111111-1111-4111-8111-111111111111",
    release: "fixture-release",
    backup_contract_id: "pre-fixture-release-current-remote-backup",
    backup_contract_version: 2,
    created_at_utc: "2026-08-19T00:04:00.0000000+00:00",
    preflight_captured_at: "2026-08-19T00:00:00.0000000+00:00",
    inventory_before_captured_at: "2026-08-19T00:01:00.0000000+00:00",
    source_captured_at: "2026-08-19T00:02:00.0000000+00:00",
    inventory_after_captured_at: "2026-08-19T00:03:00.0000000+00:00",
    source_project_ref: "slrtobkksjmxgzatjyqb",
    source_project_ref_sha256: digest,
    source_database_identity: {
      system_identifier: "1234567890123456789",
      database_name: "postgres",
      database_oid: "16384",
      server_version_num: "170004",
    },
    source_database_identity_sha256: digest,
    source_current_user: "postgres",
    source_session_user: "postgres",
    source_role_bypasses_rls: true,
    source_row_security: "off",
    source_migration_head: "20260727090000",
    source_migration_count: 147,
    source_migration_versions_sha256: digest,
    expected_tables: [...EXPECTED_TABLES],
    table_count: 60,
    table_contract_sha256: digest,
    inventory_contract_sha256: digest,
    source_relation_contract_sha256: digest,
    live_schema_contract_sha256: digest,
    logical_data_contract_sha256: digest,
    auth_schema_contract_sha256: digest,
    auth_users_canonical_sha256: digest,
    auth_users_contract_sha256: digest,
    auth_users_row_count: 0,
    git_commit: "b".repeat(40),
    git_origin: "https://github.com/example/repo.git",
    git_remote_ref: "origin/fixture-release",
    implementation: {
      git_commit: "b".repeat(40),
      files: Object.fromEntries(IMPLEMENTATION_PATHS.map((path) => [path, digest])),
      git_blobs: Object.fromEntries(IMPLEMENTATION_PATHS.map((path) => [path, digest])),
    },
    supabase_cli: {
      mode: "repo-local-pnpm-direct-binary",
      version,
      platform,
      invocation_relative_path: invocation,
      files: Object.fromEntries(cliFiles.map((path) => [path, upperDigest])),
    },
    verifier_runtime: {
      format_version: 1,
      node: {
        absolute_path: "C:\\Program Files\\nodejs\\node.exe",
        version: "v24.15.0",
        bytes: 91694408,
        sha256: upperDigest,
      },
      pglite: {
        version: "0.5.4",
        package_relative_path: "node_modules/.pnpm/@electric-sql+pglite@0.5.4/node_modules/@electric-sql/pglite",
        entry_relative_path: "dist/index.js",
        file_count: 301,
        total_bytes: 25403132,
        tree_sha256: upperDigest,
      },
    },
    verifier: {
      file: "scripts/vendor-disclosure-db-current-baseline-verify.ps1",
      sha256: digest,
    },
    source_fence: "exact-linked-production-ref-plus-clean-pushed-commit-plus-pinned-cli",
    consistency: "logical-data-single-statement-schema-before-after-fenced",
    query_timeout_seconds: 120,
    plaintext_written_to_disk: false,
    contains_secrets: false,
    key_scope: "Windows DPAPI CurrentUser on the creating computer",
    preflight: {
      estimated_total_bytes: 0,
      estimated_total_rows: 0,
    },
    tables: Object.fromEntries(EXPECTED_TABLES.map((table) => [table, 0])),
    artifacts: {
      schema_inventory: artifact("schema-inventory.json"),
      logical_data: artifact("logical-data.json"),
    },
  };
}

function runManifestContractProbe(value, transformRawJson = (raw) => raw) {
  const json = transformRawJson(JSON.stringify(value));
  const encoded = Buffer.from(json).toString("base64");
  const escapedCommon = COMMON.replaceAll("'", "''");
  const probe = `
$ErrorActionPreference = 'Stop'
. '${escapedCommon}'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
Assert-VDCurrentBaselineManifestJsonHasNoSecretMaterial -Json $json
$manifest = $json | ConvertFrom-Json
Assert-VDCurrentBaselineManifestHasNoSecretMaterial -Value $manifest
Assert-VDCurrentBaselineExactManifestShape -Manifest $manifest
Assert-VDCurrentBaselineManifestSafetyValues -Manifest $manifest
Write-Output 'PASS'
`;
  return spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", probe],
    { encoding: "utf8", windowsHide: true },
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

function parseQuotedBlock(source, variable) {
  const match = source.match(new RegExp(
    `\\$script:${variable}\\s*=\\s*@\\(([\\s\\S]*?)\\r?\\n\\)`,
  ));
  assert.ok(match, `missing ${variable}`);
  return [...match[1].matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((entry) => entry[1]);
}

test("pins the exact current Production database contract", async () => {
  const source = await readFile(COMMON, "utf8");
  const tables = parseQuotedBlock(source, "VDCurrentBaselineExpectedTables");
  assert.deepEqual(tables, EXPECTED_TABLES);
  assert.equal(tables.length, 60);
  assert.equal(
    sha256(`${tables.join("\n")}\n`),
    "d6494b9dfbebdea7f82535f81825e2698d5e0296a34ca935da382f91f5dae35f",
  );
  assert.match(source, /VDCurrentBaselineProjectRef = 'slrtobkksjmxgzatjyqb'/);
  assert.match(source, /VDCurrentBaselineMigrationHead = '20260727090000'/);
  assert.match(source, /VDCurrentBaselineMigrationCount = 147/);
  const receiptKeys = parseQuotedBlock(source, "VDCurrentBaselineLogicalReceiptKeys");
  assert.deepEqual(receiptKeys, [
    "AuthSchemaContractSha256",
    "AuthUsersCanonicalSha256",
    "AuthUsersContractSha256",
    "BackupContractId",
    "BackupContractVersion",
    "BackupSetId",
    "ContainsSecrets",
    "EncryptedArtifacts",
    "EncryptedArtifactsVerified",
    "ExpectedTables",
    "GitCommit",
    "GitOrigin",
    "InventorySha256",
    "Kind",
    "LiveSchemaContractSha256",
    "LogicalDataContractSha256",
    "ManifestSha256",
    "PGliteJsonbRoundTripVerified",
    "PlaintextWrittenToDisk",
    "ProjectRef",
    "ReceiptVersion",
    "Release",
    "SourceCanonicalDigestsVerified",
    "SourceCapturedAt",
    "SourceMigrationCount",
    "SourceMigrationHead",
    "SupabaseCli",
    "TableContractSha256",
    "TableCount",
    "Verified",
    "VerifiedAtUtc",
    "Verifier",
  ]);
  const manifestKeys = parseQuotedBlock(source, "VDCurrentBaselineManifestKeys");
  assert.equal(manifestKeys.length, 51);
  assert.deepEqual(manifestKeys, Object.keys(createManifestFixture()).sort());
});

test("capture is external, read-only, encrypted in memory, and commit-bound", async () => {
  const [common, capture] = await Promise.all([
    readFile(COMMON, "utf8"),
    readFile(CAPTURE, "utf8"),
  ]);
  assert.match(common, /begin transaction read only;/i);
  assert.match(common, /set local row_security = off;/i);
  assert.match(common, /auth_users_rows as materialized/);
  assert.match(common, /octet_length\(row_data::text\)::text \|\| ':' \|\| row_data::text/);
  assert.match(common, /auth_schema_contract as materialized/);
  assert.match(capture, /Protect-HBAM2Artifact[\s\S]*schema-inventory\.json/);
  assert.match(capture, /Protect-HBAM2Artifact[\s\S]*logical-data\.json/);
  assert.match(capture, /plaintext_written_to_disk = \$false/);
  assert.match(capture, /Resolve-HBAM2BackupRoot/);
  assert.match(`${common}\n${capture}`, /status --porcelain=v1 --untracked-files=all/);
  assert.match(`${common}\n${capture}`, /ls-remote --exit-code origin/);
  assert.match(`${common}\n${capture}`, /remote get-url origin/);
  assert.match(capture, /New-VDCurrentBaselineLinkedQuery/);
  assert.doesNotMatch(capture, /(?:insert|update|delete|alter|drop|create)\s+(?:table|schema)\b/i);
});

test("pre-apply Auth capture matches the post-expand length-framed contract", async () => {
  const [current, postExpand] = await Promise.all([
    readFile(COMMON, "utf8"),
    readFile(POST_EXPAND_COMMON, "utf8"),
  ]);
  const lengthFramed = String.raw`octet_length(row_data::text)::text || ':' || row_data::text || E'\\n'`;
  assert.equal(current.includes(lengthFramed), true);
  assert.equal(postExpand.includes(lengthFramed), true);
  for (const field of [
    "'table', schema_name || '.' || table_name",
    "'ordinal_position', ordinal_position",
    "'column_name', column_name",
    "'data_type', data_type",
    "'not_null', not_null",
    "'identity', identity",
    "'generated', generated",
    "'default_expression', default_expression",
    "'collation', collation",
  ]) {
    assert.equal(current.includes(field), true, field);
    assert.equal(postExpand.includes(field), true, field);
  }
});

test("PowerShell Auth verifier computes the exact canonical receipt digests", () => {
  const schema = [
    {
      table: "auth.users",
      ordinal_position: 1,
      column_name: "id",
      data_type: "uuid",
      not_null: true,
      identity: "",
      generated: "",
      default_expression: null,
      collation: null,
    },
    {
      table: "auth.users",
      ordinal_position: 2,
      column_name: "email",
      data_type: "character varying(255)",
      not_null: false,
      identity: "",
      generated: "",
      default_expression: null,
      collation: null,
    },
  ];
  const canonical = "f".repeat(64);
  const inventoryJson = Buffer.from(JSON.stringify({ auth_schema_contract: schema }))
    .toString("base64");
  const logicalJson = Buffer.from(JSON.stringify({
    auth_users: {
      row_count: 1,
      rows: [{
        id: "11111111-1111-4111-8111-111111111111",
        email: "fixture@example.invalid",
      }],
      canonical_sha256: canonical,
    },
  })).toString("base64");
  const escapedCommon = COMMON.replaceAll("'", "''");
  const probe = `
$ErrorActionPreference = 'Stop'
. '${escapedCommon}'
$inventory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${inventoryJson}')) | ConvertFrom-Json
$logical = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${logicalJson}')) | ConvertFrom-Json
$digests = Get-VDCurrentBaselineAuthContractDigests -Inventory $inventory -Logical $logical -Label 'Fixture'
$logical.auth_users.rows[0].PSObject.Properties.Remove('id')
$tamperRejected = $false
try { [void](Get-VDCurrentBaselineAuthContractDigests -Inventory $inventory -Logical $logical -Label 'Tampered') }
catch { $tamperRejected = $true }
[ordered]@{ digests = $digests; tamperRejected = $tamperRejected } | ConvertTo-Json -Compress
`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", probe],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.digests.AuthSchemaContractSha256, sha256(`${canonicalJson(schema)}\n`));
  assert.equal(output.digests.AuthUsersCanonicalSha256, canonical);
  assert.equal(output.digests.AuthUsersContractSha256, sha256(`${canonicalJson({
    canonical_sha256: canonical,
    row_count: 1,
  })}\n`));
  assert.equal(output.digests.AuthUsersRowCount, 1);
  assert.equal(output.tamperRejected, true);
});

test("verifier authenticates both artifacts and emits the exact successor receipt", async () => {
  const source = await readFile(VERIFY, "utf8");
  assert.equal((source.match(/Unprotect-HBAM2Artifact/g) ?? []).length, 2);
  assert.match(source, /vendor-disclosure-successor-current-baseline-backup-verification-v1/);
  assert.match(source, /Invoke-VDCurrentBaselinePGliteRoundTrip/);
  assert.match(source, /SourceCanonicalDigestsVerified = \$true/);
  assert.match(source, /PGliteJsonbRoundTripVerified = \$true/);
  assert.match(source, /PlaintextWrittenToDisk = \$false/);
  assert.match(source, /ContainsSecrets = \$false/);
  assert.match(source, /ExpectedTables = @\(\$script:VDCurrentBaselineExpectedTables\)/);
  assert.match(source, /SourceMigrationCount = \$script:VDCurrentBaselineMigrationCount/);
  assert.match(source, /AuthSchemaContractSha256 = \$authSchemaSha/);
  assert.match(source, /AuthUsersCanonicalSha256 = \$authUsersCanonicalSha/);
  assert.match(source, /AuthUsersContractSha256 = \$authUsersContractSha/);
  assert.match(source, /\[switch\]\s*\$ReplayOnly/);
  assert.match(source, /if \(\$ReplayOnly\)[\s\S]*ReceiptPath[\s\S]*must not be supplied/i);
  assert.match(source, /if \(-not \$ReplayOnly\) \{\s*Write-VDExactReceipt/);
  const rawScanIndex = source.indexOf("Assert-VDCurrentBaselineManifestJsonHasNoSecretMaterial");
  const parsedScanIndex = source.indexOf("Assert-VDCurrentBaselineManifestHasNoSecretMaterial");
  const shapeIndex = source.indexOf("Assert-VDCurrentBaselineExactManifestShape");
  const safetyIndex = source.indexOf("Assert-VDCurrentBaselineManifestSafetyValues");
  const containsSecretsClaimIndex = source.indexOf("[bool]$manifest.contains_secrets");
  assert.ok(rawScanIndex > 0);
  assert.ok(parsedScanIndex > rawScanIndex);
  assert.ok(shapeIndex > parsedScanIndex);
  assert.ok(safetyIndex > shapeIndex);
  assert.ok(containsSecretsClaimIndex > safetyIndex);
  assert.doesNotMatch(source, /db query|--linked|api\.supabase\.com/i);
});

test("current-baseline manifest rejects a top-level service_role_key", () => {
  const manifest = createManifestFixture();
  manifest.service_role_key = "not-even-a-real-secret";
  const result = runManifestContractProbe(manifest);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /Manifest contains secret-like material\./);
  assert.doesNotMatch(result.stderr, /not recognized|CommandNotFoundException/i);
});

test("current-baseline manifest accepts only the exact non-secret fixture schema", () => {
  const manifest = createManifestFixture();
  assert.equal(Object.keys(manifest).length, 51);
  const result = runManifestContractProbe(manifest);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "PASS");
});

test("current-baseline manifest rejects a harmless extra top-level key", () => {
  const manifest = createManifestFixture();
  manifest.unexpected = true;
  const result = runManifestContractProbe(manifest);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /Manifest schema is not exact\./);
});

test("current-baseline raw JSON scan rejects an overwritten secret value", () => {
  const manifest = createManifestFixture();
  const secret = "sb_secret_abcdefghijklmnopqrstuvwxyz123456";
  const result = runManifestContractProbe(
    manifest,
    (raw) => raw.replace(
      '"source_current_user":"postgres"',
      `"source_current_user":"${secret}","source_current_user":"postgres"`,
    ),
  );
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /Manifest contains secret-like material\./);
});

test("current-baseline manifest recursively rejects an escaped nested secret key", () => {
  const manifest = createManifestFixture();
  manifest.preflight.service_role_key = "not-even-a-real-secret";
  const result = runManifestContractProbe(
    manifest,
    (raw) => raw.replace('"service_role_key"', '"service\\u005frole\\u005fkey"'),
  );
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /Manifest contains secret-like material\./);
  assert.doesNotMatch(result.stderr, /not recognized|CommandNotFoundException/i);
});

test("current-baseline manifest rejects generic nested secret-like keys", () => {
  const manifest = createManifestFixture();
  manifest.preflight.session_token = "redacted";
  const result = runManifestContractProbe(manifest);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /Manifest contains secret-like material\./);
});

test("current-baseline manifest requires all 51 top-level keys", () => {
  const baseline = createManifestFixture();
  assert.equal(Object.keys(baseline).length, 51);
  for (const field of ["key_scope", "preflight", "query_timeout_seconds"]) {
    const manifest = structuredClone(baseline);
    delete manifest[field];
    const result = runManifestContractProbe(manifest);
    assert.notEqual(result.status, 0, `${field} was accepted`);
    assert.match(result.stderr, /Manifest schema is not exact\./, field);
    assert.doesNotMatch(result.stderr, /not recognized|CommandNotFoundException/i, field);
  }
});

test("current-baseline manifest enforces key scope, preflight, and query timeout values", () => {
  const cases = [
    ["key scope", (value) => { value.key_scope = "portable plaintext key"; }],
    ["query timeout below range", (value) => { value.query_timeout_seconds = 29; }],
    ["query timeout above range", (value) => { value.query_timeout_seconds = 601; }],
    ["query timeout type", (value) => { value.query_timeout_seconds = "150"; }],
    ["preflight bytes below range", (value) => { value.preflight.estimated_total_bytes = -1; }],
    ["preflight bytes above range", (value) => { value.preflight.estimated_total_bytes = 268435457; }],
    ["preflight bytes type", (value) => { value.preflight.estimated_total_bytes = "0"; }],
    ["preflight rows below range", (value) => { value.preflight.estimated_total_rows = -1; }],
    ["preflight rows above range", (value) => { value.preflight.estimated_total_rows = 500001; }],
    ["preflight rows type", (value) => { value.preflight.estimated_total_rows = "0"; }],
  ];
  for (const [label, mutate] of cases) {
    const manifest = createManifestFixture();
    mutate(manifest);
    const result = runManifestContractProbe(manifest);
    assert.notEqual(result.status, 0, `${label} was accepted`);
    assert.match(result.stderr, /Manifest safety values are invalid\./, label);
    assert.doesNotMatch(result.stderr, /not recognized|CommandNotFoundException/i, label);
  }
});

test("current-baseline key scope is compared case-sensitively", () => {
  // PowerShell's -ne is case-insensitive, so the fixed DPAPI contract string
  // has to be compared with -cne or any case variant is accepted as exact.
  const cases = [
    "WINDOWS DPAPI CURRENTUSER ON THE CREATING COMPUTER",
    "windows dpapi currentuser on the creating computer",
    "Windows Dpapi CurrentUser On The Creating Computer",
  ];
  for (const variant of cases) {
    const manifest = createManifestFixture();
    manifest.key_scope = variant;
    const result = runManifestContractProbe(manifest);
    assert.notEqual(result.status, 0, `${variant} was accepted`);
    assert.match(result.stderr, /Manifest safety values are invalid\./, variant);
    assert.doesNotMatch(result.stderr, /not recognized|CommandNotFoundException/i, variant);
  }
});

test("current-baseline manifest rejects a null in any nested object slot", () => {
  const cases = [
    ["source database identity", (value) => { value.source_database_identity = null; }],
    ["implementation", (value) => { value.implementation = null; }],
    ["verifier runtime", (value) => { value.verifier_runtime = null; }],
    ["preflight", (value) => { value.preflight = null; }],
    ["artifacts", (value) => { value.artifacts = null; }],
    ["logical artifact", (value) => { value.artifacts.logical_data = null; }],
  ];
  for (const [label, mutate] of cases) {
    const manifest = createManifestFixture();
    mutate(manifest);
    const result = runManifestContractProbe(manifest);
    assert.notEqual(result.status, 0, `${label} was accepted`);
    // The null must surface as the schema verdict, not as a parameter-binding
    // failure from a Mandatory parameter that refuses null before the check.
    assert.match(result.stderr, /Manifest schema is not exact\./, label);
    assert.doesNotMatch(result.stderr, /ParameterArgumentValidationErrorNullNotAllowed/i, label);
    assert.doesNotMatch(result.stderr, /not recognized|CommandNotFoundException/i, label);
  }
});

test("current-baseline manifest rejects extra keys in every nested schema", () => {
  const cases = [
    ["source database identity", (value) => { value.source_database_identity.unexpected = true; }],
    ["implementation", (value) => { value.implementation.unexpected = true; }],
    ["implementation files", (value) => { value.implementation.files.unexpected = "a".repeat(64); }],
    ["implementation git blobs", (value) => { value.implementation.git_blobs.unexpected = "a".repeat(64); }],
    ["Supabase CLI", (value) => { value.supabase_cli.unexpected = true; }],
    ["Supabase CLI files", (value) => { value.supabase_cli.files.unexpected = "A".repeat(64); }],
    ["verifier runtime", (value) => { value.verifier_runtime.unexpected = true; }],
    ["Node runtime", (value) => { value.verifier_runtime.node.unexpected = true; }],
    ["PGlite runtime", (value) => { value.verifier_runtime.pglite.unexpected = true; }],
    ["verifier", (value) => { value.verifier.unexpected = true; }],
    ["preflight", (value) => { value.preflight.unexpected = true; }],
    ["table counts", (value) => { value.tables.unexpected = 0; }],
    ["artifacts", (value) => { value.artifacts.unexpected = {}; }],
    ["logical artifact", (value) => { value.artifacts.logical_data.unexpected = true; }],
    ["inventory artifact", (value) => { value.artifacts.schema_inventory.unexpected = true; }],
  ];
  for (const [label, mutate] of cases) {
    const manifest = createManifestFixture();
    mutate(manifest);
    const result = runManifestContractProbe(manifest);
    assert.notEqual(result.status, 0, `${label} extra key was accepted`);
    assert.match(result.stderr, /Manifest schema is not exact\./, label);
  }
});

test("current-baseline manifest rejects missing keys in every nested schema", () => {
  const cases = [
    ["source database identity", (value) => { delete value.source_database_identity.database_oid; }],
    ["implementation", (value) => { delete value.implementation.git_commit; }],
    ["implementation files", (value) => { delete value.implementation.files[IMPLEMENTATION_PATHS[0]]; }],
    ["implementation git blobs", (value) => { delete value.implementation.git_blobs[IMPLEMENTATION_PATHS[0]]; }],
    ["Supabase CLI", (value) => { delete value.supabase_cli.mode; }],
    ["Supabase CLI files", (value) => { delete value.supabase_cli.files["node_modules/.bin/supabase.CMD"]; }],
    ["verifier runtime", (value) => { delete value.verifier_runtime.format_version; }],
    ["Node runtime", (value) => { delete value.verifier_runtime.node.bytes; }],
    ["PGlite runtime", (value) => { delete value.verifier_runtime.pglite.file_count; }],
    ["verifier", (value) => { delete value.verifier.file; }],
    ["preflight", (value) => { delete value.preflight.estimated_total_rows; }],
    ["table counts", (value) => { delete value.tables[EXPECTED_TABLES[0]]; }],
    ["artifacts", (value) => { delete value.artifacts.logical_data; }],
    ["logical artifact", (value) => { delete value.artifacts.logical_data.key; }],
    ["inventory artifact", (value) => { delete value.artifacts.schema_inventory.key; }],
  ];
  for (const [label, mutate] of cases) {
    const manifest = createManifestFixture();
    mutate(manifest);
    const result = runManifestContractProbe(manifest);
    assert.notEqual(result.status, 0, `${label} missing key was accepted`);
    assert.match(result.stderr, /Manifest schema is not exact\./, label);
  }
});

test("PGlite verifier pins the same exact 60-table allowlist", async () => {
  const source = await readFile(ROUNDTRIP, "utf8");
  const match = source.match(/const EXPECTED_TABLES = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(match);
  const tables = [...match[1].matchAll(/"([a-z][a-z0-9_]*)"/g)]
    .map((entry) => entry[1]);
  assert.deepEqual(tables, EXPECTED_TABLES);
  assert.match(source, /SourceCanonicalDigestsVerified: true/);
  assert.match(source, /PlaintextWrittenToDisk: false/);
});

test("generated Production SQL is fenced read-only and addresses all 60 tables", () => {
  const escapedCommon = COMMON.replaceAll("'", "''");
  const probe = `
$ErrorActionPreference = 'Stop'
. '${escapedCommon}'
$queries = [ordered]@{
  preflight = New-VDCurrentBaselinePreflightSql
  inventory = New-VDCurrentBaselineInventorySql
  logical = New-VDCurrentBaselineLogicalSql
}
$result = [ordered]@{}
foreach ($entry in $queries.GetEnumerator()) {
  $sql = [string]$entry.Value
  $begin = [Regex]::Matches($sql, '(?i)\\bbegin\\b').Count
  $commit = [Regex]::Matches($sql, '(?i)\\bcommit\\b').Count
  $mutations = [Regex]::Matches($sql, '(?i)\\b(insert|update|delete|alter|drop|truncate|create)\\b').Count
  if ($begin -ne 1 -or $commit -ne 1 -or $mutations -ne 0 -or
      $sql -notmatch "(?is)^begin transaction read only;.*commit;\\s*$") {
    throw "unsafe generated SQL: $($entry.Key)"
  }
  $result[$entry.Key] = [ordered]@{
    bytes = [Text.Encoding]::UTF8.GetByteCount($sql)
    targetValues = [Regex]::Matches($sql, "(?m)^    \\('[a-z][a-z0-9_]*'\\)(,)?$").Count
    onlyPublic = [Regex]::Matches($sql, '(?i)only public\\.').Count
    onlyAuthUsers = [Regex]::Matches($sql, '(?i)only auth\\.users').Count
    unionAll = [Regex]::Matches($sql, '(?i)\\bunion all\\b').Count
  }
}
[ordered]@{
  queries = $result
  arrayDigest = Get-VDCurrentBaselineCanonicalJsonSha256 -Value ([ordered]@{ value = @('one') })
  scalarDigest = Get-VDCurrentBaselineCanonicalJsonSha256 -Value ([ordered]@{ value = 'one' })
} | ConvertTo-Json -Compress
`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", probe],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim());
  assert.notEqual(receipt.arrayDigest, receipt.scalarDigest);
  assert.equal(receipt.queries.preflight.targetValues, 60);
  assert.equal(receipt.queries.inventory.targetValues, 60);
  assert.equal(receipt.queries.logical.targetValues, 60);
  assert.equal(receipt.queries.logical.onlyPublic, 60);
  assert.equal(receipt.queries.logical.onlyAuthUsers, 1);
  assert.equal(receipt.queries.logical.unionAll, 59);
  assert.ok(receipt.queries.logical.bytes < 1_048_576);
});

test("PGlite stages all 60 authenticated table payloads and verifies source digests", () => {
  const emptyDigest = sha256("");
  const tables = Object.fromEntries(EXPECTED_TABLES.map((table) => [table, {
    row_count: 0,
    rows: [],
    canonical_sha256: emptyDigest,
  }]));
  const inventory = {
    columns: EXPECTED_TABLES.map((table) => ({ table_name: table, column_name: "id" })),
    constraints: [{
      table: "public.profiles",
      type: "p",
      columns: ["id"],
      referenced_table: null,
      referenced_columns: [],
    }],
  };
  const logical = { tables };
  const input = `${Buffer.from(JSON.stringify(inventory)).toString("base64")}\n${Buffer.from(
    JSON.stringify(logical),
  ).toString("base64")}\n`;
  const entry = join(
    REPO_ROOT,
    "apps/web/node_modules/@electric-sql/pglite/dist/index.js",
  );
  const result = spawnSync(process.execPath, [ROUNDTRIP], {
    cwd: join(REPO_ROOT, "apps/web"),
    encoding: "utf8",
    env: { ...process.env, HBAM_PGLITE_ENTRY: entry },
    input,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.TableCount, 60);
  assert.equal(receipt.TotalRows, "0");
  assert.equal(receipt.SourceCanonicalDigestsVerified, true);
  assert.equal(receipt.JsonbRoundTripVerified, true);
  assert.equal(receipt.PlaintextWrittenToDisk, false);
});
