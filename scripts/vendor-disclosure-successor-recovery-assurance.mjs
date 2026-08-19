#!/usr/bin/env node

import {
  SuccessorRecoveryAssuranceError,
  runVendorDisclosureSuccessorRecoveryAssuranceCli,
} from "./lib/vendor-disclosure-successor-recovery-assurance.mjs";

try {
  const result = await runVendorDisclosureSuccessorRecoveryAssuranceCli();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const code = error instanceof SuccessorRecoveryAssuranceError
    ? error.code
    : "SUCCESSOR_RECOVERY_UNEXPECTED_FAILURE";
  process.stderr.write(`SUCCESSOR_RECOVERY_ASSURANCE_BLOCKED [${code}]\n`);
  process.exitCode = 1;
}
