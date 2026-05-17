import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js root middleware — 보호 경로 server-side 인증 가드.
 *
 * Runtime note: Next 16 + Turbopack + Vercel 모노레포 조합에서 Edge middleware 의
 * .nft.json (Node File Trace) 파일이 생성되지 않아 deploy 실패하는 버그가 있음.
 * 회피책: `runtime: 'nodejs'` 로 명시. Node 런타임은 nft.json 정상 생성.
 * (next.config.ts 에 experimental.nodeMiddleware: true 같이 설정 필요)
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
  runtime: "nodejs",
};
