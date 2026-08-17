// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  parseAmoraPreparationCatchUpDraftSubmission,
  validateAmoraPreparationCatchUpReceipt,
} from "@hanbang/shared/amora-preparation-catch-up";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260816190000_amora_preparation_catch_up.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const SOLO_COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const LINKED_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

type Receipt = {
  version: 1;
  status: "applied";
  receiptId: string;
  coupleId: string;
  requestId: string;
  sourceJourneyRevision: number;
  confirmedAt: string;
  reused: boolean;
  items: Array<{
    decisionId: string;
    topicKey: string;
    state: string;
    scope: string;
    source: "user_reported";
  }>;
  boundaries: {
    checklistCompletionChanged: false;
    vendorConfirmation: "unconfirmed";
    paymentEvidence: false;
  };
  next: { kind: "recalculate_current_state"; route: "/schedule" };
};

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id),
      member_model_version smallint NOT NULL DEFAULT 1,
      membership_sealed_at timestamptz
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      wedding_date date,
      venue text,
      total_budget bigint NOT NULL DEFAULT 0,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      state_revision bigint NOT NULL DEFAULT 0
    );
    CREATE TABLE public.amora_privacy_context_epochs (
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id),
      epoch bigint NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      category text,
      decision_type text,
      title text,
      chosen_value jsonb,
      options_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
      reasoning text,
      confidence numeric(3,2),
      stage_tag text,
      decided_at timestamptz,
      source text,
      source_ref_id uuid,
      source_message_id uuid,
      memory_key text,
      source_actor_role text,
      user_confirmed_at timestamptz,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      superseded_at timestamptz,
      superseded_by uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.ai_interactions_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

    INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}');
    INSERT INTO public.couples(
      id, bride_id, groom_id, member_model_version
    ) VALUES
      ('${SOLO_COUPLE_ID}', '${BRIDE_ID}', NULL, 2),
      ('${LINKED_COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}', 2);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${SOLO_COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${LINKED_COUPLE_ID}', 'groom');
    INSERT INTO public.wedding_journeys(couple_id) VALUES
      ('${SOLO_COUPLE_ID}'), ('${LINKED_COUPLE_ID}');
    INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch) VALUES
      ('${SOLO_COUPLE_ID}', 7), ('${LINKED_COUPLE_ID}', 8);

    CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION public.can_access_couple_visibility(
      p_couple_id uuid,
      p_visibility text
    ) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT p_visibility IN ('shared', 'bride_private', 'groom_private')
        AND EXISTS (
          SELECT 1
          FROM public.profiles AS profile
          JOIN public.couples AS couple ON couple.id = profile.couple_id
          WHERE profile.id = auth.uid()
            AND profile.couple_id = p_couple_id
            AND (
              (profile.role = 'bride' AND couple.bride_id = profile.id
                AND p_visibility IN ('shared', 'bride_private'))
              OR
              (profile.role = 'groom' AND couple.groom_id = profile.id
                AND p_visibility IN ('shared', 'groom_private'))
            )
        )
    $$;
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT ON public.decision_nodes TO authenticated;
    GRANT EXECUTE ON FUNCTION public.can_access_couple_visibility(uuid, text)
      TO authenticated;
    ALTER TABLE public.decision_nodes ENABLE ROW LEVEL SECURITY;
  `);
  await db.exec(migration);
  return db;
}

async function finalize(
  db: PGlite,
  options: {
    coupleId?: string;
    actorUserId?: string;
    requestId?: string;
    privacyEpoch?: number;
    items?: unknown[];
  } = {},
) {
  const items = options.items ?? [
    { topicKey: "venue", state: "completed", scope: "owner_private" },
    { topicKey: "studio", state: "in_progress", scope: "owner_private" },
  ];
  const result = await db.query<{ receipt: Receipt }>(`
    SELECT public.finalize_amora_preparation_catch_up_v1(
      $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::jsonb
    ) AS receipt
  `, [
    options.coupleId ?? SOLO_COUPLE_ID,
    options.actorUserId ?? BRIDE_ID,
    options.requestId ?? REQUEST_ID,
    options.privacyEpoch ?? 7,
    JSON.stringify(items),
  ]);
  return { receipt: result.rows[0].receipt, items };
}

describe("amora preparation catch-up migration", () => {
  it("atomically persists user-reported evidence and replays one canonical receipt", async () => {
    const db = await createDatabase();
    try {
      const first = await finalize(db);
      const expectedDraft = parseAmoraPreparationCatchUpDraftSubmission({
        version: 1,
        requestId: REQUEST_ID,
        items: first.items,
      });
      expect(expectedDraft).not.toBeNull();
      expect(validateAmoraPreparationCatchUpReceipt(
        first.receipt,
        SOLO_COUPLE_ID,
        REQUEST_ID,
        expectedDraft?.items ?? [],
      )).toEqual({ ok: true, value: first.receipt });
      expect(first.receipt.reused).toBe(false);
      expect(first.receipt.sourceJourneyRevision).toBe(0);
      expect(first.receipt.items.map((item) => item.topicKey)).toEqual(["venue", "studio"]);

      const counts = await db.query<{
        receipts: number;
        decisions: number;
        ai_logs: number;
        revision: number;
        progress: unknown;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.amora_preparation_catch_up_receipts) AS receipts,
          (SELECT count(*)::integer FROM public.decision_nodes) AS decisions,
          (SELECT count(*)::integer FROM public.ai_interactions_log) AS ai_logs,
          journey.state_revision::integer AS revision,
          journey.progress
        FROM public.wedding_journeys AS journey
        WHERE journey.couple_id = '${SOLO_COUPLE_ID}'::uuid
      `);
      expect(counts.rows[0]).toEqual({
        receipts: 1,
        decisions: 2,
        ai_logs: 0,
        revision: 0,
        progress: {},
      });

      const replay = await finalize(db);
      expect(replay.receipt).toEqual({ ...first.receipt, reused: true });
      expect((await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.decision_nodes",
      )).rows[0].count).toBe(2);
    } finally {
      await db.close();
    }
  });

  it("rejects a changed retry, stale privacy, and any existing canonical preparation before writes", async () => {
    const db = await createDatabase();
    try {
      await finalize(db);
      await expect(finalize(db, {
        items: [{ topicKey: "venue", state: "unknown", scope: "owner_private" }],
      })).rejects.toMatchObject({ code: "55000" });

      const staleDb = await createDatabase();
      try {
        await expect(finalize(staleDb, { privacyEpoch: 6 })).rejects.toMatchObject({ code: "40001" });
      } finally {
        await staleDb.close();
      }

      const existingDb = await createDatabase();
      try {
        await existingDb.exec(`
          UPDATE public.wedding_journeys
          SET progress = '{"venue":{"status":"in_progress"}}'::jsonb,
              state_revision = 1
          WHERE couple_id = '${SOLO_COUPLE_ID}'::uuid;
        `);
        await expect(finalize(existingDb)).rejects.toMatchObject({ code: "23514" });
        expect((await existingDb.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM public.decision_nodes",
        )).rows[0].count).toBe(0);
      } finally {
        await existingDb.close();
      }
    } finally {
      await db.close();
    }
  });

  it("allows private evidence but blocks shared evidence for an already-linked two-member couple", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.profiles
        SET couple_id = '${LINKED_COUPLE_ID}'::uuid
        WHERE id = '${BRIDE_ID}'::uuid;
      `);
      const privateResult = await finalize(db, {
        coupleId: LINKED_COUPLE_ID,
        privacyEpoch: 8,
        items: [{ topicKey: "venue", state: "completed", scope: "owner_private" }],
      });
      expect(privateResult.receipt.items[0].scope).toBe("owner_private");

      const sharedDb = await createDatabase();
      try {
        await sharedDb.exec(`
          UPDATE public.profiles
          SET couple_id = '${LINKED_COUPLE_ID}'::uuid
          WHERE id = '${BRIDE_ID}'::uuid;
        `);
        await expect(finalize(sharedDb, {
          coupleId: LINKED_COUPLE_ID,
          privacyEpoch: 8,
          items: [{ topicKey: "venue", state: "completed", scope: "couple_shared" }],
        })).rejects.toMatchObject({ code: "42501" });
        expect((await sharedDb.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM public.amora_preparation_catch_up_receipts",
        )).rows[0].count).toBe(0);
      } finally {
        await sharedDb.close();
      }
    } finally {
      await db.close();
    }
  });

  it("rolls back every decision when the receipt cannot be completed", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.reject_catch_up_receipt() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced receipt failure';
        END
        $$;
        CREATE TRIGGER reject_catch_up_receipt
          BEFORE INSERT ON public.amora_preparation_catch_up_receipts
          FOR EACH ROW EXECUTE FUNCTION public.reject_catch_up_receipt();
      `);
      await expect(finalize(db)).rejects.toThrow("forced receipt failure");
      expect((await db.query<{ decisions: number; receipts: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.decision_nodes) AS decisions,
          (SELECT count(*)::integer FROM public.amora_preparation_catch_up_receipts) AS receipts
      `)).rows[0]).toEqual({ decisions: 0, receipts: 0 });
    } finally {
      await db.close();
    }
  });

  it("keeps the finalizer service-only with a pinned execution boundary", async () => {
    const db = await createDatabase();
    try {
      const contract = await db.query<{
        security_definer: boolean;
        config: string[];
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        SELECT
          procedure.prosecdef AS security_definer,
          procedure.proconfig AS config,
          has_function_privilege(
            'authenticated',
            'public.finalize_amora_preparation_catch_up_v1(uuid,uuid,uuid,bigint,jsonb)',
            'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'service_role',
            'public.finalize_amora_preparation_catch_up_v1(uuid,uuid,uuid,bigint,jsonb)',
            'EXECUTE'
          ) AS service_execute
        FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid =
          'public.finalize_amora_preparation_catch_up_v1(uuid,uuid,uuid,bigint,jsonb)'::regprocedure
      `);
      expect(contract.rows[0].security_definer).toBe(true);
      expect(contract.rows[0].config).toEqual(expect.arrayContaining([
        "search_path=pg_catalog, public, extensions",
        "lock_timeout=5s",
        "statement_timeout=30s",
      ]));
      expect(contract.rows[0].authenticated_execute).toBe(false);
      expect(contract.rows[0].service_execute).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("binds private catch-up reads to the exact actor instead of a later occupant of the same role", async () => {
    const db = await createDatabase();
    try {
      await finalize(db, {
        items: [{ topicKey: "venue", state: "completed", scope: "owner_private" }],
      });
      const metadata = await db.query<{ actor_profile_id: string | null }>(`
        SELECT metadata ->> 'actor_profile_id' AS actor_profile_id
        FROM public.decision_nodes
      `);
      expect(metadata.rows[0].actor_profile_id).toBe(BRIDE_ID);

      await db.exec(`
        SELECT set_config('request.jwt.claim.sub', '${BRIDE_ID}', false);
        SET ROLE authenticated;
      `);
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.decision_nodes
      `)).rows[0].count).toBe(1);
      await db.exec(`
        RESET ROLE;
        UPDATE public.couples SET groom_id = NULL WHERE id = '${LINKED_COUPLE_ID}'::uuid;
        UPDATE public.couples SET bride_id = NULL WHERE id = '${SOLO_COUPLE_ID}'::uuid;
        UPDATE public.profiles SET couple_id = NULL WHERE id = '${BRIDE_ID}'::uuid;
        UPDATE public.profiles
        SET couple_id = '${SOLO_COUPLE_ID}'::uuid, role = 'bride'
        WHERE id = '${GROOM_ID}'::uuid;
        UPDATE public.couples
        SET bride_id = '${GROOM_ID}'::uuid
        WHERE id = '${SOLO_COUPLE_ID}'::uuid;
        SELECT set_config('request.jwt.claim.sub', '${GROOM_ID}', false);
        SET ROLE authenticated;
      `);
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.decision_nodes
      `)).rows[0].count).toBe(0);
      await db.exec("RESET ROLE");

      const policy = await db.query<{ qual: string }>(`
        SELECT qual
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'decision_nodes'
          AND policyname = 'decision_nodes_select_with_privacy'
      `);
      expect(policy.rows[0].qual).toContain("actor_profile_id");
      expect(policy.rows[0].qual).toContain("auth.uid()");
    } finally {
      await db.close();
    }
  });
});
