#!/usr/bin/env node
import { readFileSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { digest, readAnchored } from './lib/current-baseline-release-contract.mjs';
import { ensure, SyntheticBlocked, loadRehearsalSource, validatedConnectionConfig, validateTargetPlan, runHostedSynthetic } from './lib/current-baseline-hosted-synthetic.mjs';

const help = `Rollback-only hosted synthetic SQL rehearsal (NOT a completed release certificate).
  node scripts/current-baseline-hosted-synthetic.mjs --plan <absolute-json>
    --plan-sha256 <64hex> --out <absolute-new-json>
    --execute-rollback-rehearsal <exact-test-project-ref>

The plan binds the current commit, eight reviewed migration hashes, a prior
read-only target inventory fingerprint, a synthetic UUID namespace, CA hash,
and reviewed isolation evidence. No target or credentials are discovered.
HANBANG_SYNTHETIC_DATABASE_URL is read only in memory. Direct/session PG TLS
port 5432 is required. Production ref AND system_identifier are rejected.
No COMMIT is sent; all SQL/fixtures run inside a transaction that rolls back.
Concurrency, hosted HTTP flags and external isolation need separate evidence.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(help); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    ensure(['--plan', '--plan-sha256', '--out', '--execute-rollback-rehearsal'].includes(args[i]) && args[i + 1] && !options.has(args[i]), 'CLI_ARGUMENT_INVALID');
    options.set(args[i], args[i + 1]);
  }
  ensure(options.size === 4, 'CLI_ARGUMENT_REQUIRED');
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const planPath = options.get('--plan'), output = options.get('--out');
  ensure(isAbsolute(planPath) && isAbsolute(output), 'ABSOLUTE_ARTIFACT_PATH_REQUIRED');
  const outside = file => { const delta = relative(repoRoot, file); return isAbsolute(delta) || delta === '..' || delta.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`); };
  ensure(outside(realpathSync(planPath)) && outside(realpathSync(dirname(output))), 'EXTERNAL_ARTIFACT_REQUIRED');
  ensure(!lstatSync(planPath).isSymbolicLink(), 'ARTIFACT_LINK_FORBIDDEN');
  const planBytes = readAnchored(dirname(planPath), planPath.slice(dirname(planPath).length + 1), 256 * 1024);
  ensure(digest(planBytes) === options.get('--plan-sha256'), 'TARGET_PLAN_HASH_MISMATCH');
  const plan = JSON.parse(planBytes);
  const { release, inventorySql, inventorySha256 } = loadRehearsalSource(repoRoot);
  const git = command => execFileSync('git', command, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  ensure(git(['status', '--porcelain']) === '', 'CLEAN_RELEASE_CHECKOUT_REQUIRED');
  validateTargetPlan(plan, release, { commit });
  ensure(options.get('--execute-rollback-rehearsal') === plan.projectRef, 'EXACT_TEST_PROJECT_CONFIRMATION_REQUIRED');
  const ca = readAnchored(dirname(planPath), plan.tlsCaFile, 128 * 1024).toString('utf8');
  const isolation = readAnchored(dirname(planPath), plan.isolationEvidenceFile, 4 * 1024 * 1024);
  ensure(digest(isolation) === plan.isolationEvidenceSha256, 'TARGET_ISOLATION_EVIDENCE_HASH_MISMATCH');
  const config = validatedConnectionConfig(process.env.HANBANG_SYNTHETIC_DATABASE_URL, ca, plan, release.contract.projectRef);
  const client = new Client(config);
  // 접속 전에 출력 파일을 확보하고 기존 증거를 덮어쓰지 않는다.
  writeFileSync(output, JSON.stringify({ format: 'current-baseline-hosted-synthetic-intent-v1', projectRef: plan.projectRef, commit, status: 'not-yet-connected' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  let connected = false;
  try {
    await client.connect(); connected = true;
    const report = await runHostedSynthetic({ db: client, release, plan, commit, inventorySql });
    report.provenance = { planSha256: digest(planBytes), inventorySha256,
      runnerSha256: digest(readFileSync(join(repoRoot, 'scripts/lib/current-baseline-hosted-synthetic.mjs'))),
      scenariosSha256: digest(readFileSync(join(repoRoot, 'scripts/lib/current-baseline-hosted-synthetic-scenarios.mjs'))),
      isolationEvidenceSha256: digest(isolation), transport: 'node-postgres TLS verified direct or session pooler' };
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify({ status: report.status, rollbackVerified: report.rollback.verified, evidenceComplete: false }) + '\n');
    if (report.status !== 'passed-rollback-rehearsal-only') process.exitCode = 1;
  } finally { if (connected) await client.end(); }
}
main().catch(error => {
  const code = error instanceof SyntheticBlocked ? error.code : 'SYNTHETIC_REHEARSAL_FAILED';
  process.stderr.write(JSON.stringify({ status: 'blocked-or-failed', code, evidenceComplete: false }) + '\n');
  process.exitCode = 1;
});
