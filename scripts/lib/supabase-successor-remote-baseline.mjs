const MIGRATION_VERSION = /^\d{14}$/;
const MIGRATION_FILE = /^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/;
const SAFE_PROJECT_REF = /^[a-z0-9][a-z0-9-]{3,62}$/;
const SAFE_RELEASE = /^[a-z][a-z0-9-]{2,80}$/;
const REQUIRED_RUNTIME_CHECKS = Object.freeze([
  "linked-project-exact",
  "remote-only-version-count-zero",
  "applied-successor-exact-prefix",
  "applied-migration-names-exact",
  "read-only-schema-preconditions-pass",
]);
const REMOTE_BASELINE_CONTRACT_KEYS = Object.freeze([
  "appliedSuccessorMigrations",
  "contractVersion",
  "firstPendingSuccessor",
  "kind",
  "lastPendingSuccessor",
  "observedRemoteHead",
  "pendingSuccessorCount",
  "predecessorHead",
  "projectRef",
  "release",
  "requiredRuntimeChecks",
  "verificationLimit",
]);

export function buildReadOnlyMigrationListArguments({ wrapperPath, repoRoot }) {
  if (typeof wrapperPath !== "string" || wrapperPath.length === 0
      || typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new TypeError("Supabase CLI and repository paths are required");
  }
  return [
    wrapperPath,
    "migration",
    "list",
    "--linked",
    "--workdir",
    repoRoot,
    "--agent",
    "no",
  ];
}

export function parseSupabaseMigrationList(output) {
  if (typeof output !== "string") {
    throw new TypeError("migration list output must be text");
  }
  const localVersions = [];
  const remoteVersions = [];
  const remoteOnlyVersions = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|/);
    if (!match || (!match[1] && !match[2])) continue;
    const [, localVersion, remoteVersion] = match;
    if (localVersion) localVersions.push(localVersion);
    if (remoteVersion) remoteVersions.push(remoteVersion);
    if (!localVersion && remoteVersion) remoteOnlyVersions.push(remoteVersion);
  }
  return { localVersions, remoteVersions, remoteOnlyVersions };
}

function assertOrderedUniqueVersions(values, label) {
  if (!Array.isArray(values) || values.some((value) => !MIGRATION_VERSION.test(value))) {
    throw new TypeError(`${label} must contain migration versions`);
  }
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] >= values[index]) {
      throw new TypeError(`${label} must be strictly ordered and unique`);
    }
  }
}

export function analyzeSuccessorRemoteBaseline({
  requiredRemoteHead,
  successorVersions,
  remoteVersions,
}) {
  if (!MIGRATION_VERSION.test(requiredRemoteHead ?? "")) {
    throw new TypeError("requiredRemoteHead must be one migration version");
  }
  assertOrderedUniqueVersions(successorVersions, "successorVersions");
  assertOrderedUniqueVersions(remoteVersions, "remoteVersions");

  const requiredHeadIndex = remoteVersions.indexOf(requiredRemoteHead);
  if (requiredHeadIndex < 0) {
    throw new Error("remote ledger does not contain the manifest required head");
  }
  const observedSuccessorVersions = remoteVersions.slice(requiredHeadIndex + 1);
  if (observedSuccessorVersions.length > successorVersions.length
      || observedSuccessorVersions.some(
        (version, index) => version !== successorVersions[index],
      )) {
    throw new Error("remote successor migrations must be one exact prefix of the manifest");
  }

  const appliedSuccessorVersions = successorVersions.slice(
    0,
    observedSuccessorVersions.length,
  );
  const pendingSuccessorVersions = successorVersions.slice(
    appliedSuccessorVersions.length,
  );

  return {
    status: appliedSuccessorVersions.length === 0
      ? "manifest_aligned"
      : "reconciliation_required",
    manifestRequiredRemoteHead: requiredRemoteHead,
    observedRemoteHead: remoteVersions.at(-1) ?? null,
    appliedSuccessorVersions,
    pendingSuccessorVersions,
  };
}

export function auditSuccessorRemoteBaseline({
  requiredRemoteHead,
  successorVersions,
  migrationListOutput,
}) {
  const parsed = parseSupabaseMigrationList(migrationListOutput);
  if (parsed.remoteOnlyVersions.length > 0) {
    throw new Error("remote-only migrations must be reconciled before release analysis");
  }
  return analyzeSuccessorRemoteBaseline({
    requiredRemoteHead,
    successorVersions,
    remoteVersions: parsed.remoteVersions,
  });
}

function readSuccessorVersions(manifest) {
  if (!manifest
      || typeof manifest !== "object"
      || Array.isArray(manifest)
      || !SAFE_RELEASE.test(manifest.release ?? "")
      || !SAFE_PROJECT_REF.test(manifest.projectRef ?? "")
      || !MIGRATION_VERSION.test(manifest.requiredRemoteHead ?? "")
      || !Array.isArray(manifest.expandMigrations)
      || manifest.expandMigrations.length === 0) {
    throw new TypeError("successor release manifest is invalid");
  }
  const versions = manifest.expandMigrations.map((entry) => {
    const match = typeof entry?.file === "string"
      ? entry.file.match(MIGRATION_FILE)
      : null;
    if (!match) throw new TypeError("successor release migration entry is invalid");
    return match[1];
  });
  assertOrderedUniqueVersions(versions, "successor manifest migrations");
  return versions;
}

function hasExactKeys(value, expectedKeys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...expectedKeys].sort());
}

export function validateSuccessorRemoteBaselineContract({ manifest, contract }) {
  const successorVersions = readSuccessorVersions(manifest);
  if (!hasExactKeys(contract, REMOTE_BASELINE_CONTRACT_KEYS)
      || contract.contractVersion !== 1
      || contract.kind !== "successor-production-ledger-baseline-v1"
      || contract.release !== manifest.release
      || contract.projectRef !== manifest.projectRef
      || contract.predecessorHead !== manifest.requiredRemoteHead
      || !MIGRATION_VERSION.test(contract.observedRemoteHead ?? "")
      || contract.verificationLimit
        !== "ledger-version-and-name-equality-without-stored-sql-statements"
      || JSON.stringify(contract.requiredRuntimeChecks)
        !== JSON.stringify(REQUIRED_RUNTIME_CHECKS)) {
    throw new TypeError("successor remote baseline contract is invalid");
  }
  const appliedHeadIndex = contract.observedRemoteHead === manifest.requiredRemoteHead
    ? -1
    : successorVersions.indexOf(contract.observedRemoteHead);
  if (appliedHeadIndex < -1
      || (appliedHeadIndex === -1
        && contract.observedRemoteHead !== manifest.requiredRemoteHead)) {
    throw new Error("observed remote head is not one successor migration");
  }
  const appliedMigrations = manifest.expandMigrations.slice(0, appliedHeadIndex + 1);
  const pendingMigrations = manifest.expandMigrations.slice(appliedHeadIndex + 1);
  if (JSON.stringify(contract.appliedSuccessorMigrations)
        !== JSON.stringify(appliedMigrations)) {
    throw new Error("applied successor migrations do not match the manifest prefix");
  }
  const firstPendingSuccessor = pendingMigrations.at(0)?.file.slice(0, 14) ?? null;
  const lastPendingSuccessor = pendingMigrations.at(-1)?.file.slice(0, 14) ?? null;
  if (contract.pendingSuccessorCount !== pendingMigrations.length
      || contract.firstPendingSuccessor !== firstPendingSuccessor
      || contract.lastPendingSuccessor !== lastPendingSuccessor) {
    throw new Error("pending successor migrations do not match the manifest suffix");
  }
  return {
    observedRemoteHead: contract.observedRemoteHead,
    appliedMigrations,
    pendingMigrations,
    requiredRuntimeChecks: [...REQUIRED_RUNTIME_CHECKS],
    verificationLimit: contract.verificationLimit,
  };
}

export function assertSuccessorRemoteBaselineReportMatchesContract({
  report,
  remoteBaseline,
}) {
  if (!report
      || !remoteBaseline
      || report.remoteOnlyCount !== 0
      || report.observedRemoteHead !== remoteBaseline.observedRemoteHead
      || report.appliedSuccessorCount !== remoteBaseline.appliedMigrations?.length
      || report.pendingSuccessorCount !== remoteBaseline.pendingMigrations?.length) {
    throw new Error("live remote ledger differs from the pinned historical baseline");
  }
  return report;
}

export function buildSuccessorRemoteBaselineReport({
  manifest,
  linkedProjectRef,
  migrationListOutput,
}) {
  const successorVersions = readSuccessorVersions(manifest);
  if (linkedProjectRef !== manifest.projectRef) {
    throw new Error("linked project does not match the successor release manifest");
  }
  const parsed = parseSupabaseMigrationList(migrationListOutput);
  const baseline = auditSuccessorRemoteBaseline({
    requiredRemoteHead: manifest.requiredRemoteHead,
    successorVersions,
    migrationListOutput,
  });
  return {
    kind: "successor-remote-baseline-audit-v1",
    release: manifest.release,
    projectRef: manifest.projectRef,
    status: baseline.status,
    manifestRequiredRemoteHead: baseline.manifestRequiredRemoteHead,
    observedRemoteHead: baseline.observedRemoteHead,
    successorMigrationCount: successorVersions.length,
    appliedSuccessorCount: baseline.appliedSuccessorVersions.length,
    appliedSuccessorHead: baseline.appliedSuccessorVersions.at(-1) ?? null,
    pendingSuccessorCount: baseline.pendingSuccessorVersions.length,
    firstPendingSuccessor: baseline.pendingSuccessorVersions.at(0) ?? null,
    lastPendingSuccessor: baseline.pendingSuccessorVersions.at(-1) ?? null,
    remoteOnlyCount: parsed.remoteOnlyVersions.length,
  };
}
