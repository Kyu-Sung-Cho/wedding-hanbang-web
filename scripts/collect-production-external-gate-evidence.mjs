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

const MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const COMMIT = /^[a-f0-9]{40}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const PROVIDER_RESTORE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;
const COMMON_ARGUMENTS = new Set(["--mode", "--expected-commit"]);
const MODE_ARGUMENTS = Object.freeze({
  vercel: new Set([
    "--deployment-id",
    "--raw-out",
    "--receipt-out",
  ]),
  "hosted-restore": new Set([
    "--backup-receipt",
    "--target-project-ref",
    "--target-project-name",
    "--provider-restore-job-id",
    "--restore-completed-at",
    "--psql",
    "--project-raw-out",
    "--database-raw-out",
    "--receipt-out",
  ]),
  canary: new Set([
    "--deployment-receipt",
    "--release-outcome",
    "--backup-receipt",
    "--hosted-restore-receipt",
    "--browser-executable",
    "--psql",
    "--raw-out",
    "--vercel-server-errors-raw-out",
    "--receipt-out",
  ]),
});

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
  const options = {};
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
  const allowed = MODE_ARGUMENTS[mode];
  if (!allowed) blocked("MODE_INVALID", "mode must be vercel, hosted-restore or canary");
  const expected = new Set([...COMMON_ARGUMENTS, ...allowed]);
  if (Object.keys(options).some((name) => !expected.has(name))
      || [...expected].some((name) => !options[name])) {
    blocked("ARGUMENT_INVALID", "mode requires its exact non-secret argument set");
  }
  if (!COMMIT.test(options["--expected-commit"])) {
    blocked("EXPECTED_COMMIT_INVALID", "expected commit must be lowercase 40-hex");
  }
  return { help: false, mode, options };
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

async function loadManifest(repoRoot) {
  const path = resolve(repoRoot, MANIFEST_RELATIVE_PATH);
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
  return manifest;
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

async function collectCanaryMode({ repoRoot, manifest, options, environment }) {
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
  const hostedData = await readInputReceipt(
    options["--hosted-restore-receipt"],
    repoRoot,
    "hosted restore receipt",
  );
  validateBackupBinding(
    backupData.receipt,
    options["--expected-commit"],
  );
  const deployment = deploymentData.receipt;
  if (deployment.release !== manifest.release
      || deployment.projectRef !== manifest.projectRef
      || deployment.releaseCommit !== options["--expected-commit"]
      || deployment.readyState !== "READY"
      || hostedData.receipt.releaseCommit !== options["--expected-commit"]
      || outcomeData.receipt.releaseCommit !== options["--expected-commit"]) {
    blocked("CANARY_INPUT_RECEIPT_INVALID", "canary inputs are cross-bound or stale");
  }
  const external = manifest.finalizationContract.externalEvidence;
  return await collectProductionCanaryEvidence({
    repoRoot,
    rawEvidencePath: options["--raw-out"],
    vercelServerErrorRawEvidencePath:
      options["--vercel-server-errors-raw-out"],
    receiptPath: options["--receipt-out"],
    deploymentReceipt: deployment,
    expectedHost: external.canary.productionHost,
    expectedCommit: options["--expected-commit"],
    observationWindowSeconds: external.canary.observationWindowSeconds,
    canaryMaximumAgeMinutes:
      manifest.finalizationContract.canaryMaximumAgeMinutes,
    baseReceipt: {
      receiptVersion: 1,
      kind: "production-write-fenced-canary",
      release: manifest.release,
      projectRef: manifest.projectRef,
      releaseCommit: options["--expected-commit"],
      deploymentId: deployment.deploymentId,
      deploymentUrlSha256: deployment.deploymentUrlSha256,
      deploymentReceiptSha256: deploymentData.sha256,
      releaseOutcomeReceiptSha256: outcomeData.sha256,
      postExpandBackupReceiptSha256: backupData.sha256,
      postExpandHostedRestoreReceiptSha256: hostedData.sha256,
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
} = {}) {
  const parsed = parseArguments(argv);
  if (parsed.help) return { help: true };
  const repoRoot = resolve(requestedRepoRoot ?? process.cwd());
  const manifest = await loadManifest(repoRoot);
  const context = {
    repoRoot,
    manifest,
    options: parsed.options,
    environment,
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
      : "PRODUCTION_EXTERNAL_GATE_EVIDENCE_COLLECTED\n");
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
