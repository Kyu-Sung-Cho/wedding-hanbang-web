"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { Bell, Menu, Search } from "lucide-react";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import NotificationPanel from "@/components/app/NotificationPanel";
import AmoraWorkspaceNav from "@/components/app/amora/AmoraWorkspaceNav";
import { useAmoraDock } from "@/components/app/amora/amoraDock";
import AmoraMark from "@/components/ui/AmoraMark";
import Button from "@/components/ui/Button";
import { useNotifications, useNotificationPrefs } from "@/hooks/useNotifications";
import { stripWeddingBasePath, weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { SHOW_SIGNED_IN_COMMUNITY } from "@/lib/features/signedInCommunity";
import { useAuthStore } from "@/stores/authStore";
import { daysUntilWedding } from "@/lib/utils/weddingDate";

const pageTitles: Record<string, string> = {
  "/lounge": "웨딩 라운지",
  "/preparation-style": "웨딩코드",
  "/chat": "아모라",
  "/chat/personal": "나만 보는 할 일",
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
  // 아모라 도움 방식·기억 화면도 사이드바에서는 "설정" 아래에 켜진다. 정확히 `/settings` 는 위 표가 먼저 잡는다.
  { prefix: "/settings/", title: "설정" },
  // 로그인 없이 읽는 공개 화면이지만, 로그인한 사람에게는 앱 틀 안에서 열린다(`MannersChrome`).
  { prefix: "/manners", title: "예절 가이드" },
];

// 예전에는 큰 화면 머리줄에 체크리스트·일정·예산·웨딩코드 바로가기가 있었다. 2026-11-13 파운더
// 결정으로 메인이 웨딩 라운지와 아모라 둘이 되면서 뺐다. 그 화면들은 라운지와 아모라가 연다.

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
  // 아모라 전체 화면·예절 가이드처럼 아모라 자리가 없는 화면에서는 null 이라 버튼을 그리지 않는다.
  const amoraDock = useAmoraDock();
  const { prefs } = useNotificationPrefs();
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // **한국 새벽 0~9시에 하루가 더 나왔다.**
  //
  // `new Date("YYYY-MM-DD")` 는 UTC 자정으로 파싱되고 `new Date()` 는 지금 이 순간이다.
  // KST 0~9시는 UTC 로 전날 15~24시라 차이가 온전한 일수보다 조금 크고, `Math.ceil`
  // 이 그걸 올려 하루를 더한다. 예식 당일 새벽에 "D-1" 이 뜨는 종류다.
  //
  // `daysUntilWedding` 은 예식일과 오늘을 **둘 다 KST 자정으로** 맞춘 뒤 비교한다.
  const dday = daysUntilWedding(journey?.wedding_date);
  const progress = journey?.progress ?? {};
  const { notifications, newCount, dismiss, dismissAll } = useNotifications(journey?.wedding_date, progress, prefs);

  // 알림창이 열려 있는 동안 Esc 로 닫고 초점을 종으로 돌려준다(바깥 클릭 오버레이는 마우스 전용이다).
  useEffect(() => {
    if (!showNotifications) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowNotifications(false);
      bellRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showNotifications]);

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
          {/* 아모라를 옆에(큰 화면) 또는 위에(태블릿) 연다. 폰에서는 하단 탐색과 본문 질문이 같은 일을 한다.
              Button 은 `inline-flex` 를 깔고 있어 단추에 `hidden` 을 얹으면 어느 쪽이 이길지 CSS 순서에 달린다.
              그래서 폰에서 숨기는 일은 감싼 칸이 맡는다. */}
          {amoraDock && (
            <span className="hidden md:contents">
              <Button
                variant={amoraDock.isOpen ? "primary" : "secondary"}
                // 옆의 알림 단추(44px)와 같은 높이. sm 은 40px 라 줄이 들쭉날쭉하다.
                size="md"
                onClick={() => amoraDock.toggle()}
                aria-pressed={amoraDock.isOpen}
                aria-controls={amoraDock.docked ? "amora-dock-pane" : undefined}
                data-amora-dock-toggle=""
                // 닫힘(secondary)에만 테두리가 있다. 열림에도 같은 굵기의 투명 테두리를 둬서 누를 때 폭이 바뀌지 않게 한다.
                className={amoraDock.isOpen ? "shrink-0 border border-transparent" : "shrink-0"}
              >
                <AmoraMark size={16} aria-hidden="true" />
                아모라
              </Button>
            </span>
          )}

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
              ref={bellRef}
              onClick={() => setShowNotifications((value) => !value)}
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-[var(--hb-text-body)] transition-colors hover:bg-white hover:text-[var(--hb-accent-hover)]"
              aria-expanded={showNotifications}
              aria-label={newCount > 0 ? `새 알림 ${newCount}개` : "알림"}
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
