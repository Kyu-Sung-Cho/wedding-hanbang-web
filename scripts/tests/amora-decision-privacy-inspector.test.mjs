import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadAmoraDecisionPrivacyCandidate } from '../lib/amora-decision-privacy-candidate.mjs';
import { createPreparationStyleHistoricalRepository } from './fixtures/preparation-style-historical-repository.mjs';

const moduleUrl = new URL('../lib/amora-decision-privacy-inspector.mjs', import.meta.url);
const commit = 'a'.repeat(40);
const project = 'slrtobkksjmxgzatjyqb';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const plan = loadAmoraDecisionPrivacyCandidate(repoRoot);
const at = new Date('2026-09-21T00:00:00.000Z');
function observation() {
  const sha = 'a'.repeat(64);
  return { format: 'amora-decision-privacy-inspection-v1', systemIdentifier: plan.contract.systemIdentifier,
    database: 'postgres', serverVersion: '17.6', currentUser: 'supabase_read_only_user',
    sessionUser: 'supabase_read_only_user', readOnly: true, observedAt: at.toISOString(),
    ledger: [{ version: '20260920120000', name: 'wedding_preparation_style', statementCount: 1,
      statementsSha256: sha, singleStatementSha256: sha }], ledgerSha256: sha,
    functions: [...plan.contract.scope.changedFunctions, ...plan.contract.scope.addedFunctions].sort().map(signature =>
      ({ signature, present: false })), overloads: [], preservedCatalogSha256: sha };
}
const args = (output = join(tmpdir(), 'amora-inspection-test.jsonl')) => [
  '--inspect', `--expected-commit=${commit}`, `--project-ref=${project}`, `--receipt-out=${output}`,
];

test('inspection accepts only a complete exact read-only invocation', async () => {
  const { parseAmoraDecisionPrivacyInspectionArgs: parse } = await import(moduleUrl);
  assert.deepEqual(parse(args()), { mode: 'inspect', expectedCommit: commit, projectRef: project,
    receiptOut: join(tmpdir(), 'amora-inspection-test.jsonl') });
  for (const argv of [[], args().slice(1), [...args(), '--apply'], [...args(), '--rehearse'],
    [...args(), '--finalize'], [...args(), '--inspect'], [...args(), `--project-ref=${project}`],
    [...args(), '--url=https://elsewhere.invalid'], [...args(), '--query=SELECT 1'],
    args().map(arg => arg.startsWith('--expected-commit=') ? '--expected-commit=main' : arg),
    args().map(arg => arg.startsWith('--project-ref=') ? '--project-ref=rgxdizztidbgwnsbadml' : arg),
    args('relative.jsonl')]) {
    assert.throws(() => parse(argv), { code: 'AMORA_INSPECTION_ARGUMENT_INVALID' });
  }
});

test('private receipt is exclusive, durable, outside checkout, and rejects linked parents', async () => {
  const { createAmoraDecisionPrivacyInspectionReceipt: create } = await import(moduleUrl);
  const folder = mkdtempSync(join(tmpdir(), 'amora-inspection-receipt-'));
  try {
    const path = join(folder, 'result.jsonl');
    const receipt = create(repoRoot, path);
    receipt.append({ status: 'started' });
    receipt.append({ status: 'observed-unreviewed', releaseAuthorized: false });
    receipt.close();
    assert.deepEqual(readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse), [
      { status: 'started' }, { status: 'observed-unreviewed', releaseAuthorized: false },
    ]);
    assert.throws(() => create(repoRoot, path), { code: 'AMORA_INSPECTION_RECEIPT_UNAVAILABLE' });
    assert.throws(() => create(repoRoot, join(repoRoot, 'never-write.jsonl')),
      { code: 'AMORA_INSPECTION_RECEIPT_PATH_INVALID' });
    const link = join(folder, 'linked-checkout');
    symlinkSync(repoRoot, link, 'junction');
    assert.throws(() => create(repoRoot, join(link, 'never-write.jsonl')),
      { code: 'AMORA_INSPECTION_RECEIPT_PATH_INVALID' });
    const existing = join(folder, 'existing.jsonl');
    writeFileSync(existing, 'keep');
    assert.throws(() => create(repoRoot, existing), { code: 'AMORA_INSPECTION_RECEIPT_UNAVAILABLE' });
    assert.equal(readFileSync(existing, 'utf8'), 'keep');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('receipt retries short writes, flushes only complete JSON lines and rejects zero progress', async () => {
  const { appendAmoraDecisionPrivacyInspectionReceipt: append } = await import(moduleUrl);
  const chunks = [];
  let flushed = false;
  append(123, { status: 'started' }, { write: (_fd, bytes, offset, length) => {
    assert.equal(flushed, false);
    const size = Math.min(length, 3);
    chunks.push(bytes.subarray(offset, offset + size));
    return size;
  }, flush: fd => { assert.equal(fd, 123); flushed = true; } });
  assert.equal(Buffer.concat(chunks).toString(), '{"status":"started"}\n');
  assert.equal(flushed, true);
  for (const written of [0, -1, NaN, 10000]) {
    assert.throws(() => append(123, {}, { write: () => written, flush: () => assert.fail('must not fsync incomplete line') }),
      { code: 'AMORA_INSPECTION_RECEIPT_WRITE_INCOMPLETE' });
  }
  assert.throws(() => append(123, {}, { write: (_fd, _bytes, _offset, length) => length,
    flush: () => { throw new Error('synthetic fsync failure'); } }), /synthetic fsync failure/);
});

test('unsafe executable overrides and invalid modes stop before source, receipt, or remote access', async () => {
  const { runAmoraDecisionPrivacyInspection: run } = await import(moduleUrl);
  let touched = false;
  const forbidden = () => { touched = true; throw new Error('must not reach boundary'); };
  for (const environment of [{ NODE_OPTIONS: '--import=bad' }, { NODE_PATH: '/bad' },
    { SUPABASE_CLI_BINARY_OVERRIDE: '/bad' }, { GIT_INDEX_FILE: '/bad' },
    { GIT_CONFIG_KEY_0: 'core.hooksPath' }, { git_work_tree: '/bad' },
    { GIT_CONFIG_PARAMETERS: "'core.fsmonitor=untrusted-helper'" }, { GIT_CONFIG: '/bad' },
    { GIT_EXEC_PATH: '/bad' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { NODE_EXTRA_CA_CERTS: '/bad' }]) {
    await assert.rejects(run({ repoRoot, argv: args(), environment, assertSource: forbidden,
      receiptFactory: forbidden, transport: { inspect: forbidden } }), { code: 'AMORA_INSPECTION_EXECUTION_ENVIRONMENT_UNSAFE' });
  }
  await assert.rejects(run({ repoRoot, argv: [...args(), '--apply'], environment: {}, assertSource: forbidden,
    receiptFactory: forbidden, transport: { inspect: forbidden } }), { code: 'AMORA_INSPECTION_ARGUMENT_INVALID' });
  assert.equal(touched, false);
});

test('real Git checkout must be clean, at the exact commit and expected origin before reading remotely', async () => {
  const { runAmoraDecisionPrivacyInspection: run } = await import(moduleUrl);
  const folder = mkdtempSync(join(tmpdir(), 'amora-inspection-git-'));
  const git = (...argv) => execFileSync('git', ['-C', folder, ...argv], { encoding: 'utf8', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let touched = false;
  try {
    git('init');
    git('-c', 'user.name=Inspection Fixture', '-c', 'user.email=inspection@example.invalid',
      'commit', '--allow-empty', '-m', 'synthetic fixture');
    const head = git('rev-parse', 'HEAD');
    const argv = args().map(value => value.startsWith('--expected-commit=') ? `--expected-commit=${head}` : value);
    const execute = (input = argv) => run({ repoRoot: folder, argv: input, environment: {},
      receiptFactory: () => { touched = true; }, transport: { inspect: () => { touched = true; } } });
    git('remote', 'add', 'origin', 'https://example.invalid/unknown.git');
    await assert.rejects(execute(), { code: 'AMORA_INSPECTION_SOURCE_NOT_CLEAN_EXACT_COMMIT' });
    git('remote', 'set-url', 'origin', 'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git');
    await assert.rejects(execute(args()), { code: 'AMORA_INSPECTION_SOURCE_NOT_CLEAN_EXACT_COMMIT' });
    writeFileSync(join(folder, 'untracked.txt'), 'synthetic');
    await assert.rejects(execute(), { code: 'AMORA_INSPECTION_SOURCE_NOT_CLEAN_EXACT_COMMIT' });
    assert.equal(touched, false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('actual CLI refuses mutation commands without printing credentials or untrusted arguments', () => {
  const secret = 'SYNTHETIC_secret_not_for_stdout';
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../amora-decision-privacy-inspect.mjs', import.meta.url)),
    ...args(), '--apply', `--query=${secret}`], { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: secret } });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { status: 'blocked', code: 'AMORA_INSPECTION_ARGUMENT_INVALID',
    productionApplyImplemented: false, runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false });
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes(secret), false);
});

test('inspection saves its validated observation privately but returns no deployment authority or raw catalog', async () => {
  const { runAmoraDecisionPrivacyInspection: run } = await import(moduleUrl);
  const folder = mkdtempSync(join(tmpdir(), 'amora-inspection-run-'));
  try {
    const output = join(folder, 'result.jsonl');
    let sourceChecks = 0;
    const result = await run({ repoRoot, argv: args(output), environment: {}, assertSource: () => { sourceChecks++; },
      now: () => at, transport: { inspect: async () => [{ observation: observation() }] } });
    assert.deepEqual(result, { status: 'observed-unreviewed', ledgerState: 'candidate-absent', ledgerCount: 1,
      productionApplyImplemented: false, runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false });
    assert.equal(sourceChecks, 2);
    const receipts = readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(receipts.map(row => row.status), ['started', 'observed-unreviewed']);
    assert.equal(receipts[1].observation.systemIdentifier, plan.contract.systemIdentifier);
    assert.equal(receipts[1].releaseCommit, commit);
    assert.equal(receipts[1].contractSha256, plan.contractSha256);
    assert.match(receipts[1].querySha256, /^[a-f0-9]{64}$/);
    assert.equal(receipts[1].releaseAuthorized, false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('management inspection sends only fixed catalog SQL to the pinned HTTPS host using the read-only API role', async () => {
  const { createAmoraDecisionPrivacyInspectionTransport: create } = await import(moduleUrl);
  const token = `sbp_${'a'.repeat(40)}`;
  const transport = create({ plan, accessToken: token, fetchImpl: async (url, init) => {
    assert.equal(url, `https://api.supabase.com/v1/projects/${project}/database/query`);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(init.body);
    assert.equal(body.read_only, true);
    assert.deepEqual(Object.keys(body).sort(), ['query', 'read_only']);
    assert.match(body.query, /^BEGIN TRANSACTION READ ONLY;/);
    assert.match(body.query, /ROLLBACK;\s*$/);
    assert.equal(body.query.includes(token), false);
    return new Response(JSON.stringify([{ observation: observation() }]), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.deepEqual(await transport.inspect(), [{ observation: observation() }]);
  await assert.rejects(transport.inspect('DELETE FROM profiles'), { code: 'AMORA_INSPECTION_ARGUMENT_INVALID' });
});

test('remote failures cannot forge a public error code or reveal response or credential text', async () => {
  const { createAmoraDecisionPrivacyInspectionTransport: create } = await import(moduleUrl);
  const secret = `sbp_${'a'.repeat(40)}`;
  for (const fetchImpl of [
    async () => { const error = new Error(secret); error.code = 'AMORA_INSPECTION_PRIVATE_RESPONSE'; throw error; },
    async () => new Response(secret, { status: 403 }),
    async () => new Response(secret, { status: 302, headers: { location: 'https://attacker.invalid' } }),
    async () => new Response(secret, { headers: { 'content-type': 'application/json' } }),
    async () => new Response(JSON.stringify({ secret }), { headers: { 'content-type': 'application/json' } }),
  ]) {
    await assert.rejects(create({ plan, accessToken: secret, fetchImpl }).inspect(), error => {
      assert.ok(['AMORA_INSPECTION_REMOTE_UNCONFIRMED', 'AMORA_INSPECTION_RESPONSE_INVALID'].includes(error.code));
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes('PRIVATE_RESPONSE'), false);
      return true;
    });
  }
});

test('status-clean hidden Git index changes cannot be attributed to the expected commit', async () => {
  const { runAmoraDecisionPrivacyInspection: run } = await import(moduleUrl);
  const fixture = createPreparationStyleHistoricalRepository(repoRoot);
  const outputFolder = mkdtempSync(join(tmpdir(), 'amora-inspection-hidden-index-'));
  const git = (...argv) => execFileSync('git', ['-C', fixture.root, ...argv], { encoding: 'utf8', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const files = ['supabase/release-contracts/amora-decision-privacy-candidate-v1.json',
    ...plan.contract.migrations.map(pin => `supabase/migrations/${pin.file}`),
    'scripts/amora-decision-privacy-inspect.mjs', 'scripts/lib/amora-decision-privacy-inspector.mjs',
    'scripts/lib/amora-decision-privacy-inspection.mjs', 'scripts/lib/amora-decision-privacy-candidate.mjs',
    'scripts/lib/current-baseline-release-contract.mjs'];
  try {
    for (const file of files) {
      mkdirSync(dirname(join(fixture.root, file)), { recursive: true });
      copyFileSync(join(repoRoot, file), join(fixture.root, file));
    }
    git('init');
    git('remote', 'add', 'origin', 'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git');
    git('add', '.');
    git('-c', 'user.name=Inspection Fixture', '-c', 'user.email=inspection@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '-m', 'synthetic source binding');
    const head = git('rev-parse', 'HEAD');
    const file = 'scripts/lib/amora-decision-privacy-inspector.mjs';
    const original = readFileSync(join(fixture.root, file));
    const clean = await run({ repoRoot: fixture.root,
      argv: args(join(outputFolder, 'clean.jsonl')).map(value => value.startsWith('--expected-commit=') ? `--expected-commit=${head}` : value),
      environment: process.env, now: () => at, transport: { inspect: async () => [{ observation: observation() }] } });
    assert.equal(clean.status, 'observed-unreviewed', 'the same complete clean Git fixture is accepted');
    for (const flag of ['skip-worktree', 'assume-unchanged']) {
      git('update-index', `--${flag}`, file);
      writeFileSync(join(fixture.root, file), Buffer.concat([original, Buffer.from('\n// hidden synthetic change\n')]));
      assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'fixture really hides this source edit');
      let inspected = false;
      await assert.rejects(run({ repoRoot: fixture.root,
        argv: args(join(outputFolder, `${flag}.jsonl`)).map(value => value.startsWith('--expected-commit=') ? `--expected-commit=${head}` : value),
        environment: process.env, now: () => at, transport: { inspect: async () => {
          inspected = true; return [{ observation: observation() }];
        } } }), { code: 'AMORA_INSPECTION_SOURCE_NOT_CLEAN_EXACT_COMMIT' });
      assert.equal(inspected, false);
      writeFileSync(join(fixture.root, file), original);
      git('update-index', `--no-${flag}`, file);
    }
  } finally { fixture.cleanup(); rmSync(outputFolder, { recursive: true, force: true }); }
});

test('management transport bounds body bytes during streaming and times out stalled headers or bodies', async () => {
  const { createAmoraDecisionPrivacyInspectionTransport: create } = await import(moduleUrl);
  const accessToken = `sbp_${'a'.repeat(40)}`;
  for (const fetchImpl of [
    async () => new Response('[]', { headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024 + 1) } }),
    async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024));
      controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      controller.close();
    } }), { headers: { 'content-type': 'application/json' } }),
  ]) await assert.rejects(create({ plan, accessToken, fetchImpl }).inspect(), { code: 'AMORA_INSPECTION_RESPONSE_TOO_LARGE' });
  for (const fetchImpl of [async () => new Promise(() => {}),
    async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }),
      { headers: { 'content-type': 'application/json' } })]) {
    await assert.rejects(create({ plan, accessToken, fetchImpl, timeoutMs: 10 }).inspect(),
      { code: 'AMORA_INSPECTION_REMOTE_UNCONFIRMED' });
  }
  for (const patch of [{ accessToken: '' }, { accessToken: `${accessToken}\n` },
    { plan: { ...plan, contract: { ...plan.contract, projectRef: 'rgxdizztidbgwnsbadml' } } },
    { timeoutMs: 0 }, { timeoutMs: 45_001 }]) {
    assert.throws(() => create({ plan, accessToken, ...patch }));
  }
});

test('invalid, stale or source-changed observations leave a durable blocked receipt with no success assertion', async () => {
  const { runAmoraDecisionPrivacyInspection: run } = await import(moduleUrl);
  const folder = mkdtempSync(join(tmpdir(), 'amora-inspection-failures-'));
  try {
    const cases = [[], [{ observation: observation(), extra: 'not allowed' }],
      [{ observation: { ...observation(), currentUser: 'postgres' } }],
      [{ observation: { ...observation(), observedAt: '2020-01-01T00:00:00Z' } }], 'source-drift', 'external-error'];
    for (const [index, value] of cases.entries()) {
      const output = join(folder, `${index}.jsonl`);
      let checks = 0;
      await assert.rejects(run({ repoRoot, argv: args(output), environment: {}, now: () => at,
        assertSource: () => { if (++checks === 2 && value === 'source-drift') throw Error('private source failure'); },
        transport: { inspect: async () => {
          if (value === 'external-error') throw Error('private backend failure');
          return value === 'source-drift' ? [{ observation: observation() }] : value;
        } } }));
      const records = readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(records.map(row => row.status), ['started', 'blocked']);
      assert.equal(records.at(-1).releaseAuthorized, false);
      assert.equal(JSON.stringify(records).includes('private source failure'), false);
      assert.equal(JSON.stringify(records).includes('private backend failure'), false);
      assert.equal(Object.hasOwn(records.at(-1), 'observation'), false);
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
