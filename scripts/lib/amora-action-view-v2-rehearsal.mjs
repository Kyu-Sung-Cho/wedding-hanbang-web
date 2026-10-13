import {createHash} from 'node:crypto';
import {loadAmoraActionViewV2Plan} from './amora-action-view-v2-release-contract.mjs';
import {AMORA_VIEW_V2_READ_ONLY_OBSERVERS,amoraActionViewV2TargetSql,amoraActionViewV2PreservedDigestSql,amoraActionViewV2RowsSql} from './amora-action-view-v2-catalog.mjs';
import {requireRelease,same} from './current-baseline-release-contract.mjs';
import {validateAmoraActionViewV2OperatingLedger} from './amora-action-view-v2-ledger.mjs';

// 등록된 정식 version/name/원문을 사용하지만 이 렌더러의 원장은 예행 TX 안에서만 존재한다.
const MD5=/^[a-f0-9]{32}$/;
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const md5=value=>createHash('md5').update(value).digest('hex');
const ledgerDigest=excludeVersion=>`(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
 ORDER BY version)::text,'[]')) FROM supabase_migrations.schema_migrations${excludeVersion?` WHERE version<>${literal(excludeVersion)}`:''})`;

/** 항상 ROLLBACK인 순수 렌더러다. credential/transport/verified boolean/apply mode를 받지 않는다. */
export function buildAmoraActionViewV2RehearsalSql(options={}) {
  requireRelease(options&&typeof options==='object'&&!Array.isArray(options)
    &&Object.keys(options).every(key=>['repoRoot','before','expectedSystemIdentifier','deadline'].includes(key)),
  'AMORA_VIEW_V2_REHEARSAL_ARGUMENT_INVALID');
  const {repoRoot,before,deadline}=options;
  const plan=loadAmoraActionViewV2Plan(repoRoot);
  const expectedSystemIdentifier=options.expectedSystemIdentifier??plan.contract.systemIdentifier;
  const now=Date.now(),at=Date.parse(before?.observedAt),ends=Date.parse(deadline);
  requireRelease(typeof expectedSystemIdentifier==='string'&&/^\d{10,25}$/.test(expectedSystemIdentifier)
    &&before?.systemIdentifier===expectedSystemIdentifier&&before.database==='postgres'
    &&AMORA_VIEW_V2_READ_ONLY_OBSERVERS.includes(before.currentUser)
    &&before.readOnly===true&&before.format==='amora-action-view-v2-observation-v1'&&/^17\./.test(before.serverVersion??''),
  'AMORA_VIEW_V2_REHEARSAL_DESTINATION_INVALID');
  requireRelease(Number.isFinite(at)&&at<=now+10_000&&at>now-120_000
    &&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline??'')
    &&Number.isFinite(ends)&&ends>now&&ends<=now+120_000,'AMORA_VIEW_V2_REHEARSAL_EXPIRED');
  same(before.target,plan.catalogFixture.baseline,'AMORA_VIEW_V2_REHEARSAL_BASELINE_DRIFT');
  requireRelease(MD5.test(before.preservedCatalogMd5??'')&&MD5.test(before.ledgerMd5??'')
    &&before.rows&&['amoraActionsMd5','journeysMd5'].every(key=>MD5.test(before.rows[key]??''))
    &&['amoraActionsCount','journeysCount'].every(key=>Number.isSafeInteger(before.rows[key])&&before.rows[key]>=0)
    &&Array.isArray(before.ledger),'AMORA_VIEW_V2_REHEARSAL_OBSERVATION_INVALID');
  validateAmoraActionViewV2OperatingLedger(before.ledger,plan,repoRoot);
  const source=plan.sql;
  const {version,name}=plan.migration;
  const body=source.replace(/^([\s\S]*?)BEGIN;\s*/,'$1').replace(/COMMIT;\s*$/,'');
  requireRelease(body!==source&&!/\bCOMMIT\s*;/i.test(body),'AMORA_VIEW_V2_REHEARSAL_ENVELOPE_INVALID');
  const target=amoraActionViewV2TargetSql(),preserved=amoraActionViewV2PreservedDigestSql(),rows=amoraActionViewV2RowsSql();
  return `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
SELECT pg_advisory_xact_lock(61012,2);
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.amora_actions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.wedding_journeys IN SHARE MODE;
DO $amora_view_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system())<>${literal(expectedSystemIdentifier)}
 OR current_database()<>'postgres' OR current_user<>'postgres'
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'AMORA_VIEW_V2_REHEARSAL_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz
 OR clock_timestamp()>${literal(before.observedAt)}::timestamptz+interval '120 seconds'
 OR ${literal(deadline)}::timestamptz>clock_timestamp()+interval '120 seconds'
 THEN RAISE EXCEPTION 'AMORA_VIEW_V2_REHEARSAL_DEADLINE_EXPIRED'; END IF;
 IF ${target} IS DISTINCT FROM ${literal(JSON.stringify(before.target))}::jsonb
 OR ${preserved} IS DISTINCT FROM ${literal(before.preservedCatalogMd5)}
 OR ${rows} IS DISTINCT FROM ${literal(JSON.stringify(before.rows))}::jsonb
 OR ${ledgerDigest()} IS DISTINCT FROM ${literal(before.ledgerMd5)}
 THEN RAISE EXCEPTION 'AMORA_VIEW_V2_REHEARSAL_BASELINE_DRIFT'; END IF;
END $amora_view_before$;
${body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES(${literal(version)},${literal(name)},ARRAY[${literal(source)}]::text[]);
DO $amora_view_after$ BEGIN
 IF ${target} IS DISTINCT FROM ${literal(JSON.stringify(plan.catalogFixture.applied))}::jsonb
 OR ${preserved} IS DISTINCT FROM ${literal(before.preservedCatalogMd5)}
 OR ${rows} IS DISTINCT FROM ${literal(JSON.stringify(before.rows))}::jsonb
 OR ${ledgerDigest(version)} IS DISTINCT FROM ${literal(before.ledgerMd5)}
 OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${literal(version)}
   AND name=${literal(name)} AND cardinality(statements)=1 AND statements[1]=${literal(source)}
   AND md5(statements[1])=${literal(md5(source))})
 THEN RAISE EXCEPTION 'AMORA_VIEW_V2_REHEARSAL_POST_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'AMORA_VIEW_V2_REHEARSAL_DEADLINE_EXPIRED'; END IF;
END $amora_view_after$;
SELECT jsonb_build_object('format','amora-action-view-v2-synthetic-rehearsal-inside-v1',
 'version',${literal(version)},'target',${target},
 'ledgerEntry',(SELECT jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),
   'sqlMd5',md5(statements[1]),'statementsSha256',
     pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(statements)::text,'UTF8')),'hex'))
     FROM supabase_migrations.schema_migrations WHERE version=${literal(version)}),
 'rawSqlMatches',(SELECT statements[1]=${literal(source)} FROM supabase_migrations.schema_migrations
   WHERE version=${literal(version)})) AS rehearsal_evidence;
ROLLBACK;`;
}
