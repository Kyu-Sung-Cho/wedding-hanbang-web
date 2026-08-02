import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import {
  adminPaginationMetadata,
  checkAdminReadRateLimit,
  parseAdminPagination,
} from "@/lib/admin/adminReadBoundary";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { categoryToKorean } from "@/lib/utils/vendorMapper";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const VENDOR_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
type VendorStatus = (typeof VENDOR_STATUSES)[number];

function isVendorStatus(value: string): value is VendorStatus {
  return VENDOR_STATUSES.some((status) => status === value);
}

function normalizeVendorStatus(value: string | null): VendorStatus {
  return value && isVendorStatus(value) ? value : "pending";
}

export async function GET(request: Request) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkAdminReadRateLimit(request, userId, "vendors");
  if (limited) return limited;

  const pagination = parseAdminPagination(request, { defaultLimit: 100, maxLimit: 200 });
  if (!pagination) {
    return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  if (rawStatus !== null && !isVendorStatus(rawStatus)) {
    return NextResponse.json({ error: "Invalid vendor status" }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();
    let query = supabase
      .from("vendors")
      .select(
        "id,name,category,owner_name,phone,email,address,business_number,price_range,description,tags,status,created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(pagination.offset, pagination.offset + pagination.limit - 1);

    if (rawStatus) query = query.eq("status", rawStatus);

    const [{ data: vendorRows, error, count }, ...statusCounts] = await Promise.all([
      query,
      ...VENDOR_STATUSES.map((status) => supabase
        .from("vendors")
        .select("id", { count: "exact", head: true })
        .eq("status", status)),
    ]);

    const countError = statusCounts.find((result) => result.error)?.error;
    if (error || countError) {
      console.error("Admin vendors list failed", safeErrorDiagnostic(error ?? countError));
      return NextResponse.json({ error: "업체 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    const vendors = (vendorRows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      category: categoryToKorean(row.category),
      ownerName: row.owner_name ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      address: row.address ?? "",
      businessNumber: row.business_number ?? "",
      priceRange: row.price_range ?? "",
      description: row.description ?? "",
      tags: row.tags ?? [],
      status: normalizeVendorStatus(row.status),
      createdAt: row.created_at,
    }));

    const counts = VENDOR_STATUSES.reduce<Record<VendorStatus, number>>(
      (result, status, index) => {
        result[status] = statusCounts[index]?.count ?? 0;
        return result;
      },
      { draft: 0, pending: 0, approved: 0, rejected: 0 },
    );

    return NextResponse.json({
      vendors,
      counts: {
        ...counts,
        total: VENDOR_STATUSES.reduce((sum, status) => sum + counts[status], 0),
      },
      pagination: adminPaginationMetadata(pagination, vendors.length, count ?? 0),
    });
  } catch (error) {
    console.error("Admin vendors list error", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
