import { createHash } from "node:crypto";
import { lstat, open, realpath, rm } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  renderProductionWriteFenceFinalizerSql,
} from "./production-write-fence-finalizer.mjs";
import {
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
} from "./supabase-successor-release-contract.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MIGRATION = /^\d{14}$/;
const RELEASE = /^[a-z0-9][a-z0-9-]{2,80}$/;
const OWNER_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DATABASE_SYSTEM_IDENTIFIER = /^\d{10,32}$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{16,64}$/;
const SAFE_OPERATION_FILE =
  /^supabase\/platform-operations\/security\/[0-9]{14}_[a-z0-9_.-]+\.sql$/;
const POSTCHECK_ID = /^[a-z][a-z0-9-]{2,63}$/;
const MAX_RAW_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const RENDER_ONLY_LIMITATIONS = Object.freeze([
  "render-only rehearsal; PostgreSQL finalizer SQL was not executed",
  "no Production mutation or Production finalization was attempted",
  "this proves contract rendering only, not a successful Production finalization",
]);
const RENDER_EVIDENCE_KEYS = Object.freeze([
  "canaryExpiresAt",
  "canaryReceiptSha256",
  "canaryVerifiedAt",
  "databaseSystemIdentifier",
  "deploymentId",
  "deploymentReceiptSha256",
  "deploymentUrlSha256",
  "leaseOwnerId",
  "outcomePathSha256",
  "outcomeReceiptSha256",
  "postExpandBackupManifestSha256",
  "postExpandBackupReceiptSha256",
  "postExpandBackupReverificationSha256",
  "postExpandBackupSetId",
  "recoveryAssuranceReceiptSha256",
  "postExpandLiveSchemaContractSha256",
  "postExpandLogicalDataContractSha256",
  "postExpandMigrationContractSha256",
  "postExpandTableContractSha256",
  "projectRef",
  "release",
  "releaseCommit",
]);

export class SuccessorFinalizerEvidenceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SuccessorFinalizerEvidenceError";
    this.code = code;
  }
}

function blocked(code, message = code) {
  throw new SuccessorFinalizerEvidenceError(code, message);
}

function exactKeys(value, keys) {
  return value !== null
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

function exactRecord(value, expected) {
  return exactKeys(value, Object.keys(expected))
    && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function canonicalJsonSha256(value) {
  return sha256(`${canonicalJson(value)}\n`);
}

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

function canonicalInstant(value, code) {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    blocked(code);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
      || new Date(milliseconds).toISOString() !== value) {
    blocked(code);
  }
  return milliseconds;
}

function validateRequirement(manifest) {
  const expected = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.finalizer;
  const value = manifest?.deploymentEvidence?.finalizer;
  if (!exactKeys(value, [
    "kind",
    "maximumAgeMinutes",
    "rawEvidenceFileName",
    "rawEvidenceSource",
    "receiptFileName",
    "requiredChecks",
  ])
      || value.kind !== expected.kind
      || value.maximumAgeMinutes !== expected.maximumAgeMinutes
      || value.rawEvidenceSource !== expected.rawEvidenceSource
      || !exactArray(value.requiredChecks, expected.requiredChecks)
      || !/^[a-z0-9][a-z0-9_.-]{2,160}\.json$/.test(value.rawEvidenceFileName ?? "")
      || !/^[a-z0-9][a-z0-9_.-]{2,160}\.json$/.test(value.receiptFileName ?? "")
      || value.rawEvidenceFileName === value.receiptFileName
      || !value.rawEvidenceFileName.startsWith(`${manifest.release}-`)
      || !value.receiptFileName.startsWith(`${manifest.release}-`)) {
    blocked("FINALIZER_EVIDENCE_CONTRACT_INVALID");
  }
  return value;
}

function validateReleaseContracts(manifest, controllerManifest) {
  if (!manifest || !controllerManifest
      || manifest.status !== "controller_ready"
      || manifest.release !== controllerManifest.release
      || manifest.projectRef !== controllerManifest.projectRef
      || !RELEASE.test(manifest.release ?? "")
      || !PROJECT_REF.test(manifest.projectRef ?? "")
      || !MIGRATION.test(manifest.requiredRemoteHead ?? "")
      || !Array.isArray(manifest.expandMigrations)
      || manifest.expandMigrations.length < 1) {
    blocked("FINALIZER_RELEASE_CONTRACT_INVALID");
  }
  const versions = manifest.expandMigrations.map((entry) => {
    const match = typeof entry?.file === "string"
      ? entry.file.match(/^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/)
      : null;
    return match?.[1] ?? null;
  });
  if (versions.some((version) => !MIGRATION.test(version ?? ""))
      || new Set(versions).size !== versions.length
      || versions.some((version, index) => index > 0 && version <= versions[index - 1])) {
    blocked("FINALIZER_RELEASE_CONTRACT_INVALID");
  }
  const postApplyCheckIds = Array.isArray(controllerManifest.postApplyChecks)
    ? controllerManifest.postApplyChecks.map((entry) => entry?.id)
    : [];
  if (postApplyCheckIds.length < 1
      || postApplyCheckIds.some((id) => !POSTCHECK_ID.test(id ?? ""))
      || new Set(postApplyCheckIds).size !== postApplyCheckIds.length) {
    blocked("FINALIZER_RELEASE_CONTRACT_INVALID");
  }
  const finalization = controllerManifest.finalizationContract;
  const operation = finalization?.operation;
  if (!finalization
      || finalization.id !== "production-write-fence-exact-owner-finalizer"
      || finalization.version !== 2
      || finalization.requiredLeasePhase !== "deployment-canary"
      || finalization.canaryMaximumAgeMinutes !== 15
      || finalization.deploymentMaximumAgeMinutes !== 1_440
      || finalization.confirmationIncludesCanarySha256 !== true
      || !Array.isArray(finalization.requiredCanaryChecks)
      || finalization.requiredCanaryChecks.length < 1
      || finalization.requiredCanaryChecks.some(
        (name) => !/^[a-z][A-Za-z0-9]{2,63}$/.test(name ?? ""),
      )
      || new Set(finalization.requiredCanaryChecks).size
        !== finalization.requiredCanaryChecks.length
      || !exactKeys(operation, ["file", "id", "sha256"])
      || operation.id !== "production-write-fence-successor-finalize-20260819122000"
      || operation.file
        !== "supabase/platform-operations/security/20260819122000_production_write_fence_successor_finalize.sql"
      || !SAFE_OPERATION_FILE.test(operation.file ?? "")
      || !SHA256.test(operation.sha256 ?? "")) {
    blocked("FINALIZER_CONTRACT_INVALID");
  }
  const rollback = controllerManifest.rollbackContract;
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
      || !Array.isArray(rollback.requiredChecks)
      || rollback.requiredChecks.length < 1
      || new Set(rollback.requiredChecks).size !== rollback.requiredChecks.length
      || !rollback.requiredControls
      || typeof rollback.requiredControls !== "object"
      || Array.isArray(rollback.requiredControls)
      || Object.keys(rollback.requiredControls).length < 1) {
    blocked("FINALIZER_ROLLBACK_CONTRACT_INVALID");
  }
  const postExpand = controllerManifest.postExpandBackupContract;
  if (postExpand?.version !== 2
      || !SHA256.test(postExpand.expectedTableContractSha256 ?? "")
      || postExpand.expectedReleaseMigrationContractSha256
        !== textListSha256(versions)) {
    blocked("FINALIZER_POST_EXPAND_CONTRACT_INVALID");
  }
  return {
    requirement: validateRequirement(manifest),
    versions,
    postApplyCheckIds,
    postApplyChecksSha256: textListSha256(postApplyCheckIds),
    migrationVersionsSha256: textListSha256(versions),
    finalization,
    operation,
    rollback,
    rollbackContractSha256: canonicalJsonSha256(rollback),
    postExpand,
  };
}

function validateDigestSet(inputDigests, names) {
  if (!exactKeys(inputDigests, names)
      || names.some((name) => !SHA256.test(inputDigests[name] ?? ""))) {
    blocked("FINALIZER_INPUT_PROVENANCE_INVALID");
  }
}

function validateOwnerLease(value, manifest, expectedCommit, contract, nowMs) {
  if (!exactKeys(value, [
    "containsSecrets",
    "databaseSystemIdentifier",
    "environment",
    "kind",
    "leaseCount",
    "leaseOwnerId",
    "leasePhase",
    "observedAt",
    "productionMutationAttempted",
    "projectRef",
    "receiptVersion",
    "release",
    "releaseCommit",
    "source",
    "transactionReadOnly",
  ])
      || value.receiptVersion !== 1
      || value.kind !== "successor-exact-owner-lease-rehearsal-v1"
      || value.release !== manifest.release
      || value.projectRef !== manifest.projectRef
      || value.releaseCommit !== expectedCommit
      || !DATABASE_SYSTEM_IDENTIFIER.test(value.databaseSystemIdentifier ?? "")
      || !OWNER_UUID.test(value.leaseOwnerId ?? "")
      || value.leasePhase !== contract.finalization.requiredLeasePhase
      || value.leaseCount !== 1
      || value.environment !== "isolated-non-production-rehearsal"
      || value.source !== "read-only-postgres-observation"
      || value.transactionReadOnly !== true
      || value.productionMutationAttempted !== false
      || value.containsSecrets !== false) {
    blocked("FINALIZER_OWNER_LEASE_INVALID");
  }
  const observedAt = canonicalInstant(value.observedAt, "FINALIZER_OWNER_LEASE_INVALID");
  if (observedAt > nowMs + 60_000 || nowMs - observedAt >= 24 * 60 * 60_000) {
    blocked("FINALIZER_OWNER_LEASE_INVALID");
  }
  return true;
}

function validateCanary(value, manifest, expectedCommit, contract, nowMs) {
  if (!exactKeys(value, [
    "checks",
    "containsSecrets",
    "deploymentId",
    "environment",
    "expiresAt",
    "kind",
    "observationWindowSeconds",
    "productionMutationAttempted",
    "projectRef",
    "receiptVersion",
    "release",
    "releaseCommit",
    "source",
    "verifiedAt",
  ])
      || value.receiptVersion !== 1
      || value.kind !== "successor-write-fenced-canary-rehearsal-v1"
      || value.release !== manifest.release
      || value.projectRef !== manifest.projectRef
      || value.releaseCommit !== expectedCommit
      || !DEPLOYMENT_ID.test(value.deploymentId ?? "")
      || value.environment !== "isolated-non-production-rehearsal"
      || value.source !== "bounded-canary-rehearsal"
      || value.observationWindowSeconds !== 300
      || !exactKeys(value.checks, contract.finalization.requiredCanaryChecks)
      || contract.finalization.requiredCanaryChecks.some(
        (name) => value.checks[name] !== true,
      )
      || value.productionMutationAttempted !== false
      || value.containsSecrets !== false) {
    blocked("FINALIZER_CANARY_INVALID");
  }
  const verifiedAt = canonicalInstant(value.verifiedAt, "FINALIZER_CANARY_INVALID");
  const expiresAt = canonicalInstant(value.expiresAt, "FINALIZER_CANARY_INVALID");
  if (expiresAt - verifiedAt
        !== contract.finalization.canaryMaximumAgeMinutes * 60_000
      || verifiedAt > nowMs + 60_000
      || expiresAt <= nowMs) {
    blocked("FINALIZER_CANARY_INVALID");
  }
  return true;
}

function validateFeatureOff(value, manifest, expectedCommit, contract, nowMs) {
  const rollback = contract.rollback;
  if (!exactKeys(value, [
    "checks",
    "containsSecrets",
    "environment",
    "kind",
    "migrationRollback",
    "observedControls",
    "productionMutationAttempted",
    "projectRef",
    "receiptFileName",
    "receiptMaximumAgeMinutes",
    "receiptVersion",
    "release",
    "releaseCommit",
    "requiredControls",
    "source",
    "strategy",
    "verifiedAt",
  ])
      || value.receiptVersion !== 1
      || value.kind !== "successor-feature-off-rollback-rehearsal-v1"
      || value.release !== manifest.release
      || value.projectRef !== manifest.projectRef
      || value.releaseCommit !== expectedCommit
      || value.receiptFileName !== rollback.featureOffReceiptFileName
      || value.strategy !== rollback.strategy
      || value.migrationRollback !== rollback.migrationRollback
      || value.receiptMaximumAgeMinutes !== rollback.maximumAgeMinutes
      || !exactRecord(value.requiredControls, rollback.requiredControls)
      || !exactRecord(value.observedControls, rollback.requiredControls)
      || !exactKeys(value.checks, rollback.requiredChecks)
      || rollback.requiredChecks.some((name) => value.checks[name] !== true)
      || value.environment !== "isolated-non-production-rehearsal"
      || value.source !== "feature-off-rollback-rehearsal"
      || value.productionMutationAttempted !== false
      || value.containsSecrets !== false) {
    blocked("FINALIZER_FEATURE_OFF_INVALID");
  }
  const verifiedAt = canonicalInstant(value.verifiedAt, "FINALIZER_FEATURE_OFF_INVALID");
  if (verifiedAt > nowMs + 60_000 || nowMs - verifiedAt >= 24 * 60 * 60_000) {
    blocked("FINALIZER_FEATURE_OFF_INVALID");
  }
  return true;
}

function validateTemplateContract(
  value,
  manifest,
  expectedCommit,
  contract,
  owner,
  canary,
  inputDigests,
  templateText,
  nowMs,
) {
  if (!exactKeys(value, [
    "containsSecrets",
    "finalizationContractVersion",
    "kind",
    "operationFile",
    "operationId",
    "operationSha256",
    "productionMutationAttempted",
    "projectRef",
    "receiptVersion",
    "release",
    "releaseCommit",
    "renderEvidence",
    "successorMigrationContractSha256",
    "successorTableContractSha256",
    "verifiedAt",
  ])
      || value.receiptVersion !== 1
      || value.kind !== "successor-finalizer-template-contract-rehearsal-v1"
      || value.release !== manifest.release
      || value.projectRef !== manifest.projectRef
      || value.releaseCommit !== expectedCommit
      || value.finalizationContractVersion !== contract.finalization.version
      || value.operationId !== contract.operation.id
      || value.operationFile !== contract.operation.file
      || value.operationSha256 !== contract.operation.sha256
      || value.operationSha256
        !== sha256(templateText.replace(/\r\n?/g, "\n"))
      || value.successorTableContractSha256
        !== contract.postExpand.expectedTableContractSha256
      || value.successorMigrationContractSha256
        !== contract.postExpand.expectedReleaseMigrationContractSha256
      || value.productionMutationAttempted !== false
      || value.containsSecrets !== false) {
    blocked("FINALIZER_TEMPLATE_CONTRACT_INVALID");
  }
  const verifiedAt = canonicalInstant(
    value.verifiedAt,
    "FINALIZER_TEMPLATE_CONTRACT_INVALID",
  );
  if (verifiedAt > nowMs + 60_000 || nowMs - verifiedAt >= 24 * 60 * 60_000) {
    blocked("FINALIZER_TEMPLATE_CONTRACT_INVALID");
  }
  const render = value.renderEvidence;
  if (!exactKeys(render, RENDER_EVIDENCE_KEYS)
      || render.projectRef !== manifest.projectRef
      || render.release !== manifest.release
      || render.releaseCommit !== expectedCommit
      || render.databaseSystemIdentifier !== owner.databaseSystemIdentifier
      || render.leaseOwnerId !== owner.leaseOwnerId
      || render.deploymentId !== canary.deploymentId
      || render.canaryReceiptSha256 !== inputDigests.canaryFenceReceiptSha256
      || render.canaryVerifiedAt !== canary.verifiedAt
      || render.canaryExpiresAt !== canary.expiresAt
      || render.postExpandTableContractSha256
        !== contract.postExpand.expectedTableContractSha256
      || render.postExpandMigrationContractSha256
        !== contract.postExpand.expectedReleaseMigrationContractSha256) {
    blocked("FINALIZER_TEMPLATE_CONTRACT_INVALID");
  }
  return true;
}

function validateGitState(value, expectedCommit) {
  if (!COMMIT.test(expectedCommit ?? "")
      || !exactKeys(value, [
        "actualCommit",
        "expectedCommit",
        "remoteCommit",
        "remoteRef",
        "upstreamCommit",
        "worktreeClean",
      ])
      || value.expectedCommit !== expectedCommit
      || value.actualCommit !== expectedCommit
      || value.upstreamCommit !== expectedCommit
      || value.remoteCommit !== expectedCommit
      || value.worktreeClean !== true
      || !/^origin\/[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?$/.test(
        value.remoteRef ?? "",
      )
      || value.remoteRef.includes("..")
      || value.remoteRef.includes("//")) {
    blocked("FINALIZER_RELEASE_COMMIT_NOT_PUSHED");
  }
  return true;
}

export function buildSuccessorFinalizerRenderOnlyRehearsal({
  manifest,
  controllerManifest,
  expectedCommit,
  templateText,
  ownerLeaseReceipt,
  templateContractReceipt,
  canaryFenceReceipt,
  featureOffReceipt,
  inputDigests,
  now = () => new Date(),
}) {
  const contract = validateReleaseContracts(manifest, controllerManifest);
  if (!COMMIT.test(expectedCommit ?? "")
      || typeof templateText !== "string"
      || Buffer.byteLength(templateText, "utf8") < 2
      || Buffer.byteLength(templateText, "utf8") > 64 * 1024) {
    blocked("FINALIZER_REHEARSAL_INPUT_INVALID");
  }
  validateDigestSet(inputDigests, [
    "canaryFenceReceiptSha256",
    "featureOffReceiptSha256",
    "ownerLeaseReceiptSha256",
    "templateContractReceiptSha256",
  ]);
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) blocked("FINALIZER_CLOCK_INVALID");
  validateOwnerLease(ownerLeaseReceipt, manifest, expectedCommit, contract, nowMs);
  validateCanary(canaryFenceReceipt, manifest, expectedCommit, contract, nowMs);
  validateFeatureOff(featureOffReceipt, manifest, expectedCommit, contract, nowMs);
  validateTemplateContract(
    templateContractReceipt,
    manifest,
    expectedCommit,
    contract,
    ownerLeaseReceipt,
    canaryFenceReceipt,
    inputDigests,
    templateText,
    nowMs,
  );
  let rendered;
  try {
    rendered = renderProductionWriteFenceFinalizerSql(
      templateText,
      templateContractReceipt.renderEvidence,
      contract.postExpand,
    );
  } catch {
    blocked("FINALIZER_TEMPLATE_RENDER_FAILED");
  }
  const renderedSqlBytes = Buffer.byteLength(rendered, "utf8");
  if (renderedSqlBytes < 2
      || renderedSqlBytes > 28 * 1024
      || /__HB_FINALIZER_[A-Z0-9_]+__/.test(rendered)) {
    blocked("FINALIZER_TEMPLATE_RENDER_FAILED");
  }
  return Object.freeze({
    receiptVersion: 1,
    kind: "successor-finalizer-render-only-rehearsal-v1",
    mode: "render-only-no-database-execution",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    finalizationContractVersion: contract.finalization.version,
    operationId: contract.operation.id,
    operationSha256: contract.operation.sha256,
    leaseOwnerId: ownerLeaseReceipt.leaseOwnerId,
    canaryReceiptSha256: inputDigests.canaryFenceReceiptSha256,
    featureOffReceiptSha256: inputDigests.featureOffReceiptSha256,
    templateContractReceiptSha256:
      inputDigests.templateContractReceiptSha256,
    successorTableContractSha256:
      contract.postExpand.expectedTableContractSha256,
    successorMigrationContractSha256:
      contract.postExpand.expectedReleaseMigrationContractSha256,
    renderedSqlSha256: sha256(rendered),
    renderedSqlBytes,
    unresolvedTemplateTokenCount: 0,
    databaseExecutionAttempted: false,
    productionMutationAttempted: false,
    completedAt: nowValue.toISOString(),
    limitations: [...RENDER_ONLY_LIMITATIONS],
    containsSecrets: false,
  });
}

function validateDryRehearsal({
  value,
  manifest,
  controllerManifest,
  expectedCommit,
  templateText,
  ownerLeaseReceipt,
  templateContractReceipt,
  canaryFenceReceipt,
  featureOffReceipt,
  inputDigests,
  nowMs,
}) {
  if (!exactKeys(value, [
    "canaryReceiptSha256",
    "completedAt",
    "containsSecrets",
    "databaseExecutionAttempted",
    "featureOffReceiptSha256",
    "finalizationContractVersion",
    "kind",
    "leaseOwnerId",
    "limitations",
    "mode",
    "operationId",
    "operationSha256",
    "productionMutationAttempted",
    "projectRef",
    "receiptVersion",
    "release",
    "releaseCommit",
    "renderedSqlBytes",
    "renderedSqlSha256",
    "successorMigrationContractSha256",
    "successorTableContractSha256",
    "templateContractReceiptSha256",
    "unresolvedTemplateTokenCount",
  ])
      || value.receiptVersion !== 1
      || value.kind !== "successor-finalizer-render-only-rehearsal-v1"
      || value.mode !== "render-only-no-database-execution"
      || value.release !== manifest.release
      || value.projectRef !== manifest.projectRef
      || value.releaseCommit !== expectedCommit
      || value.databaseExecutionAttempted !== false
      || value.productionMutationAttempted !== false
      || value.containsSecrets !== false
      || !exactArray(value.limitations, RENDER_ONLY_LIMITATIONS)) {
    blocked("FINALIZER_DRY_REHEARSAL_INVALID");
  }
  const completedAtMs = canonicalInstant(
    value.completedAt,
    "FINALIZER_DRY_REHEARSAL_INVALID",
  );
  if (completedAtMs > nowMs + 60_000
      || nowMs - completedAtMs >= 24 * 60 * 60_000) {
    blocked("FINALIZER_DRY_REHEARSAL_INVALID");
  }
  const expected = buildSuccessorFinalizerRenderOnlyRehearsal({
    manifest,
    controllerManifest,
    expectedCommit,
    templateText,
    ownerLeaseReceipt,
    templateContractReceipt,
    canaryFenceReceipt,
    featureOffReceipt,
    inputDigests: {
      ownerLeaseReceiptSha256: inputDigests.ownerLeaseReceiptSha256,
      templateContractReceiptSha256:
        inputDigests.templateContractReceiptSha256,
      canaryFenceReceiptSha256: inputDigests.canaryFenceReceiptSha256,
      featureOffReceiptSha256: inputDigests.featureOffReceiptSha256,
    },
    now: () => new Date(completedAtMs),
  });
  if (canonicalJson(value) !== canonicalJson(expected)) {
    blocked("FINALIZER_DRY_REHEARSAL_INVALID");
  }
  return true;
}

export function buildSuccessorFinalizerEvidence({
  manifest,
  controllerManifest,
  expectedCommit,
  templateText,
  ownerLeaseReceipt,
  templateContractReceipt,
  canaryFenceReceipt,
  featureOffReceipt,
  finalizerDryRehearsal,
  inputDigests,
  gitState,
  now = () => new Date(),
}) {
  const contract = validateReleaseContracts(manifest, controllerManifest);
  if (!COMMIT.test(expectedCommit ?? "")
      || typeof templateText !== "string"
      || Buffer.byteLength(templateText, "utf8") < 2
      || Buffer.byteLength(templateText, "utf8") > 64 * 1024) {
    blocked("FINALIZER_REHEARSAL_INPUT_INVALID");
  }
  validateDigestSet(inputDigests, [
    "canaryFenceReceiptSha256",
    "featureOffReceiptSha256",
    "finalizerDryRehearsalSha256",
    "ownerLeaseReceiptSha256",
    "templateContractReceiptSha256",
  ]);
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) blocked("FINALIZER_CLOCK_INVALID");
  const exactOwnerLeaseVerified = validateOwnerLease(
    ownerLeaseReceipt,
    manifest,
    expectedCommit,
    contract,
    nowMs,
  );
  const canaryFenceHeld = validateCanary(
    canaryFenceReceipt,
    manifest,
    expectedCommit,
    contract,
    nowMs,
  );
  const featureOffRollbackAvailable = validateFeatureOff(
    featureOffReceipt,
    manifest,
    expectedCommit,
    contract,
    nowMs,
  );
  const templateRenderedWithSuccessorContracts = validateTemplateContract(
    templateContractReceipt,
    manifest,
    expectedCommit,
    contract,
    ownerLeaseReceipt,
    canaryFenceReceipt,
    inputDigests,
    templateText,
    nowMs,
  );
  const finalizerRehearsalPassed = validateDryRehearsal({
    value: finalizerDryRehearsal,
    manifest,
    controllerManifest,
    expectedCommit,
    templateText,
    ownerLeaseReceipt,
    templateContractReceipt,
    canaryFenceReceipt,
    featureOffReceipt,
    inputDigests,
    nowMs,
  });
  validateGitState(gitState, expectedCommit);

  const checks = {
    exactOwnerLeaseVerified,
    templateRenderedWithSuccessorContracts,
    canaryFenceHeld,
    featureOffRollbackAvailable,
    finalizerRehearsalPassed,
  };
  if (!exactKeys(checks, contract.requirement.requiredChecks)
      || contract.requirement.requiredChecks.some((name) => checks[name] !== true)) {
    blocked("FINALIZER_CHECK_DERIVATION_INVALID");
  }
  const capturedAt = finalizerDryRehearsal.completedAt;
  const capturedAtMs = Date.parse(capturedAt);
  const raw = {
    evidenceVersion: 1,
    kind: "successor-finalizer-rehearsal-raw-evidence-v1",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    capturedAt,
    git: {
      actualCommit: gitState.actualCommit,
      upstreamCommit: gitState.upstreamCommit,
      remoteCommit: gitState.remoteCommit,
      remoteRef: gitState.remoteRef,
      worktreeClean: gitState.worktreeClean,
    },
    scope: {
      mode: "render-only-no-database-execution",
      databaseExecutionAttempted: false,
      productionMutationAttempted: false,
      proves: [
        "exact-owner lease rehearsal receipt contract",
        "successor-bound finalizer template rendering",
        "write-fenced canary rehearsal receipt contract",
        "feature-off rollback rehearsal receipt contract",
      ],
      doesNotProve: [
        "Production finalizer SQL execution",
        "Production database finalization",
        "Production write-fence removal",
      ],
    },
    contracts: {
      finalizationContractVersion: contract.finalization.version,
      operationId: contract.operation.id,
      operationSha256: contract.operation.sha256,
      rollbackContractSha256: contract.rollbackContractSha256,
      successorTableContractSha256:
        contract.postExpand.expectedTableContractSha256,
      successorMigrationContractSha256:
        contract.postExpand.expectedReleaseMigrationContractSha256,
    },
    inputProvenance: {
      ownerLeaseReceiptSha256: inputDigests.ownerLeaseReceiptSha256,
      templateContractReceiptSha256:
        inputDigests.templateContractReceiptSha256,
      canaryFenceReceiptSha256: inputDigests.canaryFenceReceiptSha256,
      featureOffReceiptSha256: inputDigests.featureOffReceiptSha256,
      finalizerDryRehearsalSha256:
        inputDigests.finalizerDryRehearsalSha256,
    },
    artifacts: {
      ownerLease: ownerLeaseReceipt,
      templateContract: templateContractReceipt,
      canaryFence: canaryFenceReceipt,
      featureOffRollback: featureOffReceipt,
      finalizerDryRehearsal,
    },
    derivedChecks: checks,
    containsSecrets: false,
  };
  const rawText = `${JSON.stringify(raw, null, 2)}\n`;
  const receipt = {
    receiptVersion: 1,
    kind: contract.requirement.kind,
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    capturedAt,
    expiresAt: new Date(
      capturedAtMs + contract.requirement.maximumAgeMinutes * 60_000,
    ).toISOString(),
    requiredRemoteHead: manifest.requiredRemoteHead,
    expectedMigrationHead: contract.versions.at(-1),
    migrationCount: contract.versions.length,
    migrationVersionsSha256: contract.migrationVersionsSha256,
    observations: {
      featureOffReceiptFileName: contract.rollback.featureOffReceiptFileName,
      finalizationContractVersion: contract.finalization.version,
      migrationRollback: contract.rollback.migrationRollback,
      requiredControls: { ...contract.rollback.requiredControls },
      rollbackStrategy: contract.rollback.strategy,
    },
    postApplyCheckIds: [...contract.postApplyCheckIds],
    postApplyChecksSha256: contract.postApplyChecksSha256,
    rollbackContractSha256: contract.rollbackContractSha256,
    checks,
    rawProvenance: {
      fileName: contract.requirement.rawEvidenceFileName,
      sha256: sha256(rawText),
      capturedAt,
      source: contract.requirement.rawEvidenceSource,
    },
    containsSecrets: false,
  };
  return Object.freeze({
    raw: Object.freeze(raw),
    rawText,
    receipt: Object.freeze(receipt),
  });
}

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value === ""
    || (value !== ".."
      && !value.startsWith(`..${sep}`)
      && !isAbsolute(value));
}

function pathIdentity(path) {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

async function validateOutputPaths({
  repoRoot,
  rawOut,
  receiptOut,
  rawFileName,
  receiptFileName,
}) {
  if (![repoRoot, rawOut, receiptOut].every((value) => typeof value === "string")
      || !isAbsolute(repoRoot)
      || !isAbsolute(rawOut)
      || !isAbsolute(receiptOut)
      || basename(rawOut) !== rawFileName
      || basename(receiptOut) !== receiptFileName
      || pathIdentity(rawOut) === pathIdentity(receiptOut)
      || pathIdentity(dirname(rawOut)) !== pathIdentity(dirname(receiptOut))) {
    blocked("FINALIZER_EVIDENCE_OUTPUT_PATH_INVALID");
  }
  const parent = dirname(rawOut);
  const [repoMetadata, parentMetadata, repoCanonical, parentCanonical] =
    await Promise.all([
      lstat(repoRoot).catch(() => null),
      lstat(parent).catch(() => null),
      realpath(repoRoot).catch(() => null),
      realpath(parent).catch(() => null),
    ]);
  if (!repoMetadata?.isDirectory()
      || repoMetadata.isSymbolicLink()
      || !parentMetadata?.isDirectory()
      || parentMetadata.isSymbolicLink()
      || !repoCanonical
      || !parentCanonical
      || inside(repoCanonical, parentCanonical)) {
    blocked("FINALIZER_EVIDENCE_OUTPUT_PATH_INVALID");
  }
  const canonicalRawOut = resolve(parentCanonical, rawFileName);
  const canonicalReceiptOut = resolve(parentCanonical, receiptFileName);
  if (await lstat(canonicalRawOut).catch(() => null)
      || await lstat(canonicalReceiptOut).catch(() => null)) {
    blocked("FINALIZER_EVIDENCE_OUTPUT_EXISTS");
  }
  return { rawOut: canonicalRawOut, receiptOut: canonicalReceiptOut };
}

async function defaultSyncParent(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const DEFAULT_FILE_OPS = Object.freeze({
  open,
  rm,
  lstat,
  syncParent: defaultSyncParent,
});

async function removeCreatedFileDurably(path, fileOps) {
  let cleanupError = null;
  try {
    await fileOps.rm(path, { force: true });
  } catch (error) {
    cleanupError = error;
  }
  try {
    const metadata = await fileOps.lstat(path);
    if (metadata) cleanupError ??= new Error("created output still exists");
  } catch (error) {
    if (error?.code !== "ENOENT") cleanupError ??= error;
  }
  try {
    await fileOps.syncParent(dirname(path));
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError) blocked("FINALIZER_EVIDENCE_OUTPUT_CLEANUP_FAILED");
}

async function writeExclusive(path, text, fileOps) {
  let handle;
  let created = false;
  try {
    handle = await fileOps.open(path, "wx", 0o600);
    if (!handle) blocked("FINALIZER_EVIDENCE_OUTPUT_WRITE_FAILED");
    created = true;
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fileOps.syncParent(dirname(path));
  } catch (error) {
    await handle?.close().catch(() => {});
    if (created) await removeCreatedFileDurably(path, fileOps);
    if (error instanceof SuccessorFinalizerEvidenceError) throw error;
    if (!created && error?.code === "EEXIST") {
      blocked("FINALIZER_EVIDENCE_OUTPUT_EXISTS");
    }
    blocked("FINALIZER_EVIDENCE_OUTPUT_WRITE_FAILED");
  }
}

export async function emitSuccessorFinalizerRenderOnlyRehearsal({
  repoRoot,
  rehearsalOut,
  fileOps = DEFAULT_FILE_OPS,
  ...input
}) {
  const rehearsal = buildSuccessorFinalizerRenderOnlyRehearsal(input);
  const text = `${JSON.stringify(rehearsal, null, 2)}\n`;
  const expectedFileName = `${input.manifest.release}-finalizer-dry-rehearsal.json`;
  if (Buffer.byteLength(text, "utf8") < 2
      || Buffer.byteLength(text, "utf8") > MAX_RECEIPT_BYTES
      || typeof repoRoot !== "string"
      || typeof rehearsalOut !== "string"
      || !isAbsolute(repoRoot)
      || !isAbsolute(rehearsalOut)
      || basename(rehearsalOut) !== expectedFileName) {
    blocked("FINALIZER_REHEARSAL_OUTPUT_PATH_INVALID");
  }
  const parent = dirname(rehearsalOut);
  const [repoMetadata, parentMetadata, repoCanonical, parentCanonical] =
    await Promise.all([
      lstat(repoRoot).catch(() => null),
      lstat(parent).catch(() => null),
      realpath(repoRoot).catch(() => null),
      realpath(parent).catch(() => null),
    ]);
  if (!repoMetadata?.isDirectory()
      || repoMetadata.isSymbolicLink()
      || !parentMetadata?.isDirectory()
      || parentMetadata.isSymbolicLink()
      || !repoCanonical
      || !parentCanonical
      || inside(repoCanonical, parentCanonical)) {
    blocked("FINALIZER_REHEARSAL_OUTPUT_PATH_INVALID");
  }
  const canonicalOutput = resolve(parentCanonical, expectedFileName);
  if (await lstat(canonicalOutput).catch(() => null)) {
    blocked("FINALIZER_EVIDENCE_OUTPUT_EXISTS");
  }
  await writeExclusive(canonicalOutput, text, fileOps);
  return rehearsal;
}

export async function emitSuccessorFinalizerEvidence({
  repoRoot,
  rawOut,
  receiptOut,
  fileOps = DEFAULT_FILE_OPS,
  ...input
}) {
  const result = buildSuccessorFinalizerEvidence(input);
  const receiptText = `${JSON.stringify(result.receipt, null, 2)}\n`;
  const rawBytes = Buffer.byteLength(result.rawText, "utf8");
  const receiptBytes = Buffer.byteLength(receiptText, "utf8");
  if (rawBytes < 2
      || rawBytes > MAX_RAW_EVIDENCE_BYTES
      || receiptBytes < 2
      || receiptBytes > MAX_RECEIPT_BYTES) {
    blocked("FINALIZER_EVIDENCE_OUTPUT_TOO_LARGE");
  }
  const evidence = input.manifest?.deploymentEvidence?.finalizer;
  const paths = await validateOutputPaths({
    repoRoot,
    rawOut,
    receiptOut,
    rawFileName: evidence?.rawEvidenceFileName,
    receiptFileName: evidence?.receiptFileName,
  });
  const created = [];
  try {
    await writeExclusive(paths.rawOut, result.rawText, fileOps);
    created.push(paths.rawOut);
    await writeExclusive(paths.receiptOut, receiptText, fileOps);
    created.push(paths.receiptOut);
  } catch (error) {
    let cleanupError = null;
    for (const path of created.reverse()) {
      try {
        await removeCreatedFileDurably(path, fileOps);
      } catch (candidate) {
        cleanupError ??= candidate;
      }
    }
    if (cleanupError) throw cleanupError;
    throw error;
  }
  return result;
}
