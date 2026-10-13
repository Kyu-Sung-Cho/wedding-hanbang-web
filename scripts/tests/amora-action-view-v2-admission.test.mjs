import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const moduleUrl=new URL('../lib/amora-action-view-v2-admission.mjs',import.meta.url);
const commit='a'.repeat(40),checkout='c'.repeat(40),tree='d'.repeat(40);
const repo='Kyu-Sung-Cho/wedding-hanbang-web';
const names=['Web Quality','Web Tests (shard 1/4)','Web Tests (shard 2/4)','Web Tests (shard 3/4)',
  'Web Tests (shard 4/4)','Mobile Quality','Vendor Disclosure Quality','Static Release Contracts (Non-Deploy)',
  'Code Quality (breakage signal only — not a release authorization)'];
const checks=names.map((name,index)=>({id:100+index,name,head_sha:commit,status:'completed',conclusion:'success',
  app:{slug:'github-actions'},check_suite:{id:55},started_at:'2026-10-13T00:00:00Z',
  details_url:`https://github.com/${repo}/actions/runs/150/job/${100+index}`}));
const commandBoundary=async (binary,args)=>{
  if(binary.endsWith('git.exe')) {
    const text=args.join(' ');
    if(text.includes('status --porcelain')) return '';
    if(text.includes('remote get-url origin')) return `https://github.com/${repo}.git`;
    if(text.includes('symbolic-ref --short HEAD')) return 'codex/amora-action-cas-web-20261012';
    if(text.includes('rev-parse HEAD^{tree}')) return tree;
    if(text.includes('rev-parse HEAD')) return commit;
    if(text.includes('ls-remote')) return `${commit}\trefs/heads/codex/amora-action-cas-web-20261012\n`;
  }
  const endpoint=args.find(arg=>arg.startsWith('repos/'));
  if(endpoint===`repos/${repo}/commits/${commit}/check-runs?per_page=100`) return JSON.stringify({total_count:checks.length,check_runs:checks});
  if(endpoint===`repos/${repo}/actions/runs/150`) return JSON.stringify({id:150,name:'CI',path:'.github/workflows/ci.yml',
    head_sha:commit,status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo},run_attempt:1});
  if(/^repos\/[^/]+\/[^/]+\/actions\/jobs\/\d+\/logs$/.test(endpoint??''))
    return `2026-10-13T00:01:00Z [command]/usr/bin/git log -1 --format=%H\n2026-10-13T00:01:00Z ${checkout}\n`;
  if(endpoint===`repos/${repo}/git/commits/${checkout}`) return JSON.stringify({sha:checkout,tree:{sha:tree}});
  throw new Error('unexpected read-only command');
};

test('actual quality job checkout trees bind immutable remote source and scoped operator confirmation, not a private signature claim',async()=>{
  const {collectAmoraActionViewV2Admission,assertAmoraActionViewV2Admission}=await import(moduleUrl);
  const proof=await collectAmoraActionViewV2Admission({repoRoot,expectedCommit:commit,runCommand:commandBoundary,
    operatorConfirmation:'amora-action-view-v2-20261012:slrtobkksjmxgzatjyqb:rehearse:'+commit,environment:{}});
  assert.equal(proof.sourceCommit,commit);
  assert.equal(proof.sourceTree,tree);
  assert.equal(proof.checks.length,9);
  assert.equal(proof.checkedCheckoutCommit,checkout);
  assert.equal(proof.dbReleaseAuthorized,false);
  assert.equal(proof.operatorAuthorization,'scoped-operator-confirmation');
  assert.equal(proof.separatePrivateOwnerSignatureVerified,false);
  await assertAmoraActionViewV2Admission({proof,repoRoot,expectedCommit:commit,forOperationalUse:false});
  await assert.rejects(()=>assertAmoraActionViewV2Admission({proof,repoRoot,expectedCommit:commit}),
    error=>error.code==='AMORA_VIEW_V2_ADMISSION_OPERATIONAL_SOURCE_REQUIRED');
  await assert.rejects(()=>assertAmoraActionViewV2Admission({proof:structuredClone(proof),repoRoot,expectedCommit:commit,forOperationalUse:false}),
    error=>error.code==='AMORA_VIEW_V2_ADMISSION_NOT_ISSUED');
});

test('scoped confirmation, remote source, successful trusted checks and the actual checked tree cannot be replaced or mixed',async()=>{
  const {collectAmoraActionViewV2Admission}=await import(moduleUrl);
  const common={repoRoot,expectedCommit:commit,
    operatorConfirmation:'amora-action-view-v2-20261012:slrtobkksjmxgzatjyqb:rehearse:'+commit,environment:{}};
  await assert.rejects(()=>collectAmoraActionViewV2Admission({...common,operatorConfirmation:'private-signature-verified',runCommand:commandBoundary}),
    error=>error.code==='AMORA_VIEW_V2_ADMISSION_SCOPED_CONFIRMATION_REQUIRED');
  const variants=[
    {match:a=>a.join(' ').includes('ls-remote'),change:()=>`${'f'.repeat(40)}\trefs/heads/codex/amora-action-cas-web-20261012`,code:'AMORA_VIEW_V2_ADMISSION_REMOTE_CHANGED'},
    {match:a=>a.some(x=>x.includes('/check-runs?')),change:raw=>{const v=JSON.parse(raw);v.check_runs[0].conclusion='skipped';return JSON.stringify(v);},code:'AMORA_VIEW_V2_ADMISSION_CHECK_NOT_SUCCESSFUL'},
    {match:a=>a.some(x=>x.includes('/check-runs?')),change:raw=>{const v=JSON.parse(raw);v.check_runs[0].app.slug='unknown-app';return JSON.stringify(v);},code:'AMORA_VIEW_V2_ADMISSION_CHECK_NOT_SUCCESSFUL'},
    {match:a=>a.some(x=>x.endsWith('/logs')),change:()=>'{"verified":true}',code:'AMORA_VIEW_V2_ADMISSION_CHECKED_COMMIT_UNVERIFIED'},
    {match:a=>a.some(x=>x.includes('/git/commits/')),change:raw=>{const v=JSON.parse(raw);v.tree.sha='e'.repeat(40);return JSON.stringify(v);},code:'AMORA_VIEW_V2_ADMISSION_CHECKED_TREE_DIFFERENT'},
  ];
  for(const variant of variants) {
    const runCommand=async(binary,args)=>{const raw=await commandBoundary(binary,args);return variant.match(args)?variant.change(raw):raw;};
    await assert.rejects(()=>collectAmoraActionViewV2Admission({...common,runCommand}),error=>error.code===variant.code);
  }
});

test('the default collector cannot validate a supplied empty environment while executing a different real environment',async()=>{
  const {collectAmoraActionViewV2Admission}=await import(moduleUrl);
  await assert.rejects(()=>collectAmoraActionViewV2Admission({repoRoot,expectedCommit:commit,environment:{},
    operatorConfirmation:'amora-action-view-v2-20261012:slrtobkksjmxgzatjyqb:rehearse:'+commit}),
  error=>error.code==='AMORA_VIEW_V2_ADMISSION_ENVIRONMENT_OVERRIDE_FORBIDDEN');
});

test('Windows environment names cannot bypass unsafe loader and Git overrides by using different case',async()=>{
  const {collectAmoraActionViewV2Admission}=await import(moduleUrl);
  for(const name of ['node_options','Node_Path','git_config_key_0','Gh_Host']) {
    let commands=0;
    await assert.rejects(()=>collectAmoraActionViewV2Admission({repoRoot,expectedCommit:commit,
      operatorConfirmation:'amora-action-view-v2-20261012:slrtobkksjmxgzatjyqb:rehearse:'+commit,
      environment:{[name]:'unsafe-override'},runCommand:async(...args)=>{commands++;return commandBoundary(...args);}}),
    error=>error.code==='AMORA_VIEW_V2_ADMISSION_UNSAFE_ENVIRONMENT');
    assert.equal(commands,0);
  }
});

test('the dedicated GitHub CLI pin verifies its actual larger executable without relaxing the old toolchain bounds',
  {skip:process.platform!=='win32'},async()=>{
    const {verifyAmoraActionViewV2GithubExecutable}=await import(moduleUrl);
    assert.equal(verifyAmoraActionViewV2GithubExecutable(),'C:\\Program Files\\GitHub CLI\\gh.exe');
  });
