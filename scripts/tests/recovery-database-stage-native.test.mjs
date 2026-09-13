import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { capturePostgresSnapshotArchive, archiveProcessEnvironment } from '../lib/postgres-snapshot-archive.mjs';
import { relationCaptureSql } from '../lib/current-baseline-backup-collector.mjs';
import { verifyRecoveryArtifactSet, recoveryDigest as sha } from '../lib/recovery-artifact-set.mjs';
import { restoreSyntheticDatabaseStage } from '../lib/recovery-database-stage.mjs';

const require = createRequire(import.meta.url), { Client } = require('pg');
const nativeBin = process.env.HANBANG_SYNTHETIC_PG_BIN || (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA, 'WeddingHanbangTools/postgresql-17.10/pgsql/bin') : '');
const binary = name => join(nativeBin, name + (process.platform === 'win32' ? '.exe' : ''));
const available = nativeBin && ['initdb','postgres','pg_ctl','pg_dump','pg_restore'].every(name => existsSync(binary(name)));
const baseEnv = () => Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','PATH','TEMP','TMP']
  .filter(name => process.env[name]).map(name => [name, process.env[name]]));
const PREFIX = 'hanbang-recovery-stage-';
const native = (file,args) => {
  try { return execFileSync(file,args,{env:baseEnv(),windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}); }
  catch { throw new Error('RECOVERY_FIXTURE_NATIVE_FAILED'); }
};
async function cluster() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), PREFIX)), marker = randomUUID(), data = join(root,'data');
  writeFileSync(join(root,'owner'),marker,{flag:'wx',mode:0o600});
  const password = randomBytes(24).toString('hex'), passwordPath = join(root,'password');
  writeFileSync(passwordPath,password+'\n',{flag:'wx',mode:0o600});
  let processHandle, closed, client, port;
  const close = async () => {
    await client?.end().catch(()=>{});
    assert.equal(dirname(resolve(root)),realpathSync(tmpdir()));assert.ok(basename(root).startsWith(PREFIX));
    assert.equal(lstatSync(root).isSymbolicLink(),false);assert.equal(readFileSync(join(root,'owner'),'utf8'),marker);
    if(processHandle?.exitCode===null&&processHandle.signalCode===null){
      const pid=readFileSync(join(data,'postmaster.pid'),'utf8').split(/\r?\n/);
      assert.equal(Number(pid[0]),processHandle.pid);assert.equal(resolve(pid[1]),resolve(data));
      native(binary('pg_ctl'),['-D',data,'-m','fast','-w','-t','15','stop']);await closed;
    }
    assert.equal(existsSync(join(data,'postmaster.pid')),false);
    rmSync(root,{recursive:true,force:false});
  };
  try {
    native(binary('initdb'),['-D',data,'--username=postgres','--auth-host=scram-sha-256','--auth-local=scram-sha-256',
      '--pwfile='+passwordPath,'--encoding=UTF8','--no-locale']);rmSync(passwordPath);
    const listener=createServer();await new Promise((done,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',done)});
    port=listener.address().port;await new Promise(done=>listener.close(done));
    processHandle=spawn(binary('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','unix_socket_directories=',
      '-c','ssl=off','-c','max_connections=10'],{env:baseEnv(),windowsHide:true,stdio:['ignore','pipe','pipe']});
    processHandle.stdout.on('data',value=>value.fill(0));processHandle.stderr.on('data',value=>value.fill(0));
    closed=new Promise(done=>processHandle.once('close',done));
    const connection={host:'127.0.0.1',port,user:'postgres',password,database:'postgres'};
    for(let i=0;i<100;i++){
      assert.equal(processHandle.exitCode,null);const probe=new Client({...connection,connectionTimeoutMillis:500,query_timeout:20000});
      try{await probe.connect();client=probe;break}catch{await probe.end().catch(()=>{});await delay(100)}
    }
    assert.ok(client);
    const actual=(await client.query(`SELECT (SELECT system_identifier::text FROM pg_control_system()) AS system,
      current_setting('data_directory') AS data,current_setting('listen_addresses') AS listen`)).rows[0];
    assert.equal(resolve(actual.data),resolve(data));assert.equal(actual.listen,'127.0.0.1');
    return {client,connection,system:actual.system,close};
  }catch(error){await close();throw error}
}

test('new native target executor: wrong target and nonempty target stop; complete archive compares bigint/sequence and keeps failures resumable',
  {skip:available?false:'native PG17 absent; actual target-stage restoration NOT verified',timeout:180000},async t=>{
    const source=await cluster();t.after(()=>source.close());
    const target=await cluster();t.after(()=>target.close());
    const database='hanbang_restore_'+randomUUID().replaceAll('-','');
    await target.client.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    await source.client.query(`CREATE TABLE public.recovery_subject(id bigint PRIMARY KEY,detail jsonb,amount numeric(30,10));
      INSERT INTO public.recovery_subject VALUES(9007199254740993,'{"id":9007199254740993}',12345678901234567890.1234567890);
      CREATE SEQUENCE public.recovery_sequence START 19;SELECT setval('public.recovery_sequence',41,true)`);
    const relationArtifacts=[];
    for(const relation of [{schema:'public',name:'recovery_sequence',kind:'S'},{schema:'public',name:'recovery_subject',kind:'r'}]){
      const row=(await source.client.query(relationCaptureSql(relation))).rows[0];
      relationArtifacts.push({scope:'relation:'+relation.schema+'.'+relation.name,bytes:Buffer.from(row.payload)});
    }
    await source.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot=(await source.client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const binding={candidate:{commit:'1'.repeat(40),tree:'2'.repeat(40)},backupSetId:randomUUID(),
      source:{projectRef:'syntheticlocalonly00',systemIdentifier:source.system}};
    const captured=await capturePostgresSnapshotArchive({snapshotId:snapshot,readerRole:'postgres',
      pgDump:binary('pg_dump'),pgDumpSha256:sha(readFileSync(binary('pg_dump'))),
      pgRestore:binary('pg_restore'),pgRestoreSha256:sha(readFileSync(binary('pg_restore'))),requiredSchemas:['public'],
      connectionEnv:{PGHOST:'127.0.0.1',PGPORT:String(source.connection.port),PGDATABASE:'postgres',PGUSER:'postgres',
        PGPASSWORD:source.connection.password,PGSSLMODE:'disable'},
      binding:{projectRef:binding.source.projectRef,systemIdentifier:source.system,releaseCommit:binding.candidate.commit,
        backupSetId:binding.backupSetId,hotfixSha256:'3'.repeat(64),baselineSha256:'4'.repeat(64)}});
    await source.client.query('COMMIT');
    const artifacts=[{scope:'database-custom-archive',bytes:captured.bytes},
      {scope:'schema-original',bytes:Buffer.from(JSON.stringify({format:'current-baseline-schema-original-v1',
        statements:['synthetic fixture schema'],objects:[],ledger:[],globals:{roles:[{rolname:'postgres'}],memberships:[]}}))},
      {scope:'storage-index',bytes:Buffer.from(JSON.stringify({format:'current-baseline-storage-index-v1',objects:[]}))},...relationArtifacts];
    const manifestBytes=Buffer.from(JSON.stringify({format:'full-restore-artifact-manifest-v1',...binding,
      artifacts:artifacts.map(row=>({scope:row.scope,bytes:row.bytes.length,sha256:sha(row.bytes)})).sort((a,b)=>a.scope<b.scope?-1:1)}));
    const bundle=verifyRecoveryArtifactSet({manifestBytes,expectedManifestSha256:sha(manifestBytes),binding,artifacts});
    t.after(()=>{bundle.dispose();captured.bytes.fill(0);for(const part of relationArtifacts)part.bytes.fill(0)});
    const records=[],parameters={bundle,connection:{...target.connection,database},targetSystemIdentifier:target.system,
      pgRestore:binary('pg_restore'),pgRestoreSha256:sha(readFileSync(binary('pg_restore'))),
      checkpoint:async record=>{records.push(record)}};
    await assert.rejects(restoreSyntheticDatabaseStage({...parameters,targetSystemIdentifier:source.system}),/RECOVERY_TARGET_INVALID/);
    await assert.rejects(restoreSyntheticDatabaseStage({...parameters,targetSystemIdentifier:'9999999999999999999'}),/RECOVERY_TARGET_IDENTITY_CHANGED/);
    assert.equal(records.some(record=>record.restoreAttempted),false);
    const result=await restoreSyntheticDatabaseStage(parameters);
    assert.equal(result.databaseStageExecuted,true);assert.equal(result.restoredDurableRelations,2);
    assert.equal(result.relationPayloadsMatched,true);assert.equal(result.fullRestoreVerified,false);
    const readback=new Client({...target.connection,database});await readback.connect();
    try{
      assert.equal((await readback.query('SELECT id::text,amount::text FROM public.recovery_subject')).rows[0].id,'9007199254740993');
      assert.equal((await readback.query('SELECT last_value::text FROM public.recovery_sequence')).rows[0].last_value,'41');
    }finally{await readback.end()}
    await assert.rejects(restoreSyntheticDatabaseStage(parameters),/RECOVERY_TARGET_NOT_EMPTY/);
    const second='hanbang_restore_'+randomUUID().replaceAll('-','');await target.client.query(`CREATE DATABASE "${second}" TEMPLATE template0`);
    let processCalls=0;
    await assert.rejects(restoreSyntheticDatabaseStage({...parameters,connection:{...target.connection,database:second},
      checkpoint:async record=>{if(record.phase==='before-database-restore')throw new Error('private journal unavailable')},
      runProcess:async()=>{processCalls++;throw new Error('must not run')}}),/RECOVERY_NATIVE_STAGE_FAILED/);
    assert.equal(processCalls,0,'a missing durable pre-write checkpoint prevents pg_restore');
    const failureRecords=[];
    await assert.rejects(restoreSyntheticDatabaseStage({...parameters,connection:{...target.connection,database:second},
      checkpoint:async record=>failureRecords.push(record),runProcess:async()=>{throw new Error('do not output raw SDK credentials')}}),/RECOVERY_NATIVE_STAGE_FAILED/);
    assert.equal(failureRecords.at(-1).partialTargetRetained,true);
    assert.equal(JSON.stringify(failureRecords).includes('credentials'),false);
  });
