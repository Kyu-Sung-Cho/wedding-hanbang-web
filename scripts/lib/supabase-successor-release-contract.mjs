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
import { loadEffectiveBudgetDecisionHotfixRelease } from "./amora-budget-decision-effective-release-contract.mjs";
import { loadExplicitBudgetHotfixRelease } from "./amora-explicit-budget-release-contract.mjs";
import { loadProfileAvatarReleasePlan } from "./profile-avatar-release-contract.mjs";
import { loadCustomerDataReleasePlan } from "./account-deletion-customer-data-release-contract.mjs";
import { loadNotApplicableStatusReleasePlan } from "./amora-not-applicable-status-release-contract.mjs";
import { loadWeddingCodeResearchReleasePlan } from "./wedding-code-research-contributions-release-contract.mjs";
import { loadProfileWeddingRolesReleasePlan } from "./profile-wedding-roles-release-contract.mjs";
import { loadChatFeedbackNullabilityReleasePlan } from "./chat-feedback-nullability-release-contract.mjs";

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
  hostedRestore: Object.freeze({
    kind: "successor-release-hosted-restore-evidence-v1",
    maximumAgeMinutes: 1_440,
    rawEvidenceSource: "different-project-destructive-restore",
    requiredChecks: Object.freeze([
      "differentProjectVerified",
      "destructiveRestoreCompleted",
      "exactTableContractVerified",
      "logicalDataDigestsVerified",
      "authAndStorageRestoredVerified",
      "readOnlyPostchecksPassed",
    ]),
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
  if (!requirement
      || !exactKeys(contract, [
        "kind",
        "maximumAgeMinutes",
        "rawEvidenceFileName",
        "rawEvidenceSource",
        "receiptFileName",
        "requiredChecks",
      ])
      || contract.kind !== requirement.kind
      || contract.maximumAgeMinutes !== requirement.maximumAgeMinutes
      || contract.rawEvidenceSource !== requirement.rawEvidenceSource
      || !exactArray(contract.requiredChecks, requirement.requiredChecks)
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
      && observations.expectedMigrationHead === manifest.requiredRemoteHead
      && observations.expectedTableCount === backup?.expectedTableCount
      && observations.expectedTableContractSha256
        === backup?.expectedTableContractSha256
      && observations.providerPhysicalBackupStatus
        === backup?.providerPhysicalBackup?.requiredStatus
      && observations.restoreCandidateAvailable === true;
  }
  if (name === "hostedRestore") {
    return exactKeys(observations, [
      "backupContractId",
      "expectedTableContractSha256",
      "expectedTableCount",
      "sourceProjectRef",
      "targetIsolation",
      "targetProjectRef",
    ])
      && observations.backupContractId === backup?.id
      && observations.expectedTableCount === backup?.expectedTableCount
      && observations.expectedTableContractSha256
        === backup?.expectedTableContractSha256
      && observations.sourceProjectRef === manifest.projectRef
      && /^[a-z0-9]{20}$/.test(observations.targetProjectRef ?? "")
      && observations.targetProjectRef !== manifest.projectRef
      && observations.targetIsolation
        === backup?.hostedRestoreEvidence?.requiredTargetIsolation;
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
    return exactKeys(observations, [
      "requiredMutationPolicyCount",
      "signedUploadGraceMinutes",
      "signedUploadTokenTtlMinutes",
      "storageStabilityWindowMinutes",
      "writeFenceReceiptFileName",
    ])
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
 * Validate the five private, fresh evidence receipts required before a
 * successor controller can enter check/apply mode.
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
  const evidenceNames = Object.keys(SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS).sort();
  if (!exactKeys(manifest.deploymentEvidence, evidenceNames)) {
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
    result[name] = Object.freeze({
      receiptPath,
      receiptSha256: createHash("sha256").update(receiptBytes).digest("hex"),
      rawEvidencePath: rawPath,
      rawEvidenceSha256: rawSha256,
      verifiedAt: receipt.capturedAt,
      expiresAt: receipt.expiresAt,
    });
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
 *   deployment_blocked — 증거 5종이 전부 "missing"이어야 한다(오늘까지의 유일한 상태).
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
  if (JSON.stringify(keys) !== JSON.stringify(DEPLOYMENT_EVIDENCE_KEYS)) {
    invalid(
      "DEPLOYMENT_EVIDENCE_INVALID",
      "successor must list exactly the five hosted evidence classes",
    );
  }

  if (manifest.status === BLOCKED_STATUS) {
    if (keys.some((key) => evidence[key] !== "missing")) {
      invalid(
        "DEPLOYMENT_EVIDENCE_INVALID",
        "deployment-blocked successor must explicitly mark every hosted evidence class missing",
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

const REQUIRED_ROLLBACK_CONTROLS = Object.freeze({
  AMORA_AUXILIARY_MEMORY_ENABLED: "false",
  AMORA_CARE_OUTBOUND_ENABLED: "false",
  AMORA_COMMUNITY_AI_COMMENT_ENABLED: "false",
  AMORA_CONVERSATION_SEGMENT_READ_ENABLED: "false",
  AMORA_TODAY_ONE_ENABLED: "false",
  AMORA_OPENAI_ENABLED: "false",
  AMORA_PROACTIVE_CHAT_ENABLED: "false",
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

function validateSuccessorControllerContract({
  repoRoot,
  manifest,
  predecessorManifest,
  releaseVersions,
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
    && check.expectedEvidence.chat_partner_recipient_insert_policy_count === 1
    && check.expectedEvidence.chat_partner_recipient_select_policy_count === 1
    && check.expectedEvidence.chat_partner_recipient_trigger_count === 1
    && check.expectedEvidence.conversation_segment_active_index_count === 3
    && check.expectedEvidence.conversation_segment_rls_policy_count === 1
    && check.expectedEvidence.conversation_segment_rpc_acl_count === 1
    && check.expectedEvidence.conversation_segment_scope_fk_count === 2
    && check.expectedEvidence.couple_plan_change_auth_user_fk_count === 4
    && check.expectedEvidence.couple_plan_change_terminal_event_count === 3
    && check.expectedEvidence.couple_plan_change_journey_write_fence_count === 4
    && check.expectedEvidence.couple_plan_change_write_boundary_trigger_count === 1
    && check.expectedEvidence.couple_plan_change_display_guard_count === 1
    && check.expectedEvidence.couple_plan_change_idempotency_index_count === 1
    && check.expectedEvidence.successor_feature_flags_off_count
      === Object.keys(REQUIRED_ROLLBACK_CONTROLS).length
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
      "successor must pin exact release tables, partner-recipient delivery policies/trigger, conversation-segment FK/index/RLS/RPC boundaries, account-deletion, plan-change, wedding-court and chat-feedback Auth FKs, payment-ledger FKs, terminal events, journey write fences, display/idempotency guards, feature-off controls and migration head",
    );
  }

  const predecessorPostExpand = predecessorManifest.postExpandBackupContract;
  const predecessorBackup = predecessorManifest.backupContract;
  const baselineTables = predecessorPostExpand?.expectedTables;
  const backup = contract.backupContract;
  if (!exactKeys(backup, [
    "ephemeralRebuildContract",
    "excludedEphemeralTables",
    "expectedCommitBinding",
    "expectedMigrationHead",
    "expectedOrigin",
    "expectedTableContractSha256",
    "expectedTableCount",
    "expectedTables",
    "format",
    "hostedRestoreEvidence",
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
      || backup.expectedMigrationHead !== manifest.requiredRemoteHead
      || !SHA256.test(backup.expectedTableContractSha256 ?? "")
      || !safeExactTableList(
        backup.expectedTables,
        backup.expectedTableCount,
        backup.expectedTableContractSha256,
      )
      || !exactArray(backup.expectedTables, baselineTables ?? [])
      || backup.expectedTableContractSha256
        !== predecessorPostExpand?.expectedTableContractSha256
      || !exactArray(
        backup.excludedEphemeralTables,
        predecessorBackup?.excludedEphemeralTables ?? [],
      )
      || backup.ephemeralRebuildContract
        !== predecessorBackup?.ephemeralRebuildContract
      || backup.expectedCommitBinding !== "release-expected-commit"
      || backup.expectedOrigin !== predecessorBackup?.expectedOrigin
      || !exactKeys(backup.verifier, ["file", "sha256"])
      || backup.verifier.file !== predecessorPostExpand?.verifier?.file
      || backup.verifier.sha256 !== predecessorPostExpand?.verifier?.sha256
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
      || !exactKeys(backup.hostedRestoreEvidence, [
        "maximumAgeMinutes",
        "receiptFileName",
        "requiredChecks",
        "requiredTargetIsolation",
      ])
      || backup.hostedRestoreEvidence.receiptFileName
        !== `${manifest.release}-hosted-restore-evidence.json`
      || backup.hostedRestoreEvidence.maximumAgeMinutes
        !== predecessorBackup?.hostedRestoreEvidence?.maximumAgeMinutes
      || backup.hostedRestoreEvidence.requiredTargetIsolation
        !== predecessorBackup?.hostedRestoreEvidence?.requiredTargetIsolation
      || !exactArray(
        backup.hostedRestoreEvidence.requiredChecks,
        predecessorBackup?.hostedRestoreEvidence?.requiredChecks ?? [],
      )
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

  const postExpand = contract.postExpandBackupContract;
  const expectedHead = releaseVersions.at(-1);
  if (!postExpand
      || postExpand.id === "post-amora-engine-v2-27-table-backup"
      || postExpand.version !== 2
      || postExpand.expectedReleaseMigrationBaselineHead !== manifest.requiredRemoteHead
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
      || postExpand.capture?.file === "scripts/amora-db-backup.ps1"
      || postExpand.verifier?.file === "scripts/amora-db-verify-backup.ps1"
      || typeof postExpand.capture?.file !== "string"
      || typeof postExpand.verifier?.file !== "string"
      || !SHA256.test(postExpand.capture?.sha256 ?? "")
      || !SHA256.test(postExpand.verifier?.sha256 ?? "")) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor post-expand backup must pin the exact new tables, migration head and new capture/verifier",
    );
  }

  if (contract.finalizationContract?.version !== 2
      || contract.finalizationContract?.id
        !== "production-write-fence-exact-owner-finalizer"
      || contract.finalizationContract?.requiredLeasePhase !== "deployment-canary"
      || contract.finalizationContract?.confirmationIncludesCanarySha256 !== true) {
    invalid(
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
      "successor finalizer must use the dynamic exact-owner v2 contract",
    );
  }
  validateRollbackContract(manifest, contract.rollbackContract);

  return {
    ...contract,
    predecessorManifest: manifest.predecessorManifest,
    requiredRemoteHead: manifest.requiredRemoteHead,
    migrationFloor: manifest.migrationFloor,
    historicalReconciliation: [],
    expandMigrations: manifest.expandMigrations,
    appliedHotfixes: [],
    status: manifest.status,
    deploymentEvidence: manifest.deploymentEvidence,
    controllerContract: manifest.controllerContract,
  };
}

/** @param {{ repoRoot: string, manifestRelativePath?: string, followup?: string | null }} options */
export function validateSuccessorReleaseContract({
  repoRoot,
  manifestRelativePath = SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  followup = null,
}) {
  if (followup !== null && !["amora-budget-decision-hotfix", "amora-explicit-budget-hotfix", "chat-feedback-nullability", "profile-wedding-roles", "profile-avatar", "account-deletion-customer-data", "amora-not-applicable-status", "wedding-code-research-contributions"].includes(followup)) {
    invalid("FOLLOWUP_RELEASE_INVALID", "only explicitly registered followups are supported");
  }
  if (followup !== null && manifestRelativePath !== SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH) {
    invalid("FOLLOWUP_RELEASE_INVALID", "the budget-decision followup requires the original successor manifest");
  }
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
  // 구 manifest의 내용·선행 핀·순서는 그대로 검사한다. 후속 SQL은 호출자가
  // 이름 목록을 넘기는 대신 전용 loader의 전체 디렉터리·원문 검증을 통과해야 한다.
  const expectedDirectoryFiles = [...expectedFiles];
  if (followup === "amora-budget-decision-hotfix") {
    let budgetRelease;
    try {
      budgetRelease = loadEffectiveBudgetDecisionHotfixRelease(root);
    } catch {
      invalid("FOLLOWUP_RELEASE_INVALID", "the pinned budget-decision static contract could not be verified");
    }
    if (budgetRelease.hotfix.projectRef !== manifest.projectRef
        || budgetRelease.migrations.length !== 1
        || budgetRelease.migrations[0].version <= previousVersion
        || expectedFiles.includes(budgetRelease.migrations[0].file)) {
      invalid("FOLLOWUP_RELEASE_INVALID", "the budget-decision migration must follow the original successor exactly once");
    }
    expectedDirectoryFiles.push(budgetRelease.migrations[0].file);
  }
  if (followup === "amora-explicit-budget-hotfix") {
    let explicitRelease;
    try {
      explicitRelease = loadExplicitBudgetHotfixRelease(root);
    } catch {
      invalid("FOLLOWUP_RELEASE_INVALID", "the pinned explicit-budget static contract could not be verified");
    }
    const followups = explicitRelease.followupMigrations;
    if (explicitRelease.hotfix.projectRef !== manifest.projectRef
        || explicitRelease.migrations.length !== 1
        || !Array.isArray(followups) || followups.length !== 2
        || followups[1].file !== explicitRelease.migrations[0].file) {
      invalid("FOLLOWUP_RELEASE_INVALID", "the explicit-budget followup must preserve the registered predecessor and add exactly one migration");
    }
    let previousFollowupVersion = previousVersion;
    for (const migration of followups) {
      if (migration.version <= previousFollowupVersion
          || expectedDirectoryFiles.includes(migration.file)) {
        invalid("FOLLOWUP_RELEASE_INVALID", "budget followups must follow the original successor in exact order");
      }
      previousFollowupVersion = migration.version;
      expectedDirectoryFiles.push(migration.file);
    }
  }
  if (followup === "chat-feedback-nullability") {
    let feedbackRelease;
    try {
      feedbackRelease = loadChatFeedbackNullabilityReleasePlan(root);
    } catch {
      invalid("FOLLOWUP_RELEASE_INVALID", "the pinned feedback-nullability static contract could not be verified");
    }
    const followups = feedbackRelease.followupMigrations;
    if (feedbackRelease.contract.projectRef !== manifest.projectRef
        || feedbackRelease.migrationCount !== 229
        || feedbackRelease.contract.migrations.length !== 1
        || followups.length !== 3
        || followups[2].file !== feedbackRelease.contract.migrations[0].file) {
      invalid("FOLLOWUP_RELEASE_INVALID", "the feedback followup must preserve both reviewed budget migrations and add exactly one migration");
    }
    let previousFollowupVersion = previousVersion;
    for (const migration of followups) {
      if (migration.version <= previousFollowupVersion || expectedDirectoryFiles.includes(migration.file)) {
        invalid("FOLLOWUP_RELEASE_INVALID", "feedback followups must follow the original successor in exact order");
      }
      previousFollowupVersion = migration.version;
      expectedDirectoryFiles.push(migration.file);
    }
  }
  if (followup === "wedding-code-research-contributions") {
    let research;
    try { research = loadWeddingCodeResearchReleasePlan(root); }
    catch { invalid("FOLLOWUP_RELEASE_INVALID", "the exact WeddingCode research contributions successor could not be verified"); }
    const followups = research.followupMigrations;
    if (research.contract.projectRef !== manifest.projectRef || research.migrationCount !== 234
        || followups.length !== 8 || followups[7].file !== research.contract.migrations[0].file)
      invalid("FOLLOWUP_RELEASE_INVALID", "WeddingCode research successor must preserve all seven predecessors and add one migration");
    let previousFollowupVersion = previousVersion;
    for (const migration of followups) {
      if (migration.version <= previousFollowupVersion || expectedDirectoryFiles.includes(migration.file))
        invalid("FOLLOWUP_RELEASE_INVALID", "WeddingCode research successor migration order changed");
      previousFollowupVersion = migration.version;
      expectedDirectoryFiles.push(migration.file);
    }
  }
  if (followup === "amora-not-applicable-status") {
    let notApplicable;
    try { notApplicable = loadNotApplicableStatusReleasePlan(root); }
    catch { invalid("FOLLOWUP_RELEASE_INVALID", "the exact not-applicable status successor could not be verified"); }
    const followups = notApplicable.followupMigrations;
    if (notApplicable.contract.projectRef !== manifest.projectRef || notApplicable.migrationCount !== 233
        || followups.length !== 7 || followups[6].file !== notApplicable.contract.migrations[0].file)
      invalid("FOLLOWUP_RELEASE_INVALID", "not-applicable status successor must preserve all six predecessors and add one migration");
    let previousFollowupVersion = previousVersion;
    for (const migration of followups) {
      if (migration.version <= previousFollowupVersion || expectedDirectoryFiles.includes(migration.file))
        invalid("FOLLOWUP_RELEASE_INVALID", "not-applicable status successor migration order changed");
      previousFollowupVersion = migration.version;
      expectedDirectoryFiles.push(migration.file);
    }
  }
  if (followup === "account-deletion-customer-data") {
    let customerData;
    try { customerData = loadCustomerDataReleasePlan(root); }
    catch { invalid("FOLLOWUP_RELEASE_INVALID", "the exact customer-data successor could not be verified"); }
    const followups = customerData.followupMigrations;
    if (customerData.contract.projectRef !== manifest.projectRef || customerData.migrationCount !== 232
        || followups.length !== 6 || followups[5].file !== customerData.contract.migrations[0].file)
      invalid("FOLLOWUP_RELEASE_INVALID", "customer-data successor must preserve all five predecessors and add one migration");
    let previousFollowupVersion = previousVersion;
    for (const migration of followups) {
      if (migration.version <= previousFollowupVersion || expectedDirectoryFiles.includes(migration.file))
        invalid("FOLLOWUP_RELEASE_INVALID", "customer-data successor migration order changed");
      previousFollowupVersion = migration.version;
      expectedDirectoryFiles.push(migration.file);
    }
  }
  if (followup === "profile-avatar") {
    let avatar;
    try { avatar = loadProfileAvatarReleasePlan(root); }
    catch { invalid("FOLLOWUP_RELEASE_INVALID", "the exact avatar successor could not be verified"); }
    const followups = avatar.followupMigrations;
    if (avatar.contract.projectRef !== manifest.projectRef || avatar.migrationCount !== 231
        || followups.length !== 5 || followups[4].file !== avatar.contract.migrations[0].file)
      invalid("FOLLOWUP_RELEASE_INVALID", "avatar successor must preserve all four predecessors and add one migration");
    let previousFollowupVersion = previousVersion;
    for (const migration of followups) {
      if (migration.version <= previousFollowupVersion || expectedDirectoryFiles.includes(migration.file))
        invalid("FOLLOWUP_RELEASE_INVALID", "avatar successor migration order changed");
      previousFollowupVersion = migration.version;
      expectedDirectoryFiles.push(migration.file);
    }
  }
  if (followup === "profile-wedding-roles") {
    let roles;
    try { roles = loadProfileWeddingRolesReleasePlan(root); }
    catch { invalid("FOLLOWUP_RELEASE_INVALID", "the exact role successor could not be verified"); }
    const followups = roles.followupMigrations;
    if (roles.contract.projectRef !== manifest.projectRef || roles.migrationCount !== 230
        || followups.length !== 4 || followups[3].file !== roles.contract.migrations[0].file)
      invalid("FOLLOWUP_RELEASE_INVALID", "role successor must preserve all three predecessors and add one migration");
    let previousFollowupVersion = previousVersion;
    for (const migration of followups) {
      if (migration.version <= previousFollowupVersion || expectedDirectoryFiles.includes(migration.file))
        invalid("FOLLOWUP_RELEASE_INVALID", "role successor migration order changed");
      previousFollowupVersion = migration.version;
      expectedDirectoryFiles.push(migration.file);
    }
  }
  const actualFiles = readdirSync(join(root, "supabase", "migrations"))
    .filter((name) => MIGRATION_FILE.test(name))
    .filter((name) => name.slice(0, 14) >= manifest.migrationFloor)
    .sort();
  if (actualFiles.length !== expectedDirectoryFiles.length
      || actualFiles.some((name, index) => name !== expectedDirectoryFiles[index])) {
    invalid(
      "MIGRATION_SET_DRIFT",
      `successor migration set or order drifted; expected=${expectedDirectoryFiles.join(",") || "none"}; received=${actualFiles.join(",") || "none"}`,
    );
  }
  const releaseVersions = expectedFiles.map((file) => file.slice(0, 14));
  const controllerManifest = deployment.released
    ? validateSuccessorControllerContract({
      repoRoot: root,
      manifest,
      predecessorManifest: predecessor.manifest,
      releaseVersions,
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
  };
}
