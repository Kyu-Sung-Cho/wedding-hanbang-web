import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,lstatSync,realpathSync,rmdirSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAmoraWriterRetirementPrivateStore,assertAmoraWriterRetirementPrivateStoreIssued} from '../lib/amora-action-writer-retirement-private-store.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('actual Windows DPAPI/ACL original7 namespace roundtrip is separate from B1 and never overwrites a recovery UUID',{timeout:60_000,skip:process.platform!=='win32'},()=>{
  assert.equal(process.platform,'win32','Windows proof is mandatory in this owned test; no skipped evidence');
  const recoveryId=randomUUID(),bytes=Buffer.from('SYNTHETIC original7 transport recovery test; no original/customer content');
  let store;
  try {
    store=createAmoraWriterRetirementPrivateStore({repoRoot,recoveryId});
    const expected=resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery',recoveryId);
    assert.equal(store.directory.toLowerCase(),expected.toLowerCase());
    assertAmoraWriterRetirementPrivateStoreIssued(store);
    const written=store.write(bytes),read=store.read(digest(bytes));
    try {assert.equal(read.equals(bytes),true);} finally {read.fill(0);}
    const checked=store.verify(digest(bytes));
    assert.equal(checked.format,'amora-action-writer-retirement-original7-private-storage-v1');
    assert.equal(checked.privateStorageVerified,true);
    assert.equal(checked.plaintextWrittenToDisk,false);
    assert.equal(checked.releaseAuthorized,false);
    assert.equal(checked.encryptedSha256,written.encryptedSha256);
    assert.throws(()=>store.write(bytes),/AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_FAILED/);
    assert.throws(()=>createAmoraWriterRetirementPrivateStore({repoRoot,recoveryId}),/AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_FAILED/);
    assert.throws(()=>store.read('f'.repeat(64)),/AMORA_WRITER_RETIREMENT_PRIVATE_STORAGE_FAILED/);
    assert.equal(existsSync(join(expected,'original-capsule.dpapi')),false);
  } finally {
    bytes.fill(0);
    if(store) {
      const base=resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery');
      const expected=join(base,recoveryId),actual=realpathSync(store.directory);
      assert.equal(actual.toLowerCase(),expected.toLowerCase());
      assert.equal(dirname(actual).toLowerCase(),base.toLowerCase());
      assert.equal(lstatSync(actual).isSymbolicLink(),false);
      const file=join(actual,'original7-canonical-update-acl.dpapi');
      assert.equal(lstatSync(file).isSymbolicLink(),false);
      unlinkSync(file);rmdirSync(actual);
    }
  }
});

test('private constructor rejects extra callbacks, old issued-looking objects and hash coercion',()=>{
  for(const extra of ['query','directory','namespace','verified','runCommand'])
    assert.throws(()=>createAmoraWriterRetirementPrivateStore({repoRoot,recoveryId:randomUUID(),[extra]:true}),/ARGUMENT_INVALID/);
  assert.throws(()=>createAmoraWriterRetirementPrivateStore({repoRoot,recoveryId:[randomUUID()]}),/ARGUMENT_INVALID/);
  assert.throws(()=>assertAmoraWriterRetirementPrivateStoreIssued({privateStorageVerified:true}),/PRIVATE_STORE_NOT_ISSUED/);
});
