import type { SupabaseClient } from "@supabase/supabase-js";
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

export interface BookingOutcomeProgressPersistenceResult
  extends Omit<BookingOutcomeProgressSyncResult, "patch"> {
  persisted: boolean;
  error?: string;
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
  error?: string;
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

interface JourneyProgressRow {
  progress: Record<string, unknown> | null;
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

function compactLabel(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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
  if (amount >= 10_000) return ` · ${Math.floor(amount / 10_000).toLocaleString()}만원`;
  return ` · ${amount.toLocaleString()}원`;
}

function readBookingCostContributions(progress: Record<string, unknown>): Record<string, number> {
  const raw = progress.__booking_costs;
  if (!isRecord(raw)) return {};

  return Object.fromEntries(
    Object.entries(raw)
      .map(([bookingId, amount]) => [bookingId, finiteNonNegativeAmount(amount)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== null)
  );
}

function buildEventTitle(input: BookingProgressBuildInput): string {
  const timeLabel = input.booking.time.slice(0, 5);
  const productName = compactLabel(input.productName);
  const staffName = compactLabel(input.staffName);
  const vendorLabel = compactLabel(
    `${input.vendor.name}${productName ? ` ${productName}` : ""}`
  );
  return `${timeLabel} ${vendorLabel} 상담 요청${staffName ? ` (${staffName})` : ""}`;
}

export function buildBookingOutcomeProgressPatch(input: {
  progress: Record<string, unknown>;
  booking: BookingOutcomeProgressBooking;
  vendor: BookingProgressVendor;
}): BookingOutcomeProgressSyncResult {
  const progress = input.progress;
  const categoryKey = compactLabel(input.vendor.category) || null;
  const actualAmount = finiteUnknownAmount(input.booking.actualAmount);
  const existingContributions = readBookingCostContributions(progress);
  const existingEvent = getEvents(progress).find(
    (event) => isBookingEvent(event, input.booking.id)
  );

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

  const storedContribution = existingContributions[input.booking.id];
  const previousActualContribution = finiteUnknownAmount(input.booking.previousActualAmount);
  const previousContribution =
    storedContribution ??
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
    [input.booking.id]: actualAmount,
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
  const categoryKey = compactLabel(input.vendor.category) || null;
  const events = getEvents(progress);
  const removedEvents = events.filter((event) => isBookingEvent(event, input.booking.id));
  const nextEvents = events.filter((event) => !isBookingEvent(event, input.booking.id));
  const scheduleRemoved = removedEvents.length > 0;
  const existingContributions = readBookingCostContributions(progress);
  const hasStoredContribution = Object.prototype.hasOwnProperty.call(
    existingContributions,
    input.booking.id
  );
  const previousContribution = hasStoredContribution
    ? existingContributions[input.booking.id]
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
  const categoryKey = compactLabel(input.vendor.category) || null;
  const eventId = bookingEventId(input.booking.id);
  const sourceKey = bookingSourceKey(input.booking.id);
  const now = new Date().toISOString();

  const existingEvent = events.find((event) => isBookingEvent(event, input.booking.id));
  const existingContributions = readBookingCostContributions(progress);
  const hasStoredContribution = Object.prototype.hasOwnProperty.call(
    existingContributions,
    input.booking.id
  );
  // Legacy booking events without a ledger entry already contributed their quoted
  // amount to spent. Only a genuinely new pending request receives the zero marker.
  const shouldInitializePendingContribution = !existingEvent && !hasStoredContribution;

  const event: ScheduleEvent = {
    ...(existingEvent ?? {}),
    id: existingEvent?.id ?? eventId,
    date: input.booking.date,
    title: buildEventTitle(input),
    memo: `상담 요청 자동 등록 · booking ${input.booking.id.slice(0, 8)}${wonMemo(amount)}`,
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

  if (shouldInitializePendingContribution) {
    const nextContributions = {
      ...existingContributions,
      [input.booking.id]: 0,
    };
    patch.__booking_costs = nextContributions;
    nextProgress.__booking_costs = nextContributions;
  }

  return {
    patch,
    nextProgress,
    scheduleAdded: !existingEvent,
    scheduleUpdated: Boolean(existingEvent),
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
    vendorId: string;
    productId?: string | null;
    staffId?: string | null;
    productName?: string | null;
  }
): Promise<BookingProgressPersistenceResult> {
  const [{ data: journeyRow, error: journeyError }, { data: vendorRow, error: vendorError }] =
    await Promise.all([
      client
        .from("wedding_journeys")
        .select("progress")
        .eq("couple_id", input.coupleId)
        .single(),
      client
        .from("vendors")
        .select("id, name, category")
        .eq("id", input.vendorId)
        .single(),
    ]);

  if (journeyError || vendorError || !journeyRow || !vendorRow) {
    return {
      persisted: false,
      error: journeyError?.message ?? vendorError?.message ?? "missing sync context",
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
  const progress = ((journeyRow as JourneyProgressRow).progress ?? {}) as Record<
    string,
    unknown
  >;
  const syncResult = buildBookingCreatedProgressPatch({
    progress,
    booking: input.booking,
    vendor: {
      id: vendor.id,
      name: vendor.name ?? "업체",
      category: vendor.category,
    },
    productName,
    staffName,
  });

  const { error: patchError } = await client.rpc("apply_journey_progress_patch", {
    p_couple_id: input.coupleId,
    p_patch: syncResult.patch,
    p_remove_keys: [],
  });

  if (!patchError) {
    return { persisted: true, ...syncResult };
  }

  const { error: updateError } = await client
    .from("wedding_journeys")
    .update({ progress: syncResult.nextProgress })
    .eq("couple_id", input.coupleId);

  return {
    persisted: !updateError,
    error: updateError?.message ?? patchError.message,
    ...syncResult,
  };
}

export async function syncBookingProgressAfterOutcome(
  client: SupabaseClient,
  input: {
    coupleId: string;
    booking: BookingOutcomeProgressBooking;
    vendor: BookingProgressVendor;
  }
): Promise<BookingOutcomeProgressPersistenceResult> {
  const { data: journeyRow, error: journeyError } = await client
    .from("wedding_journeys")
    .select("progress")
    .eq("couple_id", input.coupleId)
    .single();

  if (journeyError || !journeyRow) {
    return {
      persisted: false,
      error: journeyError?.message ?? "missing journey progress",
      ...buildBookingOutcomeProgressPatch({
        progress: {},
        booking: input.booking,
        vendor: input.vendor,
      }),
    };
  }

  const progress = ((journeyRow as JourneyProgressRow).progress ?? {}) as Record<
    string,
    unknown
  >;
  const syncResult = buildBookingOutcomeProgressPatch({
    progress,
    booking: input.booking,
    vendor: input.vendor,
  });

  if (Object.keys(syncResult.patch).length === 0) {
    return { persisted: true, ...syncResult };
  }

  const { error: patchError } = await client.rpc("apply_journey_progress_patch", {
    p_couple_id: input.coupleId,
    p_patch: syncResult.patch,
    p_remove_keys: [],
  });

  if (!patchError) {
    return { persisted: true, ...syncResult };
  }

  const { error: updateError } = await client
    .from("wedding_journeys")
    .update({ progress: syncResult.nextProgress })
    .eq("couple_id", input.coupleId);

  return {
    persisted: !updateError,
    error: updateError?.message ?? patchError.message,
    ...syncResult,
  };
}

export async function syncBookingProgressAfterCancel(
  client: SupabaseClient,
  input: {
    coupleId: string;
    booking: BookingCancelledProgressBooking;
    vendor: BookingProgressVendor;
  }
): Promise<BookingCancelProgressPersistenceResult> {
  const { data: journeyRow, error: journeyError } = await client
    .from("wedding_journeys")
    .select("progress")
    .eq("couple_id", input.coupleId)
    .single();

  if (journeyError || !journeyRow) {
    return {
      persisted: false,
      error: journeyError?.message ?? "missing journey progress",
      ...buildBookingCancelledProgressPatch({
        progress: {},
        booking: input.booking,
        vendor: input.vendor,
      }),
    };
  }

  const progress = ((journeyRow as JourneyProgressRow).progress ?? {}) as Record<
    string,
    unknown
  >;
  const syncResult = buildBookingCancelledProgressPatch({
    progress,
    booking: input.booking,
    vendor: input.vendor,
  });

  if (Object.keys(syncResult.patch).length === 0) {
    return { persisted: true, ...syncResult };
  }

  const { error: patchError } = await client.rpc("apply_journey_progress_patch", {
    p_couple_id: input.coupleId,
    p_patch: syncResult.patch,
    p_remove_keys: [],
  });

  if (!patchError) {
    return { persisted: true, ...syncResult };
  }

  const { error: updateError } = await client
    .from("wedding_journeys")
    .update({ progress: syncResult.nextProgress })
    .eq("couple_id", input.coupleId);

  return {
    persisted: !updateError,
    error: updateError?.message ?? patchError.message,
    ...syncResult,
  };
}
