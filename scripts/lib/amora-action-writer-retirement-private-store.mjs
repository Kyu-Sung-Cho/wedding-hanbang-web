import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {digest,pinnedArtifact,requireRelease} from './current-baseline-release-contract.mjs';

const HELPER={file:'scripts/amora-action-writer-retirement-private-store.ps1',sha256:'48051458dc7550f129e72664b36a5e4213e165c4698cda0c695d68e138828b9c'};
const COMMON={file:'scripts/amora-db-backup-common.ps1',sha256:'b6f9eaa6a54edf92d868f61d25f00a2008ec42e34bbd5fb4dea75def61277079'};
const SHA=/^[a-f0-9]{64}$/;
const issuedStores=new WeakSet();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=()=>{throw Object.assign(new Error('AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_FAILED'),{code:'AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_FAILED'});};

/** 실제 Windows ACL/DPAPI를 확인한다. 저장 성공은 원본 내용·복구·배포 승인이 아니다. */
export function createAmoraWriterRetirementPrivateStore(options) {
  requireRelease(options&&typeof options==='object'&&!Array.isArray(options)
    &&Object.keys(options).sort().join(',')==='recoveryId,repoRoot','AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_ARGUMENT_INVALID');
  const {repoRoot,recoveryId}=options;
  requireRelease(typeof repoRoot==='string'&&typeof recoveryId==='string'&&UUID.test(recoveryId),'AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_ARGUMENT_INVALID');
  requireRelease(process.platform==='win32','AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_WINDOWS_REQUIRED');
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
    resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery',recoveryId).toLowerCase(),
  'AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_PATH_INVALID');
  const metadata=text=>{
    let value;try{value=JSON.parse(text);}catch{fail();}
    requireRelease(value.format==='amora-action-writer-retirement-original7-private-storage-v1'&&value.recoveryId===recoveryId
      &&value.projectRef==='slrtobkksjmxgzatjyqb'&&value.privateStorageVerified===true
      &&value.plaintextWrittenToDisk===false&&value.releaseAuthorized===false
      &&value.protection==='Windows-DPAPI-CurrentUser'&&typeof value.plaintextSha256==='string'&&SHA.test(value.plaintextSha256)&&typeof value.encryptedSha256==='string'&&SHA.test(value.encryptedSha256)
      &&Number.isSafeInteger(value.plaintextBytes)&&value.plaintextBytes>0&&value.plaintextBytes<=262144
      &&Number.isSafeInteger(value.encryptedBytes)&&value.encryptedBytes>0&&value.encryptedBytes<=263168
      &&Number.isFinite(Date.parse(value.checkedAt)),'AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_RESPONSE_INVALID');
    return Object.freeze(value);
  };
  const store=Object.freeze({directory,recoveryId,
    write(bytes) {
      requireRelease(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=262144,'AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_ARGUMENT_INVALID');
      return metadata(run('store',bytes,digest(bytes)));
    },
    read(expectedSha256) {
      requireRelease(typeof expectedSha256==='string'&&SHA.test(expectedSha256),'AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_ARGUMENT_INVALID');
      const bytes=Buffer.from(run('read',undefined,expectedSha256),'base64');
      if(bytes.length<1||bytes.length>262144||digest(bytes)!==expectedSha256) {bytes.fill(0);fail();}
      return bytes;
    },
    verify(expectedSha256) {
      requireRelease(typeof expectedSha256==='string'&&SHA.test(expectedSha256),'AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_ARGUMENT_INVALID');
      return metadata(run('check',undefined,expectedSha256));
    },
  });
  issuedStores.add(store);
  return store;
}

export function assertAmoraWriterRetirementPrivateStoreIssued(store) {
  requireRelease(issuedStores.has(store),'AMORA_WRITER_RETIREMENT_PRIVATE_STORE_NOT_ISSUED');
}
