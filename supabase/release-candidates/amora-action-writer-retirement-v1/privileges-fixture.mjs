import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createDraftDatabase} from '../amora-action-view-v2/draft-fixture.mjs';
export {nativeProfileRoleAvailable} from '../amora-action-view-v2/draft-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const migration=name=>readFileSync(new URL(`../../migrations/${name}`,import.meta.url),'utf8');
const pinnedSql=(path,expected)=>{
  const bytes=readFileSync(new URL(path,import.meta.url));
  assert.equal(sha(bytes),expected,`Frozen privilege fixture SQL changed: ${path}`);
  return bytes.toString('utf8');
};
const companions=[
  ['../amora-action-writer-cutover-v1/cutover_writer_retirement_identity_v1.sql','25b78629def538a85e13848df70f5e9142df8469f5ee75aa1096dfb1183ef2ca'],
  ['./retirement_service_writers_v1.sql','56edb08862ce7e178a35a357abd323954a8b35debd1fe8f2c0906aa51b6588d4'],
  ['./retirement_reserved_plan_writers_v1.sql','20138aab7a821c4e6ddc105b3a480160942800c389157afd500efccc91d2380d'],
  ['./retirement_direct_journey_guard_v1.sql','3b98d9c86e1092fa5e1cd10561cfc1d25cb30e405dfc144320e9e717ddc9103c'],
];
const originalFunction=(file,name)=>{
  const source=migration(file);
  const matches=[...source.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$function\\$;`,'g'))];
  assert.equal(matches.length,1,`One real original function required: ${name}`);
  return matches[0][0];
};
const witnessedProgressPatchSql=()=>{
  const pieces=migration('20260611160000_journey_progress_atomic_merge.sql').split('$$');
  assert.equal(pieces.length,3,'One original generic patch body delimiter pair required');
  assert.equal(sha(pieces[1]),'2c4df45af3a71e1f67268c96b46e88dbd706b476bd4e531b3e74f0d1b0b9abe8');
  // 승인된 한정 bridge: 이 함수 본문의 줄바꿈만 actual witness CRLF로 설치한다.
  // header/ACL/logic/다른 함수/운영 시각·ID는 바꾸지 않으며 full-definition 복구 증거가 아니다.
  pieces[1]=pieces[1].replace(/\n/g,'\r\n');
  assert.equal(sha(pieces[1]),'79bf17d9a7be4582f023dc64282ef03fda1c122c5f21ad40c9a6e9b1bf88ebab');
  return pieces.join('$$');
};
const witnessedStatusSql=()=>{
  const pieces=migration('20260615101000_fix_amora_action_status_timestamps.sql').split('$$');
  assert.equal(pieces.length,3,'One original status body delimiter pair required');
  assert.equal(sha(pieces[1]),'b0459301f48a8f9d9313b6c319e1f5c704c88ecf7d60a33a6b86d35c849349f6');
  // 별도 부모 승인: repo의 이 한 body를 actual CRLF로 파생한다. actual capsule/시각/ID는 복사하지 않는다.
  pieces[1]=pieces[1].replace(/\n/g,'\r\n');
  assert.equal(sha(pieces[1]),'1ca50d98486ba9a8c90b6fcbdaa14bd01a2fa26737fc48a2b664f21e1b30dae4');
  return pieces.join('$$');
};

// 파운더가 허용한 비민감 generic177 seed다. private capsule/원문4/운영 시각·ID는 복사하지 않는다.
const genericSeed="CREATE OR REPLACE FUNCTION public.update_updated_at_column()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\r\nbegin\r\n  new.updated_at = now();\r\n  return new;\r\nend;\r\n$function$\n";
const privateConfig=['search_path=""','lock_timeout=5s','statement_timeout=15s'];
const sharedConfig=['search_path=pg_catalog, public'];
// Oct12 16:54 읽기 전용 witness의 제한된 6개 metadata. 최신 운영 검사 증거가 아니다.
const originalFunctions=[
  ['public.mutate_own_amora_action(uuid,text,text,jsonb)','3419a2b1b8f52cf5d34144bc9ddf61bc','07085042f813b827e5fae97c2fbc7074',privateConfig,['authenticated','postgres']],
  ['public.update_own_legacy_amora_action(uuid,uuid,text,bigint,jsonb)','ede95d70f5c0cbaaa9825698ec5c702e','97eaa4be36899122624f9d97309fec4c',privateConfig,['authenticated','postgres']],
  ['public.apply_journey_progress_patch(uuid,jsonb,text[])','8b4fa7b975715aa7cb6bcf076052c498','f6625ebf2b79c6c01d149db7626583b4',['search_path=public'],['postgres','service_role']],
  ['public.apply_journey_progress_item_patch(uuid,text,jsonb)','4e76a74b30c2f2277f16c1e754b22be4','7516100ba1f1f81ab6cd814324f9eceb',sharedConfig,['postgres','service_role']],
  ['public.normalize_couple_plan_changes(jsonb)','706476cf0b9fb4972137cbd5669bf1e2','216b81833f35e37be7f103ef7102cb4a',sharedConfig,['postgres']],
  ['public.apply_couple_plan_change_locked(uuid,uuid)','0936548c6c7be1885a9d4f6e845d2a3d','3d79b47b9a5bc9a5f81545a3219590d5',sharedConfig,['postgres']],
];
const journeyFunctions=[
  ['20260802140000_amora_manual_schedule_fairness.sql','authorize_booking_projection_journey_write','7f7d9487dc217f7809c678958fb721da'],
  ['20260823120000_couple_approval_becomes_notification.sql','enforce_couple_plan_change_write_boundary','a7adea14a47829f6b283952640691dae'],
  ['20260802140000_amora_manual_schedule_fairness.sql','clear_booking_projection_boundary_alias','4ec801a326d21ac552eef0f2d45fe5c8'],
  ['20260802170000_amora_shared_action_roster_binding.sql','advance_wedding_journey_state_revision','16facd1736910df702ae86620c9e9a46'],
  ['20260910160514_amora_shared_budget_decision_receipts.sql','capture_amora_shared_budget_delta','5a8580ec8fc9aadc0486baed9752281a'],
  ['20260802140000_amora_manual_schedule_fairness.sql','capture_amora_shared_schedule_cancel_restore_delta','f646b87909ae2482e1d97f9b9aef54ab'],
  ['20260827090000_move_card_can_name_what_it_moves.sql','capture_amora_shared_schedule_delta','a60e1e54508d964603c561e6a3857dfa'],
];
const journeyTriggers=[
  ['trg_00_authorize_booking_projection','BEFORE UPDATE','authorize_booking_projection_journey_write','7f7d9487dc217f7809c678958fb721da'],
  ['trg_00_enforce_couple_plan_change_write_boundary','BEFORE INSERT OR UPDATE','enforce_couple_plan_change_write_boundary','a7adea14a47829f6b283952640691dae'],
  ['trg_01_clear_booking_projection_boundary_alias','BEFORE UPDATE','clear_booking_projection_boundary_alias','4ec801a326d21ac552eef0f2d45fe5c8'],
  ['trg_advance_wedding_journey_state_revision','BEFORE INSERT OR UPDATE','advance_wedding_journey_state_revision','16facd1736910df702ae86620c9e9a46'],
  ['trg_capture_amora_shared_budget_delta','AFTER UPDATE','capture_amora_shared_budget_delta','5a8580ec8fc9aadc0486baed9752281a'],
  ['trg_capture_amora_shared_schedule_cancel_restore_delta','BEFORE UPDATE','capture_amora_shared_schedule_cancel_restore_delta','f646b87909ae2482e1d97f9b9aef54ab'],
  ['trg_capture_amora_shared_schedule_delta','BEFORE UPDATE','capture_amora_shared_schedule_delta','a60e1e54508d964603c561e6a3857dfa'],
  ['update_wedding_journeys_updated_at','BEFORE UPDATE','update_updated_at_column','204b9b9355e61b7541bc0633bbc9294c'],
];
const columns={
  amora_actions:[['id','text',true],['couple_id','uuid',true],['title','text',true],['description','text',false],
    ['due_date','text',false],['category_key','text',false],['priority','text',true],['status','text',true],
    ['source','text',true],['href','text',false],['metadata','jsonb',true],['created_by','uuid',false],
    ['created_at','timestamp with time zone',true],['updated_at','timestamp with time zone',true],
    ['completed_at','timestamp with time zone',false],['dismissed_at','timestamp with time zone',false]],
  wedding_journeys:[['id','uuid',true],['couple_id','uuid',true],['wedding_date','date',false],
    ['category_statuses','jsonb',false],['checklist_progress','jsonb',false],['priority_category','text',false],
    ['total_budget','integer',false],['sdme_budget','integer',false],['is_onboarding_complete','boolean',false],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
    ['progress','jsonb',false],['venue','text',false],['state_revision','bigint',true]],
};
const differences=Object.freeze([
  'Owned local PG17.10 identity/clock are actual local values, not operating PG17.6 identity/clock.',
  'Rows and auth.uid/auth.role are synthetic local JWT fixtures; no customer data or real approval ledger is copied.',
  'Journey physical column order/defaults/indexes/constraints and RLS policy bodies are not a full production clone.',
  'Role flags/membership/default ACL are isolated synthetic defaults; actual role graph has not been collected here.',
  'Only six writer function metadata, canonical16/source6, journey14 column descriptors and eight journey trigger slots/body hashes are matched.',
  'Approved generic patch prosrc LF-to-CRLF bridge only: witness MD5 8b4fa7b975715aa7cb6bcf076052c498 / SHA256 79bf17d9a7be4582f023dc64282ef03fda1c122c5f21ad40c9a6e9b1bf88ebab; not a full-definition capture/recovery.',
  'Separately approved status prosrc LF-to-CRLF bridge only: actual MD5 aee9c4ab5fecc898ff52e1160decad22 / SHA256 1ca50d98486ba9a8c90b6fcbdaa14bd01a2fa26737fc48a2b664f21e1b30dae4; LF is not an operating alternative, not full-definition recovery.',
  'AI/booking/notification/acceptance/Storage/Auth saga surroundings and migration ledger230/231 are not installed or verified.',
]);

async function assertScopedMetadata(f,phase) {
  for(const [identity,beforeHash,afterHash,config,grantees] of originalFunctions) {
    const {rows}=await f.db.query(`SELECT md5(p.prosrc) AS hash,pg_get_userbyid(p.proowner) AS owner,
      p.proconfig AS config,p.prosecdef AS definer,
      (SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
         pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
         ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)
       FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a) AS acl
      FROM pg_proc p WHERE p.oid=to_regprocedure($1)`,[identity]);
    assert.equal(rows.length,1,`Actual installed metadata missing: ${identity}`);
    assert.deepEqual(rows[0],{hash:phase==='before'?beforeHash:afterHash,owner:'postgres',config,definer:true,
      acl:[...grantees].sort().map(name=>[name,'postgres','EXECUTE',false])},`Witnessed writer metadata differs: ${identity}`);
  }
  const patchBodySha=(await f.db.query(`SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS sha
    FROM pg_proc WHERE oid='public.apply_journey_progress_patch(uuid,jsonb,text[])'::regprocedure`)).rows[0]?.sha;
  const frozenPatchBody=pinnedSql('./retirement_service_writers_v1.sql',companions[1][1])
    .match(/\$function\$([\s\S]*?)\$function\$;/)?.[1];
  assert.ok(frozenPatchBody,'Frozen after generic patch body is missing');
  assert.equal(patchBodySha,phase==='before'
    ?'79bf17d9a7be4582f023dc64282ef03fda1c122c5f21ad40c9a6e9b1bf88ebab':sha(frozenPatchBody),
  'Native installed generic patch prosrc SHA differs');
  for(const [table,expected] of Object.entries(columns)) {
    const {rows}=await f.db.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS required,a.attidentity AS identity,a.attgenerated AS generated
      FROM pg_attribute a WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY a.attname`,[`public.${table}`]);
    assert.deepEqual(rows,expected.map(([name,type,required])=>({name,type,required,identity:'',generated:''}))
      .sort((a,b)=>a.name.localeCompare(b.name)),`Scoped columns differ: ${table}`);
  }
  const {rows}=await f.db.query(`SELECT t.tgname AS name,t.tgenabled AS enabled,
    pg_get_triggerdef(t.oid,true) AS definition,md5(p.prosrc) AS hash FROM pg_trigger t
    JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.wedding_journeys'::regclass
    AND NOT t.tgisinternal AND t.tgname=ANY($1::text[]) ORDER BY t.tgname`,[journeyTriggers.map(row=>row[0])]);
  assert.deepEqual(rows,journeyTriggers.map(([name,event,fn,hash])=>({name,enabled:'O',
    definition:`CREATE TRIGGER ${name} ${event} ON wedding_journeys FOR EACH ROW EXECUTE FUNCTION ${fn}()`,hash}))
    .sort((a,b)=>a.name.localeCompare(b.name)),'Eight witnessed journey trigger slots differ');
  const allTriggers=(await f.db.query(`SELECT tgname AS name FROM pg_trigger
    WHERE tgrelid='public.wedding_journeys'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows.map(row=>row.name);
  assert.deepEqual(allTriggers,[...journeyTriggers.map(row=>row[0]),...(phase==='after'
    ?['guard_amora_reserved_journey_direct_dml_retirement_v1']:[])].sort(),'Unexpected journey trigger slot');
  const dependency=(await f.db.query(`SELECT md5(p.prosrc) AS hash,pg_get_functiondef(p.oid) AS definition,
    pg_get_userbyid(p.proowner) AS owner,p.proconfig AS config,p.prosecdef AS definer,
    (SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
      ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)
     FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a) AS acl
    FROM pg_proc p WHERE p.oid='public.update_updated_at_column()'::regprocedure`)).rows[0];
  assert.equal(dependency.hash,'204b9b9355e61b7541bc0633bbc9294c');
  assert.equal(sha(dependency.definition),'7b39b72b4fe4d1981fca770b1ad1ad6e062d560822731577e5ae3f1449ffef02');
  const dependencyMetadata={owner:dependency.owner,config:dependency.config,definer:dependency.definer,acl:dependency.acl};
  assert.deepEqual(dependencyMetadata,{owner:'postgres',config:null,definer:false,
    acl:['PUBLIC','anon','authenticated','postgres','service_role'].map(name=>[name,'postgres','EXECUTE',false])},
  'Generic177 dependency owner/config/ACL5 differs');
  const status=(await f.db.query(`SELECT md5(prosrc) AS md5,encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS sha
    FROM pg_proc WHERE oid='public.set_amora_action_status_timestamps()'::regprocedure`)).rows[0];
  assert.deepEqual(status,{md5:'aee9c4ab5fecc898ff52e1160decad22',
    sha:'1ca50d98486ba9a8c90b6fcbdaa14bd01a2fa26737fc48a2b664f21e1b30dae4'},
  'Actual status CRLF strong body pair differs');
  const sourceConstraint=(await f.db.query(`SELECT pg_get_constraintdef(oid,true) AS definition FROM pg_constraint
    WHERE conrelid='public.amora_actions'::regclass AND conname='amora_actions_source_check'`)).rows[0];
  assert.equal(sourceConstraint?.definition,
    "CHECK (source = ANY (ARRAY['chat'::text, 'quote'::text, 'schedule'::text, 'budget'::text, 'guardrail'::text, 'manual'::text]))",
  'Six existing canonical sources differ');
  const tablePrivileges=(await f.db.query(`SELECT c.relname AS name,pg_get_userbyid(c.relowner) AS owner,
    c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,
    has_table_privilege('service_role',c.oid,'UPDATE') AS service_update,
    has_any_column_privilege('service_role',c.oid,'UPDATE') AS service_column_update,
    has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read
    FROM pg_class c WHERE c.oid IN ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass)
    ORDER BY c.relname`)).rows;
  assert.deepEqual(tablePrivileges,['amora_actions','wedding_journeys'].map(name=>({name,owner:'postgres',rls:true,
    forced:false,service_update:phase==='before'||name==='wedding_journeys',
    service_column_update:phase==='before'||name==='wedding_journeys',authenticated_read:true})),
  'Scoped relation privilege boundary differs');
}

/** Metadata/READ ONLY privilege fixture only. No production connection, caller SQL, factory or identity override. */
export async function createPrivilegeDatabase(options={}) {
  assert.ok(options&&typeof options==='object'&&!Array.isArray(options)
    &&Object.keys(options).every(key=>key==='phase'),'Privilege fixture accepts phase only');
  const phase=options.phase??'before';
  assert.ok(phase==='before'||phase==='after','Privilege fixture phase must be before or after');
  pinnedSql('../amora-action-view-v2/patch_own_amora_action_view_v2.sql',
    'e31372d192a0215d4ddf280a99abb628e7a8f732ebc02cb0b7e55fed1373730d');
  const frozenCompanions=companions.map(([path,hash])=>pinnedSql(path,hash));
  const f=await createDraftDatabase({native:true,candidate:true});
  try {
    await f.exec(`CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role',true),'')::text $$;
      ALTER TABLE public.wedding_journeys ALTER COLUMN progress DROP NOT NULL,
        ALTER COLUMN couple_id SET NOT NULL,ADD COLUMN wedding_date date,
        ADD COLUMN category_statuses jsonb,ADD COLUMN checklist_progress jsonb,
        ADD COLUMN priority_category text,ADD COLUMN total_budget integer,ADD COLUMN sdme_budget integer,
        ADD COLUMN is_onboarding_complete boolean,ADD COLUMN created_at timestamptz,ADD COLUMN venue text;
      ALTER TRIGGER journey_revision ON public.wedding_journeys RENAME TO trg_advance_wedding_journey_state_revision;`);
    await f.exec(witnessedProgressPatchSql());
    await f.exec(witnessedStatusSql());
    await f.exec(migration('20260716100000_journey_progress_atomic_item_patch.sql'));
    const planFile='20260731123000_couple_plan_change_write_boundary.sql';
    await f.exec(originalFunction(planFile,'couple_plan_change_has_unsafe_display_text'));
    const requestTable=migration(planFile).match(/CREATE TABLE public\.couple_plan_change_requests\s*\([\s\S]*?\n\);/)?.[0];
    assert.ok(requestTable,'Real minimal ROWTYPE table source missing');
    await f.exec(requestTable);
    for(const name of ['normalize_couple_plan_changes','apply_couple_plan_change_locked']) {
      await f.exec(originalFunction(planFile,name));
      const identity=originalFunctions.find(row=>row[0].startsWith(`public.${name}(`))[0];
      await f.exec(`ALTER FUNCTION ${identity} OWNER TO postgres;
        REVOKE ALL ON FUNCTION ${identity} FROM PUBLIC,anon,authenticated,service_role;`);
    }
    assert.equal(sha(genericSeed),'7b39b72b4fe4d1981fca770b1ad1ad6e062d560822731577e5ae3f1449ffef02');
    await f.exec(genericSeed);
    await f.exec(`ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;
      ALTER FUNCTION public.update_updated_at_column() RESET ALL;
      GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC,anon,authenticated,service_role;`);
    for(const [file,name,hash] of journeyFunctions) {
      await f.exec(originalFunction(file,name));
      await f.exec(`ALTER FUNCTION public.${name}() OWNER TO postgres;
        REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC,anon,authenticated,service_role;`);
      assert.equal((await f.db.query('SELECT md5(prosrc) AS hash FROM pg_proc WHERE oid=to_regprocedure($1)',
        [`public.${name}()`])).rows[0]?.hash,hash,`Actual journey source body differs: ${name}`);
    }
    for(const [name,event,fn] of journeyTriggers) if(name!=='trg_advance_wedding_journey_state_revision')
      await f.exec(`CREATE TRIGGER ${name} ${event} ON public.wedding_journeys
        FOR EACH ROW EXECUTE FUNCTION public.${fn}();`);
    await f.exec(`REVOKE ALL ON TABLE public.amora_actions,public.wedding_journeys FROM PUBLIC,anon,authenticated,service_role;
      GRANT ALL ON TABLE public.amora_actions,public.wedding_journeys TO service_role;
      GRANT SELECT ON TABLE public.amora_actions,public.wedding_journeys TO authenticated;`);
    await assertScopedMetadata(f,'before');
    if(phase==='after') {
      for(const sql of frozenCompanions) await f.exec(sql);
      await assertScopedMetadata(f,'after');
    }
    return {...f,phase,fixtureScope:'metadata-and-readonly-privileges-only',fullSchemaVerified:false,
      baselineDifferences:differences};
  } catch(error) {await f.db.query('ROLLBACK').catch(()=>{});await f.close();throw error;}
}
