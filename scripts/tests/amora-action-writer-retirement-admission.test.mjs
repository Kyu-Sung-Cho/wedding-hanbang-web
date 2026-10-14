import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {collectAmoraWriterRetirementAdmission,assertAmoraWriterRetirementAdmission} from '../lib/amora-action-writer-retirement-admission.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const expectedCommit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';
const confirmation=`amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:rehearse:${expectedCommit}`;

test('inherited Git common repository routing is rejected before any source or external command',async()=>{
  let commands=0;
  await assert.rejects(collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation:confirmation,
    environment:{GIT_COMMON_DIR:'C:/owned-synthetic-common-only'},
    runCommand:async()=>{commands++;throw new Error('unexpected source command');}}),
  error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_UNSAFE_ENVIRONMENT');
  assert.equal(commands,0);
});

test('all inherited Git names, Windows name variants and even empty Git variables fail closed before commands',async()=>{
  for(const key of ['GIT_NAMESPACE','GIT_SHALLOW_FILE','GIT_CONFIG_PARAMETERS','GIT_EXEC_PATH','GIT_REPLACE_REF_BASE',
    'GIT_NO_LAZY_FETCH','GIT_TERMINAL_PROMPT','git_common_dir','gIt_CoMmOn_DiR','GIT_FUTURE_ROUTING_OPTION']) {
    for(const value of ['C:/synthetic-only','']) {
      let commands=0;
      await assert.rejects(collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation:confirmation,
        environment:{[key]:value},runCommand:async()=>{commands++;throw new Error('unexpected command');}}),
      error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_UNSAFE_ENVIRONMENT');
      assert.equal(commands,0);
    }
  }
});

test('a caller environment cannot silently replace the default subprocess environment',async()=>{
  await assert.rejects(collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,
    operatorConfirmation:confirmation,environment:{}}),
  error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_ENVIRONMENT_OVERRIDE_FORBIDDEN');
});

const names=['Web Quality','Web Tests (shard 1/4)','Web Tests (shard 2/4)','Web Tests (shard 3/4)','Web Tests (shard 4/4)',
  'Mobile Quality','Vendor Disclosure Quality','Static Release Contracts (Non-Deploy)',
  'Code Quality (breakage signal only — not a release authorization)'];
function syntheticBoundary() {
  const sourceTree='d'.repeat(40),checkout='b'.repeat(40),calls=[];
  const runCommand=async(binary,args)=>{
    calls.push({binary,args});
    if(args[0]==='--no-replace-objects') {
      const operation=args.slice(3).join(' ');
      if(operation==='rev-parse HEAD')return expectedCommit+'\n';
      if(operation==='status --porcelain --untracked-files=all')return '';
      if(operation==='remote get-url origin')return 'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git\n';
      if(operation==='symbolic-ref --short HEAD')return 'owned-synthetic-source\n';
      if(operation==='rev-parse HEAD^{tree}')return sourceTree+'\n';
      if(operation==='ls-remote --exit-code origin refs/heads/owned-synthetic-source')
        return expectedCommit+'\trefs/heads/owned-synthetic-source\n';
      throw new Error('unexpected synthetic Git operation');
    }
    const endpoint=args.at(-1);
    if(endpoint.includes('/check-runs?'))return JSON.stringify({total_count:9,check_runs:names.map((name,index)=>({
      name,id:200+index,head_sha:expectedCommit,status:'completed',conclusion:'success',app:{slug:'github-actions'},
      details_url:`https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/34/job/${500+index}`}))});
    if(endpoint.endsWith('/logs'))return `[command]/usr/bin/git log -1 --format=%H\n${checkout}\n`;
    if(endpoint.endsWith('/actions/runs/34'))return JSON.stringify({id:34,name:'CI',path:'.github/workflows/ci.yml',
      head_sha:expectedCommit,status:'completed',conclusion:'success',repository:{full_name:'Kyu-Sung-Cho/wedding-hanbang-web'},
      head_repository:{full_name:'Kyu-Sung-Cho/wedding-hanbang-web'},run_attempt:1});
    if(endpoint.endsWith('/git/commits/'+checkout))return JSON.stringify({sha:checkout,tree:{sha:sourceTree}});
    throw new Error('unexpected synthetic GitHub operation');
  };
  return {runCommand,calls};
}
async function withIsolatedSyntheticGitEnvironment(callback) {
  const inherited=Object.entries(process.env).filter(([key])=>/^GIT_/i.test(key));
  // Only this injected/non-operational test boundary is isolated; production retains rejection, not silent stripping.
  for(const [key] of inherited)delete process.env[key];
  try {return await callback();}finally {for(const [key,value] of inherited)process.env[key]=value;}
}

test('an injected full source/CI boundary stays non-operational and a later actual environment change is rejected',async()=>{
  await withIsolatedSyntheticGitEnvironment(async()=>{
  const boundary=syntheticBoundary();
  const proof=await collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation:confirmation,
    environment:{},runCommand:boundary.runCommand});
  assert.equal(proof.systemBoundarySimulated,true);
  assert.equal(proof.operationalEvidenceVerified,false);
  assert.equal(proof.dbReleaseAuthorized,false);
  await assert.rejects(assertAmoraWriterRetirementAdmission({proof,repoRoot,expectedCommit}),
    error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_OPERATIONAL_SOURCE_REQUIRED');
  await assertAmoraWriterRetirementAdmission({proof,repoRoot,expectedCommit,forOperationalUse:false});
  await assert.rejects(assertAmoraWriterRetirementAdmission({proof:structuredClone(proof),repoRoot,expectedCommit,forOperationalUse:false}),
    error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_NOT_ISSUED');
  const key='gIt_CoMmOn_DiR',previous=process.env[key],callsBefore=boundary.calls.length;
  try {
    process.env[key]='C:/synthetic-actual-env-only';
    await assert.rejects(assertAmoraWriterRetirementAdmission({proof,repoRoot,expectedCommit,forOperationalUse:false}),
      error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_UNSAFE_ENVIRONMENT');
    assert.equal(boundary.calls.length,callsBefore);
  } finally {if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
  });
});

test('collection rechecks the actual process environment after awaited source/CI calls',async()=>{
  await withIsolatedSyntheticGitEnvironment(async()=>{
  const boundary=syntheticBoundary(),key='GIT_COMMON_DIR',previous=process.env[key];
  const runCommand=async(...args)=>{
    const result=await boundary.runCommand(...args);
    if(args[1].at(-1).endsWith?.('/git/commits/'+'b'.repeat(40)))process.env[key]='C:/synthetic-late-env-only';
    return result;
  };
  try {
    await assert.rejects(collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation:confirmation,
      environment:{},runCommand}),error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_UNSAFE_ENVIRONMENT');
  } finally {if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
  });
});

test('issued proof assertion rechecks current environment after its last awaited source read',async()=>{
  await withIsolatedSyntheticGitEnvironment(async()=>{
    const boundary=syntheticBoundary(),key='GIT_NAMESPACE',previous=process.env[key];
    let changeAtLastRead=false;
    const runCommand=async(...args)=>{
      const result=await boundary.runCommand(...args);
      if(changeAtLastRead&&args[1].includes('ls-remote'))process.env[key]='synthetic-late-assert-namespace';
      return result;
    };
    try {
      const proof=await collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation:confirmation,
        environment:{},runCommand});
      changeAtLastRead=true;
      await assert.rejects(assertAmoraWriterRetirementAdmission({proof,repoRoot,expectedCommit,forOperationalUse:false}),
        error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_UNSAFE_ENVIRONMENT');
    } finally {if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
  });
});

test('fresh post-only source CI admission is scoped to verification and still cannot authorize operational writes',async()=>{
  await withIsolatedSyntheticGitEnvironment(async()=>{
    const boundary=syntheticBoundary();
    const postConfirmation=`amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:verify-committed:${expectedCommit}`;
    const proof=await collectAmoraWriterRetirementAdmission({repoRoot,expectedCommit,operatorConfirmation:postConfirmation,
      environment:{},runCommand:boundary.runCommand});
    assert.equal(proof.operatorConfirmation,postConfirmation);
    assert.equal(proof.dbReleaseAuthorized,false);
    assert.equal(proof.operationalEvidenceVerified,false);
    await assert.rejects(assertAmoraWriterRetirementAdmission({proof,repoRoot,expectedCommit}),
      error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_OPERATIONAL_SOURCE_REQUIRED');
    await assertAmoraWriterRetirementAdmission({proof,repoRoot,expectedCommit,forOperationalUse:false});
    const {runAmoraWriterRetirementRehearsalWithAdmission}=await import('../lib/amora-action-writer-retirement-operational-rehearsal.mjs');
    await assert.rejects(runAmoraWriterRetirementRehearsalWithAdmission({repoRoot,expectedCommit,admission:proof,
      operatorConfirmation:`amora-action-writer-retirement-transport-20261013:slrtobkksjmxgzatjyqb:apply:${expectedCommit}`}),
      error=>error.code==='AMORA_WRITER_REHEARSAL_ARGUMENT_INVALID');
    await assert.rejects(assertAmoraWriterRetirementAdmission({proof:structuredClone(proof),repoRoot,expectedCommit,forOperationalUse:false}),
      error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_NOT_ISSUED');
    const actualNow=Date.now;
    try{
      // 과거 apply의 120초 인가를 갱신하지 않는다. 새 읽기 전용 단계도 같은 만료 경계를 갖는다.
      Date.now=()=>Date.parse(proof.observedAt)+120_000;
      await assert.rejects(assertAmoraWriterRetirementAdmission({proof,repoRoot,expectedCommit,forOperationalUse:false}),
        error=>error.code==='AMORA_WRITER_RETIREMENT_ADMISSION_EXPIRED_OR_CHANGED');
    }finally{Date.now=actualNow;}
  });
});
