"use client";

import { useMemo } from "react";

import AmoraCareConsentPrompt from "@/components/app/AmoraCareConsentPrompt";
import TodayOneCard from "@/components/app/TodayOneCard";
import { ymdInKst } from "@/lib/utils/kstDate";
import { getEvents, getScheduleEventStatus } from "@/utils/scheduleEvents";

/**
 * 청첩장 홈 알림 자리의 "먼저 챙기기" 한 칸(25장 2절, 10장 P1·P2).
 *
 *   1. 먼저 알려 드릴까요?(`AmoraCareConsentPrompt`): 오늘 이후 예정된 일정이 하나라도 생긴 뒤 한 번만 묻는다.
 *      답은 서버(`care_prompt_answered_at`)에 남아 다시 묻지 않는다(2026-11-13 파운더 결정).
 *   2. 오늘의 한 가지(`TodayOneCard`): 서버 스위치(`AMORA_TODAY_ONE_ENABLED`)가 꺼져 있거나 설정에서 켜지
 *      않은 사람에게는 아무것도 그리지 않는다.
 *
 * 둘 다 할 말이 없으면 아무것도 그리지 않아 홈에 빈 자리가 생기지 않는다(감싸는 상자를 두지 않는다).
 * 홈(`LiveLoungeNotices`)에는 이 부품 한 줄만 들어간다. 체험 모드는 부르는 쪽이 이미 걸러 낸다.
 */
export function countPlannedSchedules(
  progress: Record<string, unknown> | null | undefined,
  today: string = ymdInKst(),
): number {
  if (!progress) return 0;
  return getEvents(progress).filter((event) => (
    getScheduleEventStatus(event) === "planned"
    && typeof event.date === "string"
    && event.date >= today
  )).length;
}

export default function AmoraTodayOneSlot({
  progress,
}: {
  progress: Record<string, unknown> | null | undefined;
}) {
  const plannedScheduleCount = useMemo(() => countPlannedSchedules(progress), [progress]);
  return (
    <>
      <AmoraCareConsentPrompt plannedScheduleCount={plannedScheduleCount} />
      <TodayOneCard />
    </>
  );
}
