import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmoraWriterRetirementSourceRepository} from './fixtures/amora-action-writer-retirement-source-repository.mjs';
import {createAmoraWriterRetirementRecoveryNativeDatabase} from './fixtures/amora-action-writer-retirement-recovery-native.mjs';
import {buildAmoraWriterRetirementBundle} from '../lib/amora-action-writer-retirement-bundle.mjs';
import {buildAmoraWriterRetirementRecoveryCaptureSql} from '../lib/amora-action-writer-retirement-recovery.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from '../lib/amora-action-writer-retirement-release-contract.mjs';
import {buildAmoraWriterMaintenanceInstallSql} from '../lib/amora-action-writer-retirement-maintenance.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const nativeSystem='1234567890123456789';
const inventory=()=>{
  const observedAt=new Date().toISOString(),earlier=new Date(Date.now()-4000).toISOString();
  const observer={pid:100,backendStart:earlier,database:'postgres',userName:'postgres',application:'owned-synthetic-reader',
    backendType:'client backend',state:'active',xactStart:observedAt,queryStart:observedAt,waitEventType:null,waitEvent:null,
    queryHash:'a'.repeat(32),queryMarker:'other',targetRelationLocks:0,advisoryLocks:0,blockers:[],replication:null};
  return {format:'amora-writer-managed-inventory-v1',observedAt,systemIdentifier:nativeSystem,currentUser:'postgres',
    sessionUser:'postgres',database:'postgres',serverVersion:170010,address:'127.0.0.1',readOnly:true,statsVisible:true,
    observerPid:100,capabilities:{net:{sqlExtension:false,namespace:false,queue:false,response:false,httpFunctions:0},
      cron:{version:null,useBackgroundWorkers:null,jobTable:false}},inventory:{rows:[observer,
        {...observer,pid:101,application:'owned-synthetic-old-call',queryStart:earlier,xactStart:earlier,targetRelationLocks:1}]}};
};

test('cold committed-state observer is fixed READ ONLY and observes the plain catalog, original230 raw ledger and absent maintenance slots',async()=>{
  const source=createAmoraWriterRetirementSourceRepository();
  try {
    const {buildAmoraWriterRetirementCommittedObservationSql}=await import('../lib/amora-action-writer-retirement-post-commit-verifier.mjs');
    const expectedObjectIds={functionId:112349,triggerIds:[112350,112351]};
    const sql=buildAmoraWriterRetirementCommittedObservationSql({repoRoot:source.root,cutoff:null,expectedNativeSystemIdentifier:null,expectedObjectIds});
    assert.match(sql,/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
    assert.match(sql,/predecessorRawLedgerSha256/);
    assert.match(sql,/version <> '20261013003000'/);
    assert.match(sql,/maintenanceSlots/);
    assert.match(sql,/applied7DefinitionHashes/);
    assert.match(sql,/managed_inventory/);
    assert.match(sql,/serverCutoff/);
    assert.match(sql,/p\.oid=112349/);assert.match(sql,/t\.oid IN \(112350,112351\)/);assert.match(sql,/t\.tgfoid=112349/);
    assert.match(sql,/COMMIT;\s*$/);
    assert.doesNotMatch(sql,/DROP |CREATE |ALTER |REVOKE |GRANT |INSERT INTO |UPDATE public\./i);
    assert.throws(()=>buildAmoraWriterRetirementCommittedObservationSql({repoRoot:source.root,cutoff:null,expectedNativeSystemIdentifier:null,expectedObjectIds,query:'SELECT 1'}));
  } finally {source.close();}
});

test('owned PG17 cold after231 validates exact actual applied7/ACL and unchanged historical rows without reviving expired before observation',
  {timeout:120_000,skip:process.platform!=='win32'},async()=>{
    const module=await import('../lib/amora-action-writer-retirement-post-commit-verifier.mjs');
    assert.equal(typeof module.validateAmoraWriterRetirementCommittedObservation,'function');
    const source=createAmoraWriterRetirementSourceRepository(),f=await createAmoraWriterRetirementRecoveryNativeDatabase();
    const results=async sql=>{
      const result=await f.db.query(sql);return (Array.isArray(result)?result:[result]).flatMap(entry=>entry.rows??[]);
    };
    try {
      const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
      const captureRows=await results(buildAmoraWriterRetirementRecoveryCaptureSql({repoRoot:source.root,
        expectedCommit:'1'.repeat(40),collectorSourceSha256:'2'.repeat(64),expectedNativeSystemIdentifier:id}));
      const historical=captureRows.find(row=>row.b2_original7_capsule).b2_original7_capsule;
      const originalCapturedAt=historical.capturedAt;
      await f.exec(buildAmoraWriterMaintenanceInstallSql({expectedNativeSystemIdentifier:id}));
      const functionId=(await f.db.query("SELECT 'public.deny_amora_action_writer_retirement_maintenance_v1()'::regprocedure::oid::int AS oid")).rows[0].oid;
      const triggerIds=(await f.db.query('SELECT oid::int AS oid FROM pg_trigger WHERE tgfoid=$1 ORDER BY oid',[functionId])).rows.map(row=>row.oid);
      const expectedObjectIds={functionId,triggerIds};
      await f.exec(buildAmoraWriterRetirementBundle(source.root).sql);
      const plan=loadAmoraWriterRetirementPlan({repoRoot:source.root,mode:AMORA_WRITER_RETIREMENT_MODE});
      await f.db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',
        [plan.migration.version,plan.migration.name,[plan.migration.sql]]);
      await f.exec(`CREATE SCHEMA owned_cold_post_moved;
        ALTER FUNCTION public.deny_amora_action_writer_retirement_maintenance_v1() SET SCHEMA owned_cold_post_moved;
        ALTER FUNCTION owned_cold_post_moved.deny_amora_action_writer_retirement_maintenance_v1() RENAME TO renamed_owned_deny;
        ALTER TRIGGER deny_amora_actions_writer_retirement_maintenance_v1 ON public.amora_actions RENAME TO renamed_owned_action_deny;
        ALTER TRIGGER deny_wedding_journeys_writer_retirement_maintenance_v1 ON public.wedding_journeys RENAME TO renamed_owned_journey_deny;`);
      const movedPacket=(await results(module.buildAmoraWriterRetirementCommittedObservationSql({repoRoot:source.root,
        cutoff:null,expectedNativeSystemIdentifier:id,expectedObjectIds}))).filter(row=>Object.hasOwn(row,'b2_committed_observation'));
      assert.deepEqual(movedPacket[0].b2_committed_observation.maintenanceSlots,{functions:[functionId],triggers:triggerIds},
        'all namespaces and preserved object IDs catch renamed or schema-moved maintenance');
      assert.throws(()=>module.validateAmoraWriterRetirementCommittedObservation(movedPacket,{repoRoot:source.root,historical,
        cutoff:null,expectedNativeSystemIdentifier:id}),/MAINTENANCE_NOT_ABSENT/);
      await f.exec(`DROP TRIGGER renamed_owned_action_deny ON public.amora_actions;
        DROP TRIGGER renamed_owned_journey_deny ON public.wedding_journeys;
        DROP FUNCTION owned_cold_post_moved.renamed_owned_deny(); DROP SCHEMA owned_cold_post_moved;`);
      const packet=(await results(module.buildAmoraWriterRetirementCommittedObservationSql({repoRoot:source.root,
        cutoff:null,expectedNativeSystemIdentifier:id,expectedObjectIds}))).filter(row=>Object.hasOwn(row,'b2_committed_observation'));
      const options={repoRoot:source.root,historical,cutoff:null,expectedNativeSystemIdentifier:id};
      const proof=module.validateAmoraWriterRetirementCommittedObservation(packet,options);
      assert.equal(proof.releaseAuthorized,false);assert.equal(proof.executionProvenanceVerified,false);
      assert.equal(proof.ledgerCount,231);assert.equal(proof.own3Absent,true);
      assert.equal(historical.capturedAt,originalCapturedAt,'historical timestamps are not rewritten');
      const cutoff=proof.serverCutoff;
      await delay(11010);
      const laterPacket=(await results(module.buildAmoraWriterRetirementCommittedObservationSql({repoRoot:source.root,
        cutoff,expectedNativeSystemIdentifier:id,expectedObjectIds}))).filter(row=>Object.hasOwn(row,'b2_committed_observation'));
      assert.equal(module.validateAmoraWriterRetirementCommittedObservation(laterPacket,{...options,cutoff}).serverCutoff,cutoff,
        'a real later observer retains the original server cutoff for its whole120s window');
      for(const mutation of ['raw230','rows','catalog','own3','definition','frame','unknownWorker']){
        const bad=structuredClone(packet),raw=bad[0].b2_committed_observation;
        if(mutation==='raw230')raw.predecessorRawLedgerSha256='0'.repeat(64);
        if(mutation==='rows')raw.catalog.rows.amoraActionsCount++;
        if(mutation==='catalog')raw.catalog.preservedCatalogSha256='0'.repeat(64);
        if(mutation==='own3')raw.maintenanceSlots.functions=[112349];
        if(mutation==='definition')raw.applied7DefinitionHashes[0][1]='0'.repeat(64);
        if(mutation==='frame')raw.frameAfter.observerPid++;
        if(mutation==='unknownWorker')raw.managed.inventory.rows.find(row=>row.database==='postgres').state=null;
        assert.throws(()=>module.validateAmoraWriterRetirementCommittedObservation(bad,options),mutation);
      }
      for(const mutation of ['serviceUpdate','columnUpdate','oldV2','oldObservation','defaultExecute']){
        const bad=structuredClone(laterPacket),raw=bad[0].b2_committed_observation;
        const canonical=raw.catalog.privileges.tables.find(row=>row.name==='amora_actions');
        if(mutation==='serviceUpdate')canonical.effective.find(row=>row.role==='service_role').table.find(row=>row[0]==='UPDATE')[1]=true;
        if(mutation==='columnUpdate')canonical.effective.find(row=>row.role==='service_role').columns[0][1]=true;
        if(mutation==='oldV2')raw.catalog.privileges.functions.find(row=>row.identity==='public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)').bodyMd5='0'.repeat(32);
        if(mutation==='oldObservation')raw.catalog.privileges.observedAt=new Date(Date.now()-121000).toISOString();
        if(mutation==='defaultExecute')raw.catalog.privileges.functionDefaults.push({owner:'postgres',schema:'public',rawAcl:['writer=X/postgres'],acl:[['unknown_writer','postgres','EXECUTE',false]]});
        assert.throws(()=>module.validateAmoraWriterRetirementCommittedObservation(bad,{...options,cutoff}),mutation);
      }
      const beforeTime=new Date(Date.now()-121_000).toISOString();
      const archiveOnly={...historical,capturedAt:beforeTime};
      assert.equal(module.validateAmoraWriterRetirementCommittedObservation(packet,{...options,historical:archiveOnly}).releaseAuthorized,false,
        'historical content age is not issued fresh authority');
    } finally {await f.close();source.close();}
  });

test('cold read-only cohort preserves old client lifetime and requires observed natural drain, never an absent-fence shortcut',async()=>{
  const module=await import('../lib/amora-action-writer-retirement-post-commit-verifier.mjs');
  const raw=inventory(),cutoff=raw.observedAt,options={expectedNativeSystemIdentifier:nativeSystem};
  const initiallyLocked=structuredClone(raw);initiallyLocked.inventory.rows[0].advisoryLocks=1;
  assert.throws(()=>module.createAmoraWriterRetirementCommittedCohort(initiallyLocked,{cutoff,...options}),/DRAIN_REQUIRED/);
  const cohort=module.createAmoraWriterRetirementCommittedCohort(raw,{cutoff,...options});
  assert.equal(cohort.members.length,1);
  assert.equal(cohort.releaseAuthorized,false);
  assert.equal(cohort.drainVerified,false);
  assert.throws(()=>module.assertAmoraWriterRetirementCommittedDrained(raw,cohort,options),/DRAIN_REQUIRED/);
  const idle=structuredClone(raw);Object.assign(idle.inventory.rows[1],{state:'idle',xactStart:null,targetRelationLocks:0});
  const proof=module.assertAmoraWriterRetirementCommittedDrained(idle,cohort,options);
  assert.equal(proof.releaseAuthorized,false);assert.equal(proof.executionProvenanceVerified,false);
  const late=structuredClone(idle);late.inventory.rows.push({...late.inventory.rows[1],pid:102});
  assert.throws(()=>module.assertAmoraWriterRetirementCommittedDrained(late,cohort,options),/LATE_COHORT/);
  assert.throws(()=>module.assertAmoraWriterRetirementCommittedDrained(idle,structuredClone(cohort),options),/COHORT_NOT_ISSUED/);
});

test('a pooled observer cannot hide a pre-cutoff member session advisory lock or old transaction',async()=>{
  const module=await import('../lib/amora-action-writer-retirement-post-commit-verifier.mjs');
  const raw=inventory(),cutoff=raw.observedAt,options={expectedNativeSystemIdentifier:nativeSystem};
  const cohort=module.createAmoraWriterRetirementCommittedCohort(raw,{cutoff,...options});
  const reused=structuredClone(raw);
  reused.observerPid=101;
  reused.inventory.rows=reused.inventory.rows.filter(row=>row.pid===101);
  Object.assign(reused.inventory.rows[0],{state:'active',queryStart:new Date().toISOString(),
    xactStart:new Date().toISOString(),targetRelationLocks:1,advisoryLocks:1});
  assert.throws(()=>module.assertAmoraWriterRetirementCommittedDrained(reused,cohort,options),/DRAIN_REQUIRED/,
    'being the current read-only observer is not evidence that old session locks drained');
  const oldTransaction=structuredClone(reused);
  oldTransaction.inventory.rows[0].advisoryLocks=0;
  oldTransaction.inventory.rows[0].xactStart=raw.inventory.rows[1].xactStart;
  assert.throws(()=>module.assertAmoraWriterRetirementCommittedDrained(oldTransaction,cohort,options),/DRAIN_REQUIRED/);
  const cleanObserver=structuredClone(reused);
  cleanObserver.inventory.rows[0].advisoryLocks=0;
  cleanObserver.inventory.rows[0].xactStart=new Date(Date.parse(cutoff)+1).toISOString();
  assert.equal(module.assertAmoraWriterRetirementCommittedDrained(cleanObserver,cohort,options).releaseAuthorized,false);
  const unknownLifetime=structuredClone(cleanObserver);
  unknownLifetime.inventory.rows[0].backendStart=new Date(Date.parse(cutoff)-3000).toISOString();
  assert.throws(()=>module.assertAmoraWriterRetirementCommittedDrained(unknownLifetime,cohort,options),/BACKEND_LIFETIME_UNKNOWN/,
    'a reused observer must pass the same original backend-lifetime check as every other member');
});

test('cold default verification accepts no supplied SQL, clock, evidence, object IDs or JSON completion authority and sends nothing for invalid arguments',async()=>{
  const module=await import('../lib/amora-action-writer-retirement-post-commit-verifier.mjs');
  assert.equal(typeof module.runAmoraWriterRetirementPostCommitVerification,'function');
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('No HTTP should be sent for rejected input');};
  const base={repoRoot:'not-a-repo',expectedCommit:'a'.repeat(40),archiveSourceCommit:'68f9d94a3263ef922f2aabbde7541fb85b37853e',
    recoveryId:'82fabbd4-0df5-4a14-b21f-e159553c97e1',expectedArtifactSha256:'b'.repeat(64),
    operatorConfirmation:`amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:verify-committed:${'a'.repeat(40)}`};
  try {
    for(const extra of ['query','now','before','verified','expectedObjectIds','nativeId'])
      await assert.rejects(module.runAmoraWriterRetirementPostCommitVerification({...base,[extra]:true}),/ARGUMENT_INVALID/);
    await assert.rejects(module.assertAmoraWriterRetirementIssuedPostCommitVerification({proof:{format:'amora-writer-retirement-issued-cold-postverified-v1',releaseAuthorized:true},
      repoRoot:base.repoRoot,expectedCommit:base.expectedCommit}),/COMPLETE_NOT_ISSUED/);
    assert.throws(()=>module.disposeAmoraWriterRetirementPostCommitVerification({proof:{format:'amora-writer-retirement-issued-cold-postverified-v1'},
      repoRoot:base.repoRoot,expectedCommit:base.expectedCommit}),/COMPLETE_NOT_ISSUED/);
    await assert.rejects(module.runAmoraWriterRetirementPostCommitVerification(base),error=>{
      assert.equal(error.code,'AMORA_WRITER_POST_SOURCE_UNAVAILABLE');
      assert.equal(error.message,'AMORA_WRITER_POST_SOURCE_UNAVAILABLE');return true;
    });
    assert.equal(calls,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('unknown activity, old transactions, locks, PID-lifetime reuse and expired cutoff never become a drained cold cohort',async()=>{
  const module=await import('../lib/amora-action-writer-retirement-post-commit-verifier.mjs');
  const raw=inventory(),options={expectedNativeSystemIdentifier:nativeSystem};
  const cohort=module.createAmoraWriterRetirementCommittedCohort(raw,{cutoff:raw.observedAt,...options});
  const idle=structuredClone(raw);Object.assign(idle.inventory.rows[1],{state:'idle',xactStart:null,targetRelationLocks:0});
  for(const edit of [value=>{value.statsVisible=false;},value=>{value.inventory.rows[1].state=null;},
    value=>{value.inventory.rows[1].xactStart=raw.observedAt;},value=>{value.inventory.rows[1].advisoryLocks=1;},
    value=>{value.inventory.rows[1].targetRelationLocks=1;},value=>{value.inventory.rows[1].blockers=[100];},
    value=>{value.inventory.rows[1].backendStart=new Date(Date.parse(raw.observedAt)-3000).toISOString();},
    value=>{value.observedAt=new Date(Date.now()-121000).toISOString();}]){
    const bad=structuredClone(idle);edit(bad);
    assert.throws(()=>module.assertAmoraWriterRetirementCommittedDrained(bad,cohort,options));
  }
  assert.throws(()=>module.createAmoraWriterRetirementCommittedCohort(raw,{cutoff:new Date(Date.now()-121000).toISOString(),...options}),/CUTOFF_EXPIRED/);
  const disappeared=structuredClone(idle);disappeared.inventory.rows.pop();
  assert.equal(module.assertAmoraWriterRetirementCommittedDrained(disappeared,cohort,options).releaseAuthorized,false);
  const reused=structuredClone(idle),later=new Date(Date.parse(raw.observedAt)+1).toISOString();
  Object.assign(reused.inventory.rows[1],{backendStart:later,queryStart:later});
  assert.equal(module.assertAmoraWriterRetirementCommittedDrained(reused,cohort,options).releaseAuthorized,false,
    'only an actually newer backend lifetime is a safe PID reuse');
});
