import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CurrentBaselineBlocked } from './lib/current-baseline-release-contract.mjs';
import { inspectProviderProduction } from './lib/provider-production-readiness.mjs';

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--inspect') throw new CurrentBaselineBlocked('PROVIDER_READINESS_INSPECT_ONLY');
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const result = await inspectProviderProduction({ repoRoot });
  console.log(JSON.stringify(result));
  // A successful inspection is not a successful release check. Until the
  // operational gates have been implemented and proven this command stays red.
  process.exitCode = result.releaseAuthorized ? 0 : 2;
} catch (error) {
  console.error(`PROVIDER_READINESS_BLOCKED [${error instanceof CurrentBaselineBlocked ? error.code : 'PROVIDER_READINESS_UNAVAILABLE'}]`);
  process.exitCode = 1;
}
