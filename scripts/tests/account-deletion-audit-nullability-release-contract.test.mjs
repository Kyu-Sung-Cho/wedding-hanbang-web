import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DELETION_AUDIT_CONTRACT_FILE, DELETION_AUDIT_SCHEMA_CHANGE, DELETION_AUDIT_SCOPE,
  loadDeletionAuditNullabilityReleasePlan } from '../lib/account-deletion-audit-nullability-release-contract.mjs';
import { loadWeddingCodePairSessionConflictReleasePlan } from '../lib/wedding-code-pair-session-conflict-release-contract.mjs';
import { createWeddingCodePairSessionHistoricalRepository } from './fixtures/wedding-code-pair-session-historical-repository.mjs';
import { createDeletionAuditHistoricalRepository } from './fixtures/account-deletion-audit-historical-repository.mjs';
import { digest } from '../lib/current-baseline-release-contract.mjs';

const root = resolve(import.meta.dirname, '../..');
const historical240 = createDeletionAuditHistoricalRepository(root);
test.after(historical240.cleanup);
const code = expected => error => error?.code === expected;
const mode = '--account-deletion-audit-nullability';

function fixture(t) {
  const result = createWeddingCodePairSessionHistoricalRepository(root);
  t.after(result.cleanup);
  const contract = JSON.parse(readFileSync(join(root, DELETION_AUDIT_CONTRACT_FILE), 'utf8'));
  const predecessor = JSON.parse(readFileSync(join(root, contract.predecessor.file), 'utf8'));
  const files = [DELETION_AUDIT_CONTRACT_FILE, contract.predecessor.file, contract.predecessorLoader.file,
    contract.runtime.file, predecessor.runtime.file, predecessor.catalog.file, predecessor.catalogFixture.file,
    ...[contract, predecessor].flatMap(c => c.migrations.map(pin => `supabase/migrations/${pin.file}`))];
  for (const file of files) {
    mkdirSync(dirname(join(result.root, file)), { recursive: true });
    copyFileSync(join(root, file), join(result.root, file));
  }
  return { ...result, files, contract, predecessor };
}

test('240 exact SQL lane preserves 239 pins and authorizes no operation by static success', () => {
  const plan = loadDeletionAuditNullabilityReleasePlan(historical240.root);
  assert.equal(plan.migrationCount, 240);
  assert.equal(plan.followupMigrations.length, 14);
  assert.deepEqual(plan.followupMigrations.at(-1), {
    file: '20260928073546_account_deletion_anonymous_audit.sql', version: '20260928073546',
  });
  assert.deepEqual(plan.contract.allowedSchemaChanges, [DELETION_AUDIT_SCHEMA_CHANGE]);
  assert.deepEqual(plan.contract.scope, JSON.parse(JSON.stringify(DELETION_AUDIT_SCOPE)));
  assert.equal(plan.contract.scope.target.type, 'uuid');
  assert.equal(plan.contract.scope.target.default, null);
  for (const key of ['runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed']) assert.equal(plan[key], false);
  assert.throws(() => loadDeletionAuditNullabilityReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  assert.throws(() => loadWeddingCodePairSessionConflictReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
});

test('new contract, runtime and SQL are pinned canonical LF bytes', () => {
  const plan = loadDeletionAuditNullabilityReleasePlan(historical240.root);
  for (const [file, sha] of [[DELETION_AUDIT_CONTRACT_FILE, plan.contractSha256],
    [plan.contract.runtime.file, plan.contract.runtime.sha256],
    [`supabase/migrations/${plan.contract.migrations[0].file}`, plan.migrationSha256]]) {
    const bytes = readFileSync(join(root, file));
    assert.equal(bytes.includes(13), false, file);
    assert.equal(digest(bytes), sha, file);
    const raw = spawnSync('git', ['hash-object', '--no-filters', join(root, file)], { cwd: root, encoding: 'utf8', windowsHide: true });
    const canonical = spawnSync('git', ['hash-object', `--path=${file}`, join(root, file)], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(raw.status, 0, raw.stderr);
    assert.equal(canonical.status, 0, canonical.stderr);
    assert.equal(raw.stdout.trim(), canonical.stdout.trim(), file);
  }
});

test('new source, all predecessor pins and missing artifacts fail closed; extra SQL cannot become reviewed', t => {
  const f = fixture(t);
  const plan = loadDeletionAuditNullabilityReleasePlan(f.root);
  const prior = JSON.parse(readFileSync(join(f.root, f.predecessor.predecessor.file), 'utf8'));
  for (const file of [...f.files, f.predecessor.predecessor.file, prior.runtime.file, prior.catalog.file,
    'supabase/release-contracts/preparation-style-v1.json',
    `supabase/migrations/${plan.reviewedMigrations[0].file}`]) {
    const target = join(f.root, file), bytes = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')]));
      assert.throws(() => loadDeletionAuditNullabilityReleasePlan(f.root), Error, file);
      rmSync(target);
      assert.throws(() => loadDeletionAuditNullabilityReleasePlan(f.root), Error, file);
    } finally { writeFileSync(target, bytes); }
  }
  for (const name of ['20260929000000_unreviewed.sql', '20260101000000_unreviewed.sql', 'unexpected.sql']) {
    const target = join(f.root, 'supabase/migrations', name);
    try {
      writeFileSync(target, 'SELECT 1;\n', { flag: 'wx' });
      assert.throws(() => loadDeletionAuditNullabilityReleasePlan(f.root), code('NEW_MIGRATION_NOT_REVIEWED'));
    } finally { rmSync(target); }
  }
});

test('the unchanged 239 predecessor still accepts only its original directory', t => {
  const f = fixture(t);
  const target = join(f.root, 'supabase/migrations', f.contract.migrations[0].file);
  rmSync(target);
  assert.equal(loadWeddingCodePairSessionConflictReleasePlan(f.root).migrationCount, 239);
  assert.throws(() => loadDeletionAuditNullabilityReleasePlan(f.root), code('NEW_MIGRATION_NOT_REVIEWED'));
});

test('registered static CLI rejects operational, mixed and unknown flags without remote flow', () => {
  const run = (args, repo = root) => spawnSync(process.execPath, [join(repo, 'scripts/supabase-release-fence.mjs'), ...args], {
    cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 60_000,
  });
  cpSync(join(root, 'scripts/lib'), join(historical240.root, 'scripts/lib'), { recursive: true });
  copyFileSync(join(root, 'scripts/supabase-release-fence.mjs'), join(historical240.root, 'scripts/supabase-release-fence.mjs'));
  const valid = run([mode], historical240.root);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /240 exact SQL files/);
  assert.match(valid.stdout, /runtime evidence not verified; deployment not authorized; no remote writes/);
  const current = run([mode]);
  assert.equal(current.status, 1, current.stdout);
  assert.match(current.stderr, /NEW_MIGRATION_NOT_REVIEWED/);
  for (const extra of ['--apply', '--remote', mode, '--chat-feedback-nullability', '--unknown']) {
    const result = run([mode, extra]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /DELETION_AUDIT_STATIC_ARGUMENTS_INVALID/);
  }
});
