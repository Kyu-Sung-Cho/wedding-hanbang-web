"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

// 처음 온 사람이 첫 화면만 보고는 "이게 무슨 서비스인지" 알기 어렵다
// (2026-07-25 첫방문 워크스루: 견적 체크 도구 + 이름 없는 피드로 읽히고,
//  아모라는 다섯 번째 글쯤 내려가야 카드로 처음 등장했다).
// 실제 화면 요소를 그대로 비추는 스포트라이트로 무엇을 할 수 있는지만 짚는다
// — 별도 안내 페이지를 만들면 진짜 화면과 달라져 두 번 배우게 된다.
// 기존 커뮤니티 투어(CommunityTutorial)는 게시판 사용법이라 이 투어를 마친
// 뒤에 이어지도록 두고, 여기서는 서비스 전체 지도만 4칸으로 보여준다.
// (2026-07-29 첫 화면 개편으로 5칸 → 4칸. 견적 체크 스텝은 그 도구가 히어로에서
//  내려가면서 함께 뺐다 — 견적서를 이미 받은 사람만 쓰는 도구라 서비스 지도의
//  첫 칸이 될 자리가 아니다.)
const STEPS: SpotlightStep[] = [
  {
    // 이 자리는 이제 견적 체크가 아니라 **대행사 간 공시가 차이**를 세운다
    // (2026-07-29). 투어 문구가 옛 화면을 설명하면 첫 방문자가 보는 것과 듣는 것이
    // 어긋난다 — 이 저장소가 반복해서 밟은 함정이다.
    selector: '[data-tutorial-target="landing-hero"]',
    title: "같은 업체인데 대행사마다 가격이 달라요",
    description:
      "한국소비자원 참가격에 공시된 스드메·예식장의 기본가·추가금과 취소 위약금 원문을 그대로 모았어요. 요약도, 어디가 낫다는 판정도 하지 않아요.",
  },
  {
    selector: '[data-tutorial-target="landing-price"]',
    title: "업체별로 직접 비교해 보세요",
    description:
      "카테고리와 지역을 고르면 업체별 기본가와 추가금, 대행사별 위약금 원문을 나란히 볼 수 있어요. 로그인은 필요 없어요.",
  },
  {
    selector: '[data-tutorial-target="community-categories"]',
    title: "먼저 겪은 사람들의 글",
    description:
      "'이 추가금 정상인가요?' 같은 질문과 실제 후기가 주제별로 모여 있어요. 검색으로 비슷한 상황을 먼저 찾아봐도 좋아요.",
  },
  {
    // 이 타겟은 이제 플로팅 버튼이 아니라 히어로 다음의 아모라 블록이다
    // (2026-07-29). 작은 버튼보다 무엇을 해주는지 적힌 블록을 비추는 편이 맞다.
    selector: '[data-tutorial-target="landing-amora"]',
    title: "순서는 아모라가 같이 잡아요",
    // 이 버튼(CommunityAmoraLauncher)은 데모 쿠키가 없으면 "로그인 후 이용할 수
    // 있어요" 모달을 띄운다. 그래서 "가입 없이 바로 대화할 수 있고"는 사실이 아니고,
    // 하필 그 문구를 보는 첫 방문자가 정확히 못 하는 사람이었다.
    // 모달 문구·랜딩 WhatWeDo 카드("가입 필요 · 무료")와 같은 사실로 맞춘다.
    description:
      "AI 웨딩 플래너예요. 예산·일정·업체 질문을 이어서 기억해요. 내 예식일과 준비 상황을 바탕으로 답해야 해서 로그인이 필요해요 — 무료예요.",
  },
];

/** 이 이벤트를 쏘면 투어가 열린다 — "이 서비스 어떻게 쓰나요?" 같은 명시적 요청용. */
export const COMMUNITY_TOUR_EVENT = "hanbang:start-first-visit-tour";

export default function CommunityFirstVisitTour() {
  return (
    <SpotlightTutorial
      steps={STEPS}
      storageKey="hanbang_first_visit_tour_seen"
      // 2026-07-26: 자동 실행을 끈다.
      //
      // 이 투어는 "첫 화면만 보고는 무슨 서비스인지 모르겠다"를 풀려고 만들었는데,
      // 정작 뜨자마자 그 첫 화면을 가려버렸다. 볼까 말까 하는 사람에게 5단계 설명을
      // 먼저 요구하는 셈이라, 훅을 읽기도 전에 이탈한다.
      //
      // 같은 문제는 이제 랜딩의 WhatWeDo 블록이 화면 자체로 답한다. 투어는 지우지
      // 않고 요청이 있을 때만 연다 — 쓰기로 마음먹은 사람에게는 여전히 쓸모가 있다.
      mode="event"
      triggerEvent={COMMUNITY_TOUR_EVENT}
      // 이 이벤트는 "처음이신가요?" 버튼, 즉 사용자의 명시적 요청이다. 한 번 본
      // 사람에게도 열려야 한다 — 자동 투어가 살아 있던 2026-07-25~26 사이에 한 번
      // 닫은 방문자에게는 이 버튼이 무반응이었다.
      replayOnTrigger
      delayMs={300}
    />
  );
}
