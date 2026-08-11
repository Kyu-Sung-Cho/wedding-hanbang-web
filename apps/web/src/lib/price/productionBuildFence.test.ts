// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  validateSuccessorReleaseContract,
} from "../../../../../scripts/lib/supabase-successor-release-contract.mjs";
import {
  assertVendorDisclosureProductionBuild,
  expectedProductionAuthorizationSha256,
  VendorDisclosureProductionBuildBlocked,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
} from "../../../vendorDisclosureProductionBuildFence";

const RELEASE = "vendor-disclosure-v2-20260718";
const PROJECT_REF = "slrtobkksjmxgzatjyqb";
const PREDECESSOR_FILE =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const PREDECESSOR_MIGRATION = "20260716117000_predecessor.sql";
const SUCCESSOR_MIGRATION = "20260718120000_vendor_disclosure.sql";
const MANIFEST_FILE =
  "supabase/release-manifests/vendor-disclosure-v2-20260718.json";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha256(text: string): string {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

interface ReleaseFixtureManifest {
  release: string;
  projectRef: string;
  status: string;
  predecessorManifest: {
    file: string;
    sha256: string;
  };
  requiredRemoteHead: string;
  migrationFloor: string;
  expandMigrations: Array<{
    file: string;
    sha256: string;
  }>;
  deploymentEvidence: Record<string, unknown>;
  controllerContract?: {
    file: string;
    sha256: string;
  };
}

type Fixture = Awaited<ReturnType<typeof createBlockedFixture>>;

async function createBlockedFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "vendor-build-fence-"));
  roots.push(repoRoot);
  const manifestDirectory = join(repoRoot, "supabase", "release-manifests");
  const migrationDirectory = join(repoRoot, "supabase", "migrations");
  await Promise.all([
    mkdir(manifestDirectory, { recursive: true }),
    mkdir(migrationDirectory, { recursive: true }),
  ]);

  const predecessorSql = "select 'predecessor';\n";
  const successorSql = "select 'successor';\n";
  await Promise.all([
    writeFile(
      join(migrationDirectory, PREDECESSOR_MIGRATION),
      predecessorSql,
      "utf8",
    ),
    writeFile(
      join(migrationDirectory, SUCCESSOR_MIGRATION),
      successorSql,
      "utf8",
    ),
  ]);

  const predecessor = {
    release: "amora-engine-v2-20260716",
    projectRef: PROJECT_REF,
    expandMigrations: [
      { file: PREDECESSOR_MIGRATION, sha256: sha256(predecessorSql) },
    ],
  };
  const predecessorText = json(predecessor);
  await writeFile(join(repoRoot, PREDECESSOR_FILE), predecessorText, "utf8");

  const manifest: ReleaseFixtureManifest = {
    release: RELEASE,
    projectRef: PROJECT_REF,
    status: "deployment_blocked",
    predecessorManifest: {
      file: PREDECESSOR_FILE,
      sha256: sha256(predecessorText),
    },
    requiredRemoteHead: PREDECESSOR_MIGRATION.slice(0, 14),
    migrationFloor: SUCCESSOR_MIGRATION.slice(0, 14),
    expandMigrations: [
      { file: SUCCESSOR_MIGRATION, sha256: sha256(successorSql) },
    ],
    deploymentEvidence: {
      hostedStaging: "missing",
      backup: "missing",
      hostedRestore: "missing",
      storage: "missing",
      finalizer: "missing",
    },
  };
  const manifestPath = join(repoRoot, MANIFEST_FILE);
  await writeFile(manifestPath, json(manifest), "utf8");

  return { repoRoot, manifest, manifestPath, migrationDirectory };
}

function staticRuntimeEvidenceContracts(
  release: string,
): Record<string, unknown> {
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

async function createControllerReadyFixture(): Promise<Fixture> {
  const fixture = await createBlockedFixture();
  const baselineTables = ["profiles"];
  const baselineTablesSha256 = sha256(`${baselineTables.join("\n")}\n`);
  const predecessor = {
    release: "amora-engine-v2-20260716",
    projectRef: PROJECT_REF,
    expandMigrations: [{
      file: PREDECESSOR_MIGRATION,
      sha256: sha256("select 'predecessor';\n"),
    }],
    historicalEffectAudit: [],
    preApplyChecks: [{ id: "predecessor-precheck" }],
    postPushChecks: [],
    postApplyChecks: [{ id: "predecessor-postcheck" }],
    manualPlatformOperations: [{ id: "predecessor-manual-operation" }],
    rollbackArtifacts: [{ id: "predecessor-rollback-artifact" }],
    manualControlEvidence: {
      receiptFileName: "predecessor-write-fence.json",
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
    },
    backupContract: {
      excludedEphemeralTables: [],
      ephemeralRebuildContract: "not-required",
      expectedOrigin: "supabase-production",
      providerPhysicalBackup: {
        maximumAgeHours: 24,
        requirePhysicalBackup: true,
        requiredStatus: "COMPLETED",
        restoreCapability: "different-project",
      },
      hostedRestoreEvidence: {
        maximumAgeMinutes: 1_440,
        receiptFileName: "predecessor-hosted-restore.json",
        requiredChecks: ["differentProjectVerified"],
        requiredTargetIsolation: "different-supabase-project",
      },
      supabaseCli: {
        binarySha256: "a".repeat(64),
        version: "2.0.0",
      },
    },
    postExpandBackupContract: {
      expectedTables: baselineTables,
      expectedTableContractSha256: baselineTablesSha256,
      verifier: {
        file: "scripts/vendor-disclosure-db-verify-backup.ps1",
        sha256: "b".repeat(64),
      },
      requiredReceiptValues: {
        PGliteJsonbRoundTripVerified: true,
        PlaintextWrittenToDisk: false,
        SourceCanonicalDigestsVerified: true,
        Verified: true,
      },
    },
    finalizationContract: {
      id: "production-write-fence-exact-owner-finalizer",
      requiredLeasePhase: "deployment-canary",
      confirmationIncludesCanarySha256: true,
    },
    requiredDocuments: ["docs/release-controller.md"],
  };
  const predecessorText = json(predecessor);
  await writeFile(
    join(fixture.repoRoot, PREDECESSOR_FILE),
    predecessorText,
    "utf8",
  );
  fixture.manifest.predecessorManifest.sha256 = sha256(predecessorText);

  const releaseVersions = fixture.manifest.expandMigrations.map(
    (entry) => entry.file.slice(0, 14),
  );
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName:
      `${fixture.manifest.release}-feature-off-rollback.json`,
    maximumAgeMinutes: 30,
    requiredControls: {
      AMORA_AUXILIARY_MEMORY_ENABLED: "false",
      AMORA_CARE_OUTBOUND_ENABLED: "false",
      AMORA_COMMUNITY_AI_COMMENT_ENABLED: "false",
      AMORA_CONVERSATION_SEGMENT_READ_ENABLED: "false",
      AMORA_TODAY_ONE_ENABLED: "false",
      AMORA_OPENAI_ENABLED: "false",
      AMORA_PROACTIVE_CHAT_ENABLED: "false",
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
  const controllerContract = {
    contractVersion: 1,
    release: fixture.manifest.release,
    projectRef: fixture.manifest.projectRef,
    historicalEffectAudit: predecessor.historicalEffectAudit,
    preApplyChecks: predecessor.preApplyChecks,
    postPushChecks: predecessor.postPushChecks,
    postApplyChecks: [{
      id: "vendor-disclosure-successor-postcheck",
      expectedEvidence: {
        account_deletion_auth_fk_contract_count: 1,
        chat_partner_recipient_insert_policy_count: 1,
        chat_partner_recipient_select_policy_count: 1,
        chat_partner_recipient_trigger_count: 1,
        conversation_segment_active_index_count: 3,
        conversation_segment_rls_policy_count: 1,
        conversation_segment_rpc_acl_count: 1,
        conversation_segment_scope_fk_count: 2,
        couple_plan_change_auth_user_fk_count: 4,
        couple_plan_change_display_guard_count: 1,
        couple_plan_change_idempotency_index_count: 1,
        couple_plan_change_journey_write_fence_count: 4,
        couple_plan_change_terminal_event_count: 3,
        couple_plan_change_write_boundary_trigger_count: 1,
        chat_feedback_auth_delete_fk_count: 1,
        payment_ledger_fk_contract_count: 3,
        successor_created_table_count: 0,
        successor_feature_flags_off_count: 10,
        successor_migration_head_count: 1,
        wedding_court_auth_delete_fk_count: 1,
      },
    }],
    forwardOnlySecurityOperations: [],
    manualPlatformOperations: predecessor.manualPlatformOperations,
    rollbackArtifacts: predecessor.rollbackArtifacts,
    manualControlEvidence: {
      ...predecessor.manualControlEvidence,
      receiptFileName:
        `${fixture.manifest.release}-production-write-fence.json`,
    },
    backupContract: {
      id:
        `pre-${fixture.manifest.release}-current-remote-backup`,
      version: 2,
      format: "hbam2-encrypted-current-user",
      expectedTableCount: baselineTables.length,
      expectedTables: baselineTables,
      expectedTableContractSha256: baselineTablesSha256,
      expectedMigrationHead: fixture.manifest.requiredRemoteHead,
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
        receiptFileName:
          `${fixture.manifest.release}-hosted-restore-evidence.json`,
      },
      supabaseCli: predecessor.backupContract.supabaseCli,
      requiredReceiptValues:
        predecessor.postExpandBackupContract.requiredReceiptValues,
    },
    postExpandBackupContract: {
      id: `post-${fixture.manifest.release}-backup`,
      version: 2,
      expectedTableCount: baselineTables.length,
      expectedTables: baselineTables,
      expectedTableContractSha256: baselineTablesSha256,
      expectedReleaseMigrationBaselineHead:
        fixture.manifest.requiredRemoteHead,
      expectedReleaseMigrationHead: releaseVersions.at(-1),
      expectedReleaseMigrationVersions: releaseVersions,
      expectedReleaseMigrationContractSha256:
        sha256(`${releaseVersions.join("\n")}\n`),
      capture: {
        file: "scripts/vendor-disclosure-db-backup.ps1",
        sha256: "c".repeat(64),
      },
      verifier: {
        file: "scripts/vendor-disclosure-db-verify-backup.ps1",
        sha256: "d".repeat(64),
      },
    },
    finalizationContract: {
      ...predecessor.finalizationContract,
      version: 2,
    },
    rollbackContract,
    requiredDocuments: predecessor.requiredDocuments,
  };
  const controllerContractText = json(controllerContract);
  const controllerContractRelativePath =
    "supabase/release-contracts/vendor-disclosure-production-controller-v1.json";
  const controllerContractPath = join(
    fixture.repoRoot,
    ...controllerContractRelativePath.split("/"),
  );
  await mkdir(join(controllerContractPath, ".."), { recursive: true });
  await writeFile(controllerContractPath, controllerContractText, "utf8");

  fixture.manifest.status = "controller_ready";
  fixture.manifest.deploymentEvidence =
    staticRuntimeEvidenceContracts(fixture.manifest.release);
  fixture.manifest.controllerContract = {
    file: controllerContractRelativePath,
    sha256: sha256(controllerContractText),
  };
  await writeManifest(fixture);
  return fixture;
}

function assertProduction(repoRoot: string) {
  return assertVendorDisclosureProductionBuild({
    repoRoot,
    environment: { VERCEL_ENV: "production" },
  });
}

function expectBlockedWithCode(action: () => void, code: string) {
  try {
    action();
    throw new Error("expected production build to be blocked");
  } catch (error) {
    expect(error).toBeInstanceOf(VendorDisclosureProductionBuildBlocked);
    expect((error as VendorDisclosureProductionBuildBlocked).code).toBe(code);
    return error as VendorDisclosureProductionBuildBlocked;
  }
}

async function writeManifest(fixture: Fixture) {
  await writeFile(fixture.manifestPath, json(fixture.manifest), "utf8");
}

describe("vendor disclosure production build fence", () => {
  it("allows preview and local builds without touching the release checkout", () => {
    expect(() => assertVendorDisclosureProductionBuild({
      repoRoot: "does-not-need-to-exist",
      environment: { VERCEL_ENV: "preview" },
    })).not.toThrow();
    expect(() => assertVendorDisclosureProductionBuild({
      repoRoot: "does-not-need-to-exist",
      environment: {},
    })).not.toThrow();
  });

  it("keeps the repository manifest deployment-blocked with every evidence class missing", async () => {
    const repoRoot = resolve(process.cwd(), "../..");
    const manifest = JSON.parse(
      await readFile(join(repoRoot, MANIFEST_FILE), "utf8"),
    ) as {
      status: string;
      deploymentEvidence: Record<string, unknown>;
    };
    expect(manifest.status).toBe("deployment_blocked");
    expect(Object.values(manifest.deploymentEvidence)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
      "missing",
    ]);
  });

  it("requires an owner authorization signature after the controller is ready", async () => {
    const fixture = await createControllerReadyFixture();
    const error = expectBlockedWithCode(
      () => assertProduction(fixture.repoRoot),
      VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
    );
    expect(error.message).toMatch(/VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION/);
  });

  it("blocks when the owner authorization signature does not match the release manifest", async () => {
    const fixture = await createControllerReadyFixture();
    expectBlockedWithCode(
      () => assertVendorDisclosureProductionBuild({
        repoRoot: fixture.repoRoot,
        environment: {
          VERCEL_ENV: "production",
          VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: "0".repeat(64),
        },
      }),
      VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID,
    );
  });

  it("allows a signed blocked-status release while the controller-ready stage is deferred", async () => {
    // 이 단언은 원래 반대였다 — `deployment_blocked` 상태에서는 서명이 맞아도
    // "VENDOR_DISCLOSURE_CONTROLLER_NOT_READY" 코드로 막혔다.
    //
    // 그 단계를 2026-08-08에 유예했다. 이유는 fence 본문 주석에 적어 뒀는데
    // 요약하면: 그 검사는 벤더 공시 v2를 위한 것인데 **모든 프로덕션 빌드**를 막아서,
    // 아모라·랜딩처럼 무관한 변경까지 그 릴리스 일정에 묶였다. 실제로 그날 하루
    // 아무것도 배포되지 못했다.
    //
    // 여기서 테스트를 지우지 않고 뒤집어 두는 이유는, 유예를 푸는 사람이 이 단언을
    // 반드시 마주치게 하기 위해서다. 되살릴 때는 fence의 `enforceControllerReady`를
    // true로 바꾸고 이 테스트를 원래대로(막힘 기대) 되돌린다.
    const fixture = await createBlockedFixture();
    expect(() => assertVendorDisclosureProductionBuild({
      repoRoot: fixture.repoRoot,
      environment: {
        VERCEL_ENV: "production",
        VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION:
          expectedProductionAuthorizationSha256(fixture.repoRoot),
      },
    })).not.toThrow();
  });

  it("still refuses a blocked-status release that is not signed", async () => {
    // 유예한 것은 controller-ready 단계뿐이다. 소유자 서명은 그대로 강제된다 —
    // 이게 남아 있어야 "누가 이 배포를 승인했는가"에 답할 수 있다.
    const fixture = await createBlockedFixture();
    expectBlockedWithCode(
      () => assertVendorDisclosureProductionBuild({
        repoRoot: fixture.repoRoot,
        environment: { VERCEL_ENV: "production" },
      }),
      VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
    );
  });

  it("allows a controller-ready fixture when the owner signs the exact release manifest", async () => {
    const fixture = await createControllerReadyFixture();
    expect(() => validateSuccessorReleaseContract({
      repoRoot: fixture.repoRoot,
    })).not.toThrow();
    expect(() => assertVendorDisclosureProductionBuild({
      repoRoot: fixture.repoRoot,
      environment: {
        VERCEL_ENV: "production",
        VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION:
          expectedProductionAuthorizationSha256(fixture.repoRoot),
      },
    })).not.toThrow();
  });

  it("rejects the former synthetic authorized receipt path before reading its booleans", async () => {
    const fixture = await createBlockedFixture();
    const manifest = fixture.manifest as unknown as {
      status: string;
      deploymentEvidence: Record<string, unknown>;
    };
    manifest.status = "deployment_authorized";
    manifest.deploymentEvidence = {
      hostedStaging: { receiptVersion: 1, status: "verified_success" },
      backup: { receiptVersion: 1, status: "verified_success" },
      hostedRestore: { receiptVersion: 1, status: "verified_success" },
      storage: { receiptVersion: 1, status: "verified_success" },
      finalizer: { receiptVersion: 1, status: "verified_success" },
    };
    await writeManifest(fixture);

    const error = expectBlockedWithCode(
      () => assertProduction(fixture.repoRoot),
      VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
    );
    expect(error.message).toMatch(/DEPLOYMENT_STATUS_INVALID/);
  });

  it("propagates a missing predecessor rejection from the shared validator", async () => {
    const fixture = await createBlockedFixture();
    await unlink(join(fixture.repoRoot, PREDECESSOR_FILE));

    const error = expectBlockedWithCode(
      () => assertProduction(fixture.repoRoot),
      VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
    );
    expect(error.message).toMatch(/PIN_MISSING/);
  });

  it("propagates unmanifested successor migration drift from the shared validator", async () => {
    const fixture = await createBlockedFixture();
    await writeFile(
      join(fixture.migrationDirectory, "20260718130000_unmanifested.sql"),
      "select 'unmanifested';\n",
      "utf8",
    );

    const error = expectBlockedWithCode(
      () => assertProduction(fixture.repoRoot),
      VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
    );
    expect(error.message).toMatch(/MIGRATION_SET_DRIFT/);
  });
});
