"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { Menu, Bell, Search } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useNotifications, useNotificationPrefs } from "@/hooks/useNotifications";
import NotificationPanel from "@/components/app/NotificationPanel";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";

const pageTitles: Record<string, string> = {
  "/dashboard": "대시보드",
  "/chat": "아모라 AI 플래너",
  "/budget": "예산 관리",
  "/market-prices": "시세 정보",
  "/schedule": "일정 관리",
  "/vendors": "업체 탐색",
  "/fitting": "AI 드레스 피팅",
  "/etiquette": "예절 가이드",
  "/settings": "설정",
  "/invitations": "모바일 청첩장",
  "/money": "축의금 관리",
  "/scripts": "AI 대본",
};

interface TopNavProps {
  onMenuToggle: () => void;
}

export default function TopNav({ onMenuToggle }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const title = pageTitles[pathname] || "웨딩한방";
  const { journey } = useAuthStore();
  const { prefs } = useNotificationPrefs();

  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // D-day 계산 (hydration-safe)
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => { setToday(new Date()); }, []);

  const weddingDate = journey?.wedding_date
    ? new Date(journey.wedding_date)
    : null;
  const dday = weddingDate && today
    ? Math.ceil((weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const progress = journey?.progress ?? {};
  const { notifications, newCount, dismiss, dismissAll } = useNotifications(
    weddingDate,
    progress,
    prefs
  );

  const handleCategoryClick = (categoryKey: string) => {
    setShowNotifications(false);
    setSelectedCategory(categoryKey);
  };

  return (
    <>
      <header className="sticky top-0 z-30 h-[72px] bg-[#FAFAF8]/90 backdrop-blur-[12px] flex items-center justify-between px-8 max-md:px-5">
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuToggle}
            className="md:hidden w-11 h-11 flex items-center justify-center rounded-xl hover:bg-[#F6F3F2] transition-colors"
          >
            <Menu className="w-6 h-6 text-[#504444]" />
          </button>
          <h1 className="font-serif-kr italic text-2xl font-light text-[#795252] tracking-tight">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* D-day 배지 */}
          {dday !== null && dday > 0 && (
            <div className="hidden sm:flex items-center gap-2 px-5 py-2.5 bg-white rounded-full shadow-[0_4px_14px_0_rgba(121,82,82,0.08)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#795252] animate-pulse" />
              <span className="font-display text-base font-medium text-[#795252]">D-{dday}</span>
              <span className="text-sm text-[#B5ADA3] font-light">결혼식까지</span>
            </div>
          )}
          {dday === null && (
            <div className="hidden sm:flex items-center gap-2 px-5 py-2.5 bg-white rounded-full shadow-[0_4px_14px_0_rgba(121,82,82,0.08)]">
              <span className="text-base text-[#B5ADA3]">날짜 미정</span>
            </div>
          )}

          {/* 검색 */}
          <button className="w-11 h-11 flex items-center justify-center rounded-xl text-[#504444] hover:bg-[#F6F3F2] hover:text-[#795252] transition-colors">
            <Search className="w-6 h-6" />
          </button>

          {/* 알림 */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative w-11 h-11 flex items-center justify-center rounded-xl text-[#504444] hover:bg-[#F6F3F2] hover:text-[#795252] transition-colors"
            >
              <Bell className="w-6 h-6" />
              {newCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#795252] text-white text-[11px] font-medium flex items-center justify-center">
                  {newCount > 9 ? "9+" : newCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {showNotifications && (
                <NotificationPanel
                  notifications={notifications}
                  onDismiss={dismiss}
                  onDismissAll={dismissAll}
                  onCategoryClick={handleCategoryClick}
                  onClose={() => setShowNotifications(false)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* 알림에서 열린 체크리스트 모달 */}
      <CategoryChecklistModal
        categoryKey={selectedCategory ?? ""}
        isOpen={!!selectedCategory}
        onClose={() => setSelectedCategory(null)}
      />
    </>
  );
}
