import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadAmoraActionViewV2Plan} from '../lib/amora-action-view-v2-release-contract.mjs';
import {runAmoraActionViewV2Release} from '../lib/amora-action-view-v2-release.mjs';
import {AMORA_WRITER_RETIREMENT_FILE,AMORA_WRITER_RETIREMENT_SHA,buildAmoraWriterRetirementBundle} from '../lib/amora-action-writer-retirement-bundle.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from '../lib/amora-action-writer-retirement-release-contract.mjs';
import {checkLocalOnly as checkWeddingCode36LocalOnly} from '../wedding-code36-release.mjs';
import {checkLocalOnly as checkHallInquiryLocalOnly} from '../hall-inquiry-release.mjs';
import {checkLocalOnly as checkAmoraTasksLocalOnly} from '../amora-tasks-release.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const commit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const unchanged={
 'scripts/lib/amora-action-view-v2-release-contract.mjs':'cf73c8fb894cb157b3cb27619ee0072061c61c9881749cb8390c5dd7f9363cec',
 'scripts/lib/amora-action-view-v2-operational-rehearsal.mjs':'dac25e046334e64bfd5314b6816000b448e5ef8c6634b48643630308ec465abe',
 'scripts/lib/amora-action-view-v2-admission.mjs':'764a658bcb635f5a13b89a07ab347a7f9cc348e2d024c81729b0f537490dff92',
 'scripts/lib/amora-action-view-v2-release.mjs':'83bea3ff6576085a3d99341ddc7abcd87b9b3e322faeecf56613c90610458d73',
};

test('actual source245 preserves historical B1 and B2 pins while only the newest amora-tasks lane accepts its extra migration',()=>{
 assert.equal(readdirSync(join(root,'supabase/migrations')).filter(file=>/\.sql$/i.test(file)).length,245);
 for(const [file,pin] of Object.entries(unchanged))assert.equal(sha(readFileSync(join(root,file))),pin);
 const formal=readFileSync(join(root,'supabase/migrations',AMORA_WRITER_RETIREMENT_FILE));
 assert.equal(sha(formal),AMORA_WRITER_RETIREMENT_SHA);
 assert.equal(formal.toString('utf8'),buildAmoraWriterRetirementBundle(root).sql);
 assert.throws(()=>loadAmoraActionViewV2Plan(root),error=>error.code==='AMORA_VIEW_V2_NEW_MIGRATION_NOT_REVIEWED');
 assert.throws(()=>loadAmoraWriterRetirementPlan({repoRoot:root,mode:AMORA_WRITER_RETIREMENT_MODE}),/AMORA_WRITER_RETIREMENT_NEW_MIGRATION_NOT_REVIEWED/);
 // 36문항 길과 웨딩홀 문의 길은 각자 자기 SQL 하나만 검토했다. 아모라 맡은 일 SQL 이 더해진 지금은 두 길 모두 받지 않는다.
 assert.throws(()=>checkWeddingCode36LocalOnly(root),error=>error.code==='WC36_UNREVIEWED_MIGRATION');
 assert.throws(()=>checkHallInquiryLocalOnly(root),error=>error.code==='HIQ_UNREVIEWED_MIGRATION');
 const current=checkAmoraTasksLocalOnly(root);
 assert.equal(current.migrationCount,245);
 assert.equal(current.remoteWritesPerformed,false);assert.equal(current.deploymentAuthorized,false);
 assert.ok(current.preservedPredecessorFiles>100);
});

test('old actual default and offline B1 inspect/rehearse/apply lanes refuse current242 before transport, admission commands or private receipts',async()=>{
 let queries=0,commands=0;
 const inspectionReceipt=join(tmpdir(),'amora-b1-current242-must-not-create.jsonl');
 assert.equal(existsSync(inspectionReceipt),false);
 for(const mode of ['inspect','rehearse','apply']) {
  const argv=['--amora-action-view-v2','--'+mode,'--expected-commit='+commit,'--project-ref=slrtobkksjmxgzatjyqb',
   '--receipt-out='+(mode==='inspect'?inspectionReceipt:'private-store/'+(mode==='apply'?'apply':'rehearsal')+'.jsonl')];
  if(mode!=='inspect')argv.push('--confirm-production=amora-action-view-v2-20261012:slrtobkksjmxgzatjyqb:'+mode+':'+commit);
  await assert.rejects(()=>runAmoraActionViewV2Release({repoRoot:root,argv}),
   error=>error.code==='AMORA_VIEW_V2_NEW_MIGRATION_NOT_REVIEWED');
  await assert.rejects(()=>runAmoraActionViewV2Release({repoRoot:root,argv,query:async()=>{queries++;throw Error('not sent');},
   runCommand:async()=>{commands++;throw Error('not executed');},environment:{}}),
   error=>error.code==='AMORA_VIEW_V2_NEW_MIGRATION_NOT_REVIEWED');
 }
 assert.equal(queries,0);assert.equal(commands,0);assert.equal(existsSync(inspectionReceipt),false);
});
