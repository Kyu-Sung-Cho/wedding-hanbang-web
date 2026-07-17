"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, LogIn, Sparkles, X } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { isPreviewStubMode } from "@/lib/previewStub";

const ChatSidePanel = dynamic(() => import("@/components/app/chat/ChatSidePanel"), {
  ssr: false,
});

export default function CommunityAmoraLauncher() {
  const { initialize } = useAuthStore();
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);

  async function handleOpenAmora() {
    if (checkingAuth) return;

    if (isPreviewStubMode()) {
      setLoginPromptOpen(true);
      return;
    }

    setCheckingAuth(true);
    try {
      if (document.cookie.includes("demo_mode=true")) {
        await initialize({ force: true });
        setChatPanelOpen(true);
        return;
      }

      const res = await fetch("/api/auth/me?guest_probe=1", {
        cache: "no-store",
        credentials: "include",
      });

      if (!res.ok) {
        setLoginPromptOpen(true);
        return;
      }

      const data = (await res.json().catch(() => null)) as { user?: unknown } | null;
      if (!data?.user) {
        setLoginPromptOpen(true);
        return;
      }

      await initialize({ force: true });
      setChatPanelOpen(true);
    } finally {
      setCheckingAuth(false);
    }
  }

  return (
    <>
      <ChatSidePanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />

      {!chatPanelOpen && (
        <button
          type="button"
          onClick={handleOpenAmora}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-40 flex h-12 w-12 items-center justify-center rounded-full border border-[#d8c7ad] bg-[#fffdf7] text-[#36534E] shadow-[0_12px_30px_rgba(54,83,78,0.16)] transition-transform hover:-translate-y-0.5 hover:bg-[#f7f1e8] disabled:cursor-wait disabled:opacity-70 md:bottom-6 md:right-6 md:h-14 md:w-14"
          title="아모라 AI 상담"
          aria-label="아모라 AI 상담"
          disabled={checkingAuth}
        >
          <Sparkles className={`h-5 w-5 md:h-6 md:w-6 ${checkingAuth ? "animate-pulse" : ""}`} />
        </button>
      )}

      {loginPromptOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#071629]/35 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[420px] rounded-[22px] border border-[#eadfc9] bg-[#fffdf7] p-5 shadow-[0_24px_70px_rgba(8,22,38,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef4ef] text-[#36534E]">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[12px] font-semibold text-[#9d6f36]">아모라 상담</p>
                  <h2 className="font-serif-kr text-[24px] font-medium leading-tight text-[#071629]">
                    로그인 후 이용할 수 있어요.
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLoginPromptOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#7a8290] transition-colors hover:bg-white hover:text-[#071629]"
                aria-label="닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-4 text-[14px] font-medium leading-[1.75] text-[#5d6879]">
              커뮤니티 글은 누구나 볼 수 있지만, 아모라 상담은 내 예식일과 준비 정보를 바탕으로 답해야 해서 로그인이 필요해요.
            </p>

            <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_12px_28px_rgba(54,83,78,0.18)] transition-colors hover:bg-[#2f4944]"
              >
                <LogIn className="h-4 w-4" />
                로그인하기
                <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => setLoginPromptOpen(false)}
                className="inline-flex items-center justify-center rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[14px] font-semibold text-[#36534E] transition-colors hover:bg-[#fff8ec]"
              >
                계속 둘러보기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
