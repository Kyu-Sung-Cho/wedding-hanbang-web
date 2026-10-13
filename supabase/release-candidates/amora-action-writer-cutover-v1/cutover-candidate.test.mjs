import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCutoverDatabase, cutoverPath, BRIDE, GROOM, OUTSIDER, COUPLE, OTHER_COUPLE, JOURNEY, TOKEN, legacy } from './cutover-fixture.mjs';

test('old public canonical update refuses versionless edits without changing the stored row',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.seedCanonical();
    const before=await f.read('draft_canonical');
    await assert.rejects(f.oldPatch('draft_canonical',{description:'SYNTHETIC-UNVERSIONED'}),error=>error.code==='55000');
    assert.deepEqual(await f.read('draft_canonical'),before);
  } finally { await f.close(); }
});

test('v2 still edits canonical and legacy views using their raw versions and preserves unrelated journey state',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.seedCanonical('cutover_v2_canonical');
    await f.seedLegacy([legacy('cutover_v2_legacy'),legacy('other_kept')]);
    const before=await f.journey();
    const canonical=await f.patch('cutover_v2_canonical',{description:'SYNTHETIC-REVIEWED-CANONICAL'},TOKEN);
    const saved=await f.patch('cutover_v2_legacy',{description:'SYNTHETIC-REVIEWED-LEGACY'},TOKEN,{actor:GROOM});
    assert.equal(canonical.source,'chat');
    assert.equal(saved.source,'manual');
    assert.equal(saved.description,'SYNTHETIC-REVIEWED-LEGACY');
    const after=await f.journey();
    assert.equal(Number(after.state_revision),Number(before.state_revision)+1);
    assert.deepEqual(after.progress.budget,before.progress.budget);
    assert.deepEqual(after.progress.schedule,before.progress.schedule);
    assert.deepEqual(after.progress.__amora_actions[1],before.progress.__amora_actions[1]);
    assert.match(saved.updated_at,/(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/);
    assert.equal(saved.updated_at,after.progress.__amora_actions[0].updatedAt);
    await assert.rejects(f.patch('cutover_v2_legacy',{status:'done'},TOKEN),error=>error.code==='40001');
    assert.deepEqual(await f.journey(),after);
  } finally { await f.close(); }
});

test('service INSERT obeys the same legacy identity fence but new identities keep original provenance',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.seedLegacy([legacy('cutover_service_collision')]);
    const before=await f.journey();
    const insert=`INSERT INTO public.amora_actions(id,couple_id,title,source,created_by,metadata)
      VALUES($1,$2,'SYNTHETIC-SERVICE','chat',$3,'{"synthetic":true}') RETURNING to_jsonb(amora_actions) AS value`;
    await assert.rejects(f.asRole('service_role',null,insert,['cutover_service_collision',COUPLE,BRIDE]),error=>error.code==='40001');
    const result=(await f.asRole('service_role',null,insert,['cutover_service_new',COUPLE,BRIDE])).rows[0].value;
    assert.equal(result.created_by,BRIDE);
    assert.equal(result.source,'chat');
    assert.deepEqual(result.metadata,{synthetic:true});
    assert.deepEqual(await f.read('cutover_service_new'),result);
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('canonical duplicate is 23505 even with a later legacy mirror and ON CONFLICT DO NOTHING cannot mask it',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.seedCanonical('cutover_duplicate');
    await f.seedLegacy([legacy('cutover_duplicate')]);
    const action=await f.read('cutover_duplicate'),journey=await f.journey();
    for(const suffix of ['', ' ON CONFLICT(id) DO NOTHING']) {
      await assert.rejects(f.asRole('service_role',null,
        `INSERT INTO public.amora_actions(id,couple_id,title) VALUES($1,$2,'SYNTHETIC-RETRY')${suffix}`,
        ['cutover_duplicate',COUPLE]),error=>error.code==='23505');
    }
    assert.deepEqual(await f.read('cutover_duplicate'),action);
    assert.deepEqual(await f.journey(),journey);
  } finally { await f.close(); }
});

test('malformed legacy container fails before INSERT while absent arrays and unknown entries are preserved',async()=>{
  const f=await createCutoverDatabase();
  try {
    for(const progress of [[],null,{__amora_actions:null},{__amora_actions:{bad:true}}]) {
      await f.db.query('UPDATE public.wedding_journeys SET progress=$1::jsonb WHERE id=$2',[JSON.stringify(progress),JOURNEY]);
      const before=await f.journey();
      await assert.rejects(f.create('cutover_bad_container'),error=>error.code==='55000');
      assert.equal(await f.read('cutover_bad_container'),null);
      assert.deepEqual(await f.journey(),before);
    }
    for(const progress of [{budget:{keep:17}}, {__amora_actions:[null,7,'unknown',{unknown:{preserved:true}}],budget:{keep:17}}]) {
      await f.db.query('UPDATE public.wedding_journeys SET progress=$1::jsonb WHERE id=$2',[JSON.stringify(progress),JOURNEY]);
      const before=await f.journey();
      const id=progress.__amora_actions?'cutover_unknown_entries':'cutover_missing_array';
      await f.create(id);
      assert.deepEqual(await f.journey(),before);
    }
  } finally { await f.close(); }
});

test('duplicate or ill-typed matching legacy records are identity conflicts without automatic promotion',async()=>{
  const f=await createCutoverDatabase();
  try {
    for(const actions of [[legacy('cutover_bad_identity'),legacy('cutover_bad_identity')], [{id:'cutover_bad_identity',title:4,updatedAt:null}]]) {
      await f.seedLegacy(actions);
      const before=await f.journey();
      await assert.rejects(f.create('cutover_bad_identity'),error=>error.code==='40001');
      assert.deepEqual(await f.journey(),before);
      assert.equal(await f.read('cutover_bad_identity'),null);
    }
  } finally { await f.close(); }
});

test('actor scope and existing RPC ACL remain enforced before retired or create paths',async()=>{
  const f=await createCutoverDatabase();
  try {
    for(const operation of ['create','update']) {
      for(const [role,actor,couple] of [['anon',null,COUPLE],['service_role',BRIDE,COUPLE],['authenticated',OUTSIDER,COUPLE],['authenticated',BRIDE,OTHER_COUPLE]]) {
        await assert.rejects(f.asRole(role,actor,'SELECT public.mutate_own_amora_action($1,$2,$3,$4::jsonb)',
          [couple,'cutover_scope',operation,JSON.stringify({title:'SYNTHETIC-SCOPE'})]),error=>error.code==='42501');
      }
    }
    await f.db.query('UPDATE public.profiles SET couple_id=null WHERE id=$1',[BRIDE]);
    await assert.rejects(f.create('cutover_unlinked'),error=>error.code==='42501');
    assert.equal(await f.read('cutover_scope',GROOM),null);
    assert.equal(await f.read('cutover_unlinked',GROOM),null);
  } finally { await f.close(); }
});

test('function owner ACL and actor/raw-v2 helper definitions are unchanged, while insert guard has no public execution',async()=>{
  const f=await createCutoverDatabase({cutover:false});
  try {
    const catalog=`SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,
      p.proacl::text AS acl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN('mutate_own_amora_action','update_own_legacy_amora_action','lock_own_amora_action_couple',
      'validate_manual_amora_action_values','patch_own_amora_action_view_v2') ORDER BY signature`;
    const before=(await f.db.query(catalog)).rows;
    await f.exec(readFileSync(cutoverPath,'utf8'));
    const after=(await f.db.query(catalog)).rows;
    assert.equal(after.length,before.length);
    for(let index=0;index<before.length;index++) {
      const {definition:oldDefinition,...oldContract}=before[index];
      const {definition:newDefinition,...newContract}=after[index];
      assert.deepEqual(newContract,oldContract);
      if(!oldContract.signature.startsWith('mutate_')&&!oldContract.signature.startsWith('update_own_legacy')) assert.equal(newDefinition,oldDefinition);
    }
    for(const role of ['anon','authenticated','service_role']) {
      assert.equal((await f.db.query("SELECT has_function_privilege($1,'public.guard_amora_action_insert_identity_cutover_v1()','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
    }
  } finally { await f.close(); }
});

test('no-journey create compatibility is retained but does not prove future legacy INSERT phantoms are closed',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.db.query('DELETE FROM public.wedding_journeys WHERE id=$1',[JOURNEY]);
    const action=await f.create('cutover_no_journey');
    assert.equal(action.id,'cutover_no_journey');
    assert.equal(await f.journey(),null);
  } finally { await f.close(); }
});

test('remaining direct service UPDATE is explicitly not claimed as closed by this minimum candidate',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.seedCanonical('cutover_unclosed_service_update');
    await f.asRole('service_role',null,"UPDATE public.amora_actions SET description='SYNTHETIC-REMAINING-WRITER' WHERE id=$1",['cutover_unclosed_service_update']);
    assert.equal((await f.read('cutover_unclosed_service_update')).description,'SYNTHETIC-REMAINING-WRITER');
  } finally { await f.close(); }
});

test('actual service progress RPCs still preserve ordinary schedule/budget patching but reserved legacy array remains an open writer',async()=>{
  const f=await createCutoverDatabase();
  try {
    for(const name of ['20260611160000_journey_progress_atomic_merge.sql','20260716100000_journey_progress_atomic_item_patch.sql']) {
      await f.exec(readFileSync(new URL(`../../migrations/${name}`,import.meta.url),'utf8'));
    }
    await f.seedLegacy([legacy('cutover_rpc_remaining')]);
    await f.asRole('service_role',null,'SELECT public.apply_journey_progress_patch($1,$2::jsonb,$3::text[])',
      [COUPLE,JSON.stringify({schedule:['SYNTHETIC-NEW-SCHEDULE']}),[]]);
    assert.equal((await f.journey()).progress.__amora_actions[0].updatedAt,TOKEN);
    await f.asRole('service_role',null,'SELECT public.apply_journey_progress_item_patch($1,$2,$3::jsonb)',
      [COUPLE,'budget',JSON.stringify({spent:23})]);
    assert.deepEqual((await f.journey()).progress.budget,{keep:17,spent:23});
    const stale=legacy('cutover_rpc_remaining',{description:'SYNTHETIC-STALE-SERVICE-WRITER',updatedAt:'2025-01-01T00:00:00.123456Z'});
    await f.asRole('service_role',null,'SELECT public.apply_journey_progress_patch($1,$2::jsonb,$3::text[])',
      [COUPLE,JSON.stringify({__amora_actions:[stale]}),[]]);
    assert.deepEqual((await f.journey()).progress.__amora_actions,[stale]);
    await f.asRole('service_role',null,'SELECT public.apply_journey_progress_item_patch($1,$2,$3::jsonb)',
      [COUPLE,'__amora_actions',JSON.stringify({synthetic:'WRONG-CONTAINER'})]);
    assert.deepEqual((await f.journey()).progress.__amora_actions,{synthetic:'WRONG-CONTAINER'});
  } finally { await f.close(); }
});

test('create refuses an existing legacy identity rather than shadowing its raw six-digit view',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.seedLegacy([legacy('cutover_collision'),legacy('other_kept')]);
    const before=await f.journey();
    await assert.rejects(f.create('cutover_collision'),error=>error.code==='40001');
    assert.equal(await f.read('cutover_collision'),null);
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('service upsert cannot turn an INSERT into an unversioned UPDATE of an existing canonical action',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.seedCanonical('cutover_upsert');
    const before=await f.read('cutover_upsert');
    await assert.rejects(f.asRole('service_role',null,`INSERT INTO public.amora_actions(id,couple_id,title,created_by)
      VALUES($1,$2,'SYNTHETIC-UPSERT',$3) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title`,
      ['cutover_upsert',COUPLE,BRIDE]),error=>error.code==='23505');
    assert.deepEqual(await f.read('cutover_upsert'),before);
  } finally { await f.close(); }
});

test('old legacy updater is retired even with a current revision and leaves the whole journey intact',async()=>{
  const f=await createCutoverDatabase();
  try {
    await f.seedLegacy([legacy()]);
    const before=await f.journey();
    await assert.rejects(f.asRole('authenticated',BRIDE,
      'SELECT public.update_own_legacy_amora_action($1,$2,$3,$4,$5::jsonb)',
      [COUPLE,JOURNEY,'draft_legacy',before.state_revision,JSON.stringify({description:'SYNTHETIC-UNVERSIONED'})]),
      error=>error.code==='55000');
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('existing create keeps defaults, actor provenance, and exact request-id duplicate behavior',async()=>{
  const f=await createCutoverDatabase();
  try {
    const before=await f.journey();
    const action=await f.create('cutover_create',{title:'  SYNTHETIC-CREATE  ',description:'SYNTHETIC-DESCRIPTION',href:'/chat'});
    assert.equal(action.title,'SYNTHETIC-CREATE');
    assert.equal(action.created_by,BRIDE);
    assert.equal(action.source,'manual');
    assert.equal(action.priority,'medium');
    assert.equal(action.status,'open');
    assert.equal(action.href,'/chat');
    await assert.rejects(f.create('cutover_create',{title:'SYNTHETIC-RETRY'}),error=>error.code==='23505');
    assert.deepEqual(await f.read('cutover_create'),action);
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});
