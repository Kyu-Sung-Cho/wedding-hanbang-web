import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASE_COMMIT, FIXTURE, MANIFEST, MIGRATION, PINNED_FILES } from '../wedding-code36-release.mjs';
import { prepareManifest } from '../wedding-code36-release-prepare.mjs';
import { validateWeddingCode36ProductionBuildContract, WEDDING_CODE36_BUILD_MARKERS,
  WEDDING_CODE36_PREDECESSOR_SNAPSHOT } from '../wedding-code36-release-build-contract.mjs';

const sourceRoot=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const snapshot=JSON.parse(readFileSync(join(sourceRoot,WEDDING_CODE36_PREDECESSOR_SNAPSHOT),'utf8'));
const vendorFiles=[];
let vendor='supabase/release-manifests/vendor-disclosure-v2-20260718.json';
while(vendor){vendorFiles.push(vendor);vendor=JSON.parse(readFileSync(join(sourceRoot,vendor),'utf8')).predecessorManifest?.file;}
const fixtures=[];
function fixture(){
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'wc36-static243-'));
  writeFileSync(join(root,'.owner'),'wc36-static243-only-no-operating-provenance',{flag:'wx'});
  for(const file of new Set([...snapshot.files.map(pin=>pin.file),...vendorFiles,...PINNED_FILES,MANIFEST])){
    const target=join(root,file);mkdirSync(dirname(target),{recursive:true});
    // Independent bytes, never hardlinks or a filtered view of the actual checkout.
    writeFileSync(target,readFileSync(join(sourceRoot,file)));
  }
  const value={root,refresh(){writeFileSync(join(root,MANIFEST),JSON.stringify(prepareManifest(root),null,2)+'\n');},close(){
    if(!existsSync(root))return;
    assert.equal(dirname(realpathSync(root)),parent);assert.ok(!lstatSync(root).isSymbolicLink());
    assert.equal(readFileSync(join(root,'.owner'),'utf8'),'wc36-static243-only-no-operating-provenance');
    rmSync(root,{recursive:true,force:false});
  }};fixtures.push(value);return value;
}
after(()=>{for(const f of fixtures)f.close();});
const validate=f=>validateWeddingCode36ProductionBuildContract({repoRoot:f.root});

test('Git-free exact243 with the fixed388 input snapshot admits only a static build contract',()=>{
  const f=fixture();assert.equal(existsSync(join(f.root,'.git')),false);
  const result=validate(f);
  assert.equal(result.migrationCount,243);assert.equal(result.preservedPredecessorFiles,388);
  assert.equal(result.baseCommit,BASE_COMMIT);assert.equal(result.vendorManifestCount,3);
  for(const key of ['controllerReady','releaseAuthorized','runtimeEvidenceVerified','sourceCiVerified','remoteWritesPerformed'])assert.equal(result[key],false);
  assert.equal(result.deploymentBlocked,true);assert.equal(result.controllerManifest,null);
  assert.deepEqual([...WEDDING_CODE36_BUILD_MARKERS],[MANIFEST,MIGRATION,WEDDING_CODE36_PREDECESSOR_SNAPSHOT,
    'apps/web/src/constants/weddingCode36.ts']);
});

test('Next config can synchronously require the static build contract without starting the CLI',()=>{
  const loaded=createRequire(import.meta.url)(join(sourceRoot,'scripts/wedding-code36-release-build-contract.mjs'));
  assert.equal(typeof loaded.validateWeddingCode36ProductionBuildContract,'function');
  assert.deepEqual(loaded.WEDDING_CODE36_BUILD_MARKERS,WEDDING_CODE36_BUILD_MARKERS);
});
test('the extracted asynchronous CLI still exits nonzero before any remote work on invalid arguments',()=>{
  const result=spawnSync(process.execPath,[join(sourceRoot,'scripts/wedding-code36-release.mjs'),'--not-an-approved-mode'],{
    cwd:sourceRoot,encoding:'utf8',windowsHide:true,timeout:15_000,
  });
  assert.equal(result.status,1);assert.match(result.stderr,/WC36_ARGUMENT_INVALID/u);
  assert.equal(result.stdout,'');
});

for(const file of PINNED_FILES){
  test(`missing reviewed artifact fails closed: ${file}`,()=>{
    const f=fixture();unlinkSync(join(f.root,file));assert.throws(()=>validate(f));
  });
  test(`changed reviewed artifact fails closed: ${file}`,()=>{
    const f=fixture();writeFileSync(join(f.root,file),Buffer.concat([readFileSync(join(f.root,file)),Buffer.from('\n')]));
    assert.throws(()=>validate(f));
  });
}
test('a missing or malformed release manifest is never a fallback signal',()=>{
  const f=fixture();unlinkSync(join(f.root,MANIFEST));assert.throws(()=>validate(f),/WC36_MANIFEST_UNAVAILABLE/u);
  writeFileSync(join(f.root,MANIFEST),'{}\n');assert.throws(()=>validate(f),/WC36_MANIFEST_CONTRACT_INVALID/u);
});
test('repinning a changed immutable snapshot cannot change the reviewed predecessor',()=>{
  const f=fixture();writeFileSync(join(f.root,WEDDING_CODE36_PREDECESSOR_SNAPSHOT),JSON.stringify({...snapshot,baseCommit:'a'.repeat(40)}));
  f.refresh();assert.throws(()=>validate(f),/WC36_BUILD_SNAPSHOT_HASH_MISMATCH/u);
});
test('repinning modified SQL or PG fixture cannot admit an unreviewed artifact',()=>{
  const f=fixture(),sql=readFileSync(join(f.root,MIGRATION));
  writeFileSync(join(f.root,MIGRATION),Buffer.concat([sql,Buffer.from('\n-- a different review input\n')]));f.refresh();
  assert.throws(()=>validate(f),/WC36_BUILD_REVIEWED_ARTIFACT_CHANGED/u);
  writeFileSync(join(f.root,MIGRATION),sql);
  writeFileSync(join(f.root,FIXTURE),Buffer.concat([readFileSync(join(f.root,FIXTURE)),Buffer.from('\n')]));f.refresh();
  assert.throws(()=>validate(f),/WC36_BUILD_REVIEWED_ARTIFACT_CHANGED/u);
});
for(const prefix of ['scripts/lib/','supabase/migrations/','supabase/release-contracts/']){
  test(`a changed or missing old input remains rejected: ${prefix}`,()=>{
    const f=fixture(),file=snapshot.files.find(pin=>pin.file.startsWith(prefix)).file;
    writeFileSync(join(f.root,file),Buffer.concat([readFileSync(join(f.root,file)),Buffer.from('\n')]));
    assert.throws(()=>validate(f),/WC36_BUILD_PREDECESSOR_PIN_CHANGED/u);
    unlinkSync(join(f.root,file));assert.throws(()=>validate(f));
  });
}
for(const file of ['20990101000000_unreviewed.sql','20200101000000_unreviewed.sql','unexpected.SQL']){
  test(`additional SQL is rejected without filtering: ${file}`,()=>{
    const f=fixture();writeFileSync(join(f.root,'supabase/migrations',file),'SELECT 1;\n',{flag:'wx'});
    assert.throws(()=>validate(f),/WC36_BUILD_MIGRATION_SET_DRIFT/u);
  });
}
test('a linked artifact directory is rejected even when its contents are identical',()=>{
  const f=fixture(),source=join(f.root,'supabase/release-contracts'),target=join(f.root,'owned-real-contracts');
  for(const path of [source,target]){const delta=relative(f.root,path);assert.ok(delta&&!isAbsolute(delta)&&!delta.startsWith(`..${sep}`));}
  renameSync(source,target);symlinkSync(target,source,'junction');
  // loadPlan deliberately wraps an unsafe manifest path as unavailable.
  assert.throws(()=>validate(f),/WC36_MANIFEST_UNAVAILABLE/u);
});
for(const file of vendorFiles){
  test(`all fixed blocked vendor chain bytes remain required: ${file}`,()=>{
    const f=fixture();writeFileSync(join(f.root,file),Buffer.concat([readFileSync(join(f.root,file)),Buffer.from(' ')]));
    assert.throws(()=>validate(f),/WC36_BUILD_VENDOR_PIN_CHANGED/u);
  });
}
test('options cannot supply a fake source, identity, migration count or authorization',()=>{
  for(const options of [undefined,{},[],{repoRoot:'.'},{repoRoot:sourceRoot,authorization:'anything'},{repoRoot:sourceRoot,migrationCount:243}]){
    assert.throws(()=>validateWeddingCode36ProductionBuildContract(options),/WC36_BUILD_OPTIONS_INVALID/u);
  }
});
