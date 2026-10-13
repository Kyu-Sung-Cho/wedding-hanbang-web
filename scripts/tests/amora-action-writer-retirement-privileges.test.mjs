import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createPrivilegeDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs';
import {createAmoraWriterRetirementSourceRepository} from './fixtures/amora-action-writer-retirement-source-repository.mjs';
import {buildAmoraWriterRetirementPrivilegesObservationSql,validateAmoraWriterRetirementPrivilegesObservation,getAmoraWriterRetirementTargetMetadata} from '../lib/amora-action-writer-retirement-privileges.mjs';
import {buildAmoraWriterRetirementBundle} from '../lib/amora-action-writer-retirement-bundle.mjs';
import {deriveFixedOriginal7FromRepo} from '../lib/amora-action-writer-retirement-original-source.mjs';

const nativeOptions={timeout:120_000,skip:process.platform!=='win32'&&!nativeProfileRoleAvailable
  ?'Owned native PG17 unavailable on this non-Windows source-only runner; not recovery evidence':false};
const capture=async(f,repoRoot,phase)=>{
  const result=await f.db.query(buildAmoraWriterRetirementPrivilegesObservationSql({repoRoot,phase}));
  const raw=(Array.isArray(result)?result:[result]).find(result=>result.rows?.[0]?.observation)?.rows[0].observation;
  assert.ok(raw);return raw;
};

test('native PG17: exact original7 full definitions and attrs are observed, then one combined fifth-aware catalog is preserved',nativeOptions,async()=>{
  const source=createAmoraWriterRetirementSourceRepository(),f=await createPrivilegeDatabase({phase:'before'});
  try {
    const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
    const originals=deriveFixedOriginal7FromRepo(source.root);
    for(const fn of originals) {
      const definition=(await f.db.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS definition',[fn.identity])).rows[0].definition;
      assert.equal(definition,fn.definition,fn.identity+' exact full definition');
    }
    const before=await capture(f,source.root,'before');
    const beforeProof=validateAmoraWriterRetirementPrivilegesObservation(before,{repoRoot:source.root,phase:'before',expectedNativeSystemIdentifier:id,beforeObservation:null});
    assert.equal(beforeProof.releaseAuthorized,false);
    assert.equal(before.functions.length,19);
    assert.equal(getAmoraWriterRetirementTargetMetadata({repoRoot:source.root,phase:'before'}).functions.length,7);
    await f.exec(buildAmoraWriterRetirementBundle(source.root).sql);
    const after=await capture(f,source.root,'after');
    const proof=validateAmoraWriterRetirementPrivilegesObservation(after,{repoRoot:source.root,phase:'after',expectedNativeSystemIdentifier:id,beforeObservation:before});
    assert.equal(after.functions.length,21);
    assert.equal(getAmoraWriterRetirementTargetMetadata({repoRoot:source.root,phase:'after'}).functions.length,9);
    assert.equal(proof.releaseAuthorized,false);
    assert.equal(proof.ledgerVerified,false);
    assert.equal(proof.privateRecoveryVerified,false);
  } finally {await f.close();source.close();}
});

test('native PG17: old original6/four-only v2 body and malformed metadata cannot be promoted to new after7 evidence',nativeOptions,async()=>{
  const source=createAmoraWriterRetirementSourceRepository(),f=await createPrivilegeDatabase({phase:'before'});
  try {
    const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
    const before=await capture(f,source.root,'before');
    await f.exec(buildAmoraWriterRetirementBundle(source.root).sql);
    const after=await capture(f,source.root,'after');
    const check=raw=>validateAmoraWriterRetirementPrivilegesObservation(raw,{repoRoot:source.root,phase:'after',expectedNativeSystemIdentifier:id,beforeObservation:before});
    const oldBody=structuredClone(after),identity='public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)';
    const original=before.functions.find(fn=>fn.identity===identity),fn=oldBody.functions.find(fn=>fn.identity===identity);
    for(const key of ['bodyMd5','bodySha256','definitionSha256'])fn[key]=original[key];
    assert.throws(()=>check(oldBody),/FUNCTION_DRIFT/);
    for(const edit of [raw=>{raw.functions.find(fn=>fn.identity===identity).definitionSha256=['a'.repeat(64)];},
      raw=>{raw.functions=raw.functions.filter(fn=>fn.identity!==identity);},
      raw=>{raw.functions.find(fn=>fn.identity===identity).securityDefiner=false;}]) {
      // Each negative begins with a fresh actual READ ONLY capture; no clock replacement or expiry bypass.
      const invalid=await capture(f,source.root,'after');edit(invalid);
      assert.throws(()=>check(invalid),/SHAPE_INVALID|FUNCTION_DRIFT/);
    }
    assert.equal(check(await capture(f,source.root,'after')).releaseAuthorized,false);
  } finally {await f.close();source.close();}
});
