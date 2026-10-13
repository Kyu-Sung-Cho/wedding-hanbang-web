import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runAmoraWriterRetirementApply,assertAmoraWriterRetirementIssuedPost,
  assertAmoraWriterRetirementIssuedCutoff,assertAmoraWriterRetirementIssuedCohort,
  assertAmoraWriterRetirementIssuedComplete} from '../lib/amora-action-writer-retirement-runtime.mjs';
const repoRoot=fileURLToPath(new URL('../../',import.meta.url)),expectedCommit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';
const operatorConfirmation=`amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:apply:${expectedCommit}`;
test('apply entry rejects callbacks/clock/source/SQL/serialized approval before any send or private state creation',async()=>{
  const original=globalThis.fetch;let sends=0;globalThis.fetch=async()=>{sends++;throw new Error('forbidden');};
  try{
    for(const key of ['query','now','expectedNativeSystemIdentifier','source','sql','post','cutoff','cohort','before','verified','runCommand'])
      await assert.rejects(runAmoraWriterRetirementApply({repoRoot,expectedCommit,operatorConfirmation,[key]:()=>true}),/ARGUMENT_INVALID/);
    await assert.rejects(runAmoraWriterRetirementApply({repoRoot,expectedCommit,operatorConfirmation:operatorConfirmation.replace(':apply:',':rehearse:')}),/ARGUMENT_INVALID/);
    assert.equal(sends,0);
  }finally{globalThis.fetch=original;}
});
test('only runtime-issued object identity can supply post7/defaultC/cohort lineage; native and serialized true flags do not authorize removal',()=>{
  for(const validator of [assertAmoraWriterRetirementIssuedPost,assertAmoraWriterRetirementIssuedCutoff,
    assertAmoraWriterRetirementIssuedCohort,assertAmoraWriterRetirementIssuedComplete])
    for(const fake of [{verified:true,releaseAuthorized:true},{actualOperatingPost7Verified:true},
      {format:'amora-writer-maintenance-cutoff-content-v1',cutoff:new Date().toISOString()},
      {format:'amora-b2-issued-original7-native-recovery-v1',nativeReplayVerified:true}])assert.throws(()=>validator(fake),/NOT_ISSUED/);
});
