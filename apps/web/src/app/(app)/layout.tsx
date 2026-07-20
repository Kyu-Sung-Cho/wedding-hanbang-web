import AuthenticatedAppShell from "./AuthenticatedAppShell";

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
  return <AuthenticatedAppShell>{children}</AuthenticatedAppShell>;
}
