import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAmoraWriterManagedInventory,buildAmoraWriterManagedInventorySql,AMORA_MANAGED_LOGICAL_REPLICATION_PATTERN}
  from '../lib/amora-action-writer-retirement-managed-workers.mjs';
import {createPrivilegeDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs';

const emptyHash='d41d8cd98f00b204e9800998ecf8427e';
const nativeSystem='1234567890123456789';
const nativeSkip=process.platform!=='win32'&&!nativeProfileRoleAvailable
  ?'Owned native PG17 unavailable on this non-Windows runner; no native verification claimed':false;
function syntheticNet(){
  const clock=new Date().toISOString();
  const row={pid:100,backendStart:clock,database:'postgres',userName:'postgres',application:'',
    backendType:'client backend',state:'active',xactStart:clock,queryStart:clock,
    waitEventType:null,waitEvent:null,queryHash:'1'.repeat(32),queryMarker:'other',
    targetRelationLocks:0,advisoryLocks:0,blockers:[],replication:null};
  return {format:'amora-writer-managed-inventory-v1',observedAt:clock,systemIdentifier:nativeSystem,
    currentUser:'postgres',sessionUser:'postgres',database:'postgres',serverVersion:170010,address:'127.0.0.1',
    readOnly:true,statsVisible:true,observerPid:100,
    capabilities:{net:{sqlExtension:false,namespace:false,queue:false,response:false,httpFunctions:0},
      cron:{version:null,useBackgroundWorkers:null,jobTable:false}},
    inventory:{rows:[row,{...row,pid:101,userName:'supabase_admin',application:'pg_net 0.19.5',
      backendType:'pg_net 0.19.5 worker',state:null,xactStart:null,queryStart:null,
      waitEventType:'Extension',waitEvent:'Extension',queryHash:emptyHash,queryMarker:'empty'}]}};
}

test('synthetic content classifies only exact unavailable pg_net worker and preserves every client as a writer',()=>{
  const raw=syntheticNet();
  const result=validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem});
  assert.deepEqual(result.nonTargetRows.map(row=>[row.pid,row.kind]),[[101,'pg-net-unavailable-current-wait']]);
  assert.deepEqual(result.writerRows.map(row=>row.pid),[100]);
  assert.equal(raw.inventory.rows[1].state,null);
  for(const key of ['executionProvenanceVerified','operatingInventoryVerified','managedCapabilityVerified','sourceBinaryVerified','releaseAuthorized'])
    assert.equal(result[key],false);
});

test('synthetic exact cron launcher wait is separated while active libpq cron job stays a writer',()=>{
  const raw=syntheticNet();raw.capabilities.cron={version:'1.6.4',useBackgroundWorkers:'off',jobTable:true};
  const base=raw.inventory.rows[1];
  raw.inventory.rows.push({...base,pid:102,application:'pg_cron scheduler',backendType:'pg_cron launcher'});
  raw.inventory.rows.push({...raw.inventory.rows[0],pid:103,userName:'supabase_admin',application:'pg_cron'});
  const proof=validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem});
  assert.deepEqual(proof.nonTargetRows.map(row=>row.kind),['pg-net-unavailable-current-wait','pg-cron-libpq-launcher-current-wait']);
  assert.equal(proof.writerRows.some(row=>row.pid===103&&row.state==='active'),true);
  assert.equal(proof.operatingInventoryVerified,false);
});

test('synthetic core archiver is auxiliary only at the exact no-database empty Activity wait',()=>{
  const raw=syntheticNet(),base=raw.inventory.rows[0];
  raw.inventory.rows.push({...base,pid:106,database:null,userName:null,application:'',backendType:'archiver',
    state:null,xactStart:null,queryStart:null,queryHash:emptyHash,queryMarker:'empty',
    waitEventType:'Activity',waitEvent:'ArchiverMain'});
  const before=structuredClone(raw);
  const result=validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem});
  assert.equal(result.auxiliaryRows.find(row=>row.pid===106)?.backendType,'archiver');
  assert.equal(result.writerRows.length,1);assert.equal(result.operatingInventoryVerified,false);
  assert.deepEqual(raw,before);
});

test('core archiver name never exempts unknown database, activity, transaction or lock state',()=>{
  for(const edit of [row=>{row.database='postgres';},row=>{row.userName='postgres';},row=>{row.application='custom';},
    row=>{row.state='idle';},row=>{row.queryStart=new Date().toISOString();},row=>{row.xactStart=new Date().toISOString();},
    row=>{row.queryHash=null;},row=>{row.queryMarker='other';},row=>{row.waitEventType='Extension';},
    row=>{row.waitEvent='OtherWait';},row=>{row.targetRelationLocks=1;},row=>{row.advisoryLocks=1;},
    row=>{row.blockers=[100];},row=>{row.replication={markerValidated:true,linkedSlots:[]};}]){
    const raw=syntheticNet(),row={...raw.inventory.rows[0],pid:106,database:null,userName:null,application:'',backendType:'archiver',
      state:null,xactStart:null,queryStart:null,queryHash:emptyHash,queryMarker:'empty',
      waitEventType:'Activity',waitEvent:'ArchiverMain'};
    edit(row);raw.inventory.rows.push(row);
    assert.throws(()=>validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem}));
  }
});

test('synthetic realtime sender is separated only with current single logical pgoutput marker and linked active slot',()=>{
  const raw=syntheticNet();
  raw.inventory.rows.push({...raw.inventory.rows[0],pid:104,userName:'supabase_admin',
    application:'realtime_replication_connection',backendType:'walsender',xactStart:null,
    waitEventType:'Client',waitEvent:'WalSenderWaitForWal',queryMarker:'single-start-logical-replication',
    replication:{markerValidated:true,linkedSlots:[{activePid:104,active:true,database:'postgres',
      slotType:'logical',plugin:'pgoutput',querySlotMatched:true}]}});
  const proof=validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem});
  assert.equal(proof.nonTargetRows.find(row=>row.pid===104).kind,'realtime-pgoutput-current-wal-wait');
  assert.equal(proof.writerRows.length,1);assert.equal(proof.managedCapabilityVerified,false);
});

test('content cannot classify a managed lifetime beginning after the actual observation window',()=>{
  const raw=syntheticNet();raw.inventory.rows[1].backendStart=new Date(Date.now()+11_000).toISOString();
  assert.throws(()=>validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem}),/LIFETIME_UNKNOWN/);
});

test('changing caller input after content validation cannot change the returned managed inventory snapshot',()=>{
  const raw=syntheticNet(),proof=validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem});
  raw.inventory.rows[1].blockers.push(100);
  assert.deepEqual(proof.nonTargetRows[0].blockers,[]);
  assert.equal(proof.releaseAuthorized,false);
});

test('pg_net capability presence, unknown version/config/state/role/locks and coercions remain NO-GO',()=>{
  const edits=[
    raw=>{raw.capabilities.net.sqlExtension=true;},raw=>{raw.capabilities.net.namespace=true;},
    raw=>{raw.capabilities.net.queue=true;},raw=>{raw.capabilities.net.response=true;},raw=>{raw.capabilities.net.httpFunctions=1;},
    raw=>{raw.capabilities.net.httpFunctions='0';},raw=>{raw.capabilities.net.namespace=null;},
    raw=>{raw.inventory.rows[1].backendType='pg_net 0.20 worker';},raw=>{raw.inventory.rows[1].application='pg_net 0.20';},
    raw=>{raw.inventory.rows[1].userName='postgres';},raw=>{raw.inventory.rows[1].state='idle';},
    raw=>{raw.inventory.rows[1].queryMarker='other';},raw=>{raw.inventory.rows[1].queryHash=null;},
    raw=>{raw.inventory.rows[1].queryHash=[emptyHash];},raw=>{raw.inventory.rows[1].waitEvent='Unknown';},
    raw=>{raw.inventory.rows[1].targetRelationLocks=1;},raw=>{raw.inventory.rows[1].advisoryLocks=1;},
    raw=>{raw.inventory.rows[1].blockers=[100];},raw=>{raw.inventory.rows[1].backendStart=null;},
    raw=>{raw.inventory.rows[1].xactStart=raw.observedAt;},raw=>{raw.inventory.rows[1].pid='101';},
    raw=>{raw.statsVisible=false;},raw=>{raw.statsVisible='true';},raw=>{raw.inventory.rows=null;},
    raw=>{raw.releaseAuthorized=true;},raw=>{raw.inventory.rows[0].application='pg_cron';raw.inventory.rows[0].state=null;},
  ];
  for(const edit of edits){const raw=syntheticNet();edit(raw);
    assert.throws(()=>validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem}));}
  for(const name of ['query','clock','skip','allowlist','verified','releaseAuthorized'])
    assert.throws(()=>buildAmoraWriterManagedInventorySql({[name]:true}),/OPTIONS_INVALID/);
});

test('cron alternate capability or worker execution is not promoted to a scheduler wait',()=>{
  for(const edit of [raw=>{raw.capabilities.cron.version='1.6.5';},raw=>{raw.capabilities.cron.useBackgroundWorkers='on';},
    raw=>{raw.capabilities.cron.jobTable=false;},raw=>{raw.inventory.rows[1].application='pg_cron worker';},
    raw=>{raw.inventory.rows[1].backendType='pg_cron worker';},raw=>{raw.inventory.rows[1].state='active';},
    raw=>{raw.inventory.rows[1].queryStart=raw.observedAt;},raw=>{raw.inventory.rows[1].queryHash='1'.repeat(32);}]){
    const raw=syntheticNet();raw.capabilities.cron={version:'1.6.4',useBackgroundWorkers:'off',jobTable:true};
    Object.assign(raw.inventory.rows[1],{backendType:'pg_cron launcher',application:'pg_cron scheduler'});edit(raw);
    assert.throws(()=>validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem}));
  }
});

test('logical sender active SQL, missing/mismatched/custom slots, waits or locks remain NO-GO',()=>{
  for(const edit of [row=>{row.queryMarker='other';},row=>{row.replication.markerValidated=false;},
    row=>{row.replication.markerValidated='true';},row=>{row.replication.linkedSlots=[];},
    row=>{row.replication.linkedSlots.push({...row.replication.linkedSlots[0]});},
    row=>{row.replication.linkedSlots[0].plugin='custom_spi_plugin';},row=>{row.replication.linkedSlots[0].activePid=105;},
    row=>{row.replication.linkedSlots[0].slotType='physical';},row=>{row.replication.linkedSlots[0].active=false;},
    row=>{row.replication.linkedSlots[0].querySlotMatched=false;},row=>{row.replication.linkedSlots[0].database='other';},
    row=>{row.application='some_walsender';},row=>{row.userName='postgres';},row=>{row.waitEventType='IO';},
    row=>{row.waitEvent='SomeWait';},row=>{row.xactStart=row.backendStart;},
    row=>{row.targetRelationLocks=1;},row=>{row.advisoryLocks=1;},row=>{row.blockers=[100];}]){
    const raw=syntheticNet();
    const row={...raw.inventory.rows[0],pid:104,userName:'supabase_admin',application:'realtime_replication_connection',
      backendType:'walsender',xactStart:null,waitEventType:'Client',waitEvent:'WalSenderWaitForWal',
      queryMarker:'single-start-logical-replication',replication:{markerValidated:true,linkedSlots:[{activePid:104,
        active:true,database:'postgres',slotType:'logical',plugin:'pgoutput',querySlotMatched:true}]}};
    edit(row);raw.inventory.rows.push(row);
    assert.throws(()=>validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:nativeSystem}));
  }
});

test('owned PG17 fixed READ ONLY collector observes absent capabilities and keeps client lifetime without data changes',
  {timeout:120_000,skip:nativeSkip},async()=>{
    assert.ok(nativeProfileRoleAvailable,'Required owned PG17 missing on Windows, not a skip');
    const f=await createPrivilegeDatabase({phase:'before'});
    try{
      const system=(await f.db.query('SELECT system_identifier::text AS system FROM pg_control_system()')).rows[0].system;
      const rowsSql=`SELECT md5(coalesce(jsonb_agg(to_jsonb(j) ORDER BY id)::text,'[]')) AS digest FROM public.wedding_journeys j`;
      const before=(await f.db.query(rowsSql)).rows[0];
      const result=await f.db.query(buildAmoraWriterManagedInventorySql({expectedNativeSystemIdentifier:system}));
      const raw=result.find(row=>row.rows?.[0]?.managed_inventory).rows[0].managed_inventory;
      const proof=validateAmoraWriterManagedInventory(raw,{expectedNativeSystemIdentifier:system});
      assert.equal(raw.readOnly,true);assert.equal(raw.statsVisible,true);
      assert.deepEqual(raw.capabilities.net,{sqlExtension:false,namespace:false,queue:false,response:false,httpFunctions:0});
      assert.deepEqual(raw.capabilities.cron,{version:null,useBackgroundWorkers:null,jobTable:false});
      assert.equal(proof.nonTargetRows.length,0);assert.equal(proof.writerRows.some(row=>row.pid===raw.observerPid),true);
      assert.equal(proof.releaseAuthorized,false);assert.equal(proof.executionProvenanceVerified,false);
      assert.deepEqual((await f.db.query(rowsSql)).rows[0],before);
      assert.equal(JSON.stringify(raw).includes('request.jwt.claim'),false);
      assert.equal(Object.hasOwn(raw.inventory.rows.find(row=>row.pid===raw.observerPid),'query'),false);
    }finally{await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('owned PG17 logical replication marker accepts one command and rejects SQL suffixes or broken quoting without executing text',
  {timeout:120_000,skip:nativeSkip},async()=>{
    assert.ok(nativeProfileRoleAvailable,'Required owned PG17 missing on Windows, not a skip');
    const f=await createPrivilegeDatabase({phase:'before'});
    try{
      const good=`START_REPLICATION SLOT "synthetic_slot" LOGICAL 0/ABCD ("proto_version" '1', "publication_names" 'synthetic_publication')`;
      await f.db.query('BEGIN READ ONLY');
      for(const [query,expected] of [[good,true],['START_REPLICATION SLOT synthetic_slot LOGICAL 0/0',true],
        [good+'; SELECT 1',false],[good+' SELECT 1',false],[good+';',false],
        [good.replace("'1'","'1; SELECT 1'"),false],[good.replace('LOGICAL','PHYSICAL'),false],
        [good.replace('synthetic_slot','bad-slot'),false],[good.replace("'synthetic_publication'","'unterminated"),false]]){
        const result=await f.db.query('SELECT regexp_match($1,$2) IS NOT NULL AS matched',[query,AMORA_MANAGED_LOGICAL_REPLICATION_PATTERN]);
        assert.equal(result.rows[0].matched,expected,'Literal synthetic query only; no SQL execution');
      }
      await f.db.query('COMMIT');
      assert.equal((await f.db.query('SELECT count(*)::int AS count FROM public.wedding_journeys')).rows[0].count,1);
    }finally{await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });
