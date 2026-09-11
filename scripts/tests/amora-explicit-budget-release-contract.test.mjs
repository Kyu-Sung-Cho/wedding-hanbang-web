import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, digestJson, loadCurrentBaselineContract } from '../lib/current-baseline-release-contract.mjs';
import { loadBudgetDecisionHotfixRelease, loadBudgetDecisionHistoricalRelease } from '../lib/amora-budget-decision-release-contract.mjs';
import { loadEffectiveBudgetDecisionHotfixRelease, loadEffectiveBudgetDecisionHistoricalRelease,
  budgetRealtimeBindings, assertBudgetRealtimeBindings, renderBudgetRealtimeObservationSql } from '../lib/amora-budget-decision-effective-release-contract.mjs';
import { EXPLICIT_BUDGET_KIND, EXPLICIT_BUDGET_CONTRACT_FILE, EXPLICIT_BUDGET_SCHEMA_CHANGES,
  loadExplicitBudgetHotfixRelease, validateExplicitBudgetPredecessor } from '../lib/amora-explicit-budget-release-contract.mjs';
import { createBudgetDecisionHistoricalRepository } from './fixtures/budget-decision-historical-repository.mjs';

const root = resolve(import.meta.dirname, '../..');
const code = expected => error => error?.code === expected;
const json = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const release = loadExplicitBudgetHotfixRelease(root);
const parent = loadEffectiveBudgetDecisionHistoricalRelease(root);
const originalProof = json(release.hotfix.baselineProof.file);

test('only the new named contract admits exact current 228 SQL / actual 216 ledger; old modes still reject', () => {
  for (const load of [loadCurrentBaselineContract, loadBudgetDecisionHotfixRelease, loadEffectiveBudgetDecisionHotfixRelease])
    assert.throws(() => load(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  assert.equal(release.hotfix.kind, EXPLICIT_BUDGET_KIND);
  assert.equal(release.hotfix.requiredLedgerCount, 216);
  assert.equal(release.baseline.ledger.length, 216);
  assert.equal(release.baseline.ledger.at(-1).version, '20260910160514');
  assert.equal(release.hotfix.reviewedLocalHistory.migrations.length + release.migrations.length, 228);
  assert.equal(release.migrations.length, 1);
  assert.equal(release.migrations[0].version, '20260911080244');
  assert.equal(digest(release.migrations[0].sql), '2d26acb1d7b4ef26e4ec7e1c04de3e4e0e4180e57521e49128059ab3c1ec9372');
  assert.deepEqual(release.hotfix.allowedSchemaChanges, EXPLICIT_BUDGET_SCHEMA_CHANGES);
  assert.deepEqual(release.followupMigrations.map(row => row.version), ['20260910160514', '20260911080244']);
  for (const migration of release.followupMigrations) assert.equal(digest(migration.sql), migration.sha256);
  assert.equal(release.migrationSetSha256, digestJson(release.hotfix.migrations));
  assert.notEqual(release.migrationSetSha256, parent.migrationSetSha256);
});

test('new evidence preserves every predecessor safety boundary and binds the observed baseline without claiming a restore', () => {
  for (const field of ['implementation', 'cli', 'crypto', 'expectedOrigin', 'schemaScope'])
    assert.deepEqual(release.contract[field], parent.contract[field]);
  assert.equal(release.inventorySelect, parent.inventorySelect);
  assert.equal(release.fenceBody, parent.fenceBody);
  assert.deepEqual(release.hotfix.requiredEvidence, ['backup', 'rollback', 'hosted', 'concurrency', 'fence', 'dryRun']);
  assert.deepEqual(release.hotfix.scope, parent.hotfix.scope);
  assert.equal(release.hotfix.scope.fullDatabaseRestoreVerified, false);
  assert.equal(release.hotfix.scope.authDataRestored, false);
  assert.equal(release.hotfix.scope.storageObjectsRestored, false);
  assert.equal(release.baselineSha256, 'bbe5db4790ac8386d285eefcc5417ba7c912f0d53d358e246c6768f521947f65');
  assert.deepEqual(release.baseline, JSON.parse(originalProof.rawText)[0].observation);
  assert.equal(release.baselineSupplementSha256, parent.baselineSupplementSha256);
  assert.equal(release.effectiveBaselineSha256, release.baselineSha256);
  assert.notEqual(release.effectiveBaselineSha256, parent.effectiveBaselineSha256);
  assert.deepEqual(release.baselineSupplement, parent.baselineSupplement);
  assert.throws(() => assertBudgetRealtimeBindings(budgetRealtimeBindings(parent), release), code('REALTIME_SUPPLEMENT_BINDING_INVALID'));
  const sql = renderBudgetRealtimeObservationSql(release, 'a'.repeat(40));
  assert.ok(sql.includes(release.baselineSha256));
  assert.ok(sql.includes('HOTFIX_REALTIME_TOPOLOGY_CHANGED'));
  assert.ok(!sql.includes(parent.baselineSha256));
});

test('fixed M4 historical success uses exact Git bytes; current source extra SQL is never deleted or ignored', () => {
  const fixture = createBudgetDecisionHistoricalRepository(root);
  try {
    assert.equal(fixture.sourceCommit, 'e9f74aa3823cd75ed4180623d6276845180bd8ab');
    assert.equal(loadBudgetDecisionHotfixRelease(fixture.root).baseline.ledger.length, 215);
    assert.equal(loadEffectiveBudgetDecisionHotfixRelease(fixture.root).baseline.ledger.length, 215);
    const expected = [...parent.hotfix.reviewedLocalHistory.migrations, ...parent.hotfix.migrations];
    assert.deepEqual(readdirSync(join(fixture.root, 'supabase/migrations')).sort(), expected.map(row => row.file).sort());
    for (const pin of expected) assert.equal(digest(readFileSync(join(fixture.root, 'supabase/migrations', pin.file))), pin.sha256);
    assert.ok(readdirSync(join(root, 'supabase/migrations')).includes(release.migrations[0].file));
  } finally { fixture.cleanup(); }
});

test('unreviewed names, old SQL rewrites and repinned proof/contract/implementation are refused', async t => {
  const parentDirectory = realpathSync(tmpdir()), folder = mkdtempSync(join(parentDirectory, 'explicit-release-contract-'));
  t.after(() => { const resolved = realpathSync(folder); assert.ok(resolved.startsWith(parentDirectory + sep)); rmSync(resolved, { recursive: true }); });
  for (const subfolder of ['supabase/migrations', 'supabase/release-contracts']) cpSync(join(root, subfolder), join(folder, subfolder), { recursive: true });
  for (const pin of Object.values(release.contract.implementation)) {
    mkdirSync(dirname(join(folder, pin.file)), { recursive: true }); copyFileSync(join(root, pin.file), join(folder, pin.file));
  }
  assert.equal(loadExplicitBudgetHotfixRelease(folder).migrations.length, 1);
  for (const name of ['20260912000000_extra.sql', '20250101000000_old.sql', 'unknown.sql', '20260911080244_duplicate.SQL'])
    await t.test(name, () => {
      const file = join(folder, 'supabase/migrations', name);
      try { writeFileSync(file, 'SELECT 1;'); assert.throws(() => loadExplicitBudgetHotfixRelease(folder), code('NEW_MIGRATION_NOT_REVIEWED')); }
      finally { rmSync(file); }
    });
  const originals = [release.migrations[0].file, parent.migrations[0].file,
    parent.hotfix.reviewedLocalHistory.migrations[0].file, parent.hotfix.excludedHistoricalFiles[0]].map(file => `supabase/migrations/${file}`);
  for (const file of [...originals, EXPLICIT_BUDGET_CONTRACT_FILE, release.hotfix.operatingBaseline.file,
    release.hotfix.baselineProof.file, release.hotfix.predecessor.file, release.hotfix.predecessorSupplement.file,
    release.contract.implementation.contractValidator.file]) await t.test(`byte pin ${file}`, () => {
    const path = join(folder, file), bytes = readFileSync(path);
    try { writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n')])); assert.throws(() => loadExplicitBudgetHotfixRelease(folder), code('ARTIFACT_HASH_MISMATCH')); }
    finally { writeFileSync(path, bytes); }
  });
});

test('actual full observation, target, source and predecessor raw bytes cannot be relabeled', async t => {
  for (const [name, change] of [
    ['wrong system', f => { f.baseline.systemIdentifier = '7656983981618135123'; }],
    ['writable observation', f => { f.baseline.readOnly = false; }],
    ['unbounded role', f => { f.baseline.cliRoleExpirations[0].validUntil = 'infinity'; }],
    ['wrong source', f => { f.proof.sourceCommit = 'a'.repeat(40); }],
    ['dirty observed source', f => { f.proof.sourceAfter.status = ' M arbitrary'; }],
    ['changed query', f => { f.proof.queryText += '\n'; }],
    ['changed raw', f => { f.proof.rawText += '\n'; }],
    ['old ledger name', f => { f.baseline.ledger[0].name += 'x'; }],
    ['old ledger statement bytes', f => { f.baseline.ledger[215].statementsSha256 = 'a'.repeat(64); }],
    ['changed managed schema', f => { f.baseline.storageStructureSha256 = 'b'.repeat(64); }],
    ['new unrelated object', f => { f.baseline.objects.find(row => row.kind === 'function').sha256 = 'c'.repeat(64); }],
    ['M3 receipt replaced', f => { f.proof.predecessor.outcomeSha256 = 'd'.repeat(64); }],
    ['seventh M3 transition', f => { f.proof.predecessor.transitions.push(f.proof.predecessor.transitions[0]); }],
  ]) await t.test(name, () => {
    const f = { parent, baseline: structuredClone(release.baseline), proof: structuredClone(originalProof) };
    change(f); assert.throws(() => validateExplicitBudgetPredecessor(f));
  });
});

test('reconstruction independently rejects non-M3 drift, hidden topology inventory changes and rewritten predecessor history', () => {
  validateExplicitBudgetPredecessor({ parent, baseline: release.baseline, proof: originalProof });
  for (const change of [
    p => { p.baseline.ledger[0].name += '-changed'; },
    p => { p.baseline.storagePolicies = []; },
    p => { p.baseline.objects.find(row => row.identity === 'realtime.messages_2026_09_14').sha256 = 'f'.repeat(64); },
    p => { p.baseline.objects.find(row => row.identity === 'supabase_realtime_messages_publication').sha256 = 'e'.repeat(64); },
    p => { p.baseline.objects.find(row => row.identity === 'public.wedding_journeys').sha256 = 'd'.repeat(64); },
  ]) {
    const altered = structuredClone(parent); change(altered);
    assert.throws(() => validateExplicitBudgetPredecessor({ parent: altered, baseline: release.baseline, proof: originalProof }));
  }
  assert.equal(loadBudgetDecisionHistoricalRelease(root).hotfixSha256, parent.hotfixSha256);
});
