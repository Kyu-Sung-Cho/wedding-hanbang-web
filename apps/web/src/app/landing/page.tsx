import type { Metadata } from "next";

import ClosingSection from "@/components/landing/redesign/ClosingSection";
import LandingFooter from "@/components/landing/redesign/LandingFooter";
import LandingHeader from "@/components/landing/redesign/LandingHeader";
import LandingSkipLink from "@/components/landing/redesign/LandingSkipLink";
import PromiseSection from "@/components/landing/redesign/PromiseSection";
import StartScreen from "@/components/landing/redesign/StartScreen";
import StepsSection from "@/components/landing/redesign/StepsSection";
import TodaySection from "@/components/landing/redesign/TodaySection";
import WideScreenSection from "@/components/landing/redesign/WideScreenSection";

export const revalidate = 86_400;


export function generateMetadata(): Metadata {
  // 상수를 이 함수 **안에** 둔다. 밖으로 빼면
  // `components/community/__tests__/landingFunnelInstrumentation.test.ts` 의 추출기
  // (`generateMetadata … const title = "…"`)가 못 읽어 제목을 빈 문자열로 보고,
  // 루트 폴백과의 동일성 검사가 조용히 무의미해진다. 실제로 그렇게 됐었다.
  // 검색 제목은 서비스명과 준비 목적을 설명하고, 공유 이미지의 문구는 H1 정본을 따른다.
  const title = "웨딩한방 | 둘이 함께하는 결혼 준비";
  const description =
    "결혼 준비, 뭐부터 할까요? 아모라와 고민을 정리하고, 직접 확인한 예산·할 일·일정을 파트너와 함께 관리하세요. "
    // 2026-11-22: "와 웨딩코드"를 뺐다. 웨딩코드를 내렸다(2026-11-21 파운더 결정). 루트 폴백과 같은 문장이다.
    + "견적 질문 만들기는 가입 없이 시작할 수 있어요.";

  return {
    title,
    description,
    alternates: { canonical: "/landing" },
    // openGraph.images / twitter.images 를 여기 적지 않는다. 같은 폴더의
    // `opengraph-image.tsx` 가 파일 규약으로 카드를 만들고, 여기서 images 를
    // 명시하면 그 규약이 덮인다.
    openGraph: {
      title: title,
      description: description,
      url: "/landing",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: title,
      description: description,
    },
  };
}


/**
 * 랜딩 — 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)의 '시작' 화면.
 *
 * 첫 화면은 시작 화면 한 장이다(`StartScreen`). 머리줄은 사진 위 오른쪽 위의 로그인 알약 하나다
 * (`LandingHeader`) — 아티팩트에 없는 것을 첫 화면에 더 얹지 않는다.
 *
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다")으로 첫 화면 아래에 같은
 * 디자인의 섹션이 이어진다: 오늘 하는 일(화면 예시) → 시작하는 법 → 아모라가 일하는 방식 → 넓은 화면 →
 * 마무리. 웨딩홀 비교와 상담 문의는 운영에 아직 열리지 않아 "곧 열려요" 꼬리표와 함께만 나온다.
 * 맨 아래는 법·신뢰 고지와 링크를 담은 조용한 바닥글이다(`LandingFooter`).
 *
 * 래퍼에 overflow 를 걸지 않는다. 자르는 일은 시작 화면이 자기 상자에서 한다.
 */
export default function LandingPage() {
  return (
    <div className="relative bg-inv-paper">
      <LandingSkipLink />
      <LandingHeader />
      <main id="main-content" tabIndex={-1}>
        <StartScreen />
        <TodaySection />
        <StepsSection />
        <PromiseSection />
        <WideScreenSection />
        <ClosingSection />
      </main>
      <LandingFooter />
    </div>
  );
}
