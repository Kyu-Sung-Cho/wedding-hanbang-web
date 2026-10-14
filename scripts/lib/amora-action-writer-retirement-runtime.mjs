import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {digest,same,requireRelease,CurrentBaselineBlocked} from './current-baseline-release-contract.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {collectAmoraWriterRetirementAdmission,assertAmoraWriterRetirementAdmission} from './amora-action-writer-retirement-admission.mjs';
import {runAmoraWriterRetirementRehearsalWithAdmission,assertAmoraWriterRetirementOperationalRollback} from './amora-action-writer-retirement-operational-rehearsal.mjs';
import {buildAmoraWriterRetirementObservationSql,validateAmoraWriterRetirementObservation} from './amora-action-writer-retirement-catalog.mjs';
import {buildAmoraWriterRetirementStageObservationSql,validateAmoraWriterRetirementStageObservation} from './amora-action-writer-retirement-stage.mjs';
import {buildAmoraWriterRetirementCommitSql,validateAmoraWriterRetirementCommitInside} from './amora-action-writer-retirement-transaction.mjs';
import {createAmoraWriterMaintenanceCohort,assertAmoraWriterMaintenanceDrained} from './amora-action-writer-retirement-maintenance.mjs';
import {buildAmoraWriterManagedInventorySql,validateAmoraWriterManagedInventory} from './amora-action-writer-retirement-managed-workers.mjs';
import {openAmoraWriterRetirementPrivateJournal,assertAmoraWriterRetirementPrivateJournal} from './amora-action-writer-retirement-private-journal.mjs';
import {readAmoraWriterRetirementBoundedJsonResponse} from './amora-action-writer-retirement-http.mjs';

const PROJECT='slrtobkksjmxgzatjyqb',SYSTEM='7581440907192989109',RELEASE='amora-action-writer-retirement-transport-20261013';
const postIssued=new WeakMap(),cutoffIssued=new WeakMap(),cohortIssued=new WeakMap(),finalIssued=new WeakMap();
const files=['runtime','operational-rehearsal','transaction','stage','managed-workers','managed-maintenance','maintenance',
  'admission','bundle','release-contract','catalog','privileges','recovery','original-source','original-capture','native-recovery',
  'private-store','private-journal','http'].map(name=>'scripts/lib/amora-action-writer-retirement-'+name+'.mjs');
const hashes=root=>files.map(file=>({file,sha256:digest(readFileSync(join(root,file)))}));
const keys=(value,names)=>requireRelease(value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===names.slice().sort().join(','),'AMORA_WRITER_RUNTIME_ARGUMENT_INVALID');
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const one=(value,alias)=>{
  requireRelease(Array.isArray(value)&&value.length===1&&value[0]&&Object.keys(value[0]).join(',')===alias,
    'AMORA_WRITER_RUNTIME_RESPONSE_INVALID');return value[0][alias];
};
async function query(sql,{transportReadOnlyFlag,sqlReadOnly,deadline}){
  requireRelease(typeof transportReadOnlyFlag==='boolean'&&typeof sqlReadOnly==='boolean'
    &&(!sqlReadOnly||sql.startsWith('BEGIN')&&/READ ONLY/.test(sql.slice(0,90))),
  'AMORA_WRITER_RUNTIME_TRANSPORT_INVALID');
  const token=process.env.SUPABASE_ACCESS_TOKEN;
  requireRelease(typeof token==='string'&&/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token),'AMORA_WRITER_RUNTIME_CREDENTIAL_UNAVAILABLE');
  const remaining=Math.min(45_000,Date.parse(deadline)-Date.now());
  requireRelease(Number.isFinite(remaining)&&remaining>0,'AMORA_WRITER_RUNTIME_EXPIRED');
  const signal=AbortSignal.timeout(Math.floor(remaining));
  try{
    const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:sql,read_only:transportReadOnlyFlag}),signal});
    return await readAmoraWriterRetirementBoundedJsonResponse(response,{signal});
  }catch{throw new CurrentBaselineBlocked('AMORA_WRITER_RUNTIME_TRANSPORT_UNAVAILABLE');}
}

/** The only default apply path. Caller callbacks/JSON evidence/native identity/clock overrides are not accepted. */
export async function runAmoraWriterRetirementApply(input){
  keys(input,['repoRoot','expectedCommit','operatorConfirmation']);
  const {repoRoot,expectedCommit,operatorConfirmation}=input;
  requireRelease(typeof repoRoot==='string'&&typeof expectedCommit==='string'&&/^[a-f0-9]{40}$/.test(expectedCommit)
    &&operatorConfirmation===`${RELEASE}:${PROJECT}:apply:${expectedCommit}`,'AMORA_WRITER_RUNTIME_ARGUMENT_INVALID');
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  const lifecycle=await import('./amora-action-writer-retirement-managed-maintenance.mjs');
  const sourceHashes=hashes(repoRoot);
  const admission=await collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation});
  const rollback=await runAmoraWriterRetirementRehearsalWithAdmission({repoRoot,expectedCommit,operatorConfirmation,admission});
  const original=await assertAmoraWriterRetirementOperationalRollback({proof:rollback,repoRoot,expectedCommit});
  const deadline=original.privateOriginal.deadline,before=original.before;
  let journal,installAttempted=false,commitAttempted=false,uninstallAttempted=false,post,cutoffProof,cohortProof;
  const record=(status,operation,transportReadOnlyFlag,sqlReadOnly,extra={})=>journal?.append({
    format:'amora-writer-retirement-original7-cutover-journal-v1',release:RELEASE,sourceCommit:expectedCommit,
    bundleSha256:plan.migration.sha256,originalFunctionCount:7,status,operation,transportReadOnlyFlag,sqlReadOnly,
    recordedAt:new Date().toISOString(),deadline,releaseAuthorized:false,automaticRetryProhibited:true,
    entireDatabaseAuthStorageRecoveryVerified:false,...extra});
  const revalidate=async()=>{
    await assertAmoraWriterRetirementOperationalRollback({proof:rollback,repoRoot,expectedCommit});
    same(hashes(repoRoot),sourceHashes,'AMORA_WRITER_RUNTIME_SOURCE_CHANGED');
    assertAmoraWriterRetirementPrivateJournal(journal);
    requireRelease(Date.now()<Date.parse(deadline),'AMORA_WRITER_RUNTIME_EXPIRED');
  };
  const observeStage=async(phase,cutoff=null,objectIds=null)=>{
    const sql=buildAmoraWriterRetirementStageObservationSql({repoRoot,phase,cutoff,expectedNativeSystemIdentifier:null});
    const rows=await query(sql,{transportReadOnlyFlag:false,sqlReadOnly:true,deadline});
    const value=validateAmoraWriterRetirementStageObservation(rows,{repoRoot,phase,cutoff,expectedNativeSystemIdentifier:null,
      beforeObservation:before,expectedObjectIds:objectIds});
    return {rows,value,sqlSha256:digest(sql)};
  };
  try{
    journal=openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId:original.privateOriginal.recoveryId,
      directory:original.privateOriginal.directory,mode:'apply'});
    record('inventory-intent','fixed-read-only-postgres-stats',false,true);
    const inventoryRows=await query(buildAmoraWriterManagedInventorySql(),{transportReadOnlyFlag:false,sqlReadOnly:true,deadline});
    const inventory=validateAmoraWriterManagedInventory(one(inventoryRows,'managed_inventory'));
    requireRelease(inventory.systemIdentifier===SYSTEM,'AMORA_WRITER_RUNTIME_IDENTITY_DRIFT');
    record('inventory-observed','fixed-read-only-postgres-stats',false,true,{inventorySha256:inventory.observationSha256,
      writersRetained:inventory.writerRows.length,knownNonTarget:inventory.nonTargetRows.length});
    const installSql=lifecycle.buildAmoraWriterManagedMaintenanceInstallSql();
    record('maintenance-install-intent','fixed-install-own3',false,false,{transactionSha256:digest(installSql)});
    await revalidate();installAttempted=true;
    const installedResponse=await query(installSql,{transportReadOnlyFlag:false,sqlReadOnly:false,deadline});
    const installed=one(installedResponse,'managed_maintenance_operation');
    requireRelease(installed&&installed.operation==='install'&&installed.systemIdentifier===SYSTEM
      &&installed.own3Installed===true,'AMORA_WRITER_RUNTIME_INSTALL_OUTCOME_UNKNOWN');
    const staged=await observeStage('before');await revalidate();
    record('maintenance-installed-and-independently-observed','fixed-read-only-postgres-stage',false,true,
      {stageSha256:staged.value.rawStageSha256,objectIds:staged.value.objectIds});
    const commitSql=buildAmoraWriterRetirementCommitSql({repoRoot,before,stageRows:staged.rows,
      objectIds:staged.value.objectIds,deadline,expectedNativeSystemIdentifier:null});
    record('commit-intent','fixed-single-commit',false,false,{transactionSha256:digest(commitSql)});
    await revalidate();commitAttempted=true;
    const committed=one(await query(commitSql,{transportReadOnlyFlag:false,sqlReadOnly:false,deadline}),'b2_commit_evidence');
    requireRelease(committed?.format==='amora-writer-retirement-original7-commit-inside-v1','AMORA_WRITER_RUNTIME_COMMIT_RESPONSE_INVALID');
    validateAmoraWriterRetirementCommitInside([{b2_commit_evidence:committed}],{repoRoot,before:{...staged.value.catalog,
      preservedCatalogSha256:staged.value.rawPreservedCatalogSha256}});
    const applied=await observeStage('after',null,staged.value.objectIds);await revalidate();
    post=Object.freeze({format:'amora-writer-retirement-issued-default-post7-v1',sourceCommit:expectedCommit,
      bundleSha256:plan.migration.sha256,original7Sha256:rollback.privateOriginalSha256,
      postStageSha256:applied.value.rawStageSha256,ledgerCount:231,rawLedgerMd5:applied.value.catalog.rawLedgerMd5,
      objectIds:applied.value.objectIds,actualOperatingPost7Verified:true,releaseAuthorized:false,verifiedAt:new Date().toISOString(),deadline});
    postIssued.set(post,{repoRoot,expectedCommit,admission,rollback,sourceHashes,before,applied});
    record('post7-and-231-independently-observed','fixed-read-only-postgres-stage',false,true,{postProofSha256:digest(JSON.stringify(post))});
    const cutoffSql=lifecycle.buildAmoraWriterManagedMaintenanceCutoffSql({repoRoot,postLedgerMd5:post.rawLedgerMd5,objectIds:post.objectIds});
    record('cutoff-intent','fixed-read-only-postgres-cutoff',false,true,{observationSha256:digest(cutoffSql)});
    await revalidate();
    const cutoff=one(await query(cutoffSql,{transportReadOnlyFlag:false,sqlReadOnly:true,deadline}),'maintenance_cutoff');
    keys(cutoff,['format','cutoff','systemIdentifier','executionProvenanceVerified','releaseAuthorized']);
    requireRelease(cutoff.format==='amora-writer-maintenance-cutoff-content-v1'&&cutoff.systemIdentifier===SYSTEM
      &&time(cutoff.cutoff)&&Date.parse(cutoff.cutoff)>Date.now()-120_000&&Date.parse(cutoff.cutoff)<=Date.now()+10_000
      &&cutoff.executionProvenanceVerified===false&&cutoff.releaseAuthorized===false,'AMORA_WRITER_RUNTIME_CUTOFF_INVALID');
    cutoffProof=Object.freeze({format:'amora-writer-retirement-issued-default-cutoff-v1',cutoff:cutoff.cutoff,
      systemIdentifier:SYSTEM,sourceCommit:expectedCommit,postProofSha256:digest(JSON.stringify(post)),
      objectIds:post.objectIds,defaultCutoffQuerySha256:digest(cutoffSql),deadline,releaseAuthorized:false});
    cutoffIssued.set(cutoffProof,{post,sourceHashes,repoRoot,expectedCommit});
    const cohortStage=await observeStage('after',cutoffProof.cutoff,post.objectIds);
    const cohort=createAmoraWriterMaintenanceCohort(cohortStage.value.projectedMaintenance);
    cohortProof=Object.freeze({format:'amora-writer-retirement-issued-default-cohort-v1',sourceCommit:expectedCommit,
      cutoff:cutoffProof.cutoff,cohortSha256:digest(JSON.stringify(cohort)),releaseAuthorized:false,deadline});
    cohortIssued.set(cohortProof,{post,cutoffProof,cohort,sourceHashes,repoRoot,expectedCommit});
    let drain;
    for(let attempt=0;attempt<6;attempt++){
      await revalidate();const current=attempt===0?cohortStage:await observeStage('after',cutoffProof.cutoff,post.objectIds);
      try{drain=assertAmoraWriterMaintenanceDrained(current.value.projectedMaintenance,cohort);break;}
      catch(error){if(!['AMORA_MAINTENANCE_DRAIN_REQUIRED','AMORA_MAINTENANCE_LATE_COHORT'].includes(error.message)||attempt===5)throw error;
        record('drain-pending','fixed-read-only-postgres-stage',false,true,{attempt:attempt+1});await delay(1000);}
    }
    requireRelease(drain,'AMORA_WRITER_RUNTIME_DRAIN_REQUIRED');await revalidate();
    requireRelease(postIssued.has(post)&&cutoffIssued.get(cutoffProof)?.post===post&&cohortIssued.get(cohortProof)?.cutoffProof===cutoffProof,
      'AMORA_WRITER_RUNTIME_LINEAGE_NOT_ISSUED');
    const uninstallSql=lifecycle.buildAmoraWriterManagedMaintenanceUninstallSql({repoRoot,postLedgerMd5:post.rawLedgerMd5,cohort});
    record('uninstall-intent','fixed-uninstall-own3',false,false,{transactionSha256:digest(uninstallSql),drainSha256:digest(JSON.stringify(drain))});
    await revalidate();uninstallAttempted=true;
    const removed=one(await query(uninstallSql,{transportReadOnlyFlag:false,sqlReadOnly:false,deadline}),'managed_maintenance_operation');
    requireRelease(removed?.operation==='uninstall'&&removed.systemIdentifier===SYSTEM&&removed.own3Absent===true,
      'AMORA_WRITER_RUNTIME_UNINSTALL_OUTCOME_UNKNOWN');
    const finalRows=await query(buildAmoraWriterRetirementObservationSql({repoRoot,phase:'after'}),
      {transportReadOnlyFlag:true,sqlReadOnly:true,deadline});
    const final=one(finalRows,'b2_observation');
    validateAmoraWriterRetirementObservation(final,{repoRoot,phase:'after',expectedNativeSystemIdentifier:null,beforeObservation:before});
    same(final.rawLedgerSha256,applied.value.catalog.rawLedgerSha256,'AMORA_WRITER_RUNTIME_FINAL_LEDGER_DRIFT');await revalidate();
    const proof=Object.freeze({format:'amora-writer-retirement-issued-complete-operating-v1',sourceCommit:expectedCommit,
      bundleSha256:plan.migration.sha256,ledgerCount:231,post7Verified:true,issuedDefaultCutoffVerified:true,
      actualCohortDrainedVerified:true,own3RemovedAndPlainCatalogIndependentlyVerified:true,
      original7PrivateNativeRecoveryLinked:true,releaseAuthorized:true,committedMutationObserved:true,
      entireDatabaseAuthStorageRecoveryVerified:false,verifiedAt:new Date().toISOString(),deadline});
    record('applied-drained-unfenced-and-independently-verified','fixed-read-only-final-post',true,true,{finalProofSha256:digest(JSON.stringify(proof))});
    finalIssued.set(proof,{post,cutoffProof,cohortProof,repoRoot,expectedCommit,sourceHashes});return proof;
  }catch(error){
    const code=typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'AMORA_WRITER_RUNTIME_BLOCKED';
    const operation=uninstallAttempted?'uninstall':commitAttempted?'commit':installAttempted?'install':'before-install';
    try{record('outcome-requires-independent-inspection',operation,operation==='before-install'?null:false,
      operation==='before-install'?null:false,{code,committedOutcomeUnknown:commitAttempted,maintenanceRemovalUnknown:uninstallAttempted});}catch{}
    const blocked=new CurrentBaselineBlocked(installAttempted?'AMORA_WRITER_RUNTIME_OUTCOME_REQUIRES_INSPECTION':code);
    Object.assign(blocked,{automaticRetryProhibited:installAttempted,releaseAuthorized:false,
      forwardFixOnlyAfterCommit:commitAttempted,recoveryId:original.privateOriginal.recoveryId,
      privateDirectory:original.privateOriginal.directory});throw blocked;
  }finally{journal?.close();}
}

export function assertAmoraWriterRetirementIssuedPost(proof){
  requireRelease(postIssued.has(proof),'AMORA_WRITER_RUNTIME_POST_NOT_ISSUED');return proof;
}
export function assertAmoraWriterRetirementIssuedCutoff(proof){
  requireRelease(cutoffIssued.has(proof),'AMORA_WRITER_RUNTIME_CUTOFF_NOT_ISSUED');return proof;
}
export function assertAmoraWriterRetirementIssuedCohort(proof){
  requireRelease(cohortIssued.has(proof),'AMORA_WRITER_RUNTIME_COHORT_NOT_ISSUED');return proof;
}
export function assertAmoraWriterRetirementIssuedComplete(proof){
  const state=finalIssued.get(proof);
  requireRelease(state,'AMORA_WRITER_RUNTIME_COMPLETE_NOT_ISSUED');
  requireRelease(Date.now()<Date.parse(proof.deadline),'AMORA_WRITER_RUNTIME_EXPIRED');
  same(hashes(state.repoRoot),state.sourceHashes,'AMORA_WRITER_RUNTIME_SOURCE_CHANGED');
  loadAmoraWriterRetirementPlan({repoRoot:state.repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  return proof;
}
