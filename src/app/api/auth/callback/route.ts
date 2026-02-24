import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const fromVendor = searchParams.get("from") === "vendor";

  if (!code) {
    console.error("콜백: code 파라미터 없음");
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server Component 에서 호출 시 무시
            }
          },
        },
      }
    );

    const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

    if (sessionError) {
      console.error("콜백: 세션 교환 에러:", sessionError.message);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(sessionError.message)}`
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("콜백: 세션 교환 후 user가 null");
      return NextResponse.redirect(`${origin}/login?error=no_user`);
    }

    // 프로필 조회 (새 유저는 프로필이 없을 수 있음)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("onboarding_completed, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("콜백: 프로필 조회 에러:", profileError.message);
    }

    // 관리자 확인 → 관리자 대시보드로
    if (profile?.is_admin) {
      const response = NextResponse.redirect(`${origin}/admin`);
      response.cookies.set("onboarding_complete", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      response.cookies.set("admin_role", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }

    // 업체 계정인지 확인 (온보딩보다 먼저 체크)
    const { data: vendorRecord } = await supabase
      .from("vendors")
      .select("id, status")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (vendorRecord) {
      // 업체 사용자 → 업체 포털로 리다이렉트
      const response = NextResponse.redirect(`${origin}/vendor/dashboard`);
      response.cookies.set("onboarding_complete", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      response.cookies.set("vendor_role", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }

    // 업체 로그인 경로로 왔는데 업체가 없으면 → 업체 등록 (프로필/온보딩 무관)
    if (fromVendor) {
      const response = NextResponse.redirect(`${origin}/vendor/register`);
      response.cookies.set("onboarding_complete", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    }

    // 일반 고객: 프로필/온보딩 체크
    if (!profile || !profile.onboarding_completed) {
      return NextResponse.redirect(`${origin}/onboarding`);
    }

    // 일반 고객 → 대시보드
    const response = NextResponse.redirect(`${origin}/dashboard`);
    response.cookies.set("onboarding_complete", "true", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("콜백: 예외 발생:", msg);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(msg)}`
    );
  }
}
