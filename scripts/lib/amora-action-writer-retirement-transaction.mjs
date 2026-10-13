import {createHash} from 'node:crypto';
import {requireRelease,same} from './current-baseline-release-contract.mjs';
import {loadAmoraWriterRetirementPlan,AMORA_WRITER_RETIREMENT_MODE} from './amora-action-writer-retirement-release-contract.mjs';
import {validateAmoraWriterRetirementObservation} from './amora-action-writer-retirement-catalog.mjs';
import {deriveFixedOriginal7FromRepo,deriveFixedApplied7FromRepo} from './amora-action-writer-retirement-original-source.mjs';
import {getAmoraWriterRetirementTargetMetadata} from './amora-action-writer-retirement-privileges.mjs';
import {amoraWriterRetirementOriginalCanonicalAcl} from './amora-action-writer-retirement-recovery.mjs';
import {validateAmoraWriterRetirementStageObservation} from './amora-action-writer-retirement-stage.mjs';
import {AMORA_WRITER_MAINTENANCE_BINDING} from './amora-action-writer-retirement-maintenance.mjs';
import {amoraWriterRetirementOriginalFunctionsSql,amoraWriterRetirementGuardFunctionsSql,
  amoraWriterRetirementCanonicalAclSql,amoraWriterRetirementGuardSlotsSql,amoraWriterRetirementPreservedCatalogSql,
  amoraWriterRetirementRowsSql,amoraWriterRetirementRawLedgerShaSql,amoraWriterRetirementRawLedgerMd5Sql} from './amora-action-writer-retirement-state.mjs';

const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const digest=(value,algorithm='sha256')=>createHash(algorithm).update(value).digest('hex');
const keys=(value,names)=>requireRelease(value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===names.slice().sort().join(','),'AMORA_WRITER_TRANSACTION_ARGUMENT_INVALID');
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));

function guardMetadata(repoRoot){
  const target=getAmoraWriterRetirementTargetMetadata({repoRoot,phase:'after'});
  return target.functions.filter(fn=>fn.identity.includes('.guard_amora_')).map(fn=>{
    const {expectedAcl,...metadata}=fn;return {...metadata,acl:expectedAcl};
  }).sort((a,b)=>a.identity.localeCompare(b.identity));
}
function normalizedGuardsSql(){
  return `(SELECT coalesce(jsonb_agg(value-'definition'-'definitionSha256'-'rawAcl' ORDER BY value->>'identity'),'[]'::jsonb)
    FROM jsonb_array_elements(${amoraWriterRetirementGuardFunctionsSql()}) AS item(value))`;
}
function originalBeforeGuard({repoRoot,before,system,deadline,fullCatalogHash}){
  const original=deriveFixedOriginal7FromRepo(repoRoot),acl=amoraWriterRetirementOriginalCanonicalAcl();
  return `DO $amora_writer_before$ BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_database()<>'postgres'
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM ${literal(system)}
 THEN RAISE EXCEPTION 'AMORA_WRITER_TRANSACTION_DESTINATION_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz
 OR clock_timestamp()>${literal(before.privileges.observedAt)}::timestamptz+interval '120 seconds'
 OR ${literal(deadline)}::timestamptz>clock_timestamp()+interval '120 seconds'
 THEN RAISE EXCEPTION 'AMORA_WRITER_TRANSACTION_DEADLINE_EXPIRED'; END IF;
 IF ${amoraWriterRetirementOriginalFunctionsSql()} IS DISTINCT FROM ${literal(JSON.stringify(original))}::jsonb
 OR ${amoraWriterRetirementCanonicalAclSql()} IS DISTINCT FROM ${literal(JSON.stringify(acl))}::jsonb
 OR ${amoraWriterRetirementGuardSlotsSql()} IS DISTINCT FROM '{"functions":[],"triggers":[]}'::jsonb
 OR ${amoraWriterRetirementPreservedCatalogSql()} IS DISTINCT FROM ${literal(fullCatalogHash)}
 OR ${amoraWriterRetirementRowsSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.rows))}::jsonb
 OR ${amoraWriterRetirementRawLedgerShaSql()} IS DISTINCT FROM ${literal(before.rawLedgerSha256)}
 OR ${amoraWriterRetirementRawLedgerMd5Sql()} IS DISTINCT FROM ${literal(before.rawLedgerMd5)}
 THEN RAISE EXCEPTION 'AMORA_WRITER_TRANSACTION_BASELINE_DRIFT'; END IF;
END $amora_writer_before$;`;
}

/** Always ROLLBACK. Content inputs cannot issue operating authority or supply SQL/clock/callback. */
export function buildAmoraWriterRetirementRehearsalSql(input){
  keys(input,['repoRoot','before','deadline','expectedNativeSystemIdentifier']);
  return renderTransaction(input,{fullCatalogHash:input.before?.preservedCatalogSha256,lifetimeGuard:''});
}
function renderTransaction(input,{fullCatalogHash,lifetimeGuard,commit=false}){
  const {repoRoot,before,deadline,expectedNativeSystemIdentifier}=input;
  const plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  validateAmoraWriterRetirementObservation(before,{repoRoot,phase:'before',expectedNativeSystemIdentifier,beforeObservation:null});
  const system=expectedNativeSystemIdentifier??plan.contract.systemIdentifier;
  requireRelease(time(deadline)&&Date.parse(deadline)>Date.now()&&Date.parse(deadline)<=Date.now()+120_000,
    'AMORA_WRITER_TRANSACTION_EXPIRED');
  requireRelease(typeof system==='string'&&/^\d{1,20}$/.test(system)&&before.privileges.systemIdentifier===system,
    'AMORA_WRITER_TRANSACTION_DESTINATION_INVALID');
  const source=plan.migration.sql;
  const match=/^((?:--[^\n]*\n)*)BEGIN;\n([\s\S]*)COMMIT;\n$/.exec(source);
  requireRelease(match,'AMORA_WRITER_TRANSACTION_ENVELOPE_INVALID');
  const body=match[1]+match[2],after=deriveFixedApplied7FromRepo(repoRoot),guards=guardMetadata(repoRoot);
  requireRelease(guards.length===2,'AMORA_WRITER_TRANSACTION_GUARDS_INVALID');
  const expectedSlots={functions:guards.map(fn=>fn.identity),triggers:[
    ['public.amora_actions','guard_amora_action_insert_identity_cutover_v1'],
    ['public.wedding_journeys','guard_amora_reserved_journey_direct_dml_retirement_v1']]};
  const ledgerBeforeWithoutNew=amoraWriterRetirementRawLedgerShaSql().replace('FROM supabase_migrations.schema_migrations)',
    `FROM supabase_migrations.schema_migrations WHERE version<>${literal(plan.migration.version)})`);
  requireRelease(ledgerBeforeWithoutNew!==amoraWriterRetirementRawLedgerShaSql(),'AMORA_WRITER_TRANSACTION_LEDGER_SQL_INVALID');
  return `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
SELECT pg_advisory_xact_lock(61013,3);
LOCK TABLE public.profiles,public.couples IN SHARE MODE;
LOCK TABLE public.wedding_journeys,public.amora_actions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
${lifetimeGuard}
${originalBeforeGuard({repoRoot,before,system,deadline,fullCatalogHash})}
${body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(plan.migration.version)},${literal(plan.migration.name)},ARRAY[${literal(source)}]::text[]);
DO $amora_writer_after$ BEGIN
 IF ${amoraWriterRetirementOriginalFunctionsSql()} IS DISTINCT FROM ${literal(JSON.stringify(after))}::jsonb
 OR ${normalizedGuardsSql()} IS DISTINCT FROM ${literal(JSON.stringify(guards))}::jsonb
 OR ${amoraWriterRetirementGuardSlotsSql()} IS DISTINCT FROM ${literal(JSON.stringify(expectedSlots))}::jsonb
 OR has_table_privilege('service_role','public.amora_actions','UPDATE')
 OR has_any_column_privilege('service_role','public.amora_actions','UPDATE')
 OR ${amoraWriterRetirementPreservedCatalogSql()} IS DISTINCT FROM ${literal(fullCatalogHash)}
 OR ${amoraWriterRetirementRowsSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.rows))}::jsonb
 OR ${ledgerBeforeWithoutNew} IS DISTINCT FROM ${literal(before.rawLedgerSha256)}
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${literal(plan.migration.version)}
   AND name=${literal(plan.migration.name)} AND cardinality(statements)=1 AND statements[1]=${literal(source)})
 THEN RAISE EXCEPTION 'AMORA_WRITER_TRANSACTION_POST_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'AMORA_WRITER_TRANSACTION_DEADLINE_EXPIRED'; END IF;
END $amora_writer_after$;
SELECT jsonb_build_object('format','amora-writer-retirement-original7-${commit?'commit':'rehearsal'}-inside-v1',
 'version',${literal(plan.migration.version)},'bundleSha256',${literal(plan.migration.sha256)},
 'original7AppliedSha256',${literal(digest(JSON.stringify(after)))},
 'rows',${amoraWriterRetirementRowsSql()},'preservedCatalogSha256',${amoraWriterRetirementPreservedCatalogSql()},
 'rawLedgerSha256',${amoraWriterRetirementRawLedgerShaSql()},'rawLedgerMd5',${amoraWriterRetirementRawLedgerMd5Sql()},
 'newLedgerRow',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),
 'sqlMd5',md5(statements[1]),'statementsSha256',encode(sha256(convert_to(to_jsonb(statements)::text,'UTF8')),'hex'))
 FROM supabase_migrations.schema_migrations WHERE version=${literal(plan.migration.version)})) AS b2_${commit?'commit':'rehearsal'}_evidence;
${commit?'COMMIT':'ROLLBACK'};`;
}

function maintenanceLifetimeGuard(objectIds){
  keys(objectIds,['functionId','triggerIds']);
  requireRelease(Number.isSafeInteger(objectIds.functionId)&&objectIds.functionId>0&&Array.isArray(objectIds.triggerIds)
    &&objectIds.triggerIds.length===2&&objectIds.triggerIds.every(id=>Number.isSafeInteger(id)&&id>0)
    &&new Set([objectIds.functionId,...objectIds.triggerIds]).size===3,'AMORA_WRITER_TRANSACTION_MAINTENANCE_INVALID');
  const binding=AMORA_WRITER_MAINTENANCE_BINDING;
  return `DO $amora_writer_maintenance_lifetime$ BEGIN
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='deny_amora_action_writer_retirement_maintenance_v1')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=${objectIds.functionId}::oid
   AND p.oid=to_regprocedure(${literal(binding.functionIdentity)}) AND pg_get_userbyid(p.proowner)='postgres'
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=${literal(binding.functionBodySha256)}
   AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=${literal(binding.functionDefinitionSha256)}
   AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.prokind='f'
   AND p.pronargs=0 AND p.pronargdefaults=0 AND NOT p.proisstrict AND p.provolatile='v' AND p.proparallel='u'
   AND p.procost=100 AND p.prorows=0 AND NOT p.proleakproof AND NOT p.proretset AND p.prosupport=0)
 ${binding.triggerNames.map((name,index)=>`OR NOT EXISTS(SELECT 1 FROM pg_trigger t
   WHERE t.oid=${objectIds.triggerIds[index]}::oid AND t.tgname=${literal(name)}
   AND t.tgrelid='public.${['amora_actions','wedding_journeys'][index]}'::regclass
   AND t.tgfoid=${objectIds.functionId}::oid AND t.tgtype=30 AND t.tgenabled='O' AND NOT t.tgisinternal
   AND t.tgqual IS NULL AND encode(t.tgargs,'hex')='' AND t.tgattr::text='' AND t.tgconstraint=0
   AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL)`).join('\n')}
 THEN RAISE EXCEPTION 'AMORA_WRITER_TRANSACTION_MAINTENANCE_LIFETIME_DRIFT'; END IF;
END $amora_writer_maintenance_lifetime$;`;
}

/** Fixed pure COMMIT renderer. Stage JSON is content only; genuine runtime lineage is required before sending. */
export function buildAmoraWriterRetirementCommitSql(input){
  keys(input,['repoRoot','before','stageRows','objectIds','deadline','expectedNativeSystemIdentifier']);
  const stage=validateAmoraWriterRetirementStageObservation(input.stageRows,{repoRoot:input.repoRoot,phase:'before',cutoff:null,
    expectedNativeSystemIdentifier:input.expectedNativeSystemIdentifier,beforeObservation:input.before,expectedObjectIds:input.objectIds});
  const sql=renderTransaction({repoRoot:input.repoRoot,before:stage.catalog,deadline:input.deadline,
    expectedNativeSystemIdentifier:input.expectedNativeSystemIdentifier},
    {fullCatalogHash:stage.rawPreservedCatalogSha256,lifetimeGuard:maintenanceLifetimeGuard(stage.objectIds),commit:true});
  requireRelease(sql.endsWith('\nCOMMIT;'),'AMORA_WRITER_TRANSACTION_ENVELOPE_INVALID');
  return sql;
}

export function validateAmoraWriterRetirementRehearsalInside(rows,{repoRoot,before}){
  return validateInside(rows,{repoRoot,before},'rehearsal');
}
export function validateAmoraWriterRetirementCommitInside(rows,{repoRoot,before}){
  return validateInside(rows,{repoRoot,before},'commit');
}
function validateInside(rows,{repoRoot,before},mode){
  const alias=`b2_${mode}_evidence`;
  requireRelease(Array.isArray(rows)&&rows.length===1&&rows[0]&&Object.keys(rows[0]).join(',')===alias,'AMORA_WRITER_REHEARSAL_INSIDE_INVALID');
  const value=rows[0][alias],plan=loadAmoraWriterRetirementPlan({repoRoot,mode:AMORA_WRITER_RETIREMENT_MODE});
  keys(value,['format','version','bundleSha256','original7AppliedSha256','rows','preservedCatalogSha256','rawLedgerSha256','rawLedgerMd5','newLedgerRow']);
  requireRelease(value.format===`amora-writer-retirement-original7-${mode}-inside-v1`
    &&value.version===plan.migration.version&&value.bundleSha256===plan.migration.sha256
    &&value.original7AppliedSha256===digest(JSON.stringify(deriveFixedApplied7FromRepo(repoRoot)))
    &&typeof value.rawLedgerSha256==='string'&&/^[a-f0-9]{64}$/.test(value.rawLedgerSha256)
    &&typeof value.rawLedgerMd5==='string'&&/^[a-f0-9]{32}$/.test(value.rawLedgerMd5),'AMORA_WRITER_REHEARSAL_INSIDE_INVALID');
  same(value.rows,before.rows,'AMORA_WRITER_REHEARSAL_INSIDE_INVALID');
  same(value.preservedCatalogSha256,before.preservedCatalogSha256,'AMORA_WRITER_REHEARSAL_INSIDE_INVALID');
  same(value.newLedgerRow,{version:plan.migration.version,name:plan.migration.name,statementCount:1,
    sqlMd5:digest(plan.migration.sql,'md5'),statementsSha256:plan.migration.statementsSha256},'AMORA_WRITER_REHEARSAL_INSIDE_INVALID');
  return Object.freeze({status:mode==='commit'?'inside-commit-only-not-independent-postverify':'inside-rehearsal-only-not-independent-rollback',insideSha256:digest(JSON.stringify(value)),
    releaseAuthorized:false,independentRollbackVerified:false,remoteWritesPerformed:false});
}
