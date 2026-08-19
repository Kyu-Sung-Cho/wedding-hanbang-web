#!/usr/bin/env node

import { resolve } from "node:path";

import {
  validateCompletedStorageDrainEvidence,
} from "./lib/storage-signed-upload-drain-evidence.mjs";
import {
  validateSuccessorReleaseContract,
} from "./lib/supabase-successor-release-contract.mjs";
import {
  captureVendorDisclosureSuccessorStorageOriginalBytesBackup,
  VendorDisclosureSuccessorStorageOriginalBytesError,
} from "./lib/vendor-disclosure-successor-storage-original-bytes.mjs";

const allowed = new Set([
  "--artifact-root",
  "--backup-set-id",
  "--expected-commit",
  "--storage-drain-receipt-directory",
]);
const options = {};
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf("=");
  const key = separator > 0 ? argument.slice(0, separator) : "";
  const value = separator > 0 ? argument.slice(separator + 1) : "";
  if (!allowed.has(key) || !value || Object.hasOwn(options, key)) {
    console.error("SUCCESSOR_STORAGE_ORIGINAL_BYTES_ARGUMENT_INVALID");
    process.exit(1);
  }
  options[key] = value;
}
if (Object.keys(options).length !== allowed.size) {
  console.error("SUCCESSOR_STORAGE_ORIGINAL_BYTES_ARGUMENT_INVALID");
  process.exit(1);
}

try {
  const repoRoot = resolve(import.meta.dirname, "..");
  const state = validateSuccessorReleaseContract({ repoRoot });
  if (state.deploymentBlocked !== false || state.controllerReady !== true
      || !state.controllerManifest) {
    throw new VendorDisclosureSuccessorStorageOriginalBytesError(
      "SUCCESSOR_STORAGE_CONTROLLER_INVALID",
    );
  }
  const drain = await validateCompletedStorageDrainEvidence({
    repoRoot,
    receiptDirectory: options["--storage-drain-receipt-directory"],
    manifest: state.controllerManifest,
    expectedCommit: options["--expected-commit"],
  });
  const result = await captureVendorDisclosureSuccessorStorageOriginalBytesBackup({
    repoRoot,
    artifactRoot: options["--artifact-root"],
    expectedCommit: options["--expected-commit"],
    controllerManifest: state.controllerManifest,
    drain,
    backupSetId: options["--backup-set-id"],
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof VendorDisclosureSuccessorStorageOriginalBytesError
    ? error.code
    : error?.code ?? "SUCCESSOR_STORAGE_ORIGINAL_BYTES_UNEXPECTED_FAILURE");
  process.exitCode = 1;
}
