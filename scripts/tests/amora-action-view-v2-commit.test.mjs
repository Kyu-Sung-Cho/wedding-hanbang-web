import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createDraftDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';
import {loadAmoraActionViewV2Plan} from '../lib/amora-action-view-v2-release-contract.mjs';
import {buildAmoraActionViewV2ObservationSql} from '../lib/amora-action-view-v2-catalog.mjs';
import {buildAmoraActionViewV2RehearsalSql} from '../lib/amora-action-view-v2-rehearsal.mjs';
import {seedSyntheticAmoraHistoryLedger,mapSyntheticHistoricalLedgerMetadata} from './fixtures/amora-action-view-v2-ledger-fixture.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const moduleUrl=new URL('../lib/amora-action-view-v2-commit.mjs',import.meta.url);
const observe=async(f,sql)=>(await f.db.query(sql)).flatMap(result=>result.rows??[]).find(row=>row.observation).observation;
test('native fixed COMMIT persists exactly the additive objects and raw ledger, then independent read-only postverify confirms preservation',
  {skip:!nativeProfileRoleAvailable,timeout:120_000},async()=>{
    const commit=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.seedCanonical();await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const rawBefore=await observe(f,buildAmoraActionViewV2ObservationSql());
      const before=mapSyntheticHistoricalLedgerMetadata(rawBefore,plan);
      const originalLedger=(await f.db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
      const args={repoRoot,before,expectedSystemIdentifier:before.systemIdentifier,deadline:new Date(Date.now()+120_000).toISOString()};
      const rollback=buildAmoraActionViewV2RehearsalSql(args),sql=commit.buildAmoraActionViewV2CommitSql(args);
      assert.equal(sql,rollback.slice(0,-'ROLLBACK;'.length)+'COMMIT;');
      await f.db.query(sql);
      // 별도 query로 commit 뒤 가시성을 확인하며 내부 SELECT만 성공 증거로 삼지 않는다.
      const rawAfter=await observe(f,commit.buildAmoraActionViewV2AppliedObservationSql());
      const after=mapSyntheticHistoricalLedgerMetadata(rawAfter,plan);
      const verified=commit.validateAmoraActionViewV2AppliedObservation({...args,after});
      assert.equal(verified.status,'applied-observed-exact-state-not-release-authorized');
      assert.equal(verified.releaseAuthorized,false);
      assert.equal(verified.nativeOnly,true);
      assert.equal(after.ledger.length,230);
      assert.equal(after.systemIdentifier,before.systemIdentifier);
      assert.deepEqual(after.rows,before.rows);
      assert.equal(after.preservedCatalogMd5,before.preservedCatalogMd5);
      assert.equal(after.predecessorLedgerMd5,before.ledgerMd5);
      const persisted=(await f.db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
      assert.deepEqual(persisted.filter(row=>row.version!==plan.migration.version),originalLedger);
      assert.deepEqual(persisted.find(row=>row.version===plan.migration.version),
        {version:plan.migration.version,name:plan.migration.name,statements:[plan.sql]});
      for(const changed of [
        {...after,ledgerMd5:[after.ledgerMd5]},
        {...after,ledgerMd5:'not-a-digest'},
        {...after,ledgerMd5:null},
        {...after,predecessorLedgerMd5:'0'.repeat(32)},
        {...after,target:plan.catalogFixture.baseline},
        {...after,rows:{...after.rows,amoraActionsCount:after.rows.amoraActionsCount+1}},
        {...after,ledger:after.ledger.map(row=>row.version===plan.migration.version?{...row,sqlMd5:'0'.repeat(32)}:row)},
        {...after,ledger:after.ledger.filter(row=>row.version!==plan.migration.version)},
      ]) assert.throws(()=>commit.validateAmoraActionViewV2AppliedObservation({...args,after:changed}));
      assert.throws(()=>commit.buildAmoraActionViewV2CommitSql({...args,verified:true}),
        error=>error.code==='AMORA_VIEW_V2_COMMIT_ARGUMENT_INVALID');
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('native COMMIT rejects drift atomically and leaves no surviving v2 objects or ledger entry',
  {skip:!nativeProfileRoleAvailable,timeout:120_000},async()=>{
    const commit=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.seedCanonical();await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const before=mapSyntheticHistoricalLedgerMetadata(await observe(f,buildAmoraActionViewV2ObservationSql()),plan);
      const sql=commit.buildAmoraActionViewV2CommitSql({repoRoot,before,expectedSystemIdentifier:before.systemIdentifier,
        deadline:new Date(Date.now()+120_000).toISOString()});
      await f.exec("UPDATE public.amora_actions SET title='SYNTHETIC-CONCURRENT-CHANGE'");
      const immediatelyBefore=await observe(f,buildAmoraActionViewV2ObservationSql());
      await assert.rejects(f.db.query(sql),error=>error.code==='P0001'&&error.message==='AMORA_VIEW_V2_REHEARSAL_BASELINE_DRIFT');
      await f.db.query('ROLLBACK');
      const after=await observe(f,buildAmoraActionViewV2ObservationSql());
      for(const key of ['target','rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(after[key],immediatelyBefore[key]);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });
