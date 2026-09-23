import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { buildWeddingCodePairSessionMutationSql, buildWeddingCodePairSessionObservationSql,
  validateWeddingCodePairSessionCatalog, validateWeddingCodePairSessionObservation,
  weddingCodePairSessionTargetCatalogSql, weddingCodePairSessionPreservedCatalogSql,
  weddingCodePairSessionLedgerDigestSql } from '../lib/wedding-code-pair-session-catalog.mjs';
import { createWeddingCodePairSessionNativeDatabase, nativeWeddingCodePairSessionAvailable,
  withSyntheticCron } from './fixtures/wedding-code-pair-session-native-database.mjs';

const root=resolve(import.meta.dirname,'../..');
const sql=readFileSync(resolve(root,'supabase/migrations/20260923104336_wedding_code_pair_sessions.sql'),'utf8');
const fixture=JSON.parse(readFileSync(resolve(root,'supabase/release-contracts/wedding-code-pair-session-pg17-catalog-v1.json')));
const {Client}=createRequire(import.meta.url)('pg');
const native={skip:nativeWeddingCodePairSessionAvailable?false:'native PG17 unavailable; native rehearsal not verified',timeout:180_000};
const timestampRoomId = issuedAt => {
  const stamp=issuedAt.toString(16).padStart(12,'0');
  return `${stamp.slice(0,8)}-${stamp.slice(8)}-${randomUUID().slice(14)}`;
};

test('native migration refuses missing pg_cron and an occupied job name without overwriting or leaving partial objects',native,async()=>{
  const owned=await createWeddingCodePairSessionNativeDatabase(root),db=owned.client;
  try {
    await assert.rejects(db.query(sql),error=>error.message==='PAIR_SESSION_CRON_REQUIRED');
    await db.query('ROLLBACK');
    assert.equal((await db.query("SELECT to_regclass('public.wedding_code_pair_sessions') AS object")).rows[0].object,null);
    await db.query("SELECT cron.schedule('wedding-code-pair-session-purge','2 2 * * *','SELECT 42;')");
    await assert.rejects(db.query(withSyntheticCron(sql)),error=>error.message==='PAIR_SESSION_CRON_ALREADY_EXISTS');
    await db.query('ROLLBACK');
    assert.deepEqual((await db.query("SELECT schedule,command FROM cron.job WHERE jobname='wedding-code-pair-session-purge'")).rows,
      [{schedule:'2 2 * * *',command:'SELECT 42;'}]);
    assert.equal((await db.query("SELECT to_regclass('public.wedding_code_pair_sessions') AS object")).rows[0].object,null);
  } finally {await owned.close();}
});

test('native PG17 rehearses and rolls back the exact pair-session DDL/ledger/cron, then commits with existing catalogs and jobs preserved',native,async()=>{
  const owned=await createWeddingCodePairSessionNativeDatabase(root),db=owned.client;
  const peer=new Client({...owned.connection,query_timeout:30_000});
  try {
    const one=async query=>(await db.query(`SELECT ${withSyntheticCron(query)} AS value`)).rows[0].value;
    const before={catalog:await one(weddingCodePairSessionTargetCatalogSql()),preservedCatalogSha:await one(weddingCodePairSessionPreservedCatalogSql()),
      ledgerSha:await one(weddingCodePairSessionLedgerDigestSql()),migration:null};
    validateWeddingCodePairSessionCatalog(before.catalog,fixture,false);
    const results=await db.query(withSyntheticCron(buildWeddingCodePairSessionObservationSql()));
    const observed=results.find(result=>result.rows?.[0]?.observation).rows[0].observation;
    assert.equal(observed.systemIdentifier,owned.system);assert.equal(observed.readOnly,true);assert.equal(observed.dependenciesReady,true);
    assert.equal(observed.predecessor.version,'20260920120000');assert.deepEqual(observed.catalog,before.catalog);
    assert.deepEqual(observed.dependencies,fixture.dependencies);
    validateWeddingCodePairSessionObservation({...observed,systemIdentifier:'7581440907192989109'},
      {sql,fixture,predecessorSql:owned.predecessorSql,now:new Date()});
    // 합성 확장 존재/시스템 식별값만 대체한다. 실제 scheduler 실행 여부의 운영 증거가 아니다.
    const bundle=rehearsal=>withSyntheticCron(buildWeddingCodePairSessionMutationSql({sql,fixture,before,rehearsal,
      deadline:new Date(Date.now()+120_000).toISOString()})).replace("<>'7581440907192989109'",`<>'${owned.system}'`);
    await db.query(bundle(true));
    assert.deepEqual(await one(weddingCodePairSessionTargetCatalogSql()),before.catalog);
    assert.equal(await one(weddingCodePairSessionPreservedCatalogSql()),before.preservedCatalogSha);
    assert.equal(await one(weddingCodePairSessionLedgerDigestSql()),before.ledgerSha);
    await peer.connect();await peer.query('BEGIN; LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(db.query(bundle(false)),error=>error.code==='55P03');await db.query('ROLLBACK');await peer.query('ROLLBACK');
    assert.deepEqual(await one(weddingCodePairSessionTargetCatalogSql()),before.catalog);
    for(const drift of ["UPDATE cron.job SET command='SELECT 2;' WHERE jobname='unrelated-job'", 'ALTER TABLE public.unrelated_rows ADD COLUMN extra text']) {
      await db.query('BEGIN');await db.query(drift);
      assert.notEqual(await one(weddingCodePairSessionPreservedCatalogSql()),before.preservedCatalogSha);await db.query('ROLLBACK');
    }
    await db.query(bundle(false));
    validateWeddingCodePairSessionCatalog(await one(weddingCodePairSessionTargetCatalogSql()),fixture,true);
    assert.equal(await one(weddingCodePairSessionPreservedCatalogSql()),before.preservedCatalogSha);
    assert.equal(await one(weddingCodePairSessionLedgerDigestSql(true)),before.ledgerSha);
    assert.deepEqual((await db.query('SELECT * FROM public.unrelated_rows')).rows,[{id:1,note:'synthetic preserved'}]);
    // 합성 확장 확인 치환이 ledger의 따옴표로 감싼 원문을 바꾸지 않는지도 확인한다.
    const stored=(await db.query("SELECT statements[1] AS sql FROM supabase_migrations.schema_migrations WHERE version='20260923104336'")).rows[0].sql;
    assert.equal(stored,sql);
    for(const drift of ['GRANT SELECT ON public.wedding_code_pair_sessions TO authenticated',
      'GRANT SELECT(owner_answer_code) ON public.wedding_code_pair_sessions TO service_role',
      'ALTER TABLE public.wedding_code_pair_sessions NO FORCE ROW LEVEL SECURITY',
      'GRANT EXECUTE ON FUNCTION public.purge_expired_wedding_code_pair_sessions() TO service_role',
      "UPDATE cron.job SET active=false WHERE jobname='wedding-code-pair-session-purge'",
      "UPDATE cron.job SET command='SELECT 1;' WHERE jobname='wedding-code-pair-session-purge'",
      "UPDATE cron.job SET schedule='* * * * *' WHERE jobname='wedding-code-pair-session-purge'",
      "UPDATE cron.job SET username='service_role' WHERE jobname='wedding-code-pair-session-purge'",
      "UPDATE cron.job SET nodename='other-host' WHERE jobname='wedding-code-pair-session-purge'",
    ]) {
      await db.query('BEGIN');await db.query(drift);
      const changed=await one(weddingCodePairSessionTargetCatalogSql());
      assert.throws(()=>validateWeddingCodePairSessionCatalog(changed,fixture,true),{code:'WEDDING_CODE_PAIR_SESSION_TARGET_CATALOG_DRIFT'});
      await db.query('ROLLBACK');
    }
  } finally {await peer.end().catch(()=>{});await owned.close();}
});

test('native pair-session RPCs require consent, isolate capabilities, serialize joins/revoke and reject expired replay after cleanup',native,async()=>{
  const owned=await createWeddingCodePairSessionNativeDatabase(root),db=owned.client;
  const peer=new Client({...owned.connection,query_timeout:30_000});
  try {
    await db.query(withSyntheticCron(sql));await peer.connect();
    const answerA='31_-4-4-44-4-4--444-44-444-4_u.u.u.u.u.u_p_-_p',answerB=answerA.replaceAll('4','5');
    const owner='a'.repeat(64),invite='b'.repeat(64),participant='c'.repeat(64),outsider='d'.repeat(64);
    const call=async(client,name,params=[]) => (await client.query(`SELECT public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,params)).rows[0].value;
    const issued=Date.now(),room=timestampRoomId(issued);
    const createArgs=[room,owner,invite,answerA,'2026-09-23',issued,true,true];
    for(const role of ['anon','authenticated']) {
      await db.query(`SET ROLE ${role}`);
      await assert.rejects(call(db,'create_wedding_code_pair_session',createArgs),{code:'42501'});
      await assert.rejects(db.query('SELECT owner_answer_code FROM public.wedding_code_pair_sessions'),{code:'42501'});
      await db.query('RESET ROLE');
    }
    await db.query('SET ROLE service_role');await peer.query('SET ROLE service_role');
    for(const field of [6,7])for(const value of [false,null]){
      const args=[...createArgs];args[field]=value;
      await assert.rejects(call(db,'create_wedding_code_pair_session',args),{code:'22023'});
    }
    const first=await call(db,'create_wedding_code_pair_session',createArgs);
    assert.equal(first.state,'waiting');assert.equal(first.ownAnswerCode,answerA);assert.equal(first.partnerAnswerCode,undefined);
    assert.deepEqual(await call(db,'create_wedding_code_pair_session',createArgs),first);
    assert.equal(Date.parse(first.expiresAt)>issued+6*86400000,true);
    const invitation=await call(db,'read_wedding_code_pair_session',[room,invite]);
    assert.equal(invitation.role,'invite');assert.equal(invitation.ownAnswerCode,undefined);assert.equal(invitation.partnerAnswerCode,undefined);
    await assert.rejects(call(db,'read_wedding_code_pair_session',[room,outsider]),{code:'28000'});
    await assert.rejects(call(db,'revoke_wedding_code_pair_session',[room,invite]),{code:'28000'});
    await assert.rejects(db.query('SELECT owner_answer_code FROM public.wedding_code_pair_sessions'),{code:'42501'});
    await assert.rejects(call(db,'purge_expired_wedding_code_pair_sessions'),{code:'42501'});
    const joinArgs=[room,invite,participant,answerB,'2026-09-23',true,true];
    for(const field of [5,6])for(const value of [false,null]){
      const args=[...joinArgs];args[field]=value;
      await assert.rejects(call(db,'join_wedding_code_pair_session',args),{code:'22023'});
    }
    // 두 초대 수신자가 동시에 참여해도 한 사람만 응답을 얻는다.
    const outcomes=await Promise.allSettled([call(db,'join_wedding_code_pair_session',joinArgs),
      call(peer,'join_wedding_code_pair_session',[room,invite,outsider,answerB,'2026-09-23',true,true])]);
    assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
    assert.equal(outcomes.find(o=>o.status==='rejected').reason.code,'40001');
    const winner=outcomes[0].status==='fulfilled'?participant:outsider;
    const paired=await call(db,'read_wedding_code_pair_session',[room,owner]);
    assert.equal(paired.partnerAnswerCode,answerB);assert.equal(paired.ownAnswerCode,answerA);
    const reply=await call(db,'read_wedding_code_pair_session',[room,winner]);
    assert.equal(reply.partnerAnswerCode,answerA);assert.equal(reply.ownAnswerCode,answerB);
    assert.equal((await call(db,'read_wedding_code_pair_session',[room,invite])).partnerAnswerCode,undefined);
    await call(db,'revoke_wedding_code_pair_session',[room,winner]);
    for(const capability of [owner,winner,invite]) {
      const result=await call(db,'read_wedding_code_pair_session',[room,capability]);
      assert.equal(result.state,'closed');assert.equal(result.ownAnswerCode,undefined);assert.equal(result.partnerAnswerCode,undefined);
    }
    await assert.rejects(call(db,'create_wedding_code_pair_session',createArgs),{code:'55000'});
    await assert.rejects(call(db,'join_wedding_code_pair_session',joinArgs),{code:'55000'});
    await db.query('RESET ROLE');
    const erased=(await db.query('SELECT owner_answer_code,participant_answer_code,owner_consent_version,participant_consent_version,owner_age_confirmed,participant_age_confirmed,joined_at FROM public.wedding_code_pair_sessions WHERE room_id=$1',[room])).rows[0];
    assert.equal(Object.values(erased).every(v=>v===null),true);
    // 철회가 잠금을 먼저 얻으면 기다리던 참여 요청은 커밋 후 닫힌 상태를 보며 응답을 받지 못한다.
    const raceIssued=Date.now(),raceRoom=timestampRoomId(raceIssued);await db.query('SET ROLE service_role');
    await call(db,'create_wedding_code_pair_session',[raceRoom,owner,invite,answerA,'2026-09-23',raceIssued,true,true]);
    await db.query('BEGIN');await call(db,'revoke_wedding_code_pair_session',[raceRoom,owner]);
    const peerPid=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pending=call(peer,'join_wedding_code_pair_session',[raceRoom,invite,participant,answerB,'2026-09-23',true,true]).then(value=>({value}),error=>({error}));
    await db.query('RESET ROLE');
    let blocked=false;
    for(let i=0;i<50;i++){
      blocked=(await db.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[peerPid])).rows[0]?.blocked===true;
      if(blocked)break;await delay(20);
    }
    assert.equal(blocked,true);await db.query('COMMIT');assert.equal((await pending).error?.code,'55000');
    // 만료 접근은 cleanup 실행 전부터 닫히며, 정리 뒤 과거 생성 요청을 재생해도 복구되지 않는다.
    const currentIssued=Date.now(),currentRoom=timestampRoomId(currentIssued),expiredIssued=currentIssued-8*86400000,expiredRoom=timestampRoomId(expiredIssued);
    await call(db,'create_wedding_code_pair_session',[currentRoom,owner,invite,answerA,'2026-09-23',currentIssued,true,true]);
    // 시간 경과를 합성할 때 불변 room 시각과 발급 시각도 함께 과거로 옮긴다.
    await db.query("UPDATE public.wedding_code_pair_sessions SET room_id=$3,created_at=created_at-interval '8 days',expires_at=expires_at-interval '8 days',issued_at=$2 WHERE room_id=$1",[currentRoom,expiredIssued,expiredRoom]);
    assert.equal((await call(db,'read_wedding_code_pair_session',[expiredRoom,owner])).state,'closed');
    assert.equal(await call(db,'purge_expired_wedding_code_pair_sessions'),'1');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.wedding_code_pair_sessions WHERE room_id=$1',[expiredRoom])).rows[0].count,0);
    await assert.rejects(call(db,'create_wedding_code_pair_session',[expiredRoom,owner,invite,answerA,'2026-09-23',expiredIssued,true,true]),{code:'22023'});
    // 새 요청 시각으로 바꿔도 오래된 room ID의 발급 시각을 위조할 수 없어 과거 링크가 되살아나지 않는다.
    await assert.rejects(call(db,'create_wedding_code_pair_session',[expiredRoom,owner,invite,answerA,'2026-09-23',Date.now(),true,true]),{code:'22023'});
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.wedding_code_pair_sessions WHERE room_id=$1',[room])).rows[0].count,1);
  } finally {await db.query('ROLLBACK; RESET ROLE').catch(()=>{});await peer.end().catch(()=>{});await owned.close();}
});
