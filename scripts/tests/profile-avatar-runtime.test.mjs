import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {parseProfileAvatarReleaseArgs,runProfileAvatarRelease,appendProfileAvatarReceipt} from '../lib/profile-avatar-release.mjs';
import {buildProfileAvatarObservationSql,expectedProfileAvatarCatalog,validateProfileAvatarObservation} from '../lib/profile-avatar-catalog.mjs';
const root=resolve(import.meta.dirname,'../..'),read=file=>readFileSync(join(root,file),'utf8');
const context={sql:read('supabase/migrations/20260913082314_private_profile_avatars_delivery.sql'),previousSql:read('supabase/migrations/20260716113000_account_deletion_storage_saga.sql'),
 fixture:JSON.parse(read('supabase/release-contracts/profile-avatar-pg17-catalog-v1.json')),predecessorSql:read('supabase/migrations/20260913075045_profile_wedding_roles.sql')};
const instant=new Date('2026-09-13T09:00:00Z'),commit='a'.repeat(40),project='slrtobkksjmxgzatjyqb';
const md5=s=>createHash('md5').update(s).digest('hex');
const args=(mode='apply')=>['--profile-avatar',`--${mode}`,`--expected-commit=${commit}`,`--project-ref=${project}`,
 `--receipt-out=${join(tmpdir(),'unused-avatar-synthetic.jsonl')}`,`--confirm-production=profile-avatar-20260913:${project}:${mode}:${commit}`];
const before=()=>({format:'profile-avatar-catalog-v1',systemIdentifier:'7581440907192989109',serverVersion:'17.6',database:'postgres',readOnly:true,observedAt:instant.toISOString(),
 permission:{currentUser:'postgres',owner:'supabase_storage_admin',ownerUsage:false,rls:true,policyGrants:'{"postgres":["storage.objects"]}',preloaded:'pg_stat_statements,pg_cron'},
 catalog:expectedProfileAvatarCatalog(context.fixture,{...context,applied:false}),preservedCatalogSha:'e'.repeat(32),preservedBucketsSha:'f'.repeat(32),
 ledgerSha:'b'.repeat(32),ledgerWithoutTargetSha:'b'.repeat(32),ledgerCount:220,migration:null,
 predecessor:{version:'20260913075045',name:'profile_wedding_roles',statementCount:1,sqlMd5:md5(context.predecessorSql)}});
const after=()=>({...before(),catalog:expectedProfileAvatarCatalog(context.fixture,{...context,applied:true}),ledgerSha:'c'.repeat(32),ledgerCount:221,
 migration:{version:'20260913082314',name:'private_profile_avatars_delivery',statementCount:1,sqlMd5:md5(context.sql)}});
function fixture({mode='apply',observations=[before(),before(),after()],onQuery,onRecord}={}) {
 const calls=[],events=[];let reads=0,closed=false;
 return {calls,events,get closed(){return closed},run:()=>runProfileAvatarRelease({repoRoot:root,argv:args(mode),now:()=>instant,assertSource:()=>{},
  receiptFactory:()=>({append:event=>{onRecord?.(event);events.push(event)},close:()=>{closed=true}}),
  query:async sql=>{calls.push(sql);onQuery?.(sql,calls.length);return sql===buildProfileAvatarObservationSql()?[{observation:structuredClone(observations[reads++])}]:[]}})};
}
test('same policy+SQL transaction rolls back, is observed again, commits once, and separately verifies preserved buckets/catalog',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.status,'applied-and-postverified');assert.equal(f.calls.length,5);
 assert.equal(f.calls[1].replace(/ROLLBACK;$/,'COMMIT;'),f.calls[3]);
 assert.ok(f.calls[1].indexOf('CREATE POLICY profile_avatar_service_only')<f.calls[1].indexOf('CREATE TABLE public.profile_avatars'));
 assert.equal(/SET (?:LOCAL )?ROLE/.test(f.calls[1]),false);assert.equal(f.closed,true);
});
test('inspect, rollback-only and already-applied inspection never issue a committed mutation',async()=>{
 for(const options of [{mode:'inspect'},{mode:'rehearse'},{observations:[after()]}]){
  const f=fixture(options);assert.equal((await f.run()).remoteWritesPerformed,false);
  assert.equal(f.calls.filter(sql=>!sql.startsWith('BEGIN READ ONLY')&&sql.endsWith('COMMIT;')).length,0);
 }
});
test('mixed modes, unknown arguments, wrong destination and missing confirmation stop before credentials/network',()=>{
 for(const argv of [[],args().slice(0,-1),[...args(),'--profile-wedding-roles'],[...args(),'--apply'],[...args(),'--unknown'],
  args().map(v=>v.startsWith('--project-ref=')?'--project-ref=abcdefghijklmnopqrst':v)])assert.throws(()=>parseProfileAvatarReleaseArgs(argv));
});
test('wrong identity, nonexclusive authority, missing RLS, stale/predecessor/catalog conflicts cannot write',async()=>{
 const invalid=[{...before(),systemIdentifier:'1'},{...before(),predecessor:null},{...before(),serverVersion:'18.3'},
  {...before(),observedAt:'2026-09-13T08:57:59Z'}, {...before(),permission:{...before().permission,policyGrants:null}},
  {...before(),permission:{...before().permission,policyGrants:'{"other":["storage.objects"]}'}},
  {...before(),permission:{...before().permission,rls:false}}, {...before(),catalog:{...before().catalog,bucket:after().catalog.bucket}},
  {...after(),migration:{...after().migration,sqlMd5:'d'.repeat(32)}}];
 for(const observed of invalid){assert.throws(()=>validateProfileAvatarObservation(observed,{...context,now:instant}));const f=fixture({observations:[observed]});
  await assert.rejects(f.run());assert.equal(f.calls.length,1);assert.equal(f.events.at(-1).status,'blocked-before-mutation');}
});
test('existing exact policy is retained and does not require a second CREATE POLICY',async()=>{
 const b=before();b.catalog.policy=after().catalog.policy;
 const f=fixture({observations:[b,b,after()]});await f.run();assert.equal(f.calls[1].includes('CREATE POLICY profile_avatar_service_only'),false);
});
test('rollback drift or receipt fsync failure cannot advance to commit',async()=>{
 for(const options of [{observations:[before(),{...before(),preservedBucketsSha:'1'.repeat(32)}]},
  {onRecord:e=>{if(e.status==='apply-outcome-unverified')throw Error('synthetic disk full')}}]){
  const f=fixture(options);await assert.rejects(f.run(),{code:'PROFILE_AVATAR_OUTCOME_REQUIRES_INSPECTION'});assert.equal(f.calls.length,3);
 }
});
test('ambiguous commit and invalid postcheck keep an unknown outcome and never retry, undo or report success',async()=>{
 for(const options of [{onQuery:(_sql,n)=>{if(n===4)throw Error('synthetic lost response')}},
  {observations:[before(),before(),{...after(),preservedCatalogSha:'1'.repeat(32)}]}]){
  const f=fixture(options);await assert.rejects(f.run(),{code:'PROFILE_AVATAR_OUTCOME_REQUIRES_INSPECTION'});
  assert.ok(f.calls.length<=5);assert.equal(f.events.at(-1).retryProhibited,true);assert.equal(f.events.some(e=>e.status==='applied-and-postverified'),false);
 }
});
test('short receipt writes complete before fsync and zero progress refuses execution',()=>{
 const written=[];let flushed=0;appendProfileAvatarReceipt(1,{status:'unknown'},{write:(_fd,b,off)=>{const n=Math.min(3,b.length-off);written.push(b.subarray(off,off+n));return n},flush:()=>{flushed++}});
 assert.equal(Buffer.concat(written).toString(),'{"status":"unknown"}\n');assert.equal(flushed,1);
 assert.throws(()=>appendProfileAvatarReceipt(1,{}, {write:()=>0,flush:()=>{throw Error('unexpected flush')}}),{code:'PROFILE_AVATAR_RECEIPT_WRITE_INCOMPLETE'});
});
