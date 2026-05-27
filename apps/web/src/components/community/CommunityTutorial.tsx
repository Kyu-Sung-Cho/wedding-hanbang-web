"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="community-cohort"]',
    title: "같은 시기 결혼하는 동기방",
    description:
      "결혼 분기를 고르면 같은 분기 예비부부와 익명 채팅방에 입장해요. 가격·후기·고민을 실시간으로 나누는 공간이에요. 가격이 포함된 후기를 글로 올리면, 아모라가 적정성 댓글을 자동으로 달아줘요.",
  },
  {
    selector: '[data-tutorial-target="community-categories"]',
    title: "주제별 게시판",
    description:
      "정상인가요(견적 검증), 투어/이용 후기, 꿀팁, 결혼 선배 Q&A 등으로 나뉘어 있어요. 원하는 주제만 골라 볼 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="community-composer"]',
    title: "피드 위에서 빠르게 질문",
    description:
      "한 줄짜리 짧은 질문이라면 페이지 이동 없이 여기서 바로 물어볼 수 있어요. 가격이 포함된 글이면 AI 아모라가 가격 적정성 댓글을 자동으로 달아줘요.",
  },
  {
    selector: '[data-tutorial-target="community-write"]',
    title: "자세한 후기·질문 쓰기",
    description:
      "사진·가격·계약 내용을 정리해 글로 올리면 다음 예비부부가 덜 헤매요. 협찬이면 협찬으로 표시할 수 있고, 가격 정보를 함께 적으면 아모라가 적정성 댓글을 자동으로 달아줘요.",
  },
  {
    selector: '[data-tutorial-target="community-right"]',
    title: "지금 뜨는 글과 업체",
    description:
      "트렌딩 글, 자주 언급되는 업체, 인기 해시태그를 한눈에 볼 수 있어요. 어디부터 봐야 할지 막막할 때 출발점.",
  },
  {
    selector: '[data-tutorial-target="community-service-link"]',
    title: "아모라가 묶어주는 메인 도구로",
    description:
      "AI 아모라가 상담 문장 정리·계약서 풀이·예산·일정·커플 합의 메시지·본식 타임라인까지 전부 하나로 묶어줘요. 채팅·예산·일정 도구는 여기로 들어가세요.",
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
