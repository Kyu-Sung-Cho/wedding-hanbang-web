import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { verifyDemoSessionToken } from "@/lib/demoSession";
import { isPreviewStubMode } from "@/lib/previewStub";
import { createClient } from "@/lib/supabase/server";

/**
 * `/wedding` 문.
 *
 * 2026-11-21 까지 이 주소는 커뮤니티 피드였다(`next.config.ts` 가 `/community` 로 리라이트).
 * 커뮤니티를 닫으면서(D-81) 2026-11-22 파운더 결정 7 에 따라 **로그인했으면 웨딩 라운지,
 * 아니면 랜딩**으로 보낸다. 로그인 여부를 요청마다 봐야 하므로 미리 만들 수 없다.
 *
 * - 로그인 판정은 `(app)/AuthenticatedAppShell.tsx` 와 같다. 체험(데모) 세션도 라운지를 연다.
 * - 로그아웃이면 `getUser()` 가 늘 "세션 없음" 오류를 내지만 그건 실패가 아니라 로그아웃이다.
 *   `user` 만 보고, 오류는 로그아웃과 같게 다룬다.
 * - 라운지의 동의·온보딩 관문은 미들웨어가 라운지 주소에서 그대로 건다. 여기서 다시 보지 않는다.
 * - 유입 표식(UTM 등)은 목적지까지 들고 간다. 루트 문(`app/page.tsx`)과 같은 방식이다.
 */
export const dynamic = "force-dynamic";

// 페이지 파일은 Next 가 정한 이름만 내보낼 수 있어서 상수를 내보내지 않는다.
const SIGNED_IN_DESTINATION = "/wedding/lounge";
const SIGNED_OUT_DESTINATION = "/landing";

type SearchParams = Record<string, string | string[] | undefined>;

function hasSupabaseConfig(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !url.includes("your-project"));
}

async function hasAppSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const isDemo = cookieStore.get("demo_mode")?.value === "true"
    && verifyDemoSessionToken(cookieStore.get("demo_session")?.value);
  if (isDemo) return true;
  // 미리보기 배포는 Supabase 값이 없게 설계돼 있다. 그때는 로그아웃으로 본다.
  if (isPreviewStubMode() || !hasSupabaseConfig()) return false;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return Boolean(user);
}

function forwardedQuery(searchParams: SearchParams | undefined): string {
  const params = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined) params.append(key, item);
      });
    } else if (value !== undefined) {
      params.set(key, value);
    }
  });
  return params.toString();
}

export default async function WeddingDoorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const destination = (await hasAppSession()) ? SIGNED_IN_DESTINATION : SIGNED_OUT_DESTINATION;
  const query = forwardedQuery(searchParams ? await searchParams : undefined);
  redirect(query ? `${destination}?${query}` : destination);
}
