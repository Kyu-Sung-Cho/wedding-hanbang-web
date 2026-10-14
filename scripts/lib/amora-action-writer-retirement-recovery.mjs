import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {deriveFixedOriginal7FromRepo,deriveFixedApplied7FromRepo,ORIGINAL7_IDENTITIES} from './amora-action-writer-retirement-original-source.mjs';
import {amoraWriterRetirementOriginalFunctionsSql,amoraWriterRetirementCanonicalAclSql,amoraWriterRetirementGuardSlotsSql,
  amoraWriterRetirementGuardFunctionsSql,amoraWriterRetirementPreservedCatalogSql,amoraWriterRetirementRowsSql,amoraWriterRetirementRawLedgerShaSql,amoraWriterRetirementLedgerSql} from './amora-action-writer-retirement-state.mjs';
import {getAmoraWriterRetirementTargetMetadata} from './amora-action-writer-retirement-privileges.mjs';

const FORMAT='amora-b2-original7-canonical-update-acl-capsule-v1';
const KIND='b2-scoped-original7-not-b1-original4-or-b2-original6';
const SYSTEM='7581440907192989109',PROJECT='slrtobkksjmxgzatjyqb',ORIGIN='https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git';
const SHA=/^[a-f0-9]{64}$/,MD5=/^[a-f0-9]{32}$/,COMMIT=/^[a-f0-9]{40}$/;
const issued=new WeakMap();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const selfSha=()=>digest(readFileSync(new URL(import.meta.url)));
const requireValue=(ok,code)=>{if(!ok)throw new Error(code);};
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const same=(a,b,code)=>requireValue(stable(a)===stable(b),code);
const keys=(value,expected)=>{requireValue(value&&typeof value==='object'&&!Array.isArray(value),'AMORA_WRITER_RECOVERY_SHAPE_INVALID');same(Object.keys(value).sort(),expected.slice().sort(),'AMORA_WRITER_RECOVERY_SHAPE_INVALID');};
const shaValid=value=>typeof value==='string'&&SHA.test(value);
const md5Valid=value=>typeof value==='string'&&MD5.test(value);
const literal=value=>`'${value.replaceAll("'","''")}'`;
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const plan=root=>loadAmoraWriterRetirementPlan({repoRoot:root,mode:AMORA_WRITER_RETIREMENT_MODE});

export function amoraWriterRetirementOriginalCanonicalAcl() {
  const privileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
  const cols=['category_key','completed_at','couple_id','created_at','created_by','description','dismissed_at','due_date','href','id','metadata','priority','source','status','title','updated_at'];
  return {name:'public.amora_actions',owner:'postgres',kind:'r',rls:true,forceRls:false,
    rawAcl:['postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres','authenticated=r/postgres'],
    acl:[['authenticated','postgres','SELECT',false],...['postgres','service_role'].flatMap(role=>privileges.map(p=>[role,'postgres',p,false]))].sort((a,b)=>stable(a).localeCompare(stable(b))),
    columns:cols.map(name=>({name,rawAcl:null,acl:[]})),serviceUpdate:{table:true,anyColumn:true,columns:cols.map(name=>[name,true])}};
}
function freshness(raw,deadline) {
  const now=Date.now(),at=typeof raw.capturedAt==='string'?Date.parse(raw.capturedAt):NaN,end=typeof deadline==='string'?Date.parse(deadline):NaN;
  requireValue(Number.isFinite(at)&&at<=now+10_000&&at>now-120_000&&Number.isFinite(end)&&end>now&&end<=now+120_000&&end<=at+120_000,'AMORA_WRITER_RECOVERY_EXPIRED');
}

/** Exact typed ledger arrays are source history, not an observed DB capability. */
export function validateAmoraWriterRetirementLedger(rows,expected) {
  requireValue(Array.isArray(rows)&&Array.isArray(expected),'AMORA_WRITER_RECOVERY_LEDGER_INVALID');
  for(const row of rows) {
    keys(row,['version','name','statementCount','sqlMd5','statementsSha256']);
    requireValue(typeof row.version==='string'&&/^\d{14}$/.test(row.version)&&typeof row.name==='string'&&/^[a-z0-9_]+$/.test(row.name)
      &&(row.statementCount===null||Number.isSafeInteger(row.statementCount)&&row.statementCount>=0)
      &&(row.sqlMd5===null||md5Valid(row.sqlMd5))&&(row.statementsSha256===null||shaValid(row.statementsSha256)),'AMORA_WRITER_RECOVERY_LEDGER_INVALID');
    requireValue(row.statementsSha256===null?row.statementCount===null&&row.sqlMd5===null:row.statementCount!==null&&row.sqlMd5!==null,'AMORA_WRITER_RECOVERY_LEDGER_INVALID');
  }
  same(rows.map(({version,name,statementsSha256})=>({version,name,statementsSha256})),expected,'AMORA_WRITER_RECOVERY_LEDGER_DRIFT');
}

export function buildAmoraWriterRetirementRecoveryCaptureSql(value) {
  keys(value,['repoRoot','expectedCommit','collectorSourceSha256','expectedNativeSystemIdentifier']);
  requireValue(typeof value.expectedCommit==='string'&&COMMIT.test(value.expectedCommit)&&shaValid(value.collectorSourceSha256),'AMORA_WRITER_RECOVERY_SOURCE_INVALID');
  const p=plan(value.repoRoot);
  const native=value.expectedNativeSystemIdentifier!==null;
  requireValue(!native||typeof value.expectedNativeSystemIdentifier==='string'&&/^\d{10,32}$/.test(value.expectedNativeSystemIdentifier)&&value.expectedNativeSystemIdentifier!==SYSTEM,'AMORA_WRITER_RECOVERY_DESTINATION_INVALID');
  deriveFixedOriginal7FromRepo(value.repoRoot);
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('format',${literal(FORMAT)},'kind',${literal(KIND)},'captureEnvironment',${literal(native?'owned-native-pg17':'supabase-read-only')},
 'projectRef',${literal(PROJECT)},'sourceSystemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'sourceCommit',${literal(value.expectedCommit)},'expectedOrigin',${literal(ORIGIN)},'collectorSourceSha256',${literal(value.collectorSourceSha256)},
 'bundleSha256',${literal(p.migration.sha256)},'capturedAt',clock_timestamp(),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on',
 'definitions',${amoraWriterRetirementOriginalFunctionsSql()},'canonicalTable',${amoraWriterRetirementCanonicalAclSql()},'b2GuardSlots',${amoraWriterRetirementGuardSlotsSql()},
 'stateWitness',jsonb_build_object('preservedCatalogSha256',${amoraWriterRetirementPreservedCatalogSql()},'rows',${amoraWriterRetirementRowsSql()},
 'rawLedgerSha256',${amoraWriterRetirementRawLedgerShaSql()},'ledger',${amoraWriterRetirementLedgerSql()})) AS b2_original7_capsule;
COMMIT;
`;
}

/** Raw content only. Private-store/collector/native provenance cannot be asserted by JSON. */
export function validateAmoraWriterRetirementRecoveryCapsule(value) {
  keys(value,['repoRoot','bytes','expectedArtifactSha256','expectedCommit','expectedCollectorSha256','deadline','expectedNativeSystemIdentifier']);
  const {repoRoot,bytes,expectedArtifactSha256,expectedCommit,expectedCollectorSha256,deadline,expectedNativeSystemIdentifier}=value;
  requireValue(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=262144&&shaValid(expectedArtifactSha256)&&digest(bytes)===expectedArtifactSha256,'AMORA_WRITER_RECOVERY_ARTIFACT_INVALID');
  requireValue(typeof expectedCommit==='string'&&COMMIT.test(expectedCommit)&&shaValid(expectedCollectorSha256),'AMORA_WRITER_RECOVERY_SOURCE_INVALID');
  let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('AMORA_WRITER_RECOVERY_ARTIFACT_INVALID');}
  keys(raw,['format','kind','captureEnvironment','projectRef','sourceSystemIdentifier','sourceCommit','expectedOrigin','collectorSourceSha256','bundleSha256',
    'capturedAt','serverVersion','database','currentUser','readOnly','definitions','canonicalTable','b2GuardSlots','stateWitness']);
  const p=plan(repoRoot);
  same([raw.format,raw.kind,raw.projectRef,raw.expectedOrigin,raw.sourceCommit,raw.collectorSourceSha256,raw.bundleSha256],
    [FORMAT,KIND,PROJECT,ORIGIN,expectedCommit,expectedCollectorSha256,p.migration.sha256],'AMORA_WRITER_RECOVERY_SOURCE_INVALID');
  requireValue(raw.readOnly===true&&raw.database==='postgres'&&typeof raw.serverVersion==='string'&&/^17\./.test(raw.serverVersion),'AMORA_WRITER_RECOVERY_DESTINATION_INVALID');
  if(expectedNativeSystemIdentifier===null)requireValue(raw.captureEnvironment==='supabase-read-only'&&raw.sourceSystemIdentifier===SYSTEM
    &&['supabase_read_only_user','postgres'].includes(raw.currentUser),'AMORA_WRITER_RECOVERY_DESTINATION_INVALID');
  else requireValue(typeof expectedNativeSystemIdentifier==='string'&&/^\d{10,32}$/.test(expectedNativeSystemIdentifier)&&expectedNativeSystemIdentifier!==SYSTEM
    &&raw.captureEnvironment==='owned-native-pg17'&&raw.sourceSystemIdentifier===expectedNativeSystemIdentifier&&raw.currentUser==='postgres','AMORA_WRITER_RECOVERY_DESTINATION_INVALID');
  freshness(raw,deadline);
  const expected=deriveFixedOriginal7FromRepo(repoRoot);
  requireValue(Array.isArray(raw.definitions)&&raw.definitions.length===7,'AMORA_WRITER_RECOVERY_DEFINITION_INVALID');
  same(raw.definitions.map(fn=>fn.identity).sort(),ORIGINAL7_IDENTITIES,'AMORA_WRITER_RECOVERY_DEFINITION_INVALID');
  for(const fn of raw.definitions) {
    const wanted=expected.find(row=>row.identity===fn.identity);
    requireValue(typeof fn.definition==='string'&&shaValid(fn.definitionSha256)&&digest(fn.definition)===fn.definitionSha256,'AMORA_WRITER_RECOVERY_DEFINITION_INVALID');
    same(fn,wanted,'AMORA_WRITER_RECOVERY_DEFINITION_INVALID');
  }
  same(raw.canonicalTable,amoraWriterRetirementOriginalCanonicalAcl(),'AMORA_WRITER_RECOVERY_ORIGINAL_ACL_INVALID');
  same(raw.b2GuardSlots,{functions:[],triggers:[]},'AMORA_WRITER_RECOVERY_GUARD_SLOT_NOT_ABSENT');
  keys(raw.stateWitness,['preservedCatalogSha256','rows','rawLedgerSha256','ledger']);
  requireValue(shaValid(raw.stateWitness.preservedCatalogSha256)&&shaValid(raw.stateWitness.rawLedgerSha256),'AMORA_WRITER_RECOVERY_STATE_INVALID');
  keys(raw.stateWitness.rows,['amoraActionsCount','amoraActionsSha256','journeysCount','journeysSha256']);
  requireValue(['amoraActionsCount','journeysCount'].every(key=>Number.isSafeInteger(raw.stateWitness.rows[key])&&raw.stateWitness.rows[key]>=0)
    &&['amoraActionsSha256','journeysSha256'].every(key=>shaValid(raw.stateWitness.rows[key])),'AMORA_WRITER_RECOVERY_STATE_INVALID');
  if(expectedNativeSystemIdentifier===null)validateAmoraWriterRetirementLedger(raw.stateWitness.ledger,p.expectedBefore230);
  else requireValue(Array.isArray(raw.stateWitness.ledger)&&raw.stateWitness.ledger.length===230,'AMORA_WRITER_RECOVERY_NATIVE_LEDGER_INVALID');
  freshness(raw,deadline);
  const receipt=freeze({format:'amora-b2-original7-content-receipt-v1',kind:KIND,scope:'original7-canonical-update-acl-content-only',
    captureEnvironment:raw.captureEnvironment,artifactSha256:expectedArtifactSha256,verifierSha256:selfSha(),sourceCommit:expectedCommit,
    collectorSourceSha256:expectedCollectorSha256,verifiedAt:new Date().toISOString(),deadline,
    privateStorageVerified:false,collectorExecutionProvenanceVerified:false,nativeReplayVerified:false,operatingLedgerVerified:false,
    releaseAuthorized:false,productionRecoveryAuthorized:false,remoteWritesPerformed:false});
  issued.set(receipt,{raw:freeze(raw),repoRoot,expectedNativeSystemIdentifier});return receipt;
}

export function readAmoraWriterRetirementRecoveryCapsule(receipt) {
  const state=issued.get(receipt);
  requireValue(state&&receipt.verifierSha256===selfSha(),'AMORA_WRITER_RECOVERY_RECEIPT_NOT_ISSUED');
  plan(state.repoRoot);deriveFixedOriginal7FromRepo(state.repoRoot);freshness(state.raw,receipt.deadline);return state.raw;
}

/** Exact original7/native-only restoration. This is never an operating inverse or old-unsafe-writer re-enable permission. */
export function buildAmoraWriterRetirementOriginalReplaySql(value) {
  keys(value,['repoRoot','receipt','expectedLocalSystemIdentifier','deadline']);
  const {repoRoot,receipt,expectedLocalSystemIdentifier,deadline}=value;
  const raw=readAmoraWriterRetirementRecoveryCapsule(receipt),p=plan(repoRoot);
  requireValue(typeof expectedLocalSystemIdentifier==='string'&&/^\d{10,32}$/.test(expectedLocalSystemIdentifier)
    &&expectedLocalSystemIdentifier!==SYSTEM&&deadline===receipt.deadline,'AMORA_WRITER_RECOVERY_LOCAL_DESTINATION_REQUIRED');
  const after=deriveFixedApplied7FromRepo(repoRoot),expectedAcl=amoraWriterRetirementOriginalCanonicalAcl();
  const expectedNewGuards=getAmoraWriterRetirementTargetMetadata({repoRoot,phase:'after'}).functions
    .filter(fn=>fn.identity.startsWith('public.guard_')).map(fn=>{
      const {expectedAcl,...rest}=fn;return {...rest,rawAcl:['postgres=X/postgres'],acl:expectedAcl};
    });
  const guardMetadataSql=`(SELECT jsonb_agg(fn-ARRAY['definition','definitionSha256'] ORDER BY fn->>'identity')
    FROM jsonb_array_elements(${amoraWriterRetirementGuardFunctionsSql()}) fn)`;
  const currentAcl={...expectedAcl,rawAcl:['postgres=arwdDxtm/postgres','service_role=ardDxtm/postgres','authenticated=r/postgres'],
    acl:expectedAcl.acl.filter(row=>!(row[0]==='service_role'&&row[2]==='UPDATE')),
    serviceUpdate:{table:false,anyColumn:false,columns:expectedAcl.serviceUpdate.columns.map(([name])=>[name,false])}};
  const json=value=>literal(JSON.stringify(value))+'::jsonb';
  const statements=[];
  for(const fn of raw.definitions) {
    statements.push(fn.definition,`ALTER FUNCTION ${fn.identity} OWNER TO postgres;`,
      `REVOKE ALL ON FUNCTION ${fn.identity} FROM PUBLIC,anon,authenticated,service_role;`);
    const roles=fn.acl.map(row=>row[0]).filter(role=>role!=='postgres');
    requireValue(roles.every(role=>['authenticated','service_role'].includes(role)),'AMORA_WRITER_RECOVERY_DEFINITION_INVALID');
    if(roles.length)statements.push(`GRANT EXECUTE ON FUNCTION ${fn.identity} TO ${roles.join(',')};`);
  }
  statements.push('GRANT UPDATE ON TABLE public.amora_actions TO service_role;',
    'DROP TRIGGER guard_amora_action_insert_identity_cutover_v1 ON public.amora_actions;',
    'DROP TRIGGER guard_amora_reserved_journey_direct_dml_retirement_v1 ON public.wedding_journeys;',
    'DROP FUNCTION public.guard_amora_action_insert_identity_cutover_v1();',
    'DROP FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1();');
  const tag='$hb_b2_restore_'+receipt.artifactSha256.slice(0,16)+'$';
  requireValue(statements.every(s=>!s.includes(tag)),'AMORA_WRITER_RECOVERY_DEFINITION_INVALID');
  const functions=amoraWriterRetirementOriginalFunctionsSql(),acl=amoraWriterRetirementCanonicalAclSql(),guards=amoraWriterRetirementGuardSlotsSql();
  const expectedGuards={functions:['public.guard_amora_action_insert_identity_cutover_v1()','public.guard_amora_reserved_journey_direct_dml_retirement_v1()'],
    triggers:[['public.amora_actions','guard_amora_action_insert_identity_cutover_v1'],['public.wedding_journeys','guard_amora_reserved_journey_direct_dml_retirement_v1']]};
  return `-- Owned loopback original7 + UPDATE ACL + exact guard2 cleanup; ledger retained. Not an operational rollback.
BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'; SET LOCAL search_path=pg_catalog,public;
SET LOCAL standard_conforming_strings=on;
DO ${tag} BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres' OR current_setting('server_version') !~ '^17[.]'
 OR (SELECT system_identifier::text FROM pg_control_system())<>${literal(expectedLocalSystemIdentifier)}
 OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR current_setting('listen_addresses')<>'127.0.0.1'
 THEN RAISE EXCEPTION 'AMORA_WRITER_RECOVERY_LOCAL_DESTINATION_REQUIRED'; END IF;
 IF clock_timestamp()>=${literal(deadline)}::timestamptz OR clock_timestamp()>=${literal(raw.capturedAt)}::timestamptz+interval '120 seconds'
 THEN RAISE EXCEPTION 'AMORA_WRITER_RECOVERY_EXPIRED'; END IF;
END ${tag};
LOCK TABLE public.profiles IN SHARE MODE; LOCK TABLE public.couples IN SHARE MODE;
LOCK TABLE public.wedding_journeys IN ACCESS EXCLUSIVE MODE; LOCK TABLE public.amora_actions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE hb_b2_replay_evidence(value jsonb) ON COMMIT DROP;
DO ${tag} DECLARE v_rows jsonb; v_catalog text; v_ledger text;
BEGIN
 IF ${functions} IS DISTINCT FROM ${json(after)} OR ${acl} IS DISTINCT FROM ${json(currentAcl)}
 OR ${guardMetadataSql} IS DISTINCT FROM ${json(expectedNewGuards)}
 OR ${guards} IS DISTINCT FROM ${json(expectedGuards)}
 THEN RAISE EXCEPTION 'AMORA_WRITER_RECOVERY_APPLIED_DRIFT'; END IF;
 IF (SELECT name=${literal(p.migration.name)} AND statements=ARRAY[${literal(p.migration.sql)}]::text[]
 FROM supabase_migrations.schema_migrations WHERE version=${literal(p.migration.version)}) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'AMORA_WRITER_RECOVERY_LEDGER_DRIFT'; END IF;
 v_rows:=${amoraWriterRetirementRowsSql()};v_catalog:=${amoraWriterRetirementPreservedCatalogSql()};v_ledger:=${amoraWriterRetirementRawLedgerShaSql()};
 ${statements.map(statement=>'EXECUTE '+literal(statement)+';').join('\n ')}
 IF ${functions} IS DISTINCT FROM ${json(raw.definitions)} OR ${acl} IS DISTINCT FROM ${json(raw.canonicalTable)}
 OR ${guards} IS DISTINCT FROM ${json({functions:[],triggers:[]})}
 OR ${amoraWriterRetirementRowsSql()} IS DISTINCT FROM v_rows OR ${amoraWriterRetirementPreservedCatalogSql()} IS DISTINCT FROM v_catalog
 OR ${amoraWriterRetirementRawLedgerShaSql()} IS DISTINCT FROM v_ledger
 THEN RAISE EXCEPTION 'AMORA_WRITER_RECOVERY_POST_DRIFT'; END IF;
 IF clock_timestamp()>=${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'AMORA_WRITER_RECOVERY_EXPIRED'; END IF;
 INSERT INTO pg_temp.hb_b2_replay_evidence VALUES(jsonb_build_object('format','amora-b2-original7-native-replay-v1',
 'scope','target-original7-update-acl-newguard2-replayed-ledger-retained','artifactSha256',${literal(receipt.artifactSha256)},
 'actualNativeSystemIdentifier',${literal(expectedLocalSystemIdentifier)},'rows',v_rows,'preservedCatalogSha256',v_catalog,
 'rawLedgerSha256',v_ledger,'restoredDefinitionsSha256',encode(sha256(convert_to((${functions})::text,'UTF8')),'hex'),
 'productionRecoveryAuthorized',false,'verifiedAt',clock_timestamp()));
END ${tag};
SELECT value AS b2_replay_evidence FROM pg_temp.hb_b2_replay_evidence; COMMIT;
`;
}
