import {ORIGINAL7_IDENTITIES} from './amora-action-writer-retirement-original-source.mjs';

const literal=value=>`'${value.replaceAll("'","''")}'`;
const list=values=>values.map(literal).join(',');
const aggregate=query=>`(SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) FROM (${query}) q(v))`;
export const AMORA_WRITER_RETIREMENT_NEW_GUARDS=Object.freeze([
  'public.guard_amora_action_insert_identity_cutover_v1()',
  'public.guard_amora_reserved_journey_direct_dml_retirement_v1()',
]);
const identity="n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')'";
const expanded=expression=>aggregate(`SELECT jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
  pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable) FROM aclexplode(${expression}) x`);
export const amoraWriterRetirementShaSql=value=>`encode(sha256(convert_to((${value})::text,'UTF8')),'hex')`;

export const amoraWriterRetirementOriginalFunctionsSql=()=>`(SELECT COALESCE(jsonb_agg(jsonb_build_object('identity',${identity},
 'definition',pg_get_functiondef(p.oid),'definitionSha256',${amoraWriterRetirementShaSql('pg_get_functiondef(p.oid)')},
 'bodySha256',${amoraWriterRetirementShaSql('p.prosrc')},'bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),
 'result',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,'config',p.proconfig,
 'strict',p.proisstrict,'volatility',p.provolatile,'parallel',p.proparallel,'cost',p.procost,'rows',p.prorows,
 'support',p.prosupport::regproc::text,'kind',p.prokind,'leakProof',p.proleakproof,'returnsSet',p.proretset,
 'defaultCount',p.pronargdefaults,'arguments',pg_get_function_arguments(p.oid),'defaults',pg_get_expr(p.proargdefaults,0),
 'rawAcl',p.proacl,'acl',${expanded("COALESCE(p.proacl,acldefault('f',p.proowner))")}) ORDER BY ${identity}),'[]'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND ${identity} IN (${list(ORIGINAL7_IDENTITIES)}))`;
export const amoraWriterRetirementGuardFunctionsSql=()=>amoraWriterRetirementOriginalFunctionsSql()
  .replace(list(ORIGINAL7_IDENTITIES),list(AMORA_WRITER_RETIREMENT_NEW_GUARDS));

export const amoraWriterRetirementCanonicalAclSql=()=>`(SELECT jsonb_build_object('name','public.amora_actions','owner',pg_get_userbyid(c.relowner),
 'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'rawAcl',c.relacl,
 'acl',${expanded("COALESCE(c.relacl,acldefault('r',c.relowner))")},'columns',
 ${aggregate(`SELECT jsonb_build_object('name',a.attname,'rawAcl',a.attacl,'acl',${expanded('a.attacl')})
 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`)},
 'serviceUpdate',jsonb_build_object('table',has_table_privilege('service_role',c.oid,'UPDATE'),
 'anyColumn',has_any_column_privilege('service_role',c.oid,'UPDATE'),'columns',
 (SELECT jsonb_agg(jsonb_build_array(a.attname,has_column_privilege('service_role',c.oid,a.attnum,'UPDATE')) ORDER BY a.attname)
 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))) FROM pg_class c
 WHERE c.oid='public.amora_actions'::regclass)`;

export const amoraWriterRetirementGuardSlotsSql=()=>`jsonb_build_object('functions',
 (SELECT COALESCE(jsonb_agg(${identity} ORDER BY ${identity}),'[]'::jsonb) FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('guard_amora_action_insert_identity_cutover_v1','guard_amora_reserved_journey_direct_dml_retirement_v1')),
 'triggers',${aggregate(`SELECT jsonb_build_array(n.nspname||'.'||c.relname,t.tgname)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND ((c.relname='amora_actions' AND t.tgname='guard_amora_action_insert_identity_cutover_v1')
 OR(c.relname='wedding_journeys' AND t.tgname='guard_amora_reserved_journey_direct_dml_retirement_v1'))`)})`;

// Exactly seven replaced functions and two new guards are compared separately. No table/schema-wide exclusion.
// Only the intended canonical service-role UPDATE grant is projected from the preserved ACL.
const preserved=maintenance=>`jsonb_build_object('relations',${aggregate(`SELECT jsonb_build_array(n.nspname,c.relname,c.relkind,
 pg_get_userbyid(c.relowner),${aggregate(`SELECT jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
 pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable) FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x
 WHERE NOT(n.nspname='public' AND c.relname='amora_actions' AND x.grantee='service_role'::regrole AND x.privilege_type='UPDATE')`)},
 c.relrowsecurity,c.relforcerowsecurity,
 ${aggregate(`SELECT jsonb_build_array(a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attacl,
 pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped`)},
 ${aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) FROM pg_constraint WHERE conrelid=c.oid`)},
 ${aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid`)},
 ${aggregate(`SELECT jsonb_build_array(polname,polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) FROM pg_policy WHERE polrelid=c.oid`)},
 ${aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true)) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal
 AND NOT(n.nspname='public' AND ((c.relname='amora_actions' AND tgname='guard_amora_action_insert_identity_cutover_v1')
 OR(c.relname='wedding_journeys' AND tgname='guard_amora_reserved_journey_direct_dml_retirement_v1')))
 ${maintenance?"AND NOT(n.nspname='public' AND ((c.relname='amora_actions' AND tgname='deny_amora_actions_writer_retirement_maintenance_v1') OR(c.relname='wedding_journeys' AND tgname='deny_wedding_journeys_writer_retirement_maintenance_v1')))":''}` )})
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','f')`)},
 'functions',${aggregate(`SELECT jsonb_build_array(${identity},pg_get_functiondef(p.oid),p.proacl,pg_get_userbyid(p.proowner))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage') AND p.prokind IN ('f','p')
 AND ${identity} NOT IN (${list([...ORIGINAL7_IDENTITIES,...AMORA_WRITER_RETIREMENT_NEW_GUARDS,
   ...(maintenance?['public.deny_amora_action_writer_retirement_maintenance_v1()']:[])])})`)},
 'roles',${aggregate(`SELECT jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) FROM pg_roles`)},
 'memberships',${aggregate(`SELECT jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor),admin_option,inherit_option,set_option) FROM pg_auth_members`)},
 'defaults',${aggregate(`SELECT jsonb_build_array(pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype,d.defaclacl) FROM pg_default_acl d
 LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace`)})`;
export const amoraWriterRetirementPreservedCatalogSql=()=>amoraWriterRetirementShaSql(preserved(false));
// Only the separate stage verifier may use this exact own3 projection after full pins/OIDs validation.
export const amoraWriterRetirementMaintenancePreservedCatalogSql=()=>amoraWriterRetirementShaSql(preserved(true));
export const amoraWriterRetirementRowsSql=()=>`jsonb_build_object(
 'amoraActionsCount',(SELECT count(*) FROM public.amora_actions),
 'amoraActionsSha256',${amoraWriterRetirementShaSql("(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.amora_actions a)")},
 'journeysCount',(SELECT count(*) FROM public.wedding_journeys),
 'journeysSha256',${amoraWriterRetirementShaSql("(SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id),'[]'::jsonb) FROM public.wedding_journeys j)")})`;
export const amoraWriterRetirementRawLedgerShaSql=()=>amoraWriterRetirementShaSql(`(SELECT COALESCE(jsonb_agg(
 jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb)
 FROM supabase_migrations.schema_migrations)`);
export const amoraWriterRetirementRawLedgerMd5Sql=()=>`(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
 'version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]')) FROM supabase_migrations.schema_migrations)`;
export const amoraWriterRetirementLedgerSql=()=>`(SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,
 'statementCount',cardinality(statements),'sqlMd5',md5(statements[1]),'statementsSha256',CASE WHEN statements IS NULL THEN NULL
 ELSE encode(sha256(convert_to(to_jsonb(statements)::text,'UTF8')),'hex') END) ORDER BY version),'[]'::jsonb)
 FROM supabase_migrations.schema_migrations)`;
