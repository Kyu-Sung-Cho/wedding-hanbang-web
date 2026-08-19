import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  validateSuccessorReleaseContract,
} from "./supabase-successor-release-contract.mjs";

const PREDECESSOR_MANIFEST_PATH =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const SUCCESSOR_MANIFEST_PATH =
  "supabase/release-manifests/vendor-disclosure-v2-20260718.json";
const MAX_JSON_BYTES = 64 * 1024;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const LOWER_SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const SAFE_ID = /^[a-z][a-z0-9-]{2,63}$/;
const BACKUP_SET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export class PostPushEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "PostPushEvidenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new PostPushEvidenceError(code);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
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

function canonicalTextHash(content) {
  return createHash("sha256")
    .update(content.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function validOperationFile(operation, successor) {
  if (successor) {
    return operation?.id === "vendor-disclosure-successor-storage-final-convergence-v1"
      && operation?.file
        === "supabase/platform-operations/storage/20260819102000_vendor_disclosure_successor_storage_final_convergence.operation.json";
  }
  return /^supabase\/platform-operations\/(?:security|storage)\/[a-z0-9][a-z0-9_.-]*\.sql$/.test(
    operation?.file ?? "",
  );
}

async function loadReleaseManifest(repoRoot) {
  const successorPath = resolve(repoRoot, SUCCESSOR_MANIFEST_PATH);
  const successorMetadata = await lstat(successorPath).catch(() => null);
  if (successorMetadata !== null) {
    if (!successorMetadata.isFile() || successorMetadata.isSymbolicLink()) {
      fail("POST_PUSH_EVIDENCE_MANIFEST_INVALID");
    }
    try {
      const validated = validateSuccessorReleaseContract({ repoRoot });
      if (!validated.controllerReady) fail("POST_PUSH_EVIDENCE_MANIFEST_INVALID");
      return { manifest: validated.controllerManifest, successor: true };
    } catch (error) {
      if (error instanceof PostPushEvidenceError) throw error;
      fail("POST_PUSH_EVIDENCE_MANIFEST_INVALID");
    }
  }
  return {
    manifest: await readBoundedJson(
      resolve(repoRoot, PREDECESSOR_MANIFEST_PATH),
      "POST_PUSH_EVIDENCE_MANIFEST_INVALID",
    ),
    successor: false,
  };
}

async function rawFileSha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
    .toUpperCase();
}

function validateSiteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("POST_PUSH_EVIDENCE_SITE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password
      || (url.pathname !== "/" && url.pathname !== "")
      || url.search || url.hash) {
    fail("POST_PUSH_EVIDENCE_SITE_URL_INVALID");
  }
  return url;
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

export async function capturePostPushPlatformEvidence({
  repoRoot,
  expectedCommit,
  backupReceiptPath,
  awaitingOutcomePath,
  receiptOut,
  confirmOperations,
  siteUrl,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const absoluteRepoRoot = resolve(repoRoot);
  if (!COMMIT.test(expectedCommit ?? "")
      || !isAbsolute(backupReceiptPath)
      || !isAbsolute(awaitingOutcomePath)
      || !isAbsolute(receiptOut)
      || inside(absoluteRepoRoot, backupReceiptPath)
      || inside(absoluteRepoRoot, awaitingOutcomePath)
      || inside(absoluteRepoRoot, receiptOut)
      || typeof fetchImpl !== "function") {
    fail("POST_PUSH_EVIDENCE_ARGUMENT_INVALID");
  }
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (typeof token !== "string" || token.length < 20) {
    fail("POST_PUSH_EVIDENCE_AUTH_TOKEN_REQUIRED");
  }
  const productionUrl = validateSiteUrl(siteUrl);
  const { manifest, successor } = await loadReleaseManifest(absoluteRepoRoot);
  const operations = Array.isArray(manifest.manualPlatformOperations)
    ? manifest.manualPlatformOperations.filter(
      (operation) => operation?.phase === "post-push-pre-deploy",
    )
    : [];
  if (!PROJECT_REF.test(manifest.projectRef ?? "")
      || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(manifest.release ?? "")
      || operations.length === 0
      || manifest.manualControlEvidence?.maximumAgeMinutes !== 30
      || manifest.manualControlEvidence?.signedUploadTokenTtlMinutes !== 120
      || manifest.manualControlEvidence?.signedUploadGraceMinutes !== 10
      || manifest.manualControlEvidence?.storageStabilityWindowMinutes !== 5
      || !/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
        manifest.manualControlEvidence?.storageDrainReceiptFileName ?? "",
      )
      || !/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
        manifest.manualControlEvidence?.postPushReceiptFileName ?? "",
      )) {
    fail("POST_PUSH_EVIDENCE_MANIFEST_INVALID");
  }
  const expectedReceiptOut = resolve(
    dirname(backupReceiptPath),
    manifest.manualControlEvidence.postPushReceiptFileName,
  );
  if (resolve(receiptOut) !== expectedReceiptOut
      || dirname(resolve(receiptOut)) !== resolve(dirname(backupReceiptPath))) {
    fail("POST_PUSH_EVIDENCE_ARGUMENT_INVALID");
  }
  const receiptParent = await lstat(dirname(receiptOut)).catch(() => null);
  if (!receiptParent?.isDirectory() || receiptParent.isSymbolicLink()) {
    fail("POST_PUSH_EVIDENCE_ARGUMENT_INVALID");
  }

  const operationReceipts = [];
  for (const operation of operations) {
    if (!SAFE_ID.test(operation?.id ?? "")
        || !SAFE_ID.test(operation?.verificationCheckId ?? "")
        || typeof operation.file !== "string"
        || !validOperationFile(operation, successor)
        || !LOWER_SHA256.test(operation.sha256 ?? "")) {
      fail("POST_PUSH_EVIDENCE_MANIFEST_INVALID");
    }
    const operationPath = resolve(absoluteRepoRoot, operation.file);
    const operationMetadata = await lstat(operationPath).catch(() => null);
    if (!inside(absoluteRepoRoot, operationPath)
        || !operationMetadata?.isFile()
        || operationMetadata.isSymbolicLink()
        || canonicalTextHash(await readFile(operationPath, "utf8")) !== operation.sha256) {
      fail("POST_PUSH_EVIDENCE_ARTIFACT_INVALID");
    }
    operationReceipts.push({
      operationId: operation.id,
      verificationCheckId: operation.verificationCheckId,
      applyArtifactSha256: operation.sha256,
      verified: true,
    });
  }
  if (confirmOperations !== operations.map((operation) => operation.id).join(",")) {
    fail("POST_PUSH_EVIDENCE_CONFIRMATION_MISMATCH");
  }

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
    fail("POST_PUSH_EVIDENCE_AUTH_NOT_VERIFIED");
  }
  const authConfig = await boundedResponseJson(
    authResponse,
    "POST_PUSH_EVIDENCE_AUTH_NOT_VERIFIED",
  );
  if (authResponse.status !== 200 || authConfig.disable_signup !== true) {
    fail("POST_PUSH_EVIDENCE_AUTH_NOT_VERIFIED");
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
    fail("POST_PUSH_EVIDENCE_WEB_NOT_VERIFIED");
  }
  const webBody = await boundedResponseJson(
    webResponse,
    "POST_PUSH_EVIDENCE_WEB_NOT_VERIFIED",
  );
  if (webResponse.status !== 503
      || webBody.error !== "production_write_fence_enabled"
      || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(webResponse.headers.get("cache-control") ?? "")
      || webResponse.headers.get("x-hanbang-deployment-commit") !== expectedCommit) {
    fail("POST_PUSH_EVIDENCE_WEB_NOT_VERIFIED");
  }

  const backupReceipt = await readBoundedJson(
    backupReceiptPath,
    "POST_PUSH_EVIDENCE_BACKUP_INVALID",
  );
  if (backupReceipt.Verified !== true
      || backupReceipt.GitCommit !== expectedCommit
      || !BACKUP_SET_ID.test(backupReceipt.BackupSetId ?? "")
      || !UPPER_SHA256.test(backupReceipt.ManifestSha256 ?? "")) {
    fail("POST_PUSH_EVIDENCE_BACKUP_INVALID");
  }
  const awaitingOutcome = await readBoundedJson(
    awaitingOutcomePath,
    "POST_PUSH_EVIDENCE_AWAITING_OUTCOME_INVALID",
  );
  const expectedOperationIds = operations.map((operation) => operation.id);
  if (awaitingOutcome.status !== "awaiting_manual_post_push_operations"
      || awaitingOutcome.release !== manifest.release
      || awaitingOutcome.projectRef !== manifest.projectRef
      || awaitingOutcome.releaseCommit !== expectedCommit
      || awaitingOutcome.backupSetId !== backupReceipt.BackupSetId
      || awaitingOutcome.backupManifestSha256 !== backupReceipt.ManifestSha256
      || awaitingOutcome.rerunProhibited !== true
      || awaitingOutcome.containsSecrets !== false
      || !Array.isArray(awaitingOutcome.pendingManualOperationIds)
      || awaitingOutcome.pendingManualOperationIds.length !== expectedOperationIds.length
      || awaitingOutcome.pendingManualOperationIds.some(
        (id, index) => id !== expectedOperationIds[index],
      )) {
    fail("POST_PUSH_EVIDENCE_AWAITING_OUTCOME_INVALID");
  }
  const verifiedAt = now();
  if (!(verifiedAt instanceof Date) || !Number.isFinite(verifiedAt.getTime())) {
    fail("POST_PUSH_EVIDENCE_CLOCK_INVALID");
  }
  const receipt = {
    receiptVersion: 1,
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    backupSetId: backupReceipt.BackupSetId,
    backupManifestSha256: backupReceipt.ManifestSha256,
    awaitingOutcomeReceiptSha256: await rawFileSha256(awaitingOutcomePath),
    verifiedAt: verifiedAt.toISOString(),
    controls: {
      vercelProductionWriteFenceEnabled: true,
      vercelDeploymentCommit: expectedCommit,
      supabaseAuthSignupDisabled: true,
    },
    operations: operationReceipts,
    containsSensitiveValues: false,
  };
  try {
    await writeFile(receiptOut, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    fail("POST_PUSH_EVIDENCE_OUTPUT_FAILED");
  }
  return {
    status: "post_push_platform_evidence_captured",
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    backupSetId: backupReceipt.BackupSetId,
    awaitingOutcomeReceiptSha256: receipt.awaitingOutcomeReceiptSha256,
    operationIds: expectedOperationIds,
    verifiedAt: receipt.verifiedAt,
    containsSensitiveValues: false,
  };
}

export const postPushPlatformEvidenceTestHooks = Object.freeze({
  validOperationFile,
});
