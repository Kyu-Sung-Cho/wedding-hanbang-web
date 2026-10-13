import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,requireRelease,same,CurrentBaselineBlocked} from './current-baseline-release-contract.mjs';
import {loadAmoraActionViewV2Plan} from './amora-action-view-v2-release-contract.mjs';
import {validateAmoraActionViewV2Inspection} from './amora-action-view-v2-catalog.mjs';
import {assertAmoraActionViewV2Source} from './amora-action-view-v2-release.mjs';
import {buildAmoraActionViewV2RecoveryCaptureSql,validateAmoraActionViewV2RecoveryCapsule} from './amora-action-view-v2-recovery.mjs';
import {createAmoraActionViewV2PrivateStore} from './amora-action-view-v2-private-store.mjs';

const issued=new WeakMap();
const sourceSha=()=>digest(readFileSync(new URL(import.meta.url)));
const files=['scripts/lib/amora-action-view-v2-original-capture.mjs','scripts/lib/amora-action-view-v2-release.mjs',
  'scripts/lib/amora-action-view-v2-release-contract.mjs','scripts/lib/amora-action-view-v2-catalog.mjs',
  'scripts/lib/amora-action-view-v2-ledger.mjs','scripts/lib/amora-action-view-v2-recovery.mjs',
  'scripts/lib/amora-action-view-v2-private-store.mjs','scripts/amora-action-view-v2-private-store.ps1',
  'scripts/amora-db-backup-common.ps1'];
const hashes=repoRoot=>files.map(file=>({file,sha256:digest(readFileSync(join(repoRoot,file)))}));
const fail=code=>{throw new CurrentBaselineBlocked(code);};
function argumentsValid(options) {
  requireRelease(options&&typeof options==='object'&&!Array.isArray(options)
    &&Object.keys(options).every(key=>['repoRoot','expectedCommit','before','query','now','assertSource','storeFactory'].includes(key))
    &&typeof options.repoRoot==='string'&&/^[a-f0-9]{40}$/.test(options.expectedCommit??''),
  'AMORA_VIEW_V2_CAPTURE_ARGUMENT_INVALID');
}
async function readOnlyCaptureQuery(sql) {
  const token=process.env.SUPABASE_ACCESS_TOKEN;
  requireRelease(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token??''),'AMORA_VIEW_V2_CREDENTIAL_UNAVAILABLE');
  try {
    const response=await fetch('https://api.supabase.com/v1/projects/slrtobkksjmxgzatjyqb/database/query',{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(45_000),
    });
    requireRelease(response.ok,'AMORA_VIEW_V2_CAPTURE_UNAVAILABLE');
    const text=await response.text();
    requireRelease(Buffer.byteLength(text)<=256*1024,'AMORA_VIEW_V2_CAPTURE_UNAVAILABLE');
    return JSON.parse(text);
  } catch {fail('AMORA_VIEW_V2_CAPTURE_UNAVAILABLE');}
}

/** 고정 읽기 전용 캡처를 직접 수집하고 private store에서 다시 읽는다. 운영 DB 쓰기는 없다. */
export async function captureAmoraActionViewV2PrivateOriginal(options) {
  argumentsValid(options);
  const {repoRoot,expectedCommit,before,query=readOnlyCaptureQuery,now=()=>new Date(),
    assertSource=assertAmoraActionViewV2Source,storeFactory=createAmoraActionViewV2PrivateStore}=options;
  const source=assertSource(repoRoot,expectedCommit);
  const plan=loadAmoraActionViewV2Plan(repoRoot);
  validateAmoraActionViewV2Inspection(before,{plan,repoRoot,now:now()});
  const sourceHashes=Object.freeze(hashes(repoRoot).map(Object.freeze)),collectorSourceSha256=sourceSha();
  const sql=buildAmoraActionViewV2RecoveryCaptureSql({repoRoot,expectedCommit,collectorSourceSha256});
  const rows=await query(sql,{readOnly:true});
  requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]?.recovery_capsule,
    'AMORA_VIEW_V2_CAPTURE_RESPONSE_INVALID');
  const raw=rows[0].recovery_capsule;
  for(const [key,expected] of [['target',before.target],['rows',before.rows],
    ['preservedCatalogMd5',before.preservedCatalogMd5],['ledgerMd5',before.ledgerMd5]])
    same(raw[key],expected,'AMORA_VIEW_V2_CAPTURE_BASELINE_DRIFT');
  const bytes=Buffer.from(JSON.stringify(raw));
  const artifactSha256=digest(bytes),deadline=new Date(Math.min(now().getTime()+120_000,
    Date.parse(raw.capturedAt)+120_000)).toISOString();
  const contentReceipt=validateAmoraActionViewV2RecoveryCapsule({repoRoot,bytes,expectedArtifactSha256:artifactSha256,
    expectedCommit,expectedCollectorSha256:collectorSourceSha256,deadline});
  let persistedBytes;
  try {
    same(assertSource(repoRoot,expectedCommit),source,'AMORA_VIEW_V2_CAPTURE_SOURCE_CHANGED');
    same(hashes(repoRoot),sourceHashes,'AMORA_VIEW_V2_CAPTURE_SOURCE_CHANGED');
    const store=storeFactory({repoRoot,recoveryId:randomUUID()});
    const stored=store.write(bytes);
    requireRelease(stored.plaintextSha256===artifactSha256,'AMORA_VIEW_V2_CAPTURE_PRIVATE_HASH_CHANGED');
    persistedBytes=store.read(artifactSha256);
    requireRelease(persistedBytes.equals(bytes),'AMORA_VIEW_V2_CAPTURE_PRIVATE_HASH_CHANGED');
    const privateReceipt=store.verify(artifactSha256);
    same(privateReceipt.encryptedSha256,stored.encryptedSha256,'AMORA_VIEW_V2_CAPTURE_PRIVATE_HASH_CHANGED');
    same(assertSource(repoRoot,expectedCommit),source,'AMORA_VIEW_V2_CAPTURE_SOURCE_CHANGED');
    same(hashes(repoRoot),sourceHashes,'AMORA_VIEW_V2_CAPTURE_SOURCE_CHANGED');
    requireRelease(now().getTime()<Date.parse(deadline),'AMORA_VIEW_V2_CAPTURE_EXPIRED');
    const proof=Object.freeze({format:'amora-action-view-v2-private-original-capture-v1',source,artifactSha256,
      collectorSourceSha256,sourceHashes,contentReceipt,privateReceipt,deadline,recoveryId:store.recoveryId,
      directory:store.directory,sourceCommit:expectedCommit,projectRef:plan.contract.projectRef,
      systemIdentifier:raw.sourceSystemIdentifier,capturedAt:raw.capturedAt,
      nativeReplayVerified:false,releaseAuthorized:false,remoteWritesPerformed:false});
    issued.set(proof,{store,bytes:persistedBytes,repoRoot,expectedCommit,source,sourceHashes,assertSource});
    persistedBytes=undefined;
    return proof;
  } finally {bytes.fill(0);persistedBytes?.fill(0);}
}

/** 메모리에서 실제 발급된 proof와 private 원문을 다시 검증한다. 직렬화된 true는 받지 않는다. */
export function readAmoraActionViewV2PrivateOriginal(proof,{repoRoot,expectedCommit}) {
  const state=issued.get(proof);
  requireRelease(state&&state.repoRoot===repoRoot&&state.expectedCommit===expectedCommit,
    'AMORA_VIEW_V2_CAPTURE_PROOF_NOT_ISSUED');
  requireRelease(Date.now()<Date.parse(proof.deadline)&&digest(state.bytes)===proof.artifactSha256,
    'AMORA_VIEW_V2_CAPTURE_EXPIRED_OR_CHANGED');
  same(state.assertSource(repoRoot,expectedCommit),state.source,'AMORA_VIEW_V2_CAPTURE_SOURCE_CHANGED');
  same(hashes(repoRoot),state.sourceHashes,'AMORA_VIEW_V2_CAPTURE_SOURCE_CHANGED');
  const receipt=state.store.verify(proof.artifactSha256);
  same(receipt.encryptedSha256,proof.privateReceipt.encryptedSha256,'AMORA_VIEW_V2_CAPTURE_PRIVATE_HASH_CHANGED');
  const bytes=state.store.read(proof.artifactSha256);
  try {
    const contentReceipt=validateAmoraActionViewV2RecoveryCapsule({repoRoot,bytes,
      expectedArtifactSha256:proof.artifactSha256,expectedCommit,
      expectedCollectorSha256:proof.collectorSourceSha256,deadline:proof.deadline});
    return {bytes,contentReceipt,deadline:proof.deadline};
  } catch(error) {bytes.fill(0);throw error;}
}
