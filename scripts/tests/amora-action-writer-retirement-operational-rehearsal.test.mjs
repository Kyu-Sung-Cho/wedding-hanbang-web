import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runAmoraWriterRetirementOperationalRehearsal,runAmoraWriterRetirementRehearsalWithAdmission,assertAmoraWriterRetirementOperationalRollback} from '../lib/amora-action-writer-retirement-operational-rehearsal.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url)),expectedCommit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';
const operatorConfirmation=`amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:rehearse:${expectedCommit}`;
test('default original7 runtime rejects callback/query/clock/serialized authority before sending any network request',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('forbidden');};
  try{
    for(const key of ['query','now','before','native','verified','environment','runCommand','privateOriginal','mode','skip'])
      await assert.rejects(runAmoraWriterRetirementOperationalRehearsal({repoRoot,expectedCommit,operatorConfirmation,[key]:()=>true}),/ARGUMENT_INVALID/);
    await assert.rejects(runAmoraWriterRetirementOperationalRehearsal({repoRoot,expectedCommit,operatorConfirmation:operatorConfirmation.replace(':rehearse:',':apply:')}),/ARGUMENT_INVALID/);
    const apply=operatorConfirmation.replace(':rehearse:',':apply:');
    await assert.rejects(runAmoraWriterRetirementRehearsalWithAdmission({repoRoot,expectedCommit,operatorConfirmation:apply,
      admission:{operatorConfirmation:apply,operationalEvidenceVerified:true}}),/NOT_ISSUED/);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
test('native-source/B1/old original6/JSON flags cannot become an issued operating230 rollback proof',async()=>{
  for(const proof of [{releaseAuthorized:true,actualOperating230Verified:true},
    {format:'amora-b2-issued-original7-native-recovery-v1',nativeReplayVerified:true},
    {format:'amora-action-view-v2-runtime-rehearsal-v1'},
    {format:'amora-b2-original6-canonical-update-acl-capsule-v1'}])
    await assert.rejects(assertAmoraWriterRetirementOperationalRollback({proof,repoRoot,expectedCommit}),/NOT_ISSUED/);
});
