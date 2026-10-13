import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {digest,pinnedArtifact,requireRelease} from './current-baseline-release-contract.mjs';

const HELPER={file:'scripts/amora-action-view-v2-private-store.ps1',sha256:'9a795fe2a4cf71f043c2f1d0ef530f13e0d59525b52caee12ae337a6af9335b8'};
const COMMON={file:'scripts/amora-db-backup-common.ps1',sha256:'b6f9eaa6a54edf92d868f61d25f00a2008ec42e34bbd5fb4dea75def61277079'};
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=()=>{throw Object.assign(new Error('AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED'),{code:'AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED'});};

/** 실제 Windows ACL/DPAPI를 확인한다. 저장 성공은 원본 내용·복구·배포 승인이 아니다. */
export function createAmoraActionViewV2PrivateStore({repoRoot,recoveryId}) {
  requireRelease(typeof repoRoot==='string'&&UUID.test(recoveryId??''),'AMORA_VIEW_V2_PRIVATE_STORAGE_ARGUMENT_INVALID');
  requireRelease(process.platform==='win32','AMORA_VIEW_V2_PRIVATE_STORAGE_WINDOWS_REQUIRED');
  const run=(mode,bytes,expectedSha256)=>{
    try {
      pinnedArtifact(repoRoot,HELPER);pinnedArtifact(repoRoot,COMMON);
      const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>
        key.toLowerCase()!=='psmodulepath'&&!/SUPABASE|DATABASE_URL|PGPASSWORD|PGHOST|PGUSER/.test(key)));
      return execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',[
        '-NoProfile','-NonInteractive','-File',resolve(repoRoot,HELPER.file),'-Mode',mode,'-RecoveryId',recoveryId,
        ...(expectedSha256?['-ExpectedSha256',expectedSha256]:[])],{
        input:bytes?.toString('base64'),encoding:'utf8',windowsHide:true,timeout:20_000,maxBuffer:524288,
        stdio:['pipe','pipe','pipe'],env:environment,
      }).trim();
    } catch {fail();}
  };
  const directory=run('create');
  requireRelease(typeof process.env.LOCALAPPDATA==='string'&&directory.toLowerCase()===
    resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionViewV2Recovery',recoveryId).toLowerCase(),
  'AMORA_VIEW_V2_PRIVATE_STORAGE_PATH_INVALID');
  const metadata=text=>{
    let value;try{value=JSON.parse(text);}catch{fail();}
    requireRelease(value.format==='amora-action-view-v2-private-storage-v1'&&value.recoveryId===recoveryId
      &&value.projectRef==='slrtobkksjmxgzatjyqb'&&value.privateStorageVerified===true
      &&value.plaintextWrittenToDisk===false&&value.releaseAuthorized===false
      &&value.protection==='Windows-DPAPI-CurrentUser'&&SHA.test(value.plaintextSha256??'')&&SHA.test(value.encryptedSha256??'')
      &&Number.isSafeInteger(value.plaintextBytes)&&value.plaintextBytes>0&&value.plaintextBytes<=262144
      &&Number.isSafeInteger(value.encryptedBytes)&&value.encryptedBytes>0&&value.encryptedBytes<=263168
      &&Number.isFinite(Date.parse(value.checkedAt)),'AMORA_VIEW_V2_PRIVATE_STORAGE_RESPONSE_INVALID');
    return Object.freeze(value);
  };
  return Object.freeze({directory,recoveryId,
    write(bytes) {
      requireRelease(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=262144,'AMORA_VIEW_V2_PRIVATE_STORAGE_ARGUMENT_INVALID');
      return metadata(run('store',bytes,digest(bytes)));
    },
    read(expectedSha256) {
      requireRelease(SHA.test(expectedSha256??''),'AMORA_VIEW_V2_PRIVATE_STORAGE_ARGUMENT_INVALID');
      const bytes=Buffer.from(run('read',undefined,expectedSha256),'base64');
      if(bytes.length<1||bytes.length>262144||digest(bytes)!==expectedSha256) {bytes.fill(0);fail();}
      return bytes;
    },
    verify(expectedSha256) {
      requireRelease(SHA.test(expectedSha256??''),'AMORA_VIEW_V2_PRIVATE_STORAGE_ARGUMENT_INVALID');
      return metadata(run('check',undefined,expectedSha256));
    },
  });
}
