import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { appendDeletionAuditReceipt, buildDeletionAuditMutationSql, buildDeletionAuditObservationSql, parseDeletionAuditReleaseArgs,
  runDeletionAuditNullabilityRelease, validateDeletionAuditObservation } from '../lib/account-deletion-audit-nullability-release.mjs';
import {createDeletionAuditHistoricalRepository} from './fixtures/account-deletion-audit-historical-repository.mjs';

const root = resolve(import.meta.dirname, '../..');
const historical=createDeletionAuditHistoricalRepository(root);
test.after(historical.cleanup);
const version = '20260928073546';
const sql = readFileSync(join(root, `supabase/migrations/${version}_account_deletion_anonymous_audit.sql`), 'utf8');
const instant = new Date('2026-09-28T05:00:00Z');
const commit = 'a'.repeat(40), project = 'slrtobkksjmxgzatjyqb';
const args = (mode = 'apply') => ['--account-deletion-audit-nullability', `--${mode}`, `--expected-commit=${commit}`,
  `--project-ref=${project}`, `--receipt-out=${join(tmpdir(), 'unused-deletion-audit-synthetic-receipt.jsonl')}`,
  `--confirm-production=account-deletion-audit-nullability-20260928:${project}:${mode}:${commit}`];
const code = value => error => error?.code === value;
const before = () => ({ format: 'account-deletion-audit-catalog-v1', systemIdentifier: '7581440907192989109', serverVersion: '17.6',
  database: 'postgres', readOnly: true, observedAt: instant.toISOString(), catalog: {
    columns: [{ name: 'user_id', type: '2950', modifier: -1, generated: '', identity: '', not_null: null, default: null }],
    relation: { owner: 10, acl: null, rls: true, force_rls: false }, constraints: [], indexes: [], policies: [], triggers: [] },
  notNull: true, ledgerSha: 'b'.repeat(32), ledgerWithoutTargetSha: 'b'.repeat(32), ledgerCount: 217, migration: null });
const after = () => ({ ...before(), notNull: false, ledgerSha: 'c'.repeat(32), ledgerCount: 218,
  migration: { version, name: 'account_deletion_anonymous_audit', statementCount: 1,
    sqlMd5: createHash('md5').update(sql).digest('hex') } });

function fixture({ mode = 'apply', observations = [before(), before(), after()], onQuery, onRecord, onSource, now } = {}) {
  const calls = [], events = [];
  let reads = 0, closed = false, sourceChecks = 0;
  return { calls, events, get closed() { return closed; }, get sourceChecks() { return sourceChecks; },
    run: () => runDeletionAuditNullabilityRelease({ repoRoot: historical.root, argv: args(mode), now: now ?? (() => instant),
      assertSource: () => { sourceChecks += 1; onSource?.(sourceChecks); },
      receiptFactory: () => ({ append: event => { onRecord?.(event); events.push(event); }, close: () => { closed = true; } }),
      query: async query => {
        calls.push(query); await onQuery?.(query, calls.length);
        if (query === buildDeletionAuditObservationSql(sql, version)) return [{ observation: structuredClone(observations[reads++]) }];
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
  assert.match(f.calls[1], /DROP NOT NULL/);
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
    assert.throws(() => parseDeletionAuditReleaseArgs(argv));
});

test('receipt paths inside the repository are rejected before source, receipt or network effects', async () => {
  for (const file of [root, join(root, 'private-receipt.jsonl'), join(root, 'scripts', '..', 'receipt.jsonl')]) {
    let effects = 0;
    await assert.rejects(runDeletionAuditNullabilityRelease({ repoRoot: root,
      argv: args().map(arg => arg.startsWith('--receipt-out=') ? `--receipt-out=${file}` : arg),
      now: () => instant, assertSource: () => { effects++; },
      receiptFactory: () => { effects++; return { append: () => {}, close: () => {} }; },
      query: async () => { effects++; throw new Error('must not query'); },
    }), code('DELETION_AUDIT_RECEIPT_PATH_INVALID'));
    assert.equal(effects, 0);
  }
});

test('wrong identity, column, old/future evidence and conflicting migration bytes fail before mutation', async () => {
  const column = patch => ({ ...before(), catalog: { ...before().catalog,
    columns: [{ ...before().catalog.columns[0], ...patch }] } });
  const invalid = [
    { ...before(), systemIdentifier: '1' }, { ...before(), readOnly: false }, { ...before(), database: 'other' },
    { ...before(), serverVersion: '18.3' }, { ...before(), observedAt: '2026-09-28T04:57:59Z' },
    { ...before(), observedAt: '2026-09-28T05:00:11Z' }, { ...after(), notNull: true },
    { ...after(), migration: { ...after().migration, sqlMd5: 'd'.repeat(32) } },
    column({ type: '25' }), column({ default: 'gen_random_uuid()' }),
    column({ generated: 's' }), column({ identity: 'a' }), column({ not_null: true }),
    { ...before(), catalog: { ...before().catalog, relation: null } },
    { ...before(), catalog: { ...before().catalog, columns: [...before().catalog.columns, before().catalog.columns[0]] } },
    { ...before(), ledgerSha: 'c'.repeat(32) },
    { ...after(), migration: { ...after().migration, statementCount: 2 } },
    { ...after(), migration: { ...after().migration, name: 'unrelated' } },
  ];
  for (const observed of invalid) {
    assert.throws(() => validateDeletionAuditObservation(observed, { sql, version, now: instant }));
    const f = fixture({ observations: [observed] });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 1);
    assert.equal(f.events.at(-1).status, 'blocked-before-mutation');
  }
});

test('rehearsal failure or rollback drift cannot advance to apply', async () => {
  for (const options of [
    { onQuery: (_sql, call) => { if (call === 2) throw new Error('synthetic timeout'); } },
    { observations: [before(), { ...before(), notNull: false }] },
    { observations: [before(), { ...before(), ledgerCount: 218 }] },
    { observations: [before(), { ...before(), catalog: { ...before().catalog, triggers: ['unexpected'] } }] },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.run(), code('DELETION_AUDIT_OUTCOME_REQUIRES_INSPECTION'));
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
  await assert.rejects(expired.run(), code('DELETION_AUDIT_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(expired.calls.length, 3);
  const receiptFailure = fixture({ onRecord: event => {
    if (event.status === 'apply-outcome-unverified') throw new Error('synthetic disk full');
  } });
  await assert.rejects(receiptFailure.run(), code('DELETION_AUDIT_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(receiptFailure.calls.length, 3);
});

test('an expired deadline after durable prewrite bookkeeping still prevents a commit dispatch', async () => {
  let time = instant;
  const f = fixture({ now: () => time, onRecord: event => {
    if (event.status === 'apply-outcome-unverified') time = new Date(instant.getTime() + 120_001);
  } });
  await assert.rejects(f.run(), code('DELETION_AUDIT_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(f.calls.length, 3);
});

test('durable intent failure prevents rehearsal, and a source failure after rollback prevents commit', async () => {
  const beforeWrite = fixture({ onRecord: event => {
    if (event.status === 'rehearsal-outcome-unverified') throw new Error('synthetic disk full');
  } });
  await assert.rejects(beforeWrite.run());
  assert.equal(beforeWrite.calls.length, 1);
  assert.equal(beforeWrite.events.at(-1).status, 'blocked-before-mutation');
  assert.equal(beforeWrite.closed, true);
  const changedSource = fixture({ onSource: check => { if (check === 2) throw new Error('source changed'); } });
  await assert.rejects(changedSource.run(), code('DELETION_AUDIT_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(changedSource.calls.length, 3);
  assert.equal(changedSource.closed, true);
});

test('ambiguous late commit is never retried or undone, and a bad postcheck cannot be labelled success', async () => {
  const ambiguous = fixture({ onQuery: (_sql, call) => { if (call === 4) throw new Error('response lost after synthetic commit'); } });
  await assert.rejects(ambiguous.run(), code('DELETION_AUDIT_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(ambiguous.calls.length, 4);
  assert.equal(ambiguous.events.at(-1).retryProhibited, true);
  const drift = fixture({ observations: [before(), before(), { ...after(), catalog: { ...after().catalog, policies: ['unexpected'] } }] });
  await assert.rejects(drift.run(), code('DELETION_AUDIT_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(drift.calls.length, 5);
  assert.equal(drift.events.some(event => event.status === 'applied-and-postverified'), false);
});

test('SQL bundles bind identity, the exact catalog/ledger, lock/deadline, exact raw ledger entry and postconditions', () => {
  const result = buildDeletionAuditMutationSql({ sql, version, before: before(), deadline: '2026-09-28T05:02:00.000Z', rehearsal: true });
  for (const required of ["lock_timeout='5s'", "statement_timeout='30s'", 'ACCESS EXCLUSIVE', 'SHARE ROW EXCLUSIVE',
    'pg_control_system()', 'DELETION_AUDIT_DEADLINE_EXPIRED', 'DELETION_AUDIT_BASELINE_DRIFT',
    'DELETION_AUDIT_AFTER_DRIFT', "7581440907192989109", 'ROLLBACK;'])
    assert.ok(result.includes(required), required);
  assert.ok(result.includes(`ARRAY['${sql.replaceAll("'", "''")}']::text[]`));
  assert.equal(result.includes('DELETE FROM'), false);
  assert.equal(result.includes('UPDATE public'), false);
  assert.match(buildDeletionAuditObservationSql(sql, version), /^BEGIN READ ONLY;/);
  assert.throws(() => buildDeletionAuditObservationSql(sql, '20260101000000'), code('DELETION_AUDIT_VERSION_INVALID'));
  assert.throws(() => buildDeletionAuditMutationSql({ sql, version, before: { ...before(), notNull: 'false; COMMIT;' },
    deadline: '2026-09-28T05:02:00.000Z', rehearsal: true }), code('DELETION_AUDIT_BUNDLE_INVALID'));
});

test('receipt handles short writes completely before fsync and refuses zero progress', () => {
  const value = { status: 'apply-outcome-unverified', detail: '합성 기록' };
  const written = [];
  let flushed = 0;
  appendDeletionAuditReceipt(42, value, { write: (fd, bytes, offset, length, position) => {
    assert.equal(fd, 42); assert.equal(position, null); assert.equal(length, bytes.length - offset);
    const count = Math.min(3, length); written.push(bytes.subarray(offset, offset + count)); return count;
  }, flush: fd => { assert.equal(fd, 42); flushed += 1; } });
  assert.equal(Buffer.concat(written).toString(), `${JSON.stringify(value)}\n`);
  assert.equal(flushed, 1);
  for (const invalid of [0, -1, undefined, Infinity]) {
    flushed = 0;
    assert.throws(() => appendDeletionAuditReceipt(42, value, { write: () => invalid, flush: () => { flushed += 1; } }),
      code('DELETION_AUDIT_RECEIPT_WRITE_INCOMPLETE'));
    assert.equal(flushed, 0);
  }
});
