import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {requireRelease,digest,digestJson,same,pinnedArtifact} from './current-baseline-release-contract.mjs';
import {assertAmoraWriterRetirementArchivedOriginal,readAmoraWriterRetirementIssuedHistorical} from './amora-action-writer-retirement-archived-original.mjs';
import {buildAmoraWriterRetirementRecoveryCaptureSql,validateAmoraWriterRetirementRecoveryCapsule} from './amora-action-writer-retirement-recovery.mjs';
import {runAmoraWriterRetirementNativeSourceRecovery,assertAmoraWriterRetirementNativeRecovery} from './amora-action-writer-retirement-native-recovery.mjs';

const issued=new WeakMap(),SYSTEM='7581440907192989109';
const fixturePin={file:'scripts/tests/fixtures/amora-action-writer-retirement-recovery-native.mjs',sha256:'14e9902370f689ae8234e92a620342b4e18b306eae690c1c954c7470f1f68c82'};
// 기존 native executor와 동일한 고정 도구·전이 fixture를 첫 import/실행보다 먼저 검사한다.
const nativeBaseline=Object.freeze({
  executorSha256:'c0f1eb8fe1f6ba118dc9a1d8dc21e2e0b43366acef904f0de3e54b2883168b62',
  recoverySha256:'16770b16e2fef8c93b757a756bfffad352fb407a3443dd0e135d9820399d5f34',
  implementationHashes:[
    {file:'amora-action-writer-retirement-original-source.mjs',sha256:'6155ac81019de9a021ce59a5610963456bd4b9f85e5746979ecbc84a952971a2'},
    {file:'amora-action-writer-retirement-state.mjs',sha256:'bef2bfff03bb345c0a5b04a3aa77cabf67f018dfbc5dfc1e33d1304bbb73e17a'},
    {file:'amora-action-writer-retirement-bundle.mjs',sha256:'3b47832b635c588eb32260c6343945e3701cc1f296695305161f30b5e855cb41'},
  ],
  toolchainPins:{fixtures:[fixturePin,
    {file:'scripts/tests/fixtures/profile-role-native-database.mjs',sha256:'053348a84f416be24918ad8286ea9dd28927a5bec39ca5a08209c75e55b3b210'},
    {file:'supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs',sha256:'41d33e99762bf3d76ef40b96c7abe4f7098754078ed7e3fcc8cad69290d02e7b'},
    {file:'supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs',sha256:'698f10019a144fd44c98e125576d12f2d781ebecd810468653ea471effef2f13'},
  ],binaries:{
    'initdb.exe':'2556d079888bf9ebba6b8ba7d3e8c08c947e6e564ceb73054fe1929611c87d48',
    'postgres.exe':'882a5a073a88817f6c6d4c8827df1e4269ff226d52cf6f47c9883e91088c6345',
    'pg_ctl.exe':'abe89b0767a8cd0f956059aa5a5a93cd1042efc6194d000c2501da3e23babbd2',
    'pg_dump.exe':'e01d19b862085eb1fe12c54cdfd07fd691533e5fe8363ae6cf27a423fffd815a',
    'pg_restore.exe':'900de0096d68993acd46b25db1cd909e8a197760b56b7f12f7a631be1fbedf64',
  }},
});
const selfSha=()=>digest(readFileSync(new URL(import.meta.url)));
const ok=(value,code)=>requireRelease(value,code);
const keys=(value,names,code)=>{
  ok(value&&typeof value==='object'&&!Array.isArray(value)&&!types.isProxy(value),code);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  ok(Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(descriptors).every(key=>typeof key==='string'
    &&descriptors[key].enumerable&&Object.hasOwn(descriptors[key],'value'))&&Object.keys(value).sort().join(',')===names.slice().sort().join(','),code);
};
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));

/** Content only. The issuer separately requires the genuine native receipt and closed owned clusters. */
export function validateAmoraWriterRetirementArchivedNativeCompletion(value){
  keys(value,['startedAt','completedAt','nativeCaptureDeadline','nativeReplayVerified','ownedClustersClosedAndMarkerVerified'],
    'AMORA_WRITER_ARCHIVED_NATIVE_COMPLETION_INVALID');
  ok(time(value.startedAt)&&time(value.completedAt)&&time(value.nativeCaptureDeadline)&&value.nativeReplayVerified===true
    &&value.ownedClustersClosedAndMarkerVerified===true&&Date.parse(value.startedAt)<=Date.parse(value.completedAt)
    &&Date.parse(value.completedAt)<Date.parse(value.nativeCaptureDeadline),'AMORA_WRITER_ARCHIVED_NATIVE_COMPLETION_INVALID');
  return Object.freeze({status:'completed-local-replay-content-only',releaseAuthorized:false,productionRecoveryAuthorized:false});
}
function unchangedNativeSources(root,receipt){
  ok(process.platform==='win32'&&typeof process.env.LOCALAPPDATA==='string'
    &&!Object.entries(process.env).some(([name,value])=>/^HANBANG_SYNTHETIC_PG_BIN$/i.test(name)&&value),
  'AMORA_WRITER_ARCHIVED_NATIVE_TOOLCHAIN_REQUIRED');
  ok(digest(readFileSync(join(root,'scripts/lib/amora-action-writer-retirement-native-recovery.mjs')))===receipt.executorSha256
    &&digest(readFileSync(join(root,'scripts/lib/amora-action-writer-retirement-recovery.mjs')))===receipt.recoverySha256,
  'AMORA_WRITER_ARCHIVED_NATIVE_SOURCE_CHANGED');
  for(const item of receipt.implementationHashes)pinnedArtifact(root,{file:'scripts/lib/'+item.file,sha256:item.sha256});
  for(const pin of receipt.toolchainPins.fixtures)pinnedArtifact(root,pin);
  const bin=resolve(process.env.LOCALAPPDATA,'WeddingHanbangTools/postgresql-17.10/pgsql/bin');
  ok(realpathSync(bin)===bin,'AMORA_WRITER_ARCHIVED_NATIVE_TOOLCHAIN_CHANGED');
  for(let cursor=bin;dirname(cursor)!==cursor;cursor=dirname(cursor))ok(lstatSync(cursor).isDirectory()&&!lstatSync(cursor).isSymbolicLink(),
    'AMORA_WRITER_ARCHIVED_NATIVE_TOOLCHAIN_CHANGED');
  for(const [name,sha256] of Object.entries(receipt.toolchainPins.binaries)){
    const path=join(bin,name),before=lstatSync(path),bytes=readFileSync(path),after=lstatSync(path);
    try{ok(before.isFile()&&!before.isSymbolicLink()&&bytes.length===before.size&&before.size>0&&before.size<=67108864
      &&digest(bytes)===sha256&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,
    'AMORA_WRITER_ARCHIVED_NATIVE_TOOLCHAIN_CHANGED');}finally{bytes.fill(0);}
  }
}

/** Archived bytes seed one owned local cluster. Only a real fresh local capture enters the unchanged native-source executor. */
export async function runAmoraWriterRetirementArchivedNativeRecovery(input){
  keys(input,['repoRoot','expectedCommit','archive'],'AMORA_WRITER_ARCHIVED_NATIVE_ARGUMENT_INVALID');
  const {repoRoot,expectedCommit,archive}=input;
  assertAmoraWriterRetirementArchivedOriginal(archive,{repoRoot,expectedCommit});
  unchangedNativeSources(repoRoot,nativeBaseline);
  const executorSha256=selfSha(),startedAt=new Date().toISOString(),historical=readAmoraWriterRetirementIssuedHistorical(archive,{repoRoot,expectedCommit});
  let database,closed=false;
  try{
    const fixtureUrl=new URL('../tests/fixtures/amora-action-writer-retirement-recovery-native.mjs',import.meta.url);
    ok(resolve(repoRoot,fixturePin.file)===resolve(fileURLToPath(fixtureUrl)),'AMORA_WRITER_ARCHIVED_NATIVE_SOURCE_CHANGED');
    const {createAmoraWriterRetirementRecoveryNativeDatabase}=await import(fixtureUrl);
    database=await createAmoraWriterRetirementRecoveryNativeDatabase();
    for(const fn of historical.raw.definitions)await database.exec(fn.definition);
    const actualSystem=(await database.db.query('SELECT system_identifier::text AS identifier FROM pg_control_system()')).rows[0]?.identifier;
    ok(typeof actualSystem==='string'&&/^\d{10,32}$/.test(actualSystem)&&actualSystem!==SYSTEM,
      'AMORA_WRITER_ARCHIVED_NATIVE_LOCAL_DESTINATION_REQUIRED');
    const sql=buildAmoraWriterRetirementRecoveryCaptureSql({repoRoot,expectedCommit,collectorSourceSha256:executorSha256,
      expectedNativeSystemIdentifier:actualSystem});
    const results=await database.db.query(sql),rows=(Array.isArray(results)?results:[results]).flatMap(result=>result.rows??[]);
    ok(rows.length===1&&rows[0]?.b2_original7_capsule,'AMORA_WRITER_ARCHIVED_NATIVE_CAPTURE_INVALID');
    const fresh=rows[0].b2_original7_capsule;
    same(fresh.definitions,historical.raw.definitions,'AMORA_WRITER_ARCHIVED_NATIVE_ORIGINAL7_DRIFT');
    same(fresh.canonicalTable,historical.raw.canonicalTable,'AMORA_WRITER_ARCHIVED_NATIVE_ORIGINAL_ACL_DRIFT');
    ok(fresh.sourceSystemIdentifier===actualSystem&&fresh.captureEnvironment==='owned-native-pg17'
      &&fresh.capturedAt!==historical.raw.capturedAt,'AMORA_WRITER_ARCHIVED_NATIVE_CAPTURE_INVALID');
    const bytes=Buffer.from(JSON.stringify(fresh));let native;
    const nativeCaptureDeadline=new Date(Math.min(Date.now()+120_000,Date.parse(fresh.capturedAt)+120_000)).toISOString();
    try{
      const contentReceipt=validateAmoraWriterRetirementRecoveryCapsule({repoRoot,bytes,expectedArtifactSha256:digest(bytes),
        expectedCommit,expectedCollectorSha256:executorSha256,deadline:nativeCaptureDeadline,expectedNativeSystemIdentifier:actualSystem});
      native=await runAmoraWriterRetirementNativeSourceRecovery({repoRoot,expectedCommit,bytes,contentReceipt,
        expectedCollectorSha256:executorSha256,deadline:nativeCaptureDeadline});
      // The unchanged live native proof is checked inside its own real 120-second window, never renewed.
      await assertAmoraWriterRetirementNativeRecovery({receipt:native,artifactSha256:digest(bytes),forOperationalUse:false});
    }finally{bytes.fill(0);}
    await database.close();closed=true;
    assertAmoraWriterRetirementArchivedOriginal(archive,{repoRoot,expectedCommit});
    same(native.toolchainPins,nativeBaseline.toolchainPins,'AMORA_WRITER_ARCHIVED_NATIVE_TOOLCHAIN_CHANGED');
    unchangedNativeSources(repoRoot,nativeBaseline);unchangedNativeSources(repoRoot,native);
    const completedAt=new Date().toISOString();
    validateAmoraWriterRetirementArchivedNativeCompletion({startedAt,completedAt,nativeCaptureDeadline,
      nativeReplayVerified:native.nativeReplayVerified,ownedClustersClosedAndMarkerVerified:closed&&native.ownedClusterClosedAndMarkerVerified});
    ok(selfSha()===executorSha256,'AMORA_WRITER_ARCHIVED_NATIVE_SOURCE_CHANGED');
    const fact=Object.freeze({format:'amora-writer-retirement-issued-completed-archived-local-replay-v1',scope:'completed-owned-local-original7-replay-fact',
      archiveSourceCommit:archive.archiveSourceCommit,currentSourceCommit:expectedCommit,archiveArtifactSha256:archive.artifactSha256,
      archiveSourceObservedAt:archive.sourceObservedAt,archiveOriginalDeadline:archive.originalDeadline,
      archiveDefinitionsSha256:digestJson(historical.raw.definitions),freshNativeSourceSystemIdentifier:actualSystem,
      freshNativeCapturedAt:fresh.capturedAt,nativeCaptureDeadline,actualReplaySystemIdentifier:native.actualNativeSystemIdentifier,
      nativeOriginal7Sha256:native.original7Sha256,nativeRestored7Sha256:native.restored7Sha256,nativeExecutorSha256:native.executorSha256,
      nativeRecoverySha256:native.recoverySha256,executorSha256,startedAt,completedAt,completedWithinFreshLocalDeadline:true,
      nativeReplayVerified:true,independentNativeReobservationVerified:true,ownedClustersClosedAndMarkerVerified:true,
      localSyntheticSchemaAndRows:true,privateHistoricalOriginal7Linked:true,oldLiveCaptureAuthorityRenewed:false,
      releaseAuthorized:false,productionRecoveryAuthorized:false,remoteWritesPerformed:false,entireDatabaseAuthStorageRecoveryVerified:false});
    issued.set(fact,{repoRoot,expectedCommit,archive,native,executorSha256});return fact;
  }finally{historical.bytes.fill(0);if(database&&!closed)await database.close();}
}

/** A completed local fact is not a live SQL capability. Its historical clocks remain unchanged. */
export function assertAmoraWriterRetirementArchivedNativeRecovery(fact,input){
  const state=issued.get(fact);ok(state,'AMORA_WRITER_ARCHIVED_NATIVE_NOT_ISSUED');
  keys(input,['repoRoot','expectedCommit','archive'],'AMORA_WRITER_ARCHIVED_NATIVE_ARGUMENT_INVALID');
  ok(input.repoRoot===state.repoRoot&&input.expectedCommit===state.expectedCommit&&input.archive===state.archive
    &&selfSha()===state.executorSha256,'AMORA_WRITER_ARCHIVED_NATIVE_SOURCE_CHANGED');
  assertAmoraWriterRetirementArchivedOriginal(state.archive,{repoRoot:state.repoRoot,expectedCommit:state.expectedCommit});
  unchangedNativeSources(state.repoRoot,state.native);return fact;
}
