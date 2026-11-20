// 일정 탭(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해). 아티팩트의 하단 메뉴 "일정"은
// 답장과 상담 확정 화면(`Status.dc`)으로 간다. 확정된 상담이 없으면 그렇다고 말하고, 앱의 전체 일정 화면
// (`app/schedule/index.tsx`, 그대로 둔다)으로 가는 길을 늘 함께 둔다.
//
// 이 탭의 주소(`/(tabs)/schedule`)와 전체 일정(`/schedule`)은 화면에 보이는 경로가 같다. 그룹 없는
// `/schedule` 은 전체 일정으로 간다(Expo Router 가 고정 조각이 더 많은 `schedule/index` 를 먼저 고른다).
// 그래서 이 탭으로 갈 때는 늘 그룹을 붙인 `/(tabs)/schedule` 을 쓴다(`invitationRoutes.mjs`).
import LiveConsultation from "@/components/invitationLive/LiveConsultation";

export default function ScheduleTab() {
  return <LiveConsultation from="tabs" />;
}
