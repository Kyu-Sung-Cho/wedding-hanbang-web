import { CurrentBaselineBlocked, digest } from './current-baseline-release-contract.mjs';

const fail = code => { throw new CurrentBaselineBlocked(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const authority = Object.freeze({ productionApplyImplemented: false, runtimeEvidenceVerified: false,
  releaseAuthorized: false, remoteWritesPerformed: false });
const instant = value => value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
const SHA = /^[a-f0-9]{64}$/;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value, maximum = 16384) => typeof value === 'string' && value.length <= maximum && !value.includes('\0');
const functionKeys = ['signature', 'present', 'definitionSha256', 'catalogSha256', 'owner', 'securityDefiner', 'config',
  'arguments', 'result', 'language', 'volatility', 'strict', 'parallel', 'leakproof', 'acl', 'effectiveExecute'];
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const sqlHash = expression => `encode(sha256(convert_to((${expression})::text,'UTF8')),'hex')`;
const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text COLLATE "C"),'[]'::jsonb) FROM (${query}) rows(v))`;
const CONTRACT_SHA = 'f1c518a0144ea14c91cb76da135a1099ade1d2bf28ccb4321b69feff3e9c91ef';

function validatePlan(plan) {
  requireValue(plan?.contract && plan.contractSha256 === CONTRACT_SHA && plan.staticVerified === true
    && plan.migrationCount === 239 && Object.keys(authority).every(key => plan[key] === false)
    && digest(`${JSON.stringify(plan.contract, null, 2)}\n`) === CONTRACT_SHA, 'AMORA_INSPECTION_PLAN_INVALID');
}

// 함수 원문·고객 행을 반환하지 않는다. PostgreSQL catalog 안에서만 정의와 보존 범위의 digest를 계산한다.
export function buildAmoraDecisionPrivacyInspectionSql(plan) {
  validatePlan(plan);
  const signatures = [...plan.contract.scope.changedFunctions, ...plan.contract.scope.addedFunctions].sort();
  const selected = signatures.map(literal).join(',');
  const names = [...new Set(signatures.map(signature => signature.slice('public.'.length, signature.indexOf('('))))].map(literal).join(',');
  const functionAcl = aggregate(`SELECT jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
    FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a`);
  const relationAcl = aggregate(`SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
    FROM aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a`);
  const columnAcl = aggregate(`SELECT jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
    pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable) FROM aclexplode(a.attacl) x`);
  const columns = aggregate(`SELECT jsonb_build_array(a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
    a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),${columnAcl}) FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`);
  const constraints = aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) FROM pg_constraint WHERE conrelid=c.oid`);
  const indexes = aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid`);
  const triggers = aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true),tgfoid::regprocedure::text)
    FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal`);
  const policies = aggregate(`SELECT jsonb_build_array(polname,polcmd,polpermissive,
    (SELECT jsonb_agg(role_name ORDER BY role_name COLLATE "C") FROM
      (SELECT CASE WHEN role_id=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_id) END AS role_name FROM unnest(polroles) role_id) roles),
    pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) FROM pg_policy WHERE polrelid=c.oid`);
  return `BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog;
WITH function_catalog AS MATERIALIZED (
 SELECT n.nspname AS schema,p.proname,p.oid,
   n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')' AS signature,
   jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
     'config',p.proconfig,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
     'language',l.lanname,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,
     'acl',${functionAcl},'comment',obj_description(p.oid,'pg_proc'),'kind',p.prokind,'cost',p.procost,'rows',p.prorows,
     'support',p.prosupport::regproc::text,'dependencies',${aggregate(`SELECT jsonb_build_array(pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),d.deptype)
       FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid`)}) AS catalog
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN ('public','auth','storage') AND p.prokind IN ('f','p')
), function_observations AS MATERIALIZED (
 SELECT schema,proname,signature,
   (catalog - ARRAY['definition','comment','kind','cost','rows','support','dependencies']) || jsonb_build_object(
     'signature',signature,'present',true,'definitionSha256',${sqlHash("catalog->>'definition'")},
     'catalogSha256',${sqlHash('catalog')},'effectiveExecute',jsonb_build_object(
       'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),
       'service_role',has_function_privilege('service_role',oid,'EXECUTE'))) AS observation
 FROM function_catalog
), relation_catalog AS MATERIALIZED (
 SELECT jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',${relationAcl},'columns',${columns},'constraints',${constraints},
   'indexes',${indexes},'triggers',${triggers},'policies',${policies},'options',c.reloptions,'replicaIdentity',c.relreplident,
   'view',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) ELSE NULL END,
   'sequence',(SELECT jsonb_build_array(format_type(s.seqtypid,NULL),s.seqstart,s.seqincrement,s.seqmin,s.seqmax,s.seqcache,s.seqcycle)
     FROM pg_sequence s WHERE s.seqrelid=c.oid)) AS catalog
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','f','S')
), ledger AS MATERIALIZED (
 SELECT version,name,cardinality(statements) AS count,statements,to_jsonb(m) AS original
 FROM supabase_migrations.schema_migrations m
)
SELECT jsonb_build_object('format','amora-decision-privacy-inspection-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'database',current_database(),
 'serverVersion',current_setting('server_version'),'currentUser',current_user,'sessionUser',session_user,
 'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),
 'ledger',(SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',count,
   'statementsSha256',CASE WHEN statements IS NULL THEN NULL ELSE ${sqlHash('to_jsonb(statements)')} END,
   'singleStatementSha256',CASE WHEN count=1 THEN ${sqlHash('statements[1]')} ELSE NULL END) ORDER BY version COLLATE "C"),'[]'::jsonb) FROM ledger),
 'ledgerSha256',(SELECT ${sqlHash("COALESCE(jsonb_agg(original ORDER BY version COLLATE \"C\"),'[]'::jsonb)")} FROM ledger),
 'functions',(SELECT jsonb_agg(COALESCE(f.observation,jsonb_build_object('signature',s.signature,'present',false)) ORDER BY s.signature COLLATE "C")
   FROM unnest(ARRAY[${selected}]::text[]) s(signature) LEFT JOIN function_observations f ON f.signature=s.signature),
 'overloads',(SELECT COALESCE(jsonb_agg(observation ORDER BY signature COLLATE "C"),'[]'::jsonb)
   FROM function_observations WHERE schema='public' AND proname IN (${names}) AND signature NOT IN (${selected})),
 'preservedCatalogSha256',${sqlHash(`jsonb_build_object(
   'relations',${aggregate('SELECT catalog FROM relation_catalog')},
   'functions',${aggregate(`SELECT jsonb_build_array(signature,catalog) FROM function_catalog WHERE signature NOT IN (${selected})`)},
   'schemas',${aggregate(`SELECT jsonb_build_array(nspname,pg_get_userbyid(nspowner),nspacl::text) FROM pg_namespace WHERE nspname IN ('public','auth','storage')`)},
   'roles',${aggregate(`SELECT jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig) FROM pg_roles`)},
   'memberships',${aggregate(`SELECT jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor),admin_option,inherit_option,set_option) FROM pg_auth_members`)})`)}) AS observation;
ROLLBACK;`;
}

function validateFunction(row) {
  requireValue(row?.present === false ? exactKeys(row, ['signature', 'present'])
    : row?.present === true && exactKeys(row, functionKeys) && SHA.test(row.definitionSha256 ?? '') && SHA.test(row.catalogSha256 ?? '')
      && text(row.owner, 128) && row.owner.length > 0 && text(row.arguments) && text(row.result) && text(row.language, 128)
      && (row.config === null || Array.isArray(row.config) && row.config.length <= 100 && row.config.every(value => text(value)))
      && ['securityDefiner', 'strict', 'leakproof'].every(key => typeof row[key] === 'boolean')
      && ['i', 's', 'v'].includes(row.volatility) && ['s', 'r', 'u'].includes(row.parallel)
      && exactKeys(row.effectiveExecute, ['anon', 'authenticated', 'service_role'])
      && Object.values(row.effectiveExecute).every(value => typeof value === 'boolean')
      && Array.isArray(row.acl) && row.acl.length <= 1000 && row.acl.every(entry =>
        exactKeys(entry, ['grantee', 'grantor', 'privilege', 'grantable']) && text(entry.grantee, 128) && text(entry.grantor, 128)
        && entry.privilege === 'EXECUTE' && typeof entry.grantable === 'boolean'), 'AMORA_INSPECTION_FUNCTION_INVALID');
}

function validateCatalog(observation, plan) {
  const signatures = [...plan.contract.scope.changedFunctions, ...plan.contract.scope.addedFunctions].sort();
  requireValue(Array.isArray(observation.functions) && observation.functions.length === signatures.length
    && observation.functions.every((row, index) => row?.signature === signatures[index])
    && SHA.test(observation.preservedCatalogSha256 ?? ''), 'AMORA_INSPECTION_CATALOG_INVALID');
  for (const row of observation.functions) validateFunction(row);
  const names = new Set(signatures.map(signature => signature.slice(0, signature.indexOf('('))));
  requireValue(Array.isArray(observation.overloads) && observation.overloads.length <= 1000
    && observation.overloads.every((row, index) => text(row?.signature) && row.signature.endsWith(')') && row.present === true
      && !signatures.includes(row.signature) && names.has(row.signature.slice(0, row.signature.indexOf('(')))
      && (index === 0 || observation.overloads[index - 1].signature < row.signature)), 'AMORA_INSPECTION_OVERLOAD_INVALID');
  for (const row of observation.overloads) validateFunction(row);
}

function validateLedger(observation) {
  requireValue(Array.isArray(observation?.ledger) && observation.ledger.length > 0 && observation.ledger.length <= 10000
    && SHA.test(observation.ledgerSha256 ?? ''), 'AMORA_INSPECTION_LEDGER_INVALID');
  for (const [index, row] of observation.ledger.entries()) {
    requireValue(exactKeys(row, ['version', 'name', 'statementCount', 'statementsSha256', 'singleStatementSha256'])
      && typeof row.version === 'string' && /^\d{14}$/.test(row.version) && (index === 0 || observation.ledger[index - 1].version < row.version)
      && (row.name === null || text(row.name, 512))
      && (row.statementCount === null ? row.statementsSha256 === null && row.singleStatementSha256 === null
        : Number.isSafeInteger(row.statementCount) && row.statementCount >= 0 && SHA.test(row.statementsSha256 ?? '')
          && (row.statementCount === 1 ? row.singleStatementSha256 === null || SHA.test(row.singleStatementSha256 ?? '')
            : row.singleStatementSha256 === null)), 'AMORA_INSPECTION_LEDGER_INVALID');
  }
}

export function classifyAmoraDecisionPrivacyLedger(observation, plan) {
  validatePlan(plan);
  validateLedger(observation);
  requireValue(Array.isArray(plan?.contract?.migrations) && plan.contract.migrations.length === 2,
    'AMORA_INSPECTION_PLAN_INVALID');
  let present = 0;
  for (const pin of plan.contract.migrations) {
    const row = observation.ledger.find(entry => entry.version === pin.file.slice(0, 14));
    if (!row) continue;
    if (row.name !== pin.file.slice(15, -4) || row.statementCount !== 1 || row.singleStatementSha256 !== pin.sha256) return 'conflict';
    present += 1;
  }
  return present === 0 ? 'candidate-absent' : present === 1 ? 'partial' : 'candidate-present-unreviewed';
}

export function validateAmoraDecisionPrivacyInspection(observation, { plan, startedAt, finishedAt } = {}) {
  validatePlan(plan);
  requireValue(exactKeys(observation, ['format', 'systemIdentifier', 'database', 'serverVersion', 'currentUser', 'sessionUser',
    'readOnly', 'observedAt', 'ledger', 'ledgerSha256', 'functions', 'overloads', 'preservedCatalogSha256']), 'AMORA_INSPECTION_SHAPE_INVALID');
  requireValue(observation?.format === 'amora-decision-privacy-inspection-v1'
    && observation.currentUser === 'supabase_read_only_user' && observation.sessionUser === 'supabase_read_only_user'
    && observation.readOnly === true && observation.database === 'postgres' && /^17\.\d+(?:\.\d+)?$/.test(observation.serverVersion ?? '')
    && plan?.contract?.systemIdentifier === '7581440907192989109'
    && observation.systemIdentifier === plan.contract.systemIdentifier, 'AMORA_INSPECTION_IDENTITY_INVALID');
  const start = instant(startedAt), end = instant(finishedAt), observed = instant(observation.observedAt);
  requireValue(Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(observed) && end >= start && end - start <= 120000
    && observed >= start - 10000 && observed <= end + 10000, 'AMORA_INSPECTION_TIME_INVALID');
  validateCatalog(observation, plan);
  return { ...observation, status: 'observed-unreviewed', ledgerCount: observation.ledger.length,
    ledgerState: classifyAmoraDecisionPrivacyLedger(observation, plan), ...authority };
}
