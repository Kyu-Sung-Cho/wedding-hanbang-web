import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/** 역사215의 statement preimage는 공개 fixture에 없다. 합성 원장 bytes를 명시적으로 사용한다. */
export async function seedSyntheticAmoraHistoryLedger(f,plan,repoRoot) {
  await f.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])');
  const followups=new Set(plan.expectedLedger.slice(215).map(row=>row.version));
  for(const row of plan.expectedLedger) {
    let statements=null;
    if(followups.has(row.version)) {
      const pin=plan.predecessorReviewedMigrations.find(pin=>pin.file.slice(0,14)===row.version);
      statements=[readFileSync(join(repoRoot,'supabase/migrations',pin.file),'utf8')];
    } else if(row.statementsSha256!==null) {
      statements=Array.from({length:row.version==='20260820100000'?8:1},(_,i)=>`SYNTHETIC-HISTORICAL-${row.version}-${i}`);
    }
    await f.db.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)',[row.version,row.name,statements]);
  }
}

/** 외부 검사 fixture만 역사215 SHA를 승인 metadata로 매핑한다. 실제 runtime이나 DB hash 함수는 바꾸지 않는다. */
export function mapSyntheticHistoricalLedgerMetadata(observation,plan) {
  const historical=new Map(plan.expectedLedger.slice(0,215).map(row=>[row.version,row]));
  return {...observation,ledger:observation.ledger.map(row=>historical.has(row.version)
    ?{...row,statementsSha256:historical.get(row.version).statementsSha256}:row)};
}
