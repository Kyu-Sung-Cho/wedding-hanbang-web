#!/usr/bin/env node

import {
  ProductionWriteFenceFinalizerError,
  runProductionWriteFenceFinalizer,
} from "./lib/production-write-fence-finalizer.mjs";

try {
  const result = await runProductionWriteFenceFinalizer({
    argv: process.argv.slice(2),
  });
  process.stdout.write(`PRODUCTION_WRITE_FENCE_FINALIZED: ${result.status}\n`);
} catch (error) {
  if (error instanceof ProductionWriteFenceFinalizerError) {
    process.stderr.write(
      `PRODUCTION_WRITE_FENCE_FINALIZER_BLOCKED [${error.code}]: ${error.message}\n`,
    );
  } else {
    process.stderr.write(
      "PRODUCTION_WRITE_FENCE_FINALIZER_BLOCKED [UNEXPECTED]: unexpected local controller failure; no child output was printed\n",
    );
  }
  process.exitCode = 1;
}
