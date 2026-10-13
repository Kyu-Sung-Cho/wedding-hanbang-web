import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,digestJson,pinnedArtifact,requireRelease,same} from './current-baseline-release-contract.mjs';
import {loadAmoraActionViewV2Plan} from './amora-action-view-v2-release-contract.mjs';
import {buildAmoraActionViewV2ObservationSql} from './amora-action-view-v2-catalog.mjs';
import {buildAmoraActionViewV2OriginalReplaySql,buildAmoraActionViewV2RecoveryCaptureSql,validateAmoraActionViewV2RecoveryCapsule}
  from './amora-action-view-v2-recovery.mjs';

const SHA=/^[a-f0-9]{64}$/;
const issued=new WeakMap();
const OWNED_HELPER={file:'scripts/tests/fixtures/profile-role-native-database.mjs',
  sha256:'053348a84f416be24918ad8286ea9dd28927a5bec39ca5a08209c75e55b3b210'};
const DRAFT_FIXTURE={file:'supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs',
  sha256:'41d33e99762bf3d76ef40b96c7abe4f7098754078ed7e3fcc8cad69290d02e7b'};
const BINARIES=Object.freeze({
  'initdb.exe':'2556d079888bf9ebba6b8ba7d3e8c08c947e6e564ceb73054fe1929611c87d48',
  'postgres.exe':'882a5a073a88817f6c6d4c8827df1e4269ff226d52cf6f47c9883e91088c6345',
  'pg_ctl.exe':'abe89b0767a8cd0f956059aa5a5a93cd1042efc6194d000c2501da3e23babbd2',
  'pg_dump.exe':'e01d19b862085eb1fe12c54cdfd07fd691533e5fe8363ae6cf27a423fffd815a',
  'pg_restore.exe':'900de0096d68993acd46b25db1cd909e8a197760b56b7f12f7a631be1fbedf64',
});
const moduleSha=()=>digest(readFileSync(new URL(import.meta.url)));
const recoverySha=()=>digest(readFileSync(new URL('./amora-action-view-v2-recovery.mjs',import.meta.url)));
const identities=['public.lock_own_amora_action_couple(uuid)',
  'public.mutate_own_amora_action(uuid,text,text,jsonb)',
  'public.update_own_legacy_amora_action(uuid,uuid,text,bigint,jsonb)',
  'public.validate_manual_amora_action_values(jsonb,boolean)'];

function toolchain(repoRoot) {
  requireRelease(process.platform==='win32'&&typeof process.env.LOCALAPPDATA==='string'
    &&!process.env.HANBANG_SYNTHETIC_PG_BIN,'AMORA_VIEW_V2_NATIVE_TOOLCHAIN_REQUIRED');
  pinnedArtifact(repoRoot,OWNED_HELPER);pinnedArtifact(repoRoot,DRAFT_FIXTURE);
  const bin=resolve(process.env.LOCALAPPDATA,'WeddingHanbangTools/postgresql-17.10/pgsql/bin');
  requireRelease(realpathSync(bin)===bin,'AMORA_VIEW_V2_NATIVE_TOOLCHAIN_CHANGED');
  for(let cursor=bin;dirname(cursor)!==cursor;cursor=dirname(cursor))
    requireRelease(lstatSync(cursor).isDirectory()&&!lstatSync(cursor).isSymbolicLink(),
      'AMORA_VIEW_V2_NATIVE_TOOLCHAIN_CHANGED');
  for(const [name,sha] of Object.entries(BINARIES)) {
    const path=join(bin,name),before=lstatSync(path);
    requireRelease(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=64*1024*1024,
      'AMORA_VIEW_V2_NATIVE_TOOLCHAIN_CHANGED');
    const actual=digest(readFileSync(path)),after=lstatSync(path);
    requireRelease(actual===sha&&before.dev===after.dev&&before.ino===after.ino
      &&before.mtimeMs===after.mtimeMs&&before.size===after.size,'AMORA_VIEW_V2_NATIVE_TOOLCHAIN_CHANGED');
  }
  return {helperSha256:OWNED_HELPER.sha256,fixtureSha256:DRAFT_FIXTURE.sha256,binaries:{...BINARIES}};
}

const observe=async f=>{
  const result=await f.db.query(buildAmoraActionViewV2ObservationSql());
  const values=(Array.isArray(result)?result:[result]).flatMap(item=>item.rows??[]).filter(row=>row.observation);
  requireRelease(values.length===1,'AMORA_VIEW_V2_NATIVE_OBSERVATION_INVALID');
  return values[0].observation;
};

// 독립 query는 원문4 전체 SHA/owner/config/실제 ACL 및 원장 원문을 읽는다. 고객 row 원문을 출력하지 않는다.
async function independent(f) {
  const funcs=(await f.db.query(`SELECT 'public.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')' AS identity,
    pg_get_functiondef(p.oid) AS definition,p.proacl::text AS acl,p.proconfig AS config,
    pg_get_userbyid(p.proowner) AS owner FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
    AND p.proname=ANY($1::text[]) ORDER BY p.proname`,[identities.map(id=>id.slice(7,id.indexOf('(')))])).rows;
  const trigger=(await f.db.query(`SELECT tgname,tgenabled,pg_get_triggerdef(oid,true) AS definition
    FROM pg_trigger WHERE tgrelid='public.amora_actions'::regclass AND tgname='set_amora_actions_updated_at'`)).rows;
  const ledger=(await f.db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
  return {functions:funcs.map(({definition,...row})=>({...row,definitionSha256:digest(definition)})),trigger,
    ledgerSha256:digestJson(ledger)};
}

/** 실제 원본 bytes를 소유 loopback PG17에 설치해 복구한다. 운영 접속/임의 SQL/factory 인자가 없다. */
export async function runAmoraActionViewV2NativeRecovery(args) {
  requireRelease(args&&typeof args==='object'&&!Array.isArray(args)
    &&Object.keys(args).sort().join(',')==='bytes,contentReceipt,deadline,expectedArtifactSha256,expectedCollectorSha256,expectedCommit,repoRoot',
  'AMORA_VIEW_V2_NATIVE_RECOVERY_ARGUMENT_INVALID');
  const {repoRoot,bytes,contentReceipt,expectedArtifactSha256,expectedCommit,expectedCollectorSha256,deadline}=args;
  requireRelease(Buffer.isBuffer(bytes)&&SHA.test(expectedArtifactSha256??'')&&digest(bytes)===expectedArtifactSha256,
    'AMORA_VIEW_V2_NATIVE_RECOVERY_ARTIFACT_INVALID');
  let raw;
  try {raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {requireRelease(false,'AMORA_VIEW_V2_NATIVE_RECOVERY_ARTIFACT_INVALID');}
  // native-source 결과는 아래 운영용 assertion에서 거절한다. source ID나 캡처시각을 치환하지 않는다.
  requireRelease(['supabase-read-only','owned-native-pg17'].includes(raw.captureEnvironment),
    'AMORA_VIEW_V2_NATIVE_RECOVERY_SOURCE_INVALID');
  const nativeSource=raw.captureEnvironment==='owned-native-pg17';
  const plan=loadAmoraActionViewV2Plan(repoRoot),executorSha256=moduleSha(),verifierSha256=recoverySha();
  // WeakMap-issued 여부를 실제 renderer에 먼저 확인한다. 이 SQL은 실행하지 않는다.
  buildAmoraActionViewV2OriginalReplaySql({repoRoot,capsule:contentReceipt,
    expectedSystemIdentifier:nativeSource?raw.sourceSystemIdentifier:'1000000000000000000',deadline});
  requireRelease(contentReceipt.artifactSha256===expectedArtifactSha256
    &&contentReceipt.verifierSha256===verifierSha256,'AMORA_VIEW_V2_NATIVE_RECOVERY_CONTENT_NOT_BOUND');
  const checked=validateAmoraActionViewV2RecoveryCapsule({repoRoot,bytes,expectedArtifactSha256,expectedCommit,
    expectedCollectorSha256,deadline,...(nativeSource?{expectedNativeSystemIdentifier:raw.sourceSystemIdentifier}:{})});
  requireRelease(nativeSource?checked.sourceSystemIdentifier!==plan.contract.systemIdentifier
    :checked.sourceSystemIdentifier===plan.contract.systemIdentifier,'AMORA_VIEW_V2_NATIVE_RECOVERY_SOURCE_INVALID');
  const pins=toolchain(repoRoot);
  // 고정 fixture는 독립 원문4가 참조하는 최소 schema와 합성 rows만 만든다. 실제 고객 DB 복제/전체 restore가 아니다.
  const fixtureUrl=new URL('../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs',import.meta.url);
  requireRelease(resolve(repoRoot,DRAFT_FIXTURE.file)===resolve(fileURLToPath(fixtureUrl)),
    'AMORA_VIEW_V2_NATIVE_RECOVERY_SOURCE_INVALID');
  const {createDraftDatabase}=await import(fixtureUrl);
  let f,proof,closed=false;
  try {
    f=await createDraftDatabase({native:true,candidate:false});
    await f.exec(raw.dependency.definition);
    const grantees=raw.dependency.acl.map(row=>row[0]);
    requireRelease(grantees.every(name=>['PUBLIC','anon','authenticated','postgres','service_role'].includes(name)),
      'AMORA_VIEW_V2_NATIVE_RECOVERY_ORIGINAL_DRIFT');
    await f.exec('ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres; ALTER FUNCTION public.update_updated_at_column() RESET ALL; REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO '+grantees.join(',')+';');
    await f.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])');
    const before=await observe(f),original=await independent(f);
    requireRelease(before.database==='postgres'&&before.currentUser==='postgres'&&/^17\./.test(before.serverVersion)
      &&before.systemIdentifier!==plan.contract.systemIdentifier,'AMORA_VIEW_V2_NATIVE_RECOVERY_LOCAL_DESTINATION_REQUIRED');
    same(before.target,raw.target,'AMORA_VIEW_V2_NATIVE_RECOVERY_ORIGINAL_DRIFT');
    same(original.functions.map(row=>({identity:row.identity,sha256:row.definitionSha256})),
      raw.definitions.map(row=>({identity:row.identity,sha256:row.sha256})).sort((a,b)=>a.identity.localeCompare(b.identity)),
    'AMORA_VIEW_V2_NATIVE_RECOVERY_ORIGINAL_DRIFT');
    // 검증 원문을 설치한 새 소유 cluster에서 실제 READ ONLY capture를 다시 실행한다.
    // 원래 capsule의 source ID/시각/row digest를 로컬 값으로 바꾸어 재발급하지 않는다.
    const nativeCaptureSql=buildAmoraActionViewV2RecoveryCaptureSql({repoRoot,expectedCommit,
      collectorSourceSha256:executorSha256,captureEnvironment:'owned-native-pg17'});
    const nativeCaptureResults=await f.db.query(nativeCaptureSql);
    const nativeCapsules=(Array.isArray(nativeCaptureResults)?nativeCaptureResults:[nativeCaptureResults])
      .flatMap(item=>item.rows??[]).filter(row=>row.recovery_capsule);
    requireRelease(nativeCapsules.length===1,'AMORA_VIEW_V2_NATIVE_RECOVERY_RESPONSE_INVALID');
    const nativeRaw=nativeCapsules[0].recovery_capsule,nativeBytes=Buffer.from(JSON.stringify(nativeRaw));
    const nativeArtifactSha256=digest(nativeBytes);
    let nativeContent;
    try {
      same(nativeRaw.definitions,raw.definitions,'AMORA_VIEW_V2_NATIVE_RECOVERY_ORIGINAL_DRIFT');
      same(nativeRaw.dependency,raw.dependency,'AMORA_VIEW_V2_NATIVE_RECOVERY_ORIGINAL_DRIFT');
      nativeContent=validateAmoraActionViewV2RecoveryCapsule({repoRoot,bytes:nativeBytes,
        expectedArtifactSha256:nativeArtifactSha256,expectedCommit,expectedCollectorSha256:executorSha256,
        expectedNativeSystemIdentifier:before.systemIdentifier,deadline});
    } finally {nativeBytes.fill(0);}
    await f.exec(plan.sql);
    await f.db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',
      [plan.migration.version,plan.migration.name,[plan.sql]]);
    const applied=await observe(f),appliedIndependent=await independent(f);
    same(applied.target,plan.catalogFixture.applied,'AMORA_VIEW_V2_NATIVE_RECOVERY_APPLIED_DRIFT');
    same(applied.rows,before.rows,'AMORA_VIEW_V2_NATIVE_RECOVERY_ROWS_DRIFT');
    same(applied.preservedCatalogMd5,before.preservedCatalogMd5,'AMORA_VIEW_V2_NATIVE_RECOVERY_PRESERVED_DRIFT');
    const sql=buildAmoraActionViewV2OriginalReplaySql({repoRoot,capsule:nativeContent,
      expectedSystemIdentifier:before.systemIdentifier,deadline});
    const result=await f.db.query(sql);
    const evidence=(Array.isArray(result)?result:[result]).flatMap(item=>item.rows??[])
      .filter(row=>row.replay_evidence).map(row=>row.replay_evidence);
    requireRelease(evidence.length===1&&evidence[0].artifactSha256===nativeArtifactSha256
      &&evidence[0].scope==='target-original-replayed-only'&&evidence[0].nativeSystemIdentifier===before.systemIdentifier
      &&evidence[0].originalTargetSha256===evidence[0].restoredOriginalTargetSha256
      &&evidence[0].newFunctionsAndLedgerRetained===true&&evidence[0].productionRecoveryAuthorized===false,
    'AMORA_VIEW_V2_NATIVE_RECOVERY_RESPONSE_INVALID');
    const after=await observe(f),restored=await independent(f);
    same(after.target,{functions:applied.target.functions,timestampTriggers:before.target.timestampTriggers},
      'AMORA_VIEW_V2_NATIVE_RECOVERY_POST_DRIFT');
    for(const key of ['rows','ledger','ledgerMd5','preservedCatalogMd5'])
      same(after[key],applied[key],'AMORA_VIEW_V2_NATIVE_RECOVERY_POST_DRIFT');
    same(restored.functions,original.functions,'AMORA_VIEW_V2_NATIVE_RECOVERY_POST_DRIFT');
    same(restored.trigger,original.trigger,'AMORA_VIEW_V2_NATIVE_RECOVERY_POST_DRIFT');
    same(restored.ledgerSha256,appliedIndependent.ledgerSha256,'AMORA_VIEW_V2_NATIVE_RECOVERY_POST_DRIFT');
    proof={format:'amora-action-view-v2-issued-native-recovery-v1',scope:'target-original-replayed-only',
      artifactSha256:expectedArtifactSha256,captureEnvironment:raw.captureEnvironment,
      sourceSystemIdentifier:raw.sourceSystemIdentifier,nativeArtifactSha256,
      nativeCaptureSqlSha256:digest(nativeCaptureSql),executorSha256,verifierSha256,sourceCommit:expectedCommit,
      collectorSha256:expectedCollectorSha256,actualNativeSystemIdentifier:before.systemIdentifier,
      serverVersion:after.serverVersion,toolchain:pins,originalTargetSha256:digestJson(raw.target),
      localBeforeTargetSha256:digestJson(before.target),localAppliedTargetSha256:digestJson(applied.target),
      localRestoredTargetSha256:digestJson(after.target),localPreservedCatalogMd5:after.preservedCatalogMd5,
      localRowsSha256:digestJson(after.rows),localLedgerSha256:restored.ledgerSha256,
      nativeReplaySqlSha256:digest(sql),nativeReplayVerified:true,independentReobservationVerified:true,
      localSyntheticSchemaAndRows:true,newFunctionsAndLedgerRetained:true,
      entireDatabaseAuthStorageRecoveryVerified:false,productionRecoveryAuthorized:false,deadline};
    await f.close();closed=true;
    same(toolchain(repoRoot),pins,'AMORA_VIEW_V2_NATIVE_TOOLCHAIN_CHANGED');
    requireRelease(moduleSha()===executorSha256&&recoverySha()===verifierSha256&&digest(bytes)===expectedArtifactSha256
      &&Date.now()<Date.parse(deadline),'AMORA_VIEW_V2_NATIVE_RECOVERY_CHANGED_OR_EXPIRED');
    const receipt=Object.freeze({...proof,ownedClusterClosedAndMarkerVerified:true,verifiedAt:new Date().toISOString()});
    issued.set(receipt,{repoRoot,executorSha256,verifierSha256,pins});
    return receipt;
  } finally {
    if(f&&!closed) {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  }
}

/** JSON 재구성/verified:true를 운영 증거로 승격하지 않는다. 실제 executor가 발급한 동일 객체만 인정한다. */
export function assertAmoraActionViewV2NativeRecovery({receipt,artifactSha256,forOperationalUse=true}) {
  const state=issued.get(receipt);
  requireRelease(state&&receipt.artifactSha256===artifactSha256,'AMORA_VIEW_V2_NATIVE_RECOVERY_NOT_ISSUED');
  requireRelease(typeof forOperationalUse==='boolean'&&(!forOperationalUse
    ||receipt.captureEnvironment==='supabase-read-only'),'AMORA_VIEW_V2_NATIVE_RECOVERY_OPERATIONAL_SOURCE_REQUIRED');
  requireRelease(Date.now()<Date.parse(receipt.deadline)&&Date.now()-Date.parse(receipt.verifiedAt)<120_000,
    'AMORA_VIEW_V2_NATIVE_RECOVERY_EXPIRED');
  requireRelease(moduleSha()===state.executorSha256&&recoverySha()===state.verifierSha256,
    'AMORA_VIEW_V2_NATIVE_RECOVERY_CHANGED_OR_EXPIRED');
  same(toolchain(state.repoRoot),state.pins,'AMORA_VIEW_V2_NATIVE_TOOLCHAIN_CHANGED');
  return receipt;
}
