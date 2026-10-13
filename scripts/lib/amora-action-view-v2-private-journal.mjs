import {execFileSync} from 'node:child_process';
import {openSync,writeSync,fsyncSync,closeSync,lstatSync,fstatSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {digest,pinnedArtifact,requireRelease,CurrentBaselineBlocked} from './current-baseline-release-contract.mjs';

const HELPER={file:'scripts/amora-action-view-v2-private-journal.ps1',
  sha256:'9bba0f487c8dec55dbb1587883ba56b1865058e4ff99e1c96d02f6f1351440db'};
const COMMON={file:'scripts/amora-db-backup-common.ps1',sha256:'b6f9eaa6a54edf92d868f61d25f00a2008ec42e34bbd5fb4dea75def61277079'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const issued=new WeakMap();
const sensitive=/^(?:definition|sql|query|plaintext|bytes|raw|contents|password|secret|token|authorization|credential)$/i;
function metadata(value,depth=0) {
  requireRelease(depth<=10,'AMORA_VIEW_V2_JOURNAL_NON_METADATA_FORBIDDEN');
  if(value===null||typeof value==='boolean'||typeof value==='number') {
    requireRelease(typeof value!=='number'||Number.isFinite(value),'AMORA_VIEW_V2_JOURNAL_NON_METADATA_FORBIDDEN');return;
  }
  if(typeof value==='string') {
    requireRelease(value.length<=512&&!/[\r\n\0]/.test(value),'AMORA_VIEW_V2_JOURNAL_NON_METADATA_FORBIDDEN');return;
  }
  requireRelease(value&&typeof value==='object','AMORA_VIEW_V2_JOURNAL_NON_METADATA_FORBIDDEN');
  if(Array.isArray(value)) {requireRelease(value.length<=300,'AMORA_VIEW_V2_JOURNAL_NON_METADATA_FORBIDDEN');for(const child of value)metadata(child,depth+1);}
  else for(const [key,child] of Object.entries(value)) {
    requireRelease(!sensitive.test(key),'AMORA_VIEW_V2_JOURNAL_NON_METADATA_FORBIDDEN');metadata(child,depth+1);
  }
}
/** 별도 private capsule directory의 고정 metadata journal만 열고 실제 Windows ACL을 확인한다. */
export function openAmoraActionViewV2PrivateJournal({repoRoot,recoveryId,directory,mode='rehearse'}) {
  requireRelease(process.platform==='win32'&&UUID.test(recoveryId??'')&&typeof directory==='string'
    &&typeof process.env.LOCALAPPDATA==='string'&&resolve(directory).toLowerCase()===
      resolve(process.env.LOCALAPPDATA,'WeddingHanbang','AmoraActionViewV2Recovery',recoveryId).toLowerCase(),
  'AMORA_VIEW_V2_JOURNAL_ARGUMENT_INVALID');
  requireRelease(['rehearse','apply'].includes(mode),'AMORA_VIEW_V2_JOURNAL_ARGUMENT_INVALID');
  const file=mode==='apply'?'apply.jsonl':'rehearsal.jsonl',path=join(directory,file);
  pinnedArtifact(repoRoot,HELPER);pinnedArtifact(repoRoot,COMMON);
  const fd=openSync(path,'wx',0o600);let closed=false;
  const verify=()=>{
    requireRelease(!closed,'AMORA_VIEW_V2_JOURNAL_CLOSED');
    try {
      pinnedArtifact(repoRoot,HELPER);pinnedArtifact(repoRoot,COMMON);
      const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'
        &&!/SUPABASE|DATABASE_URL|PGPASSWORD|PGHOST|PGUSER/.test(key)));
      const result=execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',[
        '-NoProfile','-NonInteractive','-File',resolve(repoRoot,HELPER.file),'-RecoveryId',recoveryId,'-Mode',mode],{
        encoding:'utf8',windowsHide:true,timeout:20_000,maxBuffer:16384,stdio:['ignore','pipe','pipe'],env:environment});
      const evidence=JSON.parse(result.trim()),stat=lstatSync(path),opened=fstatSync(fd),bytes=readFileSync(path),after=lstatSync(path);
      requireRelease(evidence.format==='amora-action-view-v2-private-journal-v1'&&evidence.recoveryId===recoveryId
        &&evidence.projectRef==='slrtobkksjmxgzatjyqb'&&evidence.file===file&&evidence.privateAclVerified===true
        &&stat.isFile()&&!stat.isSymbolicLink()&&opened.dev===stat.dev&&opened.ino===stat.ino
        &&opened.size===stat.size&&stat.dev===after.dev&&stat.ino===after.ino&&stat.size===after.size
        &&stat.mtimeMs===after.mtimeMs&&evidence.byteLength===bytes.length&&evidence.sha256===digest(bytes)
        &&Number.isFinite(Date.parse(evidence.checkedAt))&&Date.now()-Date.parse(evidence.checkedAt)<20_000,
      'AMORA_VIEW_V2_JOURNAL_PRIVATE_ACL_UNVERIFIED');
      return Object.freeze(evidence);
    } catch {throw new CurrentBaselineBlocked('AMORA_VIEW_V2_JOURNAL_PRIVATE_ACL_UNVERIFIED');}
  };
  const journal=Object.freeze({path,recoveryId,
    append(value) {
      requireRelease(!closed,'AMORA_VIEW_V2_JOURNAL_CLOSED');metadata(value);verify();
      const bytes=Buffer.from(JSON.stringify(value)+'\n');
      requireRelease(lstatSync(path).size+bytes.length<=262144,'AMORA_VIEW_V2_JOURNAL_TOO_LARGE');
      let offset=0;
      while(offset<bytes.length) {
        const count=writeSync(fd,bytes,offset,bytes.length-offset,null);
        requireRelease(Number.isSafeInteger(count)&&count>0&&count<=bytes.length-offset,
          'AMORA_VIEW_V2_JOURNAL_WRITE_INCOMPLETE');offset+=count;
      }
      fsyncSync(fd);return verify();
    },verify,
    close(){if(!closed){closeSync(fd);closed=true;}},
  });
  try {verify();issued.set(journal,{path,recoveryId});return journal;}
  catch(error){closeSync(fd);closed=true;throw error;}
}

export function assertAmoraActionViewV2PrivateJournal(journal) {
  const state=issued.get(journal);
  requireRelease(state&&state.path===journal.path&&state.recoveryId===journal.recoveryId,
    'AMORA_VIEW_V2_JOURNAL_NOT_ISSUED');return journal.verify();
}
