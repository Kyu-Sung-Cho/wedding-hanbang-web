// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const privacyExpandMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260714160000_harden_amora_privacy_boundaries.sql"
  ),
  "utf8"
);
const privacyContractMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/contract-migrations/20260714165000_contract_amora_privacy_boundaries.sql"
  ),
  "utf8"
);
const accountContractMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/contract-migrations/20260714166000_contract_profile_couple_boundaries.sql"
  ),
  "utf8"
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const MISSING_PROFILE_ID = "00000000-0000-4000-8000-000000000004";
const CREATOR_ID = "00000000-0000-4000-8000-000000000005";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const OPEN_COUPLE_ID = "10000000-0000-4000-8000-000000000002";

async function createSupabaseLikeDatabase(applyContract = true) {
  const db = await PGlite.create();

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invite_code text NOT NULL UNIQUE,
      bride_id uuid,
      groom_id uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      email text,
      name text,
      role text,
      couple_id uuid,
      user_type text DEFAULT 'user',
      is_admin boolean DEFAULT false,
      consents jsonb DEFAULT '{}'::jsonb,
      phone text,
      push_token text,
      phone_care_consented_at timestamptz,
      onboarding_completed boolean DEFAULT false,
      onboarding_step integer DEFAULT 0,
      shared_chat_cleared_at timestamptz,
      private_chat_cleared_at timestamptz,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY,
      couple_id uuid,
      visibility text NOT NULL,
      content text
    );

    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY,
      couple_id uuid,
      visibility text NOT NULL,
      reasoning text
    );

    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY,
      created_at timestamptz NOT NULL,
      user_id uuid,
      user_input text,
      ai_output text,
      tool_input jsonb,
      tool_output jsonb,
      metadata jsonb DEFAULT '{}'::jsonb
    );

    CREATE TABLE public.amora_couple_profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL,
      sender_type text NOT NULL,
      content text NOT NULL,
      role text NOT NULL,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now(),
      sender_id uuid,
      sender_role text,
      stage_tag text,
      specialist_type text,
      visibility text NOT NULL DEFAULT 'shared'
    );

    ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.chat_summaries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.decision_nodes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.ai_interactions_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.amora_couple_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

    CREATE FUNCTION public.is_couple_member(p_couple_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.couples AS couple
        WHERE couple.id = p_couple_id
          AND (couple.bride_id = auth.uid() OR couple.groom_id = auth.uid())
      )
    $$;

    CREATE FUNCTION public.generate_invite_code()
    RETURNS text
    LANGUAGE sql
    AS $$ SELECT 'WH-TEST000001'::text $$;

    CREATE FUNCTION public.join_couple(text, text)
    RETURNS jsonb
    LANGUAGE sql
    AS $$ SELECT '{}'::jsonb $$;

    CREATE FUNCTION public.create_profile_on_signup()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RETURN NEW; END $$;

    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.create_profile_on_signup();

    CREATE FUNCTION public.redact_old_ai_interactions(
      p_retention interval DEFAULT interval '90 days'
    )
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      v_count integer;
    BEGIN
      UPDATE public.ai_interactions_log
      SET user_input = '[legacy-redacted]'
      WHERE created_at < now() - p_retention;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      RETURN v_count;
    END
    $$;

    CREATE POLICY couples_select_own ON public.couples
      FOR SELECT TO authenticated
      USING (bride_id = auth.uid() OR groom_id = auth.uid());
    CREATE POLICY couples_insert_own ON public.couples
      FOR INSERT TO authenticated
      WITH CHECK (bride_id = auth.uid() OR groom_id = auth.uid());
    CREATE POLICY profiles_select_related ON public.profiles
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY profiles_insert_own ON public.profiles
      FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
    CREATE POLICY chat_summaries_select_couple ON public.chat_summaries
      FOR SELECT TO authenticated USING (public.is_couple_member(couple_id));
    CREATE POLICY decision_nodes_owner_all ON public.decision_nodes
      FOR ALL TO PUBLIC
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));
    CREATE POLICY decision_nodes_select_with_privacy ON public.decision_nodes
      FOR SELECT TO PUBLIC USING (true);
    CREATE POLICY "Allow AI message insert" ON public.chat_messages
      FOR INSERT TO PUBLIC
      WITH CHECK (couple_id IN (SELECT couple_id FROM public.profiles WHERE id = auth.uid()));
    CREATE POLICY chat_insert_couple ON public.chat_messages
      FOR INSERT TO PUBLIC
      WITH CHECK (public.is_couple_member(couple_id));
    CREATE POLICY couple_members_can_insert_messages ON public.chat_messages
      FOR INSERT TO PUBLIC
      WITH CHECK (public.is_couple_member(couple_id));
    CREATE POLICY couple_members_can_delete_messages ON public.chat_messages
      FOR DELETE TO PUBLIC
      USING (public.is_couple_member(couple_id));

    GRANT ALL ON TABLE public.couples, public.profiles, public.chat_summaries,
      public.decision_nodes, public.ai_interactions_log,
      public.amora_couple_profiles, public.chat_messages
      TO anon, authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

    INSERT INTO public.couples (id, invite_code, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', 'WH-PAIR000001', '${BRIDE_ID}', '${GROOM_ID}');

    INSERT INTO public.profiles (
      id, email, name, role, couple_id, user_type, is_admin, consents, phone
    ) VALUES
      ('${BRIDE_ID}', 'bride@example.invalid', 'Bride', 'bride', '${COUPLE_ID}', 'user', false, '{"marketing":false}', '01011112222'),
      ('${GROOM_ID}', 'groom@example.invalid', 'Groom', 'groom', '${COUPLE_ID}', 'user', false, '{"marketing":true}', '01033334444');

    INSERT INTO public.chat_summaries (id, couple_id, visibility, content) VALUES
      ('20000000-0000-4000-8000-000000000001', '${COUPLE_ID}', 'shared', 'shared'),
      ('20000000-0000-4000-8000-000000000002', '${COUPLE_ID}', 'bride_private', 'bride'),
      ('20000000-0000-4000-8000-000000000003', '${COUPLE_ID}', 'groom_private', 'groom');

    INSERT INTO public.decision_nodes (id, couple_id, visibility, reasoning) VALUES
      ('30000000-0000-4000-8000-000000000001', '${COUPLE_ID}', 'shared', 'shared'),
      ('30000000-0000-4000-8000-000000000002', '${COUPLE_ID}', 'bride_private', 'bride'),
      ('30000000-0000-4000-8000-000000000003', '${COUPLE_ID}', 'groom_private', 'groom');

    INSERT INTO public.ai_interactions_log (
      id, created_at, user_id, user_input, ai_output, tool_input, tool_output
    ) VALUES
      (
        '40000000-0000-4000-8000-000000000001',
        now() - interval '100 days',
        '${BRIDE_ID}',
        'old-input',
        'old-output',
        '{"input":true}',
        '{"output":true}'
      ),
      (
        '40000000-0000-4000-8000-000000000002',
        now() - interval '89 days',
        '${BRIDE_ID}',
        'recent-input',
        'recent-output',
        '{"recent":true}',
        '{"recent":true}'
      );
  `);

  await db.exec(`BEGIN;\n${privacyExpandMigration}\nCOMMIT;`);
  if (applyContract) {
    await db.exec(`BEGIN;\n${privacyContractMigration}\nCOMMIT;`);
    await db.exec(`BEGIN;\n${accountContractMigration}\nCOMMIT;`);
  }
  return db;
}

async function setPersona(db: PGlite, role: "anon" | "authenticated" | "service_role", uid?: string) {
  await db.exec(`SET ROLE ${role};`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("Amora privacy boundary migration in PostgreSQL", () => {
  it("keeps legacy account grants compatible during the phase-one P0 rollout", async () => {
    const db = await createSupabaseLikeDatabase(false);
    try {
      const contract = await db.query<{
        profile_insert: boolean;
        couple_insert: boolean;
        decision_update: boolean;
      }>(`
        SELECT
          has_table_privilege('authenticated', 'public.profiles', 'INSERT') AS profile_insert,
          has_table_privilege('authenticated', 'public.couples', 'INSERT') AS couple_insert,
          has_table_privilege('authenticated', 'public.decision_nodes', 'UPDATE') AS decision_update
      `);
      expect(contract.rows[0]).toEqual({
        profile_insert: true,
        couple_insert: true,
        decision_update: true,
      });

      await setPersona(db, "authenticated", BRIDE_ID);
      const partner = await db.query<{ name: string }>(
        "SELECT name FROM public.couple_profile_directory WHERE id = $1",
        [GROOM_ID]
      );
      const myChatState = await db.query<{ id: string }>(
        "SELECT id FROM public.my_profile_chat_state"
      );
      expect(partner.rows).toEqual([{ name: "Groom" }]);
      expect(myChatState.rows).toEqual([{ id: BRIDE_ID }]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("removes destructive RPC and legacy table privileges", async () => {
    const db = await createSupabaseLikeDatabase();
    try {
      const contract = await db.query<{
        anon_redact: boolean;
        authenticated_redact: boolean;
        service_redact: boolean;
        authenticated_couple_insert: boolean;
        authenticated_profile_insert: boolean;
        authenticated_decision_update: boolean;
        authenticated_directory_select: boolean;
      }>(`
        SELECT
          has_function_privilege('anon', 'public.redact_old_ai_interactions(interval)', 'EXECUTE') AS anon_redact,
          has_function_privilege('authenticated', 'public.redact_old_ai_interactions(interval)', 'EXECUTE') AS authenticated_redact,
          has_function_privilege('service_role', 'public.redact_old_ai_interactions(interval)', 'EXECUTE') AS service_redact,
          has_table_privilege('authenticated', 'public.couples', 'INSERT') AS authenticated_couple_insert,
          has_table_privilege('authenticated', 'public.profiles', 'INSERT') AS authenticated_profile_insert,
          has_table_privilege('authenticated', 'public.decision_nodes', 'UPDATE') AS authenticated_decision_update,
          has_table_privilege('authenticated', 'public.couple_profile_directory', 'SELECT') AS authenticated_directory_select
      `);

      expect(contract.rows[0]).toEqual({
        anon_redact: false,
        authenticated_redact: false,
        service_redact: true,
        authenticated_couple_insert: false,
        authenticated_profile_insert: false,
        authenticated_decision_update: false,
        authenticated_directory_select: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps partner-private summaries and decisions isolated", async () => {
    const db = await createSupabaseLikeDatabase();
    try {
      await setPersona(db, "authenticated", BRIDE_ID);

      const summaries = await db.query<{ visibility: string }>(
        "SELECT visibility FROM public.chat_summaries ORDER BY visibility"
      );
      const decisions = await db.query<{ visibility: string }>(
        "SELECT visibility FROM public.decision_nodes ORDER BY visibility"
      );

      expect(summaries.rows.map((row) => row.visibility).sort()).toEqual([
        "bride_private",
        "shared",
      ]);
      expect(decisions.rows.map((row) => row.visibility).sort()).toEqual([
        "bride_private",
        "shared",
      ]);
      await expect(
        db.exec("UPDATE public.decision_nodes SET reasoning = 'tampered'")
      ).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "authenticated", GROOM_ID);
      const groomDecisions = await db.query<{ visibility: string }>(
        "SELECT visibility FROM public.decision_nodes ORDER BY visibility"
      );
      expect(groomDecisions.rows.map((row) => row.visibility).sort()).toEqual([
        "groom_private",
        "shared",
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("allows user messages but blocks authenticated AI impersonation and message deletion", async () => {
    const db = await createSupabaseLikeDatabase();
    try {
      await setPersona(db, "authenticated", BRIDE_ID);

      await db.exec(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, metadata, stage_tag, visibility
        ) VALUES (
          '${COUPLE_ID}',
          '${BRIDE_ID}',
          'bride',
          'user',
          'legitimate message',
          '{"target":"partner","imagePaths":["${COUPLE_ID}/file.jpg"]}',
          'planning_0',
          'shared'
        )
      `);

      // Current mobile payload intentionally omits visibility/stage/metadata/created_at.
      await db.exec(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content
        ) VALUES (
          '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'mobile message'
        )
      `);
      await db.exec(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, metadata
        ) VALUES (
          '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'partner target',
          '{"target":"partner"}'
        )
      `);

      await expect(
        db.exec(`
          INSERT INTO public.chat_messages (
            couple_id, sender_id, sender_type, role, content
          ) VALUES (
            '${COUPLE_ID}', '${BRIDE_ID}', 'ai', 'assistant', 'forged Amora'
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.chat_messages (
            couple_id, sender_id, sender_type, role, content, visibility
          ) VALUES (
            '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'wrong private', 'groom_private'
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.chat_messages (
            couple_id, sender_id, sender_type, role, content, sender_role
          ) VALUES (
            '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'forged sender role', 'bride'
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.chat_messages (
            couple_id, sender_id, sender_type, role, content, specialist_type
          ) VALUES (
            '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'forged specialist', 'general'
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.chat_messages (
            couple_id, sender_id, sender_type, role, content, metadata
          ) VALUES (
            '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'wrong image owner',
            '{"imagePaths":["10000000-0000-4000-8000-000000000099/file.jpg"]}'
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.chat_messages (
            couple_id, sender_id, sender_type, role, content
          ) VALUES (
            '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', '   '
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.chat_messages (
            couple_id, sender_id, sender_type, role, content
          ) VALUES (
            '${COUPLE_ID}', '${BRIDE_ID}', 'groom', 'user', 'forged partner'
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.chat_messages (
            couple_id, sender_id, sender_type, role, content, metadata
          ) VALUES (
            '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', 'poisoned metadata',
            '{"serverMessageId":"forged"}'
          )
        `)
      ).rejects.toThrow();
      await expect(
        db.exec("DELETE FROM public.chat_messages")
      ).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      await db.exec(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, metadata, specialist_type
        ) VALUES (
          '${COUPLE_ID}', NULL, 'ai', 'assistant', 'real Amora',
          '{"serverMessageId":"server"}', 'general'
        )
      `);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("exposes only a safe partner projection and blocks profile/couple injection", async () => {
    const db = await createSupabaseLikeDatabase();
    try {
      await setPersona(db, "authenticated", BRIDE_ID);

      const partnerBase = await db.query<{ id: string; name: string }>(
        "SELECT id, name FROM public.profiles WHERE id = $1",
        [GROOM_ID]
      );
      const partnerDirectory = await db.query<Record<string, unknown>>(
        "SELECT * FROM public.couple_profile_directory WHERE id = $1",
        [GROOM_ID]
      );

      expect(partnerBase.rows).toEqual([{ id: GROOM_ID, name: "Groom" }]);
      await expect(
        db.query("SELECT email FROM public.profiles WHERE id = $1", [GROOM_ID])
      ).rejects.toThrow();
      expect(partnerDirectory.rows).toHaveLength(1);
      expect(Object.keys(partnerDirectory.rows[0] ?? {}).sort()).toEqual([
        "couple_id",
        "id",
        "name",
        "role",
      ]);

      await resetPersona(db);
      await setPersona(db, "authenticated", OUTSIDER_ID);
      await expect(
        db.exec(`
          INSERT INTO public.profiles (id, couple_id, role, user_type, is_admin)
          VALUES ('${OUTSIDER_ID}', '${COUPLE_ID}', 'bride', 'admin', true)
        `)
      ).rejects.toThrow();

      await expect(
        db.exec(`
          INSERT INTO public.profiles (id, name)
          VALUES ('${OUTSIDER_ID}', 'Direct client repair')
        `)
      ).rejects.toThrow();
      await expect(
        db.exec(`
          INSERT INTO public.couples (id, invite_code, bride_id, groom_id)
          VALUES (
            '10000000-0000-4000-8000-000000000099',
            'WH-ATTACK0001',
            '${OUTSIDER_ID}',
            '${GROOM_ID}'
          )
        `)
      ).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      await db.exec(`
        INSERT INTO public.profiles (id, name, user_type, is_admin)
        VALUES ('${OUTSIDER_ID}', 'Safe User', 'user', false)
      `);

      await resetPersona(db);
      await setPersona(db, "authenticated", OUTSIDER_ID);
      await expect(
        db.exec(`
          UPDATE public.profiles
          SET couple_id = '${COUPLE_ID}', role = 'bride', user_type = 'admin', is_admin = true
          WHERE id = '${OUTSIDER_ID}'
        `)
      ).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      const safeProfile = await db.query<{ is_admin: boolean; couple_id: string | null }>(
        "SELECT is_admin, couple_id FROM public.profiles WHERE id = $1",
        [OUTSIDER_ID]
      );
      expect(safeProfile.rows[0]).toEqual({ is_admin: false, couple_id: null });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("lets join_couple claim one slot atomically but never succeeds without a profile", async () => {
    const db = await createSupabaseLikeDatabase();
    try {
      await setPersona(db, "service_role");
      await db.exec(`
        INSERT INTO public.couples (id, invite_code)
        VALUES ('${OPEN_COUPLE_ID}', 'WH-OPEN000001');
        INSERT INTO public.profiles (id, name)
        VALUES ('${OUTSIDER_ID}', 'Joiner');
      `);

      await resetPersona(db);
      await setPersona(db, "authenticated", OUTSIDER_ID);
      const joined = await db.query<{ result: { success?: boolean; couple_id?: string } }>(
        "SELECT public.join_couple($1, $2) AS result",
        ["WH-OPEN000001", "bride"]
      );
      expect(joined.rows[0]?.result).toMatchObject({
        success: true,
        joined: true,
        idempotent: false,
        couple_id: OPEN_COUPLE_ID,
      });

      const joinedRetry = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.join_couple($1, $2) AS result",
        ["WH-OPEN000001", "bride"]
      );
      expect(joinedRetry.rows[0]?.result).toMatchObject({
        success: true,
        joined: false,
        idempotent: true,
        couple_id: OPEN_COUPLE_ID,
        role: "bride",
      });

      await resetPersona(db);
      await setPersona(db, "authenticated", MISSING_PROFILE_ID);
      const missing = await db.query<{ result: { error?: string } }>(
        "SELECT public.join_couple($1, $2) AS result",
        ["WH-OPEN000001", "groom"]
      );
      expect(missing.rows[0]?.result).toMatchObject({
        success: false,
        joined: false,
        idempotent: false,
        error_code: "PROFILE_NOT_FOUND",
        error: "Profile not found.",
      });

      await resetPersona(db);
      await setPersona(db, "service_role");
      const state = await db.query<{
        bride_id: string | null;
        groom_id: string | null;
        couple_id: string | null;
        role: string | null;
      }>(`
        SELECT couple.bride_id, couple.groom_id, profile.couple_id, profile.role
        FROM public.couples AS couple
        JOIN public.profiles AS profile ON profile.id = '${OUTSIDER_ID}'
        WHERE couple.id = '${OPEN_COUPLE_ID}'
      `);
      expect(state.rows[0]).toEqual({
        bride_id: OUTSIDER_ID,
        groom_id: null,
        couple_id: OPEN_COUPLE_ID,
        role: "bride",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("creates one couple idempotently and rejects a second global slot", async () => {
    const db = await createSupabaseLikeDatabase();
    try {
      await setPersona(db, "service_role");
      await db.exec(`
        INSERT INTO public.profiles (id, name)
        VALUES ('${CREATOR_ID}', 'Creator');
      `);

      await resetPersona(db);
      await setPersona(db, "authenticated", CREATOR_ID);
      const created = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.create_couple_for_current_user($1) AS result",
        ["groom"]
      );
      expect(created.rows[0]?.result).toMatchObject({
        success: true,
        created: true,
        idempotent: false,
        role: "groom",
      });
      const coupleId = created.rows[0]?.result.couple_id;
      const inviteCode = created.rows[0]?.result.invite_code;

      const retry = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.create_couple_for_current_user($1) AS result",
        ["groom"]
      );
      expect(retry.rows[0]?.result).toMatchObject({
        success: true,
        created: false,
        idempotent: true,
        couple_id: coupleId,
        invite_code: inviteCode,
        role: "groom",
      });

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(
        db.exec(`
          INSERT INTO public.couples (invite_code, bride_id)
          VALUES ('WH-DUPL000001', '${CREATOR_ID}')
        `)
      ).rejects.toThrow(/COUPLE_PROFILE_MEMBERSHIP_CONFLICT|COUPLE_MEMBERSHIP_ALREADY_EXISTS/);

      const occurrences = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM (
          SELECT id FROM public.couples WHERE bride_id = '${CREATOR_ID}'
          UNION ALL
          SELECT id FROM public.couples WHERE groom_id = '${CREATOR_ID}'
        ) AS slots
      `);
      expect(occurrences.rows[0]?.count).toBe(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("claims each durable chat request before work and replays only its completed message", async () => {
    const db = await createSupabaseLikeDatabase();
    const requestKey = `chat:${BRIDE_ID}:00000000-0000-4000-8000-000000000099`;
    const retryKey = `chat:${BRIDE_ID}:00000000-0000-4000-8000-000000000098`;
    try {
      await setPersona(db, "authenticated", BRIDE_ID);
      await expect(
        db.query(
          "SELECT public.claim_amora_chat_request($1, $2, $3, $4)",
          [COUPLE_ID, requestKey, BRIDE_ID, "shared"]
        )
      ).rejects.toThrow();
      await expect(
        db.query("SELECT * FROM public.amora_chat_request_claims")
      ).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      const first = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_chat_request($1, $2, $3, $4) AS result",
        [COUPLE_ID, requestKey, BRIDE_ID, "shared"]
      );
      expect(first.rows[0]?.result).toMatchObject({
        action: "acquired",
        attempt_count: 1,
        reclaimed: false,
      });

      const concurrent = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_chat_request($1, $2, $3, $4) AS result",
        [COUPLE_ID, requestKey, BRIDE_ID, "shared"]
      );
      expect(concurrent.rows[0]?.result).toMatchObject({
        action: "in_progress",
        attempt_count: 1,
      });

      const inserted = await db.query<{ id: string }>(`
        INSERT INTO public.chat_messages (
          couple_id, sender_id, sender_type, role, content, metadata, visibility
        ) VALUES (
          '${COUPLE_ID}', NULL, 'ai', 'assistant', 'durable response',
          jsonb_build_object('client_request_id', '${requestKey}'), 'shared'
        ) RETURNING id
      `);
      const messageId = inserted.rows[0]?.id;
      const completed = await db.query<{ result: boolean }>(
        "SELECT public.complete_amora_chat_request($1, $2, $3, $4) AS result",
        [COUPLE_ID, requestKey, BRIDE_ID, messageId]
      );
      expect(completed.rows[0]?.result).toBe(true);

      const replay = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_chat_request($1, $2, $3, $4) AS result",
        [COUPLE_ID, requestKey, BRIDE_ID, "shared"]
      );
      expect(replay.rows[0]?.result).toMatchObject({
        action: "completed",
        message_id: messageId,
        attempt_count: 1,
      });

      await db.query(
        "SELECT public.claim_amora_chat_request($1, $2, $3, $4)",
        [COUPLE_ID, retryKey, BRIDE_ID, "shared"]
      );
      const failed = await db.query<{ result: boolean }>(
        "SELECT public.fail_amora_chat_request($1, $2, $3, $4) AS result",
        [COUPLE_ID, retryKey, BRIDE_ID, "PROVIDER_TIMEOUT"]
      );
      expect(failed.rows[0]?.result).toBe(true);
      const reclaimed = await db.query<{ result: Record<string, unknown> }>(
        "SELECT public.claim_amora_chat_request($1, $2, $3, $4) AS result",
        [COUPLE_ID, retryKey, BRIDE_ID, "shared"]
      );
      expect(reclaimed.rows[0]?.result).toMatchObject({
        action: "acquired",
        attempt_count: 2,
        reclaimed: true,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("allows only the service role to run the exact 90-day retention job", async () => {
    const db = await createSupabaseLikeDatabase();
    try {
      await setPersona(db, "anon");
      await expect(
        db.exec("SELECT public.redact_old_ai_interactions(interval '90 days')")
      ).rejects.toThrow();

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(
        db.exec("SELECT public.redact_old_ai_interactions(interval '-1 day')")
      ).rejects.toThrow(/exactly 90 days/i);
      await expect(
        db.exec("SELECT public.redact_old_ai_interactions(interval '3 months')")
      ).rejects.toThrow(/exactly 90 days/i);

      const result = await db.query<{ redacted: number }>(
        "SELECT public.redact_old_ai_interactions(interval '90 days') AS redacted"
      );
      expect(result.rows[0]?.redacted).toBe(1);

      const row = await db.query<{
        user_input: string;
        ai_output: string;
        tool_input: unknown;
        tool_output: unknown;
      }>(`
        SELECT user_input, ai_output, tool_input, tool_output
        FROM public.ai_interactions_log
        WHERE id = '40000000-0000-4000-8000-000000000001'
      `);
      expect(row.rows[0]).toEqual({
        user_input: "[redacted_after_retention]",
        ai_output: "[redacted_after_retention]",
        tool_input: null,
        tool_output: null,
      });

      const recent = await db.query<{ user_input: string; ai_output: string }>(`
        SELECT user_input, ai_output
        FROM public.ai_interactions_log
        WHERE id = '40000000-0000-4000-8000-000000000002'
      `);
      expect(recent.rows[0]).toEqual({
        user_input: "recent-input",
        ai_output: "recent-output",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
