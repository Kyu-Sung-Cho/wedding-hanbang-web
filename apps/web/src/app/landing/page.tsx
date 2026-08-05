import type { Metadata } from "next";

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
const PUBLISHED_POLICY_COUNT = 831;
const PUBLISHED_VENDOR_COUNT = 414;
const PUBLISHED_COUNTS_VERIFIED_AT = "2026.08.04";

export function generateMetadata(): Metadata {
  const title = "웨딩한방 | 둘이 말하면 결혼 준비가 정리돼요";
  const description =
    "웨딩한방은 둘이 함께 관리하는 결혼 준비 공간이에요. 계정 베타에서는 대화 정리 AI 아모라가 한 번에 한 가지 변경을 제안하고, 확인한 변경만 준비 기록에 반영해요.";

  return {
    title,
    description,
    alternates: { canonical: "/landing" },
    openGraph: {
      title,
      description,
      url: "/landing",
      type: "website",
      images: [
        {
          url: "/images/landing-social-card.webp",
          width: 1200,
          height: 630,
          alt: "둘이 나눈 대화를 예산, 할 일, 일정으로 정리하는 웨딩한방",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/images/landing-social-card.webp"],
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
