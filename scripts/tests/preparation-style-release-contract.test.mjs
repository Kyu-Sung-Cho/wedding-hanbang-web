import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPreparationStyleReleasePlan, PREPARATION_STYLE_CONTRACT_FILE, PREPARATION_STYLE_SCOPE } from '../lib/preparation-style-release-contract.mjs';
import { loadWeddingCodeSceneV10ReleasePlan, loadWeddingCodeSceneV10HistoricalReleasePlan } from '../lib/wedding-code-research-scene-v10-release-contract.mjs';
import { createWeddingCodeSceneV10HistoricalRepository } from './fixtures/wedding-code-research-scene-v10-historical-repository.mjs';
import { createPreparationStyleHistoricalRepository } from './fixtures/preparation-style-historical-repository.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

const actualRoot=resolve(import.meta.dirname,'../..');
const historical=createPreparationStyleHistoricalRepository(actualRoot);
test.after(historical.cleanup);
const root=historical.root;
const code=value=>error=>error?.code===value;
const run=args=>spawnSync(process.execPath,[join(root,'scripts/supabase-release-fence.mjs'),...args],
  {cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000});

test('the strict 237 contract rejects the actual checkout with unregistered Amora SQL',()=>{
  assert.throws(()=>loadPreparationStyleReleasePlan(actualRoot),code('NEW_MIGRATION_NOT_REVIEWED'));
});

test('237 exact SQL successor preserves the 236 chain and never treats static pins as hosted evidence or deployment authority',()=>{
  const plan=loadPreparationStyleReleasePlan(root);
  assert.equal(plan.migrationCount,237);assert.equal(plan.followupMigrations.length,11);
  assert.deepEqual(plan.followupMigrations.at(-1),{file:'20260920120000_wedding_preparation_style.sql',version:'20260920120000'});
  assert.deepEqual(plan.contract.scope,JSON.parse(JSON.stringify(PREPARATION_STYLE_SCOPE)));
  assert.equal(plan.contract.scope.authenticatedFunctions.length,5);assert.equal(plan.contract.scope.internalFunctions.length,3);
  for(const key of ['runtimeEvidenceVerified','releaseAuthorized','remoteWritesPerformed'])assert.equal(plan[key],false);
  assert.equal(loadWeddingCodeSceneV10HistoricalReleasePlan(root).migrationCount,236);
  assert.throws(()=>loadWeddingCodeSceneV10ReleasePlan(root),code('NEW_MIGRATION_NOT_REVIEWED'));
  const successor=validateSuccessorReleaseContract({repoRoot:root,followup:'preparation-style'});
  assert.equal(successor.deploymentBlocked,true);assert.equal(successor.controllerReady,false);
  assert.throws(()=>validateSuccessorReleaseContract({repoRoot:root,followup:'wedding-code-research-scene-v10'}),code('FOLLOWUP_RELEASE_INVALID'));
  const result=run(['--preparation-style']);assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Preparation style contract verified \(237 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes\)/);
  const previous=run(['--wedding-code-research-scene-v10']);assert.equal(previous.status,1);assert.match(previous.stderr,/NEW_MIGRATION_NOT_REVIEWED/);
});

test('static mode refuses mixed operations and malformed controller requests before any network command',async()=>{
  for(const extra of ['--apply','--remote','--preparation-style','--wedding-code-research-scene-v10','--unknown']){
    const result=run(['--preparation-style',extra]);assert.equal(result.status,1);assert.match(result.stderr,/PREPARATION_STYLE_STATIC_ARGUMENTS_INVALID/);
  }
  let calls=0;
  await assert.rejects(runProductionRelease({repoRoot:root,argv:['--preparation-style','--apply'],runCommand:async()=>{calls++}}),code('PREPARATION_STYLE_ARGUMENT_INVALID'));
  assert.equal(calls,0);
});

test('missing, changed or additional artifacts cannot fall back to the prior release',t=>{
  const fixture=createWeddingCodeSceneV10HistoricalRepository(actualRoot);t.after(fixture.cleanup);
  const plan=loadPreparationStyleReleasePlan(root);
  assert.equal(loadWeddingCodeSceneV10ReleasePlan(fixture.root).migrationCount,236);
  assert.throws(()=>loadPreparationStyleReleasePlan(fixture.root));
  const paths=[PREPARATION_STYLE_CONTRACT_FILE,plan.contract.runtime.file,plan.contract.catalog.file,plan.contract.catalogFixture.file,
    `supabase/migrations/${plan.contract.migrations[0].file}`];
  for(const path of paths){mkdirSync(dirname(join(fixture.root,path)),{recursive:true});copyFileSync(join(root,path),join(fixture.root,path));}
  assert.equal(loadPreparationStyleReleasePlan(fixture.root).migrationCount,237);
  for(const path of [...paths,plan.contract.predecessor.file,plan.contract.predecessorMigration.file,plan.contract.dependencyMigration.file,
    'scripts/lib/wedding-code-research-scene-v10-release.mjs']){
    const target=join(fixture.root,path),bytes=readFileSync(target);
    try{
      writeFileSync(target,Buffer.concat([bytes,Buffer.from('\n')]));
      assert.throws(()=>loadPreparationStyleReleasePlan(fixture.root),Error,path);
      rmSync(target);assert.throws(()=>loadPreparationStyleReleasePlan(fixture.root),Error,path);
    }finally{writeFileSync(target,bytes);}
  }
  for(const name of ['20260921000000_unknown.sql','20260101000000_unknown.sql','unexpected.sql']){
    const target=join(fixture.root,'supabase/migrations',name);
    try{writeFileSync(target,'SELECT 1;\n',{flag:'wx'});assert.throws(()=>loadPreparationStyleReleasePlan(fixture.root),code('NEW_MIGRATION_NOT_REVIEWED'));}
    finally{rmSync(target);}
  }
});
