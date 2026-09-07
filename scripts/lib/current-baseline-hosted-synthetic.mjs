import { createHash } from 'node:crypto';
import { canonical, digest, digestJson, loadCurrentBaselineContract, pinnedArtifact } from './current-baseline-release-contract.mjs';
import { runSyntheticScenarios, syntheticIds } from './current-baseline-hosted-synthetic-scenarios.mjs';

const REF = /^[a-z0-9]{20}$/;
const SHA = /^[a-f0-9]{64}$/;
export class SyntheticBlocked extends Error {
  constructor(code) { super(code); this.name = 'SyntheticBlocked'; this.code = code; }
}
export function ensure(value, code) { if (!value) throw new SyntheticBlocked(code); }

function skipSqlTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) { index++; continue; }
    if (source.startsWith('--', index)) { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end + 1; continue; }
    if (!source.startsWith('/*', index)) break;
    let depth = 1; index += 2;
    while (index < source.length && depth) {
      if (source.startsWith('/*', index)) { depth++; index += 2; }
      else if (source.startsWith('*/', index)) { depth--; index += 2; } else index++;
    }
    ensure(depth === 0, 'SQL_LEXING_INVALID');
  }
  return index;
}

// Dollar-quoted 함수 본문의 BEGIN/COMMIT은 건드리지 않는다. 최상위 트랜잭션 탈출만 거절한다.
export function transactionBody(source) {
  const statements = []; let start = 0; let i = 0;
  while (i < source.length) {
    const afterTrivia = skipSqlTrivia(source, i);
    if (afterTrivia !== i) { i = afterTrivia; continue; }
    const quote = source[i];
    if (quote === "'" || quote === '"') {
      const escape = quote === "'" && /(?:^|[^\w$])[eE]$/.test(source.slice(0, i)); i++;
      let closed = false;
      while (i < source.length) {
        if (escape && source[i] === '\\') i += 2;
        else if (source[i] === quote && source[i + 1] === quote) i += 2;
        else if (source[i++] === quote) { closed = true; break; }
      }
      ensure(closed, 'SQL_LEXING_INVALID'); continue;
    }
    const tag = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
    if (tag) { const end = source.indexOf(tag, i + tag.length); ensure(end >= 0, 'SQL_LEXING_INVALID'); i = end + tag.length; continue; }
    if (source[i++] === ';') { statements.push(source.slice(start, i)); start = i; }
  }
  if (source.slice(start).trim()) statements.push(source.slice(start));
  const withoutComments = statement => statement.slice(skipSqlTrivia(statement, 0)).trim();
  const entries = statements.map(sql => ({ sql, code: withoutComments(sql) })).filter(row => row.code);
  const wrapped = /^BEGIN(?:\s+TRANSACTION(?:\s+READ\s+ONLY)?)?\s*;$/i.test(entries[0]?.code ?? '');
  if (wrapped) {
    ensure(/^COMMIT\s*;$/i.test(entries.at(-1)?.code ?? ''), 'SQL_ENVELOPE_INVALID');
    entries.shift(); entries.pop();
  }
  for (const { code } of entries) {
    ensure(!/^(?:BEGIN|START|COMMIT|END|ROLLBACK|ABORT|PREPARE)\b/i.test(code), 'SQL_TRANSACTION_ESCAPE');
    ensure(!/^(?:COPY|VACUUM|CALL|CREATE\s+(?:DATABASE|SUBSCRIPTION)|ALTER\s+SYSTEM)\b/i.test(code), 'SQL_EXTERNAL_OPERATION');
  }
  return entries.map(row => row.sql).join('\n');
}

export function inventoryFingerprint(observation) {
  return digestJson({ systemIdentifier: observation.systemIdentifier, serverVersion: observation.serverVersion,
    objects: observation.objects, relations: observation.relations, ledger: observation.ledger,
    storageStructureSha256: observation.storageStructureSha256, storagePolicies: observation.storagePolicies,
    vaultRows: observation.vaultRows, cronJobs: observation.cronJobs });
}

export function validateTargetPlan(plan, release, { commit, now = new Date() }) {
  ensure(plan?.format === 'current-baseline-hosted-synthetic-target-v1', 'TARGET_PLAN_INVALID');
  ensure(REF.test(plan.projectRef) && plan.projectRef !== release.contract.projectRef, 'PRODUCTION_TARGET_FORBIDDEN');
  ensure(/^\d{10,32}$/.test(plan.systemIdentifier) && plan.systemIdentifier !== release.contract.systemIdentifier, 'PRODUCTION_SYSTEM_FORBIDDEN');
  ensure(plan.releaseCommit === commit && /^[a-f0-9]{40}$/.test(commit), 'RELEASE_COMMIT_MISMATCH');
  ensure(plan.contractSha256 === release.contractSha256 && plan.migrationSetSha256 === release.migrationSetSha256, 'RELEASE_PIN_MISMATCH');
  ensure(SHA.test(plan.inventorySha256), 'TARGET_INVENTORY_PIN_REQUIRED');
  ensure(/^60907000-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(plan.namespace), 'SYNTHETIC_NAMESPACE_INVALID');
  const approved = Date.parse(plan.approvedAt), expires = Date.parse(plan.expiresAt);
  ensure(Number.isFinite(approved) && approved <= now.getTime() && expires > now.getTime()
    && expires - approved <= 24 * 60 * 60_000, 'TARGET_APPROVAL_EXPIRED');
  ensure(plan.isolatedSyntheticTarget === true && SHA.test(plan.isolationEvidenceSha256), 'TARGET_ISOLATION_EVIDENCE_REQUIRED');
  ensure(plan.isolationEvidenceSha256 !== digest(''), 'TARGET_ISOLATION_EVIDENCE_REQUIRED');
  return plan;
}

export function validatedConnectionConfig(connectionString, ca, plan, productionRef) {
  let url; try { url = new URL(connectionString); } catch { throw new SyntheticBlocked('DATABASE_URL_INVALID'); }
  ensure(['postgres:', 'postgresql:'].includes(url.protocol) && url.password && !url.search && !url.hash, 'DATABASE_URL_INVALID');
  ensure(plan.projectRef !== productionRef && !url.hostname.includes(productionRef) && !decodeURIComponent(url.username).includes(productionRef), 'PRODUCTION_TARGET_FORBIDDEN');
  const direct = url.hostname === `db.${plan.projectRef}.supabase.co` && url.port === '5432' && decodeURIComponent(url.username) === 'postgres';
  const sessionPooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    && url.port === '5432' && decodeURIComponent(url.username) === `postgres.${plan.projectRef}`;
  ensure((direct || sessionPooler) && url.pathname === '/postgres', 'DATABASE_TARGET_MISMATCH');
  ensure(typeof ca === 'string' && ca.includes('-----BEGIN CERTIFICATE-----') && digest(ca) === plan.tlsCaSha256, 'DATABASE_CA_PIN_MISMATCH');
  return { connectionString, ssl: { ca, rejectUnauthorized: true }, application_name: 'hanbang-rollback-only-synthetic',
    connectionTimeoutMillis: 15_000, query_timeout: 65_000, statement_timeout: 30_000 };
}

const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
const identitySql = `SELECT system_identifier::text AS system_identifier FROM pg_control_system()`;
const sequenceSql = `SELECT schemaname,sequencename,last_value::text FROM pg_sequences
 WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' ORDER BY schemaname,sequencename`;
const outboundSql = `SELECT extname AS name FROM pg_extension WHERE extname IN('pg_net','http','dblink','postgres_fdw')
 UNION ALL SELECT 'foreign-server:'||srvname FROM pg_foreign_server ORDER BY name`;

async function observe(db, inventorySql) {
  const result = await db.query(inventorySql);
  const rows = Array.isArray(result) ? result.flatMap(part => part.rows ?? []) : result.rows;
  const values = rows?.filter(row => row.observation).map(row => row.observation);
  ensure(values?.length === 1, 'DATABASE_OBSERVATION_MISSING'); return values[0];
}

// PGlite/PG 모두 같은 runner를 사용한다. CLI는 아래 주입점을 노출하지 않는다.
export async function runHostedSynthetic({ db, release, plan, commit, inventorySql, now = new Date(),
  scenarios = runSyntheticScenarios }) {
  validateTargetPlan(plan, release, { commit, now });
  const report = { format: 'current-baseline-hosted-synthetic-rehearsal-v1', projectRef: plan.projectRef,
    releaseCommit: commit, contractSha256: release.contractSha256, migrationSetSha256: release.migrationSetSha256,
    namespace: plan.namespace, startedAt: now.toISOString(), status: 'failed',
    evidenceComplete: false, missingEvidence: ['hosted HTTP feature-flags-off checks', 'multi-connection concurrent writes', 'independent hosted isolation verification'],
    migrations: [], checks: [], rollback: { verified: false } };
  let transactionStarted = false; let writeStarted = false; let before; let sequences; let primaryError;
  try {
    const identity = (await db.query(identitySql)).rows?.[0]?.system_identifier;
    ensure(identity && identity !== release.contract.systemIdentifier, 'PRODUCTION_SYSTEM_FORBIDDEN');
    ensure(identity === plan.systemIdentifier, 'DATABASE_SYSTEM_MISMATCH');
    // 알려진 DB 외부 통신 경로는 실행 전에 거절한다. 플랫폼 통신 격리는 별도 검증이다.
    ensure((await db.query(outboundSql)).rows.length === 0, 'DATABASE_OUTBOUND_CAPABILITY_PRESENT');
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted = true;
    before = await observe(db, inventorySql);
    ensure(before.systemIdentifier === plan.systemIdentifier && before.readOnly === true, 'DATABASE_OBSERVATION_INVALID');
    ensure(inventoryFingerprint(before) === plan.inventorySha256, 'DATABASE_BASELINE_DRIFT');
    ensure(before.vaultRows === 0 && before.cronJobs === 0, 'DATABASE_EXTERNAL_STATE_PRESENT');
    ensure(release.migrations.every(pin => !before.ledger.some(row => row.version === pin.version)), 'TARGET_MIGRATION_ALREADY_APPLIED');
    sequences = (await db.query(sequenceSql)).rows;
    await db.query('ROLLBACK'); transactionStarted = false;

    await db.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE'); transactionStarted = true; writeStarted = true;
    await db.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='90s'");
    const tables = before.relations.filter(row => ['r', 'p'].includes(row.kind) && ['public', 'auth', 'storage'].includes(row.schema))
      .map(row => `${quoteIdentifier(row.schema)}.${quoteIdentifier(row.name)}`);
    ensure(tables.length > 0 && tables.length <= 500, 'DATABASE_RELATION_SCOPE_INVALID');
    await db.query(`LOCK TABLE ${tables.join(',')} IN ACCESS EXCLUSIVE MODE`);
    const locked = await observe(db, inventorySql);
    ensure(inventoryFingerprint(locked) === plan.inventorySha256, 'DATABASE_BASELINE_CHANGED_BEFORE_LOCK');
    ensure(canonical((await db.query(sequenceSql)).rows) === canonical(sequences), 'DATABASE_SEQUENCE_CHANGED_BEFORE_LOCK');
    const ids = syntheticIds(plan.namespace);
    const collision = await db.query('SELECT count(*)::integer AS count FROM auth.users WHERE id=ANY($1::uuid[])', [[ids.owner, ids.partner, ids.outsider]]);
    ensure(collision.rows[0]?.count === 0, 'SYNTHETIC_NAMESPACE_COLLISION');
    for (const pin of release.migrations) {
      ensure(digest(pin.sql) === pin.sha256, 'MIGRATION_BYTES_CHANGED');
      const body = transactionBody(pin.sql.toString('utf8'));
      await db.query(body);
      report.migrations.push({ file: pin.file, sha256: pin.sha256, bodySha256: digest(body), execution: 'inside-rollback-transaction' });
    }
    report.checks = await scenarios(db, ids);
    ensure(report.checks.length >= 6 && report.checks.every(check => check.status === 'passed' && SHA.test(check.rawEvidenceSha256)), 'SYNTHETIC_CHECKS_INCOMPLETE');
    report.proposedSchema = await observe(db, inventorySql);
    report.beforeSchemaSha256 = inventoryFingerprint(before);
    report.proposedSchemaSha256 = inventoryFingerprint(report.proposedSchema);
  } catch (error) { primaryError = error; }
  finally {
    if (transactionStarted) {
      try { await db.query('ROLLBACK'); transactionStarted = false; }
      catch { primaryError = new SyntheticBlocked('ROLLBACK_UNCONFIRMED'); }
    }
  }
  if (before && writeStarted && !transactionStarted) {
    try {
      await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const after = await observe(db, inventorySql);
      ensure(inventoryFingerprint(after) === inventoryFingerprint(before), 'ROLLBACK_SCHEMA_OR_LEDGER_CHANGED');
      ensure(canonical((await db.query(sequenceSql)).rows) === canonical(sequences), 'ROLLBACK_SEQUENCE_CHANGED');
      const ids = syntheticIds(plan.namespace);
      const remaining = (await db.query('SELECT count(*)::integer AS count FROM auth.users WHERE id=ANY($1::uuid[])', [[ids.owner, ids.partner, ids.outsider]])).rows[0]?.count;
      ensure(remaining === 0, 'ROLLBACK_SYNTHETIC_ROWS_REMAIN');
      report.rollback = { verified: true, beforeSha256: inventoryFingerprint(before), afterSha256: inventoryFingerprint(after), syntheticUserCount: remaining,
        sequencesSha256: digestJson(sequences) };
    } catch (error) { primaryError = error; }
    finally { try { await db.query('ROLLBACK'); } catch { primaryError = new SyntheticBlocked('ROLLBACK_UNCONFIRMED'); report.rollback.verified = false; } }
  }
  report.status = primaryError ? 'failed' : 'passed-rollback-rehearsal-only';
  // DB 오류의 detail/query/주소/개인 원문은 증거 파일과 stdout 어디에도 복사하지 않는다.
  if (primaryError) report.failureCode = primaryError instanceof SyntheticBlocked ? primaryError.code
    : /^[A-Z0-9]{5}$/.test(primaryError?.code ?? '') ? `DATABASE_SQLSTATE_${primaryError.code}` : 'SYNTHETIC_EXECUTION_FAILED';
  report.finishedAt = new Date().toISOString();
  return report;
}

export function loadRehearsalSource(repoRoot) {
  const release = loadCurrentBaselineContract(repoRoot);
  const inventory = pinnedArtifact(repoRoot, release.contract.implementation.inventory).toString('utf8');
  return { release, inventorySql: transactionBody(inventory), inventorySha256: createHash('sha256').update(inventory).digest('hex') };
}
