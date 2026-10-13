import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createCutoverDatabase, beginAs, nativeProfileRoleAvailable, BRIDE, GROOM, COUPLE, JOURNEY, TOKEN, legacy } from './cutover-fixture.mjs';

const createNative=()=>createCutoverDatabase({native:true,cutover:process.env.AMORA_CUTOVER_BASELINE!=='1'});
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

test('native PG17: legacy edit first makes concurrent INSERT return busy 40001 rather than waiting or shadowing',
  {skip:!nativeProfileRoleAvailable,timeout:30_000},async()=>{
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
      assert.equal(creating.error?.code,'40001','must be immediate identity busy, not successful shadow or 57014 timeout');
      await creator.query('ROLLBACK');
      await beginAs(creator,'service_role',null);
      await creator.query("SET LOCAL statement_timeout='1000ms'");
      const serviceCreating=await outcome(creator.query("INSERT INTO public.amora_actions(id,couple_id,title) VALUES($1,$2,'SYNTHETIC-SERVICE-CREATE')",['cutover_legacy_first',COUPLE]));
      assert.equal(serviceCreating.error?.code,'40001','service INSERT must obey the same immediate busy boundary');
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

test('native PG17: a journey-first service INSERT does not wait backwards on a v2-held identity or deadlock',
  {skip:!nativeProfileRoleAvailable,timeout:30_000},async()=>{
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
      assert.equal(created.error?.code,'40001','must fail immediately, not deadlock 40P01 or timeout 57014');
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

test('native PG17: INSERT identity first waits for current journey then rejects collision; waiting v2 edit proceeds',
  {skip:!nativeProfileRoleAvailable,timeout:30_000},async()=>{
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
      assert.equal(created.error?.code,'40001');
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

test('native PG17: successful new INSERT first is selected as canonical by waiting v2 and its different raw version conflicts',
  {skip:!nativeProfileRoleAvailable,timeout:30_000},async()=>{
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
      assert.equal((await editing).error?.code,'40001');
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
