import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Synthetic schema/seed reused from the real memory-engine migration fixture.
const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "20000000-0000-4000-8000-000000000001";
const AI_MESSAGE_ID = "20000000-0000-4000-8000-000000000002";
const NEXT_AI_MESSAGE_ID = "20000000-0000-4000-8000-000000000003";

export async function createPrivacyConfirmationBaseDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid REFERENCES auth.users(id),
      groom_id uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.chat_messages (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES auth.users(id),
      sender_type text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      visibility text NOT NULL DEFAULT 'shared',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      category text,
      decision_type text DEFAULT 'exploring',
      title text,
      chosen_value jsonb,
      options_considered jsonb DEFAULT '[]'::jsonb,
      reasoning text,
      confidence numeric(3,2) DEFAULT 0.50,
      stage_tag text,
      decided_at timestamptz,
      source text DEFAULT 'chat',
      source_ref_id uuid,
      metadata jsonb DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.chat_summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id) ON DELETE CASCADE,
      user_id uuid,
      summary_type text NOT NULL DEFAULT 'info'
        CHECK (summary_type IN ('decision', 'preference', 'budget', 'schedule', 'concern', 'info', 'progress')),
      title text NOT NULL DEFAULT 'summary',
      content text NOT NULL DEFAULT '',
      summary text,
      message_count integer NOT NULL DEFAULT 0,
      from_message_id text,
      visibility text NOT NULL,
      to_message_id text,
      importance integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.amora_couple_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      visibility text NOT NULL
    );

    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE FUNCTION public.is_couple_member(p_couple_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.couples
          WHERE id = p_couple_id AND auth.uid() IN (bride_id, groom_id)
        )
      $$;
    CREATE FUNCTION public.can_access_couple_visibility(p_couple_id uuid, p_visibility text)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.couples
          WHERE id = p_couple_id
            AND (
              (p_visibility = 'shared' AND auth.uid() IN (bride_id, groom_id))
              OR (p_visibility = 'bride_private' AND auth.uid() = bride_id)
              OR (p_visibility = 'groom_private' AND auth.uid() = groom_id)
            )
        )
      $$;

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid), public.can_access_couple_visibility(uuid, text)
      TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}'), ('${OUTSIDER_ID}');
    INSERT INTO public.couples(id, bride_id, groom_id)
      VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.chat_messages(id, couple_id, sender_id, sender_type, role, content, visibility) VALUES
      ('${USER_MESSAGE_ID}', '${COUPLE_ID}', '${BRIDE_ID}', 'bride', 'user', '강남 쪽을 선호해요', 'shared'),
      ('${AI_MESSAGE_ID}', '${COUPLE_ID}', NULL, 'ai', 'assistant', '두 분의 중재안입니다', 'shared'),
      ('${NEXT_AI_MESSAGE_ID}', '${COUPLE_ID}', NULL, 'ai', 'assistant', '다음 응답', 'shared');
  `);
  return db;
}

export async function createPrivacyConfirmationDatabase() {
  const db = await createPrivacyConfirmationBaseDatabase();
  const migration = (name: string) => readFileSync(resolve(process.cwd(), "../../supabase/migrations", name), "utf8");
  await db.exec(`
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
    ALTER TABLE public.couples ADD COLUMN updated_at timestamptz DEFAULT now();
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, couple_id uuid, role text, onboarding_completed boolean DEFAULT true, onboarding_step integer DEFAULT 9, shared_chat_cleared_at timestamptz, private_chat_cleared_at timestamptz, updated_at timestamptz DEFAULT now());
    INSERT INTO public.profiles(id,couple_id,role) VALUES ('${BRIDE_ID}','${COUPLE_ID}','bride'),('${GROOM_ID}','${COUPLE_ID}','groom');
  `);
  await db.exec(migration("20260716090000_amora_memory_engine_v2.sql"));
  await db.exec(migration("20260902120000_leaving_does_not_erase_the_partner_memory.sql"));
  await db.exec(migration("20260714164500_expand_atomic_couple_reset.sql"));
  await db.exec(`CREATE TABLE public.amora_privacy_context_epochs(couple_id uuid PRIMARY KEY REFERENCES public.couples(id) ON DELETE CASCADE, epoch bigint NOT NULL, updated_at timestamptz DEFAULT now()); INSERT INTO public.amora_privacy_context_epochs(couple_id,epoch) VALUES ('${COUPLE_ID}',7);`);
  const epochSource = migration("20260802230000_amora_atomic_privacy_epoch.sql");
  for (const name of ["advance_amora_privacy_context_epoch", "is_amora_profile_roster_binding", "capture_amora_couple_privacy_epoch", "capture_amora_profile_privacy_epoch", "capture_amora_couple_scoped_privacy_epoch", "get_own_amora_privacy_epoch"]) {
    const start = epochSource.indexOf(`CREATE FUNCTION public.${name}(`);
    const end = epochSource.indexOf("$function$;", start);
    if (start < 0 || end < 0) throw new Error(`Missing actual epoch function: ${name}`);
    await db.exec(epochSource.slice(start,end + "$function$;".length));
  }
  await db.exec(`
    CREATE TRIGGER trg_amora_privacy_epoch_couples AFTER INSERT OR UPDATE OR DELETE ON public.couples FOR EACH ROW EXECUTE FUNCTION public.capture_amora_couple_privacy_epoch();
    CREATE TRIGGER trg_amora_privacy_epoch_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.capture_amora_profile_privacy_epoch();
    CREATE TRIGGER trg_amora_privacy_epoch_memory_settings AFTER INSERT OR UPDATE OR DELETE ON public.amora_memory_settings FOR EACH ROW EXECUTE FUNCTION public.capture_amora_couple_scoped_privacy_epoch();
    CREATE TRIGGER trg_amora_privacy_epoch_memory_consents AFTER INSERT OR UPDATE OR DELETE ON public.amora_memory_consents FOR EACH ROW EXECUTE FUNCTION public.capture_amora_couple_scoped_privacy_epoch();
  `);
  await db.exec(migration("20260905223222_amora_atomic_chat_view_reset.sql"));
  const targetPath = resolve(process.cwd(), "../../supabase/migrations/20260921101000_privacy_confirmation_targets.sql");
  if (existsSync(targetPath)) await db.exec(readFileSync(targetPath,"utf8"));
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${BRIDE_ID}',false); SELECT set_config('request.jwt.claim.role','authenticated',false);`);
  return db;
}
