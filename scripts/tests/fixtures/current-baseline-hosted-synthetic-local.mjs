import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { digestJson } from '../../lib/current-baseline-release-contract.mjs';

// 로컬 SQL 회귀 전용 최소 predecessor. hosted schema의 대체물/운영 증거가 아니다.
export async function localPredecessor(repoRoot, dependencyRoot = repoRoot) {
  const requireWeb = createRequire(join(dependencyRoot, 'apps/web/package.json'));
  const { PGlite } = requireWeb('@electric-sql/pglite');
  const db = await PGlite.create();
  const migration = name => readFileSync(join(repoRoot, 'supabase/migrations', name), 'utf8');
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
      CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid REFERENCES auth.users(id),groom_id uuid REFERENCES auth.users(id));
      CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),couple_id uuid REFERENCES couples(id),role text,
        shared_chat_cleared_at timestamptz,private_chat_cleared_at timestamptz);
      CREATE TABLE public.conversation_segments(id uuid PRIMARY KEY,couple_id uuid,visibility text,owner_user_id uuid,
        status text DEFAULT 'active',started_by uuid,start_reason text);
      CREATE TABLE public.chat_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid REFERENCES couples(id),segment_id uuid,
        visibility text DEFAULT 'shared',sender_id uuid,sender_type text,role text,content text,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
      CREATE TABLE public.wedding_journeys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid UNIQUE REFERENCES couples(id),
        total_budget bigint DEFAULT 0,wedding_date date,venue text,progress jsonb DEFAULT '{}',state_revision bigint NOT NULL DEFAULT 0,
        updated_at timestamptz DEFAULT now());
      CREATE TABLE public.amora_actions(id text PRIMARY KEY,couple_id uuid REFERENCES couples(id),title text,description text,due_date text,
        category_key text,priority text DEFAULT 'medium',status text DEFAULT 'open',source text DEFAULT 'chat',href text,
        metadata jsonb DEFAULT '{}',created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),completed_at timestamptz,dismissed_at timestamptz);
      CREATE TABLE public.amora_chat_request_claims(couple_id uuid,request_key text,user_id uuid,visibility text,status text DEFAULT 'processing',
        message_id uuid,claimed_at timestamptz DEFAULT now(),completed_at timestamptz,failed_at timestamptz,failure_code text,
        attempt_count integer DEFAULT 1,user_message_id uuid,PRIMARY KEY(couple_id,request_key));
      CREATE TABLE public.amora_tool_executions(couple_id uuid,request_key text,operation_key text,tool_name text,input_digest text,
        status text DEFAULT 'processing',result jsonb,claimed_at timestamptz DEFAULT now(),completed_at timestamptz,uncertain_at timestamptz,
        failure_code text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),pending_action_id uuid,
        atomic_dispatch boolean DEFAULT false,request_attempt_count integer DEFAULT 1,PRIMARY KEY(couple_id,request_key,operation_key));
      CREATE TABLE public.amora_saved_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid REFERENCES couples(id),
        saved_by uuid REFERENCES auth.users(id),message_id uuid REFERENCES chat_messages(id),content text,memo text,
        created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE UNIQUE INDEX saved_notes_unique ON public.amora_saved_notes(couple_id,message_id) WHERE message_id IS NOT NULL;
      CREATE TABLE public.community_posts(id uuid PRIMARY KEY,author_id uuid,category text,title text,content text,ad_disclosure text DEFAULT 'general',
        upvote_count integer DEFAULT 0,comment_count integer DEFAULT 0,created_at timestamptz DEFAULT now());
      CREATE TABLE public.amora_privacy_context_epochs(couple_id uuid PRIMARY KEY REFERENCES couples(id),epoch bigint NOT NULL CHECK(epoch>=1),updated_at timestamptz DEFAULT now());
      CREATE TABLE public.decision_nodes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid REFERENCES couples(id),category text,
        decision_type text DEFAULT 'exploring',title text,chosen_value jsonb,options_considered jsonb DEFAULT '[]',reasoning text,confidence numeric,
        stage_tag text,decided_at timestamptz,source text DEFAULT 'chat',source_ref_id uuid,metadata jsonb DEFAULT '{}',visibility text DEFAULT 'shared',
        created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE public.couple_change_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid,recipient_user_id uuid,actor_user_id uuid,
        source_message_id uuid,action_id uuid,event_kind text,tool_name text,title text,message text,href text,created_at timestamptz DEFAULT now(),
        UNIQUE(couple_id,recipient_user_id,action_id,event_kind));
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      GRANT SELECT ON public.profiles,public.couples,public.chat_messages TO authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
      CREATE FUNCTION public.is_couple_member(p_couple_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
        SELECT EXISTS(SELECT 1 FROM profiles p JOIN couples c ON c.id=p.couple_id WHERE p.id=auth.uid() AND c.id=p_couple_id
          AND ((p.role='bride' AND c.bride_id=p.id) OR(p.role='groom' AND c.groom_id=p.id))) $$;
      CREATE FUNCTION public.is_my_couple(p_couple_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
        SELECT public.is_couple_member(p_couple_id) $$;
      CREATE FUNCTION public.can_access_couple_visibility(p_couple_id uuid,p_visibility text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
        SELECT EXISTS(SELECT 1 FROM couples WHERE id=p_couple_id AND ((p_visibility='shared' AND auth.uid() IN(bride_id,groom_id))
          OR(p_visibility='bride_private' AND auth.uid()=bride_id) OR(p_visibility='groom_private' AND auth.uid()=groom_id))) $$;
      ALTER TABLE public.amora_saved_notes ENABLE ROW LEVEL SECURITY;
      CREATE POLICY notes_read ON public.amora_saved_notes FOR SELECT TO authenticated USING(public.is_my_couple(couple_id));
      CREATE POLICY amora_saved_notes_delete ON public.amora_saved_notes FOR DELETE TO authenticated USING(public.is_my_couple(couple_id));
      GRANT SELECT,DELETE,INSERT,UPDATE ON public.amora_saved_notes TO authenticated;
    `);
    const membership = migration('20260716114000_current_couple_membership_privacy_fence.sql')
      .match(/CREATE OR REPLACE FUNCTION public\.is_current_couple_member\([\s\S]*?(?=CREATE OR REPLACE FUNCTION public\.can_access_couple_visibility)/)?.[0];
    if (!membership) throw new Error('local predecessor membership missing');
    await db.exec(membership);
    const privacy = migration('20260802230000_amora_atomic_privacy_epoch.sql');
    for (const name of ['advance_amora_privacy_context_epoch', 'is_amora_profile_roster_binding', 'capture_amora_couple_privacy_epoch', 'capture_amora_profile_privacy_epoch', 'get_own_amora_privacy_epoch']) {
      const fn = privacy.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
      if (!fn) throw new Error(`local predecessor function missing: ${name}`);
      await db.exec(fn);
    }
    await db.exec(`CREATE TRIGGER trg_amora_privacy_epoch_couples AFTER INSERT OR UPDATE OR DELETE ON public.couples
      FOR EACH ROW EXECUTE FUNCTION public.capture_amora_couple_privacy_epoch();
      CREATE TRIGGER trg_amora_privacy_epoch_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.capture_amora_profile_privacy_epoch();`);
    await db.exec(migration('20260716092000_amora_mediation_confirmation.sql'));
    await db.exec(migration('20260824130000_mediation_tells_the_partner.sql'));
    return db;
  } catch (error) { await db.close(); throw error; }
}

// 결과는 local-only fixture catalog hash. 운영 inventory를 흉내 낸 것으로 제출하지 않는다.
export async function localCatalog(db) {
  return (await db.query(`SELECT 'relation' AS kind,relname AS identity,md5(pg_catalog.row_to_json(c)::text) AS fingerprint
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    UNION ALL SELECT 'function',p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    UNION ALL SELECT 'policy',p.polname,md5(row_to_json(p)::text) FROM pg_policy p
    ORDER BY kind,identity`)).rows;
}

export async function localObservation(db) {
  const identity = (await db.query(`SELECT system_identifier::text AS id,current_setting('server_version') AS version,
    current_setting('transaction_read_only')='on' AS read_only FROM pg_control_system()`)).rows[0];
  const catalog = await localCatalog(db);
  const relations = (await db.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('auth','public')
    AND c.relkind IN('r','p','m','v','S') ORDER BY n.nspname,c.relname`)).rows;
  return { systemIdentifier: identity.id, serverVersion: identity.version, readOnly: identity.read_only,
    objects: catalog.map(row => ({ kind: row.kind, identity: row.identity, sha256: digestJson(row) })),
    relations, ledger: [], storageStructureSha256: digestJson([]), storagePolicies: [], vaultRows: 0, cronJobs: 0 };
}
