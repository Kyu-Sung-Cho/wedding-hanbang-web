// @vitest-environment node

import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802154000_close_residual_database_privilege_surfaces.sql",
  ),
  "utf8",
);

const MARKETPLACE_TABLES = [
  "vendor_products",
  "vendor_images",
  "vendor_timeslots",
  "product_timeslots",
  "vendor_staff",
  "staff_timeslots",
] as const;

const ANALYTICS_TABLES = [
  "customer_events",
  "search_logs",
  "vendor_daily_stats",
] as const;

const DORMANT_TABLES = [
  "fitting_requests",
  "fitting_usage",
  "user_fitting_photos",
  "invitations",
  "invitation_photos",
  "invitation_accounts",
  "invitation_rsvp",
  "invitation_guestbook",
  "invitation_visits",
  "ai_scripts",
  "customer_insights",
  "vendor_contract_templates",
  "contracts",
  "payments",
  "settlements",
] as const;

const SERVICE_ONLY_TABLES = [
  ...ANALYTICS_TABLES,
  ...DORMANT_TABLES,
] as const;

const COUNTER_TABLES = [
  "cohort_members",
  "guestbook_messages",
] as const;

const SERVER_WRITE_AUTH_READ_TABLES = [
  "profiles",
  "couples",
  "wedding_journeys",
  "decision_nodes",
  "cohort_timeline_events",
  "amora_saved_notes",
] as const;

const COUPLE_READ_SERVER_WRITE_TABLES = [
  ...SERVER_WRITE_AUTH_READ_TABLES,
  "decision_edges",
  "congratulatory_money",
] as const;

const INTENTIONAL_CLIENT_WRITE_TABLES = ["chat_messages"] as const;

const ALL_FIXTURE_TABLES = [
  ...MARKETPLACE_TABLES,
  ...SERVICE_ONLY_TABLES,
  ...COUNTER_TABLES,
] as const;

const ALL_CURRENT_TABLES = [
  ...ALL_FIXTURE_TABLES,
  ...COUPLE_READ_SERVER_WRITE_TABLES,
  ...INTENTIONAL_CLIENT_WRITE_TABLES,
] as const;

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated, service_role;

    CREATE FUNCTION public.is_vendor_public(uuid)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    AS 'SELECT true';
    REVOKE ALL ON FUNCTION public.is_vendor_public(uuid)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.is_vendor_public(uuid)
      TO anon, authenticated;

    CREATE FUNCTION public.create_couple_for_current_user(text)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    AS 'SELECT true';
    REVOKE ALL ON FUNCTION public.create_couple_for_current_user(text)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.create_couple_for_current_user(text)
      TO authenticated;

    CREATE FUNCTION public.is_couple_member(p_couple_id uuid)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    AS 'SELECT current_setting(''app.current_couple_id'', true) = p_couple_id::text';
    REVOKE ALL ON FUNCTION public.is_couple_member(uuid)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid)
      TO authenticated, service_role;

    CREATE FUNCTION public.check_rate_limit_cost(text, integer, integer, integer)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    AS 'SELECT true';
    REVOKE ALL ON FUNCTION public.check_rate_limit_cost(text, integer, integer, integer)
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.check_rate_limit_cost(text, integer, integer, integer)
      TO service_role;

    CREATE FUNCTION public.implicit_hosted_definer()
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    AS 'SELECT true';

    CREATE FUNCTION public.existing_invoker()
    RETURNS boolean
    LANGUAGE sql
    SECURITY INVOKER
    AS 'SELECT true';
  `);

  for (const table of ALL_FIXTURE_TABLES) {
    await db.exec(`
      CREATE TABLE public.${table} (
        id integer PRIMARY KEY,
        payload text NOT NULL DEFAULT 'private'
      );
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ${table}_legacy_all ON public.${table}
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
      CREATE POLICY ${table}_legacy_anon_select ON public.${table}
        FOR SELECT TO anon USING (true);
      CREATE POLICY ${table}_legacy_authenticated_select ON public.${table}
        FOR SELECT TO authenticated USING (true);
      GRANT ALL PRIVILEGES ON TABLE public.${table}
        TO anon, authenticated, service_role;
      GRANT INSERT (id, payload), UPDATE (payload)
        ON TABLE public.${table} TO anon, authenticated;
      INSERT INTO public.${table} (id, payload) VALUES (1, 'sentinel');
    `);
  }

  for (const table of MARKETPLACE_TABLES) {
    await db.exec(`
      REVOKE SELECT ON TABLE public.${table} FROM anon, authenticated;
      REVOKE SELECT (id, payload) ON TABLE public.${table}
        FROM anon, authenticated;
      GRANT SELECT (id) ON TABLE public.${table} TO anon, authenticated;
    `);
  }

  await db.exec(`
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      push_token text,
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profiles_legacy_update ON public.profiles
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY profiles_select_self ON public.profiles
      FOR SELECT TO authenticated USING (true);

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
    CREATE POLICY couples_legacy_all ON public.couples
      FOR ALL TO authenticated
      USING (public.is_couple_member(id))
      WITH CHECK (public.is_couple_member(id));
    CREATE POLICY couples_select_own ON public.couples
      FOR SELECT TO authenticated
      USING (public.is_couple_member(id));

    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.wedding_journeys ENABLE ROW LEVEL SECURITY;
    CREATE POLICY wedding_journeys_legacy_all ON public.wedding_journeys
      FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));
    CREATE POLICY journeys_select_couple ON public.wedding_journeys
      FOR SELECT TO authenticated
      USING (public.is_couple_member(couple_id));

    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.decision_nodes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY decision_nodes_legacy_all ON public.decision_nodes
      FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));
    CREATE POLICY decision_nodes_select_couple ON public.decision_nodes
      FOR SELECT TO authenticated
      USING (public.is_couple_member(couple_id));

    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid NOT NULL,
      sender_type text NOT NULL DEFAULT 'user',
      role text NOT NULL DEFAULT 'user',
      visibility text NOT NULL DEFAULT 'shared',
      content text NOT NULL DEFAULT 'message',
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY chat_messages_select_couple ON public.chat_messages
      FOR SELECT TO authenticated
      USING (public.is_couple_member(couple_id));
    CREATE POLICY chat_messages_insert_own_user ON public.chat_messages
      FOR INSERT TO authenticated
      WITH CHECK (public.is_couple_member(couple_id));

    CREATE TABLE public.amora_saved_notes (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      saved_by uuid NOT NULL,
      message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
      content text NOT NULL,
      memo text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.amora_saved_notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY amora_saved_notes_legacy_all ON public.amora_saved_notes
      FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));
    CREATE POLICY amora_saved_notes_select ON public.amora_saved_notes
      FOR SELECT TO authenticated
      USING (public.is_couple_member(couple_id));

    CREATE TABLE public.cohort_timeline_events (
      id uuid PRIMARY KEY,
      room_id uuid NOT NULL,
      user_id uuid NOT NULL,
      event_type text NOT NULL,
      description text,
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.cohort_timeline_events ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cohort_timeline_legacy_all
      ON public.cohort_timeline_events
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY cohort_timeline_select
      ON public.cohort_timeline_events
      FOR SELECT TO authenticated USING (true);

    CREATE TABLE public.decision_edges (
      id uuid PRIMARY KEY,
      couple_id uuid,
      from_node_id uuid REFERENCES public.decision_nodes(id),
      to_node_id uuid REFERENCES public.decision_nodes(id),
      relationship text,
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.decision_edges ENABLE ROW LEVEL SECURITY;
    CREATE POLICY decision_edges_legacy_all ON public.decision_edges
      FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));

    CREATE TABLE public.congratulatory_money (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      guest_name text NOT NULL,
      amount integer NOT NULL,
      payload text NOT NULL DEFAULT 'private'
    );
    ALTER TABLE public.congratulatory_money ENABLE ROW LEVEL SECURITY;
    CREATE POLICY congratulatory_money_legacy_all
      ON public.congratulatory_money
      FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));

    GRANT ALL PRIVILEGES ON TABLE
      public.profiles,
      public.couples,
      public.wedding_journeys,
      public.decision_nodes,
      public.cohort_timeline_events,
      public.decision_edges,
      public.congratulatory_money,
      public.amora_saved_notes
      TO anon, authenticated, service_role;
    REVOKE ALL PRIVILEGES ON TABLE public.chat_messages
      FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL PRIVILEGES (id, couple_id, sender_id, payload)
      ON TABLE public.chat_messages
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT ON TABLE public.chat_messages TO authenticated;
    GRANT INSERT (id, couple_id, sender_id, payload)
      ON TABLE public.chat_messages TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public.chat_messages TO service_role;

    INSERT INTO public.profiles (id, payload) VALUES
      ('10000000-0000-4000-8000-000000000041', 'sentinel');
    INSERT INTO public.couples (id, payload) VALUES
      ('10000000-0000-4000-8000-000000000001', 'sentinel'),
      ('20000000-0000-4000-8000-000000000001', 'other');
    INSERT INTO public.wedding_journeys (
      id, couple_id, progress, payload
    ) VALUES (
      '10000000-0000-4000-8000-000000000021',
      '10000000-0000-4000-8000-000000000001',
      '{"phase":"safe"}',
      'sentinel'
    );
    INSERT INTO public.decision_nodes (id, couple_id, payload) VALUES
      ('10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'sentinel'),
      ('10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'sentinel'),
      ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'other');
    INSERT INTO public.chat_messages (
      id, couple_id, sender_id, sender_type, role, visibility, content, payload
    ) VALUES
      (
        '10000000-0000-4000-8000-000000000031',
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000041',
        'ai',
        'assistant',
        'shared',
        'same-couple message',
        'sentinel'
      ),
      (
        '20000000-0000-4000-8000-000000000031',
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000041',
        'ai',
        'assistant',
        'shared',
        'other-couple message',
        'other'
      );
    INSERT INTO public.amora_saved_notes (
      id, couple_id, saved_by, message_id, content, payload
    ) VALUES (
      '50000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000042',
      '10000000-0000-4000-8000-000000000031',
      'partner saved note',
      'sentinel'
    );
    INSERT INTO public.cohort_timeline_events (
      id, room_id, user_id, event_type, description, payload
    ) VALUES (
      '10000000-0000-4000-8000-000000000051',
      '10000000-0000-4000-8000-000000000061',
      '10000000-0000-4000-8000-000000000041',
      'contract_done',
      'sentinel',
      'sentinel'
    );
    INSERT INTO public.decision_edges (
      id, couple_id, from_node_id, to_node_id, relationship, payload
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000011',
      '10000000-0000-4000-8000-000000000012',
      'depends_on',
      'sentinel'
    );
    INSERT INTO public.congratulatory_money (
      id, couple_id, guest_name, amount, payload
    ) VALUES (
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'Guest',
      100000,
      'sentinel'
    );
  `);

  await db.exec(`
    CREATE TABLE public.production_release_lease_20260717 (
      id integer PRIMARY KEY
    );
    REVOKE ALL PRIVILEGES ON TABLE public.production_release_lease_20260717
      FROM PUBLIC, anon, authenticated, service_role;
  `);

  return db;
}

function listRuntimeSources(root: string, excludeApi = true): string[] {
  const sources: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const normalized = path.replaceAll("\\", "/");
    if (
      normalized.includes("/__tests__/")
      || normalized.includes("/node_modules")
      || normalized.includes("/.next")
      || normalized.includes("/dist")
      || (excludeApi && normalized.includes("/app/api/"))
      || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry)
    ) {
      continue;
    }
    if (statSync(path).isDirectory()) {
      sources.push(...listRuntimeSources(path, excludeApi));
    } else if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(entry))) {
      sources.push(path);
    }
  }
  return sources;
}

describe("residual database privilege fence migration", () => {
  it("removes marketplace mutations while preserving projected public reads", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      for (const role of ["anon", "authenticated"] as const) {
        await db.exec(`SET ROLE ${role}`);
        for (const table of MARKETPLACE_TABLES) {
          expect((await db.query<{ id: number }>(
            `SELECT id FROM public.${table}`,
          )).rows).toEqual([{ id: 1 }]);
          await expect(
            db.query(`SELECT payload FROM public.${table}`),
          ).rejects.toThrow(/permission denied/i);
          await expect(
            db.exec(`INSERT INTO public.${table} (id) VALUES (2)`),
          ).rejects.toThrow(/permission denied/i);
          await expect(
            db.exec(`UPDATE public.${table} SET payload = 'forged' WHERE id = 1`),
          ).rejects.toThrow(/permission denied/i);
          await expect(
            db.exec(`DELETE FROM public.${table} WHERE id = 1`),
          ).rejects.toThrow(/permission denied/i);
        }
        await db.exec("RESET ROLE");
      }

      await db.exec("SET ROLE service_role");
      for (const table of MARKETPLACE_TABLES) {
        await db.exec(
          `UPDATE public.${table} SET payload = 'trusted' WHERE id = 1`,
        );
      }
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("makes core couple writes server-only, preserves user chat inserts, and rejects cross-couple decision edges", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        SET app.current_couple_id = '10000000-0000-4000-8000-000000000001';
        SET ROLE authenticated;
        UPDATE public.profiles
        SET push_token = 'ExpoPushToken[legacy-direct-write]'
        WHERE id = '10000000-0000-4000-8000-000000000041';
        UPDATE public.profiles
        SET push_token = NULL
        WHERE id = '10000000-0000-4000-8000-000000000041';
        UPDATE public.wedding_journeys
        SET progress = '{"forged":true}', payload = 'forged'
        WHERE couple_id = '10000000-0000-4000-8000-000000000001';
        UPDATE public.wedding_journeys
        SET progress = '{"phase":"safe"}', payload = 'sentinel'
        WHERE couple_id = '10000000-0000-4000-8000-000000000001';
        INSERT INTO public.cohort_timeline_events (
          id, room_id, user_id, event_type
        ) VALUES (
          '10000000-0000-4000-8000-000000000052',
          '10000000-0000-4000-8000-000000000061',
          '10000000-0000-4000-8000-000000000041',
          'forged_event_type'
        );
        DELETE FROM public.cohort_timeline_events
        WHERE id = '10000000-0000-4000-8000-000000000052';
        INSERT INTO public.amora_saved_notes (
          id, couple_id, saved_by, message_id, content, payload
        ) VALUES (
          '50000000-0000-4000-8000-000000000099',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000041',
          NULL,
          'direct bypass',
          'forged'
        );
        DELETE FROM public.amora_saved_notes
        WHERE id = '50000000-0000-4000-8000-000000000099';
        INSERT INTO public.decision_edges (
          id, couple_id, from_node_id, to_node_id, relationship
        ) VALUES (
          '30000000-0000-4000-8000-000000000099',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000011',
          '20000000-0000-4000-8000-000000000011',
          'because_of'
        );
        DELETE FROM public.decision_edges
        WHERE id = '30000000-0000-4000-8000-000000000099';
        RESET ROLE;
      `);

      await db.exec(migration);

      await db.exec(`
        SET app.current_couple_id = '10000000-0000-4000-8000-000000000001';
        SET ROLE authenticated;
      `);
      for (const table of SERVER_WRITE_AUTH_READ_TABLES) {
        expect((await db.query<{ payload: string }>(`
          SELECT payload FROM public.${table}
        `)).rows.length).toBeGreaterThan(0);
        await expect(db.exec(`
          UPDATE public.${table} SET payload = 'forged'
        `)).rejects.toThrow(/permission denied/i);
      }
      await expect(db.exec(`
        UPDATE public.profiles
        SET push_token = 'ExpoPushToken[bypass]'
      `)).rejects.toThrow(/permission denied/i);
      expect((await db.query<{ id: string }>(`
        SELECT id FROM public.decision_edges
      `)).rows).toEqual([{
        id: "30000000-0000-4000-8000-000000000001",
      }]);
      expect((await db.query<{ amount: number }>(`
        SELECT amount FROM public.congratulatory_money
      `)).rows).toEqual([{ amount: 100000 }]);
      expect((await db.query<{ saved_by: string }>(`
        SELECT saved_by FROM public.amora_saved_notes
      `)).rows).toEqual([{
        saved_by: "10000000-0000-4000-8000-000000000042",
      }]);
      await db.exec(`
        SET app.current_couple_id = '20000000-0000-4000-8000-000000000001';
      `);
      expect((await db.query<{ id: string }>(`
        SELECT id FROM public.amora_saved_notes
      `)).rows).toEqual([]);
      await db.exec(`
        SET app.current_couple_id = '10000000-0000-4000-8000-000000000001';
      `);
      await expect(db.exec(`
        INSERT INTO public.decision_edges (
          id, couple_id, from_node_id, to_node_id, relationship
        ) VALUES (
          '30000000-0000-4000-8000-000000000098',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000011',
          '10000000-0000-4000-8000-000000000012',
          'because_of'
        )
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.exec(`
        INSERT INTO public.congratulatory_money (
          id, couple_id, guest_name, amount
        ) VALUES (
          '40000000-0000-4000-8000-000000000099',
          '10000000-0000-4000-8000-000000000001',
          'Forged',
          -1
        )
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.exec(`
        INSERT INTO public.amora_saved_notes (
          id, couple_id, saved_by, content
        ) VALUES (
          '50000000-0000-4000-8000-000000000095',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000041',
          'direct insert bypass'
        )
      `)).rejects.toThrow(/permission denied/i);
      await expect(db.exec(`
        DELETE FROM public.amora_saved_notes
        WHERE id = '50000000-0000-4000-8000-000000000001'
      `)).rejects.toThrow(/permission denied/i);
      await db.exec(`
        INSERT INTO public.chat_messages (
          id, couple_id, sender_id, payload
        ) VALUES (
          '10000000-0000-4000-8000-000000000032',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000041',
          'allowed-user-message'
        )
      `);

      await db.exec("RESET ROLE");
      await db.exec("SET ROLE anon");
      for (const table of SERVER_WRITE_AUTH_READ_TABLES) {
        await expect(
          db.query(`SELECT * FROM public.${table}`),
        ).rejects.toThrow(/permission denied/i);
      }
      await expect(
        db.query("SELECT * FROM public.decision_edges"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT * FROM public.congratulatory_money"),
      ).rejects.toThrow(/permission denied/i);

      await db.exec("SET ROLE service_role");
      for (const table of SERVER_WRITE_AUTH_READ_TABLES) {
        await db.exec(`UPDATE public.${table} SET payload = 'trusted'`);
      }
      await expect(db.exec(`
        UPDATE public.decision_nodes
        SET couple_id = '20000000-0000-4000-8000-000000000001'
        WHERE id = '10000000-0000-4000-8000-000000000011'
      `)).rejects.toThrow(/decision node couple is immutable/i);
      await db.exec(`
        INSERT INTO public.decision_edges (
          id, couple_id, from_node_id, to_node_id, relationship
        ) VALUES (
          '30000000-0000-4000-8000-000000000097',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000011',
          '10000000-0000-4000-8000-000000000012',
          'after'
        )
      `);
      await db.exec(`
        INSERT INTO public.amora_saved_notes (
          id, couple_id, saved_by, message_id, content, payload
        ) VALUES (
          '50000000-0000-4000-8000-000000000097',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000041',
          '10000000-0000-4000-8000-000000000031',
          'trusted same-couple note',
          'trusted'
        )
      `);
      await expect(db.exec(`
        UPDATE public.amora_saved_notes
        SET couple_id = '20000000-0000-4000-8000-000000000001'
        WHERE id = '50000000-0000-4000-8000-000000000097'
      `)).rejects.toThrow(/SAVED_NOTE_COUPLE_IMMUTABLE/i);
      await expect(db.exec(`
        UPDATE public.amora_saved_notes
        SET saved_by = '10000000-0000-4000-8000-000000000042'
        WHERE id = '50000000-0000-4000-8000-000000000097'
      `)).rejects.toThrow(/SAVED_NOTE_OWNER_IMMUTABLE/i);
      await expect(db.exec(`
        INSERT INTO public.amora_saved_notes (
          id, couple_id, saved_by, message_id, content, payload
        ) VALUES (
          '50000000-0000-4000-8000-000000000096',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000041',
          '20000000-0000-4000-8000-000000000031',
          'cross-couple note',
          'forged'
        )
      `)).rejects.toThrow(/SAVED_NOTE_MESSAGE_COUPLE_MISMATCH/i);
      await expect(db.exec(`
        INSERT INTO public.decision_edges (
          id, couple_id, from_node_id, to_node_id, relationship
        ) VALUES (
          '30000000-0000-4000-8000-000000000096',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000011',
          '20000000-0000-4000-8000-000000000011',
          'after'
        )
      `)).rejects.toThrow(/edge nodes must belong to the edge couple/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("serializes and enforces the 300-note couple cap in the database", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      const additionalRows = Array.from({ length: 299 }, (_, index) => {
        const suffix = (index + 2).toString(16).padStart(12, "0");
        return `(
          '60000000-0000-4000-8000-${suffix}',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000041',
          'note ${index + 2}'
        )`;
      }).join(",");

      await db.exec(`
        SET ROLE service_role;
        INSERT INTO public.amora_saved_notes (
          id, couple_id, saved_by, content
        ) VALUES ${additionalRows};
      `);
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_saved_notes
        WHERE couple_id = '10000000-0000-4000-8000-000000000001'
      `)).rows).toEqual([{ count: 300 }]);

      await expect(db.exec(`
        INSERT INTO public.amora_saved_notes (
          id, couple_id, saved_by, content
        ) VALUES (
          '60000000-0000-4000-8000-000000000301',
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000041',
          'over the cap'
        )
      `)).rejects.toThrow(/SAVED_NOTES_LIMIT/i);

      expect(migration).toMatch(
        /pg_advisory_xact_lock[\s\S]{0,300}amora_saved_notes:/i,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when a historical saved note points across couples", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.amora_saved_notes
        SET message_id = '20000000-0000-4000-8000-000000000031'
        WHERE id = '50000000-0000-4000-8000-000000000001'
      `);

      await expect(db.exec(migration)).rejects.toThrow(
        /SAVED_NOTE_MESSAGE_BOUNDARY_REQUIRES_REVIEW/i,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("quarantines raw analytics, fitting, and retired financial tables without rewriting rows", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      for (const role of ["anon", "authenticated"] as const) {
        await db.exec(`SET ROLE ${role}`);
        for (const table of SERVICE_ONLY_TABLES) {
          await expect(
            db.query(`SELECT * FROM public.${table}`),
          ).rejects.toThrow(/permission denied/i);
          await expect(
            db.exec(`INSERT INTO public.${table} (id) VALUES (2)`),
          ).rejects.toThrow(/permission denied/i);
        }
        await db.exec("RESET ROLE");
      }

      for (const table of SERVICE_ONLY_TABLES) {
        expect((await db.query<{ payload: string }>(
          `SELECT payload FROM public.${table} WHERE id = 1`,
        )).rows).toEqual([{ payload: "sentinel" }]);
      }

      await db.exec("SET ROLE service_role");
      for (const table of SERVICE_ONLY_TABLES) {
        expect((await db.query<{ id: number }>(
          `SELECT id FROM public.${table}`,
        )).rows).toEqual([{ id: 1 }]);
        await db.exec(`INSERT INTO public.${table} (id) VALUES (2)`);
      }
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("removes RLS-bypassing table powers, preserves the release lease, and replays", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);

      for (const role of ["anon", "authenticated"] as const) {
        for (const table of ALL_CURRENT_TABLES) {
          const result = await db.query<{
            can_truncate: boolean;
            can_reference: boolean;
            can_trigger: boolean;
          }>(`
            SELECT
              has_table_privilege('${role}', 'public.${table}', 'TRUNCATE') AS can_truncate,
              has_table_privilege('${role}', 'public.${table}', 'REFERENCES') AS can_reference,
              has_table_privilege('${role}', 'public.${table}', 'TRIGGER') AS can_trigger
          `);
          expect(result.rows).toEqual([{
            can_truncate: false,
            can_reference: false,
            can_trigger: false,
          }]);
        }
      }

      for (const table of COUNTER_TABLES) {
        const result = await db.query<{ can_truncate: boolean }>(`
          SELECT has_table_privilege(
            'service_role', 'public.${table}', 'TRUNCATE'
          ) AS can_truncate
        `);
        expect(result.rows).toEqual([{ can_truncate: false }]);
      }

      const releaseLease = await db.query<{
        can_truncate: boolean;
        can_reference: boolean;
        can_trigger: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'service_role',
            'public.production_release_lease_20260717',
            'TRUNCATE'
          ) AS can_truncate,
          has_table_privilege(
            'service_role',
            'public.production_release_lease_20260717',
            'REFERENCES'
          ) AS can_reference,
          has_table_privilege(
            'service_role',
            'public.production_release_lease_20260717',
            'TRIGGER'
          ) AS can_trigger
      `);
      expect(releaseLease.rows).toEqual([{
        can_truncate: false,
        can_reference: false,
        can_trigger: false,
      }]);

      await db.exec(`
        CREATE TABLE public.future_api_table (id integer PRIMARY KEY);
      `);
      const futureAcl = await db.query<{
        can_truncate: boolean;
        can_reference: boolean;
        can_trigger: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'authenticated', 'public.future_api_table', 'TRUNCATE'
          ) AS can_truncate,
          has_table_privilege(
            'authenticated', 'public.future_api_table', 'REFERENCES'
          ) AS can_reference,
          has_table_privilege(
            'authenticated', 'public.future_api_table', 'TRIGGER'
          ) AS can_trigger
      `);
      expect(futureAcl.rows).toEqual([{
        can_truncate: false,
        can_reference: false,
        can_trigger: false,
      }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("removes implicit SECURITY DEFINER execution without breaking explicit RPC roles", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      await db.exec("SET ROLE anon");
      expect((await db.query<{ allowed: boolean }>(`
        SELECT public.is_vendor_public(
          '10000000-0000-4000-8000-000000000001'
        ) AS allowed
      `)).rows).toEqual([{ allowed: true }]);
      await expect(
        db.query("SELECT public.create_couple_for_current_user('bride')"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT public.implicit_hosted_definer()"),
      ).rejects.toThrow(/permission denied/i);

      await db.exec("SET ROLE authenticated");
      expect((await db.query<{ allowed: boolean }>(`
        SELECT public.create_couple_for_current_user('bride') AS allowed
      `)).rows).toEqual([{ allowed: true }]);
      expect((await db.query<{ allowed: boolean }>(`
        SELECT public.existing_invoker() AS allowed
      `)).rows).toEqual([{ allowed: true }]);
      await expect(
        db.query("SELECT public.check_rate_limit_cost('key', 1, 1, 1)"),
      ).rejects.toThrow(/permission denied/i);

      await db.exec("SET ROLE service_role");
      expect((await db.query<{ allowed: boolean }>(`
        SELECT public.check_rate_limit_cost('key', 1, 1, 1) AS allowed
      `)).rows).toEqual([{ allowed: true }]);

      await db.exec("RESET ROLE");
      const leaked = await db.query<{ signature: string }>(`
        SELECT procedure.oid::regprocedure::text AS signature
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS privilege
        WHERE namespace.nspname = 'public'
          AND procedure.prosecdef
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      `);
      expect(leaked.rows).toEqual([]);

      await db.exec(`
        CREATE FUNCTION public.future_definer()
        RETURNS boolean
        LANGUAGE sql
        SECURITY DEFINER
        AS 'SELECT true';
        SET ROLE authenticated;
      `);
      await expect(
        db.query("SELECT public.future_definer()"),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps dormant fitting and payment tables out of client runtime code", () => {
    const repoRoot = resolve(process.cwd(), "../..");
    const clientRoots = [
      resolve(repoRoot, "apps/mobile/app"),
      resolve(repoRoot, "apps/mobile/src"),
      resolve(repoRoot, "apps/web/src/app"),
      resolve(repoRoot, "apps/web/src/components"),
      resolve(repoRoot, "apps/web/src/hooks"),
      resolve(repoRoot, "apps/web/src/stores"),
    ];
    const directSensitiveTable = /\.from\s*\(\s*["'](?:fitting_requests|fitting_usage|user_fitting_photos|invitations|invitation_photos|invitation_accounts|invitation_rsvp|invitation_guestbook|invitation_visits|ai_scripts|customer_insights|vendor_contract_templates|contracts|payments|settlements)["']\s*\)/;
    const directFittingRpc = /\.rpc\s*\(\s*["'](?:increment_fitting_usage|cleanup_expired_fittings)["']/;
    const directCoreMutation = /\.from\s*\(\s*["'](?:profiles|couples|wedding_journeys|decision_nodes|cohort_timeline_events|amora_saved_notes)["']\s*\)(?:(?!;)[\s\S]){0,1200}\.(?:insert|upsert|update|delete)\s*\(/;

    for (const file of clientRoots.flatMap((root) => listRuntimeSources(root))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(directSensitiveTable);
      expect(source, file).not.toMatch(directFittingRpc);
      expect(source, file).not.toMatch(directCoreMutation);
    }

    const dormantNoConsumer = /\.from\s*\(\s*["'](?:invitations|invitation_photos|invitation_accounts|invitation_rsvp|invitation_guestbook|invitation_visits|ai_scripts|customer_insights)["']\s*\)/;
    for (const file of [
      resolve(repoRoot, "apps/mobile"),
      resolve(repoRoot, "apps/web/src"),
      resolve(repoRoot, "packages"),
    ].flatMap((root) => listRuntimeSources(root, false))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(dormantNoConsumer);
    }

    const eventsRoute = readFileSync(
      resolve(repoRoot, "apps/web/src/app/api/events/route.ts"),
      "utf8",
    );
    expect(eventsRoute).toMatch(
      /createAdminClient\(\)\.from\("customer_events"\)\.insert/,
    );
    expect(eventsRoute).not.toMatch(
      /supabase\.from\("customer_events"\)\.insert/,
    );

    const moneyRoute = readFileSync(
      resolve(repoRoot, "apps/web/src/app/api/money/route.ts"),
      "utf8",
    );
    const moneyItemRoute = readFileSync(
      resolve(repoRoot, "apps/web/src/app/api/money/[id]/route.ts"),
      "utf8",
    );
    expect(moneyRoute).toMatch(
      /createAdminClient\(\)[\s\S]{0,80}\.from\("congratulatory_money"\)[\s\S]{0,80}\.insert/,
    );
    expect(moneyItemRoute).toMatch(
      /createAdminClient\(\)[\s\S]{0,80}\.from\("congratulatory_money"\)[\s\S]{0,80}\.update/,
    );
    expect(moneyItemRoute).toMatch(
      /\.eq\("id", id\)[\s\S]{0,80}\.eq\("couple_id", ownerCheck\.coupleId\)/,
    );
    expect(moneyItemRoute).toMatch(
      /createAdminClient\(\)[\s\S]{0,80}\.from\("congratulatory_money"\)[\s\S]{0,80}\.delete/,
    );
    const savedNotesRoute = readFileSync(
      resolve(repoRoot, "apps/web/src/app/api/amora/notes/route.ts"),
      "utf8",
    );
    expect(savedNotesRoute).toMatch(
      /createAdminClient\(\)[\s\S]{0,80}\.from\("amora_saved_notes"\)[\s\S]{0,80}\.insert/,
    );
    expect(savedNotesRoute).toMatch(
      /createAdminClient\(\)[\s\S]{0,80}\.from\("amora_saved_notes"\)[\s\S]{0,80}\.update/,
    );
    expect(savedNotesRoute).toMatch(
      /\.eq\("id", body\.id\)[\s\S]{0,80}\.eq\("couple_id", coupleId\)/,
    );
    expect(savedNotesRoute).toMatch(
      /createAdminClient\(\)[\s\S]{0,80}\.from\("amora_saved_notes"\)[\s\S]{0,80}\.delete/,
    );
    // PostgreSQL treats a comma-separated privilege request as "any", not
    // "all". Postflight must test each required service DML privilege alone.
    expect(migration).not.toContain("'SELECT,INSERT,UPDATE,DELETE'");
    expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM)\s+public\./i);
    expect(migration).not.toMatch(/\bUPDATE\s+public\./i);
  });
});
