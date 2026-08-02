// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802150000_harden_cohort_guestbook_integrity.sql",
  ),
  "utf8",
);

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const NEXT_USER_ID = "00000000-0000-4000-8000-000000000002";
const OWNER_ID = "00000000-0000-4000-8000-000000000003";
const ROOM_A_ID = "10000000-0000-4000-8000-000000000001";
const ROOM_B_ID = "10000000-0000-4000-8000-000000000002";
const GUESTBOOK_ID = "20000000-0000-4000-8000-000000000001";

const fillerUserIds = Array.from(
  { length: 29 },
  (_, index) => `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`,
);

async function createDatabase() {
  const db = await PGlite.create();
  const fillerUsers = fillerUserIds.map((id) => `('${id}')`).join(",\n");
  const fillerMembers = fillerUserIds
    .map(
      (id, index) =>
        `(gen_random_uuid(), '${ROOM_A_ID}', '${id}', '2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z', true)`,
    )
    .join(",\n");

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;

    CREATE TABLE auth.users (
      id uuid PRIMARY KEY
    );

    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      wedding_year integer,
      wedding_month integer
    );

    CREATE TABLE public.cohort_rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      year integer NOT NULL,
      month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
      room_number integer NOT NULL,
      name text NOT NULL,
      member_count integer DEFAULT 0,
      message_count integer DEFAULT 0,
      is_active boolean DEFAULT true,
      UNIQUE (year, month, room_number)
    );

    CREATE TABLE public.cohort_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL REFERENCES public.cohort_rooms(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      joined_at timestamptz DEFAULT now(),
      last_seen_at timestamptz DEFAULT now(),
      is_active boolean DEFAULT true,
      UNIQUE (room_id, user_id)
    );
    CREATE UNIQUE INDEX cohort_members_one_active_per_user_uidx
      ON public.cohort_members (user_id)
      WHERE is_active IS TRUE;

    CREATE TABLE public.cohort_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL REFERENCES public.cohort_rooms(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      content text NOT NULL,
      is_deleted boolean DEFAULT false
    );

    CREATE TABLE public.guestbooks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      message_count integer DEFAULT 0
    );
    CREATE TABLE public.guestbook_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      guestbook_id uuid NOT NULL REFERENCES public.guestbooks(id) ON DELETE CASCADE,
      guest_name text NOT NULL,
      message text NOT NULL,
      is_approved boolean DEFAULT true
    );

    CREATE FUNCTION public.prevent_cohort_membership_client_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      IF COALESCE(current_setting('request.jwt.claim.role', true), '')
        IN ('anon', 'authenticated') THEN
        RAISE EXCEPTION 'cohort membership is server-managed'
          USING ERRCODE = '42501';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER trg_prevent_cohort_membership_client_write
      BEFORE INSERT OR UPDATE OR DELETE ON public.cohort_members
      FOR EACH ROW EXECUTE FUNCTION public.prevent_cohort_membership_client_write();

    CREATE FUNCTION public.cohort_message_count_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE public.cohort_rooms
      SET message_count = COALESCE(message_count, 0) + 1
      WHERE id = NEW.room_id;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER trg_cohort_msg_count
      AFTER INSERT ON public.cohort_messages
      FOR EACH ROW EXECUTE FUNCTION public.cohort_message_count_trigger();

    CREATE FUNCTION public.gb_message_count_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE public.guestbooks
        SET message_count = COALESCE(message_count, 0) + 1
        WHERE id = NEW.guestbook_id;
      ELSE
        UPDATE public.guestbooks
        SET message_count = GREATEST(COALESCE(message_count, 0) - 1, 0)
        WHERE id = OLD.guestbook_id;
      END IF;
      RETURN NULL;
    END;
    $$;
    CREATE TRIGGER trg_gb_msg_count
      AFTER INSERT OR DELETE ON public.guestbook_messages
      FOR EACH ROW EXECUTE FUNCTION public.gb_message_count_trigger();

    CREATE FUNCTION public.community_assign_cohort(
      p_user_id uuid,
      p_year integer,
      p_month integer
    )
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      RETURN NULL;
    END;
    $$;

    ALTER TABLE public.cohort_members ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON TABLE public.cohort_members TO authenticated;
    GRANT INSERT (room_id, user_id), UPDATE (is_active), REFERENCES (room_id)
      ON TABLE public.cohort_members TO authenticated;
    GRANT ALL ON TABLE
      public.cohort_rooms,
      public.cohort_members,
      public.cohort_messages,
      public.guestbooks,
      public.guestbook_messages,
      public.community_profiles,
      auth.users
    TO service_role;

    INSERT INTO auth.users (id) VALUES
      ('${ACTOR_ID}'),
      ('${NEXT_USER_ID}'),
      ('${OWNER_ID}'),
      ${fillerUsers};
    INSERT INTO public.community_profiles (user_id)
    VALUES ('${ACTOR_ID}'), ('${NEXT_USER_ID}');

    INSERT INTO public.cohort_rooms (
      id, year, month, room_number, name, member_count, message_count, is_active
    ) VALUES
      ('${ROOM_A_ID}', 2027, 4, 1, 'room-a', 999, 999, true),
      ('${ROOM_B_ID}', 2027, 7, 1, 'room-b', 999, 999, true);
    INSERT INTO public.cohort_members (
      id, room_id, user_id, joined_at, is_active
    ) VALUES
      ${fillerMembers};
    INSERT INTO public.cohort_messages (
      id, room_id, author_id, content, is_deleted
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '${ROOM_A_ID}', '${ACTOR_ID}', 'physical row', true
    );

    INSERT INTO public.guestbooks (id, owner_id, message_count)
    VALUES ('${GUESTBOOK_ID}', '${OWNER_ID}', 999);
    INSERT INTO public.guestbook_messages (
      id, guestbook_id, guest_name, message, is_approved
    ) VALUES (
      '40000000-0000-4000-8000-000000000001',
      '${GUESTBOOK_ID}', 'guest', 'physical row', false
    );
  `);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "authenticated" | "service_role",
  userId = "",
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("cohort and guestbook integrity migration", () => {
  it("repairs drift, preserves the client write fence, and is replay-safe", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);

      const counters = await db.query<{
        id: string;
        member_count: number;
        message_count: number;
      }>(`
        SELECT id, member_count, message_count
        FROM public.cohort_rooms
        ORDER BY id
      `);
      expect(counters.rows).toEqual([
        { id: ROOM_A_ID, member_count: 29, message_count: 1 },
        { id: ROOM_B_ID, member_count: 0, message_count: 0 },
      ]);

      expect((await db.query<{ message_count: number }>(`
        SELECT message_count FROM public.guestbooks WHERE id = '${GUESTBOOK_ID}'
      `)).rows).toEqual([{ message_count: 1 }]);

      const fenceAuthority = await db.query<{
        authenticated_insert: boolean;
        authenticated_update: boolean;
        authenticated_references: boolean;
        trigger_owner: string;
        trigger_is_definer: boolean;
        trigger_config: string[];
        authenticated_can_execute_trigger: boolean;
      }>(`
        SELECT
          pg_catalog.has_any_column_privilege(
            'authenticated', 'public.cohort_members', 'INSERT'
          ) AS authenticated_insert,
          pg_catalog.has_any_column_privilege(
            'authenticated', 'public.cohort_members', 'UPDATE'
          ) AS authenticated_update,
          pg_catalog.has_any_column_privilege(
            'authenticated', 'public.cohort_members', 'REFERENCES'
          ) AS authenticated_references,
          pg_catalog.pg_get_userbyid(proc.proowner) AS trigger_owner,
          proc.prosecdef AS trigger_is_definer,
          proc.proconfig AS trigger_config,
          pg_catalog.has_function_privilege(
            'authenticated',
            'public.prevent_cohort_membership_client_write()',
            'EXECUTE'
          ) AS authenticated_can_execute_trigger
        FROM pg_catalog.pg_proc AS proc
        WHERE proc.oid = pg_catalog.to_regprocedure(
          'public.prevent_cohort_membership_client_write()'
        )
      `);
      expect(fenceAuthority.rows[0]).toEqual({
        authenticated_insert: false,
        authenticated_update: false,
        authenticated_references: false,
        trigger_owner: "postgres",
        trigger_is_definer: true,
        trigger_config: ['search_path=""'],
        authenticated_can_execute_trigger: false,
      });

      await setPersona(db, "authenticated", ACTOR_ID);
      await expect(db.exec(`
        INSERT INTO public.cohort_members (room_id, user_id)
        VALUES ('${ROOM_B_ID}', '${ACTOR_ID}')
      `)).rejects.toThrow(/permission denied|server-managed|row-level security/i);
      await expect(db.query(`SELECT public.community_assign_cohort(
        '${ACTOR_ID}', 2027, 4
      )`)).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("serializes the canonical assignment, enforces capacity, and reassigns atomically", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      await expect(db.exec(`
        INSERT INTO public.cohort_members (room_id, user_id, is_active)
        VALUES
          ('${ROOM_A_ID}', '${ACTOR_ID}', true),
          ('${ROOM_A_ID}', '${NEXT_USER_ID}', true)
      `)).rejects.toThrow(/capacity/i);
      expect((await db.query<{ member_count: number }>(`
        SELECT member_count FROM public.cohort_rooms WHERE id = '${ROOM_A_ID}'
      `)).rows[0]?.member_count).toBe(29);

      const first = await db.query<{ room_id: string }>(`
        SELECT public.community_assign_cohort(
          '${ACTOR_ID}', 2027, 4
        ) AS room_id
      `);
      expect(first.rows[0]?.room_id).toBe(ROOM_A_ID);

      const idempotent = await db.query<{ room_id: string }>(`
        SELECT public.community_assign_cohort(
          '${ACTOR_ID}', 2027, 4
        ) AS room_id
      `);
      expect(idempotent.rows[0]?.room_id).toBe(ROOM_A_ID);

      await expect(db.exec(`
        INSERT INTO public.cohort_members (room_id, user_id, is_active)
        VALUES ('${ROOM_A_ID}', '${NEXT_USER_ID}', true)
      `)).rejects.toThrow(/capacity/i);

      const overflowAssignment = await db.query<{ room_id: string }>(`
        SELECT public.community_assign_cohort(
          '${NEXT_USER_ID}', 2027, 4
        ) AS room_id
      `);
      expect(overflowAssignment.rows[0]?.room_id).not.toBe(ROOM_A_ID);

      const rooms = await db.query<{
        room_number: number;
        name: string;
        member_count: number;
      }>(`
        SELECT room_number, name, member_count
        FROM public.cohort_rooms
        WHERE year = 2027 AND month = 4
        ORDER BY room_number
      `);
      expect(rooms.rows).toEqual([
        {
          room_number: 1,
          name: "2027년 2분기 결혼 동기",
          member_count: 30,
        },
        {
          room_number: 2,
          name: "2027년 2분기 결혼 동기 2방",
          member_count: 1,
        },
      ]);

      const reassigned = await db.query<{ room_id: string }>(`
        SELECT public.community_assign_cohort(
          '${ACTOR_ID}', 2027, 7
        ) AS room_id
      `);
      expect(reassigned.rows[0]?.room_id).toBe(ROOM_B_ID);

      const finalState = await db.query<{
        active_room: string;
        old_count: number;
        new_count: number;
        wedding_year: number;
        wedding_month: number;
      }>(`
        SELECT
          (SELECT room_id FROM public.cohort_members
            WHERE user_id = '${ACTOR_ID}' AND is_active IS TRUE) AS active_room,
          (SELECT member_count FROM public.cohort_rooms
            WHERE id = '${ROOM_A_ID}') AS old_count,
          (SELECT member_count FROM public.cohort_rooms
            WHERE id = '${ROOM_B_ID}') AS new_count,
          (SELECT wedding_year FROM public.community_profiles
            WHERE user_id = '${ACTOR_ID}') AS wedding_year,
          (SELECT wedding_month FROM public.community_profiles
            WHERE user_id = '${ACTOR_ID}') AS wedding_month
      `);
      expect(finalState.rows[0]).toEqual({
        active_room: ROOM_B_ID,
        old_count: 29,
        new_count: 1,
        wedding_year: 2027,
        wedding_month: 7,
      });

      await expect(db.query(`SELECT public.community_assign_cohort(
        'ffffffff-ffff-4fff-8fff-ffffffffffff', 2027, 4
      )`)).rejects.toThrow(/actor_not_found/i);
      await expect(db.query(`SELECT public.community_assign_cohort(
        '${ACTOR_ID}', 2027, 13
      )`)).rejects.toThrow(/invalid cohort assignment input/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed when historical active membership already exceeds capacity", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.cohort_members (room_id, user_id, is_active)
        VALUES
          ('${ROOM_A_ID}', '${ACTOR_ID}', true),
          ('${ROOM_A_ID}', '${NEXT_USER_ID}', true)
      `);

      await expect(db.exec(migration)).rejects.toThrow(
        /COHORT_ROOM_OVER_CAPACITY_REQUIRES_REVIEW/,
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps active-member and physical-message counters exact through cascades", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      await db.exec(`
        INSERT INTO public.cohort_members (room_id, user_id, is_active)
        VALUES ('${ROOM_B_ID}', '${ACTOR_ID}', true);
        UPDATE public.cohort_rooms
        SET member_count = 999, message_count = 999
        WHERE id = '${ROOM_B_ID}';
      `);
      expect((await db.query<{ member_count: number; message_count: number }>(`
        SELECT member_count, message_count
        FROM public.cohort_rooms WHERE id = '${ROOM_B_ID}'
      `)).rows).toEqual([{ member_count: 1, message_count: 0 }]);

      await db.exec(`
        UPDATE public.cohort_members
        SET is_active = false
        WHERE room_id = '${ROOM_B_ID}' AND user_id = '${ACTOR_ID}';
      `);
      expect((await db.query<{ member_count: number }>(`
        SELECT member_count FROM public.cohort_rooms WHERE id = '${ROOM_B_ID}'
      `)).rows[0]?.member_count).toBe(0);

      await db.exec(`
        INSERT INTO public.cohort_messages (
          id, room_id, author_id, content, is_deleted
        ) VALUES (
          '30000000-0000-4000-8000-000000000002',
          '${ROOM_B_ID}', '${ACTOR_ID}', 'soft deleted still counts', false
        );
        UPDATE public.cohort_messages
        SET is_deleted = true
        WHERE id = '30000000-0000-4000-8000-000000000002';
      `);
      expect((await db.query<{ message_count: number }>(`
        SELECT message_count FROM public.cohort_rooms WHERE id = '${ROOM_B_ID}'
      `)).rows[0]?.message_count).toBe(1);

      await db.exec(`DELETE FROM auth.users WHERE id = '${ACTOR_ID}'`);
      const afterAuthCascade = await db.query<{
        room_a_messages: number;
        room_b_messages: number;
        room_b_members: number;
      }>(`
        SELECT
          (SELECT message_count FROM public.cohort_rooms
            WHERE id = '${ROOM_A_ID}') AS room_a_messages,
          (SELECT message_count FROM public.cohort_rooms
            WHERE id = '${ROOM_B_ID}') AS room_b_messages,
          (SELECT member_count FROM public.cohort_rooms
            WHERE id = '${ROOM_B_ID}') AS room_b_members
      `);
      expect(afterAuthCascade.rows[0]).toEqual({
        room_a_messages: 0,
        room_b_messages: 0,
        room_b_members: 0,
      });

      await expect(db.exec(`DELETE FROM public.cohort_rooms
        WHERE id = '${ROOM_A_ID}'`)).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("counts guestbook physical rows and remains safe on parent/auth cascades", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setPersona(db, "service_role");

      await db.exec(`
        INSERT INTO public.guestbook_messages (
          id, guestbook_id, guest_name, message, is_approved
        ) VALUES (
          '40000000-0000-4000-8000-000000000002',
          '${GUESTBOOK_ID}', 'guest 2', 'another physical row', true
        );
        UPDATE public.guestbook_messages
        SET is_approved = false
        WHERE id = '40000000-0000-4000-8000-000000000002';
        UPDATE public.guestbooks SET message_count = 999
        WHERE id = '${GUESTBOOK_ID}';
      `);
      expect((await db.query<{ message_count: number }>(`
        SELECT message_count FROM public.guestbooks WHERE id = '${GUESTBOOK_ID}'
      `)).rows[0]?.message_count).toBe(2);

      await db.exec(`DELETE FROM public.guestbook_messages
        WHERE id = '40000000-0000-4000-8000-000000000002'`);
      expect((await db.query<{ message_count: number }>(`
        SELECT message_count FROM public.guestbooks WHERE id = '${GUESTBOOK_ID}'
      `)).rows[0]?.message_count).toBe(1);

      await expect(db.exec(`DELETE FROM auth.users
        WHERE id = '${OWNER_ID}'`)).resolves.toBeDefined();
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.guestbooks
        WHERE id = '${GUESTBOOK_ID}'
      `)).rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("uses empty search paths, deferred reconciliation, and table serialization", () => {
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain(
      "LOCK TABLE public.cohort_members IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(migration).toContain(
      "LOCK TABLE public.cohort_rooms IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(3);
    expect(migration).toContain("COHORT_MEMBERSHIP_CLIENT_WRITE_FENCE_INVALID");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.prevent_cohort_membership_client_write()",
    );
    expect(migration).toContain("pg_catalog.has_any_column_privilege");
    expect(migration).toContain("ALTER FUNCTION public.community_assign_cohort");
  });
});
