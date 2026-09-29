import { createHash } from 'node:crypto';
import { CurrentBaselineBlocked, same } from './current-baseline-release-contract.mjs';
import { assertCoupleResetExpectedIdentitySql } from './couple-reset-expected-identity-release-contract.mjs';

export const COUPLE_RESET_EXPECTED_IDENTITY_VERSION = '20260928144843';
export const COUPLE_RESET_EXPECTED_IDENTITY_PROJECT = 'slrtobkksjmxgzatjyqb';
export const COUPLE_RESET_EXPECTED_IDENTITY_SYSTEM = '7581440907192989109';
const PREDECESSOR_VERSION = '20260928073546';
const FUNCTION = 'reset_expected_couple_membership';
const LEGACY_FUNCTION = 'reset_current_couple_membership';
const MD5 = /^[a-f0-9]{32}$/;
const md5 = value => createHash('md5').update(value).digest('hex');
const requireValue = (condition, code) => { if (!condition) throw new CurrentBaselineBlocked(code); };
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]') FROM (${query}) q(v))`;
const acl = (expression, kind) => aggregate(`SELECT jsonb_build_array(
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
 FROM aclexplode(COALESCE(${expression},acldefault('${kind}',c.${kind === 'f' ? 'proowner' : 'relowner'}))) a`);
const columns = aggregate(`SELECT jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
 a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),a.attacl::text)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
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
 'viewDefinition',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) ELSE NULL END,'options',c.reloptions,
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl','r')},'columns',${columns},
 'constraints',${constraints},'indexes',${indexes},'policies',${policies},'triggers',${triggers})`;
const functionShape = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'definition',pg_get_functiondef(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,'kind',c.prokind,
 'config',c.proconfig,'body',c.prosrc,'description',obj_description(c.oid,'pg_proc'),'acl',${acl('c.proacl','f')})`;
const functions = name => aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname=${literal(name)}`);

export function coupleResetExpectedIdentityTargetCatalogSql() {
  return `jsonb_build_object('functions',${functions(FUNCTION)},'legacyFunctions',${functions(LEGACY_FUNCTION)})`;
}
export function coupleResetExpectedIdentityPreservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object('relations',${aggregate(`SELECT ${relation} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','cron') AND c.relkind IN ('r','p','v','m','f')`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),pg_get_userbyid(c.proowner),md5(pg_get_functiondef(c.oid)),c.proacl)
 FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname IN ('public','auth','storage','cron') AND c.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND c.proname=${literal(FUNCTION)})`)},
 'sequences',${aggregate(`SELECT jsonb_build_array(n.nspname,c.relname,pg_get_userbyid(c.relowner),c.relacl,s.seqtypid,s.seqstart,
 s.seqincrement,s.seqmin,s.seqmax,s.seqcache,s.seqcycle) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_sequence s ON s.seqrelid=c.oid WHERE n.nspname IN ('public','auth','storage','cron')`)},
 'defaultAcl',${aggregate('SELECT jsonb_build_array(defaclrole,defaclnamespace,defaclobjtype,defaclacl) FROM pg_default_acl')},
 'eventTriggers',${aggregate('SELECT jsonb_build_array(evtname,evtevent,evtowner,evtfoid,evtenabled,evttags) FROM pg_event_trigger')}
 )::text))`;
}
export function coupleResetExpectedIdentityRowDigestsSql() {
  const table = name => `(SELECT jsonb_build_object('count',count(*),'md5',
    md5(COALESCE(string_agg(md5(to_jsonb(r)::text),'' ORDER BY r.id),''))) FROM public.${name} r)`;
  return `jsonb_build_object('profiles',${table('profiles')},'couples',${table('couples')})`;
}
export function coupleResetExpectedIdentityLedgerDigestSql(exclude = false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${exclude ? ` WHERE version<>${literal(COUPLE_RESET_EXPECTED_IDENTITY_VERSION)}` : ''})`;
}
const ledgerRow = version => `(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(version)})`;
const ledgerVersions = `(SELECT COALESCE(jsonb_agg(version ORDER BY version),'[]') FROM supabase_migrations.schema_migrations)`;
const dependenciesReady = `(to_regprocedure('auth.uid()') IS NOT NULL AND to_regprocedure('auth.role()') IS NOT NULL
 AND to_regprocedure('public.reset_current_couple_membership()') IS NOT NULL
 AND to_regclass('public.profiles') IS NOT NULL AND to_regclass('public.couples') IS NOT NULL)`;

export function buildCoupleResetExpectedIdentityObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','couple-reset-expected-identity-catalog-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'serverVersion',current_setting('server_version'),'database',current_database(),'currentUser',current_user,
 'readOnly',current_setting('transaction_read_only')='on','inRecovery',pg_is_in_recovery(),
 'observedAt',clock_timestamp(),'dependenciesReady',${dependenciesReady},
 'catalog',${coupleResetExpectedIdentityTargetCatalogSql()},'preservedCatalogSha',${coupleResetExpectedIdentityPreservedCatalogSql()},
 'rowDigests',${coupleResetExpectedIdentityRowDigestsSql()},
 'ledgerSha',${coupleResetExpectedIdentityLedgerDigestSql()},'ledgerWithoutTargetSha',${coupleResetExpectedIdentityLedgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),'ledgerVersions',${ledgerVersions},
 'migration',${ledgerRow(COUPLE_RESET_EXPECTED_IDENTITY_VERSION)},'predecessor',${ledgerRow(PREDECESSOR_VERSION)}) AS observation; COMMIT;`;
}
function sortedTree(value) {
  if (Array.isArray(value)) {
    const children = value.map(sortedTree);
    return value.length > 0 && value.every(child => child && typeof child === 'object')
      ? children.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : children;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort().map(([key,child]) => [key,sortedTree(child)]));
  return value;
}
export function expectedCoupleResetExpectedIdentityCatalog(fixture, applied) {
  requireValue(fixture?.format === 'couple-reset-expected-identity-pg17-catalog-v1'
    && fixture.functions?.length === 1 && fixture.legacyFunctions?.length === 1, 'COUPLE_RESET_CATALOG_FIXTURE_INVALID');
  return { functions: applied ? structuredClone(fixture.functions) : [], legacyFunctions: structuredClone(fixture.legacyFunctions) };
}
export function validateCoupleResetExpectedIdentityCatalog(catalog, fixture, applied) {
  same(sortedTree(catalog), sortedTree(expectedCoupleResetExpectedIdentityCatalog(fixture,applied)), 'COUPLE_RESET_TARGET_CATALOG_DRIFT');
}
function validateVersions(expectedVersions) {
  requireValue(Array.isArray(expectedVersions) && expectedVersions.length === 229
    && expectedVersions.every((version,index) => /^\d{14}$/.test(version) && (index === 0 || version > expectedVersions[index-1]))
    && expectedVersions.at(-1) === PREDECESSOR_VERSION, 'COUPLE_RESET_EXPECTED_LEDGER_INVALID');
}
export function validateCoupleResetExpectedIdentityObservation(observed,{sql,fixture,predecessorSql,expectedVersions,now}) {
  validateVersions(expectedVersions);
  requireValue(observed?.format === 'couple-reset-expected-identity-catalog-v1' && observed.readOnly === true
    && observed.inRecovery === false && observed.dependenciesReady === true
    && observed.systemIdentifier === COUPLE_RESET_EXPECTED_IDENTITY_SYSTEM && observed.database === 'postgres'
    && observed.currentUser === 'postgres' && /^17\./.test(observed.serverVersion ?? '')
    && [observed.preservedCatalogSha,observed.ledgerSha,observed.ledgerWithoutTargetSha].every(value => MD5.test(value ?? '')),
  'COUPLE_RESET_OBSERVATION_INVALID');
  const at = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(at) && at <= now.getTime()+10_000 && at > now.getTime()-120_000, 'COUPLE_RESET_OBSERVATION_EXPIRED');
  for (const name of ['profiles','couples']) requireValue(Number.isSafeInteger(observed.rowDigests?.[name]?.count)
    && observed.rowDigests[name].count >= 0 && MD5.test(observed.rowDigests[name].md5 ?? ''), 'COUPLE_RESET_ROW_OBSERVATION_INVALID');
  same(observed.predecessor,{version:PREDECESSOR_VERSION,name:'account_deletion_anonymous_audit',statementCount:1,sqlMd5:md5(predecessorSql)},
    'COUPLE_RESET_PREDECESSOR_NOT_APPLIED');
  const applied = observed.migration !== null;
  if (applied) same(observed.migration,{version:COUPLE_RESET_EXPECTED_IDENTITY_VERSION,name:'couple_reset_expected_identity',
    statementCount:1,sqlMd5:md5(sql)},'COUPLE_RESET_LEDGER_CONFLICT');
  else requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha,'COUPLE_RESET_LEDGER_CONFLICT');
  same(observed.ledgerVersions,applied ? [...expectedVersions,COUPLE_RESET_EXPECTED_IDENTITY_VERSION] : expectedVersions,
    'COUPLE_RESET_LEDGER_SET_DRIFT');
  requireValue(observed.ledgerCount === expectedVersions.length + (applied ? 1 : 0),'COUPLE_RESET_LEDGER_SET_DRIFT');
  validateCoupleResetExpectedIdentityCatalog(observed.catalog,fixture,applied);
  return observed;
}
export function buildCoupleResetExpectedIdentityMutationSql({sql,fixture,before,deadline,rehearsal,expectedVersions}) {
  validateVersions(expectedVersions);
  assertCoupleResetExpectedIdentitySql(sql);
  requireValue(!/\b(?:COMMIT|ROLLBACK)\s*;/i.test(sql),'COUPLE_RESET_SQL_ENVELOPE_INVALID');
  requireValue(typeof rehearsal === 'boolean' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline)
    && before?.migration === null && [before.ledgerSha,before.preservedCatalogSha].every(value => MD5.test(value ?? '')),
  'COUPLE_RESET_BUNDLE_INVALID');
  validateCoupleResetExpectedIdentityCatalog(before.catalog,fixture,false);
  same(before.ledgerVersions,expectedVersions,'COUPLE_RESET_LEDGER_SET_DRIFT');
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(60928,2);
 LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 -- 기존 reset의 profiles FOR UPDATE가 끝나기 전에 couples 잠금을 기다리면 잠금 승격 교착이 생긴다.
 LOCK TABLE public.profiles IN EXCLUSIVE MODE;
 LOCK TABLE public.couples IN SHARE MODE;
 DO $couple_reset_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) <> '${COUPLE_RESET_EXPECTED_IDENTITY_SYSTEM}' OR current_database() <> 'postgres'
 OR current_user <> 'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR pg_is_in_recovery() OR NOT ${dependenciesReady} THEN RAISE EXCEPTION 'COUPLE_RESET_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'COUPLE_RESET_DEADLINE_EXPIRED'; END IF;
 IF ${coupleResetExpectedIdentityTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${coupleResetExpectedIdentityPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${coupleResetExpectedIdentityLedgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR ${ledgerVersions} IS DISTINCT FROM ${literal(JSON.stringify(expectedVersions))}::jsonb
 OR ${coupleResetExpectedIdentityRowDigestsSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.rowDigests))}::jsonb
 THEN RAISE EXCEPTION 'COUPLE_RESET_BASELINE_DRIFT'; END IF;
 END $couple_reset_before$;
 ${sql}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('${COUPLE_RESET_EXPECTED_IDENTITY_VERSION}','couple_reset_expected_identity',ARRAY[${literal(sql)}]::text[]);
 DO $couple_reset_after$ BEGIN
 IF ${coupleResetExpectedIdentityTargetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(expectedCoupleResetExpectedIdentityCatalog(fixture,true)))}::jsonb
 OR ${coupleResetExpectedIdentityPreservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${coupleResetExpectedIdentityLedgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR ${ledgerVersions} IS DISTINCT FROM ${literal(JSON.stringify([...expectedVersions,COUPLE_RESET_EXPECTED_IDENTITY_VERSION]))}::jsonb
 OR ${coupleResetExpectedIdentityRowDigestsSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.rowDigests))}::jsonb
 THEN RAISE EXCEPTION 'COUPLE_RESET_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'COUPLE_RESET_DEADLINE_EXPIRED'; END IF;
 END $couple_reset_after$;
 ${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}
