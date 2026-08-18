import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

const PROJECT_REF = /^[a-z0-9]{20}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const CRITERION_CONFIRMATION_CONTENT = "좋아요. 제안한 변경을 적용해 주세요.";
const FIRST_USE_ACTION_INPUT = Object.freeze({
  action: "예식 시기 후보 두 개 적기",
  reason: "먼저 범위를 줄이면 장소를 찾기 쉬워져요.",
  completionCriterion: "가능한 시기 두 개를 적으면 끝나요.",
});
const FIRST_USE_ADD_ACTION_INPUT = Object.freeze({
  title: FIRST_USE_ACTION_INPUT.action,
  description: `이유: ${FIRST_USE_ACTION_INPUT.reason} 완료 기준: ${FIRST_USE_ACTION_INPUT.completionCriterion}`,
  category_key: "general",
  priority: "medium",
  source: "chat",
});
const FIRST_USE_PRIVATE_ONLY_MARKER = "비공개 배경은 공유 결과에 나오면 안 돼요.";
const FIRST_USE_PRIVATE_CONTENT = [
  FIRST_USE_PRIVATE_ONLY_MARKER,
  `지금 할 한 가지: ${FIRST_USE_ACTION_INPUT.action}`,
  `이유: ${FIRST_USE_ACTION_INPUT.reason}`,
  `완료 기준: ${FIRST_USE_ACTION_INPUT.completionCriterion}`,
].join("\n");
const FIRST_USE_SHARED_CONTENT = [
  "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
  `지금 할 한 가지: ${FIRST_USE_ACTION_INPUT.action}`,
  `이유: ${FIRST_USE_ACTION_INPUT.reason}`,
  `완료 기준: ${FIRST_USE_ACTION_INPUT.completionCriterion}`,
  "저장 전에는 확인 카드만 보여줘.",
].join("\n");

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

function canonicalToolInput(value) {
  if (value === null) return "null";
  if (["string", "boolean"].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("TOOL_INPUT_INVALID", "Tool input contained a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalToolInput(item ?? null)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalToolInput(item)}`)
      .join(",")}}`;
  }
  fail("TOOL_INPUT_INVALID", "Tool input was not JSON-compatible");
}

function deriveToolIdentity(toolName, input) {
  const canonicalInput = canonicalToolInput(input);
  return Object.freeze({
    inputDigest: createHash("sha256").update(canonicalInput, "utf8").digest("hex"),
    operationKey: createHash("sha256")
      .update(`${toolName}\n${canonicalInput}`, "utf8")
      .digest("hex"),
  });
}

function uuidFromDigest(prefix) {
  const digest = createHash("sha256").update(prefix, "utf8").digest("hex").slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = "8";
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function deriveConfirmedActionRequestId(confirmationMessageId, pendingActionId) {
  return uuidFromDigest(
    `amora-confirmed-action-request\0${confirmationMessageId}\0${pendingActionId}`,
  );
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
    let safePath = "/unknown";
    try {
      safePath = new URL(url).pathname.replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/giu,
        "/:id",
      );
    } catch {
      // The caller receives a bounded path label, never the raw URL.
    }
    const sqlState = typeof parsed?.code === "string" && /^[0-9A-Z]{5}$/u.test(parsed.code)
      ? parsed.code
      : null;
    const reason = typeof parsed?.message === "string"
      && /^AMORA_[A-Z0-9_]{1,112}$/u.test(parsed.message)
      ? parsed.message
      : null;
    const diagnostic = sqlState === null
      ? ""
      : ` (SQLSTATE ${sqlState}${reason === null ? "" : `; ${reason}`})`;
    fail(
      "HOSTED_REQUEST_REJECTED",
      `Hosted staging request to ${safePath} returned HTTP ${response.status}${diagnostic}`,
    );
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

const CRITERION_ACTION_RESIDUE_SQL = `
SELECT
  (SELECT count(*)::integer FROM public.profiles AS row
   WHERE row.id = ANY($1::uuid[])) AS profiles,
  (SELECT count(*)::integer FROM public.couples AS row
   WHERE row.id = ANY($2::uuid[])) AS couples,
  (SELECT count(*)::integer FROM public.wedding_journeys AS row
   WHERE row.couple_id = ANY($2::uuid[])) AS journeys,
  (SELECT count(*)::integer FROM public.chat_messages AS row
   WHERE row.id = ANY($3::uuid[])
      OR row.sender_id = ANY($1::uuid[])
      OR row.couple_id = ANY($2::uuid[])) AS chat_messages,
  (SELECT count(*)::integer FROM public.amora_chat_request_claims AS row
   WHERE row.couple_id = ANY($2::uuid[])
      OR row.user_id = ANY($1::uuid[])
      OR row.user_message_id = ANY($3::uuid[])
      OR row.message_id = ANY($3::uuid[])) AS chat_claims,
  (SELECT count(*)::integer FROM public.amora_actions AS row
   WHERE row.id = ANY($4::text[])
      OR row.couple_id = ANY($2::uuid[])
      OR row.created_by = ANY($1::uuid[])) AS actions,
  (SELECT count(*)::integer FROM public.amora_tool_executions AS row
   WHERE row.couple_id = ANY($2::uuid[])) AS executions,
  (SELECT count(*)::integer FROM public.amora_shared_action_application_claims AS row
   WHERE row.couple_id = ANY($2::uuid[])
      OR row.source_message_id = ANY($3::uuid[])
      OR row.confirmation_message_id = ANY($3::uuid[])) AS application_claims,
  (SELECT count(*)::integer FROM public.amora_couple_core_criterion_proposals AS row
   WHERE row.couple_id = ANY($2::uuid[])
      OR row.proposer_user_id = ANY($1::uuid[])) AS criterion_proposals,
  (SELECT count(*)::integer FROM public.amora_couple_core_criterion_acceptances AS row
   WHERE row.couple_id = ANY($2::uuid[])
      OR row.user_id = ANY($1::uuid[])) AS criterion_acceptances,
  (SELECT count(*)::integer FROM public.decision_nodes AS row
   WHERE row.couple_id = ANY($2::uuid[])) AS decisions,
  (SELECT count(*)::integer FROM public.ai_interactions_log AS row
   WHERE row.couple_id = ANY($2::uuid[])
      OR row.user_id = ANY($1::uuid[])
      OR row.message_id = ANY($3::uuid[])) AS provider_receipts
`;

export function readHostedCriterionActionResidue({
  projectRef,
  productionProjectRef,
  managementToken,
  userIds,
  coupleIds,
  messageIds,
  actionIds,
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
      || values.length > 20
      || !values.every(isUuid)
      || new Set(values).size !== values.length
    ) {
      fail("CRITERION_RESIDUE_INPUT_INVALID", "Criterion residue identities must be bounded unique UUID arrays");
    }
  }
  if (
    !Array.isArray(actionIds)
    || actionIds.length < 1
    || actionIds.length > 10
    || !actionIds.every((value) => typeof value === "string" && value.length >= 1 && value.length <= 120)
    || new Set(actionIds).size !== actionIds.length
  ) {
    fail("CRITERION_RESIDUE_INPUT_INVALID", "Criterion residue action IDs must be bounded and unique");
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
            query: CRITERION_ACTION_RESIDUE_SQL,
            parameters: [userIds, coupleIds, messageIds, actionIds],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      fail("CRITERION_RESIDUE_UNAVAILABLE", "Hosted criterion-action residue request failed");
    }
    const body = await readBoundedJson(response, "CRITERION_RESIDUE_UNAVAILABLE");
    const row = response.status === 201 && Array.isArray(body) && body.length === 1
      ? body[0]
      : null;
    const keyMap = {
      profiles: "profiles",
      couples: "couples",
      journeys: "journeys",
      chatMessages: "chat_messages",
      chatClaims: "chat_claims",
      actions: "actions",
      executions: "executions",
      applicationClaims: "application_claims",
      criterionProposals: "criterion_proposals",
      criterionAcceptances: "criterion_acceptances",
      decisions: "decisions",
      providerReceipts: "provider_receipts",
    };
    const result = Object.fromEntries(
      Object.entries(keyMap).map(([outputKey, rowKey]) => [outputKey, row?.[rowKey]]),
    );
    if (!Object.values(result).every((value) => Number.isSafeInteger(value) && value >= 0)) {
      fail("CRITERION_RESIDUE_INVALID", "Hosted criterion-action residue was not canonical");
    }
    return Object.freeze(result);
  })();
}

const FIRST_USE_ACTION_RESIDUE_SQL = `
SELECT
  (SELECT count(*)::integer FROM public.profiles AS row
   WHERE row.id = ANY($1::uuid[])) AS profiles,
  (SELECT count(*)::integer FROM public.couples AS row
   WHERE row.id = ANY($2::uuid[])) AS couples,
  (SELECT count(*)::integer FROM public.wedding_journeys AS row
   WHERE row.couple_id = ANY($2::uuid[])) AS journeys,
  (SELECT count(*)::integer FROM public.chat_messages AS row
   WHERE row.id = ANY($3::uuid[])
      OR row.sender_id = ANY($1::uuid[])
      OR row.couple_id = ANY($2::uuid[])) AS chat_messages,
  (SELECT count(*)::integer FROM public.amora_chat_request_claims AS row
   WHERE row.couple_id = ANY($2::uuid[])
      OR row.user_id = ANY($1::uuid[])
      OR row.user_message_id = ANY($3::uuid[])
      OR row.message_id = ANY($3::uuid[])) AS chat_claims,
  (SELECT count(*)::integer FROM public.amora_first_use_action_promotions AS row
   WHERE row.id = ANY($4::uuid[])
      OR row.couple_id = ANY($2::uuid[])
      OR row.owner_user_id = ANY($1::uuid[])
      OR row.source_private_message_id = ANY($3::uuid[])
      OR row.shared_user_message_id = ANY($3::uuid[])) AS promotions,
  (SELECT count(*)::integer FROM public.amora_first_use_action_proposal_bindings AS row
   WHERE row.promotion_id = ANY($4::uuid[])
      OR row.couple_id = ANY($2::uuid[])
      OR row.proposal_message_id = ANY($3::uuid[])
      OR row.shared_user_message_id = ANY($3::uuid[])) AS proposal_bindings,
  (SELECT count(*)::integer FROM public.amora_actions AS row
   WHERE row.id = ANY($5::text[])
      OR row.couple_id = ANY($2::uuid[])
      OR row.created_by = ANY($1::uuid[])
      OR row.first_use_promotion_id = ANY($4::uuid[])) AS actions,
  (SELECT count(*)::integer FROM public.amora_tool_executions AS row
   WHERE row.couple_id = ANY($2::uuid[])) AS executions,
  (SELECT count(*)::integer FROM public.amora_shared_action_application_claims AS row
   WHERE row.couple_id = ANY($2::uuid[])
      OR row.source_message_id = ANY($3::uuid[])
      OR row.confirmation_message_id = ANY($3::uuid[])) AS application_claims,
  (SELECT count(*)::integer FROM public.ai_interactions_log AS row
   WHERE row.couple_id = ANY($2::uuid[])
      OR row.user_id = ANY($1::uuid[])
      OR row.message_id = ANY($3::uuid[])) AS provider_receipts
`;

export function readHostedFirstUseActionResidue({
  projectRef,
  productionProjectRef,
  managementToken,
  userIds,
  coupleIds,
  messageIds,
  promotionIds,
  actionIds,
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
  for (const values of [userIds, coupleIds, messageIds, promotionIds]) {
    if (
      !Array.isArray(values)
      || values.length < 1
      || values.length > 20
      || !values.every(isUuid)
      || new Set(values).size !== values.length
    ) {
      fail("FIRST_USE_RESIDUE_INPUT_INVALID", "First-use residue identities must be bounded unique UUID arrays");
    }
  }
  if (
    !Array.isArray(actionIds)
    || actionIds.length < 1
    || actionIds.length > 10
    || !actionIds.every((value) => typeof value === "string" && value.length >= 1 && value.length <= 120)
    || new Set(actionIds).size !== actionIds.length
  ) {
    fail("FIRST_USE_RESIDUE_INPUT_INVALID", "First-use residue action IDs must be bounded and unique");
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
            query: FIRST_USE_ACTION_RESIDUE_SQL,
            parameters: [userIds, coupleIds, messageIds, promotionIds, actionIds],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      fail("FIRST_USE_RESIDUE_UNAVAILABLE", "Hosted first-use residue request failed");
    }
    const body = await readBoundedJson(response, "FIRST_USE_RESIDUE_UNAVAILABLE");
    const row = response.status === 201 && Array.isArray(body) && body.length === 1
      ? body[0]
      : null;
    const keyMap = {
      profiles: "profiles",
      couples: "couples",
      journeys: "journeys",
      chatMessages: "chat_messages",
      chatClaims: "chat_claims",
      promotions: "promotions",
      proposalBindings: "proposal_bindings",
      actions: "actions",
      executions: "executions",
      applicationClaims: "application_claims",
      providerReceipts: "provider_receipts",
    };
    const result = Object.fromEntries(
      Object.entries(keyMap).map(([outputKey, rowKey]) => [outputKey, row?.[rowKey]]),
    );
    if (!Object.values(result).every((value) => Number.isSafeInteger(value) && value >= 0)) {
      fail("FIRST_USE_RESIDUE_INVALID", "Hosted first-use residue was not canonical");
    }
    return Object.freeze(result);
  })();
}

const BOOKING_OUTCOME_RESIDUE_SQL = `
SELECT
  (SELECT count(*)::integer FROM public.profiles AS row
   WHERE row.id = ANY($1::uuid[])) AS profiles,
  (SELECT count(*)::integer FROM public.couples AS row
   WHERE row.id = ANY($2::uuid[])) AS couples,
  (SELECT count(*)::integer FROM public.wedding_journeys AS row
   WHERE row.couple_id = ANY($2::uuid[])) AS journeys,
  (SELECT count(*)::integer FROM public.vendors AS row
   WHERE row.id = ANY($3::uuid[])
      OR row.owner_id = ANY($1::uuid[])) AS vendors,
  (SELECT count(*)::integer FROM public.vendor_timeslots AS row
   WHERE row.vendor_id = ANY($3::uuid[])) AS timeslots,
  (SELECT count(*)::integer FROM public.vendor_bookings AS row
   WHERE row.id = ANY($4::uuid[])
      OR row.couple_id = ANY($2::uuid[])
      OR row.vendor_id = ANY($3::uuid[])
      OR row.intent_created_by_profile_id = ANY($1::uuid[])) AS bookings,
  (SELECT count(*)::integer FROM public.vendor_reviews AS row
   WHERE row.booking_id = ANY($4::uuid[])
      OR row.vendor_id = ANY($3::uuid[])
      OR row.customer_id = ANY($1::uuid[])) AS reviews,
  (SELECT count(*)::integer FROM public.decision_nodes AS row
   WHERE row.id = ANY($5::uuid[])
      OR row.couple_id = ANY($2::uuid[])
      OR row.source_ref_id = ANY($4::uuid[])) AS decisions,
  (SELECT count(*)::integer FROM public.booking_intent_write_authorizations AS row
   WHERE row.booking_id = ANY($4::uuid[])
      OR row.couple_id = ANY($2::uuid[])
      OR row.vendor_id = ANY($3::uuid[])
      OR row.actor_profile_id = ANY($1::uuid[])) AS intent_authorizations,
  (SELECT count(*)::integer FROM public.booking_outcome_write_authorizations AS row
   WHERE row.booking_id = ANY($4::uuid[])
      OR row.couple_id = ANY($2::uuid[])
      OR row.actor_profile_id = ANY($1::uuid[])) AS outcome_authorizations,
  (SELECT count(*)::integer FROM public.booking_projection_jobs AS row
   WHERE row.booking_id = ANY($4::uuid[])) AS projection_jobs
`;

const BOOKING_OUTCOME_AUTHORIZATION_COUNT_SQL = `
SELECT count(*)::integer AS authorization_count
FROM public.booking_outcome_write_authorizations AS row
WHERE row.booking_id = $1::uuid
  AND row.couple_id = $2::uuid
  AND row.actor_profile_id = $3::uuid
`;

export async function readHostedBookingOutcomeAuthorizationCount({
  projectRef,
  productionProjectRef,
  managementToken,
  bookingId,
  coupleId,
  actorProfileId,
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
  if (![bookingId, coupleId, actorProfileId].every(isUuid)) {
    fail("BOOKING_OUTCOME_AUTHORIZATION_INPUT_INVALID", "Booking outcome authorization identity was not canonical");
  }

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
          query: BOOKING_OUTCOME_AUTHORIZATION_COUNT_SQL,
          parameters: [bookingId, coupleId, actorProfileId],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    fail("BOOKING_OUTCOME_AUTHORIZATION_UNAVAILABLE", "Hosted booking outcome authorization read failed");
  }
  const body = await readBoundedJson(response, "BOOKING_OUTCOME_AUTHORIZATION_UNAVAILABLE");
  const count = response.status === 201 && Array.isArray(body) && body.length === 1
    ? body[0]?.authorization_count
    : null;
  if (!Number.isSafeInteger(count) || count < 0) {
    fail("BOOKING_OUTCOME_AUTHORIZATION_INVALID", "Hosted booking outcome authorization count was not canonical");
  }
  return count;
}

export function readHostedBookingOutcomeResidue({
  projectRef,
  productionProjectRef,
  managementToken,
  userIds,
  coupleIds,
  vendorIds,
  bookingIds,
  decisionIds,
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
  for (const values of [userIds, coupleIds, vendorIds, bookingIds, decisionIds]) {
    if (
      !Array.isArray(values)
      || values.length < 1
      || values.length > 10
      || !values.every(isUuid)
      || new Set(values).size !== values.length
    ) {
      fail("BOOKING_OUTCOME_RESIDUE_INPUT_INVALID", "Booking outcome residue identities must be bounded unique UUID arrays");
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
            query: BOOKING_OUTCOME_RESIDUE_SQL,
            parameters: [userIds, coupleIds, vendorIds, bookingIds, decisionIds],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      fail("BOOKING_OUTCOME_RESIDUE_UNAVAILABLE", "Hosted booking outcome residue request failed");
    }
    const body = await readBoundedJson(response, "BOOKING_OUTCOME_RESIDUE_UNAVAILABLE");
    const row = response.status === 201 && Array.isArray(body) && body.length === 1
      ? body[0]
      : null;
    const keyMap = {
      profiles: "profiles",
      couples: "couples",
      journeys: "journeys",
      vendors: "vendors",
      timeslots: "timeslots",
      bookings: "bookings",
      reviews: "reviews",
      decisions: "decisions",
      intentAuthorizations: "intent_authorizations",
      outcomeAuthorizations: "outcome_authorizations",
      projectionJobs: "projection_jobs",
    };
    const result = Object.fromEntries(
      Object.entries(keyMap).map(([outputKey, rowKey]) => [outputKey, row?.[rowKey]]),
    );
    if (!Object.values(result).every((value) => Number.isSafeInteger(value) && value >= 0)) {
      fail("BOOKING_OUTCOME_RESIDUE_INVALID", "Hosted booking outcome residue was not canonical");
    }
    return Object.freeze(result);
  })();
}

export function createSupabaseStagingTransport({
  projectRef,
  anonKey,
  serviceRoleKey,
  fetchImpl = fetch,
  runNonce = `${Date.now()}-${randomBytes(6).toString("hex")}`,
  messageRefResidueReader = null,
  criterionActionResidueReader = null,
  firstUseActionResidueReader = null,
  bookingOutcomeAuthorizationCountReader = null,
  bookingOutcomeResidueReader = null,
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

    async createMediationDraftFixture({ owner, coupleId }) {
      if (!isUuid(owner?.id) || !isUuid(coupleId)) {
        fail("MEDIATION_FIXTURE_SCOPE_INVALID", "Mediation fixture scope was not canonical");
      }
      const profileQuery = new URLSearchParams({
        select: "id,couple_id,role",
        id: `eq.${owner.id}`,
        couple_id: `eq.${coupleId}`,
      });
      const coupleQuery = new URLSearchParams({
        select: "id,bride_id,groom_id",
        id: `eq.${coupleId}`,
      });
      const [profileResponse, coupleResponse] = await Promise.all([
        adminCall(`/rest/v1/profiles?${profileQuery}`),
        adminCall(`/rest/v1/couples?${coupleQuery}`),
      ]);
      const profile = Array.isArray(profileResponse.body) && profileResponse.body.length === 1
        ? profileResponse.body[0]
        : null;
      const couple = Array.isArray(coupleResponse.body) && coupleResponse.body.length === 1
        ? coupleResponse.body[0]
        : null;
      const expectedRole = couple?.bride_id === owner.id && couple?.groom_id !== owner.id
        ? "bride"
        : couple?.groom_id === owner.id && couple?.bride_id !== owner.id
          ? "groom"
          : null;
      if (
        profile?.id !== owner.id
        || profile?.couple_id !== coupleId
        || profile?.role !== expectedRole
        || couple?.id !== coupleId
        || (couple.bride_id !== null && !isUuid(couple.bride_id))
        || (couple.groom_id !== null && !isUuid(couple.groom_id))
      ) {
        fail("MEDIATION_FIXTURE_OWNER_INVALID", "Mediation fixture owner was not roster-bound");
      }

      const draftId = randomUUID();
      const privateVisibility = `${expectedRole}_private`;
      const rosterFingerprint = createHash("md5")
        .update(`${couple.bride_id ?? "-"}:${couple.groom_id ?? "-"}`, "utf8")
        .digest("hex");
      const inserted = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: {
          id: draftId,
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: "private outer prose",
          metadata: {
            question_scope: "W1_wedding_adjacent",
            memory_eligible: false,
            mediation_draft_state: "draft",
            mediation_draft_sendable: true,
            mediation_draft_roster_fingerprint: rosterFingerprint,
            mediation: {
              empathy: "요청한 분의 걱정을 먼저 정리했어요.",
              translation: "상대에게 전할 핵심을 비난 없이 풀었어요.",
              data: "이 내용은 요청한 분이 제공한 설명만 바탕으로 해요.",
              resolution: "서로 가능한 선택을 차분히 확인해요.",
              origin: "user_requested",
              evidenceScope: "requester_summary_only",
              schemaVersion: 2,
            },
          },
          visibility: privateVisibility,
        },
      });
      if (inserted.status !== 201) {
        fail("MEDIATION_FIXTURE_INSERT_INVALID", "Private mediation fixture was not inserted");
      }
      return Object.freeze({ draftId, privateVisibility });
    },

    async attemptDirectSharedMediation({ coupleId }) {
      if (!isUuid(coupleId)) {
        fail("MEDIATION_DIRECT_SCOPE_INVALID", "Direct mediation scope was not canonical");
      }
      const messageId = randomUUID();
      const response = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: {
          id: messageId,
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: "요청하신 분이 초안을 읽고 이 카드를 보냈어요.",
          metadata: {
            mediation: {
              empathy: "근거 없는 직접 공유 시도예요.",
              translation: "비공개 초안 연결이 없어요.",
              data: "경계 검증용 합성 행이에요.",
              resolution: "이 행은 저장되면 안 돼요.",
              origin: "user_requested",
              evidenceScope: "requester_summary_only",
              schemaVersion: 2,
            },
            mediation_share_origin: "requester_sent",
            question_scope: "W1_wedding_adjacent",
            memory_eligible: false,
          },
          visibility: "shared",
        },
        allowDenied: true,
      });
      return Object.freeze({ denied: !response.ok, messageId });
    },

    async callShareMediationAsAuthenticated(user, { draftId, userId }) {
      if (!isUuid(draftId) || !isUuid(userId) || !isUuid(user?.id)) {
        fail("MEDIATION_SHARE_INPUT_INVALID", "Authenticated mediation share input was not canonical");
      }
      const response = await userCall(
        user,
        "/rest/v1/rpc/share_amora_mediation_draft",
        {
          method: "POST",
          body: {
            p_draft_message_id: draftId,
            p_user_id: userId,
            p_accept: false,
          },
          allowDenied: true,
        },
      );
      return Object.freeze({ denied: !response.ok });
    },

    async shareMediationAsService({ draftId, userId, accept }) {
      if (!isUuid(draftId) || !isUuid(userId) || typeof accept !== "boolean") {
        fail("MEDIATION_SHARE_INPUT_INVALID", "Service mediation share input was not canonical");
      }
      return adminCall(
        "/rest/v1/rpc/share_amora_mediation_draft",
        {
          method: "POST",
          body: {
            p_draft_message_id: draftId,
            p_user_id: userId,
            p_accept: accept,
          },
          allowDenied: true,
        },
      );
    },

    async readMediationMessageAsUser(user, messageId) {
      if (!isUuid(user?.id) || !isUuid(messageId)) {
        fail("MEDIATION_READ_INPUT_INVALID", "Mediation message read input was not canonical");
      }
      const query = new URLSearchParams({
        select: "id,visibility,content,metadata",
        id: `eq.${messageId}`,
      });
      const response = await userCall(user, `/rest/v1/chat_messages?${query}`);
      if (!Array.isArray(response.body) || response.body.length > 1) {
        fail("MEDIATION_READ_INVALID", "Mediation message read was not bounded");
      }
      return response.body;
    },

    async deleteMediationFixtures(messageIds) {
      if (
        !Array.isArray(messageIds)
        || messageIds.length < 1
        || messageIds.length > 3
        || !messageIds.every(isUuid)
        || new Set(messageIds).size !== messageIds.length
      ) {
        fail("MEDIATION_FIXTURE_DELETE_INVALID", "Mediation fixture deletion was not exact");
      }
      const query = new URLSearchParams({ id: `in.(${messageIds.join(",")})` });
      const response = await adminCall(`/rest/v1/chat_messages?${query}`, {
        method: "DELETE",
      });
      if (response.status !== 204) {
        fail("MEDIATION_FIXTURE_DELETE_FAILED", "Mediation fixture deletion failed");
      }
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
        || typeof owner?.accessToken !== "string"
        || owner.accessToken.length < 8
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

    async callPreparationNotesRpcAsAuthenticated(user, input) {
      const response = await userCall(
        user,
        "/rest/v1/rpc/list_amora_preparation_notes_v1",
        {
          method: "POST",
          body: {
            p_couple_id: input.coupleId,
            p_recipient_user_id: input.recipientUserId,
            p_expected_privacy_epoch: input.expectedPrivacyEpoch,
            p_query: input.query,
            p_snapshot_at: null,
            p_cursor_saved_at: null,
            p_cursor_ref_id: null,
            p_limit: 24,
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

    async listPreparationNotesAsService(input) {
      return adminCall(
        "/rest/v1/rpc/list_amora_preparation_notes_v1",
        {
          method: "POST",
          body: {
            p_couple_id: input.coupleId,
            p_recipient_user_id: input.recipientUserId,
            p_expected_privacy_epoch: input.expectedPrivacyEpoch,
            p_query: input.query,
            p_snapshot_at: null,
            p_cursor_saved_at: null,
            p_cursor_ref_id: null,
            p_limit: 24,
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

    async prepareFirstUsePrivateSource({ owner, partner, coupleId }) {
      if (
        !isUuid(owner?.id)
        || typeof owner?.accessToken !== "string"
        || owner.accessToken.length < 8
        || !isUuid(partner?.id)
        || owner.id === partner.id
        || !isUuid(coupleId)
      ) {
        fail("FIRST_USE_SOURCE_SCOPE_INVALID", "First-use source scope was not canonical");
      }
      const profileQuery = new URLSearchParams({
        select: "id,couple_id,role",
        id: `eq.${owner.id}`,
        couple_id: `eq.${coupleId}`,
      });
      const coupleQuery = new URLSearchParams({
        select: "id,bride_id,groom_id",
        id: `eq.${coupleId}`,
      });
      const journeyQuery = new URLSearchParams({
        select: "couple_id,state_revision",
        couple_id: `eq.${coupleId}`,
      });
      const criterionQuery = new URLSearchParams({
        select: "id",
        couple_id: `eq.${coupleId}`,
        category: "eq.preference",
        decision_type: "eq.decided",
        visibility: "eq.shared",
        source: "eq.manual",
        source_actor_role: "is.null",
        order: "user_confirmed_at.desc.nullslast,created_at.desc,id.desc",
        limit: "1",
      });
      const [profileResponse, coupleResponse, journeyResponse, criterionResponse] = await Promise.all([
        adminCall(`/rest/v1/profiles?${profileQuery}`),
        adminCall(`/rest/v1/couples?${coupleQuery}`),
        adminCall(`/rest/v1/wedding_journeys?${journeyQuery}`),
        adminCall(`/rest/v1/decision_nodes?${criterionQuery}`),
      ]);
      const profile = Array.isArray(profileResponse.body) && profileResponse.body.length === 1
        ? profileResponse.body[0]
        : null;
      const couple = Array.isArray(coupleResponse.body) && coupleResponse.body.length === 1
        ? coupleResponse.body[0]
        : null;
      let journey = Array.isArray(journeyResponse.body) && journeyResponse.body.length === 1
        ? journeyResponse.body[0]
        : null;
      const expectedRole = couple?.bride_id === owner.id && couple?.groom_id === partner.id
        ? "bride"
        : couple?.groom_id === owner.id && couple?.bride_id === partner.id
          ? "groom"
          : null;
      if (
        profile?.id !== owner.id
        || profile?.couple_id !== coupleId
        || profile?.role !== expectedRole
        || couple?.id !== coupleId
        || !isUuid(couple?.bride_id)
        || !isUuid(couple?.groom_id)
        || !Array.isArray(criterionResponse.body)
        || criterionResponse.body.length !== 0
      ) {
        fail("FIRST_USE_SOURCE_ROSTER_INVALID", "First-use source roster was not neutral and canonical");
      }
      if (journey === null && Array.isArray(journeyResponse.body) && journeyResponse.body.length === 0) {
        const insertedJourney = await adminCall("/rest/v1/wedding_journeys", {
          method: "POST",
          body: {
            couple_id: coupleId,
            wedding_date: null,
            venue: null,
            total_budget: 0,
            progress: {},
          },
        });
        if (insertedJourney.status !== 201) {
          fail("FIRST_USE_SOURCE_JOURNEY_BOOTSTRAP_INVALID", "Neutral first-use journey was not created");
        }
        const canonicalJourney = await adminCall(`/rest/v1/wedding_journeys?${journeyQuery}`);
        journey = Array.isArray(canonicalJourney.body) && canonicalJourney.body.length === 1
          ? canonicalJourney.body[0]
          : null;
      }
      if (
        journey?.couple_id !== coupleId
        || !Number.isSafeInteger(journey?.state_revision)
        || journey.state_revision < 0
      ) {
        fail("FIRST_USE_SOURCE_JOURNEY_INVALID", "First-use source journey was not canonical");
      }
      const privateVisibility = `${expectedRole}_private`;
      const privacyResponse = await userCall(
        owner,
        "/rest/v1/rpc/get_own_amora_privacy_epoch",
        {
          method: "POST",
          body: { p_couple_id: coupleId, p_visibility: privateVisibility },
        },
      );
      const privacyEpoch = privacyResponse.body;
      if (!Number.isSafeInteger(privacyEpoch) || privacyEpoch < 1) {
        fail("FIRST_USE_SOURCE_PRIVACY_INVALID", "First-use source privacy epoch was not canonical");
      }

      const sourceUserMessageId = randomUUID();
      const sourcePrivateMessageId = randomUUID();
      const sourceVisibleRequestId = randomUUID();
      const sourceRequestKey = `chat:${owner.id}:${sourceVisibleRequestId}`;
      const rosterFingerprint = createHash("md5")
        .update(`${couple.bride_id}:${couple.groom_id}`, "utf8")
        .digest("hex");
      const sourceContentDigest = sha256Text(FIRST_USE_PRIVATE_CONTENT);
      const sharedContentDigest = sha256Text(FIRST_USE_SHARED_CONTENT);
      const actionIdentity = deriveToolIdentity(
        "add_amora_action",
        FIRST_USE_ADD_ACTION_INPUT,
      );
      const sourceSeal = {
        version: 1,
        sourceContentDigest,
        journeyRevision: journey.state_revision,
        privacyEpoch,
        rosterFingerprint,
        criterionDecisionId: null,
        canonicalActionInput: FIRST_USE_ACTION_INPUT,
        actionDigest: actionIdentity.inputDigest,
        sharedContentDigest,
      };
      const insertedSourceUser = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: {
          id: sourceUserMessageId,
          couple_id: coupleId,
          sender_id: owner.id,
          sender_type: expectedRole,
          sender_role: null,
          role: "user",
          content: "예식 시기부터 어떻게 좁힐지 나만 먼저 정리하고 싶어요.",
          metadata: {
            client_request_id: sourceVisibleRequestId,
            amora_ingest_contract_version: 2,
            ai_response_requested: true,
            provider_attachment_state: "none",
            provider_attachment_count: 0,
          },
          visibility: privateVisibility,
          stage_tag: null,
          specialist_type: null,
        },
      });
      if (insertedSourceUser.status !== 201) {
        fail("FIRST_USE_SOURCE_USER_INSERT_INVALID", "First-use private user message was not inserted");
      }
      const sourceClaim = await adminCall("/rest/v1/rpc/claim_amora_chat_request", {
        method: "POST",
        body: {
          p_couple_id: coupleId,
          p_request_key: sourceRequestKey,
          p_user_id: owner.id,
          p_visibility: privateVisibility,
          p_user_message_id: sourceUserMessageId,
        },
      });
      if (
        sourceClaim.body?.action !== "acquired"
        || !Number.isSafeInteger(sourceClaim.body?.attempt_count)
        || sourceClaim.body.attempt_count < 1
      ) {
        fail("FIRST_USE_SOURCE_CLAIM_INVALID", "First-use private request was not claimed");
      }
      const insertedSourceAssistant = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: {
          id: sourcePrivateMessageId,
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          sender_role: null,
          role: "assistant",
          content: FIRST_USE_PRIVATE_CONTENT,
          metadata: {
            client_request_id: sourceRequestKey,
            in_reply_to_user_message_id: sourceUserMessageId,
            question_scope: "W0_wedding_core",
            memory_eligible: false,
            memory_enqueue_requested: false,
            amora_wedding_context_revision: journey.state_revision,
            amora_first_use_grounding: {
              version: 1,
              sourceRevision: journey.state_revision,
              confirmed: [],
              unknowns: [{
                key: "current_progress",
                label: "이미 마친 준비와 아직 남은 준비",
              }],
            },
            amora_first_use_action_promotion_v1: sourceSeal,
          },
          visibility: privateVisibility,
          stage_tag: null,
          specialist_type: "general",
        },
      });
      if (insertedSourceAssistant.status !== 201) {
        fail("FIRST_USE_SOURCE_ASSISTANT_INSERT_INVALID", "First-use private assistant message was not inserted");
      }
      const completedSource = await adminCall("/rest/v1/rpc/complete_amora_chat_request", {
        method: "POST",
        body: {
          p_couple_id: coupleId,
          p_request_key: sourceRequestKey,
          p_user_id: owner.id,
          p_message_id: sourcePrivateMessageId,
        },
      });
      if (completedSource.body !== true) {
        fail("FIRST_USE_SOURCE_COMPLETE_INVALID", "First-use private request was not completed");
      }
      const insertedProviderReceipt = await adminCall("/rest/v1/ai_interactions_log", {
        method: "POST",
        body: {
          id: randomUUID(),
          user_id: owner.id,
          couple_id: coupleId,
          interaction_type: "amora_director",
          success: true,
          model: "hosted-probe-synthetic",
          metadata: { hosted_probe_fixture: true },
          amora_request_key: sourceRequestKey,
          amora_call_index: 1,
          amora_call_source: "durable",
          amora_call_phase: "final_no_tool",
          amora_claim_token: randomUUID(),
          amora_cost_status: "settled",
          amora_reserved_cost_microusd: 0,
          amora_actual_cost_microusd: 0,
          amora_receipt_updated_at: new Date().toISOString(),
        },
      });
      if (insertedProviderReceipt.status !== 201) {
        fail("FIRST_USE_SOURCE_RECEIPT_INVALID", "First-use synthetic provider receipt was not inserted");
      }
      return Object.freeze({
        coupleId,
        ownerUserId: owner.id,
        sourceUserMessageId,
        sourcePrivateMessageId,
        sourceRequestKey,
        privateVisibility,
        privateContent: FIRST_USE_PRIVATE_CONTENT,
        privateOnlyMarker: FIRST_USE_PRIVATE_ONLY_MARKER,
        canonicalActionInput: FIRST_USE_ACTION_INPUT,
        canonicalAddActionInput: FIRST_USE_ADD_ACTION_INPUT,
        canonicalSharedText: FIRST_USE_SHARED_CONTENT,
        sourceContentDigest,
        actionDigest: actionIdentity.inputDigest,
        sharedContentDigest,
        privacyEpoch,
        journeyRevision: journey.state_revision,
        providerReceiptCount: 1,
        messageIds: Object.freeze([sourceUserMessageId, sourcePrivateMessageId]),
      });
    },

    async attemptFirstUseFinalizerAsAuthenticated(owner, source) {
      if (!isUuid(owner?.id) || !isUuid(source?.coupleId)) {
        fail("FIRST_USE_AUTHENTICATED_PROBE_INVALID", "Authenticated first-use probe was not canonical");
      }
      const requestId = randomUUID();
      const response = await userCall(
        owner,
        "/rest/v1/rpc/finalize_amora_first_use_action_proposal_v1",
        {
          method: "POST",
          body: {
            p_couple_id: source.coupleId,
            p_owner_user_id: owner.id,
            p_shared_user_message_id: randomUUID(),
            p_chat_request_key: `chat:${owner.id}:${requestId}`,
            p_chat_claim_attempt_count: 1,
            p_expected_privacy_epoch: source.privacyEpoch,
          },
          allowDenied: true,
        },
      );
      return Object.freeze({ denied: !response.ok });
    },

    async ingestFirstUsePromotion(source) {
      if (
        !isUuid(source?.coupleId)
        || !isUuid(source?.ownerUserId)
        || !isUuid(source?.sourcePrivateMessageId)
        || typeof source?.canonicalSharedText !== "string"
        || source.canonicalSharedText.length < 1
        || typeof source?.sourceContentDigest !== "string"
        || !/^[a-f0-9]{64}$/u.test(source.sourceContentDigest)
        || typeof source?.actionDigest !== "string"
        || !/^[a-f0-9]{64}$/u.test(source.actionDigest)
        || typeof source?.sharedContentDigest !== "string"
        || !/^[a-f0-9]{64}$/u.test(source.sharedContentDigest)
        || source?.canonicalActionInput === null
        || typeof source?.canonicalActionInput !== "object"
        || Array.isArray(source.canonicalActionInput)
      ) {
        fail("FIRST_USE_PROMOTION_INPUT_INVALID", "First-use promotion input was not canonical");
      }
      const clientRequestId = randomUUID();
      const response = await adminCall(
        "/rest/v1/rpc/ingest_amora_first_use_action_promotion_v1",
        {
          method: "POST",
          body: {
            p_couple_id: source.coupleId,
            p_owner_user_id: source.ownerUserId,
            p_source_private_message_id: source.sourcePrivateMessageId,
            p_client_request_id: clientRequestId,
            p_content: source.canonicalSharedText,
            p_source_content_digest: source.sourceContentDigest,
            p_canonical_action_input: source.canonicalActionInput,
            p_action_digest: source.actionDigest,
            p_shared_content_digest: source.sharedContentDigest,
          },
        },
      );
      if (
        response.body?.version !== 1
        || !isUuid(response.body?.promotionId)
        || !isUuid(response.body?.sharedMessageId)
        || typeof response.body?.reused !== "boolean"
      ) {
        fail("FIRST_USE_PROMOTION_RESPONSE_INVALID", "First-use promotion response was not canonical");
      }
      return Object.freeze({ ...response.body, clientRequestId });
    },

    async claimFirstUseProposal({ owner, source, promotion }) {
      if (
        !isUuid(owner?.id)
        || owner.id !== source?.ownerUserId
        || !isUuid(source?.coupleId)
        || !isUuid(promotion?.sharedMessageId)
      ) {
        fail("FIRST_USE_PROPOSAL_CLAIM_INPUT_INVALID", "First-use proposal claim input was not canonical");
      }
      const requestKey = `chat:${owner.id}:${randomUUID()}`;
      const response = await adminCall("/rest/v1/rpc/claim_amora_chat_request", {
        method: "POST",
        body: {
          p_couple_id: source.coupleId,
          p_request_key: requestKey,
          p_user_id: owner.id,
          p_visibility: "shared",
          p_user_message_id: promotion.sharedMessageId,
        },
      });
      if (
        response.body?.action !== "acquired"
        || !Number.isSafeInteger(response.body?.attempt_count)
        || response.body.attempt_count < 1
      ) {
        fail("FIRST_USE_PROPOSAL_CLAIM_INVALID", "First-use proposal request was not claimed");
      }
      return Object.freeze({
        requestKey,
        attemptCount: response.body.attempt_count,
      });
    },

    async finalizeFirstUseProposal({ owner, source, promotion, requestKey, attemptCount }) {
      if (
        !isUuid(owner?.id)
        || !isUuid(source?.coupleId)
        || !isUuid(promotion?.sharedMessageId)
        || typeof requestKey !== "string"
        || !Number.isSafeInteger(attemptCount)
        || !Number.isSafeInteger(source?.privacyEpoch)
      ) {
        fail("FIRST_USE_PROPOSAL_FINALIZER_INPUT_INVALID", "First-use proposal finalizer input was not canonical");
      }
      const response = await adminCall(
        "/rest/v1/rpc/finalize_amora_first_use_action_proposal_v1",
        {
          method: "POST",
          body: {
            p_couple_id: source.coupleId,
            p_owner_user_id: owner.id,
            p_shared_user_message_id: promotion.sharedMessageId,
            p_chat_request_key: requestKey,
            p_chat_claim_attempt_count: attemptCount,
            p_expected_privacy_epoch: source.privacyEpoch,
          },
        },
      );
      return response.body;
    },

    async prepareFirstUseApplication({ owner, source, promotion, proposal }) {
      if (
        !isUuid(owner?.id)
        || owner.id !== source?.ownerUserId
        || !isUuid(source?.coupleId)
        || !isUuid(promotion?.promotionId)
        || !isUuid(proposal?.messageId)
        || !isUuid(proposal?.pendingActionId)
      ) {
        fail("FIRST_USE_APPLICATION_INPUT_INVALID", "First-use application input was not canonical");
      }
      const lease = await adminCall(
        "/rest/v1/rpc/claim_amora_shared_action_application",
        {
          method: "POST",
          body: {
            p_action_id: proposal.pendingActionId,
            p_couple_id: source.coupleId,
            p_source_message_id: proposal.messageId,
            p_user_id: owner.id,
          },
        },
      );
      if (lease.body?.applicationGranted !== true) {
        fail("FIRST_USE_APPLICATION_LEASE_INVALID", "First-use action application was not granted");
      }
      const confirmationMessageId = randomUUID();
      const visibleRequestId = randomUUID();
      const confirmation = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: {
          id: confirmationMessageId,
          couple_id: source.coupleId,
          sender_id: owner.id,
          sender_type: source.privateVisibility === "groom_private" ? "groom" : "bride",
          sender_role: null,
          role: "user",
          content: CRITERION_CONFIRMATION_CONTENT,
          metadata: {
            client_request_id: visibleRequestId,
            confirmed_amora_action_id: proposal.pendingActionId,
            amora_ingest_contract_version: 2,
            ai_response_requested: true,
            provider_attachment_state: "none",
            provider_attachment_count: 0,
          },
          visibility: "shared",
          stage_tag: null,
          specialist_type: null,
        },
      });
      if (confirmation.status !== 201) {
        fail("FIRST_USE_CONFIRMATION_INSERT_INVALID", "First-use confirmation was not inserted");
      }
      const applicationRequestId = deriveConfirmedActionRequestId(
        confirmationMessageId,
        proposal.pendingActionId,
      );
      const requestKey = `chat:${owner.id}:${applicationRequestId}`;
      const claim = await adminCall("/rest/v1/rpc/claim_amora_chat_request", {
        method: "POST",
        body: {
          p_couple_id: source.coupleId,
          p_request_key: requestKey,
          p_user_id: owner.id,
          p_visibility: "shared",
          p_user_message_id: confirmationMessageId,
        },
      });
      if (
        claim.body?.action !== "acquired"
        || !Number.isSafeInteger(claim.body?.attempt_count)
        || claim.body.attempt_count < 1
      ) {
        fail("FIRST_USE_APPLICATION_CLAIM_INVALID", "First-use application request was not claimed");
      }
      return Object.freeze({
        confirmationMessageId,
        requestKey,
        attemptCount: claim.body.attempt_count,
        expectedPrivacyEpoch: source.privacyEpoch,
        messageIds: Object.freeze([confirmationMessageId]),
      });
    },

    async finalizeFirstUseApplication({
      owner,
      source,
      proposal,
      confirmationMessageId,
      requestKey,
      attemptCount,
      expectedPrivacyEpoch,
    }) {
      if (
        !isUuid(owner?.id)
        || !isUuid(source?.coupleId)
        || !isUuid(proposal?.messageId)
        || !isUuid(confirmationMessageId)
        || typeof requestKey !== "string"
        || !Number.isSafeInteger(attemptCount)
        || !Number.isSafeInteger(expectedPrivacyEpoch)
      ) {
        fail("FIRST_USE_APPLICATION_FINALIZER_INPUT_INVALID", "First-use application finalizer input was not canonical");
      }
      const response = await adminCall(
        "/rest/v1/rpc/finalize_amora_first_use_action_application_v1",
        {
          method: "POST",
          body: {
            p_couple_id: source.coupleId,
            p_actor_user_id: owner.id,
            p_source_proposal_message_id: proposal.messageId,
            p_confirmation_message_id: confirmationMessageId,
            p_chat_request_key: requestKey,
            p_chat_claim_attempt_count: attemptCount,
            p_expected_privacy_epoch: expectedPrivacyEpoch,
          },
        },
      );
      return response.body;
    },

    async readFirstUseMessageAsUser(user, messageId) {
      if (!isUuid(user?.id) || !isUuid(messageId)) {
        fail("FIRST_USE_MESSAGE_READ_INPUT_INVALID", "First-use message read input was not canonical");
      }
      const query = new URLSearchParams({
        select: "id,visibility,content,metadata",
        id: `eq.${messageId}`,
        limit: "2",
      });
      const response = await userCall(user, `/rest/v1/chat_messages?${query}`);
      if (!Array.isArray(response.body) || response.body.length > 1) {
        fail("FIRST_USE_MESSAGE_READ_INVALID", "First-use message read was not bounded");
      }
      return response.body;
    },

    async readFirstUseAction(actionId) {
      if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 120) {
        fail("FIRST_USE_ACTION_READ_INPUT_INVALID", "First-use action ID was not canonical");
      }
      const query = new URLSearchParams({
        select: "id,status,first_use_promotion_id",
        id: `eq.${actionId}`,
        limit: "2",
      });
      const response = await adminCall(`/rest/v1/amora_actions?${query}`);
      if (!Array.isArray(response.body) || response.body.length > 1) {
        fail("FIRST_USE_ACTION_READ_INVALID", "First-use action read was not bounded");
      }
      return response.body;
    },

    async readFirstUseProviderReceiptCount({ coupleId, userId }) {
      if (!isUuid(coupleId) || !isUuid(userId)) {
        fail("FIRST_USE_PROVIDER_COUNT_INPUT_INVALID", "First-use provider count scope was not canonical");
      }
      const query = new URLSearchParams({
        select: "id",
        couple_id: `eq.${coupleId}`,
        user_id: `eq.${userId}`,
        "metadata->>hosted_probe_fixture": "eq.true",
        limit: "4",
      });
      const response = await adminCall(`/rest/v1/ai_interactions_log?${query}`);
      if (!Array.isArray(response.body) || response.body.length > 3) {
        fail("FIRST_USE_PROVIDER_COUNT_INVALID", "First-use provider receipt count was not bounded");
      }
      return response.body.length;
    },

    async readFirstUseActionResidue(input) {
      if (typeof firstUseActionResidueReader !== "function") {
        fail("FIRST_USE_RESIDUE_READER_MISSING", "A fixed first-use residue reader is required");
      }
      return firstUseActionResidueReader(input);
    },

    async prepareBookingOutcomeFixture({ owner, coupleId }) {
      if (!isUuid(owner?.id) || !isUuid(coupleId)) {
        fail("BOOKING_OUTCOME_FIXTURE_INPUT_INVALID", "Booking outcome fixture identity was not canonical");
      }
      const vendorId = randomUUID();
      const bookingDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const day = (new Date(`${bookingDate}T12:00:00.000Z`).getUTCDay() + 6) % 7;
      const slug = `amora-stg-booking-${sha256Text(`${runNonce}:${vendorId}`).slice(0, 20)}`;
      try {
        await adminCall("/rest/v1/vendors", {
          method: "POST",
          body: {
            id: vendorId,
            owner_id: owner.id,
            name: "Amora staging booking probe",
            category: "studio",
            region: "서울",
            location: "서울",
            address: "",
            phone: "",
            owner_name: "Amora staging",
            email: null,
            description: "Synthetic hosted integrity probe; never consumer-visible.",
            price_range: "",
            price_min: 0,
            price_max: 0,
            status: "approved",
            business_number: "",
            slug,
            enrichment_status: "skip",
            attributes: {},
          },
        });
        const timeslotQuery = new URLSearchParams({
          vendor_id: `eq.${vendorId}`,
          day: `eq.${day}`,
          hour: "eq.10",
        });
        await adminCall(`/rest/v1/vendor_timeslots?${timeslotQuery}`, {
          method: "PATCH",
          body: { available: true, max_bookings: 1 },
        });
        const created = await adminCall(
          "/rest/v1/rpc/create_amora_booking_intent_atomic",
          {
            method: "POST",
            body: {
              p_vendor_id: vendorId,
              p_couple_id: coupleId,
              p_actor_profile_id: owner.id,
              p_booking_date: bookingDate,
              p_booking_time: "10:00",
              p_product_id: null,
              p_staff_id: null,
              p_booking_type: "consultation",
              p_bride_name: "",
              p_groom_name: "",
              p_contact_phone: "",
              p_memo: "amora staging provenance probe",
            },
          },
        );
        if (!isUuid(created.body)) {
          fail("BOOKING_OUTCOME_FIXTURE_INSERT_INVALID", "Synthetic booking intent was not returned");
        }
        return Object.freeze({
          ownerId: owner.id,
          coupleId,
          vendorId,
          bookingId: created.body,
          bookingDate,
        });
      } catch (error) {
        try {
          await adminCall(`/rest/v1/vendors?id=eq.${encodeURIComponent(vendorId)}`, { method: "DELETE" });
        } catch {
          // Preserve the primary fixture error; the fixed residue read is authoritative.
        }
        throw error;
      }
    },

    async attemptBookingOutcomeAsAuthenticated(owner, fixture) {
      if (!isUuid(owner?.id) || !isUuid(fixture?.bookingId)) {
        fail("BOOKING_OUTCOME_INPUT_INVALID", "Booking outcome attempt input was not canonical");
      }
      const response = await userCall(
        owner,
        "/rest/v1/rpc/complete_amora_booking_outcome_atomic",
        {
          method: "POST",
          allowDenied: true,
          body: {
            p_booking_id: fixture.bookingId,
            p_customer_id: owner.id,
            p_actual_amount: 650000,
            p_contracted_amount: 500000,
            p_rating: 5,
            p_review: "아모라 격리 staging 사용자 완료 기록",
            p_share_public_review: false,
          },
        },
      );
      return { denied: !response.ok && [401, 403, 404].includes(response.status) };
    },

    async completeBookingOutcome({ owner, fixture }) {
      if (!isUuid(owner?.id) || !isUuid(fixture?.bookingId)) {
        fail("BOOKING_OUTCOME_INPUT_INVALID", "Booking outcome input was not canonical");
      }
      const response = await adminCall(
        "/rest/v1/rpc/complete_amora_booking_outcome_atomic",
        {
          method: "POST",
          body: {
            p_booking_id: fixture.bookingId,
            p_customer_id: owner.id,
            p_actual_amount: 650000,
            p_contracted_amount: 500000,
            p_rating: 5,
            p_review: "아모라 격리 staging 사용자 완료 기록",
            p_share_public_review: false,
          },
        },
      );
      return response.body;
    },

    async readBookingOutcomeState({ fixture, decisionId }) {
      if (!isUuid(fixture?.bookingId) || !isUuid(fixture?.coupleId) || !isUuid(decisionId)) {
        fail("BOOKING_OUTCOME_READ_INPUT_INVALID", "Booking outcome read input was not canonical");
      }
      const bookingQuery = new URLSearchParams({
        select: "id,status,actual_amount,contracted_amount",
        id: `eq.${fixture.bookingId}`,
        couple_id: `eq.${fixture.coupleId}`,
      });
      const decisionQuery = new URLSearchParams({
        select: "id,decision_type,visibility,source,source_actor_role,user_confirmed_at,decided_at,created_at,updated_at,chosen_value,metadata,superseded_at",
        couple_id: `eq.${fixture.coupleId}`,
        source: "eq.vendor_booking",
        source_ref_id: `eq.${fixture.bookingId}`,
      });
      if (typeof bookingOutcomeAuthorizationCountReader !== "function") {
        fail("BOOKING_OUTCOME_AUTHORIZATION_READER_MISSING", "A fixed booking outcome authorization reader is required");
      }
      const [bookingResponse, decisionResponse, authorizationCount] = await Promise.all([
        adminCall(`/rest/v1/vendor_bookings?${bookingQuery}`),
        adminCall(`/rest/v1/decision_nodes?${decisionQuery}`),
        bookingOutcomeAuthorizationCountReader({
          bookingId: fixture.bookingId,
          coupleId: fixture.coupleId,
          actorProfileId: fixture.ownerId,
        }),
      ]);
      const bookings = bookingResponse.body;
      const decisions = decisionResponse.body;
      if (!Array.isArray(bookings) || bookings.length !== 1
          || !Array.isArray(decisions)
          || !Number.isSafeInteger(authorizationCount)
          || authorizationCount < 0) {
        fail("BOOKING_OUTCOME_READ_INVALID", "Booking outcome state was not bounded");
      }
      const completedRows = decisions.filter((row) => row?.decision_type === "completed");
      const completed = completedRows.find((row) => row?.id === decisionId);
      const considering = decisions.filter((row) => row?.decision_type === "considering");
      if (completedRows.length !== 1 || !completed) {
        fail("BOOKING_OUTCOME_READ_INVALID", "Booking outcome decision was not unique");
      }
      if (
        completed.source !== "vendor_booking"
        || completed.chosen_value?.completion_evidence !== "user_reported"
        || completed.chosen_value?.vendor_delivery_status !== "not_sent"
        || completed.chosen_value?.vendor_confirmation_status !== "unconfirmed"
        || completed.metadata?.completion_evidence !== completed.chosen_value.completion_evidence
        || completed.metadata?.vendor_delivery_status !== completed.chosen_value.vendor_delivery_status
        || completed.metadata?.vendor_confirmation_status !== completed.chosen_value.vendor_confirmation_status
      ) {
        fail("BOOKING_OUTCOME_READ_INVALID", "Booking outcome receipt evidence was not canonical");
      }
      return Object.freeze({
        bookingStatus: bookings[0]?.status,
        actualAmount: bookings[0]?.actual_amount,
        contractedAmount: bookings[0]?.contracted_amount,
        decisionId: completed.id,
        decisionType: completed.decision_type,
        decisionVisibility: completed.visibility,
        sourceActorRole: completed.source_actor_role,
        actorProfileId: completed.metadata?.actor_profile_id,
        completionEvidence: completed.metadata?.completion_evidence,
        vendorDeliveryStatus: completed.metadata?.vendor_delivery_status,
        vendorConfirmationStatus: completed.metadata?.vendor_confirmation_status,
        provenanceVersion: completed.metadata?.outcome_provenance_version,
        payloadDigest: completed.metadata?.outcome_payload_digest,
        createdAt: completed.created_at,
        confirmedAt: completed.user_confirmed_at,
        decidedAt: completed.decided_at,
        updatedAt: completed.updated_at,
        completedDecisionCount: completedRows.length,
        consideringActive: considering.filter((row) => row?.superseded_at === null).length,
        consideringSuperseded: considering.filter((row) => typeof row?.superseded_at === "string").length,
        authorizationCount,
      });
    },

    async readBookingOutcomeDecisionAsUser(user, decisionId) {
      if (!isUuid(user?.id) || !isUuid(decisionId)) {
        fail("BOOKING_OUTCOME_READ_INPUT_INVALID", "Booking outcome decision input was not canonical");
      }
      const query = new URLSearchParams({
        select: "id,source,decision_type,visibility",
        id: `eq.${decisionId}`,
      });
      const response = await userCall(user, `/rest/v1/decision_nodes?${query}`);
      return response.body;
    },

    async deleteBookingOutcomeFixture(fixture) {
      if (!isUuid(fixture?.vendorId) || !isUuid(fixture?.bookingId)) {
        fail("BOOKING_OUTCOME_CLEANUP_INPUT_INVALID", "Booking outcome cleanup input was not canonical");
      }
      const bookingFilter = `booking_id=eq.${encodeURIComponent(fixture.bookingId)}`;
      const sourceFilter = `source_ref_id=eq.${encodeURIComponent(fixture.bookingId)}`;
      await adminCall(`/rest/v1/decision_nodes?${sourceFilter}`, { method: "DELETE" });
      await adminCall(`/rest/v1/vendor_reviews?${bookingFilter}`, { method: "DELETE" });
      await adminCall(`/rest/v1/vendor_bookings?id=eq.${encodeURIComponent(fixture.bookingId)}`, { method: "DELETE" });
      await adminCall(`/rest/v1/vendor_timeslots?vendor_id=eq.${encodeURIComponent(fixture.vendorId)}`, { method: "DELETE" });
      await adminCall(`/rest/v1/vendors?id=eq.${encodeURIComponent(fixture.vendorId)}`, { method: "DELETE" });
    },

    async readBookingOutcomeResidue(input) {
      if (typeof bookingOutcomeResidueReader !== "function") {
        fail("BOOKING_OUTCOME_RESIDUE_READER_MISSING", "A fixed booking outcome residue reader is required");
      }
      return bookingOutcomeResidueReader(input);
    },

    async createConfirmedCoupleCriterion({
      coupleId,
      ownerId,
      partnerId,
      expectedCurrentDecisionId,
      value,
    }) {
      if (
        !isUuid(coupleId)
        || !isUuid(ownerId)
        || !isUuid(partnerId)
        || ownerId === partnerId
        || (expectedCurrentDecisionId !== null && !isUuid(expectedCurrentDecisionId))
        || typeof value !== "string"
        || value.length < 1
        || value.length > 120
        || value.trim() !== value
      ) {
        fail("CRITERION_CONFIRMATION_INPUT_INVALID", "Criterion confirmation input was not canonical");
      }
      const proposed = await adminCall(
        "/rest/v1/rpc/propose_amora_couple_core_criterion_v1",
        {
          method: "POST",
          body: {
            p_couple_id: coupleId,
            p_recipient_user_id: ownerId,
            p_expected_current_decision_id: expectedCurrentDecisionId,
            p_request_id: randomUUID(),
            p_value: value,
          },
        },
      );
      const proposal = proposed.body?.proposal;
      if (
        proposed.body?.linked !== true
        || proposed.body?.coupleId !== undefined && proposed.body.coupleId !== coupleId
        || !isUuid(proposal?.id)
        || proposal?.revision !== 1
        || proposal?.value !== value
        || (proposed.body?.current?.decisionId ?? null) !== expectedCurrentDecisionId
      ) {
        fail("CRITERION_PROPOSAL_INVALID", "Criterion proposal response was not canonical");
      }
      const accepted = await adminCall(
        "/rest/v1/rpc/accept_amora_couple_core_criterion_v1",
        {
          method: "POST",
          body: {
            p_couple_id: coupleId,
            p_recipient_user_id: partnerId,
            p_proposal_id: proposal.id,
            p_expected_revision: proposal.revision,
            p_request_id: randomUUID(),
          },
        },
      );
      const read = await adminCall(
        "/rest/v1/rpc/read_amora_couple_core_criterion_v1",
        {
          method: "POST",
          body: {
            p_couple_id: coupleId,
            p_recipient_user_id: ownerId,
          },
        },
      );
      const acceptedCurrent = accepted.body?.current;
      const readCurrent = read.body?.current;
      if (
        accepted.body?.linked !== true
        || accepted.body?.proposal !== null
        || !isUuid(acceptedCurrent?.decisionId)
        || acceptedCurrent?.value !== value
        || read.body?.linked !== true
        || read.body?.proposal !== null
        || readCurrent?.decisionId !== acceptedCurrent.decisionId
        || readCurrent?.value !== value
      ) {
        fail("CRITERION_CONFIRMATION_INVALID", "Confirmed criterion did not round-trip canonically");
      }
      return Object.freeze({
        linked: true,
        decisionId: readCurrent.decisionId,
        value,
      });
    },

    async attemptInjectCriterionActionContext({ coupleId, criterionDecisionId }) {
      if (!isUuid(coupleId) || !isUuid(criterionDecisionId)) {
        fail("CRITERION_INJECTION_INPUT_INVALID", "Criterion injection input was not canonical");
      }
      const actionId = `act_probe_injected_${randomBytes(10).toString("hex")}`;
      const response = await adminCall("/rest/v1/amora_actions", {
        method: "POST",
        body: {
          id: actionId,
          couple_id: coupleId,
          title: "직접 주입되면 안 되는 행동",
          category_key: "venue",
          priority: "medium",
          status: "open",
          source: "chat",
          href: "/wedding/lounge",
          metadata: {
            amora_topic_criterion_context_v1: {
              version: 1,
              scope: "couple",
              criterionDecisionId,
              topicKey: "venue",
              affects: "action",
              sourceMessageId: randomUUID(),
              sourceJourneyRevision: 0,
              actionRevision: 1,
            },
          },
        },
        allowDenied: true,
      });
      return Object.freeze({ denied: !response.ok, actionId });
    },

    async prepareCriterionActionApplication({ owner, coupleId, criterionDecisionId, sequence }) {
      if (
        !isUuid(owner?.id)
        || !isUuid(coupleId)
        || !isUuid(criterionDecisionId)
        || !Number.isSafeInteger(sequence)
        || sequence < 1
        || sequence > 9
      ) {
        fail("CRITERION_APPLICATION_INPUT_INVALID", "Criterion application input was not canonical");
      }
      const profileQuery = new URLSearchParams({
        select: "id,couple_id,role",
        id: `eq.${owner.id}`,
        couple_id: `eq.${coupleId}`,
      });
      const journeyQuery = new URLSearchParams({
        select: "couple_id,state_revision",
        couple_id: `eq.${coupleId}`,
      });
      const [profileResponse, journeyResponse, privacyResponse] = await Promise.all([
        adminCall(`/rest/v1/profiles?${profileQuery}`),
        adminCall(`/rest/v1/wedding_journeys?${journeyQuery}`),
        userCall(owner, "/rest/v1/rpc/get_own_amora_privacy_epoch", {
          method: "POST",
          body: { p_couple_id: coupleId, p_visibility: "shared" },
        }),
      ]);
      const profile = Array.isArray(profileResponse.body) && profileResponse.body.length === 1
        ? profileResponse.body[0]
        : null;
      let journey = Array.isArray(journeyResponse.body) && journeyResponse.body.length === 1
        ? journeyResponse.body[0]
        : null;
      const privacyEpoch = privacyResponse.body;
      if (
        profile?.id !== owner.id
        || profile?.couple_id !== coupleId
        || !["bride", "groom"].includes(profile?.role)
      ) {
        fail("CRITERION_APPLICATION_PROFILE_INVALID", "Criterion application profile was not canonical");
      }
      if (journey === null && Array.isArray(journeyResponse.body) && journeyResponse.body.length === 0) {
        const insertedJourney = await adminCall("/rest/v1/wedding_journeys", {
          method: "POST",
          body: {
            couple_id: coupleId,
            wedding_date: null,
            venue: null,
            total_budget: 0,
            progress: {},
          },
        });
        if (insertedJourney.status !== 201) {
          fail("CRITERION_APPLICATION_JOURNEY_BOOTSTRAP_INVALID", "Neutral criterion journey was not created");
        }
        const canonicalJourney = await adminCall(`/rest/v1/wedding_journeys?${journeyQuery}`);
        journey = Array.isArray(canonicalJourney.body) && canonicalJourney.body.length === 1
          ? canonicalJourney.body[0]
          : null;
      }
      if (
        (journey?.couple_id !== undefined && journey.couple_id !== coupleId)
        || !Number.isSafeInteger(journey?.state_revision)
        || journey.state_revision < 0
      ) {
        fail("CRITERION_APPLICATION_JOURNEY_INVALID", "Criterion application journey was not canonical");
      }
      if (!Number.isSafeInteger(privacyEpoch) || privacyEpoch < 1) {
        fail("CRITERION_APPLICATION_PRIVACY_INVALID", "Criterion application privacy epoch was not canonical");
      }

      const issuedAt = Date.now();
      const sourceUserId = randomUUID();
      const sourceProposalId = randomUUID();
      const confirmationId = randomUUID();
      const sourceVisibleRequestId = randomUUID();
      const confirmationVisibleRequestId = randomUUID();
      const pendingActionId = randomUUID();
      const sourceRequestKey = `chat:${owner.id}:${sourceVisibleRequestId}`;
      const input = {
        title: sequence === 1
          ? "예식장 계약서 특약 다시 확인"
          : "예식장 방문 동선 다시 확인",
        description: sequence === 1
          ? "취소 수수료와 보증 인원을 서면에서 다시 확인해요."
          : "변경된 기준에 맞춰 이동 시간을 다시 확인해요.",
        due_date: "2026-10-31",
        category_key: "venue",
      };
      const identity = deriveToolIdentity("add_amora_action", input);
      const proposalConfirmation = [
        "다음 변경을 적용할까요?",
        "- 변경: 아모라 행동 카드 추가",
        `- 제목: ${input.title}`,
        `- 설명: ${input.description}`,
        `- 마감일: ${input.due_date}`,
        "- 관련 준비 항목: 예식장",
      ].join("\n");
      const pendingAction = {
        version: 2,
        actionId: pendingActionId,
        tool: "add_amora_action",
        input,
        inputDigest: identity.inputDigest,
        operationKey: identity.operationKey,
        confirmation: proposalConfirmation,
        issuedAt,
        expiresAt: issuedAt + 600_000,
      };

      const insertedSourceUser = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: {
          id: sourceUserId,
          couple_id: coupleId,
          sender_id: owner.id,
          sender_type: profile.role,
          sender_role: null,
          role: "user",
          content: "예식장 준비에서 다음 확인 행동을 정리해줘",
          metadata: {
            client_request_id: sourceVisibleRequestId,
            amora_ingest_contract_version: 2,
            ai_response_requested: true,
            provider_attachment_state: "none",
            provider_attachment_count: 0,
          },
          visibility: "shared",
          stage_tag: null,
          specialist_type: null,
        },
      });
      if (insertedSourceUser.status !== 201) {
        fail("CRITERION_SOURCE_USER_INSERT_INVALID", "Criterion source user message was not inserted");
      }
      const sourceClaim = await adminCall("/rest/v1/rpc/claim_amora_chat_request", {
        method: "POST",
        body: {
          p_couple_id: coupleId,
          p_request_key: sourceRequestKey,
          p_user_id: owner.id,
          p_visibility: "shared",
          p_user_message_id: sourceUserId,
        },
      });
      if (sourceClaim.body?.action !== "acquired" || !Number.isSafeInteger(sourceClaim.body?.attempt_count)) {
        fail("CRITERION_SOURCE_CLAIM_INVALID", "Criterion source request was not claimed");
      }
      const insertedSourceProposal = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: {
          id: sourceProposalId,
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          sender_role: null,
          role: "assistant",
          content: proposalConfirmation,
          metadata: {
            client_request_id: sourceRequestKey,
            in_reply_to_user_message_id: sourceUserId,
            question_scope: "W0_wedding_core",
            memory_eligible: false,
            memory_enqueue_requested: false,
            amora_wedding_context_revision: journey.state_revision,
            amora_couple_criterion_decision_id: criterionDecisionId,
            pending_amora_action: pendingAction,
            pending_amora_action_journey_revision: journey.state_revision,
            amora_add_action_proposal_origin_v1: "ordinary_provider",
          },
          visibility: "shared",
          stage_tag: null,
          specialist_type: "general",
        },
      });
      if (insertedSourceProposal.status !== 201) {
        fail("CRITERION_SOURCE_PROPOSAL_INSERT_INVALID", "Criterion source proposal was not inserted");
      }
      const completedSource = await adminCall("/rest/v1/rpc/complete_amora_chat_request", {
        method: "POST",
        body: {
          p_couple_id: coupleId,
          p_request_key: sourceRequestKey,
          p_user_id: owner.id,
          p_message_id: sourceProposalId,
        },
      });
      if (completedSource.body !== true) {
        fail("CRITERION_SOURCE_COMPLETE_INVALID", "Criterion source request was not completed");
      }
      const insertedProviderReceipt = await adminCall("/rest/v1/ai_interactions_log", {
        method: "POST",
        body: {
          id: randomUUID(),
          user_id: owner.id,
          couple_id: coupleId,
          interaction_type: "amora_director",
          success: true,
          model: "hosted-probe-synthetic",
          metadata: { hosted_probe_fixture: true },
          amora_request_key: sourceRequestKey,
          amora_call_index: 1,
          amora_call_source: "durable",
          amora_call_phase: "tool_round",
          amora_claim_token: randomUUID(),
          amora_cost_status: "settled",
          amora_reserved_cost_microusd: 0,
          amora_actual_cost_microusd: 0,
          amora_receipt_updated_at: new Date().toISOString(),
        },
      });
      if (insertedProviderReceipt.status !== 201) {
        fail("CRITERION_SOURCE_RECEIPT_INVALID", "Synthetic source receipt was not inserted");
      }
      const applicationLease = await adminCall(
        "/rest/v1/rpc/claim_amora_shared_action_application",
        {
          method: "POST",
          body: {
            p_action_id: pendingActionId,
            p_couple_id: coupleId,
            p_source_message_id: sourceProposalId,
            p_user_id: owner.id,
          },
        },
      );
      if (applicationLease.body?.applicationGranted !== true) {
        fail("CRITERION_APPLICATION_LEASE_INVALID", "Criterion action application was not granted");
      }
      const insertedConfirmation = await adminCall("/rest/v1/chat_messages", {
        method: "POST",
        body: {
          id: confirmationId,
          couple_id: coupleId,
          sender_id: owner.id,
          sender_type: profile.role,
          sender_role: null,
          role: "user",
          content: CRITERION_CONFIRMATION_CONTENT,
          metadata: {
            client_request_id: confirmationVisibleRequestId,
            confirmed_amora_action_id: pendingActionId,
            amora_ingest_contract_version: 2,
            ai_response_requested: true,
            provider_attachment_state: "none",
            provider_attachment_count: 0,
          },
          visibility: "shared",
          stage_tag: null,
          specialist_type: null,
        },
      });
      if (insertedConfirmation.status !== 201) {
        fail("CRITERION_CONFIRMATION_INSERT_INVALID", "Criterion action confirmation was not inserted");
      }
      const applicationRequestId = deriveConfirmedActionRequestId(
        confirmationId,
        pendingActionId,
      );
      const applicationRequestKey = `chat:${owner.id}:${applicationRequestId}`;
      const applicationClaim = await adminCall("/rest/v1/rpc/claim_amora_chat_request", {
        method: "POST",
        body: {
          p_couple_id: coupleId,
          p_request_key: applicationRequestKey,
          p_user_id: owner.id,
          p_visibility: "shared",
          p_user_message_id: confirmationId,
        },
      });
      if (
        applicationClaim.body?.action !== "acquired"
        || !Number.isSafeInteger(applicationClaim.body?.attempt_count)
        || applicationClaim.body.attempt_count < 1
      ) {
        fail("CRITERION_APPLICATION_CLAIM_INVALID", "Criterion application request was not claimed");
      }
      return Object.freeze({
        coupleId,
        actorUserId: owner.id,
        sourceProposalId,
        confirmationId,
        criterionDecisionId,
        journeyRevision: journey.state_revision,
        applicationRequestKey,
        attemptCount: applicationClaim.body.attempt_count,
        expectedPrivacyEpoch: privacyEpoch,
        messageIds: Object.freeze([sourceUserId, sourceProposalId, confirmationId]),
      });
    },

    async finalizeCriterionActionApplication(fixture) {
      if (
        !isUuid(fixture?.coupleId)
        || !isUuid(fixture?.actorUserId)
        || !isUuid(fixture?.sourceProposalId)
        || !isUuid(fixture?.confirmationId)
        || typeof fixture?.applicationRequestKey !== "string"
        || !Number.isSafeInteger(fixture?.attemptCount)
        || !Number.isSafeInteger(fixture?.expectedPrivacyEpoch)
      ) {
        fail("CRITERION_APPLICATION_FIXTURE_INVALID", "Criterion application fixture was not canonical");
      }
      const response = await adminCall(
        "/rest/v1/rpc/finalize_amora_provider_backed_add_action_application_v1",
        {
          method: "POST",
          body: {
            p_couple_id: fixture.coupleId,
            p_actor_user_id: fixture.actorUserId,
            p_source_proposal_message_id: fixture.sourceProposalId,
            p_confirmation_message_id: fixture.confirmationId,
            p_chat_request_key: fixture.applicationRequestKey,
            p_chat_claim_attempt_count: fixture.attemptCount,
            p_expected_privacy_epoch: fixture.expectedPrivacyEpoch,
          },
        },
      );
      return response.body;
    },

    async readCriterionAction(actionId) {
      if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 120) {
        fail("CRITERION_ACTION_READ_INVALID", "Criterion action ID was not canonical");
      }
      const query = new URLSearchParams({
        select: "id,category_key,follow_up_revision,status,metadata",
        id: `eq.${actionId}`,
      });
      const response = await adminCall(`/rest/v1/amora_actions?${query}`);
      return response.body;
    },

    async attemptRemoveCriterionActionContext({ actionId }) {
      if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 120) {
        fail("CRITERION_ACTION_PATCH_INVALID", "Criterion action ID was not canonical");
      }
      const query = new URLSearchParams({ id: `eq.${actionId}` });
      const response = await adminCall(`/rest/v1/amora_actions?${query}`, {
        method: "PATCH",
        body: { metadata: {} },
        allowDenied: true,
      });
      return Object.freeze({ denied: !response.ok });
    },

    async readCriterionActionResidue(input) {
      if (typeof criterionActionResidueReader !== "function") {
        fail("CRITERION_RESIDUE_READER_MISSING", "A fixed criterion-action residue reader is required");
      }
      return criterionActionResidueReader(input);
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

function isExactMessageRefConflict(response, message) {
  return response?.ok === false
    && response?.status === 409
    && response?.body?.code === "PT409"
    && response?.body?.message === message;
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

function exactPreparationNotes(response, expected) {
  const value = response?.body;
  if (
    response?.ok !== true
    || response?.status !== 200
    || value?.version !== 1
    || value?.state !== "ready"
    || value?.recipientUserId !== expected.recipientUserId
    || value?.coupleId !== expected.coupleId
    || value?.partial !== false
    || value?.nextBoundary !== null
    || typeof value?.snapshotAt !== "string"
    || !Array.isArray(value?.entries)
    || value.entries.length !== expected.entries.length
  ) return false;
  return expected.entries.every((expectedEntry) => value.entries.some((entry) => (
    entry?.refId === expectedEntry.refId
    && entry?.topicKey === expectedEntry.topicKey
    && entry?.messageId === expectedEntry.messageId
    && entry?.audience === expectedEntry.audience
    && entry?.questionExcerpt === expectedEntry.questionExcerpt
    && entry?.answerExcerpt === expectedEntry.answerExcerpt
    && entry?.canRemove === true
    && entry?.canOpenOriginal === true
  )));
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
    authenticatedNotesRpcDenied: false,
    sharedConcurrentReplay: false,
    privateSave: false,
    ownerList: false,
    partnerListPrivacy: false,
    outsiderIsolation: false,
    ownerNotesSearch: false,
    partnerNotesPrivacy: false,
    outsiderNotesIsolation: false,
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
    const authenticatedNotes = await transport.callPreparationNotesRpcAsAuthenticated(owner, {
      coupleId: ownerSpace.couple_id,
      recipientUserId: owner.id,
      expectedPrivacyEpoch: privacyEpoch,
      query: "",
    });
    checks.authenticatedNotesRpcDenied = authenticatedNotes?.denied === true;
    requireScenario(
      checks.authenticatedNotesRpcDenied,
      "PREPARATION_NOTES_RPC_ACL_BYPASS",
      "Authenticated client reached the service-only preparation-notes RPC",
    );

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

    const [
      ownerNotes,
      ownerPrivateSearch,
      partnerNotes,
      partnerPrivateSearch,
      outsiderNotes,
    ] = await Promise.all([
      transport.listPreparationNotesAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: owner.id,
        expectedPrivacyEpoch: privacyEpoch,
        query: "",
      }),
      transport.listPreparationNotesAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: owner.id,
        expectedPrivacyEpoch: privacyEpoch,
        query: "예산",
      }),
      transport.listPreparationNotesAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: partner.id,
        expectedPrivacyEpoch: privacyEpoch,
        query: "",
      }),
      transport.listPreparationNotesAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: partner.id,
        expectedPrivacyEpoch: privacyEpoch,
        query: "예산",
      }),
      transport.listPreparationNotesAsService({
        coupleId: ownerSpace.couple_id,
        recipientUserId: outsider.id,
        expectedPrivacyEpoch: privacyEpoch,
        query: "",
      }),
    ]);
    const sharedNote = {
      refId: sharedRefId,
      topicKey: "meeting",
      messageId: fixtures.sharedAnswerId,
      audience: "couple_shared",
      questionExcerpt: fixtures.sharedQuestion,
      answerExcerpt: fixtures.sharedAnswer,
    };
    const privateNote = {
      refId: privateRefId,
      topicKey: "housing",
      messageId: fixtures.privateAnswerId,
      audience: "owner_private",
      questionExcerpt: fixtures.privateQuestion,
      answerExcerpt: fixtures.privateAnswer,
    };
    checks.ownerNotesSearch = exactPreparationNotes(ownerNotes, {
      recipientUserId: owner.id,
      coupleId: ownerSpace.couple_id,
      entries: [sharedNote, privateNote],
    }) && exactPreparationNotes(ownerPrivateSearch, {
      recipientUserId: owner.id,
      coupleId: ownerSpace.couple_id,
      entries: [privateNote],
    });
    checks.partnerNotesPrivacy = exactPreparationNotes(partnerNotes, {
      recipientUserId: partner.id,
      coupleId: ownerSpace.couple_id,
      entries: [sharedNote],
    }) && exactPreparationNotes(partnerPrivateSearch, {
      recipientUserId: partner.id,
      coupleId: ownerSpace.couple_id,
      entries: [],
    });
    checks.outsiderNotesIsolation = outsiderNotes?.ok === false;
    requireScenario(checks.ownerNotesSearch, "PREPARATION_NOTES_OWNER_INVALID", "Owner notes did not include exact shared and private entries");
    requireScenario(checks.partnerNotesPrivacy, "PREPARATION_NOTES_PARTNER_LEAK", "Partner notes exposed owner-private content or missed shared content");
    requireScenario(checks.outsiderNotesIsolation, "PREPARATION_NOTES_OUTSIDER_LEAK", "Outsider accessed another couple's preparation notes");

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
    const staleResave = await transport.setMessageRefAsService({
      ...sharedInput,
      expectedRevision: 0,
      requestId: randomUUID(),
    });
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
      && isExactMessageRefConflict(
        staleResave,
        "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REVISION_STALE",
      )
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

function exactMediationMessage(rows, expected) {
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  if (row?.id !== expected.id
      || row?.visibility !== expected.visibility
      || row?.content !== expected.content
      || row?.metadata === null
      || typeof row?.metadata !== "object"
      || Array.isArray(row.metadata)) return false;
  if (expected.visibility === "shared") {
    return row.metadata.mediation_source_draft_id === expected.draftId
      && row.metadata.mediation_share_origin === "requester_sent";
  }
  return row.metadata.mediation_draft_state === expected.draftState
    && (row.metadata.mediation_shared_message_id ?? null) === expected.sharedId;
}

export async function runMediationPrivateDraftScenario({ transport }) {
  if (!transport || typeof transport !== "object") {
    fail("TRANSPORT_INVALID", "A hosted staging transport is required");
  }
  const checks = {
    ownerSpace: false,
    partnerJoin: false,
    privateBeforeShare: false,
    directSharedInsertDenied: false,
    authenticatedShareDenied: false,
    wrongActorShareDenied: false,
    canonicalShare: false,
    exactReplay: false,
    sharedVisibleToCouple: false,
    cleanup: false,
  };
  const users = [];
  const coupleIds = [];
  const messageIds = [];
  let primaryError = null;

  try {
    const owner = await transport.createSyntheticUser("owner");
    const partner = await transport.createSyntheticUser("partner");
    users.push(owner, partner);
    requireScenario(
      users.every((user) => isUuid(user?.id) && typeof user?.accessToken === "string")
        && owner.id !== partner.id,
      "MEDIATION_SYNTHETIC_USERS_INVALID",
      "Mediation probe users were not canonical",
    );
    const ownerSpace = await transport.createNeutralPreparationSpace(owner);
    checks.ownerSpace = isCreatedPreparationSpace(ownerSpace);
    requireScenario(checks.ownerSpace, "MEDIATION_OWNER_SPACE_INVALID", "Owner preparation space was not canonical");
    coupleIds.push(ownerSpace.couple_id);
    const joined = await transport.joinNeutralPreparationSpaceServer(
      partner.id,
      ownerSpace.invite_code,
    );
    checks.partnerJoin = isJoinedPreparationSpace(joined, ownerSpace.couple_id);
    requireScenario(checks.partnerJoin, "MEDIATION_PARTNER_JOIN_INVALID", "Partner did not join the owner space canonically");

    const fixture = await transport.createMediationDraftFixture({
      owner,
      coupleId: ownerSpace.couple_id,
    });
    requireScenario(
      isUuid(fixture?.draftId)
        && ["bride_private", "groom_private"].includes(fixture?.privateVisibility),
      "MEDIATION_DRAFT_FIXTURE_INVALID",
      "Private mediation draft fixture was not canonical",
    );
    messageIds.push(fixture.draftId);
    const [ownerDraftBefore, partnerDraftBefore] = await Promise.all([
      transport.readMediationMessageAsUser(owner, fixture.draftId),
      transport.readMediationMessageAsUser(partner, fixture.draftId),
    ]);
    checks.privateBeforeShare = exactMediationMessage(ownerDraftBefore, {
      id: fixture.draftId,
      visibility: fixture.privateVisibility,
      content: "private outer prose",
      draftState: "draft",
      sharedId: null,
    }) && Array.isArray(partnerDraftBefore) && partnerDraftBefore.length === 0;
    requireScenario(checks.privateBeforeShare, "MEDIATION_PRIVATE_DRAFT_LEAK", "Private mediation draft was not owner-only before share");

    const direct = await transport.attemptDirectSharedMediation({
      coupleId: ownerSpace.couple_id,
    });
    requireScenario(isUuid(direct?.messageId), "MEDIATION_DIRECT_ATTEMPT_INVALID", "Direct mediation attempt did not expose a bounded synthetic id");
    messageIds.push(direct.messageId);
    checks.directSharedInsertDenied = direct.denied === true;
    requireScenario(checks.directSharedInsertDenied, "MEDIATION_DIRECT_SHARED_INSERT_ALLOWED", "Direct shared mediation insert bypassed the private-draft boundary");

    const authenticatedShare = await transport.callShareMediationAsAuthenticated(owner, {
      draftId: fixture.draftId,
      userId: owner.id,
    });
    checks.authenticatedShareDenied = authenticatedShare?.denied === true;
    requireScenario(checks.authenticatedShareDenied, "MEDIATION_SHARE_RPC_ACL_BYPASS", "Authenticated client reached the service-only mediation share RPC");

    const wrongActor = await transport.shareMediationAsService({
      draftId: fixture.draftId,
      userId: partner.id,
      accept: false,
    });
    checks.wrongActorShareDenied = wrongActor?.ok === false;
    requireScenario(checks.wrongActorShareDenied, "MEDIATION_WRONG_ACTOR_SHARE_ALLOWED", "Partner shared the requester's private draft");

    const shared = await transport.shareMediationAsService({
      draftId: fixture.draftId,
      userId: owner.id,
      accept: false,
    });
    const sharedId = shared?.body?.shared_message_id ?? null;
    checks.canonicalShare = shared?.ok === true
      && shared?.status === 200
      && isUuid(sharedId)
      && shared.body?.reused === false
      && shared.body?.acceptance === null;
    requireScenario(checks.canonicalShare, "MEDIATION_CANONICAL_SHARE_INVALID", "Requester share did not create one canonical shared card");
    messageIds.push(sharedId);

    const replay = await transport.shareMediationAsService({
      draftId: fixture.draftId,
      userId: owner.id,
      accept: false,
    });
    checks.exactReplay = replay?.ok === true
      && replay?.status === 200
      && replay?.body?.shared_message_id === sharedId
      && replay?.body?.reused === true;
    requireScenario(checks.exactReplay, "MEDIATION_SHARE_REPLAY_INVALID", "Exact mediation retry did not reuse the same shared card");

    const [ownerShared, partnerShared, ownerDraftAfter] = await Promise.all([
      transport.readMediationMessageAsUser(owner, sharedId),
      transport.readMediationMessageAsUser(partner, sharedId),
      transport.readMediationMessageAsUser(owner, fixture.draftId),
    ]);
    const sharedExpectation = {
      id: sharedId,
      visibility: "shared",
      content: "요청하신 분이 초안을 읽고 이 카드를 보냈어요.",
      draftId: fixture.draftId,
    };
    checks.sharedVisibleToCouple = exactMediationMessage(ownerShared, sharedExpectation)
      && exactMediationMessage(partnerShared, sharedExpectation)
      && exactMediationMessage(ownerDraftAfter, {
        id: fixture.draftId,
        visibility: fixture.privateVisibility,
        content: "private outer prose",
        draftState: "sent",
        sharedId,
      });
    requireScenario(checks.sharedVisibleToCouple, "MEDIATION_SHARED_CARD_INVALID", "Shared mediation card or sent-draft binding was not canonical");
  } catch (error) {
    primaryError = error;
  } finally {
    if (messageIds.length > 0) {
      try {
        await transport.deleteMediationFixtures(messageIds);
      } catch (error) {
        primaryError ??= error;
      }
    }
    for (const user of [...users].reverse()) {
      try { await transport.resetMembership(user); } catch { /* Auth deletion is final. */ }
    }
    for (const user of [...users].reverse()) {
      try { await transport.deleteSyntheticUser(user.id); } catch (error) { primaryError ??= error; }
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
      "MEDIATION_SYNTHETIC_RESIDUE_PRESENT",
      "Mediation staging probe left synthetic rows behind",
    );
  }
  if (primaryError) throw primaryError;
  return Object.freeze({
    scenario: "mediation_private_draft_two_account_v1",
    syntheticUserCount: users.length,
    checks: Object.freeze({ ...checks }),
    residue: Object.freeze({ ...residue }),
  });
}

function parseCriterionApplicationResult(rows, replayed) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  const action = row?.tool_result?.toolOutput?.action;
  if (
    row?.outcome !== (replayed ? "replayed" : "persisted")
    || row?.message_reused !== replayed
    || !isUuid(row?.message_id)
    || row?.tool_result?.toolName !== "add_amora_action"
    || row?.tool_result?.success !== true
    || typeof action?.id !== "string"
    || action.id.length < 1
    || action?.status !== "open"
  ) return null;
  return Object.freeze({ actionId: action.id, messageId: row.message_id });
}

function exactCriterionAction(rows, expected) {
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  if (
    row?.id !== expected.actionId
    || row?.category_key !== "venue"
    || row?.follow_up_revision !== 1
    || row?.status !== "open"
    || row?.metadata === null
    || typeof row?.metadata !== "object"
    || Array.isArray(row.metadata)
  ) return false;
  const keys = Object.keys(row.metadata);
  if (expected.context === null) return keys.length === 0;
  if (keys.length !== 1 || keys[0] !== "amora_topic_criterion_context_v1") return false;
  const context = row.metadata.amora_topic_criterion_context_v1;
  return context?.version === 1
    && context?.scope === "couple"
    && context?.criterionDecisionId === expected.context.criterionDecisionId
    && context?.topicKey === "venue"
    && context?.affects === "action"
    && context?.sourceMessageId === expected.context.sourceMessageId
    && context?.sourceJourneyRevision === expected.context.journeyRevision
    && context?.actionRevision === 1
    && Object.keys(context).length === 8;
}

export async function runCriterionActionContextScenario({ transport }) {
  if (!transport || typeof transport !== "object") {
    fail("TRANSPORT_INVALID", "A hosted staging transport is required");
  }
  const checks = {
    ownerSpace: false,
    partnerJoin: false,
    firstCriterionConfirmed: false,
    directInjectionDenied: false,
    currentContextSealed: false,
    criterionTextNotCopied: false,
    exactReplay: false,
    contextImmutable: false,
    changedCriterionConfirmed: false,
    staleContextOmittedWithoutUndoingAction: false,
    cleanup: false,
  };
  const users = [];
  const coupleIds = [];
  const actionIds = [];
  const messageIds = [];
  const firstCriterionValue = "무리하지 않는 예산 안에서 결정해요";
  const secondCriterionValue = "이동 시간을 먼저 봐요";
  let primaryError = null;

  try {
    const owner = await transport.createSyntheticUser("owner");
    const partner = await transport.createSyntheticUser("partner");
    users.push(owner, partner);
    requireScenario(
      users.every((user) => isUuid(user?.id) && typeof user?.accessToken === "string")
        && owner.id !== partner.id,
      "CRITERION_SYNTHETIC_USERS_INVALID",
      "Criterion probe users were not canonical",
    );
    const ownerSpace = await transport.createNeutralPreparationSpace(owner);
    checks.ownerSpace = isCreatedPreparationSpace(ownerSpace);
    requireScenario(checks.ownerSpace, "CRITERION_OWNER_SPACE_INVALID", "Owner preparation space was not canonical");
    coupleIds.push(ownerSpace.couple_id);
    const joined = await transport.joinNeutralPreparationSpaceServer(
      partner.id,
      ownerSpace.invite_code,
    );
    checks.partnerJoin = isJoinedPreparationSpace(joined, ownerSpace.couple_id);
    requireScenario(checks.partnerJoin, "CRITERION_PARTNER_JOIN_INVALID", "Partner did not join the owner space canonically");

    const firstCriterion = await transport.createConfirmedCoupleCriterion({
      coupleId: ownerSpace.couple_id,
      ownerId: owner.id,
      partnerId: partner.id,
      expectedCurrentDecisionId: null,
      value: firstCriterionValue,
    });
    checks.firstCriterionConfirmed = firstCriterion?.linked === true
      && isUuid(firstCriterion?.decisionId)
      && firstCriterion?.value === firstCriterionValue;
    requireScenario(checks.firstCriterionConfirmed, "CRITERION_FIRST_CONFIRMATION_INVALID", "First shared criterion was not canonical");

    const injection = await transport.attemptInjectCriterionActionContext({
      coupleId: ownerSpace.couple_id,
      criterionDecisionId: firstCriterion.decisionId,
    });
    checks.directInjectionDenied = injection?.denied === true;
    requireScenario(checks.directInjectionDenied, "CRITERION_CONTEXT_INJECTION_ALLOWED", "Direct criterion context injection was allowed");

    const firstFixture = await transport.prepareCriterionActionApplication({
      owner,
      coupleId: ownerSpace.couple_id,
      criterionDecisionId: firstCriterion.decisionId,
      sequence: 1,
    });
    requireScenario(
      isUuid(firstFixture?.sourceProposalId)
        && firstFixture?.criterionDecisionId === firstCriterion.decisionId
        && Number.isSafeInteger(firstFixture?.journeyRevision),
      "CRITERION_APPLICATION_FIXTURE_INVALID",
      "Current-criterion action fixture was not canonical",
    );
    messageIds.push(...(firstFixture.messageIds ?? []));
    const firstRows = await transport.finalizeCriterionActionApplication(firstFixture);
    const firstApplication = parseCriterionApplicationResult(firstRows, false);
    requireScenario(firstApplication !== null, "CRITERION_APPLICATION_INVALID", "Current-criterion action was not applied canonically");
    actionIds.push(firstApplication.actionId);
    messageIds.push(firstApplication.messageId);
    const firstActionRows = await transport.readCriterionAction(firstApplication.actionId);
    checks.currentContextSealed = exactCriterionAction(firstActionRows, {
      actionId: firstApplication.actionId,
      context: {
        criterionDecisionId: firstCriterion.decisionId,
        sourceMessageId: firstFixture.sourceProposalId,
        journeyRevision: firstFixture.journeyRevision,
      },
    });
    requireScenario(checks.currentContextSealed, "CRITERION_CONTEXT_RECEIPT_INVALID", "Current shared criterion did not gain an exact action-context receipt");
    checks.criterionTextNotCopied = !JSON.stringify(firstActionRows).includes(firstCriterionValue);
    requireScenario(checks.criterionTextNotCopied, "CRITERION_TEXT_COPIED", "Criterion text was copied into the action receipt");

    const replayRows = await transport.finalizeCriterionActionApplication(firstFixture);
    const replay = parseCriterionApplicationResult(replayRows, true);
    checks.exactReplay = replay?.actionId === firstApplication.actionId
      && replay?.messageId === firstApplication.messageId;
    requireScenario(checks.exactReplay, "CRITERION_APPLICATION_REPLAY_INVALID", "Exact criterion action retry did not reuse the same result");

    const immutable = await transport.attemptRemoveCriterionActionContext({
      actionId: firstApplication.actionId,
    });
    checks.contextImmutable = immutable?.denied === true;
    requireScenario(checks.contextImmutable, "CRITERION_CONTEXT_MUTABLE", "Criterion action-context receipt was mutable");

    const secondCriterion = await transport.createConfirmedCoupleCriterion({
      coupleId: ownerSpace.couple_id,
      ownerId: owner.id,
      partnerId: partner.id,
      expectedCurrentDecisionId: firstCriterion.decisionId,
      value: secondCriterionValue,
    });
    checks.changedCriterionConfirmed = secondCriterion?.linked === true
      && isUuid(secondCriterion?.decisionId)
      && secondCriterion.decisionId !== firstCriterion.decisionId
      && secondCriterion?.value === secondCriterionValue;
    requireScenario(checks.changedCriterionConfirmed, "CRITERION_CHANGE_INVALID", "Changed shared criterion was not canonical");

    const staleFixture = await transport.prepareCriterionActionApplication({
      owner,
      coupleId: ownerSpace.couple_id,
      criterionDecisionId: firstCriterion.decisionId,
      sequence: 2,
    });
    messageIds.push(...(staleFixture.messageIds ?? []));
    const staleRows = await transport.finalizeCriterionActionApplication(staleFixture);
    const staleApplication = parseCriterionApplicationResult(staleRows, false);
    requireScenario(staleApplication !== null, "CRITERION_STALE_APPLICATION_INVALID", "Stale-context action did not finish canonically");
    actionIds.push(staleApplication.actionId);
    messageIds.push(staleApplication.messageId);
    const staleActionRows = await transport.readCriterionAction(staleApplication.actionId);
    checks.staleContextOmittedWithoutUndoingAction = exactCriterionAction(staleActionRows, {
      actionId: staleApplication.actionId,
      context: null,
    });
    requireScenario(
      checks.staleContextOmittedWithoutUndoingAction,
      "CRITERION_STALE_CONTEXT_FALSE_CLAIM",
      "Changed criterion was falsely claimed or the approved action was lost",
    );
  } catch (error) {
    primaryError = error;
  } finally {
    for (const user of [...users].reverse()) {
      try { await transport.resetMembership(user); } catch { /* Auth deletion is final. */ }
    }
    for (const user of [...users].reverse()) {
      try { await transport.deleteSyntheticUser(user.id); } catch (error) { primaryError ??= error; }
    }
  }

  let residue = {
    profiles: Number.NaN,
    couples: Number.NaN,
    journeys: Number.NaN,
    chatMessages: Number.NaN,
    chatClaims: Number.NaN,
    actions: Number.NaN,
    executions: Number.NaN,
    applicationClaims: Number.NaN,
    criterionProposals: Number.NaN,
    criterionAcceptances: Number.NaN,
    decisions: Number.NaN,
    providerReceipts: Number.NaN,
  };
  try {
    residue = await transport.readCriterionActionResidue({
      userIds: users.map(({ id }) => id),
      coupleIds,
      actionIds,
      messageIds,
    });
    checks.cleanup = Object.values(residue).every((count) => count === 0);
  } catch (error) {
    primaryError ??= error;
  }
  if (!checks.cleanup) {
    primaryError ??= new AmoraSuccessorStagingProbeError(
      "CRITERION_SYNTHETIC_RESIDUE_PRESENT",
      "Criterion action staging probe left synthetic rows behind",
    );
  }
  if (primaryError) throw primaryError;
  return Object.freeze({
    scenario: "criterion_action_context_two_account_v1",
    providerEvidence: "synthetic_fixture_no_live_provider_call",
    syntheticUserCount: users.length,
    checks: Object.freeze({ ...checks }),
    residue: Object.freeze({ ...residue }),
  });
}

function parseFirstUseProposalResult(rows, replayed) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  const metadata = row?.message_metadata;
  const pending = metadata?.pending_amora_action;
  if (
    row?.outcome !== (replayed ? "replayed" : "persisted")
    || row?.message_reused !== replayed
    || !isUuid(row?.message_id)
    || row?.message_visibility !== "shared"
    || typeof row?.message_content !== "string"
    || row.message_content.length < 1
    || metadata?.response_origin !== "server_authoritative_first_use_promotion"
    || metadata?.provider_call_count !== 0
    || !isUuid(metadata?.amora_first_use_promotion_id)
    || pending?.version !== 2
    || !isUuid(pending?.actionId)
    || pending?.tool !== "add_amora_action"
  ) return null;
  return Object.freeze({
    messageId: row.message_id,
    promotionId: metadata.amora_first_use_promotion_id,
    pendingActionId: pending.actionId,
    confirmation: row.message_content,
  });
}

function parseFirstUseApplicationResult(rows, replayed) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  const metadata = row?.message_metadata;
  const action = row?.tool_result?.toolOutput?.action;
  if (
    row?.outcome !== (replayed ? "replayed" : "persisted")
    || row?.message_reused !== replayed
    || !isUuid(row?.message_id)
    || row?.message_visibility !== "shared"
    || typeof row?.message_content !== "string"
    || row.message_content.length < 1
    || metadata?.response_origin
      !== "server_authoritative_first_use_action_application"
    || metadata?.provider_call_count !== 0
    || !isUuid(metadata?.amora_first_use_promotion_id)
    || row?.tool_result?.toolName !== "add_amora_action"
    || row?.tool_result?.success !== true
    || typeof action?.id !== "string"
    || action.id.length < 1
    || action?.status !== "open"
  ) return null;
  return Object.freeze({
    messageId: row.message_id,
    promotionId: metadata.amora_first_use_promotion_id,
    actionId: action.id,
  });
}

function exactVisibleSharedMessage(rows, messageId) {
  return Array.isArray(rows)
    && rows.length === 1
    && rows[0]?.id === messageId
    && rows[0]?.visibility === "shared";
}

export async function runFirstUseDeterministicActionScenario({ transport }) {
  if (!transport || typeof transport !== "object") {
    fail("TRANSPORT_INVALID", "A hosted staging transport is required");
  }
  const checks = {
    ownerSpace: false,
    partnerJoin: false,
    privateSourceOwnerVisible: false,
    privateSourcePartnerHidden: false,
    authenticatedFinalizerDenied: false,
    promotionCreated: false,
    deterministicProposal: false,
    proposalExactReplay: false,
    sharedProposalVisible: false,
    deterministicApplication: false,
    applicationExactReplay: false,
    sharedReceiptVisible: false,
    privateContentNotShared: false,
    actionPersisted: false,
    providerBoundary: false,
    cleanup: false,
  };
  const users = [];
  const coupleIds = [];
  const promotionIds = [];
  const actionIds = [];
  const messageIds = [];
  let primaryError = null;

  try {
    const owner = await transport.createSyntheticUser("owner");
    const partner = await transport.createSyntheticUser("partner");
    users.push(owner, partner);
    requireScenario(
      users.every((user) => isUuid(user?.id) && typeof user?.accessToken === "string")
        && owner.id !== partner.id,
      "FIRST_USE_SYNTHETIC_USERS_INVALID",
      "First-use probe users were not canonical",
    );
    const ownerSpace = await transport.createNeutralPreparationSpace(owner);
    checks.ownerSpace = isCreatedPreparationSpace(ownerSpace);
    requireScenario(checks.ownerSpace, "FIRST_USE_OWNER_SPACE_INVALID", "Owner preparation space was not canonical");
    coupleIds.push(ownerSpace.couple_id);
    const joined = await transport.joinNeutralPreparationSpaceServer(
      partner.id,
      ownerSpace.invite_code,
    );
    checks.partnerJoin = isJoinedPreparationSpace(joined, ownerSpace.couple_id);
    requireScenario(checks.partnerJoin, "FIRST_USE_PARTNER_JOIN_INVALID", "Partner did not join the owner space canonically");

    const source = await transport.prepareFirstUsePrivateSource({
      owner,
      partner,
      coupleId: ownerSpace.couple_id,
    });
    requireScenario(
      source?.coupleId === ownerSpace.couple_id
        && isUuid(source?.sourcePrivateMessageId)
        && typeof source?.privateContent === "string"
        && source.privateContent.length > 0
        && typeof source?.privateOnlyMarker === "string"
        && source.privateOnlyMarker.length > 0
        && typeof source?.canonicalSharedText === "string"
        && source.canonicalSharedText.length > 0
        && Number.isSafeInteger(source?.privacyEpoch)
        && source.privacyEpoch >= 1
        && Number.isSafeInteger(source?.journeyRevision)
        && source.journeyRevision >= 0,
      "FIRST_USE_PRIVATE_SOURCE_INVALID",
      "First-use private source was not canonical",
    );
    messageIds.push(...(source.messageIds ?? [source.sourcePrivateMessageId]));
    const [ownerPrivateRows, partnerPrivateRows] = await Promise.all([
      transport.readFirstUseMessageAsUser(owner, source.sourcePrivateMessageId),
      transport.readFirstUseMessageAsUser(partner, source.sourcePrivateMessageId),
    ]);
    checks.privateSourceOwnerVisible = Array.isArray(ownerPrivateRows)
      && ownerPrivateRows.length === 1
      && ownerPrivateRows[0]?.id === source.sourcePrivateMessageId
      && typeof ownerPrivateRows[0]?.visibility === "string"
      && ownerPrivateRows[0].visibility.endsWith("_private");
    checks.privateSourcePartnerHidden = Array.isArray(partnerPrivateRows)
      && partnerPrivateRows.length === 0;
    requireScenario(checks.privateSourceOwnerVisible, "FIRST_USE_OWNER_PRIVATE_READ_INVALID", "Owner could not read the private source");
    requireScenario(checks.privateSourcePartnerHidden, "FIRST_USE_PARTNER_PRIVATE_READ_ALLOWED", "Partner could read the private source");

    const denied = await transport.attemptFirstUseFinalizerAsAuthenticated(owner, source);
    checks.authenticatedFinalizerDenied = denied?.denied === true;
    requireScenario(checks.authenticatedFinalizerDenied, "FIRST_USE_AUTHENTICATED_FINALIZER_ALLOWED", "Authenticated client could call a service-only first-use finalizer");

    const providerReceiptCountBefore = await transport.readFirstUseProviderReceiptCount({
      coupleId: ownerSpace.couple_id,
      userId: owner.id,
    });
    const promotion = await transport.ingestFirstUsePromotion(source);
    checks.promotionCreated = promotion?.version === 1
      && isUuid(promotion?.promotionId)
      && isUuid(promotion?.sharedMessageId)
      && promotion?.reused === false;
    requireScenario(checks.promotionCreated, "FIRST_USE_PROMOTION_INVALID", "First-use promotion was not created canonically");
    promotionIds.push(promotion.promotionId);
    messageIds.push(promotion.sharedMessageId);

    const proposalClaim = await transport.claimFirstUseProposal({
      owner,
      source,
      promotion,
    });
    requireScenario(
      typeof proposalClaim?.requestKey === "string"
        && Number.isSafeInteger(proposalClaim?.attemptCount)
        && proposalClaim.attemptCount >= 1,
      "FIRST_USE_PROPOSAL_CLAIM_INVALID",
      "First-use proposal request was not claimed",
    );
    const proposalRows = await transport.finalizeFirstUseProposal({
      owner,
      source,
      promotion,
      ...proposalClaim,
    });
    const proposal = parseFirstUseProposalResult(proposalRows, false);
    checks.deterministicProposal = proposal?.promotionId === promotion.promotionId;
    requireScenario(checks.deterministicProposal, "FIRST_USE_PROPOSAL_INVALID", "Provider-free first-use proposal was not canonical");
    messageIds.push(proposal.messageId);
    const replayedProposal = parseFirstUseProposalResult(
      await transport.finalizeFirstUseProposal({
        owner,
        source,
        promotion,
        ...proposalClaim,
      }),
      true,
    );
    checks.proposalExactReplay = replayedProposal?.messageId === proposal.messageId
      && replayedProposal?.pendingActionId === proposal.pendingActionId;
    requireScenario(checks.proposalExactReplay, "FIRST_USE_PROPOSAL_REPLAY_INVALID", "First-use proposal retry did not reuse the exact result");
    const [ownerProposalRows, partnerProposalRows] = await Promise.all([
      transport.readFirstUseMessageAsUser(owner, proposal.messageId),
      transport.readFirstUseMessageAsUser(partner, proposal.messageId),
    ]);
    checks.sharedProposalVisible = exactVisibleSharedMessage(ownerProposalRows, proposal.messageId)
      && exactVisibleSharedMessage(partnerProposalRows, proposal.messageId);
    requireScenario(checks.sharedProposalVisible, "FIRST_USE_SHARED_PROPOSAL_HIDDEN", "Shared proposal was not visible to both members");

    const applicationFixture = await transport.prepareFirstUseApplication({
      owner,
      source,
      promotion,
      proposal,
    });
    requireScenario(
      isUuid(applicationFixture?.confirmationMessageId)
        && typeof applicationFixture?.requestKey === "string"
        && Number.isSafeInteger(applicationFixture?.attemptCount)
        && applicationFixture.attemptCount >= 1,
      "FIRST_USE_APPLICATION_FIXTURE_INVALID",
      "First-use application fixture was not canonical",
    );
    messageIds.push(...(applicationFixture.messageIds ?? [applicationFixture.confirmationMessageId]));
    const applicationRows = await transport.finalizeFirstUseApplication({
      owner,
      source,
      promotion,
      proposal,
      ...applicationFixture,
    });
    const application = parseFirstUseApplicationResult(applicationRows, false);
    checks.deterministicApplication = application?.promotionId === promotion.promotionId;
    requireScenario(checks.deterministicApplication, "FIRST_USE_APPLICATION_INVALID", "Provider-free first-use application was not canonical");
    actionIds.push(application.actionId);
    messageIds.push(application.messageId);
    const replayedApplication = parseFirstUseApplicationResult(
      await transport.finalizeFirstUseApplication({
        owner,
        source,
        promotion,
        proposal,
        ...applicationFixture,
      }),
      true,
    );
    checks.applicationExactReplay = replayedApplication?.messageId === application.messageId
      && replayedApplication?.actionId === application.actionId;
    requireScenario(checks.applicationExactReplay, "FIRST_USE_APPLICATION_REPLAY_INVALID", "First-use application retry did not reuse the exact result");

    const [partnerReceiptRows, partnerSharedSourceRows] = await Promise.all([
      transport.readFirstUseMessageAsUser(partner, application.messageId),
      Promise.all([
        transport.readFirstUseMessageAsUser(partner, promotion.sharedMessageId),
        transport.readFirstUseMessageAsUser(partner, proposal.messageId),
      ]),
    ]);
    checks.sharedReceiptVisible = exactVisibleSharedMessage(
      partnerReceiptRows,
      application.messageId,
    );
    requireScenario(checks.sharedReceiptVisible, "FIRST_USE_SHARED_RECEIPT_HIDDEN", "Shared application receipt was not visible to the partner");
    checks.privateContentNotShared = !JSON.stringify([
      ...partnerReceiptRows,
      ...partnerSharedSourceRows.flat(),
    ]).includes(source.privateOnlyMarker);
    requireScenario(checks.privateContentNotShared, "FIRST_USE_PRIVATE_CONTENT_SHARED", "Private source content leaked into shared rows");

    const actionRows = await transport.readFirstUseAction(application.actionId);
    checks.actionPersisted = Array.isArray(actionRows)
      && actionRows.length === 1
      && actionRows[0]?.id === application.actionId
      && actionRows[0]?.status === "open"
      && actionRows[0]?.first_use_promotion_id === promotion.promotionId;
    requireScenario(checks.actionPersisted, "FIRST_USE_ACTION_NOT_PERSISTED", "First-use action was not bound to the promotion");
    const providerReceiptCountAfter = await transport.readFirstUseProviderReceiptCount({
      coupleId: ownerSpace.couple_id,
      userId: owner.id,
    });
    checks.providerBoundary = providerReceiptCountBefore === 1
      && providerReceiptCountAfter === providerReceiptCountBefore;
    requireScenario(checks.providerBoundary, "FIRST_USE_PROVIDER_BOUNDARY_INVALID", "Proposal or application created an AI provider receipt");
  } catch (error) {
    primaryError = error;
  } finally {
    for (const user of [...users].reverse()) {
      try { await transport.resetMembership(user); } catch { /* Auth deletion is final. */ }
    }
    for (const user of [...users].reverse()) {
      try { await transport.deleteSyntheticUser(user.id); } catch (error) { primaryError ??= error; }
    }
  }

  let residue = {
    profiles: Number.NaN,
    couples: Number.NaN,
    journeys: Number.NaN,
    chatMessages: Number.NaN,
    chatClaims: Number.NaN,
    promotions: Number.NaN,
    proposalBindings: Number.NaN,
    actions: Number.NaN,
    executions: Number.NaN,
    applicationClaims: Number.NaN,
    providerReceipts: Number.NaN,
  };
  try {
    residue = await transport.readFirstUseActionResidue({
      userIds: users.map(({ id }) => id),
      coupleIds,
      promotionIds,
      actionIds,
      messageIds,
    });
    checks.cleanup = Object.values(residue).every((count) => count === 0);
  } catch (error) {
    primaryError ??= error;
  }
  if (!checks.cleanup) {
    primaryError ??= new AmoraSuccessorStagingProbeError(
      "FIRST_USE_SYNTHETIC_RESIDUE_PRESENT",
      "First-use staging probe left synthetic rows behind",
    );
  }
  if (primaryError) throw primaryError;
  return Object.freeze({
    scenario: "first_use_deterministic_action_two_account_v1",
    providerEvidence: "synthetic_private_source_receipt_no_live_provider_call",
    syntheticUserCount: users.length,
    checks: Object.freeze({ ...checks }),
    residue: Object.freeze({ ...residue }),
  });
}

function isCanonicalBookingOutcomeResult(result, decisionId) {
  return result !== null
    && typeof result === "object"
    && result.decisionId === decisionId
    && result.completionEvidence === "user_reported"
    && result.vendorDeliveryStatus === "not_sent"
    && result.vendorConfirmationStatus === "unconfirmed";
}

function isCanonicalBookingOutcomeState(state, { ownerId, decisionId }) {
  if (state === null || typeof state !== "object") return false;
  const confirmedAt = Date.parse(state.confirmedAt);
  const decidedAt = Date.parse(state.decidedAt);
  const createdAt = Date.parse(state.createdAt);
  const updatedAt = Date.parse(state.updatedAt);
  return state.bookingStatus === "completed"
    && state.actualAmount === 650000
    && state.contractedAmount === 500000
    && state.decisionId === decisionId
    && state.decisionType === "completed"
    && state.decisionVisibility === "shared"
    && ["bride", "groom"].includes(state.sourceActorRole)
    && state.actorProfileId === ownerId
    && state.completionEvidence === "user_reported"
    && state.vendorDeliveryStatus === "not_sent"
    && state.vendorConfirmationStatus === "unconfirmed"
    && state.provenanceVersion === 1
    && typeof state.payloadDigest === "string"
    && /^[a-f0-9]{64}$/u.test(state.payloadDigest)
    && Number.isFinite(createdAt)
    && Number.isFinite(confirmedAt)
    && createdAt <= confirmedAt
    && confirmedAt === decidedAt
    && decidedAt <= updatedAt
    && state.completedDecisionCount === 1
    && state.consideringActive === 0
    && state.consideringSuperseded === 1
    && state.authorizationCount === 0;
}

export async function runBookingOutcomeProvenanceScenario({ transport }) {
  if (!transport || typeof transport !== "object") {
    fail("TRANSPORT_INVALID", "A hosted staging transport is required");
  }
  const checks = {
    ownerSpace: false,
    fixtureCreated: false,
    authenticatedCompletionDenied: false,
    outcomeRecorded: false,
    actorBound: false,
    timestampsCanonical: false,
    intentSuperseded: false,
    exactReplay: false,
    sharedDecisionVisible: false,
    noAuthorizationResidue: false,
    cleanup: false,
  };
  const users = [];
  const coupleIds = [];
  const vendorIds = [];
  const bookingIds = [];
  const decisionIds = [];
  let fixture = null;
  let primaryError = null;

  try {
    const owner = await transport.createSyntheticUser("owner");
    users.push(owner);
    requireScenario(
      isUuid(owner?.id) && typeof owner?.accessToken === "string",
      "BOOKING_OUTCOME_SYNTHETIC_USER_INVALID",
      "Booking outcome probe user was not canonical",
    );
    const ownerSpace = await transport.createNeutralPreparationSpace(owner);
    checks.ownerSpace = isCreatedPreparationSpace(ownerSpace);
    requireScenario(checks.ownerSpace, "BOOKING_OUTCOME_OWNER_SPACE_INVALID", "Owner preparation space was not canonical");
    coupleIds.push(ownerSpace.couple_id);

    fixture = await transport.prepareBookingOutcomeFixture({
      owner,
      coupleId: ownerSpace.couple_id,
    });
    checks.fixtureCreated = isUuid(fixture?.vendorId) && isUuid(fixture?.bookingId);
    requireScenario(checks.fixtureCreated, "BOOKING_OUTCOME_FIXTURE_INVALID", "Booking outcome fixture was not canonical");
    vendorIds.push(fixture.vendorId);
    bookingIds.push(fixture.bookingId);

    const denied = await transport.attemptBookingOutcomeAsAuthenticated(owner, fixture);
    checks.authenticatedCompletionDenied = denied?.denied === true;
    requireScenario(
      checks.authenticatedCompletionDenied,
      "BOOKING_OUTCOME_AUTHENTICATED_RPC_ALLOWED",
      "Authenticated client reached the service-only booking outcome RPC",
    );

    const first = await transport.completeBookingOutcome({ owner, fixture });
    requireScenario(isUuid(first?.decisionId), "BOOKING_OUTCOME_RESULT_INVALID", "Booking outcome did not return a decision id");
    decisionIds.push(first.decisionId);
    fixture = Object.freeze({ ...fixture, decisionId: first.decisionId });
    checks.outcomeRecorded = isCanonicalBookingOutcomeResult(first, first.decisionId);
    requireScenario(checks.outcomeRecorded, "BOOKING_OUTCOME_RESULT_INVALID", "Booking outcome result was not canonical");

    const firstState = await transport.readBookingOutcomeState({ fixture, decisionId: first.decisionId });
    const canonicalState = isCanonicalBookingOutcomeState(firstState, {
      ownerId: owner.id,
      decisionId: first.decisionId,
    });
    checks.actorBound = canonicalState
      && firstState.actorProfileId === owner.id
      && ["bride", "groom"].includes(firstState.sourceActorRole);
    checks.timestampsCanonical = canonicalState
      && firstState.confirmedAt === firstState.decidedAt
      && Date.parse(firstState.decidedAt) <= Date.parse(firstState.updatedAt);
    checks.intentSuperseded = canonicalState
      && firstState.consideringActive === 0
      && firstState.consideringSuperseded === 1;
    checks.noAuthorizationResidue = canonicalState && firstState.authorizationCount === 0;
    requireScenario(checks.actorBound, "BOOKING_OUTCOME_ACTOR_INVALID", "Booking outcome actor provenance was not canonical");
    requireScenario(checks.timestampsCanonical, "BOOKING_OUTCOME_TIME_INVALID", "Booking outcome timestamps were not canonical");
    requireScenario(checks.intentSuperseded, "BOOKING_OUTCOME_INTENT_NOT_SUPERSEDED", "Booking intent was not superseded exactly once");
    requireScenario(checks.noAuthorizationResidue, "BOOKING_OUTCOME_AUTHORIZATION_RESIDUE", "Booking outcome authorization residue remained");

    const replay = await transport.completeBookingOutcome({ owner, fixture });
    const replayState = await transport.readBookingOutcomeState({ fixture, decisionId: first.decisionId });
    checks.exactReplay = isCanonicalBookingOutcomeResult(replay, first.decisionId)
      && isCanonicalBookingOutcomeState(replayState, {
        ownerId: owner.id,
        decisionId: first.decisionId,
      })
      && replayState.confirmedAt === firstState.confirmedAt
      && replayState.decidedAt === firstState.decidedAt
      && replayState.payloadDigest === firstState.payloadDigest;
    requireScenario(checks.exactReplay, "BOOKING_OUTCOME_REPLAY_INVALID", "Exact booking outcome retry changed its provenance");

    const visible = await transport.readBookingOutcomeDecisionAsUser(owner, first.decisionId);
    checks.sharedDecisionVisible = Array.isArray(visible)
      && visible.length === 1
      && visible[0]?.id === first.decisionId
      && visible[0]?.source === "vendor_booking"
      && visible[0]?.decision_type === "completed"
      && visible[0]?.visibility === "shared";
    requireScenario(checks.sharedDecisionVisible, "BOOKING_OUTCOME_SHARED_DECISION_HIDDEN", "Owner could not read the shared booking outcome receipt");
  } catch (error) {
    primaryError = error;
  } finally {
    if (fixture) {
      try { await transport.deleteBookingOutcomeFixture(fixture); } catch (error) { primaryError ??= error; }
    }
    for (const user of [...users].reverse()) {
      try { await transport.resetMembership(user); } catch { /* Auth deletion is final. */ }
    }
    for (const user of [...users].reverse()) {
      try { await transport.deleteSyntheticUser(user.id); } catch (error) { primaryError ??= error; }
    }
  }

  let residue = {
    profiles: Number.NaN,
    couples: Number.NaN,
    journeys: Number.NaN,
    vendors: Number.NaN,
    timeslots: Number.NaN,
    bookings: Number.NaN,
    reviews: Number.NaN,
    decisions: Number.NaN,
    intentAuthorizations: Number.NaN,
    outcomeAuthorizations: Number.NaN,
    projectionJobs: Number.NaN,
  };
  try {
    residue = await transport.readBookingOutcomeResidue({
      userIds: users.map(({ id }) => id),
      coupleIds,
      vendorIds,
      bookingIds,
      decisionIds,
    });
    checks.cleanup = Object.values(residue).every((count) => count === 0);
  } catch (error) {
    primaryError ??= error;
  }
  if (!checks.cleanup) {
    primaryError ??= new AmoraSuccessorStagingProbeError(
      "BOOKING_OUTCOME_SYNTHETIC_RESIDUE_PRESENT",
      "Booking outcome staging probe left synthetic rows behind",
    );
  }
  if (primaryError) throw primaryError;
  return Object.freeze({
    scenario: "booking_outcome_provenance_solo_v1",
    syntheticUserCount: users.length,
    checks: Object.freeze({ ...checks }),
    residue: Object.freeze({ ...residue }),
  });
}
