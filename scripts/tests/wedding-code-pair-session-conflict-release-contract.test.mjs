import test from 'node:test';
import { createWeddingCodePairSessionConflictHistoricalRepository } from './fixtures/wedding-code-pair-session-conflict-historical-repository.mjs';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadWeddingCodePairSessionConflictReleasePlan, WEDDING_CODE_PAIR_SESSION_CONFLICT_CONTRACT_FILE,
  WEDDING_CODE_PAIR_SESSION_CONFLICT_SCOPE } from '../lib/wedding-code-pair-session-conflict-release-contract.mjs';
import { loadWeddingCodePairSessionReleasePlan, loadWeddingCodePairSessionHistoricalReleasePlan } from '../lib/wedding-code-pair-session-release-contract.mjs';
import { createWeddingCodePairSessionHistoricalRepository } from './fixtures/wedding-code-pair-session-historical-repository.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

const root = resolve(import.meta.dirname, '../..');
const historical239 = createWeddingCodePairSessionConflictHistoricalRepository(root);
test.after(historical239.cleanup);
const code = value => error => error?.code === value;
const run = args => spawnSync(process.execPath, [join(root, 'scripts/supabase-release-fence.mjs'), ...args],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000 });

test('239 exact SQL successor preserves immutable 238 pins and keeps static validation separate from deployment authority', () => {
  const plan = loadWeddingCodePairSessionConflictReleasePlan(historical239.root);
  assert.equal(plan.migrationCount, 239);
  assert.equal(plan.followupMigrations.length, 13);
  assert.deepEqual(plan.followupMigrations.at(-1), { file: '20260923132503_wedding_code_pair_session_conflict_response.sql', version: '20260923132503' });
  assert.deepEqual(plan.contract.scope, JSON.parse(JSON.stringify(WEDDING_CODE_PAIR_SESSION_CONFLICT_SCOPE)));
  assert.deepEqual(plan.contract.scope.conflictSqlState, { from: '40001', to: 'PT409', occurrences: 3 });
  for (const key of ['runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed']) assert.equal(plan[key], false);
  const historical = loadWeddingCodePairSessionHistoricalReleasePlan(root);
  assert.equal(historical.migrationCount, 238);
  assert.equal(historical.contractSha256, 'f479973b0dbc583981159a687c9d207d25bd21273cd01c41e03672299f73c5e7');
  assert.deepEqual(plan.contract.predecessorCatalogFixture, historical.contract.catalogFixture);
  assert.throws(() => loadWeddingCodePairSessionReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  const successor = validateSuccessorReleaseContract({ repoRoot: historical239.root, followup: 'wedding-code-pair-session-conflict' });
  assert.equal(successor.deploymentBlocked, true);
  assert.equal(successor.controllerReady, false);
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root, followup: 'wedding-code-pair-session' }), code('FOLLOWUP_RELEASE_INVALID'));
  const result = run(['--wedding-code-pair-session-conflict']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /NEW_MIGRATION_NOT_REVIEWED/);
  const previous = run(['--wedding-code-pair-session']);
  assert.equal(previous.status, 1);
  assert.match(previous.stderr, /NEW_MIGRATION_NOT_REVIEWED/);
});

test('239 static mode rejects mixed flags and malformed apply before a network request', async () => {
  for (const extra of ['--apply', '--remote', '--wedding-code-pair-session-conflict', '--wedding-code-pair-session', '--unknown']) {
    const result = run(['--wedding-code-pair-session-conflict', extra]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WEDDING_CODE_PAIR_SESSION_CONFLICT_STATIC_ARGUMENTS_INVALID/);
  }
  let calls = 0;
  await assert.rejects(runProductionRelease({ repoRoot: root, argv: ['--wedding-code-pair-session-conflict', '--apply'],
    runCommand: async () => { calls++; } }), code('WEDDING_CODE_PAIR_SESSION_CONFLICT_ARGUMENT_INVALID'));
  assert.equal(calls, 0);
});

test('239 missing or changed pins and unreviewed SQL cannot fall back to historical acceptance', t => {
  const fixture = createWeddingCodePairSessionHistoricalRepository(root);
  t.after(fixture.cleanup);
  const plan = loadWeddingCodePairSessionConflictReleasePlan(historical239.root);
  assert.equal(loadWeddingCodePairSessionReleasePlan(fixture.root).migrationCount, 238);
  assert.throws(() => loadWeddingCodePairSessionConflictReleasePlan(fixture.root));
  const paths = [WEDDING_CODE_PAIR_SESSION_CONFLICT_CONTRACT_FILE, plan.contract.runtime.file, plan.contract.catalog.file,
    plan.contract.catalogFixture.file, `supabase/migrations/${plan.contract.migrations[0].file}`];
  for (const path of paths) {
    mkdirSync(dirname(join(fixture.root, path)), { recursive: true });
    copyFileSync(join(root, path), join(fixture.root, path));
  }
  assert.equal(loadWeddingCodePairSessionConflictReleasePlan(fixture.root).migrationCount, 239);
  assert.throws(() => loadWeddingCodePairSessionReleasePlan(fixture.root), code('NEW_MIGRATION_NOT_REVIEWED'));
  const old = loadWeddingCodePairSessionHistoricalReleasePlan(fixture.root);
  for (const path of [...paths, plan.contract.predecessor.file, plan.contract.predecessorMigration.file,
    plan.contract.predecessorCatalogFixture.file, old.contract.runtime.file, old.contract.catalog.file,
    'supabase/release-contracts/preparation-style-v1.json']) {
    const target = join(fixture.root, path), bytes = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')]));
      assert.throws(() => loadWeddingCodePairSessionConflictReleasePlan(fixture.root), Error, path);
      rmSync(target);
      assert.throws(() => loadWeddingCodePairSessionConflictReleasePlan(fixture.root), Error, path);
    } finally { writeFileSync(target, bytes); }
  }
  for (const name of ['20260924000000_unknown.sql', '20260101000000_unknown.sql', 'unexpected.sql']) {
    const target = join(fixture.root, 'supabase/migrations', name);
    try {
      writeFileSync(target, 'SELECT 1;\n', { flag: 'wx' });
      assert.throws(() => loadWeddingCodePairSessionConflictReleasePlan(fixture.root), code('NEW_MIGRATION_NOT_REVIEWED'));
    } finally { rmSync(target); }
  }
});
