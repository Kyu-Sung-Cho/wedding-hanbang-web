import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadChatFeedbackHistoricalReleasePlan } from './chat-feedback-nullability-release-contract.mjs';

export const PROFILE_WEDDING_ROLES_CONTRACT_FILE = 'supabase/release-contracts/profile-wedding-roles-v1.json';
const CONTRACT_SHA = '5a10fb62c847c64776d3e64214b4038c042427b325649735bc9963077a4b3b71';
export const PROFILE_WEDDING_ROLES_SCOPE = Object.freeze({
  newTable: 'public.profile_wedding_roles',
  newFunctions: ['public.save_profile_wedding_role(uuid,text,uuid)', 'public.read_profile_wedding_roles(uuid)'],
  existingData: 'unchanged', authUsers: 'unchanged', coupleSlots: 'unchanged', storage: 'unchanged',
  roleInference: 'none',
});

export function loadProfileWeddingRolesReleasePlan(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: PROFILE_WEDDING_ROLES_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'profile-wedding-roles-static-successor'
    && contract.release === 'profile-wedding-roles-20260913' && contract.status === 'requires-scoped-runtime-evidence'
    && contract.productionApplyImplemented === true && contract.runtimeEvidenceVerified === false,
  'PROFILE_ROLE_CONTRACT_INVALID');
  const predecessor = loadChatFeedbackHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: 'supabase/release-contracts/chat-feedback-nullability-v1.json',
    sha256: predecessor.contractSha256 }, 'PROFILE_ROLE_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === predecessor.contract.projectRef
    && contract.systemIdentifier === predecessor.contract.systemIdentifier, 'PROFILE_ROLE_DESTINATION_CHANGED');
  same(contract.scope, PROFILE_WEDDING_ROLES_SCOPE, 'PROFILE_ROLE_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 229 && predecessor.migrationCount === 229
    && contract.migrations?.length === 1
    && contract.migrations[0].file === '20260913075045_profile_wedding_roles.sql', 'PROFILE_ROLE_MIGRATION_SET_CHANGED');
  for (const [key, file] of Object.entries({ runtime: 'scripts/lib/profile-wedding-roles-release.mjs',
    catalog: 'scripts/lib/profile-wedding-roles-catalog.mjs' })) {
    requireRelease(contract[key]?.file === file, 'PROFILE_ROLE_IMPLEMENTATION_CHANGED');
    pinnedArtifact(repoRoot, contract[key]);
  }
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(),
    reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${contract.migrations[0].file}` });
  requireRelease(!sql.includes(13), 'PROFILE_ROLE_SQL_NOT_CANONICAL');
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length,
    followupMigrations: [...predecessor.followupMigrations, { file: contract.migrations[0].file, version: '20260913075045' }],
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false,
    releaseAuthorized: false, remoteWritesPerformed: false };
}
