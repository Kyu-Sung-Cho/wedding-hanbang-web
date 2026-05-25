"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import ChatSidePanel from "@/components/app/chat/ChatSidePanel";
import Sidebar from "@/components/app/Sidebar";
import TopNav from "@/components/app/TopNav";
import { usePageViewTracker } from "@/hooks/useEventTracker";
import { useAuthStore } from "@/stores/authStore";

export default function AppClientLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const pathname = usePathname();
  const isChatPage = pathname === "/chat";
  const { initialize, isInitialized, isLoading, isDemo } = useAuthStore();

  usePageViewTracker(isInitialized && !isDemo);

  useEffect(() => {
    if (!isInitialized) void initialize();
  }, [initialize, isInitialized]);

  if (!isInitialized || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fffdf7]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[#061a34] border-t-transparent" />
          <p className="text-[13px] font-medium text-[#7a8290]">준비실을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        isChatPage
          ? "hanbang-service-theme h-screen overflow-hidden bg-[#fffdf7]"
          : "hanbang-service-theme min-h-screen bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_48%,#fbf8ee_100%)]"
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
              <div className="mx-auto max-w-[76rem]">{children}</div>
            </main>
            <div className="px-6 pb-10 max-md:px-4">
              <div className="mx-auto max-w-[76rem]">
                <AiNoticeFooter variant="light" />
              </div>
            </div>
          </>
        )}
      </div>

      <ChatSidePanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />

      {!isChatPage && !chatPanelOpen && (
        <button
          type="button"
          onClick={() => setChatPanelOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#061a34] text-white shadow-[0_14px_34px_rgba(6,26,52,0.2)] transition-transform hover:-translate-y-0.5"
          title="아모라 AI 상담"
          aria-label="아모라 AI 상담"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}
