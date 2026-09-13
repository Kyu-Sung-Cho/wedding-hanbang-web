import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseCustomerDataReleaseArgs, runCustomerDataRelease, appendCustomerDataReceipt } from '../lib/account-deletion-customer-data-release.mjs';
import { buildCustomerDataObservationSql, expectedCustomerDataCatalog, validateCustomerDataObservation, CUSTOMER_DATA_WRITER_TABLES } from '../lib/account-deletion-customer-data-catalog.mjs';

const root = resolve(import.meta.dirname, '../..'), read = file => readFileSync(join(root, file), 'utf8');
const context = { sql: read('supabase/migrations/20260913103407_account_deletion_customer_data_boundary.sql'),
  previousSql: read('supabase/migrations/20260716113000_account_deletion_storage_saga.sql'),
  previousClaimSql: read('supabase/migrations/20260716094000_couple_roster_epoch.sql'),
  fixture: JSON.parse(read('supabase/release-contracts/account-deletion-customer-data-pg17-catalog-v1.json')),
  predecessorSql: read('supabase/migrations/20260913082314_private_profile_avatars_delivery.sql') };
const instant = new Date('2026-09-13T11:00:00Z'), commit = 'a'.repeat(40), project = 'slrtobkksjmxgzatjyqb';
const md5 = value => createHash('md5').update(value).digest('hex');
const args = (mode = 'apply') => ['--account-deletion-customer-data', `--${mode}`, `--expected-commit=${commit}`, `--project-ref=${project}`,
  `--receipt-out=${join(tmpdir(), 'unused-customer-data-synthetic.jsonl')}`,
  `--confirm-production=account-deletion-customer-data-20260913:${project}:${mode}:${commit}`];
const before = () => ({ format: 'account-deletion-customer-data-catalog-v1', systemIdentifier: '7581440907192989109', serverVersion: '17.6',
  database: 'postgres', currentUser: 'postgres', readOnly: true, observedAt: instant.toISOString(), authTriggerAllowed: true,
  catalog: expectedCustomerDataCatalog(context.fixture, { ...context, applied: false }), preservedCatalogSha: 'e'.repeat(32),
  customerRows: Object.fromEntries([...CUSTOMER_DATA_WRITER_TABLES.map(table => `public.${table}`), 'public.profiles', 'public.couples',
    'auth.users', 'public.amora_private_chat_delete_boundaries', 'public.amora_memory_settings', 'public.amora_memory_enqueue_repair_dead_letters'].map(table => [table, [3, 'd'.repeat(32)]])),
  jobsCount: 0, privateScopesCount: 0, retiredRequestsCount: 0, ledgerSha: 'b'.repeat(32), ledgerWithoutTargetSha: 'b'.repeat(32), ledgerCount: 220, migration: null,
  predecessor: { version: '20260913082314', name: 'private_profile_avatars_delivery', statementCount: 1, sqlMd5: md5(context.predecessorSql) } });
const after = () => ({ ...before(), catalog: expectedCustomerDataCatalog(context.fixture, { ...context, applied: true }), ledgerSha: 'c'.repeat(32), ledgerCount: 221,
  migration: { version: '20260913103407', name: 'account_deletion_customer_data_boundary', statementCount: 1, sqlMd5: md5(context.sql) } });
function fixture({ mode = 'apply', observations = [before(), before(), after()], onQuery, onRecord, onSource } = {}) {
  const calls = [], events = []; let reads = 0, closed = false;
  return { calls, events, get closed() { return closed; }, run: () => runCustomerDataRelease({ repoRoot: root, argv: args(mode), now: () => instant,
    assertSource: () => onSource?.(), receiptFactory: () => ({ append: event => { onRecord?.(event); events.push(event); }, close: () => { closed = true; } }),
    query: async sql => { calls.push(sql); onQuery?.(sql, calls.length); return sql === buildCustomerDataObservationSql()
      ? [{ observation: structuredClone(observations[reads++]) }] : []; } }) };
}

test('the exact expand-only transaction rehearses, rolls back, commits once and separately verifies original rows and catalog', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, 'applied-and-postverified'); assert.equal(f.calls.length, 5); assert.equal(f.closed, true);
  assert.equal(f.calls[1].replace(/ROLLBACK;$/, 'COMMIT;'), f.calls[3]);
  assert.equal(/SET (?:LOCAL )?ROLE/.test(f.calls[1]), false);
  assert.match(f.calls[1], /LOCK TABLE supabase_migrations.schema_migrations, public.account_deletion_jobs/);
  assert.equal(f.calls.some(sql => /SELECT\s+(?:public\.)?prepare_account_deletion_customer_data\(/i.test(sql)), false);
});

test('inspect, rollback-only and already-applied inspection never commit or process customer data', async () => {
  for (const options of [{ mode: 'inspect' }, { mode: 'rehearse' }, { observations: [after()] }]) {
    const f = fixture(options); assert.equal((await f.run()).remoteWritesPerformed, false);
    assert.equal(f.calls.filter(sql => !sql.startsWith('BEGIN READ ONLY') && sql.endsWith('COMMIT;')).length, 0);
  }
});

test('wrong project, unknown modes and missing commit confirmation fail before networking', () => {
  for (const argv of [[], args().slice(0, -1), [...args(), '--profile-avatar'], [...args(), '--apply'], [...args(), '--unknown'],
    args().map(value => value.startsWith('--project-ref=') ? '--project-ref=wrongprojectref' : value)]) assert.throws(() => parseCustomerDataReleaseArgs(argv));
});

test('missing Auth trigger privilege, active jobs, prepared scopes or unknown retired requests stop before mutation', async () => {
  const invalid = [{ ...before(), authTriggerAllowed: false }, { ...before(), jobsCount: 1 }, { ...before(), privateScopesCount: 1 },
    { ...before(), retiredRequestsCount: 1 }, { ...before(), systemIdentifier: '1' }, { ...before(), currentUser: 'service_role' },
    { ...before(), predecessor: null }, { ...before(), serverVersion: '18.3' }, { ...before(), observedAt: '2026-09-13T10:57:59Z' },
    { ...before(), customerRows: {} }, { ...after(), migration: { ...after().migration, sqlMd5: 'd'.repeat(32) } }];
  for (const observed of invalid) {
    assert.throws(() => validateCustomerDataObservation(observed, { ...context, now: instant }));
    const f = fixture({ observations: [observed] }); await assert.rejects(f.run());
    assert.equal(f.calls.length, 1); assert.equal(f.events.at(-1).status, 'blocked-before-mutation');
  }
});

test('rollback drift, stale source or incomplete durable receipt cannot advance to commit', async () => {
  for (const options of [{ observations: [before(), { ...before(), jobsCount: 1 }] },
    { observations: [before(), { ...before(), customerRows: { ...before().customerRows, 'auth.users': [4, 'd'.repeat(32)] } }] },
    { onRecord: event => { if (event.status === 'apply-outcome-unverified') throw Error('synthetic full disk'); } },
    { onSource: (() => { let count = 0; return () => { if (++count === 2) throw Error('synthetic dirty source'); }; })() }]) {
    const f = fixture(options); await assert.rejects(f.run(), { code: 'CUSTOMER_DATA_OUTCOME_REQUIRES_INSPECTION' });
    assert.equal(f.calls.length, 3); assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
  }
});

test('uncertain commit or postcheck drift preserves unknown outcome with no retry or unsafe rollback', async () => {
  for (const options of [{ onQuery: (_sql, count) => { if (count === 4) throw Error('synthetic lost response'); } },
    { observations: [before(), before(), { ...after(), preservedCatalogSha: '1'.repeat(32) }] },
    { observations: [before(), before(), { ...after(), customerRows: { ...after().customerRows, 'auth.users': [2, 'd'.repeat(32)] } }] },
    { observations: [before(), before(), { ...after(), privateScopesCount: 1 }] }]) {
    const f = fixture(options); await assert.rejects(f.run(), { code: 'CUSTOMER_DATA_OUTCOME_REQUIRES_INSPECTION' });
    assert.ok(f.calls.length <= 5); assert.equal(f.events.at(-1).retryProhibited, true);
    assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
  }
});

test('short receipt writes complete before flush, zero progress never passes the write boundary', () => {
  const bytes = []; let flushed = 0;
  appendCustomerDataReceipt(1, { status: '확인 🌷' }, { write: (_fd, value, offset) => { bytes.push(value.subarray(offset, offset + 1)); return 1; }, flush: () => { flushed++; } });
  assert.equal(Buffer.concat(bytes).toString(), '{"status":"확인 🌷"}\n'); assert.equal(flushed, 1);
  assert.throws(() => appendCustomerDataReceipt(1, {}, { write: () => 0, flush: () => { throw Error('unexpected flush'); } }), { code: 'CUSTOMER_DATA_RECEIPT_WRITE_INCOMPLETE' });
});
