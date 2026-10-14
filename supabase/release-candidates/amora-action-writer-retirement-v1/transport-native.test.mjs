import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createDraftDatabase, nativeProfileRoleAvailable, OUTSIDER, GROOM, OTHER_COUPLE, TOKEN, legacy } from '../amora-action-view-v2/draft-fixture.mjs';
import { createPrivilegeDatabase } from './privileges-fixture.mjs';
import { installTransportCompanion } from './transport-fixture.mjs';

const transportPath = new URL('./transport_conflict_response_v1.sql', import.meta.url);
// Source-only CI may lack native PG on non-Windows. Windows missing its owned PG must fail, never skip.
const nativeOptions = Object.freeze({ timeout: 60_000, skip: process.platform !== 'win32' && !nativeProfileRoleAvailable });
const install = installTransportCompanion;
const catalog = async f => (await f.db.query(`SELECT oid::text,proowner::regrole::text AS owner,proacl::text,
  proconfig,prorettype::regtype::text AS result,proargtypes::text,proargnames,proargmodes,
  pronargdefaults,prosecdef,proisstrict,provolatile,proparallel,procost,prorows,proleakproof,
  prokind,proretset,prolang::regproc::text AS language_oid,prosrc
  FROM pg_proc WHERE oid='public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)'::regprocedure`)).rows[0];

test('native PG17: transport replaces exactly two logical errors while preserving the function identity, attributes and ACL', nativeOptions, async () => {
  const f = await createDraftDatabase({ native: true });
  try {
    const before = await catalog(f);
    await install(f);
    const after = await catalog(f);
    assert.equal((before.prosrc.match(/ERRCODE = '40001'/g) || []).length, 2);
    assert.equal(after.prosrc, before.prosrc.replaceAll("ERRCODE = '40001'", "ERRCODE = 'PT409'"));
    assert.deepEqual({ ...after, prosrc: null }, { ...before, prosrc: null });
  } finally { await f.close(); }
});

test('native PG17: logical canonical and legacy stale versions are PT409, not a serialization retry', nativeOptions, async () => {
  assert.equal(Boolean(nativeProfileRoleAvailable), true, 'owned PG17 is mandatory; no skipped native evidence');
  const f = await createDraftDatabase({ native: true });
  try {
    if (existsSync(transportPath)) await install(f);
    await f.seedCanonical('transport_canonical');
    await f.seedLegacy([legacy('transport_legacy'), legacy('transport_preserved')]);
    for (const id of ['transport_canonical', 'transport_legacy']) {
      const before = id === 'transport_canonical' ? await f.read(id) : await f.journey();
      await assert.rejects(f.patch(id, { description: 'SYNTHETIC-STALE-NEVER-WRITTEN' }, '2026-01-01T00:00:00.123455Z'),
        error => error.code === 'PT409' && error.message === 'AMORA_ACTION_CONFLICT');
      assert.deepEqual(id === 'transport_canonical' ? await f.read(id) : await f.journey(), before);
    }
    assert.equal((await f.patch('transport_canonical', { description: 'SYNTHETIC-APPROVED' }, TOKEN)).description, 'SYNTHETIC-APPROVED');
  } finally { await f.close(); }
});

test('native PG17: transport preserves denied, invalid, absent and approved microsecond canonical/legacy outcomes', nativeOptions, async () => {
  const f = await createDraftDatabase({ native: true });
  try {
    await install(f);
    const future = '2050-01-01T00:00:00.123456Z';
    await f.seedCanonical('transport_canonical', future);
    await f.seedLegacy([legacy('transport_legacy', { updatedAt: future }), legacy('transport_preserved')]);
    const canonicalBefore = await f.read('transport_canonical'), journeyBefore = await f.journey();
    for (const [options, code] of [[{ actor: OUTSIDER }, '42501'], [{ couple: OTHER_COUPLE }, '42501'], [{ role: 'anon' }, '42501'], [{ role: 'service_role' }, '42501']]) {
      await assert.rejects(f.patch('transport_canonical', { description: 'SYNTHETIC-DENIED' }, future, options), error => error.code === code);
    }
    await assert.rejects(f.patch('transport_canonical', { source: 'ai' }, future), error => error.code === '22023');
    await assert.rejects(f.patch('transport_canonical', { description: 'SYNTHETIC-INVALID' }, 'not-a-version'), error => error.code === '22023');
    assert.equal(await f.patch('transport_missing', { description: 'SYNTHETIC-MISSING' }, future), null);
    assert.deepEqual(await f.read('transport_canonical'), canonicalBefore);
    assert.deepEqual(await f.journey(), journeyBefore);
    for (const id of ['transport_canonical', 'transport_legacy']) {
      const saved = await f.patch(id, { description: 'SYNTHETIC-APPROVED', status: 'done' }, future, { actor: GROOM });
      assert.equal(saved.description, 'SYNTHETIC-APPROVED');
      assert.equal(saved.status, 'done');
      assert.equal(saved.source, id === 'transport_canonical' ? canonicalBefore.source : journeyBefore.progress.__amora_actions[0].source);
      assert.equal(typeof saved.completed_at, 'string');
      assert.equal(saved.dismissed_at, null);
      assert.match(saved.updated_at, /\.123457(?:Z|[+-]\d{2}:\d{2})$/);
      assert.equal((await f.db.query("SELECT $1::timestamptz=$2::timestamptz+interval '1 microsecond' AS exact", [saved.updated_at, future])).rows[0].exact, true);
      await assert.rejects(f.patch(id, { status: 'dismissed' }, future), error => error.code === 'PT409');
    }
    const journeyAfter = await f.journey();
    assert.deepEqual(journeyAfter.progress.budget, journeyBefore.progress.budget);
    assert.deepEqual(journeyAfter.progress.schedule, journeyBefore.progress.schedule);
    assert.deepEqual(journeyAfter.progress.__amora_actions[1], journeyBefore.progress.__amora_actions[1]);
    assert.deepEqual(journeyAfter.progress.__amora_actions[0].unknown, { preserved: true });
  } finally { await f.close(); }
});

test('native PG17: nested unavailable and genuine serialization errors retain their own codes and roll back approved field drift', nativeOptions, async () => {
  const f = await createDraftDatabase({ native: true });
  try {
    await install(f);
    await f.seedCanonical('transport_canonical');
    const before = await f.read('transport_canonical');
    await f.exec(`CREATE FUNCTION public.transport_drift() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.description := 'SYNTHETIC-UNAPPROVED'; RETURN NEW; END $$;
      CREATE TRIGGER zz_transport_drift BEFORE UPDATE ON public.amora_actions FOR EACH ROW EXECUTE FUNCTION public.transport_drift();`);
    await assert.rejects(f.patch('transport_canonical', { description: 'SYNTHETIC-APPROVED' }, TOKEN), error => error.code === '55000' && error.message === 'AMORA_ACTION_UNAVAILABLE');
    assert.deepEqual(await f.read('transport_canonical'), before);
    await f.exec(`CREATE OR REPLACE FUNCTION public.transport_drift() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'SYNTHETIC-ENGINE-SERIALIZATION' USING ERRCODE='40001'; END $$;`);
    await assert.rejects(f.patch('transport_canonical', { description: 'SYNTHETIC-APPROVED' }, TOKEN), error => error.code === '40001' && error.message === 'SYNTHETIC-ENGINE-SERIALIZATION');
    assert.deepEqual(await f.read('transport_canonical'), before);
    await f.exec('DROP TRIGGER zz_transport_drift ON public.amora_actions');
    await f.seedLegacy([legacy('transport_legacy')]);
    const journeyBefore = await f.journey();
    await f.exec(`CREATE FUNCTION public.transport_legacy_drift() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.progress := jsonb_set(NEW.progress,'{__amora_actions,0,description}','"SYNTHETIC-UNAPPROVED"'); RETURN NEW; END $$;
      CREATE TRIGGER zz_transport_legacy_drift BEFORE UPDATE ON public.wedding_journeys FOR EACH ROW EXECUTE FUNCTION public.transport_legacy_drift();`);
    await assert.rejects(f.patch('transport_legacy', { description: 'SYNTHETIC-APPROVED' }, TOKEN), error => error.code === '55000');
    assert.deepEqual(await f.journey(), journeyBefore);
  } finally { await f.close(); }
});

test('native PG17: all five companions preserve current journey triggers and canonical/legacy checked edits', nativeOptions, async () => {
  const f = await createPrivilegeDatabase({ phase: 'after' });
  try {
    // 기존 metadata fixture는 이 실제 pure dependency의 실행까지 설치하지 않는다.
    // 한 함수 원문을 추가할 뿐 승인 ledger/전체 schema를 검증했다고 주장하지 않는다.
    const source = readFileSync(new URL('../../migrations/20260731123000_couple_plan_change_write_boundary.sql', import.meta.url), 'utf8');
    const highImpact = source.match(/CREATE OR REPLACE FUNCTION public\.couple_plan_change_is_high_impact\([\s\S]*?\$function\$;/)?.[0];
    assert.ok(highImpact, 'real journey boundary dependency is mandatory');
    await f.exec(highImpact);
    await install(f);
    await f.seedCanonical('transport_combined_canonical');
    await f.seedLegacy([legacy('transport_combined_legacy')]);
    const before = await f.journey();
    for (const id of ['transport_combined_canonical', 'transport_combined_legacy']) {
      assert.equal((await f.patch(id, { description: 'SYNTHETIC-COMBINED' }, TOKEN)).description, 'SYNTHETIC-COMBINED');
      await assert.rejects(f.patch(id, { description: 'SYNTHETIC-STALE' }, TOKEN), error => error.code === 'PT409');
    }
    const after = await f.journey();
    assert.deepEqual(after.progress.budget, before.progress.budget);
    assert.deepEqual(after.progress.schedule, before.progress.schedule);
    await assert.rejects(f.oldPatch('transport_combined_canonical', { description: 'SYNTHETIC-OLD-WRITER' }), error => error.code === '55000');
    assert.equal((await f.create('transport_new_card')).title, 'SYNTHETIC-CANONICAL');
    assert.equal(f.fullSchemaVerified, false);
  } finally { await f.close(); }
});
