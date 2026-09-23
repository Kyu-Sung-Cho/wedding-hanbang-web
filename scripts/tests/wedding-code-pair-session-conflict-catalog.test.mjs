import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { buildWeddingCodePairSessionConflictMutationSql, buildWeddingCodePairSessionConflictObservationSql,
  validateWeddingCodePairSessionConflictCatalog, validateWeddingCodePairSessionConflictObservation,
  weddingCodePairSessionConflictTargetCatalogSql, weddingCodePairSessionConflictPreservedCatalogSql,
  weddingCodePairSessionConflictLedgerDigestSql } from '../lib/wedding-code-pair-session-conflict-catalog.mjs';
import { createWeddingCodePairSessionNativeDatabase, nativeWeddingCodePairSessionAvailable,
  withSyntheticCron } from './fixtures/wedding-code-pair-session-native-database.mjs';

const root=resolve(import.meta.dirname,'../..'),read=file=>readFileSync(resolve(root,file),'utf8');
const sql=read('supabase/migrations/20260923132503_wedding_code_pair_session_conflict_response.sql');
const predecessorSql=read('supabase/migrations/20260923104336_wedding_code_pair_sessions.sql');
const fixture=JSON.parse(read('supabase/release-contracts/wedding-code-pair-session-conflict-pg17-catalog-v1.json'));
const predecessorFixture=JSON.parse(read('supabase/release-contracts/wedding-code-pair-session-pg17-catalog-v1.json'));
const context={sql,predecessorSql,fixture,predecessorFixture};
const {Client}=createRequire(import.meta.url)('pg');
const native={skip:nativeWeddingCodePairSessionAvailable?false:'native PG17 unavailable; rehearsal not verified',timeout:180_000};
const timestampRoomId=issued=>{const stamp=issued.toString(16).padStart(12,'0');return `${stamp.slice(0,8)}-${stamp.slice(8)}-${randomUUID().slice(14)}`};
const answerA='31_-4-4-44-4-4--444-44-444-4_u.u.u.u.u.u_p_-_p',answerB=answerA.replaceAll('4','5');
const owner='a'.repeat(64),invite='b'.repeat(64),participant='c'.repeat(64),outsider='d'.repeat(64);
const call=async(client,name,params=[]) => (await client.query(`SELECT public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,params)).rows[0].value;
async function setup(){
  const owned=await createWeddingCodePairSessionNativeDatabase(root);
  try{
    await owned.client.query(withSyntheticCron(predecessorSql));
    await owned.client.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260923104336','wedding_code_pair_sessions',ARRAY[$1]::text[])",[predecessorSql]);
    return owned;
  }catch(error){await owned.close();throw error;}
}

test('239 changes only three business-conflict SQLSTATEs and preserves the published 238 bytes',()=>{
  const original=predecessorSql.slice(predecessorSql.indexOf('CREATE FUNCTION public.create_wedding_code_pair_session('),
    predecessorSql.indexOf('CREATE FUNCTION public.revoke_wedding_code_pair_session(')).trimEnd();
  const actual=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'),sql.lastIndexOf('\n\nCOMMIT;'));
  assert.equal(actual,original.replaceAll('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replaceAll("ERRCODE='40001'","ERRCODE='PT409'"));
  assert.equal((sql.match(/ERRCODE='PT409'/g)??[]).length,3);
  assert.doesNotMatch(sql,/40001|DROP|GRANT|REVOKE|ALTER TABLE/);
  assert.equal(createHash('sha256').update(predecessorSql).digest('hex'),'48f49c545b984de2a838e6927ed0ef4cc5b44c5ee9d809b3191fed6b62824058');
});

test('native 239 rehearsal and apply preserve existing answers, tombstones, ACL, cron and the prior ledger',native,async()=>{
  const owned=await setup(),db=owned.client,one=async query=>(await db.query(`SELECT ${query} AS value`)).rows[0].value;
  const peer=new Client({...owned.connection,query_timeout:30_000});
  try{
    const issued=Date.now(),room=timestampRoomId(issued),closedRoom=timestampRoomId(issued);
    await call(db,'create_wedding_code_pair_session',[room,owner,invite,answerA,'2026-09-23',issued,true,true]);
    await call(db,'create_wedding_code_pair_session',[closedRoom,owner,invite,answerA,'2026-09-23',issued,true,true]);
    await call(db,'revoke_wedding_code_pair_session',[closedRoom,owner]);
    const rows=await one('(SELECT jsonb_agg(to_jsonb(r) ORDER BY room_id) FROM public.wedding_code_pair_sessions r)');
    const observations=await db.query(withSyntheticCron(buildWeddingCodePairSessionConflictObservationSql()));
    const before=observations.find(result=>result.rows?.[0]?.observation).rows[0].observation;
    validateWeddingCodePairSessionConflictObservation({...before,systemIdentifier:'7581440907192989109'},{...context,now:new Date()});
    const bundle=(rehearsal,overrideSql=sql)=>withSyntheticCron(buildWeddingCodePairSessionConflictMutationSql({...context,sql:overrideSql,before,rehearsal,
      deadline:new Date(Date.now()+120_000).toISOString()})).replace("<>'7581440907192989109'",`<>'${owned.system}'`);
    await db.query(bundle(true));
    assert.deepEqual(await one(weddingCodePairSessionConflictTargetCatalogSql()),before.catalog);
    assert.equal(await one(weddingCodePairSessionConflictLedgerDigestSql()),before.ledgerSha);
    assert.deepEqual(await one('(SELECT jsonb_agg(to_jsonb(r) ORDER BY room_id) FROM public.wedding_code_pair_sessions r)'),rows);
    // 답을 바꾸는 잘못된 릴리스 SQL은 실제 transaction의 행 보존 가드가 막는다.
    const corrupt=sql.replace('COMMIT;',"UPDATE public.wedding_code_pair_sessions SET owner_answer_code=replace(owner_answer_code,'4','5') WHERE closed_at IS NULL;\nCOMMIT;");
    await assert.rejects(db.query(bundle(false,corrupt)),error=>error.message==='WEDDING_CODE_PAIR_SESSION_CONFLICT_AFTER_DRIFT');
    await db.query('ROLLBACK');
    assert.deepEqual(await one('(SELECT jsonb_agg(to_jsonb(r) ORDER BY room_id) FROM public.wedding_code_pair_sessions r)'),rows);
    await peer.connect();await peer.query('BEGIN; LOCK TABLE public.wedding_code_pair_sessions IN ROW EXCLUSIVE MODE');
    await assert.rejects(db.query(bundle(false)),{code:'55P03'});await db.query('ROLLBACK');await peer.query('ROLLBACK');
    await db.query(bundle(false));
    validateWeddingCodePairSessionConflictCatalog(await one(weddingCodePairSessionConflictTargetCatalogSql()),fixture,true,predecessorFixture);
    assert.equal(await one(weddingCodePairSessionConflictPreservedCatalogSql()),before.preservedCatalogSha);
    assert.equal(await one(weddingCodePairSessionConflictLedgerDigestSql(true)),before.ledgerSha);
    assert.deepEqual(await one('(SELECT jsonb_agg(to_jsonb(r) ORDER BY room_id) FROM public.wedding_code_pair_sessions r)'),rows);
    assert.equal((await db.query("SELECT statements[1] AS sql FROM supabase_migrations.schema_migrations WHERE version='20260923132503'")).rows[0].sql,sql);
    for(const drift of ['GRANT SELECT ON public.wedding_code_pair_sessions TO authenticated',
      'ALTER TABLE public.wedding_code_pair_sessions NO FORCE ROW LEVEL SECURITY',
      'GRANT EXECUTE ON FUNCTION public.create_wedding_code_pair_session(uuid,text,text,text,text,bigint,boolean,boolean) TO anon',
      'GRANT EXECUTE ON FUNCTION public.purge_expired_wedding_code_pair_sessions() TO service_role',
      "UPDATE cron.job SET active=false WHERE jobname='wedding-code-pair-session-purge'"]){
      await db.query('BEGIN');await db.query(drift);
      const changed=await one(weddingCodePairSessionConflictTargetCatalogSql());
      assert.throws(()=>validateWeddingCodePairSessionConflictCatalog(changed,fixture,true,predecessorFixture),{code:'WEDDING_CODE_PAIR_SESSION_CONFLICT_TARGET_CATALOG_DRIFT'});
      await db.query('ROLLBACK');
    }
  }finally{await peer.end().catch(()=>{});await owned.close();}
});

test('native create and join business conflicts return PT409 while retries, consent and private capabilities remain unchanged',native,async()=>{
  const owned=await setup(),db=owned.client,peer=new Client({...owned.connection,query_timeout:30_000});
  try{
    await db.query(sql);await peer.connect();
    const issued=Date.now(),room=timestampRoomId(issued),args=[room,owner,invite,answerA,'2026-09-23',issued,true,true];
    for(const role of ['anon','authenticated']){
      await db.query(`SET ROLE ${role}`);await assert.rejects(call(db,'create_wedding_code_pair_session',args),{code:'42501'});await db.query('RESET ROLE');
    }
    await db.query('SET ROLE service_role');await peer.query('SET ROLE service_role');
    const first=await call(db,'create_wedding_code_pair_session',args);
    assert.deepEqual(await call(db,'create_wedding_code_pair_session',args),first);
    await assert.rejects(call(db,'create_wedding_code_pair_session',[room,outsider,invite,answerA,'2026-09-23',issued,true,true]),{code:'PT409'});
    await assert.rejects(call(db,'create_wedding_code_pair_session',[room,owner,invite,answerB,'2026-09-23',issued,true,true]),{code:'PT409'});
    for(const index of [6,7]){const invalid=[...args];invalid[index]=false;await assert.rejects(call(db,'create_wedding_code_pair_session',invalid),{code:'22023'});}
    const joinArgs=[room,invite,participant,answerB,'2026-09-23',true,true];
    const outcomes=await Promise.allSettled([call(db,'join_wedding_code_pair_session',joinArgs),call(peer,'join_wedding_code_pair_session',[room,invite,outsider,answerB,'2026-09-23',true,true])]);
    assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(outcomes.find(result=>result.status==='rejected').reason.code,'PT409');
    const winner=outcomes[0].status==='fulfilled'?participant:outsider;
    const ready=await call(db,'join_wedding_code_pair_session',[room,invite,winner,answerB,'2026-09-23',true,true]);
    assert.equal(ready.state,'ready');assert.equal(ready.partnerAnswerCode,answerA);
    await assert.rejects(call(db,'join_wedding_code_pair_session',[room,invite,winner,answerA,'2026-09-23',true,true]),{code:'PT409'});
    const peek=await call(db,'read_wedding_code_pair_session',[room,invite]);assert.equal(peek.ownAnswerCode,undefined);assert.equal(peek.partnerAnswerCode,undefined);
    assert.equal((await call(db,'read_wedding_code_pair_session',[room,owner])).partnerAnswerCode,answerB);
    await call(db,'revoke_wedding_code_pair_session',[room,winner]);
    for(const token of [owner,invite,winner]){const closed=await call(db,'read_wedding_code_pair_session',[room,token]);assert.equal(closed.state,'closed');assert.equal(closed.ownAnswerCode,undefined);assert.equal(closed.partnerAnswerCode,undefined);}
    await assert.rejects(call(db,'join_wedding_code_pair_session',joinArgs),{code:'55000'});
    await assert.rejects(db.query('SELECT * FROM public.wedding_code_pair_sessions'),{code:'42501'});
  }finally{await peer.end().catch(()=>{});await owned.close();}
});
