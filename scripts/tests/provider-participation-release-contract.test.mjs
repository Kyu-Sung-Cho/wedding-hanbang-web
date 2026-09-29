import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProviderParticipationReleasePlan, PROVIDER_RELEASE_CONTRACT_FILE } from '../lib/provider-participation-release-contract.mjs';
import { loadDeletionAuditNullabilityReleasePlan } from '../lib/account-deletion-audit-nullability-release-contract.mjs';
import { createWeddingCodePairSessionHistoricalRepository } from './fixtures/wedding-code-pair-session-historical-repository.mjs';
import { buildProviderObservationSql, validateProviderObservation } from '../lib/provider-participation-catalog.mjs';
import { analyzeReadOnlySqlEnvelope } from '../lib/sql-read-only-envelope.mjs';
import { buildProviderLocalBundle, providerBundleParts, providerTransactionBody } from '../lib/provider-participation-release.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';

const root = resolve(import.meta.dirname, '../..');
const code = expected => error => error?.code === expected;
function repository(t) {
  const result = createWeddingCodePairSessionHistoricalRepository(root); t.after(result.cleanup);
  const contracts = ['supabase/release-contracts/wedding-code-pair-session-conflict-v1.json',
    'supabase/release-contracts/account-deletion-audit-nullability-v1.json', PROVIDER_RELEASE_CONTRACT_FILE];
  const files = new Set([...contracts, 'scripts/lib/account-deletion-audit-nullability-release-contract.mjs']);
  for (const contractFile of contracts) {
    const contract = JSON.parse(readFileSync(join(root, contractFile), 'utf8'));
    for (const value of Object.values(contract)) if (value && typeof value === 'object' && typeof value.file === 'string') files.add(value.file);
    for (const pin of contract.migrations) files.add(`supabase/migrations/${pin.file}`);
  }
  for (const file of files) { mkdirSync(dirname(join(result.root, file)), { recursive: true }); copyFileSync(join(root, file), join(result.root, file)); }
  return { ...result, files: [...files] };
}

test('243 exact SQL files and their predecessor chain remain preparation-only', () => {
  const plan = loadProviderParticipationReleasePlan(root);
  assert.equal(plan.migrationCount, 243); assert.equal(plan.predecessorMigrations.length, 240);
  for (const key of ['productionApplyImplemented', 'runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed']) assert.equal(plan[key], false);
  assert.throws(() => loadDeletionAuditNullabilityReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
});
test('every provider implementation pin and unknown SQL fails closed', t => {
  const f = repository(t); assert.equal(loadProviderParticipationReleasePlan(f.root).migrationCount, 243);
  for (const file of f.files) {
    const target = join(f.root, file), bytes = readFileSync(target);
    try { writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')])); assert.throws(() => loadProviderParticipationReleasePlan(f.root), Error, file); }
    finally { writeFileSync(target, bytes); }
  }
  const unknown = join(f.root, 'supabase/migrations/20260930000000_unreviewed.sql');
  try { writeFileSync(unknown, 'SELECT 1;\n', { flag: 'wx' }); assert.throws(() => loadProviderParticipationReleasePlan(f.root), code('NEW_MIGRATION_NOT_REVIEWED')); }
  finally { rmSync(unknown); }
});

test('shared build validator recognizes the exact provider successor without granting release authorization', () => {
  const result = validateSuccessorReleaseContract({ repoRoot: root, followup: 'provider-participation' });
  assert.deepEqual(result.providerReadiness, { productionApplyImplemented: false, runtimeEvidenceVerified: false, releaseAuthorized: false });
  assert.equal(result.deploymentBlocked, true);
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root, followup: 'account-deletion-audit-nullability' }), code('FOLLOWUP_RELEASE_INVALID'));
});

test('provider artifacts use canonical LF bytes before pinning, including Windows working copies', () => {
  const plan = loadProviderParticipationReleasePlan(root);
  const paths = [PROVIDER_RELEASE_CONTRACT_FILE, ...plan.contract.migrations.map(pin => `supabase/migrations/${pin.file}`),
    ...Object.values(plan.contract).filter(value => value?.file && value?.sha256).map(pin => pin.file)];
  for (const file of paths) assert.equal(readFileSync(join(root, file), 'utf8').includes('\r'), false, file);
});
test('offline CLI accepts no apply, inspect, project, credentials or SQL argument', () => {
  for (const args of [[], ['--apply'], ['--inspect'], ['--remote'], ['--check', '--apply'], ['--check', '--project-ref=slrtobkksjmxgzatjyqb'], ['--local-rehearsal', '--sql=SELECT 1'], ['--check', '--check']]) {
    const result = spawnSync(process.execPath, ['scripts/provider-participation-release.mjs', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /PROVIDER_RELEASE_OFFLINE_ARGUMENTS_ONLY/);
  }
  const checked = spawnSync(process.execPath, ['scripts/provider-participation-release.mjs', '--check'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(checked.status, 0, checked.stderr); assert.equal(JSON.parse(checked.stdout).releaseAuthorized, false);
});
test('standalone observation is read-only and matches the pinned generator', () => {
  const sql = buildProviderObservationSql();
  assert.deepEqual(analyzeReadOnlySqlEnvelope(sql), { ok: true });
  assert.equal(readFileSync(join(root, 'supabase/release-checks/provider-participation-observation.sql'), 'utf8'), sql);
});
test('exact catalog, ACL, identity, freshness and readonly requirements reject optimistic evidence', () => {
  const plan = loadProviderParticipationReleasePlan(root);
  const fixture = JSON.parse(readFileSync(join(root, plan.contract.catalogFixture.file), 'utf8'));
  const now = new Date('2026-09-29T00:00:00Z');
  const observation = { format: 'provider-participation-observation-v1', readOnly: true, systemIdentifier: plan.contract.systemIdentifier,
    serverVersion: '17.10', database: 'postgres', observedAt: now.toISOString(), ledgerCount: 240, target: fixture.before,
    targetLedger: [], permission: { currentUser: 'postgres', ownerUsage: true, rls: true, policyGrants: null },
    preservation: Object.fromEntries(['buckets', 'catalog', 'defaults', 'ledger', 'objects', 'roleSettings'].map(key => [key, 'a'.repeat(32)])) };
  const context = { expectedTarget: fixture.before, expectedLedger: [], expectedSystem: plan.contract.systemIdentifier, expectedCount: 240, now };
  assert.equal(validateProviderObservation(observation, context), observation);
  for (const patch of [{ readOnly: false }, { systemIdentifier: '1234' }, { ledgerCount: 243 }, { observedAt: '2020-01-01T00:00:00Z' },
    { targetLedger: [{ version: '20260928135517' }] }, { permission: { currentUser: 'postgres', ownerUsage: false, rls: true, policyGrants: null } },
    { target: { ...fixture.before, policy: [{ permissive: true }] } }, { preservation: { catalog: 'a'.repeat(32) } }]) {
    assert.throws(() => validateProviderObservation({ ...observation, ...patch }, context), Error);
  }
});
test('local bundle refuses production identity and cannot turn itself into a commit', () => {
  const plan = loadProviderParticipationReleasePlan(root), parts = providerBundleParts(root, plan);
  assert.throws(() => buildProviderLocalBundle({ parts, localSystemIdentifier: plan.contract.systemIdentifier, productionSystemIdentifier: plan.contract.systemIdentifier }), code('PROVIDER_RELEASE_LOCAL_TARGET_REQUIRED'));
  const bundle = buildProviderLocalBundle({ parts, localSystemIdentifier: '123456789', productionSystemIdentifier: plan.contract.systemIdentifier });
  assert.match(bundle, /listen_addresses/); assert.match(bundle, /PROVIDER_RELEASE_LOCAL_TARGET_REQUIRED/); assert.doesNotMatch(bundle, /COMMIT;\s*$/);
  for (const item of parts.migrations) assert.equal(providerTransactionBody(item.sql).includes('\nCOMMIT;'), false);
  assert.throws(() => providerTransactionBody('BEGIN;\nSELECT 1;\nCOMMIT;\nCOMMIT;\n'), code('PROVIDER_RELEASE_SQL_ENVELOPE_INVALID'));
});
