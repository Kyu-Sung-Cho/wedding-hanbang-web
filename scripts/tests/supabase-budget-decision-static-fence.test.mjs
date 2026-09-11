import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createBudgetDecisionHistoricalRepository } from './fixtures/budget-decision-historical-repository.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mode = '--amora-budget-decision-hotfix';
const run = (repo, args) => spawnSync(process.execPath, [join(repo, 'scripts/supabase-release-fence.mjs'), ...args], {
  cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 30000,
});
const output = result => `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const current = JSON.parse(readFileSync(join(root, 'supabase/release-contracts/amora-budget-decision-hotfix-v1.json'), 'utf8'));
const base = JSON.parse(readFileSync(join(root, 'supabase/release-contracts/current-baseline-rollout-v1.json'), 'utf8'));
const historical = createBudgetDecisionHistoricalRepository(root);
after(() => historical.cleanup());
// 실행 코드는 이번 checkout, 입력 계약과 SQL은 고정 M4 원문을 사용한다.
for (const file of readdirSync(join(root, 'scripts/lib'))) {
  if (file.endsWith('.mjs')) copyFileSync(join(root, 'scripts/lib', file), join(historical.root, 'scripts/lib', file));
}
copyFileSync(join(root, 'scripts/supabase-release-fence.mjs'), join(historical.root, 'scripts/supabase-release-fence.mjs'));

test('the original no-argument fence still rejects the new SQL outside its historical release', () => {
  const result = run(root, []);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /MIGRATION_SET_DRIFT/);
});

test('budget-decision mode validates its fixed M4 inputs without claiming hosted readiness', () => {
  const result = run(historical.root, [mode]);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /Budget-decision static contract verified/);
  assert.match(output(result), /hosted evidence not verified; deployment not authorized/);
});

test('budget-decision mode still rejects the unreviewed next SQL in the current checkout', () => {
  const result = run(root, [mode]);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /NEW_MIGRATION_NOT_REVIEWED/);
});

test('explicit static mode rejects remote, duplicate and unknown arguments before any legacy flow', async t => {
  for (const args of [[mode, '--remote'], [mode, '--expect=clean'], [mode, '--refuse-direct-push'],
    [mode, mode], [mode, '--unknown'], [mode, '--apply'], [mode, '--finalize'], [mode, '--project-ref=other']]) {
    await t.test(args.join(' '), () => {
      const result = run(root, args);
      assert.equal(result.status, 1, output(result));
      assert.match(output(result), /BUDGET_DECISION_STATIC_ARGUMENTS_INVALID/);
      assert.doesNotMatch(output(result), /verified|Remote pending set/i);
    });
  }
});

test('the explicit CLI rejects new, historical and contract byte drift instead of just accepting the extra name', async t => {
  const parent = realpathSync(tmpdir());
  const fixture = mkdtempSync(join(parent, 'budget-decision-static-fence-'));
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
    current.predecessor.file, current.operatingBaseline.file]) {
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
