import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

export async function GET(request: Request) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  try {
    const admin = getServiceClient();

    const { data: admins, error } = await admin
      .from("profiles")
      .select("id, name, email, created_at")
      .eq("is_admin", true)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = (admins ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      createdAt: a.created_at,
    }));

    return NextResponse.json({ admins: result });
  } catch (err) {
    log.error("api/admin/admins", err);
    console.error("Admin admins list error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
