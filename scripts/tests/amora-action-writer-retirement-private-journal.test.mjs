import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unlinkSync,rmdirSync,lstatSync,realpathSync,readFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAmoraWriterRetirementPrivateStore} from '../lib/amora-action-writer-retirement-private-store.mjs';
import {openAmoraWriterRetirementPrivateJournal,assertAmoraWriterRetirementPrivateJournal} from '../lib/amora-action-writer-retirement-private-journal.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
test('actual Windows original7-only journal ACL/readback/intents stay private, metadata-only, append durable and reject namespace reuse/fake journals',
  {timeout:60_000,skip:process.platform!=='win32'},()=>{
    const recoveryId=randomUUID(),store=createAmoraWriterRetirementPrivateStore({repoRoot,recoveryId});
    let journal;
    try{
      store.write(Buffer.from('SYNTHETIC-JOURNAL-TEST-ONLY'));
      journal=openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId,directory:store.directory,mode:'apply'});
      const intent={format:'amora-writer-retirement-original7-operation-intent-v1',status:'before-send',
        automaticRetryProhibited:true,transportReadOnlyFlag:false,sqlReadOnly:true,
        releaseAuthorized:false,customerRowsReturned:false};
      journal.append(intent);
      assert.equal(readFileSync(journal.path,'utf8'),JSON.stringify(intent)+'\n');
      const proof=assertAmoraWriterRetirementPrivateJournal(journal);
      assert.equal(proof.format,'amora-action-writer-retirement-original7-private-journal-v1');
      assert.equal(proof.privateAclVerified,true);
      for(const key of ['sql','query','token','definition','password','raw','bytes'])assert.throws(()=>journal.append({[key]:'SYNTHETIC-FORBIDDEN'}),/NON_METADATA_FORBIDDEN/);
      const hidden={status:'before-send'};
      Object.defineProperty(hidden,'toJSON',{value:()=>({token:'SYNTHETIC-NEVER-PERSISTED'})});
      assert.throws(()=>journal.append(hidden),/NON_METADATA_FORBIDDEN/);
      let called=false;
      const getter={};Object.defineProperty(getter,'status',{enumerable:true,get(){called=true;return 'secret-change';}});
      assert.throws(()=>journal.append(getter),/NON_METADATA_FORBIDDEN/);assert.equal(called,false);
      for(const custom of [new Date(),Object.create({toJSON(){called=true;return {releaseAuthorized:true};}})])
        assert.throws(()=>journal.append(custom),/NON_METADATA_FORBIDDEN/);
      assert.equal(called,false);
      const proxy=new Proxy({status:'before-send'},{getPrototypeOf(){called=true;return Object.prototype;}});
      assert.throws(()=>journal.append(proxy),/NON_METADATA_FORBIDDEN/);assert.equal(called,false);
      assert.equal(readFileSync(journal.path,'utf8'),JSON.stringify(intent)+'\n');
      assert.throws(()=>assertAmoraWriterRetirementPrivateJournal(JSON.parse(JSON.stringify(journal))),/NOT_ISSUED/);
      assert.throws(()=>openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId,directory:store.directory,mode:'apply'}),/EEXIST/);
      journal.close();assert.throws(()=>journal.verify(),/CLOSED/);
    }finally{
      journal?.close();
      const base=resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionWriterRetirementTransportRecovery');
      const actual=realpathSync(store.directory);
      assert.equal(actual.toLowerCase(),join(base,recoveryId).toLowerCase());
      assert.equal(dirname(actual).toLowerCase(),base.toLowerCase());assert.equal(lstatSync(actual).isSymbolicLink(),false);
      for(const name of ['apply.jsonl','original7-canonical-update-acl.dpapi']){
        const path=join(actual,name);assert.equal(lstatSync(path).isSymbolicLink(),false);unlinkSync(path);
      }
      rmdirSync(actual);
    }
  });

test('original7 journal rejects arbitrary directory/mode/options and forged authority before opening a leaf',()=>{
  const recoveryId=randomUUID(),directory=resolve(process.env.LOCALAPPDATA??'/tmp','WeddingHanbang','AmoraActionViewV2Recovery',recoveryId);
  assert.throws(()=>openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId,directory,mode:'apply'}),/ARGUMENT_INVALID/);
  for(const extra of ['query','verified','runCommand','namespace'])assert.throws(()=>openAmoraWriterRetirementPrivateJournal({repoRoot,recoveryId,directory,mode:'apply',[extra]:true}),/ARGUMENT_INVALID/);
  assert.throws(()=>assertAmoraWriterRetirementPrivateJournal({releaseAuthorized:true,privateAclVerified:true}),/NOT_ISSUED/);
});
