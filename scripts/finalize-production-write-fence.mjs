#!/usr/bin/env node

import {
  ProductionWriteFenceFinalizerError,
  runProductionWriteFenceFinalizer,
} from "./lib/production-write-fence-finalizer.mjs";
import {
  allowlistedOperationalStatus,
  operationalFailureLine,
} from "./lib/operational-log-safety.mjs";

const FINALIZER_STATUSES = new Set([
  "database_finalized_local_cleanup_pending",
  "verified_success",
]);

try {
  const result = await runProductionWriteFenceFinalizer({
    argv: process.argv.slice(2),
  });
  const status = allowlistedOperationalStatus(result.status, FINALIZER_STATUSES);
  if (status === "unexpected_status") {
    process.stderr.write("PRODUCTION_WRITE_FENCE_FINALIZER_BLOCKED [RESULT_STATUS_INVALID]\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`PRODUCTION_WRITE_FENCE_FINALIZED: ${status}\n`);
  }
} catch (error) {
  process.stderr.write(operationalFailureLine(
    "PRODUCTION_WRITE_FENCE_FINALIZER_BLOCKED",
    error,
    ProductionWriteFenceFinalizerError,
    "UNEXPECTED",
  ));
  process.exitCode = 1;
}
