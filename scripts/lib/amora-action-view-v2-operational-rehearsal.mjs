import {createHash} from 'node:crypto';
import {CurrentBaselineBlocked,digest,digestJson,readAnchored,requireRelease,same} from './current-baseline-release-contract.mjs';
import {loadAmoraActionViewV2Plan} from './amora-action-view-v2-release-contract.mjs';
import {buildAmoraActionViewV2ObservationSql,validateAmoraActionViewV2Inspection} from './amora-action-view-v2-catalog.mjs';
import {buildAmoraActionViewV2RehearsalSql} from './amora-action-view-v2-rehearsal.mjs';
import {buildAmoraActionViewV2CommitSql,buildAmoraActionViewV2AppliedObservationSql,
  validateAmoraActionViewV2AppliedObservation} from './amora-action-view-v2-commit.mjs';
import {collectAmoraActionViewV2Admission,assertAmoraActionViewV2Admission} from './amora-action-view-v2-admission.mjs';
import {captureAmoraActionViewV2PrivateOriginal,readAmoraActionViewV2PrivateOriginal} from './amora-action-view-v2-original-capture.mjs';
import {runAmoraActionViewV2NativeRecovery,assertAmoraActionViewV2NativeRecovery} from './amora-action-view-v2-native-recovery.mjs';
import {openAmoraActionViewV2PrivateJournal,assertAmoraActionViewV2PrivateJournal} from './amora-action-view-v2-private-journal.mjs';

const PROJECT='slrtobkksjmxgzatjyqb',RELEASE='amora-action-view-v2-20261012';
const files=['scripts/lib/amora-action-view-v2-operational-rehearsal.mjs','scripts/lib/amora-action-view-v2-release.mjs',
  'scripts/lib/amora-action-view-v2-admission.mjs','scripts/lib/amora-action-view-v2-release-contract.mjs',
  'scripts/lib/amora-action-view-v2-catalog.mjs','scripts/lib/amora-action-view-v2-ledger.mjs',
  'scripts/lib/amora-action-view-v2-rehearsal.mjs','scripts/lib/amora-action-view-v2-commit.mjs',
  'scripts/lib/amora-action-view-v2-original-capture.mjs',
  'scripts/lib/amora-action-view-v2-native-recovery.mjs','scripts/lib/amora-action-view-v2-recovery.mjs',
  'scripts/lib/amora-action-view-v2-private-store.mjs','scripts/amora-action-view-v2-private-store.ps1',
  'scripts/lib/amora-action-view-v2-private-journal.mjs','scripts/amora-action-view-v2-private-journal.ps1',
  'scripts/amora-db-backup-common.ps1'];
const sourceHashes=root=>files.map(file=>({file,sha256:digest(readAnchored(root,file))}));
const fail=code=>{throw new CurrentBaselineBlocked(code);};
async function managementQuery(sql,{readOnly,operation}) {
  requireRelease(typeof readOnly==='boolean'&&(readOnly||['unconditional-rollback','fixed-commit'].includes(operation)),
    'AMORA_VIEW_V2_REHEARSAL_TRANSPORT_INVALID');
  const token=process.env.SUPABASE_ACCESS_TOKEN;
  requireRelease(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token??''),'AMORA_VIEW_V2_CREDENTIAL_UNAVAILABLE');
  try {
    const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:sql,read_only:readOnly}),signal:AbortSignal.timeout(45_000)});
    requireRelease(response.ok,'AMORA_VIEW_V2_REHEARSAL_TRANSPORT_UNAVAILABLE');
    const raw=await response.text();
    requireRelease(Buffer.byteLength(raw)<=256*1024,'AMORA_VIEW_V2_REHEARSAL_TRANSPORT_UNAVAILABLE');
    return JSON.parse(raw);
  } catch {fail('AMORA_VIEW_V2_REHEARSAL_TRANSPORT_UNAVAILABLE');}
}
function sameObservedState(left,right) {
  for(const key of ['systemIdentifier','target','rows','preservedCatalogMd5','ledger','ledgerMd5'])
    same(left[key],right[key],'AMORA_VIEW_V2_REHEARSAL_INDEPENDENT_STATE_DRIFT');
}
function insideEvidence(rows,plan) {
  requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]?.rehearsal_evidence,
    'AMORA_VIEW_V2_REHEARSAL_INSIDE_INVALID');
  const inside=rows[0].rehearsal_evidence;
  same(Object.keys(inside).sort(),['format','ledgerEntry','rawSqlMatches','target','version'],
    'AMORA_VIEW_V2_REHEARSAL_INSIDE_INVALID');
  requireRelease(inside.format==='amora-action-view-v2-synthetic-rehearsal-inside-v1'
    &&inside.version===plan.migration.version&&inside.rawSqlMatches===true,
  'AMORA_VIEW_V2_REHEARSAL_INSIDE_INVALID');
  same(inside.target,plan.catalogFixture.applied,'AMORA_VIEW_V2_REHEARSAL_INSIDE_INVALID');
  same(inside.ledgerEntry,{version:plan.migration.version,name:plan.migration.name,statementCount:1,
    sqlMd5:createHash('md5').update(plan.sql).digest('hex'),statementsSha256:digest(JSON.stringify([plan.sql]))},
  'AMORA_VIEW_V2_REHEARSAL_INSIDE_INVALID');
  return inside;
}

/** 실제 CLI는 source/CI/private/native gate 뒤 ROLLBACK을 먼저 확인한다. 적용도 고정 COMMIT 하나뿐이다. */
export async function runAmoraActionViewV2OperationalRehearsal(input) {
  requireRelease(input&&typeof input==='object'&&!Array.isArray(input)
    &&Object.keys(input).every(key=>['repoRoot','options','query','runCommand','environment','assertSource'].includes(key)),
  'AMORA_VIEW_V2_REHEARSAL_ARGUMENT_INVALID');
  const {repoRoot,options,query:injectedQuery,runCommand,environment,assertSource}=input;
  requireRelease(options?.selected===true&&['rehearse','apply'].includes(options.mode)&&options['project-ref']===PROJECT
    &&/^[a-f0-9]{40}$/.test(options['expected-commit']??'')
    &&options['confirm-production']===`${RELEASE}:${PROJECT}:${options.mode}:${options['expected-commit']}`
    &&options['receipt-out']==='private-store/'+(options.mode==='apply'?'apply':'rehearsal')+'.jsonl',
  'AMORA_VIEW_V2_REHEARSAL_ARGUMENT_INVALID');
  const apply=options.mode==='apply';
  const offline=injectedQuery!==undefined||runCommand!==undefined||environment!==undefined||assertSource!==undefined;
  // 합성 source/CI와 실제 기본 DB transport를 섞어 운영 gate를 우회할 수 없다.
  requireRelease(!offline||typeof injectedQuery==='function','AMORA_VIEW_V2_OFFLINE_QUERY_REQUIRED');
  const query=injectedQuery??managementQuery,expectedCommit=options['expected-commit'];
  const plan=loadAmoraActionViewV2Plan(repoRoot),hashes=sourceHashes(repoRoot);
  const admission=await collectAmoraActionViewV2Admission({repoRoot,expectedCommit,
    operatorConfirmation:options['confirm-production'],...(runCommand?{runCommand}:{}),...(environment?{environment}:{})});
  const observe=async()=>{
    const rows=await query(buildAmoraActionViewV2ObservationSql(),{readOnly:true});
    requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]?.observation,'AMORA_VIEW_V2_OBSERVATION_INVALID');
    return validateAmoraActionViewV2Inspection(rows[0].observation,{plan,repoRoot,now:new Date()});
  };
  let capture,journal,mutationStarted=false,bytes;
  const binding={format:'amora-action-view-v2-runtime-rehearsal-v1',release:RELEASE,projectRef:PROJECT,
    sourceCommit:expectedCommit,contractSha256:plan.contractSha256,sqlSha256:plan.sqlSha256,
    candidateSha256:plan.candidateSha256,sourceHashes:hashes,mode:options.mode,
    operatorAuthorization:'scoped-operator-confirmation',separatePrivateOwnerSignatureVerified:false,
    systemBoundariesSimulated:offline,releaseAuthorized:false,productionApplyImplemented:apply};
  const record=(status,extra={})=>journal?.append({...binding,status,recordedAt:new Date().toISOString(),...extra});
  try {
    const before=await observe();
    capture=await captureAmoraActionViewV2PrivateOriginal({repoRoot,expectedCommit,before,query,
      ...(assertSource?{assertSource}:{})});
    let original=readAmoraActionViewV2PrivateOriginal(capture,{repoRoot,expectedCommit});bytes=original.bytes;
    const native=await runAmoraActionViewV2NativeRecovery({repoRoot,bytes,contentReceipt:original.contentReceipt,
      expectedArtifactSha256:capture.artifactSha256,expectedCommit,
      expectedCollectorSha256:capture.collectorSourceSha256,deadline:original.deadline});
    bytes.fill(0);bytes=undefined;
    assertAmoraActionViewV2NativeRecovery({receipt:native,artifactSha256:capture.artifactSha256,forOperationalUse:!offline});
    const fresh=await observe();sameObservedState(fresh,before);
    original=readAmoraActionViewV2PrivateOriginal(capture,{repoRoot,expectedCommit});bytes=original.bytes;
    requireRelease(digest(bytes)===native.artifactSha256,'AMORA_VIEW_V2_REHEARSAL_RECOVERY_CHANGED');
    bytes.fill(0);bytes=undefined;
    const deadline=capture.deadline;
    journal=openAmoraActionViewV2PrivateJournal({repoRoot,recoveryId:capture.recoveryId,directory:capture.directory,mode:options.mode});
    const sql=buildAmoraActionViewV2RehearsalSql({repoRoot,before:fresh,
      expectedSystemIdentifier:plan.contract.systemIdentifier,deadline});
    record('rehearsal-intent',{observationSha256:digestJson(fresh),observationRecordedAt:fresh.observedAt,
      recoveryArtifactSha256:capture.artifactSha256,recoveryId:capture.recoveryId,
      encryptedArtifactSha256:capture.privateReceipt.encryptedSha256,collectorSourceSha256:capture.collectorSourceSha256,
      recoveryVerifierSha256:native.verifierSha256,nativeExecutorSha256:native.executorSha256,
      nativeSystemIdentifier:native.actualNativeSystemIdentifier,nativeReplaySqlSha256:native.nativeReplaySqlSha256,
      journalScope:'metadata-only',transactionSha256:digest(sql),deadline,
      scopedOriginalRecoveryVerified:true,entireDatabaseAuthStorageRecoveryVerified:false,
      sourceCiAdmissionSha256:digestJson(admission)});
    await assertAmoraActionViewV2Admission({proof:admission,repoRoot,expectedCommit,forOperationalUse:!offline});
    const checked=readAmoraActionViewV2PrivateOriginal(capture,{repoRoot,expectedCommit});
    checked.bytes.fill(0);
    assertAmoraActionViewV2NativeRecovery({receipt:native,artifactSha256:capture.artifactSha256,forOperationalUse:!offline});
    assertAmoraActionViewV2PrivateJournal(journal);
    same(sourceHashes(repoRoot),hashes,'AMORA_VIEW_V2_REHEARSAL_SOURCE_CHANGED');
    requireRelease(Date.now()<Date.parse(deadline),'AMORA_VIEW_V2_REHEARSAL_EXPIRED');
    mutationStarted=true;
    const response=await query(sql,{readOnly:false,operation:'unconditional-rollback',deadline});
    const inside=insideEvidence(response,plan);
    record('rollback-response-validated',{insideEvidenceSha256:digestJson(inside),mutationRequestSent:true});
    const after=await observe();sameObservedState(after,fresh);
    await assertAmoraActionViewV2Admission({proof:admission,repoRoot,expectedCommit,forOperationalUse:!offline});
    const finalOriginal=readAmoraActionViewV2PrivateOriginal(capture,{repoRoot,expectedCommit});
    finalOriginal.bytes.fill(0);
    same(sourceHashes(repoRoot),hashes,'AMORA_VIEW_V2_REHEARSAL_SOURCE_CHANGED');
    assertAmoraActionViewV2PrivateJournal(journal);
    if(apply) {
      record('rehearsal-independently-rolled-back',{afterObservationSha256:digestJson(after),
        independentReobservationVerified:true,committedMutationObserved:false});
      const commitSql=buildAmoraActionViewV2CommitSql({repoRoot,before:after,
        expectedSystemIdentifier:plan.contract.systemIdentifier,deadline});
      record('commit-intent',{transactionSha256:digest(commitSql),deadline,
        predecessorObservationSha256:digestJson(after),automaticRetryProhibited:true});
      await assertAmoraActionViewV2Admission({proof:admission,repoRoot,expectedCommit,forOperationalUse:!offline});
      const commitOriginal=readAmoraActionViewV2PrivateOriginal(capture,{repoRoot,expectedCommit});
      commitOriginal.bytes.fill(0);
      assertAmoraActionViewV2NativeRecovery({receipt:native,artifactSha256:capture.artifactSha256,forOperationalUse:!offline});
      assertAmoraActionViewV2PrivateJournal(journal);
      same(sourceHashes(repoRoot),hashes,'AMORA_VIEW_V2_REHEARSAL_SOURCE_CHANGED');
      requireRelease(Date.now()<Date.parse(deadline),'AMORA_VIEW_V2_REHEARSAL_EXPIRED');
      const committedResponse=await query(commitSql,{readOnly:false,operation:'fixed-commit',deadline});
      const committedInside=insideEvidence(committedResponse,plan);
      record('commit-response-validated',{insideEvidenceSha256:digestJson(committedInside),automaticRetryProhibited:true});
      const appliedRows=await query(buildAmoraActionViewV2AppliedObservationSql(),{readOnly:true});
      requireRelease(Array.isArray(appliedRows)&&appliedRows.length===1&&appliedRows[0]?.observation,
        'AMORA_VIEW_V2_APPLY_POST_OBSERVATION_INVALID');
      const applied=appliedRows[0].observation;
      validateAmoraActionViewV2AppliedObservation({repoRoot,before:after,after:applied,deadline});
      await assertAmoraActionViewV2Admission({proof:admission,repoRoot,expectedCommit,forOperationalUse:!offline});
      const appliedOriginal=readAmoraActionViewV2PrivateOriginal(capture,{repoRoot,expectedCommit});
      appliedOriginal.bytes.fill(0);
      same(sourceHashes(repoRoot),hashes,'AMORA_VIEW_V2_REHEARSAL_SOURCE_CHANGED');
      assertAmoraActionViewV2PrivateJournal(journal);
      const status=offline?'offline-applied-and-independently-verified-scoped':'applied-and-independently-verified-scoped';
      record(status,{afterObservationSha256:digestJson(applied),independentReobservationVerified:true,
        committedMutationObserved:true,automaticRetryProhibited:true,remoteWritesAttempted:!offline,
        oldWriterRetirementIncluded:false,entireDatabaseAuthStorageRecoveryVerified:false});
      return {status,recoveryId:capture.recoveryId,privateDirectory:capture.directory,
        journalSha256:journal.verify().sha256,productionApplyImplemented:true,releaseAuthorized:!offline,
        operationalEvidenceVerified:!offline,committedMutationObserved:true,remoteWritesAttempted:!offline,
        oldWriterRetirementIncluded:false,entireDatabaseAuthStorageRecoveryVerified:false};
    }
    const status=offline?'offline-rehearsed-and-rolled-back-scoped':'rehearsed-and-rolled-back-scoped';
    record(status,{afterObservationSha256:digestJson(after),independentReobservationVerified:true,
      committedMutationObserved:false,automaticRetryProhibited:false,remoteWritesAttempted:!offline});
    return {status,recoveryId:capture.recoveryId,privateDirectory:capture.directory,
      journalSha256:journal.verify().sha256,productionApplyImplemented:false,releaseAuthorized:false,
      operationalEvidenceVerified:!offline,committedMutationObserved:false,remoteWritesAttempted:!offline,
      entireDatabaseAuthStorageRecoveryVerified:false};
  } catch(error) {
    const code=/^[A-Z0-9_]+$/.test(error?.code??'')?error.code:'AMORA_VIEW_V2_REHEARSAL_UNEXPECTED';
    const status=mutationStarted?(apply?'apply-outcome-requires-inspection':'rehearsal-outcome-requires-inspection')
      :'rehearsal-blocked-before-mutation';
    try {record(status,{code,automaticRetryProhibited:mutationStarted,remoteWritesAttempted:mutationStarted&&!offline});}
    catch { /* 발송 후 기록 실패도 성공으로 바꾸지 않는다. 원래 private intent를 보존한다. */ }
    const blocked=new CurrentBaselineBlocked(mutationStarted?(apply?'AMORA_VIEW_V2_APPLY_OUTCOME_REQUIRES_INSPECTION'
      :'AMORA_VIEW_V2_REHEARSAL_OUTCOME_REQUIRES_INSPECTION'):code);
    Object.assign(blocked,{automaticRetryProhibited:mutationStarted,remoteWritesAttempted:mutationStarted&&!offline,
      ...(capture?{recoveryId:capture.recoveryId,privateDirectory:capture.directory}:{})});throw blocked;
  } finally {bytes?.fill(0);journal?.close();}
}
