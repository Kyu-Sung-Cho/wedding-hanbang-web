import {execFileSync} from 'node:child_process';
import {CurrentBaselineBlocked,requireRelease,digest} from './current-baseline-release-contract.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {PINNED_WINDOWS_PRODUCTION_TOOLCHAIN,resolvePinnedWindowsProductionToolchain} from './production-windows-toolchain.mjs';
import {buildAmoraWriterRetirementObservationSql,validateAmoraWriterRetirementObservation} from './amora-action-writer-retirement-catalog.mjs';
import {readAmoraWriterRetirementBoundedJsonResponse} from './amora-action-writer-retirement-http.mjs';
import {runAmoraWriterRetirementOperationalRehearsal} from './amora-action-writer-retirement-operational-rehearsal.mjs';
import {runAmoraWriterRetirementApply} from './amora-action-writer-retirement-runtime.mjs';

const PROJECT='slrtobkksjmxgzatjyqb',RELEASE='amora-action-writer-retirement-transport-20261013';
const ORIGIN='https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git';
export function parseAmoraWriterRetirementArgs(argv){
  requireRelease(Array.isArray(argv)&&argv.every(arg=>typeof arg==='string'),'AMORA_WRITER_CLI_ARGUMENT_INVALID');
  const value={};
  for(const arg of argv){
    if(arg===AMORA_WRITER_RETIREMENT_MODE){requireRelease(!Object.hasOwn(value,'selected'),'AMORA_WRITER_CLI_ARGUMENT_DUPLICATE');value.selected=true;continue;}
    if(['--inspect','--rehearse','--apply'].includes(arg)){
      requireRelease(!Object.hasOwn(value,'mode'),'AMORA_WRITER_CLI_ARGUMENT_DUPLICATE');value.mode=arg.slice(2);continue;
    }
    const match=/^--(expected-commit|project-ref|confirm-production)=(.+)$/.exec(arg);
    requireRelease(match&&!Object.hasOwn(value,match[1]),'AMORA_WRITER_CLI_ARGUMENT_INVALID');value[match[1]]=match[2];
  }
  requireRelease(value.selected===true&&['inspect','rehearse','apply'].includes(value.mode)
    &&/^[a-f0-9]{40}$/.test(value['expected-commit']??'')&&value['project-ref']===PROJECT,'AMORA_WRITER_CLI_ARGUMENT_INVALID');
  if(value.mode==='inspect')requireRelease(!Object.hasOwn(value,'confirm-production'),'AMORA_WRITER_CLI_ARGUMENT_INVALID');
  else requireRelease(value['confirm-production']===`${RELEASE}:${PROJECT}:${value.mode}:${value['expected-commit']}`,
    'AMORA_WRITER_CLI_CONFIRMATION_REQUIRED');
  return Object.freeze(value);
}
function safeEnvironment(){
  for(const [key,value] of Object.entries(process.env))requireRelease(!key.toUpperCase().startsWith('GIT_')
    &&(!value||!/^(?:NODE_OPTIONS|NODE_PATH|GH_DEBUG|GH_HOST|GH_REPO|GH_CONFIG_DIR|SUPABASE_CLI_BINARY_OVERRIDE)$/i.test(key)),
  'AMORA_WRITER_CLI_UNSAFE_ENVIRONMENT');
}
async function actualInspectionSource(repoRoot,expectedCommit){
  safeEnvironment();const environment=Object.freeze({...process.env});
  await resolvePinnedWindowsProductionToolchain({environment});
  const git=args=>{
    safeEnvironment();return execFileSync(PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git.path,
      ['--no-replace-objects','-C',repoRoot,...args],{cwd:repoRoot,encoding:'utf8',windowsHide:true,timeout:25_000,
        stdio:['ignore','pipe','pipe'],env:{...environment,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}}).trim();
  };
  try{
    requireRelease(git(['rev-parse','HEAD'])===expectedCommit&&git(['status','--porcelain','--untracked-files=all'])==='',
      'AMORA_WRITER_CLI_SOURCE_NOT_CLEAN');
    requireRelease([ORIGIN,'git@github.com:Kyu-Sung-Cho/wedding-hanbang-web.git'].includes(git(['remote','get-url','origin'])),
      'AMORA_WRITER_CLI_ORIGIN_CHANGED');
    const tree=git(['rev-parse','HEAD^{tree}']);requireRelease(/^[a-f0-9]{40}$/.test(tree),'AMORA_WRITER_CLI_SOURCE_NOT_CLEAN');
    return Object.freeze({commit:expectedCommit,origin:ORIGIN,tree,clean:true,sourceCiVerified:false});
  }catch(error){if(error instanceof CurrentBaselineBlocked)throw error;throw new CurrentBaselineBlocked('AMORA_WRITER_CLI_SOURCE_UNAVAILABLE');}
}

/** No old controller callbacks/clock or operator SQL can reach this release. Inspection is pre-apply/read-only and never authority. */
export async function runAmoraWriterRetirementRelease(input){
  requireRelease(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).sort().join(',')==='argv,repoRoot'
    &&typeof input.repoRoot==='string','AMORA_WRITER_CLI_ARGUMENT_INVALID');
  const {repoRoot}=input,options=parseAmoraWriterRetirementArgs(input.argv),expectedCommit=options['expected-commit'];
  loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});safeEnvironment();
  if(options.mode==='apply')return runAmoraWriterRetirementApply({repoRoot,expectedCommit,operatorConfirmation:options['confirm-production']});
  if(options.mode==='rehearse')return runAmoraWriterRetirementOperationalRehearsal({repoRoot,expectedCommit,operatorConfirmation:options['confirm-production']});
  const source=await actualInspectionSource(repoRoot,expectedCommit),sql=buildAmoraWriterRetirementObservationSql({repoRoot,phase:'before'});
  const token=process.env.SUPABASE_ACCESS_TOKEN;
  requireRelease(typeof token==='string'&&/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token),'AMORA_WRITER_CLI_CREDENTIAL_UNAVAILABLE');
  const signal=AbortSignal.timeout(45_000);let rows;
  try{
    const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:sql,read_only:true}),signal});
    rows=await readAmoraWriterRetirementBoundedJsonResponse(response,{signal});
  }catch{throw new CurrentBaselineBlocked('AMORA_WRITER_CLI_INSPECTION_UNAVAILABLE');}
  requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]?.b2_observation,'AMORA_WRITER_CLI_RESPONSE_INVALID');
  const observation=validateAmoraWriterRetirementObservation(rows[0].b2_observation,{repoRoot,phase:'before',expectedNativeSystemIdentifier:null,beforeObservation:null});
  requireRelease(JSON.stringify(await actualInspectionSource(repoRoot,expectedCommit))===JSON.stringify(source),'AMORA_WRITER_CLI_SOURCE_CHANGED');
  return Object.freeze({status:'inspected-operating230-unapplied-not-authorized',source,observationSha256:observation.observationSha256,
    inspectionSqlSha256:digest(sql),ledgerCount:230,transportReadOnlyFlag:true,sqlReadOnly:true,
    sourceCiVerified:false,privateOriginal7Verified:false,nativeReplayVerified:false,releaseAuthorized:false,remoteWritesPerformed:false});
}
