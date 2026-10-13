import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const COMMIT='dfdd87eaf724baa938a1c0bd459afe0d022c1c4b';
const TREE='6542436d697a6fd7b4afa6a63cadb78029a8f1bd';
const MANIFEST_SHA='7ba0bb52dae9d860a064a892a4c8a5144f1ae60a7345eb9d866e0a428e0e7a3e';
const PREFIX='amora-b1-history-dfdd87ea-';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Git hook의 저장소 선택 변수가 foreign fixture를 원본 checkout으로 돌리지 못하게 한다.
const foreignGitEnvironment=()=>({...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^git_/i.test(name))),
 GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'});
const valid=file=>typeof file==='string'&&!isAbsolute(file)&&!file.includes('\\')&&!file.includes(':')
 &&file.split('/').every(part=>part&&part!=='.'&&part!=='..');
const SUITES=new Set(['amora-action-view-v2-admission','amora-action-view-v2-bridge','amora-action-view-v2-commit',
 'amora-action-view-v2-native-recovery','amora-action-view-v2-original-capture','amora-action-view-v2-private-journal',
 'amora-action-view-v2-private-store','amora-action-view-v2-recovery','amora-action-view-v2-rehearsal',
 'amora-action-view-v2-runtime','amora-action-view-v2']);
function within(root,target) {
 const delta=relative(root,target);
 assert.ok(delta&&!isAbsolute(delta)&&delta!=='..'&&!delta.startsWith(`..${sep}`),'B1_HISTORY_SCOPE_ESCAPE');
}
function noLinks(root) {
 const stat=lstatSync(root);assert.equal(stat.isSymbolicLink(),false,'B1_HISTORY_LINK_FORBIDDEN');
 if(stat.isDirectory())for(const name of readdirSync(root))noLinks(join(root,name));
}
function readPinned(root,pin,limit=64*1024*1024) {
 assert.ok(valid(pin.file)&&Number.isSafeInteger(pin.bytes)&&pin.bytes>=0&&pin.bytes<=limit);
 let target=root;
 for(const part of pin.file.split('/')){target=join(target,part);assert.equal(lstatSync(target).isSymbolicLink(),false);}
 within(root,realpathSync(target));
 const before=lstatSync(target),bytes=readFileSync(target),after=lstatSync(target);
 assert.ok(before.isFile());
 assert.deepEqual([after.dev,after.ino,after.size,after.mtimeMs],[before.dev,before.ino,before.size,before.mtimeMs]);
 assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256,'B1_HISTORY_DEPENDENCY_BYTES_CHANGED');
 return bytes;
}
function installedPackages(sourceRoot) {
 const roots=new Map();
 const visit=(request,name)=>{
  if(roots.has(name))return;
  let root=dirname(request.resolve(name));
  while(!existsSync(join(root,'package.json'))||JSON.parse(readFileSync(join(root,'package.json'))).name!==name){
   const next=dirname(root);assert.notEqual(next,root,'B1_HISTORY_DEPENDENCY_MISSING');root=next;
  }
  root=realpathSync(root);roots.set(name,root);
  const metadata=JSON.parse(readFileSync(join(root,'package.json'))),child=createRequire(join(root,'package.json'));
  for(const dependency of Object.keys(metadata.dependencies??{}).sort())visit(child,dependency);
 };
 visit(createRequire(join(sourceRoot,'package.json')),'pg');
 roots.set('@electric-sql/pglite',realpathSync(join(sourceRoot,'apps/web/node_modules/@electric-sql/pglite')));
 return roots;
}

/** Test-only exact historical graph. The current source242 is never filtered or authorized. */
export function createAmoraActionViewV2HistoricalRepository(sourceRoot) {
 assert.ok(isAbsolute(sourceRoot));sourceRoot=realpathSync(sourceRoot);
 const manifestBytes=readFileSync(new URL('./amora-action-view-v2-history-repository.manifest.json',import.meta.url));
 assert.equal(sha(manifestBytes),MANIFEST_SHA,'B1_HISTORY_MANIFEST_CHANGED');
 const manifest=JSON.parse(manifestBytes);
 assert.equal(manifest.format,'amora-action-view-v2-history-test-closure-v1');
 assert.equal(manifest.sourceCommit,COMMIT);assert.equal(manifest.sourceTree,TREE);
 assert.equal(manifest.kind,'owned-history-fixture-not-operational-evidence');assert.equal(manifest.releaseAuthorized,false);
 assert.equal(manifest.files.length,549);assert.equal(manifest.packages.length,14);
 let previous='';
 for(const pin of manifest.files){
  assert.ok(valid(pin.file)&&(!previous||previous.localeCompare(pin.file)<0));previous=pin.file;
  assert.match(pin.blob,/^[a-f0-9]{40}$/);assert.match(pin.sha256,/^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(pin.bytes)&&pin.bytes>=0&&pin.bytes<=4*1024*1024);
 }
 const output=execFileSync('git',['--no-replace-objects','-C',sourceRoot,'-c','protocol.allow=never','cat-file','--batch'],{
  input:manifest.files.map(pin=>pin.blob).join('\n')+'\n',
  maxBuffer:manifest.files.reduce((n,pin)=>n+pin.bytes,0)+manifest.files.length*128,
  timeout:30_000,windowsHide:true,stdio:['pipe','pipe','pipe'],
  env:foreignGitEnvironment(),
 });
 let cursor=0;
 const originals=manifest.files.map(pin=>{
  const end=output.indexOf(10,cursor);assert.ok(end>=cursor,'B1_HISTORY_GIT_BYTES_UNAVAILABLE');
  assert.equal(output.subarray(cursor,end).toString('ascii'),`${pin.blob} blob ${pin.bytes}`,'B1_HISTORY_GIT_BYTES_UNAVAILABLE');
  const bytes=output.subarray(end+1,end+1+pin.bytes);assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
  cursor=end+1+pin.bytes;assert.equal(output[cursor++],10);return{pin,bytes};
 });
 assert.equal(cursor,output.length);
 const packageRoots=installedPackages(sourceRoot);
 assert.deepEqual([...packageRoots.keys()].sort(),manifest.packages.map(p=>p.name).sort());
 const dependencyOriginals=[];
 for(const pkg of manifest.packages){
  const originalRoot=packageRoots.get(pkg.name);noLinks(originalRoot);
  const metadata=JSON.parse(readFileSync(join(originalRoot,'package.json')));
  assert.equal(metadata.name,pkg.name);assert.equal(metadata.version,pkg.version);
  for(const pin of pkg.files)dependencyOriginals.push({file:(pkg.name==='@electric-sql/pglite'?'apps/web/node_modules/':'node_modules/')
   +pkg.name+'/'+pin.file,pin,originalRoot,bytes:readPinned(originalRoot,pin)});
 }
 const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,PREFIX)),owner=randomUUID();
 writeFileSync(join(root,'.owned-b1-history-fixture'),owner,{flag:'wx'});
 let closed=false;
 const cleanup=()=>{
  if(closed)return;
  assert.equal(dirname(resolve(root)),parent);assert.ok(basename(root).startsWith(PREFIX));
  assert.equal(realpathSync(root),root);assert.equal(readFileSync(join(root,'.owned-b1-history-fixture'),'utf8'),owner);
  noLinks(root);rmSync(root,{recursive:true,force:false});closed=true;
 };
 try {
  for(const {pin,bytes} of originals){const target=resolve(root,pin.file);within(root,target);
   mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});}
  for(const {file,bytes,pin,originalRoot} of dependencyOriginals){const target=resolve(root,file);within(root,target);
   mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});
   assert.equal(sha(readFileSync(target)),pin.sha256);readPinned(originalRoot,pin);}
  for(const {pin} of originals)readPinned(root,pin);
  assert.equal(readdirSync(join(root,'supabase/migrations')).filter(file=>/\.sql$/i.test(file)).length,241);
  // 원래 source-refusal case도 실제 Git 경계를 읽는다. 완전한 checkout이나 clean 운영 소스로 가장하지 않는다.
  // 고정된 실제 commit만 로컬 객체 저장소에서 가져오며 외부 fetch/얕은 이력 대체는 없다.
  const fixtureGit=args=>execFileSync('git',['--no-replace-objects','-C',root,...args],{
   timeout:30_000,windowsHide:true,stdio:['ignore','pipe','pipe'],
   env:foreignGitEnvironment(),
  });
  fixtureGit(['init','--quiet']);
  fixtureGit(['-c','protocol.allow=never','-c','protocol.file.allow=always','fetch','--quiet','--no-write-fetch-head',
   '--no-tags','--depth=1',sourceRoot,COMMIT]);
  fixtureGit(['symbolic-ref','HEAD','refs/heads/history-b1-fixture']);
  fixtureGit(['update-ref','HEAD',COMMIT]);
  fixtureGit(['remote','add','origin','https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git']);
  assert.equal(fixtureGit(['rev-parse','HEAD']).toString().trim(),COMMIT);
  assert.equal(fixtureGit(['rev-parse','HEAD^{tree}']).toString().trim(),TREE);
  assert.notEqual(fixtureGit(['status','--porcelain','--untracked-files=all']).toString().trim(),'');
  return Object.freeze({root,cleanup,sourceCommit:COMMIT,sourceTree:TREE,manifestSha256:MANIFEST_SHA,
   kind:'owned-history-fixture-not-operational-evidence',runtimeFixtureClosureVerified:true,releaseAuthorized:false});
 }catch(error){cleanup();throw error;}
}

/** Original cases register directly with node:test; no subprocess hides counts/failures/skips. */
export async function registerAmoraActionViewV2HistoricalSuite(sourceRoot,suite) {
 assert.ok(SUITES.has(suite),'B1_HISTORY_SUITE_NOT_REVIEWED');
 const fixture=createAmoraActionViewV2HistoricalRepository(sourceRoot);
 try { await import(pathToFileURL(join(fixture.root,'scripts/tests',suite+'.test.mjs')).href); }
 catch(error){fixture.cleanup();throw error;}
 test.after(fixture.cleanup);
}
