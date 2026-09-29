import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDeletionAuditNullabilityHistoricalReleasePlan } from '../../lib/account-deletion-audit-nullability-release-contract.mjs';
import { loadCoupleResetExpectedIdentityReleasePlan } from '../../lib/couple-reset-expected-identity-release-contract.mjs';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './profile-role-native-database.mjs';

export { nativeProfileRoleAvailable as nativeCoupleResetAvailable };
export const COUPLE_RESET_NATIVE_IDS = Object.freeze({
  user: '11111111-1111-4111-8111-111111111111',
  partner: '22222222-2222-4222-8222-222222222222',
  other: '33333333-3333-4333-8333-333333333333',
  missing: '44444444-4444-4444-8444-444444444444',
  couple: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  otherCouple: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
});
const legacyFile = '20260714164500_expand_atomic_couple_reset.sql';
const wrapperFile = '20260928144843_couple_reset_expected_identity.sql';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function seedCoupleResetNativeRows(client) {
  const ids = COUPLE_RESET_NATIVE_IDS;
  await client.query(`BEGIN;
    DELETE FROM public.profiles; DELETE FROM public.couples;
    INSERT INTO public.couples(id,bride_id,groom_id,updated_at) VALUES
      ('${ids.couple}','${ids.user}','${ids.partner}','2000-01-01Z'),
      ('${ids.otherCouple}','${ids.other}',NULL,'2000-01-01Z');
    INSERT INTO public.profiles(id,couple_id,shared_chat_cleared_at,private_chat_cleared_at,updated_at) VALUES
      ('${ids.user}','${ids.couple}','2000-01-01Z','2000-01-01Z','2000-01-01Z'),
      ('${ids.partner}','${ids.couple}','2000-01-01Z','2000-01-01Z','2000-01-01Z'),
      ('${ids.other}','${ids.otherCouple}','2000-01-01Z','2000-01-01Z','2000-01-01Z');
    COMMIT;`);
}

export async function snapshotCoupleResetNativeRows(client) {
  return (await client.query(`SELECT jsonb_build_object(
    'profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.profiles p),
    'couples',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.couples c),
    'budgets',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.synthetic_reset_budgets b),
    'schedules',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.synthetic_reset_schedules s)
  ) AS value`)).rows[0].value;
}

export async function setCoupleResetNativePersona(client, userId, role = 'authenticated') {
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  await client.query('RESET ROLE');
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false)",
    [userId ?? '', role]);
  await client.query(`SET ROLE ${role}`);
}

// 설치된 PG17의 새 loopback cluster만 사용한다. 운영 행/접속정보를 받지 않는다.
// 검토 SQL 240개와 다른 정규화 ledger 229개를 합성한다. 운영 전체 복원 증거는 아니다.
export async function createCoupleResetExpectedIdentityNativeDatabase(root) {
  const predecessor = loadDeletionAuditNullabilityHistoricalReleasePlan(root);
  const legacyPin = predecessor.reviewedMigrations.find(pin => pin.file === legacyFile);
  assert.ok(legacyPin);
  const legacySql = readFileSync(join(root, 'supabase/migrations', legacyFile), 'utf8');
  assert.equal(hash(legacySql), legacyPin.sha256);
  const sql = readFileSync(join(root, 'supabase/migrations', wrapperFile), 'utf8');
  const predecessorSql = readFileSync(join(root, 'supabase/migrations', predecessor.contract.migrations[0].file), 'utf8');
  const { expectedLedgerVersions: expectedVersions } = loadCoupleResetExpectedIdentityReleasePlan(root);
  const owned = await createProfileRoleNativeDatabase();
  try {
    await owned.client.query(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE synthetic_reset_owner NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
        AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role',true),'') $$;
      CREATE FUNCTION auth.synthetic_preserved_owner() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
      CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid,
        updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,couple_id uuid,
        onboarding_completed boolean NOT NULL DEFAULT true,onboarding_step integer NOT NULL DEFAULT 5,
        shared_chat_cleared_at timestamptz,private_chat_cleared_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.synthetic_reset_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF COALESCE(current_setting('hanbang.allow_membership_write',true),'') <> 'on' THEN
          RAISE EXCEPTION 'membership_write_blocked';
        END IF;
        IF TG_TABLE_NAME='profiles' AND COALESCE(current_setting('test.fail_profile_reset',true),'')='on' THEN
          RAISE EXCEPTION 'forced_profile_reset_failure';
        END IF;
        IF TG_TABLE_NAME='couples' AND COALESCE(current_setting('test.pause_couple_reset',true),'')='on' THEN
          PERFORM pg_advisory_xact_lock(60929,987);
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER guard_couple_membership BEFORE UPDATE OF bride_id,groom_id ON public.couples
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_reset_membership_guard();
      CREATE TRIGGER guard_profile_membership BEFORE UPDATE OF couple_id ON public.profiles
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_reset_membership_guard();
      CREATE TABLE public.synthetic_reset_budgets(id integer PRIMARY KEY,amount integer,note text);
      INSERT INTO public.synthetic_reset_budgets VALUES(1,50000,'synthetic retained budget');
      CREATE TABLE public.synthetic_reset_schedules(id integer PRIMARY KEY,title text);
      INSERT INTO public.synthetic_reset_schedules VALUES(1,'synthetic retained schedule');
      CREATE VIEW public.synthetic_preserved_view AS SELECT 1 AS value;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
    `);
    await seedCoupleResetNativeRows(owned.client);
    await owned.client.query(`BEGIN;\n${legacySql}\nCOMMIT;`);
    for (const version of expectedVersions) {
      const pin = predecessor.reviewedMigrations.find(candidate => candidate.file.startsWith(`${version}_`));
      const name = pin?.file.slice(15, -4) ?? `synthetic_normalized_${version}`;
      const source = pin?.file === predecessor.contract.migrations[0].file ? predecessorSql
        : pin?.file === legacyFile ? legacySql : `synthetic normalized predecessor ${version}`;
      await owned.client.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,ARRAY[$3]::text[])',
        [version, name, source]);
    }
    return { ...owned, sql, legacySql, predecessorSql, expectedVersions };
  } catch (error) { await owned.close(); throw error; }
}
