import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const releaseTargets = JSON.parse(
  readFileSync(new URL("./release-targets.json", import.meta.url), "utf8")
);
const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const expectedProjectRef = process.env.SUPABASE_EXPECTED_PROJECT_REF;

if (!baseUrl || !serviceKey || !expectedProjectRef) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_EXPECTED_PROJECT_REF are required."
  );
}

const parsedUrl = new URL(baseUrl);
const actualProjectRef = parsedUrl.hostname.split(".")[0];
if (
  parsedUrl.protocol !== "https:" ||
  parsedUrl.hostname !== `${expectedProjectRef}.supabase.co` ||
  actualProjectRef !== expectedProjectRef
) {
  throw new Error("Supabase URL does not match the explicitly expected preview project.");
}
if (releaseTargets.productionSupabaseProjectRefs.includes(actualProjectRef)) {
  throw new Error("Lifecycle smoke tests are forbidden on protected production projects.");
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};
const testRun = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const userIds = [];
const coupleIds = new Set();
let primaryError;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, { method = "GET", body, prefer, allowError = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: prefer ? { ...headers, Prefer: prefer } : headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok && !allowError) {
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
  const { payload } = await api("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email: `codex-${testRun}-${label}@example.invalid`,
      password: `${randomUUID()}Aa!9`,
      email_confirm: true,
      user_metadata: { name: `Lifecycle ${label}` },
    },
  });
  const id = payload?.id ?? payload?.user?.id;
  assert(typeof id === "string", `Auth Admin did not return an id for ${label}.`);
  userIds.push(id);

  const profilePath = `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id`;
  let profile = (await api(profilePath)).payload;
  if (!Array.isArray(profile) || profile.length !== 1) {
    await api("/rest/v1/profiles", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        id,
        name: `Lifecycle ${label}`,
        email: `codex-${testRun}-${label}@example.invalid`,
      },
    });
    profile = (await api(profilePath)).payload;
  }
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
  coupleIds.add(result.couple_id);
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

async function deleteWhere(table, filter) {
  await api(`/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

async function cleanup() {
  const failures = [];
  for (const id of [...userIds].reverse()) {
    try {
      await api(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      failures.push("auth-user");
    }
  }
  if (coupleIds.size > 0) {
    const ids = [...coupleIds].join(",");
    try {
      await deleteWhere("wedding_journeys", `couple_id=in.(${ids})`);
      await deleteWhere("couples", `id=in.(${ids})`);
    } catch {
      failures.push("couple-data");
    }
  }
  if (failures.length > 0) {
    throw new Error(`Lifecycle smoke cleanup failed for ${[...new Set(failures)].join(", ")}.`);
  }
}

try {
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

  const constraintAttempt = await api(
    `/rest/v1/couples?id=eq.${encodeURIComponent(original.couple_id)}`,
    {
      method: "PATCH",
      body: { invite_code: original.invite_code },
      prefer: "return=minimal",
      allowError: true,
    }
  );
  assert(!constraintAttempt.response.ok, "Blocked couple accepted a replacement invite.");
  assert(constraintAttempt.payload?.code === "23514", "Blocked invite failed for the wrong reason.");

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
  coupleIds.add(restartedProfile.couple_id);
  const retired = await getCouple(original.couple_id);
  assert(
    retired.bride_id === null && retired.groom_id === null && retired.invite_code === null,
    "Restart failed to isolate the retired couple."
  );
  const replacementJoin = await joinCouple(replacement, restarted.invite_code);
  assert(replacementJoin?.success === true, "Replacement could not join the clean couple.");

  const legacyOwner = await createUser("legacy-owner");
  const legacy = await createCouple(legacyOwner);
  await api(`/rest/v1/couples?id=eq.${encodeURIComponent(legacy.couple_id)}`, {
    method: "PATCH",
    body: { invite_code: "ABC123" },
    prefer: "return=minimal",
  });
  const repaired = await rpc("get_or_rotate_invite_code_safely", {
    p_user_id: legacyOwner,
    p_rotate: false,
  });
  assert(/^WH-[A-F0-9]{12}$/.test(repaired?.invite_code), "Legacy invite was not repaired.");
  assert(repaired.invite_code !== "ABC123", "Legacy invite was returned unchanged.");

  const zeroJoiner = await createUser("zero-member-joiner");
  const zeroCode = `WH-${randomBytes(6).toString("hex").toUpperCase()}`;
  const { payload: zeroRows } = await api("/rest/v1/couples", {
    method: "POST",
    body: { invite_code: zeroCode },
    prefer: "return=representation",
  });
  assert(Array.isArray(zeroRows) && zeroRows.length === 1, "Zero-member fixture creation failed.");
  coupleIds.add(zeroRows[0].id);
  const zeroJoin = await joinCouple(zeroJoiner, zeroCode);
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
