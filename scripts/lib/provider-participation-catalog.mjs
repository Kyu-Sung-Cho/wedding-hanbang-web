import { same, requireRelease } from './current-baseline-release-contract.mjs';

export const PROVIDER_TABLES = Object.freeze(['business_inquiries', 'provider_applications', 'provider_audit_events', 'provider_media', 'provider_offerings', 'provider_profiles']);
export const PROVIDER_VERSIONS = Object.freeze(['20260928135517', '20260928140701', '20260928142123']);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const aggregate = query => `(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (${query}) rows(value))`;
const tableNames = PROVIDER_TABLES.map(literal).join(',');
const versions = PROVIDER_VERSIONS.map(literal).join(',');
const targetFunction = `(n.nspname='provider_private' OR (n.nspname='public' AND p.proname LIKE 'provider\\_%' ESCAPE '\\'))`;
const manifestConstraints = "'account_deletion_media_bucket','account_deletion_media_source','account_deletion_media_path_shape'";
const acl = (expression, kind, owner) => aggregate(`SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(${expression},acldefault('${kind}',${owner}))) a`);
const policies = aggregate(`SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
 'roles',(SELECT array_agg(pg_get_userbyid(role) ORDER BY pg_get_userbyid(role)) FROM unnest(polroles) role),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))
 FROM pg_policy WHERE polrelid=c.oid AND NOT (c.relnamespace='storage'::regnamespace AND c.relname='objects' AND polname='provider_portfolio_service_only')`);
const relation = `jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${acl('c.relacl', 'r', 'c.relowner')},
 'columns',${aggregate(`SELECT jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
 pg_get_expr(d.adbin,d.adrelid),${acl('a.attacl', 'c', 'c.relowner')}) FROM pg_attribute a
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`)},
 'constraints',${aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) FROM pg_constraint
 WHERE conrelid=c.oid AND NOT(c.relnamespace='public'::regnamespace AND c.relname='account_deletion_media_manifest' AND conname IN (${manifestConstraints}))`)},
 'indexes',${aggregate('SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid')},
 'policies',${policies},'triggers',${aggregate('SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true)) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal')})`;
const fn = `jsonb_build_object('schema',n.nspname,'name',p.proname,'args',oidvectortypes(p.proargtypes),'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
 'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,
 'parallel',p.proparallel,'leakproof',p.proleakproof,'config',p.proconfig,'body',p.prosrc,'acl',${acl('p.proacl', 'f', 'p.proowner')})`;
const functionFrom = 'FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang';
const manifestFunction = "n.nspname='public' AND p.proname='replace_account_deletion_media_manifest'";
const relationsFrom = "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f')";

export function providerTargetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${relation} ${relationsFrom} AND n.nspname='public' AND c.relname IN (${tableNames})`)},
 'functions',${aggregate(`SELECT ${fn} ${functionFrom} WHERE ${targetFunction}`)},
 'manifestFunction',${aggregate(`SELECT ${fn} ${functionFrom} WHERE ${manifestFunction}`)},
 'manifestConstraints',${aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) FROM pg_constraint
 WHERE conrelid='public.account_deletion_media_manifest'::regclass AND conname IN (${manifestConstraints})`)},
 'schema',${aggregate(`SELECT jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',${acl('n.nspacl', 'n', 'n.nspowner')}) FROM pg_namespace n WHERE n.nspname='provider_private'`)},
 'policy',${aggregate(`SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
 'roles',(SELECT array_agg(pg_get_userbyid(role) ORDER BY pg_get_userbyid(role)) FROM unnest(polroles) role),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) FROM pg_policy
 WHERE polrelid='storage.objects'::regclass AND polname='provider_portfolio_service_only'`)},
 'bucket',(SELECT jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)
 FROM storage.buckets WHERE id='provider-portfolio'))`;
}

export function providerPreservationSql() {
  return `jsonb_build_object('catalog',md5(jsonb_build_object('relations',${aggregate(`SELECT ${relation} ${relationsFrom}
 AND n.nspname IN ('public','auth','storage') AND NOT(n.nspname='public' AND c.relname IN (${tableNames}))`)},
 'functions',${aggregate(`SELECT ${fn} ${functionFrom} WHERE n.nspname IN ('public','auth','storage') AND p.prokind IN ('f','p')
 AND NOT ${targetFunction} AND NOT (${manifestFunction})`)} )::text),
 'buckets',md5(${aggregate("SELECT to_jsonb(b) FROM storage.buckets b WHERE id<>'provider-portfolio'")}::text),
 'objects',md5(${aggregate('SELECT to_jsonb(o) FROM storage.objects o')}::text),
 'defaults',md5(${aggregate('SELECT to_jsonb(a) FROM pg_default_acl a')}::text),
 'roleSettings',md5(${aggregate('SELECT to_jsonb(s) FROM pg_db_role_setting s')}::text),
 'ledger',md5(${aggregate(`SELECT to_jsonb(m) FROM supabase_migrations.schema_migrations m WHERE version NOT IN (${versions})`)}::text))`;
}

export function buildProviderObservationSql() {
  return `BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','provider-participation-observation-v1','readOnly',current_setting('transaction_read_only')='on',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'observedAt',clock_timestamp(),
 'permission',(SELECT jsonb_build_object('currentUser',current_user,'owner',pg_get_userbyid(relowner),
 'ownerUsage',pg_has_role(current_user,relowner,'USAGE'),'rls',relrowsecurity,'policyGrants',current_setting('supautils.policy_grants',true))
 FROM pg_class WHERE oid='storage.objects'::regclass),
 'target',${providerTargetCatalogSql()},'preservation',${providerPreservationSql()},
 'targetLedger',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1])) ORDER BY version),'[]'::jsonb)
 FROM supabase_migrations.schema_migrations WHERE version IN (${versions})),
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations)) AS observation;
 COMMIT;\n`;
}

export function validateProviderObservation(observation, { expectedTarget, expectedLedger, expectedSystem, expectedCount, expectedReadOnly = true, now = new Date() }) {
  requireRelease(observation?.format === 'provider-participation-observation-v1' && observation.readOnly === expectedReadOnly
    && observation.systemIdentifier === expectedSystem && /^17\./.test(observation.serverVersion ?? '')
    && observation.database === 'postgres', 'PROVIDER_RELEASE_OBSERVATION_IDENTITY_INVALID');
  const observedAt = Date.parse(observation.observedAt);
  requireRelease(Number.isFinite(observedAt) && observedAt <= now.getTime() + 10_000 && observedAt >= now.getTime() - 120_000,
    'PROVIDER_RELEASE_OBSERVATION_EXPIRED');
  requireRelease(observation.ledgerCount === expectedCount, 'PROVIDER_RELEASE_LEDGER_COUNT_DRIFT');
  same(observation.target, expectedTarget, 'PROVIDER_RELEASE_TARGET_DRIFT');
  same(observation.targetLedger, expectedLedger, 'PROVIDER_RELEASE_LEDGER_DRIFT');
  const permissions = observation.permission;
  let grants; try { grants = JSON.parse(permissions?.policyGrants ?? 'null'); } catch { grants = null; }
  requireRelease(permissions?.currentUser === 'postgres' && permissions.rls === true
    && (permissions.ownerUsage === true || (Array.isArray(grants?.postgres) && grants.postgres.includes('storage.objects'))),
  'PROVIDER_RELEASE_STORAGE_AUTHORITY_MISSING');
  requireRelease(observation.preservation && Object.keys(observation.preservation).sort().join(',') === 'buckets,catalog,defaults,ledger,objects,roleSettings'
    && Object.values(observation.preservation).every(value => /^[a-f0-9]{32}$/.test(value)), 'PROVIDER_RELEASE_PRESERVATION_INVALID');
  return observation;
}
