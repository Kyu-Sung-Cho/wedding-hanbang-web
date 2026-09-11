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
  activePath?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tutorialTarget?: string;
};

const menuItems: SidebarMenuItem[] = [
  { legacyPath: "/lounge", icon: LayoutDashboard, label: "웨딩 라운지", tutorialTarget: "service-nav-lounge" },
  { legacyPath: "/chat", icon: MessageCircle, label: "아모라", tutorialTarget: "service-nav-amora" },
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
  amoraWorkspace?: boolean;
  planningWorkspace?: boolean;
}

export default function Sidebar({ isOpen, onClose, amoraWorkspace = false, planningWorkspace = false }: SidebarProps) {
  const htmlDesign = amoraWorkspace || planningWorkspace;
  const pathname = usePathname();
  const currentPath = stripWeddingBasePath(pathname);
  const plannerOverview = htmlDesign && ["/checklist", "/budget", "/schedule", "/lounge"].includes(currentPath);
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
      {isOpen && <div className="fixed inset-0 z-40 bg-[rgba(54,83,78,0.40)] backdrop-blur-sm md:hidden" onClick={onClose} />}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-[100dvh] flex-col border-r transition-transform duration-300 ${plannerOverview ? "w-[216px] border-[var(--amora-line)] bg-white pt-[22px]" : htmlDesign ? "w-[220px] border-[var(--amora-line)] bg-white pt-[22px]" : "w-[16rem] border-[var(--hb-hairline)] bg-[var(--hb-ivory)] shadow-[var(--shadow-raised)]"} ${
          isOpen ? "visible translate-x-0" : "invisible -translate-x-full md:visible md:translate-x-0"
        }`}
      >
        <div className={htmlDesign ? "flex min-h-[54px] items-start justify-between px-6 pt-[6px]" : "flex h-[72px] items-center justify-between px-5"}>
          <Link {...weddingLinkProps()} className="inline-flex items-center whitespace-nowrap" aria-label="웨딩한방 홈으로 이동">
            {htmlDesign ? <span className="amora-display flex items-center gap-2 text-[17px] text-[var(--amora-ink)]"><span aria-hidden className="flex size-[26px] items-center justify-center rounded-[7px] bg-[var(--amora-ink)] font-sans text-[13px] font-bold text-white">H</span>웨딩한방</span> : <Logo size="md" />}
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

        <nav aria-label="서비스 메뉴" className={htmlDesign ? "flex-1 overflow-y-auto px-[14px]" : "flex-1 overflow-y-auto px-3 py-3"}>
          <div className={plannerOverview ? "flex flex-col gap-0.5" : "flex flex-col gap-1"}>
            {menuItems.map((item) => {
              const activePath = item.activePath ?? item.legacyPath;
              const isActive = currentPath === activePath
                || (activePath !== "/lounge" && currentPath.startsWith(`${activePath}/`));
              return (
                <Link
                  key={item.legacyPath}
                  {...weddingLinkProps(item.legacyPath)}
                  onClick={onClose}
                  data-tutorial-target={item.tutorialTarget}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center transition-colors ${htmlDesign ? "min-h-11 gap-[11px] rounded-[9px] px-3 py-[10px] text-[14.5px]" : "gap-3 rounded-[6px] px-4 py-3 text-[14px] font-semibold"} ${
                    isActive
                      ? "bg-[var(--hb-selected-bg)] font-semibold text-[var(--hb-selected-text)] ring-1 ring-inset ring-[var(--hb-selected-line)]"
                      : "text-[var(--hb-text-body)] hover:bg-white hover:text-[var(--hb-accent-hover)]"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className={plannerOverview ? "mx-[14px] mt-[10px] border-t border-[var(--amora-line)] pb-4 pt-[14px]" : "px-3 pb-4"}>
          <div className={plannerOverview ? "px-[10px] pb-[10px] pt-[6px]" : "rounded-[6px] border border-[var(--hb-hairline)] bg-white p-4"}>
            <div className="flex items-center gap-3">
              <div className={plannerOverview ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--amora-rose-pale)] text-[12px] font-bold text-[var(--amora-rose-deep)]" : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--hb-primary)] text-[14px] font-semibold text-white"}>
                {userInitial}
              </div>
              <div className="min-w-0">
                <p className={`${plannerOverview ? "text-[13px]" : "text-[14px]"} truncate font-semibold text-[var(--hb-text-strong)]`}>{userName}</p>
                <p className={`${plannerOverview ? "text-[11px]" : "text-[12px]"} mt-0.5 truncate font-medium text-[var(--hb-text-body)]`}>{weddingDateStr}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className={plannerOverview ? "flex min-h-11 w-full items-center gap-2 rounded-md px-[10px] py-2 text-[12.5px] text-[var(--amora-muted)] hover:bg-[var(--amora-warm)]" : "mt-2 flex w-full items-center gap-2 rounded-[6px] border border-[var(--hb-hairline)] bg-white px-4 py-3 text-[13px] font-semibold text-[var(--hb-text-body)] hover:text-[var(--hb-accent-hover)]"}
          >
            <LogOut className="h-4 w-4" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
