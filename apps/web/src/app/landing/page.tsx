import type { Metadata } from "next";

import AvailableNowSection from "@/components/landing/redesign/AvailableNowSection";
import ClosingAction from "@/components/landing/redesign/ClosingAction";
import CommunityBridgeSection from "@/components/landing/redesign/CommunityBridgeSection";
import ContinuitySection from "@/components/landing/redesign/ContinuitySection";
import LandingFooter from "@/components/landing/redesign/LandingFooter";
import LandingHeader from "@/components/landing/redesign/LandingHeader";
import PreparationResult from "@/components/landing/redesign/PreparationResult";
import ProblemMirrorSection from "@/components/landing/redesign/ProblemMirrorSection";
import SharedPrivateSection from "@/components/landing/redesign/SharedPrivateSection";
import TransformationHero from "@/components/landing/redesign/TransformationHero";
import TrustEvidenceSection from "@/components/landing/redesign/TrustEvidenceSection";

export const revalidate = 86_400;

/**
 * 한국소비자원 공개 자료와 실제 화면의 공시 규모를 맞춘다.
 * 분기 자료 갱신 전에는 `pnpm audit:production`으로 실제 수치를 먼저 확인한다.
 * `scripts/tests/disclosure-count-consistency.test.mjs`가 다른 공개 화면과의 일치를 검사한다.
 */
/**
 * 업체 수는 커뮤니티 첫 화면(`CommunityLandingClient`)과 **같은 값이어야 한다** —
 * 위 정합성 테스트가 두 화면을 대조한다. 다른 브랜치에서 414로 옮겨 적었다가
 * 그 테스트가 실패했다(`업체 수 불일치: 서비스 랜딩 414 vs 첫 화면 412`).
 * 근거 없는 수를 옮겨 적지 않고, `pnpm audit:production` 실측값만 쓴다.
 * 2026-08-08 재측정으로 412 → 406(신원 규칙에 병합 11쌍·지점 25건·사본 1건 추가).
 * 바꾸려면 두 화면과 실측 날짜를 함께 바꾼다.
 */
const PUBLISHED_POLICY_COUNT = 831;
const PUBLISHED_VENDOR_COUNT = 406;
const PUBLISHED_COUNTS_VERIFIED_AT = "2026.08.08";

export function generateMetadata(): Metadata {
  // 제목은 두 가지를 동시에 져야 한다. 앞은 이 페이지가 파는 약속(둘이 말하면
  // 정리된다)이고, 뒤는 검색 결과에서 우리를 구분해 주는 유일한 사실이다 —
  // 공시된 가격·위약금 원문은 다른 곳에 없다. `landingFunnelInstrumentation`이
  // 첫 화면 셋 모두에 이 차별점을 강제하고, 루트 폴백과 같은 문자열일 것도
  // 요구한다(리다이렉트가 안 걸리는 환경에서 제목이 갈리지 않게).
  // 여기를 고치면 `src/app/page.tsx`의 title도 같이 고쳐야 한다.
  const title = "웨딩한방 | 둘이 말하면 결혼 준비가 정리돼요 · 공시된 가격·위약금 원문";
  const description =
    "웨딩한방은 둘이 함께 관리하는 결혼 준비 공간이에요. 계정 베타에서는 대화 정리 AI 아모라가 한 번에 한 가지 변경을 제안하고, 확인한 변경만 준비 기록에 반영해요.";

  return {
    title,
    description,
    alternates: { canonical: "/landing" },
    // openGraph.images / twitter.images를 여기 적지 않는다. 같은 폴더의
    // `opengraph-image.tsx`가 파일 규약으로 카드를 만들고, 여기서 images를
    // 명시하면 그 규약이 덮인다(start-here도 같은 방식).
    openGraph: {
      title,
      description,
      url: "/landing",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FBF8F2] text-[#243832]">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-full bg-[#FBF8F2] px-5 py-3 text-[14px] font-semibold text-[#243832] shadow-raised transition-transform duration-200 motion-reduce:transition-none focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[#8F6662] focus:ring-offset-2"
      >
        본문 바로가기
      </a>
      <LandingHeader />
      <main id="main-content" tabIndex={-1}>
        <TransformationHero />
        <ProblemMirrorSection />
        {/* 문제를 보여준 직후에 "지금 당장 무료로 이만큼 된다"를 둔다.
            아래 섹션들은 대부분 계정 베타(미제공)를 설명하므로, 그 전에
            오늘 쓸 수 있는 것을 먼저 세워야 처음 온 사람이 빈손으로 읽지 않는다. */}
        <AvailableNowSection />
        <PreparationResult />
        <ContinuitySection />
        <SharedPrivateSection />
        <CommunityBridgeSection />
        <TrustEvidenceSection
          publishedPolicyCount={PUBLISHED_POLICY_COUNT}
          publishedVendorCount={PUBLISHED_VENDOR_COUNT}
          countsVerifiedAt={PUBLISHED_COUNTS_VERIFIED_AT}
        />
        <ClosingAction />
      </main>
      <LandingFooter />
    </div>
  );
}
