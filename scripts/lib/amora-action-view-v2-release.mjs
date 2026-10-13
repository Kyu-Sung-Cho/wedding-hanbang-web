import {execFileSync} from 'node:child_process';
import {closeSync,fsyncSync,lstatSync,openSync,readFileSync,realpathSync,writeSync} from 'node:fs';
import {dirname,isAbsolute,join,parse,relative,resolve,sep} from 'node:path';
import {CurrentBaselineBlocked,digest,requireRelease,same} from './current-baseline-release-contract.mjs';
import {AMORA_VIEW_V2_MODE,loadAmoraActionViewV2Plan} from './amora-action-view-v2-release-contract.mjs';
import {buildAmoraActionViewV2ObservationSql,validateAmoraActionViewV2Inspection} from './amora-action-view-v2-catalog.mjs';

const PROJECT='slrtobkksjmxgzatjyqb';
const RELEASE='amora-action-view-v2-20261012';
const ORIGIN='https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git';
const fail=code=>{throw new CurrentBaselineBlocked(code);};

export function parseAmoraActionViewV2Args(argv) {
  const options={};
  for(const arg of argv) {
    if([AMORA_VIEW_V2_MODE,'--inspect','--rehearse','--apply'].includes(arg)) {
      const key=arg===AMORA_VIEW_V2_MODE?'selected':'mode';
      requireRelease(!Object.hasOwn(options,key),'AMORA_VIEW_V2_ARGUMENT_DUPLICATE');
      options[key]=arg===AMORA_VIEW_V2_MODE?true:arg.slice(2);
      continue;
    }
    const match=/^--(expected-commit|project-ref|receipt-out|confirm-production)=(.+)$/.exec(arg);
    requireRelease(match&&!Object.hasOwn(options,match[1]),'AMORA_VIEW_V2_ARGUMENT_INVALID');
    options[match[1]]=match[2];
  }
  requireRelease(options.selected&&options.mode&&/^[a-f0-9]{40}$/.test(options['expected-commit']??'')
    &&options['project-ref']===PROJECT,'AMORA_VIEW_V2_ARGUMENT_INVALID');
  if(['rehearse','apply'].includes(options.mode)) {
    requireRelease(options['receipt-out']==='private-store/'+(options.mode==='apply'?'apply':'rehearsal')+'.jsonl',
      'AMORA_VIEW_V2_PRIVATE_RECEIPT_REQUIRED');
    requireRelease(options['confirm-production']===`${RELEASE}:${PROJECT}:${options.mode}:${options['expected-commit']}`,
      'AMORA_VIEW_V2_CONFIRMATION_REQUIRED');
  } else requireRelease(isAbsolute(options['receipt-out']??'')&&options['receipt-out'].endsWith('.jsonl')
    &&options['confirm-production']===undefined,'AMORA_VIEW_V2_ARGUMENT_INVALID');
  return Object.freeze(options);
}

export function assertAmoraActionViewV2Source(repoRoot,expectedCommit) {
  const git=args=>execFileSync('git',['--no-replace-objects','-C',repoRoot,...args],
    {encoding:'utf8',windowsHide:true,timeout:15_000,stdio:['ignore','pipe','pipe'],
      env:{...process.env,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}}).trim();
  try {
    const commit=git(['rev-parse','HEAD']);
    const remote=git(['remote','get-url','origin']);
    requireRelease(commit===expectedCommit&&git(['status','--porcelain','--untracked-files=all'])==='',
      'AMORA_VIEW_V2_SOURCE_NOT_CLEAN_EXACT_COMMIT');
    requireRelease([ORIGIN,'git@github.com:Kyu-Sung-Cho/wedding-hanbang-web.git'].includes(remote),
      'AMORA_VIEW_V2_ORIGIN_CHANGED');
    return {commit,origin:ORIGIN,clean:true};
  } catch(error) {
    if(error instanceof CurrentBaselineBlocked) throw error;
    fail('AMORA_VIEW_V2_SOURCE_UNAVAILABLE');
  }
}

/** 관찰 영수증도 새 파일만 만든다. 기존 파일/junction/소스 내부 경로를 덮지 않는다. */
export function openAmoraActionViewV2Receipt(file,repoRoot) {
  const target=resolve(file),parent=dirname(target),root=realpathSync(repoRoot);
  const rel=relative(root,target);
  requireRelease(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel),'AMORA_VIEW_V2_RECEIPT_PATH_INVALID');
  let cursor=parse(parent).root;
  for(const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor=join(cursor,part);
    requireRelease(lstatSync(cursor).isDirectory()&&!lstatSync(cursor).isSymbolicLink(),'AMORA_VIEW_V2_RECEIPT_PATH_INVALID');
  }
  requireRelease(realpathSync(parent)===parent,'AMORA_VIEW_V2_RECEIPT_PATH_INVALID');
  const fd=openSync(target,'wx',0o600);
  return {append(value){
    const bytes=Buffer.from(JSON.stringify(value)+'\n');
    let offset=0;
    while(offset<bytes.length) {
      const written=writeSync(fd,bytes,offset,bytes.length-offset,null);
      requireRelease(Number.isSafeInteger(written)&&written>0&&written<=bytes.length-offset,'AMORA_VIEW_V2_RECEIPT_WRITE_INCOMPLETE');
      offset+=written;
    }
    fsyncSync(fd);
  },close:()=>closeSync(fd)};
}

async function managementReadOnlyQuery(sql,{readOnly},token) {
  requireRelease(readOnly===true,'AMORA_VIEW_V2_TRANSPORT_NOT_READ_ONLY');
  try {
    const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(45_000),
    });
    requireRelease(response.ok,'AMORA_VIEW_V2_OBSERVATION_UNAVAILABLE');
    const raw=await response.text();
    requireRelease(Buffer.byteLength(raw)<=256*1024,'AMORA_VIEW_V2_OBSERVATION_UNAVAILABLE');
    return JSON.parse(raw);
  } catch {fail('AMORA_VIEW_V2_OBSERVATION_UNAVAILABLE');}
}

// 주입 transport/source/receipt는 offline 검사 전용이다. 전용 CLI는 주입 인자를 받지 않는다.
export async function runAmoraActionViewV2Release({repoRoot,argv,query,now=()=>new Date(),
  assertSource=assertAmoraActionViewV2Source,receiptFactory=openAmoraActionViewV2Receipt,runCommand,environment}={}) {
  const options=parseAmoraActionViewV2Args(argv??[]);
  // 적용도 실제 admission/복구 검증 뒤 무조건 ROLLBACK을 먼저 확인한다.
  if(['rehearse','apply'].includes(options.mode)) {
    const {runAmoraActionViewV2OperationalRehearsal}=await import('./amora-action-view-v2-operational-rehearsal.mjs');
    return runAmoraActionViewV2OperationalRehearsal({repoRoot,options,query,runCommand,environment,
      ...(assertSource!==assertAmoraActionViewV2Source?{assertSource}:{})});
  }
  const plan=loadAmoraActionViewV2Plan(repoRoot);
  const source=assertSource(repoRoot,options['expected-commit']);
  same(source,{commit:options['expected-commit'],origin:ORIGIN,clean:true},'AMORA_VIEW_V2_SOURCE_BINDING_INVALID');
  if(!query) {
    const token=process.env.SUPABASE_ACCESS_TOKEN;
    requireRelease(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token??''),'AMORA_VIEW_V2_CREDENTIAL_UNAVAILABLE');
    query=(sql,settings)=>managementReadOnlyQuery(sql,settings,token);
  }
  const runtimeSha256=digest(readFileSync(new URL('./amora-action-view-v2-release.mjs',import.meta.url)));
  const catalogSha256=digest(readFileSync(new URL('./amora-action-view-v2-catalog.mjs',import.meta.url)));
  const loaderSha256=digest(readFileSync(new URL('./amora-action-view-v2-release-contract.mjs',import.meta.url)));
  const ledgerSha256=digest(readFileSync(new URL('./amora-action-view-v2-ledger.mjs',import.meta.url)));
  const receipt=receiptFactory(options['receipt-out'],repoRoot);
  const binding={format:'amora-action-view-v2-inspection-receipt-v1',release:RELEASE,projectRef:PROJECT,
    source,contractSha256:plan.contractSha256,sqlSha256:plan.sqlSha256,candidateSha256:plan.candidateSha256,
    migration:plan.migration,runtimeSha256,catalogSha256,loaderSha256,ledgerSha256,
    mode:'inspect',releaseAuthorized:false,remoteWritesPerformed:false};
  const record=(status,extra={})=>receipt.append({...binding,status,recordedAt:now().toISOString(),...extra});
  try {
    const sql=buildAmoraActionViewV2ObservationSql();
    record('inspection-started',{observationSqlSha256:digest(sql)});
    const rows=await query(sql,{readOnly:true});
    requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]?.observation,'AMORA_VIEW_V2_OBSERVATION_INVALID');
    const observation=validateAmoraActionViewV2Inspection(rows[0].observation,{plan,repoRoot,now:now()});
    const fresh=loadAmoraActionViewV2Plan(repoRoot);
    same(fresh.contractSha256,plan.contractSha256,'AMORA_VIEW_V2_SOURCE_CHANGED');
    same(assertSource(repoRoot,options['expected-commit']),source,'AMORA_VIEW_V2_SOURCE_CHANGED');
    requireRelease(digest(readFileSync(new URL('./amora-action-view-v2-release.mjs',import.meta.url)))===runtimeSha256
      &&digest(readFileSync(new URL('./amora-action-view-v2-catalog.mjs',import.meta.url)))===catalogSha256
      &&digest(readFileSync(new URL('./amora-action-view-v2-release-contract.mjs',import.meta.url)))===loaderSha256
      &&digest(readFileSync(new URL('./amora-action-view-v2-ledger.mjs',import.meta.url)))===ledgerSha256,
    'AMORA_VIEW_V2_SOURCE_CHANGED');
    record('inspected-unapplied-not-authorized',{observation,observationSha256:digest(JSON.stringify(observation)),
      remainingGates:['approved-exact-target-catalog','private-backup-restore-fence-provenance-verifier',
        'operational-rollback-rehearsal-and-independent-reobservation','commit-transaction-and-independent-postverify',
        'existing-controller-dispatch-and-ci-wiring','old-writer-retirement-and-insert-contract']});
    return {status:'inspected-unapplied-not-authorized',observation,releaseAuthorized:false,remoteWritesPerformed:false};
  } catch(error) {
    const code=error instanceof CurrentBaselineBlocked&&/^[A-Z0-9_]+$/.test(error.code??'')
      ?error.code:'AMORA_VIEW_V2_UNEXPECTED';
    record('inspection-blocked',{code,retryProhibited:false});
    fail(code);
  } finally {receipt.close();}
}
