"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import { useAuthStore } from "@/stores/authStore";
import {
  LayoutDashboard,
  MessageCircle,
  Wallet,
  CalendarCheck,
  Users,
  BookOpen,
  Settings,
  LogOut,
  X,
  Mail,
  Banknote,
  Mic,
  BarChart3,
  Bookmark,
} from "lucide-react";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

const hiddenInComingSoon = ["/invitations", "/money", "/scripts"];

// 베타 단계 업체 메뉴 숨김 — 런칭 D-30 진입으로 해제 (2026-04-30).
// 등록 업체 0개여도 페이지에서 카테고리 칩 + 빈 상태 안내가 보이도록 메뉴 노출.
const BETA_HIDDEN_VENDOR_PATHS: string[] = [];

// 사이드바에서만 숨김 (페이지/라우트는 살아있음 — 직접 URL 접근 가능).
// vendors·bookings·fitting은 업체 공급망이 충분해질 때 재노출.
const SIDEBAR_HIDDEN: string[] = [
  "/vendors",
  "/bookings",
  "/fitting",
];

const menuItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "대시보드" },
  { href: "/chat", icon: MessageCircle, label: "아모라 상담" },
  { href: "/budget", icon: Wallet, label: "예산 관리" },
  { href: "/market-prices", icon: BarChart3, label: "시세 정보" },
  { href: "/schedule", icon: CalendarCheck, label: "일정 관리" },
  { href: "/invitations", icon: Mail, label: "모바일 청첩장" },
  { href: "/money", icon: Banknote, label: "축의금 관리" },
  { href: "/scripts", icon: Mic, label: "AI 대본" },
  { href: "/community", icon: Users, label: "커뮤니티" },
  { href: "/favorites", icon: Bookmark, label: "내 즐겨찾기" },
  { href: "/etiquette", icon: BookOpen, label: "예절 가이드" },
  { href: "/settings", icon: Settings, label: "설정" },
]
  .filter((item) => !isComingSoon || !hiddenInComingSoon.includes(item.href))
  .filter((item) => !BETA_HIDDEN_VENDOR_PATHS.includes(item.href))
  .filter((item) => !SIDEBAR_HIDDEN.includes(item.href));

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, journey, signOut } = useAuthStore();

  const userName = profile?.name ?? "사용자";
  const userInitial = userName.charAt(0);
  const weddingDateStr = journey?.wedding_date
    ? new Date(journey.wedding_date).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).replace(/\. /g, ".").replace(".", ".")
    : "미정";

  return (
    <>
      {/* 모바일 오버레이 */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-screen w-[280px] bg-[#F5F0EE] flex flex-col z-50 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* 로고 영역 */}
        <div className="flex items-center justify-between px-6 h-[72px]">
          <Link href="/dashboard" className="font-serif-kr italic text-2xl text-[#795252] font-light tracking-tight">
            <Logo size="sm" />
          </Link>
          <button
            onClick={onClose}
            className="md:hidden w-10 h-10 flex items-center justify-center text-[#B5ADA3] hover:text-[#795252] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* 메뉴 */}
        <nav className="flex-1 pr-0 pl-3 py-4 overflow-y-auto">
          <div className="flex flex-col gap-1">
            {menuItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 pl-5 pr-5 py-3.5 text-lg transition-all duration-200 ${
                    isActive
                      ? "bg-[#795252]/10 text-[#795252] font-bold rounded-xl mr-3"
                      : "text-[#504444] hover:text-[#795252] hover:bg-white/60 rounded-xl mr-3"
                  }`}
                >
                  <item.icon className="w-6 h-6 flex-shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* 유저 섹션 */}
        <div className="px-3 pb-4">
          <div className="px-5 py-4 rounded-xl bg-white shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center text-white text-base font-medium">
                {userInitial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base text-[#1A1A1F] font-medium truncate">{userName}</div>
                <div className="text-sm text-[#B5ADA3]">{weddingDateStr} {journey?.wedding_date ? "예정" : ""}</div>
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-3 px-5 py-3.5 mt-2 rounded-xl text-base text-[#795252] bg-white hover:bg-[#795252]/5 shadow-sm transition-all w-full"
          >
            <LogOut className="w-5 h-5" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
