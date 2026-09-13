import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProfileRoleMutationSql, profileRoleTargetCatalogSql, profileRolePreservedCatalogSql,
  profileRoleLedgerDigestSql, validateProfileRoleCatalog, buildProfileRoleObservationSql,
  PROFILE_ROLE_REQUIRED_COLUMNS } from '../lib/profile-wedding-roles-catalog.mjs';
const root = resolve(import.meta.dirname, '../..');
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './fixtures/profile-role-native-database.mjs';
const sql = readFileSync(resolve(root, 'supabase/migrations/20260913075045_profile_wedding_roles.sql'), 'utf8');

test('actual SQL catalog, rollback and commit preserve existing definitions and rows; ACL drift is rejected', { skip: nativeProfileRoleAvailable ? false : 'native PG17 unavailable; actual catalog/transaction test not verified', timeout: 120000 }, async () => {
  const owned = await createProfileRoleNativeDatabase();
  const db = { exec: sql => owned.client.query(sql), query: sql => owned.client.query(sql), close: owned.close };
  try {
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,couple_id uuid,name text);
      CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
      CREATE TABLE public.account_deletion_jobs(id uuid PRIMARY KEY,user_id uuid,status text);
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      INSERT INTO supabase_migrations.schema_migrations VALUES('20260913043211','fixture',ARRAY['fixture']);
      INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111');
      INSERT INTO profiles VALUES('11111111-1111-4111-8111-111111111111','bride',NULL,'synthetic preserved');`);
    const catalog = async () => (await db.query(`SELECT ${profileRoleTargetCatalogSql()} AS value`)).rows[0].value;
    const preserved = async () => (await db.query(`SELECT ${profileRolePreservedCatalogSql()} AS value`)).rows[0].value;
    const ledger = async () => (await db.query(`SELECT ${profileRoleLedgerDigestSql()} AS value`)).rows[0].value;
    const originalRows = (await db.query('SELECT * FROM profiles')).rows;
    const before = { catalog: await catalog(), preservedCatalogSha: await preserved(), ledgerSha: await ledger(), migration: null };
    validateProfileRoleCatalog(before.catalog, sql, false);
    const observation = (await db.query(buildProfileRoleObservationSql())).find(result => result.rows[0]?.observation)?.rows[0].observation;
    assert.equal(observation.systemIdentifier, owned.system);
    assert.equal(observation.readOnly, true);
    assert.deepEqual(observation.dependencies, PROFILE_ROLE_REQUIRED_COLUMNS);
    assert.equal(observation.preservedCatalogSha, before.preservedCatalogSha);
    // 합성 PG17은 운영과 다른 system identifier를 가진다. 고정 identity 조회만 합성값으로
    // 대체하며 실행할 transaction/DDL/이력/전후 catalog 식은 제품 executor 원문이다.
    const bundle = rehearsal => buildProfileRoleMutationSql({sql,before,rehearsal,
      deadline: new Date(Date.now()+120_000).toISOString()})
      .replace("<> '7581440907192989109'", "<> '"+owned.system+"'");
    await db.exec(bundle(true));
    assert.deepEqual(await catalog(), before.catalog);
    assert.equal(await preserved(), before.preservedCatalogSha);
    assert.equal(await ledger(), before.ledgerSha);
    await db.exec(bundle(false));
    validateProfileRoleCatalog(await catalog(), sql, true);
    assert.equal(await preserved(), before.preservedCatalogSha);
    assert.deepEqual((await db.query('SELECT * FROM profiles')).rows, originalRows);
    assert.equal((await db.query("SELECT statements[1] AS sql FROM supabase_migrations.schema_migrations WHERE version='20260913075045'")).rows[0].sql, sql);
    await db.exec('GRANT SELECT ON public.profile_wedding_roles TO authenticated');
    const drifted = await catalog();
    assert.throws(() => validateProfileRoleCatalog(drifted, sql, true), { code: 'PROFILE_ROLE_TARGET_CATALOG_DRIFT' });
  } finally { await db.close(); }
});
