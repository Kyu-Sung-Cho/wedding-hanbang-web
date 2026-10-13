import {copyFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pinnedArtifact,requireRelease} from '../../lib/current-baseline-release-contract.mjs';
import {DELETION_AUDIT_CONTRACT_FILE,loadDeletionAuditNullabilityHistoricalReleasePlan,
  loadDeletionAuditNullabilityReleasePlan} from '../../lib/account-deletion-audit-nullability-release-contract.mjs';
import {createWeddingCodePairSessionHistoricalRepository} from './wedding-code-pair-session-historical-repository.mjs';

// 검수된238 역사 fixture에 고정239/240만 추가한다. 현행241을 걸러 public loader를 우회하는 운영 코드가 아니다.
export function createDeletionAuditHistoricalRepository(sourceRoot) {
  const plan=loadDeletionAuditNullabilityHistoricalReleasePlan(sourceRoot);
  const fixture=createWeddingCodePairSessionHistoricalRepository(sourceRoot);
  try {
    const preceding=JSON.parse(pinnedArtifact(sourceRoot,plan.contract.predecessor));
    const pins=[plan.contract.predecessor,plan.contract.predecessorLoader,plan.contract.runtime,
      preceding.runtime,preceding.catalog,preceding.catalogFixture,preceding.predecessorMigration,
      ...[plan.contract,preceding].flatMap(contract=>contract.migrations.map(pin=>({...pin,file:`supabase/migrations/${pin.file}`})))];
    for(const pin of pins) pinnedArtifact(sourceRoot,pin);
    const files=[DELETION_AUDIT_CONTRACT_FILE,'scripts/lib/account-deletion-audit-nullability-release-contract.mjs',
      'scripts/supabase-release-fence.mjs',...pins.map(pin=>pin.file)];
    for(const file of new Set(files)) {
      mkdirSync(dirname(join(fixture.root,file)),{recursive:true});
      copyFileSync(join(sourceRoot,file),join(fixture.root,file));
    }
    requireRelease(loadDeletionAuditNullabilityReleasePlan(fixture.root).migrationCount===240,
      'DELETION_AUDIT_HISTORICAL_FIXTURE_INVALID');
    return fixture;
  } catch(error){fixture.cleanup();throw error;}
}
