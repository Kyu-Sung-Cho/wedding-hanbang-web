import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {AMORA_WRITER_RETIREMENT_COMPANIONS} from './amora-action-writer-retirement-bundle.mjs';

const FORMAT='amora-writer-retirement-transport-privileges-v1';
const SYSTEM='7581440907192989109';
const ACTORS=['anon','authenticated','service_role'];
const TABLE_PRIVILEGES=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
const digest=(text,algorithm='sha256')=>createHash(algorithm).update(text).digest('hex');
const fail=code=>{throw new Error(code);};
const requireValue=(condition,code)=>{if(!condition)fail(code);};
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const same=(a,b,code)=>requireValue(stable(a)===stable(b),code);
const keys=(value,expected,code='AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID')=>{
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),code);
  same(Object.keys(value).sort(),expected.slice().sort(),code);
};
const sorted=values=>values.slice().sort((a,b)=>stable(a).localeCompare(stable(b)));
const rawAclValid=value=>value===null||(Array.isArray(value)&&value.every(item=>typeof item==='string'));
const acl=roles=>sorted(roles.map(role=>[role,'postgres','EXECUTE',false]));
const TABLES=['amora_actions','wedding_journeys'];
const FROZEN=AMORA_WRITER_RETIREMENT_COMPANIONS;
// 기존 actual body와 대조한 원문 경로다. runtime은 B1의 strict source241 pin도 검사한다.
const MANUAL='20260906074227_amora_manual_actions_actor_boundary.sql';
const PLAN='20260731123000_couple_plan_change_write_boundary.sql';
const BOOKING='20260802140000_amora_manual_schedule_fairness.sql';
const FUNCTIONS=[
  ['lock_own_amora_action_couple','uuid',MANUAL,['postgres']],
  ['validate_manual_amora_action_values','jsonb,boolean',MANUAL,['postgres']],
  ['mutate_own_amora_action','uuid,text,text,jsonb',MANUAL,['postgres','authenticated'],0],
  ['update_own_legacy_amora_action','uuid,uuid,text,bigint,jsonb',MANUAL,['postgres','authenticated'],0],
  ['apply_journey_progress_patch','uuid,jsonb,text[]','20260611160000_journey_progress_atomic_merge.sql',
    ['postgres','service_role'],1],
  ['apply_journey_progress_item_patch','uuid,text,jsonb','20260716100000_journey_progress_atomic_item_patch.sql',
    ['postgres','service_role'],1],
  ['normalize_couple_plan_changes','jsonb',PLAN,['postgres'],2],
  ['apply_couple_plan_change_locked','uuid,uuid',PLAN,['postgres'],4],
  ['advance_amora_action_view_token_v2','','20261012002000_amora_action_view_v2.sql',['postgres']],
  ['patch_own_amora_action_view_v2','uuid,text,text,jsonb','20261012002000_amora_action_view_v2.sql',
    ['postgres','authenticated'],4],
  // status trigger ACL는 기존 default ACL의 관찰 대상이다. 새 private guard 승인으로 쓰지 않는다.
  ['set_amora_action_status_timestamps','','20260615101000_fix_amora_action_status_timestamps.sql',null],
  ['authorize_booking_projection_journey_write','',BOOKING,['postgres']],
  ['clear_booking_projection_boundary_alias','',BOOKING,['postgres']],
  ['enforce_couple_plan_change_write_boundary','','20260823120000_couple_approval_becomes_notification.sql',['postgres']],
  ['advance_wedding_journey_state_revision','','20260802170000_amora_shared_action_roster_binding.sql',['postgres']],
  ['capture_amora_shared_budget_delta','','20260910160514_amora_shared_budget_decision_receipts.sql',['postgres']],
  ['capture_amora_shared_schedule_cancel_restore_delta','',BOOKING,['postgres']],
  ['capture_amora_shared_schedule_delta','','20260827090000_move_card_can_name_what_it_moves.sql',['postgres']],
];
const NEW_FUNCTIONS=[
  ['guard_amora_action_insert_identity_cutover_v1','',4,['postgres']],
  ['guard_amora_reserved_journey_direct_dml_retirement_v1','',3,['postgres']],
];
const GENERIC_NAME='update_updated_at_column';
const GENERIC_MD5='204b9b9355e61b7541bc0633bbc9294c';
const GENERIC_FULL_SHA='7b39b72b4fe4d1981fca770b1ad1ad6e062d560822731577e5ae3f1449ffef02';
const GENERIC_BODY='\r\nbegin\r\n  new.updated_at = now();\r\n  return new;\r\nend;\r\n';
const ALL_NAMES=[...FUNCTIONS.map(row=>row[0]),GENERIC_NAME,...NEW_FUNCTIONS.map(row=>row[0])];
const TRIGGERS={
  amora_actions:[
    ['set_amora_actions_status_timestamps',23,'set_amora_action_status_timestamps'],
    ['set_amora_actions_updated_at',19,'advance_amora_action_view_token_v2'],
  ],
  wedding_journeys:[
    ['trg_00_authorize_booking_projection',19,'authorize_booking_projection_journey_write'],
    ['trg_00_enforce_couple_plan_change_write_boundary',23,'enforce_couple_plan_change_write_boundary'],
    ['trg_01_clear_booking_projection_boundary_alias',19,'clear_booking_projection_boundary_alias'],
    ['trg_advance_wedding_journey_state_revision',23,'advance_wedding_journey_state_revision'],
    ['trg_capture_amora_shared_budget_delta',17,'capture_amora_shared_budget_delta'],
    ['trg_capture_amora_shared_schedule_cancel_restore_delta',19,'capture_amora_shared_schedule_cancel_restore_delta'],
    ['trg_capture_amora_shared_schedule_delta',19,'capture_amora_shared_schedule_delta'],
    ['update_wedding_journeys_updated_at',19,GENERIC_NAME],
  ],
};
const COLUMNS={
  amora_actions:[['id','text',true],['couple_id','uuid',true],['title','text',true],
    ['description','text',false],['due_date','text',false],['category_key','text',false],
    ['priority','text',true],['status','text',true],['source','text',true],['href','text',false],
    ['metadata','jsonb',true],['created_by','uuid',false],['created_at','timestamp with time zone',true],
    ['updated_at','timestamp with time zone',true],['completed_at','timestamp with time zone',false],
    ['dismissed_at','timestamp with time zone',false]],
  wedding_journeys:[['id','uuid',true],['couple_id','uuid',true],['wedding_date','date',false],
    ['category_statuses','jsonb',false],['checklist_progress','jsonb',false],['priority_category','text',false],
    ['total_budget','integer',false],['sdme_budget','integer',false],['is_onboarding_complete','boolean',false],
    ['created_at','timestamp with time zone',false],['updated_at','timestamp with time zone',false],
    ['progress','jsonb',false],['venue','text',false],['state_revision','bigint',true]],
};

function options(value,after=false) {
  keys(value,after?['repoRoot','phase','expectedNativeSystemIdentifier','beforeObservation']:
    ['repoRoot','phase'],'AMORA_WRITER_RETIREMENT_PRIVILEGES_OPTIONS_INVALID');
  requireValue(typeof value.repoRoot==='string'&&['before','after'].includes(value.phase),
    'AMORA_WRITER_RETIREMENT_PRIVILEGES_OPTIONS_INVALID');
}

function functionSource(sql,name) {
  const pattern=new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`,'ig');
  const starts=[...sql.matchAll(pattern)];
  requireValue(starts.length>0,'AMORA_WRITER_RETIREMENT_PRIVILEGES_FUNCTION_SOURCE_INVALID');
  const tail=sql.slice(starts.at(-1).index);
  const body=/\bAS\s+(\$[a-z_]*\$)([\s\S]*?)\1\s*;/i.exec(tail);
  requireValue(body,'AMORA_WRITER_RETIREMENT_PRIVILEGES_FUNCTION_SOURCE_INVALID');
  return {header:tail.slice(0,body.index),body:body[2]};
}

function declaration(source) {
  const header=source.header;
  const parameters=(/\(([\s\S]*?)\)\s*RETURNS/i.exec(header)?.[1]??'').split(',')
    .map(value=>value.trim().replace(/\s+/g,' ').replace(/\bdefault\b/i,'DEFAULT')).filter(Boolean);
  const defaults=parameters.filter(value=>/\bDEFAULT\b/.test(value)).map(value=>value.split(/\bDEFAULT\s+/)[1]);
  const config=[...header.matchAll(/\bSET\s+([a-z_]+)\s*(?:=|TO)\s*([^\n\r]+?)(?=\s+SET\b|\r?\n|$)/ig)].map(match=>{
    const values=match[2].trim().split(',').map(value=>value.trim().replace(/^'(.*)'$/,'$1'));
    return `${match[1].toLowerCase()}=${values.map(value=>value===''?'""':value).join(', ')}`;
  });
  return {owner:'postgres',result:/\bRETURNS\s+(\w+)/i.exec(header)?.[1].toLowerCase(),language:'plpgsql',
    securityDefiner:/\bSECURITY\s+DEFINER/i.test(header),config:config.length?config:null,
    strict:/\bSTRICT\b/i.test(header),volatility:/\bIMMUTABLE\b/i.test(header)?'i':/\bSTABLE\b/i.test(header)?'s':'v',
    parallel:'u',bodyMd5:digest(source.body,'md5'),bodySha256:digest(source.body),
    cost:100,rows:0,support:'-',kind:'f',leakProof:false,returnsSet:false,
    defaultCount:defaults.length,arguments:parameters.join(', '),defaults:defaults.length?defaults.join(', '):null};
}

function loadSources(repoRoot,phase) {
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  const sources=new Map();
  for(const [, ,file] of FUNCTIONS) {
    if(sources.has(file))continue;
    const pin=plan.reviewedMigrations.find(row=>row.file===file);
    const bytes=readFileSync(join(repoRoot,'supabase/migrations',file));
    requireValue(pin&&digest(bytes)===pin.sha256,'AMORA_WRITER_RETIREMENT_PRIVILEGES_PREDECESSOR_SOURCE_CHANGED');
    sources.set(file,bytes.toString('utf8'));
  }
  const frozen=FROZEN.map(([file,sha])=>{
    const bytes=readFileSync(join(repoRoot,file));
    requireValue(digest(bytes)===sha,'AMORA_WRITER_RETIREMENT_PRIVILEGES_COMPANION_CHANGED');
    return bytes.toString('utf8');
  });
  const expected=FUNCTIONS.map(([name,args,file,roles,replacement])=>{
    const source=functionSource(phase==='after'&&replacement!==undefined?frozen[replacement]:sources.get(file),name);
    // 부모 승인: 한 기존 함수의 actual CRLF body만 고정한다. LF는 운영 대안이 아니다.
    if(phase==='before'&&name==='apply_journey_progress_patch')source.body=source.body.replace(/\r?\n/g,'\r\n');
    // 별도 부모 승인: 실제 status trigger도 CRLF 한 strong pair만 받는다. 관찰값은 바꾸지 않는다.
    if(name==='set_amora_action_status_timestamps') {
      requireValue(digest(source.body)==='b0459301f48a8f9d9313b6c319e1f5c704c88ecf7d60a33a6b86d35c849349f6',
        'AMORA_WRITER_RETIREMENT_PRIVILEGES_STATUS_SOURCE_INVALID');
      source.body=source.body.replace(/\n/g,'\r\n');
      requireValue(digest(source.body)==='1ca50d98486ba9a8c90b6fcbdaa14bd01a2fa26737fc48a2b664f21e1b30dae4'
        &&digest(source.body,'md5')==='aee9c4ab5fecc898ff52e1160decad22','AMORA_WRITER_RETIREMENT_PRIVILEGES_STATUS_SOURCE_INVALID');
    }
    return {identity:`public.${name}(${args})`,...declaration(source),expectedAcl:roles?acl(roles):null};
  });
  expected.push({identity:`public.${GENERIC_NAME}()`,...declaration({header:'RETURNS trigger LANGUAGE plpgsql',body:GENERIC_BODY}),
    expectedAcl:acl(['PUBLIC','anon','authenticated','postgres','service_role']),definitionSha256:GENERIC_FULL_SHA});
  requireValue(expected.at(-1).bodyMd5===GENERIC_MD5,'AMORA_WRITER_RETIREMENT_PRIVILEGES_DEPENDENCY_SOURCE_INVALID');
  if(phase==='after')for(const [name,args,index,roles] of NEW_FUNCTIONS)
    expected.push({identity:`public.${name}(${args})`,...declaration(functionSource(frozen[index],name)),expectedAcl:acl(roles)});
  return {expected,sourceSha256:digest(stable({predecessor:plan.staticPredecessorSha256,bundle:plan.migration.sha256,
    sources:[...sources].map(([file,sql])=>[file,digest(sql)]),companions:FROZEN,phase}))};
}

const aggregate=query=>`(SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) FROM (${query}) q(v))`;
const expanded=expression=>aggregate(`SELECT jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
 pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable) FROM aclexplode(${expression}) x`);
const names=values=>values.map(value=>`'${value}'`).join(',');
const identity=`n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')'`;
const functionSurface=`jsonb_build_object('identity',${identity},'owner',pg_get_userbyid(p.proowner),
 'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,'config',p.proconfig,
 'strict',p.proisstrict,'volatility',p.provolatile,'parallel',p.proparallel,'bodyMd5',md5(p.prosrc),
 'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
 'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
 'cost',p.procost,'rows',p.prorows,'support',p.prosupport::regproc::text,'kind',p.prokind,
 'leakProof',p.proleakproof,'returnsSet',p.proretset,'defaultCount',p.pronargdefaults,
 'arguments',pg_get_function_arguments(p.oid),'defaults',pg_get_expr(p.proargdefaults,0),
 'rawAcl',p.proacl,'acl',${expanded("COALESCE(p.proacl,acldefault('f',p.proowner))")},
 'execute',${aggregate(`SELECT jsonb_build_array(r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE')) FROM pg_roles r`)})`;
const rights=relation=>aggregate(`SELECT jsonb_build_object('role',r.rolname,
 'table',${aggregate(`SELECT jsonb_build_array(v.privilege,has_table_privilege(r.oid,${relation},v.privilege))
 FROM unnest(ARRAY[${names(TABLE_PRIVILEGES)}]::text[]) v(privilege)`)},
 'anyColumnUpdate',has_any_column_privilege(r.oid,${relation},'UPDATE'),
 'columns',${aggregate(`SELECT jsonb_build_array(a.attname,has_column_privilege(r.oid,${relation},a.attnum,'UPDATE'))
 FROM pg_attribute a WHERE a.attrelid=${relation} AND a.attnum>0 AND NOT a.attisdropped`)}) FROM pg_roles r`);

/** 카탈로그 전용 SQL이다. 고객 테이블의 row/count/value 또는 함수 원문은 반환하지 않는다. */
export function buildAmoraWriterRetirementPrivilegesObservationSql(value) {
  options(value);
  const {sourceSha256}=loadSources(value.repoRoot,value.phase);
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('format','${FORMAT}','phase','${value.phase}','sourceSha256','${sourceSha256}',
 'observedAt',clock_timestamp(),'readOnly',current_setting('transaction_read_only')='on',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'database',current_database(),'currentUser',current_user,'serverVersion',current_setting('server_version'),
 'roles',${aggregate(`SELECT jsonb_build_object('name',r.rolname,'super',r.rolsuper,'inherit',r.rolinherit,
 'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'login',r.rolcanlogin,'replication',r.rolreplication,
 'bypassRls',r.rolbypassrls) FROM pg_roles r`)},
 'memberships',${aggregate(`SELECT jsonb_build_array(pg_get_userbyid(m.roleid),pg_get_userbyid(m.member),
 pg_get_userbyid(m.grantor),m.admin_option,m.inherit_option,m.set_option) FROM pg_auth_members m`)},
 'reachability',${aggregate(`SELECT jsonb_build_array(a.rolname,r.rolname,pg_has_role(a.oid,r.oid,'MEMBER'),
 pg_has_role(a.oid,r.oid,'USAGE'),pg_has_role(a.oid,r.oid,'SET')) FROM pg_roles a CROSS JOIN pg_roles r
 WHERE a.rolname IN (${names(ACTORS)})`)},
 'schema',${aggregate(`SELECT jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),
 'rawAcl',n.nspacl,'acl',${expanded("COALESCE(n.nspacl,acldefault('n',n.nspowner))")},
 'effective',${aggregate(`SELECT jsonb_build_array(r.rolname,has_schema_privilege(r.oid,n.oid,'USAGE'),
 has_schema_privilege(r.oid,n.oid,'CREATE')) FROM pg_roles r`)}) FROM pg_namespace n WHERE n.nspname='public'`)},
 'functionDefaults',${aggregate(`SELECT jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),
 'schema',CASE WHEN d.defaclnamespace=0 THEN NULL ELSE n.nspname END,'rawAcl',d.defaclacl,
 'acl',${expanded('d.defaclacl')}) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 WHERE d.defaclrole='postgres'::regrole AND d.defaclobjtype='f' AND (d.defaclnamespace=0 OR n.nspname='public')`)},
 'functions',${aggregate(`SELECT ${functionSurface} FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname IN (${names(ALL_NAMES)}) AND p.prokind IN ('f','p')`)},
 'tables',${aggregate(`SELECT jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'rawAcl',c.relacl,
 'acl',${expanded("COALESCE(c.relacl,acldefault('r',c.relowner))")},
 'columns',${aggregate(`SELECT jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
 'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'rawAcl',a.attacl,
 'acl',${expanded('a.attacl')}) FROM pg_attribute a
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`)},
 'triggers',${aggregate(`SELECT jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'type',t.tgtype,
 'function',pn.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')',
 'args',encode(t.tgargs,'hex'),'qual',pg_get_expr(t.tgqual,t.tgrelid),'columns',t.tgattr::text,
 'constraint',t.tgconstraint<>0,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,
 'oldTable',t.tgoldtable,'newTable',t.tgnewtable) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE t.tgrelid=c.oid AND NOT t.tgisinternal`)},
 'effective',${rights('c.oid')}) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${names(TABLES)}) AND c.relkind IN ('r','p')`)}) AS observation;
COMMIT;
`;
}

function validateAcl(values) {
  requireValue(Array.isArray(values),'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
  for(const row of values)requireValue(Array.isArray(row)&&row.length===4&&typeof row[0]==='string'
    &&typeof row[1]==='string'&&typeof row[2]==='string'&&typeof row[3]==='boolean','AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
  requireValue(new Set(values.map(stable)).size===values.length,'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
}
function fresh(observed) {
  requireValue(typeof observed.observedAt==='string','AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
  const at=Date.parse(observed.observedAt),now=Date.now();
  requireValue(Number.isFinite(at)&&at<=now+10_000&&at>now-120_000,'AMORA_WRITER_RETIREMENT_PRIVILEGES_OBSERVATION_EXPIRED');
}
function relationAcl(phase,table) {
  return sorted([ ...TABLE_PRIVILEGES.map(p=>['postgres','postgres',p,false]),
    ...TABLE_PRIVILEGES.filter(p=>!(phase==='after'&&table==='amora_actions'&&p==='UPDATE'))
      .map(p=>['service_role','postgres',p,false]),['authenticated','postgres','SELECT',false]]);
}
function actorRights(table,actor) {
  const row=table.effective.find(row=>row.role===actor);
  requireValue(row,'AMORA_WRITER_RETIREMENT_PRIVILEGES_EFFECTIVE_MISSING');
  return row;
}
const granted=(row,privilege)=>row.table.find(([name])=>name===privilege)?.[1];

function validateCatalog(observed,{repoRoot,phase,expectedNativeSystemIdentifier}) {
  keys(observed,['format','phase','sourceSha256','observedAt','readOnly','systemIdentifier','database',
    'currentUser','serverVersion','roles','memberships','reachability','schema','functionDefaults','functions','tables']);
  const {expected,sourceSha256}=loadSources(repoRoot,phase);
  same([observed.format,observed.phase,observed.sourceSha256],[FORMAT,phase,sourceSha256],'AMORA_WRITER_RETIREMENT_PRIVILEGES_SOURCE_INVALID');
  requireValue(observed.readOnly===true&&observed.database==='postgres'&&typeof observed.serverVersion==='string'
    &&/^17\./.test(observed.serverVersion),
    'AMORA_WRITER_RETIREMENT_PRIVILEGES_DESTINATION_INVALID');
  if(expectedNativeSystemIdentifier===null)requireValue(observed.systemIdentifier===SYSTEM
    &&['postgres','supabase_read_only_user'].includes(observed.currentUser),'AMORA_WRITER_RETIREMENT_PRIVILEGES_DESTINATION_INVALID');
  else requireValue(typeof expectedNativeSystemIdentifier==='string'&&/^\d+$/.test(expectedNativeSystemIdentifier)
    &&expectedNativeSystemIdentifier!==SYSTEM&&observed.systemIdentifier===expectedNativeSystemIdentifier
    &&observed.currentUser==='postgres','AMORA_WRITER_RETIREMENT_PRIVILEGES_DESTINATION_INVALID');
  fresh(observed);
  requireValue(Array.isArray(observed.roles)&&observed.roles.length>=4,'AMORA_WRITER_RETIREMENT_PRIVILEGES_ROLES_MISSING');
  const roleNames=observed.roles.map(role=>role.name);
  requireValue(new Set(roleNames).size===roleNames.length&&['postgres',...ACTORS].every(role=>roleNames.includes(role)),
    'AMORA_WRITER_RETIREMENT_PRIVILEGES_ROLES_MISSING');
  for(const role of observed.roles) {
    keys(role,['name','super','inherit','createRole','createDb','login','replication','bypassRls']);
    requireValue(typeof role.name==='string'&&Object.entries(role).filter(([k])=>k!=='name').every(([,v])=>typeof v==='boolean'),
      'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
  }
  requireValue(ACTORS.every(name=>!observed.roles.find(role=>role.name===name).super),'AMORA_WRITER_RETIREMENT_PRIVILEGES_SUPERUSER_BYPASS');
  requireValue(Array.isArray(observed.memberships)&&Array.isArray(observed.reachability),'AMORA_WRITER_RETIREMENT_PRIVILEGES_GRAPH_MISSING');
  for(const row of observed.memberships)requireValue(Array.isArray(row)&&row.length===6
    &&row.slice(0,3).every(role=>roleNames.includes(role))&&row.slice(3).every(v=>typeof v==='boolean'),
    'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
  const reachKeys=[];
  for(const row of observed.reachability) {
    requireValue(Array.isArray(row)&&row.length===5&&ACTORS.includes(row[0])&&roleNames.includes(row[1])
      &&row.slice(2).every(v=>typeof v==='boolean'),'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
    reachKeys.push(`${row[0]}:${row[1]}`);
  }
  same(reachKeys.sort(),ACTORS.flatMap(actor=>roleNames.map(role=>`${actor}:${role}`)).sort(),'AMORA_WRITER_RETIREMENT_PRIVILEGES_GRAPH_MISSING');
  requireValue(Array.isArray(observed.functions)&&observed.functions.length===expected.length,'AMORA_WRITER_RETIREMENT_PRIVILEGES_FUNCTION_DRIFT');
  same(observed.functions.map(fn=>fn.identity).sort(),expected.map(fn=>fn.identity).sort(),'AMORA_WRITER_RETIREMENT_PRIVILEGES_FUNCTION_DRIFT');
  for(const fn of observed.functions) {
    keys(fn,['identity','owner','result','language','securityDefiner','config','strict','volatility','parallel','bodyMd5',
      'bodySha256','definitionSha256','cost','rows','support','kind','leakProof','returnsSet','defaultCount','arguments',
      'defaults','rawAcl','acl','execute']);
    const wanted=expected.find(row=>row.identity===fn.identity);
    const {identity:ignored,expectedAcl,definitionSha256,...metadata}=wanted;
    for(const key of Object.keys(metadata))same(fn[key],metadata[key],`AMORA_WRITER_RETIREMENT_PRIVILEGES_FUNCTION_DRIFT:${fn.identity}:${key}`);
    requireValue(typeof fn.definitionSha256==='string'&&/^[a-f0-9]{64}$/.test(fn.definitionSha256)&&typeof fn.arguments==='string'
      &&(fn.defaults===null||typeof fn.defaults==='string')&&rawAclValid(fn.rawAcl),
      'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
    if(definitionSha256)same(fn.definitionSha256,definitionSha256,'AMORA_WRITER_RETIREMENT_PRIVILEGES_DEPENDENCY_DRIFT');
    validateAcl(fn.acl);
    if(expectedAcl)same(sorted(fn.acl),expectedAcl,'AMORA_WRITER_RETIREMENT_PRIVILEGES_FUNCTION_ACL_DRIFT');
    same(fn.execute.map(row=>row[0]).sort(),roleNames.slice().sort(),'AMORA_WRITER_RETIREMENT_PRIVILEGES_EFFECTIVE_MISSING');
    for(const row of fn.execute)requireValue(Array.isArray(row)&&row.length===2&&typeof row[1]==='boolean',
      'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
  }
  requireValue(Array.isArray(observed.tables)&&observed.tables.length===2,'AMORA_WRITER_RETIREMENT_PRIVILEGES_TABLE_DRIFT');
  same(observed.tables.map(t=>t.name).sort(),TABLES.slice().sort(),'AMORA_WRITER_RETIREMENT_PRIVILEGES_TABLE_DRIFT');
  for(const table of observed.tables) {
    keys(table,['name','kind','owner','rls','forceRls','rawAcl','acl','columns','triggers','effective']);
    same([table.kind,table.owner,table.rls,table.forceRls],['r','postgres',true,false],'AMORA_WRITER_RETIREMENT_PRIVILEGES_TABLE_DRIFT');
    validateAcl(table.acl);
    same(sorted(table.acl),relationAcl(phase,table.name),'AMORA_WRITER_RETIREMENT_PRIVILEGES_TABLE_ACL_DRIFT');
    requireValue(Array.isArray(table.rawAcl)&&rawAclValid(table.rawAcl)&&Array.isArray(table.columns),'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
    same(sorted(table.columns.map(c=>[c.name,c.type,c.notNull,c.identity,c.generated])),
      sorted(COLUMNS[table.name].map(row=>[...row,'',''])),'AMORA_WRITER_RETIREMENT_PRIVILEGES_COLUMN_DRIFT');
    for(const column of table.columns) {
      keys(column,['name','type','notNull','identity','generated','rawAcl','acl']);
      requireValue(rawAclValid(column.rawAcl),'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
      validateAcl(column.acl);
    }
    const wanted=TRIGGERS[table.name].slice();
    if(phase==='after')wanted.push(table.name==='amora_actions'
      ?['guard_amora_action_insert_identity_cutover_v1',7,'guard_amora_action_insert_identity_cutover_v1']
      :['guard_amora_reserved_journey_direct_dml_retirement_v1',23,'guard_amora_reserved_journey_direct_dml_retirement_v1']);
    same(sorted(table.triggers),sorted(wanted.map(([name,type,fn])=>({name,enabled:'O',type,
      function:`public.${fn}()`,args:'',qual:null,columns:'',constraint:false,deferrable:false,
      initiallyDeferred:false,oldTable:null,newTable:null}))),'AMORA_WRITER_RETIREMENT_PRIVILEGES_TRIGGER_DRIFT');
    same(table.effective.map(row=>row.role).sort(),roleNames.slice().sort(),'AMORA_WRITER_RETIREMENT_PRIVILEGES_EFFECTIVE_MISSING');
    for(const row of table.effective) {
      keys(row,['role','table','anyColumnUpdate','columns']);
      requireValue(typeof row.anyColumnUpdate==='boolean','AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
      same(row.table.map(p=>p[0]).sort(),TABLE_PRIVILEGES.slice().sort(),'AMORA_WRITER_RETIREMENT_PRIVILEGES_EFFECTIVE_MISSING');
      same(row.columns.map(c=>c[0]).sort(),table.columns.map(c=>c.name).sort(),'AMORA_WRITER_RETIREMENT_PRIVILEGES_EFFECTIVE_MISSING');
      requireValue([...row.table,...row.columns].every(row=>Array.isArray(row)&&row.length===2&&typeof row[1]==='boolean'),
        'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
    }
  }
  requireValue(Array.isArray(observed.schema)&&observed.schema.length===1&&observed.schema[0].name==='public',
    'AMORA_WRITER_RETIREMENT_PRIVILEGES_SCHEMA_MISSING');
  for(const schema of observed.schema) {
    keys(schema,['name','owner','rawAcl','acl','effective']);validateAcl(schema.acl);
    requireValue(typeof schema.owner==='string'&&rawAclValid(schema.rawAcl),
      'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
    same(schema.effective.map(row=>row[0]).sort(),roleNames.slice().sort(),'AMORA_WRITER_RETIREMENT_PRIVILEGES_EFFECTIVE_MISSING');
    requireValue(schema.effective.every(row=>Array.isArray(row)&&row.length===3&&row.slice(1).every(v=>typeof v==='boolean')),
      'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
  }
  requireValue(Array.isArray(observed.functionDefaults),'AMORA_WRITER_RETIREMENT_PRIVILEGES_DEFAULT_ACL_MISSING');
  for(const d of observed.functionDefaults) {
    keys(d,['owner','schema','rawAcl','acl']);validateAcl(d.acl);
    requireValue(d.owner==='postgres'&&(d.schema===null||d.schema==='public')&&Array.isArray(d.rawAcl)&&rawAclValid(d.rawAcl),
      'AMORA_WRITER_RETIREMENT_PRIVILEGES_SHAPE_INVALID');
    // 신규 private guard의 명시 REVOKE 대상 외 default grant는 frozen bundle이 제거하지 않는다.
    requireValue(d.acl.every(([grantee,grantor,privilege,grantable])=>['postgres','PUBLIC',...ACTORS].includes(grantee)
      &&grantor==='postgres'&&privilege==='EXECUTE'&&!grantable),'AMORA_WRITER_RETIREMENT_PRIVILEGES_DEFAULT_EXECUTE_BYPASS');
  }
  fresh(observed);
}

function validateBypasses(observed,phase) {
  const canonical=observed.tables.find(t=>t.name==='amora_actions');
  const journey=observed.tables.find(t=>t.name==='wedding_journeys');
  const service=actorRights(canonical,'service_role');
  same(granted(service,'UPDATE'),phase==='before','AMORA_WRITER_RETIREMENT_PRIVILEGES_CANONICAL_UPDATE_REMAINS');
  same(service.anyColumnUpdate,phase==='before','AMORA_WRITER_RETIREMENT_PRIVILEGES_COLUMN_UPDATE_REMAINS');
  requireValue(service.columns.every(([,allowed])=>allowed===(phase==='before')),'AMORA_WRITER_RETIREMENT_PRIVILEGES_COLUMN_UPDATE_REMAINS');
  for(const table of observed.tables)for(const actor of ACTORS) {
    const row=actorRights(table,actor);
    const expected=actor==='service_role'?TABLE_PRIVILEGES.filter(p=>!(phase==='after'&&table===canonical&&p==='UPDATE')):
      actor==='authenticated'?['SELECT']:[];
    same(sorted(row.table.filter(([,allowed])=>allowed).map(([p])=>p)),sorted(expected),'AMORA_WRITER_RETIREMENT_PRIVILEGES_CLIENT_DML_BYPASS');
    if(actor!=='service_role')requireValue(!row.anyColumnUpdate&&row.columns.every(([,value])=>!value),
      'AMORA_WRITER_RETIREMENT_PRIVILEGES_CLIENT_DML_BYPASS');
  }
  // before의 table UPDATE는 의도된 회수 대상이다. 다른 column UPDATE grant는 조용히 남기지 않는다.
  for(const c of canonical.columns)requireValue(c.acl.every(([role,,p])=>p!=='UPDATE'||role==='postgres'),
    'AMORA_WRITER_RETIREMENT_PRIVILEGES_COLUMN_GRANT_BYPASS');
  for(const [actor,other,,usage,set] of observed.reachability) {
    if(actor===other||(!usage&&!set))continue;
    const actionRights=actorRights(canonical,other),journeyRights=actorRights(journey,other);
    requireValue(!actionRights.anyColumnUpdate&&!granted(actionRights,'INSERT')&&!granted(actionRights,'UPDATE')
      &&!(set&&(journeyRights.anyColumnUpdate||granted(journeyRights,'INSERT')||granted(journeyRights,'UPDATE'))),
      'AMORA_WRITER_RETIREMENT_PRIVILEGES_REACHABLE_WRITER_BYPASS');
    const role=observed.roles.find(r=>r.name===other);
    requireValue(!role.super,'AMORA_WRITER_RETIREMENT_PRIVILEGES_REACHABLE_WRITER_BYPASS');
  }
  // 현재 SET=false라도 기존 writer role ADMIN은 자기 재grant로 SET을 활성화할 수 있다.
  // 대상 DML을 가지지 않은 일반 role의 관리 전체를 금지하는 규칙은 아니다.
  for(const [writer,member,,admin] of observed.memberships)if(admin) {
    const actionRights=actorRights(canonical,writer),journeyRights=actorRights(journey,writer);
    const writes=actionRights.anyColumnUpdate||granted(actionRights,'INSERT')||granted(actionRights,'UPDATE')
      ||journeyRights.anyColumnUpdate||granted(journeyRights,'INSERT')||granted(journeyRights,'UPDATE')
      ||observed.roles.find(r=>r.name===writer).super;
    if(!writes)continue;
    const clientCanAdmin=ACTORS.some(actor=>actor===member||observed.reachability.some(row=>row[0]===actor
      &&row[1]===member&&(row[3]||row[4])));
    requireValue(!clientCanAdmin,'AMORA_WRITER_RETIREMENT_PRIVILEGES_ADMIN_WRITER_BYPASS');
  }
  // effective EXECUTE는 직접 ACL만으로는 찾을 수 없는 inherited PUBLIC 경로도 관찰한다.
  for(const fn of observed.functions) {
    const privateFn=fn.acl.every(([role])=>role==='postgres');
    if(privateFn)for(const actor of ACTORS) {
      const reachable=observed.reachability.filter(r=>r[0]===actor&&(r[3]||r[4]||r[1]===actor));
      requireValue(reachable.every(r=>fn.execute.find(([name])=>name===r[1])?.[1]===false),
        'AMORA_WRITER_RETIREMENT_PRIVILEGES_PRIVATE_EXECUTE_BYPASS');
    }
  }
}

function preserved(observed) {
  const changed=FUNCTIONS.filter(row=>row[4]!==undefined).map(row=>`public.${row[0]}(${row[1]})`);
  const extra=NEW_FUNCTIONS.map(row=>`public.${row[0]}(${row[1]})`);
  return {roles:sorted(observed.roles),memberships:sorted(observed.memberships),reachability:sorted(observed.reachability),
    schema:sorted(observed.schema),functionDefaults:sorted(observed.functionDefaults),
    functions:sorted(observed.functions.filter(fn=>!extra.includes(fn.identity)).map(fn=>{
      const {bodyMd5,bodySha256,definitionSha256,...rest}=fn;
      return changed.includes(fn.identity)?rest:fn;
    })),tables:sorted(observed.tables.map(table=>{
      const normalizedAcl=table.acl.filter(row=>!(table.name==='amora_actions'&&row[0]==='service_role'&&row[2]==='UPDATE'));
      const {effective,rawAcl,...rest}=table;
      return {...rest,acl:sorted(normalizedAcl),columns:sorted(table.columns),
        triggers:sorted(table.triggers.filter(t=>!NEW_FUNCTIONS.some(row=>row[0]===t.name)))};
    }))};
}

/** admission capability가 아니다. 외부 JSON의 수집 출처/private recovery/source CI는 여전히 미증명이다. */
export function validateAmoraWriterRetirementPrivilegesObservation(observed,value) {
  options(value,true);
  requireValue(value.phase==='after'?value.beforeObservation!==null:value.beforeObservation===null,
    'AMORA_WRITER_RETIREMENT_PRIVILEGES_BEFORE_REQUIRED');
  validateCatalog(observed,value);
  validateBypasses(observed,value.phase);
  if(value.phase==='after') {
    const before=value.beforeObservation;
    validateCatalog(before,{...value,phase:'before'});
    validateBypasses(before,'before');
    same([observed.systemIdentifier,observed.database],[before.systemIdentifier,before.database],'AMORA_WRITER_RETIREMENT_PRIVILEGES_BASELINE_CHANGED');
    same(preserved(observed),preserved(before),'AMORA_WRITER_RETIREMENT_PRIVILEGES_PRESERVED_SURFACE_CHANGED');
  }
  return Object.freeze({format:FORMAT,phase:value.phase,status:`catalog-compatible-${value.phase}`,
    observedAt:observed.observedAt,systemIdentifier:observed.systemIdentifier,
    sourceSha256:observed.sourceSha256,observationSha256:digest(stable(observed)),
    preservedPrivilegeSurfaceSha256:digest(stable(preserved(observed))),
    executionProvenanceVerified:false,privateRecoveryVerified:false,fullSchemaVerified:false,
    ledgerVerified:false,releaseAuthorized:false,remoteWritesPerformed:false,
    scope:'target-functions-triggers-table-column-role-default-privileges-only',
    lane:value.expectedNativeSystemIdentifier===null?'production-catalog-content-only':'owned-native-catalog-content-only'});
}

/** 현재 after 카탈로그만 검사한다. 과거 before의 시각을 바꾸거나 보존/수집 증거를 발급하지 않는다. */
export function validateAmoraWriterRetirementCurrentAfterPrivileges(observed,value) {
  keys(value,['repoRoot','expectedNativeSystemIdentifier'],'AMORA_WRITER_RETIREMENT_PRIVILEGES_OPTIONS_INVALID');
  requireValue(typeof value.repoRoot==='string','AMORA_WRITER_RETIREMENT_PRIVILEGES_OPTIONS_INVALID');
  validateCatalog(observed,{...value,phase:'after'});
  validateBypasses(observed,'after');
  return Object.freeze({format:FORMAT,phase:'after',status:'current-after-catalog-content-only',
    observedAt:observed.observedAt,systemIdentifier:observed.systemIdentifier,
    sourceSha256:observed.sourceSha256,observationSha256:digest(stable(observed)),
    preservedPrivilegeSurfaceSha256:digest(stable(preserved(observed))),
    executionProvenanceVerified:false,privateRecoveryVerified:false,fullSchemaVerified:false,
    ledgerVerified:false,releaseAuthorized:false,remoteWritesPerformed:false,
    scope:'target-functions-triggers-table-column-role-default-privileges-only',
    lane:value.expectedNativeSystemIdentifier===null?'production-catalog-content-only':'owned-native-catalog-content-only'});
}


const TARGET7=Object.freeze(['public.mutate_own_amora_action(uuid,text,text,jsonb)','public.update_own_legacy_amora_action(uuid,uuid,text,bigint,jsonb)','public.apply_journey_progress_patch(uuid,jsonb,text[])','public.apply_journey_progress_item_patch(uuid,text,jsonb)','public.normalize_couple_plan_changes(jsonb)','public.apply_couple_plan_change_locked(uuid,uuid)','public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)']);

/** 고정 source에서 유도한 목표7+새guard2 metadata다. DB 관찰/인가 proof가 아니다. */
export function getAmoraWriterRetirementTargetMetadata(value) {
  options(value);
  const {expected,sourceSha256}=loadSources(value.repoRoot,value.phase);
  const functions=expected.filter(fn=>TARGET7.includes(fn.identity)||NEW_FUNCTIONS.some(row=>fn.identity===`public.${row[0]}(${row[1]})`));
  requireValue(functions.length===(value.phase==='before'?7:9),'AMORA_WRITER_RETIREMENT_TARGET_COUNT_INVALID');
  return Object.freeze({phase:value.phase,sourceSha256,functions,releaseAuthorized:false,executionProvenanceVerified:false});
}
