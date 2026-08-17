import { buildAmoraPreparationOverview } from "./amoraPreparationMap.mjs";
import { buildAmoraPreparationGuideModules } from "./amoraPreparationGuide.mjs";

export const AMORA_PREPARATION_TOPIC_CONTRACT_VERSION = 1;

const EMPTY_LIST = Object.freeze([]);
const UNSAFE_DISPLAY_TEXT_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const MAX_WON_AMOUNT = 1_000_000_000;
const ACTION_ID_RE = /^[0-9A-Za-z_-]{1,200}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTION_PRIORITIES = new Set(["high", "medium", "low"]);
const ACTION_SOURCES = new Set([
  "chat", "quote", "schedule", "budget", "guardrail", "manual",
]);
const BUDGET_PAYERS = new Set([
  "couple", "bride_parents", "groom_parents", "both_parents",
]);
const SCHEDULE_DECISION_ORIGINS = new Set([
  "amora_shared_action", "couple_plan_change_request",
]);
const SCHEDULE_OPERATIONS = new Set(["add", "update", "cancel", "restore"]);
const MAX_VENDOR_QUOTE_WON = 1_000_000_000_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readTemplateItems(topic) {
  if (!Array.isArray(topic?.items)) return [];

  const seen = new Set();
  return topic.items.filter((item) => {
    if (
      !isRecord(item)
      || typeof item.id !== "string"
      || item.id.length === 0
      || typeof item.label !== "string"
      || item.label.length === 0
      || seen.has(item.id)
    ) return false;
    seen.add(item.id);
    return true;
  });
}

function readChecklistItems(topic, progress) {
  const templateItems = readTemplateItems(topic);
  const doneById = new Map(templateItems.map((item) => [item.id, false]));
  const saved = isRecord(progress) && isRecord(progress[topic.key])
    ? progress[topic.key]
    : null;

  if (Array.isArray(saved?.checklist)) {
    for (const item of saved.checklist) {
      if (
        isRecord(item)
        && typeof item.id === "string"
        && doneById.has(item.id)
        && typeof item.done === "boolean"
      ) {
        doneById.set(item.id, item.done);
      }
    }
  } else if (saved) {
    for (const item of templateItems) {
      if (typeof saved[item.id] === "boolean") {
        doneById.set(item.id, saved[item.id]);
      }
    }
  }

  return templateItems.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    done: doneById.get(item.id) === true,
  }));
}

function isValidScheduleDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function readLinkedSchedules(topicKey, scheduleEvents) {
  if (!Array.isArray(scheduleEvents)) return [];

  const seen = new Set();
  return scheduleEvents.filter((event) => {
    if (
      !isRecord(event)
      || typeof event.id !== "string"
      || event.id.length === 0
      || event.id.length > 200
      || seen.has(event.id)
      || event.categoryKey !== topicKey
      || !isValidScheduleDate(event.date)
      || typeof event.title !== "string"
      || event.title.trim().length === 0
      || event.title.length > 500
      || UNSAFE_DISPLAY_TEXT_RE.test(event.title)
      || (
        event.status !== undefined
        && event.status !== "planned"
        && event.status !== "completed"
      )
    ) return false;
    seen.add(event.id);
    return true;
  }).sort((left, right) => (
    left.date.localeCompare(right.date)
    || String(left.time ?? "").localeCompare(String(right.time ?? ""))
    || left.id.localeCompare(right.id)
  ));
}

function readWonAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_WON_AMOUNT
    ? value
    : null;
}

function readBudgetSummary(topicState, progress, topicKey) {
  const saved = isRecord(progress) ? progress[topicKey] : null;
  if (!isRecord(saved)) return null;

  const budgetIsInvalid = Object.hasOwn(saved, "budget")
    && saved.budget !== 0
    && readWonAmount(saved.budget) === null;
  const spentIsInvalid = Object.hasOwn(saved, "spent")
    && saved.spent !== 0
    && readWonAmount(saved.spent) === null;
  const payerIsInvalid = Object.hasOwn(saved, "payer")
    && !BUDGET_PAYERS.has(saved.payer);
  if (budgetIsInvalid || spentIsInvalid || payerIsInvalid) {
    return Object.freeze({ state: "invalid", categoryKey: topicKey });
  }

  const budgetWon = readWonAmount(saved.budget);
  const spentWon = readWonAmount(saved.spent);
  const hasAmount = budgetWon !== null || spentWon !== null;
  if (
    !hasAmount
    && (topicState === "unknown" || topicState === "not_applicable")
  ) return null;

  return Object.freeze({
    state: budgetWon === null && spentWon === null ? "empty" : "ready",
    categoryKey: topicKey,
    budgetWon,
    spentWon,
    payer: BUDGET_PAYERS.has(saved.payer) ? saved.payer : null,
  });
}

function readLinkedActions(topicKey, openActions) {
  if (!Array.isArray(openActions)) return [];

  const seen = new Set();
  return openActions.filter((action) => {
    if (
      !isRecord(action)
      || typeof action.id !== "string"
      || !ACTION_ID_RE.test(action.id)
      || seen.has(action.id)
      || action.categoryKey !== topicKey
      || typeof action.title !== "string"
      || action.title.trim().length === 0
      || Array.from(action.title.trim()).length > 120
      || UNSAFE_DISPLAY_TEXT_RE.test(action.title)
      || (
        action.dueDate !== null
        && !isValidScheduleDate(action.dueDate)
      )
      || !ACTION_PRIORITIES.has(action.priority)
      || !ACTION_SOURCES.has(action.source)
      || (
        action.sourceRevision !== null
        && (
          !Number.isSafeInteger(action.sourceRevision)
          || action.sourceRevision < 1
        )
      )
      || typeof action.createdAt !== "string"
      || !Number.isFinite(Date.parse(action.createdAt))
    ) return false;
    seen.add(action.id);
    return true;
  }).map((action) => Object.freeze({
    id: action.id,
    title: action.title.trim(),
    dueDate: action.dueDate,
    priority: action.priority,
    sourceRevision: action.sourceRevision,
  }));
}

function isSafeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function stableJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return undefined;

  const result = {};
  for (const key of Object.keys(value).sort()) {
    const normalized = stableJsonValue(value[key]);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function hasExactScheduleSnapshot(left, right) {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right));
}

function readConfirmedScheduleDecisions(
  topicKey,
  expectedCoupleId,
  currentJourneyRevision,
  scheduleEvents,
  scheduleDecisionReceipts,
  nowIso,
) {
  if (
    !UUID_RE.test(String(expectedCoupleId))
    || !isSafeRevision(currentJourneyRevision)
    || !Array.isArray(scheduleEvents)
    || !Array.isArray(scheduleDecisionReceipts)
    || typeof nowIso !== "string"
  ) return [];
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [];

  const currentEvents = new Map();
  for (const event of scheduleEvents) {
    if (
      !isRecord(event)
      || typeof event.id !== "string"
      || !ACTION_ID_RE.test(event.id)
      || currentEvents.has(event.id)
      || event.categoryKey !== topicKey
      || !isValidScheduleDate(event.date)
      || typeof event.title !== "string"
      || event.title.trim().length === 0
      || Array.from(event.title.trim()).length > 160
      || UNSAFE_DISPLAY_TEXT_RE.test(event.title)
      || !["planned", "completed", "cancelled"].includes(event.status ?? "planned")
    ) continue;
    currentEvents.set(event.id, event);
  }

  const candidates = scheduleDecisionReceipts.flatMap((decision) => {
    if (
      !isRecord(decision)
      || !isRecord(decision.chosen_value)
      || !isRecord(decision.metadata)
    ) return [];
    const id = typeof decision.id === "string" ? decision.id.toLowerCase() : "";
    const confirmedMs = Date.parse(String(decision.user_confirmed_at ?? ""));
    const decidedMs = Date.parse(String(decision.decided_at ?? ""));
    const chosen = decision.chosen_value;
    const metadata = decision.metadata;
    const eventId = typeof chosen.eventId === "string" ? chosen.eventId : "";
    const currentEvent = currentEvents.get(eventId);
    const expectedRevision = chosen.expectedRevision;
    const appliedRevision = chosen.appliedRevision;
    const origin = metadata.origin;
    const operation = origin === "couple_plan_change_request"
      ? chosen.mutationKind
      : chosen.operation;
    if (
      !UUID_RE.test(id)
      || decision.couple_id !== expectedCoupleId
      || decision.category !== topicKey
      || decision.visibility !== "shared"
      || decision.source !== "schedule"
      || decision.decision_type !== "scheduled"
      || decision.memory_key !== null
      || !["bride", "groom"].includes(decision.source_actor_role)
      || decision.superseded_at !== null
      || !Number.isFinite(confirmedMs)
      || !Number.isFinite(decidedMs)
      || confirmedMs > decidedMs
      || decidedMs > nowMs
      || typeof decision.title !== "string"
      || decision.title.trim().length === 0
      || Array.from(decision.title.trim()).length > 160
      || UNSAFE_DISPLAY_TEXT_RE.test(decision.title)
      || !SCHEDULE_DECISION_ORIGINS.has(origin)
      || !SCHEDULE_OPERATIONS.has(operation)
      || chosen.schemaVersion !== 1
      || !ACTION_ID_RE.test(eventId)
      || !currentEvent
      || !isRecord(chosen.after)
      || !hasExactScheduleSnapshot(chosen.after, currentEvent)
      || !isSafeRevision(expectedRevision)
      || !isSafeRevision(appliedRevision)
      || appliedRevision !== expectedRevision + 1
      || appliedRevision > currentJourneyRevision
      || !UUID_RE.test(String(decision.source_ref_id))
      || metadata.eventId !== eventId
      || (
        operation === "cancel"
        && currentEvent.status !== "cancelled"
      )
      || (
        operation === "restore"
        && currentEvent.status === "cancelled"
      )
      || (
        origin === "amora_shared_action"
        && (
          metadata.actionId !== decision.source_ref_id
          || metadata.receiptExpectedRevision !== expectedRevision
          || metadata.receiptAppliedRevision !== appliedRevision
        )
      )
      || (
        origin === "couple_plan_change_request"
        && (
          chosen.requestId !== decision.source_ref_id
          || metadata.requestId !== decision.source_ref_id
          || metadata.expectedRevision !== expectedRevision
          || metadata.appliedRevision !== appliedRevision
          || metadata.mutationKind !== operation
          || metadata.legacyReceiptOnly === true
        )
      )
    ) return [];

    const operationLabel = operation === "add"
      ? "일정 추가"
      : operation === "update"
        ? "일정 수정"
        : operation === "cancel" ? "일정 취소" : "일정 복원";
    return [Object.freeze({
      id,
      eventId,
      title: `${operationLabel} · ${currentEvent.title.trim()}`,
      date: currentEvent.date,
      confirmedAt: new Date(confirmedMs).toISOString(),
      scope: "couple_shared",
      decidedAt: new Date(decidedMs).toISOString(),
    })];
  }).sort((left, right) => (
    right.decidedAt.localeCompare(left.decidedAt)
    || left.id.localeCompare(right.id)
  ));

  const seenDecisionIds = new Set();
  const seenEventIds = new Set();
  return candidates.flatMap((candidate) => {
    if (seenDecisionIds.has(candidate.id) || seenEventIds.has(candidate.eventId)) return [];
    seenDecisionIds.add(candidate.id);
    seenEventIds.add(candidate.eventId);
    return [Object.freeze({
      id: candidate.id,
      eventId: candidate.eventId,
      title: candidate.title,
      date: candidate.date,
      confirmedAt: candidate.confirmedAt,
      scope: candidate.scope,
    })];
  });
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
}

function readBudgetAcceptances(value, currentMemberIds, decidedMs) {
  if (!Array.isArray(value) || value.length !== currentMemberIds.length) return null;
  const currentMembers = new Set(currentMemberIds);
  const seen = new Set();
  const acceptedAts = new Set();
  for (const acceptance of value) {
    if (!hasExactKeys(acceptance, ["acceptedAt", "userId"])) return null;
    const userId = String(acceptance.userId ?? "").toLowerCase();
    const acceptedMs = Date.parse(String(acceptance.acceptedAt ?? ""));
    if (
      !UUID_RE.test(userId)
      || !currentMembers.has(userId)
      || seen.has(userId)
      || !Number.isFinite(acceptedMs)
      || acceptedMs > decidedMs
    ) return null;
    seen.add(userId);
    acceptedAts.add(new Date(acceptedMs).toISOString());
  }
  return seen.size === currentMembers.size ? acceptedAts : null;
}

function isValidBudgetTopicSnapshot(value, topicKey) {
  if (
    !isRecord(value)
    || value.category !== topicKey
    || !BUDGET_PAYERS.has(value.payer)
  ) return false;
  for (const field of ["budget", "spent"]) {
    if (
      Object.hasOwn(value, field)
      && (
        !Number.isSafeInteger(value[field])
        || value[field] < 0
        || value[field] > MAX_WON_AMOUNT
      )
    ) return false;
  }
  return !Object.hasOwn(value, "label") || (
    typeof value.label === "string"
    && value.label.trim().length > 0
    && Array.from(value.label).length <= 200
    && !UNSAFE_DISPLAY_TEXT_RE.test(value.label)
  );
}

function readConfirmedBudgetDecision(
  topicKey,
  expectedCoupleId,
  currentCoupleMemberIds,
  currentJourneyRevision,
  currentProgress,
  budgetDecisionReceipts,
  budgetDecisionVerifications,
  nowIso,
) {
  const coupleId = String(expectedCoupleId ?? "").toLowerCase();
  const nowMs = Date.parse(String(nowIso ?? ""));
  if (
    !UUID_RE.test(coupleId)
    || !isSafeRevision(currentJourneyRevision)
    || !isRecord(currentProgress)
    || !Array.isArray(currentCoupleMemberIds)
    || !Array.isArray(budgetDecisionReceipts)
    || !Array.isArray(budgetDecisionVerifications)
    || !Number.isFinite(nowMs)
  ) return [];

  const memberIds = currentCoupleMemberIds.map((value) => (
    typeof value === "string" ? value.toLowerCase() : ""
  ));
  if (
    memberIds.length < 1
    || memberIds.length > 2
    || new Set(memberIds).size !== memberIds.length
    || memberIds.some((value) => !UUID_RE.test(value))
  ) return [];

  const touching = budgetDecisionReceipts.filter((decision) => (
    isRecord(decision)
    && isRecord(decision.chosen_value)
    && isRecord(decision.chosen_value.changes)
    && isRecord(decision.chosen_value.changes.progress_patch)
    && Object.hasOwn(decision.chosen_value.changes.progress_patch, topicKey)
  ));
  if (touching.length === 0) return [];
  if (touching.some((decision) => !isSafeRevision(decision.chosen_value.appliedRevision))) {
    return [];
  }
  touching.sort((left, right) => (
    right.chosen_value.appliedRevision - left.chosen_value.appliedRevision
  ));
  if (
    touching.length > 1
    && touching[0].chosen_value.appliedRevision
      === touching[1].chosen_value.appliedRevision
  ) return [];

  const decision = touching[0];
  const chosen = decision.chosen_value;
  const metadata = decision.metadata;
  const changes = chosen.changes;
  const progressPatch = changes.progress_patch;
  const patchedTopic = progressPatch[topicKey];
  const requestId = String(decision.source_ref_id ?? "").toLowerCase();
  const decisionId = String(decision.id ?? "").toLowerCase();
  const confirmedMs = Date.parse(String(decision.user_confirmed_at ?? ""));
  const decidedMs = Date.parse(String(decision.decided_at ?? ""));
  const matchingVerifications = budgetDecisionVerifications.filter((value) => (
    isRecord(value) && value.requestId === requestId
  ));
  if (matchingVerifications.length !== 1) return [];
  const verification = matchingVerifications[0];
  const journey = verification.journey;
  if (
    !isRecord(metadata)
    || !isRecord(patchedTopic)
    || !isRecord(journey)
    || !hasExactKeys(verification, [
      "acceptedCount",
      "journey",
      "requestId",
      "requiredCount",
      "status",
      "summary",
      "surface",
    ])
    || !hasExactKeys(journey, [
      "coupleId",
      "stateRevision",
      "topicKey",
      "topicSnapshot",
    ])
    || !hasExactKeys(chosen, [
      "acceptances",
      "after",
      "appliedRevision",
      "before",
      "changeDigest",
      "changes",
      "eventId",
      "expectedRevision",
      "mutationKind",
      "requestId",
      "requiredCount",
      "schemaVersion",
    ])
    || !hasExactKeys(metadata, [
      "acceptances",
      "after",
      "appliedRevision",
      "before",
      "changeDigest",
      "eventId",
      "expectedRevision",
      "mutationKind",
      "origin",
      "previousStatus",
      "requestId",
      "requiredCount",
      "rosterFingerprint",
      "surfaceHref",
    ])
    || !UUID_RE.test(decisionId)
    || !UUID_RE.test(requestId)
    || decision.couple_id !== coupleId
    || decision.category !== "budget"
    || decision.decision_type !== "decided"
    || decision.title !== verification.summary
    || typeof decision.title !== "string"
    || decision.title.trim() !== decision.title
    || Array.from(decision.title).length === 0
    || Array.from(decision.title).length > 240
    || UNSAFE_DISPLAY_TEXT_RE.test(decision.title)
    || decision.visibility !== "shared"
    || decision.source !== "manual"
    || decision.source_actor_role !== "bride" && decision.source_actor_role !== "groom"
    || decision.source_message_id !== null
    || decision.memory_key !== null
    || decision.superseded_at !== null
    || decision.superseded_by !== null
    || !Number.isFinite(confirmedMs)
    || !Number.isFinite(decidedMs)
    || confirmedMs > decidedMs
    || decidedMs > nowMs
    || chosen.schemaVersion !== 1
    || chosen.requestId !== requestId
    || !/^[a-f0-9]{64}$/u.test(String(chosen.changeDigest ?? ""))
    || !isSafeRevision(chosen.expectedRevision)
    || chosen.appliedRevision !== chosen.expectedRevision + 1
    || chosen.appliedRevision > currentJourneyRevision
    || chosen.requiredCount !== memberIds.length
    || chosen.mutationKind !== null
    || chosen.eventId !== null
    || chosen.before !== null
    || chosen.after !== null
    || !hasExactKeys(changes, ["progress_patch"])
    || !hasExactKeys(progressPatch, [topicKey])
    || !isValidBudgetTopicSnapshot(patchedTopic, topicKey)
    || !hasExactScheduleSnapshot(patchedTopic, currentProgress[topicKey])
    || metadata.origin !== "couple_plan_change_request"
    || metadata.requestId !== requestId
    || metadata.changeDigest !== chosen.changeDigest
    || !/^[a-f0-9]{32}$/u.test(String(metadata.rosterFingerprint ?? ""))
    || metadata.expectedRevision !== chosen.expectedRevision
    || metadata.appliedRevision !== chosen.appliedRevision
    || metadata.requiredCount !== chosen.requiredCount
    || !hasExactScheduleSnapshot(metadata.acceptances, chosen.acceptances)
    || metadata.mutationKind !== null
    || metadata.eventId !== null
    || metadata.before !== null
    || metadata.after !== null
    || metadata.surfaceHref !== "/budget"
    || metadata.previousStatus !== "applying"
    || metadata.legacyReceiptOnly === true
    || verification.requestId !== requestId
    || verification.status !== "applied"
    || verification.requiredCount !== chosen.requiredCount
    || verification.acceptedCount !== verification.requiredCount
    || verification.summary !== decision.title
    || verification.surface !== "/budget"
    || journey.coupleId !== coupleId
    || journey.stateRevision !== currentJourneyRevision
    || journey.topicKey !== topicKey
    || !hasExactScheduleSnapshot(journey.topicSnapshot, patchedTopic)
  ) return [];

  const acceptedAts = readBudgetAcceptances(
    chosen.acceptances,
    memberIds,
    decidedMs,
  );
  if (
    !acceptedAts
    || !acceptedAts.has(new Date(confirmedMs).toISOString())
  ) return [];

  return [Object.freeze({
    id: decisionId,
    title: decision.title,
    confirmedAt: new Date(decidedMs).toISOString(),
    confirmationScope: chosen.requiredCount === 2 ? "couple" : "current_member",
    appliedRevision: chosen.appliedRevision,
    scope: "couple_shared",
  })];
}

function readStoredWonAmount(value, max = MAX_WON_AMOUNT) {
  const normalized = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+(?:\.0+)?$/u.test(value)
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(normalized) && normalized >= 0 && normalized <= max
    ? normalized
    : null;
}

function readSafeSnapshotText(value, maxLength, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || Array.from(value.trim()).length > maxLength
    || UNSAFE_DISPLAY_TEXT_RE.test(value)
  ) return undefined;
  return value;
}

function readFullHourTime(value) {
  if (typeof value !== "string") return null;
  const match = /^(?:[01]\d|2[0-3]):00(?::00(?:\.0{1,6})?)?$/u.exec(value);
  return match ? value.slice(0, 5) : null;
}

function readInstant(value, nowMs) {
  if (typeof value !== "string") return null;
  const instantMs = Date.parse(value);
  return Number.isFinite(instantMs) && instantMs <= nowMs
    ? Object.freeze({ instantMs, iso: new Date(instantMs).toISOString() })
    : null;
}

function readCurrentVendorBookingRecords(
  topicKey,
  expectedCoupleId,
  currentCoupleMemberIds,
  vendorBookings,
  vendorBookingDecisionReceipts,
  nowIso,
) {
  if (
    !UUID_RE.test(String(expectedCoupleId))
    || !Array.isArray(currentCoupleMemberIds)
    || !Array.isArray(vendorBookings)
    || !Array.isArray(vendorBookingDecisionReceipts)
    || typeof nowIso !== "string"
  ) return [];
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [];

  const expectedCouple = String(expectedCoupleId).toLowerCase();
  const currentMembers = new Set(currentCoupleMemberIds.flatMap((memberId) => {
    const normalized = typeof memberId === "string" ? memberId.toLowerCase() : "";
    return UUID_RE.test(normalized) ? [normalized] : [];
  }));
  if (currentMembers.size === 0) return [];

  const bookingsById = new Map();
  const ambiguousBookingIds = new Set();
  for (const booking of vendorBookings) {
    if (!isRecord(booking)) continue;
    const bookingId = typeof booking.id === "string" ? booking.id.toLowerCase() : "";
    const coupleId = typeof booking.couple_id === "string"
      ? booking.couple_id.toLowerCase()
      : "";
    const vendorId = typeof booking.vendor_id === "string"
      ? booking.vendor_id.toLowerCase()
      : "";
    const productId = booking.product_id === null
      ? null
      : typeof booking.product_id === "string"
        ? booking.product_id.toLowerCase()
        : "";
    const creatorId = typeof booking.intent_created_by_profile_id === "string"
      ? booking.intent_created_by_profile_id.toLowerCase()
      : "";
    const vendorName = readSafeSnapshotText(
      booking.intent_vendor_name_snapshot,
      300,
    );
    const vendorCategory = readSafeSnapshotText(
      booking.intent_vendor_category_snapshot,
      80,
    );
    const productName = readSafeSnapshotText(
      booking.intent_product_name_snapshot,
      300,
      { nullable: true },
    );
    const bookingTime = readFullHourTime(booking.booking_time);
    const bookingAtMs = bookingTime === null || !isValidScheduleDate(booking.booking_date)
      ? NaN
      : Date.parse(`${booking.booking_date}T${bookingTime}:00+09:00`);
    const quotedAmountWon = readStoredWonAmount(
      booking.amount,
      MAX_VENDOR_QUOTE_WON,
    );
    const created = readInstant(booking.created_at, nowMs);
    const updated = readInstant(booking.updated_at, nowMs);
    if (
      !UUID_RE.test(bookingId)
      || coupleId !== expectedCouple
      || !UUID_RE.test(vendorId)
      || (productId !== null && !UUID_RE.test(productId))
      || ((productId === null) !== (productName === null))
      || !currentMembers.has(creatorId)
      || booking.status !== "pending"
      || booking.vendor_delivery_status !== "not_sent"
      || booking.is_paid !== false
      || vendorName === undefined
      || vendorCategory === undefined
      || vendorCategory !== topicKey
      || productName === undefined
      || !isValidScheduleDate(booking.booking_date)
      || bookingTime === null
      || !Number.isFinite(bookingAtMs)
      || bookingAtMs <= nowMs
      || quotedAmountWon === null
      || booking.contracted_amount !== null
      || booking.actual_amount !== null
      || booking.cancelled_at !== null
      || booking.cancelled_by_profile_id !== null
      || booking.cancel_reason !== null
      || !created
      || !updated
      || updated.instantMs < created.instantMs
    ) continue;
    if (bookingsById.has(bookingId)) {
      bookingsById.delete(bookingId);
      ambiguousBookingIds.add(bookingId);
      continue;
    }
    if (ambiguousBookingIds.has(bookingId)) continue;
    bookingsById.set(bookingId, Object.freeze({
      bookingId,
      coupleId,
      vendorId,
      productId,
      creatorId,
      vendorName,
      vendorCategory,
      productName,
      bookingDate: booking.booking_date,
      bookingTime,
      quotedAmountWon,
      created,
    }));
  }

  const decisionsByBookingId = new Map();
  const ambiguousDecisionBookingIds = new Set();
  for (const decision of vendorBookingDecisionReceipts) {
    if (!isRecord(decision) || !isRecord(decision.chosen_value) || !isRecord(decision.metadata)) {
      continue;
    }
    const decisionId = typeof decision.id === "string" ? decision.id.toLowerCase() : "";
    const coupleId = typeof decision.couple_id === "string"
      ? decision.couple_id.toLowerCase()
      : "";
    const sourceRefId = typeof decision.source_ref_id === "string"
      ? decision.source_ref_id.toLowerCase()
      : "";
    const booking = bookingsById.get(sourceRefId);
    if (!booking) continue;
    const chosen = decision.chosen_value;
    const metadata = decision.metadata;
    const chosenBookingId = typeof chosen.booking_id === "string"
      ? chosen.booking_id.toLowerCase()
      : "";
    const chosenVendorId = typeof chosen.vendor_id === "string"
      ? chosen.vendor_id.toLowerCase()
      : "";
    const chosenProductId = chosen.product_id === null
      ? null
      : typeof chosen.product_id === "string"
        ? chosen.product_id.toLowerCase()
        : "";
    const actorId = typeof metadata.actor_profile_id === "string"
      ? metadata.actor_profile_id.toLowerCase()
      : "";
    const quotedAmountWon = readStoredWonAmount(
      chosen.quoted_amount,
      MAX_VENDOR_QUOTE_WON,
    );
    const confidence = typeof decision.confidence === "string"
      ? Number(decision.confidence)
      : decision.confidence;
    const created = readInstant(decision.created_at, nowMs);
    const updated = readInstant(decision.updated_at, nowMs);
    if (
      !UUID_RE.test(decisionId)
      || coupleId !== expectedCouple
      || decision.category !== topicKey
      || decision.decision_type !== "considering"
      || decision.source !== "vendor_booking"
      || decision.visibility !== "shared"
      || decision.memory_key !== null
      || decision.source_message_id !== null
      || decision.source_actor_role !== null
      || decision.user_confirmed_at !== null
      || decision.decided_at !== null
      || decision.superseded_at !== null
      || decision.superseded_by !== null
      || confidence !== 0.5
      || decision.title !== `아모라 방문·상담 후보 기록: ${booking.vendorName.trim()}`
      || metadata.hook !== "booking_intent"
      || metadata.execution_scope !== "amora_internal_record"
      || actorId !== booking.creatorId
      || !currentMembers.has(actorId)
      || metadata.vendor_delivery_status !== "not_sent"
      || metadata.vendor_confirmation_status !== "unconfirmed"
      || chosenBookingId !== booking.bookingId
      || chosenVendorId !== booking.vendorId
      || chosenProductId !== booking.productId
      || chosen.vendor_name !== booking.vendorName
      || chosen.product_name !== booking.productName
      || chosen.booking_date !== booking.bookingDate
      || readFullHourTime(chosen.booking_time) !== booking.bookingTime
      || quotedAmountWon !== booking.quotedAmountWon
      || chosen.amount_basis !== "quote"
      || chosen.internal_request_status !== "recorded"
      || chosen.vendor_delivery_status !== "not_sent"
      || chosen.vendor_confirmation_status !== "unconfirmed"
      || !created
      || !updated
      || created.instantMs < booking.created.instantMs
      || updated.instantMs < created.instantMs
    ) continue;
    if (decisionsByBookingId.has(sourceRefId)) {
      decisionsByBookingId.delete(sourceRefId);
      ambiguousDecisionBookingIds.add(sourceRefId);
      continue;
    }
    if (ambiguousDecisionBookingIds.has(sourceRefId)) continue;
    decisionsByBookingId.set(sourceRefId, Object.freeze({
      decisionId,
      initiatedAt: created.iso,
    }));
  }

  return [...bookingsById.values()].flatMap((booking) => {
    const decision = decisionsByBookingId.get(booking.bookingId);
    if (!decision || ambiguousDecisionBookingIds.has(booking.bookingId)) return [];
    return [Object.freeze({
      bookingId: booking.bookingId,
      decisionId: decision.decisionId,
      vendorId: booking.vendorId,
      productId: booking.productId,
      vendorName: booking.vendorName.trim(),
      productName: booking.productName === null ? null : booking.productName.trim(),
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      quotedAmountWon: booking.quotedAmountWon,
      initiatedByProfileId: booking.creatorId,
      initiatedAt: decision.initiatedAt,
      recordScope: "amora_internal_request",
      evidence: "actor_bound_atomic_intent",
      vendorDeliveryStatus: "not_sent",
      vendorConfirmationStatus: "unconfirmed",
    })];
  }).sort((left, right) => (
    left.bookingDate.localeCompare(right.bookingDate)
    || left.bookingTime.localeCompare(right.bookingTime)
    || left.bookingId.localeCompare(right.bookingId)
  ));
}

const COMPLETED_BOOKING_CHOSEN_KEYS = Object.freeze([
  "actual_amount",
  "booking_id",
  "completion_evidence",
  "contracted_amount",
  "extra_amount",
  "product_id",
  "product_name",
  "public_review",
  "quoted_amount",
  "rating",
  "vendor_confirmation_status",
  "vendor_delivery_status",
  "vendor_id",
  "vendor_name",
]);
const COMPLETED_BOOKING_METADATA_KEYS = Object.freeze([
  "actor_profile_id",
  "completion_evidence",
  "extra_amount",
  "hook",
  "outcome_payload_digest",
  "outcome_provenance_version",
  "review_id",
  "vendor_confirmation_status",
  "vendor_delivery_status",
]);

function readCurrentCompletedVendorBookingRecords(
  topicKey,
  expectedCoupleId,
  currentCoupleMemberIds,
  completedVendorBookings,
  completedVendorBookingDecisionReceipts,
  nowIso,
) {
  const expectedCouple = typeof expectedCoupleId === "string"
    ? expectedCoupleId.toLowerCase()
    : "";
  const nowMs = Date.parse(String(nowIso ?? ""));
  if (
    !UUID_RE.test(expectedCouple)
    || !Array.isArray(currentCoupleMemberIds)
    || !Array.isArray(completedVendorBookings)
    || !Array.isArray(completedVendorBookingDecisionReceipts)
    || !Number.isFinite(nowMs)
  ) return [];

  const memberIds = currentCoupleMemberIds.map((memberId) => (
    typeof memberId === "string" ? memberId.toLowerCase() : ""
  ));
  if (
    memberIds.length < 1
    || memberIds.length > 2
    || new Set(memberIds).size !== memberIds.length
    || memberIds.some((memberId) => !UUID_RE.test(memberId))
  ) return [];
  const currentMembers = new Set(memberIds);

  const bookingIdCounts = new Map();
  for (const booking of completedVendorBookings) {
    const bookingId = isRecord(booking) && typeof booking.id === "string"
      ? booking.id.toLowerCase()
      : "";
    if (UUID_RE.test(bookingId)) {
      bookingIdCounts.set(bookingId, (bookingIdCounts.get(bookingId) ?? 0) + 1);
    }
  }

  const bookingsById = new Map();
  for (const booking of completedVendorBookings) {
    if (!isRecord(booking)) continue;
    const bookingId = typeof booking.id === "string" ? booking.id.toLowerCase() : "";
    const coupleId = typeof booking.couple_id === "string"
      ? booking.couple_id.toLowerCase()
      : "";
    const vendorId = typeof booking.vendor_id === "string"
      ? booking.vendor_id.toLowerCase()
      : "";
    const productId = booking.product_id === null
      ? null
      : typeof booking.product_id === "string"
        ? booking.product_id.toLowerCase()
        : "";
    const creatorId = typeof booking.intent_created_by_profile_id === "string"
      ? booking.intent_created_by_profile_id.toLowerCase()
      : "";
    const vendorName = readSafeSnapshotText(booking.intent_vendor_name_snapshot, 300);
    const vendorCategory = readSafeSnapshotText(
      booking.intent_vendor_category_snapshot,
      80,
    );
    const productName = readSafeSnapshotText(
      booking.intent_product_name_snapshot,
      300,
      { nullable: true },
    );
    const bookingTime = readFullHourTime(booking.booking_time);
    const quotedAmountWon = readStoredWonAmount(booking.amount, MAX_VENDOR_QUOTE_WON);
    const contractedAmountWon = booking.contracted_amount === null
      ? null
      : readStoredWonAmount(booking.contracted_amount);
    const actualAmountWon = readStoredWonAmount(booking.actual_amount);
    const created = readInstant(booking.created_at, nowMs);
    const updated = readInstant(booking.updated_at, nowMs);
    if (
      !UUID_RE.test(bookingId)
      || bookingIdCounts.get(bookingId) !== 1
      || coupleId !== expectedCouple
      || !UUID_RE.test(vendorId)
      || (productId !== null && !UUID_RE.test(productId))
      || !UUID_RE.test(creatorId)
      || vendorName === undefined
      || vendorName.trim() !== vendorName
      || vendorCategory === undefined
      || vendorCategory !== topicKey
      || productName === undefined
      || (productName !== null && productName.trim() !== productName)
      || ((productId === null) !== (productName === null))
      || booking.status !== "completed"
      || booking.vendor_delivery_status !== "not_sent"
      || booking.is_paid !== false
      || !isValidScheduleDate(booking.booking_date)
      || bookingTime === null
      || quotedAmountWon === null
      || (booking.contracted_amount !== null && contractedAmountWon === null)
      || actualAmountWon === null
      || booking.cancelled_at !== null
      || booking.cancelled_by_profile_id !== null
      || booking.cancel_reason !== null
      || !created
      || !updated
      || updated.instantMs < created.instantMs
    ) continue;
    bookingsById.set(bookingId, Object.freeze({
      bookingId,
      vendorId,
      productId,
      vendorName,
      productName,
      bookingDate: booking.booking_date,
      bookingTime,
      quotedAmountWon,
      contractedAmountWon,
      actualAmountWon,
      created,
    }));
  }

  const structuralDecisionCounts = new Map();
  for (const decision of completedVendorBookingDecisionReceipts) {
    const sourceRefId = isRecord(decision) && typeof decision.source_ref_id === "string"
      ? decision.source_ref_id.toLowerCase()
      : "";
    if (
      UUID_RE.test(sourceRefId)
      && isRecord(decision)
      && decision.source === "vendor_booking"
      && decision.decision_type === "completed"
    ) {
      structuralDecisionCounts.set(
        sourceRefId,
        (structuralDecisionCounts.get(sourceRefId) ?? 0) + 1,
      );
    }
  }

  const records = [];
  for (const decision of completedVendorBookingDecisionReceipts) {
    if (!isRecord(decision) || !isRecord(decision.chosen_value) || !isRecord(decision.metadata)) {
      continue;
    }
    const sourceRefId = typeof decision.source_ref_id === "string"
      ? decision.source_ref_id.toLowerCase()
      : "";
    const booking = bookingsById.get(sourceRefId);
    if (!booking || structuralDecisionCounts.get(sourceRefId) !== 1) continue;
    const chosen = decision.chosen_value;
    const metadata = decision.metadata;
    const decisionId = typeof decision.id === "string" ? decision.id.toLowerCase() : "";
    const coupleId = typeof decision.couple_id === "string"
      ? decision.couple_id.toLowerCase()
      : "";
    const chosenBookingId = typeof chosen.booking_id === "string"
      ? chosen.booking_id.toLowerCase()
      : "";
    const chosenVendorId = typeof chosen.vendor_id === "string"
      ? chosen.vendor_id.toLowerCase()
      : "";
    const chosenProductId = chosen.product_id === null
      ? null
      : typeof chosen.product_id === "string"
        ? chosen.product_id.toLowerCase()
        : "";
    const reviewId = typeof metadata.review_id === "string"
      ? metadata.review_id.toLowerCase()
      : "";
    const actorId = typeof metadata.actor_profile_id === "string"
      ? metadata.actor_profile_id.toLowerCase()
      : "";
    const reviewText = decision.reasoning === null
      ? null
      : readSafeSnapshotText(decision.reasoning, 1_000, { nullable: true });
    const quotedAmountWon = readStoredWonAmount(chosen.quoted_amount, MAX_VENDOR_QUOTE_WON);
    const contractedAmountWon = chosen.contracted_amount === null
      ? null
      : readStoredWonAmount(chosen.contracted_amount);
    const actualAmountWon = readStoredWonAmount(chosen.actual_amount);
    const extraAmountWon = readStoredWonAmount(chosen.extra_amount);
    const expectedExtraAmountWon = Math.max(
      booking.actualAmountWon
        - (booking.contractedAmountWon ?? booking.quotedAmountWon),
      0,
    );
    const confidence = typeof decision.confidence === "string"
      ? Number(decision.confidence)
      : decision.confidence;
    const userConfirmed = readInstant(decision.user_confirmed_at, nowMs);
    const decided = readInstant(decision.decided_at, nowMs);
    const created = readInstant(decision.created_at, nowMs);
    const updated = readInstant(decision.updated_at, nowMs);
    if (
      !hasExactKeys(chosen, COMPLETED_BOOKING_CHOSEN_KEYS)
      || !hasExactKeys(metadata, COMPLETED_BOOKING_METADATA_KEYS)
      || !UUID_RE.test(decisionId)
      || coupleId !== expectedCouple
      || decision.category !== topicKey
      || decision.decision_type !== "completed"
      || decision.title !== `사용자가 완료로 기록: ${booking.vendorName}`
      || reviewText === undefined
      || (reviewText !== null && reviewText.trim() !== reviewText)
      || confidence !== 0.9
      || decision.source !== "vendor_booking"
      || sourceRefId !== booking.bookingId
      || decision.source_message_id !== null
      || decision.source_actor_role !== "bride" && decision.source_actor_role !== "groom"
      || decision.memory_key !== null
      || decision.visibility !== "shared"
      || decision.superseded_at !== null
      || decision.superseded_by !== null
      || !userConfirmed
      || !decided
      || userConfirmed.instantMs > decided.instantMs
      || userConfirmed.instantMs < booking.created.instantMs
      || !created
      || !updated
      || created.instantMs > decided.instantMs
      || updated.instantMs < created.instantMs
      || updated.instantMs < decided.instantMs
      || chosenBookingId !== booking.bookingId
      || chosenVendorId !== booking.vendorId
      || chosen.vendor_name !== booking.vendorName
      || chosenProductId !== booking.productId
      || chosen.product_name !== booking.productName
      || typeof chosen.quoted_amount !== "number"
      || chosen.contracted_amount !== null
        && typeof chosen.contracted_amount !== "number"
      || typeof chosen.actual_amount !== "number"
      || typeof chosen.extra_amount !== "number"
      || typeof metadata.extra_amount !== "number"
      || quotedAmountWon !== booking.quotedAmountWon
      || contractedAmountWon !== booking.contractedAmountWon
      || actualAmountWon !== booking.actualAmountWon
      || extraAmountWon !== expectedExtraAmountWon
      || !Number.isSafeInteger(chosen.rating)
      || chosen.rating < 1
      || chosen.rating > 5
      || typeof chosen.public_review !== "boolean"
      || chosen.completion_evidence !== "user_reported"
      || chosen.vendor_delivery_status !== "not_sent"
      || chosen.vendor_confirmation_status !== "unconfirmed"
      || metadata.hook !== "booking_outcome"
      || !UUID_RE.test(reviewId)
      || metadata.extra_amount !== chosen.extra_amount
      || metadata.completion_evidence !== "user_reported"
      || metadata.vendor_delivery_status !== "not_sent"
      || metadata.vendor_confirmation_status !== "unconfirmed"
      || !currentMembers.has(actorId)
      || metadata.outcome_provenance_version !== 1
      || !/^[a-f0-9]{64}$/u.test(String(metadata.outcome_payload_digest ?? ""))
    ) continue;
    records.push(Object.freeze({
      bookingId: booking.bookingId,
      decisionId,
      vendorId: booking.vendorId,
      productId: booking.productId,
      vendorName: booking.vendorName,
      productName: booking.productName,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      quotedAmountWon: booking.quotedAmountWon,
      contractedAmountWon: booking.contractedAmountWon,
      actualAmountWon: booking.actualAmountWon,
      userConfirmedAt: userConfirmed.iso,
      decidedAt: decided.iso,
      recordScope: "amora_internal_completed_outcome",
      evidence: "actor_bound_atomic_user_report",
      completionEvidence: "user_reported",
      vendorDeliveryStatus: "not_sent",
      vendorConfirmationStatus: "unconfirmed",
      isPaid: false,
    }));
  }

  return records.sort((left, right) => (
    right.decidedAt.localeCompare(left.decidedAt)
    || left.bookingId.localeCompare(right.bookingId)
  ));
}

function buildLinkedActionFact(action) {
  return Object.freeze({
    key: `action:${action.id}`,
    label: action.dueDate
      ? `${action.dueDate}까지 · ${action.title}`
      : `진행 중 행동 · ${action.title}`,
    source: "linked_action",
  });
}

function buildLinkedActionNextAction(action) {
  return Object.freeze({
    title: action.title,
    reason: action.dueDate
      ? `마감일을 ${action.dueDate}로 저장한 공동 행동이에요.`
      : action.priority === "high"
        ? "중요도를 ‘높음’으로 저장한 공동 행동이에요."
        : "공동 준비 기록에 저장한 열린 행동이에요.",
    completionCriterion: "이 행동을 실제로 마친 뒤 완료로 기록하면 끝나요.",
    source: "linked_action",
    sourceRef: Object.freeze({
      kind: "amora_action",
      id: action.id,
      revision: action.sourceRevision,
    }),
  });
}

function describeTopicConflict(progress, topicKey) {
  const saved = isRecord(progress) ? progress[topicKey] : null;
  if (!isRecord(saved)) {
    return Object.freeze({
      key: "invalid_saved_record",
      label: "저장된 준비 기록 형식을 확인할 수 없어요.",
      reason: "저장된 준비 기록 형식을 확인할 수 없어요.",
    });
  }

  return Object.freeze({
    key: "saved_state_mismatch",
    label: "저장된 완료 상태와 체크 항목이 서로 맞지 않아요.",
    reason: "완료 상태와 체크 항목이 서로 맞지 않아요.",
  });
}

function topicSubject(label) {
  const lastCharacter = Array.from(label).at(-1);
  if (!lastCharacter) return label;

  const codePoint = lastCharacter.codePointAt(0);
  const hasFinalConsonant = codePoint >= 0xac00
    && codePoint <= 0xd7a3
    && (codePoint - 0xac00) % 28 !== 0;

  return `${label}${hasFinalConsonant ? "이" : "가"}`;
}

function readSeoulCalendarDate(nowIso) {
  if (typeof nowIso !== "string") return null;
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return null;
  const seoulDate = new Date(nowMs + (9 * 60 * 60 * 1000));
  return Number.isFinite(seoulDate.getTime())
    ? seoulDate.toISOString().slice(0, 10)
    : null;
}

export function buildAmoraPreparationTopicView({
  topicKey,
  topics,
  progress,
  scheduleEvents,
  budgetCategoryKeys,
  openActions,
  actionReadState = "loaded",
  expectedCoupleId,
  currentJourneyRevision,
  scheduleDecisionReceipts,
  decisionReadState = "loaded",
  budgetDecisionReceipts,
  budgetDecisionVerifications,
  budgetDecisionReadState = "loaded",
  currentCoupleMemberIds,
  vendorBookings,
  vendorBookingDecisionReceipts,
  vendorBookingReadState = "loaded",
  completedVendorBookings,
  completedVendorBookingDecisionReceipts,
  completedVendorBookingReadState = "loaded",
  nowIso,
}) {
  if (typeof topicKey !== "string" || topicKey.length === 0) return null;

  const overview = buildAmoraPreparationOverview({ topics, progress });
  const topic = overview.topics.find((candidate) => candidate.topicKey === topicKey);
  if (!topic) return null;
  const guideAsOfDate = readSeoulCalendarDate(nowIso);
  const linkedSchedules = readLinkedSchedules(topicKey, scheduleEvents);
  const normalizedActionReadState = actionReadState === "loaded"
    ? "loaded"
    : "unavailable";
  const linkedActions = normalizedActionReadState === "loaded"
    ? readLinkedActions(topicKey, openActions)
    : [];
  const normalizedDecisionReadState = decisionReadState === "loaded"
    || decisionReadState === "partial"
    ? decisionReadState
    : "unavailable";
  const linkedDecisions = normalizedDecisionReadState !== "unavailable"
    ? readConfirmedScheduleDecisions(
        topicKey,
        expectedCoupleId,
        currentJourneyRevision,
        scheduleEvents,
        scheduleDecisionReceipts,
        nowIso,
      )
    : [];
  const normalizedBudgetDecisionReadState = budgetDecisionReadState === "loaded"
    || budgetDecisionReadState === "partial"
    ? budgetDecisionReadState
    : "unavailable";
  const confirmedBudgetDecisions = normalizedBudgetDecisionReadState !== "unavailable"
    ? readConfirmedBudgetDecision(
        topicKey,
        expectedCoupleId,
        currentCoupleMemberIds,
        currentJourneyRevision,
        progress,
        budgetDecisionReceipts,
        budgetDecisionVerifications,
        nowIso,
      )
    : [];
  const hasUnresolvedBudgetDecisionCandidate = Array.isArray(budgetDecisionReceipts)
    && budgetDecisionReceipts.some((decision) => (
      isRecord(decision)
      && isRecord(decision.chosen_value)
      && isRecord(decision.chosen_value.changes)
      && isRecord(decision.chosen_value.changes.progress_patch)
      && Object.hasOwn(decision.chosen_value.changes.progress_patch, topicKey)
    ));
  const effectiveBudgetDecisionReadState = normalizedBudgetDecisionReadState === "loaded"
    && confirmedBudgetDecisions.length === 0
    && hasUnresolvedBudgetDecisionCandidate
    ? "partial"
    : normalizedBudgetDecisionReadState;
  const decisionFields = Object.freeze({
    confirmedScheduleDecisions: Object.freeze(linkedDecisions),
    confirmedBudgetDecisions: Object.freeze(confirmedBudgetDecisions),
    linkedDecisionIds: Object.freeze([
      ...linkedDecisions.map((decision) => decision.id),
      ...confirmedBudgetDecisions.map((decision) => decision.id),
    ]),
    decisionReadState: normalizedDecisionReadState,
    budgetDecisionReadState: effectiveBudgetDecisionReadState,
  });
  const normalizedVendorBookingReadState = vendorBookingReadState === "loaded"
    || vendorBookingReadState === "partial"
    ? vendorBookingReadState
    : "unavailable";
  const currentVendorBookingRecords = normalizedVendorBookingReadState !== "unavailable"
    ? readCurrentVendorBookingRecords(
        topicKey,
        expectedCoupleId,
        currentCoupleMemberIds,
        vendorBookings,
        vendorBookingDecisionReceipts,
        nowIso,
      )
    : [];
  const vendorBookingFields = Object.freeze({
    currentVendorBookingRecords: Object.freeze(currentVendorBookingRecords),
    linkedVendorBookingIds: Object.freeze(
      currentVendorBookingRecords.map((record) => record.bookingId),
    ),
    vendorBookingReadState: normalizedVendorBookingReadState,
  });
  const normalizedCompletedVendorBookingReadState =
    completedVendorBookingReadState === "loaded"
      || completedVendorBookingReadState === "partial"
      ? completedVendorBookingReadState
      : "unavailable";
  const currentCompletedVendorBookingRecords =
    normalizedCompletedVendorBookingReadState !== "unavailable"
      ? readCurrentCompletedVendorBookingRecords(
          topicKey,
          expectedCoupleId,
          currentCoupleMemberIds,
          completedVendorBookings,
          completedVendorBookingDecisionReceipts,
          nowIso,
        )
      : [];
  const completedVendorBookingFields = Object.freeze({
    currentCompletedVendorBookingRecords: Object.freeze(
      currentCompletedVendorBookingRecords,
    ),
    linkedCompletedVendorBookingIds: Object.freeze(
      currentCompletedVendorBookingRecords.map((record) => record.bookingId),
    ),
    completedVendorBookingReadState: normalizedCompletedVendorBookingReadState,
  });
  const budgetSummary = Array.isArray(budgetCategoryKeys)
    && budgetCategoryKeys.some((key) => key === topicKey)
    ? readBudgetSummary(topic.state, progress, topicKey)
    : null;

  if (topic.state === "not_applicable") {
    if (linkedSchedules.length > 0 || linkedActions.length > 0) {
      const hasSchedule = linkedSchedules.length > 0;
      const hasAction = linkedActions.length > 0;
      const conflict = hasSchedule && hasAction
        ? Object.freeze({
            key: "excluded_with_active_plan",
            label: "제외한 준비에 일정과 열린 공동 행동이 남아 있어요.",
          })
        : hasSchedule
          ? Object.freeze({
              key: "excluded_with_active_schedule",
              label: "제외한 준비에 연결된 일정이 남아 있어요.",
            })
          : Object.freeze({
              key: "excluded_with_open_action",
              label: "제외한 준비에 열린 공동 행동이 남아 있어요.",
            });
      return Object.freeze({
        version: AMORA_PREPARATION_TOPIC_CONTRACT_VERSION,
        topicKey: topic.topicKey,
        label: topic.label,
        applicability: "not_applicable",
        status: "decision_needed",
        progress: Object.freeze({ completed: 0, total: 0, percent: 0 }),
        facts: Object.freeze([
          Object.freeze({
            key: "applicability",
            label: "우리에게는 하지 않기로 정했어요.",
            source: "saved_checklist",
          }),
          ...linkedSchedules.map((event) => Object.freeze({
            key: `schedule:${event.id}`,
            label: `${event.date} · ${event.title.trim()}`,
            source: "linked_schedule",
          })),
          ...linkedActions.map(buildLinkedActionFact),
        ]),
        unknowns: EMPTY_LIST,
        nextAction: Object.freeze({
          title: `${topic.label} 기록 확인하기`,
          reason: hasSchedule && hasAction
            ? "준비 목록에서는 제외했지만 일정과 열린 공동 행동이 있어요."
            : hasSchedule
              ? "준비 목록에서는 제외했지만 연결된 일정이 있어요."
              : "준비 목록에서는 제외했지만 열린 공동 행동이 있어요.",
          completionCriterion: hasSchedule && hasAction
            ? "일정과 열린 행동을 유지할지, 준비에서 제외할지 다시 정하면 끝나요."
            : hasSchedule
              ? "일정을 유지할지, 준비에서 제외할지 다시 정하면 끝나요."
              : "열린 행동을 유지할지, 준비에서 제외할지 다시 정하면 끝나요.",
          source: "conflict",
        }),
        guideModules: EMPTY_LIST,
        relatedMessageRefs: EMPTY_LIST,
        linkedScheduleIds: Object.freeze(linkedSchedules.map((event) => event.id)),
        linkedBudgetCategoryKeys: budgetSummary?.state === "ready"
          ? Object.freeze([topicKey])
          : EMPTY_LIST,
        linkedActionIds: Object.freeze(linkedActions.map((action) => action.id)),
        budgetSummary,
        actionReadState: normalizedActionReadState,
        ...decisionFields,
        ...vendorBookingFields,
        ...completedVendorBookingFields,
        conflicts: Object.freeze([conflict]),
      });
    }

    return Object.freeze({
      version: AMORA_PREPARATION_TOPIC_CONTRACT_VERSION,
      topicKey: topic.topicKey,
      label: topic.label,
      applicability: "not_applicable",
      status: "not_started",
      progress: Object.freeze({ completed: 0, total: 0, percent: 0 }),
      facts: Object.freeze([Object.freeze({
        key: "applicability",
        label: "우리에게는 하지 않기로 정했어요.",
        source: "saved_checklist",
      })]),
      unknowns: EMPTY_LIST,
      nextAction: null,
      guideModules: EMPTY_LIST,
      relatedMessageRefs: EMPTY_LIST,
      linkedScheduleIds: EMPTY_LIST,
      linkedBudgetCategoryKeys: budgetSummary?.state === "ready"
        ? Object.freeze([topicKey])
        : EMPTY_LIST,
      linkedActionIds: EMPTY_LIST,
      budgetSummary,
      actionReadState: normalizedActionReadState,
      ...decisionFields,
      ...vendorBookingFields,
      ...completedVendorBookingFields,
      conflicts: EMPTY_LIST,
    });
  }

  if (
    topic.state === "unknown"
    && (linkedSchedules.length > 0 || linkedActions.length > 0)
  ) {
    const template = Array.isArray(topics)
      ? topics.find((candidate) => candidate?.key === topicKey)
      : null;
    const checklistItems = readChecklistItems(template, progress);
    const nextItem = checklistItems[0] ?? null;
    const guideModules = buildAmoraPreparationGuideModules({
      topicKey,
      applicability: "applicable",
      status: "exploring",
      asOfDate: guideAsOfDate,
      checklistItems,
    });

    return Object.freeze({
      version: AMORA_PREPARATION_TOPIC_CONTRACT_VERSION,
      topicKey: topic.topicKey,
      label: topic.label,
      applicability: "applicable",
      status: "exploring",
      progress: Object.freeze({
        completed: 0,
        total: topic.totalItems,
        percent: 0,
      }),
      facts: Object.freeze([
        ...linkedSchedules.map((event) => Object.freeze({
          key: `schedule:${event.id}`,
          label: `${event.date} · ${event.title.trim()}`,
          source: "linked_schedule",
        })),
        ...linkedActions.map(buildLinkedActionFact),
      ]),
      unknowns: Object.freeze(checklistItems.map((item) => Object.freeze({
        key: `checklist:${item.id}`,
        label: item.label,
        source: "unfinished_checklist",
      }))),
      nextAction: linkedActions[0]
        ? buildLinkedActionNextAction(linkedActions[0])
        : nextItem === null
        ? null
        : Object.freeze({
            title: nextItem.label,
            reason: "연결된 일정은 있지만 준비 항목은 아직 확인하지 않았어요.",
            completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
            source: "linked_schedule",
          }),
      guideModules,
      relatedMessageRefs: EMPTY_LIST,
      linkedScheduleIds: Object.freeze(linkedSchedules.map((event) => event.id)),
      linkedBudgetCategoryKeys: budgetSummary?.state === "ready"
        ? Object.freeze([topicKey])
        : EMPTY_LIST,
      linkedActionIds: Object.freeze(linkedActions.map((action) => action.id)),
      budgetSummary,
      actionReadState: normalizedActionReadState,
      ...decisionFields,
      ...vendorBookingFields,
      ...completedVendorBookingFields,
      conflicts: EMPTY_LIST,
    });
  }

  if (topic.state !== "unknown") {
    const template = Array.isArray(topics)
      ? topics.find((candidate) => candidate?.key === topicKey)
      : null;
    const checklistItems = readChecklistItems(template, progress);
    const completedItems = checklistItems.filter((item) => item.done);
    const unfinishedItems = checklistItems.filter((item) => !item.done);
    const nextItem = unfinishedItems[0] ?? null;
    const needsReview = topic.state === "needs_review";
    const conflict = needsReview ? describeTopicConflict(progress, topicKey) : null;
    const resolvedStatus = needsReview
      ? "decision_needed"
      : topic.state === "completed" && linkedActions.length > 0
        ? "in_progress"
        : topic.state;
    const guideModules = buildAmoraPreparationGuideModules({
      topicKey,
      applicability: "applicable",
      status: resolvedStatus,
      asOfDate: guideAsOfDate,
      checklistItems,
    });

    return Object.freeze({
      version: AMORA_PREPARATION_TOPIC_CONTRACT_VERSION,
      topicKey: topic.topicKey,
      label: topic.label,
      applicability: "applicable",
      status: resolvedStatus,
      progress: Object.freeze({
        completed: topic.completedItems,
        total: topic.totalItems,
        percent: topic.percent,
      }),
      facts: Object.freeze([
        ...completedItems.map((item) => Object.freeze({
          key: `checklist:${item.id}`,
          label: `${item.label} 완료`,
          source: "saved_checklist",
        })),
        ...linkedSchedules.map((event) => Object.freeze({
          key: `schedule:${event.id}`,
          label: `${event.date} · ${event.title.trim()}`,
          source: "linked_schedule",
        })),
        ...linkedActions.map(buildLinkedActionFact),
      ]),
      unknowns: Object.freeze(unfinishedItems.map((item) => Object.freeze({
        key: `checklist:${item.id}`,
        label: item.label,
        source: "unfinished_checklist",
      }))),
      nextAction: needsReview
        ? Object.freeze({
            title: `${topic.label} 기록 확인하기`,
            reason: conflict.reason,
            completionCriterion: "현재 준비 상태를 다시 저장하면 끝나요.",
            source: "conflict",
          })
        : linkedActions[0]
        ? buildLinkedActionNextAction(linkedActions[0])
        : nextItem === null
        ? null
        : Object.freeze({
            title: nextItem.label,
            reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
            completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
            source: "saved_checklist",
          }),
      guideModules,
      relatedMessageRefs: EMPTY_LIST,
      linkedScheduleIds: Object.freeze(linkedSchedules.map((event) => event.id)),
      linkedBudgetCategoryKeys: budgetSummary?.state === "invalid"
        ? EMPTY_LIST
        : budgetSummary
          ? Object.freeze([topicKey])
          : EMPTY_LIST,
      linkedActionIds: Object.freeze(linkedActions.map((action) => action.id)),
      budgetSummary,
      actionReadState: normalizedActionReadState,
      ...decisionFields,
      ...vendorBookingFields,
      ...completedVendorBookingFields,
      conflicts: needsReview
        ? Object.freeze([Object.freeze({ key: conflict.key, label: conflict.label })])
        : EMPTY_LIST,
    });
  }

  return Object.freeze({
    version: AMORA_PREPARATION_TOPIC_CONTRACT_VERSION,
    topicKey: topic.topicKey,
    label: topic.label,
    applicability: "unknown",
    status: "not_started",
    progress: Object.freeze({
      completed: topic.completedItems,
      total: topic.totalItems,
      percent: topic.percent,
    }),
    facts: EMPTY_LIST,
    unknowns: Object.freeze([Object.freeze({
      key: "applicability",
      label: "우리에게 필요한 준비인지 아직 확인하지 않았어요.",
      source: "no_saved_record",
    })]),
    nextAction: Object.freeze({
      title: `${topicSubject(topic.label)} 우리에게 필요한지 확인하기`,
      reason: "아직 확인한 준비 기록이 없어요.",
      completionCriterion: "준비할지 하지 않을지 직접 정하면 끝나요.",
      source: "applicability",
    }),
    guideModules: EMPTY_LIST,
    relatedMessageRefs: EMPTY_LIST,
    linkedScheduleIds: EMPTY_LIST,
    linkedBudgetCategoryKeys: EMPTY_LIST,
    linkedActionIds: EMPTY_LIST,
    budgetSummary,
    actionReadState: normalizedActionReadState,
    ...decisionFields,
    ...vendorBookingFields,
    ...completedVendorBookingFields,
    conflicts: EMPTY_LIST,
  });
}
