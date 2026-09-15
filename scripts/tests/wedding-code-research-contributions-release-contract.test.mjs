import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertWeddingCodeResearchSqlScope, loadWeddingCodeResearchReleasePlan, WEDDING_CODE_RESEARCH_CONTRACT_FILE,
  WEDDING_CODE_RESEARCH_SCOPE } from '../lib/wedding-code-research-contributions-release-contract.mjs';
import { loadNotApplicableStatusReleasePlan } from '../lib/amora-not-applicable-status-release-contract.mjs';
import { createNotApplicableStatusHistoricalRepository } from './fixtures/amora-not-applicable-status-historical-repository.mjs';
import { validateSuccessorReleaseContract } from '../lib/supabase-successor-release-contract.mjs';
import { runProductionRelease } from '../lib/supabase-production-release-controller.mjs';

const root = resolve(import.meta.dirname, '../..');
const MIGRATION = 'supabase/migrations/20260915130000_wedding_code_research_contributions.sql';
const sql = readFileSync(join(root, MIGRATION), 'utf8');
const run = args => spawnSync(process.execPath, [join(root, 'scripts/supabase-release-fence.mjs'), ...args],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
const code = value => error => error?.code === value;

test('234 exact successor keeps all 233 pins and claims no runtime evidence, deployment or remote write', () => {
  const plan = loadWeddingCodeResearchReleasePlan(root);
  assert.equal(plan.migrationCount, 234); assert.equal(plan.followupMigrations.length, 8);
  assert.deepEqual(plan.followupMigrations.at(-1), { file: '20260915130000_wedding_code_research_contributions.sql', version: '20260915130000' });
  assert.deepEqual(plan.followupMigrations.at(-2), { file: '20260915101500_amora_atomic_not_applicable_status.sql', version: '20260915101500' });
  for (const key of ['runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed']) assert.equal(plan[key], false);
  assert.deepEqual(plan.contract.scope, JSON.parse(JSON.stringify(WEDDING_CODE_RESEARCH_SCOPE)));
  assert.equal(plan.contract.scope.personalData, 'none'); assert.equal(plan.contract.scope.retiredCollectionObjects, 'untouched');
  assert.throws(() => loadNotApplicableStatusReleasePlan(root), code('NEW_MIGRATION_NOT_REVIEWED'));
  const successor = validateSuccessorReleaseContract({ repoRoot: root, followup: 'wedding-code-research-contributions' });
  assert.equal(successor.deploymentBlocked, true); assert.equal(successor.controllerReady, false);
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root, followup: 'amora-not-applicable-status' }), code('FOLLOWUP_RELEASE_INVALID'));
  assert.throws(() => validateSuccessorReleaseContract({ repoRoot: root }), code('MIGRATION_SET_DRIFT'));
  const result = run(['--wedding-code-research-contributions']); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /234 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes/);
});

test('mixed static modes and incomplete runtime commands fail before any network call', async () => {
  for (const extra of ['--apply', '--remote', '--amora-not-applicable-status', '--wedding-code-research-contributions', '--unknown']) {
    const result = run(['--wedding-code-research-contributions', extra]);
    assert.equal(result.status, 1); assert.match(result.stderr, /WEDDING_CODE_RESEARCH_STATIC_ARGUMENTS_INVALID/);
  }
  let calls = 0;
  await assert.rejects(runProductionRelease({ repoRoot: root, argv: ['--wedding-code-research-contributions', '--apply'],
    runCommand: async () => { calls++; } }), code('WEDDING_CODE_RESEARCH_ARGUMENT_INVALID'));
  assert.equal(calls, 0);
});

test('the reviewed SQL keeps the privacy and privilege shape; planted violations are rejected statically', () => {
  assert.equal(assertWeddingCodeResearchSqlScope(sql), sql);
  const violations = {
    'drops SECURITY DEFINER': ['LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path', 'LANGUAGE plpgsql\nSET search_path'],
    'switches to SECURITY INVOKER': ['LANGUAGE plpgsql\nSECURITY DEFINER\n', 'LANGUAGE plpgsql\nSECURITY INVOKER\n'],
    'widens search_path': ["SET search_path = ''\nAS $function$", "SET search_path = public\nAS $function$"],
    'grants the table to anon': ['REVOKE ALL ON TABLE public.wedding_code_research_contributions FROM PUBLIC, anon, authenticated, service_role;',
      'REVOKE ALL ON TABLE public.wedding_code_research_contributions FROM PUBLIC, anon, authenticated, service_role;\nGRANT SELECT ON TABLE public.wedding_code_research_contributions TO anon;'],
    'grants a function to authenticated': ['GRANT EXECUTE ON FUNCTION public.delete_wedding_code_research_contribution(bytea) TO service_role;',
      'GRANT EXECUTE ON FUNCTION public.delete_wedding_code_research_contribution(bytea) TO authenticated;'],
    'keeps anon execute': ['REVOKE ALL ON FUNCTION public.purge_expired_wedding_code_research_contributions()\n  FROM PUBLIC, anon, authenticated;',
      'REVOKE ALL ON FUNCTION public.purge_expired_wedding_code_research_contributions()\n  FROM PUBLIC;'],
    'loosens the answer code regex': ["answer_code ~ '^[A-D-]{20}$'", "answer_code ~ '^[A-Da-d-]{1,40}$'"],
    'accepts an all-skip answer code': [" AND answer_code ~ '[A-D]'", ''],
    'lengthens retention': ["expires_at <= created_at + interval '60 days'", "expires_at <= created_at + interval '365 days'"],
    'drops the tombstone insert': ['ON CONFLICT (deletion_receipt_hash) DO NOTHING;', 'ON CONFLICT (deletion_receipt_hash) DO UPDATE SET deleted_at = now();'],
    'adds a user id join key': ['  answer_code text NOT NULL\n', '  user_id uuid,\n  answer_code text NOT NULL\n'],
    'references the retired collection table': ['DO $verify_wedding_code_research$', 'SELECT 1 FROM public.wedding_code_responses;\nDO $verify_wedding_code_research$'],
    'adds a policy': ['ALTER TABLE public.wedding_code_research_deletion_tombstones ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE public.wedding_code_research_deletion_tombstones ENABLE ROW LEVEL SECURITY;\nCREATE POLICY open ON public.wedding_code_research_contributions USING (true);'],
    'disables row level security': ['ALTER TABLE public.wedding_code_research_contributions ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE public.wedding_code_research_contributions DISABLE ROW LEVEL SECURITY;'],
    'writes the migration ledger': ['\n\nCOMMIT;\n', "\nINSERT INTO supabase_migrations.schema_migrations(version) VALUES ('1');\n\nCOMMIT;\n"],
    'commits early': ['CREATE INDEX wcr_tombstones_expires_at_idx', 'COMMIT;\nBEGIN;\nCREATE INDEX wcr_tombstones_expires_at_idx'],
    'uses CRLF bytes': ['BEGIN;\n', 'BEGIN;\r\n'],
    'adds a non-comment preamble': ['BEGIN;\n', 'SET ROLE postgres;\nBEGIN;\n'],
  };
  for (const [name, [before, after]] of Object.entries(violations)) {
    assert.ok(sql.includes(before), name);
    assert.throws(() => assertWeddingCodeResearchSqlScope(sql.replace(before, () => after)), code('WEDDING_CODE_RESEARCH_SQL_SCOPE_CHANGED'), name);
  }
});

test('every new artifact, predecessor and unregistered migration is fail-closed', t => {
  const fixture = createNotApplicableStatusHistoricalRepository(root); t.after(fixture.cleanup);
  const plan = loadWeddingCodeResearchReleasePlan(root);
  const paths = [WEDDING_CODE_RESEARCH_CONTRACT_FILE, plan.contract.runtime.file, MIGRATION];
  assert.throws(() => loadWeddingCodeResearchReleasePlan(fixture.root));
  assert.equal(loadNotApplicableStatusReleasePlan(fixture.root).migrationCount, 233);
  for (const path of paths) { mkdirSync(dirname(join(fixture.root, path)), { recursive: true }); copyFileSync(join(root, path), join(fixture.root, path)); }
  assert.equal(loadWeddingCodeResearchReleasePlan(fixture.root).migrationCount, 234);
  for (const path of [...paths, plan.contract.predecessor.file, plan.contract.predecessorMigration.file,
    'scripts/lib/amora-not-applicable-status-release.mjs', 'scripts/lib/account-deletion-customer-data-release.mjs']) {
    const target = join(fixture.root, path), bytes = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([bytes, Buffer.from('\n')]));
      assert.throws(() => loadWeddingCodeResearchReleasePlan(fixture.root), code('ARTIFACT_HASH_MISMATCH'), path);
      rmSync(target); assert.throws(() => loadWeddingCodeResearchReleasePlan(fixture.root), Error, path);
    } finally { writeFileSync(target, bytes); }
  }
  assert.equal(loadWeddingCodeResearchReleasePlan(fixture.root).migrationCount, 234);
  for (const name of ['20260916000000_unknown.sql', '20260101000000_unknown.sql', 'unexpected.sql']) {
    const target = join(fixture.root, 'supabase/migrations', name);
    try { writeFileSync(target, 'SELECT 1;\n', { flag: 'wx' }); assert.throws(() => loadWeddingCodeResearchReleasePlan(fixture.root), code('NEW_MIGRATION_NOT_REVIEWED')); }
    finally { rmSync(target); }
  }
});
