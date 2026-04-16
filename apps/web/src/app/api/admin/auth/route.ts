import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 현재 로그인한 유저의 관리자 여부 확인 + 관리자 존재 여부
export async function GET(req: Request) {
  try {
    const serviceClient = getServiceClient();
    const url = new URL(req.url);
    const checkOnly = url.searchParams.get("check") === "exists";

    // 관리자 존재 여부만 확인 (로그인 페이지에서 호출)
    if (checkOnly) {
      const { count } = await serviceClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);
      return NextResponse.json({ hasAdmin: (count ?? 0) > 0 });
    }

    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ isAdmin: false, error: "로그인이 필요합니다." }, { status: 401 });
    }

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

// 관리자 로그인 (이메일/비밀번호 + ADMIN_PASSWORD)
export async function POST(req: Request) {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { setupPassword, action } = body;

    if (setupPassword !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: "관리자 인증 비밀번호가 틀렸습니다." }, { status: 403 });
    }

    const serviceClient = getServiceClient();

    // action === "initial-setup": 최초 관리자 설정 (관리자 0명일 때만 허용)
    if (action === "initial-setup") {
      const { email: initEmail, password: initPassword, name: initName } = body;

      // 관리자가 이미 존재하는지 확인
      const { count } = await serviceClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);

      if ((count ?? 0) > 0) {
        return NextResponse.json({ error: "이미 관리자가 존재합니다. 기존 관리자로 로그인해주세요." }, { status: 403 });
      }

      if (!initEmail || !initPassword) {
        return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
      }
      if (initPassword.length < 6) {
        return NextResponse.json({ error: "비밀번호는 6자 이상이어야 합니다." }, { status: 400 });
      }

      // 계정 생성
      const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
        email: initEmail,
        password: initPassword,
        email_confirm: true,
      });

      if (createError) {
        if (createError.message.includes("already been registered") || createError.message.includes("already exists")) {
          return NextResponse.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });
        }
        return NextResponse.json({ error: `계정 생성 실패: ${createError.message}` }, { status: 500 });
      }

      if (!newUser.user) {
        return NextResponse.json({ error: "계정 생성에 실패했습니다." }, { status: 500 });
      }

      await serviceClient.from("profiles").upsert({
        id: newUser.user.id,
        name: initName || "헤드 관리자",
        email: initEmail,
        onboarding_completed: true,
        onboarding_step: 5,
        is_admin: true,
      });

      return NextResponse.json({
        success: true,
        message: "최초 관리자 계정이 생성되었습니다. 로그인해주세요.",
      });
    }

    // action === "create-admin": 기존 관리자가 새 관리자 추가 (관리자 대시보드에서만 호출)
    if (action === "create-admin") {
      const { email: newEmail, password: newPassword, name: newName } = body;

      // 요청한 사람이 기존 관리자인지 확인
      const supabase = await createClientFromRequest(req);
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
      }
      const { data: currentProfile } = await serviceClient
        .from("profiles")
        .select("is_admin")
        .eq("id", currentUser.id)
        .single();
      if (!currentProfile?.is_admin) {
        return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });
      }

      if (!newEmail || !newPassword) {
        return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
      }
      if (newPassword.length < 6) {
        return NextResponse.json({ error: "비밀번호는 6자 이상이어야 합니다." }, { status: 400 });
      }

      // 서비스 클라이언트로 계정 생성
      const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
        email: newEmail,
        password: newPassword,
        email_confirm: true,
      });

      if (createError) {
        if (createError.message.includes("already been registered") || createError.message.includes("already exists")) {
          return NextResponse.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });
        }
        return NextResponse.json({ error: `계정 생성 실패: ${createError.message}` }, { status: 500 });
      }

      if (!newUser.user) {
        return NextResponse.json({ error: "계정 생성에 실패했습니다." }, { status: 500 });
      }

      // 프로필 생성 + is_admin 설정
      await serviceClient.from("profiles").upsert({
        id: newUser.user.id,
        name: newName || "관리자",
        email: newEmail,
        onboarding_completed: true,
        onboarding_step: 5,
        is_admin: true,
      });

      return NextResponse.json({
        success: true,
        message: "새 관리자 계정이 생성되었습니다.",
      });
    }

    // action === "login": 기존 계정 로그인 + 관리자 확인
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    // is_admin이 이미 true인지 확인
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (profile?.is_admin) {
      return NextResponse.json({ success: true, message: "관리자 로그인 성공" });
    }

    // is_admin이 아닌 경우 승격하지 않고 거부
    return NextResponse.json({ error: "관리자 권한이 없는 계정입니다. 기존 관리자에게 권한을 요청하세요." }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
