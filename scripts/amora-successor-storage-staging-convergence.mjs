#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  AmoraSuccessorStorageStagingConvergenceError,
  runAmoraSuccessorStorageStagingConvergencePlan,
  validateAmoraSuccessorStorageStagingConvergencePlanConfig,
} from "./lib/amora-successor-storage-staging-convergence.mjs";
import {
  assertAmoraSuccessorStorageExternalOutputPath,
} from "./lib/amora-successor-storage-staging-probe.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const APPROVAL_CONTRACT = resolve(
  REPO_ROOT,
  "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json",
);
const BUCKET_API_APPROVAL_CONTRACT = resolve(
  REPO_ROOT,
  "supabase/release-contracts/amora-successor-storage-bucket-api-staging-v1.json",
);
const EXPECTED_ORIGIN = "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git";
const PINNED_TOOL_PATHS = Object.freeze([
  "scripts/amora-successor-storage-staging-convergence.mjs",
  "scripts/lib/amora-successor-storage-staging-convergence.mjs",
  "scripts/lib/amora-successor-storage-staging-probe.mjs",
  "scripts/lib/supabase-service-destination.mjs",
  "scripts/tests/amora-successor-storage-staging-convergence.test.mjs",
  "supabase/release-contracts/amora-successor-storage-bucket-api-staging-v1.json",
  "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json",
]);

function fail(code, message) {
  throw new AmoraSuccessorStorageStagingConvergenceError(code, message);
}

function commandMode(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--plan")) {
    return "plan";
  }
  if (argv.length === 1
      && ["--apply", "--recover", "--compensate"].includes(argv[0])) {
    fail(
      "STORAGE_CONVERGENCE_MUTATION_APPROVAL_MISSING",
      "Storage convergence mutation has no repository-approved authorization contract",
    );
  }
  if (argv.length === 1
      && ["--apply-buckets", "--recover-buckets", "--compensate-buckets"]
        .includes(argv[0])) {
    return argv[0].slice(2);
  }
  fail("STORAGE_CONVERGENCE_CLI_ARGUMENT_INVALID", "Storage convergence accepts only --plan");
}

async function assertBucketApiMutationApproval() {
  let contract;
  try {
    contract = JSON.parse(await readFile(BUCKET_API_APPROVAL_CONTRACT, "utf8"));
  } catch {
    fail(
      "STORAGE_BUCKET_API_MUTATION_APPROVAL_MISSING",
      "Storage bucket API mutation approval contract is unavailable",
    );
  }
  if (contract?.approved !== true
      || contract?.status !== "approved_for_storage_bucket_api_staging_mutation"
      || contract?.mutationAuthorization?.authorized !== true) {
    fail(
      "STORAGE_BUCKET_API_MUTATION_APPROVAL_MISSING",
      "Storage bucket API mutation is not repository-approved",
    );
  }
  fail(
    "STORAGE_BUCKET_API_EXECUTION_NOT_ENABLED",
    "Storage bucket API execution remains disabled until its durable operator is complete",
  );
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    fail("STORAGE_CONVERGENCE_CONFIG_MISSING", `Missing required input: ${name}`);
  }
  return value.trim();
}

function runGit(args, { quiet = false } = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: quiet ? "ignore" : ["ignore", "pipe", "pipe"],
  });
}

function assertExactPushedCommit(expectedCommit) {
  if (runGit(["rev-parse", "HEAD"]).trim() !== expectedCommit) {
    fail("GIT_COMMIT_MISMATCH", "Storage convergence checkout is not the pinned commit");
  }
  if (runGit(["remote", "get-url", "origin"]).trim() !== EXPECTED_ORIGIN) {
    fail("GIT_ORIGIN_MISMATCH", "Storage convergence repository origin is not approved");
  }
  try {
    runGit(["diff", "--quiet"], { quiet: true });
    runGit(["diff", "--cached", "--quiet"], { quiet: true });
  } catch {
    fail("TRACKED_TREE_DIRTY", "Storage convergence requires a tracked-clean checkout");
  }
  let upstream;
  try {
    upstream = runGit(["rev-parse", "@{upstream}"]).trim();
  } catch {
    fail("GIT_UPSTREAM_MISSING", "Storage convergence branch has no upstream");
  }
  if (upstream !== expectedCommit) {
    fail("GIT_COMMIT_NOT_PUSHED", "Storage convergence commit is not the exact upstream");
  }
  for (const path of PINNED_TOOL_PATHS) {
    try {
      runGit(["ls-files", "--error-unmatch", "--", path], { quiet: true });
    } catch {
      fail("CONVERGENCE_TOOL_NOT_TRACKED", `Storage convergence path is not tracked: ${path}`);
    }
    let headBlob;
    let workingBlob;
    try {
      headBlob = runGit(["rev-parse", `${expectedCommit}:${path}`]).trim();
      workingBlob = runGit(["hash-object", "--", path]).trim();
    } catch {
      fail("CONVERGENCE_TOOL_BLOB_MISMATCH", `Storage convergence path could not be pinned: ${path}`);
    }
    if (!/^[a-f0-9]{40}$/u.test(headBlob) || workingBlob !== headBlob) {
      fail("CONVERGENCE_TOOL_BLOB_MISMATCH", `Storage convergence path drifted from HEAD: ${path}`);
    }
  }
}

async function assertNoSymlinkParents(targetPath) {
  let current = dirname(targetPath);
  while (true) {
    let metadata;
    try {
      metadata = await lstat(current);
    } catch {
      fail("RECEIPT_PATH_INVALID", "Plan receipt parent could not be inspected");
    }
    if (metadata.isSymbolicLink()) {
      fail("RECEIPT_PATH_INVALID", "Plan receipt parent must not be a symbolic link or junction");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function syncParentDirectory(targetPath) {
  if (process.platform === "win32") return;
  let handle;
  try {
    handle = await open(dirname(targetPath), "r");
    await handle.sync();
  } catch {
    fail("STORAGE_CONVERGENCE_RECEIPT_WRITE_FAILED", "Plan receipt parent was not synchronized");
  } finally {
    await handle?.close();
  }
}

async function assertHandleMatchesPath(targetPath, handle) {
  let handleMetadata;
  let pathMetadata;
  try {
    [handleMetadata, pathMetadata] = await Promise.all([
      handle.stat(),
      lstat(targetPath),
    ]);
  } catch {
    fail("RECEIPT_PATH_INVALID", "Plan receipt path changed while open");
  }
  if (!handleMetadata.isFile() || !pathMetadata.isFile()
      || pathMetadata.isSymbolicLink()
      || handleMetadata.dev !== pathMetadata.dev
      || handleMetadata.ino !== pathMetadata.ino) {
    fail("RECEIPT_PATH_INVALID", "Plan receipt inode changed while open");
  }
}

async function readBoundedDiscoveryReceipt(discoveryReceiptPath) {
  const targetPath = assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: REPO_ROOT,
    targetPath: discoveryReceiptPath,
  });
  const maxBytes = 64 * 1024;
  let handle;
  try {
    handle = await open(targetPath, "r");
    await assertHandleMatchesPath(targetPath, handle);
    const initial = await handle.stat();
    if (!initial.isFile() || initial.size < 2 || initial.size > maxBytes) {
      fail("DISCOVERY_RECEIPT_INVALID", "Discovery receipt size was not bounded");
    }
    const bytes = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const final = await handle.stat();
    await assertHandleMatchesPath(targetPath, handle);
    if (offset < 2 || offset > maxBytes || final.size !== initial.size
        || final.size !== offset || final.mtimeMs !== initial.mtimeMs) {
      fail("DISCOVERY_RECEIPT_INVALID", "Discovery receipt changed while it was read");
    }
    return bytes.subarray(0, offset).toString("utf8");
  } catch (error) {
    if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
    fail("DISCOVERY_RECEIPT_INVALID", "Discovery receipt could not be read safely");
  } finally {
    await handle?.close();
  }
}

async function reservePlanReceipt(receiptOut) {
  const targetPath = assertAmoraSuccessorStorageExternalOutputPath({
    repoRoot: REPO_ROOT,
    targetPath: receiptOut,
  });
  await assertNoSymlinkParents(targetPath);
  let handle;
  let completed = false;
  try {
    handle = await open(targetPath, "wx", 0o600);
    await assertHandleMatchesPath(targetPath, handle);
    await handle.sync();
    await syncParentDirectory(targetPath);
  } catch {
    await handle?.close();
    if (handle) {
      await unlink(targetPath).catch(() => {});
      await syncParentDirectory(targetPath).catch(() => {});
    }
    fail("STORAGE_CONVERGENCE_RECEIPT_WRITE_FAILED", "Plan receipt was not written exclusively");
  }
  return Object.freeze({
    async write(receipt) {
      if (completed || !handle) {
        fail("STORAGE_CONVERGENCE_RECEIPT_WRITE_FAILED", "Plan receipt reservation was not active");
      }
      const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > 32 * 1024) {
        fail("STORAGE_CONVERGENCE_RECEIPT_WRITE_FAILED", "Plan receipt exceeded its bounded size");
      }
      try {
        await assertHandleMatchesPath(targetPath, handle);
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
        await assertHandleMatchesPath(targetPath, handle);
        await syncParentDirectory(targetPath);
        await handle.close();
        handle = undefined;
        completed = true;
      } catch (error) {
        if (error instanceof AmoraSuccessorStorageStagingConvergenceError) throw error;
        fail("STORAGE_CONVERGENCE_RECEIPT_WRITE_FAILED", "Plan receipt was not durable");
      }
    },
    async abort() {
      if (completed) return;
      await handle?.close().catch(() => {});
      handle = undefined;
      await unlink(targetPath).catch(() => {});
      await syncParentDirectory(targetPath).catch(() => {});
    },
  });
}

async function main() {
  const mode = commandMode(process.argv.slice(2));
  if (mode !== "plan") {
    await assertBucketApiMutationApproval();
  }
  const approval = JSON.parse(await readFile(APPROVAL_CONTRACT, "utf8"));
  if (approval?.approved !== true
      || approval?.status !== "approved_for_hosted_rls_probe") {
    fail("STAGING_APPROVAL_INVALID", "Read-only staging discovery approval is not active");
  }
  const expectedCommit = required("AMORA_STAGING_STORAGE_CONVERGENCE_EXPECTED_COMMIT");
  assertExactPushedCommit(expectedCommit);

  const discoveryReceiptPath = resolve(
    required("AMORA_STAGING_STORAGE_DISCOVERY_RECEIPT_IN"),
  );
  const discoveryReceiptRaw = await readBoundedDiscoveryReceipt(discoveryReceiptPath);
  const receiptOut = resolve(required("AMORA_STAGING_STORAGE_CONVERGENCE_PLAN_RECEIPT_OUT"));
  const config = {
    projectRef: required("AMORA_STAGING_PROJECT_REF"),
    productionProjectRef: required("SUPABASE_PRODUCTION_PROJECT_REF"),
    approvedProjectRef: approval.projectRef,
    managementToken: required("SUPABASE_ACCESS_TOKEN"),
    discoveryReceiptRaw,
    discoveryReceiptSha256: required("AMORA_STAGING_STORAGE_DISCOVERY_RECEIPT_SHA256"),
    convergenceToolGitCommit: expectedCommit,
  };
  validateAmoraSuccessorStorageStagingConvergencePlanConfig(config);
  const reservation = await reservePlanReceipt(receiptOut);
  let receipt;
  try {
    receipt = await runAmoraSuccessorStorageStagingConvergencePlan({
      config,
      writeReceipt: (value) => reservation.write(value),
    });
  } catch (error) {
    await reservation.abort();
    throw error;
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: receipt.status,
    projectRef: receipt.projectRef,
    discoveryGitCommit: receipt.discoveryGitCommit,
    convergenceToolGitCommit: receipt.convergenceToolGitCommit,
    actionCount: receipt.actionCount,
    actionIds: receipt.actionIds,
    planSha256: receipt.planSha256,
    receiptSha256: receipt.receiptSha256,
    effects: receipt.effects,
  }, null, 2)}\n`);
}

main().catch((error) => {
  const code = error instanceof AmoraSuccessorStorageStagingConvergenceError
    ? error.code
    : "STORAGE_CONVERGENCE_UNEXPECTED_FAILURE";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
