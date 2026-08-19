import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT,
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
} from "../lib/supabase-successor-release-contract.mjs";
import { SUCCESSOR_FINALIZER_EXTERNAL_EVIDENCE_CONTRACT } from
  "../lib/amora-release-extended-contracts.mjs";
import {
  SuccessorControllerGeneratorError,
  assertSuccessorControllerWriteRepository,
  commitSuccessorControllerArtifacts,
  renderSuccessorControllerArtifacts,
  runSuccessorControllerGenerator,
  validateRenderedSuccessorControllerArtifacts,
} from "../generate-vendor-disclosure-successor-controller.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

function canonicalTextSha256(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), "utf8"));
}

test("renders the exact no-cost controller-ready contract from repository sources", () => {
  const result = renderSuccessorControllerArtifacts({ repoRoot: REPO_ROOT });
  const predecessor = readJson(
    "supabase/release-manifests/amora-engine-v2-20260716.json",
  );
  const blocked = readJson(
    "supabase/release-manifests/vendor-disclosure-v2-20260718.json",
  );

  assert.equal(result.contract.release, blocked.release);
  assert.equal(result.contract.projectRef, blocked.projectRef);
  assert.deepEqual(result.contract.historicalEffectAudit, predecessor.historicalEffectAudit);
  assert.deepEqual(result.contract.requiredDocuments, predecessor.requiredDocuments);
  assert.deepEqual(
    result.contract.recoveryAssuranceContract,
    SUCCESSOR_NO_ADDITIONAL_COST_RECOVERY_CONTRACT,
  );
  assert.deepEqual(
    result.contract.finalizationContract.externalEvidence,
    SUCCESSOR_FINALIZER_EXTERNAL_EVIDENCE_CONTRACT,
  );
  assert.deepEqual(
    [
      result.contract.preApplyChecks.length,
      result.contract.postPushChecks.length,
      result.contract.postApplyChecks.length,
    ],
    [3, 1, 1],
  );
  assert.equal(result.contract.manualPlatformOperations.length, 4);
  assert.equal(result.contract.rollbackArtifacts.length, 4);
  assert.deepEqual(result.contract.forwardOnlySecurityOperations, []);

  assert.deepEqual(
    result.contract.postExpandBackupContract.expectedReleaseMigrationVersions,
    blocked.expandMigrations.map((entry) => entry.file.slice(0, 14)),
  );
  assert.equal(
    result.contract.postApplyChecks[0].expectedEvidence.successor_created_table_count,
    result.createdPublicTables.length,
  );
  assert.equal(
    result.contract.postExpandBackupContract.expectedTableCount,
    result.contract.postExpandBackupContract.expectedTables.length,
  );

  for (const pin of [
    result.contract.backupContract.capture,
    ...result.contract.backupContract.dependencies,
    result.contract.backupContract.verifier,
    result.contract.postExpandBackupContract.common,
    result.contract.postExpandBackupContract.capture,
    result.contract.postExpandBackupContract.verifier,
  ]) {
    assert.equal(
      pin.sha256,
      canonicalTextSha256(readFileSync(resolve(REPO_ROOT, pin.file), "utf8")),
      pin.file,
    );
  }

  assert.equal(result.manifest.status, "controller_ready");
  assert.deepEqual(Object.keys(result.manifest.deploymentEvidence), [
    "backup",
    "finalizer",
    "hostedStaging",
    "recoveryAssurance",
    "storage",
  ]);
  assert.deepEqual(
    result.manifest.deploymentEvidence.recoveryAssurance.releaseAssurance,
    SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.recoveryAssurance.releaseAssurance,
  );
  assert.equal(result.manifest.controllerContract.sha256, result.controllerSha256);
  assert.doesNotMatch(result.controllerText, /"hostedRestore"\s*:/);
  assert.doesNotMatch(result.controllerText, /hostedRestoreEvidence/);
  assert.doesNotMatch(result.manifestText, /"hostedRestore"\s*:/);
});

test("rendering is deterministic and emits canonical LF JSON", () => {
  const first = renderSuccessorControllerArtifacts({ repoRoot: REPO_ROOT });
  const second = renderSuccessorControllerArtifacts({ repoRoot: REPO_ROOT });

  assert.equal(first.controllerText, second.controllerText);
  assert.equal(first.manifestText, second.manifestText);
  assert.equal(first.controllerSha256, canonicalTextSha256(first.controllerText));
  assert.equal(first.controllerText.endsWith("\n"), true);
  assert.equal(first.manifestText.endsWith("\n"), true);
  assert.equal(first.controllerText.includes("\r"), false);
  assert.equal(first.manifestText.includes("\r"), false);
});

test("rendered artifacts pass the central successor and extended validators without writes", () => {
  const artifacts = renderSuccessorControllerArtifacts({ repoRoot: REPO_ROOT });
  const result = validateRenderedSuccessorControllerArtifacts({
    repoRoot: REPO_ROOT,
    artifacts,
  });

  assert.equal(result.controllerReady, true);
  assert.equal(result.deploymentBlocked, false);
  assert.equal(result.controllerManifest.preApplyChecks.length, 3);
  assert.equal(result.controllerManifest.postPushChecks.length, 1);
  assert.equal(result.controllerManifest.postApplyChecks.length, 1);
  assert.equal(result.controllerManifest.manualPlatformOperations.length, 4);
  assert.equal(result.controllerManifest.rollbackArtifacts.length, 4);
});

test("check mode renders and validates without invoking Git or any network path", () => {
  const result = runSuccessorControllerGenerator({
    repoRoot: REPO_ROOT,
    mode: "check",
    runGit() {
      assert.fail("check mode must not call Git");
    },
  });

  assert.equal(result.mode, "check");
  assert.equal(result.valid, true);
  assert.equal(result.hostedRestorePerformed, false);
  assert.deepEqual(result.manifest.evidenceNames, [
    "backup",
    "finalizer",
    "hostedStaging",
    "recoveryAssurance",
    "storage",
  ]);
});

function gitMock(overrides = {}) {
  const branch = "codex/amora-release-hardening-20260811";
  const sha = "a".repeat(40);
  const defaults = {
    "rev-parse --show-toplevel": REPO_ROOT,
    "status --porcelain=v1 --untracked-files=all": "",
    "rev-parse HEAD": sha,
    "rev-parse @{upstream}": sha,
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}":
      `origin/${branch}`,
    [`ls-remote --exit-code origin refs/heads/${branch}`]:
      `${sha}\trefs/heads/${branch}`,
    "config --get remote.origin.url":
      "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git",
  };
  const values = { ...defaults, ...overrides };
  return (args) => {
    const key = args.join(" ");
    if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
    return values[key];
  };
}

test("write-mode repository guard rejects dirty, unpushed, and mismatched repositories", () => {
  for (const [name, runGit, code] of [
    [
      "dirty",
      gitMock({ "status --porcelain=v1 --untracked-files=all": " M file\n" }),
      "WRITE_REPOSITORY_DIRTY",
    ],
    [
      "unpushed",
      gitMock({ "rev-parse @{upstream}": "b".repeat(40) }),
      "WRITE_COMMIT_UNPUSHED",
    ],
    [
      "wrong origin",
      gitMock({ "config --get remote.origin.url": "https://example.com/wrong.git" }),
      "WRITE_REPOSITORY_MISMATCH",
    ],
    [
      "stale remote-tracking ref",
      gitMock({
        "ls-remote --exit-code origin refs/heads/codex/amora-release-hardening-20260811":
          `${"b".repeat(40)}\trefs/heads/codex/amora-release-hardening-20260811`,
      }),
      "WRITE_COMMIT_UNPUSHED",
    ],
  ]) {
    assert.throws(
      () => assertSuccessorControllerWriteRepository({
        repoRoot: REPO_ROOT,
        expectedOrigin: "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git",
        runGit,
      }),
      (error) => {
        assert.ok(error instanceof SuccessorControllerGeneratorError, name);
        assert.equal(error.code, code, name);
        return true;
      },
    );
  }
});

test("write-mode repository guard binds HEAD to the live tracked GitHub branch", () => {
  const state = assertSuccessorControllerWriteRepository({
    repoRoot: REPO_ROOT,
    expectedOrigin: "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git",
    runGit: gitMock(),
  });

  assert.equal(state.head, "a".repeat(40));
  assert.equal(state.upstream, state.head);
  assert.equal(state.liveRemoteSha, state.head);
  assert.equal(state.trackedBranch, "codex/amora-release-hardening-20260811");
});

test("write-mode commit writes the reviewed controller before the manifest", () => {
  const artifacts = renderSuccessorControllerArtifacts({ repoRoot: REPO_ROOT });
  const writes = [];

  commitSuccessorControllerArtifacts({
    repoRoot: REPO_ROOT,
    artifacts,
    writeText(path, text) {
      writes.push({ path, text });
    },
  });

  assert.deepEqual(
    writes.map((entry) => entry.path),
    [artifacts.controllerPath, artifacts.manifestPath],
  );
  assert.deepEqual(
    writes.map((entry) => entry.text),
    [artifacts.controllerText, artifacts.manifestText],
  );
});
