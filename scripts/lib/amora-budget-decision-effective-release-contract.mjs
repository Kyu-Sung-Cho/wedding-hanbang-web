import { loadBudgetDecisionHotfixRelease, loadBudgetDecisionHistoricalRelease } from './amora-budget-decision-release-contract.mjs';
import { digest, pinnedArtifact, requireRelease, same, validateObservation } from './current-baseline-release-contract.mjs';

export const BUDGET_REALTIME_SUPPLEMENT_FILE = 'supabase/release-contracts/amora-budget-decision-realtime-supplement-20260911.json';
const SUPPLEMENT_SHA = 'a61b1080a9296f7b34aa706b6fb6f3142d6bb3e53cee8aa5fc716c8292ea0c2d';
const STRUCTURE_RAW_SHA = '22ff4410bfe0520e8befc5a0aaed7123ca1d5a9803e1b064cbf66184cf36b990';
const STRUCTURE_QUERY_SHA = 'b36d7701530a58b54712ac5ecc92680b77448ac5d0fdf8426e7006356a36715c';
const BASELINE_RAW_SHA = 'ba0336e51637280b6dc4ca291029e32d3973e3b018e46382cab08b51254012ac';
const BASELINE_QUERY_SHA = '0fb43fa111e1d890acdcbb7fb3d113b99726cc068a3b37e115109ce05c440f75';
const OLD = 'messages_2026_09_07', NEW = 'messages_2026_09_14';
const fields = ['format', 'systemIdentifier', 'serverVersion', 'ledger', 'storageStructureSha256', 'storagePolicies', 'vaultRows', 'cronJobs'];
const objectHash = (baseline, kind, identity) => baseline.objects.find(row => row.kind === kind && row.identity === identity)?.sha256 ?? null;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const columns = ['topic', 'extension', 'payload', 'event', 'private', 'updated_at', 'inserted_at', 'id', 'binary_payload', 'skip_broadcast'];
const childTopology = date => ({ identity: `realtime.messages_2026_09_${date}`, relispartition: true,
  bounds: `FOR VALUES FROM ('2026-09-${date} 00:00:00') TO ('2026-09-${String(Number(date) + 1).padStart(2, '0')} 00:00:00')`,
  parents: [{ parent: 'realtime.messages', sequence: 1, parentKind: 'p', detachPending: false, parentPartitionKey: 'RANGE (inserted_at)' }],
  columninheritance: columns.map(name => [name, false, 1]),
  indexparents: [
    { index: `messages_2026_09_${date}_inserted_at_topic_idx`, sequence: 1, parentIndex: 'messages_inserted_at_topic_index', parentIndexTable: 'realtime.messages' },
    { index: `messages_2026_09_${date}_pkey`, sequence: 1, parentIndex: 'messages_pkey', parentIndexTable: 'realtime.messages' },
  ] });
const EXPECTED_TOPOLOGY = [{ identity: 'realtime.messages', relispartition: false, bounds: null, parents: null,
  columninheritance: columns.map(name => [name, true, 0]),
  indexparents: [
    { index: 'messages_inserted_at_topic_index', sequence: null, parentIndex: null, parentIndexTable: null },
    { index: 'messages_pkey', sequence: null, parentIndex: null, parentIndexTable: null },
  ] }, childTopology('08'), childTopology('14')];

// 원래 inventory가 담지 않는 부모/인덱스 상속을 고정 세 관계에서 추가 관측한다.
export const BUDGET_REALTIME_TOPOLOGY_SELECT = `SELECT jsonb_agg(to_jsonb(t) ORDER BY identity) AS topology FROM (
 SELECT format('%I.%I',n.nspname,c.relname) AS identity,c.relispartition,
 pg_get_expr(c.relpartbound,c.oid) AS bounds,
 (SELECT jsonb_agg(jsonb_build_object('parent',format('%I.%I',pn.nspname,pc.relname),
   'parentKind',pc.relkind,'parentPartitionKey',pg_get_partkeydef(pc.oid),
   'sequence',h.inhseqno,'detachPending',h.inhdetachpending) ORDER BY h.inhseqno)
  FROM pg_inherits h JOIN pg_class pc ON pc.oid=h.inhparent JOIN pg_namespace pn ON pn.oid=pc.relnamespace
  WHERE h.inhrelid=c.oid) AS parents,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,a.attislocal,a.attinhcount) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columnInheritance,
 (SELECT jsonb_agg(jsonb_build_object('index',ic.relname,'parentIndex',pic.relname,'sequence',ih.inhseqno,
   'parentIndexTable',CASE WHEN pct.oid IS NOT NULL THEN format('%I.%I',pnt.nspname,pct.relname) END) ORDER BY ic.relname)
  FROM pg_index ix JOIN pg_class ic ON ic.oid=ix.indexrelid LEFT JOIN pg_inherits ih ON ih.inhrelid=ic.oid
  LEFT JOIN pg_class pic ON pic.oid=ih.inhparent LEFT JOIN pg_index pix ON pix.indexrelid=pic.oid
  LEFT JOIN pg_class pct ON pct.oid=pix.indrelid LEFT JOIN pg_namespace pnt ON pnt.oid=pct.relnamespace
  WHERE ix.indrelid=c.oid) AS indexParents
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='realtime' AND c.relname IN ('messages','messages_2026_09_08','messages_2026_09_14')
) t`;

// 외부에서 새 날짜나 원문 hash를 받아 자동 승인하는 validator가 아니다. loader가 고정 원문을 먼저 검증한다.
export function validateBudgetRealtimeSupplement({ parent, baseline, supplement, proof }) {
  requireRelease(supplement.version === 1 && supplement.kind === 'amora-budget-decision-exact-realtime-supplement'
    && supplement.projectRef === parent.hotfix.projectRef && supplement.systemIdentifier === parent.hotfix.systemIdentifier,
  'REALTIME_SUPPLEMENT_IDENTITY_INVALID');
  requireRelease(supplement.parentContract.sha256 === parent.hotfixSha256 && supplement.parentBaselineSha256 === parent.baselineSha256,
    'REALTIME_SUPPLEMENT_PARENT_MISMATCH');
  validateObservation(baseline, parent.contract);
  for (const field of fields) same(baseline[field], parent.baseline[field], 'REALTIME_SUPPLEMENT_UNAPPROVED_DRIFT');
  const key = row => `${row.kind}:${row.identity}`;
  const before = new Map(parent.baseline.objects.map(row => [key(row), row.sha256]));
  const after = new Map(baseline.objects.map(row => [key(row), row.sha256]));
  const delta = [...new Set([...before.keys(), ...after.keys()])].sort().filter(id => before.get(id) !== after.get(id))
    .map(identity => ({ identity, beforeSha256: before.get(identity) ?? null, afterSha256: after.get(identity) ?? null }));
  same(delta, supplement.objects, 'REALTIME_SUPPLEMENT_UNAPPROVED_DRIFT');
  requireRelease(delta.length === 3, 'REALTIME_SUPPLEMENT_UNAPPROVED_DRIFT');
  same(baseline.relations, [...parent.baseline.relations.filter(row => row.schema !== 'realtime' || row.name !== OLD),
    { schema: 'realtime', name: NEW, kind: 'r' }].sort((a, b) => `${a.schema}.${a.name}` < `${b.schema}.${b.name}` ? -1 : 1),
  'REALTIME_SUPPLEMENT_RELATIONS_CHANGED');
  requireRelease(proof.format === 'amora-budget-realtime-proof-v1' && proof.sourceCommit === 'a4580a20cb2936b294ff1336df95592d3aaf9861',
    'REALTIME_PROOF_SOURCE_CHANGED');
  for (const [value, pin] of [[proof.structure.rawText, STRUCTURE_RAW_SHA], [proof.structure.queryText, STRUCTURE_QUERY_SHA],
    [proof.baseline.rawText, BASELINE_RAW_SHA], [proof.baseline.queryText, BASELINE_QUERY_SHA]])
    requireRelease(typeof value === 'string' && digest(value) === pin, 'REALTIME_PROOF_BYTES_CHANGED');
  const raw = JSON.parse(proof.structure.rawText), full = JSON.parse(proof.baseline.rawText);
  requireRelease(raw.length === 1 && full.length === 1, 'REALTIME_PROOF_SHAPE_INVALID');
  const structure = raw[0].observation;
  same(full[0].observation, baseline, 'REALTIME_BASELINE_RAW_MISMATCH');
  requireRelease(structure.format === 'realtime-partition-structure-raw-v1' && structure.readOnly === true
    && structure.systemIdentifier === parent.hotfix.systemIdentifier && structure.oldPartitionAbsent === true,
  'REALTIME_PROOF_IDENTITY_INVALID');
  // 실제 구조 원문이 전체 관측보다 먼저다. 순서를 바꾸지 않고 15분 내 같은 object hash를 교차 확인한다.
  const gap = Date.parse(baseline.observedAt) - Date.parse(structure.observedAt);
  requireRelease(gap >= 0 && gap <= 15 * 60_000, 'REALTIME_PROOF_TIME_INVALID');
  const partition = structure.partition, publication = structure.publication;
  same([partition.identity, partition.priorIdentity], [`realtime.${NEW}`, `realtime.${OLD}`], 'REALTIME_PARTITION_CHANGED');
  same(partition.currentSha256, objectHash(baseline, 'relation', partition.identity), 'REALTIME_PARTITION_CHANGED');
  same(partition.priorReconstructedSha256, objectHash(parent.baseline, 'relation', partition.priorIdentity), 'REALTIME_PARTITION_CHANGED');
  const prior = structuredClone(partition.definition);
  prior.partition = "FOR VALUES FROM ('2026-09-07 00:00:00') TO ('2026-09-08 00:00:00')";
  // 치환은 index DDL과 constraint 이름뿐이다. 정책·기본값·트리거 본문은 건드리지 않는다.
  prior.constraints = prior.constraints.map(row => [row[0] === `${NEW}_pkey` ? `${OLD}_pkey` : row[0], ...row.slice(1)]);
  prior.indexes = prior.indexes.map(row => [row[0].replace(/^(CREATE (?:UNIQUE )?INDEX )messages_2026_09_14(_(?:inserted_at_topic_idx|pkey) ON realtime\.)messages_2026_09_14( USING )/, (_match, start, middle, end) => `${start}${OLD}${middle}${OLD}${end}`), ...row.slice(1)]);
  same(prior, partition.priorReconstructedDefinition, 'REALTIME_PARTITION_RECONSTRUCTION_CHANGED');
  same(partition.definition.partition, childTopology('14').bounds, 'REALTIME_PARTITION_CHANGED');
  same(publication.identity, 'supabase_realtime_messages_publication', 'REALTIME_PUBLICATION_CHANGED');
  same(publication.currentSha256, objectHash(baseline, 'publication', publication.identity), 'REALTIME_PUBLICATION_CHANGED');
  same(publication.priorReconstructedSha256, objectHash(parent.baseline, 'publication', publication.identity), 'REALTIME_PUBLICATION_CHANGED');
  const priorPublication = structuredClone(publication.definition);
  requireRelease(priorPublication.tables.filter(row => row.schemaname === 'realtime' && row.tablename === NEW).length === 1, 'REALTIME_PUBLICATION_CHANGED');
  priorPublication.tables = priorPublication.tables.map(row => row.schemaname === 'realtime' && row.tablename === NEW ? { ...row, tablename: OLD } : row)
    .sort((a, b) => `${a.schemaname}.${a.tablename}` < `${b.schemaname}.${b.tablename}` ? -1 : 1);
  same(priorPublication, publication.priorReconstructedDefinition, 'REALTIME_PUBLICATION_RECONSTRUCTION_CHANGED');
  same(structure.unchangedReferences.map(row => row.identity), ['realtime.messages', 'realtime.messages_2026_09_08'], 'REALTIME_REFERENCE_CHANGED');
  for (const row of structure.unchangedReferences) {
    same(row.sha256, objectHash(parent.baseline, 'relation', row.identity), 'REALTIME_REFERENCE_CHANGED');
    same(row.sha256, objectHash(baseline, 'relation', row.identity), 'REALTIME_REFERENCE_CHANGED');
  }
  same(structure.topology, EXPECTED_TOPOLOGY, 'REALTIME_TOPOLOGY_CHANGED');
  return structure;
}

export function loadEffectiveBudgetDecisionHotfixRelease(repoRoot) {
  const parent = loadBudgetDecisionHotfixRelease(repoRoot);
  return withEffectiveBaseline(repoRoot, parent);
}

// 고정 선행 계약을 새 계약에서 읽는 전용 경로이며, 기존 공개 모드의 SQL 발견 검사를 대체하지 않는다.
export function loadEffectiveBudgetDecisionHistoricalRelease(repoRoot) {
  return withEffectiveBaseline(repoRoot, loadBudgetDecisionHistoricalRelease(repoRoot));
}

function withEffectiveBaseline(repoRoot, parent) {
  const supplementBytes = pinnedArtifact(repoRoot, { file: BUDGET_REALTIME_SUPPLEMENT_FILE, sha256: SUPPLEMENT_SHA });
  const supplement = JSON.parse(supplementBytes);
  const baselineBytes = pinnedArtifact(repoRoot, supplement.effectiveBaseline);
  const baseline = JSON.parse(baselineBytes);
  const proof = JSON.parse(pinnedArtifact(repoRoot, supplement.proof));
  validateBudgetRealtimeSupplement({ parent, baseline, supplement, proof });
  return { ...parent, parentOperatingBaseline: parent.hotfix.operatingBaseline, parentBaselineSha256: parent.baselineSha256,
    effectiveOperatingBaseline: supplement.effectiveBaseline, baseline, baselineSha256: digest(baselineBytes),
    effectiveBaselineSha256: digest(baselineBytes), baselineSupplement: supplement, baselineSupplementSha256: digest(supplementBytes) };
}

export function budgetRealtimeBindings(release) {
  return release.baselineSupplement ? { baselineSupplementSha256: release.baselineSupplementSha256,
    effectiveBaselineSha256: release.effectiveBaselineSha256 } : {};
}
export function assertBudgetRealtimeBindings(value, release) {
  for (const [field, expected] of Object.entries(budgetRealtimeBindings(release)))
    requireRelease(value?.[field] === expected, 'REALTIME_SUPPLEMENT_BINDING_INVALID');
}
export function renderBudgetRealtimeTopologyGuard(release) {
  if (!release.baselineSupplement) return '';
  return `DO $realtime_topology$ DECLARE actual jsonb; BEGIN
 SELECT topology INTO actual FROM (${BUDGET_REALTIME_TOPOLOGY_SELECT}) observed;
 IF actual IS DISTINCT FROM ${literal(JSON.stringify(EXPECTED_TOPOLOGY))}::jsonb
   OR to_regclass('realtime.messages_2026_09_07') IS NOT NULL
 THEN RAISE EXCEPTION 'HOTFIX_REALTIME_TOPOLOGY_CHANGED'; END IF;
 END $realtime_topology$;`;
}
export function renderBudgetRealtimeObservationSql(release, releaseCommit) {
  requireRelease(release.baselineSupplement && /^[a-f0-9]{40}$/.test(releaseCommit), 'REALTIME_SUPPLEMENT_BINDING_INVALID');
  return `BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public;
${renderBudgetRealtimeTopologyGuard(release)}
SELECT jsonb_build_object('format','amora-budget-realtime-observation-v1','readOnly',current_setting('transaction_read_only')='on',
'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'observedAt',clock_timestamp(),
'releaseCommit',${literal(releaseCommit)},'baselineSupplementSha256',${literal(release.baselineSupplementSha256)},
'effectiveBaselineSha256',${literal(release.effectiveBaselineSha256)},'oldPartitionAbsent',to_regclass('realtime.messages_2026_09_07') IS NULL,
 'topology',(${BUDGET_REALTIME_TOPOLOGY_SELECT})) AS observation; COMMIT;`;
}
export function validateBudgetRealtimeObservation({ release, evidence, raw, now }) {
  if (!release.baselineSupplement) return Infinity;
  assertBudgetRealtimeBindings(evidence, release);
  const receipt = evidence.realtimeTopology;
  requireRelease(receipt && receipt.querySha256 === digest(renderBudgetRealtimeObservationSql(release, evidence.releaseCommit))
    && typeof raw === 'string' && receipt.rawEvidence.sha256 === digest(raw), 'REALTIME_FRESH_PROOF_UNBOUND');
  const rows = JSON.parse(raw);
  requireRelease(Array.isArray(rows) && rows.length === 1, 'REALTIME_FRESH_PROOF_INVALID');
  const observed = rows[0].observation;
  assertBudgetRealtimeBindings(observed, release);
  requireRelease(observed?.format === 'amora-budget-realtime-observation-v1' && observed.readOnly === true
    && observed.systemIdentifier === release.hotfix.systemIdentifier && observed.releaseCommit === evidence.releaseCommit
    && observed.oldPartitionAbsent === true, 'REALTIME_FRESH_PROOF_INVALID');
  same(observed.topology, EXPECTED_TOPOLOGY, 'REALTIME_TOPOLOGY_CHANGED');
  const instant = Date.parse(observed.observedAt), time = now.getTime();
  requireRelease(Number.isFinite(instant) && instant <= time + 10_000 && instant > time - 30 * 60_000
    && instant >= Date.parse(release.baseline.observedAt), 'REALTIME_FRESH_PROOF_EXPIRED');
  return instant + 30 * 60_000;
}
