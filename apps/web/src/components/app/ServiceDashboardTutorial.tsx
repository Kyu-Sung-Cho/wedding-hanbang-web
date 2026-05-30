"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="dashboard-hero"]',
    title: "우리 결혼 준비 라운지",
    description:
      "결혼식까지 남은 날, 준비 진행률, 예산 현황, 오늘 먼저 볼 준비 항목을 한눈에 보는 공간이에요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-amora"]',
    title: "아모라 상담은 여기서 시작해요",
    description:
      "견적서, 계약 조건, 일정 고민처럼 막히는 질문을 바로 물어보는 곳이에요. 답변을 받은 뒤 예산·일정·시세 화면으로 이어가면 좋아요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-budget"]',
    title: "예산 관리는 금액 정리용",
    description:
      "총예산, 사용 금액, 진행 중 금액을 나눠서 보는 곳이에요. 상담에서 받은 견적은 여기에 넣어두면 흐름이 덜 헷갈려요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-schedule"]',
    title: "일정 관리는 예약과 할 일용",
    description:
      "투어, 상담, 계약, 촬영처럼 날짜가 있는 준비를 모아두는 곳이에요. 놓치기 쉬운 일정은 여기서 먼저 정리하세요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-market"]',
    title: "시세 정보로 감을 먼저 잡아요",
    description:
      "웨딩홀, 스드메, 드레스, 메이크업 평균가를 먼저 보고 내 견적이 어느 정도 위치인지 가볍게 비교할 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-vendors"]',
    title: "업체 탐색은 후보를 좁힐 때",
    description:
      "지역, 가격대, 스타일을 보며 후보 업체를 찾아보는 공간이에요. 마음에 드는 곳은 저장하고 상담 전 아모라에게 질문을 정리해보세요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-start-guide"]',
    title: "처음엔 이 순서가 편해요",
    description:
      "궁금한 건 아모라에게 묻고, 받은 답은 예산·일정에 정리하고, 큰 금액은 시세와 업체 탐색으로 다시 확인하면 됩니다.",
  },
];

export default function ServiceDashboardTutorial() {
  return (
    <SpotlightTutorial
      steps={STEPS}
      storageKey="hanbang_dashboard_tutorial_seen_v2"
      mode="event"
      triggerEvent="hanbang:service-guide-completed"
      prerequisiteKey="hanbang_service_guide_seen_v2"
      delayMs={700}
    />
  );
}
