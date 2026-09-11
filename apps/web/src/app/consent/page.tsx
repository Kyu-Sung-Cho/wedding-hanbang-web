import { hasWebSignupConsentAccess } from "@/lib/auth/signupConsentAccess";
import { redirect } from "next/navigation";
import { isPreConsentAccount } from "@hanbang/shared";

import { getOptionalSameOriginRedirectPath } from "@/lib/auth/safeRedirect";
import { createClient } from "@/lib/supabase/server";

import ConsentGateClient from "./ConsentGateClient";

// 이 화면은 **세션을 읽어야** 무엇을 보여줄지 정해진다. 정적 생성 대상이
// 아니다. 없으면 Next 가 빌드 때 프리렌더를 시도하고, 그 시점에는 Supabase
// 환경변수가 없어 "Your project's URL and Key are required" 로 **빌드 전체가
// 죽는다.** 실제로 이 PR 의 첫 Preview 빌드가 그렇게 죽었다.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "약관 동의 · 웨딩한방",
  robots: { index: false, follow: false },
};

const DEFAULT_DESTINATION = "/wedding/onboarding";

/**
 * 동의 기록이 없는 계정이 서는 자리.
 *
 * 여기 오는 사람은 대부분 **소셜 로그인으로 계정이 방금 만들어진 사람**이다.
 * Supabase 가 계정을 직접 만들기 때문에 가입 화면을 거치지 않았고, 따라서
 * 동의 화면을 본 적도 기록도 없다. 이메일 가입 이전에 만들어진 옛 계정도
 * 기록이 없어 한 번 이 화면을 본다.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 로그인하지 않은 사람에게 보여줄 것이 없다. 계정이 있어야 붙일 데가 있다.
  if (!user) redirect("/login");

  // 이미 동의한 사람을 붙잡아 두지 않는다. 뒤로가기로 돌아와도 통과시킨다.
  const raw = await searchParams;
  const requested = typeof raw.redirect === "string" ? raw.redirect : null;
  const destination = getOptionalSameOriginRedirectPath(
    requested,
    // 서버 컴포넌트에는 origin 이 없다. 같은 출처 판정에만 쓰이므로
    // 환경의 사이트 URL 을 기준으로 삼는다.
    process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai",
  ) ?? DEFAULT_DESTINATION;

  if (hasWebSignupConsentAccess(user)) {
    redirect(destination);
  }

  return (
    <ConsentGateClient
      destination={destination}
      existingAccount={isPreConsentAccount(user.created_at)}
    />
  );
}
