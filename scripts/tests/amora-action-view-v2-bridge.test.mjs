import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const mode='--amora-action-view-v2';
const run=argv=>spawnSync(process.execPath,['scripts/supabase-release-fence.mjs',...argv],
  {cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000});

test('the normal static fence selects exact source241 and approved historical ledger229 without granting deployment',()=>{
  const result=run([mode]);
  assert.equal(result.status,0,`${result.stdout}${result.stderr}`);
  assert.match(result.stdout,/241 exact SQL files; 229 historical operating ledger rows/);
  assert.match(result.stdout,/runtime evidence not verified; deployment not authorized; no remote writes/);
});

test('the normal production dispatcher requires the exact private v2 path before any command',async()=>{
  const {runProductionRelease}=await import('../lib/supabase-production-release-controller.mjs');
  let commands=0;
  await assert.rejects(runProductionRelease({repoRoot:root,argv:[mode,'--apply','--expected-commit='+'a'.repeat(40),
    '--project-ref=slrtobkksjmxgzatjyqb','--receipt-out='+resolve(root,'../UNUSED-BRIDGE-RECEIPT.jsonl')],
    runCommand:()=>{commands++;throw new Error('no commands may run');}}),
  error=>error.code==='AMORA_VIEW_V2_PRIVATE_RECEIPT_REQUIRED');
  assert.equal(commands,0);
});

test('static v2 rejects mixed, duplicate, operational and unknown flags while the old240 lane still rejects source241',()=>{
  for(const extra of [mode,'--remote','--apply','--inspect','--unknown','--account-deletion-audit-nullability']) {
    const result=run([mode,extra]);
    assert.equal(result.status,1,result.stdout);
    assert.match(result.stderr,/AMORA_VIEW_V2_STATIC_ARGUMENTS_INVALID/);
    assert.doesNotMatch(result.stdout,/verified|Remote pending/i);
  }
  const old=run(['--account-deletion-audit-nullability']);
  assert.equal(old.status,1,old.stdout);
  assert.match(old.stderr,/NEW_MIGRATION_NOT_REVIEWED/);
});

test('the production dispatcher rejects mixed or caller-controlled v2 instructions before commands',async()=>{
  const {runProductionRelease}=await import('../lib/supabase-production-release-controller.mjs');
  const valid=[mode,'--apply','--expected-commit='+'a'.repeat(40),'--project-ref=slrtobkksjmxgzatjyqb',
    '--receipt-out='+resolve(root,'../UNUSED-BRIDGE-RECEIPT.jsonl')];
  for(const extra of [mode,'--inspect','--account-deletion-audit-nullability','--query=SELECT 1','--skip-backup']) {
    let commands=0;
    await assert.rejects(runProductionRelease({repoRoot:root,argv:[...valid,extra],runCommand:()=>{commands++;}}),
      error=>error.code==='AMORA_VIEW_V2_ARGUMENT_INVALID'||error.code==='AMORA_VIEW_V2_ARGUMENT_DUPLICATE');
    assert.equal(commands,0);
  }
});
