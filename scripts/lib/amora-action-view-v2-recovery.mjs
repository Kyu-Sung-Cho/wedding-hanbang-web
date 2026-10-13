import {readFileSync} from 'node:fs';
import {digest,digestJson,pinnedArtifact,requireRelease,same} from './current-baseline-release-contract.mjs';
import {createHash} from 'node:crypto';
import {loadAmoraActionViewV2Plan} from './amora-action-view-v2-release-contract.mjs';
import {amoraActionViewV2TargetSql,amoraActionViewV2PreservedDigestSql,amoraActionViewV2RowsSql}
  from './amora-action-view-v2-catalog.mjs';

const SHA=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const SYSTEM=/^\d{10,32}$/;
const MD5=/^[a-f0-9]{32}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ORIGIN='https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git';
const CONTRACT={file:'supabase/release-contracts/amora-action-view-v2-v1.json',
  sha256:'1c5f50e114c969cd52a6e5a605d8a3e7b0476966182c6775a5650f196dda5ccb'};
const CATALOG={file:'supabase/release-contracts/amora-action-view-v2-pg17-catalog-v1.json',
  sha256:'6eea8aa27b30487adfe4d51314e0155881233a5a991109a52f5bdb1a40a34227'};
const ORIGINAL={file:'supabase/migrations/20260906074227_amora_manual_actions_actor_boundary.sql',
  sha256:'57da05968e382fd5116f2e7ae53df05503ad49bf836112a975bfbca331154865'};
// PG17 pg_get_functiondef 원문을 실제 original migration 설치로 독립 관찰했다.
const DEFINITIONS=Object.freeze({
  'public.lock_own_amora_action_couple(uuid)':'7a7e87886493bf2d5eb6dce34fac59eb308e539c926f34c75e1a2d3348e06c93',
  'public.mutate_own_amora_action(uuid,text,text,jsonb)':'ae95f4bcada2c3b015ff8f6fb04232b9613a83289ff0c5556f1a8601310c0e14',
  'public.update_own_legacy_amora_action(uuid,uuid,text,bigint,jsonb)':'13fa2ab6677021ec6a40469a7249192cc0cec312254994643eefa95034e7b080',
  'public.validate_manual_amora_action_values(jsonb,boolean)':'80f8b9d8ea93889fc1a7a90e5109784ebf5aa495aac856327cd865559e93b18e',
});
const issuedCapsules=new WeakMap();
const sourceSha=()=>digest(readFileSync(new URL(import.meta.url)));
const keys=(value,names,code)=>{
  requireRelease(value!==null&&typeof value==='object'&&!Array.isArray(value),code);
  same(Object.keys(value).sort(),names.sort(),code);
};
const freeze=value=>{
  if(value&&typeof value==='object') {for(const child of Object.values(value)) freeze(child);Object.freeze(value);}
  return value;
};

/** expectedCommit/collector pin은 신뢰할 runtime이 구성한다. 값 일치만으로 실제 실행 출처를 증명하지 않는다. */
export function validateAmoraActionViewV2RecoveryCapsule(args) {
  keys(args,['repoRoot','bytes','expectedArtifactSha256','expectedCommit','expectedCollectorSha256','deadline',
    ...(Object.hasOwn(args??{},'expectedNativeSystemIdentifier')?['expectedNativeSystemIdentifier']:[])],
  'AMORA_VIEW_V2_RECOVERY_ARGUMENT_INVALID');
  const {repoRoot,bytes,expectedArtifactSha256,expectedCommit,expectedCollectorSha256,
    expectedNativeSystemIdentifier,deadline}=args;
  requireRelease(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=256*1024
    &&SHA.test(expectedArtifactSha256??'')&&digest(bytes)===expectedArtifactSha256,
  'AMORA_VIEW_V2_RECOVERY_ARTIFACT_INVALID');
  requireRelease(COMMIT.test(expectedCommit??'')&&SHA.test(expectedCollectorSha256??''),
    'AMORA_VIEW_V2_RECOVERY_PROVENANCE_INVALID');
  // 거절할 입력은 작은 고정 artifact로 먼저 검사한다. 발급 직전에만 전체241 source ledger를 감사한다.
  const contract=JSON.parse(pinnedArtifact(repoRoot,CONTRACT));
  const fixture=JSON.parse(pinnedArtifact(repoRoot,CATALOG));
  pinnedArtifact(repoRoot,ORIGINAL);
  let raw;
  try {raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {requireRelease(false,'AMORA_VIEW_V2_RECOVERY_ARTIFACT_INVALID');}
  keys(raw,['format','captureEnvironment','projectRef','sourceSystemIdentifier','sourceCommit','expectedOrigin',
    'collectorSourceSha256','candidateSha256','migrationSha256','originalMigrationSha256','capturedAt','serverVersion',
    'database','currentUser','readOnly','target','definitions','dependency','preservedCatalogMd5','rows','ledgerMd5'],
  'AMORA_VIEW_V2_RECOVERY_ARTIFACT_INVALID');
  requireRelease(raw.format==='amora-action-view-v2-original-capsule-v1'
    &&raw.projectRef===contract.projectRef&&raw.expectedOrigin===ORIGIN
    &&raw.sourceCommit===expectedCommit&&raw.collectorSourceSha256===expectedCollectorSha256
    &&raw.candidateSha256===contract.candidate.sha256&&raw.migrationSha256===contract.migrations[0].sha256
    &&raw.originalMigrationSha256===ORIGINAL.sha256,'AMORA_VIEW_V2_RECOVERY_PROVENANCE_INVALID');
  requireRelease(raw.database==='postgres'&&/^17\./.test(raw.serverVersion??'')&&raw.readOnly===true,
    'AMORA_VIEW_V2_RECOVERY_DESTINATION_INVALID');
  if(raw.captureEnvironment==='owned-native-pg17') {
    requireRelease(SYSTEM.test(expectedNativeSystemIdentifier??'')
      &&raw.sourceSystemIdentifier===expectedNativeSystemIdentifier
      &&expectedNativeSystemIdentifier!==contract.systemIdentifier&&raw.currentUser==='postgres',
    'AMORA_VIEW_V2_RECOVERY_DESTINATION_INVALID');
  } else {
    requireRelease(raw.captureEnvironment==='supabase-read-only'&&expectedNativeSystemIdentifier===undefined
      &&raw.sourceSystemIdentifier===contract.systemIdentifier
      &&raw.currentUser==='supabase_read_only_user','AMORA_VIEW_V2_RECOVERY_DESTINATION_INVALID');
  }
  const now=Date.now(),at=Date.parse(raw.capturedAt),until=Date.parse(deadline);
  requireRelease(TIME.test(raw.capturedAt??'')&&TIME.test(deadline??'')&&Number.isFinite(at)&&at<=now+10_000&&at>now-120_000
    &&Number.isFinite(until)&&until>now&&until<=now+120_000,
  'AMORA_VIEW_V2_RECOVERY_EXPIRED');
  keys(raw.rows,['amoraActionsCount','amoraActionsMd5','journeysCount','journeysMd5'],
    'AMORA_VIEW_V2_RECOVERY_ARTIFACT_INVALID');
  requireRelease(MD5.test(raw.preservedCatalogMd5??'')&&MD5.test(raw.ledgerMd5??'')
    &&['amoraActionsMd5','journeysMd5'].every(key=>MD5.test(raw.rows[key]??''))
    &&['amoraActionsCount','journeysCount'].every(key=>Number.isSafeInteger(raw.rows[key])&&raw.rows[key]>=0),
  'AMORA_VIEW_V2_RECOVERY_ARTIFACT_INVALID');
  same(raw.target,fixture.baseline,'AMORA_VIEW_V2_RECOVERY_ORIGINAL_DRIFT');
  requireRelease(Array.isArray(raw.definitions)&&raw.definitions.length===4,
    'AMORA_VIEW_V2_RECOVERY_DEFINITION_INVALID');
  for(const row of raw.definitions)
    keys(row,['identity','definition','sha256'],'AMORA_VIEW_V2_RECOVERY_DEFINITION_INVALID');
  same(raw.definitions.map(row=>row.identity).sort(),Object.keys(DEFINITIONS).sort(),
    'AMORA_VIEW_V2_RECOVERY_DEFINITION_INVALID');
  for(const row of raw.definitions) {
    requireRelease(typeof row.definition==='string'&&digest(row.definition)===row.sha256
      &&row.sha256===DEFINITIONS[row.identity],'AMORA_VIEW_V2_RECOVERY_DEFINITION_INVALID');
  }
  keys(raw.dependency,['identity','definition','sha256','bodyMd5','owner','config','securityDefiner',
    'result','language','strict','volatility','parallel','acl'],'AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
  const dependency=raw.dependency;
  const body=/^CREATE OR REPLACE FUNCTION public\.update_updated_at_column\(\)\n RETURNS trigger\n LANGUAGE plpgsql\nAS (\$[a-z_]*\$)([\s\S]*?)\1\n$/.exec(dependency.definition??'');
  requireRelease(body&&digest(dependency.definition)===dependency.sha256
    &&createHash('md5').update(body[2]).digest('hex')===dependency.bodyMd5,
  'AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
  const native=raw.captureEnvironment==='owned-native-pg17';
  const actualDependency=dependency.bodyMd5==='204b9b9355e61b7541bc0633bbc9294c'
    &&dependency.sha256==='7b39b72b4fe4d1981fca770b1ad1ad6e062d560822731577e5ae3f1449ffef02';
  const syntheticDependency=dependency.bodyMd5==='9b1889f56258bf9d6554213c05019c76'
    &&dependency.sha256==='ff10904cc5872799923a1de83d11c4284cbf4b5a8687f41c9c1279ee92bf7202';
  requireRelease(dependency.identity==='public.update_updated_at_column()'&&dependency.owner==='postgres'
    &&dependency.config===null&&dependency.securityDefiner===false&&dependency.result==='trigger'
    &&dependency.language==='plpgsql'&&dependency.strict===false&&dependency.volatility==='v'&&dependency.parallel==='u'
    &&(actualDependency||(native&&syntheticDependency)),
  'AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
  same(dependency.acl,(actualDependency?['PUBLIC','anon','authenticated','postgres','service_role']:['PUBLIC','postgres'])
    .map(grantee=>[grantee,'postgres','EXECUTE',false]),'AMORA_VIEW_V2_RECOVERY_DEPENDENCY_INVALID');
  loadAmoraActionViewV2Plan(repoRoot);
  const verifiedAt=Date.now();
  requireRelease(at>verifiedAt-120_000&&until>verifiedAt,'AMORA_VIEW_V2_RECOVERY_EXPIRED');
  const receipt=freeze({format:'amora-action-view-v2-recovery-content-receipt-v1',
    scope:'target-original-replayed-only',artifactSha256:expectedArtifactSha256,verifierSha256:sourceSha(),
    verifiedAt:new Date(verifiedAt).toISOString(),deadline,captureEnvironment:raw.captureEnvironment,
    projectRef:raw.projectRef,sourceCommit:raw.sourceCommit,expectedOrigin:ORIGIN,
    collectorSourceSha256:raw.collectorSourceSha256,candidateSha256:raw.candidateSha256,
    migrationSha256:raw.migrationSha256,originalMigrationSha256:ORIGINAL.sha256,
    dependencyVariant:native?(actualDependency?'actual-definition-local-204b':'synthetic-definition-local-9b'):
      'actual-definition-content-204b',
    sourceSystemIdentifier:raw.sourceSystemIdentifier,originalTargetSha256:digestJson(raw.target),
    privateStorageVerified:false,collectorExecutionProvenanceVerified:false,nativeReplayVerified:false,
    releaseAuthorized:false,productionApplyImplemented:false,remoteWritesPerformed:false});
  issuedCapsules.set(receipt,freeze(raw));
  return receipt;
}

const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${literal(JSON.stringify(value))}::jsonb`;
const shaSql=value=>`encode(sha256(convert_to((${value})::text,'UTF8')),'hex')`;
const oldIdentities=Object.keys(DEFINITIONS).sort();
const ids=oldIdentities.map(literal).join(',');
const identitySql="n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')'";
const definitionsSql=`(SELECT jsonb_agg(jsonb_build_object('identity',${identitySql},
  'sha256',${shaSql('pg_get_functiondef(p.oid)')}) ORDER BY ${identitySql}) FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${identitySql} IN (${ids}))`;
const dependencySql=`(SELECT jsonb_build_object('identity','public.update_updated_at_column()',
  'definition',pg_get_functiondef(p.oid),'sha256',${shaSql('pg_get_functiondef(p.oid)')},'bodyMd5',md5(p.prosrc),
  'owner',pg_get_userbyid(p.proowner),'config',p.proconfig,'securityDefiner',p.prosecdef,
  'result',pg_get_function_result(p.oid),'language',l.lanname,'strict',p.proisstrict,
  'volatility',p.provolatile,'parallel',p.proparallel,'acl',
  (SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
    ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)
    FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a)) FROM pg_proc p
  JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure('public.update_updated_at_column()'))`;
const ledgerSql=`(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
  ORDER BY version)::text,'[]')) FROM supabase_migrations.schema_migrations)`;

/** 읽기 전용 원문 renderer만 제공한다. 실행·private sink/ACL/출처 실측은 별도 collector 소유다. */
export function buildAmoraActionViewV2RecoveryCaptureSql(args) {
  keys(args,['repoRoot','expectedCommit','collectorSourceSha256',
    ...(Object.hasOwn(args??{},'captureEnvironment')?['captureEnvironment']:[])],
  'AMORA_VIEW_V2_RECOVERY_ARGUMENT_INVALID');
  const {repoRoot,expectedCommit,collectorSourceSha256,captureEnvironment='supabase-read-only'}=args;
  requireRelease(COMMIT.test(expectedCommit??'')&&SHA.test(collectorSourceSha256??'')
    &&['supabase-read-only','owned-native-pg17'].includes(captureEnvironment),
  'AMORA_VIEW_V2_RECOVERY_PROVENANCE_INVALID');
  const plan=loadAmoraActionViewV2Plan(repoRoot);
  pinnedArtifact(repoRoot,ORIGINAL);
  const fullDefinitions=`(SELECT jsonb_agg(jsonb_build_object('identity',${identitySql},
    'definition',pg_get_functiondef(p.oid),'sha256',${shaSql('pg_get_functiondef(p.oid)')}) ORDER BY ${identitySql})
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${identitySql} IN (${ids}))`;
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('format','amora-action-view-v2-original-capsule-v1',
  'captureEnvironment',${literal(captureEnvironment)},'projectRef',${literal(plan.contract.projectRef)},
  'sourceSystemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'sourceCommit',${literal(expectedCommit)},'expectedOrigin',${literal(ORIGIN)},
  'collectorSourceSha256',${literal(collectorSourceSha256)},'candidateSha256',${literal(plan.candidateSha256)},
  'migrationSha256',${literal(plan.sqlSha256)},'originalMigrationSha256',${literal(ORIGINAL.sha256)},
  'capturedAt',clock_timestamp(),'serverVersion',current_setting('server_version'),'database',current_database(),
  'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on',
  'target',${amoraActionViewV2TargetSql()},'definitions',${fullDefinitions},'dependency',${dependencySql},
  'preservedCatalogMd5',${amoraActionViewV2PreservedDigestSql()},'rows',${amoraActionViewV2RowsSql()},
  'ledgerMd5',${ledgerSql}) AS recovery_capsule;
COMMIT;
`;
}

/** 순수 renderer다. production ID를 거절하며 임의 client/SQL/cleanup capability를 받지 않는다. */
export function buildAmoraActionViewV2OriginalReplaySql(args) {
  keys(args,['repoRoot','capsule','expectedSystemIdentifier','deadline'],'AMORA_VIEW_V2_RECOVERY_ARGUMENT_INVALID');
  const {repoRoot,capsule,expectedSystemIdentifier,deadline}=args,raw=issuedCapsules.get(capsule);
  requireRelease(raw&&capsule.verifierSha256===sourceSha(),'AMORA_VIEW_V2_RECOVERY_CAPSULE_NOT_ISSUED');
  const plan=loadAmoraActionViewV2Plan(repoRoot),now=Date.now(),until=Date.parse(deadline);
  requireRelease(SYSTEM.test(expectedSystemIdentifier??'')&&expectedSystemIdentifier!==plan.contract.systemIdentifier
    &&(raw.captureEnvironment!=='owned-native-pg17'||expectedSystemIdentifier===raw.sourceSystemIdentifier),
  'AMORA_VIEW_V2_RECOVERY_LOCAL_DESTINATION_REQUIRED');
  requireRelease(Number.isFinite(until)&&until>now&&until<=now+120_000&&until<=Date.parse(capsule.deadline)
    &&Date.parse(raw.capturedAt)>now-120_000,'AMORA_VIEW_V2_RECOVERY_EXPIRED');
  const target=amoraActionViewV2TargetSql(),preserved=amoraActionViewV2PreservedDigestSql(),rows=amoraActionViewV2RowsSql();
  const expectedRestored={functions:plan.catalogFixture.applied.functions,timestampTriggers:raw.target.timestampTriggers};
  const statements=[];
  for(const id of oldIdentities) {
    const definition=raw.definitions.find(row=>row.identity===id).definition;
    statements.push(definition,`ALTER FUNCTION ${id} OWNER TO postgres;`,
      `REVOKE ALL ON FUNCTION ${id} FROM PUBLIC,anon,authenticated,service_role;`,
      `GRANT EXECUTE ON FUNCTION ${id} TO postgres;`);
    if(raw.target.functions.find(fn=>fn.identity===id).acl.some(row=>row[0]==='authenticated'))
      statements.push(`GRANT EXECUTE ON FUNCTION ${id} TO authenticated;`);
  }
  // 대상 trigger 1개만 복구한다. 신규 함수/원장 제거, CASCADE, role 전역 변경은 없다.
  statements.push('DROP TRIGGER set_amora_actions_updated_at ON public.amora_actions;',
    'CREATE TRIGGER set_amora_actions_updated_at BEFORE UPDATE ON public.amora_actions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();',
    'ALTER TABLE public.amora_actions ENABLE TRIGGER set_amora_actions_updated_at;');
  const tag=`$hb_amora_recovery_${capsule.artifactSha256.slice(0,16)}$`;
  requireRelease(statements.every(statement=>!statement.includes(tag)),
    'AMORA_VIEW_V2_RECOVERY_DEFINITION_INVALID');
  return `-- Owned loopback PG17 original 4+1 replay only; not an operational rollback permission.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
DO ${tag} BEGIN
  IF current_user<>'postgres' OR current_database()<>'postgres' OR current_setting('server_version') !~ '^17[.]'
    OR (SELECT system_identifier::text FROM pg_control_system())<>${literal(expectedSystemIdentifier)}
    OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR current_setting('listen_addresses')<>'127.0.0.1'
    THEN RAISE EXCEPTION 'AMORA_VIEW_V2_RECOVERY_LOCAL_DESTINATION_REQUIRED'; END IF;
  IF clock_timestamp()>=${literal(deadline)}::timestamptz
    OR clock_timestamp()>=${literal(raw.capturedAt)}::timestamptz+interval '120 seconds'
    THEN RAISE EXCEPTION 'AMORA_VIEW_V2_RECOVERY_EXPIRED'; END IF;
END ${tag};
LOCK TABLE public.amora_actions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.wedding_journeys IN SHARE MODE;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE hb_amora_original_replay_evidence(value jsonb) ON COMMIT DROP;
DO ${tag}
DECLARE v_before_target jsonb; v_restored jsonb; v_original jsonb; v_preserved text; v_rows jsonb; v_ledger text;
BEGIN
  v_before_target:=${target}; v_preserved:=${preserved}; v_rows:=${rows}; v_ledger:=${ledgerSql};
  IF v_before_target IS DISTINCT FROM ${json(plan.catalogFixture.applied)}
    OR ${definitionsSql} IS DISTINCT FROM ${json(raw.definitions.map(row=>({identity:row.identity,sha256:row.sha256})).sort((a,b)=>a.identity.localeCompare(b.identity)))}
    THEN RAISE EXCEPTION 'AMORA_VIEW_V2_RECOVERY_APPLIED_DRIFT'; END IF;
  IF ${dependencySql} IS DISTINCT FROM ${json(raw.dependency)}
    THEN RAISE EXCEPTION 'AMORA_VIEW_V2_RECOVERY_DEPENDENCY_DRIFT'; END IF;
  IF (SELECT name=${literal(plan.migration.name)} AND statements=ARRAY[${literal(plan.sql)}]::text[]
    FROM supabase_migrations.schema_migrations WHERE version=${literal(plan.migration.version)}) IS DISTINCT FROM true
    THEN RAISE EXCEPTION 'AMORA_VIEW_V2_RECOVERY_LEDGER_DRIFT'; END IF;
  ${statements.map(statement=>`EXECUTE ${literal(statement)};`).join('\n  ')}
  v_restored:=${target};
  v_original:=jsonb_build_object('functions',(SELECT jsonb_agg(fn ORDER BY fn::text)
    FROM jsonb_array_elements(v_restored->'functions') fn WHERE fn->>'identity' IN (${ids})),
    'timestampTriggers',v_restored->'timestampTriggers');
  IF v_restored IS DISTINCT FROM ${json(expectedRestored)} OR v_original IS DISTINCT FROM ${json(raw.target)}
    OR ${definitionsSql} IS DISTINCT FROM ${json(raw.definitions.map(row=>({identity:row.identity,sha256:row.sha256})).sort((a,b)=>a.identity.localeCompare(b.identity)))}
    OR ${dependencySql} IS DISTINCT FROM ${json(raw.dependency)} OR ${preserved} IS DISTINCT FROM v_preserved
    OR ${rows} IS DISTINCT FROM v_rows OR ${ledgerSql} IS DISTINCT FROM v_ledger
    THEN RAISE EXCEPTION 'AMORA_VIEW_V2_RECOVERY_POST_DRIFT'; END IF;
  IF clock_timestamp()>=${literal(deadline)}::timestamptz
    THEN RAISE EXCEPTION 'AMORA_VIEW_V2_RECOVERY_EXPIRED'; END IF;
  INSERT INTO pg_temp.hb_amora_original_replay_evidence VALUES(jsonb_build_object(
    'format','amora-action-view-v2-native-original-replay-v1','scope','target-original-replayed-only',
    'verifiedAt',clock_timestamp(),'artifactSha256',${literal(capsule.artifactSha256)},
    'verifierSha256',${literal(capsule.verifierSha256)},'nativeSystemIdentifier',${literal(expectedSystemIdentifier)},
    'dependencyVariant',${literal(capsule.dependencyVariant)},
    'serverVersion',current_setting('server_version'),'targetHashEncoding','postgres-jsonb-text-utf8',
    'originalTargetSha256',${shaSql(json(raw.target))},'appliedTargetSha256',${shaSql('v_before_target')},
    'restoredTargetSha256',${shaSql('v_restored')},'restoredOriginalTargetSha256',${shaSql('v_original')},
    'preservedCatalogMd5',v_preserved,'rowsSha256',${shaSql('v_rows')},'rawLedgerMd5',v_ledger,
    'newFunctionsAndLedgerRetained',true,'productionRecoveryAuthorized',false));
END ${tag};
SELECT value AS replay_evidence FROM pg_temp.hb_amora_original_replay_evidence;
COMMIT;
`;
}
