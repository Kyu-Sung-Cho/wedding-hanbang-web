// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  validateAmoraPreparationTopicMessageRefCollectionResponse,
  validateAmoraPreparationTopicMessageRefMutationResponse,
  validateAmoraPreparationTopicMessageRefResolveResponse,
  validateAmoraPreparationTopicMessageRefStateResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260816120000_amora_preparation_topic_message_refs.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const SHARED_QUESTION_ID = "30000000-0000-4000-8000-000000000001";
const SHARED_ANSWER_ID = "40000000-0000-4000-8000-000000000001";
const PRIVATE_QUESTION_ID = "30000000-0000-4000-8000-000000000002";
const PRIVATE_ANSWER_ID = "40000000-0000-4000-8000-000000000002";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const TOPIC_KEYS = [
  "meeting", "venue", "studio", "dress", "makeup", "ring", "hanbok",
  "yedan", "honeymoon", "houseware", "housing", "invitation", "snap",
  "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
] as const;

type RefState = {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  reused?: boolean;
  reference: {
    topicKey: string;
    messageId: string;
    refId: string | null;
    audience: "couple_shared" | "owner_private";
    savedState: "saved" | "removed";
    revision: number;
  };
};

type RefList = {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  references: Array<{
    refId: string;
    topicKey: string;
    messageId: string;
    audience: "couple_shared" | "owner_private";
    revision: number;
    savedAt: string;
    sourceCreatedAt: string;
    excerpt: string;
    canRemove: true;
    canOpenOriginal: true;
  }>;
  partial: boolean;
};

type ResolvedRef = {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  reference: {
    refId: string;
    topicKey: string;
    messageId: string;
    audience: "couple_shared" | "owner_private";
    revision: number;
    savedAt: string;
  };
  target: {
    messageId: string;
    lane: "shared" | "private";
    content: string;
    createdAt: string;
  };
  question: {
    messageId: string;
    lane: "shared" | "private";
    senderType: "bride" | "groom";
    content: string;
    createdAt: string;
  };
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
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE TABLE public.amora_privacy_context_epochs (
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id) ON DELETE CASCADE,
      epoch bigint NOT NULL CHECK (epoch >= 1),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES auth.users(id),
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visibility text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.amora_saved_notes (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      saved_by uuid NOT NULL REFERENCES auth.users(id),
      message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
      content text NOT NULL,
      memo text
    );

    INSERT INTO auth.users(id) VALUES
      ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id) VALUES
      ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}'),
      ('${OTHER_COUPLE_ID}', '${OUTSIDER_ID}', NULL);
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${OTHER_COUPLE_ID}', 'bride');
    INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch) VALUES
      ('${COUPLE_ID}', 7), ('${OTHER_COUPLE_ID}', 2);
    INSERT INTO public.chat_messages(
      id, couple_id, sender_id, sender_type, role, content, metadata,
      visibility, created_at
    ) VALUES
      (
        '${SHARED_QUESTION_ID}', '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user',
        '상견례 날짜를 정할 때 무엇부터 확인할까요?',
        '{"target":"ai"}'::jsonb, 'shared', '2026-08-16T01:00:00Z'
      ),
      (
        '${SHARED_ANSWER_ID}', '${COUPLE_ID}', NULL, 'ai', 'assistant',
        '양가가 피하기 어려운 날짜부터 두세 개만 먼저 모아 보세요.',
        jsonb_build_object(
          'question_scope', 'W0_wedding_core',
          'memory_eligible', false,
          'in_reply_to_user_message_id', '${SHARED_QUESTION_ID}'
        ),
        'shared', '2026-08-16T01:01:00Z'
      ),
      (
        '${PRIVATE_QUESTION_ID}', '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user',
        '제 예산 걱정은 상대에게 아직 보이지 않게 정리하고 싶어요.',
        '{"target":"ai"}'::jsonb, 'bride_private', '2026-08-16T02:00:00Z'
      ),
      (
        '${PRIVATE_ANSWER_ID}', '${COUPLE_ID}', NULL, 'ai', 'assistant',
        '먼저 혼자 감당 가능한 상한과 함께 상의할 범위를 나눠 보세요.',
        jsonb_build_object(
          'question_scope', 'W1_wedding_adjacent',
          'in_reply_to_user_message_id', '${PRIVATE_QUESTION_ID}'
        ),
        'bride_private', '2026-08-16T02:01:00Z'
      );
    INSERT INTO public.amora_saved_notes(
      id, couple_id, saved_by, message_id, content, memo
    ) VALUES (
      '60000000-0000-4000-8000-000000000001', '${COUPLE_ID}', '${BRIDE_ID}',
      '${SHARED_ANSWER_ID}', 'legacy snapshot sentinel', 'keep me'
    );

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.exec(`SET ROLE ${role}`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function setIntent(
  db: PGlite,
  options: {
    actorId?: string;
    coupleId?: string;
    topicKey?: string;
    messageId?: string;
    desiredState?: "saved" | "removed";
    expectedRevision?: number;
    requestId?: string;
    expectedPrivacyEpoch?: number;
  } = {},
) {
  const result = await db.query<{ value: RefState }>(`
    SELECT public.set_amora_preparation_topic_message_ref_v1(
      $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::bigint,
      $7::uuid, $8::bigint
    ) AS value
  `, [
    options.coupleId ?? COUPLE_ID,
    options.actorId ?? BRIDE_ID,
    options.topicKey ?? "meeting",
    options.messageId ?? SHARED_ANSWER_ID,
    options.desiredState ?? "saved",
    options.expectedRevision ?? 0,
    options.requestId ?? REQUEST_ID,
    options.expectedPrivacyEpoch ?? 7,
  ]);
  return result.rows[0]!.value;
}

async function getState(
  db: PGlite,
  options: {
    recipientId?: string;
    coupleId?: string;
    topicKey?: string;
    messageId?: string;
    expectedPrivacyEpoch?: number;
  } = {},
) {
  const result = await db.query<{ value: RefState }>(`
    SELECT public.get_amora_preparation_topic_message_ref_state_v1(
      $1::uuid, $2::uuid, $3::text, $4::uuid, $5::bigint
    ) AS value
  `, [
    options.coupleId ?? COUPLE_ID,
    options.recipientId ?? BRIDE_ID,
    options.topicKey ?? "meeting",
    options.messageId ?? SHARED_ANSWER_ID,
    options.expectedPrivacyEpoch ?? 7,
  ]);
  return result.rows[0]!.value;
}

async function listRefs(
  db: PGlite,
  options: {
    recipientId?: string;
    coupleId?: string;
    expectedPrivacyEpoch?: number;
    limit?: number;
  } = {},
) {
  const result = await db.query<{ value: RefList }>(`
    SELECT public.list_amora_preparation_topic_message_refs_v1(
      $1::uuid, $2::uuid, $3::bigint, $4::integer
    ) AS value
  `, [
    options.coupleId ?? COUPLE_ID,
    options.recipientId ?? BRIDE_ID,
    options.expectedPrivacyEpoch ?? 7,
    options.limit ?? 80,
  ]);
  return result.rows[0]!.value;
}

async function resolveRef(
  db: PGlite,
  refId: string,
  options: {
    recipientId?: string;
    coupleId?: string;
    expectedPrivacyEpoch?: number;
  } = {},
) {
  const result = await db.query<{ value: ResolvedRef }>(`
    SELECT public.resolve_amora_preparation_topic_message_ref_v1(
      $1::uuid, $2::uuid, $3::uuid, $4::bigint
    ) AS value
  `, [
    options.coupleId ?? COUPLE_ID,
    options.recipientId ?? BRIDE_ID,
    refId,
    options.expectedPrivacyEpoch ?? 7,
  ]);
  return result.rows[0]!.value;
}

describe("Amora preparation topic message refs migration", () => {
  it("locks a deterministic roster snapshot before the couple and privacy epoch", async () => {
    const db = await createDatabase();
    try {
      const contextBody = await db.query<{ body: string }>(`
        SELECT prosrc AS body
        FROM pg_proc
        WHERE oid =
          'public.amora_preparation_topic_message_ref_context_v1(uuid,uuid,bigint,boolean)'::regprocedure
      `);
      const body = contextBody.rows[0]!.body;
      const rosterSnapshotAt = body.indexOf(
        "INTO v_snapshot_bride_id, v_snapshot_groom_id",
      );
      const rosterProfilesAt = body.indexOf(
        "ARRAY[\n      p_actor_user_id,",
      );
      const deterministicOrderAt = body.indexOf(
        "ORDER BY profile.id",
        rosterProfilesAt,
      );
      const rosterProfilesLockedAt = body.indexOf(
        "FOR SHARE",
        deterministicOrderAt,
      );
      const coupleLockedAt = body.indexOf(
        "INTO v_bride_id, v_groom_id",
        rosterProfilesLockedAt,
      );
      const coupleShareLockedAt = body.indexOf(
        "FOR SHARE",
        coupleLockedAt,
      );
      const actorRevalidatedAt = body.indexOf(
        "INTO v_profile_couple_id, v_actor_role",
        coupleShareLockedAt,
      );
      const privacyLockedAt = body.indexOf(
        "FROM public.amora_privacy_context_epochs AS privacy",
        actorRevalidatedAt,
      );

      expect(rosterSnapshotAt).toBeGreaterThanOrEqual(0);
      expect(rosterProfilesAt).toBeGreaterThan(rosterSnapshotAt);
      expect(deterministicOrderAt).toBeGreaterThan(rosterProfilesAt);
      expect(rosterProfilesLockedAt).toBeGreaterThan(deterministicOrderAt);
      expect(coupleLockedAt).toBeGreaterThan(rosterProfilesLockedAt);
      expect(coupleShareLockedAt).toBeGreaterThan(coupleLockedAt);
      expect(actorRevalidatedAt).toBeGreaterThan(coupleShareLockedAt);
      expect(privacyLockedAt).toBeGreaterThan(actorRevalidatedAt);
      expect(body.slice(rosterSnapshotAt, rosterProfilesAt)).not.toContain(
        "FOR SHARE",
      );
      expect(body).toContain(
        "v_bride_id IS DISTINCT FROM v_snapshot_bride_id",
      );
      expect(body).toContain(
        "v_groom_id IS DISTINCT FROM v_snapshot_groom_id",
      );

      await setPersona(db, "service_role");
      expect(await listRefs(db)).toMatchObject({
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
        references: [],
        partial: false,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("saves one explicit ordinary shared AI answer without copying its content", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const response = await setIntent(db);

      expect(response).toMatchObject({
        version: 1,
        state: "ready",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
        reused: false,
        reference: {
          topicKey: "meeting",
          messageId: SHARED_ANSWER_ID,
          audience: "couple_shared",
          savedState: "saved",
          revision: 1,
        },
      });
      expect(validateAmoraPreparationTopicMessageRefMutationResponse(
        response,
        BRIDE_ID,
        COUPLE_ID,
        "meeting",
        SHARED_ANSWER_ID,
        "saved",
      )).toEqual({ ok: true, value: response });
      await resetPersona(db);
      const stored = await db.query<Record<string, unknown>>(`
        SELECT * FROM public.amora_preparation_topic_message_refs
      `);
      expect(stored.rows).toHaveLength(1);
      expect(Object.keys(stored.rows[0] ?? {})).not.toEqual(
        expect.arrayContaining(["content", "summary", "memo"]),
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps one tombstoned relation and rejects retries older than a later remove or save", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const saved = await setIntent(db);
      const replay = await setIntent(db);
      expect(replay).toEqual({ ...saved, reused: true });
      await expect(setIntent(db, {
        desiredState: "removed",
      })).rejects.toMatchObject({ code: "40001" });
      await expect(setIntent(db, {
        topicKey: "venue",
      })).rejects.toMatchObject({ code: "40001" });

      const removed = await setIntent(db, {
        desiredState: "removed",
        expectedRevision: 1,
        requestId: "50000000-0000-4000-8000-000000000002",
      });
      expect(removed).toMatchObject({
        reused: false,
        reference: { refId: null, savedState: "removed", revision: 2 },
      });
      expect(validateAmoraPreparationTopicMessageRefMutationResponse(
        removed,
        BRIDE_ID,
        COUPLE_ID,
        "meeting",
        SHARED_ANSWER_ID,
        "removed",
      )).toEqual({ ok: true, value: removed });
      const removedState = await getState(db);
      expect(removedState).toMatchObject({
        reference: { refId: null, savedState: "removed", revision: 2 },
      });
      expect(validateAmoraPreparationTopicMessageRefStateResponse(
        removedState,
        BRIDE_ID,
        COUPLE_ID,
        "meeting",
        SHARED_ANSWER_ID,
      )).toEqual({ ok: true, value: removedState });
      expect(await listRefs(db)).toMatchObject({ references: [], partial: false });
      await expect(resolveRef(db, saved.reference.refId!))
        .rejects.toMatchObject({ code: "P0002" });

      await expect(setIntent(db)).rejects.toMatchObject({ code: "40001" });
      expect((await getState(db)).reference).toMatchObject({
        savedState: "removed",
        revision: 2,
      });

      const resaved = await setIntent(db, {
        expectedRevision: 2,
        requestId: "50000000-0000-4000-8000-000000000003",
      });
      expect(resaved.reference).toMatchObject({
        refId: saved.reference.refId,
        savedState: "saved",
        revision: 3,
      });
      await expect(setIntent(db, {
        desiredState: "removed",
        expectedRevision: 1,
        requestId: "50000000-0000-4000-8000-000000000002",
      })).rejects.toMatchObject({ code: "40001" });

      await resetPersona(db);
      const rows = await db.query<{ count: number; state: string; revision: number }>(`
        SELECT count(*)::integer AS count, min(state) AS state,
               min(revision)::integer AS revision
        FROM public.amora_preparation_topic_message_refs
      `);
      expect(rows.rows[0]).toEqual({ count: 1, state: "saved", revision: 3 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("makes remove-on-absent an idempotent private tombstone without exposing its id", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const removed = await setIntent(db, {
        topicKey: "housing",
        messageId: PRIVATE_ANSWER_ID,
        desiredState: "removed",
      });
      expect(removed).toMatchObject({
        reused: false,
        reference: {
          refId: null,
          audience: "owner_private",
          savedState: "removed",
          revision: 1,
        },
      });
      expect(await setIntent(db, {
        topicKey: "housing",
        messageId: PRIVATE_ANSWER_ID,
        desiredState: "removed",
      })).toEqual({ ...removed, reused: true });
      expect(await listRefs(db)).toMatchObject({ references: [], partial: false });

      await resetPersona(db);
      const tombstone = await db.query<{
        state: string;
        saved_at: string | null;
        removed_at: string | null;
      }>(`
        SELECT state, saved_at, removed_at
        FROM public.amora_preparation_topic_message_refs
      `);
      expect(tombstone.rows[0]).toMatchObject({
        state: "removed",
        saved_at: null,
      });
      expect(tombstone.rows[0]?.removed_at).toBeTruthy();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("derives a safe one-line excerpt and fails closed on hidden format controls", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET content = $1
        WHERE id = $2::uuid
      `, ["\u00A0 첫 줄\n\n둘째\u2003줄 \u00A0", SHARED_ANSWER_ID]);
      await setPersona(db, "service_role");
      await setIntent(db);
      expect((await listRefs(db)).references[0]?.excerpt).toBe("첫 줄 둘째 줄");

      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET content = $1
        WHERE id = $2::uuid
      `, ["숨은\u200D문자", SHARED_ANSWER_ID]);
      await setPersona(db, "service_role");
      expect(await listRefs(db)).toMatchObject({ references: [], partial: true });
      await expect(setIntent(db, {
        expectedRevision: 1,
        requestId: "50000000-0000-4000-8000-000000000004",
      })).rejects.toMatchObject({ code: "P0002" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("shares only shared refs with the partner and resolves the exact current question", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const shared = await setIntent(db);
      const privateRef = await setIntent(db, {
        topicKey: "housing",
        messageId: PRIVATE_ANSWER_ID,
        requestId: "50000000-0000-4000-8000-000000000005",
      });
      expect(privateRef.reference).toMatchObject({
        audience: "owner_private",
        savedState: "saved",
      });

      const brideList = await listRefs(db);
      expect(validateAmoraPreparationTopicMessageRefCollectionResponse(
        brideList,
        BRIDE_ID,
        COUPLE_ID,
      )).toEqual({ ok: true, value: brideList });
      expect(brideList.references.map((ref) => ref.audience).sort()).toEqual([
        "couple_shared",
        "owner_private",
      ]);
      const groomList = await listRefs(db, { recipientId: GROOM_ID });
      expect(validateAmoraPreparationTopicMessageRefCollectionResponse(
        groomList,
        GROOM_ID,
        COUPLE_ID,
      )).toEqual({ ok: true, value: groomList });
      expect(groomList.references).toHaveLength(1);
      expect(groomList.references[0]).toMatchObject({
        refId: shared.reference.refId,
        audience: "couple_shared",
      });
      expect(Object.keys(groomList.references[0] ?? {}).sort()).toEqual([
        "audience",
        "canOpenOriginal",
        "canRemove",
        "excerpt",
        "messageId",
        "refId",
        "revision",
        "savedAt",
        "sourceCreatedAt",
        "topicKey",
      ]);

      const resolved = await resolveRef(db, shared.reference.refId!, {
        recipientId: GROOM_ID,
      });
      expect(resolved).toMatchObject({
        recipientUserId: GROOM_ID,
        reference: { audience: "couple_shared" },
        target: {
          messageId: SHARED_ANSWER_ID,
          lane: "shared",
          content: "양가가 피하기 어려운 날짜부터 두세 개만 먼저 모아 보세요.",
        },
        question: {
          messageId: SHARED_QUESTION_ID,
          lane: "shared",
          senderType: "bride",
          content: "상견례 날짜를 정할 때 무엇부터 확인할까요?",
        },
      });
      expect(validateAmoraPreparationTopicMessageRefResolveResponse(
        resolved,
        GROOM_ID,
        COUPLE_ID,
        shared.reference.refId!,
      )).toEqual({ ok: true, value: resolved });
      expect(Object.keys(resolved.question).sort()).toEqual([
        "content", "createdAt", "lane", "messageId", "senderType",
      ]);
      const resolvedPrivate = await resolveRef(db, privateRef.reference.refId!);
      expect(resolvedPrivate).toMatchObject({
        reference: { audience: "owner_private" },
        target: { messageId: PRIVATE_ANSWER_ID, lane: "private" },
        question: {
          messageId: PRIVATE_QUESTION_ID,
          lane: "private",
          senderType: "bride",
        },
      });
      expect(validateAmoraPreparationTopicMessageRefResolveResponse(
        resolvedPrivate,
        BRIDE_ID,
        COUPLE_ID,
        privateRef.reference.refId!,
      )).toEqual({ ok: true, value: resolvedPrivate });
      await expect(resolveRef(db, privateRef.reference.refId!, {
        recipientId: GROOM_ID,
      })).rejects.toMatchObject({ code: "P0002" });
      await expect(getState(db, {
        recipientId: GROOM_ID,
        topicKey: "housing",
        messageId: PRIVATE_ANSWER_ID,
      })).rejects.toMatchObject({ code: "P0002" });

      const untouched = await getState(db, { topicKey: "venue" });
      expect(untouched.reference).toEqual({
        topicKey: "venue",
        messageId: SHARED_ANSWER_ID,
        refId: null,
        audience: "couple_shared",
        savedState: "removed",
        revision: 0,
      });
      expect(validateAmoraPreparationTopicMessageRefStateResponse(
        untouched,
        BRIDE_ID,
        COUPLE_ID,
        "venue",
        SHARED_ANSWER_ID,
      )).toEqual({ ok: true, value: untouched });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed for every non-ordinary, temporary, foreign, or unbound source", async () => {
    const db = await createDatabase();
    const baseMetadata = {
      question_scope: "W0_wedding_core",
      in_reply_to_user_message_id: SHARED_QUESTION_ID,
    };
    const invalidMetadata = [
      { ...baseMetadata, question_scope: "W2_high_risk_adjacent" },
      { ...baseMetadata, pinned_safety_card: false },
      { ...baseMetadata, mediation: { kind: "offer" } },
      { ...baseMetadata, response_origin: "deterministic_safety" },
      { ...baseMetadata, safety_classification: "high_risk" },
      { ...baseMetadata, raw_disclosure_shared: false },
      { ...baseMetadata, mediation_offer_key: "offer" },
      { ...baseMetadata, persistence_status: "ephemeral_local_only" },
      { ...baseMetadata, persistence_status: "local_recovery_only" },
      { ...baseMetadata, persistence_status: "unconfirmed_ephemeral_fallback" },
      { ...baseMetadata, target: "partner" },
      { ...baseMetadata, target: "vendor" },
      { ...baseMetadata, target: 7 },
      { question_scope: "W0_wedding_core" },
      {
        ...baseMetadata,
        in_reply_to_user_message_id: "30000000-0000-4000-8000-000000000099",
      },
    ];
    try {
      for (const [index, metadata] of invalidMetadata.entries()) {
        await resetPersona(db);
        await db.query(`
          UPDATE public.chat_messages SET metadata = $1::jsonb
          WHERE id = $2::uuid
        `, [JSON.stringify(metadata), SHARED_ANSWER_ID]);
        await setPersona(db, "service_role");
        await expect(setIntent(db, {
          requestId: `51000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        })).rejects.toMatchObject({ code: "P0002" });
      }

      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET metadata = $1::jsonb, sender_type = 'bride'
        WHERE id = $2::uuid
      `, [JSON.stringify(baseMetadata), SHARED_ANSWER_ID]);
      await setPersona(db, "service_role");
      await expect(setIntent(db, {
        requestId: "52000000-0000-4000-8000-000000000001",
      })).rejects.toMatchObject({ code: "P0002" });

      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET sender_type = 'ai', metadata = $1::jsonb
        WHERE id = $2::uuid
      `, [JSON.stringify(baseMetadata), SHARED_ANSWER_ID]);
      await db.query(`
        UPDATE public.chat_messages
        SET metadata = '{"target":"unknown"}'::jsonb
        WHERE id = $1::uuid
      `, [SHARED_QUESTION_ID]);
      await setPersona(db, "service_role");
      await expect(setIntent(db, {
        requestId: "52000000-0000-4000-8000-000000000004",
      })).rejects.toMatchObject({ code: "P0002" });

      await expect(setIntent(db, {
        messageId: PRIVATE_ANSWER_ID,
        actorId: GROOM_ID,
        requestId: "52000000-0000-4000-8000-000000000002",
      })).rejects.toMatchObject({ code: "P0002" });
      await expect(setIntent(db, {
        coupleId: OTHER_COUPLE_ID,
        actorId: OUTSIDER_ID,
        expectedPrivacyEpoch: 2,
        requestId: "52000000-0000-4000-8000-000000000003",
      })).rejects.toMatchObject({ code: "P0002" });

      await resetPersona(db);
      const count = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_preparation_topic_message_refs
      `);
      expect(count.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("revalidates current source and question provenance against the saved digest", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const saved = await setIntent(db);
      await db.exec("SET TIME ZONE 'Asia/Seoul'");
      expect((await getState(db)).reference).toMatchObject({
        savedState: "saved",
        revision: 1,
      });
      await db.exec("SET TIME ZONE 'UTC'");

      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET created_at = created_at + interval '1 second'
        WHERE id = $1::uuid
      `, [SHARED_ANSWER_ID]);
      await setPersona(db, "service_role");
      await expect(getState(db)).rejects.toMatchObject({ code: "40001" });
      await expect(resolveRef(db, saved.reference.refId!))
        .rejects.toMatchObject({ code: "40001" });
      expect(await listRefs(db)).toMatchObject({ references: [], partial: true });

      await resetPersona(db);
      await db.query(`
        UPDATE public.chat_messages
        SET created_at = created_at - interval '1 second'
        WHERE id IN ($1::uuid, $2::uuid)
      `, [SHARED_ANSWER_ID, SHARED_QUESTION_ID]);
      await setPersona(db, "service_role");
      await expect(getState(db)).rejects.toMatchObject({ code: "40001" });
      expect(await listRefs(db)).toMatchObject({ references: [], partial: true });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("accepts exactly the 19 canonical topics and returns a bounded partial all-topic list", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      for (const [index, topicKey] of TOPIC_KEYS.entries()) {
        const response = await setIntent(db, {
          topicKey,
          requestId: `53000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        });
        expect(response.reference).toMatchObject({ topicKey, revision: 1 });
      }
      const bounded = await listRefs(db, { limit: 5 });
      expect(bounded.references).toHaveLength(5);
      expect(bounded.partial).toBe(true);
      const complete = await listRefs(db);
      expect(complete.references).toHaveLength(19);
      expect(complete.partial).toBe(false);
      expect(complete.references.map((ref) => ref.topicKey).sort()).toEqual(
        [...TOPIC_KEYS].sort(),
      );

      for (const [index, topicKey] of ["reserve", "general", "Meeting", ""].entries()) {
        await expect(setIntent(db, {
          topicKey,
          requestId: `54000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        })).rejects.toMatchObject({ code: "22023" });
      }
      await expect(listRefs(db, { limit: 81 }))
        .rejects.toMatchObject({ code: "22023" });

      const duplicate = await setIntent(db, {
        topicKey: "meeting",
        expectedRevision: 1,
        requestId: "54000000-0000-4000-8000-000000000099",
      });
      expect(duplicate).toMatchObject({
        reused: true,
        reference: { revision: 1, savedState: "saved" },
      });
      await resetPersona(db);
      const count = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_preparation_topic_message_refs
      `);
      expect(count.rows[0]?.count).toBe(19);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps tables opaque, exposes only four exact service RPCs, and preserves legacy notes", async () => {
    const db = await createDatabase();
    try {
      const signatures = await db.query<{ name: string; argument_names: string[] }>(`
        SELECT procedure.proname AS name, procedure.proargnames AS argument_names
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'set_amora_preparation_topic_message_ref_v1',
            'list_amora_preparation_topic_message_refs_v1',
            'get_amora_preparation_topic_message_ref_state_v1',
            'resolve_amora_preparation_topic_message_ref_v1'
          )
        ORDER BY procedure.proname
      `);
      expect(signatures.rows).toEqual([
        {
          name: "get_amora_preparation_topic_message_ref_state_v1",
          argument_names: [
            "p_couple_id", "p_recipient_user_id", "p_topic_key",
            "p_message_id", "p_expected_privacy_epoch",
          ],
        },
        {
          name: "list_amora_preparation_topic_message_refs_v1",
          argument_names: [
            "p_couple_id", "p_recipient_user_id",
            "p_expected_privacy_epoch", "p_limit",
          ],
        },
        {
          name: "resolve_amora_preparation_topic_message_ref_v1",
          argument_names: [
            "p_couple_id", "p_recipient_user_id", "p_ref_id",
            "p_expected_privacy_epoch",
          ],
        },
        {
          name: "set_amora_preparation_topic_message_ref_v1",
          argument_names: [
            "p_couple_id", "p_actor_user_id", "p_topic_key", "p_message_id",
            "p_desired_state", "p_expected_revision", "p_request_id",
            "p_expected_privacy_epoch",
          ],
        },
      ]);
      const setBody = await db.query<{ body: string }>(`
        SELECT prosrc AS body
        FROM pg_proc
        WHERE oid =
          'public.set_amora_preparation_topic_message_ref_v1(uuid,uuid,text,uuid,text,bigint,uuid,bigint)'::regprocedure
      `);
      const advisoryLockAt = setBody.rows[0]!.body.indexOf(
        "pg_advisory_xact_lock",
      );
      const identityReadAt = setBody.rows[0]!.body.indexOf(
        "FROM public.amora_preparation_topic_message_refs AS ref",
      );
      expect(advisoryLockAt).toBeGreaterThanOrEqual(0);
      expect(identityReadAt).toBeGreaterThan(advisoryLockAt);
      expect(setBody.rows[0]!.body).not.toContain("UPDATE public.chat_messages");
      const rpcPrivileges = await db.query<{
        name: string;
        authenticated_execute: boolean;
        service_execute: boolean;
      }>(`
        SELECT procedure.proname AS name,
               has_function_privilege(
                 'authenticated', procedure.oid, 'EXECUTE'
               ) AS authenticated_execute,
               has_function_privilege(
                 'service_role', procedure.oid, 'EXECUTE'
               ) AS service_execute
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'set_amora_preparation_topic_message_ref_v1',
            'list_amora_preparation_topic_message_refs_v1',
            'get_amora_preparation_topic_message_ref_state_v1',
            'resolve_amora_preparation_topic_message_ref_v1'
          )
        ORDER BY procedure.proname
      `);
      expect(rpcPrivileges.rows).toEqual(signatures.rows.map(({ name }) => ({
        name,
        authenticated_execute: false,
        service_execute: true,
      })));

      const privileges = await db.query<{
        authenticated_table: boolean;
        service_table: boolean;
        authenticated_set: boolean;
        service_set: boolean;
        service_helper: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'authenticated', 'public.amora_preparation_topic_message_refs', 'SELECT'
          ) AS authenticated_table,
          has_table_privilege(
            'service_role', 'public.amora_preparation_topic_message_refs', 'SELECT'
          ) AS service_table,
          has_function_privilege(
            'authenticated',
            'public.set_amora_preparation_topic_message_ref_v1(uuid,uuid,text,uuid,text,bigint,uuid,bigint)',
            'EXECUTE'
          ) AS authenticated_set,
          has_function_privilege(
            'service_role',
            'public.set_amora_preparation_topic_message_ref_v1(uuid,uuid,text,uuid,text,bigint,uuid,bigint)',
            'EXECUTE'
          ) AS service_set,
          has_function_privilege(
            'service_role',
            'public.amora_preparation_topic_message_source_v1(uuid,uuid,uuid,jsonb)',
            'EXECUTE'
          ) AS service_helper
      `);
      expect(privileges.rows[0]).toEqual({
        authenticated_table: false,
        service_table: false,
        authenticated_set: false,
        service_set: true,
        service_helper: false,
      });

      await setPersona(db, "authenticated");
      await expect(setIntent(db)).rejects.toMatchObject({ code: "42501" });
      await expect(db.query(
        "SELECT * FROM public.amora_preparation_topic_message_refs",
      )).rejects.toMatchObject({ code: "42501" });
      await setPersona(db, "service_role");
      await expect(db.query(
        "SELECT * FROM public.amora_preparation_topic_message_refs",
      )).rejects.toMatchObject({ code: "42501" });

      await resetPersona(db);
      const legacy = await db.query<Record<string, unknown>>(`
        SELECT id, couple_id, saved_by, message_id, content, memo
        FROM public.amora_saved_notes
      `);
      expect(legacy.rows).toEqual([{
        id: "60000000-0000-4000-8000-000000000001",
        couple_id: COUPLE_ID,
        saved_by: BRIDE_ID,
        message_id: SHARED_ANSWER_ID,
        content: "legacy snapshot sentinel",
        memo: "keep me",
      }]);
      const forbiddenColumns = await db.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'amora_preparation_topic_message_refs'
          AND column_name IN ('content', 'summary', 'memo', 'excerpt')
      `);
      expect(forbiddenColumns.rows).toEqual([]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("cascades exact source or question deletion and fences privacy or roster changes", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const privateRef = await setIntent(db, {
        topicKey: "housing",
        messageId: PRIVATE_ANSWER_ID,
        requestId: "55000000-0000-4000-8000-000000000001",
      });
      await expect(getState(db, {
        topicKey: "housing",
        messageId: PRIVATE_ANSWER_ID,
        expectedPrivacyEpoch: 6,
      })).rejects.toMatchObject({ code: "40001" });

      await resetPersona(db);
      const deleteActions = await db.query<{
        column_name: string;
        delete_action: string;
      }>(`
        SELECT attribute.attname AS column_name,
               CASE constraint_record.confdeltype WHEN 'c' THEN 'CASCADE' ELSE 'OTHER' END
                 AS delete_action
        FROM pg_constraint AS constraint_record
        JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key(attnum, ordinality)
          ON true
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_record.conrelid
         AND attribute.attnum = key.attnum
        WHERE constraint_record.conrelid =
          'public.amora_preparation_topic_message_refs'::regclass
          AND constraint_record.contype = 'f'
          AND attribute.attname IN ('message_id', 'question_message_id')
        ORDER BY attribute.attname
      `);
      expect(deleteActions.rows).toEqual([
        { column_name: "message_id", delete_action: "CASCADE" },
        { column_name: "question_message_id", delete_action: "CASCADE" },
      ]);
      await db.query("DELETE FROM public.chat_messages WHERE id = $1::uuid", [
        PRIVATE_QUESTION_ID,
      ]);
      const afterQuestionDelete = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_preparation_topic_message_refs
        WHERE id = $1::uuid
      `, [privateRef.reference.refId]);
      expect(afterQuestionDelete.rows[0]?.count).toBe(0);

      await setPersona(db, "service_role");
      const sharedRef = await setIntent(db, {
        requestId: "55000000-0000-4000-8000-000000000002",
      });
      await resetPersona(db);
      await db.query("DELETE FROM public.chat_messages WHERE id = $1::uuid", [
        SHARED_ANSWER_ID,
      ]);
      const afterSourceDelete = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_preparation_topic_message_refs
        WHERE id = $1::uuid
      `, [sharedRef.reference.refId]);
      expect(afterSourceDelete.rows[0]?.count).toBe(0);

      const rosterDb = await createDatabase();
      try {
        await setPersona(rosterDb, "service_role");
        await setIntent(rosterDb, {
          topicKey: "housing",
          messageId: PRIVATE_ANSWER_ID,
          requestId: "55000000-0000-4000-8000-000000000003",
        });
        await resetPersona(rosterDb);
        await rosterDb.exec(`
          UPDATE public.profiles
          SET couple_id = NULL, role = NULL
          WHERE id = '${BRIDE_ID}'::uuid;
          UPDATE public.profiles
          SET couple_id = '${COUPLE_ID}'::uuid, role = 'bride'
          WHERE id = '${OUTSIDER_ID}'::uuid;
          UPDATE public.couples
          SET bride_id = '${OUTSIDER_ID}'::uuid
          WHERE id = '${COUPLE_ID}'::uuid;
          UPDATE public.amora_privacy_context_epochs
          SET epoch = 8
          WHERE couple_id = '${COUPLE_ID}'::uuid;
        `);
        await setPersona(rosterDb, "service_role");
        await expect(listRefs(rosterDb, {
          recipientId: BRIDE_ID,
          expectedPrivacyEpoch: 8,
        })).rejects.toMatchObject({ code: "P0002" });
        expect(await listRefs(rosterDb, {
          recipientId: OUTSIDER_ID,
          expectedPrivacyEpoch: 8,
        })).toMatchObject({ references: [], partial: false });
      } finally {
        await resetPersona(rosterDb).catch(() => undefined);
        await rosterDb.close();
      }
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
