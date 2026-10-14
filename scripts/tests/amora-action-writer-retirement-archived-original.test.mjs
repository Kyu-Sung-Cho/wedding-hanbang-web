import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,realpathSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deriveFixedOriginal7FromRepo} from '../lib/amora-action-writer-retirement-original-source.mjs';
import {amoraWriterRetirementOriginalCanonicalAcl} from '../lib/amora-action-writer-retirement-recovery.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from '../lib/amora-action-writer-retirement-release-contract.mjs';
import {createAmoraWriterRetirementPrivateStore} from '../lib/amora-action-writer-retirement-private-store.mjs';
import {openAmoraWriterRetirementPrivateJournal} from '../lib/amora-action-writer-retirement-private-journal.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const archiveSourceCommit='68f9d94a3263ef922f2aabbde7541fb85b37853e';
const collector='38434b59cdca159c6fa4054428838721575f4909f80f0a29da3bf67262a97faf';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function isolatedGitEnvironment(callback){
  const inherited=Object.fromEntries(Object.entries(process.env).filter(([name])=>/^GIT_/i.test(name)));
  for(const name of Object.keys(inherited))delete process.env[name];
  try{return await callback();}finally{for(const [name,value] of Object.entries(inherited))process.env[name]=value;}
}
function syntheticArchive(){
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  return {format:'amora-b2-original7-canonical-update-acl-capsule-v1',kind:'b2-scoped-original7-not-b1-original4-or-b2-original6',
    captureEnvironment:'supabase-read-only',projectRef:'slrtobkksjmxgzatjyqb',sourceSystemIdentifier:'7581440907192989109',
    sourceCommit:archiveSourceCommit,expectedOrigin:'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git',collectorSourceSha256:collector,
    bundleSha256:plan.migration.sha256,capturedAt:'2026-10-13T00:00:00.000000Z',serverVersion:'17.6',database:'postgres',
    currentUser:'supabase_read_only_user',readOnly:true,definitions:deriveFixedOriginal7FromRepo(repoRoot),canonicalTable:amoraWriterRetirementOriginalCanonicalAcl(),
    b2GuardSlots:{functions:[],triggers:[]},stateWitness:{preservedCatalogSha256:'a'.repeat(64),rawLedgerSha256:'b'.repeat(64),
      rows:{amoraActionsCount:0,amoraActionsSha256:'c'.repeat(64),journeysCount:0,journeysSha256:'d'.repeat(64)},
      ledger:plan.expectedBefore230.map(row=>({...row,statementCount:row.statementsSha256===null?null:1,sqlMd5:row.statementsSha256===null?null:'e'.repeat(32)}))}};
}
function makePrivate(raw=syntheticArchive(),recordedAtArray=false){
  const recoveryId=randomUUID(),directory=resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery',recoveryId);
  let store,journal,applyJournal,cleaned=false;
  const cleanup=()=>{
    if(cleaned)return;
    if(!existsSync(directory)){cleaned=true;return;}
    const base=resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery');
    assert.equal(dirname(realpathSync(directory)).toLowerCase(),base.toLowerCase());
    assert.equal(realpathSync(directory).toLowerCase(),join(base,recoveryId).toLowerCase());
    for(const name of ['rehearsal.jsonl','apply.jsonl','original7-canonical-update-acl.dpapi']){
      const path=join(directory,name);if(existsSync(path)){
        assert.equal(lstatSync(path).isFile(),true);assert.equal(lstatSync(path).isSymbolicLink(),false);unlinkSync(path);
      }
    }rmdirSync(directory);cleaned=true;
  };
  try{
  store=createAmoraWriterRetirementPrivateStore({repoRoot,recoveryId});
  const bytes=Buffer.from(JSON.stringify(raw)),expectedArtifactSha256=sha(bytes);
  try{store.write(bytes);}finally{bytes.fill(0);}
  journal=openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId,directory:store.directory,mode:'rehearse'});
  journal.append({format:'amora-writer-retirement-original7-operational-rehearsal-v1',release:'amora-action-writer-retirement-transport-20261013',
    sourceCommit:archiveSourceCommit,bundleSha256:raw.bundleSha256,status:'rehearsal-intent',artifactSha256:expectedArtifactSha256,
    collectorSha256:collector,deadline:'2026-10-13T00:02:00.000Z',originalFunctionCount:7,releaseAuthorized:false,
    scopedNativeOriginal7Verified:true});journal.close();
  applyJournal=openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId,directory:store.directory,mode:'apply'});
  const statuses=['maintenance-installed-and-independently-observed','commit-intent','post7-and-231-independently-observed',
    'cutoff-intent','uninstall-intent','outcome-requires-independent-inspection'];
  for(const [index,status] of statuses.entries())applyJournal.append({
    format:'amora-writer-retirement-original7-cutover-journal-v1',release:'amora-action-writer-retirement-transport-20261013',
    sourceCommit:archiveSourceCommit,bundleSha256:raw.bundleSha256,originalFunctionCount:7,status,
    recordedAt:recordedAtArray&&index===0?[`2026-10-13T00:01:0${index}.000Z`]:`2026-10-13T00:01:0${index}.000Z`,
    deadline:'2026-10-13T00:02:00.000Z',releaseAuthorized:false,
    operation:status==='outcome-requires-independent-inspection'?'uninstall':'synthetic-scoped-phase',
    ...(index===0?{objectIds:{functionId:20001,triggerIds:[20002,20003]}}:{}),
    ...(index===5?{committedOutcomeUnknown:true,maintenanceRemovalUnknown:true,code:'AMORA_WRITER_RETIREMENT_ADMISSION_EXPIRED_OR_CHANGED'}:{})});
  applyJournal.close();
  const expectedCommit=execFileSync('C:/Program Files/Git/cmd/git.exe',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8',windowsHide:true}).trim();
  return {raw,store,cleanup,options:{repoRoot,expectedCommit,archiveSourceCommit,recoveryId,expectedArtifactSha256}};
  }catch(error){journal?.close();applyJournal?.close();cleanup();throw error;}
}

test('archive verification cannot accept caller callbacks or asserted historical authority',async()=>{
  const {collectAmoraWriterRetirementArchivedOriginal,assertAmoraWriterRetirementArchivedOriginal}=await import('../lib/amora-action-writer-retirement-archived-original.mjs');
  await assert.rejects(()=>collectAmoraWriterRetirementArchivedOriginal({verified:true,read:()=>Buffer.from('forged')}),/ARCHIVE_ARGUMENT_INVALID/);
  assert.throws(()=>assertAmoraWriterRetirementArchivedOriginal({historicalOriginal7Verified:true},{repoRoot:'C:/synthetic',expectedCommit:'a'.repeat(40)}),/ARCHIVE_NOT_ISSUED/);
});

test('expired synthetic DPAPI original7 stays historical and immutable, not live capture/native/completion authority',
  {skip:process.platform!=='win32',timeout:60_000},async()=>{
    const module=await import('../lib/amora-action-writer-retirement-archived-original.mjs');let f,proof;
    try{await isolatedGitEnvironment(async()=>{
      f=makePrivate();
      const encryptedBefore=sha(readFileSync(join(f.store.directory,'original7-canonical-update-acl.dpapi')));
      proof=await module.collectAmoraWriterRetirementArchivedOriginal(f.options);
      assert.equal(proof.format,'amora-writer-retirement-issued-archived-original7-v1');
      assert.equal(proof.archiveSourceCommit,archiveSourceCommit);assert.equal(proof.currentSourceCommit,f.options.expectedCommit);
      assert.equal(proof.sourceObservedAt,f.raw.capturedAt);assert.equal(proof.originalDeadline,'2026-10-13T00:02:00.000Z');
      assert.equal(proof.originalAuthorityExpired,true);
      assert.deepEqual(proof.historicalOwn3ObjectIds,{functionId:20001,triggerIds:[20002,20003]});
      assert.equal(typeof proof.applyJournalSha256,'string');
      for(const key of ['releaseAuthorized','nativeReplayVerified','collectorExecutionProvenanceVerified','liveCaptureAuthorityVerified'])assert.equal(proof[key],false);
      assert.equal(module.assertAmoraWriterRetirementArchivedOriginal(proof,{repoRoot,expectedCommit:f.options.expectedCommit}),proof);
      assert.throws(()=>module.assertAmoraWriterRetirementArchivedOriginal(structuredClone(proof),{repoRoot,expectedCommit:f.options.expectedCommit}),/NOT_ISSUED/);
      const first=module.readAmoraWriterRetirementIssuedHistorical(proof,{repoRoot,expectedCommit:f.options.expectedCommit});
      assert.equal(sha(first.bytes),f.options.expectedArtifactSha256);assert.equal(first.raw.capturedAt,f.raw.capturedAt);
      first.bytes.fill(0);
      const second=module.readAmoraWriterRetirementIssuedHistorical(proof,{repoRoot,expectedCommit:f.options.expectedCommit});
      assert.equal(sha(second.bytes),f.options.expectedArtifactSha256);second.bytes.fill(0);
      assert.equal(sha(readFileSync(join(f.store.directory,'original7-canonical-update-acl.dpapi'))),encryptedBefore);
      module.closeAmoraWriterRetirementArchivedOriginal(proof);
      assert.throws(()=>module.assertAmoraWriterRetirementArchivedOriginal(proof,{repoRoot,expectedCommit:f.options.expectedCommit}),/NOT_ISSUED/);
      proof=undefined;
    });}finally{if(proof)module.closeAmoraWriterRetirementArchivedOriginal(proof);f?.cleanup();}
  });

for(const boundary of ['capturedAt','recordedAt'])test(`protected historical ${boundary} must be a string, never a single-element timestamp array`,
  {skip:process.platform!=='win32',timeout:60_000},async()=>{
    const module=await import('../lib/amora-action-writer-retirement-archived-original.mjs');let f,proof;
    try{await isolatedGitEnvironment(async()=>{
      const raw=syntheticArchive();if(boundary==='capturedAt')raw.capturedAt=[raw.capturedAt];
      f=makePrivate(raw,boundary==='recordedAt');
      await assert.rejects(async()=>{proof=await module.collectAmoraWriterRetirementArchivedOriginal(f.options);},
        boundary==='capturedAt'?/ARCHIVE_CONTENT_INVALID/:/ARCHIVE_APPLY_JOURNAL_INVALID/);
    });}finally{if(proof)module.closeAmoraWriterRetirementArchivedOriginal(proof);f?.cleanup();}
  });
