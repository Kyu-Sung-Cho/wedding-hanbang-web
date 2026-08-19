import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSuccessorFinalizerEvidence,
  buildSuccessorFinalizerRenderOnlyRehearsal,
  emitSuccessorFinalizerEvidence,
  emitSuccessorFinalizerRenderOnlyRehearsal,
} from "../lib/vendor-disclosure-successor-finalizer-evidence.mjs";
import {
  renderProductionWriteFenceFinalizerSql,
} from "../lib/production-write-fence-finalizer.mjs";
import {
  SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  validateSuccessorRuntimeEvidence,
} from "../lib/supabase-successor-release-contract.mjs";
import {
  inspectSuccessorFinalizerGitCandidate,
  runSuccessorFinalizerEvidenceCli,
} from "../vendor-disclosure-successor-finalizer-evidence.mjs";

const SOURCE_ROOT = resolve(import.meta.dirname, "..", "..");
const RELEASE = "vendor-disclosure-v2-20260718";
const PROJECT_REF = "slrtobkksjmxgzatjyqb";
const COMMIT = "1".repeat(40);
const OWNER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-19T05:30:00.000Z");
const VERSIONS = ["20260718120000", "20260718130000"];
const POSTCHECK_IDS = ["vendor-disclosure-successor-postcheck"];
const OPERATION_FILE =
  "supabase/platform-operations/security/20260819122000_production_write_fence_successor_finalize.sql";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function canonicalJsonSha256(value) {
  return sha256(`${canonicalJson(value)}\n`);
}

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

async function writeJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, "utf8");
  return sha256(text);
}

const REQUIRED_CONTROLS = Object.freeze({
  AMORA_AUXILIARY_MEMORY_ENABLED: "false",
  AMORA_CARE_OUTBOUND_ENABLED: "false",
  AMORA_COMMUNITY_AI_COMMENT_ENABLED: "false",
  AMORA_CONVERSATION_SEGMENT_READ_ENABLED: "false",
  AMORA_TODAY_ONE_ENABLED: "false",
  AMORA_MEDIATION_OUTCOME_FOLLOW_UP_ENABLED: "false",
  AMORA_OPENAI_ENABLED: "false",
  AMORA_PROACTIVE_CHAT_ENABLED: "false",
  AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED: "false",
  EXPO_PUBLIC_AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED: "false",
  AMORA_COST_GUARD_ENABLED: "true",
  WEDDING_COURT_ENABLED: "false",
  WEDDING_PAYMENT_LEDGER_ENABLED: "false",
});

const REQUIRED_ROLLBACK_CHECKS = Object.freeze([
  "databaseWriteFenceHeld",
  "storageWriteFenceHeld",
  "authSignupDisabled",
  "webWriteFenceEnabled",
  "chatPartnerRecipientBoundaryHeld",
  "conversationSegmentScopeBoundaryHeld",
]);

const REQUIRED_CANARY_CHECKS = Object.freeze([
  "authenticatedReadPassed",
  "browserConsoleClean",
  "databaseFenceStillVerified",
  "deployedCommitMatched",
  "deploymentReady",
  "latencyWithinBaseline",
  "loginLogoutPassed",
  "noUnexpected5xx",
  "publicReadPassed",
  "serverErrorsWithinBaseline",
  "signupStillDisabled",
  "storageHelperClosed",
  "webWriteFenceStillEnabled",
]);

async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "successor-finalizer-repo-"));
  const sourceSql = join(SOURCE_ROOT, ...OPERATION_FILE.split("/"));
  const targetSql = join(repoRoot, ...OPERATION_FILE.split("/"));
  await mkdir(dirname(targetSql), { recursive: true });
  await copyFile(sourceSql, targetSql);
  const templateText = await readFile(targetSql, "utf8");
  const operationSha256 = sha256(templateText.replace(/\r\n?/g, "\n"));
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName: `${RELEASE}-feature-off-rollback.json`,
    maximumAgeMinutes: 30,
    requiredControls: { ...REQUIRED_CONTROLS },
    requiredChecks: [...REQUIRED_ROLLBACK_CHECKS],
  };
  const requirement = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.finalizer;
  const manifest = {
    release: RELEASE,
    projectRef: PROJECT_REF,
    status: "controller_ready",
    requiredRemoteHead: "20260727090000",
    expandMigrations: VERSIONS.map((version) => ({
      file: `${version}_fixture.sql`,
      sha256: "a".repeat(64),
    })),
    deploymentEvidence: Object.fromEntries(
      Object.entries(SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS).map(
        ([name, evidenceRequirement]) => {
          const slug = name.replace(/([A-Z])/g, "-$1").toLowerCase();
          return [name, {
            kind: evidenceRequirement.kind,
            maximumAgeMinutes: evidenceRequirement.maximumAgeMinutes,
            rawEvidenceSource: evidenceRequirement.rawEvidenceSource,
            rawEvidenceFileName: `${RELEASE}-${slug}-raw.json`,
            receiptFileName: `${RELEASE}-${slug}-evidence.json`,
            requiredChecks: [...evidenceRequirement.requiredChecks],
            ...(name === "recoveryAssurance"
              ? {
                releaseAssurance: structuredClone(
                  SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
                ),
              }
              : {}),
          }];
        },
      ),
    ),
  };
  const postExpandBackupContract = {
    id: `post-${RELEASE}-backup`,
    version: 2,
    expectedTableCount: 31,
    expectedTableContractSha256: "a".repeat(64),
    expectedReleaseMigrationContractSha256: textListSha256(VERSIONS),
    recoveryAssurance: {
      receiptFileName: `${RELEASE}-recovery-assurance-evidence.json`,
      maximumAgeMinutes:
        SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.recoveryAssurance
          .maximumAgeMinutes,
      requiredChecks: [
        ...SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.recoveryAssurance
          .requiredChecks,
      ],
      releaseAssurance: structuredClone(
        SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
      ),
    },
  };
  const controllerManifest = {
    ...manifest,
    postApplyChecks: POSTCHECK_IDS.map((id) => ({ id })),
    backupContract: {
      id: `pre-${RELEASE}-current-remote-backup`,
      version: 2,
      expectedMigrationHead: manifest.requiredRemoteHead,
      expectedTableCount: 27,
      expectedTableContractSha256: "b".repeat(64),
      providerPhysicalBackup: {
        requiredStatus: "COMPLETED",
      },
    },
    manualControlEvidence: {
      receiptFileName: `${RELEASE}-production-write-fence.json`,
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
    },
    rollbackContract,
    postExpandBackupContract,
    finalizationContract: {
      id: "production-write-fence-exact-owner-finalizer",
      version: 2,
      operation: {
        id: "production-write-fence-successor-finalize-20260819122000",
        file: OPERATION_FILE,
        sha256: operationSha256,
      },
      requiredLeasePhase: "deployment-canary",
      canaryMaximumAgeMinutes: 15,
      deploymentMaximumAgeMinutes: 1_440,
      requiredCanaryChecks: [...REQUIRED_CANARY_CHECKS],
      confirmationIncludesCanarySha256: true,
    },
  };
  const ownerLeaseReceipt = {
    receiptVersion: 1,
    kind: "successor-exact-owner-lease-rehearsal-v1",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    databaseSystemIdentifier: "7000000000000000001",
    leaseOwnerId: OWNER,
    leasePhase: "deployment-canary",
    leaseCount: 1,
    environment: "isolated-non-production-rehearsal",
    source: "read-only-postgres-observation",
    transactionReadOnly: true,
    productionMutationAttempted: false,
    observedAt: "2026-08-19T05:20:00.000Z",
    containsSecrets: false,
  };
  const canaryFenceReceipt = {
    receiptVersion: 1,
    kind: "successor-write-fenced-canary-rehearsal-v1",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    deploymentId: "dpl_abcdefghijklmnopqrstuvwx",
    environment: "isolated-non-production-rehearsal",
    source: "bounded-canary-rehearsal",
    observationWindowSeconds: 300,
    checks: Object.fromEntries(REQUIRED_CANARY_CHECKS.map((name) => [name, true])),
    verifiedAt: "2026-08-19T05:20:00.000Z",
    expiresAt: "2026-08-19T05:35:00.000Z",
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  const featureOffReceipt = {
    receiptVersion: 1,
    kind: "successor-feature-off-rollback-rehearsal-v1",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    receiptFileName: rollbackContract.featureOffReceiptFileName,
    strategy: rollbackContract.strategy,
    migrationRollback: rollbackContract.migrationRollback,
    receiptMaximumAgeMinutes: rollbackContract.maximumAgeMinutes,
    requiredControls: { ...REQUIRED_CONTROLS },
    observedControls: { ...REQUIRED_CONTROLS },
    checks: Object.fromEntries(REQUIRED_ROLLBACK_CHECKS.map((name) => [name, true])),
    environment: "isolated-non-production-rehearsal",
    source: "feature-off-rollback-rehearsal",
    verifiedAt: "2026-08-19T05:20:00.000Z",
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  const inputDigests = {
    ownerLeaseReceiptSha256: canonicalJsonSha256(ownerLeaseReceipt),
    canaryFenceReceiptSha256: canonicalJsonSha256(canaryFenceReceipt),
    featureOffReceiptSha256: canonicalJsonSha256(featureOffReceipt),
  };
  const renderEvidence = {
    projectRef: PROJECT_REF,
    databaseSystemIdentifier: ownerLeaseReceipt.databaseSystemIdentifier,
    release: RELEASE,
    releaseCommit: COMMIT,
    leaseOwnerId: OWNER,
    outcomePathSha256: "1".repeat(64),
    outcomeReceiptSha256: "2".repeat(64),
    deploymentId: canaryFenceReceipt.deploymentId,
    deploymentUrlSha256: "3".repeat(64),
    deploymentReceiptSha256: "4".repeat(64),
    canaryReceiptSha256: inputDigests.canaryFenceReceiptSha256,
    canaryVerifiedAt: canaryFenceReceipt.verifiedAt,
    canaryExpiresAt: canaryFenceReceipt.expiresAt,
    postExpandBackupReceiptSha256: "5".repeat(64),
    postExpandBackupReverificationSha256: "6".repeat(64),
    recoveryAssuranceReceiptSha256: "7".repeat(64),
    postExpandBackupSetId: "22222222-2222-4222-8222-222222222222",
    postExpandBackupManifestSha256: "a".repeat(64),
    postExpandTableContractSha256:
      postExpandBackupContract.expectedTableContractSha256,
    postExpandMigrationContractSha256:
      postExpandBackupContract.expectedReleaseMigrationContractSha256,
    postExpandLiveSchemaContractSha256: "b".repeat(64),
    postExpandLogicalDataContractSha256: "c".repeat(64),
  };
  const templateContractReceipt = {
    receiptVersion: 1,
    kind: "successor-finalizer-template-contract-rehearsal-v1",
    release: RELEASE,
    projectRef: PROJECT_REF,
    releaseCommit: COMMIT,
    finalizationContractVersion: 2,
    operationId: controllerManifest.finalizationContract.operation.id,
    operationFile: OPERATION_FILE,
    operationSha256,
    successorTableContractSha256:
      postExpandBackupContract.expectedTableContractSha256,
    successorMigrationContractSha256:
      postExpandBackupContract.expectedReleaseMigrationContractSha256,
    renderEvidence,
    verifiedAt: "2026-08-19T05:20:00.000Z",
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  inputDigests.templateContractReceiptSha256 =
    canonicalJsonSha256(templateContractReceipt);
  return {
    repoRoot,
    templateText,
    manifest,
    controllerManifest,
    ownerLeaseReceipt,
    canaryFenceReceipt,
    featureOffReceipt,
    templateContractReceipt,
    inputDigests,
  };
}

function completeEvidenceInputs(state) {
  const finalizerDryRehearsal = buildSuccessorFinalizerRenderOnlyRehearsal({
    ...state,
    expectedCommit: COMMIT,
    now: () => NOW,
  });
  return {
    ...state,
    expectedCommit: COMMIT,
    finalizerDryRehearsal,
    inputDigests: {
      ...state.inputDigests,
      finalizerDryRehearsalSha256:
        canonicalJsonSha256(finalizerDryRehearsal),
    },
    gitState: {
      expectedCommit: COMMIT,
      actualCommit: COMMIT,
      upstreamCommit: COMMIT,
      remoteCommit: COMMIT,
      remoteRef: "origin/codex/successor-finalizer",
      worktreeClean: true,
    },
    now: () => NOW,
  };
}

test("render-only rehearsal exactly renders the pinned successor template without DB execution", async () => {
  const state = await fixture();
  try {
    const rehearsal = buildSuccessorFinalizerRenderOnlyRehearsal({
      ...state,
      expectedCommit: COMMIT,
      now: () => NOW,
    });
    const expectedRendered = renderProductionWriteFenceFinalizerSql(
      state.templateText,
      state.templateContractReceipt.renderEvidence,
      state.controllerManifest.postExpandBackupContract,
    );
    assert.equal(rehearsal.kind, "successor-finalizer-render-only-rehearsal-v1");
    assert.equal(rehearsal.mode, "render-only-no-database-execution");
    assert.equal(rehearsal.renderedSqlSha256, sha256(expectedRendered));
    assert.equal(rehearsal.renderedSqlBytes, Buffer.byteLength(expectedRendered, "utf8"));
    assert.equal(rehearsal.unresolvedTemplateTokenCount, 0);
    assert.equal(rehearsal.databaseExecutionAttempted, false);
    assert.equal(rehearsal.productionMutationAttempted, false);
    assert.deepEqual(rehearsal.limitations, [
      "render-only rehearsal; PostgreSQL finalizer SQL was not executed",
      "no Production mutation or Production finalization was attempted",
      "this proves contract rendering only, not a successful Production finalization",
    ]);
  } finally {
    await rm(state.repoRoot, { recursive: true, force: true });
  }
});

test("validated artifacts emit the exact central finalizer receipt and honest raw scope", async () => {
  const state = await fixture();
  try {
    const result = buildSuccessorFinalizerEvidence(completeEvidenceInputs(state));
    const requirement = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.finalizer;
    assert.deepEqual(
      result.receipt.checks,
      Object.fromEntries(requirement.requiredChecks.map((name) => [name, true])),
    );
    assert.deepEqual(result.receipt.observations, {
      featureOffReceiptFileName:
        state.controllerManifest.rollbackContract.featureOffReceiptFileName,
      finalizationContractVersion: 2,
      migrationRollback: "prohibited",
      requiredControls: { ...REQUIRED_CONTROLS },
      rollbackStrategy: "forward-fix-feature-off",
    });
    assert.equal(result.receipt.rawProvenance.sha256, sha256(result.rawText));
    assert.equal(result.receipt.rawProvenance.source, requirement.rawEvidenceSource);
    assert.equal(result.raw.scope.mode, "render-only-no-database-execution");
    assert.equal(result.raw.scope.databaseExecutionAttempted, false);
    assert.equal(result.raw.scope.productionMutationAttempted, false);
    assert.deepEqual(result.raw.scope.doesNotProve, [
      "Production finalizer SQL execution",
      "Production database finalization",
      "Production write-fence removal",
    ]);
    assert.equal(result.raw.containsSecrets, false);
    assert.equal(result.receipt.containsSecrets, false);
  } finally {
    await rm(state.repoRoot, { recursive: true, force: true });
  }
});

test("no success check is emitted from altered owner, template, canary, rollback, dry-run or git artifacts", async () => {
  const scenarios = [
    {
      code: "FINALIZER_OWNER_LEASE_INVALID",
      mutate: (input) => { input.ownerLeaseReceipt.leaseCount = 2; },
    },
    {
      code: "FINALIZER_TEMPLATE_CONTRACT_INVALID",
      mutate: (input) => {
        input.templateContractReceipt.successorTableContractSha256 = "9".repeat(64);
      },
    },
    {
      code: "FINALIZER_CANARY_INVALID",
      mutate: (input) => { input.canaryFenceReceipt.checks.noUnexpected5xx = false; },
    },
    {
      code: "FINALIZER_FEATURE_OFF_INVALID",
      mutate: (input) => { input.featureOffReceipt.observedControls.AMORA_OPENAI_ENABLED = "true"; },
    },
    {
      code: "FINALIZER_DRY_REHEARSAL_INVALID",
      mutate: (input) => { input.finalizerDryRehearsal.databaseExecutionAttempted = true; },
    },
    {
      code: "FINALIZER_RELEASE_COMMIT_NOT_PUSHED",
      mutate: (input) => { input.gitState.worktreeClean = false; },
    },
  ];
  for (const scenario of scenarios) {
    const state = await fixture();
    try {
      const { now: unusedNow, ...cloneable } = completeEvidenceInputs(state);
      assert.equal(typeof unusedNow, "function");
      const input = structuredClone(cloneable);
      input.now = () => NOW;
      scenario.mutate(input);
      assert.throws(
        () => buildSuccessorFinalizerEvidence(input),
        (error) => error?.code === scenario.code,
        scenario.code,
      );
    } finally {
      await rm(state.repoRoot, { recursive: true, force: true });
    }
  }
});

test("emitter writes only the exact private sibling filenames with exclusive creation", async () => {
  const state = await fixture();
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-finalizer-private-"));
  const rawOut = join(receiptRoot, `${RELEASE}-finalizer-raw.json`);
  const receiptOut = join(receiptRoot, `${RELEASE}-finalizer-evidence.json`);
  try {
    const input = completeEvidenceInputs(state);
    const result = await emitSuccessorFinalizerEvidence({
      ...input,
      repoRoot: state.repoRoot,
      rawOut,
      receiptOut,
    });
    assert.equal(await readFile(rawOut, "utf8"), result.rawText);
    assert.deepEqual(
      JSON.parse(await readFile(receiptOut, "utf8")),
      result.receipt,
    );
    await assert.rejects(
      emitSuccessorFinalizerEvidence({
        ...input,
        repoRoot: state.repoRoot,
        rawOut,
        receiptOut,
      }),
      (error) => error?.code === "FINALIZER_EVIDENCE_OUTPUT_EXISTS",
    );
    const insideRaw = join(
      state.repoRoot,
      `${RELEASE}-finalizer-raw.json`,
    );
    const insideReceipt = join(
      state.repoRoot,
      `${RELEASE}-finalizer-evidence.json`,
    );
    await assert.rejects(
      emitSuccessorFinalizerEvidence({
        ...input,
        repoRoot: state.repoRoot,
        rawOut: insideRaw,
        receiptOut: insideReceipt,
      }),
      (error) => error?.code === "FINALIZER_EVIDENCE_OUTPUT_PATH_INVALID",
    );
    await assert.rejects(readFile(insideRaw), /ENOENT/);
    await writeFile(join(receiptRoot, "unrelated.json"), "{}\n", "utf8");
  } finally {
    await rm(state.repoRoot, { recursive: true, force: true });
    await rm(receiptRoot, { recursive: true, force: true });
  }
});

test("CLI rejects incomplete arguments without echoing environment secrets", () => {
  const secret = "successor-finalizer-cli-secret-must-not-leak";
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(
      "../vendor-disclosure-successor-finalizer-evidence.mjs",
      import.meta.url,
    ))],
    {
      encoding: "utf8",
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: secret },
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr.replace(/\r\n/g, "\n"),
    "SUCCESSOR_FINALIZER_EVIDENCE_BLOCKED [ARGUMENT_INVALID]\n",
  );
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test("CLI render and evidence modes bind the raw input bytes and a clean pushed commit", async () => {
  const state = await fixture();
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-finalizer-cli-"));
  const ownerPath = join(receiptRoot, "owner.json");
  const templatePath = join(receiptRoot, "template.json");
  const canaryPath = join(receiptRoot, "canary.json");
  const featureOffPath = join(receiptRoot, "feature-off.json");
  const dryPath = join(receiptRoot, `${RELEASE}-finalizer-dry-rehearsal.json`);
  const rawOut = join(receiptRoot, `${RELEASE}-finalizer-raw.json`);
  const receiptOut = join(receiptRoot, `${RELEASE}-finalizer-evidence.json`);
  const loadReleaseContract = async () => ({
    deploymentBlocked: false,
    controllerReady: true,
    manifest: state.manifest,
    controllerManifest: state.controllerManifest,
  });
  const gitState = {
    expectedCommit: COMMIT,
    actualCommit: COMMIT,
    upstreamCommit: COMMIT,
    remoteCommit: COMMIT,
    remoteRef: "origin/codex/successor-finalizer",
    worktreeClean: true,
  };
  const inspectGitCandidate = async () => gitState;
  try {
    await writeJson(ownerPath, state.ownerLeaseReceipt);
    const canarySha256 = await writeJson(canaryPath, state.canaryFenceReceipt);
    await writeJson(featureOffPath, state.featureOffReceipt);
    state.templateContractReceipt.renderEvidence.canaryReceiptSha256 = canarySha256;
    await writeJson(templatePath, state.templateContractReceipt);
    const commonArgs = [
      `--expected-commit=${COMMIT}`,
      "--remote-ref=origin/codex/successor-finalizer",
      `--owner-lease-receipt=${ownerPath}`,
      `--template-contract-receipt=${templatePath}`,
      `--canary-fence-receipt=${canaryPath}`,
      `--feature-off-receipt=${featureOffPath}`,
    ];
    const rendered = await runSuccessorFinalizerEvidenceCli({
      repoRoot: state.repoRoot,
      argv: [
        "--mode=render-rehearsal",
        ...commonArgs,
        `--dry-rehearsal-out=${dryPath}`,
      ],
      loadReleaseContract,
      inspectGitCandidate,
      now: () => NOW,
    });
    assert.equal(rendered.mode, "render-rehearsal");
    assert.equal(rendered.rehearsal.databaseExecutionAttempted, false);
    const emitted = await runSuccessorFinalizerEvidenceCli({
      repoRoot: state.repoRoot,
      argv: [
        "--mode=emit-evidence",
        ...commonArgs,
        `--dry-rehearsal-receipt=${dryPath}`,
        `--raw-out=${rawOut}`,
        `--receipt-out=${receiptOut}`,
      ],
      loadReleaseContract,
      inspectGitCandidate,
      now: () => NOW,
    });
    assert.equal(emitted.mode, "emit-evidence");
    assert.deepEqual(
      JSON.parse(await readFile(receiptOut, "utf8")),
      emitted.receipt,
    );
    assert.equal(
      emitted.raw.inputProvenance.canaryFenceReceiptSha256,
      canarySha256,
    );
    assert.deepEqual(emitted.raw.git, {
      actualCommit: COMMIT,
      upstreamCommit: COMMIT,
      remoteCommit: COMMIT,
      remoteRef: "origin/codex/successor-finalizer",
      worktreeClean: true,
    });
  } finally {
    await rm(state.repoRoot, { recursive: true, force: true });
    await rm(receiptRoot, { recursive: true, force: true });
  }
});

test("git fence requires clean HEAD, upstream and live remote branch at the same commit", async () => {
  const remoteRef = "origin/codex/successor-finalizer";
  const runGit = async (_repoRoot, args) => {
    const command = args.join(" ");
    if (command === "status --porcelain=v1 --untracked-files=all") return "";
    if (command === "rev-parse HEAD") return `${COMMIT}\n`;
    if (command === "rev-parse --verify @{upstream}") return `${COMMIT}\n`;
    if (command === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") {
      return `${remoteRef}\n`;
    }
    if (command === "ls-remote --exit-code origin refs/heads/codex/successor-finalizer") {
      return `${COMMIT}\trefs/heads/codex/successor-finalizer\n`;
    }
    throw new Error(`unexpected git command: ${command}`);
  };
  const result = await inspectSuccessorFinalizerGitCandidate({
    repoRoot: SOURCE_ROOT,
    expectedCommit: COMMIT,
    remoteRef,
    runGit,
  });
  assert.equal(result.worktreeClean, true);
  await assert.rejects(
    inspectSuccessorFinalizerGitCandidate({
      repoRoot: SOURCE_ROOT,
      expectedCommit: COMMIT,
      remoteRef,
      runGit: async (root, args) => (
        args[0] === "status" ? "?? untracked.json\n" : runGit(root, args)
      ),
    }),
    (error) => error?.code === "FINALIZER_RELEASE_COMMIT_NOT_PUSHED",
  );
  await assert.rejects(
    inspectSuccessorFinalizerGitCandidate({
      repoRoot: SOURCE_ROOT,
      expectedCommit: COMMIT,
      remoteRef,
      runGit: async (root, args) => (
        args[0] === "ls-remote"
          ? `${"9".repeat(40)}\trefs/heads/codex/successor-finalizer\n`
          : runGit(root, args)
      ),
    }),
    (error) => error?.code === "FINALIZER_RELEASE_COMMIT_NOT_PUSHED",
  );
});

test("emitted receipt is accepted unchanged by the central five-evidence validator", async () => {
  const state = await fixture();
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-finalizer-central-"));
  try {
    const input = completeEvidenceInputs(state);
    const finalizerContract = state.manifest.deploymentEvidence.finalizer;
    await emitSuccessorFinalizerEvidence({
      ...input,
      repoRoot: state.repoRoot,
      rawOut: join(receiptRoot, finalizerContract.rawEvidenceFileName),
      receiptOut: join(receiptRoot, finalizerContract.receiptFileName),
    });
    const migrationVersionsSha256 = textListSha256(VERSIONS);
    const postApplyChecksSha256 = textListSha256(POSTCHECK_IDS);
    const rollbackContractSha256 = canonicalJsonSha256(
      state.controllerManifest.rollbackContract,
    );
    const observations = {
      backup: {
        backupContractId: state.controllerManifest.backupContract.id,
        backupContractVersion: state.controllerManifest.backupContract.version,
        expectedMigrationHead:
          state.controllerManifest.backupContract.expectedMigrationHead,
        expectedTableCount:
          state.controllerManifest.backupContract.expectedTableCount,
        expectedTableContractSha256:
          state.controllerManifest.backupContract.expectedTableContractSha256,
        providerPhysicalBackupStatus: "COMPLETED",
        restoreCandidateAvailable: true,
      },
      hostedStaging: {
        expectedMigrationHead: VERSIONS.at(-1),
        migrationCount: VERSIONS.length,
        migrationVersionsSha256,
        requiredRemoteHead: state.manifest.requiredRemoteHead,
        rollbackStrategy: state.controllerManifest.rollbackContract.strategy,
      },
      storage: {
        encryptedBackupArtifactSha256: "a".repeat(64),
        encryptedBackupArtifactSize: 1024,
        objectCount: 2,
        objectInventorySha256: "B".repeat(64),
        originalBytesBackupReceiptSha256: "c".repeat(64),
        originalBytesBackupSetId: "12345678-1234-4123-8123-123456789abc",
        originalBytesManifestSha256: "d".repeat(64),
        originalBytesPrivateRawSha256: "e".repeat(64),
        requiredMutationPolicyCount: 0,
        signedUploadGraceMinutes: 10,
        signedUploadTokenTtlMinutes: 120,
        storageDrainFinalInventoryReceiptSha256: "f".repeat(64),
        storageDrainFirstInventoryReceiptSha256: "1".repeat(64),
        storageDrainStartReceiptSha256: "2".repeat(64),
        storageStabilityWindowMinutes: 5,
        totalOriginalBytes: 321,
        writeFenceReceiptFileName:
          state.controllerManifest.manualControlEvidence.receiptFileName,
        writeFenceReceiptSha256: "3".repeat(64),
      },
    };
    const written = {};
    for (const name of ["backup", "hostedStaging", "storage"]) {
      const contract = state.manifest.deploymentEvidence[name];
      const rawValue = name === "storage" ? {
        rawEvidenceVersion: 1,
        kind: "vendor-disclosure-successor-storage-raw-v1",
        release: RELEASE,
        projectRef: PROJECT_REF,
        releaseCommit: COMMIT,
        capturedAt: NOW.toISOString(),
        writeFence: {
          receiptFileName:
            state.controllerManifest.manualControlEvidence.receiptFileName,
          receiptSha256: "3".repeat(64),
          verifiedAt: "2026-08-19T05:29:00.000Z",
          controls: {
            supabaseAuthSignupDisabled: true,
            vercelDeploymentCommit: COMMIT,
            vercelProductionWriteFenceEnabled: true,
          },
          databaseWriteFence: {
            attachFunctionCount: 1,
            eventTriggerCount: 2,
            guardFunctionCount: 1,
            liveSchemaContractFunctionCount: 1,
            publicTableCount: 139,
            triggerCount: 139,
          },
        },
        signedUploadDrain: {
          startReceiptFileName: `${RELEASE}-storage-drain-start.json`,
          startReceiptSha256: "2".repeat(64),
          freezeVerifiedAt: "2026-08-19T05:10:00.000Z",
          signedUploadTokenTtlMinutes: 120,
          signedUploadGraceMinutes: 10,
          storageStabilityWindowMinutes: 5,
          mutationPolicyCount: 0,
          stableInventories: [
            {
              receiptFileName: `${RELEASE}-storage-drain-first.json`,
              receiptSha256: "1".repeat(64),
              observedAt: "2026-08-19T05:15:00.000Z",
              totalObjectCount: 2,
              objectInventorySha256: "B".repeat(64),
            },
            {
              receiptFileName: `${RELEASE}-storage-drain-final.json`,
              receiptSha256: "f".repeat(64),
              observedAt: "2026-08-19T05:20:00.000Z",
              totalObjectCount: 2,
              objectInventorySha256: "B".repeat(64),
            },
          ],
        },
        originalBytesBackup: {
          receiptFileName: `${RELEASE}-storage-original-bytes.json`,
          receiptSha256: "c".repeat(64),
          backupSetId: "12345678-1234-4123-8123-123456789abc",
          sourceInventoryCapturedAt: "2026-08-19T05:20:00.000Z",
          capturedAt: "2026-08-19T05:21:00.000Z",
          verifiedAt: "2026-08-19T05:22:00.000Z",
          bucketCount: 1,
          objectCount: 2,
          totalOriginalBytes: 321,
          objectInventorySha256: "B".repeat(64),
          originalBytesManifestSha256: "d".repeat(64),
          encryptedBackupArtifactSha256: "a".repeat(64),
          privateRawSha256: "e".repeat(64),
          encryptedArtifactSize: 1024,
          encryptedArtifactDev: "123",
          encryptedArtifactIno: "456",
          everyInventoryObjectIncluded: true,
          originalByteDigestsVerified: true,
          encryptedArtifactVerified: true,
          restoreCandidateAvailable: true,
          plaintextWrittenToDisk: false,
        },
        containsSecrets: false,
      } : {
        kind: `${name}-test-raw`,
        capturedAt: NOW.toISOString(),
        containsSecrets: false,
      };
      const rawText = `${JSON.stringify(rawValue)}\n`;
      await writeFile(join(receiptRoot, contract.rawEvidenceFileName), rawText, "utf8");
      const rawEvidenceSha256 = sha256(rawText);
      const receiptSha256 = await writeJson(
        join(receiptRoot, contract.receiptFileName),
        {
        receiptVersion: 1,
        kind: contract.kind,
        release: RELEASE,
        projectRef: PROJECT_REF,
        releaseCommit: COMMIT,
        capturedAt: NOW.toISOString(),
        expiresAt: new Date(
          NOW.getTime() + contract.maximumAgeMinutes * 60_000,
        ).toISOString(),
        requiredRemoteHead: state.manifest.requiredRemoteHead,
        expectedMigrationHead: VERSIONS.at(-1),
        migrationCount: VERSIONS.length,
        migrationVersionsSha256,
        observations: observations[name],
        postApplyCheckIds: POSTCHECK_IDS,
        postApplyChecksSha256,
        rollbackContractSha256,
        checks: Object.fromEntries(
          contract.requiredChecks.map((check) => [check, true]),
        ),
        rawProvenance: {
          fileName: contract.rawEvidenceFileName,
          sha256: rawEvidenceSha256,
          capturedAt: NOW.toISOString(),
          source: contract.rawEvidenceSource,
        },
        containsSecrets: false,
        },
      );
      written[name] = { rawEvidenceSha256, receiptSha256 };
    }
    const recoveryContract =
      state.manifest.deploymentEvidence.recoveryAssurance;
    const recoveryRawText = `${JSON.stringify({
      kind: "recovery-assurance-test-raw",
      capturedAt: NOW.toISOString(),
      containsSecrets: false,
    })}\n`;
    const recoveryRawSha256 = sha256(recoveryRawText);
    await writeFile(
      join(receiptRoot, recoveryContract.rawEvidenceFileName),
      recoveryRawText,
      "utf8",
    );
    await writeJson(join(receiptRoot, recoveryContract.receiptFileName), {
      receiptVersion: 1,
      kind: recoveryContract.kind,
      release: RELEASE,
      projectRef: PROJECT_REF,
      releaseCommit: COMMIT,
      capturedAt: NOW.toISOString(),
      expiresAt: new Date(
        NOW.getTime() + recoveryContract.maximumAgeMinutes * 60_000,
      ).toISOString(),
      requiredRemoteHead: state.manifest.requiredRemoteHead,
      expectedMigrationHead: VERSIONS.at(-1),
      migrationCount: VERSIONS.length,
      migrationVersionsSha256,
      observations: {
        backupContractId: state.controllerManifest.backupContract.id,
        hostedStagingRawEvidenceSha256:
          written.hostedStaging.rawEvidenceSha256,
        hostedStagingReceiptSha256:
          written.hostedStaging.receiptSha256,
        postExpandBackupContractId:
          state.controllerManifest.postExpandBackupContract.id,
        postExpandBackupManifestSha256: "1".repeat(64),
        postExpandBackupReceiptSha256: "2".repeat(64),
        postExpandBackupReverificationSha256: "3".repeat(64),
        postExpandEncryptedArtifactsVerified: true,
        postExpandLiveSchemaContractSha256: "4".repeat(64),
        postExpandLogicalDataContractSha256: "5".repeat(64),
        postExpandPGliteJsonbRoundTripVerified: true,
        preApplyBackupRawEvidenceSha256:
          written.backup.rawEvidenceSha256,
        preApplyBackupReceiptSha256: written.backup.receiptSha256,
        providerPhysicalBackupStatus: "COMPLETED",
      },
      postApplyCheckIds: POSTCHECK_IDS,
      postApplyChecksSha256,
      rollbackContractSha256,
      checks: Object.fromEntries(
        recoveryContract.requiredChecks.map((check) => [check, true]),
      ),
      rawProvenance: {
        fileName: recoveryContract.rawEvidenceFileName,
        sha256: recoveryRawSha256,
        capturedAt: NOW.toISOString(),
        source: recoveryContract.rawEvidenceSource,
      },
      containsSecrets: false,
      releaseAssurance: structuredClone(
        SUCCESSOR_NO_ADDITIONAL_COST_RELEASE_ASSURANCE,
      ),
    });
    const result = validateSuccessorRuntimeEvidence({
      repoRoot: state.repoRoot,
      receiptRoot,
      manifest: state.manifest,
      controllerManifest: state.controllerManifest,
      expectedCommit: COMMIT,
      now: () => new Date("2026-08-19T05:31:00.000Z"),
    });
    assert.equal(result.finalizer.verifiedAt, NOW.toISOString());
    assert.match(result.finalizer.receiptSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(state.repoRoot, { recursive: true, force: true });
    await rm(receiptRoot, { recursive: true, force: true });
  }
});

test("a raw write failure unlinks its created inode and durably resyncs the parent", async () => {
  const state = await fixture();
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-finalizer-fault-"));
  const rawOut = join(receiptRoot, `${RELEASE}-finalizer-raw.json`);
  const receiptOut = join(receiptRoot, `${RELEASE}-finalizer-evidence.json`);
  const openCalls = [];
  const syncedParents = [];
  const fileOps = {
    open: async (path, flags, mode) => {
      openCalls.push({ path, flags, mode });
      const handle = await open(path, flags, mode);
      return {
        writeFile: async () => {
          await handle.writeFile("{", "utf8");
          throw new Error("injected raw write failure");
        },
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
    rm,
    lstat,
    syncParent: async (path) => { syncedParents.push(path); },
  };
  try {
    await assert.rejects(
      emitSuccessorFinalizerEvidence({
        ...completeEvidenceInputs(state),
        repoRoot: state.repoRoot,
        rawOut,
        receiptOut,
        fileOps,
      }),
      (error) => error?.code === "FINALIZER_EVIDENCE_OUTPUT_WRITE_FAILED",
    );
    await assert.rejects(readFile(rawOut), /ENOENT/);
    await assert.rejects(readFile(receiptOut), /ENOENT/);
    assert.deepEqual(
      openCalls.map(({ flags, mode }) => ({ flags, mode })),
      [{ flags: "wx", mode: 0o600 }],
    );
    assert.deepEqual(syncedParents, [receiptRoot]);
  } finally {
    await rm(state.repoRoot, { recursive: true, force: true });
    await rm(receiptRoot, { recursive: true, force: true });
  }
});

test("a receipt write failure durably removes both the partial receipt and completed raw sibling", async () => {
  const state = await fixture();
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-finalizer-pair-fault-"));
  const rawOut = join(receiptRoot, `${RELEASE}-finalizer-raw.json`);
  const receiptOut = join(receiptRoot, `${RELEASE}-finalizer-evidence.json`);
  const openCalls = [];
  const syncedParents = [];
  const fileOps = {
    open: async (path, flags, mode) => {
      openCalls.push({ path, flags, mode });
      const handle = await open(path, flags, mode);
      if (path === receiptOut) {
        return {
          writeFile: async () => {
            await handle.writeFile("{", "utf8");
            throw new Error("injected receipt write failure");
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      }
      return handle;
    },
    rm,
    lstat,
    syncParent: async (path) => { syncedParents.push(path); },
  };
  try {
    await assert.rejects(
      emitSuccessorFinalizerEvidence({
        ...completeEvidenceInputs(state),
        repoRoot: state.repoRoot,
        rawOut,
        receiptOut,
        fileOps,
      }),
      (error) => error?.code === "FINALIZER_EVIDENCE_OUTPUT_WRITE_FAILED",
    );
    await assert.rejects(readFile(rawOut), /ENOENT/);
    await assert.rejects(readFile(receiptOut), /ENOENT/);
    assert.deepEqual(
      openCalls.map(({ flags, mode }) => ({ flags, mode })),
      [
        { flags: "wx", mode: 0o600 },
        { flags: "wx", mode: 0o600 },
      ],
    );
    assert.deepEqual(syncedParents, [receiptRoot, receiptRoot, receiptRoot]);
  } finally {
    await rm(state.repoRoot, { recursive: true, force: true });
    await rm(receiptRoot, { recursive: true, force: true });
  }
});

test("render-only output failure also unlinks its inode and resyncs the parent", async () => {
  const state = await fixture();
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-finalizer-render-fault-"));
  const rehearsalOut = join(
    receiptRoot,
    `${RELEASE}-finalizer-dry-rehearsal.json`,
  );
  const syncedParents = [];
  const fileOps = {
    open: async (path, flags, mode) => {
      assert.equal(flags, "wx");
      assert.equal(mode, 0o600);
      const handle = await open(path, flags, mode);
      return {
        writeFile: async () => {
          await handle.writeFile("{", "utf8");
          throw new Error("injected rehearsal write failure");
        },
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
    rm,
    lstat,
    syncParent: async (path) => { syncedParents.push(path); },
  };
  try {
    await assert.rejects(
      emitSuccessorFinalizerRenderOnlyRehearsal({
        ...state,
        repoRoot: state.repoRoot,
        rehearsalOut,
        expectedCommit: COMMIT,
        fileOps,
        now: () => NOW,
      }),
      (error) => error?.code === "FINALIZER_EVIDENCE_OUTPUT_WRITE_FAILED",
    );
    await assert.rejects(readFile(rehearsalOut), /ENOENT/);
    assert.deepEqual(syncedParents, [receiptRoot]);
  } finally {
    await rm(state.repoRoot, { recursive: true, force: true });
    await rm(receiptRoot, { recursive: true, force: true });
  }
});
