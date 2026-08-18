import {
  AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT,
  AMORA_PREPARATION_NOTES_PAGE_LIMIT,
  AMORA_PREPARATION_SCHEDULE_DECISION_PAGE_LIMIT,
  AMORA_PREPARATION_TOPIC_MESSAGE_REF_LIST_LIMIT,
  isAmoraPreparationTopicMessageRefTopicKey,
  parseAmoraPreparationTopicMessageRefMutationRequest,
  validateAmoraPreparationActionReceiptPageResponse,
  validateAmoraPreparationNotesPageResponse,
  validateAmoraPreparationScheduleDecisionPageResponse,
  validateAmoraPreparationTopicMessageRefCollectionResponse,
  validateAmoraPreparationTopicMessageRefMutationResponse,
  validateAmoraPreparationTopicMessageRefStateResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";
import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { buildPreparationActionReceiptPage } from "@/lib/amora/preparationActionReceipt";
import { buildPreparationScheduleDecisionReceiptPage } from "@/lib/amora/preparationScheduleDecisionReceipt";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 2_048;
const MAX_NOTES_QUERY_CODE_POINTS = 120;
const NOTES_CURSOR_RE = /^np1\.[A-Za-z0-9_-]{16,512}$/u;
const ACTION_RECEIPT_CURSOR_RE = /^ap1\.[A-Za-z0-9_-]{16,512}$/u;
const SCHEDULE_DECISION_CURSOR_RE = /^sd1\.[A-Za-z0-9_-]{16,512}$/u;
const NOTES_QUERY_UNSAFE_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type RequestContext = {
  userId: string;
  coupleId: string;
  privacyEpoch: number;
};

type ContextResult =
  | { ok: true; value: RequestContext }
  | { ok: false; response: NextResponse };

function isMissingRowError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "PGRST116";
}

async function loadContext(request: Request): Promise<ContextResult> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_AUTH_REQUIRED" }, 401),
    };
  }
  const userId = user.id.toLowerCase();
  const actor = verifyMutationActorFence(request.headers, userId, {
    allowLegacy: false,
  });
  if (!actor.ok) {
    return { ok: false, response: response({ code: actor.code }, actor.status) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .single();
  if (profileError && !isMissingRowError(profileError)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503),
    };
  }
  if (
    !isUuid(profile?.couple_id)
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409),
    };
  }
  const coupleId = profile.couple_id.toLowerCase();
  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", coupleId)
    .single();
  if (coupleError && !isMissingRowError(coupleError)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503),
    };
  }
  const rosterMatches = !coupleError && (
    (profile.role === "bride"
      && isUuid(couple?.bride_id)
      && couple.bride_id.toLowerCase() === userId)
    || (profile.role === "groom"
      && isUuid(couple?.groom_id)
      && couple.groom_id.toLowerCase() === userId)
  );
  if (!rosterMatches) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409),
    };
  }

  const { data: privacyEpoch, error: privacyError } = await supabase.rpc(
    "get_own_amora_privacy_epoch",
    { p_couple_id: coupleId, p_visibility: "shared" },
  );
  if (
    privacyError
    || !Number.isSafeInteger(privacyEpoch)
    || privacyEpoch < 1
  ) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_PRIVACY_UNAVAILABLE" }, 503),
    };
  }
  return {
    ok: true,
    value: { userId, coupleId, privacyEpoch },
  };
}

function privateRateLimit(responseValue: NextResponse) {
  responseValue.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  responseValue.headers.set("Vary", PRIVATE_HEADERS.Vary);
  return responseValue;
}

function mapRpcError(error: { code?: unknown }) {
  if (error.code === "P0002") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND" }, 404);
  }
  if (error.code === "40001" || error.code === "PT409") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONFLICT" }, 409);
  }
  if (error.code === "22023") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID" }, 400);
  }
  return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
}

type ReadQuery =
  | { mode: "list" }
  | { mode: "state"; topicKey: string; messageId: string }
  | {
      mode: "notes";
      query: string;
      limit: number;
      cursor: {
        snapshotAt: string;
        savedAt: string;
        refId: string;
      } | null;
    }
  | {
      mode: "action_receipts";
      query: string;
      limit: number;
      cursor: {
        snapshotAt: string;
        appliedAt: string;
        receiptMessageId: string;
      } | null;
    }
  | {
      mode: "schedule_decisions";
      query: string;
      limit: number;
      cursor: {
        snapshotAt: string;
        currentJourneyRevision: number;
        confirmedAt: string;
        decisionId: string;
      } | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function normalizeNotesQuery(value: string | null) {
  if (value === null) return "";
  if (Array.from(value).length > MAX_NOTES_QUERY_CODE_POINTS) return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return NOTES_QUERY_UNSAFE_RE.test(normalized) ? null : normalized;
}

function decodeNotesCursor(value: string | null, expectedQuery: string) {
  if (value === null) return null;
  if (!NOTES_CURSOR_RE.test(value)) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value.slice(4), "base64url").toString("utf8"),
    );
    if (
      !isRecord(parsed)
      || !hasExactKeys(parsed, ["v", "snapshotAt", "savedAt", "refId", "query"])
      || parsed.v !== 1
      || !isIsoTime(parsed.snapshotAt)
      || !isIsoTime(parsed.savedAt)
      || Date.parse(parsed.savedAt) > Date.parse(parsed.snapshotAt)
      || !isUuid(parsed.refId)
      || parsed.query !== expectedQuery
    ) return undefined;
    return {
      snapshotAt: parsed.snapshotAt,
      savedAt: parsed.savedAt,
      refId: parsed.refId.toLowerCase(),
    };
  } catch {
    return undefined;
  }
}

function encodeNotesCursor(input: {
  snapshotAt: string;
  savedAt: string;
  refId: string;
  query: string;
}) {
  return `np1.${Buffer.from(JSON.stringify({
    v: 1,
    snapshotAt: input.snapshotAt,
    savedAt: input.savedAt,
    refId: input.refId,
    query: input.query,
  }), "utf8").toString("base64url")}`;
}

function decodeActionReceiptCursor(value: string | null, expectedQuery: string) {
  if (value === null) return null;
  if (!ACTION_RECEIPT_CURSOR_RE.test(value)) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value.slice(4), "base64url").toString("utf8"),
    );
    if (
      !isRecord(parsed)
      || !hasExactKeys(parsed, [
        "v", "snapshotAt", "appliedAt", "receiptMessageId", "query",
      ])
      || parsed.v !== 1
      || !isIsoTime(parsed.snapshotAt)
      || !isIsoTime(parsed.appliedAt)
      || Date.parse(parsed.appliedAt) > Date.parse(parsed.snapshotAt)
      || Date.parse(parsed.snapshotAt) > Date.now() + 5_000
      || !isUuid(parsed.receiptMessageId)
      || parsed.query !== expectedQuery
    ) return undefined;
    return {
      snapshotAt: parsed.snapshotAt,
      appliedAt: parsed.appliedAt,
      receiptMessageId: parsed.receiptMessageId.toLowerCase(),
    };
  } catch {
    return undefined;
  }
}

function encodeActionReceiptCursor(input: {
  snapshotAt: string;
  appliedAt: string;
  receiptMessageId: string;
  query: string;
}) {
  return `ap1.${Buffer.from(JSON.stringify({
    v: 1,
    snapshotAt: input.snapshotAt,
    appliedAt: input.appliedAt,
    receiptMessageId: input.receiptMessageId,
    query: input.query,
  }), "utf8").toString("base64url")}`;
}

function decodeScheduleDecisionCursor(value: string | null, expectedQuery: string) {
  if (value === null) return null;
  if (!SCHEDULE_DECISION_CURSOR_RE.test(value)) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value.slice(4), "base64url").toString("utf8"),
    );
    const currentJourneyRevision = isRecord(parsed)
      ? parsed.currentJourneyRevision
      : null;
    if (
      !isRecord(parsed)
      || !hasExactKeys(parsed, [
        "v",
        "snapshotAt",
        "currentJourneyRevision",
        "confirmedAt",
        "decisionId",
        "query",
      ])
      || parsed.v !== 1
      || !isIsoTime(parsed.snapshotAt)
      || typeof currentJourneyRevision !== "number"
      || !Number.isSafeInteger(currentJourneyRevision)
      || currentJourneyRevision < 0
      || !isIsoTime(parsed.confirmedAt)
      || Date.parse(parsed.confirmedAt) > Date.parse(parsed.snapshotAt)
      || !isUuid(parsed.decisionId)
      || parsed.query !== expectedQuery
    ) return undefined;
    return {
      snapshotAt: parsed.snapshotAt,
      currentJourneyRevision,
      confirmedAt: parsed.confirmedAt,
      decisionId: parsed.decisionId.toLowerCase(),
    };
  } catch {
    return undefined;
  }
}

function encodeScheduleDecisionCursor(input: {
  snapshotAt: string;
  currentJourneyRevision: number;
  confirmedAt: string;
  decisionId: string;
  query: string;
}) {
  return `sd1.${Buffer.from(JSON.stringify({ v: 1, ...input }), "utf8").toString("base64url")}`;
}

function parseNotesBoundary(value: unknown, snapshotAt: string) {
  if (value === null) return null;
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["savedAt", "refId"])
    || typeof value.savedAt !== "string"
    || !isIsoTime(value.savedAt)
    || Date.parse(value.savedAt) > Date.parse(snapshotAt)
    || typeof value.refId !== "string"
    || !isUuid(value.refId)
  ) return undefined;
  return { savedAt: value.savedAt, refId: value.refId.toLowerCase() };
}

function isStrictlyOlderNotesBoundary(
  next: { savedAt: string; refId: string },
  current: { savedAt: string; refId: string },
) {
  const nextSavedAt = Date.parse(next.savedAt);
  const currentSavedAt = Date.parse(current.savedAt);
  return nextSavedAt < currentSavedAt
    || (nextSavedAt === currentSavedAt && next.refId < current.refId);
}

function parseActionReceiptBoundary(value: unknown, snapshotAt: string) {
  if (value === null) return null;
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["appliedAt", "receiptMessageId"])
    || !isIsoTime(value.appliedAt)
    || Date.parse(value.appliedAt) > Date.parse(snapshotAt)
    || !isUuid(value.receiptMessageId)
  ) return undefined;
  return {
    appliedAt: value.appliedAt,
    receiptMessageId: value.receiptMessageId.toLowerCase(),
  };
}

function isStrictlyOlderActionReceiptBoundary(
  next: { appliedAt: string; receiptMessageId: string },
  current: { appliedAt: string; receiptMessageId: string },
) {
  const nextAppliedAt = Date.parse(next.appliedAt);
  const currentAppliedAt = Date.parse(current.appliedAt);
  return nextAppliedAt < currentAppliedAt
    || (
      nextAppliedAt === currentAppliedAt
      && next.receiptMessageId < current.receiptMessageId
    );
}

function parseScheduleDecisionBoundary(value: unknown, snapshotAt: string) {
  if (value === null) return null;
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["confirmedAt", "decisionId"])
    || !isIsoTime(value.confirmedAt)
    || Date.parse(value.confirmedAt) > Date.parse(snapshotAt)
    || !isUuid(value.decisionId)
  ) return undefined;
  return {
    confirmedAt: value.confirmedAt,
    decisionId: value.decisionId.toLowerCase(),
  };
}

function isStrictlyOlderScheduleDecisionBoundary(
  next: { confirmedAt: string; decisionId: string },
  current: { confirmedAt: string; decisionId: string },
) {
  const nextConfirmedAt = Date.parse(next.confirmedAt);
  const currentConfirmedAt = Date.parse(current.confirmedAt);
  return nextConfirmedAt < currentConfirmedAt
    || (nextConfirmedAt === currentConfirmedAt && next.decisionId < current.decisionId);
}

function parseReadQuery(request: Request): ReadQuery | null {
  const searchParams = new URL(request.url).searchParams;
  const entries = [...searchParams.entries()];
  if (entries.length === 0) return { mode: "list" };
  if (searchParams.get("view") === "notes") {
    const allowedKeys = new Set(["view", "q", "cursor", "limit"]);
    if (
      entries.some(([key]) => !allowedKeys.has(key))
      || [...allowedKeys].some((key) => searchParams.getAll(key).length > 1)
    ) return null;
    const query = normalizeNotesQuery(searchParams.get("q"));
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit === null ? AMORA_PREPARATION_NOTES_PAGE_LIMIT : Number(rawLimit);
    if (
      query === null
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > AMORA_PREPARATION_NOTES_PAGE_LIMIT
      || (rawLimit !== null && String(limit) !== rawLimit)
    ) return null;
    const cursor = decodeNotesCursor(searchParams.get("cursor"), query);
    if (cursor === undefined) return null;
    return { mode: "notes", query, limit, cursor };
  }
  if (searchParams.get("view") === "action-receipts") {
    const allowedKeys = new Set(["view", "q", "cursor", "limit"]);
    if (
      entries.some(([key]) => !allowedKeys.has(key))
      || [...allowedKeys].some((key) => searchParams.getAll(key).length > 1)
    ) return null;
    const query = normalizeNotesQuery(searchParams.get("q"));
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit === null
      ? AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT
      : Number(rawLimit);
    if (
      query === null
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT
      || (rawLimit !== null && String(limit) !== rawLimit)
    ) return null;
    const cursor = decodeActionReceiptCursor(searchParams.get("cursor"), query);
    if (cursor === undefined) return null;
    return { mode: "action_receipts", query, limit, cursor };
  }
  if (searchParams.get("view") === "schedule-decisions") {
    const allowedKeys = new Set(["view", "q", "cursor", "limit"]);
    if (
      entries.some(([key]) => !allowedKeys.has(key))
      || [...allowedKeys].some((key) => searchParams.getAll(key).length > 1)
    ) return null;
    const query = normalizeNotesQuery(searchParams.get("q"));
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit === null
      ? AMORA_PREPARATION_SCHEDULE_DECISION_PAGE_LIMIT
      : Number(rawLimit);
    if (
      query === null
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > AMORA_PREPARATION_SCHEDULE_DECISION_PAGE_LIMIT
      || (rawLimit !== null && String(limit) !== rawLimit)
    ) return null;
    const cursor = decodeScheduleDecisionCursor(searchParams.get("cursor"), query);
    if (cursor === undefined) return null;
    return { mode: "schedule_decisions", query, limit, cursor };
  }
  if (
    entries.length !== 2
    || searchParams.getAll("topicKey").length !== 1
    || searchParams.getAll("messageId").length !== 1
    || entries.some(([key]) => key !== "topicKey" && key !== "messageId")
  ) return null;
  const topicKey = searchParams.get("topicKey");
  const messageId = searchParams.get("messageId");
  if (!isAmoraPreparationTopicMessageRefTopicKey(topicKey) || !isUuid(messageId)) {
    return null;
  }
  return { mode: "state", topicKey, messageId: messageId.toLowerCase() };
}

const ACTION_RECEIPT_ORIGINS = [
  "server_authoritative_first_use_action_application",
  "server_authoritative_provider_backed_add_action_application",
] as const;

function uniqueUuids(values: readonly unknown[]) {
  return [...new Set(values.filter(isUuid).map((value) => value.toLowerCase()))];
}

async function readActionReceiptPage(
  context: RequestContext,
  query: Extract<ReadQuery, { mode: "action_receipts" }>,
) {
  const admin = createAdminClient();
  const snapshotAt = query.cursor?.snapshotAt ?? new Date().toISOString();
  const scanLimit = Math.min(query.limit * 8, 192);
  let receiptQuery = admin
    .from("chat_messages")
    .select("id, couple_id, sender_id, sender_type, sender_role, role, content, metadata, visibility, stage_tag, specialist_type, created_at")
    .eq("couple_id", context.coupleId)
    .eq("visibility", "shared")
    .eq("sender_type", "ai")
    .eq("role", "assistant")
    .is("sender_id", null)
    .or("metadata->>target.is.null,metadata->>target.neq.partner")
    .in("metadata->>response_origin", [...ACTION_RECEIPT_ORIGINS])
    .lte("created_at", snapshotAt);
  if (query.cursor) {
    receiptQuery = receiptQuery.or([
      `created_at.lt.${query.cursor.appliedAt}`,
      `and(created_at.eq.${query.cursor.appliedAt},id.lt.${query.cursor.receiptMessageId})`,
    ].join(","));
  }
  const { data: rawReceipts, error: receiptError } = await receiptQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(scanLimit + 1);
  if (receiptError || !Array.isArray(rawReceipts)) return null;

  const receiptMetadata = rawReceipts
    .map((row) => (isRecord(row) && isRecord(row.metadata) ? row.metadata : null))
    .filter((value): value is Record<string, unknown> => value !== null);
  const promotionIds = uniqueUuids(receiptMetadata.map(
    (metadata) => metadata.amora_first_use_promotion_id,
  ));
  const confirmationIds = uniqueUuids(receiptMetadata.map(
    (metadata) => metadata.in_reply_to_user_message_id,
  ));
  const providerSourceIds = uniqueUuids(receiptMetadata.map(
    (metadata) => metadata.source_amora_action_message_id,
  ));
  const requestKeys = [...new Set(receiptMetadata
    .map((metadata) => metadata.client_request_id)
    .filter((value): value is string => typeof value === "string"))];

  let firstUseBindings: unknown[] = [];
  if (promotionIds.length > 0) {
    const { data, error } = await admin
      .from("amora_first_use_action_proposal_bindings")
      .select("proposal_message_id, couple_id, action_id, promotion_id, proposal_journey_revision")
      .eq("couple_id", context.coupleId)
      .in("promotion_id", promotionIds);
    if (error || !Array.isArray(data)) return null;
    firstUseBindings = data;
  }
  const firstUseSourceIds = uniqueUuids(firstUseBindings.map(
    (binding) => isRecord(binding) ? binding.proposal_message_id : null,
  ));
  const messageIds = uniqueUuids([
    ...providerSourceIds,
    ...firstUseSourceIds,
    ...confirmationIds,
  ]);

  let sourceAndConfirmationMessages: unknown[] = [];
  if (messageIds.length > 0) {
    const { data, error } = await admin
      .from("chat_messages")
      .select("id, couple_id, sender_id, sender_type, sender_role, role, content, metadata, visibility, stage_tag, specialist_type, created_at")
      .eq("couple_id", context.coupleId)
      .in("id", messageIds)
      .or("metadata->>target.is.null,metadata->>target.neq.partner");
    if (error || !Array.isArray(data)) return null;
    sourceAndConfirmationMessages = data;
  }

  let executions: unknown[] = [];
  if (requestKeys.length > 0) {
    const { data, error } = await admin
      .from("amora_tool_executions")
      .select("couple_id, request_key, operation_key, tool_name, input_digest, status, result, pending_action_id, pending_action_journey_revision")
      .eq("couple_id", context.coupleId)
      .eq("tool_name", "add_amora_action")
      .eq("status", "completed")
      .in("request_key", requestKeys);
    if (error || !Array.isArray(data)) return null;
    executions = data;
  }

  const built = buildPreparationActionReceiptPage({
    coupleId: context.coupleId,
    recipientUserId: context.userId,
    query: query.query,
    snapshotAt,
    limit: query.limit,
    scanLimit,
    receiptMessages: rawReceipts,
    sourceAndConfirmationMessages,
    firstUseBindings,
    executions,
    nowMs: Date.now(),
  });
  return built ? { snapshotAt, ...built } : null;
}

const PREPARATION_TOPIC_LABELS = Object.freeze(Object.fromEntries(
  CATEGORY_CHECKLISTS.map((topic) => [topic.key, topic.label]),
));

async function readScheduleDecisionPage(
  context: RequestContext,
  query: Extract<ReadQuery, { mode: "schedule_decisions" }>,
) {
  const admin = createAdminClient();
  const { data: journey, error: journeyError } = await admin
    .from("wedding_journeys")
    .select("progress, state_revision")
    .eq("couple_id", context.coupleId)
    .single();
  if (
    journeyError
    || !isRecord(journey)
    || !isRecord(journey.progress)
    || !Array.isArray(journey.progress.__events)
    || !Number.isSafeInteger(journey.state_revision)
    || journey.state_revision < 0
  ) return { kind: "unavailable" as const };
  if (
    query.cursor
    && query.cursor.currentJourneyRevision !== journey.state_revision
  ) return { kind: "context_changed" as const };

  const snapshotAt = query.cursor?.snapshotAt ?? new Date().toISOString();
  const scanLimit = 80;
  const { data: decisionRows, error: decisionError } = await admin
    .from("decision_nodes")
    .select("id, couple_id, category, decision_type, title, chosen_value, source, source_ref_id, source_actor_role, user_confirmed_at, decided_at, metadata, visibility, superseded_at, memory_key")
    .eq("couple_id", context.coupleId)
    .eq("visibility", "shared")
    .eq("source", "schedule")
    .eq("decision_type", "scheduled")
    .is("memory_key", null)
    .is("superseded_at", null)
    .not("user_confirmed_at", "is", null)
    .in("source_actor_role", ["bride", "groom"])
    .in("category", Object.keys(PREPARATION_TOPIC_LABELS))
    .lte("user_confirmed_at", snapshotAt)
    .order("decided_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(scanLimit + 1);
  if (decisionError || !Array.isArray(decisionRows)) {
    return { kind: "unavailable" as const };
  }

  const built = buildPreparationScheduleDecisionReceiptPage({
    coupleId: context.coupleId,
    recipientUserId: context.userId,
    query: query.query,
    snapshotAt,
    currentJourneyRevision: journey.state_revision,
    progress: journey.progress,
    limit: query.limit,
    scanLimit,
    decisionRows,
    topicLabels: PREPARATION_TOPIC_LABELS,
    nowMs: Date.parse(snapshotAt),
    cursorBoundary: query.cursor === null ? null : {
      confirmedAt: query.cursor.confirmedAt,
      decisionId: query.cursor.decisionId,
    },
  });
  return built
    ? { kind: "ready" as const, snapshotAt, currentJourneyRevision: journey.state_revision, ...built }
    : { kind: "unavailable" as const };
}

export async function GET(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_ORIGIN_REJECTED" }, 403);
    }
    const query = parseReadQuery(request);
    if (!query) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_QUERY_INVALID" }, 400);
    }
    const loaded = await loadContext(request);
    if (!loaded.ok) return loaded.response;
    const context = loaded.value;
    const limited = checkRateLimit(
      rateLimitKey("amora-preparation-topic-message-ref:read", request, context.userId),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) return privateRateLimit(limited);

    if (query.mode === "list") {
      const { data, error } = await createAdminClient().rpc(
        "list_amora_preparation_topic_message_refs_v1",
        {
          p_couple_id: context.coupleId,
          p_recipient_user_id: context.userId,
          p_expected_privacy_epoch: context.privacyEpoch,
          p_limit: AMORA_PREPARATION_TOPIC_MESSAGE_REF_LIST_LIMIT,
        },
      );
      if (error) return mapRpcError(error);
      const validated = validateAmoraPreparationTopicMessageRefCollectionResponse(
        data,
        context.userId,
        context.coupleId,
      );
      if (!validated.ok) {
        console.error("[preparation-topic-message-refs] invalid list response", {
          reason: validated.reason,
        });
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
      }
      return response(validated.value);
    }

    if (query.mode === "notes") {
      const { data, error } = await createAdminClient().rpc(
        "list_amora_preparation_notes_v1",
        {
          p_couple_id: context.coupleId,
          p_recipient_user_id: context.userId,
          p_expected_privacy_epoch: context.privacyEpoch,
          p_query: query.query,
          p_snapshot_at: query.cursor?.snapshotAt ?? null,
          p_cursor_saved_at: query.cursor?.savedAt ?? null,
          p_cursor_ref_id: query.cursor?.refId ?? null,
          p_limit: query.limit,
        },
      );
      if (error) return mapRpcError(error);
      const nextBoundary = isRecord(data) && isIsoTime(data.snapshotAt)
        ? parseNotesBoundary(data.nextBoundary, data.snapshotAt)
        : undefined;
      const snapshotMatchesCursor = query.cursor === null
        || (isRecord(data) && data.snapshotAt === query.cursor.snapshotAt);
      const nextBoundaryAdvances = query.cursor === null
        || nextBoundary === null
        || (
          nextBoundary !== undefined
          && isStrictlyOlderNotesBoundary(nextBoundary, query.cursor)
        );
      if (
        !isRecord(data)
        || !hasExactKeys(data, [
          "version",
          "state",
          "recipientUserId",
          "coupleId",
          "snapshotAt",
          "entries",
          "nextBoundary",
          "partial",
        ])
        || !Array.isArray(data.entries)
        || data.entries.length > query.limit
        || !isIsoTime(data.snapshotAt)
        || nextBoundary === undefined
        || !snapshotMatchesCursor
        || !nextBoundaryAdvances
      ) {
        console.error("[preparation-topic-message-refs] invalid notes response");
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
      }
      const notesPage = {
        version: data.version,
        state: data.state,
        recipientUserId: data.recipientUserId,
        coupleId: data.coupleId,
        snapshotAt: data.snapshotAt,
        entries: data.entries,
        nextCursor: nextBoundary === null
          ? null
          : encodeNotesCursor({
              snapshotAt: data.snapshotAt,
              savedAt: nextBoundary.savedAt,
              refId: nextBoundary.refId,
              query: query.query,
            }),
        partial: data.partial,
      };
      const validated = validateAmoraPreparationNotesPageResponse(
        notesPage,
        context.userId,
        context.coupleId,
      );
      if (!validated.ok) {
        console.error("[preparation-topic-message-refs] invalid notes response", {
          reason: validated.reason,
        });
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
      }
      return response(validated.value);
    }

    if (query.mode === "action_receipts") {
      const loadedPage = await readActionReceiptPage(context, query);
      if (!loadedPage) {
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
      }
      const nextBoundary = parseActionReceiptBoundary(
        loadedPage.nextBoundary,
        loadedPage.snapshotAt,
      );
      const snapshotMatchesCursor = query.cursor === null
        || loadedPage.snapshotAt === query.cursor.snapshotAt;
      const nextBoundaryAdvances = query.cursor === null
        || nextBoundary === null
        || (
          nextBoundary !== undefined
          && isStrictlyOlderActionReceiptBoundary(nextBoundary, query.cursor)
        );
      if (
        !isIsoTime(loadedPage.snapshotAt)
        || nextBoundary === undefined
        || !snapshotMatchesCursor
        || !nextBoundaryAdvances
      ) {
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
      }
      const refreshed = await loadContext(request);
      if (
        !refreshed.ok
        || refreshed.value.userId !== context.userId
        || refreshed.value.coupleId !== context.coupleId
        || refreshed.value.privacyEpoch !== context.privacyEpoch
      ) {
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409);
      }
      const nextCursor = nextBoundary === null
        ? null
        : encodeActionReceiptCursor({
            snapshotAt: loadedPage.snapshotAt,
            appliedAt: nextBoundary.appliedAt,
            receiptMessageId: nextBoundary.receiptMessageId,
            query: query.query,
          });
      const page = {
        version: 1,
        state: "ready",
        recipientUserId: context.userId,
        coupleId: context.coupleId,
        snapshotAt: loadedPage.snapshotAt,
        entries: loadedPage.entries,
        nextCursor,
        partial: loadedPage.partial,
      };
      const validated = validateAmoraPreparationActionReceiptPageResponse(
        page,
        context.userId,
        context.coupleId,
      );
      if (!validated.ok) {
        console.error("[preparation-topic-message-refs] invalid action receipt response", {
          reason: validated.reason,
        });
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
      }
      return response(validated.value);
    }

    if (query.mode === "schedule_decisions") {
      const loadedPage = await readScheduleDecisionPage(context, query);
      if (loadedPage.kind === "context_changed") {
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409);
      }
      if (loadedPage.kind !== "ready") {
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
      }
      const nextBoundary = parseScheduleDecisionBoundary(
        loadedPage.nextBoundary,
        loadedPage.snapshotAt,
      );
      const snapshotMatchesCursor = query.cursor === null
        || loadedPage.snapshotAt === query.cursor.snapshotAt;
      const nextBoundaryAdvances = query.cursor === null
        || nextBoundary === null
        || (
          nextBoundary !== undefined
          && isStrictlyOlderScheduleDecisionBoundary(nextBoundary, query.cursor)
        );
      if (
        nextBoundary === undefined
        || !snapshotMatchesCursor
        || !nextBoundaryAdvances
      ) {
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
      }
      const refreshed = await loadContext(request);
      if (
        !refreshed.ok
        || refreshed.value.userId !== context.userId
        || refreshed.value.coupleId !== context.coupleId
        || refreshed.value.privacyEpoch !== context.privacyEpoch
      ) {
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409);
      }
      const page = {
        version: 1,
        state: "ready",
        recipientUserId: context.userId,
        coupleId: context.coupleId,
        snapshotAt: loadedPage.snapshotAt,
        currentJourneyRevision: loadedPage.currentJourneyRevision,
        entries: loadedPage.entries,
        nextCursor: nextBoundary === null
          ? null
          : encodeScheduleDecisionCursor({
              snapshotAt: loadedPage.snapshotAt,
              currentJourneyRevision: loadedPage.currentJourneyRevision,
              confirmedAt: nextBoundary.confirmedAt,
              decisionId: nextBoundary.decisionId,
              query: query.query,
            }),
        partial: loadedPage.partial,
      };
      const validated = validateAmoraPreparationScheduleDecisionPageResponse(
        page,
        context.userId,
        context.coupleId,
      );
      if (!validated.ok) {
        console.error("[preparation-topic-message-refs] invalid schedule decision response", {
          reason: validated.reason,
        });
        return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
      }
      return response(validated.value);
    }

    const { data, error } = await createAdminClient().rpc(
      "get_amora_preparation_topic_message_ref_state_v1",
      {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_topic_key: query.topicKey,
        p_message_id: query.messageId,
        p_expected_privacy_epoch: context.privacyEpoch,
      },
    );
    if (error) return mapRpcError(error);
    const validated = validateAmoraPreparationTopicMessageRefStateResponse(
      data,
      context.userId,
      context.coupleId,
      query.topicKey,
      query.messageId,
    );
    if (!validated.ok) {
      console.error("[preparation-topic-message-refs] invalid state response", {
        reason: validated.reason,
      });
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
    }
    return response(validated.value);
  } catch (error) {
    console.error("[preparation-topic-message-refs] GET failed", error);
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_ORIGIN_REJECTED" }, 403);
    }
    if ([...new URL(request.url).searchParams.entries()].length > 0) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_QUERY_INVALID" }, 400);
    }
    const loaded = await loadContext(request);
    if (!loaded.ok) return loaded.response;
    const context = loaded.value;
    const limited = checkRateLimit(
      rateLimitKey("amora-preparation-topic-message-ref:write", request, context.userId),
      { maxRequests: 30, windowMs: 60_000 },
    );
    if (limited) return privateRateLimit(limited);

    const raw = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!raw.ok) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID" }, 400);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.text);
    } catch {
      parsed = null;
    }
    const input = parseAmoraPreparationTopicMessageRefMutationRequest(parsed);
    if (!input) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID" }, 400);
    }

    const { data, error } = await createAdminClient().rpc(
      "set_amora_preparation_topic_message_ref_v1",
      {
        p_couple_id: context.coupleId,
        p_actor_user_id: context.userId,
        p_topic_key: input.topicKey,
        p_message_id: input.messageId.toLowerCase(),
        p_desired_state: input.desiredState,
        p_expected_revision: input.expectedRevision,
        p_request_id: input.requestId.toLowerCase(),
        p_expected_privacy_epoch: context.privacyEpoch,
      },
    );
    if (error) return mapRpcError(error);
    const validated = validateAmoraPreparationTopicMessageRefMutationResponse(
      data,
      context.userId,
      context.coupleId,
      input.topicKey,
      input.messageId.toLowerCase(),
      input.desiredState,
    );
    if (!validated.ok) {
      console.error("[preparation-topic-message-refs] invalid mutation response", {
        reason: validated.reason,
      });
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
    }
    return response(validated.value);
  } catch (error) {
    console.error("[preparation-topic-message-refs] PUT failed", error);
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
  }
}
