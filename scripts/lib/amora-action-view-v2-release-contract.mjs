import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {digest,pinnedArtifact,requireRelease,same} from './current-baseline-release-contract.mjs';
import {loadDeletionAuditNullabilityHistoricalReleasePlan} from './account-deletion-audit-nullability-release-contract.mjs';
import {validateAmoraActionViewV2CatalogFixture} from './amora-action-view-v2-catalog.mjs';
import {AMORA_VIEW_V2_OPERATING_LEDGER,deriveAmoraActionViewV2ExpectedLedger} from './amora-action-view-v2-ledger.mjs';

export const AMORA_VIEW_V2_MODE = '--amora-action-view-v2';
export const AMORA_VIEW_V2_CONTRACT_FILE = 'supabase/release-contracts/amora-action-view-v2-v1.json';
const CONTRACT_SHA = '1c5f50e114c969cd52a6e5a605d8a3e7b0476966182c6775a5650f196dda5ccb';
const PREDECESSOR = Object.freeze({file:'supabase/release-contracts/account-deletion-audit-nullability-v1.json',
  sha256:'ad50817b53ee069e99b8dcd5b8b5856b5c9691a32d5dd1ff15daccb5a1c4d73a'});
const PREDECESSOR_LOADER = Object.freeze({file:'scripts/lib/account-deletion-audit-nullability-release-contract.mjs',
  sha256:'0434dc864d0b3c2a9e254648239fdb4f115e0890bc91a30816cec6f5f86c607e'});
const CANDIDATE = Object.freeze({file:'supabase/release-candidates/amora-action-view-v2/patch_own_amora_action_view_v2.sql',
  sha256:'e31372d192a0215d4ddf280a99abb628e7a8f732ebc02cb0b7e55fed1373730d'});
const MIGRATION = Object.freeze({file:'20261012002000_amora_action_view_v2.sql',
  sha256:'d8dc07b1e3543bc4530ea9dd3ecd616d4108b7f8739663a4e0237168e9ddc7f3'});
const CATALOG_FIXTURE = Object.freeze({file:'supabase/release-contracts/amora-action-view-v2-pg17-catalog-v1.json',
  sha256:'6eea8aa27b30487adfe4d51314e0155881233a5a991109a52f5bdb1a40a34227'});
const SCOPE = Object.freeze({newFunctions:['public.advance_amora_action_view_token_v2()',
  'public.patch_own_amora_action_view_v2(uuid,text,text,jsonb)'],
  replacedTrigger:'public.amora_actions:set_amora_actions_updated_at',dataRows:'unchanged',
  existingFunctions:'unchanged',existingTableAclRls:'unchanged',auth:'unchanged',storage:'unchanged',
  oldWriterRetirement:'not-included',hold241242:'preserved-not-applied',
  rollback:'rollback-before-commit-forward-fix-after-commit'});

/** 기존240 strict loader/원문은 바꾸지 않는다. 새 lane도 미검수 migration을 거절한다. */
export function loadAmoraActionViewV2Plan(repoRoot) {
  const bytes = pinnedArtifact(repoRoot,{file:AMORA_VIEW_V2_CONTRACT_FILE,sha256:CONTRACT_SHA});
  const contract = JSON.parse(bytes);
  requireRelease(contract.version===1&&contract.kind==='amora-action-view-v2-draft-additive'
    &&contract.release==='amora-action-view-v2-20261012'&&contract.status==='draft-local-rehearsal-not-authorized'
    &&contract.productionApplyImplemented===false&&contract.runtimeEvidenceVerified===false,
  'AMORA_VIEW_V2_CONTRACT_INVALID');
  same(contract.predecessor,PREDECESSOR,'AMORA_VIEW_V2_PREDECESSOR_CHANGED');
  same(contract.predecessorLoader,PREDECESSOR_LOADER,'AMORA_VIEW_V2_PREDECESSOR_CHANGED');
  pinnedArtifact(repoRoot,PREDECESSOR_LOADER);
  pinnedArtifact(repoRoot,PREDECESSOR);
  const predecessor = loadDeletionAuditNullabilityHistoricalReleasePlan(repoRoot);
  requireRelease(predecessor.migrationCount===240&&contract.reviewedPredecessorMigrationCount===240,
    'AMORA_VIEW_V2_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef===predecessor.contract.projectRef
    &&contract.systemIdentifier===predecessor.contract.systemIdentifier,'AMORA_VIEW_V2_DESTINATION_CHANGED');
  same(contract.operatingLedger,AMORA_VIEW_V2_OPERATING_LEDGER,'AMORA_VIEW_V2_LEDGER_HISTORY_CHANGED');
  const expectedLedger=deriveAmoraActionViewV2ExpectedLedger(repoRoot,predecessor,contract.systemIdentifier);
  same(contract.migrations,[MIGRATION],'AMORA_VIEW_V2_MIGRATION_CHANGED');
  requireRelease(contract.candidateProvenance==='first-comment-only-all-remaining-bytes-identical',
    'AMORA_VIEW_V2_PROVENANCE_CHANGED');
  const reviewedMigrations=[...predecessor.reviewedMigrations,MIGRATION].sort((a,b)=>a.file.localeCompare(b.file));
  requireRelease(reviewedMigrations.length===241&&reviewedMigrations.at(-1).file===MIGRATION.file,
    'AMORA_VIEW_V2_MIGRATION_CHANGED');
  same(readdirSync(join(repoRoot,'supabase/migrations')).filter(file=>/\.sql$/i.test(file)).sort(),
    reviewedMigrations.map(pin=>pin.file).sort(),'AMORA_VIEW_V2_NEW_MIGRATION_NOT_REVIEWED');
  same(contract.candidate,CANDIDATE,'AMORA_VIEW_V2_CANDIDATE_CHANGED');
  same(contract.scope,SCOPE,'AMORA_VIEW_V2_SCOPE_CHANGED');
  const candidateSql = pinnedArtifact(repoRoot,CANDIDATE).toString('utf8');
  const sql=pinnedArtifact(repoRoot,{...MIGRATION,file:`supabase/migrations/${MIGRATION.file}`}).toString('utf8');
  requireRelease(candidateSql.startsWith('-- 로컬 초안 후보다. 마이그레이션이나 승인된 운영 릴리스가 아니다.\n')
    &&sql.startsWith('-- 정식 마이그레이션 검수 후보다. 운영에 적용되거나 승인된 릴리스가 아니다.\n')
    &&sql.slice(sql.indexOf('\n')+1)===candidateSql.slice(candidateSql.indexOf('\n')+1),
    'AMORA_VIEW_V2_PROVENANCE_CHANGED');
  requireRelease(!sql.includes('\r')&&/^(?:--[^\n]*\n)*BEGIN;\n/.test(sql)&&sql.endsWith('COMMIT;\n'),
    'AMORA_VIEW_V2_SQL_ENVELOPE_INVALID');
  same(contract.catalogFixture,CATALOG_FIXTURE,'AMORA_VIEW_V2_CATALOG_FIXTURE_CHANGED');
  const fixtureBytes=pinnedArtifact(repoRoot,CATALOG_FIXTURE);
  const catalogFixture=validateAmoraActionViewV2CatalogFixture(JSON.parse(fixtureBytes),candidateSql,CANDIDATE.sha256);
  return {contract,contractSha256:digest(bytes),sql,sqlSha256:MIGRATION.sha256,candidateSha256:CANDIDATE.sha256,
    migration:{...MIGRATION,version:MIGRATION.file.slice(0,14),name:MIGRATION.file.slice(15,-4)},
    catalogFixture,catalogFixtureSha256:CATALOG_FIXTURE.sha256,
    predecessorMigrationCount:predecessor.migrationCount,predecessorReviewedMigrations:predecessor.reviewedMigrations,
    migrationCount:reviewedMigrations.length,reviewedMigrations,expectedLedger,
    releaseAuthorized:false,productionApplyImplemented:false,runtimeEvidenceVerified:false,remoteWritesPerformed:false};
}
