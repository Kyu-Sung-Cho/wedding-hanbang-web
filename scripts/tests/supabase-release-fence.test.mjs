import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");
const fenceSource = join(repoRoot, "scripts", "supabase-release-fence.mjs");
const extendedContractsSource = join(
  repoRoot,
  "scripts/lib/amora-release-extended-contracts.mjs",
);
const readOnlyEnvelopeSource = join(
  repoRoot,
  "scripts/lib/sql-read-only-envelope.mjs",
);
const successorContractSource = join(
  repoRoot,
  "scripts/lib/supabase-successor-release-contract.mjs",
);
const successorRemoteBaselineSource = join(
  repoRoot,
  "scripts/lib/supabase-successor-remote-baseline.mjs",
);

function sha256(content) {
  return createHash("sha256").update(content.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

async function write(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "hanbang-release-fence-"));
  await mkdir(join(root, "scripts"), { recursive: true });
  await cp(fenceSource, join(root, "scripts", "supabase-release-fence.mjs"));
  await mkdir(join(root, "scripts/lib"), { recursive: true });
  await cp(
    extendedContractsSource,
    join(root, "scripts/lib/amora-release-extended-contracts.mjs"),
  );
  await cp(
    readOnlyEnvelopeSource,
    join(root, "scripts/lib/sql-read-only-envelope.mjs"),
  );
  await cp(
    successorContractSource,
    join(root, "scripts/lib/supabase-successor-release-contract.mjs"),
  );
  await cp(
    successorRemoteBaselineSource,
    join(root, "scripts/lib/supabase-successor-remote-baseline.mjs"),
  );

  const historicalAudit = "select 'verified';\n";
  const previousMigration = "select 'previous';\n";
  const currentMigration = "select 'current';\n";
  const currentDocument = "# Current release\n";
  const preApplyCheck = `-- fixture checks may start with comments
BEGIN TRANSACTION READ ONLY;
DO $check$
BEGIN
  IF false THEN
    RAISE EXCEPTION 'ROLLBACK is not top-level here';
  END IF;
END
$check$;
select true as verified;
ROLLBACK;
`;
  const postPushCheck = "BEGIN TRANSACTION READ ONLY;\nselect true as verified;\nROLLBACK;\n";
  const postApplyCheck = "BEGIN TRANSACTION READ ONLY;\nselect true as verified;\nROLLBACK;\n";
  const platformApply = "select 'platform apply';\n";
  const postPushPlatformApply = "select 'post-push platform apply';\n";
  const platformRollback = "select 'platform rollback';\n";
  const postPushPlatformRollback = "select 'post-push platform rollback';\n";
  const baselineVerifier = "# fixture baseline verifier\n";
  const forwardInventory = "BEGIN TRANSACTION READ ONLY;\nselect 1 as ai_log_retention_exact_acl_verified;\nROLLBACK;\n";
  const forwardApply = "BEGIN;\nselect 'forward apply';\nCOMMIT;\n";
  const forwardVerify = "BEGIN TRANSACTION READ ONLY;\nselect 1 as ai_log_retention_exact_acl_verified;\nROLLBACK;\n";
  const finalizer = "BEGIN;\nselect 'finalizer';\nCOMMIT;\n";
  const postExpandCapture = "# fixture post-expand capture\n";
  const postExpandVerifier = "# fixture post-expand verifier\n";
  const previousManifest = {
    release: "previous",
    projectRef: "test-project",
    migrationFloor: "20260714000000",
    historicalReconciliation: [
      { file: "20260714000000_previous.sql", sha256: sha256(previousMigration) },
    ],
    expandMigrations: [],
    appliedHotfixes: [],
    historicalEffectAudit: {
      file: "supabase/contract-migrations/historical.sql",
      sha256: sha256(historicalAudit),
    },
    manualPlatformOperations: [],
    requiredDocuments: [],
  };
  const currentManifest = {
    release: "current",
    projectRef: "test-project",
    predecessorManifest: {
      file: "supabase/release-manifests/amora-openai-20260714.json",
      sha256: sha256(`${JSON.stringify(previousManifest, null, 2)}\n`),
    },
    requiredRemoteHead: "20260715000000",
    migrationFloor: "20260716000000",
    historicalReconciliation: [],
    expandMigrations: [
      { file: "20260716000000_current.sql", sha256: sha256(currentMigration) },
    ],
    appliedHotfixes: [],
    historicalEffectAudit: {
      file: "supabase/contract-migrations/historical.sql",
      sha256: sha256(historicalAudit),
    },
    preApplyChecks: [
      {
        id: "fixture-pre-apply",
        type: "read-only-sql",
        file: "supabase/release-checks/fixture-pre.sql",
        sha256: sha256(preApplyCheck),
        expectedEvidence: {
          exact_policy_count: 4,
          staging_object_count: 0,
        },
      },
    ],
    postPushChecks: [
      {
        id: "fixture-post-push",
        type: "read-only-sql",
        file: "supabase/release-checks/fixture-post-push.sql",
        sha256: sha256(postPushCheck),
        expectedEvidence: {
          exact_storage_policy_count: 1,
        },
      },
    ],
    postApplyChecks: [
      {
        id: "fixture-post-apply",
        type: "read-only-sql",
        file: "supabase/release-checks/fixture-post.sql",
        sha256: sha256(postApplyCheck),
        expectedEvidence: {
          remaining_pending_count: 0,
        },
      },
    ],
    forwardOnlySecurityOperations: [{
      id: "ai-log-retention-exact-acl-20260717141000",
      phase: "pre-backup",
      verificationCheckId: "fixture-pre-apply",
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
        sha256: sha256(forwardInventory),
      },
      apply: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
        sha256: sha256(forwardApply),
      },
      verify: {
        file: "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
        sha256: sha256(forwardVerify),
        expectedEvidence: { ai_log_retention_exact_acl_verified: 1 },
      },
    }],
    postExpandBackupContract: {
      id: "post-amora-engine-v2-27-table-backup",
      version: 1,
      phase: "post-push-pre-deployment-canary",
      verificationReceiptFileName:
        "current-post-expand-backup-verification.json",
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
        receiptFileName: "current-post-expand-hosted-restore-evidence.json",
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
        sha256: sha256(finalizer),
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
        id: "fixture-platform-apply",
        phase: "pre-backup",
        verificationCheckId: "fixture-pre-apply",
        file: "supabase/platform-operations/security/fixture-apply.sql",
        sha256: sha256(platformApply),
      },
      {
        id: "fixture-post-push-platform-apply",
        phase: "post-push-pre-deploy",
        verificationCheckId: "fixture-post-push",
        file: "supabase/platform-operations/storage/fixture-post-push-apply.sql",
        sha256: sha256(postPushPlatformApply),
      },
    ],
    rollbackArtifacts: [
      {
        id: "fixture-platform-rollback",
        forOperationId: "fixture-platform-apply",
        file: "supabase/platform-operations/security/fixture_rollback.sql",
        sha256: sha256(platformRollback),
      },
      {
        id: "fixture-post-push-platform-rollback",
        forOperationId: "fixture-post-push-platform-apply",
        file: "supabase/platform-operations/storage/fixture-post-push_rollback.sql",
        sha256: sha256(postPushPlatformRollback),
      },
    ],
    manualControlEvidence: {
      receiptFileName: "fixture-production-write-fence.json",
      postPushReceiptFileName: "fixture-post-push-platform.json",
      storageDrainReceiptFileName: "fixture-storage-signed-upload-drain.json",
      maximumAgeMinutes: 30,
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
    },
    requiredDocuments: [
      { file: "docs/current.md", sha256: sha256(currentDocument) },
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
      expectedOrigin: "https://github.com/example/wedding.git",
      verifier: {
        file: "scripts/amora-db-current-baseline-verify.ps1",
        sha256: sha256(baselineVerifier),
      },
      providerPhysicalBackup: {
        maximumAgeHours: 26,
        requiredStatus: "COMPLETED",
        requirePhysicalBackup: true,
        restoreCapability: "completed-physical-backup",
      },
      hostedRestoreEvidence: {
        receiptFileName: "current-hosted-restore-evidence.json",
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
        version: "2.106.0",
        binarySha256: "A".repeat(64),
      },
    },
  };

  await write(root, "supabase/release-manifests/amora-openai-20260714.json", `${JSON.stringify(previousManifest, null, 2)}\n`);
  await write(root, "supabase/release-manifests/amora-engine-v2-20260716.json", `${JSON.stringify(currentManifest, null, 2)}\n`);
  await write(root, "supabase/migrations/20260714000000_previous.sql", previousMigration);
  await write(root, "supabase/migrations/20260716000000_current.sql", currentMigration);
  await write(root, "supabase/contract-migrations/historical.sql", historicalAudit);
  await write(root, "supabase/release-checks/fixture-pre.sql", preApplyCheck);
  await write(root, "supabase/release-checks/fixture-post-push.sql", postPushCheck);
  await write(root, "supabase/release-checks/fixture-post.sql", postApplyCheck);
  await write(root, "supabase/platform-operations/security/fixture-apply.sql", platformApply);
  await write(root, "supabase/platform-operations/security/fixture_rollback.sql", platformRollback);
  await write(
    root,
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_inventory.sql",
    forwardInventory,
  );
  await write(
    root,
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
    forwardApply,
  );
  await write(
    root,
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
    forwardVerify,
  );
  await write(
    root,
    "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql",
    finalizer,
  );
  await write(root, "supabase/platform-operations/storage/fixture-post-push-apply.sql", postPushPlatformApply);
  await write(root, "supabase/platform-operations/storage/fixture-post-push_rollback.sql", postPushPlatformRollback);
  await write(root, "scripts/amora-db-current-baseline-verify.ps1", baselineVerifier);
  await write(root, "scripts/amora-db-backup.ps1", postExpandCapture);
  await write(root, "scripts/amora-db-verify-backup.ps1", postExpandVerifier);
  await write(root, "docs/current.md", currentDocument);
  await write(root, "supabase/.temp/project-ref", "test-project\n");
  await write(
    root,
    "node_modules/supabase/dist/supabase.js",
    "console.log('DRY RUN: migrations will not be pushed\\n • 20260716000000_current.sql');\n",
  );
  return root;
}

function runFence(root, args = []) {
  return spawnSync(process.execPath, [join(root, "scripts", "supabase-release-fence.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

async function addSuccessorRelease(root, {
  status = "deployment_blocked",
} = {}) {
  const predecessorFile = "supabase/release-manifests/amora-engine-v2-20260716.json";
  const predecessorText = await readFile(join(root, predecessorFile), "utf8");
  const migrationFile = "20260718120000_vendor_disclosure_foundation.sql";
  const migrationSql = "select 'vendor disclosure successor';\n";
  const successorManifest = {
    release: "vendor-disclosure-v2-20260718",
    projectRef: "test-project",
    status,
    predecessorManifest: {
      file: predecessorFile,
      sha256: sha256(predecessorText),
    },
    requiredRemoteHead: "20260716000000",
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
  const successorBaseline = attachSuccessorRemoteBaselineFixture(successorManifest);
  await write(
    root,
    "supabase/release-manifests/vendor-disclosure-v2-20260718.json",
    `${JSON.stringify(successorBaseline.manifest, null, 2)}\n`,
  );
  await write(
    root,
    SUCCESSOR_REMOTE_BASELINE_FIXTURE_PATH,
    successorBaseline.contractText,
  );
  await write(root, `supabase/migrations/${migrationFile}`, migrationSql);
  return successorBaseline.manifest;
}

function runtimeEvidenceContracts(release) {
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

async function addControllerReadySuccessorRelease(root) {
  const successor = await addSuccessorRelease(root);
  const predecessor = JSON.parse(await readFile(
    join(root, "supabase/release-manifests/amora-engine-v2-20260716.json"),
    "utf8",
  ));
  const versions = successor.expandMigrations.map((entry) => entry.file.slice(0, 14));
  const baselineTables = predecessor.postExpandBackupContract.expectedTables;
  const postExpandTables = [...baselineTables, "vendor_alias_proposals"].sort();
  const listHash = (values) => sha256(`${values.join("\n")}\n`);
  const postCheckSql = `BEGIN TRANSACTION READ ONLY;
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
  const capture = "# successor capture\n";
  const verifier = "# successor verifier\n";
  const contract = {
    contractVersion: 1,
    release: successor.release,
    projectRef: successor.projectRef,
    historicalEffectAudit: predecessor.historicalEffectAudit,
    preApplyChecks: predecessor.preApplyChecks,
    postPushChecks: predecessor.postPushChecks,
    postApplyChecks: [{
      id: "vendor-disclosure-successor-postcheck",
      type: "read-only-sql",
      file: "supabase/release-checks/vendor-disclosure-successor-post.sql",
      sha256: sha256(postCheckSql),
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
      ...predecessor.manualControlEvidence,
      receiptFileName: `${successor.release}-production-write-fence.json`,
      storageDrainReceiptFileName: `${successor.release}-storage-drain.json`,
      postPushReceiptFileName: `${successor.release}-post-push.json`,
    },
    backupContract: {
      id: `pre-${successor.release}-current-remote-backup`,
      version: 2,
      format: "hbam2-encrypted-current-user",
      expectedTableCount: baselineTables.length,
      expectedTables: baselineTables,
      expectedTableContractSha256: listHash(baselineTables),
      expectedMigrationHead: successor.requiredRemoteHead,
      excludedEphemeralTables: predecessor.backupContract.excludedEphemeralTables,
      ephemeralRebuildContract: predecessor.backupContract.ephemeralRebuildContract,
      expectedCommitBinding: "release-expected-commit",
      expectedOrigin: predecessor.backupContract.expectedOrigin,
      verifier: predecessor.postExpandBackupContract.verifier,
      providerPhysicalBackup: predecessor.backupContract.providerPhysicalBackup,
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
      expectedReleaseMigrationHead: versions.at(-1),
      expectedReleaseMigrationVersions: versions,
      expectedTableContractSha256: listHash(postExpandTables),
      expectedReleaseMigrationContractSha256: listHash(versions),
      capture: {
        file: "scripts/vendor-disclosure-db-backup.ps1",
        sha256: sha256(capture),
      },
      verifier: {
        file: "scripts/vendor-disclosure-db-verify-backup.ps1",
        sha256: sha256(verifier),
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
    rollbackContract: {
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
    },
    requiredDocuments: predecessor.requiredDocuments,
  };
  const contractFile =
    "supabase/release-contracts/vendor-disclosure-production-controller-v1.json";
  const contractText = `${JSON.stringify(contract, null, 2)}\n`;
  await write(root, contractFile, contractText);
  await write(
    root,
    "supabase/release-checks/vendor-disclosure-successor-post.sql",
    postCheckSql,
  );
  await write(root, "scripts/vendor-disclosure-db-backup.ps1", capture);
  await write(root, "scripts/vendor-disclosure-db-verify-backup.ps1", verifier);
  successor.status = "controller_ready";
  successor.deploymentEvidence = runtimeEvidenceContracts(successor.release);
  successor.controllerContract = {
    file: contractFile,
    sha256: sha256(contractText),
  };
  await write(
    root,
    "supabase/release-manifests/vendor-disclosure-v2-20260718.json",
    `${JSON.stringify(successor, null, 2)}\n`,
  );
  await write(
    root,
    "node_modules/supabase/dist/supabase.js",
    `console.log('DRY RUN: migrations will not be pushed\\n • ${successor.expandMigrations[0].file}');\n`,
  );
  return successor;
}

test("deployment-blocked successor release statically verifies its predecessor and exact migration chain", async () => {
  const root = await createFixture();
  try {
    await addSuccessorRelease(root);
    const result = runFence(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /vendor-disclosure-v2-20260718/);
    assert.match(result.stdout, /deployment_blocked/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successor release rejects any drift in its pinned predecessor manifest", async () => {
  const root = await createFixture();
  try {
    await addSuccessorRelease(root);
    const predecessorPath = join(
      root,
      "supabase/release-manifests/amora-engine-v2-20260716.json",
    );
    const predecessor = JSON.parse(await readFile(predecessorPath, "utf8"));
    predecessor.requiredDocuments = [];
    await writeFile(predecessorPath, `${JSON.stringify(predecessor, null, 2)}\n`, "utf8");

    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /predecessor release manifest hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successor release rejects hash drift in every release-era migration", async () => {
  const root = await createFixture();
  try {
    const successor = await addSuccessorRelease(root);
    await write(
      root,
      `supabase/migrations/${successor.expandMigrations[0].file}`,
      "select 'tampered successor migration';\n",
    );

    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /successor migration hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successor release rejects an unmanifested migration at or after its floor", async () => {
  const root = await createFixture();
  try {
    await addSuccessorRelease(root);
    await write(
      root,
      "supabase/migrations/20260718130000_unmanifested.sql",
      "select 'unmanifested';\n",
    );

    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /successor migration set or order drifted/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successor release rejects a manifest whose migrations are not in strict version order", async () => {
  const root = await createFixture();
  try {
    const successor = await addSuccessorRelease(root);
    const laterFile = "20260718130000_later.sql";
    const laterSql = "select 'later';\n";
    await write(root, `supabase/migrations/${laterFile}`, laterSql);
    successor.expandMigrations = [
      { file: laterFile, sha256: sha256(laterSql) },
      successor.expandMigrations[0],
    ];
    await write(
      root,
      "supabase/release-manifests/vendor-disclosure-v2-20260718.json",
      `${JSON.stringify(successor, null, 2)}\n`,
    );

    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /strictly ordered from migrationFloor/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deployment-blocked successor refuses remote verification before invoking Supabase", async () => {
  const root = await createFixture();
  try {
    await addSuccessorRelease(root);
    const result = runFence(root, ["--remote", "--expect=expand-only"]);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /vendor-disclosure-v2-20260718 is deployment_blocked/i);
    assert.doesNotMatch(result.stdout, /Remote pending set verified/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("controller-ready successor remote fence expects the successor pending set, never the predecessor 27-file set", async () => {
  const root = await createFixture();
  try {
    const successor = await addControllerReadySuccessorRelease(root);
    const result = runFence(root, ["--remote", "--expect=expand-only"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(successor.release));
    assert.match(result.stdout, /expand-only \(1 migrations\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("이전 릴리스의 hash-pinned migration이 변조되면 정적 fence가 차단한다", async () => {
  const root = await createFixture();
  try {
    await write(root, "supabase/migrations/20260714000000_previous.sql", "select 'tampered';\n");
    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /predecessor migration hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote dry-run의 bullet migration 목록을 정확한 순서로 인식한다", async () => {
  const root = await createFixture();
  try {
    const result = runFence(root, ["--remote", "--expect=expand-only"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /expand-only \(1 migrations\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("이전 migration과 이전 manifest를 함께 바꿔도 현재 release pin이 차단한다", async () => {
  const root = await createFixture();
  try {
    const predecessorPath = join(
      root,
      "supabase/release-manifests/amora-openai-20260714.json",
    );
    const predecessor = JSON.parse(await readFile(predecessorPath, "utf8"));
    const tamperedMigration = "select 'coordinated-tamper';\n";
    predecessor.historicalReconciliation[0].sha256 = sha256(tamperedMigration);
    await write(root, "supabase/migrations/20260714000000_previous.sql", tamperedMigration);
    await write(
      root,
      "supabase/release-manifests/amora-openai-20260714.json",
      `${JSON.stringify(predecessor, null, 2)}\n`,
    );

    const result = runFence(root);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /predecessor release manifest hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the static fence requires a valid remote head and non-empty pre/post checks", async () => {
  const mutations = [
    (manifest) => { delete manifest.requiredRemoteHead; },
    (manifest) => { manifest.requiredRemoteHead = manifest.migrationFloor; },
    (manifest) => { manifest.preApplyChecks = []; },
    (manifest) => { manifest.postPushChecks = []; },
    (manifest) => { manifest.postApplyChecks = []; },
    (manifest) => { delete manifest.preApplyChecks[0].expectedEvidence; },
    (manifest) => { manifest.postApplyChecks[0].expectedEvidence = { pending_total: 0 }; },
  ];
  for (const mutate of mutations) {
    const root = await createFixture();
    try {
      const path = join(root, "supabase/release-manifests/amora-engine-v2-20260716.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      mutate(manifest);
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const result = runFence(root);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /remote head|preApplyChecks|postPushChecks|postApplyChecks|manualControlEvidence|release-phase/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("the static fence hash-verifies checks, platform operations, rollbacks and documents", async () => {
  const artifacts = [
    "supabase/release-checks/fixture-pre.sql",
    "supabase/release-checks/fixture-post-push.sql",
    "supabase/release-checks/fixture-post.sql",
    "supabase/platform-operations/security/fixture-apply.sql",
    "supabase/platform-operations/security/fixture_rollback.sql",
    "supabase/platform-operations/storage/fixture-post-push-apply.sql",
    "supabase/platform-operations/storage/fixture-post-push_rollback.sql",
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_inventory.sql",
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_apply.sql",
    "supabase/platform-operations/security/20260717141000_ai_log_retention_exact_acl_verify.sql",
    "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql",
    "scripts/amora-db-backup.ps1",
    "scripts/amora-db-verify-backup.ps1",
    "docs/current.md",
  ];
  for (const artifact of artifacts) {
    const root = await createFixture();
    try {
      await write(root, artifact, "tampered\n");
      const result = runFence(root);
      assert.notEqual(result.status, 0, `${artifact} was not fenced`);
      assert.match(result.stderr, /hash mismatch/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("the static fence rejects drift in every extended release contract boundary", async () => {
  const mutations = [
    (manifest) => { manifest.forwardOnlySecurityOperations[0].phase = "post-push-pre-deploy"; },
    (manifest) => { manifest.forwardOnlySecurityOperations[0].verificationCheckId = "missing-check"; },
    (manifest) => { manifest.forwardOnlySecurityOperations[0].supersedes.forbiddenFiles = []; },
    (manifest) => { manifest.postExpandBackupContract.maximumAgeMinutes = 30; },
    (manifest) => { manifest.postExpandBackupContract.expectedTables.pop(); },
    (manifest) => { manifest.postExpandBackupContract.expectedReleaseMigrationVersions.pop(); },
    (manifest) => { manifest.postExpandBackupContract.expectedTableContractSha256 = "0".repeat(64); },
    (manifest) => { manifest.postExpandBackupContract.hostedRestoreEvidence.requiredChecks.pop(); },
    (manifest) => { manifest.finalizationContract.requiredCanaryChecks.pop(); },
  ];
  for (const mutate of mutations) {
    const root = await createFixture();
    try {
      const path = join(
        root,
        "supabase/release-manifests/amora-engine-v2-20260716.json",
      );
      const manifest = JSON.parse(await readFile(path, "utf8"));
      mutate(manifest);
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const result = runFence(root);
      assert.notEqual(result.status, 0, "extended contract drift was not fenced");
      assert.match(
        result.stderr,
        /FORWARD_ONLY|POST_EXPAND|FINALIZATION|forward-only|extended|finalization/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("the static fence rejects invalid operation records and mutating release checks", async () => {
  const mutations = [
    (manifest) => { manifest.manualPlatformOperations[0].id = "Invalid ID"; },
    (manifest) => { manifest.rollbackArtifacts[0].file = "../escape.sql"; },
    (manifest) => { manifest.preApplyChecks[0].id = manifest.postApplyChecks[0].id; },
    (manifest) => { manifest.rollbackArtifacts[0].id = manifest.manualPlatformOperations[0].id; },
    (manifest) => { delete manifest.manualPlatformOperations[0].phase; },
    (manifest) => { manifest.manualPlatformOperations[0].verificationCheckId = "fixture-post-apply"; },
    (manifest) => { manifest.manualPlatformOperations[1].verificationCheckId = "fixture-pre-apply"; },
    (manifest) => { manifest.rollbackArtifacts[0].forOperationId = "missing-operation"; },
    (manifest) => { delete manifest.manualControlEvidence.postPushReceiptFileName; },
  ];
  for (const mutate of mutations) {
    const root = await createFixture();
    try {
      const path = join(root, "supabase/release-manifests/amora-engine-v2-20260716.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      mutate(manifest);
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const result = runFence(root);
      assert.notEqual(result.status, 0, result.stdout);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const root = await createFixture();
  try {
    const path = join(root, "supabase/release-manifests/amora-engine-v2-20260716.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const mutatingSql = "BEGIN;\ndelete from public.profiles;\nCOMMIT;\n";
    manifest.preApplyChecks[0].sha256 = sha256(mutatingSql);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await write(root, manifest.preApplyChecks[0].file, mutatingSql);
    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /read-only/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the static fence requires the manifest migration list to be strictly ordered", async () => {
  const root = await createFixture();
  try {
    const path = join(root, "supabase/release-manifests/amora-engine-v2-20260716.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const second = "select 'second';\n";
    manifest.expandMigrations.unshift({
      file: "20260716001000_second.sql",
      sha256: sha256(second),
    });
    await write(root, "supabase/migrations/20260716001000_second.sql", second);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /order/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the static fence pins the current-baseline verifier contract and content", async () => {
  const mutations = [
    (manifest) => { manifest.backupContract.expectedTableCount = 11; },
    (manifest) => { delete manifest.backupContract.hostedRestoreEvidence; },
    (manifest) => { manifest.backupContract.expectedCommitBinding = "literal"; },
    (manifest) => { manifest.backupContract.expectedOrigin = "git@github.com:example/wedding.git"; },
    (manifest) => { manifest.backupContract.supabaseCli.binarySha256 = "a".repeat(64); },
  ];
  for (const mutate of mutations) {
    const root = await createFixture();
    try {
      const path = join(root, "supabase/release-manifests/amora-engine-v2-20260716.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      mutate(manifest);
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const result = runFence(root);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /backup contract/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const root = await createFixture();
  try {
    await write(root, "scripts/amora-db-current-baseline-verify.ps1", "# tampered\n");
    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /current-baseline verifier hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
