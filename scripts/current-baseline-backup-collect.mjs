#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCurrentBaselineContract, requireRelease } from './lib/current-baseline-release-contract.mjs';
import { collectCurrentBackup } from './lib/current-baseline-backup-collector.mjs';
import { createPrivateSink, createPostgresSource, createSourceFence } from './lib/current-baseline-backup-runtime.mjs';

const repoRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const names=['expected-commit','expected-project','confirm-capture','ca-file','ca-sha256','pg-dump','pg-dump-sha256'];
let source;let sink;
try {
  if (process.argv.length===3 && process.argv[2]==='--help') {
    process.stdout.write('Current-baseline encrypted original capture (Windows DPAPI).\nRequires a clean committed checkout, reviewed current contract, active DB/write fences, HBAM2_DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY in memory/environment.\nOptions: '+names.map(n=>'--'+n+' <value>').join(' ')+'\nNo restore/deploy or external platform readiness is asserted by capture.\n');
  } else {
    requireRelease(process.platform==='win32','CAPTURE_WINDOWS_REQUIRED');
    const options={};const argv=process.argv.slice(2);
    for(let i=0;i<argv.length;i+=2){const key=argv[i]?.slice(2);requireRelease(argv[i]?.startsWith('--') && names.includes(key) && !Object.hasOwn(options,key) && typeof argv[i+1]==='string' && !argv[i+1].startsWith('--'),'CAPTURE_ARGUMENT_INVALID');options[key]=argv[i+1];}
    requireRelease(names.every(n=>typeof options[n]==='string'),'CAPTURE_ARGUMENT_MISSING');
    const release=loadCurrentBaselineContract(repoRoot);
    requireRelease(options['expected-project']===release.contract.projectRef && /^[a-f0-9]{40}$/.test(options['expected-commit'])
      && options['confirm-capture']===`CAPTURE:${release.contract.projectRef}:${release.contract.release}:${options['expected-commit']}`,'CAPTURE_CONFIRMATION_INVALID');
    const fence=createSourceFence(repoRoot,release,options['expected-commit']);await fence.check();
    source=await createPostgresSource({repoRoot,release,databaseUrl:process.env.HBAM2_DATABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,
      caFile:options['ca-file'],caSha256:options['ca-sha256'],pgDump:options['pg-dump'],pgDumpSha256:options['pg-dump-sha256']});
    sink=createPrivateSink({repoRoot});
    const receipt=await collectCurrentBackup({release,expectedCommit:options['expected-commit'],source,sink,assertStable:fence.check});
    process.stdout.write(JSON.stringify({status:receipt.status,backupSetId:receipt.backupSetId,relationCount:receipt.relations.length,
      objectCount:receipt.storageObjects.length,artifactCount:receipt.artifacts.length,releaseReady:false})+'\n');
  }
} catch {
  process.stderr.write('CURRENT_BASELINE_CAPTURE_FAILED; incomplete captures must not be restored or used as release evidence.\n');process.exitCode=1;
} finally {if(source)await source.close().catch(()=>{});if(sink)await sink.close();}
