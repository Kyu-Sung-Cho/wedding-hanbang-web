import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPrivilegeDatabase,nativeProfileRoleAvailable} from './privileges-fixture.mjs';
import {BRIDE,GROOM,COUPLE,legacy} from '../amora-action-view-v2/draft-fixture.mjs';

const options=Object.freeze({timeout:60_000,skip:process.platform!=='win32'&&!nativeProfileRoleAvailable});
const transport=()=>readFileSync(new URL('./transport_conflict_response_v1.sql',import.meta.url),'utf8');
const migration=name=>readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8');
const plan=migration('20260731123000_couple_plan_change_write_boundary.sql');
function original(source,name){
  const values=[...source.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$function\\$;`,'g'))];
  assert.equal(values.length,1,'One exact original function required: '+name);return values[0][0];
}
const catalog=async f=>(await f.db.query(`SELECT to_jsonb(p)-'prosrc' AS attributes,p.prosrc
 FROM pg_proc p WHERE p.oid='public.apply_couple_plan_change_locked(uuid,uuid)'::regprocedure`)).rows[0];

// Actual owned PG17/current journey triggers, but only manual plan surroundings are added.
// No production ID/time/data, fake approval callback or full Auth/Storage clone is used.
async function database(){
  const f=await createPrivilegeDatabase({phase:'after'});
  try{
    const acceptance=plan.match(/CREATE TABLE public\.couple_plan_change_acceptances\s*\([\s\S]*?\n\);/)?.[0];
    const shared=migration('20260730102000_amora_shared_action_approval_and_notifications.sql');
    const notification=shared.match(/CREATE TABLE IF NOT EXISTS public\.couple_change_notifications\s*\([\s\S]*?\n\);/)?.[0];
    assert.ok(acceptance&&notification,'Real plan table source is mandatory');
    await f.exec(acceptance);await f.exec(notification);
    await f.exec(plan.slice(plan.indexOf('ALTER TABLE public.couple_change_notifications'),plan.indexOf('CREATE OR REPLACE FUNCTION public.normalize_couple_plan_changes')));
    await f.exec(`CREATE SCHEMA extensions; CREATE FUNCTION extensions.digest(value bytea,algorithm text)
      RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN algorithm='sha256' THEN sha256(value) ELSE NULL END $$;`);
    for(const name of ['couple_plan_change_digest','couple_plan_change_is_high_impact','couple_plan_change_exact_high_summary',
      'couple_plan_change_result','finalize_couple_plan_change_notifications_locked'])await f.exec(original(plan,name));
    const fairness=migration('20260802140000_amora_manual_schedule_fairness.sql');
    await f.exec(original(fairness,'amora_manual_schedule_intent_digest'));
    await f.exec(original(migration('20260823120000_couple_approval_becomes_notification.sql'),'submit_couple_plan_change_before_manual_schedule_clock'));
    await f.exec(original(fairness,'submit_couple_plan_change'));
    await f.exec(`REVOKE ALL ON FUNCTION public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION public.submit_couple_plan_change(uuid,uuid,bigint,jsonb,text,text) TO service_role;`);
    await f.db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
    await f.exec(transport());return f;
  }catch(error){await f.db.query('ROLLBACK').catch(()=>{});await f.close();throw error;}
}
const snapshot=async f=>(await f.db.query(`SELECT jsonb_build_object(
 'journeys',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM public.wedding_journeys j),
 'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.couple_plan_change_requests r),
 'acceptances',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY request_id,user_id),'[]') FROM public.couple_plan_change_acceptances a),
 'notifications',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM public.couple_change_notifications n)) AS value`)).rows[0].value;
async function seedRequest(f,variation={}){
  const id=randomUUID(),revision=Number((await f.journey()).state_revision)+(variation.cas?1:0);
  const changes={progress_patch:{checklist:{synthetic:true}}};
  await f.db.query(`INSERT INTO public.couple_plan_change_requests(id,couple_id,actor_user_id,base_revision,
    changes,change_digest,roster_fingerprint,surface_href,summary,is_high_impact,required_count,status,
    created_at,expires_at,actor_accepted_at,applying_at)
    VALUES($1,$2,$3,$4,$5::jsonb,CASE WHEN $6 THEN repeat('0',64) ELSE public.couple_plan_change_digest($5::jsonb) END,
    CASE WHEN $7 THEN repeat('0',32) ELSE md5($3::uuid::text||':'||$8::uuid::text) END,'/dashboard','SYNTHETIC-MANUAL-PLAN',false,1,'applying',
    clock_timestamp()-interval '2 days',CASE WHEN $9 THEN clock_timestamp()-interval '1 day' ELSE clock_timestamp()+interval '1 day' END,
    clock_timestamp()-interval '1 day',clock_timestamp())`,[id,COUPLE,BRIDE,revision,JSON.stringify(changes),!!variation.digest,!!variation.roster,GROOM,!!variation.expired]);
  await f.db.query(`INSERT INTO public.couple_plan_change_acceptances(request_id,couple_id,user_id,change_digest,roster_fingerprint)
    SELECT id,couple_id,actor_user_id,change_digest,roster_fingerprint FROM public.couple_plan_change_requests WHERE id=$1`,[id]);
  return id;
}

test('native PG17 transport: private apply changes only four logical conflict codes and keeps every attribute and ACL',options,async()=>{
  const f=await createPrivilegeDatabase({phase:'after'});
  try{
    const before=await catalog(f);await f.exec(transport());const after=await catalog(f);
    assert.equal((before.prosrc.match(/ERRCODE = '40001'/g)||[]).length,4);
    assert.equal(after.prosrc,before.prosrc.replaceAll("ERRCODE = '40001'","ERRCODE = 'PT409'"));
    assert.deepEqual({...after,prosrc:null},{...before,prosrc:null});
  }finally{await f.close();}
});

test('native PG17 transport: actual private owner invocation with service claim rejects missing/state/roster/expiry/digest/CAS/final-status conflicts as PT409 and rolls back',options,async()=>{
  const f=await database();
  try{
    for(const variation of [null,{status:true},{roster:true},{expired:true},{digest:true},{cas:true},{final:true}]){
      const id=variation===null?randomUUID():await seedRequest(f,variation);
      if(variation?.status)await f.db.query("UPDATE public.couple_plan_change_requests SET status='pending',applying_at=NULL WHERE id=$1",[id]);
      if(variation?.final)await f.exec(`CREATE FUNCTION public.transport_plan_skip_final() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.status='applied' THEN RETURN NULL; END IF; RETURN NEW; END $$;
        CREATE TRIGGER zz_transport_plan_skip_final BEFORE UPDATE ON public.couple_plan_change_requests FOR EACH ROW EXECUTE FUNCTION public.transport_plan_skip_final();`);
      const before=await snapshot(f);
      await assert.rejects(f.db.query('SELECT public.apply_couple_plan_change_locked($1,$2)',[id,BRIDE]),
        error=>error.code==='PT409'&&error.message==='COUPLE_PLAN_CHANGE_CONFLICT');
      assert.deepEqual(await snapshot(f),before,'No partial journey/request/acceptance/notification write may survive');
      if(variation?.final)await f.exec('DROP TRIGGER zz_transport_plan_skip_final ON public.couple_plan_change_requests');
    }
  }finally{await f.close();}
});

test('native PG17 transport: current real service submit preserves routine budget/checklist/schedule metadata, replay and genuine nested serialization rollback',options,async()=>{
  const f=await database();
  try{
    await f.seedLegacy([legacy('transport_plan_legacy_kept')]);
    const raw=(await f.journey()).progress.__amora_actions;
    for(const changes of [{total_budget:20_000_000},{progress_patch:{checklist:{syntheticDone:true}}},{progress_patch:{schedule:{syntheticNote:'SYNTHETIC-ROUTINE-METADATA'}}}]){
      const revision=Number((await f.journey()).state_revision);
      const values=[COUPLE,BRIDE,revision,JSON.stringify(changes),'/dashboard','SYNTHETIC-APPROVED-ROUTINE'];
      const submit=()=>f.asRole('service_role',null,'SELECT public.submit_couple_plan_change($1,$2,$3,$4::jsonb,$5,$6) AS value',values);
      const first=(await submit()).rows[0].value;
      assert.equal(first.status,'applied');assert.equal(first.requiredCount,1);assert.equal(first.acceptedCount,1);
      assert.deepEqual((await submit()).rows[0].value,first,'Exact completed replay must not mutate or notify twice');
      assert.deepEqual((await f.journey()).progress.__amora_actions,raw);
    }
    assert.equal((await f.db.query('SELECT count(*)::int AS count FROM public.couple_change_notifications')).rows[0].count,3);
    await f.exec(`CREATE FUNCTION public.transport_plan_engine_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'SYNTHETIC-ENGINE-SERIALIZATION' USING ERRCODE='40001'; END $$;
      CREATE TRIGGER zz_transport_plan_engine_failure BEFORE UPDATE ON public.wedding_journeys FOR EACH ROW EXECUTE FUNCTION public.transport_plan_engine_failure();`);
    const before=await snapshot(f),revision=Number((await f.journey()).state_revision);
    await assert.rejects(f.asRole('service_role',null,'SELECT public.submit_couple_plan_change($1,$2,$3,$4::jsonb,$5,$6)',
      [COUPLE,BRIDE,revision,JSON.stringify({progress_patch:{checklist:{syntheticDone:false}}}),'/dashboard','SYNTHETIC-FAILURE']),
      error=>error.code==='40001'&&error.message==='SYNTHETIC-ENGINE-SERIALIZATION');
    assert.deepEqual(await snapshot(f),before);
    assert.equal(f.fullSchemaVerified,false);
  }finally{await f.close();}
});
