import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createAmoraWriterRetirementRecoveryNativeDatabase} from './fixtures/amora-action-writer-retirement-recovery-native.mjs';
import {buildAmoraWriterRetirementRecoveryCaptureSql,validateAmoraWriterRetirementRecoveryCapsule} from '../lib/amora-action-writer-retirement-recovery.mjs';
import {runAmoraWriterRetirementNativeSourceRecovery,runAmoraWriterRetirementNativeRecovery,assertAmoraWriterRetirementNativeRecovery} from '../lib/amora-action-writer-retirement-native-recovery.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url)),expectedCommit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const nativeOptions={timeout:120_000,skip:process.platform!=='win32'};

test('native PG17: fresh actual original7 capture → five-companion install → original7/ACL/guard2 replay and independent postquery',nativeOptions,async()=>{
  const collectorSourceSha256=digest(Buffer.from('owned native original7 test collector'));
  let f=await createAmoraWriterRetirementRecoveryNativeDatabase(),bytes,receipt,deadline;
  try {
    const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
    const result=await f.db.query(buildAmoraWriterRetirementRecoveryCaptureSql({repoRoot,expectedCommit,collectorSourceSha256,expectedNativeSystemIdentifier:id}));
    const raw=(Array.isArray(result)?result:[result]).flatMap(item=>item.rows??[]).find(row=>row.b2_original7_capsule).b2_original7_capsule;
    assert.equal(raw.sourceSystemIdentifier,id);
    assert.equal(raw.definitions.length,7);
    assert.equal(raw.captureEnvironment,'owned-native-pg17');
    bytes=Buffer.from(JSON.stringify(raw));deadline=new Date(Math.min(Date.now()+120_000,Date.parse(raw.capturedAt)+120_000)).toISOString();
    receipt=validateAmoraWriterRetirementRecoveryCapsule({repoRoot,bytes,expectedArtifactSha256:digest(bytes),expectedCommit,
      expectedCollectorSha256:collectorSourceSha256,deadline,expectedNativeSystemIdentifier:id});
    assert.equal(receipt.collectorExecutionProvenanceVerified,false);
  } finally {await f.close();f=undefined;}
  try {
    const proof=await runAmoraWriterRetirementNativeSourceRecovery({repoRoot,bytes,contentReceipt:receipt,expectedCommit,
      expectedCollectorSha256:collectorSourceSha256,deadline});
    assert.equal(proof.nativeReplayVerified,true);
    assert.equal(proof.independentReobservationVerified,true);
    assert.equal(proof.original7Sha256,proof.restored7Sha256);
    assert.equal(proof.ownedClusterClosedAndMarkerVerified,true);
    assert.equal(proof.privateOriginalLinked,false);
    assert.equal(proof.entireDatabaseAuthStorageRecoveryVerified,false);
    assert.equal(proof.productionRecoveryAuthorized,false);
    await assertAmoraWriterRetirementNativeRecovery({receipt:proof,artifactSha256:digest(bytes),forOperationalUse:false});
    await assert.rejects(assertAmoraWriterRetirementNativeRecovery({receipt:proof,artifactSha256:digest(bytes)}),/AMORA_WRITER_NATIVE_PRIVATE_ORIGINAL_REQUIRED/);
    await assert.rejects(assertAmoraWriterRetirementNativeRecovery({receipt:structuredClone(proof),artifactSha256:digest(bytes),forOperationalUse:false}),/AMORA_WRITER_NATIVE_NOT_ISSUED/);
  } finally {bytes?.fill(0);}
});

test('original4/6 and JSON verified booleans cannot start native recovery or become an operating proof',async()=>{
  const fake={nativeReplayVerified:true,privateStorageVerified:true,format:'amora-action-view-v2-issued-native-recovery-v1'};
  await assert.rejects(runAmoraWriterRetirementNativeRecovery({repoRoot,expectedCommit,privateOriginal:fake}),/AMORA_WRITER_CAPTURE_PROOF_NOT_ISSUED/);
  await assert.rejects(runAmoraWriterRetirementNativeSourceRecovery({repoRoot,bytes:Buffer.from('{}'),contentReceipt:fake,
    expectedCommit,expectedCollectorSha256:'a'.repeat(64),deadline:new Date(Date.now()+60_000).toISOString()}),/AMORA_WRITER_RECOVERY_RECEIPT_NOT_ISSUED/);
  await assert.rejects(assertAmoraWriterRetirementNativeRecovery({receipt:fake,artifactSha256:'a'.repeat(64)}),/AMORA_WRITER_NATIVE_NOT_ISSUED/);
});
