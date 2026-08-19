import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT,
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  successorCreatedPublicTables,
  validateSuccessorReleaseContract,
} from "./lib/supabase-successor-release-contract.mjs";
import {
  SUCCESSOR_FINALIZER_EXTERNAL_EVIDENCE_CONTRACT,
  validateAmoraExtendedReleaseContracts,
} from "./lib/amora-release-extended-contracts.mjs";

export const SUCCESSOR_CONTROLLER_CONTRACT_RELATIVE_PATH =
  "supabase/release-contracts/vendor-disclosure-production-controller-v1.json";

const CONTROLLER_CHECK_COUNTS = Object.freeze([3, 1, 1]);
const CONTROLLER_OPERATION_COUNT = 4;
const CONTROLLER_RECOVERY_COUNT = 4;

const BASELINE_CAPTURE_PATH =
  "scripts/vendor-disclosure-db-current-baseline.ps1";
const BASELINE_DEPENDENCY_PATHS = Object.freeze([
  "scripts/vendor-disclosure-db-current-baseline-common.ps1",
  "scripts/amora-db-backup-common.ps1",
]);
const BASELINE_VERIFIER_PATH =
  "scripts/vendor-disclosure-db-current-baseline-verify.ps1";
const POST_EXPAND_COMMON_PATH =
  "scripts/vendor-disclosure-db-backup-common.ps1";
const POST_EXPAND_CAPTURE_PATH =
  "scripts/vendor-disclosure-db-backup.ps1";
const POST_EXPAND_VERIFIER_PATH =
  "scripts/vendor-disclosure-db-verify-backup.ps1";

const LIVE_SCHEMA_CHECK_PATH =
  "supabase/release-checks/20260819121500_production_successor_live_schema_contract_verify.sql";
const LIVE_SCHEMA_OPERATION_PATH =
  "supabase/platform-operations/security/20260819121500_production_successor_live_schema_contract_apply.sql";
const LIVE_SCHEMA_ROLLBACK_PATH =
  "supabase/platform-operations/security/20260819121500_production_successor_live_schema_contract_rollback.sql";
const SUCCESSOR_FINALIZER_PATH =
  "supabase/platform-operations/security/20260819122000_production_write_fence_successor_finalize.sql";
const POSTCHECK_PATH =
  "supabase/release-checks/vendor-disclosure-successor-post.sql";

const STORAGE_SPECS = Object.freeze([
  Object.freeze({
    operationFile:
      "supabase/platform-operations/storage/20260819100000_vendor_disclosure_successor_storage_write_freeze.operation.json",
    operationId: "vendor-disclosure-successor-storage-write-freeze-v1",
    recoveryFile:
      "supabase/platform-operations/storage/20260819100000_vendor_disclosure_successor_storage_write_freeze.forward-recovery.json",
    recoveryId: "successor-storage-freeze-forward-recovery-v1",
  }),
  Object.freeze({
    operationFile:
      "supabase/platform-operations/storage/20260819102000_vendor_disclosure_successor_storage_final_convergence.operation.json",
    operationId: "vendor-disclosure-successor-storage-final-convergence-v1",
    recoveryFile:
      "supabase/platform-operations/storage/20260819102000_vendor_disclosure_successor_storage_final_convergence.compensation.json",
    recoveryId: "successor-storage-final-compensation-v1",
  }),
]);

const ROLLBACK_CONTROLS = Object.freeze({
  AMORA_AUXILIARY_MEMORY_ENABLED: "false",
  AMORA_CARE_OUTBOUND_ENABLED: "false",
  AMORA_COMMUNITY_AI_COMMENT_ENABLED: "false",
  AMORA_CONVERSATION_SEGMENT_READ_ENABLED: "false",
  AMORA_TODAY_ONE_ENABLED: "false",
  AMORA_MEDIATION_OUTCOME_FOLLOW_UP_ENABLED: "false",
  AMORA_OPENAI_ENABLED: "false",
  AMORA_PROACTIVE_CHAT_ENABLED: "false",
  AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED: "false",
  EXPO_PUBLIC_AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED: "false",
  AMORA_COST_GUARD_ENABLED: "true",
  WEDDING_COURT_ENABLED: "false",
  WEDDING_PAYMENT_LEDGER_ENABLED: "false",
});

const ROLLBACK_CHECKS = Object.freeze([
  "databaseWriteFenceHeld",
  "storageWriteFenceHeld",
  "authSignupDisabled",
  "webWriteFenceEnabled",
  "chatPartnerRecipientBoundaryHeld",
  "conversationSegmentScopeBoundaryHeld",
]);

const DEPLOYMENT_EVIDENCE_NAMES = Object.freeze([
  "backup",
  "finalizer",
  "hostedStaging",
  "recoveryAssurance",
  "storage",
]);

export class SuccessorControllerGeneratorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SuccessorControllerGeneratorError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SuccessorControllerGeneratorError(code, message);
}

function clone(value) {
  return structuredClone(value);
}

function canonicalJsonText(value) {
  return `${JSON.stringify(value, null, 2).replace(/\r\n?/g, "\n")}\n`;
}

function canonicalTextSha256(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function textListSha256(values) {
  return canonicalTextSha256(`${values.join("\n")}\n`);
}

function assertRegularFile(repoRoot, relativePath) {
  const path = resolve(repoRoot, relativePath);
  const metadata = existsSync(path) ? lstatSync(path) : null;
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    fail("SOURCE_FILE_INVALID", `required source is missing or unsafe: ${relativePath}`);
  }
  return path;
}

function readText(repoRoot, relativePath) {
  return readFileSync(assertRegularFile(repoRoot, relativePath), "utf8");
}

function readJson(repoRoot, relativePath) {
  try {
    return JSON.parse(readText(repoRoot, relativePath));
  } catch (error) {
    if (error instanceof SuccessorControllerGeneratorError) throw error;
    fail("SOURCE_JSON_INVALID", `required source is not JSON: ${relativePath}`);
  }
}

function pin(repoRoot, relativePath) {
  return {
    file: relativePath,
    sha256: canonicalTextSha256(readText(repoRoot, relativePath)),
  };
}

function requireEntry(entries, predicate, label) {
  const matches = Array.isArray(entries) ? entries.filter(predicate) : [];
  if (matches.length !== 1) {
    fail("SOURCE_CONTRACT_INVALID", `${label} must have exactly one source entry`);
  }
  return clone(matches[0]);
}

function parsePostcheckExpectedEvidence(sql) {
  const verifiedMarker = ") AS verified,";
  const end = sql.lastIndexOf(verifiedMarker);
  const start = end < 0 ? -1 : sql.lastIndexOf("SELECT", end);
  if (start < 0 || end < 0) {
    fail("POSTCHECK_CONTRACT_INVALID", "successor postcheck final evidence predicate is missing");
  }
  const predicate = sql.slice(start, end);
  const expectedEvidence = {};
  for (const match of predicate.matchAll(/\b([a-z][a-z0-9_]*)\s*=\s*(\d+)\b/g)) {
    const [, name, expected] = match;
    if (Object.hasOwn(expectedEvidence, name)) {
      fail("POSTCHECK_CONTRACT_INVALID", `duplicate successor postcheck evidence: ${name}`);
    }
    expectedEvidence[name] = Number(expected);
  }
  if (Object.keys(expectedEvidence).length < 30) {
    fail("POSTCHECK_CONTRACT_INVALID", "successor postcheck evidence set is incomplete");
  }
  return expectedEvidence;
}

function parsePostcheckValueList(sql, expression, terminator, cast) {
  const startExpression = new RegExp(`${expression}\\s+AS\\s+\\(VALUES`, "i");
  const startMatch = startExpression.exec(sql);
  if (!startMatch) {
    fail("POSTCHECK_CONTRACT_INVALID", `successor postcheck list is missing: ${expression}`);
  }
  const tail = sql.slice(startMatch.index + startMatch[0].length);
  const endExpression = new RegExp(`\\)\\s*,\\s*${terminator}\\s+AS`, "i");
  const endMatch = endExpression.exec(tail);
  if (!endMatch) {
    fail("POSTCHECK_CONTRACT_INVALID", `successor postcheck list is unterminated: ${expression}`);
  }
  const list = tail.slice(0, endMatch.index);
  const valuePattern = new RegExp(`\\('([a-z0-9_]+)'::${cast}\\)`, "g");
  const values = [...list.matchAll(valuePattern)].map((match) => match[1]);
  if (values.length === 0 || new Set(values).size !== values.length) {
    fail("POSTCHECK_CONTRACT_INVALID", `successor postcheck list is invalid: ${expression}`);
  }
  return values;
}

function exactArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function runtimeEvidenceContracts(release) {
  return Object.fromEntries(DEPLOYMENT_EVIDENCE_NAMES.map((name) => {
    const requirement = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS[name];
    if (!requirement) {
      fail("NO_COST_EVIDENCE_CONTRACT_INVALID", `runtime requirement is missing: ${name}`);
    }
    const slug = name.replace(/([A-Z])/g, "-$1").toLowerCase();
    return [name, {
      kind: requirement.kind,
      receiptFileName: `${release}-${slug}-evidence.json`,
      rawEvidenceFileName: `${release}-${slug}-raw.json`,
      rawEvidenceSource: requirement.rawEvidenceSource,
      maximumAgeMinutes: requirement.maximumAgeMinutes,
      requiredChecks: [...requirement.requiredChecks],
      ...(name === "recoveryAssurance"
        ? { releaseAssurance: clone(requirement.releaseAssurance) }
        : {}),
    }];
  }));
}

function buildStorageContracts(repoRoot, projectRef) {
  const operations = [];
  const recoveries = [];
  const checks = [];

  for (const spec of STORAGE_SPECS) {
    const operationContract = readJson(repoRoot, spec.operationFile);
    const recoveryContract = readJson(repoRoot, spec.recoveryFile);
    if (operationContract.operationId !== spec.operationId
        || operationContract.projectRef !== projectRef
        || recoveryContract.operationId !== spec.operationId
        || operationContract.releaseCheck?.id === undefined) {
      fail(
        "STORAGE_CONTRACT_INVALID",
        `successor Storage contract identity drifted: ${spec.operationId}`,
      );
    }
    const operationPin = pin(repoRoot, spec.operationFile);
    const recoveryPin = pin(repoRoot, spec.recoveryFile);
    operations.push({
      id: spec.operationId,
      phase: operationContract.phase,
      verificationCheckId: operationContract.releaseCheck.id,
      ...operationPin,
    });
    recoveries.push({
      id: spec.recoveryId,
      forOperationId: spec.operationId,
      ...recoveryPin,
    });
    checks.push({
      id: operationContract.releaseCheck.id,
      type: "read-only-sql",
      file: operationContract.releaseCheck.file,
      sha256: operationContract.releaseCheck.sha256,
      expectedEvidence: clone(operationContract.releaseCheck.expectedEvidence),
    });
  }
  return { operations, recoveries, checks };
}

function assertExactControllerShape(contract) {
  const counts = [
    contract.preApplyChecks?.length,
    contract.postPushChecks?.length,
    contract.postApplyChecks?.length,
  ];
  if (!exactArray(counts, CONTROLLER_CHECK_COUNTS)
      || contract.manualPlatformOperations?.length !== CONTROLLER_OPERATION_COUNT
      || contract.rollbackArtifacts?.length !== CONTROLLER_RECOVERY_COUNT
      || contract.forwardOnlySecurityOperations?.length !== 0) {
    fail(
      "CONTROLLER_SHAPE_INVALID",
      "successor controller must retain exact 3/1/1 checks, 4 operations, 4 recoveries and no replayed forward-only operation",
    );
  }
}

/**
 * Render the reviewed successor controller and controller-ready manifest entirely
 * from hash-verified repository sources. This function performs no Git, Supabase,
 * network, or filesystem mutation.
 */
export function renderSuccessorControllerArtifacts({ repoRoot }) {
  const root = resolve(repoRoot);
  let base;
  try {
    base = validateSuccessorReleaseContract({ repoRoot: root });
  } catch (error) {
    fail(
      "BASE_RELEASE_CONTRACT_INVALID",
      error instanceof Error ? error.message : "successor base release contract is invalid",
    );
  }
  const sourceManifest = base.manifest;
  const predecessor = readJson(root, sourceManifest.predecessorManifest.file);
  const releaseVersions = sourceManifest.expandMigrations.map(
    (entry) => entry.file.slice(0, 14),
  );
  const appliedBaselineTables = successorCreatedPublicTables(
    root,
    base.remoteBaseline.appliedMigrations,
  );
  const baselineTables = [...new Set([
    ...predecessor.postExpandBackupContract.expectedTables,
    ...appliedBaselineTables,
  ])].sort();
  const createdPublicTables = successorCreatedPublicTables(
    root,
    sourceManifest.expandMigrations,
  );
  const postExpandTables = [...new Set([
    ...baselineTables,
    ...createdPublicTables,
  ])].sort();

  const postcheckSql = readText(root, POSTCHECK_PATH);
  const postcheckExpectedEvidence = parsePostcheckExpectedEvidence(postcheckSql);
  const postcheckTables = parsePostcheckValueList(
    postcheckSql,
    "expected_successor_tables\\(table_name\\)",
    "successor_table_contract",
    "name",
  );
  const postcheckMigrations = parsePostcheckValueList(
    postcheckSql,
    "expected_successor_migrations\\(version\\)",
    "migration_ledger_contract",
    "text",
  );
  const pendingVersions = base.remoteBaseline.pendingMigrations.map(
    (entry) => entry.file.slice(0, 14),
  );
  if (!exactArray(postcheckTables, createdPublicTables)
      || !exactArray(postcheckMigrations, pendingVersions)
      || postcheckExpectedEvidence.successor_created_table_count
        !== createdPublicTables.length
      || postcheckExpectedEvidence.successor_migration_head_count !== 1) {
    fail(
      "POSTCHECK_CONTRACT_INVALID",
      "successor postcheck tables or pending migration ledger drifted from repository sources",
    );
  }

  const databaseFenceCheck = requireEntry(
    predecessor.preApplyChecks,
    (entry) => entry?.id === "public-database-write-fence-pre",
    "Production database write-fence check",
  );
  const databaseFenceOperation = requireEntry(
    predecessor.manualPlatformOperations,
    (entry) => entry?.id === "production-write-fence-20260717120000",
    "Production database write-fence operation",
  );
  const databaseFenceRollback = requireEntry(
    predecessor.rollbackArtifacts,
    (entry) => entry?.forOperationId === databaseFenceOperation.id,
    "Production database write-fence rollback",
  );
  const storage = buildStorageContracts(root, sourceManifest.projectRef);

  const liveSchemaCheck = {
    id: "production-successor-live-schema-contract-verify-20260819121500",
    type: "read-only-sql",
    ...pin(root, LIVE_SCHEMA_CHECK_PATH),
    expectedEvidence: {
      production_successor_live_schema_contract_verify_count: 1,
    },
  };
  const liveSchemaOperation = {
    id: "production-successor-live-schema-contract-20260819121500",
    phase: "pre-backup",
    verificationCheckId: liveSchemaCheck.id,
    ...pin(root, LIVE_SCHEMA_OPERATION_PATH),
  };
  const liveSchemaRollback = {
    id: "production-successor-schema-contract-rollback-20260819121500",
    forOperationId: liveSchemaOperation.id,
    ...pin(root, LIVE_SCHEMA_ROLLBACK_PATH),
  };

  const contract = {
    contractVersion: 1,
    release: sourceManifest.release,
    projectRef: sourceManifest.projectRef,
    historicalEffectAudit: clone(predecessor.historicalEffectAudit),
    recoveryAssuranceContract: clone(
      SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT,
    ),
    preApplyChecks: [databaseFenceCheck, liveSchemaCheck, storage.checks[0]],
    postPushChecks: [storage.checks[1]],
    postApplyChecks: [{
      id: "vendor-disclosure-successor-postcheck",
      type: "read-only-sql",
      ...pin(root, POSTCHECK_PATH),
      expectedEvidence: postcheckExpectedEvidence,
    }],
    forwardOnlySecurityOperations: [],
    manualPlatformOperations: [
      databaseFenceOperation,
      liveSchemaOperation,
      ...storage.operations,
    ],
    rollbackArtifacts: [
      databaseFenceRollback,
      liveSchemaRollback,
      ...storage.recoveries,
    ],
    manualControlEvidence: {
      ...clone(predecessor.manualControlEvidence),
      receiptFileName: `${sourceManifest.release}-production-write-fence.json`,
      postPushReceiptFileName: `${sourceManifest.release}-post-push.json`,
      storageDrainReceiptFileName: `${sourceManifest.release}-storage-drain.json`,
    },
    backupContract: {
      id: `pre-${sourceManifest.release}-current-remote-backup`,
      version: 2,
      format: "hbam2-encrypted-current-user",
      expectedTableCount: baselineTables.length,
      expectedTables: baselineTables,
      expectedTableContractSha256: textListSha256(baselineTables),
      expectedMigrationHead: base.remoteBaseline.observedRemoteHead,
      excludedEphemeralTables: clone(
        predecessor.backupContract.excludedEphemeralTables,
      ),
      ephemeralRebuildContract:
        predecessor.backupContract.ephemeralRebuildContract,
      expectedCommitBinding: "release-expected-commit",
      expectedOrigin: predecessor.backupContract.expectedOrigin,
      capture: pin(root, BASELINE_CAPTURE_PATH),
      dependencies: BASELINE_DEPENDENCY_PATHS.map(
        (relativePath) => pin(root, relativePath),
      ),
      verifier: pin(root, BASELINE_VERIFIER_PATH),
      providerPhysicalBackup: clone(
        predecessor.backupContract.providerPhysicalBackup,
      ),
      supabaseCli: clone(predecessor.backupContract.supabaseCli),
      requiredReceiptValues: clone(
        predecessor.postExpandBackupContract.requiredReceiptValues,
      ),
    },
    postExpandBackupContract: {
      id: `post-${sourceManifest.release}-backup`,
      version: 2,
      phase: predecessor.postExpandBackupContract.phase,
      verificationReceiptFileName:
        `${sourceManifest.release}-post-expand-backup-verification.json`,
      maximumAgeMinutes:
        predecessor.postExpandBackupContract.maximumAgeMinutes,
      expectedTableCount: postExpandTables.length,
      expectedTables: postExpandTables,
      expectedReleaseMigrationBaselineHead:
        base.remoteBaseline.observedRemoteHead,
      expectedReleaseMigrationHead: releaseVersions.at(-1),
      expectedReleaseMigrationVersions: releaseVersions,
      expectedTableContractSha256: textListSha256(postExpandTables),
      expectedReleaseMigrationContractSha256: textListSha256(releaseVersions),
      expectedCommitBinding:
        predecessor.postExpandBackupContract.expectedCommitBinding,
      requiredLedgerEvidence:
        predecessor.postExpandBackupContract.requiredLedgerEvidence,
      requiredReceiptValues: clone(
        predecessor.postExpandBackupContract.requiredReceiptValues,
      ),
      common: pin(root, POST_EXPAND_COMMON_PATH),
      capture: pin(root, POST_EXPAND_CAPTURE_PATH),
      verifier: pin(root, POST_EXPAND_VERIFIER_PATH),
      recoveryAssurance: {
        receiptFileName:
          `${sourceManifest.release}-recovery-assurance-evidence.json`,
        maximumAgeMinutes:
          SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS
            .recoveryAssurance.maximumAgeMinutes,
        requiredChecks: [
          ...SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS
            .recoveryAssurance.requiredChecks,
        ],
        releaseAssurance: clone(
          SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS
            .recoveryAssurance.releaseAssurance,
        ),
      },
    },
    finalizationContract: {
      id: predecessor.finalizationContract.id,
      version: 2,
      operation: {
        id: "production-write-fence-successor-finalize-20260819122000",
        ...pin(root, SUCCESSOR_FINALIZER_PATH),
      },
      requiredLeasePhase: predecessor.finalizationContract.requiredLeasePhase,
      canaryMaximumAgeMinutes:
        predecessor.finalizationContract.canaryMaximumAgeMinutes,
      deploymentMaximumAgeMinutes:
        predecessor.finalizationContract.deploymentMaximumAgeMinutes,
      requiredCanaryChecks: clone(
        predecessor.finalizationContract.requiredCanaryChecks,
      ),
      externalEvidence: clone(
        SUCCESSOR_FINALIZER_EXTERNAL_EVIDENCE_CONTRACT,
      ),
      confirmationIncludesCanarySha256: true,
    },
    rollbackContract: {
      version: 1,
      strategy: "forward-fix-feature-off",
      migrationRollback: "prohibited",
      featureOffReceiptFileName:
        `${sourceManifest.release}-feature-off-rollback.json`,
      maximumAgeMinutes: 30,
      requiredControls: clone(ROLLBACK_CONTROLS),
      requiredChecks: [...ROLLBACK_CHECKS],
    },
    requiredDocuments: clone(predecessor.requiredDocuments),
  };
  assertExactControllerShape(contract);

  const controllerText = canonicalJsonText(contract);
  const controllerSha256 = canonicalTextSha256(controllerText);
  const manifest = {
    release: sourceManifest.release,
    projectRef: sourceManifest.projectRef,
    status: "controller_ready",
    predecessorManifest: clone(sourceManifest.predecessorManifest),
    remoteBaselineContract: clone(sourceManifest.remoteBaselineContract),
    requiredRemoteHead: sourceManifest.requiredRemoteHead,
    migrationFloor: sourceManifest.migrationFloor,
    expandMigrations: clone(sourceManifest.expandMigrations),
    deploymentEvidence: runtimeEvidenceContracts(sourceManifest.release),
    controllerContract: {
      file: SUCCESSOR_CONTROLLER_CONTRACT_RELATIVE_PATH,
      sha256: controllerSha256,
    },
  };
  const manifestText = canonicalJsonText(manifest);

  return Object.freeze({
    contract,
    manifest,
    controllerText,
    manifestText,
    controllerSha256,
    createdPublicTables,
    baselineTables,
    postExpandTables,
    controllerRelativePath: SUCCESSOR_CONTROLLER_CONTRACT_RELATIVE_PATH,
    manifestRelativePath: SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
    controllerPath: resolve(root, SUCCESSOR_CONTROLLER_CONTRACT_RELATIVE_PATH),
    manifestPath: resolve(root, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH),
  });
}

function copyValidationInputs(repoRoot, temporaryRoot, artifacts) {
  cpSync(resolve(repoRoot, "supabase"), resolve(temporaryRoot, "supabase"), {
    recursive: true,
  });
  const scriptPins = [
    artifacts.contract.backupContract.capture,
    ...artifacts.contract.backupContract.dependencies,
    artifacts.contract.backupContract.verifier,
    artifacts.contract.postExpandBackupContract.common,
    artifacts.contract.postExpandBackupContract.capture,
    artifacts.contract.postExpandBackupContract.verifier,
  ];
  for (const entry of scriptPins) {
    const source = assertRegularFile(repoRoot, entry.file);
    const target = resolve(temporaryRoot, entry.file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
}

/** Validate the rendered overlay with the same central validators used by release. */
export function validateRenderedSuccessorControllerArtifacts({
  repoRoot,
  artifacts,
}) {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "successor-controller-review-"),
  );
  try {
    copyValidationInputs(resolve(repoRoot), temporaryRoot, artifacts);
    const controllerPath = resolve(
      temporaryRoot,
      artifacts.controllerRelativePath,
    );
    const manifestPath = resolve(temporaryRoot, artifacts.manifestRelativePath);
    mkdirSync(dirname(controllerPath), { recursive: true });
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(controllerPath, artifacts.controllerText, "utf8");
    writeFileSync(manifestPath, artifacts.manifestText, "utf8");

    const validated = validateSuccessorReleaseContract({
      repoRoot: temporaryRoot,
    });
    validateAmoraExtendedReleaseContracts(validated.controllerManifest);
    assertExactControllerShape(validated.controllerManifest);
    return validated;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function defaultRunGit(args, repoRoot) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail(
      "WRITE_GIT_STATE_UNAVAILABLE",
      `local Git state is unavailable for: git ${args.join(" ")}`,
    );
  }
  return result.stdout.replace(/\r\n?/g, "\n").trimEnd();
}

function sameResolvedPath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

/** Write mode never contacts Supabase, but it does require a live Git origin SHA. */
export function assertSuccessorControllerWriteRepository({
  repoRoot,
  expectedOrigin,
  runGit = defaultRunGit,
}) {
  const root = resolve(repoRoot);
  const git = (args) => runGit(args, root).trim();
  const topLevel = git(["rev-parse", "--show-toplevel"]);
  if (!sameResolvedPath(topLevel, root)) {
    fail("WRITE_REPOSITORY_MISMATCH", "write mode must run at the exact repository root");
  }
  const dirty = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty.length !== 0) {
    fail("WRITE_REPOSITORY_DIRTY", "write mode refuses a dirty repository");
  }
  const origin = git(["config", "--get", "remote.origin.url"]);
  if (origin !== expectedOrigin) {
    fail("WRITE_REPOSITORY_MISMATCH", "write mode repository origin does not match the release contract");
  }
  const head = git(["rev-parse", "HEAD"]);
  let upstream;
  let upstreamRef;
  try {
    upstream = git(["rev-parse", "@{upstream}"]);
    upstreamRef = git([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
  } catch {
    fail("WRITE_COMMIT_UNPUSHED", "write mode requires a configured pushed upstream commit");
  }
  if (!/^[a-f0-9]{40}$/.test(head)
      || !/^[a-f0-9]{40}$/.test(upstream)
      || head !== upstream) {
    fail("WRITE_COMMIT_UNPUSHED", "write mode requires HEAD to equal its tracked upstream");
  }
  if (!upstreamRef.startsWith("origin/")) {
    fail("WRITE_COMMIT_UNPUSHED", "write mode requires an origin-tracked branch");
  }
  const trackedBranch = upstreamRef.slice("origin/".length);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,200}$/.test(trackedBranch)
      || trackedBranch.includes("..")
      || trackedBranch.endsWith("/")
      || trackedBranch.endsWith(".lock")) {
    fail("WRITE_COMMIT_UNPUSHED", "write mode tracked branch is unsafe");
  }
  const liveRef = `refs/heads/${trackedBranch}`;
  let liveOutput;
  try {
    liveOutput = git(["ls-remote", "--exit-code", "origin", liveRef]);
  } catch {
    fail("WRITE_COMMIT_UNPUSHED", "write mode could not verify the live tracked branch");
  }
  const lines = liveOutput.split("\n").filter(Boolean);
  const liveMatch = lines.length === 1
    ? lines[0].match(/^([a-f0-9]{40})\t(.+)$/)
    : null;
  const liveRemoteSha = liveMatch?.[1];
  if (!liveMatch || liveMatch[2] !== liveRef || liveRemoteSha !== head) {
    fail(
      "WRITE_COMMIT_UNPUSHED",
      "write mode requires HEAD, local upstream, and live origin branch SHA to match exactly",
    );
  }
  return Object.freeze({
    root,
    head,
    upstream,
    origin,
    trackedBranch,
    liveRemoteSha,
  });
}

/** The controller must exist before the manifest can point at it. */
export function commitSuccessorControllerArtifacts({
  repoRoot,
  artifacts,
  writeText = (path, text) => writeFileSync(path, text, "utf8"),
}) {
  const root = resolve(repoRoot);
  const controllerPath = resolve(root, artifacts.controllerRelativePath);
  const manifestPath = resolve(root, artifacts.manifestRelativePath);
  if (!sameResolvedPath(controllerPath, artifacts.controllerPath)
      || !sameResolvedPath(manifestPath, artifacts.manifestPath)
      || controllerPath !== resolve(root, SUCCESSOR_CONTROLLER_CONTRACT_RELATIVE_PATH)
      || manifestPath !== resolve(root, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH)) {
    fail("WRITE_TARGET_MISMATCH", "rendered artifacts do not target the reviewed release paths");
  }
  mkdirSync(dirname(controllerPath), { recursive: true });
  writeText(controllerPath, artifacts.controllerText);
  writeText(manifestPath, artifacts.manifestText);
  return Object.freeze({ controllerPath, manifestPath });
}

function summary(artifacts, mode, commit = null) {
  return {
    kind: "successor-controller-generator-result-v1",
    mode,
    valid: true,
    release: artifacts.manifest.release,
    projectRef: artifacts.manifest.projectRef,
    controllerContract: {
      file: artifacts.controllerRelativePath,
      sha256: artifacts.controllerSha256,
    },
    manifest: {
      file: artifacts.manifestRelativePath,
      status: artifacts.manifest.status,
      evidenceNames: Object.keys(artifacts.manifest.deploymentEvidence),
    },
    checks: CONTROLLER_CHECK_COUNTS,
    operationCount: CONTROLLER_OPERATION_COUNT,
    recoveryCount: CONTROLLER_RECOVERY_COUNT,
    additionalMonthlyCostUsd: 0,
    additionalProjectCreated: false,
    hostedRestorePerformed: false,
    ...(commit ? { commit } : {}),
  };
}

export function runSuccessorControllerGenerator({
  repoRoot,
  mode,
  runGit = defaultRunGit,
}) {
  const root = resolve(repoRoot);
  const first = renderSuccessorControllerArtifacts({ repoRoot: root });
  validateRenderedSuccessorControllerArtifacts({ repoRoot: root, artifacts: first });
  if (mode === "check") return summary(first, mode);
  if (mode !== "write") fail("ARGUMENT_INVALID", "mode must be check or write");

  const reviewed = renderSuccessorControllerArtifacts({ repoRoot: root });
  if (reviewed.controllerText !== first.controllerText
      || reviewed.manifestText !== first.manifestText) {
    fail("SOURCE_CHANGED_DURING_REVIEW", "release sources changed during generator review");
  }
  const git = assertSuccessorControllerWriteRepository({
    repoRoot: root,
    expectedOrigin: first.contract.backupContract.expectedOrigin,
    runGit,
  });
  commitSuccessorControllerArtifacts({ repoRoot: root, artifacts: reviewed });
  const validated = validateSuccessorReleaseContract({ repoRoot: root });
  validateAmoraExtendedReleaseContracts(validated.controllerManifest);
  assertExactControllerShape(validated.controllerManifest);
  return summary(reviewed, mode, git.head);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/generate-vendor-disclosure-successor-controller.mjs --check",
    "  node scripts/generate-vendor-disclosure-successor-controller.mjs --write",
    "",
    "--check renders and validates in a temporary overlay without changing the repository.",
    "--write additionally requires a clean repository whose HEAD matches both its local upstream and the live origin branch SHA.",
  ].join("\n");
}

function main(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const mode = argv.length === 1 && argv[0] === "--check"
    ? "check"
    : argv.length === 1 && argv[0] === "--write"
      ? "write"
      : null;
  if (!mode) fail("ARGUMENT_INVALID", usage());
  const repoRoot = resolve(import.meta.dirname, "..");
  const result = runSuccessorControllerGenerator({ repoRoot, mode });
  process.stdout.write(canonicalJsonText(result));
}

if (process.argv[1]
    && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof SuccessorControllerGeneratorError
      ? error.code
      : "UNEXPECTED";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`SUCCESSOR_CONTROLLER_GENERATOR_BLOCKED [${code}]: ${message}\n`);
    process.exitCode = 1;
  }
}
