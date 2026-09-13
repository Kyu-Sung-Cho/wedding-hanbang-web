import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url), { Client } = require('pg');
const nativeBin = process.env.HANBANG_SYNTHETIC_PG_BIN || (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA, 'WeddingHanbangTools/postgresql-17.10/pgsql/bin') : '');
const binary = name => join(nativeBin, name + (process.platform === 'win32' ? '.exe' : ''));
export const nativeProfileRoleAvailable = nativeBin && ['initdb','postgres','pg_ctl','pg_dump','pg_restore'].every(name => existsSync(binary(name)));
const baseEnv = () => Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','PATH','TEMP','TMP']
  .filter(name => process.env[name]).map(name => [name, process.env[name]]));
const PREFIX = 'hanbang-profile-role-catalog-';
const native = (file,args) => {
  try { return execFileSync(file,args,{env:baseEnv(),windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}); }
  catch { throw new Error('RECOVERY_FIXTURE_NATIVE_FAILED'); }
};
export async function createProfileRoleNativeDatabase() {
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
