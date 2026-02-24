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

// 관리자 로그인 + 승격 (이메일/비밀번호 + ADMIN_PASSWORD)
export async function POST(req: Request) {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

  try {
    const body = await req.json();
    const { setupPassword, email, password, action } = body;

    if (setupPassword !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: "관리자 비밀번호가 틀렸습니다." }, { status: 403 });
    }

    const serviceClient = getServiceClient();

    // action === "signup": 계정 생성 + 관리자 설정
    if (action === "signup") {
      if (!email || !password) {
        return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
      }
      if (password.length < 6) {
        return NextResponse.json({ error: "비밀번호는 6자 이상이어야 합니다." }, { status: 400 });
      }

      // 서비스 클라이언트로 계정 생성 (이메일 인증 건너뜀)
      const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createError) {
        if (createError.message.includes("already been registered") || createError.message.includes("already exists")) {
          return NextResponse.json({ error: "이미 등록된 이메일입니다. 로그인으로 진행해주세요." }, { status: 409 });
        }
        return NextResponse.json({ error: `계정 생성 실패: ${createError.message}` }, { status: 500 });
      }

      if (!newUser.user) {
        return NextResponse.json({ error: "계정 생성에 실패했습니다." }, { status: 500 });
      }

      // 프로필 생성 + is_admin 설정
      await serviceClient.from("profiles").upsert({
        id: newUser.user.id,
        name: "관리자",
        email,
        onboarding_completed: true,
        onboarding_step: 4,
        is_admin: true,
      });

      return NextResponse.json({
        success: true,
        message: "관리자 계정이 생성되었습니다. 로그인해주세요.",
        needsLogin: true,
      });
    }

    // action === "login" 또는 기본: 기존 계정 로그인 + 관리자 승격
    if (action === "login" && email && password) {
      // 클라이언트에서 로그인은 처리하므로, 여기서는 승격만
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
      }

      const { error } = await serviceClient
        .from("profiles")
        .update({ is_admin: true })
        .eq("id", user.id);

      if (error) {
        return NextResponse.json({ error: "관리자 설정에 실패했습니다." }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: "관리자 권한이 설정되었습니다." });
    }

    // 이미 로그인된 상태에서 승격만 (기존 호환)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

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
