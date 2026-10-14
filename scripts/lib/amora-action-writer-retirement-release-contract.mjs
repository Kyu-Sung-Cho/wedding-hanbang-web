import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,sep} from 'node:path';
import {AMORA_WRITER_RETIREMENT_FILE,AMORA_WRITER_RETIREMENT_SHA,buildAmoraWriterRetirementBundle} from './amora-action-writer-retirement-bundle.mjs';

export const AMORA_WRITER_RETIREMENT_MODE='--amora-action-writer-retirement';
export const STATIC_PREDECESSOR_PIN=Object.freeze({
  file:'supabase/release-contracts/amora-action-view-v2-source241-static-v1.json',
  sha256:'b53ee9b572d222364d6fde4876781124f710848617b6e16da18a07eeb12d81e3',
});
const deepFreeze=value=>{if(value&&typeof value==='object'){for(const entry of Object.values(value))deepFreeze(entry);Object.freeze(value);}return value;};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(ok,code)=>{if(!ok)throw new Error(code);};
const same=(left,right,code)=>requireValue(JSON.stringify(left)===JSON.stringify(right),code);
const SHAPE='AMORA_WRITER_RETIREMENT_PREDECESSOR_SHAPE_INVALID';
const FALSE_FLAGS=['releaseAuthorized','runtimeEvidenceVerified','b1OperationalPostverifyVerified','sourceCiVerified','remoteWritesPerformed'];
const shapeKeys=(value,expected)=>{
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),SHAPE);
  same(Object.keys(value).sort(),expected.slice().sort(),SHAPE);
};
const pathValid=file=>typeof file==='string'&&!isAbsolute(file)&&!file.includes('\\')&&!file.includes(':')
  &&!/[\u0000-\u001f\u007f]/.test(file)
  &&file.split('/').every(part=>part&&part!=='.'&&part!=='..');
const shaValid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const pinShape=pin=>{
  shapeKeys(pin,['file','sha256']);requireValue(pathValid(pin.file)&&shaValid(pin.sha256),SHAPE);
};
const ordered=(values,key)=>requireValue(values.every((row,index)=>index===0||key(values[index-1]).localeCompare(key(row))<0),SHAPE);

function read(root,file) {
  requireValue(typeof file==='string'&&!isAbsolute(file)&&!file.includes('\\')
    &&file.split('/').every(part=>part&&part!=='.'&&part!=='..'),'AMORA_WRITER_RETIREMENT_PATH_INVALID');
  const anchor=realpathSync(root);
  let target=anchor;
  for(const part of file.split('/')) {
    target=join(target,part);requireValue(!lstatSync(target).isSymbolicLink(),'AMORA_WRITER_RETIREMENT_LINK_FORBIDDEN');
  }
  const delta=relative(anchor,realpathSync(target));
  requireValue(delta&&!isAbsolute(delta)&&delta!=='..'&&!delta.startsWith(`..${sep}`),'AMORA_WRITER_RETIREMENT_PATH_INVALID');
  const before=lstatSync(target);
  requireValue(before.isFile()&&before.size>0&&before.size<=4*1024*1024,'AMORA_WRITER_RETIREMENT_SIZE_INVALID');
  const bytes=readFileSync(target),after=lstatSync(target);
  requireValue(before.ino===after.ino&&before.dev===after.dev&&before.mtimeMs===after.mtimeMs
    &&before.size===after.size&&bytes.length===before.size,'AMORA_WRITER_RETIREMENT_SOURCE_CHANGED');
  return bytes;
}

/** shape 검증은 content-only다. 반환 객체가 운영 admission/private recovery 증거는 아니다. */
export function validateAmoraWriterRetirementStaticPredecessor(value) {
  shapeKeys(value,['format','kind','generation','source','predecessor','counts','reviewedMigrations',
    'dependencyPins','expectedHistorical229',...FALSE_FLAGS]);
  requireValue(value?.format==='amora-b2-static-source241-predecessor-v1'
    &&value.kind==='source-only-not-operational-evidence'
    &&value.generation==='actual-existing-strict241-loader-return-at-clean-final-b1-source-only'
    &&value.counts?.sourceMigrations===241&&value.counts.expectedHistoricalRows===229
    &&value.counts.historicalNullStatements===64,'AMORA_WRITER_RETIREMENT_PREDECESSOR_SHAPE_INVALID');
  requireValue(FALSE_FLAGS.every(key=>value[key]===false),SHAPE);
  shapeKeys(value.counts,['sourceMigrations','expectedHistoricalRows','historicalNullStatements']);
  shapeKeys(value.source,['commit','tree','origin','cleanAtGeneration']);
  same(value.source,{commit:'dfdd87eaf724baa938a1c0bd459afe0d022c1c4b',tree:'6542436d697a6fd7b4afa6a63cadb78029a8f1bd',
    origin:'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git',cleanAtGeneration:true},SHAPE);
  const p=value.predecessor;
  shapeKeys(p,['strictLoader','contract','migration','candidate','catalogFixture','operatingLedger']);
  for(const name of ['strictLoader','contract','candidate','catalogFixture'])pinShape(p[name]);
  same(p.strictLoader,{file:'scripts/lib/amora-action-view-v2-release-contract.mjs',
    sha256:'cf73c8fb894cb157b3cb27619ee0072061c61c9881749cb8390c5dd7f9363cec'},SHAPE);
  shapeKeys(p.migration,['file','sha256','version','name']);
  same(p.migration,{file:'20261012002000_amora_action_view_v2.sql',
    sha256:'d8dc07b1e3543bc4530ea9dd3ecd616d4108b7f8739663a4e0237168e9ddc7f3',
    version:'20261012002000',name:'amora_action_view_v2'},SHAPE);
  shapeKeys(p.operatingLedger,['baseline','reviewedFollowupCount','expectedRowCount','historicalNullStatementsCount']);
  pinShape(p.operatingLedger.baseline);
  requireValue(p.operatingLedger.reviewedFollowupCount===14&&p.operatingLedger.expectedRowCount===229
    &&p.operatingLedger.historicalNullStatementsCount===64,SHAPE);
  requireValue(Array.isArray(value.reviewedMigrations)&&value.reviewedMigrations.length===241
    &&Array.isArray(value.dependencyPins)&&value.dependencyPins.length===329
    &&Array.isArray(value.expectedHistorical229)&&value.expectedHistorical229.length===229,SHAPE);
  for(const pin of [...value.reviewedMigrations,...value.dependencyPins])pinShape(pin);
  requireValue(value.reviewedMigrations.every(pin=>/^\d{14}_[a-z0-9_.-]+\.sql$/.test(pin.file)),SHAPE);
  ordered(value.reviewedMigrations,row=>row.file);ordered(value.dependencyPins,row=>row.file);
  requireValue(new Set(value.reviewedMigrations.map(pin=>pin.file.slice(0,14))).size===241,SHAPE);
  for(const pin of value.reviewedMigrations)requireValue(value.dependencyPins.some(dep=>dep.file===`supabase/migrations/${pin.file}`
    &&dep.sha256===pin.sha256),SHAPE);
  for(const pin of [p.strictLoader,p.contract,p.candidate,p.catalogFixture,p.operatingLedger.baseline])
    requireValue(value.dependencyPins.some(dep=>dep.file===pin.file&&dep.sha256===pin.sha256),SHAPE);
  for(const row of value.expectedHistorical229) {
    shapeKeys(row,['version','name','statementsSha256']);
    requireValue(typeof row.version==='string'&&/^\d{14}$/.test(row.version)
      &&typeof row.name==='string'&&/^[a-z0-9_]+$/.test(row.name)
      &&(row.statementsSha256===null||shaValid(row.statementsSha256)),SHAPE);
  }
  ordered(value.expectedHistorical229,row=>row.version);
  requireValue(value.expectedHistorical229.filter(row=>row.statementsSha256===null).length===64
    &&value.expectedHistorical229.at(-1).version==='20260928073546',SHAPE);
  return value;
}

/** 독립 strict242 successor다. 정식 등록 전에는 정상 source241에서도 fail closed한다. 기존 strict241 loader는 호출하거나 변경하지 않는다. DB/네트워크는 없다. */
export function loadAmoraWriterRetirementPlan(value) {
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).sort().join(',')==='mode,repoRoot'&&typeof value.repoRoot==='string',
    'AMORA_WRITER_RETIREMENT_OPTIONS_INVALID');
  requireValue(typeof value.mode==='string'&&value.mode===AMORA_WRITER_RETIREMENT_MODE,'AMORA_WRITER_RETIREMENT_MODE_INVALID');
  const {repoRoot}=value;
  const raw=read(repoRoot,STATIC_PREDECESSOR_PIN.file);
  requireValue(digest(raw)===STATIC_PREDECESSOR_PIN.sha256,'AMORA_WRITER_RETIREMENT_PREDECESSOR_HASH_MISMATCH');
  const artifact=validateAmoraWriterRetirementStaticPredecessor(JSON.parse(raw));
  for(const {file,sha256} of artifact.dependencyPins)
    requireValue(digest(read(repoRoot,file))===sha256,'AMORA_WRITER_RETIREMENT_PREDECESSOR_SOURCE_CHANGED');
  const reviewed=[...artifact.reviewedMigrations,{file:AMORA_WRITER_RETIREMENT_FILE,sha256:AMORA_WRITER_RETIREMENT_SHA}]
    .sort((a,b)=>a.file.localeCompare(b.file));
  const actual=readdirSync(join(repoRoot,'supabase/migrations')).filter(file=>/\.sql$/i.test(file)).sort();
  same(actual,reviewed.map(pin=>pin.file).sort(),'AMORA_WRITER_RETIREMENT_NEW_MIGRATION_NOT_REVIEWED');
  const bundle=buildAmoraWriterRetirementBundle(repoRoot);
  same(read(repoRoot,`supabase/migrations/${AMORA_WRITER_RETIREMENT_FILE}`).toString('utf8'),bundle.sql,'AMORA_WRITER_RETIREMENT_BUNDLE_CHANGED');
  const b1=artifact.predecessor.migration;
  const b1Sql=read(repoRoot,`supabase/migrations/${b1.file}`).toString('utf8');
  const expectedBefore230=[...artifact.expectedHistorical229,{version:b1.version,name:b1.name,
    statementsSha256:digest(JSON.stringify([b1Sql]))}].sort((a,b)=>a.version.localeCompare(b.version));
  const expectedAfter231=[...expectedBefore230,{version:bundle.version,name:bundle.name,
    statementsSha256:bundle.statementsSha256}].sort((a,b)=>a.version.localeCompare(b.version));
  requireValue(expectedBefore230.length===230&&expectedAfter231.length===231
    &&new Set(expectedAfter231.map(row=>row.version)).size===231
    &&expectedAfter231.filter(row=>row.statementsSha256===null).length===64,'AMORA_WRITER_RETIREMENT_EXPECTED_HISTORY_INVALID');
  // 소스 전용 단계도 읽은 뒤 변경을 성공으로 보지 않는다. 실제 CI/운영 fence는 별도 단계다.
  for(const {file,sha256} of artifact.dependencyPins)
    requireValue(digest(read(repoRoot,file))===sha256,'AMORA_WRITER_RETIREMENT_PREDECESSOR_SOURCE_CHANGED');
  same(readdirSync(join(repoRoot,'supabase/migrations')).filter(file=>/\.sql$/i.test(file)).sort(),actual,
    'AMORA_WRITER_RETIREMENT_NEW_MIGRATION_NOT_REVIEWED');
  return deepFreeze({contract:{version:1,release:'amora-action-writer-retirement-transport-20261013',projectRef:'slrtobkksjmxgzatjyqb',systemIdentifier:'7581440907192989109',originalFunctionCount:7,newGuardFunctionCount:2,rollback:'rollback-before-commit-forward-fix-after-commit'},kind:'amora-action-writer-retirement-strict-successor',scope:'static-source-and-expected-history-only',
    staticPredecessorSha256:STATIC_PREDECESSOR_PIN.sha256,generatedPredecessorSource:artifact.source,
    migrationCount:reviewed.length,reviewedMigrations:reviewed,migration:bundle,
    expectedBefore230,expectedAfter231,
    releaseAuthorized:false,runtimeEvidenceVerified:false,b1OperationalPostverifyVerified:false,
    sourceCiVerified:false,remoteWritesPerformed:false});
}
