import test, {after} from 'node:test';import assert from 'node:assert/strict';import {copyFileSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {loadProfileAvatarReleasePlan,PROFILE_AVATAR_CONTRACT_FILE} from '../lib/profile-avatar-release-contract.mjs';
import {loadProfileWeddingRolesReleasePlan} from '../lib/profile-wedding-roles-release-contract.mjs';
import {createProfileRoleHistoricalRepository} from './fixtures/profile-role-historical-repository.mjs';
import {createProfileAvatarHistoricalRepository} from './fixtures/profile-avatar-historical-repository.mjs';
import {validateSuccessorReleaseContract} from '../lib/supabase-successor-release-contract.mjs';
import {runProductionRelease} from '../lib/supabase-production-release-controller.mjs';
const actualRoot=resolve(import.meta.dirname,'../..');
const historical=createProfileAvatarHistoricalRepository(actualRoot),root=historical.root;
after(historical.cleanup);
const run=args=>spawnSync(process.execPath,[join(root,'scripts/supabase-release-fence.mjs'),...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});
test('231 successor verifies both SQL pins without weakening 230 or claiming runtime evidence/owner authorization',()=>{
 const plan=loadProfileAvatarReleasePlan(root);assert.equal(plan.migrationCount,231);assert.equal(plan.followupMigrations.length,5);
 assert.equal(plan.runtimeEvidenceVerified,false);assert.equal(plan.remoteWritesPerformed,false);assert.equal(plan.releaseAuthorized,false);
 assert.throws(()=>loadProfileWeddingRolesReleasePlan(root),{code:'NEW_MIGRATION_NOT_REVIEWED'});
 assert.equal(validateSuccessorReleaseContract({repoRoot:root,followup:'profile-avatar'}).deploymentBlocked,true);
 const result=run(['--profile-avatar']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/231 exact SQL files/);
});

test('the historical 231 public mode rejects the actual 232 checkout',()=>{
 assert.throws(()=>loadProfileAvatarReleasePlan(actualRoot),{code:'NEW_MIGRATION_NOT_REVIEWED'});
});
test('unregistered/static mixed and incomplete runtime arguments cannot execute commands',async()=>{
 for(const arg of ['--apply','--remote','--profile-wedding-roles','--profile-avatar','--unknown']){const result=run(['--profile-avatar',arg]);assert.equal(result.status,1);assert.match(result.stderr,/PROFILE_AVATAR_STATIC_ARGUMENTS_INVALID/)}
 let calls=0;await assert.rejects(runProductionRelease({repoRoot:root,argv:['--profile-avatar','--apply'],runCommand:async()=>{calls++}}),{code:'PROFILE_AVATAR_ARGUMENT_INVALID'});assert.equal(calls,0);
});
test('migration, exact policy, expected PG17 catalog, historical functions and runtime pins reject drift/unknown SQL',t=>{
 const fixture=createProfileRoleHistoricalRepository(actualRoot);t.after(fixture.cleanup);const plan=loadProfileAvatarReleasePlan(root);
 const paths=[PROFILE_AVATAR_CONTRACT_FILE,plan.contract.runtime.file,plan.contract.catalog.file,plan.contract.catalogFixture.file,plan.contract.platformPolicy.file,plan.contract.historicalPolicy.file,`supabase/migrations/${plan.contract.migrations[0].file}`];
 for(const path of paths){mkdirSync(dirname(join(fixture.root,path)),{recursive:true});copyFileSync(join(root,path),join(fixture.root,path))}
 assert.equal(loadProfileAvatarReleasePlan(fixture.root).migrationCount,231);
 for(const path of [...paths,plan.contract.predecessor.file,plan.contract.previousManifest.file,'scripts/lib/profile-wedding-roles-release.mjs']) {
  const target=join(fixture.root,path),bytes=readFileSync(target);try{writeFileSync(target,Buffer.concat([bytes,Buffer.from('\n')]));assert.throws(()=>loadProfileAvatarReleasePlan(fixture.root),{code:'ARTIFACT_HASH_MISMATCH'})}finally{writeFileSync(target,bytes)}
 }
 const target=join(fixture.root,'supabase/migrations/20260914000000_unknown.sql');writeFileSync(target,'SELECT 1;\n',{flag:'wx'});
 try{assert.throws(()=>loadProfileAvatarReleasePlan(fixture.root),{code:'NEW_MIGRATION_NOT_REVIEWED'})}finally{rmSync(target)}
});
