#!/usr/bin/env node
import { runCurrentBaselineFinalizer } from "./lib/current-baseline-finalizer.mjs";

try {
  const result = await runCurrentBaselineFinalizer({ argv: process.argv.slice(2) });
  process.stdout.write(`${JSON.stringify({ status: result.status, remoteWritesPerformed: result.remoteWritesPerformed })}\n`);
} catch (error) {
  const code = /^[A-Z0-9_]{1,100}$/.test(error?.code ?? "") ? error.code : "CURRENT_BASELINE_FINALIZER_FAILED";
  process.stderr.write(`[current-baseline-finalizer] ${code}; keep writer controls held and inspect the local receipt.\n`);
  process.exitCode = 1;
}
