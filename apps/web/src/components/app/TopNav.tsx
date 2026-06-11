"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { Bell, Menu, Search } from "lucide-react";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import NotificationPanel from "@/components/app/NotificationPanel";
import { useNotifications, useNotificationPrefs } from "@/hooks/useNotifications";
import { isWeddingPathActive, stripWeddingBasePath, weddingPath, weddingRoutePath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

const pageTitles: Record<string, string> = {
  "/lounge": "웨딩 라운지",
  "/chat": "아모라 상담",
  "/budget": "예산 관리",
  "/market-prices": "시세 정보",
  "/schedule": "일정 관리",
  "/favorites": "즐겨찾기",
  "/etiquette": "예절 가이드",
  "/settings": "설정",
  "/money": "축의금 관리",
};

const pageTitlePrefixes: Array<{ prefix: string; title: string }> = [
  { prefix: "/vendors/favorites", title: "찜한 업체" },
  { prefix: "/vendors", title: "업체 탐색" },
  { prefix: "/bookings", title: "예약 관리" },
];

const quickLinks = [
  { href: weddingRoutePath("/chat"), as: weddingPath("/chat"), legacyPath: "/chat", label: "아모라" },
  { href: weddingRoutePath("/community/cohort"), as: weddingPath("/community/cohort"), legacyPath: "/community/cohort", label: "동기방" },
  { href: weddingRoutePath(), as: weddingPath(), legacyPath: "/community", label: "커뮤니티" },
];

function getPageTitle(pathname: string) {
  return pageTitles[pathname] ?? pageTitlePrefixes.find((item) => pathname.startsWith(item.prefix))?.title ?? "웨딩한방";
}

interface TopNavProps {
  onMenuToggle: () => void;
}

export default function TopNav({ onMenuToggle }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const title = getPageTitle(stripWeddingBasePath(pathname));
  const { journey } = useAuthStore();
  const { prefs } = useNotificationPrefs();
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const today = useMemo(() => new Date(), []);

  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;
  const dday =
    weddingDate
      ? Math.ceil((weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      : null;
  const progress = journey?.progress ?? {};
  const { notifications, newCount, dismiss, dismissAll } = useNotifications(weddingDate, progress, prefs);

  function handleCategoryClick(categoryKey: string) {
    setShowNotifications(false);
    setSelectedCategory(categoryKey);
  }

  useEffect(() => {
    quickLinks.forEach((item) => router.prefetch(item.href));
  }, [router]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#eadfc9]/70 bg-[#fffdf7]/92 px-8 backdrop-blur-[14px] max-md:px-5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onMenuToggle}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#eadfc9] text-[#071629] md:hidden"
            aria-label="메뉴 열기"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            href={weddingRoutePath()}
            as={weddingPath()}
            className="block rounded-[10px] outline-none transition-colors hover:text-[#9d6f36] focus-visible:ring-2 focus-visible:ring-[#c9a96e]/50"
            aria-label="웨딩한방 홈으로 이동"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9d6f36]">Wedding Hanbang</p>
            <h1 className="mt-0.5 font-serif-kr text-[24px] font-medium leading-tight text-[#071629]">{title}</h1>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <nav
            aria-label="라운지 주요 바로가기"
            className="mr-4 hidden items-center gap-6 text-[15px] font-semibold text-[#071629] lg:flex"
          >
            {quickLinks.map((item, index) => {
              const isActive = isWeddingPathActive(pathname, item.legacyPath);
              return (
                <div key={item.as} className="flex items-center gap-6">
                  {index > 0 && <span className="h-4 w-px bg-[#eadfc9]" aria-hidden />}
                  <Link
                    href={item.href}
                    as={item.as}
                    className={`transition-colors hover:text-[#b68a3a] ${
                      isActive ? "text-[#9d6f36]" : "text-[#071629]"
                    }`}
                  >
                    {item.label}
                  </Link>
                </div>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 rounded-full border border-[#eadfc9] bg-white px-4 py-2 sm:flex">
            <span className="h-2 w-2 rounded-full bg-[#b68a3a]" />
            <span className="text-[13px] font-semibold text-[#071629]">
              {dday === null ? "예식일 미정" : dday > 0 ? `D-${dday}` : dday === 0 ? "D-day" : `D+${Math.abs(dday)}`}
            </span>
          </div>

          <button
            type="button"
            onClick={() => router.push(weddingPath("/vendors"))}
            className="flex h-11 w-11 items-center justify-center rounded-full text-[#34445a] transition-colors hover:bg-white hover:text-[#9d6f36]"
            aria-label="업체 검색"
            title="업체 검색"
          >
            <Search className="h-5 w-5" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifications((value) => !value)}
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-[#34445a] transition-colors hover:bg-white hover:text-[#9d6f36]"
              aria-label="알림"
            >
              <Bell className="h-5 w-5" />
              {newCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#061a34] px-1 text-[10px] font-semibold text-white">
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

      <CategoryChecklistModal
        categoryKey={selectedCategory ?? ""}
        isOpen={!!selectedCategory}
        onClose={() => setSelectedCategory(null)}
      />
    </>
  );
}
