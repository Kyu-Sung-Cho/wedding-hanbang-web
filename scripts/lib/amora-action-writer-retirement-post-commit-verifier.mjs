import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {types} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {requireRelease,CurrentBaselineBlocked} from './current-baseline-release-contract.mjs';
import {buildAmoraWriterRetirementObservationSql} from './amora-action-writer-retirement-catalog.mjs';
import {buildAmoraWriterManagedInventorySql,validateAmoraWriterManagedInventory} from './amora-action-writer-retirement-managed-workers.mjs';
import {amoraWriterRetirementRawLedgerShaSql} from './amora-action-writer-retirement-state.mjs';
import {ORIGINAL7_IDENTITIES} from './amora-action-writer-retirement-original-source.mjs';
import {deriveFixedApplied7FromRepo} from './amora-action-writer-retirement-original-source.mjs';
import {validateAmoraWriterRetirementCurrentAfterPrivileges} from './amora-action-writer-retirement-privileges.mjs';
import {validateAmoraWriterRetirementLedger} from './amora-action-writer-retirement-recovery.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {collectAmoraWriterRetirementAdmission,assertAmoraWriterRetirementAdmission} from './amora-action-writer-retirement-admission.mjs';
import {readAmoraWriterRetirementBoundedJsonResponse} from './amora-action-writer-retirement-http.mjs';

const SYSTEM='7581440907192989109';
const PROJECT='slrtobkksjmxgzatjyqb',RELEASE='amora-action-writer-retirement-transport-20261013';
const cohorts=new WeakMap();
const completed=new WeakMap();
const files=['post-commit-verifier','archived-original','archived-native','admission','release','release-contract',
  'catalog','privileges','bundle','original-source','recovery','original-capture','native-recovery','private-store',
  'private-journal','http','state','managed-workers'].map(name=>'scripts/lib/amora-action-writer-retirement-'+name+'.mjs');
const hashes=root=>files.map(file=>({file,sha256:sha(readFileSync(join(root,file)))}));
const keys=(value,names)=>{
  requireRelease(value&&typeof value==='object'&&!Array.isArray(value)&&!types.isProxy(value)
    &&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'AMORA_WRITER_POST_ARGUMENT_INVALID');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  requireRelease(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&descriptors[key].enumerable===true
    &&Object.hasOwn(descriptors[key],'value'))&&Object.keys(value).sort().join(',')===names.slice().sort().join(','),
  'AMORA_WRITER_POST_ARGUMENT_INVALID');
};
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const literal=value=>`'${value.replaceAll("'","''")}'`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const md5=value=>createHash('md5').update(value).digest('hex');
const isSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const isMd5=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(a,b,code)=>requireRelease(stable(a)===stable(b),code);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const frame=()=>`SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'observerPid',pg_backend_pid(),'transactionTimestamp',transaction_timestamp(),'database',current_database(),
 'currentUser',current_user,'sessionUser',session_user,'readOnly',current_setting('transaction_read_only')='on') AS value`;
const inner=sql=>{
  const match=/^BEGIN READ ONLY;\s*([\s\S]*)COMMIT;\s*$/.exec(sql);
  requireRelease(match,'AMORA_WRITER_POST_SQL_ENVELOPE_INVALID');return match[1];
};

/** 고정 읽기 전용 packet. native ID는 순수 로컬 검증에만 쓰며 운영 실행자는 받지 않는다. */
export function buildAmoraWriterRetirementCommittedObservationSql(input){
  keys(input,['repoRoot','cutoff','expectedNativeSystemIdentifier','expectedObjectIds']);
  const {repoRoot,cutoff,expectedNativeSystemIdentifier,expectedObjectIds}=input;
  requireRelease(typeof repoRoot==='string'&&(cutoff===null||time(cutoff))
    &&(expectedNativeSystemIdentifier===null||typeof expectedNativeSystemIdentifier==='string'
      &&/^\d{10,32}$/.test(expectedNativeSystemIdentifier)&&expectedNativeSystemIdentifier!==SYSTEM),
  'AMORA_WRITER_POST_ARGUMENT_INVALID');
  keys(expectedObjectIds,['functionId','triggerIds']);
  const {functionId,triggerIds}=expectedObjectIds;
  requireRelease(Number.isSafeInteger(functionId)&&functionId>0&&functionId<=4294967295
    &&Array.isArray(triggerIds)&&triggerIds.length===2&&triggerIds.every(id=>Number.isSafeInteger(id)&&id>0&&id<=4294967295)
    &&new Set([functionId,...triggerIds]).size===3,'AMORA_WRITER_POST_OBJECT_IDS_INVALID');
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  const managed=inner(buildAmoraWriterManagedInventorySql({expectedNativeSystemIdentifier}));
  const managedStart=managed.indexOf('WITH activity AS MATERIALIZED');
  requireRelease(managedStart>0&&managed.slice(0,managedStart).includes('SELECT pg_stat_clear_snapshot();'),
    'AMORA_WRITER_POST_SQL_ENVELOPE_INVALID');
  const source=inner(buildAmoraWriterRetirementObservationSql({repoRoot,phase:'after'}));
  const catalogStart=source.indexOf('SELECT jsonb_build_object(');
  requireRelease(catalogStart>=0&&source.trimEnd().endsWith(' AS b2_observation;'),'AMORA_WRITER_POST_SQL_ENVELOPE_INVALID');
  const catalog=source.slice(catalogStart).trimEnd().slice(0,-1);
  const predecessor=amoraWriterRetirementRawLedgerShaSql().replace('FROM supabase_migrations.schema_migrations)',
    `FROM supabase_migrations.schema_migrations WHERE version <> ${literal(plan.migration.version)})`);
  requireRelease(predecessor.includes(`version <> ${literal(plan.migration.version)}`),'AMORA_WRITER_POST_SQL_ENVELOPE_INVALID');
  const identity="n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')'";
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
${managed.slice(0,managedStart)}
WITH post_frame_before AS MATERIALIZED (${frame()}),
post_managed AS MATERIALIZED (${managed.slice(managedStart).trimEnd().slice(0,-1)}),
post_catalog AS MATERIALIZED (${catalog}),
post_frame_after AS MATERIALIZED (${frame()})
SELECT jsonb_build_object('format','amora-writer-retirement-cold-post-single-packet-v1',
 'frameBefore',(SELECT value FROM post_frame_before),'managed',(SELECT managed_inventory FROM post_managed),
 'catalog',(SELECT b2_observation FROM post_catalog),
 'maintenanceSlots',jsonb_build_object('functions',(SELECT COALESCE(jsonb_agg(p.oid::bigint ORDER BY p.oid),'[]'::jsonb)
  FROM pg_proc p WHERE p.proname='deny_amora_action_writer_retirement_maintenance_v1' OR p.oid=${functionId}),
 'triggers',(SELECT COALESCE(jsonb_agg(t.oid::bigint ORDER BY t.oid),'[]'::jsonb) FROM pg_trigger t
  WHERE t.tgname IN ('deny_amora_actions_writer_retirement_maintenance_v1','deny_wedding_journeys_writer_retirement_maintenance_v1')
  OR t.oid IN (${triggerIds.join(',')}) OR t.tgfoid=${functionId})),
 'predecessorRawLedgerSha256',${predecessor},
 'applied7DefinitionHashes',(SELECT COALESCE(jsonb_agg(jsonb_build_array(${identity},
  encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) ORDER BY ${identity}),'[]'::jsonb)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${identity} IN (${ORIGINAL7_IDENTITIES.map(literal).join(',')})),
 'serverCutoff',${cutoff===null?'clock_timestamp()':literal(cutoff)+'::timestamptz'},
 'frameAfter',(SELECT value FROM post_frame_after)) AS b2_committed_observation;
COMMIT;
`;
}

const beforeCutoff=(row,cutoff)=>[row.backendStart,row.queryStart,row.xactStart]
  .some(value=>value!==null&&Date.parse(value)<=Date.parse(cutoff));
const freshCutoff=cutoff=>requireRelease(time(cutoff)&&Date.parse(cutoff)>Date.now()-120_000
  &&Date.parse(cutoff)<=Date.now()+10_000,'AMORA_WRITER_POST_CUTOFF_EXPIRED');

/** 순수 전체-client cohort. 보호 원본/CI/실제 전송을 발급하지 않는다. */
export function createAmoraWriterRetirementCommittedCohort(raw,input){
  keys(input,['cutoff','expectedNativeSystemIdentifier']);freshCutoff(input.cutoff);
  const inventory=validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:input.expectedNativeSystemIdentifier});
  const observer=inventory.writerRows.find(row=>row.pid===inventory.observerPid);
  requireRelease(observer.advisoryLocks===0&&observer.blockers.length===0,'AMORA_WRITER_POST_DRAIN_REQUIRED');
  requireRelease(Date.parse(input.cutoff)<=Date.parse(inventory.observedAt)+10_000,'AMORA_WRITER_POST_CUTOFF_INVALID');
  const proof=freeze({format:'amora-writer-retirement-cold-post-cohort-content-v1',systemIdentifier:inventory.systemIdentifier,
    cutoff:input.cutoff,observedAt:inventory.observedAt,inventorySha256:inventory.observationSha256,
    members:inventory.writerRows.filter(row=>row.pid!==inventory.observerPid&&beforeCutoff(row,input.cutoff))
      .map(row=>({pid:row.pid,backendStart:row.backendStart})),executionProvenanceVerified:false,drainVerified:false,releaseAuthorized:false});
  cohorts.set(proof,{system:inventory.systemIdentifier,native:input.expectedNativeSystemIdentifier});return proof;
}

/** 기존 실행을 취소하거나 재시도하지 않고 실제 현재 lifetime/transaction/lock만 검증한다. */
export function assertAmoraWriterRetirementCommittedDrained(raw,cohort,input){
  keys(input,['expectedNativeSystemIdentifier']);
  const state=cohorts.get(cohort);
  requireRelease(state&&state.native===input.expectedNativeSystemIdentifier,'AMORA_WRITER_POST_COHORT_NOT_ISSUED');
  freshCutoff(cohort.cutoff);
  const current=validateAmoraWriterManagedInventory(raw,input);
  requireRelease(current.systemIdentifier===state.system&&Date.parse(current.observedAt)>=Date.parse(cohort.observedAt),
    'AMORA_WRITER_POST_COHORT_IDENTITY_CHANGED');
  for(const row of current.writerRows)if(row.pid!==current.observerPid&&beforeCutoff(row,cohort.cutoff))
    requireRelease(cohort.members.some(member=>member.pid===row.pid&&member.backendStart===row.backendStart),
      'AMORA_WRITER_POST_LATE_COHORT');
  for(const member of cohort.members){
    const row=current.writerRows.find(row=>row.pid===member.pid);
    if(!row)continue;
    if(row.backendStart!==member.backendStart){
      requireRelease(Date.parse(row.backendStart)>Date.parse(cohort.cutoff),'AMORA_WRITER_POST_BACKEND_LIFETIME_UNKNOWN');continue;
    }
    if(row.pid===current.observerPid){
      // 풀에서 재사용된 관찰자라는 이유만으로 과거 세션 잠금·트랜잭션을 제외하지 않는다.
      requireRelease(row.state==='active'&&row.xactStart!==null&&Date.parse(row.xactStart)>Date.parse(cohort.cutoff)
        &&row.advisoryLocks===0&&row.blockers.length===0,'AMORA_WRITER_POST_DRAIN_REQUIRED');
      continue;
    }
    requireRelease(row.state==='idle'&&row.xactStart===null&&row.targetRelationLocks===0&&row.advisoryLocks===0
      &&row.blockers.length===0,'AMORA_WRITER_POST_DRAIN_REQUIRED');
  }
  return Object.freeze({format:'amora-writer-retirement-cold-post-drain-content-v1',systemIdentifier:current.systemIdentifier,
    cutoff:cohort.cutoff,observedAt:current.observedAt,cohortCount:cohort.members.length,
    inventorySha256:current.observationSha256,executionProvenanceVerified:false,drainVerified:false,releaseAuthorized:false});
}

/** 과거 원문은 비교 맥락일 뿐이다. 이 순수 반환값은 실제 수집/CI/native 완료 authority가 아니다. */
export function validateAmoraWriterRetirementCommittedObservation(rows,input){
  keys(input,['repoRoot','historical','cutoff','expectedNativeSystemIdentifier']);
  const {repoRoot,historical,cutoff,expectedNativeSystemIdentifier}=input;
  requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]&&Object.keys(rows[0]).join(',')==='b2_committed_observation',
    'AMORA_WRITER_POST_RESPONSE_INVALID');
  const raw=rows[0].b2_committed_observation;
  keys(raw,['format','frameBefore','managed','catalog','maintenanceSlots','predecessorRawLedgerSha256',
    'applied7DefinitionHashes','serverCutoff','frameAfter']);
  requireRelease(raw.format==='amora-writer-retirement-cold-post-single-packet-v1','AMORA_WRITER_POST_RESPONSE_INVALID');
  for(const frame of [raw.frameBefore,raw.frameAfter]){
    keys(frame,['systemIdentifier','observerPid','transactionTimestamp','database','currentUser','sessionUser','readOnly']);
    requireRelease(frame.database==='postgres'&&frame.currentUser==='postgres'&&frame.sessionUser==='postgres'
      &&frame.readOnly===true&&Number.isSafeInteger(frame.observerPid)&&frame.observerPid>0&&time(frame.transactionTimestamp)
      &&Date.parse(frame.transactionTimestamp)>Date.now()-120_000&&Date.parse(frame.transactionTimestamp)<=Date.now()+10_000,
    'AMORA_WRITER_POST_FRAME_INVALID');
  }
  same(raw.frameBefore,raw.frameAfter,'AMORA_WRITER_POST_FRAME_DRIFT');
  const managed=validateAmoraWriterManagedInventory(raw.managed,{expectedNativeSystemIdentifier});
  same([raw.managed.systemIdentifier,raw.managed.observerPid,raw.managed.currentUser,raw.managed.sessionUser,raw.managed.readOnly],
    [raw.frameBefore.systemIdentifier,raw.frameBefore.observerPid,'postgres','postgres',true],'AMORA_WRITER_POST_FRAME_DRIFT');
  keys(raw.maintenanceSlots,['functions','triggers']);
  same(raw.maintenanceSlots,{functions:[],triggers:[]},'AMORA_WRITER_POST_MAINTENANCE_NOT_ABSENT');
  freshCutoff(raw.serverCutoff);
  requireRelease(cutoff===null||raw.serverCutoff===cutoff,'AMORA_WRITER_POST_CUTOFF_DRIFT');
  requireRelease((cutoff!==null||Date.parse(raw.serverCutoff)>=Date.parse(raw.frameBefore.transactionTimestamp)-10_000)
    &&Date.parse(raw.serverCutoff)<=Date.parse(raw.frameBefore.transactionTimestamp)+10_000
    &&Date.parse(raw.serverCutoff)<=Date.parse(managed.observedAt)+10_000,'AMORA_WRITER_POST_CUTOFF_INVALID');
  const catalog=raw.catalog;
  keys(catalog,['format','phase','privileges','rows','preservedCatalogSha256','ledger','rawLedgerSha256','rawLedgerMd5']);
  requireRelease(catalog.format==='amora-writer-retirement-original7-observation-v1'&&catalog.phase==='after','AMORA_WRITER_POST_CATALOG_INVALID');
  const privileges=validateAmoraWriterRetirementCurrentAfterPrivileges(catalog.privileges,{repoRoot,expectedNativeSystemIdentifier});
  same([privileges.systemIdentifier,catalog.privileges.currentUser,catalog.privileges.readOnly],
    [raw.frameBefore.systemIdentifier,'postgres',true],'AMORA_WRITER_POST_FRAME_DRIFT');
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  requireRelease(historical&&historical.format==='amora-b2-original7-canonical-update-acl-capsule-v1'
    &&historical.kind==='b2-scoped-original7-not-b1-original4-or-b2-original6'
    &&historical.sourceSystemIdentifier===raw.frameBefore.systemIdentifier&&historical.bundleSha256===plan.migration.sha256
    &&typeof historical.sourceCommit==='string'&&/^[a-f0-9]{40}$/.test(historical.sourceCommit)
    &&time(historical.capturedAt)&&Date.parse(historical.capturedAt)<=Date.parse(privileges.observedAt),
  'AMORA_WRITER_POST_HISTORICAL_CONTEXT_INVALID');
  keys(historical.stateWitness,['preservedCatalogSha256','rows','rawLedgerSha256','ledger']);
  keys(catalog.rows,['amoraActionsCount','amoraActionsSha256','journeysCount','journeysSha256']);
  requireRelease(['amoraActionsCount','journeysCount'].every(name=>Number.isSafeInteger(catalog.rows[name])&&catalog.rows[name]>=0)
    &&['amoraActionsSha256','journeysSha256'].every(name=>isSha(catalog.rows[name]))
    &&isSha(catalog.preservedCatalogSha256)&&isSha(catalog.rawLedgerSha256)&&isMd5(catalog.rawLedgerMd5)
    &&isSha(raw.predecessorRawLedgerSha256),'AMORA_WRITER_POST_DIGEST_INVALID');
  same(catalog.rows,historical.stateWitness.rows,'AMORA_WRITER_POST_HISTORICAL_ROWS_CHANGED');
  same(catalog.preservedCatalogSha256,historical.stateWitness.preservedCatalogSha256,'AMORA_WRITER_POST_PRESERVED_CATALOG_CHANGED');
  same(raw.predecessorRawLedgerSha256,historical.stateWitness.rawLedgerSha256,'AMORA_WRITER_POST_ORIGINAL230_RAW_LEDGER_CHANGED');
  if(expectedNativeSystemIdentifier===null){
    validateAmoraWriterRetirementLedger(historical.stateWitness.ledger,plan.expectedBefore230);
    validateAmoraWriterRetirementLedger(catalog.ledger,plan.expectedAfter231);
  }else requireRelease(Array.isArray(historical.stateWitness.ledger)&&historical.stateWitness.ledger.length===230
    &&Array.isArray(catalog.ledger)&&catalog.ledger.length===231,'AMORA_WRITER_POST_NATIVE_LEDGER_INVALID');
  same(catalog.ledger.filter(row=>row.version!==plan.migration.version),historical.stateWitness.ledger,
    'AMORA_WRITER_POST_ORIGINAL230_LEDGER_CHANGED');
  const registered=catalog.ledger.filter(row=>row.version===plan.migration.version);
  same(registered,[{version:plan.migration.version,name:plan.migration.name,statementCount:1,sqlMd5:md5(plan.migration.sql),
    statementsSha256:sha(JSON.stringify([plan.migration.sql]))}],'AMORA_WRITER_POST_REGISTERED_SQL_CHANGED');
  same(raw.applied7DefinitionHashes,deriveFixedApplied7FromRepo(repoRoot).map(fn=>[fn.identity,fn.definitionSha256]),
    'AMORA_WRITER_POST_APPLIED7_DEFINITION_CHANGED');
  return Object.freeze({format:'amora-writer-retirement-cold-post-content-v1',systemIdentifier:privileges.systemIdentifier,
    observedAt:privileges.observedAt,serverCutoff:raw.serverCutoff,ledgerCount:231,own3Absent:true,
    observationSha256:sha(stable(rows)),rawLedgerSha256:catalog.rawLedgerSha256,rawLedgerMd5:catalog.rawLedgerMd5,
    preservedCatalogSha256:catalog.preservedCatalogSha256,rowsSha256:sha(stable(catalog.rows)),
    executionProvenanceVerified:false,privateRecoveryVerified:false,nativeReplayVerified:false,releaseAuthorized:false});
}

async function fixedRead(sql,deadline){
  requireRelease(sql.startsWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;')&&/COMMIT;\s*$/.test(sql),
    'AMORA_WRITER_POST_READ_ONLY_SQL_REQUIRED');
  const token=process.env.SUPABASE_ACCESS_TOKEN;
  requireRelease(typeof token==='string'&&/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token),'AMORA_WRITER_POST_CREDENTIAL_UNAVAILABLE');
  const remaining=Math.min(45000,Date.parse(deadline)-Date.now());
  requireRelease(Number.isFinite(remaining)&&remaining>0,'AMORA_WRITER_POST_EXPIRED');
  const signal=AbortSignal.timeout(Math.floor(remaining));
  try{
    // Management의 full-stats postgres role만 요청한다. 실제 SQL은 무조건 READ ONLY다.
    const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:sql,read_only:false}),signal});
    return await readAmoraWriterRetirementBoundedJsonResponse(response,{signal});
  }catch{throw new CurrentBaselineBlocked('AMORA_WRITER_POST_READ_ONLY_TRANSPORT_UNAVAILABLE');}
}

async function revalidate(state){
  requireRelease(Date.now()<Date.parse(state.deadline),'AMORA_WRITER_POST_EXPIRED');
  same(hashes(state.repoRoot),state.sourceHashes,'AMORA_WRITER_POST_SOURCE_CHANGED');
  loadAmoraWriterRetirementPlan({repoRoot:state.repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  // 새 native assertion은 linked archive의 실제 DPAPI/ACL/journal/source도 한 번 재검증한다.
  await state.nativeApi.assertAmoraWriterRetirementArchivedNativeRecovery(state.native,
    {repoRoot:state.repoRoot,expectedCommit:state.expectedCommit,archive:state.archive});
  await assertAmoraWriterRetirementAdmission({proof:state.admission,repoRoot:state.repoRoot,expectedCommit:state.expectedCommit,
    forOperationalUse:true});
  requireRelease(Date.now()<Date.parse(state.deadline),'AMORA_WRITER_POST_EXPIRED');
  same(hashes(state.repoRoot),state.sourceHashes,'AMORA_WRITER_POST_SOURCE_CHANGED');
}

const pipelineError=(error,stage)=>{
  if(error instanceof CurrentBaselineBlocked)return error;
  const candidate=typeof error?.message==='string'?error.message.split(':')[0]:'';
  return new CurrentBaselineBlocked(/^AMORA_WRITER_[A-Z0-9_]+$/.test(candidate)
    ?candidate:`AMORA_WRITER_POST_${stage}_UNAVAILABLE`);
};

/** 이미 COMMIT된 상태의 새 기본 수집 계보다. SQL/clock/callback/옛 proof를 호출자가 공급할 수 없다. */
export async function runAmoraWriterRetirementPostCommitVerification(input){
  keys(input,['repoRoot','expectedCommit','operatorConfirmation','recoveryId','archiveSourceCommit','expectedArtifactSha256']);
  const {repoRoot,expectedCommit,operatorConfirmation,recoveryId,archiveSourceCommit,expectedArtifactSha256}=input;
  requireRelease(typeof repoRoot==='string'&&typeof expectedCommit==='string'&&/^[a-f0-9]{40}$/.test(expectedCommit)
    &&archiveSourceCommit==='68f9d94a3263ef922f2aabbde7541fb85b37853e'
    &&typeof recoveryId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(recoveryId)
    &&isSha(expectedArtifactSha256)&&operatorConfirmation===`${RELEASE}:${PROJECT}:verify-committed:${expectedCommit}`,
  'AMORA_WRITER_POST_ARGUMENT_INVALID');
  let stage='SOURCE',archive,archiveApi;
  try{
  const sourceHashes=hashes(repoRoot),plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  archiveApi=await import('./amora-action-writer-retirement-archived-original.mjs');
  const nativeApi=await import('./amora-action-writer-retirement-archived-native.mjs');
  stage='ARCHIVE';
  archive=await archiveApi.collectAmoraWriterRetirementArchivedOriginal({repoRoot,expectedCommit,archiveSourceCommit,
    recoveryId,expectedArtifactSha256});
  // 비용이 큰 실제 로컬 복구는 새 CI admission의 120초 창을 시작하기 전에 완료한다.
  stage='NATIVE';
  const native=await nativeApi.runAmoraWriterRetirementArchivedNativeRecovery({repoRoot,expectedCommit,archive});
  stage='ADMISSION';
  const admission=await collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation});
  const deadline=new Date(Date.parse(admission.observedAt)+120000).toISOString();
  const state={repoRoot,expectedCommit,sourceHashes,archiveApi,nativeApi,archive,native,admission,deadline};
  stage='HISTORICAL_READ';
  const read=archiveApi.readAmoraWriterRetirementIssuedHistorical(archive,{repoRoot,expectedCommit});
  let historical,expectedObjectIds;
  try{historical=read.raw;expectedObjectIds=read.historicalOwn3ObjectIds;}finally{read.bytes.fill(0);}
  const observe=async cutoff=>{
    await revalidate(state);
    const sql=buildAmoraWriterRetirementCommittedObservationSql({repoRoot,cutoff,expectedNativeSystemIdentifier:null,expectedObjectIds});
    const rows=await fixedRead(sql,deadline);
    const value=validateAmoraWriterRetirementCommittedObservation(rows,{repoRoot,historical,cutoff,expectedNativeSystemIdentifier:null});
    await revalidate(state);return {rows,value,sqlSha256:sha(sql)};
  };
  stage='OBSERVE';
  const first=await observe(null),cutoff=first.value.serverCutoff;
  const cohort=createAmoraWriterRetirementCommittedCohort(first.rows[0].b2_committed_observation.managed,
    {cutoff,expectedNativeSystemIdentifier:null});
  let drain,current;stage='DRAIN';
  for(let attempt=0;attempt<6;attempt++){
    current=await observe(cutoff);
    try{drain=assertAmoraWriterRetirementCommittedDrained(current.rows[0].b2_committed_observation.managed,cohort,
      {expectedNativeSystemIdentifier:null});break;}
    catch(error){
      if(error.code!=='AMORA_WRITER_POST_DRAIN_REQUIRED'||attempt===5)throw error;
      requireRelease(Date.now()+1000<Date.parse(deadline),'AMORA_WRITER_POST_EXPIRED');await delay(1000);
    }
  }
  requireRelease(drain,'AMORA_WRITER_POST_DRAIN_REQUIRED');
  stage='FINAL_OBSERVE';
  const final=await observe(cutoff);
  assertAmoraWriterRetirementCommittedDrained(final.rows[0].b2_committed_observation.managed,cohort,
    {expectedNativeSystemIdentifier:null});
  for(const key of ['rawLedgerSha256','rawLedgerMd5','preservedCatalogSha256','rowsSha256'])
    same(final.value[key],first.value[key],'AMORA_WRITER_POST_FINAL_STATE_CHANGED');
  await revalidate(state);
  const proof=freeze({format:'amora-writer-retirement-issued-cold-postverified-v1',sourceCommit:expectedCommit,
    archiveSourceCommit,bundleSha256:plan.migration.sha256,archiveArtifactSha256:archive.artifactSha256,
    archiveApplyJournalSha256:archive.applyJournalSha256,archiveOriginalCapturedAt:archive.sourceObservedAt,
    archiveOriginalDeadline:archive.originalDeadline,archiveOriginalAuthorityRevived:false,priorApplyExecutionProvenanceReissued:false,
    ledgerCount:231,actualOperatingPost7Verified:true,original7ProtectedArchiveAndNewNativeReplayVerified:true,
    actualServerCutoff:cutoff,cohortMemberCount:cohort.members.length,nativeCompletedAt:native.completedAt,
    nativeCaptureDeadline:native.nativeCaptureDeadline,actualCohortDrainedVerified:true,own3AbsentAndPlainCatalogIndependentlyVerified:true,
    firstObservationSha256:first.value.observationSha256,finalObservationSha256:final.value.observationSha256,
    drainObservationSha256:drain.inventorySha256,transportReadOnlyFlag:false,sqlReadOnly:true,
    remoteSqlMutationsPerformed:false,operatingMutationAuthorized:false,entireDatabaseAuthStorageRecoveryVerified:false,
    releaseAuthorized:true,verifiedAt:new Date().toISOString(),deadline});
  completed.set(proof,state);return proof;
  }catch(error){
    if(archive)try{archiveApi.closeAmoraWriterRetirementArchivedOriginal(archive);}
    catch{throw new CurrentBaselineBlocked('AMORA_WRITER_POST_ARCHIVE_CLEANUP_UNAVAILABLE');}
    throw pipelineError(error,stage);
  }
}

/** 새 실제 default issuer의 동일-process proof만 승인한다. JSON/옛 완료 proof는 복원할 수 없다. */
export async function assertAmoraWriterRetirementIssuedPostCommitVerification(input){
  keys(input,['proof','repoRoot','expectedCommit']);
  const state=completed.get(input.proof);
  requireRelease(state&&state.repoRoot===input.repoRoot&&state.expectedCommit===input.expectedCommit,
    'AMORA_WRITER_POST_COMPLETE_NOT_ISSUED');
  await revalidate(state);return input.proof;
}

/** CLI의 최종 검증/metadata 출력 뒤 원문 메모리를 지우고 proof를 무효화한다. 만료 갱신이나 DB 쓰기는 없다. */
export function disposeAmoraWriterRetirementPostCommitVerification(input){
  keys(input,['proof','repoRoot','expectedCommit']);
  const state=completed.get(input.proof);
  requireRelease(state&&state.repoRoot===input.repoRoot&&state.expectedCommit===input.expectedCommit,
    'AMORA_WRITER_POST_COMPLETE_NOT_ISSUED');
  try{state.archiveApi.closeAmoraWriterRetirementArchivedOriginal(state.archive);}finally{completed.delete(input.proof);}
}
