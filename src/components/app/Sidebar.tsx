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
  Store,
  Users,
  Sparkles,
  BookOpen,
  Settings,
  LogOut,
  X,
  FileText,
  Mail,
  Banknote,
  Mic,
  BarChart3,
} from "lucide-react";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

const hiddenInComingSoon = ["/invitations", "/money", "/scripts"];

const menuItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "대시보드" },
  { href: "/chat", icon: MessageCircle, label: "아모라 상담" },
  { href: "/budget", icon: Wallet, label: "예산 관리" },
  { href: "/market-prices", icon: BarChart3, label: "시세 정보" },
  { href: "/schedule", icon: CalendarCheck, label: "일정 관리" },
  { href: "/invitations", icon: Mail, label: "모바일 청첩장" },
  { href: "/money", icon: Banknote, label: "축의금 관리" },
  { href: "/scripts", icon: Mic, label: "AI 대본" },
  { href: "/vendors", icon: Store, label: "업체 탐색" },
  { href: "/community", icon: Users, label: "커뮤니티" },
  { href: "/bookings", icon: FileText, label: "내 예약" },
  { href: "/fitting", icon: Sparkles, label: "드레스 피팅" },
  { href: "/etiquette", icon: BookOpen, label: "예절 가이드" },
  { href: "/settings", icon: Settings, label: "설정" },
].filter((item) => !isComingSoon || !hiddenInComingSoon.includes(item.href));

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
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-screen w-[260px] bg-noir-800 flex flex-col z-50 transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* 로고 영역 */}
        <div className="flex items-center justify-between px-6 h-[90px] border-b border-white/[0.06]">
          <Link href="/dashboard">
            <Logo size="sm" variant="white" />
          </Link>
          <button
            onClick={onClose}
            className="md:hidden w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 메뉴 */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="flex flex-col gap-1">
            {menuItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[23px] transition-all duration-200 ${
                    isActive
                      ? "bg-rose-500/15 text-rose-500 font-medium"
                      : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
                  }`}
                >
                  <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* 유저 섹션 */}
        <div className="px-3 pb-4">
          <div className="px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center text-white text-[25px] font-medium">
                {userInitial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[25px] text-white font-medium truncate">{userName}</div>
                <div className="text-[23px] text-white/30">{weddingDateStr} {journey?.wedding_date ? "예정" : ""}</div>
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-3 px-4 py-3 mt-1 rounded-xl text-[25px] text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-all w-full"
          >
            <LogOut className="w-4 h-4" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
