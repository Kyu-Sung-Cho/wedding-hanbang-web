import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {digest,pinnedArtifact,requireRelease,same} from './current-baseline-release-contract.mjs';

export const AMORA_VIEW_V2_OPERATING_LEDGER=Object.freeze({baseline:Object.freeze({
  file:'supabase/release-contracts/amora-budget-decision-effective-baseline-20260911.json',
  sha256:'527b8429377a9f13f16f8dfcf64f66d8fd73a3ea4c9588cc2cd498364932db4a'}),
  reviewedFollowupCount:14,expectedRowCount:229,historicalNullStatementsCount:64});

// 원장 원문은 소스 발견 목록이 아니다. 기존 historical240 chain이 이 baseline의 승인 계보를 검증한다.
export function deriveAmoraActionViewV2ExpectedLedger(repoRoot,predecessor,systemIdentifier) {
  const baseline=JSON.parse(pinnedArtifact(repoRoot,AMORA_VIEW_V2_OPERATING_LEDGER.baseline));
  requireRelease(baseline.format==='current-baseline-observation-v1'&&baseline.readOnly===true
    &&baseline.systemIdentifier===systemIdentifier&&baseline.ledger?.length===215
    &&baseline.ledger.filter(row=>row.statementsSha256===null).length===64
    &&predecessor.migrationCount===240&&predecessor.followupMigrations?.length===14,
  'AMORA_VIEW_V2_LEDGER_HISTORY_INVALID');
  const followup=predecessor.followupMigrations.map(row=>{
    const pin=predecessor.reviewedMigrations.find(pin=>pin.file===row.file);
    requireRelease(pin&&row.version===row.file.slice(0,14),'AMORA_VIEW_V2_LEDGER_HISTORY_INVALID');
    const sql=pinnedArtifact(repoRoot,{...pin,file:join('supabase/migrations',row.file).replaceAll('\\','/')}).toString('utf8');
    return {version:row.version,name:row.file.slice(15,-4),statementsSha256:digest(JSON.stringify([sql]))};
  });
  const expected=[...baseline.ledger.map(row=>({version:row.version,name:row.name,statementsSha256:row.statementsSha256})),
    ...followup].sort((a,b)=>a.version.localeCompare(b.version));
  requireRelease(expected.length===229&&new Set(expected.map(row=>row.version)).size===229
    &&expected.at(-1).version==='20260928073546','AMORA_VIEW_V2_LEDGER_HISTORY_INVALID');
  same(expected.find(row=>row.version==='20260820100000'),{version:'20260820100000',name:'community_report_privacy_reason',
    statementsSha256:'ed3cb091dd70adda95662fe53bffa9566681c6edaa003284953b874aafb28c4a'},
  'AMORA_VIEW_V2_LEDGER_HISTORY_INVALID');
  return expected;
}

/** 값/원문 SHA는 승인 역사와 exact 비교한다. 역사 NULL을 임의 새 예외로 확장하지 않는다. */
export function validateAmoraActionViewV2OperatingLedger(rows,plan,repoRoot) {
  requireRelease(Array.isArray(rows),'AMORA_VIEW_V2_LEDGER_INVALID');
  for(const row of rows) {
    same(Object.keys(row??{}).sort(),['version','name','statementCount','sqlMd5','statementsSha256'].sort(),
      'AMORA_VIEW_V2_OBSERVATION_INVALID');
    requireRelease(/^\d{14}$/.test(row.version??'')&&typeof row.name==='string'&&/^[a-z0-9_]+$/.test(row.name)
      &&(row.statementCount===null||Number.isSafeInteger(row.statementCount)&&row.statementCount>=0)
      &&(row.sqlMd5===null||/^[a-f0-9]{32}$/.test(row.sqlMd5??''))
      &&(row.statementsSha256===null||/^[a-f0-9]{64}$/.test(row.statementsSha256??'')),
    'AMORA_VIEW_V2_LEDGER_INVALID');
    if(row.statementsSha256===null) requireRelease(row.statementCount===null&&row.sqlMd5===null,
      'AMORA_VIEW_V2_LEDGER_INVALID');
    else requireRelease(row.statementCount!==null,'AMORA_VIEW_V2_LEDGER_INVALID');
  }
  const sorted=[...rows].sort((a,b)=>a.version.localeCompare(b.version));
  same(sorted.map(row=>({version:row.version,name:row.name})),
    plan.expectedLedger.map(row=>({version:row.version,name:row.name})),'AMORA_VIEW_V2_LEDGER_VERSION_DRIFT');
  same(sorted.map(row=>({version:row.version,name:row.name,statementsSha256:row.statementsSha256})),
    plan.expectedLedger,'AMORA_VIEW_V2_LEDGER_STATEMENTS_DRIFT');
  for(const row of plan.expectedLedger.slice(215)) {
    const actual=sorted.find(item=>item.version===row.version);
    const pin=plan.predecessorReviewedMigrations.find(pin=>pin.file.slice(0,14)===row.version);
    const firstMd5=createHash('md5').update(readFileSync(join(repoRoot,'supabase/migrations',pin.file))).digest('hex');
    requireRelease(actual.statementCount===1&&actual.sqlMd5===firstMd5,'AMORA_VIEW_V2_LEDGER_FOLLOWUP_DRIFT');
  }
  return rows;
}
