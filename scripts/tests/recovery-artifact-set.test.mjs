import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { verifyRecoveryArtifactSet, recoveryDigest as sha, assertRecoveryArchiveBytes } from '../lib/recovery-artifact-set.mjs';
import { restoreSyntheticDatabaseStage } from '../lib/recovery-database-stage.mjs';
import { storageIdentity } from '../lib/current-baseline-backup-collector.mjs';

export function artifactFixture(overrides = {}) {
  const binding = { candidate: { commit: '1'.repeat(40), tree: '2'.repeat(40) }, backupSetId: randomUUID(),
    source: { projectRef: 'syntheticlocalonly00', systemIdentifier: '7581440907192989000' }, ...overrides.binding };
  const archive = overrides.archive ?? Buffer.from('PGDMP' + 'synthetic-archive-never-executed');
  const objectBytes = Buffer.from('synthetic attachment');
  const object = { bucket: 'private', name: 'owner/file.txt', version: null, bytes: objectBytes.length,
    sha256: sha(objectBytes) }; object.identity = storageIdentity(object);
  const schema = overrides.schema ?? { format: 'current-baseline-schema-original-v1', statements: ['synthetic schema'],
    globals: { roles: [{ rolname: 'postgres' }], memberships: [] }, objects: [], ledger: [] };
  const relationBytes = Buffer.from('{"format":"current-baseline-relation-v1","identity":"public.large_id","columns":["id"],"rows":[{"id":9007199254740993}]}');
  const envelope = { format: 'postgres-exported-snapshot-archive-v1', projectRef: binding.source.projectRef,
    systemIdentifier: binding.source.systemIdentifier, releaseCommit: binding.candidate.commit,
    backupSetId: binding.backupSetId, snapshotIdentitySha256: '3'.repeat(64), archiveDecoded: true,
    databaseRestoreExecuted: false, clusterRolePasswordsCaptured: false,
    archiveBytes: archive.length, archiveSha256: sha(archive), archiveBase64: archive.toString('base64') };
  const artifacts = [
    { scope: 'database-custom-archive', bytes: Buffer.from(JSON.stringify(envelope)) },
    { scope: 'schema-original', bytes: Buffer.from(JSON.stringify(schema)) },
    { scope: 'storage-index', bytes: Buffer.from(JSON.stringify({ format: 'current-baseline-storage-index-v1', objects: [object] })) },
    { scope: 'storage:' + object.identity, bytes: Buffer.from(JSON.stringify({ format: 'current-baseline-storage-object-v1',
      identity: object.identity, bytes: object.bytes, sha256: object.sha256, base64: objectBytes.toString('base64') })) },
    ...(overrides.relations ?? [{ scope: 'relation:public.large_id', bytes: relationBytes }]),
  ];
  const refreshManifest = () => {
    const manifestBytes = Buffer.from(JSON.stringify({ format: 'full-restore-artifact-manifest-v1', ...binding,
      artifacts: artifacts.map(part => ({ scope: part.scope, bytes: part.bytes.length, sha256: sha(part.bytes) }))
        .sort((a, b) => a.scope.localeCompare(b.scope, 'en', { sensitivity: 'variant' })) }));
    // Use the producer's binary JS ordering, not locale ordering.
    const parsed = JSON.parse(manifestBytes); parsed.artifacts.sort((a, b) => a.scope < b.scope ? -1 : 1);
    const bytes = Buffer.from(JSON.stringify(parsed));
    return { manifestBytes: bytes, expectedManifestSha256: sha(bytes), binding, artifacts };
  };
  return { ...refreshManifest(), refreshManifest, object };
}

test('producer bytes are rehashed; unsafe JSON bigint is never reserialized for comparison', () => {
  const input = artifactFixture(), bundle = verifyRecoveryArtifactSet(input);
  try {
    const original = input.artifacts.find(row => row.scope.startsWith('relation:')).bytes;
    assert.equal(bundle.relations[0].sha256, sha(original));
    assert.notEqual(bundle.relations[0].sha256, sha(Buffer.from(JSON.stringify(JSON.parse(original)))));
    assert.equal(bundle.objects[0].bytes.toString(), 'synthetic attachment');
    assert.equal(bundle.fullRestoreVerified, false);
  } finally { bundle.dispose(); }
  assert.equal(bundle.archive.every(byte => byte === 0), true);
  assert.equal(bundle.objects[0].bytes.every(byte => byte === 0), true);
});
test('missing and duplicate source parts cannot silently shrink recovery scope', () => {
  const input = artifactFixture(); input.artifacts.pop();
  assert.throws(() => verifyRecoveryArtifactSet(input), /RECOVERY_SCOPE_INCOMPLETE/);
  const duplicate = artifactFixture(); duplicate.artifacts[1] = duplicate.artifacts[0];
  assert.throws(() => verifyRecoveryArtifactSet(duplicate), /RECOVERY_DUPLICATE_ARTIFACT/);
});

test('verified archive bytes and source binding cannot be silently changed before target admission', async () => {
  const input = artifactFixture(), bundle = verifyRecoveryArtifactSet(input);
  try {
    assertRecoveryArchiveBytes(bundle);
    input.binding.source.projectRef = 'slrtobkksjmxgzatjyqb';
    assert.equal(bundle.binding.source.projectRef, 'syntheticlocalonly00');
    assert.throws(() => { bundle.binding.source.projectRef = 'changed'; }, TypeError);
    assert.throws(() => { bundle.archiveEnvelope.archiveSha256 = '0'.repeat(64); }, TypeError);
    assert.throws(() => { bundle.binding = input.binding; }, TypeError);
    assert.throws(() => { bundle.archiveEnvelope = { ...bundle.archiveEnvelope, archiveSha256: '0'.repeat(64) }; }, TypeError);
    assert.throws(() => { bundle.schema.globals.roles[0].rolname = 'changed'; }, TypeError);
    assert.throws(() => { bundle.relations[0].rows = 0; }, TypeError);
    assert.throws(() => { bundle.relations[0].sha256 = '0'.repeat(64); }, TypeError);
    assert.throws(() => { bundle.relations.length = 0; }, TypeError);
    assert.throws(() => { bundle.objects[0].sha256 = '0'.repeat(64); }, TypeError);
    assert.throws(() => { bundle.objects[0].bytes = Buffer.alloc(0); }, TypeError);
    bundle.archive[bundle.archive.length - 1] ^= 1;
    assert.throws(() => assertRecoveryArchiveBytes(bundle), /RECOVERY_ARCHIVE_CHANGED/);
    // No connection or native executable is supplied: mutated bytes stop before either is needed.
    await assert.rejects(restoreSyntheticDatabaseStage({ bundle }), /RECOVERY_ARCHIVE_CHANGED/);
  } finally { bundle.dispose(); }
});

test('a disposed recovery bundle cannot enter a later restore attempt', async () => {
  const bundle = verifyRecoveryArtifactSet(artifactFixture()); bundle.dispose();
  await assert.rejects(restoreSyntheticDatabaseStage({ bundle }), /RECOVERY_ARCHIVE_CHANGED/);
});

test('checkpoint-time archive mutation stops the actual stage before any native process starts', async t => {
  const { Client } = createRequire(import.meta.url)('pg');
  const bundle = verifyRecoveryArtifactSet(artifactFixture()); t.after(() => bundle.dispose());
  const connection = { host: '127.0.0.1', port: 55499, database: 'hanbang_restore_' + 'a'.repeat(32),
    user: 'postgres', password: 'synthetic-never-used-password' };
  const targetSystemIdentifier = '7581440907192989001';
  t.mock.method(Client.prototype, 'connect', async () => {});
  t.mock.method(Client.prototype, 'end', async () => {});
  t.mock.method(Client.prototype, 'query', async sql => {
    if (sql.includes('pg_control_system')) return { rows: [{ database: connection.database, actor: 'postgres',
      address: '127.0.0.1', listen: '127.0.0.1', port: connection.port, version: 170010, system: targetSystemIdentifier }] };
    if (sql === 'SELECT rolname FROM pg_roles ORDER BY rolname') return { rows: [{ rolname: 'postgres' }] };
    if (sql.includes('FROM pg_class')) return { rows: [] };
    throw new Error('unexpected fixture query');
  });
  let processCalls = 0, checkpointReached = false; const records = [];
  await assert.rejects(restoreSyntheticDatabaseStage({ bundle, connection, targetSystemIdentifier,
    pgRestore: process.execPath, pgRestoreSha256: sha(readFileSync(process.execPath)),
    checkpoint: async record => {
      records.push(record);
      if (record.phase === 'before-database-restore') {
        checkpointReached = true;
        await new Promise(resolve => setImmediate(resolve));
        bundle.archive[bundle.archive.length - 1] ^= 1;
      }
    },
    runProcess: async () => { processCalls++; throw new Error('native execution must remain blocked'); },
  }), /RECOVERY_ARCHIVE_CHANGED/);
  assert.equal(checkpointReached, true);
  assert.equal(processCalls, 0);
  assert.equal(records.at(-1).restoreAttempted, false);
  assert.equal(records.at(-1).partialTargetRetained, false);
});
test('a corrupted archive, a swapped backup set and an unbound object fail before any target operation', () => {
  const input = artifactFixture(); input.artifacts[0].bytes[10] ^= 1;
  assert.throws(() => verifyRecoveryArtifactSet(input), /RECOVERY_ARTIFACT_CHANGED/);
  const swapped = artifactFixture(); swapped.binding = { ...swapped.binding, backupSetId: randomUUID() };
  assert.throws(() => verifyRecoveryArtifactSet(swapped), /RECOVERY_BINDING_MISMATCH/);
  const original = artifactFixture(), part = original.artifacts.find(row => row.scope.startsWith('storage:'));
  const payload = JSON.parse(part.bytes); payload.base64 = Buffer.from('changed').toString('base64');
  part.bytes = Buffer.from(JSON.stringify(payload));
  assert.throws(() => verifyRecoveryArtifactSet(original.refreshManifest()), /RECOVERY_BYTES_MISMATCH/);
});
test('role globals and valid storage identity are mandatory; manifest edits do not waive them', () => {
  const input = artifactFixture(); const part = input.artifacts.find(row => row.scope === 'schema-original');
  const schema = JSON.parse(part.bytes); delete schema.globals; part.bytes = Buffer.from(JSON.stringify(schema));
  assert.throws(() => verifyRecoveryArtifactSet(input.refreshManifest()), /RECOVERY_GLOBALS_MISSING/);
  const traversal = artifactFixture(); const index = traversal.artifacts.find(row => row.scope === 'storage-index');
  const value = JSON.parse(index.bytes); value.objects[0].name = '../outside'; index.bytes = Buffer.from(JSON.stringify(value));
  assert.throws(() => verifyRecoveryArtifactSet(traversal.refreshManifest()), /RECOVERY_STORAGE_IDENTITY_INVALID/);
});
test('actual customer source is rejected independently of caller flags or admission JSON', async () => {
  const bundle = verifyRecoveryArtifactSet(artifactFixture({ binding: { source: {
    projectRef: 'slrtobkksjmxgzatjyqb', systemIdentifier: '7581440907192989109' } } }));
  try { await assert.rejects(restoreSyntheticDatabaseStage({ bundle, releaseAuthorized: true,
    admission: { observationsAuthenticated: true } }), /RECOVERY_CUSTOMER_ADMISSION_NOT_IMPLEMENTED/); }
  finally { bundle.dispose(); }
});
test('CLI help does not load stale baseline contracts or read credentials; execution options remain closed', () => {
  for (const args of [[], ['--help'], ['--target', 'postgresql://example.invalid/customer']]) {
    const result = spawnSync(process.execPath, ['scripts/recovery-delivery.mjs', ...args], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH, SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-read-or-printed' } });
    assert.equal(result.status, args.length > 1 ? 2 : 0); assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).remoteCalls, 0);
    assert.equal(result.stdout.includes('must-not-be-read-or-printed'), false);
  }
});
