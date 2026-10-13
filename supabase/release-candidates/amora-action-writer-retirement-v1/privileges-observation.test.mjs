import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildAmoraWriterPrivilegesObservationSql,validateAmoraWriterPrivilegesObservation} from './privileges-observation.mjs';
import {createPrivilegeDatabase,nativeProfileRoleAvailable} from './privileges-fixture.mjs';

const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const frozen=[
  ['../amora-action-writer-cutover-v1/cutover_writer_retirement_identity_v1.sql','25b78629def538a85e13848df70f5e9142df8469f5ee75aa1096dfb1183ef2ca'],
  ['./retirement_service_writers_v1.sql','56edb08862ce7e178a35a357abd323954a8b35debd1fe8f2c0906aa51b6588d4'],
  ['./retirement_reserved_plan_writers_v1.sql','20138aab7a821c4e6ddc105b3a480160942800c389157afd500efccc91d2380d'],
  ['./retirement_direct_journey_guard_v1.sql','3b98d9c86e1092fa5e1cd10561cfc1d25cb30e405dfc144320e9e717ddc9103c'],
];
const candidateSql=()=>frozen.map(([file,expected])=>{
  const bytes=readFileSync(new URL(file,import.meta.url));assert.equal(sha(bytes),expected);
  return bytes.toString('utf8');
});
async function observe(f,phase) {
  const result=await f.db.query(buildAmoraWriterPrivilegesObservationSql({repoRoot,phase}));
  return (Array.isArray(result)?result:[result]).find(row=>row.rows?.[0]?.observation)?.rows[0].observation;
}
const check=(observation,id,phase='before',beforeObservation=null)=>validateAmoraWriterPrivilegesObservation(
  observation,{repoRoot,phase,expectedNativeSystemIdentifier:id,beforeObservation});

test('native SET-only journey progress-column writer is NO-GO without a whole-table UPDATE grant',
  {timeout:120_000},async()=>{
    const f=await createPrivilegeDatabase({phase:'before'});
    try {
      const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
      await f.exec(`CREATE ROLE b2_journey_set_writer BYPASSRLS;
        GRANT USAGE ON SCHEMA public TO b2_journey_set_writer;
        GRANT UPDATE(progress) ON public.wedding_journeys TO b2_journey_set_writer;
        GRANT b2_journey_set_writer TO service_role WITH INHERIT FALSE, SET TRUE`);
      const actual=(await f.db.query(`SELECT
        has_table_privilege('b2_journey_set_writer','public.wedding_journeys','UPDATE') AS whole,
        has_any_column_privilege('b2_journey_set_writer','public.wedding_journeys','UPDATE') AS any_column,
        has_column_privilege('b2_journey_set_writer','public.wedding_journeys','progress','UPDATE') AS progress,
        pg_has_role('service_role','b2_journey_set_writer','USAGE') AS inherits,
        pg_has_role('service_role','b2_journey_set_writer','SET') AS switches`)).rows[0];
      assert.deepEqual(actual,{whole:false,any_column:true,progress:true,inherits:false,switches:true});
      const dirty=await observe(f,'before');
      assert.throws(()=>check(dirty,id),/REACHABLE_WRITER_BYPASS/);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('native ADMIN-only journey progress-column writer is NO-GO before self-enabling SET',
  {timeout:120_000},async()=>{
    const f=await createPrivilegeDatabase({phase:'before'});
    try {
      const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
      await f.exec(`CREATE ROLE b2_journey_admin_writer BYPASSRLS;
        GRANT USAGE ON SCHEMA public TO b2_journey_admin_writer;
        GRANT UPDATE(progress) ON public.wedding_journeys TO b2_journey_admin_writer;
        GRANT b2_journey_admin_writer TO service_role WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
      const actual=(await f.db.query(`SELECT
        has_table_privilege('b2_journey_admin_writer','public.wedding_journeys','UPDATE') AS whole,
        has_any_column_privilege('b2_journey_admin_writer','public.wedding_journeys','UPDATE') AS any_column,
        has_column_privilege('b2_journey_admin_writer','public.wedding_journeys','progress','UPDATE') AS progress,
        pg_has_role('service_role','b2_journey_admin_writer','USAGE') AS inherits,
        pg_has_role('service_role','b2_journey_admin_writer','SET') AS switches`)).rows[0];
      assert.deepEqual(actual,{whole:false,any_column:true,progress:true,inherits:false,switches:false});
      const proof=await f.db.query(`BEGIN; SET LOCAL ROLE service_role;
        GRANT b2_journey_admin_writer TO service_role WITH SET TRUE;
        SELECT pg_has_role('service_role','b2_journey_admin_writer','SET') AS can_switch; ROLLBACK`);
      assert.equal(proof.find(result=>result.rows?.[0]?.can_switch!==undefined).rows[0].can_switch,true);
      const dirty=await observe(f,'before');
      assert.equal(dirty.reachability.find(row=>row[0]==='service_role'&&row[1]==='b2_journey_admin_writer')[4],false);
      assert.throws(()=>check(dirty,id),/ADMIN_WRITER_BYPASS/);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('native status CRLF exact actual pair is compatible before and after, without accepting LF as a production alternative',
  {timeout:120_000},async()=>{
    const f=await createPrivilegeDatabase({phase:'before'});
    try {
      const original=readFileSync(new URL('../../migrations/20260615101000_fix_amora_action_status_timestamps.sql',import.meta.url),'utf8');
      const pieces=original.split('$$');assert.equal(pieces.length,3);
      assert.equal(sha(pieces[1]),'b0459301f48a8f9d9313b6c319e1f5c704c88ecf7d60a33a6b86d35c849349f6');
      pieces[1]=pieces[1].replace(/\n/g,'\r\n');
      assert.equal(sha(pieces[1]),'1ca50d98486ba9a8c90b6fcbdaa14bd01a2fa26737fc48a2b664f21e1b30dae4');
      await f.exec(pieces.join('$$'));
      const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
      const before=await observe(f,'before');
      const status=before.functions.find(fn=>fn.identity==='public.set_amora_action_status_timestamps()');
      assert.equal(status.bodyMd5,'aee9c4ab5fecc898ff52e1160decad22');
      assert.equal(status.bodySha256,'1ca50d98486ba9a8c90b6fcbdaa14bd01a2fa26737fc48a2b664f21e1b30dae4');
      assert.equal(check(before,id).status,'catalog-compatible-before');
      for(const sql of candidateSql())await f.exec(sql);
      const after=await observe(f,'after');
      assert.equal(check(after,id,'after',before).status,'catalog-compatible-after');
      const wrong=structuredClone(after);
      const wrongStatus=wrong.functions.find(fn=>fn.identity===status.identity);
      wrongStatus.bodyMd5='81845432224794db21b09bd8cf444b12';
      wrongStatus.bodySha256='b0459301f48a8f9d9313b6c319e1f5c704c88ecf7d60a33a6b86d35c849349f6';
      assert.throws(()=>check(wrong,id,'after',before),/FUNCTION_DRIFT.*bodyMd5/);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('B2 observer rejects unknown options before returning SQL and never reads customer rows',()=>{
  assert.throws(()=>buildAmoraWriterPrivilegesObservationSql({repoRoot,phase:'unknown'}),/OPTIONS_INVALID/);
  assert.throws(()=>buildAmoraWriterPrivilegesObservationSql({repoRoot,phase:'before',verified:true}),/OPTIONS_INVALID/);
  const sql=buildAmoraWriterPrivilegesObservationSql({repoRoot,phase:'before'});
  assert.match(sql,/^BEGIN READ ONLY;/);
  assert.match(sql,/COMMIT;\n$/);
  assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE public\.|ALTER |REVOKE |GRANT |DELETE FROM|DROP )/i);
  assert.doesNotMatch(sql,/\bFROM\s+(?:public\.|auth\.|storage\.)/i);
  assert.doesNotMatch(sql,/pg_authid|rolpassword|prosrc\s*AS|pg_get_functiondef\([^)]*\)\s*AS/i);
});

test('native non-generic definition hash metadata rejects JSON arrays instead of string coercion',
  {timeout:90_000},async()=>{
    const f=await createPrivilegeDatabase({phase:'before'});
    try {
      const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
      const before=await observe(f,'before');
      const identity='public.mutate_own_amora_action(uuid,text,text,jsonb)';
      for(const invalidValue of [[before.functions.find(fn=>fn.identity===identity).definitionSha256],null,'wrong']) {
        const invalid=structuredClone(await observe(f,'before'));
        invalid.functions.find(fn=>fn.identity===identity).definitionSha256=invalidValue;
        assert.throws(()=>check(invalid,id),/SHAPE_INVALID/);
      }
      const invalid=structuredClone(await observe(f,'before'));invalid.functions.find(fn=>fn.identity===identity).rawAcl=[1];
      assert.throws(()=>check(invalid,id),/SHAPE_INVALID/);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('actual owned PG17 observes both current guard catalog phases without operational authorization',
  {timeout:300_000},async t=>{
    assert.equal(nativeProfileRoleAvailable,true,'Owned PG17 is required, not a skipped verification');
    const f=await createPrivilegeDatabase({phase:'before'});
    try {
      const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
      let before=await observe(f,'before');
      await t.test('before uses actual local identity, complete original guards, raw roles/ACL and 19 functions',()=>{
        const result=check(before,id);
        assert.equal(before.functions.length,19);
        assert.equal(before.tables.find(row=>row.name==='wedding_journeys').triggers.length,8);
        assert.equal(result.status,'catalog-compatible-before');
        assert.equal(result.lane,'owned-native-catalog-content-only');
        for(const key of ['releaseAuthorized','executionProvenanceVerified','privateRecoveryVerified',
          'fullSchemaVerified','ledgerVerified','remoteWritesPerformed'])assert.equal(result[key],false);
        assert.equal(f.fullSchemaVerified,false);
        assert.match(f.baselineDifferences.join('\n'),/CRLF/);
      });
      await t.test('native direct column grant is outside the table-only scope and PG17 nominal REVOKE also removes it',async()=>{
        await f.exec('GRANT UPDATE(title) ON public.amora_actions TO service_role');
        try {
          const dirty=await observe(f,'before');
          assert.throws(()=>check(dirty,id),/COLUMN_GRANT_BYPASS/);
          await f.exec('REVOKE UPDATE ON public.amora_actions FROM service_role');
          const remaining=(await f.db.query(`SELECT has_table_privilege('service_role','public.amora_actions','UPDATE') AS whole,
            has_any_column_privilege('service_role','public.amora_actions','UPDATE') AS column,
            has_column_privilege('service_role','public.amora_actions','title','UPDATE') AS title`)).rows[0];
          assert.deepEqual(remaining,{whole:false,column:false,title:false});
        } finally {await f.exec('REVOKE UPDATE(title) ON public.amora_actions FROM service_role; GRANT UPDATE ON public.amora_actions TO service_role');}
      });
      await t.test('actual inherited column UPDATE remains after the nominal service table REVOKE',async()=>{
        await f.exec(`CREATE ROLE b2_column_writer;
          GRANT UPDATE(title) ON public.amora_actions TO b2_column_writer;
          GRANT b2_column_writer TO service_role WITH INHERIT TRUE, SET TRUE`);
        try {
          const dirty=await observe(f,'before');
          assert.throws(()=>check(dirty,id),/COLUMN_GRANT_BYPASS|REACHABLE_WRITER_BYPASS/);
          await f.exec('REVOKE UPDATE ON public.amora_actions FROM service_role');
          const remaining=(await f.db.query(`SELECT has_table_privilege('service_role','public.amora_actions','UPDATE') AS whole,
            has_any_column_privilege('service_role','public.amora_actions','UPDATE') AS column,
            has_column_privilege('service_role','public.amora_actions','title','UPDATE') AS title`)).rows[0];
          assert.deepEqual(remaining,{whole:false,column:true,title:true});
        } finally {await f.exec(`REVOKE b2_column_writer FROM service_role;
          REVOKE UPDATE(title) ON public.amora_actions FROM b2_column_writer;
          DROP ROLE b2_column_writer; GRANT UPDATE ON public.amora_actions TO service_role`);}
      });
      await t.test('actual argument default drift with identical body is NO-GO',async()=>{
        const definition=(await f.db.query(`SELECT pg_get_functiondef('public.apply_journey_progress_item_patch(uuid,text,jsonb)'::regprocedure) AS value`)).rows[0].value;
        assert.match(definition,/DEFAULT '\{\}'::jsonb/);
        await f.exec(definition.replace("DEFAULT '{}'::jsonb","DEFAULT '{\"unexpected\":true}'::jsonb"));
        try {const dirty=await observe(f,'before');assert.throws(()=>check(dirty,id),/FUNCTION_DRIFT.*(?:arguments|defaults)/);}
        finally {await f.exec(definition);}
      });
      await t.test('actual inherited table UPDATE remains after the nominal service REVOKE',async()=>{
        await f.exec(`CREATE ROLE b2_inherited_writer;
          GRANT UPDATE ON public.amora_actions TO b2_inherited_writer;
          GRANT b2_inherited_writer TO service_role WITH INHERIT TRUE, SET TRUE;
          REVOKE UPDATE ON public.amora_actions FROM service_role`);
        try {
          const actual=(await f.db.query(`SELECT has_table_privilege('service_role','public.amora_actions','UPDATE') AS writes,
            pg_has_role('service_role','b2_inherited_writer','USAGE') AS inherits,
            pg_has_role('service_role','b2_inherited_writer','SET') AS switches`)).rows[0];
          assert.deepEqual(actual,{writes:true,inherits:true,switches:true});
          const dirty=await observe(f,'before');
          assert.throws(()=>check(dirty,id),/TABLE_ACL_DRIFT|REACHABLE_WRITER_BYPASS/);
        } finally {await f.exec(`REVOKE b2_inherited_writer FROM service_role;
          REVOKE UPDATE ON public.amora_actions FROM b2_inherited_writer;
          DROP ROLE b2_inherited_writer; GRANT UPDATE ON public.amora_actions TO service_role`);}
      });
      await t.test('SET-only owner membership cannot bypass the invoker current_user condition',async()=>{
        await f.exec('GRANT postgres TO service_role WITH INHERIT FALSE, SET TRUE');
        try {
          const dirty=await observe(f,'before');
          const reach=dirty.reachability.find(row=>row[0]==='service_role'&&row[1]==='postgres');
          assert.equal(reach[3],false);assert.equal(reach[4],true);
          assert.throws(()=>check(dirty,id),/REACHABLE_WRITER_BYPASS/);
        } finally {await f.exec('REVOKE postgres FROM service_role');}
      });
      await t.test('ADMIN-only membership in the existing writer role cannot become a SET-role bypass',async()=>{
        await f.exec('GRANT service_role TO authenticated WITH ADMIN TRUE, INHERIT FALSE, SET FALSE');
        try {
          const dirty=await observe(f,'before');
          const reach=dirty.reachability.find(row=>row[0]==='authenticated'&&row[1]==='service_role');
          assert.equal(reach[3],false);assert.equal(reach[4],false);
          const proof=await f.db.query(`BEGIN; SET LOCAL ROLE authenticated;
            GRANT service_role TO authenticated WITH SET TRUE;
            SELECT pg_has_role('authenticated','service_role','SET') AS can_switch; ROLLBACK`);
          assert.equal(proof.find(result=>result.rows?.[0]?.can_switch!==undefined).rows[0].can_switch,true);
          assert.throws(()=>check(dirty,id),/ADMIN_WRITER_BYPASS/);
        } finally {await f.exec('REVOKE service_role FROM authenticated CASCADE');}
      });
      await t.test('postgres function default EXECUTE to an unretired role is NO-GO, not an automatic REVOKE',async()=>{
        await f.exec(`CREATE ROLE b2_default_executor;
          ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO b2_default_executor`);
        try {
          const dirty=await observe(f,'before');
          assert.equal(dirty.functionDefaults.some(d=>d.acl.some(row=>row[0]==='b2_default_executor')),true);
          assert.throws(()=>check(dirty,id),/DEFAULT_EXECUTE_BYPASS/);
        } finally {await f.exec(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
          REVOKE EXECUTE ON FUNCTIONS FROM b2_default_executor; DROP ROLE b2_default_executor`);}
      });
      await t.test('actual disabled journey boundary trigger is NO-GO',async()=>{
        await f.exec('ALTER TABLE public.wedding_journeys DISABLE TRIGGER trg_00_enforce_couple_plan_change_write_boundary');
        try {const dirty=await observe(f,'before');assert.throws(()=>check(dirty,id),/TRIGGER_DRIFT/);}
        finally {await f.exec('ALTER TABLE public.wedding_journeys ENABLE TRIGGER trg_00_enforce_couple_plan_change_write_boundary');}
      });
      await t.test('actual v2 SECURITY INVOKER drift is NO-GO',async()=>{
        await f.exec('ALTER FUNCTION public.patch_own_amora_action_view_v2(uuid,text,text,jsonb) SECURITY INVOKER');
        try {const dirty=await observe(f,'before');assert.throws(()=>check(dirty,id),/FUNCTION_DRIFT.*securityDefiner/);}
        finally {await f.exec('ALTER FUNCTION public.patch_own_amora_action_view_v2(uuid,text,text,jsonb) SECURITY DEFINER');}
      });
      await t.test('metadata-only shape, freshness, source and native identity failures stay closed',async()=>{
        for(const [edit,expected] of [
          [o=>{delete o.memberships;},/SHAPE_INVALID/],
          [o=>{o.reachability.pop();},/GRAPH_MISSING/],
          [o=>{o.observedAt='2020-01-01T00:00:00Z';},/EXPIRED/],
          [o=>{o.observedAt=[o.observedAt];},/SHAPE_INVALID/],
          [o=>{o.serverVersion=[o.serverVersion];},/DESTINATION_INVALID/],
          [o=>{o.sourceSha256='0'.repeat(64);},/SOURCE_INVALID/],
          [o=>{o.systemIdentifier='7581440907192989109';},/DESTINATION_INVALID/],
          [o=>{o.functions[0].bodySha256='0'.repeat(64);},/FUNCTION_DRIFT/],
          [o=>{o.readOnly=false;},/DESTINATION_INVALID/],
          [o=>{o.tables[0].columns.pop();},/COLUMN_DRIFT/],
        ]) {
          // 다른 긴 테스트의 오래된 snapshot 대신 매번 actual READ ONLY capture에서 불량 입력을 만든다.
          const invalid=structuredClone(await observe(f,'before'));edit(invalid);
          assert.throws(()=>check(invalid,id),expected);
        }
        const actual=await observe(f,'before');
        assert.throws(()=>validateAmoraWriterPrivilegesObservation(actual,{repoRoot,phase:'before',
          expectedNativeSystemIdentifier:id,beforeObservation:null,verified:true}),/OPTIONS_INVALID/);
      });
      await t.test('after actual frozen bundle uses the same identity and requires an actual fresh before observation',async()=>{
        before=await observe(f,'before');
        for(const sql of candidateSql())await f.exec(sql);
        const after=await observe(f,'after');
        const result=check(after,id,'after',before);
        assert.equal(result.status,'catalog-compatible-after');
        assert.equal(after.functions.length,21);
        assert.equal(after.tables.find(row=>row.name==='wedding_journeys').triggers.length,9);
        assert.throws(()=>check(after,id,'after',null),/BEFORE_REQUIRED/);
        const service=after.tables.find(row=>row.name==='amora_actions').effective.find(row=>row.role==='service_role');
        assert.equal(service.anyColumnUpdate,false);
        assert.equal(service.columns.every(([,value])=>value===false),true);
      });
      await t.test('after direct column UPDATE and private guard EXECUTE grants cannot be hidden by a nominal successful bundle',async()=>{
        await f.exec('GRANT UPDATE(title) ON public.amora_actions TO service_role');
        try {const dirty=await observe(f,'after');assert.throws(()=>check(dirty,id,'after',before),/COLUMN_UPDATE_REMAINS/);}
        finally {await f.exec('REVOKE UPDATE(title) ON public.amora_actions FROM service_role');}
        await f.exec('GRANT EXECUTE ON FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1() TO service_role');
        try {const dirty=await observe(f,'after');assert.throws(()=>check(dirty,id,'after',before),/FUNCTION_ACL_DRIFT/);}
        finally {await f.exec('REVOKE EXECUTE ON FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1() FROM service_role');}
      });
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });

test('after role/default/schema/column observations must preserve the same actual before surface',
  {timeout:120_000},async()=>{
    // 다른 after negative들의 지연/변경을 공유하지 않는 실제 fresh owned before→after pair다.
    const f=await createPrivilegeDatabase({phase:'before'});
    try {
      const id=(await f.db.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id;
      const before=await observe(f,'before');
      for(const sql of candidateSql())await f.exec(sql);
      assert.equal(check(await observe(f,'after'),id,'after',before).status,'catalog-compatible-after');
      await f.exec('ALTER ROLE service_role NOINHERIT');
      try {const dirty=await observe(f,'after');assert.throws(()=>check(dirty,id,'after',before),/PRESERVED_SURFACE_CHANGED/);}
      finally {await f.exec('ALTER ROLE service_role INHERIT');}
      const invalid=structuredClone(before);invalid.observedAt='2020-01-01T00:00:00Z';
      const restored=await observe(f,'after');
      assert.throws(()=>check(restored,id,'after',invalid),/EXPIRED/);
    } finally {await f.db.query('ROLLBACK').catch(()=>{});await f.close();}
  });
