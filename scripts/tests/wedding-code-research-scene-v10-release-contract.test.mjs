import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertWeddingCodeSceneV10SqlScope, loadWeddingCodeSceneV10ReleasePlan, WEDDING_CODE_SCENE_V10_CONTRACT_FILE,
  WEDDING_CODE_SCENE_V10_SCOPE } from '../lib/wedding-code-research-scene-v10-release-contract.mjs';
import { loadWeddingCodeSceneVersionHistoricalReleasePlan, loadWeddingCodeSceneVersionReleasePlan }
  from '../lib/wedding-code-research-scene-v09-release-contract.mjs';
import { loadWeddingCodeResearchReleasePlan } from '../lib/wedding-code-research-contributions-release-contract.mjs';
import { createWeddingCodeSceneVersionHistoricalRepository } from './fixtures/wedding-code-research-scene-v09-historical-repository.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

import { createWeddingCodeSceneV10HistoricalRepository } from './fixtures/wedding-code-research-scene-v10-historical-repository.mjs';
const actualRoot = resolve(import.meta.dirname, '../..');
const historical = createWeddingCodeSceneV10HistoricalRepository(actualRoot);
test.after(historical.cleanup);
const root = historical.root;
const MIGRATION = 'supabase/migrations/20260918090000_wedding_code_research_scene_v10.sql';
const sql = readFileSync(join(root, MIGRATION), 'utf8');
const run = args => spawnSync(process.execPath, [join(root, 'scripts/supabase-release-fence.mjs'), ...args],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
const code = value => error => error?.code === value;

test('236 exact successor keeps all 235 pins, adds only v1.0 to the scene version and claims no runtime evidence, deployment or remote write', () => {
  const plan = loadWeddingCodeSceneV10ReleasePlan(root);
  assert.equal(plan.migrationCount, 236); assert.equal(plan.followupMigrations.length, 10);
  assert.deepEqual(plan.followupMigrations.at(-1), { file: '20260918090000_wedding_code_research_scene_v10.sql', version: '20260918090000' });
  assert.deepEqual(plan.followupMigrations.at(-2), { file: '20260917090000_wedding_code_research_scene_v09.sql', version: '20260917090000' });
  for (const key of ['runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed']) assert.equal(plan[key], false);
  assert.deepEqual(plan.contract.scope, JSON.parse(JSON.stringify(WEDDING_CODE_SCENE_V10_SCOPE)));
  assert.deepEqual(plan.contract.scope.acceptedSceneVersions, ['v0.8-code', 'v0.9-code', 'v1.0-code']);
  assert.deepEqual(plan.contract.scope.previousSceneVersions, ['v0.8-code', 'v0.9-code']);
  assert.equal(plan.contract.scope.change, 'widen-only'); assert.equal(plan.contract.scope.answerCode, 'unchanged');
  assert.equal(plan.contract.scope.rollback, 'disable-contribution-flag-never-renarrow');
  assert.equal(plan.contract.reviewedPredecessorMigrationCount, 235);
  assert.deepEqual(plan.contract.predecessorMigration, { file: 'supabase/migrations/20260917090000_wedding_code_research_scene_v09.sql',
    sha256: 'a6dcf68a47c549deb8b3473f61da2e86eee58986dea4381bcd6f6bd96e91016d' });
  assert.deepEqual(plan.contract.catalogBaseMigration, { file: 'supabase/migrations/20260915130000_wedding_code_research_contributions.sql',
    sha256: '76f58f948a1a7c99352b32c556dba2de3886e7ef6b357af574ae0522a174253e' });
  assert.deepEqual(plan.contract.predecessor, { file: 'supabase/release-contracts/wedding-code-research-scene-v09-v1.json',
    sha256: '46017ac2e9a4e404a6c171c79793dd57547a5649124ed5163dd99b8abe3a04c6' });
  // 235는 역사 모드로만 열린다. 235·234 공개 모드는 이 checkout의 236번째 SQL을 거절해야 맞다.
  assert.equal(loadWeddingCodeSceneVersionHistoricalReleasePlan(root).migrationCount, 235);
  assert.throws(() => loadWeddingCodeSceneVersionReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  assert.throws(() => loadWeddingCodeResearchReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  const successor = validateSuccessorReleaseContract({ repoRoot: root, followup: 'wedding-code-research-scene-v10' });
  assert.equal(successor.deploymentBlocked, true); assert.equal(successor.controllerReady, false);
  for (const followup of ['wedding-code-research-scene-v09', 'wedding-code-research-contributions'])
    assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root, followup }), code('FOLLOWUP_RELEASE_INVALID'), followup);
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root }), code('MIGRATION_SET_DRIFT'));
  const result = run(['--wedding-code-research-scene-v10']); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WeddingCode research scene v1\.0 contract verified \(236 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes\)/);
  // 235 정적 모드는 설계상 236 checkout을 거절한다(235 실행은 SQL 235개인 커밋에서만 한다).
  const previous = run(['--wedding-code-research-scene-v09']);
  assert.equal(previous.status, 1); assert.match(previous.stderr, /NEW_MIGRATION_NOT_REVIEWED/);
});

test('mixed static modes and incomplete runtime commands fail before any network call', async () => {
  for (const extra of ['--apply', '--remote', '--wedding-code-research-scene-v09', '--wedding-code-research-scene-v10', '--unknown']) {
    const result = run(['--wedding-code-research-scene-v10', extra]);
    assert.equal(result.status, 1); assert.match(result.stderr, /WEDDING_CODE_SCENE_V10_STATIC_ARGUMENTS_INVALID/);
    assert.doesNotMatch(result.stdout, /verified/);
  }
  let calls = 0;
  await assert.rejects(runProductionRelease({ repoRoot: root, argv: ['--wedding-code-research-scene-v10', '--apply'],
    runCommand: async () => { calls++; } }), code('WEDDING_CODE_SCENE_V10_ARGUMENT_INVALID'));
  await assert.rejects(runProductionRelease({ repoRoot: root, argv: ['--wedding-code-research-scene-v10', '--wedding-code-research-scene-v09',
    '--inspect'], runCommand: async () => { calls++; } }), code('WEDDING_CODE_SCENE_V10_ARGUMENT_INVALID'));
  assert.equal(calls, 0);
});

test('the reviewed SQL is exactly one scene-version CHECK swap plus its verification block; planted violations are rejected statically', () => {
  assert.equal(assertWeddingCodeSceneV10SqlScope(sql), sql);
  // 주석만 바꾸는 것은 실행 범위를 바꾸지 않는다(원문 바이트는 계약 sha256이 따로 고정한다).
  assert.equal(assertWeddingCodeSceneV10SqlScope(sql.replace('-- 적용 직후 다시 확인한다.', () => '-- 적용 직후 한 번 더 확인한다.')),
    sql.replace('-- 적용 직후 다시 확인한다.', () => '-- 적용 직후 한 번 더 확인한다.'));
  const IN = "CHECK (scene_version IN ('v0.8-code', 'v0.9-code', 'v1.0-code'));";
  const violations = {
    'widens the check to a regex': [IN, "CHECK (scene_version ~ '^v[0-9]\\.[0-9]-code$');"],
    'drops v0.8-code from the list': [IN, "CHECK (scene_version IN ('v0.9-code', 'v1.0-code'));"],
    'drops v0.9-code from the list': [IN, "CHECK (scene_version IN ('v0.8-code', 'v1.0-code'));"],
    'keeps only the 235 list': [IN, "CHECK (scene_version IN ('v0.8-code', 'v0.9-code'));"],
    'accepts an extra v1.1-code': [IN, "CHECK (scene_version IN ('v0.8-code', 'v0.9-code', 'v1.0-code', 'v1.1-code'));"],
    'removes the scene check entirely': ["  DROP CONSTRAINT wcr_contributions_scene_version,\n  ADD CONSTRAINT wcr_contributions_scene_version " + IN,
      '  DROP CONSTRAINT wcr_contributions_scene_version;'],
    'adds the check without validating existing rows': [IN, "CHECK (scene_version IN ('v0.8-code', 'v0.9-code', 'v1.0-code')) NOT VALID;"],
    'loosens the answer code in the same statement': ['  DROP CONSTRAINT wcr_contributions_scene_version,\n',
      "  DROP CONSTRAINT wcr_contributions_answer_code,\n  ADD CONSTRAINT wcr_contributions_answer_code CHECK (answer_code ~ '^[A-Da-d-]{1,40}$'),\n  DROP CONSTRAINT wcr_contributions_scene_version,\n"],
    'relabels existing v0.9 rows': [IN, `${IN}\nUPDATE public.wedding_code_research_contributions SET scene_version = 'v1.0-code' WHERE scene_version = 'v0.9-code';`],
    'grants the table to anon': [IN, `${IN}\nGRANT SELECT ON TABLE public.wedding_code_research_contributions TO anon;`],
    'grants a function to authenticated': [IN,
      `${IN}\nGRANT EXECUTE ON FUNCTION public.delete_wedding_code_research_contribution(bytea) TO authenticated;`],
    'replaces a function': [IN, `${IN}\nCREATE OR REPLACE FUNCTION public.purge_expired_wedding_code_research_contributions() RETURNS integer LANGUAGE sql AS 'SELECT 0';`],
    'writes the migration ledger': ['\n\nCOMMIT;\n', "\nINSERT INTO supabase_migrations.schema_migrations(version) VALUES ('1');\n\nCOMMIT;\n"],
    'hides a statement behind a block comment': [IN, `${IN}\n/* note */ DROP TABLE public.wedding_code_research_deletion_tombstones;`],
    'hides a statement on a comment line without a space': [IN, `${IN}\n--x\nDROP INDEX public.wcr_contributions_expires_at_idx;`],
    'weakens the verification to the 235 definition': [", ''v1.0-code''::text", ''],
    'drops the RLS verification': ["      RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_RLS_DISABLED';", '      NULL;'],
    'drops the table privilege verification': ["        RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_TABLE_PRIVILEGE_OPEN';", '        NULL;'],
    'drops the function body verification': ['                   AND pg_catalog.md5(p.prosrc) = v_body_md5\n', ''],
    'pins a different function body': ["'32526988ee690824453ecdb74be707da'", "'00000000000000000000000000000000'"],
    'drops the function privilege verification': ["      RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_FUNCTION_PRIVILEGE_OPEN';", '      NULL;'],
    'turns the verification into a notice': ["RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_CHECK_UNEXPECTED';", "RAISE NOTICE 'WEDDING_CODE_SCENE_V10_CHECK_UNEXPECTED';"],
    'reuses the 235 verification codes': ["'WEDDING_CODE_SCENE_V10_CONSTRAINT_SET_CHANGED'", "'WEDDING_CODE_SCENE_VERSION_CONSTRAINT_SET_CHANGED'"],
    'removes the verification block': [sql.slice(sql.indexOf('DO $verify_wedding_code_scene_v10$'), sql.indexOf('\n\nCOMMIT;\n')), 'SELECT 1;'],
    'commits early': ['DO $verify_wedding_code_scene_v10$', 'COMMIT;\nBEGIN;\nDO $verify_wedding_code_scene_v10$'],
    'rolls back instead of committing': ['\n\nCOMMIT;\n', '\n\nROLLBACK;\n'],
    'lengthens the lock timeout': ["SET LOCAL lock_timeout = '5s';", "SET LOCAL lock_timeout = '0';"],
    'switches role first': ['BEGIN;\n', 'BEGIN;\nSET LOCAL ROLE postgres;\n'],
    'uses CRLF bytes': ['BEGIN;\n', 'BEGIN;\r\n'],
    'adds a non-comment preamble': ['BEGIN;\n', 'SET ROLE postgres;\nBEGIN;\n'],
  };
  for (const [name, [before, after]] of Object.entries(violations)) {
    assert.ok(sql.includes(before), name);
    assert.throws(() => assertWeddingCodeSceneV10SqlScope(sql.replace(before, () => after)), code('WEDDING_CODE_SCENE_V10_SQL_SCOPE_CHANGED'), name);
  }
  assert.throws(() => assertWeddingCodeSceneV10SqlScope(`-- header only\n${sql.slice(sql.indexOf('BEGIN;'))}`.replace('\n\nCOMMIT;\n', '\n')),
    code('WEDDING_CODE_SCENE_V10_SQL_SCOPE_CHANGED'));
  assert.throws(() => assertWeddingCodeSceneV10SqlScope(sql.slice(sql.indexOf('BEGIN;'))), code('WEDDING_CODE_SCENE_V10_SQL_SCOPE_CHANGED'));
});

test('every new artifact, predecessor and unregistered migration is fail-closed', t => {
  const fixture = createWeddingCodeSceneVersionHistoricalRepository(actualRoot); t.after(fixture.cleanup);
  const plan = loadWeddingCodeSceneV10ReleasePlan(root);
  const paths = [WEDDING_CODE_SCENE_V10_CONTRACT_FILE, plan.contract.runtime.file, MIGRATION];
  assert.throws(() => loadWeddingCodeSceneV10ReleasePlan(fixture.root));
  assert.equal(loadWeddingCodeSceneVersionReleasePlan(fixture.root).migrationCount, 235);
  for (const path of paths) { mkdirSync(dirname(join(fixture.root, path)), { recursive: true }); copyFileSync(join(root, path), join(fixture.root, path)); }
  assert.equal(loadWeddingCodeSceneV10ReleasePlan(fixture.root).migrationCount, 236);
  assert.throws(() => loadWeddingCodeSceneVersionReleasePlan(fixture.root), code('NEW_MIGRATION_NOT_REVIEWED'));
  for (const path of [...paths, plan.contract.predecessor.file, plan.contract.predecessorMigration.file, plan.contract.catalogBaseMigration.file,
    'scripts/lib/wedding-code-research-scene-v09-release.mjs', 'scripts/lib/wedding-code-research-contributions-release.mjs',
    'supabase/release-contracts/wedding-code-research-contributions-v1.json']) {
    const target = join(fixture.root, path), bytes = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')]));
      assert.throws(() => loadWeddingCodeSceneV10ReleasePlan(fixture.root), code('ARTIFACT_HASH_MISMATCH'), path);
      rmSync(target); assert.throws(() => loadWeddingCodeSceneV10ReleasePlan(fixture.root), Error, path);
    } finally { writeFileSync(target, bytes); }
  }
  assert.equal(loadWeddingCodeSceneV10ReleasePlan(fixture.root).migrationCount, 236);
  for (const name of ['20260919000000_unknown.sql', '20260101000000_unknown.sql', 'unexpected.sql']) {
    const target = join(fixture.root, 'supabase/migrations', name);
    try { writeFileSync(target, 'SELECT 1;\n', { flag: 'wx' }); assert.throws(() => loadWeddingCodeSceneV10ReleasePlan(fixture.root), code('NEW_MIGRATION_NOT_REVIEWED')); }
    finally { rmSync(target); }
  }
  // 새 SQL을 지우면 236 계약은 거절하고, 계약 파일이 남은 checkout은 235 공개 모드로 되돌아가지 않는다.
  const sqlTarget = join(fixture.root, MIGRATION), sqlBytes = readFileSync(sqlTarget);
  try {
    rmSync(sqlTarget);
    assert.throws(() => loadWeddingCodeSceneV10ReleasePlan(fixture.root));
    assert.throws(() => validateSuccessorReleaseContract({ repoRoot: fixture.root, followup: 'wedding-code-research-scene-v10' }),
      code('FOLLOWUP_RELEASE_INVALID'));
  } finally { writeFileSync(sqlTarget, sqlBytes); }
});
