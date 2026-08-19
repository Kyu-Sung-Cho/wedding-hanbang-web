import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  emitVendorDisclosureSuccessorHostedStagingEvidence,
  SUCCESSOR_FEATURE_OFF_VERIFICATION_KIND,
  SUCCESSOR_FORWARD_FIX_REHEARSAL_KIND,
  SUCCESSOR_READ_ONLY_POSTCHECK_KIND,
  validateVendorDisclosureSuccessorHostedStagingEvidenceProvenance,
} from "../lib/vendor-disclosure-successor-hosted-staging-evidence.mjs";

const RELEASE = "vendor-disclosure-v2-20260718";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const STAGING_REF = "rgxdizztidbgwnsbadml";
const COMMIT = "a".repeat(40);
const ORIGIN = "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git";
const REMOTE_REF = "origin/codex/amora-release-hardening-20260811";
const REQUIRED_REMOTE_HEAD = "20260716117000";
const VERSIONS = ["20260730100000", "20260819100000"];
const POSTCHECK_ID = "vendor-disclosure-successor-postcheck";
const POSTCHECK_FILE = "supabase/release-checks/vendor-disclosure-successor-post.sql";
const NOW = new Date("2026-08-19T05:30:00.000Z");

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

const PROBE_SCENARIOS = Object.freeze({
  neutralPreparationSpace: {
    scenario: "neutral_preparation_space_two_account_v1",
    syntheticUserCount: 2,
    checks: [
      "ownerCreate", "ownerReplay", "preJoinProfileIsolation",
      "preJoinCoupleIsolation", "authenticatedServerJoinDenied", "serverJoin",
      "postJoinMutualProfileRead", "postJoinCoupleRead", "cleanup",
    ],
    residue: ["profiles", "couples"],
  },
  preparationTopicMessageRefs: {
    scenario: "preparation_topic_message_refs_three_account_v1",
    syntheticUserCount: 3,
    checks: [
      "ownerSpace", "partnerJoin", "outsiderSpace", "authenticatedRpcDenied",
      "authenticatedTableDenied", "authenticatedNotesRpcDenied",
      "sharedConcurrentReplay", "privateSave", "ownerList", "partnerListPrivacy",
      "outsiderIsolation", "ownerNotesSearch", "partnerNotesPrivacy",
      "outsiderNotesIsolation", "sharedResolve", "privateResolve",
      "partnerPrivateDenied", "removeAndStaleRevision", "cleanup",
    ],
    residue: ["profiles", "couples", "chatMessages", "messageRefs"],
  },
  mediationPrivateDraft: {
    scenario: "mediation_private_draft_two_account_v1",
    syntheticUserCount: 2,
    checks: [
      "ownerSpace", "partnerJoin", "privateBeforeShare", "directSharedInsertDenied",
      "authenticatedShareDenied", "wrongActorShareDenied", "canonicalShare",
      "exactReplay", "sharedVisibleToCouple", "cleanup",
    ],
    residue: ["profiles", "couples", "chatMessages", "messageRefs"],
  },
  criterionActionContext: {
    scenario: "criterion_action_context_two_account_v1",
    syntheticUserCount: 2,
    providerEvidence: "synthetic_fixture_no_live_provider_call",
    checks: [
      "ownerSpace", "partnerJoin", "firstCriterionConfirmed", "directInjectionDenied",
      "currentContextSealed", "criterionTextNotCopied", "exactReplay",
      "contextImmutable", "changedCriterionConfirmed",
      "staleContextOmittedWithoutUndoingAction", "cleanup",
    ],
    residue: [
      "profiles", "couples", "journeys", "chatMessages", "chatClaims", "actions",
      "executions", "applicationClaims", "criterionProposals",
      "criterionAcceptances", "decisions", "providerReceipts",
    ],
  },
  firstUseDeterministicAction: {
    scenario: "first_use_deterministic_action_two_account_v1",
    syntheticUserCount: 2,
    providerEvidence: "synthetic_private_source_receipt_no_live_provider_call",
    checks: [
      "ownerSpace", "partnerJoin", "privateSourceOwnerVisible",
      "privateSourcePartnerHidden", "authenticatedFinalizerDenied", "promotionCreated",
      "deterministicProposal", "proposalExactReplay", "sharedProposalVisible",
      "bindingProjection", "bindingAuthenticatedDenied", "bindingAnonDenied",
      "bindingServiceTableDenied", "bindingWrongCoupleDenied",
      "bindingWrongRecipientDenied", "bindingStaleEpochDenied",
      "deterministicApplication", "applicationExactReplay", "sharedReceiptVisible",
      "privateContentNotShared", "actionPersisted", "providerBoundary", "cleanup",
    ],
    residue: [
      "profiles", "couples", "journeys", "chatMessages", "chatClaims", "promotions",
      "proposalBindings", "actions", "executions", "applicationClaims",
      "providerReceipts",
    ],
  },
  bookingOutcomeProvenance: {
    scenario: "booking_outcome_provenance_solo_v1",
    syntheticUserCount: 1,
    checks: [
      "ownerSpace", "fixtureCreated", "authenticatedCompletionDenied",
      "outcomeRecorded", "actorBound", "timestampsCanonical", "intentSuperseded",
      "exactReplay", "sharedDecisionVisible", "noAuthorizationResidue", "cleanup",
    ],
    residue: [
      "profiles", "couples", "journeys", "vendors", "timeslots", "bookings",
      "reviews", "decisions", "intentAuthorizations", "outcomeAuthorizations",
      "projectionJobs",
    ],
  },
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalTextSha256(value) {
  return sha256(value.replace(/\r\n?/g, "\n"));
}

function canonicalJsonSha256(value) {
  const canonical = (candidate) => {
    if (candidate === null || typeof candidate !== "object") {
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) return `[${candidate.map(canonical).join(",")}]`;
    return `{${Object.keys(candidate).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(candidate[key])}`,
    ).join(",")}}`;
  };
  return sha256(`${canonical(value)}\n`);
}

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

function scenarioReceipt(contract) {
  return {
    scenario: contract.scenario,
    ...(contract.providerEvidence === undefined
      ? {}
      : { providerEvidence: contract.providerEvidence }),
    syntheticUserCount: contract.syntheticUserCount,
    checks: Object.fromEntries(contract.checks.map((name) => [name, true])),
    residue: Object.fromEntries(contract.residue.map((name) => [name, 0])),
  };
}

function commandRunner({ dirty = false, remoteCommit = COMMIT } = {}) {
  return async (_command, args) => {
    const key = args.join(" ");
    if (key === "status --porcelain=v1 --untracked-files=all") {
      return { status: 0, stdout: dirty ? "?? unexpected.txt\n" : "", stderr: "" };
    }
    if (key === "rev-parse HEAD") return { status: 0, stdout: `${COMMIT}\n`, stderr: "" };
    if (key === "remote get-url origin") return { status: 0, stdout: `${ORIGIN}\n`, stderr: "" };
    if (key === "ls-remote --exit-code origin refs/heads/codex/amora-release-hardening-20260811") {
      return {
        status: 0,
        stdout: `${remoteCommit}\trefs/heads/codex/amora-release-hardening-20260811\n`,
        stderr: "",
      };
    }
    return { status: 1, stdout: "", stderr: "unexpected command" };
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "successor-hosted-staging-repo-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-hosted-staging-out-"));
  const inputRoot = await mkdtemp(join(tmpdir(), "successor-hosted-staging-input-"));
  await mkdir(join(repoRoot, "supabase", "release-contracts"), { recursive: true });
  await mkdir(join(repoRoot, "supabase", "release-checks"), { recursive: true });
  await mkdir(join(repoRoot, "supabase", "migrations"), { recursive: true });

  const approvedContract = {
    contractVersion: 1,
    kind: "vendor-disclosure-hosted-staging-v2",
    release: RELEASE,
    productionProjectRef: PRODUCTION_REF,
    status: "approved_for_hosted_rls_probe",
    approved: true,
    projectRef: STAGING_REF,
    approvalEvidence: "codex-thread:user-approved-dedicated-free-staging-2026-07-22",
    publicViewDefinitionSha256: {
      v_public_vendors: "cf755f85d7081bf4ac510846dc65dccf17939f4f7c822f6abab9fb2ea6f50c9d",
      v_public_prices: "c3558fd930d2ff1037a752b2a97a2d5c61544a7221f978796d594d1240b3e3bc",
      v_public_price_options: "9c3f97742cff0b8584d66e38d002ba16fa9092e17ef1c72b60dd6b07a066d5b7",
      v_public_agency_packages: "65ce43519c109caf64f279332106994fc15947aa9d11a850633157fd15676e22",
    },
  };
  await writeJson(
    join(
      repoRoot,
      "supabase",
      "release-contracts",
      "vendor-disclosure-hosted-staging-v2-20260718.json",
    ),
    approvedContract,
  );
  for (const file of [
    "20260727090000_baseline.sql",
    `${VERSIONS[0]}_fixture.sql`,
    `${VERSIONS[1]}_fixture.sql`,
  ]) {
    await writeFile(join(repoRoot, "supabase", "migrations", file), "BEGIN; COMMIT;\n", "utf8");
  }

  const expectedEvidence = {
    successor_created_table_count: 2,
    successor_migration_head_count: 1,
  };
  const postcheckSql = `BEGIN TRANSACTION READ ONLY;\nSELECT true AS verified, 2 AS successor_created_table_count, 1 AS successor_migration_head_count;\nCOMMIT;\n`;
  const postcheckSha256 = canonicalTextSha256(postcheckSql);
  await writeFile(
    join(repoRoot, ...POSTCHECK_FILE.split("/")),
    postcheckSql,
    "utf8",
  );
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName: `${RELEASE}-feature-off-rollback.json`,
    maximumAgeMinutes: 30,
    requiredControls: { ...REQUIRED_CONTROLS },
    requiredChecks: [...REQUIRED_ROLLBACK_CHECKS],
  };
  const manifest = {
    release: RELEASE,
    projectRef: PRODUCTION_REF,
    status: "controller_ready",
    requiredRemoteHead: REQUIRED_REMOTE_HEAD,
    expandMigrations: VERSIONS.map((version) => ({
      file: `${version}_fixture.sql`,
      sha256: "c".repeat(64),
    })),
    deploymentEvidence: {
      hostedStaging: {
        kind: "successor-release-hosted-staging-evidence-v1",
        maximumAgeMinutes: 1_440,
        rawEvidenceFileName: `${RELEASE}-hosted-staging-raw.json`,
        rawEvidenceSource: "isolated-hosted-staging-probe",
        receiptFileName: `${RELEASE}-hosted-staging-evidence.json`,
        requiredChecks: [
          "exactMigrationSetApplied",
          "preconditionsPassed",
          "postconditionsPassed",
          "readOnlyPostchecksPassed",
          "rollbackRehearsed",
          "featureFlagsOffVerified",
        ],
      },
    },
  };
  const state = {
    controllerReady: true,
    manifest,
    controllerManifest: {
      ...manifest,
      backupContract: { expectedOrigin: ORIGIN },
      preApplyChecks: [{ id: "successor-precondition", type: "read-only-sql" }],
      postApplyChecks: [{
        id: POSTCHECK_ID,
        type: "read-only-sql",
        file: POSTCHECK_FILE,
        sha256: postcheckSha256,
        expectedEvidence,
      }],
      rollbackContract,
    },
  };

  const probeReceiptPath = join(inputRoot, "amora-successor-probe-v8.json");
  await writeJson(probeReceiptPath, {
    receiptVersion: 8,
    kind: "amora-successor-hosted-staging-probe",
    scope: "neutral-space-message-refs-notes-mediation-criterion-first-use-receipt-binding-and-booking-provenance",
    projectRef: STAGING_REF,
    gitCommit: COMMIT,
    migrationLedger: { count: 3, head: VERSIONS.at(-1) },
    startedAt: "2026-08-19T05:00:00.000Z",
    completedAt: "2026-08-19T05:10:00.000Z",
    result: {
      ...Object.fromEntries(Object.entries(PROBE_SCENARIOS).map(
        ([name, contract]) => [name, scenarioReceipt(contract)],
      )),
      preparationActionReceiptBindingContract: {
        preparationActionReceiptBindingReadRpcAclCount: 1,
      },
    },
  });

  const postcheckReceiptPath = join(inputRoot, "successor-postcheck.json");
  await writeJson(postcheckReceiptPath, {
    receiptVersion: 1,
    kind: SUCCESSOR_READ_ONLY_POSTCHECK_KIND,
    release: RELEASE,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    releaseCommit: COMMIT,
    checkId: POSTCHECK_ID,
    sqlFile: POSTCHECK_FILE,
    sqlSha256: postcheckSha256,
    source: "supabase-management-read-only-query",
    transactionReadOnly: true,
    executedAt: "2026-08-19T05:12:00.000Z",
    row: { verified: true, ...expectedEvidence },
    productionMutationAttempted: false,
    containsSecrets: false,
  });

  const featureOffReceiptPath = join(inputRoot, rollbackContract.featureOffReceiptFileName);
  await writeJson(featureOffReceiptPath, {
    receiptVersion: 1,
    kind: SUCCESSOR_FEATURE_OFF_VERIFICATION_KIND,
    release: RELEASE,
    projectRef: STAGING_REF,
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
    verifiedAt: "2026-08-19T05:15:00.000Z",
    productionMutationAttempted: false,
    containsSecrets: false,
  });
  const featureOffReceiptSha256 = sha256(await readFile(featureOffReceiptPath));

  const rollbackRehearsalReceiptPath = join(inputRoot, "forward-fix-rehearsal.json");
  await writeJson(rollbackRehearsalReceiptPath, {
    receiptVersion: 1,
    kind: SUCCESSOR_FORWARD_FIX_REHEARSAL_KIND,
    release: RELEASE,
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    releaseCommit: COMMIT,
    strategy: rollbackContract.strategy,
    migrationRollback: rollbackContract.migrationRollback,
    featureOffReceiptFileName: rollbackContract.featureOffReceiptFileName,
    featureOffReceiptSha256,
    rehearsalRunId: "12345678-1234-4234-8234-123456789abc",
    rehearsalMode: "isolated-staging-forward-fix-rehearsal",
    rehearsalPlanSha256: canonicalJsonSha256({
      version: 1,
      strategy: rollbackContract.strategy,
      migrationRollback: rollbackContract.migrationRollback,
      rehearsalMode: "isolated-staging-forward-fix-rehearsal",
      featureOffReceiptFileName: rollbackContract.featureOffReceiptFileName,
      requiredChecks: [
        "exactFeatureOffReceiptConsumed",
        "migrationRollbackNotAttempted",
        "forwardFixProcedureValidated",
        "writeFencesRetained",
        "productionUntouched",
      ],
    }),
    startedAt: "2026-08-19T05:16:00.000Z",
    completedAt: "2026-08-19T05:20:00.000Z",
    outcome: "passed",
    checks: {
      exactFeatureOffReceiptConsumed: true,
      migrationRollbackNotAttempted: true,
      forwardFixProcedureValidated: true,
      writeFencesRetained: true,
      productionUntouched: true,
    },
    productionMutationAttempted: false,
    containsSecrets: false,
  });
  const rehearsalProvenancePath = join(inputRoot, "successor-rehearsal-provenance.json");
  await writeJson(rehearsalProvenancePath, {
    provenanceVersion: 1,
    kind: "successor-rehearsal-receipt-producer-provenance-v1",
    containsSecrets: false,
  });

  return {
    repoRoot,
    receiptRoot,
    inputRoot,
    state,
    approvedContract,
    probeReceiptPath,
    postcheckReceiptPath,
    featureOffReceiptPath,
    rollbackRehearsalReceiptPath,
    rehearsalProvenancePath,
  };
}

async function cleanup(fixture) {
  await Promise.all([
    rm(fixture.repoRoot, { recursive: true, force: true }),
    rm(fixture.receiptRoot, { recursive: true, force: true }),
    rm(fixture.inputRoot, { recursive: true, force: true }),
  ]);
}

async function assertHostedOutputsAbsent(fixture) {
  for (const fileName of [
    `${RELEASE}-hosted-staging-raw.json`,
    `${RELEASE}-hosted-staging-evidence.json`,
  ]) {
    await assert.rejects(readFile(join(fixture.receiptRoot, fileName)), /ENOENT/);
  }
}

function emitFixture(fixture, overrides = {}) {
  return emitVendorDisclosureSuccessorHostedStagingEvidence({
    repoRoot: fixture.repoRoot,
    receiptRoot: fixture.receiptRoot,
    expectedCommit: COMMIT,
    remoteRef: REMOTE_REF,
    probeReceiptPath: fixture.probeReceiptPath,
    postcheckReceiptPath: fixture.postcheckReceiptPath,
    featureOffReceiptPath: fixture.featureOffReceiptPath,
    rollbackRehearsalReceiptPath: fixture.rollbackRehearsalReceiptPath,
    rehearsalProvenancePath: fixture.rehearsalProvenancePath,
    now: () => NOW,
    runCommand: commandRunner(),
    releaseLoader: () => fixture.state,
    validateRehearsalProvenance: async () => ({
      sha256: "1".repeat(64),
      isolatedStdoutSha256: "2".repeat(64),
      forwardFixStdoutSha256: "3".repeat(64),
      productionMutationCommandCount: 0,
      migrationRollbackCommandCount: 0,
    }),
    ...overrides,
  });
}

async function runNode(arguments_) {
  return await new Promise((resolveResult) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: join(import.meta.dirname, "..", ".."),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  });
}

test("CLI fails closed on an incomplete argument set", async () => {
  const result = await runNode([
    "scripts/vendor-disclosure-successor-hosted-staging-evidence.mjs",
  ]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "SUCCESSOR_HOSTED_STAGING_ARGUMENT_INVALID");
});

test("emits hosted staging evidence only when receipts and producer command provenance agree", async () => {
  const fixture = await createFixture();
  try {
    const result = await emitVendorDisclosureSuccessorHostedStagingEvidence({
      repoRoot: fixture.repoRoot,
      receiptRoot: fixture.receiptRoot,
      expectedCommit: COMMIT,
      remoteRef: REMOTE_REF,
      probeReceiptPath: fixture.probeReceiptPath,
      postcheckReceiptPath: fixture.postcheckReceiptPath,
      featureOffReceiptPath: fixture.featureOffReceiptPath,
      rollbackRehearsalReceiptPath: fixture.rollbackRehearsalReceiptPath,
      rehearsalProvenancePath: fixture.rehearsalProvenancePath,
      now: () => NOW,
      runCommand: commandRunner(),
      releaseLoader: () => fixture.state,
      validateRehearsalProvenance: async () => ({
        sha256: "1".repeat(64),
        isolatedStdoutSha256: "2".repeat(64),
        forwardFixStdoutSha256: "3".repeat(64),
        productionMutationCommandCount: 0,
        migrationRollbackCommandCount: 0,
      }),
    });

    assert.equal(result.status, "successor_hosted_staging_evidence_emitted");
    const rawText = await readFile(
      join(fixture.receiptRoot, `${RELEASE}-hosted-staging-raw.json`),
      "utf8",
    );
    const receiptText = await readFile(
      join(fixture.receiptRoot, `${RELEASE}-hosted-staging-evidence.json`),
      "utf8",
    );
    const raw = JSON.parse(rawText);
    const receipt = JSON.parse(receiptText);
    assert.equal(raw.stagingProjectRef, STAGING_REF);
    assert.equal(raw.productionProjectRef, PRODUCTION_REF);
    assert.equal(raw.probe.receipt.receiptVersion, 8);
    assert.equal(raw.postcheck.receipt.transactionReadOnly, true);
    assert.equal(raw.featureOffVerification.receipt.observedControls.AMORA_OPENAI_ENABLED, "false");
    assert.equal(raw.rollbackRehearsal.receipt.featureOffReceiptSha256, raw.featureOffVerification.sha256);
    assert.equal(raw.rehearsalProducerProvenance.productionMutationCommandCount, 0);
    assert.equal(receipt.rawProvenance.sha256, sha256(rawText));
    assert.deepEqual(receipt.observations, {
      expectedMigrationHead: VERSIONS.at(-1),
      migrationCount: VERSIONS.length,
      migrationVersionsSha256: textListSha256(VERSIONS),
      requiredRemoteHead: REQUIRED_REMOTE_HEAD,
      rollbackStrategy: "forward-fix-feature-off",
    });
    assert.deepEqual(receipt.checks, Object.fromEntries(
      fixture.state.manifest.deploymentEvidence.hostedStaging.requiredChecks.map(
        (name) => [name, true],
      ),
    ));
    assert.equal(
      receipt.rollbackContractSha256,
      canonicalJsonSha256(fixture.state.controllerManifest.rollbackContract),
    );
    assert.equal(result.rawEvidenceSha256, sha256(rawText));
    assert.equal(result.receiptSha256, sha256(receiptText));
    assert.equal(receipt.containsSecrets, false);
    const replay =
      await validateVendorDisclosureSuccessorHostedStagingEvidenceProvenance({
        repoRoot: fixture.repoRoot,
        receipt,
        raw,
        manifest: fixture.state.manifest,
        controllerManifest: fixture.state.controllerManifest,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        now: () => NOW,
      });
    assert.equal(replay.stagingProjectRef, STAGING_REF);
  } finally {
    await cleanup(fixture);
  }
});

test("consumer rejects standalone feature/forward JSON when producer provenance cannot be recomputed", async () => {
  const fixture = await createFixture();
  let validationCalls = 0;
  try {
    await assert.rejects(
      emitFixture(fixture, {
        validateRehearsalProvenance: async (input) => {
          validationCalls += 1;
          assert.equal(
            input.featureOffBytes.toString("utf8"),
            await readFile(fixture.featureOffReceiptPath, "utf8"),
          );
          assert.equal(
            input.forwardFixBytes.toString("utf8"),
            await readFile(fixture.rollbackRehearsalReceiptPath, "utf8"),
          );
          throw new Error("forged standalone receipt set");
        },
      }),
      (error) => error?.code
        === "SUCCESSOR_HOSTED_STAGING_REHEARSAL_PROVENANCE_INVALID",
    );
    assert.equal(validationCalls, 1);
    await assertHostedOutputsAbsent(fixture);
  } finally {
    await cleanup(fixture);
  }
});

test("probe evidence alone never synthesizes feature-off or rollback success", async () => {
  const fixture = await createFixture();
  try {
    await rm(fixture.featureOffReceiptPath);
    await rm(fixture.rollbackRehearsalReceiptPath);
    await assert.rejects(
      emitFixture(fixture),
      (error) => [
        "SUCCESSOR_HOSTED_STAGING_FEATURE_OFF_INVALID",
        "SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID",
      ].includes(error?.code),
    );
    await assertHostedOutputsAbsent(fixture);
  } finally {
    await cleanup(fixture);
  }
});

test("fails closed on a false probe, postcheck, feature-off, or rollback fact", async () => {
  const scenarios = [
    {
      name: "probe check false",
      code: "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(fixture.probeReceiptPath, "utf8"));
        value.result.neutralPreparationSpace.checks.ownerCreate = false;
        await writeJson(fixture.probeReceiptPath, value);
      },
    },
    {
      name: "probe residue remains",
      code: "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(fixture.probeReceiptPath, "utf8"));
        value.result.bookingOutcomeProvenance.residue.bookings = 1;
        await writeJson(fixture.probeReceiptPath, value);
      },
    },
    {
      name: "read-only postcheck did not verify",
      code: "SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(fixture.postcheckReceiptPath, "utf8"));
        value.row.verified = false;
        await writeJson(fixture.postcheckReceiptPath, value);
      },
    },
    {
      name: "feature remains on",
      code: "SUCCESSOR_HOSTED_STAGING_FEATURE_OFF_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(fixture.featureOffReceiptPath, "utf8"));
        value.observedControls.AMORA_OPENAI_ENABLED = "true";
        await writeJson(fixture.featureOffReceiptPath, value);
      },
    },
    {
      name: "rollback rehearsal check false",
      code: "SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(
          fixture.rollbackRehearsalReceiptPath,
          "utf8",
        ));
        value.checks.productionUntouched = false;
        await writeJson(fixture.rollbackRehearsalReceiptPath, value);
      },
    },
    {
      name: "rollback rehearsal plan drifts",
      code: "SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(
          fixture.rollbackRehearsalReceiptPath,
          "utf8",
        ));
        value.rehearsalPlanSha256 = "d".repeat(64);
        await writeJson(fixture.rollbackRehearsalReceiptPath, value);
      },
    },
    {
      name: "rollback does not bind exact feature receipt bytes",
      code: "SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(
          fixture.rollbackRehearsalReceiptPath,
          "utf8",
        ));
        value.featureOffReceiptSha256 = "f".repeat(64);
        await writeJson(fixture.rollbackRehearsalReceiptPath, value);
      },
    },
  ];
  for (const scenario of scenarios) {
    const fixture = await createFixture();
    try {
      await scenario.mutate(fixture);
      await assert.rejects(
        emitFixture(fixture),
        (error) => error?.code === scenario.code,
        scenario.name,
      );
      await assertHostedOutputsAbsent(fixture);
    } finally {
      await cleanup(fixture);
    }
  }
});

test("rejects stale, secret-bearing, dirty, unpushed, or non-controller-ready inputs", async () => {
  const scenarios = [
    {
      name: "stale probe",
      code: "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(fixture.probeReceiptPath, "utf8"));
        value.startedAt = "2026-08-17T04:00:00.000Z";
        value.completedAt = "2026-08-17T04:10:00.000Z";
        await writeJson(fixture.probeReceiptPath, value);
      },
    },
    {
      name: "secret material",
      code: "SUCCESSOR_HOSTED_STAGING_SECRET_MATERIAL_REJECTED",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(fixture.probeReceiptPath, "utf8"));
        value.serviceRoleKey = "eyJabcdefghijklmnopqrstuvwxyz.abcdefghijklmnop.secret";
        await writeJson(fixture.probeReceiptPath, value);
      },
    },
    {
      name: "dirty checkout",
      code: "SUCCESSOR_HOSTED_STAGING_WORKTREE_DIRTY",
      overrides: { runCommand: commandRunner({ dirty: true }) },
    },
    {
      name: "unpushed commit",
      code: "SUCCESSOR_HOSTED_STAGING_REMOTE_COMMIT_MISMATCH",
      overrides: { runCommand: commandRunner({ remoteCommit: "9".repeat(40) }) },
    },
    {
      name: "controller blocked",
      code: "SUCCESSOR_HOSTED_STAGING_RELEASE_CONTRACT_INVALID",
      mutate: async (fixture) => {
        fixture.state.controllerReady = false;
        fixture.state.manifest.status = "deployment_blocked";
      },
    },
  ];
  for (const scenario of scenarios) {
    const fixture = await createFixture();
    try {
      await scenario.mutate?.(fixture);
      await assert.rejects(
        emitFixture(fixture, scenario.overrides),
        (error) => error?.code === scenario.code,
        scenario.name,
      );
      await assertHostedOutputsAbsent(fixture);
    } finally {
      await cleanup(fixture);
    }
  }
});

test("rejects approval, migration-ledger, and pinned read-only SQL drift", async () => {
  const scenarios = [
    {
      name: "approved staging identity drifts",
      code: "SUCCESSOR_HOSTED_STAGING_APPROVAL_INVALID",
      mutate: async (fixture) => {
        const path = join(
          fixture.repoRoot,
          "supabase",
          "release-contracts",
          "vendor-disclosure-hosted-staging-v2-20260718.json",
        );
        const value = JSON.parse(await readFile(path, "utf8"));
        value.projectRef = PRODUCTION_REF;
        await writeJson(path, value);
      },
    },
    {
      name: "probe migration ledger drifts",
      code: "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID",
      mutate: async (fixture) => {
        const value = JSON.parse(await readFile(fixture.probeReceiptPath, "utf8"));
        value.migrationLedger.count -= 1;
        await writeJson(fixture.probeReceiptPath, value);
      },
    },
    {
      name: "pinned SQL bytes drift",
      code: "SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID",
      mutate: async (fixture) => {
        await writeFile(
          join(fixture.repoRoot, ...POSTCHECK_FILE.split("/")),
          "BEGIN TRANSACTION READ ONLY;\nSELECT false AS verified;\nROLLBACK;\n",
          "utf8",
        );
      },
    },
  ];
  for (const scenario of scenarios) {
    const fixture = await createFixture();
    try {
      await scenario.mutate(fixture);
      await assert.rejects(
        emitFixture(fixture),
        (error) => error?.code === scenario.code,
        scenario.name,
      );
      await assertHostedOutputsAbsent(fixture);
    } finally {
      await cleanup(fixture);
    }
  }
});

test("requires bounded external inputs and never overwrites an output collision", async () => {
  const internalFixture = await createFixture();
  try {
    const internalProbe = join(internalFixture.repoRoot, "probe.json");
    await writeFile(internalProbe, await readFile(internalFixture.probeReceiptPath));
    await assert.rejects(
      emitFixture(internalFixture, { probeReceiptPath: internalProbe }),
      (error) => error?.code === "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID",
    );
    await assertHostedOutputsAbsent(internalFixture);
  } finally {
    await cleanup(internalFixture);
  }

  const oversizedFixture = await createFixture();
  try {
    await writeFile(oversizedFixture.probeReceiptPath, Buffer.alloc(4 * 1024 * 1024 + 1, 32));
    await assert.rejects(
      emitFixture(oversizedFixture),
      (error) => error?.code === "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID",
    );
    await assertHostedOutputsAbsent(oversizedFixture);
  } finally {
    await cleanup(oversizedFixture);
  }

  const collisionFixture = await createFixture();
  try {
    const rawPath = join(
      collisionFixture.receiptRoot,
      `${RELEASE}-hosted-staging-raw.json`,
    );
    await writeFile(rawPath, "preserve-me\n", "utf8");
    await assert.rejects(
      emitFixture(collisionFixture),
      (error) => error?.code === "SUCCESSOR_HOSTED_STAGING_OUTPUT_COLLISION",
    );
    assert.equal(await readFile(rawPath, "utf8"), "preserve-me\n");
    await assert.rejects(
      readFile(join(
        collisionFixture.receiptRoot,
        `${RELEASE}-hosted-staging-evidence.json`,
      )),
      /ENOENT/,
    );
  } finally {
    await cleanup(collisionFixture);
  }
});
