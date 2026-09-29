import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { buildProviderLocalBundle, providerBundleParts, runProviderLocalRehearsal } from '../lib/provider-participation-release.mjs';
import { createProviderReleaseNativeDatabase, nativeProviderReleaseAvailable } from './fixtures/provider-release-native-database.mjs';

test('owned local PostgreSQL17 verifies pinned expansion and full/late-failure rollback with no remote calls', {
  skip: nativeProviderReleaseAvailable ? false : 'native PG17 unavailable; provider release preparation NOT verified', timeout: 120000,
}, async () => {
  const result = await runProviderLocalRehearsal(resolve(import.meta.dirname, '../..'));
  assert.equal(result.status, 'local-synthetic-rollback-verified'); assert.match(result.serverVersion, /^17\./);
  assert.equal(result.migrationCount, 243); assert.equal(result.remoteCalls, 0); assert.equal(result.customerData, false);
  for (const field of ['exactTargetVerified', 'nonTargetPreservationVerified', 'existingSyntheticRowsPreserved', 'rollbackVerified', 'lateFailureRollbackVerified']) assert.equal(result[field], true);
  for (const field of ['productionApplyImplemented', 'runtimeEvidenceVerified', 'releaseAuthorized']) assert.equal(result[field], false);
});

import { loadProviderParticipationReleasePlan } from '../lib/provider-participation-release-contract.mjs';
import { providerTargetCatalogSql } from '../lib/provider-participation-catalog.mjs';

test('native catalog captures callable RPC argument defaults even when types and body are unchanged', {
  skip: nativeProviderReleaseAvailable ? false : 'native PG17 unavailable; exact RPC argument check NOT verified', timeout: 120000,
}, async () => {
  const root = resolve(import.meta.dirname, '../..'), plan = loadProviderParticipationReleasePlan(root);
  const owned = await createProviderReleaseNativeDatabase(root, plan.predecessorMigrations);
  try {
    await owned.client.query(buildProviderLocalBundle({ parts: providerBundleParts(root, plan), localSystemIdentifier: owned.system, productionSystemIdentifier: plan.contract.systemIdentifier }));
    const capture = async () => (await owned.client.query('SELECT ' + providerTargetCatalogSql() + ' AS target')).rows[0].target;
    const before = await capture();
    const definition = (await owned.client.query("SELECT pg_get_functiondef('public.provider_public_catalog(uuid,integer)'::regprocedure) AS value")).rows[0].value;
    assert.match(definition, /p_limit integer DEFAULT 30/);
    await owned.client.query(definition.replace('p_limit integer DEFAULT 30', 'p_limit integer DEFAULT 29'));
    const after = await capture();
    const original = before.functions.find(fn => fn.name === 'provider_public_catalog');
    const changed = after.functions.find(fn => fn.name === 'provider_public_catalog');
    assert.equal(changed.args, original.args); assert.equal(changed.body, original.body);
    assert.notEqual(changed.arguments, original.arguments); assert.notDeepEqual(after, before);
    assert.match(changed.arguments, /p_limit integer DEFAULT 29/);
  } finally { await owned.client.query('ROLLBACK').catch(() => {}); await owned.close(); }
});
