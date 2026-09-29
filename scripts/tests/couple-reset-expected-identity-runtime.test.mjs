import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { appendCoupleResetExpectedIdentityReceipt, parseCoupleResetExpectedIdentityReleaseArgs,
  runCoupleResetExpectedIdentityRelease } from '../lib/couple-reset-expected-identity-release.mjs';
import { buildCoupleResetExpectedIdentityObservationSql, expectedCoupleResetExpectedIdentityCatalog,
  validateCoupleResetExpectedIdentityObservation } from '../lib/couple-reset-expected-identity-catalog.mjs';
import { COUPLE_RESET_EXPECTED_IDENTITY_CONTRACT_FILE,
  loadCoupleResetExpectedIdentityReleasePlan } from '../lib/couple-reset-expected-identity-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';
import { createDeletionAuditHistoricalRepository } from './fixtures/account-deletion-audit-historical-repository.mjs';

const root = resolve(import.meta.dirname, '../..');
const plan = loadCoupleResetExpectedIdentityReleasePlan(root);
const sql = readFileSync(join(root, 'supabase/migrations', plan.contract.migrations[0].file), 'utf8');
const predecessorSql = readFileSync(join(root, plan.contract.predecessorMigration.file), 'utf8');
const catalogFixture = JSON.parse(readFileSync(join(root, plan.contract.catalogFixture.file), 'utf8'));
const expectedVersions = plan.expectedLedgerVersions;
const instant = new Date('2026-09-29T05:00:00Z');
const commit = 'a'.repeat(40), project = 'slrtobkksjmxgzatjyqb', version = '20260928144843';
const md5 = value => createHash('md5').update(value).digest('hex');
const code = expected => error => error?.code === expected;
const args = (mode = 'apply') => ['--couple-reset-expected-identity', `--${mode}`, `--expected-commit=${commit}`,
  `--project-ref=${project}`, `--receipt-out=${join(tmpdir(), 'unused-couple-reset-synthetic-receipt.jsonl')}`,
  `--confirm-production=couple-reset-expected-identity-20260928:${project}:${mode}:${commit}`];
const before = () => ({ format: 'couple-reset-expected-identity-catalog-v1', systemIdentifier: '7581440907192989109',
  serverVersion: '17.10', database: 'postgres', currentUser: 'postgres', readOnly: true, inRecovery: false,
  observedAt: instant.toISOString(), dependenciesReady: true,
  catalog: expectedCoupleResetExpectedIdentityCatalog(catalogFixture, false), preservedCatalogSha: 'a'.repeat(32),
  rowDigests: { profiles: { count: 3, md5: 'b'.repeat(32) }, couples: { count: 2, md5: 'c'.repeat(32) } },
  ledgerSha: 'd'.repeat(32), ledgerWithoutTargetSha: 'd'.repeat(32), ledgerCount: 229,
  ledgerVersions: [...expectedVersions], migration: null,
  predecessor: { version: '20260928073546', name: 'account_deletion_anonymous_audit', statementCount: 1, sqlMd5: md5(predecessorSql) } });
const after = () => ({ ...before(), catalog: expectedCoupleResetExpectedIdentityCatalog(catalogFixture, true),
  ledgerSha: 'e'.repeat(32), ledgerCount: 230, ledgerVersions: [...expectedVersions, version],
  migration: { version, name: 'couple_reset_expected_identity', statementCount: 1, sqlMd5: md5(sql) } });
const context = { sql, fixture: catalogFixture, predecessorSql, expectedVersions, now: instant };

function fixture({ mode = 'apply', observations = [before(), before(), after()], onQuery, onRecord, onSource,
  now, repoRoot = root } = {}) {
  const calls = [], events = [];
  let reads = 0, closed = false, sourceChecks = 0;
  return { calls, events, get closed() { return closed; }, get sourceChecks() { return sourceChecks; },
    run: () => runCoupleResetExpectedIdentityRelease({ repoRoot, argv: args(mode), now: now ?? (() => instant),
      assertSource: () => { sourceChecks += 1; onSource?.(sourceChecks); },
      receiptFactory: () => ({ append: event => { onRecord?.(event); events.push(event); }, close: () => { closed = true; } }),
      query: async (text, options) => {
        calls.push({ text, ...options }); await onQuery?.(text, calls.length, options);
        if (options.readOnly) {
          assert.equal(text, buildCoupleResetExpectedIdentityObservationSql());
          return [{ observation: structuredClone(observations[reads++]) }];
        }
        return [];
      } }),
  };
}

test('injected local apply durably rehearses, verifies rollback, rechecks source, commits once and postverifies', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 'local-applied-and-postverified');
  assert.equal(result.localMutationCommitted, true);
  assert.deepEqual(f.calls.map(call => call.readOnly), [true, false, true, false, true]);
  assert.equal(f.calls[1].text.replace(/ROLLBACK;$/, 'COMMIT;'), f.calls[3].text);
  assert.ok(f.calls[3].text.includes(sql));
  assert.ok(f.calls[3].text.includes(`ARRAY['${sql.replaceAll("'", "''")}']::text[]`));
  assert.match(f.calls[3].text, /LOCK TABLE public\.profiles IN EXCLUSIVE MODE;\s+LOCK TABLE public\.couples IN SHARE MODE;/);
  assert.equal(f.sourceChecks, 3);
  assert.equal(f.closed, true);
  assert.deepEqual(f.events.map(event => event.status), ['started', 'before-observed', 'rehearsal-outcome-unverified',
    'rehearsed-and-rolled-back', 'apply-outcome-unverified', 'local-applied-and-postverified']);
  for (const value of [result, ...f.events]) {
    assert.equal(value.executionContext, 'injected-local-validation');
    assert.equal(value.fullOriginalRestore, 'not-proven');
    for (const key of ['productionExecutionEnabled', 'runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed'])
      assert.equal(value[key], false, key);
  }
  for (const event of f.events) {
    assert.equal(event.releaseCommit, commit);
    assert.equal(event.contractSha256, plan.contractSha256);
    assert.equal(event.runtimeSha256, plan.contract.runtime.sha256);
    assert.equal(event.catalogFixtureSha256, plan.contract.catalogFixture.sha256);
  }
});

test('inspect, rehearsal and exact already-applied observation never dispatch a committed mutation', async () => {
  for (const [options, status, count] of [[{ mode: 'inspect' }, 'inspected-unapplied', 1],
    [{ mode: 'rehearse' }, 'rehearsed-and-rolled-back', 3], [{ observations: [after()] }, 'already-applied-verified', 1]]) {
    const f = fixture(options), result = await f.run();
    assert.equal(result.status, status);
    assert.equal(result.localMutationCommitted, false);
    assert.equal(f.calls.length, count);
    assert.equal(f.calls.some(call => !call.readOnly && call.text.endsWith('COMMIT;')), false);
    assert.equal(f.closed, true);
  }
});

test('default production mutation and the actual controller reject before source, receipt, command or fetch', async t => {
  let effects = 0;
  t.mock.method(globalThis, 'fetch', () => { effects++; throw new Error('network forbidden'); });
  for (const mode of ['rehearse', 'apply']) {
    await assert.rejects(runCoupleResetExpectedIdentityRelease({ repoRoot: join(tmpdir(), 'nonexistent-couple-reset-repo'),
      argv: args(mode), assertSource: () => { effects++; }, receiptFactory: () => { effects++; } }),
    code('COUPLE_RESET_GLOBAL_RELEASE_GATES_REQUIRED'));
    await assert.rejects(runProductionRelease({ repoRoot: join(tmpdir(), 'nonexistent-couple-reset-repo'), argv: args(mode),
      runCommand: () => { effects++; throw new Error('command forbidden'); } }), code('COUPLE_RESET_GLOBAL_RELEASE_GATES_REQUIRED'));
  }
  assert.equal(effects, 0);
});

test('parser and top-level controller reject duplicate, mixed, unknown and mismatched production arguments', async t => {
  let effects = 0;
  t.mock.method(globalThis, 'fetch', () => { effects++; throw new Error('network forbidden'); });
  const invalid = [args().slice(0, -1), [...args(), '--rehearse'], [...args(), '--apply'], [...args(), '--unknown'],
    [...args(), '--couple-reset-expected-identity'], [...args(), '--account-deletion-audit-nullability'],
    [...args(), '--current-baseline'], [...args(), '--legacy-fitting-acl'], [...args(), '--expected-commit=' + commit],
    args().map(arg => arg.startsWith('--project-ref=') ? '--project-ref=abcdefghijklmnopqrst' : arg),
    args().map(arg => arg.startsWith('--expected-commit=') ? '--expected-commit=bad' : arg),
    args().map(arg => arg.startsWith('--receipt-out=') ? '--receipt-out=relative.jsonl' : arg),
    args().map(arg => arg.startsWith('--confirm-production=') ? `${arg}x` : arg)];
  assert.throws(() => parseCoupleResetExpectedIdentityReleaseArgs([]));
  for (const argv of invalid) {
    assert.throws(() => parseCoupleResetExpectedIdentityReleaseArgs(argv));
    await assert.rejects(runProductionRelease({ repoRoot: join(tmpdir(), 'nonexistent-couple-reset-repo'), argv,
      runCommand: () => { effects++; throw new Error('command forbidden'); } }),
    error => /^COUPLE_RESET_(ARGUMENT_|CONFIRMATION_REQUIRED)/.test(error.code));
  }
  assert.equal(effects, 0);
});

test('repository-contained receipts are rejected before source, receipt or query effects', async () => {
  for (const file of [root, join(root, 'private-receipt.jsonl'), join(root, 'scripts', '..', 'receipt.jsonl')]) {
    let effects = 0;
    await assert.rejects(runCoupleResetExpectedIdentityRelease({ repoRoot: root,
      argv: args().map(arg => arg.startsWith('--receipt-out=') ? `--receipt-out=${file}` : arg),
      assertSource: () => { effects++; }, receiptFactory: () => { effects++; }, query: async () => { effects++; return []; },
    }), code('COUPLE_RESET_RECEIPT_PATH_INVALID'));
    assert.equal(effects, 0);
  }
});

test('wrong identity, stale evidence, dependencies, inherited ACL and conflicting normalized ledger fail before mutation', async () => {
  const aclDrift = before(); aclDrift.catalog.legacyFunctions[0].acl.push(['anon', 'postgres', 'EXECUTE', false]);
  const invalid = [{ ...before(), systemIdentifier: '1' }, { ...before(), readOnly: false }, { ...before(), inRecovery: true },
    { ...before(), database: 'other' }, { ...before(), currentUser: 'other' }, { ...before(), serverVersion: '18.0' },
    { ...before(), dependenciesReady: false }, { ...before(), observedAt: '2026-09-29T04:57:59Z' },
    { ...before(), observedAt: '2026-09-29T05:00:11Z' }, { ...before(), rowDigests: { profiles: { count: -1, md5: 'b'.repeat(32) } } },
    { ...before(), predecessor: { ...before().predecessor, sqlMd5: 'f'.repeat(32) } },
    { ...before(), ledgerCount: 240 }, { ...before(), ledgerVersions: expectedVersions.slice(1) },
    { ...before(), ledgerSha: 'e'.repeat(32) }, aclDrift,
    { ...after(), migration: { ...after().migration, sqlMd5: 'f'.repeat(32) } },
    { ...after(), migration: { ...after().migration, statementCount: 2 } }];
  for (const observed of invalid) assert.throws(() => validateCoupleResetExpectedIdentityObservation(observed, context));
  for (const observed of [invalid[0], invalid[10], invalid[11], aclDrift, invalid.at(-1)]) {
    const f = fixture({ observations: [observed] });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 1);
    assert.equal(f.events.at(-1).status, 'blocked-before-mutation');
    assert.equal(f.closed, true);
  }
});

test('rehearsal transport failure or changed rows, catalog and ledger cannot advance to commit', async () => {
  const changedRows = before(); changedRows.rowDigests.profiles.md5 = 'f'.repeat(32);
  for (const options of [
    { onQuery: (_text, call) => { if (call === 2) throw new Error('synthetic connection lost'); } },
    { observations: [before(), changedRows] },
    { observations: [before(), { ...before(), preservedCatalogSha: 'f'.repeat(32) }] },
    { observations: [before(), { ...before(), ledgerSha: 'f'.repeat(32), ledgerWithoutTargetSha: 'f'.repeat(32) }] },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.run(), code('COUPLE_RESET_OUTCOME_REQUIRES_INSPECTION'));
    assert.ok(f.calls.length <= 3);
    assert.equal(f.events.some(event => event.status === 'apply-outcome-unverified'), false);
    assert.equal(f.events.at(-1).retryProhibited, true);
    assert.equal(f.closed, true);
  }
});

test('deadline, durable intent and repeated source failures prevent the next mutation dispatch', async () => {
  for (const status of ['rehearsal-outcome-unverified', 'rehearsed-and-rolled-back', 'apply-outcome-unverified']) {
    let time = instant;
    const f = fixture({ now: () => time, onRecord: event => {
      if (event.status === status) time = new Date(instant.getTime() + 120_001);
    } });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, status === 'rehearsal-outcome-unverified' ? 1 : 3);
  }
  for (const status of ['rehearsal-outcome-unverified', 'apply-outcome-unverified']) {
    const f = fixture({ onRecord: event => { if (event.status === status) throw new Error('synthetic disk full'); } });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, status === 'rehearsal-outcome-unverified' ? 1 : 3);
    assert.equal(f.closed, true);
  }
  for (const check of [1, 2, 3]) {
    const f = fixture({ onSource: count => { if (count === check) throw new Error('synthetic source changed'); } });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, check === 1 ? 0 : check === 2 ? 1 : 3);
  }
});

test('runtime reopens pinned source after observation and again after rollback', async t => {
  const copied = createDeletionAuditHistoricalRepository(root); t.after(copied.cleanup);
  const contract = plan.contract;
  for (const file of [COUPLE_RESET_EXPECTED_IDENTITY_CONTRACT_FILE, contract.predecessorLoader.file,
    contract.runtime.file, contract.catalog.file, contract.catalogFixture.file, contract.predecessorMigration.file,
    contract.ledgerBaseline.file, ...contract.verificationTests.map(pin => pin.file),
    ...contract.migrations.map(pin => `supabase/migrations/${pin.file}`)]) {
    mkdirSync(dirname(join(copied.root, file)), { recursive: true });
    copyFileSync(join(root, file), join(copied.root, file));
  }
  const target = join(copied.root, contract.catalog.file), original = readFileSync(target);
  for (const check of [2, 3]) {
    const f = fixture({ repoRoot: copied.root, onSource: count => {
      if (count === check) writeFileSync(target, Buffer.concat([original, Buffer.from('\n')]));
    } });
    try {
      await assert.rejects(f.run(), code(check === 2 ? 'ARTIFACT_HASH_MISMATCH' : 'COUPLE_RESET_OUTCOME_REQUIRES_INSPECTION'));
      assert.equal(f.calls.length, check === 2 ? 1 : 3);
      assert.equal(f.closed, true);
    } finally { writeFileSync(target, original); }
  }
});

test('ambiguous commit or postcheck drift never retries, undoes or records an applied success', async () => {
  const changedRows = after(); changedRows.rowDigests.couples.md5 = 'f'.repeat(32);
  for (const options of [
    { onQuery: (_text, call) => { if (call === 4) throw new Error('response lost after synthetic commit'); } },
    { observations: [before(), before(), before()] },
    { observations: [before(), before(), { ...after(), ledgerWithoutTargetSha: 'f'.repeat(32) }] },
    { observations: [before(), before(), { ...after(), preservedCatalogSha: 'f'.repeat(32) }] },
    { observations: [before(), before(), changedRows] },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.run(), code('COUPLE_RESET_OUTCOME_REQUIRES_INSPECTION'));
    assert.ok(f.calls.length === 4 || f.calls.length === 5);
    assert.equal(f.calls.filter(call => !call.readOnly && call.text.endsWith('COMMIT;')).length, 1);
    assert.equal(f.events.at(-1).retryProhibited, true);
    assert.equal(f.events.some(event => event.status === 'local-applied-and-postverified'), false);
    assert.equal(f.closed, true);
  }
});

test('durable receipts complete short UTF-8 writes before fsync and reject invalid progress or flush failures', () => {
  const value = { status: 'apply-outcome-unverified', detail: '합성 기록' }, chunks = [];
  let flushed = 0;
  appendCoupleResetExpectedIdentityReceipt(42, value, { write: (fd, bytes, offset, length, position) => {
    assert.equal(fd, 42); assert.equal(position, null); assert.equal(length, bytes.length - offset);
    const count = Math.min(3, length); chunks.push(bytes.subarray(offset, offset + count)); return count;
  }, flush: fd => { assert.equal(fd, 42); flushed++; } });
  assert.equal(Buffer.concat(chunks).toString(), `${JSON.stringify(value)}\n`);
  assert.equal(flushed, 1);
  for (const invalid of [0, -1, undefined, Infinity, 0.5, 999_999]) {
    flushed = 0;
    assert.throws(() => appendCoupleResetExpectedIdentityReceipt(42, value, { write: () => invalid, flush: () => { flushed++; } }),
      code('COUPLE_RESET_RECEIPT_WRITE_INCOMPLETE'));
    assert.equal(flushed, 0);
  }
  assert.throws(() => appendCoupleResetExpectedIdentityReceipt(42, value,
    { write: (_fd, _bytes, _offset, length) => length, flush: () => { throw new Error('synthetic fsync failure'); } }), /synthetic fsync failure/);
});
