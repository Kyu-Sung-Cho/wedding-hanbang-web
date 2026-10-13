import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import {createAmoraActionViewV2HistoricalRepository} from './fixtures/amora-action-view-v2-history-repository.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));

test('owned final B1 module graph preserves strict241 positive and rejects an added migration without changing the current root',async()=>{
 const f=createAmoraActionViewV2HistoricalRepository(root);
 try {
  assert.equal(f.sourceCommit,'dfdd87eaf724baa938a1c0bd459afe0d022c1c4b');
  assert.equal(f.releaseAuthorized,false);
  assert.notEqual(f.root,root);
  const module=await import(pathToFileURL(join(f.root,'scripts/lib/amora-action-view-v2-release-contract.mjs')).href);
  assert.equal(module.loadAmoraActionViewV2Plan(f.root).migrationCount,241);
  writeFileSync(join(f.root,'supabase/migrations/20261013003000_unreviewed_test_only.sql'),'BEGIN;\nROLLBACK;\n',{flag:'wx'});
  assert.throws(()=>module.loadAmoraActionViewV2Plan(f.root),error=>error.code==='AMORA_VIEW_V2_NEW_MIGRATION_NOT_REVIEWED');
  assert.equal(readFileSync(join(root,'scripts/lib/amora-action-view-v2-release-contract.mjs'),'utf8'),
   readFileSync(join(f.root,'scripts/lib/amora-action-view-v2-release-contract.mjs'),'utf8'));
 } finally { f.cleanup(); }
});

test('copied fixture creates actual distinct owned PG17; argument rejection is not native recovery approval',async t=>{
 const f=createAmoraActionViewV2HistoricalRepository(root);
 let db;
 try {
  const fixture=await import(pathToFileURL(join(f.root,'supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs')).href);
  if(!fixture.nativeProfileRoleAvailable) {
   // Source-only CI cannot claim native execution. The original native suites keep their explicit platform skips.
   assert.equal(process.platform==='win32',false);
   t.skip('native PostgreSQL17 is unavailable in this source-only environment; no native execution claim');
   return;
  }
  db=await fixture.createDraftDatabase({native:true,candidate:false});
  const actual=(await db.db.query("SELECT (SELECT system_identifier::text FROM pg_control_system()) AS system, host(inet_server_addr()) AS host, current_setting('server_version') AS version")).rows[0];
  assert.notEqual(actual.system,'7581440907192989109');
  assert.equal(actual.host,'127.0.0.1');
  assert.match(actual.version,/^17\./);
  const native=await import(pathToFileURL(join(f.root,'scripts/lib/amora-action-view-v2-native-recovery.mjs')).href);
  await assert.rejects(()=>native.runAmoraActionViewV2NativeRecovery({repoRoot:f.root,verified:true}),
   error=>error.code==='AMORA_VIEW_V2_NATIVE_RECOVERY_ARGUMENT_INVALID');
 } finally { await db?.close(); f.cleanup(); }
});
