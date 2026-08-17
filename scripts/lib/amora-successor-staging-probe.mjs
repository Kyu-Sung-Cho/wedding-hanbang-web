import { randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

const PROJECT_REF = /^[a-z0-9]{20}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;

export class AmoraSuccessorStagingProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AmoraSuccessorStagingProbeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AmoraSuccessorStagingProbeError(code, message);
}

async function readBoundedJson(response, code, maxBytes = 256 * 1024) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    fail(code, "Hosted response exceeded the probe limit");
  }
  let body;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    fail(code, "Hosted response was not valid JSON");
  }
  if (!response.ok) {
    fail(code, `Hosted request failed with HTTP ${response.status}`);
  }
  return body;
}

async function requestSupabaseJson({
  url,
  apiKey,
  bearer,
  method = "GET",
  body,
  fetchImpl,
  allowDenied = false,
}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("HOSTED_REQUEST_FAILED", "Hosted staging request failed before a response");
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) {
    fail("HOSTED_RESPONSE_INVALID", "Hosted response exceeded the probe limit");
  }
  let parsed = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    fail("HOSTED_RESPONSE_INVALID", "Hosted response was not valid JSON");
  }
  if (!response.ok && !allowDenied) {
    fail("HOSTED_REQUEST_REJECTED", `Hosted staging request returned HTTP ${response.status}`);
  }
  return { status: response.status, ok: response.ok, body: parsed };
}

export function validateAmoraSuccessorStagingProbeConfig(input) {
  const projectRef = String(input?.projectRef ?? "").trim();
  const productionProjectRef = String(input?.productionProjectRef ?? "").trim();
  const approvedProjectRef = String(input?.approvedProjectRef ?? "").trim();
  const managementToken = String(input?.managementToken ?? "");
  const expectedCommit = String(input?.expectedCommit ?? "").trim();
  const receiptOut = String(input?.receiptOut ?? "").trim();

  if (![projectRef, productionProjectRef, approvedProjectRef]
    .every((value) => PROJECT_REF.test(value))) {
    fail("PROJECT_REF_INVALID", "Project refs must be exact 20-character refs");
  }
  if (projectRef === productionProjectRef) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "The Amora probe is staging-only");
  }
  if (projectRef !== approvedProjectRef) {
    fail("STAGING_PROJECT_PIN_MISMATCH", "The target is not the approved staging project");
  }
  if (managementToken.length < 20 || /[\r\n]/.test(managementToken)) {
    fail("MANAGEMENT_TOKEN_INVALID", "A valid Management API token is required");
  }
  if (!GIT_COMMIT.test(expectedCommit)) {
    fail("COMMIT_INVALID", "The probe must be bound to a full lowercase commit SHA");
  }
  if (!isAbsolute(receiptOut)) {
    fail("RECEIPT_PATH_INVALID", "The probe receipt path must be absolute");
  }

  return Object.freeze({
    projectRef,
    productionProjectRef,
    approvedProjectRef,
    managementToken,
    expectedCommit,
    receiptOut: resolve(receiptOut),
  });
}

export async function loadSupabaseProjectApiKeys({
  projectRef,
  managementToken,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await readBoundedJson(response, "PROJECT_API_KEYS_UNAVAILABLE");
  const anonKey = Array.isArray(body)
    ? body.find((entry) => entry?.name === "anon")?.api_key
    : null;
  const serviceRoleKey = Array.isArray(body)
    ? body.find((entry) => entry?.name === "service_role")?.api_key
    : null;
  if (typeof anonKey !== "string" || anonKey.length < 8
      || typeof serviceRoleKey !== "string" || serviceRoleKey.length < 8) {
    fail("PROJECT_API_KEYS_INVALID", "Staging legacy API role keys were unavailable");
  }
  return Object.freeze({ anonKey, serviceRoleKey });
}

const MIGRATION_LEDGER_SQL = `
SELECT
  count(*)::integer AS migration_count,
  max(version)::text AS migration_head
FROM supabase_migrations.schema_migrations
`;

export async function readHostedMigrationLedger({
  projectRef,
  managementToken,
  expectedCount,
  expectedHead,
  fetchImpl = fetch,
}) {
  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: MIGRATION_LEDGER_SQL, parameters: [] }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    fail("MIGRATION_LEDGER_UNAVAILABLE", "Hosted migration ledger request failed");
  }
  const body = await readBoundedJson(response, "MIGRATION_LEDGER_UNAVAILABLE");
  const row = Array.isArray(body) && body.length === 1 ? body[0] : null;
  if (response.status !== 201
      || row?.migration_count !== expectedCount
      || row?.migration_head !== expectedHead) {
    fail("MIGRATION_LEDGER_MISMATCH", "Hosted migration ledger does not match the probe contract");
  }
  return Object.freeze({ count: row.migration_count, head: row.migration_head });
}

export function createSupabaseStagingTransport({
  projectRef,
  anonKey,
  serviceRoleKey,
  fetchImpl = fetch,
  runNonce = `${Date.now()}-${randomBytes(6).toString("hex")}`,
}) {
  const baseUrl = `https://${projectRef}.supabase.co`;
  let userSequence = 0;

  const call = (path, options) => requestSupabaseJson({
    url: `${baseUrl}${path}`,
    fetchImpl,
    ...options,
  });
  const adminCall = (path, options = {}) => call(path, {
    apiKey: serviceRoleKey,
    bearer: serviceRoleKey,
    ...options,
  });
  const userCall = (user, path, options = {}) => call(path, {
    apiKey: anonKey,
    bearer: user.accessToken,
    ...options,
  });

  return Object.freeze({
    async createSyntheticUser(label) {
      userSequence += 1;
      const safeLabel = label === "owner" ? "owner" : "partner";
      const email = `amora-stg-${runNonce}-${userSequence}-${safeLabel}@hanbang-test.invalid`;
      const password = `${randomBytes(24).toString("base64url")}!Aa1`;
      const created = await adminCall("/auth/v1/admin/users", {
        method: "POST",
        body: {
          email,
          password,
          email_confirm: true,
          user_metadata: { name: `Amora staging ${safeLabel}` },
        },
      });
      const id = created.body?.id ?? created.body?.user?.id ?? null;
      if (typeof id !== "string") {
        fail("SYNTHETIC_USER_CREATE_INVALID", "Synthetic Auth user was not returned");
      }

      try {
        const session = await requestSupabaseJson({
          url: `${baseUrl}/auth/v1/token?grant_type=password`,
          apiKey: anonKey,
          bearer: anonKey,
          method: "POST",
          body: { email, password },
          fetchImpl,
        });
        const accessToken = session.body?.access_token;
        const sessionUserId = session.body?.user?.id;
        if (typeof accessToken !== "string" || sessionUserId !== id) {
          fail("SYNTHETIC_SESSION_INVALID", "Synthetic Auth session was not canonical");
        }
        return Object.freeze({ id, accessToken });
      } catch (error) {
        try {
          await adminCall(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
        } catch {
          // Preserve the primary session error; residue is checked by the caller.
        }
        throw error;
      }
    },

    async createNeutralPreparationSpace(user) {
      const response = await userCall(
        user,
        "/rest/v1/rpc/create_neutral_preparation_space_for_current_user",
        { method: "POST", body: {} },
      );
      return response.body;
    },

    async readProfile(user, targetUserId) {
      const query = new URLSearchParams({
        select: "id,couple_id,role",
        id: `eq.${targetUserId}`,
      });
      const response = await userCall(user, `/rest/v1/profiles?${query}`);
      return response.body;
    },

    async readCouple(user, coupleId) {
      const query = new URLSearchParams({
        select: "id,member_model_version",
        id: `eq.${coupleId}`,
      });
      const response = await userCall(user, `/rest/v1/couples?${query}`);
      return response.body;
    },

    async callServerJoinAsAuthenticated(user, inviteCode) {
      const response = await userCall(
        user,
        "/rest/v1/rpc/join_neutral_preparation_space_server",
        {
          method: "POST",
          body: { p_actor_user_id: user.id, p_invite_code: inviteCode },
          allowDenied: true,
        },
      );
      return { denied: [401, 403, 404].includes(response.status) };
    },

    async joinNeutralPreparationSpaceServer(actorUserId, inviteCode) {
      const response = await adminCall(
        "/rest/v1/rpc/join_neutral_preparation_space_server",
        {
          method: "POST",
          body: { p_actor_user_id: actorUserId, p_invite_code: inviteCode },
        },
      );
      return response.body;
    },

    async resetMembership(user) {
      const response = await userCall(
        user,
        "/rest/v1/rpc/reset_current_couple_membership",
        { method: "POST", body: {} },
      );
      return response.body;
    },

    async deleteSyntheticUser(userId) {
      await adminCall(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
    },

    async readResidue({ userIds, coupleId }) {
      const profileRows = [];
      for (const userId of userIds) {
        const query = new URLSearchParams({ select: "id", id: `eq.${userId}` });
        const response = await adminCall(`/rest/v1/profiles?${query}`);
        if (Array.isArray(response.body)) profileRows.push(...response.body);
      }
      let coupleRows = [];
      if (typeof coupleId === "string") {
        const query = new URLSearchParams({ select: "id", id: `eq.${coupleId}` });
        const response = await adminCall(`/rest/v1/couples?${query}`);
        if (Array.isArray(response.body)) coupleRows = response.body;
      }
      return { profiles: profileRows.length, couples: coupleRows.length };
    },
  });
}

function requireScenario(condition, code, message) {
  if (!condition) fail(code, message);
}

function isExactVisibleProfile(rows, expectedUserId, expectedCoupleId) {
  return Array.isArray(rows)
    && rows.length === 1
    && rows[0]?.id === expectedUserId
    && rows[0]?.couple_id === expectedCoupleId
    && ["bride", "groom"].includes(rows[0]?.role);
}

function isExactVisibleCouple(rows, expectedCoupleId) {
  return Array.isArray(rows)
    && rows.length === 1
    && rows[0]?.id === expectedCoupleId
    && rows[0]?.member_model_version === 2;
}

export async function runNeutralPreparationSpaceScenario({ transport }) {
  if (!transport || typeof transport !== "object") {
    fail("TRANSPORT_INVALID", "A hosted staging transport is required");
  }

  const checks = {
    ownerCreate: false,
    ownerReplay: false,
    preJoinProfileIsolation: false,
    preJoinCoupleIsolation: false,
    authenticatedServerJoinDenied: false,
    serverJoin: false,
    postJoinMutualProfileRead: false,
    postJoinCoupleRead: false,
    cleanup: false,
  };
  const users = [];
  let coupleId = null;
  let primaryError = null;

  try {
    const owner = await transport.createSyntheticUser("owner");
    users.push(owner);
    const partner = await transport.createSyntheticUser("partner");
    users.push(partner);
    requireScenario(owner?.id && owner?.accessToken, "OWNER_SESSION_INVALID", "Owner session is invalid");
    requireScenario(partner?.id && partner?.accessToken, "PARTNER_SESSION_INVALID", "Partner session is invalid");
    requireScenario(owner.id !== partner.id, "SYNTHETIC_IDENTITY_COLLISION", "Synthetic users must be distinct");

    const created = await transport.createNeutralPreparationSpace(owner);
    coupleId = created?.couple_id ?? null;
    const inviteCode = created?.invite_code ?? null;
    checks.ownerCreate = created?.success === true
      && created?.created === true
      && created?.idempotent === false
      && created?.member_model_version === 2
      && typeof coupleId === "string"
      && typeof inviteCode === "string";
    requireScenario(checks.ownerCreate, "OWNER_CREATE_INVALID", "Neutral preparation space was not created canonically");

    const replay = await transport.createNeutralPreparationSpace(owner);
    checks.ownerReplay = replay?.success === true
      && replay?.created === false
      && replay?.idempotent === true
      && replay?.couple_id === coupleId
      && replay?.invite_code === inviteCode
      && replay?.member_model_version === 2;
    requireScenario(checks.ownerReplay, "OWNER_REPLAY_INVALID", "Neutral preparation space replay drifted");

    const [partnerReadsOwner, ownerReadsPartner, partnerReadsCouple] = await Promise.all([
      transport.readProfile(partner, owner.id),
      transport.readProfile(owner, partner.id),
      transport.readCouple(partner, coupleId),
    ]);
    checks.preJoinProfileIsolation = Array.isArray(partnerReadsOwner)
      && partnerReadsOwner.length === 0
      && Array.isArray(ownerReadsPartner)
      && ownerReadsPartner.length === 0;
    checks.preJoinCoupleIsolation = Array.isArray(partnerReadsCouple)
      && partnerReadsCouple.length === 0;
    requireScenario(checks.preJoinProfileIsolation, "PRE_JOIN_PROFILE_LEAK", "Unlinked profiles were visible across accounts");
    requireScenario(checks.preJoinCoupleIsolation, "PRE_JOIN_COUPLE_LEAK", "An unlinked couple was visible across accounts");

    const forbiddenJoin = await transport.callServerJoinAsAuthenticated(partner, inviteCode);
    checks.authenticatedServerJoinDenied = forbiddenJoin?.denied === true;
    requireScenario(checks.authenticatedServerJoinDenied, "SERVER_JOIN_ACL_BYPASS", "Authenticated client reached the service-only join RPC");

    const joined = await transport.joinNeutralPreparationSpaceServer(partner.id, inviteCode);
    checks.serverJoin = joined?.success === true
      && joined?.joined === true
      && joined?.idempotent === false
      && joined?.couple_id === coupleId
      && joined?.member_model_version === 2;
    requireScenario(checks.serverJoin, "SERVER_JOIN_INVALID", "Partner join was not canonical");

    const [ownerReadsPartnerAfter, partnerReadsOwnerAfter, ownerReadsCouple, partnerReadsCoupleAfter] = await Promise.all([
      transport.readProfile(owner, partner.id),
      transport.readProfile(partner, owner.id),
      transport.readCouple(owner, coupleId),
      transport.readCouple(partner, coupleId),
    ]);
    checks.postJoinMutualProfileRead = isExactVisibleProfile(ownerReadsPartnerAfter, partner.id, coupleId)
      && isExactVisibleProfile(partnerReadsOwnerAfter, owner.id, coupleId);
    checks.postJoinCoupleRead = isExactVisibleCouple(ownerReadsCouple, coupleId)
      && isExactVisibleCouple(partnerReadsCoupleAfter, coupleId);
    requireScenario(checks.postJoinMutualProfileRead, "POST_JOIN_PROFILE_READ_INVALID", "Linked profiles were not mutually readable");
    requireScenario(checks.postJoinCoupleRead, "POST_JOIN_COUPLE_READ_INVALID", "Linked users did not read the same preparation space");
  } catch (error) {
    primaryError = error;
  } finally {
    for (const user of [...users].reverse()) {
      try {
        await transport.resetMembership(user);
      } catch {
        // Account deletion is the final cleanup boundary if reset is unavailable.
      }
    }
    for (const user of [...users].reverse()) {
      try {
        await transport.deleteSyntheticUser(user.id);
      } catch (error) {
        primaryError ??= new AmoraSuccessorStagingProbeError(
          "SYNTHETIC_USER_CLEANUP_FAILED",
          error instanceof Error ? error.message : "Synthetic user cleanup failed",
        );
      }
    }
  }

  let residue = { profiles: Number.NaN, couples: Number.NaN };
  try {
    residue = await transport.readResidue({
      userIds: users.map(({ id }) => id),
      coupleId,
    });
    checks.cleanup = residue?.profiles === 0 && residue?.couples === 0;
  } catch (error) {
    primaryError ??= error;
  }

  if (!checks.cleanup) {
    primaryError ??= new AmoraSuccessorStagingProbeError(
      "SYNTHETIC_RESIDUE_PRESENT",
      "Hosted staging probe left synthetic rows behind",
    );
  }
  if (primaryError) throw primaryError;

  return Object.freeze({
    scenario: "neutral_preparation_space_two_account_v1",
    syntheticUserCount: users.length,
    checks: Object.freeze({ ...checks }),
    residue: Object.freeze({ profiles: residue.profiles, couples: residue.couples }),
  });
}
