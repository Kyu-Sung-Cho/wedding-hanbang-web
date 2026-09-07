import { createHash, randomUUID } from 'node:crypto';
import { assertFencedBaseline, digest, same, requireRelease } from './current-baseline-release-contract.mjs';

export const MAX_RELATION_BYTES = 32 * 1024 * 1024;
export const MAX_STORAGE_BYTES = 24 * 1024 * 1024 - 1024;
const ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SHA = /^[a-f0-9]{64}$/;
export const relationIdentity = r => `${r.schema}.${r.name}`;
export const durableRelations = observation => observation.relations.filter(r => ['r', 'p', 'm', 'S'].includes(r.kind));
export const storageIdentity = row => digest(`${row.bucket}\0${row.name}`);

// 식별자는 정본 inventory에서만 가져온다. row JSON은 재직렬화하지 않아 bigint 원문을 보존한다.
export function relationCaptureSql(relation) {
  requireRelease(ID.test(relation.schema) && ID.test(relation.name) && ['r', 'p', 'm', 'S'].includes(relation.kind), 'CAPTURE_RELATION_INVALID');
  const table = `"${relation.schema}"."${relation.name}"`;
  const rows = relation.kind === 'S'
    ? `SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) AS row FROM ${table}`
    : `SELECT to_jsonb(t) AS row FROM ${table} t`;
  const columns = relation.kind === 'S' ? `jsonb_build_array('last_value','is_called')`
    : `(SELECT jsonb_agg(attname ORDER BY attnum) FROM pg_attribute WHERE attrelid='${table}'::regclass AND attnum>0 AND NOT attisdropped)`;
  return `WITH source_rows AS MATERIALIZED (${rows}), payload AS MATERIALIZED (
SELECT jsonb_build_object('format','current-baseline-relation-v1','identity','${relationIdentity(relation)}',
'columns',${columns},'rows',coalesce(jsonb_agg(row ORDER BY row::text COLLATE "C"),'[]'::jsonb))::text AS body FROM source_rows)
SELECT CASE WHEN octet_length(body)<=${MAX_RELATION_BYTES} THEN body END AS payload,
octet_length(body)::text AS bytes,(SELECT count(*)::text FROM source_rows) AS rows FROM payload;`;
}

function validatePayload(buffer, relation, rowCount) {
  requireRelease(Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length <= MAX_RELATION_BYTES, 'CAPTURE_PAYLOAD_SIZE');
  let parsed; try { parsed = JSON.parse(buffer.toString('utf8')); } catch { requireRelease(false, 'CAPTURE_PAYLOAD_INVALID'); }
  requireRelease(parsed.format === 'current-baseline-relation-v1' && parsed.identity === relationIdentity(relation)
    && Array.isArray(parsed.columns) && parsed.columns.length > 0 && new Set(parsed.columns).size === parsed.columns.length
    && parsed.columns.every(x => typeof x === 'string' && x.length > 0)
    && Array.isArray(parsed.rows) && parsed.rows.length === rowCount
    && parsed.rows.every(row => row && typeof row === 'object' && !Array.isArray(row)
      && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...parsed.columns].sort())), 'CAPTURE_PAYLOAD_INVALID');
  return { identity: relationIdentity(relation), rows: rowCount, sha256: digest(buffer) };
}

function validateStorageIndex(rows) {
  requireRelease(Array.isArray(rows), 'CAPTURE_STORAGE_INDEX_INVALID');
  const result = rows.map(row => {
    requireRelease(row && typeof row.bucket === 'string' && row.bucket.length > 0 && !row.bucket.includes('/')
      && typeof row.name === 'string' && row.name.length > 0 && !row.name.includes('\0') && !row.bucket.includes('\0')
      && ![row.bucket,...row.name.split('/')].some(part=>part === '.' || part === '..')
      && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= MAX_STORAGE_BYTES
      && (row.version === null || typeof row.version === 'string'), 'CAPTURE_STORAGE_INDEX_INVALID');
    return { bucket: row.bucket, name: row.name, bytes: row.bytes, version: row.version, identity: storageIdentity(row) };
  }).sort((a,b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
  requireRelease(new Set(result.map(x => x.identity)).size === result.length, 'CAPTURE_STORAGE_DUPLICATE');
  return result;
}

async function checkedOriginal(source, object) {
  const bytes = await source.download(object);
  requireRelease(Buffer.isBuffer(bytes) && bytes.length === object.bytes && bytes.length <= MAX_STORAGE_BYTES, 'CAPTURE_STORAGE_SIZE_MISMATCH');
  return bytes;
}

/** 실제 DB/파일 경계를 주입해 합성 검증한다. 운영 CLI에는 fixture/skip-fence 모드가 없다. */
export async function collectCurrentBackup({ release, expectedCommit, source, sink, assertStable, now = () => new Date() }) {
  requireRelease(/^[a-f0-9]{40}$/.test(expectedCommit), 'CAPTURE_COMMIT_INVALID');
  const backupSetId = randomUUID();
  const startedAt = now().toISOString();
  const artifacts = []; const relations = []; const storageObjects = [];
  const commands = []; let initialized = false; let phase = 'initializing';
  const stable = async () => { await assertStable(); requireRelease(now().getTime() - Date.parse(startedAt) < 25 * 60_000, 'CAPTURE_TIMEOUT'); };
  const save = async (scope, bytes, extra = {}) => {
    await stable();
    requireRelease(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_RELATION_BYTES, 'CAPTURE_PAYLOAD_SIZE');
    const directory = `part-${String(artifacts.length).padStart(6,'0')}`;
    const name = scope === 'schema-original' ? 'schema-inventory.json' : 'logical-data.json';
    const expectedHash = digest(bytes);
    const result = await sink.write({ directory, name, bytes, backupSetId });
    requireRelease(result.backup_set_id === backupSetId && result.artifact === `${name}.hbam2` && result.key === `${name}.key.dpapi`
      && result.plaintext_sha256.toLowerCase() === expectedHash && result.plaintext_bytes === bytes.length
      && SHA.test(result.encrypted_sha256.toLowerCase()) && SHA.test(result.key_sha256.toLowerCase()), 'CAPTURE_ENCRYPTION_RECEIPT_INVALID');
    artifacts.push({ ...result, directory, name, scope, ...extra });
    await sink.progress({ phase, artifactCount: artifacts.length });
  };
  try {
    await stable();
    await sink.initialize({ backupSetId, projectRef: release.contract.projectRef, expectedCommit, startedAt }); initialized = true;
    phase = 'database-snapshot';
    const before = await source.begin();
    requireRelease(before.readOnly === true && before.isolation === 'repeatable read' && before.fenceCount === 1
      && before.projectRef === release.contract.projectRef && before.systemIdentifier === release.contract.systemIdentifier,
    'CAPTURE_SOURCE_IDENTITY_INVALID');
    assertFencedBaseline(before.inventory, release.baseline, release.contract);
    const expectedRelations = durableRelations(release.baseline);
    requireRelease(expectedRelations.length > 0, 'CAPTURE_EMPTY_SCOPE');
    for (const relation of expectedRelations) {
      await stable();
      const result = await source.captureRelation(relation);
      try {
        requireRelease(Number.isSafeInteger(result.rows) && result.rows >= 0, 'CAPTURE_ROW_COUNT_INVALID');
        const summary = validatePayload(result.bytes, relation, result.rows);
        await save(`relation:${summary.identity}`, result.bytes); relations.push(summary);
      } finally { result.bytes?.fill(0); }
    }
    const index = validateStorageIndex(await source.storageIndex());
    const schema = await source.captureSchema();
    try {
      requireRelease(Array.isArray(schema.statements) && schema.statements.length > 0
        && schema.statements.every(x => typeof x === 'string' && x.length > 0), 'CAPTURE_SCHEMA_MISSING');
      const bytes = Buffer.from(JSON.stringify({ format: 'current-baseline-schema-original-v1', statements: schema.statements,
        objects: release.baseline.objects, ledger: release.baseline.ledger, globals: schema.globals }));
      try { await save('schema-original', bytes); } finally { bytes.fill(0); }
    } finally { schema.statements = []; schema.globals = null; }
    const end = await source.end();
    assertFencedBaseline(end.inventory, release.baseline, release.contract);
    requireRelease(end.fenceCount === 1, 'CAPTURE_FENCE_LOST');
    phase = 'storage-originals';
    for (const object of index) {
      await stable();
      const original = await checkedOriginal(source, object);
      try {
        const sha256 = createHash('sha256').update(original).digest('hex');
        const bytes = Buffer.from(JSON.stringify({ format: 'current-baseline-storage-object-v1', identity: object.identity,
          bytes: original.length, sha256, base64: original.toString('base64') }));
        try { await save(`storage:${object.identity}`, bytes, { original_sha256: sha256, original_bytes: original.length }); }
        finally { bytes.fill(0); }
        storageObjects.push({ ...object, sha256 });
      } finally { original.fill(0); }
    }
    phase = 'fresh-snapshot-comparison';
    const after = await source.begin();
    requireRelease(after.readOnly === true && after.isolation === 'repeatable read' && after.fenceCount === 1
      && after.projectRef === release.contract.projectRef && after.systemIdentifier === release.contract.systemIdentifier, 'CAPTURE_SOURCE_IDENTITY_INVALID');
    assertFencedBaseline(after.inventory, release.baseline, release.contract);
    const afterRelations = [];
    for (const relation of expectedRelations) {
      await stable(); const result = await source.captureRelation(relation);
      try { afterRelations.push(validatePayload(result.bytes, relation, result.rows)); } finally { result.bytes?.fill(0); }
    }
    same(afterRelations, relations, 'CAPTURE_SOURCE_DATA_CHANGED');
    same(validateStorageIndex(await source.storageIndex()), index, 'CAPTURE_STORAGE_INDEX_CHANGED');
    // Storage/sequence는 MVCC 대상이 아니므로 별도 새 읽기로 실제 bytes 안정성까지 비교한다.
    for (const object of storageObjects) {
      await stable(); const original = await checkedOriginal(source, object);
      try { requireRelease(digest(original) === object.sha256, 'CAPTURE_STORAGE_BYTES_CHANGED'); } finally { original.fill(0); }
    }
    const final = await source.end();
    assertFencedBaseline(final.inventory, release.baseline, release.contract);
    requireRelease(final.fenceCount === 1, 'CAPTURE_FENCE_LOST');
    const indexBytes = Buffer.from(JSON.stringify({ format: 'current-baseline-storage-index-v1', objects: storageObjects }));
    try { await save('storage-index', indexBytes); } finally { indexBytes.fill(0); }
    await stable();
    same(artifacts.map(a => a.scope).sort(), [...expectedRelations.map(r => `relation:${relationIdentity(r)}`),
      'schema-original','storage-index',...index.map(o => `storage:${o.identity}`)].sort(), 'CAPTURE_SCOPE_INCOMPLETE');
    const receipt = { version: 1, kind: 'current-baseline-capture-v1', status: 'captured-awaiting-release-evidence',
      projectRef: release.contract.projectRef, releaseCommit: expectedCommit, contractSha256: release.contractSha256,
      baselineSha256: release.baselineSha256, migrationSetSha256: release.migrationSetSha256, backupSetId,
      startedAt, capturedAt: now().toISOString(), format: 'hbam2-encrypted-current-user', plaintextWrittenToDisk: false,
      directory: 'encrypted', artifacts, relations, beforeRelations: relations, afterRelations,
      objects: release.baseline.objects, ledger: release.baseline.ledger, fencedObjects: before.inventory.objects,
      frozenStoragePolicies: before.inventory.storagePolicies, storageObjects: storageObjects.map(({identity,sha256,bytes}) => ({identity,sha256,bytes})),
      commands: [...commands,...source.commandReceipts()], snapshotIdentitySha256: digest(before.snapshotId),
      evidenceNotEstablished: ['source-platform-writer-controls','signed-upload-drain','provider-backup','hosted-restore','hosted-staging','release-authorization'] };
    await sink.finish(receipt);
    return receipt;
  } catch (error) {
    await source.abort().catch(() => {});
    if (initialized) await sink.fail({ status: 'incomplete-do-not-restore', phase, artifactCount: artifacts.length }).catch(() => {});
    // SDK/SQL/HTTP 原文은 exception chain에도 넘기지 않는다.
    const code = /^[A-Z][A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'CAPTURE_FAILED';
    throw Object.assign(new Error(code), { code });
  }
}
