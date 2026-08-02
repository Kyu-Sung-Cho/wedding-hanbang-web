// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802124000_enforce_single_active_cohort_membership.sql",
  ),
  "utf8",
);
const cohortRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/cohort/route.ts"),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const ROOM_A_ID = "10000000-0000-4000-8000-000000000001";
const ROOM_B_ID = "10000000-0000-4000-8000-000000000002";
const ROOM_C_ID = "10000000-0000-4000-8000-000000000003";
const OLD_MEMBERSHIP_ID = "20000000-0000-4000-8000-000000000001";
const NEW_MEMBERSHIP_ID = "20000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE public.cohort_rooms (
      id uuid PRIMARY KEY,
      member_count integer,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.cohort_members (
      id uuid PRIMARY KEY,
      room_id uuid NOT NULL REFERENCES public.cohort_rooms(id),
      user_id uuid NOT NULL,
      joined_at timestamptz,
      is_active boolean DEFAULT true,
      UNIQUE (room_id, user_id)
    );

    INSERT INTO public.cohort_rooms (id, member_count) VALUES
      ('${ROOM_A_ID}', 99),
      ('${ROOM_B_ID}', 99),
      ('${ROOM_C_ID}', 99);

    INSERT INTO public.cohort_members (
      id, room_id, user_id, joined_at, is_active
    ) VALUES
      (
        '${OLD_MEMBERSHIP_ID}', '${ROOM_A_ID}', '${USER_ID}',
        '2026-01-01T00:00:00Z', true
      ),
      (
        '${NEW_MEMBERSHIP_ID}', '${ROOM_B_ID}', '${USER_ID}',
        '2026-02-01T00:00:00Z', true
      ),
      (
        '20000000-0000-4000-8000-000000000003', '${ROOM_A_ID}', '${OTHER_ID}',
        '2026-01-15T00:00:00Z', true
      ),
      (
        '20000000-0000-4000-8000-000000000004', '${ROOM_C_ID}', '${OTHER_ID}',
        '2025-12-01T00:00:00Z', false
      );
  `);
  return db;
}

describe("single active cohort membership migration", () => {
  it("moves GET repairs into an explicit migration and keeps GET read-only", () => {
    expect(migration).toContain("row_number() OVER");
    expect(migration).toContain("ORDER BY member.joined_at DESC NULLS LAST, member.id DESC");
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS cohort_members_one_active_per_user_uidx",
    );

    const getStart = cohortRoute.indexOf("export async function GET");
    const postStart = cohortRoute.indexOf("export async function POST");
    const getHandler = cohortRoute.slice(getStart, postStart);
    expect(getStart).toBeGreaterThanOrEqual(0);
    expect(postStart).toBeGreaterThan(getStart);
    expect(getHandler).not.toMatch(/\.(?:insert|update|upsert|delete)\(/);
    expect(getHandler).not.toContain("refreshMemberCount(");
  });

  it("keeps the newest active membership and repairs every room count", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      const memberships = await db.query<{
        id: string;
        is_active: boolean;
      }>(`
        SELECT id, is_active
        FROM public.cohort_members
        WHERE user_id = '${USER_ID}'
        ORDER BY id
      `);
      expect(memberships.rows).toEqual([
        { id: OLD_MEMBERSHIP_ID, is_active: false },
        { id: NEW_MEMBERSHIP_ID, is_active: true },
      ]);

      const rooms = await db.query<{ id: string; member_count: number }>(`
        SELECT id, member_count
        FROM public.cohort_rooms
        ORDER BY id
      `);
      expect(rooms.rows).toEqual([
        { id: ROOM_A_ID, member_count: 1 },
        { id: ROOM_B_ID, member_count: 1 },
        { id: ROOM_C_ID, member_count: 0 },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("prevents the invalid state from recurring", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);

      await expect(
        db.exec(`
          UPDATE public.cohort_members
          SET is_active = true
          WHERE id = '${OLD_MEMBERSHIP_ID}'
        `),
      ).rejects.toThrow(/unique|duplicate/i);

      const active = await db.query<{ room_id: string }>(`
        SELECT room_id
        FROM public.cohort_members
        WHERE user_id = '${USER_ID}'
          AND is_active IS TRUE
      `);
      expect(active.rows).toEqual([{ room_id: ROOM_B_ID }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("is replay-safe after the one-time repair", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await db.exec(migration);

      const duplicates = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM (
          SELECT user_id
          FROM public.cohort_members
          WHERE is_active IS TRUE
          GROUP BY user_id
          HAVING count(*) > 1
        ) AS duplicate
      `);
      expect(duplicates.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);
});
