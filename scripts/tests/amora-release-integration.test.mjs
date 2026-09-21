import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as preparationRelease from '../lib/preparation-style-release-contract.mjs';
import { AMORA_DECISION_PRIVACY_CANDIDATE, loadAmoraDecisionPrivacyCandidate } from '../lib/amora-decision-privacy-candidate.mjs';
import { createPreparationStyleHistoricalRepository } from './fixtures/preparation-style-historical-repository.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

const root = resolve(import.meta.dirname, '../..');

test('integrating preparation style and Amora leaves one migration per version', () => {
  const files = readdirSync(resolve(root, 'supabase/migrations')).filter(file => file.endsWith('.sql'));
  const byVersion = new Map();
  for (const file of files) {
    const version = /^(\d{14})_/.exec(file)?.[1];
    assert.ok(version, `Invalid migration version: ${file}`);
    const previous = byVersion.get(version);
    assert.equal(previous, undefined, `Duplicate migration version: ${previous} / ${file}`);
    byVersion.set(version, file);
  }
});

test('the 237 historical loader preserves reviewed pins without authorizing later Amora migrations', () => {
  assert.equal(typeof preparationRelease.loadPreparationStyleHistoricalReleasePlan, 'function');
  const previous = preparationRelease.loadPreparationStyleHistoricalReleasePlan(root);
  assert.equal(previous.migrationCount, 237);
  assert.equal(previous.releaseAuthorized, false);
  assert.equal(previous.runtimeEvidenceVerified, false);
  assert.throws(() => preparationRelease.loadPreparationStyleReleasePlan(root), { code: 'NEW_MIGRATION_NOT_REVIEWED' });
});

test('the Amora candidate checks exact integrated SQL while explicitly denying production authority', () => {
  const result = spawnSync(process.execPath, ['scripts/supabase-release-fence.mjs', '--amora-decision-privacy'],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /239 exact SQL files/);
  assert.match(result.stdout, /production apply not implemented; deployment not authorized; no remote writes/);
});

function candidateFixture() {
  const fixture = createPreparationStyleHistoricalRepository(root);
  const contract = JSON.parse(readFileSync(resolve(root, AMORA_DECISION_PRIVACY_CANDIDATE), 'utf8'));
  for (const file of [AMORA_DECISION_PRIVACY_CANDIDATE, ...contract.migrations.map(pin => `supabase/migrations/${pin.file}`)]) {
    copyFileSync(resolve(root, file), resolve(fixture.root, file));
  }
  return fixture;
}

test('candidate validation rejects altered SQL, altered authority and unreviewed extra migrations', async t => {
  for (const kind of ['sql', 'authority', 'extra', 'missing']) await t.test(kind, () => {
    const fixture = candidateFixture();
    try {
      const verified = loadAmoraDecisionPrivacyCandidate(fixture.root);
      assert.equal(verified.releaseAuthorized, false);
      assert.equal(verified.productionApplyImplemented, false);
      if (kind === 'sql') {
        const path = resolve(fixture.root, 'supabase/migrations', verified.contract.migrations[0].file);
        writeFileSync(path, readFileSync(path, 'utf8').replace('COMMIT;', 'SELECT 1;\nCOMMIT;'));
      } else if (kind === 'authority') {
        const path = resolve(fixture.root, AMORA_DECISION_PRIVACY_CANDIDATE);
        writeFileSync(path, readFileSync(path, 'utf8').replace('"productionApplyImplemented": false', '"productionApplyImplemented": true'));
      } else if (kind === 'missing') {
        unlinkSync(resolve(fixture.root, 'supabase/migrations', verified.contract.migrations[0].file));
      } else {
        writeFileSync(resolve(fixture.root, 'supabase/migrations/20260921102000_unreviewed.sql'), 'BEGIN; SELECT 1; COMMIT;\n');
      }
      assert.throws(() => loadAmoraDecisionPrivacyCandidate(fixture.root));
    } finally { fixture.cleanup(); }
  });
});

test('the production controller cannot treat candidate validation as executable authority', async () => {
  let commands = 0;
  await assert.rejects(runProductionRelease({
    repoRoot: root,
    argv: ['--amora-decision-privacy', '--check-only'],
    runCommand: async () => { commands += 1; throw Error('Unexpected command'); },
  }), { code: 'ARGUMENT_UNKNOWN' });
  assert.equal(commands, 0);
});

test('static candidate mode refuses apply, other release modes and unknown arguments', () => {
  for (const argument of ['--apply', '--preparation-style', '--unknown']) {
    const result = spawnSync(process.execPath, ['scripts/supabase-release-fence.mjs', '--amora-decision-privacy', argument],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AMORA_DECISION_PRIVACY_STATIC_ARGUMENTS_INVALID/);
    assert.doesNotMatch(result.stdout, /pins verified/);
  }
});
