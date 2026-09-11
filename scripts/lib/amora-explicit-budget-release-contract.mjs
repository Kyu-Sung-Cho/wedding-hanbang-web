import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, digestJson, pinnedArtifact, requireRelease, same, validateObservation } from './current-baseline-release-contract.mjs';
import { BUDGET_DECISION_CONTRACT_FILE, BUDGET_DECISION_SCHEMA_CHANGES } from './amora-budget-decision-release-contract.mjs';
import { BUDGET_REALTIME_SUPPLEMENT_FILE, loadEffectiveBudgetDecisionHistoricalRelease } from './amora-budget-decision-effective-release-contract.mjs';

export const EXPLICIT_BUDGET_KIND = 'amora-explicit-budget-single-sql-hotfix';
export const EXPLICIT_BUDGET_SCHEMA_CHANGES = Object.freeze([
  'function:public.apply_amora_atomic_tool_execution_pre_shared_revision(p_couple_id uuid, p_request_key text, p_operation_key text, p_request_attempt_count integer, p_input_digest text, p_tool_input jsonb, p_domain_mutation jsonb, p_result jsonb)',
]);
export const EXPLICIT_BUDGET_CONTRACT_FILE = 'supabase/release-contracts/amora-explicit-budget-hotfix-v1.json';
const CONTRACT_SHA = '748f75b36797ae0d317d016f2c89ca7fe9e557f51db2e845a3c02535d6aa6474';
const HISTORY_SHA = 'e47a2d2dae60056304f62c44248b71e8468199b30e3c13c94837351a1a697ef5';
const SOURCE_COMMIT = 'e9f74aa3823cd75ed4180623d6276845180bd8ab';
const RAW_SHA = 'a1c892d85c282795c7237c87f582a0cd245780534952a98d89f7e3d7f9f7b2ac';
const QUERY_SHA = '0fb43fa111e1d890acdcbb7fb3d113b99726cc068a3b37e115109ce05c440f75';
const WIRE_SHA = '61003d8e829984056936dcf024e10cd0b055813030e5206cdaefc9dcbeba0f03';
const PREDECESSOR_PROOF_SHA = 'd15034786bf7993093f73c5aff43f7df8d0248930763477249bcbb1bff57aa12';
const FEATURE = Object.freeze({ file: '20260911080244_amora_budget_plan_explicit_allocations.sql',
  sha256: '2d26acb1d7b4ef26e4ec7e1c04de3e4e0e4180e57521e49128059ab3c1ec9372' });
const key = row => `${row.kind}:${row.identity}`;
const ordered = rows => [...rows].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

// 새 관측은 원격 원문이다. 이전 관측에 예상 DDL을 덧붙여 운영 관측인 것처럼 만들지 않는다.
// 재구성은 그 원문을 기존 허용 전이와 독립 대조하는 검사에만 사용한다.
export function validateExplicitBudgetPredecessor({ parent, baseline, proof }) {
  validateObservation(baseline, parent.contract);
  requireRelease(proof?.format === 'amora-explicit-budget-baseline-proof-v1'
    && proof.sourceCommit === SOURCE_COMMIT && proof.projectRef === parent.hotfix.projectRef
    && proof.inventorySha256 === parent.contract.implementation.inventory.sha256
    && proof.querySha256 === QUERY_SHA && digest(proof.queryText) === QUERY_SHA
    && proof.wireQuerySha256 === WIRE_SHA && proof.rawSha256 === RAW_SHA
    && digest(proof.rawText) === RAW_SHA, 'EXPLICIT_BASELINE_PROOF_INVALID');
  same(proof.sourceBefore, { head: SOURCE_COMMIT, status: '' }, 'EXPLICIT_BASELINE_SOURCE_INVALID');
  same(proof.sourceAfter, proof.sourceBefore, 'EXPLICIT_BASELINE_SOURCE_INVALID');
  const raw = JSON.parse(proof.rawText);
  requireRelease(Array.isArray(raw) && raw.length === 1, 'EXPLICIT_BASELINE_PROOF_INVALID');
  same(baseline, raw[0].observation, 'EXPLICIT_BASELINE_RAW_MISMATCH');
  requireRelease(Date.parse(baseline.observedAt) > Date.parse(parent.baseline.observedAt), 'EXPLICIT_BASELINE_TIME_INVALID');
  requireRelease(digestJson(proof.predecessor) === PREDECESSOR_PROOF_SHA, 'EXPLICIT_PREDECESSOR_PROOF_CHANGED');
  const transitions = proof.predecessor.transitions;
  same(transitions.map(row => row.identity), BUDGET_DECISION_SCHEMA_CHANGES, 'EXPLICIT_PREDECESSOR_SCHEMA_CHANGED');
  const before = new Map(parent.baseline.objects.map(row => [key(row), row.sha256]));
  for (const row of transitions) same(before.get(row.identity) ?? null, row.beforeSha256, 'EXPLICIT_PREDECESSOR_SCHEMA_CHANGED');
  const changed = new Set(transitions.map(row => row.identity));
  const expectedObjects = ordered([...parent.baseline.objects.filter(row => !changed.has(key(row))),
    ...transitions.map(row => ({ kind: row.identity.slice(0, row.identity.indexOf(':')),
      identity: row.identity.slice(row.identity.indexOf(':') + 1), sha256: row.afterSha256 }))]);
  same(baseline.objects, expectedObjects, 'EXPLICIT_PREDECESSOR_SCHEMA_CHANGED');
  for (const field of ['format', 'readOnly', 'systemIdentifier', 'serverVersion', 'relations',
    'storagePolicies', 'storageStructureSha256', 'vaultRows', 'cronJobs'])
    same(baseline[field], parent.baseline[field], 'EXPLICIT_PREDECESSOR_MANAGED_DRIFT');
  requireRelease(parent.migrations.length === 1, 'EXPLICIT_PREDECESSOR_LEDGER_CHANGED');
  const applied = parent.migrations[0];
  same(baseline.ledger, [...parent.baseline.ledger, { version: applied.version,
    name: applied.file.slice(15, -4), statementsSha256: digest(JSON.stringify([applied.sql.toString('utf8')])) }],
  'EXPLICIT_PREDECESSOR_LEDGER_CHANGED');
  requireRelease(baseline.ledger.length === 216 && baseline.ledger.at(-1).version === '20260910160514', 'EXPLICIT_PREDECESSOR_LEDGER_CHANGED');
  requireRelease(baseline.objects.some(row => key(row) === EXPLICIT_BUDGET_SCHEMA_CHANGES[0]), 'EXPLICIT_DISPATCHER_MISSING');
}

export function loadExplicitBudgetHotfixRelease(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: EXPLICIT_BUDGET_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const hotfix = JSON.parse(bytes);
  const parent = loadEffectiveBudgetDecisionHistoricalRelease(repoRoot);
  requireRelease(hotfix.version === 1 && hotfix.kind === EXPLICIT_BUDGET_KIND
    && hotfix.release === 'amora-explicit-budget-20260911' && hotfix.status === 'requires-scoped-runtime-evidence', 'HOTFIX_CONTRACT_INVALID');
  requireRelease(hotfix.projectRef === parent.hotfix.projectRef && hotfix.systemIdentifier === parent.hotfix.systemIdentifier
    && hotfix.requiredRemoteHead === '20260910160514' && hotfix.requiredLedgerCount === 216, 'HOTFIX_BASELINE_INVALID');
  same(hotfix.predecessor, { file: BUDGET_DECISION_CONTRACT_FILE, sha256: parent.hotfixSha256 }, 'HOTFIX_PREDECESSOR_CHANGED');
  same(hotfix.predecessorSupplement, { file: BUDGET_REALTIME_SUPPLEMENT_FILE, sha256: parent.baselineSupplementSha256 }, 'HOTFIX_PREDECESSOR_CHANGED');
  same(hotfix.migrations, [FEATURE], 'HOTFIX_MIGRATION_SET_MISMATCH');
  same(hotfix.allowedSchemaChanges, EXPLICIT_BUDGET_SCHEMA_CHANGES, 'HOTFIX_SCOPE_INVALID');
  same(hotfix.scope, parent.hotfix.scope, 'HOTFIX_SCOPE_INVALID');
  same(hotfix.requiredEvidence, parent.hotfix.requiredEvidence, 'HOTFIX_EVIDENCE_CONTRACT_INVALID');
  same(hotfix.excludedHistoricalFiles, parent.hotfix.excludedHistoricalFiles, 'HOTFIX_HISTORY_CHANGED');
  requireRelease(digestJson(hotfix.reviewedLocalHistory) === HISTORY_SHA, 'HISTORICAL_MIGRATION_MANIFEST_CHANGED');
  same(hotfix.reviewedLocalHistory.migrations, [...parent.hotfix.reviewedLocalHistory.migrations, ...parent.hotfix.migrations]
    .sort((a, b) => a.file.localeCompare(b.file)), 'HOTFIX_HISTORY_CHANGED');
  const reviewed = [...hotfix.reviewedLocalHistory.migrations, FEATURE].sort((a, b) => a.file.localeCompare(b.file));
  requireRelease(reviewed.length === 228, 'HOTFIX_HISTORY_CHANGED');
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(),
    reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  const baselineBytes = pinnedArtifact(repoRoot, hotfix.operatingBaseline), baseline = JSON.parse(baselineBytes);
  const proof = JSON.parse(pinnedArtifact(repoRoot, hotfix.baselineProof));
  validateExplicitBudgetPredecessor({ parent, baseline, proof });
  const migration = { ...FEATURE, version: FEATURE.file.slice(0, 14),
    sql: pinnedArtifact(repoRoot, { ...FEATURE, file: `supabase/migrations/${FEATURE.file}` }) };
  requireRelease(!baseline.ledger.some(row => row.version === migration.version), 'MIGRATION_ALREADY_APPLIED');
  // 공통 topology guard/TTL/최종 확인은 기존 supplement와 새 실제 216 관측 SHA를 함께 요구한다.
  // 과거 hosted 원문은 새 SQL의 검증으로 승격하지 않는다. 런타임 migrationSet SHA는 새 SQL 한 건이다.
  return { ...parent, contract: { ...parent.contract, requiredRemoteHead: hotfix.requiredRemoteHead,
    migrations: hotfix.migrations, allowedSchemaChanges: hotfix.allowedSchemaChanges },
  parentOperatingBaseline: parent.effectiveOperatingBaseline, parentBaselineSha256: parent.baselineSha256,
  effectiveOperatingBaseline: hotfix.operatingBaseline, baseline, baselineSha256: digest(baselineBytes),
  effectiveBaselineSha256: digest(baselineBytes), hotfix, hotfixSha256: digest(bytes),
  migrations: [migration], followupMigrations: [...parent.migrations, migration], migrationSetSha256: digestJson(hotfix.migrations) };
}
