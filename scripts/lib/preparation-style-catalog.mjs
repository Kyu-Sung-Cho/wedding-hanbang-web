import { createHash } from 'node:crypto';
import { CurrentBaselineBlocked, same } from './current-baseline-release-contract.mjs';

export const PREPARATION_STYLE_VERSION = '20260920120000';
export const PREPARATION_STYLE_PROJECT = 'slrtobkksjmxgzatjyqb';
export const PREPARATION_STYLE_SYSTEM = '7581440907192989109';
export const PREPARATION_STYLE_TABLES = ['wedding_preparation_style_responses', 'wedding_preparation_style_shares'];
export const PREPARATION_STYLE_FUNCTIONS = ['wedding_preparation_style_actor', 'get_own_wedding_preparation_style',
  'set_own_wedding_preparation_style', 'clear_own_wedding_preparation_style', 'share_own_wedding_preparation_style',
  'unshare_own_wedding_preparation_style', 'purge_wedding_preparation_style_for_account_deletion', 'revoke_wedding_preparation_style_for_membership'];
const SEQUENCE = 'wedding_preparation_style_revision_seq';
const TRIGGERS = [['account_deletion_jobs', 'trg_wedding_preparation_style_account_deletion'],
  ['profiles', 'trg_wedding_preparation_style_profile_membership'], ['couples', 'trg_wedding_preparation_style_couple_membership']];
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
const selectedTrigger = `(n.nspname='public' AND (${TRIGGERS.map(([table, trigger]) => `(c.relname=${literal(table)} AND tgname=${literal(trigger)})`).join(' OR ')}))`;
// 부모 테이블 전체를 제외하지 않는다. 이번에 추가하는 정확한 세 트리거만 별도로 검증한다.
const triggers = aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal AND NOT ${selectedTrigger}`);
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

// 공유 권한이 의존하는 기존 함수의 정의/인자명/설정/ACL까지 고정한다.
export function preparationStyleDependencyCatalogSql() {
  return aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname='is_current_couple_member'`);
}

export function preparationStyleTargetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${names(PREPARATION_STYLE_TABLES)})`)},
 'functions',${aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${names(PREPARATION_STYLE_FUNCTIONS)})`)},
 'sequences',${aggregate(`SELECT ${sequenceShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_sequence s ON s.seqrelid=c.oid WHERE n.nspname='public' AND c.relname=${literal(SEQUENCE)}`)},
 'parentTriggers',${aggregate(`SELECT jsonb_build_array(n.nspname||'.'||c.relname,tgname,tgenabled,pg_get_triggerdef(t.oid,true))
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${selectedTrigger}`)})`;
}

export function preparationStylePreservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','f')
 AND NOT(n.nspname='public' AND c.relname IN (${names(PREPARATION_STYLE_TABLES)}))`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),md5(pg_get_functiondef(c.oid)),c.proacl)
 FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname IN ('public','auth','storage') AND c.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND c.proname IN (${names(PREPARATION_STYLE_FUNCTIONS)}))`)},
 'sequences',${aggregate(`SELECT ${sequenceShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_sequence s ON s.seqrelid=c.oid WHERE n.nspname IN ('public','auth','storage')
 AND NOT(n.nspname='public' AND c.relname=${literal(SEQUENCE)})`)})::text))`;
}
export function preparationStyleLedgerDigestSql(exclude=false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>${literal(PREPARATION_STYLE_VERSION)}` : ''})`;
}
const ledgerRow = version => `(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(version)})`;
const dependenciesReady = `(to_regprocedure('auth.uid()') IS NOT NULL AND to_regprocedure('public.is_current_couple_member(uuid,uuid)') IS NOT NULL
 AND (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT a.attisdropped AND (n.nspname||'.'||c.relname||'.'||a.attname) IN
 ('auth.users.id','public.profiles.id','public.profiles.couple_id','public.profiles.role','public.couples.id',
 'public.couples.bride_id','public.couples.groom_id','public.account_deletion_jobs.user_id','public.account_deletion_jobs.status'))=9)`;
export function buildPreparationStyleObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','preparation-style-catalog-v1','systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'serverVersion',current_setting('server_version'),'database',current_database(),'currentUser',current_user,
 'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),'dependenciesReady',${dependenciesReady},
 'catalog',${preparationStyleTargetCatalogSql()},'dependencies',${preparationStyleDependencyCatalogSql()},'preservedCatalogSha',${preparationStylePreservedCatalogSql()},
 'ledgerSha',${preparationStyleLedgerDigestSql()},'ledgerWithoutTargetSha',${preparationStyleLedgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',${ledgerRow(PREPARATION_STYLE_VERSION)},'predecessor',${ledgerRow('20260918090000')}) AS observation; COMMIT;`;
}
function sortedTree(value) {
  if (Array.isArray(value)) { const children=value.map(sortedTree); return value.length>0&&value.every(child=>child&&typeof child==='object')
    ? children.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) : children; }
  if (value&&typeof value==='object') return Object.fromEntries(Object.entries(value).sort().map(([key,child])=>[key,sortedTree(child)]));
  return value;
}
export function expectedPreparationStyleCatalog(fixture, applied) {
  return Object.fromEntries(['relations','functions','sequences','parentTriggers'].map(key=>[key,applied?structuredClone(fixture[key]):[]]));
}
export function validatePreparationStyleCatalog(catalog, fixture, applied) {
  same(sortedTree(catalog),sortedTree(expectedPreparationStyleCatalog(fixture,applied)),'PREPARATION_STYLE_TARGET_CATALOG_DRIFT');
}
export function validatePreparationStyleObservation(observed,{sql,fixture,predecessorSql,now}) {
  requireValue(observed?.format==='preparation-style-catalog-v1'&&observed.readOnly===true&&observed.dependenciesReady===true
    &&observed.systemIdentifier===PREPARATION_STYLE_SYSTEM&&observed.database==='postgres'&&observed.currentUser==='postgres'
    &&/^17\./.test(observed.serverVersion??'')
    &&[observed.preservedCatalogSha,observed.ledgerSha,observed.ledgerWithoutTargetSha].every(value=>MD5.test(value??''))
    &&Number.isSafeInteger(observed.ledgerCount)&&observed.ledgerCount>0,'PREPARATION_STYLE_OBSERVATION_INVALID');
  const at=Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at)&&at<=now.getTime()+10_000&&at>now.getTime()-120_000,'PREPARATION_STYLE_OBSERVATION_EXPIRED');
  same(sortedTree(observed.dependencies),sortedTree(fixture.dependencies),'PREPARATION_STYLE_DEPENDENCY_DRIFT');
  same(observed.predecessor,{version:'20260918090000',name:'wedding_code_research_scene_v10',statementCount:1,sqlMd5:md5(predecessorSql)},'PREPARATION_STYLE_PREDECESSOR_NOT_APPLIED');
  if(observed.migration!==null) same(observed.migration,{version:PREPARATION_STYLE_VERSION,name:'wedding_preparation_style',
    statementCount:1,sqlMd5:md5(sql)},'PREPARATION_STYLE_LEDGER_CONFLICT');
  else requireValue(observed.ledgerSha===observed.ledgerWithoutTargetSha,'PREPARATION_STYLE_LEDGER_CONFLICT');
  validatePreparationStyleCatalog(observed.catalog,fixture,observed.migration!==null);return observed;
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
  requireValue(body!==sql&&!/\b(COMMIT|ROLLBACK)\s*;/i.test(body),'PREPARATION_STYLE_SQL_ENVELOPE_INVALID');return body;
}
export function buildPreparationStyleMutationSql({sql,fixture,before,deadline,rehearsal}) {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline)&&before?.migration===null
    &&[before.ledgerSha,before.preservedCatalogSha].every(value=>MD5.test(value??'')),'PREPARATION_STYLE_BUNDLE_INVALID');
  validatePreparationStyleCatalog(before.catalog,fixture,false);
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(60920,1); LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $preparation_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>'${PREPARATION_STYLE_SYSTEM}' OR current_database()<>'postgres'
 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR NOT ${dependenciesReady} THEN RAISE EXCEPTION 'PREPARATION_STYLE_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'PREPARATION_STYLE_DEADLINE_EXPIRED'; END IF;
 IF ${preparationStyleTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${preparationStyleDependencyCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(fixture.dependencies)}
 OR ${preparationStylePreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${preparationStyleLedgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'PREPARATION_STYLE_BASELINE_DRIFT'; END IF;
 END $preparation_before$;
 ${unwrap(sql)}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${PREPARATION_STYLE_VERSION}','wedding_preparation_style',ARRAY[${literal(sql)}]::text[]);
 DO $preparation_after$ BEGIN
 IF ${preparationStyleTargetCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(expectedPreparationStyleCatalog(fixture,true))}
 OR ${preparationStyleDependencyCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(fixture.dependencies)}
 OR ${preparationStylePreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${preparationStyleLedgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR EXISTS(SELECT 1 FROM public.wedding_preparation_style_responses) OR EXISTS(SELECT 1 FROM public.wedding_preparation_style_shares)
 THEN RAISE EXCEPTION 'PREPARATION_STYLE_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'PREPARATION_STYLE_DEADLINE_EXPIRED'; END IF;
 END $preparation_after$;
 ${rehearsal?'ROLLBACK':'COMMIT'};`;
}
