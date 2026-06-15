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
  extends Omit<BookingProgressSyncResult, "patch" | "nextProgress"> {
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

function compactLabel(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function bookingEventId(bookingId: string): string {
  return `${BOOKING_EVENT_PREFIX}${bookingId.slice(0, 8)}`;
}

function bookingSourceKey(bookingId: string): string {
  return `${BOOKING_SOURCE_PREFIX}${bookingId}`;
}

function wonMemo(amount: number): string {
  if (amount <= 0) return "";
  if (amount >= 10_000) return ` · ${Math.floor(amount / 10_000).toLocaleString()}만원`;
  return ` · ${amount.toLocaleString()}원`;
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

  const existingEvent = events.find(
    (event) => event.id === eventId || event.sourceKey === sourceKey
  );

  const event: ScheduleEvent = {
    ...(existingEvent ?? {}),
    id: existingEvent?.id ?? eventId,
    date: input.booking.date,
    title: buildEventTitle(input),
    memo: `예약 자동 등록 · booking ${input.booking.id.slice(0, 8)}${wonMemo(amount)}`,
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
