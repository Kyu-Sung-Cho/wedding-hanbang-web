import { Suspense } from "react";
import CommunityLandingClient from "@/components/community/CommunityLandingClient";
import { normalizeCommunityFeedQuery } from "@/lib/community/feedQuery";
import { getInitialCommunityFeed } from "@/lib/community/initialFeed";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "웨딩한방 커뮤니티 — 경험을 나누고 더 완벽한 결혼을 준비해요",
  description:
    "실제 후기, 견적 정보, 예산 팁, 동기부여 커뮤니티를 한 곳에서 확인하는 웨딩한방 커뮤니티.",
};

// 메인 페이지 = 커뮤니티. 마케팅 랜딩은 /landing으로 보존.
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialFeed = await getInitialCommunityFeed();

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fffdf7]" />}>
      <CommunityLandingClient
        initialFeed={initialFeed}
        initialQuery={normalizeCommunityFeedQuery(resolvedSearchParams)}
      />
    </Suspense>
  );
}
