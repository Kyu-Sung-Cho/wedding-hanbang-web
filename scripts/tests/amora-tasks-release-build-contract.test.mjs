// 아모라 맡은 일 배포 길의 운영 빌드 정적 계약 시험. 웨딩홀 문의 길의 계약 시험(hall-inquiry-release-build-contract.test.mjs)을
// 옮기고, 이 판에만 있는 것(웨딩홀 문의 길과 36문항 길의 고정 원문 보존, 표식이 빠져도 예전 판으로 내려가지 않음)을 더했다.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASE_COMMIT, FIXTURE, MANIFEST, MIGRATION, PINNED_FILES, PREDECESSOR_SNAPSHOT } from '../amora-tasks-release.mjs';
import { prepareManifest } from '../amora-tasks-release-prepare.mjs';
import { AMORA_TASKS_BUILD_MARKERS, AMORA_TASKS_PREDECESSOR_SNAPSHOT_SHA256,
  validateAmoraTasksProductionBuildContract } from '../amora-tasks-release-build-contract.mjs';
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
// 앞 길 둘의 고정 목록과 그 목록이 고정한 원문. 이 계약은 두 길의 loadPlan 이 그대로 통과하는지도 본다.
const PREVIOUS_LANE_FILES=[...new Set([...HIQ_PINNED_FILES,HIQ_MANIFEST,...WC36_PINNED_FILES,WC36_MANIFEST])];
const OWNER='amora-tasks-static245-only-no-operating-provenance';
const fixtures=[];
// 기본은 옮긴 원문으로 매니페스트를 다시 핀한다(지금 원문과 바이트까지 같다). 그래야 계약 코드를 바꾼 변형이
// "매니페스트 hash 불일치" 한 가지 이유로만 빨개지지 않고 각 검사 자체로 잡힌다. 커밋된 매니페스트는 첫 시험이 그대로 본다.
function fixture({committedManifest=false}={}){
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'atk-static245-'));
  writeFileSync(join(root,'.owner'),OWNER,{flag:'wx'});
  for(const file of new Set([...snapshot.files.map(pin=>pin.file),...vendorFiles,...PINNED_FILES,MANIFEST,...PREVIOUS_LANE_FILES])){
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
const validate=f=>validateAmoraTasksProductionBuildContract({repoRoot:f.root});
const append=(f,file,text='\n')=>writeFileSync(join(f.root,file),Buffer.concat([readFileSync(join(f.root,file)),Buffer.from(text)]));

test('Git-free exact245 with the fixed396 input snapshot admits only a static build contract',()=>{
  const f=fixture({committedManifest:true});assert.equal(existsSync(join(f.root,'.git')),false);
  const result=validate(f);
  assert.equal(result.migrationCount,245);assert.equal(result.preservedPredecessorFiles,396);
  assert.equal(result.baseCommit,BASE_COMMIT);assert.equal(result.vendorManifestCount,3);
  assert.equal(result.scope,'exact245-and-fixed-blocked-vendor-manifest-not-operational-authorization');
  assert.equal(result.previousLaneSqlSha256,loadHallInquiryPlan(f.root).sqlSha256);
  assert.equal(result.olderLaneSqlSha256,loadWeddingCode36Plan(f.root).sqlSha256);
  for(const key of ['controllerReady','releaseAuthorized','runtimeEvidenceVerified','sourceCiVerified','remoteWritesPerformed'])assert.equal(result[key],false);
  assert.equal(result.deploymentBlocked,true);assert.equal(result.controllerManifest,null);assert.ok(Object.isFrozen(result));
  assert.deepEqual([...AMORA_TASKS_BUILD_MARKERS],[MANIFEST,MIGRATION,PREDECESSOR_SNAPSHOT,'apps/web/src/lib/amoraTasks/taskStore.ts']);
});

test('a freshly repinned copy of the actual artifacts still matches the reviewed SQL, catalog and snapshot hashes',()=>{
  const f=fixture();
  const result=validate(f);
  assert.equal(result.sqlSha256,sha(readFileSync(join(sourceRoot,MIGRATION))));
  assert.equal(result.fixtureSha256,sha(readFileSync(join(sourceRoot,FIXTURE))));
  assert.equal(result.predecessorSnapshotSha256,sha(readFileSync(join(sourceRoot,PREDECESSOR_SNAPSHOT))));
  assert.equal(AMORA_TASKS_PREDECESSOR_SNAPSHOT_SHA256,result.predecessorSnapshotSha256);
});

test('every registered build marker exists in the actual checkout, so the app-code marker cannot silently die',()=>{
  for(const file of AMORA_TASKS_BUILD_MARKERS)assert.ok(existsSync(join(sourceRoot,file)),file);
});

test('Next config can synchronously require the static build contract without starting the CLI',()=>{
  const loaded=createRequire(import.meta.url)(join(sourceRoot,'scripts/amora-tasks-release-build-contract.mjs'));
  assert.equal(typeof loaded.validateAmoraTasksProductionBuildContract,'function');
  assert.deepEqual(loaded.AMORA_TASKS_BUILD_MARKERS,AMORA_TASKS_BUILD_MARKERS);
});
test('the extracted asynchronous CLI still exits nonzero before any remote work on invalid arguments',()=>{
  const run=args=>spawnSync(process.execPath,[join(sourceRoot,'scripts/amora-tasks-release.mjs'),...args],{
    cwd:sourceRoot,encoding:'utf8',windowsHide:true,timeout:15_000,
  });
  const invalid=run(['--not-an-approved-mode']);
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/AMORA_TASKS_RELEASE_BLOCKED: ATK_ARGUMENT_INVALID/u);
  assert.equal(invalid.stdout,'');
  const check=run(['--check-only','--expected-commit=main']);
  assert.equal(check.status,1);assert.match(check.stderr,/ATK_LOCAL_CHECK_ARGUMENT_INVALID/u);
  assert.equal(check.stdout,'');
});

for(const file of PINNED_FILES){
  test(`missing reviewed artifact fails closed: ${file}`,()=>{
    const f=fixture();unlinkSync(join(f.root,file));assert.throws(()=>validate(f));
  });
  test(`changed reviewed artifact fails closed: ${file}`,()=>{
    const f=fixture();append(f,file);
    assert.throws(()=>validate(f),/ATK_ARTIFACT_HASH_MISMATCH/u);
  });
}
test('a missing or malformed release manifest is never a fallback signal',()=>{
  const f=fixture();unlinkSync(join(f.root,MANIFEST));assert.throws(()=>validate(f),/ATK_MANIFEST_UNAVAILABLE/u);
  writeFileSync(join(f.root,MANIFEST),'{}\n');assert.throws(()=>validate(f),/ATK_MANIFEST_CONTRACT_INVALID/u);
});
test('repinning a changed immutable snapshot cannot change the reviewed predecessor',()=>{
  const f=fixture();writeFileSync(join(f.root,PREDECESSOR_SNAPSHOT),JSON.stringify({...snapshot,baseCommit:'a'.repeat(40)}));
  f.refresh();assert.throws(()=>validate(f),/ATK_BUILD_SNAPSHOT_HASH_MISMATCH/u);
});
test('repinning modified SQL or PG fixture cannot admit an unreviewed artifact',()=>{
  const f=fixture(),sql=readFileSync(join(f.root,MIGRATION)),catalog=readFileSync(join(f.root,FIXTURE));
  // 머리 주석 한 줄만 다른 SQL 이다. 정적 검사를 다 통과하도록 catalog 고정 파일의 SQL hash 도 함께 맞춘다.
  const changed=Buffer.concat([Buffer.from('-- a different review input\n'),sql]);
  writeFileSync(join(f.root,MIGRATION),changed);
  writeFileSync(join(f.root,FIXTURE),JSON.stringify({...JSON.parse(catalog.toString('utf8')),migrationSha256:sha(changed)},null,2)+'\n');
  f.refresh();assert.throws(()=>validate(f),/ATK_BUILD_REVIEWED_ARTIFACT_CHANGED/u);
  writeFileSync(join(f.root,MIGRATION),sql);writeFileSync(join(f.root,FIXTURE),Buffer.concat([catalog,Buffer.from('\n')]));f.refresh();
  assert.throws(()=>validate(f),/ATK_BUILD_REVIEWED_ARTIFACT_CHANGED/u);
});
for(const prefix of ['scripts/lib/','supabase/migrations/','supabase/release-contracts/']){
  test(`a changed or missing old input remains rejected: ${prefix}`,()=>{
    const f=fixture(),file=snapshot.files.find(pin=>pin.file.startsWith(prefix)).file;
    append(f,file);assert.throws(()=>validate(f),/ATK_BUILD_PREDECESSOR_PIN_CHANGED/u);
    unlinkSync(join(f.root,file));assert.throws(()=>validate(f));
  });
}
for(const file of ['20990101000000_unreviewed.sql','20200101000000_unreviewed.sql','unexpected.SQL']){
  test(`additional SQL is rejected without filtering: ${file}`,()=>{
    const f=fixture();writeFileSync(join(f.root,'supabase/migrations',file),'SELECT 1;\n',{flag:'wx'});
    assert.throws(()=>validate(f),/ATK_BUILD_MIGRATION_SET_DRIFT/u);
  });
}
test('a linked artifact directory is rejected even when its contents are identical',()=>{
  const f=fixture(),source=join(f.root,'supabase/release-contracts'),target=join(f.root,'owned-real-contracts');
  for(const path of [source,target]){const delta=relative(f.root,path);assert.ok(delta&&!isAbsolute(delta)&&!delta.startsWith(`..${sep}`));}
  renameSync(source,target);symlinkSync(target,source,'junction');
  // loadPlan deliberately wraps an unsafe manifest path as unavailable.
  assert.throws(()=>validate(f),/ATK_MANIFEST_UNAVAILABLE/u);
});
for(const file of vendorFiles){
  test(`all fixed blocked vendor chain bytes remain required: ${file}`,()=>{
    const f=fixture();append(f,file,' ');
    assert.throws(()=>validate(f),/ATK_BUILD_VENDOR_PIN_CHANGED/u);
  });
}
// 앞 길 둘의 실행기·catalog·준비·빌드 계약(과 웨딩홀 문의 길의 fixture 빌더)은 기준 스냅숏 밖에 있다.
// 그 원문은 각 길의 loadPlan 으로만 지켜진다. 두 길의 매니페스트·SQL·고정 JSON 은 스냅숏이 지킨다.
test('the previous lanes keep their runner scripts outside the predecessor snapshot, so only the previous-lane check guards them',()=>{
  assert.deepEqual(PREVIOUS_LANE_FILES.filter(file=>!inSnapshot.has(file)).sort(),[
    'scripts/hall-inquiry-release-build-contract.mjs','scripts/hall-inquiry-release-catalog.mjs','scripts/hall-inquiry-release-fixture.mjs',
    'scripts/hall-inquiry-release-prepare.mjs','scripts/hall-inquiry-release.mjs',
    'scripts/wedding-code36-release-build-contract.mjs','scripts/wedding-code36-release-catalog.mjs',
    'scripts/wedding-code36-release-prepare.mjs','scripts/wedding-code36-release.mjs']);
  assert.ok(inSnapshot.has(HIQ_MANIFEST));assert.ok(inSnapshot.has(WC36_MANIFEST));
});
for(const file of PREVIOUS_LANE_FILES){
  const code=inSnapshot.has(file)?'ATK_BUILD_PREDECESSOR_PIN_CHANGED':'ATK_BUILD_PREVIOUS_LANE_CHANGED';
  test(`a changed previous-lane artifact is rejected (${code}): ${file}`,()=>{
    const f=fixture();append(f,file);
    assert.throws(()=>validate(f),new RegExp(code,'u'));
    if(!inSnapshot.has(file)){unlinkSync(join(f.root,file));assert.throws(()=>validate(f),/ATK_BUILD_PREVIOUS_LANE_CHANGED/u);}
  });
}
test('never falls back: with an amora-tasks marker missing the contract still refuses, though the hall-inquiry lane alone would pass',()=>{
  for(const marker of AMORA_TASKS_BUILD_MARKERS.filter(file=>!file.endsWith('.ts'))){
    const f=fixture();unlinkSync(join(f.root,marker));assert.throws(()=>validate(f),marker);
  }
  // 아모라 맡은 일 SQL 을 빼면 정확히 244개가 되어 웨딩홀 문의 계약은 통과한다. 그래서 내려가는 길이 있으면 안 된다.
  const f=fixture();unlinkSync(join(f.root,MIGRATION));
  assert.doesNotThrow(()=>validateHallInquiryProductionBuildContract({repoRoot:f.root}));
  assert.throws(()=>validate(f));
});
test('options cannot supply a fake source, identity, migration count or authorization',()=>{
  for(const options of [undefined,{},[],{repoRoot:'.'},{repoRoot:sourceRoot,authorization:'anything'},{repoRoot:sourceRoot,migrationCount:245}]){
    assert.throws(()=>validateAmoraTasksProductionBuildContract(options),/ATK_BUILD_OPTIONS_INVALID/u);
  }
});
