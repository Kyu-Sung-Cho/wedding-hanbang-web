import { createHash } from 'node:crypto';
import { pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadProviderParticipationReleasePlan } from './provider-participation-release-contract.mjs';
import { buildProviderObservationSql, validateProviderObservation } from './provider-participation-catalog.mjs';
import { createProviderReleaseNativeDatabase, nativeProviderReleaseAvailable } from '../tests/fixtures/provider-release-native-database.mjs';

const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export function providerTransactionBody(sql) {
  requireRelease((sql.match(/^BEGIN;\s*$/gm) ?? []).length === 1 && (sql.match(/^COMMIT;\s*$/gm) ?? []).length === 1
    && /COMMIT;\s*$/.test(sql), 'PROVIDER_RELEASE_SQL_ENVELOPE_INVALID');
  return sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
}
export function providerBundleParts(repoRoot, plan) {
  const policy = pinnedArtifact(repoRoot, plan.contract.platformPolicy).toString('utf8');
  const migrations = plan.contract.migrations.map(pin => ({ ...pin,
    sql: pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` }).toString('utf8') }));
  return { policy, migrations };
}
export function expectedProviderLedger(parts) {
  return parts.migrations.map(({ file, sql }) => ({ version: file.slice(0, 14), name: file.slice(15, -4), statementCount: 1,
    sqlMd5: createHash('md5').update(sql).digest('hex') }));
}
export function buildProviderLocalBundle({ parts, localSystemIdentifier, productionSystemIdentifier }) {
  requireRelease(/^\d+$/.test(localSystemIdentifier ?? '') && localSystemIdentifier !== productionSystemIdentifier,
    'PROVIDER_RELEASE_LOCAL_TARGET_REQUIRED');
  // An owned loopback-only cluster is required in addition to the runtime factory.
  // The production system identifier is expressly refused, even through a tunnel.
  const guard = `DO $provider_local_only$ BEGIN
    IF (SELECT system_identifier::text FROM pg_control_system())<>${literal(localSystemIdentifier)}
      OR (SELECT system_identifier::text FROM pg_control_system())=${literal(productionSystemIdentifier)}
      OR current_setting('listen_addresses')<>'127.0.0.1' OR current_user<>'postgres'
      OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
    THEN RAISE EXCEPTION 'PROVIDER_RELEASE_LOCAL_TARGET_REQUIRED'; END IF;
    END $provider_local_only$;`;
  const ledger = parts.migrations.map(({ file, sql }) => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES(${literal(file.slice(0, 14))},${literal(file.slice(15, -4))},ARRAY[${literal(sql)}]::text[]);`).join('\n');
  // Deliberately no COMMIT: the only runner executes postconditions, then ROLLBACK.
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL standard_conforming_strings=on;
    ${guard}\n${parts.policy}\n${parts.migrations.map(item => providerTransactionBody(item.sql)).join('\n')}\n${ledger}`;
}

export async function runProviderLocalRehearsal(repoRoot) {
  const plan = loadProviderParticipationReleasePlan(repoRoot);
  requireRelease(nativeProviderReleaseAvailable, 'PROVIDER_RELEASE_LOCAL_PG17_UNAVAILABLE');
  const parts = providerBundleParts(repoRoot, plan);
  const fixture = JSON.parse(pinnedArtifact(repoRoot, plan.contract.catalogFixture));
  const owned = await createProviderReleaseNativeDatabase(repoRoot, plan.predecessorMigrations);
  const db = owned.client;
  let transactionOpen = false;
  try {
    const existingTables = (await db.query("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','auth') ORDER BY n.nspname,c.relname")).rows;
    const localRows = async () => {
      const result = {};
      for (const table of existingTables) {
        requireRelease(/^[a-z_]+$/.test(table.schema) && /^[a-z_]+$/.test(table.name), 'PROVIDER_RELEASE_LOCAL_FIXTURE_INVALID');
        result[`${table.schema}.${table.name}`] = (await db.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS digest FROM "${table.schema}"."${table.name}" t`)).rows[0].digest;
      }
      return result;
    };
    const beforeRows = await localRows();
    const observe = async (phase, inside = false) => {
      // Within the write rehearsal, SET TRANSACTION READ ONLY cannot be used after
      // DDL. The same catalog SELECT is checked here; independent before/after reads
      // always run the complete read-only envelope.
      const sql = buildProviderObservationSql();
      const response = await db.query(inside ? sql.replace('BEGIN TRANSACTION READ ONLY;', '').replace(/COMMIT;\s*$/, '') : sql);
      const result = Array.isArray(response) ? response.find(item => item.rows?.[0]?.observation)?.rows[0].observation : response.rows[0].observation;
      return validateProviderObservation(result, { expectedSystem: owned.system, expectedTarget: fixture[phase],
        expectedLedger: phase === 'before' ? [] : expectedProviderLedger(parts), expectedCount: phase === 'before' ? 240 : 243,
        expectedReadOnly: !inside });
    };
    const before = await observe('before');
    const bundle = buildProviderLocalBundle({ parts, localSystemIdentifier: owned.system, productionSystemIdentifier: plan.contract.systemIdentifier });
    transactionOpen = true; await db.query(bundle);
    const expanded = await observe('after', true);
    same(expanded.preservation, before.preservation, 'PROVIDER_RELEASE_NON_TARGET_DRIFT');
    same(await localRows(), beforeRows, 'PROVIDER_RELEASE_LOCAL_EXISTING_DATA_DRIFT');
    await db.query('ROLLBACK'); transactionOpen = false;
    const rolledBack = await observe('before');
    same(rolledBack.target, before.target, 'PROVIDER_RELEASE_ROLLBACK_TARGET_DRIFT');
    same(rolledBack.preservation, before.preservation, 'PROVIDER_RELEASE_ROLLBACK_PRESERVATION_DRIFT');
    same(await localRows(), beforeRows, 'PROVIDER_RELEASE_LOCAL_EXISTING_DATA_DRIFT');
    let lateFailure = false;
    try { transactionOpen = true; await db.query(`${bundle}\nSELECT 1 / 0;`); }
    catch (error) { if (error.code !== '22012') throw error; lateFailure = true; }
    finally { if (transactionOpen) { await db.query('ROLLBACK'); transactionOpen = false; } }
    requireRelease(lateFailure, 'PROVIDER_RELEASE_LATE_FAILURE_NOT_TESTED');
    const failedRollback = await observe('before');
    same(failedRollback.preservation, before.preservation, 'PROVIDER_RELEASE_LATE_FAILURE_ROLLBACK_DRIFT');
    same(await localRows(), beforeRows, 'PROVIDER_RELEASE_LOCAL_EXISTING_DATA_DRIFT');
    return { status: 'local-synthetic-rollback-verified', serverVersion: before.serverVersion, migrationCount: plan.migrationCount,
      contractSha256: plan.contractSha256, exactTargetVerified: true, nonTargetPreservationVerified: true, existingSyntheticRowsPreserved: true,
      rollbackVerified: true, lateFailureRollbackVerified: true, remoteCalls: 0, customerData: false,
      productionApplyImplemented: false, runtimeEvidenceVerified: false, releaseAuthorized: false };
  } finally { if (transactionOpen) await db.query('ROLLBACK').catch(() => {}); await owned.close(); }
}
