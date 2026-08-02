// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260802180000_community_cohort_assignment_atomic.sql",
);

const USER_A = "10000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;

    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      wedding_year integer,
      wedding_month integer CHECK (wedding_month BETWEEN 1 AND 12),
      is_suspended boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.cohort_rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      year integer NOT NULL,
      month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
      room_number integer NOT NULL DEFAULT 1,
      name text NOT NULL,
      member_count integer NOT NULL DEFAULT 0,
      message_count integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (year, month, room_number)
    );
    CREATE TABLE public.cohort_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL REFERENCES public.cohort_rooms(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      joined_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      is_active boolean NOT NULL DEFAULT true,
      UNIQUE (room_id, user_id)
    );
  `);
  await db.exec(readFileSync(migrationPath, "utf8"));
  return db;
}

async function seedUser(db: PGlite, userId: string) {
  await db.query("INSERT INTO auth.users(id) VALUES ($1)", [userId]);
  await db.query("INSERT INTO public.community_profiles(user_id) VALUES ($1)", [userId]);
}

async function assign(db: PGlite, userId: string, year: number, month: number) {
  const result = await db.query<{ room_id: string }>(
    "SELECT public.community_assign_cohort($1, $2, $3) AS room_id",
    [userId, year, month],
  );
  return result.rows[0]?.room_id;
}

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("atomic community cohort assignment", () => {
  it("caps a room at 30 active members and derives exact cached counts", async () => {
    const db = await createDatabase();
    databases.push(db);
    const userIds = Array.from({ length: 31 }, (_, index) =>
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    for (const userId of userIds) await seedUser(db, userId);

    await Promise.all(userIds.map((userId) => assign(db, userId, 2027, 1)));

    const rooms = await db.query<{
      room_number: number;
      member_count: number;
      actual_count: number;
    }>(`
      SELECT room.room_number,
             room.member_count,
             count(member.id) FILTER (WHERE member.is_active)::integer AS actual_count
      FROM public.cohort_rooms AS room
      LEFT JOIN public.cohort_members AS member ON member.room_id = room.id
      WHERE room.year = 2027 AND room.month = 1
      GROUP BY room.id, room.room_number, room.member_count
      ORDER BY room.room_number
    `);

    expect(rooms.rows).toEqual([
      { room_number: 1, member_count: 30, actual_count: 30 },
      { room_number: 2, member_count: 1, actual_count: 1 },
    ]);
  });

  it("moves a user atomically and repairs every old active membership count", async () => {
    const db = await createDatabase();
    databases.push(db);
    await seedUser(db, USER_A);
    const firstRoom = await assign(db, USER_A, 2027, 1);
    const duplicateRoom = "20000000-0000-4000-8000-000000000002";
    await db.query(
      `INSERT INTO public.cohort_rooms(
         id, year, month, room_number, name, member_count
       ) VALUES ($1, 2027, 4, 1, 'legacy duplicate', 99)`,
      [duplicateRoom],
    );
    await db.query(
      "INSERT INTO public.cohort_members(room_id, user_id, is_active) VALUES ($1, $2, true)",
      [duplicateRoom, USER_A],
    );

    const targetRoom = await assign(db, USER_A, 2027, 7);

    const memberships = await db.query<{
      room_id: string;
      is_active: boolean;
    }>(`
      SELECT room_id, is_active
      FROM public.cohort_members
      WHERE user_id = $1
      ORDER BY room_id
    `, [USER_A]);
    expect(memberships.rows.filter((row) => row.is_active)).toEqual([
      { room_id: targetRoom, is_active: true },
    ]);

    const oldCounts = await db.query<{ id: string; member_count: number }>(`
      SELECT id, member_count
      FROM public.cohort_rooms
      WHERE id = ANY($1::uuid[])
      ORDER BY id
    `, [[firstRoom, duplicateRoom]]);
    expect(oldCounts.rows).toEqual([
      { id: firstRoom, member_count: 0 },
      { id: duplicateRoom, member_count: 0 },
    ].sort((left, right) => left.id.localeCompare(right.id)));
  });

  it("rolls the whole move back when a later profile update fails", async () => {
    const db = await createDatabase();
    databases.push(db);
    await seedUser(db, USER_A);
    const originalRoom = await assign(db, USER_A, 2027, 1);
    await db.exec(`
      CREATE FUNCTION public.reject_test_wedding_year()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.wedding_year = 2099 THEN
          RAISE EXCEPTION 'test profile failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_test_wedding_year
      BEFORE UPDATE ON public.community_profiles
      FOR EACH ROW EXECUTE FUNCTION public.reject_test_wedding_year();
    `);

    await expect(assign(db, USER_A, 2099, 10)).rejects.toThrow(/test profile failure/i);

    const active = await db.query<{ room_id: string }>(`
      SELECT room_id FROM public.cohort_members
      WHERE user_id = $1 AND is_active = true
    `, [USER_A]);
    expect(active.rows).toEqual([{ room_id: originalRoom }]);
    const leakedRoom = await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM public.cohort_rooms
      WHERE year = 2099 AND month = 10
    `);
    expect(leakedRoom.rows[0]?.count).toBe(0);
  });

  it("keeps arbitrary client roles from assigning a cohort directly", async () => {
    const db = await createDatabase();
    databases.push(db);
    await seedUser(db, USER_A);

    await db.exec("SET ROLE authenticated");
    await expect(assign(db, USER_A, 2027, 1)).rejects.toThrow(/permission denied/i);
  });
});

describe("cohort assignment route boundary", () => {
  for (const route of [
    "src/app/api/community/cohort/route.ts",
    "src/app/api/community/cohort/auto-assign/route.ts",
    "src/app/api/community/profile/wedding-date/route.ts",
  ]) {
    it(`${route} delegates membership changes to the atomic RPC`, () => {
      const source = readFileSync(resolve(process.cwd(), route), "utf8");
      expect(source).toMatch(/\.rpc\(\s*"community_assign_cohort"/);
      expect(source).not.toMatch(
        /\.from\("cohort_members"\)\s*\n\s*\.(?:insert|update|upsert|delete)/,
      );
    });
  }
});
