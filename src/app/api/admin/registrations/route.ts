import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  const { data: registrations, error } = await supabase
    .from("preregistrations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = registrations?.length || 0;

  const countMap: Record<string, number> = {};
  registrations?.forEach((reg) => {
    const date = new Date(reg.created_at).toISOString().split("T")[0];
    countMap[date] = (countMap[date] || 0) + 1;
  });

  const dailyCounts = Object.entries(countMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    registrations: registrations || [],
    total,
    dailyCounts,
  });
}
