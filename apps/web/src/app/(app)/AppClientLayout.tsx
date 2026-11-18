"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import Sidebar from "@/components/app/Sidebar";
import { SIDEBAR_OFFSET_CLASS } from "@/components/app/sidebarStyles";
import TopNav from "@/components/app/TopNav";
import { preloadMannersSignedInChrome } from "@/components/manners/mannersChromeChunks";
import AmoraBottomNav from "@/components/app/amora/AmoraBottomNav";
import AmoraDockHost from "@/components/app/amora/AmoraDockHost";
import { AmoraNavigationTargetContext } from "@/components/app/amora/AmoraNavigationContext";
import { useAuthSessionSync } from "@/hooks/useAuthSessionSync";
import { stripWeddingBasePath } from "@/lib/weddingPaths";
import { isAnalyticsSuppressedLocation } from "@/lib/analyticsPrivacy";
import { isInvitationSurfacePath } from "@/components/invitation/live/liveRoutes";
import { useAuthStore } from "@/stores/authStore";

/**
 * 로그인한 사람의 앱 틀.
 *
 * ## 화면은 둘이다 (2026-11-13 파운더 결정)
 *
 * 웨딩 라운지(모든 준비를 한 화면에서 본다)와 아모라(대화로 맡긴다). 체크리스트·일정·예산·예절
 * 가이드 같은 나머지 화면은 메뉴에서 빠지고 라운지와 아모라 뒤에서 열린다. 아모라 전체 화면이
 * 아닌 곳에서는 어디서든 아모라를 열 수 있고, 큰 화면에서는 아모라가 본문을 옆으로 밀고 그 옆에
 * 붙는다(`AmoraDockHost`).
 *
 * ## 청첩장 디자인 화면 (2026-11-17 파운더 디자인 아티팩트, 원문 "이 디자인 완전 같아야해")
 *
 * 웨딩 라운지(`/lounge`)·아모라(`/chat`)·준비 순서·웨딩홀 비교·편지·상담은 새 디자인이 화면 전체를 그린다.
 * 그 화면에는 옛 사이드바·상단 바·아모라 옆자리를 두지 않는다(웹 넓은 화면은 대화가 왼쪽 칸에 이미 있다).
 * 인증·동의(서버 틀)·체험 표시·이용 통계 끄기·실시간 동기화는 두 틀이 같다. 나머지 화면(예산·체크리스트·일정·
 * 설정·예절 가이드)은 옛 틀 그대로이고 새 화면의 링크로 연다.
 *
 * 새 틀은 서비스 테마(`hanbang-service-theme`)를 걸지 않는다. 그 테마는 제목과 단추 글꼴을 Pretendard 로
 * 덮어(레이어 밖 규칙) 고운바탕·Noto Sans KR 을 지운다. 대신 기존 예외 틀 이름(`amora-workspace`)만 건다 —
 * 대화 카드(승인 카드·저장 시트)가 쓰는 아모라 색 변수가 거기 있다. `globals.css` 는 고치지 않았다.
 */
export default function AppClientLayout({
  children,
  banner = null,
  initialDemo = false,
}: {
  children: React.ReactNode;
  // 체험 고지처럼 본문 흐름 밖에서 항상 보여야 하는 서버 렌더 알림.
  // children으로 넣으면 채팅의 100dvh 고정 레이아웃 안으로 들어가 화면을 누른다.
  banner?: React.ReactNode;
  // 서버가 demo_session HMAC까지 검증한 결과다. 클라이언트 쿠키만 신뢰하지 않는다.
  initialDemo?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [amoraNavigationTarget, setAmoraNavigationTarget] = useState<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const appPathname = stripWeddingBasePath(pathname);
  const isChatPage = appPathname === "/chat";
  const isAmoraPage = isChatPage || appPathname.startsWith("/chat/");
  const isChecklistPage = appPathname === "/checklist";
  const isBudgetPage = appPathname === "/budget";
  const isSchedulePage = appPathname === "/schedule";
  const isSettingsPage = appPathname === "/settings" || appPathname.startsWith("/settings/");
  const isPlanningPage = isChecklistPage || isBudgetPage || isSchedulePage;
  const isLoungePage = appPathname === "/lounge";
  const isPreparationStylePage = appPathname === "/preparation-style";
  const isLoungeWorkspace = isLoungePage || isPreparationStylePage;
  const hasHtmlDesign = isAmoraPage || isPlanningPage || isLoungeWorkspace;
  const isInvitationSurface = isInvitationSurfacePath(appPathname);
  const { initialize, isInitialized, isLoading, isDemo } = useAuthStore();

  const analyticsSuppressed = isAnalyticsSuppressedLocation(pathname, searchParams);
  const vendorAdminPreview = (
    pathname === "/wedding/vendors" || pathname.startsWith("/wedding/vendors/")
  ) && searchParams.get("preview") === "1";
  // 아모라 화면 안에서는 아모라를 또 옆에 열지 않는다. 관리자 업체 미리보기에도 열지 않는다.
  const amoraDockAvailable = !isAmoraPage && !vendorAdminPreview;

  // 첫 hydration에서는 Zustand가 아직 isDemo=false다. 서버가 검증한 데모라면
  // 이 순간에도 Supabase 세션 구독을 만들지 않아야 INITIAL_SESSION 이벤트가
  // 데모 상태를 지우고 원격 Auth 대기로 되돌리는 경쟁 조건이 생기지 않는다.
  useAuthSessionSync(!initialDemo && !isDemo);

  useEffect(() => {
    if (!isInitialized) void initialize({ initialDemo });
  }, [initialize, initialDemo, isInitialized]);

  // 예절 가이드는 이 틀 밖의 공개 화면이다. 라운지에서 거기로 가도 앱 사이드바·상단 바가 곧바로
  // 이어지도록, 한가할 때 그 두 조각을 미리 받아 둔다(없으면 받는 동안 공개 모양이 깜빡인다).
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preloadMannersSignedInChrome);
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preloadMannersSignedInChrome, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!isInitialized || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--hb-surface-page)]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[var(--hb-primary)] border-t-transparent" />
          <p className="text-[13px] font-medium text-[var(--hb-text-muted)]">웨딩 라운지를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (isInvitationSurface) {
    // 청첩장 디자인 틀: 화면이 창 높이를 채우는 세로 단이고(가운데만 스크롤), 체험 고지는 그 위의 한 줄이다.
    return (
      <AmoraNavigationTargetContext.Provider value={null}>
        <div
          data-app-shell="invitation"
          className={`${analyticsSuppressed ? "ph-no-capture " : ""}amora-workspace flex h-[100dvh] flex-col overflow-hidden bg-inv-white text-inv-ink`}
        >
          {banner}
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </div>
      </AmoraNavigationTargetContext.Provider>
    );
  }

  const pageColumn = (
    <>
      <TopNav onMenuToggle={() => setSidebarOpen(true)} amoraWorkspace={isAmoraPage} planningWorkspace={isPlanningPage} loungeWorkspace={isLoungeWorkspace} compactChrome={isSettingsPage} amoraNavigationRef={setAmoraNavigationTarget} />
      {banner}
      {isChatPage ? (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      ) : hasHtmlDesign ? (
        <>
          <main>{children}</main>
          {(isPlanningPage || isLoungeWorkspace) && <div className="px-[18px] pb-10 lg:px-9"><AiNoticeFooter variant="light" /></div>}
        </>
      ) : (
        <>
          <main className="p-6 max-md:p-4">
            <div className="mx-auto max-w-[1120px]">{children}</div>
          </main>
          <div className="px-6 pb-10 max-md:px-4">
            <div className="mx-auto max-w-[1120px]">
              <AiNoticeFooter variant="light" />
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <AmoraNavigationTargetContext.Provider value={amoraNavigationTarget}>
    <div
      className={`${analyticsSuppressed ? "ph-no-capture " : ""}${isAmoraPage || isLoungeWorkspace ? "amora-workspace " : isPlanningPage || isSettingsPage ? "planning-workspace " : ""}${
        isChatPage
          // iOS 사파리는 100vh가 주소창 높이를 포함해 입력창이 화면 밖으로 밀린다 → dvh
          ? "hanbang-service-theme h-[100dvh] overflow-hidden bg-[var(--hb-surface-page)]"
          : "hanbang-service-theme min-h-screen bg-[var(--hb-surface-page)]"
      }`}
    >
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* 사이드바 너비는 어느 화면에서나 같다(`sidebarStyles.ts`). 본문 여백도 하나다. */}
      <div className={isChatPage ? `flex h-[100dvh] flex-col ${SIDEBAR_OFFSET_CLASS}` : hasHtmlDesign ? `pb-[calc(74px+env(safe-area-inset-bottom))] ${SIDEBAR_OFFSET_CLASS} md:pb-0` : SIDEBAR_OFFSET_CLASS}>
        {amoraDockAvailable ? (
          // 라운지·준비 화면은 본문 질문과 하단 탐색이 있어 오른쪽 아래 고정 버튼을 두지 않는다
          // (목록을 덮는다). 그래도 상단 바와 본문에서 아모라를 열 수 있다.
          <AmoraDockHost launcher={!hasHtmlDesign}>{pageColumn}</AmoraDockHost>
        ) : pageColumn}
      </div>

      {hasHtmlDesign && !isChatPage && (
        <AmoraBottomNav active={isLoungePage ? "lounge" : isAmoraPage ? "amora" : null} />
      )}
    </div>
    </AmoraNavigationTargetContext.Provider>
  );
}
