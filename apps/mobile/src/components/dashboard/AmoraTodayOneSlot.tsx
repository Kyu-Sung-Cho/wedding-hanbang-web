// 홈 알림 자리의 "먼저 챙기기" 한 칸(25장 2절, 10장 P1·P2). 웹 `AmoraTodayOneSlot` 과 같은 둘이다.
//
//   1. 먼저 알려 드릴까요?(`AmoraCareConsentPrompt`): 오늘 이후 예정된 일정이 하나라도 생긴 뒤 한 번만 묻는다.
//      답은 서버(`care_prompt_answered_at`)에 남아 다시 묻지 않는다(2026-11-13 파운더 결정).
//   2. 오늘의 한 가지(`TodayOneCareCard`): 서버 스위치가 꺼져 있거나 설정에서 켜지 않은 사람에게는 그리지 않는다.
//
// 둘 다 할 말이 없으면 아무것도 그리지 않는다. 감싸는 상자를 두지 않아 홈의 알림 줄 간격이 그대로다.
// 홈(`app/(tabs)/lounge.tsx`)에는 이 부품 한 줄만 들어간다.
import { useMemo } from "react";

import AmoraCareConsentPrompt from "@/components/dashboard/AmoraCareConsentPrompt";
import TodayOneCareCard from "@/components/dashboard/TodayOneCareCard";
import { countPlannedSchedules } from "@/lib/plannedSchedules.mjs";

export default function AmoraTodayOneSlot({
  refreshVersion = 0,
  progress,
}: {
  refreshVersion?: number;
  progress: Record<string, unknown> | null | undefined;
}) {
  const plannedScheduleCount = useMemo(() => countPlannedSchedules(progress), [progress]);
  return (
    <>
      <AmoraCareConsentPrompt plannedScheduleCount={plannedScheduleCount} />
      <TodayOneCareCard refreshVersion={refreshVersion} />
    </>
  );
}
