"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import Sidebar from "@/components/app/Sidebar";
import TopNav from "@/components/app/TopNav";
import { usePageViewTracker } from "@/hooks/useEventTracker";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
          <p className="text-[13px] text-taupe-400">로딩 중...</p>
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
    </div>
  );
}
