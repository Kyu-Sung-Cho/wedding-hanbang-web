import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  processBookingProjectionJob,
  type BookingProjectionDeliveryResult,
} from "@/lib/bookings/projectionOutbox";
import {
  cleanOptionalIsoDate,
  cleanOptionalText,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const BOOKING_TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/;

interface BookingRequestBody {
  vendorId: string;
  productId?: string | null;
  staffId?: string | null;
  date: string;
  time: string;
  brideName?: string | null;
  groomName?: string | null;
  contactPhone?: string | null;
  memo?: string | null;
}

function parseBookingRequestBody(body: unknown): BookingRequestBody | null {
  if (!isRecord(body)) return null;

  const date = cleanOptionalIsoDate(body.date);
  if (!isUuid(body.vendorId) || date === undefined || date === null) return null;
  if (body.productId !== undefined && body.productId !== null && !isUuid(body.productId)) return null;
  if (body.staffId !== undefined && body.staffId !== null && !isUuid(body.staffId)) return null;
  if (typeof body.time !== "string" || !BOOKING_TIME_RE.test(body.time)) return null;

  return {
    vendorId: body.vendorId,
    productId: typeof body.productId === "string" ? body.productId : null,
    staffId: typeof body.staffId === "string" ? body.staffId : null,
    date,
    time: body.time.slice(0, 5),
    brideName: cleanOptionalText(body.brideName, 80),
    groomName: cleanOptionalText(body.groomName, 80),
    contactPhone: cleanOptionalText(body.contactPhone, 40),
    memo: cleanOptionalText(body.memo, 500),
  };
}

export async function POST(req: Request) {
  try {
    if (!isTrustedMutationRequest(req)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }

    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // Rate limit: 10 bookings per hour per user
    const rlResult = checkRateLimit(
      rateLimitKey("booking:create", req, user.id),
      { maxRequests: 10, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const body = parseBookingRequestBody(await req.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ error: "예약 요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const { vendorId, productId, staffId, date, time, brideName, groomName, contactPhone, memo } = body;

    // 프로필에서 couple_id 가져오기
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보가 필요합니다." }, { status: 404 });
    }

    const admin = createAdminClient();
    // 업체 예약과 분리된 아모라 내부 후보 기록을 원자적으로 만든다. 이 RPC는
    // 업체 슬롯을 점유하지 않으며, considering 결정 노드까지 같은 트랜잭션에 남긴다.
    const { data: bookingId, error: rpcError } = await admin.rpc("create_amora_booking_intent_atomic", {
      p_vendor_id: vendorId,
      p_couple_id: profile.couple_id,
      p_actor_profile_id: user.id,
      p_booking_date: date,
      p_booking_time: time,
      p_product_id: productId || null,
      p_staff_id: staffId || null,
      p_booking_type: "consultation",
      p_bride_name: brideName || "",
      p_groom_name: groomName || "",
      p_contact_phone: contactPhone || "",
      p_memo: memo || "",
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("slot_unavailable")) {
        return NextResponse.json({ error: "해당 시간은 예약이 불가능합니다." }, { status: 409 });
      }
      if (msg.includes("slot_full")) {
        return NextResponse.json({ error: "해당 시간은 예약이 마감되었습니다." }, { status: 409 });
      }
      if (msg.includes("invalid_product_vendor")) {
        return NextResponse.json({ error: "선택한 상품이 이 업체의 상품이 아닙니다." }, { status: 400 });
      }
      if (msg.includes("invalid_staff_vendor")) {
        return NextResponse.json({ error: "선택한 담당자가 이 업체 소속이 아닙니다." }, { status: 400 });
      }
      if (msg.includes("vendor_unavailable")) {
        return NextResponse.json({ error: "현재 예약 가능한 업체가 아닙니다." }, { status: 409 });
      }
      if (msg.includes("duplicate_couple_slot") || msg.includes("vendor_bookings_one_active_couple_vendor_slot")) {
        return NextResponse.json(
          { error: "같은 업체와 시간에 이미 활성 예약이 있습니다. 기존 예약을 먼저 확인해주세요." },
          { status: 409 }
        );
      }
      if (msg.includes("booking_intent_already_cancelled")) {
        return NextResponse.json(
          { error: "같은 날짜와 시간의 아모라 후보 기록은 이미 취소되었습니다. 새 요청으로 되살리지 않았습니다." },
          { status: 409 },
        );
      }
      if (msg.includes("booking_joint_approval_required")) {
        return NextResponse.json(
          { error: "두 분 커플의 방문·상담 후보 기록은 공동 승인 기능이 준비될 때까지 만들 수 없습니다." },
          { status: 409 },
        );
      }
      if (msg.includes("invalid_booking_input")) {
        return NextResponse.json({ error: "예약 요청 형식이 올바르지 않습니다." }, { status: 400 });
      }
      if (msg.includes("past_booking_datetime")) {
        return NextResponse.json({ error: "이미 지난 시간에는 예약할 수 없습니다." }, { status: 409 });
      }
      console.error("Booking create RPC error:", rpcError);
      return NextResponse.json({ error: "예약 생성에 실패했습니다." }, { status: 500 });
    }

    // RPC 는 UUID 만 반환. 응답에서 full row 가 필요하므로 다시 조회.
    const { data: booking, error: fetchError } = await supabase
      .from("vendor_bookings")
      .select("*")
      .eq("id", bookingId as unknown as string)
      .single();

    if (fetchError || !booking) {
      console.error("Booking fetch after RPC error:", fetchError);
      return NextResponse.json({ error: "예약 조회에 실패했습니다." }, { status: 500 });
    }
    const verifiedIntent = booking as typeof booking & {
      vendor_delivery_status?: unknown;
      intent_created_by_profile_id?: unknown;
      intent_vendor_name_snapshot?: unknown;
      intent_vendor_category_snapshot?: unknown;
    };
    if (
      verifiedIntent.vendor_delivery_status !== "not_sent" ||
      verifiedIntent.intent_created_by_profile_id !== user.id ||
      booking.vendor_id !== vendorId ||
      booking.couple_id !== profile.couple_id ||
      booking.product_id !== (productId || null) ||
      booking.staff_id !== (staffId || null) ||
      typeof verifiedIntent.intent_vendor_name_snapshot !== "string" ||
      !verifiedIntent.intent_vendor_name_snapshot.trim() ||
      typeof verifiedIntent.intent_vendor_category_snapshot !== "string" ||
      !verifiedIntent.intent_vendor_category_snapshot.trim()
    ) {
      console.error("Booking intent returned an unsafe delivery state", { bookingId });
      return NextResponse.json(
        { error: "아모라 요청 기록 상태를 안전하게 확인하지 못했습니다." },
        { status: 500 },
      );
    }
    const persistedAmount = Number(booking.amount ?? 0);
    if (!Number.isFinite(persistedAmount) || persistedAmount < 0) {
      console.error("Booking amount after RPC was invalid", { bookingId });
      return NextResponse.json({ error: "예약 금액 확인에 실패했습니다." }, { status: 500 });
    }

    let projection: BookingProjectionDeliveryResult;
    try {
      projection = await processBookingProjectionJob(admin, {
        bookingId: bookingId as unknown as string,
      }) ?? {
        bookingId: bookingId as unknown as string,
        desiredState: "active",
        status: "pending_retry",
        retryable: true,
        attemptCount: 0,
        errorCode: "PROJECTION_NOT_CLAIMED",
      };
    } catch (projectionError) {
      console.error("[bookings] projection processing failed; durable retry remains queued:", projectionError);
      projection = {
        bookingId: bookingId as unknown as string,
        desiredState: "active",
        status: "pending_retry",
        retryable: true,
        attemptCount: 0,
        errorCode: "PROJECTION_PROCESS_FAILED",
      };
    }
    if (projection.status !== "completed") {
      console.error("[bookings] schedule projection is not complete:", {
        bookingId,
        status: projection.status,
        errorCode: projection.errorCode,
      });
    }

    // considering 결정 감사는 create_amora_booking_intent_atomic 안에서 이미 완료됐다.
    const createSync = projection.sync && "scheduleAdded" in projection.sync
      ? projection.sync
      : null;
    const projectionNeedsReview = projection.needsReview === true
      || projection.sync?.needsReview === true;
    const projectionReviewReason = projection.reviewReason
      ?? projection.sync?.reviewReason
      ?? null;
    const fullyApplied = projection.status === "completed" && !projectionNeedsReview;
    const message = fullyApplied
      ? "아모라 안에 예약 요청을 기록하고 일정에 반영했습니다. 업체에 전달되거나 확정된 상태는 아닙니다. 예약 요청 금액은 견적이며 결제·지출 기록에는 더하지 않았습니다."
      : projectionNeedsReview
        ? "아모라 안에 방문·상담 후보를 기록하고 일정은 보존했지만, 기존 금액 기록의 출처가 불명확해 지출 금액은 자동으로 바꾸지 않았습니다. 확인이 필요합니다. 업체 전달·확정 상태는 아닙니다."
      : projection.status === "pending_retry"
        ? "아모라 안에 예약 요청을 기록했지만 일정 반영이 지연되고 있습니다. 업체에 전달되거나 확정된 상태는 아닙니다. 예약 요청 금액은 견적이며 결제·지출 기록에는 더하지 않았습니다. 저장된 작업을 자동 재시도하므로 같은 기록을 다시 만들 필요는 없습니다."
        : "아모라 안에 예약 요청을 기록했지만 일정 자동 반영이 재시도 한도를 넘었습니다. 업체에 전달되거나 확정된 상태는 아닙니다. 예약 요청 금액은 견적이며 결제·지출 기록에는 더하지 않았습니다. 같은 기록을 다시 만들지 말고 고객지원에 알려주세요.";
    const bookingResponse = Object.fromEntries(
      Object.entries(booking).filter(([key]) => key !== "amount"),
    );

    return NextResponse.json({
      internalRequestRecorded: true,
      vendorDeliveryStatus: "not_sent",
      vendorConfirmationStatus: "unconfirmed",
      fullyApplied,
      projectionNeedsReview,
      projectionReviewReason,
      booking: {
        ...bookingResponse,
        quotedAmount: persistedAmount,
        amountBasis: "quote",
      },
      sync: {
        persisted: fullyApplied,
        scheduleAdded: createSync?.scheduleAdded ?? false,
        scheduleUpdated: createSync?.scheduleUpdated ?? false,
        budgetUpdated: createSync?.budgetUpdated ?? false,
        budgetExceededBy: createSync?.budgetExceededBy ?? 0,
        categoryKey: createSync?.syncedCategoryKey ?? null,
      },
      projection: {
        status: projection.status,
        retryable: projection.retryable,
        attemptCount: projection.attemptCount,
        retryAfterSeconds: projection.retryAfterSeconds,
        errorCode: projection.errorCode,
      },
      message,
    }, { status: fullyApplied ? 200 : 202 });
  } catch (err) {
    log.error("api/bookings", err);
    console.error("Booking create error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
