import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createCoupleResetExpectedIdentityNativeDatabase, nativeCoupleResetAvailable,
  COUPLE_RESET_NATIVE_IDS as ids, seedCoupleResetNativeRows, setCoupleResetNativePersona,
  snapshotCoupleResetNativeRows } from './fixtures/couple-reset-expected-identity-native-database.mjs';
import { COUPLE_RESET_EXPECTED_IDENTITY_SYSTEM, buildCoupleResetExpectedIdentityObservationSql,
  buildCoupleResetExpectedIdentityMutationSql, validateCoupleResetExpectedIdentityObservation,
  expectedCoupleResetExpectedIdentityCatalog } from '../lib/couple-reset-expected-identity-catalog.mjs';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(import.meta.url)('pg');
const native = { skip: nativeCoupleResetAvailable ? false : 'installed PostgreSQL 17 unavailable; native reset NOT verified', timeout: 120_000 };
const callReset = async (client, user, couple) => (await client.query(
  'SELECT public.reset_expected_couple_membership($1::uuid,$2::uuid) AS value', [user, couple])).rows[0].value;
const legacyDefinition = async client => (await client.query(`SELECT pg_get_functiondef(p.oid) AS definition,
  pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl::text
  FROM pg_proc p WHERE p.oid='public.reset_current_couple_membership()'::regprocedure`)).rows[0];
const ledger = async client => (await client.query(`SELECT jsonb_agg(to_jsonb(m) ORDER BY version) AS value
  FROM supabase_migrations.schema_migrations m`)).rows[0].value;

async function waitForPeerLock(observer, pid, isSettled) {
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.equal(isSettled(), false, 'the second operation must remain blocked by the held transaction lock');
    const row = (await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
    if (row?.wait_event_type === 'Lock') return;
    await delay(25);
  }
  assert.fail('the second connection did not reach the expected database lock');
}

test('native PG17: the exact expected-identity wrapper preserves old functions/rows and serializes real membership races', native, async t => {
  const owned = await createCoupleResetExpectedIdentityNativeDatabase(root), db = owned.client;
  const peer = new Client({ ...owned.connection, query_timeout: 25_000 });
  const receipt = { remoteCalls: 0, customerData: false, nativePostgres17: false,
    ddlRollback: false, inheritedAclRejected: false, migrationRowChanges: null,
    identityMismatchWrites: null, legacyPreserved: false, nestedFailureAtomic: false,
    staleCoupleRaceBlocked: false, duplicateConfirmationSerialized: false,
    bothPartnersSerialize: false, nativeClusterClosed: false };
  try {
    const version = Number((await db.query("SELECT current_setting('server_version_num') AS value")).rows[0].value);
    assert.ok(version >= 170000 && version < 180000);
    receipt.nativePostgres17 = true;
    const originalRows = await snapshotCoupleResetNativeRows(db), originalLegacy = await legacyDefinition(db), originalLedger = await ledger(db);
    const wrapperAbsent = async () => assert.equal((await db.query(
      "SELECT to_regprocedure('public.reset_expected_couple_membership(uuid,uuid)') AS value")).rows[0].value, null);
    await wrapperAbsent();

    await t.test('the exact migration rehearses and rolls back without changing any row or legacy definition', async () => {
      await db.query(`BEGIN;\n${owned.sql}\nROLLBACK;`);
      await wrapperAbsent();
      assert.deepEqual(await snapshotCoupleResetNativeRows(db), originalRows);
      assert.deepEqual(await legacyDefinition(db), originalLegacy);
      assert.deepEqual(await ledger(db), originalLedger);
      receipt.ddlRollback = true;
    });
    await t.test('inherited anonymous EXECUTE fails the migration ACL postcondition and rolls the function back', async () => {
      await db.query('GRANT authenticated TO anon');
      try {
        await assert.rejects(db.query(`BEGIN;\n${owned.sql}\nCOMMIT;`), /EXPECTED_COUPLE_RESET_ACL_INVALID/);
        await db.query('ROLLBACK');
        await wrapperAbsent();
        assert.deepEqual(await snapshotCoupleResetNativeRows(db), originalRows);
        assert.deepEqual(await legacyDefinition(db), originalLegacy);
      } finally { await db.query('ROLLBACK; REVOKE authenticated FROM anon'); }
      receipt.inheritedAclRejected = true;
    });
    await t.test('committing the exact SQL adds only the wrapper and grants execution only to authenticated', async () => {
      await db.query(`BEGIN;\n${owned.sql}\nCOMMIT;`);
      assert.deepEqual(await snapshotCoupleResetNativeRows(db), originalRows);
      assert.deepEqual(await legacyDefinition(db), originalLegacy);
      assert.deepEqual(await ledger(db), originalLedger);
      const catalog = (await db.query(`SELECT pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
        has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role
        FROM pg_proc p WHERE p.oid='public.reset_expected_couple_membership(uuid,uuid)'::regprocedure`)).rows[0];
      assert.deepEqual(catalog, { owner: 'postgres', prosecdef: true,
        proconfig: ['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=15s'],
        anon: false, authenticated: true, service_role: false });
      receipt.migrationRowChanges = 0;
    });
    await t.test('wrong expected actor/couple, missing profile and wrong claims change no rows', async () => {
      for (const [actor, user, couple, expectedCode] of [
        [ids.user, ids.partner, ids.couple, 'P0001'], [ids.user, null, ids.couple, 'P0001'],
        [ids.user, ids.user, ids.otherCouple, 'P0001'], [ids.user, ids.user, null, 'P0001'],
        [ids.missing, ids.missing, null, 'P0002'], [null, ids.user, ids.couple, '42501'],
      ]) {
        await setCoupleResetNativePersona(db, actor);
        await assert.rejects(callReset(db, user, couple), { code: expectedCode });
        await db.query('RESET ROLE');
        assert.deepEqual(await snapshotCoupleResetNativeRows(db), originalRows);
      }
      for (const role of ['anon', 'service_role']) {
        await setCoupleResetNativePersona(db, ids.user, role);
        await assert.rejects(callReset(db, ids.user, ids.couple), { code: '42501' });
        await db.query('RESET ROLE');
      }
      await setCoupleResetNativePersona(db, ids.user);
      await db.query("SELECT set_config('request.jwt.claim.role','anon',false)");
      await assert.rejects(callReset(db, ids.user, ids.couple), { code: '42501' });
      await db.query('RESET ROLE');
      assert.deepEqual(await snapshotCoupleResetNativeRows(db), originalRows);
      receipt.identityMismatchWrites = 0;
    });
    await t.test('both member roles detach only themselves and explicit null retries stay idempotent', async () => {
      for (const actor of [ids.user, ids.partner]) {
        await db.query('BEGIN');
        try {
          await setCoupleResetNativePersona(db, actor);
          assert.deepEqual(await callReset(db, actor, ids.couple), { success: true, previous_couple_id: ids.couple });
          assert.deepEqual(await callReset(db, actor, null), { success: true, previous_couple_id: null });
          assert.deepEqual(await callReset(db, actor, null), { success: true, previous_couple_id: null });
          await db.query('RESET ROLE');
          const rows = await snapshotCoupleResetNativeRows(db), profile = rows.profiles.find(row => row.id === actor);
          assert.equal(profile.couple_id, null);
          assert.equal(profile.onboarding_completed, false);
          assert.equal(profile.onboarding_step, 1);
          assert.equal(profile.shared_chat_cleared_at, null);
          assert.equal(profile.private_chat_cleared_at, null);
          assert.deepEqual(rows.profiles.filter(row => row.id !== actor), originalRows.profiles.filter(row => row.id !== actor));
          assert.deepEqual(rows.budgets, originalRows.budgets);
          assert.deepEqual(rows.schedules, originalRows.schedules);
          const couple = rows.couples.find(row => row.id === ids.couple);
          assert.equal(couple.bride_id, actor === ids.user ? null : ids.user);
          assert.equal(couple.groom_id, actor === ids.partner ? null : ids.partner);
        } finally { await db.query('ROLLBACK; RESET ROLE'); }
      }
    });
    await t.test('the existing RPC remains unchanged and still works for its original caller', async () => {
      await db.query('BEGIN');
      try {
        await setCoupleResetNativePersona(db, ids.user);
        assert.deepEqual((await db.query('SELECT public.reset_current_couple_membership() AS value')).rows[0].value,
          { success: true, previous_couple_id: ids.couple });
      } finally { await db.query('ROLLBACK; RESET ROLE'); }
      assert.deepEqual(await legacyDefinition(db), originalLegacy);
      assert.deepEqual(await snapshotCoupleResetNativeRows(db), originalRows);
      receipt.legacyPreserved = true;
    });
    await t.test('a nested profile failure rolls the already-updated couple back without a caller transaction', async () => {
      await setCoupleResetNativePersona(db, ids.user);
      await db.query("SELECT set_config('test.fail_profile_reset','on',false)");
      try { await assert.rejects(callReset(db, ids.user, ids.couple), /forced_profile_reset_failure/); }
      finally { await db.query("RESET ROLE; RESET test.fail_profile_reset"); }
      assert.deepEqual(await snapshotCoupleResetNativeRows(db), originalRows);
      receipt.nestedFailureAtomic = true;
    });

    await peer.connect();
    const peerPid = (await peer.query('SELECT pg_backend_pid() AS value')).rows[0].value;
    await t.test('a changed couple committed while the reset waits is rechecked under the profile lock', async () => {
      await setCoupleResetNativePersona(peer, ids.user);
      await db.query(`BEGIN; SET LOCAL hanbang.allow_membership_write='on';
        UPDATE public.profiles SET couple_id='${ids.otherCouple}' WHERE id='${ids.user}';
        UPDATE public.couples SET bride_id=NULL WHERE id='${ids.couple}';
        UPDATE public.couples SET groom_id='${ids.user}' WHERE id='${ids.otherCouple}';`);
      const moved = await snapshotCoupleResetNativeRows(db);
      let settled = false;
      const pending = callReset(peer, ids.user, ids.couple).then(value => { settled = true; return { value }; },
        error => { settled = true; return { error }; });
      try {
        await waitForPeerLock(db, peerPid, () => settled);
        await db.query('COMMIT');
        const result = await pending;
        assert.equal(result.error?.code, 'P0001');
        assert.equal(result.error?.message, 'couple_reset_couple_changed');
        assert.deepEqual(await snapshotCoupleResetNativeRows(db), moved);
        receipt.staleCoupleRaceBlocked = true;
      } finally { await db.query('ROLLBACK'); await pending; }
    });
    await t.test('two simultaneous confirmations of one membership produce one success and one stale-confirmation rejection', async () => {
      await seedCoupleResetNativeRows(db);
      await setCoupleResetNativePersona(db, ids.user);
      await setCoupleResetNativePersona(peer, ids.user);
      await db.query('BEGIN');
      assert.deepEqual(await callReset(db, ids.user, ids.couple), { success: true, previous_couple_id: ids.couple });
      await db.query('RESET ROLE');
      const once = await snapshotCoupleResetNativeRows(db);
      let settled = false;
      const pending = callReset(peer, ids.user, ids.couple).then(value => { settled = true; return { value }; },
        error => { settled = true; return { error }; });
      try {
        await waitForPeerLock(db, peerPid, () => settled);
        await db.query('COMMIT');
        const result = await pending;
        assert.equal(result.error?.code, 'P0001');
        assert.deepEqual(await snapshotCoupleResetNativeRows(db), once);
        receipt.duplicateConfirmationSerialized = true;
      } finally { await db.query('ROLLBACK; RESET ROLE'); await pending; }
    });
    await t.test('concurrent resets by the two partners both finish without deadlock or lost member updates', async () => {
      await seedCoupleResetNativeRows(db);
      await setCoupleResetNativePersona(db, ids.user);
      await setCoupleResetNativePersona(peer, ids.partner);
      await db.query('BEGIN');
      assert.deepEqual(await callReset(db, ids.user, ids.couple), { success: true, previous_couple_id: ids.couple });
      await db.query('RESET ROLE');
      let settled = false;
      const pending = callReset(peer, ids.partner, ids.couple).then(value => { settled = true; return { value }; },
        error => { settled = true; return { error }; });
      try {
        await waitForPeerLock(db, peerPid, () => settled);
        await db.query('COMMIT');
        assert.deepEqual((await pending).value, { success: true, previous_couple_id: ids.couple });
        const rows = await snapshotCoupleResetNativeRows(db);
        const couple = rows.couples.find(row => row.id === ids.couple);
        assert.equal(couple.bride_id, null);
        assert.equal(couple.groom_id, null);
        assert.ok(rows.profiles.filter(row => [ids.user, ids.partner].includes(row.id)).every(row => row.couple_id === null));
        assert.deepEqual(rows.profiles.find(row => row.id === ids.other), originalRows.profiles.find(row => row.id === ids.other));
        assert.deepEqual(rows.budgets, originalRows.budgets);
        assert.deepEqual(rows.schedules, originalRows.schedules);
        receipt.bothPartnersSerialize = true;
      } finally { await db.query('ROLLBACK; RESET ROLE'); await pending; }
    });
  } finally {
    await peer.end().catch(() => {});
    await owned.close();
    receipt.nativeClusterClosed = true;
  }
  t.diagnostic(JSON.stringify(receipt));
});

test('native PG17: the production bundle preserves rows/catalog/ledger, rejects drift and follows the legacy lock order',
  { ...native, timeout: 180_000 }, async t => {
    const fixture = JSON.parse(readFileSync(join(root, 'supabase/release-contracts/couple-reset-expected-identity-pg17-catalog-v1.json'), 'utf8'));
    const owned = await createCoupleResetExpectedIdentityNativeDatabase(root), db = owned.client;
    const context = { sql: owned.sql, fixture, predecessorSql: owned.predecessorSql, expectedVersions: owned.expectedVersions };
    const peer = new Client({ ...owned.connection, query_timeout: 35_000 });
    const migrator = new Client({ ...owned.connection, query_timeout: 35_000 });
    const observe = async () => {
      const result = await db.query(buildCoupleResetExpectedIdentityObservationSql());
      const rows = (Array.isArray(result) ? result : [result]).flatMap(value => value.rows)
        .filter(row => Object.hasOwn(row, 'observation'));
      assert.equal(rows.length, 1);
      return rows[0].observation;
    };
    const validateLocal = observation => validateCoupleResetExpectedIdentityObservation(
      { ...observation, systemIdentifier: COUPLE_RESET_EXPECTED_IDENTITY_SYSTEM }, { ...context, now: new Date() });
    try {
      const before = await observe(), rows = await snapshotCoupleResetNativeRows(db), oldLedger = await ledger(db);
      assert.throws(() => validateCoupleResetExpectedIdentityObservation(before, { ...context, now: new Date() }),
        { code: 'COUPLE_RESET_OBSERVATION_INVALID' });
      validateLocal(before);
      const bundle = (rehearsal, overrides = {}) => {
        const text = buildCoupleResetExpectedIdentityMutationSql({ ...context, before, rehearsal,
          deadline: new Date(Date.now() + 120_000).toISOString(), ...overrides });
        const fixed = `'${COUPLE_RESET_EXPECTED_IDENTITY_SYSTEM}'`;
        assert.equal(text.split(fixed).length - 1, 1, 'substitute only the fixed production host literal in this synthetic test');
        return text.replace(fixed, `'${owned.system}'`);
      };
      const restored = async () => {
        const actual = await observe();
        for (const key of ['catalog', 'preservedCatalogSha', 'rowDigests', 'ledgerSha', 'ledgerVersions', 'ledgerCount'])
          assert.deepEqual(actual[key], before[key], key);
        assert.deepEqual(await snapshotCoupleResetNativeRows(db), rows);
        assert.deepEqual(await ledger(db), oldLedger);
      };
      await t.test('the production target is rejected locally and an expired deadline cannot install the wrapper', async () => {
        await assert.rejects(db.query(buildCoupleResetExpectedIdentityMutationSql({ ...context, before,
          rehearsal: false, deadline: new Date(Date.now() + 120_000).toISOString() })), /COUPLE_RESET_TARGET_DRIFT/);
        await db.query('ROLLBACK');
        await restored();
        await assert.rejects(db.query(bundle(false, { deadline: new Date(Date.now() - 1000).toISOString() })),
          /COUPLE_RESET_DEADLINE_EXPIRED/);
        await db.query('ROLLBACK');
        await restored();
      });
      await t.test('the exact full bundle rehearses and rolls back both function and migration ledger', async () => {
        await db.query(bundle(true));
        await restored();
      });
      await t.test('changed legacy ACL, unrelated catalog, ledger or membership rows fail before installation', async () => {
        const drifts = [
          ['GRANT EXECUTE ON FUNCTION public.reset_current_couple_membership() TO anon',
            'REVOKE EXECUTE ON FUNCTION public.reset_current_couple_membership() FROM anon'],
          ['CREATE TABLE public.synthetic_unreviewed_reset_table(id integer)', 'DROP TABLE public.synthetic_unreviewed_reset_table'],
          ["INSERT INTO supabase_migrations.schema_migrations VALUES('20260929000000','unexpected',ARRAY['synthetic'])",
            "DELETE FROM supabase_migrations.schema_migrations WHERE version='20260929000000'"],
          [`UPDATE public.profiles SET onboarding_step=4 WHERE id='${ids.user}'`,
            `UPDATE public.profiles SET onboarding_step=5 WHERE id='${ids.user}'`],
          [`UPDATE public.couples SET updated_at='2001-01-01Z' WHERE id='${ids.couple}'`,
            `UPDATE public.couples SET updated_at='2000-01-01Z' WHERE id='${ids.couple}'`],
        ];
        for (const [setup, restore] of drifts) {
          await db.query(setup);
          const changed = await observe(), changedRows = await snapshotCoupleResetNativeRows(db);
          try {
            await assert.rejects(db.query(bundle(false)), /COUPLE_RESET_BASELINE_DRIFT/);
            await db.query('ROLLBACK');
            const actual = await observe();
            for (const key of ['catalog', 'preservedCatalogSha', 'rowDigests', 'ledgerSha']) assert.deepEqual(actual[key], changed[key]);
            assert.deepEqual(await snapshotCoupleResetNativeRows(db), changedRows);
          } finally { await db.query('ROLLBACK'); await db.query(restore); }
        }
        await restored();
      });
      await t.test('an unrelated definer owner, view body and view security option drift is rejected before installation', async () => {
        assert.equal((await db.query("SELECT proacl FROM pg_proc WHERE oid='auth.synthetic_preserved_owner()'::regprocedure")).rows[0].proacl, null);
        for (const [change, restore] of [
          ['ALTER FUNCTION auth.synthetic_preserved_owner() OWNER TO synthetic_reset_owner',
            'ALTER FUNCTION auth.synthetic_preserved_owner() OWNER TO postgres'],
          ['CREATE OR REPLACE VIEW public.synthetic_preserved_view AS SELECT 2 AS value',
            'CREATE OR REPLACE VIEW public.synthetic_preserved_view AS SELECT 1 AS value'],
          ['ALTER VIEW public.synthetic_preserved_view SET (security_invoker=true)',
            'ALTER VIEW public.synthetic_preserved_view RESET (security_invoker)'],
        ]) {
          await db.query(change);
          try {
            const changed = await observe();
            assert.notEqual(changed.preservedCatalogSha, before.preservedCatalogSha, change);
            await assert.rejects(db.query(bundle(false)), /COUPLE_RESET_BASELINE_DRIFT/);
            await db.query('ROLLBACK');
            assert.equal((await observe()).preservedCatalogSha, changed.preservedCatalogSha);
          } finally { await db.query('ROLLBACK'); await db.query(restore); }
          await restored();
        }
      });
      await t.test('postcondition failures roll back a changed row, privilege, unrelated object and ledger atomically', async () => {
        for (const damage of [
          `UPDATE public.profiles SET onboarding_step=9 WHERE id='${ids.user}';`,
          'GRANT EXECUTE ON FUNCTION public.reset_expected_couple_membership(uuid,uuid) TO anon;',
          'CREATE TABLE public.synthetic_unexpected_after_reset(id integer);',
          `UPDATE supabase_migrations.schema_migrations SET name='damaged' WHERE version='${owned.expectedVersions[0]}';`,
        ]) {
          const text = bundle(false), marker = '\n INSERT INTO supabase_migrations.schema_migrations';
          assert.equal(text.split(marker).length - 1, 1);
          await assert.rejects(db.query(text.replace(marker, `\n ${damage}${marker}`)), /COUPLE_RESET_AFTER_DRIFT/);
          await db.query('ROLLBACK');
          await restored();
        }
      });
      await t.test('unrelated definer owner and view changes after DDL roll back with the function and ledger', async () => {
        for (const damage of [
          'ALTER FUNCTION auth.synthetic_preserved_owner() OWNER TO synthetic_reset_owner;',
          'CREATE OR REPLACE VIEW public.synthetic_preserved_view AS SELECT 2 AS value;',
          'ALTER VIEW public.synthetic_preserved_view SET (security_invoker=true);',
        ]) {
          const text = bundle(false), marker = '\n INSERT INTO supabase_migrations.schema_migrations';
          assert.equal(text.split(marker).length - 1, 1);
          await assert.rejects(db.query(text.replace(marker, `\n ${damage}${marker}`)), /COUPLE_RESET_AFTER_DRIFT/);
          await db.query('ROLLBACK');
          await restored();
        }
      });
      await peer.connect();
      await migrator.connect();
      await t.test('a concurrent table writer causes a bounded lock timeout with no installed function or ledger change', async () => {
        await peer.query('BEGIN; LOCK TABLE public.profiles IN ROW EXCLUSIVE MODE');
        try {
          await assert.rejects(db.query(bundle(false)), { code: '55P03' });
          await db.query('ROLLBACK');
        } finally { await peer.query('ROLLBACK'); }
        await restored();
      });
      await t.test('an in-flight legacy reset completes while the release waits, then the stale release baseline is rejected', async () => {
        await db.query('SELECT pg_advisory_lock(60929,987)');
        await setCoupleResetNativePersona(peer, ids.user);
        await peer.query("SELECT set_config('test.pause_couple_reset','on',false)");
        const peerPid = (await peer.query('SELECT pg_backend_pid() AS value')).rows[0].value;
        const migrationPid = (await migrator.query('SELECT pg_backend_pid() AS value')).rows[0].value;
        let resetSettled = false, migrationSettled = false;
        const resetPending = peer.query('SELECT public.reset_current_couple_membership() AS value')
          .then(value => { resetSettled = true; return { value }; }, error => { resetSettled = true; return { error }; });
        let migrationPending;
        try {
          await waitForPeerLock(db, peerPid, () => resetSettled);
          migrationPending = migrator.query(bundle(false))
            .then(value => { migrationSettled = true; return { value }; }, error => { migrationSettled = true; return { error }; });
          await waitForPeerLock(db, migrationPid, () => migrationSettled);
          await db.query('SELECT pg_advisory_unlock(60929,987)');
          const [resetResult, migrationResult] = await Promise.all([resetPending, migrationPending]);
          assert.equal(resetResult.error, undefined);
          assert.deepEqual(resetResult.value.rows[0].value, { success: true, previous_couple_id: ids.couple });
          assert.equal(migrationResult.error?.message, 'COUPLE_RESET_BASELINE_DRIFT');
          await migrator.query('ROLLBACK');
          const actual = await observe();
          assert.equal(actual.migration, null);
          assert.deepEqual(actual.catalog, before.catalog);
          assert.deepEqual(await ledger(db), oldLedger);
        } finally {
          await db.query('SELECT pg_advisory_unlock(60929,987)');
          await resetPending;
          await migrationPending;
          await migrator.query('ROLLBACK');
          await peer.query('RESET ROLE; RESET test.pause_couple_reset');
          await seedCoupleResetNativeRows(db);
        }
        await restored();
      });
      await t.test('commit installs exactly the expected function and exact raw ledger SQL while preserving all prior state', async () => {
        await db.query(bundle(false));
        const after = await observe();
        validateLocal(after);
        assert.deepEqual(after.catalog, expectedCoupleResetExpectedIdentityCatalog(fixture, true));
        assert.equal(after.preservedCatalogSha, before.preservedCatalogSha);
        assert.deepEqual(after.rowDigests, before.rowDigests);
        assert.equal(after.ledgerWithoutTargetSha, before.ledgerSha);
        assert.equal(after.ledgerCount, 230);
        assert.deepEqual(await snapshotCoupleResetNativeRows(db), rows);
        assert.equal((await db.query("SELECT statements[1] AS value FROM supabase_migrations.schema_migrations WHERE version='20260928144843'"))
          .rows[0].value, owned.sql);
      });
    } finally {
      await peer.end().catch(() => {});
      await migrator.end().catch(() => {});
      await owned.close();
    }
  });
