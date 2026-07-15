import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { assertApprovedPreviewTarget } from "./lib/preview-smoke-guard.mjs";

const releaseTargets = JSON.parse(
  readFileSync(new URL("./release-targets.json", import.meta.url), "utf8")
);
const configuredSupabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const expectedProjectRef = process.env.SUPABASE_EXPECTED_PROJECT_REF;

if (!configuredSupabaseUrl || !serviceKey || !expectedProjectRef) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_EXPECTED_PROJECT_REF are required."
  );
}
const { supabaseUrl: baseUrl, projectRef: actualProjectRef } =
  assertApprovedPreviewTarget({
    supabaseUrl: configuredSupabaseUrl,
    expectedProjectRef,
    releaseTargets,
  });

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};
const testRun = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const userIds = [];
let primaryError;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload && typeof payload.code === "string" ? ` (${payload.code})` : "";
    throw new Error(`Supabase request failed at ${path}: HTTP ${response.status}${code}`);
  }
  return { response, payload };
}

async function rpc(name, body) {
  const { payload } = await api(`/rest/v1/rpc/${name}`, { method: "POST", body });
  return payload;
}

async function createUser(label) {
  const email = `hanbang-smoke-${testRun}-${label}@example.invalid`;
  const { payload } = await api("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email,
      password: `${randomUUID()}Aa!9`,
      email_confirm: true,
      user_metadata: { name: `Lifecycle ${label}` },
    },
  });
  const id = payload?.id ?? payload?.user?.id;
  assert(typeof id === "string", `Auth Admin did not return an id for ${label}.`);
  userIds.push(id);

  const profilePath = `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id`;
  const profile = (await api(profilePath)).payload;
  assert(Array.isArray(profile) && profile.length === 1, `Profile missing for ${label}.`);
  return id;
}

async function getProfile(id) {
  const { payload } = await api(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}` +
      "&select=id,couple_id,role,account_deleting_at,amora_membership_resetting_at"
  );
  assert(Array.isArray(payload) && payload.length === 1, "Expected one lifecycle profile.");
  return payload[0];
}

async function getCouple(id) {
  const { payload } = await api(
    `/rest/v1/couples?id=eq.${encodeURIComponent(id)}` +
      "&select=id,invite_code,bride_id,groom_id,amora_replacement_blocked_at,amora_shared_resetting_at"
  );
  assert(Array.isArray(payload) && payload.length === 1, "Expected one lifecycle couple.");
  return payload[0];
}

async function createCouple(userId, role = "bride") {
  const result = await rpc("create_amora_couple_safely", {
    p_user_id: userId,
    p_role: role,
    p_wedding_date: null,
    p_venue: "",
    p_total_budget: 0,
    p_progress: {},
  });
  assert(result?.success === true, "Couple creation RPC failed.");
  assert(typeof result.couple_id === "string", "Couple creation returned no couple id.");
  assert(/^WH-[A-F0-9]{12}$/.test(result.invite_code), "New invite format is invalid.");
  return result;
}

async function joinCouple(userId, inviteCode, role = "groom") {
  return rpc("join_couple_server", {
    p_user_id: userId,
    p_invite_code: inviteCode,
    p_role: role,
    p_wedding_date: null,
    p_venue: "",
    p_total_budget: 0,
    p_progress: {},
    p_sanggyeonrye_date: null,
  });
}

async function cleanup() {
  const failures = [];
  let fixtureCleanupSucceeded = false;
  if (userIds.length > 0) {
    try {
      await rpc("cleanup_preview_smoke_fixture", {
        p_project_ref: actualProjectRef,
        p_user_ids: userIds,
      });
      fixtureCleanupSucceeded = true;
    } catch {
      failures.push("fixture-data");
    }
  }
  if (fixtureCleanupSucceeded) {
    for (const id of [...userIds].reverse()) {
      try {
        await api(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        failures.push("auth-user");
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Lifecycle smoke cleanup failed for ${[...new Set(failures)].join(", ")}.`);
  }
}

try {
  const preflight = await rpc("assert_preview_smoke_ready", {
    p_project_ref: actualProjectRef,
  });
  assert(preflight?.ready === true, "Preview smoke database harness is not ready.");

  const owner = await createUser("reset-owner");
  const departing = await createUser("reset-departing");
  const replacement = await createUser("reset-replacement");
  const original = await createCouple(owner);
  const joined = await joinCouple(departing, original.invite_code);
  assert(joined?.success === true, "Initial partner join failed.");

  const beginReset = await rpc("begin_amora_membership_reset", { p_user_id: departing });
  assert(beginReset?.slot_owned === true, "Reset did not acquire the departing slot.");
  const leaveReset = await rpc("leave_amora_couple_safely", {
    p_user_id: departing,
    p_mode: "reset",
  });
  assert(leaveReset?.left_couple === true, "Reset did not detach the departing partner.");

  const blocked = await getCouple(original.couple_id);
  assert(blocked.bride_id === owner && blocked.groom_id === null, "Reset left incorrect slots.");
  assert(blocked.invite_code === null, "Reset failed to revoke the old invite.");
  assert(blocked.amora_replacement_blocked_at !== null, "Reset did not block legacy relinking.");

  const constraintAttempt = await rpc("prepare_preview_lifecycle_smoke_fixture", {
    p_project_ref: actualProjectRef,
    p_operation: "assert_blocked_invite",
    p_user_id: owner,
    p_couple_id: original.couple_id,
  });
  assert(constraintAttempt?.accepted === false, "Blocked couple accepted a replacement invite.");
  assert(constraintAttempt?.sqlstate === "23514", "Blocked invite failed for the wrong reason.");

  const oldJoin = await joinCouple(replacement, original.invite_code);
  assert(oldJoin?.error === "Invite unavailable.", "Revoked invite remained joinable.");
  const blockedRead = await rpc("get_or_rotate_invite_code_safely", {
    p_user_id: owner,
    p_rotate: false,
  });
  assert(blockedRead?.invite_code === null, "Blocked invite read disclosed a code.");
  assert(
    blockedRead?.requires_relink_confirmation === true,
    "Blocked invite read did not require confirmation."
  );

  const restarted = await rpc("restart_blocked_amora_couple_safely", { p_user_id: owner });
  assert(/^WH-[A-F0-9]{12}$/.test(restarted?.invite_code), "Restart did not issue a strong code.");
  const restartedProfile = await getProfile(owner);
  assert(restartedProfile.couple_id !== original.couple_id, "Restart reused the old couple.");
  const retired = await getCouple(original.couple_id);
  assert(
    retired.bride_id === null && retired.groom_id === null && retired.invite_code === null,
    "Restart failed to isolate the retired couple."
  );
  const replacementJoin = await joinCouple(replacement, restarted.invite_code);
  assert(replacementJoin?.success === true, "Replacement could not join the clean couple.");

  const legacyOwner = await createUser("legacy-owner");
  const legacy = await createCouple(legacyOwner);
  const legacyFixture = await rpc("prepare_preview_lifecycle_smoke_fixture", {
    p_project_ref: actualProjectRef,
    p_operation: "set_legacy_invite",
    p_user_id: legacyOwner,
    p_couple_id: legacy.couple_id,
  });
  assert(legacyFixture?.invite_code === "ABC123", "Legacy invite fixture was not installed.");
  const repaired = await rpc("get_or_rotate_invite_code_safely", {
    p_user_id: legacyOwner,
    p_rotate: false,
  });
  assert(/^WH-[A-F0-9]{12}$/.test(repaired?.invite_code), "Legacy invite was not repaired.");
  assert(repaired.invite_code !== "ABC123", "Legacy invite was returned unchanged.");

  const zeroJoiner = await createUser("zero-member-joiner");
  const zeroFixture = await rpc("prepare_preview_lifecycle_smoke_fixture", {
    p_project_ref: actualProjectRef,
    p_operation: "create_zero_member",
    p_user_id: zeroJoiner,
    p_couple_id: null,
  });
  assert(
    typeof zeroFixture?.couple_id === "string" &&
      /^WH-[A-F0-9]{12}$/.test(zeroFixture?.invite_code),
    "Zero-member fixture creation failed.",
  );
  const zeroJoin = await joinCouple(zeroJoiner, zeroFixture.invite_code);
  assert(zeroJoin?.error === "Invite unavailable.", "Zero-member couple became joinable.");

  const accountOwner = await createUser("account-owner");
  const accountDeparting = await createUser("account-departing");
  const accountCouple = await createCouple(accountOwner);
  const accountJoined = await joinCouple(accountDeparting, accountCouple.invite_code);
  assert(accountJoined?.success === true, "Account-delete fixture join failed.");
  const beginDelete = await rpc("begin_account_deletion", { p_user_id: accountDeparting });
  assert(beginDelete?.slot_owned === true, "Account deletion did not acquire the slot.");
  const accountLeave = await rpc("leave_amora_couple_safely", {
    p_user_id: accountDeparting,
    p_mode: "account_delete",
  });
  assert(accountLeave?.left_couple === true, "Account deletion did not detach the member.");
  const accountBlocked = await getCouple(accountCouple.couple_id);
  assert(
    accountBlocked.invite_code === null && accountBlocked.amora_replacement_blocked_at !== null,
    "Account deletion failed to revoke and block replacement linking."
  );

  process.stdout.write(
    JSON.stringify({
      ok: true,
      projectRef: actualProjectRef,
      resetIsolation: true,
      blockedConstraint: true,
      legacyRepair: true,
      zeroMemberRejected: true,
      accountDeleteIsolation: true,
    }) + "\n"
  );
} catch (error) {
  primaryError = error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
    else process.stderr.write("Lifecycle smoke cleanup also failed; preview requires inspection.\n");
  }
}

if (primaryError) throw primaryError;
