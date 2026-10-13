import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createAmoraWriterRetirementRecoveryNativeDatabase} from './fixtures/amora-action-writer-retirement-recovery-native.mjs';
import {createAmoraWriterRetirementSourceRepository} from './fixtures/amora-action-writer-retirement-source-repository.mjs';
import {buildAmoraWriterRetirementObservationSql,validateAmoraWriterRetirementObservation} from '../lib/amora-action-writer-retirement-catalog.mjs';
import {buildAmoraWriterRetirementRehearsalSql,validateAmoraWriterRetirementRehearsalInside} from '../lib/amora-action-writer-retirement-transaction.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const options={timeout:60_000,skip:process.platform!=='win32'};
const row=async(client,sql,alias)=>{
  const result=await client.query(sql),values=(Array.isArray(result)?result:[result]).flatMap(item=>item.rows??[]).filter(value=>value[alias]);
  assert.equal(values.length,1);return values[0][alias];
};
async function before(f,root){
  const raw=await row(f.db,buildAmoraWriterRetirementObservationSql({repoRoot:root,phase:'before'}),'b2_observation');
  const system=raw.privileges.systemIdentifier;
  validateAmoraWriterRetirementObservation(raw,{repoRoot:root,phase:'before',expectedNativeSystemIdentifier:system,beforeObservation:null});
  return {raw,system};
}

test('actual owned PG17 fixed original7 transaction installs exact bundle and raw231 inside then ROLLBACKs; independent new connection sees unchanged230/rows/catalog',options,async()=>{
  const source=createAmoraWriterRetirementSourceRepository(),f=await createAmoraWriterRetirementRecoveryNativeDatabase();
  let independent;
  try{
    const {raw,system}=await before(f,source.root),deadline=new Date(Date.now()+120_000).toISOString();
    const sql=buildAmoraWriterRetirementRehearsalSql({repoRoot:source.root,before:raw,deadline,expectedNativeSystemIdentifier:system});
    assert.equal(sql.endsWith('\nROLLBACK;'),true);
    const evidence=await row(f.db,sql,'b2_rehearsal_evidence');
    const checked=validateAmoraWriterRetirementRehearsalInside([{b2_rehearsal_evidence:evidence}],{repoRoot:source.root,before:raw});
    assert.equal(checked.releaseAuthorized,false);assert.equal(checked.independentRollbackVerified,false);
    independent=await f.newSession();
    const after=await row(independent,buildAmoraWriterRetirementObservationSql({repoRoot:source.root,phase:'before'}),'b2_observation');
    validateAmoraWriterRetirementObservation(after,{repoRoot:source.root,phase:'before',expectedNativeSystemIdentifier:system,beforeObservation:null});
    for(const key of ['rows','preservedCatalogSha256','ledger','rawLedgerSha256','rawLedgerMd5'])assert.deepEqual(after[key],raw[key]);
  }finally{await independent?.end();await f.db.query('ROLLBACK').catch(()=>{});await f.close();source.close();}
});

test('actual owned PG17 transaction rejects expired clock, wrong raw before/hash and arbitrary SQL/mode/callback arguments before execution',options,async()=>{
  const source=createAmoraWriterRetirementSourceRepository(),f=await createAmoraWriterRetirementRecoveryNativeDatabase();
  try{
    const {raw,system}=await before(f,source.root),base={repoRoot:source.root,before:raw,
      deadline:new Date(Date.now()+120_000).toISOString(),expectedNativeSystemIdentifier:system};
    for(const extra of ['sql','query','verified','mode','now'])assert.throws(()=>buildAmoraWriterRetirementRehearsalSql({...base,[extra]:true}),/ARGUMENT_INVALID/);
    assert.throws(()=>buildAmoraWriterRetirementRehearsalSql({...base,deadline:new Date(Date.now()-1000).toISOString()}),/EXPIRED/);
    for(const key of ['rawLedgerSha256','rawLedgerMd5','preservedCatalogSha256']){
      const fresh=await before(f,source.root),changed=structuredClone(fresh.raw);changed[key]=null;
      assert.throws(()=>buildAmoraWriterRetirementRehearsalSql({...base,before:changed}),/DIGEST_INVALID/);
    }
  }finally{await f.close();source.close();}
});

test('actual owned PG17 late unapproved row change during DDL is caught and the failed transaction cannot leave partial functions, rows or raw ledger',options,async()=>{
  const source=createAmoraWriterRetirementSourceRepository(),f=await createAmoraWriterRetirementRecoveryNativeDatabase();
  let independent;
  try{
    await f.exec(`CREATE FUNCTION public.transport_test_ddl_row_drift() RETURNS event_trigger LANGUAGE plpgsql AS $body$
      BEGIN UPDATE public.amora_actions SET description='SYNTHETIC-UNAPPROVED-DDL-DRIFT'; END $body$;
      CREATE EVENT TRIGGER transport_test_ddl_row_drift ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
      EXECUTE FUNCTION public.transport_test_ddl_row_drift();`);
    const {raw,system}=await before(f,source.root),deadline=new Date(Date.now()+120_000).toISOString();
    const sql=buildAmoraWriterRetirementRehearsalSql({repoRoot:source.root,before:raw,deadline,expectedNativeSystemIdentifier:system});
    await assert.rejects(f.db.query(sql),error=>error.message==='AMORA_WRITER_TRANSACTION_POST_DRIFT');
    await f.db.query('ROLLBACK');independent=await f.newSession();
    const after=await row(independent,buildAmoraWriterRetirementObservationSql({repoRoot:source.root,phase:'before'}),'b2_observation');
    validateAmoraWriterRetirementObservation(after,{repoRoot:source.root,phase:'before',expectedNativeSystemIdentifier:system,beforeObservation:null});
    for(const key of ['rows','preservedCatalogSha256','ledger','rawLedgerSha256','rawLedgerMd5'])assert.deepEqual(after[key],raw[key]);
  }finally{await independent?.end();await f.db.query('ROLLBACK').catch(()=>{});await f.close();source.close();}
});
