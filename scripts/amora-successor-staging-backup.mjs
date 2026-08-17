#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  assertSuccessorStagingBackupPlan,
  createEncryptedBackupFile,
  parseSupabaseTemporaryDatabaseCredentials,
  verifyEncryptedBackupFile,
} from "./lib/amora-successor-staging-backup.mjs";

const { Client } = pg;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const MIGRATION_VERSION = /^\d{14}$/;
const BACKUP_ROOT_NAME = "WeddingHanbang-Amora-Successor-Staging-Backups";
const CIPHERTEXT_FILE = "logical-data.ndjson.gz.aesgcm";
const KEY_FILE = "logical-data.key.dpapi";
const MANIFEST_FILE = "manifest.json";

function fail(message) {
  throw new Error(`AMORA_SUCCESSOR_STAGING_BACKUP_FAILED: ${message}`);
}

function parseArgs(argv) {
  const values = new Map();
  let inspect = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--inspect") {
      inspect = true;
      continue;
    }
    if (!arg.startsWith("--") || index + 1 >= argv.length) fail("arguments are malformed");
    if (values.has(arg)) fail("argument is duplicated");
    values.set(arg, argv[index + 1]);
    index += 1;
  }
  const allowed = new Set([
    "--project-ref",
    "--production-ref",
    "--expected-commit",
    "--expected-migration-head",
    "--expected-migration-count",
    "--expected-table-count",
    "--expected-inventory-sha256",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) fail("unknown argument");
  const projectRef = values.get("--project-ref");
  const productionProjectRef = values.get("--production-ref");
  const expectedCommit = values.get("--expected-commit");
  const expectedMigrationHead = values.get("--expected-migration-head");
  const migrationCountText = values.get("--expected-migration-count");
  if (!PROJECT_REF.test(projectRef ?? "")
      || !PROJECT_REF.test(productionProjectRef ?? "")
      || projectRef === productionProjectRef
      || !GIT_COMMIT.test(expectedCommit ?? "")
      || !MIGRATION_VERSION.test(expectedMigrationHead ?? "")
      || !/^\d{1,6}$/.test(migrationCountText ?? "")) {
    fail("required destination, commit or migration arguments are invalid");
  }
  const expectedMigrationCount = Number(migrationCountText);
  if (!Number.isSafeInteger(expectedMigrationCount) || expectedMigrationCount < 1) {
    fail("expected migration count is invalid");
  }
  const tableCountText = values.get("--expected-table-count");
  const expectedInventorySha256 = values.get("--expected-inventory-sha256");
  if (!inspect && (!/^\d{1,6}$/.test(tableCountText ?? "")
      || !SHA256.test(expectedInventorySha256 ?? ""))) {
    fail("capture requires the inspected table count and inventory digest");
  }
  return Object.freeze({
    inspect,
    projectRef,
    productionProjectRef,
    expectedCommit,
    expectedMigrationHead,
    expectedMigrationCount,
    expectedTableCount: inspect ? null : Number(tableCountText),
    expectedInventorySha256: inspect ? null : expectedInventorySha256,
  });
}

function runGit(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalInventory(tables) {
  return `${JSON.stringify(tables.map((table) => ({
    name: table.name,
    columns: table.columns,
  })))}\n`;
}

async function resolveSupabaseCli(repoRoot) {
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("the pinned staging backup runner currently requires Windows x64");
  }
  const store = join(repoRoot, "node_modules", ".pnpm");
  const candidates = (await readdir(store))
    .filter((name) => /^@supabase\+cli-windows-x64@\d+\.\d+\.\d+$/.test(name))
    .map((name) => join(store, name, "node_modules", "@supabase", "cli-windows-x64", "bin", "supabase.exe"))
    .filter((path) => existsSync(path));
  if (candidates.length !== 1) fail("the exact bundled Supabase CLI could not be resolved");
  return candidates[0];
}

function temporaryCredentials(cli, repoRoot, projectRef) {
  const result = spawnSync(cli, [
    "db",
    "dump",
    "--linked",
    "--data-only",
    "--dry-run",
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    fail("Supabase did not issue a temporary staging login");
  }
  return parseSupabaseTemporaryDatabaseCredentials(result.stdout, projectRef);
}

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value)) fail("database inventory contains an unsupported identifier");
  return `"${value}"`;
}

async function readSnapshotPlan(client, args, git) {
  await client.query("begin transaction isolation level repeatable read read only");
  await client.query("set local statement_timeout = '60s'");
  await client.query("set local lock_timeout = '5s'");
  const ledgerResult = await client.query(`
    select count(*)::int as migration_count, max(version)::text as migration_head
    from supabase_migrations.schema_migrations
  `);
  const ledger = ledgerResult.rows[0];
  const inventoryResult = await client.query(`
    select
      c.relname::text as table_name,
      json_agg(a.attname::text order by a.attnum) as columns
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and a.attnum > 0
      and not a.attisdropped
    group by c.relname
    order by c.relname
  `);
  const tables = inventoryResult.rows.map((row) => ({
    name: row.table_name,
    columns: row.columns,
  }));
  const plan = assertSuccessorStagingBackupPlan({
    projectRef: args.projectRef,
    productionProjectRef: args.productionProjectRef,
    expectedCommit: args.expectedCommit,
    actualCommit: git.actualCommit,
    originCommit: git.originCommit,
    trackedWorktreeClean: git.trackedWorktreeClean,
    migrationHead: ledger.migration_head,
    expectedMigrationHead: args.expectedMigrationHead,
    migrationCount: ledger.migration_count,
    expectedMigrationCount: args.expectedMigrationCount,
    tables,
  });
  return Object.freeze({
    plan,
    inventorySha256: sha256(canonicalInventory(plan.tables)),
  });
}

async function* snapshotLines(client, plan) {
  let totalRows = 0;
  yield {
    kind: "header",
    version: 1,
    projectRef: plan.projectRef,
    commit: plan.expectedCommit,
  };
  for (let index = 0; index < plan.tables.length; index += 1) {
    const table = plan.tables[index];
    yield { kind: "table", name: table.name, columns: table.columns };
    const cursor = `amora_successor_backup_${index}`;
    await client.query(`declare ${quoteIdentifier(cursor)} no scroll cursor for
      select row_to_json(t)::text as row_json from public.${quoteIdentifier(table.name)} as t`);
    let rowCount = 0;
    try {
      for (;;) {
        const result = await client.query(`fetch forward 250 from ${quoteIdentifier(cursor)}`);
        if (result.rows.length === 0) break;
        for (const row of result.rows) {
          if (typeof row.row_json !== "string") fail("database row serialization is malformed");
          let parsed;
          try { parsed = JSON.parse(row.row_json); }
          catch { fail("database row serialization is not JSON"); }
          if (parsed === null
              || typeof parsed !== "object"
              || Array.isArray(parsed)
              || Object.keys(parsed).length !== table.columns.length
              || !Object.keys(parsed).every((column, columnIndex) => column === table.columns[columnIndex])) {
            fail("database row serialization does not match the table inventory");
          }
          yield { kind: "row", table: table.name, valueJson: row.row_json };
          rowCount += 1;
        }
      }
    } finally {
      await client.query(`close ${quoteIdentifier(cursor)}`).catch(() => {});
    }
    totalRows += rowCount;
    yield { kind: "table_end", name: table.name, rowCount };
  }
  yield { kind: "footer", tableCount: plan.tables.length, rowCount: totalRows };
}

function powershell(args, input = null) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", ...args], {
    input,
    encoding: null,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) fail("Windows private-backup operation failed");
  return Buffer.from(result.stdout);
}

function secureDirectories(commonScript, root, partial) {
  const command = [
    ". $args[0]",
    "foreach ($path in @($args[1], $args[2])) {",
    "  [IO.Directory]::CreateDirectory($path) | Out-Null",
    "  Set-HBAM2PrivateDirectoryAcl -Path $path",
    "}",
  ].join("; ");
  powershell(["-Command", command, commonScript, root, partial]);
}

function dpapiProtect(key, entropy) {
  const command = [
    "Add-Type -AssemblyName System.Security",
    "$stream=[Console]::OpenStandardInput()",
    "$memory=[IO.MemoryStream]::new()",
    "$stream.CopyTo($memory)",
    "$raw=$memory.ToArray()",
    "$entropy=[Convert]::FromBase64String($args[0])",
    "$protected=[Security.Cryptography.ProtectedData]::Protect($raw,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::OpenStandardOutput().Write($protected,0,$protected.Length)",
  ].join("; ");
  return powershell(["-Command", command, entropy.toString("base64")], key);
}

function dpapiUnprotect(protectedKey, entropy) {
  const command = [
    "Add-Type -AssemblyName System.Security",
    "$stream=[Console]::OpenStandardInput()",
    "$memory=[IO.MemoryStream]::new()",
    "$stream.CopyTo($memory)",
    "$protected=$memory.ToArray()",
    "$entropy=[Convert]::FromBase64String($args[0])",
    "$raw=[Security.Cryptography.ProtectedData]::Unprotect($protected,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::OpenStandardOutput().Write($raw,0,$raw.Length)",
  ].join("; ");
  return powershell(["-Command", command, entropy.toString("base64")], protectedKey);
}

function utcDirectoryStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const linkedRef = (await readFile(join(repoRoot, "supabase", ".temp", "project-ref"), "utf8")).trim();
  if (linkedRef !== args.projectRef || linkedRef === args.productionProjectRef) {
    fail("linked Supabase project is not the exact approved staging destination");
  }
  const git = Object.freeze({
    actualCommit: runGit(repoRoot, ["rev-parse", "HEAD"]),
    originCommit: runGit(repoRoot, ["rev-parse", "@{u}"]),
    trackedWorktreeClean: runGit(repoRoot, ["status", "--porcelain", "--untracked-files=no"]) === "",
  });
  const cli = await resolveSupabaseCli(repoRoot);
  let credentials = temporaryCredentials(cli, repoRoot, args.projectRef);
  const client = new Client({
    ...credentials,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
    query_timeout: 65_000,
    application_name: "amora-successor-staging-backup-v1",
  });
  await client.connect();
  let transactionOpen = false;
  try {
    const snapshot = await readSnapshotPlan(client, args, git);
    transactionOpen = true;
    if (args.inspect) {
      await client.query("rollback");
      transactionOpen = false;
      process.stdout.write(`${JSON.stringify({
        mode: "inspect",
        projectRef: args.projectRef,
        commit: args.expectedCommit,
        migrationHead: snapshot.plan.migrationHead,
        migrationCount: snapshot.plan.migrationCount,
        tableCount: snapshot.plan.tables.length,
        inventorySha256: snapshot.inventorySha256,
      })}\n`);
      return;
    }
    if (snapshot.plan.tables.length !== args.expectedTableCount
        || snapshot.inventorySha256 !== args.expectedInventorySha256) {
      fail("staging table inventory changed after inspection");
    }

    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) fail("LOCALAPPDATA is unavailable");
    const root = resolve(localAppData, BACKUP_ROOT_NAME);
    if (relative(resolve(localAppData), root).startsWith("..") || basename(root) !== BACKUP_ROOT_NAME) {
      fail("backup root escaped its fixed local anchor");
    }
    const backupSetId = randomUUID();
    const capturedAt = new Date();
    const partial = join(root, `.partial-${utcDirectoryStamp(capturedAt)}-${backupSetId}`);
    const finalDirectory = join(root, `${utcDirectoryStamp(capturedAt)}-${backupSetId}`);
    if (existsSync(partial) || existsSync(finalDirectory)) fail("backup destination already exists");
    await mkdir(root, { recursive: true });
    const commonScript = join(repoRoot, "scripts", "amora-db-backup-common.ps1");
    secureDirectories(commonScript, root, partial);

    const key = randomBytes(32);
    const entropy = createHash("sha256").update([
      "amora-successor-staging-backup-v1",
      args.projectRef,
      backupSetId,
      args.expectedCommit,
    ].join("|"), "utf8").digest();
    try {
      const encrypted = await createEncryptedBackupFile({
        key,
        lines: snapshotLines(client, snapshot.plan),
        path: join(partial, CIPHERTEXT_FILE),
      });
      await client.query("commit");
      transactionOpen = false;
      const receipt = await verifyEncryptedBackupFile({ key, encrypted, plan: snapshot.plan });
      const protectedKey = dpapiProtect(key, entropy);
      const unprotected = dpapiUnprotect(protectedKey, entropy);
      if (unprotected.length !== key.length || !timingSafeEqual(unprotected, key)) {
        fail("DPAPI key round trip failed");
      }
      unprotected.fill(0);
      await writeFile(join(partial, KEY_FILE), protectedKey, { flag: "wx", mode: 0o600 });
      const manifest = {
        version: 1,
        kind: "amora-successor-staging-encrypted-logical-backup",
        backupSetId,
        capturedAt: capturedAt.toISOString(),
        projectRef: args.projectRef,
        productionProjectRef: args.productionProjectRef,
        commit: args.expectedCommit,
        migrationHead: snapshot.plan.migrationHead,
        migrationCount: snapshot.plan.migrationCount,
        tableCount: snapshot.plan.tables.length,
        inventorySha256: snapshot.inventorySha256,
        totalRows: receipt.totalRows,
        tableRows: receipt.tableRows,
        ciphertext: {
          file: CIPHERTEXT_FILE,
          algorithm: encrypted.algorithm,
          ivBase64: encrypted.iv.toString("base64"),
          authTagBase64: encrypted.authTag.toString("base64"),
          plaintextSha256: encrypted.plaintextSha256,
          ciphertextSha256: encrypted.ciphertextSha256,
          plaintextBytes: encrypted.plaintextBytes,
          ciphertextBytes: encrypted.ciphertextBytes,
        },
        key: {
          file: KEY_FILE,
          scope: "Windows DPAPI CurrentUser",
          entropySha256: sha256(entropy),
          protectedBlobSha256: sha256(protectedKey),
        },
        plaintextWrittenToDisk: false,
        verified: true,
      };
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(join(partial, MANIFEST_FILE), manifestText, { flag: "wx", mode: 0o600 });
      await rename(partial, finalDirectory);
      process.stdout.write(`${JSON.stringify({
        mode: "capture",
        verified: true,
        projectRef: args.projectRef,
        commit: args.expectedCommit,
        backupDirectory: finalDirectory,
        manifestSha256: sha256(manifestText),
        migrationHead: manifest.migrationHead,
        migrationCount: manifest.migrationCount,
        tableCount: manifest.tableCount,
        totalRows: manifest.totalRows,
        inventorySha256: manifest.inventorySha256,
        ciphertextSha256: manifest.ciphertext.ciphertextSha256,
        plaintextWrittenToDisk: false,
      })}\n`);
    } finally {
      key.fill(0);
    }
  } finally {
    if (transactionOpen) await client.query("rollback").catch(() => {});
    await client.end().catch(() => {});
    credentials = null;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown staging backup failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
