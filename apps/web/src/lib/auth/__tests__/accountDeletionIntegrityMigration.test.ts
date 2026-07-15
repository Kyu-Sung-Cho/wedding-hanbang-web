// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714164700_expand_account_deletion_integrity.sql"
  ),
  "utf8"
);

const SOLO_USER = "00000000-0000-4000-8000-000000000001";
const DEPARTING_PARTNER = "00000000-0000-4000-8000-000000000002";
const REMAINING_PARTNER = "00000000-0000-4000-8000-000000000003";
const SOLO_COUPLE = "10000000-0000-4000-8000-000000000001";
const PARTNERED_COUPLE = "10000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      groom_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL
    );
    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY,
      user_id uuid,
      summary text
    );
    CREATE TABLE public.customer_events (
      id uuid PRIMARY KEY,
      user_id uuid,
      couple_id uuid,
      CONSTRAINT customer_events_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id),
      CONSTRAINT customer_events_couple_id_fkey
        FOREIGN KEY (couple_id) REFERENCES public.couples(id)
    );
    CREATE TABLE public.customer_insights (
      id uuid PRIMARY KEY,
      couple_id uuid,
      CONSTRAINT customer_insights_couple_id_fkey
        FOREIGN KEY (couple_id) REFERENCES public.couples(id)
    );
    CREATE TABLE public.search_logs (
      id uuid PRIMARY KEY,
      user_id uuid,
      query text NOT NULL,
      CONSTRAINT search_logs_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id)
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE
    );

    INSERT INTO auth.users (id) VALUES
      ('${SOLO_USER}'),
      ('${DEPARTING_PARTNER}'),
      ('${REMAINING_PARTNER}');
    INSERT INTO public.couples (id, bride_id, groom_id) VALUES
      ('${SOLO_COUPLE}', '${SOLO_USER}', NULL),
      ('${PARTNERED_COUPLE}', '${DEPARTING_PARTNER}', '${REMAINING_PARTNER}');
    INSERT INTO public.profiles (id, couple_id) VALUES
      ('${SOLO_USER}', '${SOLO_COUPLE}'),
      ('${DEPARTING_PARTNER}', '${PARTNERED_COUPLE}'),
      ('${REMAINING_PARTNER}', '${PARTNERED_COUPLE}');
    INSERT INTO public.chat_summaries (id, user_id, summary) VALUES
      ('20000000-0000-4000-8000-000000000001', '${SOLO_USER}', 'private'),
      ('20000000-0000-4000-8000-000000000002', '${DEPARTING_PARTNER}', 'private');
    INSERT INTO public.customer_events (id, user_id, couple_id)
    VALUES ('30000000-0000-4000-8000-000000000001', '${SOLO_USER}', '${SOLO_COUPLE}');
    INSERT INTO public.customer_insights (id, couple_id)
    VALUES ('30000000-0000-4000-8000-000000000002', '${SOLO_COUPLE}');
    INSERT INTO public.search_logs (id, user_id, query)
    VALUES ('40000000-0000-4000-8000-000000000001', '${SOLO_USER}', 'dress');
    INSERT INTO public.wedding_journeys (id, couple_id)
    VALUES ('50000000-0000-4000-8000-000000000001', '${SOLO_COUPLE}');
  `);
  await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  return db;
}

describe("account deletion integrity migration", () => {
  it("atomically removes personal derivatives and anonymizes tracking data", async () => {
    const db = await createDatabase();
    try {
      await db.query("DELETE FROM auth.users WHERE id = $1", [SOLO_USER]);

      const counts = await db.query<{
        profiles: number;
        summaries: number;
        couples: number;
        journeys: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM public.profiles WHERE id = '${SOLO_USER}') AS profiles,
          (SELECT count(*)::int FROM public.chat_summaries WHERE user_id = '${SOLO_USER}') AS summaries,
          (SELECT count(*)::int FROM public.couples WHERE id = '${SOLO_COUPLE}') AS couples,
          (SELECT count(*)::int FROM public.wedding_journeys WHERE couple_id = '${SOLO_COUPLE}') AS journeys
      `);
      const tracking = await db.query<{
        event_user: string | null;
        event_couple: string | null;
        insight_couple: string | null;
        search_user: string | null;
      }>(`
        SELECT
          (SELECT user_id FROM public.customer_events LIMIT 1) AS event_user,
          (SELECT couple_id FROM public.customer_events LIMIT 1) AS event_couple,
          (SELECT couple_id FROM public.customer_insights LIMIT 1) AS insight_couple,
          (SELECT user_id FROM public.search_logs LIMIT 1) AS search_user
      `);

      expect(counts.rows[0]).toEqual({ profiles: 0, summaries: 0, couples: 0, journeys: 0 });
      expect(tracking.rows[0]).toEqual({
        event_user: null,
        event_couple: null,
        insight_couple: null,
        search_user: null,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("retains the couple and the remaining partner when one partner deletes their account", async () => {
    const db = await createDatabase();
    try {
      await db.query("DELETE FROM auth.users WHERE id = $1", [DEPARTING_PARTNER]);

      const couple = await db.query<{ bride_id: string | null; groom_id: string | null }>(
        "SELECT bride_id, groom_id FROM public.couples WHERE id = $1",
        [PARTNERED_COUPLE]
      );
      const remainingProfile = await db.query<{ couple_id: string | null }>(
        "SELECT couple_id FROM public.profiles WHERE id = $1",
        [REMAINING_PARTNER]
      );

      expect(couple.rows[0]).toEqual({ bride_id: null, groom_id: REMAINING_PARTNER });
      expect(remainingProfile.rows[0]?.couple_id).toBe(PARTNERED_COUPLE);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("is safe to re-run", async () => {
    const db = await createDatabase();
    try {
      await expect(db.exec(`BEGIN;\n${migration}\nCOMMIT;`)).resolves.toBeDefined();
      const actions = await db.query<{ table_name: string; delete_action: string }>(`
        SELECT conrelid::regclass::text AS table_name, confdeltype::text AS delete_action
        FROM pg_constraint
        WHERE conname IN (
          'customer_events_user_id_fkey',
          'customer_events_couple_id_fkey',
          'customer_insights_couple_id_fkey',
          'search_logs_user_id_fkey',
          'chat_summaries_user_id_delete_cascade_fkey'
        )
        ORDER BY table_name
      `);
      expect(actions.rows).toEqual([
        { table_name: "chat_summaries", delete_action: "c" },
        { table_name: "customer_events", delete_action: "n" },
        { table_name: "customer_events", delete_action: "n" },
        { table_name: "customer_insights", delete_action: "n" },
        { table_name: "search_logs", delete_action: "n" },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);
});
