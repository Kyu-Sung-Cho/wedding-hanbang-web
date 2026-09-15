import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { canonical, CurrentBaselineBlocked, digest, pinnedArtifact, same } from './current-baseline-release-contract.mjs';
import { loadNotApplicableStatusReleasePlan } from './amora-not-applicable-status-release-contract.mjs';

const MODE = '--amora-not-applicable-status';
const PROJECT = 'slrtobkksjmxgzatjyqb';
const SYSTEM = '7581440907192989109';
const RELEASE = 'amora-not-applicable-status-20260915';
export const NOT_APPLICABLE_VERSION = '20260915101500';
export const NOT_APPLICABLE_MIGRATION_NAME = 'amora_atomic_not_applicable_status';
const PREDECESSOR = Object.freeze({ version: '20260913103407', name: 'account_deletion_customer_data_boundary' });
export const NOT_APPLICABLE_FUNCTION = 'apply_amora_atomic_tool_execution_pre_shared_revision';
// 이전 정의와 같아야 하는 선언부. 본문 MD5만 바뀌고 소유자·권한·설정은 그대로여야 한다.
export const NOT_APPLICABLE_FUNCTION_SHAPE = Object.freeze({
  args: 'uuid, text, text, integer, text, jsonb, jsonb, jsonb', result: 'jsonb', language: 'plpgsql', owner: 'postgres',
  securityDefiner: true, volatility: 'v', strict: false, parallel: 'u', kind: 'f',
  config: ['search_path=pg_catalog, public', 'lock_timeout=5s', 'statement_timeout=15s'],
});
const FORBIDDEN_GRANTEES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const MAX_AGE_MS = 120_000;
const MD5 = /^[a-f0-9]{32}$/;
const md5 = value => createHash('md5').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
// operatorAction은 이 모듈이 정한 안내 문구만 담는다. 원격 응답·예외 원문은 message에 싣지 않는다.
const fail = (code, operatorAction) => {
  const error = new CurrentBaselineBlocked(code);
  if (typeof operatorAction === 'string') Object.assign(error, { message: operatorAction, operatorAction });
  throw error;
};
const requireValue = (condition, code) => { if (!condition) fail(code); };
// 선행 232 릴리스(계정 삭제 고객 데이터 경계)는 migration SQL이 정확히 232개인 checkout에서만 실행된다.
// 이 커밋은 origin/main에 병합된 232개 기준이며, 그 뒤 계정 삭제 런타임·카탈로그·계약은 바뀌지 않았다.
const PREDECESSOR_RELEASE = Object.freeze({ mode: '--account-deletion-customer-data', release: 'account-deletion-customer-data-20260913',
  commit: '0c747b1dba8d20e15b902f9ba2d1154888127776' });
const predecessorMissingAction = () => [
  `운영 schema_migrations에 선행 migration ${PREDECESSOR.version}(${PREDECESSOR.name})이 없어서 원격에 쓰지 않고 멈췄어요.`,
  '계정 삭제 릴리스를 먼저 적용해야 해요. 이 checkout은 migration SQL이 233개라서 그 릴리스를 실행할 수 없어요.',
  `1) migration SQL이 232개인 커밋 ${PREDECESSOR_RELEASE.commit}의 깨끗한 checkout에서 `
    + `node scripts/supabase-production-release.mjs ${PREDECESSOR_RELEASE.mode} --inspect, --rehearse, --apply 순서로 실행하세요.`
    + ` 각 단계 인자: --expected-commit=${PREDECESSOR_RELEASE.commit} --project-ref=${PROJECT} --receipt-out=<새 절대 경로>`
    + ` --confirm-production=${PREDECESSOR_RELEASE.release}:${PROJECT}:<mode>:${PREDECESSOR_RELEASE.commit}`,
  '2) apply 영수증의 마지막 status가 applied-and-postverified인지 확인하세요.',
  `3) 그다음 이 커밋의 깨끗한 checkout에서 ${MODE} --inspect부터 다시 실행하세요.`,
  'schema_migrations에 행을 손으로 넣지 마세요.',
].join('\n');
const predecessorMismatchAction = (observed, expected) => [
  `운영 schema_migrations의 ${PREDECESSOR.version} 행이 검토한 원문과 달라서 원격에 쓰지 않고 멈췄어요.`,
  `기대값 ${JSON.stringify(expected)}`,
  `관측값 ${JSON.stringify(observed ?? null).slice(0, 400)}`,
  '선행 migration을 다시 적용하거나 이 행을 고치지 마세요. 이 행을 누가 어떤 경로로 기록했는지 먼저 확인하세요.',
  '이 릴리스를 계속하려면 실제 운영 행에 맞춘 별도 검토 계약이 필요해요.',
].join('\n');

export function parseNotApplicableReleaseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if ([MODE, '--inspect', '--rehearse', '--apply'].includes(arg)) {
      const key = arg === MODE ? 'selected' : 'mode';
      requireValue(!Object.hasOwn(result, key), 'NOT_APPLICABLE_ARGUMENT_DUPLICATE');
      result[key] = arg === MODE ? true : arg.slice(2);
      continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|confirm-production)=(.+)$/.exec(arg);
    requireValue(match && !Object.hasOwn(result, match[1]), 'NOT_APPLICABLE_ARGUMENT_INVALID');
    result[match[1]] = match[2];
  }
  requireValue(result.selected && result.mode && /^[a-f0-9]{40}$/.test(result['expected-commit'] ?? '')
    && result['project-ref'] === PROJECT && isAbsolute(result['receipt-out'] ?? ''), 'NOT_APPLICABLE_ARGUMENT_INVALID');
  requireValue(result['confirm-production'] === `${RELEASE}:${PROJECT}:${result.mode}:${result['expected-commit']}`,
    'NOT_APPLICABLE_CONFIRMATION_REQUIRED');
  return result;
}

// PostgreSQL prosrc는 `AS $function$`와 닫는 `$function$` 사이 원문이다. 원문 MD5로 정의를 대조한다.
export function notApplicableFunctionBody(sql) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${NOT_APPLICABLE_FUNCTION}(`);
  const match = /AS \$function\$([\s\S]*?)\$function\$/.exec(sql.slice(Math.max(start, 0)));
  requireValue(start >= 0 && match, 'NOT_APPLICABLE_FUNCTION_SOURCE_INVALID');
  return match[1];
}

const aclSql = `(SELECT COALESCE(jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)
 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a)`;
export function notApplicableFunctionCatalogSql() {
  return `(SELECT COALESCE(jsonb_agg(jsonb_build_object('args',oidvectortypes(p.proargtypes),'result',pg_get_function_result(p.oid),
 'language',l.lanname,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'volatility',p.provolatile,
 'strict',p.proisstrict,'parallel',p.proparallel,'kind',p.prokind,'config',to_jsonb(p.proconfig),'bodyMd5',md5(p.prosrc),'acl',${aclSql})
 ORDER BY oidvectortypes(p.proargtypes)),'[]'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.proname=${literal(NOT_APPLICABLE_FUNCTION)})`;
}
// 대상 함수 밖의 함수 정의·권한은 DB 안에서만 해시한다. 원문을 응답에 싣지 않는다.
export function notApplicablePreservedCatalogSql() {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(n.nspname,p.proname,oidvectortypes(p.proargtypes),
 md5(pg_get_functiondef(p.oid)),p.proacl::text) ORDER BY n.nspname,p.proname,oidvectortypes(p.proargtypes))::text,'[]'))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage') AND p.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND p.proname=${literal(NOT_APPLICABLE_FUNCTION)}))`;
}
function ledgerSql(exclude) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>${literal(NOT_APPLICABLE_VERSION)}` : ''})`;
}
const ledgerRow = version => `(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(version)})`;

export function buildNotApplicableObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('format','amora-not-applicable-status-catalog-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),
 'function',${notApplicableFunctionCatalogSql()},'preservedCatalogSha',${notApplicablePreservedCatalogSql()},
 'ledgerSha',${ledgerSql(false)},'ledgerWithoutTargetSha',${ledgerSql(true)},'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',${ledgerRow(NOT_APPLICABLE_VERSION)},'predecessor',${ledgerRow(PREDECESSOR.version)}) AS observation; COMMIT;`;
}

export function validateNotApplicableObservation(observed, { sql, previousSql, predecessorSql, now }) {
  requireValue(observed?.format === 'amora-not-applicable-status-catalog-v1' && observed.readOnly === true
    && observed.systemIdentifier === SYSTEM && observed.database === 'postgres' && observed.currentUser === 'postgres'
    && /^17\./.test(observed.serverVersion ?? '') && [observed.preservedCatalogSha, observed.ledgerSha, observed.ledgerWithoutTargetSha].every(v => MD5.test(v ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0, 'NOT_APPLICABLE_OBSERVATION_INVALID');
  const at = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at) && at <= now.getTime() + 10_000 && at > now.getTime() - MAX_AGE_MS, 'NOT_APPLICABLE_OBSERVATION_EXPIRED');
  const expectedPredecessor = { ...PREDECESSOR, statementCount: 1, sqlMd5: md5(predecessorSql) };
  if (observed.predecessor === null) fail('NOT_APPLICABLE_PREDECESSOR_NOT_APPLIED', predecessorMissingAction());
  if (canonical(observed.predecessor) !== canonical(expectedPredecessor))
    fail('NOT_APPLICABLE_PREDECESSOR_LEDGER_MISMATCH', predecessorMismatchAction(observed.predecessor, expectedPredecessor));
  requireValue(Array.isArray(observed.function) && observed.function.length === 1, 'NOT_APPLICABLE_FUNCTION_DRIFT');
  const [fn] = observed.function;
  const { bodyMd5, acl, ...shape } = fn ?? {};
  same(shape, NOT_APPLICABLE_FUNCTION_SHAPE, 'NOT_APPLICABLE_FUNCTION_DRIFT');
  requireValue(Array.isArray(acl) && acl.every(row => Array.isArray(row) && row.length === 4 && !FORBIDDEN_GRANTEES.includes(row[0])),
    'NOT_APPLICABLE_FUNCTION_ACL_DRIFT');
  if (observed.migration !== null) {
    same(observed.migration, { version: NOT_APPLICABLE_VERSION, name: NOT_APPLICABLE_MIGRATION_NAME, statementCount: 1, sqlMd5: md5(sql) },
      'NOT_APPLICABLE_LEDGER_CONFLICT');
    requireValue(bodyMd5 === md5(notApplicableFunctionBody(sql)), 'NOT_APPLICABLE_FUNCTION_DRIFT');
  } else {
    requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'NOT_APPLICABLE_LEDGER_CONFLICT');
    requireValue(bodyMd5 === md5(notApplicableFunctionBody(previousSql)), 'NOT_APPLICABLE_FUNCTION_DRIFT');
  }
  return observed;
}

function unwrap(sql) {
  const body = sql.replace(/^[\s\S]*?\bBEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  requireValue(body !== sql && !/\bCOMMIT\s*;/i.test(body), 'NOT_APPLICABLE_SQL_ENVELOPE_INVALID');
  return body;
}

export function buildNotApplicableMutationSql({ sql, before, deadline, rehearsal }) {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline) && before?.migration === null
    && [before.ledgerSha, before.preservedCatalogSha].every(v => MD5.test(v ?? '')) && Array.isArray(before.function)
    && before.function.length === 1, 'NOT_APPLICABLE_BUNDLE_INVALID');
  const expectedAfter = [{ ...before.function[0], bodyMd5: md5(notApplicableFunctionBody(sql)) }];
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
SELECT pg_advisory_xact_lock(60915,1);
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $not_applicable_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>${literal(SYSTEM)} OR current_database()<>'postgres'
 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'NOT_APPLICABLE_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'NOT_APPLICABLE_DEADLINE_EXPIRED'; END IF;
 IF ${notApplicableFunctionCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.function))}::jsonb
 OR ${notApplicablePreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerSql(false)} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'NOT_APPLICABLE_BASELINE_DRIFT'; END IF;
END $not_applicable_before$;
${unwrap(sql)}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(NOT_APPLICABLE_VERSION)},${literal(NOT_APPLICABLE_MIGRATION_NAME)},ARRAY[${literal(sql)}]::text[]);
DO $not_applicable_after$ BEGIN
 IF ${notApplicableFunctionCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(expectedAfter))}::jsonb
 OR ${notApplicablePreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'NOT_APPLICABLE_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'NOT_APPLICABLE_DEADLINE_EXPIRED'; END IF;
END $not_applicable_after$;
${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}

function assertGitSource(repoRoot, expectedCommit) {
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'NOT_APPLICABLE_SOURCE_NOT_CLEAN_EXACT_COMMIT');
}

export function appendNotApplicableReceipt(fd, value, { write = writeSync, flush = fsyncSync } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes, offset, bytes.length - offset, null);
    requireValue(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset, 'NOT_APPLICABLE_RECEIPT_WRITE_INCOMPLETE');
    offset += written;
  }
  flush(fd);
}

function openReceipt(file) {
  const target = resolve(file), parent = dirname(target);
  let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    requireValue(lstatSync(cursor).isDirectory() && !lstatSync(cursor).isSymbolicLink(), 'NOT_APPLICABLE_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'NOT_APPLICABLE_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append: value => appendNotApplicableReceipt(fd, value), close: () => closeSync(fd) };
}

async function managementQuery(sql, accessToken) {
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: false }), signal: AbortSignal.timeout(45_000),
    });
    requireValue(response.ok, 'NOT_APPLICABLE_REMOTE_OUTCOME_UNVERIFIED');
    const text = await response.text();
    requireValue(Buffer.byteLength(text) <= 256 * 1024, 'NOT_APPLICABLE_REMOTE_OUTCOME_UNVERIFIED');
    const rows = JSON.parse(text);
    requireValue(Array.isArray(rows), 'NOT_APPLICABLE_REMOTE_OUTCOME_UNVERIFIED');
    return rows;
  } catch { fail('NOT_APPLICABLE_REMOTE_OUTCOME_UNVERIFIED'); }
}

// 주입 의존성은 오프라인 검사 전용이다. CLI는 고정 HTTPS 대상과 실제 Git·원문 핀을 쓴다.
export async function runNotApplicableStatusRelease({ repoRoot, argv, now = () => new Date(),
  query, assertSource = assertGitSource, receiptFactory = openReceipt } = {}) {
  const options = parseNotApplicableReleaseArgs(argv ?? []);
  const plan = loadNotApplicableStatusReleasePlan(repoRoot);
  const pin = plan.contract.migrations[0];
  const sql = pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` }).toString('utf8');
  const previousSql = pinnedArtifact(repoRoot, plan.contract.previousFunction).toString('utf8');
  const predecessorSql = pinnedArtifact(repoRoot, plan.contract.predecessorMigration).toString('utf8');
  const context = { sql, previousSql, predecessorSql };
  assertSource(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token ?? ''), 'NOT_APPLICABLE_CREDENTIAL_UNAVAILABLE');
    query = text => managementQuery(text, token);
  }
  const receipt = receiptFactory(options['receipt-out']);
  const binding = { format: 'amora-not-applicable-status-runtime-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT, releaseCommit: options['expected-commit'], contractSha256: plan.contractSha256,
    sqlSha256: plan.migrationSha256, runtimeSha256: plan.contract.runtime.sha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildNotApplicableObservationSql());
    requireValue(Array.isArray(rows) && rows.length === 1, 'NOT_APPLICABLE_OBSERVATION_INVALID');
    return validateNotApplicableObservation(rows[0].observation, { ...context, now: now() });
  };
  let mutationStarted = false;
  try {
    record('started');
    const before = await observe();
    record('before-observed', { before });
    if (options.mode === 'inspect' || before.migration) {
      const status = before.migration ? 'already-applied-verified' : 'inspected-unapplied';
      record(status);
      return { status, before, remoteWritesPerformed: false };
    }
    const deadline = new Date(now().getTime() + MAX_AGE_MS).toISOString();
    const rehearseSql = buildNotApplicableMutationSql({ sql, before, deadline, rehearsal: true });
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearseSql) });
    mutationStarted = true;
    await query(rehearseSql);
    const rolledBack = await observe();
    for (const key of ['function', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'migration', 'predecessor'])
      same(rolledBack[key], before[key], 'NOT_APPLICABLE_REHEARSAL_NOT_ROLLED_BACK');
    record('rehearsed-and-rolled-back', { after: rolledBack });
    if (options.mode === 'rehearse') return { status: 'rehearsed-and-rolled-back', before, after: rolledBack, remoteWritesPerformed: false };
    requireValue(now().getTime() < Date.parse(deadline), 'NOT_APPLICABLE_DEADLINE_EXPIRED');
    assertSource(repoRoot, options['expected-commit']);
    // 적용 직전 원문과 구현도 다시 검증한다. 과거 rehearsal 영수증을 믿고 바로 적용하지 않는다.
    const freshPlan = loadNotApplicableStatusReleasePlan(repoRoot);
    same(freshPlan.contractSha256, plan.contractSha256, 'NOT_APPLICABLE_SOURCE_CHANGED');
    const applySql = buildNotApplicableMutationSql({ sql, before, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(applySql) });
    await query(applySql);
    const after = await observe();
    requireValue(after.migration !== null && after.ledgerCount === before.ledgerCount + 1
      && after.ledgerWithoutTargetSha === before.ledgerSha, 'NOT_APPLICABLE_POST_APPLY_UNVERIFIED');
    same(after.preservedCatalogSha, before.preservedCatalogSha, 'NOT_APPLICABLE_POST_APPLY_CATALOG_DRIFT');
    same({ ...after.function[0], bodyMd5: null }, { ...before.function[0], bodyMd5: null }, 'NOT_APPLICABLE_POST_APPLY_CATALOG_DRIFT');
    record('applied-and-postverified', { after });
    return { status: 'applied-and-postverified', before, after, remoteWritesPerformed: true };
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'NOT_APPLICABLE_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); } catch { /* 앞서 fsync한 결과 미확정 기록을 유지한다. */ }
    // 변경 전 차단일 때만 이 모듈의 안내 문구를 넘긴다. 변경을 시작했으면 결과 미확정이므로 안내를 붙이지 않는다.
    const operatorAction = !mutationStarted && error instanceof CurrentBaselineBlocked ? error.operatorAction : undefined;
    fail(mutationStarted ? 'NOT_APPLICABLE_OUTCOME_REQUIRES_INSPECTION' : code, operatorAction);
  } finally { receipt.close(); }
}
