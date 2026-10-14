import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync,lstatSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../lib/current-baseline-release-contract.mjs';
import {deriveFixedOriginal7FromRepo} from '../lib/amora-action-writer-retirement-original-source.mjs';
import {amoraWriterRetirementOriginalCanonicalAcl} from '../lib/amora-action-writer-retirement-recovery.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from '../lib/amora-action-writer-retirement-release-contract.mjs';
import {createAmoraWriterRetirementPrivateStore} from '../lib/amora-action-writer-retirement-private-store.mjs';
import {openAmoraWriterRetirementPrivateJournal} from '../lib/amora-action-writer-retirement-private-journal.mjs';
import {collectAmoraWriterRetirementArchivedOriginal,closeAmoraWriterRetirementArchivedOriginal} from '../lib/amora-action-writer-retirement-archived-original.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const archiveSourceCommit='68f9d94a3263ef922f2aabbde7541fb85b37853e';
const collector='38434b59cdca159c6fa4054428838721575f4909f80f0a29da3bf67262a97faf';
function privateFixture(){
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  const raw={format:'amora-b2-original7-canonical-update-acl-capsule-v1',kind:'b2-scoped-original7-not-b1-original4-or-b2-original6',
    captureEnvironment:'supabase-read-only',projectRef:'slrtobkksjmxgzatjyqb',sourceSystemIdentifier:'7581440907192989109',
    sourceCommit:archiveSourceCommit,expectedOrigin:'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git',collectorSourceSha256:collector,
    bundleSha256:plan.migration.sha256,capturedAt:'2026-10-13T00:00:00.000000Z',serverVersion:'17.6',database:'postgres',
    currentUser:'supabase_read_only_user',readOnly:true,definitions:deriveFixedOriginal7FromRepo(repoRoot),canonicalTable:amoraWriterRetirementOriginalCanonicalAcl(),
    b2GuardSlots:{functions:[],triggers:[]},stateWitness:{preservedCatalogSha256:'a'.repeat(64),rawLedgerSha256:'b'.repeat(64),
      rows:{amoraActionsCount:0,amoraActionsSha256:'c'.repeat(64),journeysCount:0,journeysSha256:'d'.repeat(64)},
      ledger:plan.expectedBefore230.map(row=>({...row,statementCount:row.statementsSha256===null?null:1,sqlMd5:row.statementsSha256===null?null:'e'.repeat(32)}))}};
  const recoveryId=randomUUID(),directory=resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery',recoveryId);
  let store,cleaned=false,journal,apply;
  const cleanup=()=>{
    if(cleaned)return;
    if(!existsSync(directory)){cleaned=true;return;}
    const base=resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery');
    assert.equal(realpathSync(directory).toLowerCase(),join(base,recoveryId).toLowerCase());assert.equal(dirname(realpathSync(directory)).toLowerCase(),base.toLowerCase());
    for(const name of ['rehearsal.jsonl','apply.jsonl','original7-canonical-update-acl.dpapi']){const path=join(directory,name);if(existsSync(path)){assert.equal(lstatSync(path).isFile(),true);assert.equal(lstatSync(path).isSymbolicLink(),false);unlinkSync(path);}}
    rmdirSync(directory);cleaned=true;
  };
  try{
  store=createAmoraWriterRetirementPrivateStore({repoRoot,recoveryId});
  const bytes=Buffer.from(JSON.stringify(raw)),expectedArtifactSha256=digest(bytes);
  try{store.write(bytes);}finally{bytes.fill(0);}
  journal=openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId,directory:store.directory,mode:'rehearse'});
  journal.append({format:'amora-writer-retirement-original7-operational-rehearsal-v1',release:'amora-action-writer-retirement-transport-20261013',
    sourceCommit:archiveSourceCommit,bundleSha256:raw.bundleSha256,status:'rehearsal-intent',artifactSha256:expectedArtifactSha256,
    collectorSha256:collector,deadline:'2026-10-13T00:02:00.000Z',originalFunctionCount:7,releaseAuthorized:false});journal.close();
  apply=openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId,directory:store.directory,mode:'apply'});
  for(const [index,status] of ['maintenance-installed-and-independently-observed','commit-intent','post7-and-231-independently-observed',
    'cutoff-intent','uninstall-intent','outcome-requires-independent-inspection'].entries())apply.append({
    format:'amora-writer-retirement-original7-cutover-journal-v1',release:'amora-action-writer-retirement-transport-20261013',sourceCommit:archiveSourceCommit,
    bundleSha256:raw.bundleSha256,originalFunctionCount:7,status,recordedAt:`2026-10-13T00:01:0${index}.000Z`,deadline:'2026-10-13T00:02:00.000Z',
    operation:status==='outcome-requires-independent-inspection'?'uninstall':'synthetic-scoped-phase',releaseAuthorized:false,
    ...(index===0?{objectIds:{functionId:30001,triggerIds:[30002,30003]}}:{}),
    ...(index===5?{committedOutcomeUnknown:true,maintenanceRemovalUnknown:true,code:'AMORA_WRITER_RETIREMENT_ADMISSION_EXPIRED_OR_CHANGED'}:{})});apply.close();
  return {options:{repoRoot,expectedCommit:execFileSync('C:/Program Files/Git/cmd/git.exe',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8',windowsHide:true}).trim(),
    archiveSourceCommit,recoveryId,expectedArtifactSha256},cleanup};
  }catch(error){journal?.close();apply?.close();cleanup();throw error;}
}

test('serialized archived-native claims never become an issued replay fact',async()=>{
  const module=await import('../lib/amora-action-writer-retirement-archived-native.mjs');
  await assert.rejects(()=>module.runAmoraWriterRetirementArchivedNativeRecovery({verified:true,nativeReplayVerified:true}),/ARCHIVED_NATIVE_ARGUMENT_INVALID/);
  assert.throws(()=>module.assertAmoraWriterRetirementArchivedNativeRecovery({nativeReplayVerified:true},{}),/ARCHIVED_NATIVE_NOT_ISSUED/);
});

test('unfinished, expired or incorrectly typed local replay completion cannot be sealed as an issued fact',async()=>{
  const module=await import('../lib/amora-action-writer-retirement-archived-native.mjs');
  const finished={startedAt:'2026-10-13T00:00:00.000Z',completedAt:'2026-10-13T00:01:00.000Z',
    nativeCaptureDeadline:'2026-10-13T00:02:00.000Z',nativeReplayVerified:true,ownedClustersClosedAndMarkerVerified:true};
  const content=module.validateAmoraWriterRetirementArchivedNativeCompletion(finished);
  assert.equal(content.releaseAuthorized,false);assert.equal(content.productionRecoveryAuthorized,false);
  assert.throws(()=>module.assertAmoraWriterRetirementArchivedNativeRecovery(content,{}),/NOT_ISSUED/);
  for(const invalid of [{nativeReplayVerified:false},{ownedClustersClosedAndMarkerVerified:false},
    {completedAt:finished.nativeCaptureDeadline},{completedAt:'2026-10-13T00:02:00.001Z'},
    {completedAt:'2026-10-12T23:59:59.999Z'},{completedAt:[finished.completedAt]},
    {nativeCaptureDeadline:[finished.nativeCaptureDeadline]}])
    assert.throws(()=>module.validateAmoraWriterRetirementArchivedNativeCompletion({...finished,...invalid}),/COMPLETION_INVALID/);
});

test('expired synthetic protected originals link to a fresh distinct owned PG17 replay fact, without renewing their operating deadline',
  {skip:process.platform!=='win32',timeout:180_000},async()=>{
    const module=await import('../lib/amora-action-writer-retirement-archived-native.mjs');
    const inherited=Object.fromEntries(Object.entries(process.env).filter(([name])=>/^GIT_/i.test(name)));
    for(const name of Object.keys(inherited))delete process.env[name];
    let f,archive;
    try{
      f=privateFixture();
      archive=await collectAmoraWriterRetirementArchivedOriginal(f.options);
      const oldBin=process.env.HANBANG_SYNTHETIC_PG_BIN;
      try{
        process.env.HANBANG_SYNTHETIC_PG_BIN='C:/synthetic-non-owned-PG-bin';
        await assert.rejects(()=>module.runAmoraWriterRetirementArchivedNativeRecovery({repoRoot,expectedCommit:f.options.expectedCommit,archive}),
          /ARCHIVED_NATIVE_TOOLCHAIN_REQUIRED/);
      }finally{if(oldBin===undefined)delete process.env.HANBANG_SYNTHETIC_PG_BIN;else process.env.HANBANG_SYNTHETIC_PG_BIN=oldBin;}
      const fact=await module.runAmoraWriterRetirementArchivedNativeRecovery({repoRoot,expectedCommit:f.options.expectedCommit,archive});
      assert.equal(fact.format,'amora-writer-retirement-issued-completed-archived-local-replay-v1');
      assert.equal(fact.archiveArtifactSha256,f.options.expectedArtifactSha256);assert.equal(fact.archiveOriginalDeadline,'2026-10-13T00:02:00.000Z');
      assert.equal(fact.archiveSourceObservedAt,'2026-10-13T00:00:00.000000Z');assert.equal(fact.ownedClustersClosedAndMarkerVerified,true);
      assert.notEqual(fact.actualReplaySystemIdentifier,'7581440907192989109');assert.notEqual(fact.actualReplaySystemIdentifier,fact.freshNativeSourceSystemIdentifier);
      assert.ok(Date.parse(fact.completedAt)<Date.parse(fact.nativeCaptureDeadline));
      assert.equal(fact.completedWithinFreshLocalDeadline,true);
      for(const key of ['releaseAuthorized','productionRecoveryAuthorized','remoteWritesPerformed','oldLiveCaptureAuthorityRenewed'])assert.equal(fact[key],false);
      assert.equal(module.assertAmoraWriterRetirementArchivedNativeRecovery(fact,{repoRoot,expectedCommit:f.options.expectedCommit,archive}),fact);
      assert.throws(()=>module.assertAmoraWriterRetirementArchivedNativeRecovery(structuredClone(fact),{repoRoot,expectedCommit:f.options.expectedCommit,archive}),/NOT_ISSUED/);
      assert.throws(()=>module.assertAmoraWriterRetirementArchivedNativeRecovery(fact,{repoRoot,expectedCommit:'a'.repeat(40),archive}),/SOURCE_CHANGED/);
      assert.throws(()=>module.assertAmoraWriterRetirementArchivedNativeRecovery(fact,{repoRoot,expectedCommit:f.options.expectedCommit,archive:structuredClone(archive)}),/SOURCE_CHANGED/);
      try{
        process.env.HANBANG_SYNTHETIC_PG_BIN='C:/synthetic-changed-PG-bin';
        assert.throws(()=>module.assertAmoraWriterRetirementArchivedNativeRecovery(fact,{repoRoot,expectedCommit:f.options.expectedCommit,archive}),/ARCHIVED_NATIVE_TOOLCHAIN_REQUIRED/);
      }finally{if(oldBin===undefined)delete process.env.HANBANG_SYNTHETIC_PG_BIN;else process.env.HANBANG_SYNTHETIC_PG_BIN=oldBin;}
      closeAmoraWriterRetirementArchivedOriginal(archive);
      assert.throws(()=>module.assertAmoraWriterRetirementArchivedNativeRecovery(fact,{repoRoot,expectedCommit:f.options.expectedCommit,archive}),/ARCHIVE_NOT_ISSUED/);
      archive=undefined;
    }finally{try{if(archive)closeAmoraWriterRetirementArchivedOriginal(archive);f?.cleanup();}
      finally{for(const [name,value] of Object.entries(inherited))process.env[name]=value;}}
  });
