"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="community-categories"]',
    title: "주제별 게시판",
    description:
      "계약·추가금 질문, 후기, 꿀팁, 선배 Q&A, 자유 글로 나뉘어 있어요. 원하는 주제만 골라 볼 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="community-write"]',
    title: "자세한 후기·질문 쓰기",
    description:
      "사진·가격·상담 내용을 정리해 글로 올릴 수 있어요. 이용자 작성 정보는 검증된 사실이 아닐 수 있고, 협찬이면 협찬으로 표시해야 해요.",
  },
  {
    selector: '[data-tutorial-target="community-right"]',
    title: "지금 뜨는 글과 준비 흐름",
    description:
      "이번 주 인기글과 공식 자료 기반 시세를 볼 수 있어요. 게시글은 확인 질문을 찾는 참고로, 시세는 개인 견적 판정이 아닌 시장 참고로 이용하세요.",
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
