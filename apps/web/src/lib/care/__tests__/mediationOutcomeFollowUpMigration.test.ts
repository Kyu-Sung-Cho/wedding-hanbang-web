// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildMediationDecisionFollowUpCandidates } from "@/lib/care/mediationDecisionFollowUp";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812140000_amora_mediation_outcome_follow_up.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const DECISION_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const PROPOSAL_VERSION = "50000000-0000-4000-8000-000000000001";
const ROSTER_FINGERPRINT = "7704026f6654810dd28e75fbf0cd700f";
const DECIDED_AT = "2026-08-10T00:00:00.000Z";

type ClaimResponse = {
  version: number;
  state: string;
  recipientUserId: string;
  coupleId: string;
  card?: {
    id: string;
    revision: number;
    sourceDigest: string;
    outcomeIdempotencyKey: string;
    kind: string;
    visibility: string;
  };
};

type ReceiptResponse = {
  version: number;
  recipientUserId: string;
  coupleId: string;
  receipt: {
    id: string;
    cardId: string;
    cardRevision: number;
    sourceDigest: string;
    outcome: string;
    recordedAt: string;
    idempotencyKey: string;
  };
};

function compilerCandidate(recipientUserId = BRIDE_ID) {
  return buildMediationDecisionFollowUpCandidates({
    coupleId: COUPLE_ID,
    recipientUserId,
    currentRoster: { brideUserId: BRIDE_ID, groomUserId: GROOM_ID },
    safety: { violence: false, coercion: false, privateSafetyHold: false },
    decisions: [{
      id: DECISION_ID,
      couple_id: COUPLE_ID,
      category: "conflict_resolution",
      decision_type: "decided",
      source: "chat",
      source_ref_id: MESSAGE_ID,
      visibility: "shared",
      decided_at: DECIDED_AT,
      superseded_at: null,
      metadata: {
        confirmed_by_both: true,
        acceptance_count: 2,
        proposal_version: PROPOSAL_VERSION,
        roster_fingerprint: ROSTER_FINGERPRINT,
      },
    }],
    now: new Date("2026-08-11T00:00:00.000Z"),
  })[0]!;
}

async function createDatabase(
  options: { includeSafetyMarker?: boolean } = {},
) {
  const safetyMarkerSql = options.includeSafetyMarker === false
    ? ""
    : `,
        'mediation_follow_up_safety', jsonb_build_object(
          'version', 1,
          'violence', false,
          'coercion', false,
          'privateSafetyHold', false,
          'contextComplete', true
        )`;
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
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
      couple_id uuid PRIMARY KEY REFERENCES public.couples(id),
      epoch bigint NOT NULL CHECK (epoch >= 1)
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      sender_id uuid REFERENCES auth.users(id),
      sender_role text,
      sender_type text,
      role text,
      visibility text NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      category text NOT NULL,
      decision_type text NOT NULL,
      title text,
      chosen_value jsonb,
      reasoning text,
      source text NOT NULL,
      source_ref_id uuid REFERENCES public.chat_messages(id),
      visibility text NOT NULL,
      decided_at timestamptz NOT NULL,
      superseded_at timestamptz,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.amora_mediation_acceptances (
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      message_id uuid NOT NULL REFERENCES public.chat_messages(id),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      proposal_resolution text NOT NULL,
      proposal_version uuid NOT NULL,
      proposal_roster_fingerprint text NOT NULL,
      accepted_at timestamptz NOT NULL,
      PRIMARY KEY(message_id, user_id)
    );

    INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom');
    INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch)
      VALUES ('${COUPLE_ID}', 5);
    INSERT INTO public.chat_messages(
      id, couple_id, sender_role, sender_type, role, visibility, content, metadata,
      created_at
    ) VALUES (
      '${MESSAGE_ID}', '${COUPLE_ID}', 'ai', 'ai', 'assistant', 'shared',
      'PRIVATE_RAW_MUST_NOT_COPY',
      jsonb_build_object(
        'mediation', jsonb_build_object(
          'resolution', '둘이 확인한 조율안',
          'proposalVersion', '${PROPOSAL_VERSION}',
          'rosterFingerprint', '${ROSTER_FINGERPRINT}'
        )${safetyMarkerSql}
      ),
      '${DECIDED_AT}'::timestamptz - interval '1 minute'
    );
    INSERT INTO public.decision_nodes(
      id, couple_id, category, decision_type, title, chosen_value, reasoning,
      source, source_ref_id, visibility, decided_at, metadata
    ) VALUES (
      '${DECISION_ID}', '${COUPLE_ID}', 'conflict_resolution', 'decided',
      'PRIVATE_TITLE_MUST_NOT_COPY', jsonb_build_object('value', 'PRIVATE_VALUE'),
      'PRIVATE_REASONING_MUST_NOT_COPY', 'chat', '${MESSAGE_ID}', 'shared',
      '${DECIDED_AT}', jsonb_build_object(
        'confirmed_by_both', true,
        'acceptance_count', 2,
        'proposal_version', '${PROPOSAL_VERSION}',
        'roster_fingerprint', '${ROSTER_FINGERPRINT}'
      )
    );
    INSERT INTO public.amora_mediation_acceptances(
      couple_id, message_id, user_id, proposal_resolution, proposal_version,
      proposal_roster_fingerprint, accepted_at
    ) VALUES
      ('${COUPLE_ID}', '${MESSAGE_ID}', '${BRIDE_ID}', '둘이 확인한 조율안',
       '${PROPOSAL_VERSION}', '${ROSTER_FINGERPRINT}', '${DECIDED_AT}'),
      ('${COUPLE_ID}', '${MESSAGE_ID}', '${GROOM_ID}', '둘이 확인한 조율안',
       '${PROPOSAL_VERSION}', '${ROSTER_FINGERPRINT}', '${DECIDED_AT}');

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role()
      TO anon, authenticated, service_role;
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId?: string,
) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`SET ROLE ${role}`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

async function claim(db: PGlite, recipientUserId = BRIDE_ID) {
  const candidate = compilerCandidate(recipientUserId);
  const result = await db.query<{ value: ClaimResponse }>(`
    SELECT public.claim_amora_mediation_outcome_follow_up(
      $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text
    ) AS value
  `, [COUPLE_ID, recipientUserId, 5, candidate.decisionId, candidate.sourceStateDigest]);
  return result.rows[0]!.value;
}

async function record(
  db: PGlite,
  card: NonNullable<ClaimResponse["card"]>,
  outcome = "resolved",
  recipientUserId = BRIDE_ID,
) {
  const result = await db.query<{ value: ReceiptResponse }>(`
    SELECT public.record_amora_mediation_outcome_follow_up(
      $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::bigint,
      $6::text, $7::text, $8::uuid
    ) AS value
  `, [
    COUPLE_ID,
    recipientUserId,
    5,
    card.id,
    card.revision,
    card.sourceDigest,
    outcome,
    card.outcomeIdempotencyKey,
  ]);
  return result.rows[0]!.value;
}

async function readReceipt(
  db: PGlite,
  idempotencyKey: string,
  recipientUserId = BRIDE_ID,
) {
  const result = await db.query<{ value: ReceiptResponse | null }>(`
    SELECT public.read_amora_mediation_outcome_follow_up_receipt(
      $1::uuid, $2::uuid, $3::bigint, $4::uuid
    ) AS value
  `, [COUPLE_ID, recipientUserId, 5, idempotencyKey]);
  return result.rows[0]!.value;
}

describe("recipient-private mediation outcome follow-up migration", () => {
  it("atomically claims the compiler candidate without copying mediation content", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const first = await claim(db);
      const retry = await claim(db);

      expect(first).toMatchObject({
        version: 1,
        state: "ready",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
        card: {
          revision: 1,
          kind: "mediation_outcome_follow_up",
          visibility: "private",
          sourceDigest: compilerCandidate().sourceStateDigest,
        },
      });
      expect(first).toEqual(retry);
      expect(first.card?.outcomeIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/iu);
      expect(JSON.stringify(first)).not.toMatch(/PRIVATE_|둘이 확인한 조율안/u);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("records only the caller's bounded outcome and leaves every shared or partner row unchanged", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const brideCard = (await claim(db, BRIDE_ID)).card!;
      const groomCard = (await claim(db, GROOM_ID)).card!;
      const first = await record(db, brideCard, "blocked", BRIDE_ID);
      const retry = await record(db, brideCard, "blocked", BRIDE_ID);
      const reread = await readReceipt(db, brideCard.outcomeIdempotencyKey, BRIDE_ID);

      expect(first).toEqual(retry);
      expect(reread).toEqual(first);
      expect(first).toMatchObject({
        version: 1,
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
        receipt: {
          cardId: brideCard.id,
          outcome: "blocked",
          idempotencyKey: brideCard.outcomeIdempotencyKey,
        },
      });

      await resetPersona(db);
      const rows = await db.query<{
        partner_state: string;
        partner_receipts: number;
        decision_count: number;
        acceptance_count: number;
      }>(`
        SELECT
          (SELECT state
           FROM public.amora_mediation_outcome_follow_up_cards
           WHERE id = '${groomCard.id}'::uuid) AS partner_state,
          (SELECT count(*)::integer
           FROM public.amora_mediation_outcome_follow_up_receipts
           WHERE recipient_user_id = '${GROOM_ID}'::uuid) AS partner_receipts,
          (SELECT count(*)::integer FROM public.decision_nodes) AS decision_count,
          (SELECT count(*)::integer FROM public.amora_mediation_acceptances) AS acceptance_count
      `);
      expect(rows.rows[0]).toEqual({
        partner_state: "ready",
        partner_receipts: 0,
        decision_count: 1,
        acceptance_count: 2,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("fails closed for incomplete sealed safety evidence", async () => {
    const incompleteDb = await createDatabase({ includeSafetyMarker: false });
    try {
      await setPersona(incompleteDb, "service_role");
      expect(await claim(incompleteDb)).toEqual({
        version: 1,
        state: "none",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
      });
    } finally {
      await resetPersona(incompleteDb).catch(() => undefined);
      await incompleteDb.close();
    }

  }, 30_000);

  it("seals an opaque server hold and blocks claim, record, and read across devices and privacy epochs", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const brideCard = (await claim(db, BRIDE_ID)).card!;
      const groomCard = (await claim(db, GROOM_ID)).card!;
      const groomReceipt = await record(db, groomCard, "resolved", GROOM_ID);

      const sealedBride = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.seal_amora_mediation_private_safety_hold(
          '${COUPLE_ID}'::uuid,
          '${BRIDE_ID}'::uuid
        ) AS value
      `);
      const sealedGroom = await db.query<{ value: Record<string, unknown> }>(`
        SELECT public.seal_amora_mediation_private_safety_hold(
          '${COUPLE_ID}'::uuid,
          '${GROOM_ID}'::uuid
        ) AS value
      `);
      expect(sealedBride.rows[0]?.value).toMatchObject({
        version: 1,
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
        privacyEpoch: 5,
        active: true,
      });
      expect(sealedGroom.rows[0]?.value).toMatchObject({
        version: 1,
        recipientUserId: GROOM_ID,
        coupleId: COUPLE_ID,
        privacyEpoch: 5,
        active: true,
      });
      expect(await claim(db, BRIDE_ID)).toEqual({
        version: 1,
        state: "none",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
      });
      await expect(record(db, brideCard, "blocked", BRIDE_ID))
        .rejects.toMatchObject({ code: "40001" });
      await expect(readReceipt(
        db,
        groomReceipt.receipt.idempotencyKey,
        GROOM_ID,
      )).rejects.toMatchObject({ code: "40001" });

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 6
        WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      const candidate = compilerCandidate(BRIDE_ID);
      const bumpedClaim = await db.query<{ value: ClaimResponse }>(`
        SELECT public.claim_amora_mediation_outcome_follow_up(
          $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text
        ) AS value
      `, [
        COUPLE_ID,
        BRIDE_ID,
        6,
        candidate.decisionId,
        candidate.sourceStateDigest,
      ]);
      expect(bumpedClaim.rows[0]?.value).toEqual({
        version: 1,
        state: "none",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
      });

      await resetPersona(db);
      const columns = await db.query<{ attname: string }>(`
        SELECT attribute.attname
        FROM pg_attribute AS attribute
        WHERE attribute.attrelid =
          'public.amora_mediation_private_safety_holds'::regclass
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attname IN (
            'content', 'raw_text', 'summary', 'requester_summary', 'reason',
            'reasoning', 'classification', 'partner_emotion', 'partner_intent',
            'note', 'free_text'
          )
      `);
      expect(columns.rows).toEqual([]);

      const schema = await db.query<{ relforcerowsecurity: boolean }>(`
        SELECT relforcerowsecurity
        FROM pg_class
        WHERE oid = 'public.amora_mediation_private_safety_holds'::regclass
      `);
      expect(schema.rows).toEqual([{ relforcerowsecurity: true }]);

      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query(
        "SELECT * FROM public.amora_mediation_private_safety_holds",
      )).rejects.toMatchObject({ code: "42501" });
      await expect(db.query(`
        SELECT public.seal_amora_mediation_private_safety_hold(
          '${COUPLE_ID}'::uuid,
          '${BRIDE_ID}'::uuid
        )
      `)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("does not create a fresh card after the private 30-day response window expired", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        UPDATE public.decision_nodes
        SET decided_at = clock_timestamp() - interval '31 days'
        WHERE id = '${DECISION_ID}'::uuid
      `);
      const digest = await db.query<{ value: string }>(`
        SELECT public.amora_mediation_outcome_follow_up_source_digest(
          '${DECISION_ID}'::uuid,
          '${MESSAGE_ID}'::uuid,
          '${PROPOSAL_VERSION}'::uuid,
          '${ROSTER_FINGERPRINT}'::text,
          '${BRIDE_ID}'::uuid,
          decision.decided_at + interval '24 hours'
        ) AS value
        FROM public.decision_nodes AS decision
        WHERE decision.id = '${DECISION_ID}'::uuid
      `);
      await setPersona(db, "service_role");
      const result = await db.query<{ value: ClaimResponse }>(`
        SELECT public.claim_amora_mediation_outcome_follow_up(
          $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text
        ) AS value
      `, [COUPLE_ID, BRIDE_ID, 5, DECISION_ID, digest.rows[0]!.value]);

      expect(result.rows[0]!.value).toEqual({
        version: 1,
        state: "none",
        recipientUserId: BRIDE_ID,
        coupleId: COUPLE_ID,
      });
      await resetPersona(db);
      const stored = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.amora_mediation_outcome_follow_up_cards
      `);
      expect(stored.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("seals the bounded safety marker so it cannot be added, removed, or rewritten later", async () => {
    const db = await createDatabase();
    try {
      await expect(db.exec(`
        UPDATE public.chat_messages
        SET metadata = metadata - 'mediation_follow_up_safety'
        WHERE id = '${MESSAGE_ID}'::uuid
      `)).rejects.toMatchObject({ code: "55000" });
      await expect(db.exec(`
        UPDATE public.chat_messages
        SET metadata = jsonb_set(
          metadata,
          '{mediation_follow_up_safety,violence}',
          'true'::jsonb
        )
        WHERE id = '${MESSAGE_ID}'::uuid
      `)).rejects.toMatchObject({ code: "55000" });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("exposes neither private tables nor service RPCs to authenticated clients", async () => {
    const db = await createDatabase();
    try {
      expect(migration).not.toMatch(
        /\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.(?:amora_actions|amora_today_one_[a-z0-9_]+)/iu,
      );
      const schema = await db.query<{ relname: string; relforcerowsecurity: boolean }>(`
        SELECT relname, relforcerowsecurity
        FROM pg_class
        WHERE relname IN (
          'amora_mediation_outcome_follow_up_cards',
          'amora_mediation_outcome_follow_up_receipts',
          'amora_mediation_private_safety_holds'
        )
        ORDER BY relname
      `);
      expect(schema.rows).toEqual([
        {
          relname: "amora_mediation_outcome_follow_up_cards",
          relforcerowsecurity: true,
        },
        {
          relname: "amora_mediation_outcome_follow_up_receipts",
          relforcerowsecurity: true,
        },
        {
          relname: "amora_mediation_private_safety_holds",
          relforcerowsecurity: true,
        },
      ]);
      const contentColumns = await db.query<{ attname: string }>(`
        SELECT attribute.attname
        FROM pg_attribute AS attribute
        WHERE attribute.attrelid IN (
          'public.amora_mediation_outcome_follow_up_cards'::regclass,
          'public.amora_mediation_outcome_follow_up_receipts'::regclass,
          'public.amora_mediation_private_safety_holds'::regclass
        )
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attname IN (
            'content', 'raw_text', 'summary', 'requester_summary', 'reasoning',
            'chosen_value', 'partner_emotion', 'partner_intent', 'note', 'free_text'
          )
      `);
      expect(contentColumns.rows).toEqual([]);

      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(db.query(
        "SELECT * FROM public.amora_mediation_outcome_follow_up_cards",
      )).rejects.toMatchObject({ code: "42501" });
      await expect(db.query(
        "SELECT * FROM public.amora_mediation_outcome_follow_up_receipts",
      )).rejects.toMatchObject({ code: "42501" });
      await expect(db.query(`
        SELECT public.claim_amora_mediation_outcome_follow_up(
          '${COUPLE_ID}'::uuid, '${BRIDE_ID}'::uuid, 5,
          '${DECISION_ID}'::uuid, '${compilerCandidate().sourceStateDigest}'::text
        )
      `)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rechecks safety, privacy epoch, and roster before every outcome write", async () => {
    const safetyDb = await createDatabase();
    try {
      await setPersona(safetyDb, "service_role");
      const card = (await claim(safetyDb)).card!;
      await safetyDb.query(`
        SELECT public.seal_amora_mediation_private_safety_hold(
          '${COUPLE_ID}'::uuid,
          '${BRIDE_ID}'::uuid
        )
      `);
      await expect(record(safetyDb, card)).rejects.toMatchObject({ code: "40001" });
    } finally {
      await resetPersona(safetyDb).catch(() => undefined);
      await safetyDb.close();
    }

    const privacyDb = await createDatabase();
    try {
      await setPersona(privacyDb, "service_role");
      const card = (await claim(privacyDb)).card!;
      await resetPersona(privacyDb);
      await privacyDb.exec(`
        UPDATE public.amora_privacy_context_epochs
        SET epoch = 6 WHERE couple_id = '${COUPLE_ID}'::uuid
      `);
      await setPersona(privacyDb, "service_role");
      await expect(record(privacyDb, card)).rejects.toMatchObject({ code: "40001" });
    } finally {
      await resetPersona(privacyDb).catch(() => undefined);
      await privacyDb.close();
    }

    const rosterDb = await createDatabase();
    try {
      await setPersona(rosterDb, "service_role");
      const card = (await claim(rosterDb)).card!;
      await resetPersona(rosterDb);
      await rosterDb.exec(`
        UPDATE public.couples SET bride_id = NULL
        WHERE id = '${COUPLE_ID}'::uuid
      `);
      await setPersona(rosterDb, "service_role");
      await expect(record(rosterDb, card)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await resetPersona(rosterDb).catch(() => undefined);
      await rosterDb.close();
    }
  }, 60_000);

  it("locks decision provenance before the private card in every mutating RPC", async () => {
    const db = await createDatabase();
    try {
      const definitions = await db.query<{ proname: string; prosrc: string }>(`
        SELECT proname, prosrc
        FROM pg_proc
        WHERE proname IN (
          'claim_amora_mediation_outcome_follow_up',
          'record_amora_mediation_outcome_follow_up',
          'read_amora_mediation_outcome_follow_up_receipt'
        )
      `);
      const byName = new Map(definitions.rows.map((row) => [row.proname, row.prosrc]));
      for (const name of [
        "claim_amora_mediation_outcome_follow_up",
        "record_amora_mediation_outcome_follow_up",
        "read_amora_mediation_outcome_follow_up_receipt",
      ]) {
        const source = byName.get(name) ?? "";
        const coupleLock = source.indexOf("FROM public.couples AS couple");
        const coupleUpdate = source.indexOf("FOR UPDATE;", coupleLock);
        const profileLock = source.indexOf("FROM public.profiles AS profile");
        expect(coupleLock, `${name} couple lock`).toBeGreaterThan(-1);
        expect(coupleUpdate, `${name} couple serialization lock`)
          .toBeGreaterThan(coupleLock);
        expect(profileLock, `${name} profile lock`).toBeGreaterThan(coupleUpdate);
        const safetyHoldLock = source.indexOf(
          "FROM public.amora_mediation_private_safety_holds AS hold",
        );
        expect(safetyHoldLock, `${name} durable safety hold lock`)
          .toBeGreaterThan(profileLock);
        const decisionLock = source.indexOf("FROM public.decision_nodes");
        const messageLock = source.indexOf("FROM public.chat_messages");
        const acceptanceLock = source.indexOf(
          "FROM public.amora_mediation_acceptances AS acceptance",
        );
        const cardLock = source.indexOf(
          "FROM public.amora_mediation_outcome_follow_up_cards AS card",
        );
        expect(decisionLock, `${name} decision lock`).toBeGreaterThan(safetyHoldLock);
        expect(messageLock, `${name} message lock`).toBeGreaterThan(decisionLock);
        expect(acceptanceLock, `${name} acceptance lock`).toBeGreaterThan(messageLock);
        expect(cardLock, `${name} card lock`).toBeGreaterThan(acceptanceLock);
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});
