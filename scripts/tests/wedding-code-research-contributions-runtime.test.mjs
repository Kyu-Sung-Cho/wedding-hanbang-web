import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendWeddingCodeResearchReceipt, buildWeddingCodeResearchMutationSql, buildWeddingCodeResearchObservationSql,
  expectedWeddingCodeResearchCatalog, parseWeddingCodeResearchReleaseArgs, runWeddingCodeResearchRelease,
  validateWeddingCodeResearchCatalog, validateWeddingCodeResearchObservation, weddingCodeResearchPreservedCatalogSql,
  weddingCodeResearchTargetCatalogSql,
} from '../lib/wedding-code-research-contributions-release.mjs';
import { CurrentBaselineBlocked } from '../lib/current-baseline-release-contract.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = file => readFileSync(join(root, file), 'utf8');
const sql = read('supabase/migrations/20260915130000_wedding_code_research_contributions.sql');
const predecessorSql = read('supabase/migrations/20260915101500_amora_atomic_not_applicable_status.sql');
const context = { sql, predecessorSql };
const md5 = value => createHash('md5').update(value).digest('hex');
const instant = new Date('2026-09-15T07:00:00Z'), commit = 'a'.repeat(40), project = 'slrtobkksjmxgzatjyqb';
const code = value => error => error?.code === value;
const args = (mode = 'apply') => ['--wedding-code-research-contributions', `--${mode}`, `--expected-commit=${commit}`, `--project-ref=${project}`,
  `--receipt-out=${join(tmpdir(), 'unused-wedding-code-research-synthetic.jsonl')}`,
  `--confirm-production=wedding-code-research-contributions-20260915:${project}:${mode}:${commit}`];
const before = () => ({ format: 'wedding-code-research-contributions-catalog-v1', systemIdentifier: '7581440907192989109', serverVersion: '17.6',
  database: 'postgres', currentUser: 'postgres', readOnly: true, observedAt: instant.toISOString(),
  catalog: { relations: [], functions: [] }, preservedCatalogSha: 'e'.repeat(32),
  ledgerSha: 'b'.repeat(32), ledgerWithoutTargetSha: 'b'.repeat(32), ledgerCount: 223, migration: null,
  predecessor: { version: '20260915101500', name: 'amora_atomic_not_applicable_status', statementCount: 1, sqlMd5: md5(predecessorSql) } });
const after = () => ({ ...before(), catalog: expectedWeddingCodeResearchCatalog(sql), ledgerSha: 'c'.repeat(32), ledgerCount: 224,
  migration: { version: '20260915130000', name: 'wedding_code_research_contributions', statementCount: 1, sqlMd5: md5(sql) } });
const withRelation = (base, change) => { const value = base; value.catalog.relations[0] = { ...value.catalog.relations[0], ...change }; return value; };
const withFunction = (base, change) => { const value = base; value.catalog.functions[0] = { ...value.catalog.functions[0], ...change }; return value; };

function fixture({ mode = 'apply', observations = [before(), before(), after()], onQuery, onRecord, onSource, now } = {}) {
  const calls = [], events = []; let reads = 0, closed = false, sourceChecks = 0;
  return { calls, events, get closed() { return closed; }, get sourceChecks() { return sourceChecks; },
    run: () => runWeddingCodeResearchRelease({ repoRoot: root, argv: args(mode), now: now ?? (() => instant),
      assertSource: () => { sourceChecks += 1; onSource?.(sourceChecks); },
      receiptFactory: () => ({ append: event => { onRecord?.(event); events.push(event); }, close: () => { closed = true; } }),
      query: async text => { calls.push(text); await onQuery?.(text, calls.length);
        return text === buildWeddingCodeResearchObservationSql() ? [{ observation: structuredClone(observations[reads++]) }] : []; } }) };
}

test('apply observes, rehearses the exact new tables and functions, rechecks the source, commits once and postverifies', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, 'applied-and-postverified'); assert.equal(result.remoteWritesPerformed, true);
  assert.equal(f.calls.length, 5); assert.equal(f.closed, true); assert.equal(f.sourceChecks, 2);
  assert.equal(f.calls[1].replace(/ROLLBACK;$/, 'COMMIT;'), f.calls[3]);
  assert.match(f.calls[1], /CREATE TABLE public\.wedding_code_research_contributions \(/);
  assert.match(f.calls[1], /CREATE FUNCTION public\.delete_wedding_code_research_contribution\(/);
  assert.match(f.calls[1], /INSERT INTO supabase_migrations\.schema_migrations/);
  // 고정 migration 원문, 원장 기록 문자열, 기대 catalog에 든 함수 본문 문자열을 뺀 감싸는 부분에는
  // 권한 전환·데이터 쓰기·권한 부여 구문이 없다.
  const body = sql.replace(/^[\s\S]*?\bBEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  let envelope = f.calls[1].split(body).join('').split(`ARRAY['${sql.replaceAll("'", "''")}']::text[]`).join('ARRAY[]::text[]');
  for (const { body: source } of expectedWeddingCodeResearchCatalog(sql).functions) {
    const quoted = `'${JSON.stringify(source).replaceAll("'", "''")}'::jsonb`;
    assert.equal(envelope.split(quoted).length, 2);
    envelope = envelope.split(quoted).join("'\"\"'::jsonb");
  }
  assert.equal(envelope.length < 60_000, true);
  assert.equal(/\bSET (?:LOCAL )?ROLE\b|\bDELETE FROM\b|\bUPDATE \w|\bTRUNCATE \w|\bGRANT \w|\bREVOKE \w|\bDROP \w|wedding_code_response/.test(envelope), false);
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
  for (const argv of [[], args().slice(0, -1), [...args(), '--rehearse'], [...args(), '--apply'], [...args(), '--amora-not-applicable-status'],
    [...args(), '--unknown'], args().map(arg => arg.startsWith('--project-ref=') ? '--project-ref=abcdefghijklmnopqrst' : arg),
    args().map(arg => arg.startsWith('--expected-commit=') ? '--expected-commit=bad' : arg),
    args().map(arg => arg.startsWith('--receipt-out=') ? '--receipt-out=relative.jsonl' : arg),
    args().map(arg => arg.startsWith('--confirm-production=') ? `${arg}x` : arg)])
    assert.throws(() => parseWeddingCodeResearchReleaseArgs(argv));
});

test('wrong target, missing predecessor, catalog drift, widened grants and ledger conflicts stop before mutation', async () => {
  const invalid = [
    { ...before(), systemIdentifier: '1' }, { ...before(), readOnly: false }, { ...before(), currentUser: 'service_role' },
    { ...before(), database: 'other' }, { ...before(), serverVersion: '18.3' }, { ...before(), observedAt: '2026-09-15T06:57:59Z' },
    { ...before(), observedAt: '2026-09-15T07:00:11Z' }, { ...before(), predecessor: { ...before().predecessor, statementCount: 40 } },
    { ...before(), catalog: { relations: [{ name: 'public.wedding_code_research_contributions' }], functions: [] } },
    { ...before(), ledgerWithoutTargetSha: 'd'.repeat(32) },
    { ...after(), migration: { ...after().migration, sqlMd5: 'd'.repeat(32) } },
    { ...after(), catalog: before().catalog },
    withRelation(after(), { rls: false }), withRelation(after(), { policies: [{ polname: 'open' }] }),
    withRelation(after(), { acl: [...after().catalog.relations[0].acl, ['anon', 'postgres', 'SELECT', false]] }),
    withFunction(after(), { securityDefiner: false }), withFunction(after(), { config: ['search_path=public'] }),
    withFunction(after(), { acl: [...after().catalog.functions[0].acl, ['authenticated', 'postgres', 'EXECUTE', false]] }),
    withFunction(after(), { body: after().catalog.functions[0].body.replace('RAISE EXCEPTION', 'RAISE NOTICE') }),
  ];
  for (const observed of invalid) {
    assert.throws(() => validateWeddingCodeResearchObservation(observed, { ...context, now: instant }), JSON.stringify(observed).slice(0, 120));
    const f = fixture({ observations: [observed] }); await assert.rejects(f.run());
    assert.equal(f.calls.length, 1); assert.equal(f.events.at(-1).status, 'blocked-before-mutation');
  }
});

// 233 릴리스가 운영에 없을 때 운영자가 할 일을 오류 문구로 정확히 안내한다.
const BASE_233 = '965f9f37ea486b7b6d8f9dcd8516e2eb7e381a31';
test('a missing predecessor stops before mutation and tells the operator the exact 233-first order', async () => {
  const missing = { ...before(), predecessor: null };
  const expectGuidance = error => {
    assert.ok(error instanceof CurrentBaselineBlocked); assert.equal(error.code, 'WEDDING_CODE_RESEARCH_PREDECESSOR_NOT_APPLIED');
    for (const part of ['20260915101500', 'amora_atomic_not_applicable_status', BASE_233, '--amora-not-applicable-status',
      '--inspect', '--rehearse', '--apply', `--confirm-production=amora-not-applicable-status-20260915:${project}:<mode>:${BASE_233}`,
      'applied-and-postverified', '--wedding-code-research-contributions --inspect', 'schema_migrations'])
      assert.ok(error.message.includes(part), part);
    return true;
  };
  assert.throws(() => validateWeddingCodeResearchObservation(missing, { ...context, now: instant }), expectGuidance);
  const f = fixture({ observations: [missing] });
  await assert.rejects(f.run(), expectGuidance);
  assert.equal(f.calls.length, 1); assert.equal(f.closed, true);
  assert.deepEqual([f.events.at(-1).status, f.events.at(-1).code, f.events.at(-1).retryProhibited],
    ['blocked-before-mutation', 'WEDDING_CODE_RESEARCH_PREDECESSOR_NOT_APPLIED', false]);
  const mismatch = { ...before(), predecessor: { ...before().predecessor, sqlMd5: 'd'.repeat(32) } };
  assert.throws(() => validateWeddingCodeResearchObservation(mismatch, { ...context, now: instant }), error =>
    error.code === 'WEDDING_CODE_RESEARCH_PREDECESSOR_LEDGER_MISMATCH' && !error.message.includes('--apply'));
});

test('rehearsal failure, rollback drift, stale source, deadline or receipt failure cannot reach the commit call', async () => {
  let time = instant;
  for (const options of [
    { onQuery: (_text, call) => { if (call === 2) throw new Error('synthetic timeout'); } },
    { observations: [before(), { ...before(), ledgerCount: 224 }] },
    { observations: [before(), { ...before(), preservedCatalogSha: '1'.repeat(32) }] },
    { onSource: count => { if (count === 2) throw new Error('synthetic dirty source'); } },
    { onRecord: event => { if (event.status === 'apply-outcome-unverified') throw new Error('synthetic disk full'); } },
    { now: () => time, onRecord: event => { if (event.status === 'rehearsed-and-rolled-back') time = new Date(instant.getTime() + 120_001); } },
  ]) {
    time = instant;
    const f = fixture(options);
    await assert.rejects(f.run(), code('WEDDING_CODE_RESEARCH_OUTCOME_REQUIRES_INSPECTION'));
    assert.ok(f.calls.length <= 3);
    assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
    assert.equal(f.closed, true);
  }
});

test('an ambiguous commit is never retried and a postcheck drift is never labelled success', async () => {
  const ambiguous = fixture({ onQuery: (_text, call) => { if (call === 4) throw new Error('response lost after synthetic commit'); } });
  await assert.rejects(ambiguous.run(), code('WEDDING_CODE_RESEARCH_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(ambiguous.calls.length, 4); assert.equal(ambiguous.events.at(-1).retryProhibited, true);
  for (const observed of [{ ...after(), preservedCatalogSha: '1'.repeat(32) }, { ...after(), ledgerCount: 225 },
    withRelation(after(), { acl: [...after().catalog.relations[0].acl, ['service_role', 'postgres', 'SELECT', false]] })]) {
    const f = fixture({ observations: [before(), before(), observed] });
    await assert.rejects(f.run(), code('WEDDING_CODE_RESEARCH_OUTCOME_REQUIRES_INSPECTION'));
    assert.equal(f.calls.length, 5);
    assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
  }
});

test('receipt writes short chunks completely before fsync and refuses zero progress', () => {
  const value = { status: 'apply-outcome-unverified', detail: '합성 기록' }, written = []; let flushed = 0;
  appendWeddingCodeResearchReceipt(7, value, { write: (_fd, bytes, offset, length) => { const count = Math.min(3, length);
    written.push(bytes.subarray(offset, offset + count)); return count; }, flush: () => { flushed += 1; } });
  assert.equal(Buffer.concat(written).toString(), `${JSON.stringify(value)}\n`); assert.equal(flushed, 1);
  for (const invalid of [0, -1, undefined, Infinity])
    assert.throws(() => appendWeddingCodeResearchReceipt(7, value, { write: () => invalid, flush: () => { throw new Error('unexpected flush'); } }),
      code('WEDDING_CODE_RESEARCH_RECEIPT_WRITE_INCOMPLETE'));
});

// 합성 PGlite(PostgreSQL 18)에서 실제 catalog 관측식과 적용 묶음을 돌린다. 운영 식별값·버전 범위 검사만 로컬 값으로 바꾼다.
test('the real catalog query and bundle rehearse, roll back and commit exactly the reviewed objects on a local PostgreSQL', { timeout: 120_000 }, async () => {
  const { PGlite } = createRequire(join(root, 'apps/web/package.json'))('@electric-sql/pglite');
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
      CREATE TABLE public.unrelated_rows(id int PRIMARY KEY, note text); INSERT INTO public.unrelated_rows VALUES (1, 'synthetic preserved');
      CREATE FUNCTION public.unrelated_helper() RETURNS int LANGUAGE sql AS 'SELECT 1';
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    await db.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260915101500','amora_atomic_not_applicable_status',ARRAY[$1]::text[])", [predecessorSql]);
    const observe = async () => (await db.exec(buildWeddingCodeResearchObservationSql())).flatMap(r => r.rows ?? []).find(row => row.observation).observation;
    const local = await observe();
    assert.deepEqual(local.catalog, { relations: [], functions: [] });
    assert.equal(local.migration, null); assert.equal(local.ledgerSha, local.ledgerWithoutTargetSha);
    assert.deepEqual(local.predecessor, before().predecessor);
    assert.match(local.preservedCatalogSha, /^[a-f0-9]{32}$/);
    const localize = text => text.replace(`<>'7581440907192989109'`, `<>'${local.systemIdentifier}'`)
      .replace('NOT BETWEEN 170000 AND 179999', 'NOT BETWEEN 170000 AND 189999');
    const deadline = new Date(Date.now() + 60_000).toISOString();
    await db.exec(localize(buildWeddingCodeResearchMutationSql({ sql, before: local, deadline, rehearsal: true })));
    const rolledBack = await observe();
    for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerCount', 'migration']) assert.deepEqual(rolledBack[key], local[key]);
    await db.exec('CREATE FUNCTION public.concurrent_helper() RETURNS int LANGUAGE sql AS \'SELECT 2\'');
    await assert.rejects(db.exec(localize(buildWeddingCodeResearchMutationSql({ sql, before: local, deadline, rehearsal: false }))),
      /WEDDING_CODE_RESEARCH_BASELINE_DRIFT/);
    await db.exec('ROLLBACK').catch(() => undefined);
    await db.exec('DROP FUNCTION public.concurrent_helper()');
    await db.exec(localize(buildWeddingCodeResearchMutationSql({ sql, before: local, deadline, rehearsal: false })));
    const applied = await observe();
    validateWeddingCodeResearchCatalog(applied.catalog, sql, true);
    assert.equal(applied.preservedCatalogSha, local.preservedCatalogSha);
    assert.deepEqual(applied.migration, after().migration);
    assert.equal(applied.ledgerWithoutTargetSha, local.ledgerSha); assert.equal(Number(applied.ledgerCount), Number(local.ledgerCount) + 1);
    assert.deepEqual((await db.query('SELECT * FROM public.unrelated_rows')).rows, [{ id: 1, note: 'synthetic preserved' }]);
    await db.exec('GRANT SELECT ON public.wedding_code_research_deletion_tombstones TO anon');
    const drifted = (await db.query(`SELECT ${weddingCodeResearchTargetCatalogSql()} AS value`)).rows[0].value;
    assert.throws(() => validateWeddingCodeResearchCatalog(drifted, sql, true), code('WEDDING_CODE_RESEARCH_TARGET_CATALOG_DRIFT'));
    assert.match(weddingCodeResearchPreservedCatalogSql(), /pg_get_functiondef/);
  } finally { await db.close(); }
});
