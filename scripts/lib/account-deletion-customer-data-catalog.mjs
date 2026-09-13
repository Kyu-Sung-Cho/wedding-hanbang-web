import { createHash } from 'node:crypto';
import { CurrentBaselineBlocked, same } from './current-baseline-release-contract.mjs';

const fail = code => { throw new CurrentBaselineBlocked(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const md5 = value => createHash('md5').update(value).digest('hex');
const MD5 = /^[a-f0-9]{32}$/;
export const CUSTOMER_DATA_VERSION = '20260913103407';
export const CUSTOMER_DATA_PROJECT = 'slrtobkksjmxgzatjyqb';
export const CUSTOMER_DATA_SYSTEM = '7581440907192989109';
export const CUSTOMER_DATA_WRITER_TABLES = ['chat_messages', 'chat_summaries', 'decision_nodes', 'amora_couple_profiles',
  'amora_chat_request_claims', 'amora_tool_executions', 'amora_memory_jobs', 'amora_memory_enqueue_repair_candidates',
  'amora_memory_consents', 'amora_saved_notes'];
const NEW_TABLE = 'account_deletion_private_scopes';
const NEW_TABLES = [NEW_TABLE, 'account_deletion_retired_requests'];
const JOB_COLUMNS = ['data_prepared_at', 'data_prepared_version'];
const JOB_CONSTRAINT = 'account_deletion_data_receipt_pair';
const FUNCTIONS = ['guard_account_deletion_customer_write', 'guard_account_deletion_membership_transition',
  'prepare_account_deletion_customer_data', 'guard_account_deletion_auth_boundary'];
const REPLACED = ['prepare_account_deletion_auth_delete', 'claim_amora_memory_job'];
const ALL_FUNCTIONS = [...FUNCTIONS, ...REPLACED];
export const CUSTOMER_DATA_TRIGGER_TABLES = [
  ...CUSTOMER_DATA_WRITER_TABLES.map(table => ['public', table, 'trg_00_account_deletion_customer_write']),
  ['public', 'profiles', 'trg_00_account_deletion_membership'], ['public', 'couples', 'trg_00_account_deletion_membership'],
  ['auth', 'users', 'trg_account_deletion_auth_boundary'],
];
const triggerTarget = CUSTOMER_DATA_TRIGGER_TABLES.map(([schema, table, trigger]) =>
  `(n.nspname=${literal(schema)} AND c.relname=${literal(table)} AND t.tgname=${literal(trigger)})`).join(' OR ');
const dataTables = [...CUSTOMER_DATA_WRITER_TABLES.map(table => `public.${table}`), 'public.profiles', 'public.couples',
  'auth.users', 'public.amora_private_chat_delete_boundaries', 'public.amora_memory_settings', 'public.amora_memory_enqueue_repair_dead_letters'].sort();
const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]') FROM (${query}) q(v))`;
const acl = (expression, kind) => aggregate(`SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(COALESCE(${expression},
 acldefault('${kind}',c.${kind === 'r' ? 'relowner' : 'proowner'}))) a`);
const columnValues = `jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))`;
const columnQuery = condition => `SELECT ${columnValues} FROM pg_attribute a LEFT JOIN pg_attrdef d
 ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ${condition}`;
const columns = aggregate(columnQuery(`AND NOT(n.nspname='public' AND c.relname='account_deletion_jobs' AND a.attname IN (${JOB_COLUMNS.map(literal)}))`));
const constraintValues = `jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true))`;
const constraints = aggregate(`SELECT ${constraintValues} FROM pg_constraint WHERE conrelid=c.oid
 AND NOT(n.nspname='public' AND c.relname='account_deletion_jobs' AND conname=${literal(JOB_CONSTRAINT)})`);
const indexes = aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid`);
const policies = aggregate(`SELECT jsonb_build_array(polname,polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid))
 FROM pg_policy WHERE polrelid=c.oid`);
const triggers = aggregate(`SELECT jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) FROM pg_trigger t
 WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND NOT (${triggerTarget})`);
const relation = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl', 'r')},'columns',${columns},
 'constraints',${constraints},'indexes',${indexes},'policies',${policies},'triggers',${triggers})`;
const functionValue = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),'result',pg_get_function_result(c.oid),
 'language',l.lanname,'owner',pg_get_userbyid(c.proowner),'securityDefiner',c.prosecdef,'volatility',c.provolatile,
 'strict',c.proisstrict,'parallel',c.proparallel,'config',c.proconfig,'body',c.prosrc,'acl',${acl('c.proacl', 'f')})`;
const functionQuery = `SELECT ${functionValue} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${ALL_FUNCTIONS.map(literal)})`;

export function customerDataTargetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${NEW_TABLES.map(literal)})`)},'functions',${aggregate(functionQuery)},
 'jobColumns',${aggregate(`SELECT ${columnValues} FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.account_deletion_jobs'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN (${JOB_COLUMNS.map(literal)})`)},
 'jobConstraint',${aggregate(`SELECT ${constraintValues} FROM pg_constraint WHERE conrelid='public.account_deletion_jobs'::regclass AND conname=${literal(JOB_CONSTRAINT)}`)},
 'triggers',${aggregate(`SELECT jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) FROM pg_trigger t
 JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND (${triggerTarget})`)})`;
}

export function customerDataPreservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','f') AND NOT(n.nspname='public' AND c.relname IN (${NEW_TABLES.map(literal)}))`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),pg_get_functiondef(c.oid),c.proacl)
 FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname IN ('public','auth','storage') AND c.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND c.proname IN (${ALL_FUNCTIONS.map(literal)}))`)} )::text))`;
}

// 원문은 DB 안에서만 해시한다. 고객 행/ID/문장은 응답·영수증에 반환하지 않는다.
export function customerDataRowsSql() {
  return `jsonb_build_object(${dataTables.flatMap(table => [literal(table),
    `(SELECT jsonb_build_array(count(*),md5(COALESCE(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM ${table} r)`]).join(',')})`;
}
export function customerDataLedgerSql(exclude = false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>${literal(CUSTOMER_DATA_VERSION)}` : ''})`;
}
const optionalTableCount = table => `(CASE WHEN to_regclass('public.${table}') IS NULL THEN 0 ELSE
 (xpath('/row/count/text()',query_to_xml('SELECT count(*) FROM public.${table}',false,true,'')))[1]::text::bigint END)`;
const privateScopeCount = optionalTableCount(NEW_TABLE);
const retiredRequestCount = optionalTableCount('account_deletion_retired_requests');
export function buildCustomerDataObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','account-deletion-customer-data-catalog-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),
 'authTriggerAllowed',has_table_privilege(current_user,'auth.users','TRIGGER'),
 'catalog',${customerDataTargetCatalogSql()},'preservedCatalogSha',${customerDataPreservedCatalogSql()},'customerRows',${customerDataRowsSql()},
 'jobsCount',(SELECT count(*) FROM public.account_deletion_jobs),'privateScopesCount',${privateScopeCount},'retiredRequestsCount',${retiredRequestCount},
 'ledgerSha',${customerDataLedgerSql()},'ledgerWithoutTargetSha',${customerDataLedgerSql(true)},'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(CUSTOMER_DATA_VERSION)}),
 'predecessor',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version='20260913082314')) AS observation; COMMIT;`;
}

function canonical(value) {
  if (Array.isArray(value)) { const rows = value.map(canonical); return value.some(child => child && typeof child === 'object')
    ? rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : rows; }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort().map(([k, v]) => [k, canonical(v)]));
  return value;
}
function body(sql, name) {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  const match = /AS (\$[a-z_]*\$)([\s\S]*?)\1;/.exec(sql.slice(start));
  requireValue(start >= 0 && match, 'CUSTOMER_DATA_FUNCTION_SOURCE_INVALID');
  return match[2];
}
export function expectedCustomerDataCatalog(fixture, { sql, previousSql, previousClaimSql, applied }) {
  const expected = structuredClone(fixture);
  for (const fn of expected.functions) fn.body = body(sql, fn.name);
  if (!applied) {
    expected.relations = []; expected.jobColumns = []; expected.jobConstraint = []; expected.triggers = [];
    expected.functions = expected.functions.filter(fn => REPLACED.includes(fn.name));
    for (const fn of expected.functions) fn.body = body(fn.name === REPLACED[0] ? previousSql : previousClaimSql, fn.name);
  }
  return expected;
}
export function validateCustomerDataCatalog(catalog, context, applied) {
  same(canonical(catalog), canonical(expectedCustomerDataCatalog(context.fixture, { ...context, applied })), 'CUSTOMER_DATA_TARGET_CATALOG_DRIFT');
}
export function validateCustomerDataObservation(observed, context) {
  requireValue(observed?.format === 'account-deletion-customer-data-catalog-v1' && observed.readOnly === true
    && observed.systemIdentifier === CUSTOMER_DATA_SYSTEM && observed.database === 'postgres' && observed.currentUser === 'postgres'
    && /^17\./.test(observed.serverVersion ?? '') && [observed.preservedCatalogSha, observed.ledgerSha, observed.ledgerWithoutTargetSha].every(v => MD5.test(v ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0, 'CUSTOMER_DATA_OBSERVATION_INVALID');
  const at = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at) && at <= context.now.getTime() + 10_000 && at > context.now.getTime() - 120_000, 'CUSTOMER_DATA_OBSERVATION_EXPIRED');
  requireValue(observed.authTriggerAllowed === true, 'CUSTOMER_DATA_AUTH_TRIGGER_PRIVILEGE_REQUIRED');
  same(observed.predecessor, { version: '20260913082314', name: 'private_profile_avatars_delivery', statementCount: 1,
    sqlMd5: md5(context.predecessorSql) }, 'CUSTOMER_DATA_PREDECESSOR_NOT_APPLIED');
  requireValue(observed.customerRows && Object.keys(observed.customerRows).sort().join(',') === dataTables.join(',')
    && Object.values(observed.customerRows).every(row => Array.isArray(row) && row.length === 2 && Number.isSafeInteger(row[0]) && row[0] >= 0 && MD5.test(row[1])),
  'CUSTOMER_DATA_ROW_EVIDENCE_INVALID');
  requireValue(Number.isSafeInteger(observed.jobsCount) && observed.jobsCount >= 0 && Number.isSafeInteger(observed.privateScopesCount)
    && observed.privateScopesCount >= 0 && Number.isSafeInteger(observed.retiredRequestsCount) && observed.retiredRequestsCount >= 0, 'CUSTOMER_DATA_OBSERVATION_INVALID');
  if (observed.migration !== null) same(observed.migration, { version: CUSTOMER_DATA_VERSION, name: 'account_deletion_customer_data_boundary',
    statementCount: 1, sqlMd5: md5(context.sql) }, 'CUSTOMER_DATA_LEDGER_CONFLICT');
  else {
    requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'CUSTOMER_DATA_LEDGER_CONFLICT');
    requireValue(observed.jobsCount === 0 && observed.privateScopesCount === 0 && observed.retiredRequestsCount === 0, 'CUSTOMER_DATA_JOBS_MUST_BE_EMPTY');
  }
  validateCustomerDataCatalog(observed.catalog, context, observed.migration !== null);
  return observed;
}
function expectedJsonSql(value) {
  if (Array.isArray(value) && value.some(v => v && typeof v === 'object')) return `(SELECT jsonb_agg(v ORDER BY v::text) FROM (VALUES ${value.map(v => `(${expectedJsonSql(v)})`).join(',')}) q(v))`;
  if (value && typeof value === 'object' && !Array.isArray(value)) return `jsonb_build_object(${Object.entries(value).flatMap(([k, v]) => [literal(k), expectedJsonSql(v)]).join(',')})`;
  return `${literal(JSON.stringify(value))}::jsonb`;
}
function unwrap(sql) {
  const source = sql.replace(/^[\s\S]*?\bBEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  requireValue(source !== sql && !/\bCOMMIT\s*;/i.test(source), 'CUSTOMER_DATA_SQL_ENVELOPE_INVALID');
  return source;
}
export function buildCustomerDataMutationSql({ sql, fixture, previousSql, previousClaimSql, before, deadline, rehearsal }) {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline) && before.migration === null
    && before.jobsCount === 0 && before.privateScopesCount === 0 && before.retiredRequestsCount === 0 && [before.ledgerSha, before.preservedCatalogSha].every(v => MD5.test(v ?? '')),
  'CUSTOMER_DATA_BUNDLE_INVALID');
  validateCustomerDataCatalog(before.catalog, { sql, fixture, previousSql, previousClaimSql }, false);
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(60913,5);
 LOCK TABLE supabase_migrations.schema_migrations, public.account_deletion_jobs, ${dataTables.join(', ')} IN SHARE ROW EXCLUSIVE MODE;
 DO $customer_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>${literal(CUSTOMER_DATA_SYSTEM)} OR current_database()<>'postgres'
 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR NOT has_table_privilege(current_user,'auth.users','TRIGGER') THEN RAISE EXCEPTION 'CUSTOMER_DATA_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'CUSTOMER_DATA_DEADLINE_EXPIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_deletion_jobs) OR ${privateScopeCount}<>0 OR ${retiredRequestCount}<>0 THEN RAISE EXCEPTION 'CUSTOMER_DATA_JOBS_MUST_BE_EMPTY'; END IF;
 IF ${customerDataTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${customerDataPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${customerDataRowsSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.customerRows))}::jsonb
 OR ${customerDataLedgerSql()} IS DISTINCT FROM ${literal(before.ledgerSha)} THEN RAISE EXCEPTION 'CUSTOMER_DATA_BASELINE_DRIFT'; END IF;
 END $customer_before$;
 ${unwrap(sql)}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(CUSTOMER_DATA_VERSION)},'account_deletion_customer_data_boundary',ARRAY[${literal(sql)}]::text[]);
 DO $customer_after$ BEGIN
 IF ${customerDataTargetCatalogSql()} IS DISTINCT FROM ${expectedJsonSql(expectedCustomerDataCatalog(fixture, { sql, previousSql, previousClaimSql, applied: true }))}
 OR ${customerDataPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${customerDataRowsSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.customerRows))}::jsonb
 OR ${customerDataLedgerSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR EXISTS(SELECT 1 FROM public.account_deletion_jobs) OR EXISTS(SELECT 1 FROM public.${NEW_TABLE}) OR EXISTS(SELECT 1 FROM public.account_deletion_retired_requests)
 THEN RAISE EXCEPTION 'CUSTOMER_DATA_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'CUSTOMER_DATA_DEADLINE_EXPIRED'; END IF;
 END $customer_after$;
 ${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}
