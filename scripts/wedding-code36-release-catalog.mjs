// 새 36문항 객체만 허용한다. 기존 서비스의 catalog/ledger는 digest만 읽는다.
export const PROJECT_REF = 'slrtobkksjmxgzatjyqb';
export const SYSTEM_IDENTIFIER = '7581440907192989109';
export const MIGRATION_VERSION = '20261015070000';
export const TABLES = ['wedding_code36_responses', 'wedding_code36_pairs'];
export const FUNCTIONS = ['wc36_submit', 'wc36_pair', 'wc36_read_report', 'wc36_invite_status',
  'wc36_update_sharing', 'wc36_delete', 'wc36_purge_expired'];
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
const triggers = aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal`);
const relation = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl','r')},'columns',${columns},
 'constraints',${constraints},'indexes',${indexes},'policies',${policies},'triggers',${triggers})`;
const functionShape = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'definition',pg_get_functiondef(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,'kind',c.prokind,
 'config',c.proconfig,'body',c.prosrc,'acl',${acl('c.proacl','f')})`;
const sequenceShape = `jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),
 'acl',${acl('c.relacl','s')},'type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,
 'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle)`;

export function targetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${names(TABLES)})`)},
 'functions',${aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${names(FUNCTIONS)})`)})`;
}
export function preservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','cron') AND c.relkind IN ('r','p','v','m','f')
 AND NOT(n.nspname='public' AND c.relname IN (${names(TABLES)}))`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),md5(pg_get_functiondef(c.oid)),c.proacl)
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
const targetIdentitySql = `${databaseIdentitySql} AND current_user='postgres'
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
 SELECT jsonb_build_object('format','wedding-code36-catalog-v1','identityReady',(${observationIdentitySql}),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on',
 'observedAt',clock_timestamp(),'catalog',${targetCatalogSql()},'preservedCatalogSha',${preservedCatalogSql()},
 'ledgerSha',${ledgerDigestSql()},'ledgerWithoutTargetSha',${ledgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'ledgerHead',(SELECT max(version) FROM supabase_migrations.schema_migrations),'migration',${ledgerRowSql}) AS observation; COMMIT;`;
}

export function unwrapMigration(sql) {
  const body = sql.replace(/^BEGIN;\s*/u, '').replace(/COMMIT;\s*$/u, '');
  if (/^\s*(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;/imu.test(body)) {
    throw new Error('WC36_SQL_TRANSACTION_BOUNDARY_INVALID');
  }
  return body;
}

export function buildMutationSql({ sql, before, catalog, deadline, rehearsal }) {
  const md5 = /^[a-f0-9]{32}$/u;
  if (![before?.ledgerSha, before?.preservedCatalogSha].every(v => md5.test(v ?? ''))
      || !Number.isSafeInteger(before?.ledgerCount) || before.ledgerCount < 1 || before.migration !== null
      || !Array.isArray(before.catalog?.relations) || before.catalog.relations.length !== 0
      || !Array.isArray(before.catalog?.functions) || before.catalog.functions.length !== 0
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(deadline ?? '')
      || typeof rehearsal !== 'boolean') throw new Error('WC36_MUTATION_BASELINE_INVALID');
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(61015,36); LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $wc36_before$ BEGIN
 IF NOT (${targetIdentitySql}) THEN RAISE EXCEPTION 'WC36_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'WC36_DEADLINE_EXPIRED'; END IF;
 IF ${targetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${preservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${before.ledgerCount}
 THEN RAISE EXCEPTION 'WC36_BASELINE_DRIFT'; END IF;
 END $wc36_before$;
 ${unwrapMigration(sql)}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${MIGRATION_VERSION}','wedding_code36_private_pairing',ARRAY[${literal(sql)}]::text[]);
 DO $wc36_after$ BEGIN
 IF ${targetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(catalog))}::jsonb
 OR ${preservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${before.ledgerCount + 1}
 OR EXISTS(SELECT 1 FROM public.wedding_code36_responses)
 OR EXISTS(SELECT 1 FROM public.wedding_code36_pairs)
 THEN RAISE EXCEPTION 'WC36_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'WC36_DEADLINE_EXPIRED'; END IF;
 END $wc36_after$;
 ${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}
