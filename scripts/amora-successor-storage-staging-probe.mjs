#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadSupabaseProjectApiKeys,
  readHostedMigrationLedger,
} from "./lib/amora-successor-staging-probe.mjs";
import {
  AmoraSuccessorStorageStagingProbeError,
  assertAmoraSuccessorStorageHostedMutationPlatform,
  createSupabaseStorageStagingTransport,
  inspectAmoraSuccessorStorageInventory,
  recoverAmoraSuccessorStorageStagingProbe,
  runAmoraSuccessorStorageDiscovery,
  runAmoraSuccessorStorageStagingProbe,
  storageProbeReceiptSha256,
  validateAmoraSuccessorStorageDiscoveryConfig,
  validateAmoraSuccessorStorageStagingProbeConfig,
} from "./lib/amora-successor-storage-staging-probe.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const APPROVAL_CONTRACT = resolve(
  REPO_ROOT,
  "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json",
);
const EXPECTED_ORIGIN = "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git";

function required(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  throw new AmoraSuccessorStorageStagingProbeError(
    "CONFIG_MISSING",
    `Missing required Storage probe input: ${names[0]}`,
  );
}

function exactInteger(...names) {
  const raw = required(...names);
  if (!/^[1-9][0-9]{0,5}$/u.test(raw)) {
    throw new AmoraSuccessorStorageStagingProbeError(
      "CONFIG_INTEGER_INVALID",
      `${names[0]} must be a positive integer`,
    );
  }
  return Number(raw);
}

function optional(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function recoveryRequested() {
  const value = optional("AMORA_STAGING_STORAGE_PROBE_RECOVER");
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new AmoraSuccessorStorageStagingProbeError(
    "RECOVERY_MODE_INVALID",
    "Storage recovery mode must be exactly 0 or 1",
  );
}

function commandMode() {
  const args = process.argv.slice(2);
  if (args.length === 0) return "probe";
  if (args.length === 1 && args[0] === "--inventory-only") return "inventory-only";
  throw new AmoraSuccessorStorageStagingProbeError(
    "CLI_ARGUMENT_INVALID",
    "Storage staging probe accepts only --inventory-only or no arguments",
  );
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
    throw new AmoraSuccessorStorageStagingProbeError(
      "GIT_COMMIT_MISMATCH",
      "Storage probe checkout does not match the expected commit",
    );
  }
  if (runGit(["remote", "get-url", "origin"]).trim() !== EXPECTED_ORIGIN) {
    throw new AmoraSuccessorStorageStagingProbeError(
      "GIT_ORIGIN_MISMATCH",
      "Storage probe repository origin is not approved",
    );
  }
  try {
    runGit(["diff", "--quiet"], { quiet: true });
    runGit(["diff", "--cached", "--quiet"], { quiet: true });
  } catch {
    throw new AmoraSuccessorStorageStagingProbeError(
      "TRACKED_TREE_DIRTY",
      "Storage probe requires a tracked-clean checkout",
    );
  }
  let upstream;
  try {
    upstream = runGit(["rev-parse", "@{upstream}"]).trim();
  } catch {
    throw new AmoraSuccessorStorageStagingProbeError(
      "GIT_UPSTREAM_MISSING",
      "Storage probe branch has no pinned upstream",
    );
  }
  if (upstream !== expectedCommit) {
    throw new AmoraSuccessorStorageStagingProbeError(
      "GIT_COMMIT_NOT_PUSHED",
      "Storage probe commit is not the exact upstream commit",
    );
  }
}

async function main() {
  const mode = commandMode();
  const approval = JSON.parse(readFileSync(APPROVAL_CONTRACT, "utf8"));
  if (approval?.approved !== true
      || approval?.status !== "approved_for_hosted_rls_probe") {
    throw new AmoraSuccessorStorageStagingProbeError(
      "STAGING_APPROVAL_INVALID",
      "Repository staging approval is not active",
    );
  }

  if (mode === "inventory-only") {
    if (recoveryRequested()) {
      throw new AmoraSuccessorStorageStagingProbeError(
        "DISCOVERY_MODE_CONFLICT",
        "Read-only Storage discovery cannot run in recovery mode",
      );
    }
    const discoveryReceiptRaw = optional(
      "AMORA_STAGING_STORAGE_DISCOVERY_RECEIPT_OUT",
    );
    const discoveryConfig = validateAmoraSuccessorStorageDiscoveryConfig({
      projectRef: required("AMORA_STAGING_PROJECT_REF"),
      productionProjectRef: required("SUPABASE_PRODUCTION_PROJECT_REF"),
      approvedProjectRef: approval.projectRef,
      managementToken: required("SUPABASE_ACCESS_TOKEN"),
      expectedCommit: required(
        "AMORA_STAGING_STORAGE_DISCOVERY_EXPECTED_COMMIT",
        "AMORA_STAGING_STORAGE_PROBE_EXPECTED_COMMIT",
        "AMORA_STAGING_PROBE_EXPECTED_COMMIT",
      ),
      ...(discoveryReceiptRaw === undefined ? {} : {
        repoRoot: REPO_ROOT,
        receiptOut: discoveryReceiptRaw,
      }),
    });
    assertExactPushedCommit(discoveryConfig.expectedCommit);
    const result = await runAmoraSuccessorStorageDiscovery({
      config: discoveryConfig,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  assertAmoraSuccessorStorageHostedMutationPlatform();

  const expectedMigrationCount = exactInteger(
    "AMORA_STAGING_STORAGE_PROBE_EXPECTED_MIGRATION_COUNT",
    "AMORA_STAGING_PROBE_EXPECTED_MIGRATION_COUNT",
  );
  const expectedMigrationHead = required(
    "AMORA_STAGING_STORAGE_PROBE_EXPECTED_MIGRATION_HEAD",
    "AMORA_STAGING_PROBE_EXPECTED_MIGRATION_HEAD",
  );
  if (!/^20[0-9]{12}$/u.test(expectedMigrationHead)) {
    throw new AmoraSuccessorStorageStagingProbeError(
      "MIGRATION_HEAD_INVALID",
      "Storage probe migration head must be a 14-digit version",
    );
  }

  const config = validateAmoraSuccessorStorageStagingProbeConfig({
    repoRoot: REPO_ROOT,
    projectRef: required("AMORA_STAGING_PROJECT_REF"),
    productionProjectRef: required("SUPABASE_PRODUCTION_PROJECT_REF"),
    approvedProjectRef: approval.projectRef,
    projectUrl: required("SUPABASE_EXPECTED_URL"),
    managementToken: required("SUPABASE_ACCESS_TOKEN"),
    expectedCommit: required(
      "AMORA_STAGING_STORAGE_PROBE_EXPECTED_COMMIT",
      "AMORA_STAGING_PROBE_EXPECTED_COMMIT",
    ),
    receiptOut: required(
      "AMORA_STAGING_STORAGE_PROBE_RECEIPT_OUT",
      "AMORA_STAGING_PROBE_RECEIPT_OUT",
    ),
    recoveryJournalOut: optional(
      "AMORA_STAGING_STORAGE_PROBE_RECOVERY_JOURNAL_OUT",
      "AMORA_STAGING_PROBE_RECOVERY_JOURNAL_OUT",
    ),
    expectedMigrationCount,
    expectedMigrationHead,
    gitOrigin: EXPECTED_ORIGIN,
  });
  assertExactPushedCommit(config.expectedCommit);
  const shouldRecover = recoveryRequested();

  const [ledger, keys] = await Promise.all([
    readHostedMigrationLedger({
      projectRef: config.projectRef,
      managementToken: config.managementToken,
      expectedCount: expectedMigrationCount,
      expectedHead: expectedMigrationHead,
    }),
    loadSupabaseProjectApiKeys({
      projectRef: config.projectRef,
      managementToken: config.managementToken,
    }),
  ]);
  const runtimeConfig = Object.freeze({
    ...config,
    expectedMigrationCount: ledger.count,
    expectedMigrationHead: ledger.head,
  });
  const transport = createSupabaseStorageStagingTransport({
    projectRef: config.projectRef,
    productionProjectRef: config.productionProjectRef,
    anonKey: keys.anonKey,
    serviceRoleKey: keys.serviceRoleKey,
  });
  const inspectInventory = ({ runNonce, userId, coupleId }) =>
    inspectAmoraSuccessorStorageInventory({
      projectRef: config.projectRef,
      productionProjectRef: config.productionProjectRef,
      managementToken: config.managementToken,
      runNonce,
      userId,
      coupleId,
    });
  if (shouldRecover) {
    const recovery = await recoverAmoraSuccessorStorageStagingProbe({
      config: runtimeConfig,
      transport,
      inspectInventory,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: recovery.status,
      projectRef: recovery.projectRef,
      gitCommit: recovery.gitCommit,
      identityMarker: recovery.identityMarker,
      residue: recovery.residue,
      productionVerified: recovery.productionVerified,
      productionMutations: recovery.productionMutations,
    }, null, 2)}\n`);
    return;
  }

  const receipt = await runAmoraSuccessorStorageStagingProbe({
    config: runtimeConfig,
    transport,
    inspectInventory,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: receipt.status,
    projectRef: receipt.projectRef,
    gitCommit: receipt.gitCommit,
    migrationLedger: receipt.migrationLedger,
    checks: receipt.checks,
    residue: receipt.residue,
    signedUploadTokenExpired: receipt.signedUploadTokenExpired,
    drainVerified: receipt.drainVerified,
    receiptSha256: storageProbeReceiptSha256(receipt),
  }, null, 2)}\n`);
}

main().catch((error) => {
  const code = error instanceof AmoraSuccessorStorageStagingProbeError
    ? error.code
    : "STORAGE_STAGING_PROBE_UNEXPECTED_FAILURE";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
