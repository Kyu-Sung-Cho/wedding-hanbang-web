import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest,pinnedArtifact,requireRelease,same } from './current-baseline-release-contract.mjs';
import { loadProfileWeddingRolesHistoricalReleasePlan } from './profile-wedding-roles-release-contract.mjs';
export const PROFILE_AVATAR_CONTRACT_FILE='supabase/release-contracts/profile-avatar-v1.json';
const CONTRACT_SHA='a8602464739c85dabce2f2a01ec667f6525709db11caa1a2d5f4cf2c790e7a1e';
export const PROFILE_AVATAR_SCOPE=Object.freeze({newTables:['public.profile_avatars','public.profile_avatar_assets'],
  newFunctions:['public.register_profile_avatar_asset(uuid,uuid)','public.save_profile_avatar(uuid,text,text,uuid,uuid)','public.read_profile_avatar_snapshot(uuid)'],
  replaceFunction:'public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)',
  widenConstraints:['public.account_deletion_media_manifest.account_deletion_media_bucket','public.account_deletion_media_manifest.account_deletion_media_source'],
  newPrivateBucket:'profile-avatars',newRestrictivePolicy:'storage.objects.profile_avatar_service_only',
  existingData:'unchanged',authUsers:'unchanged',coupleSlots:'unchanged',roleSettings:'unchanged',backfill:'none'});
export function loadProfileAvatarReleasePlan(repoRoot) {
  const bytes=pinnedArtifact(repoRoot,{file:PROFILE_AVATAR_CONTRACT_FILE,sha256:CONTRACT_SHA}),contract=JSON.parse(bytes);
  requireRelease(contract.version===1&&contract.kind==='profile-avatar-static-successor'&&contract.release==='profile-avatar-20260913'
    &&contract.status==='requires-scoped-runtime-evidence'&&contract.productionApplyImplemented===true&&contract.runtimeEvidenceVerified===false,'PROFILE_AVATAR_CONTRACT_INVALID');
  const predecessor=loadProfileWeddingRolesHistoricalReleasePlan(repoRoot);
  same(contract.predecessor,{file:'supabase/release-contracts/profile-wedding-roles-v1.json',sha256:predecessor.contractSha256},'PROFILE_AVATAR_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef===predecessor.contract.projectRef&&contract.systemIdentifier===predecessor.contract.systemIdentifier,'PROFILE_AVATAR_DESTINATION_CHANGED');
  same(contract.scope,PROFILE_AVATAR_SCOPE,'PROFILE_AVATAR_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount===230&&predecessor.migrationCount===230&&contract.migrations?.length===1
    &&contract.migrations[0].file==='20260913082314_private_profile_avatars_delivery.sql','PROFILE_AVATAR_MIGRATION_SET_CHANGED');
  same(contract.predecessorMigration,{...predecessor.contract.migrations[0],file:`supabase/migrations/${predecessor.contract.migrations[0].file}`},'PROFILE_AVATAR_PREDECESSOR_CHANGED');
  for(const [key,file] of Object.entries({runtime:'scripts/lib/profile-avatar-release.mjs',catalog:'scripts/lib/profile-avatar-catalog.mjs',
    catalogFixture:'supabase/release-contracts/profile-avatar-pg17-catalog-v1.json',platformPolicy:'supabase/platform-operations/storage/profile-avatar-delivery-service-only.sql',
    historicalPolicy:'supabase/platform-operations/storage/profile-avatar-service-only.sql',
    previousManifest:'supabase/migrations/20260716113000_account_deletion_storage_saga.sql'})) {
    requireRelease(contract[key]?.file===file,'PROFILE_AVATAR_IMPLEMENTATION_CHANGED');pinnedArtifact(repoRoot,contract[key]);
  }
  const reviewed=[...predecessor.reviewedMigrations,...contract.migrations].sort((a,b)=>a.file.localeCompare(b.file));
  same(readdirSync(join(repoRoot,'supabase/migrations')).filter(file=>/\.sql$/i.test(file)).sort(),reviewed.map(pin=>pin.file),'NEW_MIGRATION_NOT_REVIEWED');
  for(const pin of reviewed)pinnedArtifact(repoRoot,{...pin,file:`supabase/migrations/${pin.file}`});
  const sql=pinnedArtifact(repoRoot,{...contract.migrations[0],file:`supabase/migrations/${contract.migrations[0].file}`});
  requireRelease(!sql.includes(13),'PROFILE_AVATAR_SQL_NOT_CANONICAL');
  return {contract,contractSha256:digest(bytes),migrationSha256:digest(sql),migrationCount:reviewed.length,reviewedMigrations:reviewed,
    followupMigrations:[...predecessor.followupMigrations,{file:contract.migrations[0].file,version:'20260913082314'}],
    staticVerified:true,productionApplyImplemented:true,runtimeEvidenceVerified:false,releaseAuthorized:false,remoteWritesPerformed:false};
}
