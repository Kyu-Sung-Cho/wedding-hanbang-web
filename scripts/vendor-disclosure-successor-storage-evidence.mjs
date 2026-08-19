#!/usr/bin/env node

import { resolve } from "node:path";

import {
  emitVendorDisclosureSuccessorStorageEvidence,
  SuccessorStorageEvidenceError,
} from "./lib/vendor-disclosure-successor-storage-evidence.mjs";

const allowed = new Set([
  "--expected-commit",
  "--original-bytes-backup-receipt",
  "--receipt-root",
  "--remote-ref",
  "--storage-drain-receipt-directory",
  "--write-fence-receipt",
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
  console.error("SUCCESSOR_STORAGE_ARGUMENT_INVALID");
  process.exit(1);
}

try {
  const result = await emitVendorDisclosureSuccessorStorageEvidence({
    repoRoot: resolve(import.meta.dirname, ".."),
    receiptRoot: options["--receipt-root"],
    expectedCommit: options["--expected-commit"],
    remoteRef: options["--remote-ref"],
    storageDrainReceiptDirectory:
      options["--storage-drain-receipt-directory"],
    writeFenceReceiptPath: options["--write-fence-receipt"],
    originalBytesBackupReceiptPath:
      options["--original-bytes-backup-receipt"],
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof SuccessorStorageEvidenceError
      ? error.code
      : "SUCCESSOR_STORAGE_UNEXPECTED_FAILURE",
  );
  process.exitCode = 1;
}
