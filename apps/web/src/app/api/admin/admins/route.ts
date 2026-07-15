import { NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

const ADMIN_LIST_UNAVAILABLE = "ADMIN_LIST_UNAVAILABLE" as const;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

function unavailableResponse() {
  return NextResponse.json(
    { error: "관리자 목록을 불러오지 못했습니다.", code: ADMIN_LIST_UNAVAILABLE },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json(
      { error: "권한이 없습니다." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const admin = getServiceClient();

    const { data: admins, error } = await admin
      .from("profiles")
      .select("id, name, email, created_at")
      .eq("is_admin", true)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[admin/admins] list query failed");
      return unavailableResponse();
    }

    const result = (admins ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      createdAt: a.created_at,
    }));

    return NextResponse.json({ admins: result }, { headers: NO_STORE_HEADERS });
  } catch {
    console.error("[admin/admins] unexpected failure");
    return unavailableResponse();
  }
}
