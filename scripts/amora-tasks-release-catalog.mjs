// 아모라 맡은 일 마이그레이션(20261120160000)의 새 객체만 허용한다. 기존 서비스의 catalog/ledger 는 digest 만 읽는다.
// 관측식은 웨딩홀 문의 배포 길(hall-inquiry-release-catalog.mjs)과 같다. 다른 점은 셋이다.
//   1. 이 SQL 은 기존 표에 트리거·칸·정책을 달지 않는다. 대상 catalog 는 새 표·새 함수 두 칸뿐이고(36문항 길과 같은 꼴),
//      보존 catalog 는 기존 표의 트리거를 하나도 빼지 않고 본다.
//   2. 기대는 기존 객체가 다르다(couples·account_deletion_jobs·amora_chat_request_claims·auth.users 와 함수 셋).
//   3. 맨 위 SQL 을 문장으로 나누는 일은 웨딩홀 문의 길의 검토된 원문(topLevelStatements·unwrapMigration)을 그대로 쓴다.
//      그 원문은 그 길의 고정 목록이 hash 로 지키고, 이 길은 앞 길 확인(assertPredecessorPins·빌드 계약)에서 그 목록을 다시 본다.
//      오류 이름만 ATK_ 로 바꾼다.
import { topLevelStatements as hallInquiryTopLevelStatements, unwrapMigration as unwrapHallInquiryMigration }
  from './hall-inquiry-release-catalog.mjs';

export const PROJECT_REF = 'slrtobkksjmxgzatjyqb';
export const SYSTEM_IDENTIFIER = '7581440907192989109';
export const MIGRATION_VERSION = '20261120160000';
export const MIGRATION_NAME = 'amora_tasks';
// 파일 이름은 이 두 값에서만 나온다. 버전이 바뀌면 여기 한 곳만 고치고 prepare --regenerate 를 돌린다.
export const MIGRATION_FILE = `supabase/migrations/${MIGRATION_VERSION}_${MIGRATION_NAME}.sql`;
export const TABLES = ['amora_tasks', 'amora_task_daily_usage', 'amora_task_global_daily_usage'];
export const FUNCTIONS = ['amora_task_kst_day', 'amora_task_couple_deletion_pending', 'offer_amora_task', 'start_amora_task',
  'cancel_amora_task', 'resume_amora_task', 'claim_amora_task', 'save_amora_task_progress', 'reserve_amora_task_usage',
  'release_amora_task', 'finish_amora_task', 'claim_amora_task_notifications', 'finish_amora_task_notification'];
// 새 SQL 이 기대는 기존 객체. 운영에 하나라도 없으면 적용 전에 막는다(원장 숫자만으로 판단하지 않는다).
// 외래 키·CHECK·정책이 부르는 것은 반영 때 묶이지만, plpgsql 본문의 표·칸은 실행할 때 묶이므로 반영·연습은 통과해도
// 나중에 42P01·42703 으로 깨진다. 그래서 본문이 읽는 표·칸(amora_chat_request_claims 등)도 본다.
export const PREREQUISITES = Object.freeze({
  relations: [['auth', 'users'], ['public', 'couples'], ['public', 'account_deletion_jobs'],
    ['public', 'amora_chat_request_claims']],
  columns: [['auth', 'users', 'id'], ['public', 'couples', 'id'], ['public', 'couples', 'bride_id'],
    ['public', 'couples', 'groom_id'], ['public', 'account_deletion_jobs', 'user_id'],
    ['public', 'account_deletion_jobs', 'status'], ['public', 'amora_chat_request_claims', 'couple_id'],
    ['public', 'amora_chat_request_claims', 'request_key'], ['public', 'amora_chat_request_claims', 'visibility']],
  functions: [['public', 'couple_plan_change_has_unsafe_display_text', 'text'], ['public', 'is_couple_member', 'uuid'],
    ['public', 'is_current_couple_member', 'uuid, uuid']],
  // 이 SQL 이 기존 표에서 읽어 견주는 값('shared', 'completed')을 그 표의 CHECK 제약이 받는지(그 이름의 제약 정의 글에
  // 값이 있는지) 본다. 이름을 정확히 짚는다. account_deletion_jobs 의 다른 CHECK(identity_state)도 'completed' 를 글에 담고 있다.
  checkValues: [['public', 'amora_chat_request_claims', 'amora_chat_request_claims_visibility_check', 'shared'],
    ['public', 'account_deletion_jobs', 'account_deletion_jobs_status', 'completed']],
});
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const names = values => values.map(literal).join(',');
// JSON 행의 순서는 DB 기본 locale 대신 bytewise C collation으로 고정한다.
export const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text COLLATE "C"),'[]'::jsonb) FROM (${query}) q(v))`;
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
// PostgreSQL 18의 not-null constraint는 17에 없으므로 attnotnull로만 고정한다.
const constraints = aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true))
 FROM pg_constraint WHERE conrelid=c.oid AND contype<>'n'`);
const indexes = aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid`);
const policies = aggregate(`SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
 'roles',(SELECT array_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(polroles) r),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) FROM pg_policy WHERE polrelid=c.oid`);
// 새 표든 기존 표든 트리거를 하나도 빼지 않는다. 이 SQL 은 기존 표에 트리거를 달지 않는다.
const triggers = aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal`);
const relationShape = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,
 'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl', 'r')},
 'columns',${columns},'constraints',${constraints},'indexes',${indexes},'policies',${policies},'triggers',${triggers})`;
const functionShape = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'definition',pg_get_functiondef(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,'kind',c.prokind,
 'config',c.proconfig,'body',c.prosrc,'acl',${acl('c.proacl', 'f')})`;
const sequenceShape = `jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),
 'acl',${acl('c.relacl', 's')},'type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,
 'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle)`;

export function targetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relationShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${names(TABLES)})`)},
 'functions',${aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${names(FUNCTIONS)})`)})`;
}
// 보존 catalog 는 대상 모양에 더해 소유자 변경·옵션·뷰 정의·규칙·주석·publication 소속까지 본다(웨딩홀 문의 길과 같다).
// 이 값들은 대상 catalog(고정 파일)에는 넣지 않는다. 새 객체의 모양은 그대로 두고 기존 객체의 변화만 더 넓게 잡는다.
const preservedRelationShape = `(${relationShape} || jsonb_build_object('options',c.reloptions,
 'view',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END,
 'rules',${aggregate(`SELECT jsonb_build_array(r.rulename,pg_get_ruledef(r.oid,true)) FROM pg_rewrite r
 WHERE r.ev_class=c.oid AND r.rulename<>'_RETURN'`)},
 'comment',obj_description(c.oid,'pg_class'),
 'columnComments',${aggregate(`SELECT jsonb_build_array(a.attname,col_description(c.oid,a.attnum)) FROM pg_attribute a
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND col_description(c.oid,a.attnum) IS NOT NULL`)},
 'publications',${aggregate(`SELECT to_jsonb(p.pubname) FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid
 WHERE pr.prrelid=c.oid`)}))`;
export function preservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object('relations',${aggregate(`SELECT ${preservedRelationShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','cron') AND c.relkind IN ('r','p','v','m','f')
 AND NOT(n.nspname='public' AND c.relname IN (${names(TABLES)}))`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),md5(pg_get_functiondef(c.oid)),c.proacl,
 pg_get_userbyid(c.proowner),obj_description(c.oid,'pg_proc'))
 FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname IN ('public','auth','storage','cron') AND c.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND c.proname IN (${names(FUNCTIONS)}))`)},
 'sequences',${aggregate(`SELECT ${sequenceShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_sequence s ON s.seqrelid=c.oid WHERE n.nspname IN ('public','auth','storage','cron')`)},
 'defaultAcl',${aggregate(`SELECT jsonb_build_array(pg_get_userbyid(d.defaclrole),COALESCE(n.nspname,''),d.defaclobjtype,d.defaclacl)
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace`)},
 'schemas',${aggregate(`SELECT jsonb_build_array(nspname,pg_get_userbyid(nspowner),nspacl) FROM pg_namespace
 WHERE nspname IN ('public','auth','storage','cron')`)}
 )::text))`;
}
// catalog 만 읽는다. 읽기 전용 관측 역할은 auth 스키마 USAGE 가 없을 수 있어 to_regclass 대신 pg_class 를 본다.
export function missingPrerequisitesSql() {
  const rows = [
    ...PREREQUISITES.relations.map(([schema, name]) => `SELECT ${literal(`relation:${schema}.${name}`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=${literal(schema)} AND c.relname=${literal(name)} AND c.relkind IN ('r','p'))`),
    ...PREREQUISITES.columns.map(([schema, table, column]) => `SELECT ${literal(`column:${schema}.${table}.${column}`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=${literal(schema)} AND c.relname=${literal(table)} AND a.attname=${literal(column)} AND a.attnum>0 AND NOT a.attisdropped)`),
    ...PREREQUISITES.functions.map(([schema, name, args]) => `SELECT ${literal(`function:${schema}.${name}(${args})`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=${literal(schema)} AND p.proname=${literal(name)} AND oidvectortypes(p.proargtypes)=${literal(args)})`),
    ...PREREQUISITES.checkValues.map(([schema, table, constraint, value]) => `SELECT ${literal(`check:${schema}.${table}.${constraint}:${value}`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=${literal(schema)} AND c.relname=${literal(table)} AND k.contype='c' AND k.conname=${literal(constraint)}
 AND pg_get_constraintdef(k.oid) LIKE ${literal(`%'${value}'%`)})`),
  ];
  return `(SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v COLLATE "C"),'[]'::jsonb) FROM (${rows.join('\n UNION ALL ')}) q(v))`;
}
export function ledgerDigestSql(excludeTarget = false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${excludeTarget ? ` WHERE version<>${literal(MIGRATION_VERSION)}` : ''})`;
}
const ledgerRowSql = `(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(MIGRATION_VERSION)})`;
const databaseIdentitySql = `(SELECT system_identifier::text FROM pg_control_system())=${literal(SYSTEM_IDENTIFIER)}
 AND current_database()='postgres'
 AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
 AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))=3`;
export const targetIdentitySql = `${databaseIdentitySql} AND current_user='postgres'
 AND has_schema_privilege(current_user,'public','CREATE')
 AND has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT')
 AND has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT')`;
// Management API의 read_only:true는 전용 최소권한 역할로 실행된다.
// 관측 역할을 쓰기 역할로 오인하지 않으며, mutation의 postgres guard는 별도로 유지한다.
const observationIdentitySql = `${databaseIdentitySql} AND current_user='supabase_read_only_user'
 AND has_schema_privilege(current_user,'public','USAGE')
 AND has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT')
 AND NOT has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT')
 AND NOT has_schema_privilege(current_user,'public','CREATE')`;

export function buildObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','amora-tasks-catalog-v1','identityReady',(${observationIdentitySql}),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on',
 'observedAt',clock_timestamp(),'catalog',${targetCatalogSql()},'preservedCatalogSha',${preservedCatalogSql()},
 'missingPrerequisites',${missingPrerequisitesSql()},
 'ledgerSha',${ledgerDigestSql()},'ledgerWithoutTargetSha',${ledgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'ledgerHead',(SELECT max(version) FROM supabase_migrations.schema_migrations),'migration',${ledgerRowSql}) AS observation; COMMIT;`;
}

// 맨 위 SQL 을 문장 단위로 나눈다(줄 주석·블록 주석·문자열·큰따옴표 이름·달러 따옴표 본문 안의 ; 와 낱말은 문장으로 보지 않는다).
// 정적 보조 검사용이다. 실제 실행은 고정 원문 그대로 한다.
export function topLevelStatements(sql) {
  try { return hallInquiryTopLevelStatements(sql); } catch { throw new Error('ATK_SQL_TOKEN_INVALID'); }
}
// 각 문장을 줄 머리에서 시작하게 이어 붙인 맨 위 SQL.
export const topLevelSql = sql => topLevelStatements(sql).map(statement => `${statement};`).join('\n');
// 머리 주석·빈 줄 뒤의 BEGIN; 과 끝의 COMMIT; 을 벗긴다. 본문의 어느 문장도 거래를 끝내거나 나누지 못한다.
export function unwrapMigration(sql) {
  try { return unwrapHallInquiryMigration(sql); } catch { throw new Error('ATK_SQL_TRANSACTION_BOUNDARY_INVALID'); }
}

const emptyTargetCatalog = catalog => catalog !== null && typeof catalog === 'object' && !Array.isArray(catalog)
  && Object.keys(catalog).sort().join(',') === 'functions,relations'
  && Array.isArray(catalog.relations) && catalog.relations.length === 0
  && Array.isArray(catalog.functions) && catalog.functions.length === 0;

export function buildMutationSql({ sql, before, catalog, deadline, rehearsal }) {
  const md5 = /^[a-f0-9]{32}$/u;
  if (![before?.ledgerSha, before?.preservedCatalogSha].every(v => md5.test(v ?? ''))
      || !Number.isSafeInteger(before?.ledgerCount) || before.ledgerCount < 1 || before.migration !== null
      || !emptyTargetCatalog(before.catalog)
      || !Array.isArray(before.missingPrerequisites) || before.missingPrerequisites.length !== 0
      || !catalog || typeof catalog !== 'object'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(deadline ?? '')
      || typeof rehearsal !== 'boolean') throw new Error('ATK_MUTATION_BASELINE_INVALID');
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(61120,1); LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $atk_before$ BEGIN
 IF NOT (${targetIdentitySql}) THEN RAISE EXCEPTION 'ATK_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'ATK_DEADLINE_EXPIRED'; END IF;
 IF ${missingPrerequisitesSql()} IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'ATK_PREREQUISITE_MISSING'; END IF;
 IF ${targetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${preservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${before.ledgerCount}
 THEN RAISE EXCEPTION 'ATK_BASELINE_DRIFT'; END IF;
 END $atk_before$;
${unwrapMigration(sql)}
 SET LOCAL search_path=pg_catalog,public;
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(MIGRATION_VERSION)},${literal(MIGRATION_NAME)},ARRAY[${literal(sql)}]::text[]);
 DO $atk_after$ BEGIN
 IF ${targetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(catalog))}::jsonb
 OR ${preservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${before.ledgerCount + 1}
 ${TABLES.map(table => `OR EXISTS(SELECT 1 FROM public.${table})`).join('\n ')}
 THEN RAISE EXCEPTION 'ATK_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'ATK_DEADLINE_EXPIRED'; END IF;
 END $atk_after$;
 ${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}
