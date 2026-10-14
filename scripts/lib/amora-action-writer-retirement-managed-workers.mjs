import {createHash} from 'node:crypto';

const SYSTEM='7581440907192989109';
const EMPTY='d41d8cd98f00b204e9800998ecf8427e';
const FORMAT='amora-writer-managed-inventory-v1';
const READERS=['postgres','supabase_read_only_user'];
const AUXILIARY=new Set(['checkpointer','background writer','walwriter','autovacuum launcher',
  'logical replication launcher','walreceiver','slotsync worker']);
const WRITERS=new Set(['client backend','parallel worker','autovacuum worker']);
const OPTION=String.raw`(?:"(?:proto_version|publication_names|messages|binary|streaming|two_phase|origin)"|(?:proto_version|publication_names|messages|binary|streaming|two_phase|origin))[[:space:]]+'[A-Za-z0-9_., -]*'`;
/** 고정 좁은 pgoutput 문법만 허용한다. slot 식별자 capture는 서버에서만 사용한다. */
export const AMORA_MANAGED_LOGICAL_REPLICATION_PATTERN=String.raw`^[[:space:]]*START_REPLICATION[[:space:]]+SLOT[[:space:]]+("([a-z0-9_]{1,63})"|([a-z_][a-z0-9_]{0,62}))[[:space:]]+LOGICAL[[:space:]]+[0-9A-F]{1,8}/[0-9A-F]{1,8}[[:space:]]*(?:\([[:space:]]*${OPTION}(?:[[:space:]]*,[[:space:]]*${OPTION})*[[:space:]]*\))?[[:space:]]*$`;
const fail=code=>{throw new Error(code);};
const requireValue=(ok,code)=>{if(!ok)fail(code);};
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const same=(a,b,code)=>requireValue(stable(a)===stable(b),code);
const keys=(value,names)=>{
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),'AMORA_MANAGED_SHAPE_INVALID');
  same(Object.keys(value).sort(),names.slice().sort(),'AMORA_MANAGED_SHAPE_INVALID');
};
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const positive=value=>Number.isSafeInteger(value)&&value>0;
const nonnegative=value=>Number.isSafeInteger(value)&&value>=0;
const frozenCopy=value=>{
  const freeze=entry=>{if(entry&&typeof entry==='object'){for(const nested of Object.values(entry))freeze(nested);Object.freeze(entry);}return entry;};
  return freeze(structuredClone(value));
};
function binding(value){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).every(key=>key==='expectedNativeSystemIdentifier'),'AMORA_MANAGED_OPTIONS_INVALID');
  const native=value.expectedNativeSystemIdentifier??null;
  requireValue(native===null||(typeof native==='string'&&/^\d{1,20}$/.test(native)&&native!==SYSTEM),
    'AMORA_MANAGED_IDENTITY_INVALID');
  return {system:native??SYSTEM,native:native!==null};
}
export const AMORA_MANAGED_WORKER_SOURCE_BINDINGS=Object.freeze({
  pgNet:Object.freeze({version:'0.19.5',source:'https://raw.githubusercontent.com/supabase/pg_net/v0.19.5/src/worker.c'}),
  pgCron:Object.freeze({version:'1.6.4',source:'https://raw.githubusercontent.com/citusdata/pg_cron/v1.6.4/src/pg_cron.c'}),
  sourceBinaryVerified:false,executionProvenanceVerified:false,releaseAuthorized:false,
});

/** 고정 같은-TX READ ONLY metadata다. 고객 query/slot 이름을 반환하거나 caller SQL을 실행하지 않는다. */
export function buildAmoraWriterManagedInventorySql(value={}){
  const destination=binding(value);
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
DO $managed_identity$
BEGIN
  IF current_user NOT IN ('postgres','supabase_read_only_user') OR current_user<>session_user
    OR current_database()<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '${destination.system}'
    ${destination.native?"OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'":''} THEN
    RAISE EXCEPTION 'AMORA_MANAGED_DESTINATION_INVALID';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user
    AND (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'))) THEN
    RAISE EXCEPTION 'AMORA_MANAGED_FULL_STATS_REQUIRED';
  END IF;
END;
$managed_identity$;
SELECT pg_stat_clear_snapshot();
WITH activity AS MATERIALIZED (SELECT a.*,CASE WHEN a.query IS NULL OR a.query='<insufficient privilege>'
    OR octet_length(a.query)>=pg_size_bytes(current_setting('track_activity_query_size'))-1 THEN NULL
    ELSE regexp_match(a.query,$replication_marker$${AMORA_MANAGED_LOGICAL_REPLICATION_PATTERN}$replication_marker$) END AS logical_marker
  FROM pg_stat_activity a)
SELECT jsonb_build_object('format','${FORMAT}','observedAt',clock_timestamp(),
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'currentUser',current_user,'sessionUser',session_user,'database',current_database(),
  'serverVersion',current_setting('server_version_num')::int,'address',host(inet_server_addr()),
  'readOnly',current_setting('transaction_read_only')='on',
  'statsVisible',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user
    AND (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'))),
  'observerPid',pg_backend_pid(),
  'capabilities',jsonb_build_object(
    'net',jsonb_build_object('sqlExtension',EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net'),
      'namespace',to_regnamespace('net') IS NOT NULL,'queue',to_regclass('net.http_request_queue') IS NOT NULL,
      'response',to_regclass('net._http_response') IS NOT NULL,
      'httpFunctions',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='net' AND p.proname IN ('http_get','http_post','http_delete'))),
    'cron',jsonb_build_object('version',(SELECT extversion FROM pg_extension WHERE extname='pg_cron'),
      'useBackgroundWorkers',current_setting('cron.use_background_workers',true),
      'jobTable',to_regclass('cron.job') IS NOT NULL)),
  'inventory',jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pid',a.pid,'backendStart',a.backend_start,'database',a.datname,'userName',a.usename,
    'application',a.application_name,'backendType',a.backend_type,'state',a.state,
    'xactStart',a.xact_start,'queryStart',a.query_start,'waitEventType',a.wait_event_type,'waitEvent',a.wait_event,
    'queryHash',CASE WHEN a.query IS NULL OR a.query='<insufficient privilege>' THEN NULL ELSE md5(a.query) END,
    'queryMarker',CASE WHEN a.query IS NULL OR a.query='<insufficient privilege>' THEN NULL
      WHEN a.query='' THEN 'empty' WHEN a.logical_marker IS NOT NULL THEN 'single-start-logical-replication' ELSE 'other' END,
    'targetRelationLocks',(SELECT count(*)::int FROM pg_locks l WHERE l.pid=a.pid AND l.relation IN
      ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass,'public.profiles'::regclass,'public.couples'::regclass)),
    'advisoryLocks',(SELECT count(*)::int FROM pg_locks l WHERE l.pid=a.pid AND l.locktype='advisory'),
    'blockers',pg_blocking_pids(a.pid),'replication',CASE WHEN a.backend_type<>'walsender' THEN NULL ELSE
      jsonb_build_object('markerValidated',a.logical_marker IS NOT NULL,
        'linkedSlots',(SELECT coalesce(jsonb_agg(jsonb_build_object('activePid',s.active_pid,'active',s.active,
          'database',s.database,'slotType',s.slot_type,'plugin',s.plugin,
          'querySlotMatched',s.slot_name=coalesce(a.logical_marker[2],a.logical_marker[3]))
          ORDER BY s.slot_type,s.plugin),'[]'::jsonb) FROM pg_replication_slots s WHERE s.active_pid=a.pid)) END)
    ORDER BY a.pid),'[]'::jsonb) FROM activity a))) AS managed_inventory;
COMMIT;
`;
}
function capabilityShape(capabilities){
  keys(capabilities,['net','cron']);
  keys(capabilities.net,['sqlExtension','namespace','queue','response','httpFunctions']);
  requireValue(['sqlExtension','namespace','queue','response'].every(key=>typeof capabilities.net[key]==='boolean')
    &&nonnegative(capabilities.net.httpFunctions),'AMORA_MANAGED_CAPABILITY_UNKNOWN');
  keys(capabilities.cron,['version','useBackgroundWorkers','jobTable']);
  requireValue((capabilities.cron.version===null||typeof capabilities.cron.version==='string')
    &&(capabilities.cron.useBackgroundWorkers===null||['off','on'].includes(capabilities.cron.useBackgroundWorkers))
    &&typeof capabilities.cron.jobTable==='boolean','AMORA_MANAGED_CAPABILITY_UNKNOWN');
}
function rowShape(row){
  keys(row,['pid','backendStart','database','userName','application','backendType','state','xactStart','queryStart',
    'waitEventType','waitEvent','queryHash','queryMarker','targetRelationLocks','advisoryLocks','blockers','replication']);
  requireValue(positive(row.pid)&&time(row.backendStart)&&typeof row.backendType==='string'
    &&(row.database===null||typeof row.database==='string')&&(row.userName===null||typeof row.userName==='string')
    &&typeof row.application==='string'&&(row.state===null||typeof row.state==='string')
    &&(row.xactStart===null||time(row.xactStart))&&(row.queryStart===null||time(row.queryStart))
    &&(row.waitEventType===null||typeof row.waitEventType==='string')&&(row.waitEvent===null||typeof row.waitEvent==='string')
    &&(row.queryHash===null||typeof row.queryHash==='string'&&/^[a-f0-9]{32}$/.test(row.queryHash))
    &&(row.queryMarker===null||['empty','other','single-start-logical-replication'].includes(row.queryMarker))
    &&nonnegative(row.targetRelationLocks)&&nonnegative(row.advisoryLocks)
    &&Array.isArray(row.blockers)&&row.blockers.every(positive)&&new Set(row.blockers).size===row.blockers.length,
  'AMORA_MANAGED_INVENTORY_UNKNOWN');
}
const clearWait=row=>row.userName==='supabase_admin'&&row.state===null&&row.xactStart===null&&row.queryStart===null
  &&row.queryHash===EMPTY&&row.queryMarker==='empty'&&row.waitEventType==='Extension'&&row.waitEvent==='Extension'
  &&row.targetRelationLocks===0&&row.advisoryLocks===0&&row.blockers.length===0&&row.replication===null;

/** 순수 내용 분류다. 실제 default 수집/opaque source 계보를 증명하거나 실행 권한을 발급하지 않는다. */
export function validateAmoraWriterManagedInventory(raw,value={}){
  const destination=binding(value);
  keys(raw,['format','observedAt','systemIdentifier','currentUser','sessionUser','database','serverVersion','address',
    'readOnly','statsVisible','observerPid','capabilities','inventory']);
  requireValue(raw.format===FORMAT&&raw.systemIdentifier===destination.system&&raw.database==='postgres'
    &&READERS.includes(raw.currentUser)&&raw.currentUser===raw.sessionUser&&raw.readOnly===true
    &&Number.isSafeInteger(raw.serverVersion)&&raw.serverVersion>=170000&&raw.serverVersion<180000
    &&(!destination.native||raw.address==='127.0.0.1'),'AMORA_MANAGED_DESTINATION_INVALID');
  requireValue(raw.statsVisible===true,'AMORA_MANAGED_FULL_STATS_REQUIRED');
  requireValue(time(raw.observedAt)&&Date.parse(raw.observedAt)>Date.now()-120_000
    &&Date.parse(raw.observedAt)<=Date.now()+10_000,'AMORA_MANAGED_OBSERVATION_EXPIRED');
  capabilityShape(raw.capabilities);keys(raw.inventory,['rows']);
  requireValue(positive(raw.observerPid)&&Array.isArray(raw.inventory.rows)&&raw.inventory.rows.length>0,
    'AMORA_MANAGED_INVENTORY_UNKNOWN');
  const pids=new Set(),writerRows=[],nonTargetRows=[],auxiliaryRows=[],otherDatabaseRows=[];
  for(const row of raw.inventory.rows){
    rowShape(row);requireValue(!pids.has(row.pid),'AMORA_MANAGED_INVENTORY_UNKNOWN');pids.add(row.pid);
    requireValue([row.backendStart,row.queryStart,row.xactStart].every(value=>value===null
      ||Date.parse(value)<=Date.parse(raw.observedAt)+10_000),'AMORA_MANAGED_LIFETIME_UNKNOWN');
    // core WAL archiver의 실제 DB 연결 없는 대기만 분리한다. 이름만으로 unknown을 제외하지 않는다.
    if(row.backendType==='archiver'){
      requireValue(row.database===null&&row.userName===null&&row.application===''&&row.state===null
        &&row.xactStart===null&&row.queryStart===null&&row.queryHash===EMPTY&&row.queryMarker==='empty'
        &&row.waitEventType==='Activity'&&row.waitEvent==='ArchiverMain'
        &&row.targetRelationLocks===0&&row.advisoryLocks===0&&row.blockers.length===0&&row.replication===null,
      'AMORA_MANAGED_ARCHIVER_CAPABILITY_CHANGED');
      auxiliaryRows.push(frozenCopy(row));continue;
    }
    if(row.database===null&&AUXILIARY.has(row.backendType)){auxiliaryRows.push(frozenCopy(row));continue;}
    requireValue(typeof row.database==='string'&&typeof row.userName==='string','AMORA_MANAGED_INVENTORY_UNKNOWN');
    if(row.database!==raw.database){otherDatabaseRows.push(frozenCopy(row));continue;}
    if(WRITERS.has(row.backendType)){
      requireValue(['active','idle','idle in transaction','idle in transaction (aborted)'].includes(row.state)
        &&time(row.queryStart)&&row.queryHash!==null&&row.queryMarker!==null&&row.replication===null,
      'AMORA_MANAGED_INVENTORY_UNKNOWN');writerRows.push(frozenCopy(row));continue;
    }
    if(row.backendType==='pg_net 0.19.5 worker'){
      requireValue(row.application==='pg_net 0.19.5'&&clearWait(row)
        &&['sqlExtension','namespace','queue','response'].every(key=>raw.capabilities.net[key]===false)
        &&raw.capabilities.net.httpFunctions===0,'AMORA_MANAGED_NET_CAPABILITY_CHANGED');
      nonTargetRows.push(frozenCopy({...row,kind:'pg-net-unavailable-current-wait'}));continue;
    }
    if(row.backendType==='pg_cron launcher'){
      requireValue(row.application==='pg_cron scheduler'&&clearWait(row)
        &&raw.capabilities.cron.version==='1.6.4'&&raw.capabilities.cron.useBackgroundWorkers==='off'
        &&raw.capabilities.cron.jobTable===true,'AMORA_MANAGED_CRON_CAPABILITY_CHANGED');
      nonTargetRows.push(frozenCopy({...row,kind:'pg-cron-libpq-launcher-current-wait'}));continue;
    }
    if(row.backendType==='walsender'){
      keys(row.replication,['markerValidated','linkedSlots']);
      requireValue(row.userName==='supabase_admin'&&row.application==='realtime_replication_connection'
        &&row.state==='active'&&row.xactStart===null&&time(row.queryStart)&&row.queryHash!==null
        &&row.queryMarker==='single-start-logical-replication'&&row.waitEventType==='Client'
        &&row.waitEvent==='WalSenderWaitForWal'&&row.targetRelationLocks===0&&row.advisoryLocks===0
        &&row.blockers.length===0&&row.replication.markerValidated===true
        &&Array.isArray(row.replication.linkedSlots)&&row.replication.linkedSlots.length===1,
      'AMORA_MANAGED_REPLICATION_CAPABILITY_CHANGED');
      const slot=row.replication.linkedSlots[0];
      keys(slot,['activePid','active','database','slotType','plugin','querySlotMatched']);
      same(slot,{activePid:row.pid,active:true,database:raw.database,slotType:'logical',plugin:'pgoutput',querySlotMatched:true},
        'AMORA_MANAGED_REPLICATION_CAPABILITY_CHANGED');
      nonTargetRows.push(frozenCopy({...row,kind:'realtime-pgoutput-current-wal-wait'}));continue;
    }
    fail('AMORA_MANAGED_INVENTORY_UNKNOWN');
  }
  requireValue(writerRows.some(row=>row.pid===raw.observerPid),'AMORA_MANAGED_OBSERVER_MISSING');
  return Object.freeze({format:'amora-writer-managed-inventory-content-v1',observedAt:raw.observedAt,
    systemIdentifier:raw.systemIdentifier,observerPid:raw.observerPid,
    observationSha256:createHash('sha256').update(stable(raw)).digest('hex'),
    writerRows:Object.freeze(writerRows),nonTargetRows:Object.freeze(nonTargetRows),
    auxiliaryRows:Object.freeze(auxiliaryRows),otherDatabaseRows:Object.freeze(otherDatabaseRows),
    executionProvenanceVerified:false,operatingInventoryVerified:false,managedCapabilityVerified:false,
    sourceBinaryVerified:false,releaseAuthorized:false});
}
