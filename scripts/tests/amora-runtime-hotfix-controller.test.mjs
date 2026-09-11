import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, digestJson, loadCurrentBaselineContract } from '../lib/current-baseline-release-contract.mjs';
import { transactionBody } from '../lib/current-baseline-hosted-synthetic.mjs';
import { localPredecessor } from './fixtures/current-baseline-hosted-synthetic-local.mjs';
import { loadHotfixRelease, parseHotfixArgs, parseHotfixFinalizeArgs, validateHotfixEvidence, renderPublicDataQuery,
  renderHotfixAtomicSql, renderHotfixAdjudicationSql, classifyHotfixObservation, createManagementHotfixTransport,
  validateHotfixOperatingBaseline, validateHotfixCanary, renderHotfixFinalizeSql, validateHotfixReadOnlyQuery } from '../lib/amora-runtime-hotfix-controller.mjs';
import { runAmoraRuntimeHotfix, verifyHotfixSourceLineage } from '../lib/amora-runtime-hotfix-controller.mjs';
import { resolvePinnedWindowsProductionToolchain } from '../lib/production-windows-toolchain.mjs';
import { releaseHostHasPinnedBytes } from './fixtures/pinned-windows-release-host.mjs';
import { createHistoricalReleaseRepository } from './fixtures/legacy-release-repository.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const historical = createHistoricalReleaseRepository(root);
test.after(historical.cleanup);
const cliFixtureRoot = join(tmpdir(), 'amora-hotfix-cli-fixture');
const release = loadHotfixRelease(historical.root);
const now = new Date('2026-09-07T05:00:00Z');
const commit = 'a'.repeat(40), hash = 'b'.repeat(64);
const owner = '60907000-1234-4123-8123-123456789abc';
const binding = { release: release.hotfix.release, releaseCommit: commit, ownerId: owner, outcomePathSha256: hash };
const limits = { fullDatabaseRestoreVerified: false, storageObjectsRestored: false, authDataRestored: false };
function evidenceFixture() {
  const before = structuredClone(release.baseline);
  const tables = before.relations.filter(t => t.schema === 'public' && ['r', 'p'].includes(t.kind));
  const evidence = { format: 'amora-runtime-hotfix-evidence-v1', releaseCommit: commit, projectRef: release.hotfix.projectRef,
    systemIdentifier: release.hotfix.systemIdentifier, hotfixContractSha256: release.hotfixSha256, migrationSetSha256: release.migrationSetSha256,
    expiresAt: '2026-09-07T05:20:00Z', scope: release.hotfix.scope, before,
    beforeData: tables.map(t => ({ relation: `${t.schema}.${t.name}`, rows: 0, rowsSha256: digest('') })), transitions: [] };
  const beforeFunction = before.objects.find(o => o.kind === 'function' && o.identity.startsWith('public.capture_amora_profile_privacy_epoch('));
  evidence.transitions.push({ kind: beforeFunction.kind, identity: beforeFunction.identity, beforeSha256: beforeFunction.sha256, afterSha256: hash });
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
  wrap('rollback', { ...target, kind: 'synthetic-eight-sql-transaction-rollback', sourceArchiveRestored: false,
    originalDdlArtifactSha256: evidence.rollbackOriginal.sha256,
    beforeSchemaSha256: hash, afterRollbackSchemaSha256: hash, beforeDataSha256: hash, afterRollbackDataSha256: hash,
    transactionRollbackExecuted: true, operatorFenceHeld: true });
  wrap('hosted', { ...target, executedMigrations: release.migrations.map(m => ({ file: m.file, sha256: m.sha256, bodySha256: digest(transactionBody(m.sql.toString('utf8'))) })),
    transitions: evidence.transitions, checks: ['actorBoundary', 'budgetPreservesOmittedAllocations', 'personalOwnerPrivacy', 'mediationChoices', 'rollback']
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

test('independent mode preserves exact eight/history/scope and requires explicit project-commit confirmation inputs', () => {
  assert.equal(release.migrations.length, 8);
  assert.deepEqual(Object.fromEntries(Object.keys(limits).map(k => [k, release.hotfix.scope[k]])), limits);
  assert.equal(release.hotfix.requiredLedgerCount, 206);
  const args = ['--amora-runtime-hotfix', '--check-only', `--expected-commit=${commit}`, '--remote-ref=origin/codex/test',
    `--evidence-root=${cliFixtureRoot}`, `--receipt-out=${join(cliFixtureRoot, 'out.json')}`, `--bundle-out=${join(cliFixtureRoot, 'out.sql')}`];
  assert.equal(parseHotfixArgs(args)['check-only'], true);
  for (const extra of [['--apply'], ['--current-baseline'], ['--skip-evidence'], [`--expected-commit=${commit}`]]) assert.throws(() => parseHotfixArgs([...args, ...extra]));
  assert.throws(() => parseHotfixArgs(args.filter(a => !a.startsWith('--expected-commit'))));
});

test('requires actual backup identity/decode and rollback evidence, never turning scoped archive inspection into full restore', () => {
  assert.equal(validate(evidenceFixture()).evidenceSha256.length, 64);
  for (const change of [
    value => { value.actualSourceCapture = false; }, value => { value.sourceIdentity.readOnly = false; },
    value => { value.sourceIdentity.systemIdentifier = '8000000000000000001'; },
    value => { value.inspection.archiveDecodePassed = false; }, value => { value.storageBytesCaptured = true; },
    value => { value.currentBaselineReleaseEvidence = true; },
  ]) { const f = evidenceFixture(); changeRaw(f, 'backup', change); assert.throws(() => validate(f)); }
  const f = evidenceFixture(); changeRaw(f, 'rollback', value => { value.afterRollbackDataSha256 = 'c'.repeat(64); });
  assert.throws(() => validate(f), { code: 'ROLLBACK_NOT_PROVEN' });
  const changed = evidenceFixture(); changed.raw.rollbackOriginal += 'changed';
  assert.throws(() => validate(changed), { code: 'ROLLBACK_ORIGINAL_MISSING' });
});

test('a real hosted target, exact SQL bodies, two connections, fence and CLI dry-run are separate mandatory evidence', () => {
  for (const [kind, update] of [
    ['hosted', v => { v.databaseEngine = 'PGlite'; }], ['hosted', v => { v.executedMigrations[0].sha256 = hash; }],
    ['hosted', v => { v.checks.pop(); }], ['concurrency', v => { v.cases[0].connections = ['one', 'one']; }],
    ['concurrency', v => { v.cases[0].contenderSqlstate = '40001'; }],
    ['concurrency', v => { v.cases[1].contenderSuccess = true; }],
    ['concurrency', v => { v.cases[1].contenderErrorCode = 'unrelated_error'; }],
    ['concurrency', v => { v.cases[1].unintendedWrites = 1; }], ['fence', v => { v.existingRequestsDrained = false; }],
    ['fence', v => { v.webWriteStatus = 200; }], ['dryRun', v => { v.stdout += '\n20260701000000_unreviewed.sql'; }],
  ]) { const f = evidenceFixture(); changeRaw(f, kind, update); assert.throws(() => validate(f)); }
  const f = evidenceFixture(); f.reports.hosted.targetProjectRef = release.hotfix.projectRef;
  assert.throws(() => validate(f), { code: 'HOSTED_TARGET_INVALID' });
});

test('before-schema/ledger/old public rows and fresh evidence cannot be replaced by a changed same-size snapshot', () => {
  for (const change of [
    f => { f.evidence.before.objects[0].sha256 = hash; }, f => { f.evidence.before.ledger[0].name = 'changed'; },
    f => { f.evidence.beforeData.pop(); }, f => { f.evidence.expiresAt = '2026-09-07T04:00:00Z'; },
    f => { f.evidence.scope.fullDatabaseRestoreVerified = true; },
    f => { f.evidence.transitions[0].identity = 'auth.users'; },
  ]) { const f = evidenceFixture(); f.evidence.scope = { ...f.evidence.scope }; change(f); assert.throws(() => validate(f)); }
});

async function localFixture({ searchPathProbe = false } = {}) {
  const db = await localPredecessor(historical.root, root);
  try {
    await db.exec(`CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid,bucket_id text,name text); CREATE TABLE storage.buckets(id text);
      CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid); CREATE SCHEMA cron; CREATE TABLE cron.job(jobid bigint,active boolean);
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      INSERT INTO supabase_migrations.schema_migrations VALUES('20260902120000','synthetic_predecessor',ARRAY['SELECT 1;']);
      CREATE ROLE cli_login_postgres LOGIN VALID UNTIL '2026-09-07T00:00:00Z';
      CREATE ROLE cli_login_supabase_read_only_user LOGIN VALID UNTIL '2026-09-07T00:00:00Z';
      INSERT INTO public.community_posts(id,title,content,upvote_count,comment_count) VALUES('60907000-0000-4000-8000-000000000050','ORIGINAL TITLE','ORIGINAL BODY',4,2);`);
    await db.exec(readFileSync(join(historical.root, 'supabase/platform-operations/security/20260717120000_production_write_fence_apply.sql'), 'utf8'));
    if (searchPathProbe) await db.exec(`CREATE SCHEMA extensions;
      CREATE FUNCTION extensions.synthetic_marker() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'synthetic'::text $$;
      ALTER TABLE public.profiles ADD COLUMN path_probe text DEFAULT extensions.synthetic_marker();
      SET search_path=pg_catalog,public;`);
    const observe = async () => {
      const previous = (await db.query('SHOW search_path')).rows[0].search_path;
      await db.query("SELECT set_config('search_path','pg_catalog,public',false)");
      try { return (await db.query(`${release.inventorySelect};`)).rows[0].observation; }
      finally { await db.query("SELECT set_config('search_path',$1,false)", [previous]); }
    };
    const before = await observe();
    const data = (await db.query(`${renderPublicDataQuery(before)};`)).rows[0].data;
    await db.exec('BEGIN');
    for (const m of release.migrations) await db.exec(transactionBody(m.sql.toString('utf8')));
    const after = await observe(); await db.exec('ROLLBACK');
    const transitions = after.objects.filter(row => before.objects.find(o => o.kind === row.kind && o.identity === row.identity)?.sha256 !== row.sha256)
      .map(row => ({ kind: row.kind, identity: row.identity, beforeSha256: before.objects.find(o => o.kind === row.kind && o.identity === row.identity)?.sha256 ?? null, afterSha256: row.sha256 }));
    const local = { ...release, hotfix: { ...release.hotfix, systemIdentifier: before.systemIdentifier, requiredLedgerCount: before.ledger.length } };
    const evidence = { releaseCommit: commit, before, beforeData: data, transitions };
    await db.exec(`INSERT INTO public.production_release_lease_20260717(singleton,release_id,release_commit,owner_id,outcome_path_sha256,phase)
      VALUES(true,'${binding.release}','${commit}','${owner}','${hash}','claimed');`);
    return { db, release: local, evidence, binding, deadlineMs: Date.now() + 60_000, observe };
  } catch (error) { await db.close(); throw error; }
}

test('one actual PostgreSQL transaction executes eight original SQLs plus exact original-source ledger and preserves existing rows', { timeout: 120000 }, async () => {
  const f = await localFixture();
  try {
    const sql = renderHotfixAtomicSql(f);
    await f.db.exec(sql);
    const ledger = (await f.db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
    assert.equal(ledger.length, 9);
    for (const [i, m] of release.migrations.entries()) assert.deepEqual(ledger[i + 1], { version: m.version, name: m.file.slice(15, -4), statements: [m.sql.toString('utf8')] });
    assert.deepEqual((await f.db.query(`${renderPublicDataQuery(f.evidence.before)};`)).rows[0].data, f.evidence.beforeData);
    const post = (await f.db.exec(renderHotfixAdjudicationSql(f))).flatMap(result => result.rows ?? []);
    assert.equal(classifyHotfixObservation({ rows: post, release: f.release, binding }), 'committed-lease-held');
    const fence = await f.db.query("SELECT count(*)::integer AS n FROM pg_trigger WHERE tgname='trg_production_write_fence_20260717' AND NOT tgisinternal");
    assert.equal(fence.rows[0].n, f.evidence.before.relations.filter(r => r.schema === 'public' && ['r', 'p'].includes(r.kind)).length + 3);
  } finally { await f.db.close(); }
});

test('actual apply and finalizer normalize catalog deparsing without altering the incoming session search path', { timeout: 120000 }, async () => {
  const f = await localFixture({ searchPathProbe: true });
  try {
    await f.db.exec('SET search_path=pg_catalog,public,extensions');
    const unnormalized = (await f.db.query(`${release.inventorySelect};`)).rows[0].observation;
    assert.notEqual(unnormalized.objects.find(o => o.identity === 'public.profiles').sha256,
      f.evidence.before.objects.find(o => o.identity === 'public.profiles').sha256);
    await f.db.exec(renderHotfixAtomicSql(f));
    assert.equal((await f.db.query('SHOW search_path')).rows[0].search_path, 'pg_catalog, public, extensions');
    const result = await f.db.exec(renderHotfixFinalizeSql({ ...f, canarySha256: hash }));
    assert.equal(result.flatMap(r => r.rows ?? []).at(-1).hotfix_finalized_count, 1);
    assert.equal((await f.db.query('SHOW search_path')).rows[0].search_path, 'pg_catalog, public, extensions');
  } finally { await f.db.close(); }
});

test('a last invariant failure really rolls back all eight schema/ledger writes and preserves claimed owner and original data', { timeout: 120000 }, async () => {
  const f = await localFixture();
  try {
    const before = await f.observe();
    const lastTransition = f.evidence.transitions.at(-1); lastTransition.afterSha256 = hash;
    await assert.rejects(f.db.exec(renderHotfixAtomicSql(f)), /HOTFIX_AFTER_SCHEMA_DRIFT/);
    await f.db.exec('ROLLBACK');
    const after = await f.observe();
    assert.deepEqual(after.objects, before.objects); assert.deepEqual(after.ledger, before.ledger);
    assert.equal((await f.db.query('SELECT phase FROM public.production_release_lease_20260717')).rows[0].phase, 'claimed');
    assert.deepEqual((await f.db.query(`${renderPublicDataQuery(f.evidence.before)};`)).rows[0].data, f.evidence.beforeData);
  } finally { await f.db.close(); }
});

test('wrong owner and changed original row are rejected by SQL before any migration is recorded', { timeout: 120000 }, async () => {
  const f = await localFixture();
  try {
    const wrong = { ...f, binding: { ...binding, ownerId: '60907000-aaaa-4aaa-8aaa-123456789abc' } };
    await assert.rejects(f.db.exec(renderHotfixAtomicSql(wrong)), /HOTFIX_OWNER_OR_PHASE_CHANGED/); await f.db.exec('ROLLBACK');
    await f.db.exec("UPDATE public.community_posts SET content='CHANGED WHILE WAITING'");
    await assert.rejects(f.db.exec(renderHotfixAtomicSql(f)), /HOTFIX_EXISTING_ROWS_CHANGED/); await f.db.exec('ROLLBACK');
    assert.equal((await f.db.query('SELECT count(*)::integer AS n FROM supabase_migrations.schema_migrations')).rows[0].n, 1);
  } finally { await f.db.close(); }
});

test('adjudication never calls empty ledger rollback-success and binds exact owner, phase, commit, original statements and count', () => {
  const good = { system_identifier: release.hotfix.systemIdentifier, owner_count: 1, exact_migration_count: 8,
    ledger_count: 214, owner_id: owner, release_commit: commit, phase: 'deployment-canary' };
  assert.equal(classifyHotfixObservation({ rows: [good], release, binding }), 'committed-lease-held');
  for (const update of [{ exact_migration_count: 0 }, { exact_migration_count: 7 }, { phase: 'claimed' }, { owner_count: 0 },
    { owner_id: 'other' }, { release_commit: 'c'.repeat(40) }, { ledger_count: 215 }]) {
    assert.equal(classifyHotfixObservation({ rows: [{ ...good, ...update }], release, binding }), 'ambiguous');
  }
});

test('Management API uses only the pinned destination, no redirects, and never exposes tokens/SQL/API error detail', async () => {
  const secret = 'SYNTHETIC_PAT_MUST_NEVER_APPEAR'; const calls = [];
  const transport = createManagementHotfixTransport({ accessToken: secret, projectRef: release.hotfix.projectRef, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return { ok: true, text: async () => JSON.stringify([{ verified: true }]) };
  } });
  assert.deepEqual(await transport.query('BEGIN READ ONLY; SELECT 1; COMMIT;'), [{ verified: true }]);
  assert.equal(calls[0].url, 'https://api.supabase.com/v1/projects/slrtobkksjmxgzatjyqb/database/query');
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(JSON.parse(calls[0].init.body).read_only, false);
  for (const fetchImpl of [async () => { throw new Error(secret); }, async () => ({ ok: false, text: async () => secret }),
    async () => ({ ok: true, text: async () => JSON.stringify({ error: secret }) })]) {
    const bad = createManagementHotfixTransport({ accessToken: secret, projectRef: release.hotfix.projectRef, fetchImpl });
    await assert.rejects(bad.query('SYNTHETIC PRIVATE SQL', { readOnly: false }), error => !String(error).includes(secret) && error.code.startsWith('MANAGEMENT_'));
  }
  assert.throws(() => createManagementHotfixTransport({ accessToken: secret, projectRef: 'abcdefghijklmnopqrst' }));
});

test('postgres API selector accepts only a complete read-only transaction and rejects transaction escape before sending', async () => {
  const calls = [];
  const transport = createManagementHotfixTransport({ accessToken: 'SYNTHETIC_MANAGEMENT_TOKEN', projectRef: release.hotfix.projectRef,
    fetchImpl: async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, text: async () => '[]' }; } });
  for (const sql of ['SELECT 1;', 'BEGIN; SELECT 1; COMMIT;', 'BEGIN READ ONLY; SELECT 1; COMMIT; SELECT 2;',
    'BEGIN READ ONLY; /* outer /* inner */ tail */ COMMIT; INSERT INTO public.example VALUES(1); COMMIT;',
    'BEGIN READ ONLY; ROLLBACK; BEGIN; SELECT 1; COMMIT;']) {
    await assert.rejects(transport.query(sql), error => error.code === 'MANAGEMENT_READ_ONLY_ENVELOPE_REQUIRED');
  }
  assert.equal(calls.length, 0);
  await transport.query("BEGIN TRANSACTION READ ONLY; SELECT 'COMMIT; ROLLBACK;' AS harmless; COMMIT;");
  assert.equal(calls.length, 1); assert.equal(calls[0].read_only, false);
});

test('actual PostgreSQL keeps the postgres connection read-only even if inner SQL tries to switch transaction access', async () => {
  const { PGlite } = createRequire(join(root, 'apps/web/package.json'))('@electric-sql/pglite');
  const db = await PGlite.create(); const sqlstates = [];
  const transport = createManagementHotfixTransport({ accessToken: 'SYNTHETIC_MANAGEMENT_TOKEN', projectRef: release.hotfix.projectRef,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); assert.equal(body.read_only, false);
      try { const results = await db.exec(body.query); return { ok: true, text: async () => JSON.stringify(results.flatMap(r => r.rows ?? [])) }; }
      catch (error) { sqlstates.push(error.code); await db.exec('ROLLBACK'); return { ok: false, text: async () => 'not disclosed' }; }
    } });
  try {
    await db.exec('CREATE TABLE public.readonly_target(id integer)');
    const rows = await transport.query("BEGIN READ ONLY; SELECT current_user AS actor,current_setting('transaction_read_only') AS readonly; COMMIT;");
    assert.deepEqual(rows, [{ actor: 'postgres', readonly: 'on' }]);
    for (const change of ['SET TRANSACTION READ WRITE;', "SELECT set_config('transaction_read_only','off',true);"])
      await assert.rejects(transport.query(`BEGIN READ ONLY; ${change} INSERT INTO public.readonly_target VALUES(1); COMMIT;`), /MANAGEMENT_QUERY_UNCONFIRMED/);
    await assert.rejects(transport.query('BEGIN READ ONLY; INSERT INTO public.readonly_target VALUES(2); COMMIT;'), /MANAGEMENT_QUERY_UNCONFIRMED/);
    assert.deepEqual(sqlstates, ['25001', '25001', '25006']);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.readonly_target')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('fresh managed-partition supplement permits exactly one addition, one removal and the publication while preserving app, role and grant fingerprints', () => {
  const original = loadCurrentBaselineContract(historical.root).baseline;
  const args = { original, current: release.baseline, delta: release.hotfix.baselineDelta, contract: release.contract };
  assert.doesNotThrow(() => validateHotfixOperatingBaseline(args));
  for (const change of [
    value => { value.objects.find(o => o.kind === 'role').sha256 = hash; },
    value => { value.objects.find(o => o.kind === 'publication').sha256 = hash; },
    value => { value.relations.push({ schema: 'realtime', name: 'extra_partition', kind: 'r' }); },
    value => { value.ledger[0].name = 'repaired'; },
  ]) {
    const current = structuredClone(release.baseline); change(current);
    assert.throws(() => validateHotfixOperatingBaseline({ ...args, current }));
  }
  for (const relationsRemoved of [[], [{ schema: 'public', name: 'profiles', kind: 'r' }]])
    assert.throws(() => validateHotfixOperatingBaseline({ ...args, delta: { ...args.delta, relationsRemoved } }));
});

test('native receipt exact server types and uppercase digest are preserved; all evidence deadlines bound the transaction', () => {
  const f = evidenceFixture(); const before = f.raw.backup;
  validate(f); assert.equal(f.raw.backup, before);
  for (const value of [true, false, 'off']) {
    const changed = evidenceFixture(); changeRaw(changed, 'backup', b => { b.sourceIdentity.readOnly = value; });
    assert.throws(() => validate(changed), { code: 'BACKUP_SOURCE_MISMATCH' });
  }
  for (const version of ['17.6', 160006, 180000, 170000.5]) {
    const changed = evidenceFixture(); changeRaw(changed, 'backup', b => { b.sourceIdentity.serverVersion = version; });
    assert.throws(() => validate(changed), { code: 'BACKUP_SOURCE_MISMATCH' });
  }
  for (const kind of ['dryRun', 'hosted', 'rollback', 'concurrency']) {
    const changed = evidenceFixture();
    const expiry = now.getTime() + 500;
    changed.reports[kind].verifiedAt = new Date(expiry - (kind === 'dryRun' ? 30 * 60_000 : 24 * 3600_000)).toISOString();
    assert.equal(validate(changed).deadlineMs, expiry);
  }
  const changed = evidenceFixture(); changeRaw(changed, 'rollback', r => { r.sourceArchiveRestored = true; });
  assert.throws(() => validate(changed), { code: 'ROLLBACK_NOT_PROVEN' });
});

function canaryFixture() {
  const outcome = { ...binding, verifiedAt: '2026-09-07T04:40:00Z' };
  const deployment = { id: 'dpl_syntheticHotfixRelease01', team: { id: 'team_XwMZqiJ4wXM2Ypvs99icXaQx' },
    ownerId: 'team_XwMZqiJ4wXM2Ypvs99icXaQx', projectId: 'prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes',
    target: 'production', readyState: 'READY', meta: { githubCommitSha: commit }, alias: ['hanbang.ai'], url: 'synthetic.vercel.app',
    createdAt: Date.parse('2026-09-07T04:20:00Z'), ready: Date.parse('2026-09-07T04:30:00Z') };
  const observation = (path, method, status, data) => ({ host: 'hanbang.ai', observedAt: '2026-09-07T04:48:00Z', path, method, status, ...data });
  const http = { format: 'amora-hotfix-http-observations-v1', releaseCommit: commit, deploymentId: deployment.id, productionHost: 'hanbang.ai',
    startedAt: '2026-09-07T04:45:00Z', finishedAt: '2026-09-07T04:55:00Z', observations: [
      observation('/api/health', 'GET', 200, { body: { ok: true, database: 'up', commit: commit.slice(0, 12) } }),
      observation('/landing', 'GET', 200, { bodySha256: hash, renderedLanding: true }),
      observation('/api/community/posts?sort=hot&page=1', 'GET', 200, { bodySha256: hash, postsArrayVerified: true }),
      observation('/api/amora/notes', 'GET', 200, { bodySha256: hash, syntheticActorSha256: hash, authenticatedNotesArrayVerified: true }),
      observation('/api/release/write-fence-probe', 'POST', 503, { body: { error: 'production_write_fence_enabled' }, deploymentCommitHeader: commit }),
    ], serverErrors: { deploymentId: deployment.id, from: '2026-09-07T04:45:00Z', to: '2026-09-07T04:55:00Z', count: 0, rawEvidenceSha256: hash } };
  const make = () => {
    const deploymentRaw = JSON.stringify(deployment), httpRaw = JSON.stringify(http);
    return { canary: { format: 'amora-runtime-hotfix-canary-v1', releaseCommit: commit, ownerId: owner, outcomeSha256: digestJson(outcome),
      migrationSetSha256: release.migrationSetSha256, deploymentId: deployment.id,
      deploymentRaw: { file: 'deployment.raw.json', sha256: digest(deploymentRaw) }, httpRaw: { file: 'http.raw.json', sha256: digest(httpRaw) } },
    deploymentRaw, httpRaw, outcome, release, now };
  };
  return { deployment, http, outcome, make };
}

test('finalization has a distinct strict CLI and requires exact production deployment, owner, live read canaries and held write fence', () => {
  const argv = ['--amora-runtime-hotfix', '--finalize', `--expected-commit=${commit}`, '--remote-ref=origin/codex/test',
    `--evidence-root=${cliFixtureRoot}`, `--outcome=${join(cliFixtureRoot, 'apply.json')}`, `--canary=${join(cliFixtureRoot, 'canary.json')}`,
    `--receipt-out=${join(cliFixtureRoot, 'final.json')}`, '--confirm-production=explicit'];
  assert.equal(parseHotfixFinalizeArgs(argv).finalize, true);
  for (const extra of ['--apply', '--check-only', '--skip-auth', '--finalize']) assert.throws(() => parseHotfixFinalizeArgs([...argv, extra]));
  const f = canaryFixture(); assert.equal(validateHotfixCanary(f.make()).deadlineMs, Date.parse('2026-09-07T05:10:00Z'));
  assert.equal(f.deployment.teamId, undefined);
  assert.equal(validateHotfixCanary(f.make()).providerSourceSha256, digest(JSON.stringify(f.deployment)));
  for (const mutate of [
    f => { f.deployment.target = 'preview'; }, f => { f.deployment.alias = ['different.example']; },
    f => { f.deployment.team.id = 'team_other'; }, f => { f.deployment.ownerId = 'team_other'; },
    f => { f.deployment.meta.githubCommitSha = 'c'.repeat(40); }, f => { f.http.observations[0].body.commit = 'old'; },
    f => { f.http.observations[3].authenticatedNotesArrayVerified = false; }, f => { f.http.observations[4].status = 200; },
    f => { f.http.serverErrors.count = 1; }, f => { f.http.startedAt = f.outcome.verifiedAt = '2026-09-07T04:54:00Z'; },
  ]) { const changed = canaryFixture(); mutate(changed); assert.throws(() => validateHotfixCanary(changed.make())); }
  const changed = f.make(); changed.canary.ownerId = 'different';
  assert.throws(() => validateHotfixCanary(changed), { code: 'CANARY_BINDING_INVALID' });
});

test('actual SQL finalizer removes only exact known fences and own lease after preserving eight source ledgers and original rows', { timeout: 120000 }, async () => {
  const f = await localFixture();
  try {
    await f.db.exec(renderHotfixAtomicSql(f));
    const result = await f.db.exec(renderHotfixFinalizeSql({ ...f, canarySha256: hash }));
    assert.deepEqual(result.flatMap(r => r.rows ?? []).at(-1), { hotfix_finalized_count: 1, owner_id: owner, release_commit: commit, canary_sha256: hash });
    assert.equal((await f.db.query("SELECT to_regclass('public.production_release_lease_20260717') AS lease")).rows[0].lease, null);
    assert.equal((await f.db.query("SELECT count(*)::integer AS n FROM pg_event_trigger WHERE evtname LIKE 'evt_production_write_fence%'")).rows[0].n, 0);
    assert.equal((await f.db.query('SELECT count(*)::integer AS n FROM supabase_migrations.schema_migrations')).rows[0].n, 9);
    assert.deepEqual((await f.db.query(`${renderPublicDataQuery(f.evidence.before)};`)).rows[0].data, f.evidence.beforeData);
    assert.ok((await f.db.query("SELECT to_regclass('public.amora_personal_actions') AS actions")).rows[0].actions);
  } finally { await f.db.close(); }
});

test('finalizer wrong owner, original-ledger tampering, and changed row leave all fences and the lease intact', { timeout: 120000 }, async () => {
  const f = await localFixture();
  try {
    await f.db.exec(renderHotfixAtomicSql(f));
    await assert.rejects(f.db.exec(renderHotfixFinalizeSql({ ...f, canarySha256: hash,
      binding: { ...binding, ownerId: '60907000-aaaa-4aaa-8aaa-123456789abc' } })), /HOTFIX_FINALIZER_OWNER_OR_PHASE/);
    await f.db.exec('ROLLBACK');
    await f.db.exec('BEGIN');
    await f.db.exec("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['TAMPERED'] WHERE version='20260902120000'");
    await assert.rejects(f.db.exec(renderHotfixFinalizeSql({ ...f, canarySha256: hash })), /HOTFIX_ORIGINAL_LEDGER_CHANGED/);
    await f.db.exec('ROLLBACK');
    await f.db.exec('BEGIN'); await f.db.exec("UPDATE public.community_posts SET content='CONCURRENT ORIGINAL CHANGE'");
    await assert.rejects(f.db.exec(renderHotfixFinalizeSql({ ...f, canarySha256: hash })), /HOTFIX_EXISTING_ROWS_CHANGED/);
    await f.db.exec('ROLLBACK');
    assert.equal((await f.db.query('SELECT phase FROM public.production_release_lease_20260717')).rows[0].phase, 'deployment-canary');
    assert.equal((await f.db.query("SELECT count(*)::integer AS n FROM pg_event_trigger WHERE evtname LIKE 'evt_production_write_fence%'")).rows[0].n, 2);
  } finally { await f.db.close(); }
});

test('an error after fence removal is still inside the transaction and restores fence triggers and exact lease', { timeout: 120000 }, async () => {
  const f = await localFixture();
  try {
    await f.db.exec(renderHotfixAtomicSql(f));
    const sql = renderHotfixFinalizeSql({ ...f, canarySha256: hash });
    const delayed = sql.replace("DO $deadline$ BEGIN IF", "DO $deadline$ BEGIN RAISE EXCEPTION 'SYNTHETIC_LATE_FAILURE'; IF");
    assert.notEqual(sql, delayed);
    await assert.rejects(f.db.exec(delayed), /SYNTHETIC_LATE_FAILURE/); await f.db.exec('ROLLBACK');
    assert.equal((await f.db.query('SELECT owner_id,phase FROM public.production_release_lease_20260717')).rows[0].owner_id, owner);
    assert.equal((await f.db.query("SELECT count(*)::integer AS n FROM pg_event_trigger WHERE evtname LIKE 'evt_production_write_fence%'")).rows[0].n, 2);
    assert.deepEqual((await f.db.query(`${renderPublicDataQuery(f.evidence.before)};`)).rows[0].data, f.evidence.beforeData);
  } finally { await f.db.close(); }
});

test('wrong claim and lost apply response write durable adjudication, throw, and never retry or unfence', async () => {
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
      const argv = ['--amora-runtime-hotfix', '--apply', `--expected-commit=${commit}`, '--remote-ref=origin/codex/test',
        `--evidence-root=${folder}`, `--receipt-out=${receipt}`, `--bundle-out=${join(folder, 'bundle.sql')}`,
        `--confirm-production=APPLY:${release.hotfix.projectRef}:${release.hotfix.release}:${commit}`];
      await assert.rejects(runAmoraRuntimeHotfix({ repoRoot: historical.root, argv, now: () => now, verifyRecovery: async () => true,
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

test('the embedded recovery verifier requires matching Windows release pins before parsing', async t => {
  if (!await releaseHostHasPinnedBytes()) {
    await assert.rejects(resolvePinnedWindowsProductionToolchain(), { code: 'PRODUCTION_TOOLCHAIN_INVALID' });
    t.diagnostic('Host release pins do not match: refusal verified; the recovery program was not parsed or executed.');
    return;
  }
  const source = readFileSync(join(root, 'scripts/lib/amora-runtime-hotfix-controller.mjs'), 'utf8');
  const script = source.match(/const program = `([\s\S]+?)`;\r?\n  const backup/);
  assert.ok(script);
  const toolchain = await resolvePinnedWindowsProductionToolchain();
  const parser = "$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$tokens,[ref]$errors);[Console]::Out.Write($errors.Count)";
  const result = spawnSync(toolchain.powershell, ['-NoProfile', '-NonInteractive', '-Command', parser], {
    windowsHide: true, encoding: 'utf8', input: script[1], timeout: 10000,
  });
  assert.equal(result.status, 0); assert.equal(result.stdout, '0');
});

test('reused hosted evidence verifies exact Git blobs on a pinned host and otherwise refuses before execution', async t => {
  const f = evidenceFixture(), sourceCommit = 'c'.repeat(40);
  for (const kind of ['rollback', 'hosted', 'concurrency']) {
    changeRaw(f, kind, raw => { raw.releaseCommit = sourceCommit; });
    f.reports[kind].sourceReleaseCommit = sourceCommit;
  }
  validate(f);
  const commands = [];
  const runCommand = async (_program, args) => {
    commands.push(args);
    const migration = release.migrations.find(m => args[3] === `${sourceCommit}:supabase/migrations/${m.file}`);
    return { status: 0, stdout: migration.sql.toString('utf8'), signal: null, timedOut: false, outputTruncated: false };
  };
  if (!await releaseHostHasPinnedBytes()) {
    await assert.rejects(verifyHotfixSourceLineage({ repoRoot: root, state: f, release, runCommand }), { code: 'PRODUCTION_TOOLCHAIN_INVALID' });
    assert.equal(commands.length, 0);
    t.diagnostic('Host release pins do not match: refusal verified; successful Git lineage execution was not exercised on this host.');
    return;
  }
  await verifyHotfixSourceLineage({ repoRoot: root, state: f, release, runCommand });
  assert.equal(commands.length, 8); assert.ok(commands.every(args => args[0] === '--no-replace-objects'));
  assert.equal(JSON.parse(f.raw.hosted).releaseCommit, sourceCommit);
  for (const changed of [
    { status: 0, stdout: 'DIFFERENT SQL' }, { status: 1, stdout: release.migrations[0].sql.toString('utf8') },
    { status: 0, stdout: release.migrations[0].sql.toString('utf8'), outputTruncated: true },
  ]) await assert.rejects(verifyHotfixSourceLineage({ repoRoot: root, state: f, release, runCommand: async () => changed }), { code: 'SOURCE_LINEAGE_MIGRATION_CHANGED' });

});

test('reused hosted evidence rejects an omitted source commit binding on every platform', () => {
  const omitted = evidenceFixture();
  changeRaw(omitted, 'hosted', raw => { raw.releaseCommit = 'c'.repeat(40); });
  assert.throws(() => validate(omitted), { code: 'HOSTED_RAW_BINDING_INVALID' });
});
