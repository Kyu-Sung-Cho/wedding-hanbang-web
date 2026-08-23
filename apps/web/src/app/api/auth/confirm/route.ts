/**
 * 메일 링크가 도착하는 자리 — 여기서 **서버가** 세션을 세운다.
 *
 * 왜 이 라우트가 필요한지는 `@/lib/auth/emailConfirmLink` 의 주석에 있다.
 * 한 줄로: Supabase 가 준 링크는 결과를 해시로 돌려주는데 해시는 서버에 오지
 * 않고, 브라우저 클라이언트는 PKCE 로 고정돼 그 해시를 거부한다. 그래서
 * `hashed_token` 을 받아 `verifyOtp` 로 직접 교환한다.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isEmailConfirmType } from "@/lib/auth/emailConfirmLink";
import { verifyEmailConfirmSignature } from "@/lib/auth/emailConfirmSignature";
import { resolvePostAuthLanding } from "@/lib/auth/postAuthLanding";
import {
  getOptionalSameOriginRedirectPath,
  getPostLoginRedirectPath,
} from "@/lib/auth/safeRedirect";
import { clearDemoCookies } from "@/lib/demoSession";

/** 비밀번호를 새로 정하러 가는 자리. 세션이 선 뒤에 열린다. */
const RESET_PASSWORD_PATH = "/reset-password";

function loginError(origin: string, code: string, redirectPath: string | null): URL {
  const destination = new URL("/login", origin);
  destination.searchParams.set("error", code);
  if (redirectPath) destination.searchParams.set("redirect", redirectPath);
  return destination;
}

/**
 * Supabase 오류 원문을 화면으로 내보내지 않는다. 우리가 아는 몇 가지만
 * 코드로 좁히고 나머지는 하나로 묶는다 — 원문은 로그에만 남는다.
 */
function verifyErrorCode(message: string): "link_expired" | "link_invalid" | "verify_failed" {
  const lowered = message.toLowerCase();
  if (lowered.includes("expired")) return "link_expired";
  if (lowered.includes("invalid") || lowered.includes("not found")) return "link_invalid";
  return "verify_failed";
}

export async function GET(request: Request) {
  const { search, searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // 링크는 메일함을 거쳐 온다. 우리가 만든 값이 그대로 온다고 믿지 않는다.
  const requestedPath = getOptionalSameOriginRedirectPath(
    searchParams.get("redirect"),
    origin,
  );

  if (!tokenHash || !isEmailConfirmType(type)) {
    return NextResponse.redirect(loginError(origin, "link_invalid", requestedPath));
  }

  // 만료는 **교환하기 전에** 본다. verifyOtp 를 먼저 부르면 만료된 링크로도
  // 세션이 서고, 그 뒤에 막아 봐야 이미 늦다.
  //
  // Supabase 쪽 만료도 그대로 살아 있다 — 둘 중 짧은 쪽이 이긴다.
  const verdict = verifyEmailConfirmSignature({
    tokenHash,
    type,
    expiresAt: searchParams.get("exp"),
    signature: searchParams.get("sig"),
    nowMs: Date.now(),
  });
  if (verdict !== "valid") {
    // 서명 없는 옛 링크와 만료된 링크는 사용자가 할 일이 같다 — 새 메일 받기.
    const code = verdict === "invalid" ? "link_invalid" : "link_expired";
    console.error(`메일 인증: 링크 거절(${verdict})`);
    return NextResponse.redirect(loginError(origin, code, requestedPath));
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
      },
    );

    const { error: verifyError } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (verifyError) {
      console.error("메일 인증: 교환 실패:", verifyError.message);
      return NextResponse.redirect(
        loginError(origin, verifyErrorCode(verifyError.message), requestedPath),
      );
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error("메일 인증: 교환 후 user 가 null");
      return NextResponse.redirect(loginError(origin, "no_user", requestedPath));
    }

    // 비밀번호 재설정은 여기서 끝이다. 세션이 섰으니 새 비밀번호 화면을 연다.
    // 동의·온보딩 관문을 태우지 않는다 — 계정을 되찾는 중인 사람을 다른 화면으로
    // 돌리면 되찾을 방법이 다시 사라진다.
    if (type === "recovery") {
      const response = NextResponse.redirect(new URL(RESET_PASSWORD_PATH, origin));
      clearDemoCookies(response);
      return response;
    }

    const landing = await resolvePostAuthLanding({
      readOnboardingProfile: () => supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .maybeSingle(),
      userMetadata: user.user_metadata,
      pendingPath: getPostLoginRedirectPath(search, origin, false),
      completedPath: getPostLoginRedirectPath(search, origin, true),
    });

    const response = NextResponse.redirect(new URL(landing.path, origin));
    if (landing.markOnboardingComplete) {
      response.cookies.set("onboarding_complete", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    clearDemoCookies(response);
    return response;
  } catch (err) {
    console.error("메일 인증: 예외:", err instanceof Error ? err.message : String(err));
    return NextResponse.redirect(loginError(origin, "verify_failed", requestedPath));
  }
}
