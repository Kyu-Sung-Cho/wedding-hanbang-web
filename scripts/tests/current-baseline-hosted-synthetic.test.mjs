import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, digestJson, loadCurrentBaselineContract } from '../lib/current-baseline-release-contract.mjs';
import { transactionBody, validateTargetPlan, validatedConnectionConfig, runHostedSynthetic, inventoryFingerprint } from '../lib/current-baseline-hosted-synthetic.mjs';
import { syntheticIds } from '../lib/current-baseline-hosted-synthetic-scenarios.mjs';
import { localPredecessor, localCatalog, localObservation } from './fixtures/current-baseline-hosted-synthetic-local.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const release = loadCurrentBaselineContract(root);
const commit = 'a'.repeat(40); const now = new Date('2026-09-07T00:00:00Z');
const systemIdentifier = '8000000000000000001';
const ref = 'abcdefghijklmnopqrst';
const namespace = '60907000-1234-4123-8123-123456789abc';
const plan = () => ({ format: 'current-baseline-hosted-synthetic-target-v1', projectRef: ref, systemIdentifier,
  releaseCommit: commit, contractSha256: release.contractSha256, migrationSetSha256: release.migrationSetSha256,
  inventorySha256: 'b'.repeat(64), namespace, approvedAt: '2026-09-06T23:59:00Z', expiresAt: '2026-09-07T01:00:00Z',
  isolatedSyntheticTarget: true, isolationEvidenceSha256: 'c'.repeat(64) });

test('rejects production ref/system identity, stale approval, wrong release and arbitrary UUID namespace before any SQL', () => {
  assert.equal(validateTargetPlan(plan(), release, { commit, now }).projectRef, ref);
  for (const [change, code] of [
    [{ projectRef: release.contract.projectRef }, 'PRODUCTION_TARGET_FORBIDDEN'],
    [{ systemIdentifier: release.contract.systemIdentifier }, 'PRODUCTION_SYSTEM_FORBIDDEN'],
    [{ releaseCommit: 'd'.repeat(40) }, 'RELEASE_COMMIT_MISMATCH'],
    [{ migrationSetSha256: 'd'.repeat(64) }, 'RELEASE_PIN_MISMATCH'],
    [{ expiresAt: '2026-09-06T23:00:00Z' }, 'TARGET_APPROVAL_EXPIRED'],
    [{ namespace: '00000000-1234-4123-8123-123456789abc' }, 'SYNTHETIC_NAMESPACE_INVALID'],
    [{ isolatedSyntheticTarget: false }, 'TARGET_ISOLATION_EVIDENCE_REQUIRED'],
  ]) assert.throws(() => validateTargetPlan({ ...plan(), ...change }, release, { commit, now }), { code });
  const ids = syntheticIds(namespace); assert.equal(new Set(Object.values(ids)).size, Object.keys(ids).length);
  assert.ok(Object.values(ids).every(id => id.startsWith('60907000-')));
});

test('requires target-bound direct/session TLS and never accepts production, transaction pooler or URL TLS overrides', () => {
  const ca = '-----BEGIN CERTIFICATE-----\nSYNTHETIC NOT A CERT\n-----END CERTIFICATE-----';
  const target = { ...plan(), tlsCaSha256: digest(ca) };
  const connection = validatedConnectionConfig(`postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres`, ca, target, release.contract.projectRef);
  assert.equal(connection.ssl.rejectUnauthorized, true);
  assert.equal(validatedConnectionConfig(`postgres://postgres.${ref}:synthetic@aws-0-test.pooler.supabase.com:5432/postgres`, ca, target, release.contract.projectRef).ssl.ca, ca);
  for (const url of [
    `postgres://postgres:synthetic@db.${release.contract.projectRef}.supabase.co:5432/postgres`,
    `postgres://postgres.${ref}:synthetic@aws-0-test.pooler.supabase.com:6543/postgres`,
    `postgres://postgres:synthetic@db.${ref}.supabase.co:5432/postgres?sslmode=disable`,
    'postgres://postgres:synthetic@localhost:5432/postgres',
    `postgres://postgres:synthetic@db.${ref}.supabase.co.attacker.invalid:5432/postgres`,
  ]) assert.throws(() => validatedConnectionConfig(url, ca, target, release.contract.projectRef));
  assert.throws(() => validatedConnectionConfig(connection.connectionString, `${ca}changed`, target, release.contract.projectRef), { code: 'DATABASE_CA_PIN_MISMATCH' });
});

test('removes only outer migration transactions while keeping quoted function blocks and rejecting transaction escapes', () => {
  const sql = `-- preface\nBEGIN; CREATE FUNCTION synthetic() RETURNS text LANGUAGE plpgsql AS $fn$ BEGIN RETURN 'COMMIT;'; END; $fn$; COMMIT;`;
  const body = transactionBody(sql);
  assert.ok(body.includes("BEGIN RETURN 'COMMIT;'; END; $fn$"));
  assert.ok(!body.endsWith('COMMIT;'));
  for (const sql of ['BEGIN; SELECT 1; COMMIT; BEGIN; SELECT 2; COMMIT;', 'BEGIN; SELECT 1; END;',
    'BEGIN; PREPARE TRANSACTION \'escape\'; COMMIT;', 'BEGIN; ROLLBACK; COMMIT;', 'BEGIN; CALL untrusted(); COMMIT;',
    '/* outer /* inner */ tail */ COMMIT;',
    'BEGIN; SELECT 1; /* outer /* inner */ tail */ COMMIT; SELECT 2; COMMIT;',
    "BEGIN; PREPARE /* comment */ TRANSACTION 'escape'; COMMIT;",
    "BEGIN; SELECT 'unfinished; COMMIT;", 'BEGIN; /* unfinished']) assert.throws(() => transactionBody(sql));
  for (const migration of release.migrations) assert.doesNotThrow(() => transactionBody(migration.sql.toString('utf8')));
});

test('executes all eight pinned original migrations and real SQL owner/budget/mediation checks, then restores the predecessor', { timeout: 120000 }, async () => {
  const db = await localPredecessor(root);
  const adapter = { query: async (sql, values) => sql === 'LOCAL_ONLY_ACTUAL_CATALOG'
    ? { rows: [{ observation: await localObservation(db) }] }
    : values === undefined ? (await db.exec(sql)).at(-1) : db.query(sql, values) };
  try {
    await db.exec(`CREATE TABLE public.synthetic_preexisting(id integer PRIMARY KEY,payload jsonb); INSERT INTO public.synthetic_preexisting VALUES(1,'{"kept":"SYNTHETIC PREEXISTING"}');`);
    const before = await localCatalog(db);
    const observation = await localObservation(db);
    const target = { ...plan(), systemIdentifier: observation.systemIdentifier, inventorySha256: inventoryFingerprint(observation) };
    const report = await runHostedSynthetic({ db: adapter, release, plan: target, commit, now, inventorySql: 'LOCAL_ONLY_ACTUAL_CATALOG' });
    assert.equal(report.status, 'passed-rollback-rehearsal-only', report.failureCode);
    assert.equal(report.migrations.length, 8); assert.equal(report.rollback.verified, true);
    assert.notEqual(report.proposedSchemaSha256, report.beforeSchemaSha256);
    const checks = report.checks;
    assert.equal(checks.length, 7); assert.ok(checks.every(row => row.status === 'passed' && row.rawEvidenceSha256 === digestJson(row.observed)));
    assert.equal(checks.find(row => row.name === 'budgetEnginePreservesOmittedAllocations').observed.reserve, 24000000);
    assert.equal(checks.find(row => row.name === 'personalOwnerPrivacyAndExactReceipt').observed.partnerReadCount, 0);
    assert.deepEqual(await localCatalog(db), before);
    assert.deepEqual((await db.query('SELECT * FROM public.synthetic_preexisting')).rows, [{ id: 1, payload: { kept: 'SYNTHETIC PREEXISTING' } }]);
    assert.deepEqual((await db.query('SELECT id FROM auth.users')).rows, []);
    assert.equal((await db.query("SELECT to_regclass('public.amora_personal_actions')::text AS name")).rows[0].name, null);
  } finally { await db.close(); }
});

test('a real later SQL failure rolls back earlier migration DDL and fixture writes', { timeout: 120000 }, async () => {
  const db = await localPredecessor(root);
  try {
    const before = await localCatalog(db);
    const observation = await localObservation(db);
    const adapter = { query: async (sql, values) => sql === 'LOCAL_ONLY_ACTUAL_CATALOG'
      ? { rows: [{ observation: await localObservation(db) }] }
      : values === undefined ? (await db.exec(sql)).at(-1) : db.query(sql, values) };
    const report = await runHostedSynthetic({ db: adapter, release,
      plan: { ...plan(), systemIdentifier: observation.systemIdentifier, inventorySha256: inventoryFingerprint(observation) },
      commit, now, inventorySql: 'LOCAL_ONLY_ACTUAL_CATALOG', scenarios: async (client, ids) => {
        await client.query('INSERT INTO auth.users(id) VALUES($1)', [ids.owner]);
        await client.query('SELECT 1/0');
      } });
    assert.equal(report.status, 'failed'); assert.equal(report.failureCode, 'DATABASE_SQLSTATE_22012');
    assert.equal(report.rollback.verified, true); assert.equal(report.migrations.length, 8);
    assert.deepEqual(await localCatalog(db), before);
    assert.deepEqual((await db.query('SELECT id FROM auth.users')).rows, []);
  } finally { await db.close(); }
});

function recordingDatabase({ system = systemIdentifier, failScenario = false, failRollback = false, driftAfter = false } = {}) {
  const trace = []; let observations = 0;
  const observation = { systemIdentifier, serverVersion: '17.5', objects: [{ kind: 'relation', identity: 'public.profiles', sha256: '1'.repeat(64) }],
    relations: [{ schema: 'public', name: 'profiles', kind: 'r' }], ledger: [], storageStructureSha256: '2'.repeat(64), storagePolicies: [], vaultRows: 0, cronJobs: 0 };
  return { trace, observation,
    db: { async query(sql) {
      trace.push(sql);
      if (sql.includes('pg_control_system')) return { rows: [{ system_identifier: system }] };
      if (sql.includes('pg_extension')) return { rows: [] };
      if (sql === 'INVENTORY') {
        observations++;
        return { rows: [{ observation: { ...observation, readOnly: observations !== 2,
          ledger: driftAfter && observations >= 3 ? [{ version: 'unexpected' }] : [] } }] };
      }
      if (sql.includes('pg_sequences')) return { rows: [] };
      if (sql.includes('FROM auth.users')) return { rows: [{ count: 0 }] };
      if (sql === 'ROLLBACK' && failRollback && observations >= 2) throw Object.assign(new Error('SYNTHETIC SECRET MUST NOT APPEAR'), { code: '08006' });
      return { rows: [] };
    } },
    scenarios: async () => { if (failScenario) throw Object.assign(new Error('SYNTHETIC RAW PRIVATE DETAIL'), { code: '42501', detail: 'not safe to emit' });
      return Array.from({ length: 7 }, (_, index) => ({ name: `synthetic-${index}`, status: 'passed', observed: { index }, rawEvidenceSha256: digestJson({ index }) })); },
  };
}

test('runner denies live production system identifier even behind the approved test connection before starting a transaction', async () => {
  const transport = recordingDatabase({ system: release.contract.systemIdentifier });
  const report = await runHostedSynthetic({ ...transport, release, plan: plan(), commit, now, inventorySql: 'INVENTORY' });
  assert.equal(report.failureCode, 'PRODUCTION_SYSTEM_FORBIDDEN');
  assert.ok(!transport.trace.some(sql => sql.startsWith('BEGIN'))); assert.equal(report.evidenceComplete, false);
});

test('runner checks before-schema pin, rolls back after failure and cannot certify concurrency or hosted flags', async () => {
  for (const failScenario of [false, true]) {
    const transport = recordingDatabase({ failScenario });
    const target = { ...plan(), inventorySha256: inventoryFingerprint(transport.observation) };
    const report = await runHostedSynthetic({ ...transport, release, plan: target, commit, now, inventorySql: 'INVENTORY' });
    assert.equal(report.status, failScenario ? 'failed' : 'passed-rollback-rehearsal-only');
    assert.equal(report.rollback.verified, true); assert.equal(report.evidenceComplete, false);
    assert.ok(report.missingEvidence.includes('multi-connection concurrent writes'));
    assert.ok(report.missingEvidence.includes('hosted HTTP feature-flags-off checks'));
    assert.ok(!JSON.stringify(report).includes('SYNTHETIC RAW PRIVATE DETAIL'));
    assert.ok(transport.trace.filter(sql => sql === 'ROLLBACK').length >= 3);
    assert.ok(!transport.trace.some(sql => /^COMMIT\b/i.test(sql)));
    assert.equal(report.migrations.length, release.migrations.length);
  }
  const drift = recordingDatabase();
  const blocked = await runHostedSynthetic({ ...drift, release, plan: plan(), commit, now, inventorySql: 'INVENTORY' });
  assert.equal(blocked.failureCode, 'DATABASE_BASELINE_DRIFT');
  assert.equal(blocked.migrations.length, 0);
});

test('rollback transport errors and changed ledger never become successful evidence, and SQL details are withheld', async () => {
  for (const options of [{ failRollback: true }, { driftAfter: true }]) {
    const transport = recordingDatabase(options);
    const report = await runHostedSynthetic({ ...transport, release,
      plan: { ...plan(), inventorySha256: inventoryFingerprint(transport.observation) }, commit, now, inventorySql: 'INVENTORY' });
    assert.equal(report.status, 'failed'); assert.equal(report.rollback.verified, false);
    assert.ok(['ROLLBACK_UNCONFIRMED', 'ROLLBACK_SCHEMA_OR_LEDGER_CHANGED'].includes(report.failureCode));
    assert.ok(!JSON.stringify(report).includes('SYNTHETIC SECRET MUST NOT APPEAR'));
  }
});

test('CLI help requires no connection and unrecognized arguments fail without echoing secrets', () => {
  const script = resolve(root, 'scripts/current-baseline-hosted-synthetic.mjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', cwd: root, windowsHide: true });
  assert.equal(help.status, 0); assert.ok(help.stdout.includes('NOT a completed release certificate'));
  const secret = 'SYNTHETIC_SECRET_MUST_NOT_BE_PRINTED';
  const rejected = spawnSync(process.execPath, [script, '--arbitrary-connection', secret], { encoding: 'utf8', cwd: root, windowsHide: true,
    env: { ...process.env, HANBANG_SYNTHETIC_DATABASE_URL: `postgres://user:${secret}@localhost/postgres` } });
  assert.equal(rejected.status, 1); assert.equal(JSON.parse(rejected.stderr).code, 'CLI_ARGUMENT_INVALID');
  assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes(secret));
});
