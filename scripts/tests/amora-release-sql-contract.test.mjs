import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

const pendingVersions = [
  "20260716090000",
  "20260716091000",
  "20260716092000",
  "20260716093000",
  "20260716094000",
  "20260716095000",
  "20260716096000",
  "20260716097000",
  "20260716098000",
  "20260716099000",
  "20260716100000",
  "20260716102000",
  "20260716103000",
  "20260716104000",
  "20260716105000",
  "20260716106000",
  "20260716107000",
  "20260716108000",
  "20260716109000",
  "20260716110000",
  "20260716111000",
  "20260716112000",
  "20260716113000",
  "20260716114000",
  "20260716115000",
  "20260716116000",
  "20260716117000",
];

const releaseChecks = {
  pre: "supabase/release-checks/amora-engine-v2-20260716-pre.sql",
  post: "supabase/release-checks/amora-engine-v2-20260716-post.sql",
};

const storageArtifacts = {
  inventory:
    "supabase/platform-operations/storage/20260716108000_community_upload_service_fence_inventory.sql",
  apply:
    "supabase/platform-operations/storage/20260716108000_community_upload_service_fence_apply.sql",
  verify:
    "supabase/platform-operations/storage/20260716108000_community_upload_service_fence_verify.sql",
  rollback:
    "supabase/platform-operations/storage/20260716108000_community_upload_service_fence_rollback.sql",
  rollbackVerify:
    "supabase/platform-operations/storage/20260716108000_community_upload_service_fence_rollback_verify.sql",
  emergencyRollback:
    "supabase/platform-operations/storage/20260716108000_community_upload_service_fence_emergency_rollback.sql",
  emergencyRollbackVerify:
    "supabase/platform-operations/storage/20260716108000_community_upload_service_fence_emergency_rollback_verify.sql",
  freezeApply:
    "supabase/platform-operations/storage/20260716108000_storage_global_write_freeze_apply.sql",
  freezeVerify:
    "supabase/platform-operations/storage/20260716108000_storage_global_write_freeze_verify.sql",
  freezeRollback:
    "supabase/platform-operations/storage/20260716108000_storage_global_write_freeze_rollback.sql",
  freezeReleaseCheck:
    "supabase/release-checks/amora-engine-v2-storage-freeze-pre.sql",
  finalReleaseCheck:
    "supabase/release-checks/amora-engine-v2-storage-final-post-push.sql",
};

const storageMutationPoliciesRemovedForFreeze = [
  "Authenticated users can upload chat image",
  "Authenticated users can upload chat images",
  "chat-image couple folder write",
  "chat-image couple folder update",
  "chat-image couple folder delete",
  "chat-image own uploader folder write pf46ue_0",
  "community-images own folder write",
  "community-images own folder update",
  "community-images own folder delete",
  "community-videos own folder write",
  "community-videos own folder update",
  "community-videos own folder delete",
  "업체: 본인 이미지 업로드",
  "업체: 본인 이미지 삭제",
  "업체: 사업자등록증 업로드",
];

const storageReadPoliciesRetainedForBackup = [
  "Anyone can view chat image",
  "Anyone can view chat images",
  "공개: 업체 이미지 조회",
  "서비스: 사업자등록증 조회",
];

const storageFinalPolicy = "chat-image own uploader folder write pf46ue_0";
const storageFinalExpressionSha256 =
  "7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482";

const coreFunctionSignatures = [
  "claim_amora_memory_job(integer,uuid)",
  "accept_amora_mediation(uuid,uuid,uuid,text,text,uuid,text)",
  "set_amora_care_consent(uuid,boolean)",
  "reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)",
  "apply_journey_progress_item_patch(uuid,text,jsonb)",
  "claim_booking_projection_job(uuid,integer)",
  "claim_amora_conflict_check(uuid,text,uuid)",
  "patch_profile_atomic(uuid,text,text,boolean,boolean,boolean,text,boolean,boolean)",
  "claim_community_upload_session(uuid,uuid,uuid,timestamp with time zone)",
  "complete_vendor_booking_outcome(uuid,uuid,numeric,numeric,integer,text,boolean)",
  "get_amora_tool_round_journal(uuid,text,integer)",
  "apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)",
  "begin_account_deletion_job(uuid,text)",
  "is_current_couple_member(uuid,uuid)",
  "check_rate_limit(text,integer,integer)",
  "redact_old_ai_interactions(interval)",
];

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

function executableSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

function topLevelSql(sql) {
  return executableSql(sql).replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g,
    "",
  );
}

function assertReadOnly(sql, label) {
  const executable = executableSql(sql);
  const withoutStringLiterals = executable
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/'(?:''|[^'])*'/g, "''");
  assert.match(executable, /^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i, label);
  assert.doesNotMatch(
    withoutStringLiterals,
    /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL)\b/i,
    label,
  );
}

test("release pre/post checks are read-only, fail-closed, and emit one final verified row", async () => {
  for (const [phase, path] of Object.entries(releaseChecks)) {
    const sql = await source(path);
    assertReadOnly(sql, phase);

    const topLevel = topLevelSql(sql);
    assert.equal((topLevel.match(/\bSELECT\b/gi) ?? []).length, 1, phase);
    assert.match(
      topLevel,
      /SELECT\s+true\s+AS\s+verified(?:\s*,[\s\S]*?)?;\s*COMMIT\s*;\s*$/i,
      phase,
    );
    assert.match(sql, /RAISE\s+EXCEPTION/i, phase);
    for (const version of pendingVersions) {
      assert.match(sql, new RegExp(`['"]${version}['"]`), `${phase}: ${version}`);
    }
  }
});

test("pre-check covers the pinned head, pending absence, hotfix, Storage, data candidates, and relation absence", async () => {
  const sql = await source(releaseChecks.pre);
  for (const marker of [
    "PRE_LEDGER_HEAD_MISMATCH",
    "PRE_PENDING_LEDGER_DIRTY",
    "PRE_AI_LOG_RETENTION_ACL_INVALID",
    "PRE_1170_AUTH_FK_CONTRACT_INVALID",
    "PRE_1080_STORAGE_CONTRACT_INVALID",
    "PRE_DUPLICATE_DATA_INVALID",
    "PRE_1140_CANDIDATE_SET_INVALID",
    "PRE_1150_CANDIDATE_BOUND_INVALID",
    "PRE_NEW_RELATION_ALREADY_EXISTS",
  ]) {
    assert.match(sql, new RegExp(marker));
  }
  assert.match(sql, /20260715210000/);
  assert.match(sql, /v_stale_groom_slots\s*<>\s*34/i);
  assert.match(sql, /v_projected_ownerless\s*<>\s*33/i);
  assert.match(sql, /v_expired_rate_limits\s*>\s*1000/i);
});

test("post-check covers ledger, core RLS/ACL, and 1080/1130/1140/1150/1160 invariants", async () => {
  const sql = await source(releaseChecks.post);
  for (const marker of [
    "POST_LEDGER_INVALID",
    "POST_CORE_RELATION_RLS_INVALID",
    "POST_CORE_OBJECT_INVALID",
    "POST_1080_STORAGE_CONTRACT_INVALID",
    "POST_1080_DATABASE_CONTRACT_INVALID",
    "POST_1130_DELETION_CONTRACT_INVALID",
    "POST_1140_DATA_INVALID",
    "POST_1140_STRUCTURE_INVALID",
    "POST_1150_CONTRACT_INVALID",
    "POST_1160_CONTRACT_INVALID",
    "POST_1170_AUTH_FK_CONTRACT_INVALID",
  ]) {
    assert.match(sql, new RegExp(marker));
  }
  assert.match(sql, /relrowsecurity/i);
  assert.match(sql, /relforcerowsecurity/i);
  assert.match(sql, /raw_payload_90d/i);
  assert.match(sql, /search_path=""/i);
  assert.match(sql, /to_regprocedure\(signature\)/i);
  assert.match(sql, /has_table_privilege/i);
  assert.match(sql, /has_function_privilege/i);
  for (const signature of coreFunctionSignatures) {
    assert.match(sql, new RegExp(`public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("1080 Storage artifacts separate inventory, freeze, finalization, and emergency rollback roles", async () => {
  const inventory = await source(storageArtifacts.inventory);
  const apply = await source(storageArtifacts.apply);
  const verify = await source(storageArtifacts.verify);
  const rollback = await source(storageArtifacts.rollback);
  const rollbackVerify = await source(storageArtifacts.rollbackVerify);
  const freezeApply = await source(storageArtifacts.freezeApply);
  const freezeVerify = await source(storageArtifacts.freezeVerify);
  const freezeRollback = await source(storageArtifacts.freezeRollback);
  const emergencyRollback = await source(storageArtifacts.emergencyRollback);
  const emergencyRollbackVerify = await source(storageArtifacts.emergencyRollbackVerify);
  const freezeReleaseCheck = await source(storageArtifacts.freezeReleaseCheck);
  const finalReleaseCheck = await source(storageArtifacts.finalReleaseCheck);

  assertReadOnly(inventory, "storage inventory");
  assertReadOnly(freezeVerify, "storage freeze verify");
  assertReadOnly(verify, "storage verify");
  assertReadOnly(rollbackVerify, "storage rollback verify");
  assertReadOnly(emergencyRollbackVerify, "storage emergency rollback verify");
  assertReadOnly(freezeReleaseCheck, "storage freeze controller receipt");
  assertReadOnly(finalReleaseCheck, "storage final controller receipt");
  assert.doesNotMatch(executableSql(inventory), /\b(?:CREATE|DROP)\s+POLICY\b/i);
  assert.doesNotMatch(executableSql(verify), /\b(?:CREATE|DROP)\s+POLICY\b/i);

  for (const [label, sql] of [
    ["freeze apply", freezeApply],
    ["freeze safe recovery", freezeRollback],
    ["final apply", apply],
    ["rollback", rollback],
    ["emergency rollback", emergencyRollback],
  ]) {
    assert.match(executableSql(sql), /^\s*BEGIN\s*;/i, label);
    assert.match(executableSql(sql), /\bCOMMIT\s*;\s*$/i, label);
    assert.match(sql, /Dashboard\s*>\s*Storage\s*>\s*Policies/i, label);
  }
  assert.equal(
    (executableSql(freezeApply).match(/\bDROP\s+POLICY\b/gi) ?? []).length,
    15,
    "freeze removes exactly 15 mutation policies",
  );
  assert.doesNotMatch(executableSql(freezeApply), /\bCREATE\s+POLICY\b/i);
  assert.match(executableSql(apply), /\bDROP\s+POLICY\b/i);
  assert.equal(
    (executableSql(apply).match(/\bCREATE\s+POLICY\b/gi) ?? []).length,
    1,
    "final apply creates only the strict uploader policy",
  );
  assert.doesNotMatch(executableSql(rollback), /\bCREATE\s+POLICY\b/i);
  assert.match(rollback, /STORAGE_FINAL_SAFE_ROLLBACK_FAILED_CLOSED/i);
  assert.doesNotMatch(executableSql(rollback), /FOR\s+(?:INSERT|UPDATE|DELETE)/i);
  assert.doesNotMatch(executableSql(freezeRollback), /FOR\s+(?:INSERT|UPDATE|DELETE)/i);
  assert.match(emergencyRollback, /EMERGENCY/i);
  assert.match(emergencyRollback, /reopens the cost-control bypass/i);
  assert.match(rollbackVerify, /SELECT\s+true\s+AS\s+rollback_verified/i);
  for (const [label, sql, fields] of [
    ["freeze controller receipt", freezeReleaseCheck, [
      "storage_policy_count", "storage_mutation_policy_count",
      "storage_bucket_count", "storage_object_count",
    ]],
    ["final controller receipt", finalReleaseCheck, [
      "storage_policy_count", "storage_insert_policy_count",
      "storage_bucket_count", "storage_object_count",
      "production_storage_fence_closed_count",
    ]],
  ]) {
    assert.match(sql, /SELECT\s+true\s+AS\s+verified/i, label);
    for (const field of fields) assert.match(sql, new RegExp(field), `${label}: ${field}`);
  }
});

test("Storage release contract is exact, owner-aware, empty-staging, and one-to-one reversible", async () => {
  const inventory = await source(storageArtifacts.inventory);
  const apply = await source(storageArtifacts.apply);
  const verify = await source(storageArtifacts.verify);
  const rollback = await source(storageArtifacts.rollback);
  const rollbackVerify = await source(storageArtifacts.rollbackVerify);
  const freezeApply = await source(storageArtifacts.freezeApply);
  const freezeVerify = await source(storageArtifacts.freezeVerify);
  const freezeRollback = await source(storageArtifacts.freezeRollback);
  const emergencyRollback = await source(storageArtifacts.emergencyRollback);
  const emergencyRollbackVerify = await source(storageArtifacts.emergencyRollbackVerify);
  const freezeReleaseCheck = await source(storageArtifacts.freezeReleaseCheck);
  const finalReleaseCheck = await source(storageArtifacts.finalReleaseCheck);
  const migration1080 = await source(
    "supabase/migrations/20260716108000_community_upload_service_fence.sql",
  );
  const migration1140 = await source(
    "supabase/migrations/20260716114000_current_couple_membership_privacy_fence.sql",
  );
  const pre = await source(releaseChecks.pre);
  const post = await source(releaseChecks.post);

  for (const sql of [
    inventory, freezeApply, freezeVerify, freezeReleaseCheck,
    apply, verify, finalReleaseCheck, pre, post,
  ]) {
    assert.match(sql, /supabase_storage_admin/i);
    assert.match(sql, /relrowsecurity/i);
  }
  for (const sql of [
    inventory, freezeVerify, freezeReleaseCheck,
    apply, verify, finalReleaseCheck, pre, post,
  ]) {
    assert.match(sql, /community-media-staging/i);
    assert.match(sql, /(?:object_count|count\s*\(\s*\*\s*\))/i);
  }
  assert.match(rollbackVerify, /STORAGE_FINAL_SAFE_ROLLBACK_VERIFY_POLICY_INVALID/);
  assert.match(emergencyRollbackVerify, /STORAGE_ROLLBACK_VERIFY_POLICY_MANIFEST_INVALID/);

  assert.match(apply, new RegExp(storageFinalPolicy));
  for (const sql of [apply, verify, finalReleaseCheck, post]) {
    assert.match(sql, new RegExp(storageFinalExpressionSha256));
    assert.match(sql, /EXCEPT\s+ALL/i);
  }
  for (const sql of [verify, finalReleaseCheck, post]) {
    assert.doesNotMatch(sql, new RegExp(storageFinalPolicy));
  }

  for (const policy of storageMutationPoliciesRemovedForFreeze) {
    const escaped = policy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(freezeApply, new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+["']${escaped}["']`, "i"));
    assert.match(emergencyRollback, new RegExp(`CREATE\\s+POLICY\\s+["']${escaped}["']`, "i"));
    assert.doesNotMatch(rollback, new RegExp(`CREATE\\s+POLICY\\s+["']${escaped}["']`, "i"));
  }

  for (const retained of storageReadPoliciesRetainedForBackup) {
    const escaped = retained.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(
      executableSql(freezeApply),
      new RegExp(`DROP\\s+POLICY(?:\\s+IF\\s+EXISTS)?\\s+["']${escaped}["']`, "i"),
    );
    assert.match(freezeVerify, new RegExp(escaped));
    assert.match(apply, new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+["']${escaped}["']`, "i"));
    assert.doesNotMatch(rollback, new RegExp(`CREATE\\s+POLICY\\s+["']${escaped}["']`, "i"));
    assert.match(freezeRollback, new RegExp(`CREATE\\s+POLICY\\s+["']${escaped}["']`, "i"));
    assert.match(emergencyRollback, new RegExp(`CREATE\\s+POLICY\\s+["']${escaped}["']`, "i"));
  }

  assert.match(apply, new RegExp(`CREATE\\s+POLICY\\s+["']${storageFinalPolicy}["']`, "i"));
  assert.match(apply, /split_part\s*\(\s*name\s*,\s*'\/'\s*,\s*3\s*\)[\s\S]*\(jpeg\|jpg\|png\|gif\|webp\)/i);
  assert.match(apply, /account_deletion_storage_writes_allowed\s*\(\s*\)/i);
  assert.match(apply, /production_storage_writes_allowed\s*\(\s*\)/i);
  assert.match(apply, /is_current_couple_path_member\s*\(/i);
  assert.match(apply, /lower\s*\(\s*btrim\s*\(\s*p_couple_id_text\s*\)\s*\)/i);

  const automaticSql = `${executableSql(migration1080)}\n${executableSql(migration1140)}`;
  assert.doesNotMatch(
    automaticSql,
    /(?:CREATE|DROP)\s+POLICY[\s\S]{0,160}?ON\s+storage\.objects/i,
  );
  assert.doesNotMatch(
    automaticSql,
    /(?:INSERT|UPDATE|DELETE|ALTER|TRUNCATE)\s+(?:TABLE\s+)?storage\./i,
  );
  const migration1080Sql = executableSql(migration1080);
  assert.doesNotMatch(migration1080Sql, /\bpg_policies\b/i);
  assert.doesNotMatch(migration1080Sql, /\bstorage\.(?:objects|buckets)\b/i);
});

test("post-check pins 1110 lifecycle through the 1170 Auth FK contract", async () => {
  const post = await source(releaseChecks.post);
  const migration1140 = await source(
    "supabase/migrations/20260716114000_current_couple_membership_privacy_fence.sql",
  );
  const migration1150 = await source(
    "supabase/migrations/20260716115000_rate_limit_pseudonym_retention.sql",
  );
  const migration1160 = await source(
    "supabase/migrations/20260716116000_ai_log_retention_contract.sql",
  );
  const migration1130 = await source(
    "supabase/migrations/20260716113000_account_deletion_storage_saga.sql",
  );
  const migration1170 = await source(
    "supabase/migrations/20260716117000_account_deletion_auth_fk_contract.sql",
  );

  for (const marker of [
    "POST_1110_LIFECYCLE_CONTRACT_INVALID",
    "POST_PENDING_SECURITY_DEFINER_INVALID",
    "POST_1140_HELPER_CONTRACT_INVALID",
    "POST_1140_POLICY_CONTRACT_INVALID",
  ]) {
    assert.match(post, new RegExp(marker));
  }

  const pendingManifest = post.slice(
    post.indexOf("DO $post_pending_security_definer$"),
    post.indexOf("$post_pending_security_definer$;"),
  );
  const pendingSignatures = new Set(
    [...pendingManifest.matchAll(/\('([^']+)'\)/g)].map((match) => match[1]),
  );
  assert.equal(
    pendingSignatures.size,
    95,
    "every final SECURITY DEFINER function in the pending release is explicit",
  );
  for (const signature of [
    "public.apply_amora_atomic_tool_execution_v1(uuid,text,text,integer,text,jsonb,jsonb,jsonb)",
    "public.enqueue_amora_care_job_pre_delivery_policy(uuid,date,text,text,jsonb,text,text)",
    "public.claim_amora_chat_request(uuid,text,uuid,text)",
    "public.reset_amora_memory_after_membership_change()",
    "public.redact_old_ai_interactions(interval)",
  ]) {
    assert.ok(pendingSignatures.has(signature), signature);
  }

  for (const signature of [
    "public.reconcile_community_upload_target(text,uuid,uuid,text)",
    "public.reconcile_community_post_uploads(uuid)",
    "public.community_upload_post_attachment_trigger()",
    "public.community_upload_poll_option_attachment_trigger()",
    "public.community_upload_poll_attachment_trigger()",
    "public.community_upload_cohort_attachment_trigger()",
    "public.checkpoint_community_upload_token_cleanup(uuid,text)",
    "public.claim_unattached_community_upload_sessions(uuid,timestamp with time zone,timestamp with time zone,integer)",
    "public.finalize_unattached_community_upload_cleanup(uuid,uuid)",
  ]) {
    assert.match(post, new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const objectName of [
    "community_upload_sessions_token_cleanup_idx",
    "community_upload_sessions_unattached_cleanup_idx",
    "community_upload_sessions_attachment_idx",
    "community_upload_post_attachment",
    "community_upload_poll_option_attachment",
    "community_upload_poll_attachment",
    "community_upload_cohort_attachment",
  ]) {
    assert.match(post, new RegExp(objectName));
  }

  assert.match(post, /tgfoid/i);
  assert.match(post, /pg_get_triggerdef/i);
  assert.match(post, /tgenabled\s+IN\s*\(\s*'O'\s*,\s*'A'\s*\)/i);
  assert.match(post, /can_read_profile\(uuid\)[\s\S]*?has_function_privilege\([\s\S]*?'anon'/i);
  assert.match(post, /is_current_couple_path_member\(text\)[\s\S]*?has_function_privilege\([\s\S]*?'anon'/i);
  assert.match(post, /48c182459e66881b136652eabe7ee08c/);
  assert.match(post, /public\.account_deletion_storage_writes_allowed\(\)/);
  assert.match(post, /lock_timeout=5s[\s\S]*statement_timeout=10s/);
  assert.match(post, /jsonb_typeof\(metadata\) = ''object''/);
  const prepareAuthBody = migration1130.match(
    /CREATE OR REPLACE FUNCTION public\.prepare_account_deletion_auth_delete\([\s\S]*?AS \$prepare_auth\$([\s\S]*?)\$prepare_auth\$;/,
  )?.[1];
  assert.ok(prepareAuthBody, "prepare-account-deletion function body is explicit");
  const prepareAuthBodyHash = createHash("md5")
    .update(prepareAuthBody.replace(/\r\n/g, "\n"))
    .digest("hex");
  assert.match(migration1130, /vendor\.owner_id = job\.user_id/);
  assert.match(migration1170, /ON DELETE SET NULL/i);
  assert.match(migration1170, /ON DELETE RESTRICT/i);
  assert.match(post, /set_null_names text\[\] := ARRAY\[/);
  assert.match(post, /constraint_record\.confdeltype = 'n'/);
  for (const sql of [migration1170, post]) {
    assert.match(sql, /couples_bride_id_fkey/);
    assert.match(sql, /couples_groom_id_fkey/);
    assert.match(sql, /chat_messages_sender_id_fkey/);
    assert.match(sql, /vendors_owner_id_fkey/);
    assert.match(sql, /constraint_record\.confdeltype = 'r'/);
    assert.match(
      sql,
      new RegExp(`md5\\(procedure_record\\.prosrc\\)\\s*=\\s*'${prepareAuthBodyHash}'`),
    );
  }
  for (const sql of [migration1160, post]) {
    assert.match(
      sql,
      /metadata->>''?retention_policy''?\s+IS DISTINCT FROM\s+''?raw_payload_90d''?/i,
    );
    assert.match(
      sql,
      /metadata->>''?retention_redacted_at''?\s+IS NULL/i,
    );
  }
  assert.doesNotMatch(migration1140, /is_couple_member\(customer_id\)/i);

  const keyShape = /\^\[a-z\]\[a-z0-9:_-\]\{0,127\}:hmac-sha256:\[0-9a-f\]\{64\}\$/;
  assert.match(migration1150, keyShape);
  assert.match(post, keyShape);
});
