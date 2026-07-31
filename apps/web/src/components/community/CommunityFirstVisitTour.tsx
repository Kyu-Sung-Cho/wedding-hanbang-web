"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

// 화면 자체만으로 충분하지 않은 사용자가 요청할 때 여는 서비스 지도다.
// 실제 화면 요소를 그대로 비춰 별도 안내 페이지와 제품이 어긋나지 않게 한다.
const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="landing-amora"]',
    title: "준비는 아모라와 먼저 정리해요",
    description:
      "결혼 준비를 말하면 예산·체크리스트·일정으로 이어서 정리해요. 바꾸기 전에는 보여드리고 승인한 내용만 반영해요. 로그인이 필요하지만 무료예요.",
  },
  {
    selector: '[data-tutorial-target="community-decision-start"]',
    title: "지금 막힌 결정부터 시작하세요",
    description:
      "견적·추가금은 먼저 확인하고, 업체·계약은 비슷한 경험을 찾아보세요. 검색으로 풀리지 않을 때만 내 상황으로 질문을 이어갑니다.",
  },
  {
    selector: '[data-tutorial-target="community-categories"]',
    title: "내 상황과 가까운 해결 경험을 찾아보세요",
    description:
      "업체명·금액·계약 단계를 검색하고 문제별로 좁혀볼 수 있어요. 결과가 없으면 입력한 내용이 질문 초안으로 이어집니다.",
  },
  {
    selector: '[data-tutorial-target="landing-hero"]',
    title: "가격 판단에는 공개 근거를 함께 보세요",
    description:
      "한국소비자원 참가격에 공시된 기본가·추가금과 취소 위약금 원문을 보여드려요. 요약이나 업체 판정 대신 출처와 기준 시점을 확인할 수 있어요.",
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
