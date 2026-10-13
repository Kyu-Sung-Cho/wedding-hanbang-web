import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,same,requireRelease} from './current-baseline-release-contract.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {assertAmoraWriterRetirementAdmission} from './amora-action-writer-retirement-admission.mjs';
import {validateAmoraWriterRetirementObservation} from './amora-action-writer-retirement-catalog.mjs';
import {buildAmoraWriterRetirementRecoveryCaptureSql,validateAmoraWriterRetirementRecoveryCapsule} from './amora-action-writer-retirement-recovery.mjs';
import {createAmoraWriterRetirementPrivateStore,assertAmoraWriterRetirementPrivateStoreIssued} from './amora-action-writer-retirement-private-store.mjs';
import {readAmoraWriterRetirementBoundedJsonResponse} from './amora-action-writer-retirement-http.mjs';

const issued=new WeakMap();
const sourceSha=()=>digest(readFileSync(new URL(import.meta.url)));
const files=['scripts/lib/amora-action-writer-retirement-original-capture.mjs','scripts/lib/amora-action-writer-retirement-recovery.mjs',
  'scripts/lib/amora-action-writer-retirement-original-source.mjs','scripts/lib/amora-action-writer-retirement-state.mjs',
  'scripts/lib/amora-action-writer-retirement-private-store.mjs','scripts/amora-action-writer-retirement-private-store.ps1',
  'scripts/lib/amora-action-writer-retirement-release-contract.mjs','scripts/lib/amora-action-writer-retirement-bundle.mjs',
  'scripts/lib/amora-action-writer-retirement-catalog.mjs','scripts/lib/amora-action-writer-retirement-privileges.mjs',
  'scripts/lib/amora-action-writer-retirement-admission.mjs','scripts/lib/amora-action-writer-retirement-http.mjs','scripts/amora-db-backup-common.ps1'];
const hashes=root=>files.map(file=>({file,sha256:digest(readFileSync(join(root,file)))}));
const sourceBinding=async(admission,repoRoot,expectedCommit)=>{
  // 반환 JSON이 아니라 실제 발급된 운영 admission을 매번 재검사한다.
  const verified=await assertAmoraWriterRetirementAdmission({proof:admission,repoRoot,expectedCommit});
  return Object.freeze({commit:verified.sourceCommit,origin:verified.origin,tree:verified.sourceTree,clean:true});
};

async function actualReadOnly(sql) {
  const token=process.env.SUPABASE_ACCESS_TOKEN;
  requireRelease(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token??''),'AMORA_WRITER_CAPTURE_CREDENTIAL_UNAVAILABLE');
  const controller=new AbortController(),expiresAt=Date.now()+45_000,timer=setTimeout(()=>controller.abort(),45_000);
  try {
    const response=await fetch('https://api.supabase.com/v1/projects/slrtobkksjmxgzatjyqb/database/query',{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:sql,read_only:true}),signal:controller.signal});
    if(Date.now()>=expiresAt)controller.abort();
    const rows=await readAmoraWriterRetirementBoundedJsonResponse(response,{signal:controller.signal});
    requireRelease(Date.now()<expiresAt,'AMORA_WRITER_CAPTURE_UNAVAILABLE');
    return rows;
  } catch {throw new Error('AMORA_WRITER_CAPTURE_UNAVAILABLE');}
  finally {clearTimeout(timer);controller.abort();}
}

/** Default actual transport/CI/source/DPAPI only; no query, clock, store factory or asserted provenance injection. */
export async function captureAmoraWriterRetirementPrivateOriginal(options) {
  requireRelease(options&&typeof options==='object'&&!Array.isArray(options)
    &&Object.keys(options).sort().join(',')==='admission,before,expectedCommit,repoRoot'
    &&typeof options.repoRoot==='string'&&typeof options.expectedCommit==='string'&&/^[a-f0-9]{40}$/.test(options.expectedCommit),'AMORA_WRITER_CAPTURE_ARGUMENT_INVALID');
  const {repoRoot,expectedCommit,before,admission}=options;
  const source=await sourceBinding(admission,repoRoot,expectedCommit);
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  validateAmoraWriterRetirementObservation(before,{repoRoot,phase:'before',expectedNativeSystemIdentifier:null,beforeObservation:null});
  const sourceHashes=hashes(repoRoot),collectorSourceSha256=sourceSha();
  const sql=buildAmoraWriterRetirementRecoveryCaptureSql({repoRoot,expectedCommit,collectorSourceSha256,expectedNativeSystemIdentifier:null});
  const rows=await actualReadOnly(sql);
  requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]?.b2_original7_capsule,'AMORA_WRITER_CAPTURE_RESPONSE_INVALID');
  const raw=rows[0].b2_original7_capsule;
  for(const key of ['rows','preservedCatalogSha256','rawLedgerSha256','ledger'])same(raw.stateWitness?.[key],before[key],'AMORA_WRITER_CAPTURE_BASELINE_DRIFT');
  const bytes=Buffer.from(JSON.stringify(raw)),artifactSha256=digest(bytes);
  const deadline=new Date(Math.min(Date.now()+120_000,Date.parse(raw.capturedAt)+120_000)).toISOString();
  let reread;
  try {
    const contentReceipt=validateAmoraWriterRetirementRecoveryCapsule({repoRoot,bytes,expectedArtifactSha256:artifactSha256,
      expectedCommit,expectedCollectorSha256:collectorSourceSha256,deadline,expectedNativeSystemIdentifier:null});
    same(await sourceBinding(admission,repoRoot,expectedCommit),source,'AMORA_WRITER_CAPTURE_SOURCE_CHANGED');
    same(hashes(repoRoot),sourceHashes,'AMORA_WRITER_CAPTURE_SOURCE_CHANGED');
    const store=createAmoraWriterRetirementPrivateStore({repoRoot,recoveryId:randomUUID()});
    assertAmoraWriterRetirementPrivateStoreIssued(store);
    const stored=store.write(bytes);reread=store.read(artifactSha256);
    requireRelease(reread.equals(bytes)&&stored.plaintextSha256===artifactSha256,'AMORA_WRITER_CAPTURE_PRIVATE_DRIFT');
    const privateReceipt=store.verify(artifactSha256);
    same(privateReceipt.encryptedSha256,stored.encryptedSha256,'AMORA_WRITER_CAPTURE_PRIVATE_DRIFT');
    same(hashes(repoRoot),sourceHashes,'AMORA_WRITER_CAPTURE_SOURCE_CHANGED');
    same(await sourceBinding(admission,repoRoot,expectedCommit),source,'AMORA_WRITER_CAPTURE_SOURCE_CHANGED');
    requireRelease(Date.now()<Date.parse(deadline),'AMORA_WRITER_CAPTURE_EXPIRED');
    const proof=Object.freeze({format:'amora-b2-issued-private-original7-v1',scope:'original7-canonical-update-acl-private-original',
      source,artifactSha256,collectorSourceSha256,sourceHashes:Object.freeze(sourceHashes.map(Object.freeze)),contentReceipt,
      privateReceipt,deadline,recoveryId:store.recoveryId,directory:store.directory,projectRef:plan.contract.projectRef,
      sourceCommit:expectedCommit,systemIdentifier:raw.sourceSystemIdentifier,capturedAt:raw.capturedAt,
      collectorExecutionProvenanceVerified:true,privateStorageVerified:true,nativeReplayVerified:false,releaseAuthorized:false,remoteWritesPerformed:false});
    issued.set(proof,{store,bytes:reread,repoRoot,expectedCommit,source,sourceHashes,admission});reread=undefined;
    return proof;
  } finally {bytes.fill(0);reread?.fill(0);}
}

export async function readAmoraWriterRetirementPrivateOriginal(proof,{repoRoot,expectedCommit}) {
  const state=issued.get(proof);
  requireRelease(state&&state.repoRoot===repoRoot&&state.expectedCommit===expectedCommit,'AMORA_WRITER_CAPTURE_PROOF_NOT_ISSUED');
  requireRelease(Date.now()<Date.parse(proof.deadline)&&digest(state.bytes)===proof.artifactSha256,'AMORA_WRITER_CAPTURE_EXPIRED_OR_CHANGED');
  same(await sourceBinding(state.admission,repoRoot,expectedCommit),state.source,'AMORA_WRITER_CAPTURE_SOURCE_CHANGED');
  same(hashes(repoRoot),state.sourceHashes,'AMORA_WRITER_CAPTURE_SOURCE_CHANGED');
  assertAmoraWriterRetirementPrivateStoreIssued(state.store);
  const privateReceipt=state.store.verify(proof.artifactSha256);
  same(privateReceipt.encryptedSha256,proof.privateReceipt.encryptedSha256,'AMORA_WRITER_CAPTURE_PRIVATE_DRIFT');
  const bytes=state.store.read(proof.artifactSha256);
  try {
    const contentReceipt=validateAmoraWriterRetirementRecoveryCapsule({repoRoot,bytes,expectedArtifactSha256:proof.artifactSha256,
      expectedCommit,expectedCollectorSha256:proof.collectorSourceSha256,deadline:proof.deadline,expectedNativeSystemIdentifier:null});
    return {bytes,contentReceipt,deadline:proof.deadline};
  } catch(error) {bytes.fill(0);throw error;}
}
