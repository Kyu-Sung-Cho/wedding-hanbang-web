import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,basename,resolve} from 'node:path';
import {readFileSync,writeFileSync,readdirSync,unlinkSync,rmdirSync,lstatSync} from 'node:fs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const moduleUrl=new URL('../lib/amora-action-view-v2-private-store.mjs',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const windows={skip:process.platform!=='win32',timeout:60_000};
function cleanupOwned(id,directory) {
  if(!directory) return;
  assert.equal(basename(directory),id);
  assert.equal(resolve(directory),resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionViewV2Recovery',id));
  for(const name of readdirSync(directory)) {
    assert.equal(name,'original-capsule.dpapi');
    unlinkSync(join(directory,name));
  }
  rmdirSync(directory);
}

function ownedFileAcl(id,directory,operation,originalSddl='') {
  assert.equal(basename(directory),id);
  assert.equal(resolve(directory),resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionViewV2Recovery',id));
  assert.deepEqual(readdirSync(directory),['original-capsule.dpapi']);
  const file=join(directory,'original-capsule.dpapi');
  assert.equal(lstatSync(file).isSymbolicLink(),false);
  assert.ok(['read','everyone-read','restore'].includes(operation));
  const quote=value=>`'${value.replaceAll("'","''")}'`;
  const change=operation==='everyone-read'?`
    $rule=[Security.AccessControl.FileSystemAccessRule]::new(
      [Security.Principal.SecurityIdentifier]::new('S-1-1-0'),
      [Security.AccessControl.FileSystemRights]::Read,
      [Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $path -AclObject $acl
  `:operation==='restore'?`
    $acl.SetSecurityDescriptorSddlForm(${quote(originalSddl)})
    Set-Acl -LiteralPath $path -AclObject $acl
  `:'';
  const script=`$ErrorActionPreference='Stop'
    $path=${quote(file)}
    $acl=Get-Acl -LiteralPath $path
    ${change}
    $actual=Get-Acl -LiteralPath $path
    [Console]::Out.Write($actual.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))`;
  const environment=Object.fromEntries(['SystemRoot','WINDIR','PATH','LOCALAPPDATA','TEMP','TMP']
    .filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  return execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',[
    '-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64'),
  ],{encoding:'utf8',windowsHide:true,timeout:10_000,maxBuffer:16384,stdio:['ignore','pipe','pipe'],env:environment}).trim();
}

test('actual Windows private original store roundtrips without plaintext disk output and cannot overwrite',windows,async()=>{
  const {createAmoraActionViewV2PrivateStore}=await import(moduleUrl);
  const id=randomUUID();let directory;
  try {
    const store=createAmoraActionViewV2PrivateStore({repoRoot,recoveryId:id});
    directory=store.directory;
    const bytes=Buffer.from(JSON.stringify({format:'synthetic-original-only',definition:'private synthetic SQL not a release proof'}));
    const receipt=store.write(bytes);
    assert.equal(receipt.plaintextSha256,sha(bytes));
    assert.equal(receipt.privateStorageVerified,true);
    assert.equal(receipt.releaseAuthorized,false);
    assert.equal(receipt.format,'amora-action-view-v2-private-storage-v1');
    const encrypted=readFileSync(join(directory,'original-capsule.dpapi'));
    assert.equal(encrypted.includes(bytes),false);
    const restored=store.read(receipt.plaintextSha256);
    try {assert.deepEqual(restored,bytes);} finally {restored.fill(0);}
    assert.throws(()=>store.write(Buffer.from('replacement')),error=>error.code==='AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED');
    assert.deepEqual(readFileSync(join(directory,'original-capsule.dpapi')),encrypted);
    assert.throws(()=>store.read('a'.repeat(64)),error=>error.code==='AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED');
    const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;
    writeFileSync(join(directory,'original-capsule.dpapi'),damaged);
    assert.throws(()=>store.read(receipt.plaintextSha256),error=>error.code==='AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED');
  } finally {cleanupOwned(id,directory);}
});

test('private store rejects invalid scope before creating directories or launching helpers',async()=>{
  const {createAmoraActionViewV2PrivateStore}=await import(moduleUrl);
  for(const recoveryId of ['..','../../other','00000000-0000-0000-0000-000000000000',randomUUID().toUpperCase()]) {
    assert.throws(()=>createAmoraActionViewV2PrivateStore({repoRoot,recoveryId}),
      error=>error.code==='AMORA_VIEW_V2_PRIVATE_STORAGE_ARGUMENT_INVALID');
  }
});

test('actual Windows independent verify checks the stored hash without authorizing release',windows,async()=>{
  const {createAmoraActionViewV2PrivateStore}=await import(moduleUrl);
  const id=randomUUID();let directory;
  try {
    const store=createAmoraActionViewV2PrivateStore({repoRoot,recoveryId:id});
    directory=store.directory;
    const bytes=Buffer.from('synthetic independent verify payload');
    const receipt=store.write(bytes);
    const checked=store.verify(sha(bytes));
    assert.equal(checked.plaintextSha256,sha(bytes));
    assert.equal(checked.encryptedSha256,sha(readFileSync(join(directory,'original-capsule.dpapi'))));
    assert.equal(checked.encryptedSha256,receipt.encryptedSha256);
    assert.equal(checked.privateStorageVerified,true);
    assert.equal(checked.plaintextWrittenToDisk,false);
    assert.equal(checked.releaseAuthorized,false);
    assert.equal(checked.recoveryId,id);
    assert.throws(()=>store.verify('a'.repeat(64)),error=>error.code==='AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED');
    assert.throws(()=>store.verify('not-a-hash'),error=>error.code==='AMORA_VIEW_V2_PRIVATE_STORAGE_ARGUMENT_INVALID');
  } finally {cleanupOwned(id,directory);}
});

test('invalid plaintext type or size never overwrites the actual Windows ciphertext',windows,async()=>{
  const {createAmoraActionViewV2PrivateStore}=await import(moduleUrl);
  const id=randomUUID();let directory;
  try {
    const store=createAmoraActionViewV2PrivateStore({repoRoot,recoveryId:id});
    directory=store.directory;
    const bytes=Buffer.from('synthetic ciphertext preserved across invalid write inputs');
    const receipt=store.write(bytes);
    const encrypted=readFileSync(join(directory,'original-capsule.dpapi'));
    for(const invalid of [Buffer.alloc(0),Buffer.alloc(262145), 'not-buffer',new Uint8Array([1]),null,{}]) {
      assert.throws(()=>store.write(invalid),error=>error.code==='AMORA_VIEW_V2_PRIVATE_STORAGE_ARGUMENT_INVALID');
      assert.deepEqual(readFileSync(join(directory,'original-capsule.dpapi')),encrypted);
    }
    assert.equal(store.verify(receipt.plaintextSha256).encryptedSha256,sha(encrypted));
  } finally {cleanupOwned(id,directory);}
});

test('actual Windows private-file ACL drift blocks read and verify while ciphertext cannot be overwritten',windows,async()=>{
  const {createAmoraActionViewV2PrivateStore}=await import(moduleUrl);
  const id=randomUUID();let directory,originalSddl;
  try {
    const store=createAmoraActionViewV2PrivateStore({repoRoot,recoveryId:id});
    directory=store.directory;
    const bytes=Buffer.from('synthetic owned ACL drift payload only');
    const receipt=store.write(bytes);
    const encrypted=readFileSync(join(directory,'original-capsule.dpapi'));
    originalSddl=ownedFileAcl(id,directory,'read');
    assert.ok(originalSddl.length>0);
    const widened=ownedFileAcl(id,directory,'everyone-read');
    assert.notEqual(widened,originalSddl);
    assert.deepEqual(readFileSync(join(directory,'original-capsule.dpapi')),encrypted);
    const genericFailure=error=>{
      assert.equal(error.code,'AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED');
      assert.equal(error.message,'AMORA_VIEW_V2_PRIVATE_STORAGE_FAILED');
      assert.equal(Object.hasOwn(error,'cause'),false);
      return true;
    };
    assert.throws(()=>store.read(receipt.plaintextSha256),genericFailure);
    assert.throws(()=>store.verify(receipt.plaintextSha256),genericFailure);
    // 기존 파일 store는 ACL drift 여부와 관계없이 exclusive overwrite 경계에서 거절된다.
    assert.throws(()=>store.write(Buffer.from('replacement')),genericFailure);
    assert.deepEqual(readFileSync(join(directory,'original-capsule.dpapi')),encrypted);
    assert.equal(ownedFileAcl(id,directory,'restore',originalSddl),originalSddl);
    assert.equal(store.verify(receipt.plaintextSha256).encryptedSha256,sha(encrypted));
  } finally {
    if(directory&&originalSddl) {
      assert.equal(ownedFileAcl(id,directory,'restore',originalSddl),originalSddl);
    }
    cleanupOwned(id,directory);
  }
});
