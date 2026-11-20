// 웨딩홀 문의 마이그레이션(20261117090000)의 새 객체만 허용한다. 기존 서비스의 catalog/ledger는 digest만 읽는다.
// 관측식은 36문항 배포 길(wedding-code36-release-catalog.mjs)과 같다. 다른 점은 셋이다.
//   1. 기존 표 public.account_deletion_jobs 에 트리거 하나(trg_hall_inquiry_account_deletion)를 단다.
//      그 트리거만 대상 catalog 의 existingTableTriggers 에 넣고, 보존 catalog 에서는 그 트리거 하나만 뺀다.
//   2. 적용 전에 이 SQL 이 기대는 기존 객체(표·칸·함수)가 있는지 catalog 로 본다(missingPrerequisites).
//   3. 마이그레이션 파일은 머리 주석 뒤에 BEGIN; 이 온다. 주석과 빈 줄만 건너뛴다.
export const PROJECT_REF = 'slrtobkksjmxgzatjyqb';
export const SYSTEM_IDENTIFIER = '7581440907192989109';
export const MIGRATION_VERSION = '20261117090000';
export const MIGRATION_NAME = 'hall_listings_and_inquiries';
export const TABLES = ['hall_listings', 'hall_shortlists', 'hall_inquiry_settings', 'hall_inquiry_letters',
  'hall_inquiry_letter_versions', 'hall_inquiry_approvals', 'hall_inquiry_dispatches', 'hall_inquiry_replies'];
export const FUNCTIONS = ['hall_inquiry_text_is_unsafe', 'hall_inquiry_shares_are_valid', 'hall_inquiry_shares_canonical',
  'hall_inquiry_letter_fingerprint', 'hall_inquiry_dispatch_fingerprint', 'hall_shortlists_enforce_limit',
  'hall_inquiry_guard_record_update', 'hall_inquiry_current_members', 'hall_inquiry_notify', 'hall_inquiry_lock_member',
  'hall_inquiry_save_letter_version', 'hall_inquiry_approver_change_needs_consent', 'hall_inquiry_approver_state',
  'hall_inquiry_drop_approver_proposal', 'hall_inquiry_respond_approver', 'hall_inquiry_set_approver',
  'hall_inquiry_approve_letter', 'hall_inquiry_assert_operator', 'hall_inquiry_mark_sent', 'hall_inquiry_record_reply',
  'hall_inquiry_purge_for_account_deletion', 'hall_inquiry_viewer_account_active'];
// 새 SQL 이 기존 표에 다는 트리거. 이것 말고 기존 catalog 는 한 바이트도 바뀌면 안 된다.
export const EXISTING_TABLE_TRIGGERS = Object.freeze([
  Object.freeze({ schema: 'public', table: 'account_deletion_jobs', name: 'trg_hall_inquiry_account_deletion' }),
]);
// 새 SQL 이 기대는 기존 객체. 운영에 하나라도 없으면 적용 전에 막는다(원장 숫자만으로 판단하지 않는다).
// plpgsql 본문의 칸은 실행할 때 묶이므로 반영·연습은 통과해도 나중에 42703 으로 깨진다. 그래서 본문이 읽고 쓰는 칸도 본다.
const NOTIFICATION_COLUMNS = ['couple_id', 'recipient_user_id', 'actor_user_id', 'source_message_id', 'action_id',
  'event_kind', 'tool_name', 'title', 'message', 'href'];
export const PREREQUISITES = Object.freeze({
  relations: [['auth', 'users'], ['public', 'couples'], ['public', 'profiles'], ['public', 'account_deletion_jobs'],
    ['public', 'couple_change_notifications']],
  columns: [['public', 'account_deletion_jobs', 'user_id'], ['public', 'account_deletion_jobs', 'status'],
    ['public', 'profiles', 'couple_id'], ['public', 'profiles', 'is_admin'],
    ['public', 'couples', 'bride_id'], ['public', 'couples', 'groom_id'],
    ...NOTIFICATION_COLUMNS.map(column => ['public', 'couple_change_notifications', column])],
  functions: [['auth', 'uid', ''], ['public', 'is_couple_member', 'uuid'], ['public', 'is_current_couple_member', 'uuid, uuid']],
  // 알림 표 event_kind 의 CHECK 제약이 이 SQL 이 쓰는 값을 받는지(그 이름의 제약 정의 글에 값이 있는지) 본다.
  // 이름을 정확히 짚는다. 같은 표의 다른 CHECK(actor_recipient_check)도 event_kind 와 'change_stale' 을 글에 담고 있다.
  checkValues: ['change_applied', 'change_rejected', 'change_stale']
    .map(value => ['public', 'couple_change_notifications', 'couple_change_notifications_event_kind_check', value]),
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
// 바깥 질의의 n(스키마)·c(표)와 pg_trigger 의 tgname 으로 "새 SQL 이 기존 표에 다는 트리거" 를 가린다.
const existingTriggerMatch = (schema, table, trigger) => `(${schema},${table},${trigger}) IN (${EXISTING_TABLE_TRIGGERS
  .map(t => `(${literal(t.schema)},${literal(t.table)},${literal(t.name)})`).join(',')})`;
const triggersOf = excludeTargetTriggers => aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal${excludeTargetTriggers
  ? ` AND NOT ${existingTriggerMatch('n.nspname', 'c.relname', 'tgname')}` : ''}`);
const relationShape = excludeTargetTriggers => `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,
 'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl', 'r')},
 'columns',${columns},'constraints',${constraints},'indexes',${indexes},'policies',${policies},
 'triggers',${triggersOf(excludeTargetTriggers)})`;
const functionShape = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'definition',pg_get_functiondef(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,'kind',c.prokind,
 'config',c.proconfig,'body',c.prosrc,'acl',${acl('c.proacl', 'f')})`;
const sequenceShape = `jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),
 'acl',${acl('c.relacl', 's')},'type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,
 'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle)`;

export function targetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relationShape(false)} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${names(TABLES)})`)},
 'functions',${aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${names(FUNCTIONS)})`)},
 'existingTableTriggers',${aggregate(`SELECT jsonb_build_array(n.nspname||'.'||c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true))
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND ${existingTriggerMatch('n.nspname', 'c.relname', 't.tgname')}`)})`;
}
// 보존 catalog 는 대상 모양에 더해 소유자 변경·옵션·뷰 정의·규칙·주석·publication 소속까지 본다(2026-11-18 독립 검토).
// 이 값들은 대상 catalog(고정 파일)에는 넣지 않는다. 새 객체의 모양은 그대로 두고 기존 객체의 변화만 더 넓게 잡는다.
const preservedRelationShape = `(${relationShape(true)} || jsonb_build_object('options',c.reloptions,
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
 SELECT jsonb_build_object('format','hall-inquiry-catalog-v1','identityReady',(${observationIdentitySql}),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on',
 'observedAt',clock_timestamp(),'catalog',${targetCatalogSql()},'preservedCatalogSha',${preservedCatalogSql()},
 'missingPrerequisites',${missingPrerequisitesSql()},
 'ledgerSha',${ledgerDigestSql()},'ledgerWithoutTargetSha',${ledgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'ledgerHead',(SELECT max(version) FROM supabase_migrations.schema_migrations),'migration',${ledgerRowSql}) AS observation; COMMIT;`;
}

// 달러 따옴표 본문과 줄 주석을 걷어 낸 맨 위 SQL. 거래 경계·맨 위 DML 같은 보조 정적 검사에 쓴다.
// 맨 위 SQL 을 문장 단위로 나눈다. 줄 주석·블록 주석·문자열('…', E'…' 의 백슬래시)·큰따옴표 이름·달러 따옴표 본문은
// 그대로 건너뛰어 그 안의 ; 와 낱말을 문장으로 보지 않는다(2026-11-18 검토: 줄 머리만 보면 'SELECT 1; COMMIT;' 을 놓친다).
// 문자열은 '' 로, 본문은 $body$ 로 바꿔 둔다. 정적 보조 검사용이다. 실제 실행은 고정 원문 그대로 한다.
// PostgreSQL 이름에 이어 쓸 수 있는 글자(ident_cont: 영문·숫자·_·$·0x80 이상). 이 글자 바로 뒤의 e' 와 $tag$ 는
// 새 문자열이 아니라 이름의 일부다(예: x$$f$, 한$f$, 한e'…'). ASCII 만 보면 그 안의 ; COMMIT; 을 문자열로 잘못 숨긴다.
const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-\uFFFF]/u;
export function topLevelStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  const bad = () => { throw new Error('HIQ_SQL_TOKEN_INVALID'); };
  while (i < sql.length) {
    const ch = sql[i], next = sql[i + 1];
    if (ch === '-' && next === '-') { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; current += ' '; continue; }
    if (ch === '/' && next === '*') { const end = sql.indexOf('*/', i + 2); if (end < 0) bad(); i = end + 2; current += ' '; continue; }
    if (ch === "'") {
      const escaped = /[Ee]/u.test(sql[i - 1] ?? '') && !IDENTIFIER_CHAR.test(sql[i - 2] ?? '');
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) bad();
        if (escaped && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j += 1;
      }
      i = j + 1; current += "''"; continue;
    }
    if (ch === '"') {
      let j = i + 1;
      for (;;) { if (j >= sql.length) bad(); if (sql[j] === '"') { if (sql[j + 1] === '"') { j += 2; continue; } break; } j += 1; }
      current += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '$' && !IDENTIFIER_CHAR.test(sql[i - 1] ?? '')) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/u.exec(sql.slice(i, i + 64))?.[0];
      if (tag) { const end = sql.indexOf(tag, i + tag.length); if (end < 0) bad(); i = end + tag.length; current += ' $body$ '; continue; }
    }
    if (ch === ';') { if (current.trim()) statements.push(current.trim()); current = ''; i += 1; continue; }
    current += ch; i += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
// 각 문장을 줄 머리에서 시작하게 이어 붙인 맨 위 SQL. 문장 첫 낱말 검사(^ 와 m 깃발)가 줄 가운데 문장도 본다.
export const topLevelSql = sql => topLevelStatements(sql).map(statement => `${statement};`).join('\n');
const TRANSACTION_CONTROL = /^(?:BEGIN|COMMIT|ROLLBACK|END|ABORT|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION|SET\s+(?:SESSION\s+)?TRANSACTION|SET\s+SESSION\s+CHARACTERISTICS)\b/iu;

export function unwrapMigration(sql) {
  const lines = sql.split('\n');
  let first = 0;
  while (first < lines.length && /^\s*(?:--.*)?$/u.test(lines[first])) first += 1;
  if (first >= lines.length || lines[first] !== 'BEGIN;') throw new Error('HIQ_SQL_TRANSACTION_BOUNDARY_INVALID');
  const rest = lines.slice(first + 1).join('\n');
  const end = /(?:^|\n)COMMIT;\s*$/u.exec(rest);
  if (!end) throw new Error('HIQ_SQL_TRANSACTION_BOUNDARY_INVALID');
  const body = rest.slice(0, end.index + (rest[end.index] === '\n' ? 1 : 0));
  let statements;
  try { statements = topLevelStatements(body); } catch { throw new Error('HIQ_SQL_TRANSACTION_BOUNDARY_INVALID'); }
  // 본문의 어느 문장도 거래를 끝내거나 나누지 못한다. 그래야 연습 묶음의 마지막 ROLLBACK 이 전부를 되돌린다.
  if (statements.some(statement => TRANSACTION_CONTROL.test(statement))) throw new Error('HIQ_SQL_TRANSACTION_BOUNDARY_INVALID');
  return body;
}

const emptyTargetCatalog = catalog => Array.isArray(catalog?.relations) && catalog.relations.length === 0
  && Array.isArray(catalog?.functions) && catalog.functions.length === 0
  && Array.isArray(catalog?.existingTableTriggers) && catalog.existingTableTriggers.length === 0;

export function buildMutationSql({ sql, before, catalog, deadline, rehearsal }) {
  const md5 = /^[a-f0-9]{32}$/u;
  if (![before?.ledgerSha, before?.preservedCatalogSha].every(v => md5.test(v ?? ''))
      || !Number.isSafeInteger(before?.ledgerCount) || before.ledgerCount < 1 || before.migration !== null
      || !emptyTargetCatalog(before.catalog)
      || !Array.isArray(before.missingPrerequisites) || before.missingPrerequisites.length !== 0
      || !catalog || typeof catalog !== 'object'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(deadline ?? '')
      || typeof rehearsal !== 'boolean') throw new Error('HIQ_MUTATION_BASELINE_INVALID');
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(61117,9); LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $hiq_before$ BEGIN
 IF NOT (${targetIdentitySql}) THEN RAISE EXCEPTION 'HIQ_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'HIQ_DEADLINE_EXPIRED'; END IF;
 IF ${missingPrerequisitesSql()} IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'HIQ_PREREQUISITE_MISSING'; END IF;
 IF ${targetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${preservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${before.ledgerCount}
 THEN RAISE EXCEPTION 'HIQ_BASELINE_DRIFT'; END IF;
 END $hiq_before$;
${unwrapMigration(sql)}
 SET LOCAL search_path=pg_catalog,public;
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(MIGRATION_VERSION)},${literal(MIGRATION_NAME)},ARRAY[${literal(sql)}]::text[]);
 DO $hiq_after$ BEGIN
 IF ${targetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(catalog))}::jsonb
 OR ${preservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${before.ledgerCount + 1}
 ${TABLES.map(table => `OR EXISTS(SELECT 1 FROM public.${table})`).join('\n ')}
 THEN RAISE EXCEPTION 'HIQ_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'HIQ_DEADLINE_EXPIRED'; END IF;
 END $hiq_after$;
 ${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}
