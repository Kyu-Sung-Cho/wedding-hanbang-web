import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { successorCreatedPublicTables } from "../lib/supabase-successor-release-contract.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COMMON = join(REPO_ROOT, "scripts/vendor-disclosure-db-backup-common.ps1");
const CAPTURE = join(REPO_ROOT, "scripts/vendor-disclosure-db-backup.ps1");
const VERIFY = join(REPO_ROOT, "scripts/vendor-disclosure-db-verify-backup.ps1");
const ROUNDTRIP = join(REPO_ROOT, "apps/web/scripts/vendor-disclosure-db-backup-roundtrip.mjs");
const RELEASE_MANIFEST = JSON.parse(await readFile(
  join(REPO_ROOT, "supabase/release-manifests/vendor-disclosure-v2-20260718.json"),
  "utf8",
));
const PREDECESSOR = JSON.parse(await readFile(
  join(REPO_ROOT, "supabase/release-manifests/amora-engine-v2-20260716.json"),
  "utf8",
));
const PRODUCTION_BASELINE = JSON.parse(await readFile(
  join(
    REPO_ROOT,
    "supabase/release-contracts/vendor-disclosure-production-baseline-v1-20260815.json",
  ),
  "utf8",
));
const CURRENT_TABLES = [...new Set([
  ...PREDECESSOR.postExpandBackupContract.expectedTables,
  ...successorCreatedPublicTables(REPO_ROOT, PRODUCTION_BASELINE.appliedSuccessorMigrations),
])].sort();
const SUCCESSOR_TABLES = successorCreatedPublicTables(
  REPO_ROOT,
  RELEASE_MANIFEST.expandMigrations,
);
const EXPECTED_TABLES = [...new Set([...CURRENT_TABLES, ...SUCCESSOR_TABLES])].sort();
const RELEASE_VERSIONS = RELEASE_MANIFEST.expandMigrations.map((entry) => entry.file.slice(0, 14));
const ALL_VERSIONS = (await readdir(join(REPO_ROOT, "supabase/migrations")))
  .filter((name) => /^\d{14}_[a-z0-9_.-]+\.sql$/.test(name))
  .sort()
  .map((name) => name.slice(0, 14));
const APPLIED_SUFFIX = ALL_VERSIONS.filter(
  (version) => version > PRODUCTION_BASELINE.observedRemoteHead,
);

const RECEIPT_KEYS = [
  "authSchemaContractSha256",
  "authUsersContractSha256",
  "backupContractId",
  "backupContractVersion",
  "backupManifestSha256",
  "backupSetId",
  "capturedAt",
  "checks",
  "containsSecrets",
  "expectedMigrationHead",
  "expectedTableContractSha256",
  "expectedTableCount",
  "expectedTables",
  "kind",
  "liveSchemaContractSha256",
  "logicalDataContractSha256",
  "migrationVersionsSha256",
  "projectRef",
  "receiptVersion",
  "release",
  "releaseCommit",
  "sourceDatabaseOid",
  "sourceDatabaseSystemIdentifier",
  "storageMetadataContractSha256",
  "storageObjectInventorySha256",
  "verifiedAt",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function listSha(values) {
  return sha256(`${values.join("\n")}\n`);
}

function quotedBlock(source, variable) {
  const match = source.match(new RegExp(
    `\\$script:${variable}\\s*=\\s*@\\(([\\s\\S]*?)\\r?\\n\\)`,
  ));
  assert.ok(match, `missing ${variable}`);
  return [...match[1].matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((entry) => entry[1]);
}

test("pins the full exact 139-table post-expand and three migration-ledger contracts", async () => {
  const source = await readFile(COMMON, "utf8");
  assert.equal(CURRENT_TABLES.length, 60);
  assert.equal(SUCCESSOR_TABLES.length, 112);
  assert.equal(EXPECTED_TABLES.length, 139);
  assert.deepEqual(quotedBlock(source, "VDPostExpandExpectedTables"), EXPECTED_TABLES);
  assert.equal(listSha(EXPECTED_TABLES), "ddf672a17f28e99fd20646a3376cee696430b8b599e10979f6d2c7fd23e5482f");
  assert.equal(ALL_VERSIONS.length, 233);
  assert.equal(ALL_VERSIONS.at(-1), "20260820150000");
  assert.equal(listSha(ALL_VERSIONS), "35a5379aa9ccbf37dc8e907dc445221e92e9721b23592d4aaa57c2677ce22dec");
  assert.equal(RELEASE_VERSIONS.length, 118);
  assert.equal(listSha(RELEASE_VERSIONS), "779e13bde642b648e855b0866e09c42ea2bb7eb98064a752fa926121f04a6483");
  assert.equal(APPLIED_SUFFIX.length, 86);
  assert.equal(listSha(APPLIED_SUFFIX), "1f78511129ea9f0ecec899149c044ab3c2244f2dcf476adf8b790f3ccc44146c");
  assert.deepEqual(quotedBlock(source, "VDPostExpandVerificationReceiptKeys"), RECEIPT_KEYS);
  assert.match(source, /VDPostExpandMigrationCount = 233/);
  assert.match(source, /VDPostExpandReleaseMigrationCount = 118/);
  assert.match(source, /VDPostExpandAppliedSuffixCount = 86/);
  assert.match(source, /VDPostExpandMigrationHead = '20260820150000'/);
});

test("canonical capture and verifier are encrypted, durable, external, pushed-commit bound", async () => {
  const [common, capture, verify] = await Promise.all([
    readFile(COMMON, "utf8"),
    readFile(CAPTURE, "utf8"),
    readFile(VERIFY, "utf8"),
  ]);
  assert.match(common, /begin transaction read only;/i);
  assert.match(common, /Write-VDPostExpandDurableExclusiveBytes/);
  assert.match(common, /\.Flush\(\$true\)/);
  assert.match(common, /Sync-VDPostExpandParentDirectory/);
  assert.match(capture, /function Remove-VDPostExpandFinalDirectory/);
  assert.match(capture, /\$movedToFinal/);
  assert.match(capture, /Remove-VDPostExpandFinalDirectory -Path \$finalDirectory/);
  assert.match(capture, /Invoke-VDPostExpandLinkedQuery/);
  assert.match(capture, /StandardOutput\.BaseStream/);
  assert.equal((capture.match(/Protect-VDPostExpandArtifact/g) ?? []).length, 2);
  assert.match(capture, /plaintext_written_to_disk = \$false/);
  assert.match(`${common}\n${capture}`, /ls-remote --exit-code origin/);
  assert.match(verify, /successor-post-expand-backup-verification-v2/);
  assert.match(verify, /Invoke-VDPostExpandPGliteRoundTrip/);
  assert.match(verify, /authSchemaContractSha256/);
  assert.match(verify, /storageObjectInventorySha256/);
  assert.match(verify, /Write-VDPostExpandDurableReceipt/);
  assert.doesNotMatch(verify, /db query|--linked|api\.supabase\.com/i);
});

test("durable verifier receipt removes its newly-created file when ACL hardening fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "post-expand-receipt-fault-"));
  const receiptPath = join(root, "receipt.json");
  const escapedCommon = COMMON.replaceAll("'", "''");
  const escapedReceipt = receiptPath.replaceAll("'", "''");
  const probe = `
$ErrorActionPreference = 'Stop'
. '${escapedCommon}'
function global:Set-HBAM2PrivateFileAcl { param([string]$Path) throw 'injected ACL failure' }
$failed = $false
try { Write-VDPostExpandDurableReceipt -Path '${escapedReceipt}' -Json '{}' }
catch { $failed = $true }
[ordered]@{ failed = $failed; exists = (Test-Path -LiteralPath '${escapedReceipt}') } | ConvertTo-Json -Compress
`;
  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", probe],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { failed: true, exists: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated SQL is read-only, bounded, and addresses 139 public plus Auth/Storage data", () => {
  const escapedCommon = COMMON.replaceAll("'", "''");
  const probe = `
$ErrorActionPreference = 'Stop'
. '${escapedCommon}'
$queries = [ordered]@{
  preflight = New-VDPostExpandPreflightSql
  inventory = New-VDPostExpandInventorySql
  logical = New-VDPostExpandLogicalSql
}
$result = [ordered]@{}
foreach ($entry in $queries.GetEnumerator()) {
  $sql = [string]$entry.Value
  if ([Regex]::Matches($sql, '(?i)\\bbegin\\b').Count -ne 1 -or
      [Regex]::Matches($sql, '(?i)\\bcommit\\b').Count -ne 1 -or
      [Regex]::Matches($sql, '(?i)\\b(insert|update|delete|alter|drop|truncate|create)\\b').Count -ne 0 -or
      $sql -notmatch '(?is)^begin transaction read only;.*commit;\\s*$') {
    throw "unsafe generated SQL: $($entry.Key)"
  }
  $result[$entry.Key] = [ordered]@{
    bytes = [Text.Encoding]::UTF8.GetByteCount($sql)
    targetValues = [Regex]::Matches($sql, "(?m)^    \\('[a-z][a-z0-9_]*'\\)(,)?$").Count
    onlyPublic = [Regex]::Matches($sql, '(?i)only public\\.').Count
    unionAll = [Regex]::Matches($sql, '(?i)\\bunion all\\b').Count
    authUsers = [Regex]::Matches($sql, '(?i)only auth\\.users').Count
    storageBuckets = [Regex]::Matches($sql, '(?i)only storage\\.buckets').Count
    storageObjects = [Regex]::Matches($sql, '(?i)only storage\\.objects').Count
  }
}
$result | ConvertTo-Json -Compress
`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", probe],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.preflight.targetValues, 139);
  assert.equal(receipt.inventory.targetValues, 139);
  assert.equal(receipt.logical.targetValues, 139);
  assert.equal(receipt.logical.onlyPublic, 139);
  assert.equal(receipt.logical.unionAll, 138);
  assert.equal(receipt.logical.authUsers, 1);
  assert.equal(receipt.logical.storageBuckets, 1);
  assert.equal(receipt.logical.storageObjects, 1);
  assert.ok(receipt.logical.bytes < 1_048_576);
});

test("portable schema SQL excludes project-local identifiers and captures stable semantic contracts", async () => {
  const source = await readFile(COMMON, "utf8");
  const inventory = source.match(
    /function New-VDPostExpandInventorySql \{([\s\S]*?)\nfunction New-VDPostExpandLogicalSql \{/,
  )?.[1] ?? "";
  assert.match(inventory, /tables_contract as materialized/i);
  assert.match(inventory, /indexes_contract as materialized/i);
  assert.match(inventory, /policies_contract as materialized/i);
  assert.match(inventory, /triggers_contract as materialized/i);
  assert.match(inventory, /pg_get_userbyid\(relation\.relowner\)/i);
  assert.match(inventory, /aclexplode\(/i);
  assert.match(inventory, /pg_get_function_identity_arguments/i);
  assert.doesNotMatch(
    inventory,
    /public_schema_contract[\s\S]*?'tables'\s*,\s*\(select value from relations\)/i,
  );
  assert.doesNotMatch(inventory, /'owner_oid'|'relation_oid'|to_jsonb\(policy\.polroles\)/i);
});

test("portable schema digest ignores cross-project OID variance but detects semantic drift", () => {
  const escapedCommon = COMMON.replaceAll("'", "''");
  const probe = `
$ErrorActionPreference = 'Stop'
. '${escapedCommon}'
$logical = [pscustomobject]@{
  tables = [pscustomobject]@{ profiles = [pscustomobject]@{ row_count = 0; canonical_sha256 = '${sha256("")}' } }
  auth_users = [pscustomobject]@{ row_count = 0; canonical_sha256 = '${sha256("")}' }
  storage_buckets = [pscustomobject]@{ row_count = 0; canonical_sha256 = '${sha256("")}' }
  storage_objects = [pscustomobject]@{ row_count = 0; canonical_sha256 = '${sha256("")}' }
}
function New-Inventory([string]$RelationOid, [string]$OwnerOid, [string]$SystemId, [string]$DatabaseOid, [string]$Owner) {
  return [pscustomobject]@{
    source_database_identity = [pscustomobject]@{ system_identifier = $SystemId; database_oid = $DatabaseOid }
    schema_contract = [pscustomobject]@{
      tables = @([pscustomobject]@{
        name = 'public.profiles'; relkind = 'r'; owner = $Owner
        relation_oid = $RelationOid; owner_oid = $OwnerOid; relfilenode = $RelationOid
        rls = $true; force_rls = $false; acl = @()
      })
      columns = @(); constraints = @(); indexes = @(); policies = @(); triggers = @()
    }
    auth_schema_contract = @()
    storage_schema_contract = @()
  }
}
$source = Get-VDPostExpandDataContractDigests -Inventory (New-Inventory '10001' '10' '111111111111111111' '16384' 'postgres') -Logical $logical
$target = Get-VDPostExpandDataContractDigests -Inventory (New-Inventory '90001' '999' '222222222222222222' '24576' 'postgres') -Logical $logical
$semanticDrift = Get-VDPostExpandDataContractDigests -Inventory (New-Inventory '90001' '999' '222222222222222222' '24576' 'different_owner') -Logical $logical
[ordered]@{
  source = $source.LiveSchemaContractSha256
  target = $target.LiveSchemaContractSha256
  semanticDrift = $semanticDrift.LiveSchemaContractSha256
} | ConvertTo-Json -Compress
`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", probe],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const digests = JSON.parse(result.stdout.trim());
  assert.equal(digests.source, digests.target);
  assert.notEqual(digests.source, digests.semanticDrift);
});

test("PGlite verifies public, Auth users, and Storage metadata/inventory digests", () => {
  const emptyDigest = sha256("");
  const publicTables = Object.fromEntries(EXPECTED_TABLES.map((table) => [table, {
    row_count: 0,
    rows: [],
    canonical_sha256: emptyDigest,
  }]));
  const inventory = {
    columns: EXPECTED_TABLES.map((table) => ({ table_name: table, column_name: "id" })),
    constraints: [{ table: "public.profiles", type: "p", columns: ["id"] }],
  };
  const logical = {
    tables: publicTables,
    auth_users: { row_count: 0, rows: [], canonical_sha256: emptyDigest },
    storage_buckets: { row_count: 0, rows: [], canonical_sha256: emptyDigest },
    storage_objects: { row_count: 0, rows: [], canonical_sha256: emptyDigest },
  };
  const input = `${Buffer.from(JSON.stringify(inventory)).toString("base64")}\n${Buffer.from(
    JSON.stringify(logical),
  ).toString("base64")}\n`;
  const entry = join(REPO_ROOT, "apps/web/node_modules/@electric-sql/pglite/dist/index.js");
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
  assert.equal(receipt.TableCount, 139);
  assert.equal(receipt.SourceCanonicalDigestsVerified, true);
  assert.equal(receipt.AuthDataDigestsVerified, true);
  assert.equal(receipt.StorageDataDigestsVerified, true);
  assert.equal(receipt.PlaintextWrittenToDisk, false);
});
