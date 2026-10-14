import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {AMORA_WRITER_MAINTENANCE_BINDING}
  from './amora-action-writer-retirement-maintenance.mjs';
import {AMORA_MANAGED_LOGICAL_REPLICATION_PATTERN} from './amora-action-writer-retirement-managed-workers.mjs';
import {getAmoraWriterRetirementTargetMetadata} from './amora-action-writer-retirement-privileges.mjs';
import {buildAmoraWriterRetirementBundle} from './amora-action-writer-retirement-bundle.mjs';

const SYSTEM='7581440907192989109';
const FUNCTION='deny_amora_action_writer_retirement_maintenance_v1';
const TRIGGERS=['deny_amora_actions_writer_retirement_maintenance_v1','deny_wedding_journeys_writer_retirement_maintenance_v1'];
const BODY="\nBEGIN\n  RAISE EXCEPTION 'AMORA_ACTION_WRITER_RETIREMENT_MAINTENANCE' USING ERRCODE = '55000';\nEND;\n";
const DECLARE='DECLARE amora_inventory jsonb;';
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const fail=code=>{throw new Error(code);};
const requireValue=(ok,code)=>{if(!ok)fail(code);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const positive=value=>Number.isSafeInteger(value)&&value>0;
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
function exactKeys(value,names,code){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).sort().join(',')===names.slice().sort().join(','),code);
}
function options(input,allowed){
  requireValue(input&&typeof input==='object'&&!Array.isArray(input)
    &&Object.keys(input).every(key=>allowed.includes(key)),'AMORA_MAINTENANCE_OPTIONS_INVALID');
  const native=input.expectedNativeSystemIdentifier??null;
  requireValue(native===null||(typeof native==='string'&&/^\d{1,20}$/.test(native)&&native!==SYSTEM),
    'AMORA_MAINTENANCE_IDENTITY_INVALID');
}
function objectIds(ids){
  exactKeys(ids,['functionId','triggerIds'],'AMORA_MAINTENANCE_OBJECT_IDS_INVALID');
  requireValue(positive(ids.functionId)&&Array.isArray(ids.triggerIds)&&ids.triggerIds.length===2
    &&ids.triggerIds.every(positive)&&new Set([ids.functionId,...ids.triggerIds]).size===3,
    'AMORA_MAINTENANCE_OBJECT_IDS_INVALID');
}
function postInput(input){
  requireValue(typeof input.repoRoot==='string'&&typeof input.postLedgerMd5==='string'&&/^[a-f0-9]{32}$/.test(input.postLedgerMd5),
    'AMORA_MAINTENANCE_POST_B2_INPUT_INVALID');
}
function cohortInput(input){
  const {cohort}=input;
  exactKeys(cohort,['format','systemIdentifier','cutoff','observedAt','objectIds','members','executionProvenanceVerified',
    'independentlyVerifiedB2','drainVerified','releaseAuthorized'],'AMORA_MAINTENANCE_COHORT_INVALID');
  requireValue(cohort.format==='amora-writer-maintenance-cohort-content-v1'
    &&cohort.systemIdentifier===(input.expectedNativeSystemIdentifier??SYSTEM)
    &&time(cohort.cutoff)&&time(cohort.observedAt)&&Array.isArray(cohort.members)
    &&['executionProvenanceVerified','independentlyVerifiedB2','drainVerified','releaseAuthorized'].every(key=>cohort[key]===false),
    'AMORA_MAINTENANCE_COHORT_INVALID');
  objectIds(cohort.objectIds);
  const pids=new Set();
  for(const member of cohort.members){
    exactKeys(member,['pid','backendStart'],'AMORA_MAINTENANCE_COHORT_INVALID');
    requireValue(positive(member.pid)&&time(member.backendStart)&&!pids.has(member.pid),'AMORA_MAINTENANCE_COHORT_INVALID');
    pids.add(member.pid);
  }
}

function sourcePins(){
  for(const [file,sha] of [
    ['amora-action-writer-retirement-maintenance.mjs','f28e1a01aa42631291ec3a88dc470908f762b3212dad20dc337c8e196e1c7cde'],
    ['amora-action-writer-retirement-managed-workers.mjs','57f3b9510a9c45f6182cd8015943f5dce9bc5125b32fa7f8f1e1855358af76d8'],
  ])requireValue(digest(readFileSync(new URL(file,import.meta.url)))===sha,'AMORA_MANAGED_MAINTENANCE_SOURCE_CHANGED');
}
function identityGuard(input){
  const native=input.expectedNativeSystemIdentifier??null;
  return `
  IF current_user <> 'postgres' OR session_user <> 'postgres' OR current_database() <> 'postgres'
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '${native??SYSTEM}'
    ${native!==null?"OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'":''} THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_DESTINATION_INVALID';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND
    (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'))) THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_STATS_VISIBILITY_REQUIRED';
  END IF;`;
}

// 호출자 JSON을 신뢰하지 않는다. 이 한 DO의 실제 stats/capability/locks/slot 관찰에서만 kind를 판정한다.
// 알려진 managed3+정확 archiver만 새로 분리한다. 원래 core auxiliary와 모든 client/cron libpq는 보존한다.
function inventoryGuard(){return `
  PERFORM pg_stat_clear_snapshot();
  WITH capabilities AS MATERIALIZED (
    SELECT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
      AND to_regnamespace('net') IS NULL AND to_regclass('net.http_request_queue') IS NULL
      AND to_regclass('net._http_response') IS NULL
      AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='net' AND p.proname IN ('http_get','http_post','http_delete')) AS net_absent,
      (SELECT extversion FROM pg_extension WHERE extname='pg_cron')='1.6.4'
        AND current_setting('cron.use_background_workers',true)='off'
        AND to_regclass('cron.job') IS NOT NULL AS cron_libpq
  ), activity AS MATERIALIZED (
    SELECT a.*,
      CASE WHEN a.query IS NULL OR a.query='<insufficient privilege>'
        OR octet_length(a.query)>=pg_size_bytes(current_setting('track_activity_query_size'))-1 THEN NULL
        ELSE regexp_match(a.query,$replication_marker$${AMORA_MANAGED_LOGICAL_REPLICATION_PATTERN}$replication_marker$) END AS marker,
      (SELECT count(*)::int FROM pg_locks l WHERE l.pid=a.pid AND l.relation IN
        ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass,
          'public.profiles'::regclass,'public.couples'::regclass)) AS relation_locks,
      (SELECT count(*)::int FROM pg_locks l WHERE l.pid=a.pid AND l.locktype='advisory') AS advisory_locks,
      pg_blocking_pids(a.pid) AS blockers
    FROM pg_stat_activity a
  ), classified AS MATERIALIZED (
    SELECT a.*,CASE
      WHEN a.backend_start IS NULL OR a.backend_type IS NULL
        OR a.backend_start>clock_timestamp()+interval '10 seconds'
        OR a.xact_start>clock_timestamp()+interval '10 seconds'
        OR a.query_start>clock_timestamp()+interval '10 seconds' THEN NULL
      WHEN a.backend_type='archiver' THEN CASE WHEN a.datname IS NULL AND a.usename IS NULL
        AND a.application_name='' AND a.state IS NULL AND a.xact_start IS NULL AND a.query_start IS NULL
        AND a.query='' AND a.wait_event_type='Activity' AND a.wait_event='ArchiverMain'
        AND a.relation_locks=0 AND a.advisory_locks=0 AND cardinality(a.blockers)=0 THEN 'core-archiver' END
      WHEN a.datname IS NULL AND a.backend_type IN ('checkpointer','background writer','walwriter',
        'autovacuum launcher','logical replication launcher','walreceiver','slotsync worker') THEN 'core-auxiliary'
      WHEN a.datname IS NULL OR a.usename IS NULL THEN NULL
      WHEN a.datname<>current_database() THEN 'other-database'
      WHEN a.backend_type IN ('client backend','parallel worker','autovacuum worker') THEN CASE
        WHEN a.state IN ('active','idle','idle in transaction','idle in transaction (aborted)')
          AND a.query_start IS NOT NULL AND a.query IS NOT NULL AND a.query<>'<insufficient privilege>'
        THEN 'writer' END
      WHEN a.backend_type IN ('pg_net 0.19.5 worker','pg_cron launcher') THEN CASE
        WHEN a.usename='supabase_admin' AND a.state IS NULL AND a.xact_start IS NULL AND a.query_start IS NULL
          AND a.query='' AND a.wait_event_type='Extension' AND a.wait_event='Extension'
          AND a.relation_locks=0 AND a.advisory_locks=0 AND cardinality(a.blockers)=0
          AND ((a.backend_type='pg_net 0.19.5 worker' AND a.application_name='pg_net 0.19.5' AND c.net_absent)
            OR (a.backend_type='pg_cron launcher' AND a.application_name='pg_cron scheduler' AND c.cron_libpq))
        THEN 'known-managed-wait' END
      WHEN a.backend_type='walsender' THEN CASE
        WHEN a.usename='supabase_admin' AND a.application_name='realtime_replication_connection'
          AND a.state='active' AND a.xact_start IS NULL AND a.query_start IS NOT NULL AND a.marker IS NOT NULL
          AND a.wait_event_type='Client' AND a.wait_event='WalSenderWaitForWal'
          AND a.relation_locks=0 AND a.advisory_locks=0 AND cardinality(a.blockers)=0
          AND (SELECT count(*) FROM pg_replication_slots s WHERE s.active_pid=a.pid)=1
          AND EXISTS(SELECT 1 FROM pg_replication_slots s WHERE s.active_pid=a.pid AND s.active
            AND s.database=current_database() AND s.slot_type='logical' AND s.plugin='pgoutput'
            AND s.slot_name=coalesce(a.marker[2],a.marker[3]))
        THEN 'known-logical-wal-wait' END
      ELSE NULL END AS kind
    FROM activity a CROSS JOIN capabilities c
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,
    'xactStart',xact_start,'queryStart',query_start,'state',state,'kind',kind,
    'targetLocks',relation_locks+advisory_locks) ORDER BY pid),'[]'::jsonb) INTO amora_inventory FROM classified;
  IF jsonb_array_length(amora_inventory)=0 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(amora_inventory) r WHERE r->>'kind' IS NULL)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(amora_inventory) r
      WHERE (r->>'pid')::int=pg_backend_pid() AND r->>'kind'='writer') THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_INVENTORY_UNKNOWN';
  END IF;`;
}

function pinsGuard(ids){
  const pin=AMORA_WRITER_MAINTENANCE_BINDING;
  return `
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='${FUNCTION}')<>1 OR NOT EXISTS(
    SELECT 1 FROM pg_proc p WHERE p.oid=${ids.functionId}::oid
    AND p.oid=to_regprocedure('public.${FUNCTION}()') AND pg_get_userbyid(p.proowner)='postgres'
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${pin.functionBodySha256}'
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='${pin.functionDefinitionSha256}'
    AND p.proacl::text='{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_OBJECT_LIFETIME_CHANGED';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN
    ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass)
    AND tgname IN ('${TRIGGERS[0]}','${TRIGGERS[1]}'))<>2 ${TRIGGERS.map((name,index)=>`
    OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.oid=${ids.triggerIds[index]}::oid
      AND t.tgrelid='public.${['amora_actions','wedding_journeys'][index]}'::regclass
      AND t.tgname='${name}' AND t.tgfoid=${ids.functionId}::oid AND t.tgtype=30
      AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgqual IS NULL AND encode(t.tgargs,'hex')=''
      AND t.tgattr::text='' AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL)`).join('')} THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_OBJECT_LIFETIME_CHANGED';
  END IF;`;
}
function postGuard(repoRoot,ledgerMd5){
  const target=getAmoraWriterRetirementTargetMetadata({repoRoot,phase:'after'});
  const bundle=buildAmoraWriterRetirementBundle(repoRoot);
  requireValue(target.functions.length===9&&target.releaseAuthorized===false
    &&target.executionProvenanceVerified===false,'AMORA_MAINTENANCE_POST_B2_SOURCE_INVALID');
  const expected=target.functions.map(fn=>{const {expectedAcl,...metadata}=fn;return {...metadata,acl:expectedAcl};})
    .sort((a,b)=>a.identity.localeCompare(b.identity));
  return `
  IF (SELECT jsonb_agg(jsonb_build_object('identity',n.nspname||'.'||p.oid::regprocedure::text,
    'owner',pg_get_userbyid(p.proowner),'result',pg_get_function_result(p.oid),'language',l.lanname,
    'securityDefiner',p.prosecdef,'config',p.proconfig,'strict',p.proisstrict,'volatility',p.provolatile,
    'parallel',p.proparallel,'bodyMd5',md5(p.prosrc),'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
    'cost',p.procost,'rows',p.prorows,'support',p.prosupport::regproc::text,'kind',p.prokind,
    'leakProof',p.proleakproof,'returnsSet',p.proretset,'defaultCount',p.pronargdefaults,
    'arguments',pg_get_function_arguments(p.oid),'defaults',pg_get_expr(p.proargdefaults,0),
    'acl',(SELECT jsonb_agg(jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
      pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable)
      ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END)
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x))
    ORDER BY n.nspname||'.'||p.oid::regprocedure::text)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid IN (${expected.map(fn=>`to_regprocedure(${literal(fn.identity)})`).join(',')}))
      IS DISTINCT FROM ${literal(JSON.stringify(expected))}::jsonb THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_POST_B2_TARGET_DRIFT';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>231
    OR (SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
      ORDER BY version)::text,'[]')) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM '${ledgerMd5}'
    OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${bundle.version}'
      AND name='${bundle.name}' AND cardinality(statements)=1
      AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${bundle.sha256}') THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_POST_B2_LEDGER_DRIFT';
  END IF;`;
}

/** 독립 controlled addendum. 원래 f28 결과 SQL의 호출/교체/fallback 없이 같은 순수 입력 계약을 보존한다. */
export function buildAmoraWriterManagedMaintenanceInstallSql(input={}){
  sourcePins();options(input,['expectedNativeSystemIdentifier']);
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $maintenance_preflight$
${DECLARE}
BEGIN${identityGuard(input)}${inventoryGuard()}
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='${FUNCTION}')
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid IN
      ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass)
      AND tgname IN ('${TRIGGERS[0]}','${TRIGGERS[1]}')) THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_SLOT_NOT_ABSENT';
  END IF;
END;
$maintenance_preflight$;
CREATE FUNCTION public.${FUNCTION}()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$${BODY}$function$;
ALTER FUNCTION public.${FUNCTION}() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.${FUNCTION}() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ${TRIGGERS[0]} BEFORE INSERT OR UPDATE OR DELETE ON public.amora_actions
FOR EACH STATEMENT EXECUTE FUNCTION public.${FUNCTION}();
CREATE TRIGGER ${TRIGGERS[1]} BEFORE INSERT OR UPDATE OR DELETE ON public.wedding_journeys
FOR EACH STATEMENT EXECUTE FUNCTION public.${FUNCTION}();
SELECT jsonb_build_object('format','amora-writer-managed-maintenance-operation-content-v1','operation','install',
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'observedAt',clock_timestamp(),
  'own3Installed',to_regprocedure('public.${FUNCTION}()') IS NOT NULL AND
    (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass)
      AND tgname IN ('${TRIGGERS[0]}','${TRIGGERS[1]}'))=2,
  'executionProvenanceVerified',false,'releaseAuthorized',false) AS managed_maintenance_operation;
COMMIT;
`;
}

/** runtime의 genuine issued post7 이후 실행한다. 이 문자열/receipt 자체는 운영 capability가 아니다. */
export function buildAmoraWriterManagedMaintenanceCutoffSql(input){
  sourcePins();options(input,['repoRoot','postLedgerMd5','objectIds','expectedNativeSystemIdentifier']);
  requireValue(['repoRoot','postLedgerMd5','objectIds'].every(key=>Object.hasOwn(input,key)),
    'AMORA_MAINTENANCE_POST_B2_INPUT_INVALID');
  postInput(input);objectIds(input.objectIds);
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
DO $maintenance_post_b2$
${DECLARE}
BEGIN${identityGuard(input)}${inventoryGuard()}${pinsGuard(input.objectIds)}${postGuard(input.repoRoot,input.postLedgerMd5)}
END;
$maintenance_post_b2$;
SELECT jsonb_build_object('format','amora-writer-maintenance-cutoff-content-v1','cutoff',clock_timestamp(),
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'executionProvenanceVerified',false,'releaseAuthorized',false) AS maintenance_cutoff;
COMMIT;
`;
}

/** 같은 실제 관찰의 full writer cohort만 검사한 뒤 exact 본인3개만 제거한다. CANCEL/role/GUC 우회는 없다. */
export function buildAmoraWriterManagedMaintenanceUninstallSql(input){
  sourcePins();options(input,['repoRoot','postLedgerMd5','cohort','expectedNativeSystemIdentifier']);
  postInput(input);cohortInput(input);
  const {cohort}=input,cutoff=literal(cohort.cutoff),members=literal(JSON.stringify(cohort.members));
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $maintenance_remove$
${DECLARE}
BEGIN${identityGuard(input)}${inventoryGuard()}${pinsGuard(cohort.objectIds)}${postGuard(input.repoRoot,input.postLedgerMd5)}
  IF ${cutoff}::timestamptz<=clock_timestamp()-interval '120 seconds'
    OR ${cutoff}::timestamptz>clock_timestamp()+interval '10 seconds'
    OR ${literal(cohort.observedAt)}::timestamptz<=clock_timestamp()-interval '120 seconds'
    OR ${literal(cohort.observedAt)}::timestamptz>clock_timestamp()+interval '10 seconds' THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_CUTOFF_EXPIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(amora_inventory) AS a(pid int,"backendStart" timestamptz,
      "xactStart" timestamptz,"queryStart" timestamptz,state text,kind text,"targetLocks" int)
    WHERE a.pid<>pg_backend_pid() AND a.kind='writer'
      AND (a."xactStart"<=${cutoff}::timestamptz OR a."queryStart"<=${cutoff}::timestamptz)
      AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${members}::jsonb) AS m(pid int,"backendStart" timestamptz)
        WHERE m.pid=a.pid AND m."backendStart"=a."backendStart")) THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_LATE_COHORT';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(${members}::jsonb) AS m(pid int,"backendStart" timestamptz)
    JOIN jsonb_to_recordset(amora_inventory) AS a(pid int,"backendStart" timestamptz,
      "xactStart" timestamptz,"queryStart" timestamptz,state text,kind text,"targetLocks" int) ON a.pid=m.pid
    WHERE a.pid<>pg_backend_pid() AND a.kind='writer'
      AND ((a."backendStart"<>m."backendStart" AND a."backendStart"<=${cutoff}::timestamptz)
        OR (a."backendStart"=m."backendStart" AND
          (a.state IS DISTINCT FROM 'idle' OR a."xactStart" IS NOT NULL OR a."targetLocks"<>0)))) THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_DRAIN_REQUIRED';
  END IF;
END;
$maintenance_remove$;
DROP TRIGGER ${TRIGGERS[0]} ON public.amora_actions;
DROP TRIGGER ${TRIGGERS[1]} ON public.wedding_journeys;
DROP FUNCTION public.${FUNCTION}();
SELECT jsonb_build_object('format','amora-writer-managed-maintenance-operation-content-v1','operation','uninstall',
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'observedAt',clock_timestamp(),
  'own3Absent',to_regprocedure('public.${FUNCTION}()') IS NULL AND NOT EXISTS(
    SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass)
      AND tgname IN ('${TRIGGERS[0]}','${TRIGGERS[1]}')),
  'executionProvenanceVerified',false,'releaseAuthorized',false) AS managed_maintenance_operation;
COMMIT;
`;
}
