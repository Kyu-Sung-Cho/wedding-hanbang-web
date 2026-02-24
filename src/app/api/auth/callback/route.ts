import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
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
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

    if (sessionError) {
      console.error("세션 교환 에러:", sessionError);
      return NextResponse.redirect(`${origin}/login`);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // 프로필 조회 (새 유저는 프로필이 없을 수 있음)
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        console.error("프로필 조회 에러:", profileError);
      }

      // 프로필이 없거나 온보딩 미완료 → 온보딩으로
      if (!profile || !profile.onboarding_completed) {
        return NextResponse.redirect(`${origin}/onboarding`);
      }

      // 온보딩 완료 쿠키 설정
      const response = NextResponse.redirect(`${origin}/dashboard`);
      response.cookies.set("onboarding_complete", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    }
  }

  // code가 없거나 user가 없으면 로그인으로
  return NextResponse.redirect(`${origin}/login`);
}
