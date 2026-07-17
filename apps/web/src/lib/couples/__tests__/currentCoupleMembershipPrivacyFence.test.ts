// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716114000_current_couple_membership_privacy_fence.sql",
  ),
  "utf8",
);
const releasePost = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/release-checks/amora-engine-v2-20260716-post.sql",
  ),
  "utf8",
);
const auditSql = readFileSync(
  resolve(process.cwd(), "../../scripts/sql/current-couple-membership-privacy-audit.sql"),
  "utf8",
);

const CURRENT_BRIDE = "00000000-0000-4000-8000-000000000001";
const CURRENT_GROOM = "00000000-0000-4000-8000-000000000002";
const MISSING_PROFILE = "00000000-0000-4000-8000-000000000003";
const CURRENT_COUPLE = "10000000-0000-4000-8000-000000000001";
const STALE_COUPLE = "10000000-0000-4000-8000-000000000002";
const MISSING_PROFILE_COUPLE = "10000000-0000-4000-8000-000000000003";
const OWNERLESS_COUPLE = "10000000-0000-4000-8000-000000000004";
const NEW_COUPLE = "10000000-0000-4000-8000-000000000005";

function releasePostBlock(tag: string): string {
  const block = releasePost.match(
    new RegExp(`DO \\$${tag}\\$[\\s\\S]*?\\$${tag}\\$;`),
  )?.[0];
  if (!block) throw new Error(`missing release post block: ${tag}`);
  return block;
}

it("keeps Supabase-owned Storage policies outside the automatic migration", () => {
  expect(migration).not.toMatch(
    /(?:CREATE|DROP)\s+POLICY[\s\S]{0,160}?ON\s+storage\.objects/i,
  );
  expect(migration).not.toMatch(
    /ON\s+storage\.objects[\s\S]{0,160}?(?:CREATE|DROP)\s+POLICY/i,
  );
  expect(migration).not.toMatch(
    /(?:INSERT|UPDATE|DELETE|ALTER|TRUNCATE)\s+(?:TABLE\s+)?storage\./i,
  );
});

it("pins the complete pending SECURITY DEFINER manifest and rejects PUBLIC drift", async () => {
  const block = releasePostBlock("post_pending_security_definer");
  const signatures = [
    ...block.matchAll(/\('([^']+)'\)/g),
  ].map((match) => match[1]);
  expect(new Set(signatures).size).toBe(95);

  const db = await PGlite.create();
  try {
    await db.exec(signatures.map((signature) => `
      CREATE FUNCTION ${signature}
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$ BEGIN RETURN; END $$;
      ALTER FUNCTION ${signature} OWNER TO postgres;
      REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    `).join("\n"));

    await db.exec(block);

    await db.exec(`
      GRANT EXECUTE ON FUNCTION ${signatures[0]} TO PUBLIC;
    `);
    await expect(db.exec(block)).rejects.toThrow(
      /POST_PENDING_SECURITY_DEFINER_INVALID/,
    );
  } finally {
    await db.close();
  }
}, 30_000);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE FUNCTION storage.foldername(p_name text)
    RETURNS text[]
    LANGUAGE sql
    IMMUTABLE
    AS $$ SELECT string_to_array(p_name, '/') $$;

    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      groom_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      invite_code text UNIQUE,
      membership_sealed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
      role text,
      name text
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      visibility text NOT NULL,
      sender_role text,
      specialist_type text,
      stage_tag text,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      content text
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL,
      category text,
      source text,
      reasoning text
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE
    );
    CREATE TABLE public.ai_interactions_log (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE
    );
    CREATE TABLE public.amora_couple_profiles (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL
    );
    CREATE TABLE public.amora_memory_consents (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL
    );
    CREATE TABLE public.amora_mediation_acceptances (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE
    );
    CREATE TABLE public.amora_memory_settings (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL
    );
    CREATE TABLE public.amora_memory_jobs (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL
    );
    CREATE TABLE public.decision_edges (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE
    );
    CREATE TABLE public.invitations (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE
    );
    CREATE TABLE public.invitation_photos (id uuid PRIMARY KEY, invitation_id uuid NOT NULL);
    CREATE TABLE public.invitation_accounts (id uuid PRIMARY KEY, invitation_id uuid NOT NULL);
    CREATE TABLE public.invitation_rsvp (id uuid PRIMARY KEY, invitation_id uuid NOT NULL);
    CREATE TABLE public.invitation_guestbook (id uuid PRIMARY KEY, invitation_id uuid NOT NULL);
    CREATE TABLE public.invitation_visits (id uuid PRIMARY KEY, invitation_id uuid NOT NULL);
    CREATE TABLE public.congratulatory_money (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE
    );
    CREATE TABLE public.ai_scripts (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE
    );
    CREATE TABLE public.vendors (id uuid PRIMARY KEY, owner_id uuid);
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id)
    );
    CREATE TABLE public.contracts (id uuid PRIMARY KEY, customer_id uuid NOT NULL);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text, name text);

    ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.chat_summaries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.decision_nodes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.wedding_journeys ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.amora_couple_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.amora_memory_consents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.amora_memory_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.decision_edges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.invitation_photos ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.invitation_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.invitation_rsvp ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.invitation_guestbook ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.invitation_visits ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.congratulatory_money ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.ai_scripts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendor_bookings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE FUNCTION public.is_couple_member(p_couple_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.couples AS couple
        WHERE couple.id = p_couple_id
          AND auth.uid() IN (couple.bride_id, couple.groom_id)
      )
    $$;
    CREATE FUNCTION public.can_access_couple_visibility(p_couple_id uuid, p_visibility text)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.couples AS couple
        WHERE couple.id = p_couple_id
          AND (
            (p_visibility = 'shared' AND auth.uid() IN (couple.bride_id, couple.groom_id))
            OR (p_visibility = 'bride_private' AND auth.uid() = couple.bride_id)
            OR (p_visibility = 'groom_private' AND auth.uid() = couple.groom_id)
          )
      )
    $$;
    CREATE FUNCTION public.can_read_profile(p_profile_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$ SELECT p_profile_id = auth.uid() $$;

    CREATE POLICY couples_select_own ON public.couples
      FOR SELECT TO authenticated
      USING (auth.uid() = bride_id OR auth.uid() = groom_id);
    CREATE POLICY couples_select_by_code ON public.couples
      FOR SELECT TO authenticated
      USING (invite_code IS NOT NULL);
    CREATE POLICY profiles_select_safe_related ON public.profiles
      FOR SELECT TO authenticated USING (public.can_read_profile(id));
    CREATE POLICY profiles_insert_own ON public.profiles
      FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE TO authenticated
      USING (id = auth.uid()) WITH CHECK (id = auth.uid());
    CREATE POLICY chat_select_with_privacy ON public.chat_messages
      FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility));
    CREATE POLICY chat_messages_insert_own_user ON public.chat_messages
      FOR INSERT TO authenticated
      WITH CHECK (sender_id = auth.uid() AND public.is_couple_member(couple_id));
    CREATE POLICY chat_summaries_select_with_privacy ON public.chat_summaries
      FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility));
    CREATE POLICY decision_nodes_select_with_privacy ON public.decision_nodes
      FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility));
    CREATE POLICY journeys_select_couple ON public.wedding_journeys
      FOR SELECT TO authenticated USING (public.is_couple_member(couple_id));
    CREATE POLICY journeys_insert_couple ON public.wedding_journeys
      FOR INSERT TO authenticated WITH CHECK (public.is_couple_member(couple_id));
    CREATE POLICY journeys_update_couple ON public.wedding_journeys
      FOR UPDATE TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id));

    GRANT SELECT ON public.couples, public.profiles, public.chat_messages,
      public.chat_summaries, public.decision_nodes, public.wedding_journeys
      TO authenticated;
    GRANT INSERT ON public.chat_messages TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid),
      public.can_access_couple_visibility(uuid, text), public.can_read_profile(uuid)
      TO authenticated, service_role;

    CREATE FUNCTION public.guard_new_couple_membership()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER trg_guard_new_couple_membership
      BEFORE INSERT OR UPDATE OF bride_id, groom_id ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.guard_new_couple_membership();

    CREATE FUNCTION public.enforce_couple_roster_epoch()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.membership_sealed_at := CASE
          WHEN NEW.bride_id IS NOT NULL AND NEW.groom_id IS NOT NULL THEN now()
          ELSE NULL
        END;
        RETURN NEW;
      END IF;
      IF OLD.membership_sealed_at IS NOT NULL THEN
        IF (OLD.bride_id IS NULL AND NEW.bride_id IS NOT NULL)
           OR (OLD.groom_id IS NULL AND NEW.groom_id IS NOT NULL)
           OR (OLD.bride_id IS NOT NULL AND NEW.bride_id IS NOT NULL
             AND OLD.bride_id IS DISTINCT FROM NEW.bride_id)
           OR (OLD.groom_id IS NOT NULL AND NEW.groom_id IS NOT NULL
             AND OLD.groom_id IS DISTINCT FROM NEW.groom_id) THEN
          RAISE EXCEPTION 'COUPLE_ROSTER_EPOCH_CLOSED'
            USING ERRCODE = '23514';
        END IF;
        NEW.membership_sealed_at := OLD.membership_sealed_at;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trg_enforce_couple_roster_epoch
      BEFORE INSERT OR UPDATE ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.enforce_couple_roster_epoch();

    CREATE FUNCTION public.delete_empty_couple_after_membership_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.bride_id IS NULL AND NEW.groom_id IS NULL THEN
        DELETE FROM public.couples WHERE id = NEW.id;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trg_delete_empty_couple_after_membership_change
      AFTER UPDATE OF bride_id, groom_id ON public.couples
      FOR EACH ROW WHEN (NEW.bride_id IS NULL AND NEW.groom_id IS NULL)
      EXECUTE FUNCTION public.delete_empty_couple_after_membership_change();

    CREATE FUNCTION public.reset_amora_memory_after_membership_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      DELETE FROM public.chat_summaries WHERE couple_id = NEW.id;
      DELETE FROM public.decision_nodes WHERE couple_id = NEW.id;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trg_reset_amora_memory_after_membership_change
      AFTER UPDATE OF bride_id, groom_id ON public.couples
      FOR EACH ROW
      WHEN (
        OLD.bride_id IS DISTINCT FROM NEW.bride_id
        OR OLD.groom_id IS DISTINCT FROM NEW.groom_id
      )
      EXECUTE FUNCTION public.reset_amora_memory_after_membership_change();

    CREATE FUNCTION public.reset_amora_mediation_after_membership_change()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER trg_reset_amora_mediation_after_membership_change
      AFTER UPDATE OF bride_id, groom_id ON public.couples
      FOR EACH ROW
      WHEN (
        OLD.bride_id IS DISTINCT FROM NEW.bride_id
        OR OLD.groom_id IS DISTINCT FROM NEW.groom_id
      )
      EXECUTE FUNCTION public.reset_amora_mediation_after_membership_change();

    INSERT INTO auth.users(id) VALUES
      ('${CURRENT_BRIDE}'),
      ('${CURRENT_GROOM}'),
      ('${MISSING_PROFILE}'),
      ('00000000-0000-4000-8000-000000000004');

    INSERT INTO public.couples(id, invite_code, bride_id, groom_id, membership_sealed_at) VALUES
      ('${CURRENT_COUPLE}', 'WH-CURRENT001', '${CURRENT_BRIDE}', '${CURRENT_GROOM}', now()),
      ('${STALE_COUPLE}', 'WH-STALE0001', '${CURRENT_BRIDE}', NULL, now()),
      ('${MISSING_PROFILE_COUPLE}', 'WH-MISSING01', NULL, '${MISSING_PROFILE}', now()),
      ('${OWNERLESS_COUPLE}', 'WH-EMPTY00001', NULL, NULL, now());

    INSERT INTO public.profiles(id, couple_id, role, name) VALUES
      ('${CURRENT_BRIDE}', '${CURRENT_COUPLE}', 'bride', 'Current bride'),
      ('${CURRENT_GROOM}', '${CURRENT_COUPLE}', 'groom', 'Current groom');

    INSERT INTO public.chat_messages(id, couple_id, sender_id, sender_type, role, content, visibility) VALUES
      ('20000000-0000-4000-8000-000000000001', '${STALE_COUPLE}', '${CURRENT_BRIDE}', 'bride', 'user', 'old shared', 'shared'),
      ('20000000-0000-4000-8000-000000000002', '${STALE_COUPLE}', '${CURRENT_BRIDE}', 'bride', 'user', 'old private', 'bride_private'),
      ('20000000-0000-4000-8000-000000000003', '${CURRENT_COUPLE}', '${CURRENT_BRIDE}', 'bride', 'user', 'current shared', 'shared'),
      ('20000000-0000-4000-8000-000000000004', '${CURRENT_COUPLE}', '${CURRENT_BRIDE}', 'bride', 'user', 'bride private', 'bride_private'),
      ('20000000-0000-4000-8000-000000000005', '${CURRENT_COUPLE}', '${CURRENT_GROOM}', 'groom', 'user', 'groom private', 'groom_private');
    INSERT INTO public.chat_summaries(id, couple_id, visibility, content) VALUES
      ('30000000-0000-4000-8000-000000000001', '${STALE_COUPLE}', 'shared', 'old shared'),
      ('30000000-0000-4000-8000-000000000002', '${CURRENT_COUPLE}', 'shared', 'current shared'),
      ('30000000-0000-4000-8000-000000000003', '${CURRENT_COUPLE}', 'bride_private', 'bride private'),
      ('30000000-0000-4000-8000-000000000004', '${CURRENT_COUPLE}', 'groom_private', 'groom private');
    INSERT INTO public.decision_nodes(id, couple_id, visibility, category, source, reasoning) VALUES
      ('40000000-0000-4000-8000-000000000001', '${STALE_COUPLE}', 'shared', 'conflict_resolution', 'chat', 'old shared'),
      ('40000000-0000-4000-8000-000000000002', '${CURRENT_COUPLE}', 'shared', 'choice', 'chat', 'current shared'),
      ('40000000-0000-4000-8000-000000000003', '${CURRENT_COUPLE}', 'bride_private', 'choice', 'chat', 'bride private'),
      ('40000000-0000-4000-8000-000000000004', '${CURRENT_COUPLE}', 'groom_private', 'choice', 'chat', 'groom private');
    INSERT INTO public.wedding_journeys(id, couple_id)
    VALUES ('50000000-0000-4000-8000-000000000001', '${STALE_COUPLE}');

    -- Represents a shell that was already sealed by an earlier historical
    -- transition. The two stale one-member rows remain unsealed to exercise
    -- 1140's exact final-slot sealing transition.
    UPDATE public.couples
    SET membership_sealed_at = now()
    WHERE id = '${OWNERLESS_COUPLE}';
  `);
  return db;
}

async function setPersona(db: PGlite, role: "anon" | "authenticated" | "service_role", userId?: string) {
  await db.exec(`RESET ROLE; SET ROLE ${role};`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("current couple membership privacy fence", () => {
  it("ships a read-only counts-only operational audit", () => {
    const executableSql = auditSql.replace(/^\s*--.*$/gm, "");
    expect(auditSql).toMatch(/READ ONLY[\s\S]*Counts and boolean gates only/);
    expect(auditSql).toMatch(/stale_bride_slots/);
    expect(auditSql).toMatch(/stale_groom_slots/);
    expect(auditSql).toMatch(/profile_links_without_matching_slot/);
    expect(auditSql).toMatch(/projected_ownerless_shells_requiring_seal/);
    expect(auditSql).toMatch(/projected_new_ownerless_couples/);
    expect(auditSql).toMatch(/users_in_multiple_slots/);
    expect(auditSql).toMatch(/direct_authenticated_slot_policies/);
    expect(auditSql).toMatch(/unexpected_core_authenticated_policies/);
    expect(auditSql).toMatch(/deferred_integrity_triggers_ready/);
    expect(auditSql).toMatch(/ownerless_shell_reuse_fence_ready/);
    expect(executableSql).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|COPY|MERGE|CALL)\b/i,
    );
    expect(executableSql).not.toMatch(
      /\b(email|phone|name|content|user_input|ai_output|invite_code)\b/i,
    );
  });

  it("counts and rejects a reverse profile link whose couple slot is null", async () => {
    const db = await createDatabase();
    const reverseOnlyUser = "00000000-0000-4000-8000-000000000005";
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await db.exec(`
        INSERT INTO auth.users(id) VALUES ('${reverseOnlyUser}');
        ALTER TABLE public.profiles
          DISABLE TRIGGER trg_current_couple_profile_integrity;
        INSERT INTO public.profiles(id, couple_id, role, name)
        VALUES ('${reverseOnlyUser}', '${OWNERLESS_COUPLE}', 'bride', 'Reverse only');
        ALTER TABLE public.profiles
          ENABLE TRIGGER trg_current_couple_profile_integrity;
      `);

      const audit = await db.query<{ profile_links_without_matching_slot: number }>(
        auditSql,
      );
      expect(audit.rows[0]?.profile_links_without_matching_slot).toBe(1);

      await expect(
        db.exec(releasePostBlock("post_membership_1140_data")),
      ).rejects.toThrow(/POST_1140_DATA_INVALID/);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("clears only stale slots while preserving canonical membership and every historical row", async () => {
    const db = await createDatabase();
    try {
      const beforeAudit = await db.query<{
        stale_bride_slots: number;
        stale_groom_slots: number;
        direct_authenticated_slot_policies: number;
        unexpected_core_authenticated_policies: number;
        projected_ownerless_shells_requiring_seal: number;
        projected_new_ownerless_couples: number;
      }>(auditSql);
      expect(beforeAudit.rows[0]).toMatchObject({
        stale_bride_slots: 1,
        stale_groom_slots: 1,
        direct_authenticated_slot_policies: 1,
        unexpected_core_authenticated_policies: 1,
        projected_ownerless_shells_requiring_seal: 2,
        projected_new_ownerless_couples: 2,
      });

      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);

      const couples = await db.query<{
        id: string;
        bride_id: string | null;
        groom_id: string | null;
        invite_code: string | null;
        sealed: boolean;
      }>(`
        SELECT id, bride_id, groom_id, invite_code,
          membership_sealed_at IS NOT NULL AS sealed
        FROM public.couples
        ORDER BY id
      `);
      expect(couples.rows).toEqual([
        {
          id: CURRENT_COUPLE,
          bride_id: CURRENT_BRIDE,
          groom_id: CURRENT_GROOM,
          invite_code: "WH-CURRENT001",
          sealed: true,
        },
        {
          id: STALE_COUPLE,
          bride_id: null,
          groom_id: null,
          invite_code: "WH-STALE0001",
          sealed: true,
        },
        {
          id: MISSING_PROFILE_COUPLE,
          bride_id: null,
          groom_id: null,
          invite_code: "WH-MISSING01",
          sealed: true,
        },
        {
          id: OWNERLESS_COUPLE,
          bride_id: null,
          groom_id: null,
          invite_code: "WH-EMPTY00001",
          sealed: true,
        },
      ]);

      const history = await db.query<{
        messages: number;
        summaries: number;
        decisions: number;
        journeys: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.chat_messages) AS messages,
          (SELECT count(*)::integer FROM public.chat_summaries) AS summaries,
          (SELECT count(*)::integer FROM public.decision_nodes) AS decisions,
          (SELECT count(*)::integer FROM public.wedding_journeys) AS journeys
      `);
      expect(history.rows[0]).toEqual({
        messages: 5,
        summaries: 4,
        decisions: 4,
        journeys: 1,
      });

      const audit = await db.query<{
        stale_bride_slots: number;
        stale_groom_slots: number;
        canonical_role_mismatches: number;
        profile_links_without_matching_slot: number;
        users_in_multiple_slots: number;
        same_user_both_roles: number;
        direct_authenticated_slot_policies: number;
        unexpected_core_authenticated_policies: number;
        projected_ownerless_shells_requiring_seal: number;
        projected_new_ownerless_couples: number;
        helper_functions_ready: boolean;
        unique_indexes_ready: boolean;
        deferred_integrity_triggers_ready: boolean;
        ownerless_shell_reuse_fence_ready: boolean;
      }>(auditSql);
      expect(audit.rows[0]).toMatchObject({
        stale_bride_slots: 0,
        stale_groom_slots: 0,
        canonical_role_mismatches: 0,
        profile_links_without_matching_slot: 0,
        users_in_multiple_slots: 0,
        same_user_both_roles: 0,
        direct_authenticated_slot_policies: 0,
        unexpected_core_authenticated_policies: 0,
        projected_ownerless_shells_requiring_seal: 0,
        projected_new_ownerless_couples: 0,
        helper_functions_ready: true,
        unique_indexes_ready: true,
        deferred_integrity_triggers_ready: true,
        ownerless_shell_reuse_fence_ready: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("allows Auth deletion to clear one slot and resets derived couple memory", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);

      await db.query("DELETE FROM auth.users WHERE id = $1", [CURRENT_BRIDE]);

      const state = await db.query<{
        bride_id: string | null;
        groom_id: string | null;
        bride_profile_count: number;
        groom_profile_count: number;
        current_summary_count: number;
        current_decision_count: number;
        retained_chat_count: number;
        anonymized_chat_count: number;
      }>(`
        SELECT
          couple.bride_id,
          couple.groom_id,
          (SELECT count(*)::integer FROM public.profiles
            WHERE id = '${CURRENT_BRIDE}') AS bride_profile_count,
          (SELECT count(*)::integer FROM public.profiles
            WHERE id = '${CURRENT_GROOM}') AS groom_profile_count,
          (SELECT count(*)::integer FROM public.chat_summaries
            WHERE couple_id = '${CURRENT_COUPLE}') AS current_summary_count,
          (SELECT count(*)::integer FROM public.decision_nodes
            WHERE couple_id = '${CURRENT_COUPLE}') AS current_decision_count,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE couple_id = '${CURRENT_COUPLE}') AS retained_chat_count,
          (SELECT count(*)::integer FROM public.chat_messages
            WHERE couple_id = '${CURRENT_COUPLE}' AND sender_id IS NULL)
            AS anonymized_chat_count
        FROM public.couples AS couple
        WHERE couple.id = '${CURRENT_COUPLE}'
      `);

      expect(state.rows).toEqual([{
        bride_id: null,
        groom_id: CURRENT_GROOM,
        bride_profile_count: 0,
        groom_profile_count: 1,
        current_summary_count: 0,
        current_decision_count: 0,
        retained_chat_count: 3,
        anonymized_chat_count: 2,
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("fails closed when a shell was already ownerless and unsealed before the bounded repair", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.couples DISABLE TRIGGER trg_enforce_couple_roster_epoch;
        UPDATE public.couples
        SET membership_sealed_at = NULL
        WHERE id = '${OWNERLESS_COUPLE}';
        ALTER TABLE public.couples ENABLE TRIGGER trg_enforce_couple_roster_epoch;
      `);

      await expect(db.exec(`BEGIN;\n${migration}\nCOMMIT;`)).rejects.toThrow(
        /CURRENT_COUPLE_PRIVACY_PREEXISTING_UNSEALED_OWNERLESS_SHELL/,
      );
      await db.exec("ROLLBACK").catch(() => undefined);

      const unchanged = await db.query<{ invite_code: string | null }>(
        "SELECT invite_code FROM public.couples WHERE id = $1",
        [OWNERLESS_COUPLE],
      );
      expect(unchanged.rows[0]?.invite_code).toBe("WH-EMPTY00001");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a replica-only prerequisite trigger before changing any membership data", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.couples
          ENABLE REPLICA TRIGGER trg_guard_new_couple_membership;
      `);
      await expect(db.exec(`BEGIN;\n${migration}\nCOMMIT;`)).rejects.toThrow(
        /CURRENT_COUPLE_PRIVACY_REQUIRED_TRIGGER_MISSING/,
      );
      await db.exec("ROLLBACK");

      const staleSlots = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.couples
        WHERE id IN ('${STALE_COUPLE}', '${MISSING_PROFILE_COUPLE}')
          AND (bride_id IS NOT NULL OR groom_id IS NOT NULL)
      `);
      expect(staleSlots.rows[0]?.count).toBe(2);
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the canonical shared/own-private journey and hides every stale-couple row", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);

      await setPersona(db, "authenticated", CURRENT_BRIDE);
      const brideMessages = await db.query<{ content: string }>(
        "SELECT content FROM public.chat_messages ORDER BY content",
      );
      const brideSummaries = await db.query<{ content: string }>(
        "SELECT content FROM public.chat_summaries ORDER BY content",
      );
      const brideDecisions = await db.query<{ reasoning: string }>(
        "SELECT reasoning FROM public.decision_nodes ORDER BY reasoning",
      );
      const brideCouples = await db.query<{ id: string }>(
        "SELECT id FROM public.couples ORDER BY id",
      );
      const brideProfiles = await db.query<{ id: string }>(
        "SELECT id FROM public.profiles ORDER BY id",
      );

      expect(brideMessages.rows).toEqual([
        { content: "bride private" },
        { content: "current shared" },
      ]);
      expect(brideSummaries.rows).toEqual([
        { content: "bride private" },
        { content: "current shared" },
      ]);
      expect(brideDecisions.rows).toEqual([
        { reasoning: "bride private" },
        { reasoning: "current shared" },
      ]);
      expect(brideCouples.rows).toEqual([{ id: CURRENT_COUPLE }]);
      expect(brideProfiles.rows).toEqual([
        { id: CURRENT_BRIDE },
        { id: CURRENT_GROOM },
      ]);

      await setPersona(db, "authenticated", CURRENT_GROOM);
      const groomMessages = await db.query<{ content: string }>(
        "SELECT content FROM public.chat_messages ORDER BY content",
      );
      expect(groomMessages.rows).toEqual([
        { content: "current shared" },
        { content: "groom private" },
      ]);

      await setPersona(db, "anon");
      await expect(
        db.query("SELECT public.is_couple_member($1)", [CURRENT_COUPLE]),
      ).rejects.toThrow();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects every future half-link but permits an atomic bilateral join and leave", async () => {
    const db = await createDatabase();
    const newUser = "00000000-0000-4000-8000-000000000004";
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      await expect(
        db.exec(`
          BEGIN;
          UPDATE public.couples
          SET bride_id = '${CURRENT_BRIDE}'
          WHERE id = '${STALE_COUPLE}';
          COMMIT;
        `),
      ).rejects.toThrow(/COUPLE_ROSTER_EPOCH_CLOSED/);
      await db.exec("ROLLBACK").catch(() => undefined);

      await expect(
        db.exec(`
          BEGIN;
          UPDATE public.profiles
          SET couple_id = '${STALE_COUPLE}', role = 'bride'
          WHERE id = '${CURRENT_BRIDE}';
          COMMIT;
        `),
      ).rejects.toThrow(/CURRENT_COUPLE_PROFILE_SLOT_MISMATCH/);
      await db.exec("ROLLBACK").catch(() => undefined);

      await db.exec(`
        BEGIN;
        INSERT INTO public.couples(id, invite_code)
        VALUES ('${NEW_COUPLE}', 'WH-NEW0000001');
        INSERT INTO public.profiles(id, couple_id, role, name)
        VALUES ('${newUser}', NULL, NULL, 'New member');
        UPDATE public.couples
        SET bride_id = '${newUser}'
        WHERE id = '${NEW_COUPLE}';
        UPDATE public.profiles
        SET couple_id = '${NEW_COUPLE}', role = 'bride'
        WHERE id = '${newUser}';
        COMMIT;
      `);

      const joined = await db.query<{ valid: boolean }>(
        "SELECT public.is_current_couple_member($1, $2) AS valid",
        [newUser, NEW_COUPLE],
      );
      expect(joined.rows[0]?.valid).toBe(true);

      await expect(
        db.exec(`
          BEGIN;
          UPDATE public.couples SET bride_id = NULL WHERE id = '${CURRENT_COUPLE}';
          SET CONSTRAINTS ALL IMMEDIATE;
          COMMIT;
        `),
      ).rejects.toThrow(
        /CURRENT_COUPLE_(PROFILE_BACKLINK_MISMATCH|DELETE_WITH_PROFILE)/,
      );
      await db.exec("ROLLBACK").catch(() => undefined);

      await db.exec(`
        BEGIN;
        UPDATE public.couples SET bride_id = NULL WHERE id = '${NEW_COUPLE}';
        -- The final-slot trigger deletes the now-ownerless couple and the
        -- existing profile FK clears couple_id in the same transaction.
        -- The last role remains historical display data, not membership.
        COMMIT;
      `);

      const left = await db.query<{
        slot_count: number;
        couple_id: string | null;
        role: string | null;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM public.couples
            WHERE bride_id = '${newUser}' OR groom_id = '${newUser}') AS slot_count,
          (SELECT couple_id FROM public.profiles WHERE id = '${newUser}') AS couple_id,
          (SELECT role FROM public.profiles WHERE id = '${newUser}') AS role
      `);
      expect(left.rows[0]).toEqual({
        slot_count: 0,
        couple_id: null,
        role: "bride",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the existing account-deletion trigger flow compatible with the deferred fence", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await setPersona(db, "service_role");

      await db.exec(`
        BEGIN;
        UPDATE public.couples
        SET groom_id = NULL
        WHERE id = '${CURRENT_COUPLE}';
        DELETE FROM public.profiles WHERE id = '${CURRENT_GROOM}';
        COMMIT;
      `);

      const oneMember = await db.query<{
        bride_id: string | null;
        groom_id: string | null;
        profile_count: number;
      }>(`
        SELECT bride_id, groom_id,
          (SELECT count(*)::integer FROM public.profiles
            WHERE couple_id = '${CURRENT_COUPLE}') AS profile_count
        FROM public.couples
        WHERE id = '${CURRENT_COUPLE}'
      `);
      expect(oneMember.rows[0]).toEqual({
        bride_id: CURRENT_BRIDE,
        groom_id: null,
        profile_count: 1,
      });

      await db.exec(`
        BEGIN;
        UPDATE public.couples
        SET bride_id = NULL
        WHERE id = '${CURRENT_COUPLE}';
        DELETE FROM public.profiles WHERE id = '${CURRENT_BRIDE}';
        COMMIT;
      `);

      const finalState = await db.query<{ couples: number; profiles: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.couples
            WHERE id = '${CURRENT_COUPLE}') AS couples,
          (SELECT count(*)::integer FROM public.profiles
            WHERE id IN ('${CURRENT_BRIDE}', '${CURRENT_GROOM}')) AS profiles
      `);
      expect(finalState.rows[0]).toEqual({ couples: 0, profiles: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps legacy contracts self-only instead of treating customer_id as a couple id", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await db.exec(`
        GRANT SELECT ON public.contracts TO authenticated;
        INSERT INTO public.contracts(id, customer_id) VALUES
          ('60000000-0000-4000-8000-000000000001', '${CURRENT_BRIDE}'),
          ('60000000-0000-4000-8000-000000000002', '${CURRENT_COUPLE}');
      `);

      await setPersona(db, "authenticated", CURRENT_GROOM);
      const partnerVisible = await db.query<{ id: string }>(`
        SELECT id FROM public.contracts ORDER BY id
      `);
      expect(partnerVisible.rows).toEqual([]);

      await setPersona(db, "authenticated", CURRENT_BRIDE);
      const selfVisible = await db.query<{ id: string }>(`
        SELECT id FROM public.contracts ORDER BY id
      `);
      expect(selfVisible.rows).toEqual([
        { id: "60000000-0000-4000-8000-000000000001" },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("replaces legacy core write policies instead of trusting their names", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        DROP POLICY profiles_insert_own ON public.profiles;
        CREATE POLICY profiles_insert_own ON public.profiles
          FOR INSERT TO authenticated WITH CHECK (true);
        DROP POLICY journeys_update_couple ON public.wedding_journeys;
        CREATE POLICY journeys_update_couple ON public.wedding_journeys
          FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
      `);

      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);

      const policies = await db.query<{
        tablename: string;
        policyname: string;
        cmd: string;
        roles: string[];
        qual: string | null;
        with_check: string | null;
      }>(`
        SELECT tablename, policyname, cmd, roles, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (tablename, policyname) IN (
            ('profiles', 'profiles_insert_own'),
            ('profiles', 'profiles_update_own'),
            ('wedding_journeys', 'journeys_insert_couple'),
            ('wedding_journeys', 'journeys_update_couple')
          )
        ORDER BY tablename, policyname
      `);
      expect(policies.rows).toEqual([
        {
          tablename: "profiles",
          policyname: "profiles_insert_own",
          cmd: "INSERT",
          roles: ["authenticated"],
          qual: null,
          with_check: "(id = auth.uid())",
        },
        {
          tablename: "profiles",
          policyname: "profiles_update_own",
          cmd: "UPDATE",
          roles: ["authenticated"],
          qual: "(id = auth.uid())",
          with_check: "(id = auth.uid())",
        },
        {
          tablename: "wedding_journeys",
          policyname: "journeys_insert_couple",
          cmd: "INSERT",
          roles: ["authenticated"],
          qual: null,
          with_check: "is_couple_member(couple_id)",
        },
        {
          tablename: "wedding_journeys",
          policyname: "journeys_update_couple",
          cmd: "UPDATE",
          roles: ["authenticated"],
          qual: "is_couple_member(couple_id)",
          with_check: "is_couple_member(couple_id)",
        },
      ]);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps the user-specific proof service-only and installs deferred uniqueness fences", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);

      const contract = await db.query<{
        auth_member: boolean;
        anon_member: boolean;
        auth_specific: boolean;
        service_specific: boolean;
        auth_integrity_trigger: boolean;
        service_integrity_trigger: boolean;
        auth_seal_trigger: boolean;
        service_seal_trigger: boolean;
        bride_unique: boolean;
        groom_unique: boolean;
        profile_deferred: boolean;
        couple_deferred: boolean;
      }>(`
        SELECT
          has_function_privilege('authenticated', 'public.is_couple_member(uuid)', 'EXECUTE') AS auth_member,
          has_function_privilege('anon', 'public.is_couple_member(uuid)', 'EXECUTE') AS anon_member,
          has_function_privilege('authenticated', 'public.is_current_couple_member(uuid,uuid)', 'EXECUTE') AS auth_specific,
          has_function_privilege('service_role', 'public.is_current_couple_member(uuid,uuid)', 'EXECUTE') AS service_specific,
          has_function_privilege('authenticated', 'public.enforce_current_couple_membership_integrity()', 'EXECUTE') AS auth_integrity_trigger,
          has_function_privilege('service_role', 'public.enforce_current_couple_membership_integrity()', 'EXECUTE') AS service_integrity_trigger,
          has_function_privilege('authenticated', 'public.seal_ownerless_couple_membership_epoch()', 'EXECUTE') AS auth_seal_trigger,
          has_function_privilege('service_role', 'public.seal_ownerless_couple_membership_epoch()', 'EXECUTE') AS service_seal_trigger,
          (SELECT indisunique AND indisvalid FROM pg_index
            WHERE indexrelid = 'public.couples_bride_id_current_unique_idx'::regclass) AS bride_unique,
          (SELECT indisunique AND indisvalid FROM pg_index
            WHERE indexrelid = 'public.couples_groom_id_current_unique_idx'::regclass) AS groom_unique,
          (SELECT tgdeferrable AND tginitdeferred FROM pg_trigger
            WHERE tgrelid = 'public.profiles'::regclass
              AND tgname = 'trg_current_couple_profile_integrity') AS profile_deferred,
          (SELECT tgdeferrable AND tginitdeferred FROM pg_trigger
            WHERE tgrelid = 'public.couples'::regclass
              AND tgname = 'trg_current_couple_row_integrity') AS couple_deferred
      `);
      expect(contract.rows[0]).toEqual({
        auth_member: true,
        anon_member: false,
        auth_specific: false,
        service_specific: true,
        auth_integrity_trigger: false,
        service_integrity_trigger: false,
        auth_seal_trigger: false,
        service_seal_trigger: false,
        bride_unique: true,
        groom_unique: true,
        profile_deferred: true,
        couple_deferred: true,
      });

      const unsafePolicies = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM pg_policies AS policy
        WHERE ('authenticated' = ANY(policy.roles) OR 'public' = ANY(policy.roles))
          AND lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
            ~ '(bride_id|groom_id)'
          AND lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
            ~ 'auth[.]uid'
      `);
      expect(unsafePolicies.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("release post-check rejects policy, helper ACL, or trigger drift", async () => {
    const db = await createDatabase();
    const helperPost = releasePostBlock("post_membership_1140_helpers");
    const policyPost = releasePostBlock("post_membership_1140_policies");
    try {
      await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
      await db.exec(helperPost);
      await db.exec(policyPost);

      await db.exec(`
        DROP POLICY profiles_insert_own ON public.profiles;
        CREATE POLICY profiles_insert_own ON public.profiles
          FOR INSERT TO authenticated WITH CHECK (true);
      `);
      await expect(db.exec(policyPost)).rejects.toThrow(
        /POST_1140_POLICY_CONTRACT_INVALID/,
      );

      await db.exec(`
        ALTER TABLE public.couples
          ENABLE REPLICA TRIGGER trg_guard_new_couple_membership;
      `);
      await expect(db.exec(helperPost)).rejects.toThrow(
        /POST_1140_HELPER_CONTRACT_INVALID/,
      );

      await db.exec(`
        GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid) TO anon;
      `);
      await expect(db.exec(helperPost)).rejects.toThrow(
        /POST_1140_HELPER_CONTRACT_INVALID/,
      );
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
