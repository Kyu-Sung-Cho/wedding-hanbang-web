#!/usr/bin/env node

import { resolve } from "node:path";

import {
  emitVendorDisclosureSuccessorBackupEvidence,
  SuccessorBackupEvidenceError,
} from "./lib/vendor-disclosure-successor-backup-evidence.mjs";

const allowed = new Set([
  "--expected-commit",
  "--logical-backup-directory",
  "--logical-backup-verification",
  "--receipt-root",
  "--remote-ref",
]);
const options = {};
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf("=");
  const name = separator > 0 ? argument.slice(0, separator) : "";
  const value = separator > 0 ? argument.slice(separator + 1) : "";
  if (!allowed.has(name) || !value || Object.hasOwn(options, name)) {
    process.stderr.write("SUCCESSOR_BACKUP_ARGUMENT_INVALID\n");
    process.exit(1);
  }
  options[name] = value;
}
if (Object.keys(options).length !== allowed.size) {
  process.stderr.write("SUCCESSOR_BACKUP_ARGUMENT_INVALID\n");
  process.exit(1);
}

try {
  const result = await emitVendorDisclosureSuccessorBackupEvidence({
    repoRoot: resolve(import.meta.dirname, ".."),
    receiptRoot: options["--receipt-root"],
    expectedCommit: options["--expected-commit"],
    remoteRef: options["--remote-ref"],
    logicalBackupDirectory: options["--logical-backup-directory"],
    logicalBackupVerificationPath: options["--logical-backup-verification"],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof SuccessorBackupEvidenceError
    ? error.code
    : "SUCCESSOR_BACKUP_UNEXPECTED_FAILURE"}\n`);
  process.exitCode = 1;
}
