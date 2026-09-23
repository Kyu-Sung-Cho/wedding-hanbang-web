import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadWeddingCodePairSessionHistoricalReleasePlan } from './wedding-code-pair-session-release-contract.mjs';

export const WEDDING_CODE_PAIR_SESSION_CONFLICT_CONTRACT_FILE = 'supabase/release-contracts/wedding-code-pair-session-conflict-v1.json';
const CONTRACT_SHA = "ba4a96b3dfc300fd9b4a7c5d12489af0ecb1d4d37f936b83286e7741633f5031";
const MIGRATION_FILE = '20260923132503_wedding_code_pair_session_conflict_response.sql';
export const WEDDING_CODE_PAIR_SESSION_CONFLICT_SCOPE = Object.freeze({
  changedFunctions: ['public.create_wedding_code_pair_session(uuid,text,text,text,text,bigint,boolean,boolean)',
    'public.join_wedding_code_pair_session(uuid,text,text,text,text,boolean,boolean)'],
  conflictSqlState: { from: '40001', to: 'PT409', occurrences: 3 },
  newTables: [], tableSchema: 'unchanged', tableRls: 'unchanged', tableAcl: 'unchanged', functionAcl: 'unchanged',
  otherFunctions: 'unchanged', cron: 'unchanged', existingData: 'unchanged', newRows: 'none', backfill: 'none',
  apiExternalResponse: '409-CONFLICT', rollback: 'disable-new-session-creation-preserve-revoke-and-expiry-cleanup',
});

// 238 원문은 그대로 보존한다. 이 계약은 업무 충돌의 오류 코드만 바꾸는 239 lane이다.
export function loadWeddingCodePairSessionConflictReleasePlan(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: WEDDING_CODE_PAIR_SESSION_CONFLICT_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'wedding-code-pair-session-conflict-static-successor'
    && contract.release === 'wedding-code-pair-session-conflict-20260923' && contract.status === 'requires-scoped-runtime-evidence'
    && contract.productionApplyImplemented === true && contract.runtimeEvidenceVerified === false, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_CONTRACT_INVALID');
  const predecessor = loadWeddingCodePairSessionHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: 'supabase/release-contracts/wedding-code-pair-session-v1.json', sha256: predecessor.contractSha256 }, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === predecessor.contract.projectRef && contract.systemIdentifier === predecessor.contract.systemIdentifier, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_DESTINATION_CHANGED');
  same(contract.scope, WEDDING_CODE_PAIR_SESSION_CONFLICT_SCOPE, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 238 && predecessor.migrationCount === 238
    && contract.migrations?.length === 1 && contract.migrations[0].file === MIGRATION_FILE, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_MIGRATION_SET_CHANGED');
  same(contract.predecessorMigration, { ...predecessor.contract.migrations[0], file: 'supabase/migrations/' + predecessor.contract.migrations[0].file }, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_PREDECESSOR_CHANGED');
  same(contract.predecessorCatalogFixture, predecessor.contract.catalogFixture, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_PREDECESSOR_CHANGED');
  for (const [key, file] of Object.entries({ runtime: 'scripts/lib/wedding-code-pair-session-conflict-release.mjs',
    catalog: 'scripts/lib/wedding-code-pair-session-conflict-catalog.mjs',
    catalogFixture: 'supabase/release-contracts/wedding-code-pair-session-conflict-pg17-catalog-v1.json' })) {
    requireRelease(contract[key]?.file === file, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_IMPLEMENTATION_CHANGED');
    pinnedArtifact(repoRoot, contract[key]);
  }
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(), reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  requireRelease(reviewed.length === 239 && reviewed.at(-1)?.file === MIGRATION_FILE, 'WEDDING_CODE_PAIR_SESSION_CONFLICT_MIGRATION_SET_CHANGED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: 'supabase/migrations/' + pin.file });
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: 'supabase/migrations/' + MIGRATION_FILE });
  requireRelease(!sql.includes(13) && sql.toString('utf8').startsWith('BEGIN;\n') && sql.toString('utf8').endsWith('COMMIT;\n'), 'WEDDING_CODE_PAIR_SESSION_CONFLICT_SQL_NOT_CANONICAL');
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    followupMigrations: [...predecessor.followupMigrations, { file: MIGRATION_FILE, version: '20260923132503' }],
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false };
}
