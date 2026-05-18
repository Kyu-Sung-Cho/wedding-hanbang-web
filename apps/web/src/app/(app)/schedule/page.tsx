"use client";

import { Suspense } from "react";
import ScheduleContent from "@/components/app/schedule/ScheduleContent";

export default function SchedulePage() {
  // ScheduleContent 내부에서 useSearchParams 사용 — Suspense boundary 필수 (Next 16)
  return (
    <Suspense fallback={null}>
      <ScheduleContent />
    </Suspense>
  );
}
