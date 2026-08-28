import type { Metadata } from "next";

import AvailableNowSection from "@/components/landing/redesign/AvailableNowSection";
import ClosingAction from "@/components/landing/redesign/ClosingAction";
import ConfirmSection from "@/components/landing/redesign/ConfirmSection";
import LandingFooter from "@/components/landing/redesign/LandingFooter";
import LandingHeader from "@/components/landing/redesign/LandingHeader";
import AmoraNoteSection from "@/components/landing/redesign/AmoraNoteSection";
import LandingBloomLayer from "@/components/landing/redesign/LandingBloomLayer";
import BoundariesSection from "@/components/landing/redesign/BoundariesSection";
import PriceCompareSection from "@/components/landing/redesign/PriceCompareSection";
import TransformationHero from "@/components/landing/redesign/TransformationHero";

export const revalidate = 86_400;

/**
 * 제목은 두 가지를 동시에 진다. 앞은 이 페이지가 파는 약속이고, 뒤는 검색 결과에서
 * 우리를 구분해 주는 것이다.
 *
 * 2026-08-27 에 바꿨다. 이전 제목은 "공시된 가격·위약금 원문" 을 차별점으로 걸었는데,
 * 그건 한국소비자원 참가격이라 **공개 자료**다. 누구나 볼 수 있는 것을 우리 차별점으로
 * 걸 수 없다. 우리만 할 수 있는 것은 **두 사람의 대화를 한 덩어리로 읽는 것**이다
 * (`api/chat/route.ts:1889` — couple_id 로 읽고 sender_id 필터가 없다).
 *
 * 루트 폴백과 **같은 문자열**이어야 한다. 여기를 고치면 `src/app/page.tsx` 의
 * title 도 같이 고친다. 두 곳이 검사한다:
 *
 *   `components/community/__tests__/landingFunnelInstrumentation.test.ts`  ← 정본
 *   `__tests__/landingTitleParity.test.ts`                                 ← canonical·sitemap 까지
 *
 * (2026-08-27에 앞의 것을 "저장소에 없다"고 잘못 판단해 뒤의 것을 새로 만들었다.
 * 파일 **내용**만 grep 했는데 그 파일은 자기 이름을 안 들고 있었다 — 파일 이름도
 * 같이 찾아야 한다. 둘 다 남긴 이유는 추출 방식이 달라 서로의 사각지대를 덮기 때문이다.)
 */
export function generateMetadata(): Metadata {
  // 상수를 이 함수 **안에** 둔다. 밖으로 빼면
  // `components/community/__tests__/landingFunnelInstrumentation.test.ts` 의 추출기
  // (`generateMetadata … const title = "…"`)가 못 읽어 제목을 빈 문자열로 보고,
  // 루트 폴백과의 동일성 검사가 조용히 무의미해진다. 실제로 그렇게 됐었다.
  const title = "웨딩한방 | 결혼 준비, 둘이 어디서 갈리는지부터";
  const description =
    "결혼 준비에서 싸우는 건 가격 때문이 아니라 둘의 기준이 다른 걸 몰라서예요. "
    + "스무 장면에 각자 답하면 어디서 갈렸는지 나란히 볼 수 있어요. 가입 없이 지금 열려 있어요.";

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
 * 랜딩 — 결혼 준비 노트.
 *
 * ## 섹션 순서에 이유가 있다
 *
 *   히어로   둘의 기준이 다른 걸 몰라서 싸운다        ← 자기 얘기로 읽히는 문장
 *   ①        장면 하나를 보여주고 만지게 한다          ← 로그인 없이 되는 유일한 후크
 *   ②        편을 들지 않는다                          ← "ChatGPT 로 되잖아" 를 먼저 받는다
 *   ③        같은 얘기를 두 번 안 해도 된다            ← 제일 큰 차별점
 *   ④        나만 보는 자리                            ← ③ 이 만든 걱정을 바로 받는다
 *   ⑤        확인한 것만 남는다                        ← 대화가 어디로 가는지
 *   ⑥        업체 편이 아니다                          ← 공시 가격은 여기 곁블록 한 줄
 *   ⑦        가입 없이 지금 되는 것                    ← 빈손으로 나가지 않게
 *   마무리   첫 화면과 같은 행동을 부른다
 *
 * ④ 를 ③ 앞으로 옮기지 마라. ③ 이 "두 사람 대화가 한 덩어리" 라고 말한 직후에
 * 사람들은 "그럼 내가 쓴 게 다 가나" 를 걱정한다. 그 걱정을 다음 섹션이 받지 않으면
 * ③ 이 불안으로 끝난다.
 */
export default function LandingPage() {
  return (
    // `relative` 는 꽃 레이어(`LandingBloomLayer`)의 기준점이다. 빼면 꽃이 화면
    // 기준으로 붙어 스크롤해도 따라다닌다. `overflow-hidden` 은 여백 밖으로 나간
    // 가지가 가로 스크롤을 만들지 않게 한다.
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-paper-sheet)] text-[var(--color-paper-ink)]">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-[6px] bg-[var(--color-paper-card)] px-5 py-3 text-[14px] font-semibold text-[var(--color-paper-ink)] shadow-raised transition-transform duration-200 motion-reduce:transition-none focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[var(--color-paper-pen)] focus:ring-offset-2"
      >
        본문 바로가기
      </a>
      {/* 여백의 꽃. 페이지 전체에 걸친다 — 시안 배치 그대로. */}
      <LandingBloomLayer />
      <LandingHeader />
      <main id="main-content" tabIndex={-1}>
        {/* 정본 시안 `웨딩한방-랜딩시안/NotebookBest.html` 의 순서다.
            보여 주고(히어로·아모라 노트) → 증거를 놓고(위약금 비교) →
            지금 할 수 있는 것을 주고 → 계정에서 달라지는 것을 말하고 →
            하지 않는 것을 밝히고 → 한 가지만 정하자고 끝낸다. */}
        <TransformationHero />
        <AmoraNoteSection />
        <PriceCompareSection />
        <AvailableNowSection />
        <ConfirmSection />
        <BoundariesSection />
        <ClosingAction />
      </main>
      <LandingFooter />
    </div>
  );
}
