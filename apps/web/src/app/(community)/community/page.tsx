import { Suspense } from "react";
import CommunityLandingClient from "@/components/community/CommunityLandingClient";
import CommunityGuide from "@/components/community/CommunityGuide";
import CommunityTutorial from "@/components/community/CommunityTutorial";
import GuideOpenButton from "@/components/common/GuideOpenButton";
import { getInitialCommunityFeed } from "@/lib/community/initialFeed";
import { canUseServerInitialCommunityFeed, normalizeCommunityFeedQuery } from "@/lib/community/feedQuery";
import { createClient } from "@/lib/supabase/server";
import type { InitialCommunityFeedResult } from "@/types/community.types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "웨딩한방 커뮤니티 — 경험을 나누고 결혼 준비를 정리해요",
  description:
    "이용자가 공유한 후기와 견적 경험, 예산 팁을 한 곳에서 확인하는 웨딩한방 커뮤니티.",
};

export default async function CommunityFeedPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialQuery = normalizeCommunityFeedQuery(resolvedSearchParams);
  let initialFeed: InitialCommunityFeedResult | undefined;

  if (canUseServerInitialCommunityFeed(initialQuery)) {
    // The fast SSR seed uses an anonymous public client, so it cannot know an
    // account's private author mutes. Signed-in readers wait for the scoped API
    // response instead of briefly seeing content they explicitly hid.
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (!authError && !user) {
      initialFeed = await getInitialCommunityFeed(10);
    }
  }

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
