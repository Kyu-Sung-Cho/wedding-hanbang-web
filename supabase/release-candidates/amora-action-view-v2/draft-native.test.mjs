import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createDraftDatabase,nativeProfileRoleAvailable,BRIDE,GROOM,COUPLE,TOKEN,legacy } from './draft-fixture.mjs';

for (const storage of ['canonical','legacy']) {
  test(`native PG17: two real partner sessions race on the same ${storage} view; one wins and one conflicts`,
    {skip:!nativeProfileRoleAvailable,timeout:30_000},async () => {
      const f = await createDraftDatabase({native:true});
      const sessions=[];
      try {
        if (storage==='canonical') await f.seedCanonical('race_card');
        else await f.seedLegacy([legacy('race_card'),legacy('other_kept')]);
        const before=await f.journey();
        const a=await f.newSession(),b=await f.newSession();
        sessions.push(a,b);
        const outcomes=await Promise.allSettled([
          f.patch('race_card',{description:'SYNTHETIC-BRIDE-WINS'},TOKEN,{actor:BRIDE,client:a}),
          f.patch('race_card',{description:'SYNTHETIC-GROOM-WINS'},TOKEN,{actor:GROOM,client:b}),
        ]);
        const winners=outcomes.filter(result=>result.status==='fulfilled');
        const losers=outcomes.filter(result=>result.status==='rejected');
        assert.equal(winners.length,1);
        assert.equal(losers.length,1);
        assert.equal(losers[0].reason.code,'40001');
        const stored=storage==='canonical' ? await f.read('race_card') : (await f.journey()).progress.__amora_actions[0];
        assert.equal(stored.description,winners[0].value.description);
        assert.equal((await f.db.query('SELECT $1::timestamptz > $2::timestamptz AS advanced',
          [winners[0].value.updated_at,TOKEN])).rows[0].advanced,true);
        const after=await f.journey();
        assert.equal(Number(after.state_revision),Number(before.state_revision)+(storage==='legacy'?1:0));
        assert.deepEqual(after.progress.budget,before.progress.budget);
        assert.deepEqual(after.progress.schedule,before.progress.schedule);
        if(storage==='legacy') assert.deepEqual(after.progress.__amora_actions[1],before.progress.__amora_actions[1]);
      } finally {
        await Promise.all(sessions.map(client=>client.end()));
        await f.close();
      }
    });
}

test('native PG17: a removed partner waits for the member lock and is refused after unlink commits',
  {skip:!nativeProfileRoleAvailable,timeout:30_000},async () => {
    const f=await createDraftDatabase({native:true});
    const sessions=[];
    let editing;
    try {
      await f.seedCanonical();
      const remover=await f.newSession(),editor=await f.newSession();
      sessions.push(remover,editor);
      const pid=Number((await editor.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await remover.query('BEGIN');
      await remover.query('UPDATE public.profiles SET couple_id=null WHERE id=$1',[BRIDE]);
      // Catch immediately so a prompt DB rejection cannot become an unhandled rejection.
      editing=f.patch('draft_canonical',{description:'SYNTHETIC-UNLINKED'},TOKEN,{actor:BRIDE,client:editor})
        .then(value=>({value}),error=>({error}));
      let blocked=false;
      for(let attempt=0;attempt<100;attempt++){
        const row=(await f.db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
        if(row?.wait_event_type==='Lock'){blocked=true;break;}
        await delay(20);
      }
      assert.equal(blocked,true,'actual waiting member lock must be observed');
      await remover.query('COMMIT');
      const outcome=await editing;
      assert.equal(outcome.error?.code,'42501');
      assert.equal((await f.read('draft_canonical',GROOM)).description,'SYNTHETIC-ORIGINAL');
    } finally {
      for(const client of sessions) await client.query('ROLLBACK').catch(()=>{});
      if(editing) await editing;
      await Promise.all(sessions.map(client=>client.end()));
      await f.close();
    }
  });

test('native PG17: an existing old writer stays callable while the new viewer detects its intervening change',
  {skip:!nativeProfileRoleAvailable,timeout:30_000},async () => {
    const f=await createDraftDatabase({native:true});
    const sessions=[];
    try {
      await f.seedCanonical();
      const old=await f.newSession();
      sessions.push(old);
      const saved=await f.oldPatch('draft_canonical',{description:'SYNTHETIC-OLD-MOBILE'},{actor:GROOM,client:old});
      assert.equal(saved.description,'SYNTHETIC-OLD-MOBILE');
      await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-STALE-V2'},TOKEN),error=>error.code==='40001');
      assert.equal((await f.read('draft_canonical')).description,'SYNTHETIC-OLD-MOBILE');
      assert.equal((await f.patch('draft_canonical',{description:'SYNTHETIC-REVIEWED-V2'},saved.updated_at)).description,'SYNTHETIC-REVIEWED-V2');
    } finally {
      await Promise.all(sessions.map(client=>client.end()));
      await f.close();
    }
  });
