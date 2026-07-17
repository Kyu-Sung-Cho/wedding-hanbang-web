import { Suspense } from "react";
import CommunityLandingClient from "@/components/community/CommunityLandingClient";
import CommunityGuide from "@/components/community/CommunityGuide";
import CommunityTutorial from "@/components/community/CommunityTutorial";
import GuideOpenButton from "@/components/common/GuideOpenButton";
import { getInitialCommunityFeed } from "@/lib/community/initialFeed";
import { canUseServerInitialCommunityFeed, normalizeCommunityFeedQuery } from "@/lib/community/feedQuery";
import { isPreviewStubMode } from "@/lib/previewStub";

export const dynamic = "force-dynamic";

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
    ? await getInitialCommunityFeed(10)
    : undefined;

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fffdf7]" />}>
      <CommunityLandingClient
        initialFeed={initialFeed}
        initialQuery={initialQuery}
      />
      <GuideOpenButton eventName="hanbang:open-community-guide" label="커뮤니티 이용 가이드 보기" />
      <CommunityGuide />
      <CommunityTutorial />
    </Suspense>
  );
}
