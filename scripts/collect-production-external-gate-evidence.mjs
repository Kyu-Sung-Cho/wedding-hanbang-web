#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
  AMORA_POST_EXPAND_TABLES,
  AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
  AMORA_RELEASE_MIGRATION_VERSIONS,
  validateAmoraExtendedReleaseContracts,
} from "./lib/amora-release-extended-contracts.mjs";
import {
  collectHostedRestoreEvidence,
  collectProductionCanaryEvidence,
  collectVercelDeploymentEvidence,
  collectVercelServerErrorRawEvidence,
  ExternalGateProvenanceError,
  runPlaywrightPublicCanaryObservation,
  runProductionDatabaseFenceObservation,
  runSupabaseAuthenticatedSessionObservation,
} from "./lib/production-external-gate-provenance.mjs";
import {
  SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  SuccessorReleaseContractError,
  validateSuccessorNoAdditionalCostReleaseAssurance,
  validateSuccessorReleaseContract,
  validateSuccessorRuntimeEvidence,
} from "./lib/supabase-successor-release-contract.mjs";

const PREDECESSOR_MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const BACKUP_SET_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PROVIDER_RESTORE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;
const COMMON_ARGUMENTS = new Set(["--mode", "--expected-commit"]);
const VERCEL_ARGUMENTS = new Set([
  "--deployment-id",
  "--raw-out",
  "--receipt-out",
]);
const HOSTED_RESTORE_ARGUMENTS = new Set([
  "--backup-receipt",
  "--target-project-ref",
  "--target-project-name",
  "--provider-restore-job-id",
  "--restore-completed-at",
  "--psql",
  "--project-raw-out",
  "--database-raw-out",
  "--receipt-out",
]);
const CANARY_SHARED_ARGUMENTS = new Set([
  "--deployment-receipt",
  "--release-outcome",
  "--backup-receipt",
  "--browser-executable",
  "--psql",
  "--raw-out",
  "--vercel-server-errors-raw-out",
  "--receipt-out",
]);
const PREDECESSOR_CANARY_ARGUMENTS = new Set([
  ...CANARY_SHARED_ARGUMENTS,
  "--hosted-restore-receipt",
]);
const SUCCESSOR_CANARY_ARGUMENTS = new Set([
  ...CANARY_SHARED_ARGUMENTS,
  "--recovery-assurance-receipt",
]);
const MODE_ARGUMENTS = Object.freeze({
  vercel: VERCEL_ARGUMENTS,
  "hosted-restore": HOSTED_RESTORE_ARGUMENTS,
  canary: new Set([
    ...CANARY_SHARED_ARGUMENTS,
    "--hosted-restore-receipt",
    "--recovery-assurance-receipt",
  ]),
});
const SUCCESSOR_BACKUP_CHECK_KEYS = Object.freeze([
  "authDataDigestsVerified",
  "encryptedArtifactsVerified",
  "exactTableContractVerified",
  "liveSchemaDigestVerified",
  "logicalDataDigestsVerified",
  "plaintextWrittenToDisk",
  "storageDataDigestsVerified",
]);
const SUCCESSOR_BACKUP_RECEIPT_KEYS = Object.freeze([
  "authSchemaContractSha256",
  "authUsersContractSha256",
  "backupContractId",
  "backupContractVersion",
  "backupManifestSha256",
  "backupSetId",
  "capturedAt",
  "checks",
  "containsSecrets",
  "expectedMigrationHead",
  "expectedTableContractSha256",
  "expectedTableCount",
  "expectedTables",
  "kind",
  "liveSchemaContractSha256",
  "logicalDataContractSha256",
  "migrationVersionsSha256",
  "projectRef",
  "receiptVersion",
  "release",
  "releaseCommit",
  "sourceDatabaseOid",
  "sourceDatabaseSystemIdentifier",
  "storageMetadataContractSha256",
  "storageObjectInventorySha256",
  "verifiedAt",
]);
const SUCCESSOR_RUNTIME_EVIDENCE_NAMES = Object.freeze(
  Object.keys(SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS).sort(),
);

export class ExternalGateCollectorCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExternalGateCollectorCliError";
    this.code = code;
  }
}

function blocked(code, message) {
  throw new ExternalGateCollectorCliError(code, message);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

function parseCanonicalInstant(value) {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
      && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : null;
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  // A plain object literal routes `--__proto__=...` through the
  // Object.prototype setter, where the assignment is a silent no-op and the
  // name never appears in Object.keys - which would let a secret-bearing
  // argument slip past the exact-argument-set gate below.
  const options = Object.create(null);
  for (const argument of argv) {
    const separator = argument.indexOf("=");
    if (separator < 3) blocked("ARGUMENT_INVALID", "arguments require --name=value");
    const name = argument.slice(0, separator);
    const value = argument.slice(separator + 1);
    if (!value || Object.hasOwn(options, name)) {
      blocked("ARGUMENT_INVALID", "arguments must be non-empty and unique");
    }
    options[name] = value;
  }
  const mode = options["--mode"];
  const allowed = Object.hasOwn(MODE_ARGUMENTS, mode ?? "")
    ? MODE_ARGUMENTS[mode]
    : null;
  if (!allowed) blocked("MODE_INVALID", "mode must be vercel, hosted-restore or canary");
  const known = new Set([...COMMON_ARGUMENTS, ...allowed]);
  if (Object.keys(options).some((name) => !known.has(name))
      || [...COMMON_ARGUMENTS].some((name) => !options[name])) {
    blocked("ARGUMENT_INVALID", "mode requires its exact non-secret argument set");
  }
  if (mode === "canary") {
    const recoveryProofCount = [
      "--hosted-restore-receipt",
      "--recovery-assurance-receipt",
    ].filter((name) => options[name]).length;
    if ([...CANARY_SHARED_ARGUMENTS].some((name) => !options[name])
        || recoveryProofCount !== 1) {
      blocked("ARGUMENT_INVALID", "canary requires exactly one status-specific recovery proof");
    }
  } else if ([...allowed].some((name) => !options[name])) {
    blocked("ARGUMENT_INVALID", "mode requires its exact non-secret argument set");
  }
  if (!COMMIT.test(options["--expected-commit"])) {
    blocked("EXPECTED_COMMIT_INVALID", "expected commit must be lowercase 40-hex");
  }
  return { help: false, mode, options };
}

function validateStatusSpecificArguments(parsed, successorController) {
  if (successorController && parsed.mode === "hosted-restore") {
    blocked(
      "SUCCESSOR_HOSTED_RESTORE_FORBIDDEN",
      "controller-ready successor uses no-cost recovery assurance, not hosted restore",
    );
  }
  const modeArguments = parsed.mode === "canary"
    ? successorController
      ? SUCCESSOR_CANARY_ARGUMENTS
      : PREDECESSOR_CANARY_ARGUMENTS
    : MODE_ARGUMENTS[parsed.mode];
  const expected = new Set([...COMMON_ARGUMENTS, ...modeArguments]);
  if (Object.keys(parsed.options).some((name) => !expected.has(name))
      || [...expected].some((name) => !parsed.options[name])) {
    blocked(
      "ARGUMENT_INVALID",
      "mode arguments do not match the selected release status",
    );
  }
}

async function readInputReceipt(path, repoRoot, label) {
  if (!isAbsolute(path) || inside(repoRoot, path) || !path.endsWith(".json")) {
    blocked("INPUT_RECEIPT_PATH_INVALID", `${label} must be absolute and outside Git`);
  }
  const metadata = await lstat(path).catch(() => null);
  const canonicalPath = await realpath(path).catch(() => null);
  const canonicalParent = await realpath(dirname(path)).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()
      || metadata.size < 2 || metadata.size > 512 * 1024
      || !canonicalPath || !canonicalParent
      || resolve(dirname(canonicalPath)).toLowerCase()
        !== resolve(canonicalParent).toLowerCase()) {
    blocked("INPUT_RECEIPT_INVALID", `${label} is missing, oversized or unsafe`);
  }
  const handle = await open(canonicalPath, "r").catch(() => null);
  if (!handle) blocked("INPUT_RECEIPT_INVALID", `${label} could not be opened`);
  let opened;
  let bytes;
  try {
    opened = await handle.stat();
    bytes = await handle.readFile();
  } finally {
    await handle.close().catch(() => {});
  }
  const after = await lstat(path).catch(() => null);
  const afterCanonicalPath = await realpath(path).catch(() => null);
  const identityChanged = Number.isSafeInteger(metadata.ino)
    && metadata.ino !== 0
    && (metadata.ino !== opened.ino
      || metadata.dev !== opened.dev
      || opened.ino !== after?.ino
      || opened.dev !== after?.dev);
  if (!after?.isFile() || after.isSymbolicLink()
      || after.size !== metadata.size || bytes.length !== metadata.size
      || after.mtimeMs !== metadata.mtimeMs
      || afterCanonicalPath !== canonicalPath
      || identityChanged) {
    blocked("INPUT_RECEIPT_INVALID", `${label} changed while being read`);
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString("utf8"));
  } catch {
    blocked("INPUT_RECEIPT_INVALID", `${label} is not JSON`);
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    blocked("INPUT_RECEIPT_INVALID", `${label} has an invalid shape`);
  }
  return { receipt, sha256: sha256(bytes) };
}

async function requireExecutable(path, label) {
  if (!isAbsolute(path)) blocked("EXECUTABLE_INVALID", `${label} must be absolute`);
  const metadata = await lstat(path).catch(() => null);
  const canonical = await realpath(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || !canonical) {
    blocked("EXECUTABLE_INVALID", `${label} must be a regular non-symlink file`);
  }
  return canonical;
}

function requireEnvironment(environment, names) {
  const values = {};
  for (const name of names) {
    const value = environment[name];
    if (typeof value !== "string" || value.length < 3) {
      blocked("ENVIRONMENT_REQUIRED", `required credential environment is missing: ${name}`);
    }
    values[name] = value;
  }
  return values;
}

async function loadManifest(
  repoRoot,
  { validateSuccessorContract = validateSuccessorReleaseContract } = {},
) {
  const successorPath = resolve(
    repoRoot,
    SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  );
  const successorMetadata = await lstat(successorPath).catch(() => null);
  if (successorMetadata) {
    if (!successorMetadata.isFile() || successorMetadata.isSymbolicLink()) {
      blocked(
        "SUCCESSOR_RELEASE_CONTRACT_INVALID",
        "successor manifest must be one regular repository file",
      );
    }
    let successor;
    try {
      successor = validateSuccessorContract({ repoRoot });
    } catch (error) {
      if (error instanceof SuccessorReleaseContractError) {
        blocked(
          "SUCCESSOR_RELEASE_CONTRACT_INVALID",
          `successor release contract failed: ${error.code}`,
        );
      }
      throw error;
    }
    if (successor.deploymentBlocked || !successor.controllerManifest) {
      blocked(
        "SUCCESSOR_RELEASE_DEPLOYMENT_BLOCKED",
        "successor release is deployment-blocked and cannot collect external evidence",
      );
    }
    try {
      validateAmoraExtendedReleaseContracts(successor.controllerManifest);
    } catch {
      blocked(
        "SUCCESSOR_RELEASE_CONTRACT_INVALID",
        "successor controller extended release contract is invalid",
      );
    }
    if (!PROJECT_REF.test(successor.controllerManifest.projectRef ?? "")) {
      blocked("MANIFEST_INVALID", "release manifest project ref is invalid");
    }
    return {
      manifest: successor.controllerManifest,
      sourceManifest: successor.manifest,
      successorController: true,
    };
  }

  const path = resolve(repoRoot, PREDECESSOR_MANIFEST_RELATIVE_PATH);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
    validateAmoraExtendedReleaseContracts(manifest);
  } catch {
    blocked("MANIFEST_INVALID", "exact release manifest is missing or invalid");
  }
  if (!PROJECT_REF.test(manifest.projectRef ?? "")) {
    blocked("MANIFEST_INVALID", "release manifest project ref is invalid");
  }
  return {
    manifest,
    sourceManifest: manifest,
    successorController: false,
  };
}

function validateBackupBinding(receipt, expectedCommit) {
  if (receipt.Verified !== true
      || receipt.GitCommit !== expectedCommit
      || !UPPER_SHA256.test(receipt.ManifestSha256 ?? "")
      || !UPPER_SHA256.test(receipt.InventoryContractSha256 ?? "")
      || !UPPER_SHA256.test(receipt.SourceRelationContractSha256 ?? "")
      || !UPPER_SHA256.test(receipt.LiveSchemaContractSha256 ?? "")
      || !UPPER_SHA256.test(receipt.LogicalDataContractSha256 ?? "")
      || typeof receipt.BackupSetId !== "string"
      || receipt.TableCount !== AMORA_POST_EXPAND_TABLES.length) {
    blocked("BACKUP_RECEIPT_INVALID", "backup receipt is not bound to the release");
  }
  return receipt;
}

function validateSuccessorBackupBinding({
  receipt,
  sourceManifest,
  controllerManifest,
  expectedCommit,
  now,
}) {
  const contract = controllerManifest.postExpandBackupContract;
  const capturedAt = parseCanonicalInstant(receipt?.capturedAt);
  const verifiedAt = parseCanonicalInstant(receipt?.verifiedAt);
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number.NaN;
  const hashes = [
    receipt?.backupManifestSha256,
    receipt?.liveSchemaContractSha256,
    receipt?.logicalDataContractSha256,
    receipt?.authSchemaContractSha256,
    receipt?.authUsersContractSha256,
    receipt?.storageMetadataContractSha256,
    receipt?.storageObjectInventorySha256,
  ];
  if (!exactKeys(receipt, SUCCESSOR_BACKUP_RECEIPT_KEYS)
      || receipt.receiptVersion !== 2
      || receipt.kind !== "successor-post-expand-backup-verification-v2"
      || receipt.release !== sourceManifest.release
      || receipt.projectRef !== sourceManifest.projectRef
      || receipt.releaseCommit !== expectedCommit
      || receipt.backupContractId !== contract?.id
      || receipt.backupContractVersion !== 2
      || contract?.version !== 2
      || !BACKUP_SET_ID.test(receipt.backupSetId ?? "")
      || hashes.some((value) => !SHA256.test(value ?? ""))
      || !/^[1-9]\d{0,9}$/.test(receipt.sourceDatabaseOid ?? "")
      || !/^\d{10,32}$/.test(receipt.sourceDatabaseSystemIdentifier ?? "")
      || receipt.expectedMigrationHead !== contract.expectedReleaseMigrationHead
      || receipt.migrationVersionsSha256
        !== contract.expectedReleaseMigrationContractSha256
      || receipt.expectedTableCount !== contract.expectedTableCount
      || !exactArray(receipt.expectedTables, contract.expectedTables)
      || receipt.expectedTableContractSha256
        !== contract.expectedTableContractSha256
      || !exactKeys(receipt.checks, SUCCESSOR_BACKUP_CHECK_KEYS)
      || SUCCESSOR_BACKUP_CHECK_KEYS.some((key) => (
        key === "plaintextWrittenToDisk"
          ? receipt.checks[key] !== false
          : receipt.checks[key] !== true
      ))
      || receipt.containsSecrets !== false
      || capturedAt === null
      || verifiedAt === null
      || !Number.isFinite(nowMs)
      || verifiedAt < capturedAt
      || verifiedAt > nowMs + 60_000
      || nowMs - verifiedAt > contract.maximumAgeMinutes * 60_000) {
    blocked(
      "BACKUP_RECEIPT_INVALID",
      "successor post-expand backup receipt is stale, mismatched or non-canonical",
    );
  }
  return receipt;
}

function validateSuccessorOutcomeBinding({
  outcome,
  sourceManifest,
  expectedCommit,
  recovery,
}) {
  const records = outcome?.successorRuntimeEvidence;
  let assuranceValid = true;
  try {
    validateSuccessorNoAdditionalCostReleaseAssurance(
      outcome?.successorReleaseAssurance,
    );
  } catch {
    assuranceValid = false;
  }
  if (outcome?.release !== sourceManifest.release
      || outcome?.projectRef !== sourceManifest.projectRef
      || outcome?.releaseCommit !== expectedCommit
      || !assuranceValid
      || !Array.isArray(records)
      || records.length !== SUCCESSOR_RUNTIME_EVIDENCE_NAMES.length) {
    blocked(
      "CANARY_INPUT_RECEIPT_INVALID",
      "release outcome does not retain the exact successor runtime evidence set",
    );
  }
  for (const [index, name] of SUCCESSOR_RUNTIME_EVIDENCE_NAMES.entries()) {
    const record = records[index];
    if (!exactKeys(record, [
      "expiresAt",
      "name",
      "rawEvidenceSha256",
      "receiptSha256",
      "verifiedAt",
    ])
        || record.name !== name
        || !SHA256.test(record.receiptSha256 ?? "")
        || !SHA256.test(record.rawEvidenceSha256 ?? "")
        || !Number.isFinite(Date.parse(record.verifiedAt ?? ""))
        || !Number.isFinite(Date.parse(record.expiresAt ?? ""))) {
      blocked(
        "CANARY_INPUT_RECEIPT_INVALID",
        "release outcome successor runtime record is malformed or reordered",
      );
    }
  }
  const expectedSetSha256 = sha256(
    `${records.map((record) => [
      record.name,
      record.receiptSha256,
      record.rawEvidenceSha256,
      record.verifiedAt,
      record.expiresAt,
    ].join(":")).join("\n")}\n`,
  );
  const recoveryRecord = records.find(
    (record) => record.name === "recoveryAssurance",
  );
  const backupRecord = records.find((record) => record.name === "backup");
  const hostedStagingRecord = records.find(
    (record) => record.name === "hostedStaging",
  );
  const observations = recovery.observations;
  if (outcome.successorRuntimeEvidenceSetSha256 !== expectedSetSha256
      || recoveryRecord.receiptSha256 !== recovery.receiptSha256
      || recoveryRecord.rawEvidenceSha256 !== recovery.rawEvidenceSha256
      || recoveryRecord.verifiedAt !== recovery.verifiedAt
      || recoveryRecord.expiresAt !== recovery.expiresAt
      || observations.preApplyBackupReceiptSha256
        !== backupRecord.receiptSha256
      || observations.preApplyBackupRawEvidenceSha256
        !== backupRecord.rawEvidenceSha256
      || observations.hostedStagingReceiptSha256
        !== hostedStagingRecord.receiptSha256
      || observations.hostedStagingRawEvidenceSha256
        !== hostedStagingRecord.rawEvidenceSha256
      || JSON.stringify(recovery.releaseAssurance)
        !== JSON.stringify(SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE)) {
    blocked(
      "CANARY_INPUT_RECEIPT_INVALID",
      "release outcome hashes differ from live no-cost recovery assurance",
    );
  }
}

function validateSuccessorRecoveryBinding({
  repoRoot,
  recoveryReceiptPath,
  recoveryReceiptSha256,
  sourceManifest,
  controllerManifest,
  expectedCommit,
  outcome,
  backupReceipt,
  backupReceiptSha256,
  now,
  runtimeEvidenceValidator,
}) {
  const contract = sourceManifest.deploymentEvidence?.recoveryAssurance;
  if (resolve(recoveryReceiptPath)
        !== resolve(dirname(recoveryReceiptPath), contract?.receiptFileName ?? "invalid")) {
    blocked(
      "CANARY_INPUT_RECEIPT_INVALID",
      "recovery-assurance path does not match the successor runtime contract",
    );
  }
  let runtime;
  try {
    runtime = runtimeEvidenceValidator({
      repoRoot,
      receiptRoot: dirname(recoveryReceiptPath),
      manifest: sourceManifest,
      controllerManifest,
      expectedCommit,
      phase: "post-expand",
      now,
    });
  } catch (error) {
    if (error instanceof SuccessorReleaseContractError) {
      blocked(
        "CANARY_INPUT_RECEIPT_INVALID",
        `recovery assurance failed live revalidation: ${error.code}`,
      );
    }
    throw error;
  }
  const recovery = runtime?.recoveryAssurance;
  const observations = recovery?.observations;
  if (resolve(recovery?.receiptPath ?? "invalid")
        !== resolve(recoveryReceiptPath)
      || recovery.receiptSha256 !== recoveryReceiptSha256
      || observations?.postExpandBackupContractId
        !== controllerManifest.postExpandBackupContract.id
      || observations?.postExpandBackupReceiptSha256 !== backupReceiptSha256
      || observations?.postExpandBackupManifestSha256
        !== backupReceipt.backupManifestSha256
      || observations?.postExpandLiveSchemaContractSha256
        !== backupReceipt.liveSchemaContractSha256
      || observations?.postExpandLogicalDataContractSha256
        !== backupReceipt.logicalDataContractSha256
      || observations?.postExpandEncryptedArtifactsVerified !== true
      || observations?.postExpandPGliteJsonbRoundTripVerified !== true) {
    blocked(
      "CANARY_INPUT_RECEIPT_INVALID",
      "recovery assurance does not bind the exact post-expand encrypted backup",
    );
  }
  validateSuccessorOutcomeBinding({
    outcome,
    sourceManifest,
    expectedCommit,
    recovery,
  });
  return recovery;
}

async function collectVercelMode({ repoRoot, manifest, options, environment }) {
  const { VERCEL_TOKEN: vercelToken } = requireEnvironment(
    environment,
    ["VERCEL_TOKEN"],
  );
  const contract = manifest.finalizationContract.externalEvidence.vercel;
  return await collectVercelDeploymentEvidence({
    repoRoot,
    vercelToken,
    teamId: contract.teamId,
    projectId: contract.projectId,
    deploymentId: options["--deployment-id"],
    productionHost: contract.productionHost,
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: options["--expected-commit"],
    rawEvidencePath: options["--raw-out"],
    receiptPath: options["--receipt-out"],
  });
}

async function collectHostedRestoreMode({
  repoRoot,
  manifest,
  options,
  environment,
}) {
  const credentials = requireEnvironment(environment, [
    "SUPABASE_ACCESS_TOKEN",
    "HANBANG_HOSTED_RESTORE_DATABASE_URL",
  ]);
  const psql = await requireExecutable(options["--psql"], "psql");
  const backupData = await readInputReceipt(
    options["--backup-receipt"],
    repoRoot,
    "post-expand backup receipt",
  );
  const backup = validateBackupBinding(
    backupData.receipt,
    options["--expected-commit"],
  );
  const targetProjectRef = options["--target-project-ref"];
  if (!PROJECT_REF.test(targetProjectRef)
      || targetProjectRef === manifest.projectRef
      || !PROVIDER_RESTORE_JOB_ID.test(options["--provider-restore-job-id"])
      || parseCanonicalInstant(options["--restore-completed-at"]) === null) {
    blocked("HOSTED_RESTORE_ARGUMENT_INVALID", "hosted restore identity is invalid");
  }
  return await collectHostedRestoreEvidence({
    repoRoot,
    psql,
    supabaseAccessToken: credentials.SUPABASE_ACCESS_TOKEN,
    databaseUrl: credentials.HANBANG_HOSTED_RESTORE_DATABASE_URL,
    targetProjectName: options["--target-project-name"],
    projectRawEvidencePath: options["--project-raw-out"],
    databaseProbeRawEvidencePath: options["--database-raw-out"],
    receiptPath: options["--receipt-out"],
    baseReceipt: {
      receiptVersion: 1,
      kind: "post-expand-hosted-restore-evidence",
      release: manifest.release,
      releaseCommit: options["--expected-commit"],
      sourceProjectRef: manifest.projectRef,
      targetProjectRef,
      backupSetId: backup.BackupSetId,
      backupManifestSha256: backup.ManifestSha256,
      sourceSchemaContractSha256: backup.InventoryContractSha256,
      targetSchemaContractSha256: backup.InventoryContractSha256,
      sourceDataContractSha256: backup.SourceRelationContractSha256,
      targetDataContractSha256: backup.SourceRelationContractSha256,
      sourceLiveSchemaContractSha256: backup.LiveSchemaContractSha256,
      targetLiveSchemaContractSha256: backup.LiveSchemaContractSha256,
      sourceLogicalDataContractSha256: backup.LogicalDataContractSha256,
      targetLogicalDataContractSha256: backup.LogicalDataContractSha256,
      targetTables: [...AMORA_POST_EXPAND_TABLES],
      targetReleaseMigrationVersions: [...AMORA_RELEASE_MIGRATION_VERSIONS],
      targetTableContractSha256: AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
      targetReleaseMigrationContractSha256:
        AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
      providerRestoreJobId: options["--provider-restore-job-id"],
      restoreCompletedAt: options["--restore-completed-at"],
      verifiedAt: options["--restore-completed-at"],
      checks: {},
      containsSensitiveValues: false,
    },
  });
}

async function collectCanaryMode({
  repoRoot,
  manifest,
  sourceManifest,
  successorController,
  options,
  environment,
  now,
  runtimeEvidenceValidator,
  collectCanaryEvidence,
}) {
  const credentials = requireEnvironment(environment, [
    "VERCEL_TOKEN",
    "HANBANG_CANARY_SUPABASE_ANON_KEY",
    "HANBANG_CANARY_TEST_EMAIL",
    "HANBANG_CANARY_TEST_PASSWORD",
    "HANBANG_PRODUCTION_DATABASE_URL",
  ]);
  const browserExecutable = await requireExecutable(
    options["--browser-executable"],
    "Chromium",
  );
  const psql = await requireExecutable(options["--psql"], "psql");
  const deploymentData = await readInputReceipt(
    options["--deployment-receipt"],
    repoRoot,
    "deployment receipt",
  );
  const outcomeData = await readInputReceipt(
    options["--release-outcome"],
    repoRoot,
    "release outcome receipt",
  );
  const backupData = await readInputReceipt(
    options["--backup-receipt"],
    repoRoot,
    "post-expand backup receipt",
  );
  const expectedCommit = options["--expected-commit"];
  const deployment = deploymentData.receipt;
  if (deployment.release !== sourceManifest.release
      || deployment.projectRef !== sourceManifest.projectRef
      || deployment.releaseCommit !== expectedCommit
      || deployment.readyState !== "READY"
      || outcomeData.receipt.releaseCommit !== expectedCommit) {
    blocked("CANARY_INPUT_RECEIPT_INVALID", "canary inputs are cross-bound or stale");
  }
  let recoveryBinding;
  if (successorController) {
    const recoveryData = await readInputReceipt(
      options["--recovery-assurance-receipt"],
      repoRoot,
      "recovery assurance receipt",
    );
    validateSuccessorBackupBinding({
      receipt: backupData.receipt,
      sourceManifest,
      controllerManifest: manifest,
      expectedCommit,
      now,
    });
    validateSuccessorRecoveryBinding({
      repoRoot,
      recoveryReceiptPath: options["--recovery-assurance-receipt"],
      recoveryReceiptSha256: recoveryData.sha256,
      sourceManifest,
      controllerManifest: manifest,
      expectedCommit,
      outcome: outcomeData.receipt,
      backupReceipt: backupData.receipt,
      backupReceiptSha256: backupData.sha256,
      now,
      runtimeEvidenceValidator,
    });
    recoveryBinding = {
      recoveryAssuranceReceiptSha256: recoveryData.sha256,
    };
  } else {
    const hostedData = await readInputReceipt(
      options["--hosted-restore-receipt"],
      repoRoot,
      "hosted restore receipt",
    );
    validateBackupBinding(backupData.receipt, expectedCommit);
    if (hostedData.receipt.releaseCommit !== expectedCommit) {
      blocked("CANARY_INPUT_RECEIPT_INVALID", "canary inputs are cross-bound or stale");
    }
    recoveryBinding = {
      postExpandHostedRestoreReceiptSha256: hostedData.sha256,
    };
  }
  const external = manifest.finalizationContract.externalEvidence;
  return await collectCanaryEvidence({
    repoRoot,
    rawEvidencePath: options["--raw-out"],
    vercelServerErrorRawEvidencePath:
      options["--vercel-server-errors-raw-out"],
    receiptPath: options["--receipt-out"],
    deploymentReceipt: deployment,
    expectedHost: external.canary.productionHost,
    expectedCommit,
    observationWindowSeconds: external.canary.observationWindowSeconds,
    canaryMaximumAgeMinutes:
      manifest.finalizationContract.canaryMaximumAgeMinutes,
    now,
    baseReceipt: {
      receiptVersion: 1,
      kind: "production-write-fenced-canary",
      release: sourceManifest.release,
      projectRef: sourceManifest.projectRef,
      releaseCommit: expectedCommit,
      deploymentId: deployment.deploymentId,
      deploymentUrlSha256: deployment.deploymentUrlSha256,
      deploymentReceiptSha256: deploymentData.sha256,
      releaseOutcomeReceiptSha256: outcomeData.sha256,
      postExpandBackupReceiptSha256: backupData.sha256,
      ...recoveryBinding,
      containsSecrets: false,
    },
    browserRunner: (context) => runPlaywrightPublicCanaryObservation({
      origin: context.origin,
      expectedHost: context.expectedHost,
      executablePath: browserExecutable,
      now: context.now,
    }),
    authenticatedSessionRunner: (context) =>
      runSupabaseAuthenticatedSessionObservation({
        projectRef: context.projectRef,
        supabaseAnonKey: credentials.HANBANG_CANARY_SUPABASE_ANON_KEY,
        testEmail: credentials.HANBANG_CANARY_TEST_EMAIL,
        testPassword: credentials.HANBANG_CANARY_TEST_PASSWORD,
        now: context.now,
      }),
    databaseFenceRunner: (context) =>
      runProductionDatabaseFenceObservation({
        projectRef: context.projectRef,
        databaseUrl: credentials.HANBANG_PRODUCTION_DATABASE_URL,
        psql,
      }),
    vercelServerErrorRunner: (context) =>
      collectVercelServerErrorRawEvidence({
        vercelToken: credentials.VERCEL_TOKEN,
        teamId: external.vercel.teamId,
        projectId: external.vercel.projectId,
        deploymentId: deployment.deploymentId,
        observationStartedAt: context.observationStartedAt,
        observationCompletedAt: context.observationCompletedAt,
      }),
  });
}

export async function runExternalGateCollectorCli({
  repoRoot: requestedRepoRoot,
  argv = [],
  environment = process.env,
  now = () => new Date(),
  validateSuccessorContract = validateSuccessorReleaseContract,
  runtimeEvidenceValidator = validateSuccessorRuntimeEvidence,
  collectCanaryEvidence = collectProductionCanaryEvidence,
} = {}) {
  const parsed = parseArguments(argv);
  if (parsed.help) return { help: true };
  const repoRoot = resolve(requestedRepoRoot ?? process.cwd());
  const loaded = await loadManifest(repoRoot, { validateSuccessorContract });
  validateStatusSpecificArguments(parsed, loaded.successorController);
  const context = {
    repoRoot,
    manifest: loaded.manifest,
    sourceManifest: loaded.sourceManifest,
    successorController: loaded.successorController,
    options: parsed.options,
    environment,
    now,
    runtimeEvidenceValidator,
    collectCanaryEvidence,
  };
  if (parsed.mode === "vercel") return await collectVercelMode(context);
  if (parsed.mode === "hosted-restore") {
    return await collectHostedRestoreMode(context);
  }
  return await collectCanaryMode(context);
}

function usage() {
  return [
    "Collect hash-bound production gate evidence without secret command-line arguments.",
    "Modes: vercel | hosted-restore | canary",
    "Runbook: docs/operations/PRODUCTION_WRITE_FENCE_2026-07-17.md",
  ].join("\n");
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = await runExternalGateCollectorCli({
      repoRoot: resolve(import.meta.dirname, ".."),
      argv: process.argv.slice(2),
    });
    process.stdout.write(result.help
      ? `${usage()}\n`
      : `PRODUCTION_EXTERNAL_GATE_EVIDENCE_COLLECTED: ${result.kind}\n`);
  } catch (error) {
    const code = error instanceof ExternalGateCollectorCliError
        || error instanceof ExternalGateProvenanceError
      ? error.code
      : "UNEXPECTED";
    process.stderr.write(
      `PRODUCTION_EXTERNAL_GATE_EVIDENCE_BLOCKED [${code}]\n`,
    );
    process.exitCode = 1;
  }
}
