import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import {
  adminPaginationMetadata,
  checkAdminReadRateLimit,
  parseAdminPagination,
} from "@/lib/admin/adminReadBoundary";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

export async function GET(request: Request) {
  try {
    const { authorized, userId } = await verifyAdmin(request);
    if (!authorized || !userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await checkAdminReadRateLimit(request, userId, "registrations");
    if (limited) return limited;

    const pagination = parseAdminPagination(request, { defaultLimit: 100, maxLimit: 200 });
    if (!pagination) {
      return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: registrations, error, count } = await supabase
      .from("preregistrations")
      .select("id,email,source,created_at", { count: "exact" })
      .not("email_verified_at", "is", null)
      .order("created_at", { ascending: false })
      .range(pagination.offset, pagination.offset + pagination.limit - 1);

    if (error) {
      console.error("[admin/registrations] query failed", safeErrorDiagnostic(error));
      return NextResponse.json({ error: "사전등록 정보를 불러오지 못했습니다." }, { status: 500 });
    }

    const result = registrations ?? [];
    const total = count ?? 0;
    const countMap: Record<string, number> = {};
    for (const registration of result) {
      const createdAt = registration.created_at;
      if (!createdAt) continue;
      const date = new Date(createdAt).toISOString().split("T")[0];
      countMap[date] = (countMap[date] ?? 0) + 1;
    }

    const dailyCounts = Object.entries(countMap)
      .map(([date, dailyCount]) => ({ date, count: dailyCount }))
      .sort((left, right) => left.date.localeCompare(right.date));

    return NextResponse.json({
      registrations: result,
      total,
      dailyCounts,
      dailyCountsScope: "returned_page",
      pagination: adminPaginationMetadata(pagination, result.length, total),
    });
  } catch (error) {
    console.error("[admin/registrations] unexpected failure", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
