import { resolve } from "node:path";

import {
  captureProductionWriteFenceEvidence,
} from "./production-write-fence-evidence.mjs";
import {
  captureStorageSignedUploadDrainEvidence,
} from "./storage-signed-upload-drain-evidence.mjs";
import {
  validateSuccessorReleaseContract,
} from "./supabase-successor-release-contract.mjs";

const COMMIT = /^[a-f0-9]{40}$/u;
const RELEASE = /^[a-z][a-z0-9-]{2,80}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;

export class VendorDisclosureSuccessorStorageControlsError extends Error {
  constructor(code) {
    super(code);
    this.name = "VendorDisclosureSuccessorStorageControlsError";
    this.code = code;
  }
}

function fail(code) {
  throw new VendorDisclosureSuccessorStorageControlsError(code);
}

function loadController({ repoRoot, expectedCommit, releaseLoader }) {
  if (typeof repoRoot !== "string" || !COMMIT.test(expectedCommit ?? "")
      || typeof releaseLoader !== "function") {
    fail("SUCCESSOR_STORAGE_ARGUMENT_INVALID");
  }
  let state;
  try {
    state = releaseLoader({ repoRoot: resolve(repoRoot) });
  } catch {
    fail("SUCCESSOR_STORAGE_CONTROLLER_INVALID");
  }
  const manifest = state?.manifest;
  const controller = state?.controllerManifest;
  if (state?.deploymentBlocked !== false || state?.controllerReady !== true
      || manifest?.status !== "controller_ready"
      || !RELEASE.test(manifest?.release ?? "")
      || !PROJECT_REF.test(manifest?.projectRef ?? "")
      || controller?.release !== manifest.release
      || controller?.projectRef !== manifest.projectRef
      || !Array.isArray(controller?.manualPlatformOperations)
      || !controller.manualPlatformOperations.some((operation) =>
        operation?.id === "vendor-disclosure-successor-storage-write-freeze-v1"
        && operation?.phase === "pre-backup")
      || !controller.manualPlatformOperations.some((operation) =>
        operation?.id === "vendor-disclosure-successor-storage-final-convergence-v1"
        && operation?.phase === "post-push-pre-deploy")) {
    fail("SUCCESSOR_STORAGE_CONTROLLER_INVALID");
  }
  return controller;
}

export async function captureVendorDisclosureSuccessorStorageDrainEvidence({
  releaseLoader = validateSuccessorReleaseContract,
  captureImpl = captureStorageSignedUploadDrainEvidence,
  ...input
}) {
  if (typeof captureImpl !== "function") fail("SUCCESSOR_STORAGE_ARGUMENT_INVALID");
  const releaseManifest = loadController({ ...input, releaseLoader });
  return await captureImpl({ ...input, releaseManifest });
}

export async function captureVendorDisclosureSuccessorWriteFenceEvidence({
  releaseLoader = validateSuccessorReleaseContract,
  captureImpl = captureProductionWriteFenceEvidence,
  ...input
}) {
  if (typeof captureImpl !== "function") fail("SUCCESSOR_STORAGE_ARGUMENT_INVALID");
  const releaseManifest = loadController({ ...input, releaseLoader });
  return await captureImpl({ ...input, releaseManifest });
}
