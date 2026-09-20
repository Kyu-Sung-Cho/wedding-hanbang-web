import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './profile-role-native-database.mjs';
export { nativeProfileRoleAvailable as nativePreparationStyleAvailable };

// 새 lane의 DDL/ACL/기존 부모 테이블 보존을 확인하는 합성 PG17. 고객 행은 사용하지 않는다.
export async function createPreparationStyleNativeDatabase(root) {
  const owned=await createProfileRoleNativeDatabase();
  try {
    await owned.client.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
      CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,couple_id uuid,role text);
      CREATE TABLE public.account_deletion_jobs(user_id uuid,status text NOT NULL);
      CREATE TABLE public.unrelated_rows(id int PRIMARY KEY,note text);
      INSERT INTO public.unrelated_rows VALUES(1,'synthetic preserved');
      CREATE SEQUENCE public.unrelated_sequence;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    const dependency=pinnedArtifact(root,{file:'supabase/migrations/20260716114000_current_couple_membership_privacy_fence.sql',
      sha256:'cabf4988ac7969f3084280c1cc69fce62bc22f05c371f64d98c68207b870dc2b'}).toString('utf8');
    const begin=dependency.indexOf('CREATE OR REPLACE FUNCTION public.is_current_couple_member(');
    const end=dependency.indexOf('\nCREATE OR REPLACE FUNCTION public.is_couple_member(',begin);
    assert.ok(begin>=0&&end>begin);await owned.client.query(dependency.slice(begin,end));
    const predecessorSql=readFileSync(join(root,'supabase/migrations/20260918090000_wedding_code_research_scene_v10.sql'),'utf8');
    await owned.client.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260918090000','wedding_code_research_scene_v10',ARRAY[$1]::text[])",[predecessorSql]);
    return {...owned,predecessorSql};
  } catch(error) { await owned.close(); throw error; }
}
