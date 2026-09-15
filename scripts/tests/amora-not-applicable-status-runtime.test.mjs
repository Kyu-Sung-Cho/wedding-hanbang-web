import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendNotApplicableReceipt, buildNotApplicableMutationSql, buildNotApplicableObservationSql, NOT_APPLICABLE_FUNCTION_SHAPE,
  notApplicableFunctionBody, notApplicableFunctionCatalogSql, notApplicablePreservedCatalogSql, parseNotApplicableReleaseArgs,
  runNotApplicableStatusRelease, validateNotApplicableObservation,
} from '../lib/amora-not-applicable-status-release.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = file => readFileSync(join(root, file), 'utf8');
const sql = read('supabase/migrations/20260915101500_amora_atomic_not_applicable_status.sql');
const previousSql = read('supabase/migrations/20260911080244_amora_budget_plan_explicit_allocations.sql');
const predecessorSql = read('supabase/migrations/20260913103407_account_deletion_customer_data_boundary.sql');
const context = { sql, previousSql, predecessorSql };
const md5 = value => createHash('md5').update(value).digest('hex');
const instant = new Date('2026-09-15T06:00:00Z'), commit = 'a'.repeat(40), project = 'slrtobkksjmxgzatjyqb';
const code = value => error => error?.code === value;
const args = (mode = 'apply') => ['--amora-not-applicable-status', `--${mode}`, `--expected-commit=${commit}`, `--project-ref=${project}`,
  `--receipt-out=${join(tmpdir(), 'unused-not-applicable-synthetic.jsonl')}`,
  `--confirm-production=amora-not-applicable-status-20260915:${project}:${mode}:${commit}`];
const fn = body => ({ ...NOT_APPLICABLE_FUNCTION_SHAPE, config: [...NOT_APPLICABLE_FUNCTION_SHAPE.config], bodyMd5: md5(body),
  acl: [['postgres', 'postgres', 'EXECUTE', false]] });
const before = () => ({ format: 'amora-not-applicable-status-catalog-v1', systemIdentifier: '7581440907192989109', serverVersion: '17.6',
  database: 'postgres', currentUser: 'postgres', readOnly: true, observedAt: instant.toISOString(),
  function: [fn(notApplicableFunctionBody(previousSql))], preservedCatalogSha: 'e'.repeat(32),
  ledgerSha: 'b'.repeat(32), ledgerWithoutTargetSha: 'b'.repeat(32), ledgerCount: 222, migration: null,
  predecessor: { version: '20260913103407', name: 'account_deletion_customer_data_boundary', statementCount: 1, sqlMd5: md5(predecessorSql) } });
const after = () => ({ ...before(), function: [fn(notApplicableFunctionBody(sql))], ledgerSha: 'c'.repeat(32), ledgerCount: 223,
  migration: { version: '20260915101500', name: 'amora_atomic_not_applicable_status', statementCount: 1, sqlMd5: md5(sql) } });

function fixture({ mode = 'apply', observations = [before(), before(), after()], onQuery, onRecord, onSource, now } = {}) {
  const calls = [], events = []; let reads = 0, closed = false, sourceChecks = 0;
  return { calls, events, get closed() { return closed; }, get sourceChecks() { return sourceChecks; },
    run: () => runNotApplicableStatusRelease({ repoRoot: root, argv: args(mode), now: now ?? (() => instant),
      assertSource: () => { sourceChecks += 1; onSource?.(sourceChecks); },
      receiptFactory: () => ({ append: event => { onRecord?.(event); events.push(event); }, close: () => { closed = true; } }),
      query: async text => { calls.push(text); await onQuery?.(text, calls.length);
        return text === buildNotApplicableObservationSql() ? [{ observation: structuredClone(observations[reads++]) }] : []; } }) };
}

test('apply observes, rehearses the exact function replacement, rechecks the source, commits once and postverifies', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, 'applied-and-postverified'); assert.equal(result.remoteWritesPerformed, true);
  assert.equal(f.calls.length, 5); assert.equal(f.closed, true); assert.equal(f.sourceChecks, 2);
  assert.equal(f.calls[1].replace(/ROLLBACK;$/, 'COMMIT;'), f.calls[3]);
  assert.match(f.calls[1], /CREATE OR REPLACE FUNCTION public\.apply_amora_atomic_tool_execution_pre_shared_revision\(/);
  assert.match(f.calls[1], /INSERT INTO supabase_migrations\.schema_migrations/);
  // 고정 migration 원문(함수 본문)과 원장 기록 문자열을 뺀 감싸는 부분에는 권한 전환·데이터 쓰기가 없다.
  const body = sql.replace(/^[\s\S]*?\bBEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  const envelope = f.calls[1].split(body).join('').split(`ARRAY['${sql.replaceAll("'", "''")}']::text[]`).join('ARRAY[]::text[]');
  assert.equal(envelope.length < 20_000, true);
  assert.equal(/\bSET (?:LOCAL )?ROLE\b|DELETE FROM|UPDATE |TRUNCATE|GRANT |REVOKE /.test(envelope), false);
  assert.equal(f.events.at(-1).status, 'applied-and-postverified');
});

test('inspect, rehearse and an already-applied ledger never commit a mutation', async () => {
  for (const options of [{ mode: 'inspect' }, { mode: 'rehearse' }, { observations: [after()] }]) {
    const f = fixture(options); const result = await f.run();
    assert.equal(result.remoteWritesPerformed, false);
    assert.equal(f.calls.filter(text => !text.startsWith('BEGIN READ ONLY') && text.endsWith('COMMIT;')).length, 0);
    assert.equal(f.closed, true);
  }
});

test('malformed, mixed, wrong destination and unconfirmed arguments fail before any network call', () => {
  for (const argv of [[], args().slice(0, -1), [...args(), '--rehearse'], [...args(), '--apply'], [...args(), '--account-deletion-customer-data'],
    [...args(), '--unknown'], args().map(arg => arg.startsWith('--project-ref=') ? '--project-ref=abcdefghijklmnopqrst' : arg),
    args().map(arg => arg.startsWith('--expected-commit=') ? '--expected-commit=bad' : arg),
    args().map(arg => arg.startsWith('--confirm-production=') ? `${arg}x` : arg)])
    assert.throws(() => parseNotApplicableReleaseArgs(argv));
});

test('wrong target, missing predecessor, function drift, widened grants and ledger conflicts stop before mutation', async () => {
  const withFunction = (base, change) => { const value = base; value.function = [{ ...value.function[0], ...change }]; return value; };
  const invalid = [
    { ...before(), systemIdentifier: '1' }, { ...before(), readOnly: false }, { ...before(), currentUser: 'service_role' },
    { ...before(), serverVersion: '18.3' }, { ...before(), observedAt: '2026-09-15T05:57:59Z' }, { ...before(), predecessor: null },
    { ...before(), predecessor: { ...before().predecessor, statementCount: 40 } },
    withFunction(before(), { bodyMd5: md5(notApplicableFunctionBody(sql)) }), withFunction(before(), { securityDefiner: false }),
    withFunction(before(), { config: ['search_path=public'] }), withFunction(before(), { owner: 'supabase_admin' }),
    withFunction(before(), { acl: [['service_role', 'postgres', 'EXECUTE', false]] }),
    { ...before(), function: [...before().function, ...before().function] }, { ...before(), function: [] },
    { ...before(), ledgerWithoutTargetSha: 'd'.repeat(32) },
    { ...after(), migration: { ...after().migration, sqlMd5: 'd'.repeat(32) } },
    withFunction(after(), { bodyMd5: md5(notApplicableFunctionBody(previousSql)) }),
  ];
  for (const observed of invalid) {
    assert.throws(() => validateNotApplicableObservation(observed, { ...context, now: instant }), JSON.stringify(observed).slice(0, 80));
    const f = fixture({ observations: [observed] }); await assert.rejects(f.run());
    assert.equal(f.calls.length, 1); assert.equal(f.events.at(-1).status, 'blocked-before-mutation');
  }
});

test('rehearsal failure, rollback drift, stale source, deadline or receipt failure cannot reach the commit call', async () => {
  let time = instant;
  for (const options of [
    { onQuery: (_text, call) => { if (call === 2) throw new Error('synthetic timeout'); } },
    { observations: [before(), { ...before(), ledgerCount: 223 }] },
    { observations: [before(), { ...before(), preservedCatalogSha: '1'.repeat(32) }] },
    { onSource: count => { if (count === 2) throw new Error('synthetic dirty source'); } },
    { onRecord: event => { if (event.status === 'apply-outcome-unverified') throw new Error('synthetic disk full'); } },
    { now: () => time, onRecord: event => { if (event.status === 'rehearsed-and-rolled-back') time = new Date(instant.getTime() + 120_001); } },
  ]) {
    time = instant;
    const f = fixture(options);
    await assert.rejects(f.run(), code('NOT_APPLICABLE_OUTCOME_REQUIRES_INSPECTION'));
    assert.ok(f.calls.length <= 3);
    assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
    assert.equal(f.closed, true);
  }
});

test('an ambiguous commit is never retried and a postcheck drift is never labelled success', async () => {
  const ambiguous = fixture({ onQuery: (_text, call) => { if (call === 4) throw new Error('response lost after synthetic commit'); } });
  await assert.rejects(ambiguous.run(), code('NOT_APPLICABLE_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(ambiguous.calls.length, 4); assert.equal(ambiguous.events.at(-1).retryProhibited, true);
  const grants = after(); grants.function[0].acl = [...grants.function[0].acl, ['supabase_admin', 'postgres', 'EXECUTE', false]];
  for (const observed of [{ ...after(), preservedCatalogSha: '1'.repeat(32) }, { ...after(), ledgerCount: 224 }, grants]) {
    const f = fixture({ observations: [before(), before(), observed] });
    await assert.rejects(f.run(), code('NOT_APPLICABLE_OUTCOME_REQUIRES_INSPECTION'));
    assert.equal(f.calls.length, 5);
    assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
  }
});

test('receipt writes short chunks completely before fsync and refuses zero progress', () => {
  const value = { status: 'apply-outcome-unverified', detail: '합성 기록' }, written = []; let flushed = 0;
  appendNotApplicableReceipt(7, value, { write: (_fd, bytes, offset, length) => { const count = Math.min(3, length);
    written.push(bytes.subarray(offset, offset + count)); return count; }, flush: () => { flushed += 1; } });
  assert.equal(Buffer.concat(written).toString(), `${JSON.stringify(value)}\n`); assert.equal(flushed, 1);
  for (const invalid of [0, -1, undefined, Infinity])
    assert.throws(() => appendNotApplicableReceipt(7, value, { write: () => invalid, flush: () => { throw new Error('unexpected flush'); } }),
      code('NOT_APPLICABLE_RECEIPT_WRITE_INCOMPLETE'));
});

// 합성 PGlite에서 실제 catalog 관측식과 적용 묶음을 돌린다. 운영 식별값 검사만 로컬 값으로 바꾼다.
test('the real catalog query and bundle rehearse, roll back and commit exactly the new body on a local PostgreSQL', { timeout: 120_000 }, async () => {
  const { PGlite } = createRequire(join(root, 'apps/web/package.json'))('@electric-sql/pglite');
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE TABLE public.amora_chat_request_claims(x int); CREATE TABLE public.amora_tool_executions(x int);
      CREATE TABLE public.wedding_journeys(x int); CREATE TABLE public.amora_actions(x int);
      CREATE FUNCTION public.unrelated_helper() RETURNS int LANGUAGE sql AS 'SELECT 1';
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    await db.exec(previousSql);
    await db.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260913103407','account_deletion_customer_data_boundary',ARRAY[$1]::text[])", [predecessorSql]);
    const observe = async () => (await db.exec(buildNotApplicableObservationSql())).flatMap(r => r.rows ?? []).find(row => row.observation).observation;
    const local = await observe();
    assert.deepEqual(local.function.map(({ bodyMd5, acl, ...shape }) => shape), [NOT_APPLICABLE_FUNCTION_SHAPE]);
    assert.equal(local.function[0].bodyMd5, md5(notApplicableFunctionBody(previousSql)));
    assert.deepEqual(local.function[0].acl, [['postgres', 'postgres', 'EXECUTE', false]]);
    assert.equal(local.migration, null); assert.equal(local.ledgerSha, local.ledgerWithoutTargetSha);
    assert.deepEqual(local.predecessor, before().predecessor);
    assert.match(local.preservedCatalogSha, /^[a-f0-9]{32}$/);
    const localize = text => text.replace(`<>'7581440907192989109'`, `<>'${local.systemIdentifier}'`)
      .replace('NOT BETWEEN 170000 AND 179999', 'NOT BETWEEN 170000 AND 189999');
    const deadline = new Date(Date.now() + 60_000).toISOString();
    await db.exec(localize(buildNotApplicableMutationSql({ sql, before: local, deadline, rehearsal: true })));
    const rolledBack = await observe();
    for (const key of ['function', 'preservedCatalogSha', 'ledgerSha', 'ledgerCount', 'migration']) assert.deepEqual(rolledBack[key], local[key]);
    await db.exec('CREATE FUNCTION public.concurrent_helper() RETURNS int LANGUAGE sql AS \'SELECT 2\'');
    await assert.rejects(db.exec(localize(buildNotApplicableMutationSql({ sql, before: local, deadline, rehearsal: false }))), /NOT_APPLICABLE_BASELINE_DRIFT/);
    await db.exec('ROLLBACK').catch(() => undefined);
    await db.exec('DROP FUNCTION public.concurrent_helper()');
    assert.deepEqual((await observe()).function, local.function);
    await db.exec(localize(buildNotApplicableMutationSql({ sql, before: local, deadline, rehearsal: false })));
    const applied = await observe();
    assert.equal(applied.function[0].bodyMd5, md5(notApplicableFunctionBody(sql)));
    assert.deepEqual({ ...applied.function[0], bodyMd5: null }, { ...local.function[0], bodyMd5: null });
    assert.equal(applied.preservedCatalogSha, local.preservedCatalogSha);
    assert.deepEqual(applied.migration, after().migration);
    assert.equal(applied.ledgerWithoutTargetSha, local.ledgerSha); assert.equal(Number(applied.ledgerCount), Number(local.ledgerCount) + 1);
    assert.match(notApplicableFunctionCatalogSql(), /md5\(p\.prosrc\)/); assert.match(notApplicablePreservedCatalogSql(), /pg_get_functiondef/);
  } finally { await db.close(); }
});
