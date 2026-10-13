import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runProductionRelease} from '../lib/supabase-production-release-controller.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const flag='--amora-action-writer-retirement';

test('new writer-retirement flag reaches its strict parser before source, credentials or any send',async()=>{
  await assert.rejects(runProductionRelease({repoRoot,argv:[flag]}),
    error=>error.code==='AMORA_WRITER_CLI_ARGUMENT_INVALID');
});

test('new default-only dispatcher refuses explicit callbacks, receipts, schema and authority overrides',async()=>{
  let calls=0;
  for(const name of ['runCommand','now','transport','query','environment','receipt','schema','verified','releaseAuthorized']){
    for(const enumerable of [true,false]){
      const input={repoRoot,argv:[flag]};
      Object.defineProperty(input,name,{enumerable,value:()=>{calls++;throw new Error('CALLER_CALLBACK_MUST_NOT_RUN');}});
      await assert.rejects(runProductionRelease(input),error=>error.code==='AMORA_WRITER_DISPATCH_OVERRIDE_FORBIDDEN');
    }
  }
  assert.equal(calls,0);
});

test('new default boundary rejects getter overrides before invoking them',async()=>{
  let reads=0;
  for(const name of ['now','repoRoot']){
    const input={repoRoot,argv:[flag]};
    Object.defineProperty(input,name,{enumerable:true,get(){reads++;return name==='repoRoot'?repoRoot:()=>new Date();}});
    await assert.rejects(runProductionRelease(input),error=>error.code==='AMORA_WRITER_DISPATCH_OVERRIDE_FORBIDDEN');
  }
  assert.equal(reads,0);
});

test('CLI cannot print VERIFIED or ROLLED_BACK from serialized final/rollback proof claims',async()=>{
  const {formatAmoraWriterRetirementCliResult}=await import('../lib/supabase-production-release-controller.mjs');
  await assert.rejects(()=>formatAmoraWriterRetirementCliResult({repoRoot,result:{
    format:'amora-writer-retirement-issued-complete-operating-v1',releaseAuthorized:true,committedMutationObserved:true,
    post7Verified:true,issuedDefaultCutoffVerified:true,actualCohortDrainedVerified:true}}),
    error=>error.code==='AMORA_WRITER_RUNTIME_COMPLETE_NOT_ISSUED');
  await assert.rejects(()=>formatAmoraWriterRetirementCliResult({repoRoot,result:{
    format:'amora-writer-retirement-issued-operational-rollback-v1',releaseAuthorized:false,
    sourceCommit:'0'.repeat(40),actualRollbackResponseVerified:true,independent230ReobservationVerified:true}}),
    error=>error.code==='AMORA_WRITER_REHEARSAL_NOT_ISSUED');
});

test('actual CLI refuses malformed or mixed new flags without sends, success output or secret echo',()=>{
  const script=fileURLToPath(new URL('../supabase-production-release.mjs',import.meta.url));
  const secret='SYNTHETIC-DO-NOT-ECHO';
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>
    !/^GIT_/i.test(name)&&!['NODE_OPTIONS','NODE_PATH','SUPABASE_ACCESS_TOKEN'].includes(name.toUpperCase())));
  for(const argv of [[flag],[flag,`--password=${secret}`],[flag,'--amora-action-view-v2'],[flag,flag]]){
    const result=spawnSync(process.execPath,[script,...argv],{cwd:repoRoot,env,encoding:'utf8',
      windowsHide:true,timeout:10_000,maxBuffer:64*1024});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.match(result.stderr,/SUPABASE_PRODUCTION_RELEASE_BLOCKED \[AMORA_WRITER_CLI_ARGUMENT_(?:INVALID|DUPLICATE)\]/);
    assert.doesNotMatch(result.stdout+result.stderr,/VERIFIED|ROLLED_BACK|READ_ONLY|SYNTHETIC-DO-NOT-ECHO/);
  }
});
