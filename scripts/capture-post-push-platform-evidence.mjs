#!/usr/bin/env node

import { resolve } from "node:path";

import {
  capturePostPushPlatformEvidence,
  PostPushEvidenceError,
} from "./lib/post-push-platform-evidence.mjs";

const allowed = new Set([
  "--expected-commit",
  "--backup-receipt",
  "--awaiting-outcome",
  "--receipt-out",
  "--confirm-operations",
  "--site-url",
]);
const options = {};
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf("=");
  if (separator < 1) {
    console.error("POST_PUSH_EVIDENCE_ARGUMENT_INVALID");
    process.exit(1);
  }
  const name = argument.slice(0, separator);
  const value = argument.slice(separator + 1);
  if (!allowed.has(name) || !value || Object.hasOwn(options, name)) {
    console.error("POST_PUSH_EVIDENCE_ARGUMENT_INVALID");
    process.exit(1);
  }
  options[name] = value;
}

try {
  const result = await capturePostPushPlatformEvidence({
    repoRoot: resolve(import.meta.dirname, ".."),
    expectedCommit: options["--expected-commit"],
    backupReceiptPath: options["--backup-receipt"],
    awaitingOutcomePath: options["--awaiting-outcome"],
    receiptOut: options["--receipt-out"],
    confirmOperations: options["--confirm-operations"],
    siteUrl: options["--site-url"],
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof PostPushEvidenceError
      ? error.code
      : "POST_PUSH_EVIDENCE_UNEXPECTED_FAILURE",
  );
  process.exitCode = 1;
}
