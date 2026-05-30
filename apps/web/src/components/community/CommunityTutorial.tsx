"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="community-cohort"]',
    title: "같은 시기 결혼하는 동기방",
    description:
      "결혼 분기를 고르면 같은 분기 예비부부와 익명 채팅방에 입장해요. 가격·후기·고민을 실시간으로 나누는 공간이에요.",
  },
  {
    selector: '[data-tutorial-target="community-categories"]',
    title: "주제별 게시판",
    description:
      "정상인가요, 후기, 꿀팁, 선배 Q&A, 자유 글로 나뉘어 있어요. 원하는 주제만 골라 볼 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="community-composer"]',
    title: "피드 위에서 빠르게 질문",
    description:
      "한 줄짜리 짧은 질문이라면 페이지 이동 없이 여기서 바로 물어볼 수 있어요. 더 자세한 내용은 글쓰기에서 사진과 함께 정리하세요.",
  },
  {
    selector: '[data-tutorial-target="community-write"]',
    title: "자세한 후기·질문 쓰기",
    description:
      "사진·가격·상담 내용을 정리해 글로 올리면 다음 예비부부가 덜 헤매요. 협찬이면 협찬으로 표시할 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="community-right"]',
    title: "지금 뜨는 글과 준비 흐름",
    description:
      "이번 주 인기글, 바로 할 일, 요즘 시세를 한눈에 볼 수 있어요. 어디부터 봐야 할지 막막할 때 출발점으로 쓰세요.",
  },
  {
    selector: '[data-tutorial-target="community-service-link"]',
    title: "라운지에서 내 준비 정리하기",
    description:
      "커뮤니티에서 찾은 정보는 라운지의 아모라 상담, 예산 관리, 일정 관리, 카테고리 체크리스트에서 우리 준비에 맞게 정리할 수 있어요.",
  },
];

export default function CommunityTutorial() {
  return (
    <SpotlightTutorial
      steps={STEPS}
      storageKey="hanbang_community_tutorial_seen"
      mode="event"
      triggerEvent="hanbang:community-guide-completed"
      prerequisiteKey="hanbang_community_guide_seen"
      delayMs={700}
    />
  );
}
