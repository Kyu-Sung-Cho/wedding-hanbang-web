import {createHash} from 'node:crypto';
import {getAmoraWriterRetirementTargetMetadata} from './amora-action-writer-retirement-privileges.mjs';
import {buildAmoraWriterRetirementBundle} from './amora-action-writer-retirement-bundle.mjs';

const SYSTEM='7581440907192989109';
const FUNCTION='deny_amora_action_writer_retirement_maintenance_v1';
const TRIGGERS=['deny_amora_actions_writer_retirement_maintenance_v1','deny_wedding_journeys_writer_retirement_maintenance_v1'];
export const AMORA_WRITER_MAINTENANCE_ERROR='AMORA_ACTION_WRITER_RETIREMENT_MAINTENANCE';
const BODY=`\nBEGIN\n  RAISE EXCEPTION '${AMORA_WRITER_MAINTENANCE_ERROR}' USING ERRCODE = '55000';\nEND;\n`;
const DEFINITION=`CREATE OR REPLACE FUNCTION public.${FUNCTION}()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO ''\nAS $function$${BODY}$function$\n`;
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const fail=code=>{throw new Error(code);};
const requireValue=(condition,code)=>{if(!condition)fail(code);};
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const same=(left,right,code)=>requireValue(stable(left)===stable(right),code);
const keys=(value,expected,code)=>{
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),code);
  same(Object.keys(value).sort(),expected.slice().sort(),code);
};
const integer=value=>Number.isSafeInteger(value)&&value>0;
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
function options(input,allowed=['expectedNativeSystemIdentifier']){
  requireValue(input&&typeof input==='object'&&!Array.isArray(input)
    &&Object.keys(input).every(key=>allowed.includes(key)),'AMORA_MAINTENANCE_OPTIONS_INVALID');
  const native=input.expectedNativeSystemIdentifier??null;
  requireValue(native===null||(typeof native==='string'&&/^\d{1,20}$/.test(native)&&native!==SYSTEM),
    'AMORA_MAINTENANCE_IDENTITY_INVALID');
  return {system:native??SYSTEM,native:native!==null};
}
function identityGuard(binding){return `
  IF current_user <> 'postgres' OR session_user <> 'postgres' OR current_database() <> 'postgres'
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '${binding.system}'
    ${binding.native?"OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'":''} THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_DESTINATION_INVALID';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND
    (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'))) THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_STATS_VISIBILITY_REQUIRED';
  END IF;`;}
function inventoryGuard(){return `
  PERFORM pg_stat_clear_snapshot();
  IF EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid<>pg_backend_pid()
    AND (a.backend_start IS NULL OR a.backend_type IS NULL
      OR (a.datname IS NULL AND a.backend_type NOT IN
       ('checkpointer','background writer','walwriter','autovacuum launcher','logical replication launcher','walsender','walreceiver','slotsync worker'))
      OR (a.datname=current_database() AND (a.usename IS NULL OR a.query_start IS NULL OR a.state IS NULL
        OR a.backend_type NOT IN ('client backend','parallel worker','autovacuum worker')
        OR a.state NOT IN ('active','idle','idle in transaction','idle in transaction (aborted)'))))) THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_INVENTORY_UNKNOWN';
  END IF;`;}

const literal=value=>`'${String(value).replaceAll("'","''")}'`;
function objectIds(value){
  keys(value,['functionId','triggerIds'],'AMORA_MAINTENANCE_OBJECT_IDS_INVALID');
  requireValue(integer(value.functionId)&&Array.isArray(value.triggerIds)&&value.triggerIds.length===2
    &&value.triggerIds.every(integer)&&new Set([value.functionId,...value.triggerIds]).size===3,
  'AMORA_MAINTENANCE_OBJECT_IDS_INVALID');return value;
}
function pinsGuard(value){
  objectIds(value);
  return `
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='${FUNCTION}')<>1 OR NOT EXISTS(
    SELECT 1 FROM pg_proc p WHERE p.oid=${value.functionId}::oid
    AND p.oid=to_regprocedure('public.${FUNCTION}()') AND pg_get_userbyid(p.proowner)='postgres'
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${digest(BODY)}'
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='${digest(DEFINITION)}'
    AND p.proacl::text='{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_OBJECT_LIFETIME_CHANGED';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN
    ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass)
    AND tgname IN ('${TRIGGERS[0]}','${TRIGGERS[1]}'))<>2 ${TRIGGERS.map((name,index)=>`
    OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.oid=${value.triggerIds[index]}::oid
      AND t.tgrelid='public.${['amora_actions','wedding_journeys'][index]}'::regclass
      AND t.tgname='${name}' AND t.tgfoid=${value.functionId}::oid AND t.tgtype=30
      AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgqual IS NULL AND encode(t.tgargs,'hex')=''
      AND t.tgattr::text='' AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL)`).join('')} THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_OBJECT_LIFETIME_CHANGED';
  END IF;`;
}
function postGuard(repoRoot,ledgerMd5){
  requireValue(typeof repoRoot==='string'&&typeof ledgerMd5==='string'&&/^[a-f0-9]{32}$/.test(ledgerMd5),
    'AMORA_MAINTENANCE_POST_B2_INPUT_INVALID');
  const target=getAmoraWriterRetirementTargetMetadata({repoRoot,phase:'after'});
  const bundle=buildAmoraWriterRetirementBundle(repoRoot);
  requireValue(target.functions.length===9&&target.releaseAuthorized===false
    &&target.executionProvenanceVerified===false,'AMORA_MAINTENANCE_POST_B2_SOURCE_INVALID');
  const expected=target.functions.map(fn=>{
    const {expectedAcl,...metadata}=fn;return {...metadata,acl:expectedAcl};
  }).sort((a,b)=>a.identity.localeCompare(b.identity));
  // after7+guard2와 전체 raw 원장 digest는 actual post 관찰에 대한 서버 재확인이다.
  // renderer 입력/JSON 자체는 operational postproof나 실행 인가를 발급하지 않는다.
  const observed=`(SELECT jsonb_agg(jsonb_build_object(
    'identity',n.nspname||'.'||p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
    'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,'config',p.proconfig,
    'strict',p.proisstrict,'volatility',p.provolatile,'parallel',p.proparallel,
    'bodyMd5',md5(p.prosrc),'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
    'cost',p.procost,'rows',p.prorows,'support',p.prosupport::regproc::text,'kind',p.prokind,
    'leakProof',p.proleakproof,'returnsSet',p.proretset,'defaultCount',p.pronargdefaults,
    'arguments',pg_get_function_arguments(p.oid),'defaults',pg_get_expr(p.proargdefaults,0),
    'acl',(SELECT jsonb_agg(jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
      pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable)
      ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END)
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x))
    ORDER BY n.nspname||'.'||p.oid::regprocedure::text)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid IN (${expected.map(fn=>`to_regprocedure(${literal(fn.identity)})`).join(',')}))`;
  return `
  IF ${observed} IS DISTINCT FROM ${literal(JSON.stringify(expected))}::jsonb THEN
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

/** 독립 issued B2 post 검증 후 runtime이 실행할 고정 READ ONLY renderer다. callback/boolean 증명은 받지 않는다. */
export function buildAmoraWriterMaintenanceCutoffSql(input){
  const binding=options(input,['repoRoot','postLedgerMd5','objectIds','expectedNativeSystemIdentifier']);
  requireValue(Object.hasOwn(input,'repoRoot')&&Object.hasOwn(input,'postLedgerMd5')&&Object.hasOwn(input,'objectIds'),
    'AMORA_MAINTENANCE_POST_B2_INPUT_INVALID');
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
DO $maintenance_post_b2$
BEGIN${identityGuard(binding)}${inventoryGuard()}${pinsGuard(input.objectIds)}${postGuard(input.repoRoot,input.postLedgerMd5)}
END;
$maintenance_post_b2$;
SELECT jsonb_build_object('format','amora-writer-maintenance-cutoff-content-v1','cutoff',clock_timestamp(),
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'executionProvenanceVerified',false,'releaseAuthorized',false) AS maintenance_cutoff;
COMMIT;
`;
}

/** 실측 cohort를 서버에서 재확인한 뒤 본인 exact3만 제거한다. 전체 운영 인가는 외부 genuine runtime proof 경계다. */
export function buildAmoraWriterMaintenanceUninstallSql(input){
  const binding=options(input,['repoRoot','postLedgerMd5','cohort','expectedNativeSystemIdentifier']);
  const cohort=input.cohort;
  keys(cohort,['format','systemIdentifier','cutoff','observedAt','objectIds','members','executionProvenanceVerified',
    'independentlyVerifiedB2','drainVerified','releaseAuthorized'],'AMORA_MAINTENANCE_COHORT_INVALID');
  requireValue(cohort.format==='amora-writer-maintenance-cohort-content-v1'&&cohort.systemIdentifier===binding.system
    &&time(cohort.cutoff)&&time(cohort.observedAt)&&Array.isArray(cohort.members)
    &&['executionProvenanceVerified','independentlyVerifiedB2','drainVerified','releaseAuthorized'].every(key=>cohort[key]===false),
  'AMORA_MAINTENANCE_COHORT_INVALID');
  objectIds(cohort.objectIds);
  const pids=new Set();for(const member of cohort.members){
    keys(member,['pid','backendStart'],'AMORA_MAINTENANCE_COHORT_INVALID');
    requireValue(integer(member.pid)&&time(member.backendStart)&&!pids.has(member.pid),'AMORA_MAINTENANCE_COHORT_INVALID');pids.add(member.pid);
  }
  const cutoff=literal(cohort.cutoff),members=literal(JSON.stringify(cohort.members));
  const locks=`(SELECT count(*) FROM pg_locks l WHERE l.pid=a.pid AND (l.locktype='advisory'
    OR l.relation IN ('public.profiles'::regclass,'public.couples'::regclass,
    'public.amora_actions'::regclass,'public.wedding_journeys'::regclass)))`;
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $maintenance_remove$
BEGIN${identityGuard(binding)}${inventoryGuard()}${pinsGuard(cohort.objectIds)}${postGuard(input.repoRoot,input.postLedgerMd5)}
  IF ${cutoff}::timestamptz<=clock_timestamp()-interval '120 seconds'
    OR ${cutoff}::timestamptz>clock_timestamp()+interval '10 seconds'
    OR ${literal(cohort.observedAt)}::timestamptz<=clock_timestamp()-interval '120 seconds'
    OR ${literal(cohort.observedAt)}::timestamptz>clock_timestamp()+interval '10 seconds' THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_CUTOFF_EXPIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid<>pg_backend_pid() AND a.datname=current_database()
    AND (a.xact_start<=${cutoff}::timestamptz OR a.query_start<=${cutoff}::timestamptz)
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${members}::jsonb) AS m(pid int,"backendStart" timestamptz)
      WHERE m.pid=a.pid AND m."backendStart"=a.backend_start)) THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_LATE_COHORT';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(${members}::jsonb) AS m(pid int,"backendStart" timestamptz)
    JOIN pg_stat_activity a ON a.pid=m.pid AND a.datname=current_database()
    WHERE a.pid<>pg_backend_pid() AND ((a.backend_start<>m."backendStart" AND a.backend_start<=${cutoff}::timestamptz)
      OR (a.backend_start=m."backendStart" AND
        (a.state IS DISTINCT FROM 'idle' OR a.xact_start IS NOT NULL OR ${locks}<>0)))) THEN
    RAISE EXCEPTION 'AMORA_MAINTENANCE_DRAIN_REQUIRED';
  END IF;
END;
$maintenance_remove$;
DROP TRIGGER ${TRIGGERS[0]} ON public.amora_actions;
DROP TRIGGER ${TRIGGERS[1]} ON public.wedding_journeys;
DROP FUNCTION public.${FUNCTION}();
COMMIT;
`;
}

/** 고정 SQL renderer일 뿐 실행·운영 인가·임의 callback을 받지 않는다. */
export function buildAmoraWriterMaintenanceInstallSql(input={}){
  const binding=options(input);
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $maintenance_preflight$
BEGIN${identityGuard(binding)}${inventoryGuard()}
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
COMMIT;
`;
}

export const AMORA_WRITER_MAINTENANCE_BINDING=Object.freeze({
  functionIdentity:`public.${FUNCTION}()`,functionBodySha256:digest(BODY),functionBodyMd5:digest(BODY,'md5'),
  functionDefinitionSha256:digest(DEFINITION),
  triggerNames:Object.freeze(TRIGGERS.slice()),errorCode:'55000',errorMessage:AMORA_WRITER_MAINTENANCE_ERROR,
  objectCount:3,executionProvenanceVerified:false,releaseAuthorized:false,
});

/** pg_catalog/stats 전용 고정 관찰. 고객 행·query 원문·비밀번호를 반환하지 않는다. */
export function buildAmoraWriterMaintenanceObservationSql(input={}){
  const binding=options(input,['expectedNativeSystemIdentifier','cutoff']);
  const cutoff=input.cutoff??null;
  requireValue(cutoff===null||time(cutoff),'AMORA_MAINTENANCE_CUTOFF_INVALID');
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
DO $maintenance_identity$
BEGIN${identityGuard(binding)}
END;
$maintenance_identity$;
SELECT pg_stat_clear_snapshot();
SELECT jsonb_build_object('format','amora-writer-maintenance-observation-v1',
 'cutoff',${cutoff===null?'NULL':`'${cutoff}'::text`},
 'observedAt',clock_timestamp(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'database',current_database(),'currentUser',current_user,'sessionUser',session_user,
 'serverVersion',current_setting('server_version_num')::int,'address',host(inet_server_addr()),
 'readOnly',current_setting('transaction_read_only')='on',
 'statsVisible',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user
   AND (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'))),
 'observerPid',pg_backend_pid(),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',p.oid::bigint,'identity',p.oid::regprocedure::text,
   'owner',pg_get_userbyid(p.proowner),'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
   'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
   'result',pg_get_function_result(p.oid),'language',l.lanname,'definer',p.prosecdef,'config',p.proconfig,
   'acl',p.proacl::text,'argumentCount',p.pronargs,'defaultCount',p.pronargdefaults,'strict',p.proisstrict,
   'volatility',p.provolatile,'parallel',p.proparallel,'cost',p.procost,'rows',p.prorows,
   'leakProof',p.proleakproof,'returnsSet',p.proretset,'support',p.prosupport::regproc::text)), '[]'::jsonb)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
   WHERE n.nspname='public' AND p.proname='${FUNCTION}'),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',t.oid::bigint,'relation',c.relname,'relationId',c.oid::bigint,
   'name',t.tgname,'functionId',t.tgfoid::bigint,'enabled',t.tgenabled,'type',t.tgtype,
   'qual',pg_get_expr(t.tgqual,t.tgrelid),'args',encode(t.tgargs,'hex'),'columns',t.tgattr::text,
   'constraint',t.tgconstraint<>0,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,
   'oldTable',t.tgoldtable,'newTable',t.tgnewtable) ORDER BY c.relname,t.tgname), '[]'::jsonb)
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgrelid IN
     ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass)
   AND t.tgname IN ('${TRIGGERS[0]}','${TRIGGERS[1]}')),
 'inventory',jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'pid',a.pid,'backendStart',a.backend_start,'queryStart',a.query_start,'xactStart',a.xact_start,
   'database',a.datname,'role',a.usename,'backendType',a.backend_type,'state',a.state,
   'beforeCutoff',${cutoff===null?'NULL':`((a.xact_start IS NOT NULL AND a.xact_start<='${cutoff}'::timestamptz)
     OR (a.query_start IS NOT NULL AND a.query_start<='${cutoff}'::timestamptz))`},
   'backendBeforeCutoff',${cutoff===null?'NULL':`a.backend_start<='${cutoff}'::timestamptz`},
   'targetLocks',(SELECT count(*)::int FROM pg_locks l WHERE l.pid=a.pid AND (l.locktype='advisory'
     OR l.relation IN ('public.profiles'::regclass,'public.couples'::regclass,
       'public.amora_actions'::regclass,'public.wedding_journeys'::regclass)))
   ) ORDER BY a.pid),'[]'::jsonb) FROM pg_stat_activity a))) AS maintenance_observation;
COMMIT;
`;
}

const AUXILIARY=new Set(['checkpointer','background writer','walwriter','autovacuum launcher',
  'logical replication launcher','walsender','walreceiver','slotsync worker']);
const WRITERS=new Set(['client backend','parallel worker','autovacuum worker']);
function inventoryRows(observed){
  keys(observed.inventory,['rows'],'AMORA_MAINTENANCE_INVENTORY_INVALID');
  requireValue(Array.isArray(observed.inventory.rows)&&observed.inventory.rows.length>0,
    'AMORA_MAINTENANCE_INVENTORY_MISSING');
  const pids=new Set(),rows=[];
  for(const row of observed.inventory.rows){
    keys(row,['pid','backendStart','queryStart','xactStart','database','role','backendType','state','targetLocks','beforeCutoff','backendBeforeCutoff'],
      'AMORA_MAINTENANCE_INVENTORY_INVALID');
    requireValue(integer(row.pid)&&!pids.has(row.pid)&&time(row.backendStart)
      &&Number.isSafeInteger(row.targetLocks)&&row.targetLocks>=0,
    'AMORA_MAINTENANCE_INVENTORY_INVALID');pids.add(row.pid);
    requireValue(typeof row.backendType==='string','AMORA_MAINTENANCE_INVENTORY_UNKNOWN');
    if(row.database===null&&AUXILIARY.has(row.backendType))continue;
    requireValue(typeof row.database==='string'&&typeof row.role==='string',
      'AMORA_MAINTENANCE_INVENTORY_UNKNOWN');
    if(row.database!==observed.database)continue;
    requireValue(WRITERS.has(row.backendType)&&['active','idle','idle in transaction','idle in transaction (aborted)'].includes(row.state)
      &&time(row.queryStart)&&(row.xactStart===null||time(row.xactStart))
      &&(observed.cutoff===null?row.beforeCutoff===null&&row.backendBeforeCutoff===null
        :typeof row.beforeCutoff==='boolean'&&typeof row.backendBeforeCutoff==='boolean'),
    'AMORA_MAINTENANCE_INVENTORY_UNKNOWN');rows.push(row);
  }
  requireValue(rows.some(row=>row.pid===observed.observerPid),'AMORA_MAINTENANCE_INVENTORY_OBSERVER_MISSING');
  return rows;
}

/** cutoff의 실제 B2-postverify 발급은 운영 runtime 소유다. 여기서는 내용 일관성만 검사한다. */
export function createAmoraWriterMaintenanceCohort(observed,input={}){
  const proof=validateAmoraWriterMaintenanceObservation(observed,input);
  requireValue(time(proof.cutoff),'AMORA_MAINTENANCE_CUTOFF_REQUIRED');
  requireValue(Date.parse(proof.cutoff)<=Date.parse(proof.observedAt)+10_000
    &&Date.parse(proof.cutoff)>Date.now()-120_000,'AMORA_MAINTENANCE_CUTOFF_EXPIRED');
  return Object.freeze({format:'amora-writer-maintenance-cohort-content-v1',
    systemIdentifier:proof.systemIdentifier,cutoff:proof.cutoff,observedAt:proof.observedAt,
    objectIds:proof.objectIds,members:Object.freeze(proof.inventory.filter(row=>row.beforeCutoff
      &&row.pid!==observed.observerPid).map(row=>Object.freeze({pid:row.pid,backendStart:row.backendStart}))),
    executionProvenanceVerified:false,independentlyVerifiedB2:false,drainVerified:false,releaseAuthorized:false});
}

/** 완전한 actual inventory와 lifetime을 대조한다. 전달된 JSON이 실행 권한을 발급하지 않는다. */
export function assertAmoraWriterMaintenanceDrained(observed,cohort,input={}){
  const proof=validateAmoraWriterMaintenanceObservation(observed,input);
  keys(cohort,['format','systemIdentifier','cutoff','observedAt','objectIds','members','executionProvenanceVerified',
    'independentlyVerifiedB2','drainVerified','releaseAuthorized'],'AMORA_MAINTENANCE_COHORT_INVALID');
  requireValue(cohort.format==='amora-writer-maintenance-cohort-content-v1'&&cohort.systemIdentifier===proof.systemIdentifier
    &&cohort.cutoff===proof.cutoff&&time(cohort.cutoff)&&time(cohort.observedAt)
    &&cohort.executionProvenanceVerified===false&&cohort.independentlyVerifiedB2===false
    &&cohort.drainVerified===false&&cohort.releaseAuthorized===false,
  'AMORA_MAINTENANCE_COHORT_INVALID');
  same(cohort.objectIds,proof.objectIds,'AMORA_MAINTENANCE_OBJECT_LIFETIME_CHANGED');
  requireValue(Date.parse(cohort.observedAt)>Date.now()-120_000&&Date.parse(cohort.observedAt)<=Date.now()+10_000
    &&Date.parse(cohort.cutoff)>Date.now()-120_000,'AMORA_MAINTENANCE_CUTOFF_EXPIRED');
  requireValue(Array.isArray(cohort.members),'AMORA_MAINTENANCE_COHORT_INVALID');
  const pids=new Set();
  for(const member of cohort.members){
    keys(member,['pid','backendStart'],'AMORA_MAINTENANCE_COHORT_INVALID');
    requireValue(integer(member.pid)&&time(member.backendStart)&&!pids.has(member.pid),'AMORA_MAINTENANCE_COHORT_INVALID');
    pids.add(member.pid);
  }
  for(const row of proof.inventory)if(row.pid!==observed.observerPid&&row.beforeCutoff)
    requireValue(cohort.members.some(member=>member.pid===row.pid&&member.backendStart===row.backendStart),
      'AMORA_MAINTENANCE_LATE_COHORT');
  for(const member of cohort.members){
    if(member.pid===observed.observerPid)continue;
    const current=proof.inventory.find(row=>row.pid===member.pid);
    if(!current)continue;
    if(current.backendStart!==member.backendStart){
      requireValue(current.backendBeforeCutoff===false,'AMORA_MAINTENANCE_BACKEND_LIFETIME_UNKNOWN');continue;
    }
    requireValue(current.state==='idle'&&current.xactStart===null&&current.targetLocks===0,
      'AMORA_MAINTENANCE_DRAIN_REQUIRED');
  }
  return Object.freeze({format:'amora-writer-maintenance-drain-content-v1',systemIdentifier:proof.systemIdentifier,
    cutoff:proof.cutoff,observedAt:proof.observedAt,cohortCount:cohort.members.length,
    objectIds:proof.objectIds,executionProvenanceVerified:false,operatingInventoryVerified:false,
    independentlyVerifiedB2:false,drainVerified:false,releaseAuthorized:false});
}

/** JSON 검사는 내용 정합성만 판정하며 어떤 운영 capability도 발급하지 않는다. */
export function validateAmoraWriterMaintenanceObservation(observed,input={}){
  const binding=options(input);
  keys(observed,['format','cutoff','observedAt','systemIdentifier','database','currentUser','sessionUser','serverVersion','address',
    'readOnly','statsVisible','observerPid','functions','triggers','inventory'],'AMORA_MAINTENANCE_OBSERVATION_INVALID');
  requireValue(observed.format==='amora-writer-maintenance-observation-v1'&&observed.systemIdentifier===binding.system
    &&observed.database==='postgres'&&observed.currentUser==='postgres'&&observed.sessionUser==='postgres'
    &&Number.isSafeInteger(observed.serverVersion)&&observed.serverVersion>=170000&&observed.serverVersion<180000
    &&(!binding.native||observed.address==='127.0.0.1')&&observed.readOnly===true,
  'AMORA_MAINTENANCE_DESTINATION_INVALID');
  requireValue(observed.statsVisible===true,'AMORA_MAINTENANCE_STATS_VISIBILITY_REQUIRED');
  const now=Date.now();requireValue(time(observed.observedAt)&&Date.parse(observed.observedAt)<=now+10_000
    &&Date.parse(observed.observedAt)>now-120_000,'AMORA_MAINTENANCE_OBSERVATION_EXPIRED');
  requireValue(observed.cutoff===null||time(observed.cutoff),'AMORA_MAINTENANCE_CUTOFF_INVALID');
  requireValue(integer(observed.observerPid),'AMORA_MAINTENANCE_INVENTORY_INVALID');
  requireValue(Array.isArray(observed.functions)&&observed.functions.length===1
    &&Array.isArray(observed.triggers)&&observed.triggers.length===2,'AMORA_MAINTENANCE_PIN_INVALID');
  const fn=observed.functions[0];
  const {oid,...fnMetadata}=fn;
  requireValue(integer(oid),'AMORA_MAINTENANCE_PIN_INVALID');
  same(fnMetadata,{identity:`${FUNCTION}()`,owner:'postgres',bodySha256:digest(BODY),definitionSha256:digest(DEFINITION),
    result:'trigger',language:'plpgsql',definer:false,config:['search_path=""'],acl:'{postgres=X/postgres}',
    argumentCount:0,defaultCount:0,strict:false,volatility:'v',parallel:'u',cost:100,rows:0,
    leakProof:false,returnsSet:false,support:'-'},'AMORA_MAINTENANCE_PIN_INVALID');
  const triggerIds=[];
  for(const [index,t] of observed.triggers.entries()){
    const {oid:triggerId,relationId,...metadata}=t;
    requireValue(integer(triggerId)&&integer(relationId)&&triggerId!==oid&&!triggerIds.includes(triggerId),
      'AMORA_MAINTENANCE_PIN_INVALID');triggerIds.push(triggerId);
    same(metadata,{relation:['amora_actions','wedding_journeys'][index],name:TRIGGERS[index],functionId:oid,
      enabled:'O',type:30,qual:null,args:'',columns:'',constraint:false,deferrable:false,initiallyDeferred:false,
      oldTable:null,newTable:null},'AMORA_MAINTENANCE_PIN_INVALID');
  }
  const rows=inventoryRows(observed);
  return Object.freeze({format:'amora-writer-maintenance-content-check-v1',systemIdentifier:binding.system,
    observedAt:observed.observedAt,cutoff:observed.cutoff,observationSha256:digest(stable(observed)),
    objectIds:Object.freeze({functionId:oid,triggerIds:Object.freeze(triggerIds)}),
    inventory:Object.freeze(rows.map(row=>Object.freeze({...row}))),
    sourcePinsVerified:false,executionProvenanceVerified:false,operatingInventoryVerified:false,
    independentlyVerifiedB2:false,drainVerified:false,releaseAuthorized:false});
}
