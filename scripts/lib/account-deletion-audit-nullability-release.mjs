import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { CurrentBaselineBlocked, digest, pinnedArtifact, same } from './current-baseline-release-contract.mjs';
import { loadDeletionAuditNullabilityReleasePlan } from './account-deletion-audit-nullability-release-contract.mjs';

const MODE = '--account-deletion-audit-nullability';
const PROJECT = 'slrtobkksjmxgzatjyqb';
const SYSTEM = '7581440907192989109';
const RELEASE = 'account-deletion-audit-nullability-20260928';
const VERSION = '20260928073546';
const MAX_AGE_MS = 120_000;
const MD5 = /^[a-f0-9]{32}$/;
const md5 = bytes => createHash('md5').update(bytes).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const fail = code => { throw new CurrentBaselineBlocked(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };

export function parseDeletionAuditReleaseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if ([MODE, '--inspect', '--rehearse', '--apply'].includes(arg)) {
      const key = arg === MODE ? 'selected' : 'mode';
      requireValue(!Object.hasOwn(result, key), 'DELETION_AUDIT_ARGUMENT_DUPLICATE');
      result[key] = arg === MODE ? true : arg.slice(2);
      continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|confirm-production)=(.+)$/.exec(arg);
    requireValue(match && !Object.hasOwn(result, match[1]), 'DELETION_AUDIT_ARGUMENT_INVALID');
    result[match[1]] = match[2];
  }
  requireValue(result.selected && result.mode && /^[a-f0-9]{40}$/.test(result['expected-commit'] ?? '')
    && result['project-ref'] === PROJECT && isAbsolute(result['receipt-out'] ?? ''), 'DELETION_AUDIT_ARGUMENT_INVALID');
  requireValue(result['confirm-production'] === `${RELEASE}:${PROJECT}:${result.mode}:${result['expected-commit']}`,
    'DELETION_AUDIT_CONFIRMATION_REQUIRED');
  return result;
}

function loadSql(repoRoot, plan) {
  const pin = plan.contract.migrations[0];
  return pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` }).toString('utf8');
}

// 고정 migration과 동일한 catalog 관측식을 쓴다. 다른 컬럼·권한을 비교에서 빼지 않는다.
function catalogSelect(sql) {
  const match = /    (SELECT jsonb_build_object\([\s\S]+?\)) INTO observed_catalog;/.exec(sql);
  requireValue(match, 'DELETION_AUDIT_CATALOG_QUERY_INVALID');
  return match[1];
}

function ledgerDigest(version, exclude) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
    ORDER BY version)::text,'[]')) FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version <> ${literal(version)}` : ''})`;
}

export function buildDeletionAuditObservationSql(sql, version) {
  requireValue(version === VERSION, 'DELETION_AUDIT_VERSION_INVALID');
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object(
 'format','account-deletion-audit-catalog-v1', 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'serverVersion',current_setting('server_version'), 'database',current_database(), 'readOnly',current_setting('transaction_read_only')='on',
 'observedAt',clock_timestamp(), 'catalog',(${catalogSelect(sql)}),
 'notNull',(SELECT attnotnull FROM pg_attribute WHERE attrelid='public.account_deletions'::regclass AND attname='user_id' AND NOT attisdropped),
 'ledgerSha',${ledgerDigest(version, false)}, 'ledgerWithoutTargetSha',${ledgerDigest(version, true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),
   'sqlMd5',md5(statements[1])) FROM supabase_migrations.schema_migrations WHERE version=${literal(version)})
) AS observation; COMMIT;`;
}

export function validateDeletionAuditObservation(observed, { sql, version, now }) {
  requireValue(observed?.format === 'account-deletion-audit-catalog-v1' && observed.readOnly === true
    && observed.systemIdentifier === SYSTEM && observed.database === 'postgres'
    && /^17\./.test(observed.serverVersion ?? '') && typeof observed.notNull === 'boolean'
    && observed.catalog && Array.isArray(observed.catalog.columns)
    && observed.catalog.relation && typeof observed.catalog.relation === 'object'
    && MD5.test(observed.ledgerSha ?? '') && MD5.test(observed.ledgerWithoutTargetSha ?? '')
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0,
  'DELETION_AUDIT_OBSERVATION_INVALID');
  const at = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at) && at <= now.getTime() + 10_000 && at > now.getTime() - MAX_AGE_MS,
    'DELETION_AUDIT_OBSERVATION_EXPIRED');
  const columns = observed.catalog.columns.filter(column => column.name === 'user_id');
  requireValue(columns.length === 1 && columns[0].type === '2950' && columns[0].generated === ''
    && columns[0].identity === '' && columns[0].default === null && columns[0].not_null === null,
    'DELETION_AUDIT_USER_COLUMN_UNEXPECTED');
  if (observed.migration !== null) {
    same(observed.migration, { version, name: 'account_deletion_anonymous_audit', statementCount: 1,
      sqlMd5: md5(sql) }, 'DELETION_AUDIT_LEDGER_CONFLICT');
    requireValue(observed.notNull === false, 'DELETION_AUDIT_LEDGER_SCHEMA_DRIFT');
  } else requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'DELETION_AUDIT_LEDGER_CONFLICT');
  return observed;
}

export function buildDeletionAuditMutationSql({ sql, version, before, deadline, rehearsal }) {
  requireValue(version === VERSION && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline)
    && typeof rehearsal === 'boolean' && typeof before?.notNull === 'boolean'
    && before.migration === null && MD5.test(before.ledgerSha), 'DELETION_AUDIT_BUNDLE_INVALID');
  const body = sql.replace(/^([\s\S]*?)BEGIN;\s*/, '$1').replace(/COMMIT;\s*$/, '');
  requireValue(body !== sql && !/\bCOMMIT\s*;/i.test(body), 'DELETION_AUDIT_SQL_ENVELOPE_INVALID');
  return `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SET LOCAL standard_conforming_strings=on;
SELECT pg_advisory_xact_lock(60928,1);
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.account_deletions IN ACCESS EXCLUSIVE MODE;
DO $deletion_audit_release_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) <> ${literal(SYSTEM)} OR current_database() <> 'postgres'
   OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'DELETION_AUDIT_TARGET_DRIFT'; END IF;
 IF clock_timestamp() > ${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'DELETION_AUDIT_DEADLINE_EXPIRED'; END IF;
 IF (${catalogSelect(sql)}) IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
   OR (SELECT attnotnull FROM pg_attribute WHERE attrelid='public.account_deletions'::regclass AND attname='user_id') IS DISTINCT FROM ${before.notNull}
   OR ${ledgerDigest(version, false)} IS DISTINCT FROM ${literal(before.ledgerSha)}
   THEN RAISE EXCEPTION 'DELETION_AUDIT_BASELINE_DRIFT'; END IF;
END $deletion_audit_release_before$;
${body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(version)},'account_deletion_anonymous_audit',ARRAY[${literal(sql)}]::text[]);
DO $deletion_audit_release_after$ BEGIN
 IF (SELECT attnotnull FROM pg_attribute WHERE attrelid='public.account_deletions'::regclass AND attname='user_id') IS DISTINCT FROM false
   OR (${catalogSelect(sql)}) IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
   OR ${ledgerDigest(version, true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
   THEN RAISE EXCEPTION 'DELETION_AUDIT_AFTER_DRIFT'; END IF;
 IF clock_timestamp() > ${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'DELETION_AUDIT_DEADLINE_EXPIRED'; END IF;
END $deletion_audit_release_after$;
${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}

function assertGitSource(repoRoot, expectedCommit) {
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'DELETION_AUDIT_SOURCE_NOT_CLEAN_EXACT_COMMIT');
}

export function appendDeletionAuditReceipt(fd, value, { write = writeSync, flush = fsyncSync } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes, offset, bytes.length - offset, null);
    requireValue(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset,
      'DELETION_AUDIT_RECEIPT_WRITE_INCOMPLETE');
    offset += written;
  }
  flush(fd);
}

function openReceipt(file) {
  const target = resolve(file), parent = dirname(target);
  let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    requireValue(lstatSync(cursor).isDirectory() && !lstatSync(cursor).isSymbolicLink(), 'DELETION_AUDIT_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'DELETION_AUDIT_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append: value => appendDeletionAuditReceipt(fd, value), close: () => closeSync(fd) };
}

async function managementQuery(sql, accessToken) {
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: false }), signal: AbortSignal.timeout(45_000),
    });
    requireValue(response.ok, 'DELETION_AUDIT_REMOTE_OUTCOME_UNVERIFIED');
    const text = await response.text();
    requireValue(Buffer.byteLength(text) <= 256 * 1024, 'DELETION_AUDIT_REMOTE_OUTCOME_UNVERIFIED');
    const rows = JSON.parse(text);
    requireValue(Array.isArray(rows), 'DELETION_AUDIT_REMOTE_OUTCOME_UNVERIFIED');
    return rows;
  } catch { fail('DELETION_AUDIT_REMOTE_OUTCOME_UNVERIFIED'); }
}

// 주입 의존성은 오프라인 검사 전용이다. CLI는 고정 HTTPS 대상과 실제 Git·원문 핀을 쓴다.
export async function runDeletionAuditNullabilityRelease({ repoRoot, argv, now = () => new Date(),
  query, assertSource = assertGitSource, receiptFactory = openReceipt } = {}) {
  const options = parseDeletionAuditReleaseArgs(argv ?? []);
  // 영수증 생성으로 검증 중인 소스가 dirty가 되지 않게 Git 작업 경로 밖만 허용한다.
  const receiptRelative = relative(realpathSync(repoRoot), resolve(options['receipt-out']));
  requireValue(receiptRelative === '..' || receiptRelative.startsWith(`..${sep}`) || isAbsolute(receiptRelative),
    'DELETION_AUDIT_RECEIPT_PATH_INVALID');
  const plan = loadDeletionAuditNullabilityReleasePlan(repoRoot);
  const sql = loadSql(repoRoot, plan), version = plan.contract.migrations[0].file.slice(0, 14);
  assertSource(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token ?? ''), 'DELETION_AUDIT_CREDENTIAL_UNAVAILABLE');
    query = text => managementQuery(text, token);
  }
  const receipt = receiptFactory(options['receipt-out']);
  const binding = { format: 'account-deletion-audit-nullability-runtime-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT, releaseCommit: options['expected-commit'], contractSha256: plan.contractSha256,
    sqlSha256: plan.migrationSha256, runtimeSha256: plan.contract.runtime.sha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildDeletionAuditObservationSql(sql, version));
    requireValue(Array.isArray(rows) && rows.length === 1, 'DELETION_AUDIT_OBSERVATION_INVALID');
    return validateDeletionAuditObservation(rows[0].observation, { sql, version, now: now() });
  };
  let mutationStarted = false;
  try {
    record('started');
    const before = await observe();
    record('before-observed', { before, catalogSha256: digest(JSON.stringify(before.catalog)) });
    if (options.mode === 'inspect' || before.migration) {
      const status = before.migration ? 'already-applied-verified' : 'inspected-unapplied';
      record(status);
      return { status, before, remoteWritesPerformed: false };
    }
    const deadline = new Date(now().getTime() + MAX_AGE_MS).toISOString();
    const rehearseSql = buildDeletionAuditMutationSql({ sql, version, before, deadline, rehearsal: true });
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearseSql) });
    requireValue(now().getTime() < Date.parse(deadline), 'DELETION_AUDIT_DEADLINE_EXPIRED');
    mutationStarted = true;
    await query(rehearseSql);
    const rolledBack = await observe();
    for (const key of ['catalog', 'notNull', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'migration'])
      same(rolledBack[key], before[key], 'DELETION_AUDIT_REHEARSAL_NOT_ROLLED_BACK');
    record('rehearsed-and-rolled-back', { after: rolledBack });
    if (options.mode === 'rehearse') return { status: 'rehearsed-and-rolled-back', before, after: rolledBack, remoteWritesPerformed: false };
    requireValue(now().getTime() < Date.parse(deadline), 'DELETION_AUDIT_DEADLINE_EXPIRED');
    assertSource(repoRoot, options['expected-commit']);
    // 적용 직전 원문과 구현도 다시 검증한다. 과거 rehearsal 영수증을 믿고 바로 적용하지 않는다.
    const freshPlan = loadDeletionAuditNullabilityReleasePlan(repoRoot);
    same(freshPlan.contractSha256, plan.contractSha256, 'DELETION_AUDIT_SOURCE_CHANGED');
    const applySql = buildDeletionAuditMutationSql({ sql, version, before, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(applySql) });
    requireValue(now().getTime() < Date.parse(deadline), 'DELETION_AUDIT_DEADLINE_EXPIRED');
    await query(applySql);
    const after = await observe();
    requireValue(after.notNull === false && after.migration !== null
      && after.ledgerCount === before.ledgerCount + 1 && after.ledgerWithoutTargetSha === before.ledgerSha,
    'DELETION_AUDIT_POST_APPLY_UNVERIFIED');
    same(after.catalog, before.catalog, 'DELETION_AUDIT_POST_APPLY_CATALOG_DRIFT');
    record('applied-and-postverified', { after });
    return { status: 'applied-and-postverified', before, after, remoteWritesPerformed: true };
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'DELETION_AUDIT_UNEXPECTED';
    record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted });
    fail(mutationStarted ? 'DELETION_AUDIT_OUTCOME_REQUIRES_INSPECTION' : code);
  } finally { receipt.close(); }
}
