import { createHash } from 'node:crypto';
import { CurrentBaselineBlocked, same } from './current-baseline-release-contract.mjs';

const fail = code => { throw new CurrentBaselineBlocked(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export const PROFILE_AVATAR_VERSION = '20260913082314';
export const PROFILE_AVATAR_PROJECT = 'slrtobkksjmxgzatjyqb';
export const PROFILE_AVATAR_SYSTEM = '7581440907192989109';
const TABLES = ['profile_avatars','profile_avatar_assets'];
const FUNCTIONS = ['register_profile_avatar_asset','save_profile_avatar','read_profile_avatar_snapshot'];
const REPLACED = 'replace_account_deletion_media_manifest';
export const PROFILE_AVATAR_REQUIRED_COLUMNS = Object.freeze([
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
 FROM pg_constraint WHERE conrelid=c.oid AND NOT (c.relname='account_deletion_media_manifest' AND conname IN ('account_deletion_media_bucket','account_deletion_media_source'))`);
const indexes = aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready)
 FROM pg_index WHERE indrelid=c.oid`);
const policies = aggregate(`SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,'roles',(SELECT array_agg(pg_get_userbyid(r) ORDER BY pg_get_userbyid(r)) FROM unnest(polroles) r),'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) FROM pg_policy p WHERE polrelid=c.oid AND NOT(c.relname='objects' AND polname='profile_avatar_service_only')`);
const triggers = aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal`);
const relation = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl', 'r')},
 'columns',${columns},'constraints',${constraints},'indexes',${indexes},'policies',${policies},'triggers',${triggers})`;
const functions = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,
 'config',c.proconfig,'body',c.prosrc,'acl',${acl('c.proacl', 'f')})`;

const policy = aggregate(`SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,'roles',
 (SELECT array_agg(pg_get_userbyid(r) ORDER BY pg_get_userbyid(r)) FROM unnest(polroles) r),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) FROM pg_policy
 WHERE polrelid='storage.objects'::regclass AND polname='profile_avatar_service_only'`);
const manifestConstraints = aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true))
 FROM pg_constraint WHERE conrelid='public.account_deletion_media_manifest'::regclass
 AND conname IN ('account_deletion_media_bucket','account_deletion_media_source')`);
const functionQuery = names => `SELECT ${functions} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${names.map(literal).join(',')})`;

// 비대상 객체는 테이블 단위로 숨기지 않는다. 정확한 두 제약/한 정책/한 함수만 별도 비교한다.
export function profileAvatarPreservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage')
 AND c.relkind IN ('r','p','v','m','f') AND NOT(n.nspname='public' AND c.relname IN (${TABLES.map(literal).join(',')}))`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),pg_get_functiondef(c.oid),c.proacl)
 FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname IN ('public','auth','storage')
 AND c.prokind IN ('f','p') AND NOT(n.nspname='public' AND c.proname IN (${[...FUNCTIONS,REPLACED].map(literal).join(',')}))`)}
 )::text))`;
}
export function profileAvatarTargetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${TABLES.map(literal).join(',')})`)},
 'functions',${aggregate(functionQuery(FUNCTIONS))},'manifestFunction',${aggregate(functionQuery([REPLACED]))},
 'manifestConstraints',${manifestConstraints},'policy',${policy},
 'bucket',(SELECT jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)
 FROM storage.buckets WHERE id='profile-avatars'))`;
}
export function profileAvatarLedgerDigestSql(exclude=false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>'${PROFILE_AVATAR_VERSION}'` : ''})`;
}
const bucketDigest = `(SELECT md5(COALESCE(jsonb_agg(to_jsonb(b) ORDER BY id)::text,'[]')) FROM storage.buckets b WHERE id<>'profile-avatars')`;
const policyPermission = `jsonb_build_object('currentUser',current_user,'owner',pg_get_userbyid(c.relowner),
 'ownerUsage',pg_has_role(current_user,c.relowner,'USAGE'),'rls',c.relrowsecurity,
 'policyGrants',current_setting('supautils.policy_grants',true),'preloaded',current_setting('shared_preload_libraries',true))
 FROM pg_class c WHERE c.oid='storage.objects'::regclass`;
export function buildProfileAvatarObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','profile-avatar-catalog-v1','systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'serverVersion',current_setting('server_version'),'database',current_database(),'readOnly',current_setting('transaction_read_only')='on',
 'observedAt',clock_timestamp(),'permission',(SELECT ${policyPermission}),
 'catalog',${profileAvatarTargetCatalogSql()},'preservedCatalogSha',${profileAvatarPreservedCatalogSql()},
 'preservedBucketsSha',${bucketDigest},'ledgerSha',${profileAvatarLedgerDigestSql()},'ledgerWithoutTargetSha',${profileAvatarLedgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version='${PROFILE_AVATAR_VERSION}'),
 'predecessor',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version='20260913075045')) AS observation; COMMIT;`;
}
function canonical(value) {
  if(Array.isArray(value)) { const rows=value.map(canonical); return value.some(child=>child&&typeof child==='object')
    ? rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) : rows; }
  if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).sort().map(([k,v])=>[k,canonical(v)]));
  return value;
}
const body = (sql, name) => {
  const start=sql.indexOf(`FUNCTION public.${name}(`);
  const match=/AS (\$[a-z_]*\$)([\s\S]*?)\1;/.exec(sql.slice(start));
  requireValue(start>=0&&match,'PROFILE_AVATAR_FUNCTION_SOURCE_INVALID'); return match[2];
};
export function expectedProfileAvatarCatalog(fixture, {sql,previousSql,applied,policyInstalled=false}) {
  const expected=structuredClone(fixture);
  for(const fn of [...expected.functions,...expected.manifestFunction]) fn.body=body(sql,fn.name);
  if(!applied) {
    expected.relations=[];expected.functions=[];expected.bucket=null;
    expected.manifestFunction[0].body=body(previousSql,REPLACED);
    expected.manifestConstraints=expected.manifestConstraints.map(row=>[...row.slice(0,3),row[3]
      .replace(", 'profile-avatars'::text",'').replace(", 'profile_avatar'::text",'')]);
    if(!policyInstalled) expected.policy=[];
  }
  return expected;
}
export function validateProfileAvatarCatalog(catalog,context,applied) {
  same(canonical(catalog),canonical(expectedProfileAvatarCatalog(context.fixture,{...context,applied,policyInstalled:catalog?.policy?.length>0})),
    'PROFILE_AVATAR_TARGET_CATALOG_DRIFT');
}
export function validateProfileAvatarObservation(observed,context) {
  const {sql,predecessorSql,now}=context;
  requireValue(observed?.format==='profile-avatar-catalog-v1'&&observed.readOnly===true
    &&observed.systemIdentifier===PROFILE_AVATAR_SYSTEM&&observed.database==='postgres'&&/^17\./.test(observed.serverVersion??'')
    &&[observed.preservedCatalogSha,observed.preservedBucketsSha,observed.ledgerSha,observed.ledgerWithoutTargetSha].every(v=>MD5.test(v??''))
    &&Number.isSafeInteger(observed.ledgerCount)&&observed.ledgerCount>0,'PROFILE_AVATAR_OBSERVATION_INVALID');
  const at=Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at)&&at<=now.getTime()+10_000&&at>now.getTime()-120_000,'PROFILE_AVATAR_OBSERVATION_EXPIRED');
  same(observed.predecessor,{version:'20260913075045',name:'profile_wedding_roles',statementCount:1,sqlMd5:md5(predecessorSql)},'PROFILE_AVATAR_PREDECESSOR_NOT_APPLIED');
  const permission=observed.permission;
  let grants;try{grants=JSON.parse(permission?.policyGrants??'null')}catch{grants=null}
  requireValue(permission?.currentUser==='postgres'&&permission.rls===true,'PROFILE_AVATAR_STORAGE_PERMISSION_INVALID');
  // 권한을 부여하거나 관리 서비스 소유자로 전환하지 않는다. 실제 설치된 공식 정책 관리 위임만 허용한다.
  // supautils는 session_preload로도 로드된다. 문자열 목록이 아니라 실제 위임과 뒤이은 DDL 예행 결과를 함께 확인한다.
  requireValue(permission.ownerUsage===true||(Array.isArray(grants?.postgres)&&grants.postgres.includes('storage.objects')),
    'PROFILE_AVATAR_STORAGE_POLICY_AUTHORITY_REQUIRED');
  if(observed.migration!==null) same(observed.migration,{version:PROFILE_AVATAR_VERSION,name:'private_profile_avatars_delivery',
    statementCount:1,sqlMd5:md5(sql)},'PROFILE_AVATAR_LEDGER_CONFLICT');
  else requireValue(observed.ledgerSha===observed.ledgerWithoutTargetSha,'PROFILE_AVATAR_LEDGER_CONFLICT');
  validateProfileAvatarCatalog(observed.catalog,context,observed.migration!==null);return observed;
}
function expectedJsonSql(value) {
  if(Array.isArray(value)&&value.some(v=>v&&typeof v==='object')) return `(SELECT jsonb_agg(v ORDER BY v::text) FROM (VALUES ${value.map(v=>`(${expectedJsonSql(v)})`).join(',')}) q(v))`;
  if(value&&typeof value==='object'&&!Array.isArray(value)) return `jsonb_build_object(${Object.entries(value).flatMap(([k,v])=>[literal(k),expectedJsonSql(v)]).join(',')})`;
  return `${literal(JSON.stringify(value))}::jsonb`;
}
function unwrap(sql) {
  const source=sql.replace(/^[\s\S]*?\bBEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
  requireValue(source!==sql&&!/\bCOMMIT\s*;/i.test(source),'PROFILE_AVATAR_SQL_ENVELOPE_INVALID');return source;
}
export function buildProfileAvatarMutationSql({sql,policySql,fixture,previousSql,before,deadline,rehearsal}) {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline)&&before.migration===null
    &&[before.ledgerSha,before.preservedCatalogSha,before.preservedBucketsSha].every(v=>MD5.test(v??'')),'PROFILE_AVATAR_BUNDLE_INVALID');
  validateProfileAvatarCatalog(before.catalog,{sql,fixture,previousSql},false);
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(60913,4); LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE storage.buckets IN SHARE ROW EXCLUSIVE MODE;
 DO $avatar_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>'${PROFILE_AVATAR_SYSTEM}' OR current_database()<>'postgres'
 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'PROFILE_AVATAR_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'PROFILE_AVATAR_DEADLINE_EXPIRED'; END IF;
 IF ${profileAvatarTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${profileAvatarPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${bucketDigest} IS DISTINCT FROM ${literal(before.preservedBucketsSha)}
 OR ${profileAvatarLedgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'PROFILE_AVATAR_BASELINE_DRIFT'; END IF;
 END $avatar_before$;
 ${before.catalog.policy.length===0?unwrap(policySql):'-- Exact restrictive policy already verified.'}
 ${unwrap(sql)}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${PROFILE_AVATAR_VERSION}','private_profile_avatars_delivery',ARRAY[${literal(sql)}]::text[]);
 DO $avatar_after$ BEGIN
 IF ${profileAvatarTargetCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(expectedProfileAvatarCatalog(fixture,{sql,previousSql,applied:true}))}
 OR ${profileAvatarPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${bucketDigest} IS DISTINCT FROM ${literal(before.preservedBucketsSha)}
 OR ${profileAvatarLedgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR EXISTS(SELECT 1 FROM public.profile_avatars) OR EXISTS(SELECT 1 FROM public.profile_avatar_assets)
 OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='profile-avatars') THEN RAISE EXCEPTION 'PROFILE_AVATAR_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'PROFILE_AVATAR_DEADLINE_EXPIRED'; END IF;
 END $avatar_after$;
 ${rehearsal?'ROLLBACK':'COMMIT'};`;
}
