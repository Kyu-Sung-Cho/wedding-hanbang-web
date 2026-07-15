import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { vendorRowToVendor } from "@/lib/utils/vendorMapper";

const ADMIN_VENDOR_HISTORY_UNAVAILABLE = "ADMIN_VENDOR_HISTORY_UNAVAILABLE" as const;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const supabase = getServiceClient();
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("vendors")
    .select("*")
    .order("created_at", { ascending: false });

  if (status && ["pending", "approved", "rejected"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data: vendorRows, error } = await query;

  if (error) {
    console.error("[admin/vendors] history query failed");
    return NextResponse.json(
      { error: "과거 업체 기록을 불러오지 못했습니다.", code: ADMIN_VENDOR_HISTORY_UNAVAILABLE },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const vendors = (vendorRows ?? []).map((row) => vendorRowToVendor(row));
  const pending = (vendorRows ?? []).filter((v) => v.status === "pending").length;
  const approved = (vendorRows ?? []).filter((v) => v.status === "approved").length;
  const rejected = (vendorRows ?? []).filter((v) => v.status === "rejected").length;

  return NextResponse.json(
    {
      vendors,
      counts: { pending, approved, rejected, total: (vendorRows ?? []).length },
    },
    { headers: NO_STORE_HEADERS },
  );
}
