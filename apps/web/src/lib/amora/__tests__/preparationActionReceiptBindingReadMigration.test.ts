// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260819100000_amora_preparation_action_receipt_binding_read.sql",
);
const migrationExists = existsSync(migrationPath);
const migration = migrationExists ? readFileSync(migrationPath, "utf8") : "";
const contextMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260816120000_amora_preparation_topic_message_refs.sql",
  ),
  "utf8",
);

const RPC_SIGNATURE =
  "public.list_amora_preparation_action_receipt_bindings_v1(uuid,uuid,bigint,uuid[])";
const BRIDE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "10000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "10000000-0000-4000-8000-000000000003";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const PROPOSAL_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_PROPOSAL_ID = "30000000-0000-4000-8000-000000000002";
const ACTION_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_ACTION_ID = "40000000-0000-4000-8000-000000000002";
const PROMOTION_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_PROMOTION_ID = "50000000-0000-4000-8000-000000000002";
const SHARED_MESSAGE_ID = "60000000-0000-4000-8000-000000000001";
const OTHER_SHARED_MESSAGE_ID = "60000000-0000-4000-8000-000000000002";

type BindingRow = {
  proposal_message_id: string;
  couple_id: string;
  action_id: string;
  promotion_id: string;
  proposal_journey_revision: number;
};

type Persona = "anon" | "authenticated" | "service_role";

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

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
  `);
  await db.exec(contextMigration);
  await db.exec(`
    CREATE TABLE public.amora_first_use_action_proposal_bindings (
      proposal_message_id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      action_id uuid NOT NULL,
      promotion_id uuid NOT NULL UNIQUE,
      shared_user_message_id uuid NOT NULL,
      proposal_journey_revision bigint NOT NULL,
      action_digest text NOT NULL,
      bound_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE public.amora_first_use_action_proposal_bindings OWNER TO postgres;
    ALTER TABLE public.amora_first_use_action_proposal_bindings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.amora_first_use_action_proposal_bindings FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.amora_first_use_action_proposal_bindings
      FROM PUBLIC, anon, authenticated, service_role;

    INSERT INTO public.amora_first_use_action_proposal_bindings(
      proposal_message_id, couple_id, action_id, promotion_id,
      shared_user_message_id, proposal_journey_revision, action_digest
    ) VALUES
      (
        '${PROPOSAL_ID}', '${COUPLE_ID}', '${ACTION_ID}', '${PROMOTION_ID}',
        '${SHARED_MESSAGE_ID}', 7, repeat('a', 64)
      ),
      (
        '${OTHER_PROPOSAL_ID}', '${OTHER_COUPLE_ID}', '${OTHER_ACTION_ID}',
        '${OTHER_PROMOTION_ID}', '${OTHER_SHARED_MESSAGE_ID}', 2, repeat('b', 64)
      );
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(db: PGlite, persona: Persona) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [
    persona,
  ]);
  await db.exec(`SET ROLE ${persona}`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function listBindings(
  db: PGlite,
  options: {
    coupleId?: string;
    recipientId?: string;
    expectedPrivacyEpoch?: number;
    promotionIds?: Array<string | null>;
  } = {},
) {
  return db.query<BindingRow>(`
    SELECT *
    FROM public.list_amora_preparation_action_receipt_bindings_v1(
      $1::uuid, $2::uuid, $3::bigint, $4::uuid[]
    )
  `, [
    options.coupleId ?? COUPLE_ID,
    options.recipientId ?? BRIDE_ID,
    options.expectedPrivacyEpoch ?? 7,
    options.promotionIds ?? [PROMOTION_ID],
  ]);
}

function promotionIds(count: number) {
  return Array.from({ length: count }, (_, index) => (
    `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  ));
}

describe("Amora preparation action-receipt binding read migration", () => {
  it("ships the isolated service-only binding-read migration", () => {
    expect(migrationExists).toBe(true);
  });

  it.skipIf(!migrationExists)(
    "returns only the five public binding fields for a current couple member",
    async () => {
      const db = await createDatabase();
      try {
        await setPersona(db, "service_role");
        const brideResult = await listBindings(db, {
          promotionIds: [OTHER_PROMOTION_ID, PROMOTION_ID],
        });
        expect(brideResult.rows).toEqual([{
          proposal_message_id: PROPOSAL_ID,
          couple_id: COUPLE_ID,
          action_id: ACTION_ID,
          promotion_id: PROMOTION_ID,
          proposal_journey_revision: 7,
        }]);
        expect(Object.keys(brideResult.rows[0] ?? {}).sort()).toEqual([
          "action_id",
          "couple_id",
          "promotion_id",
          "proposal_journey_revision",
          "proposal_message_id",
        ]);

        const groomResult = await listBindings(db, { recipientId: GROOM_ID });
        expect(groomResult.rows).toEqual(brideResult.rows);

        await expect(listBindings(db, {
          coupleId: OTHER_COUPLE_ID,
          recipientId: BRIDE_ID,
          expectedPrivacyEpoch: 2,
          promotionIds: [OTHER_PROMOTION_ID],
        })).rejects.toMatchObject({ code: "P0002" });
        await expect(listBindings(db, {
          recipientId: OUTSIDER_ID,
        })).rejects.toMatchObject({ code: "P0002" });
        await expect(listBindings(db, {
          expectedPrivacyEpoch: 6,
        })).rejects.toMatchObject({ code: "40001" });
      } finally {
        await resetPersona(db).catch(() => undefined);
        await db.close();
      }
    },
    30_000,
  );

  it.skipIf(!migrationExists)(
    "rejects empty, duplicate, nullable, and over-limit promotion batches",
    async () => {
      const db = await createDatabase();
      try {
        await setPersona(db, "service_role");
        for (const invalidIds of [
          [],
          [PROMOTION_ID, PROMOTION_ID],
          [PROMOTION_ID, null],
          promotionIds(193),
        ]) {
          await expect(listBindings(db, { promotionIds: invalidIds }))
            .rejects.toMatchObject({ code: "22023" });
        }

        const bounded = await listBindings(db, { promotionIds: promotionIds(192) });
        expect(bounded.rows).toEqual([]);
      } finally {
        await resetPersona(db).catch(() => undefined);
        await db.close();
      }
    },
    30_000,
  );

  it.skipIf(!migrationExists)(
    "pins the helper, owner, timeouts, output contract, and least-privilege ACL",
    async () => {
      const db = await createDatabase();
      try {
        const contract = await db.query<{
          input_names: string[];
          output_names: string[];
          owner_name: string;
          security_definer: boolean;
          config: string[];
          definition: string;
          anon_execute: boolean;
          authenticated_execute: boolean;
          service_execute: boolean;
        }>(`
          SELECT procedure.proargnames[1:4] AS input_names,
                 procedure.proargnames[5:9] AS output_names,
                 pg_get_userbyid(procedure.proowner) AS owner_name,
                 procedure.prosecdef AS security_definer,
                 procedure.proconfig AS config,
                 pg_get_functiondef(procedure.oid) AS definition,
                 has_function_privilege('anon', procedure.oid, 'EXECUTE')
                   AS anon_execute,
                 has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
                   AS authenticated_execute,
                 has_function_privilege('service_role', procedure.oid, 'EXECUTE')
                   AS service_execute
          FROM pg_catalog.pg_proc AS procedure
          WHERE procedure.oid = '${RPC_SIGNATURE}'::regprocedure
        `);
        expect(contract.rows).toHaveLength(1);
        const frozen = contract.rows[0]!;
        expect(frozen).toMatchObject({
          input_names: [
            "p_couple_id",
            "p_recipient_user_id",
            "p_expected_privacy_epoch",
            "p_promotion_ids",
          ],
          output_names: [
            "proposal_message_id",
            "couple_id",
            "action_id",
            "promotion_id",
            "proposal_journey_revision",
          ],
          owner_name: "postgres",
          security_definer: true,
          config: [
            "search_path=pg_catalog, public",
            "lock_timeout=5s",
            "statement_timeout=15s",
          ],
          anon_execute: false,
          authenticated_execute: false,
          service_execute: true,
        });
        expect(frozen.definition).toMatch(
          /amora_preparation_topic_message_ref_context_v1\(\s*p_couple_id,\s*p_recipient_user_id,\s*p_expected_privacy_epoch,\s*false\s*\)/,
        );

        for (const persona of ["anon", "authenticated"] as const) {
          await setPersona(db, persona);
          await expect(listBindings(db)).rejects.toMatchObject({ code: "42501" });
          await expect(db.query(`
            SELECT proposal_message_id
            FROM public.amora_first_use_action_proposal_bindings
          `)).rejects.toMatchObject({ code: "42501" });
        }

        await setPersona(db, "service_role");
        expect((await listBindings(db)).rows).toHaveLength(1);
        await expect(db.query(`
          SELECT proposal_message_id
          FROM public.amora_first_use_action_proposal_bindings
        `)).rejects.toMatchObject({ code: "42501" });

        await resetPersona(db);
        const unchanged = await db.query<{ count: number }>(`
          SELECT count(*)::integer AS count
          FROM public.amora_first_use_action_proposal_bindings
        `);
        expect(unchanged.rows).toEqual([{ count: 2 }]);
      } finally {
        await resetPersona(db).catch(() => undefined);
        await db.close();
      }
    },
    30_000,
  );
});
