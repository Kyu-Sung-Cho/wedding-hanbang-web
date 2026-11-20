#!/usr/bin/env node
// 아모라 먼저 챙기기 배포 길의 catalog 고정 파일을 만든다(2026-11-20). 운영 접속은 없다(메모리 안 PGlite 만 쓴다).
// 바꾸는 기존 함수·트리거·주석은 손으로 흉내 내지 않고 그 객체를 만든 실제 마이그레이션 원문을 그대로 올린다
// (apps/web/src/lib/care/__tests__/careCadenceMigration.test.ts·amoraTodayOneMigration.test.ts 의 준비와 같은 순서).
// 고정 파일에는 대상 catalog 의 적용 전(before)과 적용 뒤(after) 모양을 둘 다 담는다. 운영 관측은 이 두 값과 바이트까지 같아야 한다.
// 운영처럼 postgres 가 public 에 만드는 객체는 기본으로 postgres·anon·authenticated·service_role 에게 열린다
// (운영 기본 권한 지문과 같다: supabase/release-contracts/current-production-baseline-20260907.json 의 defaultAcl postgres:public:*).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIGRATIONS, targetCatalogSql } from './amora-proactive-release-catalog.mjs';

export const FIXTURE_FILE = 'supabase/release-contracts/amora-proactive-pg-catalog-v1.json';
// 바꾸는 기존 객체를 만든 마이그레이션. 이 차례대로 올린다.
export const PRIOR_MIGRATIONS = Object.freeze(['20260716091000_care_explicit_consent.sql', '20260716093000_amora_care_queue.sql',
  '20260716095000_amora_care_delivery_policy.sql', '20260716104000_profile_patch_atomic.sql',
  '20260802090000_amora_moment_care_source_revision.sql', '20260802130000_amora_in_app_today_one.sql',
  '20260802150000_amora_today_one_budget_guardrails.sql']);
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function openPglite(repoRoot) {
  const webRequire = createRequire(resolve(repoRoot, 'apps/web/package.json'));
  const { PGlite } = await import(pathToFileURL(webRequire.resolve('@electric-sql/pglite')).href);
  return new PGlite();
}

// 위 마이그레이션이 기대는 운영 표 중 이 길과 무관한 것은 칸만 맞춘다(이 표들의 모양은 대상 catalog 에 들지 않는다).
const SUPABASE_SHELL = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  CREATE TABLE public.couples(id uuid PRIMARY KEY, bride_id uuid REFERENCES auth.users(id), groom_id uuid REFERENCES auth.users(id));
  CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), couple_id uuid REFERENCES public.couples(id),
    role text, email text, name text, phone text, phone_care_consented_at timestamptz,
    care_notifications_enabled boolean NOT NULL DEFAULT false, care_notifications_consented_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.community_profiles(user_id uuid PRIMARY KEY, nickname text NOT NULL, badge text NOT NULL DEFAULT 'member',
    post_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
    total_upvotes_received integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.community_posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL,
    visibility text NOT NULL DEFAULT 'public', under_review boolean NOT NULL DEFAULT false);
  CREATE TABLE public.community_comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL,
    is_deleted boolean NOT NULL DEFAULT false);
  CREATE TABLE public.wedding_journeys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id), wedding_date date,
    progress jsonb NOT NULL DEFAULT '{}'::jsonb, state_revision bigint NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now());
  CREATE TABLE public.chat_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    couple_id uuid NOT NULL REFERENCES public.couples(id), sender_id uuid, sender_type text NOT NULL, role text NOT NULL,
    content text NOT NULL, sender_role text, specialist_type text, stage_tag text, visibility text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX chat_messages_client_request_id_unique ON public.chat_messages (couple_id, (metadata->>'client_request_id'))
    WHERE metadata->>'client_request_id' IS NOT NULL;
`;
// 20260804170000 의 기기 토큰 표와 대상 함수는 이 SQL 이 읽고 쓰는 칸과 서명만 맞춘다(그 모양도 대상 catalog 밖이다).
const PUSH_SHELL = `
  CREATE TABLE public.mobile_push_device_tokens(installation_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, push_token text, platform text NOT NULL DEFAULT 'android',
    binding_epoch bigint NOT NULL DEFAULT 1, last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_at timestamptz, revoke_reason text);
  CREATE FUNCTION public.get_mobile_push_delivery_targets(p_target_user_id uuid)
  RETURNS TABLE (installation_id uuid, push_token text, platform text, binding_epoch bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT b.installation_id, b.push_token, b.platform, b.binding_epoch FROM public.mobile_push_device_tokens AS b
    WHERE b.user_id = p_target_user_id AND b.revoked_at IS NULL AND b.push_token IS NOT NULL ORDER BY b.installation_id $$;
  REVOKE ALL ON FUNCTION public.get_mobile_push_delivery_targets(uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_mobile_push_delivery_targets(uuid) TO service_role;
`;

// 새 SQL 이 기대는 기존 객체를 올린다. 바꾸는 기존 객체는 운영에 있는 것과 같은 원문으로 만든다.
// priorMigrations 는 시험이 운영의 어긋난 상태(예: 원장에는 있지만 효과가 없는 마이그레이션)를 재현할 때만 바꾼다.
export async function preparePrerequisites(db, repoRoot, { priorMigrations = PRIOR_MIGRATIONS } = {}) {
  await db.exec(SUPABASE_SHELL);
  for (const name of priorMigrations) await db.exec(readFileSync(resolve(repoRoot, 'supabase/migrations', name), 'utf8'));
  await db.exec(PUSH_SHELL);
}

// 운영 관측과 같은 search_path 로 대상 catalog 를 읽는다.
export async function readTargetCatalog(db) {
  await db.exec('SET search_path = pg_catalog, public;');
  const { rows } = await db.query(`SELECT ${targetCatalogSql()} AS catalog`);
  return rows[0].catalog;
}

export async function buildFixture(repoRoot) {
  const sources = MIGRATIONS.map(m => ({ file: m.file, bytes: readFileSync(resolve(repoRoot, m.file)) }));
  const db = await openPglite(repoRoot);
  try {
    await preparePrerequisites(db, repoRoot);
    const before = await readTargetCatalog(db);
    for (const source of sources) await db.exec(source.bytes.toString('utf8'));
    const after = await readTargetCatalog(db);
    const version = (await db.query('SHOW server_version')).rows[0].server_version;
    return { format: 'amora-proactive-catalog-fixture-v1',
      migrations: sources.map(source => ({ file: source.file, sha256: digest(source.bytes) })),
      engine: `PGlite (PostgreSQL ${version}), owner postgres, search_path pg_catalog,public, Supabase public default privileges`,
      before, after };
  } finally { await db.close(); }
}

export const serializeFixture = fixture => `${JSON.stringify(fixture, null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--write', '--check'].includes(args[0])) fail('APRO_FIXTURE_ARGUMENT_INVALID');
    const repoRoot = process.cwd();
    const text = serializeFixture(await buildFixture(repoRoot));
    if (args[0] === '--write') writeFileSync(resolve(repoRoot, FIXTURE_FILE), text, { encoding: 'utf8' });
    else if (readFileSync(resolve(repoRoot, FIXTURE_FILE), 'utf8') !== text) fail('APRO_FIXTURE_DRIFT');
    process.stdout.write(`AMORA_PROACTIVE_FIXTURE_${args[0] === '--write' ? 'WRITTEN' : 'VERIFIED'}: sha256=${digest(Buffer.from(text))}; remote_writes=false\n`);
  } catch (error) {
    process.stderr.write(`AMORA_PROACTIVE_FIXTURE_BLOCKED: ${/^APRO_[A-Z0-9_:a-z]+$/u.test(error?.code ?? '') ? error.code : `APRO_UNEXPECTED ${String(error?.message ?? error).slice(0, 200)}`}\n`);
    process.exitCode = 1;
  }
}
