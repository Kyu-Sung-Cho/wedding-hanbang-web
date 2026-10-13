import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAmoraWriterRetirementArgs,runAmoraWriterRetirementRelease} from '../lib/amora-action-writer-retirement-release.mjs';
const commit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b',flag='--amora-action-writer-retirement';
const base=[flag,'--expected-commit='+commit,'--project-ref=slrtobkksjmxgzatjyqb'];
test('exact new CLI three modes use scoped confirmations and private runtime-owned journal, never old receipts or mixed flags',()=>{
  assert.equal(parseAmoraWriterRetirementArgs([...base,'--inspect']).mode,'inspect');
  for(const mode of ['rehearse','apply']){
    const confirmation=`amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:${mode}:${commit}`;
    assert.equal(parseAmoraWriterRetirementArgs([...base,'--'+mode,'--confirm-production='+confirmation]).mode,mode);
    assert.throws(()=>parseAmoraWriterRetirementArgs([...base,'--'+mode]),/CONFIRMATION_REQUIRED/);
  }
  for(const extra of ['--inspect','--apply','--amora-action-view-v2','--skip','--sql=SELECT1','--receipt-out=private-store/apply.jsonl','--expected-commit='+commit])
    assert.throws(()=>parseAmoraWriterRetirementArgs([...base,'--inspect',extra]));
});
test('CLI cannot accept legacy query/clock/source/receipt callbacks or true evidence before any request',async()=>{
  const original=globalThis.fetch;let sends=0;globalThis.fetch=async()=>{sends++;throw new Error('forbidden');};
  try{
    for(const key of ['query','now','assertSource','receiptFactory','runCommand','verified','environment'])
      await assert.rejects(runAmoraWriterRetirementRelease({repoRoot:'.',argv:[...base,'--inspect'],[key]:()=>true}),/ARGUMENT_INVALID/);
    assert.equal(sends,0);
  }finally{globalThis.fetch=original;}
});
