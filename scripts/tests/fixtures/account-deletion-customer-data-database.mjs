// Shared synthetic-only dependencies for the PGlite and native PostgreSQL tests.
// Execute unchanged deployed privacy/roster functions plus NEW232; this is not
// a full hosted Auth/Storage deployment or a customer-data fixture.

export const A = "00000000-0000-4000-8000-000000000001";
export const B = "00000000-0000-4000-8000-000000000002";
export const C = "10000000-0000-4000-8000-000000000001";
export const J = "30000000-0000-4000-8000-000000000001";
export const T = "40000000-0000-4000-8000-000000000001";
export const M = "20000000-0000-4000-8000-000000000001";
export const key = (actor) => `chat:${actor}:50000000-0000-4000-8000-000000000001`;

/**
 * @template {{ exec: (sql: string) => Promise<unknown> }} Database
 * @param {{ createDatabase: () => Promise<Database>, readMigration: (name: string) => string, subjectRole?: 'bride'|'groom', coupled?: boolean, installMigration?: boolean }} parameters
 * @returns {Promise<Database>}
 */
export async function createCustomerDataBoundaryFixture({ createDatabase, readMigration: sql, subjectRole = "bride", coupled = true, installMigration = true }) {
  const db = await createDatabase();
  const migration = sql("20260913103407_account_deletion_customer_data_boundary.sql");
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.couples(id uuid PRIMARY KEY, bride_id uuid REFERENCES auth.users ON DELETE SET NULL, groom_id uuid REFERENCES auth.users ON DELETE SET NULL);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE, couple_id uuid REFERENCES couples ON DELETE SET NULL, role text, private_chat_cleared_at timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.chat_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), couple_id uuid REFERENCES couples ON DELETE CASCADE, sender_id uuid REFERENCES auth.users ON DELETE SET NULL, sender_type text, role text, content text, visibility text, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
    CREATE TABLE public.chat_summaries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), couple_id uuid REFERENCES couples ON DELETE CASCADE, user_id uuid REFERENCES auth.users ON DELETE CASCADE, visibility text, summary text);
    CREATE TABLE public.decision_nodes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), couple_id uuid REFERENCES couples ON DELETE CASCADE, visibility text, source text, source_message_id uuid REFERENCES chat_messages ON DELETE SET NULL, memory_key text, metadata jsonb DEFAULT '{}', category text, title text);
    CREATE TABLE public.amora_couple_profiles(couple_id uuid REFERENCES couples ON DELETE CASCADE, visibility text, profile jsonb);
    CREATE TABLE public.amora_memory_settings(couple_id uuid REFERENCES couples ON DELETE CASCADE, visibility text, enabled boolean DEFAULT false, enabled_by uuid REFERENCES auth.users ON DELETE SET NULL, enabled_at timestamptz, memory_reset_at timestamptz, legacy_purged_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), PRIMARY KEY(couple_id,visibility));
    CREATE TABLE public.amora_memory_consents(couple_id uuid REFERENCES couples ON DELETE CASCADE, visibility text, user_id uuid REFERENCES auth.users ON DELETE CASCADE, PRIMARY KEY(couple_id,visibility,user_id));
    CREATE TABLE public.amora_memory_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), couple_id uuid REFERENCES couples ON DELETE CASCADE, visibility text, user_id uuid REFERENCES auth.users ON DELETE SET NULL, status text, claimed_at timestamptz, completed_at timestamptz, updated_at timestamptz DEFAULT now(), available_at timestamptz DEFAULT now(), attempt_count integer DEFAULT 0, last_error_code text, created_at timestamptz DEFAULT now());
    CREATE TABLE public.amora_chat_request_claims(couple_id uuid REFERENCES couples ON DELETE CASCADE, request_key text, user_id uuid REFERENCES profiles ON DELETE CASCADE, visibility text, tool_round_journal jsonb DEFAULT '[]', PRIMARY KEY(couple_id,request_key));
    CREATE TABLE public.amora_tool_executions(couple_id uuid REFERENCES couples ON DELETE CASCADE, request_key text, operation_key text, result jsonb, PRIMARY KEY(couple_id,request_key,operation_key));
    CREATE TABLE public.amora_memory_enqueue_repair_candidates(couple_id uuid, request_key text, user_id uuid, visibility text, FOREIGN KEY(couple_id,request_key) REFERENCES amora_chat_request_claims ON DELETE CASCADE);
    CREATE TABLE public.amora_memory_enqueue_repair_dead_letters(LIKE amora_memory_enqueue_repair_candidates);
    CREATE TABLE public.amora_saved_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), couple_id uuid REFERENCES couples ON DELETE CASCADE, saved_by uuid REFERENCES auth.users ON DELETE CASCADE, message_id uuid REFERENCES chat_messages ON DELETE SET NULL, content text);
    CREATE TABLE public.amora_mediation_acceptances(couple_id uuid REFERENCES couples ON DELETE CASCADE);
    CREATE TABLE public.amora_personalization_preferences(owner_user_id uuid REFERENCES auth.users ON DELETE CASCADE);
    CREATE TABLE public.vendors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid REFERENCES auth.users ON DELETE RESTRICT);
    CREATE TABLE public.account_deletion_jobs(id uuid PRIMARY KEY, user_id uuid, status text, claim_token uuid, quarantine_count integer DEFAULT 0, ready_after timestamptz, storage_verified_at timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.account_deletion_media_manifest(job_id uuid REFERENCES account_deletion_jobs ON DELETE CASCADE, source text, not_before timestamptz, cleaned_at timestamptz);
    CREATE TABLE public.budgets(couple_id uuid REFERENCES couples ON DELETE CASCADE, payload jsonb);
    CREATE TABLE public.schedules(couple_id uuid REFERENCES couples ON DELETE CASCADE, payload jsonb);
    CREATE TABLE public.wedding_journeys(couple_id uuid REFERENCES couples ON DELETE CASCADE, payload jsonb);
    INSERT INTO auth.users VALUES('${A}'),('${B}');
    INSERT INTO couples VALUES('${C}','${subjectRole === "bride" ? A : B}',${coupled ? `'${subjectRole === "groom" ? A : B}'` : "NULL"});
    INSERT INTO profiles VALUES('${A}','${C}','${subjectRole}',NULL,now()),('${B}',${coupled ? `'${C}'` : "NULL"},'${subjectRole === "bride" ? "groom" : "bride"}',NULL,now());
    INSERT INTO chat_messages(id,couple_id,sender_id,sender_type,role,content,visibility) VALUES
      ('${M}','${C}','${A}','${subjectRole}','user','departing private','${subjectRole}_private'),
      (gen_random_uuid(),'${C}',NULL,'ai','assistant','private AI source','${subjectRole}_private'),
      (gen_random_uuid(),'${C}','${A}','${subjectRole}','user','shared sentinel','shared');
    INSERT INTO chat_summaries(couple_id,user_id,visibility,summary) VALUES('${C}','${A}','shared','shared summary'),('${C}','${A}','${subjectRole}_private','private summary');
    INSERT INTO decision_nodes(couple_id,visibility,source,source_message_id,title) VALUES
      ('${C}','${subjectRole}_private','chat','${M}','automatic private'),
      ('${C}','${subjectRole}_private','manual',NULL,'manual private'),
      ('${C}','shared','chat',NULL,'shared decision');
    INSERT INTO amora_couple_profiles VALUES('${C}','${subjectRole}_private','{"private":true}'),('${C}','shared','{"shared":true}');
    INSERT INTO amora_memory_settings(couple_id,visibility,enabled,enabled_by) VALUES('${C}','${subjectRole}_private',true,'${A}'),('${C}','shared',true,'${A}');
    INSERT INTO amora_memory_consents VALUES('${C}','${subjectRole}_private','${A}');
    INSERT INTO amora_memory_jobs(couple_id,visibility,user_id,status) VALUES('${C}','${subjectRole}_private','${A}','processing');
    INSERT INTO amora_chat_request_claims VALUES('${C}','${key(A)}','${A}','${subjectRole}_private','[{"private":"journal"}]');
    INSERT INTO amora_tool_executions VALUES('${C}','${key(A)}','op','{"private":"result"}');
    INSERT INTO amora_memory_enqueue_repair_candidates VALUES('${C}','${key(A)}','${A}','${subjectRole}_private');
    INSERT INTO amora_memory_enqueue_repair_dead_letters VALUES('${C}','${key(A)}','${A}','${subjectRole}_private');
    INSERT INTO amora_saved_notes(couple_id,saved_by,message_id,content) VALUES('${C}','${B}','${M}','legacy copied private'),('${C}','${B}',NULL,'partner standalone note');
    INSERT INTO budgets VALUES('${C}','{"total":35000000,"spent":2000000}');
    INSERT INTO schedules VALUES('${C}','{"title":"joint venue visit","date":"2026-10-01"}');
    INSERT INTO wedding_journeys VALUES('${C}','{"checklist":{"greeting":true}}');
    INSERT INTO account_deletion_jobs(id,user_id,status,claim_token,ready_after) VALUES('${J}','${A}','deleting','${T}',now()-interval '1 hour');
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public,auth TO service_role;
  `);
  if (coupled) await db.exec(`
    INSERT INTO chat_messages(couple_id,sender_id,sender_type,role,content,visibility) VALUES('${C}','${B}','${subjectRole === "bride" ? "groom" : "bride"}','user','partner private sentinel','${subjectRole === "bride" ? "groom" : "bride"}_private');
  `);
  await db.exec(sql("20260731173000_private_chat_hard_delete_boundary.sql"));
  // These exact deployed epoch tables/functions/triggers have no provider-RPC
  // dependencies. Keep them active during Auth cascades and private cleanup.
  const epoch = sql("20260802230000_amora_atomic_privacy_epoch.sql");
  await db.exec(epoch.slice(epoch.indexOf("CREATE TABLE public.amora_privacy_context_epochs"),
    epoch.indexOf("CREATE OR REPLACE FUNCTION public.get_own_amora_privacy_context_snapshot")));
  await db.exec(sql("20260902120000_leaving_does_not_erase_the_partner_memory.sql"));
  await db.exec(`
    CREATE TRIGGER roster_memory AFTER UPDATE OF bride_id,groom_id ON couples FOR EACH ROW EXECUTE FUNCTION reset_amora_memory_after_membership_change();
    CREATE FUNCTION delete_empty_couple() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.bride_id IS NULL AND NEW.groom_id IS NULL THEN DELETE FROM couples WHERE id=NEW.id; END IF; RETURN NEW; END $$;
    CREATE TRIGGER empty_couple AFTER UPDATE OF bride_id,groom_id ON couples FOR EACH ROW EXECUTE FUNCTION delete_empty_couple();
  `);
  if (installMigration) await db.exec(migration);
  return db;
}
