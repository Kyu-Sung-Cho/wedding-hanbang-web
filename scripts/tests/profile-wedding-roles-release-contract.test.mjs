import test, {after} from 'node:test';
import {createProfileRoleHistoricalRepository} from './fixtures/profile-role-historical-repository.mjs';
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProfileWeddingRolesReleasePlan, PROFILE_WEDDING_ROLES_CONTRACT_FILE } from '../lib/profile-wedding-roles-release-contract.mjs';
import { loadChatFeedbackNullabilityReleasePlan } from '../lib/chat-feedback-nullability-release-contract.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';
import { createChatFeedbackHistoricalRepository } from './fixtures/chat-feedback-historical-repository.mjs';
const sourceRoot=resolve(import.meta.dirname,'../..');
const historical=createProfileRoleHistoricalRepository(sourceRoot);
const root=historical.root;after(historical.cleanup);
const mode = '--profile-wedding-roles';
const code = value => error => error?.code === value;
const run = args => spawnSync(process.execPath, [join(root,'scripts/supabase-release-fence.mjs'),...args],
  {cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});

test('the explicit 230 successor preserves 229 original pins without authorizing runtime or relaxing older modes', () => {
  const plan = loadProfileWeddingRolesReleasePlan(root);
  assert.equal(plan.migrationCount,230);
  assert.deepEqual(plan.followupMigrations.map(row=>row.version),['20260910160514','20260911080244','20260913043211','20260913075045']);
  assert.equal(plan.contract.scope.roleInference,'none');
  assert.equal(plan.runtimeEvidenceVerified,false);assert.equal(plan.releaseAuthorized,false);assert.equal(plan.remoteWritesPerformed,false);
  assert.throws(()=>loadChatFeedbackNullabilityReleasePlan(root),code('NEW_MIGRATION_NOT_REVIEWED'));
  assert.throws(()=>validateSuccessorReleaseContract({repoRoot:root,followup:'chat-feedback-nullability'}),code('FOLLOWUP_RELEASE_INVALID'));
  const result=validateSuccessorReleaseContract({repoRoot:root,followup:'profile-wedding-roles'});
  assert.equal(result.controllerReady,false);assert.equal(result.deploymentBlocked,true);
  const cli=run([mode]);assert.equal(cli.status,0,cli.stderr);
  assert.match(cli.stdout,/230 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes/);
});

test('static and runtime dispatch reject mixed/operational or incomplete arguments before commands', async () => {
  for(const arg of ['--apply','--remote','--chat-feedback-nullability',mode,'--unknown']) {
    const result=run([mode,arg]);assert.equal(result.status,1);assert.match(result.stderr,/PROFILE_ROLE_STATIC_ARGUMENTS_INVALID/);
  }
  let commands=0;
  await assert.rejects(runProductionRelease({repoRoot:root,argv:[mode,'--apply'],
    runCommand:async()=>{commands++;throw Error('unexpected command')}}),code('PROFILE_ROLE_ARGUMENT_INVALID'));
  assert.equal(commands,0);
});

test('historical or new SQL, contracts and implementations cannot drift; extra SQL is not grandfathered', async t => {
  const fixture=createChatFeedbackHistoricalRepository(sourceRoot);t.after(fixture.cleanup);
  const plan=loadProfileWeddingRolesReleasePlan(root);
  const pins=[PROFILE_WEDDING_ROLES_CONTRACT_FILE,plan.contract.runtime.file,plan.contract.catalog.file,
    `supabase/migrations/${plan.contract.migrations[0].file}`];
  for(const file of pins)copyFileSync(join(root,file),join(fixture.root,file));
  assert.equal(loadProfileWeddingRolesReleasePlan(fixture.root).migrationCount,230);
  for(const file of [...pins,plan.contract.predecessor.file,'scripts/lib/chat-feedback-nullability-release.mjs',
    'supabase/migrations/20260913043211_chat_feedback_automatic_signal_nullable.sql']) {
    const target=join(fixture.root,file),bytes=readFileSync(target);
    try {writeFileSync(target,Buffer.concat([bytes,Buffer.from('\n')]));assert.throws(()=>loadProfileWeddingRolesReleasePlan(fixture.root),code('ARTIFACT_HASH_MISMATCH'));}
    finally {writeFileSync(target,bytes)}
  }
  for(const name of ['20260914000000_unknown.sql','20250101000000_old.sql','unexpected.sql']) {
    const path=join(fixture.root,'supabase/migrations',name);
    try {writeFileSync(path,'SELECT 1;\n',{flag:'wx'});assert.throws(()=>loadProfileWeddingRolesReleasePlan(fixture.root),code('NEW_MIGRATION_NOT_REVIEWED'));}
    finally {rmSync(path)}
  }
});
