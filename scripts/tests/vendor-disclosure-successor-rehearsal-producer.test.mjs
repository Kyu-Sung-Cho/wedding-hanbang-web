import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  produceSuccessorRehearsalReceipts,
  runForwardFixRehearsalWorker,
  runLocalIsolatedRehearsalWorker,
  runReadOnlyStagingPostcheckObservation,
  validateSuccessorRehearsalProducerProvenance,
  writeDurableExclusiveReceiptSet,
} from "../lib/vendor-disclosure-successor-rehearsal-producer.mjs";
import {
  runSuccessorRehearsalProducerCli,
} from "../vendor-disclosure-successor-rehearsal-producer.mjs";

const SOURCE_ROOT = resolve(import.meta.dirname, "../..");
const RELEASE = "vendor-disclosure-v2-20260718";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const STAGING_REF = "rgxdizztidbgwnsbadml";
const COMMIT = "a".repeat(40);
const OWNER = "11111111-1111-4111-8111-111111111111";
const BACKUP_SET = "22222222-2222-4222-8222-222222222222";
const OPERATION_FILE =
  "supabase/platform-operations/security/20260819122000_production_write_fence_successor_finalize.sql";
const CONTROLS = Object.freeze({
  AMORA_AUXILIARY_MEMORY_ENABLED: "false",
  AMORA_COST_GUARD_ENABLED: "true",
});
const ROLLBACK_CHECKS = Object.freeze([
  "databaseWriteFenceHeld",
  "storageWriteFenceHeld",
  "authSignupDisabled",
  "webWriteFenceEnabled",
  "chatPartnerRecipientBoundaryHeld",
  "conversationSegmentScopeBoundaryHeld",
]);
const CANARY_CHECKS = Object.freeze([
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

function execution(report) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputTruncated: false,
    stdout: `${JSON.stringify(report)}\n`,
    stderr: "",
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    executableSha256: "1".repeat(64),
    scriptSha256: "2".repeat(64),
    librarySha256: "3".repeat(64),
    stdinSha256: "4".repeat(64),
    command: report.kind.includes("forward-fix") ? "node:forward-fix" : "node:isolated",
  };
}

function postcheckObservation(request) {
  const requestBody = JSON.stringify({ query: request.sqlText });
  const bodyText = JSON.stringify([request.expectedRow]);
  return {
    observationVersion: 1,
    kind: "successor-staging-read-only-postcheck-http-observation-v1",
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    transactionReadOnly: true,
    sqlSha256: request.sqlSha256,
    request: {
      method: "POST",
      path: `/v1/projects/${STAGING_REF}/database/query/read-only`,
      bodySha256: sha256(requestBody),
    },
    response: {
      status: 201,
      bodyText,
      bodySha256: sha256(bodyText),
      row: request.expectedRow,
    },
    startedAt: "2026-08-19T05:19:00.000Z",
    completedAt: "2026-08-19T05:19:01.000Z",
    productionMutationCommandCount: 0,
    containsSecrets: false,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "successor-rehearsal-producer-"));
  const repoRoot = join(root, "repo");
  const receiptRoot = join(root, "private-receipts");
  await mkdir(repoRoot);
  await mkdir(receiptRoot);
  for (const relativeFile of [
    "scripts/vendor-disclosure-successor-rehearsal-producer.mjs",
    "scripts/lib/vendor-disclosure-successor-rehearsal-producer.mjs",
    "apps/web/src/lib/price/productionBuildFence.test.ts",
    "apps/web/node_modules/vitest/vitest.mjs",
  ]) {
    const target = join(repoRoot, ...relativeFile.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(SOURCE_ROOT, ...relativeFile.split("/")), target);
  }
  const templatePath = join(repoRoot, ...OPERATION_FILE.split("/"));
  await mkdir(dirname(templatePath), { recursive: true });
  await copyFile(join(SOURCE_ROOT, ...OPERATION_FILE.split("/")), templatePath);
  const templateText = await readFile(templatePath, "utf8");
  const sqlFile = "supabase/release-checks/successor-post.sql";
  const sqlText = "BEGIN TRANSACTION READ ONLY;\nSELECT 1;\nROLLBACK;\n";
  const sqlPath = join(repoRoot, ...sqlFile.split("/"));
  await mkdir(dirname(sqlPath), { recursive: true });
  await writeFile(sqlPath, sqlText, "utf8");
  const approvalPath = join(
    repoRoot,
    "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json",
  );
  await mkdir(dirname(approvalPath), { recursive: true });
  await writeFile(approvalPath, `${JSON.stringify({
    release: RELEASE,
    productionProjectRef: PRODUCTION_REF,
    projectRef: STAGING_REF,
    approved: true,
    status: "approved_for_hosted_rls_probe",
  })}\n`, "utf8");
  const versions = ["20260818190000", "20260819100000"];
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName: `${RELEASE}-feature-off-rollback.json`,
    maximumAgeMinutes: 30,
    requiredControls: { ...CONTROLS },
    requiredChecks: [...ROLLBACK_CHECKS],
  };
  const expectedEvidence = {
    chat_partner_recipient_select_policy_count: 1,
    chat_partner_recipient_trigger_count: 1,
    conversation_segment_active_index_count: 3,
    conversation_segment_rls_policy_count: 1,
    conversation_segment_rpc_acl_count: 1,
    conversation_segment_scope_fk_count: 2,
  };
  const manifest = {
    release: RELEASE,
    projectRef: PRODUCTION_REF,
    status: "controller_ready",
    requiredRemoteHead: "20260818180000",
    expandMigrations: versions.map((version) => ({
      file: `${version}_fixture.sql`, sha256: "a".repeat(64),
    })),
    deploymentEvidence: {
      finalizer: {
        kind: "successor-release-finalizer-rehearsal-evidence-v1",
        maximumAgeMinutes: 1_440,
        rawEvidenceFileName: `${RELEASE}-finalizer-raw.json`,
        rawEvidenceSource: "exact-owner-finalizer-rehearsal",
        receiptFileName: `${RELEASE}-finalizer-evidence.json`,
        requiredChecks: [
          "exactOwnerLeaseVerified",
          "templateRenderedWithSuccessorContracts",
          "canaryFenceHeld",
          "featureOffRollbackAvailable",
          "finalizerRehearsalPassed",
        ],
      },
      recoveryAssurance: {
        kind: "successor-release-recovery-assurance-v1",
        maximumAgeMinutes: 30,
        rawEvidenceFileName: `${RELEASE}-recovery-assurance-raw.json`,
        rawEvidenceSource:
          "existing-staging-and-encrypted-backup-assurance",
        receiptFileName: `${RELEASE}-recovery-assurance-evidence.json`,
        requiredChecks: [
          "providerPhysicalBackupFresh",
          "encryptedLogicalBackupVerified",
          "postExpandEncryptedBackupVerified",
          "stagingExactMigrationSetVerified",
          "restoreNotClaimed",
        ],
        releaseAssurance: {
          additionalMonthlyCostUsd: 0,
          additionalProjectCreated: false,
          hostedRestorePerformed: false,
          restoreValidationClaimed: false,
          limitations: [
            "no hosted Supabase restore rehearsal was performed",
            "provider physical backup availability does not prove a successful restore",
            "encrypted logical/PGlite roundtrip does not prove a hosted Supabase restore",
            "Staging verification does not prove Production backup restorability",
          ],
        },
      },
    },
  };
  const controllerManifest = {
    release: RELEASE,
    projectRef: PRODUCTION_REF,
    rollbackContract,
    postApplyChecks: [{
      id: "successor-postcheck",
      type: "read-only-sql",
      file: sqlFile,
      sha256: sha256(sqlText),
      expectedEvidence,
    }],
    postExpandBackupContract: {
      version: 2,
      expectedTableContractSha256: "b".repeat(64),
      expectedReleaseMigrationContractSha256: textListSha256(versions),
    },
    finalizationContract: {
      id: "production-write-fence-exact-owner-finalizer",
      version: 2,
      operation: {
        id: "production-write-fence-successor-finalize-20260819122000",
        file: OPERATION_FILE,
        sha256: sha256(templateText.replace(/\r\n?/g, "\n")),
      },
      requiredLeasePhase: "deployment-canary",
      canaryMaximumAgeMinutes: 15,
      deploymentMaximumAgeMinutes: 1_440,
      requiredCanaryChecks: [...CANARY_CHECKS],
      confirmationIncludesCanarySha256: true,
    },
  };
  const inputRoot = join(root, "private-inputs");
  await mkdir(inputRoot);
  const inputs = {
    probe: {
      receiptVersion: 8,
      kind: "amora-successor-hosted-staging-probe",
      projectRef: STAGING_REF,
      gitCommit: COMMIT,
    },
    backup: {
      receiptVersion: 2,
      kind: "successor-post-expand-backup-verification-v2",
      release: RELEASE,
      projectRef: PRODUCTION_REF,
      releaseCommit: COMMIT,
      backupSetId: BACKUP_SET,
      backupManifestSha256: "a".repeat(64),
      liveSchemaContractSha256: "b".repeat(64),
      logicalDataContractSha256: "c".repeat(64),
      containsSecrets: false,
    },
  };
  const paths = {};
  for (const [name, value] of Object.entries(inputs)) {
    paths[name] = join(inputRoot, `${name}.json`);
    await writeFile(paths[name], `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  const isolatedReport = {
    workerVersion: 1,
    kind: "successor-local-isolated-rehearsal-observation-v1",
    release: RELEASE,
    releaseCommit: COMMIT,
    deploymentId: "dpl_abcdefghijklmnopqrstuvwx",
    startedAt: "2026-08-19T05:20:00.000Z",
    completedAt: "2026-08-19T05:25:00.000Z",
    networkScope: "loopback-only",
    databaseScope: "ephemeral-pglite",
    productionMutationCommandCount: 0,
    facts: {
      repositoryTest: {
        command: "node:vitest:production-build-fence",
        exitCode: 0,
        stdoutSha256: "5".repeat(64),
        stderrSha256: sha256(""),
        testFileSha256: sha256(await readFile(join(
          repoRoot,
          "apps/web/src/lib/price/productionBuildFence.test.ts",
        ))),
        runnerSha256: sha256(await readFile(join(
          repoRoot,
          "apps/web/node_modules/vitest/vitest.mjs",
        ))),
        durationMs: 250,
      },
      database: {
        systemIdentifier: "7000000000000000001",
        leaseOwnerId: OWNER,
        leasePhase: "deployment-canary",
        leaseRowCount: 1,
        ownerObservationTransactionMode: "read-only",
        duplicateLeaseSqlstate: "23505",
        appWriteSqlstate: "25006",
        storageWriteSqlstate: "25006",
      },
      featureOff: { observedControls: { ...CONTROLS } },
      canary: {
        publicReadStatus: 200,
        authenticatedReadStatus: 200,
        loginStatus: 204,
        logoutStatus: 204,
        signupStatus: 403,
        storageUploadStatus: 403,
        webFenceStatus: 503,
        databaseFenceStatus: 503,
        deployedCommitHeader: COMMIT,
        webFenceError: "production_write_fence_enabled",
        cacheControl: "no-store",
        consoleErrorCount: 0,
        pageErrorCount: 0,
        requestFailedCount: 0,
        unexpected5xxCount: 0,
        serverErrorCount: 0,
        maximumLatencyMs: 100,
        externalRequestCount: 0,
        loopbackOriginSha256: "d".repeat(64),
      },
    },
    containsSecrets: false,
  };
  const forwardReport = {
    workerVersion: 1,
    kind: "successor-forward-fix-local-rehearsal-observation-v1",
    rehearsalRunId: "33333333-3333-4333-8333-333333333333",
    startedAt: "2026-08-19T05:25:00.000Z",
    completedAt: "2026-08-19T05:25:01.000Z",
    productionMutationCommandCount: 0,
    facts: null,
    containsSecrets: false,
  };
  return {
    root,
    repoRoot,
    receiptRoot,
    manifest,
    controllerManifest,
    paths,
    isolatedReport,
    forwardReport,
  };
}

test("tracer: successor rehearsal producer is exposed", () => {
  assert.equal(typeof produceSuccessorRehearsalReceipts, "function");
});

test("producer CLI has side-effect-free help and one exact non-secret argument set", async () => {
  assert.deepEqual(await runSuccessorRehearsalProducerCli({ argv: ["--help"] }), {
    help: true,
  });
  const privateRoot = resolve(tmpdir(), "successor-cli-private");
  let captured;
  const result = await runSuccessorRehearsalProducerCli({
    repoRoot: SOURCE_ROOT,
    argv: [
      `--expected-commit=${COMMIT}`,
      `--post-expand-backup-receipt=${join(privateRoot, "backup.json")}`,
      `--probe-receipt=${join(privateRoot, "probe.json")}`,
      `--receipt-root=${privateRoot}`,
      "--remote-ref=origin/codex/successor-rehearsal",
    ],
    produce: async (input) => {
      captured = input;
      return { status: "captured" };
    },
    inspectGitCandidate: async () => assert.fail("producer injection owns the call"),
  });
  assert.equal(result.result.status, "captured");
  assert.equal(captured.expectedCommit, COMMIT);
  assert.equal(captured.receiptRoot, privateRoot);
  assert.equal(Object.hasOwn(captured, "postcheckReceiptPath"), false);
  await assert.rejects(
    () => runSuccessorRehearsalProducerCli({ argv: ["--expected-commit=secret"] }),
    (error) => error?.code === "ARGUMENT_INVALID",
  );
});

test("isolated worker uses real PGlite read-only errors and loopback Chromium observations", async () => {
  const report = await runLocalIsolatedRehearsalWorker({
    repoRoot: SOURCE_ROOT,
    input: {
      release: RELEASE,
      releaseCommit: COMMIT,
      leasePhase: "deployment-canary",
      requiredControlNames: Object.keys(CONTROLS).sort(),
      observationWindowSeconds: 0,
    },
    environment: CONTROLS,
  });
  assert.equal(report.networkScope, "loopback-only");
  assert.equal(report.databaseScope, "ephemeral-pglite");
  assert.equal(report.productionMutationCommandCount, 0);
  assert.equal(report.facts.database.duplicateLeaseSqlstate, "23505");
  assert.equal(report.facts.database.appWriteSqlstate, "25006");
  assert.equal(report.facts.database.storageWriteSqlstate, "25006");
  assert.equal(report.facts.canary.publicReadStatus, 200);
  assert.equal(report.facts.canary.webFenceStatus, 503);
  assert.equal(report.facts.canary.externalRequestCount, 0);
  assert.deepEqual(report.facts.featureOff.observedControls, CONTROLS);
  assert.equal(Object.values(report.facts).includes(true), false);
});

test("forward worker reports counts and digests rather than accepting a passed boolean", () => {
  const featureReceiptText = `${JSON.stringify({
    observedControls: CONTROLS,
    checks: Object.fromEntries(ROLLBACK_CHECKS.map((name) => [name, true])),
  })}\n`;
  const plan = { strategy: "forward-fix-feature-off", migrationRollback: "prohibited" };
  const report = runForwardFixRehearsalWorker({
    input: {
      featureReceiptText,
      plan,
      expectedControls: CONTROLS,
      expectedChecks: ROLLBACK_CHECKS,
    },
  });
  assert.equal(report.facts.featureReceiptSha256, sha256(featureReceiptText));
  assert.equal(report.facts.falseCheckCount, 0);
  assert.equal(report.facts.observedControlMismatchCount, 0);
  assert.equal(report.facts.migrationRollbackCommandCount, 0);
  assert.equal(report.facts.remoteEndpointCount, 0);
  assert.equal(Object.hasOwn(report, "passed"), false);
});

test("staging postcheck observation sends only the pinned read-only SQL and redacts authorization", async () => {
  const sqlText = "BEGIN TRANSACTION READ ONLY;\nSELECT true AS verified;\nROLLBACK;\n";
  const token = "supabase-test-token-never-persisted";
  let captured;
  const report = await runReadOnlyStagingPostcheckObservation({
    stagingProjectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    sqlText,
    sqlSha256: sha256(sqlText),
    expectedRow: { verified: true },
    environment: { SUPABASE_ACCESS_TOKEN: token },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify([{ verified: true }]), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(captured.url.includes(PRODUCTION_REF), false);
  assert.equal(captured.url.includes(STAGING_REF), true);
  assert.match(captured.url, /\/database\/query\/read-only$/);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.body, JSON.stringify({ query: sqlText }));
  assert.equal(captured.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(report.transactionReadOnly, true);
  assert.equal(report.productionMutationCommandCount, 0);
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.deepEqual(report.response.row, { verified: true });
});

test("producer derives exact hosted/finalizer receipts and durable raw provenance", async () => {
  const state = await fixture();
  const workerCalls = [];
  try {
    const result = await produceSuccessorRehearsalReceipts({
      repoRoot: state.repoRoot,
      receiptRoot: state.receiptRoot,
      expectedCommit: COMMIT,
      remoteRef: "origin/codex/successor-rehearsal",
      probeReceiptPath: state.paths.probe,
      postExpandBackupReceiptPath: state.paths.backup,
      releaseLoader: async () => ({
        controllerReady: true,
        deploymentBlocked: false,
        manifest: state.manifest,
        controllerManifest: state.controllerManifest,
      }),
      inspectGitCandidate: async () => ({
        expectedCommit: COMMIT,
        actualCommit: COMMIT,
        upstreamCommit: COMMIT,
        remoteCommit: COMMIT,
        remoteRef: "origin/codex/successor-rehearsal",
        worktreeClean: true,
      }),
      runWorker: async (request) => {
        workerCalls.push(request);
        if (request.mode === "isolated") return execution(state.isolatedReport);
        const featureText = request.input.featureReceiptText;
        const forward = structuredClone(state.forwardReport);
        forward.facts = {
          featureReceiptSha256: sha256(featureText),
          planSha256: request.input.expectedPlanSha256,
          observedControlMismatchCount: 0,
          falseCheckCount: 0,
          migrationRollbackCommandCount: 0,
          remoteEndpointCount: 0,
        };
        return execution(forward);
      },
      runReadOnlyPostcheck: async (request) => {
        assert.deepEqual(request.expectedRow, {
          verified: true,
          ...state.controllerManifest.postApplyChecks[0].expectedEvidence,
        });
        return postcheckObservation(request);
      },
      validateHostedConsumer: async (input) => {
        assert.equal(JSON.parse(input.stagingFeatureOffText).projectRef, STAGING_REF);
        assert.equal(JSON.parse(input.forwardFixText).outcome, "passed");
        assert.equal(
          JSON.parse(input.postcheckReceiptText).kind,
          "successor-read-only-postcheck-result-v1",
        );
        return { rawEvidenceSha256: "e".repeat(64), receiptSha256: "f".repeat(64) };
      },
      now: () => new Date("2026-08-19T05:25:01.000Z"),
    });
    assert.equal(result.status, "successor_rehearsal_receipts_emitted");
    assert.equal(workerCalls.length, 2);
    const stagingFeature = JSON.parse(await readFile(result.paths.stagingFeatureOff, "utf8"));
    const finalizerFeature = JSON.parse(await readFile(result.paths.finalizerFeatureOff, "utf8"));
    const forward = JSON.parse(await readFile(result.paths.forwardFix, "utf8"));
    const owner = JSON.parse(await readFile(result.paths.ownerLease, "utf8"));
    const template = JSON.parse(await readFile(result.paths.templateContract, "utf8"));
    const canary = JSON.parse(await readFile(result.paths.canaryFence, "utf8"));
    const dry = JSON.parse(await readFile(result.paths.finalizerDry, "utf8"));
    const postcheckReceipt = JSON.parse(await readFile(result.paths.postcheckReceipt, "utf8"));
    const postcheckRaw = JSON.parse(await readFile(result.paths.postcheckRaw, "utf8"));
    const provenance = JSON.parse(await readFile(result.paths.provenance, "utf8"));
    assert.equal(stagingFeature.projectRef, STAGING_REF);
    assert.equal(finalizerFeature.projectRef, PRODUCTION_REF);
    assert.equal(stagingFeature.receiptFileName, finalizerFeature.receiptFileName);
    assert.equal(forward.featureOffReceiptSha256, result.sha256.stagingFeatureOff);
    assert.equal(owner.leaseCount, 1);
    assert.equal(canary.observationWindowSeconds, 300);
    assert.equal(template.finalizationContractVersion, 2);
    assert.equal(template.renderEvidence.postExpandBackupSetId, BACKUP_SET);
    assert.equal(dry.mode, "render-only-no-database-execution");
    assert.equal(postcheckReceipt.kind, "successor-read-only-postcheck-result-v1");
    assert.deepEqual(Object.keys(postcheckReceipt).sort(), [
      "checkId", "containsSecrets", "executedAt", "kind", "productionMutationAttempted",
      "productionProjectRef", "projectRef", "receiptVersion", "release", "releaseCommit",
      "row", "source", "sqlFile", "sqlSha256", "transactionReadOnly",
    ].sort());
    assert.equal(postcheckReceipt.executedAt, postcheckRaw.completedAt);
    assert.deepEqual(postcheckReceipt.row, postcheckRaw.response.row);
    assert.equal(provenance.artifacts.postcheckReceiptSha256, result.sha256.postcheckReceipt);
    assert.equal(provenance.artifacts.postcheckRawSha256, result.sha256.postcheckRaw);
    assert.equal(
      provenance.scope.networkScope,
      "approved-staging-management-read-only-and-loopback-only",
    );
    assert.equal(
      provenance.scope.environment,
      "approved-existing-staging-read-only-plus-isolated-rehearsal",
    );
    assert.equal(
      provenance.scope.databaseScope,
      "existing-hosted-staging-read-only-and-ephemeral-pglite",
    );
    assert.equal(provenance.scope.productionMutationCommandCount, 0);
    assert.equal(provenance.scope.migrationRollbackCommandCount, 0);
    assert.match(provenance.scope.doesNotProve.join(" "), /Production/);
    assert.equal(JSON.stringify(provenance).includes("password"), false);
  } finally {
    await rm(state.root, { recursive: true, force: true });
  }
});

test("producer hard-fails false raw facts before writing any receipt", async () => {
  const state = await fixture();
  state.isolatedReport.facts.canary.signupStatus = 200;
  try {
    await assert.rejects(
      () => produceSuccessorRehearsalReceipts({
        repoRoot: state.repoRoot,
        receiptRoot: state.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: "origin/codex/successor-rehearsal",
        probeReceiptPath: state.paths.probe,
        postExpandBackupReceiptPath: state.paths.backup,
        releaseLoader: async () => ({
          controllerReady: true,
          deploymentBlocked: false,
          manifest: state.manifest,
          controllerManifest: state.controllerManifest,
        }),
        inspectGitCandidate: async () => ({
          actualCommit: COMMIT,
          upstreamCommit: COMMIT,
          remoteCommit: COMMIT,
          worktreeClean: true,
        }),
        runWorker: async () => execution(state.isolatedReport),
        runReadOnlyPostcheck: async (request) => postcheckObservation(request),
        validateHostedConsumer: async () => assert.fail("consumer must not run"),
        now: () => new Date("2026-08-19T05:25:01.000Z"),
      }),
      (error) => error?.code === "REHEARSAL_WORKER_REPORT_INVALID",
    );
    assert.deepEqual(await import("node:fs/promises").then(({ readdir }) => readdir(state.receiptRoot)), []);
  } finally {
    await rm(state.root, { recursive: true, force: true });
  }
});

test("hosted consumer provenance validator recomputes command and artifact digests and rejects forgery", async () => {
  const state = await fixture();
  try {
    const result = await produceSuccessorRehearsalReceipts({
      repoRoot: state.repoRoot,
      receiptRoot: state.receiptRoot,
      expectedCommit: COMMIT,
      remoteRef: "origin/codex/successor-rehearsal",
      probeReceiptPath: state.paths.probe,
      postExpandBackupReceiptPath: state.paths.backup,
      releaseLoader: async () => ({
        controllerReady: true,
        deploymentBlocked: false,
        manifest: state.manifest,
        controllerManifest: state.controllerManifest,
      }),
      inspectGitCandidate: async () => ({
        expectedCommit: COMMIT,
        actualCommit: COMMIT,
        upstreamCommit: COMMIT,
        remoteCommit: COMMIT,
        remoteRef: "origin/codex/successor-rehearsal",
        worktreeClean: true,
      }),
      runWorker: async (request) => {
        if (request.mode === "isolated") return execution(state.isolatedReport);
        const forward = structuredClone(state.forwardReport);
        forward.facts = {
          featureReceiptSha256: sha256(request.input.featureReceiptText),
          planSha256: request.input.expectedPlanSha256,
          observedControlMismatchCount: 0,
          falseCheckCount: 0,
          migrationRollbackCommandCount: 0,
          remoteEndpointCount: 0,
        };
        return execution(forward);
      },
      runReadOnlyPostcheck: async (request) => postcheckObservation(request),
      validateHostedConsumer: async () => ({
        rawEvidenceSha256: "e".repeat(64), receiptSha256: "f".repeat(64),
      }),
      now: () => new Date("2026-08-19T05:25:01.000Z"),
    });
    const [provenanceBytes, featureOffBytes, forwardFixBytes, probeBytes,
      postcheckBytes, approvalBytes, nodeBytes, scriptBytes, libraryBytes] =
      await Promise.all([
        readFile(result.paths.provenance),
        readFile(result.paths.stagingFeatureOff),
        readFile(result.paths.forwardFix),
        readFile(state.paths.probe),
        readFile(result.paths.postcheckReceipt),
        readFile(join(
          state.repoRoot,
          "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json",
        )),
        readFile(process.execPath),
        readFile(join(state.repoRoot, "scripts/vendor-disclosure-successor-rehearsal-producer.mjs")),
        readFile(join(state.repoRoot, "scripts/lib/vendor-disclosure-successor-rehearsal-producer.mjs")),
      ]);
    const provenance = JSON.parse(provenanceBytes);
    for (const [mode, response] of Object.entries(provenance.observations)) {
      const command = provenance.commands[mode];
      command.executableSha256 = sha256(nodeBytes);
      command.scriptSha256 = sha256(scriptBytes);
      command.librarySha256 = sha256(libraryBytes);
      command.stdinSha256 = sha256(`${JSON.stringify({
        ...provenance.requests[mode], observationWindowSeconds: 300,
      }, null, 2)}\n`);
      command.stdoutSha256 = sha256(`${JSON.stringify(response)}\n`);
      command.stderrSha256 = sha256("");
    }
    const validationInput = {
      repoRoot: state.repoRoot,
      provenanceValue: provenance,
      provenanceBytes: Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`),
      featureOffValue: JSON.parse(featureOffBytes),
      featureOffBytes,
      forwardFixValue: JSON.parse(forwardFixBytes),
      forwardFixBytes,
      probeBytes,
      postcheckValue: JSON.parse(postcheckBytes),
      postcheckBytes,
      manifest: state.manifest,
      controllerManifest: state.controllerManifest,
      expectedCommit: COMMIT,
      stagingProjectRef: STAGING_REF,
      approvedStagingContractSha256: sha256(approvalBytes),
    };
    const accepted = await validateSuccessorRehearsalProducerProvenance(validationInput);
    assert.equal(accepted.productionMutationCommandCount, 0);
    const forgedForward = structuredClone(validationInput.forwardFixValue);
    forgedForward.checks.productionUntouched = false;
    await assert.rejects(
      () => validateSuccessorRehearsalProducerProvenance({
        ...validationInput,
        forwardFixValue: forgedForward,
      }),
      (error) => error?.code === "REHEARSAL_PROVENANCE_FORWARD_INVALID",
    );
    const forgedPostcheckProvenance = structuredClone(validationInput.provenanceValue);
    forgedPostcheckProvenance.stagingPostcheck.completedAt =
      "2026-08-19T05:19:02.000Z";
    await assert.rejects(
      () => validateSuccessorRehearsalProducerProvenance({
        ...validationInput,
        provenanceValue: forgedPostcheckProvenance,
      }),
      (error) => error?.code === "REHEARSAL_PROVENANCE_POSTCHECK_INVALID",
    );
  } finally {
    await rm(state.root, { recursive: true, force: true });
  }
});

test("durable receipt-set writer removes every created inode after an injected write fault", async () => {
  const root = await mkdtemp(join(tmpdir(), "successor-rehearsal-durable-"));
  const paths = [join(root, "one.json"), join(root, "two.json")];
  let opens = 0;
  try {
    await assert.rejects(
      () => writeDurableExclusiveReceiptSet({
        files: paths.map((path, index) => ({ path, text: `${JSON.stringify({ index })}\n` })),
        openFile: async (...args) => {
          opens += 1;
          assert.equal(args[1], "wx");
          assert.equal(args[2], 0o600);
          const handle = await import("node:fs/promises").then(({ open }) => open(...args));
          if (opens === 2) {
            return {
              ...handle,
              writeFile: async () => { throw new Error("injected write fault"); },
              close: () => handle.close(),
            };
          }
          return handle;
        },
      }),
      /injected write fault/,
    );
    for (const path of paths) {
      await assert.rejects(() => readFile(path), (error) => error?.code === "ENOENT");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("durable receipt-set writer removes the completed set when parent fsync fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "successor-rehearsal-parent-sync-"));
  const paths = [join(root, "one.json"), join(root, "two.json")];
  let syncCalls = 0;
  try {
    await assert.rejects(
      () => writeDurableExclusiveReceiptSet({
        files: paths.map((path, index) => ({ path, text: `${JSON.stringify({ index })}\n` })),
        syncParent: async () => {
          syncCalls += 1;
          if (syncCalls === 1) throw new Error("injected parent sync fault");
        },
      }),
      /injected parent sync fault/,
    );
    assert.equal(syncCalls, 2);
    for (const path of paths) {
      await assert.rejects(() => readFile(path), (error) => error?.code === "ENOENT");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
