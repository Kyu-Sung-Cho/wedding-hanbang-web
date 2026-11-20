// 아모라 먼저 챙기기 배포 길(scripts/amora-proactive-release*.mjs) 시험.
// 앞 절반은 웨딩홀 문의 길 시험(hall-inquiry-release.test.mjs)을 이 길에 맞게 옮겼다: SQL 넷, 원장 네 줄, 적용 전 모양도 고정한
// 대상 catalog, 검토한 원문 그대로만 받는 맨 위 특별 문장. 뒤 절반은 실제 PostgreSQL 엔진(PGlite, 이 컴퓨터에 있으면 PostgreSQL 17)에서
// 바꾸는 기존 객체·보존 지문·데이터 확인을 본다. 운영 접속은 없다.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BASE_COMMIT, FIXTURE, loadPlan, MANIFEST, MIGRATION_FILES, parseArgs, PINNED_FILES, RELEASE, runRelease,
  validateObservation, validateSourceChanges } from '../amora-proactive-release.mjs';
import { aggregate, buildMutationSql, buildObservationSql, classifyStatement, EXISTING_TABLE_CHANGES, FUNCTIONS, MIGRATIONS,
  missingPrerequisitesSql, PRE_EXISTING_FUNCTIONS, preservedCatalogSql, PREREQUISITES, PROJECT_REF, REVIEWED_STATEMENTS,
  splitStatements, statementDigest, SYSTEM_IDENTIFIER, TABLES, targetCatalogSql, targetIdentitySql, topLevelStatements,
  unwrapMigration } from '../amora-proactive-release-catalog.mjs';
import { buildFixture, openPglite, preparePrerequisites, PRIOR_MIGRATIONS, readTargetCatalog, serializeFixture } from '../amora-proactive-release-fixture.mjs';
import { prepareManifest } from '../amora-proactive-release-prepare.mjs';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './fixtures/profile-role-native-database.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const now = new Date('2026-11-20T09:00:00.000Z');
const commit = 'a'.repeat(40);
const hash = ch => ch.repeat(32);
const md5 = value => createHash('md5').update(value).digest('hex');
const realSqls = MIGRATION_FILES.map(file => readFileSync(resolve(sourceRoot, file), 'utf8'));
const pinnedFixtureText = readFileSync(resolve(sourceRoot, FIXTURE), 'utf8');
const pinned = JSON.parse(pinnedFixtureText);
const [EMAIL, CADENCE, TODAY_ONE, PUSH] = MIGRATION_FILES;
const argv = mode => [`--${mode}`, `--expected-commit=${commit}`, `--project-ref=${PROJECT_REF}`,
  `--receipt-out=${resolve(tmpdir(), `apro-${mode}-test-receipt.jsonl`)}`,
  `--confirm-production=${RELEASE}:${PROJECT_REF}:${mode}:${commit}`];

function repoFixture() {
  const dir = mkdtempSync(resolve(tmpdir(), 'apro-release-unit-'));
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
const appliedRows = plan => plan.migrations.map(m => ({ version: m.version, name: m.name, statementCount: 1, sqlMd5: md5(m.sql) }));
function observation(plan, applied = false) {
  return { format: 'amora-proactive-catalog-v1', identityReady: true, readOnly: true,
    systemIdentifier: SYSTEM_IDENTIFIER, serverVersion: '17.6', database: 'postgres', currentUser: 'supabase_read_only_user',
    observedAt: now.toISOString(), catalog: applied ? plan.catalog : plan.beforeCatalog, missingPrerequisites: [],
    preservedCatalogSha: hash('1'), ledgerSha: hash(applied ? '3' : '2'), ledgerWithoutTargetSha: hash('2'),
    ledgerCount: applied ? 254 : 250, ledgerHead: applied ? '20261120130000' : '20261117090000',
    migrations: applied ? appliedRows(plan) : [] };
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
const part = (catalog, table) => catalog.existingRelations.find(r => r.name === `public.${table}`);

test('arguments bind mode, production project, exact source and explicit confirmation', () => {
  assert.equal(parseArgs(argv('apply')).mode, 'apply');
  const confirm = mode => `--confirm-production=${RELEASE}:${PROJECT_REF}:${mode}:${commit}`;
  for (const [args, code] of [
    [[], 'APRO_ARGUMENT_REQUIRED'],
    [argv('apply').slice(0, -1), 'APRO_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED'],
    [[...argv('apply').slice(0, -1), confirm('rehearse')], 'APRO_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED'],
    [[...argv('apply').slice(0, -1), `--confirm-production=hall-inquiry-20261118:${PROJECT_REF}:apply:${commit}`],
      'APRO_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED'],
    [[...argv('apply'), '--inspect'], 'APRO_MODE_DUPLICATE'],
    [argv('apply').map(s => s.replace(PROJECT_REF, 'another-project')), 'APRO_ARGUMENT_REQUIRED'],
    [[...argv('apply'), '--unknown=yes'], 'APRO_ARGUMENT_INVALID'],
    [argv('apply').map(s => s.replace(`--expected-commit=${commit}`, '--expected-commit=main')), 'APRO_ARGUMENT_REQUIRED'],
    [argv('apply').map(s => (s.startsWith('--receipt-out=') ? '--receipt-out=relative-receipt.jsonl' : s)), 'APRO_ARGUMENT_REQUIRED'],
    [[...argv('inspect'), '--baseline-receipt=/tmp/not-allowed'], 'APRO_BASELINE_ARGUMENT_INVALID'],
    [argv('verify'), 'APRO_BASELINE_RECEIPT_REQUIRED'],
  ]) assert.throws(() => parseArgs(args), hasCode(code), args.join(' '));
});

test('unrelated future application changes may run the static gate while runtime release scope stays narrow', () => {
  const future = ['apps/web/next.config.ts', 'supabase/migrations/20990101000000_unreviewed.sql'];
  assert.doesNotThrow(() => validateSourceChanges(future, { staticOnly: true }));
  assert.throws(() => validateSourceChanges(future), /APRO_SOURCE_SCOPE_DRIFT/u);
  assert.doesNotThrow(() => validateSourceChanges([...MIGRATION_FILES, 'apps/web/src/lib/care/carePreferences.ts', FIXTURE,
    'apps/mobile/src/lib/careSettings.ts', 'scripts/amora-proactive-release.mjs', 'scripts/tests/amora-proactive-release.test.mjs']));
  // 이 길의 SQL 넷이 다 들지 않은 운영 반영, 다른 SQL·다른 배포 길 원문이 섞인 운영 반영은 받지 않는다.
  for (const changed of [[], ['apps/web/src/lib/care/carePreferences.ts'], MIGRATION_FILES.slice(1),
    [...MIGRATION_FILES, future[0]], [...MIGRATION_FILES, future[1]], [...MIGRATION_FILES, 'scripts/hall-inquiry-release.mjs'],
    [...MIGRATION_FILES, 'supabase/release-contracts/hall-inquiry-v1.json'],
    [...MIGRATION_FILES, 'supabase/migrations/20261117090000_hall_listings_and_inquiries.sql']]) {
    assert.throws(() => validateSourceChanges(changed), /APRO_SOURCE_SCOPE_DRIFT/u, changed.join(' '));
  }
  assert.throws(() => validateSourceChanges('apps/web/src/proxy.ts'), /APRO_SOURCE_SCOPE_ARGUMENT_INVALID/u);
});

test('canonical SQL aggregation preserves column metadata while removing the observed locale ordering difference', async () => {
  const db = await openPglite(sourceRoot);
  try {
    const expected = pinned.after.relations.find(r => r.name === 'public.amora_push_deliveries').columns;
    const actual = structuredClone(expected);
    [actual[0], actual[1]] = [actual[1], actual[0]];
    assert.notDeepEqual(actual, expected);
    const sql = `SELECT ${aggregate('SELECT value AS v FROM jsonb_array_elements($1::jsonb)')} AS columns`;
    assert.deepEqual((await db.query(sql, [JSON.stringify(actual)])).rows[0].columns, expected);
    actual[0][2] = !actual[0][2];
    assert.notDeepEqual((await db.query(sql, [JSON.stringify(actual)])).rows[0].columns, expected);
  } finally { await db.close(); }
});

test('manifest pins exactly the four reviewed SQL files, runtime, catalog, fixture builder, build contract and snapshot', () => {
  const repo = repoFixture();
  try {
    const plan = loadPlan(repo.dir);
    assert.equal(plan.manifest.baseCommit, BASE_COMMIT);
    assert.deepEqual(plan.migrations.map(m => m.version), ['20261120100000', '20261120110000', '20261120120000', '20261120130000']);
    assert.deepEqual(plan.manifest.scope.renamedFunctions, [
      'public.patch_profile_atomic(uuid, text, text, boolean, boolean, boolean, text, boolean, boolean) -> public.patch_profile_atomic_pre_email_consent',
      'public.claim_amora_care_email_delivery(uuid, uuid) -> public.claim_amora_care_email_delivery_pre_email_consent',
      'public.insert_amora_care_message(uuid, text, jsonb) -> public.insert_amora_care_message_pre_cadence',
      'public.prepare_amora_care_job(uuid, uuid, boolean) -> public.prepare_amora_care_job_pre_cadence']);
    for (const file of PINNED_FILES) {
      const bytes = readFileSync(resolve(repo.dir, file));
      writeFileSync(resolve(repo.dir, file), Buffer.concat([bytes, Buffer.from('\n-- changed\n')]));
      assert.throws(() => loadPlan(repo.dir), hasCode('APRO_ARTIFACT_HASH_MISMATCH'), file);
      writeFileSync(resolve(repo.dir, file), bytes);
    }
    assert.doesNotThrow(() => loadPlan(repo.dir));
    const manifest = JSON.parse(readFileSync(resolve(repo.dir, MANIFEST), 'utf8'));
    for (const [value, code] of [
      [{ ...manifest, runtimeEvidenceVerified: true }, 'APRO_MANIFEST_CONTRACT_INVALID'],
      [{ ...manifest, existingData: 'unchanged' }, 'APRO_MANIFEST_CONTRACT_INVALID'],
      [{ ...manifest, newRows: 'seeded' }, 'APRO_MANIFEST_CONTRACT_INVALID'],
      [{ ...manifest, migrations: manifest.migrations.slice(0, 3) }, 'APRO_MANIFEST_CONTRACT_INVALID'],
      [{ ...manifest, migrations: [...manifest.migrations].reverse() }, 'APRO_MANIFEST_CONTRACT_INVALID'],
      [{ ...manifest, scope: { ...manifest.scope, existingTables: 'unchanged' } }, 'APRO_MANIFEST_SCOPE_INVALID'],
      [{ ...manifest, scope: { ...manifest.scope, renamedFunctions: [] } }, 'APRO_MANIFEST_SCOPE_INVALID'],
      [{ ...manifest, artifacts: manifest.artifacts.slice(1) }, 'APRO_ARTIFACT_SET_INVALID'],
    ]) {
      writeFileSync(resolve(repo.dir, MANIFEST), `${JSON.stringify(value, null, 2)}\n`);
      assert.throws(() => loadPlan(repo.dir), hasCode(code), code);
    }
  } finally { repo.close(); }
});

test('repinning cannot admit new top-level data statements, extra objects or unreviewed changes to existing tables', () => {
  const repo = repoFixture();
  try {
    const rejected = (file, changed, code) => {
      const original = readFileSync(resolve(repo.dir, file), 'utf8');
      assert.notEqual(changed, original, `${file}: the planted change did not apply`);
      writeFileSync(resolve(repo.dir, file), changed); repo.refresh();
      try { assert.throws(() => loadPlan(repo.dir), hasCode(code), `${file}: ${changed.slice(-160)}`); }
      finally { writeFileSync(resolve(repo.dir, file), original); repo.refresh(); }
    };
    const sql = readFileSync(resolve(repo.dir, EMAIL), 'utf8');
    assert.doesNotThrow(() => loadPlan(repo.dir));
    for (const statement of ['DELETE FROM public.profiles;', 'UPDATE public.couples SET bride_id = NULL;',
      'INSERT INTO public.amora_push_preferences DEFAULT VALUES;', 'TRUNCATE public.amora_care_jobs;',
      'DROP TABLE public.chat_messages;', 'DO $x$ BEGIN PERFORM 1; END $x$;',
      'MERGE INTO public.profiles AS p USING public.couples AS c ON false WHEN NOT MATCHED THEN DO NOTHING;',
      'WITH gone AS (DELETE FROM public.profiles RETURNING 1) SELECT 1;', 'SELECT 1; DELETE FROM public.profiles;',
      "SELECT public.patch_profile_atomic(p_user_id => gen_random_uuid(), p_name => 'x');",
      'PREPARE wipe AS DELETE FROM public.profiles;', 'EXECUTE wipe;', 'REASSIGN OWNED BY anon TO postgres;']) {
      rejected(EMAIL, beforeCommit(sql, statement), 'APRO_TOP_LEVEL_DML_FORBIDDEN');
    }
    // 검토한 이어받기 UPDATE 를 넓히거나, 검토한 사후 확인 블록을 빼도 받지 않는다(문장 원문 sha256).
    const backfill = '  AND care_notifications_consented_at IS NOT NULL\n  AND care_email_enabled = false;\n';
    assert.equal(sql.split(backfill).length, 2);
    rejected(EMAIL, sql.replace(backfill, '  AND care_email_enabled = false;\n'), 'APRO_TOP_LEVEL_DML_FORBIDDEN');
    rejected(EMAIL, sql.replace(/DO \$postconditions\$[\s\S]*?\$postconditions\$;\n/u, ''), 'APRO_TOP_LEVEL_DML_FORBIDDEN');
    rejected(EMAIL, beforeCommit(sql, 'CREATE TABLE public.unrelated(value text);'), 'APRO_DDL_TABLE_SCOPE_INVALID');
    rejected(EMAIL, beforeCommit(sql, 'CREATE FUNCTION public.unrelated() RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$;'),
      'APRO_DDL_FUNCTION_SCOPE_INVALID');
    for (const statement of ['GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO anon;',
      'ALTER FUNCTION public.is_couple_member(uuid) OWNER TO postgres;',
      'ALTER FUNCTION public.is_couple_member(uuid) RENAME TO is_couple_member_old;',
      'CREATE TRIGGER trg_extra BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();']) {
      rejected(EMAIL, beforeCommit(sql, statement), statement.startsWith('CREATE TRIGGER') ? 'APRO_DDL_EXISTING_TABLE_SCOPE_INVALID'
        : 'APRO_DDL_FUNCTION_SCOPE_INVALID');
    }
    for (const statement of [
      'CREATE TRIGGER trg_unrelated AFTER INSERT ON public.couples FOR EACH ROW EXECUTE FUNCTION public.normalize_amora_care_email_consent();',
      'ALTER TABLE public.profiles ADD COLUMN unrelated text;', 'ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE public.amora_today_one_signals DROP CONSTRAINT amora_today_one_signals_kind_presentation_check;',
      'CREATE INDEX unrelated_idx ON public.profiles(couple_id);', 'REVOKE ALL ON TABLE public.couples FROM anon;',
      "COMMENT ON COLUMN public.profiles.name IS 'changed';", "COMMENT ON TABLE public.profiles IS 'changed';",
    ]) rejected(EMAIL, beforeCommit(sql, statement), 'APRO_DDL_EXISTING_TABLE_SCOPE_INVALID');
    for (const statement of ['CREATE POLICY unrelated_read ON public.couples FOR SELECT USING (true);',
      'GRANT SELECT ON public.couples TO anon;', 'ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon;',
      'SET LOCAL role = anon;', 'CREATE VIEW public.unrelated_view AS SELECT 1 AS x;']) {
      rejected(EMAIL, beforeCommit(sql, statement), 'APRO_DDL_STATEMENT_FORBIDDEN');
    }
    // 목록의 트리거 다시 만들기를 빼도 받지 않는다. 기존 표를 바꾸는 문장은 검토한 원문 그대로 그 수만큼이어야 한다.
    const recreate = /CREATE TRIGGER trg_prevent_direct_amora_care_consent_change[\s\S]*?prevent_direct_amora_care_consent_change\(\);\n/u;
    const cadence = readFileSync(resolve(repo.dir, CADENCE), 'utf8');
    rejected(CADENCE, cadence.replace(recreate, ''), 'APRO_DDL_EXISTING_TABLE_SCOPE_INVALID');
    const todayOne = readFileSync(resolve(repo.dir, TODAY_ONE), 'utf8');
    rejected(TODAY_ONE, todayOne.replace("'task_deadline', 'couple_decision', 'inquiry_waiting', 'task_done'\n    )) NOT VALID;",
      "'task_deadline', 'couple_decision', 'inquiry_waiting', 'task_done', 'vendor_offer'\n    )) NOT VALID;"), 'APRO_DDL_EXISTING_TABLE_SCOPE_INVALID');
    const push = readFileSync(resolve(repo.dir, PUSH), 'utf8');
    rejected(PUSH, beforeCommit(push, 'CREATE TABLE public.amora_push_extra(id uuid);'), 'APRO_DDL_TABLE_SCOPE_INVALID');
    rejected(PUSH, push.replace('ALTER TABLE public.amora_push_preferences FORCE ROW LEVEL SECURITY;\n', ''), 'APRO_FIXTURE_INVALID');
    rejected(EMAIL, beforeCommit(sql, 'SAVEPOINT before_customer_rows;'), 'APRO_SQL_TRANSACTION_BOUNDARY_INVALID');
    rejected(EMAIL, beforeCommit(sql, 'COMMIT;\nBEGIN;'), 'APRO_SQL_TRANSACTION_BOUNDARY_INVALID');
    rejected(EMAIL, sql.replaceAll('\n', '\r\n'), 'APRO_MIGRATION_ENCODING_INVALID');
    // 정적 검사를 다 통과한 다른 원문이어도 catalog 고정 파일은 원래 SQL 넷의 hash 에 묶여 있다.
    for (const file of MIGRATION_FILES) rejected(file, `-- 다시 검토함\n${readFileSync(resolve(repo.dir, file), 'utf8')}`, 'APRO_FIXTURE_INVALID');
  } finally { repo.close(); }
});

test('the reviewed special and existing-table statements are exactly the listed ones, by text', () => {
  const found = MIGRATIONS.map((m, i) => {
    const special = [], existing = [];
    for (const { normalized, raw } of splitStatements(unwrapMigration(realSqls[i]))) {
      const kind = classifyStatement(normalized);
      assert.notEqual(kind.kind, 'unknown', normalized.slice(0, 120));
      if (kind.kind === 'special') special.push(raw);
      if (['alter-table', 'create-trigger'].includes(kind.kind) && !TABLES.includes(kind.table)) existing.push(raw);
    }
    assert.deepEqual(special.map(statementDigest), [...REVIEWED_STATEMENTS[m.version].special], m.version);
    assert.deepEqual(existing.map(statementDigest), [...REVIEWED_STATEMENTS[m.version].existingTable], m.version);
    return { special, existing };
  });
  // 맨 위 데이터 문장은 기존 동의 이어받기 UPDATE 하나뿐이다.
  const data = found.flatMap(f => f.special).filter(raw => !/^(?:DO|DROP TRIGGER IF EXISTS)\b/u.test(raw));
  assert.deepEqual(data, ['UPDATE public.profiles\nSET care_email_enabled = true,\n    care_email_consented_at = care_notifications_consented_at\n'
    + 'WHERE care_notifications_enabled = true\n  AND care_notifications_consented_at IS NOT NULL\n  AND care_email_enabled = false']);
  assert.deepEqual(found.flatMap(f => f.special).filter(raw => raw.startsWith('DROP')), [
    'DROP TRIGGER IF EXISTS trg_normalize_amora_care_email_consent ON public.profiles',
    'DROP TRIGGER IF EXISTS trg_prevent_direct_amora_care_consent_change ON public.profiles',
    'DROP TRIGGER IF EXISTS trg_prevent_direct_amora_care_consent_change ON public.profiles']);
  assert.equal(found.flatMap(f => f.special).filter(raw => raw.startsWith('DO $postconditions$')).length, 4);
  assert.deepEqual(found.map(f => f.existing.length), [9, 5, 3, 0]);
});

test('a repinned catalog fixture cannot open new objects to anon or PUBLIC, widen existing-table parts or alter a moved body', () => {
  const repo = repoFixture();
  try {
    const original = JSON.parse(readFileSync(resolve(repo.dir, FIXTURE), 'utf8'));
    const rejected = (mutate, code, label) => {
      const value = structuredClone(original); mutate(value);
      writeFileSync(resolve(repo.dir, FIXTURE), serializeFixture(value)); repo.refresh();
      assert.throws(() => loadPlan(repo.dir), hasCode(code), label);
    };
    const privileges = 'APRO_FIXTURE_PRIVILEGES_INVALID', existing = 'APRO_FIXTURE_EXISTING_TABLES_INVALID';
    rejected(v => v.after.relations[0].acl.push(['anon', 'postgres', 'SELECT', false]), privileges, 'table grant to anon');
    rejected(v => v.after.relations[0].acl.push(['PUBLIC', 'postgres', 'SELECT', false]), privileges, 'table grant to PUBLIC');
    rejected(v => v.after.relations[0].columns[0][6].push(['anon', 'postgres', 'SELECT', false]), privileges, 'column grant to anon');
    rejected(v => v.after.relations[0].policies.push({ name: 'x', roles: ['anon'] }), privileges, 'policy for anon');
    rejected(v => v.after.relations[0].policies.push({ name: 'x', roles: null }), privileges, 'policy for every role');
    rejected(v => { v.after.relations[0].rls = false; }, privileges, 'RLS off');
    rejected(v => { v.after.relations[0].forceRls = false; }, privileges, 'forced RLS off');
    rejected(v => { v.after.relations[0].owner = 'service_role'; }, privileges, 'table owner');
    rejected(v => v.after.functions[0].acl.push(['PUBLIC', 'postgres', 'EXECUTE', false]), privileges, 'function grant to PUBLIC');
    rejected(v => { v.after.functions[0].config = null; }, privileges, 'function without search_path');
    rejected(v => { v.after.functions[0].owner = 'authenticated'; }, privileges, 'function owner');
    rejected(v => { part(v.after, 'profiles').triggers[0][1] = 'D'; }, existing, 'disabled trigger');
    rejected(v => { part(v.after, 'profiles').constraints[0][2] = false; }, existing, 'unvalidated constraint');
    rejected(v => { part(v.after, 'profiles').columns.pop(); }, existing, 'missing listed column');
    rejected(v => { part(v.after, 'profiles').columnComments.pop(); }, existing, 'missing listed column comment');
    rejected(v => { part(v.after, 'profiles').columns[0][6].push(['anon', 'postgres', 'UPDATE', false]); }, existing, 'new column to anon');
    rejected(v => { part(v.after, 'amora_today_one_signals').comment = null; }, existing, 'missing listed table comment');
    rejected(v => { v.after.existingRelations.pop(); }, 'APRO_FIXTURE_EXISTING_TABLES_INVALID', 'missing existing table');
    rejected(v => { v.after.relations.pop(); }, 'APRO_FIXTURE_TABLES_INVALID', 'missing table');
    rejected(v => { v.before.relations.push(v.after.relations[0]); }, 'APRO_FIXTURE_TABLES_INVALID', 'table before apply');
    rejected(v => { v.after.functions.pop(); }, 'APRO_FIXTURE_FUNCTIONS_INVALID', 'missing function');
    rejected(v => { v.before.functions.pop(); }, 'APRO_FIXTURE_FUNCTIONS_INVALID', 'missing pre-existing function');
    rejected(v => { v.after.functions.find(f => f.name === 'patch_profile_atomic_pre_email_consent').body += '\n'; },
      'APRO_FIXTURE_FUNCTIONS_INVALID', 'moved function body differs from the pre-apply body');
    rejected(v => { delete v.after.existingRelations; }, 'APRO_FIXTURE_INVALID', 'hall-inquiry catalog shape');
    rejected(v => { v.migrations.reverse(); }, 'APRO_FIXTURE_INVALID', 'fixture bound to another SQL order');
  } finally { repo.close(); }
});

test('inspect uses only read-only observation and verifies the pinned pre-apply catalog', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo), result = await runRelease({ ...h.options, argv: argv('inspect') });
    assert.equal(result.status, 'inspected-before-catalog-verified'); assert.equal(result.remoteWritesPerformed, false);
    assert.deepEqual(h.calls.map(c => c.readOnly), [true]);
    assert.match(h.records[1].backupScope, /metadata-only/u);
    assert.deepEqual(h.records[1].observation.catalog, h.plan.beforeCatalog);
    assert.deepEqual(h.records[1].observation.migrations, []);
    assert.deepEqual(h.records[1].sqlSha256s, h.plan.sqlSha256s);
  } finally { repo.close(); }
});

test('source or preflight identity failure blocks before any mutation', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo, { source() { throw new Error('APRO_SOURCE_NOT_CLEAN_EXACT_COMMIT'); } });
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /APRO_SOURCE_NOT_CLEAN_EXACT_COMMIT/u);
    assert.equal(h.calls.length, 0);
    const h2 = harness(repo, { query: async () => [{ observation: { ...observation(loadPlan(repo.dir)), identityReady: false } }] });
    await assert.rejects(runRelease({ ...h2.options, argv: argv('apply') }), /APRO_OBSERVATION_INVALID/u);
    assert.equal(h2.records.at(-1).status, 'blocked-before-mutation');
    const h3 = harness(repo, { query: async () => [{ observation: { ...observation(loadPlan(repo.dir)),
      missingPrerequisites: ['constraint:public.amora_today_one_signals.amora_today_one_signals_kind_presentation_check'] } }] });
    await assert.rejects(runRelease({ ...h3.options, argv: argv('apply') }), /APRO_PREREQUISITE_MISSING/u);
    assert.equal(h3.records.at(-1).status, 'blocked-before-mutation'); assert.equal(h3.records.at(-1).code, 'APRO_PREREQUISITE_MISSING');
  } finally { repo.close(); }
});

test('stale observation, wrong system, drifted pre-apply objects, partial ledger and mismatched SQL are rejected', () => {
  const repo = repoFixture();
  try {
    const plan = loadPlan(repo.dir), base = observation(plan), applied = observation(plan, true);
    assert.doesNotThrow(() => validateObservation(base, plan, now));
    assert.doesNotThrow(() => validateObservation(applied, plan, now));
    const drifted = mutate => { const catalog = structuredClone(plan.beforeCatalog); mutate(catalog); return { ...base, catalog }; };
    for (const [value, code] of [
      [{ ...base, observedAt: new Date(now.getTime() - 120001).toISOString() }, 'APRO_OBSERVATION_EXPIRED'],
      [{ ...base, observedAt: new Date(now.getTime() + 10001).toISOString() }, 'APRO_OBSERVATION_EXPIRED'],
      [{ ...base, systemIdentifier: 'wrong' }, 'APRO_OBSERVATION_INVALID'], [{ ...base, serverVersion: '18.6' }, 'APRO_OBSERVATION_INVALID'],
      [{ ...base, currentUser: 'postgres' }, 'APRO_OBSERVATION_INVALID'], [{ ...base, readOnly: false }, 'APRO_OBSERVATION_INVALID'],
      [{ ...base, missingPrerequisites: undefined }, 'APRO_OBSERVATION_INVALID'], [{ ...base, migrations: null }, 'APRO_OBSERVATION_INVALID'],
      [{ ...base, missingPrerequisites: ['function:public.amora_care_delivery_clock()'] }, 'APRO_PREREQUISITE_MISSING'],
      [{ ...applied, missingPrerequisites: ['column:public.profiles.couple_id'] }, 'APRO_PREREQUISITE_MISSING'],
      // 운영의 바꿀 함수 본문·권한, 기존 트리거, 칸 주석이 고정한 적용 전 모양과 다르면 적용하지 않는다.
      [drifted(c => { c.functions[0].body += ' '; }), 'APRO_TARGET_BEFORE_DRIFT'],
      [drifted(c => { c.functions[0].acl.push(['anon', 'postgres', 'EXECUTE', false]); }), 'APRO_TARGET_BEFORE_DRIFT'],
      [drifted(c => { part(c, 'profiles').triggers = []; }), 'APRO_TARGET_BEFORE_DRIFT'],
      [drifted(c => { part(c, 'profiles').columnComments = []; }), 'APRO_TARGET_BEFORE_DRIFT'],
      [drifted(c => { c.functions.pop(); }), 'APRO_TARGET_BEFORE_DRIFT'],
      [{ ...base, catalog: plan.catalog }, 'APRO_TARGET_BEFORE_DRIFT'],
      [{ ...base, ledgerSha: hash('4') }, 'APRO_LEDGER_CONFLICT'],
      [{ ...applied, migrations: applied.migrations.slice(0, 2) }, 'APRO_APPLIED_LEDGER_CONFLICT'],
      [{ ...applied, migrations: applied.migrations.map((m, i) => (i === 2 ? { ...m, sqlMd5: hash('9') } : m)) }, 'APRO_APPLIED_LEDGER_CONFLICT'],
      [{ ...applied, migrations: applied.migrations.map((m, i) => (i === 0 ? { ...m, name: 'hall_listings_and_inquiries' } : m)) },
        'APRO_APPLIED_LEDGER_CONFLICT'],
      [{ ...applied, catalog: plan.beforeCatalog }, 'APRO_APPLIED_CATALOG_DRIFT'],
    ]) assert.throws(() => validateObservation(value, plan, now), hasCode(code), code);
  } finally { repo.close(); }
});

test('apply rehearses and proves rollback before the single durable transaction of all four files and post-verification', async () => {
  const repo = repoFixture();
  try {
    const h = harness(repo), result = await runRelease({ ...h.options, argv: argv('apply') });
    assert.equal(result.status, 'applied-and-postverified'); assert.equal(result.remoteWritesPerformed, true);
    assert.deepEqual(h.calls.map(c => c.readOnly), [true, false, true, false, true]);
    assert.ok(h.calls[1].sql.endsWith('ROLLBACK;')); assert.ok(h.calls[3].sql.endsWith('COMMIT;'));
    const apply = h.calls[3].sql;
    assert.match(apply, /LOCK TABLE supabase_migrations\.schema_migrations/u);
    for (const code of ['APRO_TARGET_DRIFT', 'APRO_PREREQUISITE_MISSING', 'APRO_BASELINE_DRIFT', 'APRO_AFTER_DRIFT', 'APRO_DEADLINE_EXPIRED']) {
      assert.ok(apply.includes(`RAISE EXCEPTION '${code}'`), code);
    }
    assert.match(apply, /current_user='postgres'/u);
    // 새 표 둘은 빈 채로 끝나고(newRows: none), profiles 의 새 칸은 기본값·이어받기 규칙 그대로여야 한다.
    for (const table of TABLES) assert.ok(apply.includes(`OR EXISTS(SELECT 1 FROM public.${table})`), table);
    assert.match(apply, /EXISTS\(SELECT 1 FROM public\.profiles WHERE/u);
    // 본문 넷은 파일 이름 순서로 한 번씩, 원장 네 줄은 한 INSERT 로 들어간다.
    const positions = h.plan.sqls.map(sql => apply.indexOf(unwrapMigration(sql)));
    assert.ok(positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1])), JSON.stringify(positions));
    assert.equal(apply.split('INSERT INTO supabase_migrations.schema_migrations').length, 2);
    for (const m of MIGRATIONS) assert.ok(apply.includes(`('${m.version}','${m.name}',ARRAY[`), m.version);
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
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /APRO_OUTCOME_REQUIRES_READONLY_INSPECTION/u);
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
    await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /APRO_OUTCOME_REQUIRES_READONLY_INSPECTION/u);
    assert.equal(writes, 1); assert.ok(!h.records.some(r => r.status === 'apply-outcome-unverified'));
  } finally { repo.close(); }
});

test('post-apply verification requires exactly four new ledger rows on top of the unchanged baseline', async () => {
  const repo = repoFixture();
  try {
    const plan = loadPlan(repo.dir);
    for (const drift of [{ ledgerCount: 255 }, { ledgerCount: 251 }, { ledgerWithoutTargetSha: hash('5') }, { preservedCatalogSha: hash('6') }]) {
      let applied = false;
      const h = harness(repo, { query: async (sql, opts) => {
        if (!opts.readOnly) { if (sql.endsWith('COMMIT;')) applied = true; return []; }
        return [{ observation: applied ? { ...observation(plan, true), ...drift } : observation(plan) }];
      } });
      await assert.rejects(runRelease({ ...h.options, argv: argv('apply') }), /APRO_OUTCOME_REQUIRES_READONLY_INSPECTION/u);
      assert.equal(h.records.at(-1).code, 'APRO_POST_APPLY_UNVERIFIED', JSON.stringify(drift));
    }
  } finally { repo.close(); }
});

test('verify compares the fresh applied catalog with the private source-bound pre-apply baseline without writes', async () => {
  const repo = repoFixture();
  try {
    const h1 = harness(repo); await runRelease({ ...h1.options, argv: argv('apply') });
    const h2 = harness(repo, { query: async () => [{ observation: observation(h1.plan, true) }],
      baselineReader: () => h1.records.map(r => JSON.stringify(r)).join('\n') });
    const args = [...argv('verify'), `--baseline-receipt=${resolve(tmpdir(), 'apro-baseline.jsonl')}`];
    const result = await runRelease({ ...h2.options, argv: args });
    assert.equal(result.status, 'applied-and-readonly-postverified'); assert.equal(result.remoteWritesPerformed, false);
    assert.equal(h2.records.at(-1).status, 'applied-and-readonly-postverified');
    assert.ok(h2.calls.every(c => c.readOnly));
    const h3 = harness(repo, { query: async () => [{ observation: observation(h1.plan, true) }], baselineReader: () => '{}' });
    await assert.rejects(runRelease({ ...h3.options, argv: args }), /APRO_BASELINE_RECEIPT_BINDING_INVALID/u);
  } finally { repo.close(); }
});

test('SQL envelope guards cannot accept nested transaction statements or fabricated preflight', () => {
  assert.equal(unwrapMigration('BEGIN;\nSELECT 1;\nCOMMIT;\n'), 'SELECT 1;\n');
  assert.throws(() => unwrapMigration('ROLLBACK;\nSELECT 1;'), /APRO_SQL_TRANSACTION_BOUNDARY_INVALID/u);
  const plan = { catalog: pinned.after, beforeCatalog: pinned.before, sqls: realSqls };
  const before = observation(plan), valid = { sqls: realSqls, before, beforeCatalog: pinned.before, catalog: pinned.after,
    deadline: now.toISOString(), rehearsal: true };
  assert.ok(buildMutationSql(valid).endsWith('ROLLBACK;'));
  for (const [label, options] of [
    ['empty baseline', { ...valid, before: {} }],
    ['three files', { ...valid, sqls: realSqls.slice(0, 3) }],
    ['missing prerequisite', { ...valid, before: { ...before, missingPrerequisites: ['relation:public.couples'] } }],
    ['unknown prerequisites', { ...valid, before: { ...before, missingPrerequisites: undefined } }],
    ['observed catalog is not the pinned pre-apply catalog', { ...valid, before: { ...before, catalog: pinned.after } }],
    ['hall-inquiry empty catalog', { ...valid, before: { ...before, catalog: { relations: [], functions: [], existingTableTriggers: [] } } }],
    ['already ledgered', { ...valid, before: { ...before, migrations: [{ version: '20261120100000' }] } }],
    ['no expected catalog', { ...valid, catalog: undefined }],
    ['deadline without milliseconds', { ...valid, deadline: '2026-11-20T09:00:00Z' }],
    ['rehearsal flag as text', { ...valid, rehearsal: 'true' }],
  ]) assert.throws(() => buildMutationSql(options), /APRO_MUTATION_BASELINE_INVALID/u, label);
  const sql = buildObservationSql();
  assert.ok(sql.startsWith('BEGIN READ ONLY;')); assert.match(sql, /pg_control_system/u);
  assert.match(sql, /current_user='supabase_read_only_user'/u);
  assert.match(sql, /NOT has_table_privilege\(current_user,'supabase_migrations\.schema_migrations','INSERT'\)/u);
  assert.match(sql, /'missingPrerequisites',/u);
  // 읽기 전용 관측은 catalog 와 원장만 읽는다. 고객 행은 반영 묶음의 postgres 거래 안에서만 센다.
  assert.doesNotMatch(sql, /FROM public\.profiles/u);
});

// ── 실제 PostgreSQL 엔진(PGlite) ─────────────────────────────────────────────
const valueOf = async (db, expression) => (await db.query(`SELECT ${expression} AS value`)).rows[0].value;
const BRIDE = '00000000-0000-4000-8000-000000000001', GROOM = '00000000-0000-4000-8000-000000000002';
// 기존 함께 대화 케어 동의가 있는 사람 하나, 없는 사람 하나. 메일 동의 이어받기 확인에 쓴다.
const SEED_SQL = `INSERT INTO auth.users(id) VALUES ('${BRIDE}'), ('${GROOM}');
INSERT INTO public.profiles(id, care_notifications_enabled, care_notifications_consented_at)
  VALUES ('${BRIDE}', true, '2026-11-01T00:00:00Z'), ('${GROOM}', false, NULL);`;
async function preparedPglite(options) {
  const db = await openPglite(sourceRoot);
  try {
    await preparePrerequisites(db, sourceRoot, options);
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
  ('20260716093000', 'amora_care_queue', ARRAY['SELECT 1;']),
  ('20260802150000', 'amora_today_one_budget_guardrails', ARRAY['SELECT 2;']),
  ('20261117090000', 'hall_listings_and_inquiries', ARRAY['SELECT 3;']);`;
// 시험에서만: PGlite 는 운영 시스템 식별자·PostgreSQL 17·Supabase 접속 역할이 아니다.
// 묶음 안의 운영 신원 검사식 한 곳만 true 로 바꾸고, 나머지 검사는 그대로 돌린다.
function withoutProductionIdentity(bundle) {
  const parts = bundle.split(targetIdentitySql);
  assert.equal(parts.length, 2, 'the production identity guard must appear exactly once in the bundle');
  return parts.join('true');
}
const asProduction = value => ({ ...value, identityReady: true, systemIdentifier: SYSTEM_IDENTIFIER, serverVersion: '17.6',
  currentUser: 'supabase_read_only_user' });

test('the pinned catalog fixture is byte-identical to a fresh PGlite build from the reviewed SQL', async () => {
  assert.equal(serializeFixture(await buildFixture(sourceRoot)), pinnedFixtureText);
});

test('unwrapMigration accepts each real file and rejects any nested transaction statement', () => {
  for (const sql of realSqls) {
    assert.ok(sql.startsWith('BEGIN;\n'));
    const body = unwrapMigration(sql);
    assert.equal(body, sql.slice('BEGIN;\n'.length, sql.lastIndexOf('\nCOMMIT;') + 1));
    assert.match(body, /^\n?(?:--[^\n]*\n|\n)*SET LOCAL lock_timeout = '5s';\n/u);
    for (const [label, changed] of [['header without BEGIN', sql.replace('BEGIN;\n', '')],
      ['BEGIN with options', sql.replace('BEGIN;\n', 'BEGIN ISOLATION LEVEL SERIALIZABLE;\n')],
      ['no final COMMIT', sql.slice(0, sql.lastIndexOf('COMMIT;'))], ['statement after COMMIT', `${sql}DELETE FROM public.profiles;\n`],
      ...['COMMIT;', 'ROLLBACK;', 'END;', 'ABORT;', 'START TRANSACTION;', 'BEGIN;', 'SAVEPOINT before_rows;',
        'RELEASE SAVEPOINT before_rows;', '  commit;'].map(statement => [`nested ${statement}`, beforeCommit(sql, statement)]),
    ]) assert.throws(() => unwrapMigration(changed), /APRO_SQL_TRANSACTION_BOUNDARY_INVALID/u, label);
  }
  // 머리 주석·빈 줄은 건너뛰고, 함수 본문 안의 BEGIN/END 는 거래 경계가 아니다.
  assert.equal(unwrapMigration('-- 머리 주석 BEGIN;\n--\n\nBEGIN;\nSELECT 1;\nCOMMIT;\n'), 'SELECT 1;\n');
});

// 줄 머리만 보면 'SELECT 1; COMMIT;' 처럼 한 줄에 놓인 거래 경계를 놓친다(2026-11-18). 문장 단위로 나눠 본다.
const TRANSACTION_HEAD = /^(?:BEGIN|COMMIT|ROLLBACK|END|ABORT|START|SAVEPOINT|RELEASE|PREPARE|SET\s+(?:SESSION\s+)?TRANSACTION|SET\s+SESSION)\b/iu;
test('the real bodies split into reviewed statement kinds and none of them is transaction control', () => {
  const counts = realSqls.map(sql => topLevelStatements(unwrapMigration(sql)).length);
  assert.deepEqual(counts, [41, 60, 11, 40]);
  const heads = new Set(realSqls.flatMap(sql => topLevelStatements(unwrapMigration(sql)).map(statement => statement.split(/\s+/u)[0].toUpperCase())));
  assert.deepEqual([...heads].sort(), ['ALTER', 'COMMENT', 'CREATE', 'DO', 'DROP', 'GRANT', 'REVOKE', 'SET', 'UPDATE']);
  assert.deepEqual(realSqls.flatMap(sql => topLevelStatements(unwrapMigration(sql))).filter(statement => TRANSACTION_HEAD.test(statement)), []);
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
  assert.throws(() => unwrapMigration('BEGIN;\nSELECT 1; COMMIT;\nSELECT 2;\nCOMMIT;\n'), /APRO_SQL_TRANSACTION_BOUNDARY_INVALID/u);
  for (const [label, body] of [
    ['comment with $$ then a mid-line COMMIT', '-- costs $$\nSELECT 1; COMMIT;'],
    ['dollar tag glued to an ASCII name', 'CREATE SCHEMA x$$f$; COMMIT; CREATE SCHEMA y$$f$;'],
    ['dollar tag glued to a non-ASCII name', 'CREATE SCHEMA 한$f$; COMMIT; CREATE SCHEMA 둘$f$;'],
    ["e' glued to a non-ASCII name", String.raw`CREATE DOMAIN public.한e AS text; SELECT 한e'\'; COMMIT; -- '`],
    ['PREPARE TRANSACTION', "SELECT 1; PREPARE TRANSACTION 'apro';"],
    ['SET TRANSACTION', 'SELECT 1; SET TRANSACTION READ WRITE;'],
    ['unterminated string', "SELECT 'never closed;"], ['unterminated block comment', 'SELECT 1; /* never closed'],
    ['unterminated dollar body', 'SELECT $x$ never closed;'],
  ]) assert.throws(() => unwrapMigration(wrap(body)), /APRO_SQL_TRANSACTION_BOUNDARY_INVALID/u, label);
  // 원문(raw)은 앞 주석을 빼고 문장 그대로다. sha256 은 이 원문으로 잰다.
  assert.deepEqual(splitStatements("-- head\nUPDATE t SET a = 'x;y' -- tail\n;\n/* c */ SELECT 1;").map(s => s.raw),
    ["UPDATE t SET a = 'x;y' -- tail", 'SELECT 1']);
});

test('the statement splitter counts the same top-level statements as PostgreSQL itself on tricky but valid SQL', async () => {
  const db = await openPglite(sourceRoot);
  try {
    for (const sql of [
      "SELECT 'a; COMMIT; b';", String.raw`SELECT E'it\'s; COMMIT;';`, String.raw`SELECT e'\\'; SELECT 1;`,
      "SELECT 'it''s; COMMIT;';", 'SELECT 1 AS "x; COMMIT";', '/* COMMIT; */ SELECT 2;', '-- COMMIT;\nSELECT 3;',
      'SELECT $$ ; COMMIT; $$;', 'SELECT $f$ $$ ; $f$;', String.raw`SELECT U&'d\0061t\+000061; COMMIT;';`,
      'CREATE FUNCTION pg_temp.apro_probe() RETURNS integer LANGUAGE plpgsql AS $body$\nBEGIN\n  RETURN 1;\nEND;\n$body$;',
      'CREATE SCHEMA x$$f$; CREATE SCHEMA y$$f$;', 'CREATE SCHEMA 한$f$; CREATE SCHEMA 둘$f$;',
      String.raw`CREATE DOMAIN public.한e AS text; SELECT 한e'\'; SELECT 1; -- '`,
    ]) {
      await db.exec('BEGIN;');
      try { assert.equal(topLevelStatements(sql).length, (await db.exec(sql)).length, sql); } finally { await db.exec('ROLLBACK;'); }
    }
  } finally { await db.close(); }
});

test('on PGlite the real SQL leaves the preserved digest unchanged and every unlisted existing-catalog change moves it', async () => {
  const db = await preparedPglite();
  try {
    const before = await valueOf(db, preservedCatalogSql());
    assert.match(before, /^[a-f0-9]{32}$/u);
    for (const sql of realSqls) await db.exec(sql);
    await db.exec('SET search_path = pg_catalog, public;');
    assert.equal(await valueOf(db, preservedCatalogSql()), before, 'only the listed parts may change existing catalog');
    for (const [label, change] of [
      ['an unlisted column on profiles', 'ALTER TABLE public.profiles ADD COLUMN care_extra text;'],
      ['an unlisted CHECK on profiles', 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_care_extra CHECK (true);'],
      ['an unlisted trigger on profiles', 'CREATE TRIGGER trg_care_extra BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.normalize_amora_care_email_consent();'],
      ['the comment of an unlisted profiles column', "COMMENT ON COLUMN public.profiles.name IS 'changed';"],
      ['the comment of the profiles table', "COMMENT ON TABLE public.profiles IS 'changed';"],
      ['a default on an existing profiles column', 'ALTER TABLE public.profiles ALTER COLUMN care_notifications_enabled SET DEFAULT true;'],
      ['the other TodayOne CHECK', 'ALTER TABLE public.amora_today_one_signals DROP CONSTRAINT amora_today_one_signals_kind_presentation_check;'],
      ['a column comment on TodayOne signals', "COMMENT ON COLUMN public.amora_today_one_signals.kind IS 'changed';"],
      ['a policy on public.couples', 'CREATE POLICY apro_extra_read ON public.couples FOR SELECT TO authenticated USING (true);'],
      ['the owner of an existing function', 'ALTER FUNCTION public.amora_care_delivery_clock() OWNER TO service_role;'],
      ['a grant on an existing function', 'GRANT EXECUTE ON FUNCTION public.amora_today_one_text_is_safe(text, integer, integer) TO anon;'],
      // 운영처럼 기본 권한이 anon 에게도 열려 있어 그 역할에 다시 주는 것은 그대로다. 아무 권한이 없던 PUBLIC 에게 준다.
      ['a grant on an existing table', 'GRANT SELECT ON public.couples TO PUBLIC;'],
      ['a revoke on an existing table', 'REVOKE SELECT ON public.couples FROM anon;'],
      ['publication membership of an existing table', 'CREATE PUBLICATION apro_extra_pub FOR TABLE public.profiles;'],
      ['an unlisted public function', 'CREATE FUNCTION public.amora_care_extra() RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$;'],
      ['a new view', 'CREATE VIEW public.amora_care_extra_view AS SELECT id FROM public.couples;'],
    ]) assert.notEqual(await within(db, change, preservedCatalogSql()), before, label);
    assert.equal(await valueOf(db, preservedCatalogSql()), before, 'every probe was rolled back');
  } finally { await db.close(); }
});

test('before apply the target catalog equals the pinned pre-apply catalog and every missing prerequisite is named', async () => {
  const empty = await openPglite(sourceRoot);
  try {
    const everything = [...PREREQUISITES.relations.map(([schema, name]) => `relation:${schema}.${name}`),
      ...PREREQUISITES.columns.map(([schema, table, column]) => `column:${schema}.${table}.${column}`),
      ...PREREQUISITES.functions.map(([schema, name, args]) => `function:${schema}.${name}(${args})`),
      ...PREREQUISITES.constraints.map(([schema, table, constraint]) => `constraint:${schema}.${table}.${constraint}`),
      ...PREREQUISITES.checkValues.map(([schema, table, constraint, value]) => `check:${schema}.${table}.${constraint}:${value}`)].sort();
    assert.deepEqual(await valueOf(empty, missingPrerequisitesSql()), everything);
  } finally { await empty.close(); }
  const db = await preparedPglite();
  try {
    assert.deepEqual(await readTargetCatalog(db), pinned.before);
    assert.deepEqual(pinned.before.functions.map(f => f.name).sort(), [...PRE_EXISTING_FUNCTIONS].sort());
    assert.deepEqual(await valueOf(db, missingPrerequisitesSql()), []);
    const missing = change => within(db, change, missingPrerequisitesSql());
    assert.deepEqual(await missing('ALTER TABLE public.amora_care_jobs DROP COLUMN lease_token;'), ['column:public.amora_care_jobs.lease_token']);
    assert.deepEqual(await missing('DROP FUNCTION public.get_mobile_push_delivery_targets(uuid);'),
      ['function:public.get_mobile_push_delivery_targets(uuid)']);
    assert.deepEqual(await missing('ALTER TABLE public.amora_today_one_signals DROP CONSTRAINT amora_today_one_signals_kind_presentation_check;'),
      ['constraint:public.amora_today_one_signals.amora_today_one_signals_kind_presentation_check']);
    assert.deepEqual(await missing(`ALTER TABLE public.amora_care_deliveries DROP CONSTRAINT amora_care_deliveries_status_check;
      ALTER TABLE public.amora_care_deliveries ADD CONSTRAINT amora_care_deliveries_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired', 'cancelled'));`),
    ['check:public.amora_care_deliveries.amora_care_deliveries_status_check:skipped']);
    // 바꿀 기존 함수가 운영에서 다르면(본문 한 글자, 권한 하나) 적용 전 모양이 고정값과 달라진다.
    assert.notDeepEqual(await within(db, 'GRANT EXECUTE ON FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean) TO authenticated;',
      targetCatalogSql()), pinned.before);
    assert.notDeepEqual(await within(db, "COMMENT ON COLUMN public.profiles.care_notifications_enabled IS 'changed';", targetCatalogSql()),
      pinned.before);
  } finally { await db.close(); }
});

// 운영 지문(supabase/release-contracts/amora-explicit-budget-production-baseline-20260911.json)과 같은 식으로 잰다.
const FINGERPRINT_SQL = `SELECT p.proname AS name, format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS identity,
 encode(sha256(convert_to(jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',pg_get_userbyid(p.proowner))::text,'UTF8')),'hex') AS sha256
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname = ANY($1) ORDER BY 1`;
test('production fingerprints of 2026-09-11 match the rebuilt care functions, but TodayOne is still the 20260802130000 state', async () => {
  const baseline = JSON.parse(readFileSync(resolve(sourceRoot,
    'supabase/release-contracts/amora-explicit-budget-production-baseline-20260911.json'), 'utf8'));
  const recorded = new Map(baseline.objects.filter(o => o.kind === 'function').map(o => [o.identity, o.sha256]));
  const verdict = async db => Object.fromEntries((await db.query(FINGERPRINT_SQL, [[...PRE_EXISTING_FUNCTIONS]])).rows
    .map(row => [row.name, recorded.get(row.identity) === row.sha256]));
  const rebuilt = await preparedPglite();
  try {
    // 운영처럼 public 기본 권한을 네 역할에 열어 둔 채 원문을 올리면, 이름을 옮길 여섯 함수의 정의·권한·소유자가 운영과 같다.
    assert.deepEqual(await verdict(rebuilt), { amora_today_one_presentation_is_valid: false, claim_amora_care_email_delivery: true,
      insert_amora_care_message: true, insert_amora_moment_care_message: true, patch_profile_atomic: true, prepare_amora_care_job: true,
      prevent_direct_amora_care_consent_change: true });
  } finally { await rebuilt.close(); }
  // 원장에는 20260802150000 이 있지만 그날 운영의 TodayOne 검사 함수는 그 앞 판(20260802130000)과 같았다.
  const drift = await preparedPglite({ priorMigrations: PRIOR_MIGRATIONS.filter(name => !name.startsWith('20260802150000')) });
  try {
    assert.equal((await verdict(drift)).amora_today_one_presentation_is_valid, true);
    // 그 상태면 점검 단계가 쓰기 전에 막는다: kind·presentation 짝 CHECK 가 없고, 적용 전 모양도 고정값과 다르다.
    await drift.exec(LEDGER_SQL);
    const observed = asProduction(await observeOn(drift));
    const plan = loadPlan(sourceRoot);
    assert.deepEqual(observed.missingPrerequisites,
      ['constraint:public.amora_today_one_signals.amora_today_one_signals_kind_presentation_check']);
    assert.throws(() => validateObservation(observed, plan, new Date(Date.parse(observed.observedAt))), hasCode('APRO_PREREQUISITE_MISSING'));
    assert.throws(() => validateObservation({ ...observed, missingPrerequisites: [] }, plan, new Date(Date.parse(observed.observedAt))),
      hasCode('APRO_TARGET_BEFORE_DRIFT'));
  } finally { await drift.close(); }
});

test('on PGlite the exact bundle rehearses with ROLLBACK, refuses drift, then commits four ledger rows and the pinned catalog', async () => {
  const repo = repoFixture(), db = await preparedPglite();
  try {
    const plan = loadPlan(repo.dir);
    await db.exec(`${LEDGER_SQL}\n${SEED_SQL}`);
    const before = await observeOn(db);
    // 운영 신원 검사는 이 엔진을 운영으로 보지 않는다. 그 밖의 관측은 실제 값이다.
    assert.equal(before.identityReady, false);
    assert.deepEqual(before.catalog, plan.beforeCatalog); assert.deepEqual(before.missingPrerequisites, []);
    assert.deepEqual(before.migrations, []); assert.equal(before.ledgerCount, 3); assert.equal(before.ledgerSha, before.ledgerWithoutTargetSha);
    assert.doesNotThrow(() => validateObservation(asProduction(before), plan, new Date(Date.parse(before.observedAt))));
    const deadline = new Date(Date.now() + 120_000).toISOString();
    const bundle = overrides => buildMutationSql({ sqls: plan.sqls, before, beforeCatalog: plan.beforeCatalog, catalog: plan.catalog,
      deadline, rehearsal: true, ...overrides });
    const unchanged = async label => {
      const value = await observeOn(db);
      for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'ledgerHead', 'migrations']) {
        assert.deepEqual(value[key], before[key], `${label}: ${key}`);
      }
      assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM public.profiles')).rows[0].n, 2, label);
    };
    // 실패한 묶음은 거래를 깨진 채로 남긴다. 운영 응답처럼 닫고, 아무것도 남지 않았는지 본다.
    const refused = async (sql, code, label) => {
      await assert.rejects(db.exec(sql), error => new RegExp(code, 'u').test(error.message), label);
      await db.exec('ROLLBACK;');
      await unchanged(label);
    };
    await refused(bundle(), 'APRO_TARGET_DRIFT', 'production identity guard on a non-production engine');
    await refused(withoutProductionIdentity(bundle({ deadline: new Date(Date.now() - 60_000).toISOString() })),
      'APRO_DEADLINE_EXPIRED', 'expired deadline');
    await refused(withoutProductionIdentity(bundle({ before: { ...before, preservedCatalogSha: hash('f') } })),
      'APRO_BASELINE_DRIFT', 'stale preserved digest');
    await refused(`BEGIN; COMMENT ON COLUMN public.profiles.care_notifications_enabled IS 'drifted';\n${withoutProductionIdentity(bundle())}`,
      'APRO_BASELINE_DRIFT', 'pre-apply target object changed after observation');
    await refused(`BEGIN; ALTER TABLE public.amora_care_jobs RENAME COLUMN lease_token TO lease_token_moved;\n${withoutProductionIdentity(bundle())}`,
      'APRO_PREREQUISITE_MISSING', 'prerequisite removed after observation');
    // 검토한 이어받기 UPDATE 가 빠진 본문은 catalog 는 같아도 데이터 확인에서 막힌다.
    const withoutBackfill = [plan.sqls[0].replace(/UPDATE public\.profiles\nSET care_email_enabled = true,[\s\S]*?AND care_email_enabled = false;\n/u, ''),
      ...plan.sqls.slice(1)];
    assert.notEqual(withoutBackfill[0], plan.sqls[0]);
    await refused(withoutProductionIdentity(bundle({ sqls: withoutBackfill })), 'APRO_AFTER_DRIFT', 'skipped consent backfill');
    const rehearsal = withoutProductionIdentity(bundle());
    assert.ok(rehearsal.endsWith('ROLLBACK;'));
    await db.exec(rehearsal);
    await unchanged('rehearsal');
    const tampered = structuredClone(plan.catalog); part(tampered, 'profiles').triggers[0][1] = 'D';
    await refused(withoutProductionIdentity(bundle({ catalog: tampered, rehearsal: false })), 'APRO_AFTER_DRIFT', 'tampered expected catalog');
    const apply = withoutProductionIdentity(bundle({ rehearsal: false }));
    assert.ok(apply.endsWith('COMMIT;'));
    await db.exec(apply);
    const after = await observeOn(db);
    assert.equal(after.ledgerCount, before.ledgerCount + 4);
    assert.equal(after.ledgerWithoutTargetSha, before.ledgerSha); assert.notEqual(after.ledgerSha, before.ledgerSha);
    assert.equal(after.preservedCatalogSha, before.preservedCatalogSha);
    assert.equal(after.ledgerHead, '20261120130000');
    assert.deepEqual(after.catalog, plan.catalog);
    assert.deepEqual(after.catalog, pinned.after);
    assert.deepEqual(after.migrations, appliedRows(plan));
    assert.doesNotThrow(() => validateObservation(asProduction(after), plan, new Date(Date.parse(after.observedAt))));
    for (const table of TABLES) assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, 0, table);
    // 시각은 글이 아니라 순간으로 비교한다(PGlite 는 컴퓨터의 시간대로 글을 쓴다).
    assert.deepEqual((await db.query(`SELECT id, care_email_enabled,
      care_email_consented_at = timestamptz '2026-11-01T00:00:00Z' AS carried, care_intensity
      FROM public.profiles ORDER BY id`)).rows, [
      { id: BRIDE, care_email_enabled: true, carried: true, care_intensity: 'normal' },
      { id: GROOM, care_email_enabled: false, carried: null, care_intensity: 'normal' }]);
  } finally { await db.close(); repo.close(); }
});

test('the listed existing-table parts and target names are exactly what the fixture pins after apply', () => {
  for (const change of EXISTING_TABLE_CHANGES) {
    const after = part(pinned.after, change.table), before = part(pinned.before, change.table);
    assert.deepEqual(after.columns.map(c => c[0]).sort(), [...change.columns].sort(), change.table);
    assert.deepEqual(after.constraints.map(c => c[0]).sort(), [...change.constraints].sort(), change.table);
    assert.deepEqual(after.triggers.map(t => t[0]).sort(), [...change.triggers].sort(), change.table);
    assert.deepEqual(before.columns, [], change.table);
  }
  assert.deepEqual(part(pinned.before, 'profiles').triggers.map(t => t[0]), ['trg_prevent_direct_amora_care_consent_change']);
  assert.deepEqual(pinned.after.functions.map(f => f.name).sort(), [...FUNCTIONS].sort());
  // service_role 을 거두지 않은 순수 함수 하나는 운영 기본 권한대로 service_role 에게 남는다(PUBLIC·anon·authenticated 는 없다).
  assert.deepEqual(pinned.after.functions.find(f => f.name === 'amora_care_is_imminent').acl.map(a => a[0]), ['postgres', 'service_role']);
});

// ── 실제 PostgreSQL 17(운영과 같은 큰 판) ───────────────────────────────────
// CI 는 PostgreSQL 17 을 /usr/lib/postgresql/17/bin 에 깔고 HANBANG_MAINTENANCE_NATIVE_PG_BIN 으로만 알린다.
// 이 픽스처는 HANBANG_SYNTHETIC_PG_BIN(또는 Windows 의 %LOCALAPPDATA% 고정 경로)만 읽으므로 CI 에서는 건너뛴다.
const nativeSkip = nativeProfileRoleAvailable ? false
  : 'PostgreSQL 17 binaries not visible: profile-role-native-database.mjs reads only HANBANG_SYNTHETIC_PG_BIN or, on Windows, '
    + '%LOCALAPPDATA%/WeddingHanbangTools/postgresql-17.10/pgsql/bin (CI exposes /usr/lib/postgresql/17/bin only as HANBANG_MAINTENANCE_NATIVE_PG_BIN)';
test('native PostgreSQL 17 rebuilds the same pinned before and after catalogs and keeps the preserved digest', { skip: nativeSkip }, async () => {
  const owned = await createProfileRoleNativeDatabase();
  try {
    const db = { exec: sql => owned.client.query(sql), query: (sql, params) => owned.client.query(sql, params) };
    assert.match((await db.query('SHOW server_version')).rows[0].server_version, /^17\./u);
    await preparePrerequisites(db, sourceRoot);
    await db.exec(LEDGER_SQL);
    const before = await observeOn(db);
    assert.deepEqual(before.missingPrerequisites, []);
    assert.equal(`${JSON.stringify(before.catalog, null, 2)}\n`, `${JSON.stringify(pinned.before, null, 2)}\n`);
    for (const sql of realSqls) await db.exec(sql);
    const catalog = await readTargetCatalog(db);
    assert.equal(`${JSON.stringify(catalog, null, 2)}\n`, `${JSON.stringify(pinned.after, null, 2)}\n`);
    const after = await observeOn(db);
    assert.equal(after.preservedCatalogSha, before.preservedCatalogSha);
    assert.deepEqual(after.catalog, pinned.after);
  } finally { await owned.close(); }
});
