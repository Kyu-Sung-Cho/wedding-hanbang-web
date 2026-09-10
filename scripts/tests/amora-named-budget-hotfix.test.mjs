import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { digest, digestJson, loadCurrentBaselineContract } from '../lib/current-baseline-release-contract.mjs';
import { transactionBody } from '../lib/current-baseline-hosted-synthetic.mjs';
import { localPredecessor } from './fixtures/current-baseline-hosted-synthetic-local.mjs';
import { loadHotfixRelease, loadNamedBudgetHotfixRelease, parseNamedBudgetHotfixArgs, parseHotfixArgs, validateNamedBudgetPredecessor,
  validateHotfixEvidence, renderPublicDataQuery, renderHotfixAtomicSql, renderHotfixAdjudicationSql, classifyHotfixObservation,
  renderHotfixFinalizeSql, NAMED_BUDGET_FUNCTIONS, runAmoraRuntimeHotfix, validateHotfixReadOnlyQuery } from '../lib/amora-runtime-hotfix-controller.mjs';
const root = resolve(import.meta.dirname, '../..');
const cliFixtureRoot = join(tmpdir(), 'amora-hotfix-cli-fixture');
const release = loadNamedBudgetHotfixRelease(root);
const previousRelease = loadHotfixRelease(root);
const now = new Date('2026-09-07T09:30:00Z');
const commit = 'a'.repeat(40), hash = 'b'.repeat(64);
const owner = '60907000-1234-4123-8123-123456789abc';
const binding = { release: release.hotfix.release, releaseCommit: commit, ownerId: owner, outcomePathSha256: hash };
function evidenceFixture() {
  const before = structuredClone(release.baseline);
  const tables = before.relations.filter(t => t.schema === 'public' && ['r', 'p'].includes(t.kind));
  const evidence = { format: 'amora-runtime-hotfix-evidence-v1', releaseCommit: commit, projectRef: release.hotfix.projectRef,
    systemIdentifier: release.hotfix.systemIdentifier, hotfixContractSha256: release.hotfixSha256, migrationSetSha256: release.migrationSetSha256,
    expiresAt: '2026-09-07T09:50:00Z', scope: release.hotfix.scope, before,
    beforeData: tables.map(t => ({ relation: `${t.schema}.${t.name}`, rows: 0, rowsSha256: digest('') })), transitions: [] };
  for (const key of NAMED_BUDGET_FUNCTIONS) { const identity = key.slice(9); const prior = before.objects.find(o => o.kind === 'function' && o.identity === identity); evidence.transitions.push({ kind: 'function', identity, beforeSha256: prior?.sha256 ?? null, afterSha256: hash }); }
  const raw = { rollbackOriginal: 'SYNTHETIC ORIGINAL DDL, NOT A PRODUCTION RECEIPT' }, reports = {};
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
  reports.backup.snapshotDirectory = 'snapshot';
  wrap('rollback', { ...target, kind: 'synthetic-named-budget-sql-transaction-rollback', sourceArchiveRestored: false,
    originalDdlArtifactSha256: evidence.rollbackOriginal.sha256,
    beforeSchemaSha256: hash, afterRollbackSchemaSha256: hash, beforeDataSha256: hash, afterRollbackDataSha256: hash,
    transactionRollbackExecuted: true, operatorFenceHeld: true });
  wrap('hosted', { ...target, executedMigrations: release.migrations.map(m => ({ file: m.file, sha256: m.sha256, bodySha256: digest(transactionBody(m.sql.toString('utf8'))) })),
    transitions: evidence.transitions, checks: ['actorBoundary', 'namedAllocationsExactReceipt', 'budgetPreservesOmittedAllocations', 'retryAndConcurrentLabels', 'privateHelperAcl', 'rollback']
      .map(name => ({ name, status: 'passed', observed: { synthetic: name }, rawEvidenceSha256: digestJson({ synthetic: name }) })) });
  wrap('concurrency', { ...target, cases: ['actorRosterChange', 'budgetConcurrentChange', 'wrongOwnerLease'].map(name => ({ name,
    connections: ['connection-1', 'connection-2'], contenderSqlstate: name === 'wrongOwnerLease' ? 'P0001' : name === 'actorRosterChange' ? '42501' : null,
    ...(name === 'budgetConcurrentChange' ? { contenderSuccess: false, contenderErrorCode: 'domain_state_changed' } : {}),
    unintendedWrites: 0, transcriptSha256: hash })) });
  wrap('fence', { host: 'hanbang.ai', deploymentCommit: commit, verifiedAt: now.toISOString(), webWriteStatus: 503, webWriteCode: 'production_write_fence_enabled',
    publicFenceSourceSha256: release.contract.implementation.writeFenceCheck.sha256, publicFenceVerified: true, existingRequestsDrained: true,
    newTableFenceVerified: true, activePublicWriters: 0, activeCronJobs: 0 });
  wrap('dryRun', { cliVersion: release.contract.cli.version, cliBinarySha256: release.contract.cli.binarySha256, cliCompanionSha256: release.contract.cli.companionSha256,
    exitCode: 0, remoteWritesPerformed: false, stdout: `DRY RUN\n${release.migrations.map(m => m.file).join('\n')}` });
  return { evidence, reports, raw, release, expectedCommit: commit, now };
}
const validate = fixture => validateHotfixEvidence(fixture);
function changeRaw(fixture, kind, update) {
  const value = JSON.parse(fixture.raw[kind]); update(value);
  fixture.raw[kind] = JSON.stringify(value);
  fixture.reports[kind].rawEvidenceSha256 = digest(fixture.raw[kind]);
  fixture.reports[kind].rawEvidence.sha256 = digest(fixture.raw[kind]);
}

test('new mode selects one original SQL above actual 214 history and cannot route through the old eight mode', () => {
  assert.equal(release.baseline.ledger.length, 214); assert.equal(release.migrations.length, 1);
  assert.equal(release.migrations[0].file, '20260907085111_amora_budget_plan_named_allocations.sql');
  assert.equal(previousRelease.migrations.length, 8); assert.equal(previousRelease.hotfix.requiredLedgerCount, 206);
  assert.deepEqual(release.baseline.ledger.slice(0, 206), previousRelease.baseline.ledger);
  assert.deepEqual(release.hotfix.scope, previousRelease.hotfix.scope);
  const args = ['--amora-named-budget-hotfix', '--check-only', `--expected-commit=${commit}`, '--remote-ref=origin/codex/test',
    `--evidence-root=${cliFixtureRoot}`, `--receipt-out=${join(cliFixtureRoot, 'one.json')}`, `--bundle-out=${join(cliFixtureRoot, 'one.sql')}`];
  assert.equal(parseNamedBudgetHotfixArgs(args)['amora-named-budget-hotfix'], true); assert.throws(() => parseHotfixArgs(args));
  for (const extra of ['--amora-runtime-hotfix', '--apply', '--skip-evidence', '--amora-named-budget-hotfix'])
    assert.throws(() => parseNamedBudgetHotfixArgs([...args, extra]));
  const finalize = args.filter(a => a !== '--check-only' && !a.startsWith('--bundle-out'));
  assert.equal(parseNamedBudgetHotfixArgs([...finalize, '--finalize', `--outcome=${join(cliFixtureRoot, 'apply.json')}`, `--canary=${join(cliFixtureRoot, 'canary.json')}`, '--confirm-production=placeholder']).finalize, true);
});

test('new predecessor is exactly original history plus eight original statements, without role, app, storage or relation drift', () => {
  const args = { prior: previousRelease, baseline: release.baseline, delta: release.hotfix.predecessorDelta };
  assert.doesNotThrow(() => validateNamedBudgetPredecessor(args));
  for (const change of [b => { b.ledger[0].name = 'repaired'; }, b => { b.ledger[206].statementsSha256 = hash; },
    b => { b.objects.find(o => o.kind === 'role').sha256 = hash; }, b => { b.objects.find(o => o.identity === 'public.profiles').sha256 = hash; },
    b => { b.storageStructureSha256 = hash; }, b => { b.relations.pop(); }, b => { b.cliRoleExpirations[0].validUntil = 'infinity'; },
  ]) assert.throws(() => { const baseline = structuredClone(release.baseline); change(baseline); validateNamedBudgetPredecessor({ ...args, baseline }); });
  assert.throws(() => validateNamedBudgetPredecessor({ ...args, delta: { objects: [] } }));
});

test('followup recognition rejects changed bytes and unrelated future SQL while old selection remains eight', () => {
  const copy = mkdtempSync(join(tmpdir(), 'named-hotfix-pin-'));
  try {
    cpSync(join(root, 'supabase'), join(copy, 'supabase'), { recursive: true });
    for (const pin of Object.values(previousRelease.contract.implementation)) {
      mkdirSync(dirname(join(copy, pin.file)), { recursive: true }); cpSync(join(root, pin.file), join(copy, pin.file));
    }
    assert.equal(loadCurrentBaselineContract(copy).migrations.length, 8);
    const file = join(copy, 'supabase/migrations', release.migrations[0].file);
    writeFileSync(file, Buffer.concat([release.migrations[0].sql, Buffer.from('\nSELECT 2;')]));
    assert.throws(() => loadCurrentBaselineContract(copy), { code: 'ARTIFACT_HASH_MISMATCH' });
    writeFileSync(file, release.migrations[0].sql);
    writeFileSync(join(copy, 'supabase/migrations/20260907090000_unreviewed.sql'), 'BEGIN; SELECT 1; COMMIT;');
    assert.throws(() => loadCurrentBaselineContract(copy), { code: 'NEW_MIGRATION_NOT_REVIEWED' });
  } finally { rmSync(copy, { recursive: true, force: true }); }
});

test('one-SQL evidence requires actual backup, hosted actors/labels/ACL, concurrency, fence and exact dry-run', () => {
  assert.equal(validate(evidenceFixture()).evidenceSha256.length, 64);
  for (const [kind, change] of [
    ['backup', v => { v.actualSourceCapture = false; }], ['backup', v => { v.inspection.archiveDecodePassed = false; }],
    ['hosted', v => { v.databaseEngine = 'PGlite'; }], ['hosted', v => { v.checks.pop(); }], ['hosted', v => { v.executedMigrations[0].sha256 = hash; }],
    ['concurrency', v => { v.cases[1].contenderSuccess = true; }], ['concurrency', v => { v.cases[2].connections = ['one', 'one']; }],
    ['fence', v => { v.activePublicWriters = 1; }], ['rollback', v => { v.sourceArchiveRestored = true; }],
    ['rollback', v => { v.kind = 'synthetic-eight-sql-transaction-rollback'; }],
    ['dryRun', v => { v.stdout = `DRY RUN\n${previousRelease.migrations.map(m => m.file).join('\n')}`; }],
  ]) { const f = evidenceFixture(); changeRaw(f, kind, change); assert.throws(() => validate(f)); }
  const missing = evidenceFixture(); missing.evidence.transitions.pop(); changeRaw(missing, 'hosted', v => { v.transitions = missing.evidence.transitions; });
  assert.throws(() => validate(missing), { code: 'SCHEMA_TRANSITIONS_MISSING' });
  const foreign = evidenceFixture(); foreign.evidence.transitions[0].identity = 'public.unreviewed()';
  assert.throws(() => validate(foreign), { code: 'SCHEMA_CHANGE_OUT_OF_SCOPE' });
});

test('success means one migration and ledger215, never eight, zero, wrong owner or wrong phase', () => {
  const good = { system_identifier: release.hotfix.systemIdentifier, owner_count: 1, exact_migration_count: 1,
    ledger_count: 215, owner_id: owner, release_commit: commit, phase: 'deployment-canary' };
  assert.equal(classifyHotfixObservation({ rows: [good], release, binding }), 'committed-lease-held');
  for (const update of [{ exact_migration_count: 8 }, { ledger_count: 222 }, { exact_migration_count: 0 },
    { owner_count: 0 }, { owner_id: 'other' }, { phase: 'claimed' }, { release_commit: 'c'.repeat(40) }])
    assert.equal(classifyHotfixObservation({ rows: [{ ...good, ...update }], release, binding }), 'ambiguous');
});

// 실제 PGlite의 소형 predecessor+8SQL이다. 운영 214개 원본 복구를 주장하지 않는다.
async function localFixture() {
  const db = await localPredecessor(root);
  try {
    await db.exec(`CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid,bucket_id text,name text); CREATE TABLE storage.buckets(id text);
      CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid); CREATE SCHEMA cron; CREATE TABLE cron.job(jobid bigint,active boolean);
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      INSERT INTO supabase_migrations.schema_migrations VALUES('20260902120000','synthetic_predecessor',ARRAY['SELECT 1;']);
      CREATE ROLE cli_login_postgres LOGIN VALID UNTIL '2026-09-07T00:00:00Z';
      CREATE ROLE cli_login_supabase_read_only_user LOGIN VALID UNTIL '2026-09-07T00:00:00Z';`);
    for (const m of previousRelease.migrations) {
      await db.exec(transactionBody(m.sql.toString('utf8')));
      await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)', [m.version, m.file.slice(15, -4), [m.sql.toString('utf8')]]);
    }
    await db.exec(`INSERT INTO auth.users(id) VALUES('60907000-0000-4000-8000-000000000001');
      INSERT INTO public.chat_messages(id,content) VALUES('60907000-0000-4000-8000-000000000002','EXISTING PRIVATE SOURCE');
      INSERT INTO public.amora_personal_actions(owner_user_id,source_message_id,source_requester_message_id,request_id,title)
        VALUES('60907000-0000-4000-8000-000000000001','60907000-0000-4000-8000-000000000002','60907000-0000-4000-8000-000000000002','60907000-0000-4000-8000-000000000003','EXISTING PERSONAL ACTION');
      INSERT INTO public.community_posts(id,title,content,upvote_count,comment_count) VALUES('60907000-0000-4000-8000-000000000050','ORIGINAL TITLE','ORIGINAL BODY',4,2);`);
    await db.exec(readFileSync(join(root, 'supabase/platform-operations/security/20260717120000_production_write_fence_apply.sql'), 'utf8'));
    await db.exec('SET search_path=pg_catalog,public');
    const observe = async () => (await db.query(`${release.inventorySelect};`)).rows[0].observation;
    const before = await observe();
    const beforeData = (await db.query(`${renderPublicDataQuery(before, { preserveHotRank: true })};`)).rows[0].data;
    await db.exec('BEGIN'); await db.exec(transactionBody(release.migrations[0].sql.toString('utf8')));
    const after = await observe(); await db.exec('ROLLBACK');
    const transitions = after.objects.filter(row => before.objects.find(o => o.kind === row.kind && o.identity === row.identity)?.sha256 !== row.sha256)
      .map(row => ({ kind: row.kind, identity: row.identity, beforeSha256: before.objects.find(o => o.kind === row.kind && o.identity === row.identity)?.sha256 ?? null, afterSha256: row.sha256 }));
    assert.deepEqual(transitions.map(t => `${t.kind}:${t.identity}`).sort(), [...NAMED_BUDGET_FUNCTIONS].sort());
    const local = { ...release, hotfix: { ...release.hotfix, systemIdentifier: before.systemIdentifier, requiredLedgerCount: before.ledger.length } };
    const evidence = { releaseCommit: commit, before, beforeData, transitions };
    await db.query(`INSERT INTO public.production_release_lease_20260717(singleton,release_id,release_commit,owner_id,outcome_path_sha256,phase)
      VALUES(true,$1,$2,$3,$4,'claimed')`, [binding.release, commit, owner, hash]);
    return { db, release: local, evidence, binding, deadlineMs: Date.now() + 60_000, observe };
  } catch (error) { await db.close(); throw error; }
}

test('actual one-SQL apply preserves legitimate personal/community rows, installs private helper and finalizes exact owner', { timeout: 120000 }, async () => {
  const f = await localFixture();
  try {
    await f.db.exec(renderHotfixAtomicSql(f));
    const ledger = (await f.db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
    assert.equal(ledger.length, 10);
    assert.deepEqual(ledger.at(-1), { version: release.migrations[0].version, name: release.migrations[0].file.slice(15, -4), statements: [release.migrations[0].sql.toString('utf8')] });
    const dataSql = renderPublicDataQuery(f.evidence.before, { preserveHotRank: true });
    assert.deepEqual((await f.db.query(`${dataSql};`)).rows[0].data, f.evidence.beforeData);
    const post = (await f.db.exec(renderHotfixAdjudicationSql(f))).flatMap(result => result.rows ?? []);
    assert.equal(classifyHotfixObservation({ rows: post, release: f.release, binding }), 'committed-lease-held');
    const resolved = await f.db.query(`SELECT public.amora_resolve_budget_plan_allocations($1,'{}'::jsonb,$2::jsonb) AS allocations`,
      [owner, JSON.stringify([{ category: 'custom', label: '식장·식사', budget: 9000000 }])]);
    assert.equal(resolved.rows[0].allocations[0].label, '식장·식사'); assert.equal(resolved.rows[0].allocations[0].budget, 9000000);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await f.db.query(
      `SELECT has_function_privilege($1,'public.amora_resolve_budget_plan_allocations(uuid,jsonb,jsonb)','EXECUTE') AS allowed`, [role])).rows[0].allowed, false);
    await assert.rejects(f.db.exec(renderHotfixFinalizeSql({ ...f, binding: { ...binding, ownerId: '60907000-aaaa-4aaa-8aaa-123456789abc' }, canarySha256: hash })), /HOTFIX_FINALIZER_OWNER_OR_PHASE/);
    await f.db.exec('ROLLBACK');
    const finalized = (await f.db.exec(renderHotfixFinalizeSql({ ...f, canarySha256: hash }))).flatMap(r => r.rows ?? []).at(-1);
    assert.equal(finalized.hotfix_finalized_count, 1);
    assert.equal((await f.db.query("SELECT to_regclass('public.production_release_lease_20260717') AS lease")).rows[0].lease, null);
    assert.deepEqual((await f.db.query(`${dataSql};`)).rows[0].data, f.evidence.beforeData);
  } finally { await f.db.close(); }
});

test('actual failed last invariant rolls back both functions and ledger; omitting old hot_rank from original data is refused', { timeout: 120000 }, async () => {
  const f = await localFixture();
  try {
    const original = await f.observe();
    const broken = structuredClone(f.evidence); broken.transitions[0].afterSha256 = hash;
    await assert.rejects(f.db.exec(renderHotfixAtomicSql({ ...f, evidence: broken })), /HOTFIX_AFTER_SCHEMA_DRIFT/); await f.db.exec('ROLLBACK');
    const after = await f.observe(); assert.deepEqual(after.objects, original.objects); assert.deepEqual(after.ledger, original.ledger);
    assert.equal((await f.db.query('SELECT phase FROM public.production_release_lease_20260717')).rows[0].phase, 'claimed');
    const wrongData = structuredClone(f.evidence); wrongData.beforeData = (await f.db.query(`${renderPublicDataQuery(f.evidence.before)};`)).rows[0].data;
    await assert.rejects(f.db.exec(renderHotfixAtomicSql({ ...f, evidence: wrongData })), /HOTFIX_EXISTING_ROWS_CHANGED/); await f.db.exec('ROLLBACK');
    assert.deepEqual((await f.observe()).ledger, original.ledger);
  } finally { await f.db.close(); }
});

test('named mode wrong claim and lost apply response write durable adjudication, throw, and never retry or unfence', async () => {
  for (const mode of ['wrong-owner', 'lost-apply-response']) {
    const folder = await mkdtemp(join(tmpdir(), 'amora-hotfix-control-'));
    try {
      const f = evidenceFixture(); f.evidence.reports = {};
      for (const kind of release.hotfix.requiredEvidence) {
        const report = JSON.stringify(f.reports[kind]);
        f.evidence.reports[kind] = { file: `${kind}.json`, sha256: digest(report) };
        await writeFile(join(folder, `${kind}.json`), report); await writeFile(join(folder, `${kind}.raw.json`), f.raw[kind]);
      }
      await writeFile(join(folder, 'original-ddl.json'), f.raw.rollbackOriginal);
      await writeFile(join(folder, 'amora-hotfix-evidence.json'), JSON.stringify(f.evidence));
      const calls = []; const receipt = join(folder, 'out.json');
      const argv = ['--amora-named-budget-hotfix', '--apply', `--expected-commit=${commit}`, '--remote-ref=origin/codex/test',
        `--evidence-root=${folder}`, `--receipt-out=${receipt}`, `--bundle-out=${join(folder, 'bundle.sql')}`,
        `--confirm-production=APPLY:${release.hotfix.projectRef}:${release.hotfix.release}:${commit}`];
      await assert.rejects(runAmoraRuntimeHotfix({ repoRoot: root, argv, now: () => now, verifyRecovery: async () => true,
        primitives: { assertReleaseGitFence: async () => {} }, transport: { query: async (sql, options) => {
          calls.push({ sql, options });
          if (options.readOnly) return [{ hotfix_preflight_count: 1 }];
          if (sql.includes('WITH claimed AS')) return [{ claim_count: mode === 'wrong-owner' ? 0 : 1 }];
          throw new Error('SYNTHETIC_PRIVATE_SQL_MUST_NOT_BE_REPORTED');
        } } }), error => error.code === (mode === 'wrong-owner' ? 'LEASE_CLAIM_UNCONFIRMED' : 'HOTFIX_OPERATION_UNCONFIRMED'));
      const result = JSON.parse(await readFile(receipt, 'utf8'));
      assert.equal(result.status, 'release-requires-adjudication');
      assert.equal(result.phase, mode === 'wrong-owner' ? 'claiming' : 'apply-requested');
      assert.equal(result.fenceMustRemainHeld, true); assert.equal(result.rerunProhibited, true);
      assert.equal(calls.length, mode === 'wrong-owner' ? 2 : 3);
      assert.doesNotThrow(() => validateHotfixReadOnlyQuery(calls[0].sql));
      assert.equal(calls.some(c => c.sql.includes('DROP TABLE public.production_release_lease_20260717')), false);
      assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_SQL'), false);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
});
