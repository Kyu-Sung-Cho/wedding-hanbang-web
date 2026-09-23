import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadPreparationStyleHistoricalReleasePlan } from './preparation-style-release-contract.mjs';

export const WEDDING_CODE_PAIR_SESSION_CONTRACT_FILE = 'supabase/release-contracts/wedding-code-pair-session-v1.json';
const CONTRACT_SHA = 'f479973b0dbc583981159a687c9d207d25bd21273cd01c41e03672299f73c5e7';
const MIGRATION_FILE = '20260923104336_wedding_code_pair_sessions.sql';
export const WEDDING_CODE_PAIR_SESSION_SCOPE = Object.freeze({
  newTables: ['public.wedding_code_pair_sessions'],
  serviceFunctions: ['public.create_wedding_code_pair_session(uuid,text,text,text,text,bigint,boolean,boolean)', 'public.read_wedding_code_pair_session(uuid,text)',
    'public.join_wedding_code_pair_session(uuid,text,text,text,text,boolean,boolean)', 'public.revoke_wedding_code_pair_session(uuid,text)'],
  internalFunctions: ['public.purge_expired_wedding_code_pair_sessions()'],
  cron: { name: 'wedding-code-pair-session-purge', schedule: '17 3 * * *', command: 'SELECT public.purge_expired_wedding_code_pair_sessions();',
    database: 'postgres', username: 'postgres', active: true, destination: 'local-current-port', existingJobs: 'unchanged' },
  tableAccess: 'owner-only-force-rls-no-client-policies',
  sceneVersion: 'v3.1-preferences', snapshots: 'immutable', consentVersion: '2026-09-23', ageConfirmation: 'required-true',
  retention: 'fixed-seven-days-with-daily-purge', revocation: 'erase-both-answers-and-consent-fields-immediately-preserve-replay-tombstone-until-expiry',
  existingFunctions: 'unchanged', existingData: 'unchanged', newRows: 'none', backfill: 'none',
  rollback: 'disable-new-session-creation-preserve-revoke-and-expiry-cleanup',
});

// 고정된 237개 원문을 보존한 새 238 lane. 정적 검증은 운영 적용 증거가 아니다.
export function loadWeddingCodePairSessionReleasePlan(repoRoot) { return loadPlan(repoRoot, true); }
// 후속 계약 전용. 공개 238 lane은 여전히 정확히 238개 SQL만 수락한다.
export function loadWeddingCodePairSessionHistoricalReleasePlan(repoRoot) { return loadPlan(repoRoot, false); }
function loadPlan(repoRoot, checkCurrentDirectory) {
  const bytes = pinnedArtifact(repoRoot, { file: WEDDING_CODE_PAIR_SESSION_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'wedding-code-pair-session-static-successor'
    && contract.release === 'wedding-code-pair-session-20260923' && contract.status === 'requires-scoped-runtime-evidence'
    && contract.productionApplyImplemented === true && contract.runtimeEvidenceVerified === false, 'WEDDING_CODE_PAIR_SESSION_CONTRACT_INVALID');
  const predecessor = loadPreparationStyleHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: 'supabase/release-contracts/preparation-style-v1.json', sha256: predecessor.contractSha256 }, 'WEDDING_CODE_PAIR_SESSION_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === predecessor.contract.projectRef && contract.systemIdentifier === predecessor.contract.systemIdentifier, 'WEDDING_CODE_PAIR_SESSION_DESTINATION_CHANGED');
  same(contract.scope, WEDDING_CODE_PAIR_SESSION_SCOPE, 'WEDDING_CODE_PAIR_SESSION_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 237 && predecessor.migrationCount === 237
    && contract.migrations?.length === 1 && contract.migrations[0].file === MIGRATION_FILE, 'WEDDING_CODE_PAIR_SESSION_MIGRATION_SET_CHANGED');
  same(contract.predecessorMigration, { ...predecessor.contract.migrations[0], file: 'supabase/migrations/' + predecessor.contract.migrations[0].file }, 'WEDDING_CODE_PAIR_SESSION_PREDECESSOR_CHANGED');
  for (const [key, file] of Object.entries({ runtime: 'scripts/lib/wedding-code-pair-session-release.mjs', catalog: 'scripts/lib/wedding-code-pair-session-catalog.mjs',
    catalogFixture: 'supabase/release-contracts/wedding-code-pair-session-pg17-catalog-v1.json' })) {
    requireRelease(contract[key]?.file === file, 'WEDDING_CODE_PAIR_SESSION_IMPLEMENTATION_CHANGED'); pinnedArtifact(repoRoot, contract[key]);
  }
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a,b) => a.file.localeCompare(b.file));
  if (checkCurrentDirectory) same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(), reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  requireRelease(reviewed.length === 238 && reviewed.at(-1)?.file === MIGRATION_FILE, 'WEDDING_CODE_PAIR_SESSION_MIGRATION_SET_CHANGED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: 'supabase/migrations/' + pin.file });
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: 'supabase/migrations/' + MIGRATION_FILE });
  requireRelease(!sql.includes(13) && sql.toString('utf8').startsWith('BEGIN;\n') && sql.toString('utf8').endsWith('COMMIT;\n'), 'WEDDING_CODE_PAIR_SESSION_SQL_NOT_CANONICAL');
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    followupMigrations: [...predecessor.followupMigrations, { file: MIGRATION_FILE, version: '20260923104336' }],
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false };
}
