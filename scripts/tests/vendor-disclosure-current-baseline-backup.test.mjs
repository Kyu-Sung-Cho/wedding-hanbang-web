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
  assert.doesNotMatch(source, /db query|--linked|api\.supabase\.com/i);
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
