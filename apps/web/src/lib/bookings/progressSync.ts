import type { SupabaseClient } from "@supabase/supabase-js";
import { formatWon } from "@/lib/formatWon";
import type {
  ScheduleEvent,
  ScheduleEventCancellation,
} from "@/types/database.types";
import {
  cancelEvent,
  getEvents,
  getScheduleEventStatus,
  inspectScheduleEvents,
  isScheduleEventCancellation,
} from "@/utils/scheduleEvents";
import { isRecord } from "@/utils/requestValidation";

export interface BookingProgressBooking {
  id: string;
  date: string;
  time: string;
  amount: number;
  actualAmount?: number | null;
}

export interface BookingProgressVendor {
  id: string;
  name: string;
  category: string | null;
}

export interface BookingOutcomeProgressBooking {
  id: string;
  amount: number | null;
  previousActualAmount: number | null;
  actualAmount: number;
}

export interface BookingCancelledProgressBooking {
  id: string;
  amount: number | null;
  actualAmount: number | null;
  cancellation: ScheduleEventCancellation;
}

export interface BookingProgressBuildInput {
  progress: Record<string, unknown>;
  booking: BookingProgressBooking;
  vendor: BookingProgressVendor;
  productName?: string | null;
  staffName?: string | null;
}

export interface BookingProgressSyncResult {
  patch: Record<string, unknown>;
  nextProgress: Record<string, unknown>;
  scheduleAdded: boolean;
  scheduleUpdated: boolean;
  terminalSchedulePreserved: boolean;
  needsReview: boolean;
  reviewReason: string | null;
  budgetUpdated: boolean;
  budgetDelta?: number;
  budgetExceededBy: number;
  categoryBudgetLimit: number;
  categoryLabel: string | null;
  syncedEvent: ScheduleEvent;
  syncedCategoryKey: string | null;
  syncedNewSpent: number | null;
}

export interface BookingProgressPersistenceResult
  extends Omit<BookingProgressSyncResult, "patch"> {
  persisted: boolean;
  projectionDisposition?: BookingProjectionDisposition;
  error?: string;
}

export interface BookingOutcomeProgressSyncResult {
  patch: Record<string, unknown>;
  nextProgress: Record<string, unknown>;
  budgetUpdated: boolean;
  budgetDelta: number;
  previousContribution: number;
  nextContribution: number;
  budgetExceededBy: number;
  categoryBudgetLimit: number;
  categoryLabel: string | null;
  syncedCategoryKey: string | null;
  syncedNewSpent: number | null;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface BookingCancelProgressSyncResult {
  patch: Record<string, unknown>;
  nextProgress: Record<string, unknown>;
  scheduleRemoved: boolean;
  budgetReverted: boolean;
  scheduleCancelled: boolean;
  completedSchedulePreserved: boolean;
  terminalSchedulePreserved: boolean;
  needsReview: boolean;
  reviewReason: string | null;
  recordedSpendPreserved: boolean;
  quoteContributionCorrected: boolean;
  quoteCorrectionAmount: number;
  revertedAmount: number;
  categoryBudgetLimit: number;
  categoryLabel: string | null;
  syncedEventIdRemoved: string | null;
  syncedEventId: string | null;
  syncedCategoryKey: string | null;
  syncedNewSpent: number | null;
}

export interface BookingCancelProgressPersistenceResult
  extends Omit<BookingCancelProgressSyncResult, "patch"> {
  persisted: boolean;
  projectionDisposition?: BookingProjectionDisposition;
  error?: string;
}

export type BookingProjectionDisposition =
  | "completed"
  | "superseded"
  | "stale_claim"
  | "not_found";

export interface BookingProjectionClaimContext {
  generation: number;
  claimToken: string;
}

interface ProductRow {
  name: string | null;
}

interface StaffRow {
  name: string | null;
  role: string | null;
}

interface AtomicBookingProjectionResult {
  accepted: true;
  status: "completed";
  progress: Record<string, unknown>;
  event: ScheduleEvent | null;
  scheduleAdded: boolean;
  scheduleUpdated: boolean;
  scheduleCancelled: boolean;
  completedSchedulePreserved: boolean;
  terminalSchedulePreserved: boolean;
  needsReview: boolean;
  reviewReason: string | null;
  recordedSpendPreserved: boolean;
  quoteContributionCorrected: boolean;
  quoteCorrectionAmount: number;
  /** @deprecated Booking schedule events are soft-cancelled, never removed. */
  scheduleRemoved: boolean;
  budgetUpdated: boolean;
  /** @deprecated Cancellation never implies a refund or spend reversal. */
  budgetReverted: boolean;
  budgetDelta: number;
  budgetExceededBy: number;
  categoryBudgetLimit: number;
  categoryKey: string | null;
  newSpent: number | null;
  revertedAmount: number;
  removedEventId: string | null;
}

interface RejectedBookingProjectionResult {
  accepted: false;
  status: string;
  reason: Exclude<BookingProjectionDisposition, "completed">;
}

type AtomicBookingProjectionResponse =
  | AtomicBookingProjectionResult
  | RejectedBookingProjectionResult;

interface BookingCostContribution {
  amount: number;
  categoryKey: string | null;
  basis: "none" | "actual" | "legacy_unknown";
  quotedAmount?: number;
}

const BOOKING_EVENT_PREFIX = "evt_booking_";
const BOOKING_SOURCE_PREFIX = "booking:";

function finiteAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function finiteUnknownAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  }
  return 0;
}

function finiteNonNegativeAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? Math.floor(amount) : null;
  }
  return null;
}

function finiteSignedAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function parseScheduleEvent(value: unknown): ScheduleEvent | null {
  const inspection = inspectScheduleEvents({ __events: [value] });
  return !inspection.malformedContainer
    && inspection.rejectedCount === 0
    && inspection.truncatedCount === 0
    && inspection.events.length === 1
    ? inspection.events[0]
    : null;
}

function parseAtomicBookingProjectionResult(
  value: unknown
): AtomicBookingProjectionResponse | null {
  if (!isRecord(value) || typeof value.accepted !== "boolean") return null;
  if (!value.accepted) {
    if (
      typeof value.status !== "string" ||
      (value.reason !== "superseded" &&
        value.reason !== "stale_claim" &&
        value.reason !== "not_found")
    ) {
      return null;
    }
    return {
      accepted: false,
      status: value.status,
      reason: value.reason,
    };
  }
  if (value.status !== "completed" || !isRecord(value.progress)) return null;
  const booleanKeys = [
    "scheduleAdded",
    "scheduleUpdated",
    "scheduleCancelled",
    "recordedSpendPreserved",
    "quoteContributionCorrected",
    "scheduleRemoved",
    "budgetUpdated",
    "budgetReverted",
  ] as const;
  if (booleanKeys.some((key) => typeof value[key] !== "boolean")) return null;
  if (
    value.completedSchedulePreserved !== undefined
    && typeof value.completedSchedulePreserved !== "boolean"
  ) {
    return null;
  }
  if (
    value.terminalSchedulePreserved !== undefined
    && typeof value.terminalSchedulePreserved !== "boolean"
  ) {
    return null;
  }
  if (value.needsReview !== undefined && typeof value.needsReview !== "boolean") {
    return null;
  }
  if (
    value.reviewReason !== undefined
    && value.reviewReason !== null
    && typeof value.reviewReason !== "string"
  ) {
    return null;
  }

  const budgetDelta = finiteSignedAmount(value.budgetDelta);
  const budgetExceededBy = finiteNonNegativeAmount(value.budgetExceededBy);
  const categoryBudgetLimit = finiteNonNegativeAmount(value.categoryBudgetLimit);
  const revertedAmount = finiteNonNegativeAmount(value.revertedAmount);
  const quoteCorrectionAmount = finiteNonNegativeAmount(value.quoteCorrectionAmount);
  const newSpent = value.newSpent === null
    ? null
    : finiteNonNegativeAmount(value.newSpent);
  if (
    budgetDelta === null ||
    budgetExceededBy === null ||
    categoryBudgetLimit === null ||
    revertedAmount === null ||
    quoteCorrectionAmount === null ||
    (value.newSpent !== null && newSpent === null) ||
    (value.categoryKey !== null && typeof value.categoryKey !== "string") ||
    (value.removedEventId !== null && typeof value.removedEventId !== "string")
  ) {
    return null;
  }
  if (
    value.scheduleRemoved
    || value.budgetReverted
    || revertedAmount !== 0
    || value.removedEventId !== null
    || (value.quoteContributionCorrected
      ? quoteCorrectionAmount <= 0
      : quoteCorrectionAmount !== 0)
    || (!value.budgetUpdated && budgetDelta !== 0)
  ) {
    return null;
  }

  const event = value.event === null ? null : parseScheduleEvent(value.event);
  if (value.event !== null && !event) return null;
  if (
    value.scheduleCancelled
    && (
      !event
      || getScheduleEventStatus(event) !== "cancelled"
      || !isScheduleEventCancellation(event.cancellation)
    )
  ) {
    return null;
  }
  if (
    value.completedSchedulePreserved === true
    && (
      value.scheduleCancelled
      || !event
      || getScheduleEventStatus(event) !== "completed"
    )
  ) {
    return null;
  }

  return {
    accepted: true,
    status: "completed",
    progress: value.progress,
    event,
    scheduleAdded: value.scheduleAdded as boolean,
    scheduleUpdated: value.scheduleUpdated as boolean,
    scheduleCancelled: value.scheduleCancelled as boolean,
    completedSchedulePreserved: value.completedSchedulePreserved === true,
    terminalSchedulePreserved: value.terminalSchedulePreserved === true,
    needsReview: value.needsReview === true,
    reviewReason: typeof value.reviewReason === "string" ? value.reviewReason : null,
    recordedSpendPreserved: value.recordedSpendPreserved as boolean,
    quoteContributionCorrected: value.quoteContributionCorrected as boolean,
    quoteCorrectionAmount,
    scheduleRemoved: value.scheduleRemoved as boolean,
    budgetUpdated: value.budgetUpdated as boolean,
    budgetReverted: value.budgetReverted as boolean,
    budgetDelta,
    budgetExceededBy,
    categoryBudgetLimit,
    categoryKey: value.categoryKey as string | null,
    newSpent,
    revertedAmount,
    removedEventId: value.removedEventId as string | null,
  };
}

function compactLabel(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function projectionCategoryKey(value: string | null | undefined): string | null {
  const key = compactLabel(value);
  return key && key.length <= 80 && !key.startsWith("__") ? key : null;
}

function bookingEventId(bookingId: string): string {
  return `${BOOKING_EVENT_PREFIX}${bookingId}`;
}

function legacyBookingEventId(bookingId: string): string {
  return `${BOOKING_EVENT_PREFIX}${bookingId.slice(0, 8)}`;
}

function bookingSourceKey(bookingId: string): string {
  return `${BOOKING_SOURCE_PREFIX}${bookingId}`;
}

function isBookingEvent(event: ScheduleEvent, bookingId: string): boolean {
  return (
    event.id === bookingEventId(bookingId) ||
    event.id === legacyBookingEventId(bookingId) ||
    event.sourceKey === bookingSourceKey(bookingId)
  );
}

function wonMemo(amount: number): string {
  if (amount <= 0) return "";
  return ` · ${formatWon(amount)}`;
}

function readBookingCostContributions(
  progress: Record<string, unknown>
): Record<string, BookingCostContribution> {
  const raw = progress.__booking_costs;
  if (!isRecord(raw)) return {};

  const contributions: Record<string, BookingCostContribution> = {};
  for (const [bookingId, rawContribution] of Object.entries(raw)) {
    if (isRecord(rawContribution)) {
      const amount = finiteNonNegativeAmount(rawContribution.amount);
      if (amount === null) continue;
      contributions[bookingId] = {
        amount,
        categoryKey: typeof rawContribution.categoryKey === "string"
          ? projectionCategoryKey(rawContribution.categoryKey)
          : null,
        basis: rawContribution.basis === "none" || rawContribution.basis === "actual"
          ? rawContribution.basis
          : "legacy_unknown",
        ...(finiteNonNegativeAmount(rawContribution.quotedAmount) !== null
          ? { quotedAmount: finiteNonNegativeAmount(rawContribution.quotedAmount)! }
          : {}),
      };
      continue;
    }

    // Read the legacy numeric ledger until every existing journey has been
    // rewritten by a create/outcome projection.
    const amount = finiteNonNegativeAmount(rawContribution);
    if (amount !== null) {
      contributions[bookingId] = {
        amount,
        categoryKey: null,
        basis: "legacy_unknown",
      };
    }
  }
  return contributions;
}

function buildEventTitle(input: BookingProgressBuildInput): string {
  const timeLabel = input.booking.time.slice(0, 5);
  const productName = compactLabel(input.productName);
  const staffName = compactLabel(input.staffName);
  const vendorLabel = compactLabel(
    `${input.vendor.name}${productName ? ` ${productName}` : ""}`
  );
  return `${timeLabel} ${vendorLabel} 상담${staffName ? ` (${staffName})` : ""}`;
}

export function buildBookingOutcomeProgressPatch(input: {
  progress: Record<string, unknown>;
  booking: BookingOutcomeProgressBooking;
  vendor: BookingProgressVendor;
}): BookingOutcomeProgressSyncResult {
  const progress = input.progress;
  const actualAmount = finiteUnknownAmount(input.booking.actualAmount);
  const existingContributions = readBookingCostContributions(progress);
  const existingEvent = getEvents(progress).find(
    (event) => isBookingEvent(event, input.booking.id)
  );
  const storedContribution = existingContributions[input.booking.id];
  const categoryKey =
    storedContribution?.categoryKey ??
    projectionCategoryKey(existingEvent?.categoryKey) ??
    projectionCategoryKey(input.vendor.category);

  const nextProgress: Record<string, unknown> = { ...progress };
  const patch: Record<string, unknown> = {};

  if (!categoryKey) {
    return {
      patch,
      nextProgress,
      budgetUpdated: false,
      budgetDelta: 0,
      previousContribution: 0,
      nextContribution: actualAmount,
      budgetExceededBy: 0,
      categoryBudgetLimit: 0,
      categoryLabel: categoryKey,
      syncedCategoryKey: null,
      syncedNewSpent: null,
      needsReview: false,
      reviewReason: null,
    };
  }

  const previousActualContribution = finiteUnknownAmount(input.booking.previousActualAmount);
  const previousContribution =
    storedContribution?.amount ??
    (previousActualContribution > 0
      ? previousActualContribution
      : existingEvent
        ? finiteUnknownAmount(input.booking.amount)
        : 0);
  const budgetDelta = actualAmount - previousContribution;
  const currentCategory = isRecord(progress[categoryKey]) ? progress[categoryKey] : {};
  const previousSpent = finiteUnknownAmount(currentCategory.spent);
  const budget = finiteUnknownAmount(currentCategory.budget);
  const ambiguousLegacy = Boolean(
    storedContribution
    && storedContribution.amount > 0
    && (
      storedContribution.basis === "legacy_unknown"
      || storedContribution.categoryKey === null
    ),
  );
  const wouldUnderflow = budgetDelta < 0 && previousSpent < Math.abs(budgetDelta);
  if (ambiguousLegacy || wouldUnderflow) {
    return {
      patch,
      nextProgress,
      budgetUpdated: false,
      budgetDelta: 0,
      previousContribution,
      nextContribution: previousContribution,
      budgetExceededBy: budget > 0 && previousSpent > budget
        ? previousSpent - budget
        : 0,
      categoryBudgetLimit: budget,
      categoryLabel:
        typeof currentCategory.label === "string" && currentCategory.label.trim()
          ? currentCategory.label
          : categoryKey,
      syncedCategoryKey: null,
      syncedNewSpent: null,
      needsReview: true,
      reviewReason: ambiguousLegacy
        ? "LEGACY_BOOKING_CONTRIBUTION_PROVENANCE_AMBIGUOUS"
        : "BOOKING_CONTRIBUTION_AGGREGATE_UNDERFLOW",
    };
  }
  const nextSpent = previousSpent + budgetDelta;
  const nextCategory = {
    ...currentCategory,
    spent: nextSpent,
  };
  const nextContributions = {
    ...existingContributions,
    [input.booking.id]: {
      amount: actualAmount,
      categoryKey,
      basis: "actual" as const,
      quotedAmount:
        storedContribution?.quotedAmount
        ?? finiteUnknownAmount(input.booking.amount),
    },
  };

  patch.__booking_costs = nextContributions;
  nextProgress.__booking_costs = nextContributions;

  if (budgetDelta !== 0) {
    patch[categoryKey] = nextCategory;
    nextProgress[categoryKey] = nextCategory;
  }

  const categoryLabel =
    typeof currentCategory.label === "string" && currentCategory.label.trim()
      ? currentCategory.label
      : categoryKey;

  return {
    patch,
    nextProgress,
    budgetUpdated: budgetDelta !== 0,
    budgetDelta,
    previousContribution,
    nextContribution: actualAmount,
    budgetExceededBy: budget > 0 && nextSpent > budget ? nextSpent - budget : 0,
    categoryBudgetLimit: budget,
    categoryLabel,
    syncedCategoryKey: categoryKey,
    syncedNewSpent: budgetDelta !== 0 ? nextSpent : null,
    needsReview: false,
    reviewReason: null,
  };
}

export function buildBookingCancelledProgressPatch(input: {
  progress: Record<string, unknown>;
  booking: BookingCancelledProgressBooking;
  vendor: BookingProgressVendor;
}): BookingCancelProgressSyncResult {
  const progress = input.progress;
  const actualAmount = input.booking.actualAmount === null
    ? null
    : finiteNonNegativeAmount(input.booking.actualAmount);
  if (input.booking.actualAmount !== null && actualAmount === null) {
    throw new Error("invalid_booking_actual_amount");
  }
  const outcomeProjection = actualAmount === null
    ? null
    : buildBookingOutcomeProgressPatch({
        progress,
        booking: {
          id: input.booking.id,
          amount: input.booking.amount,
          previousActualAmount: null,
          actualAmount,
        },
        vendor: input.vendor,
      });
  const projectedProgress = outcomeProjection?.nextProgress ?? progress;
  const eventInspection = inspectScheduleEvents(projectedProgress);
  if (
    eventInspection.malformedContainer
    || eventInspection.rejectedCount > 0
    || eventInspection.truncatedCount > 0
    || new Set(eventInspection.events.map((event) => event.id)).size
      !== eventInspection.events.length
  ) {
    throw new Error("invalid_booking_schedule_projection");
  }
  const events = eventInspection.events;
  const matchingEvents = events.filter((event) => isBookingEvent(event, input.booking.id));
  if (matchingEvents.length > 1) {
    throw new Error("ambiguous_booking_schedule_projection");
  }
  const existingEvent = matchingEvents[0] ?? null;
  const completedSchedulePreserved = existingEvent !== null
    && getScheduleEventStatus(existingEvent) === "completed";
  const scheduleCancelled = existingEvent !== null
    && getScheduleEventStatus(existingEvent) === "planned";
  const existingContributions = readBookingCostContributions(projectedProgress);
  const storedContribution = existingContributions[input.booking.id];
  const categoryKey =
    storedContribution?.categoryKey ??
    projectionCategoryKey(existingEvent?.categoryKey) ??
    projectionCategoryKey(input.vendor.category);
  const nextProgress: Record<string, unknown> = scheduleCancelled && existingEvent
    ? cancelEvent(projectedProgress, existingEvent.id, input.booking.cancellation)
    : { ...projectedProgress };
  const patch: Record<string, unknown> = { ...(outcomeProjection?.patch ?? {}) };
  if (scheduleCancelled) {
    patch.__events = nextProgress.__events;
  }

  const currentCategory = categoryKey && isRecord(projectedProgress[categoryKey])
    ? projectedProgress[categoryKey]
    : {};
  const budget = finiteUnknownAmount(currentCategory.budget);
  const quotedAmount = finiteUnknownAmount(input.booking.amount);
  const hasLegacyQuoteEvidence = input.booking.actualAmount === null
    && quotedAmount > 0
    && (
      (storedContribution?.basis === "legacy_unknown"
        && storedContribution.amount === quotedAmount)
    );
  const quoteContributionCorrected = false;
  const needsReview = Boolean(hasLegacyQuoteEvidence || outcomeProjection?.needsReview);
  const reviewReason = outcomeProjection?.reviewReason
    ?? (hasLegacyQuoteEvidence
      ? "LEGACY_BOOKING_CONTRIBUTION_PROVENANCE_AMBIGUOUS"
      : null);
  const syncedNewSpent: number | null = outcomeProjection?.syncedNewSpent ?? null;

  const categoryLabel =
    typeof currentCategory.label === "string" && currentCategory.label.trim()
      ? currentCategory.label
      : categoryKey;

  return {
    patch,
    nextProgress,
    scheduleRemoved: false,
    budgetReverted: false,
    scheduleCancelled,
    completedSchedulePreserved,
    terminalSchedulePreserved: completedSchedulePreserved
      || (existingEvent !== null && getScheduleEventStatus(existingEvent) === "cancelled"),
    needsReview,
    reviewReason,
    recordedSpendPreserved: actualAmount !== null,
    quoteContributionCorrected,
    quoteCorrectionAmount: quoteContributionCorrected ? quotedAmount : 0,
    revertedAmount: 0,
    categoryBudgetLimit: outcomeProjection?.categoryBudgetLimit ?? budget,
    categoryLabel: outcomeProjection?.categoryLabel ?? categoryLabel,
    syncedEventIdRemoved: null,
    syncedEventId: existingEvent?.id ?? null,
    syncedCategoryKey: quoteContributionCorrected
      ? categoryKey
      : outcomeProjection?.syncedCategoryKey ?? null,
    syncedNewSpent,
  };
}

export function buildBookingCreatedProgressPatch(
  input: BookingProgressBuildInput
): BookingProgressSyncResult {
  const progress = input.progress;
  const events = getEvents(progress);
  const amount = finiteAmount(input.booking.amount);
  const categoryKey = projectionCategoryKey(input.vendor.category);
  const eventId = bookingEventId(input.booking.id);
  const sourceKey = bookingSourceKey(input.booking.id);
  const now = new Date().toISOString();

  const existingEvent = events.find(
    (event) => event.id === eventId || event.sourceKey === sourceKey
  );

  const existingStatus = existingEvent ? getScheduleEventStatus(existingEvent) : null;
  const isTerminalExisting = existingStatus === "completed" || existingStatus === "cancelled";
  let event: ScheduleEvent;
  if (existingEvent && isTerminalExisting) {
    event = existingEvent;
  } else if (existingEvent) {
    const ownedPatch: ScheduleEvent = {
      ...existingEvent,
      id: existingEvent.id,
      date: input.booking.date,
      time: input.booking.time.slice(0, 5),
      sourceKey,
    };
    event = JSON.stringify(ownedPatch) === JSON.stringify(existingEvent)
      ? existingEvent
      : { ...ownedPatch, updatedAt: now };
  } else {
    event = {
      id: eventId,
      date: input.booking.date,
      time: input.booking.time.slice(0, 5),
      title: buildEventTitle(input),
      memo: amount > 0
        ? `아모라 내부 방문·상담 후보 견적${wonMemo(amount)} · 결제·지출 기록 아님 · 업체 전달·확정 미확인`
        : "아모라 내부 방문·상담 후보 금액 미확인 · 결제·지출 기록 아님 · 업체 전달·확정 미확인",
      categoryKey: categoryKey ?? undefined,
      sourceKey,
      createdAt: now,
      updatedAt: now,
    };
  }

  const nextEvents = existingEvent
    ? events.map((item) => (item.id === existingEvent.id ? event : item))
    : [...events, event];

  const patch: Record<string, unknown> = {
    __events: nextEvents,
  };
  const nextProgress: Record<string, unknown> = {
    ...progress,
    __events: nextEvents,
  };
  const existingContributions = readBookingCostContributions(progress);
  const nextContributions = {
    ...existingContributions,
    [input.booking.id]: existingContributions[input.booking.id] ?? {
      amount: 0,
      categoryKey,
      basis: "none" as const,
      quotedAmount: amount,
    },
  };
  patch.__booking_costs = nextContributions;
  nextProgress.__booking_costs = nextContributions;

  return {
    patch,
    nextProgress,
    scheduleAdded: !existingEvent,
    scheduleUpdated: Boolean(existingEvent && event !== existingEvent),
    terminalSchedulePreserved: isTerminalExisting,
    needsReview: false,
    reviewReason: null,
    budgetUpdated: false,
    budgetExceededBy: 0,
    categoryBudgetLimit: 0,
    categoryLabel: null,
    syncedEvent: event,
    syncedCategoryKey: null,
    syncedNewSpent: null,
  };
}

export async function syncBookingProgressAfterCreate(
  client: SupabaseClient,
  input: {
    coupleId: string;
    booking: BookingProgressBooking;
    vendor: BookingProgressVendor;
    productId?: string | null;
    staffId?: string | null;
    productName?: string | null;
    projectionClaim: BookingProjectionClaimContext;
  }
): Promise<BookingProgressPersistenceResult> {
  let productName = input.productName ?? null;
  if (!productName && input.productId) {
    const { data: productRow } = await client
      .from("vendor_products")
      .select("name")
      .eq("id", input.productId)
      .eq("vendor_id", input.vendor.id)
      .maybeSingle();
    productName = ((productRow as ProductRow | null)?.name ?? null) || null;
  }

  let staffName: string | null = null;
  if (input.staffId) {
    const { data: staffRow } = await client
      .from("vendor_staff")
      .select("name, role")
      .eq("id", input.staffId)
      .eq("vendor_id", input.vendor.id)
      .maybeSingle();
    const staff = staffRow as StaffRow | null;
    if (staff?.name) {
      staffName = staff.role ? `${staff.name} ${staff.role}` : staff.name;
    }
  }

  const vendor = input.vendor;
  const draftResult = buildBookingCreatedProgressPatch({
    progress: {},
    booking: input.booking,
    vendor: {
      id: vendor.id,
      name: vendor.name ?? "업체",
      category: vendor.category,
    },
    productName,
    staffName,
  });

  const { data: projectionData, error: projectionError } = await client.rpc(
    "apply_booking_progress_projection",
    {
    p_couple_id: input.coupleId,
      p_booking_id: input.booking.id,
      p_desired_state: "active",
      p_event: draftResult.syncedEvent,
      p_category_key: vendor.category,
      // `booking.amount` is a quoted/request amount. Only an explicitly
      // recorded actual amount may contribute to spent.
      p_amount: input.booking.actualAmount === null
        || input.booking.actualAmount === undefined
        ? 0
        : finiteUnknownAmount(input.booking.actualAmount),
      p_generation: input.projectionClaim.generation,
      p_claim_token: input.projectionClaim.claimToken,
    }
  );

  if (projectionError) {
    return {
      persisted: false,
      error: projectionError.message,
      ...draftResult,
    };
  }

  const projection = parseAtomicBookingProjectionResult(projectionData);
  if (!projection) {
    return {
      persisted: false,
      error: "invalid booking projection response",
      ...draftResult,
    };
  }
  if (projection.accepted === false) {
    return {
      persisted: false,
      projectionDisposition: projection.reason,
      error: `booking projection ${projection.reason}`,
      ...draftResult,
    };
  }
  if (!projection.event) {
    return {
      persisted: false,
      error: "invalid booking projection response",
      ...draftResult,
    };
  }

  const projectedCategoryValue = projection.categoryKey
    ? projection.progress[projection.categoryKey]
    : null;
  const projectedCategory = isRecord(projectedCategoryValue)
    ? projectedCategoryValue
    : {};
  const categoryLabel = typeof projectedCategory.label === "string"
    ? projectedCategory.label
    : projection.categoryKey;

  return {
    persisted: true,
    projectionDisposition: "completed",
    nextProgress: projection.progress,
    scheduleAdded: projection.scheduleAdded,
    scheduleUpdated: projection.scheduleUpdated,
    terminalSchedulePreserved: projection.terminalSchedulePreserved,
    needsReview: projection.needsReview,
    reviewReason: projection.reviewReason,
    budgetUpdated: projection.budgetUpdated,
    budgetDelta: projection.budgetDelta,
    budgetExceededBy: projection.budgetExceededBy,
    categoryBudgetLimit: projection.categoryBudgetLimit,
    categoryLabel,
    syncedEvent: projection.event,
    syncedCategoryKey: projection.budgetUpdated ? projection.categoryKey : null,
    syncedNewSpent: projection.newSpent,
  };
}

export async function syncBookingProgressAfterCancel(
  client: SupabaseClient,
  input: {
    coupleId: string;
    booking: BookingCancelledProgressBooking;
    vendor: BookingProgressVendor;
    projectionClaim: BookingProjectionClaimContext;
  }
): Promise<BookingCancelProgressPersistenceResult> {
  const draftResult = buildBookingCancelledProgressPatch({
    progress: {},
    booking: input.booking,
    vendor: input.vendor,
  });

  const { data: projectionData, error: projectionError } = await client.rpc(
    "apply_booking_progress_projection",
    {
    p_couple_id: input.coupleId,
      p_booking_id: input.booking.id,
      p_desired_state: "cancelled",
      p_event: null,
      p_category_key: input.vendor.category,
      p_amount: input.booking.actualAmount ?? 0,
      p_generation: input.projectionClaim.generation,
      p_claim_token: input.projectionClaim.claimToken,
    }
  );

  if (projectionError) {
    return {
      persisted: false,
      error: projectionError.message,
      ...draftResult,
    };
  }

  const projection = parseAtomicBookingProjectionResult(projectionData);
  if (!projection) {
    return {
      persisted: false,
      error: "invalid booking projection response",
      ...draftResult,
    };
  }
  if (projection.accepted === false) {
    return {
      persisted: false,
      projectionDisposition: projection.reason,
      error: `booking projection ${projection.reason}`,
      ...draftResult,
    };
  }

  const projectedCategoryValue = projection.categoryKey
    ? projection.progress[projection.categoryKey]
    : null;
  const projectedCategory = isRecord(projectedCategoryValue)
    ? projectedCategoryValue
    : {};
  const categoryLabel = typeof projectedCategory.label === "string"
    ? projectedCategory.label
    : projection.categoryKey;

  return {
    persisted: true,
    projectionDisposition: "completed",
    nextProgress: projection.progress,
    scheduleRemoved: projection.scheduleRemoved,
    budgetReverted: projection.budgetReverted,
    scheduleCancelled: projection.scheduleCancelled,
    completedSchedulePreserved: projection.completedSchedulePreserved,
    terminalSchedulePreserved: projection.terminalSchedulePreserved,
    needsReview: projection.needsReview,
    reviewReason: projection.reviewReason,
    recordedSpendPreserved: projection.recordedSpendPreserved,
    quoteContributionCorrected: projection.quoteContributionCorrected,
    quoteCorrectionAmount: projection.quoteCorrectionAmount,
    revertedAmount: projection.revertedAmount,
    categoryBudgetLimit: projection.categoryBudgetLimit,
    categoryLabel,
    syncedEventIdRemoved: projection.removedEventId,
    syncedEventId: projection.event?.id ?? null,
    syncedCategoryKey: projection.budgetUpdated ? projection.categoryKey : null,
    syncedNewSpent: projection.newSpent,
  };
}
