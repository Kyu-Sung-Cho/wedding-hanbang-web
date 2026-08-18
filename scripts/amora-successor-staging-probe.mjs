import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  AmoraSuccessorStagingProbeError,
  createSupabaseStagingTransport,
  loadSupabaseProjectApiKeys,
  readHostedMessageRefResidue,
  readHostedMigrationLedger,
  runMediationPrivateDraftScenario,
  runNeutralPreparationSpaceScenario,
  runPreparationTopicMessageRefScenario,
  validateAmoraSuccessorStagingProbeConfig,
} from "./lib/amora-successor-staging-probe.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const APPROVAL_CONTRACT = resolve(
  REPO_ROOT,
  "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json",
);

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new AmoraSuccessorStagingProbeError(
      "CONFIG_MISSING",
      `Missing required probe input: ${name}`,
    );
  }
  return value.trim();
}

function exactInteger(name) {
  const raw = required(name);
  if (!/^[1-9][0-9]{0,5}$/.test(raw)) {
    throw new AmoraSuccessorStagingProbeError(
      "CONFIG_INTEGER_INVALID",
      `${name} must be a positive integer`,
    );
  }
  return Number(raw);
}

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.quiet ? "ignore" : ["ignore", "pipe", "pipe"],
  });
}

function assertCommitBinding(expectedCommit) {
  const actualCommit = runGit(["rev-parse", "HEAD"]).trim();
  if (actualCommit !== expectedCommit) {
    throw new AmoraSuccessorStagingProbeError(
      "GIT_COMMIT_MISMATCH",
      "Probe checkout does not match the expected commit",
    );
  }
  try {
    runGit(["diff", "--quiet"], { quiet: true });
    runGit(["diff", "--cached", "--quiet"], { quiet: true });
  } catch {
    throw new AmoraSuccessorStagingProbeError(
      "TRACKED_TREE_DIRTY",
      "Hosted staging evidence requires a tracked-clean checkout",
    );
  }
  return actualCommit;
}

function outsideRepo(repoRoot, candidate) {
  const path = relative(repoRoot, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function canonicalReceiptText(receipt) {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

async function main() {
  const approval = JSON.parse(readFileSync(APPROVAL_CONTRACT, "utf8"));
  if (approval?.approved !== true
      || approval?.status !== "approved_for_hosted_rls_probe") {
    throw new AmoraSuccessorStagingProbeError(
      "STAGING_APPROVAL_INVALID",
      "Repository staging approval is not active",
    );
  }

  const config = validateAmoraSuccessorStagingProbeConfig({
    projectRef: required("AMORA_STAGING_PROJECT_REF"),
    productionProjectRef: required("SUPABASE_PRODUCTION_PROJECT_REF"),
    approvedProjectRef: approval.projectRef,
    managementToken: required("SUPABASE_ACCESS_TOKEN"),
    expectedCommit: required("AMORA_STAGING_PROBE_EXPECTED_COMMIT"),
    receiptOut: required("AMORA_STAGING_PROBE_RECEIPT_OUT"),
  });
  const expectedMigrationCount = exactInteger(
    "AMORA_STAGING_PROBE_EXPECTED_MIGRATION_COUNT",
  );
  const expectedMigrationHead = required(
    "AMORA_STAGING_PROBE_EXPECTED_MIGRATION_HEAD",
  );
  if (!/^20[0-9]{12}$/.test(expectedMigrationHead)) {
    throw new AmoraSuccessorStagingProbeError(
      "MIGRATION_HEAD_INVALID",
      "Expected migration head must be a 14-digit version",
    );
  }
  if (!outsideRepo(REPO_ROOT, config.receiptOut)) {
    throw new AmoraSuccessorStagingProbeError(
      "RECEIPT_INSIDE_REPOSITORY",
      "Hosted staging receipts must be written outside the repository",
    );
  }

  const gitCommit = assertCommitBinding(config.expectedCommit);
  const startedAt = new Date().toISOString();
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
  const neutralPreparationSpace = await runNeutralPreparationSpaceScenario({
    transport: createSupabaseStagingTransport({
      projectRef: config.projectRef,
      anonKey: keys.anonKey,
      serviceRoleKey: keys.serviceRoleKey,
    }),
  });
  const preparationTopicMessageRefs = await runPreparationTopicMessageRefScenario({
    transport: createSupabaseStagingTransport({
      projectRef: config.projectRef,
      anonKey: keys.anonKey,
      serviceRoleKey: keys.serviceRoleKey,
      messageRefResidueReader: (input) => readHostedMessageRefResidue({
        projectRef: config.projectRef,
        productionProjectRef: config.productionProjectRef,
        managementToken: config.managementToken,
        ...input,
      }),
    }),
  });
  const mediationPrivateDraft = await runMediationPrivateDraftScenario({
    transport: createSupabaseStagingTransport({
      projectRef: config.projectRef,
      anonKey: keys.anonKey,
      serviceRoleKey: keys.serviceRoleKey,
      messageRefResidueReader: (input) => readHostedMessageRefResidue({
        projectRef: config.projectRef,
        productionProjectRef: config.productionProjectRef,
        managementToken: config.managementToken,
        ...input,
      }),
    }),
  });
  const receipt = {
    receiptVersion: 4,
    kind: "amora-successor-hosted-staging-probe",
    scope: "neutral-space-message-refs-notes-and-mediation",
    projectRef: config.projectRef,
    gitCommit,
    migrationLedger: ledger,
    startedAt,
    completedAt: new Date().toISOString(),
    result: {
      neutralPreparationSpace,
      preparationTopicMessageRefs,
      mediationPrivateDraft,
    },
  };
  const text = canonicalReceiptText(receipt);
  const receiptSha256 = createHash("sha256").update(text, "utf8").digest("hex");
  mkdirSync(dirname(config.receiptOut), { recursive: true });
  writeFileSync(config.receiptOut, text, { encoding: "utf8", flag: "wx", mode: 0o600 });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    scope: receipt.scope,
    projectRef: receipt.projectRef,
    gitCommit: receipt.gitCommit,
    migrationLedger: receipt.migrationLedger,
    checks: {
      neutralPreparationSpace: receipt.result.neutralPreparationSpace.checks,
      preparationTopicMessageRefs: receipt.result.preparationTopicMessageRefs.checks,
      mediationPrivateDraft: receipt.result.mediationPrivateDraft.checks,
    },
    residue: {
      neutralPreparationSpace: receipt.result.neutralPreparationSpace.residue,
      preparationTopicMessageRefs: receipt.result.preparationTopicMessageRefs.residue,
      mediationPrivateDraft: receipt.result.mediationPrivateDraft.residue,
    },
    receiptPath: config.receiptOut,
    receiptSha256,
  }, null, 2)}\n`);
}

main().catch((error) => {
  const code = error instanceof AmoraSuccessorStagingProbeError
    ? error.code
    : "UNEXPECTED_PROBE_FAILURE";
  process.stderr.write(`${code}: ${error instanceof Error ? error.message : "Probe failed"}\n`);
  process.exitCode = 1;
});
