import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { canonical, CurrentBaselineBlocked, digest, pinnedArtifact, same } from './current-baseline-release-contract.mjs';
import { loadWeddingCodeSceneV10ReleasePlan, WEDDING_CODE_SCENE_V10_CHECK_DEFINITION,
  WEDDING_CODE_SCENE_V10_PREVIOUS_CHECK_DEFINITION } from './wedding-code-research-scene-v10-release-contract.mjs';
// 235가 넓힌 뒤의 기대 catalog(234 객체 + v0.8·v0.9 CHECK)를 그대로 쓴다. 235 런타임 원문은 235 계약이 sha256으로 고정한다.
import { expectedWeddingCodeSceneVersionCatalog, WEDDING_CODE_SCENE_VERSION_MIGRATION_NAME,
  WEDDING_CODE_SCENE_VERSION_VERSION } from './wedding-code-research-scene-v09-release.mjs';
// 234가 만든 객체의 관측식은 234 런타임 것을 그대로 쓴다(235와 같은 관측식).
import { weddingCodeResearchPreservedCatalogSql, weddingCodeResearchTargetCatalogSql } from './wedding-code-research-contributions-release.mjs';

const MODE = '--wedding-code-research-scene-v10';
const PROJECT = 'slrtobkksjmxgzatjyqb';
const SYSTEM = '7581440907192989109';
const RELEASE = 'wedding-code-research-scene-v10-20260918';
export const WEDDING_CODE_SCENE_V10_VERSION = '20260918090000';
export const WEDDING_CODE_SCENE_V10_MIGRATION_NAME = 'wedding_code_research_scene_v10';
const PREDECESSOR = Object.freeze({ version: WEDDING_CODE_SCENE_VERSION_VERSION, name: WEDDING_CODE_SCENE_VERSION_MIGRATION_NAME });
const CONTRIBUTIONS = 'public.wedding_code_research_contributions';
const SCENE_CONSTRAINT = 'wcr_contributions_scene_version';
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
// 선행 235 릴리스(장면 버전 v0.9 허용)는 migration SQL이 정확히 235개인 checkout에서만 실행된다.
// 이 커밋은 235를 origin/main에 넣은 병합 커밋이며, 그 뒤 235 런타임·계약 JSON·SQL은 바뀌지 않았다.
const PREDECESSOR_RELEASE = Object.freeze({ mode: '--wedding-code-research-scene-v09',
  release: 'wedding-code-research-scene-v09-20260917', commit: 'd643b5f49043ac2a97752cd5df516a9ba8d402e0' });
const predecessorMissingAction = () => [
  `운영 schema_migrations에 선행 migration ${PREDECESSOR.version}(${PREDECESSOR.name})이 없어서 원격에 쓰지 않고 멈췄어요.`,
  'WeddingCode 장면 v0.9 허용 릴리스(235)를 먼저 적용해야 해요. 이 checkout은 migration SQL이 236개라서 그 릴리스를 실행할 수 없어요.',
  `1) migration SQL이 235개인 커밋 ${PREDECESSOR_RELEASE.commit}의 깨끗한 checkout에서 `
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

export function parseWeddingCodeSceneV10ReleaseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if ([MODE, '--inspect', '--rehearse', '--apply'].includes(arg)) {
      const key = arg === MODE ? 'selected' : 'mode';
      requireValue(!Object.hasOwn(result, key), 'WEDDING_CODE_SCENE_V10_ARGUMENT_DUPLICATE');
      result[key] = arg === MODE ? true : arg.slice(2);
      continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|confirm-production)=(.+)$/.exec(arg);
    requireValue(match && !Object.hasOwn(result, match[1]), 'WEDDING_CODE_SCENE_V10_ARGUMENT_INVALID');
    result[match[1]] = match[2];
  }
  requireValue(result.selected && result.mode && /^[a-f0-9]{40}$/.test(result['expected-commit'] ?? '')
    && result['project-ref'] === PROJECT && isAbsolute(result['receipt-out'] ?? ''), 'WEDDING_CODE_SCENE_V10_ARGUMENT_INVALID');
  requireValue(result['confirm-production'] === `${RELEASE}:${PROJECT}:${result.mode}:${result['expected-commit']}`,
    'WEDDING_CODE_SCENE_V10_CONFIRMATION_REQUIRED');
  return result;
}

export function weddingCodeSceneV10LedgerDigestSql(exclude = false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>${literal(WEDDING_CODE_SCENE_V10_VERSION)}` : ''})`;
}
const ledgerRow = version => `(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(version)})`;

// 234가 만든 두 테이블과 함수 세 개의 정의·권한만 읽는다(234·235와 같은 관측식). 연구 응답 행은 읽지 않는다.
export function buildWeddingCodeSceneV10ObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('format','wedding-code-research-scene-v10-catalog-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),
 'catalog',${weddingCodeResearchTargetCatalogSql()},'preservedCatalogSha',${weddingCodeResearchPreservedCatalogSql()},
 'ledgerSha',${weddingCodeSceneV10LedgerDigestSql()},'ledgerWithoutTargetSha',${weddingCodeSceneV10LedgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',${ledgerRow(WEDDING_CODE_SCENE_V10_VERSION)},'predecessor',${ledgerRow(PREDECESSOR.version)}) AS observation; COMMIT;`;
}

// 기대 catalog. 적용 전은 235가 넓힌 그대로(v0.8·v0.9), 적용 뒤는 그 CHECK 정의 한 줄만 세 값으로 바뀐다.
// 나머지 열·제약·인덱스·ACL·정책·트리거와 함수 세 개의 본문·설정·ACL은 적용 전후가 같다.
// storeSql은 두 테이블·세 함수를 만든 234 원문이다(235·236 원문에는 함수 본문이 없다).
export function expectedWeddingCodeSceneV10Catalog(storeSql, applied) {
  const catalog = expectedWeddingCodeSceneVersionCatalog(storeSql, true);
  const relation = catalog.relations.find(value => value.name === CONTRIBUTIONS);
  const scene = relation?.constraints.filter(row => row[0] === SCENE_CONSTRAINT) ?? [];
  requireValue(catalog.relations.length === 2 && catalog.functions.length === 3 && scene.length === 1
    && canonical(scene[0]) === canonical([SCENE_CONSTRAINT, 'c', true, WEDDING_CODE_SCENE_V10_PREVIOUS_CHECK_DEFINITION]),
  'WEDDING_CODE_SCENE_V10_PREDECESSOR_CATALOG_INVALID');
  if (applied) scene[0][3] = WEDDING_CODE_SCENE_V10_CHECK_DEFINITION;
  return catalog;
}

function sortedTree(value) {
  if (Array.isArray(value)) {
    const children = value.map(sortedTree);
    return value.some(child => child && typeof child === 'object')
      ? children.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : children;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort().map(([key, child]) => [key, sortedTree(child)]));
  return value;
}

// PostgreSQL의 jsonb 정렬로 기대 catalog를 만든다. tuple 내부 필드 순서는 유지한다.
function expectedJsonSql(value) {
  if (Array.isArray(value) && value.some(child => child && typeof child === 'object'))
    return `(SELECT jsonb_agg(v ORDER BY v::text) FROM (VALUES ${value.map(child => `(${expectedJsonSql(child)})`).join(',')}) q(v))`;
  if (value && typeof value === 'object' && !Array.isArray(value))
    return `jsonb_build_object(${Object.entries(value).flatMap(([key, child]) => [literal(key), expectedJsonSql(child)]).join(',')})`;
  return `${literal(JSON.stringify(value))}::jsonb`;
}

export function validateWeddingCodeSceneV10Catalog(catalog, storeSql, applied) {
  same(sortedTree(catalog), sortedTree(expectedWeddingCodeSceneV10Catalog(storeSql, applied)),
    'WEDDING_CODE_SCENE_V10_TARGET_CATALOG_DRIFT');
}

export function validateWeddingCodeSceneV10Observation(observed, { sql, predecessorSql, storeSql, now }) {
  requireValue(observed?.format === 'wedding-code-research-scene-v10-catalog-v1' && observed.readOnly === true
    && observed.systemIdentifier === SYSTEM && observed.database === 'postgres' && observed.currentUser === 'postgres'
    && /^17\./.test(observed.serverVersion ?? '') && observed.catalog && typeof observed.catalog === 'object'
    && [observed.preservedCatalogSha, observed.ledgerSha, observed.ledgerWithoutTargetSha].every(value => MD5.test(value ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0, 'WEDDING_CODE_SCENE_V10_OBSERVATION_INVALID');
  const at = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at) && at <= now.getTime() + 10_000 && at > now.getTime() - MAX_AGE_MS, 'WEDDING_CODE_SCENE_V10_OBSERVATION_EXPIRED');
  const expectedPredecessor = { ...PREDECESSOR, statementCount: 1, sqlMd5: md5(predecessorSql) };
  if (observed.predecessor === null) fail('WEDDING_CODE_SCENE_V10_PREDECESSOR_NOT_APPLIED', predecessorMissingAction());
  if (canonical(observed.predecessor) !== canonical(expectedPredecessor))
    fail('WEDDING_CODE_SCENE_V10_PREDECESSOR_LEDGER_MISMATCH', predecessorMismatchAction(observed.predecessor, expectedPredecessor));
  if (observed.migration !== null) {
    same(observed.migration, { version: WEDDING_CODE_SCENE_V10_VERSION, name: WEDDING_CODE_SCENE_V10_MIGRATION_NAME, statementCount: 1,
      sqlMd5: md5(sql) }, 'WEDDING_CODE_SCENE_V10_LEDGER_CONFLICT');
  } else requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'WEDDING_CODE_SCENE_V10_LEDGER_CONFLICT');
  validateWeddingCodeSceneV10Catalog(observed.catalog, storeSql, observed.migration !== null);
  return observed;
}

function unwrap(sql) {
  const body = sql.replace(/^[\s\S]*?\bBEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  requireValue(body !== sql && !/\bCOMMIT\s*;/i.test(body) && !/\bROLLBACK\s*;/i.test(body), 'WEDDING_CODE_SCENE_V10_SQL_ENVELOPE_INVALID');
  return body;
}

export function buildWeddingCodeSceneV10MutationSql({ sql, storeSql, before, deadline, rehearsal }) {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline) && before?.migration === null
    && [before.ledgerSha, before.preservedCatalogSha].every(value => MD5.test(value ?? '')), 'WEDDING_CODE_SCENE_V10_BUNDLE_INVALID');
  validateWeddingCodeSceneV10Catalog(before.catalog, storeSql, false);
  // 연구 응답 행은 읽지 않는다. 기존 행이 새 CHECK를 어기면 ADD CONSTRAINT가 실패해 전체가 되돌아간다.
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
SELECT pg_advisory_xact_lock(60918,1);
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $wedding_code_scene_v10_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>${literal(SYSTEM)} OR current_database()<>'postgres'
 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_DEADLINE_EXPIRED'; END IF;
 IF ${weddingCodeResearchTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${weddingCodeResearchPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${weddingCodeSceneV10LedgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_BASELINE_DRIFT'; END IF;
END $wedding_code_scene_v10_before$;
${unwrap(sql)}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(WEDDING_CODE_SCENE_V10_VERSION)},${literal(WEDDING_CODE_SCENE_V10_MIGRATION_NAME)},ARRAY[${literal(sql)}]::text[]);
DO $wedding_code_scene_v10_after$ BEGIN
 IF ${weddingCodeResearchTargetCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(expectedWeddingCodeSceneV10Catalog(storeSql, true))}
 OR ${weddingCodeResearchPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${weddingCodeSceneV10LedgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'WEDDING_CODE_SCENE_V10_DEADLINE_EXPIRED'; END IF;
END $wedding_code_scene_v10_after$;
${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}

function assertGitSource(repoRoot, expectedCommit) {
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'WEDDING_CODE_SCENE_V10_SOURCE_NOT_CLEAN_EXACT_COMMIT');
}

export function appendWeddingCodeSceneV10Receipt(fd, value, { write = writeSync, flush = fsyncSync } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes, offset, bytes.length - offset, null);
    requireValue(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset, 'WEDDING_CODE_SCENE_V10_RECEIPT_WRITE_INCOMPLETE');
    offset += written;
  }
  flush(fd);
}

function openReceipt(file) {
  const target = resolve(file), parent = dirname(target);
  let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    requireValue(lstatSync(cursor).isDirectory() && !lstatSync(cursor).isSymbolicLink(), 'WEDDING_CODE_SCENE_V10_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'WEDDING_CODE_SCENE_V10_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append: value => appendWeddingCodeSceneV10Receipt(fd, value), close: () => closeSync(fd) };
}

async function managementQuery(sql, accessToken) {
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: false }), signal: AbortSignal.timeout(45_000),
    });
    requireValue(response.ok, 'WEDDING_CODE_SCENE_V10_REMOTE_OUTCOME_UNVERIFIED');
    const text = await response.text();
    requireValue(Buffer.byteLength(text) <= 256 * 1024, 'WEDDING_CODE_SCENE_V10_REMOTE_OUTCOME_UNVERIFIED');
    const rows = JSON.parse(text);
    requireValue(Array.isArray(rows), 'WEDDING_CODE_SCENE_V10_REMOTE_OUTCOME_UNVERIFIED');
    return rows;
  } catch { fail('WEDDING_CODE_SCENE_V10_REMOTE_OUTCOME_UNVERIFIED'); }
}

// 주입 의존성은 오프라인 검사 전용이다. CLI는 고정 HTTPS 대상과 실제 Git·원문 핀을 쓴다.
export async function runWeddingCodeSceneV10Release({ repoRoot, argv, now = () => new Date(),
  query, assertSource = assertGitSource, receiptFactory = openReceipt } = {}) {
  const options = parseWeddingCodeSceneV10ReleaseArgs(argv ?? []);
  const plan = loadWeddingCodeSceneV10ReleasePlan(repoRoot);
  const pin = plan.contract.migrations[0];
  const sql = pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` }).toString('utf8');
  const predecessorSql = pinnedArtifact(repoRoot, plan.contract.predecessorMigration).toString('utf8');
  const storeSql = pinnedArtifact(repoRoot, plan.contract.catalogBaseMigration).toString('utf8');
  const context = { sql, predecessorSql, storeSql };
  assertSource(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token ?? ''), 'WEDDING_CODE_SCENE_V10_CREDENTIAL_UNAVAILABLE');
    query = text => managementQuery(text, token);
  }
  const receipt = receiptFactory(options['receipt-out']);
  const binding = { format: 'wedding-code-research-scene-v10-runtime-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT, releaseCommit: options['expected-commit'], contractSha256: plan.contractSha256,
    sqlSha256: plan.migrationSha256, runtimeSha256: plan.contract.runtime.sha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildWeddingCodeSceneV10ObservationSql());
    requireValue(Array.isArray(rows) && rows.length === 1, 'WEDDING_CODE_SCENE_V10_OBSERVATION_INVALID');
    return validateWeddingCodeSceneV10Observation(rows[0].observation, { ...context, now: now() });
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
    const rehearseSql = buildWeddingCodeSceneV10MutationSql({ ...context, before, deadline, rehearsal: true });
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearseSql) });
    mutationStarted = true;
    await query(rehearseSql);
    const rolledBack = await observe();
    for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'migration', 'predecessor'])
      same(rolledBack[key], before[key], 'WEDDING_CODE_SCENE_V10_REHEARSAL_NOT_ROLLED_BACK');
    record('rehearsed-and-rolled-back', { after: rolledBack });
    if (options.mode === 'rehearse') return { status: 'rehearsed-and-rolled-back', before, after: rolledBack, remoteWritesPerformed: false };
    requireValue(now().getTime() < Date.parse(deadline), 'WEDDING_CODE_SCENE_V10_DEADLINE_EXPIRED');
    assertSource(repoRoot, options['expected-commit']);
    // 적용 직전 원문과 구현도 다시 검증한다. 과거 rehearsal 영수증을 믿고 바로 적용하지 않는다.
    const freshPlan = loadWeddingCodeSceneV10ReleasePlan(repoRoot);
    same(freshPlan.contractSha256, plan.contractSha256, 'WEDDING_CODE_SCENE_V10_SOURCE_CHANGED');
    const applySql = buildWeddingCodeSceneV10MutationSql({ ...context, before, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(applySql) });
    await query(applySql);
    const after = await observe();
    requireValue(after.migration !== null && after.ledgerCount === before.ledgerCount + 1
      && after.ledgerWithoutTargetSha === before.ledgerSha, 'WEDDING_CODE_SCENE_V10_POST_APPLY_UNVERIFIED');
    same(after.preservedCatalogSha, before.preservedCatalogSha, 'WEDDING_CODE_SCENE_V10_POST_APPLY_CATALOG_DRIFT');
    record('applied-and-postverified', { after });
    return { status: 'applied-and-postverified', before, after, remoteWritesPerformed: true };
  } catch (error) {
    const code = /^[A-Z_0-9]+$/.test(error?.code ?? '') ? error.code : 'WEDDING_CODE_SCENE_V10_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); } catch { /* 앞서 fsync한 결과 미확정 기록을 유지한다. */ }
    // 변경 전 차단일 때만 이 모듈의 안내 문구를 넘긴다. 변경을 시작했으면 결과 미확정이므로 안내를 붙이지 않는다.
    const operatorAction = !mutationStarted && error instanceof CurrentBaselineBlocked ? error.operatorAction : undefined;
    fail(mutationStarted ? 'WEDDING_CODE_SCENE_V10_OUTCOME_REQUIRES_INSPECTION' : code, operatorAction);
  } finally { receipt.close(); }
}
