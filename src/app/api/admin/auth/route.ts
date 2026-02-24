import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 현재 로그인한 유저의 관리자 여부 확인
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ isAdmin: false, error: "로그인이 필요합니다." }, { status: 401 });
    }

    const serviceClient = getServiceClient();
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    return NextResponse.json({
      isAdmin: profile?.is_admin === true,
      email: user.email,
    });
  } catch {
    return NextResponse.json({ isAdmin: false, error: "서버 오류" }, { status: 500 });
  }
}

// 관리자 승격 (ADMIN_PASSWORD로 보호)
export async function POST(req: Request) {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

  try {
    const { setupPassword } = await req.json();

    if (setupPassword !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: "설정 비밀번호가 틀렸습니다." }, { status: 403 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const serviceClient = getServiceClient();
    const { error } = await serviceClient
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json({ error: "관리자 설정에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "관리자 권한이 설정되었습니다." });
  } catch {
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
