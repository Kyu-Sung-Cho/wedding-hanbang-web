import { randomBytes, randomUUID } from "node:crypto";
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

const MESSAGE_REF_RESIDUE_SQL = `
SELECT
  (
    SELECT count(*)::integer
    FROM public.profiles AS profile
    WHERE profile.id = ANY($1::uuid[])
  ) AS profiles,
  (
    SELECT count(*)::integer
    FROM public.couples AS couple
    WHERE couple.id = ANY($2::uuid[])
  ) AS couples,
  (
    SELECT count(*)::integer
    FROM public.chat_messages AS message
    WHERE message.id = ANY($3::uuid[])
       OR message.sender_id = ANY($1::uuid[])
       OR message.couple_id = ANY($2::uuid[])
  ) AS chat_messages,
  (
    SELECT count(*)::integer
    FROM public.amora_preparation_topic_message_refs AS ref
    WHERE ref.couple_id = ANY($2::uuid[])
       OR ref.message_id = ANY($3::uuid[])
       OR ref.question_message_id = ANY($3::uuid[])
       OR ref.owner_user_id = ANY($1::uuid[])
  ) AS message_refs
`;

export function readHostedMessageRefResidue({
  projectRef,
  productionProjectRef,
  managementToken,
  userIds,
  coupleIds,
  messageIds,
  fetchImpl = fetch,
}) {
  if (!PROJECT_REF.test(projectRef) || !PROJECT_REF.test(productionProjectRef)) {
    fail("PROJECT_REF_INVALID", "Project refs must be exact 20-character refs");
  }
  if (projectRef === productionProjectRef) {
    fail("PRODUCTION_TARGET_FORBIDDEN", "The Amora probe is staging-only");
  }
  if (typeof managementToken !== "string" || managementToken.length < 20 || /[\r\n]/u.test(managementToken)) {
    fail("MANAGEMENT_TOKEN_INVALID", "A valid Management API token is required");
  }
  for (const values of [userIds, coupleIds, messageIds]) {
    if (
      !Array.isArray(values)
      || values.length < 1
      || values.length > 10
      || !values.every(isUuid)
      || new Set(values).size !== values.length
    ) {
      fail("MESSAGE_REF_RESIDUE_INPUT_INVALID", "Residue identities must be bounded unique UUID arrays");
    }
  }

  return (async () => {
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
          body: JSON.stringify({
            query: MESSAGE_REF_RESIDUE_SQL,
            parameters: [userIds, coupleIds, messageIds],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      fail("MESSAGE_REF_RESIDUE_UNAVAILABLE", "Hosted message-ref residue request failed");
    }
    const body = await readBoundedJson(response, "MESSAGE_REF_RESIDUE_UNAVAILABLE");
    const row = response.status === 201 && Array.isArray(body) && body.length === 1
      ? body[0]
      : null;
    const counts = [row?.profiles, row?.couples, row?.chat_messages, row?.message_refs];
    if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0)) {
      fail("MESSAGE_REF_RESIDUE_INVALID", "Hosted message-ref residue was not canonical");
    }
    return Object.freeze({
      profiles: row.profiles,
      couples: row.couples,
      chatMessages: row.chat_messages,
      messageRefs: row.message_refs,
    });
  })();
}

export function createSupabaseStagingTransport({
  projectRef,
  anonKey,
  serviceRoleKey,
  fetchImpl = fetch,
  runNonce = `${Date.now()}-${randomBytes(6).toString("hex")}`,
  messageRefResidueReader = null,
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

    async createPreparationTopicMessageFixtures({ owner, coupleId }) {
      const profileQuery = new URLSearchParams({
        select: "id,couple_id,role",
        id: `eq.${owner?.id ?? ""}`,
        couple_id: `eq.${coupleId ?? ""}`,
      });
      const profileResponse = await adminCall(`/rest/v1/profiles?${profileQuery}`);
      const profile = Array.isArray(profileResponse.body)
        && profileResponse.body.length === 1
        ? profileResponse.body[0]
        : null;
      if (
        !isUuid(owner?.id)
        || !isUuid(coupleId)
        || profile?.id !== owner.id
        || profile?.couple_id !== coupleId
        || !["bride", "groom"].includes(profile?.role)
      ) {
        fail("MESSAGE_REF_FIXTURE_OWNER_INVALID", "Message-ref fixture owner was not canonical");
      }

      const sharedQuestionId = randomUUID();
      const sharedAnswerId = randomUUID();
      const privateQuestionId = randomUUID();
      const privateAnswerId = randomUUID();
      const sharedQuestion = "상견례 날짜를 정할 때 무엇부터 확인할까요?";
      const sharedAnswer = "양가가 피하기 어려운 날짜부터 두세 개만 먼저 모아 보세요.";
      const privateQuestion = "제 예산 걱정은 상대에게 아직 보이지 않게 정리하고 싶어요.";
      const privateAnswer = "혼자 감당 가능한 상한과 함께 상의할 범위를 나눠 보세요.";
      const privateVisibility = `${profile.role}_private`;
      const now = Date.now();
      const rows = [
        {
          id: sharedQuestionId,
          couple_id: coupleId,
          sender_id: owner.id,
          sender_type: profile.role,
          role: "user",
          content: sharedQuestion,
          metadata: { target: "ai", client_request_id: randomUUID() },
          visibility: "shared",
          created_at: new Date(now - 4_000).toISOString(),
        },
        {
          id: sharedAnswerId,
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: sharedAnswer,
          metadata: {
            question_scope: "W0_wedding_core",
            memory_eligible: false,
            in_reply_to_user_message_id: sharedQuestionId,
          },
          visibility: "shared",
          created_at: new Date(now - 3_000).toISOString(),
        },
        {
          id: privateQuestionId,
          couple_id: coupleId,
          sender_id: owner.id,
          sender_type: profile.role,
          role: "user",
          content: privateQuestion,
          metadata: { target: "ai", client_request_id: randomUUID() },
          visibility: privateVisibility,
          created_at: new Date(now - 2_000).toISOString(),
        },
        {
          id: privateAnswerId,
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: privateAnswer,
          metadata: {
            question_scope: "W1_wedding_adjacent",
            memory_eligible: false,
            in_reply_to_user_message_id: privateQuestionId,
          },
          visibility: privateVisibility,
          created_at: new Date(now - 1_000).toISOString(),
        },
      ];
      const inserted = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: rows,
      });
      if (inserted.status !== 201) {
        fail("MESSAGE_REF_FIXTURE_INSERT_INVALID", "Message-ref fixtures were not inserted");
      }
      return Object.freeze({
        sharedQuestionId,
        sharedAnswerId,
        privateQuestionId,
        privateAnswerId,
        sharedQuestion,
        sharedAnswer,
        privateQuestion,
        privateAnswer,
      });
    },

    async readPrivacyEpoch(user, coupleId) {
      const response = await userCall(
        user,
        "/rest/v1/rpc/get_own_amora_privacy_epoch",
        {
          method: "POST",
          body: { p_couple_id: coupleId, p_visibility: "shared" },
        },
      );
      return response.body;
    },

    async callMessageRefRpcAsAuthenticated(user, input) {
      const response = await userCall(
        user,
        "/rest/v1/rpc/set_amora_preparation_topic_message_ref_v1",
        {
          method: "POST",
          body: {
            p_couple_id: input.coupleId,
            p_actor_user_id: input.actorUserId,
            p_topic_key: input.topicKey,
            p_message_id: input.messageId,
            p_desired_state: input.desiredState,
            p_expected_revision: input.expectedRevision,
            p_request_id: input.requestId,
            p_expected_privacy_epoch: input.expectedPrivacyEpoch,
          },
          allowDenied: true,
        },
      );
      return { denied: !response.ok && [401, 403, 404].includes(response.status) };
    },

    async readMessageRefTableAsAuthenticated(user) {
      const query = new URLSearchParams({ select: "id", limit: "1" });
      const response = await userCall(
        user,
        `/rest/v1/amora_preparation_topic_message_refs?${query}`,
        { allowDenied: true },
      );
      return { denied: !response.ok && [401, 403, 404].includes(response.status) };
    },

    async setMessageRefAsService(input) {
      return adminCall(
        "/rest/v1/rpc/set_amora_preparation_topic_message_ref_v1",
        {
          method: "POST",
          body: {
            p_couple_id: input.coupleId,
            p_actor_user_id: input.actorUserId,
            p_topic_key: input.topicKey,
            p_message_id: input.messageId,
            p_desired_state: input.desiredState,
            p_expected_revision: input.expectedRevision,
            p_request_id: input.requestId,
            p_expected_privacy_epoch: input.expectedPrivacyEpoch,
          },
          allowDenied: true,
        },
      );
    },

    async listMessageRefsAsService(input) {
      return adminCall(
        "/rest/v1/rpc/list_amora_preparation_topic_message_refs_v1",
        {
          method: "POST",
          body: {
            p_couple_id: input.coupleId,
            p_recipient_user_id: input.recipientUserId,
            p_expected_privacy_epoch: input.expectedPrivacyEpoch,
            p_limit: 80,
          },
          allowDenied: true,
        },
      );
    },

    async resolveMessageRefAsService(input) {
      return adminCall(
        "/rest/v1/rpc/resolve_amora_preparation_topic_message_ref_v1",
        {
          method: "POST",
          body: {
            p_couple_id: input.coupleId,
            p_recipient_user_id: input.recipientUserId,
            p_ref_id: input.refId,
            p_expected_privacy_epoch: input.expectedPrivacyEpoch,
          },
          allowDenied: true,
        },
      );
    },

    async deletePreparationTopicMessageFixtures(messageIds) {
      if (!Array.isArray(messageIds) || messageIds.length !== 4 || !messageIds.every(isUuid)) {
        fail("MESSAGE_REF_FIXTURE_DELETE_INVALID", "Message-ref fixture deletion was not exact");
      }
      const filter = `in.(${messageIds.join(",")})`;
      const query = new URLSearchParams({ id: filter });
      const response = await adminCall(`/rest/v1/chat_messages?${query}`, {
        method: "DELETE",
      });
      if (response.status !== 204) {
        fail("MESSAGE_REF_FIXTURE_DELETE_FAILED", "Message-ref fixture deletion failed");
      }
    },

    async readMessageRefResidue(input) {
      if (typeof messageRefResidueReader !== "function") {
        fail("MESSAGE_REF_RESIDUE_READER_MISSING", "A fixed read-only residue reader is required");
      }
      return messageRefResidueReader(input);
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

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function isCreatedPreparationSpace(value) {
  return value?.success === true
    && value?.created === true
    && value?.member_model_version === 2
    && isUuid(value?.couple_id)
    && typeof value?.invite_code === "string"
    && value.invite_code.length >= 8;
}

function isJoinedPreparationSpace(value, coupleId) {
  return value?.success === true
    && value?.joined === true
    && value?.member_model_version === 2
    && value?.couple_id === coupleId;
}

function isExactMutation(response, expected) {
  const value = response?.body;
  return response?.ok === true
    && response?.status === 200
    && value?.version === 1
    && value?.state === "ready"
    && value?.recipientUserId === expected.recipientUserId
    && value?.coupleId === expected.coupleId
    && value?.reused === expected.reused
    && value?.reference?.topicKey === expected.topicKey
    && value?.reference?.messageId === expected.messageId
    && value?.reference?.refId === expected.refId
    && value?.reference?.audience === expected.audience
    && value?.reference?.savedState === expected.savedState
    && value?.reference?.revision === expected.revision;
}

function exactListedReferences(response, expected) {
  const value = response?.body;
  if (
    response?.ok !== true
    || response?.status !== 200
    || value?.version !== 1
    || value?.state !== "ready"
    || value?.recipientUserId !== expected.recipientUserId
    || value?.coupleId !== expected.coupleId
    || value?.partial !== false
    || !Array.isArray(value?.references)
    || value.references.length !== expected.references.length
  ) return false;
  return expected.references.every(({ refId, topicKey, messageId, audience }) => (
    value.references.some((reference) => (
      reference?.refId === refId
      && reference?.topicKey === topicKey
      && reference?.messageId === messageId
      && reference?.audience === audience
      && reference?.canRemove === true
      && reference?.canOpenOriginal === true
      && typeof reference?.excerpt === "string"
      && reference.excerpt.length > 0
    ))
  ));
}

function isExactResolvedReference(response, expected) {
  const value = response?.body;
  return response?.ok === true
    && response?.status === 200
    && value?.version === 1
    && value?.state === "ready"
    && value?.recipientUserId === expected.recipientUserId
    && value?.coupleId === expected.coupleId
    && value?.reference?.refId === expected.refId
    && value?.reference?.topicKey === expected.topicKey
    && value?.reference?.messageId === expected.messageId
    && value?.reference?.audience === expected.audience
    && value?.target?.messageId === expected.messageId
    && value?.target?.lane === expected.lane
    && value?.target?.content === expected.answer
    && value?.question?.messageId === expected.questionMessageId
    && value?.question?.lane === expected.lane
    && value?.question?.content === expected.question;
}

export async function runPreparationTopicMessageRefScenario({ transport }) {
  if (!transport || typeof transport !== "object") {
    fail("TRANSPORT_INVALID", "A hosted staging transport is required");
  }

  const checks = {
    ownerSpace: false,
    partnerJoin: false,
    outsiderSpace: false,
    authenticatedRpcDenied: false,
    authenticatedTableDenied: false,
    sharedConcurrentReplay: false,
    privateSave: false,
    ownerList: false,
    partnerListPrivacy: false,
    outsiderIsolation: false,
    sharedResolve: false,
    privateResolve: false,
    partnerPrivateDenied: false,
    removeAndStaleRevision: false,
    cleanup: false,
  };
  const users = [];
  const coupleIds = [];
  const messageIds = [];
  let fixtures = null;
  let primaryError = null;

  try {
    const owner = await transport.createSyntheticUser("owner");
    users.push(owner);
    const partner = await transport.createSyntheticUser("partner");
    users.push(partner);
    const outsider = await transport.createSyntheticUser("outsider");
    users.push(outsider);
    requireScenario(
      users.every((user) => isUuid(user?.id) && typeof user?.accessToken === "string")
        && new Set(users.map(({ id }) => id)).size === 3,
      "MESSAGE_REF_SYNTHETIC_USERS_INVALID",
      "Message-ref probe users were not canonical",
    );

    const ownerSpace = await transport.createNeutralPreparationSpace(owner);
    checks.ownerSpace = isCreatedPreparationSpace(ownerSpace);
    requireScenario(checks.ownerSpace, "MESSAGE_REF_OWNER_SPACE_INVALID", "Owner preparation space was not canonical");
    coupleIds.push(ownerSpace.couple_id);

    const joined = await transport.joinNeutralPreparationSpaceServer(
      partner.id,
      ownerSpace.invite_code,
    );
    checks.partnerJoin = isJoinedPreparationSpace(joined, ownerSpace.couple_id);
    requireScenario(checks.partnerJoin, "MESSAGE_REF_PARTNER_JOIN_INVALID", "Partner did not join the owner space canonically");

    const outsiderSpace = await transport.createNeutralPreparationSpace(outsider);
    checks.outsiderSpace = isCreatedPreparationSpace(outsiderSpace)
      && outsiderSpace.couple_id !== ownerSpace.couple_id;
    requireScenario(checks.outsiderSpace, "MESSAGE_REF_OUTSIDER_SPACE_INVALID", "Outsider space was not isolated");
    coupleIds.push(outsiderSpace.couple_id);

    fixtures = await transport.createPreparationTopicMessageFixtures({
      owner,
      coupleId: ownerSpace.couple_id,
    });
    const fixtureKeys = [
      "sharedQuestionId", "sharedAnswerId", "privateQuestionId", "privateAnswerId",
    ];
    requireScenario(
      fixtureKeys.every((key) => isUuid(fixtures?.[key]))
        && new Set(fixtureKeys.map((key) => fixtures[key])).size === 4
        && [
          "sharedQuestion", "sharedAnswer", "privateQuestion", "privateAnswer",
        ].every((key) => typeof fixtures?.[key] === "string" && fixtures[key].length > 0),
      "MESSAGE_REF_FIXTURE_INVALID",
      "Message-ref source fixtures were not canonical",
    );
    messageIds.push(...fixtureKeys.map((key) => fixtures[key]));

    const privacyEpoch = await transport.readPrivacyEpoch(owner, ownerSpace.couple_id);
    requireScenario(
      Number.isSafeInteger(privacyEpoch) && privacyEpoch >= 1,
      "MESSAGE_REF_PRIVACY_EPOCH_INVALID",
      "Message-ref privacy epoch was unavailable",
    );
    const authenticatedRpc = await transport.callMessageRefRpcAsAuthenticated(owner, {
      coupleId: ownerSpace.couple_id,
      actorUserId: owner.id,
      topicKey: "meeting",
      messageId: fixtures.sharedAnswerId,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: randomUUID(),
      expectedPrivacyEpoch: privacyEpoch,
    });
    checks.authenticatedRpcDenied = authenticatedRpc?.denied === true;
    requireScenario(checks.authenticatedRpcDenied, "MESSAGE_REF_RPC_ACL_BYPASS", "Authenticated client reached the service-only message-ref RPC");
    const authenticatedTable = await transport.readMessageRefTableAsAuthenticated(owner);
    checks.authenticatedTableDenied = authenticatedTable?.denied === true;
    requireScenario(checks.authenticatedTableDenied, "MESSAGE_REF_TABLE_ACL_BYPASS", "Authenticated client read the private message-ref table");

    const sharedRequestId = randomUUID();
    const sharedInput = {
      coupleId: ownerSpace.couple_id,
      actorUserId: owner.id,
      topicKey: "meeting",
      messageId: fixtures.sharedAnswerId,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: sharedRequestId,
      expectedPrivacyEpoch: privacyEpoch,
    };
    const sharedResults = await Promise.all([
      transport.setMessageRefAsService(sharedInput),
      transport.setMessageRefAsService(sharedInput),
    ]);
    const successfulShared = sharedResults.filter((result) => result?.ok === true);
    const sharedRefIds = successfulShared.map((result) => result?.body?.reference?.refId);
    const sharedRefId = sharedRefIds[0] ?? null;
    checks.sharedConcurrentReplay = successfulShared.length === 2
      && isUuid(sharedRefId)
      && sharedRefIds.every((refId) => refId === sharedRefId)
      && successfulShared.map((result) => result.body?.reused).sort().join(",") === "false,true"
      && successfulShared.every((result) => isExactMutation(result, {
        recipientUserId: owner.id,
        coupleId: ownerSpace.couple_id,
        topicKey: "meeting",
        messageId: fixtures.sharedAnswerId,
        refId: sharedRefId,
        audience: "couple_shared",
        savedState: "saved",
        revision: 1,
        reused: result.body.reused,
      }));
    requireScenario(checks.sharedConcurrentReplay, "MESSAGE_REF_CONCURRENT_REPLAY_INVALID", "Concurrent shared save did not converge to one reference");

    const privateResult = await transport.setMessageRefAsService({
      coupleId: ownerSpace.couple_id,
      actorUserId: owner.id,
      topicKey: "housing",
      messageId: fixtures.privateAnswerId,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: randomUUID(),
      expectedPrivacyEpoch: privacyEpoch,
    });
    const privateRefId = privateResult?.body?.reference?.refId ?? null;
    checks.privateSave = isUuid(privateRefId) && isExactMutation(privateResult, {
      recipientUserId: owner.id,
      coupleId: ownerSpace.couple_id,
      topicKey: "housing",
      messageId: fixtures.privateAnswerId,
      refId: privateRefId,
      audience: "owner_private",
      savedState: "saved",
      revision: 1,
      reused: false,
    });
    requireScenario(checks.privateSave, "MESSAGE_REF_PRIVATE_SAVE_INVALID", "Private save was not canonical");

    const [ownerList, partnerList, outsiderList] = await Promise.all([
      transport.listMessageRefsAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: owner.id,
        expectedPrivacyEpoch: privacyEpoch,
      }),
      transport.listMessageRefsAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: partner.id,
        expectedPrivacyEpoch: privacyEpoch,
      }),
      transport.listMessageRefsAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: outsider.id,
        expectedPrivacyEpoch: privacyEpoch,
      }),
    ]);
    checks.ownerList = exactListedReferences(ownerList, {
      recipientUserId: owner.id,
      coupleId: ownerSpace.couple_id,
      references: [
        { refId: sharedRefId, topicKey: "meeting", messageId: fixtures.sharedAnswerId, audience: "couple_shared" },
        { refId: privateRefId, topicKey: "housing", messageId: fixtures.privateAnswerId, audience: "owner_private" },
      ],
    });
    checks.partnerListPrivacy = exactListedReferences(partnerList, {
      recipientUserId: partner.id,
      coupleId: ownerSpace.couple_id,
      references: [
        { refId: sharedRefId, topicKey: "meeting", messageId: fixtures.sharedAnswerId, audience: "couple_shared" },
      ],
    });
    checks.outsiderIsolation = outsiderList?.ok === false;
    requireScenario(checks.ownerList, "MESSAGE_REF_OWNER_LIST_INVALID", "Owner list did not contain exact shared and private refs");
    requireScenario(checks.partnerListPrivacy, "MESSAGE_REF_PARTNER_LIST_LEAK", "Partner list did not expose only the shared ref");
    requireScenario(checks.outsiderIsolation, "MESSAGE_REF_OUTSIDER_LEAK", "Outsider accessed another couple's refs");

    const [sharedResolved, privateResolved, partnerPrivate] = await Promise.all([
      transport.resolveMessageRefAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: partner.id,
        refId: sharedRefId,
        expectedPrivacyEpoch: privacyEpoch,
      }),
      transport.resolveMessageRefAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: owner.id,
        refId: privateRefId,
        expectedPrivacyEpoch: privacyEpoch,
      }),
      transport.resolveMessageRefAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: partner.id,
        refId: privateRefId,
        expectedPrivacyEpoch: privacyEpoch,
      }),
    ]);
    checks.sharedResolve = isExactResolvedReference(sharedResolved, {
      recipientUserId: partner.id,
      coupleId: ownerSpace.couple_id,
      refId: sharedRefId,
      topicKey: "meeting",
      messageId: fixtures.sharedAnswerId,
      questionMessageId: fixtures.sharedQuestionId,
      audience: "couple_shared",
      lane: "shared",
      question: fixtures.sharedQuestion,
      answer: fixtures.sharedAnswer,
    });
    checks.privateResolve = isExactResolvedReference(privateResolved, {
      recipientUserId: owner.id,
      coupleId: ownerSpace.couple_id,
      refId: privateRefId,
      topicKey: "housing",
      messageId: fixtures.privateAnswerId,
      questionMessageId: fixtures.privateQuestionId,
      audience: "owner_private",
      lane: "private",
      question: fixtures.privateQuestion,
      answer: fixtures.privateAnswer,
    });
    checks.partnerPrivateDenied = partnerPrivate?.ok === false;
    requireScenario(checks.sharedResolve, "MESSAGE_REF_SHARED_RESOLVE_INVALID", "Partner could not resolve exact shared original content");
    requireScenario(checks.privateResolve, "MESSAGE_REF_PRIVATE_RESOLVE_INVALID", "Owner could not resolve exact private original content");
    requireScenario(checks.partnerPrivateDenied, "MESSAGE_REF_PRIVATE_RESOLVE_LEAK", "Partner resolved an owner-private original");

    const removed = await transport.setMessageRefAsService({
      ...sharedInput,
      desiredState: "removed",
      expectedRevision: 1,
      requestId: randomUUID(),
    });
    const staleResave = await transport.setMessageRefAsService({
      ...sharedInput,
      expectedRevision: 0,
      requestId: randomUUID(),
    });
    const [afterRemoveList, afterRemoveResolve] = await Promise.all([
      transport.listMessageRefsAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: owner.id,
        expectedPrivacyEpoch: privacyEpoch,
      }),
      transport.resolveMessageRefAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: owner.id,
        refId: sharedRefId,
        expectedPrivacyEpoch: privacyEpoch,
      }),
    ]);
    checks.removeAndStaleRevision = isExactMutation(removed, {
      recipientUserId: owner.id,
      coupleId: ownerSpace.couple_id,
      topicKey: "meeting",
      messageId: fixtures.sharedAnswerId,
      refId: null,
      audience: "couple_shared",
      savedState: "removed",
      revision: 2,
      reused: false,
    })
      && staleResave?.ok === false
      && exactListedReferences(afterRemoveList, {
        recipientUserId: owner.id,
        coupleId: ownerSpace.couple_id,
        references: [
          { refId: privateRefId, topicKey: "housing", messageId: fixtures.privateAnswerId, audience: "owner_private" },
        ],
      })
      && afterRemoveResolve?.ok === false;
    requireScenario(checks.removeAndStaleRevision, "MESSAGE_REF_REMOVE_OR_STALE_INVALID", "Remove or stale-revision behavior was not fail-closed");
  } catch (error) {
    primaryError = error;
  } finally {
    if (fixtures) {
      try {
        await transport.deletePreparationTopicMessageFixtures(messageIds);
      } catch (error) {
        primaryError ??= error;
      }
    }
    for (const user of [...users].reverse()) {
      try {
        await transport.resetMembership(user);
      } catch {
        // Auth deletion remains the final cleanup boundary.
      }
    }
    for (const user of [...users].reverse()) {
      try {
        await transport.deleteSyntheticUser(user.id);
      } catch (error) {
        primaryError ??= error;
      }
    }
  }

  let residue = {
    profiles: Number.NaN,
    couples: Number.NaN,
    chatMessages: Number.NaN,
    messageRefs: Number.NaN,
  };
  try {
    residue = await transport.readMessageRefResidue({
      userIds: users.map(({ id }) => id),
      coupleIds,
      messageIds,
    });
    checks.cleanup = residue?.profiles === 0
      && residue?.couples === 0
      && residue?.chatMessages === 0
      && residue?.messageRefs === 0;
  } catch (error) {
    primaryError ??= error;
  }
  if (!checks.cleanup) {
    primaryError ??= new AmoraSuccessorStagingProbeError(
      "MESSAGE_REF_SYNTHETIC_RESIDUE_PRESENT",
      "Message-ref staging probe left synthetic rows behind",
    );
  }
  if (primaryError) throw primaryError;

  return Object.freeze({
    scenario: "preparation_topic_message_refs_three_account_v1",
    syntheticUserCount: users.length,
    checks: Object.freeze({ ...checks }),
    residue: Object.freeze({ ...residue }),
  });
}
