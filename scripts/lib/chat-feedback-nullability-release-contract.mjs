import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadEffectiveBudgetDecisionHistoricalRelease } from './amora-budget-decision-effective-release-contract.mjs';
import { validateExplicitBudgetPredecessor } from './amora-explicit-budget-release-contract.mjs';

export const CHAT_FEEDBACK_CONTRACT_FILE = 'supabase/release-contracts/chat-feedback-nullability-v1.json';
const CONTRACT_SHA = '21b1c661a3accddadceb27e8076e11940962a14180ac69d4f6174111e6b0e7ab';
const PREDECESSOR = Object.freeze({ file: 'supabase/release-contracts/amora-explicit-budget-hotfix-v1.json',
  sha256: '748f75b36797ae0d317d016f2c89ca7fe9e557f51db2e845a3c02535d6aa6474' });
const MIGRATION_FILE = '20260913043211_chat_feedback_automatic_signal_nullable.sql';
export const CHAT_FEEDBACK_SCHEMA_CHANGE = 'column:public.chat_feedback.message_id:attnotnull:true-to-false';

// 기존 228개 원문과 그 전신의 모든 구현/관측 핀을 보존한다. 새 SQL 한 건만 CI에 등록한다.
// 과거 운영 관측을 새 SQL의 실행·복구 증거로 사용하지 않는다. 이 함수는 로컬 검증만 수행한다.
export function loadChatFeedbackNullabilityReleasePlan(repoRoot) {
  return loadPlan(repoRoot, true);
}

// 후속 계약의 고정 전신 검증만 수행한다. 기존 공개 229 모드의 목록 검사를 완화하지 않는다.
export function loadChatFeedbackHistoricalReleasePlan(repoRoot) {
  return loadPlan(repoRoot, false);
}

function loadPlan(repoRoot, checkCurrentDirectory) {
  const bytes = pinnedArtifact(repoRoot, { file: CHAT_FEEDBACK_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'chat-feedback-nullability-static-successor'
    && contract.release === 'chat-feedback-private-signal-20260913'
    && contract.status === 'requires-scoped-runtime-evidence'
    && contract.productionApplyImplemented === true && contract.runtimeEvidenceVerified === false,
  'CHAT_FEEDBACK_CONTRACT_INVALID');
  same(contract.predecessor, PREDECESSOR, 'CHAT_FEEDBACK_PREDECESSOR_CHANGED');
  const predecessor = JSON.parse(pinnedArtifact(repoRoot, PREDECESSOR));
  requireRelease(contract.runtime?.file === 'scripts/lib/chat-feedback-nullability-release.mjs', 'CHAT_FEEDBACK_RUNTIME_CHANGED');
  pinnedArtifact(repoRoot, contract.runtime);
  const parent = loadEffectiveBudgetDecisionHistoricalRelease(repoRoot);
  const baseline = JSON.parse(pinnedArtifact(repoRoot, predecessor.operatingBaseline));
  const proof = JSON.parse(pinnedArtifact(repoRoot, predecessor.baselineProof));
  validateExplicitBudgetPredecessor({ parent, baseline, proof });
  requireRelease(contract.projectRef === predecessor.projectRef
    && contract.systemIdentifier === predecessor.systemIdentifier,
  'CHAT_FEEDBACK_DESTINATION_CHANGED');
  same(contract.allowedSchemaChanges, [CHAT_FEEDBACK_SCHEMA_CHANGE], 'CHAT_FEEDBACK_SCOPE_CHANGED');
  same(contract.scope, { dataRows: 'unchanged', auth: 'unchanged', storage: 'unchanged',
    manualMessageValidation: 'unchanged', automaticMessageId: null }, 'CHAT_FEEDBACK_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 228
    && contract.migrations?.length === 1 && contract.migrations[0].file === MIGRATION_FILE,
  'CHAT_FEEDBACK_MIGRATION_SET_CHANGED');
  const history = [...predecessor.reviewedLocalHistory.migrations, ...predecessor.migrations];
  requireRelease(history.length === 228, 'CHAT_FEEDBACK_HISTORY_CHANGED');
  const reviewed = [...history, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  if (checkCurrentDirectory) same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(),
    reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${MIGRATION_FILE}` });
  const text = sql.toString('utf8');
  requireRelease(!text.includes('\r')
    && /SET LOCAL lock_timeout = '5s';/.test(text)
    && /SET LOCAL statement_timeout = '30s';/.test(text)
    && /LOCK TABLE public\.chat_feedback IN ACCESS EXCLUSIVE MODE;/.test(text)
    && text.match(/ALTER TABLE public\.chat_feedback ALTER COLUMN message_id DROP NOT NULL;/g)?.length === 1
    && !/\b(?:INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE|CREATE POLICY|GRANT|REVOKE)\b/i.test(text),
  'CHAT_FEEDBACK_SQL_SCOPE_CHANGED');
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    followupMigrations: [...parent.migrations, ...predecessor.migrations, ...contract.migrations]
      .map(({ file }) => ({ file, version: file.slice(0, 14) })),
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false,
    releaseAuthorized: false, remoteWritesPerformed: false };
}
