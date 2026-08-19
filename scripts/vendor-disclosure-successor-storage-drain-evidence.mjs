#!/usr/bin/env node

import { resolve } from "node:path";

import {
  captureVendorDisclosureSuccessorStorageDrainEvidence,
  VendorDisclosureSuccessorStorageControlsError,
} from "./lib/vendor-disclosure-successor-storage-controls.mjs";

const allowed = new Set([
  "--expected-commit",
  "--receipt-directory",
  "--site-url",
  "--stage",
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
const stage = options["--stage"];
const required = stage === "start"
  ? ["--expected-commit", "--receipt-directory", "--site-url", "--stage"]
  : ["--expected-commit", "--receipt-directory", "--stage"];
if (!required.every((key) => options[key])
    || Object.keys(options).length !== required.length
    || !["start", "first", "final"].includes(stage)) {
  console.error("SUCCESSOR_STORAGE_ARGUMENT_INVALID");
  process.exit(1);
}

try {
  const result = await captureVendorDisclosureSuccessorStorageDrainEvidence({
    repoRoot: resolve(import.meta.dirname, ".."),
    expectedCommit: options["--expected-commit"],
    receiptDirectory: options["--receipt-directory"],
    siteUrl: options["--site-url"],
    stage,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof VendorDisclosureSuccessorStorageControlsError
    ? error.code
    : error?.code ?? "SUCCESSOR_STORAGE_UNEXPECTED_FAILURE");
  process.exitCode = 1;
}
