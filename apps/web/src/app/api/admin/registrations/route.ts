import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { USER_RESEARCH_COHORT_CODE } from "@/constants/beta";
import { buildVerifiedResearchApplicationDailyCounts } from "@/lib/admin/researchApplicationStats";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  try {
    const { authorized } = await verifyAdmin(request);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
    }

    const supabase = getServiceClient();
    const now = new Date();
    const nowIso = now.toISOString();

    const { error: purgeError } = await supabase
      .from("research_cohort_applications")
      .delete()
      .lt("expires_at", nowIso);
    if (purgeError) {
      console.error("[admin/registrations] expired purge failed:", purgeError);
      return NextResponse.json({ error: "보유기간이 지난 신청 정보를 정리하지 못했습니다." }, { status: 503, headers: PRIVATE_HEADERS });
    }

    const { data: registrations, error } = await supabase
      .from("research_cohort_applications")
      .select("*")
      .eq("cohort_code", USER_RESEARCH_COHORT_CODE)
      .not("privacy_consent_at", "is", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[admin/registrations] supabase error:", error);
      return NextResponse.json({ error: "사용자 연구 신청 정보를 불러올 수 없습니다." }, { status: 500, headers: PRIVATE_HEADERS });
    }

    const verifiedRegistrations = (registrations ?? []).filter(
      (registration) => Boolean(registration.email_verified_at)
    );
    const total = verifiedRegistrations.length;
    const submittedTotal = registrations?.length || 0;
    const pendingVerificationTotal = submittedTotal - total;

    const dailyCounts = buildVerifiedResearchApplicationDailyCounts(registrations ?? [], now);

    return NextResponse.json({
      registrations: registrations || [],
      total,
      submittedTotal,
      pendingVerificationTotal,
      dailyCounts,
    }, { headers: PRIVATE_HEADERS });
  } catch (err) {
    console.error("[admin/registrations] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
