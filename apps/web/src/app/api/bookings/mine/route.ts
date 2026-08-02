import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest } from "next/server";
import { PrivateNextResponse as NextResponse } from "@/lib/http/privateResponse";
import { bookingRowToBooking } from "@/lib/utils/vendorMapper";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { VENDOR_BOOKING_PRIVATE_SELECT } from "@/lib/privacy/privateDataSelects";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return NextResponse.json({ bookings: [] });
      }
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("bookings:mine", req, user.id),
      { maxRequests: 120, windowMs: 60 * 1000 },
    );
    if (limited) return limited;

    // 프로필에서 couple_id 가져오기
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ bookings: [] });
    }

    const { data: bookingRows } = await supabase
      .from("vendor_bookings")
      .select(VENDOR_BOOKING_PRIVATE_SELECT)
      .eq("couple_id", profile.couple_id)
      .order("booking_date", { ascending: false })
      .limit(500);

    // 업체명 가져오기
    const vendorIds = [...new Set((bookingRows ?? []).map((b) => b.vendor_id))];
    const { data: vendors } = vendorIds.length > 0
      ? await createAdminClient()
          .from("vendors")
          .select("id, name")
          .in("id", vendorIds)
          .eq("status", "approved")
      : { data: [] };

    const vendorMap = Object.fromEntries((vendors ?? []).map((v) => [v.id, v.name]));

    // contracts/payments 조인은 제거됨 — 결제층 삭제(Week 1 수술)로 두 테이블 모두
    // 0행이고 소비처(bookings 페이지·BudgetContent)도 해당 필드를 읽지 않는다 (감사 2.2).
    const bookings = (bookingRows ?? []).map((row) => ({
      ...bookingRowToBooking(row),
      vendorName: vendorMap[row.vendor_id] ?? "",
    }));

    return NextResponse.json({ bookings });
  } catch (err) {
    console.error("My bookings error:", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
