import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRetirementDatabase,retirementPath,BRIDE,GROOM,COUPLE,OTHER_COUPLE,TOKEN,legacy } from './retirement-fixture.mjs';

test('direct service canonical UPDATE is denied without changing the original row',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.seedCanonical('retirement_canonical');
    const before=await f.read('retirement_canonical');
    await assert.rejects(f.asRole('service_role',null,
      "UPDATE public.amora_actions SET description='SYNTHETIC-UNVERSIONED' WHERE id=$1",['retirement_canonical']),error=>error.code==='42501');
    assert.deepEqual(await f.read('retirement_canonical'),before);
  } finally { await f.close(); }
});

test('isolated direct-DML guard refuses future reserved action INSERT independent of the existing plan INSERT fence',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.exec('ALTER ROLE service_role BYPASSRLS; GRANT SELECT,INSERT,UPDATE,DELETE ON public.wedding_journeys TO service_role;');
    await assert.rejects(f.asRole('service_role',null,'INSERT INTO public.wedding_journeys(id,couple_id,progress) VALUES($1,$2,$3::jsonb)',
      ['30000000-0000-4000-8000-000000000009',OTHER_COUPLE,JSON.stringify({__amora_actions:[legacy('retirement_future')]})]),error=>error.code==='42501');
    assert.equal((await f.db.query('SELECT id FROM public.wedding_journeys WHERE couple_id=$1',[OTHER_COUPLE])).rows.length,0);
  } finally { await f.close(); }
});

test('isolated direct-DML guard permits no-action inserts and unrelated writes only when reserved raw value and presence stay identical',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.exec('ALTER ROLE service_role BYPASSRLS; GRANT SELECT,INSERT,UPDATE,DELETE ON public.wedding_journeys TO service_role;');
    await f.seedLegacy([legacy('retirement_raw_kept')]);
    const before=await f.journey();
    await f.asRole('service_role',null,"UPDATE public.wedding_journeys SET progress=jsonb_set(progress,'{schedule}','[\"SYNTHETIC-ORDINARY\"]') WHERE couple_id=$1",[COUPLE]);
    const after=await f.journey();
    assert.deepEqual(after.progress.__amora_actions,before.progress.__amora_actions);
    assert.deepEqual(after.progress.budget,before.progress.budget);
    assert.deepEqual(after.progress.schedule,['SYNTHETIC-ORDINARY']);
    const preserving={...after.progress,budget:{keep:17,spent:23},metadata:{synthetic:true}};
    await f.asRole('service_role',null,'UPDATE public.wedding_journeys SET progress=$1::jsonb WHERE couple_id=$2',[JSON.stringify(preserving),COUPLE]);
    const preserved=await f.journey();
    assert.deepEqual(preserved.progress.__amora_actions,before.progress.__amora_actions);
    assert.deepEqual(preserved.progress.budget,{keep:17,spent:23});
    assert.deepEqual(preserved.progress.metadata,{synthetic:true});
    for(const progress of [{},{__amora_actions:[]}]) {
      await f.asRole('service_role',null,'INSERT INTO public.wedding_journeys(id,couple_id,progress) VALUES($1,$2,$3::jsonb)',
        ['30000000-0000-4000-8000-000000000009',OTHER_COUPLE,JSON.stringify(progress)]);
      assert.deepEqual((await f.db.query('SELECT progress FROM public.wedding_journeys WHERE couple_id=$1',[OTHER_COUPLE])).rows[0].progress,progress);
      await f.asRole('service_role',null,'DELETE FROM public.wedding_journeys WHERE couple_id=$1',[OTHER_COUPLE]);
    }
  } finally { await f.close(); }
});

test('direct-DML guard distinguishes missing JSON null and raw action changes without authorizing other client roles',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.exec('ALTER ROLE service_role BYPASSRLS; GRANT SELECT,INSERT,UPDATE,DELETE ON public.wedding_journeys TO service_role;');
    for(const [oldValue,newValue] of [
      [{},{__amora_actions:null}],
      [{__amora_actions:null},{}],
      [{__amora_actions:[]},{}],
      [{__amora_actions:[legacy('retirement_raw')]},{__amora_actions:[legacy('retirement_raw',{updatedAt:'2020-01-01T00:00:00.123456Z'})]}],
    ]) {
      await f.db.query('UPDATE public.wedding_journeys SET progress=$1::jsonb WHERE couple_id=$2',[JSON.stringify(oldValue),COUPLE]);
      const before=await f.journey();
      await assert.rejects(f.asRole('service_role',null,'UPDATE public.wedding_journeys SET progress=$1::jsonb WHERE couple_id=$2',[JSON.stringify(newValue),COUPLE]),error=>error.code==='42501');
      assert.deepEqual(await f.journey(),before);
    }
    for(const role of ['anon','authenticated']) {
      await assert.rejects(f.asRole(role,BRIDE,"UPDATE public.wedding_journeys SET progress='{}' WHERE couple_id=$1",[COUPLE]),error=>error.code==='42501');
      await assert.rejects(f.asRole(role,BRIDE,"INSERT INTO public.wedding_journeys(id,couple_id,progress) VALUES($1,$2,'{}')",['30000000-0000-4000-8000-000000000009',OTHER_COUPLE]),error=>error.code==='42501');
    }
    assert.equal((await f.db.query("SELECT prosecdef FROM pg_proc WHERE oid='public.guard_amora_reserved_journey_direct_dml_retirement_v1()'::regprocedure")).rows[0].prosecdef,false);
  } finally { await f.close(); }
});

test('generic ordinary patch remove and item merges keep legacy raw cards intact and RPC ACL unchanged',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.seedLegacy([legacy('retirement_kept')]);
    const before=await f.journey();
    await f.asRole('service_role',null,'SELECT public.apply_journey_progress_patch($1,$2::jsonb,$3::text[])',
      [COUPLE,JSON.stringify({schedule:['SYNTHETIC-NORMAL-SCHEDULE']}),['budget']]);
    await f.asRole('service_role',null,'SELECT public.apply_journey_progress_item_patch($1,$2,$3::jsonb)',
      [COUPLE,'budget',JSON.stringify({keep:17,spent:23})]);
    const after=await f.journey();
    assert.deepEqual(after.progress.__amora_actions,before.progress.__amora_actions);
    assert.deepEqual(after.progress.schedule,['SYNTHETIC-NORMAL-SCHEDULE']);
    assert.deepEqual(after.progress.budget,{keep:17,spent:23});
    for(const role of ['anon','authenticated']) {
      await assert.rejects(f.asRole(role,BRIDE,'SELECT public.apply_journey_progress_patch($1,$2::jsonb,$3::text[])',[COUPLE,'{}',[]]),error=>error.code==='42501');
    }
  } finally { await f.close(); }
});

test('owner actor-checked v2 keeps canonical and legacy editing plus exact request-id creation despite service UPDATE revoke',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.seedCanonical('retirement_v2');
    await f.seedLegacy([legacy('retirement_legacy_v2'),legacy('other_kept')]);
    const before=await f.journey();
    assert.equal((await f.patch('retirement_v2',{status:'done'},TOKEN)).status,'done');
    const legacySaved=await f.patch('retirement_legacy_v2',{description:'SYNTHETIC-REVIEWED'},TOKEN,{actor:GROOM});
    const after=await f.journey();
    assert.equal(after.progress.__amora_actions[0].updatedAt,legacySaved.updated_at);
    assert.deepEqual(after.progress.__amora_actions[1],before.progress.__amora_actions[1]);
    assert.deepEqual(after.progress.budget,before.progress.budget);
    assert.deepEqual(after.progress.schedule,before.progress.schedule);
    assert.equal(Number(after.state_revision),Number(before.state_revision)+1);
    const created=await f.create('retirement_new',{title:'SYNTHETIC-MANUAL-CREATE'});
    assert.equal(created.created_by,BRIDE);
    await assert.rejects(f.create('retirement_new'),error=>error.code==='23505');
    assert.deepEqual(await f.read('retirement_new'),created);
  } finally { await f.close(); }
});

test('service UPDATE privilege is absent including upsert statement authorization while ordinary INSERT stays permitted',async()=>{
  const f=await createRetirementDatabase();
  try {
    assert.equal((await f.db.query("SELECT has_table_privilege('service_role','public.amora_actions','UPDATE') AS allowed")).rows[0].allowed,false);
    const columnGrants=(await f.db.query("SELECT attname FROM pg_attribute WHERE attrelid='public.amora_actions'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('service_role','public.amora_actions',attname,'UPDATE')")).rows;
    assert.deepEqual(columnGrants,[]);
    await assert.rejects(f.asRole('service_role',null,"INSERT INTO public.amora_actions(id,couple_id,title) VALUES($1,$2,'SYNTHETIC-UPSERT') ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title",['retirement_upsert',COUPLE]),error=>error.code==='42501');
    assert.equal(await f.read('retirement_upsert'),null);
    await f.asRole('service_role',null,"INSERT INTO public.amora_actions(id,couple_id,title,source,created_by) VALUES($1,$2,'SYNTHETIC-INSERT','chat',$3)",['retirement_insert',COUPLE,BRIDE]);
    assert.equal((await f.read('retirement_insert')).source,'chat');
  } finally { await f.close(); }
});

test('generic RPC signature owner ACL config and all actor/raw-v2 helpers remain unchanged',async()=>{
  const f=await createRetirementDatabase({retirement:false});
  try {
    const query=`SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.proacl::text AS acl,
      p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN('apply_journey_progress_patch','apply_journey_progress_item_patch',
      'lock_own_amora_action_couple','validate_manual_amora_action_values','patch_own_amora_action_view_v2',
      'mutate_own_amora_action','update_own_legacy_amora_action') ORDER BY signature`;
    const before=(await f.db.query(query)).rows;
    await f.exec(readFileSync(retirementPath,'utf8'));
    const after=(await f.db.query(query)).rows;
    for(let index=0;index<before.length;index++) {
      const {definition:oldDefinition,...oldContract}=before[index];
      const {definition:newDefinition,...newContract}=after[index];
      assert.deepEqual(newContract,oldContract);
      if(!oldContract.signature.startsWith('apply_journey_progress')) assert.equal(newDefinition,oldDefinition);
    }
  } finally { await f.close(); }
});

test('generic item patch cannot reinterpret the reserved action array as a normal category object',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.seedLegacy([legacy('retirement_item')]);
    const before=await f.journey();
    await assert.rejects(f.asRole('service_role',null,'SELECT public.apply_journey_progress_item_patch($1,$2,$3::jsonb)',
      [COUPLE,'__amora_actions',JSON.stringify({synthetic:'WRONG-CONTAINER'})]),error=>error.code==='55000');
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('generic progress remove cannot erase reserved actions while applying ordinary schedule changes',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.seedLegacy([legacy('retirement_remove')]);
    const before=await f.journey();
    await assert.rejects(f.asRole('service_role',null,'SELECT public.apply_journey_progress_patch($1,$2::jsonb,$3::text[])',
      [COUPLE,JSON.stringify({schedule:['SYNTHETIC-PARTIAL-REMOVE']}),['__amora_actions']]),error=>error.code==='55000');
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('generic progress patch cannot replace reserved legacy actions or partially save its ordinary sibling',async()=>{
  const f=await createRetirementDatabase();
  try {
    await f.seedLegacy([legacy('retirement_legacy')]);
    const before=await f.journey();
    await assert.rejects(f.asRole('service_role',null,'SELECT public.apply_journey_progress_patch($1,$2::jsonb,$3::text[])',
      [COUPLE,JSON.stringify({__amora_actions:[],schedule:['SYNTHETIC-PARTIAL-WRITE']}),[]]),error=>error.code==='55000');
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});
