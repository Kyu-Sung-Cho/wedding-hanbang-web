import { createRequire } from 'node:module';
import { archiveProcessEnvironment, assertArchiveTool, runNativeArchiveProcess } from './postgres-snapshot-archive.mjs';
import { relationCaptureSql } from './current-baseline-backup-collector.mjs';
import { RecoveryStageError, requireRecovery, recoveryDigest } from './recovery-artifact-set.mjs';

const require = createRequire(import.meta.url);
const identitySql = `SELECT current_database() AS database, current_user AS actor,
 host(inet_server_addr()) AS address, inet_server_port() AS port,
 current_setting('listen_addresses') AS listen,
 current_setting('server_version_num')::integer AS version,
 (SELECT system_identifier::text FROM pg_control_system()) AS system`;
const relationsSql = `SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 AND n.nspname NOT LIKE 'pg_temp_%' AND c.relkind IN ('r','p','m','S','v')
 ORDER BY n.nspname,c.relname`;
const identity = row => `${row.schema}.${row.name}`;

/** Real native pg_restore execution, currently callable only for a hard-coded synthetic source.
 * Production source ingestion is intentionally absent until a reviewed private transport and
 * observed full-service isolation exist. No release/admission JSON boolean can enable it.
 * It restores the complete archive (owner/ACL/triggers retained), then compares every captured
 * durable relation using the producer's SQL. This is a DB stage, not Auth/Storage service proof.
 */
export async function restoreSyntheticDatabaseStage({ bundle, connection, targetSystemIdentifier,
  pgRestore, pgRestoreSha256, checkpoint, runProcess = runNativeArchiveProcess }) {
  requireRecovery(bundle.binding.source.projectRef === 'syntheticlocalonly00', 'RECOVERY_CUSTOMER_ADMISSION_NOT_IMPLEMENTED');
  requireRecovery(connection && connection.host === '127.0.0.1' && Number.isSafeInteger(connection.port)
    && connection.port > 1024 && connection.port <= 65535
    && /^hanbang_restore_[a-f0-9]{32}$/.test(connection.database) && connection.user === 'postgres'
    && typeof connection.password === 'string' && connection.password.length >= 24
    && /^[0-9]{10,24}$/.test(targetSystemIdentifier)
    && targetSystemIdentifier !== bundle.binding.source.systemIdentifier, 'RECOVERY_TARGET_INVALID');
  requireRecovery(typeof checkpoint === 'function', 'RECOVERY_DURABLE_CHECKPOINT_REQUIRED');
  assertArchiveTool(pgRestore, pgRestoreSha256);
  const { Client } = require('pg');
  const client = new Client({ host: connection.host, port: connection.port, user: connection.user,
    password: connection.password, database: connection.database, ssl: false, options: '',
    application_name: 'hanbang-synthetic-recovery-stage', connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000 });
  let phase = 'target-preflight', restoreAttempted = false, restoreCompleted = false;
  try {
    await client.connect();
    const checkIdentity = async () => {
      const { rows } = await client.query(identitySql), row = rows[0];
      requireRecovery(rows.length === 1 && row.database === connection.database && row.actor === connection.user
        && row.address === '127.0.0.1' && row.listen === '127.0.0.1' && row.port === connection.port
        && row.version >= 170000 && row.version < 180000 && row.system === targetSystemIdentifier,
      'RECOVERY_TARGET_IDENTITY_CHANGED');
    };
    await checkIdentity();
    const before = (await client.query(relationsSql)).rows;
    requireRecovery(before.length === 0, 'RECOVERY_TARGET_NOT_EMPTY');
    const sourceRoleNames = bundle.schema.globals.roles.map(role => role.rolname);
    requireRecovery(sourceRoleNames.every(name => typeof name === 'string'), 'RECOVERY_ROLE_CONTRACT_INVALID');
    const roles = (await client.query('SELECT rolname FROM pg_roles ORDER BY rolname')).rows.map(row => row.rolname);
    requireRecovery(sourceRoleNames.every(name => roles.includes(name)), 'RECOVERY_TARGET_ROLE_MISSING');
    await checkpoint({ phase: 'before-database-restore', targetSystemIdentifier,
      backupSetId: bundle.binding.backupSetId, archiveSha256: bundle.archiveEnvelope.archiveSha256 });
    await checkIdentity();
    requireRecovery((await client.query(relationsSql)).rows.length === 0, 'RECOVERY_TARGET_CHANGED_BEFORE_RESTORE');
    assertArchiveTool(pgRestore, pgRestoreSha256);
    phase = 'database-restore'; restoreAttempted = true;
    const env = archiveProcessEnvironment({ PGHOST: connection.host, PGPORT: String(connection.port),
      PGDATABASE: connection.database, PGUSER: connection.user, PGPASSWORD: connection.password, PGSSLMODE: 'disable' });
    // The reused archive env defaults to read-only for collection. Only this exact target restore
    // process changes that setting; no service file, connection URL or source environment is inherited.
    env.PGOPTIONS = '-c statement_timeout=120000 -c lock_timeout=5000';
    const result = await runProcess({ file: pgRestore,
      args: ['--exit-on-error', '--single-transaction', '--no-password', '--dbname=' + connection.database],
      env, input: bundle.archive, maximumBytes: 1024 * 1024, timeoutMs: 150000 });
    result.buffer?.fill(0); restoreCompleted = true;
    phase = 'database-compare'; await checkIdentity();
    const after = (await client.query(relationsSql)).rows;
    const durable = after.filter(row => row.kind !== 'v');
    requireRecovery(JSON.stringify(durable.map(identity).sort()) === JSON.stringify(bundle.relations.map(row => row.identity).sort()),
      'RECOVERY_RELATION_COVERAGE_MISMATCH');
    for (const relation of durable) {
      const expected = bundle.relations.find(row => row.identity === identity(relation));
      const result = (await client.query(relationCaptureSql(relation))).rows[0];
      requireRecovery(typeof result?.payload === 'string' && Number(result.rows) === expected.rows,
        'RECOVERY_RELATION_COUNT_MISMATCH');
      const bytes = Buffer.from(result.payload, 'utf8');
      try { requireRecovery(bytes.length === expected.bytes && recoveryDigest(bytes) === expected.sha256,
        'RECOVERY_RELATION_BYTES_MISMATCH'); } finally { bytes.fill(0); }
    }
    const receipt = { kind: 'synthetic-target-database-stage-v1', phase: 'database-verified',
      databaseStageExecuted: true, restoredDurableRelations: durable.length, relationPayloadsMatched: true,
      archiveSha256: bundle.archiveEnvelope.archiveSha256, targetSystemIdentifier,
      backupSetId: bundle.binding.backupSetId, storageServiceVerified: false, authServiceVerified: false,
      schemaGlobalsFullyCompared: false, deletionReplayVerified: false, fullRestoreVerified: false, releaseAuthorized: false };
    await checkpoint(receipt); return receipt;
  } catch (error) {
    const code = error instanceof RecoveryStageError ? error.code : 'RECOVERY_NATIVE_STAGE_FAILED';
    try { await checkpoint({ phase, code, restoreAttempted, restoreCompleted, partialTargetRetained: restoreAttempted,
      backupSetId: bundle.binding.backupSetId, targetSystemIdentifier, fullRestoreVerified: false, releaseAuthorized: false }); } catch {}
    throw new RecoveryStageError(code);
  } finally { await client.end().catch(() => {}); }
}
