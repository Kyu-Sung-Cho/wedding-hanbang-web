import type { SupabaseClient } from "@supabase/supabase-js";
import { formatWon } from "@/lib/formatWon";
import type { ScheduleEvent } from "@/types/database.types";
import { getEvents } from "@/utils/scheduleEvents";
import { isRecord } from "@/utils/requestValidation";

export interface BookingProgressBooking {
  id: string;
  date: string;
  time: string;
  amount: number;
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
}

export interface BookingCancelProgressSyncResult {
  patch: Record<string, unknown>;
  nextProgress: Record<string, unknown>;
  scheduleRemoved: boolean;
  budgetReverted: boolean;
  revertedAmount: number;
  categoryBudgetLimit: number;
  categoryLabel: string | null;
  syncedEventIdRemoved: string | null;
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

interface VendorRow {
  id: string;
  name: string | null;
  category: string | null;
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
  scheduleRemoved: boolean;
  budgetUpdated: boolean;
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
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.date !== "string" ||
    typeof value.title !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return value as unknown as ScheduleEvent;
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
    "scheduleRemoved",
    "budgetUpdated",
    "budgetReverted",
  ] as const;
  if (booleanKeys.some((key) => typeof value[key] !== "boolean")) return null;

  const budgetDelta = finiteSignedAmount(value.budgetDelta);
  const budgetExceededBy = finiteNonNegativeAmount(value.budgetExceededBy);
  const categoryBudgetLimit = finiteNonNegativeAmount(value.categoryBudgetLimit);
  const revertedAmount = finiteNonNegativeAmount(value.revertedAmount);
  const newSpent = value.newSpent === null
    ? null
    : finiteNonNegativeAmount(value.newSpent);
  if (
    budgetDelta === null ||
    budgetExceededBy === null ||
    categoryBudgetLimit === null ||
    revertedAmount === null ||
    (value.newSpent !== null && newSpent === null) ||
    (value.categoryKey !== null && typeof value.categoryKey !== "string") ||
    (value.removedEventId !== null && typeof value.removedEventId !== "string")
  ) {
    return null;
  }

  const event = value.event === null ? null : parseScheduleEvent(value.event);
  if (value.event !== null && !event) return null;

  return {
    accepted: true,
    status: "completed",
    progress: value.progress,
    event,
    scheduleAdded: value.scheduleAdded as boolean,
    scheduleUpdated: value.scheduleUpdated as boolean,
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
      };
      continue;
    }

    // Read the legacy numeric ledger until every existing journey has been
    // rewritten by a create/outcome projection.
    const amount = finiteNonNegativeAmount(rawContribution);
    if (amount !== null) {
      contributions[bookingId] = { amount, categoryKey: null };
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
  const nextSpent = Math.max(0, previousSpent + budgetDelta);
  const nextCategory = {
    ...currentCategory,
    spent: nextSpent,
  };
  const nextContributions = {
    ...existingContributions,
    [input.booking.id]: { amount: actualAmount, categoryKey },
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
  };
}

export function buildBookingCancelledProgressPatch(input: {
  progress: Record<string, unknown>;
  booking: BookingCancelledProgressBooking;
  vendor: BookingProgressVendor;
}): BookingCancelProgressSyncResult {
  const progress = input.progress;
  const events = getEvents(progress);
  const removedEvents = events.filter((event) => isBookingEvent(event, input.booking.id));
  const nextEvents = events.filter((event) => !isBookingEvent(event, input.booking.id));
  const scheduleRemoved = removedEvents.length > 0;
  const existingContributions = readBookingCostContributions(progress);
  const storedContribution = existingContributions[input.booking.id];
  const categoryKey =
    storedContribution?.categoryKey ??
    projectionCategoryKey(removedEvents[0]?.categoryKey) ??
    projectionCategoryKey(input.vendor.category);
  const hasStoredContribution = Object.prototype.hasOwnProperty.call(
    existingContributions,
    input.booking.id
  );
  const previousContribution = hasStoredContribution
    ? storedContribution?.amount ?? 0
    : scheduleRemoved
      ? finiteUnknownAmount(input.booking.amount)
      : 0;

  const nextProgress: Record<string, unknown> = { ...progress };
  const patch: Record<string, unknown> = {};

  if (scheduleRemoved) {
    patch.__events = nextEvents;
    nextProgress.__events = nextEvents;
  }

  if (hasStoredContribution) {
    const nextContributions = { ...existingContributions };
    delete nextContributions[input.booking.id];
    patch.__booking_costs = nextContributions;
    nextProgress.__booking_costs = nextContributions;
  }

  const currentCategory = categoryKey && isRecord(progress[categoryKey])
    ? progress[categoryKey]
    : {};
  const previousSpent = finiteUnknownAmount(currentCategory.spent);
  const budget = finiteUnknownAmount(currentCategory.budget);
  let syncedNewSpent: number | null = null;

  if (categoryKey && previousContribution > 0) {
    const nextSpent = Math.max(0, previousSpent - previousContribution);
    const nextCategory = {
      ...currentCategory,
      spent: nextSpent,
    };
    patch[categoryKey] = nextCategory;
    nextProgress[categoryKey] = nextCategory;
    syncedNewSpent = nextSpent;
  }

  const categoryLabel =
    typeof currentCategory.label === "string" && currentCategory.label.trim()
      ? currentCategory.label
      : categoryKey;

  return {
    patch,
    nextProgress,
    scheduleRemoved,
    budgetReverted: syncedNewSpent !== null,
    revertedAmount: previousContribution,
    categoryBudgetLimit: budget,
    categoryLabel,
    syncedEventIdRemoved: removedEvents[0]?.id ?? null,
    syncedCategoryKey: syncedNewSpent !== null ? categoryKey : null,
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

  const event: ScheduleEvent = {
    ...(existingEvent ?? {}),
    id: existingEvent?.id ?? eventId,
    date: input.booking.date,
    title: buildEventTitle(input),
    memo: `예약 자동 등록${wonMemo(amount)}`,
    categoryKey: categoryKey ?? existingEvent?.categoryKey,
    sourceKey,
    createdAt: existingEvent?.createdAt ?? now,
    updatedAt: now,
  };

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
    [input.booking.id]: {
      amount: categoryKey ? amount : 0,
      categoryKey,
    },
  };
  patch.__booking_costs = nextContributions;
  nextProgress.__booking_costs = nextContributions;

  let budgetUpdated = false;
  let budgetExceededBy = 0;
  let categoryBudgetLimit = 0;
  let categoryLabel: string | null = null;
  let syncedNewSpent: number | null = null;

  if (!existingEvent && categoryKey && amount > 0) {
    const currentCategory = isRecord(progress[categoryKey])
      ? progress[categoryKey]
      : {};
    const previousSpent =
      typeof currentCategory.spent === "number" && Number.isFinite(currentCategory.spent)
        ? currentCategory.spent
        : 0;
    const budget =
      typeof currentCategory.budget === "number" && Number.isFinite(currentCategory.budget)
        ? currentCategory.budget
        : 0;
    const nextSpent = previousSpent + amount;
    const nextCategory = {
      ...currentCategory,
      spent: nextSpent,
    };

    patch[categoryKey] = nextCategory;
    nextProgress[categoryKey] = nextCategory;
    budgetUpdated = true;
    syncedNewSpent = nextSpent;
    categoryBudgetLimit = budget;
    categoryLabel =
      typeof currentCategory.label === "string" && currentCategory.label.trim()
        ? currentCategory.label
        : categoryKey;
    if (budget > 0 && nextSpent > budget) {
      budgetExceededBy = nextSpent - budget;
    }
  }

  return {
    patch,
    nextProgress,
    scheduleAdded: !existingEvent,
    scheduleUpdated: Boolean(existingEvent),
    budgetUpdated,
    budgetExceededBy,
    categoryBudgetLimit,
    categoryLabel,
    syncedEvent: event,
    syncedCategoryKey: budgetUpdated ? categoryKey : null,
    syncedNewSpent,
  };
}

export async function syncBookingProgressAfterCreate(
  client: SupabaseClient,
  input: {
    coupleId: string;
    booking: BookingProgressBooking;
    vendorId: string;
    productId?: string | null;
    staffId?: string | null;
    productName?: string | null;
    projectionClaim: BookingProjectionClaimContext;
  }
): Promise<BookingProgressPersistenceResult> {
  const { data: vendorRow, error: vendorError } = await client
    .from("vendors")
    .select("id, name, category")
    .eq("id", input.vendorId)
    .single();

  if (vendorError || !vendorRow) {
    return {
      persisted: false,
      error: vendorError ? "vendor lookup failed" : "missing sync context",
      ...buildBookingCreatedProgressPatch({
        progress: {},
        booking: input.booking,
        vendor: { id: input.vendorId, name: "업체", category: null },
        productName: input.productName,
      }),
    };
  }

  let productName = input.productName ?? null;
  if (!productName && input.productId) {
    const { data: productRow } = await client
      .from("vendor_products")
      .select("name")
      .eq("id", input.productId)
      .eq("vendor_id", input.vendorId)
      .maybeSingle();
    productName = ((productRow as ProductRow | null)?.name ?? null) || null;
  }

  let staffName: string | null = null;
  if (input.staffId) {
    const { data: staffRow } = await client
      .from("vendor_staff")
      .select("name, role")
      .eq("id", input.staffId)
      .eq("vendor_id", input.vendorId)
      .maybeSingle();
    const staff = staffRow as StaffRow | null;
    if (staff?.name) {
      staffName = staff.role ? `${staff.name} ${staff.role}` : staff.name;
    }
  }

  const vendor = vendorRow as VendorRow;
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
      p_amount: finiteAmount(input.booking.amount),
      p_generation: input.projectionClaim.generation,
      p_claim_token: input.projectionClaim.claimToken,
    }
  );

  if (projectionError) {
    return {
      persisted: false,
      error: "booking projection apply failed",
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
      p_amount: finiteUnknownAmount(input.booking.amount),
      p_generation: input.projectionClaim.generation,
      p_claim_token: input.projectionClaim.claimToken,
    }
  );

  if (projectionError) {
    return {
      persisted: false,
      error: "booking projection apply failed",
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
    revertedAmount: projection.revertedAmount,
    categoryBudgetLimit: projection.categoryBudgetLimit,
    categoryLabel,
    syncedEventIdRemoved: projection.removedEventId,
    syncedCategoryKey: projection.budgetReverted ? projection.categoryKey : null,
    syncedNewSpent: projection.newSpent,
  };
}
