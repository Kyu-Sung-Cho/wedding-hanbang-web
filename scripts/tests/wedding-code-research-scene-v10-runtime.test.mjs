import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendWeddingCodeSceneV10Receipt, buildWeddingCodeSceneV10MutationSql, buildWeddingCodeSceneV10ObservationSql,
  expectedWeddingCodeSceneV10Catalog, parseWeddingCodeSceneV10ReleaseArgs, runWeddingCodeSceneV10Release,
  validateWeddingCodeSceneV10Catalog, validateWeddingCodeSceneV10Observation, weddingCodeSceneV10LedgerDigestSql,
} from '../lib/wedding-code-research-scene-v10-release.mjs';
import { expectedWeddingCodeSceneVersionCatalog } from '../lib/wedding-code-research-scene-v09-release.mjs';
import { weddingCodeResearchTargetCatalogSql } from '../lib/wedding-code-research-contributions-release.mjs';
import { CurrentBaselineBlocked } from '../lib/current-baseline-release-contract.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = file => readFileSync(join(root, file), 'utf8');
const sql = read('supabase/migrations/20260918090000_wedding_code_research_scene_v10.sql');
const predecessorSql = read('supabase/migrations/20260917090000_wedding_code_research_scene_v09.sql');
const storeSql = read('supabase/migrations/20260915130000_wedding_code_research_contributions.sql');
const context = { sql, predecessorSql, storeSql };
const md5 = value => createHash('md5').update(value).digest('hex');
const instant = new Date('2026-09-18T07:00:00Z'), commit = 'a'.repeat(40), project = 'slrtobkksjmxgzatjyqb';
const code = value => error => error?.code === value;
const V08 = "CHECK (scene_version = 'v0.8-code'::text)";
const V09 = "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text]))";
const V10 = "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text, 'v1.0-code'::text]))";
const args = (mode = 'apply') => ['--wedding-code-research-scene-v10', `--${mode}`, `--expected-commit=${commit}`, `--project-ref=${project}`,
  `--receipt-out=${join(tmpdir(), 'unused-wedding-code-scene-v10-synthetic.jsonl')}`,
  `--confirm-production=wedding-code-research-scene-v10-20260918:${project}:${mode}:${commit}`];
const before = () => ({ format: 'wedding-code-research-scene-v10-catalog-v1', systemIdentifier: '7581440907192989109', serverVersion: '17.6',
  database: 'postgres', currentUser: 'postgres', readOnly: true, observedAt: instant.toISOString(),
  catalog: expectedWeddingCodeSceneV10Catalog(storeSql, false), preservedCatalogSha: 'e'.repeat(32),
  ledgerSha: 'b'.repeat(32), ledgerWithoutTargetSha: 'b'.repeat(32), ledgerCount: 235, migration: null,
  predecessor: { version: '20260917090000', name: 'wedding_code_research_scene_v09', statementCount: 1, sqlMd5: md5(predecessorSql) } });
const after = () => ({ ...before(), catalog: expectedWeddingCodeSceneV10Catalog(storeSql, true), ledgerSha: 'c'.repeat(32), ledgerCount: 236,
  migration: { version: '20260918090000', name: 'wedding_code_research_scene_v10', statementCount: 1, sqlMd5: md5(sql) } });
const contributions = value => value.catalog.relations.find(relation => relation.name === 'public.wedding_code_research_contributions');
const withScene = (base, definition) => {
  const value = base; const row = contributions(value).constraints.find(item => item[0] === 'wcr_contributions_scene_version');
  row[3] = definition; return value;
};
const withRelation = (base, change) => { const value = base; value.catalog.relations[0] = { ...value.catalog.relations[0], ...change }; return value; };
const withFunction = (base, change) => { const value = base; value.catalog.functions[0] = { ...value.catalog.functions[0], ...change }; return value; };

function fixture({ mode = 'apply', observations = [before(), before(), after()], onQuery, onRecord, onSource, now } = {}) {
  const calls = [], events = []; let reads = 0, closed = false, sourceChecks = 0;
  return { calls, events, get closed() { return closed; }, get sourceChecks() { return sourceChecks; },
    run: () => runWeddingCodeSceneV10Release({ repoRoot: root, argv: args(mode), now: now ?? (() => instant),
      assertSource: () => { sourceChecks += 1; onSource?.(sourceChecks); },
      receiptFactory: () => ({ append: event => { onRecord?.(event); events.push(event); }, close: () => { closed = true; } }),
      query: async text => { calls.push(text); await onQuery?.(text, calls.length);
        return text === buildWeddingCodeSceneV10ObservationSql() ? [{ observation: structuredClone(observations[reads++]) }] : []; } }) };
}

test('the expected catalog differs from the 235 state only in the scene version CHECK definition', () => {
  const unapplied = expectedWeddingCodeSceneV10Catalog(storeSql, false);
  const applied = expectedWeddingCodeSceneV10Catalog(storeSql, true);
  const scene = catalog => contributions({ catalog }).constraints.filter(row => row[0] === 'wcr_contributions_scene_version');
  assert.deepEqual(scene(unapplied), [['wcr_contributions_scene_version', 'c', true, V09]]);
  assert.deepEqual(scene(applied), [['wcr_contributions_scene_version', 'c', true, V10]]);
  // 적용 전 기대값은 235 lane의 적용 후 기대값과 같다(235가 운영에 남긴 상태에서 출발한다).
  assert.deepEqual(unapplied, expectedWeddingCodeSceneVersionCatalog(storeSql, true));
  assert.deepEqual(withScene({ catalog: structuredClone(applied) }, V09).catalog, unapplied);
  assert.notDeepEqual(applied, unapplied);
  assert.equal(applied.functions.length, 3); assert.equal(applied.relations.length, 2);
  // 기대 함수 본문은 234 원문에서 읽는다. 235·236 원문(함수 없음)을 넘기면 거절한다.
  for (const wrong of [sql, predecessorSql])
    assert.throws(() => expectedWeddingCodeSceneV10Catalog(wrong, false), code('WEDDING_CODE_RESEARCH_SQL_FUNCTION_SET_INVALID'));
});

test('apply observes, rehearses the exact CHECK swap, rechecks the source, commits once and postverifies', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, 'applied-and-postverified'); assert.equal(result.remoteWritesPerformed, true);
  assert.equal(f.calls.length, 5); assert.equal(f.closed, true); assert.equal(f.sourceChecks, 2);
  assert.equal(f.calls[1].replace(/ROLLBACK;$/, 'COMMIT;'), f.calls[3]);
  assert.match(f.calls[1], /ROLLBACK;$/); assert.match(f.calls[3], /COMMIT;$/);
  assert.match(f.calls[1], /DROP CONSTRAINT wcr_contributions_scene_version,\n {2}ADD CONSTRAINT wcr_contributions_scene_version CHECK \(scene_version IN \('v0\.8-code', 'v0\.9-code', 'v1\.0-code'\)\);/);
  assert.match(f.calls[1], /INSERT INTO supabase_migrations\.schema_migrations\(version,name,statements\)\n VALUES\('20260918090000','wedding_code_research_scene_v10'/);
  assert.match(f.calls[1], /pg_advisory_xact_lock\(60918,1\)/);
  // 고정 migration 원문, 원장 기록 문자열, 적용 전·후 기대 catalog 문자열을 뺀 감싸는 부분에는
  // 권한 전환·데이터 쓰기·권한 부여·다른 DDL 구문이 없다.
  const body = sql.replace(/^[\s\S]*?\bBEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  let envelope = f.calls[1].split(body).join('').split(`ARRAY['${sql.replaceAll("'", "''")}']::text[]`).join('ARRAY[]::text[]');
  const beforeLiteral = `'${JSON.stringify(before().catalog).replaceAll("'", "''")}'::jsonb`;
  assert.equal(envelope.split(beforeLiteral).length, 2);
  envelope = envelope.split(beforeLiteral).join("'{}'::jsonb");
  for (const { body: source } of expectedWeddingCodeSceneV10Catalog(storeSql, true).functions) {
    const quoted = `'${JSON.stringify(source).replaceAll("'", "''")}'::jsonb`;
    assert.equal(envelope.split(quoted).length, 2);
    envelope = envelope.split(quoted).join("'\"\"'::jsonb");
  }
  // 사후 검사의 기대 catalog에는 세 값 CHECK 행만 있고, 235의 두 값 행이나 234의 v0.8 행은 없다.
  const tuple = definition => `'${JSON.stringify(['wcr_contributions_scene_version', 'c', true, definition]).replaceAll("'", "''")}'::jsonb`;
  assert.equal(envelope.split(tuple(V10)).length, 2);
  assert.equal(envelope.includes(tuple(V09)), false); assert.equal(envelope.includes(tuple(V08)), false);
  assert.equal(envelope.length < 60_000, true);
  // 기대 catalog의 인덱스 정의 문자열(`CREATE [UNIQUE] INDEX ...`)만 CREATE를 담는다.
  assert.equal(/\bSET (?:LOCAL )?ROLE\b|\bDELETE FROM\b|\bUPDATE \w|\bTRUNCATE \w|\bGRANT \w|\bREVOKE \w|\bDROP \w|\bALTER \w/.test(envelope), false);
  assert.equal(/\bCREATE (?!(?:UNIQUE )?INDEX wcr_)/.test(envelope), false);
  assert.deepEqual(f.events.map(event => event.status), ['started', 'before-observed', 'rehearsal-outcome-unverified', 'rehearsed-and-rolled-back',
    'apply-outcome-unverified', 'applied-and-postverified']);
  for (const event of f.events) {
    assert.equal(event.format, 'wedding-code-research-scene-v10-runtime-v1'); assert.equal(event.release, 'wedding-code-research-scene-v10-20260918');
    assert.equal(event.projectRef, project); assert.equal(event.releaseCommit, commit);
  }
});

test('inspect, rehearse and an already-applied ledger never commit a mutation and record the mirrored statuses', async () => {
  for (const [options, status] of [[{ mode: 'inspect' }, 'inspected-unapplied'], [{ mode: 'rehearse' }, 'rehearsed-and-rolled-back'],
    [{ observations: [after()] }, 'already-applied-verified'], [{ mode: 'inspect', observations: [after()] }, 'already-applied-verified']]) {
    const f = fixture(options); const result = await f.run();
    assert.equal(result.status, status); assert.equal(result.remoteWritesPerformed, false);
    assert.equal(f.calls.filter(text => !text.startsWith('BEGIN READ ONLY') && text.endsWith('COMMIT;')).length, 0);
    assert.equal(f.events.at(-1).status, status); assert.equal(f.closed, true);
  }
});

test('malformed, mixed, wrong destination and unconfirmed arguments fail before any network call', () => {
  for (const argv of [[], args().slice(0, -1), [...args(), '--rehearse'], [...args(), '--apply'], [...args(), '--wedding-code-research-scene-v09'],
    [...args(), '--wedding-code-research-scene-v10'], [...args(), '--unknown'],
    args().map(arg => arg.startsWith('--project-ref=') ? '--project-ref=abcdefghijklmnopqrst' : arg),
    args().map(arg => arg.startsWith('--expected-commit=') ? '--expected-commit=bad' : arg),
    args().map(arg => arg.startsWith('--receipt-out=') ? '--receipt-out=relative.jsonl' : arg),
    args().map(arg => arg.startsWith('--confirm-production=') ? `${arg}x` : arg),
    args().map(arg => arg.startsWith('--confirm-production=')
      ? `--confirm-production=wedding-code-research-scene-v09-20260917:${project}:apply:${commit}` : arg),
    args('inspect').map(arg => arg.startsWith('--confirm-production=')
      ? `--confirm-production=wedding-code-research-scene-v10-20260918:${project}:apply:${commit}` : arg)])
    assert.throws(() => parseWeddingCodeSceneV10ReleaseArgs(argv), /WEDDING_CODE_SCENE_V10_/);
});

test('wrong target, missing predecessor, catalog drift, widened grants and ledger conflicts stop before mutation', async () => {
  const invalid = [
    { ...before(), systemIdentifier: '1' }, { ...before(), readOnly: false }, { ...before(), currentUser: 'service_role' },
    { ...before(), database: 'other' }, { ...before(), serverVersion: '18.3' }, { ...before(), observedAt: '2026-09-18T06:57:59Z' },
    { ...before(), observedAt: '2026-09-18T07:00:11Z' }, { ...before(), format: 'wedding-code-research-scene-v09-catalog-v1' },
    { ...before(), predecessor: { ...before().predecessor, statementCount: 40 } },
    // 235 이력 대신 234 이력을 선행으로 내미는 경우
    { ...before(), predecessor: { version: '20260915130000', name: 'wedding_code_research_contributions', statementCount: 1, sqlMd5: md5(storeSql) } },
    // 234 객체가 없는 운영(선행 이력만 있고 테이블이 없는 경우)
    { ...before(), catalog: { relations: [], functions: [] } },
    // 이력은 235까지 있다는데 CHECK가 아직 v0.8 전용이거나, 이력 없이 v1.0까지 넓어졌거나, 다른 식으로 넓어진 경우
    withScene(before(), V08), withScene(before(), V10), withScene(before(), "CHECK (scene_version ~ '^v[0-9][.][0-9]-code$'::text)"),
    withScene(before(), "CHECK (scene_version = ANY (ARRAY['v0.9-code'::text, 'v1.0-code'::text]))"),
    { ...before(), ledgerWithoutTargetSha: 'd'.repeat(32) },
    // 이력은 적용됐다고 하는데 원문이 다르거나, catalog가 넓어지지 않았거나, 다르게 넓어진 경우
    { ...after(), migration: { ...after().migration, sqlMd5: 'd'.repeat(32) } },
    { ...after(), migration: { ...after().migration, name: 'other' } },
    { ...after(), catalog: before().catalog },
    withScene(after(), "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text, 'v1.0-code'::text, 'v1.1-code'::text]))"),
    withScene(after(), "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v1.0-code'::text]))"),
    withRelation(before(), { rls: false }), withRelation(after(), { rls: false }), withRelation(after(), { policies: [{ polname: 'open' }] }),
    withRelation(after(), { acl: [...after().catalog.relations[0].acl, ['anon', 'postgres', 'SELECT', false]] }),
    withFunction(after(), { securityDefiner: false }), withFunction(before(), { config: ['search_path=public'] }),
    withFunction(after(), { acl: [...after().catalog.functions[0].acl, ['authenticated', 'postgres', 'EXECUTE', false]] }),
    withFunction(after(), { body: after().catalog.functions[0].body.replace('RAISE EXCEPTION', 'RAISE NOTICE') }),
  ];
  // 판정 함수만 먼저 전부 확인한다. 실행기 경로(원문 핀 검사 포함)에 가려 판정 누락이 초록불로 남지 않게 한다.
  for (const observed of invalid)
    assert.throws(() => validateWeddingCodeSceneV10Observation(observed, { ...context, now: instant }), JSON.stringify(observed).slice(0, 120));
  for (const observed of invalid) {
    const f = fixture({ observations: [observed] }); await assert.rejects(f.run());
    assert.equal(f.calls.length, 1); assert.equal(f.events.at(-1).status, 'blocked-before-mutation');
  }
  assert.throws(() => buildWeddingCodeSceneV10MutationSql({ ...context, before: withScene(before(), V10),
    deadline: '2026-09-18T07:02:00.000Z', rehearsal: true }), code('WEDDING_CODE_SCENE_V10_TARGET_CATALOG_DRIFT'));
  assert.throws(() => buildWeddingCodeSceneV10MutationSql({ ...context, before: after(),
    deadline: '2026-09-18T07:02:00.000Z', rehearsal: true }), code('WEDDING_CODE_SCENE_V10_BUNDLE_INVALID'));
});

// 235 릴리스가 운영에 없을 때 운영자가 할 일을 오류 문구로 정확히 안내한다.
const BASE_235 = 'd643b5f49043ac2a97752cd5df516a9ba8d402e0';
test('a missing predecessor stops before mutation and tells the operator the exact 235-first order', async () => {
  const missing = { ...before(), predecessor: null };
  const expectGuidance = error => {
    assert.ok(error instanceof CurrentBaselineBlocked); assert.equal(error.code, 'WEDDING_CODE_SCENE_V10_PREDECESSOR_NOT_APPLIED');
    for (const part of ['20260917090000', 'wedding_code_research_scene_v09', BASE_235, '--wedding-code-research-scene-v09',
      '--inspect', '--rehearse', '--apply', `--confirm-production=wedding-code-research-scene-v09-20260917:${project}:<mode>:${BASE_235}`,
      'applied-and-postverified', '--wedding-code-research-scene-v10 --inspect', 'schema_migrations', '236개'])
      assert.ok(error.message.includes(part), part);
    return true;
  };
  assert.throws(() => validateWeddingCodeSceneV10Observation(missing, { ...context, now: instant }), expectGuidance);
  const f = fixture({ observations: [missing] });
  await assert.rejects(f.run(), expectGuidance);
  assert.equal(f.calls.length, 1); assert.equal(f.closed, true);
  assert.deepEqual([f.events.at(-1).status, f.events.at(-1).code, f.events.at(-1).retryProhibited],
    ['blocked-before-mutation', 'WEDDING_CODE_SCENE_V10_PREDECESSOR_NOT_APPLIED', false]);
  const mismatch = { ...before(), predecessor: { ...before().predecessor, sqlMd5: 'd'.repeat(32) } };
  assert.throws(() => validateWeddingCodeSceneV10Observation(mismatch, { ...context, now: instant }), error =>
    error.code === 'WEDDING_CODE_SCENE_V10_PREDECESSOR_LEDGER_MISMATCH' && !error.message.includes('--apply'));
});

// 안내하는 커밋이 정말 235 lane을 돌릴 수 있는 checkout인지 Git 원문으로 확인한다(CI는 전체 이력을 받는다).
test('the guidance commit is a 235-file checkout whose 235 contract, runtime and SQL are the pinned bytes', () => {
  const git = gitArgs => execFileSync('git', ['--no-replace-objects', '-C', root, ...gitArgs], { windowsHide: true, timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
  const files = git(['ls-tree', '--name-only', `${BASE_235}:supabase/migrations`]).toString('utf8').split('\n').filter(name => /\.sql$/i.test(name));
  assert.equal(files.length, 235); assert.equal(files.at(-1), '20260917090000_wedding_code_research_scene_v09.sql');
  const pins = JSON.parse(read('supabase/release-contracts/wedding-code-research-scene-v09-v1.json'));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(git(['show', `${BASE_235}:supabase/release-contracts/wedding-code-research-scene-v09-v1.json`])),
    '46017ac2e9a4e404a6c171c79793dd57547a5649124ed5163dd99b8abe3a04c6');
  for (const pin of [pins.runtime, pins.predecessorMigration, { ...pins.migrations[0], file: `supabase/migrations/${pins.migrations[0].file}` }])
    assert.equal(sha(git(['show', `${BASE_235}:${pin.file}`])), pin.sha256, pin.file);
});

test('rehearsal failure, rollback drift, stale source, deadline or receipt failure cannot reach the commit call', async () => {
  let time = instant;
  for (const options of [
    { onQuery: (_text, call) => { if (call === 2) throw new Error('synthetic timeout'); } },
    { observations: [before(), { ...before(), ledgerCount: 236 }] },
    { observations: [before(), { ...before(), preservedCatalogSha: '1'.repeat(32) }] },
    { observations: [before(), withScene(before(), V10)] },
    { onSource: count => { if (count === 2) throw new Error('synthetic dirty source'); } },
    { onRecord: event => { if (event.status === 'apply-outcome-unverified') throw new Error('synthetic disk full'); } },
    { now: () => time, onRecord: event => { if (event.status === 'rehearsed-and-rolled-back') time = new Date(instant.getTime() + 120_001); } },
  ]) {
    time = instant;
    const f = fixture(options);
    await assert.rejects(f.run(), code('WEDDING_CODE_SCENE_V10_OUTCOME_REQUIRES_INSPECTION'));
    assert.ok(f.calls.length <= 3);
    assert.equal(f.calls.some(text => text.endsWith('COMMIT;') && !text.startsWith('BEGIN READ ONLY')), false);
    assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
    assert.equal(f.events.at(-1).status, 'outcome-requires-readonly-inspection'); assert.equal(f.events.at(-1).retryProhibited, true);
    assert.equal(f.closed, true);
  }
});

test('an ambiguous commit is never retried and a postcheck drift is never labelled success', async () => {
  const ambiguous = fixture({ onQuery: (_text, call) => { if (call === 4) throw new Error('response lost after synthetic commit'); } });
  await assert.rejects(ambiguous.run(), code('WEDDING_CODE_SCENE_V10_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(ambiguous.calls.length, 4); assert.equal(ambiguous.events.at(-1).retryProhibited, true);
  for (const observed of [{ ...after(), preservedCatalogSha: '1'.repeat(32) }, { ...after(), ledgerCount: 237 },
    { ...after(), ledgerWithoutTargetSha: 'd'.repeat(32) }, withScene(after(), V09),
    withRelation(after(), { acl: [...after().catalog.relations[0].acl, ['service_role', 'postgres', 'SELECT', false]] })]) {
    const f = fixture({ observations: [before(), before(), observed] });
    await assert.rejects(f.run(), code('WEDDING_CODE_SCENE_V10_OUTCOME_REQUIRES_INSPECTION'));
    assert.equal(f.calls.length, 5);
    assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
  }
});

test('receipt writes short chunks completely before fsync and refuses zero progress', () => {
  const value = { status: 'apply-outcome-unverified', detail: '합성 기록' }, written = []; let flushed = 0;
  appendWeddingCodeSceneV10Receipt(7, value, { write: (_fd, bytes, offset, length) => { const count = Math.min(3, length);
    written.push(bytes.subarray(offset, offset + count)); return count; }, flush: () => { flushed += 1; } });
  assert.equal(Buffer.concat(written).toString(), `${JSON.stringify(value)}\n`); assert.equal(flushed, 1);
  for (const invalid of [0, -1, undefined, Infinity])
    assert.throws(() => appendWeddingCodeSceneV10Receipt(7, value, { write: () => invalid, flush: () => { throw new Error('unexpected flush'); } }),
      code('WEDDING_CODE_SCENE_V10_RECEIPT_WRITE_INCOMPLETE'));
});

// 합성 PGlite(PostgreSQL 18)에서 234·235 적용 상태를 만든 뒤 실제 관측식과 적용 묶음을 돌린다.
// 운영 식별값·버전 범위 검사만 로컬 값으로 바꾼다.
test('the real catalog query and bundle rehearse, roll back and commit exactly the v1.0 CHECK on a local PostgreSQL', { timeout: 120_000 }, async () => {
  const { PGlite } = createRequire(join(root, 'apps/web/package.json'))('@electric-sql/pglite');
  const db = await PGlite.create();
  const insert = (scene, byte) => db.query('SELECT public.insert_wedding_code_research_contribution($1,$2,$3,$4)',
    [scene, 'ABCD-ABCD-ABCD-ABCD-', 'wc-research-consent-v3', new Uint8Array(32).fill(byte)]);
  try {
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
      CREATE TABLE public.unrelated_rows(id int PRIMARY KEY, note text); INSERT INTO public.unrelated_rows VALUES (1, 'synthetic preserved');
      CREATE FUNCTION public.unrelated_helper() RETURNS int LANGUAGE sql AS 'SELECT 1';
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    await db.exec(storeSql);
    await db.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260915130000','wedding_code_research_contributions',ARRAY[$1]::text[])", [storeSql]);
    await insert('v0.8-code', 1);
    await db.exec(predecessorSql);
    await db.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260917090000','wedding_code_research_scene_v09',ARRAY[$1]::text[])", [predecessorSql]);
    await insert('v0.9-code', 2);
    const observe = async () => (await db.exec(buildWeddingCodeSceneV10ObservationSql())).flatMap(r => r.rows ?? []).find(row => row.observation).observation;
    const local = await observe();
    validateWeddingCodeSceneV10Catalog(local.catalog, storeSql, false);
    assert.throws(() => validateWeddingCodeSceneV10Catalog(local.catalog, storeSql, true), code('WEDDING_CODE_SCENE_V10_TARGET_CATALOG_DRIFT'));
    assert.equal(local.migration, null); assert.equal(local.ledgerSha, local.ledgerWithoutTargetSha);
    assert.deepEqual(local.predecessor, before().predecessor);
    assert.match(local.preservedCatalogSha, /^[a-f0-9]{32}$/);
    const localize = text => text.replace(`<>'7581440907192989109'`, `<>'${local.systemIdentifier}'`)
      .replace('NOT BETWEEN 170000 AND 179999', 'NOT BETWEEN 170000 AND 189999');
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const bundle = rehearsal => localize(buildWeddingCodeSceneV10MutationSql({ ...context, before: local, deadline, rehearsal }));
    await db.exec(bundle(true));
    const rolledBack = await observe();
    for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerCount', 'migration']) assert.deepEqual(rolledBack[key], local[key]);
    await assert.rejects(insert('v1.0-code', 3), /wcr_contributions_scene_version/);
    // 같은 이름의 CHECK를 예행과 적용 사이에 누가 바꾸면 적용 묶음이 기준선 드리프트로 멈춘다.
    await db.exec(`ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version ~ '^v[0-9][.][0-9]-code$')`);
    await assert.rejects(db.exec(bundle(false)), /WEDDING_CODE_SCENE_V10_BASELINE_DRIFT/);
    await db.exec('ROLLBACK').catch(() => undefined);
    await db.exec(`ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
      ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v0.9-code'))`);
    await db.exec('CREATE FUNCTION public.concurrent_helper() RETURNS int LANGUAGE sql AS \'SELECT 2\'');
    await assert.rejects(db.exec(bundle(false)), /WEDDING_CODE_SCENE_V10_BASELINE_DRIFT/);
    await db.exec('ROLLBACK').catch(() => undefined);
    await db.exec('DROP FUNCTION public.concurrent_helper()');
    const beforeApply = await observe();
    assert.deepEqual(beforeApply.catalog, local.catalog); assert.equal(beforeApply.preservedCatalogSha, local.preservedCatalogSha);
    await db.exec(bundle(false));
    const applied = await observe();
    validateWeddingCodeSceneV10Catalog(applied.catalog, storeSql, true);
    assert.throws(() => validateWeddingCodeSceneV10Catalog(applied.catalog, storeSql, false), code('WEDDING_CODE_SCENE_V10_TARGET_CATALOG_DRIFT'));
    validateWeddingCodeSceneV10Observation({ ...applied, systemIdentifier: '7581440907192989109', serverVersion: '17.6',
      ledgerCount: Number(applied.ledgerCount), observedAt: new Date().toISOString() }, { ...context, now: new Date() });
    assert.equal(applied.preservedCatalogSha, local.preservedCatalogSha);
    assert.deepEqual(applied.migration, after().migration);
    assert.equal(applied.ledgerWithoutTargetSha, local.ledgerSha); assert.equal(Number(applied.ledgerCount), Number(local.ledgerCount) + 1);
    assert.equal((await db.query(`SELECT ${weddingCodeSceneV10LedgerDigestSql(true)} AS value`)).rows[0].value, local.ledgerSha);
    assert.deepEqual((await db.query('SELECT * FROM public.unrelated_rows')).rows, [{ id: 1, note: 'synthetic preserved' }]);
    assert.deepEqual((await db.query('SELECT scene_version FROM public.wedding_code_research_contributions ORDER BY 1')).rows,
      [{ scene_version: 'v0.8-code' }, { scene_version: 'v0.9-code' }]);
    await insert('v1.0-code', 3);
    await insert('v0.9-code', 4);
    await assert.rejects(insert('v1.1-code', 5), /wcr_contributions_scene_version/);
    // 적용 후 권한이 넓어지면 관측 판정이 잡는다.
    await db.exec('GRANT SELECT ON public.wedding_code_research_deletion_tombstones TO anon');
    const drifted = (await db.query(`SELECT ${weddingCodeResearchTargetCatalogSql()} AS value`)).rows[0].value;
    assert.throws(() => validateWeddingCodeSceneV10Catalog(drifted, storeSql, true), code('WEDDING_CODE_SCENE_V10_TARGET_CATALOG_DRIFT'));
  } finally { await db.close(); }
});
