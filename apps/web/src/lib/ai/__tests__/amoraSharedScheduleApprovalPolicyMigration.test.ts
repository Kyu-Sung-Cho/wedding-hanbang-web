import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802110000_amora_shared_schedule_approval_policy.sql",
);

describe("shared schedule approval policy migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
    `);
    await db.exec(await readFile(migrationPath, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("keeps only confirmed-fact additions single and fails ambiguity toward couple approval", async () => {
    const result = await db.query<{
      confirmed_fact: string;
      missing_scope: string;
      shared_commitment: string;
      external_commitment: string;
      unknown_scope: string;
      update_fact: string;
    }>(`
      SELECT
        public.amora_shared_action_policy(
          'add_schedule_event', '{"schedule_scope":"confirmed_fact"}'::jsonb
        ) AS confirmed_fact,
        public.amora_shared_action_policy(
          'add_schedule_event', '{}'::jsonb
        ) AS missing_scope,
        public.amora_shared_action_policy(
          'add_schedule_event', '{"schedule_scope":"shared_commitment"}'::jsonb
        ) AS shared_commitment,
        public.amora_shared_action_policy(
          'add_schedule_event', '{"schedule_scope":"external_commitment"}'::jsonb
        ) AS external_commitment,
        public.amora_shared_action_policy(
          'add_schedule_event', '{"schedule_scope":"future_value"}'::jsonb
        ) AS unknown_scope,
        public.amora_shared_action_policy(
          'update_schedule_event', '{"schedule_scope":"confirmed_fact"}'::jsonb
        ) AS update_fact
    `);

    expect(result.rows[0]).toEqual({
      confirmed_fact: "single",
      missing_scope: "couple",
      shared_commitment: "couple",
      external_commitment: "couple",
      unknown_scope: "couple",
      update_fact: "couple",
    });
  });

  it("preserves existing blocked and non-schedule classifications", async () => {
    const result = await db.query<{
      budget: string;
      spent: string;
      delete_schedule: string;
      malformed: string;
    }>(`
      SELECT
        public.amora_shared_action_policy(
          'update_budget', '{"total_budget":1000000}'::jsonb
        ) AS budget,
        public.amora_shared_action_policy(
          'update_category_budget', '{"spent":100000}'::jsonb
        ) AS spent,
        public.amora_shared_action_policy(
          'delete_schedule_event', '{"event_id":"evt"}'::jsonb
        ) AS delete_schedule,
        public.amora_shared_action_policy(
          'add_schedule_event', '[]'::jsonb
        ) AS malformed
    `);

    expect(result.rows[0]).toEqual({
      budget: "couple",
      spent: "single",
      delete_schedule: "blocked",
      malformed: "blocked",
    });
  });

  it("keeps policy execution service-role only", async () => {
    await db.exec("SET ROLE authenticated");
    await expect(db.query(
      "SELECT public.amora_shared_action_policy('add_schedule_event', '{}'::jsonb)",
    )).rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE");

    await db.exec("SET ROLE service_role");
    await expect(db.query(
      "SELECT public.amora_shared_action_policy('add_schedule_event', '{}'::jsonb)",
    )).resolves.toBeDefined();
  });
});
