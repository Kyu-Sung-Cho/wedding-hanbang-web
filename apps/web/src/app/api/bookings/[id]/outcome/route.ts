import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { syncBookingProgressAfterOutcome } from "@/lib/bookings/progressSync";
import { recordDecision } from "@/lib/memory/record-decision";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanIntegerInRange,
  cleanOptionalBoolean,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 24 * 1024;
const MAX_AMOUNT = 1_000_000_000;

interface OutcomeBody {
  actualAmount: number;
  contractedAmount: number | null;
  rating: number;
  review: string | null;
  sharePublicReview: boolean;
}

interface BookingOutcomeRow {
  id: string;
  couple_id: string;
  vendor_id: string;
  product_id: string | null;
  amount: number | string | null;
  contracted_amount: number | string | null;
  actual_amount: number | string | null;
  status: string | null;
  vendor: { name: string | null; category: string | null } | null;
  product: { name: string | null } | null;
}

function parseOutcomeBody(body: unknown): OutcomeBody | null {
  if (!isRecord(body)) return null;

  const actualAmount = cleanIntegerInRange(body.actualAmount, 0, MAX_AMOUNT);
  const rating = cleanIntegerInRange(body.rating, 1, 5);
  if (actualAmount === undefined || rating === undefined) return null;

  const contractedAmount =
    body.contractedAmount === undefined ||
    body.contractedAmount === null ||
    body.contractedAmount === ""
      ? null
      : cleanIntegerInRange(body.contractedAmount, 0, MAX_AMOUNT);
  if (contractedAmount === undefined) return null;

  return {
    actualAmount,
    contractedAmount,
    rating,
    review: cleanOptionalText(body.review, 1000),
    sharePublicReview: cleanOptionalBoolean(body.sharePublicReview),
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

async function upsertVendorReview({
  admin,
  booking,
  userId,
  outcome,
}: {
  admin: ReturnType<typeof createAdminClient>;
  booking: BookingOutcomeRow;
  userId: string;
  outcome: OutcomeBody;
}) {
  const payload = {
    vendor_id: booking.vendor_id,
    product_id: booking.product_id,
    booking_id: booking.id,
    customer_id: userId,
    rating: outcome.rating,
    content: outcome.review,
    is_visible: outcome.sharePublicReview,
  };

  const { data: existing } = await admin
    .from("vendor_reviews")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("customer_id", userId)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await admin
      .from("vendor_reviews")
      .update(payload)
      .eq("id", existing.id)
      .select("id, rating, content, is_visible")
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await admin
    .from("vendor_reviews")
    .insert(payload)
    .select("id, rating, content, is_visible")
    .single();

  if (error) throw error;
  return data;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 예약 ID입니다." }, { status: 400 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const rlResult = checkRateLimit(
      rateLimitKey("booking:outcome", request, user.id),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const outcome = parseOutcomeBody(await request.json().catch(() => null));
    if (!outcome) {
      return NextResponse.json({ error: "예약 결과 입력값이 올바르지 않습니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보가 필요합니다." }, { status: 404 });
    }

    const { data: bookingRow, error: bookingError } = await admin
      .from("vendor_bookings")
      .select("id, couple_id, vendor_id, product_id, amount, contracted_amount, actual_amount, status, vendor:vendors(name, category), product:vendor_products(name)")
      .eq("id", id)
      .maybeSingle();

    const booking = bookingRow as BookingOutcomeRow | null;
    if (bookingError || !booking || booking.couple_id !== profile.couple_id) {
      return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: updatedBooking, error: updateError } = await admin
      .from("vendor_bookings")
      .update({
        actual_amount: outcome.actualAmount,
        contracted_amount: outcome.contractedAmount,
        status: "completed",
      })
      .eq("id", id)
      .eq("couple_id", profile.couple_id)
      .select("id, status, amount, contracted_amount, actual_amount")
      .single();

    if (updateError || !updatedBooking) {
      console.error("Booking outcome update error:", updateError);
      return NextResponse.json({ error: "예약 결과 저장에 실패했습니다." }, { status: 500 });
    }

    const review = await upsertVendorReview({ admin, booking, userId: user.id, outcome });

    const budgetSync = await syncBookingProgressAfterOutcome(admin, {
      coupleId: profile.couple_id,
      booking: {
        id: booking.id,
        amount: numberOrNull(booking.amount),
        previousActualAmount: numberOrNull(booking.actual_amount),
        actualAmount: outcome.actualAmount,
      },
      vendor: {
        id: booking.vendor_id,
        name: booking.vendor?.name ?? "업체",
        category: booking.vendor?.category ?? null,
      },
    });
    if (!budgetSync.persisted) {
      console.error("[booking outcome] budget sync failed:", budgetSync.error);
    }

    const baselineAmount =
      outcome.contractedAmount ??
      numberOrNull(booking.contracted_amount) ??
      numberOrNull(booking.amount) ??
      0;
    const extraAmount = Math.max(0, outcome.actualAmount - baselineAmount);

    void recordDecision({
      coupleId: profile.couple_id,
      userId: user.id,
      category: booking.vendor?.category ?? "vendor",
      title: `완료: ${booking.vendor?.name ?? "업체"}`,
      chosenValue: {
        booking_id: booking.id,
        vendor_id: booking.vendor_id,
        vendor_name: booking.vendor?.name ?? null,
        product_id: booking.product_id,
        product_name: booking.product?.name ?? null,
        quoted_amount: numberOrNull(booking.amount),
        contracted_amount: outcome.contractedAmount,
        actual_amount: outcome.actualAmount,
        extra_amount: extraAmount,
        rating: outcome.rating,
        public_review: outcome.sharePublicReview,
      },
      decisionType: "completed",
      source: "vendor_booking",
      sourceRefId: booking.id,
      reasoning: outcome.review,
      confidence: 0.9,
      metadata: {
        hook: "booking_outcome",
        review_id: (review as { id?: string } | null)?.id ?? null,
        extra_amount: extraAmount,
      },
      dedupeKey: {
        sourceRefId: booking.id,
        source: "vendor_booking",
        decisionType: "completed",
      },
    });

    return NextResponse.json({
      booking: updatedBooking,
      review,
      outcome: {
        extraAmount,
        baselineAmount,
        budgetSync: {
          persisted: budgetSync.persisted,
          budgetUpdated: budgetSync.budgetUpdated,
          budgetDelta: budgetSync.budgetDelta,
          categoryKey: budgetSync.syncedCategoryKey,
          categorySpent: budgetSync.syncedNewSpent,
        },
      },
      message: "예약 결과가 저장되었습니다.",
    });
  } catch (err) {
    console.error("Booking outcome error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
