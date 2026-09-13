import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { CHAT_FEEDBACK_CONTRACT_FILE, CHAT_FEEDBACK_SCHEMA_CHANGE,
  loadChatFeedbackNullabilityReleasePlan } from '../lib/chat-feedback-nullability-release-contract.mjs';
import { loadExplicitBudgetHotfixRelease } from '../lib/amora-explicit-budget-release-contract.mjs';
import { digest } from '../lib/current-baseline-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

import { createChatFeedbackHistoricalRepository } from './fixtures/chat-feedback-historical-repository.mjs';
const actualRoot = resolve(import.meta.dirname, '../..');
const historical = createChatFeedbackHistoricalRepository(actualRoot);
test.after(historical.cleanup);
const root = historical.root;
const mode = '--chat-feedback-nullability';
const run = args => spawnSync(process.execPath, [join(root, 'scripts/supabase-release-fence.mjs'), ...args], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000,
});
const output = result => `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const code = expected => error => error?.code === expected;

test('only the named successor accepts exactly 228 original SQL files plus the one nullable widening', () => {
  assert.throws(() => loadChatFeedbackNullabilityReleasePlan(actualRoot), code('NEW_MIGRATION_NOT_REVIEWED'));
  const plan = loadChatFeedbackNullabilityReleasePlan(root);
  assert.equal(plan.migrationCount, 229);
  assert.deepEqual(plan.contract.allowedSchemaChanges, [CHAT_FEEDBACK_SCHEMA_CHANGE]);
  assert.equal(plan.contract.migrations.length, 1);
  assert.deepEqual(plan.contract.scope, { dataRows: 'unchanged', auth: 'unchanged', storage: 'unchanged',
    manualMessageValidation: 'unchanged', automaticMessageId: null });
  assert.equal(plan.staticVerified, true);
  assert.equal(plan.productionApplyImplemented, true);
  for (const field of ['runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed'])
    assert.equal(plan[field], false, field);
  assert.throws(() => loadExplicitBudgetHotfixRelease(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  const result = run([mode]);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /229 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes/);
});

test('new raw contract and SQL bytes are identical to their Git canonical LF bytes', () => {
  const plan = loadChatFeedbackNullabilityReleasePlan(root);
  for (const [file, sha256] of [[CHAT_FEEDBACK_CONTRACT_FILE, plan.contractSha256],
    [`supabase/migrations/${plan.contract.migrations[0].file}`, plan.migrationSha256]]) {
    const bytes = readFileSync(join(root, file));
    assert.equal(bytes.includes(13), false, file);
    assert.equal(digest(bytes), sha256);
    const raw = spawnSync('git', ['hash-object', '--no-filters', join(root,file)], { cwd: actualRoot, encoding: 'utf8', windowsHide: true });
    const canonical = spawnSync('git', ['hash-object', `--path=${file}`, join(root,file)], { cwd: actualRoot, encoding: 'utf8', windowsHide: true });
    assert.equal(raw.status, 0, output(raw));
    assert.equal(canonical.status, 0, output(canonical));
    assert.equal(raw.stdout.trim(), canonical.stdout.trim(), file);
  }
});

test('static CLI refuses operational, mixed, duplicate and unknown arguments before any remote flow', async t => {
  for (const args of [[mode, '--remote'], [mode, '--apply'], [mode, '--check-only'], [mode, '--finalize'],
    [mode, '--expect=clean'], [mode, '--refuse-direct-push'], [mode, '--amora-explicit-budget-hotfix'],
    [mode, mode], [mode, '--unknown'], [mode, '--project-ref=other']]) {
    await t.test(args.join(' '), () => {
      const result = run(args);
      assert.equal(result.status, 1, output(result));
      assert.match(output(result), /CHAT_FEEDBACK_STATIC_ARGUMENTS_INVALID/);
      assert.doesNotMatch(output(result), /verified|Remote pending set/i);
    });
  }
});

test('production dispatch requires its own exact runtime arguments and cannot use a static success as approval', async () => {
  let commands = 0;
  for (const action of ['--apply', '--inspect', '--rehearse']) {
    await assert.rejects(runProductionRelease({ repoRoot: root, argv: [mode, action],
      runCommand: async () => { commands += 1; throw new Error('COMMAND_MUST_NOT_RUN'); } }), code('CHAT_FEEDBACK_ARGUMENT_INVALID'));
  }
  assert.equal(commands, 0);
});

test('successor rejects migration, predecessor evidence and implementation drift; an extra SQL never becomes reviewed', async t => {
  const parent = realpathSync(tmpdir());
  const fixture = mkdtempSync(join(parent, 'feedback-static-contract-'));
  const copy = file => {
    const target = join(fixture, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  };
  t.after(() => {
    const target = realpathSync(fixture);
    assert.equal(dirname(target), parent);
    assert.ok(target.startsWith(parent + sep) && basename(target).startsWith('feedback-static-contract-'));
    rmSync(target, { recursive: true });
  });
  for (const folder of ['supabase/migrations', 'supabase/release-contracts', 'supabase/release-manifests', 'scripts/lib'])
    for (const file of readdirSync(join(root, folder))) if (/\.(?:sql|json|mjs)$/.test(file)) copy(`${folder}/${file}`);
  const baseline = JSON.parse(readFileSync(join(root, 'supabase/release-contracts/current-baseline-rollout-v1.json'), 'utf8'));
  for (const pin of Object.values(baseline.implementation)) copy(pin.file);
  const plan = loadChatFeedbackNullabilityReleasePlan(fixture);
  const predecessor = JSON.parse(readFileSync(join(root, plan.contract.predecessor.file), 'utf8'));
  for (const file of [CHAT_FEEDBACK_CONTRACT_FILE, `supabase/migrations/${plan.contract.migrations[0].file}`,
    `supabase/migrations/${predecessor.migrations[0].file}`,
    `supabase/migrations/${predecessor.reviewedLocalHistory.migrations[0].file}`,
    plan.contract.predecessor.file, predecessor.operatingBaseline.file, predecessor.baselineProof.file,
    baseline.implementation.inventory.file, plan.contract.runtime.file]) {
    await t.test(file, () => {
      const path = join(fixture, file), bytes = readFileSync(path);
      try {
        writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n')]));
        assert.throws(() => loadChatFeedbackNullabilityReleasePlan(fixture), code('ARTIFACT_HASH_MISMATCH'));
      } finally { writeFileSync(path, bytes); }
    });
  }
  for (const name of ['20260914000000_unreviewed.sql', '20260101000000_unreviewed.sql', 'unexpected.sql']) {
    await t.test(name, () => {
      const path = join(fixture, 'supabase/migrations', name);
      try {
        writeFileSync(path, 'SELECT 1;\n');
        assert.throws(() => loadChatFeedbackNullabilityReleasePlan(fixture), code('NEW_MIGRATION_NOT_REVIEWED'));
      } finally { rmSync(path); }
    });
  }
});
