import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  dateToYearQuarter,
  FLEX_COHORT_MONTH,
  FLEX_COHORT_YEAR,
  quarterToMonth,
  shouldUseFlexibleCohort,
} from "@/utils/quarter";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * 자동 동기방 배정 — wedding_journeys.wedding_date 기반.
 *
 * 동작:
 * 1. 인증 사용자만
 * 2. 이미 가입된 동기방 있으면 그 room 반환 (재가입 안 함)
 * 3. wedding_date가 없거나 1년보다 멀면 날짜 미정·1년 이후 방으로 배정
 * 4. wedding_date가 가까우면 year + quarter 추출 → quarterToMonth 매핑
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
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingMembership) {
      return NextResponse.json({ room_id: existingMembership.room_id, reason: "already_assigned" });
    }

    // 2. wedding_date 조회 (couple → journey)
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .maybeSingle();

    let weddingDate: string | null = null;
    if (profile?.couple_id) {
      const { data: journey } = await supabase
        .from("wedding_journeys")
        .select("wedding_date")
        .eq("couple_id", profile.couple_id)
        .maybeSingle();
      weddingDate = journey?.wedding_date ?? null;
    }

    // 3. 날짜 → 방 기준. 미정/장기 예정은 별도 방으로 묶어 막막한 초반 사용자를 보호한다.
    const useFlexibleCohort = shouldUseFlexibleCohort(weddingDate);
    const reason = !profile?.couple_id
      ? "no_couple_assigned_flexible"
      : !weddingDate
        ? "no_wedding_date_assigned_flexible"
        : useFlexibleCohort
          ? "wedding_date_too_far_assigned_flexible"
          : "assigned";
    const target = useFlexibleCohort
      ? { year: FLEX_COHORT_YEAR, quarter: 4 as const, month: FLEX_COHORT_MONTH }
      : (() => {
          const { year, quarter } = dateToYearQuarter(weddingDate as string);
          return { year, quarter, month: quarterToMonth(quarter) };
        })();

    // 4. 기존 RPC 호출 (인원 30 자동 분할 + 멤버 등록 + community_profiles wedding_year/month 갱신)
    const { data: roomId, error: rpcError } = await supabase.rpc("community_assign_cohort", {
      p_user_id: user.id,
      p_year: target.year,
      p_month: target.month,
    });

    if (rpcError) {
      console.error("[auto-assign] RPC error:", rpcError);
      return NextResponse.json(
        { room_id: null, reason: "rpc_failed", error: rpcError.message },
        { status: 500 }
      );
    }

    if (roomId) {
      const serviceClient = getServiceClient();
      await serviceClient
        .from("cohort_members")
        .update({ is_active: true })
        .eq("room_id", roomId)
        .eq("user_id", user.id);

      const { count } = await serviceClient
        .from("cohort_members")
        .select("id", { count: "exact", head: true })
        .eq("room_id", roomId)
        .eq("is_active", true);

      await serviceClient
        .from("cohort_rooms")
        .update({ member_count: count ?? 0 })
        .eq("id", roomId);
    }

    return NextResponse.json({
      room_id: roomId,
      reason,
      year: target.year,
      quarter: target.quarter,
      flexible: useFlexibleCohort,
    });
  } catch (err) {
    console.error("[auto-assign] unexpected:", err);
    return NextResponse.json(
      { room_id: null, reason: "server_error" },
      { status: 500 }
    );
  }
}
