import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { validateCompletedStorageDrainEvidence } from "./storage-signed-upload-drain-evidence.mjs";
import {
  ExtendedReleaseContractError,
  validateAmoraExtendedReleaseContracts,
} from "./amora-release-extended-contracts.mjs";

const MANIFEST_PATH = "supabase/release-manifests/amora-engine-v2-20260716.json";
const MAX_JSON_BYTES = 64 * 1024;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const BACKUP_SET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export class WriteFenceEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "WriteFenceEvidenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new WriteFenceEvidenceError(code);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function canonicalTextHash(content) {
  return createHash("sha256")
    .update(content.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

async function readBoundedJson(path, code) {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()
      || metadata.size < 2 || metadata.size > MAX_JSON_BYTES) {
    fail(code);
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(code);
  }
}

async function boundedResponseJson(response, code) {
  const text = await response.text();
  if (text.length < 2 || text.length > MAX_JSON_BYTES) fail(code);
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
}

function validateSiteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("WRITE_FENCE_EVIDENCE_SITE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password
      || (url.pathname !== "/" && url.pathname !== "")
      || url.search || url.hash) {
    fail("WRITE_FENCE_EVIDENCE_SITE_URL_INVALID");
  }
  return url;
}

export async function captureProductionWriteFenceEvidence({
  repoRoot,
  expectedCommit,
  backupReceiptPath,
  receiptOut,
  siteUrl,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const absoluteRepoRoot = resolve(repoRoot);
  if (!COMMIT.test(expectedCommit ?? "")
      || !isAbsolute(backupReceiptPath)
      || !isAbsolute(receiptOut)
      || inside(absoluteRepoRoot, backupReceiptPath)
      || inside(absoluteRepoRoot, receiptOut)) {
    fail("WRITE_FENCE_EVIDENCE_ARGUMENT_INVALID");
  }
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (typeof token !== "string" || token.length < 20 || typeof fetchImpl !== "function") {
    fail("WRITE_FENCE_EVIDENCE_AUTH_TOKEN_REQUIRED");
  }
  const productionUrl = validateSiteUrl(siteUrl);
  const manifest = await readBoundedJson(
    resolve(absoluteRepoRoot, MANIFEST_PATH),
    "WRITE_FENCE_EVIDENCE_MANIFEST_INVALID",
  );
  let extendedContracts;
  try {
    extendedContracts = validateAmoraExtendedReleaseContracts(manifest);
  } catch (error) {
    if (error instanceof ExtendedReleaseContractError) {
      fail("WRITE_FENCE_EVIDENCE_MANIFEST_INVALID");
    }
    throw error;
  }
  const postPushOperationCount = Array.isArray(manifest.manualPlatformOperations)
    ? manifest.manualPlatformOperations.filter(
      (operation) => operation?.phase === "post-push-pre-deploy",
    ).length
    : 0;
  const expectedControlKeys = postPushOperationCount > 0
    ? [
      "maximumAgeMinutes",
      "postPushReceiptFileName",
      "receiptFileName",
      "signedUploadGraceMinutes",
      "signedUploadTokenTtlMinutes",
      "storageDrainReceiptFileName",
      "storageStabilityWindowMinutes",
    ]
    : [
      "maximumAgeMinutes",
      "receiptFileName",
      "signedUploadGraceMinutes",
      "signedUploadTokenTtlMinutes",
      "storageDrainReceiptFileName",
      "storageStabilityWindowMinutes",
    ];
  const actualControlKeys = manifest.manualControlEvidence
    && typeof manifest.manualControlEvidence === "object"
    && !Array.isArray(manifest.manualControlEvidence)
    ? Object.keys(manifest.manualControlEvidence).sort()
    : [];
  if (!PROJECT_REF.test(manifest.projectRef ?? "")
      || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(manifest.release ?? "")
      || !Array.isArray(manifest.manualPlatformOperations)
      || manifest.manualPlatformOperations.length === 0
      || JSON.stringify(actualControlKeys) !== JSON.stringify(expectedControlKeys)
      || manifest.manualControlEvidence?.maximumAgeMinutes !== 30
      || manifest.manualControlEvidence?.signedUploadTokenTtlMinutes !== 120
      || manifest.manualControlEvidence?.signedUploadGraceMinutes !== 10
      || manifest.manualControlEvidence?.storageStabilityWindowMinutes !== 5
      || manifest.backupContract?.providerPhysicalBackup?.maximumAgeHours !== 26
      || manifest.backupContract?.providerPhysicalBackup?.requiredStatus !== "COMPLETED"
      || manifest.backupContract?.providerPhysicalBackup?.requirePhysicalBackup !== true
      || manifest.backupContract?.providerPhysicalBackup?.restoreCapability
        !== "completed-physical-backup"
      || !/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
        manifest.manualControlEvidence?.receiptFileName ?? "",
      )
      || !/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
        manifest.manualControlEvidence?.storageDrainReceiptFileName ?? "",
      )) {
    fail("WRITE_FENCE_EVIDENCE_MANIFEST_INVALID");
  }
  const expectedReceiptOut = resolve(
    dirname(backupReceiptPath),
    manifest.manualControlEvidence.receiptFileName,
  );
  if (resolve(receiptOut) !== expectedReceiptOut) {
    fail("WRITE_FENCE_EVIDENCE_ARGUMENT_INVALID");
  }
  const receiptParent = await lstat(dirname(receiptOut)).catch(() => null);
  if (!receiptParent?.isDirectory() || receiptParent.isSymbolicLink()) {
    fail("WRITE_FENCE_EVIDENCE_ARGUMENT_INVALID");
  }

  const backupReceipt = await readBoundedJson(
    backupReceiptPath,
    "WRITE_FENCE_EVIDENCE_BACKUP_INVALID",
  );
  if (backupReceipt.Verified !== true
      || backupReceipt.GitCommit !== expectedCommit
      || !BACKUP_SET_ID.test(backupReceipt.BackupSetId ?? "")
      || !UPPER_SHA256.test(backupReceipt.ManifestSha256 ?? "")
      || !Number.isFinite(Date.parse(backupReceipt.SourceCapturedAt ?? ""))
      || !Number.isFinite(Date.parse(backupReceipt.CreatedAtUtc ?? ""))) {
    fail("WRITE_FENCE_EVIDENCE_BACKUP_INVALID");
  }

  const verifiedAt = now();
  if (!(verifiedAt instanceof Date) || !Number.isFinite(verifiedAt.getTime())) {
    fail("WRITE_FENCE_EVIDENCE_CLOCK_INVALID");
  }

  let storageDrain;
  try {
    storageDrain = await validateCompletedStorageDrainEvidence({
      repoRoot: absoluteRepoRoot,
      receiptDirectory: dirname(backupReceiptPath),
      manifest,
      expectedCommit,
      now: () => verifiedAt,
      backupSourceCapturedAt: backupReceipt.SourceCapturedAt,
      backupCreatedAt: backupReceipt.CreatedAtUtc,
    });
  } catch {
    fail("WRITE_FENCE_EVIDENCE_STORAGE_DRAIN_INVALID");
  }

  let providerBackupResponse;
  try {
    providerBackupResponse = await fetchImpl(
      `https://api.supabase.com/v1/projects/${manifest.projectRef}/database/backups`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    fail("WRITE_FENCE_EVIDENCE_PROVIDER_BACKUP_NOT_VERIFIED");
  }
  const providerBackupBody = await boundedResponseJson(
    providerBackupResponse,
    "WRITE_FENCE_EVIDENCE_PROVIDER_BACKUP_NOT_VERIFIED",
  );
  const providerContract = manifest.backupContract.providerPhysicalBackup;
  const physicalBackups = Array.isArray(providerBackupBody.backups)
    ? providerBackupBody.backups
      .filter((backup) =>
        backup?.is_physical_backup === providerContract.requirePhysicalBackup
        && backup?.status === providerContract.requiredStatus
        && Number.isFinite(Date.parse(backup?.inserted_at ?? "")))
      .sort((left, right) => Date.parse(right.inserted_at) - Date.parse(left.inserted_at))
    : [];
  const candidate = physicalBackups[0];
  const latestPhysicalUnix = providerBackupBody.physical_backup_data
    ?.latest_physical_backup_date_unix;
  const candidateMs = Date.parse(candidate?.inserted_at ?? "");
  const latestPhysicalMs = Number.isSafeInteger(latestPhysicalUnix)
    ? latestPhysicalUnix * 1000
    : Number.NaN;
  const providerBackupAgeSeconds = Math.floor(
    (verifiedAt.getTime() - latestPhysicalMs) / 1000,
  );
  if (providerBackupResponse.status !== 200
      || !candidate
      || !Number.isSafeInteger(latestPhysicalUnix)
      || latestPhysicalUnix < 1_500_000_000
      || latestPhysicalUnix > 5_000_000_000
      || !Number.isFinite(candidateMs)
      || Math.abs(candidateMs - latestPhysicalMs) > 15 * 60_000
      || !Number.isSafeInteger(providerBackupAgeSeconds)
      || providerBackupAgeSeconds < 0
      || providerBackupAgeSeconds > providerContract.maximumAgeHours * 3600) {
    fail("WRITE_FENCE_EVIDENCE_PROVIDER_BACKUP_NOT_VERIFIED");
  }
  const providerPhysicalBackup = {
    status: candidate.status,
    isPhysicalBackup: candidate.is_physical_backup,
    insertedAt: new Date(candidateMs).toISOString(),
    latestPhysicalBackupDateUnix: latestPhysicalUnix,
    ageSeconds: providerBackupAgeSeconds,
    restoreCandidateAvailable: true,
  };

  let authResponse;
  try {
    authResponse = await fetchImpl(
      `https://api.supabase.com/v1/projects/${manifest.projectRef}/config/auth`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    fail("WRITE_FENCE_EVIDENCE_AUTH_NOT_VERIFIED");
  }
  const authConfig = await boundedResponseJson(
    authResponse,
    "WRITE_FENCE_EVIDENCE_AUTH_NOT_VERIFIED",
  );
  if (authResponse.status !== 200 || authConfig.disable_signup !== true) {
    fail("WRITE_FENCE_EVIDENCE_AUTH_NOT_VERIFIED");
  }

  let webResponse;
  try {
    webResponse = await fetchImpl(
      new URL("/api/release/write-fence-probe", productionUrl),
      {
        method: "POST",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    fail("WRITE_FENCE_EVIDENCE_WEB_NOT_VERIFIED");
  }
  const webBody = await boundedResponseJson(
    webResponse,
    "WRITE_FENCE_EVIDENCE_WEB_NOT_VERIFIED",
  );
  if (webResponse.status !== 503
      || webBody.error !== "production_write_fence_enabled"
      || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(webResponse.headers.get("cache-control") ?? "")
      || webResponse.headers.get("x-hanbang-deployment-commit") !== expectedCommit) {
    fail("WRITE_FENCE_EVIDENCE_WEB_NOT_VERIFIED");
  }

  const operations = manifest.manualPlatformOperations
    .filter((operation) => operation?.phase === "pre-backup")
    .map((operation) => {
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(operation?.id ?? "")
        || operation.phase !== "pre-backup"
        || !/^[a-z][a-z0-9-]{2,63}$/.test(operation.verificationCheckId ?? "")
        || !/^[a-f0-9]{64}$/.test(operation.sha256 ?? "")) {
      fail("WRITE_FENCE_EVIDENCE_MANIFEST_INVALID");
    }
    return {
      operationId: operation.id,
      verificationCheckId: operation.verificationCheckId,
      applyArtifactSha256: operation.sha256,
      verified: true,
    };
    });
  if (operations.length === 0) {
    fail("WRITE_FENCE_EVIDENCE_MANIFEST_INVALID");
  }
  const forwardOnlySecurityOperations = [];
  for (const operation of extendedContracts.forwardOnlySecurityOperations) {
    for (const artifact of [operation.inventory, operation.apply, operation.verify]) {
      const path = resolve(absoluteRepoRoot, artifact.file);
      const metadata = await lstat(path).catch(() => null);
      if (!inside(absoluteRepoRoot, path)
          || !metadata?.isFile()
          || metadata.isSymbolicLink()
          || canonicalTextHash(await readFile(path, "utf8")) !== artifact.sha256) {
        fail("WRITE_FENCE_EVIDENCE_MANIFEST_INVALID");
      }
    }
    forwardOnlySecurityOperations.push({
      operationId: operation.id,
      verificationCheckId: operation.verificationCheckId,
      inventoryArtifactSha256: operation.inventory.sha256,
      applyArtifactSha256: operation.apply.sha256,
      verifyArtifactSha256: operation.verify.sha256,
      expectedEvidence: operation.verify.expectedEvidence,
      rollbackPolicy: operation.rollbackPolicy,
      verified: true,
    });
  }
  const receipt = {
    receiptVersion: 1,
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    backupSetId: backupReceipt.BackupSetId,
    backupManifestSha256: backupReceipt.ManifestSha256,
    verifiedAt: verifiedAt.toISOString(),
    controls: {
      vercelProductionWriteFenceEnabled: true,
      vercelDeploymentCommit: expectedCommit,
      supabaseAuthSignupDisabled: true,
    },
    providerPhysicalBackup,
    storageSignedUploadDrain: {
      receiptSha256: storageDrain.sha256,
      startReceiptSha256: storageDrain.startReceiptSha256,
      freezeVerifiedAt: storageDrain.freezeVerifiedAt,
      preBackupControls: storageDrain.controls,
      databaseWriteFence: storageDrain.databaseWriteFence,
      firstStableSnapshotAt: storageDrain.firstStableSnapshotAt,
      secondStableSnapshotAt: storageDrain.secondStableSnapshotAt,
      totalObjectCount: storageDrain.totalObjectCount,
      objectInventorySha256: storageDrain.objectInventorySha256,
      mutationPolicyCount: storageDrain.mutationPolicyCount,
    },
    operations,
    forwardOnlySecurityOperations,
    containsSensitiveValues: false,
  };
  try {
    await writeFile(receiptOut, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    fail("WRITE_FENCE_EVIDENCE_OUTPUT_FAILED");
  }

  return {
    status: "write_fence_evidence_captured",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    backupSetId: backupReceipt.BackupSetId,
    operationCount: operations.length,
    forwardOnlySecurityOperationCount:
      forwardOnlySecurityOperations.length,
    storageDrainReceiptSha256: storageDrain.sha256,
    storageDrainSecondStableSnapshotAt: storageDrain.secondStableSnapshotAt,
    verifiedAt: receipt.verifiedAt,
    containsSensitiveValues: false,
  };
}
