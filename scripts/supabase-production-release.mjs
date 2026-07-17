#!/usr/bin/env node

import {
  ReleaseBlockedError,
  runProductionRelease,
} from "./lib/supabase-production-release-controller.mjs";

try {
  const result = await runProductionRelease({ argv: process.argv.slice(2) });
  process.stdout.write(`SUPABASE_PRODUCTION_RELEASE_VERIFIED: ${result.status}\n`);
} catch (error) {
  if (error instanceof ReleaseBlockedError) {
    process.stderr.write(`SUPABASE_PRODUCTION_RELEASE_BLOCKED [${error.code}]: ${error.message}\n`);
  } else {
    process.stderr.write(
      "SUPABASE_PRODUCTION_RELEASE_BLOCKED [UNEXPECTED]: unexpected local controller failure; no child output was printed\n",
    );
  }
  process.exitCode = 1;
}
