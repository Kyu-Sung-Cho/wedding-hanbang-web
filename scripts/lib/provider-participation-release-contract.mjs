import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadDeletionAuditNullabilityHistoricalReleasePlan } from './account-deletion-audit-nullability-release-contract.mjs';

export const PROVIDER_RELEASE_CONTRACT_FILE = 'supabase/release-contracts/provider-participation-v1.json';
const CONTRACT_SHA = '40271847492f47ebb8bb9c232cbe44404fb1b006e7bf9a7185f58dc6d285c31f';
const MIGRATIONS = Object.freeze(['20260928135517_provider_participation_self_publishing.sql',
  '20260928140701_provider_portfolio_account_deletion.sql', '20260928142123_provider_media_cleanup.sql']);
export const PROVIDER_RELEASE_SCOPE = Object.freeze({
  newTables: ['public.business_inquiries', 'public.provider_applications', 'public.provider_audit_events', 'public.provider_media', 'public.provider_offerings', 'public.provider_profiles'],
  newPrivateSchema: 'provider_private', newPrivateBucket: 'provider-portfolio',
  newRestrictivePolicy: 'storage.objects.provider_portfolio_service_only',
  replaceFunction: 'public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
  widenConstraints: ['public.account_deletion_media_manifest.account_deletion_media_bucket', 'public.account_deletion_media_manifest.account_deletion_media_path_shape', 'public.account_deletion_media_manifest.account_deletion_media_source'],
  existingData: 'unchanged', authUsers: 'unchanged', existingStorageBytes: 'unchanged',
  defaultPrivileges: 'unchanged', roleSettings: 'unchanged',
  rollback: 'transaction-rollback-before-commit; after-commit-hold-fences-suspend-and-forward-fix',
  backupRestore: 'not-proven', productionApply: 'not-implemented',
});

export function loadProviderParticipationReleasePlan(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: PROVIDER_RELEASE_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'provider-participation-static-successor'
    && contract.release === 'provider-participation-20260929' && contract.status === 'blocked-pending-operational-evidence'
    && contract.productionApplyImplemented === false && contract.runtimeEvidenceVerified === false,
  'PROVIDER_RELEASE_CONTRACT_INVALID');
  const predecessor = loadDeletionAuditNullabilityHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: 'supabase/release-contracts/account-deletion-audit-nullability-v1.json', sha256: predecessor.contractSha256 }, 'PROVIDER_RELEASE_PREDECESSOR_CHANGED');
  requireRelease(contract.predecessorLoader?.file === 'scripts/lib/account-deletion-audit-nullability-release-contract.mjs', 'PROVIDER_RELEASE_PREDECESSOR_CHANGED');
  pinnedArtifact(repoRoot, contract.predecessorLoader);
  requireRelease(contract.projectRef === predecessor.contract.projectRef && contract.systemIdentifier === predecessor.contract.systemIdentifier,
    'PROVIDER_RELEASE_DESTINATION_CHANGED');
  same(contract.scope, PROVIDER_RELEASE_SCOPE, 'PROVIDER_RELEASE_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 240 && predecessor.migrationCount === 240, 'PROVIDER_RELEASE_PREDECESSOR_CHANGED');
  same(contract.migrations?.map(pin => pin.file), MIGRATIONS, 'PROVIDER_RELEASE_MIGRATION_SET_CHANGED');
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(), reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  for (const [key, file] of Object.entries({ runtime: 'scripts/lib/provider-participation-release.mjs',
    catalog: 'scripts/lib/provider-participation-catalog.mjs', catalogFixture: 'supabase/release-contracts/provider-participation-pg17-catalog-v1.json',
    platformPolicy: 'supabase/platform-operations/storage/20260928135517_provider_portfolio_service_fence.sql',
    observation: 'supabase/release-checks/provider-participation-observation.sql',
    localFixture: 'scripts/tests/fixtures/provider-release-native-database.mjs',
    nativeFactory: 'scripts/tests/fixtures/profile-role-native-database.mjs', cli: 'scripts/provider-participation-release.mjs',
    previousManifest: 'supabase/migrations/20260913082314_private_profile_avatars_delivery.sql' })) {
    requireRelease(contract[key]?.file === file, 'PROVIDER_RELEASE_IMPLEMENTATION_CHANGED'); pinnedArtifact(repoRoot, contract[key]);
  }
  return { contract, contractSha256: digest(bytes), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    predecessorMigrations: predecessor.reviewedMigrations, staticVerified: true, productionApplyImplemented: false,
    runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false };
}
