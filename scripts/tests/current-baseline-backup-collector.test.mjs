import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, rmSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { collectCurrentBackup, durableRelations, relationCaptureSql, MAX_RELATION_BYTES } from '../lib/current-baseline-backup-collector.mjs';
import { createPrivateSink, parseDatabaseConnection, downloadStorageOriginal, beginSnapshotSql, boundedProcess } from '../lib/current-baseline-backup-runtime.mjs';
import { digest } from '../lib/current-baseline-release-contract.mjs';
import { createHistoricalReleaseRepository } from './fixtures/legacy-release-repository.mjs';

const REPO=resolve(import.meta.dirname,'../..');
const historical = createHistoricalReleaseRepository(REPO);
test.after(historical.cleanup);
const COMMIT='b'.repeat(40);
const MARKER='synthetic-private-original-한글-💍';
const blocked=code=>error=>error.code===code;
const privateRoots=[];
test.after(()=>{for(const root of privateRoots){assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.match(basename(root),/^WeddingHanbang-Amora-Backup-SelfTest-[a-f0-9]{32}$/);if(!lstatSync(root).isSymbolicLink())rmSync(root,{recursive:true,force:true});}});
function fixture(options={}) {
  const contract=JSON.parse(readFileSync(join(historical.root,'supabase/release-contracts/current-baseline-rollout-v1.json')));
  const baseline=JSON.parse(readFileSync(join(historical.root,contract.baselineObservation.file)));
  const release={contract,baseline,contractSha256:'1'.repeat(64),baselineSha256:'2'.repeat(64),migrationSetSha256:'3'.repeat(64)};
  const inventory=structuredClone(baseline);inventory.storagePolicies=baseline.storagePolicies.filter(p=>p.command==='r');
  let turn=0;let count=0;let aborted=false;let failure;let completed;let binding;
  const writes=[];const bytes=Buffer.from(MARKER);
  const index=[{bucket:'synthetic-bucket',name:'nested/원문+?.bin',version:'1',bytes:bytes.length},{bucket:'synthetic-bucket',name:'empty',version:null,bytes:0}];
  const source={
    async begin(){turn++;return {readOnly:true,isolation:'repeatable read',fenceCount:1,projectRef:contract.projectRef,systemIdentifier:contract.systemIdentifier,snapshotId:`snapshot-${turn}`,inventory:structuredClone(inventory),...(options.begin??{})};},
    async captureRelation(r){count++;const columns=r.kind==='S'?['last_value','is_called']:['id','value'];let rows=r.kind==='S'?[{last_value:1,is_called:true}]:[{id:1,value:MARKER}];
      if(options.missingColumn)delete rows[0][columns.at(-1)];
      if(options.changedAfter && turn===2 && count===durableRelations(baseline).length+1)rows[0].value='changed';
      if(options.captureError && count===2)throw new Error(MARKER);
      const payload=Buffer.from(JSON.stringify({format:'current-baseline-relation-v1',identity:`${r.schema}.${r.name}`,columns,rows}));
      return {bytes:payload,rows:options.wrongCount?2:rows.length};},
    async storageIndex(){return options.duplicateStorage?[index[0],index[0]]:structuredClone(index);},
    async captureSchema(){return {statements:[`CREATE TABLE public.synthetic (id bigint, value text); -- ${MARKER}`],globals:{roles:[]}};},
    async end(){return {inventory:structuredClone(inventory),fenceCount:options.fenceLost?0:1};},
    async download(object){const b=object.bytes?Buffer.from(bytes):Buffer.alloc(0);if(options.storageChanged && turn===2 && b.length)b[0]=0;return b;},
    commandReceipts(){return [{commandSha256:'4'.repeat(64),outputSha256:'5'.repeat(64),exitCode:0}];},
    async abort(){aborted=true;},
  };
  const sink={
    async initialize(value){binding=value;},
    async write(value){writes.push({...value,bytes:Buffer.from(value.bytes)});return {backup_set_id:binding.backupSetId,artifact:`${value.name}.hbam2`,key:`${value.name}.key.dpapi`,
      plaintext_sha256:options.badCrypto?'f'.repeat(64):digest(value.bytes),plaintext_bytes:value.bytes.length,encrypted_sha256:'6'.repeat(64),key_sha256:'7'.repeat(64),encrypted_bytes:value.bytes.length+128};},
    async progress(){},async finish(value){completed=value;},async fail(value){failure=value;},
  };
  return {release,source,sink,writes,get state(){return {turn,aborted,failure,completed};},run:()=>collectCurrentBackup({release,expectedCommit:COMMIT,source,sink,assertStable:async()=>{}})};
}

test('현재 inventory의 모든 durable relation과 빈 Storage 원본도 빠짐없이 각각 암호화한다',async()=>{
  const f=fixture();const receipt=await f.run();
  assert.equal(receipt.relations.length,durableRelations(f.release.baseline).length);
  assert.equal(receipt.artifacts.length,receipt.relations.length+4);
  assert.equal(receipt.storageObjects.length,2);assert.equal(receipt.status,'captured-awaiting-release-evidence');
  assert.equal(f.state.turn,2);assert.deepEqual(receipt.beforeRelations,receipt.afterRelations);
  assert.ok(!JSON.stringify(receipt).includes(MARKER));assert.ok(!JSON.stringify(receipt).includes('원문+?'));
  assert.ok(f.writes.some(w=>w.bytes.includes(Buffer.from(MARKER))));
  assert.ok(receipt.evidenceNotEstablished.includes('hosted-restore'));
});
test('누락된 원본 컬럼과 행 개수 불일치는 완성 receipt를 만들지 않는다',async()=>{
  for(const options of [{missingColumn:true},{wrongCount:true}]){
    const f=fixture(options);await assert.rejects(f.run,blocked('CAPTURE_PAYLOAD_INVALID'));
    assert.equal(f.state.completed,undefined);assert.equal(f.state.failure.status,'incomplete-do-not-restore');
  }
});
test('두 번째 새 snapshot의 원본 변경과 Storage bytes 변경을 거절한다',async()=>{
  for(const [options,code] of [[{changedAfter:true},'CAPTURE_SOURCE_DATA_CHANGED'],[{storageChanged:true},'CAPTURE_STORAGE_BYTES_CHANGED']]){
    const f=fixture(options);await assert.rejects(f.run,blocked(code));assert.equal(f.state.completed,undefined);assert.equal(f.state.aborted,true);
  }
});
test('다른 프로젝트·쓰기 트랜잭션·없어진 fence에서 원본 수집을 완료하지 않는다',async()=>{
  for(const options of [{begin:{projectRef:'z'.repeat(20)}},{begin:{readOnly:false}},{begin:{isolation:'read committed'}},{fenceLost:true}]){
    const f=fixture(options);await assert.rejects(f.run);assert.equal(f.state.completed,undefined);
  }
});
test('중복 Storage 주소와 암호화 영수증의 원문 지문 불일치를 거절한다',async()=>{
  for(const [options,code] of [[{duplicateStorage:true},'CAPTURE_STORAGE_DUPLICATE'],[{badCrypto:true},'CAPTURE_ENCRYPTION_RECEIPT_INVALID']]){
    const f=fixture(options);await assert.rejects(f.run,blocked(code));assert.equal(f.state.completed,undefined);
  }
});
test('SDK/SQL 실패의 사용자 원문은 공개 오류와 중단 상태에 포함되지 않는다',async()=>{
  const f=fixture({captureError:true});await assert.rejects(f.run,e=>e.message==='CAPTURE_FAILED' && !e.stack.includes(MARKER));
  assert.ok(!JSON.stringify(f.state.failure).includes(MARKER));assert.equal(f.state.completed,undefined);
});
test('실제 PostgreSQL JSON query는 bigint 원문·null·sequence 상태를 보존하며 과대 응답을 반환하지 않는다',async()=>{
  const webRequire=createRequire(join(REPO,'apps/web/package.json'));const {PGlite}=webRequire('@electric-sql/pglite');const db=new PGlite();
  try {
    await db.exec("CREATE TABLE public.synthetic(id bigint,value text,optional text); INSERT INTO public.synthetic VALUES(9007199254740993,'한글',NULL); CREATE SEQUENCE public.synthetic_seq START 12;");
    const result=await db.query(relationCaptureSql({schema:'public',name:'synthetic',kind:'r'}));
    assert.ok(result.rows[0].payload.includes('9007199254740993'));assert.ok(result.rows[0].payload.includes('"optional": null'));
    const sequence=await db.query(relationCaptureSql({schema:'public',name:'synthetic_seq',kind:'S'}));assert.equal(JSON.parse(sequence.rows[0].payload).rows[0].last_value,12);
    await db.exec(`UPDATE public.synthetic SET value=repeat('x',${MAX_RELATION_BYTES});`);
    const oversized=await db.query(relationCaptureSql({schema:'public',name:'synthetic',kind:'r'}));assert.equal(oversized.rows[0].payload,null);
  } finally {await db.close();}
});
test('DB 연결은 정확한 project의 TLS session connection만 허용한다',()=>{
  const projectRef='a'.repeat(20);const ca='-----BEGIN CERTIFICATE-----\nfixture';
  const result=parseDatabaseConnection({databaseUrl:`postgresql://cli_login_supabase_read_only_user.${projectRef}:fixture@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`,projectRef,ca});
  assert.equal(result.ssl.rejectUnauthorized,true);
  assert.equal(result.readerRole,'supabase_read_only_user');
  assert.equal(parseDatabaseConnection({databaseUrl:`postgresql://cli_login_postgres.${projectRef}:fixture@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`,projectRef,ca}).readerRole,'postgres');
  for(const databaseUrl of [`postgresql://postgres:fixture@db.${'b'.repeat(20)}.supabase.co/postgres`,`postgresql://postgres.${projectRef}:fixture@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres`,`postgresql://postgres:fixture@db.${projectRef}.supabase.co/postgres?sslmode=disable`])assert.throws(()=>parseDatabaseConnection({databaseUrl,projectRef,ca}));
});
test('실제 snapshot 트랜잭션은 쓰기를 금지하고 RLS로 원문이 숨겨지면 빈 성공 대신 오류가 난다',async()=>{
  const webRequire=createRequire(join(REPO,'apps/web/package.json'));const {PGlite}=webRequire('@electric-sql/pglite');const db=new PGlite();
  try {
    await db.exec('CREATE TABLE public.capture_private(id integer); INSERT INTO public.capture_private VALUES(1); CREATE ROLE supabase_read_only_user; GRANT SELECT ON public.capture_private TO supabase_read_only_user; ALTER TABLE public.capture_private ENABLE ROW LEVEL SECURITY;');
    await db.exec(beginSnapshotSql('postgres'));
    await assert.rejects(()=>db.exec('INSERT INTO public.capture_private VALUES(2);'),e=>e.code==='25006');await db.exec('ROLLBACK;');
    await db.exec(beginSnapshotSql('supabase_read_only_user'));
    await assert.rejects(()=>db.query('SELECT * FROM public.capture_private;'),e=>e.code==='42501');await db.exec('ROLLBACK;');
    const rows=await db.query('SELECT count(*)::integer AS n FROM public.capture_private;');assert.equal(rows.rows[0].n,1);
  } finally {await db.close();}
});
test('Storage HTTP는 원래 객체 주소·private origin·redirect 거부와 실제 binary stream 상한을 지킨다',async()=>{
  const projectRef='a'.repeat(20);const serviceKey='synthetic-service-key';const object={bucket:'synthetic-bucket',name:'nested/한글+?#.bin',bytes:4};let calls=0;
  const bytes=await downloadStorageOriginal({projectRef,serviceKey,object,fetchImpl:async(url,options)=>{
    calls++;assert.equal(new URL(url).origin,`https://${projectRef}.supabase.co`);assert.equal(new URL(url).pathname,'/storage/v1/object/authenticated/synthetic-bucket/nested/%ED%95%9C%EA%B8%80%2B%3F%23.bin');
    assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,serviceKey);assert.equal(options.signal.aborted,false);
    return new Response(Uint8Array.from([0,255,1,2]));}});
  assert.deepEqual(bytes,Buffer.from([0,255,1,2]));assert.equal(calls,1);
  for(const name of ['../other','nested/./other'])await assert.rejects(()=>downloadStorageOriginal({projectRef,serviceKey,object:{...object,name},fetchImpl:async()=>{throw new Error('must not fetch');}}),blocked('CAPTURE_STORAGE_PATH_INVALID'));
  for(const response of [new Response(Uint8Array.from([1,2,3,4,5])),new Response(Uint8Array.from([1,2])),new Response(null,{status:302,headers:{location:'https://outside.invalid'}})]){
    await assert.rejects(()=>downloadStorageOriginal({projectRef,serviceKey,object,fetchImpl:async()=>response}));
  }
});
test('schema dump는 exit 뒤 남은 stdout까지 close에서 수집하고 실패 뒤 잔여 원문을 지운다',async()=>{
  const child=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{};return c;};
  const good=child();let settled=false;
  const result=boundedProcess('synthetic',[],{},100,()=>good).then(bytes=>{settled=true;return bytes;});
  good.stdout.emit('data',Buffer.from('CREATE '));good.emit('exit',0);await Promise.resolve();assert.equal(settled,false);
  good.stdout.emit('data',Buffer.from('TABLE synthetic(id int);'));good.emit('close',0);
  assert.equal((await result).toString(),'CREATE TABLE synthetic(id int);');
  const bad=child();const rejected=boundedProcess('synthetic',[],{},2,()=>bad);const first=Buffer.from('private');bad.stdout.emit('data',first);
  await assert.rejects(rejected,blocked('CAPTURE_SCHEMA_DUMP_FAILED'));const late=Buffer.from('late-private');bad.stdout.emit('data',late);bad.emit('close',1);
  assert.deepEqual(first,Buffer.alloc(first.length));assert.deepEqual(late,Buffer.alloc(late.length));
});
test('실제 Windows HBAM2/DPAPI worker는 원문을 디스크에 쓰지 않고 왕복하며 중단본을 incomplete로 남긴다',{skip:process.platform!=='win32'},async()=>{
  const selfTestRoot=join(tmpdir(),`WeddingHanbang-Amora-Backup-SelfTest-${randomUUID().replaceAll('-','')}`);privateRoots.push(selfTestRoot);
  const f=fixture();const sink=createPrivateSink({repoRoot:REPO,selfTestRoot});
  try {
    const result=await collectCurrentBackup({release:f.release,expectedCommit:COMMIT,source:f.source,sink,assertStable:async()=>{}});
    assert.equal(JSON.parse(readFileSync(join(sink.directory,'capture-state.json'))).status,'captured-awaiting-release-evidence');
    assert.equal(result.artifacts.length,durableRelations(f.release.baseline).length+4);
    for(const part of readdirSync(join(sink.directory,'encrypted'))){for(const file of readdirSync(join(sink.directory,'encrypted',part))){
      const bytes=readFileSync(join(sink.directory,'encrypted',part,file));assert.ok(!bytes.includes(Buffer.from(MARKER)));assert.ok(file.endsWith('.hbam2')||file.endsWith('.dpapi'));}}
    await sink.close();
    const failing=fixture({captureError:true});const failedSink=createPrivateSink({repoRoot:REPO,selfTestRoot});
    try {await assert.rejects(()=>collectCurrentBackup({release:failing.release,expectedCommit:COMMIT,source:failing.source,sink:failedSink,assertStable:async()=>{}}));
      assert.equal(JSON.parse(readFileSync(join(failedSink.directory,'capture-state.json'))).status,'incomplete-do-not-restore');assert.ok(!readdirSync(failedSink.directory).includes('capture-receipt.json'));
    } finally {await failedSink.close();}
  } finally {await sink.close();}
});
