"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="dashboard-hero"]',
    title: "오늘 할 일부터 확인해요",
    description:
      "결혼식까지 남은 날, 준비 진행률, 예산 현황과 지금 먼저 할 일을 한눈에 보는 공간이에요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-amora"]',
    title: "준비는 아모라에게 말하세요",
    description:
      "지금 상황을 말하면 아모라가 할 일과 순서를 정리해요. 바뀔 내용을 확인하고 승인하면 예산·할 일·일정에 이어집니다.",
  },
  {
    selector: '[data-tutorial-target="service-nav-budget"]',
    title: "예산은 계획과 지출을 함께",
    description:
      "총예산과 실제로 쓴 금액을 항목별로 확인해요. 아모라에게 말한 금액도 승인 후 여기에 남길 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="service-nav-schedule"]',
    title: "체크리스트와 일정을 한곳에서",
    description:
      "해야 할 일은 체크하고, 날짜가 있는 준비는 일정으로 남겨요. 무엇을 언제까지 할지가 한 흐름으로 이어집니다.",
  },
  {
    selector: '[data-tutorial-target="service-nav-community"]',
    title: "실제 경험은 커뮤니티에서",
    description:
      "AI가 직접 겪을 수 없는 준비 경험을 찾아보고 물어보세요. 확인한 내용은 다시 아모라와 내 준비로 이어갈 수 있어요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-start-guide"]',
    title: "이 흐름만 기억하면 돼요",
    description:
      "아모라에게 말하고, 바뀔 내용을 확인하고, 예산·할 일·일정에 남기세요. 실제 경험이 필요할 때만 커뮤니티에서 확인하면 됩니다.",
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
