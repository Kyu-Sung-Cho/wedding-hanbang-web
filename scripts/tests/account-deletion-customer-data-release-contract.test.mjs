import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CUSTOMER_DATA_CONTRACT_FILE, loadCustomerDataReleasePlan } from '../lib/account-deletion-customer-data-release-contract.mjs';
import { loadProfileAvatarReleasePlan } from '../lib/profile-avatar-release-contract.mjs';
import { createProfileAvatarHistoricalRepository } from './fixtures/profile-avatar-historical-repository.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

const root = resolve(import.meta.dirname, '../..');
const run = args => spawnSync(process.execPath, [join(root, 'scripts/supabase-release-fence.mjs'), ...args],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });

test('232 exact successor preserves 231 pins and cannot claim operation, backup or deployment authorization', () => {
  const plan = loadCustomerDataReleasePlan(root);
  assert.equal(plan.migrationCount, 232); assert.equal(plan.followupMigrations.length, 6);
  for (const key of ['runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed']) assert.equal(plan[key], false);
  assert.equal(plan.contract.scope.customerPurge, 'not-invoked'); assert.equal(plan.contract.scope.fullOriginalRestore, 'not-proven');
  assert.throws(() => loadProfileAvatarReleasePlan(root), { code: 'NEW_MIGRATION_NOT_REVIEWED' });
  const successor = validateSuccessorReleaseContract({ repoRoot: root, followup: 'account-deletion-customer-data' });
  assert.equal(successor.deploymentBlocked, true); assert.equal(successor.controllerReady, false);
  const result = run(['--account-deletion-customer-data']); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /232 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes/);
});

test('mixed static modes and incomplete runtime commands fail before network execution', async () => {
  for (const extra of ['--apply', '--remote', '--profile-avatar', '--account-deletion-customer-data', '--unknown']) {
    const result = run(['--account-deletion-customer-data', extra]);
    assert.equal(result.status, 1); assert.match(result.stderr, /CUSTOMER_DATA_STATIC_ARGUMENTS_INVALID/);
  }
  let calls = 0;
  await assert.rejects(runProductionRelease({ repoRoot: root, argv: ['--account-deletion-customer-data', '--apply'], runCommand: async () => { calls++; } }),
    { code: 'CUSTOMER_DATA_ARGUMENT_INVALID' });
  assert.equal(calls, 0);
});

test('every new artifact, predecessor runtime, contract and unregistered migration is fail-closed', t => {
  const fixture = createProfileAvatarHistoricalRepository(root); t.after(fixture.cleanup);
  const plan = loadCustomerDataReleasePlan(root);
  const paths = [CUSTOMER_DATA_CONTRACT_FILE, plan.contract.runtime.file, plan.contract.catalog.file, plan.contract.catalogFixture.file,
    `supabase/migrations/${plan.contract.migrations[0].file}`];
  for (const path of paths) { mkdirSync(dirname(join(fixture.root, path)), { recursive: true }); copyFileSync(join(root, path), join(fixture.root, path)); }
  assert.equal(loadCustomerDataReleasePlan(fixture.root).migrationCount, 232);
  for (const path of [...paths, plan.contract.predecessor.file, plan.contract.previousFunction.file, 'scripts/lib/profile-avatar-release.mjs']) {
    const target = join(fixture.root, path), bytes = readFileSync(target);
    try { writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')])); assert.throws(() => loadCustomerDataReleasePlan(fixture.root), { code: 'ARTIFACT_HASH_MISMATCH' }); }
    finally { writeFileSync(target, bytes); }
  }
  for (const name of ['20260914000000_unknown.sql', '20260101000000_unknown.sql', 'unexpected.sql']) {
    const target = join(fixture.root, 'supabase/migrations', name);
    try { writeFileSync(target, 'SELECT 1;\n', { flag: 'wx' }); assert.throws(() => loadCustomerDataReleasePlan(fixture.root), { code: 'NEW_MIGRATION_NOT_REVIEWED' }); }
    finally { rmSync(target); }
  }
});
