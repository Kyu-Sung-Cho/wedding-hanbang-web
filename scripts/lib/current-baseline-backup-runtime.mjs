import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { digest, digestJson, pinnedArtifact, loadCurrentBaselineContract, requireRelease } from './current-baseline-release-contract.mjs';
import { relationCaptureSql, MAX_RELATION_BYTES, MAX_STORAGE_BYTES } from './current-baseline-backup-collector.mjs';
import { analyzeReadOnlySqlEnvelope } from './sql-read-only-envelope.mjs';

const require = createRequire(import.meta.url);
const globalsSql = `SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r)-'oid' ORDER BY rolname) FROM pg_roles r),
'memberships',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),
'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option)
ORDER BY pg_get_userbyid(roleid),pg_get_userbyid(member)) FROM pg_auth_members)) AS globals;`;
const storageSql = `SELECT bucket_id AS bucket,name,version::text, (metadata->>'size')::text AS bytes FROM storage.objects ORDER BY bucket_id,name;`;
function fixedBody(sql) {
  requireRelease(analyzeReadOnlySqlEnvelope(sql).ok, 'CAPTURE_SOURCE_SQL_NOT_READONLY');
  requireRelease(/^BEGIN TRANSACTION READ ONLY;/.test(sql) && /(?:COMMIT|ROLLBACK);\s*$/.test(sql), 'CAPTURE_SOURCE_SQL_ENVELOPE');
  return sql.replace(/^BEGIN TRANSACTION READ ONLY;\s*/, '').replace(/\s*(?:COMMIT|ROLLBACK);\s*$/, '');
}
const pinFile = (file, expected) => {
  requireRelease(isAbsolute(file) && /^[a-f0-9]{64}$/.test(expected) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'CAPTURE_TOOL_PIN_INVALID');
  requireRelease(digest(readFileSync(file)) === expected, 'CAPTURE_TOOL_PIN_CHANGED');
};

export function createSourceFence(repoRoot, release, expectedCommit) {
  const files = ['scripts/current-baseline-backup-collect.mjs','scripts/current-baseline-backup-worker.ps1',
    'scripts/lib/current-baseline-backup-collector.mjs','scripts/lib/current-baseline-backup-runtime.mjs',
    'scripts/amora-db-backup-common.ps1','pnpm-lock.yaml',release.contract.implementation.inventory.file,
    release.contract.implementation.writeFenceCheck.file];
  const git = args => execFileSync('git', args, { cwd: repoRoot, windowsHide: true, timeout: 10000, maxBuffer: 8*1024*1024 });
  const hashes = files.map(file => ({ file, sha256: digest(git(['show',`${expectedCommit}:${file}`])) }));
  const check = async () => {
    requireRelease(git(['rev-parse','HEAD']).toString().trim() === expectedCommit && git(['status','--porcelain','--untracked-files=all']).length === 0, 'CAPTURE_WORKTREE_NOT_FROZEN');
    requireRelease(git(['remote','get-url','origin']).toString().trim() === release.contract.expectedOrigin, 'CAPTURE_ORIGIN_MISMATCH');
    requireRelease(readFileSync(resolve(repoRoot,'supabase/.temp/project-ref'),'utf8').trim() === release.contract.projectRef, 'CAPTURE_PROJECT_LINK_CHANGED');
    requireRelease(loadCurrentBaselineContract(repoRoot).contractSha256 === release.contractSha256, 'CAPTURE_CONTRACT_CHANGED');
    for (const pin of hashes) pinnedArtifact(repoRoot, pin, 8*1024*1024);
  };
  return { check, hashes };
}

export function createPrivateSink({ repoRoot, selfTestRoot, powershell = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' }) {
  const args = ['-NoProfile','-NonInteractive','-File',resolve(repoRoot,'scripts/current-baseline-backup-worker.ps1')];
  if (selfTestRoot) args.push('-SelfTest','-SelfTestBackupRoot',selfTestRoot);
  const env = { ...process.env };
  for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];
  // 수집용 인증값은 암호화 worker에 전달하지 않는다.
  for (const name of Object.keys(env)) if (/SUPABASE|DATABASE_URL|PGPASSWORD|PGHOST|PGUSER/.test(name)) delete env[name];
  const child = spawn(powershell,args,{ windowsHide:true, stdio:['pipe','pipe','pipe'],env });
  const lines = createInterface({ input:child.stdout }); let pending; let closed = false; let directory;
  const exited=new Promise(resolvePromise=>child.once('close',resolvePromise));
  const rejected = () => { if (pending) { const p=pending; pending=null; clearTimeout(p.timer); p.reject(Object.assign(new Error('CAPTURE_PRIVATE_WRITER_FAILED'),{code:'CAPTURE_PRIVATE_WRITER_FAILED'})); } };
  child.stderr.on('data',()=>{}); child.on('error',rejected); child.stdin.on('error',rejected);
  child.on('exit',()=>{ closed=true; rejected(); });
  lines.on('line',line=>{
    if (!pending) return;
    const p=pending; pending=null; clearTimeout(p.timer);
    try { const result=JSON.parse(line); requireRelease(result.ok === true,'CAPTURE_PRIVATE_WRITER_FAILED'); p.resolve(result); }
    catch { p.reject(Object.assign(new Error('CAPTURE_PRIVATE_WRITER_FAILED'),{code:'CAPTURE_PRIVATE_WRITER_FAILED'})); }
  });
  const call = request => new Promise((resolvePromise,reject)=>{
    if (closed || pending) { reject(Object.assign(new Error('CAPTURE_PRIVATE_WRITER_FAILED'),{code:'CAPTURE_PRIVATE_WRITER_FAILED'})); return; }
    const timer=setTimeout(()=>{ rejected(); child.kill(); },60000);
    pending={resolve:resolvePromise,reject,timer}; child.stdin.write(JSON.stringify(request)+'\n');
  });
  return {
    async initialize(binding) { directory=(await call({op:'initialize',...binding})).directory; },
    async write({directory:part,name,bytes}) { return (await call({op:'write',directory:part,name,base64:bytes.toString('base64')})).metadata; },
    async progress(value) { await call({op:'progress',...value}); },
    async finish(receipt) { await call({op:'finish',receipt}); child.stdin.end(); },
    async fail(value) { try { await call({op:'fail',...value}); } finally { child.stdin.end(); } },
    get directory() { return directory; },
    async close() { child.stdin.end(); const timer=setTimeout(()=>{if(!closed)child.kill();},1000);try{await exited;}finally{clearTimeout(timer);} },
  };
}

export function parseDatabaseConnection({ databaseUrl, projectRef, ca }) {
  let url; try { url=new URL(databaseUrl); } catch { requireRelease(false,'CAPTURE_DATABASE_URL_INVALID'); }
  requireRelease(url.protocol === 'postgresql:' || url.protocol === 'postgres:', 'CAPTURE_DATABASE_URL_INVALID');
  requireRelease(url.search === '' && url.hash === '' && url.pathname === '/postgres' && (url.port === '' || url.port === '5432'), 'CAPTURE_DATABASE_URL_INVALID');
  const user=decodeURIComponent(url.username);
  const direct=url.hostname === `db.${projectRef}.supabase.co`;
  const pooler=/^[a-z0-9-]+\.(?:[a-z0-9-]+\.)?pooler\.supabase\.com$/.test(url.hostname);
  requireRelease((direct && ['postgres','cli_login_postgres','cli_login_supabase_read_only_user'].includes(user))
    || (pooler && ['postgres','cli_login_postgres','cli_login_supabase_read_only_user'].some(r=>user === `${r}.${projectRef}`)), 'CAPTURE_DATABASE_PROJECT_MISMATCH');
  requireRelease(url.password.length > 0 && typeof ca === 'string' && ca.includes('-----BEGIN CERTIFICATE-----'), 'CAPTURE_DATABASE_TLS_REQUIRED');
  return { host:url.hostname, port:5432, database:'postgres',user,password:decodeURIComponent(url.password),
    readerRole:user.startsWith('cli_login_supabase_read_only_user')?'supabase_read_only_user':'postgres',
    ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:10000,query_timeout:60000,application_name:'hanbang-current-baseline-capture' };
}

export function beginSnapshotSql(readerRole) {
  requireRelease(['postgres','supabase_read_only_user'].includes(readerRole),'CAPTURE_READER_ROLE_INVALID');
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL ROLE ${readerRole}; SET LOCAL row_security=off; SET LOCAL statement_timeout='30s';`;
}

export async function boundedProcess(file,args,env,limit,spawnImpl=spawn) {
  return new Promise((resolvePromise,reject)=>{
    const child=spawnImpl(file,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']}); const chunks=[]; let length=0; let failed=false;
    const fail=()=>{ if(failed)return; failed=true; clearTimeout(timeout); child.kill(); chunks.forEach(b=>b.fill(0)); reject(Object.assign(new Error('CAPTURE_SCHEMA_DUMP_FAILED'),{code:'CAPTURE_SCHEMA_DUMP_FAILED'})); };
    const timeout=setTimeout(fail,120000);
    child.stdout.on('data',data=>{if(failed){data.fill(0);return;}length+=data.length;if(length>limit){data.fill(0);fail();}else chunks.push(data);});child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timeout);fail();});child.on('close',code=>{
      clearTimeout(timeout);if(failed)return;if(code !== 0){fail();return;}
      const output=Buffer.concat(chunks); chunks.forEach(b=>b.fill(0));resolvePromise(output);
    });
  });
}

export async function downloadStorageOriginal({projectRef,serviceKey,object,fetchImpl=fetch}) {
  requireRelease(/^[a-z0-9]{20}$/.test(projectRef) && typeof object.bucket === 'string' && object.bucket.length>0 && !object.bucket.includes('/')
    && typeof object.name === 'string' && object.name.length>0 && ![object.bucket,...object.name.split('/')].some(part=>part === '.' || part === '..')
    && Number.isSafeInteger(object.bytes) && object.bytes>=0 && object.bytes<=MAX_STORAGE_BYTES,'CAPTURE_STORAGE_PATH_INVALID');
  const path=[object.bucket,...object.name.split('/')].map(encodeURIComponent).join('/');
  const response=await fetchImpl(`https://${projectRef}.supabase.co/storage/v1/object/authenticated/${path}`,
    {headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},redirect:'error',signal:AbortSignal.timeout(30000)});
  requireRelease(response.status===200 && response.body,'CAPTURE_STORAGE_READ_FAILED');
  const announced=response.headers.get('content-length');if(announced!==null)requireRelease(Number(announced)===object.bytes,'CAPTURE_STORAGE_SIZE_MISMATCH');
  const chunks=[];let size=0;const reader=response.body.getReader();
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;requireRelease(size<=MAX_STORAGE_BYTES && size<=object.bytes,'CAPTURE_STORAGE_SIZE_MISMATCH');chunks.push(Buffer.from(value));}
    requireRelease(size===object.bytes,'CAPTURE_STORAGE_SIZE_MISMATCH');return Buffer.concat(chunks);
  } finally {await reader.cancel().catch(()=>{});chunks.forEach(b=>b.fill(0));}
}

export async function createPostgresSource({ repoRoot, release, databaseUrl, caFile, caSha256, pgDump, pgDumpSha256, serviceKey, fetchImpl = fetch }) {
  pinFile(caFile,caSha256);pinFile(pgDump,pgDumpSha256);
  const config=parseDatabaseConnection({databaseUrl,projectRef:release.contract.projectRef,ca:readFileSync(caFile,'utf8')});
  requireRelease(typeof serviceKey === 'string' && serviceKey.length >= 20,'CAPTURE_STORAGE_CREDENTIAL_MISSING');
  const inventoryText=fixedBody(pinnedArtifact(repoRoot,release.contract.implementation.inventory).toString('utf8'));
  const fenceText=fixedBody(pinnedArtifact(repoRoot,release.contract.implementation.writeFenceCheck).toString('utf8'));
  const {Client}=require('pg'); const client=new Client(config);
  try{await client.connect();}catch{await client.end().catch(()=>{});throw Object.assign(new Error('CAPTURE_DATABASE_CONNECT_FAILED'),{code:'CAPTURE_DATABASE_CONNECT_FAILED'});}
  let active=false;let snapshotId;const commands=[];
  const sql = async text=>{
    const result=await client.query(text);
    const sets=Array.isArray(result)?result:[result];
    commands.push({commandSha256:digest(text),outputSha256:digestJson(sets.map(x=>x.rows)),exitCode:0});
    return sets.at(-1).rows;
  };
  const observe=async()=>({inventory:(await sql(inventoryText))[0].observation,fenceCount:Number((await sql(fenceText))[0].production_write_fence_verified_count)});
  return {
    async begin(){
      requireRelease(!active,'CAPTURE_TRANSACTION_ACTIVE');
      active=true;await sql(beginSnapshotSql(config.readerRole));
      const identity=(await sql("SELECT current_setting('transaction_read_only')='on' AS readonly,current_setting('transaction_isolation') AS isolation,(SELECT system_identifier::text FROM pg_control_system()) AS system,pg_export_snapshot() AS snapshot,current_user AS actor;"))[0];
      requireRelease(identity.actor === config.readerRole,'CAPTURE_READER_ROLE_INVALID');snapshotId=identity.snapshot;
      return {readOnly:identity.readonly,isolation:identity.isolation,systemIdentifier:identity.system,snapshotId,
        projectRef:release.contract.projectRef,...await observe()};
    },
    async captureRelation(relation){
      requireRelease(active,'CAPTURE_TRANSACTION_REQUIRED');const row=(await sql(relationCaptureSql(relation)))[0];
      requireRelease(row && row.payload !== null && Number.isSafeInteger(Number(row.bytes)) && Number(row.bytes)<=MAX_RELATION_BYTES,'CAPTURE_PAYLOAD_SIZE');
      const bytes=Buffer.from(row.payload,'utf8');requireRelease(bytes.length===Number(row.bytes),'CAPTURE_PAYLOAD_SIZE');return {bytes,rows:Number(row.rows)};
    },
    async storageIndex(){
      requireRelease(active,'CAPTURE_TRANSACTION_REQUIRED');return (await sql(storageSql)).map(r=>({...r,bytes:r.bytes === null?NaN:Number(r.bytes)}));
    },
    async captureSchema(){
      requireRelease(active && /^[a-fA-F0-9-]+$/.test(snapshotId),'CAPTURE_SNAPSHOT_INVALID');pinFile(pgDump,pgDumpSha256);pinFile(caFile,caSha256);
      const env={PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,TEMP:process.env.TEMP,PGHOST:config.host,PGPORT:'5432',PGDATABASE:'postgres',PGUSER:config.user,
        PGPASSWORD:config.password,PGSSLMODE:'verify-full',PGSSLROOTCERT:caFile,PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c default_transaction_read_only=on -c row_security=off'};
      const args=['--schema-only','--snapshot',snapshotId,`--role=${config.readerRole}`,'--no-password'];
      const bytes=await boundedProcess(pgDump,args,env,MAX_RELATION_BYTES);
      try { requireRelease(bytes.length>0,'CAPTURE_SCHEMA_MISSING');commands.push({commandSha256:digestJson({pgDumpSha256,args}),outputSha256:digest(bytes),exitCode:0});
        return {statements:[bytes.toString('utf8')],globals:(await sql(globalsSql))[0].globals}; }
      finally{bytes.fill(0);}
    },
    async end(){requireRelease(active,'CAPTURE_TRANSACTION_REQUIRED');const observation=await observe();await sql('COMMIT;');active=false;return observation;},
    async download(object){
      const result=await downloadStorageOriginal({projectRef:release.contract.projectRef,serviceKey,object,fetchImpl});
      commands.push({commandSha256:digestJson({method:'GET',object:object.identity}),outputSha256:digest(result),exitCode:0});return result;
    },
    commandReceipts(){return commands;},
    async abort(){if(active){await client.query('ROLLBACK;');active=false;}},
    async close(){await client.end();},
  };
}
