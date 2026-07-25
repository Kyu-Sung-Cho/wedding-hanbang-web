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

export const metadata = {
  title: "웨딩한방 커뮤니티 — 결혼 준비 경험과 질문을 나눠요",
  description:
    "이용자가 남긴 경험 글, 견적 질문과 준비 이야기를 한 곳에서 확인하는 웨딩한방 커뮤니티.",
};

export default async function CommunityFeedPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialQuery = normalizeCommunityFeedQuery(resolvedSearchParams);
  const initialFeed = !isPreviewStubMode() && canUseServerInitialCommunityFeed(initialQuery)
    ? await loadSharedInitialFeed()
    : undefined;

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fffdf7]" />}>
      <CommunityLandingClient
        initialFeed={initialFeed}
        initialQuery={initialQuery}
      />
      <GuideOpenButton eventName="hanbang:open-community-guide" label="커뮤니티 이용 가이드 보기" />
      <CommunityGuide />
      <CommunityFirstVisitTour />
      <CommunityTutorial />
    </Suspense>
  );
}
