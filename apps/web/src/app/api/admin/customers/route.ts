import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { todayYmdInKst } from "@hanbang/shared/utils";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

export async function GET(request: Request) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  try {
    const admin = getServiceClient();

    // 고객 프로필 전체 조회 (is_admin이 아닌 사용자)
    const { data: profiles, error: profilesErr } = await admin
      .from("profiles")
      .select("id, name, email, role, couple_id, onboarding_completed, onboarding_step, is_admin, created_at")
      .order("created_at", { ascending: false });

    if (profilesErr) {
      return NextResponse.json({ error: profilesErr.message }, { status: 500 });
    }

    // 커플 정보 조회
    const { data: couples } = await admin
      .from("couples")
      .select("id, invite_code, bride_id, groom_id, created_at");

    // 웨딩 여정 조회 (결혼일, 예산)
    const { data: journeys } = await admin
      .from("wedding_journeys")
      .select("couple_id, wedding_date, total_budget, venue");

    const coupleMap = new Map((couples ?? []).map((c) => [c.id, c]));
    const journeyMap = new Map((journeys ?? []).map((j) => [j.couple_id, j]));

    const customers = (profiles ?? [])
      .filter((p) => !p.is_admin)
      .map((p) => {
        const couple = p.couple_id ? coupleMap.get(p.couple_id) : null;
        const journey = p.couple_id ? journeyMap.get(p.couple_id) : null;
        const hasPartner = couple
          ? !!(couple.bride_id && couple.groom_id)
          : false;

        return {
          id: p.id,
          name: p.name,
          email: p.email,
          role: p.role,
          coupleId: p.couple_id,
          onboardingCompleted: p.onboarding_completed,
          onboardingStep: p.onboarding_step,
          hasPartner,
          weddingDate: journey?.wedding_date ?? null,
          totalBudget: journey?.total_budget ?? null,
          venue: journey?.venue ?? null,
          createdAt: p.created_at,
        };
      });

    // 통계
    const total = customers.length;
    const onboarded = customers.filter((c) => c.onboardingCompleted).length;
    const coupled = customers.filter((c) => c.hasPartner).length;
    const today = todayYmdInKst();
    const todayCount = customers.filter((c) => c.createdAt?.slice(0, 10) === today).length;

    return NextResponse.json({
      customers,
      stats: { total, onboarded, coupled, todayCount },
    });
  } catch (err) {
    log.error("api/admin/customers", err);
    console.error("Admin customers error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
