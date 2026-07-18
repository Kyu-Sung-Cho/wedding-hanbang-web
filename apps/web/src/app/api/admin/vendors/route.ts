import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { vendorRowToVendor } from "@/lib/utils/vendorMapper";

export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("vendors")
    .select("*")
    .order("created_at", { ascending: false });

  if (status && ["draft", "pending", "approved", "rejected"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data: vendorRows, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const vendors = (vendorRows ?? []).map((row) => vendorRowToVendor(row));
  const pending = (vendorRows ?? []).filter((v) => v.status === "pending").length;
  const draft = (vendorRows ?? []).filter((v) => v.status === "draft").length;
  const approved = (vendorRows ?? []).filter((v) => v.status === "approved").length;
  const rejected = (vendorRows ?? []).filter((v) => v.status === "rejected").length;

  return NextResponse.json({
    vendors,
    counts: { draft, pending, approved, rejected, total: (vendorRows ?? []).length },
  });
}
