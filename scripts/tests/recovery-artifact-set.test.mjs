import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verifyRecoveryArtifactSet, recoveryDigest as sha } from '../lib/recovery-artifact-set.mjs';
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
