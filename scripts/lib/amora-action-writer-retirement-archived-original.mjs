import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,openSync,fstatSync,closeSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {types} from 'node:util';
import {digest,pinnedArtifact,requireRelease,same} from './current-baseline-release-contract.mjs';
import {PINNED_WINDOWS_PRODUCTION_TOOLCHAIN,resolvePinnedWindowsProductionToolchain} from './production-windows-toolchain.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {deriveFixedOriginal7FromRepo} from './amora-action-writer-retirement-original-source.mjs';
import {amoraWriterRetirementOriginalCanonicalAcl,validateAmoraWriterRetirementLedger} from './amora-action-writer-retirement-recovery.mjs';

const ARCHIVE_COMMIT='68f9d94a3263ef922f2aabbde7541fb85b37853e';
const COLLECTOR='38434b59cdca159c6fa4054428838721575f4909f80f0a29da3bf67262a97faf';
const ORIGIN='https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git';
const PROJECT='slrtobkksjmxgzatjyqb',SYSTEM='7581440907192989109';
const STORE={file:'scripts/amora-action-writer-retirement-private-store.ps1',sha256:'48051458dc7550f129e72664b36a5e4213e165c4698cda0c695d68e138828b9c'};
const JOURNAL={file:'scripts/amora-action-writer-retirement-private-journal.ps1',sha256:'2169ff1eef7d5f122b4bfdc42cf98a35dfb12195111dac413790d717927fd576'};
const COMMON={file:'scripts/amora-db-backup-common.ps1',sha256:'b6f9eaa6a54edf92d868f61d25f00a2008ec42e34bbd5fb4dea75def61277079'};
const HISTORICAL_DEPENDENCIES=Object.freeze([
  ['original-source','6155ac81019de9a021ce59a5610963456bd4b9f85e5746979ecbc84a952971a2'],
  ['recovery','16770b16e2fef8c93b757a756bfffad352fb407a3443dd0e135d9820399d5f34'],
  ['bundle','3b47832b635c588eb32260c6343945e3701cc1f296695305161f30b5e855cb41'],
  ['release-contract','07e6528eb416742653e63c9b6eb0bd197952ede5c1b971c4da608f5794567daf'],
]);
const SHA=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const CHECKED_TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/;
const issued=new WeakMap(),selfSha=()=>digest(readFileSync(new URL(import.meta.url)));
const ok=(value,code='AMORA_WRITER_ARCHIVE_ARGUMENT_INVALID')=>requireRelease(value,code);
const keys=(value,names,code='AMORA_WRITER_ARCHIVE_ARGUMENT_INVALID')=>{
  ok(value&&typeof value==='object'&&!Array.isArray(value)&&!types.isProxy(value),code);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  ok(Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(descriptors).every(key=>typeof key==='string'
    &&descriptors[key].enumerable&&Object.hasOwn(descriptors[key],'value'))
    &&Object.keys(value).sort().join(',')===names.slice().sort().join(','),code);
};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function safeEnvironment(){
  for(const [name,value] of Object.entries(process.env))ok(!/^GIT_/i.test(name)
    &&(!value||!/^(NODE_OPTIONS|NODE_PATH|GH_DEBUG|GH_HOST|GH_REPO|GH_CONFIG_DIR|SUPABASE_CLI_BINARY_OVERRIDE)$/i.test(name)),
  'AMORA_WRITER_ARCHIVE_UNSAFE_ENVIRONMENT');
  return Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^psmodulepath$/i.test(name)
    &&!/SUPABASE|DATABASE_URL|PGPASSWORD|PGHOST|PGUSER/i.test(name)));
}
function git(repoRoot,args){
  const environment=safeEnvironment();
  return execFileSync(PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git.path,['--no-replace-objects','-C',repoRoot,...args],
    {encoding:'utf8',windowsHide:true,timeout:25_000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
      env:{...environment,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}});
}
function source(repoRoot,expectedCommit){
  ok(git(repoRoot,['rev-parse','HEAD']).trim()===expectedCommit,'AMORA_WRITER_ARCHIVE_CURRENT_SOURCE_CHANGED');
  const origin=git(repoRoot,['remote','get-url','origin']).trim(),tree=git(repoRoot,['rev-parse','HEAD^{tree}']).trim();
  ok([ORIGIN,'git@github.com:Kyu-Sung-Cho/wedding-hanbang-web.git'].includes(origin)&&COMMIT.test(tree),
    'AMORA_WRITER_ARCHIVE_CURRENT_SOURCE_CHANGED');
  const collector=git(repoRoot,['cat-file','blob',`${ARCHIVE_COMMIT}:scripts/lib/amora-action-writer-retirement-original-capture.mjs`]);
  ok(digest(Buffer.from(collector,'utf8'))===COLLECTOR,'AMORA_WRITER_ARCHIVE_COLLECTOR_CHANGED');
  for(const [name,sha256] of HISTORICAL_DEPENDENCIES){
    const file=`scripts/lib/amora-action-writer-retirement-${name}.mjs`;
    ok(digest(Buffer.from(git(repoRoot,['cat-file','blob',`${ARCHIVE_COMMIT}:${file}`]),'utf8'))===sha256,
      'AMORA_WRITER_ARCHIVE_HISTORICAL_SOURCE_CHANGED');pinnedArtifact(repoRoot,{file,sha256});
  }
  return {commit:expectedCommit,tree,origin:ORIGIN};
}
function helper(repoRoot,pin,args){
  pinnedArtifact(repoRoot,pin);pinnedArtifact(repoRoot,COMMON);
  try{return execFileSync(PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.powershell.path,
    ['-NoProfile','-NonInteractive','-File',resolve(repoRoot,pin.file),...args],
    {encoding:'utf8',windowsHide:true,timeout:20_000,maxBuffer:524288,stdio:['ignore','pipe','pipe'],env:safeEnvironment()}).trim();}
  catch{throw new Error('AMORA_WRITER_ARCHIVE_PRIVATE_STORAGE_UNAVAILABLE');}
}
function leaf(path,maximum){
  const before=lstatSync(path);ok(before.isFile()&&!before.isSymbolicLink()&&before.size<=maximum&&realpathSync(path)===resolve(path),
    'AMORA_WRITER_ARCHIVE_FILE_CHANGED');
  const fd=openSync(path,'r');
  try{const opened=fstatSync(fd),bytes=readFileSync(fd),after=fstatSync(fd),linked=lstatSync(path);
    for(const stat of [opened,after,linked])ok(stat.dev===before.dev&&stat.ino===before.ino&&stat.size===before.size
      &&stat.mtimeMs===before.mtimeMs&&stat.ctimeMs===before.ctimeMs,'AMORA_WRITER_ARCHIVE_FILE_CHANGED');
    ok(bytes.length===before.size,'AMORA_WRITER_ARCHIVE_FILE_CHANGED');return bytes;
  }finally{closeSync(fd);}
}
function privateCheck(input){
  const {repoRoot,recoveryId,expectedArtifactSha256}=input;
  const value=JSON.parse(helper(repoRoot,STORE,['-Mode','check','-RecoveryId',recoveryId,'-ExpectedSha256',expectedArtifactSha256]));
  keys(value,['format','recoveryId','projectRef','plaintextSha256','encryptedSha256','plaintextBytes','encryptedBytes',
    'privateStorageVerified','plaintextWrittenToDisk','releaseAuthorized','protection','checkedAt'],'AMORA_WRITER_ARCHIVE_PRIVATE_METADATA_INVALID');
  ok(value.format==='amora-action-writer-retirement-original7-private-storage-v1'&&value.recoveryId===recoveryId
    &&value.projectRef===PROJECT&&value.plaintextSha256===expectedArtifactSha256&&SHA.test(value.encryptedSha256)
    &&Number.isSafeInteger(value.plaintextBytes)&&value.plaintextBytes>0&&value.plaintextBytes<=262144
    &&Number.isSafeInteger(value.encryptedBytes)&&value.encryptedBytes>0&&value.encryptedBytes<=263168
    &&value.privateStorageVerified===true&&value.plaintextWrittenToDisk===false&&value.releaseAuthorized===false
    &&value.protection==='Windows-DPAPI-CurrentUser'&&CHECKED_TIME.test(value.checkedAt)&&Date.now()-Date.parse(value.checkedAt)>=-10_000
    &&Date.now()-Date.parse(value.checkedAt)<20_000,'AMORA_WRITER_ARCHIVE_PRIVATE_METADATA_INVALID');
  const directory=resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery',recoveryId);
  const cipher=leaf(join(directory,'original7-canonical-update-acl.dpapi'),263168);
  try{ok(cipher.length===value.encryptedBytes&&digest(cipher)===value.encryptedSha256,'AMORA_WRITER_ARCHIVE_PRIVATE_DRIFT');}
  finally{cipher.fill(0);}
  return {value,directory};
}
function journal(input,directory,mode='rehearse'){
  const file=mode==='apply'?'apply.jsonl':'rehearsal.jsonl';
  const evidence=JSON.parse(helper(input.repoRoot,JOURNAL,['-RecoveryId',input.recoveryId,'-Mode',mode]));
  ok(evidence.format==='amora-action-writer-retirement-original7-private-journal-v1'&&evidence.recoveryId===input.recoveryId
    &&evidence.projectRef===PROJECT&&evidence.file===file&&evidence.privateAclVerified===true
    &&CHECKED_TIME.test(evidence.checkedAt)&&Date.now()-Date.parse(evidence.checkedAt)>=-10_000
    &&Date.now()-Date.parse(evidence.checkedAt)<20_000,
  'AMORA_WRITER_ARCHIVE_JOURNAL_INVALID');
  const bytes=leaf(join(directory,file),262144);
  try{ok(bytes.length===evidence.byteLength&&digest(bytes)===evidence.sha256,'AMORA_WRITER_ARCHIVE_JOURNAL_INVALID');
    const records=new TextDecoder('utf8',{fatal:true}).decode(bytes).trim().split('\n').map(line=>JSON.parse(line));
    if(mode==='apply')return {records,sha256:digest(bytes)};
    const intents=records.filter(record=>record.status==='rehearsal-intent');ok(intents.length===1,'AMORA_WRITER_ARCHIVE_JOURNAL_INVALID');
    const intent=intents[0];
    ok(intent.format==='amora-writer-retirement-original7-operational-rehearsal-v1'&&intent.originalFunctionCount===7
      &&intent.sourceCommit===ARCHIVE_COMMIT&&intent.artifactSha256===input.expectedArtifactSha256&&intent.collectorSha256===COLLECTOR
      &&intent.release==='amora-action-writer-retirement-transport-20261013'&&typeof intent.deadline==='string'&&TIME.test(intent.deadline),
    'AMORA_WRITER_ARCHIVE_JOURNAL_INVALID');return {intent,sha256:digest(bytes)};
  }finally{bytes.fill(0);}
}
function applyContext(input,directory,intent){
  const observed=journal(input,directory,'apply'),required=['maintenance-installed-and-independently-observed','commit-intent',
    'post7-and-231-independently-observed','cutoff-intent','uninstall-intent','outcome-requires-independent-inspection'];
  let previous=-Infinity,cursor=-1;
  for(const record of observed.records){
    ok(record&&typeof record==='object'&&!Array.isArray(record)&&record.format==='amora-writer-retirement-original7-cutover-journal-v1'
      &&record.release==='amora-action-writer-retirement-transport-20261013'&&record.sourceCommit===ARCHIVE_COMMIT
      &&record.bundleSha256===intent.bundleSha256&&record.originalFunctionCount===7&&record.deadline===intent.deadline
      &&typeof record.recordedAt==='string'&&TIME.test(record.recordedAt)&&Number.isFinite(Date.parse(record.recordedAt))&&Date.parse(record.recordedAt)>=previous,
      'AMORA_WRITER_ARCHIVE_APPLY_JOURNAL_INVALID');previous=Date.parse(record.recordedAt);
  }
  const selected=required.map(status=>{
    const matches=observed.records.map((record,index)=>({record,index})).filter(value=>value.record.status===status);
    ok(matches.length===1&&matches[0].index>cursor,'AMORA_WRITER_ARCHIVE_APPLY_JOURNAL_INVALID');
    cursor=matches[0].index;return matches[0].record;
  });
  const ids=selected[0].objectIds;keys(ids,['functionId','triggerIds'],'AMORA_WRITER_ARCHIVE_OWN3_IDS_INVALID');
  ok(Number.isSafeInteger(ids.functionId)&&ids.functionId>0&&Array.isArray(ids.triggerIds)&&ids.triggerIds.length===2
    &&ids.triggerIds.every(value=>Number.isSafeInteger(value)&&value>0)&&new Set([ids.functionId,...ids.triggerIds]).size===3,
    'AMORA_WRITER_ARCHIVE_OWN3_IDS_INVALID');
  const outcome=selected.at(-1);
  ok(outcome===observed.records.at(-1)&&outcome.operation==='uninstall'&&outcome.committedOutcomeUnknown===true
    &&outcome.maintenanceRemovalUnknown===true&&outcome.code==='AMORA_WRITER_RETIREMENT_ADMISSION_EXPIRED_OR_CHANGED',
    'AMORA_WRITER_ARCHIVE_APPLY_JOURNAL_INVALID');
  return {objectIds:freeze(structuredClone(ids)),sha256:observed.sha256};
}
function content(bytes,input,intent){
  ok(bytes.length>0&&bytes.length<=262144&&digest(bytes)===input.expectedArtifactSha256,'AMORA_WRITER_ARCHIVE_CONTENT_INVALID');
  const raw=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
  keys(raw,['format','kind','captureEnvironment','projectRef','sourceSystemIdentifier','sourceCommit','expectedOrigin',
    'collectorSourceSha256','bundleSha256','capturedAt','serverVersion','database','currentUser','readOnly','definitions',
    'canonicalTable','b2GuardSlots','stateWitness'],'AMORA_WRITER_ARCHIVE_CONTENT_INVALID');
  const plan=loadAmoraWriterRetirementPlan({repoRoot:input.repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  ok(raw.format==='amora-b2-original7-canonical-update-acl-capsule-v1'&&raw.kind==='b2-scoped-original7-not-b1-original4-or-b2-original6'
    &&raw.captureEnvironment==='supabase-read-only'&&raw.projectRef===PROJECT&&raw.sourceSystemIdentifier===SYSTEM
    &&raw.sourceCommit===ARCHIVE_COMMIT&&raw.expectedOrigin===ORIGIN&&raw.collectorSourceSha256===COLLECTOR
    &&raw.bundleSha256===plan.migration.sha256&&intent.bundleSha256===raw.bundleSha256&&raw.database==='postgres'
    &&typeof raw.serverVersion==='string'&&/^17\./.test(raw.serverVersion)&&['postgres','supabase_read_only_user'].includes(raw.currentUser)
    &&raw.readOnly===true&&typeof raw.capturedAt==='string'&&TIME.test(raw.capturedAt),'AMORA_WRITER_ARCHIVE_CONTENT_INVALID');
  const at=Date.parse(raw.capturedAt),end=Date.parse(intent.deadline);
  ok(Number.isFinite(at)&&Number.isFinite(end)&&end>at&&end<=at+120_000&&end<=Date.now(),
    'AMORA_WRITER_ARCHIVE_NOT_EXPIRED');
  same(raw.definitions,deriveFixedOriginal7FromRepo(input.repoRoot),'AMORA_WRITER_ARCHIVE_ORIGINAL7_DRIFT');
  same(raw.canonicalTable,amoraWriterRetirementOriginalCanonicalAcl(),'AMORA_WRITER_ARCHIVE_ORIGINAL_ACL_DRIFT');
  same(raw.b2GuardSlots,{functions:[],triggers:[]},'AMORA_WRITER_ARCHIVE_ORIGINAL_GUARDS_DRIFT');
  keys(raw.stateWitness,['preservedCatalogSha256','rows','rawLedgerSha256','ledger'],'AMORA_WRITER_ARCHIVE_STATE_INVALID');
  keys(raw.stateWitness.rows,['amoraActionsCount','amoraActionsSha256','journeysCount','journeysSha256'],'AMORA_WRITER_ARCHIVE_STATE_INVALID');
  ok(['preservedCatalogSha256','rawLedgerSha256'].every(key=>typeof raw.stateWitness[key]==='string'&&SHA.test(raw.stateWitness[key]))
    &&['amoraActionsCount','journeysCount'].every(key=>Number.isSafeInteger(raw.stateWitness.rows[key])&&raw.stateWitness.rows[key]>=0)
    &&['amoraActionsSha256','journeysSha256'].every(key=>typeof raw.stateWitness.rows[key]==='string'&&SHA.test(raw.stateWitness.rows[key])),
  'AMORA_WRITER_ARCHIVE_STATE_INVALID');
  validateAmoraWriterRetirementLedger(raw.stateWitness.ledger,plan.expectedBefore230);return freeze(raw);
}

/** Expired private bytes are historical content, never a renewed live capture or CI/DB capability. */
export async function collectAmoraWriterRetirementArchivedOriginal(input){
  keys(input,['repoRoot','expectedCommit','archiveSourceCommit','recoveryId','expectedArtifactSha256']);
  ok(process.platform==='win32'&&typeof process.env.LOCALAPPDATA==='string'&&typeof input.repoRoot==='string'
    &&typeof input.expectedCommit==='string'&&COMMIT.test(input.expectedCommit)&&input.archiveSourceCommit===ARCHIVE_COMMIT
    &&typeof input.recoveryId==='string'&&UUID.test(input.recoveryId)
    &&typeof input.expectedArtifactSha256==='string'&&SHA.test(input.expectedArtifactSha256));
  safeEnvironment();await resolvePinnedWindowsProductionToolchain({environment:safeEnvironment()});
  const current=source(input.repoRoot,input.expectedCommit),verifierSha256=selfSha();
  const first=privateCheck(input),anchor=journal(input,first.directory),apply=applyContext(input,first.directory,anchor.intent);let bytes;
  try{
    const encoded=helper(input.repoRoot,STORE,['-Mode','read','-RecoveryId',input.recoveryId,'-ExpectedSha256',input.expectedArtifactSha256]);
    ok(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)&&encoded.length<=349528,'AMORA_WRITER_ARCHIVE_CONTENT_INVALID');
    bytes=Buffer.from(encoded,'base64');const raw=content(bytes,input,anchor.intent),last=privateCheck(input);
    same(last.value.encryptedSha256,first.value.encryptedSha256,'AMORA_WRITER_ARCHIVE_PRIVATE_DRIFT');
    same(journal(input,first.directory).sha256,anchor.sha256,'AMORA_WRITER_ARCHIVE_JOURNAL_CHANGED');
    same(applyContext(input,first.directory,anchor.intent).sha256,apply.sha256,'AMORA_WRITER_ARCHIVE_JOURNAL_CHANGED');
    same(source(input.repoRoot,input.expectedCommit),current,'AMORA_WRITER_ARCHIVE_CURRENT_SOURCE_CHANGED');
    ok(selfSha()===verifierSha256,'AMORA_WRITER_ARCHIVE_VERIFIER_CHANGED');
    const proof=freeze({format:'amora-writer-retirement-issued-archived-original7-v1',scope:'historical-protected-original7-content-only',
      archiveSourceCommit:ARCHIVE_COMMIT,currentSourceCommit:input.expectedCommit,currentSourceTree:current.tree,
      artifactSha256:input.expectedArtifactSha256,encryptedSha256:first.value.encryptedSha256,collectorSourceSha256:COLLECTOR,
      sourceObservedAt:raw.capturedAt,originalDeadline:anchor.intent.deadline,originalAuthorityExpired:true,
      privateHistoricalContentVerified:true,verifierSha256,journalSha256:anchor.sha256,verifiedAt:new Date().toISOString(),
      applyJournalSha256:apply.sha256,historicalOwn3ObjectIds:apply.objectIds,
      sourceCiVerified:false,currentSourceCleanVerified:false,collectorExecutionProvenanceVerified:false,
      liveCaptureAuthorityVerified:false,nativeReplayVerified:false,releaseAuthorized:false,remoteWritesPerformed:false});
    issued.set(proof,{input:{...input},current,bytes,raw,encryptedSha256:first.value.encryptedSha256,journalSha256:anchor.sha256,
      applyJournalSha256:apply.sha256,closed:false});
    bytes=undefined;return proof;
  }finally{bytes?.fill(0);}
}
export function assertAmoraWriterRetirementArchivedOriginal(proof,options){
  const state=issued.get(proof);ok(state&&!state.closed,'AMORA_WRITER_ARCHIVE_NOT_ISSUED');
  keys(options,['repoRoot','expectedCommit']);
  ok(options.repoRoot===state.input.repoRoot&&options.expectedCommit===state.input.expectedCommit&&selfSha()===proof.verifierSha256,
    'AMORA_WRITER_ARCHIVE_CURRENT_SOURCE_CHANGED');
  same(source(options.repoRoot,options.expectedCommit),state.current,'AMORA_WRITER_ARCHIVE_CURRENT_SOURCE_CHANGED');
  ok(digest(state.bytes)===proof.artifactSha256,'AMORA_WRITER_ARCHIVE_PRIVATE_DRIFT');
  const checked=privateCheck(state.input);same(checked.value.encryptedSha256,state.encryptedSha256,'AMORA_WRITER_ARCHIVE_PRIVATE_DRIFT');
  const anchor=journal(state.input,checked.directory);
  same(anchor.sha256,state.journalSha256,'AMORA_WRITER_ARCHIVE_JOURNAL_CHANGED');
  same(applyContext(state.input,checked.directory,anchor.intent).sha256,state.applyJournalSha256,'AMORA_WRITER_ARCHIVE_JOURNAL_CHANGED');return proof;
}
/** Only genuinely issued native/post verifiers receive a caller-owned buffer; they must zeroize it in finally. */
export function readAmoraWriterRetirementIssuedHistorical(proof,options){
  assertAmoraWriterRetirementArchivedOriginal(proof,options);const state=issued.get(proof);
  return {bytes:Buffer.from(state.bytes),raw:state.raw,historicalOwn3ObjectIds:proof.historicalOwn3ObjectIds};
}
export function closeAmoraWriterRetirementArchivedOriginal(proof){
  const state=issued.get(proof);ok(state&&!state.closed,'AMORA_WRITER_ARCHIVE_NOT_ISSUED');state.bytes.fill(0);state.closed=true;
}
