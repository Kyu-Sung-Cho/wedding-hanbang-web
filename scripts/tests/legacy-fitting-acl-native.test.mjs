import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createLegacyFittingAclNativeDatabase, nativeLegacyFittingAvailable, LEGACY_FITTING_NATIVE_DEFINITIONS,
} from './fixtures/legacy-fitting-acl-native-database.mjs';
import {
  LEGACY_FITTING_ACL_PINS, LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER,
  buildLegacyFittingAclObservationSql, validateLegacyFittingAclObservation, buildLegacyFittingAclMutationSql,
} from '../lib/legacy-fitting-acl-release.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const REQUEST = [
  '44444444-4444-4444-8444-444444444441',
  '44444444-4444-4444-8444-444444444442',
  '44444444-4444-4444-8444-444444444443',
  '44444444-4444-4444-8444-444444444444',
];
const USAGE = [
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555552',
  '55555555-5555-4555-8555-555555555553',
];

// 실제 함수 원문을 새 loopback PG17에 재현한다. 운영 DB 연결/함수 호출 증거가 아니다.
test('native PG17: fitting ACL-only release preserves rows and service behavior while blocking untrusted roles', {
  skip: nativeLegacyFittingAvailable ? false : 'installed PG17 unavailable; native fitting ACL NOT verified',
  timeout: 90000,
}, async t => {
  assert.deepEqual(LEGACY_FITTING_NATIVE_DEFINITIONS.map(({ identity, definitionSha256 }) => ({ identity, definitionSha256 })),
    LEGACY_FITTING_ACL_PINS);
  const receipt = { remoteCalls: 0, customerData: false, nativePostgres17: false,
    exactFunctionDefinitions: false, rehearsalRolledBack: false, aclApplyRowChanges: null,
    untrustedCallsDenied: 0, serviceBehaviorPreserved: false, driftBlocked: 0,
    inheritedExecuteRolledBack: false, nativeClusterClosed: false };
  const owned = await createLegacyFittingAclNativeDatabase(), db = owned.client;
  try {
    const version = Number((await db.query("SELECT current_setting('server_version_num') AS version")).rows[0].version);
    assert.ok(version >= 170000 && version < 180000);
    receipt.nativePostgres17 = true;
    await db.query(`
      INSERT INTO public.fitting_requests(id,user_id,couple_id,expires_at,is_saved) VALUES
        ('${REQUEST[0]}','${A}','${B}',now()-interval '1 day',false),
        ('${REQUEST[1]}','${A}','${B}',now()-interval '1 day',true),
        ('${REQUEST[2]}','${OTHER}','${OTHER}',now()+interval '1 day',false),
        ('${REQUEST[3]}','${OTHER}','${OTHER}',now()-interval '1 day',NULL);
      INSERT INTO public.fitting_usage(id,user_id,couple_id,period_start,free_used) VALUES
        ('${USAGE[0]}','${A}','${B}','2026-09-01',2),
        ('${USAGE[1]}','${A}','${B}','2026-10-01',3),
        ('${USAGE[2]}','${OTHER}','${OTHER}','2026-09-01',4);
    `);
    const snapshotRows = async () => (await db.query(`SELECT jsonb_build_object(
      'requests',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.fitting_requests f),
      'usage',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.fitting_usage f),
      'unrelated',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.synthetic_fitting_unrelated f)) AS snapshot`)).rows[0].snapshot;
    const beforeRows = await snapshotRows();
    const observe = async () => {
      const result = await db.query(buildLegacyFittingAclObservationSql());
      const matches = (Array.isArray(result) ? result : [result]).flatMap(value => value.rows)
        .filter(value => Object.hasOwn(value, 'observation'));
      assert.equal(matches.length, 1);
      return matches[0].observation;
    };
    const before = await observe();
    assert.equal(before.systemIdentifier, owned.system);
    assert.equal(before.readOnly, true);
    assert.throws(() => validateLegacyFittingAclObservation(before, { now: new Date() }),
      { code: 'FITTING_ACL_OBSERVATION_INVALID' });
    // 관측 shape 검증만 합성 host로 수행한다. 운영 controller의 고정 대상 검사는 그대로 둔다.
    const validateSynthetic = (value, phase) => validateLegacyFittingAclObservation(
      { ...value, systemIdentifier: LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER }, { now: new Date(), phase });
    assert.equal(validateSynthetic(before, 'before'), 'before');
    const localBundle = (rehearsal, override = {}) => {
      const sql = buildLegacyFittingAclMutationSql({
        before, deadline: new Date(Date.now() + 120000).toISOString(), rehearsal, ...override,
      });
      const fixed = "'" + LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER + "'";
      assert.equal(sql.split(fixed).length - 1, 1, 'only the exact fixed host literal is substituted');
      return sql.replace(fixed, "'" + owned.system + "'");
    };
    const assertBeforeRestored = async () => {
      const actual = await observe();
      assert.deepEqual(actual.inventory, before.inventory);
      assert.deepEqual(actual.preservation, before.preservation);
      assert.deepEqual(await snapshotRows(), beforeRows);
    };
    const definitions = async () => (await db.query(`SELECT p.oid, p.proowner, p.prosecdef, p.proconfig,
      pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('cleanup_expired_fittings','increment_fitting_usage')
      ORDER BY p.proname`)).rows;
    const beforeDefinitions = await definitions();
    assert.deepEqual(beforeDefinitions.map(value => hash(value.definition)),
      LEGACY_FITTING_ACL_PINS.map(value => value.definitionSha256));
    receipt.exactFunctionDefinitions = true;

    const checkServiceBehavior = async () => {
      await db.query('BEGIN; SET LOCAL ROLE service_role');
      try {
        await db.query('SELECT public.cleanup_expired_fittings()');
        await db.query("SELECT public.increment_fitting_usage($1::uuid, $2::date)", [B, '2026-09-01']);
        await db.query('RESET ROLE');
        const after = await snapshotRows();
        assert.deepEqual(after.requests, beforeRows.requests.filter(row => row.id !== REQUEST[0]));
        assert.deepEqual(after.usage, beforeRows.usage.map(row => row.id === USAGE[0]
          ? { ...row, free_used: row.free_used + 1 } : row));
        assert.deepEqual(after.unrelated, beforeRows.unrelated);
      } finally { await db.query('ROLLBACK; RESET ROLE'); }
      assert.deepEqual(await snapshotRows(), beforeRows);
    };

    await t.test('exact legacy definitions execute as service_role before the ACL change', async () => {
      await checkServiceBehavior();
    });
    await t.test('rehearsal rolls both ACLs back and preserves definitions, rows, default ACL and ledger', async () => {
      await db.query(localBundle(true));
      await assertBeforeRestored();
      assert.deepEqual(await definitions(), beforeDefinitions);
      receipt.rehearsalRolledBack = true;
    });
    await t.test('a different native host and expired deadline are rejected before ACL changes', async () => {
      await assert.rejects(db.query(buildLegacyFittingAclMutationSql({
        before, deadline: new Date(Date.now() + 120000).toISOString(), rehearsal: false,
      })), /FITTING_ACL_TARGET_DRIFT/);
      await db.query('ROLLBACK');
      await assertBeforeRestored();
      await assert.rejects(db.query(localBundle(false, { deadline: new Date(Date.now() - 1000).toISOString() })),
        /FITTING_ACL_DEADLINE_EXPIRED/);
      await db.query('ROLLBACK');
      await assertBeforeRestored();
      receipt.driftBlocked += 2;
    });
    await t.test('stale function, overload, ACL, default ACL and ledger fail before either revoke commits', async () => {
      const cleanup = LEGACY_FITTING_NATIVE_DEFINITIONS[0].definition;
      const drifts = [
        { setup: cleanup.replace('is_saved = false', 'is_saved IS FALSE'), restore: cleanup },
        { setup: 'ALTER FUNCTION public.cleanup_expired_fittings() SET search_path=public',
          restore: 'ALTER FUNCTION public.cleanup_expired_fittings() RESET search_path' },
        { setup: `CREATE FUNCTION public.cleanup_expired_fittings(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$`,
          restore: 'DROP FUNCTION public.cleanup_expired_fittings(uuid)' },
        { setup: 'GRANT EXECUTE ON FUNCTION public.cleanup_expired_fittings() TO authenticated WITH GRANT OPTION',
          restore: 'REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.cleanup_expired_fittings() FROM authenticated' },
        { setup: 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon',
          restore: 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon' },
        { setup: "INSERT INTO supabase_migrations.schema_migrations VALUES('20260927000001','synthetic_drift',ARRAY['synthetic'])",
          restore: "DELETE FROM supabase_migrations.schema_migrations WHERE version='20260927000001'" },
      ];
      for (const drift of drifts) {
        await db.query(drift.setup);
        const changed = await observe();
        try {
          await assert.rejects(db.query(localBundle(false)), /FITTING_ACL_BASELINE_DRIFT/);
          await db.query('ROLLBACK');
          const actual = await observe();
          assert.deepEqual(actual.inventory, changed.inventory);
          assert.deepEqual(actual.preservation, changed.preservation);
          assert.deepEqual(await snapshotRows(), beforeRows);
          receipt.driftBlocked++;
        } finally {
          await db.query('ROLLBACK');
          await db.query(drift.restore);
        }
        await assertBeforeRestored();
      }
    });
    await t.test('inherited service execute is detected after revoke and atomically restores both ACLs', async () => {
      await db.query('GRANT service_role TO anon');
      try {
        const inheritedBefore = await observe();
        assert.deepEqual(inheritedBefore.inventory, before.inventory);
        await assert.rejects(db.query(localBundle(false)), /FITTING_ACL_AFTER_DRIFT/);
        await db.query('ROLLBACK');
        await assertBeforeRestored();
        receipt.inheritedExecuteRolledBack = true;
      } finally {
        await db.query('ROLLBACK');
        await db.query('REVOKE service_role FROM anon');
      }
    });
    await t.test('apply changes only EXECUTE and preserves both function definitions and all rows', async () => {
      await db.query(localBundle(false));
      const after = await observe();
      assert.equal(validateSynthetic(after, 'after'), 'after');
      assert.deepEqual(after.preservation, before.preservation);
      assert.deepEqual(await definitions(), beforeDefinitions);
      assert.deepEqual(await snapshotRows(), beforeRows);
      receipt.aclApplyRowChanges = 0;
    });
    await t.test('anon and authenticated get SQLSTATE 42501 for each actual function after apply', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.query('SET ROLE ' + role);
        try {
          for (const sql of ['SELECT public.cleanup_expired_fittings()',
            "SELECT public.increment_fitting_usage('" + B + "'::uuid,'2026-09-01'::date)"]) {
            await assert.rejects(db.query(sql), error => error.code === '42501' && /permission denied for function/.test(error.message));
            receipt.untrustedCallsDenied++;
          }
        } finally { await db.query('RESET ROLE'); }
      }
      assert.equal(receipt.untrustedCallsDenied, 4);
      assert.deepEqual(await snapshotRows(), beforeRows);
    });
    await t.test('service_role retains exact cleanup and usage increment behavior after apply', async () => {
      await checkServiceBehavior();
      receipt.serviceBehaviorPreserved = true;
    });
  } finally {
    await db.query('RESET ROLE; ROLLBACK').catch(() => {});
    await owned.close();
    receipt.nativeClusterClosed = true;
    t.diagnostic(JSON.stringify(receipt));
  }
});
