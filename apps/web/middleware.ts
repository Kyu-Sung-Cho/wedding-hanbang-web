import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js root middleware — 보호 경로 server-side 인증 가드.
 *
 * 이전엔 이 파일이 없어서 /dashboard, /chat, /budget 등 보호 경로에 서버 측
 * 게이트가 없었음 (클라이언트 사이드 가드만 존재). JS 비활성/직접 fetch 시
 * 게이트 우회 가능. 이번에 루트 middleware.ts 추가로 lib/supabase/middleware.ts
 * 의 updateSession 을 실제 모든 요청에 wire-up.
 *
 * matcher: Next 정적 자산·favicon·API auth callback 제외.
 * updateSession 내부에서 isProtectedPath 로 다시 한 번 좁힌다 (공개 경로는 즉시 통과).
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Next 정적·favicon 만 제외. 나머지는 updateSession 내부의 isProtectedPath 로 다시
  // 좁힘. 정규식 단순화 — 복잡한 negative lookahead 가 Next 16 Turbopack 빌드의
  // nft.json (Node File Trace) 생성에 문제를 일으키는 케이스가 있음.
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
