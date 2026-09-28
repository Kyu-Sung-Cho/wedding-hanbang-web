import test from 'node:test';
import { createWeddingCodePairSessionConflictHistoricalRepository } from './fixtures/wedding-code-pair-session-conflict-historical-repository.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { appendWeddingCodePairSessionConflictReceipt, parseWeddingCodePairSessionConflictReleaseArgs, runWeddingCodePairSessionConflictRelease } from '../lib/wedding-code-pair-session-conflict-release.mjs';
import { buildWeddingCodePairSessionConflictMutationSql, buildWeddingCodePairSessionConflictObservationSql, expectedWeddingCodePairSessionConflictCatalog,
  validateWeddingCodePairSessionConflictObservation } from '../lib/wedding-code-pair-session-conflict-catalog.mjs';

const historical=createWeddingCodePairSessionConflictHistoricalRepository(resolve(import.meta.dirname,'../..'));
test.after(historical.cleanup);
const root=historical.root,read=file=>readFileSync(join(root,file),'utf8');
const sql=read('supabase/migrations/20260923132503_wedding_code_pair_session_conflict_response.sql');
const predecessorSql=read('supabase/migrations/20260923104336_wedding_code_pair_sessions.sql');
const predecessorFixture=JSON.parse(read('supabase/release-contracts/wedding-code-pair-session-pg17-catalog-v1.json'));
const catalog=JSON.parse(read('supabase/release-contracts/wedding-code-pair-session-conflict-pg17-catalog-v1.json'));
const context={sql,predecessorSql,fixture:catalog,predecessorFixture},instant=new Date('2026-09-23T07:00:00Z'),commit='a'.repeat(40),project='slrtobkksjmxgzatjyqb';
const md5=value=>createHash('md5').update(value).digest('hex'),code=value=>error=>error?.code===value;
const args=(mode='apply')=>['--wedding-code-pair-session-conflict',`--${mode}`,`--expected-commit=${commit}`,`--project-ref=${project}`,
  `--receipt-out=${join(tmpdir(),'unused-wedding-code-pair-session-conflict-synthetic.jsonl')}`,
  `--confirm-production=wedding-code-pair-session-conflict-20260923:${project}:${mode}:${commit}`];
const before=()=>({format:'wedding-code-pair-session-conflict-catalog-v1',systemIdentifier:'7581440907192989109',serverVersion:'17.6',
  database:'postgres',currentUser:'postgres',readOnly:true,dependenciesReady:true,observedAt:instant.toISOString(),
  catalog:expectedWeddingCodePairSessionConflictCatalog(catalog,false,predecessorFixture),dependencies:structuredClone(catalog.dependencies),preservedCatalogSha:'e'.repeat(32),ledgerSha:'b'.repeat(32),ledgerWithoutTargetSha:'b'.repeat(32),
  ledgerCount:238,migration:null,predecessor:{version:'20260923104336',name:'wedding_code_pair_sessions',statementCount:1,sqlMd5:md5(predecessorSql)}});
const after=()=>({...before(),catalog:expectedWeddingCodePairSessionConflictCatalog(catalog,true),ledgerSha:'c'.repeat(32),ledgerCount:239,
  migration:{version:'20260923132503',name:'wedding_code_pair_session_conflict_response',statementCount:1,sqlMd5:md5(sql)}});
function fixture({mode='apply',observations=[before(),before(),after()],onQuery,onRecord,onSource,now}={}){
  const calls=[],events=[];let reads=0,closed=false,sourceChecks=0;
  return{calls,events,get closed(){return closed},get sourceChecks(){return sourceChecks},run:()=>runWeddingCodePairSessionConflictRelease({repoRoot:root,argv:args(mode),now:now??(()=>instant),
    assertSource:()=>{sourceChecks++;onSource?.(sourceChecks)},receiptFactory:()=>({append:event=>{onRecord?.(event);events.push(event)},close:()=>{closed=true}}),
    query:async text=>{calls.push(text);await onQuery?.(text,calls.length);return text===buildWeddingCodePairSessionConflictObservationSql()?[{observation:structuredClone(observations[reads++])}]:[]}})};
}

test('the scoped runtime requires an exact destination, clean commit request and new absolute receipt',()=>{
  assert.equal(parseWeddingCodePairSessionConflictReleaseArgs(args()).mode,'apply');
  for(const argv of [[],args().slice(0,-1),[...args(),'--apply'],[...args(),'--remote'],args().map(s=>s.replace(project,'wrong')),
    args().map(s=>s.startsWith('--receipt-out=')?'--receipt-out=relative.jsonl':s),args().map(s=>s.replace(commit,'HEAD'))])
    assert.throws(()=>parseWeddingCodePairSessionConflictReleaseArgs(argv));
});

test('the runtime refuses a receipt inside the repository before any observation or write',async()=>{
  let called=false;
  await assert.rejects(runWeddingCodePairSessionConflictRelease({repoRoot:root,
    argv:args('inspect').map(arg=>arg.startsWith('--receipt-out=')?`--receipt-out=${join(root,'unsafe-receipt.jsonl')}`:arg),
    query:async()=>{called=true;return[]},receiptFactory:()=>{called=true;throw Error('must not open')}}),
    code('WEDDING_CODE_PAIR_SESSION_CONFLICT_RECEIPT_MUST_BE_OUTSIDE_REPOSITORY'));
  assert.equal(called,false);
});

test('observation admission rejects stale identity, privileges, function bodies, triggers or ledger claims',()=>{
  assert.equal(validateWeddingCodePairSessionConflictObservation(before(),{...context,now:instant}).migration,null);
  assert.ok(validateWeddingCodePairSessionConflictObservation(after(),{...context,now:instant}).migration);
  for(const change of [{dependenciesReady:false},{readOnly:false},{currentUser:'service_role'},{systemIdentifier:'wrong'},{serverVersion:'18.0'},
    {observedAt:'2026-09-23T06:57:59Z'},{observedAt:'2026-09-23T07:00:11Z'},{predecessor:null},{dependencies:[]},{ledgerCount:0},{ledgerWithoutTargetSha:'c'.repeat(32)},
    {migration:{...after().migration,sqlMd5:'a'.repeat(32)}},{catalog:structuredClone(catalog)}])
    assert.throws(()=>validateWeddingCodePairSessionConflictObservation({...before(),...change},{...context,now:instant}));
  for(const mutate of [c=>c.relations[0].acl.push(['authenticated','postgres','SELECT',false]),c=>c.relations[0].forceRls=false,
    c=>c.functions[0].body+='\n',c=>c.cronJobs[0].active=false,c=>c.cronJobs[0].command='SELECT 1;']){
    const value=after();mutate(value.catalog);assert.throws(()=>validateWeddingCodePairSessionConflictObservation(value,{...context,now:instant}),code('WEDDING_CODE_PAIR_SESSION_CONFLICT_TARGET_CATALOG_DRIFT'));
  }
});

test('inspect and already-applied runs never send a mutation; apply rehearses the identical guarded bundle then independently reads back',async()=>{
  for(const options of [{mode:'inspect'},{observations:[after()]}]){const f=fixture(options),result=await f.run();assert.equal(f.calls.length,1);assert.equal(result.remoteWritesPerformed,false);assert.equal(f.closed,true)}
  const rehearsal=fixture({mode:'rehearse'});assert.equal((await rehearsal.run()).status,'rehearsed-and-rolled-back');assert.equal(rehearsal.calls.length,3);
  const f=fixture(),result=await f.run();assert.equal(result.status,'applied-and-postverified');assert.equal(result.remoteWritesPerformed,true);
  assert.equal(f.calls.length,5);assert.equal(f.sourceChecks,2);assert.equal(f.closed,true);
  assert.equal(f.calls[1].replace(/ROLLBACK;$/,'COMMIT;'),f.calls[3]);
  assert.equal(f.events.at(-1).status,'applied-and-postverified');
  assert.match(f.calls[1],/LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(f.calls[1],/WEDDING_CODE_PAIR_SESSION_CONFLICT_BASELINE_DRIFT/);assert.match(f.calls[1],/WEDDING_CODE_PAIR_SESSION_CONFLICT_AFTER_DRIFT/);
});

test('rollback drift, stale source, deadline and receipt failures cannot reach commit, and uncertain commits are not retried',async()=>{
  let time=instant;
  for(const options of [
    {onQuery:(_text,call)=>{if(call===2)throw Error('synthetic timeout')}},
    {observations:[before(),{...before(),preservedCatalogSha:'f'.repeat(32)}]},
    {observations:[before(),{...before(),ledgerCount:239}]},
    {onSource:n=>{if(n===2)throw Error('synthetic dirty source')}},
    {onRecord:event=>{if(event.status==='apply-outcome-unverified')throw Error('synthetic disk full')}},
    {now:()=>time,onRecord:event=>{if(event.status==='rehearsed-and-rolled-back')time=new Date(instant.getTime()+120_001)}},
  ]){time=instant;const f=fixture(options);await assert.rejects(f.run(),code('WEDDING_CODE_PAIR_SESSION_CONFLICT_OUTCOME_REQUIRES_INSPECTION'));
    assert.equal(f.calls.some(text=>text.endsWith('COMMIT;')&&!text.startsWith('BEGIN READ ONLY')),false);
    assert.equal(f.events.at(-1).retryProhibited,true);assert.equal(f.closed,true)}
  const lost=fixture({onQuery:(_text,call)=>{if(call===4)throw Error('synthetic lost response')}});
  await assert.rejects(lost.run(),code('WEDDING_CODE_PAIR_SESSION_CONFLICT_OUTCOME_REQUIRES_INSPECTION'));assert.equal(lost.calls.length,4);
  for(const change of [{preservedCatalogSha:'f'.repeat(32)},{ledgerCount:240},{ledgerWithoutTargetSha:'f'.repeat(32)},{catalog:before().catalog}]){
    const f=fixture({observations:[before(),before(),{...after(),...change}]});await assert.rejects(f.run(),code('WEDDING_CODE_PAIR_SESSION_CONFLICT_OUTCOME_REQUIRES_INSPECTION'));
    assert.equal(f.calls.length,5);assert.equal(f.events.some(e=>e.status==='applied-and-postverified'),false);
  }
});

test('unwrapped SQL cannot commit early and receipt writes must fully flush before continuing',()=>{
  assert.throws(()=>buildWeddingCodePairSessionConflictMutationSql({...context,sql:sql.replace('BEGIN;','BEGIN; COMMIT;'),before:before(),deadline:instant.toISOString(),rehearsal:true}),code('WEDDING_CODE_PAIR_SESSION_CONFLICT_SQL_ENVELOPE_INVALID'));
  const chunks=[];let flushed=0;const event={status:'apply-outcome-unverified',detail:'합성 기록'};
  appendWeddingCodePairSessionConflictReceipt(7,event,{write:(_fd,bytes,offset,length)=>{const n=Math.min(3,length);chunks.push(bytes.subarray(offset,offset+n));return n},flush:()=>{flushed++}});
  assert.equal(Buffer.concat(chunks).toString(),JSON.stringify(event)+'\n');assert.equal(flushed,1);
  assert.throws(()=>appendWeddingCodePairSessionConflictReceipt(7,event,{write:()=>0,flush:()=>{throw Error('must not flush')}}),code('WEDDING_CODE_PAIR_SESSION_CONFLICT_RECEIPT_WRITE_INCOMPLETE'));
});
