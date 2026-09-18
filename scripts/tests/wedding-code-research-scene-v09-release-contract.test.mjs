import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertWeddingCodeSceneVersionSqlScope, loadWeddingCodeSceneVersionReleasePlan, WEDDING_CODE_SCENE_VERSION_CONTRACT_FILE,
  WEDDING_CODE_SCENE_VERSION_SCOPE } from '../lib/wedding-code-research-scene-v09-release-contract.mjs';
import { loadWeddingCodeResearchHistoricalReleasePlan, loadWeddingCodeResearchReleasePlan }
  from '../lib/wedding-code-research-contributions-release-contract.mjs';
import { createWeddingCodeResearchHistoricalRepository } from './fixtures/wedding-code-research-contributions-historical-repository.mjs';
import { createWeddingCodeSceneVersionHistoricalRepository } from './fixtures/wedding-code-research-scene-v09-historical-repository.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

// 235 공개 모드는 역사 checkout에서만 통과한다. 실제 checkout에는 이후 검토된 SQL이 더 있다.
const actualRoot = resolve(import.meta.dirname, '../..');
const historical = createWeddingCodeSceneVersionHistoricalRepository(actualRoot), root = historical.root;
after(historical.cleanup);
const MIGRATION = 'supabase/migrations/20260917090000_wedding_code_research_scene_v09.sql';
const sql = readFileSync(join(root, MIGRATION), 'utf8');
const run = args => spawnSync(process.execPath, [join(root, 'scripts/supabase-release-fence.mjs'), ...args],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
const code = value => error => error?.code === value;

test('the historical 235 public mode rejects the actual checkout with a newer reviewed migration', () => {
  assert.throws(() => loadWeddingCodeSceneVersionReleasePlan(actualRoot), code('NEW_MIGRATION_NOT_REVIEWED'));
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: actualRoot, followup: 'wedding-code-research-scene-v09' }),
    code('FOLLOWUP_RELEASE_INVALID'));
  const result = spawnSync(process.execPath, [join(actualRoot, 'scripts/supabase-release-fence.mjs'), '--wedding-code-research-scene-v09'],
    { cwd: actualRoot, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /NEW_MIGRATION_NOT_REVIEWED/);
});

test('235 exact successor keeps all 234 pins, widens only the scene version and claims no runtime evidence, deployment or remote write', () => {
  const plan = loadWeddingCodeSceneVersionReleasePlan(root);
  assert.equal(plan.migrationCount, 235); assert.equal(plan.followupMigrations.length, 9);
  assert.deepEqual(plan.followupMigrations.at(-1), { file: '20260917090000_wedding_code_research_scene_v09.sql', version: '20260917090000' });
  assert.deepEqual(plan.followupMigrations.at(-2), { file: '20260915130000_wedding_code_research_contributions.sql', version: '20260915130000' });
  for (const key of ['runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed']) assert.equal(plan[key], false);
  assert.deepEqual(plan.contract.scope, JSON.parse(JSON.stringify(WEDDING_CODE_SCENE_VERSION_SCOPE)));
  assert.deepEqual(plan.contract.scope.acceptedSceneVersions, ['v0.8-code', 'v0.9-code']);
  assert.deepEqual(plan.contract.scope.previousSceneVersions, ['v0.8-code']);
  assert.equal(plan.contract.scope.change, 'widen-only'); assert.equal(plan.contract.scope.answerCode, 'unchanged');
  assert.equal(plan.contract.scope.rollback, 'disable-contribution-flag-never-renarrow');
  assert.equal(plan.contract.reviewedPredecessorMigrationCount, 234);
  assert.deepEqual(plan.contract.predecessorMigration, { file: 'supabase/migrations/20260915130000_wedding_code_research_contributions.sql',
    sha256: '76f58f948a1a7c99352b32c556dba2de3886e7ef6b357af574ae0522a174253e' });
  assert.deepEqual(plan.contract.predecessor, { file: 'supabase/release-contracts/wedding-code-research-contributions-v1.json',
    sha256: '7230b2d9b698c1b9cff230dcf4fe88213273f3802fdf88698937cde16b8110ac' });
  // 234는 역사 모드로만 열린다. 공개 모드는 이 checkout의 235번째 SQL을 거절해야 맞다.
  assert.equal(loadWeddingCodeResearchHistoricalReleasePlan(root).migrationCount, 234);
  assert.throws(() => loadWeddingCodeResearchReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  const successor = validateSuccessorReleaseContract({ repoRoot: root, followup: 'wedding-code-research-scene-v09' });
  assert.equal(successor.deploymentBlocked, true); assert.equal(successor.controllerReady, false);
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root, followup: 'wedding-code-research-contributions' }), code('FOLLOWUP_RELEASE_INVALID'));
  // 236 계약이 없는 235 역사 checkout은 v1.0 후속 계약으로 통과하지 않는다.
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root, followup: 'wedding-code-research-scene-v10' }), code('FOLLOWUP_RELEASE_INVALID'));
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root }), code('MIGRATION_SET_DRIFT'));
  const result = run(['--wedding-code-research-scene-v09']); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WeddingCode research scene v0\.9 contract verified \(235 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes\)/);
  // 234 정적 모드는 설계상 235 checkout을 거절한다(234 실행은 SQL 234개인 커밋에서만 한다).
  const previous = run(['--wedding-code-research-contributions']);
  assert.equal(previous.status, 1); assert.match(previous.stderr, /NEW_MIGRATION_NOT_REVIEWED/);
});

test('mixed static modes and incomplete runtime commands fail before any network call', async () => {
  for (const extra of ['--apply', '--remote', '--wedding-code-research-contributions', '--wedding-code-research-scene-v09', '--unknown']) {
    const result = run(['--wedding-code-research-scene-v09', extra]);
    assert.equal(result.status, 1); assert.match(result.stderr, /WEDDING_CODE_SCENE_VERSION_STATIC_ARGUMENTS_INVALID/);
    assert.doesNotMatch(result.stdout, /verified/);
  }
  let calls = 0;
  await assert.rejects(runProductionRelease({ repoRoot: root, argv: ['--wedding-code-research-scene-v09', '--apply'],
    runCommand: async () => { calls++; } }), code('WEDDING_CODE_SCENE_VERSION_ARGUMENT_INVALID'));
  await assert.rejects(runProductionRelease({ repoRoot: root, argv: ['--wedding-code-research-scene-v09', '--wedding-code-research-contributions',
    '--inspect'], runCommand: async () => { calls++; } }), code('WEDDING_CODE_SCENE_VERSION_ARGUMENT_INVALID'));
  assert.equal(calls, 0);
});

test('the reviewed SQL is exactly one scene-version CHECK swap plus its verification block; planted violations are rejected statically', () => {
  assert.equal(assertWeddingCodeSceneVersionSqlScope(sql), sql);
  // 주석만 바꾸는 것은 실행 범위를 바꾸지 않는다(원문 바이트는 계약 sha256이 따로 고정한다).
  assert.equal(assertWeddingCodeSceneVersionSqlScope(sql.replace('-- 적용 직후 다시 확인한다.', () => '-- 적용 직후 한 번 더 확인한다.')),
    sql.replace('-- 적용 직후 다시 확인한다.', () => '-- 적용 직후 한 번 더 확인한다.'));
  const IN = "CHECK (scene_version IN ('v0.8-code', 'v0.9-code'));";
  const violations = {
    'widens the check to a regex': [IN, "CHECK (scene_version ~ '^v0\\.[0-9]-code$');"],
    'drops v0.8-code from the list': [IN, "CHECK (scene_version IN ('v0.9-code'));"],
    'accepts an extra v1.0-code': [IN, "CHECK (scene_version IN ('v0.8-code', 'v0.9-code', 'v1.0-code'));"],
    'removes the scene check entirely': ["  DROP CONSTRAINT wcr_contributions_scene_version,\n  ADD CONSTRAINT wcr_contributions_scene_version " + IN,
      '  DROP CONSTRAINT wcr_contributions_scene_version;'],
    'adds the check without validating existing rows': [IN, "CHECK (scene_version IN ('v0.8-code', 'v0.9-code')) NOT VALID;"],
    'loosens the answer code in the same statement': ['  DROP CONSTRAINT wcr_contributions_scene_version,\n',
      "  DROP CONSTRAINT wcr_contributions_answer_code,\n  ADD CONSTRAINT wcr_contributions_answer_code CHECK (answer_code ~ '^[A-Da-d-]{1,40}$'),\n  DROP CONSTRAINT wcr_contributions_scene_version,\n"],
    'adds an extra statement': [IN, `${IN}\nUPDATE public.wedding_code_research_contributions SET scene_version = 'v0.9-code';`],
    'grants the table to anon': [IN, `${IN}\nGRANT SELECT ON TABLE public.wedding_code_research_contributions TO anon;`],
    'grants a function to authenticated': [IN,
      `${IN}\nGRANT EXECUTE ON FUNCTION public.delete_wedding_code_research_contribution(bytea) TO authenticated;`],
    'replaces a function': [IN, `${IN}\nCREATE OR REPLACE FUNCTION public.purge_expired_wedding_code_research_contributions() RETURNS integer LANGUAGE sql AS 'SELECT 0';`],
    'writes the migration ledger': ['\n\nCOMMIT;\n', "\nINSERT INTO supabase_migrations.schema_migrations(version) VALUES ('1');\n\nCOMMIT;\n"],
    'hides a statement behind a block comment': [IN, `${IN}\n/* note */ DROP TABLE public.wedding_code_research_deletion_tombstones;`],
    'hides a statement on a comment line without a space': [IN, `${IN}\n--x\nDROP INDEX public.wcr_contributions_expires_at_idx;`],
    'weakens the verification to a different definition': ["''v0.8-code''::text, ''v0.9-code''::text", "''v0.9-code''::text"],
    'drops the RLS verification': ["      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_RLS_DISABLED';", '      NULL;'],
    'drops the table privilege verification': ["        RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_TABLE_PRIVILEGE_OPEN';", '        NULL;'],
    'drops the function body verification': ['                   AND pg_catalog.md5(p.prosrc) = v_body_md5\n', ''],
    'pins a different function body': ["'32526988ee690824453ecdb74be707da'", "'00000000000000000000000000000000'"],
    'drops the function privilege verification': ["      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_PRIVILEGE_OPEN';", '      NULL;'],
    'turns the verification into a notice': ["RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_CHECK_UNEXPECTED';", "RAISE NOTICE 'WEDDING_CODE_SCENE_VERSION_CHECK_UNEXPECTED';"],
    'removes the verification block': [sql.slice(sql.indexOf('DO $verify_wedding_code_scene_v09$'), sql.indexOf('\n\nCOMMIT;\n')), 'SELECT 1;'],
    'commits early': ['DO $verify_wedding_code_scene_v09$', 'COMMIT;\nBEGIN;\nDO $verify_wedding_code_scene_v09$'],
    'rolls back instead of committing': ['\n\nCOMMIT;\n', '\n\nROLLBACK;\n'],
    'lengthens the lock timeout': ["SET LOCAL lock_timeout = '5s';", "SET LOCAL lock_timeout = '0';"],
    'switches role first': ['BEGIN;\n', 'BEGIN;\nSET LOCAL ROLE postgres;\n'],
    'uses CRLF bytes': ['BEGIN;\n', 'BEGIN;\r\n'],
    'adds a non-comment preamble': ['BEGIN;\n', 'SET ROLE postgres;\nBEGIN;\n'],
  };
  for (const [name, [before, after]] of Object.entries(violations)) {
    assert.ok(sql.includes(before), name);
    assert.throws(() => assertWeddingCodeSceneVersionSqlScope(sql.replace(before, () => after)), code('WEDDING_CODE_SCENE_VERSION_SQL_SCOPE_CHANGED'), name);
  }
  assert.throws(() => assertWeddingCodeSceneVersionSqlScope(`-- header only\n${sql.slice(sql.indexOf('BEGIN;'))}`.replace('\n\nCOMMIT;\n', '\n')),
    code('WEDDING_CODE_SCENE_VERSION_SQL_SCOPE_CHANGED'));
  assert.throws(() => assertWeddingCodeSceneVersionSqlScope(sql.slice(sql.indexOf('BEGIN;'))), code('WEDDING_CODE_SCENE_VERSION_SQL_SCOPE_CHANGED'));
});

test('every new artifact, predecessor and unregistered migration is fail-closed', t => {
  const fixture = createWeddingCodeResearchHistoricalRepository(actualRoot); t.after(fixture.cleanup);
  const plan = loadWeddingCodeSceneVersionReleasePlan(root);
  const paths = [WEDDING_CODE_SCENE_VERSION_CONTRACT_FILE, plan.contract.runtime.file, MIGRATION];
  assert.throws(() => loadWeddingCodeSceneVersionReleasePlan(fixture.root));
  assert.equal(loadWeddingCodeResearchReleasePlan(fixture.root).migrationCount, 234);
  for (const path of paths) { mkdirSync(dirname(join(fixture.root, path)), { recursive: true }); copyFileSync(join(root, path), join(fixture.root, path)); }
  assert.equal(loadWeddingCodeSceneVersionReleasePlan(fixture.root).migrationCount, 235);
  assert.throws(() => loadWeddingCodeResearchReleasePlan(fixture.root), code('NEW_MIGRATION_NOT_REVIEWED'));
  for (const path of [...paths, plan.contract.predecessor.file, plan.contract.predecessorMigration.file,
    'scripts/lib/wedding-code-research-contributions-release.mjs', 'scripts/lib/amora-not-applicable-status-release.mjs',
    'supabase/migrations/20260915101500_amora_atomic_not_applicable_status.sql']) {
    const target = join(fixture.root, path), bytes = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')]));
      assert.throws(() => loadWeddingCodeSceneVersionReleasePlan(fixture.root), code('ARTIFACT_HASH_MISMATCH'), path);
      rmSync(target); assert.throws(() => loadWeddingCodeSceneVersionReleasePlan(fixture.root), Error, path);
    } finally { writeFileSync(target, bytes); }
  }
  assert.equal(loadWeddingCodeSceneVersionReleasePlan(fixture.root).migrationCount, 235);
  for (const name of ['20260918000000_unknown.sql', '20260101000000_unknown.sql', 'unexpected.sql']) {
    const target = join(fixture.root, 'supabase/migrations', name);
    try { writeFileSync(target, 'SELECT 1;\n', { flag: 'wx' }); assert.throws(() => loadWeddingCodeSceneVersionReleasePlan(fixture.root), code('NEW_MIGRATION_NOT_REVIEWED')); }
    finally { rmSync(target); }
  }
  // 새 SQL을 지우면 235 계약은 거절하고, 계약 파일이 남은 checkout은 234 공개 모드로 되돌아가지 않는다.
  const sqlTarget = join(fixture.root, MIGRATION), sqlBytes = readFileSync(sqlTarget);
  try {
    rmSync(sqlTarget);
    assert.throws(() => loadWeddingCodeSceneVersionReleasePlan(fixture.root));
    assert.throws(() => validateSuccessorReleaseContract({ repoRoot: fixture.root, followup: 'wedding-code-research-scene-v09' }),
      code('FOLLOWUP_RELEASE_INVALID'));
  } finally { writeFileSync(sqlTarget, sqlBytes); }
});
