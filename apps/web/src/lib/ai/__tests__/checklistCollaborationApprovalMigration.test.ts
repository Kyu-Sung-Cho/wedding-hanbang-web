// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATEGORY_CHECKLISTS,
  CHECKLIST_ITEM_GUIDANCE,
} from "@hanbang/shared/constants";
import { applyPlanningChecklistProfile } from "@hanbang/shared/utils";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812180000_checklist_collaboration_approval.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const FOREIGN_ID = "10000000-0000-4000-8000-000000000003";

const databases: PGlite[] = [];

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
    RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT md5(value::text) || md5(value::text) $$;
    CREATE FUNCTION public.finalize_couple_plan_change_notifications_locked(
      request_id uuid, actor_id uuid, event_kind text
    ) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;

    CREATE FUNCTION public.couple_plan_change_has_unsafe_display_text(value text)
    RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT value IS NULL OR value ~ '[[:cntrl:]]'
    $$;

    CREATE FUNCTION public.couple_plan_change_is_high_impact(
      date, date, text, text, bigint, bigint, jsonb, jsonb
    )
    RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

    CREATE FUNCTION public.couple_plan_change_exact_high_summary(
      date, date, text, text, bigint, bigint, jsonb, jsonb, uuid, uuid
    )
    RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '기존 고영향 변경'::text $$;
  `);
  await db.exec(migrationSql);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

function category(options: {
  status?: string;
  assignee?: unknown;
  note?: string;
  state?: string;
} = {}) {
  return {
    category: "venue",
    label: "예식장",
    status: options.status ?? "not_started",
    checklist: [
      {
        id: "venue_01",
        label: "예식장 형태 정하기",
        done: false,
        state: options.state ?? "todo",
        ...(options.assignee === undefined ? {} : { assignee: options.assignee }),
        ...(options.note === undefined ? {} : { note: options.note }),
      },
    ],
  };
}

async function isHighImpact(
  db: PGlite,
  oldProgress: Record<string, unknown>,
  newProgress: Record<string, unknown>,
) {
  const result = await db.query<{ result: boolean }>(
    `SELECT public.couple_plan_change_is_high_impact(
       NULL, NULL, NULL, NULL, NULL, NULL, $1::jsonb, $2::jsonb
     ) AS result`,
    [JSON.stringify(oldProgress), JSON.stringify(newProgress)],
  );
  return result.rows[0].result;
}

async function summary(
  db: PGlite,
  oldProgress: Record<string, unknown>,
  newProgress: Record<string, unknown>,
) {
  const result = await db.query<{ result: string }>(
    `SELECT public.couple_plan_change_exact_high_summary(
       NULL, NULL, NULL, NULL, NULL, NULL,
       $1::jsonb, $2::jsonb, $3::uuid, $4::uuid
     ) AS result`,
    [JSON.stringify(oldProgress), JSON.stringify(newProgress), BRIDE_ID, GROOM_ID],
  );
  return result.rows[0].result;
}

function profile(
  overrides: Partial<{
    reviewedAt: string;
    answers: Record<string, unknown>;
    autoExcludedItemIds: string[];
  }> = {},
) {
  return {
    version: 1,
    reviewedAt: overrides.reviewedAt ?? "2026-08-12T09:00:00.000Z",
    answers: {
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
      ...(overrides.answers ?? {}),
    },
    autoExcludedItemIds: overrides.autoExcludedItemIds ?? [],
  };
}

describe("checklist collaboration approval migration", () => {
  it("preserves the wrapper chain and keeps helper privileges private", async () => {
    const db = await createDatabase();
    await db.exec(migrationSql);
    const result = await db.query<{
      previousClassifier: string | null;
      previousSummary: string | null;
      authProjectionExecute: boolean;
      serviceProjectionExecute: boolean;
    }>(`
      SELECT
        to_regprocedure(
          'public.couple_plan_change_is_high_impact_before_checklist(date,date,text,text,bigint,bigint,jsonb,jsonb)'
        )::text AS "previousClassifier",
        to_regprocedure(
          'public.couple_plan_change_exact_high_summary_before_checklist(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)'
        )::text AS "previousSummary",
        has_function_privilege(
          'authenticated',
          'public.couple_plan_checklist_collaboration_projection(jsonb)',
          'EXECUTE'
        ) AS "authProjectionExecute",
        has_function_privilege(
          'service_role',
          'public.couple_plan_checklist_collaboration_projection(jsonb)',
          'EXECUTE'
        ) AS "serviceProjectionExecute"
    `);

    expect(result.rows[0]).toEqual({
      previousClassifier:
        "couple_plan_change_is_high_impact_before_checklist(date,date,text,text,bigint,bigint,jsonb,jsonb)",
      previousSummary:
        "couple_plan_change_exact_high_summary_before_checklist(date,date,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)",
      authProjectionExecute: false,
      serviceProjectionExecute: false,
    });
    expect(migrationSql).not.toContain("session_replication_role");
  });

  it.each([
    ["partner", { kind: "member", profileId: GROOM_ID }],
    ["couple", { kind: "couple" }],
    ["external", { kind: "external", label: "웨딩 플래너" }],
  ])("classifies a nested %s assignee delta and emits a UUID-free exact receipt", async (_label, assignee) => {
    const db = await createDatabase();
    const before = { venue: category() };
    const after = { venue: category({ assignee }) };

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("예식장");
    expect(receipt).toContain("예식장 형태 정하기");
    expect(receipt).toContain("담당");
    expect(receipt).not.toContain(BRIDE_ID);
    expect(receipt).not.toContain(GROOM_ID);
  });

  it("normalizes absent and null assignees but protects real assignment transitions", async () => {
    const db = await createDatabase();
    const absent = { venue: category() };
    const explicitNull = { venue: category({ assignee: null }) };
    const partner = {
      venue: category({
        assignee: { kind: "member", profileId: GROOM_ID },
      }),
    };

    await expect(isHighImpact(db, absent, explicitNull)).resolves.toBe(false);
    await expect(isHighImpact(db, explicitNull, partner)).resolves.toBe(true);
    const assigned = await summary(db, explicitNull, partner);
    expect(assigned).toContain("미정 → 신랑");
    expect(assigned).not.toContain(GROOM_ID);

    await expect(isHighImpact(db, partner, explicitNull)).resolves.toBe(true);
    const cleared = await summary(db, partner, explicitNull);
    expect(cleared).toContain("신랑 → 미정");
    expect(cleared).not.toContain(GROOM_ID);
  });

  it("treats a legacy completed flag as semantically equal during the first assignment", async () => {
    const db = await createDatabase();
    const before = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "completed",
        checklist: [{ id: "venue_01", completed: true }],
      },
    };
    const after = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "completed",
        checklist: [{
          id: "venue_01",
          label: "예식장 형태 정하기",
          done: true,
          state: "completed",
          assignee: { kind: "member", profileId: GROOM_ID },
        }],
      },
    };

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("venue_01 → 예식장 형태 정하기 문구 변경");
    expect(receipt).toContain("담당: 미정 → 신랑");
    expect(receipt).not.toContain(GROOM_ID);
  });

  it("discloses a completed-to-in-progress repair caused only by newly materialized template work", async () => {
    const db = await createDatabase();
    const before = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "completed",
        checklist: [{ id: "venue_01", completed: true }],
      },
    };
    const repaired = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "in_progress",
        checklist: [
          {
            id: "venue_01",
            label: "예식장 형태 정하기",
            done: true,
            state: "completed",
            assignee: { kind: "member", profileId: GROOM_ID },
          },
          {
            id: "venue_02",
            label: "비교할 장소 후보 정리",
            done: false,
            state: "todo",
          },
        ],
      },
    };

    const receipt = await summary(db, before, repaired);
    expect(receipt).toContain("담당: 미정 → 신랑");
    expect(receipt).toContain("비교할 장소 후보 정리 추가");
    expect(receipt).toContain("상태 보정: 완료 → 진행 중");
    expect(receipt).toContain("새 항목 1개 반영");

    const staleStatus = {
      venue: {
        ...repaired.venue,
        checklist: repaired.venue.checklist.slice(0, 1),
      },
    };
    await expect(summary(db, before, staleStatus)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/,
    );

    const staleOldEvidence = {
      venue: {
        ...before.venue,
        checklist: [{ id: "venue_01", completed: false }],
      },
    };
    await expect(summary(db, staleOldEvidence, repaired)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/,
    );

    const venueTemplate = CATEGORY_CHECKLISTS.find(
      (categoryTemplate) => categoryTemplate.key === "venue",
    );
    expect(venueTemplate).toBeDefined();
    const realTemplateRepair = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "in_progress",
        checklist: venueTemplate!.items.map((item, index) => ({
          ...item,
          done: index === 0,
          state: index === 0 ? "completed" : "todo",
          ...(index === 0
            ? { assignee: { kind: "member", profileId: GROOM_ID } }
            : {}),
        })),
      },
    };
    const compactReceipt = await summary(db, before, realTemplateRepair);
    expect(compactReceipt).toContain("담당 결정1건");
    expect(compactReceipt).toContain("목록 추가7/문구1");
    expect(compactReceipt).toContain("상태 보정1건");
    expect(compactReceipt).toContain("상세 확인");
    expect(compactReceipt.length).toBeLessThanOrEqual(240);
  });

  it("materializes a status-only legacy completion as todo work for its first protected assignment", async () => {
    const db = await createDatabase();
    const venueTemplate = CATEGORY_CHECKLISTS.find(
      (categoryTemplate) => categoryTemplate.key === "venue",
    );
    expect(venueTemplate).toBeDefined();
    const before = {
      venue: {
        category: "venue",
        label: venueTemplate!.label,
        status: "completed",
      },
    };
    const materialized = {
      venue: {
        category: "venue",
        label: venueTemplate!.label,
        status: "not_started",
        checklist: venueTemplate!.items.map((item, index) => ({
          ...item,
          done: false,
          state: "todo",
          ...(index === 0
            ? { assignee: { kind: "member", profileId: GROOM_ID } }
            : {}),
        })),
      },
    };

    await expect(isHighImpact(db, before, materialized)).resolves.toBe(true);
    const receipt = await summary(db, before, materialized);
    expect(receipt).toContain("담당 결정1건");
    expect(receipt).toContain("목록 추가8/문구0");
    expect(receipt).toContain("상태 보정1건");
    expect(receipt).toContain("완료 → 시작 전");
    expect(receipt.length).toBeLessThanOrEqual(240);

    await expect(summary(db, before, {
      venue: { ...materialized.venue, status: "in_progress" },
    })).rejects.toThrow(/COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/);
    await expect(isHighImpact(db, before, {
      venue: {
        ...materialized.venue,
        checklist: materialized.venue.checklist.map((item) => Object.fromEntries(
          Object.entries(item).filter(([key]) => key !== "assignee"),
        )),
      },
    })).resolves.toBe(false);
    await expect(summary(db, {
      venue: { ...before.venue, checklist: null },
    }, materialized)).rejects.toThrow(/COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_DELTA/);
  });

  it("accepts the first not-applicable decision on a legacy checklist without hiding materialization", async () => {
    const db = await createDatabase();
    const before = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "not_started",
        checklist: [{ id: "venue_01", completed: false }],
      },
    };
    const after = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "not_applicable",
        checklist: [{
          id: "venue_01",
          label: "예식장 형태 정하기",
          done: false,
          state: "not_applicable",
        }],
      },
    };

    const receipt = await summary(db, before, after);
    expect(receipt).toContain("예식장 → 해당 없음");
    expect(receipt).toContain("항목 1개 제외/0개 복원");
    expect(receipt).toContain("venue_01 → 예식장 형태 정하기 문구 변경");

    const hiddenNote = {
      venue: {
        ...after.venue,
        checklist: [{ ...after.venue.checklist[0], note: "숨은 변경" }],
      },
    };
    await expect(summary(db, before, hiddenNote)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/,
    );
  });

  it("allows unchanged API-limit labels through a protected mutation using stable receipt IDs", async () => {
    const db = await createDatabase();
    const categoryLabel = "분".repeat(200);
    const itemLabel = "항".repeat(400);
    const before = {
      venue: {
        category: "venue",
        label: categoryLabel,
        status: "not_started",
        checklist: [{
          id: "venue_01",
          label: itemLabel,
          done: false,
          state: "todo",
          assignee: { kind: "member", profileId: GROOM_ID },
        }],
      },
    };
    const after = {
      venue: {
        ...before.venue,
        checklist: [{ ...before.venue.checklist[0], assignee: null }],
      },
    };

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("venue · venue_01 담당: 신랑 → 미정");
    expect(receipt).not.toContain(categoryLabel);
    expect(receipt).not.toContain(itemLabel);
    expect(receipt.length).toBeLessThanOrEqual(240);

    const undisclosableRename = {
      venue: {
        ...after.venue,
        checklist: [{
          ...after.venue.checklist[0],
          label: "새".repeat(121),
          assignee: { kind: "member", profileId: GROOM_ID },
        }],
      },
    };
    await expect(summary(db, after, undisclosableRename)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_LABEL/,
    );
  });

  it("classifies whole-category not-applicable and discloses added review evidence", async () => {
    const db = await createDatabase();
    const before = { venue: category() };
    const after = {
      venue: {
        ...category({ status: "not_applicable" }),
        checklistReviewedAt: "2026-08-12T09:00:00.000Z",
        checklistReviewedByProfileId: BRIDE_ID,
        checklistReviewSource: "manual",
      },
    };

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("예식장");
    expect(receipt).toContain("해당 없음");
    expect(receipt).toContain("검토 기록 1개 분야");
  });

  it("accepts a status-only whole-category exclusion for a legacy category", async () => {
    const db = await createDatabase();
    const before = {
      venue: { category: "venue", label: "예식장", status: "not_started" },
    };
    const after = {
      venue: { category: "venue", label: "예식장", status: "not_applicable" },
    };

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    await expect(summary(db, before, after)).resolves.toContain("해당 없음");
  });

  it("classifies manual item-level exclusion and restoration with an exact receipt", async () => {
    const db = await createDatabase();
    const before = { venue: category({ state: "todo" }) };
    const excluded = { venue: category({ state: "not_applicable" }) };

    await expect(isHighImpact(db, before, excluded)).resolves.toBe(true);
    await expect(summary(db, before, excluded)).resolves.toContain(
      "항목 1개 제외/0개 복원 (예식장·예식장 형태 정하기)",
    );
    await expect(isHighImpact(db, excluded, before)).resolves.toBe(true);
    await expect(summary(db, excluded, before)).resolves.toContain(
      "항목 0개 제외/1개 복원 (예식장·예식장 형태 정하기)",
    );
  });

  it("discloses both category and last-item applicability transitions", async () => {
    const db = await createDatabase();
    const before = { venue: category({ status: "not_started", state: "todo" }) };
    const excluded = {
      venue: category({ status: "not_applicable", state: "not_applicable" }),
    };

    const excludeReceipt = await summary(db, before, excluded);
    expect(excludeReceipt).toContain("예식장 → 해당 없음");
    expect(excludeReceipt).toContain("항목 1개 제외/0개 복원");
    const restoreReceipt = await summary(db, excluded, before);
    expect(restoreReceipt).toContain("예식장 → 준비 목록");
    expect(restoreReceipt).toContain("항목 0개 제외/1개 복원");
  });

  it("holds an item-only situation-profile scope change behind the exact boundary", async () => {
    const db = await createDatabase();
    const before = { venue: category({ state: "todo" }) };
    const nextProfile = profile({
      answers: { religiousCeremony: false },
      autoExcludedItemIds: ["venue_01"],
    });
    const after = {
      __checklist_profile: nextProfile,
      venue: category({ state: "not_applicable" }),
    };

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("상황 변경:");
    expect(receipt).toContain("종교 예식 미정→아님");
    expect(receipt).toContain("자동 제외 총1개");
    expect(receipt).toContain(
      "항목 제외1[예식장·예식장 형태 정하기]/복원0",
    );
    expect(receipt).toContain("분야 제외0/복원0");
    expect(receipt).not.toContain("venue_01");
  });

  it("rejects a malformed or mismatched profile even for item-only scope", async () => {
    const db = await createDatabase();
    const before = { venue: category({ state: "todo" }) };
    const malformed = {
      __checklist_profile: {
        ...profile({ autoExcludedItemIds: ["venue_01"] }),
        answers: { ceremony: "no" },
      },
      venue: category({ state: "not_applicable" }),
    };
    await expect(isHighImpact(db, before, malformed)).resolves.toBe(true);
    await expect(summary(db, before, malformed)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE/,
    );

    const mismatched = {
      __checklist_profile: profile({ autoExcludedItemIds: [] }),
      venue: category({ state: "not_applicable" }),
    };
    await expect(summary(db, before, mismatched)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE_DELTA/,
    );

    const alreadyManual = { venue: category({ state: "not_applicable" }) };
    const hijacked = {
      ...alreadyManual,
      __checklist_profile: profile({ autoExcludedItemIds: ["venue_01"] }),
    };
    await expect(summary(db, alreadyManual, hijacked)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE_DELTA/,
    );
  });

  it("supports a profile-only answer review with a complete deterministic receipt", async () => {
    const db = await createDatabase();
    const before = { venue: category() };
    const after = {
      ...before,
      __checklist_profile: profile({ answers: { travel: "domestic" } }),
    };

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("여행 미정→국내");
    expect(receipt).toContain("자동 제외 총0개");
    expect(receipt).toContain("항목 제외0/복원0");
  });

  it("repairs an orphaned retired auto-exclusion but keeps backed ownership fail-closed", async () => {
    const db = await createDatabase();
    const orphanProfile = profile({
      reviewedAt: "2026-08-10T00:00:00.000Z",
      autoExcludedItemIds: ["retired_unknown_item"],
    });
    const repairedProfile = profile({
      reviewedAt: "2026-08-12T00:00:00.000Z",
      autoExcludedItemIds: [],
    });
    await expect(summary(
      db,
      { __checklist_profile: orphanProfile },
      { __checklist_profile: repairedProfile },
    )).resolves.toContain("자동 제외 총0개");

    const backed = {
      __checklist_profile: orphanProfile,
      retired: {
        category: "retired",
        status: "not_applicable",
        checklist: [{
          id: "retired_unknown_item",
          label: "Retired item",
          done: false,
          state: "not_applicable",
        }],
      },
    };
    await expect(summary(
      db,
      backed,
      { ...backed, __checklist_profile: repairedProfile },
    )).rejects.toThrow(/COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE_DELTA/);

    const mixedProfile = profile({
      reviewedAt: "2026-08-10T00:00:00.000Z",
      answers: { travel: "domestic" },
      autoExcludedItemIds: ["retired_unknown_item", "venue_01"],
    });
    const mixedBefore = {
      __checklist_profile: mixedProfile,
      venue: category({ state: "not_applicable" }),
    };
    const keepBacked = {
      ...mixedBefore,
      __checklist_profile: profile({
        reviewedAt: "2026-08-12T00:00:00.000Z",
        answers: { travel: "domestic" },
        autoExcludedItemIds: ["venue_01"],
      }),
    };
    await expect(summary(db, mixedBefore, keepBacked)).resolves.toContain(
      "자동 제외 총1개",
    );
    await expect(summary(
      db,
      mixedBefore,
      { ...mixedBefore, __checklist_profile: repairedProfile },
    )).rejects.toThrow(/COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_PROFILE_DELTA/);
    await expect(summary(
      db,
      mixedBefore,
      {
        __checklist_profile: {
          ...repairedProfile,
          answers: { ...repairedProfile.answers, travel: "domestic" },
        },
        venue: category({ state: "todo" }),
      },
    )).resolves.toContain("자동 제외 총0개");
  });

  it("uses a bounded exact-count receipt when situation detail moves to the structured proposal", async () => {
    const db = await createDatabase();
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const autoExcludedItemIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const key = `scope_${index}`;
      const id = `scope_item_${index}`;
      const saved = {
        category: key,
        label: `영향 분야 ${index + 1} ${"가".repeat(25)}`,
        status: "not_started",
        checklist: [{
          id,
          label: `실제 제외 항목 ${index + 1} ${"나".repeat(75)}`,
          done: false,
          state: "todo",
        }],
      };
      before[key] = saved;
      after[key] = {
        ...saved,
        checklist: [{ ...saved.checklist[0], state: "not_applicable" }],
      };
      autoExcludedItemIds.push(id);
    }
    after.__checklist_profile = profile({
      answers: { religiousCeremony: false },
      autoExcludedItemIds,
    });

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("종교 예식 미정→아님");
    expect(receipt).toContain("분야 제외0/복원0");
    expect(receipt).toContain("항목 제외4/복원0");
    expect(receipt).toContain("목록 추가0/문구0");
    expect(receipt).toContain("자동 제외4");
    expect(receipt).toContain("상세 확인");
    expect(receipt).not.toContain("실제 제외 항목");
    expect(receipt.length).toBeLessThanOrEqual(240);
  });

  it("accepts the real empty-progress ceremony=no patch with all 7 categories and 53 items disclosed by exact counts", async () => {
    const db = await createDatabase();
    const application = applyPlanningChecklistProfile(
      CATEGORY_CHECKLISTS,
      {},
      {
        version: 1,
        reviewedAt: "2026-08-12T09:00:00.000Z",
        answers: {
          ceremony: "no",
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
        },
        autoExcludedItemIds: [],
      },
      CHECKLIST_ITEM_GUIDANCE,
      BRIDE_ID,
    );

    expect(Object.keys(application.categoryProgressPatch)).toHaveLength(7);
    expect(application.excludedItemIds).toHaveLength(53);
    const receipt = await summary(db, {}, application.progressPatch);
    expect(receipt).toContain("예식 미정→안함");
    expect(receipt).toContain("분야 제외7/복원0");
    expect(receipt).toContain("항목 제외53/복원0");
    expect(receipt).toContain("목록 추가53/문구0");
    expect(receipt).toContain("검토 추가7/해제0");
    expect(receipt).toContain("자동 제외53");
    expect(receipt).toContain("상세 확인");
    expect(receipt.length).toBeLessThanOrEqual(240);
  });

  it("allows exact situation-review evidence removal but keeps manual evidence immutable", async () => {
    const db = await createDatabase();
    const previousProfile = profile({
      answers: { religiousCeremony: false },
      autoExcludedItemIds: ["venue_01"],
    });
    const reviewed = {
      __checklist_profile: previousProfile,
      venue: {
        ...category({ status: "not_applicable", state: "not_applicable" }),
        checklistReviewedAt: previousProfile.reviewedAt,
        checklistReviewedByProfileId: BRIDE_ID,
        checklistReviewSource: "situation_profile",
      },
    };
    const restored = {
      __checklist_profile: profile({
        reviewedAt: "2026-08-12T10:00:00.000Z",
      }),
      venue: category({ status: "not_started", state: "todo" }),
    };

    const receipt = await summary(db, reviewed, restored);
    expect(receipt).toContain("분야 제외0/복원1[예식장 → 준비 목록]");
    expect(receipt).toContain("항목 제외0/복원1");
    expect(receipt).toContain("검토 기록 추가0/해제1");

    const manualReviewed = {
      ...reviewed,
      venue: {
        ...reviewed.venue,
        checklistReviewSource: "manual",
      },
    };
    await expect(summary(db, manualReviewed, restored)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/,
    );
  });

  it("maps old items by stable ID while safely materializing new template defaults", async () => {
    const db = await createDatabase();
    const before = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "not_started",
        checklist: [
          {
            id: "venue_01",
            label: "예전 문구",
            done: false,
            dueDate: null,
            note: "",
          },
        ],
      },
    };
    const after = {
      venue: {
        category: "venue",
        label: "예식장",
        status: "not_started",
        checklist: [
          { id: "venue_00", label: "새 앞 항목", done: false, state: "todo" },
          {
            id: "venue_01",
            label: "업데이트된 문구",
            done: false,
            state: "todo",
            completedAt: null,
            completedByProfileId: null,
            assignee: { kind: "member", profileId: GROOM_ID },
          },
          { id: "venue_02", label: "새 뒤 항목", done: false, state: "todo" },
        ],
      },
    };

    const receipt = await summary(db, before, after);
    expect(receipt).toContain("목록 동기화: 추가 2개/문구 변경 1개");
    expect(receipt).toContain("새 앞 항목 추가");
    expect(receipt).toContain("새 뒤 항목 추가");
    expect(receipt).toContain("예전 문구 → 업데이트된 문구 문구 변경");
    expect(receipt).toContain("업데이트된 문구");
    expect(receipt).toContain("신랑");
  });

  it("rejects unsafe or undisclosably large materialization bundles", async () => {
    const db = await createDatabase();
    const before = { venue: category() };
    const unsafeCategory = category({
      assignee: { kind: "member", profileId: GROOM_ID },
    });
    const unsafe = {
      venue: {
        ...unsafeCategory,
        checklist: [{ ...unsafeCategory.checklist[0], label: "숨겨진\n문구" }],
      },
    };
    await expect(summary(db, before, unsafe)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_IDENTITY/,
    );

    const original = category().checklist[0];
    const oversized = {
      venue: {
        ...category(),
        checklist: [
          {
            ...original,
            assignee: { kind: "member", profileId: GROOM_ID },
          },
          ...Array.from({ length: 4 }, (_, index) => ({
            id: `venue_added_${index}`,
            label: `추가 항목 ${index + 1} ${"가".repeat(80)}`,
            done: false,
            state: "todo",
          })),
        ],
      },
    };
    await expect(summary(db, before, oversized)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_INVALID_SUMMARY_TOO_LONG/,
    );
  });

  it("rejects note/state changes hidden behind an assignee approval", async () => {
    const db = await createDatabase();
    const before = { venue: category() };
    const after = {
      venue: category({
        assignee: { kind: "member", profileId: GROOM_ID },
        note: "승인 화면에는 보이지 않는 메모",
        state: "in_progress",
      }),
    };

    await expect(summary(db, before, after)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/,
    );
  });

  it("rejects item reorder, duplicate IDs, and a new foreign roster member", async () => {
    const db = await createDatabase();
    const itemOne = category().checklist[0];
    const itemTwo = { ...itemOne, id: "venue_02", label: "후보 비교" };
    const before = {
      venue: { ...category(), checklist: [itemOne, itemTwo] },
    };
    const reordered = {
      venue: {
        ...category(),
        checklist: [itemTwo, { ...itemOne, assignee: { kind: "member", profileId: GROOM_ID } }],
      },
    };
    await expect(summary(db, before, reordered)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_IDENTITY/,
    );

    const duplicate = {
      venue: {
        ...category(),
        checklist: [itemOne, { ...itemOne, assignee: { kind: "couple" } }],
      },
    };
    await expect(summary(db, before, duplicate)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_INVALID_CHECKLIST_IDENTITY/,
    );

    const foreign = {
      venue: category({ assignee: { kind: "member", profileId: FOREIGN_ID } }),
    };
    await expect(summary(db, { venue: category() }, foreign)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_CHECKLIST_ASSIGNEE_NOT_CURRENT_MEMBER/,
    );
  });

  it("allows removing a formerly linked member assignment without introducing it again", async () => {
    const db = await createDatabase();
    const before = {
      venue: category({ assignee: { kind: "member", profileId: FOREIGN_ID } }),
    };
    const after = { venue: category() };
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("연결 해제 대상");
    expect(receipt).toContain("미정");
    expect(receipt).not.toContain(FOREIGN_ID);
  });

  it("accepts an exact multi-category situation-profile exclusion receipt", async () => {
    const db = await createDatabase();
    const before = {
      ceremony: {
        category: "ceremony",
        label: "본식",
        status: "not_started",
        checklist: [
          {
            id: "ceremony_01",
            label: "본식 순서 정하기",
            done: true,
            state: "completed",
            completedAt: "2026-08-11T09:00:00.000Z",
            completedByProfileId: BRIDE_ID,
          },
        ],
      },
      pyebaek: {
        category: "pyebaek",
        label: "폐백",
        status: "not_started",
        checklist: [
          { id: "pyebaek_01", label: "폐백 진행 여부 정하기", done: false, state: "todo" },
        ],
      },
    };
    const situationProfile = {
      ...profile({
        answers: { ceremony: "no" },
        autoExcludedItemIds: ["ceremony_01", "pyebaek_01"],
      }),
      autoExcludedItemIds: ["ceremony_01", "pyebaek_01"],
    };
    const after = {
      __checklist_profile: situationProfile,
      ceremony: {
        ...before.ceremony,
        status: "not_applicable",
        checklist: [{
          ...before.ceremony.checklist[0],
          done: false,
          state: "not_applicable",
          completedAt: null,
          completedByProfileId: null,
        }],
        checklistReviewedAt: situationProfile.reviewedAt,
        checklistReviewSource: "situation_profile",
      },
      pyebaek: {
        ...before.pyebaek,
        status: "not_applicable",
        checklist: [{ ...before.pyebaek.checklist[0], state: "not_applicable" }],
        checklistReviewedAt: situationProfile.reviewedAt,
        checklistReviewSource: "situation_profile",
      },
    };

    await expect(isHighImpact(db, before, after)).resolves.toBe(true);
    const receipt = await summary(db, before, after);
    expect(receipt).toContain("예식 미정→안함");
    expect(receipt).toContain("자동 제외 총2개");
    expect(receipt).toContain("본식·본식 순서 정하기");
    expect(receipt).toContain("폐백·폐백 진행 여부 정하기");
    expect(receipt).toContain("분야 제외2/복원0");
    expect(receipt).toContain("본식 → 해당 없음");
    expect(receipt).toContain("폐백 → 해당 없음");
    expect(receipt).toContain("검토 기록 추가2[본식, 폐백]/해제0");
    expect(receipt).not.toContain("ceremony_01");
    expect(receipt).not.toContain("pyebaek_01");
    expect(receipt.length).toBeLessThanOrEqual(240);
  });
});
