"use client";

import { useState, type Ref } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { Bell, Menu, Search } from "lucide-react";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import NotificationPanel from "@/components/app/NotificationPanel";
import AmoraWorkspaceNav from "@/components/app/amora/AmoraWorkspaceNav";
import { useNotifications, useNotificationPrefs } from "@/hooks/useNotifications";
import { isWeddingPathActive, stripWeddingBasePath, weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { SHOW_SIGNED_IN_COMMUNITY } from "@/lib/features/signedInCommunity";
import { useAuthStore } from "@/stores/authStore";
import { daysUntilWedding } from "@/lib/utils/weddingDate";

const pageTitles: Record<string, string> = {
  "/lounge": "웨딩 라운지",
  "/preparation-style": "웨딩코드",
  "/chat": "아모라",
  "/budget": "예산",
  "/market-prices": "공시 가격",
  "/checklist": "웨딩 체크리스트",
  "/schedule": "일정",
  "/favorites": "즐겨찾기",
  "/saved": "저장한 이야기",
  "/settings": "설정",
  "/money": "축의금 관리",
};

const pageTitlePrefixes: Array<{ prefix: string; title: string }> = [
  { prefix: "/settings/amora-style", title: "아모라 도움 방식" },
  { prefix: "/settings/amora-memory", title: "아모라가 기억하는 것" },
  { prefix: "/vendors/favorites", title: "찜한 업체" },
  { prefix: "/vendors", title: "업체 탐색" },
  { prefix: "/bookings", title: "예약 관리" },
];

const quickLinks = [
  { linkProps: weddingLinkProps("/chat"), legacyPath: "/chat", label: "아모라" },
  { linkProps: weddingLinkProps("/checklist"), legacyPath: "/checklist", label: "체크리스트" },
  { linkProps: weddingLinkProps("/schedule"), legacyPath: "/schedule", label: "일정" },
  { linkProps: weddingLinkProps("/budget"), legacyPath: "/budget", label: "예산" },
  { linkProps: weddingLinkProps("/preparation-style"), legacyPath: "/preparation-style", label: "웨딩코드" },
  { linkProps: weddingLinkProps(), legacyPath: "/community", label: "커뮤니티" },
];

function getPageTitle(pathname: string) {
  return pageTitles[pathname] ?? pageTitlePrefixes.find((item) => pathname.startsWith(item.prefix))?.title ?? "웨딩한방";
}

interface TopNavProps {
  onMenuToggle: () => void;
  amoraWorkspace?: boolean;
  planningWorkspace?: boolean;
  loungeWorkspace?: boolean;
  compactChrome?: boolean;
  amoraNavigationRef?: Ref<HTMLDivElement>;
}

export default function TopNav({ onMenuToggle, amoraWorkspace = false, planningWorkspace = false, loungeWorkspace = false, compactChrome = false, amoraNavigationRef }: TopNavProps) {
  const compactWorkspace = planningWorkspace || loungeWorkspace || compactChrome;
  const htmlDesign = amoraWorkspace || compactWorkspace;
  const pathname = usePathname();
  const router = useRouter();
  const appPathname = stripWeddingBasePath(pathname);
  const title = appPathname === "/chat/board" ? "결정 보드" : appPathname === "/chat/missions" ? "아모라 · 오늘의 미션" : getPageTitle(appPathname);
  const { journey } = useAuthStore();
  const { prefs } = useNotificationPrefs();
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;
  // **한국 새벽 0~9시에 하루가 더 나왔다.**
  //
  // `new Date("YYYY-MM-DD")` 는 UTC 자정으로 파싱되고 `new Date()` 는 지금 이 순간이다.
  // KST 0~9시는 UTC 로 전날 15~24시라 차이가 온전한 일수보다 조금 크고, `Math.ceil`
  // 이 그걸 올려 하루를 더한다. 예식 당일 새벽에 "D-1" 이 뜨는 종류다.
  //
  // `daysUntilWedding` 은 예식일과 오늘을 **둘 다 KST 자정으로** 맞춘 뒤 비교한다.
  const dday = daysUntilWedding(journey?.wedding_date);
  const progress = journey?.progress ?? {};
  const { notifications, newCount, dismiss, dismissAll } = useNotifications(weddingDate, progress, prefs);

  function handleCategoryClick(categoryKey: string) {
    setShowNotifications(false);
    setSelectedCategory(categoryKey);
  }

  return (
    <>
      <header className={amoraWorkspace ? "sticky top-0 z-30 grid shrink-0 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-[var(--amora-line)] bg-[var(--amora-bg)] px-[18px] py-2 md:bg-white md:px-9 xl:min-h-[102px] xl:grid-cols-[1fr_auto_auto]" : compactWorkspace ? "sticky top-0 z-30 flex min-h-[64px] shrink-0 items-center justify-between gap-2 border-b border-[var(--amora-line)] bg-white px-[18px] py-2 md:min-h-[88px] md:px-9 md:py-5" : htmlDesign ? "sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between gap-2 border-b border-[var(--amora-line)] bg-[var(--amora-bg)] px-[18px] md:h-[102px] md:bg-white md:px-9" : "sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[var(--hb-hairline)]/70 bg-[#fffdf7]/92 px-8 backdrop-blur-[14px] max-md:px-5"}>
        <div className={htmlDesign ? "flex min-w-0 items-center gap-1" : "flex items-center gap-4"}>
          <button
            type="button"
            onClick={onMenuToggle}
            className={htmlDesign ? "flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--amora-soft)] md:hidden" : "flex h-11 w-11 items-center justify-center rounded-full border border-[var(--hb-hairline)] text-[var(--hb-text-strong)] md:hidden"}
            aria-label="메뉴 열기"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            {...weddingLinkProps("/lounge")}
            className={`flex flex-col justify-center rounded-[6px] outline-none transition-colors hover:text-[var(--hb-accent-hover)] focus-visible:ring-2 focus-visible:ring-[#c9a96e]/50 ${amoraWorkspace ? "min-h-11" : ""}`}
            aria-label="웨딩한방 홈으로 이동"
          >
            <p className={htmlDesign ? "mb-1 hidden text-[11px] tracking-[0.08em] text-[var(--amora-muted)] md:block" : "text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--hb-accent-hover)]"}>Wedding Hanbang</p>
            <h1 className={htmlDesign ? "text-[16px] font-semibold leading-tight text-[var(--amora-ink)] md:text-[19px]" : "mt-0.5 font-serif-kr text-[24px] font-medium leading-tight text-[var(--hb-text-strong)]"}>{title}</h1>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <nav
            aria-label="주요 기능 바로가기"
            className={htmlDesign ? "hidden" : "mr-4 hidden shrink-0 items-center gap-4 whitespace-nowrap text-[15px] font-semibold text-[var(--hb-text-strong)] xl:flex"}
          >
            {quickLinks.filter((item) => SHOW_SIGNED_IN_COMMUNITY || item.legacyPath !== "/community").map((item, index) => {
              const isActive = isWeddingPathActive(pathname, item.legacyPath);
              return (
                <div key={item.legacyPath} className="flex items-center gap-4">
                  {index > 0 && <span className="h-4 w-px bg-[#eadfc9]" aria-hidden />}
                  <Link
                    {...item.linkProps}
                    className={`transition-colors hover:text-[var(--hb-accent-hover)] ${
                      isActive ? "text-[var(--hb-accent-hover)]" : "text-[var(--hb-text-strong)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                </div>
              );
            })}
          </nav>

          <div className={compactWorkspace ? "flex shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--amora-rose-deep)] px-[11px] py-[7px] text-white md:px-[14px]" : htmlDesign ? "hidden items-center gap-2 rounded-full bg-[var(--amora-low)] px-[13px] py-[7px] xl:flex" : "hidden items-center gap-2 rounded-full border border-[var(--hb-hairline)] bg-white px-4 py-2 sm:flex"}>
            {!compactWorkspace && <span className="h-2 w-2 rounded-full bg-[var(--hb-accent)]" />}
            <span className={compactWorkspace ? "text-[11px] font-semibold md:text-[12.5px]" : "text-[13px] font-semibold text-[var(--hb-text-strong)]"}>
              {dday === null ? compactWorkspace ? "날짜 미정" : "결혼식 날짜 미정" : dday > 0 ? `D-${dday}` : dday === 0 ? "D-day" : `D+${Math.abs(dday)}`}
            </span>
          </div>

          {SHOW_SIGNED_IN_COMMUNITY && !amoraWorkspace && <button
            type="button"
            onClick={() => router.push(weddingPath("/community?feed=all#community-feed"))}
            className={`${compactWorkspace ? "hidden md:flex" : "flex"} h-11 w-11 items-center justify-center rounded-full text-[var(--hb-text-body)] transition-colors hover:bg-white hover:text-[var(--hb-accent-hover)]`}
            aria-label="커뮤니티 검색"
            title="커뮤니티 검색"
          >
            <Search className="h-5 w-5" />
          </button>}

          <div className={planningWorkspace && appPathname !== "/schedule" ? "relative hidden md:block" : "relative"}>
            <button
              type="button"
              onClick={() => setShowNotifications((value) => !value)}
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-[var(--hb-text-body)] transition-colors hover:bg-white hover:text-[var(--hb-accent-hover)]"
              aria-label="알림"
            >
              <Bell className="h-5 w-5" />
              {newCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--hb-primary)] px-1 text-[10px] font-semibold text-white">
                  {newCount > 9 ? "9+" : newCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {showNotifications && (
                <NotificationPanel
                  notifications={notifications}
                  onDismiss={dismiss}
                  onDismissAll={dismissAll}
                  onCategoryClick={handleCategoryClick}
                  onOpen={(notification) => {
                    const isPendingPlanDecision =
                      notification.type === "partner"
                      && (
                        notification.eventKind === "approval_requested"
                        || notification.eventKind === "approval_pending"
                      )
                      && notification.toolName === "manual_plan_change"
                      && Boolean(notification.actionId);
                    if (!isPendingPlanDecision) {
                      dismiss(notification.id);
                    }
                    setShowNotifications(false);
                    if (notification.href) {
                      router.push(weddingPath(notification.href));
                    }
                  }}
                  onClose={() => setShowNotifications(false)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
        {amoraWorkspace && (
          <div ref={amoraNavigationRef} data-amora-navigation-slot className="col-span-2 min-h-[54px] min-w-0 xl:col-span-1">
            {appPathname !== "/chat" && <AmoraWorkspaceNav />}
          </div>
        )}
      </header>

      <CategoryChecklistModal
        categoryKey={selectedCategory ?? ""}
        isOpen={!!selectedCategory}
        onClose={() => setSelectedCategory(null)}
      />
    </>
  );
}
