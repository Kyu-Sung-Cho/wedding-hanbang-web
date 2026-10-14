import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,same,requireRelease,CurrentBaselineBlocked} from './current-baseline-release-contract.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {collectAmoraWriterRetirementAdmission,assertAmoraWriterRetirementAdmission} from './amora-action-writer-retirement-admission.mjs';
import {buildAmoraWriterRetirementObservationSql,validateAmoraWriterRetirementObservation} from './amora-action-writer-retirement-catalog.mjs';
import {captureAmoraWriterRetirementPrivateOriginal} from './amora-action-writer-retirement-original-capture.mjs';
import {runAmoraWriterRetirementNativeRecovery,assertAmoraWriterRetirementNativeRecovery} from './amora-action-writer-retirement-native-recovery.mjs';
import {openAmoraWriterRetirementPrivateJournal,assertAmoraWriterRetirementPrivateJournal} from './amora-action-writer-retirement-private-journal.mjs';
import {buildAmoraWriterRetirementRehearsalSql,validateAmoraWriterRetirementRehearsalInside} from './amora-action-writer-retirement-transaction.mjs';
import {readAmoraWriterRetirementBoundedJsonResponse} from './amora-action-writer-retirement-http.mjs';

const PROJECT='slrtobkksjmxgzatjyqb',RELEASE='amora-action-writer-retirement-transport-20261013';
const issued=new WeakMap();
const files=['operational-rehearsal','admission','release-contract','bundle','catalog','privileges','original-capture',
  'original-source','recovery','state','native-recovery','private-store','private-journal','transaction','http']
  .map(name=>'scripts/lib/amora-action-writer-retirement-'+name+'.mjs');
const hashes=root=>files.map(file=>({file,sha256:digest(readFileSync(join(root,file)))}));
const requireKeys=(value,keys)=>requireRelease(value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===keys.slice().sort().join(','),'AMORA_WRITER_REHEARSAL_ARGUMENT_INVALID');
export function amoraWriterRetirementRehearsalRecordTransport(status){
  const write=['rehearsal-intent','rollback-response-validated','rehearsal-outcome-requires-inspection'];
  if(write.includes(status))return Object.freeze({transportReadOnlyFlag:false,sqlReadOnly:false});
  if(status==='rehearsed-and-independently-rolled-back-original7')return Object.freeze({transportReadOnlyFlag:true,sqlReadOnly:true});
  requireRelease(status==='blocked-before-transaction','AMORA_WRITER_REHEARSAL_RECORD_OPERATION_INVALID');
  return Object.freeze({transportReadOnlyFlag:null,sqlReadOnly:null});
}
const preserved=(left,right)=>{
  for(const key of ['rows','preservedCatalogSha256','ledger','rawLedgerSha256','rawLedgerMd5'])
    same(left[key],right[key],'AMORA_WRITER_REHEARSAL_INDEPENDENT_STATE_DRIFT');
};
async function defaultQuery(sql,{readOnly,operation,deadline}){
  requireRelease(typeof readOnly==='boolean'&&(readOnly===true||operation==='fixed-unconditional-rollback'),
    'AMORA_WRITER_REHEARSAL_TRANSPORT_INVALID');
  const token=process.env.SUPABASE_ACCESS_TOKEN;
  requireRelease(typeof token==='string'&&/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token),'AMORA_WRITER_REHEARSAL_CREDENTIAL_UNAVAILABLE');
  const remaining=deadline===null?45_000:Math.min(45_000,Date.parse(deadline)-Date.now());
  requireRelease(Number.isFinite(remaining)&&remaining>0,'AMORA_WRITER_REHEARSAL_EXPIRED');
  const signal=AbortSignal.timeout(Math.floor(remaining));
  try{
    const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:sql,read_only:readOnly}),signal});
    return await readAmoraWriterRetirementBoundedJsonResponse(response,{signal});
  }catch{throw new CurrentBaselineBlocked('AMORA_WRITER_REHEARSAL_TRANSPORT_UNAVAILABLE');}
}

/** Default-only actual source/CI/private/native/transport path. No injected query/clock/Boolean evidence is accepted. */
export async function runAmoraWriterRetirementOperationalRehearsal(input){
  requireKeys(input,['repoRoot','expectedCommit','operatorConfirmation']);
  const {repoRoot,expectedCommit,operatorConfirmation}=input;
  requireRelease(typeof repoRoot==='string'&&typeof expectedCommit==='string'&&/^[a-f0-9]{40}$/.test(expectedCommit)
    &&operatorConfirmation===`${RELEASE}:${PROJECT}:rehearse:${expectedCommit}`,'AMORA_WRITER_REHEARSAL_ARGUMENT_INVALID');
  const admission=await collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation});
  return executeRehearsal(input,admission);
}
/** Apply includes the mandatory rollback step. Only the same genuinely issued apply admission can be reused. */
export async function runAmoraWriterRetirementRehearsalWithAdmission(input){
  requireKeys(input,['repoRoot','expectedCommit','operatorConfirmation','admission']);
  const {repoRoot,expectedCommit,operatorConfirmation,admission}=input;
  requireRelease(operatorConfirmation===`${RELEASE}:${PROJECT}:apply:${expectedCommit}`
    &&admission?.operatorConfirmation===operatorConfirmation,'AMORA_WRITER_REHEARSAL_ARGUMENT_INVALID');
  await assertAmoraWriterRetirementAdmission({proof:admission,repoRoot,expectedCommit});
  return executeRehearsal({repoRoot,expectedCommit,operatorConfirmation},admission);
}
async function executeRehearsal({repoRoot,expectedCommit,operatorConfirmation},admission){
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE}),sourceHashes=hashes(repoRoot);
  const observe=async()=>{
    const rows=await defaultQuery(buildAmoraWriterRetirementObservationSql({repoRoot,phase:'before'}),
      {readOnly:true,operation:'fixed-catalog-read-only',deadline:null});
    requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]?.b2_observation,'AMORA_WRITER_REHEARSAL_OBSERVATION_INVALID');
    const raw=rows[0].b2_observation;
    validateAmoraWriterRetirementObservation(raw,{repoRoot,phase:'before',expectedNativeSystemIdentifier:null,beforeObservation:null});
    return raw;
  };
  let privateOriginal,native,journal,before,transactionStarted=false;
  const record=(status,extra={})=>journal?.append({format:'amora-writer-retirement-original7-operational-rehearsal-v1',
    release:RELEASE,sourceCommit:expectedCommit,bundleSha256:plan.migration.sha256,status,recordedAt:new Date().toISOString(),
    originalFunctionCount:7,...amoraWriterRetirementRehearsalRecordTransport(status),
    releaseAuthorized:false,entireDatabaseAuthStorageRecoveryVerified:false,...extra});
  const revalidate=async()=>{
    // 같은 실제 native proof의 private 원본 재검사가 그 원본의 admission까지 재검사한다.
    // 별도 proof를 발급하거나 동일 파일·Git 계보를 세 번 반복 조회하지 않는다.
    await assertAmoraWriterRetirementNativeRecovery({receipt:native,artifactSha256:privateOriginal.artifactSha256});
    same(hashes(repoRoot),sourceHashes,'AMORA_WRITER_REHEARSAL_SOURCE_CHANGED');
    assertAmoraWriterRetirementPrivateJournal(journal);
    requireRelease(Date.now()<Date.parse(privateOriginal.deadline),'AMORA_WRITER_REHEARSAL_EXPIRED');
  };
  try{
    before=await observe();
    privateOriginal=await captureAmoraWriterRetirementPrivateOriginal({repoRoot,expectedCommit,before,admission});
    native=await runAmoraWriterRetirementNativeRecovery({repoRoot,expectedCommit,privateOriginal});
    journal=openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId:privateOriginal.recoveryId,directory:privateOriginal.directory,mode:'rehearse'});
    const fresh=await observe();preserved(fresh,before);
    const sql=buildAmoraWriterRetirementRehearsalSql({repoRoot,before:fresh,deadline:privateOriginal.deadline,expectedNativeSystemIdentifier:null});
    record('rehearsal-intent',{beforeObservationSha256:digest(JSON.stringify(fresh)),artifactSha256:privateOriginal.artifactSha256,
      collectorSha256:privateOriginal.collectorSourceSha256,nativeExecutorSha256:native.executorSha256,
      transactionSha256:digest(sql),deadline:privateOriginal.deadline,automaticRetryProhibited:true,
      scopedNativeOriginal7Verified:true,productionRecoveryAuthorized:false});
    await revalidate();transactionStarted=true;
    const inside=await defaultQuery(sql,{readOnly:false,operation:'fixed-unconditional-rollback',deadline:privateOriginal.deadline});
    const content=validateAmoraWriterRetirementRehearsalInside(inside,{repoRoot,before:fresh});
    record('rollback-response-validated',{insideSha256:content.insideSha256,automaticRetryProhibited:true});
    const after=await observe();preserved(after,fresh);await revalidate();
    const proof=Object.freeze({format:'amora-writer-retirement-issued-operational-rollback-v1',
      scope:'original7-canonical-update-acl-newguard2-unconditionally-rolled-back',sourceCommit:expectedCommit,
      bundleSha256:plan.migration.sha256,privateOriginalSha256:privateOriginal.artifactSha256,
      sourceCiAdmissionVerified:true,privateOriginal7Linked:true,nativeOriginal7ReplayVerified:true,
      actualRollbackResponseVerified:true,independent230ReobservationVerified:true,actualOperating230Verified:true,
      verifiedAt:new Date().toISOString(),deadline:privateOriginal.deadline,releaseAuthorized:false,
      committedMutationObserved:false,maintenanceInstalled:false,transportReadOnlyFlag:false,sqlReadOnly:false,
      entireDatabaseAuthStorageRecoveryVerified:false});
    record('rehearsed-and-independently-rolled-back-original7',{rollbackProofSha256:digest(JSON.stringify(proof)),
      independent230ReobservationVerified:true,automaticRetryProhibited:true});
    issued.set(proof,{repoRoot,expectedCommit,admission,privateOriginal,native,sourceHashes,before:fresh,after});
    return proof;
  }catch(error){
    const code=typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'AMORA_WRITER_REHEARSAL_BLOCKED';
    try{record(transactionStarted?'rehearsal-outcome-requires-inspection':'blocked-before-transaction',
      {code,automaticRetryProhibited:transactionStarted,committedMutationObserved:false});}catch{}
    const blocked=new CurrentBaselineBlocked(transactionStarted?'AMORA_WRITER_REHEARSAL_OUTCOME_REQUIRES_INSPECTION':code);
    Object.assign(blocked,{automaticRetryProhibited:transactionStarted,releaseAuthorized:false,
      ...(privateOriginal?{recoveryId:privateOriginal.recoveryId,privateDirectory:privateOriginal.directory}:{})});throw blocked;
  }finally{journal?.close();}
}

export async function assertAmoraWriterRetirementOperationalRollback({proof,repoRoot,expectedCommit}){
  const state=issued.get(proof);
  requireRelease(state&&state.repoRoot===repoRoot&&state.expectedCommit===expectedCommit,'AMORA_WRITER_REHEARSAL_NOT_ISSUED');
  // Operating native assertion rechecks its actual linked private original, including that original's same admission.
  // Do not collect or assert a second CI proof or read the same private bytes twice.
  await assertAmoraWriterRetirementNativeRecovery({receipt:state.native,artifactSha256:state.privateOriginal.artifactSha256});
  same(hashes(repoRoot),state.sourceHashes,'AMORA_WRITER_REHEARSAL_SOURCE_CHANGED');
  requireRelease(Date.now()<Date.parse(proof.deadline),'AMORA_WRITER_REHEARSAL_EXPIRED');
  return {proof,admission:state.admission,privateOriginal:state.privateOriginal,native:state.native,before:state.after};
}
