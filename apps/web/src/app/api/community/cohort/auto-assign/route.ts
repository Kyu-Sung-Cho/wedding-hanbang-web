import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import {
  dateToYearQuarter,
  FLEX_COHORT_MONTH,
  FLEX_COHORT_YEAR,
  quarterToMonth,
  shouldUseFlexibleCohort,
} from "@/utils/quarter";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createAdminClient();
}

function lookupFailedResponse() {
  return NextResponse.json(
    {
      room_id: null,
      reason: "lookup_failed",
      error: "동기방과 결혼 시기를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
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
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ room_id: null, reason: "unauthenticated" }, { status: 200 });
    }

    // 1. 이미 가입된 방이 있으면 그대로 반환
    const { data: existingMemberships, error: membershipError } = await supabase
      .from("cohort_members")
      .select("room_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("joined_at", { ascending: false })
      .limit(2);

    // 조회 실패를 미가입으로 간주하면 기존 방과 결혼 시기가 덮어써질 수 있다.
    if (membershipError) return lookupFailedResponse();

    if (existingMemberships?.length === 1) {
      return NextResponse.json(
        { room_id: existingMemberships[0].room_id, reason: "already_assigned" },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:cohort:auto-assign", req, user.id),
      { maxRequests: 10, windowMs: 60_000 },
    );
    if (limited) return limited;

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        {
          room_id: null,
          reason: "community_write_blocked",
          error: writeAccess.message,
          code: writeAccess.code,
        },
        { status: writeAccess.status }
      );
    }

    // 2. wedding_date 조회 (couple → journey)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) return lookupFailedResponse();

    let weddingDate: string | null = null;
    if (profile?.couple_id) {
      const { data: journey, error: journeyError } = await supabase
        .from("wedding_journeys")
        .select("wedding_date")
        .eq("couple_id", profile.couple_id)
        .maybeSingle();
      if (journeyError) return lookupFailedResponse();
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

    // 4. 기존 RPC 호출 (인원 30 자동 분할 + 멤버 등록 + community_profiles wedding_year/month 갱신).
    //    ⚠️ service client로 호출 — 이 RPC는 p_user_id를 파라미터로 받아 auth.uid() 강제가
    //    안 되므로 authenticated EXECUTE를 회수했다(마이그레이션). 라우트가 세션의 user.id만
    //    넘기므로 타인 강제 배정(IDOR)이 불가능하다.
    const serviceClient = getServiceClient();
    const { data: roomId, error: rpcError } = await serviceClient.rpc("community_assign_cohort", {
      p_user_id: user.id,
      p_year: target.year,
      p_month: target.month,
    });

    if (rpcError) {
      console.error("[auto-assign] RPC error:", rpcError);
      return NextResponse.json(
        { room_id: null, reason: "rpc_failed" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (typeof roomId !== "string") {
      return NextResponse.json(
        { room_id: null, reason: "rpc_invalid_result" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    return NextResponse.json({
      room_id: roomId,
      reason,
      year: target.year,
      quarter: target.quarter,
      flexible: useFlexibleCohort,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    log.error("api/community/cohort/auto-assign", err);
    console.error("[auto-assign] unexpected:", err);
    return NextResponse.json(
      { room_id: null, reason: "server_error" },
      { status: 500 }
    );
  }
}
