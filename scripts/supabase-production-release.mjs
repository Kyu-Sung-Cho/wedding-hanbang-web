#!/usr/bin/env node

import {
  ReleaseBlockedError,
  formatAmoraWriterRetirementCliResult,
  runProductionRelease,
} from "./lib/supabase-production-release-controller.mjs";
import { CurrentBaselineBlocked } from "./lib/current-baseline-release-contract.mjs";
import { HotfixBlocked } from "./lib/amora-runtime-hotfix-controller.mjs";

try {
  const result = await runProductionRelease({ argv: process.argv.slice(2) });
  if (result.status === "release-requires-adjudication") {
    throw new HotfixBlocked("APPLY_OUTCOME_REQUIRES_ADJUDICATION");
  }
  if (process.argv.slice(2).includes("--amora-action-writer-retirement")) {
    process.stdout.write(await formatAmoraWriterRetirementCliResult({ result, repoRoot: process.cwd() }));
  } else {
    process.stdout.write(`SUPABASE_PRODUCTION_RELEASE_VERIFIED: ${result.status}\n`);
  }
} catch (error) {
  if (error instanceof ReleaseBlockedError || error instanceof CurrentBaselineBlocked || error instanceof HotfixBlocked) {
    process.stderr.write(`SUPABASE_PRODUCTION_RELEASE_BLOCKED [${error.code}]: ${error.message}\n`);
  } else {
    process.stderr.write(
      "SUPABASE_PRODUCTION_RELEASE_BLOCKED [UNEXPECTED]: unexpected local controller failure; no child output was printed\n",
    );
  }
  process.exitCode = 1;
}
