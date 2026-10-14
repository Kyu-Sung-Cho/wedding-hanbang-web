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

const archiveArgs=['--recovery-id=82fabbd4-0df5-4a14-b21f-e159553c97e1',
  '--archive-commit=68f9d94a3263ef922f2aabbde7541fb85b37853e',
  '--artifact-sha256='+'1'.repeat(64)];
const verifyConfirmation=`amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:verify-committed:${commit}`;
test('already committed verification is an exact separate mode with immutable historical archive binding',()=>{
  const parsed=parseAmoraWriterRetirementArgs([...base,'--verify-committed',...archiveArgs,'--confirm-production='+verifyConfirmation]);
  assert.equal(parsed.mode,'verify-committed');
  assert.equal(parsed['archive-commit'],'68f9d94a3263ef922f2aabbde7541fb85b37853e');
  assert.equal(parsed['artifact-sha256'],'1'.repeat(64));
  for(const mode of ['inspect','rehearse','apply']){
    const extras=mode==='inspect'?[]:[`--confirm-production=amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:${mode}:${commit}`];
    assert.throws(()=>parseAmoraWriterRetirementArgs([...base,'--'+mode,...archiveArgs,...extras]),/ARGUMENT_INVALID/);
  }
});
test('post verification cannot omit archive pins, replace immutable source, use another project or mix modes',()=>{
  const valid=[...base,'--verify-committed',...archiveArgs,'--confirm-production='+verifyConfirmation];
  for(const key of ['--recovery-id=','--archive-commit=','--artifact-sha256='])
    assert.throws(()=>parseAmoraWriterRetirementArgs(valid.filter(arg=>!arg.startsWith(key))),/ARGUMENT_INVALID/);
  for(const [key,value] of [['--recovery-id=','../outside'],['--archive-commit=','a'.repeat(40)],
    ['--artifact-sha256=','a'.repeat(63)],['--project-ref=','anotherproject']])
    assert.throws(()=>parseAmoraWriterRetirementArgs(valid.map(arg=>arg.startsWith(key)?key+value:arg)),/ARGUMENT_INVALID/);
  for(const extra of ['--apply','--rehearse','--inspect','--verify-committed','--deadline=2099-01-01',
    '--clock=now','--release-authorized=true','--uninstall','--skip','--artifact-sha256='+'2'.repeat(64)])
    assert.throws(()=>parseAmoraWriterRetirementArgs([...valid,extra]));
  assert.throws(()=>parseAmoraWriterRetirementArgs(valid.filter(arg=>!arg.startsWith('--confirm-production='))),/CONFIRMATION_REQUIRED/);
});
