import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import CommunityLandingClient from "@/components/community/CommunityLandingClient";
import CommunityGuide from "@/components/community/CommunityGuide";
import CommunityFirstVisitTour from "@/components/community/CommunityFirstVisitTour";
import CommunityTutorial from "@/components/community/CommunityTutorial";
import GuideOpenButton from "@/components/common/GuideOpenButton";
import { getInitialCommunityFeed } from "@/lib/community/initialFeed";
import { canUseServerInitialCommunityFeed, normalizeCommunityFeedQuery } from "@/lib/community/feedQuery";
import { isPreviewStubMode } from "@/lib/previewStub";
import { EMPTY_AGENCY_SPREAD_SUMMARY } from "@/lib/price/agencySpread";
import { loadLandingAgencySpread } from "@/lib/price/landingAgencySpread";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 첫 화면은 방문자마다 같은 공개 글 10개를 본다. 그런데 force-dynamic이라
// 방문 때마다 Supabase를 새로 쳐서 TTFB가 1.06초였다(2026-07-25 실측).
// 결과를 60초 단위로 공유 캐시해 첫 화면 대기를 없앤다 — 새 글은 최대 1분
// 늦게 보이지만, 목록 아래 무한스크롤과 작성 후 이동은 모두 클라이언트
// 경로라 글쓴이 본인은 즉시 확인할 수 있다.
const loadSharedInitialFeed = unstable_cache(
  () => getInitialCommunityFeed(10),
  ["community-initial-feed-v1"],
  { revalidate: 60, tags: ["community-initial-feed"] },
);

// 공시는 분기마다 갱신된다. 매 방문마다 수천 행을 다시 훑을 이유가 없어 하루
// 단위로 공유 캐시한다 — /price 허브의 revalidate와 같은 주기다.
const loadSharedAgencySpread = unstable_cache(
  () => loadLandingAgencySpread(),
  ["community-agency-spread-v1"],
  { revalidate: 86_400, tags: ["price-catalog"] },
);

export const metadata = {
  title: "웨딩한방 — 결혼 준비를 아모라와 정리하세요",
  description:
    "아모라에게 결혼 준비를 말하면 예산·체크리스트·일정이 함께 정리됩니다. "
    + "실제 경험이 필요할 때는 예비부부 커뮤니티에서 찾아보고 질문하세요.",
  alternates: { canonical: "/wedding" },
  // Next 메타데이터는 openGraph를 **통째로 교체**한다. 여기서 images를 적지 않으면
  // 루트 layout.tsx의 `/images/og-image.png` 폴백이 상속되지 않고 사라진다 —
  // 실제로 /wedding의 렌더된 head에 og:image·twitter:image가 0개였다. 같은 구조인
  // quote-check/layout.tsx는 images를 다시 적어 두어 카드가 살아 있다.
  // /wedding은 sitemap에서 /landing과 동급(priority 1.0)인 앱 입구이고,
  // 사용자가 서로에게 실제로 던지는 링크라 카드 없는 공유는 그대로 노출된다.
  openGraph: {
    title: "웨딩한방 — 결혼 준비를 아모라와 정리하세요",
    description:
      "아모라에게 결혼 준비를 말하면 예산·체크리스트·일정이 함께 정리됩니다.",
    url: "/wedding",
    type: "website",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 아모라" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "웨딩한방 — 결혼 준비를 아모라와 정리하세요",
    description:
      "아모라에게 결혼 준비를 말하면 예산·체크리스트·일정이 함께 정리됩니다.",
    images: ["/images/og-image.png"],
  },
};

export default async function CommunityFeedPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialQuery = normalizeCommunityFeedQuery(resolvedSearchParams);
  const previewStub = isPreviewStubMode();
  const viewerResult = previewStub
    ? null
    : await (await createClient()).auth.getUser();
  const confirmedAnonymous = Boolean(
    viewerResult && !viewerResult.error && !viewerResult.data.user,
  );

  // 피드와 공시 요약은 서로를 기다릴 이유가 없다 — 직렬로 두면 첫 화면 대기가 합쳐진다.
  const [initialFeed, agencySpread] = await Promise.all([
    confirmedAnonymous && canUseServerInitialCommunityFeed(initialQuery)
      ? loadSharedInitialFeed()
      : undefined,
    previewStub ? EMPTY_AGENCY_SPREAD_SUMMARY : loadSharedAgencySpread(),
  ]);

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fffdf7]" />}>
      <CommunityLandingClient
        initialFeed={initialFeed}
        initialQuery={initialQuery}
        agencySpread={agencySpread}
      />
      <GuideOpenButton eventName="hanbang:open-community-guide" label="커뮤니티 이용 가이드 보기" />
      <CommunityGuide />
      <CommunityFirstVisitTour />
      <CommunityTutorial />
    </Suspense>
  );
}
