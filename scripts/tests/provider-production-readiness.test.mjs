import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { assessProviderReadiness, buildProviderReadinessSql, inspectProviderProduction } from '../lib/provider-production-readiness.mjs';
import { loadProviderParticipationReleasePlan } from '../lib/provider-participation-release-contract.mjs';
import { expectedProviderLedger, providerBundleParts } from '../lib/provider-participation-release.mjs';
import { analyzeReadOnlySqlEnvelope } from '../lib/sql-read-only-envelope.mjs';

const root = resolve(import.meta.dirname, '../..');
const plan = loadProviderParticipationReleasePlan(root);
const fixture = JSON.parse(readFileSync(join(root, plan.contract.catalogFixture.file), 'utf8'));
const now = new Date('2026-09-29T06:00:00Z');
const make = phase => {
  const allLedger = (phase === 'before' ? plan.predecessorMigrations : plan.reviewedMigrations)
    .map(pin => ({ version: pin.file.slice(0, 14), name: pin.file.slice(15, -4) }));
  return { format: 'provider-participation-observation-v1', readOnly: true, systemIdentifier: plan.contract.systemIdentifier,
    serverVersion: '17.6', database: 'postgres', observedAt: now.toISOString(), ledgerCount: allLedger.length, allLedger,
    target: structuredClone(fixture[phase]), targetLedger: phase === 'before' ? [] : expectedProviderLedger(providerBundleParts(root, plan)),
    permission: { currentUser: 'postgres', ownerUsage: true, rls: true, policyGrants: null },
    preservation: Object.fromEntries(['buckets', 'catalog', 'defaults', 'ledger', 'objects', 'roleSettings'].map(key => [key, 'a'.repeat(32)])) };
};

test('readiness query is a fixed read-only transaction and retrieves only ledger names in addition to catalog', () => {
  assert.deepEqual(analyzeReadOnlySqlEnvelope(buildProviderReadinessSql()), { ok: true });
  assert.match(buildProviderReadinessSql(), /'allLedger'/);
});

test('229-row remote history is diagnosed, never repaired or equated with the local baseline', () => {
  const observed = make('before');
  observed.allLedger = observed.allLedger.slice(12);
  observed.allLedger.push({ version: '20260820100000', name: 'community_report_privacy_reason' });
  observed.ledgerCount = observed.allLedger.length;
  const result = assessProviderReadiness(root, observed, now);
  assert.equal(result.currentLedgerCount, 229);
  assert.equal(result.schemaState, 'absent-reviewed-baseline');
  assert.equal(result.schemaReady, false);
  assert.equal(result.missingLocalVersions.length, 15);
  assert.deepEqual(result.remoteOnlyVersions, ['20260820100000']);
  assert.equal(result.historicalSchemaEquivalenceVerified, false);
  assert.equal(result.remoteWritesPerformed, false);
  assert.equal(result.releaseAuthorized, false);
});

test('exact installed schema is necessary but never becomes operational authorization', () => {
  const result = assessProviderReadiness(root, make('after'), now);
  assert.equal(result.schemaState, 'installed-exact');
  assert.equal(result.schemaReady, true);
  assert.equal(result.providerLedgerMatches, true);
  assert.equal(result.productionApplyImplemented, false);
  assert.equal(result.runtimeEvidenceVerified, false);
  assert.equal(result.releaseAuthorized, false);
});

test('provider readiness checks its exact bundle without requiring unrelated historical versions to be filled', () => {
  const observed = make('after');
  observed.allLedger = observed.allLedger.slice(12);
  observed.allLedger.push({ version: '20260820100000', name: 'community_report_privacy_reason' });
  observed.ledgerCount = observed.allLedger.length;
  const result = assessProviderReadiness(root, observed, now);
  assert.equal(result.currentLedgerCount, 232);
  assert.equal(result.schemaReady, true);
  assert.equal(result.missingLocalVersions.length, 12);
  assert.equal(result.historicalSchemaEquivalenceVerified, false);
  assert.equal(result.releaseAuthorized, false);
});

test('public bucket, permissive policy, function drift and partial ledger remain blocked', () => {
  for (const mutate of [o => { o.target.bucket.public = true; }, o => { o.target.policy[0].permissive = true; },
    o => { o.target.manifestFunction[0].body += ' '; }, o => { o.targetLedger[0].sqlMd5 = 'f'.repeat(32); }]) {
    const observation = make('after'); mutate(observation);
    const result = assessProviderReadiness(root, observation, now);
    assert.equal(result.schemaState, 'partial-or-drifted'); assert.equal(result.schemaReady, false);
  }
});

test('wrong identity, stale observations, duplicate ledger and incomplete responses fail closed', () => {
  for (const mutate of [o => { o.systemIdentifier = '123'; }, o => { o.readOnly = false; },
    o => { o.observedAt = '2020-01-01T00:00:00Z'; }, o => { o.allLedger[0] = o.allLedger[1]; },
    o => { o.targetLedger = []; }, o => { delete o.preservation; }]) {
    const observation = make('after'); mutate(observation);
    assert.throws(() => assessProviderReadiness(root, observation, now));
  }
});

test('management transport uses one fixed destination with read_only and never logs upstream failures', async () => {
  let calls = 0;
  const environment = { SUPABASE_ACCESS_TOKEN: `sbp_${'a'.repeat(40)}` };
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, `https://api.supabase.com/v1/projects/${plan.contract.projectRef}/database/query`);
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { query: buildProviderReadinessSql(), read_only: true });
    return new Response(JSON.stringify([{ observation: make('before') }]));
  };
  await assert.rejects(inspectProviderProduction({ repoRoot: root, environment: {}, fetcher }), /ACCESS_TOKEN_REQUIRED/);
  assert.equal(calls, 0);
  assert.equal((await inspectProviderProduction({ repoRoot: root, environment, fetcher, now: () => now })).readOnly, true);
  assert.equal(calls, 1);
  await assert.rejects(inspectProviderProduction({ repoRoot: root, environment, fetcher: async () => { throw new Error('secret response'); } }),
    error => error.code === 'PROVIDER_READINESS_QUERY_UNAVAILABLE' && !error.message.includes('secret'));
  await assert.rejects(inspectProviderProduction({ repoRoot: root, environment,
    fetcher: async () => new Response('secret', { status: 403 }) }), /REMOTE_QUERY_FAILED/);
});
