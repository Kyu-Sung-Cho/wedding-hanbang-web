import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createCutoverDatabase, beginAs, nativeProfileRoleAvailable, BRIDE, GROOM, COUPLE, JOURNEY, TOKEN, legacy } from '../amora-action-writer-cutover-v1/cutover-fixture.mjs';
import { installTransportCompanion } from './transport-fixture.mjs';

const transportPath=new URL('./transport_conflict_response_v1.sql',import.meta.url);
const nativeOptions=Object.freeze({skip:process.platform!=='win32'&&!nativeProfileRoleAvailable,timeout:60_000});
const createNative=async()=>{const f=await createCutoverDatabase({native:true});try{await installTransportCompanion(f);return f;}catch(error){await f.close();throw error;}};
const createSql="SELECT public.mutate_own_amora_action($1,$2,'create',$3::jsonb) AS value";
const createValues=id=>[COUPLE,id,JSON.stringify({title:'SYNTHETIC-CONCURRENT-CREATE'})];
const outcome=promise=>promise.then(value=>({value}),error=>({error}));

async function waitForPidLock(f,pid,{advisory=false}={}) {
  for(let attempt=0;attempt<100;attempt++) {
    const row=(await f.db.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1`,[pid])).rows[0];
    if(row?.wait_event_type==='Lock') {
      if(!advisory) return;
      if((await f.db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting",[pid])).rows[0].waiting) return;
    }
    await delay(20);
  }
  assert.fail(`real ${advisory?'advisory':'row'} lock wait was not observed`);
}

test('native PG17 transport: legacy edit first makes concurrent INSERT return busy PT409 rather than waiting or shadowing',
  nativeOptions,async()=>{
    const f=await createNative(),sessions=[];
    try {
      await f.seedLegacy([legacy('cutover_legacy_first'),legacy('other_kept')]);
      const before=await f.journey();
      const editor=await f.newSession(),creator=await f.newSession(); sessions.push(editor,creator);
      await beginAs(editor,'authenticated',BRIDE);
      const saved=(await editor.query('SELECT public.patch_own_amora_action_view_v2($1,$2,$3,$4::jsonb) AS value',
        [COUPLE,'cutover_legacy_first',TOKEN,JSON.stringify({description:'SYNTHETIC-LEGACY-FIRST'})])).rows[0].value;
      await beginAs(creator,'authenticated',GROOM);
      await creator.query("SET LOCAL statement_timeout='1000ms'");
      const creating=await outcome(creator.query(createSql,createValues('cutover_legacy_first')));
      assert.equal(creating.error?.code,'PT409','must be immediate identity busy, not successful shadow or 57014 timeout');
      await creator.query('ROLLBACK');
      await beginAs(creator,'service_role',null);
      await creator.query("SET LOCAL statement_timeout='1000ms'");
      const serviceCreating=await outcome(creator.query("INSERT INTO public.amora_actions(id,couple_id,title) VALUES($1,$2,'SYNTHETIC-SERVICE-CREATE')",['cutover_legacy_first',COUPLE]));
      assert.equal(serviceCreating.error?.code,'PT409','service INSERT must obey the same immediate busy boundary');
      await creator.query('ROLLBACK');
      await editor.query('COMMIT');
      assert.equal(await f.read('cutover_legacy_first'),null);
      const after=await f.journey();
      assert.equal(after.progress.__amora_actions[0].updatedAt,saved.updated_at);
      assert.equal(Number(after.state_revision),Number(before.state_revision)+1);
      assert.deepEqual(after.progress.__amora_actions[1],before.progress.__amora_actions[1]);
      assert.deepEqual(after.progress.budget,before.progress.budget);
      assert.deepEqual(after.progress.schedule,before.progress.schedule);
    } finally {
      for(const client of sessions) await client.query('ROLLBACK').catch(()=>{});
      await Promise.all(sessions.map(client=>client.end()));
      await f.close();
    }
  });

test('native PG17 transport: a journey-first service INSERT does not wait backwards on a v2-held identity or deadlock',
  nativeOptions,async()=>{
    const f=await createNative(),sessions=[];
    let editing;
    try {
      await f.seedLegacy([legacy('cutover_journey_first'),legacy('other_kept')]);
      const before=await f.journey();
      const creator=await f.newSession(),editor=await f.newSession();sessions.push(creator,editor);
      const pid=Number((await editor.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await creator.query('BEGIN');
      await creator.query('SELECT id FROM public.wedding_journeys WHERE id=$1 FOR UPDATE',[JOURNEY]);
      // Existing privileged dispatch can already own the journey row; this tests only
      // the INSERT lock seam, not the real pending-approval source/audit contract.
      await creator.query('SET LOCAL ROLE service_role');
      await creator.query("SET LOCAL statement_timeout='1000ms'");
      editing=outcome(f.patch('cutover_journey_first',{description:'SYNTHETIC-V2-AFTER-BUSY-INSERT'},TOKEN,{actor:BRIDE,client:editor}));
      await waitForPidLock(f,pid);
      assert.equal((await f.db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted) AS held",[pid])).rows[0].held,true);
      const created=await outcome(creator.query("INSERT INTO public.amora_actions(id,couple_id,title) VALUES($1,$2,'SYNTHETIC-JOURNEY-FIRST')",['cutover_journey_first',COUPLE]));
      assert.equal(created.error?.code,'PT409','must fail immediately, not deadlock 40P01 or timeout 57014');
      await creator.query('ROLLBACK');
      const edited=await editing;
      assert.equal(edited.error,undefined);
      assert.equal(edited.value.description,'SYNTHETIC-V2-AFTER-BUSY-INSERT');
      assert.equal(await f.read('cutover_journey_first'),null);
      const after=await f.journey();
      assert.equal(Number(after.state_revision),Number(before.state_revision)+1);
      assert.deepEqual(after.progress.__amora_actions[1],before.progress.__amora_actions[1]);
      assert.deepEqual(after.progress.budget,before.progress.budget);
      assert.deepEqual(after.progress.schedule,before.progress.schedule);
    } finally {
      await sessions[0]?.query('ROLLBACK').catch(()=>{});
      if(editing) await editing;
      for(const client of sessions) await client.query('ROLLBACK').catch(()=>{});
      await Promise.all(sessions.map(client=>client.end()));
      await f.close();
    }
  });

test('native PG17 transport: INSERT identity first waits for current journey then rejects collision; waiting v2 edit proceeds',
  nativeOptions,async()=>{
    const f=await createNative(),sessions=[];
    let inserting,editing;
    try {
      await f.seedLegacy([legacy('cutover_insert_first'),legacy('other_kept')]);
      const before=await f.journey();
      const blocker=await f.newSession(),creator=await f.newSession(),editor=await f.newSession();sessions.push(blocker,creator,editor);
      const creatorPid=Number((await creator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const editorPid=Number((await editor.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM public.wedding_journeys WHERE id=$1 FOR UPDATE',[JOURNEY]);
      await beginAs(creator,'authenticated',GROOM);
      inserting=outcome(creator.query(createSql,createValues('cutover_insert_first')));
      await waitForPidLock(f,creatorPid);
      assert.equal((await f.db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted) AS held",[creatorPid])).rows[0].held,true);
      editing=outcome(f.patch('cutover_insert_first',{description:'SYNTHETIC-EDIT-AFTER-COLLISION'},TOKEN,{actor:BRIDE,client:editor}));
      await waitForPidLock(f,editorPid,{advisory:true});
      await blocker.query('COMMIT');
      const created=await inserting;
      assert.equal(created.error?.code,'PT409');
      await creator.query('ROLLBACK');
      const edited=await editing;
      assert.equal(edited.error,undefined);
      assert.equal(edited.value.description,'SYNTHETIC-EDIT-AFTER-COLLISION');
      assert.equal(await f.read('cutover_insert_first'),null);
      const after=await f.journey();
      assert.equal(Number(after.state_revision),Number(before.state_revision)+1);
      assert.deepEqual(after.progress.__amora_actions[1],before.progress.__amora_actions[1]);
      assert.deepEqual(after.progress.budget,before.progress.budget);
      assert.deepEqual(after.progress.schedule,before.progress.schedule);
    } finally {
      // Release actual blockers before awaiting pending queries or closing sessions.
      for(const client of sessions.slice(0,2)) await client.query('ROLLBACK').catch(()=>{});
      if(inserting) await inserting;
      if(editing) await editing;
      for(const client of sessions) await client.query('ROLLBACK').catch(()=>{});
      await Promise.all(sessions.map(client=>client.end()));
      await f.close();
    }
  });

test('native PG17 transport: successful new INSERT first is selected as canonical by waiting v2 and its different raw version conflicts',
  nativeOptions,async()=>{
    const f=await createNative(),sessions=[];
    let editing;
    try {
      const before=await f.journey();
      const creator=await f.newSession(),editor=await f.newSession();sessions.push(creator,editor);
      const pid=Number((await editor.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await beginAs(creator,'authenticated',GROOM);
      const created=(await creator.query(createSql,createValues('cutover_new_first'))).rows[0].value;
      assert.notEqual(created.updated_at,TOKEN);
      editing=outcome(f.patch('cutover_new_first',{description:'SYNTHETIC-NOT-AUTHORIZED-FOR-NEW-ROW'},TOKEN,{actor:BRIDE,client:editor}));
      await waitForPidLock(f,pid,{advisory:true});
      await creator.query('COMMIT');
      assert.equal((await editing).error?.code,'PT409');
      assert.deepEqual(await f.read('cutover_new_first'),created);
      assert.deepEqual(await f.journey(),before);
    } finally {
      await sessions[0]?.query('ROLLBACK').catch(()=>{});
      if(editing) await editing;
      for(const client of sessions) await client.query('ROLLBACK').catch(()=>{});
      await Promise.all(sessions.map(client=>client.end()));
      await f.close();
    }
  });


const identityCatalog=async f=>(await f.db.query(`SELECT to_jsonb(p)-'prosrc' AS attributes,p.prosrc,
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t
   WHERE t.tgfoid=p.oid) AS trigger_metadata FROM pg_proc p
  WHERE p.oid='public.guard_amora_action_insert_identity_cutover_v1()'::regprocedure`)).rows[0];

test('native PG17 transport: INSERT guard changes only its two logical SQLSTATEs and preserves every attribute, ACL and trigger OID',
  nativeOptions,async()=>{
    const f=await createCutoverDatabase({native:true});
    try {
      const before=await identityCatalog(f);
      await installTransportCompanion(f);
      const after=await identityCatalog(f);
      assert.equal((before.prosrc.match(/ERRCODE = '40001'/g)||[]).length,2);
      assert.equal(after.prosrc,before.prosrc.replaceAll("ERRCODE = '40001'","ERRCODE = 'PT409'"));
      assert.deepEqual({...after,prosrc:null},{...before,prosrc:null});
    } finally {await f.close();}
  });

test('native PG17 transport: create, no-journey create, duplicate requestId 23505, denied actor and genuine nested 40001 remain distinct',
  nativeOptions,async()=>{
    const f=await createNative();
    try {
      const created=await f.create('transport_identity_new');
      assert.equal(created.title,'SYNTHETIC-CANONICAL');
      const before=await f.read('transport_identity_new');
      await assert.rejects(f.create('transport_identity_new'),error=>error.code==='23505');
      assert.deepEqual(await f.read('transport_identity_new'),before);
      await assert.rejects(f.create('transport_identity_denied',{title:'SYNTHETIC-CANONICAL'},'00000000-0000-0000-0000-000000000099'),error=>error.code==='42501');
      await f.exec(`CREATE FUNCTION public.transport_identity_engine_failure() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN RAISE EXCEPTION 'SYNTHETIC-REAL-ENGINE-SERIALIZATION' USING ERRCODE='40001'; END $body$;
        CREATE TRIGGER zz_transport_identity_engine_failure BEFORE INSERT ON public.amora_actions
        FOR EACH ROW EXECUTE FUNCTION public.transport_identity_engine_failure();`);
      await assert.rejects(f.create('transport_identity_engine_failure'),error=>error.code==='40001'&&error.message==='SYNTHETIC-REAL-ENGINE-SERIALIZATION');
      assert.equal(await f.read('transport_identity_engine_failure'),null);
      await f.exec('DROP TRIGGER zz_transport_identity_engine_failure ON public.amora_actions; DELETE FROM public.wedding_journeys');
      assert.equal((await f.create('transport_identity_no_journey')).title,'SYNTHETIC-CANONICAL');
      assert.equal(await f.read('transport_identity_denied'),null);
    } finally {await f.close();}
  });
