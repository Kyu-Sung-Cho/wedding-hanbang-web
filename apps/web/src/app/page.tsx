import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export const metadata = {
  // 이 폴백과 실제 착지 랜딩의 제목이 갈리면 유입 경로마다 다른 제목이 보인다.
  // `src/app/landing/page.tsx`의 title과 **글자까지 같아야** 하고,
  // `landingFunnelInstrumentation`이 그 동일성을 검사한다.
  title: "웨딩한방 | 둘이 말하면 결혼 준비가 정리돼요 · 공시된 가격·위약금 원문",
  description:
    "업체가 공시한 스드메·예식장 기본가와 추가금, 취소 위약금 규정을 원문 그대로 봅니다. "
    + "예산·일정·업체 준비는 AI 아모라가 같이 잡습니다. 요약도, 어디가 낫다는 판정도 하지 않습니다.",
};

/**
 * 루트는 **앱의 문**이다 — 세션이 있으면 앱으로, 없으면 로그인으로.
 *
 * ## 이 파일은 폴백이다
 *
 * 평소에는 여기까지 오지 않는다. 미들웨어(`lib/supabase/middleware.ts`의
 * `redirectAppDoor`)가 같은 판정을 먼저 하고 **307**로 돌려보낸다. 판정을 거기에 둔
 * 이유는, 여기서 `redirect()`를 하면 세션을 물어보는 사이 응답이 이미 스트리밍으로
 * 나가기 시작해서 브라우저에 `200 + HTML`이 도착하기 때문이다 — 사람 눈에는 같아
 * 보여도 크롤러에게는 리다이렉트가 아니고, 아래 폴백 문서가 한 번 깜빡인다.
 *
 * 그래도 이 판정을 남겨두는 건 Supabase 설정이 없어 미들웨어가 그냥 통과시키는
 * 환경 때문이다. 두 곳의 결론은 **항상 같아야 한다.**
 *
 * ## 왜 랜딩이 아니라 로그인인가
 *
 * 2026-08-20 파운더 결정이다. 앱의 첫 화면이 로그인인 것과 웹의 첫 화면이 소개
 * 페이지인 것이 달라서, "처음 열면 로그인이 뜬다"는 제품의 약속이 웹에서만 거짓이었다.
 *
 * 그전에는 `next.config.ts`가 엣지에서 `/` → `/landing`으로 보냈다. 엣지 리다이렉트는
 * 세션을 볼 수 없어서, 이미 로그인한 사람도 매번 소개 페이지를 지나 다시 앱으로
 * 들어가야 했다. 여기서 판정하면 그 왕복이 사라진다.
 *
 * ## 랜딩은 없어지지 않았다
 *
 * `/landing`은 그대로 있고 sitemap과 canonical이 처음부터 그 주소를 가리킨다
 * (`app/sitemap.ts`, `app/landing/page.tsx`의 alternates). 그래서 검색 유입은
 * 루트가 아니라 랜딩으로 들어온다 — 이 변경으로 잃는 색인 자리가 없다.
 *
 * 다만 **광고·외부 링크가 도메인 루트를 가리키고 있다면 그건 이제 로그인으로 떨어진다.**
 * 서비스를 설명해야 하는 링크는 `/landing`을 직접 가리켜야 한다.
 *
 * ## 온보딩 여부는 여기서 보지 않는다
 *
 * 세션이 있으면 라운지로 보내고, 온보딩을 아직 안 마쳤으면 미들웨어가 그 자리에서
 * 온보딩으로 돌린다(`lib/supabase/middleware.ts`). 여기서 프로필까지 읽으면 같은
 * 판정을 두 곳에서 하게 되고, 두 판정이 갈리는 날 사람이 두 화면 사이에 갇힌다.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const params = new URLSearchParams();

  Object.entries(resolvedSearchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined) params.append(key, item);
      });
    } else if (value !== undefined) {
      params.set(key, value);
    }
  });

  // 세션을 못 물어보는 환경(설정 누락 등)에서는 로그인으로 보낸다. 로그인 화면은
  // 누구에게나 열려 있고, 거기서 다시 앱으로 들어갈 수 있다.
  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }

  const destination = signedIn ? "/wedding/lounge" : "/login";
  // UTM 같은 유입 표식은 목적지까지 들고 간다 — 루트에서 끊기면 어디서 왔는지 사라진다.
  const query = params.toString();
  redirect(query ? `${destination}?${query}` : destination);
}
