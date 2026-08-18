// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260818180000_amora_decision_node_updated_at_clock.sql",
);
const migrationSql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $function$;

    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY,
      source text,
      decision_type text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      user_confirmed_at timestamptz,
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_actions (
      id uuid PRIMARY KEY,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TRIGGER set_decision_nodes_updated_at
      BEFORE UPDATE ON public.decision_nodes
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    CREATE TRIGGER set_amora_actions_updated_at
      BEFORE UPDATE ON public.amora_actions
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    INSERT INTO public.decision_nodes(id, source, decision_type, metadata)
    VALUES (
      '10000000-0000-4000-8000-000000000001',
      'vendor_booking',
      'completed',
      '{"hook":"booking_outcome"}'::jsonb
    );
  `);
  return db;
}

async function updateDecisionInsideDelayedTransaction(db: PGlite) {
  await db.exec("BEGIN");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  await db.exec(`
    UPDATE public.decision_nodes
    SET user_confirmed_at = clock_timestamp(),
        decided_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = '10000000-0000-4000-8000-000000000001'
  `);
  const timestamps = await db.query<{
    confirmed_at: number;
    decided_at: number;
    updated_at: number;
  }>(`
    SELECT
      extract(epoch FROM user_confirmed_at)::double precision AS confirmed_at,
      extract(epoch FROM decided_at)::double precision AS decided_at,
      extract(epoch FROM updated_at)::double precision AS updated_at
    FROM public.decision_nodes
    WHERE id = '10000000-0000-4000-8000-000000000001'
  `);
  await db.exec("ROLLBACK");
  return timestamps.rows[0];
}

describe("Amora decision-node updated-at clock successor", () => {
  it("keeps an outcome decision update at or after its decision time", async () => {
    const db = await createDatabase();
    try {
      const predecessorState = await updateDecisionInsideDelayedTransaction(db);
      expect(predecessorState?.updated_at).toBeLessThan(
        predecessorState?.decided_at ?? 0,
      );

      if (migrationSql) await db.exec(migrationSql);

      const repairedState = await updateDecisionInsideDelayedTransaction(db);
      expect(repairedState?.confirmed_at).toBeLessThanOrEqual(
        repairedState?.decided_at ?? 0,
      );
      expect(repairedState?.decided_at).toBeLessThanOrEqual(
        repairedState?.updated_at ?? 0,
      );
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  });

  it("retains transaction-start updated-at semantics for an ordinary memory decision", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migrationSql);
      await db.exec(`
        INSERT INTO public.decision_nodes(
          id, source, decision_type, metadata
        ) VALUES (
          '10000000-0000-4000-8000-000000000002',
          'chat',
          'exploring',
          '{"hook":"memory_v2"}'::jsonb
        )
      `);

      await db.exec("BEGIN");
      const started = await db.query<{ started_at: number }>(`
        SELECT extract(epoch FROM now())::double precision AS started_at
      `);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
      await db.exec(`
        UPDATE public.decision_nodes
        SET updated_at = clock_timestamp()
        WHERE id = '10000000-0000-4000-8000-000000000002'
      `);
      const saved = await db.query<{
        updated_at: number;
        observed_at: number;
      }>(`
        SELECT
          extract(epoch FROM updated_at)::double precision AS updated_at,
          extract(epoch FROM clock_timestamp())::double precision AS observed_at
        FROM public.decision_nodes
        WHERE id = '10000000-0000-4000-8000-000000000002'
      `);

      expect(saved.rows[0]?.updated_at).toBe(started.rows[0]?.started_at);
      expect(saved.rows[0]?.updated_at).toBeLessThan(
        saved.rows[0]?.observed_at ?? 0,
      );
      await db.exec("ROLLBACK");
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  });

  it("isolates the clock trigger without widening ACLs or changing the shared trigger", async () => {
    const db = await createDatabase();
    try {
      const before = await db.query<{ definition: string }>(`
        SELECT pg_catalog.pg_get_functiondef(
          'public.update_updated_at_column()'::regprocedure
        ) AS definition
      `);

      await db.exec(migrationSql);
      await db.exec(migrationSql);

      const contract = await db.query<{
        owner: string;
        security_definer: boolean;
        config: string[] | null;
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
        decision_trigger_count: number;
        shared_trigger_count: number;
        shared_definition: string;
        definition: string;
      }>(`
        SELECT
          procedure.proowner::regrole::text AS owner,
          procedure.prosecdef AS security_definer,
          procedure.proconfig AS config,
          pg_catalog.has_function_privilege(
            'anon', procedure.oid, 'EXECUTE'
          ) AS anon_execute,
          pg_catalog.has_function_privilege(
            'authenticated', procedure.oid, 'EXECUTE'
          ) AS authenticated_execute,
          pg_catalog.has_function_privilege(
            'service_role', procedure.oid, 'EXECUTE'
          ) AS service_execute,
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger
            WHERE trigger.tgrelid = 'public.decision_nodes'::regclass
              AND trigger.tgname = 'set_decision_nodes_updated_at'
              AND trigger.tgfoid = procedure.oid
              AND trigger.tgenabled = 'O'
              AND trigger.tgtype = 19
              AND NOT trigger.tgisinternal
          ) AS decision_trigger_count,
          (
            SELECT count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger
            WHERE trigger.tgrelid = 'public.amora_actions'::regclass
              AND trigger.tgname = 'set_amora_actions_updated_at'
              AND trigger.tgfoid =
                'public.update_updated_at_column()'::regprocedure
              AND trigger.tgenabled = 'O'
              AND trigger.tgtype = 19
              AND NOT trigger.tgisinternal
          ) AS shared_trigger_count,
          pg_catalog.pg_get_functiondef(
            'public.update_updated_at_column()'::regprocedure
          ) AS shared_definition,
          pg_catalog.pg_get_functiondef(procedure.oid) AS definition
        FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid =
          'public.set_decision_nodes_updated_at()'::regprocedure
      `);

      expect(contract.rows[0]).toMatchObject({
        owner: "postgres",
        security_definer: false,
        config: ["search_path=pg_catalog"],
        anon_execute: false,
        authenticated_execute: false,
        service_execute: false,
        decision_trigger_count: 1,
        shared_trigger_count: 1,
        shared_definition: before.rows[0]?.definition,
      });
      expect(contract.rows[0]?.definition).toContain(
        "NEW.updated_at := pg_catalog.clock_timestamp()",
      );
      expect(contract.rows[0]?.definition).toContain(
        "NEW.updated_at := pg_catalog.now()",
      );
    } finally {
      await db.close();
    }
  });

  it("fails closed when the audited decision trigger has been rebound", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.test_untrusted_updated_at()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        BEGIN
          RETURN NEW;
        END;
        $function$;
        DROP TRIGGER set_decision_nodes_updated_at ON public.decision_nodes;
        CREATE TRIGGER set_decision_nodes_updated_at
          BEFORE UPDATE ON public.decision_nodes
          FOR EACH ROW EXECUTE FUNCTION public.test_untrusted_updated_at();
      `);

      await expect(db.exec(migrationSql)).rejects.toThrow(
        /AMORA_DECISION_NODE_UPDATED_AT_PREREQUISITE_MISSING/,
      );
      await db.exec("ROLLBACK");

      const binding = await db.query<{ function_name: string }>(`
        SELECT trigger.tgfoid::regprocedure::text AS function_name
        FROM pg_catalog.pg_trigger AS trigger
        WHERE trigger.tgrelid = 'public.decision_nodes'::regclass
          AND trigger.tgname = 'set_decision_nodes_updated_at'
          AND NOT trigger.tgisinternal
      `);
      expect(binding.rows).toEqual([
        { function_name: "test_untrusted_updated_at()" },
      ]);
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  });
});
