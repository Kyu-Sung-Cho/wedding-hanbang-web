import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadWeddingCodePairSessionHistoricalReleasePlan } from './wedding-code-pair-session-release-contract.mjs';
import { WEDDING_CODE_PAIR_SESSION_CONFLICT_SCOPE } from './wedding-code-pair-session-conflict-release-contract.mjs';

export const DELETION_AUDIT_CONTRACT_FILE = 'supabase/release-contracts/account-deletion-audit-nullability-v1.json';
const CONTRACT_SHA = 'ad50817b53ee069e99b8dcd5b8b5856b5c9691a32d5dd1ff15daccb5a1c4d73a';
const PREDECESSOR = Object.freeze({ file: 'supabase/release-contracts/wedding-code-pair-session-conflict-v1.json',
  sha256: 'ba4a96b3dfc300fd9b4a7c5d12489af0ecb1d4d37f936b83286e7741633f5031' });
const PREDECESSOR_LOADER = Object.freeze({ file: 'scripts/lib/wedding-code-pair-session-conflict-release-contract.mjs',
  sha256: 'e74801f9c729e23d3cd76093ab0f5c8e45cd97964105f57eed642ad60cd523c5' });
const PREDECESSOR_MIGRATION = '20260923132503_wedding_code_pair_session_conflict_response.sql';
const MIGRATION_FILE = '20260928073546_account_deletion_anonymous_audit.sql';
export const DELETION_AUDIT_SCHEMA_CHANGE = 'column:public.account_deletions.user_id:attnotnull:true-to-false';
export const DELETION_AUDIT_SCOPE = Object.freeze({
  dataRows: 'unchanged', auth: 'unchanged', storage: 'unchanged', existingJobs: 'unchanged',
  functions: 'unchanged', tableAcl: 'unchanged', tableRls: 'unchanged', indexes: 'unchanged',
  triggers: 'unchanged', constraints: 'unchanged-except-target-not-null',
  target: { relation: 'public.account_deletions', column: 'user_id', type: 'uuid', default: null },
  rollback: 'transaction-rollback-before-commit-preserve-nullable-after-commit',
  fullOriginalRestore: 'not-proven',
});

// 공개 239 loader의 exact-directory 검사는 바꾸지 않는다. 고정된 전신 원문과
// 238 historical chain을 여기서 검증한 뒤 오직 239번째 SQL 하나만 연결한다.
function loadReviewedPredecessor(repoRoot) {
  pinnedArtifact(repoRoot, PREDECESSOR_LOADER);
  const bytes = pinnedArtifact(repoRoot, PREDECESSOR);
  const contract = JSON.parse(bytes);
  const parent = loadWeddingCodePairSessionHistoricalReleasePlan(repoRoot);
  requireRelease(contract.version === 1 && contract.kind === 'wedding-code-pair-session-conflict-static-successor'
    && contract.release === 'wedding-code-pair-session-conflict-20260923'
    && contract.status === 'requires-scoped-runtime-evidence' && contract.productionApplyImplemented === true
    && contract.runtimeEvidenceVerified === false, 'DELETION_AUDIT_PREDECESSOR_CHANGED');
  same(contract.predecessor, { file: 'supabase/release-contracts/wedding-code-pair-session-v1.json',
    sha256: parent.contractSha256 }, 'DELETION_AUDIT_PREDECESSOR_CHANGED');
  same(contract.scope, WEDDING_CODE_PAIR_SESSION_CONFLICT_SCOPE, 'DELETION_AUDIT_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === parent.contract.projectRef && contract.systemIdentifier === parent.contract.systemIdentifier
    && contract.reviewedPredecessorMigrationCount === 238 && parent.migrationCount === 238
    && contract.migrations?.length === 1 && contract.migrations[0].file === PREDECESSOR_MIGRATION,
  'DELETION_AUDIT_PREDECESSOR_CHANGED');
  same(contract.predecessorMigration, { ...parent.contract.migrations[0],
    file: `supabase/migrations/${parent.contract.migrations[0].file}` }, 'DELETION_AUDIT_PREDECESSOR_CHANGED');
  same(contract.predecessorCatalogFixture, parent.contract.catalogFixture, 'DELETION_AUDIT_PREDECESSOR_CHANGED');
  for (const [key, file] of Object.entries({ runtime: 'scripts/lib/wedding-code-pair-session-conflict-release.mjs',
    catalog: 'scripts/lib/wedding-code-pair-session-conflict-catalog.mjs',
    catalogFixture: 'supabase/release-contracts/wedding-code-pair-session-conflict-pg17-catalog-v1.json' })) {
    requireRelease(contract[key]?.file === file, 'DELETION_AUDIT_PREDECESSOR_CHANGED');
    pinnedArtifact(repoRoot, contract[key]);
  }
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${PREDECESSOR_MIGRATION}` });
  requireRelease(!sql.includes(13) && sql.toString('utf8').startsWith('BEGIN;\n')
    && sql.toString('utf8').endsWith('COMMIT;\n'), 'DELETION_AUDIT_PREDECESSOR_CHANGED');
  return { contract, migrationCount: 239, reviewedMigrations: [...parent.reviewedMigrations, ...contract.migrations],
    followupMigrations: [...parent.followupMigrations, { file: PREDECESSOR_MIGRATION, version: PREDECESSOR_MIGRATION.slice(0, 14) }] };
}

export function loadDeletionAuditNullabilityReleasePlan(repoRoot) { return loadPlan(repoRoot, true); }
// 후속 계약 전용이며 공개 240 경로의 목록 검사를 완화하지 않는다.
export function loadDeletionAuditNullabilityHistoricalReleasePlan(repoRoot) { return loadPlan(repoRoot, false); }

function loadPlan(repoRoot, checkCurrentDirectory) {
  const bytes = pinnedArtifact(repoRoot, { file: DELETION_AUDIT_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'account-deletion-audit-nullability-static-successor'
    && contract.release === 'account-deletion-audit-nullability-20260928'
    && contract.status === 'requires-scoped-runtime-evidence'
    && contract.productionApplyImplemented === true && contract.runtimeEvidenceVerified === false,
  'DELETION_AUDIT_CONTRACT_INVALID');
  same(contract.predecessor, PREDECESSOR, 'DELETION_AUDIT_PREDECESSOR_CHANGED');
  same(contract.predecessorLoader, PREDECESSOR_LOADER, 'DELETION_AUDIT_PREDECESSOR_CHANGED');
  const predecessor = loadReviewedPredecessor(repoRoot);
  requireRelease(contract.projectRef === predecessor.contract.projectRef
    && contract.systemIdentifier === predecessor.contract.systemIdentifier, 'DELETION_AUDIT_DESTINATION_CHANGED');
  same(contract.allowedSchemaChanges, [DELETION_AUDIT_SCHEMA_CHANGE], 'DELETION_AUDIT_SCOPE_CHANGED');
  same(contract.scope, DELETION_AUDIT_SCOPE, 'DELETION_AUDIT_SCOPE_CHANGED');
  requireRelease(contract.runtime?.file === 'scripts/lib/account-deletion-audit-nullability-release.mjs', 'DELETION_AUDIT_RUNTIME_CHANGED');
  pinnedArtifact(repoRoot, contract.runtime);
  requireRelease(contract.reviewedPredecessorMigrationCount === 239 && predecessor.migrationCount === 239
    && contract.migrations?.length === 1 && contract.migrations[0].file === MIGRATION_FILE, 'DELETION_AUDIT_MIGRATION_SET_CHANGED');
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  requireRelease(reviewed.length === 240 && reviewed.at(-1).file === MIGRATION_FILE, 'DELETION_AUDIT_MIGRATION_SET_CHANGED');
  if (checkCurrentDirectory) same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(),
    reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${MIGRATION_FILE}` });
  const text = sql.toString('utf8');
  requireRelease(!sql.includes(13) && /^(?:--[^\n]*\n)*BEGIN;\n/.test(text) && text.endsWith('COMMIT;\n')
    && /SET LOCAL lock_timeout = '5s';/.test(text) && /SET LOCAL statement_timeout = '30s';/.test(text)
    && /LOCK TABLE public\.account_deletions IN ACCESS EXCLUSIVE MODE;/.test(text)
    && text.match(/ALTER TABLE public\.account_deletions\s+ALTER COLUMN user_id DROP NOT NULL;/g)?.length === 1
    && !/\b(?:INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE|CREATE POLICY|GRANT|REVOKE)\b/i.test(text),
  'DELETION_AUDIT_SQL_SCOPE_CHANGED');
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length,
    reviewedMigrations: reviewed, followupMigrations: [...predecessor.followupMigrations,
      { file: MIGRATION_FILE, version: MIGRATION_FILE.slice(0, 14) }],
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false,
    releaseAuthorized: false, remoteWritesPerformed: false };
}
