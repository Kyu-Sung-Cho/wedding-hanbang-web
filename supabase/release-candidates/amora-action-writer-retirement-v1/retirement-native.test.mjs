import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createRetirementDatabase,beginAs,nativeProfileRoleAvailable,BRIDE,GROOM,COUPLE,TOKEN,legacy } from './retirement-fixture.mjs';

const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const createNative=()=>createRetirementDatabase({native:true,directGuard:process.env.AMORA_RETIREMENT_DIRECT_BASELINE!=='1'});
async function waitForRowLock(f,pid) {
  for(let attempt=0;attempt<100;attempt++) {
    if((await f.db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock') return;
    await delay(20);
  }
  assert.fail('actual row-lock wait was not observed');
}
async function directPrivileges(f) {
  await f.exec('ALTER ROLE service_role BYPASSRLS; GRANT SELECT,INSERT,UPDATE,DELETE ON public.wedding_journeys TO service_role;');
}

test('native PG17: v2 legacy edit first commits while the waiting stale direct service writer is rejected',
  {skip:!nativeProfileRoleAvailable,timeout:30_000},async()=>{
    const f=await createNative(),sessions=[];
    let writing;
    try {
      await directPrivileges(f);
      await f.seedLegacy([legacy('retirement_native_raw'),legacy('other_kept')]);
      const before=await f.journey();
      const editor=await f.newSession(),writer=await f.newSession();sessions.push(editor,writer);
      const pid=Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await beginAs(editor,'authenticated',BRIDE);
      const edited=(await editor.query('SELECT public.patch_own_amora_action_view_v2($1,$2,$3,$4::jsonb) AS value',
        [COUPLE,'retirement_native_raw',TOKEN,JSON.stringify({description:'SYNTHETIC-NATIVE-APPROVED'})])).rows[0].value;
      await beginAs(writer,'service_role',null);
      writing=outcome(writer.query('UPDATE public.wedding_journeys SET progress=$1::jsonb WHERE couple_id=$2',
        [JSON.stringify({...before.progress,__amora_actions:[legacy('retirement_native_raw',{description:'SYNTHETIC-NATIVE-STALE'})]}),COUPLE]));
      await waitForRowLock(f,pid);
      await editor.query('COMMIT');
      assert.equal((await writing).error?.code,'42501');
      await writer.query('ROLLBACK');
      const after=await f.journey();
      assert.equal(after.progress.__amora_actions[0].updatedAt,edited.updated_at);
      assert.equal(after.progress.__amora_actions[0].description,'SYNTHETIC-NATIVE-APPROVED');
      assert.deepEqual(after.progress.__amora_actions[1],before.progress.__amora_actions[1]);
      assert.deepEqual(after.progress.budget,before.progress.budget);
      assert.deepEqual(after.progress.schedule,before.progress.schedule);
      assert.equal(Number(after.state_revision),Number(before.state_revision)+1);
    } finally {
      await sessions[0]?.query('ROLLBACK').catch(()=>{});
      if(writing) await writing;
      for(const session of sessions) await session.query('ROLLBACK').catch(()=>{});
      await Promise.all(sessions.map(session=>session.end())); await f.close();
    }
  });

test('native PG17: normal schedule RPC first and waiting v2 legacy edit both succeed without inverse identity locks',
  {skip:!nativeProfileRoleAvailable,timeout:30_000},async()=>{
    const f=await createNative(),sessions=[];
    let editing;
    try {
      await directPrivileges(f);
      await f.seedLegacy([legacy('retirement_native_schedule'),legacy('other_kept')]);
      const before=await f.journey();
      const writer=await f.newSession(),editor=await f.newSession();sessions.push(writer,editor);
      const pid=Number((await editor.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await beginAs(writer,'service_role',null);
      const schedule=(await writer.query('SELECT public.apply_journey_progress_patch($1,$2::jsonb,$3::text[]) AS value',
        [COUPLE,JSON.stringify({schedule:['SYNTHETIC-NATIVE-NORMAL']}),[]])).rows[0].value;
      assert.deepEqual(schedule.__amora_actions,before.progress.__amora_actions);
      assert.equal((await f.db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory') AS extra",[Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid)])).rows[0].extra,false);
      editing=outcome(f.patch('retirement_native_schedule',{description:'SYNTHETIC-NATIVE-EDIT'},TOKEN,{actor:GROOM,client:editor}));
      await waitForRowLock(f,pid);
      await writer.query('COMMIT');
      const edited=await editing;
      assert.equal(edited.error,undefined);
      const after=await f.journey();
      assert.equal(after.progress.__amora_actions[0].updatedAt,edited.value.updated_at);
      assert.deepEqual(after.progress.__amora_actions[1],before.progress.__amora_actions[1]);
      assert.deepEqual(after.progress.budget,before.progress.budget);
      assert.deepEqual(after.progress.schedule,['SYNTHETIC-NATIVE-NORMAL']);
      assert.equal(Number(after.state_revision),Number(before.state_revision)+2);
    } finally {
      await sessions[0]?.query('ROLLBACK').catch(()=>{});
      if(editing) await editing;
      for(const session of sessions) await session.query('ROLLBACK').catch(()=>{});
      await Promise.all(sessions.map(session=>session.end())); await f.close();
    }
  });
