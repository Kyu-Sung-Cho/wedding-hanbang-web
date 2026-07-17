// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const operationRoot = resolve(
  repoRoot,
  "supabase/platform-operations/security"
);
const applySql = readFileSync(
  resolve(operationRoot, "20260717120000_production_write_fence_apply.sql"),
  "utf8"
);
const finalizerTemplate = readFileSync(
  resolve(operationRoot, "20260717121000_production_write_fence_finalize.sql"),
  "utf8"
);

const PROJECT_REF = "abcdefghijklmnopqrst";
const RELEASE = "test-release";
const COMMIT = "a".repeat(40);
const OWNER = "12345678-1234-4234-8234-123456789abc";
const OUTCOME_PATH_SHA = "b".repeat(64);
const OUTCOME_SHA = "c".repeat(64);
const DEPLOYMENT_ID = "dpl_1234567890abcdefghijklmn";
const DEPLOYMENT_URL_SHA = "d".repeat(64);
const DEPLOYMENT_RECEIPT_SHA = "e".repeat(64);
const CANARY_RECEIPT_SHA = "f".repeat(64);
const POST_EXPAND_BACKUP_RECEIPT_SHA = "1".repeat(64);
const POST_EXPAND_BACKUP_REVERIFICATION_SHA = "3".repeat(64);
const POST_EXPAND_HOSTED_RESTORE_RECEIPT_SHA = "2".repeat(64);
const POST_EXPAND_BACKUP_SET_ID = "22345678-1234-4234-8234-123456789abc";
const POST_EXPAND_BACKUP_MANIFEST_SHA = "A".repeat(64);
const POST_EXPAND_TABLE_CONTRACT_SHA =
  "aa6d4bbbd17d753fa31846568af3402afd51e79ad665bd5b9d204d162fef10ac";
const POST_EXPAND_MIGRATION_CONTRACT_SHA =
  "c5e1d58c77f8c11e3d203046d55aadd9d5d09c2c04c639206cc1265b6a899beb";
const DATABASE_SYSTEM_IDENTIFIER = "7000000000000000001";
const POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA = "A".repeat(64);
const POST_EXPAND_LOGICAL_DATA_CONTRACT_SHA = "B".repeat(64);
const POST_EXPAND_TABLES = [
  "account_deletion_jobs", "account_deletion_media_manifest",
  "ai_interactions_log", "amora_actions", "amora_care_deliveries",
  "amora_care_jobs", "amora_care_scan_states", "amora_chat_request_claims",
  "amora_conflict_check_claims", "amora_couple_profiles",
  "amora_mediation_acceptances", "amora_memory_consents", "amora_memory_jobs",
  "amora_memory_settings", "amora_tool_executions", "amora_turn_counters",
  "amora_turn_requests", "booking_projection_jobs", "chat_feedback",
  "chat_messages", "chat_summaries", "community_upload_sessions", "couples",
  "decision_nodes", "profiles", "vendor_reviews", "wedding_journeys",
];
const POST_EXPAND_MIGRATIONS = [
  "20260716090000", "20260716091000", "20260716092000", "20260716093000",
  "20260716094000", "20260716095000", "20260716096000", "20260716097000",
  "20260716098000", "20260716099000", "20260716100000", "20260716102000",
  "20260716103000", "20260716104000", "20260716105000", "20260716106000",
  "20260716107000", "20260716108000", "20260716109000", "20260716110000",
  "20260716111000", "20260716112000", "20260716113000", "20260716114000",
  "20260716115000", "20260716116000", "20260716117000",
];

function canonicalInstant(date: Date): string {
  return date.toISOString();
}

function renderFinalizer(overrides: Record<string, string> = {}): string {
  const verifiedAt = new Date(Date.now() - 60_000);
  const values: Record<string, string> = {
    __HB_FINALIZER_PROJECT_REF__: PROJECT_REF,
    __HB_FINALIZER_DATABASE_SYSTEM_IDENTIFIER__: DATABASE_SYSTEM_IDENTIFIER,
    __HB_FINALIZER_RELEASE_ID__: RELEASE,
    __HB_FINALIZER_RELEASE_COMMIT__: COMMIT,
    __HB_FINALIZER_LEASE_OWNER_UUID__: OWNER,
    __HB_FINALIZER_OUTCOME_PATH_SHA256__: OUTCOME_PATH_SHA,
    __HB_FINALIZER_OUTCOME_RECEIPT_SHA256__: OUTCOME_SHA,
    __HB_FINALIZER_DEPLOYMENT_ID__: DEPLOYMENT_ID,
    __HB_FINALIZER_DEPLOYMENT_URL_SHA256__: DEPLOYMENT_URL_SHA,
    __HB_FINALIZER_DEPLOYMENT_RECEIPT_SHA256__: DEPLOYMENT_RECEIPT_SHA,
    __HB_FINALIZER_CANARY_RECEIPT_SHA256__: CANARY_RECEIPT_SHA,
    __HB_FINALIZER_POST_EXPAND_BACKUP_RECEIPT_SHA256__:
      POST_EXPAND_BACKUP_RECEIPT_SHA,
    __HB_FINALIZER_POST_EXPAND_BACKUP_REVERIFICATION_SHA256__:
      POST_EXPAND_BACKUP_REVERIFICATION_SHA,
    __HB_FINALIZER_POST_EXPAND_HOSTED_RESTORE_RECEIPT_SHA256__:
      POST_EXPAND_HOSTED_RESTORE_RECEIPT_SHA,
    __HB_FINALIZER_POST_EXPAND_BACKUP_SET_ID__: POST_EXPAND_BACKUP_SET_ID,
    __HB_FINALIZER_POST_EXPAND_BACKUP_MANIFEST_SHA256__:
      POST_EXPAND_BACKUP_MANIFEST_SHA,
    __HB_FINALIZER_POST_EXPAND_TABLE_CONTRACT_SHA256__:
      POST_EXPAND_TABLE_CONTRACT_SHA,
    __HB_FINALIZER_POST_EXPAND_MIGRATION_CONTRACT_SHA256__:
      POST_EXPAND_MIGRATION_CONTRACT_SHA,
    __HB_FINALIZER_POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA256__:
      POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA,
    __HB_FINALIZER_POST_EXPAND_LOGICAL_DATA_CONTRACT_SHA256__:
      POST_EXPAND_LOGICAL_DATA_CONTRACT_SHA,
    __HB_FINALIZER_CANARY_VERIFIED_AT__: canonicalInstant(verifiedAt),
    __HB_FINALIZER_CANARY_EXPIRES_AT__: canonicalInstant(
      new Date(verifiedAt.getTime() + 15 * 60_000)
    ),
    ...overrides,
  };
  let sql = finalizerTemplate;
  for (const [token, value] of Object.entries(values)) {
    expect(sql.split(token)).toHaveLength(2);
    sql = sql.replace(token, value);
  }
  expect(sql).not.toMatch(/__HB_FINALIZER_[A-Z0-9_]+__/);
  return sql;
}

const fencedDatabaseEvidence = new WeakMap<
  PGlite,
  { databaseSystemIdentifier: string; liveSchemaContractSha256: string }
>();

async function renderFinalizerFor(
  db: PGlite,
  overrides: Record<string, string> = {}
): Promise<string> {
  const evidence = fencedDatabaseEvidence.get(db);
  expect(evidence).toBeDefined();
  return renderFinalizer({
    __HB_FINALIZER_DATABASE_SYSTEM_IDENTIFIER__:
      evidence?.databaseSystemIdentifier ?? DATABASE_SYSTEM_IDENTIFIER,
    __HB_FINALIZER_POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA256__:
      evidence?.liveSchemaContractSha256 ?? POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA,
    ...overrides,
  });
}

async function createFencedDatabase(
  phase = "deployment-canary"
): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        NULLIF(current_setting('request.jwt.claim.role', true), '')
      )
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations (
      version text PRIMARY KEY
    );
    INSERT INTO supabase_migrations.schema_migrations (version) VALUES
      ${POST_EXPAND_MIGRATIONS.map((version) => `('${version}')`).join(",\n      ")};

    ${POST_EXPAND_TABLES.map(
      (table) => `CREATE TABLE public.${table} (id bigint);`
    ).join("\n    ")}

    CREATE TABLE public.fence_probe (value text NOT NULL);
    GRANT SELECT, INSERT ON public.fence_probe TO authenticated;

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
  await db.exec(applySql);
  await db.exec(`
    INSERT INTO public.production_release_lease_20260717 (
      singleton,
      release_id,
      release_commit,
      owner_id,
      outcome_path_sha256,
      phase
    ) VALUES (
      true,
      '${RELEASE}',
      '${COMMIT}',
      '${OWNER}',
      '${OUTCOME_PATH_SHA}',
      '${phase}'
    );
  `);
  const evidence = (await db.query(`
    SELECT
      (SELECT system_identifier::text
         FROM pg_catalog.pg_control_system()) AS database_system_identifier,
      pg_catalog.upper(
        public.production_live_schema_contract_20260717()
      ) AS live_schema_contract_sha256
  `)).rows[0] as {
    database_system_identifier: string;
    live_schema_contract_sha256: string;
  };
  fencedDatabaseEvidence.set(db, {
    databaseSystemIdentifier: evidence.database_system_identifier,
    liveSchemaContractSha256: evidence.live_schema_contract_sha256,
  });
  return db;
}

async function expectFenceIntact(db: PGlite): Promise<void> {
  expect((await db.query(`
    SELECT count(*)::integer AS count
    FROM public.production_release_lease_20260717
  `)).rows[0]).toEqual({ count: 1 });
  expect((await db.query(`
    SELECT
      count(*)::integer AS count,
      (SELECT count(*)::integer
         FROM pg_class AS public_relation
         JOIN pg_namespace AS public_namespace
           ON public_namespace.oid = public_relation.relnamespace
        WHERE public_namespace.nspname = 'public'
          AND public_relation.relkind IN ('r', 'p')) AS public_table_count
    FROM pg_trigger AS trigger_record
    JOIN pg_class AS relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND trigger_record.tgname = 'trg_production_write_fence_20260717'
  `)).rows[0]).toEqual({ count: 29, public_table_count: 29 });
  expect((await db.query(`
    SELECT public.production_storage_writes_allowed() AS allowed
  `)).rows[0]).toEqual({ allowed: false });
}

describe("exact-owner atomic production write-fence finalizer", () => {
  it("captures a deterministic live schema contract that changes on column drift", async () => {
    const db = await createFencedDatabase();
    try {
      const capture = async () => (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };

      const first = await capture();
      const repeated = await capture();
      expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(repeated).toEqual(first);

      await db.exec(`
        ALTER TABLE public.profiles
        ADD COLUMN finalizer_drift_probe text DEFAULT 'changed'
      `);
      const drifted = await capture();
      expect(drifted.sha256).not.toBe(first.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when table RLS posture drifts", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec("ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY");
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when table durability drifts", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec("ALTER TABLE public.profiles SET UNLOGGED");
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when a table constraint drifts", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        ALTER TABLE public.profiles
        ADD CONSTRAINT finalizer_drift_check CHECK (id >= 0)
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when an RLS policy drifts", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        CREATE POLICY finalizer_drift_policy ON public.profiles
        FOR SELECT TO authenticated USING (id >= 0)
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when a table trigger drifts", async () => {
    const db = await createFencedDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.finalizer_drift_trigger()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RETURN NEW;
        END
        $$
      `);
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        CREATE TRIGGER finalizer_drift_trigger
        BEFORE UPDATE ON public.profiles
        FOR EACH ROW EXECUTE FUNCTION public.finalizer_drift_trigger()
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when an RPC definition drifts", async () => {
    const db = await createFencedDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.finalizer_drift_rpc()
        RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 1 $$
      `);
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.finalizer_drift_rpc()
        RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 2 $$
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when an index drifts", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec("CREATE INDEX finalizer_drift_idx ON public.profiles (id)");
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when a referenced enum drifts", async () => {
    const db = await createFencedDatabase();
    try {
      await db.exec(`
        CREATE TYPE public.finalizer_drift_enum AS ENUM ('first');
        ALTER TABLE public.profiles
        ADD COLUMN finalizer_enum_probe public.finalizer_drift_enum
      `);
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec("ALTER TYPE public.finalizer_drift_enum ADD VALUE 'second'");
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when table or RPC ACLs drift", async () => {
    const db = await createFencedDatabase();
    try {
      const capture = async () => (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      const initial = await capture();
      await db.exec("GRANT SELECT ON public.profiles TO authenticated");
      const tableAclDrift = await capture();
      expect(tableAclDrift.sha256).not.toBe(initial.sha256);

      await db.exec(`
        REVOKE EXECUTE ON FUNCTION public.production_storage_writes_allowed()
        FROM PUBLIC
      `);
      const rpcAclDrift = await capture();
      expect(rpcAclDrift.sha256).not.toBe(tableAclDrift.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when a column ACL drifts", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        GRANT SELECT (id) ON public.profiles TO authenticated
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when an owned sequence drifts", async () => {
    const db = await createFencedDatabase();
    try {
      await db.exec(`
        CREATE SEQUENCE public.finalizer_drift_sequence
        OWNED BY public.profiles.id
      `);
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        ALTER SEQUENCE public.finalizer_drift_sequence INCREMENT BY 2
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when pre-release ledger history drifts", async () => {
    const db = await createFencedDatabase();
    try {
      await db.exec(`
        INSERT INTO supabase_migrations.schema_migrations (version)
        VALUES ('20260715000000')
      `);
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        DELETE FROM supabase_migrations.schema_migrations
        WHERE version = '20260715000000'
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when an external trigger drifts", async () => {
    const db = await createFencedDatabase();
    try {
      await db.exec(`
        CREATE TABLE auth.finalizer_drift_source (id bigint);
        CREATE FUNCTION public.finalizer_external_trigger()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RETURN NEW;
        END
        $$
      `);
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        CREATE TRIGGER finalizer_external_trigger
        BEFORE INSERT ON auth.finalizer_drift_source
        FOR EACH ROW EXECUTE FUNCTION public.finalizer_external_trigger()
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when an event trigger drifts", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        CREATE EVENT TRIGGER finalizer_drift_event
        ON ddl_command_end
        EXECUTE FUNCTION public.production_write_fence_attach_20260717()
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when the public schema ACL drifts", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec("GRANT CREATE ON SCHEMA public TO authenticated");
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("changes the live schema contract when public default privileges drift", async () => {
    const db = await createFencedDatabase();
    try {
      const before = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      await db.exec(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT ON TABLES TO authenticated
      `);
      const after = (await db.query(`
        SELECT public.production_live_schema_contract_20260717() AS sha256
      `)).rows[0] as { sha256: string };
      expect(after.sha256).not.toBe(before.sha256);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("removes only the exact deployment-canary owner's complete fence in one transaction", async () => {
    const db = await createFencedDatabase();
    try {
      await db.exec(await renderFinalizerFor(db));

      expect((await db.query(`
        SELECT
          to_regclass('public.production_release_lease_20260717') AS lease,
          to_regprocedure('public.production_write_fence_guard_20260717()') AS guard,
          to_regprocedure('public.production_write_fence_attach_20260717()') AS attach,
          to_regprocedure('public.production_live_schema_contract_20260717()') AS schema_contract,
          public.production_storage_writes_allowed() AS storage_allowed
      `)).rows[0]).toEqual({
        lease: null,
        guard: null,
        attach: null,
        schema_contract: null,
        storage_allowed: true,
      });
      expect((await db.query(`
        SELECT count(*)::integer AS count
        FROM pg_trigger
        WHERE tgname = 'trg_production_write_fence_20260717'
      `)).rows[0]).toEqual({ count: 0 });

      await db.exec(`
        SELECT set_config(
          'request.jwt.claims',
          json_build_object('role', 'authenticated')::text,
          false
        );
        SET ROLE authenticated;
        INSERT INTO public.fence_probe VALUES ('after-finalize');
      `);
      expect((await db.query("SELECT value FROM public.fence_probe")).rows)
        .toEqual([{ value: "after-finalize" }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it.each([
    ["foreign owner", { __HB_FINALIZER_LEASE_OWNER_UUID__: "87654321-4321-4321-8321-cba987654321" }],
    ["foreign release", { __HB_FINALIZER_RELEASE_ID__: "other-release" }],
    ["foreign commit", { __HB_FINALIZER_RELEASE_COMMIT__: "9".repeat(40) }],
    ["foreign outcome path", { __HB_FINALIZER_OUTCOME_PATH_SHA256__: "8".repeat(64) }],
  ])("rejects %s without deleting the lease", async (_label, overrides) => {
    const db = await createFencedDatabase();
    try {
      await expect(db.exec(await renderFinalizerFor(db, overrides))).rejects.toThrow(
        /PRODUCTION_WRITE_FENCE_FINALIZER_PRECONDITION_FAILED/
      );
      await db.exec("ROLLBACK").catch(() => undefined);
      await expectFenceIntact(db);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a non-canary lease phase and stale evidence", async () => {
    const phaseDb = await createFencedDatabase("awaiting-post-push");
    try {
      await expect(phaseDb.exec(await renderFinalizerFor(phaseDb))).rejects.toThrow(
        /PRODUCTION_WRITE_FENCE_FINALIZER_PRECONDITION_FAILED/
      );
      await phaseDb.exec("ROLLBACK").catch(() => undefined);
      await expectFenceIntact(phaseDb);
    } finally {
      await phaseDb.close();
    }

    const staleDb = await createFencedDatabase();
    try {
      const verifiedAt = new Date(Date.now() - 20 * 60_000);
      await expect(staleDb.exec(await renderFinalizerFor(staleDb, {
        __HB_FINALIZER_CANARY_VERIFIED_AT__: verifiedAt.toISOString(),
        __HB_FINALIZER_CANARY_EXPIRES_AT__: new Date(
          verifiedAt.getTime() + 15 * 60_000
        ).toISOString(),
      }))).rejects.toThrow(/PRODUCTION_WRITE_FENCE_FINALIZER_EVIDENCE_STALE/);
      await staleDb.exec("ROLLBACK").catch(() => undefined);
      await expectFenceIntact(staleDb);
    } finally {
      await staleDb.close();
    }
  }, 30_000);

  it("fails closed on extra trigger, event-trigger or function artifacts", async () => {
    for (const drift of ["trigger", "event", "function"] as const) {
      const db = await createFencedDatabase();
      try {
        if (drift === "trigger") {
          await db.exec(`
            CREATE SCHEMA adversary;
            CREATE TABLE adversary.probe (value text);
            CREATE TRIGGER trg_production_write_fence_20260717
              BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
              ON adversary.probe
              FOR EACH STATEMENT
              EXECUTE FUNCTION public.production_write_fence_guard_20260717();
          `);
        } else if (drift === "event") {
          await db.exec(`
            CREATE EVENT TRIGGER evt_production_write_fence_extra_20260717
              ON ddl_command_end
              EXECUTE FUNCTION public.production_write_fence_attach_20260717();
          `);
        } else {
          await db.exec(`
            CREATE FUNCTION public.production_write_fence_guard_20260717(integer)
            RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
          `);
        }
        await expect(db.exec(await renderFinalizerFor(db))).rejects.toThrow(
          /PRODUCTION_WRITE_FENCE_FINALIZER_(LIVE_SCHEMA_CONTRACT_MISMATCH|PRECONDITION_FAILED)/
        );
        await db.exec("ROLLBACK").catch(() => undefined);
        await expectFenceIntact(db);
      } finally {
        await db.close();
      }
    }
  }, 30_000);

  it.each(["missing-ledger", "extra-ledger", "missing-table"] as const)(
    "rejects %s post-expand live-contract drift before consuming the lease",
    async (drift) => {
      const db = await createFencedDatabase();
      try {
        if (drift === "missing-ledger") {
          await db.exec(`
            DELETE FROM supabase_migrations.schema_migrations
            WHERE version = '20260716117000'
          `);
        } else if (drift === "extra-ledger") {
          await db.exec(`
            INSERT INTO supabase_migrations.schema_migrations (version)
            VALUES ('20260716118000')
          `);
        } else {
          await db.exec(`
            ALTER TABLE public.wedding_journeys
            RENAME TO wedding_journeys_drifted
          `);
        }

        await expect(db.exec(await renderFinalizerFor(db))).rejects.toThrow(
          /PRODUCTION_WRITE_FENCE_FINALIZER_LIVE_SCHEMA_CONTRACT_MISMATCH/
        );
        await db.exec("ROLLBACK").catch(() => undefined);
        expect((await db.query(`
          SELECT count(*)::integer AS count
          FROM public.production_release_lease_20260717
        `)).rows[0]).toEqual({ count: 1 });
        expect((await db.query(`
          SELECT public.production_storage_writes_allowed() AS allowed
        `)).rows[0]).toEqual({ allowed: false });
      } finally {
        await db.close();
      }
    },
    30_000
  );

  it.each([
    ["column default", `ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT 7`],
    ["RLS posture", `ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY`],
    ["constraint", `ALTER TABLE public.chat_messages ADD CONSTRAINT drift_id_nonnegative CHECK (id >= 0)`],
    ["policy", `CREATE POLICY drift_policy ON public.vendor_reviews FOR SELECT USING (true)`],
    ["RPC", `CREATE FUNCTION public.drift_rpc() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$`],
    ["trigger", `
      CREATE FUNCTION public.drift_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NEW; END
      $$;
      CREATE TRIGGER drift_trigger BEFORE UPDATE ON public.decision_nodes
      FOR EACH ROW EXECUTE FUNCTION public.drift_trigger()
    `],
    ["ACL", `GRANT SELECT ON public.wedding_journeys TO authenticated`],
    ["index", `CREATE INDEX drift_profiles_id_idx ON public.profiles (id)`],
  ] as const)(
    "rejects %s schema drift against the authenticated backup digest",
    async (_label, driftSql) => {
      const db = await createFencedDatabase();
      try {
        await db.exec(driftSql);
        await expect(db.exec(await renderFinalizerFor(db))).rejects.toThrow(
          /PRODUCTION_WRITE_FENCE_FINALIZER_LIVE_SCHEMA_CONTRACT_MISMATCH/
        );
        await db.exec("ROLLBACK").catch(() => undefined);
        await expectFenceIntact(db);
      } finally {
        await db.close();
      }
    },
    30_000
  );

  it("rolls every removal back when the live Storage helper cannot open", async () => {
    const db = await createFencedDatabase();
    try {
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.production_storage_writes_allowed()
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
        AS $$ SELECT false $$;
      `);
      const currentContract = (await db.query(`
        SELECT pg_catalog.upper(
          public.production_live_schema_contract_20260717()
        ) AS sha256
      `)).rows[0] as { sha256: string };
      await expect(db.exec(await renderFinalizerFor(db, {
        __HB_FINALIZER_POST_EXPAND_LIVE_SCHEMA_CONTRACT_SHA256__:
          currentContract.sha256,
      }))).rejects.toThrow(
        /PRODUCTION_WRITE_FENCE_FINALIZER_POSTCONDITION_FAILED/
      );
      await db.exec("ROLLBACK").catch(() => undefined);
      await expectFenceIntact(db);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects replay after the exact lease and artifacts were consumed", async () => {
    const db = await createFencedDatabase();
    try {
      const sql = await renderFinalizerFor(db);
      await db.exec(sql);
      await expect(db.exec(sql)).rejects.toThrow();
      await db.exec("ROLLBACK").catch(() => undefined);
      expect((await db.query(`
        SELECT public.production_storage_writes_allowed() AS allowed
      `)).rows[0]).toEqual({ allowed: true });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("pins every temporary function body and has no direct-run escape", () => {
    for (const functionName of ["guard", "attach"]) {
      const match = applySql.match(new RegExp(
        `CREATE FUNCTION public\\.production_write_fence_${functionName}_20260717\\(\\)[\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`
      ));
      expect(match).not.toBeNull();
      const md5 = createHash("md5")
        .update(match?.[1] ?? "", "utf8")
        .digest("hex");
      expect(finalizerTemplate).toContain(md5);
    }
    const schemaMatch = applySql.match(
      /CREATE FUNCTION public\.production_live_schema_contract_20260717\(\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/
    );
    expect(schemaMatch).not.toBeNull();
    expect(finalizerTemplate).toContain(
      createHash("md5").update(schemaMatch?.[1] ?? "", "utf8").digest("hex")
    );
    expect(finalizerTemplate).toMatch(/^BEGIN;/);
    expect(finalizerTemplate).toMatch(/COMMIT;\s*$/);
    expect(finalizerTemplate).toContain("phase = 'deployment-canary'");
    expect(finalizerTemplate).toContain("canary_expires_at <= statement_timestamp()");
    expect(finalizerTemplate).toContain("GET DIAGNOSTICS removed_lease_count = ROW_COUNT");
    expect(finalizerTemplate).toContain("named_function_count <> 3");
    expect(finalizerTemplate).toContain("all_named_trigger_count <> public_table_count");
    expect(finalizerTemplate).toContain("attach_event_trigger_count <> 2");
    expect(applySql).toContain("ON ddl_command_start");
    expect(applySql).toContain("TG_EVENT = 'ddl_command_start'");
    expect(applySql).toContain("pg_advisory_xact_lock_shared(7523370826071712::bigint)");
    expect(finalizerTemplate).toContain("pg_advisory_xact_lock(7523370826071712::bigint)");
    expect(finalizerTemplate).toContain("post_expand_live_schema_contract_sha256");
    expect(finalizerTemplate).toContain("post_expand_logical_data_contract_sha256");
  });
});
