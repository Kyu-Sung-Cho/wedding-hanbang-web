"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  BarChart3,
  Building2,
  BookOpen,
  CalendarClock,
  CalendarCheck,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Scale,
  Settings,
  Wallet,
  X,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import { stripWeddingBasePath, weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import { parseLocalDateOnly } from "@hanbang/shared";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";
const isCoupleCourtEnabled =
  process.env.NEXT_PUBLIC_COUPLE_COURT_ENABLED === "true";
const hiddenInComingSoon = ["/money"];

const menuItems = [
  { legacyPath: "/lounge", icon: LayoutDashboard, label: "웨딩 라운지", tutorialTarget: "service-nav-lounge" },
  { legacyPath: "/chat", icon: MessageCircle, label: "아모라 상담", tutorialTarget: "service-nav-amora" },
  ...(isCoupleCourtEnabled
    ? [{ legacyPath: "/couple-court", icon: Scale, label: "커플재판소" }]
    : []),
  { legacyPath: "/budget", icon: Wallet, label: "예산 관리", tutorialTarget: "service-nav-budget" },
  { legacyPath: "/schedule", icon: CalendarCheck, label: "일정 관리", tutorialTarget: "service-nav-schedule" },
  { legacyPath: "/market-prices", icon: BarChart3, label: "시세 정보", tutorialTarget: "service-nav-market" },
  { legacyPath: "/vendors", icon: Building2, label: "업체 탐색", tutorialTarget: "service-nav-vendors" },
  { legacyPath: "/bookings", icon: CalendarClock, label: "예약 관리" },
  { legacyPath: "/etiquette", icon: BookOpen, label: "예절 가이드" },
  { legacyPath: "/money", icon: Banknote, label: "축의금 관리" },
  { legacyPath: "/settings", icon: Settings, label: "설정" },
].filter((item) => !isComingSoon || !hiddenInComingSoon.includes(item.legacyPath));

export function isSidebarItemActive(currentPath: string, itemPath: string) {
  return (
    currentPath === itemPath ||
    (itemPath !== "/lounge" && currentPath.startsWith(`${itemPath}/`))
  );
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const currentPath = stripWeddingBasePath(pathname);
  const { profile, journey, signOut } = useAuthStore();
  const userName = profile?.name ?? "예비부부";
  const userInitial = userName.charAt(0);
  const weddingDate = journey?.wedding_date ? parseLocalDateOnly(journey.wedding_date) : null;
  const weddingDateStr = weddingDate
    ? weddingDate.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : "예식일 미정";
  const isInteractive = isOpen || isDesktop;
  const isMobileModalOpen = isOpen && !isDesktop;

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isMobileModalOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sidebarRef.current) return;

      const focusable = Array.from(
        sidebarRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isMobileModalOpen, onClose]);

  return (
    <>
      {isOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-[#061a34]/35 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        ref={sidebarRef}
        aria-hidden={isInteractive ? undefined : true}
        aria-label="주 메뉴"
        aria-modal={isMobileModalOpen || undefined}
        inert={isInteractive ? undefined : true}
        role={isDesktop ? undefined : "dialog"}
        className={`fixed left-0 top-0 z-50 flex h-dvh w-[16rem] flex-col border-r border-[#eadfc9] bg-[#fffdf7] shadow-[0_14px_38px_rgba(8,22,38,0.06)] transition-[transform,visibility] duration-300 ${
          isOpen
            ? "visible translate-x-0 pointer-events-auto"
            : "invisible -translate-x-full pointer-events-none md:visible md:translate-x-0 md:pointer-events-auto"
        }`}
      >
        <div className="flex h-[72px] items-center justify-between px-5">
          <Link {...weddingLinkProps()} onClick={onClose} className="inline-flex items-center whitespace-nowrap" aria-label="웨딩한방 홈으로 이동">
            <Logo size="md" />
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#eadfc9] text-[#5d6879] md:hidden"
            aria-label="메뉴 닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="flex flex-col gap-1">
            {menuItems.map((item) => {
              const isActive = isSidebarItemActive(currentPath, item.legacyPath);
              return (
                <Link
                  key={item.legacyPath}
                  {...weddingLinkProps(item.legacyPath)}
                  onClick={onClose}
                  aria-current={isActive ? "page" : undefined}
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
