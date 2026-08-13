// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(
    resolve(process.cwd(), `../../supabase/migrations/${name}`),
    "utf8",
  );
}

const checklistCollaborationSql = migration(
  "20260812180000_checklist_collaboration_approval.sql",
);
const situationProfileV2Sql = migration(
  "20260813103000_checklist_situation_profile_v2_gathering.sql",
);

const databases: PGlite[] = [];
const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";

function answersV1() {
  return {
    ceremony: "undecided",
    legalMarriage: "undecided",
    travel: "undecided",
    housing: "undecided",
    internationalMarriage: null,
    religiousCeremony: null,
    remarriage: null,
    childrenParticipating: null,
    accessibilitySupport: null,
    healthSupport: null,
    petParticipation: null,
    familyTradition: null,
  };
}

function profileV1() {
  return {
    version: 1,
    reviewedAt: "2026-08-13T01:00:00.000Z",
    answers: answersV1(),
    autoExcludedItemIds: [],
  };
}

function profileV2(gathering = "undecided") {
  return {
    ...profileV1(),
    version: 2,
    answers: { ...answersV1(), gathering },
  };
}

async function createDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;

    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid,
      onboarding_completed boolean NOT NULL DEFAULT true,
      onboarding_step integer NOT NULL DEFAULT 5,
      shared_chat_cleared_at timestamptz,
      private_chat_cleared_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE,
      wedding_date date,
      venue text,
      total_budget bigint,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      state_revision bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.couple_plan_change_requests (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      base_revision bigint NOT NULL DEFAULT 0,
      changes jsonb NOT NULL DEFAULT '{}'::jsonb,
      change_digest text NOT NULL DEFAULT repeat('a', 64),
      roster_fingerprint text NOT NULL DEFAULT repeat('b', 32),
      is_high_impact boolean NOT NULL DEFAULT true,
      required_count smallint NOT NULL DEFAULT 2,
      status text NOT NULL,
      applied_at timestamptz,
      applied_revision bigint,
      stale_at timestamptz,
      stale_reason text
    );
    CREATE FUNCTION public.is_current_couple_member(user_id uuid, target_couple uuid)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.couple_plan_change_digest(value jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE AS $$
      SELECT md5(value::text) || md5(value::text)
    $$;
    CREATE FUNCTION public.finalize_couple_plan_change_notifications_locked(
      request_id uuid, actor_id uuid, event_kind text
    ) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    CREATE FUNCTION public.couple_plan_change_has_unsafe_display_text(value text)
    RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT value IS NULL OR value ~ '[[:cntrl:]]'
    $$;
    CREATE FUNCTION public.couple_plan_change_is_high_impact(
      date, date, text, text, bigint, bigint, jsonb, jsonb
    ) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.couple_plan_change_exact_high_summary(
      date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
    ) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'legacy'::text $$;
  `);
  await db.exec(checklistCollaborationSql);
  await db.exec(situationProfileV2Sql);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("checklist situation profile v2 gathering migration", () => {
  it("is rerunnable, keeps helpers private, and preserves reset/digest boundaries", async () => {
    const db = await createDatabase();
    const beforeDigest = await db.query<{ digest: string }>(
      "SELECT public.couple_plan_change_digest($1::jsonb) AS digest",
      [JSON.stringify({ progress_patch: { marker: "stable" } })],
    );
    await db.exec(situationProfileV2Sql);
    const result = await db.query<{
      priorProjection: string | null;
      priorSummary: string | null;
      resetFunction: string | null;
      serviceNormalizerExecute: boolean;
      authNormalizerExecute: boolean;
      digest: string;
    }>(`
      SELECT
        to_regprocedure(
          'public.couple_plan_checklist_projection_before_gathering_v2(jsonb)'
        )::text AS "priorProjection",
        to_regprocedure(
          'public.couple_plan_change_exact_high_summary_before_gathering_v2(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
        )::text AS "priorSummary",
        to_regprocedure('public.reset_current_couple_membership()')::text
          AS "resetFunction",
        has_function_privilege(
          'service_role',
          'public.couple_plan_checklist_profile_normalize_v2(jsonb)',
          'EXECUTE'
        ) AS "serviceNormalizerExecute",
        has_function_privilege(
          'authenticated',
          'public.couple_plan_checklist_profile_normalize_v2(jsonb)',
          'EXECUTE'
        ) AS "authNormalizerExecute",
        public.couple_plan_change_digest($1::jsonb) AS digest
    `, [JSON.stringify({ progress_patch: { marker: "stable" } })]);

    expect(result.rows[0]).toEqual({
      priorProjection:
        "couple_plan_checklist_projection_before_gathering_v2(jsonb)",
      priorSummary:
        "couple_plan_change_exact_high_summary_before_gathering_v2(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)",
      resetFunction: "reset_current_couple_membership()",
      serviceNormalizerExecute: false,
      authNormalizerExecute: false,
      digest: beforeDigest.rows[0].digest,
    });
  });

  it("accepts exact v1/v2 profiles and treats v1 as v2 gathering=undecided", async () => {
    const db = await createDatabase();
    const v1 = profileV1();
    const v2 = profileV2();
    const result = await db.query<{
      v1Valid: boolean;
      v2Valid: boolean;
      normalizedV1: Record<string, unknown>;
      semanticHighImpact: boolean;
    }>(`
      SELECT
        public.couple_plan_checklist_profile_is_valid($1::jsonb) AS "v1Valid",
        public.couple_plan_checklist_profile_is_valid($2::jsonb) AS "v2Valid",
        public.couple_plan_checklist_profile_normalize_v2($1::jsonb)
          AS "normalizedV1",
        public.couple_plan_change_is_high_impact(
          NULL, NULL, NULL, NULL, NULL, NULL,
          jsonb_build_object('__checklist_profile', $1::jsonb),
          jsonb_build_object('__checklist_profile', $2::jsonb)
        ) AS "semanticHighImpact"
    `, [JSON.stringify(v1), JSON.stringify(v2)]);

    expect(result.rows[0]).toEqual({
      v1Valid: true,
      v2Valid: true,
      normalizedV1: v2,
      semanticHighImpact: false,
    });
  });

  it("rejects wrong-version answer shapes without accepting missing or extra fields", async () => {
    const db = await createDatabase();
    const v1WithGathering = {
      ...profileV1(),
      answers: { ...answersV1(), gathering: "undecided" },
    };
    const v2MissingGatheringAnswers = Object.fromEntries(
      Object.entries(profileV2().answers).filter(
        ([key]) => key !== "gathering",
      ),
    );
    const v2MissingGathering = {
      ...profileV2(),
      answers: v2MissingGatheringAnswers,
    };
    const v2WithExtra = {
      ...profileV2(),
      answers: { ...profileV2().answers, receptionGuestCount: 30 },
    };
    const v2Malformed = profileV2("party");
    const result = await db.query<{
      v1WithGathering: boolean;
      v2MissingGathering: boolean;
      v2WithExtra: boolean;
      v2Malformed: boolean;
    }>(`
      SELECT
        public.couple_plan_checklist_profile_is_valid($1::jsonb)
          AS "v1WithGathering",
        public.couple_plan_checklist_profile_is_valid($2::jsonb)
          AS "v2MissingGathering",
        public.couple_plan_checklist_profile_is_valid($3::jsonb)
          AS "v2WithExtra",
        public.couple_plan_checklist_profile_is_valid($4::jsonb)
          AS "v2Malformed"
    `, [
      JSON.stringify(v1WithGathering),
      JSON.stringify(v2MissingGathering),
      JSON.stringify(v2WithExtra),
      JSON.stringify(v2Malformed),
    ]);

    expect(result.rows[0]).toEqual({
      v1WithGathering: false,
      v2MissingGathering: false,
      v2WithExtra: false,
      v2Malformed: false,
    });
  });

  it("rejects a v2-to-v1 downgrade at the exact high-impact receipt boundary", async () => {
    const db = await createDatabase();
    await expect(db.query(`
      SELECT public.couple_plan_change_exact_high_summary(
        NULL, NULL, NULL, NULL, NULL, NULL,
        jsonb_build_object('__checklist_profile', $1::jsonb),
        jsonb_build_object('__checklist_profile', $2::jsonb),
        $3::uuid, $4::uuid
      )
    `, [
      JSON.stringify(profileV2("reception")),
      JSON.stringify(profileV1()),
      BRIDE_ID,
      GROOM_ID,
    ])).rejects.toThrow(/COUPLE_PLAN_CHANGE_CHECKLIST_PROFILE_DOWNGRADE/);
  });

  it("publishes the exact old-to-new gathering choice in the high-impact receipt", async () => {
    const db = await createDatabase();
    const before = profileV2("undecided");
    const after = {
      ...profileV2("family_meal"),
      reviewedAt: "2026-08-13T01:05:00.000Z",
    };
    const result = await db.query<{ highImpact: boolean; summary: string }>(`
      SELECT
        public.couple_plan_change_is_high_impact(
          NULL, NULL, NULL, NULL, NULL, NULL,
          jsonb_build_object('__checklist_profile', $1::jsonb),
          jsonb_build_object('__checklist_profile', $2::jsonb)
        ) AS "highImpact",
        public.couple_plan_change_exact_high_summary(
          NULL, NULL, NULL, NULL, NULL, NULL,
          jsonb_build_object('__checklist_profile', $1::jsonb),
          jsonb_build_object('__checklist_profile', $2::jsonb),
          $3::uuid, $4::uuid
        ) AS summary
    `, [JSON.stringify(before), JSON.stringify(after), BRIDE_ID, GROOM_ID]);

    expect(result.rows[0].highImpact).toBe(true);
    expect(result.rows[0].summary).toContain(
      "축하 식사·모임 아직 미정→가족 식사만",
    );
    expect(result.rows[0].summary.length).toBeLessThanOrEqual(240);
  });
});
