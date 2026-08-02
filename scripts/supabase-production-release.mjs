#!/usr/bin/env node

import {
  ReleaseBlockedError,
  runProductionRelease,
} from "./lib/supabase-production-release-controller.mjs";
import {
  allowlistedOperationalStatus,
  operationalFailureLine,
} from "./lib/operational-log-safety.mjs";

const RELEASE_STATUSES = new Set([
  "preflight_verified",
  "awaiting_manual_post_push_operations",
  "database_expand_verified_lease_held",
]);

try {
  const result = await runProductionRelease({ argv: process.argv.slice(2) });
  const status = allowlistedOperationalStatus(result.status, RELEASE_STATUSES);
  if (status === "unexpected_status") {
    process.stderr.write("SUPABASE_PRODUCTION_RELEASE_BLOCKED [RESULT_STATUS_INVALID]\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`SUPABASE_PRODUCTION_RELEASE_VERIFIED: ${status}\n`);
  }
} catch (error) {
  process.stderr.write(operationalFailureLine(
    "SUPABASE_PRODUCTION_RELEASE_BLOCKED",
    error,
    ReleaseBlockedError,
    "UNEXPECTED",
  ));
  process.exitCode = 1;
}
