// @vitest-environment node

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const operationRoot = resolve(
  repoRoot,
  "supabase/platform-operations/security"
);
const releasePreCheck = readFileSync(
  resolve(
    repoRoot,
    "supabase/release-checks/amora-engine-v2-production-write-fence-pre.sql"
  ),
  "utf8"
);

function readOperation(suffix: string): string {
  return readFileSync(
    resolve(operationRoot, `20260717120000_production_write_fence_${suffix}.sql`),
    "utf8"
  );
}

async function resetJwt(db: PGlite): Promise<void> {
  await db.exec(`
    RESET ROLE;
    SELECT set_config('request.jwt.claims', '', false);
    SELECT set_config('request.jwt.claim.role', '', false);
  `);
}

async function assumeApiRole(db: PGlite, role: string): Promise<void> {
  await resetJwt(db);
  await db.exec(`
    SELECT set_config(
      'request.jwt.claims',
      json_build_object('role', '${role}')::text,
      false
    );
    SET ROLE ${role};
  `);
}

describe("temporary production write fence", () => {
  it("blocks every API JWT role and service-role RPC while allowing JWT-less postgres migrations", async () => {
    const db = await PGlite.create();
    try {
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
        CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
        CREATE TABLE public.fence_probe (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          value text NOT NULL
        );
        GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE
          ON public.fence_probe TO anon, authenticated, service_role;
        GRANT USAGE, SELECT ON SEQUENCE public.fence_probe_id_seq
          TO anon, authenticated, service_role;
      `);

      await db.exec(readOperation("apply"));
      await expect(db.exec(readOperation("verify"))).resolves.toBeDefined();
      await expect(db.exec(releasePreCheck)).resolves.toBeDefined();

      await expect(
        db.exec("INSERT INTO public.fence_probe(value) VALUES ('migration');")
      ).resolves.toBeDefined();

      for (const role of ["anon", "authenticated", "service_role"]) {
        await assumeApiRole(db, role);
        await expect(
          db.exec(`INSERT INTO public.fence_probe(value) VALUES ('${role}');`)
        ).rejects.toThrow(/PRODUCTION_WRITE_FENCE_ENABLED/);
      }

      await assumeApiRole(db, "authenticated");
      await expect(
        db.exec("UPDATE public.fence_probe SET value = 'changed';")
      ).rejects.toThrow(/PRODUCTION_WRITE_FENCE_ENABLED/);
      await expect(
        db.exec("DELETE FROM public.fence_probe;")
      ).rejects.toThrow(/PRODUCTION_WRITE_FENCE_ENABLED/);
      await expect(
        db.exec("TRUNCATE public.fence_probe;")
      ).rejects.toThrow(/PRODUCTION_WRITE_FENCE_ENABLED/);

      await resetJwt(db);
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.fence_probe_owner_write()
        RETURNS void
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = pg_catalog, public
        AS $$ INSERT INTO public.fence_probe(value) VALUES ('owner-rpc') $$;
        REVOKE ALL ON FUNCTION public.fence_probe_owner_write() FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION public.fence_probe_owner_write() TO service_role;
      `);
      await assumeApiRole(db, "service_role");
      await expect(
        db.query("SELECT public.fence_probe_owner_write()")
      ).rejects.toThrow(/PRODUCTION_WRITE_FENCE_ENABLED/);

      await resetJwt(db);
      await db.exec(`
        CREATE TABLE public.created_during_release (value text NOT NULL);
        GRANT INSERT ON public.created_during_release TO authenticated;
      `);
      await assumeApiRole(db, "authenticated");
      await expect(
        db.exec("INSERT INTO public.created_during_release VALUES ('client');")
      ).rejects.toThrow(/PRODUCTION_WRITE_FENCE_ENABLED/);

      await resetJwt(db);
      const rows = await db.query<{ value: string }>(
        "SELECT value FROM public.fence_probe ORDER BY id"
      );
      expect(rows.rows).toEqual([{ value: "migration" }]);
    } finally {
      await resetJwt(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("releases the exact temporary objects only through the paired rollback", async () => {
    const db = await PGlite.create();
    try {
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
        CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
        CREATE TABLE public.fence_probe (value text NOT NULL);
        GRANT INSERT ON public.fence_probe TO authenticated;
      `);
      await db.exec(readOperation("apply"));
      await db.exec(readOperation("rollback"));

      await assumeApiRole(db, "authenticated");
      await expect(
        db.exec("INSERT INTO public.fence_probe VALUES ('after-release');")
      ).resolves.toBeDefined();
    } finally {
      await resetJwt(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("refuses to open a postgres cron bypass while a database job is active", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.role() RETURNS text
        LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
        CREATE SCHEMA cron;
        CREATE TABLE cron.job (active boolean NOT NULL);
        INSERT INTO cron.job VALUES (true);
        CREATE TABLE public.fence_probe (value text NOT NULL);
      `);

      await expect(db.exec(readOperation("apply"))).rejects.toThrow(
        /PRODUCTION_WRITE_FENCE_ACTIVE_DATABASE_CRON/
      );
      await db.exec("ROLLBACK").catch(() => undefined);

      const objects = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM pg_proc
        WHERE oid = to_regprocedure('public.production_write_fence_guard_20260717()')
      `);
      expect(objects.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("refuses to release the fence after cron or ACL drift", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.role() RETURNS text
        LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
        CREATE SCHEMA cron;
        CREATE TABLE cron.job (active boolean NOT NULL);
        CREATE TABLE public.fence_probe (value text NOT NULL);
      `);
      await db.exec(readOperation("apply"));

      await db.exec("INSERT INTO cron.job VALUES (true);");
      await expect(db.exec(readOperation("rollback"))).rejects.toThrow(
        /PRODUCTION_WRITE_FENCE_ROLLBACK_PRECONDITION_FAILED/
      );
      await db.exec("ROLLBACK").catch(() => undefined);
      expect((await db.query(`
        SELECT count(*)::integer AS count
        FROM pg_trigger
        WHERE tgname = 'trg_production_write_fence_20260717'
      `)).rows[0]).toEqual({ count: 2 });

      await db.exec("UPDATE cron.job SET active = false;");
      await db.exec(`
        GRANT EXECUTE ON FUNCTION public.production_write_fence_guard_20260717()
          TO authenticated;
      `);
      await expect(db.exec(readOperation("rollback"))).rejects.toThrow(
        /PRODUCTION_WRITE_FENCE_ROLLBACK_PRECONDITION_FAILED/
      );
      await db.exec("ROLLBACK").catch(() => undefined);
      expect((await db.query(`
        SELECT count(*)::integer AS count
        FROM pg_trigger
        WHERE tgname = 'trg_production_write_fence_20260717'
      `)).rows[0]).toEqual({ count: 2 });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("refuses paired rollback while a remote production release lease is active", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.role() RETURNS text
        LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
        CREATE TABLE public.fence_probe (value text NOT NULL);
      `);
      await db.exec(readOperation("apply"));
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
          'test-release',
          '${"a".repeat(40)}',
          '12345678-1234-4234-8234-123456789abc',
          '${"b".repeat(64)}',
          'claimed'
        );
      `);

      await expect(db.exec(readOperation("rollback"))).rejects.toThrow(
        /PRODUCTION_WRITE_FENCE_ROLLBACK_PRECONDITION_FAILED/
      );
      await db.exec("ROLLBACK").catch(() => undefined);
      expect((await db.query(`
        SELECT count(*)::integer AS count
        FROM public.production_release_lease_20260717
      `)).rows[0]).toEqual({ count: 1 });

      await db.exec("DELETE FROM public.production_release_lease_20260717;");
      await db.exec(readOperation("rollback"));
      expect((await db.query(`
        SELECT to_regclass('public.production_release_lease_20260717') AS lease
      `)).rows[0]).toEqual({ lease: null });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps inventory and verification read-only and pins the trigger contract", () => {
    const inventory = readOperation("inventory");
    const verify = readOperation("verify");
    const apply = readOperation("apply");
    const rollback = readOperation("rollback");

    for (const sql of [inventory, verify]) {
      expect(sql).toMatch(/^BEGIN TRANSACTION READ ONLY;/);
      expect(sql).toMatch(/ROLLBACK;\s*$/);
      expect(sql).not.toMatch(
        /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/im
      );
    }
    expect(apply).toContain("trg_production_write_fence_20260717");
    expect(apply).toContain("evt_production_write_fence_20260717");
    expect(apply).toContain("evt_production_write_fence_ddl_lock_20260717");
    expect(apply).toContain("ON ddl_command_start");
    expect(apply).toContain("production_release_lease_20260717");
    expect(apply).toMatch(/tgtype\s*=\s*62/i);
    expect(verify).toMatch(/tgtype\s*=\s*62/i);
    for (const functionName of ["guard", "attach"]) {
      const match = apply.match(new RegExp(
        `CREATE FUNCTION public\\.production_write_fence_${functionName}_20260717\\(\\)[\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`
      ));
      expect(match, `${functionName} body must be extractable`).not.toBeNull();
      const bodyMd5 = createHash("md5").update(match?.[1] ?? "", "utf8").digest("hex");
      expect(verify).toContain(bodyMd5);
      expect(rollback).toContain(bodyMd5);
    }
    const schemaMatch = apply.match(
      /CREATE FUNCTION public\.production_live_schema_contract_20260717\(\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/
    );
    expect(schemaMatch, "live schema contract body must be extractable").not.toBeNull();
    const schemaBodyMd5 = createHash("md5")
      .update(schemaMatch?.[1] ?? "", "utf8")
      .digest("hex");
    expect(verify).toContain(schemaBodyMd5);
    expect(rollback).toContain(schemaBodyMd5);
    expect(rollback).toContain("PRODUCTION_WRITE_FENCE_ROLLBACK_PRECONDITION_FAILED");
    expect(rollback).toMatch(/production_release_lease_20260717[\s\S]*?count\(\*\)[\s\S]*?<> 0/i);
    expect(rollback).toMatch(/cron\.job WHERE active/i);
    expect(rollback).toContain("has_function_privilege");
    expect(rollback).toContain("pg_get_userbyid");
  });
});
