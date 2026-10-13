import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {BRIDE,COUPLE,TOKEN,legacy} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';
import {beginAs} from '../../supabase/release-candidates/amora-action-writer-cutover-v1/cutover-fixture.mjs';
import {createPrivilegeDatabase,nativeProfileRoleAvailable}
  from '../../supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs';
import {buildAmoraWriterMaintenanceInstallSql,AMORA_WRITER_MAINTENANCE_ERROR,
  buildAmoraWriterMaintenanceObservationSql,validateAmoraWriterMaintenanceObservation,
  createAmoraWriterMaintenanceCohort,assertAmoraWriterMaintenanceDrained,
  buildAmoraWriterMaintenanceCutoffSql,buildAmoraWriterMaintenanceUninstallSql}
  from '../lib/amora-action-writer-retirement-maintenance.mjs';
import {createMaintenanceNativeDatabase,maintenanceLedgerSql}
  from './fixtures/amora-action-writer-retirement-maintenance-native.mjs';

const settle=promise=>promise.then(value=>({value}),error=>({error}));
const rowDigests=async client=>(await client.query(`SELECT 'actions' AS relation,count(*)::int AS n,
  md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'[]')) AS md5 FROM public.amora_actions a
  UNION ALL SELECT 'journeys',count(*)::int,md5(coalesce(jsonb_agg(to_jsonb(j) ORDER BY id)::text,'[]'))
  FROM public.wedding_journeys j ORDER BY relation`)).rows;
async function profileWait(observer,writerPid,blockerPid){
  for(let n=0;n<150;n++){
    const row=(await observer.query(`SELECT a.state,a.wait_event_type,pg_blocking_pids(a.pid) AS blockers,
      EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='public.profiles'::regclass
      AND l.mode='RowShareLock' AND NOT l.granted) AS profile_wait FROM pg_stat_activity a WHERE a.pid=$1`,[writerPid])).rows[0];
    if(row?.state==='active'&&row.wait_event_type==='Lock'&&row.profile_wait&&row.blockers.includes(blockerPid))return;
    await delay(10);
  }assert.fail('Actual owned profile wait missing, not a safe drain result');
}

test('owned PG17 denies all six target statements without changing any external writer grant',
  {timeout:120_000},async()=>{
    assert.ok(nativeProfileRoleAvailable,'Required owned PG17 unavailable, not a skip');
    const f=await createPrivilegeDatabase({phase:'before'});let unknown;
    try{
      const identity=(await f.db.query(`SELECT (SELECT system_identifier::text FROM pg_control_system()) AS system,
        host(inet_server_addr()) AS address`)).rows[0];
      assert.equal(identity.address,'127.0.0.1');assert.notEqual(identity.system,'7581440907192989109');
      const aclSql=`SELECT oid::regclass::text AS relation,relacl::text AS acl FROM pg_class
        WHERE oid IN ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass) ORDER BY relation`;
      const before=(await f.db.query(aclSql)).rows;
      unknown=await f.newSession();
      await assert.rejects(f.exec(buildAmoraWriterMaintenanceInstallSql({expectedNativeSystemIdentifier:identity.system})),/INVENTORY_UNKNOWN/);
      await f.db.query('ROLLBACK');
      assert.equal((await f.db.query("SELECT to_regprocedure('public.deny_amora_action_writer_retirement_maintenance_v1()') AS fn")).rows[0].fn,null);
      await unknown.query('SELECT 1');
      await f.exec(buildAmoraWriterMaintenanceInstallSql({expectedNativeSystemIdentifier:identity.system}));
      await assert.rejects(f.exec(buildAmoraWriterMaintenanceInstallSql({expectedNativeSystemIdentifier:identity.system})),/SLOT_NOT_ABSENT/);
      await f.db.query('ROLLBACK');
      for(const [table,insert] of [
        ['amora_actions','INSERT INTO public.amora_actions(id,couple_id,title) SELECT NULL::text,NULL::uuid,NULL::text WHERE false'],
        ['wedding_journeys','INSERT INTO public.wedding_journeys(id,couple_id) SELECT NULL::uuid,NULL::uuid WHERE false'],
      ])for(const sql of [insert,`UPDATE public.${table} SET id=id WHERE false`,`DELETE FROM public.${table} WHERE false`])
        await assert.rejects(f.db.query(sql),error=>error.code==='55000'&&error.message===AMORA_WRITER_MAINTENANCE_ERROR);
      assert.deepEqual((await f.db.query(aclSql)).rows,before);
    }finally{await unknown?.end();await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('actual server-cutoff inventory rejects an active and aborted transaction until its own rollback',
  {timeout:120_000},async()=>{
    const f=await createPrivilegeDatabase({phase:'before'}),clients=[];
    try{
      const writer=await f.newSession(),observer=await f.newSession();clients.push(writer,observer);
      await writer.query('SELECT 1');await observer.query('SELECT 1');
      const system=(await f.db.query('SELECT system_identifier::text AS system FROM pg_control_system()')).rows[0].system;
      await f.exec(buildAmoraWriterMaintenanceInstallSql({expectedNativeSystemIdentifier:system}));
      await writer.query('BEGIN');await writer.query('SELECT 1');
      const cutoff=(await observer.query("SELECT jsonb_build_object('clock',clock_timestamp()) AS value")).rows[0].value.clock;
      const observe=async()=>{
        const result=await observer.query(buildAmoraWriterMaintenanceObservationSql({expectedNativeSystemIdentifier:system,cutoff}));
        return (Array.isArray(result)?result:[result]).find(row=>row.rows?.[0]?.maintenance_observation)?.rows[0].maintenance_observation;
      };
      const initial=await observe(),cohort=createAmoraWriterMaintenanceCohort(initial,{expectedNativeSystemIdentifier:system});
      const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      assert.equal(cohort.members.some(row=>row.pid===writerPid),true);
      assert.throws(()=>assertAmoraWriterMaintenanceDrained(initial,cohort,{expectedNativeSystemIdentifier:system}),/DRAIN_REQUIRED/);
      await assert.rejects(writer.query('UPDATE public.amora_actions SET id=id WHERE false'),
        error=>error.code==='55000'&&error.message===AMORA_WRITER_MAINTENANCE_ERROR);
      const aborted=await observe();
      assert.throws(()=>assertAmoraWriterMaintenanceDrained(aborted,cohort,{expectedNativeSystemIdentifier:system}),/DRAIN_REQUIRED/);
      await writer.query('ROLLBACK');
      const cleared=assertAmoraWriterMaintenanceDrained(await observe(),cohort,{expectedNativeSystemIdentifier:system});
      assert.equal(cleared.releaseAuthorized,false);assert.equal(cleared.executionProvenanceVerified,false);
    }finally{
      for(const client of clients)await client.query('ROLLBACK').catch(()=>{});
      await Promise.all(clients.map(client=>client.end()));await f.db.query('ROLLBACK').catch(()=>{});await f.close();
    }
  });

test('actual installed maintenance observation binds private definitions/OIDs and rejects null inventory or body drift',
  {timeout:120_000},async()=>{
    const f=await createPrivilegeDatabase({phase:'before'});
    try{
      const system=(await f.db.query('SELECT system_identifier::text AS system FROM pg_control_system()')).rows[0].system;
      await f.exec(buildAmoraWriterMaintenanceInstallSql({expectedNativeSystemIdentifier:system}));
      const observe=async()=>{
        const result=await f.db.query(buildAmoraWriterMaintenanceObservationSql({expectedNativeSystemIdentifier:system}));
        return (Array.isArray(result)?result:[result]).find(row=>row.rows?.[0]?.maintenance_observation)?.rows[0].maintenance_observation;
      };
      const before=await observe();
      const proof=validateAmoraWriterMaintenanceObservation(before,{expectedNativeSystemIdentifier:system});
      assert.equal(proof.releaseAuthorized,false);assert.equal(proof.executionProvenanceVerified,false);
      assert.equal(proof.objectIds.functionId,before.functions[0].oid);
      assert.equal(proof.objectIds.triggerIds.length,2);
      const invalid=structuredClone(await observe());invalid.inventory=null;
      assert.throws(()=>validateAmoraWriterMaintenanceObservation(invalid,{expectedNativeSystemIdentifier:system}),/INVENTORY/);
      const nullPid=structuredClone(await observe());nullPid.inventory.rows[0].backendStart=null;
      assert.throws(()=>validateAmoraWriterMaintenanceObservation(nullPid,{expectedNativeSystemIdentifier:system}),/INVENTORY/);
      const managedUnknown=structuredClone(await observe());
      const current=managedUnknown.inventory.rows.find(row=>row.pid===managedUnknown.observerPid);
      current.backendType='pg_cron launcher';current.state=null;current.queryStart=null;
      assert.throws(()=>validateAmoraWriterMaintenanceObservation(managedUnknown,{expectedNativeSystemIdentifier:system}),/INVENTORY_UNKNOWN/);
      await f.exec(`CREATE OR REPLACE FUNCTION public.deny_amora_action_writer_retirement_maintenance_v1()
        RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
        AS $$BEGIN RETURN NULL; END;$$;`);
      const drift=await observe();
      assert.throws(()=>validateAmoraWriterMaintenanceObservation(drift,{expectedNativeSystemIdentifier:system}),/PIN/);
    }finally{await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('actual post-bundle cutoff and literal uninstall bind source9, synthetic raw231 and exact three object lifetimes',
  {timeout:120_000},async()=>{
    const f=await createMaintenanceNativeDatabase();
    try{
      const base={expectedNativeSystemIdentifier:f.system};
      await f.exec(buildAmoraWriterMaintenanceInstallSql(base));
      const observe=async cutoff=>{
        const result=await f.db.query(buildAmoraWriterMaintenanceObservationSql({...base,...(cutoff?{cutoff}:{})}));
        return result.find(row=>row.rows?.[0]?.maintenance_observation).rows[0].maintenance_observation;
      };
      const objects=validateAmoraWriterMaintenanceObservation(await observe(),base).objectIds;
      const before=(await f.db.query(maintenanceLedgerSql)).rows[0];assert.equal(before.count,230);
      const input={...base,repoRoot:f.sourceRoot,postLedgerMd5:before.md5,objectIds:objects};
      for(const extra of ['verified','releaseAuthorized','query','now','skip'])
        assert.throws(()=>buildAmoraWriterMaintenanceCutoffSql({...input,[extra]:true}),/OPTIONS_INVALID/);
      assert.throws(()=>buildAmoraWriterMaintenanceCutoffSql({...input,postLedgerMd5:[before.md5]}),/POST_B2_INPUT_INVALID/);
      await assert.rejects(f.db.query(buildAmoraWriterMaintenanceCutoffSql(input)),/POST_B2/);
      await f.db.query('ROLLBACK');
      await f.installB2();
      const after=(await f.db.query(maintenanceLedgerSql)).rows[0];assert.equal(after.count,231);
      const clockResult=await f.db.query(buildAmoraWriterMaintenanceCutoffSql({...input,postLedgerMd5:after.md5}));
      const receipt=clockResult.find(row=>row.rows?.[0]?.maintenance_cutoff).rows[0].maintenance_cutoff;
      assert.equal(receipt.releaseAuthorized,false);assert.equal(receipt.executionProvenanceVerified,false);
      const cohort=createAmoraWriterMaintenanceCohort(await observe(receipt.cutoff),base);
      const remove={...base,repoRoot:f.sourceRoot,postLedgerMd5:after.md5,cohort};
      assert.throws(()=>buildAmoraWriterMaintenanceUninstallSql({...remove,cohort:{...cohort,releaseAuthorized:true}}),/COHORT_INVALID/);
      const absentOid=(await f.db.query('SELECT max(oid)::bigint+1000 AS oid FROM pg_proc')).rows[0].oid;
      await assert.rejects(f.db.query(buildAmoraWriterMaintenanceUninstallSql({...remove,
        cohort:{...cohort,objectIds:{...cohort.objectIds,functionId:Number(absentOid)}}})),/OBJECT_LIFETIME_CHANGED/);
      await f.db.query('ROLLBACK');
      await f.exec('ALTER TABLE public.amora_actions DISABLE TRIGGER deny_amora_actions_writer_retirement_maintenance_v1');
      await assert.rejects(f.db.query(buildAmoraWriterMaintenanceUninstallSql(remove)),/OBJECT_LIFETIME_CHANGED/);
      await f.db.query('ROLLBACK');
      await f.exec('ALTER TABLE public.amora_actions ENABLE TRIGGER deny_amora_actions_writer_retirement_maintenance_v1');
      const expired={...cohort,cutoff:new Date(Date.now()-121_000).toISOString()};
      await assert.rejects(f.db.query(buildAmoraWriterMaintenanceUninstallSql({...remove,cohort:expired})),/CUTOFF_EXPIRED/);
      await f.db.query('ROLLBACK');
      await assert.rejects(f.db.query(buildAmoraWriterMaintenanceUninstallSql({...remove,postLedgerMd5:'0'.repeat(32)})),/POST_B2/);
      await f.db.query('ROLLBACK');
      await f.exec(buildAmoraWriterMaintenanceUninstallSql(remove));
      assert.deepEqual((await f.db.query(maintenanceLedgerSql)).rows[0],after);
      assert.equal((await f.db.query("SELECT to_regprocedure('public.deny_amora_action_writer_retirement_maintenance_v1()') AS fn")).rows[0].fn,null);
      assert.equal((await f.db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'deny_%_writer_retirement_maintenance_v1'`)).rows[0].n,0);
    }finally{await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('warmed prepared old W1/W2 drain before exact three-object removal while fresh and cached new bodies remain safe',
  {timeout:180_000},async t=>{
    const f=await createMaintenanceNativeDatabase(),clients=[],pending=[];let blocker;
    try{
      const observer=await f.newSession(),w1=await f.newSession(),w2=await f.newSession(),w3=await f.newSession(),ddl=await f.newSession();
      blocker=await f.newSession();clients.push(observer,w1,w2,w3,ddl,blocker);
      const base={expectedNativeSystemIdentifier:f.system},id='maint_cache_canonical',legacyId='maint_cache_legacy';
      await f.seedCanonical(id);await f.seedLegacy([legacy(legacyId),legacy('maint_untouched')]);
      const oldText="SELECT public.mutate_own_amora_action($1,$2,'update',$3::jsonb) AS value";
      const old=client=>client.query({name:'owned-warmed-old-maintenance',text:oldText,
        values:[COUPLE,id,JSON.stringify({description:'SYNTHETIC-WARMED'})]});
      for(const writer of [w1,w2,w3]){await beginAs(writer,'authenticated',BRIDE);await old(writer);await writer.query('COMMIT');}
      const serviceDirect=()=>w3.query({name:'owned-warmed-direct-service-update',
        text:'UPDATE public.amora_actions SET id=id WHERE false'});
      await beginAs(w3,'service_role',null);await serviceDirect();await w3.query('COMMIT');
      const v2Text='SELECT public.patch_own_amora_action_view_v2($1,$2,$3,$4::jsonb) AS value';
      const stale=()=>w3.query({name:'owned-warmed-v2-maintenance',text:v2Text,
        values:[COUPLE,id,TOKEN,JSON.stringify({status:'done'})]});
      await beginAs(w3,'authenticated',BRIDE);
      await assert.rejects(stale(),error=>error.code==='40001');await w3.query('ROLLBACK');
      const legacyText='SELECT public.update_own_legacy_amora_action($1,$2,$3,$4,$5::jsonb) AS value';
      const journeyId='30000000-0000-4000-8000-000000000001';
      const legacyCall=revision=>w3.query({name:'owned-warmed-legacy-maintenance',text:legacyText,
        values:[COUPLE,journeyId,legacyId,revision,JSON.stringify({description:'SYNTHETIC-WARMED-LEGACY'})]});
      await beginAs(w3,'authenticated',BRIDE);await legacyCall((await f.journey()).state_revision);await w3.query('COMMIT');
      const original=await f.read(id),journeyBefore=await f.journey(),rowsBefore=await rowDigests(observer);
      const pids=[];for(const client of [w1,w2,w3,blocker])pids.push((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('BEGIN');await blocker.query('LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE');
      await beginAs(w1,'authenticated',BRIDE);pending.push(settle(old(w1)));await profileWait(observer,pids[0],pids[3]);
      await ddl.query(buildAmoraWriterMaintenanceInstallSql(base));
      await beginAs(w3,'service_role',null);
      await assert.rejects(serviceDirect(),e=>e.code==='55000'&&e.message===AMORA_WRITER_MAINTENANCE_ERROR);
      await w3.query('ROLLBACK');
      await beginAs(w2,'authenticated',BRIDE);pending.push(settle(old(w2)));await profileWait(observer,pids[1],pids[3]);
      await f.installB2(ddl);
      const ledger=(await observer.query(maintenanceLedgerSql)).rows[0];assert.equal(ledger.count,231);
      const observe=async(cutoff,client=observer)=>{
        const result=await client.query(buildAmoraWriterMaintenanceObservationSql({...base,...(cutoff?{cutoff}:{})}));
        return result.find(row=>row.rows?.[0]?.maintenance_observation).rows[0].maintenance_observation;
      };
      const objects=validateAmoraWriterMaintenanceObservation(await observe(),base).objectIds;
      const clockResult=await observer.query(buildAmoraWriterMaintenanceCutoffSql({repoRoot:f.sourceRoot,...base,objectIds:objects,postLedgerMd5:ledger.md5}));
      const cutoff=clockResult.find(row=>row.rows?.[0]?.maintenance_cutoff).rows[0].maintenance_cutoff.cutoff;
      const initial=await observe(cutoff),cohort=createAmoraWriterMaintenanceCohort(initial,base);
      assert.equal(cohort.members.some(m=>m.pid===pids[0]),true);assert.equal(cohort.members.some(m=>m.pid===pids[1]),true);
      const uninstall=buildAmoraWriterMaintenanceUninstallSql({repoRoot:f.sourceRoot,...base,postLedgerMd5:ledger.md5,cohort});
      assert.throws(()=>assertAmoraWriterMaintenanceDrained(initial,cohort,base),/DRAIN_REQUIRED/);
      // 음성만: actual 이전 query lifetime을 caller cohort에서 누락하면 독립 inventory가 잡는다.
      const truncated=structuredClone(cohort);truncated.members=truncated.members.filter(m=>m.pid!==pids[0]);
      assert.throws(()=>assertAmoraWriterMaintenanceDrained(initial,truncated,base),/LATE_COHORT/);
      await assert.rejects(ddl.query(buildAmoraWriterMaintenanceUninstallSql({repoRoot:f.sourceRoot,...base,postLedgerMd5:ledger.md5,cohort:truncated})),/LATE_COHORT/);
      await ddl.query('ROLLBACK');
      await assert.rejects(ddl.query(uninstall),/DRAIN_REQUIRED/);await ddl.query('ROLLBACK');
      assert.deepEqual(await rowDigests(observer),rowsBefore);
      // 같은 warmed backend/statement의 cutoff 이후 재입장은 새 body다. 진행 중인 구 W1/W2와 구분한다.
      await beginAs(w3,'authenticated',BRIDE);pending.push(settle(old(w3)));await profileWait(observer,pids[2],pids[3]);
      await blocker.query('COMMIT');
      const results=await Promise.all(pending);
      for(const result of results.slice(0,2))assert.equal(result.error?.message,AMORA_WRITER_MAINTENANCE_ERROR);
      assert.equal(results[2].error?.message,'AMORA_ACTION_UNVERSIONED_UPDATE_RETIRED');
      assert.equal(results.every(r=>r.error?.code==='55000'),true);
      await assert.rejects(ddl.query(uninstall),/DRAIN_REQUIRED/);await ddl.query('ROLLBACK');
      for(const writer of [w1,w2,w3])await writer.query('ROLLBACK');
      const drained=await observe(cutoff);
      assert.equal(assertAmoraWriterMaintenanceDrained(drained,cohort,base).releaseAuthorized,false);
      await ddl.query(uninstall);
      assert.deepEqual(await f.read(id),original);assert.deepEqual(await f.journey(),journeyBefore);
      await beginAs(w1,'authenticated',BRIDE);await assert.rejects(old(w1),e=>e.code==='55000'&&e.message==='AMORA_ACTION_UNVERSIONED_UPDATE_RETIRED');await w1.query('ROLLBACK');
      await beginAs(w3,'authenticated',BRIDE);await assert.rejects(legacyCall(journeyBefore.state_revision),e=>e.code==='55000');await w3.query('ROLLBACK');
      await beginAs(w3,'authenticated',BRIDE);await assert.rejects(stale(),e=>e.code==='PT409');await w3.query('ROLLBACK');
      await beginAs(w3,'service_role',null);await assert.rejects(serviceDirect(),e=>e.code==='42501');await w3.query('ROLLBACK');
      await assert.rejects(f.oldPatch(id,{description:'SYNTHETIC-FRESH-RETIRED'}),e=>e.code==='55000');
      assert.equal((await f.patch(id,{description:'SYNTHETIC-V2-RESUMED'},original.updated_at)).description,'SYNTHETIC-V2-RESUMED');
      const legacyToken=journeyBefore.progress.__amora_actions[0].updatedAt;
      assert.equal((await f.patch(legacyId,{description:'SYNTHETIC-LEGACY-RESUMED'},legacyToken)).description,'SYNTHETIC-LEGACY-RESUMED');
      assert.equal((await f.create('maint_create_kept')).title,'SYNTHETIC-CANONICAL');
      const journeyAfter=await f.journey();assert.deepEqual(journeyAfter.progress.budget,journeyBefore.progress.budget);
      assert.deepEqual(journeyAfter.progress.schedule,journeyBefore.progress.schedule);
      assert.deepEqual(journeyAfter.progress.__amora_actions[1],journeyBefore.progress.__amora_actions[1]);
      assert.deepEqual((await observer.query(maintenanceLedgerSql)).rows[0],ledger);
      t.diagnostic(JSON.stringify({scope:'owned-native-full-maintenance-sequence-only',warmedOldWaiters:2,
        sameBackendPreparedCallsAfterCutoverUsedNewBodies:true,oldWaitersReachedMaintenanceDml:true,
        activeAndAbortedRemovalDenied:true,selfRollbackThenExactThreeRemoved:true,canonicalLegacyAndCreatePreserved:true,
        warmedServiceUpdatePermissionRevoked:true,
        syntheticHistoryRawDigestPreserved:true,operatingLedgerVerified:false,operatingInventoryVerified:false,
        http503Verified:false,releaseAuthorized:false}));
    }finally{
      await blocker?.query('ROLLBACK').catch(()=>{});await Promise.all(pending);
      for(const client of clients)await client.query('ROLLBACK').catch(()=>{});
      await Promise.all(clients.map(client=>client.end()));await f.db.query('ROLLBACK').catch(()=>{});await f.close();
    }
  });
