// 후속 릴리스 매니페스트의 "증거 고정" 상태 계약.
//
// 게이트를 여는 유일한 문이므로, 여기서 느슨하면 뒤의 55종 차단이 전부 무의미해진다.
// 실제 저장소 파일을 복사해 픽스처를 만들고 매니페스트만 바꿔가며,
// 통과해야 할 것과 막혀야 할 것을 하나씩 확인한다.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  SuccessorReleaseContractError,
  successorCreatedPublicTables,
  validateSuccessorReleaseContract,
  validateSuccessorRuntimeEvidence,
} from "../lib/supabase-successor-release-contract.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const RELEASE_COMMIT = "180e97c554d69b6ce000f897e739bf789e66e1a6";
const OTHER_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const roots = [];

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** 실제 저장소를 그대로 복사해, 매니페스트 외의 조건은 전부 유효한 상태로 둔다. */
function fixture(mutate) {
  const root = mkdtempSync(join(tmpdir(), "successor-contract-"));
  roots.push(root);
  cpSync(join(REPO_ROOT, "supabase", "migrations"), join(root, "supabase", "migrations"), { recursive: true });
  cpSync(
    join(REPO_ROOT, "supabase", "release-manifests"),
    join(root, "supabase", "release-manifests"),
    { recursive: true },
  );
  const manifestPath = join(root, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const mutated = mutate(manifest) ?? manifest;
  writeFileSync(manifestPath, `${JSON.stringify(mutated, null, 2)}\n`);
  return root;
}

const BACKUP_CONTRACT = { id: "amora-db-current-baseline", version: 1 };

function createdPublicTablesForMigrations(root, migrations) {
  return successorCreatedPublicTables(root, migrations);
}

test("1700 개인화 테이블은 successor 백업 대상과 보안 경계로 정적 추출된다", () => {
  const migrationFile =
    "20260731170000_amora_personalization_preferences.sql";
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, [{ file: migrationFile }]),
    ["amora_personalization_preferences"],
  );

  const sql = readFileSync(
    join(REPO_ROOT, "supabase", "migrations", migrationFile),
    "utf8",
  );
  assert.match(
    sql,
    /owner_user_id\s+uuid\s+PRIMARY\s+KEY\s+REFERENCES\s+public\.profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/is,
  );
  assert.match(
    sql,
    /ALTER\s+TABLE\s+public\.amora_personalization_preferences\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/is,
  );
  assert.match(
    sql,
    /ALTER\s+TABLE\s+public\.amora_personalization_preferences\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/is,
  );
  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.amora_personalization_preferences\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/is,
  );
  assert.match(
    sql,
    /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.amora_personalization_preferences\s+TO\s+authenticated/is,
  );
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.set_own_amora_personalization_preferences\s*\(\s*p_expected_revision\s+bigint\s*,\s*p_decision_start\s+text\s*,\s*p_answer_detail\s+text\s*,\s*p_support_order\s+text\s*,\s*p_work_mode\s+text\s*,\s*p_family_order\s+text\s*\)[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*''/i,
  );
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.clear_own_amora_personalization_preferences\s*\(\s*p_expected_revision\s+bigint\s*\)[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*''/i,
  );
  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.set_own_amora_personalization_preferences\s*\(\s*bigint\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/is,
  );
  assert.match(
    sql,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_own_amora_personalization_preferences\s*\(\s*bigint\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s+TO\s+authenticated/is,
  );
  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.clear_own_amora_personalization_preferences\s*\(\s*bigint\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/is,
  );
  assert.match(
    sql,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.clear_own_amora_personalization_preferences\s*\(\s*bigint\s*\)\s+TO\s+authenticated/is,
  );
});

test("checklist collaboration persistence is pinned to the exact successor backup set", () => {
  const manifest = JSON.parse(readFileSync(
    join(REPO_ROOT, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH),
    "utf8",
  ));
  const checklistMigrations = manifest.expandMigrations.slice(-3);

  assert.equal(manifest.expandMigrations.length, 86);
  assert.deepEqual(
    checklistMigrations.map((entry) => entry.file),
    [
      "20260812180000_checklist_collaboration_approval.sql",
      "20260812192000_amora_atomic_checklist_v3.sql",
      "20260812193000_checklist_disclosure_receipt.sql",
    ],
  );
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, checklistMigrations),
    [
      "couple_plan_change_disclosure_receipts",
      "couple_reset_checklist_scrub_claims",
    ],
  );
});

function expectBlocked(root, code) {
  try {
    validateSuccessorReleaseContract({ repoRoot: root });
  } catch (error) {
    assert.ok(error instanceof SuccessorReleaseContractError, `예상과 다른 오류: ${error}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`통과하면 안 되는데 통과했다 (기대 코드: ${code})`);
}

test("차단 상태 매니페스트는 지금까지처럼 그대로 통과하고 차단으로 판정된다", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.releaseCommit, null);
  assert.equal(result.manifest.status, "deployment_blocked");
});

test("차단 상태에 backupContract만 몰래 넣어 둘 수 없다", () => {
  expectBlocked(
    fixture((m) => {
      m.backupContract = BACKUP_CONTRACT;
      return m;
    }),
    "MANIFEST_SHAPE_INVALID",
  );
});

test("알 수 없는 status와 과거 evidence_pinned 상태는 거부한다", () => {
  for (const status of ["ready", "evidence_pinned"]) {
    expectBlocked(
      fixture((m) => {
        m.status = status;
        return m;
      }),
      "DEPLOYMENT_STATUS_INVALID",
    );
  }
});

test("controller_ready인데 controllerContract pin이 없으면 형태 위반이다", () => {
  expectBlocked(
    fixture((m) => {
      m.status = "controller_ready";
      m.deploymentEvidence = staticRuntimeEvidenceContracts(m.release);
      return m;
    }),
    "MANIFEST_SHAPE_INVALID",
  );
});

function canonicalJsonSha256(value) {
  const canonicalJson = (candidate) => {
    if (candidate === null || typeof candidate !== "object") {
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) {
      return `[${candidate.map(canonicalJson).join(",")}]`;
    }
    return `{${Object.keys(candidate).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(candidate[key])}`,
    ).join(",")}}`;
  };
  return createHash("sha256")
    .update(`${canonicalJson(value)}\n`, "utf8")
    .digest("hex");
}

function runtimeEvidenceFixture() {
  const root = mkdtempSync(join(tmpdir(), "successor-runtime-contract-"));
  const receiptRoot = mkdtempSync(join(tmpdir(), "successor-runtime-receipts-"));
  roots.push(root, receiptRoot);
  const release = "vendor-disclosure-v2-20260718";
  const versions = ["20260718120000", "20260718130000"];
  const postApplyCheckIds = ["vendor-disclosure-postcheck"];
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName: `${release}-feature-off-rollback.json`,
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
  const manifest = {
    release,
    projectRef: "slrtobkksjmxgzatjyqb",
    status: "controller_ready",
    requiredRemoteHead: "20260716117000",
    expandMigrations: versions.map((version) => ({
      file: `${version}_fixture.sql`,
      sha256: "a".repeat(64),
    })),
    deploymentEvidence: Object.fromEntries(
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
    ),
  };
  const controllerManifest = {
    ...manifest,
    postApplyChecks: postApplyCheckIds.map((id) => ({ id })),
    backupContract: {
      id: `pre-${release}-current-remote-backup`,
      version: 2,
      expectedMigrationHead: manifest.requiredRemoteHead,
      expectedTableCount: 27,
      expectedTableContractSha256: "b".repeat(64),
      providerPhysicalBackup: {
        requiredStatus: "COMPLETED",
      },
      hostedRestoreEvidence: {
        requiredTargetIsolation: "different-supabase-project",
      },
    },
    manualControlEvidence: {
      receiptFileName: `${release}-production-write-fence.json`,
      signedUploadTokenTtlMinutes: 120,
      signedUploadGraceMinutes: 10,
      storageStabilityWindowMinutes: 5,
    },
    finalizationContract: {
      version: 2,
    },
    rollbackContract,
  };
  const capturedAt = "2026-07-31T00:00:00Z";
  const migrationVersionsSha256 = createHash("sha256")
    .update(`${versions.join("\n")}\n`, "utf8")
    .digest("hex");
  const postApplyChecksSha256 = createHash("sha256")
    .update(`${postApplyCheckIds.join("\n")}\n`, "utf8")
    .digest("hex");
  const rollbackContractSha256 = canonicalJsonSha256(rollbackContract);
  const observations = {
    backup: {
      backupContractId: controllerManifest.backupContract.id,
      backupContractVersion: controllerManifest.backupContract.version,
      expectedMigrationHead: manifest.requiredRemoteHead,
      expectedTableCount: controllerManifest.backupContract.expectedTableCount,
      expectedTableContractSha256:
        controllerManifest.backupContract.expectedTableContractSha256,
      providerPhysicalBackupStatus: "COMPLETED",
      restoreCandidateAvailable: true,
    },
    finalizer: {
      featureOffReceiptFileName: rollbackContract.featureOffReceiptFileName,
      finalizationContractVersion:
        controllerManifest.finalizationContract.version,
      migrationRollback: rollbackContract.migrationRollback,
      requiredControls: structuredClone(rollbackContract.requiredControls),
      rollbackStrategy: rollbackContract.strategy,
    },
    hostedRestore: {
      backupContractId: controllerManifest.backupContract.id,
      expectedTableContractSha256:
        controllerManifest.backupContract.expectedTableContractSha256,
      expectedTableCount: controllerManifest.backupContract.expectedTableCount,
      sourceProjectRef: manifest.projectRef,
      targetIsolation: "different-supabase-project",
      targetProjectRef: "abcdefghijklmnopqrst",
    },
    hostedStaging: {
      expectedMigrationHead: versions.at(-1),
      migrationCount: versions.length,
      migrationVersionsSha256,
      requiredRemoteHead: manifest.requiredRemoteHead,
      rollbackStrategy: rollbackContract.strategy,
    },
    storage: {
      requiredMutationPolicyCount: 0,
      signedUploadGraceMinutes: 10,
      signedUploadTokenTtlMinutes: 120,
      storageStabilityWindowMinutes: 5,
      writeFenceReceiptFileName:
        controllerManifest.manualControlEvidence.receiptFileName,
    },
  };

  for (const [name, contract] of Object.entries(manifest.deploymentEvidence)) {
    const rawBody = `${JSON.stringify({
      provider: contract.rawEvidenceSource,
      observation: name,
      capturedAt,
    })}\n`;
    writeFileSync(join(receiptRoot, contract.rawEvidenceFileName), rawBody, "utf8");
    const expiresAt = new Date(
      Date.parse(capturedAt) + contract.maximumAgeMinutes * 60_000,
    ).toISOString();
    const receipt = {
      receiptVersion: 1,
      kind: contract.kind,
      release,
      projectRef: manifest.projectRef,
      releaseCommit: RELEASE_COMMIT,
      capturedAt,
      expiresAt,
      requiredRemoteHead: manifest.requiredRemoteHead,
      expectedMigrationHead: versions.at(-1),
      migrationCount: versions.length,
      migrationVersionsSha256,
      observations: observations[name],
      postApplyCheckIds,
      postApplyChecksSha256,
      rollbackContractSha256,
      checks: Object.fromEntries(
        contract.requiredChecks.map((check) => [check, true]),
      ),
      rawProvenance: {
        fileName: contract.rawEvidenceFileName,
        sha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
        capturedAt,
        source: contract.rawEvidenceSource,
      },
      containsSecrets: false,
    };
    writeFileSync(
      join(receiptRoot, contract.receiptFileName),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
  }
  return {
    root,
    receiptRoot,
    manifest,
    controllerManifest,
    now: () => new Date("2026-07-31T00:05:00Z"),
  };
}

test("저장소 밖의 5종 구조화 영수증과 private raw provenance를 의미까지 검증한다", () => {
  const state = runtimeEvidenceFixture();
  const result = validateSuccessorRuntimeEvidence({
    repoRoot: state.root,
    receiptRoot: state.receiptRoot,
    manifest: state.manifest,
    controllerManifest: state.controllerManifest,
    expectedCommit: RELEASE_COMMIT,
    now: state.now,
  });
  assert.deepEqual(
    Object.keys(result).sort(),
    Object.keys(SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS).sort(),
  );
  assert.ok(Object.values(result).every((entry) => entry.verifiedAt === "2026-07-31T00:00:00Z"));
});

test("{verified:true} 같은 path/hash-only 증거는 절대 런타임 영수증이 될 수 없다", () => {
  const state = runtimeEvidenceFixture();
  const contract = state.manifest.deploymentEvidence.backup;
  writeFileSync(
    join(state.receiptRoot, contract.receiptFileName),
    '{"verified":true}\n',
    "utf8",
  );
  assert.throws(
    () => validateSuccessorRuntimeEvidence({
      repoRoot: state.root,
      receiptRoot: state.receiptRoot,
      manifest: state.manifest,
      controllerManifest: state.controllerManifest,
      expectedCommit: RELEASE_COMMIT,
      now: state.now,
    }),
    (error) => error?.code === "RUNTIME_EVIDENCE_RECEIPT_INVALID",
  );
});

test("필수 의미 체크가 false이거나 추가 필드가 있으면 영수증을 거부한다", () => {
  for (const mutate of [
    (receipt) => {
      receipt.checks.databaseBackupVerified = false;
    },
    (receipt) => {
      receipt.observations.expectedTableCount = 14;
    },
    (receipt) => {
      receipt.note = "수동 확인";
    },
  ]) {
    const state = runtimeEvidenceFixture();
    const contract = state.manifest.deploymentEvidence.backup;
    const path = join(state.receiptRoot, contract.receiptFileName);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    mutate(receipt);
    writeFileSync(path, `${JSON.stringify(receipt)}\n`, "utf8");
    assert.throws(
      () => validateSuccessorRuntimeEvidence({
        repoRoot: state.root,
        receiptRoot: state.receiptRoot,
        manifest: state.manifest,
        controllerManifest: state.controllerManifest,
        expectedCommit: RELEASE_COMMIT,
        now: state.now,
      }),
      (error) => error?.code === "RUNTIME_EVIDENCE_RECEIPT_INVALID",
    );
  }
});

test("다른 commit, 만료된 영수증, 변조된 private raw provenance를 각각 거부한다", () => {
  for (const [mutateReceipt, mutateRaw, expectedCode] of [
    [
      (receipt) => {
        receipt.releaseCommit = OTHER_COMMIT;
      },
      () => {},
      "RUNTIME_EVIDENCE_RECEIPT_INVALID",
    ],
    [
      (receipt) => {
        receipt.capturedAt = "2026-07-29T00:00:00Z";
        receipt.expiresAt = "2026-07-29T00:30:00Z";
        receipt.rawProvenance.capturedAt = receipt.capturedAt;
      },
      () => {},
      "RUNTIME_EVIDENCE_STALE",
    ],
    [
      () => {},
      (path) => writeFileSync(path, '{"tampered":true}\n', "utf8"),
      "RUNTIME_EVIDENCE_RAW_INVALID",
    ],
  ]) {
    const state = runtimeEvidenceFixture();
    const contract = state.manifest.deploymentEvidence.backup;
    const receiptPath = join(state.receiptRoot, contract.receiptFileName);
    const rawPath = join(state.receiptRoot, contract.rawEvidenceFileName);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    mutateReceipt(receipt);
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");
    mutateRaw(rawPath);
    assert.throws(
      () => validateSuccessorRuntimeEvidence({
        repoRoot: state.root,
        receiptRoot: state.receiptRoot,
        manifest: state.manifest,
        controllerManifest: state.controllerManifest,
        expectedCommit: RELEASE_COMMIT,
        now: state.now,
      }),
      (error) => error?.code === expectedCode,
    );
  }
});

function staticRuntimeEvidenceContracts(release) {
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

function readyStaticFixture({
  mutateContract = () => {},
  mutateManifest = () => {},
} = {}) {
  const root = fixture((manifest) => manifest);
  const manifestPath = join(root, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
  const predecessorPath = join(
    root,
    "supabase",
    "release-manifests",
    "amora-engine-v2-20260716.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const predecessor = JSON.parse(readFileSync(predecessorPath, "utf8"));
  const releaseVersions = manifest.expandMigrations.map((entry) => entry.file.slice(0, 14));
  const baselineTables = predecessor.postExpandBackupContract.expectedTables;
  const createdTables = createdPublicTablesForMigrations(
    root,
    manifest.expandMigrations,
  );
  const postExpandTables = [...new Set([...baselineTables, ...createdTables])].sort();
  const textDigest = (values) => createHash("sha256")
    .update(`${values.join("\n")}\n`, "utf8")
    .digest("hex");
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName: `${manifest.release}-feature-off-rollback.json`,
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
  const contract = {
    contractVersion: 1,
    release: manifest.release,
    projectRef: manifest.projectRef,
    historicalEffectAudit: predecessor.historicalEffectAudit,
    preApplyChecks: predecessor.preApplyChecks,
    postPushChecks: predecessor.postPushChecks,
    postApplyChecks: [{
      id: "vendor-disclosure-successor-postcheck",
      type: "read-only-sql",
      file: "supabase/release-checks/vendor-disclosure-successor-post.sql",
      sha256: "b".repeat(64),
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
        successor_created_table_count: createdTables.length,
        successor_feature_flags_off_count: 10,
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
      receiptFileName: `${manifest.release}-production-write-fence.json`,
      storageDrainReceiptFileName: `${manifest.release}-storage-drain.json`,
      postPushReceiptFileName: `${manifest.release}-post-push.json`,
    },
    backupContract: {
      id: `pre-${manifest.release}-current-remote-backup`,
      version: 2,
      format: "hbam2-encrypted-current-user",
      expectedTableCount: baselineTables.length,
      expectedTables: baselineTables,
      expectedTableContractSha256: textDigest(baselineTables),
      expectedMigrationHead: manifest.requiredRemoteHead,
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
        receiptFileName: `${manifest.release}-hosted-restore-evidence.json`,
      },
      supabaseCli: predecessor.backupContract.supabaseCli,
      requiredReceiptValues:
        predecessor.postExpandBackupContract.requiredReceiptValues,
    },
    postExpandBackupContract: {
      ...predecessor.postExpandBackupContract,
      id: `post-${manifest.release}-backup`,
      version: 2,
      verificationReceiptFileName:
        `${manifest.release}-post-expand-backup-verification.json`,
      expectedTableCount: postExpandTables.length,
      expectedTables: postExpandTables,
      expectedReleaseMigrationBaselineHead: manifest.requiredRemoteHead,
      expectedReleaseMigrationHead: releaseVersions.at(-1),
      expectedReleaseMigrationVersions: releaseVersions,
      expectedTableContractSha256: textDigest(postExpandTables),
      expectedReleaseMigrationContractSha256: textDigest(releaseVersions),
      capture: {
        file: "scripts/vendor-disclosure-db-backup.ps1",
        sha256: "c".repeat(64),
      },
      verifier: {
        file: "scripts/vendor-disclosure-db-verify-backup.ps1",
        sha256: "d".repeat(64),
      },
      hostedRestoreEvidence: {
        ...predecessor.postExpandBackupContract.hostedRestoreEvidence,
        receiptFileName:
          `${manifest.release}-post-expand-hosted-restore-evidence.json`,
      },
    },
    finalizationContract: {
      ...predecessor.finalizationContract,
      version: 2,
    },
    rollbackContract,
    requiredDocuments: predecessor.requiredDocuments,
  };
  mutateContract(contract);
  const contractText = `${JSON.stringify(contract, null, 2)}\n`;
  const contractRelativePath =
    "supabase/release-contracts/vendor-disclosure-production-controller-v1.json";
  const contractPath = join(root, ...contractRelativePath.split("/"));
  mkdirSync(join(contractPath, ".."), { recursive: true });
  writeFileSync(contractPath, contractText, "utf8");
  manifest.status = "controller_ready";
  manifest.deploymentEvidence = staticRuntimeEvidenceContracts(manifest.release);
  manifest.controllerContract = {
    file: contractRelativePath,
    sha256: createHash("sha256").update(contractText, "utf8").digest("hex"),
  };
  mutateManifest(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { root, manifest, contract, createdTables };
}

test("controller_ready는 현재 remote baseline, exact migration set, postcheck와 feature-off rollback을 함께 고정한다", () => {
  const state = readyStaticFixture();
  const result = validateSuccessorReleaseContract({ repoRoot: state.root });
  assert.equal(result.deploymentBlocked, false);
  assert.equal(result.controllerReady, true);
  assert.equal(result.controllerManifest.release, state.manifest.release);
  assert.equal(
    result.controllerManifest.expandMigrations.length,
    state.manifest.expandMigrations.length,
  );
  assert.equal(
    result.controllerManifest.backupContract.expectedMigrationHead,
    state.manifest.requiredRemoteHead,
  );
  assert.ok(state.createdTables.includes("couple_plan_change_requests"));
  assert.ok(state.createdTables.includes("couple_plan_change_acceptances"));
  assert.ok(state.createdTables.includes("conversation_segments"));
  assert.ok(
    state.createdTables.includes("amora_memory_enqueue_repair_candidates"),
  );
  assert.ok(
    state.createdTables.includes("amora_memory_enqueue_repair_dead_letters"),
  );
  assert.ok(
    result.controllerManifest.postExpandBackupContract.expectedTables
      .includes("account_deletion_jobs"),
  );
  assert.ok(
    result.controllerManifest.postExpandBackupContract.expectedTables
      .includes("account_deletion_media_manifest"),
  );
  assert.ok(
    result.controllerManifest.postExpandBackupContract.expectedTables
      .includes("conversation_segments"),
  );
  assert.ok(
    result.controllerManifest.postExpandBackupContract.expectedTables
      .includes("amora_memory_enqueue_repair_candidates"),
  );
  assert.ok(
    result.controllerManifest.postExpandBackupContract.expectedTables
      .includes("amora_memory_enqueue_repair_dead_letters"),
  );
  assert.ok(
    result.controllerManifest.postExpandBackupContract.expectedTables
      .includes("couple_reset_checklist_scrub_claims"),
  );
  assert.ok(
    result.controllerManifest.postExpandBackupContract.expectedTables
      .includes("couple_plan_change_disclosure_receipts"),
  );
  assert.equal(
    result.controllerManifest.postExpandBackupContract.expectedReleaseMigrationHead,
    "20260812193000",
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .successor_created_table_count,
    state.createdTables.length,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .account_deletion_auth_fk_contract_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .couple_plan_change_auth_user_fk_count,
    4,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .couple_plan_change_terminal_event_count,
    3,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .wedding_court_auth_delete_fk_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .chat_feedback_auth_delete_fk_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .payment_ledger_fk_contract_count,
    3,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .couple_plan_change_journey_write_fence_count,
    4,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .couple_plan_change_write_boundary_trigger_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .couple_plan_change_display_guard_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .couple_plan_change_idempotency_index_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .chat_partner_recipient_trigger_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .conversation_segment_scope_fk_count,
    2,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .conversation_segment_active_index_count,
    3,
  );
});

test("successor 또는 account-deletion table을 self-consistent backup list에서 빼도 차단한다", () => {
  for (const omittedTable of [
    "couple_plan_change_requests",
    "account_deletion_jobs",
  ]) {
    const root = readyStaticFixture({
      mutateContract: (contract) => {
        const tables = contract.postExpandBackupContract.expectedTables.filter(
          (table) => table !== omittedTable,
        );
        contract.postExpandBackupContract.expectedTables = tables;
        contract.postExpandBackupContract.expectedTableCount = tables.length;
        contract.postExpandBackupContract.expectedTableContractSha256 =
          createHash("sha256")
            .update(`${tables.join("\n")}\n`, "utf8")
            .digest("hex");
      },
    }).root;
    expectBlocked(root, "SUCCESSOR_CONTROLLER_CONTRACT_INVALID");
  }
});

test("controller_ready의 다섯 receipt/raw filename은 서로 재사용할 수 없다", () => {
  expectBlocked(
    readyStaticFixture({
      mutateManifest: (manifest) => {
        manifest.deploymentEvidence.storage.rawEvidenceFileName =
          manifest.deploymentEvidence.backup.rawEvidenceFileName;
      },
    }).root,
    "DEPLOYMENT_EVIDENCE_INVALID",
  );
});

test("이전 14-table backup 또는 27-table post-expand/finalizer 계약 재사용은 차단한다", () => {
  for (const mutateContract of [
    (contract) => {
      contract.backupContract = {
        ...contract.backupContract,
        id: "pre-amora-current-remote-14-table-baseline",
        version: 1,
      };
    },
    (contract) => {
      contract.backupContract.excludedEphemeralTables = [];
    },
    (contract) => {
      contract.backupContract.unreviewedRestoreShortcut = true;
    },
    (contract) => {
      contract.postExpandBackupContract.capture.file = "scripts/amora-db-backup.ps1";
    },
    (contract) => {
      contract.postExpandBackupContract.expectedReleaseMigrationHead =
        "20260716117000";
    },
    (contract) => {
      contract.finalizationContract.version = 1;
    },
  ]) {
    expectBlocked(
      readyStaticFixture({ mutateContract }).root,
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
    );
  }
});

test("postcheck 또는 feature-off rollback 계약을 약화하면 controller_ready가 되지 않는다", () => {
  for (const mutateContract of [
    (contract) => {
      contract.postApplyChecks = [];
    },
    (contract) => {
      contract.rollbackContract.requiredControls.AMORA_OPENAI_ENABLED = "true";
    },
    (contract) => {
      contract.rollbackContract.requiredControls
        .AMORA_CONVERSATION_SEGMENT_READ_ENABLED = "true";
    },
    (contract) => {
      contract.rollbackContract.requiredControls.AMORA_TODAY_ONE_ENABLED = "true";
    },
    (contract) => {
      contract.rollbackContract.requiredChecks =
        contract.rollbackContract.requiredChecks.filter(
          (check) => check !== "chatPartnerRecipientBoundaryHeld",
        );
    },
    (contract) => {
      contract.rollbackContract.requiredChecks =
        contract.rollbackContract.requiredChecks.filter(
          (check) => check !== "conversationSegmentScopeBoundaryHeld",
        );
    },
    (contract) => {
      delete contract.rollbackContract.requiredChecks;
    },
    (contract) => {
      delete contract.postApplyChecks[0].expectedEvidence
        .account_deletion_auth_fk_contract_count;
    },
    (contract) => {
      delete contract.postApplyChecks[0].expectedEvidence
        .successor_feature_flags_off_count;
    },
    (contract) => {
      delete contract.postApplyChecks[0].expectedEvidence
        .wedding_court_auth_delete_fk_count;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .chat_feedback_auth_delete_fk_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .payment_ledger_fk_contract_count = 2;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .couple_plan_change_auth_user_fk_count = 3;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .couple_plan_change_terminal_event_count = 2;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .couple_plan_change_journey_write_fence_count = 3;
    },
    (contract) => {
      delete contract.postApplyChecks[0].expectedEvidence
        .couple_plan_change_write_boundary_trigger_count;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .couple_plan_change_display_guard_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .couple_plan_change_idempotency_index_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .chat_partner_recipient_trigger_count = 0;
    },
    (contract) => {
      delete contract.postApplyChecks[0].expectedEvidence
        .chat_partner_recipient_select_policy_count;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .chat_partner_recipient_insert_policy_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .conversation_segment_scope_fk_count = 1;
    },
    (contract) => {
      delete contract.postApplyChecks[0].expectedEvidence
        .conversation_segment_active_index_count;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .conversation_segment_rls_policy_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .conversation_segment_rpc_acl_count = 0;
    },
  ]) {
    expectBlocked(
      readyStaticFixture({ mutateContract }).root,
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
    );
  }
});
