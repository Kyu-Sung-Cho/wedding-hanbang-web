import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { canonical, CurrentBaselineBlocked, digest, pinnedArtifact, same } from './current-baseline-release-contract.mjs';
import { loadWeddingCodeResearchReleasePlan } from './wedding-code-research-contributions-release-contract.mjs';

const MODE = '--wedding-code-research-contributions';
const PROJECT = 'slrtobkksjmxgzatjyqb';
const SYSTEM = '7581440907192989109';
const RELEASE = 'wedding-code-research-contributions-20260915';
export const WEDDING_CODE_RESEARCH_VERSION = '20260915130000';
export const WEDDING_CODE_RESEARCH_MIGRATION_NAME = 'wedding_code_research_contributions';
const PREDECESSOR = Object.freeze({ version: '20260915101500', name: 'amora_atomic_not_applicable_status' });
export const WEDDING_CODE_RESEARCH_TABLES = Object.freeze(['wedding_code_research_contributions', 'wedding_code_research_deletion_tombstones']);
export const WEDDING_CODE_RESEARCH_FUNCTIONS = Object.freeze(['delete_wedding_code_research_contribution',
  'insert_wedding_code_research_contribution', 'purge_expired_wedding_code_research_contributions']);
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
// 선행 233 릴리스(아모라 not_applicable 상태)는 migration SQL이 정확히 233개인 checkout에서만 실행된다.
// 이 커밋은 origin/main에 병합된 233개 기준이며, 그 뒤 233 런타임·계약은 바뀌지 않았다.
const PREDECESSOR_RELEASE = Object.freeze({ mode: '--amora-not-applicable-status', release: 'amora-not-applicable-status-20260915',
  commit: '965f9f37ea486b7b6d8f9dcd8516e2eb7e381a31' });
const predecessorMissingAction = () => [
  `운영 schema_migrations에 선행 migration ${PREDECESSOR.version}(${PREDECESSOR.name})이 없어서 원격에 쓰지 않고 멈췄어요.`,
  '아모라 not_applicable 상태 릴리스를 먼저 적용해야 해요. 이 checkout은 migration SQL이 234개라서 그 릴리스를 실행할 수 없어요.',
  `1) migration SQL이 233개인 커밋 ${PREDECESSOR_RELEASE.commit}의 깨끗한 checkout에서 `
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

export function parseWeddingCodeResearchReleaseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if ([MODE, '--inspect', '--rehearse', '--apply'].includes(arg)) {
      const key = arg === MODE ? 'selected' : 'mode';
      requireValue(!Object.hasOwn(result, key), 'WEDDING_CODE_RESEARCH_ARGUMENT_DUPLICATE');
      result[key] = arg === MODE ? true : arg.slice(2);
      continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|confirm-production)=(.+)$/.exec(arg);
    requireValue(match && !Object.hasOwn(result, match[1]), 'WEDDING_CODE_RESEARCH_ARGUMENT_INVALID');
    result[match[1]] = match[2];
  }
  requireValue(result.selected && result.mode && /^[a-f0-9]{40}$/.test(result['expected-commit'] ?? '')
    && result['project-ref'] === PROJECT && isAbsolute(result['receipt-out'] ?? ''), 'WEDDING_CODE_RESEARCH_ARGUMENT_INVALID');
  requireValue(result['confirm-production'] === `${RELEASE}:${PROJECT}:${result.mode}:${result['expected-commit']}`,
    'WEDDING_CODE_RESEARCH_CONFIRMATION_REQUIRED');
  return result;
}

const names = values => values.map(literal).join(',');
const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]') FROM (${query}) q(v))`;
const acl = (expression, kind) => aggregate(`SELECT jsonb_build_array(
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
 FROM aclexplode(COALESCE(${expression},acldefault('${kind}',c.${kind === 'r' ? 'relowner' : 'proowner'}))) a`);
const columns = aggregate(`SELECT jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
 a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`);
// NOT NULL은 columns의 attnotnull로 본다. PG18부터 생기는 'n' 제약 행은 PG17 운영 catalog와 같게 뺀다.
const constraints = aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true))
 FROM pg_constraint WHERE conrelid=c.oid AND contype<>'n'`);
const indexes = aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready)
 FROM pg_index WHERE indrelid=c.oid`);
const policies = aggregate('SELECT to_jsonb(p)-\'oid\'-\'polrelid\' FROM pg_policy p WHERE polrelid=c.oid');
const triggers = aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal`);
const relation = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl', 'r')},
 'columns',${columns},'constraints',${constraints},'indexes',${indexes},'policies',${policies},'triggers',${triggers})`;
const functionShape = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,'kind',c.prokind,
 'config',c.proconfig,'body',c.prosrc,'acl',${acl('c.proacl', 'f')})`;

// 새 테이블 두 개와 함수 세 개의 정의·권한만 읽는다. 연구 응답 행이나 다른 고객 행은 읽지 않는다.
export function weddingCodeResearchTargetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${names(WEDDING_CODE_RESEARCH_TABLES)})`)},
 'functions',${aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${names(WEDDING_CODE_RESEARCH_FUNCTIONS)})`)})`;
}

// 새 객체만 제외한 기존 public/auth/storage catalog(과거 WeddingCode 수집 객체 포함)를 DB 안에서 해시한다.
export function weddingCodeResearchPreservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object(
 'relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','f')
 AND NOT(n.nspname='public' AND c.relname IN (${names(WEDDING_CODE_RESEARCH_TABLES)}))`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),
 md5(pg_get_functiondef(c.oid)),c.proacl) FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND c.proname IN (${names(WEDDING_CODE_RESEARCH_FUNCTIONS)}))`)}
 )::text))`;
}

export function weddingCodeResearchLedgerDigestSql(exclude = false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>${literal(WEDDING_CODE_RESEARCH_VERSION)}` : ''})`;
}
const ledgerRow = version => `(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(version)})`;

export function buildWeddingCodeResearchObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('format','wedding-code-research-contributions-catalog-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),
 'catalog',${weddingCodeResearchTargetCatalogSql()},'preservedCatalogSha',${weddingCodeResearchPreservedCatalogSql()},
 'ledgerSha',${weddingCodeResearchLedgerDigestSql()},'ledgerWithoutTargetSha',${weddingCodeResearchLedgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',${ledgerRow(WEDDING_CODE_RESEARCH_VERSION)},'predecessor',${ledgerRow(PREDECESSOR.version)}) AS observation; COMMIT;`;
}

const sorted = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const ownerOnly = privileges => sorted(privileges.map(privilege => ['postgres', 'postgres', privilege, false]));
const TABLE_PRIVILEGES = ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'];
const TIMESTAMP = 'timestamp with time zone';
// PostgreSQL prosrc는 `AS $function$`와 닫는 `$function$` 사이 원문이다.
export function weddingCodeResearchFunctionBodies(sql) {
  const bodies = new Map([...sql.matchAll(/^CREATE FUNCTION public\.(\w+)\([\s\S]*?\nAS \$function\$([\s\S]*?)\$function\$;$/gm)]
    .map(([, name, body]) => [name, body]));
  requireValue(bodies.size === WEDDING_CODE_RESEARCH_FUNCTIONS.length && WEDDING_CODE_RESEARCH_FUNCTIONS.every(name => bodies.has(name)),
    'WEDDING_CODE_RESEARCH_SQL_FUNCTION_SET_INVALID');
  return bodies;
}

// 검토한 SQL이 만들어야 하는 정확한 catalog. 테이블은 소유자만, 함수는 소유자와 service_role만 실행한다.
export function expectedWeddingCodeResearchCatalog(sql) {
  const bodies = weddingCodeResearchFunctionBodies(sql);
  const definer = { language: 'plpgsql', owner: 'postgres', securityDefiner: true, volatility: 'v', strict: false, parallel: 'u',
    kind: 'f', config: ['search_path=""'],
    acl: sorted([['postgres', 'postgres', 'EXECUTE', false], ['service_role', 'postgres', 'EXECUTE', false]]) };
  return {
    relations: [
      { name: 'public.wedding_code_research_contributions', kind: 'r', owner: 'postgres', rls: true, forceRls: false,
        acl: ownerOnly(TABLE_PRIVILEGES),
        columns: sorted([['id', 'uuid', true, '', '', 'gen_random_uuid()'], ['created_at', TIMESTAMP, true, '', '', 'now()'],
          ['expires_at', TIMESTAMP, true, '', '', "(now() + '60 days'::interval)"], ['scene_version', 'text', true, '', '', null],
          ['answer_code', 'text', true, '', '', null], ['consent_version', 'text', true, '', '', null],
          ['deletion_receipt_hash', 'bytea', true, '', '', null]]),
        constraints: sorted([
          ['wcr_contributions_pkey', 'p', true, 'PRIMARY KEY (id)'],
          ['wcr_contributions_receipt_hash_key', 'u', true, 'UNIQUE (deletion_receipt_hash)'],
          ['wcr_contributions_scene_version', 'c', true, "CHECK (scene_version = 'v0.8-code'::text)"],
          ['wcr_contributions_answer_code', 'c', true, "CHECK (answer_code ~ '^[A-D-]{20}$'::text AND answer_code ~ '[A-D]'::text)"],
          ['wcr_contributions_consent_version', 'c', true, "CHECK (consent_version ~ '^wc-research-consent-v[1-9][0-9]*$'::text)"],
          ['wcr_contributions_receipt_hash_length', 'c', true, 'CHECK (octet_length(deletion_receipt_hash) = 32)'],
          ['wcr_contributions_retention', 'c', true, "CHECK (expires_at > created_at AND expires_at <= (created_at + '60 days'::interval))"],
        ]),
        indexes: sorted([
          ['CREATE UNIQUE INDEX wcr_contributions_pkey ON public.wedding_code_research_contributions USING btree (id)', true, true],
          ['CREATE UNIQUE INDEX wcr_contributions_receipt_hash_key ON public.wedding_code_research_contributions USING btree (deletion_receipt_hash)', true, true],
          ['CREATE INDEX wcr_contributions_expires_at_idx ON public.wedding_code_research_contributions USING btree (expires_at)', true, true],
        ]),
        policies: [], triggers: [] },
      { name: 'public.wedding_code_research_deletion_tombstones', kind: 'r', owner: 'postgres', rls: true, forceRls: false,
        acl: ownerOnly(TABLE_PRIVILEGES),
        columns: sorted([['deletion_receipt_hash', 'bytea', true, '', '', null], ['deleted_at', TIMESTAMP, true, '', '', 'now()'],
          ['expires_at', TIMESTAMP, true, '', '', "(now() + '30 days'::interval)"]]),
        constraints: sorted([
          ['wcr_tombstones_pkey', 'p', true, 'PRIMARY KEY (deletion_receipt_hash)'],
          ['wcr_tombstones_receipt_hash_length', 'c', true, 'CHECK (octet_length(deletion_receipt_hash) = 32)'],
        ]),
        indexes: sorted([
          ['CREATE UNIQUE INDEX wcr_tombstones_pkey ON public.wedding_code_research_deletion_tombstones USING btree (deletion_receipt_hash)', true, true],
          ['CREATE INDEX wcr_tombstones_expires_at_idx ON public.wedding_code_research_deletion_tombstones USING btree (expires_at)', true, true],
        ]),
        policies: [], triggers: [] },
    ],
    functions: [
      { name: 'insert_wedding_code_research_contribution', args: 'text, text, text, bytea', result: 'void', ...definer,
        body: bodies.get('insert_wedding_code_research_contribution') },
      { name: 'delete_wedding_code_research_contribution', args: 'bytea', result: 'void', ...definer,
        body: bodies.get('delete_wedding_code_research_contribution') },
      { name: 'purge_expired_wedding_code_research_contributions', args: '', result: 'integer', ...definer,
        body: bodies.get('purge_expired_wedding_code_research_contributions') },
    ],
  };
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

export function validateWeddingCodeResearchCatalog(catalog, sql, applied) {
  same(sortedTree(catalog), sortedTree(applied ? expectedWeddingCodeResearchCatalog(sql) : { relations: [], functions: [] }),
    'WEDDING_CODE_RESEARCH_TARGET_CATALOG_DRIFT');
}

export function validateWeddingCodeResearchObservation(observed, { sql, predecessorSql, now }) {
  requireValue(observed?.format === 'wedding-code-research-contributions-catalog-v1' && observed.readOnly === true
    && observed.systemIdentifier === SYSTEM && observed.database === 'postgres' && observed.currentUser === 'postgres'
    && /^17\./.test(observed.serverVersion ?? '') && observed.catalog && typeof observed.catalog === 'object'
    && [observed.preservedCatalogSha, observed.ledgerSha, observed.ledgerWithoutTargetSha].every(value => MD5.test(value ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0, 'WEDDING_CODE_RESEARCH_OBSERVATION_INVALID');
  const at = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at) && at <= now.getTime() + 10_000 && at > now.getTime() - MAX_AGE_MS, 'WEDDING_CODE_RESEARCH_OBSERVATION_EXPIRED');
  const expectedPredecessor = { ...PREDECESSOR, statementCount: 1, sqlMd5: md5(predecessorSql) };
  if (observed.predecessor === null) fail('WEDDING_CODE_RESEARCH_PREDECESSOR_NOT_APPLIED', predecessorMissingAction());
  if (canonical(observed.predecessor) !== canonical(expectedPredecessor))
    fail('WEDDING_CODE_RESEARCH_PREDECESSOR_LEDGER_MISMATCH', predecessorMismatchAction(observed.predecessor, expectedPredecessor));
  if (observed.migration !== null) {
    same(observed.migration, { version: WEDDING_CODE_RESEARCH_VERSION, name: WEDDING_CODE_RESEARCH_MIGRATION_NAME, statementCount: 1,
      sqlMd5: md5(sql) }, 'WEDDING_CODE_RESEARCH_LEDGER_CONFLICT');
  } else requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'WEDDING_CODE_RESEARCH_LEDGER_CONFLICT');
  validateWeddingCodeResearchCatalog(observed.catalog, sql, observed.migration !== null);
  return observed;
}

function unwrap(sql) {
  const body = sql.replace(/^[\s\S]*?\bBEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  requireValue(body !== sql && !/\bCOMMIT\s*;/i.test(body) && !/\bROLLBACK\s*;/i.test(body), 'WEDDING_CODE_RESEARCH_SQL_ENVELOPE_INVALID');
  return body;
}

export function buildWeddingCodeResearchMutationSql({ sql, before, deadline, rehearsal }) {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline) && before?.migration === null
    && [before.ledgerSha, before.preservedCatalogSha].every(value => MD5.test(value ?? '')), 'WEDDING_CODE_RESEARCH_BUNDLE_INVALID');
  validateWeddingCodeResearchCatalog(before.catalog, sql, false);
  // 기존 데이터 중지 없이 metadata와 이력만 비교한다. 예행 후 영속 적용은 동일 bundle이다.
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
SELECT pg_advisory_xact_lock(60915,2);
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $wedding_code_research_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>${literal(SYSTEM)} OR current_database()<>'postgres'
 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_DEADLINE_EXPIRED'; END IF;
 IF ${weddingCodeResearchTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${weddingCodeResearchPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${weddingCodeResearchLedgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_BASELINE_DRIFT'; END IF;
END $wedding_code_research_before$;
${unwrap(sql)}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(WEDDING_CODE_RESEARCH_VERSION)},${literal(WEDDING_CODE_RESEARCH_MIGRATION_NAME)},ARRAY[${literal(sql)}]::text[]);
DO $wedding_code_research_after$ BEGIN
 IF ${weddingCodeResearchTargetCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(expectedWeddingCodeResearchCatalog(sql))}
 OR ${weddingCodeResearchPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${weddingCodeResearchLedgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_DEADLINE_EXPIRED'; END IF;
END $wedding_code_research_after$;
${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}

function assertGitSource(repoRoot, expectedCommit) {
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'WEDDING_CODE_RESEARCH_SOURCE_NOT_CLEAN_EXACT_COMMIT');
}

export function appendWeddingCodeResearchReceipt(fd, value, { write = writeSync, flush = fsyncSync } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes, offset, bytes.length - offset, null);
    requireValue(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset, 'WEDDING_CODE_RESEARCH_RECEIPT_WRITE_INCOMPLETE');
    offset += written;
  }
  flush(fd);
}

function openReceipt(file) {
  const target = resolve(file), parent = dirname(target);
  let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    requireValue(lstatSync(cursor).isDirectory() && !lstatSync(cursor).isSymbolicLink(), 'WEDDING_CODE_RESEARCH_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'WEDDING_CODE_RESEARCH_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append: value => appendWeddingCodeResearchReceipt(fd, value), close: () => closeSync(fd) };
}

async function managementQuery(sql, accessToken) {
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: false }), signal: AbortSignal.timeout(45_000),
    });
    requireValue(response.ok, 'WEDDING_CODE_RESEARCH_REMOTE_OUTCOME_UNVERIFIED');
    const text = await response.text();
    requireValue(Buffer.byteLength(text) <= 256 * 1024, 'WEDDING_CODE_RESEARCH_REMOTE_OUTCOME_UNVERIFIED');
    const rows = JSON.parse(text);
    requireValue(Array.isArray(rows), 'WEDDING_CODE_RESEARCH_REMOTE_OUTCOME_UNVERIFIED');
    return rows;
  } catch { fail('WEDDING_CODE_RESEARCH_REMOTE_OUTCOME_UNVERIFIED'); }
}

// 주입 의존성은 오프라인 검사 전용이다. CLI는 고정 HTTPS 대상과 실제 Git·원문 핀을 쓴다.
export async function runWeddingCodeResearchRelease({ repoRoot, argv, now = () => new Date(),
  query, assertSource = assertGitSource, receiptFactory = openReceipt } = {}) {
  const options = parseWeddingCodeResearchReleaseArgs(argv ?? []);
  const plan = loadWeddingCodeResearchReleasePlan(repoRoot);
  const pin = plan.contract.migrations[0];
  const sql = pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` }).toString('utf8');
  const predecessorSql = pinnedArtifact(repoRoot, plan.contract.predecessorMigration).toString('utf8');
  const context = { sql, predecessorSql };
  assertSource(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token ?? ''), 'WEDDING_CODE_RESEARCH_CREDENTIAL_UNAVAILABLE');
    query = text => managementQuery(text, token);
  }
  const receipt = receiptFactory(options['receipt-out']);
  const binding = { format: 'wedding-code-research-contributions-runtime-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT, releaseCommit: options['expected-commit'], contractSha256: plan.contractSha256,
    sqlSha256: plan.migrationSha256, runtimeSha256: plan.contract.runtime.sha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildWeddingCodeResearchObservationSql());
    requireValue(Array.isArray(rows) && rows.length === 1, 'WEDDING_CODE_RESEARCH_OBSERVATION_INVALID');
    return validateWeddingCodeResearchObservation(rows[0].observation, { ...context, now: now() });
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
    const rehearseSql = buildWeddingCodeResearchMutationSql({ sql, before, deadline, rehearsal: true });
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearseSql) });
    mutationStarted = true;
    await query(rehearseSql);
    const rolledBack = await observe();
    for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'migration', 'predecessor'])
      same(rolledBack[key], before[key], 'WEDDING_CODE_RESEARCH_REHEARSAL_NOT_ROLLED_BACK');
    record('rehearsed-and-rolled-back', { after: rolledBack });
    if (options.mode === 'rehearse') return { status: 'rehearsed-and-rolled-back', before, after: rolledBack, remoteWritesPerformed: false };
    requireValue(now().getTime() < Date.parse(deadline), 'WEDDING_CODE_RESEARCH_DEADLINE_EXPIRED');
    assertSource(repoRoot, options['expected-commit']);
    // 적용 직전 원문과 구현도 다시 검증한다. 과거 rehearsal 영수증을 믿고 바로 적용하지 않는다.
    const freshPlan = loadWeddingCodeResearchReleasePlan(repoRoot);
    same(freshPlan.contractSha256, plan.contractSha256, 'WEDDING_CODE_RESEARCH_SOURCE_CHANGED');
    const applySql = buildWeddingCodeResearchMutationSql({ sql, before, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(applySql) });
    await query(applySql);
    const after = await observe();
    requireValue(after.migration !== null && after.ledgerCount === before.ledgerCount + 1
      && after.ledgerWithoutTargetSha === before.ledgerSha, 'WEDDING_CODE_RESEARCH_POST_APPLY_UNVERIFIED');
    same(after.preservedCatalogSha, before.preservedCatalogSha, 'WEDDING_CODE_RESEARCH_POST_APPLY_CATALOG_DRIFT');
    record('applied-and-postverified', { after });
    return { status: 'applied-and-postverified', before, after, remoteWritesPerformed: true };
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'WEDDING_CODE_RESEARCH_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); } catch { /* 앞서 fsync한 결과 미확정 기록을 유지한다. */ }
    // 변경 전 차단일 때만 이 모듈의 안내 문구를 넘긴다. 변경을 시작했으면 결과 미확정이므로 안내를 붙이지 않는다.
    const operatorAction = !mutationStarted && error instanceof CurrentBaselineBlocked ? error.operatorAction : undefined;
    fail(mutationStarted ? 'WEDDING_CODE_RESEARCH_OUTCOME_REQUIRES_INSPECTION' : code, operatorAction);
  } finally { receipt.close(); }
}
