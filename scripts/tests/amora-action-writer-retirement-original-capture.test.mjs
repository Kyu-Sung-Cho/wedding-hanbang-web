import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureAmoraWriterRetirementPrivateOriginal,readAmoraWriterRetirementPrivateOriginal} from '../lib/amora-action-writer-retirement-original-capture.mjs';
import {assertAmoraWriterRetirementAdmission} from '../lib/amora-action-writer-retirement-admission.mjs';
import {assertAmoraWriterRetirementPrivateStoreIssued} from '../lib/amora-action-writer-retirement-private-store.mjs';
import {readAmoraWriterRetirementRecoveryCapsule} from '../lib/amora-action-writer-retirement-recovery.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url)),expectedCommit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';

test('actual capture cannot accept callback, clock, store factory or serialized admission before any request',async()=>{
  const original=globalThis.fetch;let sends=0;
  globalThis.fetch=async()=>{sends++;throw new Error('no request authorized by this test');};
  try {
    for(const key of ['query','now','assertSource','storeFactory','verified','skip'])
      await assert.rejects(captureAmoraWriterRetirementPrivateOriginal({repoRoot,expectedCommit,before:{},admission:{},[key]:()=>true}),/AMORA_WRITER_CAPTURE_ARGUMENT_INVALID/);
    await assert.rejects(captureAmoraWriterRetirementPrivateOriginal({repoRoot,expectedCommit,before:{},admission:{operationalEvidenceVerified:true}}),/AMORA_WRITER_RETIREMENT_ADMISSION_NOT_ISSUED/);
    assert.equal(sends,0);
  } finally {globalThis.fetch=original;}
});

test('B1 and old original6 receipts or JSON verified flags never become issued B2 private/content/source proof',async()=>{
  const fake={format:'amora-action-view-v2-private-original-capture-v1',privateStorageVerified:true,nativeReplayVerified:true,releaseAuthorized:true};
  await assert.rejects(readAmoraWriterRetirementPrivateOriginal(fake,{repoRoot,expectedCommit}),/AMORA_WRITER_CAPTURE_PROOF_NOT_ISSUED/);
  await assert.rejects(assertAmoraWriterRetirementAdmission({proof:fake,repoRoot,expectedCommit}),/AMORA_WRITER_RETIREMENT_ADMISSION_NOT_ISSUED/);
  assert.throws(()=>assertAmoraWriterRetirementPrivateStoreIssued(fake),/AMORA_WRITER_RETIREMENT_PRIVATE_STORE_NOT_ISSUED/);
  assert.throws(()=>readAmoraWriterRetirementRecoveryCapsule(fake),/AMORA_WRITER_RECOVERY_RECEIPT_NOT_ISSUED/);
});
