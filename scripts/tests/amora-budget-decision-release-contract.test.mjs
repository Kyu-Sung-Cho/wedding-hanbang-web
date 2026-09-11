import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { digest, loadCurrentBaselineContract } from '../lib/current-baseline-release-contract.mjs';
import { BUDGET_DECISION_CONTRACT_FILE, BUDGET_DECISION_KIND, BUDGET_DECISION_SCHEMA_CHANGES,
  loadBudgetDecisionHotfixRelease, validateBudgetDecisionPredecessor } from '../lib/amora-budget-decision-release-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const current = readJson(BUDGET_DECISION_CONTRACT_FILE);
const named = readJson(current.predecessor.file);
const base = readJson('supabase/release-contracts/current-baseline-rollout-v1.json');
const prior = readJson(named.operatingBaseline.file);
const applied = named.migrations.map(pin => ({ ...pin, version: pin.file.slice(0, 14),
  sql: readFileSync(join(root, 'supabase/migrations', pin.file)) }));
const originalBaseline = readJson(current.operatingBaseline.file);
const errorCode = code => error => error?.code === code;

test('current complete migration directory has a separate, scoped successor; old contract still rejects it', () => {
  assert.throws(() => loadCurrentBaselineContract(root), errorCode('NEW_MIGRATION_NOT_REVIEWED'));
  const release = loadBudgetDecisionHotfixRelease(root);
  assert.equal(release.hotfix.kind, BUDGET_DECISION_KIND);
  assert.equal(release.hotfix.status, 'requires-scoped-runtime-evidence');
  assert.equal(release.baseline.ledger.length, 215);
  assert.equal(release.baseline.ledger.at(-1).version, '20260907085111');
  assert.equal(release.migrations.length, 1);
  assert.equal(release.migrations[0].version, '20260910160514');
  assert.equal(digest(release.migrations[0].sql), '2b32149527dcd5e1edda3fa47cf38dad48606222d60493ca4962df1ce229596a');
  assert.deepEqual(release.hotfix.allowedSchemaChanges, BUDGET_DECISION_SCHEMA_CHANGES);
  assert.deepEqual(release.hotfix.requiredEvidence, ['backup', 'rollback', 'hosted', 'concurrency', 'fence', 'dryRun']);
  assert.deepEqual(release.hotfix.scope, { database: 'public-schema-and-existing-public-rows', auth: 'unchanged', storage: 'unchanged',
    fullDatabaseRestoreVerified: false, storageObjectsRestored: false, authDataRestored: false });
  assert.deepEqual(release.contract.implementation, base.implementation);
  assert.deepEqual(release.contract.cli, base.cli);
  assert.equal(release.contract.expectedOrigin, base.expectedOrigin);
  assert.ok(release.inventorySelect.startsWith('WITH namespaces'));
  assert.ok(!release.inventorySelect.endsWith(';'));
  assert.ok(!/\bROLLBACK\s*;\s*$/.test(release.fenceBody));
});

test('preserves every historical SQL byte and rejects unknown files without filtering the runtime directory', async t => {
  const parent = realpathSync(tmpdir());
  const fixture = mkdtempSync(join(parent, 'amora-budget-contract-'));
  const copy = file => {
    const target = join(fixture, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  };
  for (const folder of ['supabase/migrations', 'supabase/release-contracts'])
    for (const file of readdirSync(join(root, folder))) if (file.endsWith('.sql') || file.endsWith('.json')) copy(`${folder}/${file}`);
  for (const pin of Object.values(base.implementation)) copy(pin.file);
  t.after(() => {
    const resolved = realpathSync(fixture);
    assert.ok(resolved.startsWith(parent + sep) && resolved !== parent);
    rmSync(resolved, { recursive: true });
  });
  assert.equal(loadBudgetDecisionHotfixRelease(fixture).migrations.length, 1);
  const mutate = async (file, transform, code) => {
    const path = join(fixture, file);
    const before = readFileSync(path);
    try {
      writeFileSync(path, transform(before));
      assert.throws(() => loadBudgetDecisionHotfixRelease(fixture), errorCode(code));
    } finally { writeFileSync(path, before); }
  };
  for (const [title, file] of [
    ['new SQL', current.migrations[0].file],
    ['applied named-budget SQL', named.migrations[0].file],
    ['applied eight-SQL predecessor', base.migrations[0].file],
    ['earliest local SQL', current.reviewedLocalHistory.migrations[0].file],
    ['explicitly excluded historical SQL', current.excludedHistoricalFiles[0]],
  ]) await t.test(`${title} cannot be rewritten`, () => mutate(`supabase/migrations/${file}`, bytes => Buffer.concat([bytes, Buffer.from('\n-- altered\n')]), 'ARTIFACT_HASH_MISMATCH'));
  for (const filename of ['20260911120000_unreviewed.sql', '20260101000000_old_unreviewed.sql', 'unversioned.sql', '20260910160514_duplicate.SQL'])
    await t.test(`rejects ${filename}`, () => {
      const path = join(fixture, 'supabase/migrations', filename);
      assert.equal(existsSync(path), false);
      try {
        writeFileSync(path, 'SELECT 1;\n');
        assert.throws(() => loadBudgetDecisionHotfixRelease(fixture), errorCode('NEW_MIGRATION_NOT_REVIEWED'));
      } finally { rmSync(path); }
    });
  await t.test('baseline cannot be repinned through the new contract', () => mutate(BUDGET_DECISION_CONTRACT_FILE, bytes => {
    const value = JSON.parse(bytes); value.operatingBaseline.sha256 = 'a'.repeat(64);
    return JSON.stringify(value);
  }, 'ARTIFACT_HASH_MISMATCH'));
  await t.test('old validator implementation pin remains enforced', () => mutate(base.implementation.contractValidator.file,
    bytes => Buffer.concat([bytes, Buffer.from('\n// altered\n')]), 'ARTIFACT_HASH_MISMATCH'));
  await t.test('old release contract cannot be edited', () => mutate(current.predecessor.file,
    bytes => Buffer.concat([bytes, Buffer.from('\n')]), 'ARTIFACT_HASH_MISMATCH'));
  await t.test('baseline source bytes remain pinned', () => mutate(current.operatingBaseline.file,
    bytes => Buffer.concat([bytes, Buffer.from('\n')]), 'ARTIFACT_HASH_MISMATCH'));
});

test('actual observed ledger and managed drift evidence fail closed independently of outer artifact pin', async t => {
  const check = (change, code) => {
    const baseline = structuredClone(originalBaseline);
    change(baseline);
    assert.throws(() => validateBudgetDecisionPredecessor({ baseline, prior, contract: current, applied }), errorCode(code));
  };
  validateBudgetDecisionPredecessor({ baseline: originalBaseline, prior, contract: current, applied });
  for (const [title, change, code] of [
    ['historical ledger row rewrite', b => { b.ledger[0].name += '_changed'; }, 'HOTFIX_PREDECESSOR_LEDGER_CHANGED'],
    ['named-budget statement byte mismatch', b => { b.ledger.at(-1).statementsSha256 = 'a'.repeat(64); }, 'HOTFIX_PREDECESSOR_LEDGER_CHANGED'],
    ['wrong DB system identifier', b => { b.systemIdentifier = '7656983981618135123'; }, 'BASELINE_IDENTITY_MISMATCH'],
    ['write-mode observation', b => { b.readOnly = false; }, 'BASELINE_IDENTITY_MISMATCH'],
    ['infinite CLI role expiry', b => { b.cliRoleExpirations[0].validUntil = 'infinity'; }, 'CLI_ROLE_EXPIRATION_INVALID'],
    ['CLI role expiry beyond five-minute allowance', b => { b.cliRoleExpirations[0].validUntil = '2099-01-01T00:00:00Z'; }, 'CLI_ROLE_EXPIRATION_INVALID'],
    ['unreviewed public function difference', b => { b.objects.find(x => x.kind === 'function' && x.identity.startsWith('public.')).sha256 = 'a'.repeat(64); }, 'BASELINE_RAW_OBSERVATION_MISMATCH'],
    ['wrong proof project', b => { b.managedDriftEvidence.projectRef = 'tvyblzioajnfsbkciubk'; }, 'MANAGED_DRIFT_TARGET_MISMATCH'],
    ['missing managed evidence', b => { delete b.managedDriftEvidence; }, 'MANAGED_DRIFT_TARGET_MISMATCH'],
    ['missing Storage migration history', b => { delete b.managedDriftEvidence.receipts['budget-storage-migration-history-readonly']; }, 'MANAGED_DRIFT_EVIDENCE_MISSING'],
    ['extra unrelated managed exception', b => { b.managedDriftEvidence.receipts.other = {}; }, 'MANAGED_DRIFT_EVIDENCE_MISSING'],
    ['changed raw reconstruction query', b => { b.managedDriftEvidence.receipts['budget-storage-index-drift-proof'].queryText += '\n'; }, 'MANAGED_DRIFT_RAW_MISMATCH'],
    ['changed Storage index reconstruction', b => {
      const proof = b.managedDriftEvidence.receipts['budget-storage-index-drift-proof'];
      const raw = JSON.parse(proof.rawText); raw.rows[0].observation.addedIndexCount = 4;
      proof.rawText = JSON.stringify(raw); proof.rawSha256 = digest(proof.rawText);
    }, 'MANAGED_DRIFT_RAW_MISMATCH'],
    ['changed Realtime rotation evidence', b => {
      const proof = b.managedDriftEvidence.receipts['budget-realtime-drift-proof'];
      const raw = JSON.parse(proof.rawText); raw.rows[0].observation.partitions[0].currentIdentity = 'realtime.messages_2026_09_14';
      proof.rawText = JSON.stringify(raw); proof.rawSha256 = digest(proof.rawText);
    }, 'MANAGED_DRIFT_RAW_MISMATCH'],
  ]) await t.test(title, () => check(change, code));
});
