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
    selector: '[data-tutorial-target="dashboard-briefing"]',
    title: "오늘의 아모라 브리핑",
    description:
      "오늘 먼저 확인하면 좋은 준비 항목을 카드 형태로 보여줘요. 예산, 일정, 체크리스트로 바로 이어갈 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-actions"]',
    title: "바로 할 일",
    description:
      "라운지에서 바로 확인해야 할 준비 항목을 모아 보여줘요. 완료하거나 숨기면서 화면을 가볍게 정리할 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-dday-budget"]',
    title: "D-day와 예산 현황",
    description:
      "큰 숫자로 결혼식까지 남은 날과 사용한 예산을 봐요. 예산 카드의 점 3개를 누르면 상세 관리 화면으로 들어가요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-categories"]',
    title: "카테고리별 진행 상태",
    description:
      "예식장, 스튜디오, 드레스, 메이크업, 예물 등 모든 결혼 카테고리의 진행 상태를 한눈에. 클릭하면 카테고리별 체크리스트로 들어가요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-start-guide"]',
    title: "아모라로 시작하세요",
    description:
      "막막한 질문은 아모라 상담에서 물어보고, 필요한 내용은 예산·일정·체크리스트 화면에서 직접 정리하세요.",
  },
];

export default function ServiceDashboardTutorial() {
  return (
    <SpotlightTutorial
      steps={STEPS}
      storageKey="hanbang_dashboard_tutorial_seen"
      mode="event"
      triggerEvent="hanbang:service-guide-completed"
      prerequisiteKey="hanbang_service_guide_seen"
      delayMs={700}
    />
  );
}
