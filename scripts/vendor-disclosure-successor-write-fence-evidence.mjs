#!/usr/bin/env node

import { dirname, resolve } from "node:path";

import {
  captureVendorDisclosureSuccessorWriteFenceEvidence,
  VendorDisclosureSuccessorStorageControlsError,
} from "./lib/vendor-disclosure-successor-storage-controls.mjs";

const allowed = new Set([
  "--backup-receipt",
  "--expected-commit",
  "--receipt-out",
  "--site-url",
]);
const options = {};
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf("=");
  const key = separator > 0 ? argument.slice(0, separator) : "";
  const value = separator > 0 ? argument.slice(separator + 1) : "";
  if (!allowed.has(key) || !value || Object.hasOwn(options, key)) {
    console.error("SUCCESSOR_STORAGE_ARGUMENT_INVALID");
    process.exit(1);
  }
  options[key] = value;
}
if (Object.keys(options).length !== allowed.size) {
  console.error("SUCCESSOR_STORAGE_ARGUMENT_INVALID");
  process.exit(1);
}

try {
  const result = await captureVendorDisclosureSuccessorWriteFenceEvidence({
    repoRoot: resolve(import.meta.dirname, ".."),
    expectedCommit: options["--expected-commit"],
    backupReceiptPath: options["--backup-receipt"],
    receiptOut: options["--receipt-out"],
    siteUrl: options["--site-url"],
    receiptDirectory: dirname(options["--backup-receipt"]),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof VendorDisclosureSuccessorStorageControlsError
    ? error.code
    : error?.code ?? "SUCCESSOR_STORAGE_UNEXPECTED_FAILURE");
  process.exitCode = 1;
}
