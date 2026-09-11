import { createBudgetDecisionHistoricalRepository } from './fixtures/budget-decision-historical-repository.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, realpathSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { loadBudgetDecisionHotfixRelease } from '../lib/amora-budget-decision-release-contract.mjs';
import { digest, digestJson } from '../lib/current-baseline-release-contract.mjs';
import { REUSED_CAPTURE_PINS } from '../lib/amora-budget-decision-backup-collector.mjs';
import { createPrivateSink } from '../lib/current-baseline-backup-runtime.mjs';
import { ARCHIVE_CAPTURE_KIND, collectBudgetDecisionArchiveBackup } from '../lib/amora-budget-decision-archive-collector.mjs';
import { ARCHIVE_FORMAT, archiveProcessEnvironment, inspectArchiveToc, snapshotDumpArguments,
  capturePostgresSnapshotArchive, runNativeArchiveProcess } from '../lib/postgres-snapshot-archive.mjs';

const ROOT = new URL('../..', import.meta.url);
const historicalRepository = createBudgetDecisionHistoricalRepository(fileURLToPath(ROOT));
test.after(historicalRepository.cleanup);
const release = loadBudgetDecisionHotfixRelease(historicalRepository.root);
const COMMIT = 'a'.repeat(40); const FIRST = '00000001-00000002-1';
const tempParent = realpathSync(tmpdir()); const temp = mkdtempSync(join(tempParent, 'snapshot-archive-contract-'));
test.after(() => {
  const path = realpathSync(temp); assert.ok(path.startsWith(tempParent + sep));
  rmSync(path, { recursive: true });
});
const tool = join(temp, 'synthetic-tool.exe'); writeFileSync(tool, 'not-executed');
const pin = digest(readFileSync(tool));
const marker = 'private-marker-not-for-logs';

function fixture(change = {}) {
  const testRelease = structuredClone(release);
  if (change.small) {
    const required = new Set(['public.profiles', 'auth.users', 'storage.objects', 'storage.buckets',
      'supabase_migrations.schema_migrations', 'vault.secrets', 'cron.job']);
    testRelease.baseline.relations = testRelease.baseline.relations.filter(row => required.has(row.schema + '.' + row.name));
  }
  const inventory = structuredClone(testRelease.baseline);
  inventory.storagePolicies = inventory.storagePolicies.filter(row => row.command === 'r');
  let binding; let turn = 0; let active = false; let finished; let failed; let writes = 0; let captured; let aborted = 0;
  const source = {
    async begin() { assert.equal(active, false); turn++; active = true;
      return { readOnly: true, isolation: 'repeatable read', fenceCount: 1, inventory,
        projectRef: release.contract.projectRef, systemIdentifier: release.contract.systemIdentifier,
        snapshotId: turn === 1 ? FIRST : '00000001-00000003-1' }; },
    async captureRelation(row) { return { rows: 0, bytes: Buffer.from(JSON.stringify({
      format: 'current-baseline-relation-v1', identity: row.schema + '.' + row.name, columns: ['id'], rows: [] })) }; },
    async storageIndex() { return []; },
    async captureSchema() { return { statements: ['CREATE TABLE public.synthetic (id bigint);'], globals: { roles: [] } }; },
    async end() { assert.equal(active, true); active = false; return { inventory, fenceCount: 1 }; },
    async download() { assert.fail('no synthetic Storage objects'); },
    commandReceipts() { return []; },
    async abort() { aborted++; active = false; },
  };
  const sink = {
    async initialize(value) { binding = value; },
    async write(value) {
      assert.equal(value.directory, 'part-' + String(writes).padStart(6, '0'));
      if (change.appendFails && value.bytes.includes(Buffer.from(ARCHIVE_FORMAT))) throw new Error(marker);
      writes++;
      return { backup_set_id: binding.backupSetId, artifact: value.name + '.hbam2', key: value.name + '.key.dpapi',
        plaintext_bytes: value.bytes.length, plaintext_sha256: digest(value.bytes), encrypted_sha256: 'b'.repeat(64),
        key_sha256: 'c'.repeat(64) };
    },
    async progress(value) { assert.equal(value.artifactCount, writes); },
    async finish(value) { assert.equal(value.artifacts.length, writes); finished = value; },
    async fail(value) { failed = value; },
  };
  const captureArchive = async ({ snapshotId, binding: actualBinding }) => {
    assert.equal(active, true); assert.equal(turn, 1); assert.equal(snapshotId, FIRST);
    const raw = Buffer.from('PGDMP' + marker);
    const summary = { format: ARCHIVE_FORMAT, ...actualBinding, snapshotIdentitySha256: digest(snapshotId),
      archiveDecoded: true, databaseRestoreExecuted: false, clusterRolePasswordsCaptured: false,
      archiveBytes: raw.length, archiveSha256: digest(raw), commands: Array.from({ length: 3 }, () => ({
        commandSha256: 'a'.repeat(64), outputSha256: 'b'.repeat(64), exitCode: 0 })) };
    if (change.wrongSnapshot) summary.snapshotIdentitySha256 = digest('00000001-00000003-1');
    if (change.wrongSet) summary.backupSetId = 'c'.repeat(36);
    const payload = { ...summary, archiveBase64: raw.toString('base64') };
    if (change.envelopeDiffers) payload.archiveSha256 = 'd'.repeat(64);
    captured = Buffer.from(JSON.stringify(payload));
    return { bytes: captured, summary };
  };
  return { source, sink, captured: () => captured, state: () => ({ turn, active, finished, failed, aborted }),
    run: (sinkOverride = sink) => collectBudgetDecisionArchiveBackup({ release: testRelease, expectedCommit: COMMIT, source, sink: sinkOverride,
      implementationPins: REUSED_CAPTURE_PINS, captureArchive, assertStable: async () => {} }) };
}

test('archive captures during first transaction and appends after all existing parts without changing backup identity', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.kind, ARCHIVE_CAPTURE_KIND);
  assert.equal(result.databaseArchive.snapshotIdentitySha256, digest(FIRST));
  assert.equal(result.databaseArchive.backupSetId, result.backupSetId);
  assert.equal(result.artifacts.at(-1).scope, 'database-custom-archive');
  assert.equal(result.captureBinding.artifactsSha256, digestJson(result.artifacts));
  assert.equal(result.captureBindingSha256, digestJson(result.captureBinding));
  assert.equal(result.releaseReady, false); assert.equal(result.databaseArchive.databaseRestoreExecuted, false);
  assert.equal(f.state().turn, 2); assert.equal(f.state().active, false);
  assert.ok(f.captured().every(value => value === 0));
  assert.ok(!JSON.stringify(result).includes(marker));
});

test('cross snapshot, cross backup set, altered payload and failed final encryption leave incomplete captures', async () => {
  for (const change of [{ wrongSnapshot: true }, { wrongSet: true }, { envelopeDiffers: true }, { appendFails: true }]) {
    const f = fixture(change);
    await assert.rejects(f.run, error => !String(error).includes(marker));
    assert.equal(f.state().finished, undefined); assert.equal(f.state().failed.status, 'incomplete-do-not-restore');
    assert.equal(f.state().aborted, 1); assert.ok(f.captured().every(value => value === 0));
  }
});
test('actual Windows DPAPI worker accepts the appended archive and final receipt count in one private backup set',
  { skip: process.platform !== 'win32' }, async () => {
    const privateRoot = join(tempParent, 'WeddingHanbang-Amora-Backup-SelfTest-' + randomUUID().replaceAll('-', ''));
    const sink = createPrivateSink({ repoRoot: fileURLToPath(ROOT), selfTestRoot: privateRoot });
    try {
      const f = fixture({ small: true }); const result = await f.run(sink);
      const recorded = JSON.parse(readFileSync(join(sink.directory, 'capture-receipt.json'), 'utf8'));
      assert.equal(recorded.kind, ARCHIVE_CAPTURE_KIND);
      assert.equal(recorded.backupSetId, result.backupSetId);
      assert.equal(recorded.captureBindingSha256, result.captureBindingSha256);
      assert.equal(recorded.artifacts.length, 10);
      const last = recorded.artifacts.at(-1);
      assert.equal(last.scope, 'database-custom-archive');
      const encrypted = readFileSync(join(sink.directory, 'encrypted', last.directory, last.artifact));
      assert.equal(digest(encrypted), last.encrypted_sha256.toLowerCase());
      assert.ok(!encrypted.includes(Buffer.from(marker)));
      assert.equal(JSON.parse(readFileSync(join(sink.directory, 'capture-state.json'))).status, 'captured-awaiting-release-evidence');
    } finally {
      await sink.close();
      if (existsSync(privateRoot)) {
        assert.ok(realpathSync(privateRoot).startsWith(tempParent + sep));
        assert.equal(lstatSync(privateRoot).isSymbolicLink(), false);
        rmSync(privateRoot, { recursive: true });
      }
    }
  });

test('source process environment drops inherited services and forces read-only; dump arguments cannot add filters', () => {
  const env = archiveProcessEnvironment({ PGHOST: '127.0.0.1', PGSERVICE: marker, PGSERVICEFILE: marker,
    PGOPTIONS: '-c default_transaction_read_only=off', SUPABASE_SERVICE_ROLE_KEY: marker });
  assert.equal(env.PGSERVICE, undefined); assert.equal(env.PGSERVICEFILE, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined); assert.match(env.PGOPTIONS, /read_only=on/);
  assert.deepEqual(snapshotDumpArguments(FIRST, 'postgres'), ['--no-password', '--format=custom',
    '--snapshot=' + FIRST, '--role=postgres', '--lock-wait-timeout=8000', '--encoding=UTF8']);
  assert.throws(() => snapshotDumpArguments(FIRST + ';SELECT 1', 'postgres'));
  assert.throws(() => snapshotDumpArguments(FIRST, '--no-owner'));
});

const toc = Buffer.from('1; 2615 10 SCHEMA - public postgres\n2; 1259 11 TABLE public data postgres\n3; 0 11 TABLE DATA public data postgres\n');
test('archive inspection refuses missing required schemas or a schema-only archive', () => {
  assert.equal(inspectArchiveToc(toc, ['public']).entryCount, 3);
  assert.throws(() => inspectArchiveToc(toc, ['public', 'auth']));
  assert.throws(() => inspectArchiveToc(Buffer.from('1; 2615 10 SCHEMA - public postgres\n'), ['public']));
});

function nativeFixture(change = {}) {
  const raw = Buffer.from('PGDMP-synthetic-archive');
  const calls = [];
  const runProcess = async request => {
    calls.push(request);
    if (request.file === tool && request.args[0] === '--no-password') {
      if (change.badMagic) raw[0] = 0;
      return { buffer: raw, bytes: raw.length, sha256: digest(raw), exitCode: 0 };
    }
    if (request.args[0] === '--list') {
      if (change.tocError) throw new Error(marker);
      const buffer = Buffer.from(toc);
      return { buffer, bytes: buffer.length, sha256: digest(buffer), exitCode: 0 };
    }
    if (change.decodeError) throw new Error(marker);
    return { bytes: 32, sha256: 'e'.repeat(64), exitCode: 0 };
  };
  return { raw, calls, run: () => capturePostgresSnapshotArchive({ snapshotId: FIRST,
    binding: { projectRef: release.contract.projectRef, systemIdentifier: release.contract.systemIdentifier,
      releaseCommit: COMMIT, backupSetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', hotfixSha256: release.hotfixSha256,
      baselineSha256: release.baselineSha256 }, readerRole: 'postgres', connectionEnv: { PGPASSWORD: marker },
    pgDump: tool, pgDumpSha256: pin, pgRestore: tool, pgRestoreSha256: pin, requiredSchemas: ['public'], runProcess }) };
}
test('archive is inspected and fully decoded without giving restore inspection database credentials', async () => {
  const f = nativeFixture(); const result = await f.run();
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1].env.PGPASSWORD, undefined); assert.equal(f.calls[2].env.PGPASSWORD, undefined);
  assert.deepEqual(f.calls[1].args, ['--list']); assert.deepEqual(f.calls[2].args, ['--file=-']);
  assert.equal(f.calls[2].digestOnly, true);
  assert.equal(result.summary.databaseRestoreExecuted, false); assert.ok(f.raw.every(value => value === 0));
  result.bytes.fill(0);
});
test('magic-only corruption, TOC failure and truncated data decode cannot create a successful envelope', async () => {
  for (const change of [{ badMagic: true }, { tocError: true }, { decodeError: true }]) {
    const f = nativeFixture(change);
    await assert.rejects(f.run, error => error.code === 'SNAPSHOT_ARCHIVE_CAPTURE_FAILED' && !String(error).includes(marker));
    assert.ok(f.raw.every(value => value === 0));
  }
});
test('actual child process bounds output, rejects stderr/nonzero/timeout, and returns bytes only on clean close', async () => {
  const run = (script, maximumBytes = 64, timeoutMs = 3000) => runNativeArchiveProcess({
    file: process.execPath, args: ['-e', script], env: archiveProcessEnvironment(), maximumBytes, timeoutMs });
  const success = await run("process.stdout.write('ok')");
  assert.equal(success.buffer.toString(), 'ok');
  for (const script of ["process.stderr.write('private-marker-not-for-logs')", 'process.exit(3)',
    "process.stdout.write('x'.repeat(200))", 'setTimeout(()=>{},10000)'])
    await assert.rejects(run(script, 64, script.includes('setTimeout') ? 150 : 3000),
      error => error.code === 'SNAPSHOT_ARCHIVE_PROCESS_FAILED' && !String(error).includes(marker));
});
test('timeout settles even when killing a child never emits close and late bytes are discarded', async () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = new EventEmitter(); child.stdin.end = () => {};
  let kills = 0; child.kill = () => { kills++; return false; };
  await assert.rejects(runNativeArchiveProcess({ file: tool, args: [], env: {}, maximumBytes: 64,
    timeoutMs: 20, spawnImpl: () => child }), { code: 'SNAPSHOT_ARCHIVE_PROCESS_FAILED' });
  assert.equal(kills, 1);
  const late = Buffer.from(marker); child.stdout.emit('data', late);
  assert.ok(late.every(value => value === 0));
});
test('stdin EPIPE/Windows EOF is accepted only for list inspection with exit zero, never for full decode or other failures', async () => {
  const run = (args, allowEarlyStdinClose, exitCode = 0, errorCode = 'EPIPE') => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = new EventEmitter(); child.kill = () => true;
    child.stdin.end = () => queueMicrotask(() => {
      child.stdin.emit('error', Object.assign(new Error(marker), { code: errorCode }));
      child.stdout.emit('data', Buffer.from(toc)); child.emit('close', exitCode);
    });
    return runNativeArchiveProcess({ file: tool, args, env: {}, input: Buffer.from('PGDMP-synthetic'),
      maximumBytes: 2048, allowEarlyStdinClose, spawnImpl: () => child });
  };
  const result = await run(['--list'], true); assert.equal(result.buffer.toString(), toc.toString());
  const windows = await run(['--list'], true, 0, 'EOF'); assert.equal(windows.buffer.toString(), toc.toString());
  await assert.rejects(run(['--list'], false));
  await assert.rejects(run(['--file=-'], false, 0, 'EOF'));
  await assert.rejects(run(['--list'], true, 0, 'EACCES'));
  await assert.rejects(run(['--list'], true, 1));
  assert.throws(() => run(['--file=-'], true), { code: 'SNAPSHOT_ARCHIVE_EARLY_CLOSE_FORBIDDEN' });
});
test('historical archive CLI default/help and forbidden options never expose an inherited credential marker', () => {
  const script = join(historicalRepository.root, 'scripts/amora-budget-decision-archive-collect.mjs');
  for (const args of [[], ['--help'], ['--skip-fence', marker], ['--restore', marker], ['--help', '--apply']]) {
    const result = spawnSync(process.execPath, [script, ...args],
      { encoding: 'utf8', env: { ...process.env, HBAM2_DATABASE_URL: marker, SUPABASE_SERVICE_ROLE_KEY: marker } });
    assert.ok(!result.stdout.includes(marker)); assert.ok(!result.stderr.includes(marker));
    if (args.length < 2) {
      assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).remoteCalls, 0);
    } else assert.equal(result.status, 1);
  }
});
