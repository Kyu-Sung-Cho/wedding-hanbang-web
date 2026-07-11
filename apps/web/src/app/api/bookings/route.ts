import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { recordDecision } from "@/lib/memory/record-decision";
import { syncBookingProgressAfterCreate } from "@/lib/bookings/progressSync";
import { resolveBookingContact } from "@/lib/bookings/contact";
import { ymdInKst } from "@/lib/utils/kstDate";
import {
  cleanOptionalIsoDate,
  cleanOptionalText,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";

export const BOOKING_REQUESTS_ENABLED = false as const;
export const BOOKING_REQUESTS_DISABLED_CODE = "booking_requests_disabled" as const;

const BOOKING_TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/;

interface BookingRequestBody {
  vendorId: string;
  productId?: string | null;
  staffId?: string | null;
  date: string;
  time: string;
  memo?: string | null;
}

interface ProductPriceRow {
  price: number | null;
  discount_price: number | null;
  name: string | null;
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
    memo: cleanOptionalText(body.memo, 500),
  };
}

export async function POST(req: Request) {
  // 업체 수신·상태 왕복·연락처 철회 경로가 완성될 때까지 인증과 본문 파싱보다
  // 먼저 차단한다. 구버전 클라이언트도 PII를 처리·저장하는 경로에 진입하지 않는다.
  if (!BOOKING_REQUESTS_ENABLED) {
    return NextResponse.json(
      {
        error: "업체 연결 준비 중입니다. 현재 상담 요청은 업체에 전송되지 않으며 저장되지 않습니다.",
        code: BOOKING_REQUESTS_DISABLED_CODE,
      },
      { status: 503 },
    );
  }

  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // Rate limit: 10 bookings per hour per user
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("booking:create", req, user.id),
      { maxRequests: 10, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const body = parseBookingRequestBody(await req.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ error: "예약 요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const { vendorId, productId, staffId, date, time, memo } = body;
    if (date < ymdInKst()) {
      return NextResponse.json(
        { error: "지난 날짜로는 상담 요청을 보낼 수 없어요.", code: "booking_date_past" },
        { status: 400 },
      );
    }

    // 프로필에서 couple_id 가져오기
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보가 필요합니다." }, { status: 404 });
    }
    const { data: isMember, error: membershipError } = await supabase.rpc("is_couple_member", {
      p_couple_id: profile.couple_id,
    });
    if (membershipError || isMember !== true) {
      return NextResponse.json({ error: "현재 커플 연결을 확인할 수 없습니다." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: bookingProfile, error: profilesError } = await admin
      .from("profiles")
      .select("id, name, role, phone")
      .eq("id", user.id)
      .eq("couple_id", profile.couple_id)
      .maybeSingle();
    if (profilesError) {
      console.error("Booking contact lookup error:", profilesError);
      return NextResponse.json(
        { error: "상담 요청 연락처를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." },
        { status: 500 },
      );
    }
    const { brideName, groomName, contactPhone } = resolveBookingContact(
      bookingProfile ? [bookingProfile] : [],
      user.id,
    );
    if (!contactPhone) {
      return NextResponse.json(
        {
          error: "상담 요청 연락처가 없어요. 설정에서 휴대폰 번호를 등록한 뒤 다시 시도해 주세요.",
          code: "booking_contact_required",
          actionHref: "/settings",
        },
        { status: 409 },
      );
    }

    // 상품 금액 조회
    let amount = 0;
    let productName: string | null = null;
    if (productId) {
      const { data: product } = await admin
        .from("vendor_products")
        .select("price, discount_price, name")
        .eq("id", productId)
        .eq("vendor_id", vendorId)
        .maybeSingle();
      if (product) {
        const typedProduct = product as ProductPriceRow;
        amount = typedProduct.discount_price ?? typedProduct.price ?? 0;
        productName = typedProduct.name ?? null;
      }
    }

    const findMatchingBooking = async () => {
      let query = supabase
        .from("vendor_bookings")
        .select("*")
        .eq("couple_id", profile.couple_id)
        .eq("vendor_id", vendorId)
        .eq("booking_date", date)
        .eq("booking_time", time)
        .neq("status", "cancelled");
      query = productId ? query.eq("product_id", productId) : query.is("product_id", null);
      query = staffId ? query.eq("staff_id", staffId) : query.is("staff_id", null);
      return query.order("created_at", { ascending: true }).limit(1).maybeSingle();
    };

    const { data: existingBooking, error: existingBookingError } = await findMatchingBooking();
    if (existingBookingError) {
      console.error("Booking idempotency lookup error:", existingBookingError);
      return NextResponse.json({ error: "기존 상담 요청을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }
    if (existingBooking) {
      return NextResponse.json({
        booking: existingBooking,
        deduplicated: true,
        message: "같은 상담 요청이 이미 접수되어 있어요.",
      });
    }

    // Atomic booking via Postgres RPC — TOCTOU 방어.
    // 이전엔 capacity COUNT → INSERT 를 client 호출 2단계로 수행해 동시 호출 시
    // 둘 다 capacity 통과 후 둘 다 INSERT → max_bookings 초과. RPC 가 timeslot row
    // FOR UPDATE 락 + COUNT + INSERT 단일 트랜잭션 → 직렬화.
    // RPC는 service_role 전용(20260611150000) — couple_id는 위에서 본인 프로필로 검증됨.
    const { data: bookingId, error: rpcError } = await admin.rpc("create_booking_atomic", {
      p_vendor_id: vendorId,
      p_couple_id: profile.couple_id,
      p_booking_date: date,
      p_booking_time: time,
      p_product_id: productId || null,
      p_staff_id: staffId || null,
      p_booking_type: "consultation",
      p_bride_name: brideName || "",
      p_groom_name: groomName || "",
      p_contact_phone: contactPhone || "",
      p_amount: amount,
      p_memo: memo || "",
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      if (rpcError.code === "23505" || msg.includes("vendor_bookings_active_request_unique")) {
        const { data: duplicateBooking } = await findMatchingBooking();
        if (duplicateBooking) {
          return NextResponse.json({
            booking: duplicateBooking,
            deduplicated: true,
            message: "같은 상담 요청이 이미 접수되어 있어요.",
          });
        }
      }
      if (msg.includes("slot_unavailable")) {
        return NextResponse.json({ error: "해당 시간에는 상담 요청을 보낼 수 없습니다." }, { status: 409 });
      }
      if (msg.includes("slot_full")) {
        return NextResponse.json({ error: "해당 시간의 상담 요청이 마감되었습니다." }, { status: 409 });
      }
      if (msg.includes("invalid_product_vendor")) {
        return NextResponse.json({ error: "선택한 상품이 이 업체의 상품이 아닙니다." }, { status: 400 });
      }
      if (msg.includes("invalid_staff_vendor")) {
        return NextResponse.json({ error: "선택한 담당자가 이 업체 소속이 아닙니다." }, { status: 400 });
      }
      console.error("Booking create RPC error:", rpcError);
      return NextResponse.json({ error: "상담 요청 접수에 실패했습니다." }, { status: 500 });
    }

    const syncResult = await syncBookingProgressAfterCreate(admin, {
      coupleId: profile.couple_id,
      booking: {
        id: bookingId as unknown as string,
        date,
        time,
        amount,
      },
      vendorId,
      productId,
      staffId,
      productName,
    });
    if (!syncResult.persisted) {
      console.error("[bookings] progress sync failed:", syncResult.error);
    }

    // RPC 는 UUID 만 반환. 응답에서 full row 가 필요하므로 다시 조회.
    const { data: booking, error: fetchError } = await supabase
      .from("vendor_bookings")
      .select("*")
      .eq("id", bookingId as unknown as string)
      .single();

    if (fetchError || !booking) {
      console.error("Booking fetch after RPC error:", fetchError);
      return NextResponse.json(
        {
          accepted: true,
          bookingId,
          message: "상담 요청은 접수됐어요. 요청 목록에 표시되는 데 잠시 걸릴 수 있습니다.",
          sync: { persisted: syncResult.persisted },
        },
        { status: 202 },
      );
    }

    // D2 Hook 2: 업체 확인 전 상담 요청을 scheduled 상태로 기록 (fire-and-forget)
    if (booking && profile.couple_id) {
      void (async () => {
        try {
          const { data: vendor } = await supabase
            .from("vendors")
            .select("name, category")
            .eq("id", vendorId)
            .maybeSingle();
          const v = vendor as { name: string; category: string } | null;

          await recordDecision({
            coupleId: profile.couple_id,
            userId: user.id,
            category: v?.category ?? "vendor",
            title: `상담 요청: ${v?.name ?? "업체"}`,
            chosenValue: {
              vendor_id: vendorId,
              vendor_name: v?.name ?? null,
              booking_date: date,
              booking_time: time,
              amount,
            },
            decisionType: "scheduled",
            source: "vendor_booking",
            sourceRefId: (booking as { id: string }).id,
            metadata: { hook: "bookings", booking_type: "consultation" },
          });
        } catch (err) {
          console.error("[bookings recordDecision] 실패 (무시):", err);
        }
      })();
    }

    return NextResponse.json({
      booking,
      sync: {
        persisted: syncResult.persisted,
        scheduleAdded: syncResult.scheduleAdded,
        scheduleUpdated: syncResult.scheduleUpdated,
        budgetUpdated: syncResult.budgetUpdated,
        budgetExceededBy: syncResult.budgetExceededBy,
        categoryKey: syncResult.syncedCategoryKey,
      },
      message: "상담 요청이 접수되었습니다. 업체 확인 전에는 예약이 확정되지 않습니다.",
    });
  } catch (err) {
    console.error("Booking create error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
