import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmoraWriterRetirementRecoveryNativeDatabase} from './fixtures/amora-action-writer-retirement-recovery-native.mjs';
import {createAmoraWriterRetirementSourceRepository} from './fixtures/amora-action-writer-retirement-source-repository.mjs';
import {buildAmoraWriterMaintenanceInstallSql} from '../lib/amora-action-writer-retirement-maintenance.mjs';
import {buildAmoraWriterRetirementObservationSql} from '../lib/amora-action-writer-retirement-catalog.mjs';
import {buildAmoraWriterRetirementStageObservationSql,validateAmoraWriterRetirementStageObservation} from '../lib/amora-action-writer-retirement-stage.mjs';

const options={timeout:60_000,skip:process.platform!=='win32'};
const rows=async(client,sql)=>{
  const value=await client.query(sql);return (Array.isArray(value)?value:[value]).flatMap(entry=>entry.rows??[]);
};
test('actual owned PG17 one READ ONLY TX binds catalog/own3/complete inventory and removes only independently pinned maintenance slots from the plain230 baseline',options,async()=>{
  const source=createAmoraWriterRetirementSourceRepository(),f=await createAmoraWriterRetirementRecoveryNativeDatabase();
  try{
    const raw=(await rows(f.db,buildAmoraWriterRetirementObservationSql({repoRoot:source.root,phase:'before'}))).find(row=>row.b2_observation).b2_observation;
    const system=raw.privileges.systemIdentifier;
    await f.exec(buildAmoraWriterMaintenanceInstallSql({expectedNativeSystemIdentifier:system}));
    const nativeResults=await rows(f.db,buildAmoraWriterRetirementStageObservationSql({repoRoot:source.root,phase:'before',cutoff:null,expectedNativeSystemIdentifier:system}));
    // Management returns only the final SELECT, not native pg's intermediate clear-snapshot row.
    const packet=nativeResults.filter(row=>Object.hasOwn(row,'b2_stage_observation'));
    const input={repoRoot:source.root,phase:'before',cutoff:null,expectedNativeSystemIdentifier:system,beforeObservation:raw,expectedObjectIds:null};
    const checked=validateAmoraWriterRetirementStageObservation(packet,input);
    assert.equal(checked.executionProvenanceVerified,false);assert.equal(checked.releaseAuthorized,false);
    assert.equal(checked.projectedPreservedCatalogSha256,raw.preservedCatalogSha256);
    assert.notEqual(checked.rawPreservedCatalogSha256,checked.projectedPreservedCatalogSha256);
    assert.deepEqual(checked.catalog.rows,raw.rows);assert.deepEqual(checked.catalog.ledger,raw.ledger);
    for(const mutation of ['body','oid','frame','unknownWorker','extraTrigger']){
      const bad=structuredClone(packet);
      if(mutation==='body')bad[0].b2_stage_observation.maintenance.functions[0].bodySha256='0'.repeat(64);
      if(mutation==='oid')bad[0].b2_stage_observation.maintenance.triggers[0].functionId++;
      if(mutation==='frame')bad[0].b2_stage_observation.frameAfter.observerPid++;
      if(mutation==='unknownWorker')bad[0].b2_stage_observation.managed.inventory.rows.find(row=>row.database==='postgres').state=null;
      if(mutation==='extraTrigger')bad[0].b2_stage_observation.catalog.privileges.tables[0].triggers.push({name:'unknown-unapproved-trigger'});
      assert.throws(()=>validateAmoraWriterRetirementStageObservation(bad,input));
    }
    assert.equal(packet.length,1,'Final provider SELECT alone contains the complete packet');
    assert.throws(()=>validateAmoraWriterRetirementStageObservation([{b2_stage_frame_after:packet[0].b2_stage_observation.frameAfter}],input),/RESPONSE_INVALID/);
  }finally{await f.close();source.close();}
});
