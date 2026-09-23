import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadWeddingCodePairSessionReleasePlan, WEDDING_CODE_PAIR_SESSION_CONTRACT_FILE, WEDDING_CODE_PAIR_SESSION_SCOPE } from '../lib/wedding-code-pair-session-release-contract.mjs';
import { loadPreparationStyleReleasePlan, loadPreparationStyleHistoricalReleasePlan } from '../lib/preparation-style-release-contract.mjs';
import { createPreparationStyleHistoricalRepository } from './fixtures/preparation-style-historical-repository.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

const root=resolve(import.meta.dirname,'../..');
const code=value=>error=>error?.code===value;
const run=args=>spawnSync(process.execPath,[join(root,'scripts/supabase-release-fence.mjs'),...args],
  {cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000});

test('238 exact SQL successor preserves the 237 chain and never treats static pins as hosted evidence or deployment authority',()=>{
  const plan=loadWeddingCodePairSessionReleasePlan(root);
  assert.equal(plan.migrationCount,238);assert.equal(plan.followupMigrations.length,12);
  assert.deepEqual(plan.followupMigrations.at(-1),{file:'20260923104336_wedding_code_pair_sessions.sql',version:'20260923104336'});
  assert.deepEqual(plan.contract.scope,JSON.parse(JSON.stringify(WEDDING_CODE_PAIR_SESSION_SCOPE)));
  assert.equal(plan.contract.scope.serviceFunctions.length,4);assert.equal(plan.contract.scope.internalFunctions.length,1);
  for(const key of ['runtimeEvidenceVerified','releaseAuthorized','remoteWritesPerformed'])assert.equal(plan[key],false);
  assert.equal(loadPreparationStyleHistoricalReleasePlan(root).migrationCount,237);
  assert.throws(()=>loadPreparationStyleReleasePlan(root),code('NEW_MIGRATION_NOT_REVIEWED'));
  const successor=validateSuccessorReleaseContract({repoRoot:root,followup:'wedding-code-pair-session'});
  assert.equal(successor.deploymentBlocked,true);assert.equal(successor.controllerReady,false);
  assert.throws(()=>validateSuccessorReleaseContract({repoRoot:root,followup:'preparation-style'}),code('FOLLOWUP_RELEASE_INVALID'));
  const result=run(['--wedding-code-pair-session']);assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/WeddingCode pair session contract verified \(238 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes\)/);
  const previous=run(['--preparation-style']);assert.equal(previous.status,1);assert.match(previous.stderr,/NEW_MIGRATION_NOT_REVIEWED/);
});

test('static mode refuses mixed operations and malformed controller requests before any network command',async()=>{
  for(const extra of ['--apply','--remote','--wedding-code-pair-session','--preparation-style','--unknown']){
    const result=run(['--wedding-code-pair-session',extra]);assert.equal(result.status,1);assert.match(result.stderr,/WEDDING_CODE_PAIR_SESSION_STATIC_ARGUMENTS_INVALID/);
  }
  let calls=0;
  await assert.rejects(runProductionRelease({repoRoot:root,argv:['--wedding-code-pair-session','--apply'],runCommand:async()=>{calls++}}),code('WEDDING_CODE_PAIR_SESSION_ARGUMENT_INVALID'));
  assert.equal(calls,0);
});

test('missing, changed or additional artifacts cannot fall back to the prior release',t=>{
  const fixture=createPreparationStyleHistoricalRepository(root);t.after(fixture.cleanup);
  const plan=loadWeddingCodePairSessionReleasePlan(root);
  assert.equal(loadPreparationStyleReleasePlan(fixture.root).migrationCount,237);
  assert.throws(()=>loadWeddingCodePairSessionReleasePlan(fixture.root));
  const paths=[WEDDING_CODE_PAIR_SESSION_CONTRACT_FILE,plan.contract.runtime.file,plan.contract.catalog.file,plan.contract.catalogFixture.file,
    `supabase/migrations/${plan.contract.migrations[0].file}`];
  for(const path of paths){mkdirSync(dirname(join(fixture.root,path)),{recursive:true});copyFileSync(join(root,path),join(fixture.root,path));}
  assert.equal(loadWeddingCodePairSessionReleasePlan(fixture.root).migrationCount,238);
  for(const path of [...paths,plan.contract.predecessor.file,plan.contract.predecessorMigration.file,
    'scripts/lib/wedding-code-research-scene-v10-release.mjs']){
    const target=join(fixture.root,path),bytes=readFileSync(target);
    try{
      writeFileSync(target,Buffer.concat([bytes,Buffer.from('\n')]));
      assert.throws(()=>loadWeddingCodePairSessionReleasePlan(fixture.root),Error,path);
      rmSync(target);assert.throws(()=>loadWeddingCodePairSessionReleasePlan(fixture.root),Error,path);
    }finally{writeFileSync(target,bytes);}
  }
  for(const name of ['20260921000000_unknown.sql','20260101000000_unknown.sql','unexpected.sql']){
    const target=join(fixture.root,'supabase/migrations',name);
    try{writeFileSync(target,'SELECT 1;\n',{flag:'wx'});assert.throws(()=>loadWeddingCodePairSessionReleasePlan(fixture.root),code('NEW_MIGRATION_NOT_REVIEWED'));}
    finally{rmSync(target);}
  }
});
