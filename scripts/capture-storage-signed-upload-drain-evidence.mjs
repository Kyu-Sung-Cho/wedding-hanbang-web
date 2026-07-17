#!/usr/bin/env node

import { resolve } from "node:path";

import {
  captureStorageSignedUploadDrainEvidence,
  StorageDrainEvidenceError,
} from "./lib/storage-signed-upload-drain-evidence.mjs";

const allowed = new Set([
  "--expected-commit",
  "--receipt-directory",
  "--site-url",
  "--stage",
]);
const options = {};
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf("=");
  if (separator < 1) {
    console.error("STORAGE_DRAIN_ARGUMENT_INVALID");
    process.exit(1);
  }
  const name = argument.slice(0, separator);
  const value = argument.slice(separator + 1);
  if (!allowed.has(name) || !value || Object.hasOwn(options, name)) {
    console.error("STORAGE_DRAIN_ARGUMENT_INVALID");
    process.exit(1);
  }
  options[name] = value;
}

try {
  const result = await captureStorageSignedUploadDrainEvidence({
    repoRoot: resolve(import.meta.dirname, ".."),
    expectedCommit: options["--expected-commit"],
    receiptDirectory: options["--receipt-directory"],
    siteUrl: options["--site-url"],
    stage: options["--stage"],
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof StorageDrainEvidenceError
      ? error.code
      : "STORAGE_DRAIN_UNEXPECTED_FAILURE",
  );
  process.exitCode = 1;
}
