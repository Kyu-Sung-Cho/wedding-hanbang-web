"use client";

import { useEffect, useRef, useSyncExternalStore, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  LayoutDashboard,
  LogOut,
  Settings,
  X,
} from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import { useAccessibleModal } from "@/hooks/useAccessibleModal";
import ProfileAvatar from "@/components/ui/ProfileAvatar";
import { LogoMark } from "@/components/ui/Logo";
import { stripWeddingBasePath, weddingLinkProps } from "@/lib/weddingPaths";
import {formatCalendarDate} from "@/lib/utils/weddingDate";
import { useAuthStore } from "@/stores/authStore";
import {
  SIDEBAR_ITEM_ACTIVE_CLASS,
  SIDEBAR_ITEM_CLASS,
  SIDEBAR_ITEM_IDLE_CLASS,
  SIDEBAR_LIST_CLASS,
  SIDEBAR_WIDTH_CLASS,
} from "./sidebarStyles";

type SidebarMenuItem = {
  legacyPath: string;
  activePath?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tutorialTarget?: string;
};

/**
 * 메뉴는 둘이다(2026-11-13 파운더 결정).
 *
 * 파운더 원문: "지금 잇는 기능들 다 아모라 뒤로 보내 에절가이드나 일정 관리 에산 관리 등등 삭다
 * 그리고 메인 두개만 남길거야 아모라랑 웨딩 대쉬보드". 결정 보드·체크리스트·일정·예산·웨딩코드·
 * 예절 가이드는 메뉴에서 뺐다. 화면과 기록은 그대로 있고, 라운지와 아모라가 연다. 설정은 기능이
 * 아니라 계정이라 아래 사용자 자리로 옮겼다.
 */
const menuItems: SidebarMenuItem[] = [
  { legacyPath: "/lounge", icon: LayoutDashboard, label: "웨딩 라운지", tutorialTarget: "service-nav-lounge" },
  { legacyPath: "/chat", icon: AmoraMark, label: "아모라", tutorialTarget: "service-nav-amora" },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

// Tailwind `md`(48rem)와 같은 경계. 이 위에서는 사이드바가 늘 보이는 고정 열이라 모달이 아니다.
const DESKTOP_QUERY = "(min-width: 48rem)";

function subscribeDesktop(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP_QUERY) : null;
  if (!query || typeof query.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// matchMedia 를 모르는 환경(jsdom 등)은 데스크톱으로 본다 — 모르면 예전 동작 그대로 둔다.
function readDesktop() {
  return typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP_QUERY).matches : true;
}

/**
 * 로그인한 사람의 사이드바. **어느 화면에서도 모양이 같다.**
 *
 * 예전에는 화면 종류(아모라·계획·라운지·나머지)에 따라 너비·간격·글자 크기·굵기·아래
 * 사용자 영역이 따로 그려졌다. 모양은 `sidebarStyles.ts` 한 곳에서 정하고, 로그인 없이 읽는
 * 예절 가이드 사이드바도 같은 값을 쓴다. 색 토큰은 `.amora-workspace`·`.planning-workspace`
 * 안에서만 값이 있다. 둘 다 없는 화면(설정 등)에서도 같은 색이 나오도록 이 요소가
 * `amora-workspace` 를 직접 달고 있다.
 */
export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const currentPath = stripWeddingBasePath(pathname);
  const settingsActive = currentPath === "/settings" || currentPath.startsWith("/settings/");
  const { profile, journey, signOut } = useAuthStore();
  const userName = profile?.name ?? "예비부부";
  const weddingDateStr = formatCalendarDate(journey?.wedding_date,{
    year:"numeric",month:"2-digit",day:"2-digit",
  })??"결혼식 날짜 미정";

  // 좁은 화면에서 열린 서랍만 모달이다. 폰에서 열어 둔 채 창을 넓히거나 기기를 돌려 md 이상이
  // 되면 고정 열로 돌아가므로, 그때는 스크롤 잠금·Tab 가두기·Escape 를 모두 풀어야 한다.
  const isDesktop = useSyncExternalStore(subscribeDesktop, readDesktop, () => true);
  const isDrawer = isOpen && !isDesktop;
  const drawerRef = useAccessibleModal<HTMLElement>({
    open: isDrawer,
    onClose,
    initialFocusSelector: "[data-sidebar-close]",
  });

  // 뒤로가기처럼 링크 밖에서 경로가 바뀌어도 서랍이 모달로 남지 않게 닫는다. 처음 그릴 때는 부르지 않는다.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (isOpen) onClose();
  }, [pathname, isOpen, onClose]);

  return (
    <>
      {isOpen && <div aria-hidden="true" className="fixed inset-0 z-40 bg-[rgba(54,83,78,0.40)] backdrop-blur-sm md:hidden" onClick={onClose} />}

      <aside
        ref={drawerRef}
        role={isDrawer ? "dialog" : undefined}
        aria-modal={isDrawer ? true : undefined}
        aria-label={isDrawer ? "메뉴" : undefined}
        className={`amora-workspace fixed left-0 top-0 z-50 flex h-[100dvh] ${SIDEBAR_WIDTH_CLASS} flex-col border-r border-[var(--amora-line)] bg-white pt-[22px] transition-transform duration-300 ${
          isOpen ? "visible translate-x-0" : "invisible -translate-x-full md:visible md:translate-x-0"
        }`}
      >
        <div className="flex min-h-[54px] items-start justify-between px-6 pt-[6px]">
          {/* 로그인한 사람의 홈은 웨딩 라운지다. 빈 경로는 커뮤니티(/wedding)로 간다. */}
          <Link {...weddingLinkProps("/lounge")} onClick={onClose} className="inline-flex items-center whitespace-nowrap" aria-label="웨딩한방 홈으로 이동">
            <span className="amora-display flex items-center gap-2 text-[17px] text-[var(--amora-ink)]"><LogoMark />웨딩한방</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            data-sidebar-close
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--amora-line)] text-[var(--amora-soft)] md:hidden"
            aria-label="메뉴 닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="서비스 메뉴" className="flex-1 overflow-y-auto px-[14px]">
          <div className={SIDEBAR_LIST_CLASS}>
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
                  className={`${SIDEBAR_ITEM_CLASS} ${isActive ? SIDEBAR_ITEM_ACTIVE_CLASS : SIDEBAR_ITEM_IDLE_CLASS}`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="mx-[14px] mt-[10px] border-t border-[var(--amora-line)] pb-4 pt-[14px]">
          <Link
            href="/landing"
            onClick={onClose}
            className="mb-2 flex min-h-11 items-center gap-2 rounded-[9px] px-[10px] text-[13px] text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-warm)] hover:text-[var(--amora-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            웨딩한방 소개
          </Link>
          <Link
            {...weddingLinkProps("/settings")}
            onClick={onClose}
            aria-current={settingsActive ? "page" : undefined}
            className={`mb-2 flex min-h-11 items-center gap-2 rounded-[9px] px-[10px] text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 ${
              settingsActive
                ? "bg-[var(--amora-selected-bg)] font-semibold text-[var(--amora-selected-text)]"
                : "text-[var(--amora-soft)] hover:bg-[var(--amora-warm)] hover:text-[var(--amora-ink)]"
            }`}
          >
            <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
            설정
          </Link>
          <div className="px-[10px] pb-[10px] pt-[6px]">
            <div className="flex items-center gap-3">
              <ProfileAvatar name={profile?.name} label={userName} avatarUrl={profile?.avatar_url} size={32} />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[var(--amora-ink)]">{userName}</p>
                <p className="mt-0.5 truncate text-[11px] font-medium text-[var(--amora-soft)]">{weddingDateStr}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-[10px] py-2 text-[12.5px] text-[var(--amora-muted)] hover:bg-[var(--amora-warm)]"
          >
            <LogOut className="h-4 w-4" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
