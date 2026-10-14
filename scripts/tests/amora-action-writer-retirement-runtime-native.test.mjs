import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createAmoraWriterRetirementRecoveryNativeDatabase} from './fixtures/amora-action-writer-retirement-recovery-native.mjs';
import {nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';
import {buildAmoraWriterRetirementObservationSql,validateAmoraWriterRetirementObservation} from '../lib/amora-action-writer-retirement-catalog.mjs';
import {buildAmoraWriterRetirementRecoveryCaptureSql,validateAmoraWriterRetirementRecoveryCapsule} from '../lib/amora-action-writer-retirement-recovery.mjs';
import {runAmoraWriterRetirementNativeSourceRecovery} from '../lib/amora-action-writer-retirement-native-recovery.mjs';
import {buildAmoraWriterRetirementRehearsalSql,validateAmoraWriterRetirementRehearsalInside,
  buildAmoraWriterRetirementCommitSql,validateAmoraWriterRetirementCommitInside} from '../lib/amora-action-writer-retirement-transaction.mjs';
import {buildAmoraWriterRetirementStageObservationSql,validateAmoraWriterRetirementStageObservation} from '../lib/amora-action-writer-retirement-stage.mjs';
import {buildAmoraWriterManagedMaintenanceInstallSql,buildAmoraWriterManagedMaintenanceCutoffSql,
  buildAmoraWriterManagedMaintenanceUninstallSql} from '../lib/amora-action-writer-retirement-managed-maintenance.mjs';
import {createAmoraWriterMaintenanceCohort,assertAmoraWriterMaintenanceDrained} from '../lib/amora-action-writer-retirement-maintenance.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url)),commit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';
const options={timeout:120_000,skip:process.platform!=='win32'&&!nativeProfileRoleAvailable};
const sha=value=>createHash('sha256').update(value).digest('hex');
const all=async(client,sql)=>{const result=await client.query(sql);return(Array.isArray(result)?result:[result]).flatMap(value=>value.rows??[]);};
const selected=async(client,sql,alias)=>{
  const values=(await all(client,sql)).filter(row=>Object.hasOwn(row,alias));assert.equal(values.length,1);return values;
};
async function original(f){
  const raw=(await selected(f.db,buildAmoraWriterRetirementObservationSql({repoRoot,phase:'before'}),'b2_observation'))[0].b2_observation;
  const system=raw.privileges.systemIdentifier;
  validateAmoraWriterRetirementObservation(raw,{repoRoot,phase:'before',expectedNativeSystemIdentifier:system,beforeObservation:null});
  return {before:raw,system};
}
async function stage(f,{before,system},phase,cutoff=null,objectIds=null,client=f.db){
  const packet=await selected(client,buildAmoraWriterRetirementStageObservationSql({repoRoot,phase,cutoff,expectedNativeSystemIdentifier:system}),'b2_stage_observation');
  const value=validateAmoraWriterRetirementStageObservation(packet,{repoRoot,phase,cutoff,expectedNativeSystemIdentifier:system,
    beforeObservation:before,expectedObjectIds:objectIds});return {packet,value};
}
async function apply(f,baseline,deadline,{discardNativeResponse=false}={}){
  const install=(await selected(f.db,buildAmoraWriterManagedMaintenanceInstallSql({expectedNativeSystemIdentifier:baseline.system}),
    'managed_maintenance_operation'))[0].managed_maintenance_operation;
  assert.equal(install.own3Installed,true);assert.equal(install.releaseAuthorized,false);
  const beforeStage=await stage(f,baseline,'before');
  const sql=buildAmoraWriterRetirementCommitSql({repoRoot,before:baseline.before,stageRows:beforeStage.packet,
    objectIds:beforeStage.value.objectIds,deadline,expectedNativeSystemIdentifier:baseline.system});
  const response=await selected(f.db,sql,'b2_commit_evidence');
  if(!discardNativeResponse)validateAmoraWriterRetirementCommitInside(response,{repoRoot,before:{...beforeStage.value.catalog,
    preservedCatalogSha256:beforeStage.value.rawPreservedCatalogSha256}});
  return beforeStage;
}

test('actual native source-only full original7 capture/replay + ROLLBACK + own3/singleCOMMIT + independentpost7/231 + serverC/cohort/drain/remove + plainstrict; no operating provenance is issued',options,async()=>{
  const f=await createAmoraWriterRetirementRecoveryNativeDatabase();let independent,bytes;
  try{
    const baseline=await original(f),collector=sha(readFileSync(new URL(import.meta.url)));
    const capsule=(await selected(f.db,buildAmoraWriterRetirementRecoveryCaptureSql({repoRoot,expectedCommit:commit,
      collectorSourceSha256:collector,expectedNativeSystemIdentifier:baseline.system}),'b2_original7_capsule'))[0].b2_original7_capsule;
    bytes=Buffer.from(JSON.stringify(capsule));
    // Bind to the actual capture's existing lifetime; a later local clock must never extend it.
    const deadline=new Date(Math.min(Date.now()+120_000,Date.parse(capsule.capturedAt)+120_000)).toISOString();
    const staleBytes=Buffer.from(JSON.stringify({...capsule,capturedAt:new Date(Date.now()-121_000).toISOString()}));
    try{
      assert.throws(()=>validateAmoraWriterRetirementRecoveryCapsule({repoRoot,bytes:staleBytes,
        expectedArtifactSha256:sha(staleBytes),expectedCommit:commit,expectedCollectorSha256:collector,
        deadline,expectedNativeSystemIdentifier:baseline.system}),/RECOVERY_EXPIRED/);
    }finally{staleBytes.fill(0);}
    const content=validateAmoraWriterRetirementRecoveryCapsule({repoRoot,bytes,expectedArtifactSha256:sha(bytes),expectedCommit:commit,
      expectedCollectorSha256:collector,deadline,expectedNativeSystemIdentifier:baseline.system});
    const native=await runAmoraWriterRetirementNativeSourceRecovery({repoRoot,bytes,contentReceipt:content,expectedCommit:commit,
      expectedCollectorSha256:collector,deadline});
    assert.equal(native.releaseAuthorized,false);assert.equal(native.privateOriginalLinked,false);
    const rehearsal=buildAmoraWriterRetirementRehearsalSql({repoRoot,before:baseline.before,deadline,expectedNativeSystemIdentifier:baseline.system});
    validateAmoraWriterRetirementRehearsalInside(await selected(f.db,rehearsal,'b2_rehearsal_evidence'),{repoRoot,before:baseline.before});
    independent=await f.newSession();
    const fresh=(await selected(independent,buildAmoraWriterRetirementObservationSql({repoRoot,phase:'before'}),'b2_observation'))[0].b2_observation;
    for(const key of ['rows','ledger','rawLedgerSha256','preservedCatalogSha256'])assert.deepEqual(fresh[key],baseline.before[key]);
    const installed=await apply(f,baseline,deadline),post=await stage(f,baseline,'after',null,installed.value.objectIds,independent);
    assert.equal(post.value.catalog.ledger.length,231);assert.equal(post.value.releaseAuthorized,false);
    const cutoff=(await selected(f.db,buildAmoraWriterManagedMaintenanceCutoffSql({repoRoot,postLedgerMd5:post.value.catalog.rawLedgerMd5,
      objectIds:post.value.objectIds,expectedNativeSystemIdentifier:baseline.system}),'maintenance_cutoff'))[0].maintenance_cutoff;
    assert.equal(cutoff.executionProvenanceVerified,false);
    const current=await stage(f,baseline,'after',cutoff.cutoff,post.value.objectIds);
    const cohort=createAmoraWriterMaintenanceCohort(current.value.projectedMaintenance,{expectedNativeSystemIdentifier:baseline.system});
    assertAmoraWriterMaintenanceDrained(current.value.projectedMaintenance,cohort,{expectedNativeSystemIdentifier:baseline.system});
    const removed=(await selected(f.db,buildAmoraWriterManagedMaintenanceUninstallSql({repoRoot,postLedgerMd5:post.value.catalog.rawLedgerMd5,
      cohort,expectedNativeSystemIdentifier:baseline.system}),'managed_maintenance_operation'))[0].managed_maintenance_operation;
    assert.equal(removed.own3Absent,true);assert.equal(removed.releaseAuthorized,false);
    const final=(await selected(independent,buildAmoraWriterRetirementObservationSql({repoRoot,phase:'after'}),'b2_observation'))[0].b2_observation;
    validateAmoraWriterRetirementObservation(final,{repoRoot,phase:'after',expectedNativeSystemIdentifier:baseline.system,beforeObservation:baseline.before});
    assert.equal(final.rawLedgerSha256,post.value.catalog.rawLedgerSha256);assert.deepEqual(final.rows,baseline.before.rows);
    assert.equal(final.preservedCatalogSha256,baseline.before.preservedCatalogSha256);
  }finally{bytes?.fill(0);await independent?.end();await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
});

test('native-only simulated postCOMMIT response discard issues no operating proof; independent readonly sees231 with fence retained, active/aborted cohort cannot be unfenced',options,async()=>{
  const f=await createAmoraWriterRetirementRecoveryNativeDatabase();let blocker;
  try{
    const baseline=await original(f),deadline=new Date(Date.now()+120_000).toISOString();
    const installed=await apply(f,baseline,deadline,{discardNativeResponse:true});
    // This local response-discard scenario is not a provider transport-loss test or default runtime authority.
    const post=await stage(f,baseline,'after',null,installed.value.objectIds);
    assert.equal(post.value.catalog.ledger.length,231);assert.equal(post.value.releaseAuthorized,false);
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname='deny_amora_action_writer_retirement_maintenance_v1'")).rows[0].n,1);
    blocker=await f.newSession();await blocker.query('BEGIN');await blocker.query('SELECT id FROM public.couples FOR SHARE');
    const cutoff=(await selected(f.db,buildAmoraWriterManagedMaintenanceCutoffSql({repoRoot,postLedgerMd5:post.value.catalog.rawLedgerMd5,
      objectIds:post.value.objectIds,expectedNativeSystemIdentifier:baseline.system}),'maintenance_cutoff'))[0].maintenance_cutoff;
    const current=await stage(f,baseline,'after',cutoff.cutoff,post.value.objectIds);
    const cohort=createAmoraWriterMaintenanceCohort(current.value.projectedMaintenance,{expectedNativeSystemIdentifier:baseline.system});
    assert.throws(()=>assertAmoraWriterMaintenanceDrained(current.value.projectedMaintenance,cohort,{expectedNativeSystemIdentifier:baseline.system}),/DRAIN_REQUIRED/);
    await assert.rejects(f.db.query(buildAmoraWriterManagedMaintenanceUninstallSql({repoRoot,postLedgerMd5:post.value.catalog.rawLedgerMd5,
      cohort,expectedNativeSystemIdentifier:baseline.system})),error=>error.message==='AMORA_MAINTENANCE_DRAIN_REQUIRED');
    await f.db.query('ROLLBACK');assert.equal((await f.db.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,231);
    await assert.rejects(blocker.query('SELECT 1/0'));const aborted=await stage(f,baseline,'after',cutoff.cutoff,post.value.objectIds);
    assert.throws(()=>assertAmoraWriterMaintenanceDrained(aborted.value.projectedMaintenance,cohort,{expectedNativeSystemIdentifier:baseline.system}),/DRAIN_REQUIRED/);
    await blocker.query('ROLLBACK');
    const drained=await stage(f,baseline,'after',cutoff.cutoff,post.value.objectIds);
    assertAmoraWriterMaintenanceDrained(drained.value.projectedMaintenance,cohort,{expectedNativeSystemIdentifier:baseline.system});
  }finally{await blocker?.query('ROLLBACK').catch(()=>{});await blocker?.end();await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
});
