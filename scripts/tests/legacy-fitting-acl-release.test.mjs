import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { appendLegacyFittingAclReceipt, assertLegacyFittingAclGitSource, buildLegacyFittingAclMutationSql, buildLegacyFittingAclObservationSql,
  LEGACY_FITTING_ACL_PINS, loadLegacyFittingAclReleasePlan, openLegacyFittingAclReceipt, parseLegacyFittingAclArgs,
  runLegacyFittingAclRelease, validateLegacyFittingAclObservation } from '../lib/legacy-fitting-acl-release.mjs';

const root = resolve(import.meta.dirname, '../..');
const instant = new Date('2026-09-28T11:00:00Z');
const commit = 'a'.repeat(40), project = 'slrtobkksjmxgzatjyqb';
const args = (mode = 'apply') => ['--legacy-fitting-acl', `--${mode}`, `--expected-commit=${commit}`,
  `--project-ref=${project}`, `--receipt-out=${join(tmpdir(), 'unused-legacy-fitting-synthetic-receipt.jsonl')}`,
  `--confirm-production=legacy-fitting-acl-20260928:${project}:${mode}:${commit}`];
const code = expected => error => error?.code === expected;
const preservation = () => ({ defaultAclSha256: 'b'.repeat(64), ledgerSha256: 'c'.repeat(64), ledgerCount: 240 });
const observed = (phase = 'before') => ({ format: 'legacy-fitting-acl-observation-v1', systemIdentifier: '7581440907192989109',
  serverVersion: '17.6', database: 'postgres', readOnly: true, observedAt: instant.toISOString(), preservation: preservation(),
  inventory: LEGACY_FITTING_ACL_PINS.map(pin => ({ ...pin, owner: 'postgres', securityDefiner: true, settings: null, aclExplicit: true,
    acl: (phase === 'before' ? ['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role'] : ['postgres', 'service_role'])
      .map(grantee => ({ grantee, grantor: 'postgres', privilege: 'EXECUTE', grantable: false })),
    execute: phase === 'before' ? [true, true, true, true] : [false, false, true, true] })) });

function fixture({ mode = 'apply', observations = [observed(), observed(), observed('after')], onQuery, onRecord, onSource, now } = {}) {
  const calls = [], events = [];
  let reads = 0, closed = false, sourceChecks = 0;
  return { calls, events, get closed() { return closed; }, get sourceChecks() { return sourceChecks; },
    run: () => runLegacyFittingAclRelease({ repoRoot: root, argv: args(mode), now: now ?? (() => instant),
      assertSource: () => { sourceChecks++; onSource?.(sourceChecks); },
      receiptFactory: () => ({ append: event => { onRecord?.(event); events.push(event); }, close: () => { closed = true; } }),
      query: async (sql, options) => {
        calls.push({ sql, options });
        const result = await onQuery?.(sql, calls.length);
        if (result !== undefined) return result;
        if (sql === buildLegacyFittingAclObservationSql()) return [{ observation: structuredClone(observations[reads++]) }];
        return [];
      } }),
  };
}

test('applies only after exact same-bundle rollback, fresh source and separate readonly checks', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 'applied-and-postverified');
  assert.equal(result.remoteWritesPerformed, true);
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls[1].sql.replace(/ROLLBACK;$/, 'COMMIT;'), f.calls[3].sql);
  assert.deepEqual(f.calls.map(call => call.options.readOnly), [true, false, true, false, true]);
  assert.equal(f.sourceChecks, 2);
  assert.equal(f.events.at(-1).status, result.status);
  assert.equal(f.closed, true);
});

test('inspect, rehearse and already-restricted do not commit mutations', async () => {
  for (const options of [{ mode: 'inspect' }, { mode: 'rehearse' }, { observations: [observed('after')] }]) {
    const f = fixture(options);
    assert.equal((await f.run()).remoteWritesPerformed, false);
    assert.equal(f.calls.filter(({ sql }) => !sql.startsWith('BEGIN READ ONLY') && sql.endsWith('COMMIT;')).length, 0);
    assert.equal(f.closed, true);
  }
});

test('real management adapter keeps reviewed admin payload while SQL enforces readonly observation', async () => {
  const originalFetch = globalThis.fetch, originalToken = process.env.SUPABASE_ACCESS_TOKEN;
  let calls = 0;
  process.env.SUPABASE_ACCESS_TOKEN = `sbp_${'a'.repeat(40)}`;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, `https://api.supabase.com/v1/projects/${project}/database/query`);
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { query: buildLegacyFittingAclObservationSql(), read_only: false });
    return new Response(JSON.stringify([{ observation: observed() }]), { status: 201 });
  };
  try {
    const result = await runLegacyFittingAclRelease({ repoRoot: root, argv: args('inspect'), now: () => instant,
      assertSource: () => {}, receiptFactory: () => ({ append: () => {}, close: () => {} }) });
    assert.equal(result.status, 'inspected-unrestricted'); assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = originalToken;
  }
});

test('unknown, duplicate, mixed, rollback, wrong project/commit/confirmation arguments are blocked', () => {
  const invalid = [[], args().slice(0, -1), [...args(), '--rehearse'], [...args(), '--apply'], [...args(), '--legacy-fitting-acl'],
    [...args(), '--rollback'], [...args(), '--unexpected=yes'], [...args(), `--project-ref=${project}`],
    args().map(arg => arg.startsWith('--project-ref=') ? '--project-ref=other' : arg),
    args().map(arg => arg.startsWith('--expected-commit=') ? '--expected-commit=HEAD' : arg),
    args().map(arg => arg.startsWith('--receipt-out=') ? '--receipt-out=relative.jsonl' : arg),
    args().map(arg => arg.startsWith('--confirm-production=') ? `${arg}x` : arg)];
  for (const argv of invalid) assert.throws(() => parseLegacyFittingAclArgs(argv));
});

test('receipts inside source are refused before any effects; dirty real source is refused', async () => {
  for (const file of [root, join(root, 'receipt.jsonl'), join(root, 'scripts/../receipt.jsonl')]) {
    let effects = 0;
    await assert.rejects(runLegacyFittingAclRelease({ repoRoot: root,
      argv: args().map(arg => arg.startsWith('--receipt-out=') ? `--receipt-out=${file}` : arg),
      assertSource: () => { effects++; }, receiptFactory: () => { effects++; }, query: () => { effects++; },
    }), code('FITTING_ACL_RECEIPT_PATH_INVALID'));
    assert.equal(effects, 0);
  }
  let effects = 0;
  await assert.rejects(runLegacyFittingAclRelease({ repoRoot: root, argv: args(),
    receiptFactory: () => { effects++; }, query: () => { effects++; },
  }), code('FITTING_ACL_SOURCE_NOT_CLEAN_EXACT_COMMIT'));
  assert.equal(effects, 0);
});

test('same-HEAD dirty source is refused even when inherited Git environment targets another clean repository', () => {
  const temp = mkdtempSync(join(tmpdir(), 'fitting-acl-git-source-'));
  const clean = join(temp, 'clean'), dirty = join(temp, 'dirty');
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^GIT_/i.test(key)));
  const clearGitEnv = () => { for (const key of Object.keys(process.env)) if (/^GIT_/i.test(key)) delete process.env[key]; };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const git = (cwd, args) => execFileSync('git', ['--no-replace-objects', '-C', cwd, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'], env,
  }).trim();
  try {
    clearGitEnv();
    git(temp, ['init', clean]);
    writeFileSync(join(clean, 'tracked.txt'), 'reviewed\n');
    git(clean, ['add', 'tracked.txt']);
    git(clean, ['-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '-m', 'synthetic local source fixture']);
    git(temp, ['clone', '--local', '--no-hardlinks', clean, dirty]);
    const head = git(clean, ['rev-parse', 'HEAD']);
    assert.equal(git(dirty, ['rev-parse', 'HEAD']), head);
    assert.doesNotThrow(() => assertLegacyFittingAclGitSource(clean, head));
    writeFileSync(join(dirty, 'tracked.txt'), 'unreviewed change\n');
    assert.equal(git(clean, ['status', '--porcelain']), '');
    assert.match(git(dirty, ['status', '--porcelain']), /tracked.txt/);
    assert.throws(() => assertLegacyFittingAclGitSource(dirty, head), code('FITTING_ACL_SOURCE_NOT_CLEAN_EXACT_COMMIT'));
    const variants = [
      { GIT_DIR: join(clean, '.git'), GIT_WORK_TREE: clean },
      { GIT_CONFIG_PARAMETERS: "'core.worktree=" + clean.replaceAll('\\', '/') + "'" },
      { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: clean },
      { GIT_DIR: join(clean, '.git'), GIT_WORK_TREE: clean, GIT_INDEX_FILE: join(clean, '.git/index'),
        GIT_NO_LAZY_FETCH: '0', GIT_TERMINAL_PROMPT: '1' },
    ];
    for (const injected of variants) {
      clearGitEnv(); Object.assign(process.env, injected);
      assert.throws(() => assertLegacyFittingAclGitSource(dirty, head), code('FITTING_ACL_SOURCE_NOT_CLEAN_EXACT_COMMIT'));
      assert.doesNotThrow(() => assertLegacyFittingAclGitSource(clean, head));
    }
  } finally {
    clearGitEnv(); Object.assign(process.env, inherited);
    rmSync(temp, { recursive: true, force: true });
  }
});

test('contract, generated observation and mutation templates are independently pinned', () => {
  const plan = loadLegacyFittingAclReleasePlan(root);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(plan.contractSha256, sha(readFileSync(join(root, 'supabase/release-contracts/legacy-fitting-acl-v1.json'))));
  assert.equal(plan.runtimeSha256, sha(readFileSync(join(root, plan.contract.runtimeFile))));
  assert.equal(plan.contract.sql.observationSha256, sha(buildLegacyFittingAclObservationSql()));
  assert.equal(plan.contract.runtimeEvidenceVerified, false);
  assert.equal(plan.contract.scope.fullOriginalRestore, 'not-proven');
  assert.equal(Object.hasOwn(plan.contract, 'runtimeSha256'), false, 'one-way pins must not become circular');
});

test('definition, exact overloads, owner, definer, settings, explicit/default and effective privileges all fail closed', async () => {
  const alter = patch => { const value = observed(); Object.assign(value.inventory[0], patch); return value; };
  const invalid = [
    alter({ identity: 'public.cleanup_expired_fittings(text)' }), alter({ definitionSha256: 'd'.repeat(64) }),
    alter({ owner: 'service_role' }), alter({ securityDefiner: false }), alter({ settings: ['search_path=public'] }),
    alter({ aclExplicit: false }), alter({ acl: [] }), alter({ execute: [true, true, false, true] }),
    { ...observed(), inventory: [observed().inventory[0]] },
    { ...observed(), inventory: [...observed().inventory, observed().inventory[0]] },
  ];
  const inherited = observed('after'); inherited.inventory[0].execute[0] = true; invalid.push(inherited);
  const grantable = observed(); grantable.inventory[0].acl[0].grantable = true; invalid.push(grantable);
  const mixed = observed(); mixed.inventory[0] = observed('after').inventory[0]; invalid.push(mixed);
  for (const before of invalid) {
    const f = fixture({ observations: [before] });
    await assert.rejects(f.run(), code('FITTING_ACL_INVENTORY_DRIFT'));
    assert.equal(f.calls.length, 1);
    assert.equal(f.events.at(-1).status, 'blocked-before-mutation');
  }
});

test('wrong cluster, database, PG major, stale/future observation and malformed preservation cannot mutate', async () => {
  for (const patch of [{ systemIdentifier: '1' }, { database: 'other' }, { serverVersion: '18.1' }, { readOnly: false },
    { observedAt: '2026-09-28T10:57:59Z' }, { observedAt: '2026-09-28T11:00:11Z' }, { observedAt: 'bad' },
    { preservation: { ...preservation(), ledgerSha256: 'not-sha' } },
    { preservation: { ...preservation(), ledgerCount: -1 } }]) {
    const f = fixture({ observations: [{ ...observed(), ...patch }] });
    await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
  }
});

test('rehearsal error, malformed acknowledgment or rollback drift prevents commit', async () => {
  for (const options of [
    { onQuery: (_sql, call) => { if (call === 2) throw Error('synthetic timeout'); } },
    { onQuery: (_sql, call) => call === 2 ? {} : undefined },
    { observations: [observed(), observed('after')] },
    { observations: [observed(), { ...observed(), preservation: { ...preservation(), defaultAclSha256: 'd'.repeat(64) } }] },
    { observations: [observed(), { ...observed(), preservation: { ...preservation(), ledgerCount: 241 } }] },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.run(), code('FITTING_ACL_OUTCOME_REQUIRES_INSPECTION'));
    assert.ok(f.calls.length <= 3);
    assert.equal(f.events.some(event => event.status === 'apply-outcome-unverified'), false);
  }
});

test('source change or elapsed deadline after rollback or durable apply intent prevents commit', async () => {
  for (const status of ['rehearsed-and-rolled-back', 'apply-outcome-unverified']) {
    let time = instant;
    const f = fixture({ now: () => time, onRecord: event => { if (event.status === status) time = new Date(instant.getTime() + 120_001); } });
    await assert.rejects(f.run(), code('FITTING_ACL_OUTCOME_REQUIRES_INSPECTION'));
    assert.equal(f.calls.length, 3);
  }
  const f = fixture({ onSource: count => { if (count === 2) throw Error('source drift'); } });
  await assert.rejects(f.run(), code('FITTING_ACL_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(f.calls.length, 3);
});

test('receipt durability failure blocks its corresponding remote mutation', async () => {
  for (const [status, calls] of [['started', 0], ['before-observed', 1], ['rehearsal-outcome-unverified', 1], ['apply-outcome-unverified', 3]]) {
    const f = fixture({ onRecord: event => { if (event.status === status) throw Error('synthetic disk full'); } });
    await assert.rejects(f.run()); assert.equal(f.calls.length, calls); assert.equal(f.closed, true);
  }
});

test('lost commit response has no retry, postcheck or rollback; postcheck drift is not success', async () => {
  const ambiguous = fixture({ onQuery: (_sql, count) => { if (count === 4) throw Error('lost response after commit'); } });
  await assert.rejects(ambiguous.run(), code('FITTING_ACL_OUTCOME_REQUIRES_INSPECTION'));
  assert.equal(ambiguous.calls.length, 4);
  assert.equal(ambiguous.events.at(-1).retryProhibited, true);
  for (const after of [observed(), { ...observed('after'), preservation: { ...preservation(), ledgerSha256: 'd'.repeat(64) } }]) {
    const f = fixture({ observations: [observed(), observed(), after] });
    await assert.rejects(f.run(), code('FITTING_ACL_OUTCOME_REQUIRES_INSPECTION'));
    assert.equal(f.calls.length, 5);
    assert.equal(f.events.some(event => event.status === 'applied-and-postverified'), false);
  }
});

test('mutation SQL contains only exact two revokes and bounded target/baseline/post guards', () => {
  const sql = buildLegacyFittingAclMutationSql({ before: observed(), deadline: '2026-09-28T11:02:00.000Z', rehearsal: true });
  assert.equal(sql.match(/REVOKE EXECUTE ON FUNCTION /g).length, 2);
  assert.equal(sql.match(/FROM PUBLIC, anon, authenticated;/g).length, 2);
  assert.equal(/\b(?:GRANT|CREATE FUNCTION|ALTER FUNCTION|INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE)\b/.test(sql), false);
  assert.equal(sql.includes('ALTER DEFAULT PRIVILEGES'), false);
  for (const required of ["lock_timeout='5s'", "statement_timeout='30s'", 'pg_advisory_xact_lock', 'pg_control_system()',
    'FITTING_ACL_TARGET_DRIFT', 'FITTING_ACL_BASELINE_DRIFT', 'FITTING_ACL_AFTER_DRIFT', 'FITTING_ACL_DEADLINE_EXPIRED', 'ROLLBACK;'])
    assert.ok(sql.includes(required), required);
  assert.throws(() => buildLegacyFittingAclMutationSql({ before: observed('after'), deadline: '2026-09-28T11:02:00.000Z', rehearsal: false }));
  assert.throws(() => buildLegacyFittingAclMutationSql({ before: observed(), deadline: "'; COMMIT;", rehearsal: false }));
  assert.throws(() => validateLegacyFittingAclObservation(observed('after'), { now: instant, phase: 'before' }));
});

test('receipt completes short writes then fsync and refuses zero, invalid or oversized writes', () => {
  const value = { status: 'intent', text: '합성' }, written = [];
  let flushes = 0;
  appendLegacyFittingAclReceipt(42, value, { write: (fd, bytes, offset, length) => {
    assert.equal(fd, 42); const n = Math.min(3, length); written.push(bytes.subarray(offset, offset + n)); return n;
  }, flush: () => { flushes++; } });
  assert.equal(Buffer.concat(written).toString(), `${JSON.stringify(value)}\n`); assert.equal(flushes, 1);
  for (const written of [0, -1, undefined, Infinity, 99999]) {
    flushes = 0;
    assert.throws(() => appendLegacyFittingAclReceipt(42, value, { write: () => written, flush: () => { flushes++; } }),
      code('FITTING_ACL_RECEIPT_WRITE_INCOMPLETE'));
    assert.equal(flushes, 0);
  }
});

test('real receipt is create-new, outside-source and rejects symlink parent', () => {
  const temp = mkdtempSync(join(tmpdir(), 'fitting-acl-receipt-'));
  try {
    const file = join(temp, 'receipt.jsonl');
    const receipt = openLegacyFittingAclReceipt(file); receipt.append({ status: 'synthetic' }); receipt.close();
    assert.equal(readFileSync(file, 'utf8'), '{"status":"synthetic"}\n');
    assert.throws(() => openLegacyFittingAclReceipt(file));
    const link = join(temp, 'linked'); symlinkSync(temp, link, 'junction');
    assert.throws(() => openLegacyFittingAclReceipt(join(link, 'other.jsonl')), code('FITTING_ACL_RECEIPT_PATH_INVALID'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
