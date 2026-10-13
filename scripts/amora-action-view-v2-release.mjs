import {fileURLToPath} from 'node:url';
import {runAmoraActionViewV2Release} from './lib/amora-action-view-v2-release.mjs';

// 실제 source/CI/private/native 검증과 ROLLBACK 재조회 뒤 고정 COMMIT만 지원한다.
try {
  const result=await runAmoraActionViewV2Release({repoRoot:fileURLToPath(new URL('../',import.meta.url)),argv:process.argv.slice(2)});
  process.stdout.write(JSON.stringify({status:result.status,releaseAuthorized:result.releaseAuthorized===true,
    productionApplyImplemented:result.productionApplyImplemented===true,
    operationalEvidenceVerified:result.operationalEvidenceVerified===true,
    remoteWritesAttempted:result.remoteWritesAttempted===true,
    committedMutationObserved:result.committedMutationObserved??false,
    ...(typeof result.recoveryId==='string'?{recoveryId:result.recoveryId,journalSha256:result.journalSha256}:{}),
    ...(Object.hasOwn(result,'remoteWritesPerformed')?{remoteWritesPerformed:result.remoteWritesPerformed}:{}),
    ...(Object.hasOwn(result,'oldWriterRetirementIncluded')?{oldWriterRetirementIncluded:result.oldWriterRetirementIncluded}:{}),
    entireDatabaseAuthStorageRecoveryVerified:false})+'\n');
} catch(error) {
  const code=/^AMORA_VIEW_V2_[A-Z0-9_]+$/.test(error?.code??'')?error.code:'AMORA_VIEW_V2_BLOCKED';
  process.stderr.write(JSON.stringify({status:'blocked',code,releaseAuthorized:false,productionApplyImplemented:false,
    remoteWritesAttempted:error?.remoteWritesAttempted===true,
    automaticRetryProhibited:error?.automaticRetryProhibited===true,
    ...(typeof error?.recoveryId==='string'?{recoveryId:error.recoveryId}:{}),
    committedMutationObserved:error?.automaticRetryProhibited===true?null:false})+'\n');
  process.exitCode=1;
}
