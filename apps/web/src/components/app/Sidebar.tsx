"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BarChart3,
  Building2,
  BookOpen,
  CalendarClock,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Settings,
  Shirt,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import { useAuthStore } from "@/stores/authStore";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";
const hiddenInComingSoon = ["/money", "/fitting", "/scripts"];

const menuItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "준비실" },
  { href: "/chat", icon: MessageCircle, label: "아모라 상담" },
  { href: "/budget", icon: Wallet, label: "예산 관리" },
  { href: "/schedule", icon: CalendarCheck, label: "일정 관리" },
  { href: "/market-prices", icon: BarChart3, label: "시세 정보" },
  { href: "/vendors", icon: Building2, label: "업체 탐색" },
  { href: "/bookings", icon: CalendarClock, label: "예약 관리" },
  { href: "/community", icon: Users, label: "커뮤니티" },
  { href: "/fitting", icon: Shirt, label: "드레스 피팅" },
  { href: "/etiquette", icon: BookOpen, label: "예절 가이드" },
  { href: "/scripts", icon: FileText, label: "대본 리딩" },
  { href: "/money", icon: Banknote, label: "축의금 관리" },
  { href: "/settings", icon: Settings, label: "설정" },
].filter((item) => !isComingSoon || !hiddenInComingSoon.includes(item.href));

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
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
          <Link href="/dashboard" className="inline-flex items-center whitespace-nowrap">
            <Logo size="sm" />
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
              const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
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
