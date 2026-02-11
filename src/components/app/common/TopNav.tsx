"use client";

import { usePathname } from "next/navigation";
import { useJourneyStore } from "@/stores/journeyStore";
import { formatDday } from "@/utils/format";

const pageTitles: Record<string, string> = {
  "/dashboard": "대시보드",
  "/chat": "AI 웨딩 플래너",
  "/budget": "예산 관리",
  "/schedule": "일정 관리",
  "/fitting": "AI 드레스 피팅",
  "/vendors": "업체 탐색",
  "/etiquette": "예절 가이드",
  "/settings": "설정",
};

export default function TopNav() {
  const pathname = usePathname();
  const getDaysUntilWedding = useJourneyStore((s) => s.getDaysUntilWedding);
  const dday = getDaysUntilWedding();
  const title = pageTitles[pathname] || "웨딩한방";

  return (
    <header className="flex h-16 items-center justify-between border-b border-platinum bg-white px-8">
      <h1 className="text-lg font-medium text-noir-800">{title}</h1>
      {dday !== null && (
        <div className="flex items-center gap-2 rounded-full bg-rose-glow px-4 py-1.5 text-sm font-medium text-rose-500">
          {formatDday(dday)}
        </div>
      )}
    </header>
  );
}
