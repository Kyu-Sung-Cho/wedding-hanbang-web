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
          // alt는 실제 이미지를 설명해야 한다. 이전 alt("둘이 나눈 대화를 예산,
          // 할 일, 일정으로 정리하는 웨딩한방")는 존재하지 않는 그림을 묘사했다 —
          // 실제 카드는 손을 맞잡고 걸어가는 두 사람 사진이다.
          // TODO(카드 교체 필요): 이 이미지에 박힌 문구 "축하의 온도와 기준의 정밀함"은
          // PRINCIPLES.md P5가 금지하는 정확성 보장 표현이고, 헤드라인
          // "우리, 정말 결혼하는구나."도 현재 랜딩의 기능적 약속과 다른 이전 방향이다.
          // 이미지 자체를 바꾸기 전에는 alt가 그 문구를 되풀이하지 않는다.
          alt: "손을 맞잡고 예식장으로 걸어가는 두 사람 — 웨딩한방 소개 카드",
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
