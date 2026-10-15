import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BASE_COMMIT, FIXTURE, loadPlan, MANIFEST, MIGRATION, parseArgs, PINNED_FILES, RELEASE,
  runRelease, validateObservation } from '../wedding-code36-release.mjs';
import { buildMutationSql, buildObservationSql, MIGRATION_VERSION, PROJECT_REF, SYSTEM_IDENTIFIER,
  unwrapMigration } from '../wedding-code36-release-catalog.mjs';
import { prepareManifest } from '../wedding-code36-release-prepare.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const now = new Date('2026-10-15T09:00:00.000Z');
const commit = 'a'.repeat(40);
const hash = ch => ch.repeat(32);
const argv = mode => [`--${mode}`, `--expected-commit=${commit}`, `--project-ref=${PROJECT_REF}`,
  `--receipt-out=${resolve(tmpdir(), `wc36-${mode}-test-receipt.jsonl`)}`,
  `--confirm-production=${RELEASE}:${PROJECT_REF}:${mode}:${commit}`];

function repoFixture() {
  const dir = mkdtempSync(resolve(tmpdir(), 'wc36-release-unit-'));
  for (const file of PINNED_FILES) {
    mkdirSync(dirname(resolve(dir, file)), { recursive: true });
    writeFileSync(resolve(dir, file), readFileSync(resolve(sourceRoot, file)));
  }
  const refresh = () => writeFileSync(resolve(dir, MANIFEST), `${JSON.stringify(prepareManifest(dir), null, 2)}\n`);
  refresh(); return { dir, refresh, close() { rmSync(dir, { recursive: true, force: true }); } };
}
function observation(plan, applied = false) {
  return { format: 'wedding-code36-catalog-v1', identityReady: true, readOnly: true,
    systemIdentifier: SYSTEM_IDENTIFIER, serverVersion: '17.6', database: 'postgres', currentUser: 'postgres',
    observedAt: now.toISOString(), catalog: applied ? plan.catalog : { relations: [], functions: [] },
    preservedCatalogSha: hash('1'), ledgerSha: hash(applied ? '3' : '2'), ledgerWithoutTargetSha: hash('2'),
    ledgerCount: applied ? 250 : 249, ledgerHead: applied ? MIGRATION_VERSION : '20261013000000',
    migration: applied ? { version: MIGRATION_VERSION, name: 'wedding_code36_private_pairing', statementCount: 1,
      sqlMd5: createHash('md5').update(plan.sql).digest('hex') } : null };
}
function harness(repo, overrides = {}) {
  const plan = loadPlan(repo.dir), records = [], calls = []; let applied = false;
  const options = { repoRoot: repo.dir, now: () => now, source: () => {},
    receiptFactory: () => ({ append: r => records.push(r), close() {} }),
    query: async (sql, opts) => {
      calls.push({ sql, ...opts });
      if (opts.readOnly) return [{ observation: observation(plan, applied) }];
      if (sql.endsWith('COMMIT;')) applied = true;
      return [];
    }, ...overrides };
  return { plan, records, calls, options };
}

test('arguments bind mode, production project, exact source and explicit confirmation', () => {
  assert.equal(parseArgs(argv('apply')).mode, 'apply');
  const bad = [[], argv('apply').slice(0, -1), [...argv('apply'), '--inspect'],
    argv('apply').map(s => s.replace(PROJECT_REF, 'another-project')), [...argv('apply'), '--unknown=yes'],
    argv('apply').map(s => s.replace(`--expected-commit=${commit}`, '--expected-commit=main')),
    [...argv('inspect'), '--baseline-receipt=/tmp/not-allowed'], argv('verify')];
  for (const args of bad) assert.throws(() => parseArgs(args));
});

test('manifest pins exactly reviewed SQL, runtime, catalog, fixture and local preparation source', () => {
  const repo = repoFixture();
  try {
    assert.equal(loadPlan(repo.dir).manifest.baseCommit, BASE_COMMIT);
    writeFileSync(resolve(repo.dir, MIGRATION), `${readFileSync(resolve(repo.dir, MIGRATION), 'utf8')}\n-- changed\n`);
    assert.throws(() => loadPlan(repo.dir), /WC36_ARTIFACT_HASH_MISMATCH/u);
  } finally { repo.close(); }
});

test('repinning cannot admit top-level customer row mutations or extra tables', () => {
  const repo = repoFixture();
  try {
    const sql = readFileSync(resolve(repo.dir, MIGRATION), 'utf8');
    writeFileSync(resolve(repo.dir, MIGRATION), `${sql}\nDELETE FROM public.profiles;\n`); repo.refresh();
    assert.throws(() => loadPlan(repo.dir), /WC36_TOP_LEVEL_DML_FORBIDDEN/u);
    writeFileSync(resolve(repo.dir, MIGRATION), `${sql}\nCREATE TABLE public.unrelated(value text);\n`); repo.refresh();
    assert.throws(() => loadPlan(repo.dir), /WC36_DDL_TABLE_SCOPE_INVALID/u);
  } finally { repo.close(); }
});

test('inspect uses only read-only observation and reports absence rather than deployment readiness', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo), result = await runRelease({ ...h.options, argv: argv('inspect') });
    assert.equal(result.status, 'inspected-new-objects-absent'); assert.equal(result.remoteWritesPerformed, false);
    assert.deepEqual(h.calls.map(c => c.readOnly), [true]);
    assert.match(h.records[1].backupScope, /metadata-only/u);
    assert.equal(h.records[1].observation.catalog.relations.length, 0);
  } finally { repo.close(); }
});

test('source or preflight identity failure blocks before any mutation', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo, { source() { throw new Error('WC36_SOURCE_NOT_CLEAN_EXACT_COMMIT'); } });
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /WC36_SOURCE_NOT_CLEAN_EXACT_COMMIT/u);
    assert.equal(h.calls.length, 0);
    const h2 = harness(repo, { query: async () => [{ observation: { ...observation(loadPlan(repo.dir)), identityReady: false } }] });
    await assert.rejects(runRelease({ ...h2.options, argv: argv('apply') }), /WC36_OBSERVATION_INVALID/u);
    assert.equal(h2.records.at(-1).status, 'blocked-before-mutation');
  } finally { repo.close(); }
});

test('stale observation, wrong system, nonempty unledgered objects and mismatched SQL are rejected', () => {
  const repo = repoFixture();
  try {
    const plan = loadPlan(repo.dir), base = observation(plan);
    for (const value of [
      { ...base, observedAt: new Date(now.getTime() - 120001).toISOString() },
      { ...base, systemIdentifier: 'wrong' }, { ...base, serverVersion: '18.6' },
      { ...base, catalog: { ...base.catalog, relations: [{ name: 'public.wedding_code36_responses' }] } },
      { ...observation(plan, true), migration: { ...observation(plan, true).migration, sqlMd5: hash('9') } },
    ]) assert.throws(() => validateObservation(value, plan, now));
  } finally { repo.close(); }
});

test('apply rehearses and proves rollback before the single durable transaction and post-verification', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo), result = await runRelease({ ...h.options, argv: argv('apply') });
    assert.equal(result.status, 'applied-and-postverified'); assert.equal(result.remoteWritesPerformed, true);
    assert.deepEqual(h.calls.map(c => c.readOnly), [true, false, true, false, true]);
    assert.ok(h.calls[1].sql.endsWith('ROLLBACK;')); assert.ok(h.calls[3].sql.endsWith('COMMIT;'));
    assert.match(h.calls[3].sql, /LOCK TABLE supabase_migrations\.schema_migrations/u);
    assert.match(h.calls[3].sql, /WC36_BASELINE_DRIFT/u); assert.match(h.calls[3].sql, /WC36_AFTER_DRIFT/u);
    assert.equal(h.records.at(-1).status, 'applied-and-postverified');
    assert.ok(h.records.findIndex(r => r.status === 'apply-outcome-unverified') < h.records.findIndex(r => r.status === 'applied-and-postverified'));
  } finally { repo.close(); }
});

test('rehearsal is temporary DDL followed by proven rollback and never commits', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo), result = await runRelease({ ...h.options, argv: argv('rehearse') });
    assert.equal(result.remoteWritesPerformed, false); assert.equal(result.temporaryTransactionalWritesPerformed, true);
    assert.deepEqual(h.calls.map(c => c.readOnly), [true, false, true]);
    assert.equal(h.calls.filter(c => !c.readOnly && c.sql.endsWith('COMMIT;')).length, 0);
  } finally { repo.close(); }
});

test('ambiguous management response never retries and preserves adjudication record', async () => {
  const repo = repoFixture();
  try {
    let mutations = 0; const plan = loadPlan(repo.dir);
    const h = harness(repo, { query: async (_sql, opts) => {
      if (opts.readOnly) return [{ observation: observation(plan) }]; mutations++; throw new Error('network timeout');
    } });
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /WC36_OUTCOME_REQUIRES_READONLY_INSPECTION/u);
    assert.equal(mutations, 1); assert.equal(h.records.at(-1).retryProhibited, true);
    assert.equal(h.records.at(-1).status, 'outcome-requires-readonly-inspection');
  } finally { repo.close(); }
});

test('rehearsal baseline drift prevents durable apply', async () => {
  const repo = repoFixture();
  try {
    const plan = loadPlan(repo.dir); let reads = 0, writes = 0;
    const h = harness(repo, { query: async (_sql, opts) => {
      if (!opts.readOnly) { writes++; return []; }
      const value = observation(plan); if (++reads > 1) value.preservedCatalogSha = hash('9');
      return [{ observation: value }];
    } });
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /WC36_OUTCOME_REQUIRES_READONLY_INSPECTION/u);
    assert.equal(writes, 1); assert.ok(!h.records.some(r => r.status === 'apply-outcome-unverified'));
  } finally { repo.close(); }
});

test('verify compares fresh applied catalog with private source-bound absent-object baseline without writes', async () => {
  const repo = repoFixture();
  try {
    const h1 = harness(repo); await runRelease({ ...h1.options, argv: argv('apply') });
    const h2 = harness(repo, { query: async () => [{ observation: observation(h1.plan, true) }],
      baselineReader: () => h1.records.map(r => JSON.stringify(r)).join('\n') });
    const args = [...argv('verify'), `--baseline-receipt=${resolve(tmpdir(), 'wc36-baseline.jsonl')}`];
    const result = await runRelease({ ...h2.options, argv: args });
    assert.equal(result.status, 'applied-and-readonly-postverified'); assert.equal(result.remoteWritesPerformed, false);
    assert.equal(h2.records.at(-1).status, 'applied-and-readonly-postverified');
    const h3 = harness(repo, { query: async () => [{ observation: observation(h1.plan, true) }], baselineReader: () => '{}' });
    await assert.rejects(runRelease({ ...h3.options, argv: args }), /WC36_BASELINE_RECEIPT_BINDING_INVALID/u);
  } finally { repo.close(); }
});

test('SQL envelope guards cannot accept nested transaction statements or fabricated preflight', () => {
  assert.equal(unwrapMigration('BEGIN;\nSELECT 1;\nCOMMIT;\n'), 'SELECT 1;\n');
  assert.throws(() => unwrapMigration('ROLLBACK;\nSELECT 1;'), /WC36_SQL_TRANSACTION_BOUNDARY_INVALID/u);
  assert.throws(() => buildMutationSql({ sql: 'SELECT 1;', before: {}, catalog: {}, deadline: now.toISOString(), rehearsal: true }));
  const sql = buildObservationSql();
  assert.ok(sql.startsWith('BEGIN READ ONLY;')); assert.match(sql, /pg_control_system/u);
  assert.doesNotMatch(sql, /SELECT \* FROM public\.profiles/u);
});
