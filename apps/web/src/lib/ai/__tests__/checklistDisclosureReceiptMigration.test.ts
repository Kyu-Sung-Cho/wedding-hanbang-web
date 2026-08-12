// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812193000_checklist_disclosure_receipt.sql",
  ),
  "utf8",
);

const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const NEW_GROOM_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

const databases: PGlite[] = [];

async function createDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;

    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    CREATE FUNCTION extensions.gen_random_bytes(size integer)
    RETURNS bytea LANGUAGE sql VOLATILE AS $$
      SELECT decode(
        string_agg(lpad(to_hex(floor(random() * 256)::integer), 2, '0'), ''),
        'hex'
      )
      FROM generate_series(1, size)
    $$;
    CREATE FUNCTION extensions.digest(value bytea, algorithm text)
    RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
      SELECT decode(
        md5(encode(value, 'hex')) || md5(encode(value, 'hex') || algorithm),
        'hex'
      )
    $$;
    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE,
      state_revision bigint NOT NULL
    );
    CREATE TABLE public.couple_plan_change_requests (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL,
      base_revision bigint NOT NULL,
      changes jsonb NOT NULL,
      change_digest text NOT NULL,
      roster_fingerprint text NOT NULL,
      is_high_impact boolean NOT NULL,
      required_count smallint NOT NULL,
      status text NOT NULL,
      expires_at timestamptz NOT NULL,
      surface_href text NOT NULL
    );
    CREATE TABLE public.couple_plan_change_acceptances (
      request_id uuid NOT NULL,
      couple_id uuid NOT NULL,
      user_id uuid NOT NULL,
      change_digest text NOT NULL,
      roster_fingerprint text NOT NULL,
      PRIMARY KEY (request_id, user_id)
    );
    CREATE TABLE public.accept_call_audit (
      request_id uuid NOT NULL,
      actor_user_id uuid NOT NULL
    );

    CREATE FUNCTION public.is_current_couple_member(
      user_id uuid,
      target_couple uuid
    ) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.profiles AS profile
        WHERE profile.id = user_id
          AND profile.couple_id = target_couple
      )
    $$;
    CREATE FUNCTION public.couple_plan_change_digest(value jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE AS $$
      SELECT md5(value::text) || md5(value::text)
    $$;
    CREATE FUNCTION public.accept_couple_plan_change(
      request_id uuid,
      target_couple uuid,
      actor_user_id uuid
    ) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE
      request_row public.couple_plan_change_requests%ROWTYPE;
    BEGIN
      SELECT request.* INTO request_row
      FROM public.couple_plan_change_requests AS request
      WHERE request.id = request_id
        AND request.couple_id = target_couple;
      INSERT INTO public.couple_plan_change_acceptances(
        request_id, couple_id, user_id, change_digest, roster_fingerprint
      ) VALUES (
        request_row.id,
        request_row.couple_id,
        actor_user_id,
        request_row.change_digest,
        request_row.roster_fingerprint
      ) ON CONFLICT DO NOTHING;
      INSERT INTO public.accept_call_audit VALUES (request_id, actor_user_id);
      RETURN jsonb_build_object(
        'requestId', request_id,
        'status', 'pending_partner'
      );
    END
    $$;
    CREATE FUNCTION public.couple_plan_change_result(target_request_id uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object(
        'requestId', request.id,
        'status', CASE
          WHEN request.status = 'pending' THEN 'pending_partner'
          ELSE request.status
        END
      )
      FROM public.couple_plan_change_requests AS request
      WHERE request.id = target_request_id
    $$;
  `);
  await db.exec(migrationSql);
  await db.exec(`
    SELECT set_config('request.jwt.claim.role', 'service_role', false);
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(id, couple_id) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}'),
      ('${GROOM_ID}', '${COUPLE_ID}'),
      ('${NEW_GROOM_ID}', '${COUPLE_ID}');
    INSERT INTO public.wedding_journeys(couple_id, state_revision)
      VALUES ('${COUPLE_ID}', 7);
  `);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

function checklistChanges(answer = "no") {
  return {
    progress_patch: {
      __checklist_profile: {
        version: 1,
        reviewedAt: "2026-08-12T12:00:00.000Z",
        answers: { ceremony: answer },
        autoExcludedItemIds: [],
      },
    },
  };
}

async function seedRequest(
  db: PGlite,
  options: {
    changes?: Record<string, unknown>;
    surface?: string;
    highImpact?: boolean;
    expiresAt?: string;
  } = {},
) {
  const changes = options.changes ?? checklistChanges();
  const roster = await db.query<{ fingerprint: string }>(
    "SELECT md5($1::text || ':' || $2::text) AS fingerprint",
    [BRIDE_ID, GROOM_ID],
  );
  await db.query(
    `INSERT INTO public.couple_plan_change_requests(
       id, couple_id, base_revision, changes, change_digest,
       roster_fingerprint, is_high_impact, required_count, status,
       expires_at, surface_href
     ) VALUES (
       $1, $2, 7, $3::jsonb, public.couple_plan_change_digest($3::jsonb),
       $4, $5, 2, 'pending', $6::timestamptz, $7
     )`,
    [
      REQUEST_ID,
      COUPLE_ID,
      JSON.stringify(changes),
      roster.rows[0].fingerprint,
      options.highImpact ?? true,
      options.expiresAt ?? "2099-08-12T12:00:00.000Z",
      options.surface ?? "/schedule",
    ],
  );
}

async function issueReceipt(db: PGlite, actorId = GROOM_ID) {
  const request = await db.query<{
    base_revision: string;
    change_digest: string;
  }>(
    `SELECT base_revision::text, change_digest
     FROM public.couple_plan_change_requests
     WHERE id = $1`,
    [REQUEST_ID],
  );
  const result = await db.query<{ receipt: string }>(
    `SELECT public.issue_checklist_plan_change_disclosure_receipt(
       $1, $2, $3, $4, $5
     ) AS receipt`,
    [
      REQUEST_ID,
      COUPLE_ID,
      actorId,
      Number(request.rows[0].base_revision),
      request.rows[0].change_digest,
    ],
  );
  return result.rows[0].receipt;
}

async function acceptWithReceipt(
  db: PGlite,
  receipt: string | null,
  actorId = GROOM_ID,
) {
  return db.query(
    `SELECT public.accept_couple_plan_change_with_disclosure(
       $1, $2, $3, $4
     ) AS result`,
    [REQUEST_ID, COUPLE_ID, actorId, receipt],
  );
}

describe("checklist disclosure receipt migration", () => {
  it("issues an opaque reviewer-specific receipt without recording acceptance", async () => {
    const db = await createDatabase();
    await seedRequest(db);

    const brideReceipt = await issueReceipt(db, BRIDE_ID);
    const groomReceipt = await issueReceipt(db, GROOM_ID);

    expect(brideReceipt).toMatch(/^[a-f0-9]{64}$/);
    expect(groomReceipt).toMatch(/^[a-f0-9]{64}$/);
    expect(brideReceipt).not.toBe(groomReceipt);
    const stored = await db.query<{ token_hash: string }>(
      `SELECT token_hash
       FROM public.couple_plan_change_disclosure_receipts
       ORDER BY token_hash`,
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.map(({ token_hash }) => token_hash)).not.toContain(
      brideReceipt,
    );
    expect(stored.rows.map(({ token_hash }) => token_hash)).not.toContain(
      groomReceipt,
    );
    const acceptances = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.couple_plan_change_acceptances",
    );
    expect(acceptances.rows[0].count).toBe(0);
  });

  it("rejects a forged no-GET token and recovers same-actor and terminal lost-response retries", async () => {
    const db = await createDatabase();
    await seedRequest(db);
    const receipt = await issueReceipt(db);

    await expect(acceptWithReceipt(db, null)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_DISCLOSURE_REQUIRED/,
    );
    await expect(acceptWithReceipt(db, "f".repeat(64))).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_DISCLOSURE_MISMATCH/,
    );
    await expect(acceptWithReceipt(db, receipt)).resolves.toBeDefined();
    await expect(acceptWithReceipt(db, receipt)).resolves.toBeDefined();
    await db.exec(`
      UPDATE public.couple_plan_change_requests SET status = 'applied'
      WHERE id = '${REQUEST_ID}'
    `);
    await expect(acceptWithReceipt(db, null)).resolves.toBeDefined();
    const calls = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.accept_call_audit",
    );
    expect(calls.rows[0].count).toBe(1);
    const consumed = await db.query<{
      count: number;
      consumed_count: number;
    }>(`
      SELECT count(*)::integer AS count,
             count(consumed_at)::integer AS consumed_count
      FROM public.couple_plan_change_disclosure_receipts
    `);
    expect(consumed.rows[0]).toEqual({ count: 1, consumed_count: 1 });
  });

  it("keeps five outstanding random receipts for safe multi-tab review", async () => {
    const db = await createDatabase();
    await seedRequest(db);
    const receipts: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      receipts.push(await issueReceipt(db));
    }

    expect(new Set(receipts).size).toBe(7);
    const stored = await db.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM public.couple_plan_change_disclosure_receipts`,
    );
    expect(stored.rows[0].count).toBe(5);
    await expect(acceptWithReceipt(db, receipts[0])).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_DISCLOSURE_MISMATCH/,
    );
    await expect(acceptWithReceipt(db, receipts[6])).resolves.toBeDefined();
  });

  it("serializes concurrent issuance and accepts only one concurrent decision", async () => {
    const db = await createDatabase();
    await seedRequest(db);
    const [firstReceipt, secondReceipt] = await Promise.all([
      issueReceipt(db),
      issueReceipt(db),
    ]);
    expect(firstReceipt).not.toBe(secondReceipt);
    const issued = await db.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM public.couple_plan_change_disclosure_receipts`,
    );
    expect(issued.rows[0].count).toBe(2);

    const decisions = await Promise.allSettled([
      acceptWithReceipt(db, firstReceipt),
      acceptWithReceipt(db, secondReceipt),
    ]);
    expect(decisions.every(({ status }) => status === "fulfilled")).toBe(true);
    const calls = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.accept_call_audit",
    );
    expect(calls.rows[0].count).toBe(1);
  });

  it("binds a token to its reviewer and rejects an expired token", async () => {
    const wrongReviewerDb = await createDatabase();
    await seedRequest(wrongReviewerDb);
    const groomReceipt = await issueReceipt(wrongReviewerDb, GROOM_ID);
    await expect(
      acceptWithReceipt(wrongReviewerDb, groomReceipt, BRIDE_ID),
    ).rejects.toThrow(/COUPLE_PLAN_CHANGE_DISCLOSURE_MISMATCH/);

    const expiredDb = await createDatabase();
    await seedRequest(expiredDb);
    const expiredReceipt = await issueReceipt(expiredDb);
    await expiredDb.exec(`
      UPDATE public.couple_plan_change_disclosure_receipts
      SET created_at = clock_timestamp() - interval '20 minutes',
          expires_at = clock_timestamp() - interval '1 minute'
    `);
    await expect(
      acceptWithReceipt(expiredDb, expiredReceipt),
    ).rejects.toThrow(/COUPLE_PLAN_CHANGE_DISCLOSURE_EXPIRED/);
  });

  it("invalidates a receipt when the exact proposal digest changes", async () => {
    const db = await createDatabase();
    await seedRequest(db);
    const oldReceipt = await issueReceipt(db);
    const changed = checklistChanges("yes");
    await db.query(
      `UPDATE public.couple_plan_change_requests
       SET changes = $1::jsonb,
           change_digest = public.couple_plan_change_digest($1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(changed), REQUEST_ID],
    );

    await expect(acceptWithReceipt(db, oldReceipt)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_DISCLOSURE_MISMATCH/,
    );
    const nextReceipt = await issueReceipt(db);
    expect(nextReceipt).not.toBe(oldReceipt);
  });

  it("invalidates a receipt when its base revision changes", async () => {
    const db = await createDatabase();
    await seedRequest(db);
    const oldReceipt = await issueReceipt(db);
    await db.exec(`
      UPDATE public.wedding_journeys SET state_revision = 8
      WHERE couple_id = '${COUPLE_ID}';
      UPDATE public.couple_plan_change_requests SET base_revision = 8
      WHERE id = '${REQUEST_ID}';
    `);

    await expect(acceptWithReceipt(db, oldReceipt)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_DISCLOSURE_MISMATCH/,
    );
  });

  it("refuses to mint for a row that changed after the disclosed proposal read", async () => {
    const db = await createDatabase();
    await seedRequest(db);
    const disclosed = await db.query<{
      base_revision: string;
      change_digest: string;
    }>(
      `SELECT base_revision::text, change_digest
       FROM public.couple_plan_change_requests
       WHERE id = $1`,
      [REQUEST_ID],
    );
    const changed = checklistChanges("yes");
    await db.query(
      `UPDATE public.couple_plan_change_requests
       SET changes = $1::jsonb,
           change_digest = public.couple_plan_change_digest($1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(changed), REQUEST_ID],
    );

    await expect(db.query(
      `SELECT public.issue_checklist_plan_change_disclosure_receipt(
         $1, $2, $3, $4, $5
       )`,
      [
        REQUEST_ID,
        COUPLE_ID,
        GROOM_ID,
        Number(disclosed.rows[0].base_revision),
        disclosed.rows[0].change_digest,
      ],
    )).rejects.toThrow(/COUPLE_PLAN_CHANGE_DISCLOSURE_CONFLICT/);
  });

  it("rejects expired, stale-revision, corrupt-digest, and roster-changed requests", async () => {
    const expiredDb = await createDatabase();
    await seedRequest(expiredDb, { expiresAt: "2000-01-01T00:00:00.000Z" });
    await expect(issueReceipt(expiredDb)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_DISCLOSURE_EXPIRED/,
    );

    const staleDb = await createDatabase();
    await seedRequest(staleDb);
    await staleDb.exec(
      `UPDATE public.wedding_journeys SET state_revision = 8
       WHERE couple_id = '${COUPLE_ID}'`,
    );
    await expect(issueReceipt(staleDb)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_DISCLOSURE_CONFLICT/,
    );

    const corruptDb = await createDatabase();
    await seedRequest(corruptDb);
    await corruptDb.exec(
      `UPDATE public.couple_plan_change_requests SET change_digest = repeat('a', 64)
       WHERE id = '${REQUEST_ID}'`,
    );
    await expect(issueReceipt(corruptDb)).rejects.toThrow(
      /COUPLE_PLAN_CHANGE_DISCLOSURE_CONFLICT/,
    );

    const rosterDb = await createDatabase();
    await seedRequest(rosterDb);
    const oldReceipt = await issueReceipt(rosterDb, BRIDE_ID);
    await rosterDb.exec(`
      UPDATE public.couples SET groom_id = '${NEW_GROOM_ID}'
      WHERE id = '${COUPLE_ID}';
      UPDATE public.couple_plan_change_requests
      SET roster_fingerprint = md5('${BRIDE_ID}:${NEW_GROOM_ID}')
      WHERE id = '${REQUEST_ID}';
    `);
    await expect(
      acceptWithReceipt(rosterDb, oldReceipt, BRIDE_ID),
    ).rejects.toThrow(/COUPLE_PLAN_CHANGE_DISCLOSURE_MISMATCH/);
  });

  it("preserves empty-body approval only for ordinary plan changes", async () => {
    const db = await createDatabase();
    await seedRequest(db, {
      changes: { total_budget: 40_000_000 },
      surface: "/budget",
    });

    await expect(acceptWithReceipt(db, null)).resolves.toBeDefined();

    const secondDb = await createDatabase();
    await seedRequest(secondDb, {
      changes: { total_budget: 40_000_000 },
      surface: "/budget",
    });
    await expect(
      acceptWithReceipt(secondDb, "f".repeat(64)),
    ).rejects.toThrow(/COUPLE_PLAN_CHANGE_DISCLOSURE_UNEXPECTED/);
  });

  it("keeps both receipt RPCs private to the service role", async () => {
    const db = await createDatabase();
    const privileges = await db.query<{
      anon_issue: boolean;
      authenticated_issue: boolean;
      service_issue: boolean;
      anon_accept: boolean;
      authenticated_accept: boolean;
      service_accept: boolean;
      anon_table: boolean;
      authenticated_table: boolean;
      service_table: boolean;
      row_security: boolean;
    }>(`
      SELECT
        has_function_privilege(
          'anon',
          'public.issue_checklist_plan_change_disclosure_receipt(uuid,uuid,uuid,bigint,text)',
          'EXECUTE'
        ) AS anon_issue,
        has_function_privilege(
          'authenticated',
          'public.issue_checklist_plan_change_disclosure_receipt(uuid,uuid,uuid,bigint,text)',
          'EXECUTE'
        ) AS authenticated_issue,
        has_function_privilege(
          'service_role',
          'public.issue_checklist_plan_change_disclosure_receipt(uuid,uuid,uuid,bigint,text)',
          'EXECUTE'
        ) AS service_issue,
        has_function_privilege(
          'anon',
          'public.accept_couple_plan_change_with_disclosure(uuid,uuid,uuid,text)',
          'EXECUTE'
        ) AS anon_accept,
        has_function_privilege(
          'authenticated',
          'public.accept_couple_plan_change_with_disclosure(uuid,uuid,uuid,text)',
          'EXECUTE'
        ) AS authenticated_accept,
        has_function_privilege(
          'service_role',
          'public.accept_couple_plan_change_with_disclosure(uuid,uuid,uuid,text)',
          'EXECUTE'
        ) AS service_accept,
        has_table_privilege(
          'anon', 'public.couple_plan_change_disclosure_receipts', 'SELECT'
        ) AS anon_table,
        has_table_privilege(
          'authenticated', 'public.couple_plan_change_disclosure_receipts', 'SELECT'
        ) AS authenticated_table,
        has_table_privilege(
          'service_role', 'public.couple_plan_change_disclosure_receipts', 'SELECT'
        ) AS service_table,
        (
          SELECT class.relrowsecurity
          FROM pg_catalog.pg_class AS class
          WHERE class.oid =
            'public.couple_plan_change_disclosure_receipts'::regclass
        ) AS row_security
    `);
    expect(privileges.rows[0]).toEqual({
      anon_issue: false,
      authenticated_issue: false,
      service_issue: true,
      anon_accept: false,
      authenticated_accept: false,
      service_accept: true,
      anon_table: false,
      authenticated_table: false,
      service_table: false,
      row_security: true,
    });
  });
});
