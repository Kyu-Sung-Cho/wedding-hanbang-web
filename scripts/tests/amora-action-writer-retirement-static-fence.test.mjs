import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const mode='--amora-action-writer-retirement';
const run=args=>spawnSync(process.execPath,['scripts/supabase-release-fence.mjs',...args],
 {cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});
const output=r=>r.stdout+'\n'+r.stderr;
test('explicit current242 five-companion static fence validates source only, never runtime or deployment authority',()=>{
 const result=run([mode]);
 assert.equal(result.status,0,output(result));
 assert.match(output(result),/242 exact SQL files; operating history 230 -> 231/);
 assert.match(output(result),/runtime evidence not verified; deployment not authorized; no remote writes/);
});
test('new static mode rejects old/mixed/duplicate/remote/operational/unknown flags',async t=>{
 for(const args of [[mode,mode],[mode,'--amora-action-view-v2'],[mode,'--remote'],[mode,'--apply'],[mode,'--unknown'],
  [mode,'--project-ref=slrtobkksjmxgzatjyqb'],[mode,'--expected-commit='+'a'.repeat(40)],[mode,'--refuse-direct-push']]) {
  await t.test(args.join(' '),()=>{
   const result=run(args);assert.equal(result.status,1,output(result));
   assert.match(output(result),/AMORA_WRITER_RETIREMENT_STATIC_ARGUMENTS_INVALID/);
   assert.doesNotMatch(output(result),/verified|Remote pending set/i);
  });
 }
});
