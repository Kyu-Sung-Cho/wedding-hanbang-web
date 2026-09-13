import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './profile-role-native-database.mjs';
export { nativeProfileRoleAvailable as nativeProfileAvatarAvailable };

export async function createProfileAvatarNativeDatabase(root) {
  const owned=await createProfileRoleNativeDatabase();
  const previousSql=readFileSync(join(root,'supabase/migrations/20260716113000_account_deletion_storage_saga.sql'),'utf8');
  const previousFunction=previousSql.match(/CREATE OR REPLACE FUNCTION public\.replace_account_deletion_media_manifest\([\s\S]*?\$replace_manifest\$;/)?.[0];
  if(!previousFunction){await owned.close();throw Error('PROFILE_AVATAR_FIXTURE_SOURCE_INVALID')}
  try {
    await owned.client.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid,bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public,auth,storage TO service_role,authenticated,anon;
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,couple_id uuid);
      CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
      CREATE TABLE public.account_deletion_jobs(id uuid PRIMARY KEY,user_id uuid,status text,claim_token uuid,
        quarantine_count integer DEFAULT 0,ready_after timestamptz,claimed_at timestamptz,last_error_code text,updated_at timestamptz DEFAULT now());
      CREATE TABLE public.account_deletion_media_manifest(job_id uuid,bucket text,path text,source text,not_before timestamptz,
        CONSTRAINT account_deletion_media_bucket CHECK(bucket IN ('community-media-staging','community-images','community-videos','chat-image')),
        CONSTRAINT account_deletion_media_source CHECK(source IN ('session_staging','session_final','legacy_prefix','quarantine')));
      CREATE TABLE public.community_upload_sessions(user_id uuid,staging_path text,final_bucket text,final_path text,expires_at timestamptz);
      ${previousFunction}
      REVOKE ALL ON FUNCTION public.replace_account_deletion_media_manifest(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.replace_account_deletion_media_manifest(uuid,uuid,jsonb) TO service_role;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    const roleSql=readFileSync(join(root,'supabase/migrations/20260913075045_profile_wedding_roles.sql'),'utf8');
    await owned.client.query(roleSql);
    await owned.client.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260913075045','profile_wedding_roles',ARRAY[$1]::text[])",[roleSql]);
    return {...owned,previousSql};
  }catch(error){await owned.close();throw error}
}
