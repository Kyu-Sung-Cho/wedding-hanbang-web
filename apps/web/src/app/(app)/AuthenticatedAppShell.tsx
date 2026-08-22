import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
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
