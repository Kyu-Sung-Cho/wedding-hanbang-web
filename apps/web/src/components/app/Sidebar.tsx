"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Settings,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import { stripWeddingBasePath, weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

type SidebarMenuItem = {
  legacyPath: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tutorialTarget?: string;
};

const menuItems: SidebarMenuItem[] = [
  { legacyPath: "/chat", icon: MessageCircle, label: "아모라", tutorialTarget: "service-nav-amora" },
  { legacyPath: "/lounge", icon: LayoutDashboard, label: "웨딩 라운지", tutorialTarget: "service-nav-lounge" },
  { legacyPath: "/checklist", icon: ClipboardCheck, label: "웨딩 체크리스트", tutorialTarget: "service-nav-schedule" },
  { legacyPath: "/schedule", icon: CalendarCheck, label: "일정" },
  { legacyPath: "/budget", icon: Wallet, label: "예산", tutorialTarget: "service-nav-budget" },
  { legacyPath: "/community", icon: Users, label: "커뮤니티", tutorialTarget: "service-nav-community" },
  // 로그인 없이도 열리는 읽기 화면이지만 사이드바에 둔다 — 준비 중에 가장 자주
  // 막히는 것이 "이럴 땐 어떻게 하지"라서, 찾으러 나가지 않고 여기서 열리는 게 맞다.
  { legacyPath: "/manners", icon: BookOpen, label: "예절 가이드" },
  { legacyPath: "/settings", icon: Settings, label: "설정" },
];

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
    : "결혼식 날짜 미정";

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-[#061a34]/35 backdrop-blur-sm md:hidden" onClick={onClose} />}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-[16rem] flex-col border-r border-[var(--hb-hairline)] bg-[var(--hb-ivory)] shadow-[var(--shadow-raised)] transition-transform duration-300 ${
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
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--hb-hairline)] text-[var(--hb-text-body)] md:hidden"
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
                  {...weddingLinkProps(item.legacyPath)}
                  onClick={onClose}
                  data-tutorial-target={item.tutorialTarget}
                  className={`flex items-center gap-3 rounded-[14px] px-4 py-3 text-[14px] font-semibold transition-colors ${
                    isActive
                      ? "bg-[#061a34] text-white shadow-[var(--shadow-raised)]"
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
          <div className="rounded-[16px] border border-[var(--hb-hairline)] bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--hb-primary)] text-[14px] font-semibold text-white">
                {userInitial}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-[var(--hb-text-strong)]">{userName}</p>
                <p className="mt-0.5 truncate text-[12px] font-medium text-[var(--hb-text-body)]">{weddingDateStr}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-2 flex w-full items-center gap-2 rounded-[14px] border border-[var(--hb-hairline)] bg-white px-4 py-3 text-[13px] font-semibold text-[var(--hb-text-body)] hover:text-[#9d6f36]"
          >
            <LogOut className="h-4 w-4" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
