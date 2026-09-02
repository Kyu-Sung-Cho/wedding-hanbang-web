import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { SIGNUP_CONSENT_PATH, hasRecordedSignupConsent } from "@hanbang/shared";

import { verifyDemoSessionToken } from "@/lib/demoSession";
import { createClient } from "@/lib/supabase/server";

import AppClientLayout from "./AppClientLayout";
import DemoModeBanner from "./DemoModeBanner";

export default async function AuthenticatedAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const isDemo = cookieStore.get("demo_mode")?.value === "true"
    && verifyDemoSessionToken(cookieStore.get("demo_session")?.value);

  if (!isDemo) {
    // `getUser()` 는 던질 수 있다. 망가진 세션 쿠키를 디코딩하다 터지는 예외는
    // `AuthError` 가 아니라 그대로 밖으로 나온다(@/lib/supabase/authCookieRepair).
    // 그것을 그냥 올려보내면 화면 전체가 오류가 되는데, 세션을 확인하지 못한 것은
    // 오류 화면을 띄울 이유가 아니라 관문으로 돌려세울 이유다.
    //
    // redirect() 는 NEXT_REDIRECT 를 던져 흐름을 끊는 장치다. try 밖에 두어야
    // 이 catch 가 그것을 삼켜 500 으로 바꾸지 않는다.
    let user: User | null = null;
    try {
      const supabase = await createClient();
      user = (await supabase.auth.getUser()).data.user;
    } catch (error) {
      console.error("[app-shell] session lookup failed:", error);
    }

    if (!user) redirect("/login");
    // 콜백만 막으면 이미 세션을 들고 있는 사람이 주소로 바로 들어온다.
    // user_metadata 는 위 getUser() 에 이미 실려 오므로 추가 조회가 없다.
    if (!hasRecordedSignupConsent(user.user_metadata)) redirect(SIGNUP_CONSENT_PATH);
  }

  return (
    <AppClientLayout
      banner={isDemo ? <DemoModeBanner /> : null}
      initialDemo={isDemo}
    >
      {children}
    </AppClientLayout>
  );
}
