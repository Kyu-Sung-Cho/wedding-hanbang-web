import { hasWebSignupConsentAccess } from "@/lib/auth/signupConsentAccess";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SIGNUP_CONSENT_PATH } from "@hanbang/shared";

import { verifyDemoSessionToken } from "@/lib/demoSession";
import { createClient } from "@/lib/supabase/server";
import { isConfirmedSignedOut } from "@/lib/auth/sessionFailure";

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
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser()
      .catch((error: unknown) => ({ data: { user: null }, error }));
    // 일시 장애는 로그인 만료가 아니다. 기존 오류 화면에서 안전하게 다시 확인한다.
    if (authError && !isConfirmedSignedOut(authError)) {
      throw new Error("로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    if (!user || authError) redirect("/login");
    // 콜백만 막으면 이미 세션을 들고 있는 사람이 주소로 바로 들어온다.
    // user_metadata 는 위 getUser() 에 이미 실려 오므로 추가 조회가 없다.
    if (!hasWebSignupConsentAccess(user)) redirect(SIGNUP_CONSENT_PATH);
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
