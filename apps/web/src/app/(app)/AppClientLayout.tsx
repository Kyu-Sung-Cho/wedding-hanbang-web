"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import ChatSidePanel from "@/components/app/chat/ChatSidePanel";
import Sidebar from "@/components/app/Sidebar";
import TopNav from "@/components/app/TopNav";
import { usePageViewTracker } from "@/hooks/useEventTracker";
import { useAuthSessionSync } from "@/hooks/useAuthSessionSync";
import { stripWeddingBasePath } from "@/lib/weddingPaths";
import { isAnalyticsSuppressedLocation } from "@/lib/analyticsPrivacy";
import { useAuthStore } from "@/stores/authStore";

function GlobalChatAssistant() {
  const [chatPanelOpen, setChatPanelOpen] = useState(false);

  return (
    <>
      <ChatSidePanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />

      {!chatPanelOpen && (
        <button
          type="button"
          onClick={() => setChatPanelOpen(true)}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[#061a34] text-white shadow-[0_14px_34px_rgba(6,26,52,0.2)] transition-transform hover:-translate-y-0.5 md:bottom-6 md:right-6 md:h-14 md:w-14"
          title="아모라 AI 상담"
          aria-label="아모라 AI 상담"
        >
          <Sparkles className="h-5 w-5 md:h-6 md:w-6" />
        </button>
      )}
    </>
  );
}

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const appPathname = stripWeddingBasePath(pathname);
  const isChatPage = appPathname === "/chat";
  const { initialize, isInitialized, isLoading, isDemo, user } = useAuthStore();
  const actorScope = isDemo ? "demo" : user?.id ?? "anonymous";

  const analyticsSuppressed = isAnalyticsSuppressedLocation(pathname, searchParams);
  const vendorAdminPreview = (
    pathname === "/wedding/vendors" || pathname.startsWith("/wedding/vendors/")
  ) && searchParams.get("preview") === "1";

  usePageViewTracker(isInitialized && !isDemo && !analyticsSuppressed);
  // 첫 hydration에서는 Zustand가 아직 isDemo=false다. 서버가 검증한 데모라면
  // 이 순간에도 Supabase 세션 구독을 만들지 않아야 INITIAL_SESSION 이벤트가
  // 데모 상태를 지우고 원격 Auth 대기로 되돌리는 경쟁 조건이 생기지 않는다.
  useAuthSessionSync(!initialDemo && !isDemo);

  useEffect(() => {
    if (!isInitialized) void initialize({ initialDemo });
  }, [initialize, initialDemo, isInitialized]);

  if (!isInitialized || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[#36534e] border-t-transparent" />
          <p className="text-[13px] font-medium text-[#7d7166]">웨딩 라운지를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      key={actorScope}
      className={`${analyticsSuppressed ? "ph-no-capture " : ""}${
        isChatPage
          // iOS 사파리는 100vh가 주소창 높이를 포함해 입력창이 화면 밖으로 밀린다 → dvh
          ? "hanbang-service-theme h-[100dvh] overflow-hidden bg-[#fbf8f2]"
          : "hanbang-service-theme min-h-screen bg-[linear-gradient(180deg,#fbf8f2_0%,#ffffff_48%,#f6efe5_100%)]"
      }`}
    >
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={isChatPage ? "flex h-[100dvh] flex-col md:ml-[16rem]" : "md:ml-[16rem]"}>
        <TopNav onMenuToggle={() => setSidebarOpen(true)} />
        {banner}
        {isChatPage ? (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
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
      </div>

      {!isChatPage && !vendorAdminPreview && (
        <GlobalChatAssistant />
      )}
    </div>
  );
}
