import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve,join,basename} from 'node:path';
import {readFileSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createDraftDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';
import {loadAmoraActionViewV2Plan} from '../lib/amora-action-view-v2-release-contract.mjs';
import {buildAmoraActionViewV2ObservationSql} from '../lib/amora-action-view-v2-catalog.mjs';
import {buildAmoraActionViewV2RehearsalSql} from '../lib/amora-action-view-v2-rehearsal.mjs';
import {buildAmoraActionViewV2CommitSql} from '../lib/amora-action-view-v2-commit.mjs';
import {seedSyntheticAmoraHistoryLedger,mapSyntheticHistoricalLedgerMetadata} from './fixtures/amora-action-view-v2-ledger-fixture.mjs';
import {createSyntheticAmoraAdmissionBoundary} from './fixtures/amora-action-view-v2-admission-fixture.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url)),commit='a'.repeat(40);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// 부모가 승인한 비민감 generic177 seed만 쓴다. 운영 원본 캡처·시간·ID를 복사하지 않는다.
const genericSeed="CREATE OR REPLACE FUNCTION public.update_updated_at_column()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\r\nbegin\r\n  new.updated_at = now();\r\n  return new;\r\nend;\r\n$function$\n";
const args=(mode='rehearse')=>['--amora-action-view-v2','--'+mode,'--expected-commit='+commit,
  '--project-ref=slrtobkksjmxgzatjyqb','--receipt-out=private-store/'+(mode==='apply'?'apply':'rehearsal')+'.jsonl',
  '--confirm-production=amora-action-view-v2-20261012:slrtobkksjmxgzatjyqb:'+mode+':'+commit];
const observe=async f=>(await f.db.query(buildAmoraActionViewV2ObservationSql()))
  .flatMap(row=>row.rows??[]).find(row=>row.observation).observation;
function cleanup(result) {
  if(!result?.recoveryId||!result?.privateDirectory)return;
  const id=result.recoveryId,dir=result.privateDirectory;
  assert.equal(basename(dir),id);
  assert.equal(resolve(dir),resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionViewV2Recovery',id));
  for(const name of readdirSync(dir)) {assert.ok(['original-capsule.dpapi','rehearsal.jsonl','apply.jsonl'].includes(name));unlinkSync(join(dir,name));}
  rmdirSync(dir);
}
async function waitForActualDeadline(deadline) {
  const until=Date.parse(deadline)+25;
  assert.ok(Number.isFinite(until)&&until-Date.now()<=120_025,'the actual deadline is not extended or replaced');
  while(Date.now()<until)await new Promise(resolve=>setTimeout(resolve,Math.min(1000,until-Date.now())));
}

test('bad confirmation, mixed offline/default transport and unsuccessful CI cannot send any database request',async()=>{
  const {runAmoraActionViewV2Release}=await import('../lib/amora-action-view-v2-release.mjs');
  let requests=0,commands=0;
  const query=async()=>{requests++;throw new Error('no database request may be sent');};
  const boundary=createSyntheticAmoraAdmissionBoundary();
  await assert.rejects(()=>runAmoraActionViewV2Release({repoRoot,argv:args('apply').map(arg=>
    arg.startsWith('--confirm-production=')?'--confirm-production=wrong':arg),query,
    runCommand:async(...input)=>{commands++;return boundary(...input);},environment:{}}),
  error=>error.code==='AMORA_VIEW_V2_CONFIRMATION_REQUIRED');
  assert.equal(requests,0);assert.equal(commands,0);
  await assert.rejects(()=>runAmoraActionViewV2Release({repoRoot,argv:args('apply'),
    runCommand:async(...input)=>{commands++;return boundary(...input);},environment:{}}),
  error=>error.code==='AMORA_VIEW_V2_OFFLINE_QUERY_REQUIRED');
  assert.equal(requests,0);assert.equal(commands,0);
  await assert.rejects(()=>runAmoraActionViewV2Release({repoRoot,argv:args('apply'),query,
    runCommand:async(binary,input)=>{
      const raw=await boundary(binary,input);
      if(input.some(arg=>arg.includes('/check-runs?'))) {
        const value=JSON.parse(raw);value.check_runs[0].conclusion='failure';return JSON.stringify(value);
      }
      return raw;
    },environment:{}}),error=>error.code==='AMORA_VIEW_V2_ADMISSION_CHECK_NOT_SUCCESSFUL');
  assert.equal(requests,0);
});

for(const scenario of [
  {kind:'success',name:'normal rehearsal verifies real private originals/native replay and independently reobserves unconditional rollback'},
  {kind:'lost-response',name:'a lost reply after the actual rollback is indeterminate, persisted and never automatically retried'},
  {kind:'post-drift',name:'a real intervening row edit after rollback is not ignored or reported as a successful rehearsal'},
  {kind:'apply-success',name:'apply verifies an unconditional rollback before one exact COMMIT and independent persisted-state observation'},
  {kind:'apply-lost-response',name:'a lost COMMIT reply is indeterminate despite persisted SQL and is never retried'},
  {kind:'apply-invalid-receipt',name:'a false COMMIT receipt cannot report successful application despite a real persisted transaction'},
  {kind:'apply-post-drift',name:'an intervening row edit after COMMIT cannot report successful verified application'},
  {kind:'apply-expired-before-send',name:'a real expired recovery deadline prevents even the first rollback request'},
  {kind:'apply-expired-after-commit',name:'a real expired deadline after persisted COMMIT remains indeterminate and never returns success'},
]) test(scenario.name,
  {skip:process.platform!=='win32'||!nativeProfileRoleAvailable,timeout:180_000},async()=>{
    const {runAmoraActionViewV2Release}=await import('../lib/amora-action-view-v2-release.mjs');
    const plan=loadAmoraActionViewV2Plan(repoRoot),f=await createDraftDatabase({native:true,candidate:false});
    let result,mutations=0,commits=0,captureDeadline;
    const mode=scenario.kind.startsWith('apply-')?'apply':'rehearse';
    try {
      assert.equal(sha(genericSeed),'7b39b72b4fe4d1981fca770b1ad1ad6e062d560822731577e5ae3f1449ffef02');
      await f.exec(genericSeed);
      await f.exec('GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon,authenticated,service_role');
      await f.seedCanonical();await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const original=await observe(f);
      const query=async(sql,options)=>{
        if(options.readOnly===false) {
          mutations++;
          const nativeBefore=mapSyntheticHistoricalLedgerMetadata(await observe(f),plan);
          // 별도 renderer로 실제 owned ID의 한정 SQL을 생성한다. 운영 SQL의 ID를 string-replace하지 않는다.
          const nativeArgs={repoRoot,before:nativeBefore,expectedSystemIdentifier:original.systemIdentifier,deadline:options.deadline};
          const nativeSql=options.operation==='fixed-commit'?buildAmoraActionViewV2CommitSql(nativeArgs)
            :buildAmoraActionViewV2RehearsalSql(nativeArgs);
          assert.ok(['unconditional-rollback','fixed-commit'].includes(options.operation));
          assert.match(sql,options.operation==='fixed-commit'?/COMMIT;$/:/ROLLBACK;$/);
          if(options.operation==='fixed-commit')commits++;
          const rows=await f.db.query(nativeSql);
          const evidence=rows.flatMap(row=>row.rows??[]).find(row=>row.rehearsal_evidence).rehearsal_evidence;
          if(scenario.kind==='lost-response')throw new Error('synthetic response lost after exact native rollback');
          if(scenario.kind==='post-drift')await f.db.query("UPDATE public.amora_actions SET description='synthetic-concurrent-customer-edit' WHERE id='draft_canonical'");
          if(options.operation==='fixed-commit') {
            if(scenario.kind==='apply-lost-response')throw new Error('synthetic response lost after exact native COMMIT');
            if(scenario.kind==='apply-invalid-receipt')return [{rehearsal_evidence:{...evidence,rawSqlMatches:false}}];
            if(scenario.kind==='apply-post-drift')await f.db.query("UPDATE public.amora_actions SET description='synthetic-concurrent-customer-edit' WHERE id='draft_canonical'");
            if(scenario.kind==='apply-expired-after-commit') {
              await waitForActualDeadline(options.deadline);
            }
          }
          return [{rehearsal_evidence:evidence}];
        }
        const rows=await f.db.query(sql);
        const capsule=rows.flatMap(row=>row.rows??[]).find(row=>row.recovery_capsule)?.recovery_capsule;
        if(capsule) {
          captureDeadline=Date.parse(capsule.capturedAt)+120_000;
          // 외부 provider payload만 명시 합성화한다. native 실행·SQL 안의 실제 ID/역할은 치환하지 않는다.
          return [{recovery_capsule:{...capsule,sourceSystemIdentifier:plan.contract.systemIdentifier,
            currentUser:'supabase_read_only_user'}}];
        }
        const raw=rows.flatMap(row=>row.rows??[]).find(row=>row.observation).observation;
        if(scenario.kind==='apply-expired-before-send'&&captureDeadline!==undefined) {
          await waitForActualDeadline(new Date(captureDeadline).toISOString());
        }
        return [{observation:mapSyntheticHistoricalLedgerMetadata({...raw,
          systemIdentifier:plan.contract.systemIdentifier,currentUser:'supabase_read_only_user'},plan)}];
      };
      const execute=()=>runAmoraActionViewV2Release({repoRoot,argv:args(mode),query,
        runCommand:createSyntheticAmoraAdmissionBoundary(),
        assertSource:()=>({commit,origin:'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git',clean:true}),
        environment:{}});
      if(['success','apply-success'].includes(scenario.kind)) {
        result=await execute();
        assert.equal(result.status,mode==='apply'?'offline-applied-and-independently-verified-scoped':'offline-rehearsed-and-rolled-back-scoped');
        assert.equal(result.productionApplyImplemented,mode==='apply');assert.equal(result.releaseAuthorized,false);
        assert.equal(result.operationalEvidenceVerified,false);assert.equal(result.committedMutationObserved,mode==='apply');
      } else {
        await assert.rejects(execute(),error=>{
          result=error;
          assert.equal(error.code,scenario.kind==='apply-expired-before-send'?'AMORA_VIEW_V2_CAPTURE_EXPIRED_OR_CHANGED':mode==='apply'?'AMORA_VIEW_V2_APPLY_OUTCOME_REQUIRES_INSPECTION'
            :'AMORA_VIEW_V2_REHEARSAL_OUTCOME_REQUIRES_INSPECTION');
          assert.equal(error.automaticRetryProhibited,scenario.kind!=='apply-expired-before-send');return true;
        });
      }
      assert.equal(mutations,scenario.kind==='apply-expired-before-send'?0:mode==='apply'?2:1);
      assert.equal(commits,scenario.kind==='apply-expired-before-send'?0:mode==='apply'?1:0);
      const after=await observe(f);
      assert.equal(after.systemIdentifier,original.systemIdentifier);
      if(mode==='apply'&&scenario.kind!=='apply-expired-before-send') {
        assert.deepEqual(after.target,plan.catalogFixture.applied);assert.equal(after.ledger.length,230);
        assert.deepEqual(after.ledger.filter(row=>row.version!==plan.migration.version),original.ledger);
        assert.equal(after.preservedCatalogMd5,original.preservedCatalogMd5);
      } else for(const key of ['target','ledger','ledgerMd5','preservedCatalogMd5'])assert.deepEqual(after[key],original[key]);
      if(['post-drift','apply-post-drift'].includes(scenario.kind))assert.notDeepEqual(after.rows,original.rows);
      else assert.deepEqual(after.rows,original.rows);
      if(scenario.kind==='apply-expired-before-send') {
        assert.deepEqual(readdirSync(result.privateDirectory),['original-capsule.dpapi']);return;
      }
      const journal=readFileSync(join(result.privateDirectory,mode==='apply'?'apply.jsonl':'rehearsal.jsonl'),'utf8');
      assert.equal(journal.includes('CREATE OR REPLACE FUNCTION'),false);
      assert.match(journal,mode==='apply'?(scenario.kind==='apply-success'?/applied-and-independently-verified-scoped/
        :/apply-outcome-requires-inspection/):
        scenario.kind==='success'?/rehearsed-and-rolled-back-scoped/:/rehearsal-outcome-requires-inspection/);
      if(!['success','apply-success'].includes(scenario.kind))assert.doesNotMatch(journal,/(?:offline-)?applied-and-independently-verified-scoped/);
    } finally {cleanup(result);await f.close();}
  });
