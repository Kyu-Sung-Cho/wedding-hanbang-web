import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createExplicitBudgetHistoricalRepository } from './fixtures/explicit-budget-historical-repository.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const historical = createExplicitBudgetHistoricalRepository(root);
test.after(historical.cleanup);
const mode = '--amora-explicit-budget-hotfix';
const run = (repo, args) => spawnSync(process.execPath, [join(repo, 'scripts/supabase-release-fence.mjs'), ...args], {
  cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 30000,
});
const output = result => `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const current = JSON.parse(readFileSync(join(root, 'supabase/release-contracts/amora-explicit-budget-hotfix-v1.json'), 'utf8'));
const base = JSON.parse(readFileSync(join(root, 'supabase/release-contracts/current-baseline-rollout-v1.json'), 'utf8'));

test('the original no-argument fence still rejects the new SQL outside its historical release', () => {
  const result = run(root, []);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /MIGRATION_SET_DRIFT/);
});

test('explicit-budget mode validates only its exact historical checkout without claiming hosted readiness', () => {
  const result = run(historical.root, [mode]);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /Explicit-budget static contract verified/);
  assert.match(output(result), /hosted evidence not verified; deployment not authorized/);
  const currentResult = run(root, [mode]);
  assert.equal(currentResult.status, 1, output(currentResult));
  assert.match(output(currentResult), /NEW_MIGRATION_NOT_REVIEWED/);
});

test('the actual CI local-fence command selects a working non-deploy contract', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const commands = [...workflow.matchAll(/^\s+run: pnpm supabase:release:fence([^\r\n]*)$/gm)];
  assert.equal(commands.length, 1);
  const args = commands[0][1].trim().split(/\s+/).filter(Boolean);
  const result = run(root, args);
  assert.equal(result.status, 0, output(result));
  assert.deepEqual(args, ['--wedding-code-research-scene-v09']);
});

test('explicit static mode rejects remote, duplicate and unknown arguments before any legacy flow', async t => {
  for (const args of [[mode, '--remote'], [mode, '--expect=clean'], [mode, '--refuse-direct-push'],
    [mode, mode], [mode, '--unknown'], [mode, '--apply'], [mode, '--finalize'], [mode, '--project-ref=other']]) {
    await t.test(args.join(' '), () => {
      const result = run(root, args);
      assert.equal(result.status, 1, output(result));
      assert.match(output(result), /EXPLICIT_BUDGET_STATIC_ARGUMENTS_INVALID/);
      assert.doesNotMatch(output(result), /verified|Remote pending set/i);
    });
  }
});

test('the explicit CLI rejects new, historical and contract byte drift instead of just accepting the extra name', async t => {
  const parent = realpathSync(tmpdir());
  const fixture = mkdtempSync(join(parent, 'explicit-budget-static-fence-'));
  const copy = file => {
    const target = join(fixture, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(historical.root, file), target);
  };
  for (const folder of ['supabase/migrations', 'supabase/release-contracts', 'supabase/release-manifests', 'scripts/lib']) {
    for (const file of readdirSync(join(historical.root, folder))) if (/\.(?:sql|json|mjs)$/.test(file)) copy(`${folder}/${file}`);
  }
  for (const pin of Object.values(base.implementation)) copy(pin.file);
  copy('scripts/supabase-release-fence.mjs');
  t.after(() => {
    const target = realpathSync(fixture);
    assert.ok(target.startsWith(parent + sep) && target !== parent);
    rmSync(target, { recursive: true });
  });
  assert.equal(run(fixture, [mode]).status, 0);
  for (const file of [`supabase/migrations/${current.migrations[0].file}`,
    `supabase/migrations/${current.reviewedLocalHistory.migrations[0].file}`,
    current.predecessor.file, current.operatingBaseline.file, current.baselineProof.file,
    'supabase/migrations/20260910160514_amora_shared_budget_decision_receipts.sql']) {
    await t.test(file, () => {
      const path = join(fixture, file), bytes = readFileSync(path);
      try {
        writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n')]));
        const result = run(fixture, [mode]);
        assert.equal(result.status, 1, output(result));
        assert.match(output(result), /ARTIFACT_HASH_MISMATCH/);
      } finally { writeFileSync(path, bytes); }
    });
  }
  for (const name of ['20260911120000_unreviewed.sql', '20260101000000_unreviewed.sql', 'unexpected.sql']) {
    await t.test(name, () => {
      const path = join(fixture, 'supabase/migrations', name);
      try {
        writeFileSync(path, 'SELECT 1;\n');
        const result = run(fixture, [mode]);
        assert.equal(result.status, 1, output(result));
        assert.match(output(result), /NEW_MIGRATION_NOT_REVIEWED/);
      } finally { rmSync(path); }
    });
  }
});
