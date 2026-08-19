#!/usr/bin/env node

import { resolve } from "node:path";

import {
  emitVendorDisclosureSuccessorHostedStagingEvidence,
  SuccessorHostedStagingEvidenceError,
} from "./lib/vendor-disclosure-successor-hosted-staging-evidence.mjs";

const allowed = new Set([
  "--expected-commit",
  "--feature-off-receipt",
  "--postcheck-receipt",
  "--probe-receipt",
  "--receipt-root",
  "--rehearsal-provenance",
  "--remote-ref",
  "--rollback-rehearsal-receipt",
]);
const options = {};
let argumentsValid = true;
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf("=");
  const name = separator > 0 ? argument.slice(0, separator) : "";
  const value = separator > 0 ? argument.slice(separator + 1) : "";
  if (!allowed.has(name) || !value || Object.hasOwn(options, name)) {
    argumentsValid = false;
    break;
  }
  options[name] = value;
}
if (!argumentsValid || Object.keys(options).length !== allowed.size) {
  console.error("SUCCESSOR_HOSTED_STAGING_ARGUMENT_INVALID");
  process.exit(1);
}

try {
  const result = await emitVendorDisclosureSuccessorHostedStagingEvidence({
    repoRoot: resolve(import.meta.dirname, ".."),
    receiptRoot: options["--receipt-root"],
    expectedCommit: options["--expected-commit"],
    remoteRef: options["--remote-ref"],
    probeReceiptPath: options["--probe-receipt"],
    postcheckReceiptPath: options["--postcheck-receipt"],
    featureOffReceiptPath: options["--feature-off-receipt"],
    rollbackRehearsalReceiptPath: options["--rollback-rehearsal-receipt"],
    rehearsalProvenancePath: options["--rehearsal-provenance"],
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof SuccessorHostedStagingEvidenceError
      ? error.code
      : "SUCCESSOR_HOSTED_STAGING_UNEXPECTED_FAILURE",
  );
  process.exitCode = 1;
}
