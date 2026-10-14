import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAmoraActionViewV2HistoricalRepository} from './fixtures/amora-action-view-v2-history-repository.mjs';

const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
const commit='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const cleanGitEnvironment=()=>({...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^git_/i.test(name))),
 GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'});
const git=(root,args)=>execFileSync('git',['--no-replace-objects','-C',root,...args],{
 env:cleanGitEnvironment(),timeout:30_000,windowsHide:true,stdio:['ignore','pipe','pipe'],
}).toString().trim();
function indexDigest(root) {
 const file=resolve(root,git(root,['rev-parse','--git-path','index']));
 return existsSync(file)?sha(readFileSync(file)):null;
}

test('a foreign B1 fixture ignores hostile hook Git variables and preserves disposable A plus the main index/HEAD',async()=>{
 const parent=realpathSync(tmpdir()),a=mkdtempSync(join(parent,'amora-b1-git-env-A-')),owner=randomUUID();
 writeFileSync(join(a,'.owned-amora-b1-git-env-A'),owner,{flag:'wx'});
 const originalGitEnvironment=Object.entries(process.env).filter(([name])=>/^git_/i.test(name));
 const mainHead=git(sourceRoot,['rev-parse','HEAD']),mainIndex=indexDigest(sourceRoot);
 let fixture;
 try {
  git(a,['init','--quiet']);
  git(a,['-c','protocol.allow=never','-c','protocol.file.allow=always','fetch','--quiet','--no-write-fetch-head','--no-tags','--depth=1',sourceRoot,commit]);
  git(a,['symbolic-ref','HEAD','refs/heads/disposable-A']);git(a,['update-ref','HEAD',commit]);
  writeFileSync(join(a,'sentinel.txt'),'owned synthetic A marker\n',{flag:'wx'});git(a,['add','--','sentinel.txt']);
  const aHead=readFileSync(join(a,'.git/HEAD')),aConfig=readFileSync(join(a,'.git/config')),aIndex=indexDigest(a);
  process.env.GIT_DIR=join(a,'.git');process.env.GIT_WORK_TREE=a;process.env.GIT_COMMON_DIR=join(a,'.git');
  process.env.GIT_INDEX_FILE=join(a,'.git/index');process.env.GIT_OBJECT_DIRECTORY=join(a,'.git/objects');
  // Windows 환경 이름의 대소문자도 제거 대상이다. 모든 값은 이 테스트 소유 A뿐이다.
  process.env.gIt_cOnFiG_cOuNt='1';process.env.gIt_cOnFiG_kEy_0='user.name';process.env.gIt_cOnFiG_vAlUe_0='synthetic-hostile-hook';
  fixture=createAmoraActionViewV2HistoricalRepository(sourceRoot);
  assert.deepEqual(readFileSync(join(a,'.git/HEAD')),aHead,'DISPOSABLE_A_HEAD_CHANGED');
  assert.deepEqual(readFileSync(join(a,'.git/config')),aConfig,'DISPOSABLE_A_CONFIG_CHANGED');
  assert.equal(indexDigest(a),aIndex,'DISPOSABLE_A_INDEX_CHANGED');
  assert.equal(git(sourceRoot,['rev-parse','HEAD']),mainHead,'MAIN_HEAD_CHANGED');
  assert.equal(indexDigest(sourceRoot),mainIndex,'MAIN_INDEX_CHANGED');
  assert.equal(git(fixture.root,['rev-parse','HEAD']),commit);
  const loader=await import(pathToFileURL(join(fixture.root,'scripts/lib/amora-action-view-v2-release-contract.mjs')).href);
  assert.equal(loader.loadAmoraActionViewV2Plan(fixture.root).migrationCount,241);
  assert.equal(fixture.releaseAuthorized,false);
  assert.notEqual(fixture.root,sourceRoot);assert.notEqual(fixture.root,a);
 } finally {
  for(const name of Object.keys(process.env))if(/^git_/i.test(name))delete process.env[name];
  for(const [name,value] of originalGitEnvironment)process.env[name]=value;
  fixture?.cleanup();
  assert.equal(dirname(resolve(a)),parent);assert.equal(realpathSync(a),a);
  assert.equal(readFileSync(join(a,'.owned-amora-b1-git-env-A'),'utf8'),owner);
  rmSync(a,{recursive:true,force:false});
  assert.equal(git(sourceRoot,['rev-parse','HEAD']),mainHead,'MAIN_HEAD_CHANGED_AFTER_CLEANUP');
  assert.equal(indexDigest(sourceRoot),mainIndex,'MAIN_INDEX_CHANGED_AFTER_CLEANUP');
 }
});
