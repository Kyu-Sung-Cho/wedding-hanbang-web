import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadPreparationStyleHistoricalReleasePlan } from './preparation-style-release-contract.mjs';

export const AMORA_DECISION_PRIVACY_CANDIDATE = 'supabase/release-contracts/amora-decision-privacy-candidate-v1.json';
const CONTRACT_SHA = 'f1c518a0144ea14c91cb76da135a1099ade1d2bf28ccb4321b69feff3e9c91ef';
const FILES = [
  "20260921100000_amora_approved_decision_records.sql",
  "20260921101000_privacy_confirmation_targets.sql"
];
const SCOPE = {
  "changedFunctions": [
    "public.amora_shared_action_policy(text,jsonb)",
    "public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)",
    "public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid)",
    "public.claim_amora_tool_execution(uuid,text,text,text,text,integer,uuid,integer)",
    "public.clear_amora_memory_scope(uuid,text,uuid)",
    "public.enforce_amora_shared_action_execution()",
    "public.reset_current_couple_membership()",
    "public.set_amora_memory_consent(uuid,text,uuid,boolean)"
  ],
  "addedFunctions": [
    "public.apply_amora_atomic_tool_execution_pre_decision_record(uuid,text,text,integer,text,jsonb,jsonb,jsonb)",
    "public.claim_amora_tool_execution_pre_decision_record(uuid,text,text,text,text,integer,uuid)",
    "public.lock_privacy_confirmation_target(uuid,uuid,bigint,text)",
    "public.mutate_amora_memory_with_confirmation(uuid,uuid,bigint,text,text,boolean)",
    "public.reset_current_couple_membership(uuid,uuid,bigint)",
    "public.reset_current_couple_membership_pre_confirmation()"
  ],
  "tableDdl": "unchanged",
  "existingRows": "no-backfill",
  "legacyReset": "rejected-without-confirmation",
  "legacyMemoryPrimitives": "owner-only",
  "rollback": "keep-privacy-fences-and-data-forward-fix-compatible-server"
};
const REQUIREMENTS = [
  "clean-reviewed-commit",
  "exact-production-destination-and-ledger",
  "global-web-api-auth-db-storage-write-fence",
  "database-and-storage-original-backup",
  "isolated-restore-verification",
  "hosted-two-account-rls-and-concurrency",
  "exact-before-after-function-catalog-and-unaffected-object-preservation",
  "transactional-rehearsal-rollback-and-independent-readback",
  "old-client-recovery-and-compatible-server-rollback",
  "finalizer-and-production-canary"
];

// 이 함수는 후보의 원문만 검증한다. 운영 DB 실행·출시 인가 경로가 아니다.
export function loadAmoraDecisionPrivacyCandidate(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: AMORA_DECISION_PRIVACY_CANDIDATE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'amora-decision-privacy-candidate'
    && contract.release === 'amora-decision-privacy-20260921' && contract.status === 'deployment-blocked'
    && contract.productionApplyImplemented === false && contract.runtimeEvidenceVerified === false,
  'AMORA_DECISION_PRIVACY_CANDIDATE_INVALID');
  const predecessor = loadPreparationStyleHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: 'supabase/release-contracts/preparation-style-v1.json',
    sha256: predecessor.contractSha256 }, 'AMORA_DECISION_PRIVACY_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === predecessor.contract.projectRef
    && contract.systemIdentifier === predecessor.contract.systemIdentifier
    && contract.reviewedPredecessorMigrationCount === 237 && predecessor.migrationCount === 237,
  'AMORA_DECISION_PRIVACY_DESTINATION_CHANGED');
  same(contract.scope, SCOPE, 'AMORA_DECISION_PRIVACY_SCOPE_CHANGED');
  same(contract.requiredRuntimeEvidence, REQUIREMENTS, 'AMORA_DECISION_PRIVACY_EVIDENCE_CONTRACT_CHANGED');
  same(contract.migrations?.map(pin => pin.file), FILES, 'AMORA_DECISION_PRIVACY_MIGRATION_SET_CHANGED');
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations];
  const versions = reviewed.map(pin => /^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/.exec(pin.file)?.[1]);
  requireRelease(versions.every((version, index) => version && (index === 0 || versions[index - 1] < version)),
    'AMORA_DECISION_PRIVACY_MIGRATION_ORDER_INVALID');
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(),
    reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of contract.migrations) {
    const sql = pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
    requireRelease(!sql.includes(13) && sql.toString('utf8').trimEnd().endsWith('COMMIT;'),
      'AMORA_DECISION_PRIVACY_SQL_NOT_CANONICAL');
  }
  return { contract, contractSha256: digest(bytes), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    staticVerified: true, productionApplyImplemented: false, runtimeEvidenceVerified: false,
    releaseAuthorized: false, remoteWritesPerformed: false };
}
