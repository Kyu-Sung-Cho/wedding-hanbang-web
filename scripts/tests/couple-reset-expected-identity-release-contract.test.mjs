import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest } from '../lib/current-baseline-release-contract.mjs';
import { loadDeletionAuditNullabilityReleasePlan } from '../lib/account-deletion-audit-nullability-release-contract.mjs';
import { COUPLE_RESET_EXPECTED_IDENTITY_CONTRACT_FILE, COUPLE_RESET_EXPECTED_IDENTITY_SCHEMA_CHANGE,
  COUPLE_RESET_EXPECTED_IDENTITY_SCOPE, assertCoupleResetExpectedIdentitySql,
  loadCoupleResetExpectedIdentityReleasePlan } from '../lib/couple-reset-expected-identity-release-contract.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { createDeletionAuditHistoricalRepository } from './fixtures/account-deletion-audit-historical-repository.mjs';

const root = resolve(import.meta.dirname, '../..');
const mode = '--couple-reset-expected-identity';
const code = expected => error => error?.code === expected;
const run = args => spawnSync(process.execPath, [join(root, 'scripts/supabase-release-fence.mjs'), ...args], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000,
});

function fixture(t) {
  const f = createDeletionAuditHistoricalRepository(root);
  t.after(f.cleanup);
  const contract = JSON.parse(readFileSync(join(root, COUPLE_RESET_EXPECTED_IDENTITY_CONTRACT_FILE), 'utf8'));
  const files = [COUPLE_RESET_EXPECTED_IDENTITY_CONTRACT_FILE, contract.predecessorLoader.file,
    contract.runtime.file, contract.catalog.file, contract.catalogFixture.file, contract.ledgerBaseline.file,
    contract.predecessorMigration.file,
    ...contract.verificationTests.map(pin => pin.file),
    ...contract.migrations.map(pin => `supabase/migrations/${pin.file}`)];
  for (const file of files) {
    mkdirSync(dirname(join(f.root, file)), { recursive: true });
    copyFileSync(join(root, file), join(f.root, file));
  }
  return { ...f, contract, files };
}

test('241 exact SQL preserves every 240 predecessor pin and grants no runtime or deployment authority', t => {
  const old = createDeletionAuditHistoricalRepository(root);
  t.after(old.cleanup);
  const predecessor = loadDeletionAuditNullabilityReleasePlan(old.root);
  const plan = loadCoupleResetExpectedIdentityReleasePlan(root);
  assert.equal(predecessor.migrationCount, 240);
  assert.equal(plan.migrationCount, 241);
  assert.equal(plan.followupMigrations.length, 15);
  assert.deepEqual(plan.reviewedMigrations.slice(0, -1), predecessor.reviewedMigrations);
  assert.deepEqual(plan.followupMigrations.slice(0, -1), predecessor.followupMigrations);
  assert.deepEqual(plan.followupMigrations.at(-1), {
    file: '20260928144843_couple_reset_expected_identity.sql', version: '20260928144843',
  });
  assert.deepEqual(readdirSync(join(root, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(),
    plan.reviewedMigrations.map(pin => pin.file));
  assert.deepEqual(plan.contract.allowedSchemaChanges, [COUPLE_RESET_EXPECTED_IDENTITY_SCHEMA_CHANGE]);
  assert.deepEqual(plan.contract.scope, JSON.parse(JSON.stringify(COUPLE_RESET_EXPECTED_IDENTITY_SCOPE)));
  assert.equal(plan.staticVerified, true);
  assert.equal(plan.productionApplyImplemented, true);
  assert.equal(plan.expectedLedgerVersions.length, 229);
  assert.equal(plan.expectedLedgerVersions.at(-1), '20260928073546');
  assert.notDeepEqual(plan.expectedLedgerVersions, predecessor.reviewedMigrations.map(pin => pin.file.slice(0, 14)));
  for (const key of ['productionExecutionEnabled', 'runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed'])
    assert.equal(plan[key], false, key);
  assert.throws(() => loadDeletionAuditNullabilityReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  assert.throws(() => loadCoupleResetExpectedIdentityReleasePlan(old.root));
  const successor = validateSuccessorReleaseContract({ repoRoot: root, followup: 'couple-reset-expected-identity' });
  assert.equal(successor.deploymentBlocked, true);
  assert.equal(successor.controllerReady, false);
});

test('the new contract, SQL and local verification source retain canonical raw byte pins', () => {
  const plan = loadCoupleResetExpectedIdentityReleasePlan(root);
  for (const [file, expected] of [[COUPLE_RESET_EXPECTED_IDENTITY_CONTRACT_FILE, plan.contractSha256],
    [`supabase/migrations/${plan.contract.migrations[0].file}`, plan.migrationSha256],
    ...['runtime', 'catalog', 'catalogFixture', 'predecessorMigration', 'ledgerBaseline']
      .map(key => [plan.contract[key].file, plan.contract[key].sha256]),
    ...plan.contract.verificationTests.map(pin => [pin.file, pin.sha256])]) {
    const bytes = readFileSync(join(root, file));
    assert.equal(bytes.includes(13), false, file);
    assert.equal(digest(bytes), expected, file);
    const raw = spawnSync('git', ['hash-object', '--no-filters', join(root, file)], { cwd: root, encoding: 'utf8', windowsHide: true });
    const canonical = spawnSync('git', ['hash-object', `--path=${file}`, join(root, file)], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(raw.status, 0, raw.stderr);
    assert.equal(canonical.status, 0, canonical.stderr);
    assert.equal(raw.stdout.trim(), canonical.stdout.trim(), file);
  }
});

test('missing or rewritten new and historical artifacts reject without falling back to the predecessor', t => {
  const f = fixture(t);
  const plan = loadCoupleResetExpectedIdentityReleasePlan(f.root);
  const predecessor = JSON.parse(readFileSync(join(f.root, f.contract.predecessor.file), 'utf8'));
  for (const file of [...f.files, f.contract.predecessor.file, predecessor.runtime.file, predecessor.predecessor.file,
    predecessor.predecessorLoader.file, `supabase/migrations/${predecessor.migrations[0].file}`,
    `supabase/migrations/${plan.reviewedMigrations[0].file}`]) {
    const target = join(f.root, file), bytes = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')]));
      assert.throws(() => loadCoupleResetExpectedIdentityReleasePlan(f.root), code('ARTIFACT_HASH_MISMATCH'), file);
      rmSync(target);
      assert.throws(() => loadCoupleResetExpectedIdentityReleasePlan(f.root), Error, file);
    } finally { writeFileSync(target, bytes); }
  }
  assert.equal(loadCoupleResetExpectedIdentityReleasePlan(f.root).migrationCount, 241);
});

test('any extra SQL filename is unreviewed and removing the new SQL only restores the original 240 lane', t => {
  const f = fixture(t);
  for (const name of ['20260929000000_unreviewed.sql', '20260101000000_unreviewed.sql', 'unexpected.sql', 'unexpected.SQL']) {
    const target = join(f.root, 'supabase/migrations', name);
    try {
      writeFileSync(target, 'SELECT 1;\n', { flag: 'wx' });
      assert.throws(() => loadCoupleResetExpectedIdentityReleasePlan(f.root), code('NEW_MIGRATION_NOT_REVIEWED'), name);
    } finally { rmSync(target); }
  }
  rmSync(join(f.root, 'supabase/migrations', f.contract.migrations[0].file));
  assert.equal(loadDeletionAuditNullabilityReleasePlan(f.root).migrationCount, 240);
  assert.throws(() => loadCoupleResetExpectedIdentityReleasePlan(f.root), code('NEW_MIGRATION_NOT_REVIEWED'));
});

test('the declared SQL scope rejects changed actor, lock, null-safe identity, delegation and ACL boundaries', () => {
  const plan = loadCoupleResetExpectedIdentityReleasePlan(root);
  const sql = readFileSync(join(root, 'supabase/migrations', plan.contract.migrations[0].file), 'utf8');
  assert.doesNotThrow(() => assertCoupleResetExpectedIdentitySql(sql));
  for (const [from, to] of [
    ["auth.role() IS DISTINCT FROM 'authenticated'", "auth.role() IS DISTINCT FROM 'anon'"],
    ['FOR UPDATE;', ';'],
    ['p_expected_user_id IS DISTINCT FROM v_user_id', 'p_expected_user_id <> v_user_id'],
    ['p_expected_couple_id IS DISTINCT FROM v_couple_id', 'p_expected_couple_id <> v_couple_id'],
    ['RETURN public.reset_current_couple_membership();', 'RETURN NULL;'],
    ['OWNER TO postgres;', 'OWNER TO authenticated;'],
    ['TO authenticated;', 'TO anon;'],
    ["SET statement_timeout = '15s'", "SET statement_timeout = '0'"],
    ['SET search_path = pg_catalog, public', 'SET search_path = public'],
  ]) {
    const changed = sql.replace(from, to);
    assert.notEqual(changed, sql, from);
    assert.throws(() => assertCoupleResetExpectedIdentitySql(changed), code('COUPLE_RESET_SQL_SCOPE_CHANGED'), from);
  }
});

test('the registered static CLI succeeds locally and rejects operational, mixed and unknown flags', () => {
  const valid = run([mode]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Couple reset expected identity contract verified \(241 exact SQL files;/);
  assert.match(valid.stdout, /runtime evidence not verified; deployment not authorized; no remote writes/);
  for (const extra of ['--apply', '--remote', mode, '--account-deletion-audit-nullability', '--unknown']) {
    const result = run([mode, extra]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /COUPLE_RESET_STATIC_ARGUMENTS_INVALID/);
  }
});
