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
  cpSync(
    join(REPO_ROOT, "supabase", "release-contracts"),
    join(root, "supabase", "release-contracts"),
    { recursive: true },
  );
  const manifestPath = join(root, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const mutated = mutate(manifest) ?? manifest;
  const baselinePath = join(root, mutated.remoteBaselineContract.file);
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const appliedHeadIndex = mutated.expandMigrations.findIndex(
    (entry) => entry.file.startsWith(`${baseline.observedRemoteHead}_`),
  );
  if (appliedHeadIndex >= 0) {
    const pending = mutated.expandMigrations.slice(appliedHeadIndex + 1);
    baseline.release = mutated.release;
    baseline.projectRef = mutated.projectRef;
    baseline.predecessorHead = mutated.requiredRemoteHead;
    baseline.appliedSuccessorMigrations = mutated.expandMigrations.slice(0, appliedHeadIndex + 1);
    baseline.pendingSuccessorCount = pending.length;
    baseline.firstPendingSuccessor = pending.at(0)?.file.slice(0, 14) ?? null;
    baseline.lastPendingSuccessor = pending.at(-1)?.file.slice(0, 14) ?? null;
    const baselineText = `${JSON.stringify(baseline, null, 2)}\n`;
    writeFileSync(baselinePath, baselineText);
    mutated.remoteBaselineContract.sha256 = createHash("sha256")
      .update(baselineText, "utf8")
      .digest("hex");
  }
  writeFileSync(manifestPath, `${JSON.stringify(mutated, null, 2)}\n`);
  return root;
}

const BACKUP_CONTRACT = { id: "amora-db-current-baseline", version: 1 };

const ACTIVE_AMORA_SECURITY_MIGRATIONS = Object.freeze([
  "20260811230000_amora_provider_egress_grant.sql",
  "20260812030000_couple_invite_replay_hardening.sql",
  "20260812090000_amora_server_only_chat_ingest.sql",
  "20260812100000_amora_today_one_decision_follow_up.sql",
  "20260812120000_vendor_inquiry_handoff.sql",
  "20260812130000_amora_action_follow_up_v2.sql",
  "20260812140000_amora_mediation_outcome_follow_up.sql",
  "20260814120000_amora_explicit_action_execution.sql",
  "20260814130000_amora_core_criterion.sql",
  "20260814140000_amora_couple_core_criterion.sql",
  "20260815120000_amora_action_outcome_feedback.sql",
  "20260815130000_amora_first_use_action_promotions.sql",
  "20260816120000_amora_preparation_topic_message_refs.sql",
  "20260816130000_amora_first_use_deterministic_proposal.sql",
  "20260816140000_amora_first_use_deterministic_application.sql",
  "20260816150000_amora_provider_backed_add_action_application.sql",
  "20260816160000_amora_atomic_action_href_parity.sql",
  "20260816170000_amora_booking_outcome_provenance.sql",
  "20260816180000_amora_neutral_preparation_space.sql",
  "20260816190000_amora_preparation_catch_up.sql",
  "20260818100000_restore_signup_profile_trigger.sql",
  "20260818110000_restore_couple_invite_nullable_contract.sql",
  "20260818120000_amora_message_ref_http_conflicts.sql",
  "20260818130000_amora_preparation_notes_read.sql",
  "20260818140000_amora_mediation_private_draft_boundary.sql",
  "20260818150000_amora_topic_criterion_action_context.sql",
  "20260818160000_amora_shared_action_receipt_trigger.sql",
]);

const GATED_COUPLE_INVITE_PHASE_B_MIGRATION =
  "20260812031000_revoke_legacy_join_couple.sql";

const DECISION_FOLLOW_UP_MIGRATION = Object.freeze({
  file: "20260812100000_amora_today_one_decision_follow_up.sql",
  sha256: "65affa3d0fb9d9d2c29e5681b93deadfb079acd0f6b6e37aa3f33a3f99b5ab4e",
});
const VENDOR_INQUIRY_MIGRATION = Object.freeze({
  file: "20260812120000_vendor_inquiry_handoff.sql",
  sha256: "4d1e290e828ef958e92dd038dc3ef2d33dd37e20241dc83768f391c50329cd89",
});
const ACTION_FOLLOW_UP_V2_MIGRATION = Object.freeze({
  file: "20260812130000_amora_action_follow_up_v2.sql",
  sha256: "1048132e7328e6d397baee848ce0f79ac00585a168f5381d4ce9202defc61657",
});
const MEDIATION_OUTCOME_FOLLOW_UP_MIGRATION = Object.freeze({
  file: "20260812140000_amora_mediation_outcome_follow_up.sql",
  sha256: "150d7e221469b971fc97302aae5b854d8a62b526199428b4be312a5ecedadd79",
});
const EXPLICIT_ACTION_EXECUTION_MIGRATION = Object.freeze({
  file: "20260814120000_amora_explicit_action_execution.sql",
  sha256: "c3f63b696f489f2a58d4537aa2a293624d31b7ba6a99afaa22e41b47ff9f3a38",
});
const AMORA_CORE_CRITERION_MIGRATION = Object.freeze({
  file: "20260814130000_amora_core_criterion.sql",
  sha256: "fe3c37e8c70e22e09f06151f6d866cc2e2c8a5702e7a8e5a2340d7a3fc241fa1",
});
const AMORA_COUPLE_CORE_CRITERION_MIGRATION = Object.freeze({
  file: "20260814140000_amora_couple_core_criterion.sql",
  sha256: "f247c77641223f216df9f265ec79a36b79991e2debcce464ad55f57601f29160",
});
const AMORA_ACTION_OUTCOME_FEEDBACK_MIGRATION = Object.freeze({
  file: "20260815120000_amora_action_outcome_feedback.sql",
  sha256: "d6dbde267bc04222d969ee98b1cd733add5f09644b66ab4548aeb8304e611f01",
});
const AMORA_FIRST_USE_ACTION_PROMOTIONS_MIGRATION = Object.freeze({
  file: "20260815130000_amora_first_use_action_promotions.sql",
  sha256: "c4808671308c2ed0bb2be0a7c82b894b69c3d20c63f4547abb3bd61d64511090",
});
const AMORA_PREPARATION_TOPIC_MESSAGE_REFS_MIGRATION = Object.freeze({
  file: "20260816120000_amora_preparation_topic_message_refs.sql",
  sha256: "7da41bdbee2476a28bc93c8dd3921816e0971af3f8d2ef2f94421dfd5756a217",
});
const AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_MIGRATION = Object.freeze({
  file: "20260816130000_amora_first_use_deterministic_proposal.sql",
  sha256: "dfc943280ac6ecc1ce21503609933322f8b9f0a12c671319bef4b674b835f786",
});
const AMORA_FIRST_USE_DETERMINISTIC_APPLICATION_MIGRATION = Object.freeze({
  file: "20260816140000_amora_first_use_deterministic_application.sql",
  sha256: "a5a184155366fbdcb0b2ad2ded922dc6ce0b3cac480f9e45ae52e5bd0a0084a6",
});
const AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_MIGRATION = Object.freeze({
  file: "20260816150000_amora_provider_backed_add_action_application.sql",
  sha256: "1e7870be4051c4fd9017d6909b453739e8eda9fdd4100339d47d9a79d7777483",
});
const AMORA_ATOMIC_ACTION_HREF_PARITY_MIGRATION = Object.freeze({
  file: "20260816160000_amora_atomic_action_href_parity.sql",
  sha256: "afe0eabc7cc774d219715224906bfd328e0df011bb76f9caea69615a93a4af7c",
});
const AMORA_BOOKING_OUTCOME_PROVENANCE_MIGRATION = Object.freeze({
  file: "20260816170000_amora_booking_outcome_provenance.sql",
  sha256: "9b673303585070facadb062d042c1cd23342cafe368612037571597ff72f5457",
});
const AMORA_NEUTRAL_PREPARATION_SPACE_MIGRATION = Object.freeze({
  file: "20260816180000_amora_neutral_preparation_space.sql",
  sha256: "ce00fb20715ce45d1b7edccb8ea28c1af35e2dee9c3692552696f892639c2867",
});
const AMORA_PREPARATION_CATCH_UP_MIGRATION = Object.freeze({
  file: "20260816190000_amora_preparation_catch_up.sql",
  sha256: "637d56cfba243e25f6488d1aaf08f1873b9d4aad30bb54f7cedc3870b1eb9cce",
});
const SIGNUP_PROFILE_TRIGGER_RESTORE_MIGRATION = Object.freeze({
  file: "20260818100000_restore_signup_profile_trigger.sql",
  sha256: "16fa1a4af7832c69e937faeaff7f88115699e377e1445f9c4cdc524b86f4a53a",
});
const COUPLE_INVITE_NULLABLE_RESTORE_MIGRATION = Object.freeze({
  file: "20260818110000_restore_couple_invite_nullable_contract.sql",
  sha256: "b4291e779566b74ee986e634bace40b986d5b03598b53691fb99538d50a94324",
});
const AMORA_MESSAGE_REF_HTTP_CONFLICTS_MIGRATION = Object.freeze({
  file: "20260818120000_amora_message_ref_http_conflicts.sql",
  sha256: "c3e269594e956cc96cb19b3c282c5c1865178baa6b468c944831de8d9b389358",
});
const AMORA_PREPARATION_NOTES_READ_MIGRATION = Object.freeze({
  file: "20260818130000_amora_preparation_notes_read.sql",
  sha256: "022707a3db67b6b7e7e06280011d210e184b2fd1d911947d416758a334a0f9d4",
});
const AMORA_MEDIATION_PRIVATE_DRAFT_BOUNDARY_MIGRATION = Object.freeze({
  file: "20260818140000_amora_mediation_private_draft_boundary.sql",
  sha256: "6aa23631c3457355d2c4203c4b245598b8c5b88690c20b7275d018c0bf5596c8",
});
const AMORA_TOPIC_CRITERION_ACTION_CONTEXT_MIGRATION = Object.freeze({
  file: "20260818150000_amora_topic_criterion_action_context.sql",
  sha256: "0018ec4033838f2f0bd09d7b141608e244f24149a502c8f3263eccfe72750f4b",
});
const AMORA_SHARED_ACTION_RECEIPT_TRIGGER_MIGRATION = Object.freeze({
  file: "20260818160000_amora_shared_action_receipt_trigger.sql",
  sha256: "4046e4d2affd765d04bb002fd7a20e144a2f92e714e1aacf50d2adb47a5d5198",
});

const ACTIVE_AMORA_SECURITY_CREATED_TABLES = Object.freeze([
  "amora_action_follow_up_cards_v2",
  "amora_action_follow_up_outcomes_v2",
  "amora_couple_core_criterion_acceptances",
  "amora_couple_core_criterion_proposals",
  "amora_first_use_action_promotions",
  "amora_first_use_action_proposal_bindings",
  "amora_mediation_outcome_follow_up_cards",
  "amora_mediation_outcome_follow_up_receipts",
  "amora_mediation_private_safety_holds",
  "amora_preparation_catch_up_items",
  "amora_preparation_catch_up_receipts",
  "amora_preparation_topic_message_refs",
  "amora_provider_egress_grants",
  "amora_provider_runtime_control",
  "couple_invite_join_attempts",
  "couple_invite_join_runtime_state",
  "couple_invite_redemptions",
]);

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
  assert.equal(result.remoteBaseline.observedRemoteHead, "20260727090000");
  assert.equal(result.remoteBaseline.appliedMigrations.length, 32);
  assert.equal(result.pendingMigrations.length, 78);
  assert.equal(
    result.pendingMigrations.at(0)?.file,
    "20260730100000_retire_undisclosed_community_agents.sql",
  );
});

test("the Production remote baseline pin rejects semantic drift even after re-hashing", () => {
  const root = fixture((manifest) => manifest);
  const manifestPath = join(root, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const baselinePath = join(root, manifest.remoteBaselineContract.file);
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  baseline.pendingSuccessorCount += 1;
  const baselineText = `${JSON.stringify(baseline, null, 2)}\n`;
  writeFileSync(baselinePath, baselineText, "utf8");
  manifest.remoteBaselineContract.sha256 = createHash("sha256")
    .update(baselineText, "utf8")
    .digest("hex");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  expectBlocked(root, "REMOTE_BASELINE_CONTRACT_INVALID");
});

test("명시적 결정 후속 migration을 exact hash로 고정해도 배포 차단과 missing evidence를 보존한다", () => {
  const root = fixture((manifest) => {
    manifest.expandMigrations = manifest.expandMigrations.filter(
      (entry) => entry.file !== VENDOR_INQUIRY_MIGRATION.file,
    );
    return manifest;
  });
  rmSync(
    join(root, "supabase", "migrations", VENDOR_INQUIRY_MIGRATION.file),
    { force: true },
  );
  const result = validateSuccessorReleaseContract({ repoRoot: root });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === DECISION_FOLLOW_UP_MIGRATION.file,
    ),
    DECISION_FOLLOW_UP_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("업체 문의 handoff migration을 exact hash로 고정해도 배포 차단을 보존한다", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === VENDOR_INQUIRY_MIGRATION.file,
    ),
    VENDOR_INQUIRY_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
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

test("the operations plan classifies every exact pending successor before hosted staging", () => {
  const manifest = JSON.parse(readFileSync(
    join(REPO_ROOT, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH),
    "utf8",
  ));
  const baseline = JSON.parse(readFileSync(
    join(REPO_ROOT, manifest.remoteBaselineContract.file),
    "utf8",
  ));
  const operations = readFileSync(
    join(
      REPO_ROOT,
      "docs",
      "operations",
      "SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md",
    ),
    "utf8",
  );
  const begin = "<!-- AMORA:PENDING-SCOPE-CLASSIFICATION:BEGIN -->";
  const end = "<!-- AMORA:PENDING-SCOPE-CLASSIFICATION:END -->";
  const beginIndex = operations.indexOf(begin);
  const endIndex = operations.indexOf(end, beginIndex + begin.length);
  assert.notEqual(beginIndex, -1, "pending classification begin marker is missing");
  assert.notEqual(endIndex, -1, "pending classification end marker is missing");

  const block = operations.slice(beginIndex, endIndex);
  const rows = [...block.matchAll(
    /^\| `([^`]+\.sql)` \| `([0-9a-f]{64})` \| `(AMR-[A-Z0-9]+)` \| `(active_dependency|integrity_hardening|unrelated_feature_off|parked_product_surface)` \| `([^`]+)` \| `([a-z][a-z0-9_-]*:[a-z0-9_-]+)` \|$/gmu,
  )].map((match) => ({
    file: match[1],
    sha256: match[2],
    owner: match[3],
    disposition: match[4],
    flag: match[5],
    probe: match[6],
  }));
  const appliedFiles = new Set(
    baseline.appliedSuccessorMigrations.map((entry) => entry.file),
  );
  const pending = manifest.expandMigrations.filter(
    (entry) => !appliedFiles.has(entry.file),
  );

  assert.equal(rows.length, pending.length);
  assert.deepEqual(
    rows.map(({ file, sha256 }) => ({ file, sha256 })),
    pending,
  );
  assert.equal(new Set(rows.map((row) => row.file)).size, pending.length);
  assert.deepEqual(
    new Set(rows.map((row) => row.disposition)),
    new Set([
      "active_dependency",
      "integrity_hardening",
      "unrelated_feature_off",
      "parked_product_surface",
    ]),
  );
  for (const row of rows) {
    assert.ok(
      row.flag === "always_on" || /^[A-Z][A-Z0-9_]+=(?:false|true)$/u.test(row.flag),
      `${row.file} has no exact runtime flag boundary`,
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

test("action follow-up v2 migration stays exact-hash pinned and deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === ACTION_FOLLOW_UP_V2_MIGRATION.file,
    ),
    ACTION_FOLLOW_UP_V2_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("recipient-private mediation outcome migration stays exact-hash pinned and deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === MEDIATION_OUTCOME_FOLLOW_UP_MIGRATION.file,
    ),
    MEDIATION_OUTCOME_FOLLOW_UP_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("explicit home-action execution migration stays exact-hash pinned and deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === EXPLICIT_ACTION_EXECUTION_MIGRATION.file,
    ),
    EXPLICIT_ACTION_EXECUTION_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("owner-private core criterion migration stays exact-hash pinned and deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === AMORA_CORE_CRITERION_MIGRATION.file,
    ),
    AMORA_CORE_CRITERION_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("couple-confirmed core criterion migration stays exact-hash pinned and deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === AMORA_COUPLE_CORE_CRITERION_MIGRATION.file,
    ),
    AMORA_COUPLE_CORE_CRITERION_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("owner-private action outcome feedback migration stays exact-hash pinned and deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === AMORA_ACTION_OUTCOME_FEEDBACK_MIGRATION.file,
    ),
    AMORA_ACTION_OUTCOME_FEEDBACK_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("first-use action promotion provenance migration stays exact-hash pinned and deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === AMORA_FIRST_USE_ACTION_PROMOTIONS_MIGRATION.file,
    ),
    AMORA_FIRST_USE_ACTION_PROMOTIONS_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("preparation topic message references migration stays exact-hash pinned and deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({
    repoRoot: fixture((manifest) => manifest),
  });
  assert.deepEqual(
    result.manifest.expandMigrations.find(
      (entry) => entry.file === AMORA_PREPARATION_TOPIC_MESSAGE_REFS_MIGRATION.file,
    ),
    AMORA_PREPARATION_TOPIC_MESSAGE_REFS_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });
});

test("shared-action receipt trigger is the terminal successor migration and remains deployment-blocked", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.equal(result.manifest.expandMigrations.length, 110);
  assert.deepEqual(
    result.manifest.expandMigrations.at(-1),
    AMORA_SHARED_ACTION_RECEIPT_TRIGGER_MIGRATION,
  );
  assert.deepEqual(
    result.manifest.expandMigrations.at(-2),
    AMORA_TOPIC_CRITERION_ACTION_CONTEXT_MIGRATION,
  );
  assert.deepEqual(
    result.manifest.expandMigrations.at(-3),
    AMORA_MEDIATION_PRIVATE_DRAFT_BOUNDARY_MIGRATION,
  );
  assert.deepEqual(
    result.manifest.expandMigrations.at(-4),
    AMORA_PREPARATION_NOTES_READ_MIGRATION,
  );
  assert.deepEqual(
    result.manifest.expandMigrations.at(-5),
    AMORA_MESSAGE_REF_HTTP_CONFLICTS_MIGRATION,
  );
  assert.deepEqual(
    result.manifest.expandMigrations.at(-6),
    COUPLE_INVITE_NULLABLE_RESTORE_MIGRATION,
  );
  assert.deepEqual(
    result.manifest.expandMigrations.at(-7),
    SIGNUP_PROFILE_TRIGGER_RESTORE_MIGRATION,
  );
  assert.deepEqual(
    result.manifest.expandMigrations.at(-8),
    AMORA_PREPARATION_CATCH_UP_MIGRATION,
  );
  assert.deepEqual(
    result.manifest.expandMigrations.at(-9),
    AMORA_NEUTRAL_PREPARATION_SPACE_MIGRATION,
  );
  assert.equal(result.pendingMigrations.length, 78);
  assert.deepEqual(
    result.pendingMigrations.at(-1),
    AMORA_SHARED_ACTION_RECEIPT_TRIGGER_MIGRATION,
  );
  assert.equal(result.remoteBaseline.contract.pendingSuccessorCount, 78);
  assert.equal(
    result.remoteBaseline.contract.lastPendingSuccessor,
    "20260818160000",
  );
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.manifest.status, "deployment_blocked");
});

test("provider-free first-use proposal adds no backup table and exposes one service-role-only finalizer", () => {
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, [
      AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_MIGRATION,
    ]),
    [],
  );

  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_MIGRATION.file,
    ),
    "utf8",
  );
  const createSignature = String.raw`public\.finalize_amora_first_use_action_proposal_v1\s*\(\s*p_couple_id\s+uuid\s*,\s*p_owner_user_id\s+uuid\s*,\s*p_shared_user_message_id\s+uuid\s*,\s*p_chat_request_key\s+text\s*,\s*p_chat_claim_attempt_count\s+integer\s*,\s*p_expected_privacy_epoch\s+bigint\s*\)`;
  const aclSignature = String.raw`public\.finalize_amora_first_use_action_proposal_v1\s*\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*integer\s*,\s*bigint\s*\)`;
  assert.match(
    sql,
    new RegExp(
      String.raw`CREATE\s+FUNCTION\s+${createSignature}[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*pg_catalog\s*,\s*public`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${aclSignature}\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${aclSignature}\s+TO\s+service_role`,
      "i",
    ),
  );
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.ai_interactions_log/i);
});

test("provider-free first-use application adds no backup table and exposes one service-role-only finalizer", () => {
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, [
      AMORA_FIRST_USE_DETERMINISTIC_APPLICATION_MIGRATION,
    ]),
    [],
  );

  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_FIRST_USE_DETERMINISTIC_APPLICATION_MIGRATION.file,
    ),
    "utf8",
  );
  const createSignature = String.raw`public\.finalize_amora_first_use_action_application_v1\s*\(\s*p_couple_id\s+uuid\s*,\s*p_actor_user_id\s+uuid\s*,\s*p_source_proposal_message_id\s+uuid\s*,\s*p_confirmation_message_id\s+uuid\s*,\s*p_chat_request_key\s+text\s*,\s*p_chat_claim_attempt_count\s+integer\s*,\s*p_expected_privacy_epoch\s+bigint\s*\)`;
  const aclSignature = String.raw`public\.finalize_amora_first_use_action_application_v1\s*\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*integer\s*,\s*bigint\s*\)`;
  assert.match(
    sql,
    new RegExp(
      String.raw`CREATE\s+FUNCTION\s+${createSignature}[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*pg_catalog\s*,\s*public`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${aclSignature}\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${aclSignature}\s+TO\s+service_role`,
      "i",
    ),
  );
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.ai_interactions_log/i);
});

test("provider-backed exact add-action approval adds no backup table and exposes one service-role-only finalizer", () => {
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, [
      AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_MIGRATION,
    ]),
    [],
  );

  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_MIGRATION.file,
    ),
    "utf8",
  );
  const createSignature = String.raw`public\.finalize_amora_provider_backed_add_action_application_v1\s*\(\s*p_couple_id\s+uuid\s*,\s*p_actor_user_id\s+uuid\s*,\s*p_source_proposal_message_id\s+uuid\s*,\s*p_confirmation_message_id\s+uuid\s*,\s*p_chat_request_key\s+text\s*,\s*p_chat_claim_attempt_count\s+integer\s*,\s*p_expected_privacy_epoch\s+bigint\s*\)`;
  const aclSignature = String.raw`public\.finalize_amora_provider_backed_add_action_application_v1\s*\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*integer\s*,\s*bigint\s*\)`;
  assert.match(
    sql,
    new RegExp(
      String.raw`CREATE\s+FUNCTION\s+${createSignature}[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*pg_catalog\s*,\s*public`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${aclSignature}\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${aclSignature}\s+TO\s+service_role`,
      "i",
    ),
  );
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.ai_interactions_log/i);
});

test("atomic action href parity adds no backup table and postchecks private/public dispatcher ACLs and canonical values", () => {
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, [
      AMORA_ATOMIC_ACTION_HREF_PARITY_MIGRATION,
    ]),
    [],
  );

  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_ATOMIC_ACTION_HREF_PARITY_MIGRATION.file,
    ),
    "utf8",
  );
  const privateSignature = String.raw`public\.apply_amora_atomic_tool_execution_pre_shared_revision\s*\(\s*uuid\s*,\s*text\s*,\s*text\s*,\s*integer\s*,\s*text\s*,\s*jsonb\s*,\s*jsonb\s*,\s*jsonb\s*\)`;
  assert.match(
    sql,
    new RegExp(String.raw`ALTER\s+FUNCTION\s+${privateSignature}\s+OWNER\s+TO\s+postgres`, "i"),
  );
  assert.match(
    sql,
    new RegExp(
      String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${privateSignature}\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`,
      "i",
    ),
  );
  assert.match(sql, /WHEN v_value ->> 'categoryKey' IN \('mc', 'gift'\) THEN '\/wedding\/chat'/);
  assert.match(sql, /char_length\(btrim\(regexp_replace\([\s\S]*?p_tool_input ->> 'title'/);
  assert.match(sql, /NULLIF\(left\(btrim\(regexp_replace\([\s\S]*?p_tool_input ->> 'description'/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(
      sql,
      new RegExp(
        String.raw`pg_catalog\.has_function_privilege\(\s*'${role}'\s*,\s*private_dispatcher\s*,\s*'EXECUTE'\s*\)`,
        "i",
      ),
    );
  }
  for (const role of ["anon", "authenticated"]) {
    assert.match(
      sql,
      new RegExp(
        String.raw`pg_catalog\.has_function_privilege\(\s*'${role}'\s*,\s*public_dispatcher\s*,\s*'EXECUTE'\s*\)`,
        "i",
      ),
    );
  }
  assert.match(
    sql,
    /NOT pg_catalog\.has_function_privilege\(\s*'service_role', public_dispatcher, 'EXECUTE'\s*\)/i,
  );
  assert.match(sql, /position\(old_href_fragment IN private_definition\) <> 0/i);
  assert.match(
    sql,
    /length\(private_definition\)[\s\S]*?replace\(private_definition, new_href_fragment, ''\)[\s\S]*?IS DISTINCT FROM length\(new_href_fragment\)/i,
  );
  assert.match(sql, /AMORA_ATOMIC_ACTION_HREF_PARITY_POSTCONDITION_FAILED/);
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

test("preparation notes read is exact-hash pinned and service-role-only", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(result.manifest.expandMigrations.at(-4), AMORA_PREPARATION_NOTES_READ_MIGRATION);
  const sql = readFileSync(
    join(REPO_ROOT, "supabase", "migrations", AMORA_PREPARATION_NOTES_READ_MIGRATION.file),
    "utf8",
  );
  const signature = String.raw`public\.list_amora_preparation_notes_v1\s*\(\s*uuid\s*,\s*uuid\s*,\s*bigint\s*,\s*text\s*,\s*timestamptz\s*,\s*timestamptz\s*,\s*uuid\s*,\s*integer\s*\)`;
  assert.match(sql, /IF auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
  assert.match(sql, new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${signature}\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`, "i"));
  assert.match(sql, new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${signature}\s+TO\s+service_role`, "i"));
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

test("mediation private-draft boundary is exact-hash pinned and fail-closed", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(
    result.manifest.expandMigrations.at(-3),
    AMORA_MEDIATION_PRIVATE_DRAFT_BOUNDARY_MIGRATION,
  );
  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_MEDIATION_PRIVATE_DRAFT_BOUNDARY_MIGRATION.file,
    ),
    "utf8",
  );
  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enforce_amora_mediation_private_draft_boundary\s*\(\s*\)/i);
  assert.match(sql, /AFTER\s+INSERT\s+OR\s+UPDATE\s+OF[\s\S]*?ON\s+public\.chat_messages/i);
  assert.match(sql, /mediation_source_draft_id/i);
  assert.match(sql, /mediation_draft_roster_fingerprint/i);
  assert.match(sql, /v_source\.couple_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.couple_id/i);
  assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.enforce_amora_mediation_private_draft_boundary\s*\(\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

test("topic criterion action context is exact-hash pinned and trigger-only", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(
    result.manifest.expandMigrations.at(-2),
    AMORA_TOPIC_CRITERION_ACTION_CONTEXT_MIGRATION,
  );
  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_TOPIC_CRITERION_ACTION_CONTEXT_MIGRATION.file,
    ),
    "utf8",
  );
  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.seal_amora_topic_criterion_action_context_v1\s*\(\s*\)/i);
  assert.match(sql, /BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.amora_actions/i);
  assert.match(sql, /public\.read_amora_couple_core_criterion_v1\s*\(/i);
  assert.match(sql, /amora_topic_criterion_context_v1/i);
  assert.match(sql, /criterionDecisionId/i);
  assert.doesNotMatch(sql, /criterionValue|confirmedCriterion|chosen_value/i);
  assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.seal_amora_topic_criterion_action_context_v1\s*\(\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.doesNotMatch(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.seal_amora_topic_criterion_action_context_v1/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

test("shared-action application receipts bypass only the canonical terminal trigger shape", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(
    result.manifest.expandMigrations.at(-1),
    AMORA_SHARED_ACTION_RECEIPT_TRIGGER_MIGRATION,
  );
  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_SHARED_ACTION_RECEIPT_TRIGGER_MIGRATION.file,
    ),
    "utf8",
  );
  assert.match(sql, /server_authoritative_first_use_action_application/i);
  assert.match(sql, /server_authoritative_provider_backed_add_action_application/i);
  assert.match(sql, /NEW\.metadata\s+\?&\s+v_receipt_keys/i);
  assert.match(sql, /NEW\.metadata\s+-\s+v_receipt_keys\s*=\s*'\{\}'::jsonb/i);
  assert.match(sql, /NEW\.content\s*=\s*NEW\.metadata\s*#>>\s*'\{toolResults,0,displayMessage\}'/i);
  assert.match(sql, /UPDATE\s+public\.amora_shared_action_application_claims/i);
  assert.match(sql, /AMORA_SHARED_ACTION_CONFIRMATION_INVALID/i);
  assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.bind_amora_shared_action_application\s*\(\s*\)[\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

test("booking outcome provenance is exact-hash pinned and service-role-only", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(result.manifest.expandMigrations.at(-10), AMORA_BOOKING_OUTCOME_PROVENANCE_MIGRATION);
  assert.equal(result.deploymentBlocked, true);
  assert.deepEqual(result.manifest.deploymentEvidence, {
    hostedStaging: "missing",
    backup: "missing",
    hostedRestore: "missing",
    storage: "missing",
    finalizer: "missing",
  });

  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_BOOKING_OUTCOME_PROVENANCE_MIGRATION.file,
    ),
    "utf8",
  );
  const signature = String.raw`public\.complete_amora_booking_outcome_atomic\s*\(\s*uuid\s*,\s*uuid\s*,\s*numeric\s*,\s*numeric\s*,\s*integer\s*,\s*text\s*,\s*boolean\s*\)`;
  assert.match(
    sql,
    new RegExp(
      String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${signature}\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${signature}\s+TO\s+service_role`,
      "i",
    ),
  );
  assert.match(sql, /IF auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
  assert.match(
    sql,
    /source_actor_role\s*=\s*CASE[\s\S]*?ELSE v_actor_role/i,
  );
  assert.match(sql, /'actor_profile_id'[\s\S]*?p_customer_id::text/i);
  assert.match(sql, /'outcome_provenance_version'\s*,\s*1/i);
  assert.match(
    sql,
    /user_confirmed_at\s*=\s*CASE[\s\S]*?ELSE v_confirmed_at[\s\S]*?decided_at\s*=\s*CASE[\s\S]*?ELSE v_confirmed_at/i,
  );
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

test("neutral preparation space is the terminal exact-hash migration and keeps membership compatibility private", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(
    result.manifest.expandMigrations.at(-9),
    AMORA_NEUTRAL_PREPARATION_SPACE_MIGRATION,
  );
  assert.equal(result.deploymentBlocked, true);

  const sql = readFileSync(
    join(
      REPO_ROOT,
      "supabase",
      "migrations",
      AMORA_NEUTRAL_PREPARATION_SPACE_MIGRATION.file,
    ),
    "utf8",
  );
  const createSignature = String.raw`public\.create_neutral_preparation_space_for_current_user\s*\(\s*\)`;
  const joinSignature = String.raw`public\.join_neutral_preparation_space_server\s*\(\s*uuid\s*,\s*text\s*\)`;
  assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+member_model_version\s+smallint\s+NOT\s+NULL\s+DEFAULT\s+1/i);
  assert.match(sql, /CHECK\s*\(member_model_version\s+IN\s*\(1,\s*2\)\)/i);
  assert.match(sql, /CREATE\s+TRIGGER\s+trg_enforce_couple_member_model_version/i);
  assert.match(sql, new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${createSignature}\s+TO\s+authenticated`, "i"));
  assert.match(sql, new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${joinSignature}\s+TO\s+service_role`, "i"));
  assert.match(sql, /RETURN\s+\(v_result\s+-\s+'role'\)\s*\|\|\s*jsonb_build_object\('member_model_version',\s*2\)/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

test("preparation catch-up pins service-only storage, finalizer ACL, and private actor binding", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(
    result.manifest.expandMigrations.at(-8),
    AMORA_PREPARATION_CATCH_UP_MIGRATION,
  );
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, [AMORA_PREPARATION_CATCH_UP_MIGRATION]),
    ["amora_preparation_catch_up_items", "amora_preparation_catch_up_receipts"],
  );

  const sql = readFileSync(
    join(REPO_ROOT, "supabase", "migrations", AMORA_PREPARATION_CATCH_UP_MIGRATION.file),
    "utf8",
  );
  const rpcSignature = String.raw`public\.finalize_amora_preparation_catch_up_v1\s*\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*bigint\s*,\s*jsonb\s*\)`;
  for (const table of [
    "amora_preparation_catch_up_receipts",
    "amora_preparation_catch_up_items",
  ]) {
    assert.match(
      sql,
      new RegExp(String.raw`ALTER\s+TABLE\s+public\.${table}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`, "i"),
    );
    assert.match(
      sql,
      new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+TABLE\s+public\.${table}[\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`, "i"),
    );
  }
  assert.match(
    sql,
    new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${rpcSignature}\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role`, "i"),
  );
  assert.match(
    sql,
    new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${rpcSignature}\s+TO\s+service_role`, "i"),
  );
  assert.match(sql, /category\s+IS\s+DISTINCT\s+FROM\s+'preparation_catch_up'/i);
  assert.match(sql, /metadata\s*->>\s*'actor_profile_id'\s*=\s*auth\.uid\(\)::text/i);
});

test("signup profile trigger restoration is exact-hash pinned and restores only the fail-closed trigger contract", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(
    result.manifest.expandMigrations.at(-7),
    SIGNUP_PROFILE_TRIGGER_RESTORE_MIGRATION,
  );
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, [SIGNUP_PROFILE_TRIGGER_RESTORE_MIGRATION]),
    [],
  );

  const sql = readFileSync(
    join(REPO_ROOT, "supabase", "migrations", SIGNUP_PROFILE_TRIGGER_RESTORE_MIGRATION.file),
    "utf8",
  );
  assert.match(sql, /^BEGIN;/i);
  assert.match(sql, /COMMIT;\s*$/i);
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.create_profile_on_signup\s*\(\s*\)[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i,
  );
  assert.match(
    sql,
    /CREATE\s+TRIGGER\s+on_auth_user_created\s+AFTER\s+INSERT\s+ON\s+auth\.users[\s\S]*?EXECUTE\s+FUNCTION\s+public\.create_profile_on_signup\s*\(\s*\)/i,
  );
  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.create_profile_on_signup\s*\(\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
  assert.match(sql, /SIGNUP_PROFILE_TRIGGER_RESTORE_POSTCONDITION_FAILED/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.profiles\s*\([^)]*\)\s*SELECT/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

test("couple invite nullable restoration is exact-hash pinned and changes no row data", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.deepEqual(
    result.manifest.expandMigrations.at(-6),
    COUPLE_INVITE_NULLABLE_RESTORE_MIGRATION,
  );
  assert.deepEqual(
    createdPublicTablesForMigrations(REPO_ROOT, [COUPLE_INVITE_NULLABLE_RESTORE_MIGRATION]),
    [],
  );

  const sql = readFileSync(
    join(REPO_ROOT, "supabase", "migrations", COUPLE_INVITE_NULLABLE_RESTORE_MIGRATION.file),
    "utf8",
  );
  assert.match(sql, /^BEGIN;/i);
  assert.match(sql, /COMMIT;\s*$/i);
  assert.match(
    sql,
    /ALTER\s+TABLE\s+public\.couples\s+ALTER\s+COLUMN\s+invite_code\s+DROP\s+NOT\s+NULL/i,
  );
  assert.match(sql, /join_couple_invite_core\(uuid,text,text,text\)/i);
  assert.match(sql, /invite_code\[\[:space:\]\]\*\=\[\[:space:\]\]\*NULL/i);
  assert.match(sql, /COUPLE_INVITE_NULLABLE_RESTORE_POSTCONDITION_FAILED/i);
  assert.doesNotMatch(sql, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.couples/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
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
  const remoteBaseline = JSON.parse(readFileSync(
    join(root, manifest.remoteBaselineContract.file),
    "utf8",
  ));
  const releaseVersions = manifest.expandMigrations.map((entry) => entry.file.slice(0, 14));
  const appliedBaselineTables = createdPublicTablesForMigrations(
    root,
    remoteBaseline.appliedSuccessorMigrations,
  );
  const baselineTables = [...new Set([
    ...predecessor.postExpandBackupContract.expectedTables,
    ...appliedBaselineTables,
  ])].sort();
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
        preparation_notes_read_rpc_acl_count: 1,
        mediation_private_draft_boundary_trigger_count: 1,
        topic_criterion_action_context_trigger_count: 1,
        shared_action_receipt_trigger_contract_count: 1,
        signup_profile_trigger_contract_count: 1,
        couple_invite_nullable_contract_count: 1,
        couple_plan_change_auth_user_fk_count: 4,
        couple_plan_change_display_guard_count: 1,
        couple_plan_change_idempotency_index_count: 1,
        couple_plan_change_journey_write_fence_count: 4,
        couple_plan_change_terminal_event_count: 3,
        couple_plan_change_write_boundary_trigger_count: 1,
        successor_created_table_count: createdTables.length,
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
      expectedMigrationHead: remoteBaseline.observedRemoteHead,
      excludedEphemeralTables:
        predecessor.backupContract.excludedEphemeralTables,
      ephemeralRebuildContract:
        predecessor.backupContract.ephemeralRebuildContract,
      expectedCommitBinding: "release-expected-commit",
      expectedOrigin: predecessor.backupContract.expectedOrigin,
      verifier: {
        file: "scripts/vendor-disclosure-db-current-baseline-verify.ps1",
        sha256: "e".repeat(64),
      },
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
      expectedReleaseMigrationBaselineHead: remoteBaseline.observedRemoteHead,
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
    result.pendingMigrations.length,
  );
  assert.equal(
    result.controllerManifest.remoteBaselineMigrations.length,
    result.remoteBaseline.appliedMigrations.length,
  );
  assert.equal(
    result.controllerManifest.backupContract.expectedMigrationHead,
    result.remoteBaseline.observedRemoteHead,
  );
  const migrationFiles = state.manifest.expandMigrations.map(
    (entry) => entry.file,
  );
  const firstSecurityMigration = migrationFiles.indexOf(
    ACTIVE_AMORA_SECURITY_MIGRATIONS[0],
  );
  assert.notEqual(firstSecurityMigration, -1);
  assert.deepEqual(
    migrationFiles.slice(
      firstSecurityMigration,
      firstSecurityMigration + ACTIVE_AMORA_SECURITY_MIGRATIONS.length,
    ),
    ACTIVE_AMORA_SECURITY_MIGRATIONS,
  );
  assert.equal(
    migrationFiles.includes(GATED_COUPLE_INVITE_PHASE_B_MIGRATION),
    false,
  );
  assert.deepEqual(
    state.createdTables.filter((table) =>
      ACTIVE_AMORA_SECURITY_CREATED_TABLES.includes(table)),
    ACTIVE_AMORA_SECURITY_CREATED_TABLES,
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
  for (const table of ACTIVE_AMORA_SECURITY_CREATED_TABLES) {
    assert.ok(
      result.controllerManifest.postExpandBackupContract.expectedTables
        .includes(table),
      `post-expand backup contract omitted ${table}`,
    );
  }
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
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .first_use_deterministic_proposal_rpc_acl_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .first_use_deterministic_application_rpc_acl_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .provider_backed_add_action_application_rpc_acl_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .atomic_action_private_dispatcher_acl_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .atomic_action_public_dispatcher_acl_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .atomic_action_href_whitespace_parity_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .booking_outcome_provenance_rpc_acl_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .booking_outcome_provenance_v1_actor_time_contract_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .neutral_preparation_space_rpc_acl_count,
    2,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .neutral_preparation_space_member_model_contract_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .preparation_catch_up_rpc_acl_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .preparation_catch_up_private_actor_binding_contract_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .preparation_notes_read_rpc_acl_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .mediation_private_draft_boundary_trigger_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .topic_criterion_action_context_trigger_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .shared_action_receipt_trigger_contract_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .signup_profile_trigger_contract_count,
    1,
  );
  assert.equal(
    result.controllerManifest.postApplyChecks[0].expectedEvidence
      .couple_invite_nullable_contract_count,
    1,
  );
});

test("couple invite nullable hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  expectBlocked(
    readyStaticFixture({
      mutateContract(contract) {
        contract.postApplyChecks[0].expectedEvidence
          .couple_invite_nullable_contract_count = 0;
      },
    }).root,
    "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
  );
});

test("signup profile trigger hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  expectBlocked(
    readyStaticFixture({
      mutateContract(contract) {
        contract.postApplyChecks[0].expectedEvidence
          .signup_profile_trigger_contract_count = 0;
      },
    }).root,
    "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
  );
});

test("preparation catch-up ACL과 private actor binding hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  for (const field of [
    "preparation_catch_up_rpc_acl_count",
    "preparation_catch_up_private_actor_binding_contract_count",
  ]) {
    expectBlocked(
      readyStaticFixture({
        mutateContract(contract) {
          contract.postApplyChecks[0].expectedEvidence[field] = 0;
        },
      }).root,
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
    );
  }
});

test("preparation notes read ACL hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  expectBlocked(
    readyStaticFixture({
      mutateContract(contract) {
        contract.postApplyChecks[0].expectedEvidence
          .preparation_notes_read_rpc_acl_count = 0;
      },
    }).root,
    "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
  );
});

test("mediation private-draft boundary hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  expectBlocked(
    readyStaticFixture({
      mutateContract(contract) {
        contract.postApplyChecks[0].expectedEvidence
          .mediation_private_draft_boundary_trigger_count = 0;
      },
    }).root,
    "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
  );
});

test("topic criterion action context hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  expectBlocked(
    readyStaticFixture({
      mutateContract(contract) {
        contract.postApplyChecks[0].expectedEvidence
          .topic_criterion_action_context_trigger_count = 0;
      },
    }).root,
    "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
  );
});

test("shared-action receipt trigger hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  expectBlocked(
    readyStaticFixture({
      mutateContract(contract) {
        contract.postApplyChecks[0].expectedEvidence
          .shared_action_receipt_trigger_contract_count = 0;
      },
    }).root,
    "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
  );
});

test("neutral preparation space ACL과 member-model hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  for (const field of [
    "neutral_preparation_space_rpc_acl_count",
    "neutral_preparation_space_member_model_contract_count",
  ]) {
    expectBlocked(
      readyStaticFixture({
        mutateContract(contract) {
          contract.postApplyChecks[0].expectedEvidence[field] = 0;
        },
      }).root,
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
    );
  }
});

test("booking outcome ACL과 provenance v1 actor-time hosted postcheck가 없으면 controller_ready가 되지 않는다", () => {
  for (const field of [
    "booking_outcome_provenance_rpc_acl_count",
    "booking_outcome_provenance_v1_actor_time_contract_count",
  ]) {
    expectBlocked(
      readyStaticFixture({
        mutateContract(contract) {
          contract.postApplyChecks[0].expectedEvidence
            .booking_outcome_provenance_rpc_acl_count = 1;
          contract.postApplyChecks[0].expectedEvidence
            .booking_outcome_provenance_v1_actor_time_contract_count = 1;
          contract.postApplyChecks[0].expectedEvidence[field] = 0;
        },
      }).root,
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
    );
  }
});

test("successor 또는 account-deletion table을 self-consistent backup list에서 빼도 차단한다", () => {
  for (const omittedTable of [
    "couple_plan_change_requests",
    "account_deletion_jobs",
    ...ACTIVE_AMORA_SECURITY_CREATED_TABLES,
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
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .first_use_deterministic_proposal_rpc_acl_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .first_use_deterministic_application_rpc_acl_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .provider_backed_add_action_application_rpc_acl_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .atomic_action_private_dispatcher_acl_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .atomic_action_public_dispatcher_acl_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .atomic_action_href_whitespace_parity_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .topic_criterion_action_context_trigger_count = 0;
    },
    (contract) => {
      contract.postApplyChecks[0].expectedEvidence
        .shared_action_receipt_trigger_contract_count = 0;
    },
  ]) {
    expectBlocked(
      readyStaticFixture({ mutateContract }).root,
      "SUCCESSOR_CONTROLLER_CONTRACT_INVALID",
    );
  }
});
