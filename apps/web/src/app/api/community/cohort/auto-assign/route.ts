import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dateToYearQuarter, quarterToMonth } from "@/utils/quarter";

/**
 * 자동 동기방 배정 — wedding_journeys.wedding_date 기반.
 *
 * 동작:
 * 1. 인증 사용자만
 * 2. 이미 가입된 동기방 있으면 그 room 반환 (재가입 안 함)
 * 3. wedding_date 없으면 null 반환 (UI에서 입력 유도)
 * 4. wedding_date 있으면 year + quarter 추출 → quarterToMonth 매핑
 *    → community_assign_cohort RPC 호출 (기존 RPC 재사용, 인원 30 자동 분할)
 *
 * 첫 커뮤니티 진입 시 silent로 호출.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ room_id: null, reason: "unauthenticated" }, { status: 200 });
    }

    // 1. 이미 가입된 방이 있으면 그대로 반환
    const { data: existingMembership } = await supabase
      .from("cohort_members")
      .select("room_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (existingMembership) {
      return NextResponse.json({ room_id: existingMembership.room_id, reason: "already_assigned" });
    }

    // 2. wedding_date 조회 (couple → journey)
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ room_id: null, reason: "no_couple" });
    }

    const { data: journey } = await supabase
      .from("wedding_journeys")
      .select("wedding_date")
      .eq("couple_id", profile.couple_id)
      .maybeSingle();

    if (!journey?.wedding_date) {
      // 결혼일 미정 → 동기방 자동 가입 안 함
      return NextResponse.json({ room_id: null, reason: "no_wedding_date" });
    }

    // 3. 날짜 → year + quarter → month
    const { year, quarter } = dateToYearQuarter(journey.wedding_date);
    const month = quarterToMonth(quarter);

    // 4. 기존 RPC 호출 (인원 30 자동 분할 + 멤버 등록 + community_profiles wedding_year/month 갱신)
    const { data: roomId, error: rpcError } = await supabase.rpc("community_assign_cohort", {
      p_user_id: user.id,
      p_year: year,
      p_month: month,
    });

    if (rpcError) {
      console.error("[auto-assign] RPC error:", rpcError);
      return NextResponse.json(
        { room_id: null, reason: "rpc_failed", error: rpcError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      room_id: roomId,
      reason: "assigned",
      year,
      quarter,
    });
  } catch (err) {
    console.error("[auto-assign] unexpected:", err);
    return NextResponse.json(
      { room_id: null, reason: "server_error" },
      { status: 500 }
    );
  }
}
