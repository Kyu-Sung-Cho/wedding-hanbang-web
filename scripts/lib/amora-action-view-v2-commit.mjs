import {createHash} from 'node:crypto';
import {digest,requireRelease,same} from './current-baseline-release-contract.mjs';
import {loadAmoraActionViewV2Plan} from './amora-action-view-v2-release-contract.mjs';
import {buildAmoraActionViewV2ObservationSql,validateAmoraActionViewV2Inspection} from './amora-action-view-v2-catalog.mjs';
import {buildAmoraActionViewV2RehearsalSql} from './amora-action-view-v2-rehearsal.mjs';
import {analyzeReadOnlySqlEnvelope} from './sql-read-only-envelope.mjs';

const VERSION='20261012002000';
const md5=text=>createHash('md5').update(text).digest('hex');
const argumentKeys=(args,allowed)=>requireRelease(args&&typeof args==='object'&&!Array.isArray(args)
  &&Object.keys(args).every(key=>allowed.includes(key)),'AMORA_VIEW_V2_COMMIT_ARGUMENT_INVALID');

/** 고정된 검수 bundle만 생성한다. credential/transport/승인 인자를 받거나 적용하지 않는다. */
export function buildAmoraActionViewV2CommitSql(args) {
  argumentKeys(args,['repoRoot','before','deadline','expectedSystemIdentifier']);
  const rollback=buildAmoraActionViewV2RehearsalSql(args);
  // 원장에 인용된 원문 COMMIT은 명령이 아니다. 기존 lexer로 인용문 밖의 TX 구조만 검사한다.
  const lexicalEnvelope=rollback.replace(/^BEGIN;/,'BEGIN TRANSACTION READ ONLY;');
  requireRelease(rollback.startsWith('BEGIN;')&&rollback.endsWith('\nROLLBACK;')
    &&analyzeReadOnlySqlEnvelope(lexicalEnvelope).ok,'AMORA_VIEW_V2_COMMIT_ENVELOPE_INVALID');
  return rollback.slice(0,-'ROLLBACK;'.length)+'COMMIT;';
}

/** 별도 읽기 전용 조회에서 신규 원장 외의 원문 digest까지 다시 확인한다. */
export function buildAmoraActionViewV2AppliedObservationSql() {
  const original=buildAmoraActionViewV2ObservationSql();
  const start=original.indexOf(" SELECT jsonb_build_object('format'");
  const end=original.lastIndexOf(' AS observation; COMMIT;');
  requireRelease(start>0&&end>start&&original.endsWith(' AS observation; COMMIT;'),
    'AMORA_VIEW_V2_COMMIT_OBSERVER_ENVELOPE_INVALID');
  return original.slice(0,start)+`\nWITH amora_applied AS (${original.slice(start,end)} AS observation)
SELECT observation||jsonb_build_object('predecessorLedgerMd5',
  (SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
    ORDER BY version)::text,'[]')) FROM supabase_migrations.schema_migrations WHERE version<>'${VERSION}'))
  AS observation FROM amora_applied;
COMMIT;`;
}

/** 정합한 실제 관찰을 판정할 뿐, JSON 입력이나 내부 SELECT를 배포 승인으로 승격하지 않는다. */
export function validateAmoraActionViewV2AppliedObservation(args) {
  argumentKeys(args,['repoRoot','before','after','deadline','expectedSystemIdentifier']);
  const {repoRoot,before,after,deadline}=args;
  const plan=loadAmoraActionViewV2Plan(repoRoot),now=new Date();
  const expectedSystemIdentifier=args.expectedSystemIdentifier??plan.contract.systemIdentifier;
  const nativeOnly=expectedSystemIdentifier!==plan.contract.systemIdentifier;
  requireRelease(typeof expectedSystemIdentifier==='string'&&/^\d{10,25}$/.test(expectedSystemIdentifier),
    'AMORA_VIEW_V2_COMMIT_DESTINATION_INVALID');
  // 로컬 테스트의 기대값만 실제 로컬 ID를 받는다. 관찰된 ID를 운영 ID로 바꾸지 않는다.
  const inspectionPlan=nativeOnly?{...plan,contract:{...plan.contract,systemIdentifier:expectedSystemIdentifier}}:plan;
  validateAmoraActionViewV2Inspection(before,{plan:inspectionPlan,repoRoot,now});
  same(Object.keys(after??{}).sort(),[...Object.keys(before),'predecessorLedgerMd5'].sort(),
    'AMORA_VIEW_V2_COMMIT_POST_INVALID');
  requireRelease(after.systemIdentifier===expectedSystemIdentifier&&Array.isArray(after.ledger)
    &&after.ledger.length===230&&typeof after.ledgerMd5==='string'&&/^[a-f0-9]{32}$/.test(after.ledgerMd5),
  'AMORA_VIEW_V2_COMMIT_POST_INVALID');
  const added=after.ledger.filter(row=>row.version===VERSION),old=after.ledger.filter(row=>row.version!==VERSION);
  same(added,[{version:plan.migration.version,name:plan.migration.name,statementCount:1,
    sqlMd5:md5(plan.sql),statementsSha256:digest(JSON.stringify([plan.sql]))}],
  'AMORA_VIEW_V2_COMMIT_LEDGER_DRIFT');
  same(old,before.ledger,'AMORA_VIEW_V2_COMMIT_LEDGER_DRIFT');
  same(after.predecessorLedgerMd5,before.ledgerMd5,'AMORA_VIEW_V2_COMMIT_RAW_LEDGER_DRIFT');
  same(after.target,plan.catalogFixture.applied,'AMORA_VIEW_V2_COMMIT_CATALOG_DRIFT');
  same(after.rows,before.rows,'AMORA_VIEW_V2_COMMIT_ROWS_DRIFT');
  same(after.preservedCatalogMd5,before.preservedCatalogMd5,'AMORA_VIEW_V2_COMMIT_PRESERVATION_DRIFT');
  const {predecessorLedgerMd5,...post}=after;
  // 동일 observer의 identity/freshness/shape와 predecessor229를 별도로 검사한다.
  validateAmoraActionViewV2Inspection({...post,target:before.target,ledger:old,ledgerMd5:predecessorLedgerMd5},
    {plan:inspectionPlan,repoRoot,now});
  const at=Date.parse(after.observedAt),ends=Date.parse(deadline);
  requireRelease(Number.isFinite(ends)&&at>=Date.parse(before.observedAt)&&at<=ends
    &&now.getTime()<=ends,'AMORA_VIEW_V2_COMMIT_POST_EXPIRED');
  return Object.freeze({status:'applied-observed-exact-state-not-release-authorized',nativeOnly,
    projectRef:plan.contract.projectRef,systemIdentifier:after.systemIdentifier,migrationVersion:VERSION,
    ledgerCount:230,releaseAuthorized:false,remoteWritesPerformed:false});
}
