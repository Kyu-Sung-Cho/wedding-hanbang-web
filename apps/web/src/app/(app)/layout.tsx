import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import AppClientLayout from "./AppClientLayout";

/**
 * (app) 그룹 서버 컴포넌트 가드.
 *
 * Next 16 + Turbopack + Vercel 모노레포에서 root middleware deploy 가 실패하는
 * 버그가 있어, 보호 라우트는 layout 서버 컴포넌트에서 인증 체크하도록 변경.
 *
 * - 비인증 → /login 으로 redirect (서버 사이드)
 * - 데모 모드 (demo_mode 쿠키) → 통과 허용
 * - 인증 OK → AppClientLayout 으로 렌더링 위임
 *
 * 이전엔 클라이언트 사이드 가드만 있어서 JS 우회 시 보호 라우트 접근 가능.
 * 이제 서버에서 user 검증 후 응답하므로 직접 fetch / JS 비활성 환경에서도 안전.
 */
export default async function AppServerGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const isDemo = cookieStore.get("demo_mode")?.value === "true";

  // 데모 모드는 인증 우회 (기존 middleware 와 동일 정책)
  if (!isDemo) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/login");
    }
  }

  return <AppClientLayout>{children}</AppClientLayout>;
}
