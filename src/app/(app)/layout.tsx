"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import { useAuthStore } from "@/stores/authStore";
import Sidebar from "@/components/app/Sidebar";
import TopNav from "@/components/app/TopNav";
import ChatSidePanel from "@/components/app/chat/ChatSidePanel";
import { usePageViewTracker } from "@/hooks/useEventTracker";

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[25px] text-taupe-400">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ivory-50">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="md:ml-[260px]">
        <TopNav onMenuToggle={() => setSidebarOpen(true)} />
        <main className="p-8 max-md:p-5">{children}</main>
      </div>

      {/* AI 채팅 사이드 패널 */}
      <ChatSidePanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />

      {/* 플로팅 AI 버튼 (/chat 페이지에서는 숨김, 패널 열리면 숨김) */}
      {!isChatPage && !chatPanelOpen && (
        <button
          onClick={() => setChatPanelOpen(true)}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center text-white shadow-[0_4px_20px_rgba(196,150,126,0.4)] hover:shadow-[0_6px_28px_rgba(196,150,126,0.5)] hover:scale-105 active:scale-95 transition-all duration-200"
          title="아모라 AI 상담"
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
