#!/usr/bin/env node
// 아모라 맡은 일 배포 길의 catalog 고정 파일을 만든다(2026-11-20). 운영 접속은 없다(메모리 안 PGlite 만 쓴다).
// 이 SQL 이 기대는 기존 객체는 손으로 흉내 내지 않고 실제 마이그레이션 원문에서 꺼낸다(웨딩홀 문의 길과 같은 준비).
// 이름만 필요한 표(profiles·chat_messages 의 칸)는 칸만 맞춘다.
// 고정 파일은 새 객체(표·함수)의 catalog 다. 운영 반영 뒤 같은 관측 SQL 의 결과와 바이트까지 비교한다.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIGRATION_FILE, targetCatalogSql } from './amora-tasks-release-catalog.mjs';

const FIXTURE_FILE = 'supabase/release-contracts/amora-tasks-pg-catalog-v1.json';
const fail = code => { const error = new Error(code); error.code = code; throw error; };

function extract(source, pattern, label) {
  const match = source.match(pattern)?.[0];
  if (!match) fail(`ATK_FIXTURE_SOURCE_MISSING:${label}`);
  return match;
}

export async function openPglite(repoRoot) {
  const webRequire = createRequire(resolve(repoRoot, 'apps/web/package.json'));
  const { PGlite } = await import(pathToFileURL(webRequire.resolve('@electric-sql/pglite')).href);
  return new PGlite();
}

// 새 SQL 이 기대는 기존 객체를 올린다. 운영에 있는 것과 같은 원문을 쓴다.
//   - 표 CHECK 가 부르는 함수 couple_plan_change_has_unsafe_display_text(20260731123000)
//   - 정책·본문이 부르는 is_couple_member·is_current_couple_member(20260716114000)
//   - 본문이 읽는 account_deletion_jobs(20260716113000)·amora_chat_request_claims(20260714160000)
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
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, couple_id uuid, role text, name text);
    CREATE TABLE public.chat_messages(id uuid PRIMARY KEY);
  `);
  const membership = read('20260716114000_current_couple_membership_privacy_fence.sql');
  for (const name of ['is_current_couple_member', 'is_couple_member']) {
    await db.exec(extract(membership,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`), name));
  }
  await db.exec(extract(read('20260731123000_couple_plan_change_write_boundary.sql'),
    /CREATE OR REPLACE FUNCTION public\.couple_plan_change_has_unsafe_display_text\([\s\S]*?\$function\$;/,
    'couple_plan_change_has_unsafe_display_text'));
  await db.exec(`
    REVOKE ALL ON FUNCTION public.is_current_couple_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.is_current_couple_member(uuid, uuid) TO service_role;
    REVOKE ALL ON FUNCTION public.is_couple_member(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO authenticated, service_role;
    REVOKE ALL ON FUNCTION public.couple_plan_change_has_unsafe_display_text(text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.couple_plan_change_has_unsafe_display_text(text) TO service_role;
  `);
  await db.exec(extract(read('20260716113000_account_deletion_storage_saga.sql'),
    /CREATE TABLE public\.account_deletion_jobs \([\s\S]*?\n\);/, 'account_deletion_jobs table'));
  await db.exec(extract(read('20260714160000_harden_amora_privacy_boundaries.sql'),
    /CREATE TABLE IF NOT EXISTS public\.amora_chat_request_claims \([\s\S]*?\n\);/, 'amora_chat_request_claims table'));
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
    return { format: 'amora-tasks-catalog-fixture-v1',
      migrationSha256: createHash('sha256').update(sqlBytes).digest('hex'),
      engine: `PGlite (PostgreSQL ${version}), owner postgres, search_path pg_catalog,public`, catalog };
  } finally { await db.close(); }
}

export const serializeFixture = fixture => `${JSON.stringify(fixture, null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--write', '--check'].includes(args[0])) fail('ATK_FIXTURE_ARGUMENT_INVALID');
    const repoRoot = process.cwd();
    const text = serializeFixture(await buildFixture(repoRoot));
    if (args[0] === '--write') writeFileSync(resolve(repoRoot, FIXTURE_FILE), text, { encoding: 'utf8' });
    else if (readFileSync(resolve(repoRoot, FIXTURE_FILE), 'utf8') !== text) fail('ATK_FIXTURE_DRIFT');
    process.stdout.write(`AMORA_TASKS_FIXTURE_${args[0] === '--write' ? 'WRITTEN' : 'VERIFIED'}: sha256=${createHash('sha256').update(text).digest('hex')}; remote_writes=false\n`);
  } catch (error) {
    process.stderr.write(`AMORA_TASKS_FIXTURE_BLOCKED: ${/^ATK_[A-Z0-9_:a-z]+$/u.test(error?.code ?? '') ? error.code : `ATK_UNEXPECTED ${String(error?.message ?? error).slice(0, 200)}`}\n`);
    process.exitCode = 1;
  }
}
