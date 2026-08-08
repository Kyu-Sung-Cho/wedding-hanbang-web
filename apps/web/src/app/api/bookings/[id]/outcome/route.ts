import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  processBookingProjectionJob,
  type BookingProjectionDeliveryResult,
} from "@/lib/bookings/projectionOutbox";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanIntegerInRange,
  cleanOptionalBoolean,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 24 * 1024;
const MAX_AMOUNT = 1_000_000_000;
// PostgreSQL UUID columns can contain older seed values whose version/variant
// bits are not RFC-generated. The request booking id remains strict, while a
// committed database identity is validated by shape so legacy rows do not turn
// a successful transaction into an ambiguous 503 response.
const DATABASE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OutcomeBody {
  actualAmount: number;
  contractedAmount: number | null;
  rating: number;
  review: string | null;
  sharePublicReview: boolean;
}

interface AtomicBookingOutcome {
  coupleId: string;
  booking: {
    id: string;
    status: string;
    amount: number | null;
    contractedAmount: number | null;
    actualAmount: number;
  };
  review: {
    id: string;
    rating: number;
    content: string | null;
    isVisible: boolean;
  };
  decisionId: string;
  baselineAmount: number;
  extraAmount: number;
  context: {
    vendorId: string;
    vendorName: string | null;
    vendorCategory: string | null;
    productId: string | null;
    productName: string | null;
  };
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

function optionalText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function isDatabaseUuid(value: unknown): value is string {
  return typeof value === "string" && DATABASE_UUID_RE.test(value);
}

function parseAtomicBookingOutcome(value: unknown): AtomicBookingOutcome | null {
  if (
    !isRecord(value) || value.accepted !== true ||
    !isRecord(value.booking) || !isRecord(value.review) ||
    !isRecord(value.context)
  ) {
    return null;
  }

  const amount = value.booking.amount === null
    ? null
    : numberOrNull(value.booking.amount);
  const contractedAmount = value.booking.contractedAmount === null
    ? null
    : numberOrNull(value.booking.contractedAmount);
  const actualAmount = numberOrNull(value.booking.actualAmount);
  const rating = numberOrNull(value.review.rating);
  const baselineAmount = numberOrNull(value.baselineAmount);
  const extraAmount = numberOrNull(value.extraAmount);
  const reviewContent = optionalText(value.review.content);
  const vendorName = optionalText(value.context.vendorName);
  const vendorCategory = optionalText(value.context.vendorCategory);
  const productId = optionalText(value.context.productId);
  const productName = optionalText(value.context.productName);

  if (
    !isDatabaseUuid(value.coupleId) ||
    !isDatabaseUuid(value.booking.id) ||
    typeof value.booking.status !== "string" ||
    (value.booking.amount !== null && amount === null) ||
    (value.booking.contractedAmount !== null && contractedAmount === null) ||
    (amount !== null && amount < 0) ||
    (contractedAmount !== null && contractedAmount < 0) ||
    actualAmount === null || actualAmount < 0 ||
    !isDatabaseUuid(value.review.id) ||
    rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5 ||
    reviewContent === undefined || typeof value.review.isVisible !== "boolean" ||
    !isDatabaseUuid(value.decisionId) ||
    baselineAmount === null || baselineAmount < 0 ||
    extraAmount === null || extraAmount < 0 ||
    !isDatabaseUuid(value.context.vendorId) ||
    vendorName === undefined || vendorCategory === undefined ||
    productId === undefined || (productId !== null && !isDatabaseUuid(productId)) ||
    productName === undefined
  ) {
    return null;
  }

  return {
    coupleId: value.coupleId,
    booking: {
      id: value.booking.id,
      status: value.booking.status,
      amount,
      contractedAmount,
      actualAmount,
    },
    review: {
      id: value.review.id,
      rating,
      content: reviewContent,
      isVisible: value.review.isVisible,
    },
    decisionId: value.decisionId,
    baselineAmount,
    extraAmount,
    context: {
      vendorId: value.context.vendorId,
      vendorName,
      vendorCategory,
      productId,
      productName,
    },
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }

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
    const { data: atomicData, error: atomicError } = await admin.rpc(
      "complete_amora_booking_outcome_atomic",
      {
        p_booking_id: id,
        p_customer_id: user.id,
        p_actual_amount: outcome.actualAmount,
        p_contracted_amount: outcome.contractedAmount,
        p_rating: outcome.rating,
        p_review: outcome.review,
        p_share_public_review: outcome.sharePublicReview,
      },
    );

    if (atomicError) {
      const message = atomicError.message?.toLowerCase() ?? "";
      if (message.includes("booking_outcome_not_found")) {
        return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
      }
      if (message.includes("invalid_booking_outcome")) {
        return NextResponse.json(
          { error: "예약 결과 입력값이 올바르지 않습니다." },
          { status: 400 },
        );
      }
      if (message.includes("booking_joint_approval_required")) {
        return NextResponse.json(
          { error: "두 분 커플의 완료·지출 기록은 공동 승인 기능이 준비될 때까지 저장할 수 없습니다." },
          { status: 409 },
        );
      }
      console.error("Booking outcome atomic RPC error:", atomicError);
      return NextResponse.json(
        {
          error: "예약 결과 저장 여부를 확인하지 못했습니다. 같은 내용을 다시 저장해도 중복 처리되지 않습니다.",
        },
        { status: 503 },
      );
    }

    const atomicOutcome = parseAtomicBookingOutcome(atomicData);
    if (!atomicOutcome || atomicOutcome.booking.id !== id) {
      console.error("Booking outcome atomic RPC returned an invalid response");
      return NextResponse.json(
        {
          error: "예약 결과 저장 여부를 확인하지 못했습니다. 같은 내용을 다시 저장해도 중복 처리되지 않습니다.",
        },
        { status: 503 },
      );
    }

    // Updating actual_amount fires the projection outbox trigger in the same
    // database transaction as the canonical booking mutation. This immediate
    // attempt is only a latency optimization; cron can safely retry the
    // durable generation if this request ends here.
    let projection: BookingProjectionDeliveryResult;
    try {
      projection = await processBookingProjectionJob(admin, { bookingId: id }) ?? {
        bookingId: id,
        desiredState: "active",
        status: "pending_retry",
        retryable: true,
        attemptCount: 0,
        errorCode: "PROJECTION_NOT_CLAIMED",
      };
    } catch (projectionError) {
      console.error(
        "[booking outcome] projection processing failed; durable retry remains queued:",
        projectionError,
      );
      projection = {
        bookingId: id,
        desiredState: "active",
        status: "pending_retry",
        retryable: true,
        attemptCount: 0,
        errorCode: "PROJECTION_PROCESS_FAILED",
      };
    }
    if (projection.status !== "completed") {
      console.error("[booking outcome] budget projection is not complete:", {
        bookingId: id,
        status: projection.status,
        errorCode: projection.errorCode,
      });
    }

    const baselineAmount = atomicOutcome.baselineAmount;
    const extraAmount = atomicOutcome.extraAmount;

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
      ? "사용자가 입력한 완료·지출 기록을 저장하고 예산에 반영했습니다. 결제 증빙이나 업체 확인을 뜻하지는 않습니다."
      : projectionNeedsReview
        ? "사용자 완료·지출 기록은 저장했지만 기존 금액 기록의 출처가 불명확해 예산 금액은 자동으로 바꾸지 않았습니다. 확인이 필요합니다."
      : projection.status === "pending_retry"
        ? "예약 결과는 저장되었지만 예산 반영이 지연되고 있습니다. 자동 재시도하므로 결과를 다시 입력할 필요는 없습니다."
        : "예약 결과는 저장되었지만 예산 자동 반영이 재시도 한도를 넘었습니다. 결과를 다시 입력하지 말고 고객지원에 알려주세요.";

    return NextResponse.json({
      outcomeAccepted: true,
      fullyApplied,
      projectionNeedsReview,
      projectionReviewReason,
      booking: {
        id: atomicOutcome.booking.id,
        status: atomicOutcome.booking.status,
        amount: atomicOutcome.booking.amount,
        contracted_amount: atomicOutcome.booking.contractedAmount,
        actual_amount: atomicOutcome.booking.actualAmount,
      },
      review: {
        id: atomicOutcome.review.id,
        rating: atomicOutcome.review.rating,
        content: atomicOutcome.review.content,
        is_visible: atomicOutcome.review.isVisible,
      },
      outcome: {
        extraAmount,
        baselineAmount,
        budgetSync: {
          persisted: fullyApplied,
          budgetUpdated: createSync?.budgetUpdated ?? false,
          budgetDelta: createSync?.budgetDelta ?? null,
          categoryKey: createSync?.syncedCategoryKey ?? null,
          categorySpent: createSync?.syncedNewSpent ?? null,
        },
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
    console.error("Booking outcome error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
