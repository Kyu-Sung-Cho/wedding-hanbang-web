import { createHash } from 'node:crypto';
import { CurrentBaselineBlocked, same } from './current-baseline-release-contract.mjs';

const fail = code => { throw new CurrentBaselineBlocked(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export const PROFILE_ROLE_VERSION = '20260913075045';
export const PROFILE_ROLE_PROJECT = 'slrtobkksjmxgzatjyqb';
export const PROFILE_ROLE_SYSTEM = '7581440907192989109';
const TABLE = 'profile_wedding_roles';
const FUNCTIONS = ['read_profile_wedding_roles', 'save_profile_wedding_role'];
export const PROFILE_ROLE_REQUIRED_COLUMNS = Object.freeze([
  ['auth.users.id','uuid'], ['public.account_deletion_jobs.status','text'], ['public.account_deletion_jobs.user_id','uuid'],
  ['public.couples.bride_id','uuid'], ['public.couples.groom_id','uuid'], ['public.couples.id','uuid'],
  ['public.profiles.couple_id','uuid'], ['public.profiles.id','uuid'],
]);
const MD5 = /^[a-f0-9]{32}$/;
const md5 = value => createHash('md5').update(value).digest('hex');

const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]') FROM (${query}) q(v))`;
const acl = (expression, kind) => aggregate(`SELECT jsonb_build_array(
  CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
  pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
 FROM aclexplode(COALESCE(${expression},acldefault('${kind}',c.${kind === 'r' ? 'relowner' : 'proowner'}))) a`);
const columns = aggregate(`SELECT jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
 a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`);
const constraints = aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true))
 FROM pg_constraint WHERE conrelid=c.oid`);
const indexes = aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready)
 FROM pg_index WHERE indrelid=c.oid`);
const policies = aggregate('SELECT to_jsonb(p)-\'oid\'-\'polrelid\' FROM pg_policy p WHERE polrelid=c.oid');
const triggers = aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal`);
const relation = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl', 'r')},
 'columns',${columns},'constraints',${constraints},'indexes',${indexes},'policies',${policies},'triggers',${triggers})`;
const functions = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,
 'config',c.proconfig,'body',c.prosrc,'acl',${acl('c.proacl', 'f')})`;

// 고객 행·대화·Auth 원문을 읽지 않는다. 새 객체만 제외한 기존 catalog를 전후 비교한다.
export function profileRolePreservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object(
 'relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','f')
 AND NOT(n.nspname='public' AND c.relname='${TABLE}')`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),
 pg_get_functiondef(c.oid),c.proacl) FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND c.proname IN (${FUNCTIONS.map(literal).join(',')}))`)}
 )::text))`;
}

export function profileRoleTargetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${TABLE}'`)},
 'functions',${aggregate(`SELECT ${functions} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${FUNCTIONS.map(literal).join(',')})`)})`;
}

export function profileRoleLedgerDigestSql(exclude = false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
 ORDER BY version)::text,'[]')) FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>'${PROFILE_ROLE_VERSION}'` : ''})`;
}

export function buildProfileRoleObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','profile-wedding-roles-catalog-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'serverVersion',current_setting('server_version'),'database',current_database(),
 'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),
 'dependencies',${aggregate(`SELECT jsonb_build_array(n.nspname||'.'||c.relname||'.'||a.attname,format_type(a.atttypid,a.atttypmod))
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND NOT a.attisdropped AND n.nspname||'.'||c.relname||'.'||a.attname
 IN (${PROFILE_ROLE_REQUIRED_COLUMNS.map(row => literal(row[0])).join(',')})`)},
 'catalog',${profileRoleTargetCatalogSql()},'preservedCatalogSha',${profileRolePreservedCatalogSql()},
 'ledgerSha',${profileRoleLedgerDigestSql()},'ledgerWithoutTargetSha',${profileRoleLedgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),
 'sqlMd5',md5(statements[1])) FROM supabase_migrations.schema_migrations WHERE version='${PROFILE_ROLE_VERSION}'),
 'predecessor',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),
 'sqlMd5',md5(statements[1])) FROM supabase_migrations.schema_migrations WHERE version='20260913043211')
 ) AS observation; COMMIT;`;
}

const sorted = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function expectedAcl(privileges) {
  return sorted(['postgres', 'service_role'].flatMap(role => privileges.map(privilege => [role, 'postgres', privilege, false])));
}
export function expectedProfileRoleCatalog(sql) {
  const bodies = [...sql.matchAll(/CREATE FUNCTION public\.(\w+)[\s\S]*? AS \$\$([\s\S]*?)\$\$;/g)];
  requireValue(bodies.length === 2, 'PROFILE_ROLE_SQL_FUNCTION_SET_INVALID');
  return { relations: [{ name: 'public.profile_wedding_roles', kind: 'r', owner: 'postgres', rls: true, forceRls: false,
    acl: expectedAcl(['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']),
    columns: sorted([['user_id','uuid',true,'','',null], ['confirmed_role','text',false,'','',null],
      ['revision','uuid',true,'','','gen_random_uuid()'], ['updated_at','timestamp with time zone',true,'','','clock_timestamp()']]),
    constraints: sorted([
      ['profile_wedding_roles_pkey','p',true,'PRIMARY KEY (user_id)'],
      ['profile_wedding_roles_user_id_fkey','f',true,'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'],
      ['profile_wedding_roles_confirmed_role_check','c',true,"CHECK (confirmed_role = ANY (ARRAY['bride'::text, 'groom'::text]))"],
    ]), indexes: [['CREATE UNIQUE INDEX profile_wedding_roles_pkey ON public.profile_wedding_roles USING btree (user_id)',true,true]],
    policies: [], triggers: [],
  }], functions: bodies.map(([, name, body]) => ({ name,
    args: name.startsWith('save') ? 'uuid, text, uuid' : 'uuid',
    result: name.startsWith('save') ? 'jsonb' : 'TABLE(user_id uuid, confirmed_role text, revision uuid, couple_id uuid)',
    language: name.startsWith('save') ? 'plpgsql' : 'sql', owner: 'postgres', securityDefiner: true,
    volatility: name.startsWith('save') ? 'v' : 's', strict: false, parallel: 'u', config: ['search_path=""'],
    body, acl: expectedAcl(['EXECUTE']),
  })) };
}

function canonical(value) {
  if (Array.isArray(value)) {
    const children = value.map(canonical);
    return value.some(child => child && typeof child === 'object')
      ? children.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : children;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort().map(([key, child]) => [key, canonical(child)]));
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
export function validateProfileRoleCatalog(catalog, sql, applied) {
  // 최상위뿐 아니라 privileges/columns 순서도 SQL jsonb 집계 순서와 무관하게 비교한다.
  same(canonical(catalog), canonical(applied ? expectedProfileRoleCatalog(sql) : { relations: [], functions: [] }),
    'PROFILE_ROLE_TARGET_CATALOG_DRIFT');
}

export function validateProfileRoleObservation(observed, { sql, predecessorSql, now }) {
  requireValue(observed?.format === 'profile-wedding-roles-catalog-v1' && observed.readOnly === true
    && observed.systemIdentifier === PROFILE_ROLE_SYSTEM && observed.database === 'postgres'
    && /^17\./.test(observed.serverVersion ?? '') && observed.catalog
    && [observed.preservedCatalogSha,observed.ledgerSha,observed.ledgerWithoutTargetSha].every(value => MD5.test(value ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0, 'PROFILE_ROLE_OBSERVATION_INVALID');
  const at = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at) && at <= now.getTime()+10_000 && at > now.getTime()-120_000, 'PROFILE_ROLE_OBSERVATION_EXPIRED');
  same(observed.predecessor, { version: '20260913043211', name: 'chat_feedback_automatic_signal_nullable', statementCount: 1,
    sqlMd5: md5(predecessorSql) }, 'PROFILE_ROLE_PREDECESSOR_NOT_APPLIED');
  same(canonical(observed.dependencies), canonical(PROFILE_ROLE_REQUIRED_COLUMNS), 'PROFILE_ROLE_DEPENDENCIES_CHANGED');
  if (observed.migration !== null) {
    same(observed.migration, { version: PROFILE_ROLE_VERSION, name: 'profile_wedding_roles', statementCount: 1,
      sqlMd5: md5(sql) }, 'PROFILE_ROLE_LEDGER_CONFLICT');
  } else requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'PROFILE_ROLE_LEDGER_CONFLICT');
  validateProfileRoleCatalog(observed.catalog, sql, observed.migration !== null);
  return observed;
}

export function buildProfileRoleMutationSql({ sql, before, deadline, rehearsal }) {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline) && before.migration === null
    && MD5.test(before.ledgerSha) && MD5.test(before.preservedCatalogSha), 'PROFILE_ROLE_BUNDLE_INVALID');
  validateProfileRoleCatalog(before.catalog, sql, false);
  const body = sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  requireValue(body !== sql && !/\bCOMMIT\s*;/i.test(body), 'PROFILE_ROLE_SQL_ENVELOPE_INVALID');
  // 기존 데이터 중지 없이 metadata와 이력만 비교한다. 예행 후 영속 적용은 동일 bundle이다.
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(60913,3);
 LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $role_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) <> '${PROFILE_ROLE_SYSTEM}' OR current_database()<>'postgres'
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'PROFILE_ROLE_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'PROFILE_ROLE_DEADLINE_EXPIRED'; END IF;
 IF ${profileRoleTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${profileRolePreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${profileRoleLedgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'PROFILE_ROLE_BASELINE_DRIFT'; END IF;
 END $role_before$;
 ${body}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${PROFILE_ROLE_VERSION}','profile_wedding_roles',ARRAY[${literal(sql)}]::text[]);
 DO $role_after$ BEGIN
 IF ${profileRoleTargetCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(expectedProfileRoleCatalog(sql))}
 OR ${profileRolePreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${profileRoleLedgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 THEN RAISE EXCEPTION 'PROFILE_ROLE_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'PROFILE_ROLE_DEADLINE_EXPIRED'; END IF;
 END $role_after$;
 ${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}
