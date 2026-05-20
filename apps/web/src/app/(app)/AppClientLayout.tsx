"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import { useAuthStore } from "@/stores/authStore";
import Sidebar from "@/components/app/Sidebar";
import TopNav from "@/components/app/TopNav";
import ChatSidePanel from "@/components/app/chat/ChatSidePanel";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import { usePageViewTracker } from "@/hooks/useEventTracker";

export default function AppClientLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const pathname = usePathname();
  const isChatPage = pathname === "/chat";
  const { initialize, isInitialized, isLoading } = useAuthStore();

  // 페이지뷰 클릭스트림 자동 추적
  usePageViewTracker();

  useEffect(() => {
    if (!isInitialized) initialize();
  }, [initialize, isInitialized]);

  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#795252] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[13px] text-[#B5ADA3]">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="md:ml-[280px]">
        <TopNav onMenuToggle={() => setSidebarOpen(true)} />
        {/* 채팅 페이지는 ChatGPT 스타일로 main 영역 전체 사용 — 좌측 카테고리
            사이드바 외 가용 폭을 다 쓰도록 main padding 축소. 다른 페이지는
            기존 p-8 유지. */}
        <main className={isChatPage ? "px-3 py-3 sm:px-4 sm:py-4" : "p-8 max-md:p-5"}>
          {children}
        </main>

        {/* AI 기본법 고지 — 원칙 P6 실체화. 채팅 페이지에선 footer가 채팅 폭을
            제한하지 않도록 양 옆 padding 만 살짝 줄임. */}
        <div className={isChatPage ? "px-3 pb-6 sm:px-4" : "px-8 pb-10 max-md:px-5"}>
          <AiNoticeFooter variant="light" />
        </div>
      </div>

      {/* AI 채팅 사이드 패널 */}
      <ChatSidePanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />

      {/* 플로팅 AI 버튼 (/chat 페이지에서는 숨김, 패널 열리면 숨김) */}
      {!isChatPage && !chatPanelOpen && (
        <button
          onClick={() => setChatPanelOpen(true)}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.3)] hover:shadow-[0_6px_28px_rgba(121,82,82,0.4)] hover:scale-105 active:scale-95 transition-all duration-200"
          title="아모라 AI 상담"
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
