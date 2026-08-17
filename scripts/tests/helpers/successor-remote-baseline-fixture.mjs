import { createHash } from "node:crypto";

export const SUCCESSOR_REMOTE_BASELINE_FIXTURE_PATH =
  "supabase/release-contracts/vendor-disclosure-production-baseline-v1-20260815.json";

const REQUIRED_RUNTIME_CHECKS = [
  "linked-project-exact",
  "remote-only-version-count-zero",
  "applied-successor-exact-prefix",
  "applied-migration-names-exact",
  "read-only-schema-preconditions-pass",
];

function sha256(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

export function attachSuccessorRemoteBaselineFixture(
  manifest,
  { observedRemoteHead = manifest.requiredRemoteHead } = {},
) {
  const appliedHeadIndex = observedRemoteHead === manifest.requiredRemoteHead
    ? -1
    : manifest.expandMigrations.findIndex(
      (entry) => entry.file.startsWith(`${observedRemoteHead}_`),
    );
  if (appliedHeadIndex < -1
      || (appliedHeadIndex === -1 && observedRemoteHead !== manifest.requiredRemoteHead)) {
    throw new Error("fixture observed remote head is outside the successor migration set");
  }
  const pending = manifest.expandMigrations.slice(appliedHeadIndex + 1);
  const contract = {
    contractVersion: 1,
    kind: "successor-production-ledger-baseline-v1",
    release: manifest.release,
    projectRef: manifest.projectRef,
    predecessorHead: manifest.requiredRemoteHead,
    observedRemoteHead,
    appliedSuccessorMigrations: manifest.expandMigrations.slice(0, appliedHeadIndex + 1),
    pendingSuccessorCount: pending.length,
    firstPendingSuccessor: pending.at(0)?.file.slice(0, 14) ?? null,
    lastPendingSuccessor: pending.at(-1)?.file.slice(0, 14) ?? null,
    requiredRuntimeChecks: REQUIRED_RUNTIME_CHECKS,
    verificationLimit:
      "ledger-version-and-name-equality-without-stored-sql-statements",
  };
  const contractText = `${JSON.stringify(contract, null, 2)}\n`;
  return {
    contract,
    contractText,
    manifest: {
      ...manifest,
      remoteBaselineContract: {
        file: SUCCESSOR_REMOTE_BASELINE_FIXTURE_PATH,
        sha256: sha256(contractText),
      },
    },
  };
}
