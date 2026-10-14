import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {BRIDE,COUPLE,legacy} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';
import {beginAs} from '../../supabase/release-candidates/amora-action-writer-cutover-v1/cutover-fixture.mjs';
import {createPrivilegeDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs';
import {AMORA_MANAGED_LOGICAL_REPLICATION_PATTERN} from '../lib/amora-action-writer-retirement-managed-workers.mjs';
import {buildAmoraWriterManagedMaintenanceInstallSql,buildAmoraWriterManagedMaintenanceCutoffSql,
  buildAmoraWriterManagedMaintenanceUninstallSql} from '../lib/amora-action-writer-retirement-managed-maintenance.mjs';
import {AMORA_WRITER_MAINTENANCE_ERROR,buildAmoraWriterMaintenanceObservationSql,
  validateAmoraWriterMaintenanceObservation,createAmoraWriterMaintenanceCohort}
  from '../lib/amora-action-writer-retirement-maintenance.mjs';
import {createMaintenanceNativeDatabase,maintenanceLedgerSql} from './fixtures/amora-action-writer-retirement-maintenance-native.mjs';

const nativeSkip=process.platform!=='win32'&&!nativeProfileRoleAvailable
  ?'Owned native PG17 unavailable on this non-Windows runner; no native verification claimed':false;
const originalSha='f28e1a01aa42631291ec3a88dc470908f762b3212dad20dc337c8e196e1c7cde';
const original=()=>createHash('sha256').update(readFileSync(new URL('../lib/amora-action-writer-retirement-maintenance.mjs',import.meta.url))).digest('hex');
const settle=promise=>promise.then(value=>({value}),error=>({error}));
const actionDigest=async client=>(await client.query(`SELECT count(*)::int AS count,
  md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'[]')) AS md5 FROM public.amora_actions a`)).rows;
async function waitProfile(observer,pid,blocker){
  for(let index=0;index<150;index++){
    const row=(await observer.query(`SELECT state,wait_event_type,pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity WHERE pid=$1`,[pid])).rows[0];
    if(row?.state==='active'&&row.wait_event_type==='Lock'&&row.blockers.includes(blocker))return;
    await delay(10);
  }assert.fail('Actual owned profile wait missing, not a safe drain result');
}
async function observation(client,system,cutoff){
  const result=await client.query(buildAmoraWriterMaintenanceObservationSql({expectedNativeSystemIdentifier:system,...(cutoff?{cutoff}:{})}));
  return result.find(entry=>entry.rows?.[0]?.maintenance_observation).rows[0].maintenance_observation;
}

test('new controlled renderer rejects unknown inputs and leaves frozen original source unchanged',()=>{
  assert.equal(original(),originalSha);
  for(const input of [null,[],{query:'SELECT 1'},{verified:true},{allowlist:['*']},{skip:true}])
    assert.throws(()=>buildAmoraWriterManagedMaintenanceInstallSql(input));
  assert.throws(()=>buildAmoraWriterManagedMaintenanceInstallSql({expectedNativeSystemIdentifier:'7581440907192989109'}));
  const inherited=Object.create({repoRoot:fileURLToPath(new URL('../../',import.meta.url)),
    postLedgerMd5:'0'.repeat(32),objectIds:{functionId:1,triggerIds:[2,3]}});
  assert.throws(()=>buildAmoraWriterManagedMaintenanceCutoffSql(inherited),/POST_B2_INPUT_INVALID/);
  assert.equal(original(),originalSha);
});

test('source-extracted SQL CASE on synthetic typed metadata only preserves clients and rejects managed capability drift',
  {timeout:120_000,skip:nativeSkip},async()=>{
    assert.ok(nativeProfileRoleAvailable,'Required owned PG17 missing on Windows, not a skip');
    // 이 CASE는 실제 새 renderer 원문이다. synthetic metadata의 SQL 행동만 검사하며 실제 worker/운영 proof가 아니다.
    // CTE는 이 SELECT에만 존재하고 schema/temp view/GUC/역할/원본 함수는 바꾸지 않는다.
    const source=readFileSync(new URL('../lib/amora-action-writer-retirement-managed-maintenance.mjs',import.meta.url),'utf8');
    const start=source.indexOf('SELECT a.*,CASE'),end=source.indexOf('END AS kind\n    FROM activity',start);
    assert.ok(start>=0&&end>start&&source.indexOf('SELECT a.*,CASE',start+1)===-1);
    const expression=source.slice(start+'SELECT a.*,'.length,end+'END'.length);
    assert.equal(expression.includes('${'),false);
    const f=await createPrivilegeDatabase({phase:'before'});
    try {
      const clock=new Date().toISOString();
      const base={pid:101,backend_start:clock,backend_type:'client backend',datname:'postgres',usename:'postgres',
        application_name:'pg_cron',state:'active',xact_start:clock,query_start:clock,query:'SELECT 1',
        wait_event_type:null,wait_event:null,relation_locks:0,advisory_locks:0,blockers:[]};
      const wait={...base,usename:'supabase_admin',state:null,xact_start:null,query_start:null,query:'',
        wait_event_type:'Extension',wait_event:'Extension'};
      const net={...wait,backend_type:'pg_net 0.19.5 worker',application_name:'pg_net 0.19.5'};
      const cron={...wait,backend_type:'pg_cron launcher',application_name:'pg_cron scheduler'};
      const archiver={...wait,backend_type:'archiver',datname:null,usename:null,application_name:'',
        wait_event_type:'Activity',wait_event:'ArchiverMain'};
      const sender={...base,usename:'supabase_admin',application_name:'realtime_replication_connection',
        backend_type:'walsender',xact_start:null,query:'START_REPLICATION SLOT synthetic_slot LOGICAL 0/0 (proto_version \'1\')',
        wait_event_type:'Client',wait_event:'WalSenderWaitForWal'};
      const slot={active_pid:101,active:true,database:'postgres',slot_type:'logical',plugin:'pgoutput',slot_name:'synthetic_slot'};
      const sql=`WITH pg_replication_slots AS (SELECT * FROM jsonb_to_recordset($4::jsonb)
          AS s(active_pid int,active boolean,database text,slot_type text,plugin text,slot_name text)),
        activity AS (SELECT a.*,CASE WHEN query IS NULL OR query='<insufficient privilege>'
          OR octet_length(query)>=pg_size_bytes(current_setting('track_activity_query_size'))-1 THEN NULL
          ELSE regexp_match(query,$5::text) END AS marker FROM jsonb_to_recordset($1::jsonb)
          AS a(pid int,backend_start timestamptz,backend_type text,datname text,usename text,application_name text,
            state text,xact_start timestamptz,query_start timestamptz,query text,wait_event_type text,wait_event text,
            relation_locks int,advisory_locks int,blockers int[])),
        capabilities AS (SELECT $2::boolean AS net_absent,$3::boolean AS cron_libpq)
        SELECT ${expression} AS kind FROM activity a CROSS JOIN capabilities c`;
      const classify=async(row,{netAbsent=true,cronLibpq=true,slots=[]}={})=>(await f.db.query(sql,
        [JSON.stringify([row]),netAbsent,cronLibpq,JSON.stringify(slots),AMORA_MANAGED_LOGICAL_REPLICATION_PATTERN])).rows[0].kind;
      assert.equal(await classify(base),'writer');
      assert.equal(await classify({...base,state:'idle',xact_start:null}),'writer');
      assert.equal(await classify(net),'known-managed-wait');assert.equal(await classify(cron),'known-managed-wait');
      assert.equal(await classify(archiver),'core-archiver');
      assert.equal(await classify(sender,{slots:[slot]}),'known-logical-wal-wait');
      for(const edit of [row=>{row.query_start=null;},row=>{row.usename=null;},row=>{row.state=null;},
        row=>{row.backend_start=null;},row=>{row.query=null;}]){
        const row={...base};edit(row);assert.equal(await classify(row),null);
      }
      for(const row of [net,cron])for(const edit of [entry=>{entry.state='idle';},entry=>{entry.query='SELECT 1';},
        entry=>{entry.query_start=clock;},entry=>{entry.xact_start=clock;},entry=>{entry.usename='postgres';},
        entry=>{entry.application_name='unknown';},entry=>{entry.backend_type='unknown worker';},
        entry=>{entry.wait_event='Other';},entry=>{entry.relation_locks=1;},entry=>{entry.advisory_locks=1;},
        entry=>{entry.blockers=[999];}]){
        const mutated={...row};edit(mutated);assert.equal(await classify(mutated),null);
      }
      assert.equal(await classify(net,{netAbsent:false}),null);assert.equal(await classify(net,{netAbsent:null}),null);
      assert.equal(await classify(cron,{cronLibpq:false}),null);assert.equal(await classify(cron,{cronLibpq:null}),null);
      for(const edit of [row=>{row.datname='postgres';},row=>{row.query_start=clock;},row=>{row.xact_start=clock;},
        row=>{row.state='idle';},row=>{row.wait_event='Other';},row=>{row.relation_locks=1;}]){
        const mutated={...archiver};edit(mutated);assert.equal(await classify(mutated),null);
      }
      for(const edit of [row=>{row.query='SELECT 1';},row=>{row.query+='; SELECT 1';},row=>{row.query='START_REPLICATION SLOT synthetic_slot LOGICAL 0/0 '+ ' '.repeat(2048);},
        row=>{row.wait_event='Other';},row=>{row.xact_start=clock;},row=>{row.relation_locks=1;}]){
        const mutated={...sender};edit(mutated);assert.equal(await classify(mutated,{slots:[slot]}),null);
      }
      for(const slots of [[],[slot,slot],[{...slot,active:false}],[{...slot,active_pid:102}],
        [{...slot,database:'other'}],[{...slot,plugin:'custom_spi'}],[{...slot,slot_name:'wrong'}]])
        assert.equal(await classify(sender,{slots}),null);
      assert.equal(original(),originalSha);
    } finally {await f.close();}
  });

test('owned PG17 same-TX guard rejects a pristine NULL client and preserves exact deny DML and external ACL',
  {timeout:120_000,skip:nativeSkip},async()=>{
    assert.ok(nativeProfileRoleAvailable,'Required owned PG17 missing on Windows, not a skip');
    const f=await createMaintenanceNativeDatabase();let unknown;
    try {
      const base={expectedNativeSystemIdentifier:f.system};
      const aclSql=`SELECT oid::regclass::text AS relation,relacl::text AS acl FROM pg_class
        WHERE oid IN ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass) ORDER BY relation`;
      const before=(await f.db.query(aclSql)).rows;
      unknown=await f.newSession();
      await assert.rejects(f.db.query(buildAmoraWriterManagedMaintenanceInstallSql(base)),/INVENTORY_UNKNOWN/);
      await f.db.query('ROLLBACK');
      assert.equal((await f.db.query("SELECT to_regprocedure('public.deny_amora_action_writer_retirement_maintenance_v1()') AS fn")).rows[0].fn,null);
      await unknown.query('SELECT 1');
      const install=await f.db.query(buildAmoraWriterManagedMaintenanceInstallSql(base));
      const installed=install.find(row=>row.rows?.[0]?.managed_maintenance_operation).rows[0].managed_maintenance_operation;
      assert.equal(installed.own3Installed,true);assert.equal(installed.releaseAuthorized,false);
      const objects=validateAmoraWriterMaintenanceObservation(await observation(f.db,f.system),base).objectIds;
      assert.equal(objects.triggerIds.length,2);
      for(const [table,insert] of [
        ['amora_actions','INSERT INTO public.amora_actions(id,couple_id,title) SELECT NULL::text,NULL::uuid,NULL::text WHERE false'],
        ['wedding_journeys','INSERT INTO public.wedding_journeys(id,couple_id) SELECT NULL::uuid,NULL::uuid WHERE false'],
      ])for(const sql of [insert,`UPDATE public.${table} SET id=id WHERE false`,`DELETE FROM public.${table} WHERE false`])
        await assert.rejects(f.db.query(sql),error=>error.code==='55000'&&error.message===AMORA_WRITER_MAINTENANCE_ERROR);
      assert.deepEqual((await f.db.query(aclSql)).rows,before);
      assert.equal(original(),originalSha);
    } finally {await unknown?.end();await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('owned PG17 W1/W2 actual waits drain before exact removal, with raw231, drift and late-cohort fail closed',
  {timeout:180_000,skip:nativeSkip},async()=>{
    assert.ok(nativeProfileRoleAvailable,'Required owned PG17 missing on Windows, not a skip');
    const f=await createMaintenanceNativeDatabase(),clients=[],pending=[];let blocker;
    try {
      const observer=await f.newSession(),w1=await f.newSession(),w2=await f.newSession(),ddl=await f.newSession();
      blocker=await f.newSession();clients.push(observer,w1,w2,ddl,blocker);
      for(const client of clients)await client.query('SELECT 1');
      const base={expectedNativeSystemIdentifier:f.system},id='managed_maintenance_native';
      await f.seedCanonical(id);
      await f.seedLegacy([legacy('managed_maintenance_legacy')]);
      const old=client=>client.query({name:'owned-managed-warmed-old-writer',
        text:"SELECT public.mutate_own_amora_action($1,$2,'update',$3::jsonb) AS value",
        values:[COUPLE,id,JSON.stringify({description:'SYNTHETIC-OLD'})]});
      for(const writer of [w1,w2]){await beginAs(writer,'authenticated',BRIDE);await old(writer);await writer.query('COMMIT');}
      const actionBefore=await f.read(id),rowsBefore=await actionDigest(observer),pids=[];
      for(const client of [w1,w2,blocker])pids.push((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('BEGIN');await blocker.query('LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE');
      await beginAs(w1,'authenticated',BRIDE);pending.push(settle(old(w1)));await waitProfile(observer,pids[0],pids[2]);
      await ddl.query(buildAmoraWriterManagedMaintenanceInstallSql(base));
      await beginAs(w2,'authenticated',BRIDE);pending.push(settle(old(w2)));await waitProfile(observer,pids[1],pids[2]);
      await f.installB2(ddl);
      const ledger=(await observer.query(maintenanceLedgerSql)).rows[0];assert.equal(ledger.count,231);
      const objectIds=validateAmoraWriterMaintenanceObservation(await observation(observer,f.system),base).objectIds;
      const input={...base,repoRoot:f.sourceRoot,objectIds,postLedgerMd5:ledger.md5};
      const result=await observer.query(buildAmoraWriterManagedMaintenanceCutoffSql(input));
      const receipt=result.find(row=>row.rows?.[0]?.maintenance_cutoff).rows[0].maintenance_cutoff;
      assert.equal(receipt.releaseAuthorized,false);assert.equal(receipt.executionProvenanceVerified,false);
      const cohort=createAmoraWriterMaintenanceCohort(await observation(observer,f.system,receipt.cutoff),base);
      assert.ok(cohort.members.some(row=>row.pid===pids[0]));assert.ok(cohort.members.some(row=>row.pid===pids[1]));
      const remove={...base,repoRoot:f.sourceRoot,cohort,postLedgerMd5:ledger.md5};
      const truncated=structuredClone(cohort);truncated.members=truncated.members.filter(row=>row.pid!==pids[0]);
      const uninstall=buildAmoraWriterManagedMaintenanceUninstallSql(remove);
      await assert.rejects(ddl.query(uninstall),/DRAIN_REQUIRED/);
      await ddl.query('ROLLBACK');
      // profiles가 실제 잠긴 동안 RLS helper로 읽으면 테스트 관찰자도 대기한다. 원래 privileged digest만 대조한다.
      assert.deepEqual(await actionDigest(observer),rowsBefore);
      await blocker.query('ROLLBACK');
      for(const promise of pending){const outcome=await promise;assert.equal(outcome.error?.code,'55000');assert.equal(outcome.error?.message,AMORA_WRITER_MAINTENANCE_ERROR);}
      pending.length=0;
      await assert.rejects(ddl.query(buildAmoraWriterManagedMaintenanceUninstallSql({...remove,cohort:truncated})),/LATE_COHORT/);
      await ddl.query('ROLLBACK');
      await assert.rejects(ddl.query(uninstall),/DRAIN_REQUIRED/);
      await ddl.query('ROLLBACK');
      await w1.query('ROLLBACK');await w2.query('ROLLBACK');
      const unknown=await f.newSession();clients.push(unknown);
      await assert.rejects(ddl.query(uninstall),/INVENTORY_UNKNOWN/);
      await ddl.query('ROLLBACK');await unknown.query('SELECT 1');
      await assert.rejects(ddl.query(buildAmoraWriterManagedMaintenanceUninstallSql({...remove,postLedgerMd5:'0'.repeat(32)})),/POST_B2/);
      await ddl.query('ROLLBACK');
      await f.exec('ALTER TABLE public.amora_actions DISABLE TRIGGER deny_amora_actions_writer_retirement_maintenance_v1');
      await assert.rejects(ddl.query(uninstall),/OBJECT_LIFETIME_CHANGED/);
      await ddl.query('ROLLBACK');
      await f.exec('ALTER TABLE public.amora_actions ENABLE TRIGGER deny_amora_actions_writer_retirement_maintenance_v1');
      const removed=await ddl.query(uninstall);
      const removal=removed.find(row=>row.rows?.[0]?.managed_maintenance_operation).rows[0].managed_maintenance_operation;
      assert.equal(removal.own3Absent,true);assert.equal(removal.releaseAuthorized,false);
      assert.deepEqual((await observer.query(maintenanceLedgerSql)).rows[0],ledger);
      assert.equal((await observer.query("SELECT to_regprocedure('public.deny_amora_action_writer_retirement_maintenance_v1()') AS fn")).rows[0].fn,null);
      assert.deepEqual(await f.read(id),actionBefore);
      await beginAs(w1,'authenticated',BRIDE);await assert.rejects(old(w1),error=>error.code==='55000'&&error.message!==AMORA_WRITER_MAINTENANCE_ERROR);await w1.query('ROLLBACK');
      await beginAs(w1,'authenticated',BRIDE);
      const saved=(await w1.query('SELECT public.patch_own_amora_action_view_v2($1,$2,$3,$4::jsonb) AS value',
        [COUPLE,id,actionBefore.updated_at,JSON.stringify({description:'SYNTHETIC-V2-AFTER-DRAIN'})])).rows[0].value;
      assert.equal(saved.description,'SYNTHETIC-V2-AFTER-DRAIN');await w1.query('COMMIT');
      const journey=await f.journey();
      await beginAs(w1,'authenticated',BRIDE);
      const legacySaved=(await w1.query('SELECT public.patch_own_amora_action_view_v2($1,$2,$3,$4::jsonb) AS value',
        [COUPLE,'managed_maintenance_legacy',journey.progress.__amora_actions[0].updatedAt,JSON.stringify({description:'SYNTHETIC-LEGACY-AFTER-DRAIN'})])).rows[0].value;
      assert.equal(legacySaved.description,'SYNTHETIC-LEGACY-AFTER-DRAIN');await w1.query('COMMIT');
      await f.create('managed_maintenance_create',{title:'SYNTHETIC-CREATE-PRESERVED'});
      assert.equal((await f.read('managed_maintenance_create')).title,'SYNTHETIC-CREATE-PRESERVED');
      assert.equal(original(),originalSha);
    } finally {
      await blocker?.query('ROLLBACK').catch(()=>{});await Promise.all(pending);
      for(const client of clients)await client.query('ROLLBACK').catch(()=>{});
      await Promise.all(clients.map(client=>client.end()));await f.db.query('ROLLBACK').catch(()=>{});await f.close();
    }
  });
