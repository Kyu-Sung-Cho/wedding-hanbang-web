import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
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
import { cookieHeaderHasAuthCredential } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

// 첫 화면은 방문자마다 같은 공개 글 10개를 본다. 그런데 force-dynamic이라
// 방문 때마다 Supabase를 새로 쳐서 TTFB가 1.06초였다(2026-07-25 실측).
// 결과를 60초 단위로 공유 캐시해 첫 화면 대기를 없앤다 — 새 글은 최대 1분
// 늦게 보이지만, 목록 아래 무한스크롤과 작성 후 이동은 모두 클라이언트
// 경로라 글쓴이 본인은 즉시 확인할 수 있다.
const cachedInitialFeed = unstable_cache(
  () => getInitialCommunityFeed(10),
  ["community-initial-feed-v1"],
  { revalidate: 60, tags: ["community-initial-feed"] },
);

/**
 * `getInitialCommunityFeed`는 읽기 실패도 빈 피드로 돌려준다. 그 값이 공유 캐시에
 * 박히면 일시적 장애가 "커뮤니티에 글이 없음"으로 굳는다 — 무효화하는 코드가 이
 * 저장소에 없어서 스스로 풀리지도 않는다.
 *
 * 그래서 빈 결과는 캐시를 믿지 않고 한 번 더 직접 읽는다. 진짜로 0건이면 두 번째
 * 읽기도 0건이라 결과가 같고, 장애였다면 회복된 순간 바로 정상으로 돌아온다.
 * 추가 조회는 피드가 비어 있을 때만 일어난다.
 */
const loadSharedInitialFeed = async () => {
  const cached = await cachedInitialFeed();
  if (cached.posts.length > 0) return cached;
  return getInitialCommunityFeed(10);
};

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
  openGraph: {
    title: "웨딩한방 — 결혼 준비를 아모라와 정리하세요",
    description:
      "아모라에게 결혼 준비를 말하면 예산·체크리스트·일정이 함께 정리됩니다.",
    url: "/wedding",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "웨딩한방 — 결혼 준비를 아모라와 정리하세요",
    description:
      "아모라에게 결혼 준비를 말하면 예산·체크리스트·일정이 함께 정리됩니다.",
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
  // 로그아웃 방문자에게 getUser()는 늘 "세션 없음" 오류를 낸다. 그 오류를
  // 그대로 "확인 실패"로 읽으면 비로그인 방문자에게는 서버 초기 피드를 아예
  // 만들지 않아 첫 화면이 언제나 "최근 글 0개"가 된다(2026-08-20 운영 실측:
  // DB와 API는 17개를 주는데 화면만 0개였다). 자격 증명을 실제로 제시한
  // 요청만 확인 실패로 다룬다 — 커뮤니티 API 라우트와 같은 기준이다.
  const presentedCredential = cookieHeaderHasAuthCredential(
    (await headers()).get("cookie"),
  );
  const confirmedAnonymous = Boolean(
    viewerResult
      && !viewerResult.data.user
      && (!viewerResult.error || !presentedCredential),
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
