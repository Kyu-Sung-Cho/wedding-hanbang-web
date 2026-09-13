import { createHash } from 'node:crypto';
import { ARCHIVE_FORMAT, MAX_ARCHIVE_ENVELOPE_BYTES, MAX_CUSTOM_ARCHIVE_BYTES } from './postgres-snapshot-archive.mjs';
import { MAX_RELATION_BYTES, MAX_STORAGE_BYTES, storageIdentity } from './current-baseline-backup-collector.mjs';

export const recoveryDigest = value => createHash('sha256').update(value).digest('hex');
export class RecoveryStageError extends Error {
  constructor(code) { super(code); this.name = 'RecoveryStageError'; this.code = code; }
}
export function requireRecovery(value, code) { if (!value) throw new RecoveryStageError(code); }
const SHA = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function json(bytes, maximum, code) {
  requireRecovery(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum, code);
  try { const value = JSON.parse(bytes.toString('utf8')); requireRecovery(plain(value), code); return value; }
  catch { throw new RecoveryStageError(code); }
}
function decode(value, size, expectedHash, maximum) {
  requireRecovery(typeof value === 'string' && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
    && Number.isSafeInteger(size) && size >= 0 && size <= maximum && SHA.test(expectedHash), 'RECOVERY_BYTES_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== value || recoveryDigest(bytes) !== expectedHash) {
    bytes.fill(0); throw new RecoveryStageError('RECOVERY_BYTES_MISMATCH');
  }
  return bytes;
}

/** Consumes plaintext buffers only after an outer, reviewed encrypted transport has admitted them.
 * This verifies the producer's bytes, not source authority, customer admission or actual restoration.
 * Never reserialize relation row payloads: JSON numbers may exceed JavaScript's safe integer range.
 */
export function verifyRecoveryArtifactSet({ manifestBytes, expectedManifestSha256, binding, artifacts }) {
  requireRecovery(SHA.test(expectedManifestSha256) && recoveryDigest(manifestBytes) === expectedManifestSha256,
    'RECOVERY_MANIFEST_CHANGED');
  const manifest = json(manifestBytes, 4 * 1024 * 1024, 'RECOVERY_MANIFEST_INVALID');
  requireRecovery(manifest.format === 'full-restore-artifact-manifest-v1'
    && same(manifest.candidate, binding.candidate) && same(manifest.source, binding.source)
    && manifest.backupSetId === binding.backupSetId, 'RECOVERY_BINDING_MISMATCH');
  requireRecovery(Array.isArray(manifest.artifacts) && manifest.artifacts.length >= 3
    && Array.isArray(artifacts) && artifacts.length === manifest.artifacts.length, 'RECOVERY_SCOPE_INCOMPLETE');
  const byScope = new Map();
  for (const part of artifacts) {
    requireRecovery(plain(part) && typeof part.scope === 'string' && !byScope.has(part.scope)
      && Buffer.isBuffer(part.bytes), 'RECOVERY_DUPLICATE_ARTIFACT');
    byScope.set(part.scope, part.bytes);
  }
  const scopes = manifest.artifacts.map(part => part.scope);
  requireRecovery(scopes.every((scope, i) => typeof scope === 'string' && (i === 0 || scopes[i - 1] < scope)), 'RECOVERY_MANIFEST_ORDER_INVALID');
  for (const part of manifest.artifacts) {
    const bytes = byScope.get(part.scope);
    requireRecovery(bytes && Number.isSafeInteger(part.bytes) && part.bytes > 0 && bytes.length === part.bytes
      && part.bytes <= MAX_ARCHIVE_ENVELOPE_BYTES && SHA.test(part.sha256) && recoveryDigest(bytes) === part.sha256,
    'RECOVERY_ARTIFACT_CHANGED');
  }
  let archive;
  const objects = [];
  try {
    const archiveEnvelope = json(byScope.get('database-custom-archive'), MAX_ARCHIVE_ENVELOPE_BYTES, 'RECOVERY_ARCHIVE_MISSING');
    requireRecovery(archiveEnvelope.format === ARCHIVE_FORMAT && archiveEnvelope.projectRef === binding.source.projectRef
      && archiveEnvelope.systemIdentifier === binding.source.systemIdentifier && archiveEnvelope.releaseCommit === binding.candidate.commit
      && archiveEnvelope.backupSetId === binding.backupSetId && SHA.test(archiveEnvelope.snapshotIdentitySha256)
      && archiveEnvelope.archiveDecoded === true && archiveEnvelope.databaseRestoreExecuted === false
      && archiveEnvelope.clusterRolePasswordsCaptured === false, 'RECOVERY_ARCHIVE_BINDING_INVALID');
    archive = decode(archiveEnvelope.archiveBase64, archiveEnvelope.archiveBytes, archiveEnvelope.archiveSha256, MAX_CUSTOM_ARCHIVE_BYTES);
    requireRecovery(archive.subarray(0, 5).toString('ascii') === 'PGDMP', 'RECOVERY_ARCHIVE_INVALID');
    const schema = json(byScope.get('schema-original'), MAX_RELATION_BYTES, 'RECOVERY_SCHEMA_MISSING');
    requireRecovery(schema.format === 'current-baseline-schema-original-v1' && Array.isArray(schema.statements)
      && schema.statements.length > 0 && schema.statements.every(text => typeof text === 'string' && text.length > 0)
      && Array.isArray(schema.objects) && Array.isArray(schema.ledger)
      && plain(schema.globals) && Array.isArray(schema.globals.roles) && Array.isArray(schema.globals.memberships), 'RECOVERY_GLOBALS_MISSING');
    const relations = [];
    for (const scope of scopes.filter(scope => scope.startsWith('relation:'))) {
      const bytes = byScope.get(scope), relation = json(bytes, MAX_RELATION_BYTES, 'RECOVERY_RELATION_INVALID');
      const identity = scope.slice('relation:'.length), names = identity.split('.');
      requireRecovery(names.length === 2 && names.every(name => IDENTIFIER.test(name))
        && relation.format === 'current-baseline-relation-v1' && relation.identity === identity
        && Array.isArray(relation.rows) && Array.isArray(relation.columns) && relation.columns.length > 0
        && new Set(relation.columns).size === relation.columns.length
        && relation.columns.every(name => typeof name === 'string')
        && relation.rows.every(row => plain(row) && same(Object.keys(row).sort(), [...relation.columns].sort())), 'RECOVERY_RELATION_INVALID');
      relations.push({ identity, schema: names[0], name: names[1], rows: relation.rows.length,
        bytes: bytes.length, sha256: recoveryDigest(bytes) });
    }
    requireRecovery(relations.length > 0, 'RECOVERY_RELATIONS_MISSING');
    const index = json(byScope.get('storage-index'), MAX_RELATION_BYTES, 'RECOVERY_STORAGE_INDEX_MISSING');
    requireRecovery(index.format === 'current-baseline-storage-index-v1' && Array.isArray(index.objects), 'RECOVERY_STORAGE_INDEX_INVALID');
    for (const entry of index.objects) {
      requireRecovery(plain(entry) && typeof entry.bucket === 'string' && entry.bucket.length > 0
        && !entry.bucket.includes('/') && !entry.bucket.includes('\\') && !entry.bucket.includes('\0')
        && typeof entry.name === 'string' && entry.name.length > 0 && !entry.name.includes('\0')
        && ![entry.bucket, ...entry.name.replaceAll('\\', '/').split('/')].some(part => part === '.' || part === '..')
        && (entry.version === null || typeof entry.version === 'string')
        && SHA.test(entry.identity) && storageIdentity(entry) === entry.identity
        && !objects.some(object => object.identity === entry.identity), 'RECOVERY_STORAGE_IDENTITY_INVALID');
      const original = json(byScope.get('storage:' + entry.identity), MAX_RELATION_BYTES, 'RECOVERY_STORAGE_ORIGINAL_MISSING');
      requireRecovery(original.format === 'current-baseline-storage-object-v1' && original.identity === entry.identity
        && original.bytes === entry.bytes && original.sha256 === entry.sha256, 'RECOVERY_STORAGE_ORIGINAL_MISMATCH');
      const bytes = decode(original.base64, entry.bytes, entry.sha256, MAX_STORAGE_BYTES);
      objects.push({ ...entry, bytes });
    }
    const expected = ['database-custom-archive', 'schema-original', 'storage-index',
      ...relations.map(row => 'relation:' + row.identity), ...objects.map(row => 'storage:' + row.identity)].sort();
    requireRecovery(same(scopes, expected), 'RECOVERY_SCOPE_INCOMPLETE');
    return { binding, archive, archiveEnvelope, schema, relations, objects, artifactCount: artifacts.length,
      releaseAuthorized: false, fullRestoreVerified: false,
      dispose() { archive.fill(0); for (const object of objects) object.bytes.fill(0); } };
  } catch (error) { archive?.fill(0); for (const object of objects) object.bytes.fill(0); throw error; }
}
