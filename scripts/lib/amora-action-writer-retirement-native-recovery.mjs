import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,pinnedArtifact,requireRelease,same} from './current-baseline-release-contract.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {readAmoraWriterRetirementPrivateOriginal} from './amora-action-writer-retirement-original-capture.mjs';
import {readAmoraWriterRetirementRecoveryCapsule,validateAmoraWriterRetirementRecoveryCapsule,buildAmoraWriterRetirementRecoveryCaptureSql,buildAmoraWriterRetirementOriginalReplaySql} from './amora-action-writer-retirement-recovery.mjs';
import {deriveFixedApplied7FromRepo} from './amora-action-writer-retirement-original-source.mjs';
import {amoraWriterRetirementOriginalFunctionsSql,amoraWriterRetirementCanonicalAclSql,amoraWriterRetirementGuardSlotsSql,
  amoraWriterRetirementRowsSql,amoraWriterRetirementPreservedCatalogSql,amoraWriterRetirementRawLedgerShaSql} from './amora-action-writer-retirement-state.mjs';

const issued=new WeakMap(),SYSTEM='7581440907192989109';
const fixturePin={file:'scripts/tests/fixtures/amora-action-writer-retirement-recovery-native.mjs',sha256:'14e9902370f689ae8234e92a620342b4e18b306eae690c1c954c7470f1f68c82'};
const pins=[fixturePin,
  {file:'scripts/tests/fixtures/profile-role-native-database.mjs',sha256:'053348a84f416be24918ad8286ea9dd28927a5bec39ca5a08209c75e55b3b210'},
  {file:'supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs',sha256:'41d33e99762bf3d76ef40b96c7abe4f7098754078ed7e3fcc8cad69290d02e7b'},
  {file:'supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs',sha256:'698f10019a144fd44c98e125576d12f2d781ebecd810468653ea471effef2f13'}];
const binaries=Object.freeze({
  'initdb.exe':'2556d079888bf9ebba6b8ba7d3e8c08c947e6e564ceb73054fe1929611c87d48',
  'postgres.exe':'882a5a073a88817f6c6d4c8827df1e4269ff226d52cf6f47c9883e91088c6345',
  'pg_ctl.exe':'abe89b0767a8cd0f956059aa5a5a93cd1042efc6194d000c2501da3e23babbd2',
  'pg_dump.exe':'e01d19b862085eb1fe12c54cdfd07fd691533e5fe8363ae6cf27a423fffd815a',
  'pg_restore.exe':'900de0096d68993acd46b25db1cd909e8a197760b56b7f12f7a631be1fbedf64'});
const selfSha=()=>digest(readFileSync(new URL(import.meta.url)));
const verifierSha=()=>digest(readFileSync(new URL('./amora-action-writer-retirement-recovery.mjs',import.meta.url)));
const files=['amora-action-writer-retirement-original-source.mjs','amora-action-writer-retirement-state.mjs','amora-action-writer-retirement-bundle.mjs'];
const sourceHashes=()=>files.map(file=>({file,sha256:digest(readFileSync(new URL('./'+file,import.meta.url)))}));
function toolchain(root) {
  requireRelease(process.platform==='win32'&&typeof process.env.LOCALAPPDATA==='string'&&!process.env.HANBANG_SYNTHETIC_PG_BIN,'AMORA_WRITER_NATIVE_TOOLCHAIN_REQUIRED');
  for(const pin of pins)pinnedArtifact(root,pin);
  const bin=resolve(process.env.LOCALAPPDATA,'WeddingHanbangTools/postgresql-17.10/pgsql/bin');
  requireRelease(realpathSync(bin)===bin,'AMORA_WRITER_NATIVE_TOOLCHAIN_CHANGED');
  for(let cursor=bin;dirname(cursor)!==cursor;cursor=dirname(cursor))requireRelease(lstatSync(cursor).isDirectory()&&!lstatSync(cursor).isSymbolicLink(),'AMORA_WRITER_NATIVE_TOOLCHAIN_CHANGED');
  for(const [name,sha256] of Object.entries(binaries)) {
    const path=join(bin,name),before=lstatSync(path),bytes=readFileSync(path),after=lstatSync(path);
    requireRelease(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=67108864&&bytes.length===before.size&&digest(bytes)===sha256
      &&before.dev===after.dev&&before.ino===after.ino&&before.mtimeMs===after.mtimeMs&&before.size===after.size,'AMORA_WRITER_NATIVE_TOOLCHAIN_CHANGED');
  }
  return {fixtures:pins,binaries};
}
const row=async(client,sql,alias)=>{
  const result=await client.query(sql),values=(Array.isArray(result)?result:[result]).flatMap(item=>item.rows??[]).filter(item=>item[alias]);
  requireRelease(values.length===1,'AMORA_WRITER_NATIVE_RESPONSE_INVALID');return values[0][alias];
};
const snapshotSql=()=>`BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'functions',${amoraWriterRetirementOriginalFunctionsSql()},'canonicalTable',${amoraWriterRetirementCanonicalAclSql()},
 'guards',${amoraWriterRetirementGuardSlotsSql()},'rows',${amoraWriterRetirementRowsSql()},
 'preservedCatalogSha256',${amoraWriterRetirementPreservedCatalogSql()},'rawLedgerSha256',${amoraWriterRetirementRawLedgerShaSql()}) AS local_snapshot; COMMIT;`;

async function execute({repoRoot,expectedCommit,bytes,contentReceipt,deadline,expectedCollectorSha256,privateOriginal}) {
  const input=readAmoraWriterRetirementRecoveryCapsule(contentReceipt),artifactSha256=digest(bytes),executorSha256=selfSha(),recoverySha256=verifierSha(),implementationHashes=sourceHashes();
  requireRelease(contentReceipt.artifactSha256===artifactSha256&&contentReceipt.sourceCommit===expectedCommit
    &&contentReceipt.collectorSourceSha256===expectedCollectorSha256&&deadline===contentReceipt.deadline,'AMORA_WRITER_NATIVE_ARTIFACT_NOT_BOUND');
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE}),toolchainPins=toolchain(repoRoot);
  validateAmoraWriterRetirementRecoveryCapsule({repoRoot,bytes,expectedArtifactSha256:artifactSha256,expectedCommit,expectedCollectorSha256,deadline,
    expectedNativeSystemIdentifier:privateOriginal?null:input.sourceSystemIdentifier});
  const fixtureUrl=new URL('../tests/fixtures/amora-action-writer-retirement-recovery-native.mjs',import.meta.url);
  requireRelease(resolve(repoRoot,fixturePin.file)===resolve(fileURLToPath(fixtureUrl)),'AMORA_WRITER_NATIVE_SOURCE_INVALID');
  const {createAmoraWriterRetirementRecoveryNativeDatabase}=await import(fixtureUrl);
  let f,independentClient,closed=false;
  try {
    f=await createAmoraWriterRetirementRecoveryNativeDatabase();
    for(const fn of input.definitions)await f.exec(fn.definition);
    const before=await row(f.db,snapshotSql(),'local_snapshot');
    requireRelease(before.systemIdentifier!==SYSTEM,'AMORA_WRITER_NATIVE_LOCAL_DESTINATION_REQUIRED');
    same(before.functions,input.definitions,'AMORA_WRITER_NATIVE_ORIGINAL_DRIFT');
    same(before.canonicalTable,input.canonicalTable,'AMORA_WRITER_NATIVE_ORIGINAL_DRIFT');
    const nativeCaptureSql=buildAmoraWriterRetirementRecoveryCaptureSql({repoRoot,expectedCommit,collectorSourceSha256:executorSha256,expectedNativeSystemIdentifier:before.systemIdentifier});
    const nativeRaw=await row(f.db,nativeCaptureSql,'b2_original7_capsule'),nativeBytes=Buffer.from(JSON.stringify(nativeRaw));
    let localContent;
    try {
      localContent=validateAmoraWriterRetirementRecoveryCapsule({repoRoot,bytes:nativeBytes,expectedArtifactSha256:digest(nativeBytes),expectedCommit,
        expectedCollectorSha256:executorSha256,deadline,expectedNativeSystemIdentifier:before.systemIdentifier});
    } finally {nativeBytes.fill(0);}
    await f.exec(plan.migration.sql);
    await f.db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',[plan.migration.version,plan.migration.name,[plan.migration.sql]]);
    const applied=await row(f.db,snapshotSql(),'local_snapshot');
    same(applied.functions,deriveFixedApplied7FromRepo(repoRoot),'AMORA_WRITER_NATIVE_APPLIED_DRIFT');
    same(applied.rows,before.rows,'AMORA_WRITER_NATIVE_ROWS_DRIFT');
    same(applied.preservedCatalogSha256,before.preservedCatalogSha256,'AMORA_WRITER_NATIVE_PRESERVED_DRIFT');
    const replaySql=buildAmoraWriterRetirementOriginalReplaySql({repoRoot,receipt:localContent,expectedLocalSystemIdentifier:before.systemIdentifier,deadline});
    const evidence=await row(f.db,replaySql,'b2_replay_evidence');
    requireRelease(evidence.scope==='target-original7-update-acl-newguard2-replayed-ledger-retained'
      &&evidence.actualNativeSystemIdentifier===before.systemIdentifier&&evidence.productionRecoveryAuthorized===false,'AMORA_WRITER_NATIVE_REPLAY_INVALID');
    independentClient=await f.newSession();
    const restored=await row(independentClient,snapshotSql(),'local_snapshot');
    same(restored.functions,before.functions,'AMORA_WRITER_NATIVE_RESTORED_DRIFT');
    same(restored.canonicalTable,before.canonicalTable,'AMORA_WRITER_NATIVE_RESTORED_DRIFT');
    same(restored.guards,{functions:[],triggers:[]},'AMORA_WRITER_NATIVE_RESTORED_DRIFT');
    for(const key of ['rows','preservedCatalogSha256','rawLedgerSha256'])same(restored[key],applied[key],'AMORA_WRITER_NATIVE_RESTORED_DRIFT');
    const restoredSha256=digest(JSON.stringify(restored.functions));
    await independentClient.end();independentClient=undefined;await f.close();closed=true;
    same(toolchain(repoRoot),toolchainPins,'AMORA_WRITER_NATIVE_TOOLCHAIN_CHANGED');
    same(sourceHashes(),implementationHashes,'AMORA_WRITER_NATIVE_SOURCE_CHANGED');
    requireRelease(selfSha()===executorSha256&&verifierSha()===recoverySha256&&digest(bytes)===artifactSha256&&Date.now()<Date.parse(deadline),'AMORA_WRITER_NATIVE_CHANGED_OR_EXPIRED');
    const proof=Object.freeze({format:'amora-b2-issued-original7-native-recovery-v1',scope:evidence.scope,artifactSha256,
      sourceCommit:expectedCommit,collectorSourceSha256:expectedCollectorSha256,captureEnvironment:input.captureEnvironment,
      actualNativeSystemIdentifier:before.systemIdentifier,sourceSystemIdentifier:input.sourceSystemIdentifier,
      executorSha256,recoverySha256,implementationHashes,toolchainPins,nativeCaptureSqlSha256:digest(nativeCaptureSql),replaySqlSha256:digest(replaySql),
      original7Sha256:digest(JSON.stringify(before.functions)),restored7Sha256:restoredSha256,localRowsSha256:digest(JSON.stringify(restored.rows)),
      localPreservedCatalogSha256:restored.preservedCatalogSha256,localRawLedgerSha256:restored.rawLedgerSha256,
      nativeReplayVerified:true,independentReobservationVerified:true,ownedClusterClosedAndMarkerVerified:true,
      localSyntheticSchemaAndRows:true,entireDatabaseAuthStorageRecoveryVerified:false,productionRecoveryAuthorized:false,
      privateOriginalLinked:Boolean(privateOriginal),releaseAuthorized:false,remoteWritesPerformed:false,deadline,verifiedAt:new Date().toISOString()});
    issued.set(proof,{repoRoot,expectedCommit,executorSha256,recoverySha256,implementationHashes,toolchainPins,privateOriginal});return proof;
  } finally {await independentClient?.end().catch(()=>{});if(f&&!closed){await f.db.query('ROLLBACK').catch(()=>{});await f.close();}}
}

/** Production original capture must be the actual issued private proof, not caller JSON. No remote connection is used by this executor. */
export async function runAmoraWriterRetirementNativeRecovery(options) {
  requireRelease(options&&Object.keys(options).sort().join(',')==='expectedCommit,privateOriginal,repoRoot','AMORA_WRITER_NATIVE_ARGUMENT_INVALID');
  const {repoRoot,expectedCommit,privateOriginal}=options;
  const original=await readAmoraWriterRetirementPrivateOriginal(privateOriginal,{repoRoot,expectedCommit});
  try {return await execute({repoRoot,expectedCommit,privateOriginal,...original,expectedCollectorSha256:privateOriginal.collectorSourceSha256});}
  finally {original.bytes.fill(0);}
}

/** Fresh owned-native source lane only. Its issued result is explicitly rejected as operating private-original proof. */
export async function runAmoraWriterRetirementNativeSourceRecovery(options) {
  requireRelease(options&&Object.keys(options).sort().join(',')==='bytes,contentReceipt,deadline,expectedCollectorSha256,expectedCommit,repoRoot','AMORA_WRITER_NATIVE_ARGUMENT_INVALID');
  const raw=readAmoraWriterRetirementRecoveryCapsule(options.contentReceipt);
  requireRelease(raw.captureEnvironment==='owned-native-pg17'&&raw.sourceSystemIdentifier!==SYSTEM,'AMORA_WRITER_NATIVE_SOURCE_INVALID');
  return execute(options);
}

export async function assertAmoraWriterRetirementNativeRecovery({receipt,artifactSha256,forOperationalUse=true}) {
  const state=issued.get(receipt);
  requireRelease(state&&receipt.artifactSha256===artifactSha256,'AMORA_WRITER_NATIVE_NOT_ISSUED');
  requireRelease(typeof forOperationalUse==='boolean'&&(!forOperationalUse||state.privateOriginal),'AMORA_WRITER_NATIVE_PRIVATE_ORIGINAL_REQUIRED');
  requireRelease(Date.now()<Date.parse(receipt.deadline)&&selfSha()===state.executorSha256&&verifierSha()===state.recoverySha256,'AMORA_WRITER_NATIVE_EXPIRED_OR_CHANGED');
  same(sourceHashes(),state.implementationHashes,'AMORA_WRITER_NATIVE_SOURCE_CHANGED');same(toolchain(state.repoRoot),state.toolchainPins,'AMORA_WRITER_NATIVE_TOOLCHAIN_CHANGED');
  if(forOperationalUse){const raw=await readAmoraWriterRetirementPrivateOriginal(state.privateOriginal,{repoRoot:state.repoRoot,expectedCommit:state.expectedCommit});raw.bytes.fill(0);}
  return receipt;
}
