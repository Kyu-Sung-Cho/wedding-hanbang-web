import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildPreparationStyleMutationSql, buildPreparationStyleObservationSql, validatePreparationStyleCatalog, validatePreparationStyleObservation,
  preparationStyleTargetCatalogSql, preparationStylePreservedCatalogSql, preparationStyleLedgerDigestSql, preparationStyleDependencyCatalogSql } from '../lib/preparation-style-catalog.mjs';
import { createPreparationStyleNativeDatabase, nativePreparationStyleAvailable } from './fixtures/preparation-style-native-database.mjs';

const root=resolve(import.meta.dirname,'../..');
const sql=readFileSync(resolve(root,'supabase/migrations/20260920120000_wedding_preparation_style.sql'),'utf8');
const fixture=JSON.parse(readFileSync(resolve(root,'supabase/release-contracts/preparation-style-pg17-catalog-v1.json')));
const {Client}=createRequire(import.meta.url)('pg');
test('native PG17 rehearses rollback then commits only the new private objects and exact ledger row, preserving parent catalogs',
  {skip:nativePreparationStyleAvailable?false:'native PG17 unavailable; native rehearsal not verified',timeout:180_000},async()=>{
  const owned=await createPreparationStyleNativeDatabase(root),db=owned.client;
  const peer=new Client({...owned.connection,query_timeout:30_000});
  try {
    const one=async query=>(await db.query(`SELECT ${query} AS value`)).rows[0].value;
    const before={catalog:await one(preparationStyleTargetCatalogSql()),preservedCatalogSha:await one(preparationStylePreservedCatalogSql()),
      ledgerSha:await one(preparationStyleLedgerDigestSql()),migration:null};
    validatePreparationStyleCatalog(before.catalog,fixture,false);
    const results=await db.query(buildPreparationStyleObservationSql());
    const observed=results.find(result=>result.rows?.[0]?.observation).rows[0].observation;
    assert.equal(observed.systemIdentifier,owned.system);assert.equal(observed.readOnly,true);assert.equal(observed.dependenciesReady,true);
    assert.equal(observed.predecessor.version,'20260918090000');assert.deepEqual(observed.catalog,before.catalog);
    assert.deepEqual(observed.dependencies,fixture.dependencies);
    for(const drift of ['GRANT EXECUTE ON FUNCTION public.is_current_couple_member(uuid,uuid) TO authenticated',
      "ALTER FUNCTION public.is_current_couple_member(uuid,uuid) SET statement_timeout='1s'"]){
      await db.query('BEGIN');await db.query(drift);
      const dependencies=await one(preparationStyleDependencyCatalogSql());
      assert.throws(()=>validatePreparationStyleObservation({...observed,systemIdentifier:'7581440907192989109',dependencies},
        {sql,fixture,predecessorSql:owned.predecessorSql,now:new Date()}),{code:'PREPARATION_STYLE_DEPENDENCY_DRIFT'});
      await db.query('ROLLBACK');
    }
    // 합성 DB의 시스템 식별값만 대체한다. 권한/DDL/사후검사/원문은 그대로 실행한다.
    const bundle=rehearsal=>buildPreparationStyleMutationSql({sql,fixture,before,rehearsal,
      deadline:new Date(Date.now()+120_000).toISOString()}).replace("<>'7581440907192989109'",`<>'${owned.system}'`);
    await db.query(bundle(true));
    assert.deepEqual(await one(preparationStyleTargetCatalogSql()),before.catalog);
    assert.equal(await one(preparationStylePreservedCatalogSql()),before.preservedCatalogSha);
    assert.equal(await one(preparationStyleLedgerDigestSql()),before.ledgerSha);
    await peer.connect();await peer.query('BEGIN; LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(db.query(bundle(false)),error=>error.code==='55P03');await db.query('ROLLBACK');await peer.query('ROLLBACK');
    assert.deepEqual(await one(preparationStyleTargetCatalogSql()),before.catalog);
    // 부모의 비대상 변경은 같은 테이블에 새 트리거를 더한다는 이유로 숨겨지지 않는다.
    await db.query("BEGIN; ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'bride'");
    assert.notEqual(await one(preparationStylePreservedCatalogSql()),before.preservedCatalogSha);await db.query('ROLLBACK');
    await db.query(bundle(false));
    validatePreparationStyleCatalog(await one(preparationStyleTargetCatalogSql()),fixture,true);
    assert.equal(await one(preparationStylePreservedCatalogSql()),before.preservedCatalogSha);
    assert.equal(await one(preparationStyleLedgerDigestSql(true)),before.ledgerSha);
    assert.deepEqual((await db.query('SELECT * FROM public.unrelated_rows')).rows,[{id:1,note:'synthetic preserved'}]);
    assert.equal((await db.query("SELECT statements[1] AS sql FROM supabase_migrations.schema_migrations WHERE version='20260920120000'")).rows[0].sql,sql);
    for (const drift of [
      'GRANT SELECT ON public.wedding_preparation_style_responses TO authenticated',
      'GRANT SELECT(answer_code) ON public.wedding_preparation_style_responses TO authenticated',
      'GRANT USAGE ON SEQUENCE public.wedding_preparation_style_revision_seq TO service_role',
      'ALTER TABLE public.wedding_preparation_style_shares NO FORCE ROW LEVEL SECURITY',
      'ALTER TABLE public.profiles DISABLE TRIGGER trg_wedding_preparation_style_profile_membership',
      'GRANT EXECUTE ON FUNCTION public.wedding_preparation_style_actor() TO authenticated',
    ]) {
      await db.query('BEGIN');await db.query(drift);
      // 실제 변형된 catalog를 검사해 원문 핀이 의미 검증을 대신하지 않게 한다.
      const changed=await one(preparationStyleTargetCatalogSql());
      assert.throws(()=>validatePreparationStyleCatalog(changed,fixture,true),{code:'PREPARATION_STYLE_TARGET_CATALOG_DRIFT'});
      await db.query('ROLLBACK');
    }
    // 동일 PG17에서 실제 authenticated 호출도 확인한다. 운영 사용자는 만들지 않는다.
    const owner='00000000-0000-0000-0000-000000000001',partner='00000000-0000-0000-0000-000000000002',couple='00000000-0000-0000-0000-000000000003';
    await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,partner]);
    await db.query('INSERT INTO public.couples VALUES($1,$2,$3)',[couple,owner,partner]);
    await db.query("INSERT INTO public.profiles VALUES($1,$3,'bride'),($2,$3,'groom')",[owner,partner,couple]);
    const actor=async id=>{await db.query('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.query('SET ROLE authenticated');};
    const call=async(name,params=[])=> (await db.query(`SELECT public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,params)).rows[0].value;
    const save=revision=>call('set_own_wedding_preparation_style',[revision,'v1.2-code','A'.repeat(20),'2026-09-20']);
    await actor(owner);const first=await save(null);
    await actor(partner);const second=await save(null);
    await actor(owner);const ownShared=await call('share_own_wedding_preparation_style',[first.stateRevision,couple,partner,'2026-09-20']);
    assert.equal(ownShared.partner,null);
    await actor(partner);assert.equal((await call('get_own_wedding_preparation_style')).partner,null);
    await call('share_own_wedding_preparation_style',[second.stateRevision,couple,owner,'2026-09-20']);
    await actor(owner);assert.equal((await call('get_own_wedding_preparation_style')).partner.answerCode,'A'.repeat(20));
    const unshared=await call('unshare_own_wedding_preparation_style',[ownShared.stateRevision]);
    await assert.rejects(call('share_own_wedding_preparation_style',[ownShared.stateRevision,couple,partner,'2026-09-20']),error=>error.code==='40001');
    const cleared=await call('clear_own_wedding_preparation_style',[unshared.stateRevision]);assert.equal(cleared.own,null);
    await assert.rejects(save(null),error=>error.code==='40001');
    await db.query('RESET ROLE');
    assert.deepEqual((await db.query('SELECT answer_code,scene_version,save_consent_version,saved_at FROM public.wedding_preparation_style_responses WHERE owner_user_id=$1',[owner])).rows,
      [{answer_code:null,scene_version:null,save_consent_version:null,saved_at:null}]);
    await db.query("INSERT INTO public.account_deletion_jobs VALUES($1,'pending')",[owner]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.wedding_preparation_style_responses WHERE owner_user_id=$1',[owner])).rows[0].count,0);
  } finally {await peer.end().catch(()=>{});await owned.close();}
});
