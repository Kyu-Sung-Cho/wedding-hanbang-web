import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expectedNotApplicableTransaction, loadNotApplicableStatusReleasePlan, NOT_APPLICABLE_SQL_EDITS,
  NOT_APPLICABLE_STATUS_CONTRACT_FILE } from '../lib/amora-not-applicable-status-release-contract.mjs';
import { loadCustomerDataReleasePlan } from '../lib/account-deletion-customer-data-release-contract.mjs';
import { createCustomerDataHistoricalRepository } from './fixtures/account-deletion-customer-data-historical-repository.mjs';
import { createNotApplicableStatusHistoricalRepository } from './fixtures/amora-not-applicable-status-historical-repository.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

// 233 공개 모드는 역사 checkout에서만 통과한다. 실제 checkout에는 이후 검토된 SQL이 더 있다.
const actualRoot = resolve(import.meta.dirname, '../..');
const historical = createNotApplicableStatusHistoricalRepository(actualRoot), root = historical.root;
after(historical.cleanup);

test('the historical 233 public mode rejects the actual checkout with a newer reviewed migration', () => {
  assert.throws(() => loadNotApplicableStatusReleasePlan(actualRoot), { code: 'NEW_MIGRATION_NOT_REVIEWED' });
});
const run = args => spawnSync(process.execPath, [join(root, 'scripts/supabase-release-fence.mjs'), ...args],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
const code = value => error => error?.code === value;

test('233 exact successor keeps all 232 pins and claims no runtime evidence, deployment or remote write', () => {
  const plan = loadNotApplicableStatusReleasePlan(root);
  assert.equal(plan.migrationCount, 233); assert.equal(plan.followupMigrations.length, 7);
  assert.deepEqual(plan.followupMigrations.at(-1), { file: '20260915101500_amora_atomic_not_applicable_status.sql', version: '20260915101500' });
  for (const key of ['runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed']) assert.equal(plan[key], false);
  assert.deepEqual(plan.contract.scope.unchangedTools, ['update_task_status', 'toggle_checklist_item']);
  assert.throws(() => loadCustomerDataReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  const successor = validateSuccessorReleaseContract({ repoRoot: root, followup: 'amora-not-applicable-status' });
  assert.equal(successor.deploymentBlocked, true); assert.equal(successor.controllerReady, false);
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root, followup: 'account-deletion-customer-data' }), code('FOLLOWUP_RELEASE_INVALID'));
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root }), code('MIGRATION_SET_DRIFT'));
  const result = run(['--amora-not-applicable-status']); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /233 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes/);
});

test('mixed static modes and incomplete runtime commands fail before any network call', async () => {
  for (const extra of ['--apply', '--remote', '--account-deletion-customer-data', '--amora-not-applicable-status', '--unknown']) {
    const result = run(['--amora-not-applicable-status', extra]);
    assert.equal(result.status, 1); assert.match(result.stderr, /NOT_APPLICABLE_STATIC_ARGUMENTS_INVALID/);
  }
  let calls = 0;
  await assert.rejects(runProductionRelease({ repoRoot: root, argv: ['--amora-not-applicable-status', '--apply'], runCommand: async () => { calls++; } }),
    code('NOT_APPLICABLE_ARGUMENT_INVALID'));
  assert.equal(calls, 0);
});

test('the reviewed SQL is the previous transaction with only the three status allow-list edits', () => {
  const previous = readFileSync(join(root, 'supabase/migrations/20260911080244_amora_budget_plan_explicit_allocations.sql'), 'utf8');
  const next = readFileSync(join(root, 'supabase/migrations/20260915101500_amora_atomic_not_applicable_status.sql'), 'utf8');
  assert.equal(next.slice(next.indexOf('BEGIN;\n')), expectedNotApplicableTransaction(previous));
  assert.equal(NOT_APPLICABLE_SQL_EDITS.length, 3);
  for (const [before] of NOT_APPLICABLE_SQL_EDITS)
    assert.throws(() => expectedNotApplicableTransaction(previous.replace(before, `${before}\n`.replace('completed', 'done'))),
      code('NOT_APPLICABLE_SQL_SCOPE_CHANGED'));
});

test('every new artifact, predecessor, previous body and unregistered migration is fail-closed', t => {
  const fixture = createCustomerDataHistoricalRepository(actualRoot); t.after(fixture.cleanup);
  const plan = loadNotApplicableStatusReleasePlan(root);
  const paths = [NOT_APPLICABLE_STATUS_CONTRACT_FILE, plan.contract.runtime.file, `supabase/migrations/${plan.contract.migrations[0].file}`];
  assert.throws(() => loadNotApplicableStatusReleasePlan(fixture.root));
  for (const path of paths) { mkdirSync(dirname(join(fixture.root, path)), { recursive: true }); copyFileSync(join(root, path), join(fixture.root, path)); }
  assert.equal(loadNotApplicableStatusReleasePlan(fixture.root).migrationCount, 233);
  for (const path of [...paths, plan.contract.predecessor.file, plan.contract.previousFunction.file, plan.contract.predecessorMigration.file,
    'scripts/lib/account-deletion-customer-data-release.mjs']) {
    const target = join(fixture.root, path), bytes = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')]));
      assert.throws(() => loadNotApplicableStatusReleasePlan(fixture.root), code('ARTIFACT_HASH_MISMATCH'), path);
      rmSync(target); assert.throws(() => loadNotApplicableStatusReleasePlan(fixture.root), Error, path);
    } finally { writeFileSync(target, bytes); }
  }
  for (const name of ['20260916000000_unknown.sql', '20260101000000_unknown.sql', 'unexpected.sql']) {
    const target = join(fixture.root, 'supabase/migrations', name);
    try { writeFileSync(target, 'SELECT 1;\n', { flag: 'wx' }); assert.throws(() => loadNotApplicableStatusReleasePlan(fixture.root), code('NEW_MIGRATION_NOT_REVIEWED')); }
    finally { rmSync(target); }
  }
});
