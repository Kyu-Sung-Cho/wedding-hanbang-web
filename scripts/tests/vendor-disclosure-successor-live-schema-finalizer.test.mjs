import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "../..");
const paths = Object.freeze({
  apply: "supabase/platform-operations/security/20260819121500_production_successor_live_schema_contract_apply.sql",
  rollback: "supabase/platform-operations/security/20260819121500_production_successor_live_schema_contract_rollback.sql",
  verify: "supabase/release-checks/20260819121500_production_successor_live_schema_contract_verify.sql",
  finalizer: "supabase/platform-operations/security/20260819122000_production_write_fence_successor_finalize.sql",
});

async function read(relativePath) {
  return readFile(resolve(repoRoot, relativePath), "utf8");
}

function expectedTablesFromBackup(source) {
  const block = source.match(
    /\$script:VDPostExpandExpectedTables = @\(([\s\S]*?)\r?\n\)/u,
  )?.[1];
  assert.ok(block, "backup expected-table block must exist");
  return [...block.matchAll(/^\s*'([a-z][a-z0-9_]*)',?\s*$/gmu)]
    .map((match) => match[1]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function runBackupPowerShell(command, input = undefined) {
  const commonPath = resolve(
    repoRoot,
    "scripts/vendor-disclosure-db-backup-common.ps1",
  ).replaceAll("'", "''");
  const result = spawnSync(
    "pwsh.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); "
        + "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); "
        + `. '${commonPath}'; ${command}`,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function powerShellCanonical(value) {
  const output = runBackupPowerShell(
    "$json = [Console]::In.ReadToEnd(); "
      + "$value = $json | ConvertFrom-Json; "
      + "$canonical = ConvertTo-VDCurrentBaselineCanonicalValue -Value $value; "
      + "$canonical | ConvertTo-Json -Depth 100 -Compress; "
      + "Get-VDPostExpandCanonicalJsonSha256 -Value $value",
    JSON.stringify(value),
  );
  const lines = output.trimEnd().split(/\r?\n/u);
  assert.equal(lines.length, 2, "PowerShell must emit canonical JSON plus one digest");
  return { canonical: lines[0], sha256: lines[1] };
}

async function backupPortableRoot(database) {
  const generated = runBackupPowerShell("New-VDPostExpandInventorySql");
  const cteStart = generated.search(/\bwith target\(name\)/iu);
  const finalSelectStart = generated.lastIndexOf("\nselect case when");
  assert.ok(cteStart >= 0 && finalSelectStart > cteStart);
  const query = `${generated.slice(cteStart, finalSelectStart)}
SELECT value::text AS payload FROM payload`
    // PGlite treats COLLATION as reserved in an alias position. These three
    // identifier-only substitutions preserve the PowerShell producer's JSON.
    .replace(/\bAS collation ON\b/giu, "AS collation_record ON")
    .replace(/\bcollation\./gu, "collation_record.")
    .replace(/\bAS collation(\s+FROM pg_namespace)/giu, "AS collation_name$1")
    .replace(/'collation', collation(\s*\))/gu, "'collation', collation_name$1");
  const payload = JSON.parse((await database.query(query)).rows[0].payload);
  return {
    public: payload.schema_contract,
    auth: payload.auth_schema_contract,
    storage: payload.storage_schema_contract,
  };
}

async function successorPortableRoot(database, apply) {
  const body = functionBody(
    apply,
    "public.production_successor_live_schema_contract_20260819()",
  );
  const selectStart = body.lastIndexOf("SELECT pg_catalog.encode");
  const fromRoot = body.indexOf("  FROM root_contract", selectStart);
  assert.ok(selectStart >= 0 && fromRoot > selectStart);
  const query = `${body.slice(0, selectStart)}SELECT value::text AS payload,
  public.production_successor_canonical_json_20260819(value) AS canonical,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    public.production_successor_canonical_json_20260819(value) || E'\\n',
    'UTF8'
  )), 'hex') AS sha256
${body.slice(fromRoot)}`;
  const result = (await database.query(query)).rows[0];
  return {
    canonical: result.canonical,
    root: JSON.parse(result.payload),
    sha256: result.sha256,
  };
}

function functionBody(source, signature) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const body = source.match(new RegExp(
    `CREATE FUNCTION ${escaped}[\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`,
    "u",
  ))?.[1];
  assert.ok(body, `function body must exist: ${signature}`);
  return body;
}

function functionBodyMd5(source, signature) {
  const body = functionBody(source, signature);
  return createHash("md5").update(body, "utf8").digest("hex");
}

async function loadPGlite() {
  const entry = join(
    repoRoot,
    "apps/web/node_modules/@electric-sql/pglite/dist/index.js",
  );
  return import(pathToFileURL(entry).href);
}

const releaseFixture = Object.freeze({
  projectRef: "abcdefghijklmnopqrst",
  release: "successor-test-release",
  commit: "a".repeat(40),
  owner: "12345678-1234-4234-8234-123456789abc",
  outcomePathSha: "b".repeat(64),
});

async function createCompleteSuccessorDatabase() {
  const [{ PGlite }, oldApply, successorApply, backup] = await Promise.all([
    loadPGlite(),
    read("supabase/platform-operations/security/20260717120000_production_write_fence_apply.sql"),
    read(paths.apply),
    read("scripts/vendor-disclosure-db-backup-common.ps1"),
  ]);
  const database = await PGlite.create();
  const tables = expectedTablesFromBackup(backup);
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations (
      version text PRIMARY KEY
    );
    CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, label text);
    CREATE TABLE storage.buckets (id text PRIMARY KEY);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text);
    ${tables.map((table) =>
      `CREATE TABLE public.${table} (id bigint PRIMARY KEY);`).join("\n")}
    CREATE FUNCTION public.production_storage_writes_allowed()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      SELECT NOT (
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger
          WHERE tgname = 'trg_production_write_fence_20260717'
            AND NOT tgisinternal
        )
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_event_trigger
          WHERE evtname = 'evt_production_write_fence_20260717'
        )
        OR pg_catalog.to_regprocedure(
          'public.production_write_fence_guard_20260717()'
        ) IS NOT NULL
        OR pg_catalog.to_regprocedure(
          'public.production_write_fence_attach_20260717()'
        ) IS NOT NULL
      )
    $$;
  `);
  await database.exec(oldApply);
  await database.exec(successorApply);
  await database.exec(`
    INSERT INTO public.production_release_lease_20260717 (
      singleton, release_id, release_commit, owner_id,
      outcome_path_sha256, phase
    ) VALUES (
      true, '${releaseFixture.release}', '${releaseFixture.commit}',
      '${releaseFixture.owner}', '${releaseFixture.outcomePathSha}',
      'deployment-canary'
    )
  `);
  return database;
}

async function renderSuccessorFinalizer(database, overrides = {}) {
  const finalizer = await read(paths.finalizer);
  const evidence = (await database.query(`
    SELECT
      (SELECT system_identifier::text
         FROM pg_catalog.pg_control_system()) AS database_system_identifier,
      pg_catalog.upper(
        public.production_successor_live_schema_contract_20260819()
      ) AS live_schema_contract_sha256
  `)).rows[0];
  const verifiedAt = new Date(Date.now() - 60_000);
  const values = {
    __HB_FINALIZER_PROJECT_REF__: releaseFixture.projectRef,
    __HB_FINALIZER_DATABASE_SYSTEM_IDENTIFIER__:
      evidence.database_system_identifier,
    __HB_FINALIZER_RELEASE_ID__: releaseFixture.release,
    __HB_FINALIZER_RELEASE_COMMIT__: releaseFixture.commit,
    __HB_FINALIZER_LEASE_OWNER_UUID__: releaseFixture.owner,
    __HB_FINALIZER_OUTCOME_PATH_SHA256__: releaseFixture.outcomePathSha,
    __HB_FINALIZER_OUTCOME_RECEIPT_SHA256__: "c".repeat(64),
    __HB_FINALIZER_DEPLOYMENT_ID__: "dpl_1234567890abcdefghijklmn",
    __HB_FINALIZER_DEPLOYMENT_URL_SHA256__: "d".repeat(64),
    __HB_FINALIZER_DEPLOYMENT_RECEIPT_SHA256__: "e".repeat(64),
    __HB_FINALIZER_CANARY_RECEIPT_SHA256__: "f".repeat(64),
    __HB_FINALIZER_POST_EXPAND_BACKUP_RECEIPT_SHA256__: "1".repeat(64),
    __HB_FINALIZER_POST_EXPAND_BACKUP_REVERIFICATION_SHA256__: "2".repeat(64),
    __HB_FINALIZER_RECOVERY_ASSURANCE_RECEIPT_SHA256__: "3".repeat(64),
    __HB_FINALIZER_POST_EXPAND_BACKUP_SET_ID__:
      "22345678-1234-4234-8234-123456789abc",
    __HB_FINALIZER_POST_EXPAND_BACKUP_MANIFEST_SHA256__: "a".repeat(64),
    __HB_FINALIZER_POST_EXPAND_TABLE_CONTRACT_SHA256__:
      "ddf672a17f28e99fd20646a3376cee696430b8b599e10979f6d2c7fd23e5482f",
    __HB_FINALIZER_POST_EXPAND_MIGRATION_CONTRACT_SHA256__:
      "807cacbc3a0df7f488908c3cd619879d389dd277bda37f97032d06fb960a44bf",
    __HB_FINALIZER_POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA256__:
      evidence.live_schema_contract_sha256.toLowerCase(),
    __HB_FINALIZER_POST_EXPAND_LOGICAL_DATA_CONTRACT_SHA256__: "b".repeat(64),
    __HB_FINALIZER_CANARY_VERIFIED_AT__: verifiedAt.toISOString(),
    __HB_FINALIZER_CANARY_EXPIRES_AT__:
      new Date(verifiedAt.getTime() + 15 * 60_000).toISOString(),
    ...overrides,
  };
  let rendered = finalizer;
  for (const [token, value] of Object.entries(values)) {
    assert.equal(rendered.split(token).length, 2, `exact token: ${token}`);
    rendered = rendered.replace(token, value);
  }
  assert.doesNotMatch(rendered, /__HB_FINALIZER_[A-Z0-9_]+__/u);
  return rendered;
}

async function assertCompleteFenceHeld(database) {
  const state = (await database.query(`
    SELECT
      pg_catalog.to_regprocedure(
        'public.production_write_fence_guard_20260717()'
      ) IS NOT NULL AS old_guard_present,
      pg_catalog.to_regprocedure(
        'public.production_write_fence_attach_20260717()'
      ) IS NOT NULL AS old_attach_present,
      pg_catalog.to_regprocedure(
        'public.production_live_schema_contract_20260717()'
      ) IS NOT NULL AS old_contract_present,
      pg_catalog.to_regprocedure(
        'public.production_successor_canonical_json_20260819(jsonb)'
      ) IS NOT NULL AS canonical_present,
      pg_catalog.to_regprocedure(
        'public.production_successor_live_schema_contract_20260819()'
      ) IS NOT NULL AS successor_contract_present,
      pg_catalog.to_regclass(
        'public.production_release_lease_20260717'
      ) IS NOT NULL AS lease_present,
      (SELECT pg_catalog.count(*)::integer
         FROM public.production_release_lease_20260717) AS lease_rows,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_event_trigger
        WHERE evtname IN (
          'evt_production_write_fence_ddl_lock_20260717',
          'evt_production_write_fence_20260717'
        ) AND evtenabled = 'O') AS event_trigger_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_trigger
        WHERE tgname = 'trg_production_write_fence_20260717'
          AND NOT tgisinternal AND tgenabled = 'O') AS table_trigger_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')) AS public_table_count,
      public.production_storage_writes_allowed() AS storage_allowed
  `)).rows[0];
  assert.deepEqual(state, {
    old_guard_present: true,
    old_attach_present: true,
    old_contract_present: true,
    canonical_present: true,
    successor_contract_present: true,
    lease_present: true,
    lease_rows: 1,
    event_trigger_count: 2,
    table_trigger_count: state.public_table_count,
    public_table_count: state.public_table_count,
    storage_allowed: false,
  });
}

test("successor live-schema operation exposes four new immutable SQL artifacts", async () => {
  const artifacts = await Promise.all(
    Object.values(paths).map((path) => readFile(resolve(repoRoot, path), "utf8")),
  );
  assert.equal(artifacts.length, 4);
  for (const sql of [artifacts[0], artifacts[1], artifacts[3]]) {
    assert.match(sql, /^BEGIN;/u);
    assert.match(sql, /COMMIT;\s*$/u);
  }
  assert.match(artifacts[2], /^BEGIN TRANSACTION READ ONLY;/u);
  assert.match(artifacts[2], /ROLLBACK;\s*$/u);
});

test("apply pins the backup's exact 139-table portable contract without evaluating it pre-backup", async () => {
  const [apply, backup] = await Promise.all([
    read(paths.apply),
    read("scripts/vendor-disclosure-db-backup-common.ps1"),
  ]);
  const expectedTables = expectedTablesFromBackup(backup);
  const targetBlock = apply.match(
    /WITH target\(name\) AS \(\s*VALUES([\s\S]*?)\s*\),\s*target_relations/iu,
  )?.[1];
  assert.equal(expectedTables.length, 139);
  assert.ok(targetBlock, "successor target-table CTE must exist");
  assert.deepEqual(
    [...targetBlock.matchAll(/\('([a-z][a-z0-9_]*)'::text\)/gu)]
      .map((match) => match[1]),
    expectedTables,
  );
  assert.match(
    apply,
    /CREATE FUNCTION public\.production_successor_canonical_json_20260819\(value jsonb\)/u,
  );
  assert.match(
    apply,
    /CREATE FUNCTION public\.production_successor_live_schema_contract_20260819\(\)\s*RETURNS text\s*LANGUAGE sql\s*STABLE\s*SECURITY INVOKER\s*SET search_path = pg_catalog, public/iu,
  );
  assert.match(apply, /ALTER FUNCTION public\.production_successor_live_schema_contract_20260819\(\)\s+OWNER TO postgres/iu);
  assert.match(apply, /REVOKE ALL ON FUNCTION public\.production_successor_live_schema_contract_20260819\(\)\s*FROM PUBLIC, anon, authenticated, service_role/iu);
  assert.doesNotMatch(
    apply,
    /SELECT\s+(?:pg_catalog\.)?production_successor_live_schema_contract_20260819\s*\(/iu,
  );
});

test("post-expand v2 backup provenance keeps source identity explicit without a restore-target claim", async () => {
  const backup = await read("scripts/vendor-disclosure-db-backup-common.ps1");
  const receiptKeysBlock = backup.match(
    /\$script:VDPostExpandVerificationReceiptKeys = @\(([\s\S]*?)\r?\n\)/u,
  )?.[1];
  assert.ok(receiptKeysBlock);
  const receiptKeys = [...receiptKeysBlock.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/gu)]
    .map((match) => match[1]);
  assert.ok(receiptKeys.includes("sourceDatabaseOid"));
  assert.ok(receiptKeys.includes("sourceDatabaseSystemIdentifier"));
  assert.ok(!receiptKeys.some((key) => key.startsWith("targetDatabase")));
});

test("PGlite applies over the old fence and emits the PowerShell-canonical 139-table root digest", async () => {
  const [{ PGlite }, oldApply, successorApply, backup] = await Promise.all([
    loadPGlite(),
    read("supabase/platform-operations/security/20260717120000_production_write_fence_apply.sql"),
    read(paths.apply),
    read("scripts/vendor-disclosure-db-backup-common.ps1"),
  ]);
  const tables = expectedTablesFromBackup(backup);
  const database = await PGlite.create();
  try {
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE SCHEMA storage;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (
        version text PRIMARY KEY
      );
      CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        label text DEFAULT '한글, quote: "ok"'
      );
      CREATE TABLE storage.buckets (id text PRIMARY KEY);
      CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text);
      ${tables.filter((table) => table !== "wishlists")
        .map((table) => `CREATE TABLE public.${table} (id bigint PRIMARY KEY);`)
        .join("\n")}
    `);
    await database.exec(oldApply);
    await database.exec(successorApply);

    const incomplete = await database.query(`
      SELECT public.production_successor_live_schema_contract_20260819()
        AS sha256
    `);
    assert.equal(incomplete.rows[0].sha256, null);

    const sample = {
      z: "한글, quote: \"ok\"",
      aa: [{ longer: false, a: null }, 17],
      b: { two: "line\\nslash\\\\", one: true },
    };
    const expectedCanonical = canonicalJson(sample);
    const serialized = await database.query(
      `SELECT public.production_successor_canonical_json_20260819($1::jsonb)
         AS canonical`,
      [JSON.stringify(sample)],
    );
    assert.equal(serialized.rows[0].canonical, expectedCanonical);
    const expectedSha = createHash("sha256")
      .update(`${expectedCanonical}\n`, "utf8")
      .digest("hex");
    const powershell = powerShellCanonical(sample);
    assert.equal(powershell.canonical, expectedCanonical);
    assert.equal(powershell.sha256, expectedSha);
    const serializedSha = await database.query(
      `SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
         public.production_successor_canonical_json_20260819($1::jsonb) || E'\\n',
         'UTF8'
       )), 'hex') AS sha256`,
      [JSON.stringify(sample)],
    );
    assert.equal(serializedSha.rows[0].sha256, expectedSha);

    await database.exec("CREATE TABLE public.wishlists (id bigint PRIMARY KEY)");
    const complete = await database.query(`
      SELECT public.production_successor_live_schema_contract_20260819()
        AS sha256
    `);
    const portableRoot = await backupPortableRoot(database);
    const successor = await successorPortableRoot(database, successorApply);
    assert.deepEqual(successor.root, portableRoot);
    assert.deepEqual(Object.keys(portableRoot).sort(), ["auth", "public", "storage"]);
    assert.deepEqual(Object.keys(portableRoot.public).sort(), [
      "columns",
      "constraints",
      "indexes",
      "policies",
      "tables",
      "triggers",
    ]);
    const rootCanonical = canonicalJson(portableRoot);
    const rootSha256 = createHash("sha256")
      .update(`${rootCanonical}\n`, "utf8")
      .digest("hex");
    const powershellRoot = powerShellCanonical(portableRoot);
    assert.equal(powershellRoot.canonical, rootCanonical);
    assert.equal(powershellRoot.sha256, rootSha256);
    const sqlRootCanonical = (await database.query(
      `SELECT public.production_successor_canonical_json_20260819($1::jsonb)
         AS canonical`,
      [JSON.stringify(portableRoot)],
    )).rows[0].canonical;
    assert.equal(sqlRootCanonical, rootCanonical);
    assert.equal(successor.canonical, rootCanonical);
    assert.equal(successor.sha256, rootSha256);
    assert.equal(complete.rows[0].sha256, rootSha256);
  } finally {
    await database.close();
  }
}, 30_000);

test("verify is metadata-only and rollback removes only exact successor helpers", async () => {
  const [apply, verify, rollback] = await Promise.all([
    read(paths.apply),
    read(paths.verify),
    read(paths.rollback),
  ]);
  const canonicalMd5 = functionBodyMd5(
    apply,
    "public.production_successor_canonical_json_20260819(value jsonb)",
  );
  const liveMd5 = functionBodyMd5(
    apply,
    "public.production_successor_live_schema_contract_20260819()",
  );
  for (const sql of [verify, rollback]) {
    assert.match(sql, new RegExp(canonicalMd5, "u"));
    assert.match(sql, new RegExp(liveMd5, "u"));
    assert.match(sql, /search_path=pg_catalog/u);
  }
  assert.doesNotMatch(
    verify,
    /(?:SELECT|PERFORM)\s+(?:pg_catalog\.upper\s*\(\s*)?public\.production_successor_live_schema_contract_20260819\s*\(/iu,
  );
  assert.match(
    verify,
    /SELECT\s+true AS verified,\s+1::integer AS production_successor_live_schema_contract_verify_count/iu,
  );
  const liveDrop = rollback.indexOf(
    "DROP FUNCTION public.production_successor_live_schema_contract_20260819()",
  );
  const canonicalDrop = rollback.indexOf(
    "DROP FUNCTION public.production_successor_canonical_json_20260819(jsonb)",
  );
  assert.ok(liveDrop >= 0 && canonicalDrop > liveDrop);
  assert.doesNotMatch(rollback, /DROP (?:FUNCTION|TABLE|EVENT TRIGGER).*20260717/iu);
});

test("successor finalizer preserves exact-owner atomic semantics and binds the 139-table helper", async () => {
  const [apply, oldFinalizer, finalizer] = await Promise.all([
    read(paths.apply),
    read("supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql"),
    read(paths.finalizer),
  ]);
  const tokens = [...oldFinalizer.matchAll(/__HB_FINALIZER_[A-Z0-9_]+__/gu)]
    .map((match) => match[0]);
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens.filter(
    (entry) => entry
      !== "__HB_FINALIZER_POST_EXPAND_HOSTED_RESTORE_RECEIPT_SHA256__",
  )) {
    assert.equal(finalizer.split(token).length, 2, `exact token: ${token}`);
  }
  assert.equal(
    finalizer.split("__HB_FINALIZER_RECOVERY_ASSURANCE_RECEIPT_SHA256__")
      .length,
    2,
  );
  assert.doesNotMatch(finalizer, /HOSTED_RESTORE/iu);
  assert.match(finalizer, /ddf672a17f28e99fd20646a3376cee696430b8b599e10979f6d2c7fd23e5482f/u);
  assert.match(finalizer, /807cacbc3a0df7f488908c3cd619879d389dd277bda37f97032d06fb960a44bf/u);
  assert.match(
    finalizer,
    /actual_live_schema_contract_sha256\s*:=\s*pg_catalog\.lower\(\s*public\.production_successor_live_schema_contract_20260819\(\)\s*\)/iu,
  );
  assert.match(finalizer, new RegExp(functionBodyMd5(
    apply,
    "public.production_successor_canonical_json_20260819(value jsonb)",
  ), "u"));
  assert.match(finalizer, new RegExp(functionBodyMd5(
    apply,
    "public.production_successor_live_schema_contract_20260819()",
  ), "u"));
  for (const oldMd5 of [
    "e9dc644c0ad98b742bde0e3c83c26f93",
    "9053c6d394854777b878bd219203b06a",
    "96ee93c897faa81bae68c8c65e29610b",
  ]) {
    assert.match(finalizer, new RegExp(oldMd5, "u"));
  }
  assert.match(finalizer, /named_function_count\s*<>\s*5/iu);
  assert.match(finalizer, /phase\s*=\s*'deployment-canary'/iu);
  assert.match(finalizer, /GET DIAGNOSTICS removed_lease_count\s*=\s*ROW_COUNT/iu);
  assert.match(finalizer, /pg_advisory_xact_lock\(7523370826071712::bigint\)/iu);
  for (const drop of [
    "DROP FUNCTION public.production_successor_live_schema_contract_20260819()",
    "DROP FUNCTION public.production_successor_canonical_json_20260819(jsonb)",
    "DROP FUNCTION public.production_live_schema_contract_20260717()",
    "DROP FUNCTION public.production_write_fence_attach_20260717()",
    "DROP FUNCTION public.production_write_fence_guard_20260717()",
    "DROP TABLE public.production_release_lease_20260717",
  ]) {
    assert.match(finalizer, new RegExp(drop.replace(/[()]/gu, "\\$&"), "u"));
  }
  assert.ok(Buffer.byteLength(finalizer, "utf8") <= 28 * 1024);
});

test("the portable digest detects public, auth and storage schema drift independently", async () => {
  const database = await createCompleteSuccessorDatabase();
  try {
    const digest = async () => (await database.query(`
      SELECT public.production_successor_live_schema_contract_20260819()
        AS sha256
    `)).rows[0].sha256;
    const initial = await digest();
    assert.match(initial, /^[a-f0-9]{64}$/u);
    await database.exec("ALTER TABLE public.wishlists ADD COLUMN note text");
    const publicDrift = await digest();
    assert.notEqual(publicDrift, initial);
    await database.exec("ALTER TABLE auth.users ADD COLUMN phone text");
    const authDrift = await digest();
    assert.notEqual(authDrift, publicDrift);
    await database.exec("ALTER TABLE storage.objects ADD COLUMN owner_id uuid");
    const storageDrift = await digest();
    assert.notEqual(storageDrift, authDrift);
  } finally {
    await database.close();
  }
}, 30_000);

test("wrong live evidence and helper-body tampering fail before any fence removal", async () => {
  const [rollback] = await Promise.all([read(paths.rollback)]);

  const wrongDigestDatabase = await createCompleteSuccessorDatabase();
  try {
    await assert.rejects(
      wrongDigestDatabase.exec(await renderSuccessorFinalizer(
        wrongDigestDatabase,
        { __HB_FINALIZER_POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA256__: "0".repeat(64) },
      )),
      /PRODUCTION_WRITE_FENCE_FINALIZER_LIVE_SCHEMA_CONTRACT_MISMATCH/u,
    );
    await wrongDigestDatabase.exec("ROLLBACK").catch(() => {});
    await assertCompleteFenceHeld(wrongDigestDatabase);
  } finally {
    await wrongDigestDatabase.close();
  }

  const tamperedDatabase = await createCompleteSuccessorDatabase();
  try {
    await tamperedDatabase.exec(`
      CREATE OR REPLACE FUNCTION
        public.production_successor_canonical_json_20260819(value jsonb)
      RETURNS text
      LANGUAGE plpgsql
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      SECURITY INVOKER
      SET search_path = pg_catalog
      AS $tampered$
      BEGIN
        RETURN value::text;
      END
      $tampered$
    `);
    await assert.rejects(
      tamperedDatabase.exec(await renderSuccessorFinalizer(tamperedDatabase)),
      /PRODUCTION_WRITE_FENCE_FINALIZER_PRECONDITION_FAILED/u,
    );
    await tamperedDatabase.exec("ROLLBACK").catch(() => {});
    await assertCompleteFenceHeld(tamperedDatabase);
    await assert.rejects(
      tamperedDatabase.exec(rollback),
      /PRODUCTION_SUCCESSOR_SCHEMA_CONTRACT_ROLLBACK_PRECONDITION_FAILED/u,
    );
    await tamperedDatabase.exec("ROLLBACK").catch(() => {});
    await assertCompleteFenceHeld(tamperedDatabase);
  } finally {
    await tamperedDatabase.close();
  }
}, 30_000);

test("PGlite finalizer atomically consumes the exact owner and removes both helper generations", async () => {
  const database = await createCompleteSuccessorDatabase();
  try {
    const helperMetadata = (await database.query(`
      SELECT pg_catalog.array_agg(
        procedure_record.proname || ':' ||
        pg_catalog.md5(procedure_record.prosrc) || ':' ||
        pg_catalog.pg_get_userbyid(procedure_record.proowner) || ':' ||
        language_definition.lanname || ':' ||
        procedure_record.prokind::text || ':' ||
        procedure_record.prosecdef::text || ':' ||
        procedure_record.provolatile::text || ':' ||
        procedure_record.proparallel::text || ':' ||
        procedure_record.proisstrict::text || ':' ||
        procedure_record.proleakproof::text || ':' ||
        pg_catalog.array_to_string(procedure_record.proconfig, ',') || ':' ||
        pg_catalog.pg_get_function_result(procedure_record.oid) || ':' ||
        pg_catalog.has_function_privilege(
          'anon', procedure_record.oid, 'EXECUTE'
        )::text || ':' ||
        pg_catalog.has_function_privilege(
          'authenticated', procedure_record.oid, 'EXECUTE'
        )::text || ':' ||
        pg_catalog.has_function_privilege(
          'service_role', procedure_record.oid, 'EXECUTE'
        )::text
        ORDER BY procedure_record.proname
      ) AS value
      FROM pg_catalog.pg_proc AS procedure_record
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure_record.pronamespace
      JOIN pg_catalog.pg_language AS language_definition
        ON language_definition.oid = procedure_record.prolang
      WHERE namespace.nspname = 'public'
        AND procedure_record.proname IN (
          'production_successor_canonical_json_20260819',
          'production_successor_live_schema_contract_20260819'
        )
    `)).rows[0].value;
    assert.deepEqual(helperMetadata, [
      "production_successor_canonical_json_20260819:2ca15a7556f9e5cd0338bd90795c4e71:postgres:plpgsql:f:false:i:s:true:false:search_path=pg_catalog:text:false:false:false",
      "production_successor_live_schema_contract_20260819:7e3df3bebf5babb0b0035a4e202c0b3f:postgres:sql:f:false:s:u:false:false:search_path=pg_catalog, public:text:false:false:false",
    ]);
    await database.exec(await renderSuccessorFinalizer(database));
    const state = (await database.query(`
      SELECT
        pg_catalog.to_regclass(
          'public.production_release_lease_20260717'
        ) AS lease,
        pg_catalog.to_regprocedure(
          'public.production_write_fence_guard_20260717()'
        ) AS old_guard,
        pg_catalog.to_regprocedure(
          'public.production_write_fence_attach_20260717()'
        ) AS old_attach,
        pg_catalog.to_regprocedure(
          'public.production_live_schema_contract_20260717()'
        ) AS old_contract,
        pg_catalog.to_regprocedure(
          'public.production_successor_canonical_json_20260819(jsonb)'
        ) AS canonical_helper,
        pg_catalog.to_regprocedure(
          'public.production_successor_live_schema_contract_20260819()'
        ) AS successor_contract,
        public.production_storage_writes_allowed() AS storage_allowed,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_trigger
          WHERE tgname = 'trg_production_write_fence_20260717') AS trigger_count
    `)).rows[0];
    assert.deepEqual(state, {
      lease: null,
      old_guard: null,
      old_attach: null,
      old_contract: null,
      canonical_helper: null,
      successor_contract: null,
      storage_allowed: true,
      trigger_count: 0,
    });
  } finally {
    await database.close();
  }
}, 30_000);

test("PGlite verify is read-only and rollback preserves the complete old fence", async () => {
  const database = await createCompleteSuccessorDatabase();
  const [verify, rollback] = await Promise.all([
    read(paths.verify),
    read(paths.rollback),
  ]);
  try {
    await database.exec(verify);
    await database.exec(rollback);
    const state = (await database.query(`
      SELECT
        pg_catalog.to_regprocedure(
          'public.production_successor_canonical_json_20260819(jsonb)'
        ) AS canonical_helper,
        pg_catalog.to_regprocedure(
          'public.production_successor_live_schema_contract_20260819()'
        ) AS successor_contract,
        pg_catalog.to_regprocedure(
          'public.production_write_fence_guard_20260717()'
        ) IS NOT NULL AS old_guard_present,
        pg_catalog.to_regprocedure(
          'public.production_write_fence_attach_20260717()'
        ) IS NOT NULL AS old_attach_present,
        pg_catalog.to_regprocedure(
          'public.production_live_schema_contract_20260717()'
        ) IS NOT NULL AS old_contract_present,
        pg_catalog.to_regclass(
          'public.production_release_lease_20260717'
        ) IS NOT NULL AS old_lease_present,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_event_trigger
          WHERE evtname IN (
            'evt_production_write_fence_ddl_lock_20260717',
            'evt_production_write_fence_20260717'
          )) AS old_event_trigger_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_trigger
          WHERE tgname = 'trg_production_write_fence_20260717') AS old_table_trigger_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_class AS relation
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relkind IN ('r', 'p')) AS public_table_count
    `)).rows[0];
    assert.equal(state.canonical_helper, null);
    assert.equal(state.successor_contract, null);
    assert.equal(state.old_guard_present, true);
    assert.equal(state.old_attach_present, true);
    assert.equal(state.old_contract_present, true);
    assert.equal(state.old_lease_present, true);
    assert.equal(state.old_event_trigger_count, 2);
    assert.equal(state.old_table_trigger_count, state.public_table_count);
  } finally {
    await database.close();
  }
}, 30_000);
