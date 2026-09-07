import type { Metadata } from "next";

import AvailableNowSection from "@/components/landing/redesign/AvailableNowSection";
import ClosingAction from "@/components/landing/redesign/ClosingAction";
import ConfirmSection from "@/components/landing/redesign/ConfirmSection";
import LandingFooter from "@/components/landing/redesign/LandingFooter";
import LandingHeader from "@/components/landing/redesign/LandingHeader";
import AmoraNoteSection from "@/components/landing/redesign/AmoraNoteSection";
import LandingBloomLayer from "@/components/landing/redesign/LandingBloomLayer";
import BoundariesSection from "@/components/landing/redesign/BoundariesSection";
import CommunitySection from "@/components/landing/redesign/CommunitySection";
import NoSideSection from "@/components/landing/redesign/NoSideSection";
import BlockedReasonsSection from "@/components/landing/redesign/BlockedReasonsSection";
import PhotoBandSection from "@/components/landing/redesign/PhotoBandSection";
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
  // 2026-09-03 시안으로 후크가 바뀌면서 같이 옮겼다. 제목은 히어로 테이프 이름표와
  // 같은 말이다 — 검색 결과에서 보는 한 줄과 첫 화면 맨 위 한 줄이 어긋나지 않게.
  const title = "웨딩한방 | 둘이 하는 결혼 준비, 아모라와";
  const description =
    "예산, 하객, 부모님 의견. 둘이 갈리는 것부터 아모라와 하나씩 정해요. "
    + "확인한 것만 예산·할 일·일정에 남고, 바뀌면 파트너에게 알림이 가요. "
    + "비슷한 시기에 결혼하는 사람들의 기록도 함께 봐요.";

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
 * 랜딩 — 2026-09-03 시안(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`).
 *
 * ## 섹션 순서 = 처음 온 사람이 던지는 질문의 순서
 *
 *   히어로      우리 둘이 뭘 원하는지부터
 *   ② 막히는 이유   "왜 자꾸 막히지?"        ← 문제를 커플의 말로 인용
 *   ③ 아모라        "그래서 뭘 해주는데?"    ← 설명 대신 대화 한 장면
 *   ④ 편 안 듦      "한쪽 편들면 어떡해?"
 *   ⑤ 확인          "내 계획을 마음대로 바꾸나?"
 *   ⑥ 무료 도구     "가입 전에 뭘 해볼 수 있어?"
 *   ⑦ 커뮤니티      "우리 같은 사람들은 뭘 하지?"  ← 제품 계약 둘째 축
 *   ⑧ 사진 자리     (출시 전 실제 사진으로 교체)
 *   ⑨ 경계          "이거 광고 아닌가요?"    ┐ 한 덩어리 어두운 띠
 *   ⑩ 마무리        첫 화면과 같은 행동      ┘
 *
 * ## 2026-09-03 개편에서 없어진 섹션 셋 — **내용은 없어지지 않았다**
 *
 * 시안에 `ScenesSection`·`OneRoomSection`·`PrivateLaneSection` 이 없다. 셋 다 지웠지만
 * 그 몫은 새 섹션이 나눠 받았다. 되살리기 전에 여기를 먼저 읽어라:
 *
 *   스무 장면(scenes)      → ⑥ 카드 "둘이 갈리는 장면 보기" + ④ 버튼
 *   한 덩어리 대화(oneRoom) → ③ 대화 카드 캡션("앞에서 말한 시기랑 예산을 기억해뒀다가…")
 *   나만 보는 자리(privateLane) → ③ 자리 카드 둘 + `amoraNote.privacyNote`
 *
 * 셋이 지고 있던 **고지도 함께 옮겼다**(공유 링크 고지·대화 저장 고지·샘플 표식).
 * 고지가 어디로 갔는지는 `landingDisclosuresAreOnScreen.test.ts` 가 이름으로 못 박는다.
 *
 * ## 인접 규칙
 *
 * ③ → ④ → ⑤ 는 붙어 있어야 한다. 아모라가 답하는 장면을 보면 곧바로 "한쪽 편들면?"과
 * "내 계획을 바꾸나?"가 떠오르고, 다음 섹션이 그 걱정을 받지 않으면 앞 섹션이
 * 불안으로 끝난다.
 */
export default function LandingPage() {
  return (
    // `relative` 는 꽃 레이어(`LandingBloomLayer`)의 기준점이다. 빼면 꽃이 화면
    // 기준으로 붙어 스크롤해도 따라다닌다.
    //
    // ⚠️ 여기 `overflow-hidden` 이 있었다. 여백 밖으로 나간 가지가 가로 스크롤을
    // 만들지 않게 하려던 것인데, **조상의 overflow 는 `position: sticky` 를 깬다.**
    // 그래서 헤더가 `sticky top-0 z-50` 인데도 안 붙었다 — 2026-08-29 실측에서
    // 2,500px 스크롤 뒤 헤더 top 이 -2500 이었다(7,400px 짜리 화면에서 내비가
    // 통째로 사라진다). 자르는 일은 `LandingBloomLayer` 가 자기 상자에서 이미
    // 한다(정본 시안도 `.bq-layer { overflow: hidden }` 으로 레이어에만 걸었고
    // 래퍼에는 없다). 여기에 다시 넣지 마라 — 헤더가 조용히 죽는다.
    <div className="landing-root relative min-h-screen bg-[var(--color-paper-sheet)] text-[var(--color-paper-ink)]">
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
        {/* 순서·인접 규칙은 이 파일 머리말에 있다. 섹션을 끼우거나 옮기기 전에 읽어라 —
            `landingFirstVisitClarity.test.ts` 와 `landingOutcomeEvidence.test.ts` 가
            **이 목록을 통째로** 고정한다(부분집합이 아니라 완전 일치). */}
        <TransformationHero />
        <BlockedReasonsSection />
        <AmoraNoteSection />
        <NoSideSection />
        <ConfirmSection />
        <AvailableNowSection />
        <CommunitySection />
        <PhotoBandSection />
        <BoundariesSection />
        <ClosingAction />
      </main>
      <LandingFooter />
    </div>
  );
}
