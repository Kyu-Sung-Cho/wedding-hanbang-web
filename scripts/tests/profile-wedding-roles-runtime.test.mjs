import test, {after as afterTests} from 'node:test';
import {createProfileRoleHistoricalRepository} from './fixtures/profile-role-historical-repository.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { appendProfileWeddingRolesReceipt, parseProfileWeddingRolesReleaseArgs, runProfileWeddingRolesRelease } from '../lib/profile-wedding-roles-release.mjs';
import { buildProfileRoleMutationSql, buildProfileRoleObservationSql, expectedProfileRoleCatalog,
  validateProfileRoleObservation, PROFILE_ROLE_REQUIRED_COLUMNS } from '../lib/profile-wedding-roles-catalog.mjs';
const sourceRoot=resolve(import.meta.dirname,'../..');
const historical=createProfileRoleHistoricalRepository(sourceRoot);
const root=historical.root;afterTests(historical.cleanup);
const version = '20260913075045';
const sql = readFileSync(join(root, `supabase/migrations/${version}_profile_wedding_roles.sql`), 'utf8');
const predecessorSql = readFileSync(join(root, 'supabase/migrations/20260913043211_chat_feedback_automatic_signal_nullable.sql'),'utf8');
const instant = new Date('2026-09-13T05:00:00Z');
const commit = 'a'.repeat(40), project = 'slrtobkksjmxgzatjyqb';
const args = (mode = 'apply') => ['--profile-wedding-roles', `--${mode}`, `--expected-commit=${commit}`,
  `--project-ref=${project}`, `--receipt-out=${join(tmpdir(), 'unused-roles-synthetic-receipt.jsonl')}`,
  `--confirm-production=profile-wedding-roles-20260913:${project}:${mode}:${commit}`];
const code = value => error => error?.code === value;
const before = () => ({ format: 'profile-wedding-roles-catalog-v1', systemIdentifier: '7581440907192989109', serverVersion: '17.6',
  database: 'postgres', readOnly: true, observedAt: instant.toISOString(), catalog: { relations: [], functions: [] },
  dependencies: PROFILE_ROLE_REQUIRED_COLUMNS, preservedCatalogSha: 'e'.repeat(32), ledgerSha: 'b'.repeat(32), ledgerWithoutTargetSha: 'b'.repeat(32), ledgerCount: 218, migration: null,
  predecessor: { version: '20260913043211', name: 'chat_feedback_automatic_signal_nullable', statementCount: 1,
    sqlMd5: createHash('md5').update(predecessorSql).digest('hex') } });
const after = () => ({ ...before(), catalog: expectedProfileRoleCatalog(sql), ledgerSha: 'c'.repeat(32), ledgerCount: 219,
  migration: { version, name: 'profile_wedding_roles', statementCount: 1,
    sqlMd5: createHash('md5').update(sql).digest('hex') } });

function fixture({ mode = 'apply', observations = [before(), before(), after()], onQuery, onRecord, now } = {}) {
  const calls = [], events = [];
  let reads = 0, closed = false, sourceChecks = 0;
  return { calls, events, get closed() { return closed; }, get sourceChecks() { return sourceChecks; },
    run: () => runProfileWeddingRolesRelease({ repoRoot: root, argv: args(mode), now: now ?? (() => instant),
      assertSource: () => { sourceChecks += 1; },
      receiptFactory: () => ({ append: event => { onRecord?.(event); events.push(event); }, close: () => { closed = true; } }),
      query: async query => {
        calls.push(query); await onQuery?.(query, calls.length);
        if (query === buildProfileRoleObservationSql()) return [{ observation: structuredClone(observations[reads++]) }];
        return [];
      } }),
  };
}

test('apply observes, rolls the same exact migration back, rechecks, applies once and separately postverifies', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 'applied-and-postverified');
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls[1].replace(/ROLLBACK;$/, 'COMMIT;'), f.calls[3]);
  assert.match(f.calls[1], /CREATE TABLE public\.profile_wedding_roles/);
  assert.match(f.calls[1], /INSERT INTO supabase_migrations.schema_migrations/);
  assert.equal(f.events.at(-1).status, result.status);
  assert.equal(f.sourceChecks, 2);
  assert.equal(f.closed, true);
});

test('inspect, rehearsal and already-applied states never issue a committed mutation', async () => {
  for (const options of [{ mode: 'inspect' }, { mode: 'rehearse' }, { observations: [after()] }]) {
    const f = fixture(options);
    const result = await f.run();
    assert.equal(result.remoteWritesPerformed, false);
    assert.equal(f.calls.filter(query => !query.startsWith('BEGIN READ ONLY') && query.endsWith('COMMIT;')).length, 0);
    assert.equal(f.closed, true);
  }
});

test('malformed, mixed, wrong destination, missing or mismatched explicit confirmation is rejected', () => {
  for (const argv of [[], args().slice(0, -1), [...args(), '--rehearse'], [...args(), '--apply'], [...args(), '--unknown'],
    args().map(arg => arg.startsWith('--project-ref=') ? '--project-ref=abcdefghijklmnopqrst' : arg),
    args().map(arg => arg.startsWith('--expected-commit=') ? '--expected-commit=bad' : arg),
    args().map(arg => arg.startsWith('--confirm-production=') ? `${arg}x` : arg)])
    assert.throws(() => parseProfileWeddingRolesReleaseArgs(argv));
});

test('wrong identity, catalog, old/future evidence and conflicting migration bytes fail before mutation', async () => {
  const invalid = [
    { ...before(), systemIdentifier: '1' }, { ...before(), predecessor: null }, { ...before(), dependencies: [] },
    { ...before(), predecessor: { ...before().predecessor, sqlMd5: 'd'.repeat(32) } }, { ...before(), readOnly: false }, { ...before(), database: 'other' },
    { ...before(), serverVersion: '18.3' }, { ...before(), observedAt: '2026-09-13T04:57:59Z' },
    { ...before(), observedAt: '2026-09-13T05:00:11Z' }, { ...after(), catalog: before().catalog },
    { ...after(), migration: { ...after().migration, sqlMd5: 'd'.repeat(32) } },
  ];
  for (const observed of invalid) {
    assert.throws(() => validateProfileRoleObservation(observed, { sql, predecessorSql, now: instant }));
    const f = fixture({ observations: [observed] });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 1);
    assert.equal(f.events.at(-1).status, 'blocked-before-mutation');
  }
});

test('rehearsal failure or rollback drift cannot advance to apply', async () => {
  for (const options of [
    { onQuery: (_sql, call) => { if (call === 2) throw new Error('synthetic timeout'); } },
    { observations: [before(), { ...before(), preservedCatalogSha: '1'.repeat(32) }] },
    { observations: [before(), { ...before(), ledgerCount: 219 }] },
    { observations: [before(), { ...before(), catalog: { ...before().catalog, triggers: ['unexpected'] } }] },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.run(), code('PROFILE_ROLE_OUTCOME_REQUIRES_INSPECTION'));
    assert.ok(f.calls.length <= 3);
    assert.equal(f.events.some(event => event.status === 'apply-outcome-unverified'), false);
    assert.equal(f.closed, true);
  }
});

test('deadline or durable receipt failure before apply prevents the commit call', async () => {
  let time = instant;
  const expired = fixture({ now: () => time, onRecord: event => {
    if (event.status === 'rehearsed-and-rolled-back') time = new Date(instant.getTime() + 120_001);
  } });
  await assert.rejects(expired.run(), code('PROFILE_ROLE_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(expired.calls.length, 3);
  const receiptFailure = fixture({ onRecord: event => {
    if (event.status === 'apply-outcome-unverified') throw new Error('synthetic disk full');
  } });
  await assert.rejects(receiptFailure.run(), code('PROFILE_ROLE_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(receiptFailure.calls.length, 3);
});

test('ambiguous late commit is never retried or undone, and a bad postcheck cannot be labelled success', async () => {
  const ambiguous = fixture({ onQuery: (_sql, call) => { if (call === 4) throw new Error('response lost after synthetic commit'); } });
  await assert.rejects(ambiguous.run(), code('PROFILE_ROLE_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(ambiguous.calls.length, 4);
  assert.equal(ambiguous.events.at(-1).retryProhibited, true);
  const drift = fixture({ observations: [before(), before(), { ...after(), catalog: { ...after().catalog, policies: ['unexpected'] } }] });
  await assert.rejects(drift.run(), code('PROFILE_ROLE_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(drift.calls.length, 5);
  assert.equal(drift.events.some(event => event.status === 'applied-and-postverified'), false);
});

test('SQL bundles bind identity, the exact catalog/ledger, lock/deadline, exact raw ledger entry and postconditions', () => {
  const result = buildProfileRoleMutationSql({ sql, version, before: before(), deadline: '2026-09-13T05:02:00.000Z', rehearsal: true });
  for (const required of ["lock_timeout='5s'", "statement_timeout='30s'", 'SHARE ROW EXCLUSIVE',
    'pg_control_system()', 'PROFILE_ROLE_DEADLINE_EXPIRED', 'PROFILE_ROLE_BASELINE_DRIFT',
    'PROFILE_ROLE_AFTER_DRIFT', "7581440907192989109", "ARRAY['BEGIN;", 'ROLLBACK;'])
    assert.ok(result.includes(required), required);
  assert.equal(result.includes('DELETE FROM'), false);
  assert.equal(result.includes('UPDATE public'), false);
  assert.match(buildProfileRoleObservationSql(), /^BEGIN READ ONLY;/);
});

test('receipt handles short writes completely before fsync and refuses zero progress', () => {
  const value = { status: 'apply-outcome-unverified', detail: '합성 기록' };
  const written = [];
  let flushed = 0;
  appendProfileWeddingRolesReceipt(42, value, { write: (fd, bytes, offset, length, position) => {
    assert.equal(fd, 42); assert.equal(position, null); assert.equal(length, bytes.length - offset);
    const count = Math.min(3, length); written.push(bytes.subarray(offset, offset + count)); return count;
  }, flush: fd => { assert.equal(fd, 42); flushed += 1; } });
  assert.equal(Buffer.concat(written).toString(), `${JSON.stringify(value)}\n`);
  assert.equal(flushed, 1);
  for (const invalid of [0, -1, undefined, Infinity]) {
    flushed = 0;
    assert.throws(() => appendProfileWeddingRolesReceipt(42, value, { write: () => invalid, flush: () => { flushed += 1; } }),
      code('PROFILE_ROLE_RECEIPT_WRITE_INCOMPLETE'));
    assert.equal(flushed, 0);
  }
});
