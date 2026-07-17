#!/usr/bin/env node

import { resolve } from "node:path";

import {
  captureProductionWriteFenceEvidence,
  WriteFenceEvidenceError,
} from "./lib/production-write-fence-evidence.mjs";

const allowed = new Set([
  "--expected-commit",
  "--backup-receipt",
  "--receipt-out",
  "--site-url",
]);
const options = {};
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf("=");
  if (separator < 1) {
    console.error("WRITE_FENCE_EVIDENCE_ARGUMENT_INVALID");
    process.exit(1);
  }
  const name = argument.slice(0, separator);
  const value = argument.slice(separator + 1);
  if (!allowed.has(name) || !value || Object.hasOwn(options, name)) {
    console.error("WRITE_FENCE_EVIDENCE_ARGUMENT_INVALID");
    process.exit(1);
  }
  options[name] = value;
}

try {
  const result = await captureProductionWriteFenceEvidence({
    repoRoot: resolve(import.meta.dirname, ".."),
    expectedCommit: options["--expected-commit"],
    backupReceiptPath: options["--backup-receipt"],
    receiptOut: options["--receipt-out"],
    siteUrl: options["--site-url"],
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof WriteFenceEvidenceError
      ? error.code
      : "WRITE_FENCE_EVIDENCE_UNEXPECTED_FAILURE",
  );
  process.exitCode = 1;
}
