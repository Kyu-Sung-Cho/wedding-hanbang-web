import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {loadAmoraActionViewV2Plan} from '../lib/amora-action-view-v2-release-contract.mjs';
import {AMORA_WRITER_RETIREMENT_FILE,AMORA_WRITER_RETIREMENT_COMPANIONS} from '../lib/amora-action-writer-retirement-bundle.mjs';
import {STATIC_PREDECESSOR_PIN} from '../lib/amora-action-writer-retirement-release-contract.mjs';
import {validateAmoraWriterRetirementBuildContract,AMORA_WRITER_RETIREMENT_VENDOR_MANIFEST} from '../lib/amora-action-writer-retirement-build-contract.mjs';
import {createAmoraWriterRetirementSourceRepository} from './fixtures/amora-action-writer-retirement-source-repository.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
// Test-only owned source242 materialization. No DB, runtime, CI or operating provenance.
function createFixture() {
  const fixture=createAmoraWriterRetirementSourceRepository();
  let file='supabase/release-manifests/vendor-disclosure-v2-20260718.json';
  try {
    const visited=new Set();
    while(file) {
      assert.ok(!visited.has(file));visited.add(file);
      const target=join(fixture.root,file);mkdirSync(dirname(target),{recursive:true});
      copyFileSync(join(repoRoot,file),target);
      file=JSON.parse(readFileSync(target,'utf8')).predecessorManifest?.file;
    }
    return fixture;
  } catch(error) {fixture.close();throw error;}
}

test('strict242 build registration preserves blocked vendor state and issues no operational authorization',()=>{
  const fixture=createFixture();
  try {
  const result=validateAmoraWriterRetirementBuildContract({repoRoot:fixture.root});
  assert.equal(result.migrationCount,242);
  assert.equal(result.expectedBeforeRowCount,230);
  assert.equal(result.expectedAfterRowCount,231);
  assert.equal(result.controllerReady,false);
  assert.equal(result.deploymentBlocked,true);
  assert.equal(result.controllerManifest,null);
  for(const key of ['releaseAuthorized','runtimeEvidenceVerified','b1OperationalPostverifyVerified','sourceCiVerified','remoteWritesPerformed'])
    assert.equal(result[key],false);
  assert.equal(result.vendorManifestSha256,AMORA_WRITER_RETIREMENT_VENDOR_MANIFEST.sha256);
  assert.throws(()=>loadAmoraActionViewV2Plan(fixture.root),/AMORA_VIEW_V2_NEW_MIGRATION_NOT_REVIEWED/);
  assert.throws(()=>validateAmoraWriterRetirementBuildContract({repoRoot}),/AMORA_WRITER_RETIREMENT_NEW_MIGRATION_NOT_REVIEWED/);
  } finally {fixture.close();}
});

for(const file of [STATIC_PREDECESSOR_PIN.file,`supabase/migrations/${AMORA_WRITER_RETIREMENT_FILE}`,
  AMORA_WRITER_RETIREMENT_COMPANIONS[4][0],'scripts/lib/supabase-successor-release-contract.mjs',
  'supabase/release-manifests/vendor-disclosure-v2-20260718.json',
  'supabase/release-manifests/amora-engine-v2-20260716.json',
  'supabase/release-manifests/amora-openai-20260714.json']) {
  test(`missing or changed static source never falls back to historical build validation: ${file}`,()=>{
    const fixture=createFixture(),path=join(fixture.root,file),bytes=readFileSync(path);
    try {
      writeFileSync(path,Buffer.concat([bytes,Buffer.from('\n')]));
      assert.throws(()=>validateAmoraWriterRetirementBuildContract({repoRoot:fixture.root}));
      rmSync(path);
      assert.throws(()=>validateAmoraWriterRetirementBuildContract({repoRoot:fixture.root}));
    } finally {fixture.close();}
  });
}

test('new source registration still rejects extra SQL and forged vendor controller-ready claims',()=>{
  const fixture=createFixture();
  try {
    const unexpected=join(fixture.root,'supabase/migrations/20990101000000_unreviewed.sql');
    writeFileSync(unexpected,'SELECT 1;\n',{flag:'wx'});
    assert.throws(()=>validateAmoraWriterRetirementBuildContract({repoRoot:fixture.root}),/AMORA_WRITER_RETIREMENT_NEW_MIGRATION_NOT_REVIEWED/);
    rmSync(unexpected);
    const file=join(fixture.root,AMORA_WRITER_RETIREMENT_VENDOR_MANIFEST.file);
    const manifest=JSON.parse(readFileSync(file,'utf8'));
    manifest.status='controller_ready';
    manifest.deploymentEvidence.backup={verified:true};
    writeFileSync(file,JSON.stringify(manifest));
    assert.throws(()=>validateAmoraWriterRetirementBuildContract({repoRoot:fixture.root}),/AMORA_WRITER_RETIREMENT_BUILD_VENDOR_PIN_CHANGED/);
  } finally {fixture.close();}
});

test('malformed build options cannot inject a validator, environment or authority proof',()=>{
  for(const options of [null,[],{repoRoot,verified:true},{repoRoot,validateSuccessor:()=>({controllerReady:true})}])
    assert.throws(()=>validateAmoraWriterRetirementBuildContract(options),/AMORA_WRITER_RETIREMENT_BUILD_OPTIONS_INVALID/);
});
