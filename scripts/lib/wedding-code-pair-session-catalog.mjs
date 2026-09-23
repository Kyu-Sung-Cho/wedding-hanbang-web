import { createHash } from 'node:crypto';
import { CurrentBaselineBlocked, same } from './current-baseline-release-contract.mjs';

export const WEDDING_CODE_PAIR_SESSION_VERSION = '20260923104336';
export const WEDDING_CODE_PAIR_SESSION_PROJECT = 'slrtobkksjmxgzatjyqb';
export const WEDDING_CODE_PAIR_SESSION_SYSTEM = '7581440907192989109';
export const WEDDING_CODE_PAIR_SESSION_TABLES = ['wedding_code_pair_sessions'];
export const WEDDING_CODE_PAIR_SESSION_FUNCTIONS = ['create_wedding_code_pair_session', 'read_wedding_code_pair_session',
  'join_wedding_code_pair_session', 'revoke_wedding_code_pair_session', 'purge_expired_wedding_code_pair_sessions'];
export const WEDDING_CODE_PAIR_SESSION_CRON_NAME = 'wedding-code-pair-session-purge';
const fail = code => { throw new CurrentBaselineBlocked(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const names = values => values.map(literal).join(',');
const MD5 = /^[a-f0-9]{32}$/;
const md5 = value => createHash('md5').update(value).digest('hex');
const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]') FROM (${query}) q(v))`;
const acl = (expression, kind) => aggregate(`SELECT jsonb_build_array(
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
 FROM aclexplode(COALESCE(${expression},acldefault('${kind}',c.${kind === 'f' ? 'proowner' : 'relowner'}))) a`);
const columns = aggregate(`SELECT jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
 a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),${aggregate(`SELECT jsonb_build_array(
 CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable)
 FROM aclexplode(a.attacl) x`)}) FROM pg_attribute a
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`);
const constraints = aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true))
 FROM pg_constraint WHERE conrelid=c.oid AND contype<>'n'`);
const indexes = aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid`);
const policies = aggregate(`SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
 'roles',(SELECT array_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(polroles) r),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) FROM pg_policy WHERE polrelid=c.oid`);
const triggers = aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal`);
const relation = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl','r')},'columns',${columns},
 'constraints',${constraints},'indexes',${indexes},'policies',${policies},'triggers',${triggers})`;
const functionShape = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'definition',pg_get_functiondef(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,'kind',c.prokind,
 'config',c.proconfig,'body',c.prosrc,'acl',${acl('c.proacl','f')})`;
const sequenceShape = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'acl',${acl('c.relacl','s')},'type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,
 'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle)`;

// cron 확장의 설치와 호출 서명은 운영에서 확인한다. 합성 native 스케줄러는 별도로 표시한다.
export function weddingCodePairSessionDependencyCatalogSql() {
  return `jsonb_build_object('cronExtension',(SELECT extname FROM pg_extension WHERE extname='pg_cron'),
    'scheduleReady',to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL,
    'jobReady',to_regclass('cron.job') IS NOT NULL)`;
}
export function weddingCodePairSessionTargetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${names(WEDDING_CODE_PAIR_SESSION_TABLES)})`)},
 'functions',${aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${names(WEDDING_CODE_PAIR_SESSION_FUNCTIONS)})`)},
 'cronJobs',${aggregate(`SELECT jsonb_build_object('jobname',jobname,'schedule',schedule,'command',command,
 'database',database,'username',username,'active',active,'localNode',nodename IN ('localhost','127.0.0.1'),
 'portMatches',nodeport=current_setting('port')::integer) FROM cron.job WHERE jobname=${literal(WEDDING_CODE_PAIR_SESSION_CRON_NAME)}`)})`;
}
export function weddingCodePairSessionPreservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','cron') AND c.relkind IN ('r','p','v','m','f')
 AND NOT(n.nspname='public' AND c.relname IN (${names(WEDDING_CODE_PAIR_SESSION_TABLES)}))`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),md5(pg_get_functiondef(c.oid)),c.proacl)
 FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname IN ('public','auth','storage','cron') AND c.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND c.proname IN (${names(WEDDING_CODE_PAIR_SESSION_FUNCTIONS)}))`)},
 'sequences',${aggregate(`SELECT ${sequenceShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_sequence s ON s.seqrelid=c.oid WHERE n.nspname IN ('public','auth','storage','cron')`)},
 'cronJobs',${aggregate(`SELECT to_jsonb(j) FROM cron.job j WHERE jobname IS DISTINCT FROM ${literal(WEDDING_CODE_PAIR_SESSION_CRON_NAME)}`)}
 )::text))`;
}
export function weddingCodePairSessionLedgerDigestSql(exclude=false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>${literal(WEDDING_CODE_PAIR_SESSION_VERSION)}` : ''})`;
}
const ledgerRow = version => `(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(version)})`;
const dependenciesReady = `(EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron')
 AND to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL
 AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=to_regclass('cron.job') AND NOT a.attisdropped
 AND a.attname IN ('jobname','schedule','command','database','username','active','nodename','nodeport'))=8)`;
export function buildWeddingCodePairSessionObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','wedding-code-pair-session-catalog-v1','systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'serverVersion',current_setting('server_version'),'database',current_database(),'currentUser',current_user,
 'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),'dependenciesReady',${dependenciesReady},
 'catalog',${weddingCodePairSessionTargetCatalogSql()},'dependencies',${weddingCodePairSessionDependencyCatalogSql()},'preservedCatalogSha',${weddingCodePairSessionPreservedCatalogSql()},
 'ledgerSha',${weddingCodePairSessionLedgerDigestSql()},'ledgerWithoutTargetSha',${weddingCodePairSessionLedgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',${ledgerRow(WEDDING_CODE_PAIR_SESSION_VERSION)},'predecessor',${ledgerRow('20260920120000')}) AS observation; COMMIT;`;
}
function sortedTree(value) {
  if (Array.isArray(value)) { const children=value.map(sortedTree); return value.length>0&&value.every(child=>child&&typeof child==='object')
    ? children.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) : children; }
  if (value&&typeof value==='object') return Object.fromEntries(Object.entries(value).sort().map(([key,child])=>[key,sortedTree(child)]));
  return value;
}
export function expectedWeddingCodePairSessionCatalog(fixture, applied) {
  return Object.fromEntries(['relations','functions','cronJobs'].map(key=>[key,applied?structuredClone(fixture[key]):[]]));
}
export function validateWeddingCodePairSessionCatalog(catalog, fixture, applied) {
  same(sortedTree(catalog),sortedTree(expectedWeddingCodePairSessionCatalog(fixture,applied)),'WEDDING_CODE_PAIR_SESSION_TARGET_CATALOG_DRIFT');
}
export function validateWeddingCodePairSessionObservation(observed,{sql,fixture,predecessorSql,now}) {
  requireValue(observed?.format==='wedding-code-pair-session-catalog-v1'&&observed.readOnly===true&&observed.dependenciesReady===true
    &&observed.systemIdentifier===WEDDING_CODE_PAIR_SESSION_SYSTEM&&observed.database==='postgres'&&observed.currentUser==='postgres'
    &&/^17\./.test(observed.serverVersion??'')
    &&[observed.preservedCatalogSha,observed.ledgerSha,observed.ledgerWithoutTargetSha].every(value=>MD5.test(value??''))
    &&Number.isSafeInteger(observed.ledgerCount)&&observed.ledgerCount>0,'WEDDING_CODE_PAIR_SESSION_OBSERVATION_INVALID');
  const at=Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at)&&at<=now.getTime()+10_000&&at>now.getTime()-120_000,'WEDDING_CODE_PAIR_SESSION_OBSERVATION_EXPIRED');
  same(sortedTree(observed.dependencies),sortedTree(fixture.dependencies),'WEDDING_CODE_PAIR_SESSION_DEPENDENCY_DRIFT');
  same(observed.predecessor,{version:'20260920120000',name:'wedding_preparation_style',statementCount:1,sqlMd5:md5(predecessorSql)},'WEDDING_CODE_PAIR_SESSION_PREDECESSOR_NOT_APPLIED');
  if(observed.migration!==null) same(observed.migration,{version:WEDDING_CODE_PAIR_SESSION_VERSION,name:'wedding_code_pair_sessions',
    statementCount:1,sqlMd5:md5(sql)},'WEDDING_CODE_PAIR_SESSION_LEDGER_CONFLICT');
  else requireValue(observed.ledgerSha===observed.ledgerWithoutTargetSha,'WEDDING_CODE_PAIR_SESSION_LEDGER_CONFLICT');
  validateWeddingCodePairSessionCatalog(observed.catalog,fixture,observed.migration!==null);return observed;
}
function expectedJsonSql(value) {
  // 행 목록만 정렬한다. column 행처럼 내부 ACL 배열을 가진 튜플의 열 순서는 보존한다.
  if(Array.isArray(value)&&value.length>0) return value.every(child=>child&&typeof child==='object')
    ? `(SELECT jsonb_agg(v ORDER BY v::text) FROM (VALUES ${value.map(child=>`(${expectedJsonSql(child)})`).join(',')}) q(v))`
    : `jsonb_build_array(${value.map(expectedJsonSql).join(',')})`;
  if(value&&typeof value==='object'&&!Array.isArray(value)) return `jsonb_build_object(${Object.entries(value).flatMap(([key,child])=>[literal(key),expectedJsonSql(child)]).join(',')})`;
  return `${literal(JSON.stringify(value))}::jsonb`;
}
function unwrap(sql) {
  const body=sql.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
  requireValue(body!==sql&&!/\b(COMMIT|ROLLBACK)\s*;/i.test(body),'WEDDING_CODE_PAIR_SESSION_SQL_ENVELOPE_INVALID');return body;
}
export function buildWeddingCodePairSessionMutationSql({sql,fixture,before,deadline,rehearsal}) {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline)&&before?.migration===null
    &&[before.ledgerSha,before.preservedCatalogSha].every(value=>MD5.test(value??'')),'WEDDING_CODE_PAIR_SESSION_BUNDLE_INVALID');
  validateWeddingCodePairSessionCatalog(before.catalog,fixture,false);
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(60923,1); LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $pair_session_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>'${WEDDING_CODE_PAIR_SESSION_SYSTEM}' OR current_database()<>'postgres'
 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR NOT ${dependenciesReady} THEN RAISE EXCEPTION 'WEDDING_CODE_PAIR_SESSION_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'WEDDING_CODE_PAIR_SESSION_DEADLINE_EXPIRED'; END IF;
 IF ${weddingCodePairSessionTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${weddingCodePairSessionDependencyCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(fixture.dependencies)}
 OR ${weddingCodePairSessionPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${weddingCodePairSessionLedgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'WEDDING_CODE_PAIR_SESSION_BASELINE_DRIFT'; END IF;
 END $pair_session_before$;
 ${unwrap(sql)}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${WEDDING_CODE_PAIR_SESSION_VERSION}','wedding_code_pair_sessions',ARRAY[${literal(sql)}]::text[]);
 DO $pair_session_after$ BEGIN
 IF ${weddingCodePairSessionTargetCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(expectedWeddingCodePairSessionCatalog(fixture,true))}
 OR ${weddingCodePairSessionDependencyCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(fixture.dependencies)}
 OR ${weddingCodePairSessionPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${weddingCodePairSessionLedgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR EXISTS(SELECT 1 FROM public.wedding_code_pair_sessions)
 THEN RAISE EXCEPTION 'WEDDING_CODE_PAIR_SESSION_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'WEDDING_CODE_PAIR_SESSION_DEADLINE_EXPIRED'; END IF;
 END $pair_session_after$;
 ${rehearsal?'ROLLBACK':'COMMIT'};`;
}
