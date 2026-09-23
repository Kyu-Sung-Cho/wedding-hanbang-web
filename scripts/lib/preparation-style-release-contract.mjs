import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadWeddingCodeSceneV10HistoricalReleasePlan } from './wedding-code-research-scene-v10-release-contract.mjs';

export const PREPARATION_STYLE_CONTRACT_FILE = 'supabase/release-contracts/preparation-style-v1.json';
const CONTRACT_SHA = 'dd80bc6417c8344b1ef5d0b1bb3b60b0edd91bab5f5d7d44bbb231e57b88b48c';
const MIGRATION_FILE = '20260920120000_wedding_preparation_style.sql';
export const PREPARATION_STYLE_SCOPE = Object.freeze({
  newTables: ['public.wedding_preparation_style_responses', 'public.wedding_preparation_style_shares'],
  newSequence: 'public.wedding_preparation_style_revision_seq',
  authenticatedFunctions: ['public.get_own_wedding_preparation_style()', 'public.set_own_wedding_preparation_style(bigint,text,text,text)',
    'public.clear_own_wedding_preparation_style(bigint)', 'public.share_own_wedding_preparation_style(bigint,uuid,uuid,text)', 'public.unshare_own_wedding_preparation_style(bigint)'],
  internalFunctions: ['public.wedding_preparation_style_actor()', 'public.purge_wedding_preparation_style_for_account_deletion()', 'public.revoke_wedding_preparation_style_for_membership()'],
  newTriggers: ['public.account_deletion_jobs.trg_wedding_preparation_style_account_deletion',
    'public.profiles.trg_wedding_preparation_style_profile_membership', 'public.couples.trg_wedding_preparation_style_couple_membership'],
  tableAccess: 'owner-only-force-rls-no-client-policies', sequenceAccess: 'owner-only',
  existingFunctions: 'unchanged', existingData: 'unchanged', newRows: 'none', backfill: 'none',
  requiredDependency: 'public.is_current_couple_member(uuid,uuid):reviewed-definition-and-acl',
  rollback: 'disable-hub-writes-preserve-saved-rows-and-revocation-triggers',
});

// 정적 원문·연쇄 핀만 검증한다. 운영 적용이나 런타임 증거 승인이 아니다.
export function loadPreparationStyleReleasePlan(repoRoot) {
  return loadPlan(repoRoot, true);
}

// 후속 계약이 선행 237개 원문을 검증할 때만 사용한다. 운영 실행기는 계속 strict loader를 쓴다.
export function loadPreparationStyleHistoricalReleasePlan(repoRoot) {
  return loadPlan(repoRoot, false);
}

function loadPlan(repoRoot, checkCurrentDirectory) {
  const bytes=pinnedArtifact(repoRoot,{file:PREPARATION_STYLE_CONTRACT_FILE,sha256:CONTRACT_SHA});
  const contract=JSON.parse(bytes);
  requireRelease(contract.version===1&&contract.kind==='preparation-style-static-successor'&&contract.release==='preparation-style-20260920'
    &&contract.status==='requires-scoped-runtime-evidence'&&contract.productionApplyImplemented===true&&contract.runtimeEvidenceVerified===false,'PREPARATION_STYLE_CONTRACT_INVALID');
  const predecessor=loadWeddingCodeSceneV10HistoricalReleasePlan(repoRoot);
  same(contract.predecessor,{file:'supabase/release-contracts/wedding-code-research-scene-v10-v1.json',sha256:predecessor.contractSha256},'PREPARATION_STYLE_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef===predecessor.contract.projectRef&&contract.systemIdentifier===predecessor.contract.systemIdentifier,'PREPARATION_STYLE_DESTINATION_CHANGED');
  same(contract.scope,PREPARATION_STYLE_SCOPE,'PREPARATION_STYLE_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount===236&&predecessor.migrationCount===236&&contract.migrations?.length===1
    &&contract.migrations[0].file===MIGRATION_FILE,'PREPARATION_STYLE_MIGRATION_SET_CHANGED');
  same(contract.predecessorMigration,{...predecessor.contract.migrations[0],file:`supabase/migrations/${predecessor.contract.migrations[0].file}`},'PREPARATION_STYLE_PREDECESSOR_CHANGED');
  for (const [key,file] of Object.entries({runtime:'scripts/lib/preparation-style-release.mjs',catalog:'scripts/lib/preparation-style-catalog.mjs',
    catalogFixture:'supabase/release-contracts/preparation-style-pg17-catalog-v1.json'})) {
    requireRelease(contract[key]?.file===file,'PREPARATION_STYLE_IMPLEMENTATION_CHANGED');pinnedArtifact(repoRoot,contract[key]);
  }
  const reviewed=[...predecessor.reviewedMigrations,...contract.migrations].sort((a,b)=>a.file.localeCompare(b.file));
  const dependencyFile='20260716114000_current_couple_membership_privacy_fence.sql';
  same(contract.dependencyMigration,{file:`supabase/migrations/${dependencyFile}`,sha256:reviewed.find(pin=>pin.file===dependencyFile)?.sha256},'PREPARATION_STYLE_DEPENDENCY_CHANGED');
  if (checkCurrentDirectory) same(readdirSync(join(repoRoot,'supabase/migrations')).filter(file=>/\.sql$/i.test(file)).sort(),reviewed.map(pin=>pin.file),'NEW_MIGRATION_NOT_REVIEWED');
  for(const pin of reviewed) pinnedArtifact(repoRoot,{...pin,file:`supabase/migrations/${pin.file}`});
  const sql=pinnedArtifact(repoRoot,{...contract.migrations[0],file:`supabase/migrations/${MIGRATION_FILE}`});
  requireRelease(!sql.includes(13)&&sql.toString('utf8').startsWith('BEGIN;\n')&&sql.toString('utf8').endsWith('COMMIT;\n'),'PREPARATION_STYLE_SQL_NOT_CANONICAL');
  return {contract,contractSha256:digest(bytes),migrationSha256:digest(sql),migrationCount:reviewed.length,reviewedMigrations:reviewed,
    followupMigrations:[...predecessor.followupMigrations,{file:MIGRATION_FILE,version:'20260920120000'}],
    staticVerified:true,productionApplyImplemented:true,runtimeEvidenceVerified:false,releaseAuthorized:false,remoteWritesPerformed:false};
}
