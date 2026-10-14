import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmoraWriterRetirementRecoveryNativeDatabase} from './fixtures/amora-action-writer-retirement-recovery-native.mjs';
import {createAmoraWriterRetirementSourceRepository} from './fixtures/amora-action-writer-retirement-source-repository.mjs';
import {buildAmoraWriterMaintenanceInstallSql} from '../lib/amora-action-writer-retirement-maintenance.mjs';
import {buildAmoraWriterRetirementObservationSql} from '../lib/amora-action-writer-retirement-catalog.mjs';
import {buildAmoraWriterRetirementStageObservationSql,validateAmoraWriterRetirementStageObservation} from '../lib/amora-action-writer-retirement-stage.mjs';
import {buildAmoraWriterRetirementCommitSql} from '../lib/amora-action-writer-retirement-transaction.mjs';

const options={timeout:60_000,skip:process.platform!=='win32'};
const rows=async(client,sql)=>{const value=await client.query(sql);return(Array.isArray(value)?value:[value]).flatMap(entry=>entry.rows??[]);};
async function setup(){
  const source=createAmoraWriterRetirementSourceRepository(),f=await createAmoraWriterRetirementRecoveryNativeDatabase();
  const before=(await rows(f.db,buildAmoraWriterRetirementObservationSql({repoRoot:source.root,phase:'before'}))).find(row=>row.b2_observation).b2_observation;
  const system=before.privileges.systemIdentifier;
  await f.exec(buildAmoraWriterMaintenanceInstallSql({expectedNativeSystemIdentifier:system}));
  const packet=(await rows(f.db,buildAmoraWriterRetirementStageObservationSql({repoRoot:source.root,phase:'before',cutoff:null,expectedNativeSystemIdentifier:system}))).filter(row=>row.b2_stage_observation);
  const stage=validateAmoraWriterRetirementStageObservation(packet,{repoRoot:source.root,phase:'before',cutoff:null,
    expectedNativeSystemIdentifier:system,beforeObservation:before,expectedObjectIds:null});
  return {source,f,before,system,packet,stage};
}
test('actual owned PG17 commit binds raw fenced catalog and own3 OIDs while plain projected baseline remains exact; separate post7/raw231 stage verifies',options,async()=>{
  const {source,f,before,system,packet,stage}=await setup();let independent;
  try{
    const sql=buildAmoraWriterRetirementCommitSql({repoRoot:source.root,before,stageRows:packet,objectIds:stage.objectIds,
      deadline:new Date(Date.now()+120_000).toISOString(),expectedNativeSystemIdentifier:system});
    assert.equal(sql.endsWith('\nCOMMIT;'),true);
    const inside=(await rows(f.db,sql)).find(row=>row.b2_commit_evidence)?.b2_commit_evidence;
    assert.equal(inside.format,'amora-writer-retirement-original7-commit-inside-v1');
    independent=await f.newSession();
    const afterPacket=(await rows(independent,buildAmoraWriterRetirementStageObservationSql({repoRoot:source.root,phase:'after',cutoff:null,expectedNativeSystemIdentifier:system}))).filter(row=>row.b2_stage_observation);
    const after=validateAmoraWriterRetirementStageObservation(afterPacket,{repoRoot:source.root,phase:'after',cutoff:null,
      expectedNativeSystemIdentifier:system,beforeObservation:before,expectedObjectIds:stage.objectIds});
    assert.equal(after.catalog.ledger.length,231);assert.deepEqual(after.catalog.rows,before.rows);
    assert.equal(after.projectedPreservedCatalogSha256,before.preservedCatalogSha256);
    assert.equal(after.rawPreservedCatalogSha256,stage.rawPreservedCatalogSha256);
    assert.equal(after.releaseAuthorized,false,'Pure native/content post validation is not default operating authority');
  }finally{await independent?.end();await f.db.query('ROLLBACK').catch(()=>{});await f.close();source.close();}
});
test('actual owned PG17 identical-body replaced own3 OIDs after stage cannot be treated as the same maintenance lifetime or commit any bundle',options,async()=>{
  const {source,f,before,system,packet,stage}=await setup();
  try{
    const definition=(await f.db.query("SELECT pg_get_functiondef('public.deny_amora_action_writer_retirement_maintenance_v1()'::regprocedure) AS value")).rows[0].value;
    await f.exec(`DROP TRIGGER deny_amora_actions_writer_retirement_maintenance_v1 ON public.amora_actions;
      DROP TRIGGER deny_wedding_journeys_writer_retirement_maintenance_v1 ON public.wedding_journeys;
      DROP FUNCTION public.deny_amora_action_writer_retirement_maintenance_v1();
      ${definition}; REVOKE ALL ON FUNCTION public.deny_amora_action_writer_retirement_maintenance_v1() FROM PUBLIC,anon,authenticated,service_role;
      CREATE TRIGGER deny_amora_actions_writer_retirement_maintenance_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.amora_actions FOR EACH STATEMENT EXECUTE FUNCTION public.deny_amora_action_writer_retirement_maintenance_v1();
      CREATE TRIGGER deny_wedding_journeys_writer_retirement_maintenance_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.wedding_journeys FOR EACH STATEMENT EXECUTE FUNCTION public.deny_amora_action_writer_retirement_maintenance_v1();`);
    const sql=buildAmoraWriterRetirementCommitSql({repoRoot:source.root,before,stageRows:packet,objectIds:stage.objectIds,
      deadline:new Date(Date.now()+120_000).toISOString(),expectedNativeSystemIdentifier:system});
    await assert.rejects(f.db.query(sql),error=>error.message==='AMORA_WRITER_TRANSACTION_MAINTENANCE_LIFETIME_DRIFT');
    await f.db.query('ROLLBACK');
    assert.equal((await f.db.query('SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations')).rows[0].count,230);
  }finally{await f.db.query('ROLLBACK').catch(()=>{});await f.close();source.close();}
});
