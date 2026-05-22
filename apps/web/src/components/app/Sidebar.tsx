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
  Store,
  Ticket,
} from "lucide-react";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

const hiddenInComingSoon = ["/invitations", "/money", "/scripts"];

// 베타 단계 업체 메뉴 숨김 — 런칭 D-30 진입으로 해제 (2026-04-30).
const BETA_HIDDEN_VENDOR_PATHS: string[] = [];

// 캐논 v2 §11 동결 영역: 페이지/라우트는 살아있되 사이드바 메인 동선에서 격하.
// /vendors·/bookings은 데모 단계에서 다시 노출 — 캐치테이블 흐름을 평가자가
// 직접 확인해야 하는 핵심 차별 기능이라 격하 정책에서 제외.
// /fitting·/scripts는 Phase 2까지 격하 유지.
// /vendors는 이슈 #12 (팀 요청)에 따라 베타 단계 동안 메뉴에서 숨김 —
// 등록 업체 수가 부족해 미완성 페이지를 노출하지 않기 위함. 라우트·AI 추천 카드·
// /vendors/[id]·/favorites는 모두 살아있음. 업체 DB 충분히 쌓이면 이 항목 제거.
const SIDEBAR_HIDDEN: string[] = [
  "/fitting",
  "/scripts",
  "/vendors",
];

const menuItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "대시보드" },
  { href: "/chat", icon: MessageCircle, label: "아모라 상담" },
  { href: "/budget", icon: Wallet, label: "예산 관리" },
  { href: "/market-prices", icon: BarChart3, label: "시세 정보" },
  { href: "/schedule", icon: CalendarCheck, label: "일정 관리" },
  // 업체 관련 메뉴 묶음 — 둘러보기·예약·즐겨찾기는 한 흐름으로
  { href: "/vendors", icon: Store, label: "업체 찾기" },
  { href: "/bookings", icon: Ticket, label: "내 예약" },
  { href: "/favorites", icon: Bookmark, label: "내 즐겨찾기" },
  { href: "/invitations", icon: Mail, label: "모바일 청첩장" },
  { href: "/money", icon: Banknote, label: "축의금 관리" },
  { href: "/scripts", icon: Mic, label: "AI 대본" },
  { href: "/community", icon: Users, label: "커뮤니티" },
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
        className={`fixed top-0 left-0 h-screen w-[16rem] bg-[#F5F0EE] flex flex-col z-50 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* 로고 영역 */}
        <div className="flex items-center justify-between px-6 h-[72px]">
          <Link href="/dashboard" className="font-serif-kr italic text-2xl text-[#795252] font-light tracking-tight">
            <Logo size="sm" bordered />
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
                  className={`flex items-center gap-2.5 pl-4 pr-4 py-2.5 text-sm transition-colors duration-200 ${
                    isActive
                      ? "bg-[#795252]/10 text-[#795252] font-semibold rounded-xl mr-3"
                      : "text-[#504444] hover:text-[#795252] hover:bg-white/60 rounded-xl mr-3"
                  }`}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* 유저 섹션 */}
        <div className="px-3 pb-3">
          <div className="px-4 py-3 rounded-xl bg-white shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center text-white text-sm font-medium">
                {userInitial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#1A1A1F] font-medium truncate">{userName}</div>
                <div className="text-xs text-[#B5ADA3]">{weddingDateStr} {journey?.wedding_date ? "예정" : ""}</div>
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-2.5 px-4 py-2.5 mt-2 rounded-xl text-sm text-[#795252] bg-white hover:bg-[#795252]/5 shadow-sm transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
