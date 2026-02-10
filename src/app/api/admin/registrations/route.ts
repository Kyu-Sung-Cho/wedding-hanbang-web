import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  // 비밀번호 체크
  const password = request.headers.get("x-admin-password");
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  // 전체 등록 목록
  const { data: registrations, error } = await supabase
    .from("preregistrations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = registrations?.length || 0;

  // 날짜별 카운트 계산
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
