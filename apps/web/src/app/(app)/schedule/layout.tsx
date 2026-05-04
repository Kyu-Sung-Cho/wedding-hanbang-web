"use client";

import PostCountGate from "@/components/app/PostCountGate";

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return (
    <PostCountGate
      featureName="일정 관리"
      featureDescription="D-day 자동 체크리스트·임박 알림·캘린더로 마감을 놓치지 않게."
    >
      {children}
    </PostCountGate>
  );
}
