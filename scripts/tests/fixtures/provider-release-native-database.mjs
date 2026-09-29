import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './profile-role-native-database.mjs';
export { nativeProfileRoleAvailable as nativeProviderReleaseAvailable };

// Isolated, disposable PG17 fixture. It is not a restored production baseline.
export async function createProviderReleaseNativeDatabase(root, reviewedMigrations) {
  const owned = await createProfileRoleNativeDatabase();
  const db = owned.client;
  try {
    await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA supabase_migrations;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),is_admin boolean DEFAULT false,couple_id uuid);
      CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
      CREATE TABLE public.vendors(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users(id),name text);
      CREATE TABLE public.account_deletions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,email text,reason text,deleted_at timestamptz DEFAULT now());
      CREATE TABLE public.community_upload_sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users ON DELETE CASCADE,staging_path text,final_bucket text,final_path text,expires_at timestamptz);
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,UNIQUE(bucket_id,name));
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      GRANT USAGE ON SCHEMA auth,storage,public TO anon,authenticated,service_role;
      INSERT INTO public.vendors VALUES('11111111-1111-4111-8111-111111111111',NULL,'Synthetic unrelated sentinel');
      INSERT INTO storage.buckets VALUES('unrelated','unrelated',false,1000,ARRAY['image/webp']);
      INSERT INTO storage.objects(bucket_id,name) VALUES('unrelated','synthetic.webp');`);
    await db.query(readFileSync(join(root, 'supabase/migrations/20260716113000_account_deletion_storage_saga.sql'), 'utf8'));
    await db.query(readFileSync(join(root, 'supabase/platform-operations/storage/profile-avatar-service-only.sql'), 'utf8'));
    await db.query(readFileSync(join(root, 'supabase/migrations/20260913082314_private_profile_avatars_delivery.sql'), 'utf8'));
    await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES('22222222-2222-4222-8222-222222222222','synthetic@example.invalid',now(),'{}');
      INSERT INTO public.profiles(id) VALUES('22222222-2222-4222-8222-222222222222');
      INSERT INTO public.account_deletion_jobs(id,user_id,reason) VALUES('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','privacy');
      INSERT INTO public.account_deletion_media_manifest(job_id,bucket,path,source,not_before) VALUES('33333333-3333-4333-8333-333333333333','community-images','22222222-2222-4222-8222-222222222222/synthetic.webp','legacy_prefix',now());`);
    // Synthetic ledger rows test counting and preservation only. They do not imply
    // the complete historical schema or a hosted restore was reproduced.
    for (const { file } of reviewedMigrations) await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,ARRAY[$3]::text[])',
      [file.slice(0, 14), file.slice(15, -4), `Synthetic predecessor marker for ${file}`]);
    return owned;
  } catch (error) { await owned.close(); throw error; }
}
