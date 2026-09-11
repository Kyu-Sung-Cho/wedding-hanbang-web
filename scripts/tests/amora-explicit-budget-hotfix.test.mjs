import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { digest, digestJson } from '../lib/current-baseline-release-contract.mjs';
import { transactionBody } from '../lib/current-baseline-hosted-synthetic.mjs';
import { localPredecessor } from './fixtures/current-baseline-hosted-synthetic-local.mjs';
import { budgetRealtimeBindings, renderBudgetRealtimeObservationSql } from '../lib/amora-budget-decision-effective-release-contract.mjs';
import { createSyntheticBudgetRealtimeTopology, moveSyntheticRealtimeChild } from './fixtures/budget-realtime-topology.mjs';
import * as controller from '../lib/amora-runtime-hotfix-controller.mjs';

// 모든 증거·계정·DDL 실행은 합성 테스트 자료다. 운영 백업/hosted/rehearsal 증거로 사용할 수 없다.
const root = resolve(import.meta.dirname, '../..');
const mode = '--amora-explicit-budget-hotfix';
const commit = 'a'.repeat(40), hash = 'b'.repeat(64);
const owner = '60910000-1234-4123-8123-123456789abc';
const now = new Date('2026-09-11T09:00:00Z');
const fixtureRoot = join(tmpdir(), 'amora-explicit-budget-synthetic-cli');
const hostedChecks = ['actorBoundary', 'explicitAllocationsExactReceipt', 'budgetPreservesOmittedAllocations',
  'retryDecisionIdempotency', 'noChangeNoDecision', 'scheduleReceiptCompatibility', 'privateHelperAcl', 'rollback'];
const expectedSchema = ['function:public.apply_amora_atomic_tool_execution_pre_shared_revision(p_couple_id uuid, p_request_key text, p_operation_key text, p_request_attempt_count integer, p_input_digest text, p_tool_input jsonb, p_domain_mutation jsonb, p_result jsonb)'];
const dataOptions = { preserveHotRank: true, budgetDecisionReceipt: false };
async function removeFixtureDirectory(folder) {
  const target = resolve(folder);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^budget-explicit-(?:controller|recovery)-test-/);
  await rm(target, { recursive: true, force: true });
}
const load = async () => {
  const contract = await import('../lib/amora-explicit-budget-release-contract.mjs');
  return { contract, release: contract.loadExplicitBudgetHotfixRelease(root) };
};
function argvFor(release, folder, apply = false) {
  return [mode, apply ? '--apply' : '--check-only', `--expected-commit=${commit}`, '--remote-ref=origin/codex/test',
    `--evidence-root=${folder}`, `--receipt-out=${join(folder, 'out.json')}`, `--bundle-out=${join(folder, 'bundle.sql')}`,
    `--confirm-production=${apply ? 'APPLY' : 'CHECK'}:${release.hotfix.projectRef}:${release.hotfix.release}:${commit}`];
}
function evidenceFixture(release) {
  const before = structuredClone(release.baseline);
  const tables = before.relations.filter(t => t.schema === 'public' && ['r', 'p'].includes(t.kind));
  const evidence = { ...budgetRealtimeBindings(release), format: 'amora-runtime-hotfix-evidence-v1', releaseCommit: commit, projectRef: release.hotfix.projectRef,
    systemIdentifier: release.hotfix.systemIdentifier, hotfixContractSha256: release.hotfixSha256, migrationSetSha256: release.migrationSetSha256,
    expiresAt: '2026-09-11T09:20:00Z', scope: release.hotfix.scope, before,
    beforeData: tables.map(t => ({ relation: `${t.schema}.${t.name}`, rows: 0, rowsSha256: digest('') })),
    transitions: expectedSchema.map(key => { const colon = key.indexOf(':'); const kind = key.slice(0, colon), identity = key.slice(colon + 1);
      return { kind, identity, beforeSha256: before.objects.find(o => o.kind === kind && o.identity === identity)?.sha256 ?? null, afterSha256: hash }; }) };
  const raw = { rollbackOriginal: 'SYNTHETIC ORIGINAL DDL; NOT A PRODUCTION RECEIPT' }, reports = {};
  evidence.rollbackOriginal = { file: 'original-ddl.json', sha256: digest(raw.rollbackOriginal) };
  const wrap = (kind, value) => {
    raw[kind] = JSON.stringify(value);
    reports[kind] = { format: `amora-hotfix-${kind}-v1`, projectRef: release.hotfix.projectRef, releaseCommit: commit,
      migrationSetSha256: release.migrationSetSha256, verifiedAt: now.toISOString(), rawEvidenceSha256: digest(raw[kind]),
      rawEvidence: { file: `${kind}.raw.json`, sha256: digest(raw[kind]) }, targetProjectRef: 'abcdefghijklmnopqrst', targetSystemIdentifier: '8000000000000000001' };
  };
  const target = { targetProjectRef: 'abcdefghijklmnopqrst', targetSystemIdentifier: '8000000000000000001', databaseEngine: 'PostgreSQL',
    serverVersion: '17.5', migrationSetSha256: release.migrationSetSha256, releaseCommit: commit };
  wrap('backup', { kind: 'independent-postgres-logical-snapshot', status: 'logical-snapshot-verified-not-restored', projectRef: release.hotfix.projectRef,
    releaseCommit: commit, capturedAt: now.toISOString(), actualSourceCapture: true, sourceReadOnly: true,
    sourceIdentity: { systemIdentifier: release.hotfix.systemIdentifier, readOnly: 'on', clientTlsMode: 'verify-full',
      clientTlsCaSha256: hash.toUpperCase(), clientTlsVerifiedBySuccessfulConnection: true, poolerBackendTls: false, serverVersion: 170006 },
    backupSetId: owner, storageBytesCaptured: false, rolesOrPasswordsDumped: false, restoreRehearsalCompleted: false, currentBaselineReleaseEvidence: false,
    encryption: { backup_set_id: owner, plaintext_sha256: hash, encrypted_sha256: hash, key_sha256: hash, plaintext_bytes: 50,
      artifact: 'logical-data.json.hbam2', key: 'logical-data.json.key.dpapi' }, archiveBytes: 5, archiveSha256: hash.toUpperCase(),
    inspection: { archiveDecodePassed: true, tocSha256: hash.toUpperCase(), tocEntries: 1 } });
  const proof = JSON.parse(readFileSync(join(root, release.baselineSupplement.proof.file), 'utf8'));
  raw.realtimeTopology = JSON.stringify([{ observation: { format: 'amora-budget-realtime-observation-v1', readOnly: true,
    systemIdentifier: release.hotfix.systemIdentifier, releaseCommit: commit, ...budgetRealtimeBindings(release),
    observedAt: now.toISOString(), oldPartitionAbsent: true, topology: JSON.parse(proof.structure.rawText)[0].observation.topology } }]);
  evidence.realtimeTopology = { querySha256: digest(renderBudgetRealtimeObservationSql(release, commit)),
    rawEvidence: { file: 'realtime-topology.raw.json', sha256: digest(raw.realtimeTopology) } };
  reports.backup.snapshotDirectory = 'snapshot';
  wrap('rollback', { ...target, kind: 'synthetic-explicit-budget-sql-transaction-rollback', sourceArchiveRestored: false,
    originalDdlArtifactSha256: evidence.rollbackOriginal.sha256, beforeSchemaSha256: hash, afterRollbackSchemaSha256: hash,
    beforeDataSha256: hash, afterRollbackDataSha256: hash, transactionRollbackExecuted: true, operatorFenceHeld: true });
  wrap('hosted', { ...target, executedMigrations: release.migrations.map(m => ({ file: m.file, sha256: m.sha256,
    bodySha256: digest(transactionBody(m.sql.toString('utf8'))) })), transitions: evidence.transitions,
    checks: hostedChecks.map(name => ({ name, status: 'passed', observed: { synthetic: name }, rawEvidenceSha256: digestJson({ synthetic: name }) })) });
  wrap('concurrency', { ...target, cases: [
    ...['actorRosterChange', 'budgetConcurrentChange', 'wrongOwnerLease'].map(name => ({ name, connections: ['connection-1', 'connection-2'],
      contenderSqlstate: name === 'wrongOwnerLease' ? 'P0001' : name === 'actorRosterChange' ? '42501' : null,
      ...(name === 'budgetConcurrentChange' ? { contenderSuccess: false, contenderErrorCode: 'domain_state_changed' } : {}),
      unintendedWrites: 0, transcriptSha256: hash })),
    { name: 'sameApprovalRetry', connections: ['connection-1', 'connection-2'], successfulMutationCount: 1,
      decisionCount: 1, budgetRevisionDelta: 1, unintendedWrites: 0, transcriptSha256: hash },
  ] });
  wrap('fence', { host: 'hanbang.ai', deploymentCommit: commit, verifiedAt: now.toISOString(), webWriteStatus: 503,
    webWriteCode: 'production_write_fence_enabled', publicFenceSourceSha256: release.contract.implementation.writeFenceCheck.sha256,
    publicFenceVerified: true, existingRequestsDrained: true, newTableFenceVerified: true, activePublicWriters: 0, activeCronJobs: 0 });
  wrap('dryRun', { cliVersion: release.contract.cli.version, cliBinarySha256: release.contract.cli.binarySha256,
    cliCompanionSha256: release.contract.cli.companionSha256, exitCode: 0, remoteWritesPerformed: false,
    stdout: `DRY RUN\n${release.migrations.map(m => m.file).join('\n')}` });
  return { evidence, reports, raw, release, expectedCommit: commit, now };
}
function changeRaw(fixture, kind, update) {
  const value = JSON.parse(fixture.raw[kind]); update(value);
  fixture.raw[kind] = JSON.stringify(value);
  fixture.reports[kind].rawEvidenceSha256 = digest(fixture.raw[kind]);
  fixture.reports[kind].rawEvidence.sha256 = digest(fixture.raw[kind]);
}
async function persistEvidence(folder, f) {
  f.evidence.reports = {};
  for (const kind of f.release.hotfix.requiredEvidence) {
    const report = JSON.stringify(f.reports[kind]);
    f.evidence.reports[kind] = { file: `${kind}.json`, sha256: digest(report) };
    await writeFile(join(folder, `${kind}.json`), report); await writeFile(join(folder, `${kind}.raw.json`), f.raw[kind]);
  }
  await writeFile(join(folder, 'realtime-topology.raw.json'), f.raw.realtimeTopology);
  await writeFile(join(folder, 'original-ddl.json'), f.raw.rollbackOriginal);
  await writeFile(join(folder, 'amora-hotfix-evidence.json'), JSON.stringify(f.evidence));
}

test('explicit budget mode is recognized without opening a release or loading credentials', () => {
  assert.equal(controller.selectHotfixMode([mode]),mode);
  const args=[mode,'--check-only',`--expected-commit=${commit}`,'--remote-ref=origin/codex/test',`--evidence-root=${fixtureRoot}`,`--receipt-out=${join(fixtureRoot,'out.json')}`,`--bundle-out=${join(fixtureRoot,'bundle.sql')}`];
  assert.equal(controller.parseHotfixModeArgs(args)['amora-explicit-budget-hotfix'],true);
  for (const previous of ['--amora-runtime-hotfix','--amora-named-budget-hotfix','--amora-budget-decision-hotfix']) assert.throws(()=>controller.selectHotfixMode([mode,previous]));
});

test('explicit allocation mode selects exactly one new SQL over ledger216', async () => {
  assert.equal(typeof controller.parseExplicitBudgetHotfixArgs, 'function');
  assert.equal(typeof controller.selectHotfixMode, 'function');
  assert.equal(typeof controller.loadHotfixReleaseForMode, 'function');
  const { release, contract } = await load();
  assert.equal(contract.EXPLICIT_BUDGET_KIND, 'amora-explicit-budget-single-sql-hotfix');
  assert.deepEqual([...contract.EXPLICIT_BUDGET_SCHEMA_CHANGES].sort(), [...expectedSchema].sort());
  assert.equal(release.baseline.ledger.length, 216); assert.equal(release.hotfix.requiredLedgerCount, 216);
  assert.equal(release.hotfix.requiredRemoteHead, '20260910160514');
  assert.equal(release.migrations.length, 1);
  assert.equal(release.migrations[0].file, '20260911080244_amora_budget_plan_explicit_allocations.sql');
  const args = argvFor(release, fixtureRoot);
  assert.equal(controller.selectHotfixMode(args), mode);
  assert.equal(controller.parseExplicitBudgetHotfixArgs(args)['amora-explicit-budget-hotfix'], true);
  assert.equal(controller.loadHotfixReleaseForMode(root, mode).hotfixSha256, release.hotfixSha256);
  for (const extra of ['--amora-runtime-hotfix', '--amora-named-budget-hotfix', '--amora-budget-decision-hotfix', mode, '--apply', '--skip-evidence', '--amora-explicit-budget-hotfix=true'])
    assert.throws(() => controller.parseExplicitBudgetHotfixArgs([...args, extra]));
  for (const flags of [[], ['--unknown-hotfix'], [mode, '--amora-runtime-hotfix'], [mode, '--amora-named-budget-hotfix'], [mode, mode]])
    assert.throws(() => controller.selectHotfixMode(flags));
  assert.throws(() => controller.loadHotfixReleaseForMode(root, '--unknown-hotfix'));
  assert.throws(() => controller.parseHotfixArgs(args));
  assert.throws(() => controller.parseNamedBudgetHotfixArgs(args));
  assert.throws(() => controller.parseBudgetDecisionHotfixArgs(args));
  const finalize = args.filter(a => a !== '--check-only' && !a.startsWith('--bundle-out') && !a.startsWith('--confirm-production'));
  assert.equal(controller.parseExplicitBudgetHotfixArgs([...finalize, '--finalize', `--outcome=${join(fixtureRoot, 'apply.json')}`,
    `--canary=${join(fixtureRoot, 'canary.json')}`, '--confirm-production=placeholder']).finalize, true);
});

test('production entrypoint recognizes the explicit mode then stops at missing credentials before any command', async () => {
  const { release } = await load();
  const moduleUrl = new URL('../lib/supabase-production-release-controller.mjs', import.meta.url).href;
  const script = `const {runProductionRelease}=await import(${JSON.stringify(moduleUrl)});
    try { await runProductionRelease({repoRoot:${JSON.stringify(root)},argv:${JSON.stringify(argvFor(release, fixtureRoot))},
      runCommand:async()=>{throw new Error('COMMAND_MUST_NOT_RUN')}}); process.exitCode=1; }
    catch(error) { process.stdout.write(error.code??'UNEXPECTED'); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
    encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'EXISTING_CLI_CREDENTIAL_UNAVAILABLE');
});

test('explicit evidence retains fresh topology, CLI expiry and 30-minute receipt deadlines', async () => {
  const { release } = await load();
  for (const stamp of ['2026-09-11T08:30:00Z', '2026-09-11T09:00:11Z']) {
    const f = evidenceFixture(release), raw = JSON.parse(f.raw.realtimeTopology);
    raw[0].observation.observedAt = stamp; f.raw.realtimeTopology = JSON.stringify(raw);
    f.evidence.realtimeTopology.rawEvidence.sha256 = digest(f.raw.realtimeTopology);
    assert.throws(() => controller.validateHotfixEvidence(f), { code: 'REALTIME_FRESH_PROOF_EXPIRED' });
  }
  for (const stamp of ['2026-09-11T08:29:59Z', '2026-09-11T09:00:01Z']) {
    const f = evidenceFixture(release); f.reports.backup.verifiedAt = stamp;
    assert.throws(() => controller.validateHotfixEvidence(f), { code: 'EVIDENCE_EXPIRED' });
  }
  const f = evidenceFixture(release); f.evidence.before.cliRoleExpirations = [];
  assert.throws(() => controller.validateHotfixEvidence(f));
});

test('synthetic complete evidence passes and every required receipt is necessary', async () => {
  const { release } = await load();
  assert.equal(controller.validateHotfixEvidence(evidenceFixture(release)).evidenceSha256.length, 64);
  for (const kind of ['backup', 'rollback', 'hosted', 'concurrency', 'fence', 'dryRun']) {
    const missing = evidenceFixture(release); delete missing.reports[kind];
    assert.throws(() => controller.validateHotfixEvidence(missing), `missing ${kind}`);
    const bytes = evidenceFixture(release); bytes.raw[kind] += ' ';
    assert.throws(() => controller.validateHotfixEvidence(bytes), `changed ${kind} bytes`);
    const wrongCommit = evidenceFixture(release); wrongCommit.reports[kind].releaseCommit = 'c'.repeat(40);
    assert.throws(() => controller.validateHotfixEvidence(wrongCommit), `wrong ${kind} commit`);
  }
  for (const change of [
    e => { e.before.ledger.pop(); }, e => { e.before.ledger[0].statementsSha256 = hash; },
    e => { e.projectRef = 'abcdefghijklmnopqrst'; }, e => { e.systemIdentifier = '8000000000000000001'; },
    e => { e.expiresAt = '2026-09-11T00:59:00Z'; }, e => { e.scope = { ...e.scope, auth: 'changed' }; },
  ]) { const f = evidenceFixture(release); change(f.evidence); assert.throws(() => controller.validateHotfixEvidence(f)); }
});

test('checked backup, rollback, hosted8, concurrency4, fence and exact pending1 cannot be substituted', async () => {
  const { release } = await load();
  for (const [kind, change] of [
    ['backup', v => { v.actualSourceCapture = false; }], ['backup', v => { v.inspection.archiveDecodePassed = false; }],
    ['backup', v => { v.sourceIdentity.clientTlsMode = 'require'; }],
    ['rollback', v => { v.transactionRollbackExecuted = false; }], ['rollback', v => { v.afterRollbackDataSha256 = 'c'.repeat(64); }],
    ['rollback', v => { v.kind = 'synthetic-named-budget-sql-transaction-rollback'; }],
    ['hosted', v => { v.databaseEngine = 'PGlite'; }], ['hosted', v => { v.checks.pop(); }],
    ['hosted', v => { v.checks[1].status = 'failed'; }], ['hosted', v => { v.executedMigrations[0].bodySha256 = hash; }],
    ['concurrency', v => { v.cases.pop(); }], ['concurrency', v => { v.cases[3].decisionCount = 2; }],
    ['concurrency', v => { v.cases[3].budgetRevisionDelta = 2; }], ['concurrency', v => { v.cases[3].successfulMutationCount = 2; }],
    ['concurrency', v => { v.cases[3].connections = ['same', 'same']; }], ['concurrency', v => { v.cases[0].unintendedWrites = 1; }],
    ['fence', v => { v.activePublicWriters = 1; }], ['fence', v => { v.activeCronJobs = 1; }],
    ['fence', v => { v.existingRequestsDrained = false; }], ['dryRun', v => { v.remoteWritesPerformed = true; }],
    ['dryRun', v => { v.stdout = 'DRY RUN\n20260907085111_amora_budget_plan_named_allocations.sql'; }],
    ['dryRun', v => { v.stdout += `\n${release.migrations[0].file}`; }],
  ]) { const f = evidenceFixture(release); changeRaw(f, kind, change); assert.throws(() => controller.validateHotfixEvidence(f), `${kind}: ${change}`); }
});

test('the exact private dispatcher transition is required and extra objects are rejected', async () => {
  const { release } = await load();
  for (const identity of expectedSchema) {
    const f = evidenceFixture(release); f.evidence.transitions = f.evidence.transitions.filter(row => `${row.kind}:${row.identity}` !== identity);
    changeRaw(f, 'hosted', v => { v.transitions = f.evidence.transitions; });
    assert.throws(() => controller.validateHotfixEvidence(f), { code: 'SCHEMA_TRANSITIONS_MISSING' });
  }
  const extra = evidenceFixture(release);
  extra.evidence.transitions.push({ kind: 'relation', identity: 'public.profiles', beforeSha256: hash, afterSha256: hash });
  changeRaw(extra, 'hosted', v => { v.transitions = extra.evidence.transitions; });
  assert.throws(() => controller.validateHotfixEvidence(extra));
  const altered = evidenceFixture(release); altered.evidence.transitions[0].beforeSha256 = hash;
  changeRaw(altered, 'hosted', v => { v.transitions = altered.evidence.transitions; });
  assert.throws(() => controller.validateHotfixEvidence(altered), { code: 'SCHEMA_TRANSITION_BEFORE_MISMATCH' });
});

test('success classification requires ledger217, pending1, exact owner and held canary lease', async () => {
  const { release } = await load();
  const binding = { release: release.hotfix.release, releaseCommit: commit, ownerId: owner, outcomePathSha256: hash };
  const good = { system_identifier: release.hotfix.systemIdentifier, owner_count: 1, exact_migration_count: 1,
    ledger_count: 217, owner_id: owner, release_commit: commit, phase: 'deployment-canary' };
  assert.equal(controller.classifyHotfixObservation({ rows: [good], release, binding }), 'committed-lease-held');
  for (const delta of [{ exact_migration_count: 8 }, { exact_migration_count: 0 }, { ledger_count: 216 }, { ledger_count: 223 },
    { owner_count: 0 }, { owner_id: 'other' }, { phase: 'claimed' }, { release_commit: 'c'.repeat(40) }])
    assert.equal(controller.classifyHotfixObservation({ rows: [{ ...good, ...delta }], release, binding }), 'ambiguous');
});

test('check-only has zero write calls; ambiguous apply never retries or releases its fence', async () => {
  const { release } = await load();
  for (const scenario of ['check-only', 'wrong-owner', 'lost-apply-response']) {
    const folder = await mkdtemp(join(tmpdir(), 'budget-explicit-controller-test-'));
    try {
      await persistEvidence(folder, evidenceFixture(release));
      const calls = []; let recoveryChecks = 0;
      const operation = controller.runAmoraRuntimeHotfix({ repoRoot: root, argv: argvFor(release, folder, scenario !== 'check-only'),
        now: () => now, verifyRecovery: async () => { recoveryChecks++; return true; },
        primitives: { assertReleaseGitFence: async () => {} }, transport: { query: async (sql, options) => {
          calls.push({ sql, options });
          if (options.readOnly) return [{ hotfix_preflight_count: 1 }];
          if (sql.includes('WITH claimed AS')) return [{ claim_count: scenario === 'wrong-owner' ? 0 : 1 }];
          throw new Error('SYNTHETIC_PRIVATE_SQL_NOT_FOR_OUTPUT');
        } } });
      if (scenario === 'check-only') {
        const result = await operation;
        assert.equal(result.status, 'hotfix-preflight-verified'); assert.equal(result.remoteWritesPerformed, false);
        assert.equal(calls.length, 1); assert.equal(calls[0].options.readOnly, true);
      } else {
        await assert.rejects(operation, error => error.code === (scenario === 'wrong-owner' ? 'LEASE_CLAIM_UNCONFIRMED' : 'HOTFIX_OPERATION_UNCONFIRMED'));
        const result = JSON.parse(await readFile(join(folder, 'out.json'), 'utf8'));
        assert.equal(result.status, 'release-requires-adjudication'); assert.equal(result.fenceMustRemainHeld, true);
        assert.equal(result.rerunProhibited, true); assert.equal(result.phase, scenario === 'wrong-owner' ? 'claiming' : 'apply-requested');
        assert.equal(calls.length, scenario === 'wrong-owner' ? 2 : 3);
        assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_SQL'), false);
      }
      assert.equal(recoveryChecks, 1);
      assert.doesNotThrow(() => controller.validateHotfixReadOnlyQuery(calls[0].sql));
      assert.equal(calls.some(c => c.sql.includes('DROP TABLE public.production_release_lease_20260717')), false);
    } finally { await removeFixtureDirectory(folder); }
  }
});

test('failed recovery verification stops before any management query or lease claim', async () => {
  const { release } = await load();
  const folder = await mkdtemp(join(tmpdir(), 'budget-explicit-recovery-test-'));
  try {
    await persistEvidence(folder, evidenceFixture(release));
    let queries = 0, recoveryChecks = 0;
    await assert.rejects(controller.runAmoraRuntimeHotfix({ repoRoot: root, argv: argvFor(release, folder, true), now: () => now,
      verifyRecovery: async () => { recoveryChecks++; throw new Error('SYNTHETIC_RECOVERY_REJECTED'); },
      primitives: { assertReleaseGitFence: async () => {} }, transport: { query: async () => { queries++; return []; } },
    }), /SYNTHETIC_RECOVERY_REJECTED/);
    assert.equal(recoveryChecks, 1); assert.equal(queries, 0);
  } finally { await removeFixtureDirectory(folder); }
});

// 소형 PGlite predecessor에서 원문 SQL·행 hash·lease를 실제 실행한다. 운영216개 복구 검증이 아니다.
async function localFixture(release) {
  const db = await localPredecessor(root);
  try {
    await createSyntheticBudgetRealtimeTopology(db);
    const cliExpiresAt = new Date(Date.now() + 120_000).toISOString();
    await db.exec(`CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid,bucket_id text,name text); CREATE TABLE storage.buckets(id text);
      CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid); CREATE SCHEMA cron; CREATE TABLE cron.job(jobid bigint,active boolean);
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      INSERT INTO supabase_migrations.schema_migrations VALUES('20260910160514','synthetic_predecessor',ARRAY['SELECT 1;']);
      CREATE ROLE cli_login_postgres LOGIN VALID UNTIL '${cliExpiresAt}';
      CREATE ROLE cli_login_supabase_read_only_user LOGIN VALID UNTIL '${cliExpiresAt}';
      CREATE TABLE public.amora_shared_action_journey_mutation_receipts(couple_id uuid,request_key text,operation_key text,action_id uuid,
        source_message_id uuid,confirmation_message_id uuid,expected_revision bigint,applied_revision bigint,
        mutation_kind text,decision_node_id uuid,decision_recorded_at timestamptz,budget_delta jsonb);
      INSERT INTO public.amora_shared_action_journey_mutation_receipts(couple_id,request_key,operation_key,expected_revision,applied_revision)
        VALUES('${owner}','synthetic-old-request','synthetic-old-operation',7,8);
      UPDATE public.amora_shared_action_journey_mutation_receipts SET budget_delta='{"schemaVersion":1,"totalBudget":null,"categories":[{"key":"studio","beforeBudget":1,"afterBudget":2}]}';
      CREATE FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision(p_couple_id uuid,p_request_key text,p_operation_key text,p_request_attempt_count integer,p_input_digest text,p_tool_input jsonb,p_domain_mutation jsonb,p_result jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT p_result $$;
      REVOKE ALL ON FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
      INSERT INTO public.decision_nodes(id,title,source,chosen_value) VALUES('${owner}','EXISTING SYNTHETIC DECISION','manual','{"value":"KEEP"}');
      ALTER TABLE public.community_posts ADD COLUMN hot_rank numeric;
      INSERT INTO public.community_posts(id,title,content,upvote_count,comment_count,hot_rank)
        VALUES('${owner}','EXISTING SYNTHETIC TITLE','EXISTING SYNTHETIC BODY',4,2,123456.125);`);
    await db.exec(readFileSync(join(root, 'supabase/platform-operations/security/20260717120000_production_write_fence_apply.sql'), 'utf8'));
    await db.exec('SET search_path=pg_catalog,public');
    const observe = async () => (await db.query(`${release.inventorySelect};`)).rows[0].observation;
    const before = await observe();
    const beforeData = (await db.query(`${controller.renderPublicDataQuery(before, dataOptions)};`)).rows[0].data;
    await db.exec('BEGIN'); await db.exec(transactionBody(release.migrations[0].sql.toString('utf8')));
    const after = await observe(); await db.exec('ROLLBACK');
    const transitions = after.objects.filter(row => before.objects.find(o => o.kind === row.kind && o.identity === row.identity)?.sha256 !== row.sha256)
      .map(row => ({ kind: row.kind, identity: row.identity, beforeSha256: before.objects.find(o => o.kind === row.kind && o.identity === row.identity)?.sha256 ?? null, afterSha256: row.sha256 }));
    assert.deepEqual(transitions.map(t => `${t.kind}:${t.identity}`).sort(), [...expectedSchema].sort());
    const local = { ...release, hotfix: { ...release.hotfix, systemIdentifier: before.systemIdentifier, requiredLedgerCount: before.ledger.length } };
    const evidence = { ...budgetRealtimeBindings(release), releaseCommit: commit, before, beforeData, transitions };
    const binding = { release: release.hotfix.release, releaseCommit: commit, ownerId: owner, outcomePathSha256: hash };
    await db.query(`INSERT INTO public.production_release_lease_20260717(singleton,release_id,release_commit,owner_id,outcome_path_sha256,phase)
      VALUES(true,$1,$2,$3,$4,'claimed')`, [binding.release, commit, owner, hash]);
    return { db, release: local, evidence, binding, deadlineMs: Date.now() + 60_000, observe };
  } catch (error) { await db.close(); throw error; }
}

test('actual one-SQL bundle preserves existing non-NULL budget receipts and exact-owner finalize', { timeout: 120000 }, async () => {
  const { release } = await load(); const f = await localFixture(release);
  try {
    const sql = controller.renderHotfixAtomicSql(f);
    assert.equal((sql.match(/-- reviewed source /g) ?? []).length, 1);
    assert.equal(sql.includes('HOTFIX_BACKFILL_MISMATCH'), false);
    assert.equal(sql.includes('-- reviewed source 20260907085111'), false);
    await f.db.exec(sql);
    assert.equal((await f.db.query('SELECT count(*)::integer AS n FROM supabase_migrations.schema_migrations')).rows[0].n, 2);
    assert.deepEqual((await f.db.query('SELECT budget_delta FROM public.amora_shared_action_journey_mutation_receipts')).rows, [{ budget_delta: {schemaVersion:1,totalBudget:null,categories:[{key:'studio',beforeBudget:1,afterBudget:2}]} }]);
    assert.equal(sql.includes('HOTFIX_BUDGET_RECEIPT_BACKFILL_FORBIDDEN'),false);
    assert.deepEqual((await f.db.query(`${controller.renderPublicDataQuery(f.evidence.before, dataOptions)};`)).rows[0].data, f.evidence.beforeData);
    assert.notDeepEqual((await f.db.query(`${controller.renderPublicDataQuery(f.evidence.before, { preserveHotRank: true, budgetDecisionReceipt: true })};`)).rows[0].data, f.evidence.beforeData);
    const observed = (await f.db.exec(controller.renderHotfixAdjudicationSql(f))).flatMap(result => result.rows ?? []);
    assert.equal(controller.classifyHotfixObservation({ rows: observed, release: f.release, binding: f.binding }), 'committed-lease-held');
    await assert.rejects(f.db.exec(controller.renderHotfixFinalizeSql({ ...f, binding: { ...f.binding, ownerId: '60910000-aaaa-4aaa-8aaa-123456789abc' }, canarySha256: hash })), /HOTFIX_FINALIZER_OWNER_OR_PHASE/);
    await f.db.exec('ROLLBACK');
    assert.equal((await f.db.query('SELECT phase FROM public.production_release_lease_20260717')).rows[0].phase, 'deployment-canary');
    const finalized = (await f.db.exec(controller.renderHotfixFinalizeSql({ ...f, canarySha256: hash }))).flatMap(r => r.rows ?? []).at(-1);
    assert.equal(finalized.hotfix_finalized_count, 1);
    assert.equal((await f.db.query("SELECT to_regclass('public.production_release_lease_20260717') AS lease")).rows[0].lease, null);
    assert.deepEqual((await f.db.query(`${controller.renderPublicDataQuery(f.evidence.before, dataOptions)};`)).rows[0].data, f.evidence.beforeData);
  } finally { await f.db.close(); }
});

test('actual finalizer rejects any change to an existing budget_delta and all other old fields', { timeout: 120000 }, async () => {
  const { release } = await load(); const f = await localFixture(release);
  try {
    await f.db.exec(controller.renderHotfixAtomicSql(f));
    for (const mutation of [
      "UPDATE public.amora_shared_action_journey_mutation_receipts SET applied_revision=999",
      "UPDATE public.amora_shared_action_journey_mutation_receipts SET budget_delta='{}'::jsonb",
      "UPDATE public.community_posts SET hot_rank=0",
      "UPDATE public.decision_nodes SET title='MUTATED SYNTHETIC ROW'",
    ]) {
      await f.db.exec('BEGIN'); await f.db.exec(mutation);
      await assert.rejects(f.db.exec(controller.renderHotfixFinalizeSql({ ...f, canarySha256: hash })), /HOTFIX_(?:EXISTING_ROWS_CHANGED|[A-Z_]*BUDGET[A-Z_]*|[A-Z_]*RECEIPT[A-Z_]*)/);
      await f.db.exec('ROLLBACK');
      assert.equal((await f.db.query('SELECT phase FROM public.production_release_lease_20260717')).rows[0].phase, 'deployment-canary');
      assert.equal((await f.db.query("SELECT count(*)::integer AS n FROM pg_event_trigger WHERE evtname LIKE 'evt_production_write_fence%'")).rows[0].n, 2);
    }
    assert.deepEqual((await f.db.query(`${controller.renderPublicDataQuery(f.evidence.before, dataOptions)};`)).rows[0].data, f.evidence.beforeData);
  } finally { await f.db.close(); }
});

test('actual post-schema failure rolls the function and ledger back while retaining receipt rows and the claimed lease', { timeout: 120000 }, async () => {
  const { release } = await load(); const f = await localFixture(release);
  try {
    const before = await f.observe();
    const invalid = structuredClone(f.evidence); invalid.transitions[0].afterSha256 = hash;
    await assert.rejects(f.db.exec(controller.renderHotfixAtomicSql({ ...f, evidence: invalid })), /HOTFIX_AFTER_SCHEMA_DRIFT/);
    await f.db.exec('ROLLBACK');
    const after = await f.observe();
    assert.deepEqual(after.objects, before.objects); assert.deepEqual(after.ledger, before.ledger);
    assert.deepEqual((await f.db.query(`${controller.renderPublicDataQuery(f.evidence.before, dataOptions)};`)).rows[0].data, f.evidence.beforeData);
    assert.equal((await f.db.query('SELECT phase FROM public.production_release_lease_20260717')).rows[0].phase, 'claimed');
    assert.equal((await f.db.query("SELECT count(*)::integer AS n FROM pg_event_trigger WHERE evtname LIKE 'evt_production_write_fence%'")).rows[0].n, 2);
  } finally { await f.db.close(); }
});


test('current evidence rejects omitted or mixed supplemental bindings before transport', async () => {
  const { release } = await load();
  for (const field of ['baselineSupplementSha256', 'effectiveBaselineSha256']) {
    const missing = evidenceFixture(release); delete missing.evidence[field];
    assert.throws(() => controller.validateHotfixEvidence(missing), { code: 'REALTIME_SUPPLEMENT_BINDING_INVALID' });
    const mixed = evidenceFixture(release); mixed.evidence[field] = hash;
    assert.throws(() => controller.validateHotfixEvidence(mixed), { code: 'REALTIME_SUPPLEMENT_BINDING_INVALID' });
  }
});


test('actual apply and finalizer reject a different partition parent even when the old inventory hash stays equal', { timeout: 120000 }, async () => {
  const { release } = await load(); const f = await localFixture(release);
  try {
    await f.db.exec('BEGIN');
    await f.db.exec(moveSyntheticRealtimeChild);
    const changed = await f.observe();
    assert.deepEqual(changed.objects, f.evidence.before.objects, 'old fingerprint does not include the parent graph');
    await assert.rejects(f.db.exec(controller.renderHotfixAtomicSql(f)), /HOTFIX_REALTIME_TOPOLOGY_CHANGED/);
    await f.db.exec('ROLLBACK');
    assert.equal((await f.db.query('SELECT count(*)::integer AS n FROM supabase_migrations.schema_migrations')).rows[0].n, 1);
    await f.db.exec(controller.renderHotfixAtomicSql(f));
    await f.db.exec('BEGIN'); await f.db.exec(moveSyntheticRealtimeChild);
    await assert.rejects(f.db.exec(controller.renderHotfixFinalizeSql({ ...f, canarySha256: hash })), /HOTFIX_REALTIME_TOPOLOGY_CHANGED/);
    await f.db.exec('ROLLBACK');
    assert.equal((await f.db.query('SELECT phase FROM public.production_release_lease_20260717')).rows[0].phase, 'deployment-canary');
    await f.db.exec(controller.renderHotfixFinalizeSql({ ...f, canarySha256: hash }));
  } finally { await f.db.close(); }
});


test('recovery and finalizer reject old or mixed baseline bindings before decryption, canary or remote execution', async () => {
  const { release } = await load();
  for (const field of ['baselineSupplementSha256', 'effectiveBaselineSha256']) {
    const f = evidenceFixture(release); delete f.evidence[field];
    await assert.rejects(controller.verifyHotfixRecovery({ repoRoot: root, evidenceRoot: fixtureRoot, state: f, mode }),
      { code: 'REALTIME_SUPPLEMENT_BINDING_INVALID' });
    const folder = await mkdtemp(join(tmpdir(), 'budget-explicit-controller-test-'));
    try {
      const valid = evidenceFixture(release); await persistEvidence(folder, valid);
      const outcome = { ...budgetRealtimeBindings(release) }; outcome[field] = hash;
      await writeFile(join(folder, 'apply.json'), JSON.stringify(outcome));
      let queries = 0, recoveries = 0;
      await assert.rejects(controller.runAmoraRuntimeHotfixFinalize({ repoRoot: root, evidenceRoot: folder,
        outcomePath: join(folder, 'apply.json'), canaryPath: join(folder, 'canary.json'), receiptOut: join(folder, 'final.json'),
        expectedCommit: commit, remoteRef: 'origin/codex/test', confirmProduction: 'UNREACHED', mode, now: () => now,
        primitives: { assertReleaseGitFence: async () => {} }, verifyRecovery: async () => { recoveries++; },
        transport: { query: async () => { queries++; return []; } } }), { code: 'REALTIME_SUPPLEMENT_BINDING_INVALID' });
      assert.equal(queries, 0); assert.equal(recoveries, 0);
    } finally { await removeFixtureDirectory(folder); }
  }
});

test('actual after guard rolls back a graph-only drift injected after the feature SQL', { timeout: 120000 }, async () => {
  const { release } = await load(); const f = await localFixture(release);
  try {
    const sql = controller.renderHotfixAtomicSql(f);
    // SQL 파일을 바꾸지 않는다. 로컬 fault injection으로 before 통과 후 graph만 달라진 시점을 재현한다.
    const injected = sql.replace('DO $hotfix_after$', () => moveSyntheticRealtimeChild + '\nDO $hotfix_after$');
    assert.notEqual(injected, sql);
    await assert.rejects(f.db.exec(injected), /HOTFIX_REALTIME_TOPOLOGY_CHANGED/);
    await f.db.exec('ROLLBACK');
    const after = await f.observe();
    assert.deepEqual(after.objects, f.evidence.before.objects); assert.deepEqual(after.ledger, f.evidence.before.ledger);
    assert.equal((await f.db.query('SELECT phase FROM public.production_release_lease_20260717')).rows[0].phase, 'claimed');
  } finally { await f.db.close(); }
});

function canaryFixture(release) {
  const outcome = { ...budgetRealtimeBindings(release), releaseCommit: commit, ownerId: owner, verifiedAt: '2026-09-11T08:40:00Z' };
  const deployment = { id: 'dpl_syntheticHotfixRelease01', team: { id: 'team_XwMZqiJ4wXM2Ypvs99icXaQx' },
    ownerId: 'team_XwMZqiJ4wXM2Ypvs99icXaQx', projectId: 'prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes',
    target: 'production', readyState: 'READY', meta: { githubCommitSha: commit }, alias: ['hanbang.ai'], url: 'synthetic.vercel.app',
    createdAt: Date.parse('2026-09-11T08:20:00Z'), ready: Date.parse('2026-09-11T08:30:00Z') };
  const observation = (path, method, status, data) => ({ host: 'hanbang.ai', observedAt: '2026-09-11T08:48:00Z', path, method, status, ...data });
  const http = { format: 'amora-hotfix-http-observations-v1', releaseCommit: commit, deploymentId: deployment.id, productionHost: 'hanbang.ai',
    startedAt: '2026-09-11T08:45:00Z', finishedAt: '2026-09-11T08:55:00Z', observations: [
      observation('/api/health', 'GET', 200, { body: { ok: true, database: 'up', commit: commit.slice(0, 12) } }),
      observation('/landing', 'GET', 200, { bodySha256: hash, renderedLanding: true }),
      observation('/api/community/posts?sort=hot&page=1', 'GET', 200, { bodySha256: hash, postsArrayVerified: true }),
      observation('/api/amora/notes', 'GET', 200, { bodySha256: hash, syntheticActorSha256: hash, authenticatedNotesArrayVerified: true }),
      observation('/api/release/write-fence-probe', 'POST', 503, { body: { error: 'production_write_fence_enabled' }, deploymentCommitHeader: commit }),
    ], serverErrors: { deploymentId: deployment.id, from: '2026-09-11T08:45:00Z', to: '2026-09-11T08:55:00Z', count: 0, rawEvidenceSha256: hash } };
  const make = () => {
    const deploymentRaw = JSON.stringify(deployment), httpRaw = JSON.stringify(http);
    return { canary: { format: 'amora-runtime-hotfix-canary-v1', releaseCommit: commit, ownerId: owner, outcomeSha256: digestJson(outcome),
      migrationSetSha256: release.migrationSetSha256, deploymentId: deployment.id,
      deploymentRaw: { file: 'deployment.raw.json', sha256: digest(deploymentRaw) }, httpRaw: { file: 'http.raw.json', sha256: digest(httpRaw) } },
    deploymentRaw, httpRaw, outcome, release, now };
  };
  return { deployment, http, outcome, make };
}


test('explicit canary requires the exact candidate, owner, five-minute post-apply/READY window and held web fence', async () => {
  const { release } = await load();
  assert.equal(controller.validateHotfixCanary(canaryFixture(release).make()).deadlineMs, Date.parse('2026-09-11T09:10:00Z'));
  for (const mutate of [
    f => { f.deployment.meta.githubCommitSha = 'c'.repeat(40); },
    f => { f.deployment.ownerId = 'wrong'; },
    f => { f.deployment.ready = Date.parse('2026-09-11T08:46:00Z'); },
    f => { f.outcome.verifiedAt = '2026-09-11T08:46:00Z'; },
    f => { f.http.startedAt = '2026-09-11T08:54:00Z'; },
    f => { f.http.observations[4].status = 409; },
    f => { f.http.serverErrors.count = 1; },
  ]) { const f = canaryFixture(release); mutate(f); assert.throws(() => controller.validateHotfixCanary(f.make())); }
  const wrong = canaryFixture(release).make(); wrong.canary.ownerId = 'different';
  assert.throws(() => controller.validateHotfixCanary(wrong), { code: 'CANARY_BINDING_INVALID' });
});
