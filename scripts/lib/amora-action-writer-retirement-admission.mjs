import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,realpathSync,openSync,fstatSync,closeSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {CurrentBaselineBlocked,digest,requireRelease,same} from './current-baseline-release-contract.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {PINNED_WINDOWS_PRODUCTION_TOOLCHAIN,resolvePinnedWindowsProductionToolchain} from './production-windows-toolchain.mjs';

const REPO='Kyu-Sung-Cho/wedding-hanbang-web',ORIGIN=`https://github.com/${REPO}.git`;
const SHA=/^[a-f0-9]{40}$/;
const GH={path:'C:\\Program Files\\GitHub CLI\\gh.exe',
  sha256:'E98A646F524D0094FAC3A6C5866EBC8FDCCA0461A11F4146525A15B853E60068'};
const NAMES=Object.freeze(['Web Quality','Web Tests (shard 1/4)','Web Tests (shard 2/4)',
  'Web Tests (shard 3/4)','Web Tests (shard 4/4)','Mobile Quality','Vendor Disclosure Quality',
  'Static Release Contracts (Non-Deploy)','Code Quality (breakage signal only — not a release authorization)']);
const issued=new WeakMap();
const moduleSha=()=>digest(readFileSync(new URL(import.meta.url)));
const vendorManifestSha=root=>digest(readFileSync(join(root,'supabase/release-manifests/vendor-disclosure-v2-20260718.json'),'utf8')
  .replace(/\r\n?/g,'\n'));
const workflowSha=root=>digest(readFileSync(join(root,'.github/workflows/ci.yml')));
/** 기존 Git/PowerShell의 16MiB 계약은 그대로 둔다. 이 고정 GH만 실제 바이트를 최대64MiB로 검증한다. */
export function verifyAmoraWriterRetirementGithubExecutable() {
  const before=lstatSync(GH.path);
  requireRelease(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=64*1024*1024,
    'AMORA_WRITER_RETIREMENT_GITHUB_TOOLCHAIN_INVALID');
  requireRelease(realpathSync(GH.path).toLowerCase()===resolve(GH.path).toLowerCase(),
    'AMORA_WRITER_RETIREMENT_GITHUB_TOOLCHAIN_INVALID');
  for(let cursor=dirname(GH.path);dirname(cursor)!==cursor;cursor=dirname(cursor))
    requireRelease(!lstatSync(cursor).isSymbolicLink(),'AMORA_WRITER_RETIREMENT_GITHUB_TOOLCHAIN_INVALID');
  const fd=openSync(GH.path,'r');
  try {
    const opened=fstatSync(fd),bytes=readFileSync(fd),after=fstatSync(fd),linked=lstatSync(GH.path);
    for(const value of [opened,after,linked]) requireRelease(value.dev===before.dev&&value.ino===before.ino
      &&value.size===before.size&&value.mtimeMs===before.mtimeMs&&value.ctimeMs===before.ctimeMs,
    'AMORA_WRITER_RETIREMENT_GITHUB_TOOLCHAIN_INVALID');
    requireRelease(bytes.length===opened.size&&digest(bytes).toUpperCase()===GH.sha256,
      'AMORA_WRITER_RETIREMENT_GITHUB_TOOLCHAIN_INVALID');return GH.path;
  } finally {closeSync(fd);}
}
const defaultCommand=async (binary,args,{repoRoot,environment})=>{
  environmentSafe(process.env);
  environmentSafe(environment);
  try {
    return execFileSync(binary,args,{cwd:repoRoot,encoding:'utf8',windowsHide:true,timeout:25_000,
      maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe'],env:{...environment,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}});
  } catch {throw new CurrentBaselineBlocked('AMORA_WRITER_RETIREMENT_ADMISSION_READ_UNAVAILABLE');}
};
function environmentSafe(environment) {
  for(const [key,value] of Object.entries(environment)) {
    const normalized=key.toUpperCase();
    requireRelease(!normalized.startsWith('GIT_')&&(!value||!(/^(?:NODE_OPTIONS|NODE_PATH|GH_DEBUG|GH_HOST|GH_REPO|GH_CONFIG_DIR|SUPABASE_CLI_BINARY_OVERRIDE)$/.test(normalized))),
      'AMORA_WRITER_RETIREMENT_ADMISSION_UNSAFE_ENVIRONMENT');
  }
}
async function source(repoRoot,expectedCommit,run) {
  const git=async args=>(await run(PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git.path,
    ['--no-replace-objects','-C',repoRoot,...args],{repoRoot})).trim();
  requireRelease(await git(['rev-parse','HEAD'])===expectedCommit
    &&await git(['status','--porcelain','--untracked-files=all'])==='','AMORA_WRITER_RETIREMENT_ADMISSION_SOURCE_NOT_CLEAN');
  requireRelease([ORIGIN,`git@github.com:${REPO}.git`].includes(await git(['remote','get-url','origin'])),
    'AMORA_WRITER_RETIREMENT_ADMISSION_ORIGIN_CHANGED');
  const branch=await git(['symbolic-ref','--short','HEAD']);
  requireRelease(/^[A-Za-z0-9][A-Za-z0-9/_-]{0,160}$/.test(branch)&&!branch.includes('..'),
    'AMORA_WRITER_RETIREMENT_ADMISSION_BRANCH_INVALID');
  const sourceTree=await git(['rev-parse','HEAD^{tree}']);
  requireRelease(SHA.test(sourceTree),'AMORA_WRITER_RETIREMENT_ADMISSION_TREE_INVALID');
  const remote=await git(['ls-remote','--exit-code','origin',`refs/heads/${branch}`]);
  requireRelease(remote===`${expectedCommit}\trefs/heads/${branch}`,'AMORA_WRITER_RETIREMENT_ADMISSION_REMOTE_CHANGED');
  return {commit:expectedCommit,origin:ORIGIN,branch,sourceTree};
}
function checkoutSha(log) {
  requireRelease(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=8*1024*1024,
    'AMORA_WRITER_RETIREMENT_ADMISSION_JOB_LOG_INVALID');
  const lines=log.split(/\r?\n/).map(line=>line.replace(/^\d{4}-\d\d-\d\dT\S+\s+/,''));
  const found=[];
  for(let i=0;i<lines.length-1;i++) if(/^\[command\][^\r\n]*git(?:\.exe)? log -1 --format=%H$/.test(lines[i])) {
    requireRelease(SHA.test(lines[i+1]),'AMORA_WRITER_RETIREMENT_ADMISSION_CHECKED_COMMIT_UNVERIFIED');
    found.push(lines[i+1]);
  }
  requireRelease(found.length===1,'AMORA_WRITER_RETIREMENT_ADMISSION_CHECKED_COMMIT_UNVERIFIED');
  return found[0];
}

/** CI 검사를 실제 수집한다. source tree와 job checkout tree가 같아야 하며 코드검사는 DB 인가가 아니다. */
export async function collectAmoraWriterRetirementAdmission(options) {
  requireRelease(options&&typeof options==='object'&&!Array.isArray(options)
    &&Object.keys(options).every(key=>['repoRoot','expectedCommit','operatorConfirmation','runCommand','environment'].includes(key))
    &&typeof options.repoRoot==='string'&&SHA.test(options.expectedCommit??''),
  'AMORA_WRITER_RETIREMENT_ADMISSION_ARGUMENT_INVALID');
  const {repoRoot,expectedCommit,operatorConfirmation,runCommand,environment=process.env}=options;
  requireRelease(runCommand!==undefined||!Object.hasOwn(options,'environment'),
    'AMORA_WRITER_RETIREMENT_ADMISSION_ENVIRONMENT_OVERRIDE_FORBIDDEN');
  requireRelease(['rehearse','apply','verify-committed'].some(mode=>operatorConfirmation===
    `amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:${mode}:${expectedCommit}`),
    'AMORA_WRITER_RETIREMENT_ADMISSION_SCOPED_CONFIRMATION_REQUIRED');
  environmentSafe(environment);
  environmentSafe(process.env);
  const fixedEnvironment=Object.freeze({...environment});
  const simulated=runCommand!==undefined;
  requireRelease(!simulated||typeof runCommand==='function','AMORA_WRITER_RETIREMENT_ADMISSION_ARGUMENT_INVALID');
  const run=simulated?runCommand:(binary,args,settings)=>defaultCommand(binary,args,{...settings,environment:fixedEnvironment});
  let tools;
  if(!simulated) {
    tools=await resolvePinnedWindowsProductionToolchain({environment:fixedEnvironment});
    verifyAmoraWriterRetirementGithubExecutable();
  }
  // 공개 manifest hash는 source drift 검사다. DB 작업의 별도 private owner 서명으로 재발급하지 않는다.
  const originalManifestSha=vendorManifestSha(repoRoot);
  const before=await source(repoRoot,expectedCommit,run);
  loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  const runtimeSha256=moduleSha(),workflowSha256=workflowSha(repoRoot);
  const api=async (endpoint,json=true)=>{
    requireRelease(endpoint.startsWith(`repos/${REPO}/`)&&!endpoint.includes('..'),
      'AMORA_WRITER_RETIREMENT_ADMISSION_ENDPOINT_INVALID');
    const raw=await run(GH.path,['api','--hostname','github.com','--method','GET',endpoint],{repoRoot});
    requireRelease(typeof raw==='string'&&Buffer.byteLength(raw)<=8*1024*1024,'AMORA_WRITER_RETIREMENT_ADMISSION_RESPONSE_INVALID');
    if(!json) return raw;
    try {return JSON.parse(raw);} catch {throw new CurrentBaselineBlocked('AMORA_WRITER_RETIREMENT_ADMISSION_RESPONSE_INVALID');}
  };
  const response=await api(`repos/${REPO}/commits/${expectedCommit}/check-runs?per_page=100`);
  requireRelease(Number.isSafeInteger(response.total_count)&&response.total_count<=100
    &&Array.isArray(response.check_runs)&&response.check_runs.length===response.total_count,
  'AMORA_WRITER_RETIREMENT_ADMISSION_CHECKS_INVALID');
  const selected=NAMES.map(name=>response.check_runs.filter(check=>check.name===name)
    .sort((a,b)=>b.id-a.id)[0]);
  const checks=[];
  let runId,checkedCheckoutCommit;
  for(const check of selected) {
    requireRelease(check&&check.head_sha===expectedCommit&&check.status==='completed'&&check.conclusion==='success'
      &&check.app?.slug==='github-actions'&&Number.isSafeInteger(check.id)&&check.id>0,
    'AMORA_WRITER_RETIREMENT_ADMISSION_CHECK_NOT_SUCCESSFUL');
    const escaped=REPO.replaceAll('/','\\/');
    const detail=new RegExp(`^https://github\\.com/${escaped}/actions/runs/(\\d+)/job/(\\d+)$`).exec(check.details_url??'');
    requireRelease(detail&&Number.isSafeInteger(Number(detail[1]))&&Number.isSafeInteger(Number(detail[2]))
      &&Number(detail[1])>0&&Number(detail[2])>0,'AMORA_WRITER_RETIREMENT_ADMISSION_JOB_BINDING_INVALID');
    if(runId===undefined) runId=Number(detail[1]);
    requireRelease(runId===Number(detail[1]),'AMORA_WRITER_RETIREMENT_ADMISSION_MIXED_RUNS');
    const jobId=Number(detail[2]);
    const actualCheckout=checkoutSha(await api(`repos/${REPO}/actions/jobs/${jobId}/logs`,false));
    if(checkedCheckoutCommit===undefined) checkedCheckoutCommit=actualCheckout;
    requireRelease(checkedCheckoutCommit===actualCheckout,'AMORA_WRITER_RETIREMENT_ADMISSION_MIXED_CHECKOUTS');
    checks.push(Object.freeze({name:check.name,id:check.id,jobId,checkoutCommit:actualCheckout}));
  }
  const workflow=await api(`repos/${REPO}/actions/runs/${runId}`);
  requireRelease(workflow.id===runId&&workflow.name==='CI'&&workflow.path==='.github/workflows/ci.yml'
    &&workflow.head_sha===expectedCommit&&workflow.status==='completed'&&workflow.conclusion==='success'
    &&workflow.repository?.full_name===REPO&&workflow.head_repository?.full_name===REPO
    &&Number.isSafeInteger(workflow.run_attempt)&&workflow.run_attempt>0,'AMORA_WRITER_RETIREMENT_ADMISSION_WORKFLOW_INVALID');
  const checked=await api(`repos/${REPO}/git/commits/${checkedCheckoutCommit}`);
  requireRelease(checked.sha===checkedCheckoutCommit&&checked.tree?.sha===before.sourceTree,
    'AMORA_WRITER_RETIREMENT_ADMISSION_CHECKED_TREE_DIFFERENT');
  same(await source(repoRoot,expectedCommit,run),before,'AMORA_WRITER_RETIREMENT_ADMISSION_SOURCE_CHANGED');
  environmentSafe(process.env);
  environmentSafe(fixedEnvironment);
  requireRelease(moduleSha()===runtimeSha256&&workflowSha(repoRoot)===workflowSha256
    &&vendorManifestSha(repoRoot)===originalManifestSha,'AMORA_WRITER_RETIREMENT_ADMISSION_SOURCE_CHANGED');
  const proof=Object.freeze({format:'amora-action-writer-retirement-source-ci-admission-v1',sourceCommit:expectedCommit,
    sourceTree:before.sourceTree,origin:ORIGIN,branch:before.branch,checkedCheckoutCommit,
    checks:Object.freeze(checks),workflowRunId:runId,workflowAttempt:workflow.run_attempt,
    workflowSha256,vendorManifestSha256:originalManifestSha,runtimeSha256,systemBoundarySimulated:simulated,
    operatorAuthorization:'scoped-operator-confirmation',operatorConfirmation,separatePrivateOwnerSignatureVerified:false,
    operationalEvidenceVerified:!simulated,dbReleaseAuthorized:false,observedAt:new Date().toISOString()});
  issued.set(proof,{repoRoot,expectedCommit,run,source:before,runtimeSha256,workflowSha256,
    manifestSha256:originalManifestSha,environment:fixedEnvironment,tools});
  return proof;
}

export async function assertAmoraWriterRetirementAdmission({proof,repoRoot,expectedCommit,forOperationalUse=true}) {
  const state=issued.get(proof);
  requireRelease(state&&state.repoRoot===repoRoot&&state.expectedCommit===expectedCommit,
    'AMORA_WRITER_RETIREMENT_ADMISSION_NOT_ISSUED');
  environmentSafe(process.env);
  environmentSafe(state.environment);
  requireRelease(typeof forOperationalUse==='boolean'&&(!forOperationalUse||proof.operationalEvidenceVerified===true),
    'AMORA_WRITER_RETIREMENT_ADMISSION_OPERATIONAL_SOURCE_REQUIRED');
  requireRelease(Date.now()-Date.parse(proof.observedAt)<120_000&&moduleSha()===state.runtimeSha256
    &&workflowSha(repoRoot)===state.workflowSha256&&vendorManifestSha(repoRoot)===state.manifestSha256,
  'AMORA_WRITER_RETIREMENT_ADMISSION_EXPIRED_OR_CHANGED');
  same(await source(repoRoot,expectedCommit,state.run),state.source,'AMORA_WRITER_RETIREMENT_ADMISSION_SOURCE_CHANGED');
  if(forOperationalUse) {
    await resolvePinnedWindowsProductionToolchain({environment:state.environment});
    verifyAmoraWriterRetirementGithubExecutable();
  }
  environmentSafe(process.env);
  environmentSafe(state.environment);
  return proof;
}
