"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import Sidebar from "@/components/app/Sidebar";
import TopNav from "@/components/app/TopNav";
import { usePageViewTracker } from "@/hooks/useEventTracker";
import { useAuthSessionSync } from "@/hooks/useAuthSessionSync";
import { stripWeddingBasePath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

const ChatSidePanel = dynamic(
  () => import("@/components/app/chat/ChatSidePanel"),
  { ssr: false },
);

export default function AppClientLayout({
  children,
  initialDemo,
}: {
  children: React.ReactNode;
  initialDemo: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [retryingAuth, setRetryingAuth] = useState(false);
  const pathname = usePathname();
  const appPathname = stripWeddingBasePath(pathname);
  const isChatPage = appPathname === "/chat";
  const hasContextualAssistant = appPathname.startsWith("/vendors");
  const isFocusedCourtInput = appPathname === "/couple-court/new"
    || /^\/couple-court\/cases\/[^/]+\/statement$/u.test(appPathname);
  const { initialize, isInitialized, isLoading, isDemo, initError } = useAuthStore();

  usePageViewTracker(isInitialized && !isDemo);
  useAuthSessionSync(!initialDemo && !isDemo);

  useEffect(() => {
    if (!isInitialized) void initialize({ verifiedDemo: initialDemo });
  }, [initialDemo, initialize, isInitialized]);

  const retryAuthentication = async () => {
    if (retryingAuth) return;
    setRetryingAuth(true);
    try {
      await initialize({ force: true });
    } finally {
      setRetryingAuth(false);
    }
  };

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

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] px-5">
        <div
          className="w-full max-w-md rounded-[28px] border border-[#dfd5c8] bg-white p-8 text-center shadow-[0_18px_50px_rgba(54,83,78,0.10)]"
          role="alert"
          aria-live="polite"
        >
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#f7eee5]">
            <AlertCircle className="h-7 w-7 text-[#9b5f4d]" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-[#243b37]">정보를 불러오지 못했어요</h1>
          <p className="mt-3 text-sm leading-6 text-[#71675f]">
            {initError.message}
            <br />
            로그아웃하지 않고 다시 연결할게요.
          </p>
          <button
            type="button"
            onClick={() => void retryAuthentication()}
            disabled={retryingAuth}
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534e] px-6 text-sm font-semibold text-white transition hover:bg-[#2d4843] disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${retryingAuth ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {retryingAuth ? "다시 연결하는 중" : "다시 시도"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        isChatPage
          ? "hanbang-service-theme h-screen overflow-hidden bg-[#fbf8f2]"
          : "hanbang-service-theme min-h-screen bg-[linear-gradient(180deg,#fbf8f2_0%,#ffffff_48%,#f6efe5_100%)]"
      }
    >
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={isChatPage ? "flex h-screen flex-col md:ml-[16rem]" : "md:ml-[16rem]"}>
        <TopNav onMenuToggle={() => setSidebarOpen(true)} />
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

      {chatPanelOpen && !isChatPage && (
        <ChatSidePanel isOpen onClose={() => setChatPanelOpen(false)} />
      )}

      {!isChatPage && !chatPanelOpen && !hasContextualAssistant && !isFocusedCourtInput && (
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
    </div>
  );
}
