import { createHash } from 'node:crypto';

const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const RELATION = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const REQUIRED_SCOPES = ['auth', 'cron', 'public', 'realtime', 'storage', 'supabase_migrations', 'vault'];
const REQUIRED_RELATIONS = [
  'auth.users', 'cron.job', 'public.profiles', 'storage.buckets', 'storage.objects',
  'supabase_migrations.schema_migrations', 'vault.secrets',
];
const ROLE_ATTRIBUTES = ['bypassRls', 'canLogin', 'createDb', 'createRole', 'inherit', 'replication', 'superuser'];
const BOUNDARIES = [
  'auth-refresh', 'auth-sign-in', 'data-api', 'host-gateway', 'outbound-dns',
  'outbound-http', 'outbound-smtp', 'outbound-tcp', 'outbound-udp', 'public-ingress',
  'realtime', 'storage-authenticated', 'storage-public', 'storage-s3', 'storage-signed',
];
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_AGE_MS = 15 * 60 * 1000;
const isSha = value => typeof value === 'string' && SHA.test(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

export class FullRestoreAdmissionBlocked extends Error {
  constructor(code) { super(code); this.name = 'FullRestoreAdmissionBlocked'; this.code = code; }
}

function requireEvidence(condition, code) {
  if (!condition) throw new FullRestoreAdmissionBlocked(code);
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keys(value, expected, code) {
  requireEvidence(record(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(','), code);
}
function same(actual, expected, code) {
  requireEvidence(canonical(actual) === canonical(expected), code);
}
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function ordered(values, identity, code, allowEmpty = false) {
  requireEvidence(Array.isArray(values) && values.length <= 10000 && (allowEmpty || values.length > 0), code);
  const ids = values.map(identity);
  requireEvidence(ids.every((id, i) => typeof id === 'string' && id.length > 0 && (i === 0 || ids[i - 1] < id)), code);
}
function candidate(value) {
  keys(value, ['commit', 'tree'], 'CANDIDATE_INVALID');
  requireEvidence(typeof value.commit === 'string' && typeof value.tree === 'string' && COMMIT.test(value.commit) && COMMIT.test(value.tree), 'CANDIDATE_INVALID');
}
function sourceIdentity(value) {
  keys(value, ['projectRef', 'systemIdentifier'], 'SOURCE_IDENTITY_INVALID');
  requireEvidence(typeof value.projectRef === 'string' && typeof value.systemIdentifier === 'string'
    && /^[a-z0-9]{20}$/.test(value.projectRef) && /^[0-9]{10,24}$/.test(value.systemIdentifier), 'SOURCE_IDENTITY_INVALID');
}
function targetIdentity(value) {
  keys(value, ['environmentId', 'systemIdentifier'], 'TARGET_IDENTITY_INVALID');
  requireEvidence(typeof value.environmentId === 'string' && typeof value.systemIdentifier === 'string'
    && /^[a-z0-9][a-z0-9-]{19,63}$/.test(value.environmentId)
    && /^[0-9]{10,24}$/.test(value.systemIdentifier), 'TARGET_IDENTITY_INVALID');
}
function readPinnedJson(bytes, expectedHash, code) {
  requireEvidence(isSha(expectedHash) && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_RECEIPT_BYTES, code);
  requireEvidence(sha(bytes) === expectedHash, 'RECEIPT_HASH_MISMATCH');
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    requireEvidence(record(value), code);
    return value;
  } catch (error) {
    if (error instanceof FullRestoreAdmissionBlocked) throw error;
    throw new FullRestoreAdmissionBlocked(code);
  }
}
function receipt(bytes, kind, expected, binding, now) {
  const value = readPinnedJson(bytes, expected.receiptPins[kind], 'RECEIPT_INVALID');
  keys(value, ['format', 'collectorSha256', 'capturedAt', 'binding', 'observation'], 'RECEIPT_INVALID');
  requireEvidence(value.format === `full-restore-${kind}-receipt-v1`
    && value.collectorSha256 === expected.collectorPins[kind], 'RECEIPT_PRODUCER_MISMATCH');
  same(value.binding, binding, 'RECEIPT_BINDING_MISMATCH');
  requireEvidence(typeof value.capturedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.capturedAt), 'RECEIPT_TIME_INVALID');
  const time = Date.parse(value.capturedAt);
  requireEvidence(Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.capturedAt.slice(0, 19)
    && time <= now && now - time <= MAX_AGE_MS, 'RECEIPT_TIME_INVALID');
  return value.observation;
}
function databaseInventory(value) {
  keys(value, ['systemIdentifier', 'readOnly', 'coverage', 'pgMajor', 'extensions', 'roles', 'managedScopes', 'relations'], 'INVENTORY_INVALID');
  requireEvidence(typeof value.systemIdentifier === 'string' && /^[0-9]{10,24}$/.test(value.systemIdentifier), 'DATABASE_IDENTITY_INVALID');
  requireEvidence(value.readOnly === true && value.pgMajor === 17, 'DATABASE_COMPATIBILITY_UNVERIFIED');
  same(value.coverage, {
    extensions: 'complete', roles: 'complete', managedScopes: 'complete', relations: 'complete',
  }, 'INVENTORY_COVERAGE_INCOMPLETE');
  ordered(value.extensions, row => row?.name, 'EXTENSIONS_INVALID');
  for (const extension of value.extensions) {
    keys(extension, ['name', 'schema', 'version'], 'EXTENSIONS_INVALID');
    requireEvidence(IDENTIFIER.test(extension.name.replaceAll('-', '_')) && typeof extension.schema === 'string' && IDENTIFIER.test(extension.schema)
      && typeof extension.version === 'string' && /^[0-9]+(?:\.[0-9]+){0,3}$/.test(extension.version), 'EXTENSIONS_INVALID');
  }
  ordered(value.roles, row => row?.name, 'ROLES_INVALID');
  for (const role of value.roles) {
    // 비밀번호·token·LOGIN secret은 이 검증 포맷에 받지 않는다.
    keys(role, ['name', 'attributes', 'memberships'], 'ROLES_INVALID');
    requireEvidence(IDENTIFIER.test(role.name), 'ROLES_INVALID');
    keys(role.attributes, ROLE_ATTRIBUTES, 'ROLES_INVALID');
    requireEvidence(Object.values(role.attributes).every(flag => typeof flag === 'boolean'), 'ROLES_INVALID');
    ordered(role.memberships, membership => membership?.role, 'ROLES_INVALID', true);
    for (const membership of role.memberships) {
      keys(membership, ['role', 'admin', 'inherit', 'set'], 'ROLES_INVALID');
      requireEvidence(typeof membership.role === 'string' && IDENTIFIER.test(membership.role)
        && ['admin', 'inherit', 'set'].every(key => typeof membership[key] === 'boolean'), 'ROLES_INVALID');
    }
  }
  ordered(value.managedScopes, name => name, 'MANAGED_SCOPE_INVALID');
  requireEvidence(value.managedScopes.every(name => IDENTIFIER.test(name))
    && REQUIRED_SCOPES.every(name => value.managedScopes.includes(name)), 'MANAGED_SCOPE_INCOMPLETE');
  ordered(value.relations, row => row?.identity, 'RELATIONS_INVALID');
}
function relationState(row, withMode) {
  keys(row, withMode ? ['identity', 'mode', 'presence', 'rows', 'sha256'] : ['identity', 'presence', 'rows', 'sha256'], 'RELATION_STATE_INVALID');
  requireEvidence(RELATION.test(row.identity) && integer(row.rows), 'RELATION_STATE_INVALID');
  requireEvidence(row.presence === 'present' ? isSha(row.sha256)
    : row.presence === 'absent' && row.rows === 0 && row.sha256 === null, 'RELATION_STATE_INVALID');
  if (withMode) {
    requireEvidence(row.mode === 'customer-empty' ? row.rows === 0
      : row.mode === 'reviewed-bootstrap' && row.presence === 'present' && row.rows > 0, 'TARGET_EMPTY_POLICY_INVALID');
  }
}

/**
 * 순수 증거 계약 검사. expected pins는 caller가 검토된 manifest/collector에서 독립 확보해야 한다.
 * 원본 Buffer의 hash/내용 결합을 확인해도 producer의 실제 실행·네트워크 격리·artifact 파일을
 * 인증한 것은 아니다. JSON true만으로 복원 실행/출시 허가를 발급하지 않으며 CLI/IO도 없다.
 * 전체 target catalog와 source relation의 union을 수집한다. source-only relation은 명시 absent,
 * bootstrap seed는 expected의 정확 count/hash로만 허용한다. 숨긴 관계/허용목록 생략은 금지한다.
 * 실제 capture는 globals를 schema-original에 포함한다. 별도 role-globals part는 만들지 않는다.
 * 최종 원문 검증 consumer는 복호화한 schema-original의 embedded globals를 필수 검증해야 한다.
 * 이 순수 manifest 검사는 그 원문 검증을 대신하지 않는다.
 */
export function validateFullRestoreTargetAdmission({ expected, receipts, artifactManifest, now }) {
  keys(expected, ['candidate', 'backupSetId', 'source', 'target', 'manifestSha256', 'receiptPins', 'collectorPins', 'targetRelations'], 'EXPECTED_INVALID');
  candidate(expected.candidate);
  sourceIdentity(expected.source);
  targetIdentity(expected.target);
  requireEvidence(typeof expected.backupSetId === 'string' && UUID.test(expected.backupSetId), 'BACKUP_SET_INVALID');
  requireEvidence(expected.source.projectRef !== expected.target.environmentId
    && expected.source.systemIdentifier !== expected.target.systemIdentifier, 'SOURCE_TARGET_COLLISION');
  requireEvidence(Number.isSafeInteger(now) && now > 0, 'NOW_INVALID');
  keys(receipts, ['source', 'target', 'isolation'], 'RECEIPT_SET_INVALID');
  for (const name of ['receiptPins', 'collectorPins']) {
    keys(expected[name], ['source', 'target', 'isolation'], 'EXPECTED_PINS_INVALID');
    requireEvidence(Object.values(expected[name]).every(isSha), 'EXPECTED_PINS_INVALID');
  }
  const binding = {
    candidate: expected.candidate, backupSetId: expected.backupSetId,
    source: expected.source, target: expected.target, manifestSha256: expected.manifestSha256,
  };
  const manifest = readPinnedJson(artifactManifest, expected.manifestSha256, 'MANIFEST_INVALID');
  keys(manifest, ['format', 'candidate', 'backupSetId', 'source', 'artifacts'], 'MANIFEST_INVALID');
  requireEvidence(manifest.format === 'full-restore-artifact-manifest-v1', 'MANIFEST_INVALID');
  same(manifest.candidate, expected.candidate, 'MANIFEST_BINDING_MISMATCH');
  same(manifest.source, expected.source, 'MANIFEST_BINDING_MISMATCH');
  requireEvidence(manifest.backupSetId === expected.backupSetId, 'MANIFEST_BINDING_MISMATCH');
  ordered(manifest.artifacts, row => row?.scope, 'MANIFEST_SCOPE_INVALID');
  for (const artifact of manifest.artifacts) {
    keys(artifact, ['scope', 'bytes', 'sha256'], 'MANIFEST_INVALID');
    requireEvidence(integer(artifact.bytes) && artifact.bytes > 0 && isSha(artifact.sha256), 'MANIFEST_INVALID');
  }
  const source = receipt(receipts.source, 'source', expected, binding, now);
  keys(source, ['database', 'storageObjectIdentities'], 'SOURCE_OBSERVATION_INVALID');
  databaseInventory(source.database);
  requireEvidence(source.database.systemIdentifier === expected.source.systemIdentifier, 'OBSERVED_DATABASE_IDENTITY_MISMATCH');
  for (const row of source.database.relations) {
    keys(row, ['identity'], 'RELATIONS_INVALID');
    requireEvidence(RELATION.test(row.identity), 'RELATIONS_INVALID');
  }
  const sourceRelationIds = new Set(source.database.relations.map(row => row.identity));
  requireEvidence(REQUIRED_RELATIONS.every(identity => sourceRelationIds.has(identity)), 'SOURCE_MANAGED_RELATION_MISSING');
  requireEvidence(source.database.relations.every(row => source.database.managedScopes.includes(row.identity.split('.')[0])), 'MANAGED_SCOPE_INCOMPLETE');
  ordered(source.storageObjectIdentities, id => id, 'STORAGE_SCOPE_INVALID', true);
  requireEvidence(source.storageObjectIdentities.every(isSha), 'STORAGE_SCOPE_INVALID');
  same(manifest.artifacts.map(row => row.scope), [
    'database-custom-archive', 'schema-original', 'storage-index',
    ...source.database.relations.map(row => `relation:${row.identity}`),
    ...source.storageObjectIdentities.map(id => `storage:${id}`),
  ].sort(), 'MANIFEST_SCOPE_INCOMPLETE');

  const target = receipt(receipts.target, 'target', expected, binding, now);
  keys(target, ['database', 'phase'], 'TARGET_OBSERVATION_INVALID');
  requireEvidence(target.phase === 'before-original-restore', 'TARGET_PHASE_INVALID');
  databaseInventory(target.database);
  requireEvidence(target.database.systemIdentifier === expected.target.systemIdentifier, 'OBSERVED_DATABASE_IDENTITY_MISMATCH');
  for (const field of ['pgMajor', 'extensions', 'roles', 'managedScopes'])
    same(target.database[field], source.database[field], 'DATABASE_COMPATIBILITY_MISMATCH');
  ordered(expected.targetRelations, row => row?.identity, 'TARGET_EMPTY_POLICY_INVALID');
  expected.targetRelations.forEach(row => relationState(row, true));
  target.database.relations.forEach(row => relationState(row, false));
  same(target.database.relations, expected.targetRelations.map(({ mode: _mode, ...row }) => row), 'TARGET_STATE_MISMATCH');
  const targetIds = new Set(target.database.relations.map(row => row.identity));
  requireEvidence(source.database.relations.every(row => targetIds.has(row.identity)), 'TARGET_RELATION_COVERAGE_INCOMPLETE');
  requireEvidence(target.database.relations.every(row => target.database.managedScopes.includes(row.identity.split('.')[0])), 'MANAGED_SCOPE_INCOMPLETE');

  const isolation = receipt(receipts.isolation, 'isolation', expected, binding, now);
  keys(isolation, ['phase', 'targetReceiptSha256', 'checks'], 'ISOLATION_INVALID');
  requireEvidence(isolation.phase === 'before-original-restore'
    && isolation.targetReceiptSha256 === expected.receiptPins.target, 'ISOLATION_TARGET_MISMATCH');
  ordered(isolation.checks, check => check?.boundary, 'ISOLATION_COVERAGE_INCOMPLETE');
  same(isolation.checks.map(check => check.boundary), BOUNDARIES, 'ISOLATION_COVERAGE_INCOMPLETE');
  for (const check of isolation.checks) {
    keys(check, ['boundary', 'configuration', 'probe', 'configurationEvidenceSha256', 'probeEvidenceSha256'], 'ISOLATION_INVALID');
    requireEvidence(check.configuration === 'blocked' && check.probe === 'blocked'
      && isSha(check.configurationEvidenceSha256) && isSha(check.probeEvidenceSha256), 'ISOLATION_UNVERIFIED');
  }
  // 이 결과만으로 원본 접근/복원/출시를 허용하는 consumer를 만들면 안 된다.
  return Object.freeze({
    kind: 'full-restore-target-admission-contract-v1',
    evidenceContractValidated: true, observationsAuthenticated: false, artifactsRehashed: false,
    restoreExecuted: false, releaseAuthorized: false,
    candidateCommit: expected.candidate.commit, backupSetId: expected.backupSetId,
    targetEnvironmentId: expected.target.environmentId, manifestSha256: expected.manifestSha256,
    relationCount: target.database.relations.length, artifactCount: manifest.artifacts.length,
  });
}
