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

    await supabase.auth.exchangeCodeForSession(code);

    // 온보딩 완료 여부 확인 (세션 클라이언트 - RLS로 자기 프로필 조회)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .single();

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

  return NextResponse.redirect(`${origin}/dashboard`);
}
