import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, digestJson, pinnedArtifact, readAnchored, requireRelease, same,
  validateObservation, validateBaselineSupplement } from './current-baseline-release-contract.mjs';

export const BUDGET_DECISION_KIND = 'amora-budget-decision-single-sql-hotfix';
export const BUDGET_DECISION_SCHEMA_CHANGES = Object.freeze([
  'function:public.capture_amora_shared_budget_delta()',
  'function:public.record_amora_shared_budget_decision()',
  'relation:public.amora_shared_action_journey_mutation_receipts',
  'relation:public.amora_tool_executions',
  'relation:public.decision_nodes',
  'relation:public.wedding_journeys',
]);
export const BUDGET_DECISION_CONTRACT_FILE = 'supabase/release-contracts/amora-budget-decision-hotfix-v1.json';
const CONTRACT_SHA = 'a5cb2dfb93e34fb7650dd2fdb434c4c60a2c74146c68c4dfd0261942ec1e07e1';
const HISTORY_SHA = '75a713b2b9da12a558ec0ad97c2e5778358cc83ad953c1fd5a771a922d58b404';
const FEATURE = Object.freeze({ file: '20260910160514_amora_shared_budget_decision_receipts.sql',
  sha256: '2b32149527dcd5e1edda3fa47cf38dad48606222d60493ca4962df1ce229596a' });
const PREDECESSORS = Object.freeze([
  { file: 'supabase/release-contracts/current-baseline-rollout-v1.json', sha256: '8897d509fbee0e2ddfc06fe4dc3b3320ecb3307c1d5468aedbca59aff467b740' },
  { file: 'supabase/release-contracts/amora-runtime-hotfix-v1.json', sha256: '01ab4685c5830caa67c7e3b2a4f50767ff9bd09576608e2e3db9140169fdfe14' },
  { file: 'supabase/release-contracts/amora-named-budget-hotfix-v1.json', sha256: '0bb3e6d872a0e2248f2dc9fa08c1c22c9734faa90562cbbd62f16d0af6906da9' },
]);
const RAW_PINS = Object.freeze({
  'budget-decision-production-canonical-baseline-20260911': ['837241e0d6930e9f59903e2cf5227139c8f8199183c9a23f7e535f694013a8b3', '93188cf49e6122198946416779d3f8065fc2a7eecdff7e71f3df0fb5f742153e'],
  'budget-storage-index-drift-proof': ['70f51acbe128029b036ac90dc7799e0f8b9321f960118f008e02e6f865cf84f2', '4af4147d1a9e92f4433413c54f4ddb6aa705a25ce9f0a9c359a9ad9025f88013'],
  'budget-storage-migration-history-readonly': ['793cf2b8634e2a5db0e3b1b5978385a32ddeaae50b3cfb26089db6d88ca1ef8d', 'bf7188ad14db8ab1ca59df7c3cd96b775e2d22b487885ecddbbeb6b9eadd1a15'],
  'budget-realtime-drift-proof': ['8544863f3ad5c3fa1dadf766d0c18cb933e2a9a6cb4c87cfa2602b35fb8f5a06', 'efe772a112eb7f75870e1001e55b038f3a077097975bb839fb2bf413d6914c3a'],
});
const INDEX_DEFINITIONS = Object.freeze([
  'CREATE UNIQUE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (archived_at IS NULL)',
  'CREATE UNIQUE INDEX idx_objects_null_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (NOT is_versioned)',
  'CREATE UNIQUE INDEX objects_bucket_id_name_version_key ON storage.objects USING btree (bucket_id, name COLLATE "C", version) NULLS NOT DISTINCT',
]);
const NAMED_FUNCTIONS = Object.freeze([
  'function:public.amora_resolve_budget_plan_allocations(p_couple_id uuid, p_progress jsonb, p_allocations jsonb)',
  'function:public.apply_amora_atomic_tool_execution_pre_shared_revision(p_couple_id uuid, p_request_key text, p_operation_key text, p_request_attempt_count integer, p_input_digest text, p_tool_input jsonb, p_domain_mutation jsonb, p_result jsonb)',
]);
const key = object => `${object.kind}:${object.identity}`;
const objectHash = (observation, identity) => observation.objects.find(object => key(object) === identity)?.sha256 ?? null;
const changes = (before, after) => {
  const a = new Map(before.objects.map(object => [key(object), object.sha256]));
  const b = new Map(after.objects.map(object => [key(object), object.sha256]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().filter(id => a.get(id) !== b.get(id))
    .map(identity => ({ identity, beforeSha256: a.get(identity) ?? null, afterSha256: b.get(identity) ?? null }));
};
const sortedRelations = rows => [...rows].sort((a, b) => `${a.schema}.${a.name}` < `${b.schema}.${b.name}` ? -1 : 1);
const appliedRow = migration => ({ version: migration.version, name: migration.file.slice(15, -4),
  statementsSha256: digest(JSON.stringify([migration.sql.toString('utf8')])) });
const migration = (root, pin) => ({ ...pin, version: pin.file.slice(0, 14),
  sql: pinnedArtifact(root, { ...pin, file: `supabase/migrations/${pin.file}` }) });

// 이전 validator와 controller는 변경하지 않는다. 순환 import 없이 핀된 과거 관측의 연결만 검증한다.
function historicalRelease(root) {
  const [base, runtime, named] = PREDECESSORS.map(pin => JSON.parse(pinnedArtifact(root, pin)));
  for (const pin of Object.values(base.implementation)) pinnedArtifact(root, pin);
  const original = JSON.parse(pinnedArtifact(root, base.baselineSupplement.originalObservation));
  const cli = validateObservation(JSON.parse(pinnedArtifact(root, base.baselineObservation)), base);
  validateBaselineSupplement(original, cli, base.baselineSupplement, base);
  const operating = validateObservation(JSON.parse(pinnedArtifact(root, runtime.operatingBaseline)), base);
  for (const field of ['format', 'systemIdentifier', 'serverVersion', 'ledger', 'storageStructureSha256', 'storagePolicies', 'vaultRows', 'cronJobs'])
    same(operating[field], cli[field], 'HISTORICAL_BASELINE_DRIFT');
  same(changes(cli, operating), runtime.baselineDelta.objects, 'HISTORICAL_BASELINE_DRIFT');
  same(operating.relations, sortedRelations([...cli.relations.filter(row =>
    !runtime.baselineDelta.relationsRemoved.some(old => old.schema === row.schema && old.name === row.name)),
  ...runtime.baselineDelta.relationsAdded]), 'HISTORICAL_BASELINE_DRIFT');
  same(runtime.migrations, base.migrations, 'HISTORICAL_MIGRATION_SET_CHANGED');
  const first = runtime.migrations.map(pin => migration(root, pin));
  const prior = validateObservation(JSON.parse(pinnedArtifact(root, named.operatingBaseline)), base);
  same(prior.ledger, [...operating.ledger, ...first.map(appliedRow)], 'HISTORICAL_LEDGER_CHANGED');
  same(changes(operating, prior), named.predecessorDelta.objects, 'HISTORICAL_BASELINE_DRIFT');
  for (const field of ['format', 'systemIdentifier', 'serverVersion', 'storageStructureSha256', 'storagePolicies', 'vaultRows', 'cronJobs'])
    same(prior[field], operating[field], 'HISTORICAL_BASELINE_DRIFT');
  same(prior.relations, sortedRelations([...operating.relations,
    { schema: 'public', name: 'amora_mediation_responses', kind: 'r' },
    { schema: 'public', name: 'amora_personal_actions', kind: 'r' }]), 'HISTORICAL_BASELINE_DRIFT');
  return { base, runtime, named, prior, applied: named.migrations.map(pin => migration(root, pin)) };
}

function proofRows(baseline, name, contract) {
  const proof = baseline.managedDriftEvidence?.receipts?.[name];
  const [rawSha, querySha] = RAW_PINS[name];
  requireRelease(proof && typeof proof.rawText === 'string' && typeof proof.queryText === 'string', 'MANAGED_DRIFT_EVIDENCE_MISSING');
  requireRelease(proof.rawSha256 === rawSha && digest(proof.rawText) === rawSha
    && proof.querySha256 === querySha && digest(proof.queryText) === querySha, 'MANAGED_DRIFT_RAW_MISMATCH');
  requireRelease(/BEGIN(?: TRANSACTION)? READ ONLY/i.test(proof.queryText), 'MANAGED_DRIFT_QUERY_UNBOUND');
  const raw = JSON.parse(proof.rawText);
  if (name === 'budget-decision-production-canonical-baseline-20260911') {
    requireRelease(raw.readOnly === true && raw.systemIdentifier === contract.systemIdentifier, 'MANAGED_DRIFT_TARGET_MISMATCH');
    return raw;
  }
  requireRelease(proof.queryText.includes(contract.systemIdentifier), 'MANAGED_DRIFT_QUERY_UNBOUND');
  requireRelease(raw.source === 'Supabase MCP execute_sql' && raw.requestedProjectRef === contract.projectRef
    && Array.isArray(raw.rows) && raw.rows.length > 0, 'MANAGED_DRIFT_TARGET_MISMATCH');
  for (const row of raw.rows) {
    const observation = row.observation ?? row;
    requireRelease((observation.readOnly ?? observation.readonly) === true
      && (observation.systemIdentifier ?? observation.system_identifier) === contract.systemIdentifier,
    'MANAGED_DRIFT_TARGET_MISMATCH');
  }
  return raw.rows;
}

// 이 함수는 검토된 원문 hash와 실제 재구성 결과를 함께 확인한다. 새 관측의 자동 채택은 없다.
export function validateBudgetDecisionPredecessor({ baseline, prior, contract, applied }) {
  validateObservation(baseline, contract);
  same(baseline.ledger, [...prior.ledger, ...applied.map(appliedRow)], 'HOTFIX_PREDECESSOR_LEDGER_CHANGED');
  requireRelease(baseline.ledger.length === 215 && baseline.ledger.at(-1).version === '20260907085111', 'HOTFIX_BASELINE_INVALID');
  // 공식 CLI의 유한 만료시각은 validateObservation의 TTL 계약으로 검사한다. 역할/멤버십 SHA 변경은 아래 전체 차이 검사에서 거절한다.
  for (const field of ['format', 'systemIdentifier', 'serverVersion', 'storagePolicies', 'vaultRows', 'cronJobs'])
    same(baseline[field], prior[field], 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  const evidence = baseline.managedDriftEvidence;
  requireRelease(evidence?.version === 1 && evidence.source === 'Supabase MCP execute_sql'
    && evidence.projectRef === contract.projectRef && evidence.systemIdentifier === contract.systemIdentifier,
  'MANAGED_DRIFT_TARGET_MISMATCH');
  same(Object.keys(evidence.receipts ?? {}).sort(), Object.keys(RAW_PINS).sort(), 'MANAGED_DRIFT_EVIDENCE_MISSING');
  const raw = proofRows(baseline, 'budget-decision-production-canonical-baseline-20260911', contract);
  const { managedDriftEvidence: _evidence, ...observed } = baseline;
  same(observed, raw, 'BASELINE_RAW_OBSERVATION_MISMATCH');
  const storage = proofRows(baseline, 'budget-storage-index-drift-proof', contract)[0].observation;
  const realtime = proofRows(baseline, 'budget-realtime-drift-proof', contract)[0].observation;
  const history = proofRows(baseline, 'budget-storage-migration-history-readonly', contract);
  for (const proof of [storage, realtime]) requireRelease(Number.isFinite(Date.parse(proof.observedAt))
    && Date.parse(proof.observedAt) >= Date.parse(baseline.observedAt), 'MANAGED_DRIFT_TIME_INVALID');
  requireRelease(storage.addedIndexCount === 3, 'MANAGED_STORAGE_INDEX_DRIFT');
  same(storage.addedIndexes, INDEX_DEFINITIONS.map(definition => [definition, true, true, false]), 'MANAGED_STORAGE_INDEX_DRIFT');
  same(storage.currentObjectSha256, objectHash(baseline, 'relation:storage.objects'), 'MANAGED_STORAGE_INDEX_DRIFT');
  same(storage.priorObjectReconstructedSha256, objectHash(prior, 'relation:storage.objects'), 'MANAGED_STORAGE_INDEX_DRIFT');
  same(storage.currentStorageStructureSha256, baseline.storageStructureSha256, 'MANAGED_STORAGE_INDEX_DRIFT');
  same(storage.priorStorageStructureReconstructedSha256, prior.storageStructureSha256, 'MANAGED_STORAGE_INDEX_DRIFT');
  const storageMigrations = history.filter(row => row.id >= 65).sort((a, b) => a.id - b.id);
  same(storageMigrations.map(row => [row.id, row.name, row.hash]), [
    [65, 'objects-key-version-index', '603c1c55658e982d35839001e2c2b59a50703904'],
    [66, 'objects-current-version-index', '191466c93aa2c46a00e36505577c5fcab8d7cb4b'],
    [67, 'objects-null-version-index', '15bfe8c35b66642b6c78ba60060fa8793bd2207a'],
  ], 'MANAGED_STORAGE_HISTORY_DRIFT');
  for (const row of storageMigrations) {
    const time = Date.parse(row.executed_at.replace(' ', 'T') + 'Z');
    requireRelease(time > Date.parse(prior.observedAt) && time < Date.parse(baseline.observedAt), 'MANAGED_DRIFT_TIME_INVALID');
  }
  same(realtime.partitions.map(row => [row.priorIdentity, row.currentIdentity]), [
    ['realtime.messages_2026_09_04', 'realtime.messages_2026_09_11'],
    ['realtime.messages_2026_09_05', 'realtime.messages_2026_09_12'],
    ['realtime.messages_2026_09_06', 'realtime.messages_2026_09_13'],
  ], 'MANAGED_REALTIME_ROTATION_DRIFT');
  for (const row of realtime.partitions) {
    same(row.priorReconstructedSha256, objectHash(prior, `relation:${row.priorIdentity}`), 'MANAGED_REALTIME_ROTATION_DRIFT');
    same(row.currentSha256, objectHash(baseline, `relation:${row.currentIdentity}`), 'MANAGED_REALTIME_ROTATION_DRIFT');
    requireRelease(objectHash(prior, `relation:${row.currentIdentity}`) === null
      && objectHash(baseline, `relation:${row.priorIdentity}`) === null, 'MANAGED_REALTIME_ROTATION_DRIFT');
  }
  same(realtime.publication.priorReconstructedSha256, objectHash(prior, 'publication:supabase_realtime_messages_publication'), 'MANAGED_REALTIME_ROTATION_DRIFT');
  same(realtime.publication.currentSha256, objectHash(baseline, 'publication:supabase_realtime_messages_publication'), 'MANAGED_REALTIME_ROTATION_DRIFT');
  const removed = new Set(realtime.partitions.map(row => row.priorIdentity));
  same(baseline.relations, sortedRelations([...prior.relations.filter(row => !removed.has(`${row.schema}.${row.name}`)),
    ...realtime.partitions.map(row => ({ schema: 'realtime', name: row.currentIdentity.slice(9), kind: 'r' }))]), 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  const delta = changes(prior, baseline);
  same(delta, contract.predecessorDelta.objects, 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  same(delta.filter(row => /:public\./.test(row.identity)).map(row => row.identity), NAMED_FUNCTIONS, 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  requireRelease(delta.length === 10, 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
}

export function loadBudgetDecisionHotfixRelease(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: BUDGET_DECISION_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const hotfix = JSON.parse(bytes);
  const { base, named, prior, applied } = historicalRelease(repoRoot);
  requireRelease(hotfix.version === 1 && hotfix.kind === BUDGET_DECISION_KIND
    && hotfix.release === 'amora-budget-decision-20260911' && hotfix.status === 'requires-scoped-runtime-evidence', 'HOTFIX_CONTRACT_INVALID');
  requireRelease(hotfix.projectRef === base.projectRef && hotfix.systemIdentifier === base.systemIdentifier
    && hotfix.requiredLedgerCount === 215 && hotfix.requiredRemoteHead === '20260907085111', 'HOTFIX_BASELINE_INVALID');
  same(hotfix.predecessor, PREDECESSORS[2], 'HOTFIX_PREDECESSOR_CHANGED');
  same(hotfix.migrations, [FEATURE], 'HOTFIX_MIGRATION_SET_MISMATCH');
  same(hotfix.excludedHistoricalFiles, named.excludedHistoricalFiles, 'HOTFIX_HISTORY_CHANGED');
  same(hotfix.scope, named.scope, 'HOTFIX_SCOPE_INVALID');
  same(hotfix.requiredEvidence, named.requiredEvidence, 'HOTFIX_EVIDENCE_CONTRACT_INVALID');
  same(hotfix.allowedSchemaChanges, BUDGET_DECISION_SCHEMA_CHANGES, 'HOTFIX_SCOPE_INVALID');
  requireRelease(digestJson(hotfix.reviewedLocalHistory) === HISTORY_SHA, 'HISTORICAL_MIGRATION_MANIFEST_CHANGED');
  const reviewed = [...hotfix.reviewedLocalHistory.migrations, FEATURE].sort((a, b) => a.file.localeCompare(b.file));
  // 바닥 날짜 이전도 포함한 디렉터리 전체를 비교한다. 새 파일, 잘못된 이름, 과거 byte 변경 모두 거절한다.
  const files = readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort();
  same(files, reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  const baselineBytes = pinnedArtifact(repoRoot, hotfix.operatingBaseline);
  const baseline = JSON.parse(baselineBytes);
  validateBudgetDecisionPredecessor({ baseline, prior, contract: hotfix, applied });
  const migrations = hotfix.migrations.map(pin => migration(repoRoot, pin));
  requireRelease(!baseline.ledger.some(row => row.version === migrations[0].version), 'MIGRATION_ALREADY_APPLIED');
  const inventory = pinnedArtifact(repoRoot, base.implementation.inventory).toString('utf8');
  const inventorySelect = inventory.slice(inventory.indexOf('WITH namespaces')).replace(/;\s*COMMIT;\s*$/, '');
  requireRelease(inventorySelect.startsWith('WITH namespaces') && !inventorySelect.endsWith(';'), 'INVENTORY_ENVELOPE_INVALID');
  const fence = pinnedArtifact(repoRoot, base.implementation.writeFenceCheck).toString('utf8');
  const fenceBody = fence.replace(/^BEGIN TRANSACTION READ ONLY;\s*/, '').replace(/\s*ROLLBACK;\s*$/, '');
  requireRelease(fenceBody !== fence && !/\bROLLBACK\s*;\s*$/i.test(fenceBody), 'FENCE_ENVELOPE_INVALID');
  return { contract: { ...base, requiredRemoteHead: hotfix.requiredRemoteHead, migrations: hotfix.migrations,
    allowedSchemaChanges: hotfix.allowedSchemaChanges }, baseline, baselineSha256: digest(baselineBytes),
  migrations, migrationSetSha256: digestJson(hotfix.migrations), contractSha256: PREDECESSORS[0].sha256,
  hotfix, hotfixSha256: digest(bytes), inventorySelect, fenceBody };
}
