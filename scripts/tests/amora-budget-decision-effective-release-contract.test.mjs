import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { digest } from '../lib/current-baseline-release-contract.mjs';
import { createSyntheticBudgetRealtimeTopology, moveSyntheticRealtimeChild } from './fixtures/budget-realtime-topology.mjs';
import { dirname, join, sep, resolve } from 'node:path';
import { loadBudgetDecisionHotfixRelease } from '../lib/amora-budget-decision-release-contract.mjs';
import { loadEffectiveBudgetDecisionHotfixRelease, validateBudgetRealtimeSupplement, budgetRealtimeBindings,
  assertBudgetRealtimeBindings, renderBudgetRealtimeTopologyGuard, renderBudgetRealtimeObservationSql, validateBudgetRealtimeObservation } from '../lib/amora-budget-decision-effective-release-contract.mjs';

const root = resolve(import.meta.dirname, '../..');

test('current supplement admits the observed September 7 to 14 rotation while preserving the historical contract', () => {
  const historical = loadBudgetDecisionHotfixRelease(root);
  const current = loadEffectiveBudgetDecisionHotfixRelease(root);
  assert.equal(historical.baseline.relations.some(row => row.name === 'messages_2026_09_07'), true);
  assert.equal(current.baseline.relations.some(row => row.name === 'messages_2026_09_07'), false);
  assert.equal(current.baseline.relations.some(row => row.name === 'messages_2026_09_14'), true);
  assert.deepEqual(current.hotfix, historical.hotfix);
  assert.equal(current.hotfixSha256, historical.hotfixSha256);
  assert.deepEqual(current.baseline.ledger, historical.baseline.ledger);
  assert.equal(current.migrationSetSha256, historical.migrationSetSha256);
});

test('effective baseline and supplement are separate mandatory bindings, not a relabeled v1 baseline', () => {
  const historical = loadBudgetDecisionHotfixRelease(root);
  const current = loadEffectiveBudgetDecisionHotfixRelease(root);
  assert.notEqual(current.baselineSha256, historical.baselineSha256);
  assert.match(current.baselineSupplementSha256, /^[a-f0-9]{64}$/);
  assert.equal(current.effectiveBaselineSha256, current.baselineSha256);
  assert.deepEqual(current.parentOperatingBaseline, historical.hotfix.operatingBaseline);
});

const semanticFixture = () => {
  const current = loadEffectiveBudgetDecisionHotfixRelease(root);
  return { parent: loadBudgetDecisionHotfixRelease(root), baseline: structuredClone(current.baseline),
    supplement: structuredClone(current.baselineSupplement),
    proof: JSON.parse(readFileSync(join(root, current.baselineSupplement.proof.file), 'utf8')) };
};

test('only the exact three objects change; role, ACL hash, ledger, managed state and fourth rotations fail', () => {
  const original = semanticFixture();
  for (const mutation of [
    f => { f.baseline.objects.find(o => o.kind === 'role').sha256 = 'f'.repeat(64); },
    f => { f.baseline.objects.find(o => o.identity === 'realtime.messages_2026_09_08').sha256 = 'f'.repeat(64); },
    f => { f.baseline.objects.find(o => o.identity === 'realtime.messages_2026_09_14').sha256 = 'f'.repeat(64); },
    f => { f.baseline.objects.find(o => o.kind === 'publication').sha256 = 'f'.repeat(64); },
    f => { f.baseline.ledger[0].name += '-changed'; },
    f => { f.baseline.cronJobs = 1; }, f => { f.baseline.vaultRows = 1; },
    f => { f.baseline.storageStructureSha256 = 'f'.repeat(64); },
    f => { f.baseline.storagePolicies.pop(); }, f => { f.baseline.relations.pop(); },
    f => { f.baseline.objects.pop(); },
    f => { f.baseline.systemIdentifier = '8000000000000000001'; },
    f => { f.baseline.cliRoleExpirations[0].validUntil = 'infinity'; },
    f => { f.supplement.parentBaselineSha256 = 'f'.repeat(64); },
  ]) { const changed = structuredClone(original); mutation(changed); assert.throws(() => validateBudgetRealtimeSupplement(changed)); }
  assert.doesNotThrow(() => validateBudgetRealtimeSupplement(original));
});

test('fixed raw SQL and response bytes prevent self-asserted reconstruction or edited observations', () => {
  const original = semanticFixture();
  for (const section of ['structure', 'baseline']) for (const field of ['rawText', 'queryText']) {
    const f = structuredClone(original); f.proof[section][field] += ' ';
    assert.throws(() => validateBudgetRealtimeSupplement(f), { code: 'REALTIME_PROOF_BYTES_CHANGED' });
  }
  for (const mutate of [
    o => { o.partition.definition.acl = []; }, o => { o.partition.definition.rls = !o.partition.definition.rls; },
    o => { o.partition.definition.columns.pop(); }, o => { o.partition.definition.indexes.pop(); },
    o => { o.partition.definition.policies = [["unexpected policy"]]; }, o => { o.partition.definition.triggers = [['new']]; },
    o => { o.partition.definition.partition = 'DEFAULT'; },
    o => { o.publication.definition.tables.pop(); }, o => { o.topology[2].parents[0].parent = 'realtime.other'; },
    o => { o.topology[2].indexparents[0].parentIndex = 'other'; },
  ]) {
    const f = structuredClone(original); const rows = JSON.parse(f.proof.structure.rawText); mutate(rows[0].observation);
    f.proof.structure.rawText = JSON.stringify(rows);
    assert.throws(() => validateBudgetRealtimeSupplement(f), { code: 'REALTIME_PROOF_BYTES_CHANGED' });
  }
});

test('missing or edited supplement assets fail closed without historical fallback', () => {
  const parent = realpathSync(tmpdir()), folder = mkdtempSync(join(parent, 'budget-realtime-loader-'));
  try {
    cpSync(join(root, 'supabase'), join(folder, 'supabase'), { recursive: true });
    const base = JSON.parse(readFileSync(join(root, 'supabase/release-contracts/current-baseline-rollout-v1.json')));
    for (const pin of Object.values(base.implementation)) {
      mkdirSync(dirname(join(folder, pin.file)), { recursive: true }); cpSync(join(root, pin.file), join(folder, pin.file));
    }
    const release = loadEffectiveBudgetDecisionHotfixRelease(folder);
    for (const file of ['supabase/release-contracts/amora-budget-decision-realtime-supplement-20260911.json',
      release.effectiveOperatingBaseline.file, release.baselineSupplement.proof.file]) {
      const target = join(folder, file), bytes = readFileSync(target);
      writeFileSync(target, Buffer.concat([bytes, Buffer.from(' ')]));
      assert.throws(() => loadEffectiveBudgetDecisionHotfixRelease(folder), { code: 'ARTIFACT_HASH_MISMATCH' });
      rmSync(target); assert.throws(() => loadEffectiveBudgetDecisionHotfixRelease(folder)); writeFileSync(target, bytes);
    }
    assert.doesNotThrow(() => loadBudgetDecisionHotfixRelease(folder));
  } finally {
    const target = realpathSync(folder); assert.ok(target.startsWith(parent + sep) && target !== parent);
    rmSync(target, { recursive: true });
  }
});

test('fresh topology requires its exact query, source, both bindings, raw hash and unexpired observation', () => {
  const release = loadEffectiveBudgetDecisionHotfixRelease(root), commit = 'a'.repeat(40);
  const proof = JSON.parse(readFileSync(join(root, release.baselineSupplement.proof.file)));
  const observation = { format: 'amora-budget-realtime-observation-v1', readOnly: true,
    systemIdentifier: release.hotfix.systemIdentifier, releaseCommit: commit, ...budgetRealtimeBindings(release),
    observedAt: '2026-09-11T06:00:00Z', oldPartitionAbsent: true,
    topology: JSON.parse(proof.structure.rawText)[0].observation.topology };
  const check = (change, editEvidence = () => {}) => {
    const o = structuredClone(observation); change(o); const raw = JSON.stringify([{ observation: o }]);
    const evidence = { releaseCommit: commit, ...budgetRealtimeBindings(release), realtimeTopology: {
      querySha256: digest(renderBudgetRealtimeObservationSql(release, commit)), rawEvidence: { file: 'raw.json', sha256: digest(raw) } } };
    editEvidence(evidence);
    return validateBudgetRealtimeObservation({ release, evidence, raw, now: new Date('2026-09-11T06:01:00Z') });
  };
  assert.equal(check(() => {}), Date.parse('2026-09-11T06:30:00Z'));
  for (const mutate of [
    o => { o.readOnly = false; }, o => { o.systemIdentifier = '8000000000000000001'; },
    o => { o.releaseCommit = 'b'.repeat(40); }, o => { o.oldPartitionAbsent = false; },
    o => { o.baselineSupplementSha256 = 'b'.repeat(64); }, o => { delete o.effectiveBaselineSha256; },
    o => { o.topology[2].parents[0].detachPending = true; },
    o => { o.topology[2].indexparents[0].parentIndex = 'other'; }, o => { o.topology.pop(); },
    o => { o.observedAt = '2026-09-11T05:00:00Z'; }, o => { o.observedAt = '2026-09-11T06:02:00Z'; },
  ]) assert.throws(() => check(mutate));
  for (const mutate of [e => { delete e.baselineSupplementSha256; }, e => { e.realtimeTopology.querySha256 = 'f'.repeat(64); },
    e => { e.realtimeTopology.rawEvidence.sha256 = 'f'.repeat(64); }]) assert.throws(() => check(() => {}, mutate));
  assert.throws(() => assertBudgetRealtimeBindings({}, release));
});

test('actual local observation query and fixed guard reject independent table and index parent drift', { timeout: 120000 }, async () => {
  const { PGlite } = createRequire(join(root, 'apps/web/package.json'))('@electric-sql/pglite');
  const db = await PGlite.create(); const release = loadEffectiveBudgetDecisionHotfixRelease(root);
  try {
    await createSyntheticBudgetRealtimeTopology(db);
    const result = await db.exec(renderBudgetRealtimeObservationSql(release, 'a'.repeat(40)));
    const observation = result.flatMap(r => r.rows ?? []).find(row => row.observation)?.observation;
    assert.equal(observation.readOnly, true); assert.equal(observation.oldPartitionAbsent, true);
    assert.equal(observation.topology.length, 3);
    assert.deepEqual(Object.fromEntries(Object.keys(budgetRealtimeBindings(release)).map(k => [k, observation[k]])), budgetRealtimeBindings(release));
    await db.exec('BEGIN'); await db.exec(moveSyntheticRealtimeChild);
    await assert.rejects(db.exec(renderBudgetRealtimeTopologyGuard(release)), /HOTFIX_REALTIME_TOPOLOGY_CHANGED/);
    await db.exec('ROLLBACK');
    await db.exec('BEGIN');
    // 합성 엔진의 카탈로그 한 행만 바꿔 기존 relation hash에서 보이지 않는 index parent를 분리한다.
    await db.exec("UPDATE pg_inherits SET inhparent='realtime.other_parent_inserted_at_topic_idx'::regclass WHERE inhrelid='realtime.messages_2026_09_14_inserted_at_topic_idx'::regclass");
    await assert.rejects(db.exec(renderBudgetRealtimeTopologyGuard(release)), /HOTFIX_REALTIME_TOPOLOGY_CHANGED/);
    await db.exec('ROLLBACK'); await db.exec(renderBudgetRealtimeTopologyGuard(release));
  } finally { await db.close(); }
});
