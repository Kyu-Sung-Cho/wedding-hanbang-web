"use client";

import SpotlightTutorial, { type SpotlightStep } from "@/components/ui/SpotlightTutorial";

const STEPS: SpotlightStep[] = [
  {
    selector: '[data-tutorial-target="dashboard-hero"]',
    title: "아모라가 다 챙겨주는 결혼 준비 메인 화면",
    description:
      "AI 아모라가 견적·계약·예산·일정·커플 합의·본식 타임라인까지 전부 하나의 흐름으로 묶어줘요. 결혼식까지 남은 날, 진행률, 아모라 안전도를 한눈에 보고 '오늘 할 일 묻기'로 바로 이어가세요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-briefing"]',
    title: "오늘의 아모라 브리핑",
    description:
      "오늘 놓치면 안 되는 일과 실수 방지 점검을 카드 형태로 보여줘요. 결혼 준비 시점에 맞춰 챙겨야 할 것들이 자동으로 바뀌어요.",
  },
  {
    selector: '[data-tutorial-target="dashboard-actions"]',
    title: "아모라가 기억하는 행동",
    description:
      "AI 채팅에서 '이거 다음 할 일로 저장해줘'라고 하면 여기 쌓여요. 완료/숨김으로 정리하면서 진행 상황을 챙길 수 있어요.",
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
      "아모라 채팅 한 줄이면 예산·일정·체크리스트가 자동으로 따라와요. 가족·파트너에게 보낼 메시지 코칭, 양가 합의 문구까지 같은 채팅에서 풀려요. 막막할 때 아모라부터 부르세요.",
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
