import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createDraftDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';
import {buildAmoraActionViewV2RecoveryCaptureSql,validateAmoraActionViewV2RecoveryCapsule} from '../lib/amora-action-view-v2-recovery.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const moduleUrl=new URL('../lib/amora-action-view-v2-native-recovery.mjs',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const argumentsFor=bytes=>({repoRoot,bytes,contentReceipt:{},deadline:new Date(Date.now()+120_000).toISOString(),
  expectedArtifactSha256:sha(bytes),expectedCollectorSha256:'b'.repeat(64),expectedCommit:'a'.repeat(40)});

test('native replay rejects caller-asserted evidence before creating any owned database',async()=>{
  const {runAmoraActionViewV2NativeRecovery}=await import(moduleUrl);
  await assert.rejects(()=>runAmoraActionViewV2NativeRecovery({repoRoot,verified:true}),
    error=>error.code==='AMORA_VIEW_V2_NATIVE_RECOVERY_ARGUMENT_INVALID');
});

test('a reconstructed native proof is not issued runtime recovery evidence',async()=>{
  const {assertAmoraActionViewV2NativeRecovery}=await import(moduleUrl);
  assert.throws(()=>assertAmoraActionViewV2NativeRecovery({receipt:{nativeReplayVerified:true},artifactSha256:'a'.repeat(64)}),
    error=>error.code==='AMORA_VIEW_V2_NATIVE_RECOVERY_NOT_ISSUED');
});

test('malformed recovery bytes fail before a private definition or local SQL can execute',async()=>{
  const {runAmoraActionViewV2NativeRecovery}=await import(moduleUrl);
  await assert.rejects(()=>runAmoraActionViewV2NativeRecovery(argumentsFor(Buffer.from('{'))),
    error=>error.code==='AMORA_VIEW_V2_NATIVE_RECOVERY_ARTIFACT_INVALID');
});

test('an altered artifact hash and a caller-created content receipt are rejected before native creation',async()=>{
  const {runAmoraActionViewV2NativeRecovery}=await import(moduleUrl);
  const bytes=Buffer.from(JSON.stringify({captureEnvironment:'supabase-read-only'}));
  await assert.rejects(()=>runAmoraActionViewV2NativeRecovery({...argumentsFor(bytes),expectedArtifactSha256:'c'.repeat(64)}),
    error=>error.code==='AMORA_VIEW_V2_NATIVE_RECOVERY_ARTIFACT_INVALID');
  await assert.rejects(()=>runAmoraActionViewV2NativeRecovery(argumentsFor(bytes)),
    error=>error.code==='AMORA_VIEW_V2_RECOVERY_CAPSULE_NOT_ISSUED');
});

test('an actual owned native original is freshly recaptured and replayed on a distinct owned cluster without operational authorization',
  {skip:!nativeProfileRoleAvailable,timeout:90_000},async()=>{
    const {runAmoraActionViewV2NativeRecovery,assertAmoraActionViewV2NativeRecovery}=await import(moduleUrl);
    const f=await createDraftDatabase({native:true,candidate:false});
    let bytes;
    try {
      await f.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])');
      const expectedCommit='a'.repeat(40),expectedCollectorSha256='b'.repeat(64);
      const captureSql=buildAmoraActionViewV2RecoveryCaptureSql({repoRoot,expectedCommit,
        collectorSourceSha256:expectedCollectorSha256,captureEnvironment:'owned-native-pg17'});
      const rows=await f.db.query(captureSql);
      const raw=rows.flatMap(result=>result.rows??[]).find(row=>row.recovery_capsule).recovery_capsule;
      bytes=Buffer.from(JSON.stringify(raw));
      const deadline=new Date(Math.min(Date.now()+120_000,Date.parse(raw.capturedAt)+120_000)).toISOString();
      const contentReceipt=validateAmoraActionViewV2RecoveryCapsule({repoRoot,bytes,
        expectedArtifactSha256:sha(bytes),expectedCommit,expectedCollectorSha256,deadline,
        expectedNativeSystemIdentifier:raw.sourceSystemIdentifier});
      const proof=await runAmoraActionViewV2NativeRecovery({repoRoot,bytes,contentReceipt,
        expectedArtifactSha256:sha(bytes),expectedCommit,expectedCollectorSha256,deadline});
      assert.equal(proof.nativeReplayVerified,true);
      assert.equal(proof.ownedClusterClosedAndMarkerVerified,true);
      assert.equal(proof.captureEnvironment,'owned-native-pg17');
      assert.notEqual(proof.actualNativeSystemIdentifier,raw.sourceSystemIdentifier);
      assert.equal(proof.originalTargetSha256,proof.localBeforeTargetSha256);
      assert.equal(proof.productionRecoveryAuthorized,false);
      assert.equal(proof.entireDatabaseAuthStorageRecoveryVerified,false);
      assertAmoraActionViewV2NativeRecovery({receipt:proof,artifactSha256:sha(bytes),forOperationalUse:false});
      assert.throws(()=>assertAmoraActionViewV2NativeRecovery({receipt:proof,artifactSha256:sha(bytes)}),
        error=>error.code==='AMORA_VIEW_V2_NATIVE_RECOVERY_OPERATIONAL_SOURCE_REQUIRED');
      assert.throws(()=>assertAmoraActionViewV2NativeRecovery({receipt:structuredClone(proof),artifactSha256:sha(bytes),forOperationalUse:false}),
        error=>error.code==='AMORA_VIEW_V2_NATIVE_RECOVERY_NOT_ISSUED');
    } finally {bytes?.fill(0);await f.close();}
  });
