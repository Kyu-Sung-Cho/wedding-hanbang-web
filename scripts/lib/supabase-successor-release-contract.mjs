import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { validateSuccessorRemoteBaselineContract } from "./supabase-successor-remote-baseline.mjs";
import {
  SUCCESSOR_STORAGE_OBSERVATION_KEYS,
  validateVendorDisclosureSuccessorStorageEvidenceProvenance,
} from "./vendor-disclosure-successor-storage-evidence-provenance.mjs";

export const SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/vendor-disclosure-v2-20260718.json";

const PREDECESSOR_MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RELEASE_ID = /^[a-z][a-z0-9-]{2,80}$/;
const SAFE_PROJECT_REF = /^[a-z0-9][a-z0-9-]{3,62}$/;
const MIGRATION_FILE = /^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/;
const DEPLOYMENT_EVIDENCE_KEYS = [
  "backup",
  "finalizer",
  "hostedStaging",
  "recoveryAssurance",
  "storage",
];
const LEGACY_BLOCKED_DEPLOYMENT_EVIDENCE_KEYS = [
  "backup",
  "finalizer",
  "hostedRestore",
  "hostedStaging",
  "storage",
];
const BLOCKED_TOP_LEVEL_KEYS = [
  "deploymentEvidence",
  "expandMigrations",
  "migrationFloor",
  "predecessorManifest",
  "projectRef",
  "release",
  "remoteBaselineContract",
  "requiredRemoteHead",
  "status",
];
// controller_ready는 실제 영수증을 Git에 넣지 않는다. 대신 controller contract와
// 저장소 밖 runtime receipt 스키마만 hash-pin한다.
const READY_TOP_LEVEL_KEYS = [...BLOCKED_TOP_LEVEL_KEYS, "controllerContract"].sort();
const BLOCKED_STATUS = "deployment_blocked";
const READY_STATUS = "controller_ready";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const MAX_RUNTIME_RECEIPT_BYTES = 64 * 1024;
const MAX_PRIVATE_RAW_EVIDENCE_BYTES = 4 * 1024 * 1024;
const SAFE_RECEIPT_FILE = /^[a-z0-9][a-z0-9_.-]{2,160}\.json$/;

const NO_ADDITIONAL_COST_LIMITATIONS = Object.freeze([
  "no hosted Supabase restore rehearsal was performed",
  "provider physical backup availability does not prove a successful restore",
  "encrypted logical/PGlite roundtrip does not prove a hosted Supabase restore",
  "Staging verification does not prove Production backup restorability",
]);

export const SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE = Object.freeze({
  additionalMonthlyCostUsd: 0,
  additionalProjectCreated: false,
  hostedRestorePerformed: false,
  restoreValidationClaimed: false,
  limitations: NO_ADDITIONAL_COST_LIMITATIONS,
});

export const SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT = Object.freeze({
  contractVersion: 1,
  kind: "successor-no-additional-cost-recovery-assurance-v1",
  releaseAssurance: SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  requiredRuntimeEvidenceNames: Object.freeze([
    "backup",
    "finalizer",
    "hostedStaging",
    "storage",
  ]),
  requiredPostExpandChecks: Object.freeze([
    "encryptedArtifactsVerified",
    "pgliteJsonbRoundTripVerified",
  ]),
});

export function validateSuccessorNoAdditionalCostReleaseAssurance(value) {
  const expected = SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE;
  if (!exactKeys(value, Object.keys(expected))
      || value.hostedRestorePerformed !== false
      || value.additionalProjectCreated !== false
      || value.additionalMonthlyCostUsd !== 0
      || value.restoreValidationClaimed !== false
      || !exactArray(value.limitations, expected.limitations)) {
    invalid(
      "NO_ADDITIONAL_COST_ASSURANCE_INVALID",
      "successor recovery assurance must disclose that no hosted restore validation occurred",
    );
  }
  return Object.freeze({
    ...expected,
    limitations: Object.freeze([...expected.limitations]),
  });
}

export const SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS = Object.freeze({
  backup: Object.freeze({
    kind: "successor-release-backup-evidence-v1",
    maximumAgeMinutes: 30,
    rawEvidenceSource: "verified-encrypted-database-backup",
    requiredChecks: Object.freeze([
      "databaseBackupVerified",
      "encryptedArtifactsVerified",
      "exactBaselineTableContractVerified",
      "providerPhysicalBackupAvailable",
      "restoreCandidateAvailable",
    ]),
  }),
  finalizer: Object.freeze({
    kind: "successor-release-finalizer-rehearsal-evidence-v1",
    maximumAgeMinutes: 1_440,
    rawEvidenceSource: "exact-owner-finalizer-rehearsal",
    requiredChecks: Object.freeze([
      "exactOwnerLeaseVerified",
      "templateRenderedWithSuccessorContracts",
      "canaryFenceHeld",
      "featureOffRollbackAvailable",
      "finalizerRehearsalPassed",
    ]),
  }),
  recoveryAssurance: Object.freeze({
    kind: "successor-release-recovery-assurance-v1",
    maximumAgeMinutes: 30,
    rawEvidenceSource: "existing-staging-and-encrypted-backup-assurance",
    requiredChecks: Object.freeze([
      "providerPhysicalBackupFresh",
      "encryptedLogicalBackupVerified",
      "postExpandEncryptedBackupVerified",
      "stagingExactMigrationSetVerified",
      "restoreNotClaimed",
    ]),
    releaseAssurance: SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  }),
  hostedStaging: Object.freeze({
    kind: "successor-release-hosted-staging-evidence-v1",
    maximumAgeMinutes: 1_440,
    rawEvidenceSource: "isolated-hosted-staging-probe",
    requiredChecks: Object.freeze([
      "exactMigrationSetApplied",
      "preconditionsPassed",
      "postconditionsPassed",
      "readOnlyPostchecksPassed",
      "rollbackRehearsed",
      "featureFlagsOffVerified",
    ]),
  }),
  storage: Object.freeze({
    kind: "successor-release-storage-evidence-v1",
    maximumAgeMinutes: 30,
    rawEvidenceSource: "storage-freeze-and-object-stability",
    requiredChecks: Object.freeze([
      "databaseWriteFenceHeld",
      "storageMutationPoliciesZero",
      "signedUploadTtlDrained",
      "objectInventoryStable",
      "storageOriginalBytesBackedUp",
    ]),
  }),
});

const SUCCESSOR_RUNTIME_EVIDENCE_PHASES = Object.freeze({
  complete: Object.freeze(Object.keys(SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS).sort()),
  "post-expand": Object.freeze(["recoveryAssurance"]),
  "pre-apply": Object.freeze([
    "backup",
    "finalizer",
    "hostedStaging",
    "storage",
  ]),
});

export class SuccessorReleaseContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SuccessorReleaseContractError";
    this.code = code;
  }
}

function invalid(code, message) {
  throw new SuccessorReleaseContractError(code, message);
}

function canonicalTextSha256(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function canonicalJsonSha256(value) {
  const canonicalJson = (candidate) => {
    if (candidate === null || typeof candidate !== "object") {
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) {
      return `[${candidate.map(canonicalJson).join(",")}]`;
    }
    return `{${Object.keys(candidate).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(candidate[key])}`,
    ).join(",")}}`;
  };
  return createHash("sha256")
    .update(`${canonicalJson(value)}\n`, "utf8")
    .digest("hex");
}

function exactKeys(value, expectedKeys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...expectedKeys].sort());
}

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function readBoundedRegularBytes(path, label, maximumBytes) {
  const before = existsSync(path) ? lstatSync(path) : null;
  if (!before?.isFile()
      || before.isSymbolicLink()
      || before.size < 2
      || before.size > maximumBytes) {
    invalid("RUNTIME_EVIDENCE_RAW_INVALID", `${label} must be one bounded non-symlink file`);
  }
  const sameFile = (left, right) => left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    const opened = fstatSync(descriptor);
    const linked = lstatSync(path);
    if (!opened.isFile()
        || !linked.isFile()
        || linked.isSymbolicLink()
        || !sameFile(before, opened)
        || !sameFile(opened, linked)) {
      invalid("RUNTIME_EVIDENCE_RAW_INVALID", `${label} changed while it was opened`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const linkedAfter = lstatSync(path);
    if (!sameFile(opened, after)
        || !sameFile(after, linkedAfter)
        || bytes.length !== after.size
        || bytes.length < 2
        || bytes.length > maximumBytes) {
      invalid("RUNTIME_EVIDENCE_RAW_INVALID", `${label} changed while it was read`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof SuccessorReleaseContractError) throw error;
    invalid("RUNTIME_EVIDENCE_RAW_INVALID", `${label} could not be read safely`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateRuntimeEvidenceContract(manifest, name, contract) {
  const requirement = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS[name];
  const contractKeys = [
    "kind",
    "maximumAgeMinutes",
    "rawEvidenceFileName",
    "rawEvidenceSource",
    "receiptFileName",
    "requiredChecks",
    ...(name === "recoveryAssurance" ? ["releaseAssurance"] : []),
  ];
  if (!requirement
      || !exactKeys(contract, contractKeys)
      || contract.kind !== requirement.kind
      || contract.maximumAgeMinutes !== requirement.maximumAgeMinutes
      || contract.rawEvidenceSource !== requirement.rawEvidenceSource
      || !exactArray(contract.requiredChecks, requirement.requiredChecks)
      || (name === "recoveryAssurance"
        && (() => {
          try {
            validateSuccessorNoAdditionalCostReleaseAssurance(
              contract.releaseAssurance,
            );
            return false;
          } catch {
            return true;
          }
        })())
      || !SAFE_RECEIPT_FILE.test(contract.receiptFileName ?? "")
      || !SAFE_RECEIPT_FILE.test(contract.rawEvidenceFileName ?? "")
      || basename(contract.receiptFileName) !== contract.receiptFileName
      || basename(contract.rawEvidenceFileName) !== contract.rawEvidenceFileName
      || contract.receiptFileName === contract.rawEvidenceFileName
      || !contract.receiptFileName.startsWith(`${manifest.release}-`)
      || !contract.rawEvidenceFileName.startsWith(`${manifest.release}-`)) {
    invalid(
      "DEPLOYMENT_EVIDENCE_INVALID",
      `${name} must pin the exact private runtime receipt contract`,
    );
  }
  return contract;
}

function runtimeEvidenceVersions(manifest) {
  if (!Array.isArray(manifest.expandMigrations) || manifest.expandMigrations.length === 0) {
    invalid("RUNTIME_EVIDENCE_CONTRACT_INVALID", "successor migrations are missing");
  }
  const versions = manifest.expandMigrations.map((entry) => {
    const match = typeof entry?.file === "string" ? entry.file.match(MIGRATION_FILE) : null;
    if (!match) invalid("RUNTIME_EVIDENCE_CONTRACT_INVALID", "successor migration is invalid");
    return match[1];
  });
  if (versions.some((version, index) => index > 0 && version <= versions[index - 1])) {
    invalid("RUNTIME_EVIDENCE_CONTRACT_INVALID", "successor migrations are not strictly ordered");
  }
  return versions;
}

function validateRuntimeEvidenceObservations({
  name,
  observations,
  manifest,
  controllerManifest,
  expected,
}) {
  const backup = controllerManifest.backupContract;
  const postExpandBackup = controllerManifest.postExpandBackupContract;
  const rollback = controllerManifest.rollbackContract;
  const manualControl = controllerManifest.manualControlEvidence;
  const finalization = controllerManifest.finalizationContract;
  if (name === "backup") {
    return exactKeys(observations, [
      "backupContractId",
      "backupContractVersion",
      "expectedMigrationHead",
      "expectedTableContractSha256",
      "expectedTableCount",
      "providerPhysicalBackupStatus",
      "restoreCandidateAvailable",
    ])
      && observations.backupContractId === backup?.id
      && observations.backupContractVersion === backup?.version
      && observations.expectedMigrationHead === backup?.expectedMigrationHead
      && observations.expectedTableCount === backup?.expectedTableCount
      && observations.expectedTableContractSha256
        === backup?.expectedTableContractSha256
      && observations.providerPhysicalBackupStatus
        === backup?.providerPhysicalBackup?.requiredStatus
      && observations.restoreCandidateAvailable === true;
  }
  if (name === "recoveryAssurance") {
    return exactKeys(observations, [
      "backupContractId",
      "hostedStagingRawEvidenceSha256",
      "hostedStagingReceiptSha256",
      "postExpandBackupContractId",
      "postExpandBackupManifestSha256",
      "postExpandBackupReceiptSha256",
      "postExpandBackupReverificationSha256",
      "postExpandEncryptedArtifactsVerified",
      "postExpandLiveSchemaContractSha256",
      "postExpandLogicalDataContractSha256",
      "postExpandPGliteJsonbRoundTripVerified",
      "preApplyBackupRawEvidenceSha256",
      "preApplyBackupReceiptSha256",
      "providerPhysicalBackupStatus",
    ])
      && observations.backupContractId === backup?.id
      && observations.postExpandBackupContractId === postExpandBackup?.id
      && observations.providerPhysicalBackupStatus
        === backup?.providerPhysicalBackup?.requiredStatus
      && observations.postExpandEncryptedArtifactsVerified === true
      && observations.postExpandPGliteJsonbRoundTripVerified === true
      && [
        "hostedStagingRawEvidenceSha256",
        "hostedStagingReceiptSha256",
        "postExpandBackupManifestSha256",
        "postExpandBackupReceiptSha256",
        "postExpandBackupReverificationSha256",
        "postExpandLiveSchemaContractSha256",
        "postExpandLogicalDataContractSha256",
        "preApplyBackupRawEvidenceSha256",
        "preApplyBackupReceiptSha256",
      ].every((key) => SHA256.test(observations[key] ?? ""));
  }
  if (name === "hostedStaging") {
    return exactKeys(observations, [
      "expectedMigrationHead",
      "migrationCount",
      "migrationVersionsSha256",
      "requiredRemoteHead",
      "rollbackStrategy",
    ])
      && observations.expectedMigrationHead === expected.expectedMigrationHead
      && observations.migrationCount === expected.migrationCount
      && observations.migrationVersionsSha256
        === expected.migrationVersionsSha256
      && observations.requiredRemoteHead === manifest.requiredRemoteHead
      && observations.rollbackStrategy === rollback?.strategy;
  }
  if (name === "storage") {
    return exactKeys(observations, SUCCESSOR_STORAGE_OBSERVATION_KEYS)
      && observations.requiredMutationPolicyCount === 0
      && observations.signedUploadGraceMinutes
        === manualControl?.signedUploadGraceMinutes
      && observations.signedUploadTokenTtlMinutes
        === manualControl?.signedUploadTokenTtlMinutes
      && observations.storageStabilityWindowMinutes
        === manualControl?.storageStabilityWindowMinutes
      && observations.writeFenceReceiptFileName
        === manualControl?.receiptFileName;
  }
  if (name === "finalizer") {
    return exactKeys(observations, [
      "featureOffReceiptFileName",
      "finalizationContractVersion",
      "migrationRollback",
      "requiredControls",
      "rollbackStrategy",
    ])
      && observations.featureOffReceiptFileName
        === rollback?.featureOffReceiptFileName
      && observations.finalizationContractVersion === finalization?.version
      && observations.migrationRollback === rollback?.migrationRollback
      && observations.rollbackStrategy === rollback?.strategy
      && exactKeys(
        observations.requiredControls,
        Object.keys(REQUIRED_ROLLBACK_CONTROLS),
      )
      && Object.entries(REQUIRED_ROLLBACK_CONTROLS).every(
        ([key, value]) => observations.requiredControls[key] === value,
      );
  }
  return false;
}

/**
 * Validate the private, fresh evidence receipts required for one release
 * phase. Pre-apply intentionally excludes the post-expand restore receipt,
 * which cannot exist until the exact Production suffix has been applied.
 *
 * The manifest pins schemas and filenames only. Actual receipts and their raw
 * provenance must remain together outside Git, which avoids the impossible
 * self-reference of committing a receipt that claims the SHA of the commit
 * that contains it.
 */
export function validateSuccessorRuntimeEvidence({
  repoRoot,
  receiptRoot,
  manifest,
  controllerManifest,
  expectedCommit,
  phase = "complete",
  now = () => new Date(),
}) {
  const root = resolve(repoRoot);
  const receipts = resolve(receiptRoot);
  const rootMetadata = existsSync(receipts) ? lstatSync(receipts) : null;
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink() || inside(root, receipts)) {
    invalid(
      "RUNTIME_EVIDENCE_ROOT_INVALID",
      "successor evidence must live in one non-symlink directory outside Git",
    );
  }
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(receipts);
  } catch {
    invalid("RUNTIME_EVIDENCE_ROOT_INVALID", "successor evidence directory cannot be resolved");
  }
  if (inside(realpathSync(root), canonicalRoot)
      || !COMMIT_SHA.test(expectedCommit ?? "")
      || manifest?.status !== "controller_ready"
      || manifest?.release !== controllerManifest?.release
      || manifest?.projectRef !== controllerManifest?.projectRef
      || !/^\d{14}$/.test(manifest?.requiredRemoteHead ?? "")) {
    invalid("RUNTIME_EVIDENCE_CONTRACT_INVALID", "successor runtime contract identity is invalid");
  }
  const allEvidenceNames = Object.keys(SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS).sort();
  const evidenceNames = SUCCESSOR_RUNTIME_EVIDENCE_PHASES[phase];
  if (!evidenceNames) {
    invalid("RUNTIME_EVIDENCE_CONTRACT_INVALID", "successor runtime evidence phase is invalid");
  }
  if (!exactKeys(manifest.deploymentEvidence, allEvidenceNames)) {
    invalid("DEPLOYMENT_EVIDENCE_INVALID", "successor must pin exactly five runtime evidence contracts");
  }
  const versions = runtimeEvidenceVersions(manifest);
  const postApplyCheckIds = Array.isArray(controllerManifest.postApplyChecks)
    ? controllerManifest.postApplyChecks.map((check) => check?.id)
    : [];
  if (postApplyCheckIds.length === 0
      || postApplyCheckIds.some((id) => !/^[a-z][a-z0-9-]{2,63}$/.test(id ?? ""))
      || new Set(postApplyCheckIds).size !== postApplyCheckIds.length
      || !controllerManifest.rollbackContract
      || typeof controllerManifest.rollbackContract !== "object"
      || Array.isArray(controllerManifest.rollbackContract)) {
    invalid(
      "RUNTIME_EVIDENCE_CONTRACT_INVALID",
      "successor must pin non-empty postchecks and a feature-off rollback contract",
    );
  }
  const expected = {
    migrationCount: versions.length,
    migrationVersionsSha256: canonicalTextSha256(`${versions.join("\n")}\n`),
    expectedMigrationHead: versions.at(-1),
    postApplyCheckIds,
    postApplyChecksSha256: canonicalTextSha256(`${postApplyCheckIds.join("\n")}\n`),
    rollbackContractSha256: canonicalJsonSha256(controllerManifest.rollbackContract),
  };
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) {
    invalid("RUNTIME_EVIDENCE_CONTRACT_INVALID", "runtime evidence clock is invalid");
  }
  const result = {};
  for (const name of evidenceNames) {
    const contract = validateRuntimeEvidenceContract(
      manifest,
      name,
      manifest.deploymentEvidence[name],
    );
    const receiptPath = resolve(canonicalRoot, contract.receiptFileName);
    const rawPath = resolve(canonicalRoot, contract.rawEvidenceFileName);
    if (dirname(receiptPath) !== canonicalRoot || dirname(rawPath) !== canonicalRoot) {
      invalid("RUNTIME_EVIDENCE_ROOT_INVALID", `${name} evidence escapes its private receipt set`);
    }
    const receiptBytes = readBoundedRegularBytes(
      receiptPath,
      `${name} structured receipt`,
      MAX_RUNTIME_RECEIPT_BYTES,
    );
    let receipt;
    try {
      receipt = JSON.parse(receiptBytes.toString("utf8"));
    } catch {
      invalid("RUNTIME_EVIDENCE_RECEIPT_INVALID", `${name} receipt is not valid JSON`);
    }
    const receiptKeys = [
      "capturedAt",
      "checks",
      "containsSecrets",
      "expectedMigrationHead",
      "expiresAt",
      "kind",
      "migrationCount",
      "migrationVersionsSha256",
      "observations",
      "postApplyCheckIds",
      "postApplyChecksSha256",
      "projectRef",
      "rawProvenance",
      "receiptVersion",
      "release",
      "releaseCommit",
      "requiredRemoteHead",
      "rollbackContractSha256",
      ...(name === "recoveryAssurance" ? ["releaseAssurance"] : []),
    ];
    const capturedAtMs = ISO_TIMESTAMP.test(receipt?.capturedAt ?? "")
      ? Date.parse(receipt.capturedAt)
      : Number.NaN;
    const expiresAtMs = ISO_TIMESTAMP.test(receipt?.expiresAt ?? "")
      ? Date.parse(receipt.expiresAt)
      : Number.NaN;
    const checksValid = exactKeys(receipt?.checks, contract.requiredChecks)
      && contract.requiredChecks.every((check) => receipt.checks[check] === true);
    const observationsValid = validateRuntimeEvidenceObservations({
      name,
      observations: receipt?.observations,
      manifest,
      controllerManifest,
      expected,
    });
    if (!exactKeys(receipt, receiptKeys)
        || receipt.receiptVersion !== 1
        || receipt.kind !== contract.kind
        || receipt.release !== manifest.release
        || receipt.projectRef !== manifest.projectRef
        || receipt.releaseCommit !== expectedCommit
        || receipt.requiredRemoteHead !== manifest.requiredRemoteHead
        || receipt.expectedMigrationHead !== expected.expectedMigrationHead
        || receipt.migrationCount !== expected.migrationCount
        || receipt.migrationVersionsSha256 !== expected.migrationVersionsSha256
        || !exactArray(receipt.postApplyCheckIds, expected.postApplyCheckIds)
        || receipt.postApplyChecksSha256 !== expected.postApplyChecksSha256
        || receipt.rollbackContractSha256 !== expected.rollbackContractSha256
        || receipt.containsSecrets !== false
        || (name === "recoveryAssurance"
          && (() => {
            try {
              validateSuccessorNoAdditionalCostReleaseAssurance(
                receipt.releaseAssurance,
              );
              return canonicalJsonSha256(receipt.releaseAssurance)
                !== canonicalJsonSha256(contract.releaseAssurance);
            } catch {
              return true;
            }
          })())
        || !checksValid
        || !observationsValid
        || !exactKeys(receipt.rawProvenance, [
          "capturedAt",
          "fileName",
          "sha256",
          "source",
        ])
        || receipt.rawProvenance.fileName !== contract.rawEvidenceFileName
        || receipt.rawProvenance.capturedAt !== receipt.capturedAt
        || receipt.rawProvenance.source !== contract.rawEvidenceSource
        || !SHA256.test(receipt.rawProvenance.sha256 ?? "")
        || !Number.isFinite(capturedAtMs)
        || !Number.isFinite(expiresAtMs)
        || expiresAtMs - capturedAtMs !== contract.maximumAgeMinutes * 60_000
        || capturedAtMs > nowMs + 60_000) {
      invalid(
        "RUNTIME_EVIDENCE_RECEIPT_INVALID",
        `${name} structured receipt is incomplete, mismatched or non-canonical`,
      );
    }
    if (expiresAtMs <= nowMs) {
      invalid("RUNTIME_EVIDENCE_STALE", `${name} structured receipt is stale`);
    }
    const rawBytes = readBoundedRegularBytes(
      rawPath,
      `${name} private raw provenance`,
      MAX_PRIVATE_RAW_EVIDENCE_BYTES,
    );
    const rawSha256 = createHash("sha256").update(rawBytes).digest("hex");
    if (rawSha256 !== receipt.rawProvenance.sha256) {
      invalid(
        "RUNTIME_EVIDENCE_RAW_INVALID",
        `${name} private raw provenance differs from its structured receipt`,
      );
    }
    let storageProvenance;
    if (name === "storage") {
      let raw;
      try {
        raw = JSON.parse(rawBytes.toString("utf8"));
        storageProvenance =
          validateVendorDisclosureSuccessorStorageEvidenceProvenance({
            receipt,
            raw,
            manifest,
            controllerManifest,
            expectedCommit,
          });
      } catch {
        invalid(
          "RUNTIME_EVIDENCE_RAW_INVALID",
          "storage private raw provenance does not bind the exact original-byte archive",
        );
      }
    }
    result[name] = Object.freeze({
      receiptPath,
      receiptSha256: createHash("sha256").update(receiptBytes).digest("hex"),
      rawEvidencePath: rawPath,
      rawEvidenceSha256: rawSha256,
      verifiedAt: receipt.capturedAt,
      expiresAt: receipt.expiresAt,
      ...(storageProvenance ? { storageProvenance } : {}),
      ...(name === "recoveryAssurance" ? {
        observations: Object.freeze({ ...receipt.observations }),
        releaseAssurance:
          validateSuccessorNoAdditionalCostReleaseAssurance(
            receipt.releaseAssurance,
          ),
      } : {}),
    });
  }
  const recovery = result.recoveryAssurance;
  if (recovery && result.backup && result.hostedStaging) {
    const bindings = recovery.observations;
    if (bindings.preApplyBackupReceiptSha256
          !== result.backup.receiptSha256
        || bindings.preApplyBackupRawEvidenceSha256
          !== result.backup.rawEvidenceSha256
        || bindings.hostedStagingReceiptSha256
          !== result.hostedStaging.receiptSha256
        || bindings.hostedStagingRawEvidenceSha256
          !== result.hostedStaging.rawEvidenceSha256) {
      invalid(
        "RUNTIME_EVIDENCE_CROSS_BINDING_INVALID",
        "recovery assurance does not bind the exact backup and hosted Staging evidence",
      );
    }
  }
  return Object.freeze(result);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function readPinnedRegularFile(repoRoot, entry, label, expectedDirectory) {
  if (!entry
      || typeof entry.file !== "string"
      || entry.file.includes("\\")
      || entry.file.includes("//")
      || !SHA256.test(entry.sha256 ?? "")) {
    invalid("PIN_INVALID", `${label} pin is missing or invalid`);
  }
  const path = resolve(repoRoot, entry.file);
  if (!inside(repoRoot, path)
      || (expectedDirectory && dirname(path) !== resolve(expectedDirectory))) {
    invalid("PIN_PATH_INVALID", `${label} path escapes its allowed directory`);
  }
  if (!existsSync(path)) invalid("PIN_MISSING", `${label} is missing: ${entry.file}`);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    invalid("PIN_FILE_INVALID", `${label} must be a non-symlink regular file`);
  }
  const text = readFileSync(path, "utf8");
  const actual = canonicalTextSha256(text);
  if (actual !== entry.sha256) {
    invalid(
      "PIN_HASH_MISMATCH",
      `${label} hash mismatch for ${entry.file}; expected ${entry.sha256}, received ${actual}`,
    );
  }
  return { path, text };
}

function declaredMigrations(manifest) {
  const sections = [
    manifest?.historicalReconciliation ?? [],
    manifest?.expandMigrations ?? [],
    manifest?.appliedHotfixes ?? [],
  ];
  if (sections.some((section) => !Array.isArray(section))) {
    invalid("PREDECESSOR_MANIFEST_INVALID", "predecessor migration sections are invalid");
  }
  return sections.flat();
}

function verifyMigration(repoRoot, entry, label) {
  const match = typeof entry?.file === "string" ? entry.file.match(MIGRATION_FILE) : null;
  if (!match || basename(entry.file) !== entry.file || !SHA256.test(entry.sha256 ?? "")) {
    invalid("MIGRATION_RECORD_INVALID", `${label} migration record is invalid`);
  }
  const relativePath = `supabase/migrations/${entry.file}`;
  readPinnedRegularFile(
    repoRoot,
    { file: relativePath, sha256: entry.sha256 },
    `${label} migration`,
    join(repoRoot, "supabase", "migrations"),
  );
  return match[1];
}

function verifyPinnedManifestChain({
  repoRoot,
  pin,
  expectedProjectRef,
  visited,
  label,
}) {
  const releaseManifestDir = join(repoRoot, "supabase", "release-manifests");
  const { path, text } = readPinnedRegularFile(
    repoRoot,
    pin,
    label,
    releaseManifestDir,
  );
  if (visited.has(path)) invalid("PREDECESSOR_CYCLE", "release manifest predecessor cycle detected");
  visited.add(path);
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    invalid("PREDECESSOR_MANIFEST_INVALID", `${label} is not valid JSON`);
  }
  if (manifest.projectRef !== expectedProjectRef) {
    invalid("PREDECESSOR_PROJECT_MISMATCH", `${label} project ref does not match successor`);
  }
  const versions = declaredMigrations(manifest).map((entry) =>
    verifyMigration(repoRoot, entry, label));
  if (manifest.predecessorManifest) {
    verifyPinnedManifestChain({
      repoRoot,
      pin: manifest.predecessorManifest,
      expectedProjectRef,
      visited,
      label: `${label} predecessor`,
    });
  }
  return { manifest, versions };
}

/**
 * 매니페스트가 어느 상태인지 판정하고, 그 상태의 규칙을 전부 강제한다.
 *
 *   deployment_blocked — 기존 차단 매니페스트의 증거 5종이 전부 "missing"이어야 한다.
 *   controller_ready   — Git에는 receipt 스키마와 controller contract만 고정하고,
 *                        실제 증거와 raw provenance는 실행 때 저장소 밖에서 검증한다.
 *
 * 둘 사이 어중간한 상태는 없다. "일부만 증거가 있다"는 곧 "확인 안 된 것이 섞여
 * 있다"이고, 그런 매니페스트로 게이트를 열면 무엇이 검증됐는지 알 수 없게 된다.
 */
function validateDeploymentBlock(repoRoot, manifest) {
  const evidence = manifest.deploymentEvidence;
  const keys = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? Object.keys(evidence).sort()
    : [];
  if (manifest.status === BLOCKED_STATUS) {
    if (JSON.stringify(keys)
          !== JSON.stringify(LEGACY_BLOCKED_DEPLOYMENT_EVIDENCE_KEYS)) {
      invalid(
        "DEPLOYMENT_EVIDENCE_INVALID",
        "deployment-blocked successor must retain its exact legacy missing-evidence shape",
      );
    }
    if (keys.some((key) => evidence[key] !== "missing")) {
      invalid(
        "DEPLOYMENT_EVIDENCE_INVALID",
        "deployment-blocked successor must explicitly mark every legacy evidence class missing",
      );
    }
    return { released: false, releaseCommit: null };
  }

  if (manifest.status !== READY_STATUS) {
    invalid(
      "DEPLOYMENT_STATUS_INVALID",
      `successor status must be ${BLOCKED_STATUS} or ${READY_STATUS}`,
    );
  }
  if (JSON.stringify(keys) !== JSON.stringify(DEPLOYMENT_EVIDENCE_KEYS)) {
    invalid(
      "DEPLOYMENT_EVIDENCE_INVALID",
      "controller-ready successor must list exactly the five no-cost runtime evidence classes",
    );
  }
  const evidenceFileNames = new Set();
  for (const key of DEPLOYMENT_EVIDENCE_KEYS) {
    if (evidence[key] === "missing") {
      invalid(
        "DEPLOYMENT_EVIDENCE_INVALID",
        `controller-ready successor still marks ${key} missing`,
      );
    }
    const contract = validateRuntimeEvidenceContract(manifest, key, evidence[key]);
    for (const fileName of [
      contract.receiptFileName,
      contract.rawEvidenceFileName,
    ]) {
      if (evidenceFileNames.has(fileName)) {
        invalid(
          "DEPLOYMENT_EVIDENCE_INVALID",
          "successor runtime evidence filenames must be globally distinct",
        );
      }
      evidenceFileNames.add(fileName);
    }
  }
  return { released: true, releaseCommit: null };
}

const CONTROLLER_CONTRACT_KEYS = [
  "backupContract",
  "contractVersion",
  "finalizationContract",
  "forwardOnlySecurityOperations",
  "historicalEffectAudit",
  "recoveryAssuranceContract",
  "manualControlEvidence",
  "manualPlatformOperations",
  "postApplyChecks",
  "postExpandBackupContract",
  "postPushChecks",
  "preApplyChecks",
  "projectRef",
  "release",
  "requiredDocuments",
  "rollbackArtifacts",
  "rollbackContract",
].sort();

function validateRecoveryAssuranceControllerContract(value) {
  const expected = SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT;
  let assuranceValid = true;
  try {
    validateSuccessorNoAdditionalCostReleaseAssurance(
      value?.releaseAssurance,
    );
  } catch {
    assuranceValid = false;
  }
  if (!exactKeys(value, Object.keys(expected))
      || value.contractVersion !== expected.contractVersion
      || value.kind !== expected.kind
      || !exactArray(
        value.requiredRuntimeEvidenceNames,
        expected.requiredRuntimeEvidenceNames,
      )
      || !exactArray(
        value.requiredPostExpandChecks,
        expected.requiredPostExpandChecks,
      )
      || !assuranceValid) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor must pin the exact no-additional-cost recovery assurance",
    );
  }
}

const REQUIRED_ROLLBACK_CONTROLS = Object.freeze({
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
const REQUIRED_ROLLBACK_CHECKS = Object.freeze([
  "databaseWriteFenceHeld",
  "storageWriteFenceHeld",
  "authSignupDisabled",
  "webWriteFenceEnabled",
  "chatPartnerRecipientBoundaryHeld",
  "conversationSegmentScopeBoundaryHeld",
]);

const SUCCESSOR_STORAGE_OPERATION_SPECS = Object.freeze([
  Object.freeze({
    id: "vendor-disclosure-successor-storage-write-freeze-v1",
    phase: "pre-backup",
    verificationCheckId: "vendor-disclosure-successor-storage-frozen",
    file: "supabase/platform-operations/storage/20260819100000_vendor_disclosure_successor_storage_write_freeze.operation.json",
    contractSha256: "200f5e2904baab4d9a0cd39b595b988de6d68a644247281110e84f600bdbef1e",
    recovery: Object.freeze({
      id: "successor-storage-freeze-forward-recovery-v1",
      file: "supabase/platform-operations/storage/20260819100000_vendor_disclosure_successor_storage_write_freeze.forward-recovery.json",
      contractSha256: "f4990bde81effcb057f231ccd2fd5b6057ba174a44edf9417e009ea5f731af74",
    }),
  }),
  Object.freeze({
    id: "vendor-disclosure-successor-storage-final-convergence-v1",
    phase: "post-push-pre-deploy",
    verificationCheckId: "vendor-disclosure-successor-storage-target",
    file: "supabase/platform-operations/storage/20260819102000_vendor_disclosure_successor_storage_final_convergence.operation.json",
    contractSha256: "3f35a8a8bee63ae6f38c8eee3139e29c3284ac7542d43772e0443d585ceb26f6",
    recovery: Object.freeze({
      id: "successor-storage-final-compensation-v1",
      file: "supabase/platform-operations/storage/20260819102000_vendor_disclosure_successor_storage_final_convergence.compensation.json",
      contractSha256: "8dea5a304c6c6be9e90be8ceea0c0640382d8323ec313dfc6dda17f319493bf4",
    }),
  }),
]);

const SUCCESSOR_LIVE_SCHEMA_SECURITY_SPEC = Object.freeze({
  check: Object.freeze({
    id: "production-successor-live-schema-contract-verify-20260819121500",
    type: "read-only-sql",
    file: "supabase/release-checks/20260819121500_production_successor_live_schema_contract_verify.sql",
    sha256: "63e2d25dea8d8d424597d07f035e733bbc90da773ddf29e991574bd0241f09a7",
    expectedEvidence: Object.freeze({
      production_successor_live_schema_contract_verify_count: 1,
    }),
  }),
  operation: Object.freeze({
    id: "production-successor-live-schema-contract-20260819121500",
    phase: "pre-backup",
    verificationCheckId:
      "production-successor-live-schema-contract-verify-20260819121500",
    file: "supabase/platform-operations/security/20260819121500_production_successor_live_schema_contract_apply.sql",
    sha256: "80efc2771711e831860bc7b9a1507c0d0cc93342ab743f7d6f29d899b95cde66",
  }),
  rollback: Object.freeze({
    id: "production-successor-schema-contract-rollback-20260819121500",
    forOperationId:
      "production-successor-live-schema-contract-20260819121500",
    file: "supabase/platform-operations/security/20260819121500_production_successor_live_schema_contract_rollback.sql",
    sha256: "49c595ff3449958be290fa8a2da15b4b7e043d82d56b9673690b8396c6eb1526",
  }),
});

const SUCCESSOR_DATABASE_WRITE_FENCE_SPEC = Object.freeze({
  check: Object.freeze({
    id: "public-database-write-fence-pre",
    type: "read-only-sql",
    file: "supabase/release-checks/amora-engine-v2-production-write-fence-pre.sql",
    sha256: "412511d61f110df8a6b87a5eafcf40ce95c77851438c1e06e31b119f5d0c4a6c",
    expectedEvidence: Object.freeze({
      production_write_fence_verified_count: 1,
    }),
  }),
  operation: Object.freeze({
    id: "production-write-fence-20260717120000",
    phase: "pre-backup",
    verificationCheckId: "public-database-write-fence-pre",
    file: "supabase/platform-operations/security/20260717120000_production_write_fence_apply.sql",
    sha256: "a5166152091dd8a71f33ce6271a92fc2276993036ae0a8649d7840ba6de6e284",
  }),
  rollback: Object.freeze({
    id: "production-write-fence-rollback-20260717120000",
    forOperationId: "production-write-fence-20260717120000",
    file: "supabase/platform-operations/security/20260717120000_production_write_fence_rollback.sql",
    sha256: "bef0340b5296bfa64eae077121653090552e891a4f151aa248f72673c4f50b5d",
  }),
});

const FORBIDDEN_PREDECESSOR_STORAGE_ARTIFACTS = Object.freeze([
  "storage-global-write-freeze-20260716108000",
  "community-upload-storage-finalize-20260716108000",
  "community-upload-service-fence-20260716108000",
  "supabase/platform-operations/storage/20260716108000_storage_global_write_freeze_apply.sql",
  "supabase/platform-operations/storage/20260716108000_community_upload_service_fence_apply.sql",
]);

function exactTextListSha256(values) {
  return canonicalTextSha256(`${values.join("\n")}\n`);
}

export function successorCreatedPublicTables(repoRoot, migrations) {
  const tables = new Set();
  for (const migration of migrations) {
    const sql = readFileSync(
      join(repoRoot, "supabase", "migrations", migration.file),
      "utf8",
    );
    const declarations = sql.match(/^\s*CREATE\s+TABLE\b[^\r\n]*/gim) ?? [];
    for (const declaration of declarations) {
      const match = declaration.match(
        /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z][a-z0-9_]*)\s*(?:\(|AS\b)/i,
      );
      if (!match) {
        invalid(
          "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
          `successor CREATE TABLE must be statically schema-qualified and contractible: ${migration.file}`,
        );
      }
      tables.add(match[1].toLowerCase());
    }
  }
  return [...tables].sort();
}

function safeExactTableList(value, expectedCount, expectedSha256) {
  return Array.isArray(value)
    && value.length === expectedCount
    && value.length > 0
    && value.every((entry) => /^[a-z][a-z0-9_]{1,62}$/.test(entry))
    && new Set(value).size === value.length
    && [...value].sort().every((entry, index) => entry === value[index])
    && exactTextListSha256(value) === expectedSha256;
}

function validateRollbackContract(manifest, rollback) {
  if (!exactKeys(rollback, [
    "featureOffReceiptFileName",
    "maximumAgeMinutes",
    "migrationRollback",
    "requiredChecks",
    "requiredControls",
    "strategy",
    "version",
  ])
      || rollback.version !== 1
      || rollback.strategy !== "forward-fix-feature-off"
      || rollback.migrationRollback !== "prohibited"
      || rollback.featureOffReceiptFileName
        !== `${manifest.release}-feature-off-rollback.json`
      || rollback.maximumAgeMinutes !== 30
      || !exactKeys(rollback.requiredControls, Object.keys(REQUIRED_ROLLBACK_CONTROLS))
      || Object.entries(REQUIRED_ROLLBACK_CONTROLS).some(
        ([name, value]) => rollback.requiredControls[name] !== value,
      )
      || !exactArray(rollback.requiredChecks, REQUIRED_ROLLBACK_CHECKS)) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor rollback must be forward-fix-only with exact feature-off and fence controls",
    );
  }
}

function parsePinnedContractJson(repoRoot, pin, label, expectedDirectory) {
  const { text } = readPinnedRegularFile(repoRoot, pin, label, expectedDirectory);
  try {
    return JSON.parse(text);
  } catch {
    invalid("SUCCESSOR_CONTROLLER_CONTRACT_INVALID", `${label} is not JSON`);
  }
}

function validateSuccessorLiveSchemaSecurityContract({ repoRoot, contract }) {
  const spec = SUCCESSOR_LIVE_SCHEMA_SECURITY_SPEC;
  const check = contract.preApplyChecks.find((entry) => entry?.id === spec.check.id);
  const operation = contract.manualPlatformOperations.find(
    (entry) => entry?.id === spec.operation.id,
  );
  const rollback = contract.rollbackArtifacts.find(
    (entry) => entry?.forOperationId === spec.operation.id,
  );
  if (canonicalJsonSha256(check) !== canonicalJsonSha256(spec.check)
      || canonicalJsonSha256(operation) !== canonicalJsonSha256(spec.operation)
      || canonicalJsonSha256(rollback) !== canonicalJsonSha256(spec.rollback)) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor live-schema helper, release check and rollback must remain exact",
    );
  }
  readPinnedRegularFile(
    repoRoot,
    check,
    "successor live-schema verification check",
    join(repoRoot, "supabase", "release-checks"),
  );
  for (const [label, artifact] of [
    ["apply", operation],
    ["rollback", rollback],
  ]) {
    readPinnedRegularFile(
      repoRoot,
      artifact,
      `successor live-schema ${label}`,
      join(repoRoot, "supabase", "platform-operations", "security"),
    );
  }
}

function validateSuccessorDatabaseWriteFenceContract({ repoRoot, contract }) {
  const spec = SUCCESSOR_DATABASE_WRITE_FENCE_SPEC;
  const check = contract.preApplyChecks.find((entry) => entry?.id === spec.check.id);
  const operation = contract.manualPlatformOperations.find(
    (entry) => entry?.id === spec.operation.id,
  );
  const rollback = contract.rollbackArtifacts.find(
    (entry) => entry?.forOperationId === spec.operation.id,
  );
  if (canonicalJsonSha256(check) !== canonicalJsonSha256(spec.check)
      || canonicalJsonSha256(operation) !== canonicalJsonSha256(spec.operation)
      || canonicalJsonSha256(rollback) !== canonicalJsonSha256(spec.rollback)) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor Production database write fence must remain exact",
    );
  }
  readPinnedRegularFile(
    repoRoot,
    check,
    "successor Production database write-fence check",
    join(repoRoot, "supabase", "release-checks"),
  );
  for (const [label, artifact] of [
    ["apply", operation],
    ["rollback", rollback],
  ]) {
    readPinnedRegularFile(
      repoRoot,
      artifact,
      `successor Production database write-fence ${label}`,
      join(repoRoot, "supabase", "platform-operations", "security"),
    );
  }
}

function validateSuccessorStoragePlatformContracts({ repoRoot, manifest, contract }) {
  const storageDirectory = join(
    repoRoot,
    "supabase",
    "platform-operations",
    "storage",
  );
  const releaseChecksDirectory = join(repoRoot, "supabase", "release-checks");
  const manualOperations = contract.manualPlatformOperations;
  const rollbackArtifacts = contract.rollbackArtifacts;
  const allArtifactTokens = [...manualOperations, ...rollbackArtifacts]
    .flatMap((entry) => [entry?.id, entry?.file]);
  if (FORBIDDEN_PREDECESSOR_STORAGE_ARTIFACTS.some(
    (token) => allArtifactTokens.includes(token),
  )) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor Storage operations must not reuse predecessor Storage mutation artifacts",
    );
  }

  const allChecks = [
    ...contract.preApplyChecks,
    ...contract.postPushChecks,
  ];
  for (const spec of SUCCESSOR_STORAGE_OPERATION_SPECS) {
    const operation = manualOperations.find((entry) => entry?.id === spec.id);
    const recovery = rollbackArtifacts.find(
      (entry) => entry?.forOperationId === spec.id,
    );
    if (!exactKeys(operation, [
      "file",
      "id",
      "phase",
      "sha256",
      "verificationCheckId",
    ])
        || operation.phase !== spec.phase
        || operation.verificationCheckId !== spec.verificationCheckId
        || operation.file !== spec.file
        || !exactKeys(recovery, ["file", "forOperationId", "id", "sha256"])
        || recovery.id !== spec.recovery.id
        || recovery.file !== spec.recovery.file) {
      invalid(
        "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
        "successor Storage operations and recovery artifacts must be exact",
      );
    }

    const operationContract = parsePinnedContractJson(
      repoRoot,
      operation,
      `${spec.id} operation contract`,
      storageDirectory,
    );
    const recoveryContract = parsePinnedContractJson(
      repoRoot,
      recovery,
      `${spec.id} recovery contract`,
      storageDirectory,
    );
    if (operationContract.projectRef !== manifest.projectRef
        || canonicalJsonSha256(operationContract) !== spec.contractSha256
        || canonicalJsonSha256(recoveryContract) !== spec.recovery.contractSha256) {
      invalid(
        "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
        "successor Storage state transitions, object preservation and recovery must remain exact",
      );
    }

    const releaseCheck = operationContract.releaseCheck;
    const controllerCheck = allChecks.find(
      (entry) => entry?.id === spec.verificationCheckId,
    );
    if (canonicalJsonSha256(controllerCheck) !== canonicalJsonSha256({
      ...releaseCheck,
      type: "read-only-sql",
    })) {
      invalid(
        "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
        "successor Storage operation must bind its exact typed release check",
      );
    }
    readPinnedRegularFile(
      repoRoot,
      releaseCheck,
      `${spec.id} release check`,
      releaseChecksDirectory,
    );
    for (const [name, verifier] of Object.entries(operationContract.verifiers)) {
      readPinnedRegularFile(
        repoRoot,
        verifier,
        `${spec.id} ${name} verifier`,
        storageDirectory,
      );
    }
  }

  const successorOperationIds = new Set(
    SUCCESSOR_STORAGE_OPERATION_SPECS.map((entry) => entry.id),
  );
  const successorStorageFiles = manualOperations.filter(
    (entry) => typeof entry?.file === "string"
      && entry.file.startsWith("supabase/platform-operations/storage/"),
  );
  const successorStorageRollbackFiles = rollbackArtifacts.filter(
    (entry) => typeof entry?.file === "string"
      && entry.file.startsWith("supabase/platform-operations/storage/"),
  );
  if (successorStorageFiles.length !== SUCCESSOR_STORAGE_OPERATION_SPECS.length
      || successorStorageFiles.some((entry) => !successorOperationIds.has(entry.id))
      || successorStorageRollbackFiles.length !== SUCCESSOR_STORAGE_OPERATION_SPECS.length
      || successorStorageRollbackFiles.some(
        (entry) => !successorOperationIds.has(entry.forOperationId),
      )) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor Storage operation set must contain exactly freeze and final convergence",
    );
  }
}

function validateSuccessorControllerContract({
  repoRoot,
  manifest,
  predecessorManifest,
  releaseVersions,
  remoteBaseline,
}) {
  const releaseContractDir = join(repoRoot, "supabase", "release-contracts");
  const pin = manifest.controllerContract;
  if (!pin
      || typeof pin.file !== "string"
      || !pin.file.startsWith("supabase/release-contracts/")) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "controller-ready successor must pin one release controller contract",
    );
  }
  const { text } = readPinnedRegularFile(
    repoRoot,
    pin,
    "successor controller contract",
    releaseContractDir,
  );
  let contract;
  try {
    contract = JSON.parse(text);
  } catch {
    invalid("SUCCESSOR_CONTROLLER_CONTRACT_INVALID", "successor controller contract is not JSON");
  }
  validateRecoveryAssuranceControllerContract(
    contract?.recoveryAssuranceContract,
  );
  if (!exactKeys(contract, CONTROLLER_CONTRACT_KEYS)
      || contract.contractVersion !== 1
      || contract.release !== manifest.release
      || contract.projectRef !== manifest.projectRef
      || !Array.isArray(contract.preApplyChecks)
      || contract.preApplyChecks.length === 0
      || !Array.isArray(contract.postPushChecks)
      || !Array.isArray(contract.postApplyChecks)
      || contract.postApplyChecks.length === 0
      || !Array.isArray(contract.forwardOnlySecurityOperations)
      || !Array.isArray(contract.manualPlatformOperations)
      || contract.manualPlatformOperations.length === 0
      || !Array.isArray(contract.rollbackArtifacts)
      || contract.rollbackArtifacts.length === 0
      || !Array.isArray(contract.requiredDocuments)
      || contract.requiredDocuments.length === 0) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor controller contract is incomplete or has unexpected fields",
    );
  }
  const predecessorPostCheckIds = new Set(
    Array.isArray(predecessorManifest.postApplyChecks)
      ? predecessorManifest.postApplyChecks.map((check) => check?.id)
      : [],
  );
  const successorPostCheckIds = contract.postApplyChecks.map((check) => check?.id);
  const createdPublicTables = successorCreatedPublicTables(
    repoRoot,
    manifest.expandMigrations,
  );
  const semanticPostcheck = contract.postApplyChecks.find((check) =>
    check?.expectedEvidence?.successor_created_table_count
      === createdPublicTables.length
    && check.expectedEvidence.account_deletion_auth_fk_contract_count === 1
    && check.expectedEvidence.chat_server_only_ingest_boundary_count === 1
    && check.expectedEvidence.chat_partner_recipient_select_policy_count === 1
    && check.expectedEvidence.chat_partner_recipient_trigger_count === 1
    && check.expectedEvidence.conversation_segment_active_index_count === 3
    && check.expectedEvidence.conversation_segment_rls_policy_count === 1
    && check.expectedEvidence.conversation_segment_rpc_acl_count === 1
    && check.expectedEvidence.conversation_segment_scope_fk_count === 2
    && check.expectedEvidence.first_use_deterministic_application_rpc_acl_count === 1
    && check.expectedEvidence.first_use_deterministic_proposal_rpc_acl_count === 1
    && check.expectedEvidence.provider_backed_add_action_application_rpc_acl_count === 1
    && check.expectedEvidence.atomic_action_private_dispatcher_acl_count === 1
    && check.expectedEvidence.atomic_action_public_dispatcher_acl_count === 1
    && check.expectedEvidence.atomic_action_href_whitespace_parity_count === 1
    && check.expectedEvidence.booking_outcome_provenance_rpc_acl_count === 1
    && check.expectedEvidence.booking_outcome_provenance_v1_actor_time_contract_count === 1
    && check.expectedEvidence.neutral_preparation_space_rpc_acl_count === 2
    && check.expectedEvidence.neutral_preparation_space_member_model_contract_count === 1
    && check.expectedEvidence.preparation_catch_up_rpc_acl_count === 1
    && check.expectedEvidence.preparation_catch_up_private_actor_binding_contract_count === 1
    && check.expectedEvidence.preparation_notes_read_rpc_acl_count === 1
    && check.expectedEvidence.preparation_action_receipt_binding_read_rpc_acl_count === 1
    && check.expectedEvidence.mediation_private_draft_boundary_trigger_count === 1
    && check.expectedEvidence.topic_criterion_action_context_trigger_count === 1
    && check.expectedEvidence.shared_action_receipt_trigger_contract_count === 1
    && check.expectedEvidence.vendor_review_trigger_search_path_contract_count === 1
    && check.expectedEvidence.decision_node_updated_at_clock_trigger_contract_count === 1
    && check.expectedEvidence.signup_profile_trigger_contract_count === 1
    && check.expectedEvidence.couple_invite_nullable_contract_count === 1
    && check.expectedEvidence.couple_plan_change_auth_user_fk_count === 4
    && check.expectedEvidence.couple_plan_change_terminal_event_count === 3
    && check.expectedEvidence.couple_plan_change_journey_write_fence_count === 4
    && check.expectedEvidence.couple_plan_change_write_boundary_trigger_count === 1
    && check.expectedEvidence.couple_plan_change_display_guard_count === 1
    && check.expectedEvidence.couple_plan_change_idempotency_index_count === 1
    && check.expectedEvidence.wedding_court_auth_delete_fk_count === 1
    && check.expectedEvidence.chat_feedback_auth_delete_fk_count === 1
    && check.expectedEvidence.payment_ledger_fk_contract_count === 3
    && check.expectedEvidence.successor_migration_head_count === 1);
  if (successorPostCheckIds.some((id) => !/^[a-z][a-z0-9-]{2,63}$/.test(id ?? ""))
      || new Set(successorPostCheckIds).size !== successorPostCheckIds.length
      || successorPostCheckIds.every((id) => predecessorPostCheckIds.has(id))
      || !semanticPostcheck) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor must pin exact release tables, server-only chat ingestion plus partner-recipient selection/trigger, conversation-segment FK/index/RLS/RPC boundaries, deterministic first-use and provider-backed application service-role RPC ACLs, atomic-action dispatcher ACL/parity boundaries, booking-outcome provenance service-role ACL and v1 actor-time contract, preparation catch-up service-role RPC and private actor binding, preparation-action receipt binding-read service-role RPC ACL, mediation private-draft, topic-criterion action-context, shared-action receipt, vendor-review search-path, and conditional decision-node updated-at clock trigger contracts, signup profile trigger ownership/ACL, one-time invite nullable lifecycle, account-deletion, plan-change, wedding-court and chat-feedback Auth FKs, payment-ledger FKs, terminal events, journey write fences, display/idempotency guards, and migration head",
    );
  }

  const predecessorPostExpand = predecessorManifest.postExpandBackupContract;
  const predecessorBackup = predecessorManifest.backupContract;
  const predecessorBaselineTables = predecessorPostExpand?.expectedTables;
  const appliedBaselineTables = successorCreatedPublicTables(
    repoRoot,
    remoteBaseline.appliedMigrations,
  );
  const baselineTables = [...new Set([
    ...(predecessorBaselineTables ?? []),
    ...appliedBaselineTables,
  ])].sort();
  const backup = contract.backupContract;
  if (!exactKeys(backup, [
    "capture",
    "dependencies",
    "ephemeralRebuildContract",
    "excludedEphemeralTables",
    "expectedCommitBinding",
    "expectedMigrationHead",
    "expectedOrigin",
    "expectedTableContractSha256",
    "expectedTableCount",
    "expectedTables",
    "format",
    "id",
    "providerPhysicalBackup",
    "requiredReceiptValues",
    "supabaseCli",
    "verifier",
    "version",
  ])
      || backup.id !== `pre-${manifest.release}-current-remote-backup`
      || backup.id === "pre-amora-current-remote-14-table-baseline"
      || backup.version !== 2
      || backup.format !== "hbam2-encrypted-current-user"
      || backup.expectedMigrationHead !== remoteBaseline.observedRemoteHead
      || !SHA256.test(backup.expectedTableContractSha256 ?? "")
      || !safeExactTableList(
        backup.expectedTables,
        backup.expectedTableCount,
        backup.expectedTableContractSha256,
      )
      || !exactArray(backup.expectedTables, baselineTables ?? [])
      || backup.expectedTableContractSha256
        !== exactTextListSha256(baselineTables)
      || !exactArray(
        backup.excludedEphemeralTables,
        predecessorBackup?.excludedEphemeralTables ?? [],
      )
      || backup.ephemeralRebuildContract
        !== predecessorBackup?.ephemeralRebuildContract
      || backup.expectedCommitBinding !== "release-expected-commit"
      || backup.expectedOrigin !== predecessorBackup?.expectedOrigin
      || !exactKeys(backup.capture, ["file", "sha256"])
      || backup.capture.file !== "scripts/vendor-disclosure-db-current-baseline.ps1"
      || !SHA256.test(backup.capture.sha256 ?? "")
      || !Array.isArray(backup.dependencies)
      || backup.dependencies.length !== 2
      || !exactKeys(backup.dependencies[0], ["file", "sha256"])
      || backup.dependencies[0].file
        !== "scripts/vendor-disclosure-db-current-baseline-common.ps1"
      || !SHA256.test(backup.dependencies[0].sha256 ?? "")
      || !exactKeys(backup.dependencies[1], ["file", "sha256"])
      || backup.dependencies[1].file !== "scripts/amora-db-backup-common.ps1"
      || !SHA256.test(backup.dependencies[1].sha256 ?? "")
      || !exactKeys(backup.verifier, ["file", "sha256"])
      || backup.verifier.file
        !== "scripts/vendor-disclosure-db-current-baseline-verify.ps1"
      || !SHA256.test(backup.verifier.sha256 ?? "")
      || (remoteBaseline.appliedMigrations.length > 0
        && backup.verifier.file === predecessorPostExpand?.verifier?.file)
      || !exactKeys(backup.providerPhysicalBackup, [
        "maximumAgeHours",
        "requirePhysicalBackup",
        "requiredStatus",
        "restoreCapability",
      ])
      || backup.providerPhysicalBackup.maximumAgeHours
        !== predecessorBackup?.providerPhysicalBackup?.maximumAgeHours
      || backup.providerPhysicalBackup.requirePhysicalBackup
        !== predecessorBackup?.providerPhysicalBackup?.requirePhysicalBackup
      || backup.providerPhysicalBackup.requiredStatus
        !== predecessorBackup?.providerPhysicalBackup?.requiredStatus
      || backup.providerPhysicalBackup.restoreCapability
        !== predecessorBackup?.providerPhysicalBackup?.restoreCapability
      || !exactKeys(backup.supabaseCli, ["binarySha256", "version"])
      || backup.supabaseCli.binarySha256
        !== predecessorBackup?.supabaseCli?.binarySha256
      || backup.supabaseCli.version !== predecessorBackup?.supabaseCli?.version
      || !exactKeys(backup.requiredReceiptValues, [
        "PGliteJsonbRoundTripVerified",
        "PlaintextWrittenToDisk",
        "SourceCanonicalDigestsVerified",
        "Verified",
      ])
      || backup.requiredReceiptValues.Verified !== true
      || backup.requiredReceiptValues.SourceCanonicalDigestsVerified !== true
      || backup.requiredReceiptValues.PGliteJsonbRoundTripVerified !== true
      || backup.requiredReceiptValues.PlaintextWrittenToDisk !== false) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor pre-apply backup must match the exact current remote predecessor baseline",
    );
  }

  for (const [label, artifact] of [
    ["capture", backup.capture],
    ["direct dependency", backup.dependencies[0]],
    ["transitive dependency", backup.dependencies[1]],
    ["verifier", backup.verifier],
  ]) {
    readPinnedRegularFile(
      repoRoot,
      artifact,
      `successor pre-apply backup ${label}`,
      join(repoRoot, "scripts"),
    );
  }

  const postExpand = contract.postExpandBackupContract;
  const expectedHead = releaseVersions.at(-1);
  if (!postExpand
      || postExpand.id === "post-amora-engine-v2-27-table-backup"
      || postExpand.version !== 2
      || postExpand.expectedReleaseMigrationBaselineHead
        !== remoteBaseline.observedRemoteHead
      || postExpand.expectedReleaseMigrationHead !== expectedHead
      || !exactArray(postExpand.expectedReleaseMigrationVersions, releaseVersions)
      || postExpand.expectedReleaseMigrationContractSha256
        !== exactTextListSha256(releaseVersions)
      || !SHA256.test(postExpand.expectedTableContractSha256 ?? "")
      || !safeExactTableList(
        postExpand.expectedTables,
        postExpand.expectedTableCount,
        postExpand.expectedTableContractSha256,
      )
      || !baselineTables.every((table) => postExpand.expectedTables.includes(table))
      || !createdPublicTables.every(
        (table) => postExpand.expectedTables.includes(table),
      )
      || !exactKeys(postExpand.common, ["file", "sha256"])
      || postExpand.common.file !== "scripts/vendor-disclosure-db-backup-common.ps1"
      || !exactKeys(postExpand.capture, ["file", "sha256"])
      || postExpand.capture.file !== "scripts/vendor-disclosure-db-backup.ps1"
      || !exactKeys(postExpand.verifier, ["file", "sha256"])
      || postExpand.verifier.file !== "scripts/vendor-disclosure-db-verify-backup.ps1"
      || !SHA256.test(postExpand.common.sha256 ?? "")
      || !SHA256.test(postExpand.capture?.sha256 ?? "")
      || !SHA256.test(postExpand.verifier?.sha256 ?? "")) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor post-expand backup must pin the exact new tables, migration head and new capture/verifier",
    );
  }

  for (const [label, artifact] of Object.entries({
    common: postExpand.common,
    capture: postExpand.capture,
    verifier: postExpand.verifier,
  })) {
    readPinnedRegularFile(
      repoRoot,
      artifact,
      `successor post-expand backup ${label}`,
      join(repoRoot, "scripts"),
    );
  }

  if (contract.finalizationContract?.version !== 2
      || contract.finalizationContract?.id
        !== "production-write-fence-exact-owner-finalizer"
      || !exactKeys(contract.finalizationContract?.operation, ["id", "file", "sha256"])
      || contract.finalizationContract.operation.id
        !== "production-write-fence-successor-finalize-20260819122000"
      || contract.finalizationContract.operation.file
        !== "supabase/platform-operations/security/20260819122000_production_write_fence_successor_finalize.sql"
      || contract.finalizationContract?.requiredLeasePhase !== "deployment-canary"
      || contract.finalizationContract?.confirmationIncludesCanarySha256 !== true) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor finalizer must use the dynamic exact-owner v2 contract",
    );
  }
  readPinnedRegularFile(
    repoRoot,
    contract.finalizationContract.operation,
    "successor finalizer",
    join(repoRoot, "supabase", "platform-operations", "security"),
  );
  validateSuccessorDatabaseWriteFenceContract({ repoRoot, contract });
  validateSuccessorLiveSchemaSecurityContract({ repoRoot, contract });
  validateSuccessorStoragePlatformContracts({ repoRoot, manifest, contract });
  const exactControllerIds = [
    [
      contract.preApplyChecks,
      [
        SUCCESSOR_DATABASE_WRITE_FENCE_SPEC.check.id,
        SUCCESSOR_LIVE_SCHEMA_SECURITY_SPEC.check.id,
        "vendor-disclosure-successor-storage-frozen",
      ],
    ],
    [contract.postPushChecks, ["vendor-disclosure-successor-storage-target"]],
    [contract.postApplyChecks, ["vendor-disclosure-successor-postcheck"]],
    [
      contract.manualPlatformOperations,
      [
        SUCCESSOR_DATABASE_WRITE_FENCE_SPEC.operation.id,
        SUCCESSOR_LIVE_SCHEMA_SECURITY_SPEC.operation.id,
        "vendor-disclosure-successor-storage-write-freeze-v1",
        "vendor-disclosure-successor-storage-final-convergence-v1",
      ],
    ],
    [
      contract.rollbackArtifacts,
      [
        SUCCESSOR_DATABASE_WRITE_FENCE_SPEC.rollback.id,
        SUCCESSOR_LIVE_SCHEMA_SECURITY_SPEC.rollback.id,
        "successor-storage-freeze-forward-recovery-v1",
        "successor-storage-final-compensation-v1",
      ],
    ],
  ];
  if (exactControllerIds.some(([entries, expectedIds]) =>
    !exactArray(entries.map((entry) => entry?.id), expectedIds))
      || canonicalJsonSha256(contract.requiredDocuments)
        !== canonicalJsonSha256(predecessorManifest.requiredDocuments)) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor checks, operations, recoveries and required documents must be exact",
    );
  }
  validateRollbackContract(manifest, contract.rollbackContract);

  return {
    ...contract,
    predecessorManifest: manifest.predecessorManifest,
    requiredRemoteHead: remoteBaseline.observedRemoteHead,
    migrationFloor: manifest.migrationFloor,
    historicalReconciliation: [],
    remoteBaselineMigrations: remoteBaseline.appliedMigrations,
    expandMigrations: remoteBaseline.pendingMigrations,
    appliedHotfixes: [],
    status: manifest.status,
    deploymentEvidence: manifest.deploymentEvidence,
    controllerContract: manifest.controllerContract,
  };
}

function validatePinnedRemoteBaseline(repoRoot, manifest) {
  const pin = manifest.remoteBaselineContract;
  if (!exactKeys(pin, ["file", "sha256"])
      || typeof pin.file !== "string"
      || !pin.file.startsWith("supabase/release-contracts/")
      || basename(pin.file) !== "vendor-disclosure-production-baseline-v1-20260815.json"
      || !SHA256.test(pin.sha256 ?? "")) {
    invalid(
      "REMOTE_BASELINE_PIN_INVALID",
      "successor release must pin the exact Production remote baseline contract",
    );
  }
  const path = resolve(repoRoot, pin.file);
  const contractDirectory = join(repoRoot, "supabase", "release-contracts");
  const metadata = existsSync(path) ? lstatSync(path) : null;
  if (!inside(repoRoot, path)
      || dirname(path) !== contractDirectory
      || !metadata?.isFile()
      || metadata.isSymbolicLink()) {
    invalid("REMOTE_BASELINE_PIN_INVALID", "remote baseline contract file is unsafe or missing");
  }
  const text = readFileSync(path, "utf8");
  if (canonicalTextSha256(text) !== pin.sha256) {
    invalid("REMOTE_BASELINE_HASH_MISMATCH", "remote baseline contract hash drifted");
  }
  let contract;
  try {
    contract = JSON.parse(text);
  } catch {
    invalid("REMOTE_BASELINE_CONTRACT_INVALID", "remote baseline contract is not valid JSON");
  }
  try {
    return {
      pin,
      contract,
      ...validateSuccessorRemoteBaselineContract({ manifest, contract }),
    };
  } catch (error) {
    invalid(
      "REMOTE_BASELINE_CONTRACT_INVALID",
      error instanceof Error ? error.message : "remote baseline contract is invalid",
    );
  }
}

export function validateSuccessorReleaseContract({
  repoRoot,
  manifestRelativePath = SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
}) {
  const root = resolve(repoRoot);
  const manifestPath = resolve(root, manifestRelativePath);
  const releaseManifestDir = join(root, "supabase", "release-manifests");
  if (!inside(root, manifestPath) || dirname(manifestPath) !== releaseManifestDir) {
    invalid("MANIFEST_PATH_INVALID", "successor manifest path escapes the release manifest directory");
  }
  const metadata = existsSync(manifestPath) ? lstatSync(manifestPath) : null;
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    invalid("MANIFEST_FILE_INVALID", "successor manifest must be a non-symlink regular file");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    invalid("MANIFEST_INVALID", "successor manifest is not valid JSON");
  }
  // 허용 키는 상태에 따라 다르다 — 차단 상태에서 backupContract만 몰래 넣어 두는
  // 것을 막고, 고정 상태에서 그것이 빠지는 것도 막는다.
  const expectedKeys = manifest.status === READY_STATUS
    ? READY_TOP_LEVEL_KEYS
    : BLOCKED_TOP_LEVEL_KEYS;
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expectedKeys)) {
    invalid("MANIFEST_SHAPE_INVALID", "successor manifest has missing or unexpected top-level fields");
  }
  if (!SAFE_RELEASE_ID.test(manifest.release ?? "")
      || `${manifest.release}.json` !== basename(manifestPath)
      || !SAFE_PROJECT_REF.test(manifest.projectRef ?? "")) {
    invalid("MANIFEST_IDENTITY_INVALID", "successor manifest identity is invalid");
  }
  const deployment = validateDeploymentBlock(root, manifest);
  if (!/^\d{14}$/.test(manifest.migrationFloor ?? "")
      || !/^\d{14}$/.test(manifest.requiredRemoteHead ?? "")
      || manifest.requiredRemoteHead >= manifest.migrationFloor) {
    invalid("MIGRATION_BOUNDARY_INVALID", "successor migration floor or required remote head is invalid");
  }
  if (manifest.predecessorManifest?.file !== PREDECESSOR_MANIFEST_RELATIVE_PATH) {
    invalid("PREDECESSOR_PIN_INVALID", "successor must pin the amora-engine-v2 release manifest");
  }
  const predecessor = verifyPinnedManifestChain({
    repoRoot: root,
    pin: manifest.predecessorManifest,
    expectedProjectRef: manifest.projectRef,
    visited: new Set(),
    label: "predecessor release manifest",
  });
  const predecessorHead = [...predecessor.versions].sort().at(-1);
  if (predecessorHead !== manifest.requiredRemoteHead) {
    invalid(
      "REMOTE_HEAD_MISMATCH",
      `required remote head must equal predecessor head ${predecessorHead ?? "none"}`,
    );
  }
  if (!Array.isArray(manifest.expandMigrations) || manifest.expandMigrations.length === 0) {
    invalid("MIGRATION_SET_INVALID", "successor expandMigrations must be non-empty");
  }
  const expectedFiles = [];
  let previousVersion = "";
  for (const entry of manifest.expandMigrations) {
    const version = verifyMigration(root, entry, "successor");
    if (version < manifest.migrationFloor || version <= previousVersion) {
      invalid(
        "MIGRATION_ORDER_INVALID",
        "successor migrations must be strictly ordered from migrationFloor",
      );
    }
    previousVersion = version;
    expectedFiles.push(entry.file);
  }
  const actualFiles = readdirSync(join(root, "supabase", "migrations"))
    .filter((name) => MIGRATION_FILE.test(name))
    .filter((name) => name.slice(0, 14) >= manifest.migrationFloor)
    .sort();
  if (actualFiles.length !== expectedFiles.length
      || actualFiles.some((name, index) => name !== expectedFiles[index])) {
    invalid(
      "MIGRATION_SET_DRIFT",
      `successor migration set or order drifted; expected=${expectedFiles.join(",") || "none"}; received=${actualFiles.join(",") || "none"}`,
    );
  }
  const releaseVersions = expectedFiles.map((file) => file.slice(0, 14));
  const remoteBaseline = validatePinnedRemoteBaseline(root, manifest);
  const controllerManifest = deployment.released
    ? validateSuccessorControllerContract({
      repoRoot: root,
      manifest,
      predecessorManifest: predecessor.manifest,
      releaseVersions,
      remoteBaseline,
    })
    : null;
  return {
    manifest,
    migrationCount: expectedFiles.length,
    predecessorHead,
    // 컨트롤러는 이 값만 보고 진행 여부를 정한다. 상태 문자열을 각자 해석하면
    // 판정이 두 군데로 갈라진다.
    deploymentBlocked: !deployment.released,
    releaseCommit: deployment.releaseCommit,
    controllerReady: deployment.released,
    controllerManifest,
    remoteBaseline,
    pendingMigrations: remoteBaseline.pendingMigrations,
  };
}
