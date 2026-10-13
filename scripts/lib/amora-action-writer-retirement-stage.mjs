import {createHash} from 'node:crypto';
import {requireRelease,same} from './current-baseline-release-contract.mjs';
import {buildAmoraWriterRetirementObservationSql,validateAmoraWriterRetirementObservation} from './amora-action-writer-retirement-catalog.mjs';
import {buildAmoraWriterMaintenanceObservationSql,validateAmoraWriterMaintenanceObservation} from './amora-action-writer-retirement-maintenance.mjs';
import {buildAmoraWriterManagedInventorySql,validateAmoraWriterManagedInventory} from './amora-action-writer-retirement-managed-workers.mjs';
import {amoraWriterRetirementMaintenancePreservedCatalogSql} from './amora-action-writer-retirement-state.mjs';

const FUNCTION='public.deny_amora_action_writer_retirement_maintenance_v1()';
const TRIGGERS=Object.freeze({amora_actions:'deny_amora_actions_writer_retirement_maintenance_v1',
  wedding_journeys:'deny_wedding_journeys_writer_retirement_maintenance_v1'});
const keys=(value,names)=>requireRelease(value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===names.slice().sort().join(','),'AMORA_WRITER_STAGE_ARGUMENT_INVALID');
const digest=value=>createHash('sha256').update(value).digest('hex');
const frame=()=>`SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'observerPid',pg_backend_pid(),'transactionTimestamp',transaction_timestamp(),'database',current_database(),
 'currentUser',current_user,'sessionUser',session_user,'readOnly',current_setting('transaction_read_only')='on') AS value`;
function inner(sql){
  const match=/^BEGIN READ ONLY;\s*([\s\S]*)COMMIT;\s*$/.exec(sql);
  requireRelease(match,'AMORA_WRITER_STAGE_ENVELOPE_INVALID');return match[1];
}
function fixedQuery(sql,alias,start){
  const source=inner(sql),index=source.indexOf(start),suffix=` AS ${alias};`;
  requireRelease(index>=0&&source.trimEnd().endsWith(suffix),'AMORA_WRITER_STAGE_ENVELOPE_INVALID');
  return source.slice(index).trimEnd().slice(0,-1);
}

/** Fixed same-TX observer only. No caller SQL, transport, clock or claimed capability is accepted. */
export function buildAmoraWriterRetirementStageObservationSql(input){
  keys(input,['repoRoot','phase','cutoff','expectedNativeSystemIdentifier']);
  const {repoRoot,phase,cutoff,expectedNativeSystemIdentifier}=input;
  requireRelease(phase==='before'||phase==='after','AMORA_WRITER_STAGE_ARGUMENT_INVALID');
  const managed=inner(buildAmoraWriterManagedInventorySql({expectedNativeSystemIdentifier}));
  const managedStart=managed.indexOf('WITH activity AS MATERIALIZED');
  requireRelease(managedStart>0&&managed.slice(0,managedStart).includes('SELECT pg_stat_clear_snapshot();'),
    'AMORA_WRITER_STAGE_ENVELOPE_INVALID');
  const maintenance=fixedQuery(buildAmoraWriterMaintenanceObservationSql({expectedNativeSystemIdentifier,cutoff}),
    'maintenance_observation',"SELECT jsonb_build_object('format','amora-writer-maintenance-observation-v1'");
  const catalog=fixedQuery(buildAmoraWriterRetirementObservationSql({repoRoot,phase}),'b2_observation','SELECT jsonb_build_object(');
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
${managed.slice(0,managedStart)}
WITH b2_frame_before AS MATERIALIZED (${frame()}),
b2_managed AS MATERIALIZED (${managed.slice(managedStart).trimEnd().slice(0,-1)}),
b2_maintenance AS MATERIALIZED (${maintenance}),
b2_catalog AS MATERIALIZED (${catalog}),
b2_frame_after AS MATERIALIZED (${frame()})
SELECT jsonb_build_object('format','amora-writer-retirement-stage-single-packet-v1',
 'frameBefore',(SELECT value FROM b2_frame_before),'managed',(SELECT managed_inventory FROM b2_managed),
 'maintenance',(SELECT maintenance_observation FROM b2_maintenance),'catalog',(SELECT b2_observation FROM b2_catalog),
 'projectedCatalog',${amoraWriterRetirementMaintenancePreservedCatalogSql()},
 'frameAfter',(SELECT value FROM b2_frame_after)) AS b2_stage_observation;
COMMIT;
`;
}
function single(rows,alias){
  const found=rows.filter(row=>Object.hasOwn(row,alias));
  requireRelease(found.length===1&&Object.keys(found[0]).length===1,'AMORA_WRITER_STAGE_RESPONSE_INVALID');
  return found[0][alias];
}
function sameInventory(managed,maintenance){
  const left=managed.inventory.rows,right=maintenance.inventory.rows;
  requireRelease(left.length===right.length,'AMORA_WRITER_STAGE_INVENTORY_DRIFT');
  for(const a of left){
    const b=right.find(row=>row.pid===a.pid);requireRelease(b,'AMORA_WRITER_STAGE_INVENTORY_DRIFT');
    for(const [one,two] of [['backendStart','backendStart'],['database','database'],['userName','role'],
      ['backendType','backendType'],['state','state'],['queryStart','queryStart'],['xactStart','xactStart']])
      same(a[one],b[two],'AMORA_WRITER_STAGE_INVENTORY_DRIFT');
    requireRelease(b.targetLocks===a.targetRelationLocks+a.advisoryLocks,'AMORA_WRITER_STAGE_INVENTORY_DRIFT');
  }
}
function projectedMaintenance(raw,managed){
  const excluded=new Set([...managed.nonTargetRows,...managed.auxiliaryRows.filter(row=>row.backendType==='archiver')].map(row=>row.pid));
  const projected=structuredClone(raw);
  projected.inventory.rows=projected.inventory.rows.filter(row=>!excluded.has(row.pid));
  requireRelease(projected.inventory.rows.length+excluded.size===raw.inventory.rows.length,'AMORA_WRITER_STAGE_PROJECTION_INVALID');
  return {projected,excludedCount:excluded.size};
}

/** Content validation is not collection provenance. Runtime must separately issue the actual default-transport lineage. */
export function validateAmoraWriterRetirementStageObservation(rows,input){
  keys(input,['repoRoot','phase','cutoff','expectedNativeSystemIdentifier','beforeObservation','expectedObjectIds']);
  requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]&&Object.keys(rows[0]).join(',')==='b2_stage_observation',
    'AMORA_WRITER_STAGE_RESPONSE_INVALID');
  const packet=rows[0].b2_stage_observation;
  keys(packet,['format','frameBefore','managed','maintenance','catalog','projectedCatalog','frameAfter']);
  requireRelease(packet.format==='amora-writer-retirement-stage-single-packet-v1','AMORA_WRITER_STAGE_RESPONSE_INVALID');
  rows=[{b2_stage_frame_before:packet.frameBefore},{managed_inventory:packet.managed},
    {maintenance_observation:packet.maintenance},{b2_observation:packet.catalog},
    {b2_stage_projected_catalog:packet.projectedCatalog},{b2_stage_frame_after:packet.frameAfter}];
  const beforeFrame=single(rows,'b2_stage_frame_before'),afterFrame=single(rows,'b2_stage_frame_after');
  for(const frame of [beforeFrame,afterFrame]){
    keys(frame,['systemIdentifier','observerPid','transactionTimestamp','database','currentUser','sessionUser','readOnly']);
    requireRelease(frame.database==='postgres'&&frame.currentUser==='postgres'&&frame.sessionUser==='postgres'
      &&frame.readOnly===true&&Number.isSafeInteger(frame.observerPid)&&frame.observerPid>0
      &&typeof frame.transactionTimestamp==='string'&&Number.isFinite(Date.parse(frame.transactionTimestamp)),
    'AMORA_WRITER_STAGE_FRAME_INVALID');
  }
  same(beforeFrame,afterFrame,'AMORA_WRITER_STAGE_FRAME_DRIFT');
  const managedRaw=single(rows,'managed_inventory'),maintenanceRaw=single(rows,'maintenance_observation');
  for(const raw of [managedRaw,maintenanceRaw]){
    same(raw.systemIdentifier,beforeFrame.systemIdentifier,'AMORA_WRITER_STAGE_FRAME_DRIFT');
    same(raw.observerPid,beforeFrame.observerPid,'AMORA_WRITER_STAGE_FRAME_DRIFT');
    same([raw.currentUser,raw.sessionUser,raw.readOnly],['postgres','postgres',true],'AMORA_WRITER_STAGE_FRAME_DRIFT');
  }
  same(maintenanceRaw.cutoff,input.cutoff,'AMORA_WRITER_STAGE_CUTOFF_DRIFT');
  const managed=validateAmoraWriterManagedInventory(managedRaw,{expectedNativeSystemIdentifier:input.expectedNativeSystemIdentifier});
  sameInventory(managedRaw,maintenanceRaw);
  const {projected,excludedCount}=projectedMaintenance(maintenanceRaw,managed);
  const maintenance=validateAmoraWriterMaintenanceObservation(projected,{expectedNativeSystemIdentifier:input.expectedNativeSystemIdentifier});
  if(input.expectedObjectIds!==null)same(maintenance.objectIds,input.expectedObjectIds,'AMORA_WRITER_STAGE_OBJECT_LIFETIME_DRIFT');
  const raw=single(rows,'b2_observation'),catalog=structuredClone(raw);
  for(const table of catalog.privileges.tables){
    const name=TRIGGERS[table.name],own=table.triggers.filter(trigger=>trigger.name===name);
    requireRelease(own.length===1,'AMORA_WRITER_STAGE_TRIGGER_PROJECTION_INVALID');
    same(own[0],{name,enabled:'O',type:30,function:FUNCTION,args:'',qual:null,columns:'',constraint:false,
      deferrable:false,initiallyDeferred:false,oldTable:null,newTable:null},'AMORA_WRITER_STAGE_TRIGGER_PROJECTION_INVALID');
    table.triggers=table.triggers.filter(trigger=>trigger.name!==name);
  }
  const projectedHash=single(rows,'b2_stage_projected_catalog');
  requireRelease(typeof projectedHash==='string'&&/^[a-f0-9]{64}$/.test(projectedHash),'AMORA_WRITER_STAGE_DIGEST_INVALID');
  catalog.preservedCatalogSha256=projectedHash;
  validateAmoraWriterRetirementObservation(catalog,{repoRoot:input.repoRoot,phase:input.phase,
    expectedNativeSystemIdentifier:input.expectedNativeSystemIdentifier,beforeObservation:input.phase==='after'?input.beforeObservation:null});
  if(input.beforeObservation&&input.phase==='before')for(const key of ['rows','ledger','rawLedgerSha256','rawLedgerMd5','preservedCatalogSha256'])
    same(catalog[key],input.beforeObservation[key],'AMORA_WRITER_STAGE_BASELINE_DRIFT');
  return Object.freeze({format:'amora-writer-retirement-stage-content-v1',catalog,maintenance,projectedMaintenance:projected,
    managed,rawStageSha256:digest(JSON.stringify(rows)),rawPreservedCatalogSha256:raw.preservedCatalogSha256,
    projectedPreservedCatalogSha256:projectedHash,originalInventoryCount:maintenanceRaw.inventory.rows.length,
    explicitlyExcludedInventoryCount:excludedCount,objectIds:maintenance.objectIds,
    executionProvenanceVerified:false,operatingInventoryVerified:false,releaseAuthorized:false});
}
