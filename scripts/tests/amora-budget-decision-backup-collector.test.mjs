import { createBudgetDecisionHistoricalRepository } from './fixtures/budget-decision-historical-repository.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBudgetDecisionHotfixRelease } from '../lib/amora-budget-decision-release-contract.mjs';
import { digest, digestJson, loadCurrentBaselineContract } from '../lib/current-baseline-release-contract.mjs';
import { durableRelations } from '../lib/current-baseline-backup-collector.mjs';
import { BUDGET_CAPTURE_KIND, REUSED_CAPTURE_PINS, parseBudgetCaptureArgs, captureConfirmation,
  validateCaptureCheckout, validateReusedCapturePins, createBudgetCaptureSourceFence, bindBudgetCaptureReceipt,
  collectBudgetDecisionBackup, runBudgetDecisionCapture } from '../lib/amora-budget-decision-backup-collector.mjs';

const SOURCE_ROOT = resolve(import.meta.dirname, '../..');
const historicalRepository = createBudgetDecisionHistoricalRepository(SOURCE_ROOT);
test.after(historicalRepository.cleanup);
const ROOT = historicalRepository.root;
const RELEASE = loadBudgetDecisionHotfixRelease(ROOT);
const COMMIT = 'b'.repeat(40);
const PRIVATE = 'synthetic-secret-must-not-escape';
const code = expected => error => error?.code === expected;
const tempParent = realpathSync(tmpdir());
const temp = mkdtempSync(join(tempParent, 'budget-capture-test-'));
test.after(() => {
  const path = realpathSync(temp);
  assert.ok(path.startsWith(tempParent + sep) && path !== tempParent);
  rmSync(path, { recursive: true });
});
const ca = join(temp, 'ca.pem'); const dump = join(temp, 'pg_dump.exe');
writeFileSync(ca, 'synthetic-ca'); writeFileSync(dump, 'synthetic-pg-dump');
const args = (changes = {}) => Object.entries({
  'expected-commit': COMMIT, 'expected-project': RELEASE.contract.projectRef,
  'confirm-capture': captureConfirmation(RELEASE, COMMIT), 'ca-file': ca, 'ca-sha256': digest(readFileSync(ca)),
  'pg-dump': dump, 'pg-dump-sha256': digest(readFileSync(dump)), ...changes,
}).flatMap(([key, value]) => [`--${key}`, value]);

function fixture(options = {}) {
  const inventory = structuredClone(RELEASE.baseline);
  inventory.storagePolicies = inventory.storagePolicies.filter(policy => policy.command === 'r');
  let turn = 0; let begin = 0; let reads = 0; let aborted = 0; let completed; let failed; let binding;
  const scopes = []; const schemaBytes = []; const original = Buffer.from('synthetic-storage-original');
  const source = {
    async begin() { turn++; begin++; return { readOnly: true, isolation: 'repeatable read', fenceCount: 1,
      projectRef: RELEASE.contract.projectRef, systemIdentifier: RELEASE.contract.systemIdentifier,
      snapshotId: `synthetic-${turn}`, inventory: structuredClone(inventory), ...options.begin }; },
    async captureRelation(relation) {
      reads++;
      if (options.readError) throw new Error(PRIVATE);
      const value = options.changed && turn === 2 ? 'changed' : PRIVATE;
      const rows = relation.kind === 'S' ? [{ last_value: 1, is_called: true }] : [{ id: 1, value }];
      return { rows: 1, bytes: Buffer.from(JSON.stringify({ format: 'current-baseline-relation-v1',
        identity: `${relation.schema}.${relation.name}`, columns: Object.keys(rows[0]), rows })) };
    },
    async storageIndex() { return [{ bucket: 'private-synthetic', name: 'one.txt', version: null, bytes: original.length }]; },
    async captureSchema() { return { statements: ['CREATE TABLE public.synthetic (id bigint);'], globals: { roles: [{ rolname: 'synthetic-role' }] } }; },
    async end() { return { inventory: structuredClone(inventory), fenceCount: options.lostFence ? 0 : 1 }; },
    async download() { return Buffer.from(options.storageChanged && turn === 2 ? 'different-storage-original' : original); },
    commandReceipts() { return []; }, async abort() { aborted++; }, async close() {},
  };
  const sink = {
    async initialize(value) { binding = value; },
    async write(value) {
      if (value.name === 'schema-inventory.json') schemaBytes.push(Buffer.from(value.bytes));
      scopes.push(value.directory);
      return { backup_set_id: binding.backupSetId, artifact: `${value.name}.hbam2`, key: `${value.name}.key.dpapi`,
        plaintext_sha256: digest(value.bytes), plaintext_bytes: value.bytes.length,
        encrypted_sha256: '1'.repeat(64), key_sha256: '2'.repeat(64), encrypted_bytes: value.bytes.length + 128 };
    },
    async progress() {}, async finish(value) { completed = value; }, async fail(value) { failed = value; }, async close() {},
  };
  return { source, sink, inventory, scopes, schemaBytes,
    state: () => ({ begin, reads, aborted, completed, failed }),
    run: () => collectBudgetDecisionBackup({ release: RELEASE, expectedCommit: COMMIT, source, sink,
      assertStable: async () => {}, implementationPins: REUSED_CAPTURE_PINS }),
  };
}

test('new loader accepts exact 215 baseline / 227 SQL while every previous implementation pin is unchanged', () => {
  assert.equal(RELEASE.baseline.ledger.length, 215);
  assert.equal(RELEASE.hotfix.reviewedLocalHistory.migrations.length + RELEASE.hotfix.migrations.length, 227);
  assert.throws(() => loadCurrentBaselineContract(ROOT), code('NEW_MIGRATION_NOT_REVIEWED'));
  validateReusedCapturePins(ROOT);
  for (const pin of REUSED_CAPTURE_PINS) assert.equal(digest(readFileSync(join(ROOT, pin.file))), pin.sha256);
});

test('no arguments and help verify the plan without reading credentials or starting any remote/private writer', async () => {
  for (const argv of [[], ['--help']]) {
    const forbidden = () => { assert.fail('plan attempted an operational boundary'); };
    const plan = await runBudgetDecisionCapture({ argv, repoRoot: ROOT, readCredentials: forbidden,
      sourceFactory: forbidden, sinkFactory: forbidden, fenceFactory: forbidden });
    assert.equal(plan.mode, 'plan-only'); assert.equal(plan.reviewedSqlFileCount, 227);
    assert.equal(plan.baselineLedgerCount, 215); assert.equal(plan.releaseReady, false);
    assert.equal(plan.hotfixSha256, RELEASE.hotfixSha256);
  }
});

test('CLI no-args/help/unknown options remain local with redacted output', () => {
  const script = join(ROOT, 'scripts/amora-budget-decision-backup-collect.mjs');
  for (const argv of [[], ['--help'], ['--apply', PRIVATE], ['--help', '--restore']]) {
    const result = spawnSync(process.execPath, [script, ...argv], { cwd: ROOT, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, HBAM2_DATABASE_URL: PRIVATE, SUPABASE_SERVICE_ROLE_KEY: PRIVATE } });
    assert.ok(!result.stdout.includes(PRIVATE)); assert.ok(!result.stderr.includes(PRIVATE));
    if (argv.length < 2) { assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).mode, 'plan-only'); }
    else { assert.equal(result.status, 1); assert.match(result.stderr, /^BUDGET_DECISION_CAPTURE_FAILED;/); }
  }
});

test('unknown, duplicate, omitted, positional and dangerous options are rejected, including mixed help', () => {
  for (const argv of [args().concat(['--restore', 'yes']), args().concat(['--skip-fence', 'yes']), args().concat(['--expected-commit', COMMIT]),
    args().concat(['--release-authorization', 'true']), ['--help', ...args()], ['capture'], args().slice(0, -1),
    args({ 'expected-commit': 'main' }), args({ 'ca-sha256': 'X'.repeat(64) }), args({ 'ca-file': 'relative.pem' })])
    assert.throws(() => parseBudgetCaptureArgs(argv));
  assert.equal(parseBudgetCaptureArgs(args()).mode, 'capture');
});

test('wrong confirmation, project, platform and tool hashes fail before credentials or source connection', async () => {
  for (const [argv, platform] of [
    [args({ 'confirm-capture': `CAPTURE:${RELEASE.contract.projectRef}:${RELEASE.contract.release}:${COMMIT}` }), 'win32'],
    [args({ 'expected-project': 'tvyblzioajnfsbkciubk' }), 'win32'], [args(), 'linux'],
    [args({ 'ca-sha256': '0'.repeat(64) }), 'win32'], [args({ 'pg-dump-sha256': '0'.repeat(64) }), 'win32'],
  ]) {
    let calls = 0;
    await assert.rejects(runBudgetDecisionCapture({ argv, repoRoot: ROOT, platform,
      readCredentials: () => { calls++; }, sourceFactory: () => { calls++; }, fenceFactory: () => { calls++; } }), code('BUDGET_DECISION_CAPTURE_FAILED'));
    assert.equal(calls, 0);
  }
});

test('expected commit, untracked/modified checkout, origin and linked project all fail closed', () => {
  const clean = { head: COMMIT, status: '', origin: RELEASE.contract.expectedOrigin, projectRef: RELEASE.contract.projectRef };
  validateCaptureCheckout(clean, RELEASE, COMMIT);
  for (const [change, expected] of [[{ head: 'c'.repeat(40) }, 'CAPTURE_WORKTREE_NOT_FROZEN'],
    [{ status: '?? untracked\n' }, 'CAPTURE_WORKTREE_NOT_FROZEN'], [{ status: ' M file\n' }, 'CAPTURE_WORKTREE_NOT_FROZEN'],
    [{ origin: 'https://example.com/other.git' }, 'CAPTURE_ORIGIN_MISMATCH'],
    [{ projectRef: 'tvyblzioajnfsbkciubk' }, 'CAPTURE_PROJECT_LINK_CHANGED']])
    assert.throws(() => validateCaptureCheckout({ ...clean, ...change }, RELEASE, COMMIT), code(expected));
});

test('reused collector/runtime/worker bytes cannot be edited even when a later candidate commits them', () => {
  const root = join(temp, 'changed-implementation');
  for (const pin of REUSED_CAPTURE_PINS) {
    mkdirSync(dirname(join(root, pin.file)), { recursive: true }); copyFileSync(join(ROOT, pin.file), join(root, pin.file));
  }
  validateReusedCapturePins(root);
  for (const pin of REUSED_CAPTURE_PINS) {
    const path = join(root, pin.file); const bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n')]));
    assert.throws(() => validateReusedCapturePins(root), code('ARTIFACT_HASH_MISMATCH'));
    writeFileSync(path, bytes);
  }
});

test('source fence cannot silently substitute an expected commit that lacks the new capture entry', () => {
  const base = 'a4f27ae2313faf9ba0b172ff128665e5cbf16d2b';
  assert.equal(execFileSync('git', ['cat-file', '-t', base], { cwd: SOURCE_ROOT }).toString().trim(), 'commit');
  assert.throws(() => createBudgetCaptureSourceFence(SOURCE_ROOT, RELEASE, base));
});

test('every baseline managed schema and durable relation survives the real collector, with bound private receipt', async () => {
  const f = fixture(); const receipt = await f.run();
  const expected = durableRelations(RELEASE.baseline).map(row => `${row.schema}.${row.name}`).sort();
  assert.deepEqual(receipt.relations.map(row => row.identity).sort(), expected);
  assert.deepEqual([...new Set(receipt.relations.map(row => row.identity.split('.')[0]))].sort(),
    [...new Set(durableRelations(RELEASE.baseline).map(row => row.schema))].sort());
  for (const schema of ['auth', 'public', 'storage', 'realtime', 'supabase_migrations'])
    assert.ok(receipt.relations.some(row => row.identity.startsWith(schema + '.')), schema);
  const originalSchema = JSON.parse(f.schemaBytes[0]);
  assert.deepEqual(originalSchema.objects, RELEASE.baseline.objects);
  assert.deepEqual(originalSchema.ledger, RELEASE.baseline.ledger);
  assert.deepEqual(originalSchema.globals, { roles: [{ rolname: 'synthetic-role' }] });
  assert.equal(f.state().begin, 2); assert.equal(f.state().reads, expected.length * 2);
  assert.deepEqual(receipt.beforeRelations, receipt.afterRelations);
  assert.equal(receipt.artifacts.length, expected.length + 3);
  assert.deepEqual(f.state().completed, receipt);
  assert.equal(receipt.kind, BUDGET_CAPTURE_KIND); assert.equal(receipt.contractSha256, RELEASE.hotfixSha256);
  assert.notEqual(receipt.contractSha256, RELEASE.contractSha256);
  assert.equal(receipt.predecessorContractSha256, RELEASE.contractSha256);
  assert.equal(receipt.captureBinding.backupSetId, receipt.backupSetId);
  assert.equal(receipt.captureBinding.releaseCommit, COMMIT);
  assert.equal(receipt.captureBinding.artifactsSha256, digestJson(receipt.artifacts));
  assert.equal(receipt.captureBindingSha256, digestJson(receipt.captureBinding));
  assert.equal(receipt.releaseReady, false); assert.ok(receipt.evidenceNotEstablished.includes('hosted-restore'));
  assert.ok(!JSON.stringify(receipt).includes(PRIVATE));
});

test('wrong DB identity, unfenced reads, fence loss, source drift and raw SQL errors never finalize a capture', async () => {
  for (const options of [{ begin: { fenceCount: 0 } }, { begin: { readOnly: false } },
    { begin: { systemIdentifier: '7656983981618135123' } }, { lostFence: true }, { changed: true },
    { storageChanged: true }, { readError: true }]) {
    const f = fixture(options); await assert.rejects(f.run, error => !String(error).includes(PRIVATE));
    assert.equal(f.state().completed, undefined); assert.equal(f.state().aborted, 1);
    assert.equal(f.state().failed.status, 'incomplete-do-not-restore');
  }
});

test('cross-candidate, cross-contract and changed baseline receipts cannot be relabeled as successor captures', async () => {
  const f = fixture(); const receipt = await f.run();
  const original = { ...receipt, kind: 'current-baseline-capture-v1', contractSha256: RELEASE.contractSha256 };
  for (const change of [{ releaseCommit: 'd'.repeat(40) }, { projectRef: 'tvyblzioajnfsbkciubk' },
    { contractSha256: RELEASE.hotfixSha256 }, { baselineSha256: '0'.repeat(64) },
    { migrationSetSha256: '0'.repeat(64) }, { plaintextWrittenToDisk: true }])
    assert.throws(() => bindBudgetCaptureReceipt({ ...original, ...change }, RELEASE, COMMIT, REUSED_CAPTURE_PINS), code('BUDGET_CAPTURE_RECEIPT_MISMATCH'));
});

test('execution validates the local fence before credentials and still enforces actual DB fence after connection', async () => {
  const f = fixture({ begin: { fenceCount: 0 } }); const calls = [];
  await assert.rejects(runBudgetDecisionCapture({ argv: args(), repoRoot: ROOT, platform: 'win32',
    fenceFactory: () => ({ hashes: REUSED_CAPTURE_PINS, check: async () => { calls.push('local-fence'); } }),
    readCredentials: () => { calls.push('credentials'); return { databaseUrl: PRIVATE, serviceKey: PRIVATE }; },
    sourceFactory: async () => { calls.push('connect'); return f.source; },
    sinkFactory: () => { calls.push('sink'); return f.sink; },
  }), error => error.code === 'BUDGET_DECISION_CAPTURE_FAILED' && !String(error).includes(PRIVATE) && error.cause === undefined);
  assert.deepEqual(calls.slice(0, 5), ['local-fence', 'credentials', 'connect', 'local-fence', 'sink']);
  assert.equal(f.state().begin, 1); assert.equal(f.state().reads, 0); assert.equal(f.state().completed, undefined);
});
