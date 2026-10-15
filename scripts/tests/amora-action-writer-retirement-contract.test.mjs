import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {copyFileSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,sep} from 'node:path';
import {buildAmoraWriterRetirementBundle,AMORA_WRITER_RETIREMENT_COMPANIONS} from '../lib/amora-action-writer-retirement-bundle.mjs';
import {loadAmoraWriterRetirementPlan,validateAmoraWriterRetirementStaticPredecessor,AMORA_WRITER_RETIREMENT_MODE,STATIC_PREDECESSOR_PIN} from '../lib/amora-action-writer-retirement-release-contract.mjs';
import {loadAmoraActionViewV2Plan} from '../lib/amora-action-view-v2-release-contract.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const artifact=JSON.parse(readFileSync(join(repoRoot,STATIC_PREDECESSOR_PIN.file),'utf8'));
const marker='amora-b2-owned-source242-only';
function sourceFixture({includeFormal=true}={}) {
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'hanbang-b2-source242-'));
  writeFileSync(join(root,'.owner'),marker,{flag:'wx'});
  for(const file of [...artifact.dependencyPins.map(row=>row.file),STATIC_PREDECESSOR_PIN.file,...AMORA_WRITER_RETIREMENT_COMPANIONS.map(row=>row[0])]) {
    const target=join(root,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(repoRoot,file),target);
  }
  const bundle=buildAmoraWriterRetirementBundle(root);
  if(includeFormal)writeFileSync(join(root,'supabase/migrations',bundle.file),bundle.sql,{flag:'wx'});
  return {root,close(){
    const target=realpathSync(root),delta=relative(parent,target);
    assert.ok(delta.startsWith('hanbang-b2-source242-')&&!delta.includes(sep)&&!lstatSync(root).isSymbolicLink());
    assert.equal(readFileSync(join(target,'.owner'),'utf8'),marker);
    rmSync(target,{recursive:true,force:false});
  }};
}
const load=root=>loadAmoraWriterRetirementPlan({repoRoot:root,mode:AMORA_WRITER_RETIREMENT_MODE});

test('one combined B2 source has exactly five frozen companions and the separate PT409 transport definition',()=>{
  assert.equal(AMORA_WRITER_RETIREMENT_COMPANIONS.length,5);
  const bundle=buildAmoraWriterRetirementBundle(repoRoot);
  assert.equal((bundle.sql.match(/RAISE EXCEPTION 'AMORA_ACTION_CONFLICT' USING ERRCODE = 'PT409'/g)||[]).length,2);
  assert.equal(bundle.releaseAuthorized,false);
  assert.equal(bundle.remoteWritesPerformed,false);
  assert.notEqual(bundle.sha256,'12e05a0aaedadb982d5a294ce7367444ad69a79d9dd0aada918c2bfe95128696');
});

test('fresh fixed final-B1 static source241 plus exactly one combined source242 bundle derives history230→231 but no authority',()=>{
  const f=sourceFixture();
  try {
    const plan=load(f.root);
    assert.equal(plan.migrationCount,242);
    assert.equal(plan.expectedBefore230.length,230);
    assert.equal(plan.expectedAfter231.length,231);
    assert.equal(plan.contract.originalFunctionCount,7);
    assert.equal(plan.contract.newGuardFunctionCount,2);
    assert.equal(plan.staticPredecessorSha256,'b53ee9b572d222364d6fde4876781124f710848617b6e16da18a07eeb12d81e3');
    assert.equal(plan.generatedPredecessorSource.commit,'dfdd87eaf724baa938a1c0bd459afe0d022c1c4b');
    assert.equal(plan.migration.sha256,'38960c66ebd228844346951d001801e3b9af26f750e8a279e07c0d5910ac438c');
    assert.equal(plan.migration.bytes,46366);
    for(const key of ['releaseAuthorized','runtimeEvidenceVerified','b1OperationalPostverifyVerified','sourceCiVerified','remoteWritesPerformed'])assert.equal(plan[key],false);
    assert.equal(Object.isFrozen(plan.expectedBefore230[0]),true);
    assert.throws(()=>loadAmoraActionViewV2Plan(f.root));
  } finally {f.close();}
});

test('owned exact241 source is not accepted as strict242 and its original strict241 loader still succeeds',()=>{
  const f=sourceFixture({includeFormal:false});
  try {
    assert.throws(()=>load(f.root),/AMORA_WRITER_RETIREMENT_NEW_MIGRATION_NOT_REVIEWED/);
    assert.equal(loadAmoraActionViewV2Plan(f.root).migrationCount,241);
  } finally {f.close();}
});

test('owned historical source242 remains accepted while both old lanes reject the current additional migration',()=>{
  const fixture=sourceFixture();
  try {assert.equal(load(fixture.root).migrationCount,242);}finally {fixture.close();}
  assert.throws(()=>load(repoRoot),/AMORA_WRITER_RETIREMENT_NEW_MIGRATION_NOT_REVIEWED/);
  assert.throws(()=>loadAmoraActionViewV2Plan(repoRoot),error=>error.message==='AMORA_VIEW_V2_NEW_MIGRATION_NOT_REVIEWED');
});

test('old, mixed, missing and caller skip/expected metadata modes cannot bypass strict242',()=>{
  for(const mode of ['--amora-action-view-v2',AMORA_WRITER_RETIREMENT_MODE+' --amora-action-view-v2','apply',null,[],true])
    assert.throws(()=>loadAmoraWriterRetirementPlan({repoRoot:'not-a-source',mode}),/AMORA_WRITER_RETIREMENT_MODE_INVALID/);
  for(const key of ['skip','ignoredMigrations','expectedCatalog','expectedLedger','query','now','force'])
    assert.throws(()=>loadAmoraWriterRetirementPlan({repoRoot:'not-a-source',mode:AMORA_WRITER_RETIREMENT_MODE,[key]:true}),/AMORA_WRITER_RETIREMENT_OPTIONS_INVALID/);
  assert.throws(()=>loadAmoraWriterRetirementPlan(null),/AMORA_WRITER_RETIREMENT_OPTIONS_INVALID/);
});

test('predecessor typed content rejects old history or asserted operational flags',()=>{
  assert.doesNotThrow(()=>validateAmoraWriterRetirementStaticPredecessor(structuredClone(artifact)));
  for(const edit of [a=>{a.releaseAuthorized=true;},a=>{a.runtimeEvidenceVerified=true;},a=>{a.b1OperationalPostverifyVerified=true;},a=>{a.verified=true;},
    a=>{a.source.commit='9022ae76c952bb909c8f6ccf3919c8371919c9b4';},a=>{a.source.commit=[a.source.commit];},
    a=>{a.reviewedMigrations[0].sha256=[a.reviewedMigrations[0].sha256];},a=>{a.expectedHistorical229[0].statementsSha256=['f'.repeat(64)];},
    a=>{a.dependencyPins[0].file='../outside';}]) {
    const invalid=structuredClone(artifact);edit(invalid);
    assert.throws(()=>validateAmoraWriterRetirementStaticPredecessor(invalid),/AMORA_WRITER_RETIREMENT_PREDECESSOR_SHAPE_INVALID/);
  }
});

test('extra SQL/case/version files are rejected, not placed in an operator ignored list',()=>{
  const f=sourceFixture();
  try {
    for(const file of ['20261013003001_unreviewed.sql','unexpected.SQL','20261013003000_duplicate.sql']) {
      const target=join(f.root,'supabase/migrations',file);writeFileSync(target,'BEGIN;\nCOMMIT;\n',{flag:'wx'});
      try {assert.throws(()=>load(f.root),/AMORA_WRITER_RETIREMENT_NEW_MIGRATION_NOT_REVIEWED/);} finally {rmSync(target);}
    }
    assert.equal(load(f.root).migrationCount,242);
  } finally {f.close();}
});

test('each predecessor SQL/loader and all five companion hashes are checked, not merely file counts',()=>{
  const f=sourceFixture();
  try {
    for(const file of ['supabase/migrations/'+artifact.reviewedMigrations[0].file,artifact.predecessor.strictLoader.file,AMORA_WRITER_RETIREMENT_COMPANIONS[4][0]]) {
      const target=join(f.root,file),bytes=readFileSync(target);writeFileSync(target,Buffer.concat([bytes,Buffer.from('\n-- owned-negative\n')]));
      try {assert.throws(()=>load(f.root),/AMORA_WRITER_RETIREMENT_(?:PREDECESSOR_SOURCE_CHANGED|COMPANION_HASH_MISMATCH)/);} finally {writeFileSync(target,bytes);}
    }
    const formal=join(f.root,'supabase/migrations/20261013003000_amora_action_writer_retirement_v1.sql'),bytes=readFileSync(formal);
    writeFileSync(formal,Buffer.concat([bytes,Buffer.from('\n')]));
    assert.throws(()=>load(f.root),/AMORA_WRITER_RETIREMENT_BUNDLE_CHANGED/);
  } finally {f.close();}
});
