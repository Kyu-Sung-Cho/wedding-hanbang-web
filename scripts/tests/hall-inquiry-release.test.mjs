// 웨딩홀 문의 배포 길(scripts/hall-inquiry-release*.mjs) 시험.
// 앞 절반은 36문항 길 시험(wedding-code36-release.test.mjs)을 그대로 옮겼다. 관측에는 missingPrerequisites 와
// catalog.existingTableTriggers 가 더 실린다. 뒤 절반은 이 길에만 있는 것(기존 표 트리거 하나, 선행 객체 확인,
// 머리 주석 뒤 BEGIN;)을 실제 PostgreSQL 엔진에서 본다. PGlite 는 늘 돌고, PostgreSQL 17 은 이 컴퓨터에 있을 때만 돈다.
// 운영 접속은 없다.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BASE_COMMIT, EXISTING_TRIGGER_NAMES, FIXTURE, loadPlan, MANIFEST, MIGRATION, parseArgs, PINNED_FILES, RELEASE,
  runRelease, validateObservation, validateSourceChanges } from '../hall-inquiry-release.mjs';
import { aggregate, buildMutationSql, buildObservationSql, missingPrerequisitesSql, MIGRATION_NAME, MIGRATION_VERSION,
  preservedCatalogSql, PREREQUISITES, PROJECT_REF, SYSTEM_IDENTIFIER, TABLES, targetCatalogSql, targetIdentitySql,
  topLevelStatements, unwrapMigration } from '../hall-inquiry-release-catalog.mjs';
import { buildFixture, openPglite, preparePrerequisites, readTargetCatalog, serializeFixture } from '../hall-inquiry-release-fixture.mjs';
import { prepareManifest } from '../hall-inquiry-release-prepare.mjs';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './fixtures/profile-role-native-database.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const now = new Date('2026-11-18T09:00:00.000Z');
const commit = 'a'.repeat(40);
const hash = ch => ch.repeat(32);
const md5 = value => createHash('md5').update(value).digest('hex');
const emptyTarget = () => ({ relations: [], functions: [], existingTableTriggers: [] });
const realSql = readFileSync(resolve(sourceRoot, MIGRATION), 'utf8');
const pinnedFixtureText = readFileSync(resolve(sourceRoot, FIXTURE), 'utf8');
const pinnedCatalog = JSON.parse(pinnedFixtureText).catalog;
const argv = mode => [`--${mode}`, `--expected-commit=${commit}`, `--project-ref=${PROJECT_REF}`,
  `--receipt-out=${resolve(tmpdir(), `hiq-${mode}-test-receipt.jsonl`)}`,
  `--confirm-production=${RELEASE}:${PROJECT_REF}:${mode}:${commit}`];

function repoFixture() {
  const dir = mkdtempSync(resolve(tmpdir(), 'hiq-release-unit-'));
  for (const file of PINNED_FILES) {
    mkdirSync(dirname(resolve(dir, file)), { recursive: true });
    writeFileSync(resolve(dir, file), readFileSync(resolve(sourceRoot, file)));
  }
  const refresh = () => writeFileSync(resolve(dir, MANIFEST), `${JSON.stringify(prepareManifest(dir), null, 2)}\n`);
  refresh(); return { dir, refresh, close() { rmSync(dir, { recursive: true, force: true }); } };
}
// 검토한 파일은 마지막 줄이 COMMIT; 이다. 심는 문장은 그 바로 앞에 넣는다.
function beforeCommit(sql, statement) {
  assert.ok(sql.endsWith('\nCOMMIT;\n'));
  return `${sql.slice(0, -'COMMIT;\n'.length)}${statement}\nCOMMIT;\n`;
}
function observation(plan, applied = false) {
  return { format: 'hall-inquiry-catalog-v1', identityReady: true, readOnly: true,
    systemIdentifier: SYSTEM_IDENTIFIER, serverVersion: '17.6', database: 'postgres', currentUser: 'supabase_read_only_user',
    observedAt: now.toISOString(), catalog: applied ? plan.catalog : emptyTarget(), missingPrerequisites: [],
    preservedCatalogSha: hash('1'), ledgerSha: hash(applied ? '3' : '2'), ledgerWithoutTargetSha: hash('2'),
    ledgerCount: applied ? 250 : 249, ledgerHead: applied ? MIGRATION_VERSION : '20261116000000',
    migration: applied ? { version: MIGRATION_VERSION, name: MIGRATION_NAME, statementCount: 1, sqlMd5: md5(plan.sql) } : null };
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
const hasCode = code => error => error?.code === code || error?.message === code;

test('arguments bind mode, production project, exact source and explicit confirmation', () => {
  assert.equal(parseArgs(argv('apply')).mode, 'apply');
  const confirm = mode => `--confirm-production=${RELEASE}:${PROJECT_REF}:${mode}:${commit}`;
  for (const [args, code] of [
    [[], 'HIQ_ARGUMENT_REQUIRED'],
    [argv('apply').slice(0, -1), 'HIQ_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED'],
    [[...argv('apply').slice(0, -1), confirm('rehearse')], 'HIQ_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED'],
    [[...argv('apply').slice(0, -1), `--confirm-production=wedding-code36-20261015:${PROJECT_REF}:apply:${commit}`],
      'HIQ_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED'],
    [[...argv('apply'), '--inspect'], 'HIQ_MODE_DUPLICATE'],
    [argv('apply').map(s => s.replace(PROJECT_REF, 'another-project')), 'HIQ_ARGUMENT_REQUIRED'],
    [[...argv('apply'), '--unknown=yes'], 'HIQ_ARGUMENT_INVALID'],
    [argv('apply').map(s => s.replace(`--expected-commit=${commit}`, '--expected-commit=main')), 'HIQ_ARGUMENT_REQUIRED'],
    [argv('apply').map(s => (s.startsWith('--receipt-out=') ? '--receipt-out=relative-receipt.jsonl' : s)), 'HIQ_ARGUMENT_REQUIRED'],
    [[...argv('inspect'), '--baseline-receipt=/tmp/not-allowed'], 'HIQ_BASELINE_ARGUMENT_INVALID'],
    [argv('verify'), 'HIQ_BASELINE_RECEIPT_REQUIRED'],
  ]) assert.throws(() => parseArgs(args), hasCode(code), args.join(' '));
});

test('unrelated future application changes may run the static gate while runtime release scope stays narrow', () => {
  const future = ['apps/web/next.config.ts', 'supabase/migrations/20990101000000_unreviewed.sql'];
  assert.doesNotThrow(() => validateSourceChanges(future, { staticOnly: true }));
  assert.throws(() => validateSourceChanges(future), /HIQ_SOURCE_SCOPE_DRIFT/u);
  assert.doesNotThrow(() => validateSourceChanges([MIGRATION, 'apps/web/src/lib/invitation/inquiryRpc.ts', FIXTURE,
    'scripts/hall-inquiry-release.mjs', 'scripts/tests/hall-inquiry-release.test.mjs']));
  // 이 길의 SQL 이 없는 운영 반영, 다른 SQL·다른 배포 길 원문이 섞인 운영 반영은 받지 않는다.
  for (const changed of [[], ['apps/web/src/lib/invitation/inquiryRpc.ts'], [MIGRATION, ...future.slice(0, 1)],
    [MIGRATION, future[1]], [MIGRATION, 'scripts/wedding-code36-release.mjs'],
    [MIGRATION, 'supabase/release-contracts/wedding-code36-v1.json']]) {
    assert.throws(() => validateSourceChanges(changed), /HIQ_SOURCE_SCOPE_DRIFT/u, changed.join(' '));
  }
  assert.throws(() => validateSourceChanges('apps/web/src/proxy.ts'), /HIQ_SOURCE_SCOPE_ARGUMENT_INVALID/u);
});

test('canonical SQL aggregation preserves column metadata while removing the observed locale ordering difference', async () => {
  const db = await openPglite(sourceRoot);
  try {
    const expected = pinnedCatalog.relations.find(r => r.name === 'public.hall_inquiry_letter_versions').columns;
    const actual = structuredClone(expected);
    [actual[0], actual[1]] = [actual[1], actual[0]];
    assert.notDeepEqual(actual, expected);
    const sql = `SELECT ${aggregate('SELECT value AS v FROM jsonb_array_elements($1::jsonb)')} AS columns`;
    const normalized = await db.query(sql, [JSON.stringify(actual)]);
    assert.deepEqual(normalized.rows[0].columns, expected);
    actual[0][2] = !actual[0][2];
    const changedConstraint = await db.query(sql, [JSON.stringify(actual)]);
    assert.notDeepEqual(changedConstraint.rows[0].columns, expected);
  } finally { await db.close(); }
});

test('manifest pins exactly reviewed SQL, runtime, catalog, fixture builder, build contract and predecessor snapshot', () => {
  const repo = repoFixture();
  try {
    const plan = loadPlan(repo.dir);
    assert.equal(plan.manifest.baseCommit, BASE_COMMIT);
    assert.deepEqual(plan.manifest.scope.existingTableTriggers, ['public.account_deletion_jobs.trg_hall_inquiry_account_deletion']);
    for (const file of PINNED_FILES) {
      const bytes = readFileSync(resolve(repo.dir, file));
      writeFileSync(resolve(repo.dir, file), Buffer.concat([bytes, Buffer.from('\n-- changed\n')]));
      assert.throws(() => loadPlan(repo.dir), hasCode('HIQ_ARTIFACT_HASH_MISMATCH'), file);
      writeFileSync(resolve(repo.dir, file), bytes);
    }
    assert.doesNotThrow(() => loadPlan(repo.dir));
    const manifest = JSON.parse(readFileSync(resolve(repo.dir, MANIFEST), 'utf8'));
    for (const [value, code] of [
      [{ ...manifest, runtimeEvidenceVerified: true }, 'HIQ_MANIFEST_CONTRACT_INVALID'],
      [{ ...manifest, migrationName: 'wedding_code36_private_pairing' }, 'HIQ_MANIFEST_CONTRACT_INVALID'],
      [{ ...manifest, newRows: 'seeded' }, 'HIQ_MANIFEST_CONTRACT_INVALID'],
      [{ ...manifest, scope: { ...manifest.scope, existingTableTriggers: [] } }, 'HIQ_MANIFEST_SCOPE_INVALID'],
      [{ ...manifest, scope: { ...manifest.scope, existingTables: 'unchanged' } }, 'HIQ_MANIFEST_SCOPE_INVALID'],
      [{ ...manifest, artifacts: manifest.artifacts.slice(1) }, 'HIQ_ARTIFACT_SET_INVALID'],
    ]) {
      writeFileSync(resolve(repo.dir, MANIFEST), `${JSON.stringify(value, null, 2)}\n`);
      assert.throws(() => loadPlan(repo.dir), hasCode(code), code);
    }
  } finally { repo.close(); }
});

test('repinning cannot admit top-level customer row mutations, extra objects or changes to existing tables', () => {
  const repo = repoFixture();
  try {
    const sql = readFileSync(resolve(repo.dir, MIGRATION), 'utf8');
    const rejected = (changed, code) => {
      writeFileSync(resolve(repo.dir, MIGRATION), changed); repo.refresh();
      assert.throws(() => loadPlan(repo.dir), hasCode(code), changed.slice(-200));
    };
    // 검토한 원문에는 정책의 WITH CHECK 줄이 있다. 줄 머리가 아니라 문장 머리를 보므로 그대로 받는다.
    assert.match(sql, /^\s+WITH CHECK \(/mu);
    assert.doesNotThrow(() => loadPlan(repo.dir));
    for (const statement of ['DELETE FROM public.profiles;', 'UPDATE public.couples SET bride_id = NULL;',
      'INSERT INTO public.hall_listings DEFAULT VALUES;', 'TRUNCATE public.account_deletion_jobs;',
      'DROP TABLE public.couple_change_notifications;', 'DO $x$ BEGIN PERFORM 1; END $x$;',
      'MERGE INTO public.profiles AS p USING public.couples AS c ON false WHEN NOT MATCHED THEN DO NOTHING;',
      // 줄 가운데 문장과 데이터를 바꾸는 CTE, 준비문, 소유권 넘기기도 문장 머리로 잡는다.
      'WITH gone AS (DELETE FROM public.profiles RETURNING 1) SELECT 1;', 'SELECT 1; DELETE FROM public.profiles;',
      'PREPARE wipe AS DELETE FROM public.profiles;', 'EXECUTE wipe;', 'REASSIGN OWNED BY anon TO postgres;']) {
      rejected(beforeCommit(sql, statement), 'HIQ_TOP_LEVEL_DML_FORBIDDEN');
    }
    rejected(beforeCommit(sql, 'CREATE TABLE public.unrelated(value text);'), 'HIQ_DDL_TABLE_SCOPE_INVALID');
    rejected(beforeCommit(sql, 'CREATE FUNCTION public.unrelated() RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$;'),
      'HIQ_DDL_FUNCTION_SCOPE_INVALID');
    for (const statement of [
      'CREATE TRIGGER trg_unrelated AFTER INSERT ON public.couples FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_notify();',
      'CREATE TRIGGER trg_hall_inquiry_second AFTER DELETE ON public.account_deletion_jobs FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_purge_for_account_deletion();',
      'ALTER TABLE public.profiles ADD COLUMN unrelated text;',
      'CREATE POLICY unrelated_read ON public.couples FOR SELECT USING (true);',
      'CREATE INDEX unrelated_idx ON public.profiles(couple_id);',
    ]) rejected(beforeCommit(sql, statement), 'HIQ_DDL_EXISTING_TABLE_SCOPE_INVALID');
    // 목록의 트리거를 빼도 받지 않는다. 기존 표에 다는 것은 정확히 그 하나다.
    const listedTrigger = 'CREATE TRIGGER trg_hall_inquiry_account_deletion\n  AFTER INSERT OR UPDATE OF user_id, status ON public.account_deletion_jobs\n  FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_purge_for_account_deletion();\n';
    assert.equal(sql.split(listedTrigger).length, 2);
    rejected(sql.replace(listedTrigger, ''), 'HIQ_DDL_EXISTING_TABLE_SCOPE_INVALID');
    rejected(beforeCommit(sql, 'SAVEPOINT before_customer_rows;'), 'HIQ_SQL_TRANSACTION_BOUNDARY_INVALID');
    rejected(beforeCommit(sql, 'COMMIT;\nBEGIN;'), 'HIQ_SQL_TRANSACTION_BOUNDARY_INVALID');
    rejected(sql.replaceAll('\n', '\r\n'), 'HIQ_MIGRATION_ENCODING_INVALID');
    // 정적 검사를 다 통과한 다른 원문이어도 catalog 고정 파일은 원래 SQL 의 hash 에 묶여 있다.
    rejected(`-- 다시 검토함\n${sql}`, 'HIQ_FIXTURE_INVALID');
  } finally { repo.close(); }
});

test('a repinned catalog fixture cannot open new objects to anon or PUBLIC, drop RLS or lose the search_path pin', () => {
  const repo = repoFixture();
  try {
    const original = JSON.parse(readFileSync(resolve(repo.dir, FIXTURE), 'utf8'));
    const rejected = (mutate, code, label) => {
      const value = structuredClone(original); mutate(value.catalog);
      writeFileSync(resolve(repo.dir, FIXTURE), serializeFixture(value)); repo.refresh();
      assert.throws(() => loadPlan(repo.dir), hasCode(code), label);
    };
    const privileges = 'HIQ_FIXTURE_PRIVILEGES_INVALID';
    rejected(c => c.relations[0].acl.push(['anon', 'postgres', 'SELECT', false]), privileges, 'table grant to anon');
    rejected(c => c.relations[0].acl.push(['PUBLIC', 'postgres', 'SELECT', false]), privileges, 'table grant to PUBLIC');
    rejected(c => c.relations[0].columns[0][6].push(['anon', 'postgres', 'SELECT', false]), privileges, 'column grant to anon');
    rejected(c => { c.relations[0].policies[0].roles = ['anon']; }, privileges, 'policy for anon');
    rejected(c => { c.relations[0].policies[0].roles = null; }, privileges, 'policy for every role');
    rejected(c => { c.relations[0].rls = false; }, privileges, 'RLS off');
    rejected(c => { c.relations[0].owner = 'service_role'; }, privileges, 'table owner');
    rejected(c => c.functions[0].acl.push(['PUBLIC', 'postgres', 'EXECUTE', false]), privileges, 'function grant to PUBLIC');
    rejected(c => { c.functions[0].config = null; }, privileges, 'function without search_path');
    rejected(c => { c.functions[0].owner = 'authenticated'; }, privileges, 'function owner');
    rejected(c => { c.existingTableTriggers[0][2] = 'D'; }, 'HIQ_FIXTURE_EXISTING_TRIGGERS_INVALID', 'disabled trigger');
    rejected(c => { c.existingTableTriggers = []; }, 'HIQ_FIXTURE_EXISTING_TRIGGERS_INVALID', 'no trigger');
    rejected(c => { c.relations.pop(); }, 'HIQ_FIXTURE_TABLES_INVALID', 'missing table');
    rejected(c => { c.functions.pop(); }, 'HIQ_FIXTURE_FUNCTIONS_INVALID', 'missing function');
    rejected(c => { delete c.existingTableTriggers; }, 'HIQ_FIXTURE_INVALID', '36-question catalog shape');
  } finally { repo.close(); }
});

test('inspect uses only read-only observation and reports absence rather than deployment readiness', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo), result = await runRelease({ ...h.options, argv: argv('inspect') });
    assert.equal(result.status, 'inspected-new-objects-absent'); assert.equal(result.remoteWritesPerformed, false);
    assert.deepEqual(h.calls.map(c => c.readOnly), [true]);
    assert.match(h.records[1].backupScope, /metadata-only/u);
    assert.deepEqual(h.records[1].observation.catalog, emptyTarget());
    assert.deepEqual(h.records[1].observation.missingPrerequisites, []);
  } finally { repo.close(); }
});

test('source or preflight identity failure blocks before any mutation', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo, { source() { throw new Error('HIQ_SOURCE_NOT_CLEAN_EXACT_COMMIT'); } });
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /HIQ_SOURCE_NOT_CLEAN_EXACT_COMMIT/u);
    assert.equal(h.calls.length, 0);
    const h2 = harness(repo, { query: async () => [{ observation: { ...observation(loadPlan(repo.dir)), identityReady: false } }] });
    await assert.rejects(runRelease({ ...h2.options, argv: argv('apply') }), /HIQ_OBSERVATION_INVALID/u);
    assert.equal(h2.records.at(-1).status, 'blocked-before-mutation');
    const h3 = harness(repo, { query: async () => [{ observation: { ...observation(loadPlan(repo.dir)),
      missingPrerequisites: ['column:public.account_deletion_jobs.status'] } }] });
    await assert.rejects(runRelease({ ...h3.options, argv: argv('apply') }), /HIQ_PREREQUISITE_MISSING/u);
    assert.equal(h3.records.at(-1).status, 'blocked-before-mutation'); assert.equal(h3.records.at(-1).code, 'HIQ_PREREQUISITE_MISSING');
  } finally { repo.close(); }
});

test('stale observation, wrong system, missing prerequisites, unledgered objects and mismatched SQL are rejected', () => {
  const repo = repoFixture();
  try {
    const plan = loadPlan(repo.dir), base = observation(plan), applied = observation(plan, true);
    assert.doesNotThrow(() => validateObservation(base, plan, now));
    assert.doesNotThrow(() => validateObservation(applied, plan, now));
    for (const [value, code] of [
      [{ ...base, observedAt: new Date(now.getTime() - 120001).toISOString() }, 'HIQ_OBSERVATION_EXPIRED'],
      [{ ...base, observedAt: new Date(now.getTime() + 10001).toISOString() }, 'HIQ_OBSERVATION_EXPIRED'],
      [{ ...base, systemIdentifier: 'wrong' }, 'HIQ_OBSERVATION_INVALID'], [{ ...base, serverVersion: '18.6' }, 'HIQ_OBSERVATION_INVALID'],
      [{ ...base, currentUser: 'postgres' }, 'HIQ_OBSERVATION_INVALID'], [{ ...base, currentUser: 'anon' }, 'HIQ_OBSERVATION_INVALID'],
      [{ ...base, readOnly: false }, 'HIQ_OBSERVATION_INVALID'], [{ ...base, missingPrerequisites: undefined }, 'HIQ_OBSERVATION_INVALID'],
      [{ ...base, missingPrerequisites: ['function:public.is_couple_member(uuid)'] }, 'HIQ_PREREQUISITE_MISSING'],
      [{ ...applied, missingPrerequisites: ['column:public.profiles.is_admin'] }, 'HIQ_PREREQUISITE_MISSING'],
      [{ ...base, catalog: { ...base.catalog, relations: [{ name: 'public.hall_listings' }] } }, 'HIQ_TARGET_OBJECTS_ALREADY_EXIST'],
      [{ ...base, catalog: { ...base.catalog, existingTableTriggers: [plan.catalog.existingTableTriggers[0]] } },
        'HIQ_TARGET_OBJECTS_ALREADY_EXIST'],
      [{ ...base, catalog: { relations: [], functions: [] } }, 'HIQ_TARGET_OBJECTS_ALREADY_EXIST'],
      [{ ...base, ledgerSha: hash('4') }, 'HIQ_LEDGER_CONFLICT'],
      [{ ...applied, migration: { ...applied.migration, sqlMd5: hash('9') } }, 'HIQ_APPLIED_LEDGER_CONFLICT'],
      [{ ...applied, migration: { ...applied.migration, name: 'wedding_code36_private_pairing' } }, 'HIQ_APPLIED_LEDGER_CONFLICT'],
      [{ ...applied, catalog: { ...applied.catalog, existingTableTriggers: [] } }, 'HIQ_APPLIED_CATALOG_DRIFT'],
    ]) assert.throws(() => validateObservation(value, plan, now), hasCode(code), code);
  } finally { repo.close(); }
});

test('apply rehearses and proves rollback before the single durable transaction and post-verification', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo), result = await runRelease({ ...h.options, argv: argv('apply') });
    assert.equal(result.status, 'applied-and-postverified'); assert.equal(result.remoteWritesPerformed, true);
    assert.deepEqual(h.calls.map(c => c.readOnly), [true, false, true, false, true]);
    assert.ok(h.calls[1].sql.endsWith('ROLLBACK;')); assert.ok(h.calls[3].sql.endsWith('COMMIT;'));
    const apply = h.calls[3].sql;
    assert.match(apply, /LOCK TABLE supabase_migrations\.schema_migrations/u);
    for (const code of ['HIQ_TARGET_DRIFT', 'HIQ_PREREQUISITE_MISSING', 'HIQ_BASELINE_DRIFT', 'HIQ_AFTER_DRIFT', 'HIQ_DEADLINE_EXPIRED']) {
      assert.ok(apply.includes(`RAISE EXCEPTION '${code}'`), code);
    }
    assert.match(apply, /current_user='postgres'/u);
    assert.match(apply, /has_table_privilege\(current_user,'supabase_migrations\.schema_migrations','INSERT'\)/u);
    // 새 표 여덟 개 모두 빈 채로 끝나야 한다(newRows: none).
    for (const table of TABLES) assert.ok(apply.includes(`OR EXISTS(SELECT 1 FROM public.${table})`), table);
    assert.ok(apply.includes(unwrapMigration(h.plan.sql)));
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
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /HIQ_OUTCOME_REQUIRES_READONLY_INSPECTION/u);
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
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /HIQ_OUTCOME_REQUIRES_READONLY_INSPECTION/u);
    assert.equal(writes, 1); assert.ok(!h.records.some(r => r.status === 'apply-outcome-unverified'));
  } finally { repo.close(); }
});

test('post-apply verification requires exactly one new ledger row on top of the unchanged baseline', async () => {
  const repo = repoFixture();
  try {
    const plan = loadPlan(repo.dir);
    for (const drift of [{ ledgerCount: 251 }, { ledgerWithoutTargetSha: hash('5') }, { preservedCatalogSha: hash('6') }]) {
      let applied = false;
      const h = harness(repo, { query: async (sql, opts) => {
        if (!opts.readOnly) { if (sql.endsWith('COMMIT;')) applied = true; return []; }
        return [{ observation: applied ? { ...observation(plan, true), ...drift } : observation(plan) }];
      } });
      await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /HIQ_OUTCOME_REQUIRES_READONLY_INSPECTION/u);
      assert.equal(h.records.at(-1).code, 'HIQ_POST_APPLY_UNVERIFIED', JSON.stringify(drift));
    }
  } finally { repo.close(); }
});

test('verify compares fresh applied catalog with private source-bound absent-object baseline without writes', async () => {
  const repo = repoFixture();
  try {
    const h1 = harness(repo); await runRelease({ ...h1.options, argv: argv('apply') });
    const h2 = harness(repo, { query: async () => [{ observation: observation(h1.plan, true) }],
      baselineReader: () => h1.records.map(r => JSON.stringify(r)).join('\n') });
    const args = [...argv('verify'), `--baseline-receipt=${resolve(tmpdir(), 'hiq-baseline.jsonl')}`];
    const result = await runRelease({ ...h2.options, argv: args });
    assert.equal(result.status, 'applied-and-readonly-postverified'); assert.equal(result.remoteWritesPerformed, false);
    assert.equal(h2.records.at(-1).status, 'applied-and-readonly-postverified');
    assert.ok(h2.calls.every(c => c.readOnly));
    const h3 = harness(repo, { query: async () => [{ observation: observation(h1.plan, true) }], baselineReader: () => '{}' });
    await assert.rejects(runRelease({ ...h3.options, argv: args }), /HIQ_BASELINE_RECEIPT_BINDING_INVALID/u);
  } finally { repo.close(); }
});

test('SQL envelope guards cannot accept nested transaction statements or fabricated preflight', () => {
  assert.equal(unwrapMigration('BEGIN;\nSELECT 1;\nCOMMIT;\n'), 'SELECT 1;\n');
  assert.throws(() => unwrapMigration('ROLLBACK;\nSELECT 1;'), /HIQ_SQL_TRANSACTION_BOUNDARY_INVALID/u);
  const plan = { catalog: pinnedCatalog, sql: realSql };
  const before = observation(plan), valid = { sql: realSql, before, catalog: pinnedCatalog, deadline: now.toISOString(), rehearsal: true };
  assert.ok(buildMutationSql(valid).endsWith('ROLLBACK;'));
  for (const [label, options] of [
    ['empty baseline', { ...valid, before: {} }],
    ['missing prerequisite', { ...valid, before: { ...before, missingPrerequisites: ['relation:public.couples'] } }],
    ['unknown prerequisites', { ...valid, before: { ...before, missingPrerequisites: undefined } }],
    ['trigger already present', { ...valid, before: { ...before, catalog: { ...emptyTarget(), existingTableTriggers: [['x']] } } }],
    ['36-question catalog shape', { ...valid, before: { ...before, catalog: { relations: [], functions: [] } } }],
    ['already ledgered', { ...valid, before: { ...before, migration: observation(plan, true).migration } }],
    ['no expected catalog', { ...valid, catalog: undefined }],
    ['deadline without milliseconds', { ...valid, deadline: '2026-11-18T09:00:00Z' }],
    ['rehearsal flag as text', { ...valid, rehearsal: 'true' }],
  ]) assert.throws(() => buildMutationSql(options), /HIQ_MUTATION_BASELINE_INVALID/u, label);
  const sql = buildObservationSql();
  assert.ok(sql.startsWith('BEGIN READ ONLY;')); assert.match(sql, /pg_control_system/u);
  assert.match(sql, /current_user='supabase_read_only_user'/u);
  assert.match(sql, /NOT has_table_privilege\(current_user,'supabase_migrations\.schema_migrations','INSERT'\)/u);
  assert.match(sql, /'missingPrerequisites',/u);
  assert.doesNotMatch(sql, /SELECT \* FROM public\.profiles/u);
});

// ── 실제 PostgreSQL 엔진(PGlite) ─────────────────────────────────────────────
const valueOf = async (db, expression) => (await db.query(`SELECT ${expression} AS value`)).rows[0].value;
async function preparedPglite() {
  const db = await openPglite(sourceRoot);
  try {
    await preparePrerequisites(db, sourceRoot);
    // 운영 관측과 같은 search_path 로 읽는다.
    await db.exec('SET search_path = pg_catalog, public;');
    return db;
  } catch (error) { await db.close(); throw error; }
}
// 한 거래 안에서 바꿔 보고 되돌린다. 바꾼 흔적이 다음 확인으로 새지 않는다.
async function within(db, change, expression) {
  await db.exec(`BEGIN; ${change}`);
  try { return await valueOf(db, expression); } finally { await db.exec('ROLLBACK;'); }
}
async function observeOn(db) {
  const results = await db.exec(buildObservationSql());
  const row = (Array.isArray(results) ? results : [results]).find(result => result.rows?.[0]?.observation)?.rows[0];
  assert.ok(row, 'the observation SQL returned no observation row');
  return row.observation;
}
const LEDGER_SQL = `CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[]);
INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES
  ('20260716113000', 'account_deletion_storage_saga', ARRAY['SELECT 1;']),
  ('20261015070000', 'wedding_code36_private_pairing', ARRAY['SELECT 2;']),
  ('20261116000000', 'previous_head', ARRAY['SELECT 3;']);`;
// 시험에서만: PGlite 는 운영 시스템 식별자·PostgreSQL 17·Supabase 접속 역할이 아니다.
// 묶음 안의 운영 신원 검사식 한 곳만 true 로 바꾸고, 나머지 검사는 그대로 돌린다.
function withoutProductionIdentity(bundle) {
  const parts = bundle.split(targetIdentitySql);
  assert.equal(parts.length, 2, 'the production identity guard must appear exactly once in the bundle');
  return parts.join('true');
}

test('the pinned catalog fixture is byte-identical to a fresh PGlite build from the reviewed SQL', async () => {
  assert.equal(serializeFixture(await buildFixture(sourceRoot)), pinnedFixtureText);
});

test('unwrapMigration accepts the real file after its comment header and rejects any nested transaction statement', () => {
  const lines = realSql.split('\n'), begin = lines.indexOf('BEGIN;');
  assert.equal(begin, 31, 'the reviewed file has a 31-line comment header before BEGIN;');
  assert.ok(lines.slice(0, begin).every(line => line === '' || line.startsWith('--')));
  const body = unwrapMigration(realSql);
  assert.equal(body, realSql.slice(realSql.indexOf('\nBEGIN;\n') + '\nBEGIN;\n'.length, realSql.lastIndexOf('\nCOMMIT;') + 1));
  assert.ok(body.startsWith("SET LOCAL lock_timeout = '5s';\n"));
  assert.ok(body.includes('CREATE TRIGGER trg_hall_inquiry_account_deletion'));
  // 머리 주석·빈 줄은 건너뛰고, 함수 본문 안의 BEGIN/END 는 거래 경계가 아니다.
  assert.equal(unwrapMigration('-- 머리 주석 BEGIN;\n--\n\nBEGIN;\nSELECT 1;\nCOMMIT;\n'), 'SELECT 1;\n');
  const plpgsql = 'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $f$\nBEGIN\n  RETURN;\nEND;\n$f$;\n';
  assert.equal(unwrapMigration(`BEGIN;\n${plpgsql}COMMIT;\n`), plpgsql);
  for (const [label, sql] of [
    ['header without BEGIN', realSql.replace('\nBEGIN;\n', '\n')],
    ['BEGIN with options', realSql.replace('\nBEGIN;\n', '\nBEGIN ISOLATION LEVEL SERIALIZABLE;\n')],
    ['statement before BEGIN', realSql.replace('\nBEGIN;\n', '\nSELECT 1;\nBEGIN;\n')],
    ['no final COMMIT', realSql.slice(0, realSql.lastIndexOf('COMMIT;'))],
    ['statement after COMMIT', `${realSql}DELETE FROM public.profiles;\n`],
    ...['COMMIT;', 'ROLLBACK;', 'END;', 'ABORT;', 'START TRANSACTION;', 'BEGIN;', 'SAVEPOINT before_rows;',
      'RELEASE SAVEPOINT before_rows;', '  commit;'].map(statement => [`nested ${statement}`, beforeCommit(realSql, statement)]),
  ]) assert.throws(() => unwrapMigration(sql), /HIQ_SQL_TRANSACTION_BOUNDARY_INVALID/u, label);
});

// 줄 머리만 보면 'SELECT 1; COMMIT;' 처럼 한 줄에 놓인 거래 경계를 놓친다(2026-11-18). 문장 단위로 나눠 본다.
const TRANSACTION_HEAD = /^(?:BEGIN|COMMIT|ROLLBACK|END|ABORT|START|SAVEPOINT|RELEASE|PREPARE|SET\s+(?:SESSION\s+)?TRANSACTION|SET\s+SESSION)\b/iu;
test('the real body splits into 137 DDL statements and none of them is transaction control', () => {
  const statements = topLevelStatements(unwrapMigration(realSql));
  assert.equal(statements.length, 137);
  assert.deepEqual([...new Set(statements.map(statement => statement.split(/\s+/u)[0].toUpperCase()))].sort(),
    ['ALTER', 'COMMENT', 'CREATE', 'GRANT', 'REVOKE', 'SET']);
  assert.deepEqual(statements.filter(statement => TRANSACTION_HEAD.test(statement)), []);
});

test('a transaction boundary in the middle of a line is rejected, while strings, comments and quoted names stay text', () => {
  const wrap = body => `BEGIN;\n${body}\nCOMMIT;\n`;
  for (const [label, body] of [
    ['COMMIT inside a plain string', "SELECT 'a; COMMIT; b';"],
    ['COMMIT inside an E-string with an escaped quote', String.raw`SELECT E'it\'s; COMMIT;';`],
    ['COMMIT inside a doubled-quote string', "SELECT 'it''s; COMMIT;';"],
    ['COMMIT inside a block comment', '/* COMMIT; */ SELECT 1;'],
    ['COMMIT inside a line comment', '-- COMMIT;\nSELECT 1;'],
    ['COMMIT inside a quoted identifier', 'SELECT 1 AS "x; COMMIT";'],
    ['COMMIT inside a dollar-quoted body', 'SELECT $f$ ; COMMIT; $f$;'],
  ]) assert.equal(unwrapMigration(wrap(body)), `${body}\n`, label);
  assert.throws(() => unwrapMigration('BEGIN;\nSELECT 1; COMMIT;\nSELECT 2;\nCOMMIT;\n'), /HIQ_SQL_TRANSACTION_BOUNDARY_INVALID/u);
  for (const [label, body] of [
    // 주석 안의 $$ 는 달러 따옴표가 아니다. 뒤 주석의 $$ 까지 본문으로 삼키면 그 사이 COMMIT 을 놓친다.
    ['comment with $$ then a mid-line COMMIT', '-- costs $$\nSELECT 1; COMMIT;'],
    ['comments with $$ around a mid-line COMMIT', '-- costs $$\nSELECT 1; COMMIT;\n-- end $$'],
    // PostgreSQL 은 $ 와 0x80 이상 글자를 이름 글자로 본다. x$$f$, 한$f$ 는 이름이고 한e'…' 는 E 문자열이 아니다.
    ['dollar tag glued to an ASCII name', 'CREATE SCHEMA x$$f$; COMMIT; CREATE SCHEMA y$$f$;'],
    ['dollar tag glued to a non-ASCII name', 'CREATE SCHEMA 한$f$; COMMIT; CREATE SCHEMA 둘$f$;'],
    ["e' glued to a non-ASCII name", String.raw`CREATE DOMAIN public.한e AS text; SELECT 한e'\'; COMMIT; -- '`],
    ['PREPARE TRANSACTION', "SELECT 1; PREPARE TRANSACTION 'hiq';"],
    ['SET TRANSACTION', 'SELECT 1; SET TRANSACTION READ WRITE;'],
    ['SET SESSION CHARACTERISTICS', 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;'],
    ['unterminated string', "SELECT 'never closed;"],
    ['unterminated block comment', 'SELECT 1; /* never closed'],
    ['unterminated dollar body', 'SELECT $x$ never closed;'],
  ]) assert.throws(() => unwrapMigration(wrap(body)), /HIQ_SQL_TRANSACTION_BOUNDARY_INVALID/u, label);
});

test('the statement splitter counts the same top-level statements as PostgreSQL itself on tricky but valid SQL', async () => {
  const db = await openPglite(sourceRoot);
  try {
    for (const sql of [
      "SELECT 'a; COMMIT; b';", String.raw`SELECT E'it\'s; COMMIT;';`, String.raw`SELECT e'\\'; SELECT 1;`,
      "SELECT 'it''s; COMMIT;';", 'SELECT 1 AS "x; COMMIT";', '/* COMMIT; */ SELECT 2;', '-- COMMIT;\nSELECT 3;',
      'SELECT $$ ; COMMIT; $$;', 'SELECT $f$ $$ ; $f$;', String.raw`SELECT U&'d\0061t\+000061; COMMIT;';`,
      "SELECT date'2026-11-18';",
      'CREATE FUNCTION pg_temp.hiq_probe() RETURNS integer LANGUAGE plpgsql AS $body$\nBEGIN\n  RETURN 1;\nEND;\n$body$;',
      'CREATE SCHEMA x$$f$; CREATE SCHEMA y$$f$;', 'CREATE SCHEMA 한$f$; CREATE SCHEMA 둘$f$;',
      String.raw`CREATE DOMAIN public.한e AS text; SELECT 한e'\'; SELECT 1; -- '`,
    ]) {
      await db.exec('BEGIN;');
      try { assert.equal(topLevelStatements(sql).length, (await db.exec(sql)).length, sql); } finally { await db.exec('ROLLBACK;'); }
    }
  } finally { await db.close(); }
});

test('on PGlite the real SQL leaves the preserved catalog digest unchanged and every other existing-catalog change moves it', async () => {
  const db = await preparedPglite();
  try {
    const before = await valueOf(db, preservedCatalogSql());
    assert.match(before, /^[a-f0-9]{32}$/u);
    await db.exec(realSql);
    assert.equal(await valueOf(db, preservedCatalogSql()), before, 'only the listed trigger may change existing catalog');
    const target = await valueOf(db, targetCatalogSql());
    assert.deepEqual(target.existingTableTriggers.map(t => `${t[0]}.${t[1]}`), [...EXISTING_TRIGGER_NAMES]);
    for (const [label, change] of [
      ['a second trigger on account_deletion_jobs', 'CREATE TRIGGER trg_hall_inquiry_second AFTER DELETE ON public.account_deletion_jobs FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_purge_for_account_deletion();'],
      ['the listed trigger name on another existing table', 'CREATE TRIGGER trg_hall_inquiry_account_deletion AFTER INSERT ON public.couples FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_purge_for_account_deletion();'],
      ['a policy on public.couples', 'CREATE POLICY hall_inquiry_extra_read ON public.couples FOR SELECT TO authenticated USING (true);'],
      ['a comment on an existing table', "COMMENT ON TABLE public.couples IS 'changed';"],
      ['a comment on an existing column', "COMMENT ON COLUMN public.profiles.name IS 'changed';"],
      ['the owner of an existing function', 'ALTER FUNCTION public.is_couple_member(uuid) OWNER TO service_role;'],
      ['a comment on an existing function', "COMMENT ON FUNCTION public.is_couple_member(uuid) IS 'changed';"],
      ['a grant on an existing table', 'GRANT SELECT ON public.couples TO anon;'],
      ['publication membership of an existing table', 'CREATE PUBLICATION hall_inquiry_extra_pub FOR TABLE public.couples;'],
      ['storage options of an existing table', 'ALTER TABLE public.couples SET (fillfactor = 90);'],
      ['a new column on an existing table', 'ALTER TABLE public.profiles ADD COLUMN hall_extra text;'],
      ['an unlisted public function', 'CREATE FUNCTION public.hall_inquiry_extra() RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$;'],
      ['a new view', 'CREATE VIEW public.hall_inquiry_extra_view AS SELECT id FROM public.couples;'],
      ['a rule on an existing table', 'CREATE RULE hall_inquiry_extra_rule AS ON UPDATE TO public.couples DO ALSO NOTHING;'],
    ]) assert.notEqual(await within(db, change, preservedCatalogSql()), before, label);
    assert.equal(await valueOf(db, preservedCatalogSql()), before, 'every probe was rolled back');
  } finally { await db.close(); }
});

test('before apply the target catalog is empty and every missing prerequisite is named from the catalog', async () => {
  const db = await openPglite(sourceRoot);
  try {
    const everything = [...PREREQUISITES.relations.map(([schema, name]) => `relation:${schema}.${name}`),
      ...PREREQUISITES.columns.map(([schema, table, column]) => `column:${schema}.${table}.${column}`),
      ...PREREQUISITES.functions.map(([schema, name, args]) => `function:${schema}.${name}(${args})`),
      ...PREREQUISITES.checkValues.map(([schema, table, constraint, value]) => `check:${schema}.${table}.${constraint}:${value}`)].sort();
    assert.deepEqual(await valueOf(db, missingPrerequisitesSql()), everything);
    const eventCheck = 'check:public.couple_change_notifications.couple_change_notifications_event_kind_check:';
    for (const name of ['relation:public.account_deletion_jobs', 'column:public.account_deletion_jobs.status',
      'column:public.profiles.is_admin', 'function:public.is_couple_member(uuid)', 'function:auth.uid()', `${eventCheck}change_stale`]) {
      assert.ok(everything.includes(name), name);
    }
    await preparePrerequisites(db, sourceRoot);
    await db.exec('SET search_path = pg_catalog, public;');
    assert.deepEqual(await valueOf(db, targetCatalogSql()), emptyTarget());
    assert.deepEqual(await valueOf(db, missingPrerequisitesSql()), []);
    const missing = change => within(db, change, missingPrerequisitesSql());
    assert.deepEqual(await missing('ALTER TABLE public.account_deletion_jobs DROP COLUMN status;'), ['column:public.account_deletion_jobs.status']);
    assert.deepEqual(await missing('ALTER TABLE public.profiles DROP COLUMN is_admin;'), ['column:public.profiles.is_admin']);
    assert.deepEqual(await missing('DROP FUNCTION public.is_couple_member(uuid);'), ['function:public.is_couple_member(uuid)']);
    // 같은 이름이어도 인자가 다르면 대신하지 못한다.
    assert.deepEqual(await missing(`DROP FUNCTION public.is_couple_member(uuid);
      CREATE FUNCTION public.is_couple_member(p_couple text) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;`),
    ['function:public.is_couple_member(uuid)']);
    // 같은 표의 다른 CHECK(actor_recipient_check)도 'change_stale' 을 글에 담는다. 그래서 제약을 이름으로 짚는다.
    assert.match(await valueOf(db, `(SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conname = 'couple_change_notifications_actor_recipient_check')`), /'change_stale'/u);
    const dropEventCheck = 'ALTER TABLE public.couple_change_notifications DROP CONSTRAINT couple_change_notifications_event_kind_check;';
    assert.deepEqual(await missing(dropEventCheck), ['change_applied', 'change_rejected', 'change_stale'].map(value => `${eventCheck}${value}`));
    assert.deepEqual(await missing(`${dropEventCheck}
      ALTER TABLE public.couple_change_notifications ADD CONSTRAINT couple_change_notifications_event_kind_check
        CHECK (event_kind IN ('change_applied', 'change_rejected'));`), [`${eventCheck}change_stale`]);
    assert.deepEqual(await valueOf(db, missingPrerequisitesSql()), []);
  } finally { await db.close(); }
});

test('on PGlite the exact bundle rehearses with ROLLBACK, refuses drift, then commits one ledger row and the pinned catalog', async () => {
  const repo = repoFixture(), db = await preparedPglite();
  try {
    const plan = loadPlan(repo.dir);
    await db.exec(LEDGER_SQL);
    const before = await observeOn(db);
    // 운영 신원 검사는 이 엔진을 운영으로 보지 않는다. 그 밖의 관측은 실제 값이다.
    assert.equal(before.identityReady, false);
    assert.deepEqual(before.catalog, emptyTarget()); assert.deepEqual(before.missingPrerequisites, []);
    assert.equal(before.migration, null); assert.equal(before.ledgerCount, 3); assert.equal(before.ledgerSha, before.ledgerWithoutTargetSha);
    const asProduction = value => ({ ...value, identityReady: true, systemIdentifier: SYSTEM_IDENTIFIER, serverVersion: '17.6',
      currentUser: 'supabase_read_only_user' });
    assert.doesNotThrow(() => validateObservation(asProduction(before), plan, new Date(Date.parse(before.observedAt))));
    const deadline = new Date(Date.now() + 120_000).toISOString();
    const bundle = overrides => buildMutationSql({ sql: plan.sql, before, catalog: plan.catalog, deadline, rehearsal: true, ...overrides });
    const unchanged = async label => {
      const value = await observeOn(db);
      for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'ledgerHead', 'migration']) {
        assert.deepEqual(value[key], before[key], `${label}: ${key}`);
      }
    };
    // 실패한 묶음은 거래를 깨진 채로 남긴다. 운영 응답처럼 닫고, 아무것도 남지 않았는지 본다.
    const refused = async (sql, code, label) => {
      await assert.rejects(db.exec(sql), error => new RegExp(code, 'u').test(error.message), label);
      await db.exec('ROLLBACK;');
      await unchanged(label);
    };
    await refused(bundle(), 'HIQ_TARGET_DRIFT', 'production identity guard on a non-production engine');
    await refused(withoutProductionIdentity(bundle({ deadline: new Date(Date.now() - 60_000).toISOString() })),
      'HIQ_DEADLINE_EXPIRED', 'expired deadline');
    await refused(withoutProductionIdentity(bundle({ before: { ...before, preservedCatalogSha: hash('f') } })),
      'HIQ_BASELINE_DRIFT', 'stale preserved digest');
    await refused(`BEGIN; ALTER TABLE public.account_deletion_jobs RENAME COLUMN status TO status_moved;\n${withoutProductionIdentity(bundle())}`,
      'HIQ_PREREQUISITE_MISSING', 'prerequisite removed after observation');
    const rehearsal = withoutProductionIdentity(bundle());
    assert.ok(rehearsal.endsWith('ROLLBACK;'));
    await db.exec(rehearsal);
    await unchanged('rehearsal');
    const tampered = structuredClone(plan.catalog); tampered.existingTableTriggers[0][2] = 'D';
    await refused(withoutProductionIdentity(bundle({ catalog: tampered, rehearsal: false })), 'HIQ_AFTER_DRIFT', 'tampered expected catalog');
    const apply = withoutProductionIdentity(bundle({ rehearsal: false }));
    assert.ok(apply.endsWith('COMMIT;'));
    await db.exec(apply);
    const after = await observeOn(db);
    assert.equal(after.ledgerCount, before.ledgerCount + 1);
    assert.equal(after.ledgerWithoutTargetSha, before.ledgerSha); assert.notEqual(after.ledgerSha, before.ledgerSha);
    assert.equal(after.preservedCatalogSha, before.preservedCatalogSha);
    assert.equal(after.ledgerHead, MIGRATION_VERSION);
    assert.deepEqual(after.catalog, plan.catalog);
    assert.deepEqual(after.catalog, pinnedCatalog);
    assert.deepEqual(after.migration, { version: MIGRATION_VERSION, name: MIGRATION_NAME, statementCount: 1, sqlMd5: md5(plan.sql) });
    assert.doesNotThrow(() => validateObservation(asProduction(after), plan, new Date(Date.parse(after.observedAt))));
    for (const table of TABLES) {
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, 0, table);
    }
  } finally { await db.close(); repo.close(); }
});

// ── 실제 PostgreSQL 17(운영과 같은 큰 판) ───────────────────────────────────
// CI 는 PostgreSQL 17 을 /usr/lib/postgresql/17/bin 에 깔고 HANBANG_MAINTENANCE_NATIVE_PG_BIN 으로만 알린다.
// 이 픽스처는 HANBANG_SYNTHETIC_PG_BIN(또는 Windows 의 %LOCALAPPDATA% 고정 경로)만 읽으므로 CI 에서는 건너뛴다.
const nativeSkip = nativeProfileRoleAvailable ? false
  : 'PostgreSQL 17 binaries not visible: profile-role-native-database.mjs reads only HANBANG_SYNTHETIC_PG_BIN or, on Windows, '
    + '%LOCALAPPDATA%/WeddingHanbangTools/postgresql-17.10/pgsql/bin (CI exposes /usr/lib/postgresql/17/bin only as HANBANG_MAINTENANCE_NATIVE_PG_BIN)';
test('native PostgreSQL 17 rebuilds the same pinned catalog and keeps the preserved digest', { skip: nativeSkip }, async () => {
  const owned = await createProfileRoleNativeDatabase();
  try {
    const db = { exec: sql => owned.client.query(sql), query: (sql, params) => owned.client.query(sql, params) };
    assert.match((await db.query('SHOW server_version')).rows[0].server_version, /^17\./u);
    await preparePrerequisites(db, sourceRoot);
    await db.exec(LEDGER_SQL);
    const before = await observeOn(db);
    assert.deepEqual(before.missingPrerequisites, []); assert.deepEqual(before.catalog, emptyTarget());
    await db.exec(realSql);
    const catalog = await readTargetCatalog(db);
    assert.equal(`${JSON.stringify(catalog, null, 2)}\n`, `${JSON.stringify(pinnedCatalog, null, 2)}\n`);
    const after = await observeOn(db);
    assert.equal(after.preservedCatalogSha, before.preservedCatalogSha);
    assert.deepEqual(after.catalog, pinnedCatalog);
  } finally { await owned.close(); }
});
