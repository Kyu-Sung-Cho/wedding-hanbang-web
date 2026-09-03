import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * 로그인 여부로 갈라지므로 요청마다 판정한다 — 정적으로 미리 만들 수 없다.
 * 자세한 이유는 `(community)/layout.tsx` 의 같은 선언 주석에 적었다.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  // 이 폴백과 실제 착지 랜딩의 제목이 갈리면 유입 경로마다 다른 제목이 보인다.
  // `src/app/landing/page.tsx`의 title과 **글자까지 같아야** 한다.
  // `components/community/__tests__/landingFunnelInstrumentation.test.ts`(정본)와
  // `app/landing/__tests__/landingTitleParity.test.ts`가 함께 검사한다.
  title: "웨딩한방 | 둘이 하는 결혼 준비, 아모라와",
  // 2026-08-27: 이전 설명은 "예산·일정·**업체 준비**는 AI 아모라가 같이 잡습니다" 였다.
  // 업체 준비는 우리가 하지 않는다 — 업체를 찾아주지도 예약을 잡지도 않는다.
  // 라이브 메타 설명이 제품 계약과 어긋나 있었다.
  description:
    "예산, 하객, 부모님 의견. 둘이 갈리는 것부터 아모라와 하나씩 정해요. "
    + "확인한 것만 예산·할 일·일정에 남고, 바뀌면 파트너에게 알림이 가요. "
    + "비슷한 시기에 결혼하는 사람들의 기록도 함께 봐요.",
};

/**
 * 루트는 **앱의 문**이다 — 세션이 있으면 라운지로, 없으면 랜딩으로.
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
 * ## 로그아웃이면 랜딩, 로그인돼 있으면 라운지
 *
 * **2026-08-27 파운더 결정.** 도메인을 치고 들어오면 먼저 랜딩이 나와야 한다.
 *
 * ### 왜 바꿨나
 *
 * 2026-08-20에는 로그아웃이면 `/login`이었다. 이유는 "앱의 첫 화면이 로그인인데
 * 웹만 소개 페이지면 제품의 약속이 웹에서만 거짓"이라는 것이었다. 그런데 그 규칙이
 * 웹의 일과 어긋난다 — CLAUDE.md의 제품 계약은 **"모바일 앱이 소비자의 주 제품이고,
 * 웹은 유입·설명·정책·고객지원과 데스크톱 연속성을 담당한다"**고 정한다. 유입·설명이
 * 일인 표면의 정문이 로그인 벽이면 그 일을 할 수가 없다.
 *
 * 처음 온 사람에게 로그인부터 보여 주는 것은, 우리가 무엇인지 말하기 전에 계정부터
 * 달라는 것이다. 광고·외부 링크·입소문이 전부 도메인 루트를 가리키는데 거기가
 * 로그인이면, 설명을 한 번도 못 하고 사람을 잃는다.
 *
 * ### 8-20 결정이 막으려던 것은 그대로 막는다
 *
 * 그때의 진짜 문제는 **이미 로그인한 사람이 매번 소개 페이지를 지나 다시 앱으로
 * 들어가는 왕복**이었고, 그건 엣지 리다이렉트가 세션을 볼 수 없어서 생겼다.
 * 여기서는 세션을 보고 갈라서 로그인한 사람은 소개 페이지를 지나지 않는다.
 * 그래서 `next.config.ts`의 엣지 리다이렉트는 여전히 되살리면 안 된다 —
 * `__tests__/rootIsTheAppDoor.test.ts`가 그걸 계속 막는다.
 *
 * ### 색인
 *
 * canonical과 sitemap은 그대로 `/landing`을 가리킨다(`app/sitemap.ts`,
 * `app/landing/page.tsx`의 alternates). 루트는 307로 거기 보내므로 같은 내용이
 * 두 주소에 생기지 않는다.
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

  // 세션을 못 물어보는 환경(설정 누락 등)에서는 랜딩으로 보낸다. 랜딩은 누구에게나
  // 열려 있고 거기에 로그인 링크가 있다.
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

  const destination = signedIn ? "/wedding/lounge" : "/landing";
  // UTM 같은 유입 표식은 목적지까지 들고 간다 — 루트에서 끊기면 어디서 왔는지 사라진다.
  const query = params.toString();
  redirect(query ? `${destination}?${query}` : destination);
}
