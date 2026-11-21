// 아모라 먼저 챙기기 배포 길의 운영 빌드 정적 계약 시험. 웨딩홀 문의 길의 계약 시험(hall-inquiry-release-build-contract.test.mjs)을
// 그대로 옮기고, 이 판에만 있는 것(SQL 넷, 웨딩홀 문의·36문항 두 길 고정 원문 보존, 표식이 빠져도 예전 판으로 내려가지 않음)을 더했다.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASE_COMMIT, FIXTURE, MANIFEST, MIGRATION_FILES, PINNED_FILES, PREDECESSOR_SNAPSHOT } from '../amora-proactive-release.mjs';
import { prepareManifest } from '../amora-proactive-release-prepare.mjs';
import { AMORA_PROACTIVE_BUILD_MARKERS, AMORA_PROACTIVE_PREDECESSOR_SNAPSHOT_SHA256,
  validateAmoraProactiveProductionBuildContract } from '../amora-proactive-release-build-contract.mjs';
import { loadPlan as loadHallInquiryPlan, MANIFEST as HIQ_MANIFEST, PINNED_FILES as HIQ_PINNED_FILES } from '../hall-inquiry-release.mjs';
import { validateHallInquiryProductionBuildContract } from '../hall-inquiry-release-build-contract.mjs';
import { loadPlan as loadWeddingCode36Plan, MANIFEST as WC36_MANIFEST, PINNED_FILES as WC36_PINNED_FILES } from '../wedding-code36-release.mjs';

const sourceRoot=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const snapshot=JSON.parse(readFileSync(join(sourceRoot,PREDECESSOR_SNAPSHOT),'utf8'));
const inSnapshot=new Set(snapshot.files.map(pin=>pin.file));
const vendorFiles=[];
let vendor='supabase/release-manifests/vendor-disclosure-v2-20260718.json';
while(vendor){vendorFiles.push(vendor);vendor=JSON.parse(readFileSync(join(sourceRoot,vendor),'utf8')).predecessorManifest?.file;}
const OWNER='amora-proactive-static248-only-no-operating-provenance';
const previousLaneFiles=[...HIQ_PINNED_FILES,HIQ_MANIFEST,...WC36_PINNED_FILES,WC36_MANIFEST];
const fixtures=[];
// 기본은 옮긴 원문으로 매니페스트를 다시 핀한다(지금 원문과 바이트까지 같다). 그래야 계약 코드를 바꾼 변형이
// "매니페스트 hash 불일치" 한 가지 이유로만 빨개지지 않고 각 검사 자체로 잡힌다. 커밋된 매니페스트는 첫 시험이 그대로 본다.
function fixture({committedManifest=false}={}){
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'apro-static248-'));
  writeFileSync(join(root,'.owner'),OWNER,{flag:'wx'});
  // 웨딩홀 문의·36문항 길의 고정 원문도 옮긴다. 이 계약은 두 길의 loadPlan 이 그대로 통과하는지도 본다.
  for(const file of new Set([...snapshot.files.map(pin=>pin.file),...vendorFiles,...PINNED_FILES,MANIFEST,...previousLaneFiles])){
    const target=join(root,file);mkdirSync(dirname(target),{recursive:true});
    // Independent bytes, never hardlinks or a filtered view of the actual checkout.
    writeFileSync(target,readFileSync(join(sourceRoot,file)));
  }
  const value={root,refresh(){writeFileSync(join(root,MANIFEST),JSON.stringify(prepareManifest(root),null,2)+'\n');},close(){
    if(!existsSync(root))return;
    assert.equal(dirname(realpathSync(root)),parent);assert.ok(!lstatSync(root).isSymbolicLink());
    assert.equal(readFileSync(join(root,'.owner'),'utf8'),OWNER);
    rmSync(root,{recursive:true,force:false});
  }};fixtures.push(value);if(!committedManifest)value.refresh();return value;
}
after(()=>{for(const f of fixtures)f.close();});
const validate=f=>validateAmoraProactiveProductionBuildContract({repoRoot:f.root});
const append=(f,file,text='\n')=>writeFileSync(join(f.root,file),Buffer.concat([readFileSync(join(f.root,file)),Buffer.from(text)]));

test('Git-free exact248 with the fixed396 input snapshot admits only a static build contract',()=>{
  const f=fixture({committedManifest:true});assert.equal(existsSync(join(f.root,'.git')),false);
  const result=validate(f);
  assert.equal(result.migrationCount,248);assert.equal(result.preservedPredecessorFiles,396);
  assert.equal(result.baseCommit,BASE_COMMIT);assert.equal(result.vendorManifestCount,3);
  assert.equal(result.scope,'exact248-and-fixed-blocked-vendor-manifest-not-operational-authorization');
  assert.equal(result.previousLaneSqlSha256,loadHallInquiryPlan(f.root).sqlSha256);
  assert.equal(result.weddingCode36SqlSha256,loadWeddingCode36Plan(f.root).sqlSha256);
  for(const key of ['controllerReady','releaseAuthorized','runtimeEvidenceVerified','sourceCiVerified','remoteWritesPerformed'])assert.equal(result[key],false);
  assert.equal(result.deploymentBlocked,true);assert.equal(result.controllerManifest,null);assert.ok(Object.isFrozen(result));
  assert.deepEqual([...AMORA_PROACTIVE_BUILD_MARKERS],[MANIFEST,...MIGRATION_FILES,PREDECESSOR_SNAPSHOT,
    'apps/web/src/app/api/amora/care-preferences/route.ts','apps/web/src/lib/amora/push/sendAmoraPush.ts']);
});

test('a freshly repinned copy of the actual artifacts still matches the reviewed SQL, catalog and snapshot hashes',()=>{
  const f=fixture();
  const result=validate(f);
  assert.deepEqual([...result.sqlSha256s],MIGRATION_FILES.map(file=>sha(readFileSync(join(sourceRoot,file)))));
  assert.equal(result.fixtureSha256,sha(readFileSync(join(sourceRoot,FIXTURE))));
  assert.equal(result.predecessorSnapshotSha256,sha(readFileSync(join(sourceRoot,PREDECESSOR_SNAPSHOT))));
  assert.equal(AMORA_PROACTIVE_PREDECESSOR_SNAPSHOT_SHA256,result.predecessorSnapshotSha256);
});

test('every registered build marker exists in the actual checkout, so the app-code markers cannot silently die',()=>{
  for(const file of AMORA_PROACTIVE_BUILD_MARKERS)assert.ok(existsSync(join(sourceRoot,file)),file);
});

test('Next config can synchronously require the static build contract without starting the CLI',()=>{
  const loaded=createRequire(import.meta.url)(join(sourceRoot,'scripts/amora-proactive-release-build-contract.mjs'));
  assert.equal(typeof loaded.validateAmoraProactiveProductionBuildContract,'function');
  assert.deepEqual(loaded.AMORA_PROACTIVE_BUILD_MARKERS,AMORA_PROACTIVE_BUILD_MARKERS);
});
test('the extracted asynchronous CLI still exits nonzero before any remote work on invalid arguments',()=>{
  const run=args=>spawnSync(process.execPath,[join(sourceRoot,'scripts/amora-proactive-release.mjs'),...args],{
    cwd:sourceRoot,encoding:'utf8',windowsHide:true,timeout:15_000,
  });
  const invalid=run(['--not-an-approved-mode']);
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/AMORA_PROACTIVE_RELEASE_BLOCKED: APRO_ARGUMENT_INVALID/u);
  assert.equal(invalid.stdout,'');
  const check=run(['--check-only','--expected-commit=main']);
  assert.equal(check.status,1);assert.match(check.stderr,/APRO_LOCAL_CHECK_ARGUMENT_INVALID/u);
  assert.equal(check.stdout,'');
});

for(const file of PINNED_FILES){
  test(`missing reviewed artifact fails closed: ${file}`,()=>{
    const f=fixture();unlinkSync(join(f.root,file));assert.throws(()=>validate(f));
  });
  test(`changed reviewed artifact fails closed: ${file}`,()=>{
    const f=fixture();append(f,file);
    assert.throws(()=>validate(f),/APRO_ARTIFACT_HASH_MISMATCH/u);
  });
}
test('a missing or malformed release manifest is never a fallback signal',()=>{
  const f=fixture();unlinkSync(join(f.root,MANIFEST));assert.throws(()=>validate(f),/APRO_MANIFEST_UNAVAILABLE/u);
  writeFileSync(join(f.root,MANIFEST),'{}\n');assert.throws(()=>validate(f),/APRO_MANIFEST_CONTRACT_INVALID/u);
});
test('repinning a changed immutable snapshot cannot change the reviewed predecessor',()=>{
  const f=fixture();writeFileSync(join(f.root,PREDECESSOR_SNAPSHOT),JSON.stringify({...snapshot,baseCommit:'a'.repeat(40)}));
  f.refresh();assert.throws(()=>validate(f),/APRO_BUILD_SNAPSHOT_HASH_MISMATCH/u);
});
for(const [index,file] of MIGRATION_FILES.entries()){
  test(`repinning a modified SQL file or the PG fixture cannot admit an unreviewed artifact: ${file}`,()=>{
    const f=fixture(),sql=readFileSync(join(f.root,file)),catalog=readFileSync(join(f.root,FIXTURE));
    // 머리 주석 한 줄만 다른 SQL 이다. 정적 검사를 다 통과하도록 catalog 고정 파일의 SQL hash 도 함께 맞춘다.
    const changed=Buffer.concat([Buffer.from('-- a different review input\n'),sql]);
    writeFileSync(join(f.root,file),changed);
    const value=JSON.parse(catalog.toString('utf8'));value.migrations[index].sha256=sha(changed);
    writeFileSync(join(f.root,FIXTURE),JSON.stringify(value,null,2)+'\n');
    f.refresh();assert.throws(()=>validate(f),/APRO_BUILD_REVIEWED_ARTIFACT_CHANGED/u);
    writeFileSync(join(f.root,file),sql);writeFileSync(join(f.root,FIXTURE),Buffer.concat([catalog,Buffer.from('\n')]));f.refresh();
    assert.throws(()=>validate(f),/APRO_BUILD_REVIEWED_ARTIFACT_CHANGED/u);
  });
}
for(const prefix of ['scripts/lib/','supabase/migrations/','supabase/release-contracts/']){
  test(`a changed or missing old input remains rejected: ${prefix}`,()=>{
    const f=fixture(),file=snapshot.files.find(pin=>pin.file.startsWith(prefix)).file;
    append(f,file);assert.throws(()=>validate(f),/APRO_BUILD_PREDECESSOR_PIN_CHANGED/u);
    unlinkSync(join(f.root,file));assert.throws(()=>validate(f));
  });
}
// 앞선 길의 원문은 이 길의 기준 스냅숏 안에 있다(웨딩홀 문의 SQL·매니페스트·catalog·스냅숏).
test('the hall-inquiry SQL and release contracts are pinned by this snapshot, not only by the previous lane',()=>{
  for(const file of ['supabase/migrations/20261117090000_hall_listings_and_inquiries.sql',HIQ_MANIFEST,
    'supabase/release-contracts/hall-inquiry-pg-catalog-v1.json','supabase/release-contracts/hall-inquiry-predecessor-build-inputs-v1.json']){
    assert.ok(inSnapshot.has(file),file);
    const f=fixture();append(f,file);assert.throws(()=>validate(f),/APRO_BUILD_PREDECESSOR_PIN_CHANGED/u,file);
  }
});
for(const file of ['20990101000000_unreviewed.sql','20200101000000_unreviewed.sql','unexpected.SQL']){
  test(`additional SQL is rejected without filtering: ${file}`,()=>{
    const f=fixture();writeFileSync(join(f.root,'supabase/migrations',file),'SELECT 1;\n',{flag:'wx'});
    assert.throws(()=>validate(f),/APRO_BUILD_MIGRATION_SET_DRIFT/u);
  });
}
test('a linked artifact directory is rejected even when its contents are identical',()=>{
  const f=fixture(),source=join(f.root,'supabase/release-contracts'),target=join(f.root,'owned-real-contracts');
  for(const path of [source,target]){const delta=relative(f.root,path);assert.ok(delta&&!isAbsolute(delta)&&!delta.startsWith(`..${sep}`));}
  renameSync(source,target);symlinkSync(target,source,'junction');
  // loadPlan deliberately wraps an unsafe manifest path as unavailable.
  assert.throws(()=>validate(f),/APRO_MANIFEST_UNAVAILABLE/u);
});
for(const file of vendorFiles){
  test(`all fixed blocked vendor chain bytes remain required: ${file}`,()=>{
    const f=fixture();append(f,file,' ');
    assert.throws(()=>validate(f),/APRO_BUILD_VENDOR_PIN_CHANGED/u);
  });
}
// 앞선 두 길의 실행기·catalog·준비·빌드 계약은 기준 스냅숏 밖에 있다. 그 원문은 그 길의 loadPlan 으로만 지켜진다.
test('the previous-lane scripts are outside the predecessor snapshot, so only the previous-lane check guards them',()=>{
  assert.deepEqual(previousLaneFiles.filter(file=>!inSnapshot.has(file)).sort(),['scripts/hall-inquiry-release-build-contract.mjs',
    'scripts/hall-inquiry-release-catalog.mjs','scripts/hall-inquiry-release-fixture.mjs','scripts/hall-inquiry-release-prepare.mjs',
    'scripts/hall-inquiry-release.mjs','scripts/wedding-code36-release-build-contract.mjs','scripts/wedding-code36-release-catalog.mjs',
    'scripts/wedding-code36-release-prepare.mjs','scripts/wedding-code36-release.mjs']);
  assert.ok(inSnapshot.has(HIQ_MANIFEST));assert.ok(inSnapshot.has(WC36_MANIFEST));
});
for(const file of new Set(previousLaneFiles)){
  const code=inSnapshot.has(file)?'APRO_BUILD_PREDECESSOR_PIN_CHANGED':'APRO_BUILD_PREVIOUS_LANE_CHANGED';
  test(`a changed previous-lane artifact is rejected (${code}): ${file}`,()=>{
    const f=fixture();append(f,file);
    assert.throws(()=>validate(f),new RegExp(code,'u'));
    if(!inSnapshot.has(file)){unlinkSync(join(f.root,file));assert.throws(()=>validate(f),/APRO_BUILD_PREVIOUS_LANE_CHANGED/u);}
  });
}
test('never falls back: with an amora-proactive marker missing the new contract still refuses, though the hall lane alone would pass',()=>{
  for(const marker of AMORA_PROACTIVE_BUILD_MARKERS.filter(file=>!file.endsWith('.ts'))){
    const f=fixture();unlinkSync(join(f.root,marker));assert.throws(()=>validate(f),marker);
  }
  // 새 SQL 넷을 빼면 정확히 244개가 되어 웨딩홀 문의 계약은 통과한다. 그래서 내려가는 길이 있으면 안 된다.
  const f=fixture();for(const file of MIGRATION_FILES)unlinkSync(join(f.root,file));
  assert.doesNotThrow(()=>validateHallInquiryProductionBuildContract({repoRoot:f.root}));
  assert.throws(()=>validate(f));
});
test('options cannot supply a fake source, identity, migration count or authorization',()=>{
  for(const options of [undefined,{},[],{repoRoot:'.'},{repoRoot:sourceRoot,authorization:'anything'},{repoRoot:sourceRoot,migrationCount:248}]){
    assert.throws(()=>validateAmoraProactiveProductionBuildContract(options),/APRO_BUILD_OPTIONS_INVALID/u);
  }
});
