import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { checkAdminReadRateLimit } from "@/lib/admin/adminReadBoundary";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const MAX_ADMIN_ROWS = 100;

export async function GET(request: Request) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkAdminReadRateLimit(request, userId, "admins");
  if (limited) return limited;

  try {
    const admin = getServiceClient();
    const { data: admins, error, count } = await admin
      .from("profiles")
      .select("id,name,email,created_at", { count: "exact" })
      .eq("is_admin", true)
      .order("created_at", { ascending: true })
      .limit(MAX_ADMIN_ROWS);

    if (error) {
      console.error("Admin admins query failed", safeErrorDiagnostic(error));
      return NextResponse.json({ error: "관리자 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    const result = (admins ?? []).map((adminUser) => ({
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      createdAt: adminUser.created_at,
    }));

    return NextResponse.json({
      admins: result,
      pagination: {
        limit: MAX_ADMIN_ROWS,
        total: count ?? 0,
        truncated: result.length < (count ?? 0),
      },
    });
  } catch (error) {
    console.error("Admin admins list error", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
