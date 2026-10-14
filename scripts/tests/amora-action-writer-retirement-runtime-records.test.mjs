import test from 'node:test';
import assert from 'node:assert/strict';
import {amoraWriterRetirementRehearsalRecordTransport} from '../lib/amora-action-writer-retirement-operational-rehearsal.mjs';

test('rollback response and unknown outcome retain actual Management=false/SQLwrite flags, not readonly flags',()=>{
  for(const status of ['rehearsal-intent','rollback-response-validated','rehearsal-outcome-requires-inspection'])
    assert.deepEqual(amoraWriterRetirementRehearsalRecordTransport(status),{transportReadOnlyFlag:false,sqlReadOnly:false});
  assert.deepEqual(amoraWriterRetirementRehearsalRecordTransport('rehearsed-and-independently-rolled-back-original7'),
    {transportReadOnlyFlag:true,sqlReadOnly:true});
  assert.deepEqual(amoraWriterRetirementRehearsalRecordTransport('blocked-before-transaction'),
    {transportReadOnlyFlag:null,sqlReadOnly:null});
  assert.throws(()=>amoraWriterRetirementRehearsalRecordTransport('operator-supplied-status'),/RECORD_OPERATION_INVALID/);
});
