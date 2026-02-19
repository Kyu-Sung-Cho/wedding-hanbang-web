"use client";

import { usePathname } from "next/navigation";
import { Menu, Bell, Search } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

const pageTitles: Record<string, string> = {
  "/dashboard": "대시보드",
  "/chat": "AI 웨딩 플래너",
  "/budget": "예산 관리",
  "/schedule": "일정 관리",
  "/vendors": "업체 탐색",
  "/fitting": "AI 드레스 피팅",
  "/etiquette": "예절 가이드",
  "/settings": "설정",
};

interface TopNavProps {
  onMenuToggle: () => void;
}

export default function TopNav({ onMenuToggle }: TopNavProps) {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "웨딩한방";
  const { journey } = useAuthStore();

  // D-day 계산
  const weddingDate = journey?.wedding_date
    ? new Date(journey.wedding_date)
    : null;
  const today = new Date();
  const dday = weddingDate
    ? Math.ceil((weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <header className="sticky top-0 z-30 h-[72px] bg-ivory-50/90 backdrop-blur-[12px] border-b border-black/[0.04] flex items-center justify-between px-8 max-md:px-5">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="md:hidden w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/[0.04] transition-colors"
        >
          <Menu className="w-5 h-5 text-noir-800" />
        </button>
        <h1 className="font-serif-kr text-[20px] font-normal text-noir-800 tracking-tight">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        {/* D-day 배지 */}
        {dday !== null && dday > 0 && (
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-black/[0.04] shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="font-display text-[14px] font-medium text-rose-500">D-{dday}</span>
            <span className="text-[11px] text-taupe-500 font-light">결혼식까지</span>
          </div>
        )}
        {dday === null && (
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-black/[0.04] shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="text-[12px] text-taupe-400">날짜 미정</span>
          </div>
        )}

        {/* 검색 */}
        <button className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/[0.04] transition-colors">
          <Search className="w-[18px] h-[18px] text-taupe-500" />
        </button>

        {/* 알림 */}
        <button className="relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/[0.04] transition-colors">
          <Bell className="w-[18px] h-[18px] text-taupe-500" />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500" />
        </button>
      </div>
    </header>
  );
}
