import { createHash } from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/;

export const AMORA_POST_EXPAND_TABLES = Object.freeze([
  "account_deletion_jobs",
  "account_deletion_media_manifest",
  "ai_interactions_log",
  "amora_actions",
  "amora_care_deliveries",
  "amora_care_jobs",
  "amora_care_scan_states",
  "amora_chat_request_claims",
  "amora_conflict_check_claims",
  "amora_couple_profiles",
  "amora_mediation_acceptances",
  "amora_memory_consents",
  "amora_memory_jobs",
  "amora_memory_settings",
  "amora_tool_executions",
  "amora_turn_counters",
  "amora_turn_requests",
  "booking_projection_jobs",
  "chat_feedback",
  "chat_messages",
  "chat_summaries",
  "community_upload_sessions",
  "couples",
  "decision_nodes",
  "profiles",
  "vendor_reviews",
  "wedding_journeys",
]);

export const AMORA_RELEASE_MIGRATION_VERSIONS = Object.freeze([
  "20260716090000",
  "20260716091000",
  "20260716092000",
  "20260716093000",
  "20260716094000",
  "20260716095000",
  "20260716096000",
  "20260716097000",
  "20260716098000",
  "20260716099000",
  "20260716100000",
  "20260716102000",
  "20260716103000",
  "20260716104000",
  "20260716105000",
  "20260716106000",
  "20260716107000",
  "20260716108000",
  "20260716109000",
  "20260716110000",
  "20260716111000",
  "20260716112000",
  "20260716113000",
  "20260716114000",
  "20260716115000",
  "20260716116000",
  "20260716117000",
]);

export const AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256 =
  "aa6d4bbbd17d753fa31846568af3402afd51e79ad665bd5b9d204d162fef10ac";
export const AMORA_RELEASE_MIGRATION_CONTRACT_SHA256 =
  "c5e1d58c77f8c11e3d203046d55aadd9d5d09c2c04c639206cc1265b6a899beb";

export const HOSTED_RESTORE_REQUIRED_CHECKS = Object.freeze([
  "authApiSmokeVerified",
  "authUsersSchemaAndDataVerified",
  "checkConstraintsVerified",
  "columnDefaultsVerified",
  "destructiveRestoreDrillCompleted",
  "isolatedTargetConfirmed",
  "logicalDataDigestsVerified",
  "rowLevelSecurityPoliciesVerified",
  "rpcDefinitionsAndAclVerified",
  "storageMetadataRestoredVerified",
  "triggersVerified",
  "typedSchemaVerified",
]);

export const POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS = Object.freeze([
  ...HOSTED_RESTORE_REQUIRED_CHECKS,
  "exactReleaseMigrationLedgerVerified",
  "exactTableAllowlistVerified",
]);

export const FINALIZER_REQUIRED_CANARY_CHECKS = Object.freeze([
  "authenticatedReadPassed",
  "browserConsoleClean",
  "databaseFenceStillVerified",
  "deployedCommitMatched",
  "deploymentReady",
  "latencyWithinBaseline",
  "loginLogoutPassed",
  "noUnexpected5xx",
  "publicReadPassed",
  "serverErrorsWithinBaseline",
  "signupStillDisabled",
  "storageHelperClosed",
  "webWriteFenceStillEnabled",
]);

export const FINALIZER_EXTERNAL_EVIDENCE_CONTRACT = Object.freeze({
  version: 1,
  rawEvidenceStorage: "outside-git-receipt-sibling-files",
  vercel: Object.freeze({
    api: "deployments-v13-by-id",
    teamId: "team_XwMZqiJ4wXM2Ypvs99icXaQx",
    projectId: "prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes",
    productionHost: "hanbang.ai",
    requiredTarget: "production",
    requiredReadyState: "READY",
  }),
  hostedRestore: Object.freeze({
    managementApi: "projects-v1-by-ref",
    requiredProjectStatus: "ACTIVE_HEALTHY",
    requiredTargetIsolation: "different-supabase-project",
    requiredProjectNamePattern:
      "^wedding-hanbang-restore-drill-\\d{8}(?:-[a-z0-9]{1,12})?$",
    databaseTarget: "db.{targetProjectRef}.supabase.co:5432/postgres",
    databaseProbeSqlSha256:
      "c173dc3467c1168df33052d39675b5864dc596d997123bb35a3b8f9c1c577080",
    logicalDataProbeSqlSha256:
      "cfffa78c65306597f4d6ad39a303c7190b22d772a61d0715b4bf70cfbf2248e6",
    transactionMode: "read-only",
  }),
  canary: Object.freeze({
    runner: "hanbang-production-canary-v1",
    productionHost: "hanbang.ai",
    observationWindowSeconds: 300,
    httpProbeContractSha256:
      "2f06b08a49206cf128e95a78ee8d65bfb76263344146fd895810ae15354f5b45",
    requiredChecksSha256:
      "28effd6d8c5a73e49a42e5d48df80f290d7590ab9a39017bc07f9a06eb793342",
  }),
});

export const FORWARD_ONLY_OPERATION_ID =
  "ai-log-retention-exact-acl-20260717141000";
export const SUPERSEDED_FORWARD_OPERATION_ID =
  "ai-log-retention-acl-hotfix-20260717103000";
export const SUPERSEDED_FORWARD_OPERATION_FILES = Object.freeze([
  "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_inventory.sql",
  "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_apply.sql",
  "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_verify.sql",
]);

const FORWARD_FILES = Object.freeze({
  inventory:
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_inventory.sql",
  apply:
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
  verify:
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
});

export class ExtendedReleaseContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExtendedReleaseContractError";
    this.code = code;
  }
}

function invalid(code, message) {
  throw new ExtendedReleaseContractError(code, message);
}

function exactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function validateFinalizerExternalEvidenceContract(value) {
  const expected = FINALIZER_EXTERNAL_EVIDENCE_CONTRACT;
  if (!exactKeys(value, [
    "version",
    "rawEvidenceStorage",
    "vercel",
    "hostedRestore",
    "canary",
  ])
      || value.version !== expected.version
      || value.rawEvidenceStorage !== expected.rawEvidenceStorage
      || !exactKeys(value.vercel, Object.keys(expected.vercel))
      || !exactKeys(value.hostedRestore, Object.keys(expected.hostedRestore))
      || !exactKeys(value.canary, Object.keys(expected.canary))
      || Object.keys(expected.vercel).some(
        (key) => value.vercel[key] !== expected.vercel[key],
      )
      || Object.keys(expected.hostedRestore).some(
        (key) => value.hostedRestore[key] !== expected.hostedRestore[key],
      )
      || Object.keys(expected.canary).some(
        (key) => value.canary[key] !== expected.canary[key],
      )) {
    invalid(
      "FINALIZER_EXTERNAL_EVIDENCE_CONTRACT_INVALID",
      "external deployment, hosted restore and canary evidence targets must be exact",
    );
  }
  return value;
}

function validateForwardOnlySecurityOperations(manifest) {
  const operations = manifest.forwardOnlySecurityOperations;
  if (!Array.isArray(operations) || operations.length !== 1) {
    invalid(
      "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
      "exactly one reviewed forward-only security operation is required",
    );
  }
  const operation = operations[0];
  if (!exactKeys(operation, [
    "id",
    "phase",
    "verificationCheckId",
    "rollbackPolicy",
    "supersedes",
    "inventory",
    "apply",
    "verify",
  ])
      || operation.id !== FORWARD_ONLY_OPERATION_ID
      || operation.phase !== "pre-backup"
      || !/^[a-z][a-z0-9-]{2,63}$/.test(operation.verificationCheckId ?? "")
      || operation.rollbackPolicy !== "forward-fix-only-no-privilege-restoration"
      || !exactKeys(operation.supersedes, ["operationId", "forbiddenFiles"])
      || operation.supersedes.operationId !== SUPERSEDED_FORWARD_OPERATION_ID
      || !exactArray(
        operation.supersedes.forbiddenFiles,
        SUPERSEDED_FORWARD_OPERATION_FILES,
      )) {
    invalid(
      "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
      "forward-only operation must explicitly supersede and forbid the old 10:30 ACL operation",
    );
  }
  for (const kind of ["inventory", "apply", "verify"]) {
    const artifact = operation[kind];
    const keys = kind === "verify"
      ? ["file", "sha256", "expectedEvidence"]
      : ["file", "sha256"];
    if (!exactKeys(artifact, keys)
        || artifact.file !== FORWARD_FILES[kind]
        || !SHA256.test(artifact.sha256 ?? "")) {
      invalid(
        "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
        `forward-only ${kind} artifact is not the exact 14:10 file`,
      );
    }
  }
  if (!exactKeys(operation.verify.expectedEvidence, [
    "ai_log_retention_exact_acl_verified",
  ])
      || operation.verify.expectedEvidence.ai_log_retention_exact_acl_verified !== 1) {
    invalid(
      "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
      "forward-only verify evidence must prove the exact ACL result",
    );
  }

  const candidateOperations = [
    ...(Array.isArray(manifest.manualPlatformOperations)
      ? manifest.manualPlatformOperations
      : []),
    ...(Array.isArray(manifest.rollbackArtifacts)
      ? manifest.rollbackArtifacts
      : []),
  ];
  if (candidateOperations.some((candidate) =>
    candidate?.id === SUPERSEDED_FORWARD_OPERATION_ID
    || candidate?.forOperationId === FORWARD_ONLY_OPERATION_ID
    || SUPERSEDED_FORWARD_OPERATION_FILES.includes(candidate?.file))) {
    invalid(
      "SUPERSEDED_SECURITY_OPERATION_FORBIDDEN",
      "the old 10:30 ACL operation cannot be selected and the forward-only 14:10 operation cannot have a rollback",
    );
  }
  return operations;
}

function validatePostExpandBackupContract(manifest) {
  const contract = manifest.postExpandBackupContract;
  if (!exactKeys(contract, [
    "id",
    "version",
    "phase",
    "verificationReceiptFileName",
    "maximumAgeMinutes",
    "expectedTableCount",
    "expectedTables",
    "expectedReleaseMigrationBaselineHead",
    "expectedReleaseMigrationHead",
    "expectedReleaseMigrationVersions",
    "expectedTableContractSha256",
    "expectedReleaseMigrationContractSha256",
    "expectedCommitBinding",
    "requiredLedgerEvidence",
    "requiredReceiptValues",
    "capture",
    "verifier",
    "hostedRestoreEvidence",
  ])
      || contract.id !== "post-amora-engine-v2-27-table-backup"
      || contract.version !== 1
      || contract.phase !== "post-push-pre-deployment-canary"
      || contract.verificationReceiptFileName
        !== `${manifest.release}-post-expand-backup-verification.json`
      || contract.maximumAgeMinutes !== 1_440
      || contract.expectedTableCount !== AMORA_POST_EXPAND_TABLES.length
      || !exactArray(contract.expectedTables, AMORA_POST_EXPAND_TABLES)
      || contract.expectedReleaseMigrationBaselineHead !== "20260715210000"
      || contract.expectedReleaseMigrationHead !== "20260716117000"
      || !exactArray(
        contract.expectedReleaseMigrationVersions,
        AMORA_RELEASE_MIGRATION_VERSIONS,
      )
      || contract.expectedTableContractSha256
        !== AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256
      || contract.expectedReleaseMigrationContractSha256
        !== AMORA_RELEASE_MIGRATION_CONTRACT_SHA256
      || contract.expectedCommitBinding !== "release-expected-commit"
      || contract.requiredLedgerEvidence
        !== "live-remote-ledger-and-encrypted-backup-contract"
      || !exactKeys(contract.requiredReceiptValues, [
        "Verified",
        "SourceCanonicalDigestsVerified",
        "PGliteJsonbRoundTripVerified",
        "PlaintextWrittenToDisk",
      ])
      || contract.requiredReceiptValues.Verified !== true
      || contract.requiredReceiptValues.SourceCanonicalDigestsVerified !== true
      || contract.requiredReceiptValues.PGliteJsonbRoundTripVerified !== true
      || contract.requiredReceiptValues.PlaintextWrittenToDisk !== false
      || !exactKeys(contract.capture, ["file", "sha256"])
      || contract.capture.file !== "scripts/amora-db-backup.ps1"
      || !SHA256.test(contract.capture.sha256 ?? "")
      || !exactKeys(contract.verifier, ["file", "sha256"])
      || contract.verifier.file !== "scripts/amora-db-verify-backup.ps1"
      || !SHA256.test(contract.verifier.sha256 ?? "")
      || !exactKeys(contract.hostedRestoreEvidence, [
        "receiptFileName",
        "maximumAgeMinutes",
        "requiredTargetIsolation",
        "requiredChecks",
      ])
      || contract.hostedRestoreEvidence.receiptFileName
        !== `${manifest.release}-post-expand-hosted-restore-evidence.json`
      || contract.hostedRestoreEvidence.maximumAgeMinutes !== 1_440
      || contract.hostedRestoreEvidence.requiredTargetIsolation
        !== "different-supabase-project"
      || !exactArray(
        contract.hostedRestoreEvidence.requiredChecks,
        POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
      )) {
    invalid(
      "POST_EXPAND_BACKUP_CONTRACT_INVALID",
      "post-expand backup must pin all 27 tables, the exact 09:00..11:70 ledger, verifier and isolated hosted restore",
    );
  }
  return contract;
}

function validateFinalizationContract(manifest) {
  const contract = manifest.finalizationContract;
  if (!exactKeys(contract, [
    "id",
    "version",
    "operation",
    "requiredLeasePhase",
    "canaryMaximumAgeMinutes",
    "deploymentMaximumAgeMinutes",
    "requiredCanaryChecks",
    "externalEvidence",
    "confirmationIncludesCanarySha256",
  ])
      || contract.id !== "production-write-fence-exact-owner-finalizer"
      || contract.version !== 1
      || !exactKeys(contract.operation, ["id", "file", "sha256"])
      || contract.operation.id
        !== "production-write-fence-finalize-20260717121000"
      || contract.operation.file
        !== "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql"
      || !SHA256.test(contract.operation.sha256 ?? "")
      || contract.requiredLeasePhase !== "deployment-canary"
      || contract.canaryMaximumAgeMinutes !== 15
      || contract.deploymentMaximumAgeMinutes !== 1_440
      || !exactArray(
        contract.requiredCanaryChecks,
        FINALIZER_REQUIRED_CANARY_CHECKS,
      )
      || validateFinalizerExternalEvidenceContract(contract.externalEvidence)
        !== contract.externalEvidence
      || contract.confirmationIncludesCanarySha256 !== true) {
    invalid(
      "FINALIZATION_CONTRACT_INVALID",
      "exact-owner finalization contract is missing or invalid",
    );
  }
  return contract;
}

function textListSha256(values) {
  return createHash("sha256")
    .update(`${values.join("\n")}\n`, "utf8")
    .digest("hex");
}

function validateSuccessorForwardOnlySecurityOperations(manifest) {
  if (!Array.isArray(manifest.forwardOnlySecurityOperations)
      || manifest.forwardOnlySecurityOperations.length !== 0) {
    invalid(
      "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
      "successor controller may not replay predecessor forward-only operations",
    );
  }
  return manifest.forwardOnlySecurityOperations;
}

function validateSuccessorPostExpandBackupContract(manifest) {
  const contract = manifest.postExpandBackupContract;
  const versions = Array.isArray(manifest.expandMigrations)
    ? manifest.expandMigrations.map((entry) => entry?.file?.slice(0, 14))
    : [];
  const expectedHead = versions.at(-1);
  const tables = contract?.expectedTables;
  const tablesValid = Array.isArray(tables)
    && tables.length > 0
    && tables.length === contract.expectedTableCount
    && new Set(tables).size === tables.length
    && tables.every((table, index) =>
      /^[a-z][a-z0-9_]{1,62}$/.test(table)
      && (index === 0 || table > tables[index - 1]));
  if (!exactKeys(contract, [
    "id",
    "version",
    "phase",
    "verificationReceiptFileName",
    "maximumAgeMinutes",
    "expectedTableCount",
    "expectedTables",
    "expectedReleaseMigrationBaselineHead",
    "expectedReleaseMigrationHead",
    "expectedReleaseMigrationVersions",
    "expectedTableContractSha256",
    "expectedReleaseMigrationContractSha256",
    "expectedCommitBinding",
    "requiredLedgerEvidence",
    "requiredReceiptValues",
    "capture",
    "verifier",
    "hostedRestoreEvidence",
  ])
      || contract.id !== `post-${manifest.release}-backup`
      || contract.version !== 2
      || contract.phase !== "post-push-pre-deployment-canary"
      || contract.verificationReceiptFileName
        !== `${manifest.release}-post-expand-backup-verification.json`
      || contract.maximumAgeMinutes !== 1_440
      || !tablesValid
      || contract.expectedTableContractSha256 !== textListSha256(tables)
      || contract.expectedReleaseMigrationBaselineHead !== manifest.requiredRemoteHead
      || contract.expectedReleaseMigrationHead !== expectedHead
      || !exactArray(contract.expectedReleaseMigrationVersions, versions)
      || contract.expectedReleaseMigrationContractSha256
        !== textListSha256(versions)
      || contract.expectedCommitBinding !== "release-expected-commit"
      || contract.requiredLedgerEvidence
        !== "live-remote-ledger-and-encrypted-backup-contract"
      || !exactKeys(contract.requiredReceiptValues, [
        "Verified",
        "SourceCanonicalDigestsVerified",
        "PGliteJsonbRoundTripVerified",
        "PlaintextWrittenToDisk",
      ])
      || contract.requiredReceiptValues.Verified !== true
      || contract.requiredReceiptValues.SourceCanonicalDigestsVerified !== true
      || contract.requiredReceiptValues.PGliteJsonbRoundTripVerified !== true
      || contract.requiredReceiptValues.PlaintextWrittenToDisk !== false
      || !exactKeys(contract.capture, ["file", "sha256"])
      || !/^scripts\/[a-z0-9][a-z0-9_.-]*\.ps1$/.test(contract.capture.file ?? "")
      || contract.capture.file === "scripts/amora-db-backup.ps1"
      || !SHA256.test(contract.capture.sha256 ?? "")
      || !exactKeys(contract.verifier, ["file", "sha256"])
      || !/^scripts\/[a-z0-9][a-z0-9_.-]*\.ps1$/.test(contract.verifier.file ?? "")
      || contract.verifier.file === "scripts/amora-db-verify-backup.ps1"
      || !SHA256.test(contract.verifier.sha256 ?? "")
      || !exactKeys(contract.hostedRestoreEvidence, [
        "receiptFileName",
        "maximumAgeMinutes",
        "requiredTargetIsolation",
        "requiredChecks",
      ])
      || contract.hostedRestoreEvidence.receiptFileName
        !== `${manifest.release}-post-expand-hosted-restore-evidence.json`
      || contract.hostedRestoreEvidence.maximumAgeMinutes !== 1_440
      || contract.hostedRestoreEvidence.requiredTargetIsolation
        !== "different-supabase-project"
      || !exactArray(
        contract.hostedRestoreEvidence.requiredChecks,
        POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
      )) {
    invalid(
      "POST_EXPAND_BACKUP_CONTRACT_INVALID",
      "successor post-expand backup must pin its exact tables, manifest migrations and isolated restore",
    );
  }
  return contract;
}

function validateSuccessorFinalizationContract(manifest) {
  const contract = manifest.finalizationContract;
  if (!exactKeys(contract, [
    "id",
    "version",
    "operation",
    "requiredLeasePhase",
    "canaryMaximumAgeMinutes",
    "deploymentMaximumAgeMinutes",
    "requiredCanaryChecks",
    "externalEvidence",
    "confirmationIncludesCanarySha256",
  ])
      || contract.id !== "production-write-fence-exact-owner-finalizer"
      || contract.version !== 2
      || !exactKeys(contract.operation, ["id", "file", "sha256"])
      || contract.operation.id
        !== "production-write-fence-finalize-20260717121000"
      || contract.operation.file
        !== "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql"
      || !SHA256.test(contract.operation.sha256 ?? "")
      || contract.requiredLeasePhase !== "deployment-canary"
      || contract.canaryMaximumAgeMinutes !== 15
      || contract.deploymentMaximumAgeMinutes !== 1_440
      || !exactArray(contract.requiredCanaryChecks, FINALIZER_REQUIRED_CANARY_CHECKS)
      || validateFinalizerExternalEvidenceContract(contract.externalEvidence)
        !== contract.externalEvidence
      || contract.confirmationIncludesCanarySha256 !== true) {
    invalid(
      "FINALIZATION_CONTRACT_INVALID",
      "successor exact-owner finalization contract is missing or invalid",
    );
  }
  return contract;
}

export function validateAmoraExtendedReleaseContracts(manifest) {
  if (manifest?.status === "controller_ready") {
    return {
      forwardOnlySecurityOperations:
        validateSuccessorForwardOnlySecurityOperations(manifest),
      postExpandBackupContract:
        validateSuccessorPostExpandBackupContract(manifest),
      finalizationContract:
        validateSuccessorFinalizationContract(manifest),
    };
  }
  return {
    forwardOnlySecurityOperations:
      validateForwardOnlySecurityOperations(manifest),
    postExpandBackupContract: validatePostExpandBackupContract(manifest),
    finalizationContract: validateFinalizationContract(manifest),
  };
}
