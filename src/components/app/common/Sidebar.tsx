"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, MessageSquare, Wallet, CalendarDays,
  Shirt, Store, BookOpen, Settings, LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "대시보드" },
  { href: "/chat", icon: MessageSquare, label: "AI 채팅" },
  { href: "/budget", icon: Wallet, label: "예산 관리" },
  { href: "/schedule", icon: CalendarDays, label: "일정 관리" },
  { href: "/fitting", icon: Shirt, label: "AI 피팅" },
  { href: "/vendors", icon: Store, label: "업체 탐색" },
  { href: "/etiquette", icon: BookOpen, label: "예절 가이드" },
  { href: "/settings", icon: Settings, label: "설정" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-platinum bg-white">
      {/* 로고 */}
      <div className="flex h-16 items-center gap-2.5 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-gold text-sm font-semibold text-white font-display">
          한
        </div>
        <span className="text-base font-medium font-serif tracking-[-0.5px] text-noir-800">
          웨딩한방
        </span>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
                isActive
                  ? "bg-rose-glow font-medium text-rose-500"
                  : "text-charcoal hover:bg-ivory-100 hover:text-noir-800"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 로그아웃 */}
      <div className="border-t border-platinum p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-taupe-500 transition-colors hover:bg-ivory-100 hover:text-noir-800"
        >
          <LogOut className="h-[18px] w-[18px]" />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
