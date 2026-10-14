import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {readAnchored} from './current-baseline-release-contract.mjs';
import {AMORA_WRITER_RETIREMENT_MODE,loadAmoraWriterRetirementPlan} from './amora-action-writer-retirement-release-contract.mjs';

// dfdd source241과 동일한 차단 상태 원문만 인정한다. controller-ready 승격은 별도 검수가 필요하다.
export const AMORA_WRITER_RETIREMENT_VENDOR_MANIFEST=Object.freeze({
  file:'supabase/release-manifests/vendor-disclosure-v2-20260718.json',
  sha256:'9fdf97e91ca6e53ac19394443d452061f635d1f05cfceff50483fa3d3cc5f3e7',
});
const REF='slrtobkksjmxgzatjyqb';
const canonical=text=>text.replace(/\r\n?/g,'\n');
const sha=text=>createHash('sha256').update(canonical(text),'utf8').digest('hex');
const requireValue=(ok,code)=>{if(!ok)throw new Error(code);};
const pinValid=pin=>pin&&typeof pin==='object'&&!Array.isArray(pin)
  &&Object.keys(pin).sort().join(',')==='file,sha256'
  &&typeof pin.file==='string'&&typeof pin.sha256==='string'&&/^[a-f0-9]{64}$/.test(pin.sha256);

function readPinned(repoRoot,pin,kind,observed) {
  requireValue(pinValid(pin)&&(kind==='manifest'
    ? /^supabase\/release-manifests\/[a-z0-9][a-z0-9-]*\.json$/.test(pin.file)
    : /^supabase\/migrations\/\d{14}_[a-z0-9][a-z0-9_.-]*\.sql$/.test(pin.file)),
  'AMORA_WRITER_RETIREMENT_BUILD_PIN_INVALID');
  const text=readAnchored(repoRoot,pin.file).toString('utf8');
  requireValue(sha(text)===pin.sha256,'AMORA_WRITER_RETIREMENT_BUILD_VENDOR_PIN_CHANGED');
  observed.set(pin.file,pin);
  return text;
}

function checkMigrations(repoRoot,entries,reviewed,observed) {
  requireValue(Array.isArray(entries),'AMORA_WRITER_RETIREMENT_BUILD_VENDOR_MIGRATIONS_INVALID');
  return entries.map(entry=>{
    requireValue(pinValid(entry)&&/^\d{14}_[a-z0-9][a-z0-9_.-]*\.sql$/.test(entry.file)
      &&reviewed.has(entry.file),'AMORA_WRITER_RETIREMENT_BUILD_VENDOR_MIGRATIONS_INVALID');
    readPinned(repoRoot,{...entry,file:`supabase/migrations/${entry.file}`},'migration',observed);
    return entry.file.slice(0,14);
  });
}

function checkPredecessor(repoRoot,pin,reviewed,visited,observed) {
  requireValue(!visited.has(pin?.file)&&visited.size<16,'AMORA_WRITER_RETIREMENT_BUILD_VENDOR_CHAIN_INVALID');
  const text=readPinned(repoRoot,pin,'manifest',observed),manifest=JSON.parse(text);
  visited.add(pin.file);
  requireValue(manifest&&manifest.projectRef===REF,'AMORA_WRITER_RETIREMENT_BUILD_VENDOR_CHAIN_INVALID');
  const sections=[manifest.historicalReconciliation??[],manifest.expandMigrations??[],manifest.appliedHotfixes??[]];
  const versions=sections.flatMap(entries=>checkMigrations(repoRoot,entries,reviewed,observed));
  if(manifest.predecessorManifest)checkPredecessor(repoRoot,manifest.predecessorManifest,reviewed,visited,observed);
  return versions;
}

/** Source-only build fence. No current242 filtering, old-loader fallback, hosted proof or DB calls. */
export function validateAmoraWriterRetirementBuildContract(options) {
  requireValue(options&&typeof options==='object'&&!Array.isArray(options)
    &&Object.keys(options).join(',')==='repoRoot'&&typeof options.repoRoot==='string'&&isAbsolute(options.repoRoot),
  'AMORA_WRITER_RETIREMENT_BUILD_OPTIONS_INVALID');
  const {repoRoot}=options;
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  const reviewed=new Set(plan.reviewedMigrations.map(row=>row.file)),observed=new Map();
  const manifest=JSON.parse(readPinned(repoRoot,AMORA_WRITER_RETIREMENT_VENDOR_MANIFEST,'manifest',observed));
  requireValue(manifest.release==='vendor-disclosure-v2-20260718'&&manifest.projectRef===REF
    &&manifest.status==='deployment_blocked'
    &&Object.keys(manifest.deploymentEvidence).sort().join(',')==='backup,finalizer,hostedRestore,hostedStaging,storage'
    &&Object.values(manifest.deploymentEvidence).every(value=>value==='missing'),
  'AMORA_WRITER_RETIREMENT_BUILD_VENDOR_STATE_INVALID');
  const predecessorVersions=checkPredecessor(repoRoot,manifest.predecessorManifest,reviewed,new Set(),observed);
  requireValue(predecessorVersions.toSorted().at(-1)===manifest.requiredRemoteHead,
    'AMORA_WRITER_RETIREMENT_BUILD_VENDOR_HEAD_INVALID');
  const versions=checkMigrations(repoRoot,manifest.expandMigrations,reviewed,observed);
  requireValue(versions.length>0&&versions.every((version,index)=>version>=manifest.migrationFloor
    &&(index===0||versions[index-1]<version)),'AMORA_WRITER_RETIREMENT_BUILD_VENDOR_MIGRATION_ORDER_INVALID');
  // 전체 strict242 입력과 manifest chain을 다시 읽는다. 검사 중 변경도 성공으로 취급하지 않는다.
  loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  for(const pin of observed.values())readPinned(repoRoot,pin,pin.file.endsWith('.json')?'manifest':'migration',new Map());
  return Object.freeze({kind:'amora-writer-retirement-source-only-production-build-contract',
    scope:'static242-and-fixed-blocked-vendor-manifest-not-operational-authorization',
    migrationCount:plan.migrationCount,expectedBeforeRowCount:plan.expectedBefore230.length,
    expectedAfterRowCount:plan.expectedAfter231.length,
    vendorManifestSha256:AMORA_WRITER_RETIREMENT_VENDOR_MANIFEST.sha256,
    staticPredecessorSha256:plan.staticPredecessorSha256,
    controllerReady:false,deploymentBlocked:true,controllerManifest:null,
    releaseAuthorized:false,runtimeEvidenceVerified:false,b1OperationalPostverifyVerified:false,
    sourceCiVerified:false,remoteWritesPerformed:false});
}
