"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="dashboard-hero"]',
    title: "우리 결혼 준비 라운지",
    description:
      "결혼식까지 남은 날과 직접 기록한 준비 진행률·예산·일정을 한눈에 보는 공간이에요.",
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
      "직접 정한 계획 금액, 서명한 계약서의 총액, 실제 납부액을 구분해 기록하는 곳이에요. 웨딩한방의 기록은 계약서나 결제 증빙을 대신하지 않아요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-schedule"]',
    title: "일정 관리는 날짜와 할 일용",
    description:
      "투어, 상담, 계약, 촬영처럼 날짜가 있는 준비를 모아두는 곳이에요. 놓치기 쉬운 일정은 여기서 먼저 정리하세요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-market"]',
    title: "시세 정보는 시장 참고용이에요",
    description:
      "한국소비자원 공개 자료를 조사월·지역·포함 범위와 함께 확인하세요. 내 견적의 적정성이나 계약 안전성을 판정하는 화면은 아니에요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-start-guide"]',
    title: "처음엔 이 순서가 편해요",
    description:
      "궁금한 건 아모라에게 묻고, 직접 확인한 금액과 날짜는 예산·일정에 기록하세요. 시세는 시장 참고로만 보고 최종 조건은 업체 문서로 확인하면 됩니다.",
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
