import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {requireRelease,same} from './current-baseline-release-contract.mjs';
import {validateAmoraActionViewV2OperatingLedger} from './amora-action-view-v2-ledger.mjs';

const md5 = text => createHash('md5').update(text).digest('hex');
const MD5=/^[a-f0-9]{32}$/;
// Management API의 read_only:true 실제 역할이다. SQL Editor/로컬 postgres 관찰과 구분한다.
export const AMORA_VIEW_V2_READ_ONLY_OBSERVERS=Object.freeze(['postgres','supabase_read_only_user']);
const OLD_NAMES=['lock_own_amora_action_couple','validate_manual_amora_action_values',
  'mutate_own_amora_action','update_own_legacy_amora_action'];
const NEW_NAMES=['advance_amora_action_view_token_v2','patch_own_amora_action_view_v2'];
const names=values=>values.map(value=>`'${value}'`).join(',');
const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) FROM (${query}) q(v))`;
const functionSurface = `jsonb_build_object('identity',n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')',
 'owner',pg_get_userbyid(p.proowner),'result',pg_get_function_result(p.oid),'language',l.lanname,
 'securityDefiner',p.prosecdef,'config',p.proconfig,'bodyMd5',md5(p.prosrc),
 'strict',p.proisstrict,'volatility',p.provolatile,'parallel',p.proparallel,
 'acl',${aggregate(`SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a`)})`;
const target = `jsonb_build_object('functions',${aggregate(`SELECT ${functionSurface} FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.proname IN (${names([...OLD_NAMES,...NEW_NAMES])})`)},
 'timestampTriggers',${aggregate(`SELECT jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true))
 FROM pg_trigger t WHERE t.tgrelid='public.amora_actions'::regclass AND t.tgname='set_amora_actions_updated_at' AND NOT t.tgisinternal`)})`;

// 새 함수 두 개/단일 대상 trigger만 별도 관찰한다. 나머지 구조를 table 단위로 빼지 않는다.
const preserved = `jsonb_build_object('relations',${aggregate(`SELECT jsonb_build_array(n.nspname,c.relname,c.relkind,
 pg_get_userbyid(c.relowner),c.relacl,c.relrowsecurity,c.relforcerowsecurity,
 ${aggregate(`SELECT jsonb_build_array(a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
 pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`)},
 ${aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) FROM pg_constraint WHERE conrelid=c.oid`)},
 ${aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid`)},
 ${aggregate(`SELECT jsonb_build_array(polname,polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) FROM pg_policy WHERE polrelid=c.oid`)},
 ${aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true)) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal
 AND NOT (c.relnamespace='public'::regnamespace AND c.relname='amora_actions' AND tgname='set_amora_actions_updated_at')`)})
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','f')`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,p.proname,oidvectortypes(p.proargtypes),pg_get_functiondef(p.oid),p.proacl,
 pg_get_userbyid(p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','auth','storage') AND p.prokind IN ('f','p')
 AND NOT (n.nspname='public' AND p.proname IN (${names(NEW_NAMES)}))`)})`;

export const amoraActionViewV2TargetSql=()=>target;
export const amoraActionViewV2PreservedDigestSql=()=>`md5((${preserved})::text)`;
export const amoraActionViewV2RowsSql=()=>`jsonb_build_object(
 'amoraActionsCount',(SELECT count(*) FROM public.amora_actions),
 'amoraActionsMd5',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'[]')) FROM public.amora_actions a),
 'journeysCount',(SELECT count(*) FROM public.wedding_journeys),
 'journeysMd5',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id)::text,'[]')) FROM public.wedding_journeys j))`;

export function buildAmoraActionViewV2ObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','amora-action-view-v2-observation-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'serverVersion',current_setting('server_version'),'database',current_database(),'currentUser',current_user,
 'readOnly',current_setting('transaction_read_only')='on','observedAt',clock_timestamp(),
 'target',${target},'preservedCatalogMd5',md5((${preserved})::text),
 'rows',jsonb_build_object(
   'amoraActionsCount',(SELECT count(*) FROM public.amora_actions),
   'amoraActionsMd5',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'[]')) FROM public.amora_actions a),
   'journeysCount',(SELECT count(*) FROM public.wedding_journeys),
   'journeysMd5',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id)::text,'[]')) FROM public.wedding_journeys j)),
 'ledger',${aggregate(`SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),
 'sqlMd5',md5(statements[1]),'statementsSha256',CASE WHEN statements IS NULL THEN NULL ELSE
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(statements)::text,'UTF8')),'hex') END)
 FROM supabase_migrations.schema_migrations`)},
 'ledgerMd5',(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
 ORDER BY version)::text,'[]')) FROM supabase_migrations.schema_migrations)) AS observation; COMMIT;`;
}

function functionBody(sql,name) {
  const start=new RegExp(`\\bFUNCTION\\s+public\\.${name}\\s*\\(`,'i').exec(sql)?.index;
  const match=start===undefined?null:/AS (\$[a-z_]*\$)([\s\S]*?)\1;/i.exec(sql.slice(start));
  requireRelease(match,'AMORA_VIEW_V2_FUNCTION_SOURCE_INVALID');
  return match[2];
}

export function validateAmoraActionViewV2CatalogFixture(fixture,sql,sqlSha256) {
  requireRelease(fixture?.version===1&&fixture.kind==='synthetic-pg17-amora-action-view-v2-target-catalog'
    &&fixture.candidateSha256===sqlSha256&&/^17\./.test(fixture.serverVersion??''),
  'AMORA_VIEW_V2_CATALOG_FIXTURE_INVALID');
  const before=fixture.baseline?.functions,after=fixture.applied?.functions;
  requireRelease(Array.isArray(before)&&before.length===4&&Array.isArray(after)&&after.length===6,
    'AMORA_VIEW_V2_CATALOG_FIXTURE_INVALID');
  const oldIds=before.map(fn=>fn.identity);
  same(after.filter(fn=>oldIds.includes(fn.identity)),before,'AMORA_VIEW_V2_CATALOG_FIXTURE_SCOPE_CHANGED');
  const additions=after.filter(fn=>!oldIds.includes(fn.identity));
  for(const [name,args,result,securityDefiner,config] of [
    ['advance_amora_action_view_token_v2','','trigger',false,['search_path=""']],
    ['patch_own_amora_action_view_v2','uuid,text,text,jsonb','jsonb',true,
      ['search_path=""','lock_timeout=5s','statement_timeout=15s']],
  ]) {
    const identity=`public.${name}(${args})`;
    same(additions.find(fn=>fn.identity===identity),{identity,owner:'postgres',result,language:'plpgsql',securityDefiner,
      config,bodyMd5:md5(functionBody(sql,name)),strict:false,volatility:'v',parallel:'u',
      acl:securityDefiner?[['authenticated','postgres','EXECUTE',false],['postgres','postgres','EXECUTE',false]]:
        [['postgres','postgres','EXECUTE',false]]},'AMORA_VIEW_V2_CATALOG_FIXTURE_SCOPE_CHANGED');
  }
  same(fixture.baseline.timestampTriggers,[['set_amora_actions_updated_at','O',
    'CREATE TRIGGER set_amora_actions_updated_at BEFORE UPDATE ON amora_actions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()']],
  'AMORA_VIEW_V2_CATALOG_FIXTURE_SCOPE_CHANGED');
  same(fixture.applied.timestampTriggers,[['set_amora_actions_updated_at','O',
    'CREATE TRIGGER set_amora_actions_updated_at BEFORE UPDATE ON amora_actions FOR EACH ROW EXECUTE FUNCTION advance_amora_action_view_token_v2()']],
  'AMORA_VIEW_V2_CATALOG_FIXTURE_SCOPE_CHANGED');
  return fixture;
}

/** inspect는 현재 facts만 반환한다. 새 approved catalog/복구 증거를 대신 승인하지 않는다. */
export function validateAmoraActionViewV2Inspection(observed,{plan,repoRoot,now}) {
  same(Object.keys(observed??{}).sort(),['format','systemIdentifier','serverVersion','database','currentUser','readOnly',
    'observedAt','target','preservedCatalogMd5','rows','ledger','ledgerMd5'].sort(),'AMORA_VIEW_V2_OBSERVATION_INVALID');
  same(Object.keys(observed.target??{}).sort(),['functions','timestampTriggers'].sort(),'AMORA_VIEW_V2_OBSERVATION_INVALID');
  same(Object.keys(observed.rows??{}).sort(),['amoraActionsCount','amoraActionsMd5','journeysCount','journeysMd5'].sort(),
    'AMORA_VIEW_V2_OBSERVATION_INVALID');
  requireRelease(observed?.format==='amora-action-view-v2-observation-v1'&&observed.readOnly===true
    &&observed.systemIdentifier===plan.contract.systemIdentifier&&observed.database==='postgres'
    &&AMORA_VIEW_V2_READ_ONLY_OBSERVERS.includes(observed.currentUser)&&/^17\./.test(observed.serverVersion??''),
  'AMORA_VIEW_V2_DESTINATION_INVALID');
  const at=Date.parse(observed.observedAt);
  requireRelease(Number.isFinite(at)&&at<=now.getTime()+10_000&&at>now.getTime()-120_000,'AMORA_VIEW_V2_OBSERVATION_EXPIRED');
  requireRelease(MD5.test(observed.preservedCatalogMd5??'')&&MD5.test(observed.ledgerMd5??'')
    &&observed.rows&&['amoraActionsMd5','journeysMd5'].every(key=>MD5.test(observed.rows[key]??''))
    &&['amoraActionsCount','journeysCount'].every(key=>Number.isSafeInteger(observed.rows[key])&&observed.rows[key]>=0),
    'AMORA_VIEW_V2_OBSERVATION_INVALID');
  validateAmoraActionViewV2OperatingLedger(observed.ledger,plan,repoRoot);
  const functions=observed.target?.functions;
  requireRelease(Array.isArray(functions)&&functions.length===4,'AMORA_VIEW_V2_UNREGISTERED_OR_MISSING_FUNCTIONS');
  const source=readFileSync(join(repoRoot,'supabase/migrations/20260906074227_amora_manual_actions_actor_boundary.sql'),'utf8');
  const identities=['public.lock_own_amora_action_couple(uuid)','public.validate_manual_amora_action_values(jsonb,boolean)',
    'public.mutate_own_amora_action(uuid,text,text,jsonb)','public.update_own_legacy_amora_action(uuid,uuid,text,bigint,jsonb)'];
  same(functions.map(fn=>fn.identity).sort(),identities.sort(),'AMORA_VIEW_V2_FUNCTION_SIGNATURE_DRIFT');
  for(const fn of functions) {
    const name=fn.identity.slice(7,fn.identity.indexOf('('));
    const helper=name==='lock_own_amora_action_couple'||name==='validate_manual_amora_action_values';
    same(fn,{identity:fn.identity,owner:'postgres',result:helper?'void':'jsonb',language:'plpgsql',
      securityDefiner:name!=='validate_manual_amora_action_values',
      config:helper?['search_path=""']:['search_path=""','lock_timeout=5s','statement_timeout=15s'],
      bodyMd5:md5(functionBody(source,name)),strict:false,volatility:'v',parallel:'u',
      acl:helper?[['postgres','postgres','EXECUTE',false]]:
        [['authenticated','postgres','EXECUTE',false],['postgres','postgres','EXECUTE',false]]},
    'AMORA_VIEW_V2_EXISTING_FUNCTION_DRIFT');
  }
  same(observed.target.timestampTriggers,[['set_amora_actions_updated_at','O',
    'CREATE TRIGGER set_amora_actions_updated_at BEFORE UPDATE ON amora_actions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()']],
  'AMORA_VIEW_V2_TIMESTAMP_TRIGGER_DRIFT');
  return observed;
}
