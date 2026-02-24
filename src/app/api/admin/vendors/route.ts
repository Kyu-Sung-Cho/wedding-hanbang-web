import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { vendorRowToVendor } from "@/lib/utils/vendorMapper";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const password = request.headers.get("x-admin-password");
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const vendors = (vendorRows ?? []).map((row) => vendorRowToVendor(row));
  const pending = (vendorRows ?? []).filter((v) => v.status === "pending").length;
  const approved = (vendorRows ?? []).filter((v) => v.status === "approved").length;
  const rejected = (vendorRows ?? []).filter((v) => v.status === "rejected").length;

  return NextResponse.json({
    vendors,
    counts: { pending, approved, rejected, total: (vendorRows ?? []).length },
  });
}
