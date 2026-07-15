import { NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

const ADMIN_CUSTOMER_LIST_UNAVAILABLE = "ADMIN_CUSTOMER_LIST_UNAVAILABLE" as const;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

function unavailableResponse() {
  return NextResponse.json(
    { error: "고객 현황을 불러오지 못했습니다.", code: ADMIN_CUSTOMER_LIST_UNAVAILABLE },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json(
      { error: "권한이 없습니다." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const admin = getServiceClient();

    // 고객 프로필 전체 조회 (is_admin이 아닌 사용자)
    const { data: profiles, error: profilesErr } = await admin
      .from("profiles")
      .select("id, name, email, role, couple_id, onboarding_completed, onboarding_step, is_admin, created_at")
      .order("created_at", { ascending: false });

    if (profilesErr) {
      console.error("[admin/customers] profile query failed");
      return unavailableResponse();
    }

    // 커플 정보 조회
    const { data: couples, error: couplesErr } = await admin
      .from("couples")
      .select("id, bride_id, groom_id, created_at");

    // 웨딩 여정 조회 (결혼일, 예산)
    const { data: journeys, error: journeysErr } = await admin
      .from("wedding_journeys")
      .select("couple_id, wedding_date, total_budget, venue");

    if (couplesErr || journeysErr) {
      console.error("[admin/customers] related state query failed");
      return unavailableResponse();
    }

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
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = customers.filter((c) => c.createdAt?.slice(0, 10) === today).length;

    return NextResponse.json(
      {
        customers,
        stats: { total, onboarded, coupled, todayCount },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("[admin/customers] unexpected failure");
    return unavailableResponse();
  }
}
