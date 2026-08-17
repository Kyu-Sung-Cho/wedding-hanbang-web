import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  productionReleaseControllerTestHooks,
  runProductionRelease,
} from "../lib/supabase-production-release-controller.mjs";
import {
  AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
  AMORA_POST_EXPAND_TABLES,
  AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
  AMORA_RELEASE_MIGRATION_VERSIONS,
  FINALIZER_EXTERNAL_EVIDENCE_CONTRACT,
  FINALIZER_REQUIRED_CANARY_CHECKS,
  POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS,
} from "../lib/amora-release-extended-contracts.mjs";
import {
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
} from "../lib/supabase-successor-release-contract.mjs";
import {
  attachSuccessorRemoteBaselineFixture,
  SUCCESSOR_REMOTE_BASELINE_FIXTURE_PATH,
} from "./helpers/successor-remote-baseline-fixture.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const HOSTED_RESTORE_PROJECT_REF = "zyxwvutsrqponmlkjihg";
const RELEASE_COMMIT = "1".repeat(40);
const BACKUP_COMMIT = RELEASE_COMMIT;
const EXPECTED_ORIGIN = "https://github.com/wedding-hanbang/wedding-hanbang.git";
const BACKUP_SET_ID = "12345678-1234-4234-8234-123456789abc";
const MANIFEST_SHA = "A".repeat(64);
const SCHEMA_CONTRACT_SHA = "B".repeat(64);
const RELATION_CONTRACT_SHA = "C".repeat(64);
const CLI_VERSION = "2.106.0";
const CLI_BINARY = "fixture-supabase-native-binary\n";
const CLI_BINARY_SHA = createHash("sha256").update(CLI_BINARY).digest("hex").toUpperCase();
const BASELINE_VERIFIER = "# fixture current baseline verifier\n";
const PRE_OPERATION_ID = "storage-global-write-freeze-20260716108000";

test("the real command runner terminates a command at its bounded timeout", async () => {
  const startedAt = Date.now();
  const result = await productionReleaseControllerTestHooks.defaultRunCommand(
    process.execPath,
    ["-e", "setTimeout(() => {}, 60_000)"],
    { cwd: process.cwd(), timeoutMs: 1_000 },
  );
  assert.equal(result.timedOut, true);
  assert.ok(result.signal || result.status !== 0);
  assert.ok(Date.now() - startedAt < 10_000);
});

function platformCliPackage() {
  if (process.platform === "win32" && process.arch === "x64") return "cli-windows-x64";
  if (process.platform === "win32" && process.arch === "arm64") return "cli-windows-arm64";
  if (process.platform === "darwin") return `cli-darwin-${process.arch}`;
  if (process.platform === "linux") return `cli-linux-${process.arch}`;
  throw new Error(`Unsupported test platform: ${process.platform}-${process.arch}`);
}

function sha256(content) {
  return createHash("sha256")
    .update(content.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function queryFileFromCall(call) {
  const index = call.indexOf("--file");
  return index >= 0 ? String(call[index + 1]) : null;
}

function remoteLeaseActionFromCall(call) {
  const sql = call.find((value) =>
    typeof value === "string" && value.includes("remote_release_lease_"));
  return sql?.match(/AS\s+remote_release_lease_([a-z_]+)_count\b/i)?.[1] ?? null;
}

async function rawFileSha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
    .toUpperCase();
}

async function writePostPushEvidence(fixture, mutate = () => {}) {
  const manifest = JSON.parse(await readFile(
    join(fixture.root, "supabase/release-manifests/amora-engine-v2-20260716.json"),
    "utf8",
  ));
  const receipt = {
    receiptVersion: 1,
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: RELEASE_COMMIT,
    backupSetId: BACKUP_SET_ID,
    backupManifestSha256: MANIFEST_SHA,
    awaitingOutcomeReceiptSha256: await rawFileSha256(fixture.outcomeReceiptPath),
    verifiedAt: new Date().toISOString(),
    controls: {
      vercelProductionWriteFenceEnabled: true,
      vercelDeploymentCommit: RELEASE_COMMIT,
      supabaseAuthSignupDisabled: true,
    },
    operations: manifest.manualPlatformOperations
      .filter((operation) => operation.phase === "post-push-pre-deploy")
      .map((operation) => ({
        operationId: operation.id,
        verificationCheckId: operation.verificationCheckId,
        applyArtifactSha256: operation.sha256,
        verified: true,
      })),
    containsSensitiveValues: false,
  };
  mutate(receipt);
  await writeFile(fixture.postPushReceiptPath, JSON.stringify(receipt), "utf8");
  return receipt;
}

async function write(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function addBlockedSuccessorRelease(fixture) {
  const predecessorFile = "supabase/release-manifests/amora-engine-v2-20260716.json";
  const predecessorText = await readFile(join(fixture.root, predecessorFile), "utf8");
  const migrationFile = "20260718120000_vendor_disclosure_foundation.sql";
  const migrationSql = "select 'blocked successor';\n";
  const manifest = {
    release: "vendor-disclosure-v2-20260718",
    projectRef: PROJECT_REF,
    status: "deployment_blocked",
    predecessorManifest: {
      file: predecessorFile,
      sha256: sha256(predecessorText),
    },
    requiredRemoteHead: "20260716091000",
    migrationFloor: "20260718120000",
    expandMigrations: [
      { file: migrationFile, sha256: sha256(migrationSql) },
    ],
    deploymentEvidence: {
      hostedStaging: "missing",
      backup: "missing",
      hostedRestore: "missing",
      storage: "missing",
      finalizer: "missing",
    },
  };
  const successorBaseline = attachSuccessorRemoteBaselineFixture(manifest);
  await write(
    fixture.root,
    "supabase/release-manifests/vendor-disclosure-v2-20260718.json",
    `${JSON.stringify(successorBaseline.manifest, null, 2)}\n`,
  );
  await write(
    fixture.root,
    SUCCESSOR_REMOTE_BASELINE_FIXTURE_PATH,
    successorBaseline.contractText,
  );
  await write(fixture.root, `supabase/migrations/${migrationFile}`, migrationSql);
}

function successorRuntimeEvidenceContracts(release) {
  return Object.fromEntries(
    Object.entries(SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS).map(
      ([name, requirement]) => {
        const slug = name.replace(/([A-Z])/g, "-$1").toLowerCase();
        return [name, {
          kind: requirement.kind,
          receiptFileName: `${release}-${slug}-evidence.json`,
          rawEvidenceFileName: `${release}-${slug}-raw.json`,
          rawEvidenceSource: requirement.rawEvidenceSource,
          maximumAgeMinutes: requirement.maximumAgeMinutes,
          requiredChecks: [...requirement.requiredChecks],
        }];
      },
    ),
  );
}

async function addControllerReadySuccessorRelease(fixture) {
  await addBlockedSuccessorRelease(fixture);
  const predecessorFile = "supabase/release-manifests/amora-engine-v2-20260716.json";
  const successorFile =
    "supabase/release-manifests/vendor-disclosure-v2-20260718.json";
  const predecessor = JSON.parse(await readFile(
    join(fixture.root, predecessorFile),
    "utf8",
  ));
  const successor = JSON.parse(await readFile(
    join(fixture.root, successorFile),
    "utf8",
  ));
  const releaseVersions =
    successor.expandMigrations.map((entry) => entry.file.slice(0, 14));
  const baselineTables = predecessor.postExpandBackupContract.expectedTables;
  const postExpandTables = [...baselineTables, "vendor_alias_proposals"].sort();
  const textDigest = (values) => sha256(`${values.join("\n")}\n`);
  const successorPostCheckSql = `BEGIN TRANSACTION READ ONLY;
SELECT
  0 AS successor_created_table_count,
  1 AS account_deletion_auth_fk_contract_count,
  1 AS chat_partner_recipient_insert_policy_count,
  1 AS chat_partner_recipient_select_policy_count,
  1 AS chat_partner_recipient_trigger_count,
  3 AS conversation_segment_active_index_count,
  1 AS conversation_segment_rls_policy_count,
  1 AS conversation_segment_rpc_acl_count,
  2 AS conversation_segment_scope_fk_count,
  1 AS first_use_deterministic_proposal_rpc_acl_count,
  1 AS first_use_deterministic_application_rpc_acl_count,
  1 AS provider_backed_add_action_application_rpc_acl_count,
  1 AS atomic_action_private_dispatcher_acl_count,
  1 AS atomic_action_public_dispatcher_acl_count,
  1 AS atomic_action_href_whitespace_parity_count,
  1 AS booking_outcome_provenance_rpc_acl_count,
  1 AS booking_outcome_provenance_v1_actor_time_contract_count,
  2 AS neutral_preparation_space_rpc_acl_count,
  1 AS neutral_preparation_space_member_model_contract_count,
  1 AS preparation_catch_up_rpc_acl_count,
  1 AS preparation_catch_up_private_actor_binding_contract_count,
  4 AS couple_plan_change_auth_user_fk_count,
  1 AS couple_plan_change_display_guard_count,
  1 AS couple_plan_change_idempotency_index_count,
  4 AS couple_plan_change_journey_write_fence_count,
  3 AS couple_plan_change_terminal_event_count,
  1 AS couple_plan_change_write_boundary_trigger_count,
  1 AS successor_migration_head_count,
  13 AS successor_feature_flags_off_count,
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.wedding_court_votes'::regclass
      AND conname = 'wedding_court_votes_user_id_fkey'
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND confdeltype = 'c'
      AND convalidated
  ) AS wedding_court_auth_delete_fk_count,
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.chat_feedback'::regclass
      AND conname = 'chat_feedback_user_id_fkey'
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND confdeltype = 'c'
      AND convalidated
  ) AS chat_feedback_auth_delete_fk_count,
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.wedding_payment_ledger'::regclass
      AND contype = 'f'
      AND convalidated
      AND (
        (conname = 'wedding_payment_ledger_couple_id_fkey'
          AND confrelid = 'public.couples'::regclass AND confdeltype = 'c')
        OR (conname = 'wedding_payment_ledger_created_by_fkey'
          AND confrelid = 'public.profiles'::regclass AND confdeltype = 'n')
        OR (conname = 'wedding_payment_ledger_updated_by_fkey'
          AND confrelid = 'public.profiles'::regclass AND confdeltype = 'n')
      )
  ) AS payment_ledger_fk_contract_count;
ROLLBACK;
`;
  const successorHistoricalAudit =
    "BEGIN TRANSACTION READ ONLY;\nselect true as verified;\nROLLBACK;\n";
  const successorCapture = "# fixture successor backup capture\n";
  const successorVerifier = "# fixture successor backup verifier\n";
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName:
      `${successor.release}-feature-off-rollback.json`,
    maximumAgeMinutes: 30,
    requiredControls: {
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
    },
    requiredChecks: [
      "databaseWriteFenceHeld",
      "storageWriteFenceHeld",
      "authSignupDisabled",
      "webWriteFenceEnabled",
      "chatPartnerRecipientBoundaryHeld",
      "conversationSegmentScopeBoundaryHeld",
    ],
  };
  const contract = {
    contractVersion: 1,
    release: successor.release,
    projectRef: successor.projectRef,
    historicalEffectAudit: predecessor.historicalEffectAudit ?? {
      file: "supabase/contract-migrations/vendor-disclosure-successor-audit.sql",
      sha256: sha256(successorHistoricalAudit),
    },
    preApplyChecks: predecessor.preApplyChecks,
    postPushChecks: [],
    postApplyChecks: [{
      id: "vendor-disclosure-successor-postcheck",
      type: "read-only-sql",
      file: "supabase/release-checks/vendor-disclosure-successor-post.sql",
      sha256: sha256(successorPostCheckSql),
      expectedEvidence: {
        account_deletion_auth_fk_contract_count: 1,
        chat_partner_recipient_insert_policy_count: 1,
        chat_partner_recipient_select_policy_count: 1,
        chat_partner_recipient_trigger_count: 1,
        conversation_segment_active_index_count: 3,
        conversation_segment_rls_policy_count: 1,
        conversation_segment_rpc_acl_count: 1,
        conversation_segment_scope_fk_count: 2,
        first_use_deterministic_application_rpc_acl_count: 1,
        first_use_deterministic_proposal_rpc_acl_count: 1,
        provider_backed_add_action_application_rpc_acl_count: 1,
        atomic_action_private_dispatcher_acl_count: 1,
        atomic_action_public_dispatcher_acl_count: 1,
        atomic_action_href_whitespace_parity_count: 1,
        booking_outcome_provenance_rpc_acl_count: 1,
        booking_outcome_provenance_v1_actor_time_contract_count: 1,
        neutral_preparation_space_rpc_acl_count: 2,
        neutral_preparation_space_member_model_contract_count: 1,
        preparation_catch_up_rpc_acl_count: 1,
        preparation_catch_up_private_actor_binding_contract_count: 1,
        couple_plan_change_auth_user_fk_count: 4,
        couple_plan_change_display_guard_count: 1,
        couple_plan_change_idempotency_index_count: 1,
        couple_plan_change_journey_write_fence_count: 4,
        couple_plan_change_terminal_event_count: 3,
        couple_plan_change_write_boundary_trigger_count: 1,
        successor_created_table_count: 0,
        successor_feature_flags_off_count: 13,
        successor_migration_head_count: 1,
        wedding_court_auth_delete_fk_count: 1,
        chat_feedback_auth_delete_fk_count: 1,
        payment_ledger_fk_contract_count: 3,
      },
    }],
    forwardOnlySecurityOperations: [],
    manualPlatformOperations: predecessor.manualPlatformOperations,
    rollbackArtifacts: predecessor.rollbackArtifacts,
    manualControlEvidence: {
      receiptFileName: `${successor.release}-production-write-fence.json`,
      storageDrainReceiptFileName: `${successor.release}-storage-drain.json`,
      maximumAgeMinutes: 30,
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
    },
    backupContract: {
      id: `pre-${successor.release}-current-remote-backup`,
      version: 2,
      format: "hbam2-encrypted-current-user",
      expectedTableCount: baselineTables.length,
      expectedTables: baselineTables,
      expectedTableContractSha256: textDigest(baselineTables),
      expectedMigrationHead: successor.requiredRemoteHead,
      excludedEphemeralTables:
        predecessor.backupContract.excludedEphemeralTables,
      ephemeralRebuildContract:
        predecessor.backupContract.ephemeralRebuildContract,
      expectedCommitBinding: "release-expected-commit",
      expectedOrigin: predecessor.backupContract.expectedOrigin,
      verifier: predecessor.postExpandBackupContract.verifier,
      providerPhysicalBackup:
        predecessor.backupContract.providerPhysicalBackup,
      hostedRestoreEvidence: {
        ...predecessor.backupContract.hostedRestoreEvidence,
        receiptFileName: `${successor.release}-hosted-restore-evidence.json`,
      },
      supabaseCli: predecessor.backupContract.supabaseCli,
      requiredReceiptValues:
        predecessor.postExpandBackupContract.requiredReceiptValues,
    },
    postExpandBackupContract: {
      ...predecessor.postExpandBackupContract,
      id: `post-${successor.release}-backup`,
      version: 2,
      verificationReceiptFileName:
        `${successor.release}-post-expand-backup-verification.json`,
      expectedTableCount: postExpandTables.length,
      expectedTables: postExpandTables,
      expectedReleaseMigrationBaselineHead: successor.requiredRemoteHead,
      expectedReleaseMigrationHead: releaseVersions.at(-1),
      expectedReleaseMigrationVersions: releaseVersions,
      expectedTableContractSha256: textDigest(postExpandTables),
      expectedReleaseMigrationContractSha256: textDigest(releaseVersions),
      capture: {
        file: "scripts/vendor-disclosure-db-backup.ps1",
        sha256: sha256(successorCapture),
      },
      verifier: {
        file: "scripts/vendor-disclosure-db-verify-backup.ps1",
        sha256: sha256(successorVerifier),
      },
      hostedRestoreEvidence: {
        ...predecessor.postExpandBackupContract.hostedRestoreEvidence,
        receiptFileName:
          `${successor.release}-post-expand-hosted-restore-evidence.json`,
      },
    },
    finalizationContract: {
      ...predecessor.finalizationContract,
      version: 2,
    },
    rollbackContract,
    requiredDocuments: predecessor.requiredDocuments,
  };
  const contractFile =
    "supabase/release-contracts/vendor-disclosure-production-controller-v1.json";
  const contractText = `${JSON.stringify(contract, null, 2)}\n`;
  await write(fixture.root, contractFile, contractText);
  await write(
    fixture.root,
    "supabase/release-checks/vendor-disclosure-successor-post.sql",
    successorPostCheckSql,
  );
  await write(
    fixture.root,
    "supabase/contract-migrations/vendor-disclosure-successor-audit.sql",
    successorHistoricalAudit,
  );
  await write(
    fixture.root,
    "scripts/vendor-disclosure-db-backup.ps1",
    successorCapture,
  );
  await write(
    fixture.root,
    "scripts/vendor-disclosure-db-verify-backup.ps1",
    successorVerifier,
  );
  successor.status = "controller_ready";
  successor.deploymentEvidence =
    successorRuntimeEvidenceContracts(successor.release);
  successor.controllerContract = {
    file: contractFile,
    sha256: sha256(contractText),
  };
  await write(
    fixture.root,
    successorFile,
    `${JSON.stringify(successor, null, 2)}\n`,
  );
  return { contract, successor };
}

async function createFixture({ withPostPushOperation = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "amora-production-release-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "amora-production-receipt-"));
  const backupSourceRepo = join(root, "backup-source");
  const migrationA = "select 'a';\n";
  const migrationB = "select 'b';\n";
  const preApplySql = "BEGIN TRANSACTION READ ONLY;\nselect true as verified;\nROLLBACK;\n";
  const postApplySql = "BEGIN TRANSACTION READ ONLY;\nselect true as verified;\nROLLBACK;\n";
  const platformApplySql = "select 'platform apply';\n";
  const platformRollbackSql = "select 'platform rollback';\n";
  const postPushSql = "BEGIN TRANSACTION READ ONLY;\nselect true as verified;\nROLLBACK;\n";
  const postPushApplySql = "select 'post-push platform apply';\n";
  const postPushRollbackSql = "select 'post-push platform rollback';\n";
  const forwardInventorySql = "BEGIN TRANSACTION READ ONLY;\nselect 1 as ai_log_retention_exact_acl_verified;\nROLLBACK;\n";
  const forwardApplySql = "BEGIN;\nselect 'forward apply';\nCOMMIT;\n";
  const forwardVerifySql = "BEGIN TRANSACTION READ ONLY;\nselect 1 as ai_log_retention_exact_acl_verified;\nROLLBACK;\n";
  const finalizerSql = "BEGIN;\nselect 'finalizer';\nCOMMIT;\n";
  const postExpandCapture = "# fixture post-expand capture\n";
  const postExpandVerifier = "# fixture post-expand verifier\n";
  const releaseDocument = "# Fixture production release\n";
  const manifest = {
    release: "test-release",
    projectRef: PROJECT_REF,
    requiredRemoteHead: "20260715000000",
    migrationFloor: "20260716090000",
    historicalReconciliation: [],
    expandMigrations: [
      { file: "20260716090000_a.sql", sha256: sha256(migrationA) },
      { file: "20260716091000_b.sql", sha256: sha256(migrationB) },
    ],
    appliedHotfixes: [],
    preApplyChecks: [
      {
        id: "test-pre-apply",
        type: "read-only-sql",
        file: "supabase/release-checks/test-pre-apply.sql",
        sha256: sha256(preApplySql),
        expectedEvidence: {
          exact_policy_count: 4,
          staging_object_count: 0,
        },
      },
    ],
    postApplyChecks: [
      {
        id: "test-post-apply",
        type: "read-only-sql",
        file: "supabase/release-checks/test-post-apply.sql",
        sha256: sha256(postApplySql),
        expectedEvidence: {
          remaining_pending_count: 0,
        },
      },
    ],
    postPushChecks: withPostPushOperation ? [
      {
        id: "test-post-push",
        type: "read-only-sql",
        file: "supabase/release-checks/test-post-push.sql",
        sha256: sha256(postPushSql),
        expectedEvidence: { exact_storage_policy_count: 1 },
      },
    ] : [],
    forwardOnlySecurityOperations: [{
      id: "ai-log-retention-exact-acl-20260717141000",
      phase: "pre-backup",
      verificationCheckId: "test-pre-apply",
      rollbackPolicy: "forward-fix-only-no-privilege-restoration",
      supersedes: {
        operationId: "ai-log-retention-acl-hotfix-20260717103000",
        forbiddenFiles: [
          "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_inventory.sql",
          "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_apply.sql",
          "supabase/platform-operations/security/20260717103000_ai_log_retention_acl_verify.sql",
        ],
      },
      inventory: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_inventory.sql",
        sha256: sha256(forwardInventorySql),
      },
      apply: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
        sha256: sha256(forwardApplySql),
      },
      verify: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
        sha256: sha256(forwardVerifySql),
        expectedEvidence: { ai_log_retention_exact_acl_verified: 1 },
      },
    }],
    postExpandBackupContract: {
      id: "post-amora-engine-v2-27-table-backup",
      version: 1,
      phase: "post-push-pre-deployment-canary",
      verificationReceiptFileName:
        "test-release-post-expand-backup-verification.json",
      maximumAgeMinutes: 1440,
      expectedTableCount: AMORA_POST_EXPAND_TABLES.length,
      expectedTables: [...AMORA_POST_EXPAND_TABLES],
      expectedReleaseMigrationBaselineHead: "20260715210000",
      expectedReleaseMigrationHead: "20260716117000",
      expectedReleaseMigrationVersions: [...AMORA_RELEASE_MIGRATION_VERSIONS],
      expectedTableContractSha256: AMORA_POST_EXPAND_TABLE_CONTRACT_SHA256,
      expectedReleaseMigrationContractSha256:
        AMORA_RELEASE_MIGRATION_CONTRACT_SHA256,
      expectedCommitBinding: "release-expected-commit",
      requiredLedgerEvidence:
        "live-remote-ledger-and-encrypted-backup-contract",
      requiredReceiptValues: {
        Verified: true,
        SourceCanonicalDigestsVerified: true,
        PGliteJsonbRoundTripVerified: true,
        PlaintextWrittenToDisk: false,
      },
      capture: {
        file: "scripts/amora-db-backup.ps1",
        sha256: sha256(postExpandCapture),
      },
      verifier: {
        file: "scripts/amora-db-verify-backup.ps1",
        sha256: sha256(postExpandVerifier),
      },
      hostedRestoreEvidence: {
        receiptFileName:
          "test-release-post-expand-hosted-restore-evidence.json",
        maximumAgeMinutes: 1440,
        requiredTargetIsolation: "different-supabase-project",
        requiredChecks: [...POST_EXPAND_HOSTED_RESTORE_REQUIRED_CHECKS],
      },
    },
    finalizationContract: {
      id: "production-write-fence-exact-owner-finalizer",
      version: 1,
      operation: {
        id: "production-write-fence-finalize-20260717121000",
        file: "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql",
        sha256: sha256(finalizerSql),
      },
      requiredLeasePhase: "deployment-canary",
      canaryMaximumAgeMinutes: 15,
      deploymentMaximumAgeMinutes: 1440,
      requiredCanaryChecks: [...FINALIZER_REQUIRED_CANARY_CHECKS],
      externalEvidence: structuredClone(FINALIZER_EXTERNAL_EVIDENCE_CONTRACT),
      confirmationIncludesCanarySha256: true,
    },
    manualPlatformOperations: [
      {
        id: PRE_OPERATION_ID,
        phase: "pre-backup",
        verificationCheckId: "test-pre-apply",
        file: "supabase/platform-operations/security/fixture-apply.sql",
        sha256: sha256(platformApplySql),
      },
      ...(withPostPushOperation ? [{
        id: "fixture-post-push-platform-apply",
        phase: "post-push-pre-deploy",
        verificationCheckId: "test-post-push",
        file: "supabase/platform-operations/storage/fixture-post-push-apply.sql",
        sha256: sha256(postPushApplySql),
      }] : []),
    ],
    rollbackArtifacts: [
      {
        id: "fixture-platform-rollback",
        forOperationId: PRE_OPERATION_ID,
        file: "supabase/platform-operations/security/fixture_rollback.sql",
        sha256: sha256(platformRollbackSql),
      },
      ...(withPostPushOperation ? [{
        id: "fixture-post-push-platform-rollback",
        forOperationId: "fixture-post-push-platform-apply",
        file: "supabase/platform-operations/storage/fixture-post-push_rollback.sql",
        sha256: sha256(postPushRollbackSql),
      }] : []),
    ],
    manualControlEvidence: {
      receiptFileName: "test-release-production-write-fence.json",
      storageDrainReceiptFileName: "test-release-storage-signed-upload-drain.json",
      maximumAgeMinutes: 30,
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
      ...(withPostPushOperation
        ? { postPushReceiptFileName: "test-release-post-push-platform.json" }
        : {}),
    },
    requiredDocuments: [
      {
        file: "docs/operations/FIXTURE_PRODUCTION_RELEASE.md",
        sha256: sha256(releaseDocument),
      },
    ],
    backupContract: {
      id: "pre-amora-current-remote-14-table-baseline",
      version: 1,
      expectedTableCount: 14,
      excludedEphemeralTables: [
        "production_release_lease_20260717",
        "rate_limit_buckets",
      ],
      ephemeralRebuildContract:
        "production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)",
      expectedCommitBinding: "release-expected-commit",
      expectedOrigin: EXPECTED_ORIGIN,
      verifier: {
        file: "scripts/amora-db-current-baseline-verify.ps1",
        sha256: sha256(BASELINE_VERIFIER),
      },
      providerPhysicalBackup: {
        maximumAgeHours: 26,
        requiredStatus: "COMPLETED",
        requirePhysicalBackup: true,
        restoreCapability: "completed-physical-backup",
      },
      hostedRestoreEvidence: {
        receiptFileName: "test-release-hosted-restore-evidence.json",
        maximumAgeMinutes: 1440,
        requiredTargetIsolation: "different-supabase-project",
        requiredChecks: [
          "authApiSmokeVerified",
          "authUsersSchemaAndDataVerified",
          "checkConstraintsVerified",
          "columnDefaultsVerified",
          "destructiveRestoreDrillCompleted",
          "isolatedTargetConfirmed",
          "logicalDataDigestsVerified",
          "rowLevelSecurityPoliciesVerified",
          "rpcDefinitionsAndAclVerified",
          "storageMetadataRestoredVerified",
          "triggersVerified",
          "typedSchemaVerified",
        ],
      },
      supabaseCli: {
        version: CLI_VERSION,
        binarySha256: CLI_BINARY_SHA,
      },
    },
  };
  await write(
    root,
    "supabase/release-manifests/amora-engine-v2-20260716.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await write(root, "supabase/migrations/20260716090000_a.sql", migrationA);
  await write(root, "supabase/migrations/20260716091000_b.sql", migrationB);
  await write(root, "supabase/release-checks/test-pre-apply.sql", preApplySql);
  await write(root, "supabase/release-checks/test-post-apply.sql", postApplySql);
  if (withPostPushOperation) {
    await write(root, "supabase/release-checks/test-post-push.sql", postPushSql);
  }
  await write(
    root,
    "supabase/platform-operations/security/fixture-apply.sql",
    platformApplySql,
  );
  await write(
    root,
    "supabase/platform-operations/security/fixture_rollback.sql",
    platformRollbackSql,
  );
  await write(
    root,
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_inventory.sql",
    forwardInventorySql,
  );
  await write(
    root,
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
    forwardApplySql,
  );
  await write(
    root,
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
    forwardVerifySql,
  );
  await write(
    root,
    "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql",
    finalizerSql,
  );
  await write(root, "scripts/amora-db-backup.ps1", postExpandCapture);
  await write(root, "scripts/amora-db-verify-backup.ps1", postExpandVerifier);
  if (withPostPushOperation) {
    await write(
      root,
      "supabase/platform-operations/storage/fixture-post-push-apply.sql",
      postPushApplySql,
    );
    await write(
      root,
      "supabase/platform-operations/storage/fixture-post-push_rollback.sql",
      postPushRollbackSql,
    );
  }
  await write(root, "docs/operations/FIXTURE_PRODUCTION_RELEASE.md", releaseDocument);
  await write(root, "supabase/.temp/project-ref", `${PROJECT_REF}\n`);
  await write(root, "node_modules/supabase/dist/supabase.js", "// fixture\n");
  await write(root, "node_modules/supabase/package.json", JSON.stringify({ version: CLI_VERSION }));
  await write(
    root,
    `node_modules/@supabase/${platformCliPackage()}/package.json`,
    JSON.stringify({ version: CLI_VERSION }),
  );
  await write(
    root,
    `node_modules/@supabase/${platformCliPackage()}/bin/supabase${process.platform === "win32" ? ".exe" : ""}`,
    CLI_BINARY,
  );
  await write(root, "package.json", JSON.stringify({ devDependencies: { supabase: CLI_VERSION } }));
  await write(
    backupSourceRepo,
    "scripts/amora-db-current-baseline-verify.ps1",
    BASELINE_VERIFIER,
  );

  const backupReceiptPath = join(receiptRoot, "backup-verification-receipt.json");
  const clockBase = Math.floor(Date.now() / 1000) * 1000;
  const freezeVerifiedAt = new Date(clockBase - 140 * 60_000).toISOString();
  const firstStableSnapshotAt = new Date(clockBase - 10 * 60_000).toISOString();
  const secondStableSnapshotAt = new Date(clockBase - 5 * 60_000).toISOString();
  const sourceCapturedAt = new Date(clockBase - 4 * 60_000).toISOString();
  const createdAtUtc = new Date(clockBase - 3 * 60_000).toISOString();
  const writeFenceVerifiedAt = new Date(clockBase - 2 * 60_000).toISOString();
  const providerBackupAt = new Date(clockBase - 60 * 60_000).toISOString();
  const providerBackupUnix = (clockBase - 60 * 60_000) / 1000;
  await writeFile(
    backupReceiptPath,
    JSON.stringify({
      Verified: true,
      BackupDirectory: join(root, "private-backup"),
      BackupSetId: BACKUP_SET_ID,
      ManifestSha256: MANIFEST_SHA,
      GitCommit: BACKUP_COMMIT,
      SchemaContractSha256: SCHEMA_CONTRACT_SHA,
      SourceRelationContractSha256: RELATION_CONTRACT_SHA,
      SourceCapturedAt: sourceCapturedAt,
      CreatedAtUtc: createdAtUtc,
      LogicalRowReplayVerified: true,
      RestoredColumnCount: 175,
      UniqueConstraintsReplayed: 15,
      ForeignKeysReplayed: 12,
      ExternalForeignKeysSkipped: 7,
      CheckConstraintsDocumented: 35,
      CheckConstraintsReplayed: 0,
      TypedSchemaReplayed: false,
      PlaintextWrittenToDisk: false,
      TableCount: 14,
      ExcludedEphemeralTableCount: 2,
      EphemeralRebuildContract:
        "production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)",
      TotalRows: 42,
    }),
    "utf8",
  );
  const hostedRestoreReceiptPath = join(
    receiptRoot,
    manifest.backupContract.hostedRestoreEvidence.receiptFileName,
  );
  await writeFile(hostedRestoreReceiptPath, JSON.stringify({
    receiptVersion: 1,
    release: manifest.release,
    releaseCommit: RELEASE_COMMIT,
    sourceProjectRef: PROJECT_REF,
    targetProjectRef: HOSTED_RESTORE_PROJECT_REF,
    backupSetId: BACKUP_SET_ID,
    backupManifestSha256: MANIFEST_SHA,
    sourceSchemaContractSha256: SCHEMA_CONTRACT_SHA,
    targetSchemaContractSha256: SCHEMA_CONTRACT_SHA,
    sourceDataContractSha256: RELATION_CONTRACT_SHA,
    targetDataContractSha256: RELATION_CONTRACT_SHA,
    providerRestoreJobId: "restore-job-12345678",
    restoreCompletedAt: new Date(clockBase - 90_000).toISOString(),
    verifiedAt: new Date(clockBase - 60_000).toISOString(),
    checks: Object.fromEntries(
      manifest.backupContract.hostedRestoreEvidence.requiredChecks
        .map((name) => [name, true]),
    ),
    containsSensitiveValues: false,
  }), "utf8");
  const writeFenceReceiptPath = join(
    receiptRoot,
    manifest.manualControlEvidence.receiptFileName,
  );
  const postPushReceiptPath = withPostPushOperation
    ? join(receiptRoot, manifest.manualControlEvidence.postPushReceiptFileName)
    : null;
  const storageDrainStem = manifest.manualControlEvidence.storageDrainReceiptFileName
    .slice(0, -".json".length);
  const storageDrainStartPath = join(receiptRoot, `${storageDrainStem}.start.json`);
  const storageDrainFirstPath = join(receiptRoot, `${storageDrainStem}.snapshot-1.json`);
  const storageDrainFinalPath = join(
    receiptRoot,
    manifest.manualControlEvidence.storageDrainReceiptFileName,
  );
  const preOperation = manifest.manualPlatformOperations.find(
    (operation) => operation.id === PRE_OPERATION_ID,
  );
  const operation = {
    operationId: preOperation.id,
    verificationCheckId: preOperation.verificationCheckId,
    applyArtifactSha256: preOperation.sha256,
  };
  await writeFile(storageDrainStartPath, `${JSON.stringify({
    receiptVersion: 1,
    stage: "freeze-start",
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: RELEASE_COMMIT,
    operation,
    controls: {
      vercelProductionWriteFenceEnabled: true,
      vercelDeploymentCommit: RELEASE_COMMIT,
      supabaseAuthSignupDisabled: true,
    },
    databaseWriteFence: {
      publicTableCount: 73,
      triggerCount: 73,
      guardFunctionCount: 1,
      attachFunctionCount: 1,
      liveSchemaContractFunctionCount: 1,
      eventTriggerCount: 2,
    },
    observedAt: freezeVerifiedAt,
    totalObjectCount: 49,
    objectInventorySha256: "D".repeat(64),
    mutationPolicyCount: 0,
    containsSensitiveValues: false,
  }, null, 2)}\n`, "utf8");
  const startReceiptSha256 = await rawFileSha256(storageDrainStartPath);
  await writeFile(storageDrainFirstPath, `${JSON.stringify({
    receiptVersion: 1,
    stage: "stable-snapshot-1",
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: RELEASE_COMMIT,
    operation,
    startReceiptSha256,
    databaseWriteFence: {
      publicTableCount: 73,
      triggerCount: 73,
      guardFunctionCount: 1,
      attachFunctionCount: 1,
      liveSchemaContractFunctionCount: 1,
      eventTriggerCount: 2,
    },
    observedAt: firstStableSnapshotAt,
    totalObjectCount: 49,
    objectInventorySha256: "E".repeat(64),
    mutationPolicyCount: 0,
    containsSensitiveValues: false,
  }, null, 2)}\n`, "utf8");
  const firstSnapshotReceiptSha256 = await rawFileSha256(storageDrainFirstPath);
  await writeFile(storageDrainFinalPath, `${JSON.stringify({
    receiptVersion: 1,
    stage: "verified",
    release: manifest.release,
    projectRef: PROJECT_REF,
    releaseCommit: RELEASE_COMMIT,
    operation,
    startReceiptSha256,
    firstSnapshotReceiptSha256,
    freezeVerifiedAt,
    firstStableSnapshotAt,
    secondStableSnapshotAt,
    signedUploadTokenTtlMinutes: 120,
    signedUploadGraceMinutes: 10,
    storageStabilityWindowMinutes: 5,
    totalObjectCount: 49,
    objectInventorySha256: "E".repeat(64),
    mutationPolicyCount: 0,
    containsSensitiveValues: false,
  }, null, 2)}\n`, "utf8");
  const storageDrainReceiptSha256 = await rawFileSha256(storageDrainFinalPath);
  await writeFile(
    writeFenceReceiptPath,
    JSON.stringify({
      receiptVersion: 1,
      release: manifest.release,
      projectRef: PROJECT_REF,
      releaseCommit: RELEASE_COMMIT,
      backupSetId: BACKUP_SET_ID,
      backupManifestSha256: MANIFEST_SHA,
      verifiedAt: writeFenceVerifiedAt,
      controls: {
        vercelProductionWriteFenceEnabled: true,
        vercelDeploymentCommit: RELEASE_COMMIT,
        supabaseAuthSignupDisabled: true,
      },
      providerPhysicalBackup: {
        status: "COMPLETED",
        isPhysicalBackup: true,
        insertedAt: providerBackupAt,
        latestPhysicalBackupDateUnix: providerBackupUnix,
        ageSeconds: 58 * 60,
        restoreCandidateAvailable: true,
      },
      storageSignedUploadDrain: {
        receiptSha256: storageDrainReceiptSha256,
        startReceiptSha256,
        freezeVerifiedAt,
        preBackupControls: {
          vercelProductionWriteFenceEnabled: true,
          vercelDeploymentCommit: RELEASE_COMMIT,
          supabaseAuthSignupDisabled: true,
        },
        databaseWriteFence: {
          publicTableCount: 73,
          triggerCount: 73,
          guardFunctionCount: 1,
          attachFunctionCount: 1,
          liveSchemaContractFunctionCount: 1,
          eventTriggerCount: 2,
        },
        firstStableSnapshotAt,
        secondStableSnapshotAt,
        totalObjectCount: 49,
        objectInventorySha256: "E".repeat(64),
        mutationPolicyCount: 0,
      },
      operations: manifest.manualPlatformOperations
        .filter((operation) => operation.phase === "pre-backup")
        .map((operation) => ({
        operationId: operation.id,
        verificationCheckId: operation.verificationCheckId,
        applyArtifactSha256: operation.sha256,
        verified: true,
        })),
      forwardOnlySecurityOperations:
        manifest.forwardOnlySecurityOperations.map((operation) => ({
          operationId: operation.id,
          verificationCheckId: operation.verificationCheckId,
          inventoryArtifactSha256: operation.inventory.sha256,
          applyArtifactSha256: operation.apply.sha256,
          verifyArtifactSha256: operation.verify.sha256,
          expectedEvidence: operation.verify.expectedEvidence,
          rollbackPolicy: operation.rollbackPolicy,
          verified: true,
        })),
      containsSensitiveValues: false,
    }),
    "utf8",
  );

  return {
    root,
    receiptRoot,
    backupSourceRepo,
    backupReceiptPath,
    hostedRestoreReceiptPath,
    sourceCapturedAt,
    createdAtUtc,
    storageDrainStartPath,
    storageDrainFirstPath,
    storageDrainFinalPath,
    writeFenceReceiptPath,
    postPushReceiptPath,
    outcomeReceiptPath: join(receiptRoot, "release.json"),
  };
}

test("production release controller refuses a deployment-blocked successor before any release action", async () => {
  const fixture = await createFixture();
  try {
    await addBlockedSuccessorRelease(fixture);
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--check-only",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--confirm-production=CHECK:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
      }),
      (error) => error?.code === "SUCCESSOR_RELEASE_DEPLOYMENT_BLOCKED",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("controller-ready successor selects its exact manifest body instead of the predecessor", async () => {
  const fixture = await createFixture();
  try {
    const ready = await addControllerReadySuccessorRelease(fixture);
    const selection =
      await productionReleaseControllerTestHooks.selectReleaseManifest(fixture.root);
    assert.equal(selection.manifest.release, ready.successor.release);
    assert.deepEqual(
      selection.expectedMigrations,
      ready.successor.expandMigrations.map((entry) => entry.file),
    );
    assert.equal(selection.manifest.requiredRemoteHead, "20260716091000");
    assert.equal(selection.successor, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("successor backup validation requires the exact current-remote table set and private HBAM2 manifest", async () => {
  const fixture = await createFixture();
  try {
    const { contract } = await addControllerReadySuccessorRelease(fixture);
    const backupContract = contract.backupContract;
    const verifierText = await readFile(
      join(fixture.root, backupContract.verifier.file),
      "utf8",
    );
    await write(
      fixture.backupSourceRepo,
      backupContract.verifier.file,
      verifierText,
    );

    const backupDirectory = join(fixture.receiptRoot, "successor-private-backup");
    await mkdir(backupDirectory, { recursive: true });
    const createdAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const inventoryCapturedAt =
      new Date(Date.parse(createdAt) - 30_000).toISOString();
    const sourceCapturedAt =
      new Date(Date.parse(createdAt) - 60_000).toISOString();
    const inventoryContractSha256 = "D".repeat(64);
    const sourceRelationContractSha256 = "E".repeat(64);
    const liveSchemaContractSha256 = "F".repeat(64);
    const logicalDataContractSha256 = "A".repeat(64);
    const cliRelativePath = "node_modules/@supabase/cli/bin/supabase.exe";
    const privateManifest = {
      format: "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser",
      format_version: 2,
      status: "complete",
      backup_set_id: BACKUP_SET_ID,
      created_at_utc: createdAt,
      source_captured_at: sourceCapturedAt,
      inventory_captured_at: inventoryCapturedAt,
      inventory_contract_sha256: inventoryContractSha256,
      source_relation_contract_sha256: sourceRelationContractSha256,
      live_schema_contract_sha256: liveSchemaContractSha256,
      logical_data_contract_sha256: logicalDataContractSha256,
      source_project_ref: PROJECT_REF,
      implementation: { git_commit: RELEASE_COMMIT },
      supabase_cli: {
        version: backupContract.supabaseCli.version,
        invocation_relative_path: cliRelativePath,
        files: {
          [cliRelativePath]: backupContract.supabaseCli.binarySha256,
        },
      },
      plaintext_written_to_disk: false,
      tables: Object.fromEntries(
        backupContract.expectedTables.map((table) => [table, { row_count: 0 }]),
      ),
    };
    await writeFile(
      join(backupDirectory, "manifest.json"),
      `${JSON.stringify(privateManifest, null, 2)}\n`,
      "utf8",
    );
    for (const file of [
      "logical-data.json.hbam2",
      "logical-data.json.key.dpapi",
      "schema-inventory.json.hbam2",
      "schema-inventory.json.key.dpapi",
    ]) {
      await writeFile(join(backupDirectory, file), `${file}\n`, "utf8");
    }
    const receipt = {
      AgeSeconds: 120,
      BackupDirectory: backupDirectory,
      BackupSetId: BACKUP_SET_ID,
      CreatedAtUtc: createdAt,
      ExternalForeignKeysSkipped: 0,
      ForeignKeysChecked: 12,
      GitCommit: RELEASE_COMMIT,
      InventoryCapturedAt: inventoryCapturedAt,
      InventoryContractSha256: inventoryContractSha256,
      LiveSchemaContractSha256: liveSchemaContractSha256,
      LogicalDataContractSha256: logicalDataContractSha256,
      ManifestSha256: await rawFileSha256(
        join(backupDirectory, "manifest.json"),
      ),
      NodeSha256: "B".repeat(64),
      NodeVersion: "v24.4.1",
      PGliteJsonbRoundTripVerified: true,
      PGliteTreeSha256: "C".repeat(64),
      PGliteVersion: "0.3.8",
      PlaintextWrittenToDisk: false,
      PrimaryConstraintsChecked: 24,
      SourceCanonicalDigestsVerified: true,
      SourceCapturedAt: sourceCapturedAt,
      SourceRelationContractSha256: sourceRelationContractSha256,
      SupabaseCliBinarySha256: backupContract.supabaseCli.binarySha256,
      SupabaseCliVersion: backupContract.supabaseCli.version,
      TableCount: backupContract.expectedTableCount,
      TotalRows: 42,
      Verified: true,
    };
    const receiptPath = join(
      fixture.receiptRoot,
      "successor-backup-verification.json",
    );
    await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
    const runCommand = async (command, args, options) => {
      if (command === "git" && options.cwd === fixture.backupSourceRepo) {
        if (args[0] === "status") {
          return { status: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "rev-parse") {
          return { status: 0, stdout: `${RELEASE_COMMIT}\n`, stderr: "" };
        }
        if (args[0] === "remote") {
          return {
            status: 0,
            stdout: `${backupContract.expectedOrigin}\n`,
            stderr: "",
          };
        }
      }
      if (command.toLowerCase().includes("powershell")
          || command.toLowerCase().endsWith("pwsh")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            ...receipt,
            AgeSeconds: Math.floor(
              (Date.now() - Date.parse(createdAt)) / 1_000,
            ),
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    };

    const verified =
      await productionReleaseControllerTestHooks.validateBackupReceipt({
        path: receiptPath,
        repoRoot: fixture.root,
        backupSourceRepo: fixture.backupSourceRepo,
        backupContract,
        expectedCommit: RELEASE_COMMIT,
        projectRef: PROJECT_REF,
        runCommand,
      });
    assert.equal(verified.TableCount, backupContract.expectedTableCount);
    assert.equal(
      verified.SchemaContractSha256,
      receipt.LiveSchemaContractSha256,
    );

    await writeFile(
      receiptPath,
      JSON.stringify({ ...receipt, TableCount: 14 }),
      "utf8",
    );
    await assert.rejects(
      productionReleaseControllerTestHooks.validateBackupReceipt({
        path: receiptPath,
        repoRoot: fixture.root,
        backupSourceRepo: fixture.backupSourceRepo,
        backupContract,
        expectedCommit: RELEASE_COMMIT,
        projectRef: PROJECT_REF,
        runCommand,
      }),
      (error) => error?.code === "BACKUP_RECEIPT_INVALID",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("controller-ready successor refuses a changed controller contract pin", async () => {
  const fixture = await createFixture();
  try {
    const ready = await addControllerReadySuccessorRelease(fixture);
    await write(
      fixture.root,
      ready.successor.controllerContract.file,
      `${JSON.stringify({ ...ready.contract, contractVersion: 2 })}\n`,
    );
    await assert.rejects(
      productionReleaseControllerTestHooks.selectReleaseManifest(fixture.root),
      (error) => error?.code === "SUCCESSOR_RELEASE_CONTRACT_INVALID",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("controller-ready successor derives production confirmation from the successor identity", async () => {
  const fixture = await createFixture();
  try {
    await addControllerReadySuccessorRelease(fixture);
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--check-only",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--confirm-production=CHECK:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
      }),
      (error) => error?.code === "PRODUCTION_CONFIRMATION_MISMATCH",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("controller-ready successor cannot enter Git or Supabase gates without all five fresh private receipts", async () => {
  const fixture = await createFixture();
  let commandCalled = false;
  try {
    const ready = await addControllerReadySuccessorRelease(fixture);
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--check-only",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--confirm-production=CHECK:${PROJECT_REF}:${ready.successor.release}:${RELEASE_COMMIT}`,
        ],
        runCommand: async () => {
          commandCalled = true;
          return { status: 1, stdout: "", stderr: "" };
        },
      }),
      (error) => error?.code === "RUNTIME_EVIDENCE_RAW_INVALID",
    );
    assert.equal(commandCalled, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

function successfulRunner(
  { backupSourceRepo, sourceCapturedAt, createdAtUtc },
  {
    preDryRun = "DRY RUN: migrations will not be pushed\n • 20260716090000_a.sql\n • 20260716091000_b.sql\n",
    dryRunTruncated = false,
    pushResult = { status: 0, stdout: "Finished supabase db push.\n", stderr: "" },
    preLedger = "  20260715000000 | 20260715000000 | 2026-07-15\n",
    postLedger = "  20260715000000 | 20260715000000 | 2026-07-15\n  20260716090000 | 20260716090000 | 2026-07-16\n  20260716091000 | 20260716091000 | 2026-07-16\n",
    queryResult,
    queryResults,
    releaseOrigin = EXPECTED_ORIGIN,
    backupOrigin = EXPECTED_ORIGIN,
    backupHead = BACKUP_COMMIT,
    databaseAlreadyPushed = false,
    leaseResults = {},
    onCall = () => {},
  } = {},
) {
  let dryRunCount = 0;
  let ledgerCount = 0;
  let queryCount = 0;
  return async (command, args, options) => {
    await onCall(command, args, options);
    if (command === "git" && options.cwd === backupSourceRepo) {
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse") return { status: 0, stdout: `${backupHead}\n`, stderr: "" };
      if (args[0] === "remote" && args[1] === "get-url") {
        return { status: 0, stdout: `${backupOrigin}\n`, stderr: "" };
      }
    }
    if (command === "git") {
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse") return { status: 0, stdout: `${RELEASE_COMMIT}\n`, stderr: "" };
      if (args[0] === "remote" && args[1] === "get-url") {
        return { status: 0, stdout: `${releaseOrigin}\n`, stderr: "" };
      }
      if (args[0] === "ls-remote") {
        return {
          status: 0,
          stdout: `${RELEASE_COMMIT}\trefs/heads/release\n`,
          stderr: "",
        };
      }
    }
    if (command.toLowerCase().includes("powershell") || command.toLowerCase().endsWith("pwsh")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          Verified: true,
          BackupSetId: BACKUP_SET_ID,
          ManifestSha256: MANIFEST_SHA,
          GitCommit: BACKUP_COMMIT,
          SchemaContractSha256: SCHEMA_CONTRACT_SHA,
          SourceRelationContractSha256: RELATION_CONTRACT_SHA,
          SourceCapturedAt: sourceCapturedAt,
          CreatedAtUtc: createdAtUtc,
          LogicalRowReplayVerified: true,
          RestoredColumnCount: 175,
          UniqueConstraintsReplayed: 15,
          ForeignKeysReplayed: 12,
          ExternalForeignKeysSkipped: 7,
          CheckConstraintsDocumented: 35,
          CheckConstraintsReplayed: 0,
          TypedSchemaReplayed: false,
          PlaintextWrittenToDisk: false,
          TableCount: 14,
          ExcludedEphemeralTableCount: 2,
          EphemeralRebuildContract:
            "production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)",
          TotalRows: 42,
        }),
        stderr: "",
      };
    }
    if (command === process.execPath && args[0].endsWith("supabase-release-fence.mjs")) {
      return { status: 0, stdout: "Static release manifest verified.\n", stderr: "" };
    }
    if (args[0] === "db" && args[1] === "push" && args.includes("--dry-run")) {
      dryRunCount += 1;
      return dryRunCount === 1 && !databaseAlreadyPushed
        ? { status: 0, stdout: preDryRun, stderr: "", outputTruncated: dryRunTruncated }
        : { status: 0, stdout: "Remote database is up to date.\n", stderr: "" };
    }
    if (args[0] === "migration" && args[1] === "list") {
      ledgerCount += 1;
      return {
        status: 0,
        stdout: ledgerCount === 1 && !databaseAlreadyPushed ? preLedger : postLedger,
        stderr: "",
      };
    }
    if (args[0] === "db" && args[1] === "query") {
      const file = queryFileFromCall(args) ?? "";
      const directSql = args.find((value) =>
        typeof value === "string" && value.includes("remote_release_lease_"));
      if (directSql) {
        assert.equal(args.includes("--file"), false);
        const sql = directSql;
        assert.match(sql, /pg_catalog\.pg_control_system\(\)/);
        assert.match(sql, /7000000000000000001/);
        const key = sql.match(/AS\s+(remote_release_lease_[a-z_]+_count)\b/i)?.[1];
        assert.ok(key, "remote lease SQL must expose one exact count alias");
        const action = key
          .replace(/^remote_release_lease_/, "")
          .replace(/_count$/, "");
        const configured = leaseResults[action];
        if (configured && typeof configured === "object") return configured;
        return {
          status: 0,
          stdout: JSON.stringify([{ [key]: configured ?? 1 }]),
          stderr: "",
        };
      }
      if (file.endsWith(
        "20260717141000_ai_log_retention_exact_acl_verify.sql",
      )) {
        return {
          status: 0,
          stdout: '[{"ai_log_retention_exact_acl_verified":1}]\n',
          stderr: "",
        };
      }
      const defaultResult = file.endsWith("test-pre-apply.sql")
        ? {
            status: 0,
            stdout: '[{"verified":true,"exact_policy_count":4,"staging_object_count":0}]\n',
            stderr: "",
          }
        : file.endsWith("test-post-push.sql")
          ? {
              status: 0,
              stdout: '[{"verified":true,"exact_storage_policy_count":1}]\n',
              stderr: "",
            }
        : {
            status: 0,
            stdout: '[{"verified":true,"remaining_pending_count":0}]\n',
            stderr: "",
          };
      const result = queryResults?.[queryCount] ?? queryResult ?? defaultResult;
      queryCount += 1;
      return result;
    }
    if (args[0] === "db" && args[1] === "push") {
      return pushResult;
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };
}

test("the manifest must pin one valid remote head before the migration floor", async () => {
  for (const requiredRemoteHead of [undefined, "2026071500000", "20260716090000"]) {
    const fixture = await createFixture();
    try {
      const manifestPath = join(
        fixture.root,
        "supabase/release-manifests/amora-engine-v2-20260716.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (requiredRemoteHead === undefined) delete manifest.requiredRemoteHead;
      else manifest.requiredRemoteHead = requiredRemoteHead;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture),
        }),
        (error) => error.code === "MANIFEST_INVALID",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("the manifest requires non-empty hash-pinned pre-apply and post-apply checks", async () => {
  for (const section of ["preApplyChecks", "postApplyChecks"]) {
    for (const mode of ["missing", "empty"]) {
      const fixture = await createFixture();
      try {
        const manifestPath = join(
          fixture.root,
          "supabase/release-manifests/amora-engine-v2-20260716.json",
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        if (mode === "missing") delete manifest[section];
        else manifest[section] = [];
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        await assert.rejects(
          runProductionRelease({
            repoRoot: fixture.root,
            argv: [
              "--apply",
              `--expected-commit=${RELEASE_COMMIT}`,
              "--remote-ref=origin/release",
              `--backup-receipt=${fixture.backupReceiptPath}`,
              `--backup-source-repo=${fixture.backupSourceRepo}`,
              `--receipt-out=${fixture.outcomeReceiptPath}`,
              `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
            ],
            runCommand: successfulRunner(fixture),
          }),
          (error) => error.code === "MANIFEST_INVALID",
        );
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
        await rm(fixture.receiptRoot, { recursive: true, force: true });
      }
    }
  }
});

test("the manifest must pin the exact current 14-table backup and ephemeral rebuild contract", async () => {
  const mutations = [
    (manifest) => { delete manifest.backupContract; },
    (manifest) => { manifest.backupContract.expectedTableCount = 11; },
    (manifest) => { manifest.backupContract.expectedCommitBinding = "manifest-literal"; },
    (manifest) => { manifest.backupContract.expectedOrigin = "git@github.com:owner/repo.git"; },
    (manifest) => { manifest.backupContract.verifier.file = "scripts/amora-db-verify-backup.ps1"; },
    (manifest) => { manifest.backupContract.verifier.sha256 = "0".repeat(63); },
    (manifest) => { manifest.backupContract.supabaseCli.binarySha256 = "a".repeat(64); },
  ];
  for (const mutate of mutations) {
    const fixture = await createFixture();
    const calls = [];
    try {
      const manifestPath = join(
        fixture.root,
        "supabase/release-manifests/amora-engine-v2-20260716.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      mutate(manifest);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            onCall: (command, args) => calls.push([command, ...args]),
          }),
        }),
        (error) => error.code === "BACKUP_CONTRACT_INVALID",
      );
      assert.deepEqual(calls, []);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("the controller requires hash-pinned platform operations, rollbacks and release documents", async () => {
  const mutations = [
    (manifest) => { manifest.manualPlatformOperations = []; },
    (manifest) => { delete manifest.rollbackArtifacts; },
    (manifest) => { manifest.requiredDocuments = []; },
    (manifest) => { manifest.manualPlatformOperations[0].id = "Invalid ID"; },
    (manifest) => { manifest.rollbackArtifacts[0].file = "../escape.sql"; },
    (manifest) => { delete manifest.manualPlatformOperations[0].phase; },
    (manifest) => { manifest.manualPlatformOperations[0].verificationCheckId = "test-post-apply"; },
    (manifest) => { manifest.rollbackArtifacts[0].forOperationId = "missing-operation"; },
  ];
  for (const mutate of mutations) {
    const fixture = await createFixture();
    const calls = [];
    try {
      const manifestPath = join(
        fixture.root,
        "supabase/release-manifests/amora-engine-v2-20260716.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      mutate(manifest);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            onCall: (command, args) => calls.push([command, ...args]),
          }),
        }),
        (error) => error.code === "RELEASE_ARTIFACT_MANIFEST_INVALID",
      );
      assert.deepEqual(calls, []);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("the controller requires fresh composite evidence for web, Auth and every manual operation", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    await rm(fixture.writeFenceReceiptPath);

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--check-only",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--confirm-production=CHECK:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "WRITE_FENCE_RECEIPT_INVALID",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("the composite write-fence receipt is exact, backup-bound and fail-closed", async () => {
  const mutations = [
    (receipt) => { receipt.controls.vercelProductionWriteFenceEnabled = false; },
    (receipt) => { receipt.controls.vercelDeploymentCommit = "2".repeat(40); },
    (receipt) => { receipt.controls.supabaseAuthSignupDisabled = false; },
    (receipt) => { receipt.backupSetId = "87654321-4321-4321-8321-cba987654321"; },
    (receipt) => { receipt.operations[0].operationId = "different-operation"; },
    (receipt) => { receipt.operations[0].verified = false; },
    (receipt) => { receipt.verifiedAt = "2020-01-01T00:00:00.000Z"; },
    (receipt) => { receipt.unexpected = true; },
  ];

  for (const mutate of mutations) {
    const fixture = await createFixture();
    const calls = [];
    try {
      const receipt = JSON.parse(await readFile(fixture.writeFenceReceiptPath, "utf8"));
      mutate(receipt);
      await writeFile(fixture.writeFenceReceiptPath, JSON.stringify(receipt), "utf8");

      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--check-only",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--confirm-production=CHECK:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            onCall: (command, args) => calls.push([command, ...args]),
          }),
        }),
        (error) => error.code === "WRITE_FENCE_RECEIPT_INVALID",
      );
      assert.equal(calls.some((call) => call.includes("--yes")), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("missing or semantically incomplete isolated hosted restore evidence is a hard pre-push NO-GO", async () => {
  for (const scenario of ["missing", "auth-check-false", "same-project"]) {
    const fixture = await createFixture();
    const calls = [];
    try {
      if (scenario === "missing") {
        await rm(fixture.hostedRestoreReceiptPath);
      } else {
        const receipt = JSON.parse(await readFile(
          fixture.hostedRestoreReceiptPath,
          "utf8",
        ));
        if (scenario === "auth-check-false") {
          receipt.checks.authApiSmokeVerified = false;
        } else {
          receipt.targetProjectRef = PROJECT_REF;
        }
        await writeFile(
          fixture.hostedRestoreReceiptPath,
          JSON.stringify(receipt),
          "utf8",
        );
      }
      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            onCall: (command, args) => calls.push([command, ...args]),
          }),
        }),
        (error) => error.code === (scenario === "missing"
          ? "HOSTED_RESTORE_EVIDENCE_REQUIRED"
          : "HOSTED_RESTORE_EVIDENCE_INVALID"),
      );
      assert.equal(calls.some((call) => call.includes("--yes")), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("the release manifest cannot omit the composite write-fence receipt contract", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    const manifestPath = join(
      fixture.root,
      "supabase/release-manifests/amora-engine-v2-20260716.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.manualControlEvidence;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--check-only",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--confirm-production=CHECK:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "MANUAL_CONTROL_EVIDENCE_INVALID",
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("the controller detects release artifact content drift before any production command", async () => {
  for (const file of [
    "supabase/platform-operations/security/fixture-apply.sql",
    "supabase/platform-operations/security/fixture_rollback.sql",
    "docs/operations/FIXTURE_PRODUCTION_RELEASE.md",
  ]) {
    const fixture = await createFixture();
    const calls = [];
    try {
      await write(fixture.root, file, "tampered\n");
      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            onCall: (command, args) => calls.push([command, ...args]),
          }),
        }),
        (error) => error.code === "RELEASE_ARTIFACT_HASH_MISMATCH",
      );
      assert.deepEqual(calls, []);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("a pre-apply check hash mismatch is rejected before any production command", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    const manifestPath = join(
      fixture.root,
      "supabase/release-manifests/amora-engine-v2-20260716.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.preApplyChecks[0].sha256 = "0".repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "PRECONDITION_HASH_MISMATCH",
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("every release check requires a unique safe identifier", async () => {
  for (const invalidId of [undefined, "Invalid Check"]) {
    const fixture = await createFixture();
    try {
      const manifestPath = join(
        fixture.root,
        "supabase/release-manifests/amora-engine-v2-20260716.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (invalidId === undefined) delete manifest.preApplyChecks[0].id;
      else manifest.preApplyChecks[0].id = invalidId;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture),
        }),
        (error) => error.code === "PRECONDITION_MANIFEST_INVALID",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("every release check pins non-empty bounded count evidence", async () => {
  const mutations = [
    (check) => { delete check.expectedEvidence; },
    (check) => { check.expectedEvidence = {}; },
    (check) => { check.expectedEvidence = { policy_total: 4 }; },
    (check) => { check.expectedEvidence = { exact_policy_count: -1 }; },
    (check) => { check.expectedEvidence = { exact_policy_count: 1_000_000_001 }; },
  ];
  for (const mutate of mutations) {
    const fixture = await createFixture();
    try {
      const manifestPath = join(
        fixture.root,
        "supabase/release-manifests/amora-engine-v2-20260716.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      mutate(manifest.preApplyChecks[0]);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture),
        }),
        (error) => error.code === "PRECONDITION_MANIFEST_INVALID",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("hash-pinned pending set is applied once and proven clean after a fresh verified backup", async () => {
  const fixture = await createFixture();
  try {
    const result = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
    });

    assert.equal(result.status, "database_expand_verified_lease_held");
    const receipt = JSON.parse(await readFile(fixture.outcomeReceiptPath, "utf8"));
    assert.equal(receipt.status, "database_expand_verified_lease_held");
    assert.equal(receipt.remoteReleaseLeasePhase, "deployment-canary");
    assert.equal(receipt.rerunProhibited, true);
    assert.deepEqual(receipt.migrations, [
      "20260716090000_a.sql",
      "20260716091000_b.sql",
    ]);
    assert.equal(receipt.projectRef, PROJECT_REF);
    assert.equal(receipt.releaseCommit, RELEASE_COMMIT);
    assert.equal(receipt.backupSetId, BACKUP_SET_ID);
    assert.equal(receipt.backupGitCommit, BACKUP_COMMIT);
    assert.equal(receipt.backupContractId, "pre-amora-current-remote-14-table-baseline");
    assert.equal(receipt.backupContractVersion, 1);
    assert.equal(receipt.backupExpectedTableCount, 14);
    assert.deepEqual(receipt.backupExcludedEphemeralTables, [
      "production_release_lease_20260717",
      "rate_limit_buckets",
    ]);
    assert.equal(
      receipt.backupEphemeralRebuildContract,
      "production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)",
    );
    assert.equal(receipt.backupVerifierSha256, sha256(BASELINE_VERIFIER));
    assert.equal(receipt.sourceOrigin, EXPECTED_ORIGIN);
    assert.deepEqual(receipt.verifiedManualOperationIds, [PRE_OPERATION_ID]);
    assert.equal(receipt.verifiedManualOperationCount, 1);
    assert.deepEqual(receipt.rollbackArtifactIds, ["fixture-platform-rollback"]);
    assert.match(receipt.writeFenceEvidenceSha256, /^[A-Fa-f0-9]{64}$/);
    assert.deepEqual(receipt.writeFenceEvidenceOperationIds, [PRE_OPERATION_ID]);
    assert.equal(receipt.writeFenceEvidenceControlCount, 3);
    assert.equal(typeof receipt.writeFenceEvidenceVerifiedAt, "string");
    assert.equal(receipt.supabaseCliVersion, CLI_VERSION);
    assert.equal(receipt.supabaseCliBinarySha256, CLI_BINARY_SHA);
    assert.deepEqual(receipt.preApplyCheckIds, ["test-pre-apply"]);
    assert.equal(receipt.preApplyCheckCount, 1);
    assert.deepEqual(receipt.preApplyCheckEvidence, [
      {
        id: "test-pre-apply",
        evidence: { exact_policy_count: 4, staging_object_count: 0 },
      },
    ]);
    assert.deepEqual(receipt.postApplyCheckIds, ["test-post-apply"]);
    assert.equal(receipt.postApplyCheckCount, 1);
    assert.deepEqual(receipt.postApplyCheckEvidence, [
      {
        id: "test-post-apply",
        evidence: { remaining_pending_count: 0 },
      },
    ]);
    assert.match(receipt.preRemoteLedgerSha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.postRemoteLedgerSha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.containsSecrets, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("an unknown stale legacy receipt temp file neither blocks nor gets deleted", async () => {
  const fixture = await createFixture();
  const staleTemporary = `${fixture.outcomeReceiptPath}.tmp`;
  try {
    await writeFile(staleTemporary, "unknown-stale-owner\n", "utf8");
    const result = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
    });

    assert.equal(result.status, "database_expand_verified_lease_held");
    assert.equal(await readFile(staleTemporary, "utf8"), "unknown-stale-owner\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("a post-push platform operation creates an awaiting checkpoint and resumes without another push", async () => {
  const fixture = await createFixture({ withPostPushOperation: true });
  const applyCalls = [];
  const resumeCalls = [];
  const lockPath = join(fixture.root, "supabase/.temp/amora-production-release.lock");
  try {
    const awaiting = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture, {
        onCall: (command, args) => applyCalls.push([command, ...args]),
      }),
    });

    assert.equal(awaiting.status, "awaiting_manual_post_push_operations");
    assert.deepEqual(awaiting.verifiedManualOperationIds, [PRE_OPERATION_ID]);
    assert.deepEqual(awaiting.pendingManualOperationIds, ["fixture-post-push-platform-apply"]);
    assert.equal(awaiting.postPendingCount, 0);
    assert.match(awaiting.postRemoteLedgerSha256, /^[a-f0-9]{64}$/);
    assert.equal(applyCalls.filter((call) => call.includes("--yes")).length, 1);
    const applyQueryFiles = applyCalls
      .filter((call) => call[1] === "db" && call[2] === "query")
      .map(queryFileFromCall)
      .filter(Boolean);
    assert.equal(applyQueryFiles.some((file) => file.endsWith("test-post-push.sql")), false);
    assert.equal(applyQueryFiles.some((file) => file.endsWith("test-post-apply.sql")), false);
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).rerunProhibitedUntilAdjudicated, true);

    await writePostPushEvidence(fixture);
    const final = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--resume-post-push",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=RESUME:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture, {
        databaseAlreadyPushed: true,
        onCall: (command, args) => resumeCalls.push([command, ...args]),
      }),
    });

    assert.equal(final.status, "database_expand_verified_lease_held");
    assert.equal(final.remoteReleaseLeasePhase, "deployment-canary");
    assert.deepEqual(final.verifiedManualOperationIds, [
      PRE_OPERATION_ID,
      "fixture-post-push-platform-apply",
    ]);
    assert.deepEqual(final.pendingManualOperationIds, []);
    assert.deepEqual(final.postPushCheckIds, ["test-post-push"]);
    assert.deepEqual(final.postApplyCheckIds, ["test-post-apply"]);
    assert.deepEqual(final.postPushEvidenceOperationIds, ["fixture-post-push-platform-apply"]);
    assert.match(final.postPushEvidenceSha256, /^[A-F0-9]{64}$/);
    assert.equal(resumeCalls.some((call) => call.includes("--yes")), false);
    const resumeQueryFiles = resumeCalls
      .filter((call) => call[1] === "db" && call[2] === "query")
      .map(queryFileFromCall)
      .filter(Boolean);
    assert.deepEqual(resumeQueryFiles
      .map((file) => file.split(/[\\/]/).at(-1)), [
      "test-post-push.sql",
      "20260717141000_ai_log_retention_exact_acl_verify.sql",
      "test-post-apply.sql",
    ]);
    assert.equal(
      JSON.parse(await readFile(lockPath, "utf8")).remoteReleaseLeaseOwnerId,
      final.remoteReleaseLeaseOwnerId,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("resume recovers the exact owner after a crash between the remote deploying transition and final receipt", async () => {
  const fixture = await createFixture({ withPostPushOperation: true });
  const resumeCalls = [];
  try {
    const awaiting = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
    });
    assert.equal(awaiting.status, "awaiting_manual_post_push_operations");

    await writePostPushEvidence(fixture);
    const final = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--resume-post-push",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=RESUME:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture, {
        databaseAlreadyPushed: true,
        leaseResults: { verify_awaiting: 0, verify_deploying: 1 },
        onCall: (command, args) => resumeCalls.push([command, ...args]),
      }),
    });

    assert.equal(final.status, "database_expand_verified_lease_held");
    assert.equal(final.remoteReleaseLeasePhase, "deployment-canary");
    assert.equal(final.remoteReleaseLeaseRecoveredFromDeployingPhase, true);
    const leaseActions = resumeCalls
      .filter((call) => call[1] === "db" && call[2] === "query")
      .map(remoteLeaseActionFromCall)
      .filter(Boolean);
    assert.equal(
      leaseActions.includes("mark_deploying_from_awaiting"),
      false,
    );
    assert.equal(
      leaseActions.filter((action) => action === "verify_deploying").length,
      2,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("a foreign remote singleton lease blocks before dry-run or push and removes only the new local lock", async () => {
  const fixture = await createFixture();
  const calls = [];
  const lockPath = join(fixture.root, "supabase/.temp/amora-production-release.lock");
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          leaseResults: { claim: 0 },
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "REMOTE_RELEASE_LEASE_HELD",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    assert.equal(calls.some((call) =>
      call[1] === "db" && call[2] === "push" && call.includes("--dry-run")), false);
    await assert.rejects(readFile(lockPath, "utf8"), (error) => error.code === "ENOENT");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("an ambiguous remote claim response retains the local owner identity and never auto-releases", async () => {
  const fixture = await createFixture();
  const calls = [];
  const lockPath = join(fixture.root, "supabase/.temp/amora-production-release.lock");
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          leaseResults: {
            claim: { status: 1, stdout: "", stderr: "response lost" },
          },
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "REMOTE_RELEASE_LEASE_QUERY_FAILED",
    );
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(lock.version, 2);
    assert.match(lock.remoteReleaseLeaseOwnerId, /^[a-f0-9-]{36}$/);
    const leaseActions = calls
      .filter((call) => call[1] === "db" && call[2] === "query")
      .map(remoteLeaseActionFromCall)
      .filter(Boolean);
    assert.equal(leaseActions.includes("release"), false);
    assert.equal(calls.some((call) => call.includes("--yes")), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("a deterministic pre-push failure releases only this controller's lease and clears its local lock", async () => {
  const fixture = await createFixture();
  const calls = [];
  const lockPath = join(fixture.root, "supabase/.temp/amora-production-release.lock");
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          preDryRun: "DRY RUN: migrations will not be pushed\n ??20260716090000_a.sql\n",
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "PRE_PUSH_PENDING_MISMATCH",
    );
    const leaseActions = calls
      .filter((call) => call[1] === "db" && call[2] === "query")
      .map(remoteLeaseActionFromCall)
      .filter(Boolean);
    assert.equal(leaseActions.includes("claim"), true);
    assert.equal(leaseActions.includes("verify_claimed"), true);
    assert.equal(leaseActions.includes("release"), true);
    assert.equal(leaseActions.includes("verify_empty"), true);
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    await assert.rejects(readFile(lockPath, "utf8"), (error) => error.code === "ENOENT");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("resume remains possible after 30 minutes using immutable pre-push proof and fresh live fence evidence", async () => {
  const fixture = await createFixture({ withPostPushOperation: true });
  const initialNow = new Date();
  const resumeNow = new Date(initialNow.getTime() + 31 * 60_000);
  const resumeCalls = [];
  try {
    await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
      now: () => initialNow,
    });
    await writePostPushEvidence(fixture, (receipt) => {
      receipt.verifiedAt = resumeNow.toISOString();
    });

    const final = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--resume-post-push",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=RESUME:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture, {
        databaseAlreadyPushed: true,
        onCall: (command, args) => resumeCalls.push([command, ...args]),
      }),
      now: () => resumeNow,
    });

    assert.equal(final.status, "database_expand_verified_lease_held");
    const verifierCall = resumeCalls.find((call) =>
      String(call[0]).toLowerCase().includes("powershell")
      || String(call[0]).toLowerCase().endsWith("pwsh"));
    assert.ok(verifierCall);
    assert.equal(
      verifierCall[verifierCall.indexOf("-MaximumAgeMinutes") + 1],
      "5256000",
    );
    assert.equal(resumeCalls.some((call) => call.includes("--yes")), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("resume fails closed when post-push evidence is missing and leaves checkpoint and lock byte-identical", async () => {
  const fixture = await createFixture({ withPostPushOperation: true });
  const lockPath = join(fixture.root, "supabase/.temp/amora-production-release.lock");
  try {
    await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
    });
    const outcomeBefore = await readFile(fixture.outcomeReceiptPath);
    const lockBefore = await readFile(lockPath);
    const resumeCalls = [];

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--resume-post-push",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=RESUME:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          databaseAlreadyPushed: true,
          onCall: (command, args) => resumeCalls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "POST_PUSH_EVIDENCE_INVALID",
    );

    assert.deepEqual(await readFile(fixture.outcomeReceiptPath), outcomeBefore);
    assert.deepEqual(await readFile(lockPath), lockBefore);
    assert.equal(resumeCalls.some((call) => call.includes("--yes")), false);
    await assert.rejects(
      readFile(`${lockPath}.resume`, "utf8"),
      (error) => error.code === "ENOENT",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("resume refuses remote ledger drift before post-push checks and preserves the fence checkpoint", async () => {
  const fixture = await createFixture({ withPostPushOperation: true });
  const lockPath = join(fixture.root, "supabase/.temp/amora-production-release.lock");
  try {
    await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
    });
    await writePostPushEvidence(fixture);
    const outcomeBefore = await readFile(fixture.outcomeReceiptPath);
    const lockBefore = await readFile(lockPath);
    const calls = [];

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--resume-post-push",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=RESUME:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          databaseAlreadyPushed: true,
          postLedger: "  20260715000000 | 20260715000000 | 2026-07-15\n  20260716090000 | 20260716090000 | 2026-07-16\n  20260716091000 | 20260716091000 | 2026-07-16\n  20260716100000 | 20260716100000 | 2026-07-16\n",
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "RESUME_LEDGER_DRIFT",
    );

    assert.deepEqual(await readFile(fixture.outcomeReceiptPath), outcomeBefore);
    assert.deepEqual(await readFile(lockPath), lockBefore);
    assert.equal(calls.some((call) =>
      call[1] === "db"
      && call[2] === "query"
      && remoteLeaseActionFromCall(call) === null), false);
    assert.equal(calls.some((call) => call.includes("--yes")), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("a failing post-push live check cannot rewrite the awaiting checkpoint or remove its lock", async () => {
  const fixture = await createFixture({ withPostPushOperation: true });
  const lockPath = join(fixture.root, "supabase/.temp/amora-production-release.lock");
  try {
    await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
    });
    await writePostPushEvidence(fixture);
    const outcomeBefore = await readFile(fixture.outcomeReceiptPath);
    const lockBefore = await readFile(lockPath);

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--resume-post-push",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=RESUME:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          databaseAlreadyPushed: true,
          queryResults: [{
            status: 0,
            stdout: '[{"verified":false,"exact_storage_policy_count":1}]\n',
            stderr: "",
          }],
        }),
      }),
      (error) => error.code === "POSTCONDITION_RESULT_INVALID",
    );

    assert.deepEqual(await readFile(fixture.outcomeReceiptPath), outcomeBefore);
    assert.deepEqual(await readFile(lockPath), lockBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("plain apply cannot rerun an awaiting release", async () => {
  const fixture = await createFixture({ withPostPushOperation: true });
  try {
    const applyArgs = [
      "--apply",
      `--expected-commit=${RELEASE_COMMIT}`,
      "--remote-ref=origin/release",
      `--backup-receipt=${fixture.backupReceiptPath}`,
      `--backup-source-repo=${fixture.backupSourceRepo}`,
      `--receipt-out=${fixture.outcomeReceiptPath}`,
      `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
    ];
    await runProductionRelease({
      repoRoot: fixture.root,
      argv: applyArgs,
      runCommand: successfulRunner(fixture),
    });
    const outcomeBefore = await readFile(fixture.outcomeReceiptPath);
    const calls = [];

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: applyArgs,
        runCommand: successfulRunner(fixture, {
          databaseAlreadyPushed: true,
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "RELEASE_LOCKED",
    );
    assert.deepEqual(await readFile(fixture.outcomeReceiptPath), outcomeBefore);
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    assert.equal(calls.some((call) => call[1] === "db"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("the current-baseline verifier must match the manifest-pinned hash", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    await writeFile(
      join(fixture.backupSourceRepo, "scripts/amora-db-current-baseline-verify.ps1"),
      "# tampered verifier\n",
      "utf8",
    );

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "BACKUP_VERIFIER_HASH_MISMATCH",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    assert.equal(calls.some((call) => call[1] === "db" && call[2] === "query"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("release and backup checkouts must both match the manifest-pinned origin", async () => {
  for (const mismatch of ["release", "backup"]) {
    const fixture = await createFixture();
    const calls = [];
    try {
      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            releaseOrigin: mismatch === "release" ? "https://github.com/attacker/repo.git" : EXPECTED_ORIGIN,
            backupOrigin: mismatch === "backup" ? "https://github.com/attacker/repo.git" : EXPECTED_ORIGIN,
            onCall: (command, args) => calls.push([command, ...args]),
          }),
        }),
        (error) => error.code === (mismatch === "release"
          ? "GIT_ORIGIN_MISMATCH"
          : "BACKUP_SOURCE_ORIGIN_MISMATCH"),
      );
      assert.equal(calls.some((call) => call.includes("--yes")), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("the current-baseline receipt and verifier checkout must bind to the release commit", async () => {
  for (const mismatch of ["receipt", "checkout"]) {
    const fixture = await createFixture();
    try {
      if (mismatch === "receipt") {
        const receipt = JSON.parse(await readFile(fixture.backupReceiptPath, "utf8"));
        receipt.GitCommit = "2".repeat(40);
        await writeFile(fixture.backupReceiptPath, JSON.stringify(receipt), "utf8");
      }

      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            backupHead: mismatch === "checkout" ? "2".repeat(40) : BACKUP_COMMIT,
          }),
        }),
        (error) => error.code === (mismatch === "receipt"
          ? "BACKUP_RECEIPT_INVALID"
          : "BACKUP_SOURCE_COMMIT_MISMATCH"),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("a verifier receipt for any shape other than the current 14-table baseline is rejected", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    const receipt = JSON.parse(await readFile(fixture.backupReceiptPath, "utf8"));
    receipt.TableCount = 11;
    await writeFile(fixture.backupReceiptPath, JSON.stringify(receipt), "utf8");

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "BACKUP_RECEIPT_INVALID",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("check-only verifies every pre-write gate without a local lock, outcome receipt or push", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    const result = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--check-only",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--confirm-production=CHECK:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture, {
        onCall: (command, args) => calls.push([command, ...args]),
      }),
    });

    assert.equal(result.status, "preflight_verified");
    assert.equal(result.backupContractId, "pre-amora-current-remote-14-table-baseline");
    assert.equal(result.backupExpectedTableCount, 14);
    assert.deepEqual(result.backupExcludedEphemeralTables, [
      "production_release_lease_20260717",
      "rate_limit_buckets",
    ]);
    assert.equal(
      result.backupEphemeralRebuildContract,
      "production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)",
    );
    assert.deepEqual(result.verifiedManualOperationIds, [PRE_OPERATION_ID]);
    assert.deepEqual(result.preApplyCheckIds, ["test-pre-apply"]);
    assert.deepEqual(result.preApplyCheckEvidence, [
      {
        id: "test-pre-apply",
        evidence: { exact_policy_count: 4, staging_object_count: 0 },
      },
    ]);
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    assert.equal(
      calls.some((call) => call[1] === "db" && call[2] === "push" && !call.includes("--dry-run")),
      false,
    );
    await assert.rejects(readFile(fixture.outcomeReceiptPath, "utf8"), /ENOENT/);
    await assert.rejects(
      readFile(join(fixture.root, "supabase/.temp/amora-production-release.lock"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("check-only never removes or rewrites an existing release lock", async () => {
  const fixture = await createFixture();
  const lockPath = join(fixture.root, "supabase/.temp/amora-production-release.lock");
  const existingLock = "unresolved-release-owned-by-another-operator\n";
  try {
    await writeFile(lockPath, existingLock, "utf8");

    const result = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--check-only",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--confirm-production=CHECK:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
    });

    assert.equal(result.status, "preflight_verified");
    assert.equal(await readFile(lockPath, "utf8"), existingLock);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("a remote pending set mismatch is blocked before any write starts", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          preDryRun: "DRY RUN\n • 20260716091000_b.sql\n • 20260716090000_a.sql\n",
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "PRE_PUSH_PENDING_MISMATCH",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    await assert.rejects(readFile(fixture.outcomeReceiptPath, "utf8"), /ENOENT/);
    await assert.rejects(
      readFile(join(fixture.root, "supabase/.temp/amora-production-release.lock"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("a remote ledger head mismatch is blocked before any write starts", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          preLedger: "  20260714000000 | 20260714000000 | 2026-07-14\n",
          postLedger: "",
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "PRE_PUSH_LEDGER_HEAD_MISMATCH",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    await assert.rejects(readFile(fixture.outcomeReceiptPath, "utf8"), /ENOENT/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("duplicate or contradictory pre-push ledger evidence is blocked before any write", async () => {
  const cases = [
    {
      code: "PRE_PUSH_LEDGER_DUPLICATE",
      preLedger: "  20260715000000 | 20260715000000 | 2026-07-15\n  20260715000000 | 20260715000000 | 2026-07-15\n",
    },
    {
      code: "PRE_PUSH_LEDGER_CONTRADICTION",
      preLedger: "  20260716090000 | 20260716090000 | 2026-07-16\n  20260715000000 | 20260715000000 | 2026-07-15\n",
    },
  ];
  for (const item of cases) {
    const fixture = await createFixture();
    const calls = [];
    try {
      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            preLedger: item.preLedger,
            onCall: (command, args) => calls.push([command, ...args]),
          }),
        }),
        (error) => error.code === item.code,
      );
      assert.equal(calls.some((call) => call.includes("--yes")), false);
      await assert.rejects(readFile(fixture.outcomeReceiptPath, "utf8"), /ENOENT/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("an exit-zero pre-apply query must return exactly one verified row", async () => {
  for (const stdout of [
    '[{"verified":false}]\n',
    '[{"verified":true},{"verified":true}]\n',
    'not-json\n',
    '{"warning":"untrusted","boundary":"abc","rows":[{"verified":true}]}\n',
    '[{"verified":true,"note":"unexpected"}]\n',
    '[{"verified":true,"mismatch_count":-1}]\n',
    '[{"verified":true,"mismatch_count":1000000001}]\n',
    '[{"verified":true,"mismatch_count":0.5}]\n',
    '[{"verified":true,"exact_policy_count":3,"staging_object_count":0}]\n',
    '[{"verified":true,"exact_policy_count":4,"staging_object_count":1}]\n',
    '[{"verified":true,"exact_policy_count":4}]\n',
    '[{"verified":true,"exact_policy_count":4,"staging_object_count":0,"extra_count":0}]\n',
  ]) {
    const fixture = await createFixture();
    const calls = [];
    try {
      await assert.rejects(
        runProductionRelease({
          repoRoot: fixture.root,
          argv: [
            "--apply",
            `--expected-commit=${RELEASE_COMMIT}`,
            "--remote-ref=origin/release",
            `--backup-receipt=${fixture.backupReceiptPath}`,
            `--backup-source-repo=${fixture.backupSourceRepo}`,
            `--receipt-out=${fixture.outcomeReceiptPath}`,
            `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
          ],
          runCommand: successfulRunner(fixture, {
            queryResult: { status: 0, stdout, stderr: "" },
            onCall: (command, args) => calls.push([command, ...args]),
          }),
        }),
        (error) => error.code === "PRECONDITION_RESULT_INVALID",
      );
      assert.equal(calls.some((call) => call.includes("--yes")), false);
      await assert.rejects(readFile(fixture.outcomeReceiptPath, "utf8"), /ENOENT/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(fixture.receiptRoot, { recursive: true, force: true });
    }
  }
});

test("an exit-zero post-apply query with an unverified result retains the do-not-rerun state", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          queryResults: [
            {
              status: 0,
              stdout: '[{"verified":true,"exact_policy_count":4,"staging_object_count":0}]\n',
              stderr: "",
            },
            {
              status: 0,
              stdout: '[{"verified":false,"remaining_pending_count":1}]\n',
              stderr: "",
            },
          ],
        }),
      }),
      (error) => error.code === "POSTCONDITION_RESULT_INVALID",
    );

    const receipt = JSON.parse(await readFile(fixture.outcomeReceiptPath, "utf8"));
    assert.equal(receipt.status, "ambiguous_postverification_failure");
    assert.equal(receipt.rerunProhibited, true);
    assert.match(receipt.operatorAction, /DO_NOT_RERUN/);
    const lock = await readFile(
      join(fixture.root, "supabase/.temp/amora-production-release.lock"),
      "utf8",
    );
    assert.match(lock, /rerunProhibitedUntilAdjudicated/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("an uncertain push outcome creates a do-not-rerun receipt and retains the release lock", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          pushResult: { status: null, signal: "SIGTERM", stdout: "", stderr: "secret-like-output" },
        }),
      }),
      (error) => error.code === "PUSH_OUTCOME_AMBIGUOUS" && !error.message.includes("secret-like-output"),
    );

    const receipt = JSON.parse(await readFile(fixture.outcomeReceiptPath, "utf8"));
    assert.equal(receipt.status, "ambiguous_push_outcome");
    assert.equal(receipt.rerunProhibited, true);
    assert.match(receipt.operatorAction, /DO_NOT_RERUN/);
    assert.doesNotMatch(JSON.stringify(receipt), /secret-like-output/);
    const lock = JSON.parse(
      await readFile(join(fixture.root, "supabase/.temp/amora-production-release.lock"), "utf8"),
    );
    assert.equal(lock.rerunProhibitedUntilAdjudicated, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("a linked project ref rewrite during push is treated as an ambiguous write outcome", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: async (command, args) => {
            if (args[0] === "db" && args[1] === "push" && args.includes("--yes")) {
              await writeFile(
                join(fixture.root, "supabase/.temp/project-ref"),
                "zzzzzzzzzzzzzzzzzzzz\n",
                "utf8",
              );
            }
          },
        }),
      }),
      (error) => error.code === "LINKED_REF_CHANGED",
    );
    const receipt = JSON.parse(await readFile(fixture.outcomeReceiptPath, "utf8"));
    assert.equal(receipt.status, "ambiguous_postverification_failure");
    assert.equal(receipt.rerunProhibited, true);
    assert.match(receipt.operatorAction, /DO_NOT_RERUN/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("manifest-pinned postconditions execute only as read-only SQL after the ledger is clean", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    const sql = "BEGIN TRANSACTION READ ONLY;\nselect true as verified;\nCOMMIT;\n";
    const manifestPath = join(
      fixture.root,
      "supabase/release-manifests/amora-engine-v2-20260716.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.postApplyChecks = [
      {
        id: "test-release-postcondition",
        type: "read-only-sql",
        file: "supabase/release-checks/test-release.sql",
        sha256: sha256(sql),
        expectedEvidence: { remaining_pending_count: 0 },
      },
    ];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await write(fixture.root, "supabase/release-checks/test-release.sql", sql);

    const result = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture, {
        onCall: (command, args) => calls.push([command, ...args]),
      }),
    });

    assert.equal(result.postconditionsPassed, 1);
    const queries = calls.filter((call) =>
      call[1] === "db"
      && call[2] === "query"
      && remoteLeaseActionFromCall(call) === null);
    assert.equal(queries.length, 3);
    assert.deepEqual(queries[0].slice(1), [
      "db",
      "query",
      "--linked",
      "--file",
      join(fixture.root, "supabase/release-checks/test-pre-apply.sql"),
      "--output",
      "json",
      "--agent",
      "no",
      "--workdir",
      fixture.root,
    ]);
    assert.deepEqual(queries[1].slice(1), [
      "db",
      "query",
      "--linked",
      "--file",
      join(
        fixture.root,
        "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
      ),
      "--output",
      "json",
      "--agent",
      "no",
      "--workdir",
      fixture.root,
    ]);
    assert.deepEqual(queries[2].slice(1), [
      "db",
      "query",
      "--linked",
      "--file",
      join(fixture.root, "supabase/release-checks/test-release.sql"),
      "--output",
      "json",
      "--agent",
      "no",
      "--workdir",
      fixture.root,
    ]);
    assert.equal(queries.some((query) =>
      query.some((value) => /password|db-url|include-all/i.test(value))), false);
    const ledgerIndexes = calls
      .map((call, index) => [call, index])
      .filter(([call]) => call[1] === "migration" && call[2] === "list")
      .map(([, index]) => index);
    assert.equal(ledgerIndexes.length, 2);
    assert.ok(calls.indexOf(queries[0]) < ledgerIndexes[1]);
    assert.ok(calls.indexOf(queries[1]) < ledgerIndexes[1]);
    assert.ok(calls.indexOf(queries[2]) > ledgerIndexes[1]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("the CLI rejects unknown secret-like input without echoing its value", () => {
  const script = fileURLToPath(new URL("../supabase-production-release.mjs", import.meta.url));
  const secret = "never-print-this-secret";
  const result = spawnSync(process.execPath, [script, `--password=${secret}`], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ARGUMENT_UNKNOWN/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

test("include-all, migration repair and reset can never enter the controller", () => {
  const script = fileURLToPath(new URL("../supabase-production-release.mjs", import.meta.url));
  for (const argument of ["--include-all", "--repair=applied", "--reset=remote"]) {
    const result = spawnSync(process.execPath, [script, argument], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FORBIDDEN_OPERATION/);
  }
});

test("Git, Node and Supabase binary execution overrides are refused before filesystem gates", () => {
  const script = fileURLToPath(new URL("../supabase-production-release.mjs", import.meta.url));
  const args = [
    "--apply",
    `--expected-commit=${RELEASE_COMMIT}`,
    "--remote-ref=origin/release",
    "--backup-receipt=C:\\private\\receipt.json",
    "--backup-source-repo=C:\\private\\backup-source",
    "--receipt-out=C:\\private\\outcome.json",
    `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
  ];
  for (const [name, value] of [
    ["GIT_DIR", "C:\\attacker"],
    ["NODE_OPTIONS", "--no-warnings"],
    ["SUPABASE_CLI_BINARY_OVERRIDE", "C:\\attacker.exe"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, [name]: value },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EXECUTION_ENVIRONMENT_UNSAFE/);
    assert.doesNotMatch(result.stderr, /attacker/);
  }
});

test("a malformed postcondition is rejected before the production push starts", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    const sql = "update public.profiles set updated_at = now();\n";
    const manifestPath = join(
      fixture.root,
      "supabase/release-manifests/amora-engine-v2-20260716.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.postApplyChecks = [
      {
        id: "mutating-postcondition",
        type: "read-only-sql",
        file: "supabase/release-checks/mutating.sql",
        sha256: sha256(sql),
        expectedEvidence: { remaining_pending_count: 0 },
      },
    ];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await write(fixture.root, "supabase/release-checks/mutating.sql", sql);

    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "POSTCONDITION_NOT_READ_ONLY",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    await assert.rejects(readFile(fixture.outcomeReceiptPath, "utf8"), /ENOENT/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("truncated Supabase output can never be accepted as an exact pending set", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          dryRunTruncated: true,
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "PRE_PUSH_DRY_RUN_FAILED",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("migration-looking text without a Supabase dry-run marker is not trusted", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          preDryRun: "20260716090000_a.sql\n20260716091000_b.sql\n",
        }),
      }),
      (error) => error.code === "PRE_PUSH_DRY_RUN_UNRECOGNIZED",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("an unexpected concurrent ledger addition after push is never accepted", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          postLedger:
            "  20260716090000 | 20260716090000 | 2026-07-16\n" +
            "  20260716091000 | 20260716091000 | 2026-07-16\n" +
            "  20260716091500 | 20260716091500 | 2026-07-16\n",
        }),
      }),
      (error) => error.code === "POST_PUSH_LEDGER_DELTA_MISMATCH",
    );
    const receipt = JSON.parse(await readFile(fixture.outcomeReceiptPath, "utf8"));
    assert.equal(receipt.status, "ambiguous_postverification_failure");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("the production CLI binary must match the freshly verified backup provenance", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    await writeFile(
      join(
        fixture.root,
        `node_modules/@supabase/${platformCliPackage()}/bin/supabase${process.platform === "win32" ? ".exe" : ""}`,
      ),
      "tampered-binary\n",
      "utf8",
    );
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "SUPABASE_CLI_PROVENANCE_MISMATCH",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("the pinned CLI is discovered through pnpm's real wrapper dependency tree", async () => {
  const fixture = await createFixture();
  try {
    const wrapperSource = join(fixture.root, "node_modules/supabase");
    const wrapperReal = join(
      fixture.root,
      `node_modules/.pnpm/supabase@${CLI_VERSION}/node_modules/supabase`,
    );
    await mkdir(dirname(wrapperReal), { recursive: true });
    await rename(wrapperSource, wrapperReal);
    await symlink(wrapperReal, wrapperSource, process.platform === "win32" ? "junction" : "dir");

    const packageName = platformCliPackage();
    const nativeSource = join(fixture.root, `node_modules/@supabase/${packageName}`);
    const nativeReal = join(
      fixture.root,
      `node_modules/.pnpm/@supabase+${packageName}@${CLI_VERSION}/node_modules/@supabase/${packageName}`,
    );
    await mkdir(dirname(nativeReal), { recursive: true });
    await rename(nativeSource, nativeReal);
    const nestedNative = join(dirname(wrapperReal), `@supabase/${packageName}`);
    await mkdir(dirname(nestedNative), { recursive: true });
    await symlink(nativeReal, nestedNative, process.platform === "win32" ? "junction" : "dir");

    const result = await runProductionRelease({
      repoRoot: fixture.root,
      argv: [
        "--apply",
        `--expected-commit=${RELEASE_COMMIT}`,
        "--remote-ref=origin/release",
        `--backup-receipt=${fixture.backupReceiptPath}`,
        `--backup-source-repo=${fixture.backupSourceRepo}`,
        `--receipt-out=${fixture.outcomeReceiptPath}`,
        `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
      ],
      runCommand: successfulRunner(fixture),
    });
    assert.equal(result.status, "database_expand_verified_lease_held");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});

test("a backup receipt containing a secret-like field is rejected and never copied", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    const receipt = JSON.parse(await readFile(fixture.backupReceiptPath, "utf8"));
    receipt.OPENAI_API_KEY = "must-not-enter-release-receipts";
    await writeFile(fixture.backupReceiptPath, JSON.stringify(receipt), "utf8");
    await assert.rejects(
      runProductionRelease({
        repoRoot: fixture.root,
        argv: [
          "--apply",
          `--expected-commit=${RELEASE_COMMIT}`,
          "--remote-ref=origin/release",
          `--backup-receipt=${fixture.backupReceiptPath}`,
          `--backup-source-repo=${fixture.backupSourceRepo}`,
          `--receipt-out=${fixture.outcomeReceiptPath}`,
          `--confirm-production=APPLY:${PROJECT_REF}:test-release:${RELEASE_COMMIT}`,
        ],
        runCommand: successfulRunner(fixture, {
          onCall: (command, args) => calls.push([command, ...args]),
        }),
      }),
      (error) => error.code === "BACKUP_RECEIPT_SECRET_FIELD",
    );
    assert.equal(calls.some((call) => call.includes("--yes")), false);
    await assert.rejects(readFile(fixture.outcomeReceiptPath, "utf8"), /ENOENT/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.receiptRoot, { recursive: true, force: true });
  }
});
