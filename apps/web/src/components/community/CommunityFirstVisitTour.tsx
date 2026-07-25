"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

// 처음 온 사람이 첫 화면만 보고는 "이게 무슨 서비스인지" 알기 어렵다
// (2026-07-25 첫방문 워크스루: 견적 체크 도구 + 이름 없는 피드로 읽히고,
//  아모라는 다섯 번째 글쯤 내려가야 카드로 처음 등장했다).
// 실제 화면 요소를 그대로 비추는 스포트라이트로 무엇을 할 수 있는지만 짚는다
// — 별도 안내 페이지를 만들면 진짜 화면과 달라져 두 번 배우게 된다.
// 기존 커뮤니티 투어(CommunityTutorial)는 게시판 사용법이라 이 투어를 마친
// 뒤에 이어지도록 두고, 여기서는 서비스 전체 지도만 5칸으로 보여준다.
const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="landing-quote-check"]',
    title: "웨딩한방은 결혼 준비를 같이 정리하는 곳이에요",
    description:
      "받은 견적서가 있다면 여기서부터요. 로그인 없이 3분이면 견적서에서 확인 안 된 항목과 계약 전 업체에 물어볼 질문을 정리해 드려요. 좋다·나쁘다 판정은 하지 않아요.",
  },
  {
    selector: '[data-tutorial-target="landing-start-here"]',
    title: "아직 견적 전이라면 순서부터",
    description:
      "예식일만 넣으면 지금 열어야 하는 항목과 첫 걸음을 정리해 드려요. 날짜는 저장하지 않아요.",
  },
  {
    selector: '[data-tutorial-target="landing-price"]',
    title: "업체가 직접 공개한 가격",
    description:
      "한국소비자원 참가격에 가격을 공개한 스튜디오·드레스·메이크업·예식장의 기본가와 추가금을 원문 근거와 함께 볼 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="community-categories"]',
    title: "먼저 겪은 사람들의 글",
    description:
      "'이 추가금 정상인가요?' 같은 질문과 실제 후기가 주제별로 모여 있어요. 검색으로 비슷한 상황을 먼저 찾아봐도 좋아요.",
  },
  {
    selector: '[data-tutorial-target="landing-amora"]',
    title: "막히면 아모라에게 물어보세요",
    description:
      "AI 웨딩 플래너예요. 가입 없이 바로 대화할 수 있고, 예산·일정·업체 질문을 이어서 기억해요. 지금 이 버튼을 눌러보세요.",
  },
];

export default function CommunityFirstVisitTour() {
  return (
    <SpotlightTutorial
      steps={STEPS}
      storageKey="hanbang_first_visit_tour_seen"
      mode="auto"
      // 첫 화면이 다 그려진 뒤에 뜨도록 — 로딩 중에 겹치면 위치가 어긋난다.
      delayMs={1_200}
    />
  );
}
