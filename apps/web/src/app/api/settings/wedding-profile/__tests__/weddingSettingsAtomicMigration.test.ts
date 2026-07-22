// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const profileMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716104000_profile_patch_atomic.sql"),
  "utf8",
);
const settingsMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716107000_wedding_settings_atomic.sql"),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "10000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      name text,
      role text CHECK (role IN ('bride', 'groom')),
      couple_id uuid REFERENCES public.couples(id),
      phone text,
      phone_care_consented_at timestamptz,
      care_notifications_enabled boolean NOT NULL DEFAULT false,
      care_notifications_consented_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.community_profiles (
      user_id uuid PRIMARY KEY,
      nickname text NOT NULL,
      badge text NOT NULL DEFAULT 'member',
      post_count integer NOT NULL DEFAULT 0,
      comment_count integer NOT NULL DEFAULT 0,
      total_upvotes_received integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX idx_community_profiles_nickname_key_unique
      ON public.community_profiles (
        lower(regexp_replace(btrim(nickname), '\\s+', '', 'g'))
      );
    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL,
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.community_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL,
      is_deleted boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.amora_care_jobs (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      status text NOT NULL,
      content text NOT NULL,
      email_subject text,
      email_html text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      completed_at timestamptz,
      lease_token uuid,
      lease_expires_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_care_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL REFERENCES public.amora_care_jobs(id),
      status text NOT NULL,
      recipient_email text,
      recipient_name text,
      completed_at timestamptz,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      wedding_date date,
      venue text,
      total_budget bigint,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO public.couples (id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${USER_ID}', '${OTHER_USER_ID}'),
      ('${OTHER_COUPLE_ID}', NULL, NULL);
    INSERT INTO public.profiles (
      id, name, role, couple_id, care_notifications_enabled
    ) VALUES
      ('${USER_ID}', '기존 이름', 'bride', '${COUPLE_ID}', false),
      ('${OTHER_USER_ID}', '다른 사람', 'groom', '${COUPLE_ID}', false);
    INSERT INTO public.community_profiles (user_id, nickname) VALUES
      ('${USER_ID}', '기존 별명'),
      ('${OTHER_USER_ID}', '다른 별명');
    INSERT INTO public.wedding_journeys (
      couple_id, wedding_date, venue, total_budget
    ) VALUES (
      '${COUPLE_ID}', '2027-05-01', '기존 예식장', 30000000
    );
  `);
  await db.exec(profileMigration);
  await db.exec(settingsMigration);
  return db;
}

type PatchOptions = {
  expectedCoupleId?: string | null;
  expectedCoupleIdProvided?: boolean;
  name?: string | null;
  nameProvided?: boolean;
  expectedName?: string | null;
  communityNickname?: string | null;
  communityNicknameProvided?: boolean;
  expectedCommunityNickname?: string | null;
  weddingDate?: string | null;
  weddingDateProvided?: boolean;
  expectedWeddingDate?: string | null;
  venue?: string | null;
  venueProvided?: boolean;
  expectedVenue?: string | null;
  totalBudget?: number | null;
  totalBudgetProvided?: boolean;
  expectedTotalBudget?: number | null;
};

async function patchSettings(db: PGlite, options: PatchOptions) {
  const values = [
    USER_ID,
    options.expectedCoupleId === undefined ? COUPLE_ID : options.expectedCoupleId,
    options.expectedCoupleIdProvided ?? true,
    options.name ?? null,
    options.nameProvided ?? false,
    options.expectedName ?? null,
    options.communityNickname ?? null,
    options.communityNicknameProvided ?? false,
    options.expectedCommunityNickname ?? null,
    options.weddingDate ?? null,
    options.weddingDateProvided ?? false,
    options.expectedWeddingDate ?? null,
    options.venue ?? null,
    options.venueProvided ?? false,
    options.expectedVenue ?? null,
    options.totalBudget ?? null,
    options.totalBudgetProvided ?? false,
    options.expectedTotalBudget ?? null,
  ];
  return db.query<{ value: Record<string, unknown> }>(`
    SELECT public.patch_wedding_settings_atomic(
      $1::uuid, $2::uuid, $3::boolean,
      $4::text, $5::boolean, $6::text,
      $7::text, $8::boolean, $9::text,
      $10::date, $11::boolean, $12::date,
      $13::text, $14::boolean, $15::text,
      $16::bigint, $17::boolean, $18::bigint
    ) AS value
  `, values);
}

async function asService(db: PGlite) {
  await db.exec("SET ROLE service_role");
}

async function resetRole(db: PGlite) {
  await db.exec("RESET ROLE");
}

describe("atomic wedding settings migration", () => {
  it("reads the profile, nickname, and journey as one exact snapshot", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const result = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.get_wedding_settings_snapshot('${USER_ID}'::uuid) AS value
      `);

      expect(result.rows[0]?.value).toMatchObject({
        user_id: USER_ID,
        couple_id: COUPLE_ID,
        name: "기존 이름",
        community_nickname: "기존 별명",
        role: "bride",
        wedding_date: "2027-05-01",
        venue: "기존 예식장",
        total_budget: 30_000_000,
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("updates only profile identity fields without touching the journey", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const result = await patchSettings(db, {
        name: "새 이름",
        nameProvided: true,
        expectedName: "기존 이름",
        communityNickname: "새 별명",
        communityNicknameProvided: true,
        expectedCommunityNickname: "기존 별명",
      });

      expect(result.rows[0]?.value).toMatchObject({
        name: "새 이름",
        community_nickname: "새 별명",
        wedding_date: "2027-05-01",
        venue: "기존 예식장",
        total_budget: 30_000_000,
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("updates a solo profile name without silently changing its independent nickname", async () => {
    const db = await createDatabase();
    try {
      await db.query("UPDATE public.profiles SET couple_id = NULL WHERE id = $1", [USER_ID]);
      await asService(db);
      const result = await patchSettings(db, {
        expectedCoupleId: null,
        name: "독립 이름",
        nameProvided: true,
        expectedName: "기존 이름",
      });

      expect(result.rows[0]?.value).toMatchObject({
        couple_id: null,
        name: "독립 이름",
        community_nickname: "기존 별명",
        wedding_date: null,
        venue: null,
        total_budget: null,
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("keeps a default-looking nickname independent when only the profile name changes", async () => {
    const db = await createDatabase();
    try {
      await db.query(
        "UPDATE public.community_profiles SET nickname = '기존 이름' WHERE user_id = $1",
        [USER_ID],
      );
      await asService(db);
      const result = await patchSettings(db, {
        name: "새 실명",
        nameProvided: true,
        expectedName: "기존 이름",
      });

      expect(result.rows[0]?.value).toMatchObject({
        name: "새 실명",
        community_nickname: "기존 이름",
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("returns a missing nickname as null, preserves absence on name-only writes, and creates it only when explicit", async () => {
    const db = await createDatabase();
    try {
      await db.query("DELETE FROM public.community_profiles WHERE user_id = $1", [USER_ID]);
      await asService(db);

      const before = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.get_wedding_settings_snapshot('${USER_ID}'::uuid) AS value
      `);
      expect(before.rows[0]?.value).toMatchObject({ community_nickname: null });

      const nameOnly = await patchSettings(db, {
        name: "별명 없는 이름",
        nameProvided: true,
        expectedName: "기존 이름",
      });
      expect(nameOnly.rows[0]?.value).toMatchObject({
        name: "별명 없는 이름",
        community_nickname: null,
      });

      const explicitNickname = await patchSettings(db, {
        communityNickname: "새로 만든 별명",
        communityNicknameProvided: true,
        expectedCommunityNickname: null,
      });
      expect(explicitNickname.rows[0]?.value).toMatchObject({
        name: "별명 없는 이름",
        community_nickname: "새로 만든 별명",
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("updates only the community nickname without changing the profile name", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const result = await patchSettings(db, {
        communityNickname: "독립 별명",
        communityNicknameProvided: true,
        expectedCommunityNickname: "기존 별명",
      });

      expect(result.rows[0]?.value).toMatchObject({
        name: "기존 이름",
        community_nickname: "독립 별명",
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("updates only one journey field and preserves zero instead of clearing it", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const result = await patchSettings(db, {
        totalBudget: 0,
        totalBudgetProvided: true,
        expectedTotalBudget: 30_000_000,
      });

      expect(result.rows[0]?.value).toMatchObject({
        name: "기존 이름",
        community_nickname: "기존 별명",
        wedding_date: "2027-05-01",
        venue: "기존 예식장",
        total_budget: 0,
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("commits all fields together and supports explicit null clears", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      const result = await patchSettings(db, {
        name: "새 이름",
        nameProvided: true,
        expectedName: "기존 이름",
        communityNickname: "새 별명",
        communityNicknameProvided: true,
        expectedCommunityNickname: "기존 별명",
        weddingDate: null,
        weddingDateProvided: true,
        expectedWeddingDate: "2027-05-01",
        venue: null,
        venueProvided: true,
        expectedVenue: "기존 예식장",
        totalBudget: null,
        totalBudgetProvided: true,
        expectedTotalBudget: 30_000_000,
      });

      expect(result.rows[0]?.value).toMatchObject({
        name: "새 이름",
        community_nickname: "새 별명",
        wedding_date: null,
        venue: null,
        total_budget: null,
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back profile and nickname when the later journey write fails", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.fail_wedding_settings_journey_update()
        RETURNS trigger LANGUAGE plpgsql AS $trigger$
        BEGIN
          RAISE EXCEPTION 'forced_journey_failure';
        END
        $trigger$;
        CREATE TRIGGER fail_wedding_settings_journey_update
          BEFORE UPDATE ON public.wedding_journeys
          FOR EACH ROW EXECUTE FUNCTION public.fail_wedding_settings_journey_update();
      `);
      await asService(db);
      await expect(patchSettings(db, {
        name: "롤백 이름",
        nameProvided: true,
        expectedName: "기존 이름",
        communityNickname: "롤백 별명",
        communityNicknameProvided: true,
        expectedCommunityNickname: "기존 별명",
        venue: "실패 예식장",
        venueProvided: true,
        expectedVenue: "기존 예식장",
      })).rejects.toThrow(/forced_journey_failure/);

      await resetRole(db);
      const state = await db.query<{ name: string; nickname: string; venue: string }>(`
        SELECT profile.name, community.nickname, journey.venue
        FROM public.profiles AS profile
        JOIN public.community_profiles AS community ON community.user_id = profile.id
        JOIN public.wedding_journeys AS journey ON journey.couple_id = profile.couple_id
        WHERE profile.id = '${USER_ID}'
      `);
      expect(state.rows[0]).toEqual({
        name: "기존 이름",
        nickname: "기존 별명",
        venue: "기존 예식장",
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a stale field without overwriting the newer value", async () => {
    const db = await createDatabase();
    try {
      await db.query("UPDATE public.wedding_journeys SET venue = '다른 기기 변경' WHERE couple_id = $1", [COUPLE_ID]);
      await asService(db);

      await expect(patchSettings(db, {
        venue: "내 변경",
        venueProvided: true,
        expectedVenue: "기존 예식장",
      })).rejects.toThrow(/WEDDING_SETTINGS_CONFLICT/);

      await resetRole(db);
      const state = await db.query<{ venue: string }>(
        "SELECT venue FROM public.wedding_journeys WHERE couple_id = $1",
        [COUPLE_ID],
      );
      expect(state.rows[0]?.venue).toBe("다른 기기 변경");
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a changed couple membership before any field write", async () => {
    const db = await createDatabase();
    try {
      await db.query("UPDATE public.profiles SET couple_id = $1 WHERE id = $2", [OTHER_COUPLE_ID, USER_ID]);
      await asService(db);

      await expect(patchSettings(db, {
        name: "쓰면 안 됨",
        nameProvided: true,
        expectedName: "기존 이름",
      })).rejects.toThrow(/WEDDING_SETTINGS_COUPLE_CHANGED/);
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("checks only the fields being changed and does not stale-overwrite other fields", async () => {
    const db = await createDatabase();
    try {
      await db.query("UPDATE public.wedding_journeys SET venue = '다른 기기 변경' WHERE couple_id = $1", [COUPLE_ID]);
      await asService(db);
      const result = await patchSettings(db, {
        totalBudget: 40_000_000,
        totalBudgetProvided: true,
        expectedTotalBudget: 30_000_000,
      });

      expect(result.rows[0]?.value).toMatchObject({
        venue: "다른 기기 변경",
        total_budget: 40_000_000,
      });
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a provided no-op field instead of touching its timestamps", async () => {
    const db = await createDatabase();
    try {
      await asService(db);
      await expect(patchSettings(db, {
        venue: "기존 예식장",
        venueProvided: true,
        expectedVenue: "기존 예식장",
      })).rejects.toThrow(/WEDDING_SETTINGS_INVALID_NOOP/);
    } finally {
      await resetRole(db).catch(() => undefined);
      await db.close();
    }
  });

  it("exposes both functions only to the service role", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        anon_get: boolean;
        auth_get: boolean;
        service_get: boolean;
        anon_patch: boolean;
        auth_patch: boolean;
        service_patch: boolean;
      }>(`
        SELECT
          has_function_privilege('anon', 'public.get_wedding_settings_snapshot(uuid)', 'EXECUTE') AS anon_get,
          has_function_privilege('authenticated', 'public.get_wedding_settings_snapshot(uuid)', 'EXECUTE') AS auth_get,
          has_function_privilege('service_role', 'public.get_wedding_settings_snapshot(uuid)', 'EXECUTE') AS service_get,
          has_function_privilege(
            'anon',
            'public.patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)',
            'EXECUTE'
          ) AS anon_patch,
          has_function_privilege(
            'authenticated',
            'public.patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)',
            'EXECUTE'
          ) AS auth_patch,
          has_function_privilege(
            'service_role',
            'public.patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)',
            'EXECUTE'
          ) AS service_patch
      `);
      expect(privileges.rows[0]).toEqual({
        anon_get: false,
        auth_get: false,
        service_get: true,
        anon_patch: false,
        auth_patch: false,
        service_patch: true,
      });
    } finally {
      await db.close();
    }
  });

  it("locks profile, community nickname, and journey rows in one stable order", async () => {
    const db = await createDatabase();
    try {
      const definition = await db.query<{ source: string }>(`
        SELECT pg_get_functiondef(
          'public.patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)'::regprocedure
        ) AS source
      `);
      const source = definition.rows[0]?.source ?? "";
      const profileLock = source.indexOf("FROM public.profiles");
      const communityLock = source.indexOf("FROM public.community_profiles");
      const journeyLock = source.indexOf("FROM public.wedding_journeys");

      expect(profileLock).toBeGreaterThan(-1);
      expect(communityLock).toBeGreaterThan(profileLock);
      expect(journeyLock).toBeGreaterThan(communityLock);
      expect(source.match(/FOR UPDATE/g)?.length).toBeGreaterThanOrEqual(3);
    } finally {
      await db.close();
    }
  });
});
