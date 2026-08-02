import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import {
  adminPaginationMetadata,
  checkAdminReadRateLimit,
  parseAdminPagination,
} from "@/lib/admin/adminReadBoundary";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

export async function GET(request: Request) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkAdminReadRateLimit(request, userId, "customers");
  if (limited) return limited;

  const pagination = parseAdminPagination(request, { defaultLimit: 100, maxLimit: 100 });
  if (!pagination) {
    return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  }

  try {
    const admin = getServiceClient();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [profilesResult, onboardedResult, todayResult, pairedCouplesResult] = await Promise.all([
      admin
        .from("profiles")
        .select(
          "id,name,email,role,couple_id,onboarding_completed,onboarding_step,created_at",
          { count: "exact" },
        )
        .eq("is_admin", false)
        .order("created_at", { ascending: false })
        .range(pagination.offset, pagination.offset + pagination.limit - 1),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", false)
        .eq("onboarding_completed", true),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", false)
        .gte("created_at", todayStart.toISOString()),
      admin
        .from("couples")
        .select("id", { count: "exact", head: true })
        .not("bride_id", "is", null)
        .not("groom_id", "is", null),
    ]);

    const statsError = onboardedResult.error ?? todayResult.error ?? pairedCouplesResult.error;
    if (profilesResult.error || statsError) {
      console.error(
        "Admin customer profile or stats query failed",
        safeErrorDiagnostic(profilesResult.error ?? statsError),
      );
      return NextResponse.json({ error: "고객 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    const profiles = profilesResult.data ?? [];
    const coupleIds = [
      ...new Set(profiles.map((profile) => profile.couple_id).filter((id): id is string => Boolean(id))),
    ];

    const [couplesResult, journeysResult] = coupleIds.length > 0
      ? await Promise.all([
          admin
            .from("couples")
            .select("id,bride_id,groom_id")
            .in("id", coupleIds),
          admin
            .from("wedding_journeys")
            .select("couple_id,wedding_date,total_budget,venue")
            .in("couple_id", coupleIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

    if (couplesResult.error || journeysResult.error) {
      console.error(
        "Admin customer relationship query failed",
        safeErrorDiagnostic(couplesResult.error ?? journeysResult.error),
      );
      return NextResponse.json({ error: "고객 관계 정보를 불러오지 못했습니다." }, { status: 500 });
    }

    const coupleMap = new Map((couplesResult.data ?? []).map((couple) => [couple.id, couple]));
    const journeyMap = new Map((journeysResult.data ?? []).map((journey) => [journey.couple_id, journey]));

    const customers = profiles.map((profile) => {
      const couple = profile.couple_id ? coupleMap.get(profile.couple_id) : null;
      const journey = profile.couple_id ? journeyMap.get(profile.couple_id) : null;
      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
        coupleId: profile.couple_id,
        onboardingCompleted: profile.onboarding_completed,
        onboardingStep: profile.onboarding_step,
        hasPartner: Boolean(couple?.bride_id && couple?.groom_id),
        weddingDate: journey?.wedding_date ?? null,
        totalBudget: journey?.total_budget ?? null,
        venue: journey?.venue ?? null,
        createdAt: profile.created_at,
      };
    });

    const total = profilesResult.count ?? 0;
    const pairedProfiles = (pairedCouplesResult.count ?? 0) * 2;
    return NextResponse.json({
      customers,
      stats: {
        total,
        onboarded: onboardedResult.count ?? 0,
        coupled: Math.min(total, pairedProfiles),
        todayCount: todayResult.count ?? 0,
      },
      pagination: adminPaginationMetadata(pagination, customers.length, total),
    });
  } catch (error) {
    console.error("Admin customers error", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
