import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createDraftDatabase,nativeProfileRoleAvailable} from '../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';
import {loadAmoraActionViewV2Plan} from '../lib/amora-action-view-v2-release-contract.mjs';
import {buildAmoraActionViewV2ObservationSql} from '../lib/amora-action-view-v2-catalog.mjs';
import {seedSyntheticAmoraHistoryLedger} from './fixtures/amora-action-view-v2-ledger-fixture.mjs';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const moduleUrl=new URL('../lib/amora-action-view-v2-recovery.mjs',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const commit='ce4b085aff7eda40b6e9d456cc3acffa27253a5b';
const observe=async f=>(await f.db.query(buildAmoraActionViewV2ObservationSql()))
  .flatMap(result=>result.rows??[]).find(row=>row.observation).observation;
const originalNames=['lock_own_amora_action_couple','mutate_own_amora_action',
  'update_own_legacy_amora_action','validate_manual_amora_action_values'];
// Root 승인 예외: 비민감 generic 함수 177자만 독립 SHA로 확인한 deterministic native seed다.
// private capsule/4 manual originals/운영 시각·ID·고객값을 보관하거나 fresh evidence로 재발급하지 않는다.
const actualGenericTimestampSeed="CREATE OR REPLACE FUNCTION public.update_updated_at_column()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\r\nbegin\r\n  new.updated_at = now();\r\n  return new;\r\nend;\r\n$function$\n";

async function capture(f,plan) {
  const observation=await observe(f);
  const definitions=(await f.db.query(`SELECT 'public.'||proname||'('||replace(oidvectortypes(proargtypes),' ','')||')' AS identity,
    pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname=ANY($1::text[]) ORDER BY proname`,[originalNames])).rows;
  const dependency=(await f.db.query(`SELECT pg_get_functiondef(p.oid) AS definition,
    md5(p.prosrc) AS "bodyMd5",pg_get_userbyid(p.proowner) AS owner,p.proconfig AS config,p.prosecdef AS "securityDefiner",
    pg_get_function_result(p.oid) AS result,l.lanname AS language,p.proisstrict AS strict,p.provolatile AS volatility,p.proparallel AS parallel,
    (SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)
      FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a) AS acl
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid='public.update_updated_at_column()'::regprocedure`)).rows[0];
  const capsule={format:'amora-action-view-v2-original-capsule-v1',captureEnvironment:'owned-native-pg17',
    projectRef:plan.contract.projectRef,sourceSystemIdentifier:observation.systemIdentifier,
    sourceCommit:commit,expectedOrigin:'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git',
    collectorSourceSha256:sha(readFileSync(moduleUrl)),candidateSha256:plan.candidateSha256,
    migrationSha256:plan.sqlSha256,originalMigrationSha256:sha(readFileSync(new URL('../../supabase/migrations/20260906074227_amora_manual_actions_actor_boundary.sql',import.meta.url))),
    capturedAt:observation.observedAt,serverVersion:observation.serverVersion,database:observation.database,
    currentUser:observation.currentUser,readOnly:observation.readOnly,target:observation.target,
    definitions:definitions.map(row=>({...row,sha256:sha(row.definition)})),
    dependency:{identity:'public.update_updated_at_column()',...dependency,sha256:sha(dependency.definition)},
    preservedCatalogMd5:observation.preservedCatalogMd5,rows:observation.rows,ledgerMd5:observation.ledgerMd5};
  const bytes=Buffer.from(JSON.stringify(capsule));
  return {capsule,bytes,observation,args:{repoRoot,bytes,expectedArtifactSha256:sha(bytes),expectedCommit:commit,
    expectedCollectorSha256:capsule.collectorSourceSha256,expectedNativeSystemIdentifier:observation.systemIdentifier,
    deadline:new Date(Date.now()+120_000).toISOString()}};
}

test('native original bytes can be content-verified without claiming private storage, collector execution or production recovery',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const recovery=await import(moduleUrl);
    const plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan);
      const issued=recovery.validateAmoraActionViewV2RecoveryCapsule(raw.args);
      assert.equal(issued.artifactSha256,sha(raw.bytes));
      assert.equal(issued.scope,'target-original-replayed-only');
      assert.equal(issued.captureEnvironment,'owned-native-pg17');
      for(const field of ['privateStorageVerified','collectorExecutionProvenanceVerified','nativeReplayVerified',
        'releaseAuthorized','productionApplyImplemented','remoteWritesPerformed']) assert.equal(issued[field],false);
      assert.notEqual(issued.sourceSystemIdentifier,plan.contract.systemIdentifier);
    } finally {await f.close();}
  });

test('a caller cannot promote asserted verification or extra capsule fields into recovery evidence',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan);
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...raw.args,verified:true}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_ARGUMENT_INVALID');
      const bytes=Buffer.from(JSON.stringify({...raw.capsule,restoreSucceeded:true}));
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...raw.args,bytes,expectedArtifactSha256:sha(bytes)}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_ARTIFACT_INVALID');
    } finally {await f.close();}
  });

test('timestamp dependency drift is rejected before any original definition is replayed',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan),changed=structuredClone(raw.capsule);
      changed.dependency.definition+='\n-- altered dependency';
      changed.dependency.sha256=sha(changed.dependency.definition);
      const bytes=Buffer.from(JSON.stringify(changed));
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...raw.args,bytes,expectedArtifactSha256:sha(bytes)}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
    } finally {await f.close();}
  });

test('owned PG17 actually replays original four definitions and trigger while retaining the additive functions and ledger',
  {skip:!nativeProfileRoleAvailable,timeout:90_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.seedCanonical();
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan),issued=recovery.validateAmoraActionViewV2RecoveryCapsule(raw.args);
      const originalDefinitions=(await f.db.query(`SELECT p.oid,pg_get_functiondef(p.oid) AS definition,
        p.proacl::text AS acl,p.proconfig AS config,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
        WHERE p.pronamespace='public'::regnamespace AND proname=ANY($1::text[]) ORDER BY proname`,[originalNames])).rows;
      const originalTrigger=(await f.db.query("SELECT oid,pg_get_triggerdef(oid,true) AS definition,tgenabled FROM pg_trigger WHERE tgrelid='public.amora_actions'::regclass AND tgname='set_amora_actions_updated_at'")).rows[0];
      await f.exec(plan.sql);
      await f.db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',
        [plan.migration.version,plan.migration.name,[plan.sql]]);
      const applied=await observe(f);
      assert.deepEqual(applied.target,plan.catalogFixture.applied);
      const sql=recovery.buildAmoraActionViewV2OriginalReplaySql({repoRoot,capsule:issued,
        expectedSystemIdentifier:raw.observation.systemIdentifier,deadline:raw.args.deadline});
      const result=await f.db.query(sql);
      const evidence=result.flatMap(item=>item.rows??[]).find(row=>row.replay_evidence)?.replay_evidence;
      assert.equal(evidence?.scope,'target-original-replayed-only');
      assert.equal(evidence.nativeSystemIdentifier,raw.observation.systemIdentifier);
      assert.equal(evidence.artifactSha256,sha(raw.bytes));
      assert.equal(evidence.originalTargetSha256,evidence.restoredOriginalTargetSha256);
      assert.notEqual(evidence.appliedTargetSha256,evidence.restoredTargetSha256);
      assert.equal(evidence.newFunctionsAndLedgerRetained,true);
      assert.equal(evidence.productionRecoveryAuthorized,false);
      const restored=await observe(f);
      assert.deepEqual(restored.target.functions,applied.target.functions);
      assert.deepEqual(restored.target.timestampTriggers,raw.observation.target.timestampTriggers);
      for(const key of ['rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(restored[key],applied[key]);
      assert.deepEqual((await f.db.query(`SELECT p.oid,pg_get_functiondef(p.oid) AS definition,
        p.proacl::text AS acl,p.proconfig AS config,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
        WHERE p.pronamespace='public'::regnamespace AND proname=ANY($1::text[]) ORDER BY proname`,[originalNames])).rows,originalDefinitions);
      const restoredTrigger=(await f.db.query("SELECT oid,pg_get_triggerdef(oid,true) AS definition,tgenabled FROM pg_trigger WHERE tgrelid='public.amora_actions'::regclass AND tgname='set_amora_actions_updated_at'")).rows[0];
      assert.notEqual(restoredTrigger.oid,originalTrigger.oid,'replay recreates this one trigger; rollback OID identity is a different claim');
      assert.deepEqual({...restoredTrigger,oid:originalTrigger.oid},originalTrigger);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('recovery content rejects invalid row counts and malformed catalog digests instead of issuing evidence',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan),changed=structuredClone(raw.capsule);
      changed.rows.amoraActionsCount=-1;
      changed.preservedCatalogMd5='not-a-digest';
      const bytes=Buffer.from(JSON.stringify(changed));
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...raw.args,bytes,expectedArtifactSha256:sha(bytes)}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_ARTIFACT_INVALID');
    } finally {await f.close();}
  });

test('actual-definition 204b native seed is freshly captured and replayed under its real local system ID without becoming production recovery',
  {skip:!nativeProfileRoleAvailable,timeout:90_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    assert.equal(Buffer.byteLength(actualGenericTimestampSeed),177);
    assert.equal(sha(actualGenericTimestampSeed),'7b39b72b4fe4d1981fca770b1ad1ad6e062d560822731577e5ae3f1449ffef02');
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.exec(actualGenericTimestampSeed);
      await f.exec('GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon,authenticated,service_role');
      await f.seedCanonical();
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan);
      assert.equal(raw.capsule.dependency.bodyMd5,'204b9b9355e61b7541bc0633bbc9294c');
      assert.equal(raw.capsule.dependency.sha256,sha(actualGenericTimestampSeed));
      assert.notEqual(raw.observation.systemIdentifier,plan.contract.systemIdentifier);
      const issued=recovery.validateAmoraActionViewV2RecoveryCapsule(raw.args);
      assert.equal(issued.dependencyVariant,'actual-definition-local-204b');
      for(const field of ['privateStorageVerified','collectorExecutionProvenanceVerified','nativeReplayVerified',
        'releaseAuthorized','productionApplyImplemented','remoteWritesPerformed']) assert.equal(issued[field],false);
      await f.exec(plan.sql);
      await f.db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',
        [plan.migration.version,plan.migration.name,[plan.sql]]);
      const applied=await observe(f);
      const results=await f.db.query(recovery.buildAmoraActionViewV2OriginalReplaySql({repoRoot,capsule:issued,
        expectedSystemIdentifier:raw.observation.systemIdentifier,deadline:raw.args.deadline}));
      const evidence=results.flatMap(row=>row.rows??[]).find(row=>row.replay_evidence)?.replay_evidence;
      assert.equal(evidence?.scope,'target-original-replayed-only');
      assert.equal(evidence.nativeSystemIdentifier,raw.observation.systemIdentifier);
      assert.equal(evidence.productionRecoveryAuthorized,false);
      const after=await observe(f);
      assert.deepEqual(after.target.functions,applied.target.functions);
      assert.deepEqual(after.target.timestampTriggers,raw.observation.target.timestampTriggers);
      for(const key of ['rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(after[key],applied[key]);
      assert.equal((await f.db.query("SELECT pg_get_functiondef('public.update_updated_at_column()'::regprocedure) AS definition")).rows[0].definition,
        actualGenericTimestampSeed,'actual definition bytes and ACL remain unchanged across the original replay');
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('unknown dependency source and mixed known-source ACL variants are rejected in native and production content lanes',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      await f.exec(actualGenericTimestampSeed);
      // Known actual body with synthetic-only ACL is not an approved exact variant.
      let raw=await capture(f,plan);
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule(raw.args),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
      await f.exec('GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon,authenticated,service_role');
      await f.exec(actualGenericTimestampSeed.replace('  return new;','  return new; -- SYNTHETIC-UNKNOWN-SOURCE'));
      raw=await capture(f,plan);
      assert.notEqual(raw.capsule.dependency.sha256,'7b39b72b4fe4d1981fca770b1ad1ad6e062d560822731577e5ae3f1449ffef02');
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule(raw.args),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
      // Synthetic negative input only; it is never issued as actual production observation.
      const altered=structuredClone(raw.capsule),args={...raw.args};
      altered.captureEnvironment='supabase-read-only';altered.currentUser='supabase_read_only_user';
      altered.sourceSystemIdentifier=plan.contract.systemIdentifier;
      delete args.expectedNativeSystemIdentifier;
      const bytes=Buffer.from(JSON.stringify(altered));
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...args,bytes,expectedArtifactSha256:sha(bytes)}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
    } finally {await f.close();}
  });

test('read-only capture SQL returns the exact fixed originals without treating collector self-reports as execution proof',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const collectorSha=sha(readFileSync(moduleUrl));
      const sql=recovery.buildAmoraActionViewV2RecoveryCaptureSql({repoRoot,expectedCommit:commit,
        collectorSourceSha256:collectorSha,captureEnvironment:'owned-native-pg17'});
      const results=await f.db.query(sql),capsule=results.flatMap(result=>result.rows??[])
        .find(row=>row.recovery_capsule)?.recovery_capsule;
      assert.equal(capsule?.readOnly,true);
      assert.equal(capsule.collectorSourceSha256,collectorSha);
      assert.deepEqual(capsule.target,plan.catalogFixture.baseline);
      const actual=await observe(f),bytes=Buffer.from(JSON.stringify(capsule));
      const issued=recovery.validateAmoraActionViewV2RecoveryCapsule({repoRoot,bytes,expectedArtifactSha256:sha(bytes),
        expectedCommit:commit,expectedCollectorSha256:collectorSha,expectedNativeSystemIdentifier:actual.systemIdentifier,
        deadline:new Date(Date.now()+120_000).toISOString()});
      assert.equal(issued.collectorExecutionProvenanceVerified,false);
      assert.equal(issued.privateStorageVerified,false);
      assert.equal(issued.releaseAuthorized,false);
    } finally {await f.close();}
  });

test('pinned artifact provenance, freshness and original approval surface fail closed for malformed inputs',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan);
      const corrupt=Buffer.from(raw.bytes);corrupt[corrupt.length-2]^=1;
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...raw.args,bytes:corrupt}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_ARTIFACT_INVALID');
      const reject=(change,code)=>{
        const altered=structuredClone(raw.capsule);change(altered);
        const bytes=Buffer.from(JSON.stringify(altered));
        assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...raw.args,bytes,expectedArtifactSha256:sha(bytes)}),
          error=>error.code===code);
      };
      for(const field of ['projectRef','expectedOrigin','sourceCommit','collectorSourceSha256','candidateSha256','migrationSha256','originalMigrationSha256'])
        reject(c=>{c[field]='unapproved';},'AMORA_VIEW_V2_RECOVERY_PROVENANCE_INVALID');
      reject(c=>{c.currentUser='service_role';},'AMORA_VIEW_V2_RECOVERY_DESTINATION_INVALID');
      reject(c=>{c.sourceSystemIdentifier=plan.contract.systemIdentifier;},'AMORA_VIEW_V2_RECOVERY_DESTINATION_INVALID');
      reject(c=>{c.readOnly=false;},'AMORA_VIEW_V2_RECOVERY_DESTINATION_INVALID');
      reject(c=>{c.capturedAt=new Date(Date.now()-121_000).toISOString();},'AMORA_VIEW_V2_RECOVERY_EXPIRED');
      reject(c=>{c.capturedAt=new Date(Date.now()+120_000).toISOString();},'AMORA_VIEW_V2_RECOVERY_EXPIRED');
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...raw.args,deadline:new Date(Date.now()-1_000).toISOString()}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_EXPIRED');
      for(const change of [c=>{c.target.functions[0].owner='service_role';},c=>{c.target.functions[0].securityDefiner=false;},
        c=>{c.target.functions[0].config.push('search_path=public');},c=>{c.target.functions[0].acl.push(['PUBLIC','postgres','EXECUTE',false]);},
        c=>{c.target.functions[0].acl[0][3]=true;},c=>{c.target.functions[0].bodyMd5='0'.repeat(32);},
        c=>{c.target.timestampTriggers[0][1]='D';},c=>{c.target.timestampTriggers[0][2]+='; DROP TABLE public.profiles;';}])
        reject(change,'AMORA_VIEW_V2_RECOVERY_ORIGINAL_DRIFT');
      reject(c=>{c.definitions[0].definition+='\nDROP TABLE public.profiles;';c.definitions[0].sha256=sha(c.definitions[0].definition);},
        'AMORA_VIEW_V2_RECOVERY_DEFINITION_INVALID');
      // 실제204b dependency를 synthetic9b로 대신한 운영 capsule은 금지한다. 운영 source라고 허위 승격하지 않는다.
      const supplied={...raw.args};delete supplied.expectedNativeSystemIdentifier;
      const productionLike=structuredClone(raw.capsule);
      productionLike.captureEnvironment='supabase-read-only';productionLike.currentUser='supabase_read_only_user';
      productionLike.sourceSystemIdentifier=plan.contract.systemIdentifier;
      const bytes=Buffer.from(JSON.stringify(productionLike));
      assert.throws(()=>recovery.validateAmoraActionViewV2RecoveryCapsule({...supplied,bytes,expectedArtifactSha256:sha(bytes)}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
      const issued=recovery.validateAmoraActionViewV2RecoveryCapsule(raw.args);
      const common={repoRoot,capsule:issued,expectedSystemIdentifier:raw.observation.systemIdentifier,deadline:raw.args.deadline};
      assert.throws(()=>recovery.buildAmoraActionViewV2OriginalReplaySql({...common,capsule:structuredClone(issued)}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_CAPSULE_NOT_ISSUED');
      assert.throws(()=>recovery.buildAmoraActionViewV2OriginalReplaySql({...common,expectedSystemIdentifier:plan.contract.systemIdentifier}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_LOCAL_DESTINATION_REQUIRED');
      assert.throws(()=>recovery.buildAmoraActionViewV2OriginalReplaySql({...common,restoreSucceeded:true}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_ARGUMENT_INVALID');
      assert.throws(()=>recovery.buildAmoraActionViewV2RecoveryCaptureSql({repoRoot,expectedCommit:commit,collectorSourceSha256:sha(readFileSync(moduleUrl)),verified:true}),
        error=>error.code==='AMORA_VIEW_V2_RECOVERY_ARGUMENT_INVALID');
    } finally {await f.close();}
  });

test('native replay rejects catalog/dependency drift and rolls back a DDL-time row corruption without issuing success',
  {skip:!nativeProfileRoleAvailable,timeout:90_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await f.seedCanonical();
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan),issued=recovery.validateAmoraActionViewV2RecoveryCapsule(raw.args);
      await f.exec(plan.sql);
      await f.db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',
        [plan.migration.version,plan.migration.name,[plan.sql]]);
      const render=()=>recovery.buildAmoraActionViewV2OriginalReplaySql({repoRoot,capsule:issued,
        expectedSystemIdentifier:raw.observation.systemIdentifier,deadline:raw.args.deadline});
      await f.exec('GRANT EXECUTE ON FUNCTION public.mutate_own_amora_action(uuid,text,text,jsonb) TO service_role');
      let before=await observe(f);
      await assert.rejects(f.db.query(render()),error=>error.code==='P0001'&&error.message==='AMORA_VIEW_V2_RECOVERY_APPLIED_DRIFT');
      await f.db.query('ROLLBACK');
      let after=await observe(f);
      for(const key of ['target','rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(after[key],before[key]);
      await f.exec('REVOKE EXECUTE ON FUNCTION public.mutate_own_amora_action(uuid,text,text,jsonb) FROM service_role');
      await f.exec('ALTER FUNCTION public.update_updated_at_column() SET search_path=public');
      before=await observe(f);
      await assert.rejects(f.db.query(render()),error=>error.code==='P0001'&&error.message==='AMORA_VIEW_V2_RECOVERY_DEPENDENCY_DRIFT');
      await f.db.query('ROLLBACK');
      after=await observe(f);
      for(const key of ['target','rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(after[key],before[key]);
      await f.exec('ALTER FUNCTION public.update_updated_at_column() RESET ALL');
      // 소유 격리 native 공격 fixture다. 임의 postgres 방어라고 확대하지 않는다.
      await f.exec(`CREATE FUNCTION public.synthetic_recovery_row_tamper() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE public.amora_actions SET description='SYNTHETIC-REPLAY-DRIFT' WHERE id='draft_canonical'; END $$;
        CREATE EVENT TRIGGER synthetic_recovery_row_tamper ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
        EXECUTE FUNCTION public.synthetic_recovery_row_tamper();`);
      before=await observe(f);
      await assert.rejects(f.db.query(render()),error=>error.code==='P0001'&&error.message==='AMORA_VIEW_V2_RECOVERY_POST_DRIFT');
      await f.db.query('ROLLBACK');
      after=await observe(f);
      for(const key of ['target','rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(after[key],before[key]);
      assert.deepEqual(after.target,plan.catalogFixture.applied,'failed original replay preserves the applied trigger');
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('native replay does not claim to retain a registered ledger row that is absent or has different source bytes',
  {skip:!nativeProfileRoleAvailable,timeout:60_000},async()=>{
    const recovery=await import(moduleUrl),plan=loadAmoraActionViewV2Plan(repoRoot);
    const f=await createDraftDatabase({native:true,candidate:false});
    try {
      await seedSyntheticAmoraHistoryLedger(f,plan,repoRoot);
      const raw=await capture(f,plan),issued=recovery.validateAmoraActionViewV2RecoveryCapsule(raw.args);
      await f.exec(plan.sql);
      const render=()=>recovery.buildAmoraActionViewV2OriginalReplaySql({repoRoot,capsule:issued,
        expectedSystemIdentifier:raw.observation.systemIdentifier,deadline:raw.args.deadline});
      const missingBefore=await observe(f);
      await assert.rejects(f.db.query(render()),error=>error.code==='P0001'&&error.message==='AMORA_VIEW_V2_RECOVERY_LEDGER_DRIFT');
      await f.db.query('ROLLBACK');
      const missingAfter=await observe(f);
      for(const key of ['target','rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(missingAfter[key],missingBefore[key]);
      await f.db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',
        [plan.migration.version,plan.migration.name,['SYNTHETIC-CORRUPT-SOURCE']]);
      const corruptBefore=await observe(f);
      await assert.rejects(f.db.query(render()),error=>error.code==='P0001'&&error.message==='AMORA_VIEW_V2_RECOVERY_LEDGER_DRIFT');
      await f.db.query('ROLLBACK');
      const corruptAfter=await observe(f);
      for(const key of ['target','rows','ledger','ledgerMd5','preservedCatalogMd5']) assert.deepEqual(corruptAfter[key],corruptBefore[key]);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });
