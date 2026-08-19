import assert from "node:assert/strict";
import test from "node:test";

import {
  captureVendorDisclosureSuccessorStorageDrainEvidence,
  captureVendorDisclosureSuccessorWriteFenceEvidence,
  VendorDisclosureSuccessorStorageControlsError,
} from "../lib/vendor-disclosure-successor-storage-controls.mjs";

const controllerManifest = {
  release: "vendor-disclosure-successor-test",
  projectRef: "abcdefghijklmnopqrst",
  manualPlatformOperations: [{
    id: "vendor-disclosure-successor-storage-write-freeze-v1",
    phase: "pre-backup",
  }, {
    id: "vendor-disclosure-successor-storage-final-convergence-v1",
    phase: "post-push-pre-deploy",
  }],
};

function readyState() {
  return {
    deploymentBlocked: false,
    controllerReady: true,
    manifest: {
      release: controllerManifest.release,
      projectRef: controllerManifest.projectRef,
      status: "controller_ready",
    },
    controllerManifest,
  };
}

test("successor drain and fence wrappers always inject the exact controller manifest", async () => {
  for (const [capture, invoke] of [
    [captureVendorDisclosureSuccessorStorageDrainEvidence, "drain"],
    [captureVendorDisclosureSuccessorWriteFenceEvidence, "write-fence"],
  ]) {
    let received;
    const result = await capture({
      repoRoot: "C:/repo",
      expectedCommit: "a".repeat(40),
      releaseLoader: () => readyState(),
      captureImpl: async (input) => {
        received = input;
        return { status: invoke };
      },
    });
    assert.equal(result.status, invoke);
    assert.equal(received.releaseManifest, controllerManifest);
    assert.equal(received.expectedCommit, "a".repeat(40));
  }
});

test("successor wrappers reject blocked or identity-drifted controller state", async () => {
  for (const state of [
    { ...readyState(), controllerReady: false, deploymentBlocked: true },
    {
      ...readyState(),
      controllerManifest: { ...controllerManifest, projectRef: "z".repeat(20) },
    },
    {
      ...readyState(),
      controllerManifest: {
        ...controllerManifest,
        manualPlatformOperations: [controllerManifest.manualPlatformOperations[0]],
      },
    },
  ]) {
    await assert.rejects(
      captureVendorDisclosureSuccessorStorageDrainEvidence({
        repoRoot: "C:/repo",
        expectedCommit: "a".repeat(40),
        releaseLoader: () => state,
        captureImpl: async () => ({ status: "must-not-run" }),
      }),
      (error) => error instanceof VendorDisclosureSuccessorStorageControlsError
        && error.code === "SUCCESSOR_STORAGE_CONTROLLER_INVALID",
    );
  }
});
