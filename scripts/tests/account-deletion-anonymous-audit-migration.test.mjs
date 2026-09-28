import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './fixtures/profile-role-native-database.mjs';
import { buildDeletionAuditObservationSql, validateDeletionAuditObservation,
  buildDeletionAuditMutationSql } from '../lib/account-deletion-audit-nullability-release.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const migrationPath = join(root, 'supabase/migrations/20260928073546_account_deletion_anonymous_audit.sql');
const migration = readFileSync(migrationPath, 'utf8');
const sagaPath = join(root, 'supabase/migrations/20260716113000_account_deletion_storage_saga.sql');
const saga = readFileSync(sagaPath, 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const catalogMatch = migration.match(/SELECT jsonb_build_object\([\s\S]*?\) INTO observed_catalog;/);
assert.ok(catalogMatch, 'migration must compare the preserved catalog before and after');
const catalogSql = catalogMatch[0].replace('INTO observed_catalog;', 'AS catalog;');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const J = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T = '55555555-5555-4555-8555-555555555555';
const W = '44444444-4444-4444-8444-444444444444';
const version = '20260928073546';
const productionSystem = '7581440907192989109';
const receipt = { remoteCalls: 0, customerData: false, sqlSha256: digest(migration),
  sagaSha256: digest(saga), nativePostgres17: false, notNullFailureReproduced: false,
  rollbackRestored: false, unrelatedCatalogPreserved: false, legacyRowsPreserved: false,
  authAndClaimGuardsPreserved: false, anonymousCompletion: false, idempotent: false,
  runtimeTargetAndDriftGuards: false, runtimeRollback: false, runtimeLedgerAtomic: false,
  nativeClusterClosed: false };

// 한 번만 쓰는 loopback PG17 cluster다. 운영 DB·Auth·Storage 복제라고 주장하지 않는다.
// 기존 테이블 형태와 실제 finalizer SQL을 함께 사용해 NOT NULL 회귀를 재현한다.
test('native PG17: legacy audit NOT NULL, DDL rollback, exact finalization and anonymous replay', {
  skip: nativeProfileRoleAvailable ? false : 'installed PG17 unavailable; native migration NOT verified',
  timeout: 90000,
}, async t => {
  const owned = await createProfileRoleNativeDatabase();
  const db = owned.client;
  try {
    const postgresVersion = Number((await db.query("SELECT current_setting('server_version_num') AS version")).rows[0].version);
    assert.ok(postgresVersion >= 170000 && postgresVersion < 180000);
    receipt.nativePostgres17 = true;
    await db.query(`
      CREATE EXTENSION "uuid-ossp";
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE public.vendors(id uuid PRIMARY KEY, owner_id uuid REFERENCES auth.users(id));
      CREATE TABLE public.community_upload_sessions(
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        staging_path text NOT NULL, final_bucket text NOT NULL, final_path text NOT NULL,
        expires_at timestamptz NOT NULL);
      CREATE TABLE public.account_deletions(
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), user_id uuid NOT NULL, email text,
        reason text NOT NULL DEFAULT 'unknown', deleted_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT synthetic_reason_nonempty CHECK(length(reason)>0));
      ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.account_deletions FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.account_deletions FROM PUBLIC,anon,authenticated;
      GRANT SELECT,INSERT ON public.account_deletions TO service_role;
      CREATE POLICY synthetic_audit_service ON public.account_deletions TO service_role
        USING(true) WITH CHECK(true);
      CREATE INDEX synthetic_audit_reason ON public.account_deletions(reason);
      CREATE FUNCTION public.synthetic_audit_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NEW; END $$;
      CREATE TRIGGER synthetic_audit_before BEFORE INSERT ON public.account_deletions
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_audit_trigger();
      INSERT INTO auth.users VALUES('${A}');
      INSERT INTO public.account_deletions(id,user_id,email,reason,deleted_at)
        VALUES('${B}','${B}','synthetic-legacy@example.invalid','unknown','2026-01-01T00:00:00Z');
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      INSERT INTO supabase_migrations.schema_migrations VALUES('20260927120000','synthetic_predecessor',ARRAY['synthetic unchanged ledger']);
    `);
    await db.query(saga);
    await db.query(`INSERT INTO public.account_deletion_jobs(
      id,user_id,reason,status,claim_token,claimed_at,storage_verified_at)
      VALUES($1,$2,'privacy','auth_deleting',$3,clock_timestamp(),clock_timestamp())`, [J,A,T]);
    await db.query(`INSERT INTO public.account_deletion_media_manifest(job_id,bucket,path,source,not_before,cleaned_at)
      VALUES($1,'community-images',$2,'session_final',clock_timestamp(),clock_timestamp())`, [J,`${A}/33333333-3333-4333-8333-333333333333.png`]);
    const catalog = (await db.query(catalogSql)).rows[0].catalog;
    const legacy = (await db.query('SELECT to_jsonb(a) AS row FROM public.account_deletions a WHERE id=$1', [B])).rows;
    const functionSql = `SELECT pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig
      FROM pg_proc WHERE oid='public.finalize_account_deletion_job(uuid,uuid)'::regprocedure`;
    const finalizer = (await db.query(functionSql)).rows;
    const jobState = async () => (await db.query('SELECT to_jsonb(j) AS row FROM public.account_deletion_jobs j WHERE id=$1', [J])).rows;
    const originalJob = await jobState();
    const finalize = async (job=J, claim=T) => (await db.query('SELECT public.finalize_account_deletion_job($1,$2) AS ok',[job,claim])).rows[0].ok;
    const isNotNull = async () => (await db.query(`SELECT attnotnull FROM pg_attribute
      WHERE attrelid='public.account_deletions'::regclass AND attname='user_id'`)).rows[0].attnotnull;
    const observe = async () => (await db.query(buildDeletionAuditObservationSql(migration,version)))
      .find(result => result.rows[0]?.observation).rows[0].observation;
    const before = await observe();
    assert.equal(before.systemIdentifier,owned.system);
    assert.equal(before.catalog.columns.find(column => column.name==='user_id').type,'2950');
    assert.equal(before.readOnly,true);
    assert.throws(()=>validateDeletionAuditObservation(before,{sql:migration,version,now:new Date()}),
      {code:'DELETION_AUDIT_OBSERVATION_INVALID'});
    // 관측 형태 검증에만 합성 host identity를 치환한다. 운영 대상 검사는 변경하지 않는다.
    validateDeletionAuditObservation({...before,systemIdentifier:productionSystem},{sql:migration,version,now:new Date()});
    const bundle = (rehearsal,override={}) => {
      const text = buildDeletionAuditMutationSql({sql:migration,version,before,
        deadline:new Date(Date.now()+120000).toISOString(),rehearsal,...override});
      const exact = `<> '${productionSystem}'`;
      assert.equal(text.split(exact).length-1,1,'only the fixed synthetic host identity may be substituted');
      return text.replace(exact,`<> '${owned.system}'`);
    };

    await t.test('unpatched SQL raises 23502 after Auth deletion; the finalizer transaction preserves the job and manifest', async () => {
      await db.query(`DELETE FROM auth.users WHERE id='${A}'; SET ROLE service_role;`);
      await assert.rejects(finalize(), error => error.code==='23502' && error.table==='account_deletions' && error.column==='user_id');
      await db.query('RESET ROLE');
      assert.deepEqual(await jobState(), originalJob);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.account_deletion_media_manifest WHERE job_id=$1 AND cleaned_at IS NOT NULL',[J])).rows[0].n,1);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.account_deletions')).rows[0].n,1);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM auth.users')).rows[0].n,0);
      receipt.notNullFailureReproduced = true;
    });

    await t.test('the exact DDL body can rehearse with ROLLBACK and preserves every original catalog object and row', async () => {
      assert.match(migration,/COMMIT;\s*$/);
      await db.query(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
      assert.equal(await isNotNull(),true);
      assert.deepEqual((await db.query(catalogSql)).rows[0].catalog,catalog);
      assert.deepEqual((await db.query('SELECT to_jsonb(a) AS row FROM public.account_deletions a WHERE id=$1',[B])).rows,legacy);
      assert.deepEqual((await db.query(functionSql)).rows,finalizer);
      receipt.rollbackRestored = true;
    });

    await t.test('generated runtime SQL rejects a different host, expired deadline and stale catalog or ledger before mutation', async () => {
      const unchanged = async () => {
        await db.query('ROLLBACK');
        const actual = await observe();
        for (const key of ['catalog','notNull','ledgerSha','ledgerWithoutTargetSha','ledgerCount','migration'])
          assert.deepEqual(actual[key],before[key]);
      };
      await assert.rejects(db.query(buildDeletionAuditMutationSql({sql:migration,version,before,
        deadline:new Date(Date.now()+120000).toISOString(),rehearsal:true})),/DELETION_AUDIT_TARGET_DRIFT/);
      await unchanged();
      await assert.rejects(db.query(bundle(true,{deadline:new Date(Date.now()-1000).toISOString()})),/DELETION_AUDIT_DEADLINE_EXPIRED/);
      await unchanged();
      await assert.rejects(db.query(bundle(true,{before:{...before,ledgerSha:'0'.repeat(32)}})),/DELETION_AUDIT_BASELINE_DRIFT/);
      await unchanged();
      await assert.rejects(db.query(bundle(true,{before:{...before,catalog:{...before.catalog,relation:{...before.catalog.relation,rls:false}}}})),/DELETION_AUDIT_BASELINE_DRIFT/);
      await unchanged();
      receipt.runtimeTargetAndDriftGuards = true;
    });

    await t.test('generated runtime rehearsal rolls back the catalog and migration ledger together', async () => {
      await db.query(bundle(true));
      const actual = await observe();
      for (const key of ['catalog','notNull','ledgerSha','ledgerWithoutTargetSha','ledgerCount','migration'])
        assert.deepEqual(actual[key],before[key]);
      receipt.runtimeRollback = true;
    });

    await t.test('commit changes only target nullability; wrong identity/claim and Auth-present calls remain inert', async () => {
      await db.query(bundle(false));
      assert.equal(await isNotNull(),false);
      assert.deepEqual((await db.query(catalogSql)).rows[0].catalog,catalog);
      assert.deepEqual((await db.query(functionSql)).rows,finalizer);
      receipt.unrelatedCatalogPreserved = true;
      const after = await observe();
      validateDeletionAuditObservation({...after,systemIdentifier:productionSystem},{sql:migration,version,now:new Date()});
      assert.equal(after.ledgerCount,before.ledgerCount+1);
      assert.equal(after.ledgerWithoutTargetSha,before.ledgerSha);
      assert.deepEqual((await db.query('SELECT name,statements FROM supabase_migrations.schema_migrations WHERE version=$1',[version])).rows,
        [{name:'account_deletion_anonymous_audit',statements:[migration]}]);
      receipt.runtimeLedgerAtomic = true;
      // 독립한 합성 guard 검증을 위해 같은 임시 cluster의 fixture Auth 행만 복원한다.
      await db.query('INSERT INTO auth.users VALUES($1)',[A]);
      await db.query('SET ROLE service_role');
      assert.equal(await finalize(),false);
      await db.query('RESET ROLE');
      await db.query('DELETE FROM auth.users WHERE id=$1',[A]);
      await db.query('SET ROLE service_role');
      assert.equal(await finalize(B,T),false);
      assert.equal(await finalize(J,W),false);
      await db.query('RESET ROLE');
      assert.deepEqual(await jobState(),originalJob);
      receipt.authAndClaimGuardsPreserved = true;
    });

    await t.test('the unchanged service-only finalizer completes once and leaves legacy identity rows intact', async () => {
      await db.query('SET ROLE authenticated');
      await assert.rejects(finalize(),error => error.code==='42501');
      await db.query('RESET ROLE; SET ROLE service_role');
      assert.equal(await finalize(),true);
      assert.equal(await finalize(),false);
      await db.query('RESET ROLE');
      assert.deepEqual((await db.query(`SELECT status,user_id,reason,claim_token,claimed_at,
        auth_deleted_at IS NOT NULL AS auth_deleted,completed_at IS NOT NULL AS completed
        FROM public.account_deletion_jobs WHERE id=$1`,[J])).rows,[{
        status:'completed',user_id:null,reason:null,claim_token:null,claimed_at:null,auth_deleted:true,completed:true,
      }]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.account_deletion_media_manifest WHERE job_id=$1',[J])).rows[0].n,0);
      assert.deepEqual((await db.query("SELECT user_id,email,reason FROM public.account_deletions WHERE reason='privacy'")).rows,
        [{user_id:null,email:null,reason:'privacy'}]);
      assert.deepEqual((await db.query('SELECT to_jsonb(a) AS row FROM public.account_deletions a WHERE id=$1',[B])).rows,legacy);
      await db.query(migration);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.account_deletions')).rows[0].n,2);
      assert.deepEqual((await db.query(catalogSql)).rows[0].catalog,catalog);
      receipt.legacyRowsPreserved = true;
      receipt.anonymousCompletion = true;
      receipt.idempotent = true;
    });
    assert.equal(digest(readFileSync(migrationPath)),receipt.sqlSha256);
    assert.equal(digest(readFileSync(sagaPath)),receipt.sagaSha256);
  } finally {
    await db.query('RESET ROLE; ROLLBACK').catch(()=>{});
    await owned.close();
    receipt.nativeClusterClosed = true;
  }
  t.diagnostic(JSON.stringify(receipt));
});
