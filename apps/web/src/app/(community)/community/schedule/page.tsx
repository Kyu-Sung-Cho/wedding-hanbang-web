"use client";

import ScheduleContent from "@/components/app/schedule/ScheduleContent";

/**
 * 커뮤니티 안에서 일정 관리를 인플레이스로 사용 — /community/schedule.
 * CommunityLayout의 nav + footer는 그대로, 메인 영역에 일정 풀 기능 렌더.
 * 풀페이지(/schedule)와는 별도 라우트, 같은 ScheduleContent 컴포넌트 공유.
 */
export default function CommunitySchedulePage() {
  return <ScheduleContent embedded />;
}
