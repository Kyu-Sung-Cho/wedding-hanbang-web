#!/usr/bin/env node
// 웨딩홀 문의 배포 길의 catalog 고정 파일을 만든다(2026-11-18). 운영 접속은 없다(메모리 안 PGlite 만 쓴다).
// 이 SQL 이 기대는 기존 객체는 손으로 흉내 내지 않고 실제 마이그레이션 원문에서 꺼낸다
// (apps/web/src/lib/invitation/__tests__/hallInquiryMigration.test.ts 의 prepare 와 같은 준비).
// 고정 파일은 새 객체(표·함수·기존 표 트리거)의 catalog 다. 운영 반영 뒤 같은 관측 SQL 의 결과와 바이트까지 비교한다.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { targetCatalogSql } from './hall-inquiry-release-catalog.mjs';

const FIXTURE_FILE = 'supabase/release-contracts/hall-inquiry-pg-catalog-v1.json';
const MIGRATION_FILE = 'supabase/migrations/20261117090000_hall_listings_and_inquiries.sql';
const fail = code => { const error = new Error(code); error.code = code; throw error; };

function extract(source, pattern, label) {
  const match = source.match(pattern)?.[0];
  if (!match) fail(`HIQ_FIXTURE_SOURCE_MISSING:${label}`);
  return match;
}

export async function openPglite(repoRoot) {
  const webRequire = createRequire(resolve(repoRoot, 'apps/web/package.json'));
  const { PGlite } = await import(pathToFileURL(webRequire.resolve('@electric-sql/pglite')).href);
  return new PGlite();
}

// 새 SQL 이 기대는 기존 객체를 올린다. 운영에 있는 것과 같은 원문을 쓰고, 이름만 필요한 표는 칸만 맞춘다.
export async function preparePrerequisites(db, repoRoot) {
  const read = name => readFileSync(resolve(repoRoot, 'supabase/migrations', name), 'utf8');
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE TABLE public.couples(id uuid PRIMARY KEY, bride_id uuid, groom_id uuid);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, couple_id uuid, role text, name text,
      is_admin boolean NOT NULL DEFAULT false);
  `);
  const membership = read('20260716114000_current_couple_membership_privacy_fence.sql');
  for (const name of ['is_current_couple_member', 'is_couple_member']) {
    await db.exec(extract(membership,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`), name));
  }
  await db.exec(`
    REVOKE ALL ON FUNCTION public.is_current_couple_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.is_current_couple_member(uuid, uuid) TO service_role;
    REVOKE ALL ON FUNCTION public.is_couple_member(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO authenticated, service_role;
  `);
  await db.exec(extract(read('20260730102000_amora_shared_action_approval_and_notifications.sql'),
    /CREATE TABLE IF NOT EXISTS public\.couple_change_notifications \([\s\S]*?\n\);/, 'couple_change_notifications table'));
  await db.exec(extract(read('20260731123000_couple_plan_change_write_boundary.sql'),
    /ALTER TABLE public\.couple_change_notifications\s+DROP CONSTRAINT IF EXISTS couple_change_notifications_event_kind_check;[\s\S]*?ADD CONSTRAINT couple_change_notifications_actor_recipient_check CHECK \([\s\S]*?'change_stale'\s*\)\s*\);/,
    'couple_change_notifications constraints'));
  const saga = read('20260716113000_account_deletion_storage_saga.sql');
  await db.exec(extract(saga, /CREATE TABLE public\.account_deletion_jobs \([\s\S]*?\n\);/, 'account_deletion_jobs table'));
  await db.exec(extract(saga, /CREATE UNIQUE INDEX account_deletion_jobs_active_user_idx[\s\S]*?;/, 'account_deletion_jobs active index'));
}

// 운영 관측과 같은 search_path 로 새 객체 catalog 를 읽는다.
export async function readTargetCatalog(db) {
  await db.exec('SET search_path = pg_catalog, public;');
  const { rows } = await db.query(`SELECT ${targetCatalogSql()} AS catalog`);
  return rows[0].catalog;
}

export async function buildFixture(repoRoot) {
  const sqlBytes = readFileSync(resolve(repoRoot, MIGRATION_FILE));
  const db = await openPglite(repoRoot);
  try {
    await preparePrerequisites(db, repoRoot);
    await db.exec(sqlBytes.toString('utf8'));
    const version = (await db.query('SHOW server_version')).rows[0].server_version;
    const catalog = await readTargetCatalog(db);
    return { format: 'hall-inquiry-catalog-fixture-v1',
      migrationSha256: createHash('sha256').update(sqlBytes).digest('hex'),
      engine: `PGlite (PostgreSQL ${version}), owner postgres, search_path pg_catalog,public`, catalog };
  } finally { await db.close(); }
}

export const serializeFixture = fixture => `${JSON.stringify(fixture, null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--write', '--check'].includes(args[0])) fail('HIQ_FIXTURE_ARGUMENT_INVALID');
    const repoRoot = process.cwd();
    const text = serializeFixture(await buildFixture(repoRoot));
    if (args[0] === '--write') writeFileSync(resolve(repoRoot, FIXTURE_FILE), text, { encoding: 'utf8' });
    else if (readFileSync(resolve(repoRoot, FIXTURE_FILE), 'utf8') !== text) fail('HIQ_FIXTURE_DRIFT');
    process.stdout.write(`HALL_INQUIRY_FIXTURE_${args[0] === '--write' ? 'WRITTEN' : 'VERIFIED'}: sha256=${createHash('sha256').update(text).digest('hex')}; remote_writes=false\n`);
  } catch (error) {
    process.stderr.write(`HALL_INQUIRY_FIXTURE_BLOCKED: ${/^HIQ_[A-Z0-9_:a-z]+$/u.test(error?.code ?? '') ? error.code : `HIQ_UNEXPECTED ${String(error?.message ?? error).slice(0, 200)}`}\n`);
    process.exitCode = 1;
  }
}
