"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BarChart3,
  Bookmark,
  Building2,
  BookOpen,
  CalendarClock,
  CalendarCheck,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Settings,
  Wallet,
  X,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import { stripWeddingBasePath, weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";
const hiddenInComingSoon = ["/money"];

type SidebarMenuItem = {
  legacyPath: string;
  /** /wedding 베이스패스 밖 표면일 때만 사용 (없으면 weddingLinkProps 경유) */
  absolutePath?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tutorialTarget?: string;
};

const menuItems: SidebarMenuItem[] = [
  { legacyPath: "/lounge", icon: LayoutDashboard, label: "웨딩 라운지", tutorialTarget: "service-nav-lounge" },
  { legacyPath: "/chat", icon: MessageCircle, label: "아모라 상담", tutorialTarget: "service-nav-amora" },
  // 상담 바로 아래 — 저장한 말은 대화의 연장이지 별도 기능이 아니다.
  { legacyPath: "/saved", icon: Bookmark, label: "저장한 이야기" },
  { legacyPath: "/budget", icon: Wallet, label: "예산 관리", tutorialTarget: "service-nav-budget" },
  { legacyPath: "/schedule", icon: CalendarCheck, label: "일정 관리", tutorialTarget: "service-nav-schedule" },
  // 공시 가격은 /wedding 베이스패스 밖 최상위 표면이라 절대 경로로 직접 연결한다.
  { legacyPath: "/price", absolutePath: "/price", icon: BarChart3, label: "공시 가격", tutorialTarget: "service-nav-market" },
  { legacyPath: "/vendors", icon: Building2, label: "업체 탐색", tutorialTarget: "service-nav-vendors" },
  { legacyPath: "/bookings", icon: CalendarClock, label: "예약 관리" },
  { legacyPath: "/money", icon: Banknote, label: "축의금 관리" },
  { legacyPath: "/settings", icon: Settings, label: "설정" },
].filter((item) => !isComingSoon || !hiddenInComingSoon.includes(item.legacyPath));

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const currentPath = stripWeddingBasePath(pathname);
  const { profile, journey, signOut } = useAuthStore();
  const userName = profile?.name ?? "예비부부";
  const userInitial = userName.charAt(0);
  const weddingDateStr = journey?.wedding_date
    ? new Date(journey.wedding_date).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : "예식일 미정";

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-[#061a34]/35 backdrop-blur-sm md:hidden" onClick={onClose} />}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-[16rem] flex-col border-r border-[#eadfc9] bg-[#fffdf7] shadow-[0_14px_38px_rgba(8,22,38,0.06)] transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex h-[72px] items-center justify-between px-5">
          <Link {...weddingLinkProps()} className="inline-flex items-center whitespace-nowrap" aria-label="웨딩한방 홈으로 이동">
            <Logo size="md" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#eadfc9] text-[#5d6879] md:hidden"
            aria-label="메뉴 닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="flex flex-col gap-1">
            {menuItems.map((item) => {
              const isActive = currentPath === item.legacyPath
                || (item.legacyPath !== "/lounge" && currentPath.startsWith(item.legacyPath));
              return (
                <Link
                  key={item.legacyPath}
                  {...(item.absolutePath ? { href: item.absolutePath } : weddingLinkProps(item.legacyPath))}
                  onClick={onClose}
                  data-tutorial-target={item.tutorialTarget}
                  className={`flex items-center gap-3 rounded-[14px] px-4 py-3 text-[14px] font-semibold transition-colors ${
                    isActive
                      ? "bg-[#061a34] text-white shadow-[0_10px_24px_rgba(6,26,52,0.12)]"
                      : "text-[#34445a] hover:bg-white hover:text-[#9d6f36]"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="px-3 pb-4">
          <div className="rounded-[16px] border border-[#eadfc9] bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#061a34] text-[14px] font-semibold text-white">
                {userInitial}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-[#071629]">{userName}</p>
                <p className="mt-0.5 truncate text-[12px] font-medium text-[#7a8290]">{weddingDateStr}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-2 flex w-full items-center gap-2 rounded-[14px] border border-[#eadfc9] bg-white px-4 py-3 text-[13px] font-semibold text-[#5d6879] hover:text-[#9d6f36]"
          >
            <LogOut className="h-4 w-4" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
