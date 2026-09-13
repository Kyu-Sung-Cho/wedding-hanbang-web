import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadProfileAvatarHistoricalReleasePlan } from './profile-avatar-release-contract.mjs';

export const CUSTOMER_DATA_CONTRACT_FILE = 'supabase/release-contracts/account-deletion-customer-data-v1.json';
const CONTRACT_SHA = '129032ad576124bf54b68cb09747dd37999be089daa5c3ea5fa48303d1945187';
export const CUSTOMER_DATA_SCOPE = Object.freeze({
  newTables: ['public.account_deletion_private_scopes', 'public.account_deletion_retired_requests'],
  addedColumns: ['public.account_deletion_jobs.data_prepared_at', 'public.account_deletion_jobs.data_prepared_version'],
  addedConstraint: 'public.account_deletion_jobs.account_deletion_data_receipt_pair',
  newFunctions: ['public.guard_account_deletion_customer_write()', 'public.guard_account_deletion_membership_transition()',
    'public.prepare_account_deletion_customer_data(uuid,uuid)', 'public.guard_account_deletion_auth_boundary()'],
  replaceFunctions: ['public.prepare_account_deletion_auth_delete(uuid,uuid)', 'public.claim_amora_memory_job(integer,uuid)'],
  newTriggerCount: 13, existingCustomerData: 'unchanged', existingJobs: 'must-be-empty',
  storageObjects: 'unchanged', customerPurge: 'not-invoked', authDeletion: 'not-invoked',
  featureFlags: 'unchanged', fullOriginalRestore: 'not-proven',
});

export function loadCustomerDataReleasePlan(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: CUSTOMER_DATA_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'account-deletion-customer-data-static-successor'
    && contract.release === 'account-deletion-customer-data-20260913'
    && contract.status === 'requires-scoped-runtime-evidence' && contract.productionApplyImplemented === true
    && contract.runtimeEvidenceVerified === false, 'CUSTOMER_DATA_CONTRACT_INVALID');
  const predecessor = loadProfileAvatarHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: 'supabase/release-contracts/profile-avatar-v1.json', sha256: predecessor.contractSha256 },
    'CUSTOMER_DATA_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === predecessor.contract.projectRef && contract.systemIdentifier === predecessor.contract.systemIdentifier,
    'CUSTOMER_DATA_DESTINATION_CHANGED');
  same(contract.scope, CUSTOMER_DATA_SCOPE, 'CUSTOMER_DATA_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 231 && predecessor.migrationCount === 231
    && contract.migrations?.length === 1 && contract.migrations[0].file === '20260913103407_account_deletion_customer_data_boundary.sql',
    'CUSTOMER_DATA_MIGRATION_SET_CHANGED');
  same(contract.predecessorMigration, { ...predecessor.contract.migrations[0], file: `supabase/migrations/${predecessor.contract.migrations[0].file}` },
    'CUSTOMER_DATA_PREDECESSOR_CHANGED');
  for (const [key, file] of Object.entries({ runtime: 'scripts/lib/account-deletion-customer-data-release.mjs',
    catalog: 'scripts/lib/account-deletion-customer-data-catalog.mjs',
    catalogFixture: 'supabase/release-contracts/account-deletion-customer-data-pg17-catalog-v1.json',
    previousFunction: 'supabase/migrations/20260716113000_account_deletion_storage_saga.sql',
    previousClaimFunction: 'supabase/migrations/20260716094000_couple_roster_epoch.sql' })) {
    requireRelease(contract[key]?.file === file, 'CUSTOMER_DATA_IMPLEMENTATION_CHANGED');
    pinnedArtifact(repoRoot, contract[key]);
  }
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(), reviewed.map(pin => pin.file),
    'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${contract.migrations[0].file}` });
  requireRelease(!sql.includes(13) && sql.length > 0, 'CUSTOMER_DATA_SQL_NOT_CANONICAL');
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    followupMigrations: [...predecessor.followupMigrations, { file: contract.migrations[0].file, version: '20260913103407' }],
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false };
}
