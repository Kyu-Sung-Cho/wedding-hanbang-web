import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadCustomerDataHistoricalReleasePlan } from './account-deletion-customer-data-release-contract.mjs';

export const NOT_APPLICABLE_STATUS_CONTRACT_FILE = 'supabase/release-contracts/amora-not-applicable-status-v1.json';
const CONTRACT_SHA = '8d77b3bbe24586d0f3b171f828093cd55b0e5ecbd6173bba00ca0baa17fc13ed';
const MIGRATION_FILE = '20260915101500_amora_atomic_not_applicable_status.sql';
const PREVIOUS_FUNCTION_FILE = 'supabase/migrations/20260911080244_amora_budget_plan_explicit_allocations.sql';
export const NOT_APPLICABLE_STATUS_SCOPE = Object.freeze({
  replaceFunction: 'public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
  acceptedStoredStatus: 'not_applicable',
  acceptedTools: ['update_category_budget', 'add_custom_category', 'apply_budget_plan'],
  budgetWritesKeepStatus: true,
  unchangedTools: ['update_task_status', 'toggle_checklist_item'],
  declarationOwnerAndAcl: 'unchanged', tables: 'unchanged', dataRows: 'unchanged', otherFunctions: 'unchanged',
});

const THREE = "'not_started', 'in_progress', 'completed'";
const FOUR = "'not_started', 'in_progress', 'completed', 'not_applicable'";
const KEEP = `
         OR COALESCE(v_value ->> 'status' = 'not_applicable', false)
            IS DISTINCT FROM COALESCE(
              v_expected_present AND v_expected ->> 'status' = 'not_applicable', false
            )`;
// 이전 정의에서 바뀌는 곳은 이 세 허용 목록뿐이다. 순서·공백까지 정확히 대조한다.
export const NOT_APPLICABLE_SQL_EDITS = Object.freeze([
  [`         OR v_value ->> 'status' NOT IN (\n           ${THREE}\n         )\n         OR v_value - ARRAY['category', 'status', 'budget', 'spent']`,
    `         OR v_value ->> 'status' NOT IN (\n           ${FOUR}\n         )${KEEP}\n         OR v_value - ARRAY['category', 'status', 'budget', 'spent']`],
  [`         OR v_value ->> 'status' NOT IN (\n           ${THREE}\n         )\n         OR v_value - ARRAY['category', 'label', 'status', 'budget', 'spent']`,
    `         OR v_value ->> 'status' NOT IN (\n           ${FOUR}\n         )${KEEP}\n         OR v_value - ARRAY['category', 'label', 'status', 'budget', 'spent']`],
  [`         OR v_entry -> 'value' ->> 'status' NOT IN (\n           ${THREE}\n         )`,
    `         OR v_entry -> 'value' ->> 'status' NOT IN (\n           ${FOUR}\n         )`],
]);

export function expectedNotApplicableTransaction(previousSql) {
  let text = previousSql.slice(previousSql.indexOf('BEGIN;\n'));
  requireRelease(text.startsWith('BEGIN;\n'), 'NOT_APPLICABLE_SQL_SCOPE_CHANGED');
  for (const [before, after] of NOT_APPLICABLE_SQL_EDITS) {
    requireRelease(text.split(before).length === 2, 'NOT_APPLICABLE_SQL_SCOPE_CHANGED');
    text = text.replace(before, () => after);
  }
  return text;
}

// 232 선행 원문과 계약을 그대로 보존하고, 아모라 원자 함수의 상태 허용 목록 교체 한 건만 추가한다.
// 로컬 검증만 수행한다. 운영 적용·런타임 증거·배포 승인을 뜻하지 않는다.
export function loadNotApplicableStatusReleasePlan(repoRoot) { return loadPlan(repoRoot, true); }
// 후속 계약은 선행 233 원문만 검증한다. 기존 공개 모드는 전체 디렉터리 검사를 유지한다.
export function loadNotApplicableStatusHistoricalReleasePlan(repoRoot) { return loadPlan(repoRoot, false); }

function loadPlan(repoRoot, checkCurrentDirectory) {
  const bytes = pinnedArtifact(repoRoot, { file: NOT_APPLICABLE_STATUS_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'amora-not-applicable-status-static-successor'
    && contract.release === 'amora-not-applicable-status-20260915'
    && contract.status === 'requires-scoped-runtime-evidence' && contract.productionApplyImplemented === true
    && contract.runtimeEvidenceVerified === false, 'NOT_APPLICABLE_CONTRACT_INVALID');
  const predecessor = loadCustomerDataHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: 'supabase/release-contracts/account-deletion-customer-data-v1.json', sha256: predecessor.contractSha256 },
    'NOT_APPLICABLE_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === predecessor.contract.projectRef && contract.systemIdentifier === predecessor.contract.systemIdentifier,
    'NOT_APPLICABLE_DESTINATION_CHANGED');
  same(contract.scope, NOT_APPLICABLE_STATUS_SCOPE, 'NOT_APPLICABLE_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 232 && predecessor.migrationCount === 232
    && contract.migrations?.length === 1 && contract.migrations[0].file === MIGRATION_FILE, 'NOT_APPLICABLE_MIGRATION_SET_CHANGED');
  same(contract.predecessorMigration, { ...predecessor.contract.migrations[0], file: `supabase/migrations/${predecessor.contract.migrations[0].file}` },
    'NOT_APPLICABLE_PREDECESSOR_CHANGED');
  for (const [key, file] of Object.entries({ runtime: 'scripts/lib/amora-not-applicable-status-release.mjs',
    previousFunction: PREVIOUS_FUNCTION_FILE })) {
    requireRelease(contract[key]?.file === file, 'NOT_APPLICABLE_IMPLEMENTATION_CHANGED');
    pinnedArtifact(repoRoot, contract[key]);
  }
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  if (checkCurrentDirectory) same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(),
    reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  requireRelease(reviewed.some(pin => `supabase/migrations/${pin.file}` === PREVIOUS_FUNCTION_FILE
    && pin.sha256 === contract.previousFunction.sha256), 'NOT_APPLICABLE_IMPLEMENTATION_CHANGED');
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${MIGRATION_FILE}` });
  const text = sql.toString('utf8');
  const previous = pinnedArtifact(repoRoot, contract.previousFunction).toString('utf8');
  requireRelease(!text.includes('\r') && text.slice(0, text.indexOf('BEGIN;\n')).split('\n').every(line => line === '' || line.startsWith('-- '))
    && text.slice(text.indexOf('BEGIN;\n')) === expectedNotApplicableTransaction(previous), 'NOT_APPLICABLE_SQL_SCOPE_CHANGED');
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    followupMigrations: [...predecessor.followupMigrations, { file: MIGRATION_FILE, version: MIGRATION_FILE.slice(0, 14) }],
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false };
}
