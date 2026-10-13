import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createDraftDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';
import {loadAmoraActionViewV2Plan} from '../lib/amora-action-view-v2-release-contract.mjs';
import {buildAmoraActionViewV2ObservationSql} from '../lib/amora-action-view-v2-catalog.mjs';
import {seedSyntheticAmoraHistoryLedger,mapSyntheticHistoricalLedgerMetadata} from './fixtures/amora-action-view-v2-ledger-fixture.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const observe=async f=>(await f.db.query(buildAmoraActionViewV2ObservationSql()))
  .flatMap(result=>result.rows??[]).find(row=>row.observation).observation;

async function seedLedger(f,plan) {
  await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
}

async function independentSnapshot(f) {
  return {
    functions:(await f.db.query(`SELECT p.oid,p.proname,pg_get_functiondef(p.oid) AS definition,
      p.proacl::text AS acl,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth') AND p.prokind='f'
      ORDER BY n.nspname,p.proname,p.oid`)).rows,
    triggers:(await f.db.query(`SELECT oid,tgname,tgenabled,pg_get_triggerdef(oid,true) AS definition
      FROM pg_trigger WHERE NOT tgisinternal ORDER BY oid`)).rows,
    actions:(await f.db.query('SELECT to_jsonb(a) AS row FROM public.amora_actions a ORDER BY id')).rows,
    journeys:(await f.db.query('SELECT to_jsonb(j) AS row FROM public.wedding_journeys j ORDER BY id')).rows,
    ledger:(await f.db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows,
    tablePermissions:(await f.db.query(`SELECT oid,relname,relacl::text,relrowsecurity,relforcerowsecurity
      FROM pg_class WHERE oid IN ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass) ORDER BY oid`)).rows,
  };
}

test('native PG17 exact baseline and post catalogs permit only the two v2 functions and timestamp trigger change',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const plan=loadAmoraActionViewV2Plan(repoRoot);
    assert.ok(plan.catalogFixture,'a pinned synthetic PG17 baseline/post catalog fixture is required');
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.seedCanonical();
      await f.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])');
      const before=await observe(f);
      const rows=await f.read('draft_canonical');
      const journey=await f.journey();
      const originalFunctions=(await f.db.query(`SELECT proname,pg_get_functiondef(oid) AS definition,proacl::text AS acl
        FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
        ('mutate_own_amora_action','update_own_legacy_amora_action','lock_own_amora_action_couple','validate_manual_amora_action_values')
        ORDER BY proname`)).rows;
      assert.match(before.serverVersion,/^17\./);
      assert.deepEqual(before.target,plan.catalogFixture.baseline);
      await f.exec(plan.sql);
      const after=await observe(f);
      assert.equal(after.systemIdentifier,before.systemIdentifier,'the actual local identity is never mapped to production');
      assert.deepEqual(after.target,plan.catalogFixture.applied);
      const oldIds=before.target.functions.map(fn=>fn.identity);
      assert.deepEqual(after.target.functions.filter(fn=>oldIds.includes(fn.identity)),before.target.functions);
      assert.deepEqual(after.target.functions.filter(fn=>!oldIds.includes(fn.identity)).map(fn=>fn.identity).sort(),
        ['public.advance_amora_action_view_token_v2()','public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)']);
      assert.equal(after.preservedCatalogMd5,before.preservedCatalogMd5);
      assert.deepEqual(after.rows,before.rows);
      assert.deepEqual(after.ledger,before.ledger);
      assert.deepEqual(await f.read('draft_canonical'),rows);
      assert.deepEqual(await f.journey(),journey);
      assert.deepEqual((await f.db.query(`SELECT proname,pg_get_functiondef(oid) AS definition,proacl::text AS acl
        FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
        ('mutate_own_amora_action','update_own_legacy_amora_action','lock_own_amora_action_couple','validate_manual_amora_action_values')
        ORDER BY proname`)).rows,originalFunctions);
    } finally {await f.close();}
  });

test('native PG17 rehearsal exposes the exact temporary post state then independently restores original source and data',
  {skip:!nativeProfileRoleAvailable,timeout:90_000},async()=>{
    const {buildAmoraActionViewV2RehearsalSql}=await import('../lib/amora-action-view-v2-rehearsal.mjs');
    const plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.seedCanonical();
      await seedLedger(f,plan);
      const rawBefore=await observe(f);
      assert.equal(rawBefore.ledger.length,229);
      assert.equal(rawBefore.ledger.filter(row=>row.statementsSha256===null).length,64);
      // 공개 역사 SHA preimage를 발명하지 않는다. 외부 fixture metadata만 매핑하고 raw 원장 복원은 아래 별도 증명한다.
      // 실제 실행자는 postgres다. 합성 provider observer metadata는 실행 역할을 승계하지 않는다.
      const before=mapSyntheticHistoricalLedgerMetadata({...rawBefore,currentUser:'supabase_read_only_user'},plan);
      const independentBefore=await independentSnapshot(f);
      const sql=buildAmoraActionViewV2RehearsalSql({repoRoot,before,
        expectedSystemIdentifier:before.systemIdentifier,deadline:new Date(Date.now()+120_000).toISOString()});
      const results=await f.db.query(sql);
      const evidence=results.flatMap(result=>result.rows??[]).find(row=>row.rehearsal_evidence)?.rehearsal_evidence;
      assert.ok(evidence);
      assert.equal(evidence.version,'20261012002000');
      assert.deepEqual(evidence.ledgerEntry,{version:'20261012002000',name:'amora_action_view_v2',statementCount:1,
        sqlMd5:createHash('md5').update(plan.sql).digest('hex'),
        statementsSha256:createHash('sha256').update(JSON.stringify([plan.sql])).digest('hex')});
      assert.equal(evidence.rawSqlMatches,true);
      assert.deepEqual(evidence.target,plan.catalogFixture.applied);
      const after=await observe(f);
      assert.equal(after.systemIdentifier,before.systemIdentifier);
      for(const key of ['target','preservedCatalogMd5','rows','ledger','ledgerMd5']) assert.deepEqual(after[key],rawBefore[key]);
      assert.deepEqual(await independentSnapshot(f),independentBefore);
      assert.equal((await f.db.query('SELECT count(*)::integer AS count FROM supabase_migrations.schema_migrations WHERE version=$1',
        ['20261012002000'])).rows[0].count,0);
      assert.equal((await f.db.query("SELECT to_regprocedure('public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)') AS rpc")).rows[0].rpc,null);
    } finally {await f.close();}
  });

test('native PG17 rehearsal rejects changed baseline and a corrupted raw ledger row with no surviving candidate objects',
  {skip:!nativeProfileRoleAvailable,timeout:180_000},async()=>{
    const {buildAmoraActionViewV2RehearsalSql}=await import('../lib/amora-action-view-v2-rehearsal.mjs');
    const plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.seedCanonical();
      await seedLedger(f,plan);
      let before=mapSyntheticHistoricalLedgerMetadata(await observe(f),plan);
      const common={repoRoot,before,expectedSystemIdentifier:before.systemIdentifier,
        deadline:new Date(Date.now()+120_000).toISOString()};
      assert.throws(()=>buildAmoraActionViewV2RehearsalSql({...common,verified:true}),
        error=>error.code==='AMORA_VIEW_V2_REHEARSAL_ARGUMENT_INVALID');
      assert.throws(()=>buildAmoraActionViewV2RehearsalSql({...common,deadline:'2000-01-01T00:00:00.000Z'}),
        error=>error.code==='AMORA_VIEW_V2_REHEARSAL_EXPIRED');
      assert.throws(()=>buildAmoraActionViewV2RehearsalSql({...common,expectedSystemIdentifier:'1234567890123456789'}),
        error=>error.code==='AMORA_VIEW_V2_REHEARSAL_DESTINATION_INVALID');

      const sql=buildAmoraActionViewV2RehearsalSql({...common,deadline:new Date(Date.now()+120_000).toISOString()});
      await f.exec('ALTER FUNCTION public.mutate_own_amora_action(uuid,text,text,jsonb) SECURITY INVOKER');
      const justBeforeAttempt=await independentSnapshot(f);
      await assert.rejects(f.db.query(sql),error=>error.code==='P0001'&&error.message==='AMORA_VIEW_V2_REHEARSAL_BASELINE_DRIFT');
      await f.db.query('ROLLBACK');
      assert.deepEqual(await independentSnapshot(f),justBeforeAttempt);
      await f.exec('ALTER FUNCTION public.mutate_own_amora_action(uuid,text,text,jsonb) SECURITY DEFINER');

      // Local negative fixture only: an existing BEFORE ledger trigger corrupts the raw statement bytes.
      await f.exec(`CREATE FUNCTION public.synthetic_amora_ledger_tamper() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.statements:=ARRAY['SYNTHETIC-CORRUPTED-LEDGER']; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_amora_ledger_tamper BEFORE INSERT ON supabase_migrations.schema_migrations
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_amora_ledger_tamper();`);
      const corruptorRawBefore=await observe(f);
      before=mapSyntheticHistoricalLedgerMetadata(corruptorRawBefore,plan);
      const corruptedBefore=await independentSnapshot(f);
      const corruptedSql=buildAmoraActionViewV2RehearsalSql({repoRoot,before,
        expectedSystemIdentifier:before.systemIdentifier,deadline:new Date(Date.now()+120_000).toISOString()});
      await assert.rejects(f.db.query(corruptedSql),error=>error.code==='P0001'&&error.message==='AMORA_VIEW_V2_REHEARSAL_POST_DRIFT');
      await f.db.query('ROLLBACK');
      assert.deepEqual(await independentSnapshot(f),corruptedBefore);
      const after=await observe(f);
      for(const key of ['target','rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(after[key],corruptorRawBefore[key]);
      assert.equal(after.systemIdentifier,before.systemIdentifier);
      assert.equal((await f.db.query("SELECT to_regprocedure('public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)') AS rpc")).rows[0].rpc,null);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });
