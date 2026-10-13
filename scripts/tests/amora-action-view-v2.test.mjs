import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {seedSyntheticAmoraHistoryLedger,mapSyntheticHistoricalLedgerMetadata} from './fixtures/amora-action-view-v2-ledger-fixture.mjs';
import {createDraftDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';

const repoRoot = fileURLToPath(new URL('../../',import.meta.url));
let observedFixture;
const args=mode=>['--amora-action-view-v2','--'+mode,'--expected-commit='+'a'.repeat(40),
  '--project-ref=slrtobkksjmxgzatjyqb','--receipt-out='+join(repoRoot,'..','SYNTHETIC-INSPECT.jsonl')];
const source=()=>({commit:'a'.repeat(40),origin:'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git',clean:true});

test('the approved migration is exactly the historical 240 plus one provenance-bound v2 file without weakening the old lane', async () => {
  const {loadAmoraActionViewV2Plan} = await import('../lib/amora-action-view-v2-release-contract.mjs');
  const {loadDeletionAuditNullabilityReleasePlan}=await import('../lib/account-deletion-audit-nullability-release-contract.mjs');
  const plan = loadAmoraActionViewV2Plan(repoRoot);
  assert.equal(plan.predecessorMigrationCount,240);
  assert.equal(plan.migrationCount,241);
  assert.equal(plan.predecessorReviewedMigrations.length,240);
  assert.equal(plan.reviewedMigrations.length,241);
  assert.equal(plan.migration.file,'20261012002000_amora_action_view_v2.sql');
  assert.equal(plan.migration.version,'20261012002000');
  assert.equal(plan.migration.name,'amora_action_view_v2');
  const original=readFileSync(join(repoRoot,plan.contract.candidate.file),'utf8');
  assert.equal(createHash('sha256').update(original).digest('hex'),
    'e31372d192a0215d4ddf280a99abb628e7a8f732ebc02cb0b7e55fed1373730d');
  assert.equal(plan.candidateSha256,plan.contract.candidate.sha256);
  assert.equal(plan.sql,readFileSync(join(repoRoot,'supabase/migrations',plan.migration.file),'utf8'));
  assert.equal(plan.sqlSha256,createHash('sha256').update(plan.sql).digest('hex'));
  assert.notEqual(plan.sqlSha256,plan.candidateSha256,'the corrected formal-only comment changes the raw SHA');
  assert.equal(plan.sql.slice(plan.sql.indexOf('\n')+1),original.slice(original.indexOf('\n')+1),
    'all bytes except the first explanatory comment are identical');
  assert.throws(()=>loadDeletionAuditNullabilityReleasePlan(repoRoot),
    error=>error.code==='NEW_MIGRATION_NOT_REVIEWED','the old strict 240 lane still refuses the new file');
  assert.equal(plan.releaseAuthorized,false);
  assert.equal(plan.productionApplyImplemented,false);
  assert.equal(plan.remoteWritesPerformed,false);
});

test('the operating predecessor is pinned history215 plus successor14, not source240 or arbitrary NULL exceptions', async()=>{
  const {loadAmoraActionViewV2Plan}=await import('../lib/amora-action-view-v2-release-contract.mjs');
  const plan=loadAmoraActionViewV2Plan(repoRoot);
  assert.equal(plan.expectedLedger?.length,229);
  assert.equal(plan.expectedLedger.filter(row=>row.statementsSha256===null).length,64);
  assert.equal(new Set(plan.expectedLedger.map(row=>row.version)).size,229);
  assert.deepEqual(plan.expectedLedger.find(row=>row.version==='20260820100000'),
    {version:'20260820100000',name:'community_report_privacy_reason',
      statementsSha256:'ed3cb091dd70adda95662fe53bffa9566681c6edaa003284953b874aafb28c4a'});
  assert.equal(plan.expectedLedger.some(row=>row.version==='20260823120000'),false);
  assert.equal(plan.expectedLedger.at(-1).version,'20260928073546');
  assert.equal(plan.migrationCount,241);
  assert.equal(plan.predecessorMigrationCount,240);
  const formal=readFileSync(join(repoRoot,'supabase/migrations/20260928073546_account_deletion_anonymous_audit.sql'),'utf8');
  assert.equal(plan.expectedLedger.at(-1).statementsSha256,createHash('sha256').update(JSON.stringify([formal])).digest('hex'));
});

test('inspect executes a real read-only catalog observation without applying candidate SQL or exposing data', async () => {
  const {runAmoraActionViewV2Release} = await import('../lib/amora-action-view-v2-release.mjs');
  const {loadAmoraActionViewV2Plan} = await import('../lib/amora-action-view-v2-release-contract.mjs');
  const plan = loadAmoraActionViewV2Plan(repoRoot);
  const f = await createDraftDatabase({candidate:false});
  const events=[];
  try {
    await f.seedCanonical();
    await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
    const before=await f.read('draft_canonical');
    let requests=0;
    const result=await runAmoraActionViewV2Release({repoRoot,
      argv:['--amora-action-view-v2','--inspect','--expected-commit='+'a'.repeat(40),
        '--project-ref=slrtobkksjmxgzatjyqb','--receipt-out='+join(repoRoot,'..','SYNTHETIC-INSPECT.jsonl')],
      assertSource:()=>({commit:'a'.repeat(40),origin:'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git',clean:true}),
      receiptFactory:()=>({append:event=>events.push(event),close:()=>{}}),
      query:async (sql,options)=>{
        assert.equal(options.readOnly,true);
        requests++;
        // PGlite is PostgreSQL18.3, not hosted PG17. Only synthetic transport identity/version are mapped.
        // All catalog/row/ledger values come from the actual SQL; this cannot prove a hosted destination.
        const rows=await f.db.exec(sql.replace('(SELECT system_identifier::text FROM pg_control_system())',"'7581440907192989109'"));
        const observation=rows.flatMap(item=>item.rows??[]).find(row=>row.observation)?.observation;
        return [{observation:mapSyntheticHistoricalLedgerMetadata(
          {...observation,serverVersion:'17.10 (SYNTHETIC-TRANSPORT)'},plan)}];
      },
    });
    assert.equal(result.status,'inspected-unapplied-not-authorized');
    assert.equal(result.remoteWritesPerformed,false);
    assert.equal(result.releaseAuthorized,false);
    assert.equal(requests,1);
    assert.equal(result.observation.readOnly,true);
    assert.equal(result.observation.ledger.length,229);
    assert.equal(result.observation.ledger.filter(row=>row.statementsSha256===null).length,64);
    observedFixture=structuredClone(result.observation);
    assert.deepEqual(await f.read('draft_canonical'),before);
    assert.equal((await f.db.query("SELECT to_regprocedure('public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)') AS rpc")).rows[0].rpc,null);
    assert.equal(JSON.stringify(events).includes('SYNTHETIC-ORIGINAL'),false);
    assert.equal(events.at(-1).status,'inspected-unapplied-not-authorized');
  } finally {await f.close();}
});

test('rehearse and apply without their exact private path remain closed before transport or receipts', async () => {
  const {runAmoraActionViewV2Release} = await import('../lib/amora-action-view-v2-release.mjs');
  for(const mode of ['rehearse','apply']) {
    let sideEffects=0;
    await assert.rejects(runAmoraActionViewV2Release({repoRoot,argv:args(mode),
      query:()=>{sideEffects++;},assertSource:()=>{sideEffects++;},receiptFactory:()=>{sideEffects++;}}),
    error=>error.code==='AMORA_VIEW_V2_PRIVATE_RECEIPT_REQUIRED');
    assert.equal(sideEffects,0);
  }
});

test('unknown destination or caller-controlled SQL and ambiguous mode flags fail before transport', async () => {
  const {runAmoraActionViewV2Release} = await import('../lib/amora-action-view-v2-release.mjs');
  for(const argv of [args('inspect').map(arg=>arg.startsWith('--project-ref=')?'--project-ref=anotherproject':arg),
    [...args('inspect'),'--apply'],[...args('inspect'),'--query=SELECT 1'],
    [...args('inspect'),'--url=https://outside.invalid'],[...args('inspect'),'--skip-backup']]) {
    let requests=0;
    await assert.rejects(runAmoraActionViewV2Release({repoRoot,argv,query:()=>{requests++;}}),
      error=>error.code==='AMORA_VIEW_V2_ARGUMENT_INVALID'||error.code==='AMORA_VIEW_V2_ARGUMENT_DUPLICATE');
    assert.equal(requests,0);
  }
});

test('a changed draft release contract cannot become production-ready or broaden its candidate pin', async () => {
  const {loadAmoraActionViewV2Plan} = await import('../lib/amora-action-view-v2-release-contract.mjs');
  const owned=mkdtempSync(join(tmpdir(),'amora-view-v2-test-'));
  try {
    mkdirSync(join(owned,'supabase/release-contracts'),{recursive:true});
    const path='supabase/release-contracts/amora-action-view-v2-v1.json';
    const contract=JSON.parse(readFileSync(join(repoRoot,path),'utf8'));
    contract.productionApplyImplemented=true;
    contract.candidate.sha256='b'.repeat(64);
    writeFileSync(join(owned,path),JSON.stringify(contract));
    assert.throws(()=>loadAmoraActionViewV2Plan(owned),error=>error.code==='ARTIFACT_HASH_MISMATCH');
  } finally {
    // Own freshly-created tmp fixture only; never recurse through a repository or a caller path.
    assert.equal(owned.startsWith(join(tmpdir(),'amora-view-v2-test-')),true);
    rmSync(owned,{recursive:true,force:true});
  }
});

test('real PG17 catalog observation preserves candidate absence and full synthetic ledger/data',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const {runAmoraActionViewV2Release} = await import('../lib/amora-action-view-v2-release.mjs');
    const {loadAmoraActionViewV2Plan} = await import('../lib/amora-action-view-v2-release-contract.mjs');
    const plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.seedCanonical();
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const before=await f.read('draft_canonical');
      const result=await runAmoraActionViewV2Release({repoRoot,argv:args('inspect'),assertSource:source,
        receiptFactory:()=>({append:()=>{},close:()=>{}}),query:async(sql,settings)=>{
          assert.equal(settings.readOnly,true);
          // Only the isolated cluster identifier is mapped at the transport boundary. PG17 version is actual.
          const results=await f.db.query(sql.replace('(SELECT system_identifier::text FROM pg_control_system())',"'7581440907192989109'"));
          return results.flatMap(result=>result.rows??[]).filter(row=>row.observation)
            .map(row=>({observation:mapSyntheticHistoricalLedgerMetadata(row.observation,plan)}));
        }});
      assert.match(result.observation.serverVersion,/^17\./);
      assert.equal(result.status,'inspected-unapplied-not-authorized');
      assert.equal(result.releaseAuthorized,false);
      assert.deepEqual(await f.read('draft_canonical'),before);
      assert.equal((await f.db.query("SELECT to_regprocedure('public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)') AS rpc")).rows[0].rpc,null);
    } finally {await f.close();}
  });

test('the provider read-only observer is accepted as observation only while unexpected roles are rejected',async()=>{
  const {runAmoraActionViewV2Release}=await import('../lib/amora-action-view-v2-release.mjs');
  assert.ok(observedFixture);
  const observation={...structuredClone(observedFixture),currentUser:'supabase_read_only_user',observedAt:new Date().toISOString()};
  const result=await runAmoraActionViewV2Release({repoRoot,argv:args('inspect'),assertSource:source,
    query:async()=>[{observation}],receiptFactory:()=>({append:()=>{},close:()=>{}})});
  assert.equal(result.status,'inspected-unapplied-not-authorized');
  assert.equal(result.remoteWritesPerformed,false);
  for(const currentUser of ['authenticated','service_role','supabase_read_only_user_extra',' supabase_read_only_user']) {
    await assert.rejects(runAmoraActionViewV2Release({repoRoot,argv:args('inspect'),assertSource:source,
      query:async()=>[{observation:{...observation,currentUser,observedAt:new Date().toISOString()}}],
      receiptFactory:()=>({append:()=>{},close:()=>{}})}),error=>error.code==='AMORA_VIEW_V2_DESTINATION_INVALID');
  }
});

test('an unexpected observation payload is rejected without writing customer text into the receipt', async()=>{
  const {runAmoraActionViewV2Release}=await import('../lib/amora-action-view-v2-release.mjs');
  assert.ok(observedFixture,'the real SQL inspection fixture must be available');
  const observation=structuredClone(observedFixture);
  observation.observedAt=new Date().toISOString();
  observation.customerText='SYNTHETIC-UNTRUSTED-CUSTOMER-CONTENT';
  const events=[];
  await assert.rejects(runAmoraActionViewV2Release({repoRoot,argv:args('inspect'),assertSource:source,
    query:async()=>[{observation}],receiptFactory:()=>({append:value=>events.push(value),close:()=>{}})}),
  error=>error.code==='AMORA_VIEW_V2_OBSERVATION_INVALID');
  assert.equal(JSON.stringify(events).includes(observation.customerText),false);
  assert.equal(events.at(-1).status,'inspection-blocked');
});

test('wrong identity, stale observations, ledger drift and existing ACL changes cannot pass inspection', async()=>{
  const {runAmoraActionViewV2Release}=await import('../lib/amora-action-view-v2-release.mjs');
  assert.ok(observedFixture);
  const mutations=[
    [o=>{o.systemIdentifier='7581440907192989110';},'AMORA_VIEW_V2_DESTINATION_INVALID'],
    [o=>{o.readOnly=false;},'AMORA_VIEW_V2_DESTINATION_INVALID'],
    [o=>{o.observedAt=new Date(Date.now()-121_000).toISOString();},'AMORA_VIEW_V2_OBSERVATION_EXPIRED'],
    [o=>{o.ledger.pop();},'AMORA_VIEW_V2_LEDGER_VERSION_DRIFT'],
    [o=>{o.ledger.push({...o.ledger[0],version:'20300101000000'});},'AMORA_VIEW_V2_LEDGER_VERSION_DRIFT'],
    [o=>{o.ledger.push({...o.ledger[0]});},'AMORA_VIEW_V2_LEDGER_VERSION_DRIFT'],
    [o=>{o.ledger[0].name='changed_name';},'AMORA_VIEW_V2_LEDGER_VERSION_DRIFT'],
    [o=>{const row=o.ledger.find(row=>row.statementsSha256!==null);row.statementsSha256='b'.repeat(64);},
      'AMORA_VIEW_V2_LEDGER_STATEMENTS_DRIFT'],
    [o=>{const row=o.ledger.find(row=>row.statementsSha256!==null);Object.assign(row,
      {statementsSha256:null,statementCount:null,sqlMd5:null});},'AMORA_VIEW_V2_LEDGER_STATEMENTS_DRIFT'],
    [o=>{const row=o.ledger.find(row=>row.statementsSha256===null);Object.assign(row,
      {statementsSha256:'b'.repeat(64),statementCount:1,sqlMd5:'a'.repeat(32)});},'AMORA_VIEW_V2_LEDGER_STATEMENTS_DRIFT'],
    [o=>{o.ledger.find(row=>row.statementsSha256===null).statementCount=1;},'AMORA_VIEW_V2_LEDGER_INVALID'],
    [o=>{o.ledger.find(row=>row.version==='20260928073546').statementCount=2;},'AMORA_VIEW_V2_LEDGER_FOLLOWUP_DRIFT'],
    [o=>{o.target.functions.push({...o.target.functions[0],identity:'public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)'});},
      'AMORA_VIEW_V2_UNREGISTERED_OR_MISSING_FUNCTIONS'],
    [o=>{o.target.functions[0].acl.push(['service_role','postgres','EXECUTE',false]);},'AMORA_VIEW_V2_EXISTING_FUNCTION_DRIFT'],
    [o=>{o.target.timestampTriggers[0][1]='D';},'AMORA_VIEW_V2_TIMESTAMP_TRIGGER_DRIFT'],
  ];
  for(const [mutate,code] of mutations) {
    const observation=structuredClone(observedFixture);
    observation.observedAt=new Date().toISOString();
    mutate(observation);
    const events=[];
    await assert.rejects(runAmoraActionViewV2Release({repoRoot,argv:args('inspect'),assertSource:source,
      query:async()=>[{observation}],receiptFactory:()=>({append:value=>events.push(value),close:()=>{}})}),error=>error.code===code);
    assert.equal(events.at(-1).status,'inspection-blocked');
    assert.equal(events.some(event=>event.status==='inspected-unapplied-not-authorized'),false);
  }
});

test('the default source guard checks clean identity and each dirty state in an owned Git fixture', async()=>{
  const {assertAmoraActionViewV2Source}=await import('../lib/amora-action-view-v2-release.mjs');
  const owned=mkdtempSync(join(tmpdir(),'amora-view-v2-test-'));
  const git=argv=>execFileSync('git',['-C',owned,...argv],
    {encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  const origin='https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git';
  try {
    git(['init']);
    git(['remote','add','origin',origin]);
    writeFileSync(join(owned,'synthetic.txt'),'SYNTHETIC SOURCE\n');
    git(['add','synthetic.txt']);
    git(['-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid',
      'commit','-m','synthetic source guard fixture']);
    const head=git(['rev-parse','HEAD']);
    assert.deepEqual(assertAmoraActionViewV2Source(owned,head),{commit:head,origin,clean:true});
    assert.throws(()=>assertAmoraActionViewV2Source(owned,'a'.repeat(40)),
      error=>error.code==='AMORA_VIEW_V2_SOURCE_NOT_CLEAN_EXACT_COMMIT');

    git(['remote','set-url','origin','https://example.invalid/untrusted.git']);
    assert.throws(()=>assertAmoraActionViewV2Source(owned,head),
      error=>error.code==='AMORA_VIEW_V2_ORIGIN_CHANGED');
    git(['remote','set-url','origin',origin]);

    writeFileSync(join(owned,'untracked.txt'),'SYNTHETIC UNTRACKED\n');
    assert.throws(()=>assertAmoraActionViewV2Source(owned,head),
      error=>error.code==='AMORA_VIEW_V2_SOURCE_NOT_CLEAN_EXACT_COMMIT');
    rmSync(join(owned,'untracked.txt'));
    writeFileSync(join(owned,'synthetic.txt'),'SYNTHETIC MODIFIED\n');
    assert.throws(()=>assertAmoraActionViewV2Source(owned,head),
      error=>error.code==='AMORA_VIEW_V2_SOURCE_NOT_CLEAN_EXACT_COMMIT');
    git(['add','synthetic.txt']);
    assert.throws(()=>assertAmoraActionViewV2Source(owned,head),
      error=>error.code==='AMORA_VIEW_V2_SOURCE_NOT_CLEAN_EXACT_COMMIT');
  } finally {
    assert.equal(owned.startsWith(join(tmpdir(),'amora-view-v2-test-')),true);
    rmSync(owned,{recursive:true,force:true});
  }
});

test('a real inspection receipt is exclusive, outside Git and preserves existing bytes on a second open', async()=>{
  const {openAmoraActionViewV2Receipt}=await import('../lib/amora-action-view-v2-release.mjs');
  const owned=mkdtempSync(join(tmpdir(),'amora-view-v2-test-'));
  try {
    const file=join(owned,'synthetic.jsonl');
    const receipt=openAmoraActionViewV2Receipt(file,repoRoot);
    try {receipt.append({format:'SYNTHETIC-RECEIPT',releaseAuthorized:false});}
    finally {receipt.close();}
    const before=readFileSync(file,'utf8');
    assert.deepEqual(JSON.parse(before),{format:'SYNTHETIC-RECEIPT',releaseAuthorized:false});
    assert.throws(()=>openAmoraActionViewV2Receipt(file,repoRoot),error=>error.code==='EEXIST');
    assert.equal(readFileSync(file,'utf8'),before);
    assert.throws(()=>openAmoraActionViewV2Receipt(join(repoRoot,'.verification/forbidden.jsonl'),repoRoot),
      error=>error.code==='AMORA_VIEW_V2_RECEIPT_PATH_INVALID');
  } finally {
    assert.equal(owned.startsWith(join(tmpdir(),'amora-view-v2-test-')),true);
    rmSync(owned,{recursive:true,force:true});
  }
});
