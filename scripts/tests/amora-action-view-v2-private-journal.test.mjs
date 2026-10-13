import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {basename,resolve,join} from 'node:path';
import {readdirSync,unlinkSync,rmdirSync,readFileSync} from 'node:fs';
import {createAmoraActionViewV2PrivateStore} from '../lib/amora-action-view-v2-private-store.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const moduleUrl=new URL('../lib/amora-action-view-v2-private-journal.mjs',import.meta.url);
for(const mode of ['rehearse','apply']) test(`actual private ${mode} metadata journal is exclusive, fsynced and independently ACL-verified without source plaintext`,
  {skip:process.platform!=='win32',timeout:60_000},async()=>{
    const {openAmoraActionViewV2PrivateJournal}=await import(moduleUrl);
    const id=randomUUID(),store=createAmoraActionViewV2PrivateStore({repoRoot,recoveryId:id});
    let journal;
    try {
      store.write(Buffer.from('synthetic encrypted original, not operational evidence'));
      assert.throws(()=>openAmoraActionViewV2PrivateJournal({repoRoot,recoveryId:id,directory:store.directory,mode:'custom'}),
        error=>error.code==='AMORA_VIEW_V2_JOURNAL_ARGUMENT_INVALID');
      assert.deepEqual(readdirSync(store.directory),['original-capsule.dpapi']);
      journal=openAmoraActionViewV2PrivateJournal({repoRoot,recoveryId:id,directory:store.directory,mode});
      journal.append({format:'synthetic-metadata-only',status:'intent',sourceSha256:'a'.repeat(64)});
      const evidence=journal.verify();
      assert.equal(evidence.privateAclVerified,true);
      assert.equal(evidence.recoveryId,id);
      assert.equal(evidence.file,mode==='apply'?'apply.jsonl':'rehearsal.jsonl');
      assert.equal(readFileSync(join(store.directory,evidence.file),'utf8'),
        JSON.stringify({format:'synthetic-metadata-only',status:'intent',sourceSha256:'a'.repeat(64)})+'\n');
      assert.throws(()=>openAmoraActionViewV2PrivateJournal({repoRoot,recoveryId:id,directory:store.directory,mode}));
      assert.throws(()=>journal.append({definition:'CREATE FUNCTION private_original()'}),
        error=>error.code==='AMORA_VIEW_V2_JOURNAL_NON_METADATA_FORBIDDEN');
    } finally {
      journal?.close();
      assert.equal(basename(store.directory),id);
      assert.equal(resolve(store.directory),resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionViewV2Recovery',id));
      for(const file of readdirSync(store.directory)) {
        assert.ok(['original-capsule.dpapi','rehearsal.jsonl','apply.jsonl'].includes(file));unlinkSync(join(store.directory,file));
      }
      rmdirSync(store.directory);
    }
  });
