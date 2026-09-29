#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CurrentBaselineBlocked } from './lib/current-baseline-release-contract.mjs';
import { loadProviderParticipationReleasePlan } from './lib/provider-participation-release-contract.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--local-rehearsal'].includes(args[0])) throw new CurrentBaselineBlocked('PROVIDER_RELEASE_OFFLINE_ARGUMENTS_ONLY');
  // Validation precedes native process startup. No production client, URL, token,
  // receipt bypass, arbitrary SQL or apply mode is accepted by this preparation CLI.
  const plan = loadProviderParticipationReleasePlan(repoRoot);
  if (args[0] === '--local-rehearsal') {
    const { runProviderLocalRehearsal } = await import('./lib/provider-participation-release.mjs');
    process.stdout.write(`${JSON.stringify(await runProviderLocalRehearsal(repoRoot))}\n`);
  } else process.stdout.write(`${JSON.stringify({ status: 'static-verified-production-blocked', migrationCount: plan.migrationCount,
    contractSha256: plan.contractSha256, productionApplyImplemented: false, runtimeEvidenceVerified: false,
    releaseAuthorized: false, remoteWritesPerformed: false })}\n`);
} catch (error) {
  const code = error instanceof CurrentBaselineBlocked ? error.code : 'PROVIDER_RELEASE_PREPARATION_FAILED';
  process.stderr.write(`PROVIDER_RELEASE_BLOCKED [${code}]\n`); process.exitCode = 1;
}
